/**
 * 散布點雲網格化（pcd-scatter → 規則高度圖）
 * 依賴：file-parse.js (yieldToMain)
 * 匯出（全域）：
 *   SCATTER_GRID_MAX_CELLS, SCATTER_GRID_AGG_OPTIONS,
 *   normalizeScatterGridAggregate(), estimateScatterPointSpacing(),
 *   resolveScatterGridGeometry(), applyScatterGrid(), applyScatterGridAsync()
 */
/* =========================================================================
 *  散布點雲 → 高度圖網格化
 * ========================================================================= */

const SCATTER_GRID_MAX_CELLS = (typeof PCD_MAX_GRID_CELLS === 'number')
    ? PCD_MAX_GRID_CELLS
    : (8 * 1024 * 1024);
const SCATTER_GRID_AGG_OPTIONS = ['mean', 'median', 'max'];
const SCATTER_GRID_LARGE_POINTS = 500_000;
/** 自動模式：索引網格填充率低於此值時改走均勻分箱 */
const SCATTER_GRID_AUTO_INDEXED_MIN_FILL = 0.45;

function scatterGridYield() {
    if (typeof yieldToMain === 'function') return yieldToMain();
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function normalizeScatterGridAggregate(agg) {
    const a = String(agg || 'mean').toLowerCase();
    return SCATTER_GRID_AGG_OPTIONS.includes(a) ? a : 'mean';
}

function scatterGridBoundsSpan(bounds) {
    let spanX = bounds.xmax - bounds.xmin;
    let spanY = bounds.ymax - bounds.ymin;
    if (!(spanX > 0)) spanX = 1;
    if (!(spanY > 0)) spanY = 1;
    return { spanX, spanY, span: Math.max(spanX, spanY, 1e-12) };
}

/**
 * 依鄰近點距估計典型間距（世界座標）。
 * 忽略遠小於密度尺度的抖動（例如掃描線內微小 Y 漂移），
 * 改取「顯著步距」的中位數，避免自動模式切得過細。
 */
function estimateScatterPointSpacing(x, y, n) {
    const step = Math.min(n, 12000);
    const diffs = [];
    for (let i = 1; i < step; i++) {
        const dx = Math.abs(x[i] - x[i - 1]);
        const dy = Math.abs(y[i] - y[i - 1]);
        if (dx > 1e-12 && dx < 1e7) diffs.push(dx);
        if (dy > 1e-12 && dy < 1e7) diffs.push(dy);
    }
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (let i = 0; i < n; i++) {
        if (x[i] < xmin) xmin = x[i];
        if (x[i] > xmax) xmax = x[i];
        if (y[i] < ymin) ymin = y[i];
        if (y[i] > ymax) ymax = y[i];
    }
    const span = Math.max(xmax - xmin, ymax - ymin, 1e-12);
    const fromDensity = span / Math.max(1, Math.sqrt(Math.max(1, n)));
    if (!diffs.length) return fromDensity;

    diffs.sort((a, b) => a - b);
    const significant = [];
    const thr = fromDensity * 0.15;
    for (let i = 0; i < diffs.length; i++) {
        if (diffs[i] > thr) significant.push(diffs[i]);
    }
    const pool = significant.length ? significant : diffs;
    return Math.max(pool[pool.length >> 1], 1e-12);
}

/**
 * @param {{ xmin:number, xmax:number, ymin:number, ymax:number }} bounds
 * @param {number} n
 * @param {{ mode?: string, dx?: number, dy?: number, width?: number, height?: number, x?: Float32Array|number[], y?: Float32Array|number[] }} options
 */
function resolveScatterGridGeometry(bounds, n, options) {
    options = options || {};
    const mode = options.mode === 'spacing' || options.mode === 'size' ? options.mode : 'auto';
    let xmin = bounds.xmin, xmax = bounds.xmax, ymin = bounds.ymin, ymax = bounds.ymax;
    let spanX = xmax - xmin;
    let spanY = ymax - ymin;
    if (!(spanX > 0)) { spanX = 1; xmax = xmin + 1; }
    if (!(spanY > 0)) { spanY = 1; ymax = ymin + 1; }

    let width = 0;
    let height = 0;
    let dx = 0;
    let dy = 0;

    if (mode === 'size') {
        width = Math.max(2, Math.round(Number(options.width) || 0));
        height = Math.max(2, Math.round(Number(options.height) || 0));
        dx = spanX / width;
        dy = spanY / height;
    } else if (mode === 'spacing') {
        dx = Number(options.dx);
        if (!(dx > 0) || !Number.isFinite(dx)) {
            dx = estimateScatterPointSpacing(options.x || [], options.y || [], n);
        }
        dy = Number(options.dy);
        if (!(dy > 0) || !Number.isFinite(dy)) dy = dx;
        width = Math.max(2, Math.ceil(spanX / dx));
        height = Math.max(2, Math.ceil(spanY / dy));
        dx = spanX / width;
        dy = spanY / height;
    } else {
        // auto 的均勻分箱後備：等向格距（顯著步距中位數）
        const xArr = options.x;
        const yArr = options.y;
        let spacing = (xArr && yArr)
            ? estimateScatterPointSpacing(xArr, yArr, n)
            : (Math.max(spanX, spanY) / Math.max(1, Math.sqrt(Math.max(1, n))));
        if (!(spacing > 0) || !Number.isFinite(spacing)) spacing = Math.max(spanX, spanY) / 512;
        dx = spacing;
        dy = spacing;
        width = Math.max(2, Math.ceil(spanX / dx));
        height = Math.max(2, Math.ceil(spanY / dy));
        for (let attempt = 0; attempt < 40 && width * height > SCATTER_GRID_MAX_CELLS; attempt++) {
            dx *= 1.5;
            dy *= 1.5;
            width = Math.max(2, Math.ceil(spanX / dx));
            height = Math.max(2, Math.ceil(spanY / dy));
        }
        dx = spanX / width;
        dy = spanY / height;
    }

    if (width * height > SCATTER_GRID_MAX_CELLS) {
        const scale = Math.sqrt((width * height) / SCATTER_GRID_MAX_CELLS);
        width = Math.max(2, Math.floor(width / scale));
        height = Math.max(2, Math.floor(height / scale));
        dx = spanX / width;
        dy = spanY / height;
    }

    return {
        mode,
        width,
        height,
        dx,
        dy,
        xmin,
        xmax,
        ymin,
        ymax,
        xlength: spanX,
        ylength: spanY,
    };
}

function scatterGridCellIndex(wx, wy, geom) {
    let ix = Math.floor((wx - geom.xmin) / geom.dx);
    // 與散布顯示一致：世界 Y 越大越靠畫面上方（影像列 0）
    let iy = Math.floor((geom.ymax - wy) / geom.dy);
    if (ix < 0) ix = 0;
    else if (ix >= geom.width) ix = geom.width - 1;
    if (iy < 0) iy = 0;
    else if (iy >= geom.height) iy = geom.height - 1;
    return iy * geom.width + ix;
}

function scatterGridMedianOf(arr) {
    const n = arr.length;
    if (n === 1) return arr[0];
    arr.sort((a, b) => a - b);
    const mid = (n - 1) >> 1;
    if (n % 2) return arr[mid];
    return 0.5 * (arr[mid] + arr[mid + 1]);
}

/**
 * 依實際出現過的 X／Y 量化軸建立壓縮索引網格（適合近規則量測網格，如 MicroVu）。
 * 自動搜尋量化步長：在可接受格數內盡量提高填充率，並讓長寬比接近資料範圍比例，
 * 避免密集點雲因量化過細變成「長方形 + 大量 NaN 縫隙」。
 */
function scatterGridRasterizeIndexed(x, y, z, bounds, aggregate) {
    const n = z.length;
    const spanX = Math.max(bounds.xmax - bounds.xmin, 1e-12);
    const spanY = Math.max(bounds.ymax - bounds.ymin, 1e-12);
    const span = Math.max(spanX, spanY);
    const spanAsp = spanX / spanY;

    let rawPrec = 0;
    {
        const step = Math.min(n, 12000);
        const diffs = [];
        for (let i = 1; i < step; i++) {
            const dx = Math.abs(x[i] - x[i - 1]);
            const dy = Math.abs(y[i] - y[i - 1]);
            if (dx > 1e-6 && dx < 1e7) diffs.push(dx);
            if (dy > 1e-6 && dy < 1e7) diffs.push(dy);
        }
        if (diffs.length) {
            diffs.sort((a, b) => a - b);
            const idx = Math.min(diffs.length - 1, Math.floor(diffs.length * 0.2));
            rawPrec = Math.max(diffs[idx], 1e-6);
        }
    }
    let prec = Math.max(rawPrec, span / Math.max(1, Math.sqrt(n)));

    let best = null;
    for (let attempt = 0; attempt < 48; attempt++) {
        const xMap = new Map();
        const yMap = new Map();
        const occupied = new Set();
        for (let i = 0; i < n; i++) {
            const xk = Math.round(x[i] / prec);
            const yk = Math.round(y[i] / prec);
            if (!xMap.has(xk)) xMap.set(xk, x[i]);
            if (!yMap.has(yk)) yMap.set(yk, y[i]);
            occupied.add(xk + ',' + yk);
        }
        const width = xMap.size;
        const height = yMap.size;
        const cells = width * height;
        if (width < 2 || height < 2) break;
        if (cells > SCATTER_GRID_MAX_CELLS) {
            prec *= 1.5;
            continue;
        }

        const fill = occupied.size / cells;
        const aspect = width / height;
        const aspectErr = Math.abs(Math.log(aspect / spanAsp));
        // 優先高填充、長寬比接近資料範圍；略懲罰過粗（格數遠小於點數立方根尺度時）
        const coarseness = Math.max(0, Math.log((n / Math.max(1, cells)) / 4) / 8);
        const score = fill - 0.22 * aspectErr - 0.05 * coarseness;

        if (!best || score > best.score) {
            best = {
                prec, width, height, fill, score,
                xMap, yMap,
            };
        }

        // 已夠密實且比例合理 → 停止（規則網格如 21×21 會在第一次就停下）
        if (fill >= 0.97 && aspectErr < 0.12) break;
        // 填充已很高且連續幾步不再明顯變好也可停，但以 break 條件為主
        if (fill >= 0.995 && aspectErr < 0.25) break;

        prec *= 1.12;
    }

    if (!best) return null;

    prec = best.prec;
    const xEntries = [...best.xMap.entries()].sort((a, b) => a[1] - b[1]);
    // Y 由大到小：世界座標較大者在影像上方，對齊散布點雲視圖
    const yEntries = [...best.yMap.entries()].sort((a, b) => b[1] - a[1]);
    const width = xEntries.length;
    const height = yEntries.length;
    const xIndex = new Map(xEntries.map(([k], i) => [k, i]));
    const yIndex = new Map(yEntries.map(([k], i) => [k, i]));

    const nCells = width * height;
    const data = new Float32Array(nCells);
    data.fill(NaN);
    const agg = normalizeScatterGridAggregate(aggregate);

    if (agg === 'max') {
        for (let i = 0; i < n; i++) {
            const zv = z[i];
            if (!Number.isFinite(zv)) continue;
            const ix = xIndex.get(Math.round(x[i] / prec));
            const iy = yIndex.get(Math.round(y[i] / prec));
            if (ix === undefined || iy === undefined) continue;
            const idx = iy * width + ix;
            const cur = data[idx];
            if (!Number.isFinite(cur) || zv > cur) data[idx] = zv;
        }
    } else if (agg === 'median') {
        const buckets = new Array(nCells);
        for (let i = 0; i < n; i++) {
            const zv = z[i];
            if (!Number.isFinite(zv)) continue;
            const ix = xIndex.get(Math.round(x[i] / prec));
            const iy = yIndex.get(Math.round(y[i] / prec));
            if (ix === undefined || iy === undefined) continue;
            const idx = iy * width + ix;
            let b = buckets[idx];
            if (!b) { b = []; buckets[idx] = b; }
            b.push(zv);
        }
        for (let i = 0; i < nCells; i++) {
            const b = buckets[i];
            if (b && b.length) data[i] = scatterGridMedianOf(b);
        }
    } else {
        const sum = new Float64Array(nCells);
        const cnt = new Uint32Array(nCells);
        for (let i = 0; i < n; i++) {
            const zv = z[i];
            if (!Number.isFinite(zv)) continue;
            const ix = xIndex.get(Math.round(x[i] / prec));
            const iy = yIndex.get(Math.round(y[i] / prec));
            if (ix === undefined || iy === undefined) continue;
            const idx = iy * width + ix;
            sum[idx] += zv;
            cnt[idx]++;
        }
        for (let i = 0; i < nCells; i++) {
            if (cnt[i] > 0) data[i] = sum[i] / cnt[i];
        }
    }

    let filled = 0;
    for (let i = 0; i < nCells; i++) {
        if (Number.isFinite(data[i])) filled++;
    }

    const xmin = xEntries[0][1];
    const xmax = xEntries[width - 1][1];
    // yEntries 已由大到小排列
    const ymax = yEntries[0][1];
    const ymin = yEntries[height - 1][1];
    const xlength = Math.max(xmax - xmin, 1e-12);
    const ylength = Math.max(ymax - ymin, 1e-12);

    return {
        data,
        width,
        height,
        dx: width > 1 ? xlength / (width - 1) : xlength,
        dy: height > 1 ? ylength / (height - 1) : ylength,
        xmin,
        xmax,
        ymin,
        ymax,
        xlength,
        ylength,
        mode: 'auto',
        method: 'indexed',
        gridPrec: prec,
        aggregate: agg,
        pointCount: n,
        filledCount: filled,
        emptyCount: nCells - filled,
    };
}

function scatterGridFillUniform(x, y, z, geom, aggregate) {
    const n = z.length;
    const { width, height } = geom;
    const nCells = width * height;
    const data = new Float32Array(nCells);
    data.fill(NaN);
    const agg = normalizeScatterGridAggregate(aggregate);

    if (agg === 'max') {
        for (let i = 0; i < n; i++) {
            const zv = z[i];
            if (!Number.isFinite(zv)) continue;
            const idx = scatterGridCellIndex(x[i], y[i], geom);
            const cur = data[idx];
            if (!Number.isFinite(cur) || zv > cur) data[idx] = zv;
        }
    } else if (agg === 'median') {
        const buckets = new Array(nCells);
        for (let i = 0; i < n; i++) {
            const zv = z[i];
            if (!Number.isFinite(zv)) continue;
            const idx = scatterGridCellIndex(x[i], y[i], geom);
            let b = buckets[idx];
            if (!b) { b = []; buckets[idx] = b; }
            b.push(zv);
        }
        for (let i = 0; i < nCells; i++) {
            const b = buckets[i];
            if (b && b.length) data[i] = scatterGridMedianOf(b);
        }
    } else {
        const sum = new Float64Array(nCells);
        const cnt = new Uint32Array(nCells);
        for (let i = 0; i < n; i++) {
            const zv = z[i];
            if (!Number.isFinite(zv)) continue;
            const idx = scatterGridCellIndex(x[i], y[i], geom);
            sum[idx] += zv;
            cnt[idx]++;
        }
        for (let i = 0; i < nCells; i++) {
            if (cnt[i] > 0) data[i] = sum[i] / cnt[i];
        }
    }

    let filled = 0;
    for (let i = 0; i < nCells; i++) {
        if (Number.isFinite(data[i])) filled++;
    }

    return {
        data,
        width,
        height,
        dx: geom.dx,
        dy: geom.dy,
        xmin: geom.xmin,
        xmax: geom.xmax,
        ymin: geom.ymin,
        ymax: geom.ymax,
        xlength: geom.xlength,
        ylength: geom.ylength,
        mode: geom.mode,
        method: 'uniform',
        aggregate: agg,
        pointCount: n,
        filledCount: filled,
        emptyCount: nCells - filled,
    };
}

/**
 * @param {Float32Array|number[]} x
 * @param {Float32Array|number[]} y
 * @param {Float32Array|number[]} z
 * @param {{ xmin:number, xmax:number, ymin:number, ymax:number }} bounds
 * @param {{ mode?: string, aggregate?: string, dx?: number, dy?: number, width?: number, height?: number }} options
 */
function applyScatterGrid(x, y, z, bounds, options) {
    options = options || {};
    const n = z.length;
    const aggregate = normalizeScatterGridAggregate(options.aggregate);
    const mode = options.mode === 'spacing' || options.mode === 'size' ? options.mode : 'auto';

    // 自動：優先走索引網格（近規則量測面幾乎無 NaN）
    if (mode === 'auto') {
        const indexed = scatterGridRasterizeIndexed(x, y, z, bounds, aggregate);
        if (indexed) {
            const fill = indexed.filledCount / Math.max(1, indexed.width * indexed.height);
            if (fill >= SCATTER_GRID_AUTO_INDEXED_MIN_FILL) return indexed;
        }
    }

    const geom = resolveScatterGridGeometry(bounds, n, {
        mode,
        dx: options.dx,
        dy: options.dy,
        width: options.width,
        height: options.height,
        x, y,
    });
    return scatterGridFillUniform(x, y, z, geom, aggregate);
}

/**
 * @returns {Promise<object|null>}
 */
async function applyScatterGridAsync(x, y, z, bounds, options, isCancelled, onProgress) {
    options = options || {};
    const n = z.length;
    const aggregate = normalizeScatterGridAggregate(options.aggregate);
    const mode = options.mode === 'spacing' || options.mode === 'size' ? options.mode : 'auto';
    const report = (p) => { if (onProgress) onProgress(p); };

    report(0.05);
    if (isCancelled && isCancelled()) return null;

    if (mode === 'auto') {
        // 索引路徑相對便宜；大點雲仍讓出主線程一次
        if (n >= SCATTER_GRID_LARGE_POINTS) await scatterGridYield();
        if (isCancelled && isCancelled()) return null;
        const indexed = scatterGridRasterizeIndexed(x, y, z, bounds, aggregate);
        if (indexed) {
            const fill = indexed.filledCount / Math.max(1, indexed.width * indexed.height);
            if (fill >= SCATTER_GRID_AUTO_INDEXED_MIN_FILL) {
                report(1);
                return indexed;
            }
        }
        report(0.2);
    }

    const geom = resolveScatterGridGeometry(bounds, n, {
        mode,
        dx: options.dx,
        dy: options.dy,
        width: options.width,
        height: options.height,
        x, y,
    });
    if (isCancelled && isCancelled()) return null;

    const { width, height } = geom;
    const nCells = width * height;
    const data = new Float32Array(nCells);
    data.fill(NaN);
    const large = n >= SCATTER_GRID_LARGE_POINTS || nCells >= 1_000_000;
    const chunk = large ? 65536 : Math.max(n, 1);

    if (aggregate === 'max') {
        for (let i = 0; i < n; i++) {
            if (large && (i % chunk) === 0) {
                if (isCancelled && isCancelled()) return null;
                report(0.2 + i / Math.max(1, n) * 0.7);
                await scatterGridYield();
            }
            const zv = z[i];
            if (!Number.isFinite(zv)) continue;
            const idx = scatterGridCellIndex(x[i], y[i], geom);
            const cur = data[idx];
            if (!Number.isFinite(cur) || zv > cur) data[idx] = zv;
        }
    } else if (aggregate === 'median') {
        const buckets = new Array(nCells);
        for (let i = 0; i < n; i++) {
            if (large && (i % chunk) === 0) {
                if (isCancelled && isCancelled()) return null;
                report(0.2 + i / Math.max(1, n) * 0.55);
                await scatterGridYield();
            }
            const zv = z[i];
            if (!Number.isFinite(zv)) continue;
            const idx = scatterGridCellIndex(x[i], y[i], geom);
            let b = buckets[idx];
            if (!b) { b = []; buckets[idx] = b; }
            b.push(zv);
        }
        for (let i = 0; i < nCells; i++) {
            if (large && (i % 8192) === 0) {
                if (isCancelled && isCancelled()) return null;
                report(0.75 + (i / nCells) * 0.2);
                await scatterGridYield();
            }
            const b = buckets[i];
            if (b && b.length) data[i] = scatterGridMedianOf(b);
        }
    } else {
        const sum = new Float64Array(nCells);
        const cnt = new Uint32Array(nCells);
        for (let i = 0; i < n; i++) {
            if (large && (i % chunk) === 0) {
                if (isCancelled && isCancelled()) return null;
                report(0.2 + i / Math.max(1, n) * 0.7);
                await scatterGridYield();
            }
            const zv = z[i];
            if (!Number.isFinite(zv)) continue;
            const idx = scatterGridCellIndex(x[i], y[i], geom);
            sum[idx] += zv;
            cnt[idx]++;
        }
        for (let i = 0; i < nCells; i++) {
            if (cnt[i] > 0) data[i] = sum[i] / cnt[i];
        }
    }

    if (isCancelled && isCancelled()) return null;

    let filled = 0;
    for (let i = 0; i < nCells; i++) {
        if (Number.isFinite(data[i])) filled++;
    }
    report(1);

    return {
        data,
        width,
        height,
        dx: geom.dx,
        dy: geom.dy,
        xmin: geom.xmin,
        xmax: geom.xmax,
        ymin: geom.ymin,
        ymax: geom.ymax,
        xlength: geom.xlength,
        ylength: geom.ylength,
        mode: geom.mode,
        method: 'uniform',
        aggregate,
        pointCount: n,
        filledCount: filled,
        emptyCount: nCells - filled,
    };
}
