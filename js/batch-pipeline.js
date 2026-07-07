/**
 * 批次編輯管線
 * 依賴：file-parse.js, file-export.js
 * 匯出（全域）：batchApplyPipeline() 等
 */
/* =========================================================================
 *  1c. 批次編輯管線（可重複套用的編輯步驟）
 * ========================================================================= */

const BATCH_FILE_FORMAT = 'webviewer-batch';
const BATCH_FILE_VERSION = 1;

function getDatasetKind(ds) {
    return isPcdScatterDataset(ds) ? 'pcd' : 'grid';
}

function getDatasetSignature(ds) {
    if (!ds) return null;
    return { kind: getDatasetKind(ds), width: ds.width, height: ds.height };
}

function signaturesMatch(sigA, sigB) {
    if (!sigA || !sigB) return false;
    return sigA.kind === sigB.kind && sigA.width === sigB.width && sigA.height === sigB.height;
}

function cloneDatasetDeep(ds) {
    return cloneDatasetForTransfer(ds);
}

function batchEnsureFloatPixels(ds) {
    if (isPcdScatterDataset(ds)) return;
    if (!(ds.data instanceof Float32Array) && !(ds.data instanceof Float64Array)) {
        ds.data = Float32Array.from(ds.data);
    }
}

function batchRecomputeScatterBounds(ds) {
    const { x, y } = ds, n = x.length;
    const b = { xmin: Infinity, xmax: -Infinity, ymin: Infinity, ymax: -Infinity };
    for (let i = 0; i < n; i++) {
        if (x[i] < b.xmin) b.xmin = x[i];
        if (x[i] > b.xmax) b.xmax = x[i];
        if (y[i] < b.ymin) b.ymin = y[i];
        if (y[i] > b.ymax) b.ymax = y[i];
    }
    if (!Number.isFinite(b.xmin)) { b.xmin = 0; b.xmax = 1; b.ymin = 0; b.ymax = 1; }
    ds.bounds = b;
}

function batchPlaneFitAccessors(ds) {
    if (isPcdScatterDataset(ds)) {
        const { x, y, z } = ds;
        return {
            count: z.length,
            getX: (i) => x[i],
            getY: (i) => y[i],
            getZ: (i) => z[i],
            isValid: (i) => Number.isFinite(z[i]) && Number.isFinite(x[i]) && Number.isFinite(y[i]),
        };
    }
    const { data, width, height } = ds;
    const hdr = ds.header || {};
    let xl = parseFloat(hdr.xlength ?? hdr['x-length'] ?? 0);
    let yl = parseFloat(hdr.ylength ?? hdr['y-length'] ?? 0);
    if (!Number.isFinite(xl) || xl <= 0) xl = width;
    if (!Number.isFinite(yl) || yl <= 0) yl = height;
    const dx = xl / Math.max(1, width - 1);
    const dy = yl / Math.max(1, height - 1);
    return {
        count: data.length,
        getX: (i) => (i % width) * dx,
        getY: (i) => ((i / width) | 0) * dy,
        getZ: (i) => data[i],
        isValid: (i) => Number.isFinite(data[i]),
    };
}

function batchSolveLinear3(A, B) {
    const M = [
        [A[0][0], A[0][1], A[0][2], B[0]],
        [A[1][0], A[1][1], A[1][2], B[1]],
        [A[2][0], A[2][1], A[2][2], B[2]],
    ];
    for (let col = 0; col < 3; col++) {
        let maxRow = col, maxVal = Math.abs(M[col][col]);
        for (let r = col + 1; r < 3; r++) {
            const v = Math.abs(M[r][col]);
            if (v > maxVal) { maxVal = v; maxRow = r; }
        }
        if (maxVal < 1e-12) return null;
        if (maxRow !== col) {
            const tmp = M[col]; M[col] = M[maxRow]; M[maxRow] = tmp;
        }
        for (let r = col + 1; r < 3; r++) {
            const f = M[r][col] / M[col][col];
            for (let c = col; c < 4; c++) M[r][c] -= f * M[col][c];
        }
    }
    const x = [0, 0, 0];
    for (let r = 2; r >= 0; r--) {
        let sum = M[r][3];
        for (let c = r + 1; c < 3; c++) sum -= M[r][c] * x[c];
        x[r] = sum / M[r][r];
    }
    return x;
}

function batchFitPlaneLeastSquares(acc) {
    let n = 0, sx = 0, sy = 0, sz = 0;
    let sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0;
    for (let i = 0; i < acc.count; i++) {
        if (!acc.isValid(i)) continue;
        const x = acc.getX(i), y = acc.getY(i), z = acc.getZ(i);
        n++;
        sx += x; sy += y; sz += z;
        sxx += x * x; syy += y * y; sxy += x * y;
        sxz += x * z; syz += y * z;
    }
    if (n < 3) return null;
    const sol = batchSolveLinear3(
        [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]],
        [sxz, syz, sz],
    );
    if (!sol) return null;
    return { a: sol[0], b: sol[1], c: sol[2], n };
}

function batchRefreshRange(ds) {
    const src = isPcdScatterDataset(ds) ? ds.z : ds.data;
    const { vmin, vmax } = computeRange(src);
    ds.vmin = vmin;
    ds.vmax = vmax;
}

function batchPointInNormRect(px, py, r, circle) {
    const x0 = r.x0, y0 = r.y0, x1 = r.x1, y1 = r.y1;
    if (!circle) return px >= x0 && px <= x1 && py >= y0 && py <= y1;
    const cx = (x0 + x1) * 0.5, cy = (y0 + y1) * 0.5;
    const rx = (x1 - x0) * 0.5, ry = (y1 - y0) * 0.5;
    if (rx <= 0 || ry <= 0) return false;
    const dx = (px - cx) / rx, dy = (py - cy) / ry;
    return dx * dx + dy * dy <= 1;
}

const DENOISE_HIST_BINS = 96;

/** 建立數值直方圖（供自動刪除雜點統計用） */
function buildValueHistogram(vals, vmin, vmax) {
    const span = (vmax - vmin) || 1;
    const counts = new Float64Array(DENOISE_HIST_BINS);
    let total = 0;
    for (let i = 0; i < vals.length; i++) {
        const v = vals[i];
        if (!Number.isFinite(v)) continue;
        let f = (v - vmin) / span;
        if (f < 0) f = 0; else if (f >= 1) f = 0.999999;
        counts[(f * DENOISE_HIST_BINS) | 0]++; total++;
    }
    return { counts, total, vmin, vmax };
}

function histPercentileFracFromCounts(counts, total, p) {
    if (total <= 0) return p;
    const target = p * total;
    let cum = 0;
    for (let i = 0; i < DENOISE_HIST_BINS; i++) {
        cum += counts[i];
        if (cum >= target) return (i + 0.5) / DENOISE_HIST_BINS;
    }
    return 1;
}

/** 依 IQR 統計計算刪除雜點左右標籤的相對位置（0~1） */
function computeAutoDenoiseFracs(vals, vmin, vmax) {
    const { counts, total } = buildValueHistogram(vals, vmin, vmax);
    if (total < 4) return { lo: 0, hi: 1 };
    const span = (vmax - vmin) || 1;
    const valAt = (frac) => vmin + frac * span;
    const q1 = valAt(histPercentileFracFromCounts(counts, total, 0.25));
    const q3 = valAt(histPercentileFracFromCounts(counts, total, 0.75));
    const iqr = q3 - q1;
    let loV, hiV;
    if (iqr > 0) {
        loV = q1 - 1.5 * iqr;
        hiV = q3 + 1.5 * iqr;
    } else {
        loV = valAt(histPercentileFracFromCounts(counts, total, 0.025));
        hiV = valAt(histPercentileFracFromCounts(counts, total, 0.975));
    }
    const MIN_GAP = 0.005;
    let lo = (loV - vmin) / span;
    let hi = (hiV - vmin) / span;
    lo = Math.max(0, Math.min(1 - MIN_GAP, lo));
    hi = Math.min(1, Math.max(MIN_GAP, hi));
    if (hi - lo < MIN_GAP) { lo = 0; hi = 1; }
    return { lo, hi };
}

function batchApplyGlobalLevel(ds) {
    const acc = batchPlaneFitAccessors(ds);
    const plane = batchFitPlaneLeastSquares(acc);
    if (!plane) return { ok: false, reason: 'insufficient' };
    const { a, b } = plane;
    if (isPcdScatterDataset(ds)) {
        const z = ds.z;
        for (let i = 0; i < z.length; i++) {
            if (!acc.isValid(i)) continue;
            z[i] -= a * ds.x[i] + b * ds.y[i];
        }
    } else {
        batchEnsureFloatPixels(ds);
        const data = ds.data;
        for (let i = 0; i < data.length; i++) {
            if (!acc.isValid(i)) continue;
            data[i] -= a * acc.getX(i) + b * acc.getY(i);
        }
    }
    batchRefreshRange(ds);
    return { ok: true };
}

function batchApplyDenoise(ds, loFrac, hiFrac) {
    const src = isPcdScatterDataset(ds) ? ds.z : ds.data;
    const { vmin, vmax } = computeRange(src);
    const span = (vmax - vmin) || 1;
    const loV = vmin + loFrac * span;
    const hiV = vmin + hiFrac * span;
    let keep = 0;
    if (isPcdScatterDataset(ds)) {
        const { x, y, z } = ds, total = z.length;
        const mask = new Uint8Array(total);
        for (let i = 0; i < total; i++) {
            const v = z[i];
            if (Number.isFinite(v) && v >= loV && v <= hiV) { mask[i] = 1; keep++; }
        }
        const nx = new Float32Array(keep), ny = new Float32Array(keep), nz = new Float32Array(keep);
        let j = 0;
        for (let i = 0; i < total; i++) if (mask[i]) { nx[j] = x[i]; ny[j] = y[i]; nz[j] = z[i]; j++; }
        ds.x = nx; ds.y = ny; ds.z = nz; ds.pointCount = keep;
        batchRecomputeScatterBounds(ds);
    } else {
        batchEnsureFloatPixels(ds);
        const data = ds.data;
        for (let i = 0; i < data.length; i++) {
            const v = data[i];
            if (Number.isFinite(v) && v >= loV && v <= hiV) keep++;
            else data[i] = NaN;
        }
    }
    batchRefreshRange(ds);
    return { ok: true, keep };
}

function batchApplyDenoiseFromStep(ds, step) {
    let loFrac, hiFrac;
    if (step.auto) {
        const src = isPcdScatterDataset(ds) ? ds.z : ds.data;
        const { vmin, vmax } = computeRange(src);
        ({ lo: loFrac, hi: hiFrac } = computeAutoDenoiseFracs(src, vmin, vmax));
    } else {
        loFrac = step.lo;
        hiFrac = step.hi;
    }
    return batchApplyDenoise(ds, loFrac, hiFrac);
}

function batchApplyCalc(ds, op, operand) {
    if (isPcdScatterDataset(ds)) return { ok: false, reason: 'scatter' };
    if (!Number.isFinite(operand)) return { ok: false, reason: 'invalid' };
    if (op === '/' && operand === 0) return { ok: false, reason: 'divZero' };
    batchEnsureFloatPixels(ds);
    const src = ds.data;
    const dst = new Float32Array(src.length);
    switch (op) {
        case '+': for (let i = 0; i < src.length; i++) dst[i] = src[i] + operand; break;
        case '-': for (let i = 0; i < src.length; i++) dst[i] = src[i] - operand; break;
        case '*': for (let i = 0; i < src.length; i++) dst[i] = src[i] * operand; break;
        case '/': {
            const inv = 1 / operand;
            for (let i = 0; i < src.length; i++) dst[i] = src[i] * inv;
            break;
        }
        default: return { ok: false, reason: 'invalid' };
    }
    ds.data = dst;
    batchRefreshRange(ds);
    return { ok: true };
}

function batchApplyCrop(ds, step) {
    const circle = step.type === 'cropCircle';
    const r = { x0: step.x0, y0: step.y0, x1: step.x1, y1: step.y1 };
    if (isPcdScatterDataset(ds)) {
        const b = ds.bounds;
        const spanX = (b.xmax - b.xmin) || 1;
        const spanY = (b.ymax - b.ymin) || 1;
        const wx0 = b.xmin + r.x0 * spanX, wx1 = b.xmin + r.x1 * spanX;
        const wy0 = b.ymin + r.y0 * spanY, wy1 = b.ymin + r.y1 * spanY;
        const nr = {
            x0: (wx0 - b.xmin) / spanX, y0: (wy0 - b.ymin) / spanY,
            x1: (wx1 - b.xmin) / spanX, y1: (wy1 - b.ymin) / spanY,
        };
        const { x, y, z } = ds, total = z.length;
        let keep = 0;
        const mask = new Uint8Array(total);
        for (let i = 0; i < total; i++) {
            const nx = (x[i] - b.xmin) / spanX;
            const ny = (y[i] - b.ymin) / spanY;
            if (batchPointInNormRect(nx, ny, nr, circle)) { mask[i] = 1; keep++; }
        }
        if (keep === 0) return { ok: false, reason: 'empty' };
        const nx = new Float32Array(keep), ny = new Float32Array(keep), nz = new Float32Array(keep);
        let j = 0;
        for (let i = 0; i < total; i++) if (mask[i]) { nx[j] = x[i]; ny[j] = y[i]; nz[j] = z[i]; j++; }
        ds.x = nx; ds.y = ny; ds.z = nz; ds.pointCount = keep;
        batchRecomputeScatterBounds(ds);
    } else {
        batchEnsureFloatPixels(ds);
        const { data, width, height } = ds;
        const ix0 = r.x0 * width, ix1 = r.x1 * width;
        const iy0 = r.y0 * height, iy1 = r.y1 * height;
        const cx = (ix0 + ix1) * 0.5, cy = (iy0 + iy1) * 0.5;
        const rx = (ix1 - ix0) * 0.5, ry = (iy1 - iy0) * 0.5;
        let keep = 0;
        for (let iy = 0; iy < height; iy++) {
            for (let ix = 0; ix < width; ix++) {
                const px = (ix + 0.5) / width, py = (iy + 0.5) / height;
                let inside;
                if (circle) {
                    const dx = (ix + 0.5 - cx) / rx, dy = (iy + 0.5 - cy) / ry;
                    inside = rx > 0 && ry > 0 && dx * dx + dy * dy <= 1;
                } else {
                    inside = (ix + 0.5) >= ix0 && (ix + 0.5) <= ix1 && (iy + 0.5) >= iy0 && (iy + 0.5) <= iy1;
                }
                const idx = iy * width + ix;
                if (inside) { if (Number.isFinite(data[idx])) keep++; }
                else data[idx] = NaN;
            }
        }
        if (keep === 0) return { ok: false, reason: 'empty' };
    }
    batchRefreshRange(ds);
    return { ok: true };
}

function batchApplySegmentLevel(ds) {
    if (isPcdScatterDataset(ds)) return { ok: false, reason: 'scatter' };
    const analysis = analyzeSegmentLeveling(ds);
    if (!analysis.ok) return { ok: false, reason: analysis.reason || 'insufficient' };
    batchEnsureFloatPixels(ds);
    ds.data = analysis.correctedData.slice();
    batchRefreshRange(ds);
    return { ok: true };
}

function batchApplyStep(ds, step) {
    if (!step || !step.type) return { ok: false, reason: 'invalid' };
    switch (step.type) {
        case 'globalLevel': return batchApplyGlobalLevel(ds);
        case 'segmentLevel': return batchApplySegmentLevel(ds);
        case 'denoise': return batchApplyDenoiseFromStep(ds, step);
        case 'calc': return batchApplyCalc(ds, step.op, step.operand);
        case 'cropRect':
        case 'cropCircle': return batchApplyCrop(ds, step);
        default: return { ok: false, reason: 'unknown' };
    }
}

function batchApplyPipeline(ds, steps) {
    const out = cloneDatasetDeep(ds);
    for (const step of steps) {
        const res = batchApplyStep(out, step);
        if (!res.ok) return { ok: false, dataset: out, step, reason: res.reason };
    }
    return { ok: true, dataset: out };
}

function describeBatchStep(step) {
    if (!step) return '';
    switch (step.type) {
        case 'globalLevel': return t('bfmStepGlobalLevel');
        case 'segmentLevel': return t('bfmStepSegmentLevel');
        case 'denoise':
            if (step.auto) return t('bfmStepDenoiseAuto');
            return t('bfmStepDenoise', (step.lo * 100).toFixed(0) + '%', (step.hi * 100).toFixed(0) + '%');
        case 'calc': return t('bfmStepCalc', step.op, step.operand);
        case 'cropRect': return t('bfmStepCropRect');
        case 'cropCircle': return t('bfmStepCropCircle');
        default: return step.type;
    }
}

function batchKindLabel(kind) {
    return kind === 'pcd' ? t('batchEditKindPcd') : t('batchEditKindGrid');
}

function createEmptyBatchFile(sig, name) {
    return {
        format: BATCH_FILE_FORMAT,
        version: BATCH_FILE_VERSION,
        kind: sig.kind,
        width: sig.width,
        height: sig.height,
        name: name || t('bfmNamePlaceholder'),
        steps: [],
    };
}

function parseBatchFile(json) {
    if (!json || json.format !== BATCH_FILE_FORMAT) throw new Error('invalid');
    if (!json.kind || !json.width || !json.height || !Array.isArray(json.steps)) throw new Error('invalid');
    return json;
}

function datasetMatchesBatchFile(ds, batchFile) {
    const sig = getDatasetSignature(ds);
    return sig && batchFile && sig.kind === batchFile.kind &&
        sig.width === batchFile.width && sig.height === batchFile.height;
}

function renderGridThumbToCanvas(dataset, canvas, maxW, cmap) {
    const srcW = Math.max(1, dataset.width);
    const srcH = Math.max(1, dataset.height);
    const scale = maxW / srcW;
    const w = maxW;
    const h = Math.max(1, Math.round(srcH * scale));
    canvas.width = w;
    canvas.height = h;
    const { data, width, height } = dataset;
    const span = (dataset.vmax - dataset.vmin) || 1;
    const cmin = dataset.vmin;
    const crange = span;
    const lut = buildColormapLut(cmap || BATCH_EXPORT_CMAP);
    const img = canvas.getContext('2d').createImageData(w, h);
    const px = img.data;
    const stepX = width / w;
    const stepY = height / h;
    for (let py = 0; py < h; py++) {
        const sy = Math.min(height - 1, (py * stepY) | 0);
        const row = sy * width;
        const poBase = py * w * 4;
        for (let px_i = 0; px_i < w; px_i++) {
            const sx = Math.min(width - 1, (px_i * stepX) | 0);
            const po = poBase + px_i * 4;
            const v = data[row + sx];
            if (!Number.isFinite(v)) {
                px[po] = px[po + 1] = px[po + 2] = 0;
                px[po + 3] = 255;
                continue;
            }
            let t = (v - cmin) / crange;
            if (t < 0) t = 0; else if (t > 1) t = 1;
            const lo = ((t * 255) | 0) * 3;
            px[po]     = lut[lo];
            px[po + 1] = lut[lo + 1];
            px[po + 2] = lut[lo + 2];
            px[po + 3] = 255;
        }
    }
    canvas.getContext('2d').putImageData(img, 0, 0);
}

async function renderImageFileThumb(file, canvas, maxW) {
    maxW = maxW || 64;
    let bitmap;
    try {
        bitmap = await createImageBitmap(file, { resizeWidth: maxW, resizeQuality: 'low' });
    } catch (e) {
        bitmap = await createImageBitmap(file);
    }
    const tw = maxW;
    const th = Math.max(1, Math.round(maxW * bitmap.height / bitmap.width));
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, tw, th);
    if (bitmap.close) bitmap.close();
}

function isRasterImageFile(file) {
    const ext = getExt(file.name);
    return ext === 'bmp' || ext === 'png' || ext === 'jpg' || ext === 'jpeg';
}

function renderDatasetPreviewThumb(ds, canvas, maxW) {
    maxW = maxW || 140;
    if (isPcdScatterDataset(ds)) {
        const aspect = (ds.width || 1) / (ds.height || 1);
        const w = maxW;
        const h = Math.max(1, Math.round(w / aspect));
        canvas.width = w;
        canvas.height = h;
        renderScatterExportToCanvas(ds, canvas, BATCH_EXPORT_CMAP, w, h);
    } else if (maxW < ds.width || maxW < ds.height) {
        renderGridThumbToCanvas(ds, canvas, maxW, BATCH_EXPORT_CMAP);
    } else {
        const scale = maxW / Math.max(1, ds.width);
        const w = maxW;
        const h = Math.max(1, Math.round(ds.height * scale));
        canvas.width = w;
        canvas.height = h;
        const off = document.createElement('canvas');
        renderGridExportToCanvas(ds, off, BATCH_EXPORT_CMAP);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(off, 0, 0, w, h);
    }
}


