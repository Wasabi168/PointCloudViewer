/**
 * 剖面多項式校正
 * 依賴：segment-level.js（segLevelYield，可省略）
 * 匯出（全域）：profilePolyCorrect(), profilePolyCorrectAsync(), profilePolyMaxOrder()
 */
/* =========================================================================
 *  逐條剖線扣除多項式背景，並略過無效點（NaN / 非有限值）
 *  - horizontal：逐列擬合，去除沿 X 的傾斜或彎曲
 *  - vertical：逐欄擬合，去除沿 Y 的傾斜或彎曲
 *  - 有效點少於階數 + 1 的那一條維持原值；無效點維持無效
 *  - 擬合成功的點扣除多項式後，加回全圖有效值平均，讓高度基準留在原區間
 * ========================================================================= */

const PROFILE_POLY_MAX_ORDER = 9;

function profilePolyYield() {
    if (typeof segLevelYield === 'function') return segLevelYield();
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function profilePolyMaxOrder(width, height, direction) {
    const axis = direction === 'vertical' ? height : width;
    return Math.max(0, Math.min(PROFILE_POLY_MAX_ORDER, (axis | 0) - 1));
}

function profilePolyNormalize(order, direction, width, height) {
    const dir = direction === 'vertical' ? 'vertical' : 'horizontal';
    const axis = dir === 'vertical' ? height : width;
    let ord = Math.round(Number(order));
    if (!Number.isFinite(ord)) ord = 1;
    if (ord < 1) ord = 1;
    if (ord > PROFILE_POLY_MAX_ORDER) ord = PROFILE_POLY_MAX_ORDER;
    if (!(width > 1) || !(height > 1) || !(axis > ord)) return null;
    return { order: ord, direction: dir, axis };
}

function profilePolyMean(data) {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < data.length; i++) {
        const v = data[i];
        if (!Number.isFinite(v)) continue;
        sum += v;
        n++;
    }
    return { mean: n ? sum / n : NaN, n };
}

function profilePolyMakeWork(cap) {
    return {
        xs: new Float64Array(cap),
        zs: new Float64Array(cap),
        p0: new Float64Array(cap),
        p1: new Float64Array(cap),
        pn: new Float64Array(cap),
        a: new Float64Array(PROFILE_POLY_MAX_ORDER),
        b: new Float64Array(PROFILE_POLY_MAX_ORDER),
        c: new Float64Array(PROFILE_POLY_MAX_ORDER + 1),
        xMean: 0,
        xScale: 1,
        order: 0,
    };
}

/**
 * 對一條剖線的有效點做離散正交多項式擬合。
 * x 先平移到有效點平均再縮放到約 [-1, 1]，避免高階項溢出。
 * @returns {boolean}
 */
function profilePolyFitLine(data, offset, stride, length, order, work) {
    let n = 0;
    let sumX = 0;
    for (let i = 0; i < length; i++) {
        const z = data[offset + i * stride];
        if (!Number.isFinite(z)) continue;
        sumX += i;
        n++;
    }
    if (n <= order) return false;
    const xMean = sumX / n;
    let xScale = 0;
    let count = 0;
    for (let i = 0; i < length; i++) {
        const z = data[offset + i * stride];
        if (!Number.isFinite(z)) continue;
        const d = Math.abs(i - xMean);
        if (d > xScale) xScale = d;
        work.xs[count] = i;
        work.zs[count] = z;
        count++;
    }
    if (!(xScale > 0)) return false;
    const xs = work.xs;
    const zs = work.zs;
    for (let i = 0; i < n; i++) xs[i] = (xs[i] - xMean) / xScale;

    let prev = work.p0;
    let cur = work.p1;
    let next = work.pn;
    for (let i = 0; i < n; i++) cur[i] = 1;
    let norm = n;
    let sumZ = 0;
    for (let i = 0; i < n; i++) sumZ += zs[i];
    work.c[0] = sumZ / norm;
    let normPrev = 0;
    for (let k = 0; k < order; k++) {
        let sumXP = 0;
        for (let i = 0; i < n; i++) sumXP += xs[i] * cur[i] * cur[i];
        const ak = sumXP / norm;
        const bk = k === 0 ? 0 : norm / normPrev;
        let normNext = 0;
        let sumZY = 0;
        for (let i = 0; i < n; i++) {
            const v = (xs[i] - ak) * cur[i] - bk * prev[i];
            next[i] = v;
            normNext += v * v;
            sumZY += zs[i] * v;
        }
        if (!(normNext > 1e-18 * Math.max(norm, 1))) return false;
        work.a[k] = ak;
        work.b[k] = bk;
        work.c[k + 1] = sumZY / normNext;
        const oldPrev = prev;
        prev = cur;
        cur = next;
        next = oldPrev;
        normPrev = norm;
        norm = normNext;
    }
    work.xMean = xMean;
    work.xScale = xScale;
    work.order = order;
    return true;
}

function profilePolyEval(work, index) {
    const t = (index - work.xMean) / work.xScale;
    const order = work.order;
    let prev = 0;
    let cur = 1;
    let y = work.c[0];
    for (let k = 0; k < order; k++) {
        const nxt = (t - work.a[k]) * cur - work.b[k] * prev;
        y += work.c[k + 1] * nxt;
        prev = cur;
        cur = nxt;
    }
    return y;
}

function profilePolyWriteLine(data, out, offset, stride, length, order, mean, work) {
    if (!profilePolyFitLine(data, offset, stride, length, order, work)) {
        for (let i = 0; i < length; i++) out[offset + i * stride] = data[offset + i * stride];
        return false;
    }
    for (let i = 0; i < length; i++) {
        const idx = offset + i * stride;
        const z = data[idx];
        if (!Number.isFinite(z)) out[idx] = NaN;
        else out[idx] = z - profilePolyEval(work, i) + mean;
    }
    return true;
}

function profilePolyCorrect(data, width, height, order, direction, outBuf) {
    const spec = profilePolyNormalize(order, direction, width, height);
    if (!spec) return { ok: false, reason: 'insufficient' };
    const meanInfo = profilePolyMean(data);
    if (!meanInfo.n || meanInfo.n <= spec.order) return { ok: false, reason: 'insufficient' };
    const out = (outBuf && outBuf.length === data.length) ? outBuf : new Float32Array(data.length);
    const work = profilePolyMakeWork(spec.axis);
    const vertical = spec.direction === 'vertical';
    const lines = vertical ? width : height;
    const stride = vertical ? width : 1;
    let fitted = 0;
    let skipped = 0;
    for (let line = 0; line < lines; line++) {
        const offset = vertical ? line : line * width;
        if (profilePolyWriteLine(data, out, offset, stride, spec.axis, spec.order, meanInfo.mean, work)) fitted++;
        else skipped++;
    }
    if (!fitted) return { ok: false, reason: 'insufficient' };
    return {
        ok: true,
        data: out,
        mean: meanInfo.mean,
        finite: meanInfo.n,
        fitted,
        skipped,
        order: spec.order,
        direction: spec.direction,
    };
}

/**
 * @param {() => boolean} [isCancelled]
 * @param {(fraction: number) => void} [onProgress]
 */
async function profilePolyCorrectAsync(data, width, height, order, direction, outBuf, isCancelled, onProgress) {
    const spec = profilePolyNormalize(order, direction, width, height);
    if (!spec) return { ok: false, reason: 'insufficient' };
    const meanInfo = profilePolyMean(data);
    if (isCancelled && isCancelled()) return null;
    if (!meanInfo.n || meanInfo.n <= spec.order) return { ok: false, reason: 'insufficient' };
    const out = (outBuf && outBuf.length === data.length) ? outBuf : new Float32Array(data.length);
    const work = profilePolyMakeWork(spec.axis);
    const vertical = spec.direction === 'vertical';
    const lines = vertical ? width : height;
    const stride = vertical ? width : 1;
    const yieldEvery = lines * spec.axis >= 2000000 ? 16 : 0;
    let fitted = 0;
    let skipped = 0;
    for (let line = 0; line < lines; line++) {
        const offset = vertical ? line : line * width;
        if (profilePolyWriteLine(data, out, offset, stride, spec.axis, spec.order, meanInfo.mean, work)) fitted++;
        else skipped++;
        if (onProgress && ((line & 15) === 0 || line === lines - 1)) onProgress((line + 1) / lines);
        if (yieldEvery && (line & (yieldEvery - 1)) === 0) {
            await profilePolyYield();
            if (isCancelled && isCancelled()) return null;
        }
    }
    if (isCancelled && isCancelled()) return null;
    if (!fitted) return { ok: false, reason: 'insufficient' };
    return {
        ok: true,
        data: out,
        mean: meanInfo.mean,
        finite: meanInfo.n,
        fitted,
        skipped,
        order: spec.order,
        direction: spec.direction,
    };
}
