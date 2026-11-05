/**
 * Bump 分析引擎（移植自 BumpCop：coplanarity_engine.py / pipeline.py / overlay_engine.py / server.py）
 * 依賴：i18n.js, prefs.js（t）、viewer-ui.js（parseFileToDataset、SUPPORTED_EXTS）
 * 匯出（全域）：BumpEngine, bcIsHeightFile, bcParseHeightFile, bcEncodeBcrf, bcEncodeAsc
 *
 * 所有計算都在瀏覽器主執行緒以非同步方式進行，會定期讓出執行權並回報進度，
 * 介面與原本 BumpCop 的 Api 相同（upload / bumps / coplanarity / overlay / heightTrace），
 * 回傳的 payload 欄位也與 server.py 一致。
 */

/* ------------------------------------------------------------------ */
/*  檔案：解析 / 輸出（沿用 WebViewer 的解析器，輸出沿用 BumpCop 格式）  */
/* ------------------------------------------------------------------ */

function bcFileExt(name) {
    const dot = String(name || '').lastIndexOf('.');
    return dot >= 0 ? String(name).slice(dot + 1).toLowerCase() : '';
}

function bcIsHeightFile(name) {
    const ext = bcFileExt(name);
    const list = (typeof SUPPORTED_EXTS !== 'undefined') ? SUPPORTED_EXTS : ['bcrf', 'asc'];
    return list.includes(ext);
}

/** 解析為 { header, data(Float32Array, 無效為 NaN), width, height, name } */
async function bcParseHeightFile(file, onProgress) {
    if (typeof parseFileToDataset !== 'function') throw new Error('parseFileToDataset unavailable');
    const ds = await parseFileToDataset(file, (p) => {
        if (typeof onProgress === 'function') return onProgress(p);
        return undefined;
    });
    if (ds.type === 'pcd-scatter' || !ds.data || !ds.width || !ds.height) {
        throw new Error(t('bc.toastUnsupported', file.name));
    }
    let data = ds.data;
    if (!(data instanceof Float32Array)) data = Float32Array.from(data);
    for (let i = 0; i < data.length; i++) if (!Number.isFinite(data[i])) data[i] = NaN;
    if (typeof onProgress === 'function') await onProgress(1);
    return { header: ds.header || {}, data, width: ds.width, height: ds.height, name: file.name };
}

const BC_FLOAT32_LE = new Uint8Array(Float32Array.of(1).buffer)[0] === 0;

function bcFormatAscNumber(value) {
    if (!Number.isFinite(value)) return 'nan';
    const rounded = Math.fround(value);
    const text = String(rounded);
    if (Math.fround(Number(text)) === rounded) return text;
    return rounded.toExponential(8);
}

function bcFloat32Payload(data, length) {
    const copy = new Float32Array(length);
    const source = data.subarray ? data.subarray(0, length) : data;
    copy.set(source);
    const bytes = new Uint8Array(copy.buffer);
    if (!BC_FLOAT32_LE) {
        for (let i = 0; i < bytes.length; i += 4) {
            const a = bytes[i];
            const b = bytes[i + 1];
            bytes[i] = bytes[i + 3];
            bytes[i + 1] = bytes[i + 2];
            bytes[i + 2] = b;
            bytes[i + 3] = a;
        }
    }
    return bytes;
}

function bcEncodeBcrf(grid, meta) {
    const width = grid.width;
    const height = grid.height;
    const header = [
        'fileformat=bcrf',
        'xpixels=' + width,
        'ypixels=' + height,
        'xlength=' + meta.xlength,
        'ylength=' + meta.ylength,
        'xunit=' + meta.xunit,
        'yunit=' + meta.yunit,
        'zunit=' + meta.zunit,
        '',
    ].join('\n');
    const headerBytes = new TextEncoder().encode(header);
    if (headerBytes.length > 2048) throw new Error('BCRF');
    const payload = bcFloat32Payload(grid.data, width * height);
    const bytes = new Uint8Array(2048 + payload.length);
    bytes.set(headerBytes);
    bytes.set(payload, 2048);
    return new Blob([bytes], { type: 'application/octet-stream' });
}

function bcEncodeAsc(grid, meta) {
    const width = grid.width;
    const height = grid.height;
    const data = grid.data;
    const parts = [
        '# x-pixels = ' + width + '\n',
        '# y-pixels = ' + height + '\n',
        '# x-length = ' + meta.xlength + '\n',
        '# y-length = ' + meta.ylength + '\n',
        '# x-unit = ' + meta.xunit + '\n',
        '# y-unit = ' + meta.yunit + '\n',
        '# z-unit = ' + meta.zunit + '\n',
    ];
    const row = new Array(width);
    for (let r = 0; r < height; r++) {
        const base = r * width;
        for (let c = 0; c < width; c++) row[c] = bcFormatAscNumber(data[base + c]);
        parts.push(row.join(' ') + '\n');
    }
    return new Blob(parts, { type: 'text/plain;charset=utf-8' });
}

/* ------------------------------------------------------------------ */
/*  引擎                                                                 */
/* ------------------------------------------------------------------ */

const BumpEngine = (() => {
    const sessions = new Map();
    const traces = new Map();
    let nextSession = 1;

    const msg = (key, ...args) => (typeof t === 'function' ? t('bc.' + key, ...args) : key);
    const yieldNow = () => new Promise((resolve) => setTimeout(resolve, 0));

    /** 進度回報器：合併過密的回報，並每隔一段時間讓出主執行緒 */
    function makeReporter(onProgress) {
        let lastP = -1;
        let lastYield = performance.now();
        return async function report(p) {
            p = Math.max(0, Math.min(1, Number(p) || 0));
            const now = performance.now();
            const due = now - lastYield >= 40;
            if (p < 1 && p - lastP < 0.004 && !due) return;
            if (p >= lastP) {
                lastP = p;
                if (typeof onProgress === 'function') await onProgress(Math.round(p * 10000) / 10000);
            }
            if (due || p >= 1) {
                await yieldNow();
                lastYield = performance.now();
            }
        };
    }

    const sub = (report, a, b) => (f) => report(a + (b - a) * f);

    /* ---------------- 共用數學 ---------------- */

    function sortedCopy(values, n) {
        const arr = new Float64Array(n == null ? values.length : n);
        for (let i = 0; i < arr.length; i++) arr[i] = values[i];
        arr.sort();
        return arr;
    }

    /** numpy.percentile（linear）；輸入需已排序 */
    function percentileSorted(sorted, q) {
        const n = sorted.length;
        if (!n) return NaN;
        const pos = (n - 1) * q / 100;
        const lo = Math.floor(pos);
        const hi = Math.min(n - 1, lo + 1);
        const frac = pos - lo;
        return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
    }

    function median(values, n) {
        const sorted = sortedCopy(values, n);
        return percentileSorted(sorted, 50);
    }

    function finiteOnly(values) {
        const out = new Float64Array(values.length);
        let n = 0;
        for (let i = 0; i < values.length; i++) {
            const v = values[i];
            if (Number.isFinite(v)) out[n++] = v;
        }
        return out.subarray(0, n);
    }

    /** 高斯消去解 A x = b（A 為 n×n 陣列，就地修改） */
    function solveLinear(A, b, n) {
        const x = new Float64Array(n);
        for (let col = 0; col < n; col++) {
            let pivot = col;
            let best = Math.abs(A[col][col]);
            for (let r = col + 1; r < n; r++) {
                const v = Math.abs(A[r][col]);
                if (v > best) { best = v; pivot = r; }
            }
            if (best < 1e-300) return null;
            if (pivot !== col) {
                const tmp = A[col]; A[col] = A[pivot]; A[pivot] = tmp;
                const tb = b[col]; b[col] = b[pivot]; b[pivot] = tb;
            }
            for (let r = col + 1; r < n; r++) {
                const f = A[r][col] / A[col][col];
                if (f === 0) continue;
                for (let c = col; c < n; c++) A[r][c] -= f * A[col][c];
                b[r] -= f * b[col];
            }
        }
        for (let r = n - 1; r >= 0; r--) {
            let s = b[r];
            for (let c = r + 1; c < n; c++) s -= A[r][c] * x[c];
            x[r] = s / A[r][r];
        }
        return x;
    }

    /** 最小平方：design 由 rowFn(i) 回傳長度 k 的列，解 k 個係數 */
    function leastSquares(count, k, rowFn, rhs) {
        const A = [];
        for (let i = 0; i < k; i++) A.push(new Float64Array(k));
        const b = new Float64Array(k);
        const row = new Float64Array(k);
        for (let i = 0; i < count; i++) {
            rowFn(i, row);
            const z = rhs(i);
            for (let r = 0; r < k; r++) {
                const vr = row[r];
                if (vr === 0) continue;
                b[r] += vr * z;
                const Ar = A[r];
                for (let c = r; c < k; c++) Ar[c] += vr * row[c];
            }
        }
        for (let r = 1; r < k; r++) for (let c = 0; c < r; c++) A[r][c] = A[c][r];
        return solveLinear(A, b, k);
    }

    /* ---------------- 單位 ---------------- */

    const METERS = { m: 1, cm: 1e-2, mm: 1e-3, um: 1e-6, nm: 1e-9, pm: 1e-12, angstrom: 1e-10 };
    const UNIT_ALIAS = {
        meter: 'm', meters: 'm', metre: 'm', metres: 'm',
        centimeter: 'cm', centimeters: 'cm', centimetre: 'cm', centimetres: 'cm',
        millimeter: 'mm', millimeters: 'mm', millimetre: 'mm', millimetres: 'mm',
        micrometer: 'um', micrometers: 'um', micrometre: 'um', micrometres: 'um', micron: 'um', microns: 'um', u: 'um',
        nanometer: 'nm', nanometers: 'nm', nanometre: 'nm', nanometres: 'nm',
        picometer: 'pm', picometers: 'pm', picometre: 'pm', picometres: 'pm',
        a: 'angstrom', ang: 'angstrom', angstroms: 'angstrom',
    };

    function canonicalUnit(unit) {
        let text = String(unit || '').trim().toLowerCase();
        text = text.replace(/[µμ]/g, 'u').replace(/[åÅ]/g, 'a').replace(/[\[\]]/g, '').replace(/\s+/g, '');
        return UNIT_ALIAS[text] || text;
    }

    const unitLabel = (unit) => String(unit || '').trim() || msg('engUnitMissing');

    function headerUnit(header, ...keys) {
        for (const key of keys) {
            const raw = header && header[key];
            if (raw) return String(raw).replace(/[\[\]]/g, '').trim();
        }
        return '';
    }

    function heightmapUnits(ds) {
        const header = ds.header || {};
        return [
            headerUnit(header, 'xunit', 'x-unit'),
            headerUnit(header, 'yunit', 'y-unit'),
            headerUnit(header, 'zunit', 'z-unit'),
        ];
    }

    function xySlopeScale(xUnit, yUnit, zUnit) {
        const xName = canonicalUnit(xUnit);
        const yName = canonicalUnit(yUnit);
        const zName = canonicalUnit(zUnit);
        if (xName !== yName) throw new Error(msg('engUnitXY', unitLabel(xUnit), unitLabel(yUnit)));
        if (xName === zName) return 1;
        const xm = METERS[xName];
        const zm = METERS[zName];
        if (xm == null || zm == null) throw new Error(msg('engUnitXZ', unitLabel(xUnit), unitLabel(zUnit)));
        return zm / xm;
    }

    function positiveLength(raw, pixelCount) {
        const value = parseFloat(raw);
        if (!Number.isFinite(value) || value <= 0) return pixelCount;
        return value;
    }

    function pixelSpacing(header, width, height) {
        header = header || {};
        const xl = positiveLength(header.xlength != null ? header.xlength : header['x-length'], width);
        const yl = positiveLength(header.ylength != null ? header.ylength : header['y-length'], height);
        return [xl / Math.max(1, width - 1), yl / Math.max(1, height - 1)];
    }

    /* ---------------- 連通標號 ---------------- */

    /** 8 連通標號，背景 0；回傳 { labels: Int32Array, count } */
    async function labelComponents(mask, width, height, report) {
        const labels = new Int32Array(width * height);
        let parent = new Int32Array(1 << 16);
        let next = 1;
        const find = (n) => {
            while (parent[n] !== n) {
                parent[n] = parent[parent[n]];
                n = parent[n];
            }
            return n;
        };
        const union = (a, b) => {
            const ra = find(a);
            const rb = find(b);
            if (ra === rb) return ra;
            if (ra < rb) { parent[rb] = ra; return ra; }
            parent[ra] = rb;
            return rb;
        };
        for (let row = 0; row < height; row++) {
            const base = row * width;
            const up = base - width;
            for (let col = 0; col < width; col++) {
                const i = base + col;
                if (!mask[i]) continue;
                let root = 0;
                if (row) {
                    const a = labels[up + col];
                    if (a) root = a;
                    if (col) {
                        const d = labels[up + col - 1];
                        if (d) root = root ? union(root, d) : d;
                    }
                    if (col + 1 < width) {
                        const d = labels[up + col + 1];
                        if (d) root = root ? union(root, d) : d;
                    }
                }
                if (col) {
                    const l = labels[i - 1];
                    if (l) root = root ? union(root, l) : l;
                }
                if (!root) {
                    if (next >= parent.length) {
                        const grown = new Int32Array(parent.length * 2);
                        grown.set(parent);
                        parent = grown;
                    }
                    parent[next] = next;
                    labels[i] = next;
                    next++;
                } else {
                    labels[i] = find(root);
                }
            }
            if ((row & 7) === 0 && report) await report(row / height);
        }
        if (next === 1) {
            if (report) await report(1);
            return { labels, count: 0 };
        }
        const compact = new Int32Array(next);
        let count = 0;
        for (let n = 1; n < next; n++) {
            if (find(n) === n) compact[n] = ++count;
        }
        for (let i = 0; i < labels.length; i++) {
            const l = labels[i];
            if (l) labels[i] = compact[find(l)];
        }
        if (report) await report(1);
        return { labels, count };
    }

    /** 依標號分組：rows/cols 為像素座標，starts[k]..ends[k] 是第 k（1 起）個輪廓的區間 */
    function groupLabels(labels, count) {
        if (!count) return null;
        const sizes = new Int32Array(count + 1);
        let total = 0;
        for (let i = 0; i < labels.length; i++) {
            const l = labels[i];
            if (l) { sizes[l]++; total++; }
        }
        const starts = new Int32Array(count + 2);
        for (let k = 1; k <= count; k++) starts[k + 1] = starts[k] + sizes[k];
        const cursor = Int32Array.from(starts);
        const rows = new Int32Array(total);
        const cols = new Int32Array(total);
        const width = labels.width;
        let i = 0;
        for (let row = 0; row < labels.height; row++) {
            for (let col = 0; col < width; col++, i++) {
                const l = labels[i];
                if (!l) continue;
                const pos = cursor[l]++;
                rows[pos] = row;
                cols[pos] = col;
            }
        }
        return { rows, cols, starts, sizes, count };
    }

    function rangeMask(data, lo, hi) {
        const mask = new Uint8Array(data.length);
        const hasLo = lo != null;
        const hasHi = hi != null;
        for (let i = 0; i < data.length; i++) {
            const v = data[i];
            if (v !== v) continue; // NaN
            if (!Number.isFinite(v)) continue;
            if (hasLo && v < lo) continue;
            if (hasHi && v > hi) continue;
            mask[i] = 1;
        }
        return mask;
    }

    function fitsRanges(length, width, lengthMin, lengthMax, widthMin, widthMax) {
        const direct = lengthMin <= length && length <= lengthMax && widthMin <= width && width <= widthMax;
        const swapped = lengthMin <= width && width <= lengthMax && widthMin <= length && length <= widthMax;
        return direct || swapped;
    }

    function bbox(rows, cols, start, end) {
        let r0 = rows[start], r1 = rows[start], c0 = cols[start], c1 = cols[start];
        for (let i = start + 1; i < end; i++) {
            const r = rows[i], c = cols[i];
            if (r < r0) r0 = r; else if (r > r1) r1 = r;
            if (c < c0) c0 = c; else if (c > c1) c1 = c;
        }
        return { r0, r1, c0, c1 };
    }

    function beyondIsolation(finite, labels, sizes, rows, cols, start, end, width, height, isolationPx, noiseMaxPx) {
        if (isolationPx <= 0) return true;
        const pad = Math.floor(isolationPx);
        if (pad < 1) return true;
        const box = bbox(rows, cols, start, end);
        const top = Math.max(0, box.r0 - pad);
        const bottom = Math.min(height, box.r1 + pad + 1);
        const left = Math.max(0, box.c0 - pad);
        const right = Math.min(width, box.c1 + pad + 1);
        const wh = bottom - top;
        const ww = right - left;
        const own = new Uint8Array(wh * ww);
        for (let i = start; i < end; i++) own[(rows[i] - top) * ww + (cols[i] - left)] = 1;
        const others = new Uint8Array(wh * ww);
        let any = false;
        for (let r = 0; r < wh; r++) {
            const gi = (top + r) * width + left;
            for (let c = 0; c < ww; c++) {
                const li = r * ww + c;
                if (!finite[gi + c] || own[li]) continue;
                if (noiseMaxPx > 0 && sizes && !(sizes[labels[gi + c]] > noiseMaxPx)) continue;
                others[li] = 1;
                any = true;
            }
        }
        if (!any) return true;
        // 積分影像（外加一圈 0）
        const pw = ww + 1;
        const pref = new Int32Array((wh + 1) * pw);
        for (let r = 1; r <= wh; r++) {
            let rowSum = 0;
            for (let c = 1; c <= ww; c++) {
                rowSum += own[(r - 1) * ww + (c - 1)];
                pref[r * pw + c] = pref[(r - 1) * pw + c] + rowSum;
            }
        }
        for (let r = 0; r < wh; r++) {
            for (let c = 0; c < ww; c++) {
                if (!others[r * ww + c]) continue;
                const rlo = Math.max(0, r - pad);
                const rhi = Math.min(wh - 1, r + pad);
                const clo = Math.max(0, c - pad);
                const chi = Math.min(ww - 1, c + pad);
                const nearby = pref[(rhi + 1) * pw + (chi + 1)] - pref[rlo * pw + (chi + 1)]
                    - pref[(rhi + 1) * pw + clo] + pref[rlo * pw + clo];
                if (nearby > 0) return false;
            }
        }
        return true;
    }

    /** 輪廓質心所在像素（質心落在像素間時取最近；同距取列較小再欄較小） */
    function centroidIndex(rows, cols, start, end) {
        let sr = 0, sc = 0;
        const n = end - start;
        for (let i = start; i < end; i++) { sr += rows[i]; sc += cols[i]; }
        const cr = sr / n;
        const cc = sc / n;
        let best = Infinity;
        for (let i = start; i < end; i++) {
            const dr = rows[i] - cr, dc = cols[i] - cc;
            const d = dr * dr + dc * dc;
            if (d < best) best = d;
        }
        for (let i = start; i < end; i++) {
            const dr = rows[i] - cr, dc = cols[i] - cc;
            if (Math.abs(dr * dr + dc * dc - best) <= 1e-9) return i;
        }
        return start;
    }

    function checkSpan(nameKey, low, high) {
        low = Number(low);
        high = Number(high);
        if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high <= 0 || low > high) {
            throw new Error(msg('engSpan', msg(nameKey)));
        }
        return [low, high];
    }

    function checkNonNeg(value, key) {
        value = Number(value);
        if (!Number.isFinite(value) || value < 0) throw new Error(msg(key));
        return value;
    }

    /** 依連通輪廓長寬篩出 Bump；回傳 { mask: Uint8Array, centers: [[row, col], ...] } */
    async function selectBumpContours(ds, params, report) {
        const [lengthMin, lengthMax] = checkSpan('engLength', params.lengthMin, params.lengthMax);
        const [widthMin, widthMax] = checkSpan('engWidth', params.widthMin, params.widthMax);
        const isolationPx = checkNonNeg(params.isolationPx || 0, 'engIsolation');
        const noiseMaxPx = checkNonNeg(params.noiseMaxPx || 0, 'engNoise');
        const zLo = params.zLo;
        const zHi = params.zHi;
        if (zLo != null && zHi != null && zLo > zHi) throw new Error(msg('engRangeOrder'));
        const { data, width, height } = ds;
        await report(0);
        const finite = rangeMask(data, zLo, zHi);
        await report(0.002);
        const { labels, count } = await labelComponents(finite, width, height, sub(report, 0.002, 0.98));
        labels.width = width;
        labels.height = height;
        const mask = new Uint8Array(width * height);
        const empty = { mask, centers: [] };
        const grouped = groupLabels(labels, count);
        if (!grouped) { await report(1); return empty; }
        const { rows, cols, starts, sizes } = grouped;
        const kept = [];
        const stride = Math.max(1, Math.floor(count / 20));
        await report(0.98);
        for (let k = 1; k <= count; k++) {
            if (k % stride === 0) await report(0.98 + 0.02 * (k / count));
            const start = starts[k];
            const end = starts[k + 1];
            const box = bbox(rows, cols, start, end);
            const length = box.r1 - box.r0 + 1;
            const wid = box.c1 - box.c0 + 1;
            if (!fitsRanges(length, wid, lengthMin, lengthMax, widthMin, widthMax)) continue;
            if (!beyondIsolation(finite, labels, noiseMaxPx > 0 ? sizes : null, rows, cols, start, end, width, height, isolationPx, noiseMaxPx)) continue;
            const best = centroidIndex(rows, cols, start, end);
            kept.push([rows[best], cols[best]]);
            for (let i = start; i < end; i++) mask[rows[i] * width + cols[i]] = 1;
        }
        if (!kept.length) { await report(1); return empty; }
        kept.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
        await report(1);
        return { mask, centers: kept };
    }

    function maskRuns(mask, width, height) {
        const runs = [];
        for (let row = 0; row < height; row++) {
            const base = row * width;
            let col = 0;
            while (col < width) {
                if (!mask[base + col]) { col++; continue; }
                const c0 = col;
                while (col < width && mask[base + col]) col++;
                runs.push([row, c0, col - 1]);
            }
        }
        return runs;
    }

    function dilateDisk(local, lw, lh, radius) {
        const out = new Uint8Array(lw * lh);
        if (radius <= 0) return out;
        const reach = Math.ceil(radius - 1e-12);
        const offsets = [];
        const r2 = radius * radius + 1e-9;
        for (let dy = -reach; dy <= reach; dy++) {
            for (let dx = -reach; dx <= reach; dx++) {
                if (dy * dy + dx * dx <= r2) offsets.push([dy, dx]);
            }
        }
        for (let y = 0; y < lh; y++) {
            for (let x = 0; x < lw; x++) {
                if (!local[y * lw + x]) continue;
                for (let k = 0; k < offsets.length; k++) {
                    const ny = y + offsets[k][0];
                    const nx = x + offsets[k][1];
                    if (ny < 0 || ny >= lh || nx < 0 || nx >= lw) continue;
                    out[ny * lw + nx] = 1;
                }
            }
        }
        return out;
    }

    function componentHeightStat(z, width, bump, rows, cols, start, end, r0, c0, lw, lh, ring) {
        const best = centroidIndex(rows, cols, start, end);
        const apexZ = z[rows[best] * width + cols[best]];
        const box = bbox(rows, cols, start, end);
        let holeCount = 0;
        let holeMax = -Infinity;
        for (let r = box.r0; r <= box.r1; r++) {
            for (let c = box.c0; c <= box.c1; c++) {
                const i = r * width + c;
                const v = z[i];
                if (Number.isFinite(v) && !bump[i] && v > apexZ) {
                    holeCount++;
                    if (v > holeMax) holeMax = v;
                }
            }
        }
        const vals = [];
        let sumR = 0, sumC = 0;
        for (let y = 0; y < lh; y++) {
            for (let x = 0; x < lw; x++) {
                if (!ring[y * lw + x]) continue;
                const v = z[(r0 + y) * width + (c0 + x)];
                if (!Number.isFinite(v)) continue;
                vals.push(v);
                sumR += y;
                sumC += x;
            }
        }
        const stat = {
            r: rows[best], c: cols[best], n: end - start, dn: vals.length,
            dm: null, dlo: null, dhi: null, dmin: null, dmax: null, cr: null, cc: null,
            hi: holeCount ? holeMax : null, hn: holeCount,
        };
        if (vals.length) {
            const sorted = Float64Array.from(vals).sort();
            stat.dm = percentileSorted(sorted, 50);
            stat.dlo = percentileSorted(sorted, 10);
            stat.dhi = percentileSorted(sorted, 90);
            stat.dmin = sorted[0];
            stat.dmax = sorted[sorted.length - 1];
            stat.cr = sumR / vals.length + r0;
            stat.cc = sumC / vals.length + c0;
        }
        return stat;
    }

    /** Donut 基底點：回傳 { x, y, z: Float64Array, n } */
    async function extractDonutPoints(ds, mask, donutWidth, dx, dy, report, statsOut) {
        const width = Number(donutWidth);
        if (!Number.isFinite(width) || width <= 0) throw new Error(msg('engDonutWidth'));
        const z = ds.data;
        const W = ds.width;
        const H = ds.height;
        await report(0.02);
        const { labels, count } = await labelComponents(mask, W, H, sub(report, 0.02, 0.16));
        labels.width = W;
        labels.height = H;
        const grouped = groupLabels(labels, count);
        const empty = { x: new Float64Array(0), y: new Float64Array(0), z: new Float64Array(0), n: 0 };
        if (!grouped) { await report(1); return empty; }
        const { rows, cols, starts } = grouped;
        const donut = new Uint8Array(W * H);
        const pad = Math.ceil(width - 1e-12);
        const stride = Math.max(1, Math.floor(count / 80));
        for (let k = 1; k <= count; k++) {
            if (k % stride === 0) await report(0.18 + 0.8 * (k / count));
            const start = starts[k];
            const end = starts[k + 1];
            const box = bbox(rows, cols, start, end);
            const r0 = Math.max(0, box.r0 - pad);
            const r1 = Math.min(H, box.r1 + pad + 1);
            const c0 = Math.max(0, box.c0 - pad);
            const c1 = Math.min(W, box.c1 + pad + 1);
            const lw = c1 - c0;
            const lh = r1 - r0;
            const local = new Uint8Array(lw * lh);
            for (let i = start; i < end; i++) local[(rows[i] - r0) * lw + (cols[i] - c0)] = 1;
            const ring = dilateDisk(local, lw, lh, width);
            for (let y = 0; y < lh; y++) {
                const gi = (r0 + y) * W + c0;
                for (let x = 0; x < lw; x++) {
                    if (mask[gi + x]) ring[y * lw + x] = 0;
                    if (ring[y * lw + x]) donut[gi + x] = 1;
                }
            }
            if (statsOut) statsOut.push(componentHeightStat(z, W, mask, rows, cols, start, end, r0, c0, lw, lh, ring));
        }
        let n = 0;
        for (let i = 0; i < donut.length; i++) if (donut[i] && Number.isFinite(z[i])) n++;
        if (!n) { await report(1); return empty; }
        const xs = new Float64Array(n);
        const ys = new Float64Array(n);
        const zs = new Float64Array(n);
        let j = 0;
        for (let i = 0; i < donut.length; i++) {
            if (!donut[i] || !Number.isFinite(z[i])) continue;
            const row = (i / W) | 0;
            const col = i - row * W;
            xs[j] = col * dx;
            ys[j] = row * dy;
            zs[j] = z[i];
            j++;
        }
        await report(1);
        return { x: xs, y: ys, z: zs, n };
    }

    function apexesFromCenters(ds, centers, dx, dy) {
        const n = centers.length;
        const out = { x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n), n };
        for (let i = 0; i < n; i++) {
            const row = Math.round(centers[i][0]);
            const col = Math.round(centers[i][1]);
            out.x[i] = col * dx;
            out.y[i] = row * dy;
            out.z[i] = ds.data[row * ds.width + col];
        }
        return out;
    }

    /* ---------------- 二次曲面 ---------------- */

    function designRow(x, y, row) {
        row[0] = 1; row[1] = x; row[2] = y; row[3] = x * x; row[4] = x * y; row[5] = y * y;
    }

    function expandCoefficients(a, x0, y0) {
        const out = new Float64Array(6);
        out[3] = a[3];
        out[4] = a[4];
        out[5] = a[5];
        out[1] = a[1] - 2 * a[3] * x0 - a[4] * y0;
        out[2] = a[2] - a[4] * x0 - 2 * a[5] * y0;
        out[0] = a[0] - a[1] * x0 - a[2] * y0 + a[3] * x0 * x0 + a[4] * x0 * y0 + a[5] * y0 * y0;
        return out;
    }

    /** pts: {x,y,z}; idx: 可選的索引陣列（Int32Array）；回傳全域係數，奇異時回傳 null */
    function fitQuadratic(pts, idx) {
        const n = idx ? idx.length : pts.n;
        const pick = (arr) => {
            if (!idx) return arr.subarray(0, pts.n);
            const out = new Float64Array(n);
            for (let i = 0; i < n; i++) out[i] = arr[idx[i]];
            return out;
        };
        const xs = pick(pts.x);
        const ys = pick(pts.y);
        const zs = pick(pts.z);
        const x0 = median(xs);
        const y0 = median(ys);
        const coeff = leastSquares(n, 6, (i, row) => designRow(xs[i] - x0, ys[i] - y0, row), (i) => zs[i]);
        if (!coeff) return null;
        return expandCoefficients(coeff, x0, y0);
    }

    function evalSurfaceAt(c, x, y, slopeScale) {
        const zBase = c[0] + c[1] * x + c[2] * y + c[3] * x * x + c[4] * x * y + c[5] * y * y;
        const dzdx = (c[1] + 2 * c[3] * x + c[4] * y) * slopeScale;
        const dzdy = (c[2] + c[4] * x + 2 * c[5] * y) * slopeScale;
        const cosTheta = 1 / Math.sqrt(1 + dzdx * dzdx + dzdy * dzdy);
        const thetaDeg = Math.acos(Math.max(-1, Math.min(1, cosTheta))) * 180 / Math.PI;
        return [zBase, cosTheta, thetaDeg];
    }

    function sigmaInliers(pts, sigma, rounds = 3) {
        const n = pts.n;
        let mask = new Uint8Array(n).fill(1);
        let maskCount = n;
        const residual = new Float64Array(n);
        for (let round = 0; round < rounds; round++) {
            if (maskCount < 6) break;
            const idx = new Int32Array(maskCount);
            for (let i = 0, j = 0; i < n; i++) if (mask[i]) idx[j++] = i;
            const coeff = fitQuadratic(pts, idx);
            if (!coeff) break;
            const chosen = new Float64Array(maskCount);
            for (let i = 0, j = 0; i < n; i++) {
                const x = pts.x[i], y = pts.y[i];
                const pred = coeff[0] + coeff[1] * x + coeff[2] * y + coeff[3] * x * x + coeff[4] * x * y + coeff[5] * y * y;
                residual[i] = pts.z[i] - pred;
                if (mask[i]) chosen[j++] = residual[i];
            }
            const med = median(chosen);
            for (let i = 0; i < chosen.length; i++) chosen[i] = Math.abs(chosen[i] - med);
            const mad = median(chosen);
            const scale = 1.4826 * mad;
            if (scale <= 1e-12) break;
            const updated = new Uint8Array(n);
            let changed = false;
            let newCount = 0;
            for (let i = 0; i < n; i++) {
                const keep = Math.abs(residual[i]) <= sigma * scale ? 1 : 0;
                updated[i] = keep;
                if (keep) newCount++;
                if (keep !== mask[i]) changed = true;
            }
            if (!changed) break;
            mask = updated;
            maskCount = newCount;
        }
        return mask;
    }

    function mulberry32(seed) {
        let a = seed >>> 0;
        return () => {
            a = (a + 0x6D2B79F5) >>> 0;
            let t0 = Math.imul(a ^ (a >>> 15), 1 | a);
            t0 = (t0 + Math.imul(t0 ^ (t0 >>> 7), 61 | t0)) ^ t0;
            return ((t0 ^ (t0 >>> 14)) >>> 0) / 4294967296;
        };
    }

    async function ransacInliers(pts, threshold, iterations, report) {
        const n = pts.n;
        if (n < 6) throw new Error(msg('engBaseFew'));
        const rng = mulberry32(0);
        let best = null;
        let bestCount = -1;
        iterations = Math.max(1, iterations | 0);
        const step = Math.max(1, Math.floor(iterations / 20));
        const sample = new Int32Array(6);
        for (let it = 0; it < iterations; it++) {
            if (it % step === 0) await report(it / iterations);
            // 不重複抽 6 點
            let filled = 0;
            while (filled < 6) {
                const pick = Math.floor(rng() * n);
                let dup = false;
                for (let k = 0; k < filled; k++) if (sample[k] === pick) { dup = true; break; }
                if (!dup) sample[filled++] = pick;
            }
            const coeff = fitQuadratic(pts, sample);
            if (!coeff) continue;
            const inliers = new Uint8Array(n);
            let count = 0;
            for (let i = 0; i < n; i++) {
                const x = pts.x[i], y = pts.y[i];
                const pred = coeff[0] + coeff[1] * x + coeff[2] * y + coeff[3] * x * x + coeff[4] * x * y + coeff[5] * y * y;
                if (Math.abs(pts.z[i] - pred) <= threshold) { inliers[i] = 1; count++; }
            }
            if (count > bestCount) { best = inliers; bestCount = count; }
        }
        if (!best || bestCount < 6) throw new Error(msg('engRansacFew'));
        await report(1);
        return best;
    }

    function subsetPoints(pts, mask) {
        let n = 0;
        for (let i = 0; i < pts.n; i++) if (mask[i]) n++;
        const out = { x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n), n };
        for (let i = 0, j = 0; i < pts.n; i++) {
            if (!mask[i]) continue;
            out.x[j] = pts.x[i]; out.y[j] = pts.y[i]; out.z[j] = pts.z[i];
            j++;
        }
        return out;
    }

    async function calculateCoplanarity(apexes, base, opts, report) {
        const slopeScale = xySlopeScale(opts.xUnit, opts.yUnit, opts.zUnit);
        await report(0.02);
        if (apexes.n < 3) throw new Error(msg('engApexFew'));
        for (let i = 0; i < apexes.n; i++) {
            if (!Number.isFinite(apexes.x[i]) || !Number.isFinite(apexes.y[i]) || !Number.isFinite(apexes.z[i])) {
                throw new Error(msg('engApexNaN'));
            }
        }
        const finiteMask = new Uint8Array(base.n);
        for (let i = 0; i < base.n; i++) {
            finiteMask[i] = (Number.isFinite(base.x[i]) && Number.isFinite(base.y[i]) && Number.isFinite(base.z[i])) ? 1 : 0;
        }
        base = subsetPoints(base, finiteMask);
        let kept;
        const method = opts.outlierMethod || 'sigma';
        if (method !== 'sigma' && method !== 'ransac' && method !== 'none') throw new Error(msg('engOutlierMethod'));
        if (method === 'none') {
            kept = base;
            await report(0.7);
        } else if (method === 'sigma') {
            if (base.n < 6) throw new Error(msg('engBaseFew'));
            kept = subsetPoints(base, sigmaInliers(base, opts.outlierSigma));
            await report(0.7);
        } else {
            const mask = await ransacInliers(base, opts.ransacThreshold, opts.ransacIterations, sub(report, 0.05, 0.7));
            kept = subsetPoints(base, mask);
        }
        if (kept.n < 6) throw new Error(msg('engBaseFew'));
        await report(0.82);
        const coeffs = fitQuadratic(kept);
        if (!coeffs) throw new Error(msg('engBaseFew'));
        const n = apexes.n;
        const deltaZ = new Float64Array(n);
        const hTrue = new Float64Array(n);
        const tilt = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            const [zb, cosT, deg] = evalSurfaceAt(coeffs, apexes.x[i], apexes.y[i], slopeScale);
            deltaZ[i] = apexes.z[i] - zb;
            hTrue[i] = deltaZ[i] * cosT;
            tilt[i] = deg;
        }
        const plane = leastSquares(n, 3, (i, row) => { row[0] = apexes.x[i]; row[1] = apexes.y[i]; row[2] = 1; }, (i) => hTrue[i]) || new Float64Array(3);
        const residuals = new Float64Array(n);
        let rMin = Infinity, rMax = -Infinity;
        for (let i = 0; i < n; i++) {
            residuals[i] = hTrue[i] - (plane[0] * apexes.x[i] + plane[1] * apexes.y[i] + plane[2]);
            if (residuals[i] < rMin) rMin = residuals[i];
            if (residuals[i] > rMax) rMax = residuals[i];
        }
        await report(1);
        return {
            intrinsicCoplanarity: rMax - rMin,
            trueHeights: hTrue,
            deltaZ,
            tiltAnglesDeg: tilt,
            residuals,
            surfaceCoeffs: coeffs,
            baseInlierCount: kept.n,
            xySlopeScale: slopeScale,
            zUnit: '',
            trace: null,
        };
    }

    /* ---------------- 高度紀錄（height trace） ---------------- */

    const asFloat = (v) => {
        if (v == null || v === '') return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    };
    const num = (v, digits = 6) => {
        const n = asFloat(v);
        return n == null ? null : Number(n.toPrecision(digits));
    };
    const fmt = (v) => {
        const n = asFloat(v);
        return n == null ? '無' : n.toFixed(4);
    };

    function summ(values) {
        const arr = finiteOnly(values);
        if (!arr.length) return { n: 0, min: null, p50: null, p95: null, max: null };
        let sample = arr;
        if (arr.length > 2000000) {
            const step = Math.ceil(arr.length / 2000000);
            const picked = new Float64Array(Math.ceil(arr.length / step));
            for (let i = 0, j = 0; i < arr.length; i += step) picked[j++] = arr[i];
            sample = picked;
        }
        let mn = Infinity, mx = -Infinity;
        for (let i = 0; i < arr.length; i++) { if (arr[i] < mn) mn = arr[i]; if (arr[i] > mx) mx = arr[i]; }
        const sorted = sortedCopy(sample);
        return { n: arr.length, min: num(mn), p50: num(percentileSorted(sorted, 50)), p95: num(percentileSorted(sorted, 95)), max: num(mx) };
    }

    function samplePercentiles(z) {
        const step = Math.max(1, Math.floor(z.length / 2000000));
        const picked = [];
        for (let i = 0; i < z.length; i += step) if (Number.isFinite(z[i])) picked.push(z[i]);
        if (!picked.length) return { p01: null, p50: null, p99: null };
        const sorted = Float64Array.from(picked).sort();
        return { p01: num(percentileSorted(sorted, 1)), p50: num(percentileSorted(sorted, 50)), p99: num(percentileSorted(sorted, 99)) };
    }

    function buildHeightTrace(ds, p, dx, dy, centers, apexes, base, result, componentStats) {
        const z = ds.data;
        const header = ds.header || {};
        let finite = 0, keptCount = 0, below = 0, above = 0;
        let zMin = Infinity, zMax = -Infinity, keptMin = Infinity, keptMax = -Infinity;
        for (let i = 0; i < z.length; i++) {
            const v = z[i];
            if (!Number.isFinite(v)) continue;
            finite++;
            if (v < zMin) zMin = v;
            if (v > zMax) zMax = v;
            let keep = true;
            if (p.zLo != null && v < p.zLo) { keep = false; below++; }
            if (p.zHi != null && v > p.zHi) { keep = false; above++; }
            if (keep) {
                keptCount++;
                if (v < keptMin) keptMin = v;
                if (v > keptMax) keptMax = v;
            }
        }
        const byPixel = new Map();
        for (const item of componentStats) byPixel.set(item.r + ',' + item.c, item);
        const bumps = [];
        let unmatched = 0;
        const coeffs = result.surfaceCoeffs;
        for (let index = 0; index < centers.length; index++) {
            const row = Math.round(centers[index][0]);
            const col = Math.round(centers[index][1]);
            let stat = byPixel.get(row + ',' + col);
            if (!stat) { unmatched++; stat = {}; }
            const apexZ = apexes.z[index];
            const delta = result.deltaZ[index];
            const baseZ = evalSurfaceAt(coeffs, apexes.x[index], apexes.y[index], 1)[0];
            const donutMedian = asFloat(stat.dm);
            const raw = donutMedian == null ? null : apexZ - donutMedian;
            const gap = raw == null ? null : raw - delta;
            let bias = null;
            if (donutMedian != null && stat.cr != null) {
                const ringZ = evalSurfaceAt(coeffs, stat.cc * dx, stat.cr * dy, 1)[0];
                bias = donutMedian - ringZ;
            }
            bumps.push({
                i: index, r: row, c: col, n: stat.n == null ? null : stat.n,
                z: num(apexZ), dz: num(delta), zb: num(baseZ), dm: num(donutMedian),
                dlo: num(stat.dlo), dhi: num(stat.dhi), dmin: num(stat.dmin), dmax: num(stat.dmax),
                dn: stat.dn == null ? null : stat.dn, raw: num(raw), gap: num(gap), bias: num(bias),
                hi: num(stat.hi), hn: stat.hn == null ? null : stat.hn,
            });
        }
        let residual = new Float64Array(0);
        let cond = null, xSpan = null, ySpan = null;
        if (base.n) {
            residual = new Float64Array(base.n);
            let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
            for (let i = 0; i < base.n; i++) {
                residual[i] = base.z[i] - evalSurfaceAt(coeffs, base.x[i], base.y[i], 1)[0];
                if (base.x[i] < xmin) xmin = base.x[i];
                if (base.x[i] > xmax) xmax = base.x[i];
                if (base.y[i] < ymin) ymin = base.y[i];
                if (base.y[i] > ymax) ymax = base.y[i];
            }
            xSpan = xmax - xmin;
            ySpan = ymax - ymin;
            const step = base.n > 200000 ? Math.ceil(base.n / 200000) : 1;
            const cnt = Math.ceil(base.n / step);
            const cx = new Float64Array(cnt), cy = new Float64Array(cnt);
            for (let i = 0, j = 0; i < base.n; i += step) { cx[j] = base.x[i]; cy[j] = base.y[i]; j++; }
            const x0 = median(cx), y0 = median(cy);
            // Gram 矩陣條件數（以特徵值比估計：冪迭代近似，僅供紀錄）
            const G = [];
            for (let i = 0; i < 6; i++) G.push(new Float64Array(6));
            const row = new Float64Array(6);
            for (let i = 0; i < cnt; i++) {
                designRow(cx[i] - x0, cy[i] - y0, row);
                for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) G[r][c] += row[r] * row[c];
            }
            cond = gramCondition(G);
        }
        const gaps = bumps.map((b) => b.gap);
        const raws = bumps.map((b) => b.raw);
        const finiteGaps = gaps.filter((g) => g != null);
        const gapAbsMax = finiteGaps.length ? num(Math.max(...finiteGaps.map(Math.abs))) : null;
        const clipBumps = bumps.filter((b) => b.hi != null && b.z != null && b.hi > b.z);
        const spikeBumps = bumps.filter((b) => b.dmax != null && b.dm != null && b.dmax - b.dm >= 50);
        let apexNear = 0;
        let tolerance = null;
        if (p.zHi != null && bumps.length) {
            tolerance = Math.max(1e-3, 0.001 * Math.abs(p.zHi));
            apexNear = bumps.filter((b) => b.z != null && p.zHi - b.z <= tolerance).length;
        }
        const worstGap = bumps.filter((b) => b.gap != null).sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)).slice(0, 20);
        const worstClip = clipBumps.slice().sort((a, b) => (b.hi - b.z) - (a.hi - a.z)).slice(0, 20);
        const deltaSummary = summ(result.deltaZ);
        const rawSummary = summ(raws.map((v) => (v == null ? NaN : v)));
        const gapSummary = summ(gaps.map((v) => (v == null ? NaN : v)));
        const line = `Bump ${bumps.length} 顆，ΔZ中位 ${fmt(deltaSummary.p50)}，球高中位 ${fmt(rawSummary.p50)}，`
            + `曲面比Donut高的中位差 ${fmt(gapSummary.p50)}，最大絕對差 ${fmt(gapAbsMax)}，`
            + `框內有更高點 ${clipBumps.length} 顆，Donut含尖點 ${spikeBumps.length} 顆`;
        return {
            note: '畫面上的 Denoise 只做高度門檻，不改像素。ΔZ = 頂點Z − 全域曲面在頂點的高度。'
                + '球高 raw = 頂點Z − 該顆 Donut 的中位Z。gap = raw − ΔZ，正值表示曲面高於旁邊 Donut。'
                + 'hi 是這顆輪廓外接框裡、不屬於 Bump、且高於頂點的最大Z，用來看出球頂是否被高度上限切掉。'
                + 'bias = Donut中位 − 曲面在 Donut 重心的高度。階高量測會再寫進 measurements。',
            line,
            load: {
                width: ds.width, height: ds.height,
                x_unit: headerUnit(header, 'xunit', 'x-unit'),
                y_unit: headerUnit(header, 'yunit', 'y-unit'),
                z_unit: headerUnit(header, 'zunit', 'z-unit'),
                dx: num(dx), dy: num(dy), finite,
                z_min: finite ? num(zMin) : null, z_max: finite ? num(zMax) : null,
                ...samplePercentiles(z),
            },
            range: {
                z_lo: num(p.zLo), z_hi: num(p.zHi), kept: keptCount, below_lo: below, above_hi: above,
                kept_min: keptCount ? num(keptMin) : null, kept_max: keptCount ? num(keptMax) : null,
            },
            params: {
                length_min: num(p.lengthMin), length_max: num(p.lengthMax),
                width_min: num(p.widthMin), width_max: num(p.widthMax),
                isolation_px: num(p.isolationPx), noise_max_px: num(p.noiseMaxPx),
                donut_width_px: num(p.donutWidth), outlier_method: p.outlierMethod,
                outlier_sigma: num(p.outlierSigma), unmatched_components: unmatched,
            },
            surface: {
                bump_count: bumps.length, base_points: base.n, base_inliers: result.baseInlierCount,
                xy_slope_scale: num(result.xySlopeScale, 8),
                coeffs: Array.from(result.surfaceCoeffs, (v) => num(v, 8)),
                cond_gram: num(cond), x_span: num(xSpan), y_span: num(ySpan),
                residual: summ(residual), delta_z: deltaSummary, raw: rawSummary, gap: gapSummary,
                ring_bias: summ(bumps.map((b) => (b.bias == null ? NaN : b.bias))),
                gap_abs_max: gapAbsMax, interior_high_bumps: clipBumps.length,
                donut_spike_bumps: spikeBumps.length, apex_near_z_hi: apexNear, apex_near_z_hi_tol: num(tolerance),
            },
            worst_gap: worstGap,
            worst_clip: worstClip,
            bumps,
            measurements: { sets: [] },
        };
    }

    /** 對稱正定矩陣條件數（Jacobi 特徵值） */
    function gramCondition(G) {
        const n = 6;
        const A = G.map((r) => Float64Array.from(r));
        for (let sweep = 0; sweep < 50; sweep++) {
            let off = 0;
            for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p][q] * A[p][q];
            if (off < 1e-20) break;
            for (let p = 0; p < n; p++) {
                for (let q = p + 1; q < n; q++) {
                    if (Math.abs(A[p][q]) < 1e-300) continue;
                    const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
                    const tt = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
                    const c = 1 / Math.sqrt(tt * tt + 1);
                    const s = tt * c;
                    for (let k = 0; k < n; k++) {
                        const akp = A[k][p], akq = A[k][q];
                        A[k][p] = c * akp - s * akq;
                        A[k][q] = s * akp + c * akq;
                    }
                    for (let k = 0; k < n; k++) {
                        const apk = A[p][k], aqk = A[q][k];
                        A[p][k] = c * apk - s * aqk;
                        A[q][k] = s * apk + c * aqk;
                    }
                }
            }
        }
        let mn = Infinity, mx = -Infinity;
        for (let i = 0; i < n; i++) {
            const v = Math.abs(A[i][i]);
            if (v < mn) mn = v;
            if (v > mx) mx = v;
        }
        return mn > 0 ? mx / mn : Infinity;
    }

    function nearestBump(bumps, row, col) {
        let best = null;
        let bestD = null;
        for (const bump of bumps) {
            const d = (bump.r - row) ** 2 + (bump.c - col) ** 2;
            if (bestD == null || d < bestD) { best = bump; bestD = d; }
        }
        if (!best) return [null, null];
        return [best, Math.sqrt(bestD)];
    }

    function measureSentence(step, high, low) {
        const where = (point) => {
            const bump = point.bump;
            let near;
            if (bump == null) near = '無對應Bump';
            else {
                near = `Bump#${bump} 距離${fmt(point.dist_px)}px ΔZ=${fmt(point.delta_z)} 球高=${fmt(point.raw)} `
                    + `曲面減Donut=${fmt(point.gap)} Donut最大=${fmt(point.donut_max)} 框內更高=${fmt(point.interior_high)}`;
            }
            return `(${point.row},${point.col}) Z=${fmt(point.original)} 層=${point.layer || '未知'} ${near}`;
        };
        return `階高 ${fmt(step)} | 高點 ${where(high)} | 低點 ${where(low)}`;
    }

    function applyMeasurementLog(trace, payload) {
        const measures = payload.measures;
        if (!Array.isArray(measures)) throw new Error(msg('engMeasuresArray'));
        const bumps = trace.bumps || [];
        const records = [];
        const lines = [];
        for (const measure of measures) {
            const points = measure && Array.isArray(measure.points) ? measure.points : null;
            if (!points || points.length < 2) continue;
            const recorded = [];
            for (const point of points.slice(0, 2)) {
                if (!point || typeof point !== 'object') throw new Error(msg('engMeasurePoint'));
                const row = Math.trunc(Number(point.row));
                const col = Math.trunc(Number(point.col));
                const [bump, dist] = nearestBump(bumps, row, col);
                const item = {
                    row, col, z: num(point.z), original: num(point.original),
                    layer: String(point.layer || ''), shown: !!point.shown,
                };
                if (bump) {
                    Object.assign(item, {
                        bump: bump.i, dist_px: num(dist), delta_z: bump.dz, raw: bump.raw, gap: bump.gap,
                        apex_z: bump.z, donut_median: bump.dm, donut_max: bump.dmax, z_base: bump.zb, interior_high: bump.hi,
                    });
                }
                recorded.push(item);
            }
            const heights = recorded.map((it) => (it.original != null ? it.original : it.z));
            const step = heights[0] == null || heights[1] == null ? null : Math.abs(heights[0] - heights[1]);
            const rank0 = heights[0] == null ? -1e300 : heights[0];
            const rank1 = heights[1] == null ? -1e300 : heights[1];
            const [high, low] = rank0 >= rank1 ? [recorded[0], recorded[1]] : [recorded[1], recorded[0]];
            records.push({ step: num(step), points: recorded });
            lines.push(measureSentence(step, high, low));
        }
        trace.measurements = {
            z_lo: num(payload.z_lo), z_hi: num(payload.z_hi), donut_width_px: num(payload.donut_width_px),
            layers: payload.layers || {}, line: payload.line || {}, sets: records,
        };
        return lines.join('\n');
    }

    /* ---------------- 共面性流程 ---------------- */

    function progressSplits(foreground) {
        const labelS = foreground * 6e-8 + 0.05;
        const donutS = Math.min(4, 0.4 + 2.2 * Math.sqrt(Math.max(foreground, 1) / 1000000)) * 0.4;
        const total = labelS + donutS + 0.35;
        return [labelS / total, (labelS + donutS) / total];
    }

    async function inspectWafer(ds, p, report) {
        const [xUnit, yUnit, zUnit] = heightmapUnits(ds);
        xySlopeScale(xUnit, yUnit, zUnit);
        let foreground = 0;
        const z = ds.data;
        for (let i = 0; i < z.length; i++) {
            const v = z[i];
            if (!Number.isFinite(v)) continue;
            if (p.zLo != null && v < p.zLo) continue;
            if (p.zHi != null && v > p.zHi) continue;
            foreground++;
        }
        const [labelEnd, donutEnd] = progressSplits(foreground);
        await report(0);
        const { mask, centers } = await selectBumpContours(ds, p, sub(report, 0, labelEnd));
        const [dx, dy] = pixelSpacing(ds.header, ds.width, ds.height);
        const apexes = apexesFromCenters(ds, centers, dx, dy);
        const donutStats = [];
        const base = await extractDonutPoints(ds, mask, p.donutWidth, dx, dy, sub(report, labelEnd, donutEnd), donutStats);
        const result = await calculateCoplanarity(apexes, base, {
            outlierMethod: p.outlierMethod, outlierSigma: p.outlierSigma,
            ransacThreshold: p.ransacThreshold, ransacIterations: p.ransacIterations,
            xUnit, yUnit, zUnit,
        }, sub(report, donutEnd, 1));
        result.zUnit = zUnit;
        result.trace = buildHeightTrace(ds, p, dx, dy, centers, apexes, base, result, donutStats);
        await report(1);
        return { result, centers, dx, dy, apexes };
    }

    /* ---------------- 參數檢查（對應 server.py） ---------------- */

    function requiredFloat(body, key) {
        const value = Number(body[key]);
        if (body[key] == null || body[key] === '' || !Number.isFinite(value)) throw new Error(msg('engMissing', key));
        return value;
    }

    function contourParams(body) {
        const lengthMin = requiredFloat(body, 'length_min');
        const lengthMax = requiredFloat(body, 'length_max');
        const widthMin = requiredFloat(body, 'width_min');
        const widthMax = requiredFloat(body, 'width_max');
        if (Math.min(lengthMin, lengthMax, widthMin, widthMax) <= 0 || lengthMin > lengthMax || widthMin > widthMax) {
            throw new Error(msg('engContourRange'));
        }
        const optionalNonNeg = (key, errKey) => {
            const raw = body[key];
            if (raw == null || raw === '') return 0;
            const v = Number(raw);
            if (!Number.isFinite(v) || v < 0) throw new Error(msg(errKey));
            return v;
        };
        const optional = (key) => {
            const raw = body[key];
            if (raw == null || raw === '') return null;
            const v = Number(raw);
            if (!Number.isFinite(v)) throw new Error(msg('engFinite', key));
            return v;
        };
        return {
            lengthMin, lengthMax, widthMin, widthMax,
            isolationPx: optionalNonNeg('isolation_px', 'engIsolation'),
            noiseMaxPx: optionalNonNeg('noise_max_px', 'engNoise'),
            zLo: optional('z_lo'),
            zHi: optional('z_hi'),
        };
    }

    function getSession(id) {
        const ds = sessions.get(String(id || ''));
        if (!ds) throw new Error(msg('engNoSession'));
        return ds;
    }

    function centerList(ds, centers) {
        return centers.map(([row, col]) => {
            const r = Math.round(row);
            const c = Math.round(col);
            const v = ds.data[r * ds.width + c];
            return { row: r, col: c, z: Number.isFinite(v) ? v : null };
        });
    }

    function bumpSeries(trace, key, count) {
        const series = new Array(count).fill(null);
        for (const item of (trace && trace.bumps) || []) {
            const index = item.i;
            if (!Number.isInteger(index) || index < 0 || index >= count) continue;
            series[index] = asFloat(item[key]);
        }
        return series;
    }

    /* ---------------- 疊圖分析（overlay_engine.py） ---------------- */

    function oriented(ds, mirror) {
        const { width, height } = ds;
        const src = ds.data;
        if (!mirror) return src;
        const out = new Float32Array(src.length);
        for (let y = 0; y < height; y++) {
            const row = y * width;
            for (let x = 0; x < width; x++) out[row + x] = src[row + (width - 1 - x)];
        }
        return out;
    }

    function validMask(z) {
        const out = new Uint8Array(z.length);
        let n = 0;
        for (let i = 0; i < z.length; i++) if (Number.isFinite(z[i])) { out[i] = 1; n++; }
        out.count = n;
        return out;
    }

    /** 4 連通圓盤：回傳 { pts: [[x, y], ...], zvals: Float64Array } */
    async function ovComponents(z, valid, width, height, report) {
        let parent = new Int32Array(1 << 12);
        let labelCount = 0;
        const find = (i) => {
            while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
            return i;
        };
        const union = (a, b) => {
            const ra = find(a), rb = find(b);
            if (ra !== rb) parent[rb] = ra;
            return find(a);
        };
        const newLabel = () => {
            if (labelCount >= parent.length) {
                const grown = new Int32Array(parent.length * 2);
                grown.set(parent);
                parent = grown;
            }
            parent[labelCount] = labelCount;
            return labelCount++;
        };
        // runs: y, start, end, label
        let runs = new Int32Array(4096 * 4);
        let runCount = 0;
        const pushRun = (y, s, e, l) => {
            if ((runCount + 1) * 4 > runs.length) {
                const grown = new Int32Array(runs.length * 2);
                grown.set(runs);
                runs = grown;
            }
            const o = runCount * 4;
            runs[o] = y; runs[o + 1] = s; runs[o + 2] = e; runs[o + 3] = l;
            runCount++;
        };
        let prev = [];
        const stride = Math.max(1, Math.floor(height / 40));
        for (let y = 0; y < height; y++) {
            if (y % stride === 0) await report(y / height);
            const base = y * width;
            const curr = [];
            let x = 0;
            let j = 0;
            const nprev = prev.length;
            while (x < width) {
                if (!valid[base + x]) { x++; continue; }
                const start = x;
                while (x < width && valid[base + x]) x++;
                const end = x - 1;
                while (j < nprev && prev[j][1] < start - 1) j++;
                let k = j;
                let label = -1;
                while (k < nprev && prev[k][0] <= end + 1) {
                    const other = prev[k][2];
                    label = label < 0 ? other : union(label, other);
                    k++;
                }
                if (label < 0) label = newLabel();
                curr.push([start, end, label]);
                pushRun(y, start, end, label);
            }
            prev = curr;
        }
        const acc = new Map();
        for (let i = 0; i < runCount; i++) {
            const o = i * 4;
            const y = runs[o], start = runs[o + 1], end = runs[o + 2];
            const root = find(runs[o + 3]);
            let bucket = acc.get(root);
            if (!bucket) { bucket = [0, 0, 0, 0]; acc.set(root, bucket); }
            const count = end - start + 1;
            let sum = 0;
            const base = y * width;
            for (let x = start; x <= end; x++) {
                const v = z[base + x];
                if (Number.isFinite(v)) sum += v;
            }
            bucket[0] += (start + end) * 0.5 * count;
            bucket[1] += y * count;
            bucket[2] += count;
            bucket[3] += sum;
        }
        if (!acc.size) return { pts: [], zvals: new Float64Array(0) };
        const buckets = Array.from(acc.values());
        const areas = Float64Array.from(buckets, (b) => b[2]);
        const minArea = Math.max(8, median(areas) * 0.4);
        const pts = [];
        const zvals = [];
        for (const b of buckets) {
            if (b[2] < minArea || b[2] <= 0) continue;
            pts.push([b[0] / b[2], b[1] / b[2]]);
            zvals.push(b[3] / b[2]);
        }
        return { pts, zvals: Float64Array.from(zvals) };
    }

    function linspaceInt(a, b, num) {
        const out = [];
        if (num <= 0) return out;
        if (num === 1) { out.push(Math.trunc(a)); return out; }
        for (let i = 0; i < num; i++) out.push(Math.trunc(a + (b - a) * i / (num - 1)));
        return out;
    }

    function lattice(valid, width, height) {
        const runs = [];
        for (const y of linspaceInt(height * 0.25, height * 0.75, Math.min(80, height))) {
            const base = y * width;
            let x = 0;
            let count = 0;
            while (x < width) {
                if (!valid[base + x]) { x++; continue; }
                const start = x;
                while (x < width && valid[base + x]) x++;
                const len = x - start;
                count += len;
                if (len >= 2) runs.push(len);
            }
            if (count < 2) continue;
        }
        const diameter = runs.length ? percentileSorted(Float64Array.from(runs).sort(), 95) : 5;
        const b0 = Math.floor(height / 3);
        const b1 = Math.floor(2 * height / 3);
        if (b1 <= b0 || width === 0) return [Math.max(diameter * 2, 6), diameter];
        const profile = new Float64Array(width);
        for (let y = b0; y < b1; y++) {
            const base = y * width;
            for (let x = 0; x < width; x++) profile[x] += valid[base + x];
        }
        let mean = 0;
        for (let x = 0; x < width; x++) { profile[x] /= (b1 - b0); mean += profile[x]; }
        mean /= width;
        for (let x = 0; x < width; x++) profile[x] -= mean;
        const lo = Math.max(3, Math.trunc(diameter * 0.8));
        const hi = Math.min(width - 2, Math.max(lo + 2, Math.trunc(diameter * 6)));
        if (hi <= lo) return [Math.max(diameter * 2, 6), diameter];
        let bestLag = -1;
        let bestVal = -Infinity;
        for (let lag = lo; lag < hi; lag++) {
            let s = 0;
            for (let x = 0; x + lag < width; x++) s += profile[x] * profile[x + lag];
            if (s > bestVal) { bestVal = s; bestLag = lag; }
        }
        if (bestLag < 0 || !(bestVal > 0)) return [Math.max(diameter * 2, 6), diameter];
        return [Math.max(bestLag, diameter + 1), diameter];
    }

    /** 切比雪夫半徑 r 的膨脹（分離式 1D 最大濾波） */
    function dilateBox(mask, width, height, radius) {
        const tmp = new Uint8Array(mask.length);
        // 水平
        for (let y = 0; y < height; y++) {
            const base = y * width;
            let run = -1; // 最近一次 1 的位置
            for (let x = 0; x < width; x++) {
                if (mask[base + x]) run = x;
                if (run >= 0 && x - run <= radius) tmp[base + x] = 1;
            }
            run = -1;
            for (let x = width - 1; x >= 0; x--) {
                if (mask[base + x]) run = x;
                if (run >= 0 && run - x <= radius) tmp[base + x] = 1;
            }
        }
        const out = new Uint8Array(mask.length);
        for (let x = 0; x < width; x++) {
            let run = -1;
            for (let y = 0; y < height; y++) {
                if (tmp[y * width + x]) run = y;
                if (run >= 0 && y - run <= radius) out[y * width + x] = 1;
            }
            run = -1;
            for (let y = height - 1; y >= 0; y--) {
                if (tmp[y * width + x]) run = y;
                if (run >= 0 && run - y <= radius) out[y * width + x] = 1;
            }
        }
        return out;
    }

    function enclosedVoids(empty, width, height) {
        const seen = new Uint8Array(empty.length);
        const queue = new Int32Array(empty.length);
        let head = 0, tail = 0;
        const push = (i) => { if (empty[i] && !seen[i]) { seen[i] = 1; queue[tail++] = i; } };
        for (let x = 0; x < width; x++) { push(x); push((height - 1) * width + x); }
        for (let y = 0; y < height; y++) { push(y * width); push(y * width + width - 1); }
        while (head < tail) {
            const i = queue[head++];
            const y = (i / width) | 0;
            const x = i - y * width;
            if (y + 1 < height) push(i + width);
            if (y > 0) push(i - width);
            if (x + 1 < width) push(i + 1);
            if (x > 0) push(i - 1);
        }
        const out = new Uint8Array(empty.length);
        for (let i = 0; i < empty.length; i++) out[i] = empty[i] && !seen[i] ? 1 : 0;
        return out;
    }

    function componentsOf(mask, width, height) {
        const seen = new Uint8Array(mask.length);
        const comps = [];
        const queue = new Int32Array(mask.length);
        for (let i0 = 0; i0 < mask.length; i0++) {
            if (!mask[i0] || seen[i0]) continue;
            let head = 0, tail = 0;
            queue[tail++] = i0;
            seen[i0] = 1;
            const cells = [];
            while (head < tail) {
                const i = queue[head++];
                const y = (i / width) | 0;
                const x = i - y * width;
                cells.push([y, x]);
                const tryPush = (j) => { if (mask[j] && !seen[j]) { seen[j] = 1; queue[tail++] = j; } };
                if (y + 1 < height) tryPush(i + width);
                if (y > 0) tryPush(i - width);
                if (x + 1 < width) tryPush(i + 1);
                if (x > 0) tryPush(i - 1);
            }
            comps.push(cells);
        }
        return comps;
    }

    function chamfer(valid, width, height, x0, x1, y0, y1) {
        const w = x1 - x0;
        const h = y1 - y0;
        const inf = 1e6;
        const dist = new Float64Array(w * h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) dist[y * w + x] = valid[(y0 + y) * width + (x0 + x)] ? 0 : inf;
        }
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let v = dist[y * w + x];
                if (x) v = Math.min(v, dist[y * w + x - 1] + 3);
                if (y) {
                    v = Math.min(v, dist[(y - 1) * w + x] + 3);
                    if (x) v = Math.min(v, dist[(y - 1) * w + x - 1] + 4);
                    if (x + 1 < w) v = Math.min(v, dist[(y - 1) * w + x + 1] + 4);
                }
                dist[y * w + x] = v;
            }
        }
        for (let y = h - 1; y >= 0; y--) {
            for (let x = w - 1; x >= 0; x--) {
                let v = dist[y * w + x];
                if (x + 1 < w) v = Math.min(v, dist[y * w + x + 1] + 3);
                if (y + 1 < h) {
                    v = Math.min(v, dist[(y + 1) * w + x] + 3);
                    if (x + 1 < w) v = Math.min(v, dist[(y + 1) * w + x + 1] + 4);
                    if (x) v = Math.min(v, dist[(y + 1) * w + x - 1] + 4);
                }
                dist[y * w + x] = v;
            }
        }
        let peak = 0;
        for (let i = 1; i < dist.length; i++) if (dist[i] > dist[peak]) peak = i;
        const row = (peak / w) | 0;
        const col = peak - row * w;
        return [x0 + col, y0 + row, dist[peak] / 3];
    }

    function refinePeak(valid, width, height, x, y, pitch) {
        const half = Math.trunc(Math.max(pitch * 3, 24));
        const x0 = Math.max(0, Math.trunc(x) - half);
        const x1 = Math.min(width, Math.trunc(x) + half);
        const y0 = Math.max(0, Math.trunc(y) - half);
        const y1 = Math.min(height, Math.trunc(y) + half);
        if (x1 <= x0 || y1 <= y0) return [x, y, 0];
        return chamfer(valid, width, height, x0, x1, y0, y1);
    }

    function minHoleCells(pitch, stride) {
        const radius = 0.9 * pitch;
        return Math.max(4, Math.trunc(Math.PI * radius * radius / (stride * stride) * 0.25));
    }

    function holes(valid, width, height, pitch, diameter) {
        const street = (pitch * 0.5) * Math.SQRT2 - diameter * 0.5;
        const closeRadius = Math.max(1, Math.ceil(street) + 1);
        const closed = dilateBox(valid, width, height, closeRadius);
        const longest = Math.max(height, width);
        const stride = longest <= 700 ? 1 : longest <= 2400 ? 4 : 8;
        const sh = Math.floor(height / stride);
        const sw = Math.floor(width / stride);
        if (sh < 8 || sw < 8) return [];
        const coarse = new Uint8Array(sh * sw);
        for (let y = 0; y < sh * stride; y++) {
            const cy = (y / stride) | 0;
            const base = y * width;
            for (let x = 0; x < sw * stride; x++) {
                if (closed[base + x]) coarse[cy * sw + ((x / stride) | 0)] = 1;
            }
        }
        const empty = new Uint8Array(coarse.length);
        for (let i = 0; i < coarse.length; i++) empty[i] = coarse[i] ? 0 : 1;
        const voids = enclosedVoids(empty, sw, sh);
        const minArea = minHoleCells(pitch, stride);
        const picked = [];
        for (const cells of componentsOf(voids, sw, sh)) {
            if (cells.length < minArea) continue;
            let my = 0, mx = 0;
            for (const [cy, cx] of cells) { my += cy; mx += cx; }
            my /= cells.length;
            mx /= cells.length;
            const [fx, fy, fr] = refinePeak(valid, width, height, mx * stride + stride / 2, my * stride + stride / 2, pitch);
            if (fr < Math.max(pitch * 0.95, closeRadius + 2)) continue;
            if (picked.some(([px, py]) => Math.hypot(fx - px, fy - py) < pitch * 0.8)) continue;
            picked.push([fx, fy, fr]);
        }
        return picked;
    }

    const largestThree = (hs) => hs.slice().sort((a, b) => b[2] - a[2]).slice(0, 3);

    function clockOrder(points) {
        let cx = 0, cy = 0;
        for (const p of points) { cx += p[0]; cy += p[1]; }
        cx /= points.length;
        cy /= points.length;
        return points.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
    }

    const toMm = (points, dx, dy) => points.map((p) => [p[0] * dx, p[1] * dy]);

    /** 2D Kabsch（純旋轉 + 平移，不含鏡像/縮放） */
    function kabsch(target, source) {
        const n = target.length;
        let tx = 0, ty = 0, sx = 0, sy = 0;
        for (let i = 0; i < n; i++) { tx += target[i][0]; ty += target[i][1]; sx += source[i][0]; sy += source[i][1]; }
        tx /= n; ty /= n; sx /= n; sy /= n;
        let a = 0, b = 0;
        for (let i = 0; i < n; i++) {
            const px = source[i][0] - sx, py = source[i][1] - sy;
            const qx = target[i][0] - tx, qy = target[i][1] - ty;
            a += px * qx + py * qy;
            b += px * qy - py * qx;
        }
        const theta = Math.atan2(b, a);
        const c = Math.cos(theta), s = Math.sin(theta);
        const matrix = [[c, -s], [s, c]];
        const shift = [tx - (c * sx - s * sy), ty - (s * sx + c * sy)];
        return [matrix, shift];
    }

    function mapBackToFrontPx(points, matrix, tMm, dxF, dyF, dxB, dyB) {
        const out = new Array(points.length);
        for (let i = 0; i < points.length; i++) {
            const mx = points[i][0] * dxB;
            const my = points[i][1] * dyB;
            const x = matrix[0][0] * mx + matrix[0][1] * my + tMm[0];
            const y = matrix[1][0] * mx + matrix[1][1] * my + tMm[1];
            out[i] = [x / dxF, y / dyF];
        }
        return out;
    }

    function binPoints(points, cell) {
        const bins = new Map();
        for (let i = 0; i < points.length; i++) {
            const key = Math.floor(points[i][0] / cell) + ',' + Math.floor(points[i][1] / cell);
            let list = bins.get(key);
            if (!list) { list = []; bins.set(key, list); }
            list.push(i);
        }
        return bins;
    }

    function nearestInBins(frontPts, bins, cell, x, y) {
        const ix = Math.floor(x / cell), iy = Math.floor(y / cell);
        let best = 1e24;
        let bestJ = -1;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const list = bins.get((ix + dx) + ',' + (iy + dy));
                if (!list) continue;
                for (const other of list) {
                    const d = (frontPts[other][0] - x) ** 2 + (frontPts[other][1] - y) ** 2;
                    if (d < best) { best = d; bestJ = other; }
                }
            }
        }
        return [best, bestJ];
    }

    function overlapFraction(frontPts, backPts, matrix, tMm, dxF, dyF, dxB, dyB, pitch) {
        const mapped = mapBackToFrontPx(backPts, matrix, tMm, dxF, dyF, dxB, dyB);
        const limit = Math.max(8, 0.3 * pitch);
        const bins = binPoints(frontPts, 40);
        let hit = 0;
        for (const [x, y] of mapped) {
            const [d2] = nearestInBins(frontPts, bins, 40, x, y);
            if (Math.sqrt(d2) <= limit) hit++;
        }
        return mapped.length ? hit / mapped.length : 0;
    }

    function bestAlignment(frontPts, backPts, frontHoles, backHoles, dxF, dyF, dxB, dyB, pitch) {
        const frontOrd = clockOrder(frontHoles.map((h) => [h[0], h[1]]));
        const backOrd = clockOrder(backHoles.map((h) => [h[0], h[1]]));
        const frontMm = toMm(frontOrd, dxF, dyF);
        const backMm = toMm(backOrd, dxB, dyB);
        let best = null;
        for (let shift = 0; shift < 3; shift++) {
            const ordered = [0, 1, 2].map((i) => backMm[(i + shift) % 3]);
            const [matrix, tMm] = kabsch(frontMm, ordered);
            let errSum = 0;
            for (let i = 0; i < 3; i++) {
                const x = matrix[0][0] * ordered[i][0] + matrix[0][1] * ordered[i][1] + tMm[0];
                const y = matrix[1][0] * ordered[i][0] + matrix[1][1] * ordered[i][1] + tMm[1];
                errSum += Math.hypot(x - frontMm[i][0], y - frontMm[i][1]);
            }
            const holeErrPx = (errSum / 3) / Math.max(dxF, 1e-9);
            const fraction = overlapFraction(frontPts, backPts, matrix, tMm, dxF, dyF, dxB, dyB, pitch);
            const angle = Math.atan2(matrix[1][0], matrix[0][0]) * 180 / Math.PI;
            const rank = [fraction, -Math.abs(angle)];
            const better = !best || rank[0] > best.rank[0] || (rank[0] === best.rank[0] && rank[1] > best.rank[1]);
            if (better) {
                best = { rank, matrix, t_mm: tMm, rotation_deg: angle, hole_residual_px: holeErrPx, match_fraction: fraction };
            }
        }
        if (best.match_fraction < 0.45) throw new Error(msg('engOverlayLowMatch'));
        return best;
    }

    function pairUnique(frontPts, backPts, frontZ, backZ, matrix, tMm, dxF, dyF, dxB, dyB, threshold) {
        const mapped = mapBackToFrontPx(backPts, matrix, tMm, dxF, dyF, dxB, dyB);
        const cell = Math.max(threshold, 1);
        const bins = binPoints(frontPts, cell);
        const pairs = [];
        for (let i = 0; i < mapped.length; i++) {
            const [d2, j] = nearestInBins(frontPts, bins, cell, mapped[i][0], mapped[i][1]);
            if (j >= 0) pairs.push([Math.sqrt(d2), i, j]);
        }
        pairs.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]));
        const usedF = new Set();
        const usedB = new Set();
        const kept = [];
        const dists = [];
        for (const [dist, backIndex, frontIndex] of pairs) {
            if (dist > threshold || usedF.has(frontIndex) || usedB.has(backIndex)) continue;
            usedF.add(frontIndex);
            usedB.add(backIndex);
            const zf = frontZ[frontIndex];
            const zb = backZ[backIndex];
            kept.push([frontPts[frontIndex][0], frontPts[frontIndex][1], zf, zb, zf + zb]);
            dists.push(dist);
        }
        return { pairs: kept, frontOnly: frontPts.length - usedF.size, backOnly: backPts.length - usedB.size, dists };
    }

    function stat(values, fn) {
        if (!values.length) return null;
        return fn(values);
    }

    async function analyzeOverlay(front, back, mirrorFront, mirrorBack, report) {
        await report(0.02);
        const frontZ = oriented(front, mirrorFront);
        const backZ = oriented(back, mirrorBack);
        const frontValid = validMask(frontZ);
        const backValid = validMask(backZ);
        if (frontValid.count < 20 || backValid.count < 20) throw new Error(msg('engOverlayFewPixels'));
        await report(0.08);
        const fc = await ovComponents(frontZ, frontValid, front.width, front.height, sub(report, 0.08, 0.24));
        await report(0.26);
        const bc = await ovComponents(backZ, backValid, back.width, back.height, sub(report, 0.26, 0.42));
        if (fc.pts.length < 3 || bc.pts.length < 3) throw new Error(msg('engOverlayFewBumps'));
        const [pitch, diameter] = lattice(frontValid, front.width, front.height);
        await report(0.46);
        let frontHoles = holes(frontValid, front.width, front.height, pitch, diameter);
        await report(0.54);
        let backHoles = holes(backValid, back.width, back.height, pitch, diameter);
        await report(0.62);
        if (frontHoles.length < 3 || backHoles.length < 3) throw new Error(msg('engOverlayNoHoles'));
        frontHoles = largestThree(frontHoles);
        backHoles = largestThree(backHoles);
        const [dxF, dyF] = pixelSpacing(front.header, front.width, front.height);
        const [dxB, dyB] = pixelSpacing(back.header, back.width, back.height);
        const choice = bestAlignment(fc.pts, bc.pts, frontHoles, backHoles, dxF, dyF, dxB, dyB, pitch);
        await report(0.78);
        const threshold = Math.max(8, 0.3 * pitch);
        const paired = pairUnique(fc.pts, bc.pts, fc.zvals, bc.zvals, choice.matrix, choice.t_mm, dxF, dyF, dxB, dyB, threshold);
        const sums = Float64Array.from(paired.pairs, (p) => p[4]).sort();
        const dists = Float64Array.from(paired.dists).sort();
        await report(1);
        const zUnit = headerUnit(front.header, 'zunit', 'z-unit') || headerUnit(back.header, 'zunit', 'z-unit') || '';
        return {
            width: front.width,
            height: front.height,
            back_width: back.width,
            back_height: back.height,
            dx_front: dxF,
            dy_front: dyF,
            dx_back: dxB,
            dy_back: dyB,
            z_unit: zUnit,
            rotation_deg: choice.rotation_deg,
            matrix: choice.matrix,
            t_mm: choice.t_mm,
            hole_residual_px: choice.hole_residual_px,
            match_fraction: choice.match_fraction,
            pitch_px: pitch,
            disk_diameter_px: diameter,
            pair_threshold_px: threshold,
            front_count: fc.pts.length,
            back_count: bc.pts.length,
            paired_count: paired.pairs.length,
            front_only_count: paired.frontOnly,
            back_only_count: paired.backOnly,
            pair_dist_median_px: dists.length ? percentileSorted(dists, 50) : null,
            pair_dist_max_px: dists.length ? dists[dists.length - 1] : null,
            sum_median: stat(sums, (v) => percentileSorted(v, 50)),
            sum_p05: stat(sums, (v) => percentileSorted(v, 5)),
            sum_p95: stat(sums, (v) => percentileSorted(v, 95)),
            sum_min: stat(sums, (v) => v[0]),
            sum_max: stat(sums, (v) => v[v.length - 1]),
            holes_front: frontHoles.map((h) => [h[0], h[1]]),
            holes_back: backHoles.map((h) => [h[0], h[1]]),
            pairs: paired.pairs,
        };
    }

    /* ---------------- 對外 API（與 BumpCop Api 相同介面） ---------------- */

    async function upload(dataset, onProgress) {
        if (!dataset || !dataset.data || !dataset.width || !dataset.height) throw new Error(msg('engNoFile'));
        const id = 'bc' + (nextSession++);
        sessions.set(id, dataset);
        let zMin = Infinity, zMax = -Infinity;
        const z = dataset.data;
        for (let i = 0; i < z.length; i++) {
            const v = z[i];
            if (!Number.isFinite(v)) continue;
            if (v < zMin) zMin = v;
            if (v > zMax) zMax = v;
        }
        if (typeof onProgress === 'function') await onProgress(1);
        return {
            session_id: id,
            width: dataset.width,
            height: dataset.height,
            header: dataset.header || {},
            z_min: Number.isFinite(zMin) ? zMin : 0,
            z_max: Number.isFinite(zMax) ? zMax : 0,
            name: dataset.name || dataset.filename || '',
        };
    }

    function release(sessionId) {
        sessions.delete(String(sessionId || ''));
        traces.delete(String(sessionId || ''));
    }

    async function bumps(body, onProgress) {
        const ds = getSession(body.session_id);
        const p = contourParams(body);
        const report = makeReporter(onProgress);
        await report(0.01);
        const { mask, centers } = await selectBumpContours(ds, p, sub(report, 0.02, 0.92));
        await report(0.94);
        const runs = maskRuns(mask, ds.width, ds.height);
        await report(0.99);
        const payload = { count: centers.length, centers: centerList(ds, centers), runs, progress: 1 };
        await report(1);
        return payload;
    }

    async function coplanarity(body, onProgress) {
        const ds = getSession(body.session_id);
        const p = contourParams(body);
        p.donutWidth = requiredFloat(body, 'donut_width_px');
        p.outlierMethod = String(body.outlier_method || 'sigma');
        p.outlierSigma = Number(body.outlier_sigma) || 3;
        p.ransacThreshold = Number(body.ransac_threshold) || 0.5;
        p.ransacIterations = parseInt(body.ransac_iterations, 10) || 200;
        const report = makeReporter(onProgress);
        const { result, centers, apexes } = await inspectWafer(ds, p, sub(report, 0, 0.99));
        const trace = result.trace || {};
        traces.set(String(body.session_id), trace);
        if (trace.line) console.info('[height] ' + trace.line);
        const n = centers.length;
        let meanH = 0;
        let maxTilt = -Infinity;
        for (let i = 0; i < n; i++) {
            meanH += result.trueHeights[i];
            if (result.tiltAnglesDeg[i] > maxTilt) maxTilt = result.tiltAnglesDeg[i];
        }
        meanH = n ? meanH / n : 0;
        const apexRows = [];
        for (let i = 0; i < apexes.n; i++) apexRows.push([apexes.x[i], apexes.y[i], apexes.z[i]]);
        const payload = {
            intrinsic_coplanarity: result.intrinsicCoplanarity,
            z_unit: result.zUnit,
            base_inlier_count: result.baseInlierCount,
            bump_count: n,
            mean_true_height: meanH,
            max_tilt_deg: Number.isFinite(maxTilt) ? maxTilt : 0,
            true_heights: Array.from(result.trueHeights),
            delta_z: Array.from(result.deltaZ),
            donut_median: bumpSeries(trace, 'dm', n),
            raw_step: bumpSeries(trace, 'raw', n),
            step_gap: bumpSeries(trace, 'gap', n),
            tilt_angles_deg: Array.from(result.tiltAnglesDeg),
            residuals: Array.from(result.residuals),
            centers: centerList(ds, centers),
            apexes: apexRows,
            height_trace: { file: '', line: trace.line || '' },
            progress: 1,
        };
        await report(1);
        return payload;
    }

    async function overlay(body, onProgress) {
        const front = getSession(body.front_session_id);
        const back = getSession(body.back_session_id);
        if (String(body.front_session_id) === String(body.back_session_id)) throw new Error(msg('engOverlaySame'));
        const report = makeReporter(onProgress);
        const payload = await analyzeOverlay(front, back, !!body.mirror_front, !!body.mirror_back, report);
        payload.progress = 1;
        return payload;
    }

    async function heightTrace(body) {
        const trace = traces.get(String(body.session_id || ''));
        if (!trace) throw new Error(msg('engNoTrace'));
        const line = applyMeasurementLog(trace, body);
        if (line) console.info('[height] ' + line.replace(/\n/g, ' | '));
        return { line };
    }

    return {
        upload,
        release,
        bumps,
        coplanarity,
        overlay,
        heightTrace,
        pixelSpacing,
        getSession: (id) => sessions.get(String(id || '')) || null,
    };
})();
