/**
 * 點雲分析：疊圖分析（雙圖同步縮放／拖曳／剖線與剖面圖）
 * 依賴：file-parse.js, colormap.js, render.js (computeRange*), i18n / prefs, viewer-ui (showToast, formatValue, getExt, SUPPORTED_*)
 * 匯出（全域）：OverlayAnalysis
 */
/* =========================================================================
 *  疊圖分析：兩張同尺寸高度圖並排，視埠與剖線同步，各自顯示剖面圖
 * ========================================================================= */
const OverlayAnalysis = (() => {
    const HIT_R = 10;
    const MIN_LINE = 1;
    const VIEW_MIN = 0.02;
    const VIEW_MAX = 100;
    const OV_EXTS = ['bcrf', 'asc', 'tif', 'tiff', 'pcd', 'txt', 'bmp', 'png', 'jpg', 'jpeg'];
    const MEASURE_COLORS = ['#ff6b6b', '#51cf66'];
    const MEASURE_DIST_COLOR = '#ffd24a';
    const MEASURE_STEP_COLOR = '#ff7b72';
    const MEASURE_FILL = 'rgba(255,210,74,0.12)';
    const CHART_PICK_R = 22;

    function $(id) { return document.getElementById(id); }

    const el = {
        workspace: $('ovWorkspace'),
        panel: $('anPanelOverlay'),
        statusMeta: $('ovStatusMeta'),
        btnLine: $('ovBtnLine'),
        btnLineH: $('ovBtnLineH'),
        btnLineV: $('ovBtnLineV'),
        btnLineClear: $('ovBtnLineClear'),
        colormap: $('anColormap'),
        progress: $('anProgress'),
        progressBar: $('anProgressBar'),
        status: $('anStatus'),
        colorbarCanvas: $('anColorbarCanvas'),
        zMin: $('anZMin'),
        zMax: $('anZMax'),
        infoList: $('anInfoList'),
    };

    const sides = {
        a: {
            key: 'a',
            viewer: $('ovViewerA'),
            canvas: $('ovCanvasA'),
            placeholder: $('ovPlaceholderA'),
            zoom: $('ovZoomA'),
            name: $('ovNameA'),
            fileInput: $('ovFileA'),
            btnClear: $('ovClearA'),
            lineOverlay: $('ovLineOverlayA'),
            lineSeg: $('ovLineSegA'),
            lineH0: $('ovLineH0A'),
            lineH1: $('ovLineH1A'),
            lineHover: $('ovLineHoverA'),
            lineM0: $('ovLineM0A'),
            lineM1: $('ovLineM1A'),
            lineHint: $('ovLineHintA'),
            profilePanel: $('ovProfilePanelA'),
            profileMeta: $('ovProfileMetaA'),
            profileCanvas: $('ovProfileCanvasA'),
            profileTip: $('ovProfileTipA'),
            profileClear: $('ovProfileClearA'),
            profilePlot: $('ovProfilePlotA'),
            chartStyle: $('ovChartStyleA'),
            measureBtn: $('ovMeasureBtnA'),
        },
        b: {
            key: 'b',
            viewer: $('ovViewerB'),
            canvas: $('ovCanvasB'),
            placeholder: $('ovPlaceholderB'),
            zoom: $('ovZoomB'),
            name: $('ovNameB'),
            fileInput: $('ovFileB'),
            btnClear: $('ovClearB'),
            lineOverlay: $('ovLineOverlayB'),
            lineSeg: $('ovLineSegB'),
            lineH0: $('ovLineH0B'),
            lineH1: $('ovLineH1B'),
            lineHover: $('ovLineHoverB'),
            lineM0: $('ovLineM0B'),
            lineM1: $('ovLineM1B'),
            lineHint: $('ovLineHintB'),
            profilePanel: $('ovProfilePanelB'),
            profileMeta: $('ovProfileMetaB'),
            profileCanvas: $('ovProfileCanvasB'),
            profileTip: $('ovProfileTipB'),
            profileClear: $('ovProfileClearB'),
            profilePlot: $('ovProfilePlotB'),
            chartStyle: $('ovChartStyleB'),
            measureBtn: $('ovMeasureBtnB'),
        },
    };

    let chartStyle = (typeof getUserPref === 'function') ? getUserPref('profileChartStyle') : 'line';
    if (chartStyle !== 'line' && chartStyle !== 'dots') chartStyle = 'line';

    const st = {
        active: false,
        dsA: null,
        dsB: null,
        view: { scale: 1, tx: 0, ty: 0 },
        lineImage: null,
        lineMode: false,
        lineAction: null,
        lineSource: null, // 'a' | 'b' while drawing
        profileA: null,
        profileB: null,
        geomA: null,
        geomB: null,
        hoverSide: null,
        hoverIndex: null,
        measureMode: false,
        measurePts: [],
        // 剖面圖可視距離窗（雙圖同步）；d1=null 表示顯示全長
        chartView: { d0: 0, d1: null },
        chartPan: null,
        panning: false,
        panStart: null,
        dragDepth: { a: 0, b: 0 },
        bound: false,
    };

    function setProgress(p) {
        if (!el.progress) return;
        el.progress.classList.add('show');
        if (el.progressBar) el.progressBar.style.width = (p * 100).toFixed(1) + '%';
    }
    function hideProgress() {
        setTimeout(() => { if (el.progress) el.progress.classList.remove('show'); }, 300);
    }

    function dsOf(side) { return side === 'a' ? st.dsA : st.dsB; }
    function setDs(side, ds) { if (side === 'a') st.dsA = ds; else st.dsB = ds; }
    function bothReady() {
        return !!(st.dsA && st.dsB
            && st.dsA.width === st.dsB.width
            && st.dsA.height === st.dsB.height);
    }
    function anyReady() { return !!(st.dsA || st.dsB); }
    function refDs() { return st.dsA || st.dsB; }

    function viewerSize(sideEl) {
        return {
            w: Math.max(1, sideEl.viewer.clientWidth),
            h: Math.max(1, sideEl.viewer.clientHeight),
        };
    }

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

    function clampLine(line, width, height) {
        const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
        return {
            x0: clamp(line.x0, 0, width - 1),
            y0: clamp(line.y0, 0, height - 1),
            x1: clamp(line.x1, 0, width - 1),
            y1: clamp(line.y1, 0, height - 1),
        };
    }

    function sampleProfile(ds, line) {
        const { width, height, data } = ds;
        const dx = line.x1 - line.x0, dy = line.y1 - line.y0;
        const distPx = Math.hypot(dx, dy);
        const N = Math.max(2, Math.ceil(distPx));
        const dist = new Float32Array(N);
        const vals = new Float32Array(N);
        let vmin = Infinity, vmax = -Infinity, anyValid = false;
        for (let i = 0; i < N; i++) {
            const tt = N > 1 ? i / (N - 1) : 0;
            const fx = line.x0 + dx * tt;
            const fy = line.y0 + dy * tt;
            const px = Math.round(fx), py = Math.round(fy);
            let v = NaN;
            if (px >= 0 && py >= 0 && px < width && py < height) {
                v = data[py * width + px];
            }
            dist[i] = distPx * tt;
            vals[i] = v;
            if (Number.isFinite(v)) {
                anyValid = true;
                if (v < vmin) vmin = v;
                if (v > vmax) vmax = v;
            }
        }
        if (!anyValid) { vmin = 0; vmax = 1; }
        else if (vmin === vmax) { vmin -= 0.5; vmax += 0.5; }
        return { dist, vals, vmin, vmax, distPx, N, anyValid };
    }

    function fmtVal(v) {
        if (typeof formatValue === 'function') return formatValue(v);
        if (!Number.isFinite(v)) return '-';
        const a = Math.abs(v);
        if (a !== 0 && (a < 0.001 || a >= 1e6)) return v.toExponential(4);
        return (Math.round(v * 10000) / 10000).toString();
    }

    function renderPixels(side) {
        const s = sides[side];
        const ds = dsOf(side);
        if (!ds || !s.canvas) return;
        const ctx = s.canvas.getContext('2d');
        const { width, height, data } = ds;
        s.canvas.width = width;
        s.canvas.height = height;
        s.canvas.style.width = '';
        s.canvas.style.height = '';
        const img = ctx.createImageData(width, height);
        const px = img.data;
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
        ctx.putImageData(img, 0, 0);
        s.canvas.style.display = 'block';
        if (s.placeholder) s.placeholder.style.display = 'none';
        s.viewer.classList.add('has-data');
    }

    function clearSideVisual(side) {
        const s = sides[side];
        if (s.canvas) {
            s.canvas.style.display = 'none';
            s.canvas.style.transform = '';
        }
        if (s.placeholder) s.placeholder.style.display = '';
        s.viewer.classList.remove('has-data', 'line-active', 'has-line');
        if (s.name) s.name.textContent = '';
        if (s.profilePanel) s.profilePanel.classList.remove('show');
        if (s.profileMeta) s.profileMeta.textContent = '';
        if (s.profileTip) s.profileTip.classList.remove('show');
        if (s.profileClear) s.profileClear.disabled = true;
        hideLineOnSide(s);
    }

    function applyTransformSide(s) {
        if (!s.canvas || s.canvas.style.display === 'none') return;
        s.canvas.style.transform = `translate(${st.view.tx}px, ${st.view.ty}px) scale(${st.view.scale})`;
        if (s.zoom) {
            const pct = st.view.scale * 100;
            s.zoom.textContent = (pct >= 100 ? pct.toFixed(0) : pct.toFixed(1)) + '%';
        }
    }

    function applyTransform() {
        applyTransformSide(sides.a);
        applyTransformSide(sides.b);
        syncLineOverlays();
    }

    function fitImage() {
        const ds = refDs();
        if (!ds) return;
        // 以有資料的那一側（優先 A）作為 fit 基準；兩側等寬時效果一致
        const base = st.dsA ? sides.a : sides.b;
        const { w: vw, h: vh } = viewerSize(base);
        if (vw < 8 || vh < 8) {
            requestAnimationFrame(() => { if (st.active) fitImage(); });
            return;
        }
        const w = ds.width, h = ds.height, padding = 20;
        const s = Math.min((vw - padding * 2) / w, (vh - padding * 2) / h, 8);
        st.view.scale = s > 0 ? s : 1;
        st.view.tx = (vw - w * st.view.scale) / 2;
        st.view.ty = (vh - h * st.view.scale) / 2;
        applyTransform();
    }

    function renderColorbarFrom(ds) {
        const cb = el.colorbarCanvas;
        if (!cb || !ds) return;
        const ctx = cb.getContext('2d');
        const w = cb.width, h = cb.height;
        const img = ctx.createImageData(w, h);
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
        ctx.putImageData(img, 0, 0);
        if (el.zMin) el.zMin.textContent = ds.vmin.toFixed(4);
        if (el.zMax) el.zMax.textContent = ds.vmax.toFixed(4);
    }

    function renderInfoBoth() {
        if (!el.infoList) return;
        el.infoList.innerHTML = '';
        const add = (k, v) => {
            const row = document.createElement('div');
            row.className = 'info-row';
            row.innerHTML = '<span class="k"></span><span class="v"></span>';
            row.querySelector('.k').textContent = k;
            row.querySelector('.v').textContent = String(v);
            el.infoList.appendChild(row);
        };
        if (st.dsA) {
            add(t('ovPaneA'), st.dsA.filename || '-');
            add(t('infoSize') + ' (A)', `${st.dsA.width} × ${st.dsA.height}`);
        }
        if (st.dsB) {
            add(t('ovPaneB'), st.dsB.filename || '-');
            add(t('infoSize') + ' (B)', `${st.dsB.width} × ${st.dsB.height}`);
        }
        if (bothReady()) add(t('ovDimMatch'), t('ovDimOk'));
        else if (st.dsA && st.dsB) add(t('ovDimMatch'), t('ovDimMismatch'));
    }

    function updateStatusMeta() {
        if (!el.statusMeta) return;
        if (!st.dsA && !st.dsB) {
            el.statusMeta.textContent = t('ovStatusEmpty');
            return;
        }
        if (st.dsA && !st.dsB) {
            el.statusMeta.textContent = t('ovStatusNeedB', st.dsA.width, st.dsA.height);
            return;
        }
        if (!st.dsA && st.dsB) {
            el.statusMeta.textContent = t('ovStatusNeedA', st.dsB.width, st.dsB.height);
            return;
        }
        if (!bothReady()) {
            el.statusMeta.textContent = t('ovStatusSizeMismatch',
                st.dsA.width, st.dsA.height, st.dsB.width, st.dsB.height);
            return;
        }
        el.statusMeta.textContent = t('ovStatusReady', st.dsA.width, st.dsA.height);
    }

    function hideLineOnSide(s) {
        if (!s.lineSeg) return;
        s.lineSeg.setAttribute('x1', '0');
        s.lineSeg.setAttribute('y1', '0');
        s.lineSeg.setAttribute('x2', '0');
        s.lineSeg.setAttribute('y2', '0');
        if (s.lineH0) { s.lineH0.setAttribute('cx', '0'); s.lineH0.setAttribute('cy', '0'); }
        if (s.lineH1) { s.lineH1.setAttribute('cx', '0'); s.lineH1.setAttribute('cy', '0'); }
        if (s.lineHover) s.lineHover.setAttribute('visibility', 'hidden');
        if (s.lineM0) s.lineM0.setAttribute('visibility', 'hidden');
        if (s.lineM1) s.lineM1.setAttribute('visibility', 'hidden');
    }

    function drawLineOnSide(s, line) {
        if (!s.lineSeg || !line) { hideLineOnSide(s); return; }
        const a = imageToViewport(line.x0, line.y0);
        const b = imageToViewport(line.x1, line.y1);
        s.lineSeg.setAttribute('x1', a.x);
        s.lineSeg.setAttribute('y1', a.y);
        s.lineSeg.setAttribute('x2', b.x);
        s.lineSeg.setAttribute('y2', b.y);
        if (s.lineH0) { s.lineH0.setAttribute('cx', a.x); s.lineH0.setAttribute('cy', a.y); }
        if (s.lineH1) { s.lineH1.setAttribute('cx', b.x); s.lineH1.setAttribute('cy', b.y); }
    }

    /** 依剖面取樣索引，在兩張圖的剖線上同步顯示游標／測量點 */
    function syncHoverOnImages() {
        const L = st.lineImage;
        const i = st.hoverIndex;
        for (const key of ['a', 'b']) {
            const s = sides[key];
            const data = key === 'a' ? st.profileA : st.profileB;
            const marker = s.lineHover;
            if (marker) {
                const showHover = L && i != null && data && i >= 0 && i < data.N && dsOf(key)
                    && !(st.measureMode && st.measurePts.includes(i));
                if (!showHover) {
                    marker.setAttribute('visibility', 'hidden');
                } else {
                    const tt = data.N > 1 ? i / (data.N - 1) : 0;
                    const vp = imageToViewport(
                        L.x0 + (L.x1 - L.x0) * tt,
                        L.y0 + (L.y1 - L.y0) * tt
                    );
                    marker.setAttribute('cx', vp.x);
                    marker.setAttribute('cy', vp.y);
                    marker.setAttribute('visibility', 'visible');
                }
            }
            // 測量點
            for (let k = 0; k < 2; k++) {
                const mEl = k === 0 ? s.lineM0 : s.lineM1;
                if (!mEl) continue;
                const mi = st.measurePts[k];
                if (!L || mi == null || !data || mi < 0 || mi >= data.N || !dsOf(key)) {
                    mEl.setAttribute('visibility', 'hidden');
                    continue;
                }
                const tt = data.N > 1 ? mi / (data.N - 1) : 0;
                const vp = imageToViewport(
                    L.x0 + (L.x1 - L.x0) * tt,
                    L.y0 + (L.y1 - L.y0) * tt
                );
                mEl.setAttribute('cx', vp.x);
                mEl.setAttribute('cy', vp.y);
                mEl.setAttribute('visibility', 'visible');
            }
        }
    }

    function syncLineOverlays() {
        const hasLine = !!st.lineImage;
        for (const key of ['a', 'b']) {
            const s = sides[key];
            const hasDs = !!dsOf(key);
            s.viewer.classList.toggle('line-active', st.lineMode && hasDs);
            s.viewer.classList.toggle('has-line', hasLine && hasDs);
            if (s.lineOverlay) {
                const show = hasDs && (st.lineMode || hasLine);
                s.lineOverlay.setAttribute('aria-hidden', show ? 'false' : 'true');
            }
            if (s.lineHint) {
                s.lineHint.style.display = st.lineMode && !st.lineImage ? 'block' : 'none';
            }
            if (hasDs && st.lineImage) drawLineOnSide(s, st.lineImage);
            else hideLineOnSide(s);
        }
        syncHoverOnImages();
    }

    function recomputeProfiles() {
        st.profileA = null;
        st.profileB = null;
        clearMeasurePts();
        hideProfileTips();
        resetChartView();
        if (!st.lineImage) {
            renderProfileCharts();
            return;
        }
        if (st.dsA) st.profileA = sampleProfile(st.dsA, st.lineImage);
        if (st.dsB) st.profileB = sampleProfile(st.dsB, st.lineImage);
        renderProfileCharts();
    }

    function resetChartView() {
        st.chartView = { d0: 0, d1: null };
        st.chartPan = null;
    }

    /** 剖面圖目前可視距離窗（與資料全長對齊） */
    function chartDistWindow(data) {
        const full = (data && data.distPx > 0) ? data.distPx : 1;
        let d0 = Number.isFinite(st.chartView.d0) ? st.chartView.d0 : 0;
        let d1 = (st.chartView.d1 != null && Number.isFinite(st.chartView.d1))
            ? st.chartView.d1 : full;
        if (d0 > d1) { const t = d0; d0 = d1; d1 = t; }
        d0 = Math.max(0, Math.min(d0, full));
        d1 = Math.max(0, Math.min(d1, full));
        const minSpan = Math.max(full * 0.02, 1e-6);
        if (d1 - d0 < minSpan) {
            const mid = (d0 + d1) * 0.5;
            d0 = Math.max(0, mid - minSpan * 0.5);
            d1 = Math.min(full, d0 + minSpan);
            d0 = Math.max(0, d1 - minSpan);
        }
        return { d0, d1, span: d1 - d0, full };
    }

    function isChartZoomed(data) {
        const win = chartDistWindow(data);
        return win.span < win.full * 0.999;
    }

    function yRangeForWindow(data, win) {
        let vmin = Infinity, vmax = -Infinity, ok = false;
        for (let i = 0; i < data.N; i++) {
            const d = data.dist[i];
            if (d < win.d0 || d > win.d1) continue;
            const v = data.vals[i];
            if (!Number.isFinite(v)) continue;
            ok = true;
            if (v < vmin) vmin = v;
            if (v > vmax) vmax = v;
        }
        if (!ok) return { vmin: data.vmin, vmax: data.vmax };
        if (vmin === vmax) { vmin -= 0.5; vmax += 0.5; }
        const pad = (vmax - vmin) * 0.06 || 0.5;
        return { vmin: vmin - pad, vmax: vmax + pad };
    }

    function distToPlotX(dist, geom, win) {
        return geom.padL + ((dist - win.d0) / win.span) * geom.plotW;
    }

    function plotXToDist(px, geom, win) {
        return win.d0 + ((px - geom.padL) / geom.plotW) * win.span;
    }

    function renderOneProfile(side, data) {
        const s = sides[side];
        if (!s.profilePanel || !s.profileCanvas) return;
        if (!data) {
            s.profilePanel.classList.remove('show');
            if (s.profileClear) s.profileClear.disabled = true;
            return;
        }
        s.profilePanel.classList.add('show');
        if (s.profileClear) s.profileClear.disabled = false;

        const win = chartDistWindow(data);
        const yr = yRangeForWindow(data, win);
        const vmin = yr.vmin;
        const vmax = yr.vmax;
        if (s.profileMeta) {
            let meta =
                `${t('profileLength')}: ${data.distPx.toFixed(1)} px · ` +
                `${t('profileSamples')}: ${data.N} · ` +
                `${t('profileRange')}: ${fmtVal(data.vmin)} ~ ${fmtVal(data.vmax)}`;
            if (isChartZoomed(data)) {
                meta += ` · ${fmtVal(win.d0)}–${fmtVal(win.d1)} px`;
            }
            s.profileMeta.textContent = meta;
        }

        const canvas = s.profileCanvas;
        const dpr = window.devicePixelRatio || 1;
        const cw = canvas.clientWidth || canvas.parentElement.clientWidth || 400;
        const ch = canvas.clientHeight || 140;
        const bw = Math.max(1, Math.round(cw * dpr));
        const bh = Math.max(1, Math.round(ch * dpr));
        if (canvas.width !== bw) canvas.width = bw;
        if (canvas.height !== bh) canvas.height = bh;

        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cw, ch);

        const padL = 54, padR = 12, padT = 10, padB = 24;
        const plotW = Math.max(1, cw - padL - padR);
        const plotH = Math.max(1, ch - padT - padB);
        const x0 = padL, y0 = padT;
        const geom = { padL, padT, plotW, plotH, cw, ch, vmin, vmax, win };
        if (side === 'a') st.geomA = geom; else st.geomB = geom;

        ctx.fillStyle = 'rgba(255,255,255,0.03)';
        ctx.fillRect(x0, y0, plotW, plotH);
        ctx.font = '11px Consolas, monospace';
        ctx.lineWidth = 1;

        const yticks = 4;
        const range = (vmax - vmin) || 1;
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        for (let i = 0; i <= yticks; i++) {
            const tt = i / yticks;
            const py = y0 + plotH * tt;
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.beginPath(); ctx.moveTo(x0, py); ctx.lineTo(x0 + plotW, py); ctx.stroke();
            const val = vmax - range * tt;
            ctx.fillStyle = '#9a9ab0';
            ctx.fillText(fmtVal(val), x0 - 6, py);
        }

        const xticks = 5;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        for (let i = 0; i <= xticks; i++) {
            const tt = i / xticks;
            const px = x0 + plotW * tt;
            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.beginPath(); ctx.moveTo(px, y0); ctx.lineTo(px, y0 + plotH); ctx.stroke();
            ctx.fillStyle = '#9a9ab0';
            ctx.fillText((win.d0 + win.span * tt).toFixed(0), px, y0 + plotH + 5);
        }

        const color = side === 'a' ? '#4f8cff' : '#51cf66';
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, y0, plotW, plotH);
        ctx.clip();

        if (chartStyle === 'dots') {
            ctx.fillStyle = color;
            for (let i = 0; i < data.N; i++) {
                const v = data.vals[i];
                if (!Number.isFinite(v)) continue;
                if (data.dist[i] < win.d0 || data.dist[i] > win.d1) continue;
                const px = distToPlotX(data.dist[i], geom, win);
                const py = y0 + (1 - (v - vmin) / range) * plotH;
                ctx.beginPath(); ctx.arc(px, py, 2.2, 0, Math.PI * 2); ctx.fill();
            }
        } else {
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            let started = false;
            for (let i = 0; i < data.N; i++) {
                const v = data.vals[i];
                if (!Number.isFinite(v)) { started = false; continue; }
                const px = distToPlotX(data.dist[i], geom, win);
                const py = y0 + (1 - (v - vmin) / range) * plotH;
                if (!started) { ctx.moveTo(px, py); started = true; }
                else ctx.lineTo(px, py);
            }
            ctx.stroke();
        }

        // hover 十字線（測量模式改由測量標記處理）
        if (!st.measureMode && st.hoverIndex != null && st.hoverIndex >= 0 && st.hoverIndex < data.N) {
            const i = st.hoverIndex;
            const px = distToPlotX(data.dist[i], geom, win);
            if (px >= x0 - 1 && px <= x0 + plotW + 1) {
                ctx.strokeStyle = 'rgba(255,210,74,0.85)';
                ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(px + 0.5, y0); ctx.lineTo(px + 0.5, y0 + plotH); ctx.stroke();
                const v = data.vals[i];
                if (Number.isFinite(v)) {
                    const py = y0 + (1 - (v - vmin) / range) * plotH;
                    ctx.fillStyle = '#ffd24a';
                    ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI * 2); ctx.fill();
                }
            }
        }

        ctx.restore();
        // 測量標註在 clip 外繪製，避免文字被裁切
        drawMeasureOnChart(ctx, side, data, geom);

        // meta 附加測量結果
        const mr = measureResult(data);
        if (mr && s.profileMeta) {
            s.profileMeta.textContent +=
                ` · ${t('measureDist')} ${fmtVal(mr.dist)} ${t('measureUnitPx')}` +
                ` · ${t('profileMeasureStep')} ${fmtVal(mr.step)}${headerZUnit(dsOf(side)) ? ' ' + headerZUnit(dsOf(side)) : ''}`;
        }
    }

    function chartPointPx(data, geom, i) {
        const v = data.vals[i];
        if (!Number.isFinite(v)) return null;
        const win = geom.win || chartDistWindow(data);
        const range = (geom.vmax - geom.vmin) || 1;
        return {
            px: distToPlotX(data.dist[i], geom, win),
            py: geom.padT + (1 - (v - geom.vmin) / range) * geom.plotH,
        };
    }

    function measureResult(data) {
        const pts = st.measurePts;
        if (!data || pts.length < 2) return null;
        const i0 = pts[0], i1 = pts[1];
        if (!Number.isFinite(data.vals[i0]) || !Number.isFinite(data.vals[i1])) return null;
        return {
            i0, i1,
            dist: Math.abs(data.dist[i1] - data.dist[i0]),
            step: data.vals[i1] - data.vals[i0],
        };
    }

    /** 在繪圖區內挑選距離／階高標籤位置，避免重疊與出界 */
    function pickMeasureLabelPos(geom, p0, p1, corner, distBoxW, distBoxH, stepBoxW, stepBoxH) {
        const m = 2;
        const x0 = 0 + m, y0 = 0 + m;
        const x1 = geom.cw - m, y1 = geom.ch - m;
        const sgnX = p1.px >= p0.px ? 1 : -1;
        const sgnY = p1.py >= p0.py ? 1 : -1;
        const distMidX = (p0.px + corner.px) / 2;
        const stepMidY = (corner.py + p1.py) / 2;

        const clampBox = (bx, by, bw, bh) => {
            let x = bx, y = by;
            if (x < x0) x = x0;
            if (y < y0) y = y0;
            if (x + bw > x1) x = Math.max(x0, x1 - bw);
            if (y + bh > y1) y = Math.max(y0, y1 - bh);
            return { x, y };
        };

        const distCandidates = [];
        for (const perp of [-sgnY, sgnY]) {
            for (const off of [12, 20, 28, 8]) {
                const ay = p0.py + perp * off;
                const bx = distMidX - distBoxW / 2;
                const by = perp < 0 ? ay - distBoxH : ay;
                distCandidates.push(clampBox(bx, by, distBoxW, distBoxH));
            }
        }
        // 水平段很短：改貼在端點旁
        if (Math.abs(corner.px - p0.px) < 64) {
            for (const perp of [-sgnY, sgnY]) {
                for (const off of [12, 20]) {
                    const bx = (sgnX > 0 ? p0.px + 4 : p0.px - 4 - distBoxW);
                    const by = p0.py + perp * off - (perp < 0 ? distBoxH : 0);
                    distCandidates.push(clampBox(bx, by, distBoxW, distBoxH));
                }
            }
        }

        const stepCandidates = [];
        for (const perp of [sgnX, -sgnX]) {
            for (const off of [14, 22, 30, 8]) {
                const ax = corner.px + perp * off;
                const bx = perp > 0 ? ax : ax - stepBoxW;
                const by = stepMidY - stepBoxH / 2;
                stepCandidates.push(clampBox(bx, by, stepBoxW, stepBoxH));
            }
        }
        if (Math.abs(p1.py - corner.py) < 36) {
            for (const perp of [sgnX, -sgnX]) {
                for (const off of [14, 22]) {
                    const bx = corner.px + perp * off - (perp > 0 ? 0 : stepBoxW);
                    const by = (sgnY > 0 ? p1.py - 4 - stepBoxH : p1.py + 4);
                    stepCandidates.push(clampBox(bx, by, stepBoxW, stepBoxH));
                }
            }
        }

        const overlap = (a, b) => !(
            a.x + distBoxW + 4 <= b.x || b.x + stepBoxW + 4 <= a.x
            || a.y + distBoxH + 4 <= b.y || b.y + stepBoxH + 4 <= a.y
        );

        let best = null;
        for (const d of distCandidates) {
            for (const s of stepCandidates) {
                let score = 0;
                if (!overlap(d, s)) score += 100;
                score -= Math.abs((d.y + distBoxH / 2) - p0.py) * 0.1;
                score -= Math.abs((s.x + stepBoxW / 2) - corner.px) * 0.1;
                if (!best || score > best.score) best = { dist: d, step: s, score };
            }
        }
        if (!best) {
            return {
                dist: clampBox(distMidX - distBoxW / 2, p0.py - 16, distBoxW, distBoxH),
                step: clampBox(corner.px + 10, stepMidY - stepBoxH / 2, stepBoxW, stepBoxH),
            };
        }
        return best;
    }

    function drawMeasureLabelAt(ctx, text, bx, by, color) {
        ctx.font = '10px Consolas, monospace';
        const pad = 4, boxH = 14;
        const tw = ctx.measureText(text).width;
        const boxW = tw + pad * 2;
        ctx.fillStyle = 'rgba(0,0,0,0.78)';
        ctx.fillRect(bx, by, boxW, boxH);
        ctx.fillStyle = color;
        ctx.fillRect(bx, by, 3, boxH);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, bx + pad + 3, by + boxH / 2 + 0.5);
    }

    function drawMeasureOnChart(ctx, side, data, geom) {
        const pts = st.measurePts;
        if (!data || !geom || pts.length === 0) return;
        const coords = [];
        for (let k = 0; k < pts.length; k++) {
            const p = chartPointPx(data, geom, pts[k]);
            if (!p) continue;
            coords.push({ ...p, color: MEASURE_COLORS[k] });
        }

        if (coords.length === 2) {
            const p0 = coords[0], p1 = coords[1];
            const corner = { px: p1.px, py: p0.py };
            const mr = measureResult(data);
            const zUnit = headerZUnit(dsOf(side));

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(p0.px, p0.py);
            ctx.lineTo(corner.px, corner.py);
            ctx.lineTo(p1.px, p1.py);
            ctx.closePath();
            ctx.fillStyle = MEASURE_FILL;
            ctx.fill();

            ctx.setLineDash([5, 4]);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(p0.px, p0.py); ctx.lineTo(corner.px, corner.py);
            ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 3; ctx.stroke();
            ctx.strokeStyle = MEASURE_DIST_COLOR; ctx.lineWidth = 2; ctx.stroke();

            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(corner.px, corner.py); ctx.lineTo(p1.px, p1.py);
            ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 3; ctx.stroke();
            ctx.strokeStyle = MEASURE_STEP_COLOR; ctx.lineWidth = 2; ctx.stroke();

            const tick = 6;
            const sgnX = p1.px >= p0.px ? 1 : -1;
            const sgnY = p1.py >= p0.py ? 1 : -1;
            ctx.strokeStyle = 'rgba(255,255,255,0.7)';
            ctx.lineWidth = 1.25;
            ctx.beginPath();
            ctx.moveTo(corner.px, corner.py); ctx.lineTo(corner.px - sgnX * tick, corner.py);
            ctx.moveTo(corner.px, corner.py); ctx.lineTo(corner.px, corner.py - sgnY * tick);
            ctx.stroke();
            ctx.restore();

            if (mr) {
                const distText = `${t('measureDist')} ${fmtVal(mr.dist)} ${t('measureUnitPx')}`;
                const stepText = zUnit
                    ? `${t('profileMeasureStep')} ${fmtVal(mr.step)} ${zUnit}`
                    : `${t('profileMeasureStep')} ${fmtVal(mr.step)}`;
                ctx.font = '10px Consolas, monospace';
                const pad = 4, boxH = 14;
                const distBoxW = ctx.measureText(distText).width + pad * 2;
                const stepBoxW = ctx.measureText(stepText).width + pad * 2;
                const layout = pickMeasureLabelPos(
                    geom, p0, p1, corner, distBoxW, boxH, stepBoxW, boxH
                );
                drawMeasureLabelAt(ctx, distText, layout.dist.x, layout.dist.y, MEASURE_DIST_COLOR);
                drawMeasureLabelAt(ctx, stepText, layout.step.x, layout.step.y, MEASURE_STEP_COLOR);
            }
        }

        for (const c of coords) {
            ctx.beginPath();
            ctx.arc(c.px, c.py, 5, 0, Math.PI * 2);
            ctx.fillStyle = c.color;
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#fff';
            ctx.stroke();
        }

        if (st.measureMode && st.hoverIndex != null
            && !pts.includes(st.hoverIndex)) {
            const p = chartPointPx(data, geom, st.hoverIndex);
            if (p) {
                ctx.beginPath();
                ctx.arc(p.px, p.py, 4, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255,210,74,0.55)';
                ctx.fill();
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = '#ffd24a';
                ctx.stroke();
            }
        }
    }

    function syncChartStyleUI() {
        for (const key of ['a', 'b']) {
            const wrap = sides[key].chartStyle;
            if (!wrap) continue;
            wrap.querySelectorAll('button[data-ov-chart]').forEach((btn) => {
                btn.classList.toggle('active', btn.getAttribute('data-ov-chart') === chartStyle);
            });
        }
    }

    function syncMeasureUI() {
        for (const key of ['a', 'b']) {
            const s = sides[key];
            if (s.measureBtn) s.measureBtn.classList.toggle('active', st.measureMode);
            if (s.profilePlot) s.profilePlot.classList.toggle('measure-mode', st.measureMode);
        }
    }

    function clearMeasurePts() {
        st.measurePts = [];
        st.hoverIndex = null;
    }

    function setMeasureMode(on) {
        st.measureMode = !!on;
        clearMeasurePts();
        hideProfileTips();
        syncMeasureUI();
        renderProfileCharts();
    }

    function chartPickIndex(side, mx, my) {
        const data = side === 'a' ? st.profileA : st.profileB;
        const geom = side === 'a' ? st.geomA : st.geomB;
        if (!data || !geom || data.N === 0) return null;
        let best = -1, bestD2 = Infinity;
        const r2 = CHART_PICK_R * CHART_PICK_R;
        for (let i = 0; i < data.N; i++) {
            const p = chartPointPx(data, geom, i);
            if (!p) continue;
            const d2 = (mx - p.px) * (mx - p.px) + (my - p.py) * (my - p.py);
            if (d2 < bestD2) { bestD2 = d2; best = i; }
        }
        return bestD2 <= r2 ? best : null;
    }

    function renderProfileCharts() {
        renderOneProfile('a', st.profileA);
        renderOneProfile('b', st.profileB);
        syncHoverOnImages();
    }

    /** 在已排序 dist 陣列中找最接近 target 的索引 */
    function nearestDistIndex(dist, target) {
        const n = dist.length;
        if (n === 0) return 0;
        if (target <= dist[0]) return 0;
        if (target >= dist[n - 1]) return n - 1;
        let lo = 0, hi = n - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (dist[mid] < target) lo = mid + 1;
            else hi = mid - 1;
        }
        if (lo <= 0) return 0;
        if (lo >= n) return n - 1;
        return (target - dist[lo - 1] <= dist[lo] - target) ? lo - 1 : lo;
    }

    function showProfileTip(side, e, html) {
        const s = sides[side];
        const tip = s.profileTip;
        const canvas = s.profileCanvas;
        if (!tip || !canvas) return;
        tip.innerHTML = html;
        tip.classList.add('show');
        const plotRect = canvas.parentElement.getBoundingClientRect();
        const tw = tip.offsetWidth, th = tip.offsetHeight;
        let left = (e.clientX - plotRect.left) + 12;
        let top = (e.clientY - plotRect.top) + 12;
        if (left + tw > plotRect.width - 4) left = (e.clientX - plotRect.left) - tw - 12;
        if (top + th > plotRect.height - 4) top = (e.clientY - plotRect.top) - th - 12;
        if (left < 2) left = 2;
        if (top < 2) top = 2;
        tip.style.left = left + 'px';
        tip.style.top = top + 'px';
    }

    function hideProfileTips() {
        for (const key of ['a', 'b']) {
            const tip = sides[key].profileTip;
            if (tip) tip.classList.remove('show');
        }
    }

    function headerZUnit(ds) {
        if (!ds || !ds.header) return '';
        const h = ds.header;
        const raw = h.zunit ?? h['z-unit'] ?? '';
        return String(raw).replace(/[\[\]]/g, '').trim();
    }

    function tipHtmlFor(side, idx) {
        const data = side === 'a' ? st.profileA : st.profileB;
        if (!data || idx == null || idx < 0 || idx >= data.N) return '';
        if (st.measureMode) {
            const n = st.measurePts.length;
            if (n < 2) {
                return `<div>${n === 0 ? t('profileMeasurePick1') : t('profileMeasurePick2')}</div>`;
            }
            const mr = measureResult(data);
            if (!mr) return '';
            const zUnit = headerZUnit(dsOf(side));
            return `<div><span class="k">${t('measureDist')}:</span>${fmtVal(mr.dist)} ${t('measureUnitPx')}</div>` +
                `<div><span class="k">${t('profileMeasureStep')}:</span>${fmtVal(mr.step)}${zUnit ? ' ' + zUnit : ''}</div>`;
        }
        const v = data.vals[idx];
        const zUnit = headerZUnit(dsOf(side));
        const heightText = zUnit ? `${fmtVal(v)} ${zUnit}` : fmtVal(v);
        return `<div><span class="k">${t('profileAxisDist')}:</span>${fmtVal(data.dist[idx])}</div>` +
            `<div><span class="k">${t('valueLabel')}:</span>${heightText}</div>`;
    }

    function setLineMode(on) {
        st.lineMode = !!on && bothReady();
        if (!st.lineMode) {
            st.lineAction = null;
            resetViewerCursors();
        }
        updateLineButtons();
        syncLineOverlays();
    }

    function clearLine() {
        st.lineImage = null;
        st.lineAction = null;
        st.hoverIndex = null;
        st.hoverSide = null;
        st.profileA = null;
        st.profileB = null;
        clearMeasurePts();
        resetChartView();
        // 保持剖面模式（與點雲檢視清除剖面後仍停留在剖面游標一致）
        hideProfileTips();
        updateLineButtons();
        syncLineOverlays();
        renderProfileCharts();
        resetViewerCursors();
    }

    function setDefaultMidLine(orient) {
        const ds = refDs();
        if (!ds || !bothReady()) return;
        const { width, height } = ds;
        if (orient === 'h') {
            const y = Math.floor(height / 2);
            st.lineImage = { x0: 0, y0: y, x1: width - 1, y1: y };
        } else {
            const x = Math.floor(width / 2);
            st.lineImage = { x0: x, y0: 0, x1: x, y1: height - 1 };
        }
        // 預設中線後維持剖面模式，方便繼續調整
        if (!st.lineMode) st.lineMode = true;
        updateLineButtons();
        syncLineOverlays();
        recomputeProfiles();
    }

    function commitLine(p0, p1, opts) {
        opts = opts || {};
        const ds = refDs();
        if (!ds) return;
        let line = {
            x0: p0.x, y0: p0.y,
            x1: p1.x, y1: p1.y,
        };
        line = clampLine(line, ds.width, ds.height);
        if (Math.hypot(line.x1 - line.x0, line.y1 - line.y0) < MIN_LINE) {
            // 太短：若有前一條線則還原，否則清除
            if (opts.revertLine) st.lineImage = { ...opts.revertLine };
            else st.lineImage = null;
        } else {
            st.lineImage = line;
        }
        // 不退出剖面模式（與點雲檢視一致：持續以左鍵畫線／編輯）
        updateLineButtons();
        syncLineOverlays();
        recomputeProfiles();
        resetViewerCursors();
    }

    function resetViewerCursors() {
        for (const key of ['a', 'b']) {
            const s = sides[key];
            if (s.viewer) s.viewer.style.cursor = '';
            if (s.lineOverlay) s.lineOverlay.style.cursor = '';
        }
    }

    /** 剖面線 hit-test（視埠座標）→ 'ep0' | 'ep1' | 'move' | null */
    function lineHitTest(vx, vy) {
        const L = st.lineImage;
        if (!L) return null;
        const a = imageToViewport(L.x0, L.y0);
        const b = imageToViewport(L.x1, L.y1);
        const r = HIT_R;
        if (Math.hypot(vx - a.x, vy - a.y) <= r) return 'ep0';
        if (Math.hypot(vx - b.x, vy - b.y) <= r) return 'ep1';
        const dx = b.x - a.x, dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        if (len2 > 0) {
            let tt = ((vx - a.x) * dx + (vy - a.y) * dy) / len2;
            if (tt < 0) tt = 0; else if (tt > 1) tt = 1;
            const dist = Math.hypot(vx - (a.x + tt * dx), vy - (a.y + tt * dy));
            if (dist <= r) return 'move';
        }
        return null;
    }

    function updateLineButtons() {
        const ready = bothReady();
        if (el.btnLine) {
            el.btnLine.disabled = !ready;
            el.btnLine.classList.toggle('tool-active', st.lineMode);
            el.btnLine.setAttribute('aria-pressed', st.lineMode ? 'true' : 'false');
        }
        if (el.btnLineH) el.btnLineH.disabled = !ready;
        if (el.btnLineV) el.btnLineV.disabled = !ready;
        if (el.btnLineClear) el.btnLineClear.disabled = !ready || !st.lineImage;
        if (sides.a.btnClear) sides.a.btnClear.disabled = !st.dsA;
        if (sides.b.btnClear) sides.b.btnClear.disabled = !st.dsB;
        if (sides.a.profileClear) sides.a.profileClear.disabled = !st.lineImage;
        if (sides.b.profileClear) sides.b.profileClear.disabled = !st.lineImage;
        // 同步分析頁表頭清除鈕
        const hdrClear = document.getElementById('anBtnClear');
        if (hdrClear && st.active) hdrClear.disabled = !anyReady();
    }

    async function parseHeightFile(file) {
        const ext = getExt(file.name);
        if (!OV_EXTS.includes(ext) && !SUPPORTED_EXTS.includes(ext)) {
            throw new Error(t('statusUnsupported', file.name, SUPPORTED_TEXT));
        }
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
        if (result && result.type === 'pcd-scatter') {
            throw new Error(t('ovScatterUnsupported'));
        }
        if (!result || !result.data || !result.width || !result.height) {
            throw new Error(t('anNoHeightMap'));
        }
        const rangeSrc = result.data;
        const { vmin, vmax } = rangeSrc.length >= LARGE_PIXEL_THRESHOLD
            ? await computeRangeAsync(rangeSrc)
            : computeRange(rangeSrc);
        return { ...result, filename: file.name, vmin, vmax };
    }

    function isOvHeightFile(file) {
        return !!(file && OV_EXTS.includes(getExt(file.name)));
    }

    /** 從拖放／選檔清單挑出高度圖；超過 2 個只取前 2 */
    function pickOvFiles(fileList) {
        const all = Array.from(fileList || []);
        const supported = all.filter(isOvHeightFile);
        return {
            files: supported.slice(0, 2),
            truncated: supported.length > 2,
            firstAny: all[0] || null,
        };
    }

    async function applyLoadedSide(side, ds) {
        setDs(side, ds);
        if (sides[side].name) sides[side].name.textContent = ds.filename || '';
        renderPixels(side);
    }

    function afterLoadRefresh(dsForColorbar) {
        if (st.lineImage) {
            const ref = refDs();
            if (!ref || st.lineImage.x1 >= ref.width || st.lineImage.y1 >= ref.height) {
                clearLine();
            }
        }
        fitImage();
        if (dsForColorbar) renderColorbarFrom(dsForColorbar);
        renderInfoBoth();
        updateStatusMeta();
        updateLineButtons();
        syncLineOverlays();
        if (st.lineImage) recomputeProfiles();
    }

    async function loadSide(side, file) {
        if (!file) return false;
        el.status.textContent = t('statusReading', file.name);
        setProgress(0);
        try {
            const ds = await parseHeightFile(file);
            const other = side === 'a' ? st.dsB : st.dsA;
            if (other && (other.width !== ds.width || other.height !== ds.height)) {
                showToast(t('ovSizeReject',
                    ds.width, ds.height, other.width, other.height), 'error');
                el.status.textContent = t('ovSizeReject',
                    ds.width, ds.height, other.width, other.height);
                return false;
            }
            await applyLoadedSide(side, ds);
            // 僅單側載入時：另一側已在則沿用視埠，否則 fit
            if (st.dsA && st.dsB) fitImage();
            else if (!other) fitImage();
            else applyTransform();
            if (st.lineImage) {
                const ref = refDs();
                if (!ref || st.lineImage.x1 >= ref.width || st.lineImage.y1 >= ref.height) {
                    clearLine();
                }
            }
            renderColorbarFrom(ds);
            renderInfoBoth();
            updateStatusMeta();
            updateLineButtons();
            syncLineOverlays();
            if (st.lineImage) recomputeProfiles();
            el.status.textContent = t('statusLoaded', ds.filename || '', ds.width, ds.height);
            showToast(t('ovLoadedSide', side.toUpperCase(), ds.filename || ''), 'info');
            return true;
        } catch (err) {
            console.error(err);
            el.status.textContent = t('statusReadFailed', err.message);
            showToast(t('statusReadFailed', err.message), 'error');
            return false;
        } finally {
            hideProgress();
        }
    }

    /** 一次載入兩張圖並分配至 A／B；須同尺寸 */
    async function loadPair(fileA, fileB) {
        if (!fileA || !fileB) return false;
        el.status.textContent = t('statusReading', fileA.name);
        setProgress(0);
        try {
            const dsA = await parseHeightFile(fileA);
            el.status.textContent = t('statusReading', fileB.name);
            setProgress(0);
            const dsB = await parseHeightFile(fileB);
            if (dsA.width !== dsB.width || dsA.height !== dsB.height) {
                const msg = t('ovStatusSizeMismatch',
                    dsA.width, dsA.height, dsB.width, dsB.height);
                showToast(msg, 'error');
                el.status.textContent = msg;
                return false;
            }
            await applyLoadedSide('a', dsA);
            await applyLoadedSide('b', dsB);
            afterLoadRefresh(dsA);
            el.status.textContent = t('statusLoaded',
                `${dsA.filename || ''} / ${dsB.filename || ''}`, dsA.width, dsA.height);
            showToast(t('ovLoadedPair', dsA.filename || '', dsB.filename || ''), 'info');
            return true;
        } catch (err) {
            console.error(err);
            el.status.textContent = t('statusReadFailed', err.message);
            showToast(t('statusReadFailed', err.message), 'error');
            return false;
        } finally {
            hideProgress();
        }
    }

    /** 拖放／選檔：1 張進該側；≥2 張取前 2 分配到 A／B */
    async function handleIncomingFiles(side, fileList) {
        const picked = pickOvFiles(fileList);
        if (picked.truncated) showToast(t('ovDropTakeFirst2'), 'info');
        if (picked.files.length >= 2) {
            await loadPair(picked.files[0], picked.files[1]);
            return;
        }
        if (picked.files.length === 1) {
            await loadSide(side, picked.files[0]);
            return;
        }
        // 無支援副檔名時，仍走單檔載入以顯示明確錯誤
        if (picked.firstAny) await loadSide(side, picked.firstAny);
    }

    function clearSide(side) {
        setDs(side, null);
        clearSideVisual(side);
        if (!anyReady()) {
            clearLine();
            st.view = { scale: 1, tx: 0, ty: 0 };
            if (el.infoList) el.infoList.innerHTML = '';
            if (el.zMin) el.zMin.textContent = '-';
            if (el.zMax) el.zMax.textContent = '-';
            if (el.status) el.status.textContent = t('statusIdle');
        } else {
            // 另一側仍在：重新 fit，並清除可能越界的剖線
            if (st.lineImage && !bothReady()) clearLine();
            fitImage();
            renderColorbarFrom(refDs());
            renderInfoBoth();
        }
        updateStatusMeta();
        updateLineButtons();
        syncLineOverlays();
        if (sides[side].fileInput) sides[side].fileInput.value = '';
    }

    function clearAll() {
        st.dsA = null;
        st.dsB = null;
        clearSideVisual('a');
        clearSideVisual('b');
        clearLine();
        st.view = { scale: 1, tx: 0, ty: 0 };
        if (el.infoList) el.infoList.innerHTML = '';
        if (el.zMin) el.zMin.textContent = '-';
        if (el.zMax) el.zMax.textContent = '-';
        if (el.status) el.status.textContent = t('statusIdle');
        if (sides.a.fileInput) sides.a.fileInput.value = '';
        if (sides.b.fileInput) sides.b.fileInput.value = '';
        updateStatusMeta();
        updateLineButtons();
        syncLineOverlays();
    }

    function setupViewerSide(side) {
        const s = sides[side];
        if (!s.viewer || s.viewer.dataset.ovBound) return;
        s.viewer.dataset.ovBound = '1';

        const startPan = (e) => {
            e.preventDefault();
            s.viewer.setPointerCapture(e.pointerId);
            st.panning = true;
            st.panStart = { x: e.clientX, y: e.clientY, tx: st.view.tx, ty: st.view.ty, side };
            if (s.canvas) s.canvas.classList.add('grabbing');
        };

        s.viewer.addEventListener('wheel', (e) => {
            if (!st.active || !dsOf(side)) return;
            e.preventDefault();
            const rect = s.viewer.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
            let next = st.view.scale * factor;
            if (next < VIEW_MIN) next = VIEW_MIN;
            if (next > VIEW_MAX) next = VIEW_MAX;
            const imgX = (mx - st.view.tx) / st.view.scale;
            const imgY = (my - st.view.ty) / st.view.scale;
            st.view.scale = next;
            st.view.tx = mx - imgX * next;
            st.view.ty = my - imgY * next;
            applyTransform();
        }, { passive: false });

        s.viewer.addEventListener('pointerdown', (e) => {
            if (!st.active || !dsOf(side)) return;
            // 剖面模式：左鍵留給畫線／編輯，僅中鍵平移
            if (st.lineMode) {
                if (e.button === 1) startPan(e);
                return;
            }
            // 一般模式：左鍵或中鍵皆可平移
            if (e.button !== 0 && e.button !== 1) return;
            startPan(e);
        });

        s.viewer.addEventListener('pointermove', (e) => {
            if (!st.panning || !st.panStart) return;
            st.view.tx = st.panStart.tx + (e.clientX - st.panStart.x);
            st.view.ty = st.panStart.ty + (e.clientY - st.panStart.y);
            applyTransform();
        });

        const endPan = (e) => {
            if (!st.panning) return;
            st.panning = false;
            st.panStart = null;
            if (s.canvas) s.canvas.classList.remove('grabbing');
            try { s.viewer.releasePointerCapture(e.pointerId); } catch (_) {}
        };
        s.viewer.addEventListener('pointerup', endPan);
        s.viewer.addEventListener('pointercancel', endPan);

        s.viewer.addEventListener('auxclick', (e) => {
            // 防止中鍵觸發瀏覽器自動捲動
            if (e.button === 1) e.preventDefault();
        });

        s.viewer.addEventListener('dblclick', (e) => {
            if (!st.active || !dsOf(side)) return;
            e.preventDefault();
            fitImage();
        });

        // 拖曳載入
        s.viewer.addEventListener('dragenter', (e) => {
            if (!st.active || typeof dragHasFiles !== 'function' || !dragHasFiles(e)) return;
            e.preventDefault();
            st.dragDepth[side]++;
            s.viewer.classList.add('drag-over');
        });
        s.viewer.addEventListener('dragover', (e) => {
            if (!st.active || typeof dragHasFiles !== 'function' || !dragHasFiles(e)) return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        });
        s.viewer.addEventListener('dragleave', () => {
            st.dragDepth[side]--;
            if (st.dragDepth[side] <= 0) {
                st.dragDepth[side] = 0;
                s.viewer.classList.remove('drag-over');
            }
        });
        s.viewer.addEventListener('drop', async (e) => {
            if (!st.active || typeof dragHasFiles !== 'function' || !dragHasFiles(e)) return;
            e.preventDefault();
            st.dragDepth[side] = 0;
            s.viewer.classList.remove('drag-over');
            const files = e.dataTransfer?.files;
            if (!files || !files.length) return;
            await handleIncomingFiles(side, files);
        });
    }

    function setupLineOverlaySide(side) {
        const s = sides[side];
        const overlay = s.lineOverlay;
        if (!overlay || overlay.dataset.ovBound) return;
        overlay.dataset.ovBound = '1';

        const pt = (e) => {
            const r = s.viewer.getBoundingClientRect();
            return {
                x: Math.min(r.width, Math.max(0, e.clientX - r.left)),
                y: Math.min(r.height, Math.max(0, e.clientY - r.top)),
            };
        };

        const mouseToImg = (e) => {
            const p = pt(e);
            return viewportToImage(p.x, p.y);
        };

        const drawTempViewport = (p0, p1) => {
            for (const key of ['a', 'b']) {
                const ss = sides[key];
                if (!dsOf(key)) continue;
                ss.lineSeg.setAttribute('x1', p0.x);
                ss.lineSeg.setAttribute('y1', p0.y);
                ss.lineSeg.setAttribute('x2', p1.x);
                ss.lineSeg.setAttribute('y2', p1.y);
                if (ss.lineH0) { ss.lineH0.setAttribute('cx', p0.x); ss.lineH0.setAttribute('cy', p0.y); }
                if (ss.lineH1) { ss.lineH1.setAttribute('cx', p1.x); ss.lineH1.setAttribute('cy', p1.y); }
            }
        };

        const startPanFromOverlay = (e) => {
            e.preventDefault();
            e.stopPropagation();
            s.viewer.setPointerCapture(e.pointerId);
            st.panning = true;
            st.panStart = { x: e.clientX, y: e.clientY, tx: st.view.tx, ty: st.view.ty, side };
            if (s.canvas) s.canvas.classList.add('grabbing');
        };

        overlay.addEventListener('pointerdown', (e) => {
            if (!st.active || !dsOf(side) || !bothReady()) return;

            // 中鍵：平移（與點雲檢視剖面模式一致）
            if (e.button === 1) {
                startPanFromOverlay(e);
                return;
            }
            if (e.button !== 0) return;
            if (!st.lineMode) return;

            e.preventDefault();
            e.stopPropagation();
            overlay.setPointerCapture(e.pointerId);
            st.lineSource = side;
            const p = pt(e);
            const img = mouseToImg(e);

            // 已有剖線：優先編輯端點或整線
            if (st.lineImage) {
                const hit = lineHitTest(p.x, p.y);
                if (hit) {
                    st.lineAction = {
                        type: hit === 'move' ? 'move-line' : 'move-handle',
                        handle: hit === 'ep0' ? 0 : hit === 'ep1' ? 1 : null,
                        startImg: img,
                        orig: { ...st.lineImage },
                    };
                    overlay.style.cursor = hit === 'move' ? 'grabbing' : 'crosshair';
                    return;
                }
            }

            // 空白處：重新繪製剖面線
            st.lineAction = {
                type: 'draw',
                p0: p,
                startImg: img,
                revertLine: st.lineImage ? { ...st.lineImage } : null,
            };
            // 暫清圖表，即時顯示拉線
            st.profileA = null;
            st.profileB = null;
            clearMeasurePts();
            hideProfileTips();
            renderProfileCharts();
            drawTempViewport(p, p);
            overlay.style.cursor = 'crosshair';
        });

        overlay.addEventListener('pointermove', (e) => {
            // 剖面模式游標提示（未拖曳時）
            if (st.lineMode && !st.lineAction && !st.panning) {
                const p = pt(e);
                const hit = st.lineImage ? lineHitTest(p.x, p.y) : null;
                if (hit === 'ep0' || hit === 'ep1') overlay.style.cursor = 'pointer';
                else if (hit === 'move') overlay.style.cursor = 'move';
                else overlay.style.cursor = 'crosshair';
            }

            if (st.panning && st.panStart) {
                st.view.tx = st.panStart.tx + (e.clientX - st.panStart.x);
                st.view.ty = st.panStart.ty + (e.clientY - st.panStart.y);
                applyTransform();
                return;
            }

            if (!st.lineAction) return;
            const p = pt(e);
            const ds = refDs();
            if (!ds) return;
            const img = viewportToImage(p.x, p.y);

            if (st.lineAction.type === 'draw') {
                drawTempViewport(st.lineAction.p0, p);
            } else if (st.lineAction.type === 'move-handle') {
                const o = st.lineAction.orig;
                const dx = img.x - st.lineAction.startImg.x;
                const dy = img.y - st.lineAction.startImg.y;
                let L;
                if (st.lineAction.handle === 0) {
                    L = { x0: o.x0 + dx, y0: o.y0 + dy, x1: o.x1, y1: o.y1 };
                } else {
                    L = { x0: o.x0, y0: o.y0, x1: o.x1 + dx, y1: o.y1 + dy };
                }
                st.lineImage = clampLine(L, ds.width, ds.height);
                syncLineOverlays();
            } else if (st.lineAction.type === 'move-line') {
                const dx = img.x - st.lineAction.startImg.x;
                const dy = img.y - st.lineAction.startImg.y;
                const o = st.lineAction.orig;
                st.lineImage = clampLine({
                    x0: o.x0 + dx, y0: o.y0 + dy,
                    x1: o.x1 + dx, y1: o.y1 + dy,
                }, ds.width, ds.height);
                syncLineOverlays();
            }
        });

        overlay.addEventListener('pointerleave', () => {
            if (!st.lineAction && !st.panning && st.lineMode) {
                overlay.style.cursor = 'crosshair';
            }
        });

        const end = (e) => {
            if (st.panning && st.panStart) {
                st.panning = false;
                st.panStart = null;
                if (s.canvas) s.canvas.classList.remove('grabbing');
                try { s.viewer.releasePointerCapture(e.pointerId); } catch (_) {}
                return;
            }
            if (!st.lineAction) return;
            const act = st.lineAction;
            st.lineAction = null;
            try { overlay.releasePointerCapture(e.pointerId); } catch (_) {}

            if (act.type === 'draw') {
                const p = pt(e);
                commitLine(
                    viewportToImage(act.p0.x, act.p0.y),
                    viewportToImage(p.x, p.y),
                    { revertLine: act.revertLine }
                );
            } else {
                const L = st.lineImage;
                if (!L || Math.hypot(L.x1 - L.x0, L.y1 - L.y0) < MIN_LINE) {
                    if (act.orig) st.lineImage = { ...act.orig };
                }
                updateLineButtons();
                syncLineOverlays();
                recomputeProfiles();
                resetViewerCursors();
                if (st.lineMode) overlay.style.cursor = 'crosshair';
            }
        };
        overlay.addEventListener('pointerup', end);
        overlay.addEventListener('pointercancel', end);

        overlay.addEventListener('auxclick', (e) => {
            if (e.button === 1) e.preventDefault();
        });
    }

    function zoomChartAt(data, geom, focusDist, factor) {
        if (!data || !geom) return;
        const win = chartDistWindow(data);
        let span = win.span * factor;
        const minSpan = Math.max(win.full * 0.02, 1e-6);
        if (span < minSpan) span = minSpan;
        if (span > win.full) span = win.full;
        const ratio = win.span > 0 ? (focusDist - win.d0) / win.span : 0.5;
        let d0 = focusDist - ratio * span;
        let d1 = d0 + span;
        if (d0 < 0) { d1 -= d0; d0 = 0; }
        if (d1 > win.full) { d0 -= (d1 - win.full); d1 = win.full; }
        if (d0 < 0) d0 = 0;
        if (span >= win.full * 0.999) {
            st.chartView = { d0: 0, d1: null };
        } else {
            st.chartView = { d0, d1 };
        }
    }

    function setupProfileInteraction(side) {
        const s = sides[side];
        const canvas = s.profileCanvas;
        if (!canvas || canvas.dataset.ovBound) return;
        canvas.dataset.ovBound = '1';

        canvas.addEventListener('wheel', (e) => {
            const data = side === 'a' ? st.profileA : st.profileB;
            const geom = side === 'a' ? st.geomA : st.geomB;
            if (!data || !geom || data.N === 0) return;
            e.preventDefault();
            e.stopPropagation();
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const win = chartDistWindow(data);
            const focus = plotXToDist(mx, geom, win);
            const factor = e.deltaY < 0 ? 1 / 1.18 : 1.18;
            zoomChartAt(data, geom, focus, factor);
            renderProfileCharts();
        }, { passive: false });

        canvas.addEventListener('dblclick', (e) => {
            const data = side === 'a' ? st.profileA : st.profileB;
            if (!data) return;
            e.preventDefault();
            resetChartView();
            renderProfileCharts();
        });

        canvas.addEventListener('pointerdown', (e) => {
            const data = side === 'a' ? st.profileA : st.profileB;
            const geom = side === 'a' ? st.geomA : st.geomB;
            if (!data || !geom) return;
            // 中鍵，或非測量模式下的左鍵：平移（僅在已縮放時）
            const wantPan = (e.button === 1) || (e.button === 0 && !st.measureMode);
            if (!wantPan || !isChartZoomed(data)) return;
            e.preventDefault();
            canvas.setPointerCapture(e.pointerId);
            const win = chartDistWindow(data);
            st.chartPan = {
                side,
                x: e.clientX,
                d0: win.d0,
                d1: win.d1,
                span: win.span,
                plotW: geom.plotW,
            };
        });

        canvas.addEventListener('pointermove', (e) => {
            if (st.chartPan && st.chartPan.side === side) {
                const data = side === 'a' ? st.profileA : st.profileB;
                if (!data) return;
                const dx = e.clientX - st.chartPan.x;
                const deltaDist = -(dx / st.chartPan.plotW) * st.chartPan.span;
                let d0 = st.chartPan.d0 + deltaDist;
                let d1 = st.chartPan.d1 + deltaDist;
                const full = data.distPx || 1;
                if (d0 < 0) { d1 -= d0; d0 = 0; }
                if (d1 > full) { d0 -= (d1 - full); d1 = full; }
                if (d0 < 0) d0 = 0;
                st.chartView = { d0, d1 };
                renderProfileCharts();
                return;
            }

            const data = side === 'a' ? st.profileA : st.profileB;
            const geom = side === 'a' ? st.geomA : st.geomB;
            if (!data || !geom || data.N === 0) return;

            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            let idx;
            if (st.measureMode) {
                idx = chartPickIndex(side, mx, my);
                st.hoverIndex = idx;
                st.hoverSide = side;
                renderProfileCharts();
                if (idx != null) showProfileTip(side, e, tipHtmlFor(side, idx));
                else hideProfileTips();
                return;
            }

            const win = chartDistWindow(data);
            let frac = (mx - geom.padL) / geom.plotW;
            if (frac < 0) frac = 0; else if (frac > 1) frac = 1;
            idx = nearestDistIndex(data.dist, win.d0 + frac * win.span);

            st.hoverIndex = idx;
            st.hoverSide = side;
            renderProfileCharts();
            showProfileTip(side, e, tipHtmlFor(side, idx));

            // 另一側同步顯示對應高度
            const other = side === 'a' ? 'b' : 'a';
            const otherData = other === 'a' ? st.profileA : st.profileB;
            const otherTip = sides[other].profileTip;
            const otherCanvas = sides[other].profileCanvas;
            const otherPanel = sides[other].profilePanel;
            if (otherData && otherTip && otherCanvas && otherPanel?.classList.contains('show') && idx < otherData.N) {
                otherTip.innerHTML = tipHtmlFor(other, idx);
                otherTip.classList.add('show');
                const oGeom = other === 'a' ? st.geomA : st.geomB;
                if (oGeom) {
                    const oWin = oGeom.win || chartDistWindow(otherData);
                    const px = distToPlotX(otherData.dist[idx], oGeom, oWin);
                    const plotRect = otherCanvas.parentElement.getBoundingClientRect();
                    let left = px + 12;
                    let top = oGeom.padT + 8;
                    const tw = otherTip.offsetWidth, th = otherTip.offsetHeight;
                    if (left + tw > plotRect.width - 4) left = px - tw - 12;
                    if (left < 2) left = 2;
                    if (top + th > plotRect.height - 4) top = Math.max(2, plotRect.height - th - 4);
                    otherTip.style.left = left + 'px';
                    otherTip.style.top = top + 'px';
                }
            }
        });

        const endPan = (e) => {
            if (!st.chartPan || st.chartPan.side !== side) return;
            st.chartPan = null;
            try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
        };
        canvas.addEventListener('pointerup', endPan);
        canvas.addEventListener('pointercancel', endPan);

        canvas.addEventListener('click', (e) => {
            if (!st.measureMode) return;
            if (st.chartPan) return;
            const data = side === 'a' ? st.profileA : st.profileB;
            const geom = side === 'a' ? st.geomA : st.geomB;
            if (!data || !geom || data.N === 0) return;
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const idx = chartPickIndex(side, mx, my);
            if (idx == null) return;
            if (st.measurePts.length >= 2) st.measurePts = [idx];
            else st.measurePts.push(idx);
            st.hoverIndex = null;
            renderProfileCharts();
            showProfileTip(side, e, tipHtmlFor(side, idx));
        });

        canvas.addEventListener('pointerleave', () => {
            if (st.chartPan && st.chartPan.side === side) return;
            if (st.hoverSide !== side && st.hoverIndex != null) return;
            st.hoverIndex = null;
            st.hoverSide = null;
            hideProfileTips();
            renderProfileCharts();
        });

        canvas.addEventListener('auxclick', (e) => {
            if (e.button === 1) e.preventDefault();
        });
    }

    function bindUi() {
        if (st.bound) return;
        st.bound = true;

        for (const side of ['a', 'b']) {
            const s = sides[side];
            if (s.fileInput) {
                s.fileInput.addEventListener('change', async (e) => {
                    const files = e.target.files;
                    if (files && files.length) await handleIncomingFiles(side, files);
                    s.fileInput.value = '';
                });
            }
            if (s.btnClear) s.btnClear.addEventListener('click', () => clearSide(side));
            if (s.profileClear) s.profileClear.addEventListener('click', clearLine);
            if (s.chartStyle) {
                s.chartStyle.addEventListener('click', (e) => {
                    const btn = e.target.closest('button[data-ov-chart]');
                    if (!btn) return;
                    const style = btn.getAttribute('data-ov-chart');
                    if (style !== 'line' && style !== 'dots' || style === chartStyle) return;
                    chartStyle = style;
                    if (typeof setUserPref === 'function') setUserPref('profileChartStyle', style);
                    syncChartStyleUI();
                    renderProfileCharts();
                });
            }
            if (s.measureBtn) {
                s.measureBtn.addEventListener('click', () => {
                    setMeasureMode(!st.measureMode);
                });
            }
            setupViewerSide(side);
            setupLineOverlaySide(side);
            setupProfileInteraction(side);
        }

        syncChartStyleUI();
        syncMeasureUI();

        if (el.btnLine) {
            el.btnLine.addEventListener('click', () => {
                if (!bothReady()) return;
                setLineMode(!st.lineMode);
            });
        }
        if (el.btnLineH) el.btnLineH.addEventListener('click', () => setDefaultMidLine('h'));
        if (el.btnLineV) el.btnLineV.addEventListener('click', () => setDefaultMidLine('v'));
        if (el.btnLineClear) el.btnLineClear.addEventListener('click', clearLine);

        window.addEventListener('resize', () => {
            if (!st.active) return;
            if (anyReady()) applyTransform();
            if (st.lineImage) renderProfileCharts();
        });
    }

    function setActive(on) {
        st.active = !!on;
        if (el.workspace) el.workspace.hidden = !st.active;
        if (el.panel) el.panel.hidden = !st.active;
        if (!st.active) {
            st.lineMode = false;
            st.panning = false;
            updateLineButtons();
            syncLineOverlays();
            return;
        }
        bindUi();
        updateStatusMeta();
        updateLineButtons();
        syncLineOverlays();
        requestAnimationFrame(() => {
            if (anyReady()) {
                fitImage();
                if (st.lineImage) recomputeProfiles();
            }
            renderInfoBoth();
            if (refDs()) renderColorbarFrom(refDs());
        });
    }

    function onColormapChange() {
        if (!st.active) return;
        if (st.dsA) renderPixels('a');
        if (st.dsB) renderPixels('b');
        applyTransform();
        if (refDs()) renderColorbarFrom(refDs());
    }

    function refit() {
        if (!st.active || !anyReady()) return;
        fitImage();
        if (st.lineImage) renderProfileCharts();
    }

    function syncLang() {
        if (!st.active) return;
        updateStatusMeta();
        updateLineButtons();
        if (st.lineImage) recomputeProfiles();
        else renderInfoBoth();
        if (!anyReady() && el.status) el.status.textContent = t('statusIdle');
    }

    function hasData() { return anyReady(); }

    return {
        setActive,
        clearAll,
        clearSide,
        hasData,
        onColormapChange,
        refit,
        syncLang,
        isActive: () => st.active,
    };
})();
