/**
 * 表面粗糙度（區域／輪廓參數）
 * 依賴：無
 * 匯出（全域）：Roughness
 *
 * 區域（ISO 25178 風格）：
 *   （可選）λs 高斯 S 濾波低通 → 去趨勢 →（可選）λc 高斯 L 濾波高通
 *   → Sa, Sq, Sp, Sv, Sz, Ssk, Sku
 *
 * 輪廓（ISO 4287 風格）：
 *   沿剖面線取樣 →（可選）λs → 去趨勢 →（可選）λc
 *   → Ra, Rq, Rp, Rv, Rz, Rt, Rsk, Rku
 */
const Roughness = (() => {
    /**
     * ISO 16610 高斯權重：s(x) = 1/(α λc) · exp(−π (x/(α λc))²)
     * α = √(ln 2 / π) ≈ 0.4697，使截止波長處 50% 傳輸。
     * 對應常態核 exp(−x²/(2σ²)) 時：σ = α λc / √(2π) ≈ 0.1874 λc
     */
    const GAUSS_ALPHA = Math.sqrt(Math.LN2 / Math.PI);

    /** λc（實體長度）→ 常態高斯 σ（同一實體單位） */
    function sigmaFromLambdaC(lambdaC) {
        return (GAUSS_ALPHA * lambdaC) / Math.sqrt(2 * Math.PI);
    }

    function solveLinearN(A, B) {
        const n = B.length;
        const M = new Array(n);
        for (let i = 0; i < n; i++) {
            M[i] = A[i].slice();
            M[i].push(B[i]);
        }
        for (let col = 0; col < n; col++) {
            let maxRow = col, maxVal = Math.abs(M[col][col]);
            for (let r = col + 1; r < n; r++) {
                const v = Math.abs(M[r][col]);
                if (v > maxVal) { maxVal = v; maxRow = r; }
            }
            if (maxVal < 1e-14) return null;
            if (maxRow !== col) {
                const tmp = M[col]; M[col] = M[maxRow]; M[maxRow] = tmp;
            }
            const pivot = M[col][col];
            for (let r = col + 1; r < n; r++) {
                const f = M[r][col] / pivot;
                for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
            }
        }
        const x = new Array(n);
        for (let r = n - 1; r >= 0; r--) {
            let sum = M[r][n];
            for (let c = r + 1; c < n; c++) sum -= M[r][c] * x[c];
            x[r] = sum / M[r][r];
        }
        return x;
    }

    function solveLinear3(A, B) {
        return solveLinearN(A, B);
    }

    /** 從 header 取得像素間距（實體單位／像素） */
    function pixelSpacing(ds) {
        const { width, height } = ds;
        const hdr = ds.header || {};
        let xl = parseFloat(hdr.xlength ?? hdr['x-length'] ?? 0);
        let yl = parseFloat(hdr.ylength ?? hdr['y-length'] ?? 0);
        if (!Number.isFinite(xl) || xl <= 0) xl = width;
        if (!Number.isFinite(yl) || yl <= 0) yl = height;
        return {
            dx: xl / Math.max(1, width - 1),
            dy: yl / Math.max(1, height - 1),
            zunit: String(hdr.zunit ?? hdr['z-unit'] ?? '').trim() || '',
            xyUnitHint: '',
        };
    }

    /**
     * 正規化 ROI（影像像素座標，含邊界）
     * @param {{x0:number,y0:number,x1:number,y1:number}|null} roi
     * @param {{exclusiveMax?: boolean}} [opts]
     */
    function normalizeRoi(ds, roi, opts) {
        const { width, height } = ds;
        if (!roi) {
            return { x0: 0, y0: 0, x1: width - 1, y1: height - 1, full: true };
        }
        const exclusiveMax = !!(opts && opts.exclusiveMax);
        let x0 = Math.min(roi.x0, roi.x1);
        let x1 = Math.max(roi.x0, roi.x1);
        let y0 = Math.min(roi.y0, roi.y1);
        let y1 = Math.max(roi.y0, roi.y1);
        const ix0 = Math.floor(x0);
        const iy0 = Math.floor(y0);
        const ix1 = exclusiveMax ? (Math.ceil(x1) - 1) : Math.ceil(x1);
        const iy1 = exclusiveMax ? (Math.ceil(y1) - 1) : Math.ceil(y1);
        return {
            x0: Math.max(0, Math.min(width - 1, ix0)),
            y0: Math.max(0, Math.min(height - 1, iy0)),
            x1: Math.max(0, Math.min(width - 1, Math.max(ix0, ix1))),
            y1: Math.max(0, Math.min(height - 1, Math.max(iy0, iy1))),
            full: false,
        };
    }

    /**
     * 擬合平面 z = ax + by + c（實體座標）
     * @returns {{a:number,b:number,c:number,n:number}|null}
     */
    function fitPlane(ds, rect) {
        const { data, width } = ds;
        const { dx, dy } = pixelSpacing(ds);
        let sX = 0, sY = 0, sZ = 0, sXX = 0, sYY = 0, sXY = 0, sXZ = 0, sYZ = 0, n = 0;
        for (let py = rect.y0; py <= rect.y1; py++) {
            const y = py * dy;
            for (let px = rect.x0; px <= rect.x1; px++) {
                const z = data[py * width + px];
                if (!Number.isFinite(z)) continue;
                const x = px * dx;
                sX += x; sY += y; sZ += z;
                sXX += x * x; sYY += y * y; sXY += x * y;
                sXZ += x * z; sYZ += y * z;
                n++;
            }
        }
        if (n < 3) return null;
        const sol = solveLinear3(
            [[sXX, sXY, sX], [sXY, sYY, sY], [sX, sY, n]],
            [sXZ, sYZ, sZ]
        );
        if (!sol) return null;
        return { a: sol[0], b: sol[1], c: sol[2], n };
    }

    /**
     * 擬合二次曲面（以 ROI 中心為原點的像素座標，數值較穩）
     * z = a u² + b v² + c u v + d u + e v + f
     * u = px - cx, v = py - cy
     */
    function fitQuadratic(ds, rect) {
        const { data, width } = ds;
        const cx = 0.5 * (rect.x0 + rect.x1);
        const cy = 0.5 * (rect.y0 + rect.y1);
        const ATA = Array.from({ length: 6 }, () => new Float64Array(6));
        const ATb = new Float64Array(6);
        let n = 0;

        for (let py = rect.y0; py <= rect.y1; py++) {
            const v = py - cy;
            const v2 = v * v;
            for (let px = rect.x0; px <= rect.x1; px++) {
                const z = data[py * width + px];
                if (!Number.isFinite(z)) continue;
                const u = px - cx;
                const u2 = u * u;
                const uv = u * v;
                const row = [u2, v2, uv, u, v, 1];
                for (let i = 0; i < 6; i++) {
                    ATb[i] += row[i] * z;
                    for (let j = 0; j < 6; j++) ATA[i][j] += row[i] * row[j];
                }
                n++;
            }
        }
        if (n < 6) return null;
        const A = ATA.map((r) => Array.from(r));
        const sol = solveLinearN(A, Array.from(ATb));
        if (!sol) return null;
        return {
            a: sol[0], b: sol[1], c: sol[2],
            d: sol[3], e: sol[4], f: sol[5],
            cx, cy, n,
        };
    }

    function meanOfRoi(ds, rect) {
        const { data, width } = ds;
        let sum = 0, n = 0;
        for (let py = rect.y0; py <= rect.y1; py++) {
            for (let px = rect.x0; px <= rect.x1; px++) {
                const z = data[py * width + px];
                if (!Number.isFinite(z)) continue;
                sum += z;
                n++;
            }
        }
        if (n === 0) return null;
        return { mean: sum / n, n };
    }

    function evalReference(ref, px, py, dx, dy) {
        if (ref.type === 'plane') {
            return ref.a * (px * dx) + ref.b * (py * dy) + ref.c;
        }
        if (ref.type === 'quadratic') {
            const u = px - ref.cx;
            const v = py - ref.cy;
            return ref.a * u * u + ref.b * v * v + ref.c * u * v + ref.d * u + ref.e * v + ref.f;
        }
        if (ref.type === 'mean') return ref.mean;
        return 0;
    }

    /** 建立 1D 高斯核（正規化） */
    function gaussianKernel1d(sigmaPx) {
        const s = Math.max(sigmaPx, 1e-6);
        const radius = Math.max(1, Math.ceil(3 * s));
        const k = new Float64Array(radius * 2 + 1);
        let sum = 0;
        for (let i = -radius; i <= radius; i++) {
            const v = Math.exp(-(i * i) / (2 * s * s));
            k[i + radius] = v;
            sum += v;
        }
        for (let i = 0; i < k.length; i++) k[i] /= sum;
        return { k, radius };
    }

    /**
     * 可分離高斯低通（邊界鏡射）
     * 核支撐內任一點為 NaN → 輸出 NaN（不重正規化，以保留固定頻率響應；
     * 可分離兩次後，缺值鄰域會自然擴大約核半徑）。
     * @param {Float32Array} src ROI 列主序
     * @param {number} w
     * @param {number} h
     * @param {number} sigmaXpx
     * @param {number} sigmaYpx
     */
    function gaussianLowpassSeparable(src, w, h, sigmaXpx, sigmaYpx) {
        const { k: kx, radius: rx } = gaussianKernel1d(sigmaXpx);
        const { k: ky, radius: ry } = gaussianKernel1d(sigmaYpx);
        const tmp = new Float32Array(w * h);
        const out = new Float32Array(w * h);

        const mirror = (i, n) => {
            if (n <= 1) return 0;
            while (i < 0 || i >= n) {
                if (i < 0) i = -i;
                if (i >= n) i = 2 * n - 2 - i;
            }
            return i;
        };

        // 水平：核內任一 NaN → 整點 NaN（不重正規化）
        for (let y = 0; y < h; y++) {
            const row = y * w;
            for (let x = 0; x < w; x++) {
                let sum = 0;
                let incomplete = false;
                for (let t = -rx; t <= rx; t++) {
                    const v = src[row + mirror(x + t, w)];
                    if (!Number.isFinite(v)) { incomplete = true; break; }
                    sum += v * kx[t + rx];
                }
                tmp[row + x] = incomplete ? NaN : sum;
            }
        }
        // 垂直
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let sum = 0;
                let incomplete = false;
                for (let t = -ry; t <= ry; t++) {
                    const v = tmp[mirror(y + t, h) * w + x];
                    if (!Number.isFinite(v)) { incomplete = true; break; }
                    sum += v * ky[t + ry];
                }
                out[y * w + x] = incomplete ? NaN : sum;
            }
        }
        return out;
    }

    /**
     * 將 λ（實體長度）換成可分離高斯核的像素 σ，並以 ROI 尺寸為上限避免極端慢。
     * @returns {{sx:number,sy:number,sigmaLen:number,clipped:boolean}}
     */
    function sigmaPxFromLambda(lambda, dx, dy, roiW, roiH) {
        const sigmaLen = sigmaFromLambdaC(lambda);
        const sigmaXpx = sigmaLen / Math.max(dx, 1e-30);
        const sigmaYpx = sigmaLen / Math.max(dy, 1e-30);
        const sx = Math.min(sigmaXpx, Math.max(roiW, 1));
        const sy = Math.min(sigmaYpx, Math.max(roiH, 1));
        return {
            sx, sy, sigmaLen,
            clipped: sx < sigmaXpx - 1e-12 || sy < sigmaYpx - 1e-12,
        };
    }

    /**
     * λs S-filter：高斯低通，移除短於 Nis 的噪聲／微粗糙（輸出即 primary surface）
     */
    function applyLambdaSFilter(src, roiW, roiH, dx, dy, lambdaS) {
        if (!(lambdaS > 0) || !Number.isFinite(lambdaS)) {
            return { filtered: src, applied: false, sigmaXpx: 0, sigmaYpx: 0, clipped: false };
        }
        const { sx, sy, sigmaLen, clipped } = sigmaPxFromLambda(lambdaS, dx, dy, roiW, roiH);
        const low = gaussianLowpassSeparable(src, roiW, roiH, sx, sy);
        return { filtered: low, applied: true, sigmaXpx: sx, sigmaYpx: sy, sigmaLen, clipped };
    }

    /**
     * λc L-filter：高斯低通後取高通殘差（粗糙度分量）
     * σ = α · λc / √(2π)（ISO 16610 權重對應常態核），再除以像素間距轉成像素
     */
    function applyLambdaCFilter(residual, roiW, roiH, dx, dy, lambdaC) {
        if (!(lambdaC > 0) || !Number.isFinite(lambdaC)) {
            return { filtered: residual, applied: false, sigmaXpx: 0, sigmaYpx: 0, clipped: false };
        }
        const { sx, sy, sigmaLen, clipped } = sigmaPxFromLambda(lambdaC, dx, dy, roiW, roiH);
        const low = gaussianLowpassSeparable(residual, roiW, roiH, sx, sy);
        const high = new Float32Array(roiW * roiH);
        for (let i = 0; i < high.length; i++) {
            const r = residual[i];
            const l = low[i];
            high[i] = (Number.isFinite(r) && Number.isFinite(l)) ? (r - l) : NaN;
        }
        return { filtered: high, applied: true, sigmaXpx: sx, sigmaYpx: sy, sigmaLen, clipped };
    }

    /** 在 ROI 列主序陣列上擬合平面（全域像素座標 → 實體座標） */
    function fitPlaneRoi(roiData, roiW, roiH, x0, y0, dx, dy) {
        let sX = 0, sY = 0, sZ = 0, sXX = 0, sYY = 0, sXY = 0, sXZ = 0, sYZ = 0, n = 0;
        for (let ly = 0; ly < roiH; ly++) {
            const py = y0 + ly;
            const y = py * dy;
            const row = ly * roiW;
            for (let lx = 0; lx < roiW; lx++) {
                const z = roiData[row + lx];
                if (!Number.isFinite(z)) continue;
                const px = x0 + lx;
                const x = px * dx;
                sX += x; sY += y; sZ += z;
                sXX += x * x; sYY += y * y; sXY += x * y;
                sXZ += x * z; sYZ += y * z;
                n++;
            }
        }
        if (n < 3) return null;
        const sol = solveLinear3(
            [[sXX, sXY, sX], [sXY, sYY, sY], [sX, sY, n]],
            [sXZ, sYZ, sZ]
        );
        if (!sol) return null;
        return { a: sol[0], b: sol[1], c: sol[2], n };
    }

    /** 在 ROI 列主序陣列上擬合二次曲面（以 ROI 中心為原點的像素座標） */
    function fitQuadraticRoi(roiData, roiW, roiH, x0, y0) {
        const cx = x0 + 0.5 * (roiW - 1);
        const cy = y0 + 0.5 * (roiH - 1);
        const ATA = Array.from({ length: 6 }, () => new Float64Array(6));
        const ATb = new Float64Array(6);
        let n = 0;
        for (let ly = 0; ly < roiH; ly++) {
            const py = y0 + ly;
            const v = py - cy;
            const v2 = v * v;
            const row = ly * roiW;
            for (let lx = 0; lx < roiW; lx++) {
                const z = roiData[row + lx];
                if (!Number.isFinite(z)) continue;
                const px = x0 + lx;
                const u = px - cx;
                const u2 = u * u;
                const uv = u * v;
                const basis = [u2, v2, uv, u, v, 1];
                for (let i = 0; i < 6; i++) {
                    ATb[i] += basis[i] * z;
                    for (let j = 0; j < 6; j++) ATA[i][j] += basis[i] * basis[j];
                }
                n++;
            }
        }
        if (n < 6) return null;
        const A = ATA.map((r) => Array.from(r));
        const sol = solveLinearN(A, Array.from(ATb));
        if (!sol) return null;
        return {
            a: sol[0], b: sol[1], c: sol[2],
            d: sol[3], e: sol[4], f: sol[5],
            cx, cy, n,
        };
    }

    function meanOfRoiArr(roiData) {
        let sum = 0, n = 0;
        for (let i = 0; i < roiData.length; i++) {
            const z = roiData[i];
            if (!Number.isFinite(z)) continue;
            sum += z;
            n++;
        }
        if (n === 0) return null;
        return { mean: sum / n, n };
    }

    /**
     * 計算區域粗糙度參數
     * @param {object} ds
     * @param {{
     *   roi?: object|null,
     *   detrend?: 'none'|'mean'|'plane'|'quadratic',
     *   lambdaS?: number,
     *   lambdaC?: number
     * }} [opts]
     */
    function computeAreal(ds, opts) {
        opts = opts || {};
        if (!ds || !ds.data || ds.type === 'pcd-scatter') {
            return { ok: false, reason: 'unsupported' };
        }
        const detrend = opts.detrend || 'plane';
        const lambdaS = (Number.isFinite(opts.lambdaS) && opts.lambdaS > 0) ? opts.lambdaS : 0;
        const lambdaC = (Number.isFinite(opts.lambdaC) && opts.lambdaC > 0) ? opts.lambdaC : 0;
        const rect = normalizeRoi(ds, opts.roi || null);
        if (rect.x1 < rect.x0 || rect.y1 < rect.y0) {
            return { ok: false, reason: 'emptyRoi' };
        }

        const { data, width } = ds;
        const { dx, dy, zunit } = pixelSpacing(ds);
        const roiW = rect.x1 - rect.x0 + 1;
        const roiH = rect.y1 - rect.y0 + 1;
        const totalPx = roiW * roiH;

        // 1) 抽出 ROI 原始高度
        const zRoi = new Float32Array(totalPx);
        let i = 0;
        let zAbsMax = 0;
        for (let py = rect.y0; py <= rect.y1; py++) {
            for (let px = rect.x0; px <= rect.x1; px++, i++) {
                const z = data[py * width + px];
                if (!Number.isFinite(z)) {
                    zRoi[i] = NaN;
                    continue;
                }
                const az = Math.abs(z);
                if (az > zAbsMax) zAbsMax = az;
                zRoi[i] = z;
            }
        }

        // 2) S-filter（可選）：低通 → primary surface
        const sFilt = applyLambdaSFilter(zRoi, roiW, roiH, dx, dy, lambdaS);
        const primary = sFilt.filtered;

        // 3) F-operation：在 primary 上去趨勢
        let ref = null;
        if (detrend === 'plane') {
            const plane = fitPlaneRoi(primary, roiW, roiH, rect.x0, rect.y0, dx, dy);
            if (!plane) return { ok: false, reason: 'fitFailed' };
            ref = { type: 'plane', a: plane.a, b: plane.b, c: plane.c };
        } else if (detrend === 'quadratic') {
            const quad = fitQuadraticRoi(primary, roiW, roiH, rect.x0, rect.y0);
            if (!quad) return { ok: false, reason: 'fitFailed' };
            ref = {
                type: 'quadratic',
                a: quad.a, b: quad.b, c: quad.c,
                d: quad.d, e: quad.e, f: quad.f,
                cx: quad.cx, cy: quad.cy,
            };
        } else if (detrend === 'mean') {
            const m = meanOfRoiArr(primary);
            if (!m) return { ok: false, reason: 'noValid' };
            ref = { type: 'mean', mean: m.mean };
        } else {
            ref = { type: 'none' };
        }

        const residual = new Float32Array(totalPx);
        i = 0;
        for (let py = rect.y0; py <= rect.y1; py++) {
            for (let px = rect.x0; px <= rect.x1; px++, i++) {
                const z = primary[i];
                if (!Number.isFinite(z)) {
                    residual[i] = NaN;
                    continue;
                }
                residual[i] = z - evalReference(ref, px, py, dx, dy);
            }
        }

        // 4) L-filter（可選）：高通
        const filt = applyLambdaCFilter(residual, roiW, roiH, dx, dy, lambdaC);
        const work = filt.filtered;

        let valid = 0;
        let sumAbs = 0, sumSq = 0, sumCu = 0, sumQu = 0;
        let maxR = -Infinity, minR = Infinity;
        for (let j = 0; j < work.length; j++) {
            const r = work[j];
            if (!Number.isFinite(r)) continue;
            valid++;
            const ar = Math.abs(r);
            sumAbs += ar;
            const r2 = r * r;
            sumSq += r2;
            sumCu += r2 * r;
            sumQu += r2 * r2;
            if (r > maxR) maxR = r;
            if (r < minR) minR = r;
        }

        if (valid === 0) return { ok: false, reason: 'noValid' };

        const Sa = sumAbs / valid;
        const Sq = Math.sqrt(sumSq / valid);
        const Sp = maxR;
        const Sv = -minR;
        const Sz = Sp + Sv;
        // 平坦／數值噪聲殘差上 Ssk、Sku 無定義（勿回傳 0 或浮點假值）
        const sqFloor = Math.max(1e-18, zAbsMax * 1e-9);
        const momentsOk = Sq > sqFloor;
        const Ssk = momentsOk ? (sumCu / valid) / (Sq * Sq * Sq) : NaN;
        const Sku = momentsOk ? (sumQu / valid) / (Sq * Sq * Sq * Sq) : NaN;

        let surfaceType = 'F';
        if (sFilt.applied && filt.applied) surfaceType = 'S-L';
        else if (sFilt.applied) surfaceType = 'S-F';
        else if (filt.applied) surfaceType = 'F-L';

        return {
            ok: true,
            params: { Sa, Sq, Sp, Sv, Sz, Ssk, Sku },
            meta: {
                detrend,
                lambdaS: sFilt.applied ? lambdaS : 0,
                lambdaSApplied: sFilt.applied,
                sigmaSXpx: sFilt.sigmaXpx || 0,
                sigmaSYpx: sFilt.sigmaYpx || 0,
                lambdaSClipped: !!sFilt.clipped,
                lambdaC: filt.applied ? lambdaC : 0,
                lambdaCApplied: filt.applied,
                sigmaXpx: filt.sigmaXpx || 0,
                sigmaYpx: filt.sigmaYpx || 0,
                lambdaCClipped: !!filt.clipped,
                surfaceType,
                roi: { ...rect },
                valid,
                total: totalPx,
                validRatio: valid / totalPx,
                zunit,
                dx,
                dy,
                filename: ds.filename || '',
                width: ds.width,
                height: ds.height,
            },
            residual: work,
            residualSize: { width: roiW, height: roiH },
            residualRange: {
                min: minR,
                max: maxR,
                absMax: Math.max(Math.abs(minR), Math.abs(maxR)) || 1,
            },
            reference: ref,
        };
    }

    function toCsv(result) {
        if (!result || !result.ok) return '';
        const p = result.params;
        const m = result.meta;
        const parts = [];
        if (m.lambdaSApplied) parts.push('S-filtered (lambdaS)');
        if (m.lambdaCApplied) parts.push('L-filtered (lambdaC)');
        const filteredLabel = parts.length ? parts.join(' + ') : 'unfiltered';
        const lines = [
            `# CloudMap surface roughness (areal, ${filteredLabel})`,
            `# filename,${csvEsc(m.filename)}`,
            `# detrend,${m.detrend}`,
            `# surfaceType,${csvEsc(m.surfaceType || '')}`,
            `# lambdaS,${m.lambdaSApplied ? m.lambdaS : 0}`,
            `# lambdaC,${m.lambdaCApplied ? m.lambdaC : 0}`,
            `# roi,${m.roi.x0},${m.roi.y0},${m.roi.x1},${m.roi.y1}`,
            `# valid,${m.valid}`,
            `# total,${m.total}`,
            `# zunit,${csvEsc(m.zunit)}`,
            'parameter,value',
            `Sa,${csvNum(p.Sa)}`,
            `Sq,${csvNum(p.Sq)}`,
            `Sp,${csvNum(p.Sp)}`,
            `Sv,${csvNum(p.Sv)}`,
            `Sz,${csvNum(p.Sz)}`,
            `Ssk,${csvNum(p.Ssk)}`,
            `Sku,${csvNum(p.Sku)}`,
        ];
        return lines.join('\n') + '\n';
    }

    function csvNum(v) {
        return Number.isFinite(v) ? String(v) : '';
    }

    function csvEsc(s) {
        const t = String(s ?? '');
        if (/[",\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
        return t;
    }

    /* =====================================================================
     *  輪廓（profile）粗糙度：Ra / Rq / …
     * ===================================================================== */

    /** 雙線性取樣高度圖（整數格點外推為最近有效鄰點；完全越界 → NaN） */
    function sampleBilinear(data, width, height, x, y) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return NaN;
        if (x < -0.5 || y < -0.5 || x > width - 0.5 || y > height - 0.5) return NaN;
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const x1 = x0 + 1;
        const y1 = y0 + 1;
        const fx = x - x0;
        const fy = y - y0;
        const get = (ix, iy) => {
            if (ix < 0 || iy < 0 || ix >= width || iy >= height) return NaN;
            return data[iy * width + ix];
        };
        const z00 = get(x0, y0);
        const z10 = get(x1, y0);
        const z01 = get(x0, y1);
        const z11 = get(x1, y1);
        const top = Number.isFinite(z00) && Number.isFinite(z10)
            ? z00 * (1 - fx) + z10 * fx
            : (Number.isFinite(z00) ? z00 : (Number.isFinite(z10) ? z10 : NaN));
        const bot = Number.isFinite(z01) && Number.isFinite(z11)
            ? z01 * (1 - fx) + z11 * fx
            : (Number.isFinite(z01) ? z01 : (Number.isFinite(z11) ? z11 : NaN));
        if (Number.isFinite(top) && Number.isFinite(bot)) return top * (1 - fy) + bot * fy;
        if (Number.isFinite(top)) return top;
        if (Number.isFinite(bot)) return bot;
        return NaN;
    }

    /**
     * 正規化剖面線（影像像素座標）
     * @param {{x0:number,y0:number,x1:number,y1:number}|null} line
     */
    function normalizeLine(ds, line) {
        const { width, height } = ds;
        if (!line) return null;
        let x0 = Number(line.x0), y0 = Number(line.y0);
        let x1 = Number(line.x1), y1 = Number(line.y1);
        if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
        x0 = clamp(x0, 0, width - 1);
        y0 = clamp(y0, 0, height - 1);
        x1 = clamp(x1, 0, width - 1);
        y1 = clamp(y1, 0, height - 1);
        const lenPx = Math.hypot(x1 - x0, y1 - y0);
        if (lenPx < 1) return null;
        return { x0, y0, x1, y1, lengthPx: lenPx };
    }

    /**
     * 沿剖面線取樣（約每像素一點）
     * @returns {{z:Float32Array,s:Float32Array,n:number,ds:number}|null}
     *   s = 沿線弧長（實體單位），ds = 取樣間距
     */
    function extractProfile(ds, line) {
        const ln = normalizeLine(ds, line);
        if (!ln) return null;
        const { data, width, height } = ds;
        const { dx, dy } = pixelSpacing(ds);
        const lenPx = ln.lengthPx;
        const nSamp = Math.max(2, Math.floor(lenPx) + 1);
        const z = new Float32Array(nSamp);
        const s = new Float32Array(nSamp);
        const ux = (ln.x1 - ln.x0) / lenPx;
        const uy = (ln.y1 - ln.y0) / lenPx;
        // 實體單位：沿線方向每像素位移
        const dPhysPerPx = Math.hypot(ux * dx, uy * dy);
        for (let i = 0; i < nSamp; i++) {
            const t = i / (nSamp - 1);
            const px = ln.x0 + t * (ln.x1 - ln.x0);
            const py = ln.y0 + t * (ln.y1 - ln.y0);
            z[i] = sampleBilinear(data, width, height, px, py);
            s[i] = t * lenPx * dPhysPerPx;
        }
        return {
            z, s, n: nSamp,
            ds: dPhysPerPx,
            line: ln,
            length: s[nSamp - 1],
        };
    }

    /** 1D 高斯低通（邊界鏡射；核內任一 NaN → 輸出 NaN） */
    function gaussianLowpass1d(src, sigmaPx) {
        if (!(sigmaPx > 0) || !Number.isFinite(sigmaPx)) {
            return src.slice ? src.slice() : Float32Array.from(src);
        }
        const { k, radius } = gaussianKernel1d(sigmaPx);
        const n = src.length;
        const out = new Float32Array(n);
        const mirror = (i) => {
            if (n <= 1) return 0;
            while (i < 0 || i >= n) {
                if (i < 0) i = -i;
                if (i >= n) i = 2 * n - 2 - i;
            }
            return i;
        };
        for (let i = 0; i < n; i++) {
            let sum = 0;
            let incomplete = false;
            for (let t = -radius; t <= radius; t++) {
                const v = src[mirror(i + t)];
                if (!Number.isFinite(v)) { incomplete = true; break; }
                sum += v * k[t + radius];
            }
            out[i] = incomplete ? NaN : sum;
        }
        return out;
    }

    function applyLambdaSFilter1d(src, dsPhys, lambdaS) {
        if (!(lambdaS > 0) || !Number.isFinite(lambdaS) || !(dsPhys > 0)) {
            return { filtered: src, applied: false, sigmaPx: 0, clipped: false };
        }
        const sigmaLen = sigmaFromLambdaC(lambdaS);
        let sigmaPx = sigmaLen / dsPhys;
        const clipped = sigmaPx > src.length;
        if (clipped) sigmaPx = src.length;
        return {
            filtered: gaussianLowpass1d(src, sigmaPx),
            applied: true,
            sigmaPx,
            sigmaLen,
            clipped,
        };
    }

    function applyLambdaCFilter1d(residual, dsPhys, lambdaC) {
        if (!(lambdaC > 0) || !Number.isFinite(lambdaC) || !(dsPhys > 0)) {
            return { filtered: residual, applied: false, sigmaPx: 0, clipped: false };
        }
        const sigmaLen = sigmaFromLambdaC(lambdaC);
        let sigmaPx = sigmaLen / dsPhys;
        const clipped = sigmaPx > residual.length;
        if (clipped) sigmaPx = residual.length;
        const low = gaussianLowpass1d(residual, sigmaPx);
        const high = new Float32Array(residual.length);
        for (let i = 0; i < residual.length; i++) {
            const r = residual[i];
            const l = low[i];
            high[i] = (Number.isFinite(r) && Number.isFinite(l)) ? (r - l) : NaN;
        }
        return { filtered: high, applied: true, sigmaPx, sigmaLen, clipped };
    }

    /** 最小平方直線 z = a·s + b（s 為弧長） */
    function fitLine1d(z, s) {
        let sumS = 0, sumZ = 0, sumSS = 0, sumSZ = 0, n = 0;
        for (let i = 0; i < z.length; i++) {
            const zi = z[i];
            if (!Number.isFinite(zi) || !Number.isFinite(s[i])) continue;
            sumS += s[i];
            sumZ += zi;
            sumSS += s[i] * s[i];
            sumSZ += s[i] * zi;
            n++;
        }
        if (n < 2) return null;
        const den = n * sumSS - sumS * sumS;
        if (Math.abs(den) < 1e-30) {
            return { a: 0, b: sumZ / n, n };
        }
        const a = (n * sumSZ - sumS * sumZ) / den;
        const b = (sumZ - a * sumS) / n;
        return { a, b, n };
    }

    function meanOfProfile(z) {
        let sum = 0, n = 0;
        for (let i = 0; i < z.length; i++) {
            if (!Number.isFinite(z[i])) continue;
            sum += z[i];
            n++;
        }
        if (n === 0) return null;
        return { mean: sum / n, n };
    }

    /** 單一取樣段上的振幅參數 */
    function statsOnSegment(work, i0, i1) {
        let valid = 0;
        let sumAbs = 0, sumSq = 0, sumCu = 0, sumQu = 0;
        let maxR = -Infinity, minR = Infinity;
        for (let i = i0; i < i1; i++) {
            const r = work[i];
            if (!Number.isFinite(r)) continue;
            valid++;
            const ar = Math.abs(r);
            sumAbs += ar;
            const r2 = r * r;
            sumSq += r2;
            sumCu += r2 * r;
            sumQu += r2 * r2;
            if (r > maxR) maxR = r;
            if (r < minR) minR = r;
        }
        if (valid === 0) return null;
        const Ra = sumAbs / valid;
        const Rq = Math.sqrt(sumSq / valid);
        const Rp = maxR;
        const Rv = -minR;
        const Rz = Rp + Rv;
        return { Ra, Rq, Rp, Rv, Rz, sumCu, sumQu, valid, maxR, minR };
    }

    /**
     * 計算輪廓粗糙度參數
     * @param {object} ds
     * @param {{
     *   line: {x0:number,y0:number,x1:number,y1:number},
     *   detrend?: 'none'|'mean'|'line',
     *   lambdaS?: number,
     *   lambdaC?: number,
     *   samplingLength?: number  // 取樣長度；預設在有 λc 時用 λc，否則整段
     * }} opts
     */
    function computeProfile(ds, opts) {
        opts = opts || {};
        if (!ds || !ds.data || ds.type === 'pcd-scatter') {
            return { ok: false, reason: 'unsupported' };
        }
        if (!opts.line) return { ok: false, reason: 'noLine' };

        const detrend = opts.detrend || 'line';
        const lambdaS = (Number.isFinite(opts.lambdaS) && opts.lambdaS > 0) ? opts.lambdaS : 0;
        const lambdaC = (Number.isFinite(opts.lambdaC) && opts.lambdaC > 0) ? opts.lambdaC : 0;

        const prof = extractProfile(ds, opts.line);
        if (!prof) return { ok: false, reason: 'emptyLine' };

        const { z: zRaw, s, n, ds: dsPhys, line, length } = prof;
        const { zunit } = pixelSpacing(ds);

        let zAbsMax = 0;
        for (let i = 0; i < n; i++) {
            if (Number.isFinite(zRaw[i])) {
                const a = Math.abs(zRaw[i]);
                if (a > zAbsMax) zAbsMax = a;
            }
        }

        // 1) λs S-filter
        const sFilt = applyLambdaSFilter1d(zRaw, dsPhys, lambdaS);
        const primary = sFilt.filtered;

        // 2) 去趨勢
        let ref = null;
        if (detrend === 'line') {
            const fit = fitLine1d(primary, s);
            if (!fit) return { ok: false, reason: 'fitFailed' };
            ref = { type: 'line', a: fit.a, b: fit.b };
        } else if (detrend === 'mean') {
            const m = meanOfProfile(primary);
            if (!m) return { ok: false, reason: 'noValid' };
            ref = { type: 'mean', mean: m.mean };
        } else {
            ref = { type: 'none' };
        }

        const residual = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const z = primary[i];
            if (!Number.isFinite(z)) {
                residual[i] = NaN;
                continue;
            }
            if (ref.type === 'line') residual[i] = z - (ref.a * s[i] + ref.b);
            else if (ref.type === 'mean') residual[i] = z - ref.mean;
            else residual[i] = z;
        }

        // 3) λc L-filter
        const filt = applyLambdaCFilter1d(residual, dsPhys, lambdaC);
        const work = filt.filtered;

        // 評估長度上的 Rt（總高度）
        let maxAll = -Infinity, minAll = Infinity, validAll = 0;
        for (let i = 0; i < n; i++) {
            const r = work[i];
            if (!Number.isFinite(r)) continue;
            validAll++;
            if (r > maxAll) maxAll = r;
            if (r < minAll) minAll = r;
        }
        if (validAll === 0) return { ok: false, reason: 'noValid' };
        const Rt = maxAll - minAll;

        // 取樣長度：優先 opts.samplingLength，其次 λc，否則整段
        let lr = (Number.isFinite(opts.samplingLength) && opts.samplingLength > 0)
            ? opts.samplingLength
            : (filt.applied ? lambdaC : 0);
        if (!(lr > 0) || lr > length) lr = length;

        const segCount = Math.max(1, Math.floor(length / lr + 1e-9));
        const segs = [];
        for (let si = 0; si < segCount; si++) {
            const s0 = si * lr;
            const s1 = (si === segCount - 1) ? length : (si + 1) * lr;
            // 找對應索引區間
            let i0 = 0, i1 = n;
            for (let i = 0; i < n; i++) {
                if (s[i] + 1e-12 >= s0) { i0 = i; break; }
            }
            for (let i = n - 1; i >= 0; i--) {
                if (s[i] <= s1 + 1e-12) { i1 = i + 1; break; }
            }
            if (i1 <= i0) continue;
            const st = statsOnSegment(work, i0, i1);
            if (st) segs.push(st);
        }
        if (!segs.length) return { ok: false, reason: 'noValid' };

        const avg = (key) => segs.reduce((a, g) => a + g[key], 0) / segs.length;
        const Ra = avg('Ra');
        const Rq = avg('Rq');
        const Rp = avg('Rp');
        const Rv = avg('Rv');
        const Rz = avg('Rz');

        // Rsk / Rku：在整段評估長度上計算（與多數軟體實作一致）
        let sumCu = 0, sumQu = 0;
        for (let i = 0; i < n; i++) {
            const r = work[i];
            if (!Number.isFinite(r)) continue;
            const r2 = r * r;
            sumCu += r2 * r;
            sumQu += r2 * r2;
        }
        const rqFloor = Math.max(1e-18, zAbsMax * 1e-9);
        // 整段 Rq（非分段平均）供高階矩正規化
        let sumSqAll = 0;
        for (let i = 0; i < n; i++) {
            const r = work[i];
            if (!Number.isFinite(r)) continue;
            sumSqAll += r * r;
        }
        const RqEval = Math.sqrt(sumSqAll / validAll);
        const momentsOk = RqEval > rqFloor;
        const Rsk = momentsOk ? (sumCu / validAll) / (RqEval * RqEval * RqEval) : NaN;
        const Rku = momentsOk ? (sumQu / validAll) / (RqEval * RqEval * RqEval * RqEval) : NaN;

        let surfaceType = 'P';
        if (sFilt.applied && filt.applied) surfaceType = 'R';
        else if (sFilt.applied) surfaceType = 'P(S)';
        else if (filt.applied) surfaceType = 'R(no-S)';

        return {
            ok: true,
            kind: 'profile',
            params: { Ra, Rq, Rp, Rv, Rz, Rt, Rsk, Rku },
            meta: {
                detrend,
                lambdaS: sFilt.applied ? lambdaS : 0,
                lambdaSApplied: sFilt.applied,
                sigmaSPx: sFilt.sigmaPx || 0,
                lambdaSClipped: !!sFilt.clipped,
                lambdaC: filt.applied ? lambdaC : 0,
                lambdaCApplied: filt.applied,
                sigmaCPx: filt.sigmaPx || 0,
                lambdaCClipped: !!filt.clipped,
                samplingLength: lr,
                segmentCount: segs.length,
                surfaceType,
                line: { ...line },
                length,
                valid: validAll,
                total: n,
                validRatio: validAll / n,
                zunit,
                ds: dsPhys,
                filename: ds.filename || '',
                width: ds.width,
                height: ds.height,
            },
            profile: {
                s,
                z: work,
                primary,
                raw: zRaw,
            },
            residualRange: {
                min: minAll,
                max: maxAll,
                absMax: Math.max(Math.abs(minAll), Math.abs(maxAll)) || 1,
            },
            reference: ref,
        };
    }

    function toCsvProfile(result) {
        if (!result || !result.ok) return '';
        const p = result.params;
        const m = result.meta;
        const parts = [];
        if (m.lambdaSApplied) parts.push('S-filtered (lambdaS)');
        if (m.lambdaCApplied) parts.push('L-filtered (lambdaC)');
        const filteredLabel = parts.length ? parts.join(' + ') : 'unfiltered';
        const ln = m.line || {};
        const lines = [
            `# CloudMap profile roughness (ISO 4287-style, ${filteredLabel})`,
            `# filename,${csvEsc(m.filename)}`,
            `# detrend,${m.detrend}`,
            `# surfaceType,${csvEsc(m.surfaceType || '')}`,
            `# lambdaS,${m.lambdaSApplied ? m.lambdaS : 0}`,
            `# lambdaC,${m.lambdaCApplied ? m.lambdaC : 0}`,
            `# samplingLength,${m.samplingLength}`,
            `# segmentCount,${m.segmentCount}`,
            `# line,${ln.x0},${ln.y0},${ln.x1},${ln.y1}`,
            `# length,${m.length}`,
            `# valid,${m.valid}`,
            `# total,${m.total}`,
            `# zunit,${csvEsc(m.zunit)}`,
            'parameter,value',
            `Ra,${csvNum(p.Ra)}`,
            `Rq,${csvNum(p.Rq)}`,
            `Rp,${csvNum(p.Rp)}`,
            `Rv,${csvNum(p.Rv)}`,
            `Rz,${csvNum(p.Rz)}`,
            `Rt,${csvNum(p.Rt)}`,
            `Rsk,${csvNum(p.Rsk)}`,
            `Rku,${csvNum(p.Rku)}`,
        ];
        return lines.join('\n') + '\n';
    }

    return {
        computeAreal,
        computeProfile,
        extractProfile,
        normalizeRoi,
        normalizeLine,
        pixelSpacing,
        toCsv,
        toCsvProfile,
        GAUSS_ALPHA,
        sigmaFromLambdaC,
    };
})();
