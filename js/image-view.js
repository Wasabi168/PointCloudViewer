/**
 * 可重用影像檢視元件
 * 依賴：render.js, webgl-3d.js, colormap.js
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

    const SCATTER_R = 1;
    const st = {
        dataset: null,
        view: { scale: 1, tx: 0, ty: 0, minScale: 0.02, maxScale: 100 },
        colorClip: { lo: 0, hi: 1 },
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
            segLevel: false,
            segLevelBusy: false,
            segLevelTuneBusy: false,
            segLevelRunId: 0,
            segLevelTuneRunId: 0,
            segLevelBase: null,
            segLevelResult: null,
            segLevelViews: null,
            segLevelPan: null,
            segLevelShowBounds: true,
            segSkew: false,
            segSkewBusy: false,
            segSkewTuneBusy: false,
            segSkewRunId: 0,
            segSkewTuneRunId: 0,
            segSkewBase: null,
            segSkewResult: null,
            segSkewViews: null,
            segSkewPan: null,
            segSkewShowBounds: true,
            medianFilter: false,
            medianFilterBusy: false,
            medianFilterRunId: 0,
            medianFilterBase: null,
            medianFilterResult: null,
            medianFilterViews: null,
            medianFilterPan: null,
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
        const R = SCATTER_R;
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
            if (!Number.isFinite(v)) { px[po] = px[po + 1] = px[po + 2] = 0; px[po + 3] = 255; continue; }
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
            return;
        }
        canvas.style.transform = `translate(${st.view.tx}px, ${st.view.ty}px) scale(${st.view.scale})`;
        ind.textContent = (st.view.scale * 100).toFixed(st.view.scale >= 1 ? 0 : 1) + '%';
    }

    function fitImage() {
        if (!st.dataset) return;
        if (isScatter(st.dataset)) { fitScatter(st.dataset); renderScatter(st.dataset, el.colormap.value); applyTransform(); return; }
        const { w: vw, h: vh } = viewerSize();
        const w = st.dataset.width, h = st.dataset.height, padding = 24;
        const s = Math.min((vw - padding * 2) / w, (vh - padding * 2) / h, 8);
        st.view.scale = s > 0 ? s : 1;
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

    const EDITABLE_UNIT_KEYS = new Set(['xunit', 'yunit', 'zunit', 'x-unit', 'y-unit', 'z-unit']);
    const ALLOWED_HEADER_UNITS = new Set(['nm', 'um', 'mm', 'cm']);

    function normalizeHeaderUnitInput(raw) {
        return String(raw || '').trim().toLowerCase().replace(/µ/g, 'u').replace(/[\[\]]/g, '');
    }

    function isAllowedHeaderUnit(unit) {
        return ALLOWED_HEADER_UNITS.has(normalizeHeaderUnitInput(unit));
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
                if (!isAllowedHeaderUnit(normalized)) {
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
                valSpan.title = t('unitEditTitle');
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
            let result;
            switch (ext) {
                case 'bcrf': result = await readBcrf(file, setProgress); break;
                case 'asc':  result = await readAsc(file, setProgress); break;
                case 'tif':
                case 'tiff': result = await readTiff(file, setProgress); break;
                case 'pcd':  result = await readPcd(file, setProgress); break;
                case 'bmp':  result = await readBmp(file, setProgress); break;
                case 'png':  result = await readPng(file, setProgress); break;
                case 'jpg':
                case 'jpeg': result = await readJpg(file, setProgress); break;
                default: throw new Error(t('errUnknownExt', ext));
            }
            const rangeSrc = result.type === 'pcd-scatter' ? result.z : result.data;
            const { vmin, vmax } = computeRange(rangeSrc);
            st.dataset = { ...result, vmin, vmax, filename: file.name, canvasEl: el.canvas };
            resetColorClip(false);
            render(st.dataset, el.colormap.value, true);
            const infoExtra = result.type === 'pcd-scatter' ? { pointCount: result.pointCount } : null;
            renderInfo(result.header, result.width, result.height, infoExtra);
            if (result.type === 'pcd-scatter') el.status.textContent = t('statusLoadedPcd', file.name, result.pointCount);
            else el.status.textContent = t('statusLoaded', file.name, result.width, result.height);
            if (typeof editAfterLoad === 'function') editAfterLoad();
            if (el.btnClear) el.btnClear.disabled = false;
        } catch (err) {
            console.error(err);
            el.status.textContent = t('statusReadFailed', err.message);
            showToast(t('statusReadFailed', err.message), 'error');
        } finally {
            hideProgress();
            setBusy(edOpenLabel, false);
            if (el.btnSave) el.btnSave.disabled = false;
        }
    }

    /* ---- 儲存 ---- */
    const supportsSavePicker = (typeof window.showSaveFilePicker === 'function');
    if (supportsSavePicker && el.saveFormatItem) el.saveFormatItem.style.display = 'none';

    async function runSaveJob(format, writeFn, fullName) {
        el.btnSave.disabled = true;
        el.btnSave.textContent = t('btnSaving');
        setProgress(0);
        el.status.textContent = t('statusSaving', fullName);
        try {
            await writeFn();
            el.status.textContent = t('statusSaved', fullName);
            showToast(t('toastSaved', fullName), 'info');
        } catch (err) {
            console.error(err);
            el.status.textContent = t('statusSaveFailed', err.message);
            showToast(t('statusSaveFailed', err.message), 'error');
        } finally {
            hideProgress();
            el.btnSave.disabled = false;
            el.btnSave.textContent = t('btnSave');
        }
    }
    function fallbackSave(format, base) {
        const allowed = getAllowedSaveFormats(st.dataset);
        if (!allowed.includes(format)) { showToast(t('savePcdScatter'), 'info'); return; }
        const fullName = `${base}.${formatToExt(format)}`;
        return runSaveJob(format, () => saveAs(st.dataset, format, setProgress), fullName);
    }
    async function onSaveClick() {
        if (!st.dataset) { showToast(t('toastNoData'), 'error'); return; }
        const preferred = el.saveFormat.value;
        const allowed = getAllowedSaveFormats(st.dataset);
        const base = stripExt(st.dataset.filename || 'image');
        if (supportsSavePicker) {
            const defaultFormat = allowed.includes(preferred) ? preferred : allowed[0];
            let handle;
            try {
                handle = await window.showSaveFilePicker({
                    suggestedName: `${base}.${formatToExt(defaultFormat)}`,
                    types: buildPickerTypes(allowed, defaultFormat),
                });
            } catch (err) {
                if (err && err.name === 'AbortError') return;
                console.warn('showSaveFilePicker 失敗，改用下載方式：', err);
                return fallbackSave(defaultFormat, base);
            }
            const chosenExt = getExt(handle.name);
            const format = extToFormat(chosenExt) || defaultFormat;
            if (!allowed.includes(format)) { showToast(t('savePcdScatter'), 'info'); return; }
            const fullName = handle.name || `${base}.${formatToExt(format)}`;
            await runSaveJob(format, async () => {
                const blob = await buildSaveBlob(st.dataset, format, setProgress);
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
            }, fullName);
            return;
        }
        fallbackSave(preferred, base);
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
            else if (st.edit.segSkew) renderSegSkewCompare();
            else if (st.edit.medianFilter) renderMedianFilterCompare();
            else if (st.edit.nanPatch) renderNanPatchCompare();
            else render(st.dataset, el.colormap.value, false);
        }
    });
    if (el.saveFormat) {
        el.saveFormat.addEventListener('change', () => {
            setUserPref('edSaveFormat', el.saveFormat.value);
        });
    }
    el.btnSave.addEventListener('click', onSaveClick);
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

    el.canvas.addEventListener('mousedown', (e) => {
        if (!st.dataset || e.button !== 0) return;
        st.panning = true;
        st.panStart = { x: e.clientX, y: e.clientY, tx: st.view.tx, ty: st.view.ty, cx: st.sc.centerX, cy: st.sc.centerY };
        el.canvas.classList.add('grabbing');
        e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
        if (!st.panning) return;
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
    });

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

    function updateEditButtons() {
        if (!editing) return;
        const has = !!st.dataset;
        [el.cropRect, el.cropCircle, el.denoise, el.medianFilter, el.nanPatch, el.segLevel, el.segSkew, el.globalLevel, el.btnCalc, el.sendToViewer].forEach(b => { if (b) b.disabled = !has; });
        if (el.btnClear) el.btnClear.disabled = !has;
        if (el.cropApply) el.cropApply.disabled = !(has && st.edit.cropMode && st.edit.cropSel);
        if (el.cropCancel) el.cropCancel.disabled = !(has && st.edit.cropMode);
        if (el.segLevelApply) el.segLevelApply.disabled = !(has && st.edit.segLevel && !st.edit.segLevelBusy && !st.edit.segLevelTuneBusy && st.edit.segLevelResult);
        if (el.segLevelCancel) el.segLevelCancel.disabled = !(has && st.edit.segLevel);
        if (el.segLevelShowBounds) {
            el.segLevelShowBounds.disabled = !(has && st.edit.segLevel && !st.edit.segLevelBusy);
        }
        const segConfigLocked = !(has && st.edit.segLevel && !st.edit.segLevelBusy && !st.edit.segLevelTuneBusy && st.edit.segLevelResult);
        if (el.segLevelDir) el.segLevelDir.disabled = segConfigLocked;
        if (el.segLevelCount) el.segLevelCount.disabled = segConfigLocked;
        if (el.segSkewApply) el.segSkewApply.disabled = !(has && st.edit.segSkew && !st.edit.segSkewBusy && !st.edit.segSkewTuneBusy && st.edit.segSkewResult);
        if (el.segSkewCancel) el.segSkewCancel.disabled = !(has && st.edit.segSkew);
        if (el.segSkewShowBounds) {
            el.segSkewShowBounds.disabled = !(has && st.edit.segSkew && !st.edit.segSkewBusy);
        }
        const segSkewConfigLocked = !(has && st.edit.segSkew && !st.edit.segSkewBusy && !st.edit.segSkewTuneBusy && st.edit.segSkewResult);
        if (el.segSkewDir) el.segSkewDir.disabled = segSkewConfigLocked;
        if (el.segSkewCount) el.segSkewCount.disabled = segSkewConfigLocked;
        if (el.medianFilterApply) el.medianFilterApply.disabled = !(has && st.edit.medianFilter && !st.edit.medianFilterBusy && st.edit.medianFilterResult);
        if (el.medianFilterCancel) el.medianFilterCancel.disabled = !(has && st.edit.medianFilter);
        const medianFilterConfigLocked = !(has && st.edit.medianFilter && !st.edit.medianFilterBusy && st.edit.medianFilterResult);
        if (el.medianFilterKernel) el.medianFilterKernel.disabled = medianFilterConfigLocked;
        if (el.nanPatchApply) el.nanPatchApply.disabled = !(has && st.edit.nanPatch && !st.edit.nanPatchBusy && st.edit.nanPatchResult);
        if (el.nanPatchCancel) el.nanPatchCancel.disabled = !(has && st.edit.nanPatch);
        const nanPatchConfigLocked = !(has && st.edit.nanPatch && !st.edit.nanPatchBusy && st.edit.nanPatchResult);
        if (el.nanPatchKernel) el.nanPatchKernel.disabled = nanPatchConfigLocked;
        updateHistoryButtons();
    }

    function clearData() {
        if (!st.dataset) return;
        if (editing) endTransientModes();
        st.dataset = null;
        st.colorClip.lo = 0;
        st.colorClip.hi = 1;
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
        if (editing) updateEditButtons();
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
        } else {
            ds.data = snap.data.slice(0);
        }
        st.colorClip.lo = snap.colorClip.lo; st.colorClip.hi = snap.colorClip.hi;
        render(ds, el.colormap.value, true);
        const infoExtra = isScatter(ds) ? { pointCount: ds.pointCount } : null;
        renderInfo(ds.header, ds.width, ds.height, infoExtra);
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
        if (st.edit.nanPatch) cancelNanPatch();
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
            : 8;
        return { ...opts, maxBands: Math.max(2, maxBands) };
    }

    function setSegLevelConfigUI(visible) {
        if (el.segLevelConfig) el.segLevelConfig.setAttribute('aria-hidden', visible ? 'false' : 'true');
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
        const maxBands = limits ? limits.maxBands : 8;
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

    function segLevelFmt(v) {
        if (!Number.isFinite(v)) return '-';
        const a = Math.abs(v);
        if (a >= 1000 || (a > 0 && a < 0.001)) return v.toExponential(2);
        return v.toFixed(2);
    }

    /** 水平分割 → 中央垂直剖線；垂直分割 → 中央水平剖線 */
    function segLevelExtractProfile(data, width, height, direction) {
        const vals = [];
        if (direction === 'horizontal') {
            const x = width >> 1;
            for (let y = 0; y < height; y++) vals.push(data[y * width + x]);
        } else {
            const y = height >> 1;
            const rowBase = y * width;
            for (let x = 0; x < width; x++) vals.push(data[rowBase + x]);
        }
        return vals;
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
    }

    function segLevelContentSize(canvas) {
        const cw = parseFloat(canvas.style.width) || canvas.clientWidth || canvas.width;
        const ch = parseFloat(canvas.style.height) || canvas.clientHeight || canvas.height;
        return { cw: Math.max(1, cw), ch: Math.max(1, ch) };
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
            }, { passive: false });

            t.wrap.addEventListener('mousedown', (e) => {
                if (!st.edit.segLevel || st.edit.segLevelBusy || e.button !== 0) return;
                const views = segLevelEnsureViews();
                const view = views[t.key];
                st.edit.segLevelPan = {
                    key: t.key,
                    wrap: t.wrap,
                    canvas: t.canvas,
                    startX: e.clientX,
                    startY: e.clientY,
                    tx: view.tx,
                    ty: view.ty,
                };
                t.wrap.classList.add('grabbing');
                e.preventDefault();
            });

            t.wrap.addEventListener('dblclick', (e) => {
                if (!st.edit.segLevel || st.edit.segLevelBusy) return;
                e.preventDefault();
                const views = segLevelEnsureViews();
                const view = views[t.key];
                segLevelFitView(view, t.wrap, view.contentW, view.contentH);
                segLevelApplyViewTransform(t.canvas, view, t.wrap);
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
            });
            window.addEventListener('mouseup', () => {
                const pan = st.edit.segLevelPan;
                if (!pan) return;
                pan.wrap.classList.remove('grabbing');
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

    function renderSegLevelProfileChart(canvas, vals, cmin, crange, direction, boundaries, bandFits, axisScale, zoomKey, resetView) {
        if (!canvas || !vals || !vals.length) {
            clearSegLevelProfileCanvas(canvas);
            return;
        }
        const wrap = canvas.parentElement;
        const cw = Math.max(1, wrap?.clientWidth || canvas.clientWidth || 200);
        const ch = Math.max(1, wrap?.clientHeight || canvas.clientHeight || 100);
        const dpr = window.devicePixelRatio || 1;
        const bw = Math.max(1, Math.round(cw * dpr));
        const bh = Math.max(1, Math.round(ch * dpr));
        canvas.width = bw;
        canvas.height = bh;
        canvas.style.width = cw + 'px';
        canvas.style.height = ch + 'px';
        canvas.setAttribute('aria-hidden', 'false');

        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cw, ch);

        const padL = 48, padR = 8, padT = 8, padB = 22;
        const plotW = Math.max(1, cw - padL - padR);
        const plotH = Math.max(1, ch - padT - padB);
        const x0 = padL, y0 = padT;
        const cmax = cmin + crange;
        const yRange = crange || 1e-12;
        const n = vals.length;
        const distPx = Math.max(1, n - 1);

        ctx.fillStyle = 'rgba(255,255,255,0.03)';
        ctx.fillRect(x0, y0, plotW, plotH);

        ctx.font = '10px Consolas, monospace';
        ctx.lineWidth = 1;

        const yticks = 4;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (let i = 0; i <= yticks; i++) {
            const tt = i / yticks;
            const py = y0 + plotH * tt;
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.beginPath();
            ctx.moveTo(x0, py);
            ctx.lineTo(x0 + plotW, py);
            ctx.stroke();
            const val = cmax - yRange * tt;
            ctx.fillStyle = '#9a9ab0';
            ctx.fillText(segLevelFmt(val), x0 - 5, py);
        }

        const xticks = 4;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const axisX = direction === 'horizontal' ? t('segLevelProfileAxisY') : t('segLevelProfileAxisX');
        for (let i = 0; i <= xticks; i++) {
            const tt = i / xticks;
            const px = x0 + plotW * tt;
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.beginPath();
            ctx.moveTo(px, y0);
            ctx.lineTo(px, y0 + plotH);
            ctx.stroke();
            ctx.fillStyle = '#9a9ab0';
            ctx.fillText(String(Math.round(distPx * tt)), px, y0 + plotH + 4);
        }
        ctx.fillStyle = '#7a7a94';
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
        segLevelSyncViewTransform(zoomKey, canvas, resetView);
    }

    function renderSegLevelPaneColorbar(canvas, loEl, hiEl, vmin, vmax, cmap, clip) {
        if (!canvas) return;
        const dr = segLevelDisplayRange(vmin, vmax, clip);
        const wrap = canvas.parentElement;
        const cssH = Math.max(72, (wrap?.clientHeight || 120) - 36);
        const cssW = 14;
        const dpr = window.devicePixelRatio || 1;
        const bw = Math.max(1, Math.round(cssW * dpr));
        const bh = Math.max(1, Math.round(cssH * dpr));
        canvas.width = bw;
        canvas.height = bh;
        canvas.style.width = cssW + 'px';
        canvas.style.height = cssH + 'px';

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
        if (hiEl) hiEl.textContent = segLevelFmt(dr.cmax);
        if (loEl) loEl.textContent = segLevelFmt(dr.cmin);
    }

    function renderSegLevelCanvas(canvas, data, width, height, cmin, crange, cmap, direction, boundaries, drawBounds, drawProfileLine, zoomKey, resetView) {
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
                    px[po] = px[po + 1] = px[po + 2] = 0;
                    px[po + 3] = 255;
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

        if (drawProfileLine) {
            ctx.save();
            ctx.strokeStyle = 'rgba(120, 220, 255, 0.92)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 4]);
            if (direction === 'horizontal') {
                const lx = (width >> 1) + 0.5;
                ctx.beginPath();
                ctx.moveTo(lx, 0);
                ctx.lineTo(lx, ch);
                ctx.stroke();
            } else {
                const ly = (height >> 1) + 0.5;
                ctx.beginPath();
                ctx.moveTo(0, ly);
                ctx.lineTo(cw, ly);
                ctx.stroke();
            }
            ctx.restore();
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
        const beforeDr = segLevelDisplayRange(base.vmin, base.vmax, st.colorClip);
        const afterDr = segLevelDisplayRange(afterStats.vmin, afterStats.vmax, st.colorClip);
        const direction = result.direction;
        const boundaries = result.boundaries;

        renderSegLevelCanvas(
            el.segLevelBefore, base.data, width, height,
            beforeDr.cmin, beforeDr.crange, cmap, direction, boundaries, true, true,
            'beforeImg', resetView,
        );
        renderSegLevelCanvas(
            el.segLevelAfter, afterData, width, height,
            afterDr.cmin, afterDr.crange, cmap, direction, boundaries, true, true,
            'afterImg', resetView,
        );

        renderSegLevelPaneColorbar(
            el.segLevelBeforeCb, el.segLevelBeforeCbLo, el.segLevelBeforeCbHi,
            base.vmin, base.vmax, cmap, st.colorClip,
        );
        renderSegLevelPaneColorbar(
            el.segLevelAfterCb, el.segLevelAfterCbLo, el.segLevelAfterCbHi,
            afterStats.vmin, afterStats.vmax, cmap, st.colorClip,
        );

        const beforeProfile = segLevelExtractProfile(base.data, width, height, direction);
        const afterProfile = segLevelExtractProfile(afterData, width, height, direction);
        const axisScale = result.plan && result.plan.axisScale;
        const beforeSplits = segLevelProfileSplits(result, boundaries, beforeProfile.length);
        const afterSplits = segLevelProfileSplits(result, boundaries, afterProfile.length);
        const chartBoundaries = segLevelProfileBoundaries(beforeSplits);
        const beforeBandFits = segLevelProfileBandFits(beforeProfile, beforeSplits, axisScale);
        const afterBandFits = segLevelProfileBandFits(afterProfile, afterSplits, axisScale);
        renderSegLevelProfileChart(
            el.segLevelBeforeProfile, beforeProfile,
            beforeDr.cmin, beforeDr.crange, direction, chartBoundaries,
            beforeBandFits, axisScale, 'beforeProfile', resetView,
        );
        renderSegLevelProfileChart(
            el.segLevelAfterProfile, afterProfile,
            afterDr.cmin, afterDr.crange, direction, chartBoundaries,
            afterBandFits, axisScale, 'afterProfile', resetView,
        );

        syncSegLevelConfigUI();
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
        const afterDr = segLevelDisplayRange(afterStats.vmin, afterStats.vmax, st.colorClip);
        const direction = result.direction;
        const boundaries = result.boundaries;

        renderSegLevelCanvas(
            el.segLevelAfter, afterData, width, height,
            afterDr.cmin, afterDr.crange, cmap, direction, boundaries, true, true,
            'afterImg', false,
        );
        renderSegLevelPaneColorbar(
            el.segLevelAfterCb, el.segLevelAfterCbLo, el.segLevelAfterCbHi,
            afterStats.vmin, afterStats.vmax, cmap, st.colorClip,
        );
        const afterProfile = segLevelExtractProfile(afterData, width, height, direction);
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
        updateEditButtons();
    }

    async function recomputeSegLevelPreview(options) {
        const base = st.edit.segLevelBase;
        const result = st.edit.segLevelResult;
        if (!base || !result || !result.plan || !st.dataset) return;
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
                    undefined,
                    () => tuneRunId !== st.edit.segLevelTuneRunId,
                );
                if (!out || tuneRunId !== st.edit.segLevelTuneRunId) return;
                result.correctedData = out;
            } else {
                result.correctedData = applySegmentLevelPlan(
                    base.data, width, height, result.plan, result.tiltK, outBuf,
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
        if (!st.edit.segLevel || st.edit.segLevelBusy || st.edit.segLevelTuneBusy || !st.edit.segLevelResult) return;
        recomputeSegLevelWithConfig({ resetView: true });
    }

    function onSegLevelCountKeydown(e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (e.target && typeof e.target.blur === 'function') e.target.blur();
        onSegLevelConfigChange();
    }

    function enterSegLevelUI(active) {
        if (el.viewer) el.viewer.classList.toggle('seg-level-active', active);
        if (el.segLevelPanel) el.segLevelPanel.setAttribute('aria-hidden', active ? 'false' : 'true');
        if (el.segLevel) el.segLevel.classList.toggle('tool-active', active);
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
        st.edit.segLevelShowBounds = true;
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
        st.edit.segLevel = true;
        st.edit.segLevelShowBounds = true;
        st.edit.segLevelBusy = true;
        st.edit.segLevelResult = null;
        const runId = ++st.edit.segLevelRunId;

        enterSegLevelUI(true);
        syncSegLevelBoundsToggle();
        setSegLevelBusyUI(true, 0);
        setSegLevelTuneUI(false);
        setSegLevelConfigUI(false);
        if (st.edit.segLevelBase && st.dataset) {
            const { data, vmin, vmax } = st.edit.segLevelBase;
            const dr = segLevelDisplayRange(vmin, vmax, st.colorClip);
            renderSegLevelCanvas(
                el.segLevelBefore, data, st.dataset.width, st.dataset.height,
                dr.cmin, dr.crange, el.colormap.value, 'horizontal', [], false, false,
                'beforeImg', true,
            );
            renderSegLevelPaneColorbar(
                el.segLevelBeforeCb, el.segLevelBeforeCbLo, el.segLevelBeforeCbHi,
                vmin, vmax, el.colormap.value, st.colorClip,
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
                const reason = analysis.reason;
                if (reason !== 'cancelled') {
                    if (reason === 'scatter') showToast(t('segLevelScatter'), 'info');
                    else if (reason === 'tooSmall') showToast(t('segLevelTooSmall'), 'error');
                    else showToast(t('segLevelInsufficient'), 'error');
                }
                st.edit.segLevelBase = null;
                exitSegLevelMode();
                if (st.dataset) {
                    el.status.textContent = t('statusLoaded', st.dataset.filename, st.dataset.width, st.dataset.height);
                }
                return;
            }

            st.edit.segLevelResult = analysis;
            st.edit.segLevelBusy = false;
            setSegLevelBusyUI(false);
            setSegLevelConfigUI(true);
            buildSegLevelTuneUI(analysis);
            renderSegLevelCompare({ resetView: true });
            updateEditButtons();
            el.status.textContent = segLevelStatusText(analysis);
        } catch (err) {
            console.error(err);
            if (runId === st.edit.segLevelRunId) {
                showToast(String(err.message || err), 'error');
                exitSegLevelMode();
            }
        }
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
            : 8;
        return { ...opts, maxBands: Math.max(2, maxBands) };
    }

    function setSegSkewConfigUI(visible) {
        if (el.segSkewConfig) el.segSkewConfig.setAttribute('aria-hidden', visible ? 'false' : 'true');
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
        const maxBands = limits ? limits.maxBands : 8;
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
                st.edit.segSkewPan = {
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
                if (!st.edit.segSkew || st.edit.segSkewBusy) return;
                e.preventDefault();
                const views = segSkewEnsureViews();
                const view = views[tgt.key];
                segLevelFitView(view, tgt.wrap, view.contentW, view.contentH);
                segLevelApplyViewTransform(tgt.canvas, view, tgt.wrap);
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
            });
            window.addEventListener('mouseup', () => {
                const pan = st.edit.segSkewPan;
                if (!pan) return;
                pan.wrap.classList.remove('grabbing');
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
                    px[po] = px[po + 1] = px[po + 2] = 0;
                    px[po + 3] = 255;
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

    function syncSegSkewShiftInput() {
        const result = st.edit.segSkewResult;
        if (!result || !el.segSkewTuneShift) return;
        el.segSkewTuneShift.value = String(result.shiftPx);
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
            if (typeof applySegmentSkewAsync === 'function') {
                const out = await applySegmentSkewAsync(
                    base.data, width, height, result.direction, result.boundaries, result.shiftPx,
                    outBuf, 64, () => tuneRunId !== st.edit.segSkewTuneRunId,
                );
                if (!out || tuneRunId !== st.edit.segSkewTuneRunId) return;
                result.correctedData = out;
            } else {
                result.correctedData = applySegmentSkew(
                    base.data, width, height, result.direction, result.boundaries, result.shiftPx, outBuf,
                );
            }
            renderSegSkewAfterOnly();
            el.status.textContent = segSkewStatusText(result);
        } finally {
            if (tuneRunId === st.edit.segSkewTuneRunId) setSegSkewTuneBusyUI(false);
        }
    }

    function commitSegSkewTune() {
        if (!st.edit.segSkew || st.edit.segSkewBusy || st.edit.segSkewTuneBusy) return;
        readSegSkewShiftFromUI();
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
        syncSegSkewShiftInput();
    }

    function resetSegSkewShift() {
        const result = st.edit.segSkewResult;
        if (!result || !Number.isFinite(result.autoShiftPx) || st.edit.segSkewTuneBusy) return;
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
            const analysis = await analyzeSegmentSkewWithParamsAsync(
                st.dataset,
                direction,
                segmentCount,
                undefined,
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
        if (!st.edit.segSkew || st.edit.segSkewBusy || st.edit.segSkewTuneBusy || !st.edit.segSkewResult) return;
        recomputeSegSkewWithConfig({ resetView: true });
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
        st.edit.segSkewShowBounds = true;
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
        st.edit.segSkewShowBounds = true;
        st.edit.segSkewBusy = true;
        st.edit.segSkewResult = null;
        const runId = ++st.edit.segSkewRunId;

        enterSegSkewUI(true);
        syncSegSkewBoundsToggle();
        setSegSkewBusyUI(true, 0);
        setSegSkewTuneUI(false);
        setSegSkewConfigUI(false);
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
        el.status.textContent = t('segSkewAnalyzing');

        await segLevelYield();

        try {
            const analysis = await analyzeSegmentSkewAsync(
                st.dataset,
                (p) => {
                    if (runId !== st.edit.segSkewRunId) return;
                    setSegSkewBusyUI(true, p);
                },
                () => runId !== st.edit.segSkewRunId,
            );

            if (runId !== st.edit.segSkewRunId) return;

            if (!analysis.ok) {
                const reason = analysis.reason;
                if (reason !== 'cancelled') {
                    if (reason === 'scatter') showToast(t('segSkewScatter'), 'info');
                    else if (reason === 'tooSmall') showToast(t('segSkewTooSmall'), 'error');
                    else showToast(t('segSkewInsufficient'), 'error');
                }
                st.edit.segSkewBase = null;
                exitSegSkewMode();
                if (st.dataset) {
                    el.status.textContent = t('statusLoaded', st.dataset.filename, st.dataset.width, st.dataset.height);
                }
                return;
            }

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
            if (runId === st.edit.segSkewRunId) {
                showToast(String(err.message || err), 'error');
                exitSegSkewMode();
            }
        }
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
                    px[po] = px[po + 1] = px[po + 2] = 0;
                    px[po + 3] = 255;
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
                    px[po] = px[po + 1] = px[po + 2] = 0;
                    px[po + 3] = 255;
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

    /* 複製目前資料集（深拷貝陣列、移除畫布參照）以便安全傳送到檢視器 */
    function sendToViewer() {
        if (!st.dataset) { showToast(t('sendNoData'), 'info'); return; }
        if (st.edit.denoise) toggleDenoise(false); // 先套用雜點篩除結果
        if (st.edit.segLevel) cancelSegLevel();
        if (st.edit.segSkew) cancelSegSkew();
        if (st.edit.medianFilter) cancelMedianFilter();
        if (st.edit.nanPatch) cancelNanPatch();
        const clone = cloneDatasetForTransfer(st.dataset);
        // 先切到檢視器頁面，讓畫布有正確尺寸後再載入，避免 fit 計算到 0
        if (typeof switchPage === 'function') switchPage('viewer');
        if (typeof loadDatasetIntoViewer === 'function' && loadDatasetIntoViewer(clone)) {
            showToast(t('sentToViewer'), 'info');
        }
    }

    function loadDataset(ds, opts) {
        opts = opts || {};
        if (!ds) return false;
        const rangeSrc = ds.type === 'pcd-scatter' ? ds.z : ds.data;
        const { vmin, vmax } = computeRange(rangeSrc);
        st.dataset = { ...ds, vmin, vmax, canvasEl: el.canvas };
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
        if (st.edit.nanPatch) cancelNanPatch();
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

    function renderHist() {
        if (!histData) return;
        const cv = el.histCanvas, wrap = el.histWrap;
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(1, wrap.clientWidth), h = Math.max(1, wrap.clientHeight);
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
        // 更新標籤位置與文字
        el.histHandleLo.style.left = (lo * 100) + '%';
        el.histHandleHi.style.left = (hi * 100) + '%';
        el.histValLo.textContent = histValAt(lo).toFixed(3);
        el.histValHi.textContent = histValAt(hi).toFixed(3);
        el.histAxisMin.textContent = histData.vmin.toFixed(3);
        el.histAxisMax.textContent = histData.vmax.toFixed(3);
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
            if (st.edit.nanPatch) cancelNanPatch();
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
            scheduleDenoise();
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
        if (st.edit.nanPatch) exitNanPatchMode();
        resetHistory();          // 以新載入的資料作為歷史起點
        updateEditButtons();
    }

    if (editing) {
        setupCropOverlay();
        setupHistHandles();
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
        if (el.segLevelShowBounds) el.segLevelShowBounds.addEventListener('change', onSegLevelBoundsToggle);
        if (el.segLevelDir) el.segLevelDir.addEventListener('change', onSegLevelConfigChange);
        if (el.segLevelCount) {
            el.segLevelCount.addEventListener('change', onSegLevelConfigChange);
            el.segLevelCount.addEventListener('keydown', onSegLevelCountKeydown);
        }
        setupSegLevelZoom();
        if (el.segSkew) el.segSkew.addEventListener('click', startSegSkewMode);
        if (el.segSkewApply) el.segSkewApply.addEventListener('click', applySegSkew);
        if (el.segSkewCancel) el.segSkewCancel.addEventListener('click', cancelSegSkew);
        if (el.segSkewTuneShift) el.segSkewTuneShift.addEventListener('keydown', onSegSkewTuneKeydown);
        if (el.segSkewTuneReset) el.segSkewTuneReset.addEventListener('click', resetSegSkewShift);
        if (el.segSkewShowBounds) el.segSkewShowBounds.addEventListener('change', onSegSkewBoundsToggle);
        if (el.segSkewDir) el.segSkewDir.addEventListener('change', onSegSkewConfigChange);
        if (el.segSkewCount) {
            el.segSkewCount.addEventListener('change', onSegSkewConfigChange);
            el.segSkewCount.addEventListener('keydown', onSegSkewCountKeydown);
        }
        setupSegSkewZoom();
        if (el.medianFilter) el.medianFilter.addEventListener('click', startMedianFilterMode);
        if (el.medianFilterApply) el.medianFilterApply.addEventListener('click', applyMedianFilterEdit);
        if (el.medianFilterCancel) el.medianFilterCancel.addEventListener('click', cancelMedianFilter);
        if (el.medianFilterKernel) el.medianFilterKernel.addEventListener('change', onMedianFilterKernelChange);
        setupMedianFilterZoom();
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
        if (el.globalLevel) el.globalLevel.addEventListener('click', applyGlobalLeveling);
        if (el.histAuto) el.histAuto.addEventListener('click', () => autoDenoiseBounds());
        if (el.histApply) el.histApply.addEventListener('click', () => toggleDenoise(false));
        if (el.sendToViewer) el.sendToViewer.addEventListener('click', sendToViewer);
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
            if (st.edit.segSkew) renderSegSkewCompare({ resetView: true });
            if (st.edit.medianFilter) renderMedianFilterCompare({ resetView: true });
            if (st.edit.nanPatch) renderNanPatchCompare({ resetView: true });
        });
        updateEditButtons();
    }

    /* 初始繪製空色階列 */
    renderColorbar(el.colormap.value);
    setupColorbarHandles();

    return {
        loadFile,
        loadDataset,
        loadDatasetAsync,
        hasData: () => !!st.dataset,
        canUseCalc: () => !!st.dataset && !isScatter(st.dataset),
        applyCalc,
        getDataset: () => st.dataset ? cloneDatasetForTransfer(st.dataset) : null,
        getDatasetSignature: () => st.dataset ? getDatasetSignature(st.dataset) : null,
        getLastEditStep: () => st.edit.lastEditStep,
        clearLastEditStep: () => { setLastEditStep(null); },
        refit: () => {
            if (st.dataset && el.viewer.clientWidth > 0) {
                fitImage();
                if (st.edit.denoise) renderHist();
                if (st.edit.segLevel) renderSegLevelCompare({ resetView: true });
                if (st.edit.segSkew) renderSegSkewCompare({ resetView: true });
                if (st.edit.medianFilter) renderMedianFilterCompare({ resetView: true });
                if (st.edit.nanPatch) renderNanPatchCompare({ resetView: true });
            }
        },
        syncLang: () => {
            const ds = st.dataset;
            if (!ds) el.status.textContent = t('statusIdle');
            else if (ds.type === 'pcd-scatter') el.status.textContent = t('statusLoadedPcd', ds.filename, ds.pointCount);
            else el.status.textContent = t('statusLoaded', ds.filename, ds.width, ds.height);
            if (!el.btnSave.disabled) el.btnSave.textContent = t('btnSave');
            if (el.btnClear) {
                el.btnClear.textContent = t('btnClear');
                el.btnClear.title = t('btnClearTitle');
            }
        },
        clearData,
    };
}

/* 建立「點雲編輯器」的影像檢視實例 */
const editorView = createImageView({
    viewer: 'edViewer', canvas: 'edCanvas', placeholder: 'edPlaceholder',
    zoomIndicator: 'edZoomIndicator', zoomHint: 'edZoomHint',
    dropIcon: 'edDropIcon', dropText: 'edDropText',
    fileInput: 'edFileInput', colormap: 'edColormap',
    btnSave: 'edBtnSave', saveFormat: 'edSaveFormat', saveFormatItem: 'edSaveFormatItem',
    btnClear: 'edBtnClear',
    progress: 'edProgress', progressBar: 'edProgressBar', status: 'edStatus', infoList: 'edInfoList',
    colorbarCanvas: 'edColorbarCanvas', colorbarTrack: 'edColorbarTrack',
    cbHandleLo: 'edCbHandleLo', cbHandleHi: 'edCbHandleHi',
    cbValLo: 'edCbValLo', cbValHi: 'edCbValHi', cbReset: 'edCbReset',
    zMin: 'edZMin', zMax: 'edZMax',
    cropRect: 'edCropRect', cropCircle: 'edCropCircle', cropApply: 'edCropApply',
    cropCancel: 'edCropCancel', cropOverlay: 'edCropOverlay', cropShape: 'edCropShape',
    cropHint: 'edCropHint', denoise: 'edDenoise', medianFilter: 'edMedianFilter', nanPatch: 'edNanPatch',
    segLevel: 'edSegLevel',
    segLevelPanel: 'edSegLevelPanel', segLevelConfig: 'edSegLevelConfig',
    segLevelDir: 'edSegLevelDir', segLevelCount: 'edSegLevelCount',
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
    segLevelTuneBusy: 'edSegLevelTuneBusy', segLevelTuneBusyText: 'edSegLevelTuneBusyText',
    segLevelShowBounds: 'edSegLevelShowBounds', segLevelBoundsWrap: 'edSegLevelBoundsWrap',
    segLevelApply: 'edSegLevelApply', segLevelCancel: 'edSegLevelCancel',
    segSkew: 'edSegSkew',
    segSkewPanel: 'edSegSkewPanel', segSkewConfig: 'edSegSkewConfig',
    segSkewDir: 'edSegSkewDir', segSkewCount: 'edSegSkewCount',
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
    globalLevel: 'edGlobalLevel',
    histPanel: 'edHistPanel', histWrap: 'edHistWrap', histCanvas: 'edHistCanvas',
    histHandleLo: 'edHistHandleLo', histHandleHi: 'edHistHandleHi',
    histValLo: 'edHistValLo', histValHi: 'edHistValHi',
    histStats: 'edHistStats', histAxisMin: 'edHistAxisMin', histAxisMax: 'edHistAxisMax',
    histAuto: 'edDenoiseAuto', histApply: 'edDenoiseApply',
    sendToViewer: 'edSendToViewer', undo: 'edUndo', redo: 'edRedo',
    btnCalc: 'edBtnCalc',
}, { editing: true });
setupColormapPicker(document.getElementById('edColormap'));


