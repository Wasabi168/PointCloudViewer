/**
 * 自動分區水平校正（傳統演算法）
 * 依賴：file-parse.js (yieldToMain, LARGE_PIXEL_THRESHOLD)
 * 匯出（全域）：analyzeSegmentLeveling(), analyzeSegmentLevelingAsync(), analyzeSegmentLevelingWithParams(), analyzeSegmentLevelingWithParamsAsync(),
 *   segLevelBoundaryOptionsForDirection(), segLevelMaxValidBandCount(), segLevelComputeBandFits(), segLevelFitProfileBandsFromSplits()
 */
/* =========================================================================
 *  自動分區水平校正：剖面偵測方向與帶數，邊界為純幾何等分
 *  - 水平分割：各帶擬合 Y 斜率後取平均為共用 k，各帶以帶中心扣除傾斜，再墊高對齊最高帶
 *  - 垂直分割：各帶擬合 X 斜率後取平均為共用 k，各帶以帶中心扣除傾斜，再墊高對齊最高帶
 * ========================================================================= */

/** @typedef {'horizontal' | 'vertical'} SegmentDirection */
/** horizontal = 水平分割線（切成上下帶）；vertical = 垂直分割線（切成左右帶） */

function segLevelYield() {
    if (typeof yieldToMain === 'function') return yieldToMain();
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function segLevelIsLarge(width, height) {
    const thresh = typeof LARGE_PIXEL_THRESHOLD !== 'undefined' ? LARGE_PIXEL_THRESHOLD : 2_000_000;
    return width * height >= thresh;
}

function segLevelSmooth1d(arr, win) {
    let k = Math.max(3, win | 0);
    if (k % 2 === 0) k++;
    const half = (k - 1) >> 1;
    const out = new Float64Array(arr.length);
    for (let i = 0; i < arr.length; i++) {
        let sum = 0, cnt = 0;
        const i0 = Math.max(0, i - half);
        const i1 = Math.min(arr.length - 1, i + half);
        for (let j = i0; j <= i1; j++) {
            if (Number.isFinite(arr[j])) { sum += arr[j]; cnt++; }
        }
        out[i] = cnt > 0 ? sum / cnt : arr[i];
    }
    return out;
}

function segLevelPercentile(arr, p) {
    const vals = [];
    for (let i = 0; i < arr.length; i++) if (Number.isFinite(arr[i]) && arr[i] > 0) vals.push(arr[i]);
    if (!vals.length) return 0;
    vals.sort((a, b) => a - b);
    const idx = Math.min(vals.length - 1, Math.max(0, Math.floor(p * (vals.length - 1))));
    return vals[idx];
}

/**
 * 以相鄰像素高度差建立邊界能量剖面（比逐列排序中位數更快，且對階梯邊界更敏感）
 * horizontal → 剖面長度 height，峰值在水平分界行
 * vertical   → 剖面長度 width，峰值在垂直分界列
 */
function segLevelEdgeProfile(data, width, height, direction) {
    const len = direction === 'horizontal' ? height : width;
    const profile = new Float64Array(len);
    if (direction === 'horizontal') {
        profile[0] = 0;
        for (let y = 1; y < height; y++) {
            const rowBase = y * width;
            const prevBase = (y - 1) * width;
            let sum = 0, cnt = 0;
            for (let x = 0; x < width; x++) {
                const a = data[rowBase + x];
                const b = data[prevBase + x];
                if (Number.isFinite(a) && Number.isFinite(b)) {
                    sum += Math.abs(a - b);
                    cnt++;
                }
            }
            profile[y] = cnt > 0 ? sum / cnt : 0;
        }
    } else {
        profile[0] = 0;
        for (let x = 1; x < width; x++) {
            let sum = 0, cnt = 0;
            for (let y = 0; y < height; y++) {
                const idx = y * width + x;
                const a = data[idx];
                const b = data[idx - 1];
                if (Number.isFinite(a) && Number.isFinite(b)) {
                    sum += Math.abs(a - b);
                    cnt++;
                }
            }
            profile[x] = cnt > 0 ? sum / cnt : 0;
        }
    }
    return profile;
}

/** 各列／行平均高度剖面（對階梯狀分區更穩定） */
function segLevelBandMeanProfile(data, width, height, direction) {
    const len = direction === 'horizontal' ? height : width;
    const means = new Float64Array(len);
    if (direction === 'horizontal') {
        for (let y = 0; y < height; y++) {
            let sum = 0, cnt = 0;
            const rowBase = y * width;
            for (let x = 0; x < width; x++) {
                const v = data[rowBase + x];
                if (Number.isFinite(v)) { sum += v; cnt++; }
            }
            means[y] = cnt > 0 ? sum / cnt : NaN;
        }
    } else {
        for (let x = 0; x < width; x++) {
            let sum = 0, cnt = 0;
            for (let y = 0; y < height; y++) {
                const v = data[y * width + x];
                if (Number.isFinite(v)) { sum += v; cnt++; }
            }
            means[x] = cnt > 0 ? sum / cnt : NaN;
        }
    }
    return means;
}

/** 平均高度剖面的一階差分（平台間跳變處為峰值） */
function segLevelMeanStepProfile(means) {
    const n = means.length;
    const step = new Float64Array(n);
    for (let i = 1; i < n; i++) {
        const a = means[i];
        const b = means[i - 1];
        step[i] = (Number.isFinite(a) && Number.isFinite(b)) ? Math.abs(a - b) : 0;
    }
    return step;
}

function segLevelNormalizeProfile(profile) {
    const out = new Float64Array(profile.length);
    let max = 0;
    for (let i = 0; i < profile.length; i++) if (profile[i] > max) max = profile[i];
    const inv = max > 1e-12 ? 1 / max : 0;
    for (let i = 0; i < profile.length; i++) out[i] = profile[i] * inv;
    return out;
}

/** 合併兩種剖面（各自正規化後相加） */
function segLevelCombineProfiles(a, b) {
    const na = segLevelNormalizeProfile(a);
    const nb = segLevelNormalizeProfile(b);
    const out = new Float64Array(a.length);
    for (let i = 0; i < a.length; i++) out[i] = na[i] + nb[i];
    return out;
}

function segLevelDetectionProfile(data, width, height, direction) {
    const edge = segLevelEdgeProfile(data, width, height, direction);
    const means = segLevelBandMeanProfile(data, width, height, direction);
    const step = segLevelMeanStepProfile(means);
    return segLevelCombineProfiles(edge, step);
}

async function segLevelEdgeProfileAsync(data, width, height, direction, yieldEvery) {
    const len = direction === 'horizontal' ? height : width;
    const profile = new Float64Array(len);
    const large = segLevelIsLarge(width, height);
    if (direction === 'horizontal') {
        profile[0] = 0;
        for (let y = 1; y < height; y++) {
            const rowBase = y * width;
            const prevBase = (y - 1) * width;
            let sum = 0, cnt = 0;
            for (let x = 0; x < width; x++) {
                const a = data[rowBase + x];
                const b = data[prevBase + x];
                if (Number.isFinite(a) && Number.isFinite(b)) {
                    sum += Math.abs(a - b);
                    cnt++;
                }
            }
            profile[y] = cnt > 0 ? sum / cnt : 0;
            if (large && (y & (yieldEvery - 1)) === 0) await segLevelYield();
        }
    } else {
        profile[0] = 0;
        for (let x = 1; x < width; x++) {
            let sum = 0, cnt = 0;
            for (let y = 0; y < height; y++) {
                const idx = y * width + x;
                const a = data[idx];
                const b = data[idx - 1];
                if (Number.isFinite(a) && Number.isFinite(b)) {
                    sum += Math.abs(a - b);
                    cnt++;
                }
            }
            profile[x] = cnt > 0 ? sum / cnt : 0;
            if (large && (x & (yieldEvery - 1)) === 0) await segLevelYield();
        }
    }
    return profile;
}

/**
 * 邊界語意：boundary b = 接縫上方（右側）帶的第一列／行索引；
 * 接縫位於 b-1 與 b 之間。splits = [0, ...boundaries, axisLen]。
 */

function segLevelRefineBoundary(profile, idx, radius) {
    const n = profile.length;
    const i0 = Math.max(1, idx - radius);
    const i1 = Math.min(n - 1, idx + radius);
    let best = idx;
    let bestVal = -1;
    for (let i = i0; i <= i1; i++) {
        const v = profile[i];
        if (Number.isFinite(v) && v > bestVal) {
            bestVal = v;
            best = i;
        }
    }
    return best;
}

/** @returns {{ idx: number, strength: number }[]} */
function segLevelFindBoundaries(profile, options) {
    const minDist = options.minDist;
    const edgeMargin = options.edgeMargin;
    const maxBounds = options.maxBounds != null ? options.maxBounds : 8;
    const pHi = options.pHi != null ? options.pHi : 0.995;
    const pLo = options.pLo != null ? options.pLo : 0.85;
    const n = profile.length;
    if (n < 4) return [];

    const smoothWin = Math.max(5, Math.floor(n / 80) | 0);
    const smooth = segLevelSmooth1d(profile, smoothWin);
    const refineRadius = Math.max(smoothWin >> 1, Math.floor(minDist / 4), 3);

    const thr = segLevelPercentile(smooth, pHi);
    const minThr = segLevelPercentile(smooth, pLo) * 1.5;
    const useThr = Math.max(thr, minThr, 1e-9);

    const raw = [];
    for (let i = 1; i < n - 1; i++) {
        if (smooth[i] < useThr) continue;
        if (smooth[i] < smooth[i - 1] || smooth[i] < smooth[i + 1]) continue;
        if (i < edgeMargin || i > n - 1 - edgeMargin) continue;
        const refined = segLevelRefineBoundary(profile, i, refineRadius);
        raw.push({ idx: refined, strength: profile[refined] || smooth[i] });
    }

    raw.sort((a, b) => b.strength - a.strength);
    const picked = [];
    for (const p of raw) {
        if (picked.length >= maxBounds) break;
        if (picked.every((q) => Math.abs(p.idx - q.idx) >= minDist)) picked.push(p);
    }
    picked.sort((a, b) => a.idx - b.idx);
    return picked;
}

/** 各帶平均高度之間的變異數（帶數愈接近真實階梯，分數愈高） */
function segLevelBetweenBandVariance(means, boundaryIdx, axisLen) {
    const splits = [0, ...boundaryIdx, axisLen];
    const avgs = [];
    for (let si = 0; si < splits.length - 1; si++) {
        let sum = 0, cnt = 0;
        for (let i = splits[si]; i < splits[si + 1]; i++) {
            if (Number.isFinite(means[i])) { sum += means[i]; cnt++; }
        }
        if (cnt > 0) avgs.push(sum / cnt);
    }
    if (avgs.length < 2) return 0;
    const grand = avgs.reduce((a, b) => a + b, 0) / avgs.length;
    let v = 0;
    for (const a of avgs) v += (a - grand) ** 2;
    return v / avgs.length;
}

/** 各帶內部變異數（帶數過多、切進同一平台時會升高） */
function segLevelWithinBandVariance(means, boundaryIdx, axisLen) {
    const splits = [0, ...boundaryIdx, axisLen];
    let withinSum = 0;
    let withinCnt = 0;
    for (let si = 0; si < splits.length - 1; si++) {
        let sum = 0, cnt = 0;
        for (let i = splits[si]; i < splits[si + 1]; i++) {
            if (Number.isFinite(means[i])) { sum += means[i]; cnt++; }
        }
        if (cnt <= 1) continue;
        const bandMean = sum / cnt;
        for (let i = splits[si]; i < splits[si + 1]; i++) {
            if (!Number.isFinite(means[i])) continue;
            withinSum += (means[i] - bandMean) ** 2;
            withinCnt++;
        }
    }
    return withinCnt > 1 ? withinSum / withinCnt : 0;
}

/** 等分帶數評分：帶間變異 / 帶內變異（避免過度切分） */
function segLevelEqualSplitFitScore(means, boundaries, axisLen) {
    const between = segLevelBetweenBandVariance(means, boundaries, axisLen);
    const within = segLevelWithinBandVariance(means, boundaries, axisLen);
    return between / (within + 1e-9);
}

/** 由平均高度階梯峰估計平台數（作為帶數參考） */
function segLevelEstimateBandCountFromSteps(means, axisLen, minDist, edgeMargin) {
    const smoothWin = Math.max(5, Math.floor(axisLen / 60) | 0);
    const smooth = segLevelSmooth1d(means, smoothWin);
    const step = segLevelMeanStepProfile(smooth);
    const peaks = segLevelFindBoundaries(step, {
        minDist,
        edgeMargin,
        axisLen,
        pHi: 0.78,
        pLo: 0.45,
        maxBounds: 7,
    });
    return peaks.length > 0 ? peaks.length + 1 : 1;
}

/** 在平滑平均高度剖面上找階梯跳變峰 */
function segLevelFindBoundariesFromMeansSteps(means, options) {
    const axisLen = means.length;
    const smoothWin = Math.max(5, Math.floor(axisLen / 60) | 0);
    const smooth = segLevelSmooth1d(means, smoothWin);
    const step = segLevelMeanStepProfile(smooth);
    let picked = segLevelFindBoundaries(step, { ...options, axisLen, pHi: 0.82, pLo: 0.50 });
    if (picked.length > 0) return picked;
    return segLevelFindBoundaries(step, { ...options, axisLen, pHi: 0.70, pLo: 0.40 });
}

/** 等分候選：在 2~maxBands 等份中，挑選接縫能量 × 帶間變異最佳的一組邊界 */
function segLevelFindEqualBandBoundaries(profile, axisLen, options) {
    const minDist = options.minDist;
    const edgeMargin = options.edgeMargin;
    const maxBands = options.maxBands != null ? options.maxBands : 8;
    const means = options.means;
    const refineR = Math.max(3, Math.floor(minDist / 6));
    let best = null;

    for (let bands = 2; bands <= maxBands; bands++) {
        const rough = [];
        for (let b = 1; b < bands; b++) rough.push(Math.round(b * axisLen / bands));
        if (rough[0] < edgeMargin || rough[rough.length - 1] > axisLen - 1 - edgeMargin) continue;

        let prev = 0;
        let valid = true;
        for (const idx of rough) {
            if (idx - prev < minDist) { valid = false; break; }
            prev = idx;
        }
        if (!valid || axisLen - prev < minDist) continue;

        const refined = rough.map((idx) => segLevelRefineBoundary(profile, idx, refineR));
        let stepScore = 0;
        for (const r of refined) stepScore += profile[r] || 0;
        stepScore /= refined.length;

        const varScore = means ? segLevelBetweenBandVariance(means, refined, axisLen) : 0;
        const fitScore = means ? segLevelEqualSplitFitScore(means, refined, axisLen) : 0;
        const score = Math.sqrt(Math.max(stepScore, 1e-12) * Math.max(varScore, 1e-12) * Math.max(fitScore, 1e-12));

        if (!best || score > best.score) best = { score, refined };
    }

    if (!best || best.score <= 1e-12) return [];
    return best.refined.map((idx) => ({ idx, strength: profile[idx] || 0 }));
}

/** 剖面峰值偵測（僅判定帶數／方向，不用峰值位置當邊界） */
function segLevelDetectBoundaryPeaks(profile, options) {
    const means = options.means;
    if (means) {
        const fromSteps = segLevelFindBoundariesFromMeansSteps(means, options);
        if (fromSteps.length > 0) return fromSteps;
    }
    let picked = segLevelFindBoundaries(profile, options);
    if (picked.length > 0) return picked;
    return segLevelFindBoundaries(profile, { ...options, pHi: 0.90, pLo: 0.65 });
}

/** 峰值偵測失敗時，以等分帶數評分補帶數 */
function segLevelResolveBandCount(peaks, means, axisLen, options) {
    if (peaks.length > 0) return peaks.length + 1;
    return segLevelPickEqualBandCount(means, axisLen, options).bandCount;
}

/** @deprecated 僅供舊路徑；新流程請用 segLevelDetectBoundaryPeaks + segLevelEqualBoundaryIndices */
function segLevelFindBoundariesRobust(profile, options) {
    const axisLen = options.axisLen != null ? options.axisLen : profile.length;
    const peaks = segLevelDetectBoundaryPeaks(profile, options);
    if (peaks.length > 0) return peaks;
    return segLevelFindEqualBandBoundaries(profile, axisLen, options);
}

/** 等分規律性加成：邊界若接近均分，分數較高 */
function segLevelRegularityBonus(indices, axisLen) {
    if (!indices.length) return 1;
    const splits = [0];
    for (const b of indices) splits.push(b);
    splits.push(axisLen);
    const sizes = [];
    for (let i = 1; i < splits.length; i++) sizes.push(splits[i] - splits[i - 1]);
    const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    if (mean <= 0) return 1;
    let varSum = 0;
    for (const sz of sizes) varSum += (sz - mean) ** 2;
    const cv = Math.sqrt(varSum / sizes.length) / mean;
    return 1 + 0.6 * Math.max(0, 1 - cv * 4);
}

/** 固定等分：bandCount 帶 → 邊界行／列索引（round(b × 軸長 / 帶數)，不做接縫微調） */
function segLevelEqualBoundaryIndices(axisLen, bandCount) {
    if (!bandCount || bandCount < 2) return [];
    const boundaries = [];
    for (let b = 1; b < bandCount; b++) {
        boundaries.push(Math.round(b * axisLen / bandCount));
    }
    return boundaries;
}

function segLevelValidateEqualBoundaries(boundaries, axisLen, minDist, edgeMargin) {
    if (!boundaries.length) return true;
    if (boundaries[0] < edgeMargin) return false;
    if (boundaries[boundaries.length - 1] > axisLen - 1 - edgeMargin) return false;
    let prev = 0;
    for (const idx of boundaries) {
        if (idx <= prev || idx - prev < minDist) return false;
        prev = idx;
    }
    return axisLen - prev >= minDist;
}

/** 在 2~maxBands 等份中，依帶間／帶內變異比挑選最佳帶數 */
function segLevelPickEqualBandCount(means, axisLen, options) {
    const minDist = options.minDist;
    const edgeMargin = options.edgeMargin;
    const maxBands = options.maxBands != null ? options.maxBands : 8;
    const hint = segLevelEstimateBandCountFromSteps(means, axisLen, minDist, edgeMargin);
    let bestBands = 1;
    let bestScore = 0;
    for (let bands = 2; bands <= maxBands; bands++) {
        const boundaries = segLevelEqualBoundaryIndices(axisLen, bands);
        if (!segLevelValidateEqualBoundaries(boundaries, axisLen, minDist, edgeMargin)) continue;
        let score = means ? segLevelEqualSplitFitScore(means, boundaries, axisLen) : 0;
        if (hint >= 2 && bands === hint) score *= 1.12;
        if (score > bestScore || (Math.abs(score - bestScore) < bestScore * 0.02 && bands < bestBands)) {
            bestScore = score;
            bestBands = bands;
        }
    }
    if (hint >= 2 && bestBands === 1) bestBands = hint;
    return { bandCount: bestBands, score: bestScore };
}

function segLevelDirectionScore(boundaries, axisLen) {
    if (!boundaries.length) return 0;
    let maxS = 0, sumS = 0;
    for (const b of boundaries) {
        const s = b.strength || 0;
        if (s > maxS) maxS = s;
        sumS += s;
    }
    const meanS = sumS / boundaries.length;
    const indices = boundaries.map((b) => b.idx);
    const reg = segLevelRegularityBonus(indices, axisLen);
    return maxS * meanS * reg * boundaries.length;
}

/** 比較水平 vs 垂直分割結構強度，擇一；邊界為純幾何等分 */
function segLevelDetectDirection(data, width, height) {
    const rowMeans = segLevelBandMeanProfile(data, width, height, 'horizontal');
    const colMeans = segLevelBandMeanProfile(data, width, height, 'vertical');
    const rowProf = segLevelDetectionProfile(data, width, height, 'horizontal');
    const colProf = segLevelDetectionProfile(data, width, height, 'vertical');
    const minDistH = Math.max(20, Math.floor(height / 8));
    const minDistV = Math.max(20, Math.floor(width / 8));
    const marginH = Math.max(2, Math.floor(height * 0.02));
    const marginV = Math.max(2, Math.floor(width * 0.02));

    const rowOpts = { minDist: minDistH, edgeMargin: marginH, axisLen: height, means: rowMeans };
    const colOpts = { minDist: minDistV, edgeMargin: marginV, axisLen: width, means: colMeans };

    const rowPeaks = segLevelDetectBoundaryPeaks(rowProf, rowOpts);
    const colPeaks = segLevelDetectBoundaryPeaks(colProf, colOpts);
    const rowBands = segLevelResolveBandCount(rowPeaks, rowMeans, height, rowOpts);
    const colBands = segLevelResolveBandCount(colPeaks, colMeans, width, colOpts);

    const rowScore = rowPeaks.length > 0
        ? segLevelDirectionScore(rowPeaks, height)
        : segLevelEqualSplitFitScore(rowMeans, segLevelEqualBoundaryIndices(height, rowBands), height);
    const colScore = colPeaks.length > 0
        ? segLevelDirectionScore(colPeaks, width)
        : segLevelEqualSplitFitScore(colMeans, segLevelEqualBoundaryIndices(width, colBands), width);

    if (rowScore >= colScore) {
        return {
            direction: 'horizontal',
            boundaries: segLevelEqualBoundaryIndices(height, rowBands),
            score: rowScore,
        };
    }
    return {
        direction: 'vertical',
        boundaries: segLevelEqualBoundaryIndices(width, colBands),
        score: colScore,
    };
}

async function segLevelDetectDirectionAsync(data, width, height, yieldEvery) {
    const large = segLevelIsLarge(width, height);
    if (large) await segLevelYield();
    const rowMeans = segLevelBandMeanProfile(data, width, height, 'horizontal');
    if (large) await segLevelYield();
    const colMeans = segLevelBandMeanProfile(data, width, height, 'vertical');
    if (large) await segLevelYield();
    const rowProf = segLevelDetectionProfile(data, width, height, 'horizontal');
    if (large) await segLevelYield();
    const colProf = segLevelDetectionProfile(data, width, height, 'vertical');
    const minDistH = Math.max(20, Math.floor(height / 8));
    const minDistV = Math.max(20, Math.floor(width / 8));
    const marginH = Math.max(2, Math.floor(height * 0.02));
    const marginV = Math.max(2, Math.floor(width * 0.02));

    const rowOpts = { minDist: minDistH, edgeMargin: marginH, axisLen: height, means: rowMeans };
    const colOpts = { minDist: minDistV, edgeMargin: marginV, axisLen: width, means: colMeans };

    const rowPeaks = segLevelDetectBoundaryPeaks(rowProf, rowOpts);
    const colPeaks = segLevelDetectBoundaryPeaks(colProf, colOpts);
    const rowBands = segLevelResolveBandCount(rowPeaks, rowMeans, height, rowOpts);
    const colBands = segLevelResolveBandCount(colPeaks, colMeans, width, colOpts);

    const rowScore = rowPeaks.length > 0
        ? segLevelDirectionScore(rowPeaks, height)
        : segLevelEqualSplitFitScore(rowMeans, segLevelEqualBoundaryIndices(height, rowBands), height);
    const colScore = colPeaks.length > 0
        ? segLevelDirectionScore(colPeaks, width)
        : segLevelEqualSplitFitScore(colMeans, segLevelEqualBoundaryIndices(width, colBands), width);

    if (rowScore >= colScore) {
        return {
            direction: 'horizontal',
            boundaries: segLevelEqualBoundaryIndices(height, rowBands),
            score: rowScore,
        };
    }
    return {
        direction: 'vertical',
        boundaries: segLevelEqualBoundaryIndices(width, colBands),
        score: colScore,
    };
}

function segLevelSolve2x2(m00, m01, m11, b0, b1) {
    const det = m00 * m11 - m01 * m01;
    if (Math.abs(det) < 1e-12) return null;
    return [
        (b0 * m11 - b1 * m01) / det,
        (m00 * b1 - m01 * b0) / det,
    ];
}

function segLevelNewAxisAcc() {
    return { n: 0, st: 0, sz: 0, stt: 0, stz: 0 };
}

function segLevelAccAxis(acc, t, z) {
    acc.n++;
    acc.st += t;
    acc.sz += z;
    acc.stt += t * t;
    acc.stz += t * z;
}

/** 1D 擬合 z = k*t + c；校正時僅扣除 k*t */
function segLevelAxisFromAcc(acc) {
    if (acc.n < 2) return null;
    const sol = segLevelSolve2x2(acc.stt, acc.st, acc.n, acc.stz, acc.sz);
    if (!sol) return null;
    return { k: sol[0], c: sol[1], n: acc.n };
}

function segLevelPhysicalScale(header, width, height) {
    const hdr = header || {};
    let xl = parseFloat(hdr.xlength ?? hdr['x-length'] ?? 0);
    let yl = parseFloat(hdr.ylength ?? hdr['y-length'] ?? 0);
    if (!Number.isFinite(xl) || xl <= 0) xl = width;
    if (!Number.isFinite(yl) || yl <= 0) yl = height;
    const dx = xl / Math.max(1, width - 1);
    const dy = yl / Math.max(1, height - 1);
    return { dx, dy };
}

function segLevelShiftBandRange(out, width, height, direction, i0, i1, delta) {
    if (Math.abs(delta) < 1e-9) return;
    if (direction === 'horizontal') {
        for (let y = i0; y < i1; y++) {
            const rowBase = y * width;
            for (let x = 0; x < width; x++) {
                const idx = rowBase + x;
                const v = out[idx];
                if (Number.isFinite(v)) out[idx] = v + delta;
            }
        }
    } else {
        for (let x = i0; x < i1; x++) {
            for (let y = 0; y < height; y++) {
                const idx = y * width + x;
                const v = out[idx];
                if (Number.isFinite(v)) out[idx] = v + delta;
            }
        }
    }
}

function segLevelAccumulateBandMeans(out, width, height, direction, boundaries) {
    const axisLen = direction === 'horizontal' ? height : width;
    const splits = [0, ...boundaries, axisLen];
    const bandCount = splits.length - 1;
    const sums = new Float64Array(bandCount);
    const counts = new Uint32Array(bandCount);
    let si = 0;

    if (direction === 'horizontal') {
        for (let y = 0; y < height; y++) {
            while (si < bandCount - 1 && y >= splits[si + 1]) si++;
            const rowBase = y * width;
            for (let x = 0; x < width; x++) {
                const v = out[rowBase + x];
                if (Number.isFinite(v)) { sums[si] += v; counts[si]++; }
            }
        }
    } else {
        si = 0;
        for (let x = 0; x < width; x++) {
            while (si < bandCount - 1 && x >= splits[si + 1]) si++;
            for (let y = 0; y < height; y++) {
                const v = out[y * width + x];
                if (Number.isFinite(v)) { sums[si] += v; counts[si]++; }
            }
        }
    }

    const means = new Float64Array(bandCount);
    for (let i = 0; i < bandCount; i++) {
        means[i] = counts[i] ? sums[i] / counts[i] : NaN;
    }
    return { splits, bandCount, means };
}

/** 各帶整體平移，墊高至與最高帶相同基準（最高帶不動，其餘帶往上墊） */
function segLevelAlignBandsToHighest(out, width, height, direction, boundaries) {
    const { splits, bandCount, means } = segLevelAccumulateBandMeans(out, width, height, direction, boundaries);
    if (bandCount < 2) return;

    let refBand = 0;
    let refMean = -Infinity;
    for (let si = 0; si < bandCount; si++) {
        if (Number.isFinite(means[si]) && means[si] > refMean) {
            refMean = means[si];
            refBand = si;
        }
    }
    if (!Number.isFinite(refMean)) return;

    for (let si = 0; si < bandCount; si++) {
        if (si === refBand || !Number.isFinite(means[si])) continue;
        const delta = refMean - means[si];
        segLevelShiftBandRange(out, width, height, direction, splits[si], splits[si + 1], delta);
    }
}

async function segLevelAlignBandsToHighestAsync(out, width, height, direction, boundaries, yieldEvery) {
    const large = segLevelIsLarge(width, height);
    const axisLen = direction === 'horizontal' ? height : width;
    const splits = [0, ...boundaries, axisLen];
    const bandCount = splits.length - 1;
    const sums = new Float64Array(bandCount);
    const counts = new Uint32Array(bandCount);
    let si = 0;

    if (direction === 'horizontal') {
        for (let y = 0; y < height; y++) {
            while (si < bandCount - 1 && y >= splits[si + 1]) si++;
            const rowBase = y * width;
            for (let x = 0; x < width; x++) {
                const v = out[rowBase + x];
                if (Number.isFinite(v)) { sums[si] += v; counts[si]++; }
            }
            if (large && (y & (yieldEvery - 1)) === 0) await segLevelYield();
        }
    } else {
        si = 0;
        for (let x = 0; x < width; x++) {
            while (si < bandCount - 1 && x >= splits[si + 1]) si++;
            for (let y = 0; y < height; y++) {
                const v = out[y * width + x];
                if (Number.isFinite(v)) { sums[si] += v; counts[si]++; }
            }
            if (large && (x & (yieldEvery - 1)) === 0) await segLevelYield();
        }
    }

    const means = new Float64Array(bandCount);
    for (let i = 0; i < bandCount; i++) {
        means[i] = counts[i] ? sums[i] / counts[i] : NaN;
    }
    if (bandCount < 2) return;

    let refBand = 0;
    let refMean = -Infinity;
    for (let i = 0; i < bandCount; i++) {
        if (Number.isFinite(means[i]) && means[i] > refMean) {
            refMean = means[i];
            refBand = i;
        }
    }
    if (!Number.isFinite(refMean)) return;

    for (let bi = 0; bi < bandCount; bi++) {
        if (bi === refBand || !Number.isFinite(means[bi])) continue;
        const delta = refMean - means[bi];
        if (Math.abs(delta) < 1e-9) continue;
        const i0 = splits[bi];
        const i1 = splits[bi + 1];
        if (direction === 'horizontal') {
            for (let y = i0; y < i1; y++) {
                const rowBase = y * width;
                for (let x = 0; x < width; x++) {
                    const idx = rowBase + x;
                    const v = out[idx];
                    if (Number.isFinite(v)) out[idx] = v + delta;
                }
                if (large && ((y - i0) & (yieldEvery - 1)) === 0) await segLevelYield();
            }
        } else {
            for (let x = i0; x < i1; x++) {
                for (let y = 0; y < height; y++) {
                    const idx = y * width + x;
                    const v = out[idx];
                    if (Number.isFinite(v)) out[idx] = v + delta;
                }
                if (large && ((x - i0) & (yieldEvery - 1)) === 0) await segLevelYield();
            }
        }
    }
}

function segLevelSubtractAxisPerBand(out, width, height, direction, boundaries, axisScale, k) {
    const axisLen = direction === 'horizontal' ? height : width;
    const splits = [0, ...boundaries, axisLen];
    for (let si = 0; si < splits.length - 1; si++) {
        const i0 = splits[si];
        const i1 = splits[si + 1];
        const center = (i0 + i1 - 1) * 0.5;
        segLevelSubtractAxisSegment(out, width, height, direction, i0, i1, axisScale, { k, center });
    }
}

async function segLevelSubtractAxisPerBandAsync(out, width, height, direction, boundaries, axisScale, k, yieldEvery) {
    const axisLen = direction === 'horizontal' ? height : width;
    const splits = [0, ...boundaries, axisLen];
    const large = segLevelIsLarge(width, height);
    for (let si = 0; si < splits.length - 1; si++) {
        const i0 = splits[si];
        const i1 = splits[si + 1];
        const center = (i0 + i1 - 1) * 0.5;
        await segLevelSubtractAxisSegmentAsync(out, width, height, direction, i0, i1, axisScale, { k, center }, yieldEvery);
        if (large) await segLevelYield();
    }
}

function segLevelSubtractAxisGlobal(out, width, height, direction, scale, k, center) {
    if (direction === 'horizontal') {
        for (let y = 0; y < height; y++) {
            const rowBase = y * width;
            const sub = k * (y - center) * scale;
            for (let x = 0; x < width; x++) {
                const idx = rowBase + x;
                const v = out[idx];
                if (Number.isFinite(v)) out[idx] = v - sub;
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
        }
    }
}

function segLevelAccumulateAxisSegment(data, width, height, direction, i0, i1, scale) {
    const acc = segLevelNewAxisAcc();
    const center = (i0 + i1 - 1) * 0.5;
    if (direction === 'horizontal') {
        for (let y = i0; y < i1; y++) {
            const rowBase = y * width;
            const pt = (y - center) * scale;
            for (let x = 0; x < width; x++) {
                const v = data[rowBase + x];
                if (!Number.isFinite(v)) continue;
                segLevelAccAxis(acc, pt, v);
            }
        }
    } else {
        for (let x = i0; x < i1; x++) {
            const pt = (x - center) * scale;
            for (let y = 0; y < height; y++) {
                const v = data[y * width + x];
                if (!Number.isFinite(v)) continue;
                segLevelAccAxis(acc, pt, v);
            }
        }
    }
    const axis = segLevelAxisFromAcc(acc);
    return axis ? { ...axis, center } : null;
}

async function segLevelAccumulateAxisSegmentAsync(data, width, height, direction, i0, i1, scale, yieldEvery) {
    const acc = segLevelNewAxisAcc();
    const large = segLevelIsLarge(width, height);
    const center = (i0 + i1 - 1) * 0.5;
    if (direction === 'horizontal') {
        for (let y = i0; y < i1; y++) {
            const rowBase = y * width;
            const pt = (y - center) * scale;
            for (let x = 0; x < width; x++) {
                const v = data[rowBase + x];
                if (!Number.isFinite(v)) continue;
                segLevelAccAxis(acc, pt, v);
            }
            if (large && ((y - i0) & (yieldEvery - 1)) === 0) await segLevelYield();
        }
    } else {
        for (let x = i0; x < i1; x++) {
            const pt = (x - center) * scale;
            for (let y = 0; y < height; y++) {
                const v = data[y * width + x];
                if (!Number.isFinite(v)) continue;
                segLevelAccAxis(acc, pt, v);
            }
            if (large && ((x - i0) & (yieldEvery - 1)) === 0) await segLevelYield();
        }
    }
    const axis = segLevelAxisFromAcc(acc);
    return axis ? { ...axis, center } : null;
}

function segLevelSubtractAxisSegment(out, width, height, direction, i0, i1, scale, tilt) {
    const { k, center } = tilt;
    if (direction === 'horizontal') {
        for (let y = i0; y < i1; y++) {
            const rowBase = y * width;
            const sub = k * (y - center) * scale;
            for (let x = 0; x < width; x++) {
                const idx = rowBase + x;
                const v = out[idx];
                if (!Number.isFinite(v)) continue;
                out[idx] = v - sub;
            }
        }
    } else {
        for (let x = i0; x < i1; x++) {
            const sub = k * (x - center) * scale;
            for (let y = 0; y < height; y++) {
                const idx = y * width + x;
                const v = out[idx];
                if (!Number.isFinite(v)) continue;
                out[idx] = v - sub;
            }
        }
    }
}

async function segLevelSubtractAxisSegmentAsync(out, width, height, direction, i0, i1, scale, tilt, yieldEvery) {
    const large = segLevelIsLarge(width, height);
    const { k, center } = tilt;
    if (direction === 'horizontal') {
        for (let y = i0; y < i1; y++) {
            const rowBase = y * width;
            const sub = k * (y - center) * scale;
            for (let x = 0; x < width; x++) {
                const idx = rowBase + x;
                const v = out[idx];
                if (!Number.isFinite(v)) continue;
                out[idx] = v - sub;
            }
            if (large && ((y - i0) & (yieldEvery - 1)) === 0) await segLevelYield();
        }
    } else {
        for (let x = i0; x < i1; x++) {
            const sub = k * (x - center) * scale;
            for (let y = 0; y < height; y++) {
                const idx = y * width + x;
                const v = out[idx];
                if (!Number.isFinite(v)) continue;
                out[idx] = v - sub;
            }
            if (large && ((x - i0) & (yieldEvery - 1)) === 0) await segLevelYield();
        }
    }
}

async function segLevelSubtractAxisGlobalAsync(out, width, height, direction, scale, k, center, yieldEvery) {
    const large = segLevelIsLarge(width, height);
    if (direction === 'horizontal') {
        for (let y = 0; y < height; y++) {
            const rowBase = y * width;
            const sub = k * (y - center) * scale;
            for (let x = 0; x < width; x++) {
                const idx = rowBase + x;
                const v = out[idx];
                if (Number.isFinite(v)) out[idx] = v - sub;
            }
            if (large && (y & (yieldEvery - 1)) === 0) await segLevelYield();
        }
    } else {
        for (let x = 0; x < width; x++) {
            const sub = k * (x - center) * scale;
            for (let y = 0; y < height; y++) {
                const idx = y * width + x;
                const v = out[idx];
                if (Number.isFinite(v)) out[idx] = v - sub;
            }
            if (large && (x & (yieldEvery - 1)) === 0) await segLevelYield();
        }
    }
}

/** 各帶 2D 擬合斜率（與共用 k 平均相同來源） */
function segLevelComputeBandFits(data, width, height, direction, boundaries, scale) {
    const axisLen = direction === 'horizontal' ? height : width;
    const splits = [0, ...(boundaries || []), axisLen];
    const fits = [];
    for (let si = 0; si < splits.length - 1; si++) {
        const i0 = splits[si];
        const i1 = splits[si + 1];
        const tilt = segLevelAccumulateAxisSegment(data, width, height, direction, i0, i1, scale);
        if (tilt && Number.isFinite(tilt.k) && Number.isFinite(tilt.c)) {
            fits.push({ i0, i1, k: tilt.k, c: tilt.c, center: tilt.center });
        }
    }
    return fits;
}

/** 各帶分別 1D 擬合斜率，取有效帶 k 的算術平均作為共用斜率 */
function segLevelAverageBandSlopes(data, width, height, direction, boundaries, scale) {
    const fits = segLevelComputeBandFits(data, width, height, direction, boundaries, scale);
    if (!fits.length) return null;
    let sumK = 0;
    for (const f of fits) sumK += f.k;
    const axisLen = direction === 'horizontal' ? height : width;
    const center = (axisLen - 1) * 0.5;
    return { k: sumK / fits.length, center };
}

/** 剖面折線上單帶 1D 擬合 z = k*t + c（t 為物理距離 mm） */
function segLevelFitProfileSegment(vals, i0, i1, scale) {
    const acc = segLevelNewAxisAcc();
    const center = (i0 + i1 - 1) * 0.5;
    for (let i = i0; i < i1; i++) {
        const z = vals[i];
        if (!Number.isFinite(z)) continue;
        segLevelAccAxis(acc, (i - center) * scale, z);
    }
    const axis = segLevelAxisFromAcc(acc);
    return axis ? { k: axis.k, c: axis.c, center, i0, i1 } : null;
}

/** 剖面折線各帶擬合參考線（供分區校正預覽折線圖疊加） */
function segLevelFitProfileBands(vals, boundaries, scale) {
    if (!vals || !vals.length) return [];
    const splits = [0, ...(boundaries || []), vals.length];
    return segLevelFitProfileBandsFromSplits(vals, splits, scale);
}

/** 依 splits 對剖面折線各帶獨立 1D 擬合（與校正共用 k 無關，純顯示用） */
function segLevelFitProfileBandsFromSplits(vals, splits, scale) {
    if (!vals || !vals.length || !splits || splits.length < 2 || !Number.isFinite(scale)) return [];
    const fits = [];
    for (let si = 0; si < splits.length - 1; si++) {
        const i0 = splits[si];
        const i1 = splits[si + 1];
        if (i1 <= i0) continue;
        const fit = segLevelFitProfileSegment(vals, i0, i1, scale);
        if (fit) fits.push(fit);
    }
    return fits;
}

/**
 * 建立分區校正計畫（邊界、各帶平均共用斜率等），供預覽與手動微調重用
 */
function planSegmentLeveling(ds, direction, boundaries) {
    const { data, width, height, header } = ds;
    const { dx, dy } = segLevelPhysicalScale(header, width, height);
    const axisLen = direction === 'horizontal' ? height : width;
    const splits = [0, ...boundaries, axisLen];
    const axisScale = direction === 'horizontal' ? dy : dx;
    const sharedTilt = segLevelAverageBandSlopes(data, width, height, direction, boundaries, axisScale);
    return {
        direction,
        boundaries: boundaries.slice(),
        splits,
        axisScale,
        sharedTilt,
    };
}

/**
 * 依計畫與共用斜率 k（µm/mm）自原始資料重算校正結果
 * @param {number} [kValue] 共用斜率；省略時用 plan.sharedTilt.k
 * @param {Float32Array} [outBuf] 重用輸出緩衝（微調時避免反覆配置）
 */
function applySegmentLevelPlan(sourceData, width, height, plan, kValue, outBuf) {
    const { direction, axisScale, boundaries, sharedTilt } = plan;
    const out = (outBuf && outBuf.length === sourceData.length)
        ? outBuf
        : new Float32Array(sourceData.length);
    out.set(sourceData);
    if (!sharedTilt) return out;
    const k = Number.isFinite(kValue) ? kValue : sharedTilt.k;
    segLevelSubtractAxisPerBand(out, width, height, direction, boundaries, axisScale, k);
    segLevelAlignBandsToHighest(out, width, height, direction, boundaries);
    return out;
}

/**
 * 非同步重算（大圖微調時讓出主執行緒）
 * @param {() => boolean} [isCancelled]
 */
async function applySegmentLevelPlanAsync(sourceData, width, height, plan, kValue, outBuf, options, isCancelled) {
    const yieldEvery = (options && options.yieldEvery) || 32;
    const large = segLevelIsLarge(width, height);
    const { direction, axisScale, boundaries, sharedTilt } = plan;
    const out = (outBuf && outBuf.length === sourceData.length)
        ? outBuf
        : new Float32Array(sourceData.length);
    out.set(sourceData);
    if (!sharedTilt) return out;
    const k = Number.isFinite(kValue) ? kValue : sharedTilt.k;

    if (large) {
        await segLevelSubtractAxisPerBandAsync(out, width, height, direction, boundaries, axisScale, k, yieldEvery);
    } else {
        segLevelSubtractAxisPerBand(out, width, height, direction, boundaries, axisScale, k);
    }
    if (isCancelled && isCancelled()) return null;

    if (large) {
        await segLevelAlignBandsToHighestAsync(out, width, height, direction, boundaries, yieldEvery);
    } else {
        segLevelAlignBandsToHighest(out, width, height, direction, boundaries);
    }
    return out;
}

/**
 * 對網格資料集執行分區校正，回傳新高度陣列
 * @returns {{ data: Float32Array, plan: object, tiltK: number }}
 */
function applySegmentedLeveling(ds, direction, boundaries) {
    const { data, width, height } = ds;
    const plan = planSegmentLeveling(ds, direction, boundaries);
    const tiltK = plan.sharedTilt ? plan.sharedTilt.k : 0;
    const out = applySegmentLevelPlan(data, width, height, plan, tiltK);
    return { data: out, plan, tiltK };
}

async function applySegmentedLevelingAsync(ds, direction, boundaries, onProgress) {
    const { data, width, height } = ds;
    const plan = planSegmentLeveling(ds, direction, boundaries);
    const tiltK = plan.sharedTilt ? plan.sharedTilt.k : 0;

    if (onProgress) onProgress(0.35);
    await segLevelYield();

    const out = applySegmentLevelPlan(data, width, height, plan, tiltK);

    if (onProgress) onProgress(0.95);
    return { data: out, plan, tiltK };
}

function segLevelCountValid(data) {
    let n = 0;
    for (let i = 0; i < data.length; i++) if (Number.isFinite(data[i])) n++;
    return n;
}

/** 依分割方向回傳軸長與邊界驗證參數 */
function segLevelBoundaryOptionsForDirection(width, height, direction) {
    const horizontal = direction === 'horizontal';
    const axisLen = horizontal ? height : width;
    const minDist = horizontal
        ? Math.max(20, Math.floor(height / 8))
        : Math.max(20, Math.floor(width / 8));
    const edgeMargin = horizontal
        ? Math.max(2, Math.floor(height * 0.02))
        : Math.max(2, Math.floor(width * 0.02));
    return { axisLen, minDist, edgeMargin };
}

/** 在等分約束下，此軸最多可切幾帶 */
function segLevelMaxValidBandCount(axisLen, minDist, edgeMargin) {
    let max = 1;
    for (let bands = 2; bands <= 32; bands++) {
        const boundaries = segLevelEqualBoundaryIndices(axisLen, bands);
        if (segLevelValidateEqualBoundaries(boundaries, axisLen, minDist, edgeMargin)) max = bands;
        else break;
    }
    return max;
}

function analyzeSegmentLevelingWithParams(ds, direction, segmentCount) {
    if (!ds || ds.type === 'pcd-scatter') {
        return { ok: false, reason: 'scatter' };
    }
    const { data, width, height } = ds;
    if (!data || width < 3 || height < 3) {
        return { ok: false, reason: 'tooSmall' };
    }

    const validPoints = segLevelCountValid(data);
    if (validPoints < 3) return { ok: false, reason: 'insufficient' };

    const dir = direction === 'vertical' ? 'vertical' : 'horizontal';
    const bands = Math.round(segmentCount);
    if (!Number.isFinite(bands) || bands < 2) {
        return { ok: false, reason: 'invalidParams' };
    }

    const opts = segLevelBoundaryOptionsForDirection(width, height, dir);
    const boundaries = segLevelEqualBoundaryIndices(opts.axisLen, bands);
    if (!segLevelValidateEqualBoundaries(boundaries, opts.axisLen, opts.minDist, opts.edgeMargin)) {
        return { ok: false, reason: 'invalidParams' };
    }

    const leveled = applySegmentedLeveling(ds, dir, boundaries);
    return {
        ok: true,
        direction: dir,
        boundaries: boundaries.slice(),
        segmentCount: boundaries.length + 1,
        correctedData: leveled.data,
        plan: leveled.plan,
        tiltK: leveled.tiltK,
        autoTiltK: leveled.tiltK,
        validPoints,
    };
}

async function analyzeSegmentLevelingWithParamsAsync(ds, direction, segmentCount, onProgress, isCancelled) {
    if (!ds || ds.type === 'pcd-scatter') {
        return { ok: false, reason: 'scatter' };
    }
    const { data, width, height } = ds;
    if (!data || width < 3 || height < 3) {
        return { ok: false, reason: 'tooSmall' };
    }

    const validPoints = segLevelCountValid(data);
    if (validPoints < 3) return { ok: false, reason: 'insufficient' };

    const dir = direction === 'vertical' ? 'vertical' : 'horizontal';
    const bands = Math.round(segmentCount);
    if (!Number.isFinite(bands) || bands < 2) {
        return { ok: false, reason: 'invalidParams' };
    }

    const opts = segLevelBoundaryOptionsForDirection(width, height, dir);
    const boundaries = segLevelEqualBoundaryIndices(opts.axisLen, bands);
    if (!segLevelValidateEqualBoundaries(boundaries, opts.axisLen, opts.minDist, opts.edgeMargin)) {
        return { ok: false, reason: 'invalidParams' };
    }

    if (onProgress) onProgress(0.1);
    await segLevelYield();
    if (isCancelled && isCancelled()) return { ok: false, reason: 'cancelled' };

    const leveled = await applySegmentedLevelingAsync(
        ds, dir, boundaries,
        (p) => { if (onProgress) onProgress(0.1 + p * 0.9); },
    );

    if (isCancelled && isCancelled()) return { ok: false, reason: 'cancelled' };

    if (onProgress) onProgress(1);
    return {
        ok: true,
        direction: dir,
        boundaries: boundaries.slice(),
        segmentCount: boundaries.length + 1,
        correctedData: leveled.data,
        plan: leveled.plan,
        tiltK: leveled.tiltK,
        autoTiltK: leveled.tiltK,
        validPoints,
    };
}

/**
 * 分析並產生分區校正預覽資料（同步，供批次管線使用）
 */
function analyzeSegmentLeveling(ds) {
    if (!ds || ds.type === 'pcd-scatter') {
        return { ok: false, reason: 'scatter' };
    }
    const { data, width, height } = ds;
    if (!data || width < 3 || height < 3) {
        return { ok: false, reason: 'tooSmall' };
    }

    const validPoints = segLevelCountValid(data);
    if (validPoints < 3) return { ok: false, reason: 'insufficient' };

    const det = segLevelDetectDirection(data, width, height);
    const { direction, boundaries } = det;
    const segmentCount = boundaries.length + 1;
    const leveled = applySegmentedLeveling(ds, direction, boundaries);

    return {
        ok: true,
        direction,
        boundaries: boundaries.slice(),
        segmentCount,
        correctedData: leveled.data,
        plan: leveled.plan,
        tiltK: leveled.tiltK,
        autoTiltK: leveled.tiltK,
        validPoints,
    };
}

/**
 * 非同步分析（大圖時讓出主執行緒，避免 UI 凍結）
 * @param {object} ds
 * @param {(p: number) => void} [onProgress] 0~1
 * @param {() => boolean} [isCancelled]
 */
async function analyzeSegmentLevelingAsync(ds, onProgress, isCancelled) {
    if (!ds || ds.type === 'pcd-scatter') {
        return { ok: false, reason: 'scatter' };
    }
    const { data, width, height } = ds;
    if (!data || width < 3 || height < 3) {
        return { ok: false, reason: 'tooSmall' };
    }

    const validPoints = segLevelCountValid(data);
    if (validPoints < 3) return { ok: false, reason: 'insufficient' };

    const yieldEvery = 32;
    if (onProgress) onProgress(0.05);
    await segLevelYield();

    if (isCancelled && isCancelled()) return { ok: false, reason: 'cancelled' };

    const det = await segLevelDetectDirectionAsync(data, width, height, yieldEvery);
    if (onProgress) onProgress(0.35);
    if (isCancelled && isCancelled()) return { ok: false, reason: 'cancelled' };

    const { direction, boundaries } = det;
    const segmentCount = boundaries.length + 1;
    const leveled = await applySegmentedLevelingAsync(
        ds, direction, boundaries,
        (p) => { if (onProgress) onProgress(p); },
    );

    if (isCancelled && isCancelled()) return { ok: false, reason: 'cancelled' };

    if (onProgress) onProgress(1);
    return {
        ok: true,
        direction,
        boundaries: boundaries.slice(),
        segmentCount,
        correctedData: leveled.data,
        plan: leveled.plan,
        tiltK: leveled.tiltK,
        autoTiltK: leveled.tiltK,
        validPoints,
    };
}
