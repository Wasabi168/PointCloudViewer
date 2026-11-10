/**
 * 單向水平校正
 * 依賴：segment-level.js（segLevelPhysicalScale、segLevelExtractProfileAt、segLevelClampProfileIndex、
 *   segLevelFitProfileSegment、segLevelSubtractAxisGlobal、segLevelIsLarge、segLevelYield）
 * 匯出（全域）：uniLevelSegDirection(), uniLevelAxisScale(), uniLevelFitAt(), uniLevelApply(), uniLevelApplyAsync()
 */
/* =========================================================================
 *  單向水平校正：依一條校正線的高度擬合斜率，再對整張圖扣除該方向傾斜
 *  - 水平校正線：取單一列，擬合 dZ/dX，全圖扣除 k×(x−中心)×dx
 *  - 垂直校正線：取單一欄，擬合 dZ/dY，全圖扣除 k×(y−中心)×dy
 *  - 只改一個方向，截距留在影像中心
 * ========================================================================= */

/** 水平校正線對應分區演算法的垂直軸；垂直校正線對應水平軸。 */
function uniLevelSegDirection(lineDir) {
    return lineDir === 'horizontal' ? 'vertical' : 'horizontal';
}

function uniLevelAxisScale(header, width, height, lineDir) {
    const { dx, dy } = segLevelPhysicalScale(header, width, height);
    return lineDir === 'horizontal' ? dx : dy;
}

function uniLevelCountFinite(vals) {
    let n = 0;
    if (!vals) return 0;
    for (let i = 0; i < vals.length; i++) if (Number.isFinite(vals[i])) n++;
    return n;
}

/**
 * 依校正線擬合 z = k·t + c。t 為相對該軸中心的物理距離。
 * @param {'horizontal'|'vertical'} lineDir 水平校正線或垂直校正線
 * @param {number} index 水平線為列（Y），垂直線為欄（X）；省略時用正中間
 */
function uniLevelFitAt(data, width, height, header, lineDir, index) {
    const segDir = uniLevelSegDirection(lineDir);
    const scale = uniLevelAxisScale(header, width, height, lineDir);
    const probeIndex = segLevelClampProfileIndex(width, height, segDir, index);
    const vals = segLevelExtractProfileAt(data, width, height, segDir, probeIndex);
    const n = uniLevelCountFinite(vals);
    const fit = segLevelFitProfileSegment(vals, 0, vals.length, scale);
    if (!fit || !Number.isFinite(fit.k)) {
        return { ok: false, reason: 'insufficient', n, scale, probeIndex, vals, segDir, lineDir };
    }
    return {
        ok: true,
        k: fit.k,
        c: fit.c,
        n,
        center: fit.center,
        scale,
        probeIndex,
        vals,
        segDir,
        lineDir,
    };
}

/**
 * 對整張圖扣除單一方向的傾斜。水平線沿 X，垂直線沿 Y。
 * @param {Float32Array} [outBuf] 可重用的輸出緩衝
 */
function uniLevelApply(source, width, height, lineDir, scale, k, center, outBuf) {
    const out = (outBuf && outBuf.length === source.length)
        ? outBuf
        : new Float32Array(source.length);
    out.set(source);
    if (!Number.isFinite(k) || !Number.isFinite(scale) || !Number.isFinite(center)) return out;
    segLevelSubtractAxisGlobal(out, width, height, uniLevelSegDirection(lineDir), scale, k, center);
    return out;
}

/**
 * 大圖版本：複製後逐列／逐欄扣除，並可中途取消。
 * @param {() => boolean} [isCancelled]
 */
async function uniLevelApplyAsync(source, width, height, lineDir, scale, k, center, outBuf, isCancelled) {
    const out = (outBuf && outBuf.length === source.length)
        ? outBuf
        : new Float32Array(source.length);
    out.set(source);
    if (isCancelled && isCancelled()) return null;
    if (!Number.isFinite(k) || !Number.isFinite(scale) || !Number.isFinite(center)) return out;
    if (!segLevelIsLarge(width, height)) {
        segLevelSubtractAxisGlobal(out, width, height, uniLevelSegDirection(lineDir), scale, k, center);
        return (isCancelled && isCancelled()) ? null : out;
    }

    const segDir = uniLevelSegDirection(lineDir);
    const yieldEvery = 32;
    if (segDir === 'horizontal') {
        for (let y = 0; y < height; y++) {
            const sub = k * (y - center) * scale;
            const row = y * width;
            for (let x = 0; x < width; x++) {
                const v = out[row + x];
                if (Number.isFinite(v)) out[row + x] = v - sub;
            }
            if ((y & (yieldEvery - 1)) === 0) {
                await segLevelYield();
                if (isCancelled && isCancelled()) return null;
            }
        }
    } else {
        for (let x = 0; x < width; x++) {
            const sub = k * (x - center) * scale;
            for (let y = 0; y < height; y++) {
                const idx = y * width + x;
                const v = out[idx];
                if (Number.isFinite(v)) out[idx] = v - sub;
            }
            if ((x & (yieldEvery - 1)) === 0) {
                await segLevelYield();
                if (isCancelled && isCancelled()) return null;
            }
        }
    }
    return out;
}
