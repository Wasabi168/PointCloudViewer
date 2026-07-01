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
        if (st.dataset) render(st.dataset, el.colormap.value, false);
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
        [el.cropRect, el.cropCircle, el.denoise, el.globalLevel, el.btnCalc, el.sendToViewer].forEach(b => { if (b) b.disabled = !has; });
        if (el.btnClear) el.btnClear.disabled = !has;
        if (el.cropApply) el.cropApply.disabled = !(has && st.edit.cropMode && st.edit.cropSel);
        if (el.cropCancel) el.cropCancel.disabled = !(has && st.edit.cropMode);
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

    /** 全域水平校正：扣除最佳擬合平面 */
    function applyGlobalLeveling() {
        if (!editing || !st.dataset) { showToast(t('editNoData'), 'info'); return; }
        endTransientModes();
        const acc = planeFitAccessors(st.dataset);
        const plane = fitPlaneLeastSquares(acc);
        if (!plane) { showToast(t('globalLevelInsufficient'), 'info'); return; }
        const { a, b, c, n } = plane;
        const ds = st.dataset;
        if (isScatter(ds)) {
            const z = ds.z;
            for (let i = 0; i < z.length; i++) {
                if (!acc.isValid(i)) continue;
                z[i] -= a * ds.x[i] + b * ds.y[i] + c;
            }
        } else {
            ensureFloatPixels(ds);
            const data = ds.data;
            for (let i = 0; i < data.length; i++) {
                if (!acc.isValid(i)) continue;
                data[i] -= a * acc.getX(i) + b * acc.getY(i) + c;
            }
        }
        refreshAfterEdit(false);
        pushHistory();
        setLastEditStep({ type: 'globalLevel' });
        el.status.textContent = t('globalLevelDone', n);
        showToast(t('globalLevelDone', n), 'info');
    }

    /* 複製目前資料集（深拷貝陣列、移除畫布參照）以便安全傳送到檢視器 */
    function sendToViewer() {
        if (!st.dataset) { showToast(t('sendNoData'), 'info'); return; }
        if (st.edit.denoise) toggleDenoise(false); // 先套用雜點篩除結果
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
    function normSel(s) {
        return {
            x0: Math.min(s.x0, s.x1), y0: Math.min(s.y0, s.y1),
            x1: Math.max(s.x0, s.x1), y1: Math.max(s.y0, s.y1),
        };
    }
    function drawCropShape() {
        const sh = el.cropShape; if (!sh) return;
        const s = st.edit.cropSel;
        if (!s) { sh.style.display = 'none'; return; }
        const n = normSel(s);
        sh.style.display = 'block';
        sh.style.left = n.x0 + 'px';
        sh.style.top = n.y0 + 'px';
        sh.style.width = (n.x1 - n.x0) + 'px';
        sh.style.height = (n.y1 - n.y0) + 'px';
    }
    // 各控點對應要調整的邊
    const CROP_HRES = {
        nw: { x: 'x0', y: 'y0' }, n: { y: 'y0' }, ne: { x: 'x1', y: 'y0' },
        e: { x: 'x1' }, se: { x: 'x1', y: 'y1' }, s: { y: 'y1' },
        sw: { x: 'x0', y: 'y1' }, w: { x: 'x0' },
    };
    const CROP_MIN = 4;
    function setupCropOverlay() {
        const ov = el.cropOverlay; if (!ov) return;
        const ptInViewer = (e) => {
            const r = el.viewer.getBoundingClientRect();
            return {
                x: Math.min(r.width, Math.max(0, e.clientX - r.left)),
                y: Math.min(r.height, Math.max(0, e.clientY - r.top)),
            };
        };
        ov.addEventListener('pointerdown', (e) => {
            if (!st.edit.cropMode || !st.dataset) return;
            e.preventDefault();
            ov.setPointerCapture(e.pointerId);
            const p = ptInViewer(e);
            const handle = (e.target && e.target.classList && e.target.classList.contains('crop-handle'))
                ? e.target.getAttribute('data-h') : null;
            if (handle && st.edit.cropSel) {
                // 調整大小 / 形狀
                st.edit.cropSel = normSel(st.edit.cropSel);
                st.edit.cropAction = { type: 'resize', handle };
            } else if (st.edit.cropSel && e.target === el.cropShape) {
                // 移動整個框
                st.edit.cropSel = normSel(st.edit.cropSel);
                st.edit.cropAction = { type: 'move', start: p, orig: { ...st.edit.cropSel } };
            } else {
                // 在空白處拉出新的框
                st.edit.cropAction = { type: 'draw' };
                st.edit.cropSel = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
            }
            drawCropShape();
        });
        ov.addEventListener('pointermove', (e) => {
            const act = st.edit.cropAction; if (!act) return;
            const p = ptInViewer(e);
            const s = st.edit.cropSel;
            const vw = el.viewer.clientWidth, vh = el.viewer.clientHeight;
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
            drawCropShape();
        });
        const endAction = (e) => {
            const act = st.edit.cropAction; if (!act) return;
            st.edit.cropAction = null;
            try { ov.releasePointerCapture(e.pointerId); } catch (_) {}
            if (st.edit.cropSel) {
                const s = normSel(st.edit.cropSel);
                // 拉出的新框過小則視為取消
                if (act.type === 'draw' && (s.x1 - s.x0 < CROP_MIN || s.y1 - s.y0 < CROP_MIN)) {
                    st.edit.cropSel = null;
                } else {
                    st.edit.cropSel = s;
                }
                drawCropShape();
            }
            updateEditButtons();
        };
        ov.addEventListener('pointerup', endAction);
        ov.addEventListener('pointercancel', endAction);
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
    let histData = null, histRaf = false;

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
        scheduleDenoise();
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

    function applyDenoiseFilter() {
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
            // 維持色彩與視埠穩定：沿用快照範圍
            ds.vmin = base.vmin; ds.vmax = base.vmax;
            render(ds, el.colormap.value, false);
        } else {
            const bd = base.data, d = ds.data;
            for (let i = 0; i < bd.length; i++) {
                const v = bd[i];
                if (Number.isFinite(v) && v >= loV && v <= hiV) { d[i] = v; keep++; }
                else d[i] = NaN;
            }
            ds.vmin = base.vmin; ds.vmax = base.vmax;
            render(ds, el.colormap.value, false);
        }
        if (el.histStats) el.histStats.textContent = keep + ' / ' + histData.total;
    }

    function scheduleDenoise() {
        renderHist();
        if (histRaf) return;
        histRaf = true;
        requestAnimationFrame(() => { histRaf = false; applyDenoiseFilter(); });
    }

    function toggleDenoise(force) {
        if (!editing) return;
        const want = (typeof force === 'boolean') ? force : !st.edit.denoise;
        if (want && !st.dataset) { showToast(t('editNoData'), 'info'); return; }
        if (want) {
            if (st.edit.cropMode) exitCrop();
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
        window.addEventListener('resize', () => { if (st.edit.denoise) renderHist(); });
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
        refit: () => { if (st.dataset && el.viewer.clientWidth > 0) { fitImage(); if (st.edit.denoise) renderHist(); } },
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
    cropHint: 'edCropHint', denoise: 'edDenoise', globalLevel: 'edGlobalLevel',
    histPanel: 'edHistPanel', histWrap: 'edHistWrap', histCanvas: 'edHistCanvas',
    histHandleLo: 'edHistHandleLo', histHandleHi: 'edHistHandleHi',
    histValLo: 'edHistValLo', histValHi: 'edHistValHi',
    histStats: 'edHistStats', histAxisMin: 'edHistAxisMin', histAxisMax: 'edHistAxisMax',
    histAuto: 'edDenoiseAuto', histApply: 'edDenoiseApply',
    sendToViewer: 'edSendToViewer', undo: 'edUndo', redo: 'edRedo',
    btnCalc: 'edBtnCalc',
}, { editing: true });
setupColormapPicker(document.getElementById('edColormap'));


