/**
 * 點雲分析頁（表面／輪廓粗糙度）
 * 依賴：file-parse.js, colormap.js, roughness.js, i18n / prefs
 * 匯出（全域）：AnalysisView
 */
/* =========================================================================
 *  點雲分析：載入高度圖、ROI／剖面線、粗糙度計算與結果顯示
 * ========================================================================= */
const AnalysisView = (() => {
    const el = {
        page: document.getElementById('pageAnalysis'),
        viewer: document.getElementById('anViewer'),
        canvas: document.getElementById('anCanvas'),
        overlay: document.getElementById('anOverlay'),
        placeholder: document.getElementById('anPlaceholder'),
        zoomHint: document.getElementById('anZoomHint'),
        zoomIndicator: document.getElementById('anZoomIndicator'),
        dropIcon: document.getElementById('anDropIcon'),
        dropText: document.getElementById('anDropText'),
        fileInput: document.getElementById('anFileInput'),
        btnClear: document.getElementById('anBtnClear'),
        colormap: document.getElementById('anColormap'),
        progress: document.getElementById('anProgress'),
        progressBar: document.getElementById('anProgressBar'),
        status: document.getElementById('anStatus'),
        infoList: document.getElementById('anInfoList'),
        colorbarCanvas: document.getElementById('anColorbarCanvas'),
        zMin: document.getElementById('anZMin'),
        zMax: document.getElementById('anZMax'),
        roiOverlay: document.getElementById('anRoiOverlay'),
        roiShape: document.getElementById('anRoiShape'),
        roiHint: document.getElementById('anRoiHint'),
        btnRoi: document.getElementById('anBtnRoi'),
        btnRoiClear: document.getElementById('anBtnRoiClear'),
        btnRoiFull: document.getElementById('anBtnRoiFull'),
        detrend: document.getElementById('anDetrend'),
        lambdaS: document.getElementById('anLambdaS'),
        lambdaSPreset: document.getElementById('anLambdaSPreset'),
        lambdaC: document.getElementById('anLambdaC'),
        lambdaCPreset: document.getElementById('anLambdaCPreset'),
        btnCompute: document.getElementById('anBtnCompute'),
        btnExport: document.getElementById('anBtnExport'),
        viewMode: document.getElementById('anViewMode'),
        resultPanel: document.getElementById('anResultPanel'),
        resultMeta: document.getElementById('anResultMeta'),
        residualCanvas: document.getElementById('anResidualCanvas'),
        histCanvas: document.getElementById('anHistCanvas'),
        histOverlay: document.getElementById('anHistOverlay'),
        histCloseBtn: document.getElementById('anHistCloseBtn'),
        histLargeCanvas: document.getElementById('anHistLargeCanvas'),
        histReadout: document.getElementById('anHistReadout'),
        modeBadge: document.getElementById('anModeBadge'),
        main: document.getElementById('anMain'),
        navToggle: document.getElementById('anNavToggle'),
        panelRoughness: document.getElementById('anPanelRoughness'),
        panelProfile: document.getElementById('anPanelProfile'),
        // 輪廓粗糙度
        pfDetrend: document.getElementById('anPfDetrend'),
        pfLambdaS: document.getElementById('anPfLambdaS'),
        pfLambdaSPreset: document.getElementById('anPfLambdaSPreset'),
        pfLambdaC: document.getElementById('anPfLambdaC'),
        pfLambdaCPreset: document.getElementById('anPfLambdaCPreset'),
        btnLine: document.getElementById('anBtnLine'),
        btnLineH: document.getElementById('anBtnLineH'),
        btnLineV: document.getElementById('anBtnLineV'),
        btnLineClear: document.getElementById('anBtnLineClear'),
        btnPfCompute: document.getElementById('anBtnPfCompute'),
        btnPfExport: document.getElementById('anBtnPfExport'),
        pfResultPanel: document.getElementById('anPfResultPanel'),
        pfResultMeta: document.getElementById('anPfResultMeta'),
        pfPlotCanvas: document.getElementById('anPfPlotCanvas'),
        pfPlotOverlay: document.getElementById('anPfPlotOverlay'),
        pfPlotCloseBtn: document.getElementById('anPfPlotCloseBtn'),
        pfPlotLargeCanvas: document.getElementById('anPfPlotLargeCanvas'),
        pfPlotReadout: document.getElementById('anPfPlotReadout'),
        lineOverlay: document.getElementById('anLineOverlay'),
        lineSvg: document.getElementById('anLineSvg'),
        lineSeg: document.getElementById('anLineSeg'),
        lineH0: document.getElementById('anLineH0'),
        lineH1: document.getElementById('anLineH1'),
        lineHint: document.getElementById('anLineHint'),
    };

    const PARAM_KEYS = ['Sa', 'Sq', 'Sz', 'Sp', 'Sv', 'Ssk', 'Sku'];
    const PF_PARAM_KEYS = ['Ra', 'Rq', 'Rz', 'Rp', 'Rv', 'Rt', 'Rsk', 'Rku'];

    const st = {
        dataset: null,
        tool: 'profile', // 'roughness' | 'profile'
        view: { scale: 1, tx: 0, ty: 0 },
        roiMode: false,
        roiSel: null,       // 視埠 CSS px
        roiImage: null,     // 連續影像座標（右下開區間）；計算時再量化
        roiAction: null,
        useFullImage: true,
        result: null,
        displayMode: 'height', // 'height' | 'residual'
        // 剖面線（影像像素座標）
        lineMode: false,
        lineImage: null,    // {x0,y0,x1,y1}
        lineAction: null,
        pfResult: null,
        pfPlotLayout: null,      // 放大圖座標對應
        pfPlotCursorS: null,
        pfPlotCtxMenu: null,
        residualCtxMenu: null,
        histCtxMenu: null,
        histLayout: null,        // 放大直方圖座標對應
        histCursorBin: null,
        dragDepth: 0,
        panning: false,
        panStart: null,
    };

    function setProgress(p) {
        if (!el.progress) return;
        el.progress.classList.add('show');
        if (el.progressBar) el.progressBar.style.width = (p * 100).toFixed(1) + '%';
    }
    function hideProgress() {
        setTimeout(() => { if (el.progress) el.progress.classList.remove('show'); }, 300);
    }

    function viewerSize() {
        return {
            w: Math.max(1, el.viewer.clientWidth),
            h: Math.max(1, el.viewer.clientHeight),
        };
    }

    function formatVal(v, digits) {
        if (!Number.isFinite(v)) return '-';
        const d = digits != null ? digits : (Math.abs(v) >= 100 || Math.abs(v) < 1e-3 ? 4 : 6);
        return Number(v).toPrecision ? Number(v).toFixed(Math.min(6, Math.max(3, d))) : String(v);
    }

    function fmtParam(key, v) {
        if (key === 'Ssk' || key === 'Sku' || key === 'Rsk' || key === 'Rku') {
            return Number.isFinite(v) ? v.toFixed(4) : '-';
        }
        return Number.isFinite(v) ? v.toFixed(6) : '-';
    }

    function formatSpacing(v) {
        if (!Number.isFinite(v)) return '-';
        const a = Math.abs(v);
        if (a >= 1e6 || (a > 0 && a < 1e-3)) return v.toExponential(2);
        if (a >= 100) return v.toFixed(0);
        return v.toPrecision(4);
    }

    function readAxisLengths(ds) {
        const hdr = (ds && ds.header) || {};
        let xl = parseFloat(hdr.xlength ?? hdr['x-length'] ?? 0);
        let yl = parseFloat(hdr.ylength ?? hdr['y-length'] ?? 0);
        if (!Number.isFinite(xl) || xl <= 0) xl = ds?.width || 0;
        if (!Number.isFinite(yl) || yl <= 0) yl = ds?.height || 0;
        return { xl, yl };
    }

    function formatLambdaOptionValue(v) {
        if (!Number.isFinite(v) || v <= 0) return '0';
        const a = Math.abs(v);
        if (a >= 1e5 || a < 1e-2) return Number(v.toPrecision(6)).toString();
        if (Math.abs(v - Math.round(v)) < 1e-9 * Math.max(1, a)) return String(Math.round(v));
        return Number(v.toPrecision(6)).toString();
    }

    function valuesNearlyEqual(a, b) {
        const aa = Number(a), bb = Number(b);
        if (!Number.isFinite(aa) || !Number.isFinite(bb)) return false;
        const scale = Math.max(1, Math.abs(aa), Math.abs(bb));
        return Math.abs(aa - bb) <= scale * 1e-9;
    }

    /**
     * 重建 λ 預設選單
     * @param {'S'|'C'} which
     * @param {{keepValue?: boolean, scope?: 'areal'|'profile'}} [opts]
     */
    function rebuildOneLambdaPreset(which, opts) {
        opts = opts || {};
        const keepValue = opts.keepValue !== false;
        const scope = opts.scope || 'areal';
        const isS = which === 'S';
        const isPf = scope === 'profile';
        const inputEl = isPf
            ? (isS ? el.pfLambdaS : el.pfLambdaC)
            : (isS ? el.lambdaS : el.lambdaC);
        const sel = isPf
            ? (isS ? el.pfLambdaSPreset : el.pfLambdaCPreset)
            : (isS ? el.lambdaSPreset : el.lambdaCPreset);
        if (!sel) return;

        const prev = keepValue && inputEl ? parseFloat(inputEl.value) : 0;
        sel.innerHTML = '';

        const addOpt = (value, label) => {
            const opt = document.createElement('option');
            opt.value = formatLambdaOptionValue(value);
            opt.textContent = label;
            sel.appendChild(opt);
        };

        addOpt(0, t(isS ? 'anLambdaSOff' : 'anLambdaCOff'));

        const ds = st.dataset;
        if (ds) {
            const { xl, yl } = readAxisLengths(ds);
            const sp = Roughness.pixelSpacing(ds);
            const seen = new Set(['0']);
            const sameXY = valuesNearlyEqual(xl, yl);
            // S-filter 偏向較短波長；L-filter 涵蓋較長尺度
            const divisors = isS
                ? [1000, 10000, 100000, 1000000]
                : [10, 100, 1000, 10000, 100000, 1000000];

            if (isS && sp.dx > 0) {
                for (const mult of [3, 5]) {
                    const v = mult * sp.dx;
                    const key = formatLambdaOptionValue(v);
                    if (seen.has(key)) continue;
                    seen.add(key);
                    addOpt(v, `${t('anLambdaSFromDx', String(mult))}  (${formatSpacing(v)})`);
                }
            }

            const pushLen = (len, labelKey) => {
                if (!(len > 0)) return;
                for (const d of divisors) {
                    const v = len / d;
                    if (!(v > 0) || !Number.isFinite(v)) continue;
                    const key = formatLambdaOptionValue(v);
                    if (seen.has(key)) continue;
                    seen.add(key);
                    addOpt(v, `${t(labelKey, String(d))}  (${formatSpacing(v)})`);
                }
            };

            if (sameXY) {
                pushLen(Math.max(xl, yl), isS ? 'anLambdaSFromMax' : 'anLambdaCFromMax');
            } else {
                pushLen(xl, isS ? 'anLambdaSFromX' : 'anLambdaCFromX');
                pushLen(yl, isS ? 'anLambdaSFromY' : 'anLambdaCFromY');
            }
        }

        const custom = document.createElement('option');
        custom.value = '__custom__';
        custom.textContent = t(isS ? 'anLambdaSCustom' : 'anLambdaCCustom');
        sel.appendChild(custom);

        const target = Number.isFinite(prev) && prev >= 0 ? prev : 0;
        if (inputEl) inputEl.value = String(target);
        syncLambdaPresetFromInput(which, scope);
    }

    function rebuildLambdaPresets(opts) {
        opts = opts || {};
        rebuildOneLambdaPreset('S', { ...opts, scope: 'areal' });
        rebuildOneLambdaPreset('C', { ...opts, scope: 'areal' });
        rebuildOneLambdaPreset('S', { ...opts, scope: 'profile' });
        rebuildOneLambdaPreset('C', { ...opts, scope: 'profile' });
    }

    function syncLambdaPresetFromInput(which, scope) {
        scope = scope || 'areal';
        const isS = which === 'S';
        const isPf = scope === 'profile';
        const inputEl = isPf
            ? (isS ? el.pfLambdaS : el.pfLambdaC)
            : (isS ? el.lambdaS : el.lambdaC);
        const sel = isPf
            ? (isS ? el.pfLambdaSPreset : el.pfLambdaCPreset)
            : (isS ? el.lambdaSPreset : el.lambdaCPreset);
        if (!sel || !inputEl) return;
        const v = parseFloat(inputEl.value);
        const val = (!Number.isFinite(v) || v < 0) ? 0 : v;
        const key = formatLambdaOptionValue(val);
        let matched = false;
        for (const opt of sel.options) {
            if (opt.value === '__custom__') continue;
            if (opt.value === key || valuesNearlyEqual(opt.value, val)) {
                sel.value = opt.value;
                matched = true;
                break;
            }
        }
        if (!matched) sel.value = '__custom__';
    }

    function applyLambdaPresetSelection(which, scope) {
        scope = scope || 'areal';
        const isS = which === 'S';
        const isPf = scope === 'profile';
        const inputEl = isPf
            ? (isS ? el.pfLambdaS : el.pfLambdaC)
            : (isS ? el.lambdaS : el.lambdaC);
        const sel = isPf
            ? (isS ? el.pfLambdaSPreset : el.pfLambdaCPreset)
            : (isS ? el.lambdaSPreset : el.lambdaCPreset);
        if (!sel || !inputEl) return;
        const v = sel.value;
        if (v === '__custom__') {
            inputEl.focus();
            inputEl.select();
            return;
        }
        inputEl.value = v;
    }

    function onLambdaParamChanged() {
        if (st.tool === 'profile') {
            if (st.pfResult) clearPfResult();
        } else if (st.result) {
            clearResult();
            if (st.dataset) render(false);
        }
    }

    /* ---- 渲染 ---- */
    const DIV_LUT = buildColormapLut('bwr');

    function renderPixels() {
        const ds = st.dataset;
        if (!ds || !el.canvas) return;
        const ctx = el.canvas.getContext('2d');
        const { width, height, data } = ds;
        el.canvas.width = width;
        el.canvas.height = height;
        el.canvas.style.width = '';
        el.canvas.style.height = '';
        const img = ctx.createImageData(width, height);
        const px = img.data;

        if (st.displayMode === 'residual' && st.result && st.result.ok) {
            const res = st.result.residual;
            const { width: rw, height: rh } = st.result.residualSize;
            const rect = st.result.meta.roi;
            const absMax = st.result.residualRange.absMax || 1;
            // 先填黑
            for (let i = 0; i < width * height; i++) {
                const po = i * 4;
                px[po] = px[po + 1] = px[po + 2] = 20;
                px[po + 3] = 255;
            }
            let ri = 0;
            for (let py = 0; py < rh; py++) {
                for (let px_ = 0; px_ < rw; px_++, ri++) {
                    const v = res[ri];
                    const ix = rect.x0 + px_;
                    const iy = rect.y0 + py;
                    const po = (iy * width + ix) * 4;
                    if (!Number.isFinite(v)) {
                        px[po] = px[po + 1] = px[po + 2] = 0;
                        px[po + 3] = 255;
                        continue;
                    }
                    let t = (v / absMax) * 0.5 + 0.5;
                    if (t < 0) t = 0; else if (t > 1) t = 1;
                    const lo = ((t * 255) | 0) * 3;
                    px[po] = DIV_LUT[lo];
                    px[po + 1] = DIV_LUT[lo + 1];
                    px[po + 2] = DIV_LUT[lo + 2];
                    px[po + 3] = 255;
                }
            }
            el.zMin.textContent = (-absMax).toFixed(4);
            el.zMax.textContent = absMax.toFixed(4);
        } else {
            const cmap = el.colormap?.value || 'jet';
            const lut = buildColormapLut(cmap);
            const vmin = ds.vmin, vmax = ds.vmax;
            const crange = (vmax - vmin) || 1;
            for (let i = 0; i < data.length; i++) {
                const po = i * 4;
                const v = data[i];
                if (!Number.isFinite(v)) {
                    px[po] = px[po + 1] = px[po + 2] = 0;
                    px[po + 3] = 255;
                    continue;
                }
                let t = (v - vmin) / crange;
                if (t < 0) t = 0; else if (t > 1) t = 1;
                const lo = ((t * 255) | 0) * 3;
                px[po] = lut[lo];
                px[po + 1] = lut[lo + 1];
                px[po + 2] = lut[lo + 2];
                px[po + 3] = 255;
            }
            el.zMin.textContent = vmin.toFixed(4);
            el.zMax.textContent = vmax.toFixed(4);
        }
        ctx.putImageData(img, 0, 0);
        el.canvas.style.display = 'block';
        if (el.placeholder) el.placeholder.style.display = 'none';
        if (el.zoomIndicator) el.zoomIndicator.classList.add('show');
        if (el.zoomHint) el.zoomHint.classList.add('show');
        renderColorbar();
    }

    function renderColorbar() {
        const cb = el.colorbarCanvas;
        if (!cb) return;
        const ctx = cb.getContext('2d');
        const w = cb.width, h = cb.height;
        const img = ctx.createImageData(w, h);
        if (st.displayMode === 'residual' && st.result && st.result.ok) {
            for (let x = 0; x < w; x++) {
                const t = x / (w - 1);
                const [r, g, b] = sampleColormap('bwr', t);
                for (let y = 0; y < h; y++) {
                    const p = (y * w + x) * 4;
                    img.data[p] = Math.round(r * 255);
                    img.data[p + 1] = Math.round(g * 255);
                    img.data[p + 2] = Math.round(b * 255);
                    img.data[p + 3] = 255;
                }
            }
        } else {
            const cmap = el.colormap?.value || 'jet';
            for (let x = 0; x < w; x++) {
                const t = x / (w - 1);
                const [r, g, b] = sampleColormap(cmap, t);
                for (let y = 0; y < h; y++) {
                    const p = (y * w + x) * 4;
                    img.data[p] = Math.round(r * 255);
                    img.data[p + 1] = Math.round(g * 255);
                    img.data[p + 2] = Math.round(b * 255);
                    img.data[p + 3] = 255;
                }
            }
        }
        ctx.putImageData(img, 0, 0);
    }

    function applyTransform(opts) {
        opts = opts || {};
        if (!el.canvas) return;
        el.canvas.style.transform = `translate(${st.view.tx}px, ${st.view.ty}px) scale(${st.view.scale})`;
        if (el.zoomIndicator) {
            const pct = st.view.scale * 100;
            el.zoomIndicator.textContent = (pct >= 100 ? pct.toFixed(0) : pct.toFixed(1)) + '%';
        }
        // 縮放／平移時需同步 ROI／剖面線；ROI 放開後重繪則略過，避免框被量化回寫而變大
        if (opts.syncRoi !== false) syncRoiShapeFromImage();
        if (opts.syncLine !== false) syncLineFromImage();
    }

    function fitImage() {
        if (!st.dataset) return;
        const { w: vw, h: vh } = viewerSize();
        // 頁面剛顯示時尺寸可能仍為 0，稍後再 fit
        if (vw < 8 || vh < 8) {
            requestAnimationFrame(() => fitImage());
            return;
        }
        const w = st.dataset.width, h = st.dataset.height, padding = 24;
        const s = Math.min((vw - padding * 2) / w, (vh - padding * 2) / h, 8);
        st.view.scale = s > 0 ? s : 1;
        st.view.tx = (vw - w * st.view.scale) / 2;
        st.view.ty = (vh - h * st.view.scale) / 2;
        applyTransform();
    }

    function render(resetView, opts) {
        if (!st.dataset) return;
        renderPixels();
        if (resetView) fitImage();
        else applyTransform(opts);
    }

    /* ---- ROI 座標轉換 ---- */
    function imageToViewport(ix, iy) {
        return {
            x: ix * st.view.scale + st.view.tx,
            y: iy * st.view.scale + st.view.ty,
        };
    }
    function viewportToImage(vx, vy) {
        return {
            x: (vx - st.view.tx) / st.view.scale,
            y: (vy - st.view.ty) / st.view.scale,
        };
    }

    function syncRoiShapeFromImage() {
        if (!el.roiShape) return;
        if (st.useFullImage || !st.roiImage) {
            el.roiShape.style.display = 'none';
            return;
        }
        // 連續開區間座標：直接映射，不做整數吸附，避免放開時框變大
        const a = imageToViewport(st.roiImage.x0, st.roiImage.y0);
        const b = imageToViewport(st.roiImage.x1, st.roiImage.y1);
        const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
        const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
        st.roiSel = { x0, y0, x1, y1 };
        el.roiShape.style.display = 'block';
        el.roiShape.style.left = x0 + 'px';
        el.roiShape.style.top = y0 + 'px';
        el.roiShape.style.width = (x1 - x0) + 'px';
        el.roiShape.style.height = (y1 - y0) + 'px';
    }

    function commitRoiFromViewport() {
        if (!st.roiSel || !st.dataset) return;
        const { width, height } = st.dataset;
        const n = {
            x0: Math.min(st.roiSel.x0, st.roiSel.x1),
            y0: Math.min(st.roiSel.y0, st.roiSel.y1),
            x1: Math.max(st.roiSel.x0, st.roiSel.x1),
            y1: Math.max(st.roiSel.y0, st.roiSel.y1),
        };
        const p0 = viewportToImage(n.x0, n.y0);
        const p1 = viewportToImage(n.x1, n.y1);
        let x0 = Math.min(p0.x, p1.x);
        let y0 = Math.min(p0.y, p1.y);
        let x1 = Math.max(p0.x, p1.x);
        let y1 = Math.max(p0.y, p1.y);
        // 裁到影像範圍（右下開區間，故上限為 width/height）
        x0 = Math.max(0, Math.min(width, x0));
        y0 = Math.max(0, Math.min(height, y0));
        x1 = Math.max(0, Math.min(width, x1));
        y1 = Math.max(0, Math.min(height, y1));
        if (x1 - x0 < 1e-6 || y1 - y0 < 1e-6) {
            st.roiImage = null;
            st.useFullImage = true;
            st.roiSel = null;
            syncRoiShapeFromImage();
        } else {
            // 存連續座標，顯示與拖曳框完全一致（不在此處量化）
            st.roiImage = { x0, y0, x1, y1 };
            st.useFullImage = false;
            // 維持目前視埠框，不回寫吸附，避免肉眼可見的變大
            st.roiSel = n;
            el.roiShape.style.display = 'block';
            el.roiShape.style.left = n.x0 + 'px';
            el.roiShape.style.top = n.y0 + 'px';
            el.roiShape.style.width = (n.x1 - n.x0) + 'px';
            el.roiShape.style.height = (n.y1 - n.y0) + 'px';
        }
        updateRoiButtons();
    }

    /* ---- 剖面線座標 ---- */
    function syncLineFromImage() {
        if (!el.lineSeg || !el.lineH0 || !el.lineH1) return;
        if (!st.lineImage || st.tool !== 'profile') {
            if (el.lineSeg) {
                el.lineSeg.setAttribute('x1', '0');
                el.lineSeg.setAttribute('y1', '0');
                el.lineSeg.setAttribute('x2', '0');
                el.lineSeg.setAttribute('y2', '0');
            }
            return;
        }
        const a = imageToViewport(st.lineImage.x0, st.lineImage.y0);
        const b = imageToViewport(st.lineImage.x1, st.lineImage.y1);
        el.lineSeg.setAttribute('x1', a.x);
        el.lineSeg.setAttribute('y1', a.y);
        el.lineSeg.setAttribute('x2', b.x);
        el.lineSeg.setAttribute('y2', b.y);
        el.lineH0.setAttribute('cx', a.x);
        el.lineH0.setAttribute('cy', a.y);
        el.lineH1.setAttribute('cx', b.x);
        el.lineH1.setAttribute('cy', b.y);
    }

    function commitLineFromViewport(p0, p1) {
        if (!st.dataset) return;
        const { width, height } = st.dataset;
        const i0 = viewportToImage(p0.x, p0.y);
        const i1 = viewportToImage(p1.x, p1.y);
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
        const line = {
            x0: clamp(i0.x, 0, width - 1),
            y0: clamp(i0.y, 0, height - 1),
            x1: clamp(i1.x, 0, width - 1),
            y1: clamp(i1.y, 0, height - 1),
        };
        if (Math.hypot(line.x1 - line.x0, line.y1 - line.y0) < 1) {
            st.lineImage = null;
        } else {
            st.lineImage = line;
        }
        syncLineFromImage();
        clearPfResult();
        updateButtons();
    }

    function setDefaultMidLine(orient) {
        if (!st.dataset) return;
        const { width, height } = st.dataset;
        if (orient === 'h') {
            const y = (height - 1) / 2;
            st.lineImage = { x0: 0, y0: y, x1: width - 1, y1: y };
        } else {
            const x = (width - 1) / 2;
            st.lineImage = { x0: x, y0: 0, x1: x, y1: height - 1 };
        }
        setLineMode(false);
        syncLineFromImage();
        clearPfResult();
        updateButtons();
    }

    /* ---- 資訊 / 狀態 ---- */
    function renderInfo(header, width, height) {
        if (!el.infoList) return;
        el.infoList.innerHTML = '';
        const add = (k, v) => {
            const row = document.createElement('div');
            row.className = 'info-row';
            row.innerHTML = `<span class="k"></span><span class="v"></span>`;
            row.querySelector('.k').textContent = k;
            row.querySelector('.v').textContent = String(v);
            el.infoList.appendChild(row);
        };
        add(t('infoSize'), `${width} × ${height}`);
        if (header) {
            for (const [k, v] of Object.entries(header)) {
                if (v === '' || v == null) continue;
                add(k, v);
            }
        }
    }

    function updateButtons() {
        const has = !!st.dataset;
        if (el.btnClear) el.btnClear.disabled = !has;
        if (el.btnRoi) el.btnRoi.disabled = !has;
        if (el.btnRoiClear) el.btnRoiClear.disabled = !has || st.useFullImage;
        if (el.btnRoiFull) el.btnRoiFull.disabled = !has;
        if (el.btnCompute) el.btnCompute.disabled = !has;
        if (el.btnExport) el.btnExport.disabled = !(st.result && st.result.ok);
        if (el.viewMode) {
            el.viewMode.disabled = !(st.result && st.result.ok);
        }
        if (el.lambdaS) el.lambdaS.disabled = !has;
        if (el.lambdaSPreset) el.lambdaSPreset.disabled = !has;
        if (el.lambdaC) el.lambdaC.disabled = !has;
        if (el.lambdaCPreset) el.lambdaCPreset.disabled = !has;
        // 剖面
        if (el.btnLine) el.btnLine.disabled = !has;
        if (el.btnLineH) el.btnLineH.disabled = !has;
        if (el.btnLineV) el.btnLineV.disabled = !has;
        if (el.btnLineClear) el.btnLineClear.disabled = !has || !st.lineImage;
        if (el.btnPfCompute) el.btnPfCompute.disabled = !has || !st.lineImage;
        if (el.btnPfExport) el.btnPfExport.disabled = !(st.pfResult && st.pfResult.ok);
        if (el.pfLambdaS) el.pfLambdaS.disabled = !has;
        if (el.pfLambdaSPreset) el.pfLambdaSPreset.disabled = !has;
        if (el.pfLambdaC) el.pfLambdaC.disabled = !has;
        if (el.pfLambdaCPreset) el.pfLambdaCPreset.disabled = !has;
        updateRoiButtons();
        updateLineButtons();
    }

    function updateRoiButtons() {
        if (el.btnRoi) {
            el.btnRoi.classList.toggle('tool-active', st.roiMode);
            el.btnRoi.setAttribute('aria-pressed', st.roiMode ? 'true' : 'false');
        }
        const hasRoi = !st.useFullImage && !!st.roiImage;
        const showRoi = st.tool === 'roughness' && (st.roiMode || hasRoi);
        if (el.viewer) {
            el.viewer.classList.toggle('crop-active', st.tool === 'roughness' && st.roiMode);
            el.viewer.classList.toggle('has-roi', st.tool === 'roughness' && hasRoi);
        }
        if (el.roiOverlay) {
            el.roiOverlay.setAttribute('aria-hidden', showRoi ? 'false' : 'true');
            el.roiOverlay.style.display = showRoi ? '' : 'none';
        }
        if (el.modeBadge && st.tool === 'roughness') {
            el.modeBadge.hidden = !st.roiMode;
            const label = el.modeBadge.querySelector('.mi-label');
            if (label) label.textContent = t('anRoiMode');
        }
        if (el.roiHint) {
            el.roiHint.style.display = st.roiMode && !st.roiImage ? 'block' : 'none';
        }
    }

    function updateLineButtons() {
        if (el.btnLine) {
            el.btnLine.classList.toggle('tool-active', st.lineMode);
            el.btnLine.setAttribute('aria-pressed', st.lineMode ? 'true' : 'false');
        }
        const hasLine = !!st.lineImage;
        if (el.viewer) {
            el.viewer.classList.toggle('line-active', st.lineMode);
            el.viewer.classList.toggle('has-line', hasLine);
        }
        if (el.lineOverlay) {
            const show = st.tool === 'profile' && (st.lineMode || hasLine);
            el.lineOverlay.setAttribute('aria-hidden', show ? 'false' : 'true');
            el.lineOverlay.style.display = show ? '' : 'none';
        }
        if (el.modeBadge && st.tool === 'profile') {
            el.modeBadge.hidden = !st.lineMode;
            const label = el.modeBadge.querySelector('.mi-label');
            if (label) label.textContent = t('anLineMode');
        }
        if (el.lineHint) {
            el.lineHint.style.display = st.lineMode && !st.lineImage ? 'block' : 'none';
        }
    }

    function clearResult() {
        st.result = null;
        st.displayMode = 'height';
        hideResidualCtxMenu();
        closeHistDialog();
        if (el.viewMode) el.viewMode.value = 'height';
        if (el.resultPanel) el.resultPanel.classList.remove('has-result');
        PARAM_KEYS.forEach((k) => {
            const node = document.getElementById('anParam' + k);
            if (node) node.textContent = '-';
        });
        if (el.resultMeta) el.resultMeta.textContent = '';
        if (el.residualCanvas) {
            const ctx = el.residualCanvas.getContext('2d');
            ctx.clearRect(0, 0, el.residualCanvas.width, el.residualCanvas.height);
        }
        if (el.histCanvas) {
            const ctx = el.histCanvas.getContext('2d');
            ctx.clearRect(0, 0, el.histCanvas.width, el.histCanvas.height);
        }
        updateButtons();
    }

    function clearPfResult() {
        st.pfResult = null;
        closePfPlotDialog();
        if (el.pfResultPanel) el.pfResultPanel.classList.remove('has-result');
        PF_PARAM_KEYS.forEach((k) => {
            const node = document.getElementById('anParam' + k);
            if (node) node.textContent = '-';
        });
        if (el.pfResultMeta) el.pfResultMeta.textContent = '';
        if (el.pfPlotCanvas) {
            const ctx = el.pfPlotCanvas.getContext('2d');
            ctx.clearRect(0, 0, el.pfPlotCanvas.width, el.pfPlotCanvas.height);
        }
        updateButtons();
    }

    function showResults(result) {
        if (!result || !result.ok) return;
        const p = result.params;
        const m = result.meta;
        PARAM_KEYS.forEach((k) => {
            const node = document.getElementById('anParam' + k);
            if (node) node.textContent = fmtParam(k, p[k]);
        });
        const unit = m.zunit ? ` ${m.zunit}` : '';
        const roiLabel = m.roi.full
            ? t('anRoiFull')
            : `${m.roi.x0},${m.roi.y0} – ${m.roi.x1},${m.roi.y1}`;
        const lambdaSLabel = m.lambdaSApplied
            ? String(m.lambdaS)
            : t('anLambdaSOff');
        const lambdaLabel = m.lambdaCApplied
            ? String(m.lambdaC)
            : t('anLambdaCOff');
        el.resultMeta.textContent = t('anResultMeta',
            t('anDetrend_' + m.detrend),
            lambdaSLabel,
            lambdaLabel,
            roiLabel,
            String(m.valid),
            unit.trim() ? ` ${unit.trim()}` : '');
        if (el.resultPanel) el.resultPanel.classList.add('has-result');
        drawResidualThumb(result);
        drawHist(result);
        if (isHistOpen()) redrawHistLarge();
        updateButtons();
    }

    function showPfResults(result) {
        if (!result || !result.ok) return;
        const p = result.params;
        const m = result.meta;
        PF_PARAM_KEYS.forEach((k) => {
            const node = document.getElementById('anParam' + k);
            if (node) node.textContent = fmtParam(k, p[k]);
        });
        const unit = m.zunit ? ` ${m.zunit}` : '';
        const ln = m.line || {};
        const lineLabel = `${formatVal(ln.x0, 1)},${formatVal(ln.y0, 1)} → ${formatVal(ln.x1, 1)},${formatVal(ln.y1, 1)}`;
        const lambdaSLabel = m.lambdaSApplied ? String(m.lambdaS) : t('anLambdaSOff');
        const lambdaLabel = m.lambdaCApplied ? String(m.lambdaC) : t('anLambdaCOff');
        if (el.pfResultMeta) {
            el.pfResultMeta.textContent = t('anPfResultMeta',
                t('anPfDetrend_' + m.detrend),
                lambdaSLabel,
                lambdaLabel,
                lineLabel,
                String(m.segmentCount),
                unit.trim() ? ` ${unit.trim()}` : '');
        }
        if (el.pfResultPanel) el.pfResultPanel.classList.add('has-result');
        drawPfPlot(result);
        if (isPfPlotOpen()) redrawPfPlotLarge();
        updateButtons();
    }

    function formatPlotTick(v) {
        return formatHistTick(v);
    }

    /** 依弧長 s 插值／取最近有效 z */
    function profileValueAtS(profile, sQuery) {
        const { s, z } = profile;
        if (!s || !z || !s.length) return null;
        if (!Number.isFinite(sQuery)) return null;
        let lo = 0, hi = s.length - 1;
        if (sQuery <= s[0]) {
            return Number.isFinite(z[0]) ? { s: s[0], z: z[0], i: 0 } : null;
        }
        if (sQuery >= s[hi]) {
            return Number.isFinite(z[hi]) ? { s: s[hi], z: z[hi], i: hi } : null;
        }
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (s[mid] <= sQuery) lo = mid;
            else hi = mid;
        }
        const s0 = s[lo], s1 = s[hi];
        const z0 = z[lo], z1 = z[hi];
        if (!Number.isFinite(z0) && !Number.isFinite(z1)) return null;
        if (!Number.isFinite(z0)) return { s: s1, z: z1, i: hi };
        if (!Number.isFinite(z1)) return { s: s0, z: z0, i: lo };
        const t = (s1 > s0) ? (sQuery - s0) / (s1 - s0) : 0;
        return { s: sQuery, z: z0 + (z1 - z0) * t, i: lo };
    }

    /**
     * 繪製粗糙度輪廓
     * @returns {{padL,padR,padT,padB,plotW,plotH,sMax,absMax,width,height}|null}
     */
    function renderProfilePlot(canvas, result, opts) {
        opts = opts || {};
        if (!canvas || !result || !result.profile) return null;
        const { s, z } = result.profile;
        const absMax = result.residualRange.absMax || 1;
        const sMax = (s && s.length) ? (s[s.length - 1] || 1) : 1;

        const cssW = opts.width || canvas.clientWidth || opts.fallbackW || 240;
        const cssH = opts.height || opts.fallbackH || 140;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.max(1, Math.round(cssW * dpr));
        canvas.height = Math.max(1, Math.round(cssH * dpr));
        canvas.style.width = cssW + 'px';
        canvas.style.height = cssH + 'px';

        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cssW, cssH);
        ctx.fillStyle = opts.bg || '#1a1a24';
        ctx.fillRect(0, 0, cssW, cssH);

        const padL = opts.padL != null ? opts.padL : 42;
        const padR = opts.padR != null ? opts.padR : 10;
        const padT = opts.padT != null ? opts.padT : 12;
        const padB = opts.padB != null ? opts.padB : 26;
        const plotW = Math.max(1, cssW - padL - padR);
        const plotH = Math.max(1, cssH - padT - padB);
        const layout = { padL, padR, padT, padB, plotW, plotH, sMax, absMax, width: cssW, height: cssH };

        const xOf = (sv) => padL + (sv / sMax) * plotW;
        const yOf = (zv) => padT + (0.5 - zv / (2 * absMax)) * plotH;

        // 水平格線（±max, 0）
        const yTicks = [
            { v: absMax, align: 'top' },
            { v: 0, align: 'mid' },
            { v: -absMax, align: 'bot' },
        ];
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        for (const tick of yTicks) {
            const y = yOf(tick.v);
            ctx.beginPath();
            ctx.moveTo(padL, y + 0.5);
            ctx.lineTo(padL + plotW, y + 0.5);
            ctx.stroke();
        }

        // 零線加粗
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.beginPath();
        ctx.moveTo(padL, yOf(0) + 0.5);
        ctx.lineTo(padL + plotW, yOf(0) + 0.5);
        ctx.stroke();

        // 曲線
        ctx.strokeStyle = '#4f8cff';
        ctx.lineWidth = opts.lineWidth || 1.5;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < z.length; i++) {
            if (!Number.isFinite(z[i]) || !Number.isFinite(s[i])) {
                started = false;
                continue;
            }
            const x = xOf(s[i]);
            const y = yOf(z[i]);
            if (!started) { ctx.moveTo(x, y); started = true; }
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Y 軸刻度文字
        ctx.fillStyle = 'rgba(220,220,230,0.9)';
        ctx.font = (opts.fontSize || 10) + 'px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'right';
        for (const tick of yTicks) {
            const y = yOf(tick.v);
            ctx.textBaseline = tick.align === 'top' ? 'top'
                : (tick.align === 'bot' ? 'bottom' : 'middle');
            ctx.fillText(formatPlotTick(tick.v), padL - 4, y);
        }

        // X 軸刻度
        const xTicks = [
            { v: 0, align: 'left' },
            { v: sMax / 2, align: 'center' },
            { v: sMax, align: 'right' },
        ];
        ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(220,220,230,0.85)';
        for (const tick of xTicks) {
            const x = xOf(tick.v);
            ctx.strokeStyle = 'rgba(255,255,255,0.28)';
            ctx.beginPath();
            ctx.moveTo(x + 0.5, padT + plotH);
            ctx.lineTo(x + 0.5, padT + plotH + 3);
            ctx.stroke();
            ctx.textAlign = tick.align;
            let tx = x;
            if (tick.align === 'left') tx = Math.max(padL, x);
            if (tick.align === 'right') tx = Math.min(padL + plotW, x);
            ctx.fillText(formatPlotTick(tick.v), tx, padT + plotH + 5);
        }

        // 游標
        const cursorS = opts.cursorS;
        if (Number.isFinite(cursorS)) {
            const sample = profileValueAtS(result.profile, cursorS);
            if (sample && Number.isFinite(sample.z)) {
                const cx = xOf(Math.max(0, Math.min(sMax, sample.s)));
                const cy = yOf(sample.z);
                ctx.strokeStyle = 'rgba(255,200,80,0.85)';
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 3]);
                ctx.beginPath();
                ctx.moveTo(cx + 0.5, padT);
                ctx.lineTo(cx + 0.5, padT + plotH);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = '#ffc850';
                ctx.beginPath();
                ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        return layout;
    }

    function drawPfPlot(result) {
        renderProfilePlot(el.pfPlotCanvas, result, {
            fallbackW: 240,
            fallbackH: 140,
            padL: 40,
            padR: 8,
            padT: 10,
            padB: 24,
            fontSize: 9,
            lineWidth: 1.4,
        });
    }

    function isPfPlotOpen() {
        return !!(el.pfPlotOverlay && el.pfPlotOverlay.classList.contains('show'));
    }

    function updatePfPlotReadout(sample, unit) {
        if (!el.pfPlotReadout) return;
        if (!sample || !Number.isFinite(sample.z)) {
            el.pfPlotReadout.textContent = t('anPfPlotReadoutIdle');
            return;
        }
        const u = unit ? ` ${unit}` : '';
        el.pfPlotReadout.textContent = t(
            'anPfPlotReadout',
            formatPlotTick(sample.s),
            Number(sample.z).toPrecision(6),
            u
        );
    }

    function redrawPfPlotLarge() {
        if (!st.pfResult || !st.pfResult.ok || !el.pfPlotLargeCanvas) return;
        const wrap = el.pfPlotLargeCanvas.parentElement;
        const cssW = Math.max(320, (wrap && wrap.clientWidth) || 720);
        const cssH = Math.max(240, Math.round(cssW * 0.48));
        st.pfPlotLayout = renderProfilePlot(el.pfPlotLargeCanvas, st.pfResult, {
            width: cssW,
            height: cssH,
            padL: 56,
            padR: 16,
            padT: 16,
            padB: 32,
            fontSize: 11,
            lineWidth: 1.8,
            bg: '#14141c',
            cursorS: st.pfPlotCursorS,
        });
        const unit = st.pfResult.meta?.zunit || '';
        if (Number.isFinite(st.pfPlotCursorS)) {
            updatePfPlotReadout(profileValueAtS(st.pfResult.profile, st.pfPlotCursorS), unit);
        } else {
            updatePfPlotReadout(null);
        }
    }

    function openPfPlotDialog() {
        if (!st.pfResult || !st.pfResult.ok) {
            showToast(t('anPfPlotNoData'), 'info');
            return;
        }
        hidePfPlotCtxMenu();
        st.pfPlotCursorS = null;
        if (el.pfPlotOverlay) el.pfPlotOverlay.classList.add('show');
        const tryDraw = (left) => {
            redrawPfPlotLarge();
            const w = el.pfPlotLargeCanvas?.parentElement?.clientWidth || 0;
            if (w < 40 && left > 0) requestAnimationFrame(() => tryDraw(left - 1));
        };
        requestAnimationFrame(() => tryDraw(8));
    }

    function closePfPlotDialog() {
        if (el.pfPlotOverlay) el.pfPlotOverlay.classList.remove('show');
        st.pfPlotCursorS = null;
        st.pfPlotLayout = null;
        hidePfPlotCtxMenu();
    }

    function hidePfPlotCtxMenu() {
        if (st.pfPlotCtxMenu) {
            st.pfPlotCtxMenu.remove();
            st.pfPlotCtxMenu = null;
        }
    }

    function showPfPlotCtxMenu(x, y) {
        hidePfPlotCtxMenu();
        const menu = document.createElement('div');
        menu.className = 'ctx-menu';
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ctx-menu-item';
        btn.textContent = t('anPfPlotOpenEnlarge');
        btn.addEventListener('click', () => {
            hidePfPlotCtxMenu();
            openPfPlotDialog();
        });
        menu.appendChild(btn);
        document.body.appendChild(menu);
        st.pfPlotCtxMenu = menu;
        // 避免超出視窗
        const r = menu.getBoundingClientRect();
        if (r.right > window.innerWidth) menu.style.left = Math.max(4, window.innerWidth - r.width - 4) + 'px';
        if (r.bottom > window.innerHeight) menu.style.top = Math.max(4, window.innerHeight - r.height - 4) + 'px';
    }

    function setupPfPlotInteraction() {
        const thumb = el.pfPlotCanvas;
        if (thumb && !thumb.dataset.pfBound) {
            thumb.dataset.pfBound = '1';
            thumb.addEventListener('click', (e) => {
                // 僅左鍵單擊放大；右鍵交由 contextmenu
                if (e.button != null && e.button !== 0) return;
                if (st.pfResult && st.pfResult.ok) openPfPlotDialog();
            });
            thumb.addEventListener('contextmenu', (e) => {
                if (!(st.pfResult && st.pfResult.ok)) return;
                e.preventDefault();
                e.stopPropagation();
                showPfPlotCtxMenu(e.clientX, e.clientY);
            });
        }

        if (el.pfPlotCloseBtn) {
            el.pfPlotCloseBtn.addEventListener('click', closePfPlotDialog);
        }
        if (el.pfPlotOverlay) {
            el.pfPlotOverlay.addEventListener('click', (e) => {
                if (e.target === el.pfPlotOverlay) closePfPlotDialog();
            });
        }

        const large = el.pfPlotLargeCanvas;
        if (large && !large.dataset.pfBound) {
            large.dataset.pfBound = '1';
            const onMove = (e) => {
                if (!isPfPlotOpen() || !st.pfResult || !st.pfPlotLayout) return;
                const rect = large.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const L = st.pfPlotLayout;
                const scaleX = L.width / Math.max(1, rect.width);
                const px = x * scaleX;
                if (px < L.padL || px > L.padL + L.plotW) {
                    st.pfPlotCursorS = null;
                    redrawPfPlotLarge();
                    return;
                }
                const t = (px - L.padL) / L.plotW;
                st.pfPlotCursorS = Math.max(0, Math.min(L.sMax, t * L.sMax));
                redrawPfPlotLarge();
            };
            large.addEventListener('pointermove', onMove);
            large.addEventListener('pointerleave', () => {
                if (!isPfPlotOpen()) return;
                st.pfPlotCursorS = null;
                redrawPfPlotLarge();
            });
            large.addEventListener('pointerdown', (e) => {
                if (e.pointerType === 'touch') onMove(e);
            });
        }

        document.addEventListener('pointerdown', (e) => {
            if (st.pfPlotCtxMenu && !st.pfPlotCtxMenu.contains(e.target)) hidePfPlotCtxMenu();
        });
        document.addEventListener('contextmenu', (e) => {
            if (!st.pfPlotCtxMenu) return;
            // 選單剛在 canvas 上開出時，同一次右鍵會冒泡到這裡；勿立刻關掉
            if (e.target === thumb || (thumb && thumb.contains(e.target))) return;
            if (!st.pfPlotCtxMenu.contains(e.target)) hidePfPlotCtxMenu();
        });
        window.addEventListener('scroll', hidePfPlotCtxMenu, true);
        window.addEventListener('resize', () => {
            hidePfPlotCtxMenu();
            if (isPfPlotOpen()) redrawPfPlotLarge();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && isPfPlotOpen()) closePfPlotDialog();
        });
    }

    function hideResidualCtxMenu() {
        if (st.residualCtxMenu) {
            st.residualCtxMenu.remove();
            st.residualCtxMenu = null;
        }
    }

    function showResidualCtxMenu(x, y) {
        hideResidualCtxMenu();
        if (!(st.result && st.result.ok)) return;
        const menu = document.createElement('div');
        menu.className = 'ctx-menu';
        menu.setAttribute('role', 'menu');
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ctx-menu-item';
        btn.setAttribute('role', 'menuitem');
        btn.textContent = t('anResidualSendToViewer');
        btn.addEventListener('click', () => {
            hideResidualCtxMenu();
            sendResidualToViewer();
        });
        menu.appendChild(btn);
        document.body.appendChild(menu);
        st.residualCtxMenu = menu;
        const r = menu.getBoundingClientRect();
        if (r.right > window.innerWidth) menu.style.left = Math.max(4, window.innerWidth - r.width - 4) + 'px';
        if (r.bottom > window.innerHeight) menu.style.top = Math.max(4, window.innerHeight - r.height - 4) + 'px';
    }

    function buildResidualDataset() {
        if (!(st.result && st.result.ok) || !st.dataset) return null;
        const { residual, residualSize, residualRange, meta } = st.result;
        const w = residualSize.width;
        const h = residualSize.height;
        const absMax = residualRange.absMax || 1;
        const baseName = meta.filename || st.dataset.filename || 'residual';
        const stem = String(baseName).replace(/\.[^.\\/]+$/, '');
        const filename = `${stem || 'residual'}_residual`;

        const header = { ...(st.dataset.header || {}) };
        if (Number.isFinite(meta.dx) && meta.dx > 0) {
            header.xlength = meta.dx * Math.max(1, w - 1);
        }
        if (Number.isFinite(meta.dy) && meta.dy > 0) {
            header.ylength = meta.dy * Math.max(1, h - 1);
        }
        if (meta.zunit) header.zunit = meta.zunit;

        return {
            data: residual.slice(0),
            width: w,
            height: h,
            vmin: -absMax,
            vmax: absMax,
            filename,
            header,
        };
    }

    function sendResidualToViewer() {
        const ds = buildResidualDataset();
        if (!ds) {
            showToast(t('sendNoData'), 'info');
            return;
        }
        if (typeof transferDatasetToViewer !== 'function') {
            showToast(t('anComputeFail'), 'error');
            return;
        }
        const absMax = Math.abs(ds.vmax) || 1;
        transferDatasetToViewer({
            ds,
            colormap: 'bwr',
            vmin: -absMax,
            vmax: absMax,
        });
    }

    function setupResidualThumbInteraction() {
        const thumb = el.residualCanvas;
        if (!thumb || thumb.dataset.residualBound) return;
        thumb.dataset.residualBound = '1';
        thumb.addEventListener('contextmenu', (e) => {
            if (!(st.result && st.result.ok)) return;
            e.preventDefault();
            e.stopPropagation();
            showResidualCtxMenu(e.clientX, e.clientY);
        });

        document.addEventListener('pointerdown', (e) => {
            if (st.residualCtxMenu && !st.residualCtxMenu.contains(e.target)) hideResidualCtxMenu();
        });
        document.addEventListener('contextmenu', (e) => {
            if (!st.residualCtxMenu) return;
            if (e.target === thumb || (thumb && thumb.contains(e.target))) return;
            if (!st.residualCtxMenu.contains(e.target)) hideResidualCtxMenu();
        });
        window.addEventListener('scroll', hideResidualCtxMenu, true);
        window.addEventListener('resize', hideResidualCtxMenu);
    }

    function drawResidualThumb(result) {
        const canvas = el.residualCanvas;
        if (!canvas) return;
        const { residual, residualSize, residualRange } = result;
        const srcW = residualSize.width, srcH = residualSize.height;
        const maxSide = 180;
        const scale = Math.min(maxSide / srcW, maxSide / srcH, 1);
        const dw = Math.max(1, Math.round(srcW * scale));
        const dh = Math.max(1, Math.round(srcH * scale));
        canvas.width = dw;
        canvas.height = dh;
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(dw, dh);
        const absMax = residualRange.absMax || 1;
        for (let y = 0; y < dh; y++) {
            for (let x = 0; x < dw; x++) {
                const sx = Math.min(srcW - 1, Math.floor(x / scale));
                const sy = Math.min(srcH - 1, Math.floor(y / scale));
                const v = residual[sy * srcW + sx];
                const po = (y * dw + x) * 4;
                if (!Number.isFinite(v)) {
                    img.data[po] = img.data[po + 1] = img.data[po + 2] = 0;
                    img.data[po + 3] = 255;
                    continue;
                }
                let t = (v / absMax) * 0.5 + 0.5;
                if (t < 0) t = 0; else if (t > 1) t = 1;
                const lo = ((t * 255) | 0) * 3;
                img.data[po] = DIV_LUT[lo];
                img.data[po + 1] = DIV_LUT[lo + 1];
                img.data[po + 2] = DIV_LUT[lo + 2];
                img.data[po + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
    }

    function formatHistTick(v) {
        if (!Number.isFinite(v)) return '-';
        if (v === 0) return '0';
        const a = Math.abs(v);
        if (a >= 1e4 || (a > 0 && a < 1e-3)) return v.toExponential(1);
        if (a >= 100) return v.toFixed(0);
        if (a >= 10) return v.toFixed(1);
        if (a >= 1) return v.toFixed(2);
        return v.toFixed(3);
    }

    function renderHist(canvas, result, opts = {}) {
        if (!canvas || !result) return null;
        const W = opts.width || 240;
        const axisH = opts.axisH != null ? opts.axisH : 18;
        const H = opts.height || 98;
        const bins = opts.bins || 48;
        const fontSize = opts.fontSize || 10;
        const bg = opts.bg || '#1a1a24';
        const cursorBin = Number.isInteger(opts.cursorBin) ? opts.cursorBin : null;
        canvas.width = W;
        canvas.height = H;
        const plotH = H - axisH;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, W, H);
        const { residual, residualRange } = result;
        const counts = new Float64Array(bins);
        const absMax = residualRange.absMax || 1;
        const lo = -absMax, hi = absMax;
        const span = hi - lo || 1;
        let maxC = 0;
        let total = 0;
        for (let i = 0; i < residual.length; i++) {
            const v = residual[i];
            if (!Number.isFinite(v)) continue;
            let b = Math.floor(((v - lo) / span) * bins);
            if (b < 0) b = 0;
            if (b >= bins) b = bins - 1;
            counts[b]++;
            total++;
            if (counts[b] > maxC) maxC = counts[b];
        }
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);
        const barW = W / bins;
        const barMaxH = plotH - 4;
        for (let i = 0; i < bins; i++) {
            const h = maxC > 0 ? (counts[i] / maxC) * barMaxH : 0;
            const tNorm = (i + 0.5) / bins;
            const lo3 = ((tNorm * 255) | 0) * 3;
            ctx.fillStyle = `rgb(${DIV_LUT[lo3]},${DIV_LUT[lo3 + 1]},${DIV_LUT[lo3 + 2]})`;
            ctx.fillRect(i * barW, plotH - h, Math.max(1, barW - 0.5), h);
        }

        // 游標 bin 高亮
        if (cursorBin != null && cursorBin >= 0 && cursorBin < bins) {
            const h = maxC > 0 ? (counts[cursorBin] / maxC) * barMaxH : 0;
            const x = cursorBin * barW;
            ctx.fillStyle = 'rgba(255,255,255,0.18)';
            ctx.fillRect(x, 0, Math.max(1, barW), plotH);
            ctx.strokeStyle = 'rgba(255,255,255,0.85)';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(x + 0.5, Math.max(0, plotH - h) + 0.5, Math.max(1, barW - 1), Math.max(0, h - 1));
        }

        // 零線（貫穿繪圖區）
        const zx = ((0 - lo) / span) * W;
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(zx + 0.5, 0);
        ctx.lineTo(zx + 0.5, plotH);
        ctx.stroke();

        // 橫軸：刻度線與標籤（−max / 0 / +max）
        const ticks = [
            { v: lo, align: 'left' },
            { v: 0, align: 'center' },
            { v: hi, align: 'right' },
        ];
        ctx.strokeStyle = 'rgba(255,255,255,0.28)';
        ctx.fillStyle = 'rgba(220,220,230,0.85)';
        ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textBaseline = 'top';
        for (const tick of ticks) {
            const x = ((tick.v - lo) / span) * W;
            ctx.beginPath();
            ctx.moveTo(x + 0.5, plotH);
            ctx.lineTo(x + 0.5, plotH + 3);
            ctx.stroke();
            const label = formatHistTick(tick.v);
            if (tick.align === 'left') {
                ctx.textAlign = 'left';
                ctx.fillText(label, Math.max(2, x + 2), plotH + 5);
            } else if (tick.align === 'right') {
                ctx.textAlign = 'right';
                ctx.fillText(label, Math.min(W - 2, x - 2), plotH + 5);
            } else {
                ctx.textAlign = 'center';
                ctx.fillStyle = 'rgba(255,255,255,0.95)';
                ctx.fillText(label, x, plotH + 5);
                ctx.fillStyle = 'rgba(220,220,230,0.85)';
            }
        }

        return {
            width: W,
            height: H,
            plotH,
            bins,
            barW,
            lo,
            hi,
            span,
            counts,
            total,
            maxC,
        };
    }

    function drawHist(result) {
        renderHist(el.histCanvas, result, {
            width: 240,
            height: 98,
            axisH: 18,
            bins: 48,
            fontSize: 10,
        });
    }

    function isHistOpen() {
        return !!(el.histOverlay && el.histOverlay.classList.contains('show'));
    }

    function updateHistReadout(binInfo, unit) {
        if (!el.histReadout) return;
        if (!binInfo) {
            el.histReadout.textContent = t('anHistReadoutIdle');
            return;
        }
        const u = unit ? ` ${unit}` : '';
        const pct = binInfo.total > 0
            ? ((binInfo.count / binInfo.total) * 100).toFixed(2)
            : '0.00';
        el.histReadout.textContent = t(
            'anHistReadout',
            formatHistTick(binInfo.v0),
            formatHistTick(binInfo.v1),
            u,
            String(binInfo.count),
            pct
        );
    }

    function histBinAtPointer(clientX) {
        const large = el.histLargeCanvas;
        const L = st.histLayout;
        if (!large || !L) return null;
        const rect = large.getBoundingClientRect();
        const scaleX = L.width / Math.max(1, rect.width);
        const px = (clientX - rect.left) * scaleX;
        if (px < 0 || px >= L.width) return null;
        let b = Math.floor(px / L.barW);
        if (b < 0) b = 0;
        if (b >= L.bins) b = L.bins - 1;
        const v0 = L.lo + (b / L.bins) * L.span;
        const v1 = L.lo + ((b + 1) / L.bins) * L.span;
        return {
            bin: b,
            v0,
            v1,
            count: L.counts[b] | 0,
            total: L.total,
        };
    }

    function redrawHistLarge() {
        if (!st.result || !st.result.ok || !el.histLargeCanvas) return;
        const wrap = el.histLargeCanvas.parentElement;
        const cssW = Math.max(320, (wrap && wrap.clientWidth) || 720);
        const cssH = Math.max(220, Math.round(cssW * 0.42));
        st.histLayout = renderHist(el.histLargeCanvas, st.result, {
            width: cssW,
            height: cssH,
            axisH: 28,
            bins: 96,
            fontSize: 12,
            bg: '#14141c',
            cursorBin: st.histCursorBin,
        });
        const unit = st.result.meta?.zunit || '';
        if (Number.isInteger(st.histCursorBin) && st.histLayout) {
            const L = st.histLayout;
            const b = st.histCursorBin;
            updateHistReadout({
                bin: b,
                v0: L.lo + (b / L.bins) * L.span,
                v1: L.lo + ((b + 1) / L.bins) * L.span,
                count: L.counts[b] | 0,
                total: L.total,
            }, unit);
        } else {
            updateHistReadout(null);
        }
    }

    function openHistDialog() {
        if (!st.result || !st.result.ok) {
            showToast(t('anHistNoData'), 'info');
            return;
        }
        hideHistCtxMenu();
        st.histCursorBin = null;
        if (el.histOverlay) el.histOverlay.classList.add('show');
        const tryDraw = (left) => {
            redrawHistLarge();
            const w = el.histLargeCanvas?.parentElement?.clientWidth || 0;
            if (w < 40 && left > 0) requestAnimationFrame(() => tryDraw(left - 1));
        };
        requestAnimationFrame(() => tryDraw(8));
    }

    function closeHistDialog() {
        if (el.histOverlay) el.histOverlay.classList.remove('show');
        st.histCursorBin = null;
        st.histLayout = null;
        hideHistCtxMenu();
    }

    function hideHistCtxMenu() {
        if (st.histCtxMenu) {
            st.histCtxMenu.remove();
            st.histCtxMenu = null;
        }
    }

    function showHistCtxMenu(x, y) {
        hideHistCtxMenu();
        const menu = document.createElement('div');
        menu.className = 'ctx-menu';
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ctx-menu-item';
        btn.textContent = t('anHistOpenEnlarge');
        btn.addEventListener('click', () => {
            hideHistCtxMenu();
            openHistDialog();
        });
        menu.appendChild(btn);
        document.body.appendChild(menu);
        st.histCtxMenu = menu;
        const r = menu.getBoundingClientRect();
        if (r.right > window.innerWidth) menu.style.left = Math.max(4, window.innerWidth - r.width - 4) + 'px';
        if (r.bottom > window.innerHeight) menu.style.top = Math.max(4, window.innerHeight - r.height - 4) + 'px';
    }

    function setupHistInteraction() {
        const thumb = el.histCanvas;
        if (thumb && !thumb.dataset.histBound) {
            thumb.dataset.histBound = '1';
            thumb.addEventListener('click', (e) => {
                if (e.button != null && e.button !== 0) return;
                if (st.result && st.result.ok) openHistDialog();
            });
            thumb.addEventListener('contextmenu', (e) => {
                if (!(st.result && st.result.ok)) return;
                e.preventDefault();
                e.stopPropagation();
                showHistCtxMenu(e.clientX, e.clientY);
            });
        }

        if (el.histCloseBtn) {
            el.histCloseBtn.addEventListener('click', closeHistDialog);
        }
        if (el.histOverlay) {
            el.histOverlay.addEventListener('click', (e) => {
                if (e.target === el.histOverlay) closeHistDialog();
            });
        }

        const large = el.histLargeCanvas;
        if (large && !large.dataset.histBound) {
            large.dataset.histBound = '1';
            const onMove = (e) => {
                if (!isHistOpen() || !st.result || !st.histLayout) return;
                const info = histBinAtPointer(e.clientX);
                const nextBin = info ? info.bin : null;
                if (nextBin === st.histCursorBin) {
                    // bin 未變仍更新讀數（初次進入）
                    if (info) updateHistReadout(info, st.result.meta?.zunit || '');
                    else updateHistReadout(null);
                    return;
                }
                st.histCursorBin = nextBin;
                redrawHistLarge();
            };
            large.addEventListener('pointermove', onMove);
            large.addEventListener('pointerleave', () => {
                if (!isHistOpen()) return;
                st.histCursorBin = null;
                redrawHistLarge();
            });
            large.addEventListener('pointerdown', (e) => {
                if (e.pointerType === 'touch') onMove(e);
            });
        }

        document.addEventListener('pointerdown', (e) => {
            if (st.histCtxMenu && !st.histCtxMenu.contains(e.target)) hideHistCtxMenu();
        });
        document.addEventListener('contextmenu', (e) => {
            if (!st.histCtxMenu) return;
            if (e.target === thumb || (thumb && thumb.contains(e.target))) return;
            if (!st.histCtxMenu.contains(e.target)) hideHistCtxMenu();
        });
        window.addEventListener('scroll', hideHistCtxMenu, true);
        window.addEventListener('resize', () => {
            hideHistCtxMenu();
            if (isHistOpen()) redrawHistLarge();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && isHistOpen()) closeHistDialog();
        });
    }

    /* ---- 載入 ---- */
    async function loadFile(file) {
        if (!file) return;
        const ext = getExt(file.name);
        if (!SUPPORTED_EXTS.includes(ext)) {
            const msg = t('statusUnsupported', file.name, SUPPORTED_TEXT);
            el.status.textContent = msg;
            showToast(msg, 'error');
            return;
        }
        el.status.textContent = t('statusReading', file.name);
        setProgress(0);
        try {
            let result;
            switch (ext) {
                case 'bcrf': result = await readBcrf(file, setProgress); break;
                case 'asc':  result = await readAsc(file, setProgress); break;
                case 'tif':
                case 'tiff': result = await readTiff(file, setProgress); break;
                case 'pcd':  result = await readPcd(file, setProgress); break;
                case 'txt':  result = await readTxt(file, setProgress); break;
                case 'bmp':  result = await readBmp(file, setProgress); break;
                case 'png':  result = await readPng(file, setProgress); break;
                case 'jpg':
                case 'jpeg': result = await readJpg(file, setProgress); break;
                default: throw new Error(t('errUnknownExt', ext));
            }
            await acceptDataset({ ...result, filename: file.name });
        } catch (err) {
            console.error(err);
            el.status.textContent = t('statusReadFailed', err.message);
            showToast(t('statusReadFailed', err.message), 'error');
        } finally {
            hideProgress();
        }
    }

    async function acceptDataset(ds) {
        if (!ds) return false;
        if (ds.type === 'pcd-scatter') {
            showToast(t('anScatterUnsupported'), 'info');
            el.status.textContent = t('anScatterUnsupported');
            return false;
        }
        if (!ds.data || !ds.width || !ds.height) {
            showToast(t('anNoHeightMap'), 'error');
            return false;
        }
        const rangeSrc = ds.data;
        const { vmin, vmax } = rangeSrc.length >= LARGE_PIXEL_THRESHOLD
            ? await computeRangeAsync(rangeSrc)
            : computeRange(rangeSrc);
        st.dataset = { ...ds, vmin, vmax };
        st.roiImage = null;
        st.roiSel = null;
        st.useFullImage = true;
        st.roiMode = false;
        st.lineImage = null;
        st.lineMode = false;
        clearResult();
        clearPfResult();
        render(true);
        syncLineFromImage();
        renderInfo(ds.header, ds.width, ds.height);
        rebuildLambdaPresets({ keepValue: false });
        el.status.textContent = t('statusLoaded', ds.filename || '', ds.width, ds.height);
        updateButtons();
        return true;
    }

    function loadDataset(ds) {
        const clone = typeof cloneDatasetForTransfer === 'function'
            ? cloneDatasetForTransfer(ds)
            : { ...ds, data: ds.data ? ds.data.slice(0) : ds.data, header: ds.header ? { ...ds.header } : ds.header };
        return acceptDataset(clone);
    }

    function clearData() {
        st.dataset = null;
        st.roiImage = null;
        st.roiSel = null;
        st.useFullImage = true;
        st.roiMode = false;
        st.lineImage = null;
        st.lineMode = false;
        clearResult();
        clearPfResult();
        if (el.canvas) {
            el.canvas.style.display = 'none';
            el.canvas.style.transform = '';
        }
        if (el.placeholder) el.placeholder.style.display = '';
        if (el.zoomIndicator) el.zoomIndicator.classList.remove('show');
        if (el.zoomHint) el.zoomHint.classList.remove('show');
        if (el.infoList) el.infoList.innerHTML = '';
        if (el.status) el.status.textContent = t('statusIdle');
        if (el.zMin) el.zMin.textContent = '-';
        if (el.zMax) el.zMax.textContent = '-';
        syncRoiShapeFromImage();
        syncLineFromImage();
        rebuildLambdaPresets({ keepValue: false });
        updateButtons();
        if (el.fileInput) el.fileInput.value = '';
    }

    /* ---- 計算 ---- */
    function compute() {
        if (!st.dataset) {
            showToast(t('anNoData'), 'info');
            return;
        }
        const detrend = el.detrend?.value || 'plane';
        let lambdaS = parseFloat(el.lambdaS?.value);
        if (!Number.isFinite(lambdaS) || lambdaS < 0) lambdaS = 0;
        let lambdaC = parseFloat(el.lambdaC?.value);
        if (!Number.isFinite(lambdaC) || lambdaC < 0) lambdaC = 0;
        const roi = st.useFullImage ? null : Roughness.normalizeRoi(
            st.dataset, st.roiImage, { exclusiveMax: true }
        );
        const result = Roughness.computeAreal(st.dataset, {
            roi: st.useFullImage ? null : roi,
            detrend,
            lambdaS,
            lambdaC,
        });
        if (!result.ok) {
            const key = ({
                unsupported: 'anScatterUnsupported',
                emptyRoi: 'anEmptyRoi',
                fitFailed: 'anFitFailed',
                noValid: 'anNoValid',
            })[result.reason] || 'anComputeFail';
            showToast(t(key), 'error');
            return;
        }
        if (result.meta.validRatio < 0.5) {
            showToast(t('anLowValidWarn', (result.meta.validRatio * 100).toFixed(0)), 'info');
        }
        if (lambdaS > 0 && lambdaC > 0 && lambdaS >= lambdaC) {
            showToast(t('anLambdaBandwidthWarn', String(lambdaS), String(lambdaC)), 'info');
        }
        const sp = Roughness.pixelSpacing(st.dataset);
        if (lambdaS > 0) {
            const sigmaSPx = Roughness.sigmaFromLambdaC(lambdaS) / Math.max(sp.dx, 1e-30);
            if (sigmaSPx < 0.5) {
                const suggest = Math.max(sp.dx * 3, lambdaS * 1e6);
                showToast(t('anLambdaSTooSmall',
                    String(lambdaS),
                    formatSpacing(sp.dx),
                    formatSpacing(suggest)
                ), 'info');
            }
        }
        if (lambdaC > 0) {
            const sigmaPx = Roughness.sigmaFromLambdaC(lambdaC) / Math.max(sp.dx, 1e-30);
            if (sigmaPx < 0.5) {
                const suggest = Math.max(sp.dx * 5, lambdaC * 1e6);
                showToast(t('anLambdaCTooSmall',
                    String(lambdaC),
                    formatSpacing(sp.dx),
                    formatSpacing(suggest)
                ), 'info');
            }
        }
        st.result = result;
        showResults(result);
        if (st.displayMode === 'residual') render(false);
        showToast(t('anComputeDone'), 'info');
        el.status.textContent = t('anStatusDone',
            result.params.Sa.toFixed(4),
            result.params.Sq.toFixed(4),
            result.params.Sz.toFixed(4));
    }

    function computeProfileRoughness() {
        if (!st.dataset) {
            showToast(t('anNoData'), 'info');
            return;
        }
        if (!st.lineImage) {
            showToast(t('anNoLine'), 'info');
            return;
        }
        const detrend = el.pfDetrend?.value || 'line';
        let lambdaS = parseFloat(el.pfLambdaS?.value);
        if (!Number.isFinite(lambdaS) || lambdaS < 0) lambdaS = 0;
        let lambdaC = parseFloat(el.pfLambdaC?.value);
        if (!Number.isFinite(lambdaC) || lambdaC < 0) lambdaC = 0;
        const result = Roughness.computeProfile(st.dataset, {
            line: st.lineImage,
            detrend,
            lambdaS,
            lambdaC,
        });
        if (!result.ok) {
            const key = ({
                unsupported: 'anScatterUnsupported',
                noLine: 'anNoLine',
                emptyLine: 'anEmptyLine',
                fitFailed: 'anFitFailed',
                noValid: 'anNoValid',
            })[result.reason] || 'anComputeFail';
            showToast(t(key), 'error');
            return;
        }
        if (result.meta.validRatio < 0.5) {
            showToast(t('anLowValidWarn', (result.meta.validRatio * 100).toFixed(0)), 'info');
        }
        if (lambdaS > 0 && lambdaC > 0 && lambdaS >= lambdaC) {
            showToast(t('anLambdaBandwidthWarn', String(lambdaS), String(lambdaC)), 'info');
        }
        st.pfResult = result;
        showPfResults(result);
        showToast(t('anPfComputeDone'), 'info');
        el.status.textContent = t('anPfStatusDone',
            result.params.Ra.toFixed(4),
            result.params.Rq.toFixed(4),
            result.params.Rz.toFixed(4));
    }

    function exportCsv() {
        if (!st.result || !st.result.ok) return;
        const csv = Roughness.toCsv(st.result);
        const base = stripExt(st.dataset?.filename || 'roughness');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${base}_roughness.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        showToast(t('anExported'), 'info');
    }

    function exportPfCsv() {
        if (!st.pfResult || !st.pfResult.ok) return;
        const csv = Roughness.toCsvProfile(st.pfResult);
        const base = stripExt(st.dataset?.filename || 'profile');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${base}_profile_Ra.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        showToast(t('anExported'), 'info');
    }

    /* ---- ROI 互動 ---- */
    const ROI_MIN = 4;
    const HRES = {
        nw: { x: 'x0', y: 'y0' }, n: { y: 'y0' }, ne: { x: 'x1', y: 'y0' },
        e: { x: 'x1' }, se: { x: 'x1', y: 'y1' }, s: { y: 'y1' },
        sw: { x: 'x0', y: 'y1' }, w: { x: 'x0' },
    };

    function setRoiMode(on) {
        st.roiMode = !!on;
        if (st.roiMode && st.lineMode) {
            st.lineMode = false;
            updateLineButtons();
        }
        updateRoiButtons();
    }

    function setLineMode(on) {
        st.lineMode = !!on;
        if (st.lineMode && st.roiMode) {
            st.roiMode = false;
            updateRoiButtons();
        }
        updateLineButtons();
    }

    function setTool(tool) {
        if (tool !== 'roughness' && tool !== 'profile') return;
        st.tool = tool;
        document.querySelectorAll('.an-nav-item[data-an-tool]').forEach((b) => {
            b.classList.toggle('active', b.getAttribute('data-an-tool') === tool);
        });
        if (el.panelRoughness) el.panelRoughness.hidden = tool !== 'roughness';
        if (el.panelProfile) el.panelProfile.hidden = tool !== 'profile';

        // 離開時關閉對應互動模式
        if (tool !== 'roughness') {
            setRoiMode(false);
            closeHistDialog();
        }
        if (tool !== 'profile') {
            setLineMode(false);
            closePfPlotDialog();
        }

        // 殘差顯示僅在表面粗糙度有意義
        if (tool !== 'roughness' && st.displayMode === 'residual') {
            st.displayMode = 'height';
            if (el.viewMode) el.viewMode.value = 'height';
            if (st.dataset) render(false);
        }

        syncLineFromImage();
        updateButtons();
        if (st.dataset) applyTransform();
    }

    function setupRoiOverlay() {
        const overlay = el.roiOverlay;
        const shape = el.roiShape;
        if (!overlay || !shape || overlay.dataset.bound) return;
        overlay.dataset.bound = '1';

        const draw = () => {
            if (!st.roiSel) { shape.style.display = 'none'; return; }
            const n = {
                x0: Math.min(st.roiSel.x0, st.roiSel.x1),
                y0: Math.min(st.roiSel.y0, st.roiSel.y1),
                x1: Math.max(st.roiSel.x0, st.roiSel.x1),
                y1: Math.max(st.roiSel.y0, st.roiSel.y1),
            };
            shape.style.display = 'block';
            shape.style.left = n.x0 + 'px';
            shape.style.top = n.y0 + 'px';
            shape.style.width = (n.x1 - n.x0) + 'px';
            shape.style.height = (n.y1 - n.y0) + 'px';
        };

        const pt = (e) => {
            const r = el.viewer.getBoundingClientRect();
            return {
                x: Math.min(r.width, Math.max(0, e.clientX - r.left)),
                y: Math.min(r.height, Math.max(0, e.clientY - r.top)),
            };
        };

        overlay.addEventListener('pointerdown', (e) => {
            if (!st.roiMode || !st.dataset) return;
            if (e.button === 1) return;
            e.preventDefault();
            e.stopPropagation();
            overlay.setPointerCapture(e.pointerId);
            const p = pt(e);
            const handle = e.target?.classList?.contains('crop-handle')
                ? e.target.getAttribute('data-h') : null;
            if (handle && st.roiSel) {
                st.roiSel = {
                    x0: Math.min(st.roiSel.x0, st.roiSel.x1),
                    y0: Math.min(st.roiSel.y0, st.roiSel.y1),
                    x1: Math.max(st.roiSel.x0, st.roiSel.x1),
                    y1: Math.max(st.roiSel.y0, st.roiSel.y1),
                };
                st.roiAction = { type: 'resize', handle };
            } else if (st.roiSel && e.target === shape) {
                st.roiSel = {
                    x0: Math.min(st.roiSel.x0, st.roiSel.x1),
                    y0: Math.min(st.roiSel.y0, st.roiSel.y1),
                    x1: Math.max(st.roiSel.x0, st.roiSel.x1),
                    y1: Math.max(st.roiSel.y0, st.roiSel.y1),
                };
                st.roiAction = { type: 'move', start: p, orig: { ...st.roiSel } };
            } else {
                st.roiAction = { type: 'draw' };
                st.roiSel = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
            }
            draw();
        });

        overlay.addEventListener('pointermove', (e) => {
            if (!st.roiAction || !st.roiSel) return;
            const p = pt(e);
            const s = st.roiSel;
            const vw = el.viewer.clientWidth, vh = el.viewer.clientHeight;
            if (st.roiAction.type === 'draw') {
                s.x1 = p.x; s.y1 = p.y;
            } else if (st.roiAction.type === 'resize') {
                const dir = HRES[st.roiAction.handle];
                if (dir.x === 'x0') s.x0 = Math.min(p.x, s.x1 - ROI_MIN);
                if (dir.x === 'x1') s.x1 = Math.max(p.x, s.x0 + ROI_MIN);
                if (dir.y === 'y0') s.y0 = Math.min(p.y, s.y1 - ROI_MIN);
                if (dir.y === 'y1') s.y1 = Math.max(p.y, s.y0 + ROI_MIN);
            } else if (st.roiAction.type === 'move') {
                const o = st.roiAction.orig;
                const w = o.x1 - o.x0, h = o.y1 - o.y0;
                let nx0 = o.x0 + (p.x - st.roiAction.start.x);
                let ny0 = o.y0 + (p.y - st.roiAction.start.y);
                if (nx0 < 0) nx0 = 0;
                if (nx0 + w > vw) nx0 = vw - w;
                if (ny0 < 0) ny0 = 0;
                if (ny0 + h > vh) ny0 = vh - h;
                s.x0 = nx0; s.y0 = ny0; s.x1 = nx0 + w; s.y1 = ny0 + h;
            }
            draw();
        });

        const end = (e) => {
            if (!st.roiAction) return;
            const act = st.roiAction;
            st.roiAction = null;
            try { overlay.releasePointerCapture(e.pointerId); } catch (_) {}
            if (st.roiSel) {
                const s = {
                    x0: Math.min(st.roiSel.x0, st.roiSel.x1),
                    y0: Math.min(st.roiSel.y0, st.roiSel.y1),
                    x1: Math.max(st.roiSel.x0, st.roiSel.x1),
                    y1: Math.max(st.roiSel.y0, st.roiSel.y1),
                };
                if (act.type === 'draw' && (s.x1 - s.x0 < ROI_MIN || s.y1 - s.y0 < ROI_MIN)) {
                    st.roiSel = null;
                    st.roiImage = null;
                    st.useFullImage = true;
                    syncRoiShapeFromImage();
                } else {
                    st.roiSel = s;
                    commitRoiFromViewport();
                    clearResult();
                    // 重繪時不要把 ROI 從影像座標回寫，否則會因量化而微幅變大
                    if (st.dataset) render(false, { syncRoi: false });
                }
            }
            updateRoiButtons();
        };
        overlay.addEventListener('pointerup', end);
        overlay.addEventListener('pointercancel', end);
    }

    function setupLineOverlay() {
        const overlay = el.lineOverlay;
        if (!overlay || overlay.dataset.bound) return;
        overlay.dataset.bound = '1';

        const pt = (e) => {
            const r = el.viewer.getBoundingClientRect();
            return {
                x: Math.min(r.width, Math.max(0, e.clientX - r.left)),
                y: Math.min(r.height, Math.max(0, e.clientY - r.top)),
            };
        };

        const hitHandle = (e) => {
            const t = e.target;
            if (t === el.lineH0) return 0;
            if (t === el.lineH1) return 1;
            return null;
        };

        const drawTemp = (p0, p1) => {
            if (!el.lineSeg) return;
            el.lineSeg.setAttribute('x1', p0.x);
            el.lineSeg.setAttribute('y1', p0.y);
            el.lineSeg.setAttribute('x2', p1.x);
            el.lineSeg.setAttribute('y2', p1.y);
            if (el.lineH0) {
                el.lineH0.setAttribute('cx', p0.x);
                el.lineH0.setAttribute('cy', p0.y);
            }
            if (el.lineH1) {
                el.lineH1.setAttribute('cx', p1.x);
                el.lineH1.setAttribute('cy', p1.y);
            }
        };

        overlay.addEventListener('pointerdown', (e) => {
            if (st.tool !== 'profile' || !st.dataset) return;
            if (!st.lineMode && !st.lineImage) return;
            if (e.button === 1) return;
            const p = pt(e);
            const h = hitHandle(e);
            if (h != null && st.lineImage) {
                e.preventDefault();
                e.stopPropagation();
                overlay.setPointerCapture(e.pointerId);
                const a = imageToViewport(st.lineImage.x0, st.lineImage.y0);
                const b = imageToViewport(st.lineImage.x1, st.lineImage.y1);
                st.lineAction = {
                    type: 'resize',
                    handle: h,
                    other: h === 0 ? b : a,
                };
            } else if (st.lineMode) {
                e.preventDefault();
                e.stopPropagation();
                overlay.setPointerCapture(e.pointerId);
                st.lineAction = { type: 'draw', start: p };
                drawTemp(p, p);
            }
        });

        overlay.addEventListener('pointermove', (e) => {
            if (!st.lineAction) return;
            const p = pt(e);
            if (st.lineAction.type === 'draw') {
                drawTemp(st.lineAction.start, p);
            } else if (st.lineAction.type === 'resize') {
                const other = st.lineAction.other;
                if (st.lineAction.handle === 0) drawTemp(p, other);
                else drawTemp(other, p);
            }
        });

        const end = (e) => {
            if (!st.lineAction) return;
            const act = st.lineAction;
            st.lineAction = null;
            try { overlay.releasePointerCapture(e.pointerId); } catch (_) {}
            const p = pt(e);
            if (act.type === 'draw') {
                const dx = p.x - act.start.x;
                const dy = p.y - act.start.y;
                if (Math.hypot(dx, dy) < 4) {
                    syncLineFromImage();
                } else {
                    commitLineFromViewport(act.start, p);
                }
            } else if (act.type === 'resize') {
                if (act.handle === 0) commitLineFromViewport(p, act.other);
                else commitLineFromViewport(act.other, p);
            }
            updateLineButtons();
        };
        overlay.addEventListener('pointerup', end);
        overlay.addEventListener('pointercancel', end);
    }

    /* ---- 視埠互動 ---- */
    function setupViewerInteraction() {
        if (!el.viewer || !el.canvas) return;

        el.viewer.addEventListener('wheel', (e) => {
            if (!st.dataset) return;
            e.preventDefault();
            const rect = el.viewer.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
            const imgX = (mx - st.view.tx) / st.view.scale;
            const imgY = (my - st.view.ty) / st.view.scale;
            let ns = st.view.scale * factor;
            ns = Math.min(100, Math.max(0.02, ns));
            st.view.scale = ns;
            st.view.tx = mx - imgX * ns;
            st.view.ty = my - imgY * ns;
            applyTransform();
        }, { passive: false });

        el.canvas.addEventListener('mousedown', (e) => {
            if (!st.dataset || st.roiMode || st.lineMode) return;
            if (e.button !== 0 && e.button !== 1) return;
            st.panning = true;
            st.panStart = { x: e.clientX, y: e.clientY, tx: st.view.tx, ty: st.view.ty };
            el.canvas.classList.add('grabbing');
            e.preventDefault();
        });
        window.addEventListener('mousemove', (e) => {
            if (!st.panning || !st.panStart) return;
            st.view.tx = st.panStart.tx + (e.clientX - st.panStart.x);
            st.view.ty = st.panStart.ty + (e.clientY - st.panStart.y);
            applyTransform();
        });
        window.addEventListener('mouseup', () => {
            if (!st.panning) return;
            st.panning = false;
            st.panStart = null;
            el.canvas.classList.remove('grabbing');
        });
        el.viewer.addEventListener('dblclick', () => {
            if (st.dataset) fitImage();
        });

        // 拖放
        const dragHasFiles = (e) => {
            if (!e.dataTransfer) return false;
            const types = e.dataTransfer.types;
            if (!types) return false;
            for (let i = 0; i < types.length; i++) {
                if (types[i] === 'Files') return true;
            }
            return false;
        };
        el.viewer.addEventListener('dragenter', (e) => {
            if (!dragHasFiles(e)) return;
            e.preventDefault();
            st.dragDepth++;
            el.viewer.classList.add('drag-over');
            if (el.dropIcon) el.dropIcon.innerHTML = '&#x2B07;';
            if (el.dropText) el.dropText.textContent = t('dropSupported');
        });
        el.viewer.addEventListener('dragover', (e) => {
            if (!dragHasFiles(e)) return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        });
        el.viewer.addEventListener('dragleave', () => {
            st.dragDepth--;
            if (st.dragDepth <= 0) {
                st.dragDepth = 0;
                el.viewer.classList.remove('drag-over');
            }
        });
        el.viewer.addEventListener('drop', async (e) => {
            if (!dragHasFiles(e)) return;
            e.preventDefault();
            st.dragDepth = 0;
            el.viewer.classList.remove('drag-over');
            const files = e.dataTransfer?.files;
            if (!files || !files.length) return;
            await loadFile(files[0]);
        });
    }

    function bindUi() {
        if (el.fileInput) {
            el.fileInput.addEventListener('change', async (e) => {
                const file = e.target.files && e.target.files[0];
                await loadFile(file);
                el.fileInput.value = '';
            });
        }
        if (el.btnClear) el.btnClear.addEventListener('click', clearData);
        if (el.colormap) {
            el.colormap.addEventListener('change', () => {
                if (st.dataset && st.displayMode === 'height') render(false);
                else renderColorbar();
            });
            if (typeof setupColormapPicker === 'function') setupColormapPicker(el.colormap);
        }
        if (el.btnRoi) {
            el.btnRoi.addEventListener('click', () => {
                if (!st.dataset) return;
                setRoiMode(!st.roiMode);
            });
        }
        if (el.btnRoiClear) {
            el.btnRoiClear.addEventListener('click', () => {
                st.roiImage = null;
                st.roiSel = null;
                st.useFullImage = true;
                setRoiMode(false);
                syncRoiShapeFromImage();
                clearResult();
                if (st.dataset) render(false);
                updateButtons();
            });
        }
        if (el.btnRoiFull) {
            el.btnRoiFull.addEventListener('click', () => {
                st.roiImage = null;
                st.roiSel = null;
                st.useFullImage = true;
                setRoiMode(false);
                syncRoiShapeFromImage();
                updateButtons();
            });
        }
        if (el.btnCompute) el.btnCompute.addEventListener('click', compute);
        if (el.btnExport) el.btnExport.addEventListener('click', exportCsv);
        if (el.detrend) {
            el.detrend.addEventListener('change', () => {
                if (st.result) {
                    // 參數變更後需重算
                    clearResult();
                    if (st.dataset) render(false);
                }
            });
        }
        if (el.lambdaSPreset) {
            el.lambdaSPreset.addEventListener('change', () => {
                applyLambdaPresetSelection('S', 'areal');
                onLambdaParamChanged();
            });
        }
        if (el.lambdaS) {
            el.lambdaS.addEventListener('input', () => {
                syncLambdaPresetFromInput('S', 'areal');
            });
            el.lambdaS.addEventListener('change', () => {
                syncLambdaPresetFromInput('S', 'areal');
                onLambdaParamChanged();
            });
        }
        if (el.lambdaCPreset) {
            el.lambdaCPreset.addEventListener('change', () => {
                applyLambdaPresetSelection('C', 'areal');
                onLambdaParamChanged();
            });
        }
        if (el.lambdaC) {
            el.lambdaC.addEventListener('input', () => {
                syncLambdaPresetFromInput('C', 'areal');
            });
            el.lambdaC.addEventListener('change', () => {
                syncLambdaPresetFromInput('C', 'areal');
                onLambdaParamChanged();
            });
        }
        if (el.viewMode) {
            el.viewMode.addEventListener('change', () => {
                st.displayMode = el.viewMode.value === 'residual' ? 'residual' : 'height';
                if (st.dataset) render(false);
            });
        }

        // 輪廓粗糙度控件
        if (el.pfDetrend) {
            el.pfDetrend.addEventListener('change', () => {
                if (st.pfResult) clearPfResult();
            });
        }
        if (el.pfLambdaSPreset) {
            el.pfLambdaSPreset.addEventListener('change', () => {
                applyLambdaPresetSelection('S', 'profile');
                onLambdaParamChanged();
            });
        }
        if (el.pfLambdaS) {
            el.pfLambdaS.addEventListener('input', () => {
                syncLambdaPresetFromInput('S', 'profile');
            });
            el.pfLambdaS.addEventListener('change', () => {
                syncLambdaPresetFromInput('S', 'profile');
                onLambdaParamChanged();
            });
        }
        if (el.pfLambdaCPreset) {
            el.pfLambdaCPreset.addEventListener('change', () => {
                applyLambdaPresetSelection('C', 'profile');
                onLambdaParamChanged();
            });
        }
        if (el.pfLambdaC) {
            el.pfLambdaC.addEventListener('input', () => {
                syncLambdaPresetFromInput('C', 'profile');
            });
            el.pfLambdaC.addEventListener('change', () => {
                syncLambdaPresetFromInput('C', 'profile');
                onLambdaParamChanged();
            });
        }
        if (el.btnLine) {
            el.btnLine.addEventListener('click', () => {
                if (!st.dataset) return;
                setLineMode(!st.lineMode);
            });
        }
        if (el.btnLineH) {
            el.btnLineH.addEventListener('click', () => setDefaultMidLine('h'));
        }
        if (el.btnLineV) {
            el.btnLineV.addEventListener('click', () => setDefaultMidLine('v'));
        }
        if (el.btnLineClear) {
            el.btnLineClear.addEventListener('click', () => {
                st.lineImage = null;
                setLineMode(false);
                syncLineFromImage();
                clearPfResult();
                updateButtons();
            });
        }
        if (el.btnPfCompute) el.btnPfCompute.addEventListener('click', computeProfileRoughness);
        if (el.btnPfExport) el.btnPfExport.addEventListener('click', exportPfCsv);

        // 子功能切換
        document.querySelectorAll('.an-nav-item[data-an-tool]').forEach((btn) => {
            btn.addEventListener('click', () => {
                if (btn.disabled) return;
                const tool = btn.getAttribute('data-an-tool');
                if (tool === 'roughness' || tool === 'profile') setTool(tool);
            });
        });

        setupNavCollapse();
        setupViewerInteraction();
        setupRoiOverlay();
        setupLineOverlay();
        setupPfPlotInteraction();
        setupResidualThumbInteraction();
        setupHistInteraction();
        setTool(st.tool);
        rebuildLambdaPresets({ keepValue: false });
        updateButtons();
        renderColorbar();
    }

    function syncNavToggleLabel(collapsed) {
        if (!el.navToggle) return;
        const key = collapsed ? 'anNavExpand' : 'anNavCollapse';
        el.navToggle.title = t(key);
        el.navToggle.setAttribute('aria-label', t(key));
        el.navToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }

    function setNavCollapsed(collapsed, opts) {
        opts = opts || {};
        if (!el.main) return;
        el.main.classList.toggle('an-nav-collapsed', !!collapsed);
        syncNavToggleLabel(!!collapsed);
        if (opts.persist !== false && typeof setUserPref === 'function') {
            setUserPref('anNavCollapsed', !!collapsed);
        }
        if (opts.refit !== false) {
            requestAnimationFrame(() => {
                if (st.dataset) fitImage();
            });
        }
    }

    function setupNavCollapse() {
        const initial = typeof getUserPref === 'function' ? !!getUserPref('anNavCollapsed') : false;
        setNavCollapsed(initial, { persist: false, refit: false });
        if (!el.navToggle) return;
        el.navToggle.addEventListener('click', () => {
            const next = !el.main.classList.contains('an-nav-collapsed');
            setNavCollapsed(next);
        });
    }

    function refit() {
        if (st.dataset && el.viewer && el.viewer.clientWidth > 0) {
            fitImage();
        }
    }

    function syncLang() {
        if (!el.status) return;
        if (!st.dataset) el.status.textContent = t('statusIdle');
        else if (st.tool === 'profile' && st.pfResult && st.pfResult.ok) {
            el.status.textContent = t('anPfStatusDone',
                st.pfResult.params.Ra.toFixed(4),
                st.pfResult.params.Rq.toFixed(4),
                st.pfResult.params.Rz.toFixed(4));
        } else if (st.tool === 'roughness' && st.result && st.result.ok) {
            el.status.textContent = t('anStatusDone',
                st.result.params.Sa.toFixed(4),
                st.result.params.Sq.toFixed(4),
                st.result.params.Sz.toFixed(4));
        } else {
            el.status.textContent = t('statusLoaded',
                st.dataset.filename, st.dataset.width, st.dataset.height);
        }
        if (st.result && st.result.ok) showResults(st.result);
        if (st.pfResult && st.pfResult.ok) showPfResults(st.pfResult);
        const collapsed = el.main && el.main.classList.contains('an-nav-collapsed');
        syncNavToggleLabel(!!collapsed);
        rebuildLambdaPresets({ keepValue: true });
        updateLineButtons();
        updateRoiButtons();
    }

    function hasData() { return !!st.dataset; }
    function getDataset() {
        if (!st.dataset) return null;
        return typeof cloneDatasetForTransfer === 'function'
            ? cloneDatasetForTransfer(st.dataset)
            : st.dataset;
    }

    bindUi();

    return {
        loadFile,
        loadDataset,
        clearData,
        hasData,
        getDataset,
        refit,
        syncLang,
        compute,
    };
})();

/** 從檢視／編輯傳送資料到分析頁 */
async function transferDatasetToAnalysis(opts = {}) {
    const { ds, file, entry } = opts;
    if (!ds && !file) {
        showToast(t('sendNoData'), 'info');
        return false;
    }
    if (typeof switchPage === 'function') switchPage('analysis');
    await new Promise((r) => requestAnimationFrame(r));
    try {
        let dataset = ds;
        if (!dataset && file) {
            if (typeof parseFileToDataset === 'function') {
                dataset = await parseFileToDataset(file);
                if (entry) entry.previewDs = dataset;
            } else {
                await AnalysisView.loadFile(file);
                showToast(t('sentToAnalysis'), 'info');
                return true;
            }
        }
        const ok = await AnalysisView.loadDataset(dataset);
        if (ok) showToast(t('sentToAnalysis'), 'info');
        return ok;
    } catch (err) {
        console.error(err);
        showToast(t('statusReadFailed', err.message), 'error');
        return false;
    }
}
