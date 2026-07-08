/**
 * 自動分區錯位校正（skew / shear）
 * 依賴：segment-level.js（segLevelDetectDirection*, segLevelEqualBoundaryIndices, segLevelBoundaryOptionsForDirection, segLevelMaxValidBandCount, segLevelYield）
 * 匯出（全域）：analyzeSegmentSkew(), analyzeSegmentSkewAsync(), analyzeSegmentSkewWithParams(), analyzeSegmentSkewWithParamsAsync(),
 *   applySegmentSkew(), applySegmentSkewAsync(), segSkewBoundaryOptionsForDirection(),
 *   segSkewDetectDirection(), segSkewDetectDirectionAsync()
 */
/* =========================================================================
 *  分區錯位校正：偵測分割方向與帶數 → 各帶套用共用 pixel shift（線性漸變位移）→ 拼回
 *  對應 BLUEPICK Skew Correction（split + skew + stitch）
 * ========================================================================= */

function segSkewYield() {
    if (typeof segLevelYield === 'function') return segLevelYield();
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function segSkewIsLarge(width, height) {
    const thresh = typeof LARGE_PIXEL_THRESHOLD !== 'undefined' ? LARGE_PIXEL_THRESHOLD : 2_000_000;
    return width * height >= thresh;
}

function segSkewCountValid(data) {
    let n = 0;
    for (let i = 0; i < data.length; i++) if (Number.isFinite(data[i])) n++;
    return n;
}

/**
 * 對單一帶高度圖做 skew（與 BLUEPICK skew.py 相同語意）
 * @param {Float32Array|Float64Array} band flat band data
 * @param {number} w band width
 * @param {number} h band height
 * @param {'horizontal'|'vertical'} direction
 * @param {number} totalShift pixels, linear from 0 at start to totalShift at end of skew axis
 * @param {number} fillValue
 */
function segSkewTransformBand(band, w, h, direction, totalShift, fillValue) {
    const out = new Float32Array(band.length);
    out.fill(fillValue);

    if (direction === 'horizontal') {
        const L = h;
        for (let y = 0; y < h; y++) {
            const offset = L <= 1 ? totalShift : totalShift * y / (L - 1);
            const rowBase = y * w;
            for (let x = 0; x < w; x++) {
                const srcX = x - offset;
                if (srcX <= 0) {
                    out[rowBase + x] = Number.isFinite(band[rowBase]) ? band[rowBase] : fillValue;
                } else if (srcX >= w - 1) {
                    out[rowBase + x] = fillValue;
                } else {
                    const i0 = Math.floor(srcX);
                    const i1 = i0 + 1;
                    const a = band[rowBase + i0];
                    const b = band[rowBase + i1];
                    if (!Number.isFinite(a) || !Number.isFinite(b)) out[rowBase + x] = fillValue;
                    else {
                        const t = srcX - i0;
                        out[rowBase + x] = a + t * (b - a);
                    }
                }
            }
        }
    } else {
        const L = w;
        for (let x = 0; x < w; x++) {
            const offset = L <= 1 ? totalShift : totalShift * x / (L - 1);
            for (let y = 0; y < h; y++) {
                const srcY = y - offset;
                const dstIdx = y * w + x;
                if (srcY <= 0) {
                    out[dstIdx] = Number.isFinite(band[x]) ? band[x] : fillValue;
                } else if (srcY >= h - 1) {
                    out[dstIdx] = fillValue;
                } else {
                    const i0 = Math.floor(srcY);
                    const i1 = i0 + 1;
                    const a = band[i0 * w + x];
                    const b = band[i1 * w + x];
                    if (!Number.isFinite(a) || !Number.isFinite(b)) out[dstIdx] = fillValue;
                    else {
                        const t = srcY - i0;
                        out[dstIdx] = a + t * (b - a);
                    }
                }
            }
        }
    }
    return out;
}

function segSkewBandSplits(boundaries, axisLen) {
    const splits = [0, ...(boundaries || []), axisLen];
    return splits;
}

function segSkewExtractBand(data, width, height, direction, i0, i1) {
    if (direction === 'horizontal') {
        const bh = i1 - i0;
        const band = new Float32Array(width * bh);
        for (let y = 0; y < bh; y++) {
            const srcBase = (i0 + y) * width;
            const dstBase = y * width;
            band.set(data.subarray(srcBase, srcBase + width), dstBase);
        }
        return { band, w: width, h: bh };
    }
    const bw = i1 - i0;
    const band = new Float32Array(bw * height);
    for (let y = 0; y < height; y++) {
        const rowBase = y * width;
        const dstBase = y * bw;
        for (let x = 0; x < bw; x++) band[dstBase + x] = data[rowBase + i0 + x];
    }
    return { band, w: bw, h: height };
}

function segSkewWriteBand(out, width, height, direction, i0, i1, band, bw, bh) {
    if (direction === 'horizontal') {
        for (let y = 0; y < bh; y++) {
            const dstBase = (i0 + y) * width;
            const srcBase = y * bw;
            out.set(band.subarray(srcBase, srcBase + bw), dstBase);
        }
    } else {
        for (let y = 0; y < height; y++) {
            const dstBase = y * width + i0;
            const srcBase = y * bw;
            out.set(band.subarray(srcBase, srcBase + bw), dstBase);
        }
    }
}

/**
 * 分割 → 各帶 skew → 拼回（共用 totalShift）
 */
function applySegmentSkew(data, width, height, direction, boundaries, totalShift, outBuf) {
    const fillValue = NaN;
    const axisLen = direction === 'horizontal' ? height : width;
    const splits = segSkewBandSplits(boundaries, axisLen);
    const out = outBuf instanceof Float32Array && outBuf.length === data.length
        ? outBuf
        : new Float32Array(data.length);
    out.fill(fillValue);

    const shift = Number.isFinite(totalShift) ? totalShift : 0;
    for (let bi = 0; bi < splits.length - 1; bi++) {
        const i0 = splits[bi];
        const i1 = splits[bi + 1];
        const { band, w, h } = segSkewExtractBand(data, width, height, direction, i0, i1);
        const corrected = segSkewTransformBand(band, w, h, direction, shift, fillValue);
        segSkewWriteBand(out, width, height, direction, i0, i1, corrected, w, h);
    }
    return out;
}

async function applySegmentSkewAsync(data, width, height, direction, boundaries, totalShift, outBuf, yieldEvery, isCancelled) {
    const fillValue = NaN;
    const axisLen = direction === 'horizontal' ? height : width;
    const splits = segSkewBandSplits(boundaries, axisLen);
    const out = outBuf instanceof Float32Array && outBuf.length === data.length
        ? outBuf
        : new Float32Array(data.length);
    out.fill(fillValue);
    const large = segSkewIsLarge(width, height);
    const yEvery = yieldEvery || 64;
    const shift = Number.isFinite(totalShift) ? totalShift : 0;

    for (let bi = 0; bi < splits.length - 1; bi++) {
        if (isCancelled && isCancelled()) return null;
        const i0 = splits[bi];
        const i1 = splits[bi + 1];
        const { band, w, h } = segSkewExtractBand(data, width, height, direction, i0, i1);
        const corrected = segSkewTransformBand(band, w, h, direction, shift, fillValue);
        segSkewWriteBand(out, width, height, direction, i0, i1, corrected, w, h);
        if (large) await segSkewYield();
    }
    return out;
}

function segSkewBestCorrShift(a, b, maxShift) {
    const n = Math.min(a.length, b.length);
    if (n < 8) return 0;
    let bestS = 0;
    let bestC = -Infinity;
    const ms = Math.max(1, maxShift | 0);
    for (let s = -ms; s <= ms; s++) {
        let sumA = 0, sumB = 0, sumAB = 0, sumA2 = 0, sumB2 = 0, cnt = 0;
        for (let i = 0; i < n; i++) {
            const j = i + s;
            if (j < 0 || j >= n) continue;
            const va = a[i];
            const vb = b[j];
            if (!Number.isFinite(va) || !Number.isFinite(vb)) continue;
            sumA += va; sumB += vb;
            sumAB += va * vb;
            sumA2 += va * va;
            sumB2 += vb * vb;
            cnt++;
        }
        if (cnt < 8) continue;
        const num = cnt * sumAB - sumA * sumB;
        const den = Math.sqrt((cnt * sumA2 - sumA * sumA) * (cnt * sumB2 - sumB * sumB));
        const c = den > 1e-12 ? num / den : 0;
        if (c > bestC) { bestC = c; bestS = s; }
    }
    return bestS;
}

function segSkewMaxShiftForBand(bandLen) {
    return Math.min(60, Math.max(35, Math.floor(bandLen * 0.05) + 20));
}

/** 在等分邊界附近取接縫能量峰值 */
function segSkewBoundaryPeak(edgeProf, boundary, radius) {
    let peak = 0;
    const i0 = Math.max(0, boundary - radius);
    const i1 = Math.min(edgeProf.length - 1, boundary + radius);
    for (let i = i0; i <= i1; i++) {
        if (edgeProf[i] > peak) peak = edgeProf[i];
    }
    return peak;
}

/**
 * 等分邊界與接縫剖面對齊分數：各邊界峰值的最小值 × 總和（弱接縫會拉低分數，避免過度分割）
 */
function segSkewScoreEqualBoundaries(edgeProf, boundaries, axisLen) {
    if (!boundaries || !boundaries.length) return 0;
    const radius = Math.max(8, Math.floor(axisLen / 200));
    const peaks = [];
    for (const b of boundaries) peaks.push(segSkewBoundaryPeak(edgeProf, b, radius));
    const minP = Math.min(...peaks);
    let sumP = 0;
    for (const p of peaks) sumP += p;
    return minP * sumP;
}

function segSkewPickEqualBandCount(edgeProf, axisLen, options) {
    const minDist = options.minDist;
    const edgeMargin = options.edgeMargin;
    const maxBands = options.maxBands != null ? options.maxBands : 8;
    let bestBands = 2;
    let bestScore = 0;
    for (let bands = 2; bands <= maxBands; bands++) {
        const boundaries = segSkewEqualBoundaries(axisLen, bands);
        if (typeof segLevelValidateEqualBoundaries === 'function'
            && !segLevelValidateEqualBoundaries(boundaries, axisLen, minDist, edgeMargin)) {
            continue;
        }
        const score = segSkewScoreEqualBoundaries(edgeProf, boundaries, axisLen);
        if (score > bestScore || (Math.abs(score - bestScore) < bestScore * 0.02 && bands < bestBands)) {
            bestScore = score;
            bestBands = bands;
        }
    }
    return { bandCount: bestBands, score: bestScore };
}

/** 錯位校正專用：以接縫邊緣剖面決定方向與等分帶數（不用高度平台變異） */
function segSkewDetectDirection(data, width, height) {
    const edgeH = typeof segLevelEdgeProfile === 'function'
        ? segLevelEdgeProfile(data, width, height, 'horizontal')
        : new Float64Array(height);
    const edgeV = typeof segLevelEdgeProfile === 'function'
        ? segLevelEdgeProfile(data, width, height, 'vertical')
        : new Float64Array(width);
    const minDistH = Math.max(20, Math.floor(height / 8));
    const minDistV = Math.max(20, Math.floor(width / 8));
    const marginH = Math.max(2, Math.floor(height * 0.02));
    const marginV = Math.max(2, Math.floor(width * 0.02));
    const maxH = typeof segLevelMaxValidBandCount === 'function'
        ? segLevelMaxValidBandCount(height, minDistH, marginH) : 8;
    const maxV = typeof segLevelMaxValidBandCount === 'function'
        ? segLevelMaxValidBandCount(width, minDistV, marginV) : 8;

    const rowPick = segSkewPickEqualBandCount(edgeH, height, {
        minDist: minDistH, edgeMargin: marginH, maxBands: maxH,
    });
    const colPick = segSkewPickEqualBandCount(edgeV, width, {
        minDist: minDistV, edgeMargin: marginV, maxBands: maxV,
    });

    if (colPick.score >= rowPick.score) {
        return {
            direction: 'vertical',
            boundaries: segSkewEqualBoundaries(width, colPick.bandCount),
            score: colPick.score,
        };
    }
    return {
        direction: 'horizontal',
        boundaries: segSkewEqualBoundaries(height, rowPick.bandCount),
        score: rowPick.score,
    };
}

async function segSkewDetectDirectionAsync(data, width, height, yieldEvery) {
    const large = segSkewIsLarge(width, height);
    if (large) await segSkewYield();
    let edgeH, edgeV;
    if (typeof segLevelEdgeProfileAsync === 'function') {
        edgeH = await segLevelEdgeProfileAsync(data, width, height, 'horizontal', yieldEvery || 64);
        if (large) await segSkewYield();
        edgeV = await segLevelEdgeProfileAsync(data, width, height, 'vertical', yieldEvery || 64);
    } else {
        edgeH = typeof segLevelEdgeProfile === 'function'
            ? segLevelEdgeProfile(data, width, height, 'horizontal')
            : new Float64Array(height);
        edgeV = typeof segLevelEdgeProfile === 'function'
            ? segLevelEdgeProfile(data, width, height, 'vertical')
            : new Float64Array(width);
    }
    const minDistH = Math.max(20, Math.floor(height / 8));
    const minDistV = Math.max(20, Math.floor(width / 8));
    const marginH = Math.max(2, Math.floor(height * 0.02));
    const marginV = Math.max(2, Math.floor(width * 0.02));
    const maxH = typeof segLevelMaxValidBandCount === 'function'
        ? segLevelMaxValidBandCount(height, minDistH, marginH) : 8;
    const maxV = typeof segLevelMaxValidBandCount === 'function'
        ? segLevelMaxValidBandCount(width, minDistV, marginV) : 8;

    const rowPick = segSkewPickEqualBandCount(edgeH, height, {
        minDist: minDistH, edgeMargin: marginH, maxBands: maxH,
    });
    const colPick = segSkewPickEqualBandCount(edgeV, width, {
        minDist: minDistV, edgeMargin: marginV, maxBands: maxV,
    });

    if (colPick.score >= rowPick.score) {
        return {
            direction: 'vertical',
            boundaries: segSkewEqualBoundaries(width, colPick.bandCount),
            score: colPick.score,
        };
    }
    return {
        direction: 'horizontal',
        boundaries: segSkewEqualBoundaries(height, rowPick.bandCount),
        score: rowPick.score,
    };
}

function segSkewAvgStrip(data, width, height, direction, i0, i1, pos) {
    if (direction === 'vertical') {
        const out = new Float64Array(height);
        const x0 = Math.max(i0, pos - 2);
        const x1 = Math.min(i1 - 1, pos + 2);
        for (let y = 0; y < height; y++) {
            let sum = 0, c = 0;
            const rowBase = y * width;
            for (let x = x0; x <= x1; x++) {
                const v = data[rowBase + x];
                if (Number.isFinite(v)) { sum += v; c++; }
            }
            out[y] = c > 0 ? sum / c : NaN;
        }
        return out;
    }
    const out = new Float64Array(width);
    const y0 = Math.max(i0, pos - 2);
    const y1 = Math.min(i1 - 1, pos + 2);
    for (let x = 0; x < width; x++) {
        let sum = 0, c = 0;
        for (let y = y0; y <= y1; y++) {
            const v = data[y * width + x];
            if (Number.isFinite(v)) { sum += v; c++; }
        }
        out[x] = c > 0 ? sum / c : NaN;
    }
    return out;
}

function segSkewSolve2x2(m00, m01, m11, b0, b1) {
    const det = m00 * m11 - m01 * m01;
    if (Math.abs(det) < 1e-12) return null;
    return [(b0 * m11 - b1 * m01) / det, (m00 * b1 - m01 * b0) / det];
}

/** 估算單一帶內沿 skew 軸的線性位移總量（pixel）；以帶左／上緣為參考做線性擬合 */
function segSkewEstimateBandTotalShift(data, width, height, direction, i0, i1) {
    const bandLen = i1 - i0;
    if (bandLen < 3) return 0;
    const margin = Math.max(4, Math.floor(bandLen * 0.04));
    const inner0 = i0 + margin;
    const inner1 = i1 - margin;
    if (inner1 - inner0 < 3) return 0;

    const maxShift = segSkewMaxShiftForBand(bandLen);
    const step = Math.max(1, Math.floor((inner1 - inner0) / 16));
    const refPos = i0 + Math.min(4, Math.max(1, Math.floor(bandLen * 0.008)));
    const ref = segSkewAvgStrip(data, width, height, direction, i0, i1, refPos);

    let st = 0, sz = 0, stt = 0, stz = 0, n = 0;

    if (direction === 'horizontal') {
        for (let y = inner0; y < inner1; y += step) {
            const row = segSkewAvgStrip(data, width, height, direction, i0, i1, y);
            const s = segSkewBestCorrShift(ref, row, maxShift);
            const t = y - i0;
            st += t; sz += s; stt += t * t; stz += t * s; n++;
        }
    } else {
        for (let x = inner0; x < inner1; x += step) {
            const col = segSkewAvgStrip(data, width, height, direction, i0, i1, x);
            const s = segSkewBestCorrShift(ref, col, maxShift);
            const t = x - i0;
            st += t; sz += s; stt += t * t; stz += t * s; n++;
        }
    }

    if (n < 2) return 0;
    const sol = segSkewSolve2x2(stt, st, n, stz, sz);
    if (!sol) return 0;

    const endPos = i1 - margin - Math.min(4, Math.max(1, Math.floor(bandLen * 0.008)));
    const span = Math.max(1, endPos - refPos);
    const linear = sol[0] * span;

    const endRef = segSkewAvgStrip(data, width, height, direction, i0, i1, endPos);
    const edge = segSkewBestCorrShift(ref, endRef, maxShift);

    if (!Number.isFinite(linear) && Number.isFinite(edge)) return edge;
    if (!Number.isFinite(edge)) return linear;
    if (Math.abs(linear) < 1) return edge;
    if (Math.abs(edge) < 1) return linear;
    if (Math.sign(linear) === Math.sign(edge)) return (linear + edge) * 0.5;
    return Math.abs(linear) >= Math.abs(edge) ? linear : edge;
}

/** 在接縫處量測校正後殘餘錯位（越小越好）；maxShift 宜小，避免週期圖樣假匹配 */
function segSkewSeamResidualScore(data, width, height, direction, boundaries, maxShift) {
    if (!boundaries || !boundaries.length) return 0;
    const win = Math.max(12, Math.min(40, Math.floor((direction === 'vertical' ? width : height) / 100)));
    const ms = Number.isFinite(maxShift) ? Math.max(3, maxShift | 0) : 8;
    const yStep = Math.max(120, Math.floor(height / 20));
    const xStep = Math.max(120, Math.floor(width / 20));
    const yMargin = Math.max(40, Math.floor(height * 0.03));
    const xMargin = Math.max(40, Math.floor(width * 0.03));
    let sum = 0;
    let cnt = 0;

    if (direction === 'vertical') {
        for (const bx of boundaries) {
            for (let y = yMargin; y < height - yMargin; y += yStep) {
                const y0 = Math.max(0, y - 50);
                const y1 = Math.min(height, y + 50);
                const len = y1 - y0;
                const left = new Float64Array(len);
                const right = new Float64Array(len);
                for (let yi = y0; yi < y1; yi++) {
                    let ls = 0, lc = 0, rs = 0, rc = 0;
                    const rowBase = yi * width;
                    for (let x = Math.max(0, bx - win); x < bx; x++) {
                        const v = data[rowBase + x];
                        if (Number.isFinite(v)) { ls += v; lc++; }
                    }
                    for (let x = bx; x < Math.min(width, bx + win); x++) {
                        const v = data[rowBase + x];
                        if (Number.isFinite(v)) { rs += v; rc++; }
                    }
                    left[yi - y0] = lc > 0 ? ls / lc : NaN;
                    right[yi - y0] = rc > 0 ? rs / rc : NaN;
                }
                sum += Math.abs(segSkewBestCorrShift(left, right, ms));
                cnt++;
            }
        }
    } else {
        for (const by of boundaries) {
            for (let x = xMargin; x < width - xMargin; x += xStep) {
                const x0 = Math.max(0, x - 50);
                const x1 = Math.min(width, x + 50);
                const len = x1 - x0;
                const top = new Float64Array(len);
                const bot = new Float64Array(len);
                for (let xi = x0; xi < x1; xi++) {
                    let ts = 0, tc = 0, bs = 0, bc = 0;
                    for (let y = Math.max(0, by - win); y < by; y++) {
                        const v = data[y * width + xi];
                        if (Number.isFinite(v)) { ts += v; tc++; }
                    }
                    for (let y = by; y < Math.min(height, by + win); y++) {
                        const v = data[y * width + xi];
                        if (Number.isFinite(v)) { bs += v; bc++; }
                    }
                    top[xi - x0] = tc > 0 ? ts / tc : NaN;
                    bot[xi - x0] = bc > 0 ? bs / bc : NaN;
                }
                sum += Math.abs(segSkewBestCorrShift(top, bot, ms));
                cnt++;
            }
        }
    }
    return cnt > 0 ? sum / cnt : 0;
}

/** 以首帶線性估算為中心，在接縫殘餘錯位意義下窄範圍微調（避免寬搜尋週期假匹配） */
function segSkewRefineSharedShift(data, width, height, direction, boundaries, guess) {
    const center = Math.round(guess);
    const span = Math.abs(center) >= 12 ? 12 : 20;
    const seamMs = 8;
    let best = center;
    let bestScore = Infinity;

    const scoreAt = (sh) => {
        const corrected = applySegmentSkew(data, width, height, direction, boundaries, sh);
        return segSkewSeamResidualScore(corrected, width, height, direction, boundaries, seamMs);
    };

    for (let sh = center - span; sh <= center + span; sh++) {
        const score = scoreAt(sh);
        if (score < bestScore) {
            bestScore = score;
            best = sh;
        }
    }
    for (let sh = best - 3; sh <= best + 3; sh++) {
        const score = scoreAt(sh);
        if (score < bestScore) {
            bestScore = score;
            best = sh;
        }
    }
    return best;
}

async function segSkewRefineSharedShiftAsync(data, width, height, direction, boundaries, guess, isCancelled) {
    const center = Math.round(guess);
    const span = Math.abs(center) >= 12 ? 12 : 20;
    const seamMs = 8;
    let best = center;
    let bestScore = Infinity;

    const scoreAt = async (sh) => {
        const corrected = await applySegmentSkewAsync(
            data, width, height, direction, boundaries, sh, null, 64, isCancelled,
        );
        if (!corrected) return Infinity;
        return segSkewSeamResidualScore(corrected, width, height, direction, boundaries, seamMs);
    };

    for (let sh = center - span; sh <= center + span; sh++) {
        if (isCancelled && isCancelled()) return center;
        const score = await scoreAt(sh);
        if (score < bestScore) {
            bestScore = score;
            best = sh;
        }
        if (segSkewIsLarge(width, height)) await segSkewYield();
    }

    for (let sh = best - 3; sh <= best + 3; sh++) {
        if (isCancelled && isCancelled()) return best;
        const score = await scoreAt(sh);
        if (score < bestScore) {
            bestScore = score;
            best = sh;
        }
        await segSkewYield();
    }
    return best;
}

/**
 * 各帶估算 shift 彙整為全圖共用值：首帶為主（最不受接縫干擾），再依接縫殘差微調
 */
function segSkewEstimateSharedShift(data, width, height, direction, boundaries) {
    const axisLen = direction === 'horizontal' ? height : width;
    const splits = segSkewBandSplits(boundaries, axisLen);
    const estimates = [];
    for (let bi = 0; bi < splits.length - 1; bi++) {
        const v = segSkewEstimateBandTotalShift(data, width, height, direction, splits[bi], splits[bi + 1]);
        if (Number.isFinite(v)) estimates.push(v);
    }
    if (!estimates.length) return 0;

    const band1 = estimates[0];
    if (Number.isFinite(band1) && Math.abs(band1) >= 8) {
        return Math.round(band1);
    }

    let guess = estimates[0];
    const sameSign = estimates.filter(
        (e) => Number.isFinite(e) && Math.sign(e) === Math.sign(guess) && Math.abs(e) > 3,
    );
    if (sameSign.length >= 2) {
        sameSign.sort((a, b) => a - b);
        const mid = sameSign.length >> 1;
        guess = sameSign.length % 2 ? sameSign[mid] : (sameSign[mid - 1] + sameSign[mid]) / 2;
    }

    const rounded = Math.round(guess);
    const refined = segSkewRefineSharedShift(data, width, height, direction, boundaries, guess);
    if (Math.abs(refined - rounded) <= 5) return refined;
    return rounded;
}

async function segSkewEstimateSharedShiftAsync(data, width, height, direction, boundaries, isCancelled) {
    const axisLen = direction === 'horizontal' ? height : width;
    const splits = segSkewBandSplits(boundaries, axisLen);
    const estimates = [];
    for (let bi = 0; bi < splits.length - 1; bi++) {
        if (isCancelled && isCancelled()) return 0;
        const v = segSkewEstimateBandTotalShift(data, width, height, direction, splits[bi], splits[bi + 1]);
        if (Number.isFinite(v)) estimates.push(v);
        if (segSkewIsLarge(width, height)) await segSkewYield();
    }
    if (!estimates.length) return 0;

    const band1 = estimates[0];
    if (Number.isFinite(band1) && Math.abs(band1) >= 8) {
        return Math.round(band1);
    }

    let guess = estimates[0];
    const sameSign = estimates.filter(
        (e) => Number.isFinite(e) && Math.sign(e) === Math.sign(guess) && Math.abs(e) > 3,
    );
    if (sameSign.length >= 2) {
        sameSign.sort((a, b) => a - b);
        const mid = sameSign.length >> 1;
        guess = sameSign.length % 2 ? sameSign[mid] : (sameSign[mid - 1] + sameSign[mid]) / 2;
    }

    const rounded = Math.round(guess);
    const refined = await segSkewRefineSharedShiftAsync(
        data, width, height, direction, boundaries, guess, isCancelled,
    );
    if (isCancelled && isCancelled()) return rounded;
    if (Math.abs(refined - rounded) <= 5) return refined;
    return rounded;
}

function segSkewBoundaryOptionsForDirection(width, height, direction) {
    if (typeof segLevelBoundaryOptionsForDirection === 'function') {
        return segLevelBoundaryOptionsForDirection(width, height, direction);
    }
    const horizontal = direction === 'horizontal';
    const axisLen = horizontal ? height : width;
    const minDist = Math.max(20, Math.floor(axisLen / 8));
    const edgeMargin = Math.max(2, Math.floor(axisLen * 0.02));
    return { axisLen, minDist, edgeMargin };
}

function segSkewEqualBoundaries(axisLen, bandCount) {
    if (typeof segLevelEqualBoundaryIndices === 'function') {
        return segLevelEqualBoundaryIndices(axisLen, bandCount);
    }
    const boundaries = [];
    for (let b = 1; b < bandCount; b++) boundaries.push(Math.round(b * axisLen / bandCount));
    return boundaries;
}

function analyzeSegmentSkewWithParams(ds, direction, segmentCount, totalShift) {
    if (!ds || ds.type === 'pcd-scatter') return { ok: false, reason: 'scatter' };
    const { data, width, height } = ds;
    if (!data || width < 3 || height < 3) return { ok: false, reason: 'tooSmall' };
    if (segSkewCountValid(data) < 3) return { ok: false, reason: 'insufficient' };

    const dir = direction === 'vertical' ? 'vertical' : 'horizontal';
    const bands = Math.round(segmentCount);
    if (!Number.isFinite(bands) || bands < 2) return { ok: false, reason: 'invalidParams' };

    const opts = segSkewBoundaryOptionsForDirection(width, height, dir);
    const boundaries = segSkewEqualBoundaries(opts.axisLen, bands);
    if (typeof segLevelValidateEqualBoundaries === 'function'
        && !segLevelValidateEqualBoundaries(boundaries, opts.axisLen, opts.minDist, opts.edgeMargin)) {
        return { ok: false, reason: 'invalidParams' };
    }

    const autoShift = Math.round(segSkewEstimateSharedShift(data, width, height, dir, boundaries));
    const shift = Number.isFinite(totalShift) ? Math.round(totalShift) : autoShift;
    const correctedData = applySegmentSkew(data, width, height, dir, boundaries, shift);

    return {
        ok: true,
        direction: dir,
        boundaries: boundaries.slice(),
        segmentCount: boundaries.length + 1,
        correctedData,
        shiftPx: shift,
        autoShiftPx: autoShift,
        validPoints: segSkewCountValid(data),
    };
}

async function analyzeSegmentSkewWithParamsAsync(ds, direction, segmentCount, totalShift, onProgress, isCancelled) {
    if (!ds || ds.type === 'pcd-scatter') return { ok: false, reason: 'scatter' };
    const { data, width, height } = ds;
    if (!data || width < 3 || height < 3) return { ok: false, reason: 'tooSmall' };
    if (segSkewCountValid(data) < 3) return { ok: false, reason: 'insufficient' };

    const dir = direction === 'vertical' ? 'vertical' : 'horizontal';
    const bands = Math.round(segmentCount);
    if (!Number.isFinite(bands) || bands < 2) return { ok: false, reason: 'invalidParams' };

    const opts = segSkewBoundaryOptionsForDirection(width, height, dir);
    const boundaries = segSkewEqualBoundaries(opts.axisLen, bands);
    if (typeof segLevelValidateEqualBoundaries === 'function'
        && !segLevelValidateEqualBoundaries(boundaries, opts.axisLen, opts.minDist, opts.edgeMargin)) {
        return { ok: false, reason: 'invalidParams' };
    }

    if (onProgress) onProgress(0.1);
    await segSkewYield();
    if (isCancelled && isCancelled()) return { ok: false, reason: 'cancelled' };

    const autoShift = Math.round(await segSkewEstimateSharedShiftAsync(
        data, width, height, dir, boundaries, isCancelled,
    ));
    if (isCancelled && isCancelled()) return { ok: false, reason: 'cancelled' };
    const shift = Number.isFinite(totalShift) ? Math.round(totalShift) : autoShift;

    if (onProgress) onProgress(0.35);
    await segSkewYield();
    if (isCancelled && isCancelled()) return { ok: false, reason: 'cancelled' };

    const correctedData = await applySegmentSkewAsync(
        data, width, height, dir, boundaries, shift, null, 64, isCancelled,
    );
    if (!correctedData || (isCancelled && isCancelled())) {
        return { ok: false, reason: 'cancelled' };
    }

    if (onProgress) onProgress(1);
    return {
        ok: true,
        direction: dir,
        boundaries: boundaries.slice(),
        segmentCount: boundaries.length + 1,
        correctedData,
        shiftPx: shift,
        autoShiftPx: autoShift,
        validPoints: segSkewCountValid(data),
    };
}

function analyzeSegmentSkew(ds) {
    if (!ds || ds.type === 'pcd-scatter') return { ok: false, reason: 'scatter' };
    const { data, width, height } = ds;
    if (!data || width < 3 || height < 3) return { ok: false, reason: 'tooSmall' };
    if (segSkewCountValid(data) < 3) return { ok: false, reason: 'insufficient' };

    const det = typeof segSkewDetectDirection === 'function'
        ? segSkewDetectDirection(data, width, height)
        : { direction: 'vertical', boundaries: segSkewEqualBoundaries(width, 3) };
    const { direction, boundaries } = det;
    const segmentCount = boundaries.length + 1;
    const shift = Math.round(segSkewEstimateSharedShift(data, width, height, direction, boundaries));
    const correctedData = applySegmentSkew(data, width, height, direction, boundaries, shift);

    return {
        ok: true,
        direction,
        boundaries: boundaries.slice(),
        segmentCount,
        correctedData,
        shiftPx: shift,
        autoShiftPx: shift,
        validPoints: segSkewCountValid(data),
    };
}

async function analyzeSegmentSkewAsync(ds, onProgress, isCancelled) {
    if (!ds || ds.type === 'pcd-scatter') return { ok: false, reason: 'scatter' };
    const { data, width, height } = ds;
    if (!data || width < 3 || height < 3) return { ok: false, reason: 'tooSmall' };
    if (segSkewCountValid(data) < 3) return { ok: false, reason: 'insufficient' };

    if (onProgress) onProgress(0.05);
    await segSkewYield();
    if (isCancelled && isCancelled()) return { ok: false, reason: 'cancelled' };

    const det = typeof segSkewDetectDirectionAsync === 'function'
        ? await segSkewDetectDirectionAsync(data, width, height, 64)
        : { direction: 'vertical', boundaries: segSkewEqualBoundaries(width, 3) };
    const { direction, boundaries } = det;
    const segmentCount = boundaries.length + 1;

    if (onProgress) onProgress(0.2);
    await segSkewYield();
    if (isCancelled && isCancelled()) return { ok: false, reason: 'cancelled' };

    const shift = Math.round(await segSkewEstimateSharedShiftAsync(
        data, width, height, direction, boundaries, isCancelled,
    ));
    if (isCancelled && isCancelled()) return { ok: false, reason: 'cancelled' };

    if (onProgress) onProgress(0.35);
    await segSkewYield();
    if (isCancelled && isCancelled()) return { ok: false, reason: 'cancelled' };

    const correctedData = await applySegmentSkewAsync(
        data, width, height, direction, boundaries, shift, null, 64, isCancelled,
    );
    if (!correctedData || (isCancelled && isCancelled())) {
        return { ok: false, reason: 'cancelled' };
    }

    if (onProgress) onProgress(1);
    return {
        ok: true,
        direction,
        boundaries: boundaries.slice(),
        segmentCount,
        correctedData,
        shiftPx: shift,
        autoShiftPx: shift,
        validPoints: segSkewCountValid(data),
    };
}
