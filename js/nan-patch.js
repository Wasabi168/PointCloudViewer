/**
 * NaN 修補（高度圖後處理）
 * 依賴：file-parse.js (yieldToMain, LARGE_PIXEL_THRESHOLD)
 * 匯出（全域）：normalizeNanPatchKernelSize(), nanPatchPointInRoi(), applyNanPatch(), applyNanPatchAsync()
 */
/* =========================================================================
 *  NaN 修補：以鄰域平均值迭代填補缺失像素（可限定 ROI）
 * ========================================================================= */

const NAN_PATCH_KERNEL_OPTIONS = [3, 5, 7, 9, 11];
const NAN_PATCH_MAX_ITER = 100;

function nanPatchYield() {
    if (typeof yieldToMain === 'function') return yieldToMain();
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function nanPatchIsLarge(width, height) {
    const thresh = typeof LARGE_PIXEL_THRESHOLD !== 'undefined' ? LARGE_PIXEL_THRESHOLD : 2_000_000;
    return width * height >= thresh;
}

/** 正規化核心大小為奇數，且落在允許範圍內 */
function normalizeNanPatchKernelSize(kernelSize) {
    let k = Math.max(3, kernelSize | 0);
    if (k % 2 === 0) k++;
    const max = NAN_PATCH_KERNEL_OPTIONS[NAN_PATCH_KERNEL_OPTIONS.length - 1];
    if (k > max) k = max;
    return k;
}

/**
 * @param {number} px 正規化 x（0~1，像素中心）
 * @param {number} py 正規化 y
 * @param {{ shape: 'rect'|'circle', x0: number, y0: number, x1: number, y1: number }|null} roi
 */
function nanPatchPointInRoi(px, py, roi) {
    if (!roi) return true;
    const circle = roi.shape === 'circle';
    const x0 = roi.x0, y0 = roi.y0, x1 = roi.x1, y1 = roi.y1;
    if (!circle) return px >= x0 && px <= x1 && py >= y0 && py <= y1;
    const cx = (x0 + x1) * 0.5, cy = (y0 + y1) * 0.5;
    const rx = (x1 - x0) * 0.5, ry = (y1 - y0) * 0.5;
    if (rx <= 0 || ry <= 0) return false;
    const dx = (px - cx) / rx, dy = (py - cy) / ry;
    return dx * dx + dy * dy <= 1;
}

function nanPatchNeighborMean(data, width, height, x, y, half) {
    let sum = 0;
    let cnt = 0;
    for (let dy = -half; dy <= half; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        const nbRow = yy * width;
        for (let dx = -half; dx <= half; dx++) {
            if (dx === 0 && dy === 0) continue;
            const xx = x + dx;
            if (xx < 0 || xx >= width) continue;
            const v = data[nbRow + xx];
            if (Number.isFinite(v)) {
                sum += v;
                cnt++;
            }
        }
    }
    return cnt > 0 ? sum / cnt : NaN;
}

function nanPatchProcessPixel(orig, cur, next, width, height, x, y, half, roi) {
    const rowBase = y * width;
    const i = rowBase + x;
    const px = (x + 0.5) / width;
    const py = (y + 0.5) / height;
    if (roi && !nanPatchPointInRoi(px, py, roi)) {
        next[i] = orig[i];
        return false;
    }
    const src = cur[i];
    if (Number.isFinite(src)) {
        next[i] = src;
        return false;
    }
    const mean = nanPatchNeighborMean(cur, width, height, x, y, half);
    if (Number.isFinite(mean)) {
        next[i] = mean;
        return true;
    }
    next[i] = NaN;
    return false;
}

/**
 * @param {Float32Array} data
 * @param {number} width
 * @param {number} height
 * @param {number} kernelSize
 * @param {Float32Array} [outBuf]
 * @param {{ shape: 'rect'|'circle', x0: number, y0: number, x1: number, y1: number }|null} [roi]
 * @returns {Float32Array}
 */
function applyNanPatch(data, width, height, kernelSize, outBuf, roi) {
    const k = normalizeNanPatchKernelSize(kernelSize);
    const half = (k - 1) >> 1;
    const n = width * height;
    const cur = (outBuf && outBuf.length === n) ? outBuf : new Float32Array(n);
    const next = new Float32Array(n);
    const orig = data;
    cur.set(data);

    for (let iter = 0; iter < NAN_PATCH_MAX_ITER; iter++) {
        let changed = false;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (nanPatchProcessPixel(orig, cur, next, width, height, x, y, half, roi)) changed = true;
            }
        }
        cur.set(next);
        if (!changed) break;
    }
    return cur;
}

/**
 * @param {Float32Array} data
 * @param {number} width
 * @param {number} height
 * @param {number} kernelSize
 * @param {Float32Array} [outBuf]
 * @param {number} [rowsPerYield]
 * @param {() => boolean} [isCancelled]
 * @param {{ shape: 'rect'|'circle', x0: number, y0: number, x1: number, y1: number }|null} [roi]
 * @returns {Promise<Float32Array|null>}
 */
async function applyNanPatchAsync(data, width, height, kernelSize, outBuf, rowsPerYield, isCancelled, roi) {
    const k = normalizeNanPatchKernelSize(kernelSize);
    const half = (k - 1) >> 1;
    const n = width * height;
    const cur = (outBuf && outBuf.length === n) ? outBuf : new Float32Array(n);
    const next = new Float32Array(n);
    const orig = data;
    cur.set(data);
    const large = nanPatchIsLarge(width, height);
    const chunk = Math.max(8, rowsPerYield || 64);

    for (let iter = 0; iter < NAN_PATCH_MAX_ITER; iter++) {
        if (isCancelled && isCancelled()) return null;
        let changed = false;
        for (let y = 0; y < height; y++) {
            if (isCancelled && isCancelled()) return null;
            for (let x = 0; x < width; x++) {
                if (nanPatchProcessPixel(orig, cur, next, width, height, x, y, half, roi)) changed = true;
            }
            if (large && (y + 1) % chunk === 0) await nanPatchYield();
        }
        cur.set(next);
        if (!changed) break;
        if (large) await nanPatchYield();
    }
    return cur;
}
