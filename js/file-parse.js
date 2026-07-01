/**
 * 檔案解析 (BCRF/ASC 等)
 * 依賴：i18n.js, prefs.js
 * 匯出（全域）：parseFileToDataset() 等讀檔函式
 */
/* =========================================================================
 *  1. 檔案解析 (對應 wr_file.py 中的 read_bcrf_file_thread / read_asc_file_thread)
 * ========================================================================= */

/** 解析 BCRF 格式：header 2048 bytes + float32 little-endian 資料 */
async function readBcrf(file, onProgress) {
    const HEADER_SIZE = 2048;

    // 讀取整個檔案
    const buffer = await file.arrayBuffer();
    const totalBytes = buffer.byteLength;

    // 解析 header
    const headerBytes = new Uint8Array(buffer, 0, HEADER_SIZE);
    const decoder = new TextDecoder('utf-8', { fatal: false });
    let headerText = decoder.decode(headerBytes);
    headerText = headerText.replace(/\x00/g, '');

    const headerDict = {};
    for (const line of headerText.split('\n')) {
        const idx = line.indexOf('=');
        if (idx >= 0) {
            const key = line.slice(0, idx).trim();
            const value = line.slice(idx + 1).trim();
            if (key) headerDict[key] = value;
        }
    }

    // 補齊預設值 + 去掉單位中的方括號
    if (!headerDict.xunit) headerDict.xunit = 'nm';
    if (!headerDict.yunit) headerDict.yunit = 'nm';
    for (const k of ['zunit', 'xunit', 'yunit']) {
        if (headerDict[k]) headerDict[k] = headerDict[k].replace(/[\[\]]/g, '');
    }

    const xPixels = parseInt(parseFloat(headerDict.xpixels));
    const yPixels = parseInt(parseFloat(headerDict.ypixels));
    if (!xPixels || !yPixels) {
        throw new Error(t('errBcrfNoHeader'));
    }

    const expectedDataSize = xPixels * yPixels * 4;
    let dataStart = HEADER_SIZE;
    let dataBytes = totalBytes - dataStart;

    // 對應 bytes_to_float 的 '%' padding 過濾行為：
    // 若實際資料長度 > 預期，取最後 N bytes；否則若開頭有 '%' padding，跳過
    if (dataBytes > expectedDataSize) {
        dataStart = totalBytes - expectedDataSize;
        dataBytes = expectedDataSize;
    } else {
        // 嘗試過濾開頭連續的 '%' (0x25) 或 NULL (0x00)
        const bytes = new Uint8Array(buffer, HEADER_SIZE);
        if (bytes.length > 0 && bytes[0] === 0x25) {
            let pos = -1;
            for (let i = 0; i < bytes.length; i++) {
                const b = bytes[i];
                if (b === 0x25 || b === 0x00) {
                    if (b === 0x00 && i > 0 && bytes[i - 1] === 0x00) break;
                    if (i >= 2 && bytes[i - 2] === 0x25 && bytes[i - 1] === 0x25 && bytes[i] === 0x00) break;
                    pos = i;
                } else {
                    break;
                }
            }
            dataStart = HEADER_SIZE + pos + 1;
            dataBytes = totalBytes - dataStart;
        }
    }

    if (onProgress) onProgress(0.3);

    // 轉成 Float32Array
    const floatCount = Math.floor(dataBytes / 4);
    let float32;
    if ((dataStart % 4) === 0) {
        float32 = new Float32Array(buffer, dataStart, floatCount);
    } else {
        // 若位址未對齊，需要 copy 一份
        const aligned = buffer.slice(dataStart, dataStart + floatCount * 4);
        float32 = new Float32Array(aligned);
    }

    if (onProgress) onProgress(0.7);

    // 若長度不足，補 0；若多餘，截斷
    const expectedCount = xPixels * yPixels;
    let data;
    if (float32.length === expectedCount) {
        data = float32;
    } else if (float32.length > expectedCount) {
        data = float32.subarray(float32.length - expectedCount);
    } else {
        data = new Float32Array(expectedCount);
        data.set(float32);
    }

    if (onProgress) onProgress(1.0);

    return { header: headerDict, data, width: xPixels, height: yPixels };
}


/** 解析 ASC 格式：# 開頭為 header，其餘為數值資料 */
async function readAsc(file, onProgress) {
    const text = await file.text();
    const lines = text.split(/\r?\n/);
    const total = lines.length;

    const headerDict = {};
    const dataLines = [];

    // 第一輪：處理 header
    for (let i = 0; i < total; i++) {
        const line = lines[i];
        if (line.includes('=') && line.includes('#')) {
            const idx = line.indexOf('=');
            const key = line.slice(0, idx).replace(/#/g, '').trim();
            const value = line.slice(idx + 1).trim();
            if (key) headerDict[key] = value;
        }
        if (onProgress && (i & 1023) === 0) onProgress((i + 1) / (2 * total));
    }

    // 第二輪：取出資料行
    for (let i = 0; i < total; i++) {
        const line = lines[i];
        if (!line.includes('#')) {
            const trimmed = line.trim();
            if (trimmed === '') continue;
            dataLines.push(trimmed.split(/\s+/));
        }
        if (onProgress && (i & 1023) === 0) onProgress(0.5 + (i + 1) / (2 * total));
    }

    // 去除單位欄位的方括號
    for (const k of ['z-unit', 'x-unit', 'y-unit']) {
        if (headerDict[k]) headerDict[k] = headerDict[k].replace(/[\[\]]/g, '');
    }

    // 決定形狀：依 x-pixels / y-pixels 或自動推算
    let width, height;
    const xp = parseInt(headerDict['x-pixels']);
    const yp = parseInt(headerDict['y-pixels']);

    let data;
    // 特殊情形：整個資料擠在一行(或兩行)裡
    if (dataLines.length === 2 && !isNaN(xp) && !isNaN(yp) &&
        dataLines[0].length === xp * yp) {
        width = xp;
        height = yp;
        data = new Float32Array(width * height);
        for (let i = 0; i < data.length; i++) data[i] = parseFloat(dataLines[0][i]);
    } else if (dataLines.length >= 1) {
        height = dataLines.length;
        width = dataLines[0].length;
        // 若 header 有明確的 xpixels/ypixels 而且能對上，則優先採用
        if (!isNaN(xp) && !isNaN(yp) && width * height === xp * yp) {
            width = xp; height = yp;
        }
        data = new Float32Array(width * height);
        let idx = 0;
        for (const row of dataLines) {
            for (const v of row) {
                data[idx++] = parseFloat(v);
                if (idx >= data.length) break;
            }
            if (idx >= data.length) break;
        }
    } else {
        throw new Error(t('errAscNoData'));
    }

    if (onProgress) onProgress(1.0);
    return { header: headerDict, data, width, height };
}


/* -------------------------------------------------------------------------
 *  PCD 解析 (對應 pcd_bin_to_csv.py)
 * ------------------------------------------------------------------------- */

const PCD_TYPE_MAP = {
    'F4': { array: Float32Array, get: (dv, o, le) => dv.getFloat32(o, le) },
    'F8': { array: Float64Array, get: (dv, o, le) => dv.getFloat64(o, le) },
    'U1': { array: Uint8Array,   get: (dv, o) => dv.getUint8(o) },
    'U2': { array: Uint16Array,  get: (dv, o, le) => dv.getUint16(o, le) },
    'U4': { array: Uint32Array,  get: (dv, o, le) => dv.getUint32(o, le) },
    'I1': { array: Int8Array,    get: (dv, o) => dv.getInt8(o) },
    'I2': { array: Int16Array,   get: (dv, o, le) => dv.getInt16(o, le) },
    'I4': { array: Int32Array,   get: (dv, o, le) => dv.getInt32(o, le) },
};

function pcdMemberSpec(type, size, count) {
    const key = type.toUpperCase() + size;
    const info = PCD_TYPE_MAP[key];
    if (!info) throw new Error(t('errPcdUnsupportedType', type, size));
    return { type: type.toUpperCase(), size, count, byteSize: size, ...info };
}

function pcdBuildRecordSpec(fields, types, sizes, counts) {
    const members = [];
    const used = {};
    let recordSize = 0;
    for (let i = 0; i < fields.length; i++) {
        const spec = pcdMemberSpec(types[i], sizes[i], counts[i]);
        let name = fields[i];
        used[name] = (used[name] || 0) + 1;
        if (used[name] > 1) name = `${fields[i]}_${used[name] - 1}`;
        members.push({ name, ...spec });
        recordSize += spec.byteSize * spec.count;
    }
    return { members, recordSize };
}

/** 解析 PCD 標頭，回傳 { header, payload } */
function pcdParseHeader(bytes) {
    const header = {
        lines: [],
        fields: [],
        size: [],
        type: [],
        count: [],
        width: 0,
        height: 1,
        points: 0,
        data: 'binary',
        headerSize: 0,
    };

    let offset = 0;
    const dec = new TextDecoder('ascii');

    while (true) {
        let nl = -1;
        for (let i = offset; i < bytes.length; i++) {
            if (bytes[i] === 0x0a) { nl = i; break; }
        }
        if (nl < 0) throw new Error(t('errPcdMalformed'));

        const line = dec.decode(bytes.subarray(offset, nl)).replace(/\r$/, '');
        offset = nl + 1;

        const stripped = line.trim();
        if (!stripped || stripped.startsWith('#')) {
            header.lines.push(line);
            continue;
        }

        header.lines.push(line);
        const tokens = stripped.split(/\s+/);
        const key = tokens[0].toUpperCase();
        const vals = tokens.slice(1);

        if (key === 'FIELDS') header.fields = vals;
        else if (key === 'SIZE') header.size = vals.map(v => parseInt(v, 10));
        else if (key === 'TYPE') header.type = vals.map(v => v.toUpperCase());
        else if (key === 'COUNT') header.count = vals.map(v => parseInt(v, 10));
        else if (key === 'WIDTH') header.width = parseInt(vals[0], 10);
        else if (key === 'HEIGHT') header.height = parseInt(vals[0], 10);
        else if (key === 'POINTS') header.points = parseInt(vals[0], 10);
        else if (key === 'DATA') {
            header.data = vals[0].toLowerCase();
            header.headerSize = offset;
            break;
        }
    }

    if (!header.count.length && header.fields.length) {
        header.count = header.fields.map(() => 1);
    }

    const nFields = header.fields.length;
    if (nFields !== header.size.length || nFields !== header.type.length ||
        nFields !== header.count.length) {
        throw new Error(t('errPcdFieldMismatch'));
    }

    return { header, payload: bytes.subarray(offset) };
}

function pcdTotalPoints(header) {
    return header.points > 0 ? header.points : header.width * header.height;
}

/** LZF 解壓 (PCL binary_compressed 使用) */
function pcdLzfDecompress(input, outLength) {
    const out = new Uint8Array(outLength);
    let inPos = 0;
    let outPos = 0;
    const inLen = input.length;

    while (inPos < inLen) {
        let ctrl = input[inPos++];
        if (ctrl < 32) {
            ctrl++;
            if (outPos + ctrl > outLength) return null;
            for (let i = 0; i < ctrl; i++) out[outPos++] = input[inPos++];
        } else {
            let len = ctrl >> 5;
            let ref = outPos - ((ctrl & 31) << 8) - 1;
            if (len === 7) len += input[inPos++];
            ref -= input[inPos++];
            len += 2;
            if (outPos + len > outLength) return null;
            for (let i = 0; i < len; i++) out[outPos++] = out[ref++];
        }
    }
    return outPos === outLength ? out : null;
}

function pcdReadMember(dv, offset, le, member, rowArrays, rowIndex) {
    const key = member.type + member.size;
    const info = PCD_TYPE_MAP[key];
    const arr = rowArrays[member.name];
    const step = member.byteSize;
    if (member.count === 1) {
        arr[rowIndex] = info.get(dv, offset, le);
        return offset + step;
    }
    const base = rowIndex * member.count;
    for (let c = 0; c < member.count; c++) {
        arr[base + c] = info.get(dv, offset + c * step, le);
    }
    return offset + step * member.count;
}

function pcdDecodeAscii(header, payload, spec, n) {
    const text = new TextDecoder('ascii').decode(payload);
    const lines = text.trim().split(/\r?\n/).filter(l => l.trim() !== '');
    if (lines.length < n) throw new Error(t('errPcdAsciiRows', lines.length, n));

    const rowArrays = {};
    for (const m of spec.members) {
        rowArrays[m.name] = new Float64Array(m.count === 1 ? n : n * m.count);
    }

    let totalCols = 0;
    for (const m of spec.members) totalCols += m.count;

    for (let i = 0; i < n; i++) {
        const parts = lines[i].trim().split(/[\s,]+/).map(Number);
        if (parts.length < totalCols) {
            throw new Error(t('errPcdAsciiRows', i, n));
        }
        let col = 0;
        for (const m of spec.members) {
            const arr = rowArrays[m.name];
            if (m.count === 1) {
                arr[i] = parts[col++];
            } else {
                const base = i * m.count;
                for (let c = 0; c < m.count; c++) arr[base + c] = parts[col++];
            }
        }
    }
    return rowArrays;
}

function pcdDecodeBinary(header, payload, spec, n) {
    const expected = spec.recordSize * n;
    if (payload.byteLength < expected) {
        throw new Error(t('errPcdPayloadSmall', expected, payload.byteLength));
    }

    const rowArrays = {};
    for (const m of spec.members) {
        rowArrays[m.name] = new Float64Array(m.count === 1 ? n : n * m.count);
    }

    const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const le = true;
    let offset = 0;
    for (let i = 0; i < n; i++) {
        for (const m of spec.members) {
            offset = pcdReadMember(dv, offset, le, m, rowArrays, i);
        }
    }
    return rowArrays;
}

function pcdDecodeBinaryCompressed(header, payload, spec, n) {
    if (payload.byteLength < 8) throw new Error(t('errPcdPayloadSmall', 8, payload.byteLength));

    const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const compressedSize = dv.getUint32(0, true);
    const uncompressedSize = dv.getUint32(4, true);
    const body = payload.subarray(8, 8 + compressedSize);
    const raw = pcdLzfDecompress(body, uncompressedSize);
    if (!raw) throw new Error(t('errPcdLzf'));

    const rowArrays = {};
    for (const m of spec.members) {
        rowArrays[m.name] = new Float64Array(m.count === 1 ? n : n * m.count);
    }

    let offset = 0;
    for (const m of spec.members) {
        const key = m.type + m.size;
        const info = PCD_TYPE_MAP[key];
        const total = m.count * n;
        const nbytes = m.byteSize * total;
        const col = new info.array(raw.buffer, raw.byteOffset + offset, total);
        offset += nbytes;
        const arr = rowArrays[m.name];
        if (m.count === 1) {
            for (let i = 0; i < n; i++) arr[i] = col[i];
        } else {
            // binary_compressed：同一欄位內各分量以 column-major 存放
            for (let c = 0; c < m.count; c++) {
                const base = c * n;
                for (let i = 0; i < n; i++) arr[i * m.count + c] = col[base + i];
            }
        }
    }
    return rowArrays;
}

function pcdDecodePoints(header, payload) {
    const spec = pcdBuildRecordSpec(header.fields, header.type, header.size, header.count);
    const n = pcdTotalPoints(header);

    if (header.data === 'ascii') return pcdDecodeAscii(header, payload, spec, n);
    if (header.data === 'binary') return pcdDecodeBinary(header, payload, spec, n);
    if (header.data === 'binary_compressed') return pcdDecodeBinaryCompressed(header, payload, spec, n);
    throw new Error(t('errPcdUnsupportedData', header.data));
}

function pcdFindField(columns, names) {
    const keys = Object.keys(columns);
    for (const name of names) {
        const hit = keys.find(k => k.toLowerCase() === name);
        if (hit) return columns[hit];
    }
    return null;
}

function pcdQuantKey(v) {
    return Math.round(v * 1e6);
}

/** 是否為真正的 2D 有序點雲 (非 PCL 慣用的 WIDTH=N, HEIGHT=1 無序格式) */
function pcdIsOrganized2D(header, n) {
    const width = header.width || 0;
    const height = header.height || 1;
    return width > 1 && height > 1 && n === width * height;
}

const PCD_MAX_GRID_CELLS = 8 * 1024 * 1024;

/** 依點距估計座標量化步長 */
function pcdEstimatePrec(xCol, yCol, n) {
    const step = Math.min(n, 12000);
    const diffs = [];
    for (let i = 1; i < step; i++) {
        const dx = Math.abs(xCol[i] - xCol[i - 1]);
        const dy = Math.abs(yCol[i] - yCol[i - 1]);
        if (dx > 1e-6 && dx < 1e7) diffs.push(dx);
        if (dy > 1e-6 && dy < 1e7) diffs.push(dy);
    }
    if (!diffs.length) return 1;
    diffs.sort((a, b) => a - b);
    const idx = Math.min(diffs.length - 1, Math.floor(diffs.length * 0.2));
    return Math.max(diffs[idx], 1e-6);
}

/**
 * 依實際 x/y 座標建立壓縮索引網格：每個出現過的 (x,y) 對應一個像素，
 * 避免均勻分箱造成整欄/整列 NaN 長條。
 */
function pcdRasterizeIndexed(xCol, yCol, zCol, n) {
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (let i = 0; i < n; i++) {
        if (xCol[i] < xmin) xmin = xCol[i];
        if (xCol[i] > xmax) xmax = xCol[i];
        if (yCol[i] < ymin) ymin = yCol[i];
        if (yCol[i] > ymax) ymax = yCol[i];
    }
    const span = Math.max(xmax - xmin, ymax - ymin, 1);
    let prec = Math.max(pcdEstimatePrec(xCol, yCol, n), span / Math.sqrt(n));

    let nx = 0;
    let ny = 0;
    for (let attempt = 0; attempt < 28; attempt++) {
        const xMap = new Map();
        const yMap = new Map();
        for (let i = 0; i < n; i++) {
            const xk = Math.round(xCol[i] / prec);
            const yk = Math.round(yCol[i] / prec);
            if (!xMap.has(xk)) xMap.set(xk, xCol[i]);
            if (!yMap.has(yk)) yMap.set(yk, yCol[i]);
        }
        nx = xMap.size;
        ny = yMap.size;
        if (nx * ny <= PCD_MAX_GRID_CELLS) {
            const xEntries = [...xMap.entries()].sort((a, b) => a[1] - b[1]);
            const yEntries = [...yMap.entries()].sort((a, b) => a[1] - b[1]);
            const xIndex = new Map(xEntries.map(([k], i) => [k, i]));
            const yIndex = new Map(yEntries.map(([k], i) => [k, i]));
            nx = xEntries.length;
            ny = yEntries.length;

            const data = new Float32Array(nx * ny);
            data.fill(NaN);
            for (let i = 0; i < n; i++) {
                const xk = Math.round(xCol[i] / prec);
                const yk = Math.round(yCol[i] / prec);
                const idx = yIndex.get(yk) * nx + xIndex.get(xk);
                const z = zCol[i];
                if (!Number.isFinite(data[idx]) || z > data[idx]) data[idx] = z;
            }
            return {
                data, width: nx, height: ny,
                viewMode: 'sparse',
                pointCount: n,
                gridPrec: prec,
            };
        }
        prec *= 1.5;
    }

    throw new Error(t('errPcdGridTooLarge', nx, ny));
}

/** 將點雲 z 值轉成 2D 高度圖 (與既有 render 管線相容) */
function pcdToHeightMap(header, columns) {
    const n = pcdTotalPoints(header);
    const zCol = pcdFindField(columns, ['z']);
    if (!zCol) throw new Error(t('errPcdNoZ'));

    const xCol = pcdFindField(columns, ['x']);
    const yCol = pcdFindField(columns, ['y']);
    const width = header.width || 0;
    const height = header.height || 1;

    // 有序 2D 點雲：依 WIDTH×HEIGHT 直接排列 z
    if (pcdIsOrganized2D(header, n)) {
        const data = new Float32Array(n);
        for (let i = 0; i < n; i++) data[i] = zCol[i];
        return {
            data, width, height,
            viewMode: 'organized',
            pointCount: n,
        };
    }

    // 嘗試由 x/y 座標還原規則網格
    if (xCol && yCol) {
        const xKeys = new Map();
        const yKeys = new Map();
        for (let i = 0; i < n; i++) {
            xKeys.set(pcdQuantKey(xCol[i]), xCol[i]);
            yKeys.set(pcdQuantKey(yCol[i]), yCol[i]);
        }
        const nx = xKeys.size;
        const ny = yKeys.size;
        if (nx * ny === n && nx > 1 && ny > 1) {
            const xs = [...xKeys.entries()].sort((a, b) => a[1] - b[1]).map(e => e[0]);
            const ys = [...yKeys.entries()].sort((a, b) => a[1] - b[1]).map(e => e[0]);
            const xi = new Map(xs.map((k, i) => [k, i]));
            const yi = new Map(ys.map((k, i) => [k, i]));
            const data = new Float32Array(n);
            data.fill(NaN);
            for (let i = 0; i < n; i++) {
                const ix = xi.get(pcdQuantKey(xCol[i]));
                const iy = yi.get(pcdQuantKey(yCol[i]));
                data[iy * nx + ix] = zCol[i];
            }
            return {
                data, width: nx, height: ny,
                viewMode: 'grid',
                pointCount: n,
            };
        }
    }

    // 無序點雲應使用散布模式（readPcd → pcdPrepareScatter），不應進入此路徑
    if (xCol && yCol) return pcdRasterizeIndexed(xCol, yCol, zCol, n);

    // 僅有 z：依點序排成近似方形
    const side = Math.max(1, Math.round(Math.sqrt(n)));
    const data = new Float32Array(side * side);
    data.fill(NaN);
    for (let i = 0; i < n; i++) {
        const x = i % side;
        const y = (i / side) | 0;
        data[y * side + x] = zCol[i];
    }
    return {
        data, width: side, height: side,
        viewMode: 'index',
        pointCount: n,
    };
}

function pcdHeaderToDict(header) {
    const dict = {
        fileformat: 'pcd',
        FIELDS: header.fields.join(' '),
        SIZE: header.size.join(' '),
        TYPE: header.type.join(' '),
        COUNT: header.count.join(' '),
        WIDTH: String(header.width),
        HEIGHT: String(header.height),
        POINTS: String(pcdTotalPoints(header)),
        DATA: header.data,
    };
    return dict;
}

function pcdCopyColumn(col, n) {
    if (col instanceof Float32Array && col.length === n) return col;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = col[i];
    return out;
}

/** 依資料範圍長寬比決定散布畫布像素尺寸 */
function pcdScatterCanvasSize(bounds, maxSide = 2048) {
    const spanX = bounds.xmax - bounds.xmin || 1;
    const spanY = bounds.ymax - bounds.ymin || 1;
    const aspect = spanX / spanY;
    if (aspect >= 1) {
        return {
            width: maxSide,
            height: Math.max(256, Math.round(maxSide / aspect)),
        };
    }
    return {
        width: Math.max(256, Math.round(maxSide * aspect)),
        height: maxSide,
    };
}

/** 無序 PCD → 散布資料集（保留原始 x/y/z，不網格化） */
function pcdPrepareScatter(header, columns) {
    const n = pcdTotalPoints(header);
    const xCol = pcdFindField(columns, ['x']);
    const yCol = pcdFindField(columns, ['y']);
    const zCol = pcdFindField(columns, ['z']);
    if (!zCol) throw new Error(t('errPcdNoZ'));
    if (!xCol || !yCol) throw new Error(t('errPcdNoXY'));

    const x = pcdCopyColumn(xCol, n);
    const y = pcdCopyColumn(yCol, n);
    const z = pcdCopyColumn(zCol, n);

    const bounds = { xmin: Infinity, xmax: -Infinity, ymin: Infinity, ymax: -Infinity };
    for (let i = 0; i < n; i++) {
        if (x[i] < bounds.xmin) bounds.xmin = x[i];
        if (x[i] > bounds.xmax) bounds.xmax = x[i];
        if (y[i] < bounds.ymin) bounds.ymin = y[i];
        if (y[i] > bounds.ymax) bounds.ymax = y[i];
    }

    const { width, height } = pcdScatterCanvasSize(bounds);
    const headerDict = pcdHeaderToDict(header);
    headerDict[t('infoPcdPoints')] = String(n);
    headerDict[t('infoPcdView')] = t('infoPcdScatter');

    return {
        type: 'pcd-scatter',
        x, y, z,
        pointCount: n,
        bounds,
        width,
        height,
        header: headerDict,
        pointRadius: 0,
    };
}

async function readPcd(file, onProgress) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (onProgress) onProgress(0.1);

    const { header, payload } = pcdParseHeader(bytes);
    if (onProgress) onProgress(0.35);

    const columns = pcdDecodePoints(header, payload);
    if (onProgress) onProgress(0.75);

    const n = pcdTotalPoints(header);
    let result;
    if (pcdIsOrganized2D(header, n)) {
        const raster = pcdToHeightMap(header, columns);
        const headerDict = pcdHeaderToDict(header);
        headerDict[t('infoPcdPoints')] = String(raster.pointCount);
        headerDict[t('infoPcdView')] = raster.viewMode;
        result = {
            type: 'grid',
            header: headerDict,
            data: raster.data,
            width: raster.width,
            height: raster.height,
        };
    } else {
        result = pcdPrepareScatter(header, columns);
    }

    if (onProgress) onProgress(1.0);
    return result;
}


/* -------------------------------------------------------------------------
 *  PNG / JPG / BMP 解析：透過瀏覽器原生解碼，再轉為灰階 (對應 PIL .convert('L'))
 * ------------------------------------------------------------------------- */

function makeImageHeader(format, w, h, minVal) {
    return {
        fileformat: format,
        headersize: '0',
        xpixels: String(w),
        ypixels: String(h),
        xlength: String(w),
        ylength: String(h),
        scanspeed: '0',
        intelmode: '1',
        bit2nm: '1',
        xoffset: '0',
        yoffset: '0',
        voidpixels: '0',
        zmin: String(minVal),
        xunit: 'mm',
        yunit: 'mm',
        zunit: 'um',
        forcecurve: '0'
    };
}

/** 超過此像素數的資料集視為大型，採分塊非同步處理以避免卡住 UI */
const LARGE_PIXEL_THRESHOLD = 2_000_000;

function yieldToMain() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

async function decodeImageToGray(file, onProgress) {
    // 優先使用 createImageBitmap (較快，能直接處理 Blob/File)
    let w, h, rgba;
    try {
        const bitmap = await createImageBitmap(file);
        w = bitmap.width; h = bitmap.height;
        const tmp = document.createElement('canvas');
        tmp.width = w; tmp.height = h;
        const tctx = tmp.getContext('2d');
        tctx.drawImage(bitmap, 0, 0);
        if (bitmap.close) bitmap.close();
        rgba = tctx.getImageData(0, 0, w, h).data;
    } catch (e) {
        const url = URL.createObjectURL(file);
        try {
            const img = await new Promise((resolve, reject) => {
                const im = new Image();
                im.onload = () => resolve(im);
                im.onerror = () => reject(new Error(t('errImgDecodeFailed')));
                im.src = url;
            });
            w = img.naturalWidth; h = img.naturalHeight;
            const tmp = document.createElement('canvas');
            tmp.width = w; tmp.height = h;
            const tctx = tmp.getContext('2d');
            tctx.drawImage(img, 0, 0);
            rgba = tctx.getImageData(0, 0, w, h).data;
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    if (onProgress) onProgress(0.05);
    if (w * h >= LARGE_PIXEL_THRESHOLD) await yieldToMain();

    // RGBA -> 灰階
    const data = new Float32Array(w * h);
    let vmin = Infinity;
    const pixelCount = w * h;
    const rowChunk = pixelCount >= LARGE_PIXEL_THRESHOLD
        ? Math.max(4, Math.floor(400_000 / w))
        : h;
    for (let row0 = 0; row0 < h; row0 += rowChunk) {
        const row1 = Math.min(h, row0 + rowChunk);
        for (let y = row0; y < row1; y++) {
            const rowBase = y * w;
            for (let x = 0; x < w; x++) {
                const i = rowBase + x;
                const po = i * 4;
                const v = Math.round(rgba[po] * 299 / 1000 + rgba[po + 1] * 587 / 1000 + rgba[po + 2] * 114 / 1000);
                data[i] = v;
                if (v < vmin) vmin = v;
            }
        }
        if (onProgress) onProgress(0.1 + 0.75 * (row1 / h));
        if (pixelCount >= LARGE_PIXEL_THRESHOLD) await yieldToMain();
    }
    return { data, width: w, height: h, vmin };
}

async function readPng(file, onProgress) {
    if (onProgress) onProgress(0.02);
    const { data, width, height, vmin } = await decodeImageToGray(file, (p) => {
        if (onProgress) onProgress(0.02 + p * 0.78);
    });
    if (onProgress) onProgress(0.85);
    const header = makeImageHeader('png', width, height, vmin);
    header.original_format = 'PNG';
    if (onProgress) onProgress(1.0);
    return { header, data, width, height };
}

async function readJpg(file, onProgress) {
    if (onProgress) onProgress(0.02);
    const { data, width, height, vmin } = await decodeImageToGray(file, (p) => {
        if (onProgress) onProgress(0.02 + p * 0.78);
    });
    if (onProgress) onProgress(0.85);
    const header = makeImageHeader('jpg', width, height, vmin);
    header.original_format = 'JPEG';
    if (onProgress) onProgress(1.0);
    return { header, data, width, height };
}

async function readBmp(file, onProgress) {
    if (onProgress) onProgress(0.02);
    const { data, width, height, vmin } = await decodeImageToGray(file, (p) => {
        if (onProgress) onProgress(0.02 + p * 0.78);
    });
    if (onProgress) onProgress(0.85);

    const header = makeImageHeader('bmp', width, height, vmin);
    header.original_format = 'BMP';

    // 從 BMP 檔頭讀取 biXPelsPerMeter / biYPelsPerMeter 計算實際長度
    try {
        const buffer = await file.arrayBuffer();
        if (buffer.byteLength >= 46) {
            const view = new DataView(buffer);
            // 檢查 BMP magic: 0x42, 0x4D = 'BM'
            if (view.getUint8(0) === 0x42 && view.getUint8(1) === 0x4D) {
                const xpels = view.getUint32(38, true);
                const ypels = view.getUint32(42, true);
                if (xpels > 0 && ypels > 0) {
                    header.xlength = String(width / xpels * 1000); // m -> mm
                    header.ylength = String(height / ypels * 1000);
                }
            }
        }
    } catch (e) { /* 忽略，使用預設值 */ }

    if (onProgress) onProgress(1.0);
    return { header, data, width, height };
}


/* -------------------------------------------------------------------------
 *  TIFF 解析：支援 uncompressed 的 float32 / uint8 / uint16 / int16 單通道或 RGB
 *  對應 wr_file.py 的 read_tiff_file_thread，能讀取 tifffile 寫入的 float32 TIFF。
 * ------------------------------------------------------------------------- */

const TIFF_TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

async function readTiff(file, onProgress) {
    if (onProgress) onProgress(0.05);
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);

    if (buffer.byteLength < 8) throw new Error(t('errTiffSmall'));

    // Byte order
    const b0 = view.getUint8(0), b1 = view.getUint8(1);
    let le;
    if (b0 === 0x49 && b1 === 0x49) le = true;          // 'II'
    else if (b0 === 0x4D && b1 === 0x4D) le = false;     // 'MM'
    else throw new Error(t('errTiffInvalid'));

    const magic = view.getUint16(2, le);
    if (magic !== 42) throw new Error(t('errTiffBigTiff', magic));

    const ifdOffset = view.getUint32(4, le);
    if (ifdOffset + 2 > buffer.byteLength) throw new Error(t('errTiffBadIfd'));

    // 解析 IFD entries
    const numEntries = view.getUint16(ifdOffset, le);
    const tags = {};
    for (let i = 0; i < numEntries; i++) {
        const entryOffset = ifdOffset + 2 + i * 12;
        const tag = view.getUint16(entryOffset, le);
        const type = view.getUint16(entryOffset + 2, le);
        const count = view.getUint32(entryOffset + 4, le);
        const typeSize = TIFF_TYPE_SIZE[type] || 0;
        const totalSize = typeSize * count;
        const valueOffset = totalSize > 4
            ? view.getUint32(entryOffset + 8, le)
            : entryOffset + 8;
        tags[tag] = { type, count, valueOffset };
    }

    const readTagValue = (info, index = 0) => {
        if (!info) return undefined;
        const { type, valueOffset } = info;
        const size = TIFF_TYPE_SIZE[type] || 0;
        const off = valueOffset + index * size;
        switch (type) {
            case 1: case 7: case 6: return view.getUint8(off);
            case 3: return view.getUint16(off, le);
            case 4: return view.getUint32(off, le);
            case 8: return view.getInt16(off, le);
            case 9: return view.getInt32(off, le);
            case 11: return view.getFloat32(off, le);
            case 12: return view.getFloat64(off, le);
            default: return view.getUint32(off, le);
        }
    };

    const readTagString = (info) => {
        if (!info) return '';
        const bytes = new Uint8Array(buffer, info.valueOffset, info.count);
        let end = bytes.length;
        while (end > 0 && bytes[end - 1] === 0) end--;
        return new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, end));
    };

    // 必要標籤
    const width  = readTagValue(tags[256]);
    const height = readTagValue(tags[257]);
    if (!width || !height) throw new Error(t('errTiffMissingDim'));

    const bitsPerSample  = tags[258] ? readTagValue(tags[258]) : 1;
    const compression    = tags[259] ? readTagValue(tags[259]) : 1;
    const samplesPerPixel = tags[277] ? readTagValue(tags[277]) : 1;
    const sampleFormat    = tags[339] ? readTagValue(tags[339]) : 1;
    // 1=unsigned int, 2=signed int, 3=IEEE float

    if (compression !== 1) {
        throw new Error(t('errTiffCompressed', compression));
    }

    const stripOffsetsInfo = tags[273];
    const stripByteCountsInfo = tags[279];
    if (!stripOffsetsInfo || !stripByteCountsInfo) {
        throw new Error(t('errTiffTiled'));
    }

    if (onProgress) onProgress(0.25);

    // 讀取所有 strip 並拼成一塊連續 bytes
    const numStrips = stripOffsetsInfo.count;
    let totalStripBytes = 0;
    const offsets = [], counts = [];
    for (let i = 0; i < numStrips; i++) {
        offsets.push(readTagValue(stripOffsetsInfo, i));
        const c = readTagValue(stripByteCountsInfo, i);
        counts.push(c);
        totalStripBytes += c;
    }
    const raw = new Uint8Array(totalStripBytes);
    let pos = 0;
    for (let i = 0; i < numStrips; i++) {
        raw.set(new Uint8Array(buffer, offsets[i], counts[i]), pos);
        pos += counts[i];
        if (onProgress && (i & 7) === 0) onProgress(0.25 + 0.5 * (i + 1) / numStrips);
    }
    if (onProgress) onProgress(0.8);

    // 依 BitsPerSample / SampleFormat 解析成 Float32
    const rawView = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const pixelCount = width * height;
    const data = new Float32Array(pixelCount);

    const spp = samplesPerPixel;
    const bps = bitsPerSample;
    const bytesPerSample = bps / 8;

    const readSampleAt = (byteOff) => {
        if (bps === 32 && sampleFormat === 3) return rawView.getFloat32(byteOff, le);
        if (bps === 64 && sampleFormat === 3) return rawView.getFloat64(byteOff, le);
        if (bps === 32 && sampleFormat === 2) return rawView.getInt32(byteOff, le);
        if (bps === 32) return rawView.getUint32(byteOff, le);
        if (bps === 16 && sampleFormat === 2) return rawView.getInt16(byteOff, le);
        if (bps === 16) return rawView.getUint16(byteOff, le);
        if (bps === 8 && sampleFormat === 2) return rawView.getInt8(byteOff);
        if (bps === 8) return raw[byteOff];
        throw new Error(t('errTiffSampleFmt', bps, sampleFormat));
    };

    if (spp === 1) {
        for (let i = 0; i < pixelCount; i++) {
            data[i] = readSampleAt(i * bytesPerSample);
        }
    } else {
        // 多通道：對應 Python 中 data[:, :, 0] 的行為，取第一個通道
        const stride = spp * bytesPerSample;
        for (let i = 0; i < pixelCount; i++) {
            data[i] = readSampleAt(i * stride);
        }
    }

    // ImageDescription -> header dict (嘗試解析 JSON)
    let headerDict = {};
    if (tags[270]) {
        const desc = readTagString(tags[270]);
        if (desc) {
            try {
                headerDict = JSON.parse(desc);
            } catch (e) {
                headerDict = { ImageDescription: desc };
            }
        }
    }

    // 若 header 空或不足，建立預設
    if (!headerDict || Object.keys(headerDict).length <= 1) {
        headerDict = {
            fileformat: 'bcrf_unicode',
            headersize: '2048',
            xpixels: width,
            ypixels: height,
            xlength: width,
            ylength: height,
            scanspeed: '0',
            intelmode: '1',
            bit2nm: '1',
            xoffset: '',
            yoffset: '',
            voidpixels: 0,
            zmin: '0',
            xunit: 'mm',
            yunit: 'mm',
            zunit: 'um',
            forcecurve: '0'
        };
    }

    if (onProgress) onProgress(1.0);
    return { header: headerDict, data, width, height };
}


