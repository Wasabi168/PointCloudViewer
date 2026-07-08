/**
 * 中值濾波（高度圖後處理）
 * 依賴：file-parse.js (yieldToMain, LARGE_PIXEL_THRESHOLD)
 * 匯出（全域）：normalizeMedianKernelSize(), applyMedianFilter(), applyMedianFilterAsync()
 */
/* =========================================================================
 *  中值濾波：以鄰域中位數平滑表面、去除孤立尖峰
 * ========================================================================= */

const MEDIAN_FILTER_KERNEL_OPTIONS = [3, 5, 7, 9, 11];

function medianFilterYield() {
    if (typeof yieldToMain === 'function') return yieldToMain();
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function medianFilterIsLarge(width, height) {
    const thresh = typeof LARGE_PIXEL_THRESHOLD !== 'undefined' ? LARGE_PIXEL_THRESHOLD : 2_000_000;
    return width * height >= thresh;
}

/** 正規化核心大小為奇數，且落在允許範圍內 */
function normalizeMedianKernelSize(kernelSize) {
    let k = Math.max(3, kernelSize | 0);
    if (k % 2 === 0) k++;
    const max = MEDIAN_FILTER_KERNEL_OPTIONS[MEDIAN_FILTER_KERNEL_OPTIONS.length - 1];
    if (k > max) k = max;
    return k;
}

function medianOfSorted(buf, cnt) {
    return buf[(cnt - 1) >> 1];
}

function medianInsertSort(buf, cnt) {
    for (let a = 1; a < cnt; a++) {
        const t = buf[a];
        let b = a - 1;
        while (b >= 0 && buf[b] > t) {
            buf[b + 1] = buf[b];
            b--;
        }
        buf[b + 1] = t;
    }
    return medianOfSorted(buf, cnt);
}

/**
 * @param {Float32Array} data
 * @param {number} width
 * @param {number} height
 * @param {number} kernelSize
 * @param {Float32Array} [outBuf]
 * @returns {Float32Array}
 */
function applyMedianFilter(data, width, height, kernelSize, outBuf) {
    const k = normalizeMedianKernelSize(kernelSize);
    const half = (k - 1) >> 1;
    const n = width * height;
    const out = (outBuf && outBuf.length === n) ? outBuf : new Float32Array(n);
    const win = new Float64Array(k * k);
    const minNeighbors = Math.max(1, ((k * k) + 1) >> 1);

    for (let y = 0; y < height; y++) {
        const rowBase = y * width;
        for (let x = 0; x < width; x++) {
            const i = rowBase + x;
            const src = data[i];
            let cnt = 0;
            for (let dy = -half; dy <= half; dy++) {
                const yy = y + dy;
                if (yy < 0 || yy >= height) continue;
                const nbRow = yy * width;
                for (let dx = -half; dx <= half; dx++) {
                    const xx = x + dx;
                    if (xx < 0 || xx >= width) continue;
                    const v = data[nbRow + xx];
                    if (Number.isFinite(v)) win[cnt++] = v;
                }
            }
            if (cnt < minNeighbors) {
                out[i] = Number.isFinite(src) ? src : NaN;
            } else {
                out[i] = medianInsertSort(win, cnt);
            }
        }
    }
    return out;
}

/**
 * @param {Float32Array} data
 * @param {number} width
 * @param {number} height
 * @param {number} kernelSize
 * @param {Float32Array} [outBuf]
 * @param {number} [rowsPerYield]
 * @param {() => boolean} [isCancelled]
 * @returns {Promise<Float32Array|null>}
 */
async function applyMedianFilterAsync(data, width, height, kernelSize, outBuf, rowsPerYield, isCancelled) {
    const k = normalizeMedianKernelSize(kernelSize);
    const half = (k - 1) >> 1;
    const n = width * height;
    const out = (outBuf && outBuf.length === n) ? outBuf : new Float32Array(n);
    const win = new Float64Array(k * k);
    const minNeighbors = Math.max(1, ((k * k) + 1) >> 1);
    const chunk = Math.max(8, rowsPerYield || 64);
    const large = medianFilterIsLarge(width, height);

    for (let y = 0; y < height; y++) {
        if (isCancelled && isCancelled()) return null;
        const rowBase = y * width;
        for (let x = 0; x < width; x++) {
            const i = rowBase + x;
            const src = data[i];
            let cnt = 0;
            for (let dy = -half; dy <= half; dy++) {
                const yy = y + dy;
                if (yy < 0 || yy >= height) continue;
                const nbRow = yy * width;
                for (let dx = -half; dx <= half; dx++) {
                    const xx = x + dx;
                    if (xx < 0 || xx >= width) continue;
                    const v = data[nbRow + xx];
                    if (Number.isFinite(v)) win[cnt++] = v;
                }
            }
            if (cnt < minNeighbors) {
                out[i] = Number.isFinite(src) ? src : NaN;
            } else {
                out[i] = medianInsertSort(win, cnt);
            }
        }
        if (large && (y + 1) % chunk === 0) await medianFilterYield();
    }
    return out;
}
