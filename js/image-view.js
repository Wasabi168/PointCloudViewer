/**
 * 可重用影像檢視元件
 * 依賴：render.js, webgl-3d.js, colormap.js, uni-level.js, profile-poly.js
 * 匯出（全域）：createImageView()
 */
/* =========================================================================
 *  6. 可重用影像檢視元件 (createImageView) — 供「點雲編輯器」使用
 *     行為 / 樣式與點雲檢視器一致：讀檔、儲存、色彩、2D 影像顯示、拖曳載入
 * ========================================================================= */
function createImageView(ids, options) {
    options = options || {};
    const el = {};
    for (const k in ids) el[k] = document.getElementById(ids[k]);

    const SCATTER_R_DEFAULT = 1;
    const SCATTER_R_MIN = 0.5;
    const SCATTER_R_MAX = 12;
    const st = {
        dataset: null,
        view: { scale: 1, tx: 0, ty: 0, minScale: 0.02, maxScale: 100 },
        colorClip: { lo: 0, hi: 1 },
        scatterPointRadius: SCATTER_R_DEFAULT,
        sc: {
            centerX: 0, centerY: 0, worldPerPx: 1, baseWorldPerPx: 1,
            screenW: 1, screenH: 1, minWorldPerPx: 1e-6, maxWorldPerPx: 1e9,
        },
        panning: false, panStart: null, dragDepth: 0, scatterRedrawQueued: false,
        edit: {
            cropMode: null,      // null | 'rect' | 'circle'
            cropSel: null,       // { x0, y0, x1, y1 } 視埠座標
            cropAction: null,    // 進行中的操作：{ type:'draw'|'move'|'resize', ... }
            denoise: false,
            denoiseBase: null,   // 啟用刪除雜點時的資料快照
            uniLevel: false,
            uniLevelRunId: 0,
            uniLevelBase: null,
            uniLevelResult: null,
            uniLevelViews: null,
            uniLevelPan: null,
            uniLevelClip: null,
            uniLevelProbe: null,
            uniLevelApplyPending: false,
            uniLevelApplyRunning: false,
            uniLevelApplyRaf: 0,
            uniLevelFeedbackTimer: 0,
            profilePoly: false,
            profilePolyRunId: 0,
            profilePolyBase: null,
            profilePolyResult: null,
            profilePolyViews: null,
            profilePolyPan: null,
            profilePolyClip: null,
            profilePolyApplyPending: false,
            profilePolyApplyRunning: false,
            profilePolyApplyRaf: 0,
            segLevel: false,
            segLevelBusy: false,
            segLevelTuneBusy: false,
            segLevelRunId: 0,
            segLevelTuneRunId: 0,
            segLevelBase: null,
            segLevelResult: null,
            segLevelViews: null,
            segLevelPan: null,
            segLevelShowBounds: false,
            segLevelProbe: null,
            segLevelProbeRunId: 0,
            segLevelProbePending: false,
            segLevelProbeRunning: false,
            segSkew: false,
            segSkewBusy: false,
            segSkewTuneBusy: false,
            segSkewRunId: 0,
            segSkewTuneRunId: 0,
            segSkewBase: null,
            segSkewResult: null,
            segSkewViews: null,
            segSkewPan: null,
            segSkewShowBounds: false,
            medianFilter: false,
            medianFilterBusy: false,
            medianFilterRunId: 0,
            medianFilterBase: null,
            medianFilterResult: null,
            medianFilterViews: null,
            medianFilterPan: null,
            scatterGrid: false,
            scatterGridBusy: false,
            scatterGridRunId: 0,
            scatterGridBase: null,
            scatterGridResult: null,
            scatterGridViews: null,
            scatterGridPan: null,
            nanPatch: false,
            nanPatchBusy: false,
            nanPatchRunId: 0,
            nanPatchBase: null,
            nanPatchResult: null,
            nanPatchViews: null,
            nanPatchPan: null,
            nanPatchRoiMode: null,
            nanPatchRoi: null,
            nanPatchRoiSel: null,
            nanPatchRoiAction: null,
            roiLevel: false,
            roiLevelBusy: false,
            roiLevelRunId: 0,
            roiLevelBase: null,
            roiLevelResult: null,
            roiLevelViews: null,
            roiLevelPan: null,
            roiLevelRoiMode: null,
            roiLevelRoi: null,
            roiLevelRoiSel: null,
            roiLevelRoiAction: null,
            histLo: 0, histHi: 1,
            histAuto: false,   // 刪除雜點是否以自動（IQR）方式套用
            history: [],         // 編輯歷史（資料集快照）
            histIndex: -1,       // 目前所在的歷史索引
            lastEditStep: null,  // 最近一次可加入批次檔的編輯步驟
        },
    };

    const isScatter = (ds) => ds && ds.type === 'pcd-scatter';

    function setLastEditStep(step) {
        st.edit.lastEditStep = step;
        if (editing && typeof BatchFileManager !== 'undefined' && BatchFileManager.refreshLastEditHint) {
            BatchFileManager.refreshLastEditHint();
        }
    }

    /* ---- 進度 / 狀態 ---- */
    function setProgress(p) { el.progress.classList.add('show'); el.progressBar.style.width = (p * 100).toFixed(1) + '%'; }
    function hideProgress() { setTimeout(() => el.progress.classList.remove('show'), 300); }

    /* ---- 色階範圍 ---- */
    function effColorRange(ds) {
        const span = (ds.vmax - ds.vmin) || 1;
        const cmin = ds.vmin + st.colorClip.lo * span;
        const cmax = ds.vmin + st.colorClip.hi * span;
        return { cmin, crange: (cmax > cmin) ? (cmax - cmin) : 1e-12 };
    }

    function viewerSize() {
        return { w: Math.max(1, el.viewer.clientWidth), h: Math.max(1, el.viewer.clientHeight) };
    }

    /* ---- 散布點雲視埠 ---- */
    function fitScatter(ds) {
        const { w, h } = viewerSize();
        const pad = 24;
        const b = ds.bounds;
        const spanX = (b.xmax - b.xmin) || 1;
        const spanY = (b.ymax - b.ymin) || 1;
        const wpp = Math.max(spanX / Math.max(1, w - pad * 2), spanY / Math.max(1, h - pad * 2));
        const sc = st.sc;
        sc.screenW = w; sc.screenH = h;
        sc.centerX = (b.xmin + b.xmax) * 0.5;
        sc.centerY = (b.ymin + b.ymax) * 0.5;
        sc.worldPerPx = wpp; sc.baseWorldPerPx = wpp;
        sc.minWorldPerPx = wpp / 100; sc.maxWorldPerPx = wpp * 100;
    }
    function scWorldToScreen(wx, wy) {
        const sc = st.sc, halfW = sc.screenW * 0.5, halfH = sc.screenH * 0.5;
        return { sx: (wx - sc.centerX) / sc.worldPerPx + halfW, sy: (sc.centerY - wy) / sc.worldPerPx + halfH };
    }
    function scZoomAt(screenX, screenY, zoomFactor) {
        const sc = st.sc;
        const worldX = sc.centerX + (screenX - sc.screenW * 0.5) * sc.worldPerPx;
        const worldY = sc.centerY - (screenY - sc.screenH * 0.5) * sc.worldPerPx;
        let wpp = sc.worldPerPx / zoomFactor;
        if (wpp < sc.minWorldPerPx) wpp = sc.minWorldPerPx;
        if (wpp > sc.maxWorldPerPx) wpp = sc.maxWorldPerPx;
        sc.worldPerPx = wpp;
        sc.centerX = worldX - (screenX - sc.screenW * 0.5) * wpp;
        sc.centerY = worldY + (screenY - sc.screenH * 0.5) * wpp;
    }
    function renderScatter(ds, cmap) {
        const canvas = el.canvas;
        const ctx = canvas.getContext('2d');
        const { x, y, z } = ds;
        const n = z.length;
        const R = st.scatterPointRadius;
        const { w: sw, h: sh } = viewerSize();
        st.sc.screenW = sw; st.sc.screenH = sh;

        const dpr = window.devicePixelRatio || 1;
        const bw = Math.max(1, Math.round(sw * dpr));
        const bh = Math.max(1, Math.round(sh * dpr));
        canvas.width = bw; canvas.height = bh;
        canvas.style.width = '100%'; canvas.style.height = '100%';
        ctx.setTransform(1, 0, 0, 1, 0, 0);

        const img = ctx.createImageData(bw, bh);
        const px = img.data;
        fillMissingPixels(px);
        const lut = buildColormapLut(cmap);
        const { cmin, crange } = effColorRange(ds);
        const rBuf = R > 0 ? R * dpr : 0;

        for (let i = 0; i < n; i++) {
            const { sx, sy } = scWorldToScreen(x[i], y[i]);
            const ix = Math.round(sx), iy = Math.round(sy);
            if (ix < -R || iy < -R || ix > sw + R || iy > sh + R) continue;
            let t = (z[i] - cmin) / crange;
            if (t < 0) t = 0; else if (t > 1) t = 1;
            const lo = ((t * 255) | 0) * 3;
            const cr = lut[lo], cg = lut[lo + 1], cb = lut[lo + 2];
            if (R <= 0) stampPixel(px, bw, bh, Math.round(sx * dpr), Math.round(sy * dpr), cr, cg, cb);
            else stampDisk(px, bw, bh, sx * dpr, sy * dpr, rBuf, cr, cg, cb);
        }
        ctx.putImageData(img, 0, 0);
    }
    function requestScatterRedraw() {
        if (!isScatter(st.dataset) || st.scatterRedrawQueued) return;
        st.scatterRedrawQueued = true;
        requestAnimationFrame(() => {
            st.scatterRedrawQueued = false;
            if (!isScatter(st.dataset)) return;
            renderScatter(st.dataset, el.colormap.value);
            applyTransform();
        });
    }

    /* ---- 點陣影像渲染 ---- */
    function renderPixels(ds, cmap) {
        const canvas = el.canvas;
        const ctx = canvas.getContext('2d');
        const { data, width, height } = ds;
        canvas.width = width; canvas.height = height;
        const img = ctx.createImageData(width, height);
        const { cmin, crange } = effColorRange(ds);
        const lut = buildColormapLut(cmap);
        const px = img.data;
        for (let i = 0; i < data.length; i++) {
            const po = i * 4;
            const v = data[i];
            if (!Number.isFinite(v)) { paintMissingPixel(px, po); continue; }
            let t = (v - cmin) / crange;
            if (t < 0) t = 0; else if (t > 1) t = 1;
            const lo = ((t * 255) | 0) * 3;
            px[po] = lut[lo]; px[po + 1] = lut[lo + 1]; px[po + 2] = lut[lo + 2]; px[po + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
    }

    function applyTransform() {
        const canvas = el.canvas, ind = el.zoomIndicator;
        if (isScatter(st.dataset)) {
            canvas.style.transform = 'none';
            const pct = (st.sc.baseWorldPerPx / st.sc.worldPerPx) * 100;
            ind.textContent = (pct >= 100 ? pct.toFixed(0) : pct.toFixed(1)) + '%';
            if (st.redrawTools) st.redrawTools();
            return;
        }
        canvas.style.transform = `translate(${st.view.tx}px, ${st.view.ty}px) scale(${st.view.scale})`;
        ind.textContent = (st.view.scale * 100).toFixed(st.view.scale >= 1 ? 0 : 1) + '%';
        if (st.redrawTools) st.redrawTools();
    }

    function fitImage() {
        if (!st.dataset) return;
        if (isScatter(st.dataset)) { fitScatter(st.dataset); renderScatter(st.dataset, el.colormap.value); applyTransform(); return; }
        const { w: vw, h: vh } = viewerSize();
        const w = st.dataset.width, h = st.dataset.height, padding = 24;
        // 盡量填滿視埠；小尺寸網格（如網格化後 21×21）不再硬性上限 8，以免還原後縮在中央
        let s = Math.min((vw - padding * 2) / w, (vh - padding * 2) / h);
        if (!(s > 0)) s = 1;
        if (s > st.view.maxScale) s = st.view.maxScale;
        if (s < st.view.minScale) s = st.view.minScale;
        st.view.scale = s;
        st.view.tx = (vw - w * st.view.scale) / 2;
        st.view.ty = (vh - h * st.view.scale) / 2;
        applyTransform();
    }

    function render(ds, cmap, resetView = false) {
        const canvas = el.canvas;
        if (isScatter(ds)) {
            canvas.classList.add('scatter-view');
            renderScatter(ds, cmap);
        } else {
            canvas.classList.remove('scatter-view');
            canvas.style.width = ''; canvas.style.height = '';
            renderPixels(ds, cmap);
        }
        canvas.style.display = 'block';
        el.placeholder.style.display = 'none';
        el.zoomIndicator.classList.add('show');
        el.zoomHint.classList.add('show');
        if (resetView) fitImage(); else applyTransform();
        if (st.refreshTools) st.refreshTools(true);
        renderColorbar(cmap);
        el.zMin.textContent = ds.vmin.toFixed(4);
        el.zMax.textContent = ds.vmax.toFixed(4);
        syncColorbarHandles();
    }

    /* ---- 色階列 ---- */
    function renderColorbar(cmap) {
        const cb = el.colorbarCanvas;
        const ctx = cb.getContext('2d');
        const w = cb.width, h = cb.height;
        const img = ctx.createImageData(w, h);
        const lo = st.colorClip.lo, hi = st.colorClip.hi;
        const span = (hi > lo) ? (hi - lo) : 1e-12;
        for (let x = 0; x < w; x++) {
            const f = x / (w - 1);
            let t = (f - lo) / span;
            if (t < 0) t = 0; else if (t > 1) t = 1;
            const [r, g, b] = sampleColormap(cmap, t);
            for (let y = 0; y < h; y++) {
                const p = (y * w + x) * 4;
                img.data[p] = Math.round(r * 255); img.data[p + 1] = Math.round(g * 255);
                img.data[p + 2] = Math.round(b * 255); img.data[p + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
    }
    function syncColorbarHandles() {
        const hLo = el.cbHandleLo, hHi = el.cbHandleHi;
        if (!hLo || !hHi) return;
        hLo.style.left = (st.colorClip.lo * 100) + '%';
        hHi.style.left = (st.colorClip.hi * 100) + '%';
        if (st.dataset) {
            const span = st.dataset.vmax - st.dataset.vmin;
            el.cbValLo.textContent = (st.dataset.vmin + st.colorClip.lo * span).toFixed(3);
            el.cbValHi.textContent = (st.dataset.vmin + st.colorClip.hi * span).toFixed(3);
        } else { el.cbValLo.textContent = ''; el.cbValHi.textContent = ''; }
    }
    function resetColorClip(rerender = true) {
        st.colorClip.lo = 0; st.colorClip.hi = 1;
        if (rerender && st.dataset) render(st.dataset, el.colormap.value, false);
        else syncColorbarHandles();
    }
    function setupColorbarHandles() {
        const track = el.colorbarTrack, hLo = el.cbHandleLo, hHi = el.cbHandleHi, resetBtn = el.cbReset;
        if (!track || !hLo || !hHi) return;
        const MIN_GAP = 0.01;
        let dragging = null, rafPending = false;
        const fracFromX = (clientX) => {
            const r = track.getBoundingClientRect();
            if (r.width <= 0) return 0;
            return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
        };
        const scheduleRender = () => {
            if (rafPending) return;
            rafPending = true;
            requestAnimationFrame(() => {
                rafPending = false;
                if (st.dataset) render(st.dataset, el.colormap.value, false); else syncColorbarHandles();
            });
        };
        const onMove = (e) => {
            if (!dragging) return;
            const f = fracFromX(e.clientX);
            if (dragging === 'lo') { st.colorClip.lo = Math.min(f, st.colorClip.hi - MIN_GAP); if (st.colorClip.lo < 0) st.colorClip.lo = 0; }
            else { st.colorClip.hi = Math.max(f, st.colorClip.lo + MIN_GAP); if (st.colorClip.hi > 1) st.colorClip.hi = 1; }
            scheduleRender();
        };
        const endDrag = () => {
            if (!dragging) return;
            (dragging === 'lo' ? hLo : hHi).classList.remove('dragging');
            dragging = null;
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', endDrag);
        };
        const startDrag = (which, handle, e) => {
            dragging = which; handle.classList.add('dragging'); e.preventDefault();
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', endDrag);
        };
        hLo.addEventListener('pointerdown', (e) => startDrag('lo', hLo, e));
        hHi.addEventListener('pointerdown', (e) => startDrag('hi', hHi, e));
        if (resetBtn) resetBtn.addEventListener('click', () => resetColorClip(true));
        syncColorbarHandles();
    }

    function formatPointSizeLabel(v) {
        const n = Number(v);
        if (!Number.isFinite(n)) return '-';
        return (Math.round(n * 10) / 10).toFixed(1);
    }

    function clampEditorPointSize(v) {
        const n = Number(v);
        if (!Number.isFinite(n)) return SCATTER_R_DEFAULT;
        return Math.min(SCATTER_R_MAX, Math.max(SCATTER_R_MIN, n));
    }

    function syncPointSizeControls() {
        if (!el.pointSizeAdjust || !el.pointSizeSlider || !el.pointSizeVal) return;
        const show = isScatter(st.dataset);
        el.pointSizeAdjust.hidden = !show;
        if (!show) return;
        el.pointSizeSlider.min = String(SCATTER_R_MIN);
        el.pointSizeSlider.max = String(SCATTER_R_MAX);
        el.pointSizeSlider.step = '0.1';
        el.pointSizeSlider.value = String(st.scatterPointRadius);
        el.pointSizeVal.textContent = formatPointSizeLabel(st.scatterPointRadius);
    }

    function resetPointSizeSession(opts) {
        opts = opts || {};
        st.scatterPointRadius = SCATTER_R_DEFAULT;
        if (opts.redraw && isScatter(st.dataset)) {
            requestScatterRedraw();
        }
        if (opts.sync !== false) syncPointSizeControls();
    }

    function setupPointSizeControls() {
        if (!el.pointSizeSlider) return;
        el.pointSizeSlider.addEventListener('input', () => {
            if (!isScatter(st.dataset)) return;
            st.scatterPointRadius = clampEditorPointSize(el.pointSizeSlider.value);
            if (el.pointSizeVal) el.pointSizeVal.textContent = formatPointSizeLabel(st.scatterPointRadius);
            requestScatterRedraw();
        });
        syncPointSizeControls();
    }

    const EDITABLE_UNIT_KEYS = new Set(['xunit', 'yunit', 'zunit', 'x-unit', 'y-unit', 'z-unit']);
    const ALLOWED_HEADER_UNITS = new Set(['nm', 'um', 'mm', 'cm']);
    const ALLOWED_Z_UNITS = new Set(['nm', 'um', 'mm', 'cm', '%']);

    function normalizeHeaderUnitInput(raw) {
        return String(raw || '').trim().toLowerCase().replace(/µ/g, 'u').replace(/[\[\]]/g, '');
    }

    function isZUnitKey(headerKey) {
        return headerKey === 'zunit' || headerKey === 'z-unit';
    }

    function isAllowedHeaderUnit(unit, headerKey) {
        const normalized = normalizeHeaderUnitInput(unit);
        const allowed = isZUnitKey(headerKey) ? ALLOWED_Z_UNITS : ALLOWED_HEADER_UNITS;
        return allowed.has(normalized);
    }

    function startHeaderUnitEdit(valSpan, headerKey, currentVal) {
        if (valSpan.querySelector('input')) return;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'info-unit-input';
        input.value = normalizeHeaderUnitInput(currentVal) || String(currentVal);
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('spellcheck', 'false');

        const finish = (commit) => {
            if (!input.isConnected) return;
            if (commit) {
                const normalized = normalizeHeaderUnitInput(input.value);
                if (!isAllowedHeaderUnit(normalized, headerKey)) {
                    showToast(t('unitInvalid'), 'error');
                } else if (normalized !== normalizeHeaderUnitInput(currentVal) && st.dataset?.header) {
                    st.dataset.header[headerKey] = normalized;
                }
            }
            const ds = st.dataset;
            if (!ds) return;
            const infoExtra = isScatter(ds) ? { pointCount: ds.pointCount } : null;
            renderInfo(ds.header, ds.width, ds.height, infoExtra);
        };

        valSpan.textContent = '';
        valSpan.appendChild(input);
        input.focus();
        input.select();

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); finish(true); }
            else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        });
        input.addEventListener('blur', () => finish(true));
    }

    function renderInfo(header, width, height, extra) {
        const list = el.infoList;
        list.innerHTML = '';
        const canEditUnits = editing && st.dataset && !isScatter(st.dataset);
        const addRow = (k, v) => {
            const row = document.createElement('div');
            row.className = 'info-row';
            const keySpan = document.createElement('span');
            keySpan.className = 'k';
            keySpan.textContent = k;
            const valSpan = document.createElement('span');
            valSpan.className = 'v';
            const strVal = String(v);
            const displayVal = strVal.length > 30 ? strVal.slice(0, 30) + '…' : v;
            if (canEditUnits && EDITABLE_UNIT_KEYS.has(k)) {
                valSpan.classList.add('info-unit-editable');
                valSpan.title = t(isZUnitKey(k) ? 'unitEditTitleZ' : 'unitEditTitle');
                valSpan.textContent = displayVal;
                valSpan.addEventListener('dblclick', (e) => {
                    e.preventDefault();
                    startHeaderUnitEdit(valSpan, k, strVal);
                });
            } else {
                valSpan.textContent = displayVal;
            }
            row.appendChild(keySpan);
            row.appendChild(valSpan);
            list.appendChild(row);
        };
        if (extra && extra.pointCount != null) {
            addRow(t('infoPcdPoints'), String(extra.pointCount));
            addRow(t('infoSize'), `${width} × ${height} (${t('infoPcdScatter')})`);
        } else {
            addRow(t('infoSize'), `${width} × ${height}`);
        }
        for (const [k, v] of Object.entries(header)) {
            if (v === '' || v == null) continue;
            addRow(k, v);
        }
    }

    /* ---- 載入檔案 ---- */
    async function loadFile(file) {
        if (!file) return;
        const ext = getExt(file.name);
        if (!SUPPORTED_EXTS.includes(ext)) {
            const msg = t('statusUnsupported', file.name, SUPPORTED_TEXT);
            el.status.textContent = msg; showToast(msg, 'error');
            return;
        }
        el.status.textContent = t('statusReading', file.name);
        setProgress(0);
        const edOpenLabel = el.fileInput ? el.fileInput.closest('label.file-btn') : null;
        setBusy(edOpenLabel, true);
        if (el.btnSave) el.btnSave.disabled = true;
        try {
            const result = await readDatasetByExt(ext, file, setProgress);
            const rangeSrc = result.type === 'pcd-scatter' ? result.z : result.data;
            const { vmin, vmax } = computeRange(rangeSrc);
            st.dataset = { ...result, vmin, vmax, filename: file.name, canvasEl: el.canvas };
            resetPointSizeSession({ sync: false });
            resetColorClip(false);
            render(st.dataset, el.colormap.value, true);
            const infoExtra = result.type === 'pcd-scatter' ? { pointCount: result.pointCount } : null;
            renderInfo(result.header, result.width, result.height, infoExtra);
            if (result.type === 'pcd-scatter') el.status.textContent = t('statusLoadedPcd', file.name, result.pointCount);
            else el.status.textContent = t('statusLoaded', file.name, result.width, result.height);
            if (typeof editAfterLoad === 'function') editAfterLoad();
            if (el.btnClear) el.btnClear.disabled = false;
            syncPointSizeControls();
        } catch (err) {
            if (isLoadCancelled(err)) {
                el.status.textContent = st.dataset
                    ? (st.dataset.type === 'pcd-scatter'
                        ? t('statusLoadedPcd', st.dataset.filename, st.dataset.pointCount)
                        : t('statusLoaded', st.dataset.filename, st.dataset.width, st.dataset.height))
                    : t('statusIdle');
            } else {
                console.error(err);
                el.status.textContent = t('statusReadFailed', err.message);
                showToast(t('statusReadFailed', err.message), 'error');
            }
        } finally {
            hideProgress();
            setBusy(edOpenLabel, false);
            if (el.btnSave) el.btnSave.disabled = false;
        }
    }

    /* ---- 儲存 ---- */
    const supportsSavePicker = (typeof window.showSaveFilePicker === 'function');
    if (supportsSavePicker && el.saveFormatItem) el.saveFormatItem.style.display = 'none';

    async function saveEditorDataset(dataset, extra) {
        extra = extra || {};
        if (!dataset) { showToast(t('toastNoData'), 'error'); return; }
        const range = effColorRange(extra.colorDataset || dataset);
        let began = false;
        try {
            const result = await commitDatasetSave(dataset, {
                preferred: el.saveFormat ? el.saveFormat.value : 'bcrf',
                onProgress: setProgress,
                nameSuffix: extra.nameSuffix || '',
                visual: {
                    liveCanvas: extra.useLiveCanvas === false ? null : el.canvas,
                    cmap: el.colormap.value,
                    cmin: extra.cmin != null ? extra.cmin : range.cmin,
                    crange: extra.crange != null ? extra.crange : range.crange,
                    viewCrop: !!extra.viewCrop,
                    bitmapCanvas: extra.bitmapCanvas || null,
                    bitmapViewport: extra.bitmapViewport || null,
                },
                onBegin(fullName) {
                    began = true;
                    el.btnSave.disabled = true;
                    setBusy(el.btnSave, true);
                    el.btnSave.title = t('btnSaving');
                    el.btnSave.setAttribute('aria-label', t('btnSaving'));
                    setProgress(0);
                    el.status.textContent = t('statusSaving', fullName);
                },
            });
            if (!result || result.cancelled) return;
            if (result.rejected) { showToast(t('savePcdScatter'), 'info'); return; }
            el.status.textContent = t('statusSaved', result.fullName);
            showToast(t('toastSaved', result.fullName), 'info');
        } catch (err) {
            console.error(err);
            el.status.textContent = t('statusSaveFailed', err.message);
            showToast(t('statusSaveFailed', err.message), 'error');
        } finally {
            hideProgress();
            if (began) {
                el.btnSave.disabled = false;
                setBusy(el.btnSave, false);
                el.btnSave.title = t('btnSave');
                el.btnSave.setAttribute('aria-label', t('btnSave'));
            }
        }
    }

    function gridSaveSource(data, width, height, vmin, vmax, clip, canvas, wrap, headerExtra) {
        if (!data || width < 1 || height < 1 || !st.dataset) return null;
        const stats = (Number.isFinite(vmin) && Number.isFinite(vmax))
            ? { vmin, vmax }
            : computeRange(data);
        const dr = segLevelDisplayRange(stats.vmin, stats.vmax, clip);
        const header = { ...(st.dataset.header || {}) };
        if (headerExtra) Object.assign(header, headerExtra);
        const ds = {
            filename: st.dataset.filename,
            header,
            data,
            width,
            height,
            vmin: stats.vmin,
            vmax: stats.vmax,
        };
        return {
            dataset: ds,
            canvas,
            viewport: wrap,
            scatter: null,
            cmin: dr.cmin,
            crange: dr.crange,
            useLiveCanvas: false,
        };
    }

    function scatterSaveSource(base, canvas, wrap) {
        if (!base || !base.z || !st.dataset) return null;
        const n = base.pointCount || base.z.length;
        const dr = segLevelDisplayRange(base.vmin, base.vmax, st.colorClip);
        return {
            dataset: {
                ...st.dataset,
                type: 'pcd-scatter',
                x: base.x,
                y: base.y,
                z: base.z,
                bounds: base.bounds ? { ...base.bounds } : st.dataset.bounds,
                vmin: base.vmin,
                vmax: base.vmax,
                pointCount: n,
                canvasEl: canvas,
                filename: st.dataset.filename,
            },
            canvas,
            viewport: wrap,
            scatter: null,
            scatterRaster: base,
            cmin: dr.cmin,
            crange: dr.crange,
            useLiveCanvas: false,
        };
    }

    /** 比對圖上的那一張：存的是畫面上的資料，不是尚未套用前的主圖 */
    function compareSaveSource(canvas, wrap) {
        const id = canvas && canvas.id;
        const ds = st.dataset;
        if (!id || !ds) return null;
        const clip = st.colorClip;
        const w = ds.width;
        const h = ds.height;
        if (id === 'edUniLevelBefore' && st.edit.uniLevelBase) {
            const b = st.edit.uniLevelBase;
            return gridSaveSource(b.data, w, h, b.vmin, b.vmax, uniLevelClipFor('before'), canvas, wrap);
        }
        if (id === 'edUniLevelAfter' && st.edit.uniLevelResult && st.edit.uniLevelResult.correctedData) {
            const data = st.edit.uniLevelResult.correctedData;
            return gridSaveSource(data, w, h, NaN, NaN, uniLevelClipFor('after'), canvas, wrap);
        }
        if (id === 'edProfilePolyBefore' && st.edit.profilePolyBase) {
            const b = st.edit.profilePolyBase;
            return gridSaveSource(b.data, w, h, b.vmin, b.vmax, profilePolyClipFor('before'), canvas, wrap);
        }
        if (id === 'edProfilePolyAfter' && st.edit.profilePolyResult && st.edit.profilePolyResult.correctedData) {
            const data = st.edit.profilePolyResult.correctedData;
            return gridSaveSource(data, w, h, NaN, NaN, profilePolyClipFor('after'), canvas, wrap);
        }
        if (id === 'edRoiLevelBefore' && st.edit.roiLevelBase) {
            const b = st.edit.roiLevelBase;
            return gridSaveSource(b.data, b.width || w, b.height || h, b.vmin, b.vmax, clip, canvas, wrap);
        }
        if (id === 'edRoiLevelAfter' && st.edit.roiLevelResult && st.edit.roiLevelResult.correctedData) {
            return gridSaveSource(st.edit.roiLevelResult.correctedData, w, h, NaN, NaN, clip, canvas, wrap);
        }
        if (id === 'edSegLevelBefore' && st.edit.segLevelBase) {
            const b = st.edit.segLevelBase;
            return gridSaveSource(b.data, w, h, b.vmin, b.vmax, segLevelClipFor('before'), canvas, wrap);
        }
        if (id === 'edSegLevelAfter' && st.edit.segLevelResult && st.edit.segLevelResult.correctedData) {
            return gridSaveSource(st.edit.segLevelResult.correctedData, w, h, NaN, NaN, segLevelClipFor('after'), canvas, wrap);
        }
        if (id === 'edSegSkewBefore' && st.edit.segSkewBase) {
            const b = st.edit.segSkewBase;
            return gridSaveSource(b.data, w, h, b.vmin, b.vmax, clip, canvas, wrap);
        }
        if (id === 'edSegSkewAfter' && st.edit.segSkewResult && st.edit.segSkewResult.correctedData) {
            return gridSaveSource(st.edit.segSkewResult.correctedData, w, h, NaN, NaN, clip, canvas, wrap);
        }
        if (id === 'edMedianFilterBefore' && st.edit.medianFilterBase) {
            const b = st.edit.medianFilterBase;
            return gridSaveSource(b.data, b.width || w, b.height || h, b.vmin, b.vmax, clip, canvas, wrap);
        }
        if (id === 'edMedianFilterAfter' && st.edit.medianFilterResult && st.edit.medianFilterResult.filteredData) {
            return gridSaveSource(st.edit.medianFilterResult.filteredData, w, h, NaN, NaN, clip, canvas, wrap);
        }
        if (id === 'edNanPatchBefore' && st.edit.nanPatchBase) {
            const b = st.edit.nanPatchBase;
            return gridSaveSource(b.data, b.width || w, b.height || h, b.vmin, b.vmax, clip, canvas, wrap);
        }
        if (id === 'edNanPatchAfter' && st.edit.nanPatchResult && st.edit.nanPatchResult.patchedData) {
            return gridSaveSource(st.edit.nanPatchResult.patchedData, w, h, NaN, NaN, clip, canvas, wrap);
        }
        if (id === 'edScatterGridBefore' && st.edit.scatterGridBase) {
            return scatterSaveSource(st.edit.scatterGridBase, canvas, wrap);
        }
        if (id === 'edScatterGridAfter' && st.edit.scatterGridResult && st.edit.scatterGridResult.data) {
            const r = st.edit.scatterGridResult;
            const headerExtra = {};
            if (r.xlength) {
                headerExtra.xlength = String(r.xlength);
                headerExtra['x-length'] = String(r.xlength);
            }
            if (r.ylength) {
                headerExtra.ylength = String(r.ylength);
                headerExtra['y-length'] = String(r.ylength);
            }
            return gridSaveSource(r.data, r.width, r.height, NaN, NaN, clip, canvas, wrap, headerExtra);
        }
        return null;
    }

    function editorImageUnderPointer(event) {
        const node = event.target;
        if (!(node instanceof Element) || !el.viewer.contains(node) || !st.dataset) return null;
        if (node.closest(IMAGE_CTX_SKIP)) return null;
        const wrap = node.closest('.seg-level-canvas-wrap');
        if (wrap) {
            const canvas = node instanceof HTMLCanvasElement ? node : wrap.querySelector('canvas');
            if (!canvas) return null;
            return compareSaveSource(canvas, wrap);
        }
        if (node.closest('.seg-level-compare, .seg-level-tune, .seg-level-config')) return null;
        const range = effColorRange(st.dataset);
        return {
            dataset: st.dataset,
            canvas: el.canvas,
            viewport: el.viewer,
            scatter: isScatter(st.dataset) ? st.sc : null,
            cmin: range.cmin,
            crange: range.crange,
            useLiveCanvas: true,
        };
    }

    function saveEditorFromMenu(kind, source) {
        if (!source || !source.dataset) {
            showToast(t('toastNoData'), 'error');
            return;
        }
        let target = source.dataset;
        const extra = {
            cmin: source.cmin,
            crange: source.crange,
            colorDataset: source.dataset,
            useLiveCanvas: source.useLiveCanvas !== false,
        };
        if (kind === 'view') {
            let cropped = null;
            if (source.scatterRaster) {
                const world = rasterVisibleWorld(source.scatterRaster, source.canvas, source.viewport);
                cropped = world
                    ? cropScatterDatasetToWorld(source.dataset, world.x0, world.x1, world.y0, world.y1)
                    : null;
                extra.bitmapCanvas = source.canvas;
                extra.bitmapViewport = source.viewport;
            } else {
                cropped = cropDatasetToVisible(source.dataset, source.canvas, source.viewport, source.scatter);
            }
            if (!cropped) {
                showToast(t('imgSaveViewEmpty'), 'error');
                return;
            }
            target = cropped;
            extra.nameSuffix = '_view';
            extra.viewCrop = cropped !== source.dataset || !!source.scatterRaster;
        }
        saveEditorDataset(target, extra);
    }

    /* ---- 事件綁定 ---- */
    el.fileInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        await loadFile(file);
        el.fileInput.value = '';
    });

    el.viewer.addEventListener('dragenter', (e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        st.dragDepth++;
        el.viewer.classList.remove('drag-reject', 'drag-over');
        el.viewer.classList.add('drag-over');
        el.dropIcon.innerHTML = '&#x2B07;';
        el.dropText.textContent = t('dropSupported');
    });
    el.viewer.addEventListener('dragover', (e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    el.viewer.addEventListener('dragleave', (e) => {
        if (!dragHasFiles(e)) return;
        st.dragDepth--;
        if (st.dragDepth <= 0) { st.dragDepth = 0; el.viewer.classList.remove('drag-over', 'drag-reject'); }
    });
    el.viewer.addEventListener('drop', async (e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        st.dragDepth = 0;
        el.viewer.classList.remove('drag-over', 'drag-reject');
        const files = e.dataTransfer && e.dataTransfer.files;
        if (!files || files.length === 0) return;
        if (files.length > 1) showToast(t('toastMultiFile'), 'info');
        await loadFile(files[0]);
    });

    el.colormap.addEventListener('change', () => {
        setUserPref('edColormap', el.colormap.value);
        renderColorbar(el.colormap.value);
        if (st.dataset) {
            if (st.edit.segLevel) renderSegLevelCompare();
            else if (st.edit.uniLevel) renderUniLevelCompare();
            else if (st.edit.profilePoly) renderProfilePolyCompare();
            else if (st.edit.segSkew) renderSegSkewCompare();
            else if (st.edit.medianFilter) renderMedianFilterCompare();
            else if (st.edit.scatterGrid) renderScatterGridCompare();
            else if (st.edit.nanPatch) renderNanPatchCompare();
            else if (st.edit.roiLevel) renderRoiLevelCompare();
            else render(st.dataset, el.colormap.value, false);
        }
    });
    if (el.saveFormat) {
        el.saveFormat.addEventListener('change', () => {
            setUserPref('edSaveFormat', el.saveFormat.value);
        });
    }
    el.btnSave.addEventListener('click', () => {
        if (!st.dataset) { showToast(t('toastNoData'), 'error'); return; }
        const range = effColorRange(st.dataset);
        saveEditorFromMenu('full', {
            dataset: st.dataset,
            cmin: range.cmin,
            crange: range.crange,
            useLiveCanvas: true,
        });
    });
    el.viewer.addEventListener('contextmenu', (e) => {
        const source = editorImageUnderPointer(e);
        if (!source) return;
        e.preventDefault();
        openImageSaveMenu(e.clientX, e.clientY, (kind) => saveEditorFromMenu(kind, source));
    });
    if (el.btnClear) el.btnClear.addEventListener('click', clearData);

    el.viewer.addEventListener('wheel', (e) => {
        if (!st.dataset) return;
        e.preventDefault();
        const rect = el.viewer.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= el.viewer.clientHeight;
        const zoomFactor = Math.pow(1.0015, -dy);
        if (isScatter(st.dataset)) { scZoomAt(mx, my, zoomFactor); requestScatterRedraw(); return; }
        let newScale = st.view.scale * zoomFactor;
        if (newScale < st.view.minScale) newScale = st.view.minScale;
        if (newScale > st.view.maxScale) newScale = st.view.maxScale;
        const k = newScale / st.view.scale;
        st.view.tx = mx - (mx - st.view.tx) * k;
        st.view.ty = my - (my - st.view.ty) * k;
        st.view.scale = newScale;
        applyTransform();
    }, { passive: false });

    function beginViewPan(e) {
        st.panning = true;
        st.panStart = { x: e.clientX, y: e.clientY, tx: st.view.tx, ty: st.view.ty, cx: st.sc.centerX, cy: st.sc.centerY };
        el.canvas.classList.add('grabbing');
        e.preventDefault();
    }
    el.canvas.addEventListener('mousedown', (e) => {
        if (!st.dataset) return;
        if (st.toolPointerDown && st.toolPointerDown(e)) return;
        const mode = st.toolMode ? st.toolMode() : 'pan';
        const leftPan = e.button === 0 && mode === 'pan';
        const midPan = e.button === 1 && !!el.cursorToolbar && mode !== 'pan';
        if (!el.cursorToolbar) {
            if (e.button !== 0) return;
            beginViewPan(e);
            return;
        }
        if (!leftPan && !midPan) return;
        beginViewPan(e);
    });
    el.canvas.addEventListener('auxclick', (e) => {
        if (e.button === 1 && el.cursorToolbar) e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
        if (!st.panning) return;
        if (el.valueIndicator) el.valueIndicator.classList.remove('show');
        const dx = e.clientX - st.panStart.x, dy = e.clientY - st.panStart.y;
        if (isScatter(st.dataset)) {
            st.sc.centerX = st.panStart.cx - dx * st.sc.worldPerPx;
            st.sc.centerY = st.panStart.cy + dy * st.sc.worldPerPx;
            requestScatterRedraw();
            return;
        }
        st.view.tx = st.panStart.tx + dx;
        st.view.ty = st.panStart.ty + dy;
        applyTransform();
        if (st.redrawTools) st.redrawTools();
    });
    window.addEventListener('mouseup', () => {
        if (!st.panning) return;
        st.panning = false;
        el.canvas.classList.remove('grabbing');
    });

    el.viewer.addEventListener('dblclick', (e) => {
        if (!st.dataset) return;
        e.preventDefault();
        fitImage();
    });

    window.addEventListener('resize', () => {
        if (!st.dataset || el.viewer.clientWidth <= 0) return;
        if (isScatter(st.dataset)) { st.sc.screenW = el.viewer.clientWidth; st.sc.screenH = el.viewer.clientHeight; requestScatterRedraw(); }
        else fitImage();
        if (st.refreshTools) st.refreshTools(false);
    });

    setupImageViewTools();

    /* 編輯圖上的檢視工具列：拖曳 / 數值 / 剖面 / 距離 / 區域，行為對齊點雲檢視 */
    function setupImageViewTools() {
        if (!el.cursorToolbar || !el.overlay) return;
        const HIT = 10;
        const tool = {
            mode: 'pan',
            profile: null,
            profileData: null,
            measure: null,
            area: null,
            areaStats: null,
            drag: null,
            hover: null,
        };
        const saved = (typeof getUserPref === 'function') ? getUserPref('edCursorMode') : 'pan';
        if (saved === 'inspect' || saved === 'profile' || saved === 'measure' || saved === 'area' || saved === 'pan') {
            tool.mode = saved;
        }
        const chart = {
            data: null,
            geom: null,
            yView: null,
            hoverIndex: null,
            measureMode: false,
            measureSets: [],
            measurePts: [],
            measureDrag: null,
            hoverMeasure: null,
            halfW: 0,
            layouts: [],
            suppressClick: false,
        };

        function localOf(e) {
            const r = el.viewer.getBoundingClientRect();
            return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
        }
        function screenToData(mx, my) {
            if (isScatter(st.dataset)) {
                const sc = st.sc;
                sc.screenW = el.viewer.clientWidth;
                sc.screenH = el.viewer.clientHeight;
                return {
                    x: sc.centerX + (mx - sc.screenW * 0.5) * sc.worldPerPx,
                    y: sc.centerY - (my - sc.screenH * 0.5) * sc.worldPerPx,
                };
            }
            return { x: (mx - st.view.tx) / st.view.scale, y: (my - st.view.ty) / st.view.scale };
        }
        function dataToScreen(x, y) {
            if (isScatter(st.dataset)) {
                const s = scWorldToScreen(x, y);
                return { x: s.sx, y: s.sy };
            }
            return { x: x * st.view.scale + st.view.tx, y: y * st.view.scale + st.view.ty };
        }
        function clampData(p) {
            if (!st.dataset || isScatter(st.dataset)) return p;
            return {
                x: Math.max(0, Math.min(st.dataset.width - 1, p.x)),
                y: Math.max(0, Math.min(st.dataset.height - 1, p.y)),
            };
        }
        function distPointSeg(px, py, ax, ay, bx, by) {
            const dx = bx - ax, dy = by - ay;
            const len2 = dx * dx + dy * dy;
            if (len2 <= 0) return Math.hypot(px - ax, py - ay);
            let t = ((px - ax) * dx + (py - ay) * dy) / len2;
            if (t < 0) t = 0; else if (t > 1) t = 1;
            return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
        }
        function lineHit(line, mx, my) {
            if (!line) return null;
            const a = dataToScreen(line.x0, line.y0);
            const b = dataToScreen(line.x1, line.y1);
            if (Math.hypot(mx - a.x, my - a.y) <= HIT) return 'ep0';
            if (Math.hypot(mx - b.x, my - b.y) <= HIT) return 'ep1';
            if (distPointSeg(mx, my, a.x, a.y, b.x, b.y) <= HIT) return 'move';
            return null;
        }
        function areaNorm(r) {
            return { x0: Math.min(r.x0, r.x1), y0: Math.min(r.y0, r.y1), x1: Math.max(r.x0, r.x1), y1: Math.max(r.y0, r.y1) };
        }
        function areaHit(mx, my) {
            if (!tool.area || !tool.areaStats) return null;
            const n = areaNorm(tool.area);
            const corners = [
                ['tl', n.x0, n.y0], ['tr', n.x1, n.y0], ['bl', n.x0, n.y1], ['br', n.x1, n.y1],
            ];
            for (const c of corners) {
                const s = dataToScreen(c[1], c[2]);
                if (Math.hypot(mx - s.x, my - s.y) <= HIT) return c[0];
            }
            const tl = dataToScreen(n.x0, n.y0);
            const br = dataToScreen(n.x1, n.y1);
            const minX = Math.min(tl.x, br.x), maxX = Math.max(tl.x, br.x);
            const minY = Math.min(tl.y, br.y), maxY = Math.max(tl.y, br.y);
            if (mx >= minX && mx <= maxX && my >= minY && my <= maxY) return 'move';
            return null;
        }
        function sampleAt(x, y) {
            const ds = st.dataset;
            if (!ds) return NaN;
            if (isScatter(ds)) {
                const s = dataToScreen(x, y);
                const n = ds.z.length;
                const step = Math.max(1, Math.ceil(n / 25000));
                let best = Infinity, val = NaN;
                for (let i = 0; i < n; i += step) {
                    const p = scWorldToScreen(ds.x[i], ds.y[i]);
                    const d = (p.sx - s.x) * (p.sx - s.x) + (p.sy - s.y) * (p.sy - s.y);
                    if (d < best) { best = d; val = ds.z[i]; }
                }
                return best <= 12 * 12 ? val : NaN;
            }
            const px = Math.round(x), py = Math.round(y);
            if (px < 0 || py < 0 || px >= ds.width || py >= ds.height) return NaN;
            return ds.data[py * ds.width + px];
        }
        function lineDecor(line, width, height, withLabel) {
            const a = dataToScreen(line.x0, line.y0);
            const b = dataToScreen(line.x1, line.y1);
            const anchors = [
                { x: a.x, y: a.y, clearance: 12 },
                { x: b.x, y: b.y, clearance: 12 },
            ];
            let label = null;
            let text = '';
            if (withLabel) {
                const d = Math.hypot(line.x1 - line.x0, line.y1 - line.y0);
                const unit = isScatter(st.dataset) ? t('measureUnitWorld') : t('measureUnitPx');
                text = formatValue(d) + ' ' + unit;
                const ctx = el.overlay.getContext('2d');
                ctx.save();
                ctx.font = '12px Consolas, monospace';
                const tw = ctx.measureText(text).width + 10;
                ctx.restore();
                label = { x: (a.x + b.x) * 0.5 - tw * 0.5, y: (a.y + b.y) * 0.5 - 22, w: tw, h: 18 };
                anchors.push({ x: label.x + label.w, y: label.y + label.h / 2, clearance: 0 });
            }
            const anchor = markRightmostAnchor(anchors);
            const attached = markAttachDeleteButton(anchor.x, anchor.y, anchor.clearance, width, height);
            return { a, b, text, label, button: attached.button, bridge: attached.bridge };
        }
        function pointerOnLine(line, mx, my, withLabel) {
            if (!line || tool.drag) return null;
            const rect = el.viewer.getBoundingClientRect();
            const decor = lineDecor(line, rect.width, rect.height, withLabel);
            if (markPointInBox(mx, my, decor.button, 3)) return 'delete';
            if (markPointInBox(mx, my, decor.bridge, 0)) return 'body';
            if (decor.label && markPointInBox(mx, my, decor.label, 2)) return 'body';
            if (lineHit(line, mx, my)) return 'body';
            return null;
        }
        function drawLineMark(ctx, line, color, withLabel, hot) {
            const rect = el.viewer.getBoundingClientRect();
            const decor = lineDecor(line, rect.width, rect.height, withLabel);
            ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(decor.a.x, decor.a.y); ctx.lineTo(decor.b.x, decor.b.y);
            ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 4; ctx.stroke();
            ctx.beginPath(); ctx.moveTo(decor.a.x, decor.a.y); ctx.lineTo(decor.b.x, decor.b.y);
            ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
            for (const p of [decor.a, decor.b]) {
                ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
                ctx.fillStyle = color; ctx.fill();
                ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
            }
            if (decor.label) {
                ctx.font = '12px Consolas, monospace';
                ctx.fillStyle = 'rgba(0,0,0,0.72)';
                ctx.fillRect(decor.label.x, decor.label.y, decor.label.w, decor.label.h);
                ctx.fillStyle = color;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(decor.text, decor.label.x + decor.label.w / 2, decor.label.y + decor.label.h / 2);
                ctx.textAlign = 'left';
            }
            if (hot) drawMarkDeleteButton(ctx, decor.button, hot === 'delete');
        }
        function drawArea(ctx) {
            if (!tool.area) return;
            const n = areaNorm(tool.area);
            const tl = dataToScreen(n.x0, n.y0);
            const tr = dataToScreen(n.x1, n.y0);
            const br = dataToScreen(n.x1, n.y1);
            const bl = dataToScreen(n.x0, n.y1);
            ctx.beginPath();
            ctx.moveTo(tl.x, tl.y); ctx.lineTo(tr.x, tr.y); ctx.lineTo(br.x, br.y); ctx.lineTo(bl.x, bl.y); ctx.closePath();
            ctx.fillStyle = 'rgba(255, 180, 74, 0.15)';
            ctx.fill();
            ctx.setLineDash([5, 4]);
            ctx.strokeStyle = 'rgba(255, 180, 74, 0.85)'; ctx.lineWidth = 1.5; ctx.stroke();
            ctx.setLineDash([]);
            for (const p of [tl, tr, br, bl]) {
                ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
                ctx.fillStyle = '#ffb84a'; ctx.fill();
                ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
            }
        }
        function redrawOverlay() {
            const canvas = el.overlay;
            const rect = el.viewer.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            const bw = Math.max(1, Math.round(rect.width * dpr));
            const bh = Math.max(1, Math.round(rect.height * dpr));
            if (canvas.width !== bw) canvas.width = bw;
            if (canvas.height !== bh) canvas.height = bh;
            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, rect.width, rect.height);
            const any = tool.profile || tool.measure || tool.area;
            canvas.classList.toggle('show', !!any && !!st.dataset);
            if (!any || !st.dataset) return;
            const hot = (kind) => (!tool.drag && !st.panning && tool.hover && tool.hover.kind === kind) ? tool.hover.part : null;
            if (tool.area) drawArea(ctx);
            if (tool.measure) drawLineMark(ctx, tool.measure, '#3ecf8e', true, hot('measure'));
            if (tool.profile && chart.data && chart.data.scatter && chart.halfW > 0) drawProfileBand(ctx);
            if (tool.profile) drawLineMark(ctx, tool.profile, '#4f8cff', false, hot('profile'));
            if (tool.profile && chart.data) drawProfileSampleMarks(ctx);
        }
        function profileIndexPoint(i) {
            const d = chart.data;
            const L = tool.profile;
            if (!d || !L || i < 0 || i >= d.N) return null;
            if (d.scatter) return { x: d.wx[i], y: d.wy[i] };
            const tt = d.N > 1 ? i / (d.N - 1) : 0;
            return { x: L.x0 + (L.x1 - L.x0) * tt, y: L.y0 + (L.y1 - L.y0) * tt };
        }
        function drawProfileBand(ctx) {
            const L = tool.profile;
            const dx = L.x1 - L.x0, dy = L.y1 - L.y0;
            const len = Math.hypot(dx, dy);
            if (!(len > 0)) return;
            const nx = -dy / len, ny = dx / len;
            const hw = chart.halfW;
            const pts = [
                dataToScreen(L.x0 + nx * hw, L.y0 + ny * hw),
                dataToScreen(L.x1 + nx * hw, L.y1 + ny * hw),
                dataToScreen(L.x1 - nx * hw, L.y1 - ny * hw),
                dataToScreen(L.x0 - nx * hw, L.y0 - ny * hw),
            ];
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.closePath();
            ctx.fillStyle = 'rgba(79,140,255,0.15)';
            ctx.fill();
            ctx.setLineDash([5, 4]);
            ctx.strokeStyle = 'rgba(79,140,255,0.7)';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.setLineDash([]);
        }
        function drawProfileSampleMarks(ctx) {
            const ends = [];
            for (let s = 0; s < chart.measureSets.length; s++) {
                const style = profileMeasureSetStyle(s);
                const pts = chart.measureSets[s].pts;
                for (let k = 0; k < pts.length; k++) {
                    ends.push({ i: pts[k], color: style.colors[k % style.colors.length] });
                }
            }
            const draftStyle = profileMeasureSetStyle(chart.measureSets.length);
            for (let k = 0; k < chart.measurePts.length; k++) {
                ends.push({ i: chart.measurePts[k], color: draftStyle.colors[k % draftStyle.colors.length] });
            }
            for (const ep of ends) {
                const p = profileIndexPoint(ep.i);
                if (!p) continue;
                const s = dataToScreen(p.x, p.y);
                ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
                ctx.fillStyle = ep.color; ctx.fill();
                ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
            }
            if (chart.measureMode && chart.hoverIndex != null && !profileMeasureIndexTaken(chart.hoverIndex, chart)) {
                const p = profileIndexPoint(chart.hoverIndex);
                if (!p) return;
                const s = dataToScreen(p.x, p.y);
                ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255,210,74,0.55)'; ctx.fill();
                ctx.lineWidth = 1.5; ctx.strokeStyle = '#ffd24a'; ctx.stroke();
            }
        }
        function chartHasMeasures() {
            return chart.measureSets.length > 0 || chart.measurePts.length > 0;
        }
        function resetProfileChart() {
            chart.data = null;
            chart.geom = null;
            chart.yView = null;
            chart.hoverIndex = null;
            chart.measureMode = false;
            chart.measureSets = [];
            chart.measurePts = [];
            chart.measureDrag = null;
            chart.hoverMeasure = null;
            chart.layouts.length = 0;
            chart.suppressClick = false;
            if (el.profileTip) el.profileTip.classList.remove('show');
            if (el.profileCanvas) el.profileCanvas.style.cursor = '';
        }
        function syncEditorChartChrome(show) {
            const scatter = !!(show && chart.data && chart.data.scatter);
            if (el.profileBandWrap) el.profileBandWrap.style.display = scatter ? 'inline-flex' : 'none';
            if (el.profileChartStyleWrap) {
                el.profileChartStyleWrap.style.display = show ? 'inline-flex' : 'none';
                el.profileChartStyleWrap.querySelectorAll('button[data-profile-chart]').forEach((btn) => {
                    btn.classList.toggle('active', btn.getAttribute('data-profile-chart') === profileChartStyle);
                });
            }
            if (el.profileMeasureBtn) {
                el.profileMeasureBtn.style.display = show ? 'inline-flex' : 'none';
                el.profileMeasureBtn.classList.toggle('active', chart.measureMode);
                const atMax = chart.measureSets.length >= PROFILE_MEASURE_MAX_SETS;
                el.profileMeasureBtn.disabled = !chart.measureMode && atMax;
            }
            if (el.profileMeasureClearBtn) {
                el.profileMeasureClearBtn.style.display = show ? 'inline-flex' : 'none';
                const has = chartHasMeasures();
                el.profileMeasureClearBtn.disabled = !has;
                el.profileMeasureClearBtn.classList.toggle('has-measures', has);
            }
            const plot = el.profileCanvas && el.profileCanvas.parentElement;
            if (plot) plot.classList.toggle('measure-mode', !!(show && chart.measureMode));
        }
        function renderProfileChart() {
            const panel = el.profilePanel;
            const canvas = el.profileCanvas;
            chart.data = tool.profileData;
            if (!panel || !canvas) return;
            if (!tool.profile || !chart.data) {
                panel.classList.remove('show');
                syncEditorChartChrome(false);
                return;
            }
            panel.classList.add('show');
            syncEditorChartChrome(true);
            profilePaintFmt = { dataset: st.dataset, line: tool.profile };
            try {
                if (el.profileMeta) updateProfileMetaDisplay(chart.data, el.profileMeta, chart);
                paintProfileChart(canvas, chart, profileChartStyle, chart.layouts);
            } finally {
                profilePaintFmt = null;
            }
        }
        function recomputeProfile(resetMarks) {
            if (!tool.profile || !st.dataset) {
                tool.profileData = null;
                chart.data = null;
                return;
            }
            if (isScatter(st.dataset)) {
                if (!(chart.halfW > 0)) {
                    chart.halfW = 8 * st.sc.worldPerPx;
                    if (el.profileBand) el.profileBand.value = formatValue(chart.halfW * 2);
                }
                tool.profileData = sampleProfileScatter(tool.profile, chart.halfW, st.dataset);
                if (resetMarks && tool.profileData.N === 0) showToast(t('profileNoPoints'), 'info');
            } else {
                tool.profileData = sampleProfile(tool.profile, st.dataset);
                if (resetMarks && !tool.profileData.anyValid) showToast(t('profileNoValid'), 'info');
            }
            chart.data = tool.profileData;
            if (resetMarks) {
                chart.yView = null;
                chart.hoverIndex = null;
                chart.measureMode = false;
                chart.measureSets = [];
                chart.measurePts = [];
                chart.measureDrag = null;
                chart.hoverMeasure = null;
            } else {
                const n = chart.data.N;
                const ok = (i) => i >= 0 && i < n;
                chart.measureSets = chart.measureSets.filter((s) => s.pts.length === 2 && ok(s.pts[0]) && ok(s.pts[1]));
                chart.measurePts = chart.measurePts.filter(ok);
                if (chart.hoverIndex != null && !ok(chart.hoverIndex)) chart.hoverIndex = null;
            }
        }
        function showEditorChartTip(e, html) {
            if (!el.profileTip || !el.profileCanvas) return;
            el.profileTip.innerHTML = html;
            el.profileTip.classList.add('show');
            const plotRect = el.profileCanvas.parentElement.getBoundingClientRect();
            const tw = el.profileTip.offsetWidth, th = el.profileTip.offsetHeight;
            let left = (e.clientX - plotRect.left) + 12;
            let top = (e.clientY - plotRect.top) + 12;
            if (left + tw > plotRect.width - 4) left = (e.clientX - plotRect.left) - tw - 12;
            if (top + th > plotRect.height - 4) top = (e.clientY - plotRect.top) - th - 12;
            if (left < 2) left = 2;
            if (top < 2) top = 2;
            el.profileTip.style.left = left + 'px';
            el.profileTip.style.top = top + 'px';
        }
        function updateEditorMeasureTip(e) {
            const d = chart.data;
            if (!d) return;
            const n = chart.measurePts.length;
            const setNum = chart.measureSets.length + 1;
            if (n < 2) {
                const hint = n === 0 ? t('profileMeasurePick1Set', setNum) : t('profileMeasurePick2Set', setNum);
                showEditorChartTip(e, '<div>' + hint + '</div>');
                return;
            }
            profilePaintFmt = { dataset: st.dataset, line: tool.profile };
            try {
                const mr = profileMeasureResultFromPts(chart.measurePts, d);
                if (!mr) return;
                const stepUnit = profileMeasureStepUnit();
                showEditorChartTip(e,
                    '<div><span class="k">' + t('measureDist') + ':</span>' + formatProfileMeasureDistValue(mr, d) + '</div>' +
                    '<div><span class="k">' + t('profileMeasureStep') + ':</span>' + formatValue(mr.step) + (stepUnit ? ' ' + stepUnit : '') + '</div>');
            } finally {
                profilePaintFmt = null;
            }
        }
        function computeAreaStats(rect) {
            const n = areaNorm(rect);
            const ds = st.dataset;
            if (isScatter(ds)) {
                let count = 0, valid = 0, sum = 0, sumSq = 0, min = Infinity, max = -Infinity;
                const step = 1;
                for (let i = 0; i < ds.z.length; i += step) {
                    if (ds.x[i] < n.x0 || ds.x[i] > n.x1 || ds.y[i] < n.y0 || ds.y[i] > n.y1) continue;
                    count++;
                    const v = ds.z[i];
                    if (!Number.isFinite(v)) continue;
                    valid++; sum += v; sumSq += v * v;
                    if (v < min) min = v;
                    if (v > max) max = v;
                }
                if (!valid) { min = NaN; max = NaN; }
                const mean = valid ? sum / valid : NaN;
                const std = valid > 1 ? Math.sqrt(Math.max(0, (sumSq - sum * sum / valid) / (valid - 1))) : (valid === 1 ? 0 : NaN);
                return { count, valid, min, max, mean, std, w: n.x1 - n.x0, h: n.y1 - n.y0, scatter: true };
            }
            const ix0 = Math.max(0, Math.floor(n.x0)), ix1 = Math.min(ds.width - 1, Math.ceil(n.x1));
            const iy0 = Math.max(0, Math.floor(n.y0)), iy1 = Math.min(ds.height - 1, Math.ceil(n.y1));
            let count = 0, valid = 0, sum = 0, sumSq = 0, min = Infinity, max = -Infinity;
            for (let y = iy0; y <= iy1; y++) {
                for (let x = ix0; x <= ix1; x++) {
                    count++;
                    const v = ds.data[y * ds.width + x];
                    if (!Number.isFinite(v)) continue;
                    valid++; sum += v; sumSq += v * v;
                    if (v < min) min = v;
                    if (v > max) max = v;
                }
            }
            if (!valid) { min = NaN; max = NaN; }
            const mean = valid ? sum / valid : NaN;
            const std = valid > 1 ? Math.sqrt(Math.max(0, (sumSq - sum * sum / valid) / (valid - 1))) : (valid === 1 ? 0 : NaN);
            return { count, valid, min, max, mean, std, w: ix1 - ix0 + 1, h: iy1 - iy0 + 1, scatter: false };
        }
        function updateMeasurePanel() {
            if (!el.measurePanel || !el.measureMeta) return;
            let show = false;
            let title = t('measureTitle');
            let meta = '';
            if (tool.mode === 'measure' && tool.measure) {
                const d = Math.hypot(tool.measure.x1 - tool.measure.x0, tool.measure.y1 - tool.measure.y0);
                const unit = isScatter(st.dataset) ? t('measureUnitWorld') : t('measureUnitPx');
                title = t('cursorMeasure');
                meta = t('measureDist') + ': ' + formatValue(d) + ' ' + unit;
                const v0 = sampleAt(tool.measure.x0, tool.measure.y0);
                const v1 = sampleAt(tool.measure.x1, tool.measure.y1);
                if (Number.isFinite(v0) || Number.isFinite(v1)) {
                    meta += ' · V₀: ' + formatValue(v0) + ' · V₁: ' + formatValue(v1);
                }
                show = true;
            } else if (tool.mode === 'area' && tool.areaStats) {
                const s = tool.areaStats;
                title = t('cursorArea');
                meta = (s.scatter ? t('measureAreaPoints') : t('measureAreaPixels')) + ': ' + s.count +
                    ' · ' + t('measureAreaValid') + ': ' + s.valid +
                    ' · ' + t('measureAreaSize') + ': ' + formatValue(s.w) + '×' + formatValue(s.h) +
                    ' · Min: ' + formatValue(s.min) + ' · Max: ' + formatValue(s.max) +
                    ' · ' + t('measureMean') + ': ' + formatValue(s.mean) +
                    ' · ' + t('measureStd') + ': ' + formatValue(s.std);
                show = true;
            }
            if (el.measureTitle) el.measureTitle.textContent = title;
            el.measureMeta.textContent = meta;
            el.measurePanel.classList.toggle('show', show);
        }
        function updateChrome() {
            const show = !!st.dataset;
            el.cursorToolbar.classList.toggle('show', show);
            if (el.modeIndicator && el.modeIndicatorLabel) {
                const key = tool.mode === 'inspect' ? 'modeBadgeInspect'
                    : tool.mode === 'profile' ? 'modeBadgeProfile'
                    : tool.mode === 'measure' ? 'modeBadgeMeasure'
                    : tool.mode === 'area' ? 'modeBadgeArea'
                    : 'modeBadgePan';
                el.modeIndicatorLabel.textContent = t(key);
                el.modeIndicator.classList.toggle('show', show);
            }
        }
        function syncMode(mode) {
            if (mode !== 'pan' && mode !== 'inspect' && mode !== 'profile' && mode !== 'measure' && mode !== 'area') mode = 'pan';
            tool.mode = mode;
            if (typeof setUserPref === 'function') setUserPref('edCursorMode', mode);
            el.cursorToolbar.querySelectorAll('button[data-cursor]').forEach((b) => {
                b.classList.toggle('active', b.getAttribute('data-cursor') === mode);
            });
            el.canvas.classList.toggle('inspect-mode', mode === 'inspect');
            el.canvas.classList.toggle('profile-mode', mode === 'profile');
            el.canvas.classList.toggle('measure-mode', mode === 'measure');
            el.canvas.classList.toggle('area-mode', mode === 'area');
            if (mode !== 'inspect' && el.valueIndicator) el.valueIndicator.classList.remove('show');
            updateChrome();
            updateMeasurePanel();
        }
        function clearMarks() {
            tool.profile = null;
            tool.profileData = null;
            resetProfileChart();
            tool.measure = null;
            tool.area = null;
            tool.areaStats = null;
            tool.drag = null;
            tool.hover = null;
            if (el.valueIndicator) el.valueIndicator.classList.remove('show');
            renderProfileChart();
            updateMeasurePanel();
            updateChrome();
            redrawOverlay();
        }
        function refreshHover(mx, my) {
            if (tool.drag || st.panning) return;
            let next = null;
            const onProfile = pointerOnLine(tool.profile, mx, my, false);
            const onMeasure = pointerOnLine(tool.measure, mx, my, true);
            if (onMeasure === 'delete') next = { kind: 'measure', part: 'delete' };
            else if (onProfile === 'delete') next = { kind: 'profile', part: 'delete' };
            else if (onMeasure) next = { kind: 'measure', part: 'body' };
            else if (onProfile) next = { kind: 'profile', part: 'body' };
            const prev = tool.hover;
            const changed = (!prev !== !next) || (prev && next && (prev.kind !== next.kind || prev.part !== next.part));
            tool.hover = next;
            if (changed) redrawOverlay();
            if (next && next.part === 'delete') el.canvas.style.cursor = 'pointer';
            else if (tool.mode === 'profile' && tool.profile) {
                const hit = lineHit(tool.profile, mx, my);
                el.canvas.style.cursor = hit === 'move' ? 'move' : (hit ? 'pointer' : '');
            } else if (tool.mode === 'measure' && tool.measure) {
                const hit = lineHit(tool.measure, mx, my);
                el.canvas.style.cursor = hit === 'move' ? 'move' : (hit ? 'pointer' : '');
            } else if (tool.mode === 'area' && tool.areaStats) {
                const hit = areaHit(mx, my);
                el.canvas.style.cursor = hit === 'move' ? 'move' : (hit ? 'nwse-resize' : '');
            } else if (el.canvas.style.cursor === 'pointer' || el.canvas.style.cursor === 'move' || el.canvas.style.cursor === 'nwse-resize') {
                el.canvas.style.cursor = '';
            }
        }
        function showValue(e) {
            if (!el.valueIndicator || tool.mode !== 'inspect' || !st.dataset || st.panning) {
                if (el.valueIndicator) el.valueIndicator.classList.remove('show');
                return;
            }
            const loc = localOf(e);
            if (loc.x < 0 || loc.y < 0 || loc.x > loc.w || loc.y > loc.h) {
                el.valueIndicator.classList.remove('show');
                return;
            }
            const p = screenToData(loc.x, loc.y);
            let html = '';
            if (isScatter(st.dataset)) {
                const v = sampleAt(p.x, p.y);
                if (!Number.isFinite(v)) { el.valueIndicator.classList.remove('show'); return; }
                html = '<div><span class="k">' + t('valueWorldPos') + ':</span>(' + formatValue(p.x) + ', ' + formatValue(p.y) + ')</div>' +
                    '<div><span class="k">' + t('valueLabel') + ' (z):</span>' + formatValue(v) + '</div>';
            } else {
                const px = Math.floor(p.x), py = Math.floor(p.y);
                if (px < 0 || py < 0 || px >= st.dataset.width || py >= st.dataset.height) {
                    el.valueIndicator.classList.remove('show');
                    return;
                }
                html = '<div><span class="k">' + t('valuePos') + ':</span>(' + px + ', ' + py + ')</div>' +
                    '<div><span class="k">' + t('valueLabel') + ':</span>' + formatValue(st.dataset.data[py * st.dataset.width + px]) + '</div>';
            }
            el.valueIndicator.innerHTML = html;
            el.valueIndicator.classList.add('show');
            const pad = 14;
            let left = loc.x + pad, top = loc.y + pad;
            const iw = el.valueIndicator.offsetWidth, ih = el.valueIndicator.offsetHeight;
            if (left + iw > loc.w - 4) left = loc.x - iw - pad;
            if (top + ih > loc.h - 4) top = loc.y - ih - pad;
            el.valueIndicator.style.left = Math.max(4, left) + 'px';
            el.valueIndicator.style.top = Math.max(4, top) + 'px';
        }

        st.toolMode = () => tool.mode;
        st.redrawTools = redrawOverlay;
        st.clearTools = clearMarks;
        st.syncToolLang = () => { updateChrome(); updateMeasurePanel(); renderProfileChart(); };
        st.refreshTools = (recompute) => {
            updateChrome();
            if (recompute && tool.profile) recomputeProfile();
            if (recompute && tool.area) tool.areaStats = computeAreaStats(tool.area);
            renderProfileChart();
            updateMeasurePanel();
            redrawOverlay();
        };
        st.toolPointerDown = (e) => {
            if (!st.dataset || e.button !== 0) return false;
            if (e.target && e.target.closest && e.target.closest('.viewer-cursor-toolbar, .profile-panel, .measure-panel')) return true;
            const loc = localOf(e);
            const prof = pointerOnLine(tool.profile, loc.x, loc.y, false);
            const meas = pointerOnLine(tool.measure, loc.x, loc.y, true);
            if (meas === 'delete') { tool.measure = null; tool.hover = null; updateMeasurePanel(); redrawOverlay(); e.preventDefault(); return true; }
            if (prof === 'delete') {
                tool.profile = null; tool.profileData = null; tool.hover = null;
                resetProfileChart();
                renderProfileChart();
                redrawOverlay(); e.preventDefault(); return true;
            }
            if (tool.mode === 'profile') {
                const hit = lineHit(tool.profile, loc.x, loc.y);
                const p = clampData(screenToData(loc.x, loc.y));
                tool.hover = null;
                if (hit) tool.drag = { kind: 'profile', hit, origin: p, line: { ...tool.profile } };
                else if (prof === 'body') { e.preventDefault(); return true; }
                else tool.drag = { kind: 'profile-new', origin: p };
                if (!hit) tool.profile = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
                redrawOverlay();
                e.preventDefault();
                return true;
            }
            if (tool.mode === 'measure') {
                const hit = lineHit(tool.measure, loc.x, loc.y);
                const p = clampData(screenToData(loc.x, loc.y));
                tool.hover = null;
                if (hit) tool.drag = { kind: 'measure', hit, origin: p, line: { ...tool.measure } };
                else if (meas === 'body') { e.preventDefault(); return true; }
                else tool.drag = { kind: 'measure-new', origin: p };
                if (!hit) tool.measure = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
                redrawOverlay();
                e.preventDefault();
                return true;
            }
            if (tool.mode === 'area') {
                const hit = areaHit(loc.x, loc.y);
                const p = clampData(screenToData(loc.x, loc.y));
                tool.hover = null;
                if (hit) tool.drag = { kind: 'area', hit, origin: p, rect: { ...tool.area } };
                else {
                    tool.drag = { kind: 'area-new', origin: p };
                    tool.area = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
                    tool.areaStats = null;
                }
                redrawOverlay();
                e.preventDefault();
                return true;
            }
            refreshHover(loc.x, loc.y);
            return false;
        };

        el.cursorToolbar.querySelectorAll('button[data-cursor]').forEach((btn) => {
            btn.addEventListener('click', () => syncMode(btn.getAttribute('data-cursor')));
        });
        if (el.clearMarks) el.clearMarks.addEventListener('click', clearMarks);
        if (el.profileClear) el.profileClear.addEventListener('click', () => {
            tool.profile = null; tool.profileData = null; tool.hover = null;
            resetProfileChart();
            renderProfileChart();
            redrawOverlay();
        });
        if (el.profileChartStyleWrap) {
            el.profileChartStyleWrap.addEventListener('click', (e) => {
                const btn = e.target.closest('button[data-profile-chart]');
                if (!btn) return;
                const style = btn.getAttribute('data-profile-chart');
                if ((style !== 'line' && style !== 'dots') || style === profileChartStyle) return;
                profileChartStyle = style;
                if (typeof setUserPref === 'function') setUserPref('profileChartStyle', style);
                if (typeof syncProfileChartStyleUI === 'function') syncProfileChartStyleUI();
                renderProfileChart();
            });
        }
        if (el.profileMeasureBtn) {
            el.profileMeasureBtn.addEventListener('click', () => {
                if (chart.measureMode) {
                    chart.measureMode = false;
                    chart.measurePts = [];
                    chart.hoverIndex = null;
                    chart.measureDrag = null;
                    chart.hoverMeasure = null;
                } else {
                    if (chart.measureSets.length >= PROFILE_MEASURE_MAX_SETS) {
                        showToast(t('profileMeasureMaxSets', PROFILE_MEASURE_MAX_SETS), 'info');
                        return;
                    }
                    chart.measureMode = true;
                    chart.measurePts = [];
                    chart.hoverIndex = null;
                    chart.measureDrag = null;
                    chart.hoverMeasure = null;
                }
                if (el.profileTip) el.profileTip.classList.remove('show');
                renderProfileChart();
                redrawOverlay();
            });
        }
        if (el.profileMeasureClearBtn) {
            el.profileMeasureClearBtn.addEventListener('click', () => {
                if (!chartHasMeasures()) return;
                chart.measureSets = [];
                chart.measurePts = [];
                chart.measureMode = false;
                chart.hoverIndex = null;
                chart.measureDrag = null;
                chart.hoverMeasure = null;
                if (el.profileTip) el.profileTip.classList.remove('show');
                renderProfileChart();
                redrawOverlay();
            });
        }
        if (el.profileBand) {
            el.profileBand.addEventListener('input', () => {
                if (!isScatter(st.dataset) || !tool.profile) return;
                const full = parseFloat(el.profileBand.value);
                if (!Number.isFinite(full) || full < 0) return;
                chart.halfW = full / 2;
                recomputeProfile(true);
                renderProfileChart();
                redrawOverlay();
            });
        }
        if (el.profileMeta) {
            el.profileMeta.addEventListener('click', (e) => {
                const btn = e.target.closest('.profile-unit-toggle');
                if (!btn || !el.profileMeta.contains(btn)) return;
                e.preventDefault();
                profilePaintFmt = { dataset: st.dataset, line: tool.profile };
                let native = '';
                try { native = profileMeasureNativeDistUnit(chart.data); }
                finally { profilePaintFmt = null; }
                const cur = resolveProfileDistDisplayUnit(native) || native || 'mm';
                setProfileDistDisplayUnit(cycleLengthUnit(cur));
                renderProfileChart();
            });
        }
        if (el.measureClear) el.measureClear.addEventListener('click', () => {
            if (tool.mode === 'area') { tool.area = null; tool.areaStats = null; }
            else tool.measure = null;
            tool.hover = null;
            updateMeasurePanel();
            redrawOverlay();
        });
        el.viewer.addEventListener('mousemove', (e) => {
            if (!st.dataset || st.panning || tool.drag) return;
            const loc = localOf(e);
            if (e.target && e.target.closest && e.target.closest('.viewer-cursor-toolbar, .profile-panel, .measure-panel')) {
                if (tool.hover) { tool.hover = null; redrawOverlay(); }
                if (el.valueIndicator) el.valueIndicator.classList.remove('show');
                return;
            }
            refreshHover(loc.x, loc.y);
            showValue(e);
        });
        el.viewer.addEventListener('mouseleave', () => {
            if (el.valueIndicator) el.valueIndicator.classList.remove('show');
            if (tool.hover) { tool.hover = null; redrawOverlay(); }
        });
        window.addEventListener('mousemove', (e) => {
            if (!tool.drag || !st.dataset) return;
            const loc = localOf(e);
            const p = clampData(screenToData(loc.x, loc.y));
            const d = tool.drag;
            if (d.kind === 'profile-new') tool.profile = { x0: d.origin.x, y0: d.origin.y, x1: p.x, y1: p.y };
            else if (d.kind === 'measure-new') tool.measure = { x0: d.origin.x, y0: d.origin.y, x1: p.x, y1: p.y };
            else if (d.kind === 'area-new') tool.area = { x0: d.origin.x, y0: d.origin.y, x1: p.x, y1: p.y };
            else if (d.kind === 'profile' || d.kind === 'measure') {
                const dx = p.x - d.origin.x, dy = p.y - d.origin.y;
                let line = { ...d.line };
                if (d.hit === 'ep0') line = { ...line, x0: d.line.x0 + dx, y0: d.line.y0 + dy };
                else if (d.hit === 'ep1') line = { ...line, x1: d.line.x1 + dx, y1: d.line.y1 + dy };
                else line = { x0: d.line.x0 + dx, y0: d.line.y0 + dy, x1: d.line.x1 + dx, y1: d.line.y1 + dy };
                if (!isScatter(st.dataset)) {
                    const a = clampData({ x: line.x0, y: line.y0 });
                    const b = clampData({ x: line.x1, y: line.y1 });
                    line = { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
                }
                if (d.kind === 'profile') tool.profile = line;
                else tool.measure = line;
            } else if (d.kind === 'area') {
                const dx = p.x - d.origin.x, dy = p.y - d.origin.y;
                let r = { ...d.rect };
                if (d.hit === 'move') r = { x0: d.rect.x0 + dx, y0: d.rect.y0 + dy, x1: d.rect.x1 + dx, y1: d.rect.y1 + dy };
                else if (d.hit === 'tl') r = { x0: p.x, y0: p.y, x1: d.rect.x1, y1: d.rect.y1 };
                else if (d.hit === 'tr') r = { x0: d.rect.x0, y0: p.y, x1: p.x, y1: d.rect.y1 };
                else if (d.hit === 'bl') r = { x0: p.x, y0: d.rect.y0, x1: d.rect.x1, y1: p.y };
                else if (d.hit === 'br') r = { x0: d.rect.x0, y0: d.rect.y0, x1: p.x, y1: p.y };
                tool.area = r;
            }
            if (tool.mode === 'measure' || d.kind === 'measure' || d.kind === 'measure-new') updateMeasurePanel();
            redrawOverlay();
        });
        window.addEventListener('mouseup', () => {
            if (!tool.drag) return;
            const d = tool.drag;
            tool.drag = null;
            const minLen = isScatter(st.dataset) ? 3 * st.sc.worldPerPx : 1;
            if (d.kind === 'profile-new' || d.kind === 'profile') {
                const line = tool.profile;
                if (!line || Math.hypot(line.x1 - line.x0, line.y1 - line.y0) < minLen) {
                    if (d.line) tool.profile = { ...d.line };
                    else tool.profile = null;
                }
                recomputeProfile(true);
                renderProfileChart();
            }
            if (d.kind === 'measure-new' || d.kind === 'measure') {
                const line = tool.measure;
                if (!line || Math.hypot(line.x1 - line.x0, line.y1 - line.y0) < minLen) {
                    if (d.line) tool.measure = { ...d.line };
                    else tool.measure = null;
                }
            }
            if (d.kind === 'area-new' || d.kind === 'area') {
                const r = tool.area ? areaNorm(tool.area) : null;
                if (!r || (r.x1 - r.x0) < minLen || (r.y1 - r.y0) < minLen) {
                    if (d.rect) { tool.area = { ...d.rect }; tool.areaStats = computeAreaStats(d.rect); }
                    else { tool.area = null; tool.areaStats = null; }
                } else {
                    tool.area = r;
                    tool.areaStats = computeAreaStats(r);
                }
            }
            updateMeasurePanel();
            redrawOverlay();
        });
        if (el.profileCanvas) {
            const pc = el.profileCanvas;
            pc.addEventListener('wheel', (e) => {
                const d = chart.data, g = chart.geom;
                if (!d || !g || d.N === 0) return;
                const rect = pc.getBoundingClientRect();
                const mx = e.clientX - rect.left, my = e.clientY - rect.top;
                if (!isProfileYAxisHit(mx, my, g)) return;
                e.preventDefault();
                e.stopPropagation();
                zoomProfileYAt(d, g, my, e.deltaY < 0 ? 1 / 1.18 : 1.18, chart);
                renderProfileChart();
            }, { passive: false });
            pc.addEventListener('dblclick', (e) => {
                const d = chart.data, g = chart.geom;
                if (!d || !g) return;
                const rect = pc.getBoundingClientRect();
                const mx = e.clientX - rect.left, my = e.clientY - rect.top;
                if (!isProfileYAxisHit(mx, my, g)) return;
                e.preventDefault();
                e.stopPropagation();
                chart.yView = null;
                renderProfileChart();
            });
            pc.addEventListener('pointerdown', (e) => {
                if (e.button !== 0) return;
                const d = chart.data, g = chart.geom;
                if (!d || !g || d.N === 0 || !chartHasMeasures()) return;
                const rect = pc.getBoundingClientRect();
                const mx = e.clientX - rect.left, my = e.clientY - rect.top;
                if (isProfileYAxisHit(mx, my, g)) return;
                const mark = markMeasurePointer(chart.layouts, mx, my);
                if (mark && mark.part === 'delete') {
                    e.preventDefault();
                    chart.suppressClick = true;
                    if (mark.key === 'draft') chart.measurePts = [];
                    else if (typeof mark.key === 'number') chart.measureSets.splice(mark.key, 1);
                    chart.hoverMeasure = null;
                    chart.hoverIndex = null;
                    if (el.profileTip) el.profileTip.classList.remove('show');
                    renderProfileChart();
                    redrawOverlay();
                    return;
                }
                const hit = profileMeasureHitHandle(mx, my, chart);
                if (!hit) return;
                e.preventDefault();
                chart.measureDrag = { setKey: hit.setKey, ptIndex: hit.ptIndex, moved: false, pointerId: e.pointerId };
                chart.hoverIndex = null;
                chart.hoverMeasure = null;
                try { pc.setPointerCapture(e.pointerId); } catch (_) {}
                pc.style.cursor = 'grabbing';
                if (el.profileTip) el.profileTip.classList.remove('show');
            });
            pc.addEventListener('pointermove', (e) => {
                const drag = chart.measureDrag;
                if (!drag || drag.pointerId !== e.pointerId) return;
                const d = chart.data, g = chart.geom;
                if (!d || !g || d.N === 0) return;
                const rect = pc.getBoundingClientRect();
                const idx = profileChartNearestIndex(e.clientX - rect.left, e.clientY - rect.top, chart);
                if (idx == null) return;
                if (profileMeasureSetEndpoint(drag.setKey, drag.ptIndex, idx, chart)) {
                    drag.moved = true;
                    renderProfileChart();
                    redrawOverlay();
                }
                pc.style.cursor = 'grabbing';
            });
            const endDrag = (e) => {
                const drag = chart.measureDrag;
                if (!drag) return;
                if (e && drag.pointerId !== e.pointerId) return;
                if (drag.moved) chart.suppressClick = true;
                chart.measureDrag = null;
                try { if (e) pc.releasePointerCapture(e.pointerId); } catch (_) {}
                renderProfileChart();
                redrawOverlay();
            };
            pc.addEventListener('pointerup', endDrag);
            pc.addEventListener('pointercancel', endDrag);
            pc.addEventListener('click', (e) => {
                if (chart.suppressClick) { chart.suppressClick = false; return; }
                if (!chart.measureMode) return;
                const d = chart.data, g = chart.geom;
                if (!d || !g || d.N === 0) return;
                const rect = pc.getBoundingClientRect();
                const mx = e.clientX - rect.left, my = e.clientY - rect.top;
                if (isProfileYAxisHit(mx, my, g)) return;
                if (profileMeasureHitHandle(mx, my, chart)) return;
                const idx = profileChartPickIndex(mx, my, chart);
                if (idx == null) return;
                if (chart.measureSets.length >= PROFILE_MEASURE_MAX_SETS) {
                    chart.measureMode = false;
                    renderProfileChart();
                    showToast(t('profileMeasureMaxSets', PROFILE_MEASURE_MAX_SETS), 'info');
                    return;
                }
                chart.measurePts.push(idx);
                if (chart.measurePts.length >= 2) {
                    chart.measureSets.push({ pts: chart.measurePts.slice(0, 2) });
                    chart.measurePts = [];
                    chart.measureMode = false;
                }
                chart.hoverIndex = null;
                renderProfileChart();
                redrawOverlay();
                if (chart.measureMode) updateEditorMeasureTip(e);
                else if (el.profileTip) el.profileTip.classList.remove('show');
            });
            pc.addEventListener('mousemove', (e) => {
                if (chart.measureDrag) return;
                const d = chart.data, g = chart.geom;
                if (!d || !g || d.N === 0) return;
                const rect = pc.getBoundingClientRect();
                const mx = e.clientX - rect.left, my = e.clientY - rect.top;
                if (isProfileYAxisHit(mx, my, g)) {
                    pc.style.cursor = 'ns-resize';
                    chart.hoverIndex = null;
                    chart.hoverMeasure = null;
                    if (el.profileTip) el.profileTip.classList.remove('show');
                    renderProfileChart();
                    redrawOverlay();
                    return;
                }
                const mark = markMeasurePointer(chart.layouts, mx, my);
                const prev = chart.hoverMeasure;
                const same = prev && mark && prev.key === mark.key && prev.part === mark.part;
                if (mark) {
                    chart.hoverMeasure = mark;
                    pc.style.cursor = mark.part === 'delete' ? 'pointer' : (profileMeasureHitHandle(mx, my, chart) ? 'grab' : 'default');
                    chart.hoverIndex = null;
                    if (el.profileTip) el.profileTip.classList.remove('show');
                    if (!same) { renderProfileChart(); redrawOverlay(); }
                    return;
                }
                if (prev) chart.hoverMeasure = null;
                if (profileMeasureHitHandle(mx, my, chart)) {
                    pc.style.cursor = 'grab';
                    chart.hoverIndex = null;
                    if (el.profileTip) el.profileTip.classList.remove('show');
                    renderProfileChart();
                    redrawOverlay();
                    return;
                }
                pc.style.cursor = '';
                if (chart.measureMode) {
                    const idx = profileChartPickIndex(mx, my, chart);
                    chart.hoverIndex = idx;
                    renderProfileChart();
                    redrawOverlay();
                    if (idx != null) updateEditorMeasureTip(e);
                    else if (el.profileTip) el.profileTip.classList.remove('show');
                    return;
                }
                let frac = (mx - g.padL) / g.plotW;
                if (frac < 0) frac = 0; else if (frac > 1) frac = 1;
                const idx = nearestDistIndex(d.dist, frac * d.distPx);
                chart.hoverIndex = idx;
                renderProfileChart();
                const distLabel = d.scatter ? t('profileAxisDistWorld') : t('profileAxisDist');
                showEditorChartTip(e,
                    '<div><span class="k">' + distLabel + ':</span>' + formatValue(d.dist[idx]) + '</div>' +
                    '<div><span class="k">' + t('valueLabel') + ':</span>' + formatValue(d.vals[idx]) + '</div>');
            });
            pc.addEventListener('mouseleave', () => {
                if (chart.measureDrag) return;
                chart.hoverIndex = null;
                chart.hoverMeasure = null;
                if (el.profileTip) el.profileTip.classList.remove('show');
                pc.style.cursor = '';
                renderProfileChart();
                redrawOverlay();
            });
        }
        syncMode(tool.mode);
    }

    /* =====================================================================
     *  影像編輯：方形 / 圓形裁切、互動式刪除雜點（直方圖雙標籤）
     * ===================================================================== */
    const editing = !!(options.editing && el.cropRect && el.cropCircle && el.histCanvas);

    /* 將點陣資料轉為 Float32Array，使「刪除」可用 NaN 表示（整數陣列無法存 NaN） */
    function ensureFloatPixels(ds) {
        if (isScatter(ds)) return;
        if (!(ds.data instanceof Float32Array) && !(ds.data instanceof Float64Array)) {
            ds.data = Float32Array.from(ds.data);
        }
    }

    function recomputeScatterBounds(ds) {
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

    /* 統計目前資料集中有效資料點數 */
    function countPoints(ds) {
        if (isScatter(ds)) return ds.pointCount;
        let c = 0; const d = ds.data;
        for (let i = 0; i < d.length; i++) if (Number.isFinite(d[i])) c++;
        return c;
    }

    /* 編輯後刷新：重算數值範圍、色階、資訊與畫面 */
    function refreshAfterEdit(resetView) {
        const ds = st.dataset;
        const src = isScatter(ds) ? ds.z : ds.data;
        const { vmin, vmax } = computeRange(src);
        ds.vmin = vmin; ds.vmax = vmax;
        if (isScatter(ds) && ds.header) ds.header[t('infoPcdPoints')] = String(ds.pointCount);
        resetColorClip(false);
        render(ds, el.colormap.value, !!resetView);
        const infoExtra = isScatter(ds) ? { pointCount: ds.pointCount } : null;
        renderInfo(ds.header, ds.width, ds.height, infoExtra);
    }

    /** 設定工具按鈕啟用狀態與提示（disabled 時改寫到外層 tip host） */
    function setToolBtnState(btn, enabled, tip) {
        if (!btn) return;
        btn.disabled = !enabled;
        btn.setAttribute('aria-disabled', enabled ? 'false' : 'true');
        if (tip) {
            btn.title = tip;
            btn.setAttribute('aria-label', tip);
            const tipHost = btn.closest('.ed-tool-tip-host');
            if (tipHost) tipHost.title = tip;
        }
    }

    function updateEditButtons() {
        if (!editing) return;
        const has = !!st.dataset;
        const scatter = has && isScatter(st.dataset);
        const hasGrid = has && !scatter;
        // 散布／高度圖皆可用
        [el.cropRect, el.cropCircle, el.denoise, el.invertZ, el.globalLevel, el.sendMenu].forEach(b => { if (b) b.disabled = !has; });
        // 僅高度圖：散布點雲載入時停用並顯示不支援提示
        const heightOnlyTools = [
            { btn: el.medianFilter, tipKey: 'medianFilterTitle', scatterKey: 'medianFilterScatter' },
            { btn: el.nanPatch, tipKey: 'nanPatchTitle', scatterKey: 'nanPatchScatter' },
            { btn: el.uniLevel, tipKey: 'uniLevelTitle', scatterKey: 'uniLevelScatter' },
            { btn: el.profilePoly, tipKey: 'profilePolyTitle', scatterKey: 'profilePolyScatter' },
            { btn: el.roiLevel, tipKey: 'roiLevelTitle', scatterKey: 'roiLevelScatter' },
            { btn: el.segLevel, tipKey: 'segLevelTitle', scatterKey: 'segLevelScatter' },
            { btn: el.segSkew, tipKey: 'segSkewTitle', scatterKey: 'segSkewScatter' },
            { btn: el.btnCalc, tipKey: 'calcTitle', scatterKey: 'calcPcdScatter' },
        ];
        heightOnlyTools.forEach(({ btn, tipKey, scatterKey }) => {
            let tip = t(tipKey);
            if (scatter) tip = t(scatterKey);
            else if (!has) tip = t('editNoData');
            setToolBtnState(btn, hasGrid, tip);
        });
        // 傳送到分析／疊圖僅支援高度圖
        const sendHeightOnly = [
            { btn: el.sendToAnalysis, tipKey: 'sendToAnalysisTitle', scatterKey: 'anScatterUnsupported' },
            { btn: el.sendToOverlayA, tipKey: 'sendToOverlayATitle', scatterKey: 'ovScatterUnsupported' },
            { btn: el.sendToOverlayB, tipKey: 'sendToOverlayBTitle', scatterKey: 'ovScatterUnsupported' },
        ];
        sendHeightOnly.forEach(({ btn, tipKey, scatterKey }) => {
            let tip = t(tipKey);
            if (scatter) tip = t(scatterKey);
            else if (!has) tip = t('editNoData');
            setToolBtnState(btn, hasGrid, tip);
        });
        if (el.sendToViewer) {
            setToolBtnState(el.sendToViewer, has, has ? t('sendToViewerTitle') : t('editNoData'));
        }
        // 網格化僅適用散布點雲；已是高度圖（grid）時一律停用（含視覺反灰）
        const scatterGridBtn = el.scatterGrid || document.getElementById('edScatterGrid');
        const scatterGridTip = el.scatterGridTip || document.getElementById('edScatterGridTip');
        if (scatterGridBtn) {
            const canGridify = has && scatter;
            let tip = t('scatterGridTitle');
            if (has && !scatter) tip = t('scatterGridAlreadyGrid');
            else if (!has) tip = t('editNoData');
            setToolBtnState(scatterGridBtn, canGridify, tip);
            // disabled 按鈕本身常不顯示原生 title，改設在外層 tip host
            if (scatterGridTip) scatterGridTip.title = tip;
            if (!el.scatterGrid) el.scatterGrid = scatterGridBtn;
            if (!el.scatterGridTip && scatterGridTip) el.scatterGridTip = scatterGridTip;
        }
        if (el.btnClear) el.btnClear.disabled = !has;
        const cropOn = !!(has && st.edit.cropMode);
        if (el.cropActions) {
            const wasHidden = el.cropActions.hidden;
            el.cropActions.hidden = !cropOn;
            if (wasHidden !== el.cropActions.hidden && typeof layoutEdToolbar === 'function') {
                layoutEdToolbar();
            }
        }
        if (el.cropApply) el.cropApply.disabled = !(cropOn && st.edit.cropSel);
        if (el.cropCancel) el.cropCancel.disabled = !cropOn;
        if (el.segLevelApply) el.segLevelApply.disabled = !(has && st.edit.segLevel && !st.edit.segLevelBusy && !st.edit.segLevelTuneBusy && st.edit.segLevelResult);
        if (el.segLevelCancel) el.segLevelCancel.disabled = !(has && st.edit.segLevel);
        if (el.segLevelShowBounds) {
            el.segLevelShowBounds.disabled = !(has && st.edit.segLevel && !st.edit.segLevelBusy);
        }
        const segProbeToggleOn = !!(has && st.edit.segLevel && !st.edit.segLevelBusy);
        if (el.segLevelShowProbeBefore) el.segLevelShowProbeBefore.disabled = !segProbeToggleOn;
        if (el.segLevelShowProbeAfter) el.segLevelShowProbeAfter.disabled = !segProbeToggleOn;
        const segConfigLocked = !(has && st.edit.segLevel && !st.edit.segLevelBusy && !st.edit.segLevelTuneBusy);
        if (el.segLevelDir) el.segLevelDir.disabled = segConfigLocked;
        if (el.segLevelCount) el.segLevelCount.disabled = segConfigLocked;
        if (el.segLevelAuto) el.segLevelAuto.disabled = segConfigLocked;
        if (el.segSkewApply) el.segSkewApply.disabled = !(has && st.edit.segSkew && !st.edit.segSkewBusy && !st.edit.segSkewTuneBusy && st.edit.segSkewResult);
        if (el.segSkewCancel) el.segSkewCancel.disabled = !(has && st.edit.segSkew);
        if (el.segSkewShowBounds) {
            el.segSkewShowBounds.disabled = !(has && st.edit.segSkew && !st.edit.segSkewBusy);
        }
        const segSkewConfigLocked = !(has && st.edit.segSkew && !st.edit.segSkewBusy && !st.edit.segSkewTuneBusy);
        if (el.segSkewDir) el.segSkewDir.disabled = segSkewConfigLocked;
        if (el.segSkewCount) el.segSkewCount.disabled = segSkewConfigLocked;
        if (el.segSkewAuto) el.segSkewAuto.disabled = segSkewConfigLocked;
        if (el.medianFilterApply) el.medianFilterApply.disabled = !(has && st.edit.medianFilter && !st.edit.medianFilterBusy && st.edit.medianFilterResult);
        if (el.medianFilterCancel) el.medianFilterCancel.disabled = !(has && st.edit.medianFilter);
        const medianFilterConfigLocked = !(has && st.edit.medianFilter && !st.edit.medianFilterBusy && st.edit.medianFilterResult);
        if (el.medianFilterKernel) el.medianFilterKernel.disabled = medianFilterConfigLocked;
        if (el.scatterGridApply) el.scatterGridApply.disabled = !(has && st.edit.scatterGrid && !st.edit.scatterGridBusy && st.edit.scatterGridResult);
        if (el.scatterGridCancel) el.scatterGridCancel.disabled = !(has && st.edit.scatterGrid);
        const scatterGridConfigLocked = !(has && st.edit.scatterGrid && !st.edit.scatterGridBusy);
        if (el.scatterGridMode) el.scatterGridMode.disabled = scatterGridConfigLocked;
        if (el.scatterGridAgg) el.scatterGridAgg.disabled = scatterGridConfigLocked;
        if (el.scatterGridDx) el.scatterGridDx.disabled = scatterGridConfigLocked;
        if (el.scatterGridWidth) el.scatterGridWidth.disabled = scatterGridConfigLocked;
        if (el.scatterGridHeight) el.scatterGridHeight.disabled = scatterGridConfigLocked;
        if (el.nanPatchApply) el.nanPatchApply.disabled = !(has && st.edit.nanPatch && !st.edit.nanPatchBusy && st.edit.nanPatchResult);
        if (el.nanPatchCancel) el.nanPatchCancel.disabled = !(has && st.edit.nanPatch);
        const nanPatchConfigLocked = !(has && st.edit.nanPatch && !st.edit.nanPatchBusy && st.edit.nanPatchResult);
        if (el.nanPatchKernel) el.nanPatchKernel.disabled = nanPatchConfigLocked;
        const uniBusy = !!(st.edit.uniLevelApplyRunning || st.edit.uniLevelApplyPending);
        if (el.uniLevelApply) el.uniLevelApply.disabled = !(has && st.edit.uniLevel && !uniBusy && st.edit.uniLevelResult && st.edit.uniLevelResult.correctedData);
        if (el.uniLevelCancel) el.uniLevelCancel.disabled = !(has && st.edit.uniLevel);
        const uniLocked = !(has && st.edit.uniLevel && !uniBusy && st.edit.uniLevelResult);
        if (el.uniLevelLineH) el.uniLevelLineH.disabled = uniLocked;
        if (el.uniLevelLineV) el.uniLevelLineV.disabled = uniLocked;
        if (el.uniLevelK) el.uniLevelK.disabled = uniLocked;
        if (el.uniLevelKReset) el.uniLevelKReset.disabled = uniLocked;
        if (el.uniLevelShowProbeBefore) el.uniLevelShowProbeBefore.disabled = !(has && st.edit.uniLevel);
        if (el.uniLevelShowProbeAfter) el.uniLevelShowProbeAfter.disabled = !(has && st.edit.uniLevel);
        const polyBusy = !!(st.edit.profilePolyApplyRunning || st.edit.profilePolyApplyPending);
        if (el.profilePolyApply) el.profilePolyApply.disabled = !(has && st.edit.profilePoly && !polyBusy && st.edit.profilePolyResult && st.edit.profilePolyResult.correctedData);
        if (el.profilePolyCancel) el.profilePolyCancel.disabled = !(has && st.edit.profilePoly);
        const polyLocked = !(has && st.edit.profilePoly && st.edit.profilePolyResult);
        if (el.profilePolyOrder) el.profilePolyOrder.disabled = polyLocked;
        if (el.profilePolyDirH) el.profilePolyDirH.disabled = polyLocked;
        if (el.profilePolyDirV) el.profilePolyDirV.disabled = polyLocked;
        if (el.roiLevelApply) el.roiLevelApply.disabled = !(has && st.edit.roiLevel && !st.edit.roiLevelBusy && st.edit.roiLevelResult);
        if (el.roiLevelCancel) el.roiLevelCancel.disabled = !(has && st.edit.roiLevel);
        updateHistoryButtons();
    }

    function clearData() {
        if (!st.dataset) return;
        if (editing) endTransientModes();
        st.dataset = null;
        st.colorClip.lo = 0;
        st.colorClip.hi = 1;
        st.scatterPointRadius = SCATTER_R_DEFAULT;
        if (editing) {
            setLastEditStep(null);
            resetHistory();
        }

        const canvas = el.canvas;
        canvas.style.display = 'none';
        canvas.classList.remove('scatter-view');
        canvas.style.width = '';
        canvas.style.height = '';
        el.placeholder.style.display = '';
        el.zoomIndicator.classList.remove('show');
        el.zoomHint.classList.remove('show');

        renderColorbar(el.colormap.value);
        syncColorbarHandles();
        el.zMin.textContent = '-';
        el.zMax.textContent = '-';
        el.infoList.innerHTML = '';
        el.status.textContent = t('statusIdle');
        if (el.fileInput) el.fileInput.value = '';
        if (el.btnClear) el.btnClear.disabled = true;
        if (st.clearTools) st.clearTools();
        if (editing) updateEditButtons();
        syncPointSizeControls();
        showToast(t('statusCleared'), 'info');
    }

    /* ---- 編輯歷史（上一步 / 下一步） ---- */
    const HISTORY_MAX = 40;
    function updateHistoryButtons() {
        if (!editing) return;
        const h = st.edit.history;
        if (el.undo) el.undo.disabled = !(st.dataset && st.edit.histIndex > 0);
        if (el.redo) el.redo.disabled = !(st.dataset && st.edit.histIndex < h.length - 1);
    }
    function snapshotState() {
        const ds = st.dataset;
        const snap = {
            type: ds.type, vmin: ds.vmin, vmax: ds.vmax,
            width: ds.width, height: ds.height, pointCount: ds.pointCount,
            header: ds.header ? { ...ds.header } : ds.header,
            colorClip: { lo: st.colorClip.lo, hi: st.colorClip.hi },
        };
        if (isScatter(ds)) {
            snap.x = ds.x.slice(0); snap.y = ds.y.slice(0); snap.z = ds.z.slice(0);
            snap.bounds = ds.bounds ? { ...ds.bounds } : ds.bounds;
        } else {
            snap.data = ds.data.slice(0);
        }
        return snap;
    }
    function restoreState(snap) {
        const ds = st.dataset; if (!ds || !snap) return;
        ds.type = snap.type; ds.vmin = snap.vmin; ds.vmax = snap.vmax;
        ds.width = snap.width; ds.height = snap.height; ds.pointCount = snap.pointCount;
        ds.header = snap.header ? { ...snap.header } : snap.header;
        if (snap.x) {
            ds.x = snap.x.slice(0); ds.y = snap.y.slice(0); ds.z = snap.z.slice(0);
            ds.bounds = snap.bounds ? { ...snap.bounds } : snap.bounds;
            delete ds.data;
        } else {
            ds.data = snap.data.slice(0);
            delete ds.x; delete ds.y; delete ds.z; delete ds.bounds;
        }
        st.colorClip.lo = snap.colorClip.lo; st.colorClip.hi = snap.colorClip.hi;
        render(ds, el.colormap.value, true);
        const infoExtra = isScatter(ds) ? { pointCount: ds.pointCount } : null;
        renderInfo(ds.header, ds.width, ds.height, infoExtra);
        syncPointSizeControls();
        if (editing) updateEditButtons();
    }
    function resetHistory() {
        if (!editing) return;
        if (!st.dataset) { st.edit.history = []; st.edit.histIndex = -1; updateHistoryButtons(); return; }
        st.edit.history = [snapshotState()];
        st.edit.histIndex = 0;
        updateHistoryButtons();
    }
    function pushHistory() {
        if (!editing || !st.dataset) return;
        // 捨棄目前位置之後的「重做」分支
        if (st.edit.histIndex < st.edit.history.length - 1) {
            st.edit.history.length = st.edit.histIndex + 1;
        }
        st.edit.history.push(snapshotState());
        if (st.edit.history.length > HISTORY_MAX) st.edit.history.shift();
        st.edit.histIndex = st.edit.history.length - 1;
        updateHistoryButtons();
    }
    function endTransientModes() {
        // undo/redo 前先結束進行中的暫態操作（不寫入歷史）
        if (st.edit.cropMode) exitCrop();
        if (st.edit.denoise) cancelDenoise();
        if (st.edit.segLevel) cancelSegLevel();
        if (st.edit.segSkew) cancelSegSkew();
        if (st.edit.medianFilter) cancelMedianFilter();
        if (st.edit.scatterGrid) cancelScatterGrid();
        if (st.edit.nanPatch) cancelNanPatch();
        if (st.edit.roiLevel) cancelRoiLevel();
        if (st.edit.uniLevel) cancelUniLevel();
        if (st.edit.profilePoly) cancelProfilePoly();
    }
    function doUndo() {
        if (!editing || !st.dataset || st.edit.histIndex <= 0) return;
        endTransientModes();
        st.edit.histIndex--;
        restoreState(st.edit.history[st.edit.histIndex]);
        updateHistoryButtons();
    }
    function doRedo() {
        if (!editing || !st.dataset || st.edit.histIndex >= st.edit.history.length - 1) return;
        endTransientModes();
        st.edit.histIndex++;
        restoreState(st.edit.history[st.edit.histIndex]);
        updateHistoryButtons();
    }

    /** 計算機：對所有像素值套用 +、-、*、/ 運算（僅點陣影像，不含散布點雲） */
    function applyCalc(op, operand) {
        if (!editing || !st.dataset) return { ok: false, reason: 'noData' };
        if (isScatter(st.dataset)) return { ok: false, reason: 'scatter' };
        if (!Number.isFinite(operand)) return { ok: false, reason: 'invalid' };
        if (op === '/' && operand === 0) return { ok: false, reason: 'divZero' };
        endTransientModes();

        const src = st.dataset.data;
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

        st.dataset.data = dst;
        refreshAfterEdit(false);
        pushHistory();
        setLastEditStep({ type: 'calc', op, operand });
        return { ok: true };
    }

    /** 建立平面擬合用座標存取器（影像用實體尺寸，散布點雲用世界座標） */
    function planeFitAccessors(ds) {
        if (isScatter(ds)) {
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

    /** 解 3×3 線性方程組（部分樞軸高斯消去） */
    function solveLinear3(A, B) {
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

    /** 最小平方法擬合平面 z = ax + by + c */
    function fitPlaneLeastSquares(acc) {
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
        const sol = solveLinear3(
            [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]],
            [sxz, syz, sz],
        );
        if (!sol) return null;
        return { a: sol[0], b: sol[1], c: sol[2], n };
    }

    /**
     * 上下顛倒：Z' = (Zmin + Zmax) − Z。
     * 波峰與波谷對調，數值留在原本的距離區間；NaN 不變。全圖同值時不寫入歷史。
     */
    function applyInvertZ() {
        if (!editing || !st.dataset) { showToast(t('editNoData'), 'info'); return; }
        endTransientModes();
        const ds = st.dataset;
        if (!isScatter(ds)) ensureFloatPixels(ds);
        const buf = isScatter(ds) ? ds.z : ds.data;
        const res = applyInvertZToBuffer(buf);
        if (!res.ok) {
            showToast(t(res.reason === 'noValid' ? 'invertZNoValid' : 'editNoData'), 'info');
            return;
        }
        if (!res.changed) {
            showToast(t('invertZFlat'), 'info');
            return;
        }
        refreshAfterEdit(false);
        pushHistory();
        setLastEditStep({ type: 'invertZ' });
        el.status.textContent = t('invertZDone', res.n);
        showToast(t('invertZDone', res.n), 'info');
    }

    /** 全域水平校正：僅扣除傾斜 ax+by，保留截距（數值區間維持接近原始） */
    function applyGlobalLeveling() {
        if (!editing || !st.dataset) { showToast(t('editNoData'), 'info'); return; }
        endTransientModes();
        const acc = planeFitAccessors(st.dataset);
        const plane = fitPlaneLeastSquares(acc);
        if (!plane) { showToast(t('globalLevelInsufficient'), 'info'); return; }
        const { a, b, n } = plane;
        const ds = st.dataset;
        if (isScatter(ds)) {
            const z = ds.z;
            for (let i = 0; i < z.length; i++) {
                if (!acc.isValid(i)) continue;
                z[i] -= a * ds.x[i] + b * ds.y[i];
            }
        } else {
            ensureFloatPixels(ds);
            const data = ds.data;
            for (let i = 0; i < data.length; i++) {
                if (!acc.isValid(i)) continue;
                data[i] -= a * acc.getX(i) + b * acc.getY(i);
            }
        }
        refreshAfterEdit(false);
        pushHistory();
        setLastEditStep({ type: 'globalLevel' });
        el.status.textContent = t('globalLevelDone', n);
        showToast(t('globalLevelDone', n), 'info');
    }

    /* ---------- 單向水平校正（一條水平或垂直校正線 → 全圖單向去傾斜） ---------- */

    function uniLevelStatusText(result) {
        if (!result) return '';
        const line = result.lineDir === 'vertical' ? t('uniLevelLineVertical') : t('uniLevelLineHorizontal');
        return t('uniLevelMeta', line, segLevelFmtK(result.k), result.n);
    }

    function uniLevelSyncChrome() {
        const result = st.edit.uniLevelResult;
        if (el.uniLevelSlopeLabel) {
            const vertical = result && result.lineDir === 'vertical';
            el.uniLevelSlopeLabel.textContent = vertical ? t('uniLevelSlopeY') : t('uniLevelSlopeX');
        }
        if (el.uniLevelK && result && document.activeElement !== el.uniLevelK) {
            el.uniLevelK.value = segLevelFmtK(result.k);
        }
        const vertical = !!(result && result.lineDir === 'vertical');
        if (el.uniLevelLineH) {
            el.uniLevelLineH.classList.toggle('active', !vertical);
            el.uniLevelLineH.setAttribute('aria-pressed', vertical ? 'false' : 'true');
        }
        if (el.uniLevelLineV) {
            el.uniLevelLineV.classList.toggle('active', vertical);
            el.uniLevelLineV.setAttribute('aria-pressed', vertical ? 'true' : 'false');
        }
        if (el.uniLevelK) el.uniLevelK.title = t('uniLevelSlopeHint');
    }

    function uniLevelEnsureViews() {
        if (!st.edit.uniLevelViews) {
            st.edit.uniLevelViews = {
                beforeImg: segLevelDefaultView(),
                afterImg: segLevelDefaultView(),
                beforeProfile: segLevelDefaultView(),
                afterProfile: segLevelDefaultView(),
            };
        }
        return st.edit.uniLevelViews;
    }

    function uniLevelResetViews() {
        uniLevelHideProfileHover('beforeProfile');
        uniLevelHideProfileHover('afterProfile');
        st.edit.uniLevelViews = null;
        st.edit.uniLevelPan = null;
        st.edit.uniLevelProfileCharts = null;
        st.edit.uniLevelProfilePointer = null;
    }

    function uniLevelImagePeer(key) {
        if (key === 'beforeImg') return { key: 'afterImg', canvas: el.uniLevelAfter };
        if (key === 'afterImg') return { key: 'beforeImg', canvas: el.uniLevelBefore };
        return null;
    }

    function uniLevelApplyTransform(canvas, view) {
        if (!canvas || !view) return;
        const wrap = canvas.parentElement;
        canvas.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
        canvas.style.transformOrigin = '0 0';
        if (wrap) {
            const ind = wrap.querySelector('.seg-level-zoom-ind');
            if (ind) ind.textContent = segLevelZoomPct(view);
        }
        uniLevelLayoutProbes();
    }

    function uniLevelMirrorImage(fromKey) {
        const peer = uniLevelImagePeer(fromKey);
        if (!peer || !peer.canvas) return;
        const views = uniLevelEnsureViews();
        const src = views[fromKey];
        const dst = views[peer.key];
        if (!src || !dst) return;
        dst.scale = src.scale;
        dst.tx = src.tx;
        dst.ty = src.ty;
        dst.contentW = src.contentW;
        dst.contentH = src.contentH;
        uniLevelApplyTransform(peer.canvas, dst);
    }

    function uniLevelSyncView(zoomKey, canvas, resetView) {
        if (!zoomKey || !canvas) return;
        const wrap = canvas.parentElement;
        if (!wrap) return;
        const views = uniLevelEnsureViews();
        const view = views[zoomKey];
        const { cw, ch } = segLevelContentSize(canvas);
        const sizeChanged = view.contentW !== cw || view.contentH !== ch;
        if (resetView || sizeChanged) segLevelFitView(view, wrap, cw, ch);
        uniLevelApplyTransform(canvas, view);
        if (zoomKey === 'beforeImg' || zoomKey === 'afterImg') uniLevelMirrorImage(zoomKey);
    }

    function uniLevelZoomAt(zoomKey, wrap, canvas, screenX, screenY, zoomFactor) {
        const views = uniLevelEnsureViews();
        const view = views[zoomKey];
        let newScale = view.scale * zoomFactor;
        if (newScale < view.minScale) newScale = view.minScale;
        if (newScale > view.maxScale) newScale = view.maxScale;
        const k = newScale / view.scale;
        view.tx = screenX - (screenX - view.tx) * k;
        view.ty = screenY - (screenY - view.ty) * k;
        view.scale = newScale;
        uniLevelApplyTransform(canvas, view);
        if (zoomKey === 'beforeImg' || zoomKey === 'afterImg') uniLevelMirrorImage(zoomKey);
    }

    function uniLevelEnsureClips() {
        if (!st.edit.uniLevelClip) {
            st.edit.uniLevelClip = { before: { lo: 0, hi: 1 }, after: { lo: 0, hi: 1 } };
        }
        return st.edit.uniLevelClip;
    }

    function uniLevelClipFor(pane) {
        const clips = uniLevelEnsureClips();
        return pane === 'after' ? clips.after : clips.before;
    }

    function uniLevelResetClips() {
        st.edit.uniLevelClip = { before: { lo: 0, hi: 1 }, after: { lo: 0, hi: 1 } };
    }

    function uniLevelPaneStats(pane) {
        if (pane === 'after') {
            const data = st.edit.uniLevelResult && st.edit.uniLevelResult.correctedData;
            if (!data) return null;
            const range = computeRange(data);
            return { vmin: range.vmin, vmax: range.vmax, data };
        }
        const base = st.edit.uniLevelBase;
        if (!base) return null;
        return { vmin: base.vmin, vmax: base.vmax, data: base.data };
    }

    function uniLevelVisibleValueRange(pane) {
        const canvas = pane === 'after' ? el.uniLevelAfter : el.uniLevelBefore;
        const wrap = canvas && canvas.parentElement;
        const stats = uniLevelPaneStats(pane);
        if (!canvas || !wrap || !stats || !st.dataset) return null;
        const data = stats.data;
        const view = uniLevelEnsureViews()[pane === 'after' ? 'afterImg' : 'beforeImg'];
        const scale = view.scale || 1;
        const { width, height } = st.dataset;
        const x0 = Math.max(0, Math.floor((0 - view.tx) / scale));
        const y0 = Math.max(0, Math.floor((0 - view.ty) / scale));
        const x1 = Math.min(width, Math.ceil((wrap.clientWidth - view.tx) / scale));
        const y1 = Math.min(height, Math.ceil((wrap.clientHeight - view.ty) / scale));
        if (x1 <= x0 || y1 <= y0) return null;
        let vmin = Infinity;
        let vmax = -Infinity;
        let count = 0;
        for (let y = y0; y < y1; y++) {
            const row = y * width;
            for (let x = x0; x < x1; x++) {
                const v = data[row + x];
                if (!Number.isFinite(v)) continue;
                if (v < vmin) vmin = v;
                if (v > vmax) vmax = v;
                count++;
            }
        }
        if (!count || !(vmax >= vmin)) return null;
        if (!(vmax > vmin)) {
            const pad = Math.max(Math.abs(vmin) * 0.001, 1e-6);
            vmin -= pad;
            vmax += pad;
        }
        return { min: vmin, max: vmax };
    }

    function uniLevelSetClipRange(pane, rangeMin, rangeMax) {
        const stats = uniLevelPaneStats(pane);
        if (!stats) return;
        const span = (stats.vmax - stats.vmin) || 1;
        let lo = (rangeMin - stats.vmin) / span;
        let hi = (rangeMax - stats.vmin) / span;
        if (lo < 0) lo = 0;
        if (hi > 1) hi = 1;
        if (hi < lo) { const swap = lo; lo = hi; hi = swap; }
        if (hi - lo < 0.01) {
            const mid = (lo + hi) / 2;
            lo = Math.max(0, mid - 0.005);
            hi = Math.min(1, lo + 0.01);
            if (hi > 1) { hi = 1; lo = 0.99; }
        }
        const clip = uniLevelClipFor(pane);
        clip.lo = lo;
        clip.hi = hi;
    }

    function uniLevelRenderImage(canvas, data, width, height, cmin, crange, cmap, zoomKey, resetView) {
        if (!canvas || !data) return;
        const cw = Math.max(1, width);
        const ch = Math.max(1, height);
        canvas.width = cw;
        canvas.height = ch;
        canvas.style.width = cw + 'px';
        canvas.style.height = ch + 'px';
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(cw, ch);
        const px = img.data;
        const lut = buildColormapLut(cmap);
        const denom = crange || 1e-12;
        for (let y = 0; y < ch; y++) {
            const row = y * width;
            for (let x = 0; x < cw; x++) {
                const v = data[row + x];
                const po = (y * cw + x) * 4;
                if (!Number.isFinite(v)) {
                    paintMissingPixel(px, po);
                    continue;
                }
                let tcol = (v - cmin) / denom;
                if (tcol < 0) tcol = 0;
                else if (tcol > 1) tcol = 1;
                const lo = ((tcol * 255) | 0) * 3;
                px[po] = lut[lo];
                px[po + 1] = lut[lo + 1];
                px[po + 2] = lut[lo + 2];
                px[po + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        uniLevelSyncView(zoomKey, canvas, resetView);
    }

    function uniLevelDrawModel(ctx, model, n, cmin, yRange, x0, y0, plotW, plotH) {
        if (!model || !Number.isFinite(model.k) || !Number.isFinite(model.scale) || n < 2) return;
        const distPx = Math.max(1, n - 1);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, y0, plotW, plotH);
        ctx.clip();
        ctx.strokeStyle = '#ffb020';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        let started = false;
        const step = Math.max(1, Math.floor(n / 200));
        for (let i = 0; i < n; i += step) {
            const z = model.k * (i - model.center) * model.scale + model.c;
            if (!Number.isFinite(z)) { started = false; continue; }
            const px = x0 + (i / distPx) * plotW;
            const py = y0 + (1 - (z - cmin) / yRange) * plotH;
            if (!started) { ctx.moveTo(px, py); started = true; }
            else ctx.lineTo(px, py);
        }
        const zEnd = model.k * ((n - 1) - model.center) * model.scale + model.c;
        if (Number.isFinite(zEnd)) {
            const px = x0 + plotW;
            const py = y0 + (1 - (zEnd - cmin) / yRange) * plotH;
            if (!started) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.restore();
    }

    function uniLevelIsProfileZoomKey(zoomKey) {
        return zoomKey === 'beforeProfile' || zoomKey === 'afterProfile';
    }

    function uniLevelProfileCanvasFor(zoomKey) {
        return zoomKey === 'beforeProfile' ? el.uniLevelBeforeProfile : el.uniLevelAfterProfile;
    }

    function uniLevelStoreProfileChart(zoomKey, payload) {
        if (!uniLevelIsProfileZoomKey(zoomKey)) return;
        if (!st.edit.uniLevelProfileCharts) st.edit.uniLevelProfileCharts = {};
        st.edit.uniLevelProfileCharts[zoomKey] = payload;
    }

    function uniLevelHideProfileHover(zoomKey) {
        const canvas = uniLevelProfileCanvasFor(zoomKey);
        const hover = canvas && canvas.parentElement && canvas.parentElement.querySelector('.seg-level-profile-hover');
        if (hover) hover.classList.remove('show');
    }

    function uniLevelProfileHit(zoomKey, clientX, clientY) {
        const charts = st.edit.uniLevelProfileCharts;
        const payload = charts && charts[zoomKey];
        const canvas = uniLevelProfileCanvasFor(zoomKey);
        const wrap = canvas && canvas.parentElement;
        const view = uniLevelEnsureViews()[zoomKey];
        if (!payload || !payload.vals || !payload.vals.length || !wrap || !view || !view.scale) return null;
        const rect = wrap.getBoundingClientRect();
        const mx = clientX - rect.left;
        const my = clientY - rect.top;
        if (mx < 0 || my < 0 || mx > rect.width || my > rect.height) return null;
        const cx = (mx - view.tx) / view.scale;
        const cy = (my - view.ty) / view.scale;
        const { cw, ch } = segLevelContentSize(canvas);
        const g = segLevelProfileGeom(cw, ch);
        if (cx < g.x0 - 6 || cx > g.x0 + g.plotW + 6) return null;
        if (cy < g.y0 - 6 || cy > g.y0 + g.plotH + 6) return null;
        const vals = payload.vals;
        const n = vals.length;
        const distPx = Math.max(1, n - 1);
        let frac = (cx - g.x0) / g.plotW;
        if (frac < 0) frac = 0;
        else if (frac > 1) frac = 1;
        let idx = Math.round(frac * distPx);
        if (idx < 0) idx = 0;
        else if (idx >= n) idx = n - 1;
        if (!Number.isFinite(vals[idx])) {
            let best = -1;
            let bestD = Infinity;
            for (let i = 0; i < n; i++) {
                if (!Number.isFinite(vals[i])) continue;
                const d = Math.abs(i - idx);
                if (d < bestD) { bestD = d; best = i; }
            }
            if (best < 0) return null;
            idx = best;
        }
        const v = vals[idx];
        const yRange = payload.crange || 1e-12;
        const px = segLevelProfilePlotX(idx, distPx, g.x0, g.plotW);
        const py = segLevelProfilePlotY(v, payload.cmin, yRange, g.y0, g.plotH);
        return {
            idx,
            v,
            lineDir: payload.lineDir,
            sx: view.tx + px * view.scale,
            sy: view.ty + py * view.scale,
            lineX: view.tx + px * view.scale,
            plotTop: view.ty + g.y0 * view.scale,
            plotH: g.plotH * view.scale,
            wrapW: rect.width,
            wrapH: rect.height,
        };
    }

    function uniLevelPlaceProfileHover(zoomKey, hit) {
        const canvas = uniLevelProfileCanvasFor(zoomKey);
        const wrap = canvas && canvas.parentElement;
        if (!wrap) return;
        const hover = segLevelEnsureProfileHover(wrap);
        if (!hit) {
            hover.classList.remove('show');
            return;
        }
        const line = hover.querySelector('.seg-level-profile-hover-line');
        const dot = hover.querySelector('.seg-level-profile-hover-dot');
        const tip = hover.querySelector('.seg-level-profile-hover-tip');
        line.style.left = hit.lineX + 'px';
        line.style.top = hit.plotTop + 'px';
        line.style.height = Math.max(0, hit.plotH) + 'px';
        dot.style.left = hit.sx + 'px';
        dot.style.top = hit.sy + 'px';
        const axis = hit.lineDir === 'horizontal' ? t('segLevelProfileAxisX') : t('segLevelProfileAxisY');
        tip.replaceChildren();
        const addRow = (label, value) => {
            const row = document.createElement('div');
            const key = document.createElement('span');
            key.className = 'k';
            key.textContent = label;
            row.append(key, document.createTextNode(value));
            tip.appendChild(row);
        };
        addRow(axis + ':', String(hit.idx));
        addRow(t('segLevelProfileValue') + ':', segLevelFmt(hit.v));
        hover.classList.add('show');
        const tipW = tip.offsetWidth;
        const tipH = tip.offsetHeight;
        let left = hit.sx + 10;
        let top = hit.sy - tipH - 8;
        if (left + tipW > hit.wrapW - 4) left = hit.sx - tipW - 10;
        if (top < 4) top = hit.sy + 12;
        if (left < 4) left = 4;
        if (top + tipH > hit.wrapH - 4) top = Math.max(4, hit.wrapH - tipH - 4);
        tip.style.left = left + 'px';
        tip.style.top = top + 'px';
    }

    function uniLevelUpdateProfileHover() {
        const pointer = st.edit.uniLevelProfilePointer;
        if (!pointer || !st.edit.uniLevel) return;
        uniLevelPlaceProfileHover(pointer.key, uniLevelProfileHit(pointer.key, pointer.x, pointer.y));
    }

    function uniLevelUpdateProfileHoverFromEvent(zoomKey, e) {
        if (!st.edit.uniLevel || !uniLevelIsProfileZoomKey(zoomKey)) return;
        st.edit.uniLevelProfilePointer = { key: zoomKey, x: e.clientX, y: e.clientY };
        uniLevelUpdateProfileHover();
    }

    function uniLevelRenderProfile(canvas, vals, cmin, crange, model, lineDir, zoomKey, resetView) {
        if (!canvas || !vals || !vals.length) {
            clearSegLevelProfileCanvas(canvas);
            if (zoomKey && st.edit.uniLevelProfileCharts) delete st.edit.uniLevelProfileCharts[zoomKey];
            return;
        }
        const wrap = canvas.parentElement;
        const cw = Math.max(1, wrap ? wrap.clientWidth : 200);
        const ch = Math.max(1, wrap ? wrap.clientHeight : 100);
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.round(cw * dpr));
        canvas.height = Math.max(1, Math.round(ch * dpr));
        canvas.style.width = cw + 'px';
        canvas.style.height = ch + 'px';
        canvas.setAttribute('aria-hidden', 'false');
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cw, ch);
        const geom = segLevelProfileGeom(cw, ch);
        const { plotW, plotH, x0, y0 } = geom;
        const yRange = crange || 1e-12;
        const cmax = cmin + yRange;
        const n = vals.length;
        const distPx = Math.max(1, n - 1);
        uniLevelStoreProfileChart(zoomKey, { vals, cmin, crange, lineDir });
        const ink = chartChrome();
        ctx.fillStyle = ink.fill;
        ctx.fillRect(x0, y0, plotW, plotH);
        ctx.font = '10px Consolas, monospace';
        ctx.lineWidth = 1;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (let i = 0; i <= 4; i++) {
            const tt = i / 4;
            const py = y0 + plotH * tt;
            ctx.strokeStyle = ink.gridSoft;
            ctx.beginPath();
            ctx.moveTo(x0, py);
            ctx.lineTo(x0 + plotW, py);
            ctx.stroke();
            ctx.fillStyle = ink.label;
            ctx.fillText(segLevelFmt(cmax - yRange * tt), x0 - 5, py);
        }
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (let i = 0; i <= 4; i++) {
            const tt = i / 4;
            const px = x0 + plotW * tt;
            ctx.fillStyle = ink.label;
            ctx.fillText(String(Math.round(distPx * tt)), px, y0 + plotH + 4);
        }
        ctx.fillStyle = ink.labelDim;
        ctx.font = '10px sans-serif';
        const axis = lineDir === 'horizontal' ? t('segLevelProfileAxisX') : t('segLevelProfileAxisY');
        ctx.fillText(axis, x0 + plotW * 0.5, ch - 2);
        ctx.strokeStyle = '#4f8cff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < n; i++) {
            const v = vals[i];
            if (!Number.isFinite(v)) { started = false; continue; }
            const px = x0 + (i / distPx) * plotW;
            let tcol = (v - cmin) / yRange;
            if (tcol < 0) tcol = 0;
            else if (tcol > 1) tcol = 1;
            const py = y0 + (1 - tcol) * plotH;
            if (!started) { ctx.moveTo(px, py); started = true; }
            else ctx.lineTo(px, py);
        }
        ctx.stroke();
        uniLevelDrawModel(ctx, model, n, cmin, yRange, x0, y0, plotW, plotH);
        if (model && Number.isFinite(model.k)) {
            ctx.font = '10px Consolas, monospace';
            ctx.fillStyle = '#ffb020';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(segLevelFmtK(model.k) + ' µm/mm', x0 + 6, y0 + 4);
        }
        uniLevelSyncView(zoomKey, canvas, resetView);
        const pointer = st.edit.uniLevelProfilePointer;
        if (pointer && pointer.key === zoomKey) uniLevelUpdateProfileHover();
    }

    function uniLevelProfileAt(data, width, height, lineDir, index) {
        if (typeof segLevelExtractProfileAt !== 'function' || typeof uniLevelSegDirection !== 'function') return [];
        return segLevelExtractProfileAt(data, width, height, uniLevelSegDirection(lineDir), index);
    }

    function uniLevelFitProfileModel(vals, scale) {
        if (!vals || typeof segLevelFitProfileSegment !== 'function' || !Number.isFinite(scale)) return null;
        const fit = segLevelFitProfileSegment(vals, 0, vals.length, scale);
        if (!fit || !Number.isFinite(fit.k)) return null;
        return { k: fit.k, c: fit.c, center: fit.center, scale };
    }

    function uniLevelEnsureProbe() {
        if (!st.edit.uniLevelProbe) st.edit.uniLevelProbe = { before: null, after: null, drag: null };
        return st.edit.uniLevelProbe;
    }

    function uniLevelResolveIndex(pane) {
        const result = st.edit.uniLevelResult;
        if (!result || !st.dataset) return 0;
        const stored = uniLevelEnsureProbe()[pane];
        return segLevelClampProfileIndex(st.dataset.width, st.dataset.height, result.segDir, stored);
    }

    function uniLevelProbeNodes(pane) {
        const canvas = pane === 'before' ? el.uniLevelBefore : el.uniLevelAfter;
        return { canvas, wrap: canvas ? canvas.parentElement : null };
    }

    function uniLevelProbeVisible(pane) {
        const input = pane === 'before' ? el.uniLevelShowProbeBefore : el.uniLevelShowProbeAfter;
        return !input || !!input.checked;
    }

    function uniLevelEnsureProbeEl(pane) {
        const { wrap } = uniLevelProbeNodes(pane);
        if (!wrap) return null;
        let probe = wrap.querySelector('.seg-level-probe');
        if (!probe) {
            probe = document.createElement('div');
            probe.className = 'seg-level-probe';
            probe.dataset.pane = pane;
            probe.tabIndex = 0;
            probe.hidden = true;
            const line = document.createElement('div');
            line.className = 'seg-level-probe-line';
            probe.appendChild(line);
            wrap.appendChild(probe);
            uniLevelBindProbe(probe, pane);
        }
        return probe;
    }

    function uniLevelLayoutProbe(pane) {
        const probe = uniLevelEnsureProbeEl(pane);
        const { wrap } = uniLevelProbeNodes(pane);
        if (!probe || !wrap) return;
        const result = st.edit.uniLevelResult;
        const shown = !!(st.edit.uniLevel && result && st.dataset && uniLevelProbeVisible(pane));
        if (!shown) {
            probe.hidden = true;
            const drag = st.edit.uniLevelProbe && st.edit.uniLevelProbe.drag;
            if (drag && drag.pane === pane) {
                st.edit.uniLevelProbe.drag = null;
                probe.classList.remove('is-dragging');
                wrap.classList.remove('seg-level-probe-dragging');
                wrap.style.cursor = '';
            }
            return;
        }
        const horizontal = result.lineDir === 'horizontal';
        const { width, height } = st.dataset;
        const index = uniLevelResolveIndex(pane);
        const view = uniLevelEnsureViews()[pane === 'before' ? 'beforeImg' : 'afterImg'];
        probe.hidden = false;
        probe.classList.toggle('is-horizontal', horizontal);
        probe.classList.toggle('is-vertical', !horizontal);
        const label = horizontal ? t('uniLevelProbeHorizontal') : t('uniLevelProbeVertical');
        probe.title = label;
        probe.setAttribute('aria-label', label);
        probe.setAttribute('aria-valuenow', String(index));
        if (horizontal) {
            probe.style.left = view.tx + 'px';
            probe.style.top = (view.ty + (index + 0.5) * view.scale) + 'px';
            probe.style.width = Math.max(0, (view.contentW || width) * view.scale) + 'px';
            probe.style.height = '';
        } else {
            probe.style.left = (view.tx + (index + 0.5) * view.scale) + 'px';
            probe.style.top = view.ty + 'px';
            probe.style.height = Math.max(0, (view.contentH || height) * view.scale) + 'px';
            probe.style.width = '';
        }
    }

    function uniLevelLayoutProbes() {
        uniLevelLayoutProbe('before');
        uniLevelLayoutProbe('after');
    }

    function uniLevelIndexFromEvent(pane, e) {
        const result = st.edit.uniLevelResult;
        const { wrap } = uniLevelProbeNodes(pane);
        if (!result || !wrap) return null;
        const view = uniLevelEnsureViews()[pane === 'before' ? 'beforeImg' : 'afterImg'];
        if (!view || !view.scale) return null;
        const rect = wrap.getBoundingClientRect();
        const horizontal = result.lineDir === 'horizontal';
        const local = horizontal ? (e.clientY - rect.top) : (e.clientX - rect.left);
        const origin = horizontal ? view.ty : view.tx;
        return (local - origin) / view.scale - 0.5;
    }

    function uniLevelSetProbeIndex(pane, rawIndex) {
        const result = st.edit.uniLevelResult;
        if (!result || !st.dataset || !st.edit.uniLevel) return;
        const current = uniLevelResolveIndex(pane);
        const resolved = segLevelClampProfileIndex(st.dataset.width, st.dataset.height, result.segDir, rawIndex);
        if (current === resolved) {
            uniLevelLayoutProbe(pane);
            return;
        }
        uniLevelEnsureProbe()[pane] = resolved;
        uniLevelLayoutProbe(pane);
        if (pane === 'before') uniLevelRefitFromLine({ toast: false });
        else uniLevelRenderProfiles();
    }

    function uniLevelBindProbe(probe, pane) {
        probe.addEventListener('pointerdown', (e) => {
            if (!st.edit.uniLevel || st.edit.uniLevelApplyRunning || e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            try { probe.setPointerCapture(e.pointerId); } catch (err) { /* 指標尚未按下時略過 */ }
            const state = uniLevelEnsureProbe();
            state.drag = { pane, pointerId: e.pointerId };
            probe.classList.add('is-dragging');
            const { wrap } = uniLevelProbeNodes(pane);
            if (wrap) {
                wrap.classList.add('seg-level-probe-dragging');
                const horizontal = st.edit.uniLevelResult && st.edit.uniLevelResult.lineDir === 'horizontal';
                wrap.style.cursor = horizontal ? 'ns-resize' : 'ew-resize';
            }
        });
        probe.addEventListener('pointermove', (e) => {
            const drag = st.edit.uniLevelProbe && st.edit.uniLevelProbe.drag;
            if (!drag || drag.pane !== pane || drag.pointerId !== e.pointerId) return;
            const raw = uniLevelIndexFromEvent(pane, e);
            if (raw == null) return;
            uniLevelSetProbeIndex(pane, raw);
        });
        const endDrag = (e) => {
            const drag = st.edit.uniLevelProbe && st.edit.uniLevelProbe.drag;
            if (!drag || drag.pointerId !== e.pointerId) return;
            st.edit.uniLevelProbe.drag = null;
            probe.classList.remove('is-dragging');
            const { wrap } = uniLevelProbeNodes(pane);
            if (wrap) {
                wrap.classList.remove('seg-level-probe-dragging');
                wrap.style.cursor = '';
            }
            uniLevelSyncChrome();
            if (pane === 'before') uniLevelShowFeedback();
        };
        probe.addEventListener('pointerup', endDrag);
        probe.addEventListener('pointercancel', endDrag);
        probe.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
        probe.addEventListener('keydown', (e) => {
            if (!st.edit.uniLevel || !st.edit.uniLevelResult || !st.dataset) return;
            const horizontal = st.edit.uniLevelResult.lineDir === 'horizontal';
            let delta = 0;
            if (horizontal && e.key === 'ArrowUp') delta = -1;
            else if (horizontal && e.key === 'ArrowDown') delta = 1;
            else if (!horizontal && e.key === 'ArrowLeft') delta = -1;
            else if (!horizontal && e.key === 'ArrowRight') delta = 1;
            else return;
            e.preventDefault();
            uniLevelSetProbeIndex(pane, uniLevelResolveIndex(pane) + delta);
        });
    }

    function uniLevelBeforeDragging() {
        const drag = st.edit.uniLevelProbe && st.edit.uniLevelProbe.drag;
        return !!(drag && drag.pane === 'before');
    }

    function uniLevelClearFeedback() {
        if (st.edit.uniLevelFeedbackTimer) {
            clearTimeout(st.edit.uniLevelFeedbackTimer);
            st.edit.uniLevelFeedbackTimer = 0;
        }
        const pane = el.uniLevelAfter && el.uniLevelAfter.closest('.seg-level-pane-after');
        if (pane) pane.classList.remove('is-probe-live', 'is-probe-updated');
        if (el.uniLevelUpdateBadge) {
            el.uniLevelUpdateBadge.hidden = true;
            el.uniLevelUpdateBadge.textContent = '';
        }
        if (el.uniLevelK) el.uniLevelK.classList.remove('is-probe-live', 'is-probe-updated');
    }

    function uniLevelShowFeedback() {
        const result = st.edit.uniLevelResult;
        const badge = el.uniLevelUpdateBadge;
        const pane = el.uniLevelAfter && el.uniLevelAfter.closest('.seg-level-pane-after');
        if (!badge || !pane || !result || !st.edit.uniLevel) return;
        const live = uniLevelBeforeDragging();
        const kText = segLevelFmtK(result.k);
        pane.classList.toggle('is-probe-live', live);
        pane.classList.toggle('is-probe-updated', !live);
        badge.hidden = false;
        badge.textContent = live ? t('uniLevelProbeUpdating', kText) : t('uniLevelProbeUpdated', kText);
        if (el.uniLevelK) {
            el.uniLevelK.classList.toggle('is-probe-live', live);
            el.uniLevelK.classList.toggle('is-probe-updated', !live);
        }
        if (st.edit.uniLevelFeedbackTimer) {
            clearTimeout(st.edit.uniLevelFeedbackTimer);
            st.edit.uniLevelFeedbackTimer = 0;
        }
        if (!live) {
            st.edit.uniLevelFeedbackTimer = setTimeout(() => {
                st.edit.uniLevelFeedbackTimer = 0;
                if (uniLevelBeforeDragging()) return;
                uniLevelClearFeedback();
            }, 1800);
        }
    }

    function uniLevelRenderProfiles() {
        const base = st.edit.uniLevelBase;
        const result = st.edit.uniLevelResult;
        if (!base || !result || !st.dataset) return;
        const { width, height } = st.dataset;
        const beforeVals = uniLevelProfileAt(base.data, width, height, result.lineDir, uniLevelResolveIndex('before'));
        const beforeFull = segLevelDisplayRange(base.vmin, base.vmax, null);
        const beforeModel = {
            k: result.k, c: result.c, center: result.center, scale: result.scale,
        };
        uniLevelRenderProfile(
            el.uniLevelBeforeProfile, beforeVals, beforeFull.cmin, beforeFull.crange,
            beforeModel, result.lineDir, 'beforeProfile', false,
        );
        const afterData = result.correctedData;
        if (!afterData) {
            clearSegLevelProfileCanvas(el.uniLevelAfterProfile);
            return;
        }
        const afterVals = uniLevelProfileAt(afterData, width, height, result.lineDir, uniLevelResolveIndex('after'));
        const afterStats = computeRange(afterData);
        const afterFull = segLevelDisplayRange(afterStats.vmin, afterStats.vmax, null);
        uniLevelRenderProfile(
            el.uniLevelAfterProfile, afterVals, afterFull.cmin, afterFull.crange,
            uniLevelFitProfileModel(afterVals, result.scale), result.lineDir, 'afterProfile', false,
        );
    }

    function renderUniLevelCompare(opts) {
        const resetView = !!(opts && opts.resetView);
        const base = st.edit.uniLevelBase;
        const result = st.edit.uniLevelResult;
        if (!base || !result || !st.dataset) return;
        const { width, height } = st.dataset;
        const cmap = el.colormap.value;
        const beforeDr = segLevelDisplayRange(base.vmin, base.vmax, uniLevelClipFor('before'));
        uniLevelRenderImage(
            el.uniLevelBefore, base.data, width, height,
            beforeDr.cmin, beforeDr.crange, cmap, 'beforeImg', resetView,
        );
        renderSegLevelPaneColorbar(
            el.uniLevelBeforeCb, el.uniLevelBeforeCbLo, el.uniLevelBeforeCbHi,
            base.vmin, base.vmax, cmap, uniLevelClipFor('before'),
        );
        const afterData = result.correctedData;
        if (afterData) {
            const afterStats = computeRange(afterData);
            const afterDr = segLevelDisplayRange(afterStats.vmin, afterStats.vmax, uniLevelClipFor('after'));
            uniLevelRenderImage(
                el.uniLevelAfter, afterData, width, height,
                afterDr.cmin, afterDr.crange, cmap, 'afterImg', resetView,
            );
            renderSegLevelPaneColorbar(
                el.uniLevelAfterCb, el.uniLevelAfterCbLo, el.uniLevelAfterCbHi,
                afterStats.vmin, afterStats.vmax, cmap, uniLevelClipFor('after'),
            );
        }
        uniLevelRenderProfiles();
        if (resetView) {
            uniLevelSyncView('beforeProfile', el.uniLevelBeforeProfile, true);
            uniLevelSyncView('afterProfile', el.uniLevelAfterProfile, true);
        }
        uniLevelLayoutProbes();
        uniLevelSyncChrome();
    }

    function renderUniLevelAfterOnly() {
        const result = st.edit.uniLevelResult;
        if (!result || !result.correctedData || !st.dataset) return;
        const { width, height } = st.dataset;
        const cmap = el.colormap.value;
        const afterStats = computeRange(result.correctedData);
        const afterDr = segLevelDisplayRange(afterStats.vmin, afterStats.vmax, uniLevelClipFor('after'));
        uniLevelRenderImage(
            el.uniLevelAfter, result.correctedData, width, height,
            afterDr.cmin, afterDr.crange, cmap, 'afterImg', false,
        );
        renderSegLevelPaneColorbar(
            el.uniLevelAfterCb, el.uniLevelAfterCbLo, el.uniLevelAfterCbHi,
            afterStats.vmin, afterStats.vmax, cmap, uniLevelClipFor('after'),
        );
        uniLevelRenderProfiles();
        uniLevelLayoutProbes();
        uniLevelShowFeedback();
    }

    function setUniLevelBusy(busy) {
        if (el.uniLevelBusy) {
            el.uniLevelBusy.classList.toggle('show', !!busy);
            el.uniLevelBusy.setAttribute('aria-hidden', busy ? 'false' : 'true');
        }
        if (el.uniLevelCompare) el.uniLevelCompare.classList.toggle('is-tune-busy', !!busy);
    }

    function scheduleUniLevelApply() {
        st.edit.uniLevelApplyPending = true;
        st.edit.uniLevelRunId = (st.edit.uniLevelRunId || 0) + 1;
        if (st.edit.uniLevelApplyRunning || st.edit.uniLevelApplyRaf) return;
        st.edit.uniLevelApplyRaf = requestAnimationFrame(() => {
            st.edit.uniLevelApplyRaf = 0;
            pumpUniLevelApply();
        });
    }

    async function pumpUniLevelApply() {
        if (st.edit.uniLevelApplyRunning) return;
        st.edit.uniLevelApplyRunning = true;
        updateEditButtons();
        try {
            while (st.edit.uniLevelApplyPending && st.edit.uniLevel) {
                st.edit.uniLevelApplyPending = false;
                const runId = st.edit.uniLevelRunId;
                const base = st.edit.uniLevelBase;
                const result = st.edit.uniLevelResult;
                if (!base || !result || !st.dataset) break;
                const { width, height } = st.dataset;
                const large = typeof segLevelIsLarge === 'function' && segLevelIsLarge(width, height);
                if (large) setUniLevelBusy(true);
                let out = null;
                if (large && typeof uniLevelApplyAsync === 'function') {
                    out = await uniLevelApplyAsync(
                        base.data, width, height, result.lineDir, result.scale, result.k, result.center,
                        result.correctedData,
                        () => runId !== st.edit.uniLevelRunId || !st.edit.uniLevel,
                    );
                } else if (typeof uniLevelApply === 'function') {
                    out = uniLevelApply(
                        base.data, width, height, result.lineDir, result.scale, result.k, result.center,
                        result.correctedData,
                    );
                }
                if (runId !== st.edit.uniLevelRunId || !st.edit.uniLevel || !out) continue;
                result.correctedData = out;
                renderUniLevelAfterOnly();
                el.status.textContent = uniLevelStatusText(result);
            }
        } finally {
            st.edit.uniLevelApplyRunning = false;
            setUniLevelBusy(false);
            updateEditButtons();
            if (st.edit.uniLevelApplyPending && st.edit.uniLevel) scheduleUniLevelApply();
        }
    }

    function uniLevelRefitFromLine(opts) {
        const base = st.edit.uniLevelBase;
        const result = st.edit.uniLevelResult;
        if (!base || !result || !st.dataset || typeof uniLevelFitAt !== 'function') return false;
        const { width, height, header } = st.dataset;
        const index = uniLevelResolveIndex('before');
        const fit = uniLevelFitAt(base.data, width, height, header, result.lineDir, index);
        if (!fit.ok) {
            if (opts && opts.toast) showToast(t('uniLevelInsufficient'), 'info');
            return false;
        }
        result.k = fit.k;
        result.autoK = fit.k;
        result.c = fit.c;
        result.n = fit.n;
        result.scale = fit.scale;
        result.center = fit.center;
        result.segDir = fit.segDir;
        result.probeIndex = fit.probeIndex;
        uniLevelSyncChrome();
        uniLevelRenderProfiles();
        uniLevelShowFeedback();
        el.status.textContent = uniLevelStatusText(result);
        scheduleUniLevelApply();
        return true;
    }

    function uniLevelCommitSlope() {
        const result = st.edit.uniLevelResult;
        if (!result || !el.uniLevelK || !st.edit.uniLevel) return;
        const k = parseFloat(el.uniLevelK.value);
        if (!Number.isFinite(k)) {
            uniLevelSyncChrome();
            return;
        }
        result.k = k;
        uniLevelSyncChrome();
        uniLevelRenderProfiles();
        uniLevelShowFeedback();
        el.status.textContent = uniLevelStatusText(result);
        scheduleUniLevelApply();
    }

    function onUniLevelSlopeKeydown(e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (e.target && typeof e.target.blur === 'function') e.target.blur();
        uniLevelCommitSlope();
    }

    function resetUniLevelSlope() {
        uniLevelRefitFromLine({ toast: true });
    }

    function setUniLevelLineDir(next) {
        const result = st.edit.uniLevelResult;
        if (!st.edit.uniLevel || !result || st.edit.uniLevelApplyRunning) {
            uniLevelSyncChrome();
            return;
        }
        if (next !== 'vertical' && next !== 'horizontal') return;
        if (next === result.lineDir) return;
        const prev = result.lineDir;
        const probe = uniLevelEnsureProbe();
        const prevBefore = probe.before;
        const prevAfter = probe.after;
        result.lineDir = next;
        result.segDir = typeof uniLevelSegDirection === 'function' ? uniLevelSegDirection(next) : result.segDir;
        probe.before = null;
        probe.after = null;
        if (!uniLevelRefitFromLine({ toast: true })) {
            result.lineDir = prev;
            result.segDir = typeof uniLevelSegDirection === 'function' ? uniLevelSegDirection(prev) : result.segDir;
            probe.before = prevBefore;
            probe.after = prevAfter;
            uniLevelSyncChrome();
            uniLevelLayoutProbes();
        } else {
            uniLevelLayoutProbes();
        }
    }

    function onUniLevelProbeToggle() {
        if (!st.edit.uniLevel) return;
        uniLevelLayoutProbes();
    }

    function setupUniLevelZoom() {
        const targets = [
            { wrap: el.uniLevelBefore && el.uniLevelBefore.parentElement, canvas: el.uniLevelBefore, key: 'beforeImg' },
            { wrap: el.uniLevelAfter && el.uniLevelAfter.parentElement, canvas: el.uniLevelAfter, key: 'afterImg' },
            { wrap: el.uniLevelBeforeProfile && el.uniLevelBeforeProfile.parentElement, canvas: el.uniLevelBeforeProfile, key: 'beforeProfile' },
            { wrap: el.uniLevelAfterProfile && el.uniLevelAfterProfile.parentElement, canvas: el.uniLevelAfterProfile, key: 'afterProfile' },
        ];
        for (const item of targets) {
            if (!item.wrap || !item.canvas || item.wrap.dataset.uniZoomBound) continue;
            item.wrap.dataset.uniZoomBound = '1';
            item.wrap.classList.add('seg-level-zoomable');
            if (!item.wrap.querySelector('.seg-level-zoom-ind')) {
                const ind = document.createElement('div');
                ind.className = 'seg-level-zoom-ind';
                ind.setAttribute('aria-hidden', 'true');
                item.wrap.appendChild(ind);
            }
            item.wrap.addEventListener('wheel', (e) => {
                if (!st.edit.uniLevel) return;
                e.preventDefault();
                e.stopPropagation();
                const rect = item.wrap.getBoundingClientRect();
                let dy = e.deltaY;
                if (e.deltaMode === 1) dy *= 16;
                else if (e.deltaMode === 2) dy *= item.wrap.clientHeight;
                uniLevelZoomAt(item.key, item.wrap, item.canvas, e.clientX - rect.left, e.clientY - rect.top, Math.pow(1.0015, -dy));
                if (uniLevelIsProfileZoomKey(item.key)) uniLevelUpdateProfileHoverFromEvent(item.key, e);
            }, { passive: false });
            item.wrap.addEventListener('mousedown', (e) => {
                if (!st.edit.uniLevel || e.button !== 0) return;
                if (e.target.closest && e.target.closest('.seg-level-probe')) return;
                const view = uniLevelEnsureViews()[item.key];
                const peer = uniLevelImagePeer(item.key);
                st.edit.uniLevelPan = {
                    key: item.key,
                    wrap: item.wrap,
                    canvas: item.canvas,
                    peerWrap: peer && peer.canvas ? peer.canvas.parentElement : null,
                    startX: e.clientX,
                    startY: e.clientY,
                    tx: view.tx,
                    ty: view.ty,
                };
                item.wrap.classList.add('grabbing');
                if (st.edit.uniLevelPan.peerWrap) st.edit.uniLevelPan.peerWrap.classList.add('grabbing');
                e.preventDefault();
            });
            if (uniLevelIsProfileZoomKey(item.key)) {
                item.wrap.addEventListener('mousemove', (e) => {
                    if (!st.edit.uniLevel) return;
                    uniLevelUpdateProfileHoverFromEvent(item.key, e);
                });
                item.wrap.addEventListener('mouseleave', () => {
                    const pointer = st.edit.uniLevelProfilePointer;
                    if (pointer && pointer.key === item.key) st.edit.uniLevelProfilePointer = null;
                    uniLevelHideProfileHover(item.key);
                });
            }
            item.wrap.addEventListener('dblclick', (e) => {
                if (!st.edit.uniLevel) return;
                if (e.target.closest && e.target.closest('.seg-level-probe')) return;
                e.preventDefault();
                e.stopPropagation();
                const view = uniLevelEnsureViews()[item.key];
                segLevelFitView(view, item.wrap, view.contentW, view.contentH);
                uniLevelApplyTransform(item.canvas, view);
                if (item.key === 'beforeImg' || item.key === 'afterImg') uniLevelMirrorImage(item.key);
                if (uniLevelIsProfileZoomKey(item.key)) uniLevelUpdateProfileHover();
            });
        }
        if (!st.edit.uniLevelPanBound) {
            st.edit.uniLevelPanBound = true;
            window.addEventListener('mousemove', (e) => {
                const pan = st.edit.uniLevelPan;
                if (!pan) return;
                const view = uniLevelEnsureViews()[pan.key];
                view.tx = pan.tx + (e.clientX - pan.startX);
                view.ty = pan.ty + (e.clientY - pan.startY);
                uniLevelApplyTransform(pan.canvas, view);
                if (pan.key === 'beforeImg' || pan.key === 'afterImg') uniLevelMirrorImage(pan.key);
                if (uniLevelIsProfileZoomKey(pan.key)) uniLevelUpdateProfileHoverFromEvent(pan.key, e);
            });
            window.addEventListener('mouseup', () => {
                const pan = st.edit.uniLevelPan;
                if (!pan) return;
                pan.wrap.classList.remove('grabbing');
                if (pan.peerWrap) pan.peerWrap.classList.remove('grabbing');
                st.edit.uniLevelPan = null;
            });
        }
    }

    function setupUniLevelColorbars() {
        const root = el.uniLevelCompare;
        if (!root || root.dataset.colorBound) return;
        root.dataset.colorBound = '1';
        const MIN_GAP = 0.01;
        let dragging = null;
        let raf = 0;
        const schedule = () => {
            if (raf) return;
            raf = requestAnimationFrame(() => {
                raf = 0;
                if (st.edit.uniLevel && st.edit.uniLevelResult) renderUniLevelCompare({ resetView: false });
            });
        };
        root.querySelectorAll('.seg-level-cbar-handle').forEach((handle) => {
            handle.addEventListener('pointerdown', (e) => {
                if (!st.edit.uniLevel || e.button !== 0) return;
                const cbar = handle.closest('.seg-level-cbar');
                const track = handle.parentElement;
                if (!cbar || !track) return;
                e.preventDefault();
                e.stopPropagation();
                dragging = {
                    which: handle.dataset.which === 'lo' ? 'lo' : 'hi',
                    pane: cbar.dataset.pane === 'after' ? 'after' : 'before',
                    track,
                    handle,
                };
                handle.classList.add('dragging');
                try { handle.setPointerCapture(e.pointerId); } catch (_) { /* 略過 */ }
            });
            handle.addEventListener('pointermove', (e) => {
                if (!dragging || dragging.handle !== handle) return;
                const clip = uniLevelClipFor(dragging.pane);
                const rect = dragging.track.getBoundingClientRect();
                const fromTop = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0;
                const f = 1 - Math.min(1, Math.max(0, fromTop));
                if (dragging.which === 'lo') clip.lo = Math.max(0, Math.min(f, clip.hi - MIN_GAP));
                else clip.hi = Math.min(1, Math.max(f, clip.lo + MIN_GAP));
                schedule();
            });
            const endDrag = () => {
                if (!dragging || dragging.handle !== handle) return;
                handle.classList.remove('dragging');
                dragging = null;
            };
            handle.addEventListener('pointerup', endDrag);
            handle.addEventListener('pointercancel', endDrag);
        });
        root.querySelectorAll('.seg-level-cbar-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                if (!st.edit.uniLevel) return;
                const cbar = btn.closest('.seg-level-cbar');
                if (!cbar) return;
                const pane = cbar.dataset.pane === 'after' ? 'after' : 'before';
                if (btn.dataset.act === 'reset') {
                    const clip = uniLevelClipFor(pane);
                    clip.lo = 0;
                    clip.hi = 1;
                } else {
                    const range = uniLevelVisibleValueRange(pane);
                    if (!range) {
                        showToast(t('segLevelColorViewEmpty'), 'info');
                        return;
                    }
                    uniLevelSetClipRange(pane, range.min, range.max);
                }
                renderUniLevelCompare({ resetView: false });
            });
        });
    }

    function setUniLevelConfigUI(visible) {
        if (el.uniLevelConfig) el.uniLevelConfig.setAttribute('aria-hidden', visible ? 'false' : 'true');
    }

    function enterUniLevelUI(active) {
        if (el.viewer) el.viewer.classList.toggle('uni-level-active', !!active);
        if (el.uniLevelPanel) el.uniLevelPanel.setAttribute('aria-hidden', active ? 'false' : 'true');
        if (el.uniLevel) el.uniLevel.classList.toggle('tool-active', !!active);
        setUniLevelConfigUI(!!active);
        setSegLevelSideUI(!!active);
    }

    function exitUniLevelMode() {
        st.edit.uniLevel = false;
        st.edit.uniLevelRunId = (st.edit.uniLevelRunId || 0) + 1;
        st.edit.uniLevelApplyPending = false;
        st.edit.uniLevelBase = null;
        st.edit.uniLevelResult = null;
        if (st.edit.uniLevelProbe) {
            st.edit.uniLevelProbe.before = null;
            st.edit.uniLevelProbe.after = null;
            st.edit.uniLevelProbe.drag = null;
        }
        uniLevelClearFeedback();
        uniLevelResetClips();
        uniLevelResetViews();
        setUniLevelBusy(false);
        uniLevelLayoutProbes();
        enterUniLevelUI(false);
        updateEditButtons();
    }

    function cancelUniLevel() {
        if (!st.edit.uniLevel) return;
        exitUniLevelMode();
    }

    function startUniLevelMode() {
        if (!editing || !st.dataset) { showToast(t('editNoData'), 'info'); return; }
        if (isScatter(st.dataset)) { showToast(t('uniLevelScatter'), 'info'); return; }
        if (typeof uniLevelFitAt !== 'function') return;
        if (st.edit.uniLevel) { cancelUniLevel(); return; }
        endTransientModes();

        ensureFloatPixels(st.dataset);
        const ds = st.dataset;
        const { width, height } = ds;
        if (!(width > 1) || !(height > 1)) {
            showToast(t('uniLevelInsufficient'), 'info');
            return;
        }
        const baseData = ds.data instanceof Float32Array ? ds.data.slice() : Float32Array.from(ds.data);
        const fit = uniLevelFitAt(baseData, width, height, ds.header, 'horizontal', null);
        if (!fit.ok) {
            showToast(t('uniLevelInsufficient'), 'info');
            return;
        }
        st.edit.uniLevelBase = { data: baseData, vmin: ds.vmin, vmax: ds.vmax };
        st.edit.uniLevelResult = {
            lineDir: 'horizontal',
            segDir: fit.segDir,
            k: fit.k,
            autoK: fit.k,
            c: fit.c,
            n: fit.n,
            scale: fit.scale,
            center: fit.center,
            probeIndex: fit.probeIndex,
            correctedData: null,
        };
        st.edit.uniLevelProbe = { before: null, after: null, drag: null };
        uniLevelResetViews();
        uniLevelResetClips();
        if (el.uniLevelShowProbeBefore) el.uniLevelShowProbeBefore.checked = true;
        if (el.uniLevelShowProbeAfter) el.uniLevelShowProbeAfter.checked = true;
        st.edit.uniLevel = true;
        enterUniLevelUI(true);
        uniLevelSyncChrome();
        el.status.textContent = uniLevelStatusText(st.edit.uniLevelResult);
        updateEditButtons();

        const large = typeof segLevelIsLarge === 'function' && segLevelIsLarge(width, height);
        if (!large) {
            st.edit.uniLevelResult.correctedData = uniLevelApply(
                baseData, width, height, 'horizontal', fit.scale, fit.k, fit.center, null,
            );
            renderUniLevelCompare({ resetView: true });
            uniLevelShowFeedback();
            updateEditButtons();
        } else {
            renderUniLevelCompare({ resetView: true });
            setUniLevelBusy(true);
            scheduleUniLevelApply();
        }
        requestAnimationFrame(() => {
            if (st.edit.uniLevel && st.edit.uniLevelResult) renderUniLevelCompare({ resetView: true });
        });
    }

    function applyUniLevel() {
        const result = st.edit.uniLevelResult;
        const base = st.edit.uniLevelBase;
        if (!st.edit.uniLevel || !result || !base || !st.dataset) return;
        if (st.edit.uniLevelApplyRunning) return;
        if (st.edit.uniLevelApplyPending || !result.correctedData) {
            const { width, height } = st.dataset;
            st.edit.uniLevelApplyPending = false;
            st.edit.uniLevelRunId++;
            result.correctedData = uniLevelApply(
                base.data, width, height, result.lineDir, result.scale, result.k, result.center, result.correctedData,
            );
        }
        if (!result.correctedData) return;
        const lineDir = result.lineDir;
        const k = result.k;
        ensureFloatPixels(st.dataset);
        st.dataset.data = result.correctedData.slice();
        exitUniLevelMode();
        refreshAfterEdit(false);
        pushHistory();
        setLastEditStep({ type: 'uniLevel', lineDir, k });
        const line = lineDir === 'vertical' ? t('uniLevelLineVertical') : t('uniLevelLineHorizontal');
        const msg = t('uniLevelDone', line, segLevelFmtK(k));
        el.status.textContent = msg;
        showToast(msg, 'info');
    }

    /* ---------- 剖面多項式校正（逐列／逐欄擬合，略過無效點） ---------- */

    function profilePolyDirName(direction) {
        return direction === 'vertical' ? t('profilePolyDirNameV') : t('profilePolyDirNameH');
    }

    function profilePolyStatusText(result) {
        if (!result) return '';
        return t('profilePolyMeta', profilePolyDirName(result.direction), result.order, result.fitted || 0, result.skipped || 0);
    }

    function profilePolySyncOrderOptions(direction) {
        const sel = el.profilePolyOrder;
        if (!sel) return;
        const ds = st.dataset;
        const max = (ds && typeof profilePolyMaxOrder === 'function')
            ? profilePolyMaxOrder(ds.width, ds.height, direction)
            : 9;
        const cap = Math.max(1, max);
        for (const opt of sel.options) opt.disabled = Number(opt.value) > cap;
        if (Number(sel.value) > cap) sel.value = String(cap);
    }

    function profilePolySetDirection(direction) {
        const vertical = direction === 'vertical';
        if (el.profilePolyDirH) {
            el.profilePolyDirH.classList.toggle('active', !vertical);
            el.profilePolyDirH.setAttribute('aria-pressed', vertical ? 'false' : 'true');
        }
        if (el.profilePolyDirV) {
            el.profilePolyDirV.classList.toggle('active', vertical);
            el.profilePolyDirV.setAttribute('aria-pressed', vertical ? 'true' : 'false');
        }
    }

    function profilePolyReadDirection() {
        return (el.profilePolyDirV && el.profilePolyDirV.classList.contains('active')) ? 'vertical' : 'horizontal';
    }

    function profilePolySyncChrome() {
        const result = st.edit.profilePolyResult;
        const direction = result ? result.direction : profilePolyReadDirection();
        profilePolySetDirection(direction);
        profilePolySyncOrderOptions(direction);
        if (el.profilePolyOrder && result && document.activeElement !== el.profilePolyOrder) {
            const cap = st.dataset && typeof profilePolyMaxOrder === 'function'
                ? Math.max(1, profilePolyMaxOrder(st.dataset.width, st.dataset.height, direction))
                : 9;
            const order = Math.min(result.order, cap);
            el.profilePolyOrder.value = String(order);
        }
    }

    function profilePolyEnsureViews() {
        if (!st.edit.profilePolyViews) {
            st.edit.profilePolyViews = {
                beforeImg: segLevelDefaultView(),
                afterImg: segLevelDefaultView(),
            };
        }
        return st.edit.profilePolyViews;
    }

    function profilePolyResetViews() {
        st.edit.profilePolyViews = null;
        st.edit.profilePolyPan = null;
    }

    function profilePolyImagePeer(key) {
        if (key === 'beforeImg') return { key: 'afterImg', canvas: el.profilePolyAfter };
        if (key === 'afterImg') return { key: 'beforeImg', canvas: el.profilePolyBefore };
        return null;
    }

    function profilePolyApplyTransform(canvas, view) {
        if (!canvas || !view) return;
        const wrap = canvas.parentElement;
        canvas.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
        canvas.style.transformOrigin = '0 0';
        if (wrap) {
            const ind = wrap.querySelector('.seg-level-zoom-ind');
            if (ind) ind.textContent = segLevelZoomPct(view);
        }
    }

    function profilePolyMirrorImage(fromKey) {
        const peer = profilePolyImagePeer(fromKey);
        if (!peer || !peer.canvas) return;
        const views = profilePolyEnsureViews();
        const src = views[fromKey];
        const dst = views[peer.key];
        if (!src || !dst) return;
        dst.scale = src.scale;
        dst.tx = src.tx;
        dst.ty = src.ty;
        dst.contentW = src.contentW;
        dst.contentH = src.contentH;
        profilePolyApplyTransform(peer.canvas, dst);
    }

    function profilePolySyncView(zoomKey, canvas, resetView) {
        if (!zoomKey || !canvas) return;
        const wrap = canvas.parentElement;
        if (!wrap) return;
        const views = profilePolyEnsureViews();
        const view = views[zoomKey];
        const { cw, ch } = segLevelContentSize(canvas);
        const sizeChanged = view.contentW !== cw || view.contentH !== ch;
        if (resetView || sizeChanged) segLevelFitView(view, wrap, cw, ch);
        profilePolyApplyTransform(canvas, view);
        profilePolyMirrorImage(zoomKey);
    }

    function profilePolyZoomAt(zoomKey, wrap, canvas, screenX, screenY, zoomFactor) {
        const views = profilePolyEnsureViews();
        const view = views[zoomKey];
        let newScale = view.scale * zoomFactor;
        if (newScale < view.minScale) newScale = view.minScale;
        if (newScale > view.maxScale) newScale = view.maxScale;
        const k = newScale / view.scale;
        view.tx = screenX - (screenX - view.tx) * k;
        view.ty = screenY - (screenY - view.ty) * k;
        view.scale = newScale;
        profilePolyApplyTransform(canvas, view);
        profilePolyMirrorImage(zoomKey);
    }

    function profilePolyEnsureClips() {
        if (!st.edit.profilePolyClip) {
            st.edit.profilePolyClip = { before: { lo: 0, hi: 1 }, after: { lo: 0, hi: 1 } };
        }
        return st.edit.profilePolyClip;
    }

    function profilePolyClipFor(pane) {
        const clips = profilePolyEnsureClips();
        return pane === 'after' ? clips.after : clips.before;
    }

    function profilePolyResetClips() {
        st.edit.profilePolyClip = { before: { lo: 0, hi: 1 }, after: { lo: 0, hi: 1 } };
    }

    function profilePolyPaneStats(pane) {
        if (pane === 'after') {
            const data = st.edit.profilePolyResult && st.edit.profilePolyResult.correctedData;
            if (!data) return null;
            const range = computeRange(data);
            return { vmin: range.vmin, vmax: range.vmax, data };
        }
        const base = st.edit.profilePolyBase;
        if (!base) return null;
        return { vmin: base.vmin, vmax: base.vmax, data: base.data };
    }

    function profilePolyVisibleValueRange(pane) {
        const canvas = pane === 'after' ? el.profilePolyAfter : el.profilePolyBefore;
        const wrap = canvas && canvas.parentElement;
        const stats = profilePolyPaneStats(pane);
        if (!canvas || !wrap || !stats || !st.dataset) return null;
        const data = stats.data;
        const view = profilePolyEnsureViews()[pane === 'after' ? 'afterImg' : 'beforeImg'];
        const scale = view.scale || 1;
        const { width, height } = st.dataset;
        const x0 = Math.max(0, Math.floor((0 - view.tx) / scale));
        const y0 = Math.max(0, Math.floor((0 - view.ty) / scale));
        const x1 = Math.min(width, Math.ceil((wrap.clientWidth - view.tx) / scale));
        const y1 = Math.min(height, Math.ceil((wrap.clientHeight - view.ty) / scale));
        if (x1 <= x0 || y1 <= y0) return null;
        let vmin = Infinity;
        let vmax = -Infinity;
        let count = 0;
        for (let y = y0; y < y1; y++) {
            const row = y * width;
            for (let x = x0; x < x1; x++) {
                const v = data[row + x];
                if (!Number.isFinite(v)) continue;
                if (v < vmin) vmin = v;
                if (v > vmax) vmax = v;
                count++;
            }
        }
        if (!count || !(vmax >= vmin)) return null;
        if (!(vmax > vmin)) {
            const pad = Math.max(Math.abs(vmin) * 0.001, 1e-6);
            vmin -= pad;
            vmax += pad;
        }
        return { min: vmin, max: vmax };
    }

    function profilePolySetClipRange(pane, rangeMin, rangeMax) {
        const stats = profilePolyPaneStats(pane);
        if (!stats) return;
        const span = (stats.vmax - stats.vmin) || 1;
        let lo = (rangeMin - stats.vmin) / span;
        let hi = (rangeMax - stats.vmin) / span;
        if (lo < 0) lo = 0;
        if (hi > 1) hi = 1;
        if (hi < lo) { const swap = lo; lo = hi; hi = swap; }
        if (hi - lo < 0.01) {
            const mid = (lo + hi) / 2;
            lo = Math.max(0, mid - 0.005);
            hi = Math.min(1, lo + 0.01);
            if (hi > 1) { hi = 1; lo = 0.99; }
        }
        const clip = profilePolyClipFor(pane);
        clip.lo = lo;
        clip.hi = hi;
    }

    function profilePolyRenderImage(canvas, data, width, height, cmin, crange, cmap, zoomKey, resetView) {
        if (!canvas || !data) return;
        const cw = Math.max(1, width);
        const ch = Math.max(1, height);
        canvas.width = cw;
        canvas.height = ch;
        canvas.style.width = cw + 'px';
        canvas.style.height = ch + 'px';
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(cw, ch);
        const px = img.data;
        const lut = buildColormapLut(cmap);
        const denom = crange || 1e-12;
        for (let y = 0; y < ch; y++) {
            const row = y * width;
            for (let x = 0; x < cw; x++) {
                const v = data[row + x];
                const po = (y * cw + x) * 4;
                if (!Number.isFinite(v)) {
                    paintMissingPixel(px, po);
                    continue;
                }
                let tcol = (v - cmin) / denom;
                if (tcol < 0) tcol = 0;
                else if (tcol > 1) tcol = 1;
                const lo = ((tcol * 255) | 0) * 3;
                px[po] = lut[lo];
                px[po + 1] = lut[lo + 1];
                px[po + 2] = lut[lo + 2];
                px[po + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        profilePolySyncView(zoomKey, canvas, resetView);
    }

    function renderProfilePolyCompare(opts) {
        const resetView = !!(opts && opts.resetView);
        const base = st.edit.profilePolyBase;
        const result = st.edit.profilePolyResult;
        if (!base || !result || !st.dataset) return;
        const { width, height } = st.dataset;
        const cmap = el.colormap.value;
        const beforeDr = segLevelDisplayRange(base.vmin, base.vmax, profilePolyClipFor('before'));
        profilePolyRenderImage(
            el.profilePolyBefore, base.data, width, height,
            beforeDr.cmin, beforeDr.crange, cmap, 'beforeImg', resetView,
        );
        renderSegLevelPaneColorbar(
            el.profilePolyBeforeCb, el.profilePolyBeforeCbLo, el.profilePolyBeforeCbHi,
            base.vmin, base.vmax, cmap, profilePolyClipFor('before'),
        );
        const afterData = result.correctedData;
        if (afterData) {
            const afterStats = computeRange(afterData);
            const afterDr = segLevelDisplayRange(afterStats.vmin, afterStats.vmax, profilePolyClipFor('after'));
            profilePolyRenderImage(
                el.profilePolyAfter, afterData, width, height,
                afterDr.cmin, afterDr.crange, cmap, 'afterImg', resetView,
            );
            renderSegLevelPaneColorbar(
                el.profilePolyAfterCb, el.profilePolyAfterCbLo, el.profilePolyAfterCbHi,
                afterStats.vmin, afterStats.vmax, cmap, profilePolyClipFor('after'),
            );
        }
        profilePolySyncChrome();
    }

    function renderProfilePolyAfterOnly() {
        const result = st.edit.profilePolyResult;
        if (!result || !result.correctedData || !st.dataset) return;
        const { width, height } = st.dataset;
        const cmap = el.colormap.value;
        const afterStats = computeRange(result.correctedData);
        const afterDr = segLevelDisplayRange(afterStats.vmin, afterStats.vmax, profilePolyClipFor('after'));
        profilePolyRenderImage(
            el.profilePolyAfter, result.correctedData, width, height,
            afterDr.cmin, afterDr.crange, cmap, 'afterImg', false,
        );
        renderSegLevelPaneColorbar(
            el.profilePolyAfterCb, el.profilePolyAfterCbLo, el.profilePolyAfterCbHi,
            afterStats.vmin, afterStats.vmax, cmap, profilePolyClipFor('after'),
        );
        profilePolySyncChrome();
    }

    function setProfilePolyBusy(busy, text) {
        if (el.profilePolyBusy) {
            el.profilePolyBusy.classList.toggle('show', !!busy);
            el.profilePolyBusy.setAttribute('aria-hidden', busy ? 'false' : 'true');
        }
        if (el.profilePolyBusyText && text) el.profilePolyBusyText.textContent = text;
        if (el.profilePolyCompare) el.profilePolyCompare.classList.toggle('is-tune-busy', !!busy);
    }

    function scheduleProfilePoly() {
        st.edit.profilePolyApplyPending = true;
        st.edit.profilePolyRunId = (st.edit.profilePolyRunId || 0) + 1;
        updateEditButtons();
        if (st.edit.profilePolyApplyRunning || st.edit.profilePolyApplyRaf) return;
        st.edit.profilePolyApplyRaf = requestAnimationFrame(() => {
            st.edit.profilePolyApplyRaf = 0;
            pumpProfilePoly();
        });
    }

    async function pumpProfilePoly() {
        if (st.edit.profilePolyApplyRunning) return;
        st.edit.profilePolyApplyRunning = true;
        updateEditButtons();
        try {
            while (st.edit.profilePolyApplyPending && st.edit.profilePoly) {
                st.edit.profilePolyApplyPending = false;
                const runId = st.edit.profilePolyRunId;
                const base = st.edit.profilePolyBase;
                const result = st.edit.profilePolyResult;
                if (!base || !result || !st.dataset) break;
                const { width, height } = st.dataset;
                const large = typeof segLevelIsLarge === 'function' && segLevelIsLarge(width, height);
                if (large) setProfilePolyBusy(true, t('profilePolyUpdating'));
                let out = null;
                if (typeof profilePolyCorrectAsync === 'function') {
                    out = await profilePolyCorrectAsync(
                        base.data, width, height, result.order, result.direction, null,
                        () => runId !== st.edit.profilePolyRunId || !st.edit.profilePoly,
                        (fraction) => {
                            if (runId !== st.edit.profilePolyRunId || !large) return;
                            setProfilePolyBusy(true, t('profilePolyProgress', Math.round(fraction * 100)));
                        },
                    );
                }
                if (runId !== st.edit.profilePolyRunId || !st.edit.profilePoly) continue;
                if (!out || !out.ok || !out.data) {
                    showToast(t('profilePolyInsufficient'), 'info');
                    continue;
                }
                result.correctedData = out.data;
                result.fitted = out.fitted;
                result.skipped = out.skipped;
                result.finite = out.finite;
                result.order = out.order;
                result.direction = out.direction;
                renderProfilePolyAfterOnly();
                el.status.textContent = profilePolyStatusText(result);
            }
        } finally {
            st.edit.profilePolyApplyRunning = false;
            setProfilePolyBusy(false);
            updateEditButtons();
            if (st.edit.profilePolyApplyPending && st.edit.profilePoly) scheduleProfilePoly();
        }
    }

    function onProfilePolyParamsChanged() {
        if (!st.edit.profilePoly || !st.edit.profilePolyResult || !st.dataset) return;
        const direction = profilePolyReadDirection();
        profilePolySyncOrderOptions(direction);
        const order = Number(el.profilePolyOrder && el.profilePolyOrder.value);
        const result = st.edit.profilePolyResult;
        if (result.order === order && result.direction === direction
            && result.correctedData
            && !st.edit.profilePolyApplyRunning
            && !st.edit.profilePolyApplyPending) return;
        result.order = order;
        result.direction = direction;
        el.status.textContent = t('profilePolyUpdating');
        scheduleProfilePoly();
    }

    function setProfilePolyDirection(direction) {
        if (!st.edit.profilePoly || !st.edit.profilePolyResult) return;
        if (direction !== 'horizontal' && direction !== 'vertical') return;
        profilePolySetDirection(direction);
        onProfilePolyParamsChanged();
    }

    function setupProfilePolyZoom() {
        const targets = [
            { wrap: el.profilePolyBefore && el.profilePolyBefore.parentElement, canvas: el.profilePolyBefore, key: 'beforeImg' },
            { wrap: el.profilePolyAfter && el.profilePolyAfter.parentElement, canvas: el.profilePolyAfter, key: 'afterImg' },
        ];
        for (const item of targets) {
            if (!item.wrap || !item.canvas || item.wrap.dataset.profilePolyZoomBound) continue;
            item.wrap.dataset.profilePolyZoomBound = '1';
            item.wrap.classList.add('seg-level-zoomable');
            if (!item.wrap.querySelector('.seg-level-zoom-ind')) {
                const ind = document.createElement('div');
                ind.className = 'seg-level-zoom-ind';
                ind.setAttribute('aria-hidden', 'true');
                item.wrap.appendChild(ind);
            }
            item.wrap.addEventListener('wheel', (e) => {
                if (!st.edit.profilePoly) return;
                e.preventDefault();
                e.stopPropagation();
                const rect = item.wrap.getBoundingClientRect();
                let dy = e.deltaY;
                if (e.deltaMode === 1) dy *= 16;
                else if (e.deltaMode === 2) dy *= item.wrap.clientHeight;
                profilePolyZoomAt(item.key, item.wrap, item.canvas, e.clientX - rect.left, e.clientY - rect.top, Math.pow(1.0015, -dy));
            }, { passive: false });
            item.wrap.addEventListener('mousedown', (e) => {
                if (!st.edit.profilePoly || e.button !== 0) return;
                const view = profilePolyEnsureViews()[item.key];
                const peer = profilePolyImagePeer(item.key);
                st.edit.profilePolyPan = {
                    key: item.key,
                    wrap: item.wrap,
                    canvas: item.canvas,
                    peerWrap: peer && peer.canvas ? peer.canvas.parentElement : null,
                    startX: e.clientX,
                    startY: e.clientY,
                    tx: view.tx,
                    ty: view.ty,
                };
                item.wrap.classList.add('grabbing');
                if (st.edit.profilePolyPan.peerWrap) st.edit.profilePolyPan.peerWrap.classList.add('grabbing');
                e.preventDefault();
            });
            item.wrap.addEventListener('dblclick', (e) => {
                if (!st.edit.profilePoly) return;
                e.preventDefault();
                e.stopPropagation();
                const view = profilePolyEnsureViews()[item.key];
                segLevelFitView(view, item.wrap, view.contentW, view.contentH);
                profilePolyApplyTransform(item.canvas, view);
                profilePolyMirrorImage(item.key);
            });
        }
        if (!st.edit.profilePolyPanBound) {
            st.edit.profilePolyPanBound = true;
            window.addEventListener('mousemove', (e) => {
                const pan = st.edit.profilePolyPan;
                if (!pan) return;
                const view = profilePolyEnsureViews()[pan.key];
                view.tx = pan.tx + (e.clientX - pan.startX);
                view.ty = pan.ty + (e.clientY - pan.startY);
                profilePolyApplyTransform(pan.canvas, view);
                profilePolyMirrorImage(pan.key);
            });
            window.addEventListener('mouseup', () => {
                const pan = st.edit.profilePolyPan;
                if (!pan) return;
                pan.wrap.classList.remove('grabbing');
                if (pan.peerWrap) pan.peerWrap.classList.remove('grabbing');
                st.edit.profilePolyPan = null;
            });
        }
    }

    function setupProfilePolyColorbars() {
        const root = el.profilePolyCompare;
        if (!root || root.dataset.colorBound) return;
        root.dataset.colorBound = '1';
        const MIN_GAP = 0.01;
        let dragging = null;
        let raf = 0;
        const schedule = () => {
            if (raf) return;
            raf = requestAnimationFrame(() => {
                raf = 0;
                if (st.edit.profilePoly && st.edit.profilePolyResult) renderProfilePolyCompare({ resetView: false });
            });
        };
        root.querySelectorAll('.seg-level-cbar-handle').forEach((handle) => {
            handle.addEventListener('pointerdown', (e) => {
                if (!st.edit.profilePoly || e.button !== 0) return;
                const cbar = handle.closest('.seg-level-cbar');
                const track = handle.parentElement;
                if (!cbar || !track) return;
                e.preventDefault();
                e.stopPropagation();
                dragging = {
                    which: handle.dataset.which === 'lo' ? 'lo' : 'hi',
                    pane: cbar.dataset.pane === 'after' ? 'after' : 'before',
                    track,
                    handle,
                };
                handle.classList.add('dragging');
                try { handle.setPointerCapture(e.pointerId); } catch (_) { /* 略過 */ }
            });
            handle.addEventListener('pointermove', (e) => {
                if (!dragging || dragging.handle !== handle) return;
                const clip = profilePolyClipFor(dragging.pane);
                const rect = dragging.track.getBoundingClientRect();
                const fromTop = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0;
                const f = 1 - Math.min(1, Math.max(0, fromTop));
                if (dragging.which === 'lo') clip.lo = Math.max(0, Math.min(f, clip.hi - MIN_GAP));
                else clip.hi = Math.min(1, Math.max(f, clip.lo + MIN_GAP));
                schedule();
            });
            const endDrag = () => {
                if (!dragging || dragging.handle !== handle) return;
                handle.classList.remove('dragging');
                dragging = null;
            };
            handle.addEventListener('pointerup', endDrag);
            handle.addEventListener('pointercancel', endDrag);
        });
        root.querySelectorAll('.seg-level-cbar-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                if (!st.edit.profilePoly) return;
                const cbar = btn.closest('.seg-level-cbar');
                if (!cbar) return;
                const pane = cbar.dataset.pane === 'after' ? 'after' : 'before';
                if (btn.dataset.act === 'reset') {
                    const clip = profilePolyClipFor(pane);
                    clip.lo = 0;
                    clip.hi = 1;
                } else {
                    const range = profilePolyVisibleValueRange(pane);
                    if (!range) {
                        showToast(t('segLevelColorViewEmpty'), 'info');
                        return;
                    }
                    profilePolySetClipRange(pane, range.min, range.max);
                }
                renderProfilePolyCompare({ resetView: false });
            });
        });
    }

    function setProfilePolyConfigUI(visible) {
        if (el.profilePolyConfig) el.profilePolyConfig.setAttribute('aria-hidden', visible ? 'false' : 'true');
    }

    function enterProfilePolyUI(active) {
        if (el.viewer) el.viewer.classList.toggle('profile-poly-active', !!active);
        if (el.profilePolyPanel) el.profilePolyPanel.setAttribute('aria-hidden', active ? 'false' : 'true');
        if (el.profilePoly) el.profilePoly.classList.toggle('tool-active', !!active);
        setProfilePolyConfigUI(!!active);
        setSegLevelSideUI(!!active);
    }

    function exitProfilePolyMode() {
        st.edit.profilePoly = false;
        st.edit.profilePolyRunId = (st.edit.profilePolyRunId || 0) + 1;
        st.edit.profilePolyApplyPending = false;
        st.edit.profilePolyBase = null;
        st.edit.profilePolyResult = null;
        profilePolyResetClips();
        profilePolyResetViews();
        setProfilePolyBusy(false);
        enterProfilePolyUI(false);
        updateEditButtons();
    }

    function cancelProfilePoly() {
        if (!st.edit.profilePoly) return;
        exitProfilePolyMode();
    }

    function startProfilePolyMode() {
        if (!editing || !st.dataset) { showToast(t('editNoData'), 'info'); return; }
        if (isScatter(st.dataset)) { showToast(t('profilePolyScatter'), 'info'); return; }
        if (typeof profilePolyCorrectAsync !== 'function') return;
        if (st.edit.profilePoly) { cancelProfilePoly(); return; }
        endTransientModes();

        ensureFloatPixels(st.dataset);
        const ds = st.dataset;
        const { width, height } = ds;
        profilePolySyncOrderOptions('horizontal');
        const order = Number(el.profilePolyOrder && el.profilePolyOrder.value) || 1;
        if (!(width > order) || !(height > 1)) {
            showToast(t('profilePolyInsufficient'), 'info');
            return;
        }
        const baseData = ds.data instanceof Float32Array ? ds.data.slice() : Float32Array.from(ds.data);
        st.edit.profilePolyBase = { data: baseData, vmin: ds.vmin, vmax: ds.vmax };
        st.edit.profilePolyResult = {
            order,
            direction: 'horizontal',
            correctedData: null,
            fitted: 0,
            skipped: 0,
            finite: 0,
        };
        profilePolySetDirection('horizontal');
        profilePolyResetViews();
        profilePolyResetClips();
        st.edit.profilePoly = true;
        enterProfilePolyUI(true);
        profilePolySyncChrome();
        el.status.textContent = t('profilePolyUpdating');
        updateEditButtons();
        renderProfilePolyCompare({ resetView: true });
        scheduleProfilePoly();
        requestAnimationFrame(() => {
            if (st.edit.profilePoly && st.edit.profilePolyResult) renderProfilePolyCompare({ resetView: true });
        });
    }

    function applyProfilePoly() {
        const result = st.edit.profilePolyResult;
        if (!st.edit.profilePoly || !result || !result.correctedData || !st.dataset) return;
        if (st.edit.profilePolyApplyRunning || st.edit.profilePolyApplyPending) return;
        const order = result.order;
        const direction = result.direction;
        ensureFloatPixels(st.dataset);
        st.dataset.data = result.correctedData.slice();
        exitProfilePolyMode();
        refreshAfterEdit(false);
        pushHistory();
        setLastEditStep({ type: 'profilePoly', order, direction });
        const msg = t('profilePolyDone', profilePolyDirName(direction), order);
        el.status.textContent = msg;
        showToast(msg, 'info');
    }

    /* ---------- 擇區水平校正模式（ROI 擬合平面 → 全圖去傾斜） ---------- */

    function roiLevelStatusText(result) {
        if (!result || !result.plane) return '';
        return t('roiLevelMeta', result.plane.n);
    }

    function roiLevelRoiKey(roi) {
        if (!roi) return '';
        return `${roi.shape}:${roi.x0},${roi.y0},${roi.x1},${roi.y1}`;
    }

    function captureRoiLevelRoi() {
        return st.edit.roiLevelRoi ? { ...st.edit.roiLevelRoi } : null;
    }

    function snapshotRoiLevelBase() {
        const ds = st.dataset;
        ensureFloatPixels(ds);
        st.edit.roiLevelBase = {
            data: ds.data.slice(0),
            vmin: ds.vmin,
            vmax: ds.vmax,
            width: ds.width,
            height: ds.height,
            header: ds.header,
        };
    }

    function roiLevelEnsureViews() {
        if (!st.edit.roiLevelViews) {
            st.edit.roiLevelViews = {
                beforeImg: segLevelDefaultView(),
                afterImg: segLevelDefaultView(),
            };
        }
        return st.edit.roiLevelViews;
    }

    function roiLevelResetViews() {
        st.edit.roiLevelViews = null;
        st.edit.roiLevelPan = null;
    }

    function roiLevelSyncViewTransform(zoomKey, canvas, resetView) {
        if (!zoomKey || !canvas) return;
        const wrap = canvas.parentElement;
        if (!wrap) return;
        const views = roiLevelEnsureViews();
        const view = views[zoomKey];
        const { cw, ch } = segLevelContentSize(canvas);
        const sizeChanged = view.contentW !== cw || view.contentH !== ch;
        if (resetView || sizeChanged) segLevelFitView(view, wrap, cw, ch);
        segLevelApplyViewTransform(canvas, view, wrap);
    }

    function roiLevelZoomAt(zoomKey, wrap, canvas, screenX, screenY, zoomFactor) {
        const views = roiLevelEnsureViews();
        const view = views[zoomKey];
        let newScale = view.scale * zoomFactor;
        if (newScale < view.minScale) newScale = view.minScale;
        if (newScale > view.maxScale) newScale = view.maxScale;
        const k = newScale / view.scale;
        view.tx = screenX - (screenX - view.tx) * k;
        view.ty = screenY - (screenY - view.ty) * k;
        view.scale = newScale;
        segLevelApplyViewTransform(canvas, view, wrap);
    }

    function roiLevelRoiNormToWrapSel(roi) {
        if (!roi || !st.dataset) return null;
        const views = roiLevelEnsureViews();
        const view = views.beforeImg;
        const { width, height } = st.dataset;
        const ix0 = roi.x0 * width, ix1 = roi.x1 * width;
        const iy0 = roi.y0 * height, iy1 = roi.y1 * height;
        return {
            x0: ix0 * view.scale + view.tx,
            y0: iy0 * view.scale + view.ty,
            x1: ix1 * view.scale + view.tx,
            y1: iy1 * view.scale + view.ty,
        };
    }

    function roiLevelWrapSelToNorm(sel, shape) {
        if (!sel || !st.dataset) return null;
        const views = roiLevelEnsureViews();
        const view = views.beforeImg;
        const { width, height } = st.dataset;
        const n = normSel(sel);
        const ix0 = (n.x0 - view.tx) / view.scale;
        const iy0 = (n.y0 - view.ty) / view.scale;
        const ix1 = (n.x1 - view.tx) / view.scale;
        const iy1 = (n.y1 - view.ty) / view.scale;
        return {
            shape,
            x0: Math.max(0, Math.min(1, ix0 / width)),
            y0: Math.max(0, Math.min(1, iy0 / height)),
            x1: Math.max(0, Math.min(1, ix1 / width)),
            y1: Math.max(0, Math.min(1, iy1 / height)),
        };
    }

    function drawRoiLevelRoiShape() {
        const sh = el.roiLevelCropShape;
        if (!sh) return;
        const mode = st.edit.roiLevelRoiMode;
        const circle = mode === 'circle' || st.edit.roiLevelRoi?.shape === 'circle';
        sh.classList.toggle('circle', !!circle);
        const sel = st.edit.roiLevelRoiSel || roiLevelRoiNormToWrapSel(st.edit.roiLevelRoi);
        if (!sel || !st.edit.roiLevel) {
            drawRegionShape(sh, null);
            return;
        }
        drawRegionShape(sh, sel);
    }

    function updateRoiLevelMeta() {
        if (!el.roiLevelMeta) return;
        const result = st.edit.roiLevelResult;
        el.roiLevelMeta.textContent = result ? roiLevelStatusText(result) : '';
    }

    function updateRoiLevelRoiUI() {
        const mode = st.edit.roiLevelRoiMode;
        const hasRoi = !!st.edit.roiLevelRoi;
        const wrap = el.roiLevelBeforeWrap || el.roiLevelBefore?.parentElement;
        if (el.roiLevelRoiRect) el.roiLevelRoiRect.classList.toggle('active', mode === 'rect');
        if (el.roiLevelRoiCircle) el.roiLevelRoiCircle.classList.toggle('active', mode === 'circle');
        const roiLocked = !st.edit.roiLevel || st.edit.roiLevelBusy;
        if (el.roiLevelRoiRect) el.roiLevelRoiRect.disabled = roiLocked;
        if (el.roiLevelRoiCircle) el.roiLevelRoiCircle.disabled = roiLocked;
        if (el.roiLevelRoiClear) el.roiLevelRoiClear.disabled = roiLocked || !(hasRoi || !!st.edit.roiLevelRoiSel || !!mode);
        if (wrap) {
            wrap.classList.toggle('crop-active', !!mode);
            wrap.classList.toggle('nan-patch-roi-show', !!(mode || hasRoi || st.edit.roiLevelRoiSel));
        }
        if (el.roiLevelCropOverlay) {
            el.roiLevelCropOverlay.setAttribute('aria-hidden', (mode || hasRoi) ? 'false' : 'true');
        }
        if (el.roiLevelCropHint) {
            el.roiLevelCropHint.style.display = mode ? '' : 'none';
        }
        drawRoiLevelRoiShape();
    }

    function setRoiLevelRoiMode(mode) {
        if (!st.edit.roiLevel || st.edit.roiLevelBusy) return;
        if (st.edit.roiLevelRoiMode === mode) {
            st.edit.roiLevelRoiMode = null;
            st.edit.roiLevelRoiSel = null;
            st.edit.roiLevelRoiAction = null;
        } else {
            if (mode && st.edit.roiLevelRoi && st.edit.roiLevelRoi.shape !== mode) {
                st.edit.roiLevelRoi = null;
                st.edit.roiLevelResult = null;
                updateRoiLevelMeta();
                clearRoiLevelAfterPane();
            }
            st.edit.roiLevelRoiMode = mode;
            st.edit.roiLevelRoiSel = st.edit.roiLevelRoi ? roiLevelRoiNormToWrapSel(st.edit.roiLevelRoi) : null;
            st.edit.roiLevelRoiAction = null;
            if (el.roiLevelCropShape) el.roiLevelCropShape.classList.toggle('circle', mode === 'circle');
        }
        updateRoiLevelRoiUI();
        updateEditButtons();
    }

    function clearRoiLevelRoi() {
        if (!st.edit.roiLevel || st.edit.roiLevelBusy) return;
        st.edit.roiLevelRoiMode = 'rect';
        st.edit.roiLevelRoi = null;
        st.edit.roiLevelRoiSel = null;
        st.edit.roiLevelRoiAction = null;
        st.edit.roiLevelResult = null;
        updateRoiLevelMeta();
        clearRoiLevelAfterPane();
        updateRoiLevelRoiUI();
        updateEditButtons();
        el.status.textContent = t('roiLevelProcessing');
    }

    function startRoiLevelBeforePan(e) {
        if (!st.edit.roiLevel || st.edit.roiLevelBusy || !st.edit.roiLevelRoiMode) return;
        const wrap = el.roiLevelBeforeWrap || el.roiLevelBefore?.parentElement;
        const canvas = el.roiLevelBefore;
        if (!wrap || !canvas) return;
        const views = roiLevelEnsureViews();
        const view = views.beforeImg;
        st.edit.roiLevelPan = {
            key: 'beforeImg',
            wrap,
            canvas,
            startX: e.clientX,
            startY: e.clientY,
            tx: view.tx,
            ty: view.ty,
        };
        wrap.classList.add('grabbing');
        e.preventDefault();
    }

    function setupRoiLevelMiddlePan() {
        const wrap = el.roiLevelBeforeWrap || el.roiLevelBefore?.parentElement;
        const overlay = el.roiLevelCropOverlay;
        [wrap, overlay].forEach((node) => {
            if (!node || node.dataset.roiLevelMidPanBound) return;
            node.dataset.roiLevelMidPanBound = '1';
            node.addEventListener('mousedown', (e) => {
                if (e.button !== 1) return;
                startRoiLevelBeforePan(e);
            });
        });
    }

    function onRoiLevelRoiSelectEnd(act) {
        const mode = st.edit.roiLevelRoiMode;
        if (!mode) return;
        if (st.edit.roiLevelRoiSel) {
            const n = normSel(st.edit.roiLevelRoiSel);
            if ((n.x1 - n.x0) < CROP_MIN || (n.y1 - n.y0) < CROP_MIN) {
                st.edit.roiLevelRoiSel = st.edit.roiLevelRoi ? roiLevelRoiNormToWrapSel(st.edit.roiLevelRoi) : null;
                updateRoiLevelRoiUI();
                return;
            }
            st.edit.roiLevelRoi = roiLevelWrapSelToNorm(st.edit.roiLevelRoiSel, mode);
        } else if (act.type === 'draw' && st.edit.roiLevelRoi) {
            st.edit.roiLevelRoiSel = roiLevelRoiNormToWrapSel(st.edit.roiLevelRoi);
        } else {
            st.edit.roiLevelRoi = null;
        }
        updateRoiLevelRoiUI();
        recomputeRoiLevelPreview({ resetView: false, force: true });
    }

    function setupRoiLevelCropOverlay() {
        const wrap = el.roiLevelBeforeWrap || el.roiLevelBefore?.parentElement;
        setupRegionSelectOverlay({
            overlay: el.roiLevelCropOverlay,
            shape: el.roiLevelCropShape,
            container: wrap,
            isActive: () => st.edit.roiLevel && st.edit.roiLevelRoiMode && !st.edit.roiLevelBusy,
            getSel: () => st.edit.roiLevelRoiSel,
            setSel: (v) => { st.edit.roiLevelRoiSel = v; },
            getAction: () => st.edit.roiLevelRoiAction,
            setAction: (v) => { st.edit.roiLevelRoiAction = v; },
            onEnd: onRoiLevelRoiSelectEnd,
        });
    }

    function setupRoiLevelZoom() {
        const beforeWrap = el.roiLevelBeforeWrap || el.roiLevelBefore?.parentElement;
        const targets = [
            { wrap: beforeWrap, canvas: el.roiLevelBefore, key: 'beforeImg' },
            { wrap: el.roiLevelAfter?.parentElement, canvas: el.roiLevelAfter, key: 'afterImg' },
        ];
        for (const tgt of targets) {
            if (!tgt.wrap || !tgt.canvas || tgt.wrap.dataset.roiLevelZoomBound) continue;
            tgt.wrap.dataset.roiLevelZoomBound = '1';
            tgt.wrap.classList.add('seg-level-zoomable');
            if (!tgt.wrap.querySelector('.seg-level-zoom-ind')) {
                const ind = document.createElement('div');
                ind.className = 'seg-level-zoom-ind';
                ind.setAttribute('aria-hidden', 'true');
                tgt.wrap.appendChild(ind);
            }
            tgt.wrap.addEventListener('wheel', (e) => {
                if (!st.edit.roiLevel || st.edit.roiLevelBusy) return;
                e.preventDefault();
                e.stopPropagation();
                const rect = tgt.wrap.getBoundingClientRect();
                roiLevelZoomAt(tgt.key, tgt.wrap, tgt.canvas, e.clientX - rect.left, e.clientY - rect.top,
                    Math.pow(1.0015, -(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * tgt.wrap.clientHeight : e.deltaY)));
                if (tgt.key === 'beforeImg') drawRoiLevelRoiShape();
            }, { passive: false });
            tgt.wrap.addEventListener('mousedown', (e) => {
                if (!st.edit.roiLevel || st.edit.roiLevelBusy) return;
                const isMid = e.button === 1;
                if (e.button !== 0 && !isMid) return;
                if (tgt.key === 'beforeImg' && tgt.wrap.classList.contains('crop-active')) {
                    if (!isMid) return;
                    startRoiLevelBeforePan(e);
                    return;
                }
                const views = roiLevelEnsureViews();
                const view = views[tgt.key];
                st.edit.roiLevelPan = {
                    key: tgt.key,
                    wrap: tgt.wrap,
                    canvas: tgt.canvas,
                    startX: e.clientX,
                    startY: e.clientY,
                    tx: view.tx,
                    ty: view.ty,
                };
                tgt.wrap.classList.add('grabbing');
                e.preventDefault();
            });
            tgt.wrap.addEventListener('dblclick', (e) => {
                if (!st.edit.roiLevel || st.edit.roiLevelBusy) return;
                e.preventDefault();
                const views = roiLevelEnsureViews();
                const view = views[tgt.key];
                segLevelFitView(view, tgt.wrap, view.contentW, view.contentH);
                segLevelApplyViewTransform(tgt.canvas, view, tgt.wrap);
                if (tgt.key === 'beforeImg') drawRoiLevelRoiShape();
            });
        }
        if (!st.edit.roiLevelPanBound) {
            st.edit.roiLevelPanBound = true;
            window.addEventListener('mousemove', (e) => {
                const pan = st.edit.roiLevelPan;
                if (!pan) return;
                const views = roiLevelEnsureViews();
                const view = views[pan.key];
                view.tx = pan.tx + (e.clientX - pan.startX);
                view.ty = pan.ty + (e.clientY - pan.startY);
                segLevelApplyViewTransform(pan.canvas, view, pan.wrap);
                if (pan.key === 'beforeImg') drawRoiLevelRoiShape();
            });
            window.addEventListener('mouseup', () => {
                const pan = st.edit.roiLevelPan;
                if (!pan) return;
                pan.wrap.classList.remove('grabbing');
                st.edit.roiLevelPan = null;
            });
        }
    }

    function renderRoiLevelCanvas(canvas, data, width, height, cmin, crange, cmap, zoomKey, resetView) {
        if (!canvas) return;
        const cw = Math.max(1, width);
        const ch = Math.max(1, height);
        canvas.width = cw;
        canvas.height = ch;
        canvas.style.width = cw + 'px';
        canvas.style.height = ch + 'px';
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(cw, ch);
        const px = img.data;
        const lut = buildColormapLut(cmap);
        for (let y = 0; y < ch; y++) {
            const rowBase = y * width;
            for (let x = 0; x < cw; x++) {
                const v = data[rowBase + x];
                const po = (y * cw + x) * 4;
                if (!Number.isFinite(v)) {
                    paintMissingPixel(px, po);
                    continue;
                }
                let t = (v - cmin) / crange;
                if (t < 0) t = 0; else if (t > 1) t = 1;
                const lo = ((t * 255) | 0) * 3;
                px[po] = lut[lo]; px[po + 1] = lut[lo + 1]; px[po + 2] = lut[lo + 2]; px[po + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        roiLevelSyncViewTransform(zoomKey, canvas, resetView);
        if (zoomKey === 'beforeImg') drawRoiLevelRoiShape();
    }

    function setRoiLevelConfigUI(visible) {
        if (el.roiLevelConfig) el.roiLevelConfig.setAttribute('aria-hidden', visible ? 'false' : 'true');
    }

    function setRoiLevelBusyUI(busy) {
        st.edit.roiLevelBusy = !!busy;
        if (el.roiLevelCompare) el.roiLevelCompare.classList.toggle('is-tune-busy', !!busy);
        if (el.roiLevelBusy) {
            el.roiLevelBusy.classList.toggle('show', !!busy);
            el.roiLevelBusy.setAttribute('aria-hidden', busy ? 'false' : 'true');
        }
        updateRoiLevelRoiUI();
        updateEditButtons();
    }

    function clearRoiLevelAfterPane() {
        if (el.roiLevelAfter) {
            const c = el.roiLevelAfter;
            const ctx = c.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, c.width, c.height);
        }
        if (el.roiLevelAfterCbLo) el.roiLevelAfterCbLo.textContent = '';
        if (el.roiLevelAfterCbHi) el.roiLevelAfterCbHi.textContent = '';
    }

    function renderRoiLevelCompare(opts) {
        const resetView = !!(opts && opts.resetView);
        const base = st.edit.roiLevelBase;
        const result = st.edit.roiLevelResult;
        if (!base || !result || !st.dataset) return;
        const ds = st.dataset;
        const cmap = el.colormap.value;
        const { width, height } = ds;
        const afterData = result.correctedData;
        const afterStats = computeRange(afterData);
        const beforeDr = segLevelDisplayRange(base.vmin, base.vmax, st.colorClip);
        const afterDr = segLevelDisplayRange(afterStats.vmin, afterStats.vmax, st.colorClip);
        renderRoiLevelCanvas(
            el.roiLevelBefore, base.data, width, height,
            beforeDr.cmin, beforeDr.crange, cmap, 'beforeImg', resetView,
        );
        renderRoiLevelCanvas(
            el.roiLevelAfter, afterData, width, height,
            afterDr.cmin, afterDr.crange, cmap, 'afterImg', resetView,
        );
        renderSegLevelPaneColorbar(
            el.roiLevelBeforeCb, el.roiLevelBeforeCbLo, el.roiLevelBeforeCbHi,
            base.vmin, base.vmax, cmap, st.colorClip,
        );
        renderSegLevelPaneColorbar(
            el.roiLevelAfterCb, el.roiLevelAfterCbLo, el.roiLevelAfterCbHi,
            afterStats.vmin, afterStats.vmax, cmap, st.colorClip,
        );
        updateRoiLevelMeta();
        drawRoiLevelRoiShape();
    }

    function renderRoiLevelBeforeOnly() {
        const base = st.edit.roiLevelBase;
        if (!base || !st.dataset) return;
        const cmap = el.colormap.value;
        const { width, height } = st.dataset;
        const dr = segLevelDisplayRange(base.vmin, base.vmax, st.colorClip);
        renderRoiLevelCanvas(
            el.roiLevelBefore, base.data, width, height,
            dr.cmin, dr.crange, cmap, 'beforeImg', true,
        );
        renderSegLevelPaneColorbar(
            el.roiLevelBeforeCb, el.roiLevelBeforeCbLo, el.roiLevelBeforeCbHi,
            base.vmin, base.vmax, cmap, st.colorClip,
        );
        clearRoiLevelAfterPane();
    }

    async function recomputeRoiLevelPreview(options) {
        options = options || {};
        const base = st.edit.roiLevelBase;
        if (!st.edit.roiLevel || !base || !st.dataset) return;

        const roi = captureRoiLevelRoi();
        if (!roi) {
            st.edit.roiLevelResult = null;
            updateRoiLevelMeta();
            clearRoiLevelAfterPane();
            updateEditButtons();
            el.status.textContent = t('roiLevelNeedRoi');
            return;
        }

        const roiKey = roiLevelRoiKey(roi);
        const prev = st.edit.roiLevelResult;
        if (prev && prev.roiKey === roiKey && !options.force) {
            renderRoiLevelCompare({ resetView: !!options.resetView });
            return;
        }

        const runId = ++st.edit.roiLevelRunId;
        setRoiLevelBusyUI(true);
        await segLevelYield();
        if (runId !== st.edit.roiLevelRunId) {
            setRoiLevelBusyUI(false);
            return;
        }

        try {
            if (typeof analyzeRoiLeveling !== 'function') return;
            const dsProxy = {
                data: base.data,
                width: base.width,
                height: base.height,
                header: base.header,
                type: 'grid',
            };
            const analysis = analyzeRoiLeveling(dsProxy, roi);
            if (runId !== st.edit.roiLevelRunId) return;
            if (!analysis.ok) {
                st.edit.roiLevelResult = null;
                updateRoiLevelMeta();
                clearRoiLevelAfterPane();
                if (analysis.reason === 'insufficient') showToast(t('roiLevelInsufficient'), 'info');
                else showToast(t('roiLevelNeedRoi'), 'info');
                el.status.textContent = t('roiLevelNeedRoi');
                updateEditButtons();
                return;
            }
            st.edit.roiLevelResult = {
                correctedData: analysis.correctedData,
                plane: analysis.plane,
                roi: analysis.roi,
                roiKey,
            };
            renderRoiLevelCompare({ resetView: !!options.resetView });
            el.status.textContent = roiLevelStatusText(st.edit.roiLevelResult);
        } finally {
            if (runId === st.edit.roiLevelRunId) setRoiLevelBusyUI(false);
        }
    }

    function enterRoiLevelUI(active) {
        if (el.viewer) el.viewer.classList.toggle('roi-level-active', active);
        if (el.roiLevelPanel) el.roiLevelPanel.setAttribute('aria-hidden', active ? 'false' : 'true');
        if (el.roiLevel) el.roiLevel.classList.toggle('tool-active', active);
        if (active && !st.edit.roiLevelBusy && st.edit.roiLevelResult) {
            requestAnimationFrame(() => renderRoiLevelCompare({ resetView: true }));
        }
    }

    function exitRoiLevelMode() {
        st.edit.roiLevel = false;
        st.edit.roiLevelBusy = false;
        st.edit.roiLevelRunId++;
        st.edit.roiLevelBase = null;
        st.edit.roiLevelResult = null;
        st.edit.roiLevelRoiMode = null;
        st.edit.roiLevelRoi = null;
        st.edit.roiLevelRoiSel = null;
        st.edit.roiLevelRoiAction = null;
        roiLevelResetViews();
        setRoiLevelBusyUI(false);
        setRoiLevelConfigUI(false);
        updateRoiLevelMeta();
        enterRoiLevelUI(false);
        updateRoiLevelRoiUI();
        updateEditButtons();
    }

    function cancelRoiLevel() {
        if (!st.edit.roiLevel) return;
        st.edit.roiLevelRunId++;
        const base = st.edit.roiLevelBase;
        if (base && st.dataset && !st.edit.roiLevelBusy) {
            st.dataset.data = base.data.slice();
            st.dataset.vmin = base.vmin;
            st.dataset.vmax = base.vmax;
            resetColorClip(false);
            render(st.dataset, el.colormap.value, false);
        }
        exitRoiLevelMode();
    }

    async function startRoiLevelMode() {
        if (!editing || !st.dataset) { showToast(t('editNoData'), 'info'); return; }
        if (isScatter(st.dataset)) { showToast(t('roiLevelScatter'), 'info'); return; }
        if (st.edit.roiLevel) {
            if (st.edit.roiLevelBusy) {
                st.edit.roiLevelRunId++;
                exitRoiLevelMode();
            } else {
                cancelRoiLevel();
            }
            return;
        }

        endTransientModes();

        snapshotRoiLevelBase();
        roiLevelResetViews();
        st.edit.roiLevel = true;
        st.edit.roiLevelResult = null;
        st.edit.roiLevelRoiMode = 'rect';
        st.edit.roiLevelRoi = null;
        st.edit.roiLevelRoiSel = null;
        st.edit.roiLevelRoiAction = null;

        enterRoiLevelUI(true);
        setRoiLevelConfigUI(true);
        updateRoiLevelMeta();
        updateRoiLevelRoiUI();
        renderRoiLevelBeforeOnly();
        updateEditButtons();
        el.status.textContent = t('roiLevelProcessing');
    }

    function applyRoiLevelEdit() {
        if (!st.edit.roiLevel || st.edit.roiLevelBusy || !st.edit.roiLevelResult || !st.dataset) return;
        const result = st.edit.roiLevelResult;
        ensureFloatPixels(st.dataset);
        st.dataset.data = result.correctedData.slice();
        exitRoiLevelMode();
        refreshAfterEdit(false);
        pushHistory();
        setLastEditStep({ type: 'roiLevel', roi: { ...result.roi } });
        const msg = t('roiLevelDone', result.plane.n);
        el.status.textContent = msg;
        showToast(msg, 'info');
    }

    /* ---------- 分區校正模式（自動分割 + 各區水平校正） ---------- */

    function segLevelDirLabel(direction) {
        return direction === 'vertical' ? t('segLevelDirVertical') : t('segLevelDirHorizontal');
    }

    function segLevelConfigLimits(direction) {
        if (!st.dataset || typeof segLevelBoundaryOptionsForDirection !== 'function') return null;
        const { width, height } = st.dataset;
        const dir = direction === 'vertical' ? 'vertical' : 'horizontal';
        const opts = segLevelBoundaryOptionsForDirection(width, height, dir);
        const maxBands = typeof segLevelMaxValidBandCount === 'function'
            ? segLevelMaxValidBandCount(opts.axisLen, opts.minDist, opts.edgeMargin)
            : 20;
        return { ...opts, maxBands: Math.max(2, maxBands) };
    }

    function setSegLevelConfigUI(visible) {
        if (el.segLevelConfig) el.segLevelConfig.setAttribute('aria-hidden', visible ? 'false' : 'true');
    }

    /** 進入模式時只帶出方向與等份數，不啟動分析。 */
    function resetSegLevelManualConfig() {
        setSegLevelConfigUI(true);
        if (el.segLevelDir) el.segLevelDir.value = 'horizontal';
        const limits = segLevelConfigLimits('horizontal');
        if (el.segLevelCount) {
            el.segLevelCount.min = '2';
            el.segLevelCount.max = String(limits ? limits.maxBands : 20);
            el.segLevelCount.value = '2';
        }
    }

    function syncSegLevelConfigUI() {
        const result = st.edit.segLevelResult;
        if (!result) return;
        const limits = segLevelConfigLimits(result.direction);
        if (el.segLevelDir) el.segLevelDir.value = result.direction;
        if (el.segLevelCount && limits) {
            el.segLevelCount.min = '2';
            el.segLevelCount.max = String(limits.maxBands);
            el.segLevelCount.value = String(result.segmentCount);
        }
    }

    function readSegLevelConfigFromUI() {
        const direction = el.segLevelDir?.value === 'vertical' ? 'vertical' : 'horizontal';
        let segmentCount = parseInt(el.segLevelCount?.value, 10);
        const limits = segLevelConfigLimits(direction);
        const maxBands = limits ? limits.maxBands : 20;
        if (!Number.isFinite(segmentCount)) segmentCount = 2;
        if (segmentCount < 2) segmentCount = 2;
        if (segmentCount > maxBands) segmentCount = maxBands;
        if (el.segLevelCount) {
            el.segLevelCount.min = '2';
            el.segLevelCount.max = String(maxBands);
            el.segLevelCount.value = String(segmentCount);
        }
        return { direction, segmentCount, maxBands };
    }

    function segLevelStatusText(result) {
        if (!result) return '';
        return t('segLevelMeta', segLevelDirLabel(result.direction), result.segmentCount);
    }

    function snapshotSegLevelBase() {
        const ds = st.dataset;
        const src = ds.data;
        st.edit.segLevelBase = {
            data: src instanceof Float32Array ? src.slice() : Float32Array.from(src),
            vmin: ds.vmin,
            vmax: ds.vmax,
        };
    }

    function segLevelDisplayRange(vmin, vmax, clip) {
        const span = (vmax - vmin) || 1;
        const lo = clip && Number.isFinite(clip.lo) ? clip.lo : 0;
        const hi = clip && Number.isFinite(clip.hi) ? clip.hi : 1;
        const cmin = vmin + lo * span;
        const cmax = vmin + hi * span;
        return {
            cmin,
            cmax,
            crange: (cmax > cmin) ? (cmax - cmin) : 1e-12,
        };
    }

    /** colorbar / 剖面圖軸標籤：依數值大小選小數位，僅極端值才用科學記號 */
    function segLevelFmt(v) {
        if (!Number.isFinite(v)) return '-';
        const a = Math.abs(v);
        if (a === 0) return '0';
        if (a >= 1e7 || (a > 0 && a < 1e-6)) return v.toExponential(2);

        let decimals;
        if (a >= 10000) decimals = 0;
        else if (a >= 1000) decimals = 1;
        else if (a >= 100) decimals = 1;
        else if (a >= 1) decimals = 2;
        else if (a >= 0.01) decimals = 3;
        else decimals = 4;

        const rounded = Number(v.toFixed(decimals));
        if (a >= 1000) {
            return rounded.toLocaleString(undefined, {
                minimumFractionDigits: 0,
                maximumFractionDigits: decimals,
            });
        }
        return String(rounded);
    }

    /** 水平分割 → 指定欄的垂直剖線；垂直分割 → 指定列的水平剖線 */
    function segLevelExtractProfile(data, width, height, direction, index) {
        if (typeof segLevelExtractProfileAt === 'function') {
            return segLevelExtractProfileAt(data, width, height, direction, index);
        }
        return [];
    }

    function segLevelEnsureProbeState() {
        if (!st.edit.segLevelProbe) {
            st.edit.segLevelProbe = { before: null, after: null, drag: null };
        }
        return st.edit.segLevelProbe;
    }

    function segLevelResetProbeIndices() {
        const probe = segLevelEnsureProbeState();
        probe.before = null;
        probe.after = null;
        probe.drag = null;
    }

    function segLevelCancelProbeCorrection() {
        st.edit.segLevelProbeRunId = (st.edit.segLevelProbeRunId || 0) + 1;
        st.edit.segLevelProbePending = false;
    }

    /** null 表示正中間。水平分割的索引是 X，垂直分割是 Y。 */
    function segLevelResolveProbeIndex(pane, direction, width, height) {
        const probe = segLevelEnsureProbeState();
        const stored = probe[pane];
        if (typeof segLevelClampProfileIndex === 'function') {
            return segLevelClampProfileIndex(width, height, direction, stored);
        }
        const len = direction === 'horizontal' ? width : height;
        const max = Math.max(0, len - 1);
        let i = Number.isFinite(stored) ? Math.round(stored) : (len >> 1);
        if (i < 0) i = 0;
        if (i > max) i = max;
        return i;
    }

    function segLevelProbePaneNodes(pane) {
        const canvas = pane === 'before' ? el.segLevelBefore : el.segLevelAfter;
        const wrap = canvas ? canvas.parentElement : null;
        return { canvas, wrap };
    }

    function segLevelEnsureProbeEl(pane) {
        const { wrap } = segLevelProbePaneNodes(pane);
        if (!wrap) return null;
        let probe = wrap.querySelector('.seg-level-probe');
        if (!probe) {
            probe = document.createElement('div');
            probe.className = 'seg-level-probe';
            probe.dataset.pane = pane;
            probe.tabIndex = 0;
            probe.hidden = true;
            const line = document.createElement('div');
            line.className = 'seg-level-probe-line';
            probe.appendChild(line);
            wrap.appendChild(probe);
            segLevelBindProbe(probe, pane);
        }
        return probe;
    }

    function segLevelHideProbes() {
        segLevelLayoutProbe('before');
        segLevelLayoutProbe('after');
    }

    function segLevelLayoutProbe(pane) {
        const probe = segLevelEnsureProbeEl(pane);
        const { wrap } = segLevelProbePaneNodes(pane);
        if (!probe || !wrap) return;
        const result = st.edit.segLevelResult;
        const active = !!(st.edit.segLevel && result && st.dataset && !probe.dataset.suppress);
        const shown = active && segLevelProbeVisible(pane);
        if (!shown) {
            probe.hidden = true;
            if (st.edit.segLevelProbe && st.edit.segLevelProbe.drag && st.edit.segLevelProbe.drag.pane === pane) {
                st.edit.segLevelProbe.drag = null;
                probe.classList.remove('is-dragging');
            }
            wrap.classList.remove('seg-level-probe-dragging');
            wrap.style.cursor = '';
            return;
        }
        const direction = result.direction;
        const { width, height } = st.dataset;
        const index = segLevelResolveProbeIndex(pane, direction, width, height);
        const zoomKey = pane === 'before' ? 'beforeImg' : 'afterImg';
        const view = segLevelEnsureViews()[zoomKey];
        const vertical = direction === 'horizontal';
        probe.hidden = false;
        probe.classList.toggle('is-vertical', vertical);
        probe.classList.toggle('is-horizontal', !vertical);
        probe.setAttribute('role', 'slider');
        probe.setAttribute('aria-orientation', vertical ? 'vertical' : 'horizontal');
        probe.setAttribute('aria-valuemin', '0');
        const max = vertical ? width - 1 : height - 1;
        probe.setAttribute('aria-valuemax', String(max));
        probe.setAttribute('aria-valuenow', String(index));
        const label = vertical ? t('segLevelProbeVertical') : t('segLevelProbeHorizontal');
        probe.title = label;
        probe.setAttribute('aria-label', label);

        if (vertical) {
            const x = view.tx + (index + 0.5) * view.scale;
            const y = view.ty;
            const h = (view.contentH || height) * view.scale;
            probe.style.left = x + 'px';
            probe.style.top = y + 'px';
            probe.style.width = '';
            probe.style.height = Math.max(0, h) + 'px';
        } else {
            const y = view.ty + (index + 0.5) * view.scale;
            const x = view.tx;
            const w = (view.contentW || width) * view.scale;
            probe.style.left = x + 'px';
            probe.style.top = y + 'px';
            probe.style.height = '';
            probe.style.width = Math.max(0, w) + 'px';
        }
    }

    function segLevelLayoutProbes() {
        segLevelLayoutProbe('before');
        segLevelLayoutProbe('after');
    }

    function segLevelSetProbeIndex(pane, rawIndex) {
        const result = st.edit.segLevelResult;
        if (!result || !st.dataset || !st.edit.segLevel) return;
        const { width, height } = st.dataset;
        const current = segLevelResolveProbeIndex(pane, result.direction, width, height);
        const resolved = typeof segLevelClampProfileIndex === 'function'
            ? segLevelClampProfileIndex(width, height, result.direction, rawIndex)
            : current;
        if (current === resolved) {
            segLevelLayoutProbe(pane);
            return;
        }
        segLevelEnsureProbeState()[pane] = resolved;
        segLevelLayoutProbe(pane);
        if (pane === 'before') segLevelApplyBeforeProbeSlope();
        else renderSegLevelAfterProfileOnly();
    }

    function segLevelProbeIndexFromEvent(pane, e) {
        const result = st.edit.segLevelResult;
        const { wrap } = segLevelProbePaneNodes(pane);
        if (!result || !wrap || !st.dataset) return null;
        const zoomKey = pane === 'before' ? 'beforeImg' : 'afterImg';
        const view = segLevelEnsureViews()[zoomKey];
        if (!view || !view.scale) return null;
        const rect = wrap.getBoundingClientRect();
        const vertical = result.direction === 'horizontal';
        const local = vertical ? (e.clientX - rect.left) : (e.clientY - rect.top);
        const origin = vertical ? view.tx : view.ty;
        return (local - origin) / view.scale - 0.5;
    }

    function segLevelBindProbe(probe, pane) {
        probe.addEventListener('pointerdown', (e) => {
            if (!st.edit.segLevel || st.edit.segLevelBusy || st.edit.segLevelTuneBusy || e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            try { probe.setPointerCapture(e.pointerId); } catch (err) { /* 指標尚未按下時略過 */ }
            const state = segLevelEnsureProbeState();
            state.drag = { pane, pointerId: e.pointerId };
            probe.classList.add('is-dragging');
            const { wrap } = segLevelProbePaneNodes(pane);
            if (wrap) {
                wrap.classList.add('seg-level-probe-dragging');
                const vertical = st.edit.segLevelResult && st.edit.segLevelResult.direction === 'horizontal';
                wrap.style.cursor = vertical ? 'ew-resize' : 'ns-resize';
            }
        });
        probe.addEventListener('pointermove', (e) => {
            const drag = st.edit.segLevelProbe && st.edit.segLevelProbe.drag;
            if (!drag || drag.pane !== pane || drag.pointerId !== e.pointerId) return;
            const raw = segLevelProbeIndexFromEvent(pane, e);
            if (raw == null) return;
            segLevelSetProbeIndex(pane, raw);
        });
        const endDrag = (e) => {
            const drag = st.edit.segLevelProbe && st.edit.segLevelProbe.drag;
            if (!drag || drag.pointerId !== e.pointerId) return;
            st.edit.segLevelProbe.drag = null;
            probe.classList.remove('is-dragging');
            const { wrap } = segLevelProbePaneNodes(pane);
            if (wrap) {
                wrap.classList.remove('seg-level-probe-dragging');
                wrap.style.cursor = '';
            }
            if (pane === 'before' && !st.edit.segLevelProbePending && !st.edit.segLevelProbeRunning) {
                segLevelShowProbeFeedback();
            }
        };
        probe.addEventListener('pointerup', endDrag);
        probe.addEventListener('pointercancel', endDrag);
        probe.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
        probe.addEventListener('keydown', (e) => {
            if (!st.edit.segLevel || st.edit.segLevelBusy || !st.edit.segLevelResult || !st.dataset) return;
            const vertical = st.edit.segLevelResult.direction === 'horizontal';
            let delta = 0;
            if (vertical && e.key === 'ArrowLeft') delta = -1;
            else if (vertical && e.key === 'ArrowRight') delta = 1;
            else if (!vertical && e.key === 'ArrowUp') delta = -1;
            else if (!vertical && e.key === 'ArrowDown') delta = 1;
            else return;
            e.preventDefault();
            const { width, height } = st.dataset;
            const cur = segLevelResolveProbeIndex(pane, st.edit.segLevelResult.direction, width, height);
            segLevelSetProbeIndex(pane, cur + delta);
        });
    }

    function segLevelApplyBeforeProbeSlope() {
        const base = st.edit.segLevelBase;
        const result = st.edit.segLevelResult;
        if (!base || !result || !result.plan || !st.dataset) return;
        const { width, height } = st.dataset;
        const index = segLevelResolveProbeIndex('before', result.direction, width, height);
        renderSegLevelBeforeProfileOnly();
        if (typeof segLevelSharedSlopeFromProfile !== 'function') return;
        const slope = segLevelSharedSlopeFromProfile(
            base.data, width, height, result.direction, result.boundaries, result.plan.axisScale, index,
        );
        if (!slope || !Number.isFinite(slope.k)) return;
        result.autoTiltK = slope.k;
        result.tiltK = slope.k;
        if (result.plan.sharedTilt) result.plan.sharedTilt.k = slope.k;
        syncSegLevelTiltInput();
        segLevelShowProbeFeedback();
        scheduleSegLevelProbeCorrection();
    }

    function segLevelBeforeProbeDragging() {
        const drag = st.edit.segLevelProbe && st.edit.segLevelProbe.drag;
        return !!(drag && drag.pane === 'before');
    }

    function segLevelClearProbeFeedback() {
        if (st.edit.segLevelProbeFeedbackTimer) {
            clearTimeout(st.edit.segLevelProbeFeedbackTimer);
            st.edit.segLevelProbeFeedbackTimer = 0;
        }
        const pane = el.segLevelAfter && el.segLevelAfter.closest('.seg-level-pane-after');
        if (pane) pane.classList.remove('is-probe-live', 'is-probe-updated');
        if (el.segLevelUpdateBadge) {
            el.segLevelUpdateBadge.hidden = true;
            el.segLevelUpdateBadge.textContent = '';
        }
        if (el.segLevelTuneK) el.segLevelTuneK.classList.remove('is-probe-live', 'is-probe-updated');
    }

    function segLevelShowProbeFeedback() {
        const result = st.edit.segLevelResult;
        const badge = el.segLevelUpdateBadge;
        const pane = el.segLevelAfter && el.segLevelAfter.closest('.seg-level-pane-after');
        if (!badge || !pane || !result || !st.edit.segLevel) return;
        const live = segLevelBeforeProbeDragging();
        const kText = segLevelFmtK(result.tiltK);
        pane.classList.toggle('is-probe-live', live);
        pane.classList.toggle('is-probe-updated', !live);
        badge.hidden = false;
        badge.textContent = live
            ? t('segLevelProbeUpdating', kText)
            : t('segLevelProbeUpdated', kText);
        if (el.segLevelTuneK) {
            el.segLevelTuneK.classList.toggle('is-probe-live', live);
            el.segLevelTuneK.classList.toggle('is-probe-updated', !live);
        }
        if (st.edit.segLevelProbeFeedbackTimer) {
            clearTimeout(st.edit.segLevelProbeFeedbackTimer);
            st.edit.segLevelProbeFeedbackTimer = 0;
        }
        if (!live) {
            st.edit.segLevelProbeFeedbackTimer = setTimeout(() => {
                st.edit.segLevelProbeFeedbackTimer = 0;
                if (segLevelBeforeProbeDragging()) return;
                segLevelClearProbeFeedback();
            }, 1800);
        }
    }

    function scheduleSegLevelProbeCorrection() {
        st.edit.segLevelProbePending = true;
        if (st.edit.segLevelProbeRunning) return;
        if (st.edit.segLevelProbeRaf) return;
        st.edit.segLevelProbeRaf = requestAnimationFrame(() => {
            st.edit.segLevelProbeRaf = 0;
            pumpSegLevelProbeCorrection();
        });
    }

    async function pumpSegLevelProbeCorrection() {
        if (st.edit.segLevelProbeRunning) return;
        st.edit.segLevelProbeRunning = true;
        try {
            while (st.edit.segLevelProbePending && st.edit.segLevel && !st.edit.segLevelBusy && !st.edit.segLevelTuneBusy) {
                st.edit.segLevelProbePending = false;
                const runId = st.edit.segLevelProbeRunId;
                const base = st.edit.segLevelBase;
                const result = st.edit.segLevelResult;
                if (!base || !result || !result.plan || !st.dataset) break;
                const { width, height } = st.dataset;
                const k = result.tiltK;
                const outBuf = result.correctedData instanceof Float32Array ? result.correctedData : null;
                const large = width * height >= 2_000_000;
                let out = null;
                if (large && typeof applySegmentLevelPlanAsync === 'function') {
                    out = await applySegmentLevelPlanAsync(
                        base.data, width, height, result.plan, k, outBuf,
                        { bandOffsets: result.bandOffsets },
                        () => runId !== st.edit.segLevelProbeRunId || !st.edit.segLevel,
                    );
                } else if (typeof applySegmentLevelPlan === 'function') {
                    out = applySegmentLevelPlan(base.data, width, height, result.plan, k, outBuf, result.bandOffsets);
                }
                if (runId !== st.edit.segLevelProbeRunId || !st.edit.segLevel || !out) continue;
                result.correctedData = out;
                renderSegLevelAfterOnly();
                segLevelShowProbeFeedback();
            }
        } finally {
            st.edit.segLevelProbeRunning = false;
            if (st.edit.segLevelProbePending && st.edit.segLevel && !st.edit.segLevelBusy && !st.edit.segLevelTuneBusy) {
                scheduleSegLevelProbeCorrection();
            }
        }
    }

    function clearSegLevelProfileCanvas(canvas) {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const dpr = window.devicePixelRatio || 1;
        const cw = canvas.clientWidth || 1;
        const ch = canvas.clientHeight || 1;
        canvas.width = Math.max(1, Math.round(cw * dpr));
        canvas.height = Math.max(1, Math.round(ch * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cw, ch);
        canvas.style.transform = '';
        canvas.setAttribute('aria-hidden', 'true');
        const hover = canvas.parentElement && canvas.parentElement.querySelector('.seg-level-profile-hover');
        if (hover) hover.classList.remove('show');
    }

    function segLevelDefaultView() {
        return { scale: 1, tx: 0, ty: 0, minScale: 0.02, maxScale: 100, contentW: 1, contentH: 1 };
    }

    function segLevelEnsureViews() {
        if (!st.edit.segLevelViews) {
            st.edit.segLevelViews = {
                beforeImg: segLevelDefaultView(),
                afterImg: segLevelDefaultView(),
                beforeProfile: segLevelDefaultView(),
                afterProfile: segLevelDefaultView(),
            };
        }
        return st.edit.segLevelViews;
    }

    function segLevelResetViews() {
        st.edit.segLevelViews = null;
        st.edit.segLevelPan = null;
        st.edit.segLevelProfileCharts = null;
        st.edit.segLevelProfileRedrawRaf = 0;
        st.edit.segLevelProfileRedrawKeys = null;
    }

    function segLevelFitView(view, container, contentW, contentH) {
        if (!container || !view) return;
        const vw = Math.max(1, container.clientWidth);
        const vh = Math.max(1, container.clientHeight);
        const s = Math.min(vw / contentW, vh / contentH, 8);
        view.scale = s > 0 ? s : 1;
        view.contentW = contentW;
        view.contentH = contentH;
        view.tx = (vw - contentW * view.scale) / 2;
        view.ty = (vh - contentH * view.scale) / 2;
    }

    function segLevelZoomPct(view) {
        if (!view || !view.contentW) return '100%';
        const pct = view.scale * 100;
        return (pct >= 100 ? pct.toFixed(0) : pct.toFixed(1)) + '%';
    }

    function segLevelApplyViewTransform(canvas, view, wrap) {
        if (!canvas || !view) return;
        canvas.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
        canvas.style.transformOrigin = '0 0';
        if (wrap) {
            const ind = wrap.querySelector('.seg-level-zoom-ind');
            if (ind) ind.textContent = segLevelZoomPct(view);
        }
        segLevelLayoutProbes();
    }

    function segLevelContentSize(canvas) {
        const cw = parseFloat(canvas.style.width) || canvas.clientWidth || canvas.width;
        const ch = parseFloat(canvas.style.height) || canvas.clientHeight || canvas.height;
        return { cw: Math.max(1, cw), ch: Math.max(1, ch) };
    }

    function segLevelImagePeer(key) {
        if (key === 'beforeImg') {
            return {
                key: 'afterImg',
                canvas: el.segLevelAfter,
                wrap: el.segLevelAfter ? el.segLevelAfter.parentElement : null,
            };
        }
        if (key === 'afterImg') {
            return {
                key: 'beforeImg',
                canvas: el.segLevelBefore,
                wrap: el.segLevelBefore ? el.segLevelBefore.parentElement : null,
            };
        }
        return null;
    }

    function segLevelMirrorImageView(fromKey) {
        const peer = segLevelImagePeer(fromKey);
        if (!peer || !peer.canvas || !peer.wrap) return;
        const views = segLevelEnsureViews();
        const src = views[fromKey];
        const dst = views[peer.key];
        if (!src || !dst) return;
        dst.scale = src.scale;
        dst.tx = src.tx;
        dst.ty = src.ty;
        dst.minScale = src.minScale;
        dst.maxScale = src.maxScale;
        dst.contentW = src.contentW;
        dst.contentH = src.contentH;
        segLevelApplyViewTransform(peer.canvas, dst, peer.wrap);
    }

    function segLevelSyncViewTransform(zoomKey, canvas, resetView) {
        if (!zoomKey || !canvas) return;
        const wrap = canvas.parentElement;
        if (!wrap) return;
        const views = segLevelEnsureViews();
        const view = views[zoomKey];
        const { cw, ch } = segLevelContentSize(canvas);
        const sizeChanged = view.contentW !== cw || view.contentH !== ch;
        if (resetView || sizeChanged) segLevelFitView(view, wrap, cw, ch);
        segLevelApplyViewTransform(canvas, view, wrap);
        if (st.edit.segLevel && (zoomKey === 'beforeImg' || zoomKey === 'afterImg')) {
            segLevelMirrorImageView(zoomKey);
        }
    }

    function segLevelZoomAt(zoomKey, wrap, canvas, screenX, screenY, zoomFactor) {
        const views = segLevelEnsureViews();
        const view = views[zoomKey];
        let newScale = view.scale * zoomFactor;
        if (newScale < view.minScale) newScale = view.minScale;
        if (newScale > view.maxScale) newScale = view.maxScale;
        const k = newScale / view.scale;
        view.tx = screenX - (screenX - view.tx) * k;
        view.ty = screenY - (screenY - view.ty) * k;
        view.scale = newScale;
        segLevelApplyViewTransform(canvas, view, wrap);
        if (zoomKey === 'beforeImg' || zoomKey === 'afterImg') segLevelMirrorImageView(zoomKey);
        segLevelScheduleProfileRedraw(zoomKey);
    }

    function setupSegLevelZoom() {
        const targets = [
            { wrap: el.segLevelBefore?.parentElement, canvas: el.segLevelBefore, key: 'beforeImg' },
            { wrap: el.segLevelAfter?.parentElement, canvas: el.segLevelAfter, key: 'afterImg' },
            { wrap: el.segLevelBeforeProfile?.parentElement, canvas: el.segLevelBeforeProfile, key: 'beforeProfile' },
            { wrap: el.segLevelAfterProfile?.parentElement, canvas: el.segLevelAfterProfile, key: 'afterProfile' },
        ];
        for (const t of targets) {
            if (!t.wrap || !t.canvas || t.wrap.dataset.segZoomBound) continue;
            t.wrap.dataset.segZoomBound = '1';
            t.wrap.classList.add('seg-level-zoomable');
            if (!t.wrap.querySelector('.seg-level-zoom-ind')) {
                const ind = document.createElement('div');
                ind.className = 'seg-level-zoom-ind';
                ind.setAttribute('aria-hidden', 'true');
                t.wrap.appendChild(ind);
            }

            t.wrap.addEventListener('wheel', (e) => {
                if (!st.edit.segLevel || st.edit.segLevelBusy) return;
                e.preventDefault();
                e.stopPropagation();
                const rect = t.wrap.getBoundingClientRect();
                const mx = e.clientX - rect.left;
                const my = e.clientY - rect.top;
                let dy = e.deltaY;
                if (e.deltaMode === 1) dy *= 16;
                else if (e.deltaMode === 2) dy *= t.wrap.clientHeight;
                const zoomFactor = Math.pow(1.0015, -dy);
                segLevelZoomAt(t.key, t.wrap, t.canvas, mx, my, zoomFactor);
                if (segLevelIsProfileZoomKey(t.key)) segLevelUpdateProfileHoverFromEvent(t.key, e);
            }, { passive: false });

            t.wrap.addEventListener('mousedown', (e) => {
                if (!st.edit.segLevel || st.edit.segLevelBusy || e.button !== 0) return;
                if (e.target.closest && e.target.closest('.seg-level-probe')) return;
                const views = segLevelEnsureViews();
                const view = views[t.key];
                const peer = segLevelImagePeer(t.key);
                st.edit.segLevelPan = {
                    key: t.key,
                    wrap: t.wrap,
                    canvas: t.canvas,
                    peerWrap: peer && peer.wrap,
                    startX: e.clientX,
                    startY: e.clientY,
                    tx: view.tx,
                    ty: view.ty,
                };
                t.wrap.classList.add('grabbing');
                if (peer && peer.wrap) peer.wrap.classList.add('grabbing');
                e.preventDefault();
            });

            if (segLevelIsProfileZoomKey(t.key)) {
                t.wrap.addEventListener('mousemove', (e) => {
                    if (!st.edit.segLevel) return;
                    segLevelUpdateProfileHoverFromEvent(t.key, e);
                });
                t.wrap.addEventListener('mouseleave', () => {
                    const pointer = st.edit.segLevelProfilePointer;
                    if (pointer && pointer.key === t.key) st.edit.segLevelProfilePointer = null;
                    segLevelHideProfileHover(t.key);
                });
            }

            t.wrap.addEventListener('dblclick', (e) => {
                if (!st.edit.segLevel || st.edit.segLevelBusy) return;
                e.preventDefault();
                const views = segLevelEnsureViews();
                const view = views[t.key];
                segLevelFitView(view, t.wrap, view.contentW, view.contentH);
                segLevelApplyViewTransform(t.canvas, view, t.wrap);
                if (t.key === 'beforeImg' || t.key === 'afterImg') segLevelMirrorImageView(t.key);
                segLevelScheduleProfileRedraw(t.key);
            });
        }

        if (!st.edit.segLevelPanBound) {
            st.edit.segLevelPanBound = true;
            window.addEventListener('mousemove', (e) => {
                const pan = st.edit.segLevelPan;
                if (!pan) return;
                const views = segLevelEnsureViews();
                const view = views[pan.key];
                view.tx = pan.tx + (e.clientX - pan.startX);
                view.ty = pan.ty + (e.clientY - pan.startY);
                segLevelApplyViewTransform(pan.canvas, view, pan.wrap);
                if (pan.key === 'beforeImg' || pan.key === 'afterImg') segLevelMirrorImageView(pan.key);
                if (segLevelIsProfileZoomKey(pan.key)) segLevelUpdateProfileHoverFromEvent(pan.key, e);
            });
            window.addEventListener('mouseup', () => {
                const pan = st.edit.segLevelPan;
                if (!pan) return;
                pan.wrap.classList.remove('grabbing');
                if (pan.peerWrap) pan.peerWrap.classList.remove('grabbing');
                st.edit.segLevelPan = null;
            });
        }
    }

    function segLevelFmtK(k) {
        if (!Number.isFinite(k)) return '0';
        if (Math.abs(k) < 0.01) return k.toFixed(4);
        return (Math.round(k * 1000) / 1000).toFixed(3);
    }

    function segLevelProfileSplits(result, boundaries, profileLen) {
        let splits;
        if (result && result.plan && result.plan.splits && result.plan.splits.length >= 2) {
            splits = result.plan.splits.slice();
            splits[splits.length - 1] = profileLen;
        } else {
            splits = [0, ...(boundaries || []), profileLen];
        }
        return splits;
    }

    function segLevelProfileBoundaries(splits) {
        if (!splits || splits.length <= 2) return [];
        return splits.slice(1, -1);
    }

    function segLevelProfileBandFits(vals, splits, axisScale) {
        if (typeof segLevelFitProfileBandsFromSplits === 'function' && Number.isFinite(axisScale)) {
            return segLevelFitProfileBandsFromSplits(vals, splits, axisScale);
        }
        if (typeof segLevelFitProfileBands === 'function' && Number.isFinite(axisScale)) {
            const bounds = splits.length > 2 ? splits.slice(1, -1) : [];
            return segLevelFitProfileBands(vals, bounds, axisScale);
        }
        return [];
    }

    const SEG_LEVEL_BAND_FIT_COLORS = [
        '#ff9f43', '#5cdba0', '#c77dff', '#5eb3ff', '#ff6b8a', '#f4e04d', '#88d8ff', '#ffb347',
    ];

    function segLevelBandFitColor(index) {
        return SEG_LEVEL_BAND_FIT_COLORS[index % SEG_LEVEL_BAND_FIT_COLORS.length];
    }

    function segLevelProfilePlotY(z, cmin, yRange, y0, plotH) {
        let t = (z - cmin) / yRange;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        return y0 + (1 - t) * plotH;
    }

    function segLevelProfilePlotX(i, distPx, x0, plotW) {
        return x0 + (i / distPx) * plotW;
    }

    function segLevelEstimateFitScale(canvas, contentW, contentH) {
        const wrap = canvas && canvas.parentElement;
        if (!wrap || !contentW || !contentH) return 1;
        const vw = Math.max(1, wrap.clientWidth);
        const vh = Math.max(1, wrap.clientHeight);
        return Math.min(vw / contentW, vh / contentH, 8) || 1;
    }

    /** 大圖縮放顯示時略為加粗，維持螢幕上約 2～3px */
    function segLevelSplitLineStyle(canvas, contentW, contentH, targetScreenPx) {
        const fitScale = segLevelEstimateFitScale(canvas, contentW, contentH);
        const factor = Math.max(1, (targetScreenPx || 2.5) / fitScale);
        return {
            outer: factor * 1.35,
            inner: factor * 0.8,
            dash: [8, 5],
        };
    }

    function segLevelDrawImageSplitLines(ctx, direction, boundaries, cw, ch, canvas) {
        if (!boundaries || !boundaries.length) return;
        const style = segLevelSplitLineStyle(canvas, cw, ch, 2.5);
        const draw = () => {
            for (const b of boundaries) {
                ctx.beginPath();
                if (direction === 'horizontal') {
                    ctx.moveTo(0, b);
                    ctx.lineTo(cw, b);
                } else {
                    ctx.moveTo(b, 0);
                    ctx.lineTo(b, ch);
                }
                ctx.stroke();
            }
        };
        ctx.save();
        ctx.setLineDash(style.dash);
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.lineWidth = style.outer;
        draw();
        ctx.strokeStyle = '#fff44d';
        ctx.lineWidth = style.inner;
        draw();
        ctx.restore();
    }

    function segLevelDrawProfileSplitLines(ctx, boundaries, distPx, x0, y0, plotW, plotH, canvas, cw, ch) {
        if (!boundaries || !boundaries.length) return;
        const style = segLevelSplitLineStyle(canvas, cw, ch, 2);
        const draw = () => {
            for (const b of boundaries) {
                const frac = distPx > 0 ? (b - 0.5) / distPx : 0;
                const px = x0 + Math.min(1, Math.max(0, frac)) * plotW;
                ctx.beginPath();
                ctx.moveTo(px, y0);
                ctx.lineTo(px, y0 + plotH);
                ctx.stroke();
            }
        };
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.lineWidth = style.outer;
        draw();
        ctx.strokeStyle = '#fff44d';
        ctx.lineWidth = style.inner;
        draw();
        ctx.restore();
    }

    function segLevelProbeVisible(pane) {
        const input = pane === 'before' ? el.segLevelShowProbeBefore : el.segLevelShowProbeAfter;
        return !input || !!input.checked;
    }

    function segLevelResetProbeVisibility() {
        if (el.segLevelShowProbeBefore) el.segLevelShowProbeBefore.checked = true;
        if (el.segLevelShowProbeAfter) el.segLevelShowProbeAfter.checked = true;
    }

    function onSegLevelProbeToggle() {
        if (!st.edit.segLevel) return;
        segLevelLayoutProbes();
    }

    function segLevelShowBoundsEnabled() {
        return !!st.edit.segLevelShowBounds;
    }

    function syncSegLevelBoundsToggle() {
        if (!el.segLevelShowBounds) return;
        el.segLevelShowBounds.checked = segLevelShowBoundsEnabled();
    }

    function onSegLevelBoundsToggle() {
        if (!st.edit.segLevel || st.edit.segLevelBusy) return;
        st.edit.segLevelShowBounds = !!el.segLevelShowBounds?.checked;
        renderSegLevelCompare();
    }

    function drawSegLevelProfileBandFits(ctx, bandFits, axisScale, cmin, yRange, x0, y0, plotW, plotH, distPx) {
        if (!bandFits || !bandFits.length || !Number.isFinite(axisScale)) return;
        const labelPadX = 4;
        const labelBoxH = 16;
        const labelBoxY = y0 + 2;
        const labelLayouts = [];

        for (let bi = 0; bi < bandFits.length; bi++) {
            const fit = bandFits[bi];
            const { k, c, center, i0, i1 } = fit;
            if (!Number.isFinite(k) || !Number.isFinite(c) || i1 <= i0) continue;
            const color = segLevelBandFitColor(bi);
            const bandX0 = segLevelProfilePlotX(i0, distPx, x0, plotW);
            const bandX1 = segLevelProfilePlotX(Math.max(i0, i1 - 1), distPx, x0, plotW);
            const clipX = Math.max(x0, bandX0);
            const clipW = Math.min(x0 + plotW, bandX1 + 1) - clipX;
            if (clipW <= 0) continue;

            ctx.save();
            ctx.beginPath();
            ctx.rect(clipX, y0, clipW, plotH);
            ctx.clip();

            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 3]);
            ctx.beginPath();
            let started = false;
            for (let i = i0; i < i1; i++) {
                const refZ = k * (i - center) * axisScale + c;
                if (!Number.isFinite(refZ)) { started = false; continue; }
                const px = segLevelProfilePlotX(i, distPx, x0, plotW);
                const py = segLevelProfilePlotY(refZ, cmin, yRange, y0, plotH);
                if (!started) { ctx.moveTo(px, py); started = true; }
                else ctx.lineTo(px, py);
            }
            if (started) ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();

            const labelX = (bandX0 + bandX1) * 0.5;
            const label = `#${bi + 1} ` + segLevelFmtK(k) + ' µm/mm';
            ctx.save();
            ctx.font = '10px Consolas, monospace';
            const tw = ctx.measureText(label).width;
            ctx.restore();
            const boxW = tw + labelPadX * 2;
            let boxX = labelX - boxW * 0.5;
            if (boxX < clipX) boxX = clipX;
            if (boxX + boxW > clipX + clipW) boxX = clipX + clipW - boxW;
            labelLayouts.push({ label, color, boxX, boxW });
        }

        ctx.save();
        ctx.font = '10px Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const layout of labelLayouts) {
            const { label, color, boxX, boxW } = layout;
            ctx.fillStyle = 'rgba(18, 18, 28, 0.88)';
            ctx.fillRect(boxX, labelBoxY, boxW, labelBoxH);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.strokeRect(boxX, labelBoxY, boxW, labelBoxH);
            ctx.fillStyle = color;
            ctx.fillText(label, boxX + boxW * 0.5, labelBoxY + labelBoxH * 0.5);
        }
        ctx.restore();
    }

    function segLevelIsProfileZoomKey(zoomKey) {
        return zoomKey === 'beforeProfile' || zoomKey === 'afterProfile';
    }

    /** 折線圖依目前縮放倍率提高畫布解析度，避免 CSS scale 把點陣圖拉糊。 */
    function segLevelProfileRasterScale(viewScale, cw, ch) {
        const dpr = window.devicePixelRatio || 1;
        let s = Math.max(1, viewScale || 1);
        const maxDim = 8192;
        const maxS = Math.min(
            maxDim / Math.max(1, cw * dpr),
            maxDim / Math.max(1, ch * dpr),
        );
        if (s > maxS) s = Math.max(1, maxS);
        return s;
    }

    function segLevelStoreProfileChart(zoomKey, payload) {
        if (!segLevelIsProfileZoomKey(zoomKey)) return;
        if (!st.edit.segLevelProfileCharts) st.edit.segLevelProfileCharts = {};
        st.edit.segLevelProfileCharts[zoomKey] = payload;
    }

    function segLevelRedrawStoredProfile(zoomKey) {
        const charts = st.edit.segLevelProfileCharts;
        const payload = charts && charts[zoomKey];
        if (!payload || !st.edit.segLevel) return;
        const canvas = zoomKey === 'beforeProfile' ? el.segLevelBeforeProfile : el.segLevelAfterProfile;
        renderSegLevelProfileChart(
            canvas, payload.vals, payload.cmin, payload.crange, payload.direction,
            payload.boundaries, payload.bandFits, payload.axisScale, zoomKey, false,
        );
    }

    function segLevelScheduleProfileRedraw(zoomKey) {
        if (!segLevelIsProfileZoomKey(zoomKey)) return;
        if (!st.edit.segLevelProfileRedrawKeys) st.edit.segLevelProfileRedrawKeys = {};
        st.edit.segLevelProfileRedrawKeys[zoomKey] = true;
        if (st.edit.segLevelProfileRedrawRaf) return;
        st.edit.segLevelProfileRedrawRaf = requestAnimationFrame(() => {
            st.edit.segLevelProfileRedrawRaf = 0;
            const keys = st.edit.segLevelProfileRedrawKeys;
            st.edit.segLevelProfileRedrawKeys = null;
            if (!keys || !st.edit.segLevel) return;
            if (keys.beforeProfile) segLevelRedrawStoredProfile('beforeProfile');
            if (keys.afterProfile) segLevelRedrawStoredProfile('afterProfile');
        });
    }

    function segLevelProfileGeom(cw, ch) {
        const padL = 48, padR = 8, padT = 8, padB = 22;
        return {
            padL, padR, padT, padB,
            plotW: Math.max(1, cw - padL - padR),
            plotH: Math.max(1, ch - padT - padB),
            x0: padL,
            y0: padT,
        };
    }

    function segLevelProfileCanvasFor(zoomKey) {
        return zoomKey === 'beforeProfile' ? el.segLevelBeforeProfile : el.segLevelAfterProfile;
    }

    function segLevelEnsureProfileHover(wrap) {
        let hover = wrap.querySelector('.seg-level-profile-hover');
        if (hover) return hover;
        hover = document.createElement('div');
        hover.className = 'seg-level-profile-hover';
        hover.innerHTML = '<span class="seg-level-profile-hover-line"></span>'
            + '<span class="seg-level-profile-hover-dot"></span>'
            + '<div class="seg-level-profile-hover-tip"></div>';
        wrap.appendChild(hover);
        return hover;
    }

    function segLevelHideProfileHover(zoomKey) {
        const canvas = segLevelProfileCanvasFor(zoomKey);
        const hover = canvas && canvas.parentElement && canvas.parentElement.querySelector('.seg-level-profile-hover');
        if (hover) hover.classList.remove('show');
    }

    function segLevelProfileHit(zoomKey, clientX, clientY) {
        const charts = st.edit.segLevelProfileCharts;
        const payload = charts && charts[zoomKey];
        const canvas = segLevelProfileCanvasFor(zoomKey);
        const wrap = canvas && canvas.parentElement;
        const view = segLevelEnsureViews()[zoomKey];
        if (!payload || !payload.vals || !payload.vals.length || !wrap || !view || !view.scale) return null;
        const rect = wrap.getBoundingClientRect();
        const mx = clientX - rect.left;
        const my = clientY - rect.top;
        if (mx < 0 || my < 0 || mx > rect.width || my > rect.height) return null;
        const cx = (mx - view.tx) / view.scale;
        const cy = (my - view.ty) / view.scale;
        const { cw, ch } = segLevelContentSize(canvas);
        const g = segLevelProfileGeom(cw, ch);
        if (cx < g.x0 - 6 || cx > g.x0 + g.plotW + 6) return null;
        if (cy < g.y0 - 6 || cy > g.y0 + g.plotH + 6) return null;
        const vals = payload.vals;
        const n = vals.length;
        const distPx = Math.max(1, n - 1);
        let frac = (cx - g.x0) / g.plotW;
        if (frac < 0) frac = 0;
        else if (frac > 1) frac = 1;
        let idx = Math.round(frac * distPx);
        if (idx < 0) idx = 0;
        else if (idx >= n) idx = n - 1;
        if (!Number.isFinite(vals[idx])) {
            let best = -1;
            let bestD = Infinity;
            for (let i = 0; i < n; i++) {
                if (!Number.isFinite(vals[i])) continue;
                const d = Math.abs(i - idx);
                if (d < bestD) { bestD = d; best = i; }
            }
            if (best < 0) return null;
            idx = best;
        }
        const v = vals[idx];
        const yRange = payload.crange || 1e-12;
        const px = segLevelProfilePlotX(idx, distPx, g.x0, g.plotW);
        const py = segLevelProfilePlotY(v, payload.cmin, yRange, g.y0, g.plotH);
        return {
            idx,
            v,
            direction: payload.direction,
            sx: view.tx + px * view.scale,
            sy: view.ty + py * view.scale,
            lineX: view.tx + px * view.scale,
            plotTop: view.ty + g.y0 * view.scale,
            plotH: g.plotH * view.scale,
            wrapW: rect.width,
            wrapH: rect.height,
        };
    }

    function segLevelPlaceProfileHover(zoomKey, hit) {
        const canvas = segLevelProfileCanvasFor(zoomKey);
        const wrap = canvas && canvas.parentElement;
        if (!wrap) return;
        const hover = segLevelEnsureProfileHover(wrap);
        if (!hit) {
            hover.classList.remove('show');
            return;
        }
        const line = hover.querySelector('.seg-level-profile-hover-line');
        const dot = hover.querySelector('.seg-level-profile-hover-dot');
        const tip = hover.querySelector('.seg-level-profile-hover-tip');
        line.style.left = hit.lineX + 'px';
        line.style.top = hit.plotTop + 'px';
        line.style.height = Math.max(0, hit.plotH) + 'px';
        dot.style.left = hit.sx + 'px';
        dot.style.top = hit.sy + 'px';
        const axis = hit.direction === 'horizontal' ? t('segLevelProfileAxisY') : t('segLevelProfileAxisX');
        tip.replaceChildren();
        const addRow = (label, value) => {
            const row = document.createElement('div');
            const key = document.createElement('span');
            key.className = 'k';
            key.textContent = label;
            row.append(key, document.createTextNode(value));
            tip.appendChild(row);
        };
        addRow(axis + ':', String(hit.idx));
        addRow(t('segLevelProfileValue') + ':', segLevelFmt(hit.v));
        hover.classList.add('show');
        const tipW = tip.offsetWidth;
        const tipH = tip.offsetHeight;
        let left = hit.sx + 10;
        let top = hit.sy - tipH - 8;
        if (left + tipW > hit.wrapW - 4) left = hit.sx - tipW - 10;
        if (top < 4) top = hit.sy + 12;
        if (left < 4) left = 4;
        if (top + tipH > hit.wrapH - 4) top = Math.max(4, hit.wrapH - tipH - 4);
        tip.style.left = left + 'px';
        tip.style.top = top + 'px';
    }

    function segLevelUpdateProfileHover() {
        const pointer = st.edit.segLevelProfilePointer;
        if (!pointer || !st.edit.segLevel) return;
        segLevelPlaceProfileHover(pointer.key, segLevelProfileHit(pointer.key, pointer.x, pointer.y));
    }

    function segLevelUpdateProfileHoverFromEvent(zoomKey, e) {
        if (!st.edit.segLevel || !segLevelIsProfileZoomKey(zoomKey)) return;
        st.edit.segLevelProfilePointer = { key: zoomKey, x: e.clientX, y: e.clientY };
        segLevelUpdateProfileHover();
    }

    function renderSegLevelProfileChart(canvas, vals, cmin, crange, direction, boundaries, bandFits, axisScale, zoomKey, resetView) {
        if (!canvas || !vals || !vals.length) {
            clearSegLevelProfileCanvas(canvas);
            if (zoomKey && st.edit.segLevelProfileCharts) delete st.edit.segLevelProfileCharts[zoomKey];
            return;
        }
        const wrap = canvas.parentElement;
        const cw = Math.max(1, wrap?.clientWidth || canvas.clientWidth || 200);
        const ch = Math.max(1, wrap?.clientHeight || canvas.clientHeight || 100);
        let viewScale = 1;
        if (zoomKey) {
            const view = segLevelEnsureViews()[zoomKey];
            const sizeChanged = view.contentW !== cw || view.contentH !== ch;
            if (resetView || sizeChanged) segLevelFitView(view, wrap, cw, ch);
            viewScale = view.scale;
        }
        segLevelStoreProfileChart(zoomKey, {
            vals, cmin, crange, direction, boundaries, bandFits, axisScale,
        });
        const dpr = window.devicePixelRatio || 1;
        const raster = segLevelIsProfileZoomKey(zoomKey)
            ? segLevelProfileRasterScale(viewScale, cw, ch)
            : 1;
        const bw = Math.max(1, Math.round(cw * raster * dpr));
        const bh = Math.max(1, Math.round(ch * raster * dpr));
        canvas.width = bw;
        canvas.height = bh;
        canvas.style.width = cw + 'px';
        canvas.style.height = ch + 'px';
        canvas.setAttribute('aria-hidden', 'false');

        const ctx = canvas.getContext('2d');
        ctx.setTransform(bw / cw, 0, 0, bh / ch, 0, 0);
        ctx.clearRect(0, 0, cw, ch);

        const geom = segLevelProfileGeom(cw, ch);
        const { plotW, plotH, x0, y0 } = geom;
        const cmax = cmin + crange;
        const yRange = crange || 1e-12;
        const n = vals.length;
        const distPx = Math.max(1, n - 1);

        const ink = chartChrome();
        ctx.fillStyle = ink.fill;
        ctx.fillRect(x0, y0, plotW, plotH);

        ctx.font = '10px Consolas, monospace';
        ctx.lineWidth = 1;

        const yticks = 4;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (let i = 0; i <= yticks; i++) {
            const tt = i / yticks;
            const py = y0 + plotH * tt;
            ctx.strokeStyle = ink.gridSoft;
            ctx.beginPath();
            ctx.moveTo(x0, py);
            ctx.lineTo(x0 + plotW, py);
            ctx.stroke();
            const val = cmax - yRange * tt;
            ctx.fillStyle = ink.label;
            ctx.fillText(segLevelFmt(val), x0 - 5, py);
        }

        const xticks = 4;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const axisX = direction === 'horizontal' ? t('segLevelProfileAxisY') : t('segLevelProfileAxisX');
        for (let i = 0; i <= xticks; i++) {
            const tt = i / xticks;
            const px = x0 + plotW * tt;
            ctx.strokeStyle = ink.gridHair;
            ctx.beginPath();
            ctx.moveTo(px, y0);
            ctx.lineTo(px, y0 + plotH);
            ctx.stroke();
            ctx.fillStyle = ink.label;
            ctx.fillText(String(Math.round(distPx * tt)), px, y0 + plotH + 4);
        }
        ctx.fillStyle = ink.labelDim;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(axisX, x0 + plotW * 0.5, ch - 2);

        if (segLevelShowBoundsEnabled() && boundaries && boundaries.length) {
            segLevelDrawProfileSplitLines(ctx, boundaries, distPx, x0, y0, plotW, plotH, canvas, cw, ch);
        }

        ctx.strokeStyle = '#4f8cff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < n; i++) {
            const v = vals[i];
            if (!Number.isFinite(v)) { started = false; continue; }
            const px = x0 + (i / distPx) * plotW;
            let t = (v - cmin) / yRange;
            if (t < 0) t = 0;
            else if (t > 1) t = 1;
            const py = y0 + (1 - t) * plotH;
            if (!started) { ctx.moveTo(px, py); started = true; }
            else ctx.lineTo(px, py);
        }
        ctx.stroke();
        drawSegLevelProfileBandFits(ctx, bandFits, axisScale, cmin, yRange, x0, y0, plotW, plotH, distPx);
        segLevelSyncViewTransform(zoomKey, canvas, false);
        const pointer = st.edit.segLevelProfilePointer;
        if (pointer && pointer.key === zoomKey) segLevelUpdateProfileHover();
    }

    function segLevelEnsureClips() {
        if (!st.edit.segLevelClip) {
            st.edit.segLevelClip = {
                before: { lo: 0, hi: 1 },
                after: { lo: 0, hi: 1 },
            };
        }
        return st.edit.segLevelClip;
    }

    function segLevelClipFor(pane) {
        const clips = segLevelEnsureClips();
        return pane === 'after' ? clips.after : clips.before;
    }

    function segLevelResetClips() {
        st.edit.segLevelClip = {
            before: { lo: 0, hi: 1 },
            after: { lo: 0, hi: 1 },
        };
    }

    function segLevelPaneDataRange(pane) {
        if (pane === 'after') {
            const data = st.edit.segLevelResult && st.edit.segLevelResult.correctedData;
            if (!data) return null;
            const range = computeRange(data);
            return { vmin: range.vmin, vmax: range.vmax, data };
        }
        const base = st.edit.segLevelBase;
        if (!base) return null;
        return { vmin: base.vmin, vmax: base.vmax, data: base.data };
    }

    function segLevelVisibleValueRange(pane) {
        const canvas = pane === 'after' ? el.segLevelAfter : el.segLevelBefore;
        const wrap = canvas && canvas.parentElement;
        const stats = segLevelPaneDataRange(pane);
        if (!canvas || !wrap || !stats || !st.dataset) return null;
        const data = stats.data;
        if (!data) return null;
        const view = segLevelEnsureViews()[pane === 'after' ? 'afterImg' : 'beforeImg'];
        const scale = view.scale || 1;
        const { width, height } = st.dataset;
        let x0 = (0 - view.tx) / scale;
        let y0 = (0 - view.ty) / scale;
        let x1 = (wrap.clientWidth - view.tx) / scale;
        let y1 = (wrap.clientHeight - view.ty) / scale;
        const c0 = Math.max(0, Math.floor(Math.min(x0, x1)));
        const c1 = Math.min(width, Math.ceil(Math.max(x0, x1)));
        const r0 = Math.max(0, Math.floor(Math.min(y0, y1)));
        const r1 = Math.min(height, Math.ceil(Math.max(y0, y1)));
        if (c1 <= c0 || r1 <= r0) return null;
        let vmin = Infinity;
        let vmax = -Infinity;
        let count = 0;
        for (let y = r0; y < r1; y++) {
            const base = y * width;
            for (let x = c0; x < c1; x++) {
                const v = data[base + x];
                if (!Number.isFinite(v)) continue;
                if (v < vmin) vmin = v;
                if (v > vmax) vmax = v;
                count++;
            }
        }
        if (!count || !(vmax >= vmin)) return null;
        if (!(vmax > vmin)) {
            const pad = Math.max(Math.abs(vmin) * 0.001, 1e-6);
            vmin -= pad;
            vmax += pad;
        }
        return { min: vmin, max: vmax };
    }

    function segLevelSetClipRange(pane, rangeMin, rangeMax) {
        const stats = segLevelPaneDataRange(pane);
        if (!stats) return;
        const span = (stats.vmax - stats.vmin) || 1;
        let lo = (rangeMin - stats.vmin) / span;
        let hi = (rangeMax - stats.vmin) / span;
        if (lo < 0) lo = 0;
        if (hi > 1) hi = 1;
        if (hi < lo) { const swap = lo; lo = hi; hi = swap; }
        if (hi - lo < 0.01) {
            const mid = (lo + hi) / 2;
            lo = Math.max(0, mid - 0.005);
            hi = Math.min(1, lo + 0.01);
            if (hi > 1) { hi = 1; lo = 0.99; }
        }
        const clip = segLevelClipFor(pane);
        clip.lo = lo;
        clip.hi = hi;
    }

    function segLevelRepaintColors() {
        if (!st.edit.segLevel || !st.edit.segLevelResult) return;
        renderSegLevelCompare({ resetView: false });
    }

    function setupSegLevelColorbars() {
        const root = el.segLevelCompare;
        if (!root || root.dataset.colorBound) return;
        root.dataset.colorBound = '1';
        const MIN_GAP = 0.01;
        let dragging = null;
        let raf = 0;
        const schedule = () => {
            if (raf) return;
            raf = requestAnimationFrame(() => {
                raf = 0;
                segLevelRepaintColors();
            });
        };
        const fractionFromY = (track, clientY) => {
            const rect = track.getBoundingClientRect();
            if (rect.height <= 0) return 0;
            const fromTop = (clientY - rect.top) / rect.height;
            return 1 - Math.min(1, Math.max(0, fromTop));
        };
        root.querySelectorAll('.seg-level-cbar-handle').forEach((handle) => {
            handle.addEventListener('pointerdown', (e) => {
                if (!st.edit.segLevel || st.edit.segLevelBusy || e.button !== 0) return;
                const cbar = handle.closest('.seg-level-cbar');
                const track = handle.parentElement;
                if (!cbar || !track) return;
                e.preventDefault();
                e.stopPropagation();
                dragging = {
                    which: handle.dataset.which === 'lo' ? 'lo' : 'hi',
                    pane: cbar.dataset.pane === 'after' ? 'after' : 'before',
                    track,
                    handle,
                };
                handle.classList.add('dragging');
                try { handle.setPointerCapture(e.pointerId); } catch (_) {}
            });
            handle.addEventListener('pointermove', (e) => {
                if (!dragging || dragging.handle !== handle) return;
                const clip = segLevelClipFor(dragging.pane);
                const f = fractionFromY(dragging.track, e.clientY);
                if (dragging.which === 'lo') clip.lo = Math.max(0, Math.min(f, clip.hi - MIN_GAP));
                else clip.hi = Math.min(1, Math.max(f, clip.lo + MIN_GAP));
                schedule();
            });
            const endDrag = () => {
                if (!dragging || dragging.handle !== handle) return;
                handle.classList.remove('dragging');
                dragging = null;
            };
            handle.addEventListener('pointerup', endDrag);
            handle.addEventListener('pointercancel', endDrag);
        });
        root.querySelectorAll('.seg-level-cbar-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                if (!st.edit.segLevel || st.edit.segLevelBusy) return;
                const cbar = btn.closest('.seg-level-cbar');
                if (!cbar) return;
                const pane = cbar.dataset.pane === 'after' ? 'after' : 'before';
                if (btn.dataset.act === 'reset') {
                    const clip = segLevelClipFor(pane);
                    clip.lo = 0;
                    clip.hi = 1;
                    segLevelRepaintColors();
                    return;
                }
                const range = segLevelVisibleValueRange(pane);
                if (!range) {
                    showToast(t('segLevelColorViewEmpty'), 'info');
                    return;
                }
                segLevelSetClipRange(pane, range.min, range.max);
                segLevelRepaintColors();
            });
        });
    }

    function renderSegLevelPaneColorbar(canvas, loEl, hiEl, vmin, vmax, cmap, clip) {
        if (!canvas) return;
        const track = canvas.parentElement;
        const inTrack = !!(track && track.classList.contains('seg-level-cbar-track'));
        const cssH = Math.max(72, (inTrack ? track.clientHeight : (track?.clientHeight || 120)) || 120);
        const cssW = inTrack ? Math.max(8, track.clientWidth || 16) : 14;
        const dpr = window.devicePixelRatio || 1;
        const bw = Math.max(1, Math.round(cssW * dpr));
        const bh = Math.max(1, Math.round(cssH * dpr));
        canvas.width = bw;
        canvas.height = bh;
        if (!inTrack) {
            canvas.style.width = cssW + 'px';
            canvas.style.height = cssH + 'px';
        }

        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(bw, bh);
        const px = img.data;
        for (let y = 0; y < bh; y++) {
            const t = bh > 1 ? 1 - y / (bh - 1) : 1;
            const [r, g, b] = sampleColormap(cmap, t);
            const cr = Math.round(r * 255);
            const cg = Math.round(g * 255);
            const cb = Math.round(b * 255);
            for (let x = 0; x < bw; x++) {
                const po = (y * bw + x) * 4;
                px[po] = cr;
                px[po + 1] = cg;
                px[po + 2] = cb;
                px[po + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        const windowRange = segLevelDisplayRange(vmin, vmax, clip);
        if (hiEl) hiEl.textContent = segLevelFmt(windowRange.cmax);
        if (loEl) loEl.textContent = segLevelFmt(windowRange.cmin);
        const cbar = inTrack && track.closest ? track.closest('.seg-level-cbar') : null;
        if (track && track.classList.contains('seg-level-cbar-track')) {
            const c = clip || { lo: 0, hi: 1 };
            const hiHandle = track.querySelector('.is-hi');
            const loHandle = track.querySelector('.is-lo');
            if (hiHandle) hiHandle.style.top = ((1 - c.hi) * 100) + '%';
            if (loHandle) loHandle.style.top = ((1 - c.lo) * 100) + '%';
        }
        if (cbar) {
            const endHi = cbar.querySelector('.seg-level-cbar-end-hi');
            const endLo = cbar.querySelector('.seg-level-cbar-end-lo');
            if (endHi) endHi.textContent = segLevelFmt(vmax);
            if (endLo) endLo.textContent = segLevelFmt(vmin);
        }
    }

    function renderSegLevelCanvas(canvas, data, width, height, cmin, crange, cmap, direction, boundaries, drawBounds, zoomKey, resetView) {
        if (!canvas) return;
        const cw = Math.max(1, width);
        const ch = Math.max(1, height);
        canvas.width = cw;
        canvas.height = ch;
        canvas.style.width = cw + 'px';
        canvas.style.height = ch + 'px';

        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(cw, ch);
        const px = img.data;
        const lut = buildColormapLut(cmap);

        for (let y = 0; y < ch; y++) {
            const rowBase = y * width;
            for (let x = 0; x < cw; x++) {
                const v = data[rowBase + x];
                const po = (y * cw + x) * 4;
                if (!Number.isFinite(v)) {
                    paintMissingPixel(px, po);
                    continue;
                }
                let t = (v - cmin) / crange;
                if (t < 0) t = 0; else if (t > 1) t = 1;
                const lo = ((t * 255) | 0) * 3;
                px[po] = lut[lo]; px[po + 1] = lut[lo + 1]; px[po + 2] = lut[lo + 2]; px[po + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);

        if (drawBounds && segLevelShowBoundsEnabled() && boundaries && boundaries.length) {
            segLevelDrawImageSplitLines(ctx, direction, boundaries, cw, ch, canvas);
        }
        segLevelSyncViewTransform(zoomKey, canvas, resetView);
    }

    function renderSegLevelCompare(opts) {
        const resetView = !!(opts && opts.resetView);
        const base = st.edit.segLevelBase;
        const result = st.edit.segLevelResult;
        if (!base || !result || !st.dataset) return;
        const ds = st.dataset;
        const cmap = el.colormap.value;
        const { width, height } = ds;
        const afterData = result.correctedData;
        const afterStats = computeRange(afterData);
        const beforeFull = segLevelDisplayRange(base.vmin, base.vmax, null);
        const afterFull = segLevelDisplayRange(afterStats.vmin, afterStats.vmax, null);
        const beforeDr = segLevelDisplayRange(base.vmin, base.vmax, segLevelClipFor('before'));
        const afterDr = segLevelDisplayRange(afterStats.vmin, afterStats.vmax, segLevelClipFor('after'));
        st.edit.segLevelAfterDr = afterFull;
        const direction = result.direction;
        const boundaries = result.boundaries;

        renderSegLevelCanvas(
            el.segLevelBefore, base.data, width, height,
            beforeDr.cmin, beforeDr.crange, cmap, direction, boundaries, true,
            'beforeImg', resetView,
        );
        renderSegLevelCanvas(
            el.segLevelAfter, afterData, width, height,
            afterDr.cmin, afterDr.crange, cmap, direction, boundaries, true,
            'afterImg', resetView,
        );

        renderSegLevelPaneColorbar(
            el.segLevelBeforeCb, el.segLevelBeforeCbLo, el.segLevelBeforeCbHi,
            base.vmin, base.vmax, cmap, segLevelClipFor('before'),
        );
        renderSegLevelPaneColorbar(
            el.segLevelAfterCb, el.segLevelAfterCbLo, el.segLevelAfterCbHi,
            afterStats.vmin, afterStats.vmax, cmap, segLevelClipFor('after'),
        );

        const beforeIndex = segLevelResolveProbeIndex('before', direction, width, height);
        const afterIndex = segLevelResolveProbeIndex('after', direction, width, height);
        const beforeProfile = segLevelExtractProfile(base.data, width, height, direction, beforeIndex);
        const afterProfile = segLevelExtractProfile(afterData, width, height, direction, afterIndex);
        const axisScale = result.plan && result.plan.axisScale;
        const beforeSplits = segLevelProfileSplits(result, boundaries, beforeProfile.length);
        const afterSplits = segLevelProfileSplits(result, boundaries, afterProfile.length);
        const chartBoundaries = segLevelProfileBoundaries(beforeSplits);
        const beforeBandFits = segLevelProfileBandFits(beforeProfile, beforeSplits, axisScale);
        const afterBandFits = segLevelProfileBandFits(afterProfile, afterSplits, axisScale);
        renderSegLevelProfileChart(
            el.segLevelBeforeProfile, beforeProfile,
            beforeFull.cmin, beforeFull.crange, direction, chartBoundaries,
            beforeBandFits, axisScale, 'beforeProfile', resetView,
        );
        renderSegLevelProfileChart(
            el.segLevelAfterProfile, afterProfile,
            afterFull.cmin, afterFull.crange, direction, chartBoundaries,
            afterBandFits, axisScale, 'afterProfile', resetView,
        );

        syncSegLevelConfigUI();
        segLevelLayoutProbes();
    }

    function renderSegLevelBeforeProfileOnly() {
        const base = st.edit.segLevelBase;
        const result = st.edit.segLevelResult;
        if (!base || !result || !st.dataset) return;
        const { width, height } = st.dataset;
        const direction = result.direction;
        const boundaries = result.boundaries;
        const index = segLevelResolveProbeIndex('before', direction, width, height);
        const beforeProfile = segLevelExtractProfile(base.data, width, height, direction, index);
        const beforeDr = segLevelDisplayRange(base.vmin, base.vmax, null);
        const axisScale = result.plan && result.plan.axisScale;
        const beforeSplits = segLevelProfileSplits(result, boundaries, beforeProfile.length);
        const chartBoundaries = segLevelProfileBoundaries(beforeSplits);
        const beforeBandFits = segLevelProfileBandFits(beforeProfile, beforeSplits, axisScale);
        renderSegLevelProfileChart(
            el.segLevelBeforeProfile, beforeProfile,
            beforeDr.cmin, beforeDr.crange, direction, chartBoundaries,
            beforeBandFits, axisScale, 'beforeProfile', false,
        );
    }

    function renderSegLevelAfterProfileOnly() {
        const result = st.edit.segLevelResult;
        if (!result || !result.correctedData || !st.dataset) return;
        const { width, height } = st.dataset;
        const direction = result.direction;
        const boundaries = result.boundaries;
        const afterData = result.correctedData;
        const index = segLevelResolveProbeIndex('after', direction, width, height);
        const afterProfile = segLevelExtractProfile(afterData, width, height, direction, index);
        const afterDr = st.edit.segLevelAfterDr;
        if (!afterDr) return;
        const axisScale = result.plan && result.plan.axisScale;
        const afterSplits = segLevelProfileSplits(result, boundaries, afterProfile.length);
        const chartBoundaries = segLevelProfileBoundaries(afterSplits);
        const afterBandFits = segLevelProfileBandFits(afterProfile, afterSplits, axisScale);
        renderSegLevelProfileChart(
            el.segLevelAfterProfile, afterProfile,
            afterDr.cmin, afterDr.crange, direction, chartBoundaries,
            afterBandFits, axisScale, 'afterProfile', false,
        );
    }

    /** 微調時只更新校正後面板（校正前與色階不變） */
    function renderSegLevelAfterOnly() {
        const base = st.edit.segLevelBase;
        const result = st.edit.segLevelResult;
        if (!base || !result || !st.dataset) return;
        const ds = st.dataset;
        const cmap = el.colormap.value;
        const { width, height } = ds;
        const afterData = result.correctedData;
        const afterStats = computeRange(afterData);
        const afterFull = segLevelDisplayRange(afterStats.vmin, afterStats.vmax, null);
        const afterDr = segLevelDisplayRange(afterStats.vmin, afterStats.vmax, segLevelClipFor('after'));
        st.edit.segLevelAfterDr = afterFull;
        const direction = result.direction;
        const boundaries = result.boundaries;

        renderSegLevelCanvas(
            el.segLevelAfter, afterData, width, height,
            afterDr.cmin, afterDr.crange, cmap, direction, boundaries, true,
            'afterImg', false,
        );
        renderSegLevelPaneColorbar(
            el.segLevelAfterCb, el.segLevelAfterCbLo, el.segLevelAfterCbHi,
            afterStats.vmin, afterStats.vmax, cmap, segLevelClipFor('after'),
        );
        const afterIndex = segLevelResolveProbeIndex('after', direction, width, height);
        const afterProfile = segLevelExtractProfile(afterData, width, height, direction, afterIndex);
        const axisScale = result.plan && result.plan.axisScale;
        const afterSplits = segLevelProfileSplits(result, boundaries, afterProfile.length);
        const chartBoundaries = segLevelProfileBoundaries(afterSplits);
        const afterBandFits = segLevelProfileBandFits(afterProfile, afterSplits, axisScale);
        renderSegLevelProfileChart(
            el.segLevelAfterProfile, afterProfile,
            afterFull.cmin, afterFull.crange, direction, chartBoundaries,
            afterBandFits, axisScale, 'afterProfile', false,
        );
    }

    let segLevelTuneRunId = 0;

    function setSegLevelTuneUI(visible) {
        if (el.segLevelTune) el.segLevelTune.setAttribute('aria-hidden', visible ? 'false' : 'true');
    }

    function readSegLevelTiltFromUI() {
        const result = st.edit.segLevelResult;
        if (!result || !el.segLevelTuneK) return;
        const v = parseFloat(el.segLevelTuneK.value);
        result.tiltK = Number.isFinite(v) ? v : result.autoTiltK;
    }

    function syncSegLevelTiltInput() {
        const result = st.edit.segLevelResult;
        if (!result || !el.segLevelTuneK) return;
        el.segLevelTuneK.value = segLevelFmtK(result.tiltK);
    }

    function updateSegLevelTunePanel() {
        const result = st.edit.segLevelResult;
        if (!result) return;
        if (el.segLevelTuneSlopeLabel) {
            el.segLevelTuneSlopeLabel.textContent = result.direction === 'horizontal'
                ? t('segLevelTuneSlopeY')
                : t('segLevelTuneSlopeX');
        }
        syncSegLevelTiltInput();
        syncSegLevelBandOffsetInputs(result);
    }

    function segLevelEnsureBandOffsets(result) {
        const n = Math.max(1, result.segmentCount || ((result.boundaries ? result.boundaries.length : 0) + 1));
        if (!result.bandOffsets || result.bandOffsets.length !== n) {
            result.bandOffsets = new Array(n).fill(0);
        }
        return result.bandOffsets;
    }

    function segLevelFmtOffset(v) {
        if (!Number.isFinite(v) || v === 0) return '0';
        return String(Math.round(v * 1000) / 1000);
    }

    function readSegLevelBandOffsetsFromUI() {
        const result = st.edit.segLevelResult;
        const list = el.segLevelBandOffsetList;
        if (!result || !list) return;
        const offsets = segLevelEnsureBandOffsets(result);
        list.querySelectorAll('input').forEach((input) => {
            const i = parseInt(input.dataset.band, 10);
            if (!Number.isInteger(i) || i < 0 || i >= offsets.length) return;
            const v = parseFloat(input.value);
            offsets[i] = Number.isFinite(v) ? v : 0;
        });
    }

    function syncSegLevelBandOffsetInputs(result) {
        const list = el.segLevelBandOffsetList;
        if (!list || !result) return;
        const offsets = segLevelEnsureBandOffsets(result);
        const inputs = list.querySelectorAll('input');
        if (inputs.length !== offsets.length) {
            buildSegLevelBandOffsetInputs(result);
            return;
        }
        inputs.forEach((input) => {
            if (document.activeElement === input) return;
            const i = parseInt(input.dataset.band, 10);
            if (Number.isInteger(i) && i >= 0 && i < offsets.length) {
                input.value = segLevelFmtOffset(offsets[i]);
            }
        });
    }

    function buildSegLevelBandOffsetInputs(result) {
        const list = el.segLevelBandOffsetList;
        if (!list || !result) return;
        const offsets = segLevelEnsureBandOffsets(result);
        list.replaceChildren();
        for (let i = 0; i < offsets.length; i++) {
            const label = document.createElement('label');
            label.className = 'seg-level-band-offset';
            const swatch = document.createElement('span');
            swatch.className = 'seg-level-band-offset-swatch';
            swatch.style.background = segLevelBandFitColor(i);
            const name = document.createElement('span');
            name.textContent = t('segLevelBandOffsetItem', i + 1);
            const input = document.createElement('input');
            input.type = 'number';
            input.step = '0.1';
            input.value = segLevelFmtOffset(offsets[i]);
            input.dataset.band = String(i);
            input.addEventListener('keydown', onSegLevelTuneKeydown);
            label.append(swatch, name, input);
            list.appendChild(label);
        }
    }

    function resetSegLevelBandOffsets() {
        const result = st.edit.segLevelResult;
        if (!result || st.edit.segLevelTuneBusy || st.edit.segLevelBusy) return;
        const offsets = segLevelEnsureBandOffsets(result);
        offsets.fill(0);
        syncSegLevelBandOffsetInputs(result);
        recomputeSegLevelPreview();
    }

    function segLevelYieldFrame() {
        return new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
    }

    function setSegLevelTuneBusyUI(busy) {
        st.edit.segLevelTuneBusy = !!busy;
        if (el.segLevelCompare) el.segLevelCompare.classList.toggle('is-tune-busy', !!busy);
        if (el.segLevelTune) el.segLevelTune.classList.toggle('is-busy', !!busy);
        if (el.segLevelTuneBusy) {
            el.segLevelTuneBusy.classList.toggle('show', !!busy);
            el.segLevelTuneBusy.setAttribute('aria-hidden', busy ? 'false' : 'true');
        }
        if (el.segLevelTuneK) el.segLevelTuneK.disabled = !!busy;
        if (el.segLevelTuneReset) el.segLevelTuneReset.disabled = !!busy;
        if (el.segLevelBandOffsetReset) el.segLevelBandOffsetReset.disabled = !!busy;
        if (el.segLevelBandOffsetList) {
            el.segLevelBandOffsetList.querySelectorAll('input').forEach((input) => {
                input.disabled = !!busy;
            });
        }
        updateEditButtons();
    }

    async function recomputeSegLevelPreview(options) {
        const base = st.edit.segLevelBase;
        const result = st.edit.segLevelResult;
        if (!base || !result || !result.plan || !st.dataset) return;
        segLevelCancelProbeCorrection();
        const { width, height } = st.dataset;
        const tuneRunId = ++st.edit.segLevelTuneRunId;
        const outBuf = result.correctedData instanceof Float32Array
            ? result.correctedData
            : null;

        setSegLevelTuneBusyUI(true);
        await segLevelYieldFrame();
        if (tuneRunId !== st.edit.segLevelTuneRunId) {
            setSegLevelTuneBusyUI(false);
            return;
        }

        try {
            if (typeof applySegmentLevelPlanAsync === 'function') {
                const out = await applySegmentLevelPlanAsync(
                    base.data, width, height, result.plan, result.tiltK, outBuf,
                    { bandOffsets: result.bandOffsets },
                    () => tuneRunId !== st.edit.segLevelTuneRunId,
                );
                if (!out || tuneRunId !== st.edit.segLevelTuneRunId) return;
                result.correctedData = out;
            } else {
                result.correctedData = applySegmentLevelPlan(
                    base.data, width, height, result.plan, result.tiltK, outBuf, result.bandOffsets,
                );
                if (tuneRunId !== st.edit.segLevelTuneRunId) return;
            }
            renderSegLevelAfterOnly();
        } finally {
            if (tuneRunId === st.edit.segLevelTuneRunId) {
                setSegLevelTuneBusyUI(false);
            }
        }
    }

    function commitSegLevelTune() {
        if (!st.edit.segLevel || st.edit.segLevelBusy || st.edit.segLevelTuneBusy) return;
        readSegLevelTiltFromUI();
        readSegLevelBandOffsetsFromUI();
        recomputeSegLevelPreview({ fullQuality: true });
    }

    function onSegLevelTuneKeydown(e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (e.target && typeof e.target.blur === 'function') e.target.blur();
        commitSegLevelTune();
    }

    function buildSegLevelTuneUI(result) {
        if (!result) return;
        setSegLevelTuneUI(true);
        segLevelEnsureBandOffsets(result);
        buildSegLevelBandOffsetInputs(result);
        updateSegLevelTunePanel();
    }

    function resetSegLevelTilt() {
        const result = st.edit.segLevelResult;
        if (!result || !Number.isFinite(result.autoTiltK) || st.edit.segLevelTuneBusy) return;
        result.tiltK = result.autoTiltK;
        syncSegLevelTiltInput();
        recomputeSegLevelPreview({ fullQuality: true });
    }

    function setSegLevelBusyUI(busy, progress) {
        if (el.segLevelCompare) el.segLevelCompare.classList.toggle('is-busy', !!busy);
        if (el.segLevelBusy) {
            el.segLevelBusy.classList.toggle('show', !!busy);
            el.segLevelBusy.setAttribute('aria-hidden', busy ? 'false' : 'true');
        }
        if (el.segLevelBusyText && busy) {
            const pct = Math.round((progress || 0) * 100);
            el.segLevelBusyText.textContent = pct > 0 && pct < 100
                ? t('segLevelProgress', pct)
                : t('segLevelProcessing');
        }
        updateEditButtons();
    }

    async function recomputeSegLevelWithConfig(options) {
        options = options || {};
        if (!st.edit.segLevel || st.edit.segLevelBusy || st.edit.segLevelTuneBusy || !st.dataset) return;
        if (typeof analyzeSegmentLevelingWithParamsAsync !== 'function') return;

        const prev = st.edit.segLevelResult;
        const { direction, segmentCount, maxBands } = readSegLevelConfigFromUI();
        if (prev
            && prev.direction === direction
            && prev.segmentCount === segmentCount
            && !options.force) {
            syncSegLevelConfigUI();
            return;
        }

        const rawCount = parseInt(el.segLevelCount?.value, 10);
        if (Number.isFinite(rawCount) && rawCount > maxBands) {
            showToast(t('segLevelInvalidCount', maxBands), 'info');
        }

        st.edit.segLevelBusy = true;
        st.edit.segLevelTuneRunId++;
        segLevelCancelProbeCorrection();
        const runId = ++st.edit.segLevelRunId;
        setSegLevelBusyUI(true, 0);
        el.status.textContent = t('segLevelProcessing');

        await segLevelYield();

        try {
            const analysis = await analyzeSegmentLevelingWithParamsAsync(
                st.dataset,
                direction,
                segmentCount,
                (p) => {
                    if (runId !== st.edit.segLevelRunId) return;
                    setSegLevelBusyUI(true, p);
                },
                () => runId !== st.edit.segLevelRunId,
            );

            if (runId !== st.edit.segLevelRunId) return;

            if (!analysis.ok) {
                if (analysis.reason !== 'cancelled') {
                    if (analysis.reason === 'invalidParams') {
                        showToast(t('segLevelInvalidCount', maxBands), 'info');
                    } else if (analysis.reason === 'scatter') {
                        showToast(t('segLevelScatter'), 'info');
                    } else if (analysis.reason === 'tooSmall') {
                        showToast(t('segLevelTooSmall'), 'error');
                    } else {
                        showToast(t('segLevelInsufficient'), 'error');
                    }
                }
                syncSegLevelConfigUI();
                return;
            }

            st.edit.segLevelResult = analysis;
            segLevelResetProbeIndices();
            st.edit.segLevelBusy = false;
            setSegLevelBusyUI(false);
            buildSegLevelTuneUI(analysis);
            if (options.resetView) segLevelResetViews();
            renderSegLevelCompare({ resetView: !!options.resetView });
            updateEditButtons();
            el.status.textContent = segLevelStatusText(analysis);
        } catch (err) {
            console.error(err);
            if (runId === st.edit.segLevelRunId) {
                showToast(String(err.message || err), 'error');
                syncSegLevelConfigUI();
            }
        } finally {
            if (runId === st.edit.segLevelRunId && st.edit.segLevelBusy) {
                st.edit.segLevelBusy = false;
                setSegLevelBusyUI(false);
                updateEditButtons();
            }
        }
    }

    function onSegLevelConfigChange() {
        if (!st.edit.segLevel || st.edit.segLevelBusy || st.edit.segLevelTuneBusy) return;
        recomputeSegLevelWithConfig({ resetView: true });
    }

    async function runSegLevelAuto() {
        if (!st.edit.segLevel || st.edit.segLevelBusy || st.edit.segLevelTuneBusy || !st.dataset) return;
        if (typeof analyzeSegmentLevelingAsync !== 'function') return;

        st.edit.segLevelBusy = true;
        st.edit.segLevelTuneRunId++;
        segLevelCancelProbeCorrection();
        const runId = ++st.edit.segLevelRunId;
        setSegLevelBusyUI(true, 0);
        setSegLevelTuneUI(false);
        updateEditButtons();
        el.status.textContent = t('segLevelAnalyzing');

        await segLevelYield();

        try {
            const analysis = await analyzeSegmentLevelingAsync(
                st.dataset,
                (p) => {
                    if (runId !== st.edit.segLevelRunId) return;
                    setSegLevelBusyUI(true, p);
                },
                () => runId !== st.edit.segLevelRunId,
            );

            if (runId !== st.edit.segLevelRunId) return;

            if (!analysis.ok) {
                if (analysis.reason !== 'cancelled') {
                    if (analysis.reason === 'scatter') showToast(t('segLevelScatter'), 'info');
                    else if (analysis.reason === 'tooSmall') showToast(t('segLevelTooSmall'), 'error');
                    else showToast(t('segLevelInsufficient'), 'error');
                }
                return;
            }

            st.edit.segLevelResult = analysis;
            segLevelResetProbeIndices();
            st.edit.segLevelBusy = false;
            setSegLevelBusyUI(false);
            setSegLevelConfigUI(true);
            buildSegLevelTuneUI(analysis);
            renderSegLevelCompare({ resetView: true });
            updateEditButtons();
            el.status.textContent = segLevelStatusText(analysis);
        } catch (err) {
            console.error(err);
            if (runId === st.edit.segLevelRunId) showToast(String(err.message || err), 'error');
        } finally {
            if (runId === st.edit.segLevelRunId && st.edit.segLevelBusy) {
                st.edit.segLevelBusy = false;
                setSegLevelBusyUI(false);
                if (st.edit.segLevelResult) {
                    setSegLevelConfigUI(true);
                    buildSegLevelTuneUI(st.edit.segLevelResult);
                    syncSegLevelConfigUI();
                    el.status.textContent = segLevelStatusText(st.edit.segLevelResult);
                } else {
                    el.status.textContent = t('segLevelIdle');
                }
                updateEditButtons();
            }
        }
    }

    function onSegLevelCountKeydown(e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (e.target && typeof e.target.blur === 'function') e.target.blur();
        onSegLevelConfigChange();
    }

    function segLevelEditorPage() {
        return document.getElementById('pageEditor');
    }

    function syncSegLevelSideToggle() {
        const btn = el.sideToggle;
        const page = segLevelEditorPage();
        if (!btn || !page) return;
        const open = page.classList.contains('side-open');
        const key = open ? 'segLevelSideCollapse' : 'segLevelSideExpand';
        btn.title = t(key);
        btn.setAttribute('aria-label', t(key));
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function scheduleSegLevelSideRefit() {
        const page = segLevelEditorPage();
        const main = page && page.querySelector('main');
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            if (st.edit.segLevel && st.edit.segLevelResult) renderSegLevelCompare({ resetView: true });
            else if (st.edit.uniLevel && st.edit.uniLevelResult) renderUniLevelCompare({ resetView: true });
            else if (!st.edit.segLevel && !st.edit.uniLevel && st.dataset) render(st.dataset, el.colormap.value, false);
        };
        if (main) {
            const onEnd = (e) => {
                if (e.propertyName !== 'grid-template-columns') return;
                main.removeEventListener('transitionend', onEnd);
                finish();
            };
            main.addEventListener('transitionend', onEnd);
        }
        setTimeout(finish, 280);
    }

    function setSegLevelSideUI(active) {
        const page = segLevelEditorPage();
        if (!page) return;
        page.classList.toggle('seg-level-side', !!active);
        if (!active) page.classList.remove('side-open');
        syncSegLevelSideToggle();
        scheduleSegLevelSideRefit();
    }

    function toggleSegLevelSide() {
        const page = segLevelEditorPage();
        if (!page || !page.classList.contains('seg-level-side')) return;
        page.classList.toggle('side-open');
        syncSegLevelSideToggle();
        scheduleSegLevelSideRefit();
    }

    function enterSegLevelUI(active) {
        if (el.viewer) el.viewer.classList.toggle('seg-level-active', active);
        if (el.segLevelPanel) el.segLevelPanel.setAttribute('aria-hidden', active ? 'false' : 'true');
        if (el.segLevel) el.segLevel.classList.toggle('tool-active', active);
        setSegLevelSideUI(active);
        if (active && !st.edit.segLevelBusy && st.edit.segLevelResult) {
            requestAnimationFrame(() => renderSegLevelCompare({ resetView: true }));
        }
    }

    function exitSegLevelMode() {
        st.edit.segLevel = false;
        st.edit.segLevelBusy = false;
        st.edit.segLevelTuneBusy = false;
        st.edit.segLevelRunId++;
        st.edit.segLevelBase = null;
        st.edit.segLevelResult = null;
        st.edit.segLevelTuneRunId++;
        segLevelCancelProbeCorrection();
        segLevelClearProbeFeedback();
        st.edit.segLevelShowBounds = false;
        segLevelResetProbeIndices();
        segLevelResetClips();
        segLevelHideProbes();
        segLevelResetViews();
        setSegLevelTuneBusyUI(false);
        setSegLevelTuneUI(false);
        setSegLevelConfigUI(false);
        setSegLevelBusyUI(false);
        enterSegLevelUI(false);
        updateEditButtons();
    }

    function cancelSegLevel() {
        if (!st.edit.segLevel) return;
        st.edit.segLevelRunId++;
        const base = st.edit.segLevelBase;
        if (base && st.dataset && !st.edit.segLevelBusy) {
            st.dataset.data = base.data.slice();
            st.dataset.vmin = base.vmin;
            st.dataset.vmax = base.vmax;
            resetColorClip(false);
            render(st.dataset, el.colormap.value, false);
        }
        exitSegLevelMode();
    }

    async function startSegLevelMode() {
        if (!editing || !st.dataset) { showToast(t('editNoData'), 'info'); return; }
        if (isScatter(st.dataset)) { showToast(t('segLevelScatter'), 'info'); return; }
        if (st.edit.segLevel) {
            if (st.edit.segLevelBusy) {
                st.edit.segLevelRunId++;
                exitSegLevelMode();
            } else {
                cancelSegLevel();
            }
            return;
        }

        endTransientModes();

        snapshotSegLevelBase();
        segLevelResetViews();
        segLevelResetClips();
        segLevelResetProbeIndices();
        segLevelResetProbeVisibility();
        segLevelCancelProbeCorrection();
        st.edit.segLevel = true;
        st.edit.segLevelShowBounds = false;
        st.edit.segLevelBusy = false;
        st.edit.segLevelResult = null;
        st.edit.segLevelRunId++;

        enterSegLevelUI(true);
        syncSegLevelBoundsToggle();
        setSegLevelBusyUI(false);
        setSegLevelTuneUI(false);
        resetSegLevelManualConfig();
        if (st.edit.segLevelBase && st.dataset) {
            const { data, vmin, vmax } = st.edit.segLevelBase;
            const dr = segLevelDisplayRange(vmin, vmax, segLevelClipFor('before'));
            renderSegLevelCanvas(
                el.segLevelBefore, data, st.dataset.width, st.dataset.height,
                dr.cmin, dr.crange, el.colormap.value, 'horizontal', [], false,
                'beforeImg', true,
            );
            renderSegLevelPaneColorbar(
                el.segLevelBeforeCb, el.segLevelBeforeCbLo, el.segLevelBeforeCbHi,
                vmin, vmax, el.colormap.value, segLevelClipFor('before'),
            );
            if (el.segLevelAfter) {
                const c = el.segLevelAfter;
                const ctx = c.getContext('2d');
                if (ctx) { ctx.clearRect(0, 0, c.width, c.height); }
            }
            clearSegLevelProfileCanvas(el.segLevelBeforeProfile);
            clearSegLevelProfileCanvas(el.segLevelAfterProfile);
        }
        updateEditButtons();
        el.status.textContent = t('segLevelIdle');
    }

    function applySegLevel() {
        if (!st.edit.segLevel || st.edit.segLevelBusy || !st.edit.segLevelResult || !st.dataset) return;
        const result = st.edit.segLevelResult;
        ensureFloatPixels(st.dataset);
        st.dataset.data = result.correctedData.slice();
        exitSegLevelMode();
        refreshAfterEdit(false);
        pushHistory();
        setLastEditStep({
            type: 'segmentLevel',
            direction: result.direction,
            boundaries: result.boundaries.slice(),
            tiltK: result.tiltK,
            bandOffsets: result.bandOffsets ? result.bandOffsets.slice() : [],
        });
        const msg = t('segLevelDone', result.segmentCount, segLevelDirLabel(result.direction));
        el.status.textContent = msg;
        showToast(msg, 'info');
    }

    /* ---------- 分區錯位校正模式（自動分割 + 各帶 skew） ---------- */

    function segSkewDirLabel(direction) {
        return direction === 'vertical' ? t('segSkewDirVertical') : t('segSkewDirHorizontal');
    }

    function segSkewConfigLimits(direction) {
        if (!st.dataset || typeof segSkewBoundaryOptionsForDirection !== 'function') return null;
        const { width, height } = st.dataset;
        const dir = direction === 'vertical' ? 'vertical' : 'horizontal';
        const opts = segSkewBoundaryOptionsForDirection(width, height, dir);
        const maxBands = typeof segLevelMaxValidBandCount === 'function'
            ? segLevelMaxValidBandCount(opts.axisLen, opts.minDist, opts.edgeMargin)
            : 20;
        return { ...opts, maxBands: Math.max(2, maxBands) };
    }

    function setSegSkewConfigUI(visible) {
        if (el.segSkewConfig) el.segSkewConfig.setAttribute('aria-hidden', visible ? 'false' : 'true');
    }

    /** 進入模式時只帶出方向與等份數，不啟動分析。 */
    function resetSegSkewManualConfig() {
        setSegSkewConfigUI(true);
        if (el.segSkewDir) el.segSkewDir.value = 'horizontal';
        const limits = segSkewConfigLimits('horizontal');
        if (el.segSkewCount) {
            el.segSkewCount.min = '2';
            el.segSkewCount.max = String(limits ? limits.maxBands : 20);
            el.segSkewCount.value = '2';
        }
    }

    function syncSegSkewConfigUI() {
        const result = st.edit.segSkewResult;
        if (!result) return;
        const limits = segSkewConfigLimits(result.direction);
        if (el.segSkewDir) el.segSkewDir.value = result.direction;
        if (el.segSkewCount && limits) {
            el.segSkewCount.min = '2';
            el.segSkewCount.max = String(limits.maxBands);
            el.segSkewCount.value = String(result.segmentCount);
        }
    }

    function readSegSkewConfigFromUI() {
        const direction = el.segSkewDir?.value === 'vertical' ? 'vertical' : 'horizontal';
        let segmentCount = parseInt(el.segSkewCount?.value, 10);
        const limits = segSkewConfigLimits(direction);
        const maxBands = limits ? limits.maxBands : 20;
        if (!Number.isFinite(segmentCount)) segmentCount = 2;
        if (segmentCount < 2) segmentCount = 2;
        if (segmentCount > maxBands) segmentCount = maxBands;
        if (el.segSkewCount) {
            el.segSkewCount.min = '2';
            el.segSkewCount.max = String(maxBands);
            el.segSkewCount.value = String(segmentCount);
        }
        return { direction, segmentCount, maxBands };
    }

    function segSkewStatusText(result) {
        if (!result) return '';
        return t('segSkewMeta', segSkewDirLabel(result.direction), result.segmentCount, result.shiftPx);
    }

    function snapshotSegSkewBase() {
        const ds = st.dataset;
        const src = ds.data;
        st.edit.segSkewBase = {
            data: src instanceof Float32Array ? src.slice() : Float32Array.from(src),
            vmin: ds.vmin,
            vmax: ds.vmax,
        };
    }

    function segSkewEnsureViews() {
        if (!st.edit.segSkewViews) {
            st.edit.segSkewViews = {
                beforeImg: segLevelDefaultView(),
                afterImg: segLevelDefaultView(),
            };
        }
        return st.edit.segSkewViews;
    }

    function segSkewResetViews() {
        st.edit.segSkewViews = null;
        st.edit.segSkewPan = null;
    }

    function segSkewImagePeer(key) {
        if (key === 'beforeImg') {
            return {
                key: 'afterImg',
                canvas: el.segSkewAfter,
                wrap: el.segSkewAfter ? el.segSkewAfter.parentElement : null,
            };
        }
        if (key === 'afterImg') {
            return {
                key: 'beforeImg',
                canvas: el.segSkewBefore,
                wrap: el.segSkewBefore ? el.segSkewBefore.parentElement : null,
            };
        }
        return null;
    }

    function segSkewMirrorImageView(fromKey) {
        const peer = segSkewImagePeer(fromKey);
        if (!peer || !peer.canvas || !peer.wrap) return;
        const views = segSkewEnsureViews();
        const src = views[fromKey];
        const dst = views[peer.key];
        if (!src || !dst) return;
        dst.scale = src.scale;
        dst.tx = src.tx;
        dst.ty = src.ty;
        dst.minScale = src.minScale;
        dst.maxScale = src.maxScale;
        dst.contentW = src.contentW;
        dst.contentH = src.contentH;
        segLevelApplyViewTransform(peer.canvas, dst, peer.wrap);
    }

    function segSkewSyncViewTransform(zoomKey, canvas, resetView) {
        if (!zoomKey || !canvas) return;
        const wrap = canvas.parentElement;
        if (!wrap) return;
        const views = segSkewEnsureViews();
        const view = views[zoomKey];
        const { cw, ch } = segLevelContentSize(canvas);
        const sizeChanged = view.contentW !== cw || view.contentH !== ch;
        if (resetView || sizeChanged) segLevelFitView(view, wrap, cw, ch);
        segLevelApplyViewTransform(canvas, view, wrap);
        if (st.edit.segSkew && (zoomKey === 'beforeImg' || zoomKey === 'afterImg')) {
            segSkewMirrorImageView(zoomKey);
        }
    }

    function segSkewZoomAt(zoomKey, wrap, canvas, screenX, screenY, zoomFactor) {
        const views = segSkewEnsureViews();
        const view = views[zoomKey];
        let newScale = view.scale * zoomFactor;
        if (newScale < view.minScale) newScale = view.minScale;
        if (newScale > view.maxScale) newScale = view.maxScale;
        const k = newScale / view.scale;
        view.tx = screenX - (screenX - view.tx) * k;
        view.ty = screenY - (screenY - view.ty) * k;
        view.scale = newScale;
        segLevelApplyViewTransform(canvas, view, wrap);
        if (zoomKey === 'beforeImg' || zoomKey === 'afterImg') segSkewMirrorImageView(zoomKey);
    }

    function setupSegSkewZoom() {
        const targets = [
            { wrap: el.segSkewBefore?.parentElement, canvas: el.segSkewBefore, key: 'beforeImg' },
            { wrap: el.segSkewAfter?.parentElement, canvas: el.segSkewAfter, key: 'afterImg' },
        ];
        for (const tgt of targets) {
            if (!tgt.wrap || !tgt.canvas || tgt.wrap.dataset.segSkewZoomBound) continue;
            tgt.wrap.dataset.segSkewZoomBound = '1';
            tgt.wrap.classList.add('seg-level-zoomable');
            if (!tgt.wrap.querySelector('.seg-level-zoom-ind')) {
                const ind = document.createElement('div');
                ind.className = 'seg-level-zoom-ind';
                ind.setAttribute('aria-hidden', 'true');
                tgt.wrap.appendChild(ind);
            }
            tgt.wrap.addEventListener('wheel', (e) => {
                if (!st.edit.segSkew || st.edit.segSkewBusy) return;
                e.preventDefault();
                e.stopPropagation();
                const rect = tgt.wrap.getBoundingClientRect();
                segSkewZoomAt(tgt.key, tgt.wrap, tgt.canvas, e.clientX - rect.left, e.clientY - rect.top,
                    Math.pow(1.0015, -(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * tgt.wrap.clientHeight : e.deltaY)));
            }, { passive: false });
            tgt.wrap.addEventListener('mousedown', (e) => {
                if (!st.edit.segSkew || st.edit.segSkewBusy || e.button !== 0) return;
                const views = segSkewEnsureViews();
                const view = views[tgt.key];
                const peer = segSkewImagePeer(tgt.key);
                st.edit.segSkewPan = {
                    key: tgt.key,
                    wrap: tgt.wrap,
                    canvas: tgt.canvas,
                    peerWrap: peer && peer.wrap,
                    startX: e.clientX,
                    startY: e.clientY,
                    tx: view.tx,
                    ty: view.ty,
                };
                tgt.wrap.classList.add('grabbing');
                if (peer && peer.wrap) peer.wrap.classList.add('grabbing');
                e.preventDefault();
            });
            tgt.wrap.addEventListener('dblclick', (e) => {
                if (!st.edit.segSkew || st.edit.segSkewBusy) return;
                e.preventDefault();
                const views = segSkewEnsureViews();
                const view = views[tgt.key];
                segLevelFitView(view, tgt.wrap, view.contentW, view.contentH);
                segLevelApplyViewTransform(tgt.canvas, view, tgt.wrap);
                if (tgt.key === 'beforeImg' || tgt.key === 'afterImg') segSkewMirrorImageView(tgt.key);
            });
        }
        if (!st.edit.segSkewPanBound) {
            st.edit.segSkewPanBound = true;
            window.addEventListener('mousemove', (e) => {
                const pan = st.edit.segSkewPan;
                if (!pan) return;
                const views = segSkewEnsureViews();
                const view = views[pan.key];
                view.tx = pan.tx + (e.clientX - pan.startX);
                view.ty = pan.ty + (e.clientY - pan.startY);
                segLevelApplyViewTransform(pan.canvas, view, pan.wrap);
                if (pan.key === 'beforeImg' || pan.key === 'afterImg') segSkewMirrorImageView(pan.key);
            });
            window.addEventListener('mouseup', () => {
                const pan = st.edit.segSkewPan;
                if (!pan) return;
                pan.wrap.classList.remove('grabbing');
                if (pan.peerWrap) pan.peerWrap.classList.remove('grabbing');
                st.edit.segSkewPan = null;
            });
        }
    }

    function segSkewShowBoundsEnabled() {
        return !!st.edit.segSkewShowBounds;
    }

    function syncSegSkewBoundsToggle() {
        if (!el.segSkewShowBounds) return;
        el.segSkewShowBounds.checked = segSkewShowBoundsEnabled();
    }

    function onSegSkewBoundsToggle() {
        if (!st.edit.segSkew || st.edit.segSkewBusy) return;
        st.edit.segSkewShowBounds = !!el.segSkewShowBounds?.checked;
        renderSegSkewCompare();
    }

    function renderSegSkewCanvas(canvas, data, width, height, cmin, crange, cmap, direction, boundaries, zoomKey, resetView) {
        if (!canvas) return;
        const cw = Math.max(1, width);
        const ch = Math.max(1, height);
        canvas.width = cw;
        canvas.height = ch;
        canvas.style.width = cw + 'px';
        canvas.style.height = ch + 'px';
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(cw, ch);
        const px = img.data;
        const lut = buildColormapLut(cmap);
        for (let y = 0; y < ch; y++) {
            const rowBase = y * width;
            for (let x = 0; x < cw; x++) {
                const v = data[rowBase + x];
                const po = (y * cw + x) * 4;
                if (!Number.isFinite(v)) {
                    paintMissingPixel(px, po);
                    continue;
                }
                let t = (v - cmin) / crange;
                if (t < 0) t = 0; else if (t > 1) t = 1;
                const lo = ((t * 255) | 0) * 3;
                px[po] = lut[lo]; px[po + 1] = lut[lo + 1]; px[po + 2] = lut[lo + 2]; px[po + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        if (segSkewShowBoundsEnabled() && boundaries && boundaries.length) {
            segLevelDrawImageSplitLines(ctx, direction, boundaries, cw, ch, canvas);
        }
        segSkewSyncViewTransform(zoomKey, canvas, resetView);
    }

    function renderSegSkewCompare(opts) {
        const resetView = !!(opts && opts.resetView);
        const base = st.edit.segSkewBase;
        const result = st.edit.segSkewResult;
        if (!base || !result || !st.dataset) return;
        const ds = st.dataset;
        const cmap = el.colormap.value;
        const { width, height } = ds;
        const afterData = result.correctedData;
        const afterStats = computeRange(afterData);
        const beforeDr = segLevelDisplayRange(base.vmin, base.vmax, st.colorClip);
        const afterDr = segLevelDisplayRange(afterStats.vmin, afterStats.vmax, st.colorClip);
        renderSegSkewCanvas(
            el.segSkewBefore, base.data, width, height,
            beforeDr.cmin, beforeDr.crange, cmap, result.direction, result.boundaries, 'beforeImg', resetView,
        );
        renderSegSkewCanvas(
            el.segSkewAfter, afterData, width, height,
            afterDr.cmin, afterDr.crange, cmap, result.direction, result.boundaries, 'afterImg', resetView,
        );
        renderSegLevelPaneColorbar(
            el.segSkewBeforeCb, el.segSkewBeforeCbLo, el.segSkewBeforeCbHi,
            base.vmin, base.vmax, cmap, st.colorClip,
        );
        renderSegLevelPaneColorbar(
            el.segSkewAfterCb, el.segSkewAfterCbLo, el.segSkewAfterCbHi,
            afterStats.vmin, afterStats.vmax, cmap, st.colorClip,
        );
        syncSegSkewConfigUI();
    }

    function renderSegSkewAfterOnly() {
        const base = st.edit.segSkewBase;
        const result = st.edit.segSkewResult;
        if (!base || !result || !st.dataset) return;
        const ds = st.dataset;
        const cmap = el.colormap.value;
        const { width, height } = ds;
        const afterData = result.correctedData;
        const afterStats = computeRange(afterData);
        const afterDr = segLevelDisplayRange(afterStats.vmin, afterStats.vmax, st.colorClip);
        renderSegSkewCanvas(
            el.segSkewAfter, afterData, width, height,
            afterDr.cmin, afterDr.crange, cmap, result.direction, result.boundaries, 'afterImg', false,
        );
        renderSegLevelPaneColorbar(
            el.segSkewAfterCb, el.segSkewAfterCbLo, el.segSkewAfterCbHi,
            afterStats.vmin, afterStats.vmax, cmap, st.colorClip,
        );
    }

    function setSegSkewTuneUI(visible) {
        if (el.segSkewTune) el.segSkewTune.setAttribute('aria-hidden', visible ? 'false' : 'true');
    }

    function readSegSkewShiftFromUI() {
        const result = st.edit.segSkewResult;
        if (!result || !el.segSkewTuneShift) return;
        const v = parseFloat(el.segSkewTuneShift.value);
        result.shiftPx = Number.isFinite(v) ? Math.round(v) : result.autoShiftPx;
    }

    function syncSegSkewShiftInput(result) {
        const src = result || st.edit.segSkewResult;
        if (!src || !el.segSkewTuneShift) return;
        el.segSkewTuneShift.value = String(src.shiftPx);
    }

    function setSegSkewTuneBusyUI(busy) {
        st.edit.segSkewTuneBusy = !!busy;
        if (el.segSkewCompare) el.segSkewCompare.classList.toggle('is-tune-busy', !!busy);
        if (el.segSkewTune) el.segSkewTune.classList.toggle('is-busy', !!busy);
        if (el.segSkewTuneBusy) {
            el.segSkewTuneBusy.classList.toggle('show', !!busy);
            el.segSkewTuneBusy.setAttribute('aria-hidden', busy ? 'false' : 'true');
        }
        if (el.segSkewTuneShift) el.segSkewTuneShift.disabled = !!busy;
        if (el.segSkewTuneReset) el.segSkewTuneReset.disabled = !!busy;
        if (el.segSkewBandShiftReset) el.segSkewBandShiftReset.disabled = !!busy;
        if (el.segSkewBandShiftList) {
            el.segSkewBandShiftList.querySelectorAll('input').forEach((input) => {
                input.disabled = !!busy;
            });
        }
        updateEditButtons();
    }

    function setSegSkewBusyUI(busy, progress) {
        if (el.segSkewCompare) el.segSkewCompare.classList.toggle('is-busy', !!busy);
        if (el.segSkewBusy) {
            el.segSkewBusy.classList.toggle('show', !!busy);
            el.segSkewBusy.setAttribute('aria-hidden', busy ? 'false' : 'true');
        }
        if (el.segSkewBusyText && busy) {
            const pct = Math.round((progress || 0) * 100);
            el.segSkewBusyText.textContent = pct > 0 && pct < 100
                ? t('segSkewProgress', pct)
                : t('segSkewProcessing');
        }
        updateEditButtons();
    }

    async function recomputeSegSkewPreview() {
        const base = st.edit.segSkewBase;
        const result = st.edit.segSkewResult;
        if (!base || !result || !st.dataset) return;
        const { width, height } = st.dataset;
        const tuneRunId = ++st.edit.segSkewTuneRunId;
        const outBuf = result.correctedData instanceof Float32Array ? result.correctedData : null;

        setSegSkewTuneBusyUI(true);
        await segLevelYield();
        if (tuneRunId !== st.edit.segSkewTuneRunId) {
            setSegSkewTuneBusyUI(false);
            return;
        }

        try {
            const bandShifts = segSkewEnsureBandShifts(result);
            if (typeof applySegmentSkewAsync === 'function') {
                const out = await applySegmentSkewAsync(
                    base.data, width, height, result.direction, result.boundaries, result.shiftPx,
                    outBuf, 64, () => tuneRunId !== st.edit.segSkewTuneRunId, bandShifts,
                );
                if (!out || tuneRunId !== st.edit.segSkewTuneRunId) return;
                result.correctedData = out;
            } else {
                result.correctedData = applySegmentSkew(
                    base.data, width, height, result.direction, result.boundaries, result.shiftPx, outBuf, bandShifts,
                );
            }
            renderSegSkewAfterOnly();
            el.status.textContent = segSkewStatusText(result);
        } finally {
            if (tuneRunId === st.edit.segSkewTuneRunId) setSegSkewTuneBusyUI(false);
        }
    }

    function segSkewEnsureBandShifts(result) {
        const n = Math.max(1, result.segmentCount || ((result.boundaries ? result.boundaries.length : 0) + 1));
        if (!result.bandShifts || result.bandShifts.length !== n) {
            result.bandShifts = new Array(n).fill(0);
        }
        return result.bandShifts;
    }

    function readSegSkewBandShiftsFromUI() {
        const result = st.edit.segSkewResult;
        const list = el.segSkewBandShiftList;
        if (!result || !list) return;
        const shifts = segSkewEnsureBandShifts(result);
        list.querySelectorAll('input').forEach((input) => {
            const i = parseInt(input.dataset.band, 10);
            if (!Number.isInteger(i) || i < 0 || i >= shifts.length) return;
            const v = parseFloat(input.value);
            shifts[i] = Number.isFinite(v) ? Math.round(v) : 0;
        });
    }

    function syncSegSkewBandShiftInputs(result) {
        const list = el.segSkewBandShiftList;
        if (!list || !result) return;
        const shifts = segSkewEnsureBandShifts(result);
        const inputs = list.querySelectorAll('input');
        if (inputs.length !== shifts.length) {
            buildSegSkewBandShiftInputs(result);
            return;
        }
        inputs.forEach((input) => {
            if (document.activeElement === input) return;
            const i = parseInt(input.dataset.band, 10);
            if (Number.isInteger(i) && i >= 0 && i < shifts.length) input.value = String(shifts[i]);
        });
    }

    function syncSegSkewBandShiftHint(result) {
        if (!el.segSkewBandShiftHint || !result) return;
        el.segSkewBandShiftHint.textContent = result.direction === 'vertical'
            ? t('segSkewBandShiftHintVertical')
            : t('segSkewBandShiftHintHorizontal');
    }

    function buildSegSkewBandShiftInputs(result) {
        const list = el.segSkewBandShiftList;
        if (!list || !result) return;
        const shifts = segSkewEnsureBandShifts(result);
        list.replaceChildren();
        for (let i = 0; i < shifts.length; i++) {
            const label = document.createElement('label');
            label.className = 'seg-level-band-offset';
            const swatch = document.createElement('span');
            swatch.className = 'seg-level-band-offset-swatch';
            swatch.style.background = segLevelBandFitColor(i);
            const name = document.createElement('span');
            name.textContent = t('segSkewBandShiftItem', i + 1);
            const input = document.createElement('input');
            input.type = 'number';
            input.step = '1';
            input.value = String(shifts[i]);
            input.dataset.band = String(i);
            input.addEventListener('keydown', onSegSkewTuneKeydown);
            label.append(swatch, name, input);
            list.appendChild(label);
        }
    }

    function resetSegSkewBandShifts() {
        if (st.edit.segSkewTuneBusy || st.edit.segSkewBusy) return;
        const result = st.edit.segSkewResult;
        if (!result) {
            if (el.segSkewBandShiftList) {
                el.segSkewBandShiftList.querySelectorAll('input').forEach((input) => { input.value = '0'; });
            }
            return;
        }
        const shifts = segSkewEnsureBandShifts(result);
        shifts.fill(0);
        syncSegSkewBandShiftInputs(result);
        recomputeSegSkewPreview();
    }

    function commitSegSkewTune() {
        if (!st.edit.segSkew || st.edit.segSkewBusy || st.edit.segSkewTuneBusy) return;
        readSegSkewShiftFromUI();
        readSegSkewBandShiftsFromUI();
        recomputeSegSkewPreview();
    }

    function onSegSkewTuneKeydown(e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (e.target && typeof e.target.blur === 'function') e.target.blur();
        commitSegSkewTune();
    }

    function buildSegSkewTuneUI(result) {
        if (!result) return;
        setSegSkewTuneUI(true);
        segSkewEnsureBandShifts(result);
        syncSegSkewShiftInput(result);
        syncSegSkewBandShiftHint(result);
        buildSegSkewBandShiftInputs(result);
    }

    /** 剛進入模式、還沒計算時，先用目前方向與等份數把微調欄位秀出來。 */
    function showSegSkewTuneDefaults() {
        const direction = el.segSkewDir?.value === 'vertical' ? 'vertical' : 'horizontal';
        const count = Math.max(2, parseInt(el.segSkewCount?.value, 10) || 2);
        buildSegSkewTuneUI({
            direction,
            segmentCount: count,
            shiftPx: 0,
            bandShifts: new Array(count).fill(0),
        });
    }

    function segSkewDraftShift() {
        const v = parseFloat(el.segSkewTuneShift?.value);
        if (Number.isFinite(v)) return Math.round(v);
        const prev = st.edit.segSkewResult;
        return prev && Number.isFinite(prev.shiftPx) ? prev.shiftPx : 0;
    }

    function segSkewDraftBandShifts(count) {
        const n = Math.max(1, count || 1);
        const shifts = new Array(n).fill(0);
        const inputs = el.segSkewBandShiftList ? el.segSkewBandShiftList.querySelectorAll('input') : [];
        if (inputs.length) {
            inputs.forEach((input) => {
                const i = parseInt(input.dataset.band, 10);
                if (!Number.isInteger(i) || i < 0 || i >= n) return;
                const v = parseFloat(input.value);
                shifts[i] = Number.isFinite(v) ? Math.round(v) : 0;
            });
            return shifts;
        }
        const prev = st.edit.segSkewResult;
        if (prev && Array.isArray(prev.bandShifts)) {
            for (let i = 0; i < n && i < prev.bandShifts.length; i++) {
                const v = prev.bandShifts[i];
                shifts[i] = Number.isFinite(v) ? Math.round(v) : 0;
            }
        }
        return shifts;
    }

    async function segSkewApplyDraftBands(analysis, runId) {
        const bandShifts = segSkewDraftBandShifts(analysis.segmentCount);
        analysis.bandShifts = bandShifts;
        if (!bandShifts.some((v) => v) || !st.edit.segSkewBase || typeof applySegmentSkewAsync !== 'function') {
            return runId === st.edit.segSkewRunId;
        }
        const base = st.edit.segSkewBase;
        const out = await applySegmentSkewAsync(
            base.data, st.dataset.width, st.dataset.height,
            analysis.direction, analysis.boundaries, analysis.shiftPx,
            null, 64, () => runId !== st.edit.segSkewRunId, bandShifts,
        );
        if (runId !== st.edit.segSkewRunId) return false;
        if (out) analysis.correctedData = out;
        return true;
    }

    function resetSegSkewShift() {
        if (st.edit.segSkewTuneBusy) return;
        const result = st.edit.segSkewResult;
        if (!result || !Number.isFinite(result.autoShiftPx)) {
            if (el.segSkewTuneShift) el.segSkewTuneShift.value = '0';
            return;
        }
        result.shiftPx = result.autoShiftPx;
        syncSegSkewShiftInput();
        recomputeSegSkewPreview();
    }

    async function recomputeSegSkewWithConfig(options) {
        options = options || {};
        if (!st.edit.segSkew || st.edit.segSkewBusy || st.edit.segSkewTuneBusy || !st.dataset) return;
        if (typeof analyzeSegmentSkewWithParamsAsync !== 'function') return;

        const prev = st.edit.segSkewResult;
        const { direction, segmentCount, maxBands } = readSegSkewConfigFromUI();
        if (prev && prev.direction === direction && prev.segmentCount === segmentCount && !options.force) {
            syncSegSkewConfigUI();
            return;
        }

        const rawCount = parseInt(el.segSkewCount?.value, 10);
        if (Number.isFinite(rawCount) && rawCount > maxBands) {
            showToast(t('segSkewInvalidCount', maxBands), 'info');
        }

        st.edit.segSkewBusy = true;
        st.edit.segSkewTuneRunId++;
        const runId = ++st.edit.segSkewRunId;
        setSegSkewBusyUI(true, 0);
        el.status.textContent = t('segSkewProcessing');

        await segLevelYield();

        try {
            const keepShift = segSkewDraftShift();
            const analysis = await analyzeSegmentSkewWithParamsAsync(
                st.dataset,
                direction,
                segmentCount,
                keepShift,
                (p) => {
                    if (runId !== st.edit.segSkewRunId) return;
                    setSegSkewBusyUI(true, p);
                },
                () => runId !== st.edit.segSkewRunId,
            );

            if (runId !== st.edit.segSkewRunId) return;

            if (!analysis.ok) {
                if (analysis.reason !== 'cancelled') {
                    if (analysis.reason === 'invalidParams') showToast(t('segSkewInvalidCount', maxBands), 'info');
                    else if (analysis.reason === 'scatter') showToast(t('segSkewScatter'), 'info');
                    else if (analysis.reason === 'tooSmall') showToast(t('segSkewTooSmall'), 'error');
                    else showToast(t('segSkewInsufficient'), 'error');
                }
                syncSegSkewConfigUI();
                return;
            }

            if (!(await segSkewApplyDraftBands(analysis, runId))) return;

            st.edit.segSkewResult = analysis;
            st.edit.segSkewBusy = false;
            setSegSkewBusyUI(false);
            buildSegSkewTuneUI(analysis);
            if (options.resetView) segSkewResetViews();
            renderSegSkewCompare({ resetView: !!options.resetView });
            updateEditButtons();
            el.status.textContent = segSkewStatusText(analysis);
        } catch (err) {
            console.error(err);
            if (runId === st.edit.segSkewRunId) {
                showToast(String(err.message || err), 'error');
                syncSegSkewConfigUI();
            }
        } finally {
            if (runId === st.edit.segSkewRunId && st.edit.segSkewBusy) {
                st.edit.segSkewBusy = false;
                setSegSkewBusyUI(false);
                updateEditButtons();
            }
        }
    }

    function onSegSkewConfigChange() {
        if (!st.edit.segSkew || st.edit.segSkewBusy || st.edit.segSkewTuneBusy) return;
        recomputeSegSkewWithConfig({ resetView: true });
    }

    async function runSegSkewAuto() {
        if (!st.edit.segSkew || st.edit.segSkewBusy || st.edit.segSkewTuneBusy || !st.dataset) return;
        if (typeof analyzeSegmentSkewWithParamsAsync !== 'function'
            || typeof segSkewDetectBandCountAsync !== 'function') return;

        st.edit.segSkewBusy = true;
        st.edit.segSkewTuneRunId++;
        const runId = ++st.edit.segSkewRunId;
        setSegSkewBusyUI(true, 0);
        setSegSkewTuneUI(false);
        updateEditButtons();
        el.status.textContent = t('segSkewAnalyzing');

        await segLevelYield();

        try {
            const { direction } = readSegSkewConfigFromUI();
            const keepShift = segSkewDraftShift();
            const segmentCount = typeof segSkewDetectBandCountAsync === 'function'
                ? await segSkewDetectBandCountAsync(
                    st.dataset.data, st.dataset.width, st.dataset.height, direction,
                    () => runId !== st.edit.segSkewRunId,
                )
                : 0;

            if (runId !== st.edit.segSkewRunId) return;
            if (!segmentCount) return;

            const analysis = await analyzeSegmentSkewWithParamsAsync(
                st.dataset,
                direction,
                segmentCount,
                keepShift,
                (p) => {
                    if (runId !== st.edit.segSkewRunId) return;
                    setSegSkewBusyUI(true, p);
                },
                () => runId !== st.edit.segSkewRunId,
            );

            if (runId !== st.edit.segSkewRunId) return;

            if (!analysis.ok) {
                if (analysis.reason !== 'cancelled') {
                    if (analysis.reason === 'invalidParams') {
                        const limits = segSkewConfigLimits(direction);
                        showToast(t('segSkewInvalidCount', limits ? limits.maxBands : segmentCount), 'info');
                    } else if (analysis.reason === 'scatter') showToast(t('segSkewScatter'), 'info');
                    else if (analysis.reason === 'tooSmall') showToast(t('segSkewTooSmall'), 'error');
                    else showToast(t('segSkewInsufficient'), 'error');
                }
                return;
            }

            if (!(await segSkewApplyDraftBands(analysis, runId))) return;

            st.edit.segSkewResult = analysis;
            st.edit.segSkewBusy = false;
            setSegSkewBusyUI(false);
            setSegSkewConfigUI(true);
            buildSegSkewTuneUI(analysis);
            renderSegSkewCompare({ resetView: true });
            updateEditButtons();
            el.status.textContent = segSkewStatusText(analysis);
        } catch (err) {
            console.error(err);
            if (runId === st.edit.segSkewRunId) showToast(String(err.message || err), 'error');
        } finally {
            if (runId === st.edit.segSkewRunId && st.edit.segSkewBusy) {
                st.edit.segSkewBusy = false;
                setSegSkewBusyUI(false);
                if (st.edit.segSkewResult) {
                    setSegSkewConfigUI(true);
                    buildSegSkewTuneUI(st.edit.segSkewResult);
                    syncSegSkewConfigUI();
                    el.status.textContent = segSkewStatusText(st.edit.segSkewResult);
                } else {
                    setSegSkewTuneUI(true);
                    el.status.textContent = t('segSkewIdle');
                }
                updateEditButtons();
            }
        }
    }

    function onSegSkewCountKeydown(e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (e.target && typeof e.target.blur === 'function') e.target.blur();
        onSegSkewConfigChange();
    }

    function enterSegSkewUI(active) {
        if (el.viewer) el.viewer.classList.toggle('seg-skew-active', active);
        if (el.segSkewPanel) el.segSkewPanel.setAttribute('aria-hidden', active ? 'false' : 'true');
        if (el.segSkew) el.segSkew.classList.toggle('tool-active', active);
        if (active && !st.edit.segSkewBusy && st.edit.segSkewResult) {
            requestAnimationFrame(() => renderSegSkewCompare({ resetView: true }));
        }
    }

    function exitSegSkewMode() {
        st.edit.segSkew = false;
        st.edit.segSkewBusy = false;
        st.edit.segSkewTuneBusy = false;
        st.edit.segSkewRunId++;
        st.edit.segSkewBase = null;
        st.edit.segSkewResult = null;
        st.edit.segSkewTuneRunId++;
        st.edit.segSkewShowBounds = false;
        segSkewResetViews();
        setSegSkewTuneBusyUI(false);
        setSegSkewTuneUI(false);
        setSegSkewConfigUI(false);
        setSegSkewBusyUI(false);
        enterSegSkewUI(false);
        updateEditButtons();
    }

    function cancelSegSkew() {
        if (!st.edit.segSkew) return;
        st.edit.segSkewRunId++;
        const base = st.edit.segSkewBase;
        if (base && st.dataset && !st.edit.segSkewBusy) {
            st.dataset.data = base.data.slice();
            st.dataset.vmin = base.vmin;
            st.dataset.vmax = base.vmax;
            resetColorClip(false);
            render(st.dataset, el.colormap.value, false);
        }
        exitSegSkewMode();
    }

    async function startSegSkewMode() {
        if (!editing || !st.dataset) { showToast(t('editNoData'), 'info'); return; }
        if (isScatter(st.dataset)) { showToast(t('segSkewScatter'), 'info'); return; }
        if (st.edit.segSkew) {
            if (st.edit.segSkewBusy) {
                st.edit.segSkewRunId++;
                exitSegSkewMode();
            } else {
                cancelSegSkew();
            }
            return;
        }

        endTransientModes();

        snapshotSegSkewBase();
        segSkewResetViews();
        st.edit.segSkew = true;
        st.edit.segSkewShowBounds = false;
        st.edit.segSkewBusy = false;
        st.edit.segSkewResult = null;
        st.edit.segSkewRunId++;

        enterSegSkewUI(true);
        syncSegSkewBoundsToggle();
        setSegSkewBusyUI(false);
        resetSegSkewManualConfig();
        showSegSkewTuneDefaults();
        if (st.edit.segSkewBase && st.dataset) {
            const { data, vmin, vmax } = st.edit.segSkewBase;
            const dr = segLevelDisplayRange(vmin, vmax, st.colorClip);
            renderSegSkewCanvas(
                el.segSkewBefore, data, st.dataset.width, st.dataset.height,
                dr.cmin, dr.crange, el.colormap.value, 'horizontal', [], 'beforeImg', true,
            );
            renderSegLevelPaneColorbar(
                el.segSkewBeforeCb, el.segSkewBeforeCbLo, el.segSkewBeforeCbHi,
                vmin, vmax, el.colormap.value, st.colorClip,
            );
            if (el.segSkewAfter) {
                const c = el.segSkewAfter;
                const ctx = c.getContext('2d');
                if (ctx) ctx.clearRect(0, 0, c.width, c.height);
            }
        }
        updateEditButtons();
        el.status.textContent = t('segSkewIdle');
    }

    function applySegSkew() {
        if (!st.edit.segSkew || st.edit.segSkewBusy || !st.edit.segSkewResult || !st.dataset) return;
        const result = st.edit.segSkewResult;
        ensureFloatPixels(st.dataset);
        st.dataset.data = result.correctedData.slice();
        exitSegSkewMode();
        refreshAfterEdit(false);
        pushHistory();
        setLastEditStep({
            type: 'segmentSkew',
            direction: result.direction,
            boundaries: result.boundaries.slice(),
            shiftPx: result.shiftPx,
            segmentCount: result.segmentCount,
            bandShifts: result.bandShifts ? result.bandShifts.slice() : [],
        });
        const msg = t('segSkewDone', result.segmentCount, segSkewDirLabel(result.direction), result.shiftPx);
        el.status.textContent = msg;
        showToast(msg, 'info');
    }

    /* ---- 中值濾波模式 ---- */

    function medianFilterStatusText(result) {
        if (!result) return '';
        return t('medianFilterMeta', result.kernelSize);
    }

    function snapshotMedianFilterBase() {
        const ds = st.dataset;
        ensureFloatPixels(ds);
        st.edit.medianFilterBase = {
            data: ds.data.slice(0),
            vmin: ds.vmin,
            vmax: ds.vmax,
            width: ds.width,
            height: ds.height,
            header: ds.header,
        };
    }

    function medianFilterEnsureViews() {
        if (!st.edit.medianFilterViews) {
            st.edit.medianFilterViews = {
                beforeImg: segLevelDefaultView(),
                afterImg: segLevelDefaultView(),
            };
        }
        return st.edit.medianFilterViews;
    }

    function medianFilterResetViews() {
        st.edit.medianFilterViews = null;
        st.edit.medianFilterPan = null;
    }

    function medianFilterSyncViewTransform(zoomKey, canvas, resetView) {
        if (!zoomKey || !canvas) return;
        const wrap = canvas.parentElement;
        if (!wrap) return;
        const views = medianFilterEnsureViews();
        const view = views[zoomKey];
        const { cw, ch } = segLevelContentSize(canvas);
        const sizeChanged = view.contentW !== cw || view.contentH !== ch;
        if (resetView || sizeChanged) segLevelFitView(view, wrap, cw, ch);
        segLevelApplyViewTransform(canvas, view, wrap);
    }

    function medianFilterZoomAt(zoomKey, wrap, canvas, screenX, screenY, zoomFactor) {
        const views = medianFilterEnsureViews();
        const view = views[zoomKey];
        let newScale = view.scale * zoomFactor;
        if (newScale < view.minScale) newScale = view.minScale;
        if (newScale > view.maxScale) newScale = view.maxScale;
        const k = newScale / view.scale;
        view.tx = screenX - (screenX - view.tx) * k;
        view.ty = screenY - (screenY - view.ty) * k;
        view.scale = newScale;
        segLevelApplyViewTransform(canvas, view, wrap);
    }

    function setupMedianFilterZoom() {
        const targets = [
            { wrap: el.medianFilterBefore?.parentElement, canvas: el.medianFilterBefore, key: 'beforeImg' },
            { wrap: el.medianFilterAfter?.parentElement, canvas: el.medianFilterAfter, key: 'afterImg' },
        ];
        for (const tgt of targets) {
            if (!tgt.wrap || !tgt.canvas || tgt.wrap.dataset.medianFilterZoomBound) continue;
            tgt.wrap.dataset.medianFilterZoomBound = '1';
            tgt.wrap.classList.add('seg-level-zoomable');
            if (!tgt.wrap.querySelector('.seg-level-zoom-ind')) {
                const ind = document.createElement('div');
                ind.className = 'seg-level-zoom-ind';
                ind.setAttribute('aria-hidden', 'true');
                tgt.wrap.appendChild(ind);
            }
            tgt.wrap.addEventListener('wheel', (e) => {
                if (!st.edit.medianFilter || st.edit.medianFilterBusy) return;
                e.preventDefault();
                e.stopPropagation();
                const rect = tgt.wrap.getBoundingClientRect();
                medianFilterZoomAt(tgt.key, tgt.wrap, tgt.canvas, e.clientX - rect.left, e.clientY - rect.top,
                    Math.pow(1.0015, -(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * tgt.wrap.clientHeight : e.deltaY)));
            }, { passive: false });
            tgt.wrap.addEventListener('mousedown', (e) => {
                if (!st.edit.medianFilter || st.edit.medianFilterBusy || e.button !== 0) return;
                const views = medianFilterEnsureViews();
                const view = views[tgt.key];
                st.edit.medianFilterPan = {
                    key: tgt.key,
                    wrap: tgt.wrap,
                    canvas: tgt.canvas,
                    startX: e.clientX,
                    startY: e.clientY,
                    tx: view.tx,
                    ty: view.ty,
                };
                tgt.wrap.classList.add('grabbing');
                e.preventDefault();
            });
            tgt.wrap.addEventListener('dblclick', (e) => {
                if (!st.edit.medianFilter || st.edit.medianFilterBusy) return;
                e.preventDefault();
                const views = medianFilterEnsureViews();
                const view = views[tgt.key];
                segLevelFitView(view, tgt.wrap, view.contentW, view.contentH);
                segLevelApplyViewTransform(tgt.canvas, view, tgt.wrap);
            });
        }
        if (!st.edit.medianFilterPanBound) {
            st.edit.medianFilterPanBound = true;
            window.addEventListener('mousemove', (e) => {
                const pan = st.edit.medianFilterPan;
                if (!pan) return;
                const views = medianFilterEnsureViews();
                const view = views[pan.key];
                view.tx = pan.tx + (e.clientX - pan.startX);
                view.ty = pan.ty + (e.clientY - pan.startY);
                segLevelApplyViewTransform(pan.canvas, view, pan.wrap);
            });
            window.addEventListener('mouseup', () => {
                const pan = st.edit.medianFilterPan;
                if (!pan) return;
                pan.wrap.classList.remove('grabbing');
                st.edit.medianFilterPan = null;
            });
        }
    }

    function renderMedianFilterCanvas(canvas, data, width, height, cmin, crange, cmap, zoomKey, resetView) {
        if (!canvas) return;
        const cw = Math.max(1, width);
        const ch = Math.max(1, height);
        canvas.width = cw;
        canvas.height = ch;
        canvas.style.width = cw + 'px';
        canvas.style.height = ch + 'px';
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(cw, ch);
        const px = img.data;
        const lut = buildColormapLut(cmap);
        for (let y = 0; y < ch; y++) {
            const rowBase = y * width;
            for (let x = 0; x < cw; x++) {
                const v = data[rowBase + x];
                const po = (y * cw + x) * 4;
                if (!Number.isFinite(v)) {
                    paintMissingPixel(px, po);
                    continue;
                }
                let t = (v - cmin) / crange;
                if (t < 0) t = 0; else if (t > 1) t = 1;
                const lo = ((t * 255) | 0) * 3;
                px[po] = lut[lo]; px[po + 1] = lut[lo + 1]; px[po + 2] = lut[lo + 2]; px[po + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        medianFilterSyncViewTransform(zoomKey, canvas, resetView);
    }

    function readMedianFilterKernelFromUI() {
        const raw = parseInt(el.medianFilterKernel?.value, 10);
        if (typeof normalizeMedianKernelSize === 'function') return normalizeMedianKernelSize(raw);
        let k = raw || 3;
        if (k % 2 === 0) k++;
        return k;
    }

    function syncMedianFilterKernelUI(kernelSize) {
        if (!el.medianFilterKernel) return;
        el.medianFilterKernel.value = String(kernelSize);
    }

    function setMedianFilterConfigUI(visible) {
        if (el.medianFilterConfig) el.medianFilterConfig.setAttribute('aria-hidden', visible ? 'false' : 'true');
    }

    function setMedianFilterBusyUI(busy, progress) {
        st.edit.medianFilterBusy = !!busy;
        if (el.medianFilterCompare) el.medianFilterCompare.classList.toggle('is-tune-busy', !!busy);
        if (el.medianFilterBusy) {
            el.medianFilterBusy.classList.toggle('show', !!busy);
            el.medianFilterBusy.setAttribute('aria-hidden', busy ? 'false' : 'true');
        }
        if (el.medianFilterBusyText && busy) {
            const pct = Math.round((progress || 0) * 100);
            el.medianFilterBusyText.textContent = pct > 0 && pct < 100
                ? t('medianFilterProgress', pct)
                : t('medianFilterUpdating');
        }
        updateEditButtons();
    }

    function renderMedianFilterCompare(opts) {
        const resetView = !!(opts && opts.resetView);
        const base = st.edit.medianFilterBase;
        const result = st.edit.medianFilterResult;
        if (!base || !result || !st.dataset) return;
        const ds = st.dataset;
        const cmap = el.colormap.value;
        const { width, height } = ds;
        const afterData = result.filteredData;
        const afterStats = computeRange(afterData);
        const beforeDr = segLevelDisplayRange(base.vmin, base.vmax, st.colorClip);
        const afterDr = segLevelDisplayRange(afterStats.vmin, afterStats.vmax, st.colorClip);
        renderMedianFilterCanvas(
            el.medianFilterBefore, base.data, width, height,
            beforeDr.cmin, beforeDr.crange, cmap, 'beforeImg', resetView,
        );
        renderMedianFilterCanvas(
            el.medianFilterAfter, afterData, width, height,
            afterDr.cmin, afterDr.crange, cmap, 'afterImg', resetView,
        );
        renderSegLevelPaneColorbar(
            el.medianFilterBeforeCb, el.medianFilterBeforeCbLo, el.medianFilterBeforeCbHi,
            base.vmin, base.vmax, cmap, st.colorClip,
        );
        renderSegLevelPaneColorbar(
            el.medianFilterAfterCb, el.medianFilterAfterCbLo, el.medianFilterAfterCbHi,
            afterStats.vmin, afterStats.vmax, cmap, st.colorClip,
        );
        syncMedianFilterKernelUI(result.kernelSize);
    }

    function renderMedianFilterBeforeOnly() {
        const base = st.edit.medianFilterBase;
        if (!base || !st.dataset) return;
        const cmap = el.colormap.value;
        const { width, height } = st.dataset;
        const dr = segLevelDisplayRange(base.vmin, base.vmax, st.colorClip);
        renderMedianFilterCanvas(
            el.medianFilterBefore, base.data, width, height,
            dr.cmin, dr.crange, cmap, 'beforeImg', true,
        );
        renderSegLevelPaneColorbar(
            el.medianFilterBeforeCb, el.medianFilterBeforeCbLo, el.medianFilterBeforeCbHi,
            base.vmin, base.vmax, cmap, st.colorClip,
        );
        if (el.medianFilterAfter) {
            const c = el.medianFilterAfter;
            const ctx = c.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, c.width, c.height);
        }
    }

    async function recomputeMedianFilterPreview(options) {
        options = options || {};
        const base = st.edit.medianFilterBase;
        if (!st.edit.medianFilter || !base || !st.dataset) return;

        const kernelSize = readMedianFilterKernelFromUI();
        const prev = st.edit.medianFilterResult;
        if (prev && prev.kernelSize === kernelSize && !options.force) {
            renderMedianFilterCompare({ resetView: !!options.resetView });
            return;
        }

        const runId = ++st.edit.medianFilterRunId;
        const outBuf = prev?.filteredData instanceof Float32Array ? prev.filteredData : null;
        setMedianFilterBusyUI(true, 0);
        await segLevelYield();
        if (runId !== st.edit.medianFilterRunId) {
            setMedianFilterBusyUI(false);
            return;
        }

        try {
            let filtered;
            if (typeof applyMedianFilterAsync === 'function') {
                const { width, height } = st.dataset;
                const totalRows = height;
                let lastPct = 0;
                filtered = await applyMedianFilterAsync(
                    base.data, width, height, kernelSize, outBuf, 64,
                    () => runId !== st.edit.medianFilterRunId,
                );
                if (!filtered || runId !== st.edit.medianFilterRunId) return;
                if (totalRows > 0) lastPct = 1;
                setMedianFilterBusyUI(true, lastPct);
            } else if (typeof applyMedianFilter === 'function') {
                const { width, height } = st.dataset;
                filtered = applyMedianFilter(base.data, width, height, kernelSize, outBuf);
            } else {
                return;
            }

            if (runId !== st.edit.medianFilterRunId) return;
            st.edit.medianFilterResult = { kernelSize, filteredData: filtered };
            renderMedianFilterCompare({ resetView: !!options.resetView });
            el.status.textContent = medianFilterStatusText(st.edit.medianFilterResult);
        } finally {
            if (runId === st.edit.medianFilterRunId) setMedianFilterBusyUI(false);
        }
    }

    function enterMedianFilterUI(active) {
        if (el.viewer) el.viewer.classList.toggle('median-filter-active', active);
        if (el.medianFilterPanel) el.medianFilterPanel.setAttribute('aria-hidden', active ? 'false' : 'true');
        if (el.medianFilter) el.medianFilter.classList.toggle('tool-active', active);
        if (active && !st.edit.medianFilterBusy && st.edit.medianFilterResult) {
            requestAnimationFrame(() => renderMedianFilterCompare({ resetView: true }));
        }
    }

    function exitMedianFilterMode() {
        st.edit.medianFilter = false;
        st.edit.medianFilterBusy = false;
        st.edit.medianFilterRunId++;
        st.edit.medianFilterBase = null;
        st.edit.medianFilterResult = null;
        medianFilterResetViews();
        setMedianFilterBusyUI(false);
        setMedianFilterConfigUI(false);
        enterMedianFilterUI(false);
        updateEditButtons();
    }

    function cancelMedianFilter() {
        if (!st.edit.medianFilter) return;
        st.edit.medianFilterRunId++;
        const base = st.edit.medianFilterBase;
        if (base && st.dataset && !st.edit.medianFilterBusy) {
            st.dataset.data = base.data.slice();
            st.dataset.vmin = base.vmin;
            st.dataset.vmax = base.vmax;
            resetColorClip(false);
            render(st.dataset, el.colormap.value, false);
        }
        exitMedianFilterMode();
    }

    async function startMedianFilterMode() {
        if (!editing || !st.dataset) { showToast(t('editNoData'), 'info'); return; }
        if (isScatter(st.dataset)) { showToast(t('medianFilterScatter'), 'info'); return; }
        if (st.edit.medianFilter) {
            if (st.edit.medianFilterBusy) {
                st.edit.medianFilterRunId++;
                exitMedianFilterMode();
            } else {
                cancelMedianFilter();
            }
            return;
        }

        endTransientModes();

        snapshotMedianFilterBase();
        medianFilterResetViews();
        st.edit.medianFilter = true;
        st.edit.medianFilterResult = null;
        if (el.medianFilterKernel) el.medianFilterKernel.value = '3';

        enterMedianFilterUI(true);
        setMedianFilterConfigUI(true);
        renderMedianFilterBeforeOnly();
        updateEditButtons();
        el.status.textContent = t('medianFilterProcessing');

        await recomputeMedianFilterPreview({ resetView: true, force: true });
    }

    function onMedianFilterKernelChange() {
        if (!st.edit.medianFilter || st.edit.medianFilterBusy) return;
        recomputeMedianFilterPreview({ resetView: false, force: true });
    }

    function applyMedianFilterEdit() {
        if (!st.edit.medianFilter || st.edit.medianFilterBusy || !st.edit.medianFilterResult || !st.dataset) return;
        const result = st.edit.medianFilterResult;
        ensureFloatPixels(st.dataset);
        st.dataset.data = result.filteredData.slice();
        exitMedianFilterMode();
        refreshAfterEdit(false);
        pushHistory();
        setLastEditStep({ type: 'medianFilter', kernelSize: result.kernelSize });
        const msg = t('medianFilterDone', result.kernelSize);
        el.status.textContent = msg;
        showToast(msg, 'info');
    }

    /* ---- 散布點雲網格化 ---- */
    function scatterGridAggLabel(agg) {
        if (agg === 'median') return t('scatterGridAggMedian');
        if (agg === 'max') return t('scatterGridAggMax');
        return t('scatterGridAggMean');
    }

    function scatterGridStatusText(result) {
        if (!result) return '';
        const fillPct = result.width * result.height > 0
            ? ((result.filledCount / (result.width * result.height)) * 100).toFixed(1)
            : '0';
        return t('scatterGridMeta', result.width, result.height, fillPct);
    }

    function snapshotScatterGridBase() {
        const ds = st.dataset;
        st.edit.scatterGridBase = {
            x: ds.x.slice(0),
            y: ds.y.slice(0),
            z: ds.z.slice(0),
            bounds: ds.bounds ? { ...ds.bounds } : null,
            vmin: ds.vmin,
            vmax: ds.vmax,
            pointCount: ds.pointCount,
        };
    }

    function scatterGridEnsureViews() {
        if (!st.edit.scatterGridViews) {
            st.edit.scatterGridViews = {
                beforeImg: segLevelDefaultView(),
                afterImg: segLevelDefaultView(),
            };
        }
        return st.edit.scatterGridViews;
    }

    function scatterGridResetViews() {
        st.edit.scatterGridViews = null;
        st.edit.scatterGridPan = null;
    }

    function scatterGridSyncViewTransform(zoomKey, canvas, resetView) {
        if (!zoomKey || !canvas) return;
        const wrap = canvas.parentElement;
        if (!wrap) return;
        const views = scatterGridEnsureViews();
        const view = views[zoomKey];
        const { cw, ch } = segLevelContentSize(canvas);
        const sizeChanged = view.contentW !== cw || view.contentH !== ch;
        if (resetView || sizeChanged) segLevelFitView(view, wrap, cw, ch);
        segLevelApplyViewTransform(canvas, view, wrap);
    }

    function scatterGridZoomAt(zoomKey, wrap, canvas, screenX, screenY, zoomFactor) {
        const views = scatterGridEnsureViews();
        const view = views[zoomKey];
        let newScale = view.scale * zoomFactor;
        if (newScale < view.minScale) newScale = view.minScale;
        if (newScale > view.maxScale) newScale = view.maxScale;
        const k = newScale / view.scale;
        view.tx = screenX - (screenX - view.tx) * k;
        view.ty = screenY - (screenY - view.ty) * k;
        view.scale = newScale;
        segLevelApplyViewTransform(canvas, view, wrap);
    }

    function setupScatterGridZoom() {
        const targets = [
            { wrap: el.scatterGridBefore?.parentElement, canvas: el.scatterGridBefore, key: 'beforeImg' },
            { wrap: el.scatterGridAfter?.parentElement, canvas: el.scatterGridAfter, key: 'afterImg' },
        ];
        for (const tgt of targets) {
            if (!tgt.wrap || !tgt.canvas || tgt.wrap.dataset.scatterGridZoomBound) continue;
            tgt.wrap.dataset.scatterGridZoomBound = '1';
            tgt.wrap.classList.add('seg-level-zoomable');
            if (!tgt.wrap.querySelector('.seg-level-zoom-ind')) {
                const ind = document.createElement('div');
                ind.className = 'seg-level-zoom-ind';
                ind.setAttribute('aria-hidden', 'true');
                tgt.wrap.appendChild(ind);
            }
            tgt.wrap.addEventListener('wheel', (e) => {
                if (!st.edit.scatterGrid || st.edit.scatterGridBusy) return;
                e.preventDefault();
                e.stopPropagation();
                const rect = tgt.wrap.getBoundingClientRect();
                scatterGridZoomAt(tgt.key, tgt.wrap, tgt.canvas, e.clientX - rect.left, e.clientY - rect.top,
                    e.deltaY < 0 ? 1.15 : 1 / 1.15);
            }, { passive: false });
            tgt.wrap.addEventListener('mousedown', (e) => {
                if (!st.edit.scatterGrid || st.edit.scatterGridBusy || e.button !== 0) return;
                const views = scatterGridEnsureViews();
                const view = views[tgt.key];
                if (!view) return;
                e.preventDefault();
                st.edit.scatterGridPan = {
                    key: tgt.key, wrap: tgt.wrap, canvas: tgt.canvas,
                    startX: e.clientX, startY: e.clientY,
                    tx: view.tx, ty: view.ty,
                };
                tgt.wrap.classList.add('grabbing');
            });
            tgt.wrap.addEventListener('dblclick', (e) => {
                if (!st.edit.scatterGrid || st.edit.scatterGridBusy) return;
                e.preventDefault();
                const views = scatterGridEnsureViews();
                const view = views[tgt.key];
                const { cw, ch } = segLevelContentSize(tgt.canvas);
                segLevelFitView(view, tgt.wrap, cw, ch);
                segLevelApplyViewTransform(tgt.canvas, view, tgt.wrap);
            });
        }
        if (!st.edit.scatterGridPanBound) {
            st.edit.scatterGridPanBound = true;
            window.addEventListener('mousemove', (e) => {
                const pan = st.edit.scatterGridPan;
                if (!pan) return;
                const views = scatterGridEnsureViews();
                const view = views[pan.key];
                view.tx = pan.tx + (e.clientX - pan.startX);
                view.ty = pan.ty + (e.clientY - pan.startY);
                segLevelApplyViewTransform(pan.canvas, view, pan.wrap);
            });
            window.addEventListener('mouseup', () => {
                const pan = st.edit.scatterGridPan;
                if (!pan) return;
                pan.wrap.classList.remove('grabbing');
                st.edit.scatterGridPan = null;
            });
        }
    }

    function renderScatterGridRasterCanvas(canvas, data, width, height, cmin, crange, cmap, zoomKey, resetView) {
        if (!canvas) return;
        const cw = Math.max(1, width);
        const ch = Math.max(1, height);
        canvas.width = cw;
        canvas.height = ch;
        canvas.style.width = cw + 'px';
        canvas.style.height = ch + 'px';
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(cw, ch);
        const px = img.data;
        const lut = buildColormapLut(cmap);
        for (let y = 0; y < ch; y++) {
            const rowBase = y * width;
            for (let x = 0; x < cw; x++) {
                const v = data[rowBase + x];
                const po = (y * cw + x) * 4;
                if (!Number.isFinite(v)) {
                    paintMissingPixel(px, po);
                    continue;
                }
                let tt = (v - cmin) / crange;
                if (tt < 0) tt = 0; else if (tt > 1) tt = 1;
                const lo = ((tt * 255) | 0) * 3;
                px[po] = lut[lo]; px[po + 1] = lut[lo + 1]; px[po + 2] = lut[lo + 2]; px[po + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        scatterGridSyncViewTransform(zoomKey, canvas, resetView);
    }

    function renderScatterGridBeforeCanvas(canvas, base, cmin, crange, cmap, zoomKey, resetView) {
        if (!canvas || !base) return;
        const b = base.bounds;
        const spanX = (b.xmax - b.xmin) || 1;
        const spanY = (b.ymax - b.ymin) || 1;
        const maxSide = 1024;
        let cw, ch;
        if (spanX >= spanY) {
            cw = maxSide;
            ch = Math.max(64, Math.round(maxSide * spanY / spanX));
        } else {
            ch = maxSide;
            cw = Math.max(64, Math.round(maxSide * spanX / spanY));
        }
        canvas.width = cw;
        canvas.height = ch;
        canvas.style.width = cw + 'px';
        canvas.style.height = ch + 'px';
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(cw, ch);
        const px = img.data;
        for (let i = 0; i < px.length; i += 4) {
            px[i] = px[i + 1] = px[i + 2] = 0;
            px[i + 3] = 255;
        }
        const lut = buildColormapLut(cmap);
        const { x, y, z } = base;
        const n = z.length;
        const R = Math.max(0.75, Math.min(3, Math.min(cw, ch) / 400));
        for (let i = 0; i < n; i++) {
            const sx = ((x[i] - b.xmin) / spanX) * (cw - 1);
            const sy = ((b.ymax - y[i]) / spanY) * (ch - 1);
            let tt = (z[i] - cmin) / crange;
            if (tt < 0) tt = 0; else if (tt > 1) tt = 1;
            const lo = ((tt * 255) | 0) * 3;
            const cr = lut[lo], cg = lut[lo + 1], cb = lut[lo + 2];
            if (typeof stampDisk === 'function') stampDisk(px, cw, ch, sx, sy, R, cr, cg, cb);
            else if (typeof stampPixel === 'function') stampPixel(px, cw, ch, Math.round(sx), Math.round(sy), cr, cg, cb);
            else {
                const ix = Math.round(sx), iy = Math.round(sy);
                if (ix < 0 || iy < 0 || ix >= cw || iy >= ch) continue;
                const po = (iy * cw + ix) * 4;
                px[po] = cr; px[po + 1] = cg; px[po + 2] = cb; px[po + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        scatterGridSyncViewTransform(zoomKey, canvas, resetView);
    }

    function readScatterGridOptionsFromUI() {
        const modeRaw = el.scatterGridMode?.value || 'auto';
        const mode = (modeRaw === 'spacing' || modeRaw === 'size') ? modeRaw : 'auto';
        const aggregate = typeof normalizeScatterGridAggregate === 'function'
            ? normalizeScatterGridAggregate(el.scatterGridAgg?.value)
            : (el.scatterGridAgg?.value || 'mean');
        const opts = { mode, aggregate };
        if (mode === 'spacing') {
            const dx = parseFloat(el.scatterGridDx?.value);
            if (!(dx > 0) || !Number.isFinite(dx)) return { ok: false, reason: 'spacing' };
            opts.dx = dx;
            opts.dy = dx;
        } else if (mode === 'size') {
            const width = parseInt(el.scatterGridWidth?.value, 10);
            const height = parseInt(el.scatterGridHeight?.value, 10);
            if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) {
                return { ok: false, reason: 'size' };
            }
            opts.width = width;
            opts.height = height;
        }
        return { ok: true, options: opts };
    }

    function syncScatterGridModeFields() {
        const mode = el.scatterGridMode?.value || 'auto';
        if (el.scatterGridSpacingWrap) el.scatterGridSpacingWrap.hidden = mode !== 'spacing';
        if (el.scatterGridSizeWrap) el.scatterGridSizeWrap.hidden = mode !== 'size';
    }

    function seedScatterGridInputsFromBase() {
        const base = st.edit.scatterGridBase;
        if (!base) return;
        let spacing = 1;
        if (typeof estimateScatterPointSpacing === 'function') {
            spacing = estimateScatterPointSpacing(base.x, base.y, base.z.length);
        }
        if (!(spacing > 0) || !Number.isFinite(spacing)) spacing = 1;
        if (el.scatterGridDx && !el.scatterGridDx.value) {
            const nice = spacing >= 1 ? spacing.toFixed(3) : spacing.toPrecision(4);
            el.scatterGridDx.value = nice;
        }
        // 寬高預填留給首次預覽結果同步，避免「自動」實際為索引網格（如 584）
        // 卻顯示均勻分箱估計（如 967）造成誤解
    }

    function syncScatterGridSizeInputsFromResult(result) {
        if (!result) return;
        if (el.scatterGridWidth) el.scatterGridWidth.value = String(result.width);
        if (el.scatterGridHeight) el.scatterGridHeight.value = String(result.height);
        if (result.dx > 0 && el.scatterGridDx && (el.scatterGridMode?.value === 'auto' || !el.scatterGridDx.value)) {
            const nice = result.dx >= 1 ? result.dx.toFixed(3) : result.dx.toPrecision(4);
            // 僅在自動模式時用結果回寫格距提示，不覆蓋使用者在格距模式的輸入
            if (el.scatterGridMode?.value === 'auto') el.scatterGridDx.value = nice;
        }
    }

    function setScatterGridConfigUI(visible) {
        if (el.scatterGridConfig) el.scatterGridConfig.setAttribute('aria-hidden', visible ? 'false' : 'true');
    }

    function setScatterGridBusyUI(busy, progress) {
        st.edit.scatterGridBusy = !!busy;
        if (el.scatterGridCompare) el.scatterGridCompare.classList.toggle('is-tune-busy', !!busy);
        if (el.scatterGridBusy) {
            el.scatterGridBusy.classList.toggle('show', !!busy);
            el.scatterGridBusy.setAttribute('aria-hidden', busy ? 'false' : 'true');
        }
        if (el.scatterGridBusyText && busy) {
            const pct = Math.round((progress || 0) * 100);
            el.scatterGridBusyText.textContent = pct > 0 && pct < 100
                ? t('scatterGridProgress', pct)
                : t('scatterGridUpdating');
        }
        updateEditButtons();
    }

    function updateScatterGridMeta(result) {
        if (!el.scatterGridMeta) return;
        el.scatterGridMeta.textContent = result ? scatterGridStatusText(result) : '';
    }

    function renderScatterGridCompare(opts) {
        const resetView = !!(opts && opts.resetView);
        const base = st.edit.scatterGridBase;
        const result = st.edit.scatterGridResult;
        if (!base || !result) return;
        const cmap = el.colormap.value;
        const beforeDr = segLevelDisplayRange(base.vmin, base.vmax, st.colorClip);
        const afterStats = computeRange(result.data);
        const afterDr = segLevelDisplayRange(afterStats.vmin, afterStats.vmax, st.colorClip);
        renderScatterGridBeforeCanvas(
            el.scatterGridBefore, base, beforeDr.cmin, beforeDr.crange, cmap, 'beforeImg', resetView,
        );
        renderScatterGridRasterCanvas(
            el.scatterGridAfter, result.data, result.width, result.height,
            afterDr.cmin, afterDr.crange, cmap, 'afterImg', resetView,
        );
        renderSegLevelPaneColorbar(
            el.scatterGridBeforeCb, el.scatterGridBeforeCbLo, el.scatterGridBeforeCbHi,
            base.vmin, base.vmax, cmap, st.colorClip,
        );
        renderSegLevelPaneColorbar(
            el.scatterGridAfterCb, el.scatterGridAfterCbLo, el.scatterGridAfterCbHi,
            afterStats.vmin, afterStats.vmax, cmap, st.colorClip,
        );
        updateScatterGridMeta(result);
        syncScatterGridSizeInputsFromResult(result);
    }

    function renderScatterGridBeforeOnly() {
        const base = st.edit.scatterGridBase;
        if (!base) return;
        const cmap = el.colormap.value;
        const dr = segLevelDisplayRange(base.vmin, base.vmax, st.colorClip);
        renderScatterGridBeforeCanvas(
            el.scatterGridBefore, base, dr.cmin, dr.crange, cmap, 'beforeImg', true,
        );
        renderSegLevelPaneColorbar(
            el.scatterGridBeforeCb, el.scatterGridBeforeCbLo, el.scatterGridBeforeCbHi,
            base.vmin, base.vmax, cmap, st.colorClip,
        );
        if (el.scatterGridAfter) {
            const c = el.scatterGridAfter;
            const ctx = c.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, c.width, c.height);
        }
        updateScatterGridMeta(null);
    }

    async function recomputeScatterGridPreview(options) {
        options = options || {};
        const base = st.edit.scatterGridBase;
        if (!st.edit.scatterGrid || !base) return;

        const parsed = readScatterGridOptionsFromUI();
        if (!parsed.ok) {
            if (parsed.reason === 'spacing') showToast(t('scatterGridInvalidSpacing'), 'info');
            else if (parsed.reason === 'size') showToast(t('scatterGridInvalidSize'), 'info');
            return;
        }
        const opts = parsed.options;
        const prev = st.edit.scatterGridResult;
        if (prev && !options.force
            && prev.mode === opts.mode
            && prev.aggregate === opts.aggregate
            && prev._optDx === (opts.dx || 0)
            && prev._optWidth === (opts.width || 0)
            && prev._optHeight === (opts.height || 0)) {
            renderScatterGridCompare({ resetView: !!options.resetView });
            return;
        }

        const runId = ++st.edit.scatterGridRunId;
        setScatterGridBusyUI(true, 0);
        await segLevelYield();
        if (runId !== st.edit.scatterGridRunId) {
            setScatterGridBusyUI(false);
            return;
        }

        try {
            let result = null;
            if (typeof applyScatterGridAsync === 'function') {
                result = await applyScatterGridAsync(
                    base.x, base.y, base.z, base.bounds, opts,
                    () => runId !== st.edit.scatterGridRunId,
                    (p) => {
                        if (runId === st.edit.scatterGridRunId) setScatterGridBusyUI(true, p);
                    },
                );
            } else if (typeof applyScatterGrid === 'function') {
                result = applyScatterGrid(base.x, base.y, base.z, base.bounds, opts);
            } else {
                return;
            }
            if (!result || runId !== st.edit.scatterGridRunId) return;

            const maxCells = typeof SCATTER_GRID_MAX_CELLS === 'number' ? SCATTER_GRID_MAX_CELLS : (8 * 1024 * 1024);
            if (result.width * result.height > maxCells) {
                showToast(t('scatterGridTooLarge', result.width, result.height), 'error');
                return;
            }

            result._optDx = opts.dx || 0;
            result._optWidth = opts.width || 0;
            result._optHeight = opts.height || 0;
            st.edit.scatterGridResult = result;
            renderScatterGridCompare({ resetView: !!options.resetView });
            el.status.textContent = scatterGridStatusText(result);
        } finally {
            if (runId === st.edit.scatterGridRunId) setScatterGridBusyUI(false);
        }
    }

    function enterScatterGridUI(active) {
        if (el.viewer) el.viewer.classList.toggle('scatter-grid-active', active);
        if (el.scatterGridPanel) el.scatterGridPanel.setAttribute('aria-hidden', active ? 'false' : 'true');
        if (el.scatterGrid) el.scatterGrid.classList.toggle('tool-active', active);
        if (active && !st.edit.scatterGridBusy && st.edit.scatterGridResult) {
            requestAnimationFrame(() => renderScatterGridCompare({ resetView: true }));
        }
    }

    function exitScatterGridMode() {
        st.edit.scatterGrid = false;
        st.edit.scatterGridBusy = false;
        st.edit.scatterGridRunId++;
        st.edit.scatterGridBase = null;
        st.edit.scatterGridResult = null;
        scatterGridResetViews();
        setScatterGridBusyUI(false);
        setScatterGridConfigUI(false);
        enterScatterGridUI(false);
        updateEditButtons();
    }

    function cancelScatterGrid() {
        if (!st.edit.scatterGrid) return;
        st.edit.scatterGridRunId++;
        exitScatterGridMode();
    }

    async function startScatterGridMode() {
        if (!editing || !st.dataset) { showToast(t('editNoData'), 'info'); return; }
        if (!isScatter(st.dataset)) {
            showToast(t('scatterGridNeedScatter'), 'info');
            updateEditButtons();
            return;
        }
        if (st.edit.scatterGrid) {
            if (st.edit.scatterGridBusy) {
                st.edit.scatterGridRunId++;
                exitScatterGridMode();
            } else {
                cancelScatterGrid();
            }
            return;
        }

        endTransientModes();

        snapshotScatterGridBase();
        scatterGridResetViews();
        st.edit.scatterGrid = true;
        st.edit.scatterGridResult = null;
        if (el.scatterGridMode) el.scatterGridMode.value = 'auto';
        if (el.scatterGridAgg) el.scatterGridAgg.value = 'mean';
        if (el.scatterGridDx) el.scatterGridDx.value = '';
        if (el.scatterGridWidth) el.scatterGridWidth.value = '';
        if (el.scatterGridHeight) el.scatterGridHeight.value = '';
        seedScatterGridInputsFromBase();
        syncScatterGridModeFields();

        enterScatterGridUI(true);
        setScatterGridConfigUI(true);
        renderScatterGridBeforeOnly();
        updateEditButtons();
        el.status.textContent = t('scatterGridProcessing');

        await recomputeScatterGridPreview({ resetView: true, force: true });
    }

    function onScatterGridConfigChange() {
        syncScatterGridModeFields();
        if (!st.edit.scatterGrid || st.edit.scatterGridBusy) return;
        recomputeScatterGridPreview({ resetView: false, force: true });
    }

    function applyScatterGridToDataset(ds, result) {
        ds.type = 'grid';
        ds.data = result.data.slice();
        ds.width = result.width;
        ds.height = result.height;
        ds.pointCount = result.filledCount;
        ds.vmin = undefined;
        ds.vmax = undefined;
        delete ds.x;
        delete ds.y;
        delete ds.z;
        delete ds.bounds;
        const hdr = ds.header ? { ...ds.header } : {};
        hdr.xlength = String(result.xlength);
        hdr.ylength = String(result.ylength);
        hdr['x-length'] = String(result.xlength);
        hdr['y-length'] = String(result.ylength);
        hdr.xpixels = String(result.width);
        hdr.ypixels = String(result.height);
        hdr.WIDTH = String(result.width);
        hdr.HEIGHT = String(result.height);
        // 與一般高度圖一致：提供可雙擊編輯的單位欄（既有值保留）
        const hasX = hdr.xunit || hdr['x-unit'];
        const hasY = hdr.yunit || hdr['y-unit'];
        const hasZ = hdr.zunit || hdr['z-unit'];
        if (!hasX) hdr.xunit = 'mm';
        if (!hasY) hdr.yunit = 'mm';
        if (!hasZ) hdr.zunit = 'um';
        hdr[t('infoPcdView')] = t('infoPcdGridded');
        hdr[t('infoPcdPoints')] = String(result.filledCount);
        if (typeof t === 'function') {
            hdr[t('infoPcdGridPrec')] = String(result.dx);
        }
        ds.header = hdr;
    }

    function applyScatterGridEdit() {
        if (!st.edit.scatterGrid || st.edit.scatterGridBusy || !st.edit.scatterGridResult || !st.dataset) return;
        const result = st.edit.scatterGridResult;
        applyScatterGridToDataset(st.dataset, result);
        const step = {
            type: 'scatterGrid',
            mode: result.mode,
            aggregate: result.aggregate,
            width: result.width,
            height: result.height,
            dx: result.dx,
            dy: result.dy,
        };
        if (result.mode === 'spacing') { step.dx = result._optDx || result.dx; step.dy = step.dx; }
        if (result.mode === 'size') {
            step.width = result._optWidth || result.width;
            step.height = result._optHeight || result.height;
        }
        exitScatterGridMode();
        refreshAfterEdit(true);
        pushHistory();
        setLastEditStep(step);
        syncPointSizeControls();
        updateEditButtons();
        const msg = t('scatterGridDone', result.width, result.height, scatterGridAggLabel(result.aggregate));
        el.status.textContent = msg;
        showToast(msg, 'info');
    }

    /* ---- 區域框選（裁切 / NaN 修補 ROI 共用）---- */
    function normSel(s) {
        return {
            x0: Math.min(s.x0, s.x1), y0: Math.min(s.y0, s.y1),
            x1: Math.max(s.x0, s.x1), y1: Math.max(s.y0, s.y1),
        };
    }
    const CROP_HRES = {
        nw: { x: 'x0', y: 'y0' }, n: { y: 'y0' }, ne: { x: 'x1', y: 'y0' },
        e: { x: 'x1' }, se: { x: 'x1', y: 'y1' }, s: { y: 'y1' },
        sw: { x: 'x0', y: 'y1' }, w: { x: 'x0' },
    };
    const CROP_MIN = 4;

    function drawRegionShape(shapeEl, sel) {
        if (!shapeEl) return;
        if (!sel) { shapeEl.style.display = 'none'; return; }
        const n = normSel(sel);
        shapeEl.style.display = 'block';
        shapeEl.style.left = n.x0 + 'px';
        shapeEl.style.top = n.y0 + 'px';
        shapeEl.style.width = (n.x1 - n.x0) + 'px';
        shapeEl.style.height = (n.y1 - n.y0) + 'px';
    }

    function setupRegionSelectOverlay(opts) {
        const { overlay, shape, container, isActive, getSel, setSel, getAction, setAction, onEnd } = opts;
        if (!overlay || !shape || !container || overlay.dataset.regionSelectBound) return;
        overlay.dataset.regionSelectBound = '1';
        const draw = () => drawRegionShape(shape, getSel());
        const ptInContainer = (e) => {
            const r = container.getBoundingClientRect();
            return {
                x: Math.min(r.width, Math.max(0, e.clientX - r.left)),
                y: Math.min(r.height, Math.max(0, e.clientY - r.top)),
            };
        };
        overlay.addEventListener('pointerdown', (e) => {
            if (!isActive()) return;
            if (e.button === 1) return;
            e.preventDefault();
            e.stopPropagation();
            overlay.setPointerCapture(e.pointerId);
            const p = ptInContainer(e);
            const handle = (e.target && e.target.classList && e.target.classList.contains('crop-handle'))
                ? e.target.getAttribute('data-h') : null;
            const sel = getSel();
            if (handle && sel) {
                setSel(normSel(sel));
                setAction({ type: 'resize', handle });
            } else if (sel && e.target === shape) {
                setSel(normSel(sel));
                setAction({ type: 'move', start: p, orig: { ...getSel() } });
            } else {
                setAction({ type: 'draw' });
                setSel({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
            }
            draw();
        });
        overlay.addEventListener('pointermove', (e) => {
            const act = getAction();
            if (!act || !getSel()) return;
            const p = ptInContainer(e);
            const s = getSel();
            const vw = container.clientWidth, vh = container.clientHeight;
            if (act.type === 'draw') {
                s.x1 = p.x; s.y1 = p.y;
            } else if (act.type === 'resize') {
                const dir = CROP_HRES[act.handle];
                if (dir.x === 'x0') s.x0 = Math.min(p.x, s.x1 - CROP_MIN);
                if (dir.x === 'x1') s.x1 = Math.max(p.x, s.x0 + CROP_MIN);
                if (dir.y === 'y0') s.y0 = Math.min(p.y, s.y1 - CROP_MIN);
                if (dir.y === 'y1') s.y1 = Math.max(p.y, s.y0 + CROP_MIN);
            } else if (act.type === 'move') {
                const o = act.orig, w = o.x1 - o.x0, h = o.y1 - o.y0;
                let nx0 = o.x0 + (p.x - act.start.x), ny0 = o.y0 + (p.y - act.start.y);
                if (nx0 < 0) nx0 = 0; if (nx0 + w > vw) nx0 = vw - w;
                if (ny0 < 0) ny0 = 0; if (ny0 + h > vh) ny0 = vh - h;
                s.x0 = nx0; s.y0 = ny0; s.x1 = nx0 + w; s.y1 = ny0 + h;
            }
            draw();
        });
        const endAction = (e) => {
            const act = getAction();
            if (!act) return;
            setAction(null);
            try { overlay.releasePointerCapture(e.pointerId); } catch (_) {}
            if (getSel()) {
                const s = normSel(getSel());
                if (act.type === 'draw' && (s.x1 - s.x0 < CROP_MIN || s.y1 - s.y0 < CROP_MIN)) {
                    setSel(null);
                } else {
                    setSel(s);
                }
                draw();
            }
            if (onEnd) onEnd(act);
        };
        overlay.addEventListener('pointerup', endAction);
        overlay.addEventListener('pointercancel', endAction);
    }

    /* ---- NaN 修補模式 ---- */

    function nanPatchStatusText(result) {
        if (!result) return '';
        return result.roi ? t('nanPatchMetaRoi', result.kernelSize) : t('nanPatchMeta', result.kernelSize);
    }

    function nanPatchRoiKey(roi) {
        if (!roi) return '';
        return `${roi.shape}:${roi.x0},${roi.y0},${roi.x1},${roi.y1}`;
    }

    function captureNanPatchRoi() {
        return st.edit.nanPatchRoi ? { ...st.edit.nanPatchRoi } : null;
    }

    function nanPatchRoiNormToWrapSel(roi) {
        if (!roi || !st.dataset) return null;
        const views = nanPatchEnsureViews();
        const view = views.beforeImg;
        const { width, height } = st.dataset;
        const ix0 = roi.x0 * width, ix1 = roi.x1 * width;
        const iy0 = roi.y0 * height, iy1 = roi.y1 * height;
        return {
            x0: ix0 * view.scale + view.tx,
            y0: iy0 * view.scale + view.ty,
            x1: ix1 * view.scale + view.tx,
            y1: iy1 * view.scale + view.ty,
        };
    }

    function nanPatchWrapSelToNorm(sel, shape) {
        if (!sel || !st.dataset) return null;
        const views = nanPatchEnsureViews();
        const view = views.beforeImg;
        const { width, height } = st.dataset;
        const n = normSel(sel);
        const ix0 = (n.x0 - view.tx) / view.scale;
        const iy0 = (n.y0 - view.ty) / view.scale;
        const ix1 = (n.x1 - view.tx) / view.scale;
        const iy1 = (n.y1 - view.ty) / view.scale;
        return {
            shape,
            x0: Math.max(0, Math.min(1, ix0 / width)),
            y0: Math.max(0, Math.min(1, iy0 / height)),
            x1: Math.max(0, Math.min(1, ix1 / width)),
            y1: Math.max(0, Math.min(1, iy1 / height)),
        };
    }

    function drawNanPatchRoiShape() {
        const sh = el.nanPatchCropShape;
        if (!sh) return;
        const mode = st.edit.nanPatchRoiMode;
        const circle = mode === 'circle' || st.edit.nanPatchRoi?.shape === 'circle';
        sh.classList.toggle('circle', !!circle);
        const sel = st.edit.nanPatchRoiSel || nanPatchRoiNormToWrapSel(st.edit.nanPatchRoi);
        if (!sel || !st.edit.nanPatch) {
            drawRegionShape(sh, null);
            return;
        }
        drawRegionShape(sh, sel);
    }

    function updateNanPatchRoiUI() {
        const mode = st.edit.nanPatchRoiMode;
        const hasRoi = !!st.edit.nanPatchRoi;
        const wrap = el.nanPatchBeforeWrap || el.nanPatchBefore?.parentElement;
        if (el.nanPatchRoiRect) el.nanPatchRoiRect.classList.toggle('active', mode === 'rect');
        if (el.nanPatchRoiCircle) el.nanPatchRoiCircle.classList.toggle('active', mode === 'circle');
        const roiLocked = !st.edit.nanPatch || st.edit.nanPatchBusy;
        if (el.nanPatchRoiRect) el.nanPatchRoiRect.disabled = roiLocked;
        if (el.nanPatchRoiCircle) el.nanPatchRoiCircle.disabled = roiLocked;
        if (el.nanPatchRoiClear) el.nanPatchRoiClear.disabled = roiLocked || !(hasRoi || !!st.edit.nanPatchRoiSel || !!mode);
        if (wrap) {
            wrap.classList.toggle('crop-active', !!mode);
            wrap.classList.toggle('nan-patch-roi-show', !!(mode || hasRoi || st.edit.nanPatchRoiSel));
        }
        if (el.nanPatchCropOverlay) {
            el.nanPatchCropOverlay.setAttribute('aria-hidden', (mode || hasRoi) ? 'false' : 'true');
        }
        if (el.nanPatchCropHint) {
            el.nanPatchCropHint.style.display = mode ? '' : 'none';
        }
        drawNanPatchRoiShape();
    }

    function setNanPatchRoiMode(mode) {
        if (!st.edit.nanPatch || st.edit.nanPatchBusy) return;
        if (st.edit.nanPatchRoiMode === mode) {
            st.edit.nanPatchRoiMode = null;
            st.edit.nanPatchRoiSel = null;
            st.edit.nanPatchRoiAction = null;
        } else {
            if (mode && st.edit.nanPatchRoi && st.edit.nanPatchRoi.shape !== mode) {
                st.edit.nanPatchRoi = null;
            }
            st.edit.nanPatchRoiMode = mode;
            st.edit.nanPatchRoiSel = st.edit.nanPatchRoi ? nanPatchRoiNormToWrapSel(st.edit.nanPatchRoi) : null;
            st.edit.nanPatchRoiAction = null;
            if (el.nanPatchCropShape) el.nanPatchCropShape.classList.toggle('circle', mode === 'circle');
        }
        updateNanPatchRoiUI();
    }

    function clearNanPatchRoi() {
        if (!st.edit.nanPatch || st.edit.nanPatchBusy) return;
        st.edit.nanPatchRoiMode = null;
        st.edit.nanPatchRoi = null;
        st.edit.nanPatchRoiSel = null;
        st.edit.nanPatchRoiAction = null;
        updateNanPatchRoiUI();
        recomputeNanPatchPreview({ force: true });
    }

    function startNanPatchBeforePan(e) {
        if (!st.edit.nanPatch || st.edit.nanPatchBusy || !st.edit.nanPatchRoiMode) return;
        const wrap = el.nanPatchBeforeWrap || el.nanPatchBefore?.parentElement;
        const canvas = el.nanPatchBefore;
        if (!wrap || !canvas) return;
        e.preventDefault();
        e.stopPropagation();
        const views = nanPatchEnsureViews();
        const view = views.beforeImg;
        st.edit.nanPatchPan = {
            key: 'beforeImg',
            wrap,
            canvas,
            startX: e.clientX,
            startY: e.clientY,
            tx: view.tx,
            ty: view.ty,
        };
        wrap.classList.add('grabbing');
    }

    function setupNanPatchMiddlePan() {
        const wrap = el.nanPatchBeforeWrap || el.nanPatchBefore?.parentElement;
        const overlay = el.nanPatchCropOverlay;
        const bind = (node) => {
            if (!node || node.dataset.nanPatchMidPanBound) return;
            node.dataset.nanPatchMidPanBound = '1';
            node.addEventListener('mousedown', (e) => {
                if (e.button !== 1) return;
                startNanPatchBeforePan(e);
            });
        };
        bind(wrap);
        bind(overlay);
    }

    function onNanPatchRoiSelectEnd(act) {
        const mode = st.edit.nanPatchRoiMode;
        if (!mode) return;
        if (st.edit.nanPatchRoiSel) {
            st.edit.nanPatchRoi = nanPatchWrapSelToNorm(st.edit.nanPatchRoiSel, mode);
        } else if (act.type === 'draw' && st.edit.nanPatchRoi) {
            st.edit.nanPatchRoiSel = nanPatchRoiNormToWrapSel(st.edit.nanPatchRoi);
        } else {
            st.edit.nanPatchRoi = null;
        }
        recomputeNanPatchPreview({ force: true });
        updateNanPatchRoiUI();
    }

    function setupNanPatchCropOverlay() {
        const wrap = el.nanPatchBeforeWrap || el.nanPatchBefore?.parentElement;
        setupRegionSelectOverlay({
            overlay: el.nanPatchCropOverlay,
            shape: el.nanPatchCropShape,
            container: wrap,
            isActive: () => st.edit.nanPatch && st.edit.nanPatchRoiMode && !st.edit.nanPatchBusy,
            getSel: () => st.edit.nanPatchRoiSel,
            setSel: (v) => { st.edit.nanPatchRoiSel = v; },
            getAction: () => st.edit.nanPatchRoiAction,
            setAction: (v) => { st.edit.nanPatchRoiAction = v; },
            onEnd: onNanPatchRoiSelectEnd,
        });
    }

    function snapshotNanPatchBase() {
        const ds = st.dataset;
        ensureFloatPixels(ds);
        st.edit.nanPatchBase = {
            data: ds.data.slice(0),
            vmin: ds.vmin,
            vmax: ds.vmax,
            width: ds.width,
            height: ds.height,
            header: ds.header,
        };
    }

    function nanPatchEnsureViews() {
        if (!st.edit.nanPatchViews) {
            st.edit.nanPatchViews = {
                beforeImg: segLevelDefaultView(),
                afterImg: segLevelDefaultView(),
            };
        }
        return st.edit.nanPatchViews;
    }

    function nanPatchResetViews() {
        st.edit.nanPatchViews = null;
        st.edit.nanPatchPan = null;
    }

    function nanPatchSyncViewTransform(zoomKey, canvas, resetView) {
        if (!zoomKey || !canvas) return;
        const wrap = canvas.parentElement;
        if (!wrap) return;
        const views = nanPatchEnsureViews();
        const view = views[zoomKey];
        const { cw, ch } = segLevelContentSize(canvas);
        const sizeChanged = view.contentW !== cw || view.contentH !== ch;
        if (resetView || sizeChanged) segLevelFitView(view, wrap, cw, ch);
        segLevelApplyViewTransform(canvas, view, wrap);
    }

    function nanPatchZoomAt(zoomKey, wrap, canvas, screenX, screenY, zoomFactor) {
        const views = nanPatchEnsureViews();
        const view = views[zoomKey];
        let newScale = view.scale * zoomFactor;
        if (newScale < view.minScale) newScale = view.minScale;
        if (newScale > view.maxScale) newScale = view.maxScale;
        const k = newScale / view.scale;
        view.tx = screenX - (screenX - view.tx) * k;
        view.ty = screenY - (screenY - view.ty) * k;
        view.scale = newScale;
        segLevelApplyViewTransform(canvas, view, wrap);
    }

    function setupNanPatchZoom() {
        const beforeWrap = el.nanPatchBeforeWrap || el.nanPatchBefore?.parentElement;
        const targets = [
            { wrap: beforeWrap, canvas: el.nanPatchBefore, key: 'beforeImg' },
            { wrap: el.nanPatchAfter?.parentElement, canvas: el.nanPatchAfter, key: 'afterImg' },
        ];
        for (const tgt of targets) {
            if (!tgt.wrap || !tgt.canvas || tgt.wrap.dataset.nanPatchZoomBound) continue;
            tgt.wrap.dataset.nanPatchZoomBound = '1';
            tgt.wrap.classList.add('seg-level-zoomable');
            if (!tgt.wrap.querySelector('.seg-level-zoom-ind')) {
                const ind = document.createElement('div');
                ind.className = 'seg-level-zoom-ind';
                ind.setAttribute('aria-hidden', 'true');
                tgt.wrap.appendChild(ind);
            }
            tgt.wrap.addEventListener('wheel', (e) => {
                if (!st.edit.nanPatch || st.edit.nanPatchBusy) return;
                e.preventDefault();
                e.stopPropagation();
                const rect = tgt.wrap.getBoundingClientRect();
                nanPatchZoomAt(tgt.key, tgt.wrap, tgt.canvas, e.clientX - rect.left, e.clientY - rect.top,
                    Math.pow(1.0015, -(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * tgt.wrap.clientHeight : e.deltaY)));
                if (tgt.key === 'beforeImg') drawNanPatchRoiShape();
            }, { passive: false });
            tgt.wrap.addEventListener('mousedown', (e) => {
                if (!st.edit.nanPatch || st.edit.nanPatchBusy) return;
                const isMid = e.button === 1;
                if (e.button !== 0 && !isMid) return;
                if (tgt.key === 'beforeImg' && tgt.wrap.classList.contains('crop-active')) {
                    if (!isMid) return;
                    startNanPatchBeforePan(e);
                    return;
                }
                const views = nanPatchEnsureViews();
                const view = views[tgt.key];
                st.edit.nanPatchPan = {
                    key: tgt.key,
                    wrap: tgt.wrap,
                    canvas: tgt.canvas,
                    startX: e.clientX,
                    startY: e.clientY,
                    tx: view.tx,
                    ty: view.ty,
                };
                tgt.wrap.classList.add('grabbing');
                e.preventDefault();
            });
            tgt.wrap.addEventListener('dblclick', (e) => {
                if (!st.edit.nanPatch || st.edit.nanPatchBusy) return;
                e.preventDefault();
                const views = nanPatchEnsureViews();
                const view = views[tgt.key];
                segLevelFitView(view, tgt.wrap, view.contentW, view.contentH);
                segLevelApplyViewTransform(tgt.canvas, view, tgt.wrap);
                if (tgt.key === 'beforeImg') drawNanPatchRoiShape();
            });
        }
        if (!st.edit.nanPatchPanBound) {
            st.edit.nanPatchPanBound = true;
            window.addEventListener('mousemove', (e) => {
                const pan = st.edit.nanPatchPan;
                if (!pan) return;
                const views = nanPatchEnsureViews();
                const view = views[pan.key];
                view.tx = pan.tx + (e.clientX - pan.startX);
                view.ty = pan.ty + (e.clientY - pan.startY);
                segLevelApplyViewTransform(pan.canvas, view, pan.wrap);
                if (pan.key === 'beforeImg') drawNanPatchRoiShape();
            });
            window.addEventListener('mouseup', () => {
                const pan = st.edit.nanPatchPan;
                if (!pan) return;
                pan.wrap.classList.remove('grabbing');
                st.edit.nanPatchPan = null;
            });
        }
    }

    function renderNanPatchCanvas(canvas, data, width, height, cmin, crange, cmap, zoomKey, resetView) {
        if (!canvas) return;
        const cw = Math.max(1, width);
        const ch = Math.max(1, height);
        canvas.width = cw;
        canvas.height = ch;
        canvas.style.width = cw + 'px';
        canvas.style.height = ch + 'px';
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(cw, ch);
        const px = img.data;
        const lut = buildColormapLut(cmap);
        for (let y = 0; y < ch; y++) {
            const rowBase = y * width;
            for (let x = 0; x < cw; x++) {
                const v = data[rowBase + x];
                const po = (y * cw + x) * 4;
                if (!Number.isFinite(v)) {
                    paintMissingPixel(px, po);
                    continue;
                }
                let t = (v - cmin) / crange;
                if (t < 0) t = 0; else if (t > 1) t = 1;
                const lo = ((t * 255) | 0) * 3;
                px[po] = lut[lo]; px[po + 1] = lut[lo + 1]; px[po + 2] = lut[lo + 2]; px[po + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        nanPatchSyncViewTransform(zoomKey, canvas, resetView);
        if (zoomKey === 'beforeImg') drawNanPatchRoiShape();
    }

    function readNanPatchKernelFromUI() {
        const raw = parseInt(el.nanPatchKernel?.value, 10);
        if (typeof normalizeNanPatchKernelSize === 'function') return normalizeNanPatchKernelSize(raw);
        let k = raw || 3;
        if (k % 2 === 0) k++;
        return k;
    }

    function syncNanPatchKernelUI(kernelSize) {
        if (!el.nanPatchKernel) return;
        el.nanPatchKernel.value = String(kernelSize);
    }

    function setNanPatchConfigUI(visible) {
        if (el.nanPatchConfig) el.nanPatchConfig.setAttribute('aria-hidden', visible ? 'false' : 'true');
    }

    function setNanPatchBusyUI(busy, progress) {
        st.edit.nanPatchBusy = !!busy;
        if (el.nanPatchCompare) el.nanPatchCompare.classList.toggle('is-tune-busy', !!busy);
        if (el.nanPatchBusy) {
            el.nanPatchBusy.classList.toggle('show', !!busy);
            el.nanPatchBusy.setAttribute('aria-hidden', busy ? 'false' : 'true');
        }
        if (el.nanPatchBusyText && busy) {
            const pct = Math.round((progress || 0) * 100);
            el.nanPatchBusyText.textContent = pct > 0 && pct < 100
                ? t('nanPatchProgress', pct)
                : t('nanPatchUpdating');
        }
        updateNanPatchRoiUI();
        updateEditButtons();
    }

    function renderNanPatchCompare(opts) {
        const resetView = !!(opts && opts.resetView);
        const base = st.edit.nanPatchBase;
        const result = st.edit.nanPatchResult;
        if (!base || !result || !st.dataset) return;
        const ds = st.dataset;
        const cmap = el.colormap.value;
        const { width, height } = ds;
        const afterData = result.patchedData;
        const afterStats = computeRange(afterData);
        const beforeDr = segLevelDisplayRange(base.vmin, base.vmax, st.colorClip);
        const afterDr = segLevelDisplayRange(afterStats.vmin, afterStats.vmax, st.colorClip);
        renderNanPatchCanvas(
            el.nanPatchBefore, base.data, width, height,
            beforeDr.cmin, beforeDr.crange, cmap, 'beforeImg', resetView,
        );
        renderNanPatchCanvas(
            el.nanPatchAfter, afterData, width, height,
            afterDr.cmin, afterDr.crange, cmap, 'afterImg', resetView,
        );
        renderSegLevelPaneColorbar(
            el.nanPatchBeforeCb, el.nanPatchBeforeCbLo, el.nanPatchBeforeCbHi,
            base.vmin, base.vmax, cmap, st.colorClip,
        );
        renderSegLevelPaneColorbar(
            el.nanPatchAfterCb, el.nanPatchAfterCbLo, el.nanPatchAfterCbHi,
            afterStats.vmin, afterStats.vmax, cmap, st.colorClip,
        );
        syncNanPatchKernelUI(result.kernelSize);
        drawNanPatchRoiShape();
    }

    function renderNanPatchBeforeOnly() {
        const base = st.edit.nanPatchBase;
        if (!base || !st.dataset) return;
        const cmap = el.colormap.value;
        const { width, height } = st.dataset;
        const dr = segLevelDisplayRange(base.vmin, base.vmax, st.colorClip);
        renderNanPatchCanvas(
            el.nanPatchBefore, base.data, width, height,
            dr.cmin, dr.crange, cmap, 'beforeImg', true,
        );
        renderSegLevelPaneColorbar(
            el.nanPatchBeforeCb, el.nanPatchBeforeCbLo, el.nanPatchBeforeCbHi,
            base.vmin, base.vmax, cmap, st.colorClip,
        );
        if (el.nanPatchAfter) {
            const c = el.nanPatchAfter;
            const ctx = c.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, c.width, c.height);
        }
    }

    async function recomputeNanPatchPreview(options) {
        options = options || {};
        const base = st.edit.nanPatchBase;
        if (!st.edit.nanPatch || !base || !st.dataset) return;

        const kernelSize = readNanPatchKernelFromUI();
        const roi = captureNanPatchRoi();
        const roiKey = nanPatchRoiKey(roi);
        const prev = st.edit.nanPatchResult;
        if (prev && prev.kernelSize === kernelSize && prev.roiKey === roiKey && !options.force) {
            renderNanPatchCompare({ resetView: !!options.resetView });
            return;
        }

        const runId = ++st.edit.nanPatchRunId;
        const outBuf = (prev?.patchedData instanceof Float32Array && prev.kernelSize === kernelSize && prev.roiKey === roiKey)
            ? prev.patchedData : null;
        setNanPatchBusyUI(true, 0);
        await segLevelYield();
        if (runId !== st.edit.nanPatchRunId) {
            setNanPatchBusyUI(false);
            return;
        }

        try {
            let patched;
            if (typeof applyNanPatchAsync === 'function') {
                const { width, height } = st.dataset;
                patched = await applyNanPatchAsync(
                    base.data, width, height, kernelSize, outBuf, 64,
                    () => runId !== st.edit.nanPatchRunId,
                    roi,
                );
                if (!patched || runId !== st.edit.nanPatchRunId) return;
                setNanPatchBusyUI(true, 1);
            } else if (typeof applyNanPatch === 'function') {
                const { width, height } = st.dataset;
                patched = applyNanPatch(base.data, width, height, kernelSize, outBuf, roi);
            } else {
                return;
            }

            if (runId !== st.edit.nanPatchRunId) return;
            st.edit.nanPatchResult = { kernelSize, patchedData: patched, roi, roiKey };
            renderNanPatchCompare({ resetView: !!options.resetView });
            el.status.textContent = nanPatchStatusText(st.edit.nanPatchResult);
        } finally {
            if (runId === st.edit.nanPatchRunId) setNanPatchBusyUI(false);
        }
    }

    function enterNanPatchUI(active) {
        if (el.viewer) el.viewer.classList.toggle('nan-patch-active', active);
        if (el.nanPatchPanel) el.nanPatchPanel.setAttribute('aria-hidden', active ? 'false' : 'true');
        if (el.nanPatch) el.nanPatch.classList.toggle('tool-active', active);
        if (active && !st.edit.nanPatchBusy && st.edit.nanPatchResult) {
            requestAnimationFrame(() => renderNanPatchCompare({ resetView: true }));
        }
    }

    function exitNanPatchMode() {
        st.edit.nanPatch = false;
        st.edit.nanPatchBusy = false;
        st.edit.nanPatchRunId++;
        st.edit.nanPatchBase = null;
        st.edit.nanPatchResult = null;
        st.edit.nanPatchRoiMode = null;
        st.edit.nanPatchRoi = null;
        st.edit.nanPatchRoiSel = null;
        st.edit.nanPatchRoiAction = null;
        nanPatchResetViews();
        setNanPatchBusyUI(false);
        setNanPatchConfigUI(false);
        enterNanPatchUI(false);
        updateNanPatchRoiUI();
        updateEditButtons();
    }

    function cancelNanPatch() {
        if (!st.edit.nanPatch) return;
        st.edit.nanPatchRunId++;
        const base = st.edit.nanPatchBase;
        if (base && st.dataset && !st.edit.nanPatchBusy) {
            st.dataset.data = base.data.slice();
            st.dataset.vmin = base.vmin;
            st.dataset.vmax = base.vmax;
            resetColorClip(false);
            render(st.dataset, el.colormap.value, false);
        }
        exitNanPatchMode();
    }

    async function startNanPatchMode() {
        if (!editing || !st.dataset) { showToast(t('editNoData'), 'info'); return; }
        if (isScatter(st.dataset)) { showToast(t('nanPatchScatter'), 'info'); return; }
        if (st.edit.nanPatch) {
            if (st.edit.nanPatchBusy) {
                st.edit.nanPatchRunId++;
                exitNanPatchMode();
            } else {
                cancelNanPatch();
            }
            return;
        }

        endTransientModes();

        snapshotNanPatchBase();
        nanPatchResetViews();
        st.edit.nanPatch = true;
        st.edit.nanPatchResult = null;
        st.edit.nanPatchRoiMode = null;
        st.edit.nanPatchRoi = null;
        st.edit.nanPatchRoiSel = null;
        st.edit.nanPatchRoiAction = null;
        if (el.nanPatchKernel) el.nanPatchKernel.value = '3';

        enterNanPatchUI(true);
        setNanPatchConfigUI(true);
        updateNanPatchRoiUI();
        renderNanPatchBeforeOnly();
        updateEditButtons();
        el.status.textContent = t('nanPatchProcessing');

        await recomputeNanPatchPreview({ resetView: true, force: true });
    }

    function onNanPatchKernelChange() {
        if (!st.edit.nanPatch || st.edit.nanPatchBusy) return;
        recomputeNanPatchPreview({ resetView: false, force: true });
    }

    function applyNanPatchEdit() {
        if (!st.edit.nanPatch || st.edit.nanPatchBusy || !st.edit.nanPatchResult || !st.dataset) return;
        const result = st.edit.nanPatchResult;
        ensureFloatPixels(st.dataset);
        st.dataset.data = result.patchedData.slice();
        exitNanPatchMode();
        refreshAfterEdit(false);
        pushHistory();
        const step = { type: 'nanPatch', kernelSize: result.kernelSize };
        if (result.roi) step.roi = { ...result.roi };
        setLastEditStep(step);
        const msg = result.roi ? t('nanPatchDoneRoi', result.kernelSize) : t('nanPatchDone', result.kernelSize);
        el.status.textContent = msg;
        showToast(msg, 'info');
    }

    /* 結束暫態模式後複製資料集，供傳送到其他頁面 */
    function prepareDatasetForSend() {
        if (!st.dataset) { showToast(t('sendNoData'), 'info'); return null; }
        if (st.edit.denoise) toggleDenoise(false); // 先套用雜點篩除結果
        if (st.edit.segLevel) cancelSegLevel();
        if (st.edit.segSkew) cancelSegSkew();
        if (st.edit.medianFilter) cancelMedianFilter();
        if (st.edit.scatterGrid) cancelScatterGrid();
        if (st.edit.nanPatch) cancelNanPatch();
        if (st.edit.roiLevel) cancelRoiLevel();
        if (st.edit.profilePoly) cancelProfilePoly();
        return cloneDatasetForTransfer(st.dataset);
    }

    /* 複製目前資料集（深拷貝陣列、移除畫布參照）以便安全傳送到檢視器 */
    function sendToViewer() {
        const clone = prepareDatasetForSend();
        if (!clone) return;
        // 先切到檢視器頁面，讓畫布有正確尺寸後再載入，避免 fit 計算到 0
        if (typeof switchPage === 'function') switchPage('viewer');
        if (typeof loadDatasetIntoViewer === 'function' && loadDatasetIntoViewer(clone)) {
            showToast(t('sentToViewer'), 'info');
        }
    }

    function sendToAnalysis() {
        const clone = prepareDatasetForSend();
        if (!clone) return;
        if (typeof transferDatasetToAnalysis === 'function') {
            transferDatasetToAnalysis({ ds: clone });
        }
    }

    function sendToOverlay(side) {
        const clone = prepareDatasetForSend();
        if (!clone) return;
        if (typeof transferDatasetToOverlayAnalysis === 'function') {
            transferDatasetToOverlayAnalysis(side, { ds: clone });
        }
    }

    function loadDataset(ds, opts) {
        opts = opts || {};
        if (!ds) return false;
        const rangeSrc = ds.type === 'pcd-scatter' ? ds.z : ds.data;
        const { vmin, vmax } = computeRange(rangeSrc);
        st.dataset = { ...ds, vmin, vmax, canvasEl: el.canvas };
        resetPointSizeSession({ sync: false });
        resetColorClip(false);
        if (opts.colormap && el.colormap) {
            el.colormap.value = opts.colormap;
            syncColormapPicker(el.colormap);
        }
        render(st.dataset, el.colormap.value, true);
        const infoExtra = ds.type === 'pcd-scatter' ? { pointCount: ds.pointCount } : null;
        renderInfo(ds.header, ds.width, ds.height, infoExtra);
        if (ds.type === 'pcd-scatter') el.status.textContent = t('statusLoadedPcd', ds.filename, ds.pointCount);
        else el.status.textContent = t('statusLoaded', ds.filename, ds.width, ds.height);
        if (typeof editAfterLoad === 'function') editAfterLoad();
        if (el.btnSave) el.btnSave.disabled = false;
        if (el.btnClear) el.btnClear.disabled = false;
        syncPointSizeControls();
        return true;
    }

    async function loadDatasetAsync(ds, opts, onProgress) {
        opts = opts || {};
        if (!ds) return false;
        const rangeSrc = ds.type === 'pcd-scatter' ? ds.z : ds.data;
        const { vmin, vmax } = rangeSrc.length >= LARGE_PIXEL_THRESHOLD
            ? await computeRangeAsync(rangeSrc)
            : computeRange(rangeSrc);
        st.dataset = { ...ds, vmin, vmax, canvasEl: el.canvas };
        resetPointSizeSession({ sync: false });
        resetColorClip(false);
        if (opts.colormap && el.colormap) {
            el.colormap.value = opts.colormap;
            syncColormapPicker(el.colormap);
        }

        const canvas = el.canvas;
        const cmap = el.colormap.value;
        if (isScatter(st.dataset)) {
            canvas.classList.add('scatter-view');
            renderScatter(st.dataset, cmap);
            if (onProgress) onProgress(1);
        } else {
            canvas.classList.remove('scatter-view');
            canvas.style.width = '';
            canvas.style.height = '';
            await renderPixelsAsync(st.dataset, cmap, onProgress, canvas, (d) => effColorRange(d));
        }

        canvas.style.display = 'block';
        el.placeholder.style.display = 'none';
        el.zoomIndicator.classList.add('show');
        el.zoomHint.classList.add('show');
        fitImage();
        applyTransform();
        renderColorbar(cmap);
        el.zMin.textContent = st.dataset.vmin.toFixed(4);
        el.zMax.textContent = st.dataset.vmax.toFixed(4);
        syncColorbarHandles();

        const infoExtra = ds.type === 'pcd-scatter' ? { pointCount: ds.pointCount } : null;
        renderInfo(ds.header, ds.width, ds.height, infoExtra);
        if (ds.type === 'pcd-scatter') el.status.textContent = t('statusLoadedPcd', ds.filename, ds.pointCount);
        else el.status.textContent = t('statusLoaded', ds.filename, ds.width, ds.height);
        if (typeof editAfterLoad === 'function') editAfterLoad();
        if (el.btnSave) el.btnSave.disabled = false;
        syncPointSizeControls();
        if (el.btnClear) el.btnClear.disabled = false;
        return true;
    }

    /* ---- 裁切 ---- */
    function setCropMode(mode) {
        if (!editing || !st.dataset) return;
        if (st.edit.denoise) toggleDenoise(false);
        if (st.edit.segLevel) cancelSegLevel();
        if (st.edit.segSkew) cancelSegSkew();
        if (st.edit.medianFilter) cancelMedianFilter();
        if (st.edit.scatterGrid) cancelScatterGrid();
        if (st.edit.nanPatch) cancelNanPatch();
        if (st.edit.roiLevel) cancelRoiLevel();
        if (st.edit.profilePoly) cancelProfilePoly();
        // 點擊已啟用的模式 → 關閉
        if (st.edit.cropMode === mode) { exitCrop(); return; }
        st.edit.cropMode = mode;
        st.edit.cropSel = null;
        el.viewer.classList.add('crop-active');
        if (el.cropShape) el.cropShape.style.display = 'none';
        if (el.cropShape) el.cropShape.classList.toggle('circle', mode === 'circle');
        el.cropRect.classList.toggle('active', mode === 'rect');
        el.cropCircle.classList.toggle('active', mode === 'circle');
        updateEditButtons();
    }
    function exitCrop() {
        st.edit.cropMode = null; st.edit.cropSel = null; st.edit.cropAction = null;
        el.viewer.classList.remove('crop-active');
        if (el.cropShape) el.cropShape.style.display = 'none';
        el.cropRect.classList.remove('active');
        el.cropCircle.classList.remove('active');
        updateEditButtons();
    }
    function drawCropShape() {
        drawRegionShape(el.cropShape, st.edit.cropSel);
    }
    function setupCropOverlay() {
        setupRegionSelectOverlay({
            overlay: el.cropOverlay,
            shape: el.cropShape,
            container: el.viewer,
            isActive: () => st.edit.cropMode && !!st.dataset,
            getSel: () => st.edit.cropSel,
            setSel: (v) => { st.edit.cropSel = v; },
            getAction: () => st.edit.cropAction,
            setAction: (v) => { st.edit.cropAction = v; },
            onEnd: () => updateEditButtons(),
        });
    }
    function pointInSel(px, py, n, circle) {
        if (!circle) return px >= n.x0 && px <= n.x1 && py >= n.y0 && py <= n.y1;
        const cx = (n.x0 + n.x1) / 2, cy = (n.y0 + n.y1) / 2;
        const rx = (n.x1 - n.x0) / 2, ry = (n.y1 - n.y0) / 2;
        if (rx <= 0 || ry <= 0) return false;
        const dx = (px - cx) / rx, dy = (py - cy) / ry;
        return dx * dx + dy * dy <= 1;
    }

    /** 將目前裁切框轉為可序列化的批次步驟（正規化座標） */
    function captureCropStep() {
        if (!st.edit.cropMode || !st.edit.cropSel || !st.dataset) return null;
        const n = normSel(st.edit.cropSel);
        const ds = st.dataset;
        const type = st.edit.cropMode === 'circle' ? 'cropCircle' : 'cropRect';
        if (isScatter(ds)) {
            const b = ds.bounds;
            const spanX = (b.xmax - b.xmin) || 1;
            const spanY = (b.ymax - b.ymin) || 1;
            const sc = st.sc;
            const halfW = sc.screenW * 0.5, halfH = sc.screenH * 0.5;
            const toWorld = (sx, sy) => ({
                wx: sc.centerX + (sx - halfW) * sc.worldPerPx,
                wy: sc.centerY - (sy - halfH) * sc.worldPerPx,
            });
            const c0 = toWorld(n.x0, n.y0), c1 = toWorld(n.x1, n.y1);
            const wx0 = Math.min(c0.wx, c1.wx), wx1 = Math.max(c0.wx, c1.wx);
            const wy0 = Math.min(c0.wy, c1.wy), wy1 = Math.max(c0.wy, c1.wy);
            return {
                type,
                x0: Math.max(0, Math.min(1, (wx0 - b.xmin) / spanX)),
                y0: Math.max(0, Math.min(1, (wy0 - b.ymin) / spanY)),
                x1: Math.max(0, Math.min(1, (wx1 - b.xmin) / spanX)),
                y1: Math.max(0, Math.min(1, (wy1 - b.ymin) / spanY)),
            };
        }
        const scv = st.view.scale, tx = st.view.tx, ty = st.view.ty;
        const ix0 = (n.x0 - tx) / scv, ix1 = (n.x1 - tx) / scv;
        const iy0 = (n.y0 - ty) / scv, iy1 = (n.y1 - ty) / scv;
        const { width, height } = ds;
        return {
            type,
            x0: Math.max(0, Math.min(1, ix0 / width)),
            y0: Math.max(0, Math.min(1, iy0 / height)),
            x1: Math.max(0, Math.min(1, ix1 / width)),
            y1: Math.max(0, Math.min(1, iy1 / height)),
        };
    }

    function applyCrop() {
        if (!editing || !st.dataset || !st.edit.cropMode || !st.edit.cropSel) {
            showToast(t('cropNoSelection'), 'info'); return;
        }
        const circle = st.edit.cropMode === 'circle';
        const n = normSel(st.edit.cropSel);
        const ds = st.dataset;
        const cropStep = captureCropStep();
        if (isScatter(ds)) {
            const { x, y, z } = ds, total = z.length;
            let keep = 0;
            const mask = new Uint8Array(total);
            for (let i = 0; i < total; i++) {
                const s = scWorldToScreen(x[i], y[i]);
                if (pointInSel(s.sx, s.sy, n, circle)) { mask[i] = 1; keep++; }
            }
            if (keep === 0) { showToast(t('cropEmpty'), 'info'); return; }
            const nx = new Float32Array(keep), ny = new Float32Array(keep), nz = new Float32Array(keep);
            let j = 0;
            for (let i = 0; i < total; i++) if (mask[i]) { nx[j] = x[i]; ny[j] = y[i]; nz[j] = z[i]; j++; }
            ds.x = nx; ds.y = ny; ds.z = nz; ds.pointCount = keep;
            recomputeScatterBounds(ds);
            setLastEditStep(cropStep);
            exitCrop();
            refreshAfterEdit(true);
            pushHistory();
            el.status.textContent = t('cropDone', keep);
            showToast(t('cropDone', keep), 'info');
        } else {
            ensureFloatPixels(ds);
            const { data, width, height } = ds;
            const sc = st.view.scale, tx = st.view.tx, ty = st.view.ty;
            const ix0 = (n.x0 - tx) / sc, ix1 = (n.x1 - tx) / sc;
            const iy0 = (n.y0 - ty) / sc, iy1 = (n.y1 - ty) / sc;
            const cx = (ix0 + ix1) / 2, cy = (iy0 + iy1) / 2, rx = (ix1 - ix0) / 2, ry = (iy1 - iy0) / 2;
            let keep = 0;
            for (let iy = 0; iy < height; iy++) {
                for (let ix = 0; ix < width; ix++) {
                    const px = ix + 0.5, py = iy + 0.5;
                    let inside;
                    if (circle) { const dx = (px - cx) / rx, dy = (py - cy) / ry; inside = rx > 0 && ry > 0 && dx * dx + dy * dy <= 1; }
                    else inside = px >= ix0 && px <= ix1 && py >= iy0 && py <= iy1;
                    const idx = iy * width + ix;
                    if (inside) { if (Number.isFinite(data[idx])) keep++; }
                    else data[idx] = NaN;
                }
            }
            if (keep === 0) { showToast(t('cropEmpty'), 'info'); return; }
            setLastEditStep(cropStep);
            exitCrop();
            refreshAfterEdit(false);
            pushHistory();
            el.status.textContent = t('cropDone', keep);
            showToast(t('cropDone', keep), 'info');
        }
    }

    /* ---- 互動式刪除雜點（直方圖） ---- */
    const HIST_BINS = DENOISE_HIST_BINS;
    let histData = null, histRaf = false, denoiseSyncColorbar = false;

    function snapshotDenoiseBase() {
        const ds = st.dataset;
        if (isScatter(ds)) {
            st.edit.denoiseBase = {
                scatter: true,
                x: ds.x.slice(0), y: ds.y.slice(0), z: ds.z.slice(0),
                vmin: ds.vmin, vmax: ds.vmax,
                width: ds.width, height: ds.height, header: ds.header,
            };
        } else {
            ensureFloatPixels(ds);
            st.edit.denoiseBase = {
                scatter: false,
                data: ds.data.slice(0),
                vmin: ds.vmin, vmax: ds.vmax,
                width: ds.width, height: ds.height, header: ds.header,
            };
        }
    }

    function computeHist() {
        const base = st.edit.denoiseBase;
        const vals = base.scatter ? base.z : base.data;
        const vmin = base.vmin, vmax = base.vmax, span = (vmax - vmin) || 1;
        const counts = new Float64Array(HIST_BINS);
        let total = 0, maxC = 0;
        for (let i = 0; i < vals.length; i++) {
            const v = vals[i];
            if (!Number.isFinite(v)) continue;
            let f = (v - vmin) / span;
            if (f < 0) f = 0; else if (f >= 1) f = 0.999999;
            counts[(f * HIST_BINS) | 0]++; total++;
        }
        for (let i = 0; i < HIST_BINS; i++) if (counts[i] > maxC) maxC = counts[i];
        histData = { counts, total, maxC: maxC || 1, vmin, vmax };
    }

    function histValAt(frac) {
        const base = st.edit.denoiseBase;
        return base.vmin + frac * ((base.vmax - base.vmin) || 1);
    }

    /** 依 IQR（四分位距）統計自動設定左右標籤，排除離群雜訊 */
    function autoDenoiseBounds() {
        if (!st.edit.denoise || !st.edit.denoiseBase || !histData || histData.total < 4) return;
        const base = st.edit.denoiseBase;
        const vals = base.scatter ? base.z : base.data;
        const { lo, hi } = computeAutoDenoiseFracs(vals, base.vmin, base.vmax);
        st.edit.histLo = lo;
        st.edit.histHi = hi;
        st.edit.histAuto = true;
        scheduleDenoise(true);
    }

    function alignHistVal(valEl, frac) {
        const wrapW = el.histWrap ? el.histWrap.clientWidth : 0;
        const labelW = valEl.offsetWidth;
        let shift = 0;
        if (wrapW > 0 && labelW > 0) {
            const center = frac * wrapW;
            const pad = 2;
            if (center - labelW / 2 < pad) shift = pad + labelW / 2 - center;
            else if (center + labelW / 2 > wrapW - pad) shift = wrapW - pad - center - labelW / 2;
        }
        valEl.style.transform = shift ? `translateX(calc(-50% + ${shift.toFixed(1)}px))` : 'translateX(-50%)';
    }

    function renderHist() {
        if (!histData) return;
        const cv = el.histCanvas;
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(1, cv.clientWidth), h = Math.max(1, cv.clientHeight);
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
        const ctx = cv.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const { counts, maxC } = histData;
        const lo = st.edit.histLo, hi = st.edit.histHi;
        const bw = w / HIST_BINS;
        for (let i = 0; i < HIST_BINS; i++) {
            const f0 = i / HIST_BINS, f1 = (i + 1) / HIST_BINS;
            const bh = Math.sqrt(counts[i] / maxC) * (h - 4);
            const inRange = (f1 > lo && f0 < hi);
            ctx.fillStyle = inRange ? 'rgba(79,140,255,0.85)' : 'rgba(120,120,140,0.35)';
            ctx.fillRect(i * bw, h - bh, Math.max(1, bw - 0.5), bh);
        }
        // 保留範圍邊界
        ctx.fillStyle = 'rgba(79,140,255,0.10)';
        ctx.fillRect(lo * w, 0, (hi - lo) * w, h);
        // 更新標籤位置與文字；數字在標籤上方，貼邊時往圖內收以免被裁切
        el.histHandleLo.style.left = (lo * 100) + '%';
        el.histHandleHi.style.left = (hi * 100) + '%';
        el.histValLo.textContent = histValAt(lo).toFixed(3);
        el.histValHi.textContent = histValAt(hi).toFixed(3);
        alignHistVal(el.histValLo, lo);
        alignHistVal(el.histValHi, hi);
        el.histAxisMin.textContent = histData.vmin.toFixed(3);
        el.histAxisMax.textContent = histData.vmax.toFixed(3);
    }

    function hideHistHover() {
        if (el.histTip) el.histTip.hidden = true;
        if (el.histHoverLine) el.histHoverLine.hidden = true;
    }

    function histBinDigits(step) {
        if (!(step > 0)) return 3;
        return Math.min(6, Math.max(3, Math.ceil(-Math.log10(step)) + 1));
    }

    function setupHistHover() {
        const wrap = el.histWrap, tip = el.histTip, line = el.histHoverLine;
        if (!wrap || !tip) return;
        wrap.addEventListener('pointermove', (e) => {
            if (!histData || e.buttons) { hideHistHover(); return; }
            const canvas = el.histCanvas;
            const wrapRect = wrap.getBoundingClientRect();
            const canvasRect = canvas.getBoundingClientRect();
            if (wrapRect.width <= 0 || e.clientY < canvasRect.top || e.clientY > canvasRect.bottom) {
                hideHistHover();
                return;
            }
            const frac = Math.min(0.999999, Math.max(0, (e.clientX - wrapRect.left) / wrapRect.width));
            const bin = Math.min(HIST_BINS - 1, (frac * HIST_BINS) | 0);
            const span = (histData.vmax - histData.vmin) || 0;
            const step = span > 0 ? span / HIST_BINS : 0;
            const lo = histData.vmin + bin * step;
            const hi = span > 0 ? histData.vmin + (bin + 1) * step : histData.vmax;
            const digits = histBinDigits(step);
            const loText = lo.toFixed(digits);
            const hiText = hi.toFixed(digits);
            const valueText = loText === hiText ? loText : loText + ' ～ ' + hiText;
            tip.textContent = t('denoiseHistValue', valueText) + '\n' + t('denoiseHistCount', histData.counts[bin]);
            tip.hidden = false;
            const tipW = tip.offsetWidth, tipH = tip.offsetHeight;
            const labelSpace = canvasRect.top - wrapRect.top;
            let x = e.clientX - wrapRect.left + 14;
            let y = e.clientY - wrapRect.top - tipH - 10;
            if (x + tipW > wrapRect.width - 4) x = e.clientX - wrapRect.left - tipW - 14;
            if (y < labelSpace) y = e.clientY - wrapRect.top + 16;
            tip.style.left = Math.min(Math.max(4, x), Math.max(4, wrapRect.width - tipW - 4)) + 'px';
            tip.style.top = Math.min(Math.max(4, y), Math.max(4, wrapRect.height - tipH - 4)) + 'px';
            if (line) {
                line.hidden = false;
                line.style.left = ((bin + 0.5) / HIST_BINS * 100) + '%';
            }
        });
        wrap.addEventListener('pointerleave', hideHistHover);
        wrap.addEventListener('pointercancel', hideHistHover);
    }

    function applyDenoiseFilter(syncColorbar = false) {
        const base = st.edit.denoiseBase; if (!base) return;
        const loV = histValAt(st.edit.histLo), hiV = histValAt(st.edit.histHi);
        const ds = st.dataset;
        let keep = 0;
        if (base.scatter) {
            const bx = base.x, by = base.y, bz = base.z, total = bz.length;
            const mask = new Uint8Array(total);
            for (let i = 0; i < total; i++) {
                const v = bz[i];
                if (Number.isFinite(v) && v >= loV && v <= hiV) { mask[i] = 1; keep++; }
            }
            const nx = new Float32Array(keep), ny = new Float32Array(keep), nz = new Float32Array(keep);
            let j = 0;
            for (let i = 0; i < total; i++) if (mask[i]) { nx[j] = bx[i]; ny[j] = by[i]; nz[j] = bz[i]; j++; }
            ds.x = nx; ds.y = ny; ds.z = nz; ds.pointCount = keep;
            if (syncColorbar) {
                const { vmin, vmax } = computeRange(ds.z);
                ds.vmin = vmin; ds.vmax = vmax;
                st.colorClip.lo = 0; st.colorClip.hi = 1;
            } else {
                // 拖曳預覽時維持色彩穩定：沿用快照範圍
                ds.vmin = base.vmin; ds.vmax = base.vmax;
            }
            render(ds, el.colormap.value, false);
        } else {
            const bd = base.data, d = ds.data;
            for (let i = 0; i < bd.length; i++) {
                const v = bd[i];
                if (Number.isFinite(v) && v >= loV && v <= hiV) { d[i] = v; keep++; }
                else d[i] = NaN;
            }
            if (syncColorbar) {
                const { vmin, vmax } = computeRange(d);
                ds.vmin = vmin; ds.vmax = vmax;
                st.colorClip.lo = 0; st.colorClip.hi = 1;
            } else {
                ds.vmin = base.vmin; ds.vmax = base.vmax;
            }
            render(ds, el.colormap.value, false);
        }
        if (el.histStats) el.histStats.textContent = keep + ' / ' + histData.total;
    }

    function scheduleDenoise(syncColorbar = false) {
        if (syncColorbar) denoiseSyncColorbar = true;
        renderHist();
        if (histRaf) return;
        histRaf = true;
        requestAnimationFrame(() => {
            histRaf = false;
            const sync = denoiseSyncColorbar;
            denoiseSyncColorbar = false;
            applyDenoiseFilter(sync);
        });
    }

    function toggleDenoise(force) {
        if (!editing) return;
        const want = (typeof force === 'boolean') ? force : !st.edit.denoise;
        if (want && !st.dataset) { showToast(t('editNoData'), 'info'); return; }
        if (want) {
            if (st.edit.cropMode) exitCrop();
            if (st.edit.segLevel) cancelSegLevel();
            if (st.edit.medianFilter) cancelMedianFilter();
            if (st.edit.scatterGrid) cancelScatterGrid();
            if (st.edit.nanPatch) cancelNanPatch();
        if (st.edit.roiLevel) cancelRoiLevel();
        if (st.edit.profilePoly) cancelProfilePoly();
        st.edit.denoise = true;
            st.edit.histLo = 0; st.edit.histHi = 1;
            st.edit.histAuto = false;
            snapshotDenoiseBase();
            computeHist();
            el.histPanel.classList.add('show');
            el.denoise.classList.add('tool-active');
            renderHist();
            applyDenoiseFilter();
        } else {
            const changed = (st.edit.histLo > 0 || st.edit.histHi < 1);
            st.edit.denoise = false;
            el.histPanel.classList.remove('show');
            el.denoise.classList.remove('tool-active');
            if (st.edit.denoiseBase) {
                if (st.edit.denoiseBase.scatter) recomputeScatterBounds(st.dataset);
                refreshAfterEdit(false);
            }
            st.edit.denoiseBase = null;
            histData = null;
            denoiseSyncColorbar = false;
            if (changed) {
                setLastEditStep(st.edit.histAuto
                    ? { type: 'denoise', auto: true }
                    : { type: 'denoise', lo: st.edit.histLo, hi: st.edit.histHi });
                pushHistory();  // 有實際篩除才記錄歷史
            }
        }
    }

    /* 取消刪除雜點並還原為啟用前的資料（不寫入歷史，供 undo/redo 使用） */
    function cancelDenoise() {
        if (!st.edit.denoise) return;
        st.edit.denoise = false;
        el.histPanel.classList.remove('show');
        el.denoise.classList.remove('tool-active');
        const base = st.edit.denoiseBase;
        if (base) {
            const ds = st.dataset;
            if (base.scatter) {
                ds.x = base.x.slice(0); ds.y = base.y.slice(0); ds.z = base.z.slice(0);
                ds.pointCount = base.z.length; recomputeScatterBounds(ds);
            } else {
                ds.data = base.data.slice(0);
            }
            ds.vmin = base.vmin; ds.vmax = base.vmax;
            resetColorClip(false);
            render(ds, el.colormap.value, false);
            renderInfo(ds.header, ds.width, ds.height, isScatter(ds) ? { pointCount: ds.pointCount } : null);
        }
        st.edit.denoiseBase = null;
        histData = null;
        denoiseSyncColorbar = false;
    }

    function setupHistHandles() {
        const wrap = el.histWrap, hLo = el.histHandleLo, hHi = el.histHandleHi;
        if (!wrap || !hLo || !hHi) return;
        const MIN_GAP = 0.005;
        let dragging = null;
        const fracFromX = (clientX) => {
            const r = wrap.getBoundingClientRect();
            if (r.width <= 0) return 0;
            return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
        };
        const onMove = (e) => {
            if (!dragging) return;
            const f = fracFromX(e.clientX);
            if (dragging === 'lo') st.edit.histLo = Math.min(f, st.edit.histHi - MIN_GAP);
            else st.edit.histHi = Math.max(f, st.edit.histLo + MIN_GAP);
            if (st.edit.histLo < 0) st.edit.histLo = 0;
            if (st.edit.histHi > 1) st.edit.histHi = 1;
            st.edit.histAuto = false;
            // 拖曳中只更新直方圖標籤；大圖即時重繪會卡頓，影像留到放開再更新
            renderHist();
        };
        const end = () => {
            if (!dragging) return;
            (dragging === 'lo' ? hLo : hHi).classList.remove('dragging');
            dragging = null;
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', end);
            scheduleDenoise(true);
        };
        const start = (which, handle, e) => {
            dragging = which; handle.classList.add('dragging'); e.preventDefault();
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', end);
        };
        hLo.addEventListener('pointerdown', (e) => start('lo', hLo, e));
        hHi.addEventListener('pointerdown', (e) => start('hi', hHi, e));
    }

    function editAfterLoad() {
        if (!editing) return;
        exitCrop();
        if (st.edit.denoise) {
            st.edit.denoise = false;
            el.histPanel.classList.remove('show');
            el.denoise.classList.remove('tool-active');
            st.edit.denoiseBase = null; histData = null;
        }
        if (st.edit.segLevel) exitSegLevelMode();
        if (st.edit.segSkew) exitSegSkewMode();
        if (st.edit.medianFilter) exitMedianFilterMode();
        if (st.edit.scatterGrid) exitScatterGridMode();
        if (st.edit.nanPatch) exitNanPatchMode();
        if (st.edit.roiLevel) exitRoiLevelMode();
        if (st.edit.uniLevel) exitUniLevelMode();
        if (st.edit.profilePoly) exitProfilePolyMode();
        resetHistory();          // 以新載入的資料作為歷史起點
        updateEditButtons();
    }

    if (editing) {
        setupCropOverlay();
        setupHistHandles();
        setupHistHover();
        el.cropRect.addEventListener('click', () => setCropMode('rect'));
        el.cropCircle.addEventListener('click', () => setCropMode('circle'));
        el.cropApply.addEventListener('click', applyCrop);
        el.cropCancel.addEventListener('click', exitCrop);
        el.denoise.addEventListener('click', () => toggleDenoise());
        if (el.segLevel) el.segLevel.addEventListener('click', startSegLevelMode);
        if (el.segLevelApply) el.segLevelApply.addEventListener('click', applySegLevel);
        if (el.segLevelCancel) el.segLevelCancel.addEventListener('click', cancelSegLevel);
        if (el.segLevelTuneK) {
            el.segLevelTuneK.addEventListener('keydown', onSegLevelTuneKeydown);
        }
        if (el.segLevelTuneReset) el.segLevelTuneReset.addEventListener('click', resetSegLevelTilt);
        if (el.segLevelBandOffsetReset) el.segLevelBandOffsetReset.addEventListener('click', resetSegLevelBandOffsets);
        if (el.sideToggle) el.sideToggle.addEventListener('click', toggleSegLevelSide);
        setupSegLevelColorbars();
        if (el.segLevelShowBounds) el.segLevelShowBounds.addEventListener('change', onSegLevelBoundsToggle);
        if (el.segLevelShowProbeBefore) el.segLevelShowProbeBefore.addEventListener('change', onSegLevelProbeToggle);
        if (el.segLevelShowProbeAfter) el.segLevelShowProbeAfter.addEventListener('change', onSegLevelProbeToggle);
        if (el.segLevelDir) el.segLevelDir.addEventListener('change', onSegLevelConfigChange);
        if (el.segLevelCount) {
            el.segLevelCount.addEventListener('change', onSegLevelConfigChange);
            el.segLevelCount.addEventListener('keydown', onSegLevelCountKeydown);
        }
        if (el.segLevelAuto) el.segLevelAuto.addEventListener('click', runSegLevelAuto);
        setupSegLevelZoom();
        if (el.segSkew) el.segSkew.addEventListener('click', startSegSkewMode);
        if (el.segSkewApply) el.segSkewApply.addEventListener('click', applySegSkew);
        if (el.segSkewCancel) el.segSkewCancel.addEventListener('click', cancelSegSkew);
        if (el.segSkewTuneShift) el.segSkewTuneShift.addEventListener('keydown', onSegSkewTuneKeydown);
        if (el.segSkewTuneReset) el.segSkewTuneReset.addEventListener('click', resetSegSkewShift);
        if (el.segSkewBandShiftReset) el.segSkewBandShiftReset.addEventListener('click', resetSegSkewBandShifts);
        if (el.segSkewShowBounds) el.segSkewShowBounds.addEventListener('change', onSegSkewBoundsToggle);
        if (el.segSkewDir) el.segSkewDir.addEventListener('change', onSegSkewConfigChange);
        if (el.segSkewCount) {
            el.segSkewCount.addEventListener('change', onSegSkewConfigChange);
            el.segSkewCount.addEventListener('keydown', onSegSkewCountKeydown);
        }
        if (el.segSkewAuto) el.segSkewAuto.addEventListener('click', runSegSkewAuto);
        setupSegSkewZoom();
        if (el.medianFilter) el.medianFilter.addEventListener('click', startMedianFilterMode);
        if (el.medianFilterApply) el.medianFilterApply.addEventListener('click', applyMedianFilterEdit);
        if (el.medianFilterCancel) el.medianFilterCancel.addEventListener('click', cancelMedianFilter);
        if (el.medianFilterKernel) el.medianFilterKernel.addEventListener('change', onMedianFilterKernelChange);
        setupMedianFilterZoom();
        if (el.scatterGrid) el.scatterGrid.addEventListener('click', startScatterGridMode);
        if (el.scatterGridApply) el.scatterGridApply.addEventListener('click', applyScatterGridEdit);
        if (el.scatterGridCancel) el.scatterGridCancel.addEventListener('click', cancelScatterGrid);
        if (el.scatterGridMode) el.scatterGridMode.addEventListener('change', onScatterGridConfigChange);
        if (el.scatterGridAgg) el.scatterGridAgg.addEventListener('change', onScatterGridConfigChange);
        if (el.scatterGridDx) {
            el.scatterGridDx.addEventListener('change', onScatterGridConfigChange);
            el.scatterGridDx.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); onScatterGridConfigChange(); }
            });
        }
        if (el.scatterGridWidth) {
            el.scatterGridWidth.addEventListener('change', onScatterGridConfigChange);
            el.scatterGridWidth.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); onScatterGridConfigChange(); }
            });
        }
        if (el.scatterGridHeight) {
            el.scatterGridHeight.addEventListener('change', onScatterGridConfigChange);
            el.scatterGridHeight.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); onScatterGridConfigChange(); }
            });
        }
        setupScatterGridZoom();
        if (el.nanPatch) el.nanPatch.addEventListener('click', startNanPatchMode);
        if (el.nanPatchApply) el.nanPatchApply.addEventListener('click', applyNanPatchEdit);
        if (el.nanPatchCancel) el.nanPatchCancel.addEventListener('click', cancelNanPatch);
        if (el.nanPatchKernel) el.nanPatchKernel.addEventListener('change', onNanPatchKernelChange);
        setupNanPatchZoom();
        setupNanPatchCropOverlay();
        setupNanPatchMiddlePan();
        if (el.nanPatchRoiRect) el.nanPatchRoiRect.addEventListener('click', () => setNanPatchRoiMode('rect'));
        if (el.nanPatchRoiCircle) el.nanPatchRoiCircle.addEventListener('click', () => setNanPatchRoiMode('circle'));
        if (el.nanPatchRoiClear) el.nanPatchRoiClear.addEventListener('click', clearNanPatchRoi);
        if (el.roiLevel) el.roiLevel.addEventListener('click', startRoiLevelMode);
        if (el.roiLevelApply) el.roiLevelApply.addEventListener('click', applyRoiLevelEdit);
        if (el.roiLevelCancel) el.roiLevelCancel.addEventListener('click', cancelRoiLevel);
        setupRoiLevelZoom();
        setupRoiLevelCropOverlay();
        setupRoiLevelMiddlePan();
        if (el.roiLevelRoiRect) el.roiLevelRoiRect.addEventListener('click', () => setRoiLevelRoiMode('rect'));
        if (el.roiLevelRoiCircle) el.roiLevelRoiCircle.addEventListener('click', () => setRoiLevelRoiMode('circle'));
        if (el.roiLevelRoiClear) el.roiLevelRoiClear.addEventListener('click', clearRoiLevelRoi);
        if (el.invertZ) el.invertZ.addEventListener('click', applyInvertZ);
        if (el.globalLevel) el.globalLevel.addEventListener('click', applyGlobalLeveling);
        if (el.uniLevel) el.uniLevel.addEventListener('click', startUniLevelMode);
        if (el.uniLevelApply) el.uniLevelApply.addEventListener('click', applyUniLevel);
        if (el.uniLevelCancel) el.uniLevelCancel.addEventListener('click', cancelUniLevel);
        if (el.uniLevelLineH) el.uniLevelLineH.addEventListener('click', () => setUniLevelLineDir('horizontal'));
        if (el.uniLevelLineV) el.uniLevelLineV.addEventListener('click', () => setUniLevelLineDir('vertical'));
        if (el.uniLevelK) el.uniLevelK.addEventListener('keydown', onUniLevelSlopeKeydown);
        if (el.uniLevelKReset) el.uniLevelKReset.addEventListener('click', resetUniLevelSlope);
        if (el.uniLevelShowProbeBefore) el.uniLevelShowProbeBefore.addEventListener('change', onUniLevelProbeToggle);
        if (el.uniLevelShowProbeAfter) el.uniLevelShowProbeAfter.addEventListener('change', onUniLevelProbeToggle);
        setupUniLevelZoom();
        setupUniLevelColorbars();
        if (el.profilePoly) el.profilePoly.addEventListener('click', startProfilePolyMode);
        if (el.profilePolyApply) el.profilePolyApply.addEventListener('click', applyProfilePoly);
        if (el.profilePolyCancel) el.profilePolyCancel.addEventListener('click', cancelProfilePoly);
        if (el.profilePolyOrder) el.profilePolyOrder.addEventListener('change', onProfilePolyParamsChanged);
        if (el.profilePolyDirH) el.profilePolyDirH.addEventListener('click', () => setProfilePolyDirection('horizontal'));
        if (el.profilePolyDirV) el.profilePolyDirV.addEventListener('click', () => setProfilePolyDirection('vertical'));
        setupProfilePolyZoom();
        setupProfilePolyColorbars();
        if (el.histAuto) el.histAuto.addEventListener('click', () => autoDenoiseBounds());
        if (el.histApply) el.histApply.addEventListener('click', () => toggleDenoise(false));
        if (el.histCancel) el.histCancel.addEventListener('click', () => cancelDenoise());
        if (typeof bindSendDropdown === 'function' && el.sendWrap && el.sendMenu) {
            bindSendDropdown(el.sendWrap, el.sendMenu, [
                { el: el.sendToViewer, action: sendToViewer },
                { el: el.sendToAnalysis, action: sendToAnalysis },
                { el: el.sendToOverlayA, action: () => sendToOverlay('a') },
                { el: el.sendToOverlayB, action: () => sendToOverlay('b') },
            ]);
        } else {
            if (el.sendToViewer) el.sendToViewer.addEventListener('click', sendToViewer);
            if (el.sendToAnalysis) el.sendToAnalysis.addEventListener('click', sendToAnalysis);
        }
        if (el.undo) el.undo.addEventListener('click', doUndo);
        if (el.redo) el.redo.addEventListener('click', doRedo);
        // 鍵盤快捷鍵：Ctrl/Cmd+Z 上一步、Ctrl/Cmd+Y 或 Ctrl/Cmd+Shift+Z 下一步
        const pageEl = el.viewer.closest('.page');
        document.addEventListener('keydown', (e) => {
            if (!st.dataset || (pageEl && !pageEl.classList.contains('active'))) return;
            if (!(e.ctrlKey || e.metaKey)) return;
            const ae = document.activeElement;
            if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' ||
                       ae.tagName === 'SELECT' || ae.isContentEditable)) return;
            const k = e.key.toLowerCase();
            if (k === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
            else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); doRedo(); }
        });
        window.addEventListener('resize', () => {
            if (st.edit.denoise) renderHist();
            if (st.edit.segLevel) renderSegLevelCompare({ resetView: true });
            if (st.edit.uniLevel) renderUniLevelCompare({ resetView: true });
            if (st.edit.profilePoly) renderProfilePolyCompare({ resetView: true });
            if (st.edit.segSkew) renderSegSkewCompare({ resetView: true });
            if (st.edit.medianFilter) renderMedianFilterCompare({ resetView: true });
            if (st.edit.scatterGrid) renderScatterGridCompare({ resetView: true });
            if (st.edit.nanPatch) renderNanPatchCompare({ resetView: true });
            if (st.edit.roiLevel) renderRoiLevelCompare({ resetView: true });
        });
        updateEditButtons();
    }

    /* 初始繪製空色階列 */
    renderColorbar(el.colormap.value);
    setupColorbarHandles();
    setupPointSizeControls();

    return {
        loadFile,
        loadDataset,
        loadDatasetAsync,
        hasData: () => !!st.dataset,
        canUseCalc: () => !!st.dataset && !isScatter(st.dataset),
        applyCalc,
        getDataset: () => st.dataset ? cloneDatasetForTransfer(st.dataset) : null,
        getFilename: () => (st.dataset && st.dataset.filename) ? st.dataset.filename : '',
        getDatasetSignature: () => st.dataset ? getDatasetSignature(st.dataset) : null,
        getLastEditStep: () => st.edit.lastEditStep,
        clearLastEditStep: () => { setLastEditStep(null); },
        repaint: () => {
            if (!st.dataset) return;
            if (isScatter(st.dataset) && (!el.viewer || el.viewer.clientWidth < 2)) return;
            render(st.dataset, el.colormap.value, false);
            if (st.refreshTools && el.viewer && el.viewer.clientWidth >= 2) st.refreshTools(false);
            if (st.edit.denoise) renderHist();
            if (st.edit.segLevel) renderSegLevelCompare({ resetView: false });
            if (st.edit.uniLevel) renderUniLevelCompare({ resetView: false });
            if (st.edit.profilePoly) renderProfilePolyCompare({ resetView: false });
            if (st.edit.segSkew) renderSegSkewCompare({ resetView: false });
            if (st.edit.medianFilter) renderMedianFilterCompare({ resetView: false });
            if (st.edit.scatterGrid) renderScatterGridCompare({ resetView: false });
            if (st.edit.nanPatch) renderNanPatchCompare({ resetView: false });
            if (st.edit.roiLevel) renderRoiLevelCompare({ resetView: false });
        },
        refit: () => {
            if (st.dataset && el.viewer.clientWidth > 0) {
                fitImage();
                if (st.edit.denoise) renderHist();
                if (st.edit.segLevel) renderSegLevelCompare({ resetView: true });
                if (st.edit.uniLevel) renderUniLevelCompare({ resetView: true });
            if (st.edit.profilePoly) renderProfilePolyCompare({ resetView: true });
                if (st.edit.segSkew) renderSegSkewCompare({ resetView: true });
                if (st.edit.medianFilter) renderMedianFilterCompare({ resetView: true });
                if (st.edit.scatterGrid) renderScatterGridCompare({ resetView: true });
                if (st.edit.nanPatch) renderNanPatchCompare({ resetView: true });
                if (st.edit.roiLevel) renderRoiLevelCompare({ resetView: true });
            }
        },
        syncLang: () => {
            const ds = st.dataset;
            if (!ds) el.status.textContent = t('statusIdle');
            else if (ds.type === 'pcd-scatter') el.status.textContent = t('statusLoadedPcd', ds.filename, ds.pointCount);
            else el.status.textContent = t('statusLoaded', ds.filename, ds.width, ds.height);
            if (!el.btnSave.disabled && !el.btnSave.classList.contains('is-busy')) {
                el.btnSave.title = t('btnSave');
                el.btnSave.setAttribute('aria-label', t('btnSave'));
            }
            if (el.btnClear) {
                el.btnClear.title = t('btnClearTitle');
                el.btnClear.setAttribute('aria-label', t('btnClearTitle'));
            }
            if (st.syncToolLang) st.syncToolLang();
            if (st.edit.uniLevel && st.edit.uniLevelResult) {
                uniLevelSyncChrome();
                el.status.textContent = uniLevelStatusText(st.edit.uniLevelResult);
            }
            if (st.edit.profilePoly && st.edit.profilePolyResult) {
                profilePolySyncChrome();
                el.status.textContent = st.edit.profilePolyResult.correctedData
                    ? profilePolyStatusText(st.edit.profilePolyResult)
                    : t('profilePolyUpdating');
            }
            syncSegLevelSideToggle();
            if (editing) updateEditButtons();
        },
        clearData,
    };
}

/* 建立「點雲編輯器」的影像檢視實例 */
const editorView = createImageView({
    viewer: 'edViewer', canvas: 'edCanvas', placeholder: 'edPlaceholder',
    zoomIndicator: 'edZoomIndicator', zoomHint: 'edZoomHint',
    cursorToolbar: 'edCursorToolbar', clearMarks: 'edClearMarks',
    valueIndicator: 'edValueIndicator',
    modeIndicator: 'edModeIndicator', modeIndicatorLabel: 'edModeIndicatorLabel',
    overlay: 'edOverlay',
    profilePanel: 'edProfilePanel', profileCanvas: 'edProfileCanvas',
    profileMeta: 'edProfileMeta', profileTip: 'edProfileTip', profileClear: 'edProfileClear',
    profileBandWrap: 'edProfileBandWrap', profileBand: 'edProfileBand',
    profileChartStyleWrap: 'edProfileChartStyleWrap',
    profileMeasureBtn: 'edProfileMeasureBtn', profileMeasureClearBtn: 'edProfileMeasureClearBtn',
    measurePanel: 'edMeasurePanel', measureTitle: 'edMeasureTitle',
    measureMeta: 'edMeasureMeta', measureClear: 'edMeasureClear',
    dropIcon: 'edDropIcon', dropText: 'edDropText',
    fileInput: 'edFileInput', colormap: 'edColormap',
    btnSave: 'edBtnSave', saveFormat: 'edSaveFormat', saveFormatItem: 'edSaveFormatItem',
    btnClear: 'edBtnClear',
    progress: 'edProgress', progressBar: 'edProgressBar', status: 'edStatus', infoList: 'edInfoList',
    sideToggle: 'edSideToggle',
    colorbarCanvas: 'edColorbarCanvas', colorbarTrack: 'edColorbarTrack',
    cbHandleLo: 'edCbHandleLo', cbHandleHi: 'edCbHandleHi',
    cbValLo: 'edCbValLo', cbValHi: 'edCbValHi', cbReset: 'edCbReset',
    zMin: 'edZMin', zMax: 'edZMax',
    pointSizeAdjust: 'edPointSizeAdjust', pointSizeSlider: 'edPointSizeSlider', pointSizeVal: 'edPointSizeVal',
    cropRect: 'edCropRect', cropCircle: 'edCropCircle',
    cropActions: 'edCropActions', cropApply: 'edCropApply',
    cropCancel: 'edCropCancel', cropOverlay: 'edCropOverlay', cropShape: 'edCropShape',
    cropHint: 'edCropHint', denoise: 'edDenoise', scatterGrid: 'edScatterGrid',
    scatterGridTip: 'edScatterGridTip',
    medianFilter: 'edMedianFilter', nanPatch: 'edNanPatch',
    segLevel: 'edSegLevel',
    segLevelPanel: 'edSegLevelPanel', segLevelConfig: 'edSegLevelConfig',
    segLevelDir: 'edSegLevelDir', segLevelCount: 'edSegLevelCount',
    segLevelAuto: 'edSegLevelAuto',
    segLevelCompare: 'edSegLevelCompare', segLevelBusy: 'edSegLevelBusy',
    segLevelBusyText: 'edSegLevelBusyText',
    segLevelBefore: 'edSegLevelBefore', segLevelAfter: 'edSegLevelAfter',
    segLevelBeforeCb: 'edSegLevelBeforeCb', segLevelBeforeCbLo: 'edSegLevelBeforeCbLo',
    segLevelBeforeCbHi: 'edSegLevelBeforeCbHi',
    segLevelAfterCb: 'edSegLevelAfterCb', segLevelAfterCbLo: 'edSegLevelAfterCbLo',
    segLevelAfterCbHi: 'edSegLevelAfterCbHi',
    segLevelBeforeProfile: 'edSegLevelBeforeProfile', segLevelAfterProfile: 'edSegLevelAfterProfile',
    segLevelTune: 'edSegLevelTune',
    segLevelTuneK: 'edSegLevelTuneK',
    segLevelTuneSlopeLabel: 'edSegLevelTuneSlopeLabel',
    segLevelTuneReset: 'edSegLevelTuneReset', segLevelTuneHint: 'edSegLevelTuneHint',
    segLevelBandOffsetList: 'edSegLevelBandOffsetList',
    segLevelBandOffsetReset: 'edSegLevelBandOffsetReset',
    segLevelTuneBusy: 'edSegLevelTuneBusy', segLevelTuneBusyText: 'edSegLevelTuneBusyText',
    segLevelShowBounds: 'edSegLevelShowBounds', segLevelBoundsWrap: 'edSegLevelBoundsWrap',
    segLevelShowProbeBefore: 'edSegLevelShowProbeBefore',
    segLevelShowProbeAfter: 'edSegLevelShowProbeAfter',
    segLevelUpdateBadge: 'edSegLevelUpdateBadge',
    segLevelApply: 'edSegLevelApply', segLevelCancel: 'edSegLevelCancel',
    segSkew: 'edSegSkew',
    segSkewPanel: 'edSegSkewPanel', segSkewConfig: 'edSegSkewConfig',
    segSkewDir: 'edSegSkewDir', segSkewCount: 'edSegSkewCount',
    segSkewAuto: 'edSegSkewAuto',
    segSkewCompare: 'edSegSkewCompare', segSkewBusy: 'edSegSkewBusy',
    segSkewBusyText: 'edSegSkewBusyText',
    segSkewBefore: 'edSegSkewBefore', segSkewAfter: 'edSegSkewAfter',
    segSkewBeforeCb: 'edSegSkewBeforeCb', segSkewBeforeCbLo: 'edSegSkewBeforeCbLo',
    segSkewBeforeCbHi: 'edSegSkewBeforeCbHi',
    segSkewAfterCb: 'edSegSkewAfterCb', segSkewAfterCbLo: 'edSegSkewAfterCbLo',
    segSkewAfterCbHi: 'edSegSkewAfterCbHi',
    segSkewTune: 'edSegSkewTune',
    segSkewTuneShift: 'edSegSkewTuneShift',
    segSkewTuneReset: 'edSegSkewTuneReset', segSkewTuneHint: 'edSegSkewTuneHint',
    segSkewBandShifts: 'edSegSkewBandShifts', segSkewBandShiftList: 'edSegSkewBandShiftList',
    segSkewBandShiftReset: 'edSegSkewBandShiftReset', segSkewBandShiftHint: 'edSegSkewBandShiftHint',
    segSkewTuneBusy: 'edSegSkewTuneBusy', segSkewTuneBusyText: 'edSegSkewTuneBusyText',
    segSkewShowBounds: 'edSegSkewShowBounds', segSkewBoundsWrap: 'edSegSkewBoundsWrap',
    segSkewApply: 'edSegSkewApply', segSkewCancel: 'edSegSkewCancel',
    medianFilterPanel: 'edMedianFilterPanel', medianFilterConfig: 'edMedianFilterConfig',
    medianFilterKernel: 'edMedianFilterKernel',
    medianFilterCompare: 'edMedianFilterCompare', medianFilterBusy: 'edMedianFilterBusy',
    medianFilterBusyText: 'edMedianFilterBusyText',
    medianFilterBefore: 'edMedianFilterBefore', medianFilterAfter: 'edMedianFilterAfter',
    medianFilterBeforeCb: 'edMedianFilterBeforeCb', medianFilterBeforeCbLo: 'edMedianFilterBeforeCbLo',
    medianFilterBeforeCbHi: 'edMedianFilterBeforeCbHi',
    medianFilterAfterCb: 'edMedianFilterAfterCb', medianFilterAfterCbLo: 'edMedianFilterAfterCbLo',
    medianFilterAfterCbHi: 'edMedianFilterAfterCbHi',
    medianFilterApply: 'edMedianFilterApply', medianFilterCancel: 'edMedianFilterCancel',
    scatterGridPanel: 'edScatterGridPanel', scatterGridConfig: 'edScatterGridConfig',
    scatterGridMode: 'edScatterGridMode', scatterGridAgg: 'edScatterGridAgg',
    scatterGridDx: 'edScatterGridDx', scatterGridWidth: 'edScatterGridWidth',
    scatterGridHeight: 'edScatterGridHeight',
    scatterGridSpacingWrap: 'edScatterGridSpacingWrap', scatterGridSizeWrap: 'edScatterGridSizeWrap',
    scatterGridMeta: 'edScatterGridMeta',
    scatterGridCompare: 'edScatterGridCompare', scatterGridBusy: 'edScatterGridBusy',
    scatterGridBusyText: 'edScatterGridBusyText',
    scatterGridBefore: 'edScatterGridBefore', scatterGridAfter: 'edScatterGridAfter',
    scatterGridBeforeCb: 'edScatterGridBeforeCb', scatterGridBeforeCbLo: 'edScatterGridBeforeCbLo',
    scatterGridBeforeCbHi: 'edScatterGridBeforeCbHi',
    scatterGridAfterCb: 'edScatterGridAfterCb', scatterGridAfterCbLo: 'edScatterGridAfterCbLo',
    scatterGridAfterCbHi: 'edScatterGridAfterCbHi',
    scatterGridApply: 'edScatterGridApply', scatterGridCancel: 'edScatterGridCancel',
    nanPatchPanel: 'edNanPatchPanel', nanPatchConfig: 'edNanPatchConfig',
    nanPatchKernel: 'edNanPatchKernel',
    nanPatchBeforeWrap: 'edNanPatchBeforeWrap',
    nanPatchCropOverlay: 'edNanPatchCropOverlay', nanPatchCropShape: 'edNanPatchCropShape',
    nanPatchCropHint: 'edNanPatchCropHint',
    nanPatchRoiRect: 'edNanPatchRoiRect', nanPatchRoiCircle: 'edNanPatchRoiCircle',
    nanPatchRoiClear: 'edNanPatchRoiClear',
    nanPatchCompare: 'edNanPatchCompare', nanPatchBusy: 'edNanPatchBusy',
    nanPatchBusyText: 'edNanPatchBusyText',
    nanPatchBefore: 'edNanPatchBefore', nanPatchAfter: 'edNanPatchAfter',
    nanPatchBeforeCb: 'edNanPatchBeforeCb', nanPatchBeforeCbLo: 'edNanPatchBeforeCbLo',
    nanPatchBeforeCbHi: 'edNanPatchBeforeCbHi',
    nanPatchAfterCb: 'edNanPatchAfterCb', nanPatchAfterCbLo: 'edNanPatchAfterCbLo',
    nanPatchAfterCbHi: 'edNanPatchAfterCbHi',
    nanPatchApply: 'edNanPatchApply', nanPatchCancel: 'edNanPatchCancel',
    invertZ: 'edInvertZ',
    globalLevel: 'edGlobalLevel',
    uniLevel: 'edUniLevel',
    uniLevelPanel: 'edUniLevelPanel', uniLevelConfig: 'edUniLevelConfig',
    uniLevelLineH: 'edUniLevelLineH', uniLevelLineV: 'edUniLevelLineV',
    uniLevelK: 'edUniLevelK',
    uniLevelSlopeLabel: 'edUniLevelSlopeLabel', uniLevelKReset: 'edUniLevelKReset',
    uniLevelCompare: 'edUniLevelCompare', uniLevelBusy: 'edUniLevelBusy',
    uniLevelBefore: 'edUniLevelBefore', uniLevelAfter: 'edUniLevelAfter',
    uniLevelBeforeCb: 'edUniLevelBeforeCb', uniLevelBeforeCbLo: 'edUniLevelBeforeCbLo',
    uniLevelBeforeCbHi: 'edUniLevelBeforeCbHi',
    uniLevelAfterCb: 'edUniLevelAfterCb', uniLevelAfterCbLo: 'edUniLevelAfterCbLo',
    uniLevelAfterCbHi: 'edUniLevelAfterCbHi',
    uniLevelBeforeProfile: 'edUniLevelBeforeProfile', uniLevelAfterProfile: 'edUniLevelAfterProfile',
    uniLevelShowProbeBefore: 'edUniLevelShowProbeBefore',
    uniLevelShowProbeAfter: 'edUniLevelShowProbeAfter',
    uniLevelUpdateBadge: 'edUniLevelUpdateBadge',
    uniLevelApply: 'edUniLevelApply', uniLevelCancel: 'edUniLevelCancel',
    profilePoly: 'edProfilePoly',
    profilePolyPanel: 'edProfilePolyPanel', profilePolyConfig: 'edProfilePolyConfig',
    profilePolyOrder: 'edProfilePolyOrder',
    profilePolyDirH: 'edProfilePolyDirH', profilePolyDirV: 'edProfilePolyDirV',
    profilePolyCompare: 'edProfilePolyCompare', profilePolyBusy: 'edProfilePolyBusy',
    profilePolyBusyText: 'edProfilePolyBusyText',
    profilePolyBefore: 'edProfilePolyBefore', profilePolyAfter: 'edProfilePolyAfter',
    profilePolyBeforeCb: 'edProfilePolyBeforeCb', profilePolyBeforeCbLo: 'edProfilePolyBeforeCbLo',
    profilePolyBeforeCbHi: 'edProfilePolyBeforeCbHi',
    profilePolyAfterCb: 'edProfilePolyAfterCb', profilePolyAfterCbLo: 'edProfilePolyAfterCbLo',
    profilePolyAfterCbHi: 'edProfilePolyAfterCbHi',
    profilePolyApply: 'edProfilePolyApply', profilePolyCancel: 'edProfilePolyCancel',
    roiLevel: 'edRoiLevel',
    roiLevelPanel: 'edRoiLevelPanel', roiLevelConfig: 'edRoiLevelConfig',
    roiLevelMeta: 'edRoiLevelMeta',
    roiLevelBeforeWrap: 'edRoiLevelBeforeWrap',
    roiLevelCropOverlay: 'edRoiLevelCropOverlay', roiLevelCropShape: 'edRoiLevelCropShape',
    roiLevelCropHint: 'edRoiLevelCropHint',
    roiLevelRoiRect: 'edRoiLevelRoiRect', roiLevelRoiCircle: 'edRoiLevelRoiCircle',
    roiLevelRoiClear: 'edRoiLevelRoiClear',
    roiLevelCompare: 'edRoiLevelCompare', roiLevelBusy: 'edRoiLevelBusy',
    roiLevelBusyText: 'edRoiLevelBusyText',
    roiLevelBefore: 'edRoiLevelBefore', roiLevelAfter: 'edRoiLevelAfter',
    roiLevelBeforeCb: 'edRoiLevelBeforeCb', roiLevelBeforeCbLo: 'edRoiLevelBeforeCbLo',
    roiLevelBeforeCbHi: 'edRoiLevelBeforeCbHi',
    roiLevelAfterCb: 'edRoiLevelAfterCb', roiLevelAfterCbLo: 'edRoiLevelAfterCbLo',
    roiLevelAfterCbHi: 'edRoiLevelAfterCbHi',
    roiLevelApply: 'edRoiLevelApply', roiLevelCancel: 'edRoiLevelCancel',
    histPanel: 'edHistPanel', histWrap: 'edHistWrap', histCanvas: 'edHistCanvas',
    histHandleLo: 'edHistHandleLo', histHandleHi: 'edHistHandleHi',
    histValLo: 'edHistValLo', histValHi: 'edHistValHi',
    histStats: 'edHistStats', histAxisMin: 'edHistAxisMin', histAxisMax: 'edHistAxisMax',
    histTip: 'edHistTip', histHoverLine: 'edHistHoverLine',
    histAuto: 'edDenoiseAuto', histApply: 'edDenoiseApply', histCancel: 'edDenoiseCancel',
    sendMenu: 'edSendMenu', sendWrap: 'edSendWrap', sendMenuPanel: 'edSendMenuPanel',
    sendToViewer: 'edSendToViewer', sendToAnalysis: 'edSendToAnalysis',
    sendToOverlayA: 'edSendToOverlayA', sendToOverlayB: 'edSendToOverlayB',
    undo: 'edUndo', redo: 'edRedo',
    btnCalc: 'edBtnCalc',
}, { editing: true });
setupColormapPicker(document.getElementById('edColormap'));


