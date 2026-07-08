/**
 * 點雲檢視器 UI 綁定
 * 依賴：render.js, file-parse.js, colormap.js, prefs.js
 * 匯出（全域）：檢視器事件與控制
 */
/* =========================================================================
 *  4. UI 綁定
 * ========================================================================= */

const fileInput = document.getElementById('fileInput');
const progressEl = document.getElementById('progress');
const progressBar = document.getElementById('progressBar');
const statusEl = document.getElementById('status');
const cmapSelect = document.getElementById('colormap');
const viewerEl = document.getElementById('viewer');
const dropIcon = document.getElementById('dropIcon');
const dropText = document.getElementById('dropText');
const toastEl = document.getElementById('toast');
const valueIndicator = document.getElementById('valueIndicator');

/* 鼠標模式：'pan' = 拖曳平移；'inspect' = 顯示鼠標位置數值 */
let cursorMode = getUserPref('cursorMode');
if (cursorMode !== 'pan' && cursorMode !== 'inspect' && cursorMode !== 'profile'
    && cursorMode !== 'measure' && cursorMode !== 'area') cursorMode = 'pan';

applySelectPref(cmapSelect, 'colormap');
setupColormapPicker(cmapSelect);
applySelectPref(document.getElementById('saveFormat'), 'saveFormat');
applySelectPref(document.getElementById('edColormap'), 'edColormap');
applySelectPref(document.getElementById('edSaveFormat'), 'edSaveFormat');

const SUPPORTED_EXTS = ['bcrf', 'asc', 'tif', 'tiff', 'pcd', 'bmp', 'png', 'jpg', 'jpeg'];
const SUPPORTED_TEXT = '.bcrf / .asc / .tif / .pcd / .bmp / .png / .jpg';

function setProgress(p) {
    progressEl.classList.add('show');
    progressBar.style.width = (p * 100).toFixed(1) + '%';
}
function hideProgress() {
    setTimeout(() => progressEl.classList.remove('show'), 300);
}

/** 切換元素的「處理中」忙碌狀態（轉圈 + 暫時停用） */
function setBusy(el, busy) {
    if (!el) return;
    el.classList.toggle('is-busy', !!busy);
}

const openLabel = fileInput.closest('label.file-btn');

let toastTimer = null;
function showToast(message, type = 'error') {
    toastEl.textContent = message;
    toastEl.classList.remove('info', 'error');
    toastEl.classList.add(type);
    toastEl.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2500);
}

function getExt(name) {
    const i = name.lastIndexOf('.');
    return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** 解析檔案為資料集（不更新檢視器 UI，供批次轉檔等用途） */
async function parseFileToDataset(file, onProgress) {
    const ext = getExt(file.name);
    if (!SUPPORTED_EXTS.includes(ext)) {
        throw new Error(t('statusUnsupported', file.name, SUPPORTED_TEXT));
    }
    let result;
    switch (ext) {
        case 'bcrf':          result = await readBcrf(file, onProgress); break;
        case 'asc':           result = await readAsc(file, onProgress); break;
        case 'tif':
        case 'tiff':          result = await readTiff(file, onProgress); break;
        case 'pcd':           result = await readPcd(file, onProgress); break;
        case 'bmp':           result = await readBmp(file, onProgress); break;
        case 'png':           result = await readPng(file, onProgress); break;
        case 'jpg':
        case 'jpeg':          result = await readJpg(file, onProgress); break;
        default:              throw new Error(t('errUnknownExt', ext));
    }
    const rangeSrc = result.type === 'pcd-scatter' ? result.z : result.data;
    const { vmin, vmax } = rangeSrc.length >= LARGE_PIXEL_THRESHOLD
        ? await computeRangeAsync(rangeSrc)
        : computeRange(rangeSrc);
    return { ...result, vmin, vmax, filename: file.name };
}

async function loadFile(file) {
    if (!file) return;
    const ext = getExt(file.name);
    if (!SUPPORTED_EXTS.includes(ext)) {
        const msg = t('statusUnsupported', file.name, SUPPORTED_TEXT);
        statusEl.textContent = msg;
        showToast(msg, 'error');
        return;
    }

    statusEl.textContent = t('statusReading', file.name);
    setProgress(0);
    setBusy(openLabel, true);
    if (typeof btnSave !== 'undefined' && btnSave) btnSave.disabled = true;

    try {
        currentDataset = await parseFileToDataset(file, setProgress);

        if (typeof clearProfile === 'function') clearProfile();
        resetColorClip(false);
        render(currentDataset, cmapSelect.value, true);
        // 若目前正處於 3D 模式，載入新檔後重建立體點雲
        if (typeof Viewer3D !== 'undefined' && Viewer3D.isActive()) {
            if (!Viewer3D.rebuild()) {
                view3dActive = false;
                document.getElementById('viewer').classList.remove('mode-3d');
                updateViewModeButtons();
            }
        }
        const infoExtra = currentDataset.type === 'pcd-scatter'
            ? { pointCount: currentDataset.pointCount } : null;
        renderInfo(currentDataset.header, currentDataset.width, currentDataset.height, infoExtra);

        if (currentDataset.type === 'pcd-scatter') {
            statusEl.textContent = t('statusLoadedPcd', file.name, currentDataset.pointCount);
        } else {
            statusEl.textContent = t('statusLoaded', file.name, currentDataset.width, currentDataset.height);
        }
        applyPreferredViewMode();
    } catch (err) {
        console.error(err);
        statusEl.textContent = t('statusReadFailed', err.message);
        showToast(t('statusReadFailed', err.message), 'error');
    } finally {
        hideProgress();
        setBusy(openLabel, false);
        if (typeof btnSave !== 'undefined' && btnSave) btnSave.disabled = false;
        if (typeof btnSendToEditor !== 'undefined' && btnSendToEditor) {
            btnSendToEditor.disabled = !currentDataset;
        }
        if (typeof btnClear !== 'undefined' && btnClear) {
            btnClear.disabled = !currentDataset;
        }
    }
}

/** 清除檢視器目前載入的資料，回到初始狀態 */
function clearViewerData() {
    if (!currentDataset) return;
    currentDataset = null;

    if (view3dActive) {
        Viewer3D.exit();
        view3dActive = false;
        document.getElementById('viewer').classList.remove('mode-3d');
        updateViewModeButtons();
    }
    if (typeof clearProfile === 'function') clearProfile();
    if (typeof clearMeasureDistance === 'function') clearMeasureDistance();
    if (typeof clearMeasureArea === 'function') clearMeasureArea();

    const canvas = document.getElementById('canvas');
    canvas.style.display = 'none';
    canvas.classList.remove('scatter-view');
    canvas.style.width = '';
    canvas.style.height = '';
    document.getElementById('placeholder').style.display = '';
    document.getElementById('zoomIndicator').classList.remove('show');
    document.getElementById('zoomHint').classList.remove('show');
    if (valueIndicator) valueIndicator.textContent = '';

    const overlay = document.getElementById('overlay');
    if (overlay) {
        const octx = overlay.getContext('2d');
        octx.clearRect(0, 0, overlay.width, overlay.height);
    }

    resetColorClip(false);
    renderColorbar(cmapSelect.value);
    document.getElementById('zMin').textContent = '-';
    document.getElementById('zMax').textContent = '-';
    document.getElementById('infoList').innerHTML = '';
    statusEl.textContent = t('statusIdle');
    fileInput.value = '';

    if (typeof btnSendToEditor !== 'undefined' && btnSendToEditor) btnSendToEditor.disabled = true;
    if (typeof btnClear !== 'undefined' && btnClear) btnClear.disabled = true;
    if (typeof updateModeIndicator === 'function') updateModeIndicator();
    showToast(t('statusCleared'), 'info');
}

/* 深拷貝資料集以便在檢視器與編輯器之間傳送 */
function cloneDatasetForTransfer(ds) {
    const c = { ...ds };
    delete c.canvasEl;
    if (ds.type === 'pcd-scatter') {
        c.x = ds.x.slice(0); c.y = ds.y.slice(0); c.z = ds.z.slice(0);
        if (ds.bounds) c.bounds = { ...ds.bounds };
    } else if (ds.data) {
        c.data = ds.data.slice(0);
    }
    if (ds.header) c.header = { ...ds.header };
    return c;
}

/* 直接把一個資料集物件載入檢視器（供「點雲編輯器」傳送資料使用） */
function loadDatasetIntoViewer(ds) {
    if (!ds) return false;
    const rangeSrc = ds.type === 'pcd-scatter' ? ds.z : ds.data;
    const { vmin, vmax } = computeRange(rangeSrc);
    currentDataset = { ...ds, vmin, vmax };
    if (typeof clearProfile === 'function') clearProfile();
    resetColorClip(false);
    render(currentDataset, cmapSelect.value, true);
    if (typeof Viewer3D !== 'undefined' && Viewer3D.isActive()) {
        if (!Viewer3D.rebuild()) {
            view3dActive = false;
            document.getElementById('viewer').classList.remove('mode-3d');
            updateViewModeButtons();
        }
    }
    const infoExtra = ds.type === 'pcd-scatter' ? { pointCount: ds.pointCount } : null;
    renderInfo(ds.header, ds.width, ds.height, infoExtra);
    if (ds.type === 'pcd-scatter') statusEl.textContent = t('statusLoadedPcd', ds.filename, ds.pointCount);
    else statusEl.textContent = t('statusLoaded', ds.filename, ds.width, ds.height);
    applyPreferredViewMode();
    if (typeof btnSendToEditor !== 'undefined' && btnSendToEditor) btnSendToEditor.disabled = false;
    if (typeof btnClear !== 'undefined' && btnClear) btnClear.disabled = false;
    return true;
}

let datasetTransferInProgress = false;

function buildPreviewSendMenuItems(opts) {
    const { file, entry, ds, onBeforeAction } = opts;
    const wrap = (fn) => () => {
        if (onBeforeAction) onBeforeAction();
        fn();
    };
    return [
        {
            label: t('batchEditPreviewSendToViewer'),
            action: wrap(() => transferDatasetToViewer({ file, entry, ds })),
        },
        {
            label: t('batchEditPreviewSendToEditor'),
            action: wrap(() => transferDatasetToEditor({ file, entry, ds })),
        },
    ];
}

/** 非同步載入大型資料集到檢視器，分塊繪製以避免卡住 UI */
async function loadDatasetIntoViewerAsync(ds, onProgress) {
    if (!ds) return false;
    const rangeSrc = ds.type === 'pcd-scatter' ? ds.z : ds.data;
    const { vmin, vmax } = rangeSrc.length >= LARGE_PIXEL_THRESHOLD
        ? await computeRangeAsync(rangeSrc)
        : computeRange(rangeSrc);
    currentDataset = { ...ds, vmin, vmax };
    if (typeof clearProfile === 'function') clearProfile();
    resetColorClip(false);

    const canvas = document.getElementById('canvas');
    if (ds.type === 'pcd-scatter') {
        canvas.classList.add('scatter-view');
        renderPcdScatter(currentDataset, cmapSelect.value);
        if (onProgress) onProgress(1);
    } else {
        canvas.classList.remove('scatter-view');
        canvas.style.width = '';
        canvas.style.height = '';
        await renderPixelsAsync(currentDataset, cmapSelect.value, onProgress);
    }

    canvas.style.display = 'block';
    document.getElementById('placeholder').style.display = 'none';
    document.getElementById('zoomIndicator').classList.add('show');
    document.getElementById('zoomHint').classList.add('show');
    fitImageToViewer();
    applyTransform();
    renderColorbar(cmapSelect.value);
    document.getElementById('zMin').textContent = currentDataset.vmin.toFixed(4);
    document.getElementById('zMax').textContent = currentDataset.vmax.toFixed(4);
    syncColorbarHandles();
    if (typeof updateModeIndicator === 'function') updateModeIndicator();

    if (typeof Viewer3D !== 'undefined' && Viewer3D.isActive()) {
        if (!Viewer3D.rebuild()) {
            view3dActive = false;
            document.getElementById('viewer').classList.remove('mode-3d');
            updateViewModeButtons();
        }
    }
    const infoExtra = ds.type === 'pcd-scatter' ? { pointCount: ds.pointCount } : null;
    renderInfo(ds.header, ds.width, ds.height, infoExtra);
    if (ds.type === 'pcd-scatter') statusEl.textContent = t('statusLoadedPcd', ds.filename, ds.pointCount);
    else statusEl.textContent = t('statusLoaded', ds.filename, ds.width, ds.height);
    applyPreferredViewMode();
    if (typeof btnSendToEditor !== 'undefined' && btnSendToEditor) btnSendToEditor.disabled = false;
    if (typeof btnClear !== 'undefined' && btnClear) btnClear.disabled = false;
    return true;
}

/**
 * 非同步傳送資料到點雲檢視：先切換頁面並顯示進度，再分塊解析／繪製大型檔案。
 * @param {{ file?: File, entry?: object, ds?: object }} opts
 */
async function transferDatasetToViewer(opts = {}) {
    if (datasetTransferInProgress) return false;
    const { file, entry, ds } = opts;
    const filename = ds?.filename || file?.name || '';
    if (!ds && !file) {
        showToast(t('sendNoData'), 'info');
        return false;
    }

    datasetTransferInProgress = true;

    if (typeof switchPage === 'function') switchPage('viewer');
    statusEl.textContent = t('statusSendingToViewer', filename);
    setProgress(0);
    await yieldToMain();

    try {
        let dataset = ds;
        if (!dataset) {
            statusEl.textContent = t('statusReading', filename);
            dataset = await parseFileToDataset(file, (p) => setProgress(p * 0.65));
            if (entry) entry.previewDs = dataset;
        }
        await yieldToMain();

        statusEl.textContent = t('statusRenderingViewer', filename);
        setProgress(0.7);
        await yieldToMain();

        if (isLargeDataset(dataset)) {
            await loadDatasetIntoViewerAsync(dataset, (p) => setProgress(0.7 + p * 0.3));
        } else {
            loadDatasetIntoViewer(dataset);
            setProgress(1);
        }
        showToast(t('sentToViewer'), 'info');
        return true;
    } catch (err) {
        console.error(err);
        statusEl.textContent = t('statusReadFailed', err.message);
        showToast(t('statusReadFailed', err.message), 'error');
        return false;
    } finally {
        datasetTransferInProgress = false;
        hideProgress();
    }
}

/**
 * 非同步傳送資料到點雲編輯：先切換頁面並顯示進度，再分塊解析／繪製大型檔案。
 * @param {{ file?: File, entry?: object, ds?: object }} opts
 */
async function transferDatasetToEditor(opts = {}) {
    if (datasetTransferInProgress) return false;
    if (typeof editorView === 'undefined' || !editorView.loadDataset) return false;

    const { file, entry, ds } = opts;
    const filename = ds?.filename || file?.name || '';
    if (!ds && !file) {
        showToast(t('sendNoData'), 'info');
        return false;
    }

    const edProgress = document.getElementById('edProgress');
    const edProgressBar = document.getElementById('edProgressBar');
    const edStatus = document.getElementById('edStatus');
    const setEdProgress = (p) => {
        if (edProgress) edProgress.classList.add('show');
        if (edProgressBar) edProgressBar.style.width = (p * 100).toFixed(1) + '%';
    };
    const hideEdProgress = () => {
        setTimeout(() => { if (edProgress) edProgress.classList.remove('show'); }, 300);
    };

    datasetTransferInProgress = true;

    if (typeof switchPage === 'function') switchPage('editor');
    if (edStatus) edStatus.textContent = t('statusSendingToEditor', filename);
    setEdProgress(0);
    await yieldToMain();

    const cmap = document.getElementById('edColormap')?.value || 'jet';

    try {
        let dataset = ds;
        if (!dataset) {
            if (edStatus) edStatus.textContent = t('statusReading', filename);
            dataset = await parseFileToDataset(file, (p) => setEdProgress(p * 0.65));
            if (entry) entry.previewDs = dataset;
        }
        await yieldToMain();

        if (edStatus) edStatus.textContent = t('statusRenderingEditor', filename);
        setEdProgress(0.7);
        await yieldToMain();

        if (isLargeDataset(dataset) && typeof editorView.loadDatasetAsync === 'function') {
            await editorView.loadDatasetAsync(dataset, { colormap: cmap }, (p) => setEdProgress(0.7 + p * 0.3));
        } else {
            editorView.loadDataset(dataset, { colormap: cmap });
            setEdProgress(1);
        }
        showToast(t('sentToEditor'), 'info');
        return true;
    } catch (err) {
        console.error(err);
        if (edStatus) edStatus.textContent = t('statusReadFailed', err.message);
        showToast(t('statusReadFailed', err.message), 'error');
        return false;
    } finally {
        datasetTransferInProgress = false;
        hideEdProgress();
    }
}

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    await loadFile(file);
    fileInput.value = '';
});


/* ---------- 拖放支援 ---------- */

// 以計數器避免子元素 dragenter/dragleave 反覆觸發
let dragDepth = 0;

function dragHasFiles(e) {
    if (!e.dataTransfer) return false;
    const types = e.dataTransfer.types;
    if (!types) return false;
    for (let i = 0; i < types.length; i++) {
        if (types[i] === 'Files') return true;
    }
    return false;
}

// dragenter 時檢查第一個 item 的副檔名（若有提供）以切換樣式
function checkDragSupported(e) {
    if (!e.dataTransfer || !e.dataTransfer.items) return true;
    for (let i = 0; i < e.dataTransfer.items.length; i++) {
        const item = e.dataTransfer.items[i];
        if (item.kind !== 'file') continue;
        // 瀏覽器通常不提供檔名，只能看 MIME type。
        // 多數情況 .bcrf / .asc 的 MIME 為空，所以一律先視為可接收，由 drop 時再判斷。
        return true;
    }
    return true;
}

viewerEl.addEventListener('dragenter', (e) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    const supported = checkDragSupported(e);
    viewerEl.classList.remove('drag-reject', 'drag-over');
    viewerEl.classList.add(supported ? 'drag-over' : 'drag-reject');
    dropIcon.innerHTML = supported ? '&#x2B07;' : '&#x2715;';
    dropText.textContent = supported ? t('dropSupported') : t('dropReject');
});

viewerEl.addEventListener('dragover', (e) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
});

viewerEl.addEventListener('dragleave', (e) => {
    if (!dragHasFiles(e)) return;
    dragDepth--;
    if (dragDepth <= 0) {
        dragDepth = 0;
        viewerEl.classList.remove('drag-over', 'drag-reject');
    }
});

viewerEl.addEventListener('drop', async (e) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    viewerEl.classList.remove('drag-over', 'drag-reject');

    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || files.length === 0) return;

    if (files.length > 1) {
        showToast(t('toastMultiFile'), 'info');
    }

    const file = files[0];
    const ext = getExt(file.name);
    if (!SUPPORTED_EXTS.includes(ext)) {
        const msg = t('statusUnsupported', file.name, SUPPORTED_TEXT);
        statusEl.textContent = msg;
        showToast(msg, 'error');
        return;
    }
    await loadFile(file);
});

// 避免瀏覽器在其他位置接住檔案後直接開啟，導致離開應用
['dragover', 'drop'].forEach(evt => {
    window.addEventListener(evt, (e) => {
        if (dragHasFiles(e)) e.preventDefault();
    });
});

cmapSelect.addEventListener('change', () => {
    setUserPref('colormap', cmapSelect.value);
    renderColorbar(cmapSelect.value);
    // 切換色彩時保留目前的縮放與平移狀態
    if (currentDataset) render(currentDataset, cmapSelect.value, false);
    if (typeof Viewer3D !== 'undefined' && Viewer3D.isActive()) Viewer3D.refreshColors();
});

const saveFormatSelect = document.getElementById('saveFormat');
if (saveFormatSelect) {
    saveFormatSelect.addEventListener('change', () => {
        setUserPref('saveFormat', saveFormatSelect.value);
    });
}

/** 載入資料後，若使用者偏好 3D 則自動切換 */
function applyPreferredViewMode() {
    if (getUserPref('viewMode') !== '3d' || !currentDataset || view3dActive) return;
    setViewMode('3d');
}
const btnSave = document.getElementById('btnSave');
const btnClear = document.getElementById('btnClear');
const btnSendToEditor = document.getElementById('btnSendToEditor');

function sendToEditor() {
    if (!currentDataset) { showToast(t('sendNoData'), 'info'); return; }
    if (typeof editorView === 'undefined' || !editorView.loadDataset) return;
    const clone = cloneDatasetForTransfer(currentDataset);
    const cmap = cmapSelect.value;
    if (typeof switchPage === 'function') switchPage('editor');
    requestAnimationFrame(() => {
        if (editorView.loadDataset(clone, { colormap: cmap })) {
            showToast(t('sentToEditor'), 'info');
        }
    });
}

if (btnSendToEditor) btnSendToEditor.addEventListener('click', sendToEditor);

const supportsSavePicker = (typeof window.showSaveFilePicker === 'function');

// 支援原生「另存新檔」視窗時，格式直接在視窗裡選，工具列不需重複的格式選單；
// 不支援的瀏覽器 (Firefox / Safari) 則保留它作為格式選擇的 fallback。
if (supportsSavePicker) {
    const saveFormatItem = document.getElementById('saveFormatItem');
    if (saveFormatItem) saveFormatItem.style.display = 'none';
}

/** 實際產生檔案並更新 UI（picker 與 fallback 兩條路徑共用） */
async function runSaveJob(format, writeFn, fullName) {
    btnSave.disabled = true;
    btnSave.textContent = t('btnSaving');
    setProgress(0);
    statusEl.textContent = t('statusSaving', fullName);
    try {
        await writeFn();
        statusEl.textContent = t('statusSaved', fullName);
        showToast(t('toastSaved', fullName), 'info');
    } catch (err) {
        console.error(err);
        statusEl.textContent = t('statusSaveFailed', err.message);
        showToast(t('statusSaveFailed', err.message), 'error');
    } finally {
        hideProgress();
        btnSave.disabled = false;
        btnSave.textContent = t('btnSave');
    }
}

btnSave.addEventListener('click', async () => {
    if (!currentDataset) {
        showToast(t('toastNoData'), 'error');
        return;
    }

    const preferred = saveFormatSelect.value;
    const allowed = getAllowedSaveFormats(currentDataset);
    const base = stripExt(currentDataset.filename || 'image');

    // ---- 支援 File System Access API：用原生「另存新檔」視窗，格式在視窗下方選 ----
    if (supportsSavePicker) {
        // 預設選中的格式：使用者偏好；若該格式不適用此資料集則退回第一個可用格式
        const defaultFormat = allowed.includes(preferred) ? preferred : allowed[0];
        let handle;
        try {
            handle = await window.showSaveFilePicker({
                suggestedName: `${base}.${formatToExt(defaultFormat)}`,
                types: buildPickerTypes(allowed, defaultFormat),
            });
        } catch (err) {
            if (err && err.name === 'AbortError') return;   // 使用者取消
            // 其他錯誤（例如非安全環境）→ 退回傳統下載
            console.warn('showSaveFilePicker 失敗，改用下載方式：', err);
            return fallbackSave(defaultFormat, base);
        }

        // 依使用者在視窗中實際選定的副檔名決定輸出格式
        const chosenExt = getExt(handle.name);
        const format = extToFormat(chosenExt) || defaultFormat;
        if (!allowed.includes(format)) {
            showToast(t('savePcdScatter'), 'info');
            return;
        }
        const fullName = handle.name || `${base}.${formatToExt(format)}`;

        await runSaveJob(format, async () => {
            const blob = await buildSaveBlob(currentDataset, format, setProgress);
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
        }, fullName);
        return;
    }

    // ---- 不支援時的 fallback：沿用工具列選單的格式直接下載 ----
    fallbackSave(preferred, base);
});

if (btnClear) btnClear.addEventListener('click', clearViewerData);

/** 傳統下載（不支援 showSaveFilePicker 的瀏覽器） */
function fallbackSave(format, base) {
    const allowed = getAllowedSaveFormats(currentDataset);
    if (!allowed.includes(format)) {
        showToast(t('savePcdScatter'), 'info');
        return;
    }
    const fullName = `${base}.${formatToExt(format)}`;
    return runSaveJob(format, () => saveAs(currentDataset, format, setProgress), fullName);
}

window.addEventListener('resize', () => {
    if (typeof Viewer3D !== 'undefined' && Viewer3D.isActive()) Viewer3D.onResize();
    if (!currentDataset) return;
    if (isPcdScatterDataset(currentDataset)) {
        const { w, h } = getScatterViewerSize();
        scatterView.screenW = w;
        scatterView.screenH = h;
        requestScatterRedraw();
    } else {
        fitImageToViewer();
    }
    if (typeof drawProfileOverlay === 'function') drawProfileOverlay();
    if (typeof profileState !== 'undefined' && profileState.data) renderProfileChart();
});

/* 視窗／版面變化時更新散布畫布（筆電高 DPI、側欄縮放等） */
if (typeof ResizeObserver !== 'undefined') {
    const scatterViewerObs = new ResizeObserver(() => {
        if (typeof Viewer3D !== 'undefined' && Viewer3D.isActive()) Viewer3D.onResize();
        if (!isPcdScatterDataset(currentDataset)) return;
        const { w, h } = getScatterViewerSize();
        if (w === scatterView.screenW && h === scatterView.screenH) return;
        scatterView.screenW = w;
        scatterView.screenH = h;
        requestScatterRedraw();
    });
    scatterViewerObs.observe(document.getElementById('viewer'));
}


/* ---------- 滑鼠滾輪縮放 / 拖曳平移 / 雙擊還原 ---------- */

viewerEl.addEventListener('wheel', (e) => {
    if (view3dActive) return;   // 3D 模式由 canvas3d 自行處理
    if (!currentDataset) return;
    e.preventDefault();

    const rect = viewerEl.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;
    else if (e.deltaMode === 2) dy *= viewerEl.clientHeight;

    const zoomFactor = Math.pow(1.0015, -dy);

    if (isPcdScatterDataset(currentDataset)) {
        scatterZoomAt(mx, my, zoomFactor);
        requestScatterRedraw();
        return;
    }

    let newScale = view.scale * zoomFactor;
    if (newScale < view.minScale) newScale = view.minScale;
    if (newScale > view.maxScale) newScale = view.maxScale;

    const k = newScale / view.scale;
    view.tx = mx - (mx - view.tx) * k;
    view.ty = my - (my - view.ty) * k;
    view.scale = newScale;

    applyTransform();
}, { passive: false });

const canvasEl = document.getElementById('canvas');
let panning = false;
let panStart = null;

/** 剖面 / 距離 / 區域模式：左鍵量測，中鍵拖曳平移 */
function isOverlayMeasureMode() {
    return cursorMode === 'profile' || cursorMode === 'measure' || cursorMode === 'area';
}

function startCanvasPan(e) {
    panning = true;
    panStart = {
        x: e.clientX,
        y: e.clientY,
        tx: view.tx,
        ty: view.ty,
        centerX: scatterView.centerX,
        centerY: scatterView.centerY,
    };
    canvasEl.classList.add('grabbing');
    try { canvasEl.setPointerCapture && canvasEl.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
}

canvasEl.addEventListener('mousedown', (e) => {
    if (!currentDataset || view3dActive) return;
    const leftPan = e.button === 0 && cursorMode === 'pan';
    const middlePan = e.button === 1 && isOverlayMeasureMode();
    if (!leftPan && !middlePan) return;
    startCanvasPan(e);
});

canvasEl.addEventListener('auxclick', (e) => {
    if (e.button === 1 && isOverlayMeasureMode()) e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
    if (!panning) return;
    const dx = e.clientX - panStart.x;
    const dy = e.clientY - panStart.y;
    if (isPcdScatterDataset(currentDataset)) {
        scatterView.centerX = panStart.centerX - dx * scatterView.worldPerPx;
        scatterView.centerY = panStart.centerY + dy * scatterView.worldPerPx;
        requestScatterRedraw();
        return;
    }
    view.tx = panStart.tx + dx;
    view.ty = panStart.ty + dy;
    applyTransform();
});

window.addEventListener('mouseup', () => {
    if (!panning) return;
    panning = false;
    canvasEl.classList.remove('grabbing');
});


/* ---------- 數值顯示模式 ---------- */

/** 將數值格式化為簡潔可讀字串 */
function formatValue(v) {
    if (!Number.isFinite(v)) return String(v); // NaN / Infinity
    const a = Math.abs(v);
    if (a !== 0 && (a < 0.001 || a >= 1e6)) return v.toExponential(4);
    return (Math.round(v * 10000) / 10000).toString();
}

/** 依滑鼠位置更新數值顯示器 */
function updateValueIndicator(clientX, clientY) {
    if (!currentDataset || cursorMode !== 'inspect') {
        valueIndicator.classList.remove('show');
        return;
    }
    const viewerRect = viewerEl.getBoundingClientRect();
    const mx = clientX - viewerRect.left;
    const my = clientY - viewerRect.top;

    // 檢查鼠標是否在 viewer 範圍內
    if (mx < 0 || my < 0 || mx > viewerRect.width || my > viewerRect.height) {
        valueIndicator.classList.remove('show');
        return;
    }

    if (currentDataset.type === 'pcd-scatter') {
        const idx = findNearestPcdPoint(currentDataset, mx, my);
        if (idx == null) {
            valueIndicator.classList.remove('show');
            return;
        }
        valueIndicator.innerHTML =
            `<div><span class="k">${t('valueWorldPos')}:</span>(${formatValue(currentDataset.x[idx])}, ${formatValue(currentDataset.y[idx])})</div>` +
            `<div><span class="k">${t('valueLabel')} (z):</span>${formatValue(currentDataset.z[idx])}</div>`;
    } else {
        const px = Math.floor((mx - view.tx) / view.scale);
        const py = Math.floor((my - view.ty) / view.scale);
        const { width, height } = currentDataset;
        if (px < 0 || py < 0 || px >= width || py >= height) {
            valueIndicator.classList.remove('show');
            return;
        }
        const v = currentDataset.data[py * width + px];
        valueIndicator.innerHTML =
            `<div><span class="k">${t('valuePos')}:</span>(${px}, ${py})</div>` +
            `<div><span class="k">${t('valueLabel')}:</span>${formatValue(v)}</div>`;
    }

    // 顯示位置：跟隨鼠標 (相對於 viewer)，但避免溢出邊界
    valueIndicator.classList.add('show');
    const pad = 14;
    const iw = valueIndicator.offsetWidth;
    const ih = valueIndicator.offsetHeight;
    let left = mx + pad;
    let top  = my + pad;
    if (left + iw > viewerRect.width - 4)  left = mx - iw - pad;
    if (top  + ih > viewerRect.height - 4) top  = my - ih - pad;
    if (left < 4) left = 4;
    if (top  < 4) top  = 4;
    valueIndicator.style.left = left + 'px';
    valueIndicator.style.top  = top + 'px';
}

// 在 viewer 內移動時更新數值 (包含 canvas、placeholder 空白處等)
viewerEl.addEventListener('mousemove', (e) => {
    if (view3dActive) return;
    if (cursorMode !== 'inspect') return;
    updateValueIndicator(e.clientX, e.clientY);
});

viewerEl.addEventListener('mouseleave', () => {
    valueIndicator.classList.remove('show');
});


/* ---------- 剖面 (profile) 模式 ---------- */

const overlayEl     = document.getElementById('overlay');
const profilePanel  = document.getElementById('profilePanel');
const profileCanvas = document.getElementById('profileCanvas');
const profileTip    = document.getElementById('profileTip');
const profileMeta   = document.getElementById('profileMeta');
const profileClearBtn = document.getElementById('profileClear');
const profileBandWrap = document.getElementById('profileBandWrap');
const profileBandInput = document.getElementById('profileBand');
const profileChartStyleWrap = document.getElementById('profileChartStyleWrap');
const profileMeasureBtn = document.getElementById('profileMeasureBtn');

let profileChartStyle = getUserPref('profileChartStyle');
if (profileChartStyle !== 'line' && profileChartStyle !== 'dots') profileChartStyle = 'line';

function syncProfileChartStyleUI() {
    if (!profileChartStyleWrap) return;
    profileChartStyleWrap.querySelectorAll('button[data-profile-chart]').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-profile-chart') === profileChartStyle);
    });
}
syncProfileChartStyleUI();

if (profileChartStyleWrap) {
    profileChartStyleWrap.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-profile-chart]');
        if (!btn) return;
        const style = btn.getAttribute('data-profile-chart');
        if (style !== 'line' && style !== 'dots' || style === profileChartStyle) return;
        profileChartStyle = style;
        setUserPref('profileChartStyle', style);
        syncProfileChartStyleUI();
        renderProfileChart();
    });
}

/** 剖面狀態
 *  space : 'image' → line 以影像像素座標記錄；'world' → 以點雲世界座標記錄
 *  line  : { x0,y0,x1,y1 } 端點（隨縮放/平移保持貼合）
 *  data  : 取樣結果
 *          影像： { dist, vals, vmin, vmax, distPx, N, anyValid, scatter:false }
 *          點雲： { dist, vals, wx, wy, vmin, vmax, distPx, N, anyValid, scatter:true, halfW }
 *  halfW : 點雲緩衝帶半寬（世界單位）
 *  geom  : 圖表繪製幾何，供 hover 換算
 */
const profileState = {
    drawing: false,
    editMode: null,   // 'ep0' | 'ep1' | 'move'
    editStart: null,  // { pt, line } 編輯起始狀態
    space: 'image',
    line: null,
    data: null,
    geom: null,
    hoverIndex: null,
    halfW: 0,
    measureMode: false,
    measurePts: [],   // 圖表上選取的資料索引（最多 2 個）
};

const PROFILE_HIT_RADIUS = 10;
const PROFILE_CHART_PICK_RADIUS = 22;
const PROFILE_MEASURE_COLORS = ['#ff6b6b', '#51cf66'];
const PROFILE_MEASURE_DIST_COLOR = '#ffd24a';
const PROFILE_MEASURE_STEP_COLOR = '#ff7b72';
const PROFILE_MEASURE_FILL = 'rgba(255,210,74,0.12)';

function syncProfileMeasureUI() {
    if (profileMeasureBtn) {
        profileMeasureBtn.classList.toggle('active', profileState.measureMode);
    }
    const plot = profileCanvas && profileCanvas.parentElement;
    if (plot) plot.classList.toggle('measure-mode', profileState.measureMode);
}

function clearProfileMeasurePts() {
    profileState.measurePts = [];
    profileState.hoverIndex = null;
}

if (profileMeasureBtn) {
    profileMeasureBtn.addEventListener('click', () => {
        profileState.measureMode = !profileState.measureMode;
        clearProfileMeasurePts();
        profileTip.classList.remove('show');
        syncProfileMeasureUI();
        renderProfileChart();
        drawProfileOverlay();
    });
}
syncProfileMeasureUI();

/** 在已排序(遞增)的 dist 陣列中找最接近 target 的索引 */
function nearestDistIndex(dist, target) {
    const n = dist.length;
    if (n === 0) return 0;
    if (target <= dist[0]) return 0;
    if (target >= dist[n - 1]) return n - 1;
    let lo = 0, hi = n - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (dist[mid] < target) lo = mid + 1; else hi = mid - 1;
    }
    const a = hi < 0 ? 0 : hi;
    const b = lo >= n ? n - 1 : lo;
    return (target - dist[a] <= dist[b] - target) ? a : b;
}

/** 影像像素座標 → viewer CSS 座標 */
function imgToViewerPx(px, py) {
    return { x: px * view.scale + view.tx, y: py * view.scale + view.ty };
}
/** viewer CSS 座標 → 影像像素座標 */
function viewerToImgPx(mx, my) {
    return { x: (mx - view.tx) / view.scale, y: (my - view.ty) / view.scale };
}
/** 限制座標於影像範圍內 */
function clampToImage(p) {
    if (!currentDataset) return p;
    const w = currentDataset.width, h = currentDataset.height;
    return {
        x: Math.max(0, Math.min(w - 1, p.x)),
        y: Math.max(0, Math.min(h - 1, p.y)),
    };
}

/** 偵測滑鼠是否落在剖面線的端點或線段上（螢幕座標） */
function profileHitTest(clientX, clientY) {
    const L = profileState.line;
    if (!L) return null;
    const rect = viewerEl.getBoundingClientRect();
    const mx = clientX - rect.left, my = clientY - rect.top;
    const a = profilePtToScreen(L.x0, L.y0);
    const b = profilePtToScreen(L.x1, L.y1);
    const r = PROFILE_HIT_RADIUS;

    if (Math.hypot(mx - a.x, my - a.y) <= r) return 'ep0';
    if (Math.hypot(mx - b.x, my - b.y) <= r) return 'ep1';

    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 > 0) {
        let t = ((mx - a.x) * dx + (my - a.y) * dy) / len2;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        const dist = Math.hypot(mx - (a.x + t * dx), my - (a.y + t * dy));
        if (dist <= r) return 'move';
    }
    return null;
}

/** 影像模式下將剖面線端點限制在影像範圍內 */
function clampProfileLine(L) {
    const p0 = clampToImage({ x: L.x0, y: L.y0 });
    const p1 = clampToImage({ x: L.x1, y: L.y1 });
    return { x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y };
}

/** 線端點座標 → viewer CSS 座標（依目前 space 換算） */
function profilePtToScreen(px, py) {
    if (profileState.space === 'world') {
        const s = scatterWorldToScreen(px, py);
        return { x: s.sx, y: s.sy };
    }
    return imgToViewerPx(px, py);
}

/* 是否在圖上標記 Max / Min 數值點 */
let showMinMax = !!getUserPref('showMinMax');

/**
 * 找出資料集中 Max / Min 數值的位置（影像像素或世界座標），結果快取在 dataset 上。
 * 計算機套用後 vmin/vmax 會改變，藉此自動失效重算。
 */
function getMinMaxPoints(dataset) {
    if (!dataset) return null;
    const cache = dataset._minMaxPts;
    if (cache && cache.vmin === dataset.vmin && cache.vmax === dataset.vmax) return cache;

    let minIdx = -1, maxIdx = -1, mn = Infinity, mx = -Infinity;

    if (dataset.type === 'pcd-scatter') {
        const z = dataset.z;
        if (!z) return null;
        for (let i = 0; i < z.length; i++) {
            const v = z[i];
            if (!Number.isFinite(v)) continue;
            if (v < mn) { mn = v; minIdx = i; }
            if (v > mx) { mx = v; maxIdx = i; }
        }
        if (minIdx < 0 || maxIdx < 0) return null;
        const res = {
            vmin: dataset.vmin, vmax: dataset.vmax,
            min: { space: 'world', wx: dataset.x[minIdx], wy: dataset.y[minIdx], value: mn },
            max: { space: 'world', wx: dataset.x[maxIdx], wy: dataset.y[maxIdx], value: mx },
        };
        dataset._minMaxPts = res;
        return res;
    }

    const data = dataset.data;
    if (!data) return null;
    for (let i = 0; i < data.length; i++) {
        const v = data[i];
        if (!Number.isFinite(v)) continue;
        if (v < mn) { mn = v; minIdx = i; }
        if (v > mx) { mx = v; maxIdx = i; }
    }
    if (minIdx < 0 || maxIdx < 0) return null;
    const w = dataset.width;
    const res = {
        vmin: dataset.vmin, vmax: dataset.vmax,
        // +0.5 對準像素中心
        min: { space: 'image', px: (minIdx % w) + 0.5, py: Math.floor(minIdx / w) + 0.5, value: mn },
        max: { space: 'image', px: (maxIdx % w) + 0.5, py: Math.floor(maxIdx / w) + 0.5, value: mx },
    };
    dataset._minMaxPts = res;
    return res;
}

/** 將資料點座標換算為 viewer CSS 座標 */
function minMaxPtToScreen(p) {
    if (p.space === 'world') {
        const s = scatterWorldToScreen(p.wx, p.wy);
        return { x: s.sx, y: s.sy };
    }
    return imgToViewerPx(p.px, p.py);
}

/** 畫單一標記（圓點 + 十字 + 數值標籤），標籤會避免超出畫面 */
function drawMinMaxMarker(ctx, p, label, value, color, cssW, cssH) {
    const x = p.x, y = p.y;

    ctx.save();
    // 十字線
    ctx.beginPath();
    ctx.moveTo(x - 11, y); ctx.lineTo(x + 11, y);
    ctx.moveTo(x, y - 11); ctx.lineTo(x, y + 11);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 11, y); ctx.lineTo(x + 11, y);
    ctx.moveTo(x, y - 11); ctx.lineTo(x, y + 11);
    ctx.lineWidth = 1.5; ctx.strokeStyle = color; ctx.stroke();
    // 圓點
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();

    // 數值標籤
    const text = `${label}: ${value.toFixed(4)}`;
    ctx.font = '12px Consolas, monospace';
    const pad = 5, boxH = 18;
    const boxW = ctx.measureText(text).width + pad * 2 + 3;
    let bx = x + 12, by = y - boxH - 8;
    if (by < 2) by = y + 12;
    if (bx + boxW > cssW - 2) bx = x - 12 - boxW;
    if (bx < 2) bx = 2;
    if (by + boxH > cssH - 2) by = cssH - 2 - boxH;

    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.fillStyle = color;
    ctx.fillRect(bx, by, 3, boxH);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(text, bx + pad + 3, by + boxH / 2 + 0.5);
    ctx.restore();
}

/** 在疊加層上繪製 Max / Min 數值點標記 */
function drawMinMaxMarkers(ctx, cssW, cssH) {
    const pts = getMinMaxPoints(currentDataset);
    if (!pts) return;
    drawMinMaxMarker(ctx, minMaxPtToScreen(pts.max), 'Max', pts.max.value, '#ff5a5a', cssW, cssH);
    drawMinMaxMarker(ctx, minMaxPtToScreen(pts.min), 'Min', pts.min.value, '#4fa3ff', cssW, cssH);
}

/** 在疊加層上重畫剖面線（端點、線段、緩衝帶、hover 標記） */
function drawProfileOverlay() {
    if (!overlayEl) return;
    const ctx = overlayEl.getContext('2d');
    const rect = viewerEl.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.max(1, Math.round(rect.width * dpr));
    const bh = Math.max(1, Math.round(rect.height * dpr));
    if (overlayEl.width !== bw) overlayEl.width = bw;
    if (overlayEl.height !== bh) overlayEl.height = bh;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const hasMarkers = showMinMax && currentDataset;
    const hasProfile = profileState.line && currentDataset;
    const ms = typeof measureState !== 'undefined' ? measureState : null;
    const hasMeasureDist = ms && ms.distLine && currentDataset;
    const hasMeasureArea = ms && ms.areaRect && currentDataset
        && (ms.areaDrawing || ms.areaEditMode || ms.areaStats);

    if (!hasMarkers && !hasProfile && !hasMeasureDist && !hasMeasureArea) {
        overlayEl.classList.remove('show');
        return;
    }
    overlayEl.classList.add('show');

    // Max / Min 數值點標記（與剖面線同層繪製，永遠跟隨縮放/平移）
    if (hasMarkers) drawMinMaxMarkers(ctx, rect.width, rect.height);

    if (hasMeasureArea) drawMeasureAreaOverlay(ctx);
    if (hasMeasureDist) drawMeasureDistOverlay(ctx);

    if (!hasProfile) return;

    const L = profileState.line;
    const a = profilePtToScreen(L.x0, L.y0);
    const b = profilePtToScreen(L.x1, L.y1);

    // 點雲：先畫緩衝帶（半透明走廊）
    if (profileState.space === 'world' && profileState.halfW > 0) {
        const dx = L.x1 - L.x0, dy = L.y1 - L.y0;
        const len = Math.hypot(dx, dy);
        if (len > 0) {
            const nx = -dy / len, ny = dx / len; // 單位法向量（世界座標）
            const hw = profileState.halfW;
            const c0 = profilePtToScreen(L.x0 + nx * hw, L.y0 + ny * hw);
            const c1 = profilePtToScreen(L.x1 + nx * hw, L.y1 + ny * hw);
            const c2 = profilePtToScreen(L.x1 - nx * hw, L.y1 - ny * hw);
            const c3 = profilePtToScreen(L.x0 - nx * hw, L.y0 - ny * hw);
            ctx.beginPath();
            ctx.moveTo(c0.x, c0.y); ctx.lineTo(c1.x, c1.y);
            ctx.lineTo(c2.x, c2.y); ctx.lineTo(c3.x, c3.y); ctx.closePath();
            ctx.fillStyle = 'rgba(79,140,255,0.15)';
            ctx.fill();
            ctx.setLineDash([5, 4]);
            ctx.strokeStyle = 'rgba(79,140,255,0.7)'; ctx.lineWidth = 1;
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    // 線段：先描黑底再描藍線，確保各種背景下都清晰
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 4; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = '#4f8cff'; ctx.lineWidth = 2; ctx.stroke();

    // 端點
    for (const p of [a, b]) {
        ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#4f8cff'; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
    }

    // hover 標記（與圖表連動；測量模式改由 measurePts 顯示）
    const d = profileState.data;
    if (!profileState.measureMode && profileState.hoverIndex != null && d && d.N > 0) {
        const i = profileState.hoverIndex;
        let hx, hy;
        if (d.scatter) {
            hx = d.wx[i]; hy = d.wy[i];
        } else {
            const tt = d.N > 1 ? i / (d.N - 1) : 0;
            hx = L.x0 + (L.x1 - L.x0) * tt;
            hy = L.y0 + (L.y1 - L.y0) * tt;
        }
        const hp = profilePtToScreen(hx, hy);
        ctx.beginPath(); ctx.arc(hp.x, hp.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffd24a'; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = '#000'; ctx.stroke();
    }

    // 剖面圖測量點（連動主視圖標記）
    if (d && profileState.measurePts.length > 0) {
        for (let k = 0; k < profileState.measurePts.length; k++) {
            const i = profileState.measurePts[k];
            let hx, hy;
            if (d.scatter) {
                hx = d.wx[i]; hy = d.wy[i];
            } else {
                const tt = d.N > 1 ? i / (d.N - 1) : 0;
                hx = L.x0 + (L.x1 - L.x0) * tt;
                hy = L.y0 + (L.y1 - L.y0) * tt;
            }
            const hp = profilePtToScreen(hx, hy);
            ctx.beginPath(); ctx.arc(hp.x, hp.y, 5, 0, Math.PI * 2);
            ctx.fillStyle = PROFILE_MEASURE_COLORS[k]; ctx.fill();
            ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
        }
    }

    // 測量模式：預覽下一個選點
    if (profileState.measureMode && profileState.hoverIndex != null && d && d.N > 0
        && !profileState.measurePts.includes(profileState.hoverIndex)) {
        const i = profileState.hoverIndex;
        let hx, hy;
        if (d.scatter) {
            hx = d.wx[i]; hy = d.wy[i];
        } else {
            const tt = d.N > 1 ? i / (d.N - 1) : 0;
            hx = L.x0 + (L.x1 - L.x0) * tt;
            hy = L.y0 + (L.y1 - L.y0) * tt;
        }
        const hp = profilePtToScreen(hx, hy);
        ctx.beginPath(); ctx.arc(hp.x, hp.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,210,74,0.55)'; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = '#ffd24a'; ctx.stroke();
    }
}

/** 沿線段取樣影像數值（最近鄰），回傳剖面資料 */
function sampleProfile(line) {
    const { width, height, data } = currentDataset;
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
    return { dist, vals, vmin, vmax, distPx, N, anyValid, scatter: false };
}

/** 點雲剖面：緩衝帶投影
 *  把落在「線段 ± halfW」走廊內的點，投影到線上，
 *  以沿線距離為 X、z 值為 Y。
 */
function sampleProfileScatter(line, halfW) {
    const { x, y, z } = currentDataset;
    const n = z.length;
    const dx = line.x1 - line.x0, dy = line.y1 - line.y0;
    const len = Math.hypot(dx, dy);
    const ux = len > 0 ? dx / len : 0;
    const uy = len > 0 ? dy / len : 0;

    const items = [];
    let vmin = Infinity, vmax = -Infinity;
    for (let i = 0; i < n; i++) {
        const rx = x[i] - line.x0, ry = y[i] - line.y0;
        const tproj = rx * ux + ry * uy;          // 沿線投影距離
        if (tproj < 0 || tproj > len) continue;
        const perp = rx * (-uy) + ry * ux;        // 垂直距離（帶符號）
        if (perp < -halfW || perp > halfW) continue;
        const v = z[i];
        items.push({ d: tproj, v, wx: x[i], wy: y[i] });
        if (Number.isFinite(v)) { if (v < vmin) vmin = v; if (v > vmax) vmax = v; }
    }
    items.sort((p, q) => p.d - q.d);

    const N = items.length;
    const dist = new Float32Array(N);
    const vals = new Float32Array(N);
    const wx = new Float32Array(N);
    const wy = new Float32Array(N);
    for (let i = 0; i < N; i++) {
        dist[i] = items[i].d; vals[i] = items[i].v;
        wx[i] = items[i].wx; wy[i] = items[i].wy;
    }
    const anyValid = N > 0 && Number.isFinite(vmin);
    if (!anyValid) { vmin = 0; vmax = 1; }
    else if (vmin === vmax) { vmin -= 0.5; vmax += 0.5; }
    return { dist, vals, wx, wy, vmin, vmax, distPx: len, N, anyValid, scatter: true, halfW };
}

/** 剖面圖座標：資料索引 → 繪圖區像素座標 */
function profileChartPointPx(d, g, i) {
    const v = d.vals[i];
    if (!Number.isFinite(v)) return null;
    const distPx = d.distPx || 1;
    const range = (d.vmax - d.vmin) || 1;
    return {
        px: g.padL + (d.dist[i] / distPx) * g.plotW,
        py: g.padT + (1 - (v - d.vmin) / range) * g.plotH,
    };
}

/** 在剖面圖上依滑鼠位置選取最近的資料點 */
function profileChartPickIndex(mx, my) {
    const d = profileState.data, g = profileState.geom;
    if (!d || !g || d.N === 0) return null;
    let bestIdx = -1, bestDist2 = Infinity;
    const r2 = PROFILE_CHART_PICK_RADIUS * PROFILE_CHART_PICK_RADIUS;
    for (let i = 0; i < d.N; i++) {
        const p = profileChartPointPx(d, g, i);
        if (!p) continue;
        const dx = mx - p.px, dy = my - p.py;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDist2) { bestDist2 = d2; bestIdx = i; }
    }
    return bestDist2 <= r2 ? bestIdx : null;
}

/** 剖面圖兩點測量結果 */
function profileMeasureResult() {
    const pts = profileState.measurePts;
    const d = profileState.data;
    if (!d || pts.length < 2) return null;
    const i0 = pts[0], i1 = pts[1];
    if (!Number.isFinite(d.vals[i0]) || !Number.isFinite(d.vals[i1])) return null;
    return {
        i0, i1,
        dist: Math.abs(d.dist[i1] - d.dist[i0]),
        step: d.vals[i1] - d.vals[i0],
    };
}

function headerUnit(key) {
    if (!currentDataset || !currentDataset.header) return '';
    const h = currentDataset.header;
    const hyphen = key.replace('unit', '-unit');
    const raw = h[key] ?? h[hyphen] ?? '';
    return String(raw).replace(/[\[\]]/g, '').trim();
}

/** 剖面測量：距離單位（影像 px；點雲取 header xunit） */
function profileMeasureDistUnit(d) {
    if (d && d.scatter) {
        return headerUnit('xunit') || t('measureUnitWorld');
    }
    return t('measureUnitPx');
}

/** 剖面測量：階高單位（取 header zunit） */
function profileMeasureStepUnit() {
    return headerUnit('zunit') || headerUnit('z-unit') || '';
}

function formatProfileMeasureDist(mr, d) {
    const unit = profileMeasureDistUnit(d);
    return `${t('measureDist')} ${formatValue(mr.dist)} ${unit}`;
}

function formatProfileMeasureStep(mr) {
    const unit = profileMeasureStepUnit();
    const val = formatValue(mr.step);
    return unit ? `${t('profileMeasureStep')} ${val} ${unit}` : `${t('profileMeasureStep')} ${val}`;
}

function formatProfileMetaLine(d) {
    if (d.scatter) {
        return `${t('profileLength')}: ${formatValue(d.distPx)} · ` +
            `${t('profilePointsInBand')}: ${d.N} · ` +
            `${t('profileRange')}: ${formatValue(d.vmin)} ~ ${formatValue(d.vmax)}`;
    }
    return `${t('profileLength')}: ${d.distPx.toFixed(1)} px · ` +
        `${t('profileSamples')}: ${d.N} · ` +
        `${t('profileRange')}: ${formatValue(d.vmin)} ~ ${formatValue(d.vmax)}`;
}

/** 繪製剖面圖（座標軸、格線、折線/散點），並更新面板資訊 */
function renderProfileChart() {
    const d = profileState.data;
    if (!d) { profilePanel.classList.remove('show'); return; }
    profilePanel.classList.add('show');

    // 點雲模式顯示帶寬輸入框；圖表樣式切換與測量按鈕一律顯示
    profileBandWrap.style.display = d.scatter ? 'inline-flex' : 'none';
    if (profileChartStyleWrap) profileChartStyleWrap.style.display = 'inline-flex';
    if (profileMeasureBtn) profileMeasureBtn.style.display = 'inline-flex';
    syncProfileChartStyleUI();
    syncProfileMeasureUI();

    let meta = formatProfileMetaLine(d);
    const mr = profileMeasureResult();
    if (mr) {
        meta += ` · ${formatProfileMeasureDist(mr, d)} · ${formatProfileMeasureStep(mr)}`;
    }
    profileMeta.textContent = meta;

    const canvas = profileCanvas;
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth || canvas.parentElement.clientWidth || 600;
    const ch = canvas.clientHeight || 160;
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
    profileState.geom = { padL, padT, plotW, plotH, cw, ch };

    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(x0, y0, plotW, plotH);

    ctx.font = '11px Consolas, monospace';
    ctx.lineWidth = 1;

    // Y 軸格線 + 數值標籤
    const yticks = 4;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= yticks; i++) {
        const tt = i / yticks;
        const py = y0 + plotH * tt;
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.beginPath(); ctx.moveTo(x0, py); ctx.lineTo(x0 + plotW, py); ctx.stroke();
        const val = d.vmax - (d.vmax - d.vmin) * tt;
        ctx.fillStyle = '#9a9ab0';
        ctx.fillText(formatValue(val), x0 - 6, py);
    }

    // X 軸格線 + 距離標籤
    const xticks = 5;
    const distPx = d.distPx || 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let i = 0; i <= xticks; i++) {
        const tt = i / xticks;
        const px = x0 + plotW * tt;
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath(); ctx.moveTo(px, y0); ctx.lineTo(px, y0 + plotH); ctx.stroke();
        ctx.fillStyle = '#9a9ab0';
        const lbl = d.scatter ? formatValue(d.distPx * tt) : (d.distPx * tt).toFixed(0);
        ctx.fillText(lbl, px, y0 + plotH + 5);
    }

    const range = (d.vmax - d.vmin) || 1;

    if (profileChartStyle === 'dots') {
        // 散點：各取樣點畫小圓點
        ctx.fillStyle = '#4f8cff';
        const dotR = d.scatter ? 1.8 : 2.2;
        for (let i = 0; i < d.N; i++) {
            const v = d.vals[i];
            if (!Number.isFinite(v)) continue;
            const px = x0 + (d.dist[i] / distPx) * plotW;
            const py = y0 + (1 - (v - d.vmin) / range) * plotH;
            ctx.beginPath(); ctx.arc(px, py, dotR, 0, Math.PI * 2); ctx.fill();
        }
    } else {
        // 折線（遇 NaN 斷開；點雲依沿線距離排序後連線）
        ctx.strokeStyle = '#4f8cff'; ctx.lineWidth = 1.6;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < d.N; i++) {
            const v = d.vals[i];
            if (!Number.isFinite(v)) { started = false; continue; }
            const px = x0 + (d.dist[i] / distPx) * plotW;
            const py = y0 + (1 - (v - d.vmin) / range) * plotH;
            if (!started) { ctx.moveTo(px, py); started = true; }
            else ctx.lineTo(px, py);
        }
        ctx.stroke();
    }

    if (profileState.hoverIndex != null && !profileState.measureMode) drawProfileChartCrosshair();
    drawProfileChartMeasure();
}

/** 在剖面圖上繪製測量標記（直角標註：水平距離 + 垂直階高） */
function profileMeasureLabelBox(ctx, text, anchorX, anchorY, align, baseline) {
    const font = '10px Consolas, monospace';
    const pad = 4;
    const boxH = 14;
    ctx.font = font;
    const tw = ctx.measureText(text).width;
    const boxW = tw + pad * 2;
    let bx = anchorX;
    if (align === 'center') bx -= boxW / 2;
    else if (align === 'right') bx -= boxW;
    let by = anchorY;
    if (baseline === 'middle') by -= boxH / 2;
    else if (baseline === 'bottom' || baseline === 'alphabetic') by -= boxH;
    return { text, anchorX, anchorY, align, baseline, bx, by, boxW, boxH, pad, tw };
}

function profileMeasureBoxesOverlap(a, b, gap) {
    const g = gap ?? 5;
    return !(a.bx + a.boxW + g <= b.bx || b.bx + b.boxW + g <= a.bx
        || a.by + a.boxH + g <= b.by || b.by + b.boxH + g <= a.by);
}

function profileMeasureBoxInPlot(box, geom, margin) {
    const m = margin ?? 2;
    const x0 = geom.padL + m;
    const y0 = geom.padT + m;
    const x1 = geom.padL + geom.plotW - m;
    const y1 = geom.padT + geom.plotH - m;
    return box.bx >= x0 && box.by >= y0 && box.bx + box.boxW <= x1 && box.by + box.boxH <= y1;
}

function profileMeasureLabelScore(dist, step, geom) {
    let score = 0;
    if (profileMeasureBoxInPlot(dist, geom)) score += 10; else score -= 50;
    if (profileMeasureBoxInPlot(step, geom)) score += 10; else score -= 50;
    if (!profileMeasureBoxesOverlap(dist, step)) score += 100;
    // 偏好標籤靠近各自量測線中點
    const distMidDy = Math.abs((dist.by + dist.boxH / 2) - dist.anchorY);
    const stepMidDx = Math.abs((step.bx + step.boxW / 2) - step.anchorX);
    score -= distMidDy * 0.15 + stepMidDx * 0.15;
    return score;
}

/** 選擇距離／階高標籤位置，避免重疊 */
function profileMeasurePickLabels(ctx, mr, d, g, p0, p1, corner) {
    const distText = formatProfileMeasureDist(mr, d);
    const stepText = formatProfileMeasureStep(mr);
    const distMidX = (p0.px + corner.px) / 2;
    const stepMidY = (corner.py + p1.py) / 2;
    const sgnX = p1.px >= p0.px ? 1 : -1;
    const sgnY = p1.py >= p0.py ? 1 : -1;
    const horizLen = Math.abs(corner.px - p0.px);
    const vertLen = Math.abs(p1.py - corner.py);

    const distCandidates = [];
    const stepCandidates = [];
    const distPerps = [-sgnY, sgnY];
    const stepPerps = [sgnX, -sgnX];
    const offsets = [10, 18, 26, 34];

    for (const perp of distPerps) {
        for (const off of offsets) {
            const ay = p0.py + perp * off;
            distCandidates.push(profileMeasureLabelBox(
                ctx, distText, distMidX, ay, 'center', perp < 0 ? 'bottom' : 'top',
            ));
        }
    }
    // 水平段很短時，改放在遠離轉角的一端
    if (horizLen < 72) {
        const farX = sgnX > 0 ? p0.px + 4 : p0.px - 4;
        for (const perp of distPerps) {
            for (const off of offsets) {
                distCandidates.push(profileMeasureLabelBox(
                    ctx, distText, farX, p0.py + perp * off,
                    sgnX > 0 ? 'left' : 'right', perp < 0 ? 'bottom' : 'top',
                ));
            }
        }
    }

    for (const perp of stepPerps) {
        for (const off of offsets) {
            const ax = corner.px + perp * off;
            stepCandidates.push(profileMeasureLabelBox(
                ctx, stepText, ax, stepMidY, perp > 0 ? 'left' : 'right', 'middle',
            ));
        }
    }
    // 垂直段很短時，改放在遠離轉角的一端
    if (vertLen < 36) {
        const farY = sgnY > 0 ? p1.py - 4 : p1.py + 4;
        for (const perp of stepPerps) {
            for (const off of offsets) {
                stepCandidates.push(profileMeasureLabelBox(
                    ctx, stepText, corner.px + perp * off, farY,
                    perp > 0 ? 'left' : 'right', sgnY > 0 ? 'bottom' : 'top',
                ));
            }
        }
    }

    let best = null;
    for (const dist of distCandidates) {
        for (const step of stepCandidates) {
            const score = profileMeasureLabelScore(dist, step, g);
            if (!best || score > best.score) best = { dist, step, score };
        }
    }

    // 仍重疊或分數過低：在轉角外側垂直堆疊兩行標籤
    if (!best || best.score < 100 || profileMeasureBoxesOverlap(best.dist, best.step)) {
        const outX = corner.px + sgnX * 14;
        let outY = corner.py - sgnY * 14;
        const dist = profileMeasureLabelBox(
            ctx, distText, outX, outY, sgnX > 0 ? 'left' : 'right', sgnY > 0 ? 'bottom' : 'top',
        );
        outY += sgnY > 0 ? -(dist.boxH + 5) : (dist.boxH + 5);
        const step = profileMeasureLabelBox(
            ctx, stepText, outX, outY, sgnX > 0 ? 'left' : 'right', sgnY > 0 ? 'bottom' : 'top',
        );
        if (!profileMeasureBoxInPlot(dist, g) || !profileMeasureBoxInPlot(step, g)) {
            // 改放到圖表內側空白處垂直堆疊
            const cx = Math.min(g.padL + g.plotW - 4, Math.max(g.padL + 4, corner.px));
            let cy = Math.min(g.padT + g.plotH - 4, Math.max(g.padT + 4, corner.py - sgnY * 20));
            const dBox = profileMeasureLabelBox(ctx, distText, cx, cy, 'center', 'bottom');
            cy += sgnY > 0 ? -(dBox.boxH + 5) : (dBox.boxH + 5);
            const sBox = profileMeasureLabelBox(ctx, stepText, cx, cy, 'center', sgnY > 0 ? 'bottom' : 'top');
            return { dist: dBox, step: sBox, stacked: true };
        }
        return { dist, step, stacked: true };
    }
    return { dist: best.dist, step: best.step, stacked: false };
}

function drawProfileMeasureDimLabel(ctx, box, color) {
    const { text, bx, by, boxW, boxH, pad, tw, align } = box;
    ctx.font = '10px Consolas, monospace';
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.fillStyle = color;
    ctx.fillRect(bx, by, 2, boxH);
    ctx.fillStyle = '#fff';
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + pad + (align === 'center' ? tw / 2 : align === 'right' ? tw : 0), by + boxH / 2 + 0.5);
}

function drawProfileMeasureLabelLeader(ctx, box, color, targetX, targetY) {
    const cx = box.bx + box.boxW / 2;
    const cy = box.by + box.boxH / 2;
    const dx = targetX - cx, dy = targetY - cy;
    if (Math.hypot(dx, dy) < 24) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(targetX, targetY);
    ctx.stroke();
    ctx.restore();
}

function drawProfileChartMeasure() {
    const pts = profileState.measurePts;
    const d = profileState.data, g = profileState.geom;
    if (!d || !g || pts.length === 0) return;
    const ctx = profileCanvas.getContext('2d');
    const coords = [];
    for (let k = 0; k < pts.length; k++) {
        const p = profileChartPointPx(d, g, pts[k]);
        if (!p) continue;
        coords.push({ ...p, color: PROFILE_MEASURE_COLORS[k] });
    }

    if (coords.length === 2) {
        const p0 = coords[0], p1 = coords[1];
        const corner = { px: p1.px, py: p0.py };
        const mr = profileMeasureResult();
        const distColor = PROFILE_MEASURE_DIST_COLOR;
        const stepColor = PROFILE_MEASURE_STEP_COLOR;

        ctx.save();
        // 直角三角形淡色填充，強調量測區域
        ctx.beginPath();
        ctx.moveTo(p0.px, p0.py);
        ctx.lineTo(corner.px, corner.py);
        ctx.lineTo(p1.px, p1.py);
        ctx.closePath();
        ctx.fillStyle = PROFILE_MEASURE_FILL;
        ctx.fill();

        // 水平線：距離（虛線 + 描邊，與剖面藍線區隔）
        ctx.setLineDash([5, 4]);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p0.px, p0.py);
        ctx.lineTo(corner.px, corner.py);
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.strokeStyle = distColor;
        ctx.lineWidth = 2;
        ctx.stroke();

        // 垂直線：階高（實線 + 描邊）
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(corner.px, corner.py);
        ctx.lineTo(p1.px, p1.py);
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.strokeStyle = stepColor;
        ctx.lineWidth = 2;
        ctx.stroke();

        // 直角記號
        const tick = 6;
        const sgnX = p1.px >= p0.px ? 1 : -1;
        const sgnY = p1.py >= p0.py ? 1 : -1;
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.moveTo(corner.px, corner.py);
        ctx.lineTo(corner.px - sgnX * tick, corner.py);
        ctx.moveTo(corner.px, corner.py);
        ctx.lineTo(corner.px, corner.py - sgnY * tick);
        ctx.stroke();

        // 端點短劃線（標尺刻度）
        const cap = 4;
        ctx.strokeStyle = distColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p0.px, p0.py - cap); ctx.lineTo(p0.px, p0.py + cap);
        ctx.moveTo(corner.px, corner.py - cap); ctx.lineTo(corner.px, corner.py + cap);
        ctx.stroke();
        ctx.strokeStyle = stepColor;
        ctx.beginPath();
        ctx.moveTo(corner.px - cap, corner.py); ctx.lineTo(corner.px + cap, corner.py);
        ctx.moveTo(p1.px - cap, p1.py); ctx.lineTo(p1.px + cap, p1.py);
        ctx.stroke();

        if (mr) {
            const distMidX = (p0.px + corner.px) / 2;
            const stepMidY = (corner.py + p1.py) / 2;
            const layout = profileMeasurePickLabels(ctx, mr, d, g, p0, p1, corner);
            if (!layout.stacked) {
                drawProfileMeasureLabelLeader(ctx, layout.dist, distColor, distMidX, p0.py);
                drawProfileMeasureLabelLeader(ctx, layout.step, stepColor, corner.px, stepMidY);
            }
            drawProfileMeasureDimLabel(ctx, layout.dist, distColor);
            drawProfileMeasureDimLabel(ctx, layout.step, stepColor);
        }
        ctx.setLineDash([]);
        ctx.restore();
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
    if (profileState.measureMode && profileState.hoverIndex != null
        && !pts.includes(profileState.hoverIndex)) {
        const p = profileChartPointPx(d, g, profileState.hoverIndex);
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

/** 在剖面圖上畫 hover 垂直線與點 */
function drawProfileChartCrosshair() {
    const d = profileState.data, g = profileState.geom;
    if (!d || !g || profileState.hoverIndex == null) return;
    const ctx = profileCanvas.getContext('2d');
    const i = profileState.hoverIndex;
    const frac = (d.distPx > 0) ? (d.dist[i] / d.distPx) : 0;
    const px = g.padL + frac * g.plotW;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,210,74,0.85)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, g.padT); ctx.lineTo(px, g.padT + g.plotH); ctx.stroke();
    const v = d.vals[i];
    if (Number.isFinite(v)) {
        const range = (d.vmax - d.vmin) || 1;
        const py = g.padT + (1 - (v - d.vmin) / range) * g.plotH;
        ctx.fillStyle = '#ffd24a';
        ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
}

/** 清除剖面線與圖表 */
function clearProfile() {
    profileState.drawing = false;
    profileState.editMode = null;
    profileState.editStart = null;
    profileState.line = null;
    profileState.data = null;
    profileState.geom = null;
    profileState.hoverIndex = null;
    clearProfileMeasurePts();
    profileTip.classList.remove('show');
    profilePanel.classList.remove('show');
    if (profileBandWrap) profileBandWrap.style.display = 'none';
    if (profileChartStyleWrap) profileChartStyleWrap.style.display = 'none';
    if (profileMeasureBtn) profileMeasureBtn.style.display = 'none';
    drawProfileOverlay();
}

// 在圖表上 hover / 測量：顯示對應距離/數值，並連動影像上的標記
function showProfileChartTip(e, html) {
    profileTip.innerHTML = html;
    profileTip.classList.add('show');
    const plotRect = profileCanvas.parentElement.getBoundingClientRect();
    const tw = profileTip.offsetWidth, th = profileTip.offsetHeight;
    let left = (e.clientX - plotRect.left) + 12;
    let top  = (e.clientY - plotRect.top) + 12;
    if (left + tw > plotRect.width - 4)  left = (e.clientX - plotRect.left) - tw - 12;
    if (top  + th > plotRect.height - 4) top  = (e.clientY - plotRect.top) - th - 12;
    if (left < 2) left = 2;
    if (top  < 2) top  = 2;
    profileTip.style.left = left + 'px';
    profileTip.style.top  = top + 'px';
}

function updateProfileMeasureTip(e) {
    const d = profileState.data;
    if (!d) return;
    const n = profileState.measurePts.length;
    if (n < 2) {
        const hint = n === 0 ? t('profileMeasurePick1') : t('profileMeasurePick2');
        showProfileChartTip(e, `<div>${hint}</div>`);
        return;
    }
    const mr = profileMeasureResult();
    if (!mr) return;
    showProfileChartTip(e,
        `<div><span class="k">${t('measureDist')}:</span>${formatValue(mr.dist)} ${profileMeasureDistUnit(d)}</div>` +
        `<div><span class="k">${t('profileMeasureStep')}:</span>${formatValue(mr.step)}${profileMeasureStepUnit() ? ' ' + profileMeasureStepUnit() : ''}</div>`);
}

profileCanvas.addEventListener('click', (e) => {
    if (!profileState.measureMode) return;
    const d = profileState.data, g = profileState.geom;
    if (!d || !g || d.N === 0) return;
    const rect = profileCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const idx = profileChartPickIndex(mx, my);
    if (idx == null) return;
    if (profileState.measurePts.length >= 2) {
        profileState.measurePts = [idx];
    } else {
        profileState.measurePts.push(idx);
    }
    profileState.hoverIndex = null;
    renderProfileChart();
    drawProfileOverlay();
    updateProfileMeasureTip(e);
});

profileCanvas.addEventListener('mousemove', (e) => {
    const d = profileState.data, g = profileState.geom;
    if (!d || !g) return;
    if (d.N === 0) return;
    const rect = profileCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;

    if (profileState.measureMode) {
        const my = e.clientY - rect.top;
        const idx = profileChartPickIndex(mx, my);
        profileState.hoverIndex = idx;
        renderProfileChart();
        drawProfileOverlay();
        if (idx != null) updateProfileMeasureTip(e);
        else profileTip.classList.remove('show');
        return;
    }

    let frac = (mx - g.padL) / g.plotW;
    if (frac < 0) frac = 0; else if (frac > 1) frac = 1;
    const idx = nearestDistIndex(d.dist, frac * d.distPx);
    profileState.hoverIndex = idx;
    renderProfileChart();
    drawProfileOverlay();

    const v = d.vals[idx];
    const distLabel = d.scatter ? t('profileAxisDistWorld') : t('profileAxisDist');
    showProfileChartTip(e,
        `<div><span class="k">${distLabel}:</span>${formatValue(d.dist[idx])}</div>` +
        `<div><span class="k">${t('valueLabel')}:</span>${formatValue(v)}</div>`);
});

profileCanvas.addEventListener('mouseleave', () => {
    profileState.hoverIndex = null;
    profileTip.classList.remove('show');
    renderProfileChart();
    drawProfileOverlay();
});

profileClearBtn.addEventListener('click', clearProfile);

/** 把滑鼠位置換成目前 space 的線端點座標 */
function profileMouseToPt(clientX, clientY) {
    const rect = viewerEl.getBoundingClientRect();
    const mx = clientX - rect.left, my = clientY - rect.top;
    if (isPcdScatterDataset(currentDataset)) {
        const w = scatterScreenToWorld(mx, my);
        return { x: w.wx, y: w.wy };
    }
    return clampToImage(viewerToImgPx(mx, my));
}

/** 依目前線段重新取樣並繪製 */
function recomputeProfile() {
    const L = profileState.line;
    if (!L || !currentDataset) return;
    if (profileState.space === 'world') {
        profileState.data = sampleProfileScatter(L, profileState.halfW);
        if (profileState.data.N === 0) showToast(t('profileNoPoints'), 'info');
    } else {
        profileState.data = sampleProfile(L);
        if (!profileState.data.anyValid) showToast(t('profileNoValid'), 'info');
    }
    if (profileState.hoverIndex != null && profileState.hoverIndex >= profileState.data.N) {
        profileState.hoverIndex = null;
    }
    clearProfileMeasurePts();
    renderProfileChart();
    drawProfileOverlay();
}

/** 剖面線最短有效長度（影像：1 px；點雲：約 3 螢幕像素的世界長度） */
function profileMinLineLen() {
    return profileState.space === 'world' ? 3 * scatterView.worldPerPx : 1;
}

// 在影像/點雲上拉線，或拖曳既有剖面線
viewerEl.addEventListener('mousedown', (e) => {
    if (view3dActive) return;
    if (cursorMode !== 'profile') return;
    if (e.button !== 0) return;
    if (!currentDataset) return;
    if (e.target.closest && (e.target.closest('.profile-panel') || e.target.closest('.measure-panel'))) return;

    const scatter = isPcdScatterDataset(currentDataset);
    profileState.space = scatter ? 'world' : 'image';
    // 點雲：若尚未設定帶寬，預設為約 8 螢幕像素對應的世界寬度
    if (scatter && !(profileState.halfW > 0)) {
        profileState.halfW = 8 * scatterView.worldPerPx;
    }

    // 已有剖面線：優先進入編輯（拖端點或平移整線）
    if (profileState.line && profileState.data) {
        const hit = profileHitTest(e.clientX, e.clientY);
        if (hit) {
            profileState.editMode = hit;
            profileState.editStart = {
                pt: profileMouseToPt(e.clientX, e.clientY),
                line: { ...profileState.line },
            };
            viewerEl.style.cursor = hit === 'move' ? 'grabbing' : 'crosshair';
            e.preventDefault();
            return;
        }
    }

    const p = profileMouseToPt(e.clientX, e.clientY);
    profileState.drawing = true;
    profileState.editMode = null;
    profileState.editStart = null;
    profileState.line = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    profileState.data = null;
    profileState.geom = null;
    profileState.hoverIndex = null;
    clearProfileMeasurePts();
    profileTip.classList.remove('show');
    drawProfileOverlay();
    e.preventDefault();
});

viewerEl.addEventListener('mousemove', (e) => {
    if (view3dActive || cursorMode !== 'profile') return;
    if (profileState.drawing || profileState.editMode) return;
    if (!profileState.line || !profileState.data) {
        viewerEl.style.cursor = '';
        return;
    }
    const hit = profileHitTest(e.clientX, e.clientY);
    if (hit === 'ep0' || hit === 'ep1') viewerEl.style.cursor = 'pointer';
    else if (hit === 'move') viewerEl.style.cursor = 'move';
    else viewerEl.style.cursor = '';
});

window.addEventListener('mousemove', (e) => {
    if (profileState.editMode && profileState.editStart) {
        const p = profileMouseToPt(e.clientX, e.clientY);
        const s = profileState.editStart;
        const dx = p.x - s.pt.x, dy = p.y - s.pt.y;
        if (profileState.editMode === 'ep0') {
            let L = { ...profileState.line, x0: s.line.x0 + dx, y0: s.line.y0 + dy };
            if (profileState.space === 'image') L = clampProfileLine(L);
            profileState.line = L;
        } else if (profileState.editMode === 'ep1') {
            let L = { ...profileState.line, x1: s.line.x1 + dx, y1: s.line.y1 + dy };
            if (profileState.space === 'image') L = clampProfileLine(L);
            profileState.line = L;
        } else if (profileState.editMode === 'move') {
            let L = {
                x0: s.line.x0 + dx, y0: s.line.y0 + dy,
                x1: s.line.x1 + dx, y1: s.line.y1 + dy,
            };
            if (profileState.space === 'image') L = clampProfileLine(L);
            profileState.line = L;
        }
        drawProfileOverlay();
        return;
    }
    if (!profileState.drawing) return;
    const p = profileMouseToPt(e.clientX, e.clientY);
    profileState.line.x1 = p.x;
    profileState.line.y1 = p.y;
    drawProfileOverlay();
});

window.addEventListener('mouseup', () => {
    if (profileState.editMode) {
        const L = profileState.line;
        const revert = profileState.editStart && profileState.editStart.line;
        if (!L || Math.hypot(L.x1 - L.x0, L.y1 - L.y0) < profileMinLineLen()) {
            if (revert) profileState.line = { ...profileState.editStart.line };
        } else {
            recomputeProfile();
        }
        profileState.editMode = null;
        profileState.editStart = null;
        viewerEl.style.cursor = '';
        drawProfileOverlay();
        return;
    }
    if (!profileState.drawing) return;
    profileState.drawing = false;
    const L = profileState.line;
    const lineLen = Math.hypot(L.x1 - L.x0, L.y1 - L.y0);
    if (lineLen < profileMinLineLen()) {
        // 太短視為取消
        profileState.line = null;
        profilePanel.classList.remove('show');
        if (profileBandWrap) profileBandWrap.style.display = 'none';
        if (profileChartStyleWrap) profileChartStyleWrap.style.display = 'none';
        drawProfileOverlay();
        return;
    }
    if (profileState.space === 'world') {
        profileBandInput.value = formatValue(profileState.halfW * 2);
    }
    recomputeProfile();
});

// 調整帶寬 → 重新取樣（僅點雲）
profileBandInput.addEventListener('input', () => {
    if (profileState.space !== 'world' || !profileState.line) return;
    const full = parseFloat(profileBandInput.value);
    if (!Number.isFinite(full) || full < 0) return;
    profileState.halfW = full / 2;
    recomputeProfile();
});


/* ---------- 測量工具（兩點距離 / 區域統計） ---------- */

const measurePanel     = document.getElementById('measurePanel');
const measureMeta      = document.getElementById('measureMeta');
const measureTitleEl   = document.getElementById('measureTitle');
const measureClearBtn  = document.getElementById('measureClear');

const MEASURE_HIT_RADIUS = 10;

const measureState = {
    space: 'image',
    distDrawing: false,
    distLine: null,
    distEditMode: null,
    distEditStart: null,
    areaDrawing: false,
    areaRect: null,
    areaStats: null,
    areaEditMode: null,
    areaEditStart: null,
};

function overlaySpaceForDataset() {
    return isPcdScatterDataset(currentDataset) ? 'world' : 'image';
}

function overlayMouseToPt(clientX, clientY) {
    const rect = viewerEl.getBoundingClientRect();
    const mx = clientX - rect.left, my = clientY - rect.top;
    if (isPcdScatterDataset(currentDataset)) {
        const w = scatterScreenToWorld(mx, my);
        return { x: w.wx, y: w.wy };
    }
    return clampToImage(viewerToImgPx(mx, my));
}

function overlayPtToScreen(px, py, space) {
    if (space === 'world') {
        const s = scatterWorldToScreen(px, py);
        return { x: s.sx, y: s.sy };
    }
    return imgToViewerPx(px, py);
}

function measureMinLineLen() {
    return measureState.space === 'world' ? 3 * scatterView.worldPerPx : 1;
}

function measureMinRectSize() {
    return measureState.space === 'world' ? 3 * scatterView.worldPerPx : 1;
}

function normalizeMeasureRect(r) {
    return {
        x0: Math.min(r.x0, r.x1), y0: Math.min(r.y0, r.y1),
        x1: Math.max(r.x0, r.x1), y1: Math.max(r.y0, r.y1),
    };
}

function clampMeasureLine(L) {
    const p0 = clampToImage({ x: L.x0, y: L.y0 });
    const p1 = clampToImage({ x: L.x1, y: L.y1 });
    return { x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y };
}

function clampMeasureRect(r) {
    const p0 = clampToImage({ x: r.x0, y: r.y0 });
    const p1 = clampToImage({ x: r.x1, y: r.y1 });
    return { x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y };
}

function sampleOverlayValue(x, y, space) {
    if (space === 'world') {
        const s = scatterWorldToScreen(x, y);
        const idx = findNearestPcdPoint(currentDataset, s.sx, s.sy);
        return idx != null ? currentDataset.z[idx] : NaN;
    }
    const { width, height, data } = currentDataset;
    const px = Math.round(x), py = Math.round(y);
    if (px < 0 || py < 0 || px >= width || py >= height) return NaN;
    return data[py * width + px];
}

function computeMeasureDistance(line) {
    const dx = line.x1 - line.x0, dy = line.y1 - line.y0;
    return {
        dist: Math.hypot(dx, dy),
        dx, dy,
        v0: sampleOverlayValue(line.x0, line.y0, measureState.space),
        v1: sampleOverlayValue(line.x1, line.y1, measureState.space),
    };
}

function computeAreaStats(rect) {
    const n = normalizeMeasureRect(rect);
    const space = measureState.space;

    if (space === 'world') {
        const { x, y, z } = currentDataset;
        const len = z.length;
        let count = 0, valid = 0, sum = 0, sumSq = 0, min = Infinity, max = -Infinity;
        for (let i = 0; i < len; i++) {
            if (x[i] < n.x0 || x[i] > n.x1 || y[i] < n.y0 || y[i] > n.y1) continue;
            count++;
            const v = z[i];
            if (!Number.isFinite(v)) continue;
            valid++;
            sum += v;
            sumSq += v * v;
            if (v < min) min = v;
            if (v > max) max = v;
        }
        const mean = valid > 0 ? sum / valid : NaN;
        const std = valid > 1 ? Math.sqrt(Math.max(0, (sumSq - sum * sum / valid) / (valid - 1))) : (valid === 1 ? 0 : NaN);
        if (valid === 0) { min = NaN; max = NaN; }
        return {
            count, valid, min, max, mean, std,
            w: n.x1 - n.x0, h: n.y1 - n.y0,
            scatter: true,
        };
    }

    const { width, height, data } = currentDataset;
    const ix0 = Math.max(0, Math.floor(n.x0));
    const ix1 = Math.min(width - 1, Math.ceil(n.x1));
    const iy0 = Math.max(0, Math.floor(n.y0));
    const iy1 = Math.min(height - 1, Math.ceil(n.y1));
    let count = 0, valid = 0, sum = 0, sumSq = 0, min = Infinity, max = -Infinity;
    for (let py = iy0; py <= iy1; py++) {
        for (let px = ix0; px <= ix1; px++) {
            count++;
            const v = data[py * width + px];
            if (!Number.isFinite(v)) continue;
            valid++;
            sum += v;
            sumSq += v * v;
            if (v < min) min = v;
            if (v > max) max = v;
        }
    }
    const mean = valid > 0 ? sum / valid : NaN;
    const std = valid > 1 ? Math.sqrt(Math.max(0, (sumSq - sum * sum / valid) / (valid - 1))) : (valid === 1 ? 0 : NaN);
    if (valid === 0) { min = NaN; max = NaN; }
    return {
        count, valid, min, max, mean, std,
        w: ix1 - ix0 + 1, h: iy1 - iy0 + 1,
        scatter: false,
    };
}

function updateMeasurePanel() {
    if (!measurePanel || !measureMeta) return;
    if (measureTitleEl) {
        measureTitleEl.textContent = cursorMode === 'area' ? t('cursorArea')
            : cursorMode === 'measure' ? t('cursorMeasure') : t('measureTitle');
    }

    let show = false;
    let meta = '';

    if (cursorMode === 'measure' && measureState.distLine) {
        const L = measureState.distLine;
        const d = computeMeasureDistance(L);
        const unit = measureState.space === 'world' ? t('measureUnitWorld') : t('measureUnitPx');
        meta = `${t('measureDist')}: ${formatValue(d.dist)} ${unit} · ` +
            `${t('measureDelta')}X: ${formatValue(d.dx)} · ${t('measureDelta')}Y: ${formatValue(d.dy)}`;
        if (Number.isFinite(d.v0) || Number.isFinite(d.v1)) {
            meta += ` · V₀: ${formatValue(d.v0)} · V₁: ${formatValue(d.v1)}`;
        }
        show = true;
    } else if (cursorMode === 'area' && measureState.areaStats) {
        const s = measureState.areaStats;
        const countLabel = s.scatter ? t('measureAreaPoints') : t('measureAreaPixels');
        meta = `${countLabel}: ${s.count} · ${t('measureAreaValid')}: ${s.valid} · ` +
            `${t('measureAreaSize')}: ${formatValue(s.w)}×${formatValue(s.h)} · ` +
            `Min: ${formatValue(s.min)} · Max: ${formatValue(s.max)} · ` +
            `${t('measureMean')}: ${formatValue(s.mean)} · ${t('measureStd')}: ${formatValue(s.std)}`;
        show = true;
    }

    measureMeta.textContent = meta;
    measurePanel.classList.toggle('show', show);
}

function clearMeasureDistance() {
    measureState.distDrawing = false;
    measureState.distLine = null;
    measureState.distEditMode = null;
    measureState.distEditStart = null;
    updateMeasurePanel();
    drawProfileOverlay();
}

function clearMeasureArea() {
    measureState.areaDrawing = false;
    measureState.areaRect = null;
    measureState.areaStats = null;
    measureState.areaEditMode = null;
    measureState.areaEditStart = null;
    updateMeasurePanel();
    drawProfileOverlay();
}

function measureDistHitTest(clientX, clientY) {
    const L = measureState.distLine;
    if (!L) return null;
    const rect = viewerEl.getBoundingClientRect();
    const mx = clientX - rect.left, my = clientY - rect.top;
    const space = measureState.space;
    const a = overlayPtToScreen(L.x0, L.y0, space);
    const b = overlayPtToScreen(L.x1, L.y1, space);
    const r = MEASURE_HIT_RADIUS;

    if (Math.hypot(mx - a.x, my - a.y) <= r) return 'ep0';
    if (Math.hypot(mx - b.x, my - b.y) <= r) return 'ep1';

    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 > 0) {
        let t = ((mx - a.x) * dx + (my - a.y) * dy) / len2;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        if (Math.hypot(mx - (a.x + t * dx), my - (a.y + t * dy)) <= r) return 'move';
    }
    return null;
}

function measureAreaHitTest(clientX, clientY) {
    const R = measureState.areaRect;
    if (!R || !measureState.areaStats) return null;
    const rect = viewerEl.getBoundingClientRect();
    const mx = clientX - rect.left, my = clientY - rect.top;
    const space = measureState.space;
    const n = normalizeMeasureRect(R);
    const corners = [
        { id: 'tl', x: n.x0, y: n.y0 },
        { id: 'tr', x: n.x1, y: n.y0 },
        { id: 'bl', x: n.x0, y: n.y1 },
        { id: 'br', x: n.x1, y: n.y1 },
    ];
    for (const c of corners) {
        const s = overlayPtToScreen(c.x, c.y, space);
        if (Math.hypot(mx - s.x, my - s.y) <= MEASURE_HIT_RADIUS) return c.id;
    }
    const tl = overlayPtToScreen(n.x0, n.y0, space);
    const br = overlayPtToScreen(n.x1, n.y1, space);
    const minX = Math.min(tl.x, br.x), maxX = Math.max(tl.x, br.x);
    const minY = Math.min(tl.y, br.y), maxY = Math.max(tl.y, br.y);
    if (mx >= minX && mx <= maxX && my >= minY && my <= maxY) return 'move';
    return null;
}

function drawMeasureDistOverlay(ctx) {
    const L = measureState.distLine;
    const space = measureState.space;
    const a = overlayPtToScreen(L.x0, L.y0, space);
    const b = overlayPtToScreen(L.x1, L.y1, space);

    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 4; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = '#3ecf8e'; ctx.lineWidth = 2; ctx.stroke();

    for (const p of [a, b]) {
        ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#3ecf8e'; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
    }

    const midX = (a.x + b.x) * 0.5, midY = (a.y + b.y) * 0.5;
    const d = computeMeasureDistance(L);
    const unit = space === 'world' ? t('measureUnitWorld') : t('measureUnitPx');
    const label = `${formatValue(d.dist)} ${unit}`;
    ctx.font = '12px Consolas, monospace';
    const tw = ctx.measureText(label).width + 10;
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(midX - tw * 0.5, midY - 20, tw, 18);
    ctx.fillStyle = '#3ecf8e';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, midX, midY - 11);
    ctx.textAlign = 'left';
}

function drawMeasureAreaOverlay(ctx) {
    const R = normalizeMeasureRect(measureState.areaRect);
    const space = measureState.space;
    const tl = overlayPtToScreen(R.x0, R.y0, space);
    const tr = overlayPtToScreen(R.x1, R.y0, space);
    const br = overlayPtToScreen(R.x1, R.y1, space);
    const bl = overlayPtToScreen(R.x0, R.y1, space);

    ctx.beginPath();
    ctx.moveTo(tl.x, tl.y); ctx.lineTo(tr.x, tr.y);
    ctx.lineTo(br.x, br.y); ctx.lineTo(bl.x, bl.y); ctx.closePath();
    ctx.fillStyle = 'rgba(255, 180, 74, 0.15)';
    ctx.fill();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = 'rgba(255, 180, 74, 0.85)'; ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);

    for (const p of [tl, tr, br, bl]) {
        ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#ffb84a'; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
    }
}

function finishMeasureDistance() {
    const L = measureState.distLine;
    if (!L || Math.hypot(L.x1 - L.x0, L.y1 - L.y0) < measureMinLineLen()) {
        clearMeasureDistance();
        return;
    }
    updateMeasurePanel();
    drawProfileOverlay();
}

function finishMeasureArea() {
    const R = measureState.areaRect;
    if (!R) { clearMeasureArea(); return; }
    const n = normalizeMeasureRect(R);
    if ((n.x1 - n.x0) < measureMinRectSize() || (n.y1 - n.y0) < measureMinRectSize()) {
        clearMeasureArea();
        return;
    }
    measureState.areaRect = n;
    measureState.areaStats = computeAreaStats(n);
    if (measureState.areaStats.valid === 0) showToast(t('measureAreaEmpty'), 'info');
    updateMeasurePanel();
    drawProfileOverlay();
}

if (measureClearBtn) {
    measureClearBtn.addEventListener('click', () => {
        if (cursorMode === 'area') clearMeasureArea();
        else clearMeasureDistance();
    });
}

viewerEl.addEventListener('mousedown', (e) => {
    if (view3dActive) return;
    if (cursorMode !== 'measure') return;
    if (e.button !== 0) return;
    if (!currentDataset) return;
    if (e.target.closest && (e.target.closest('.profile-panel') || e.target.closest('.measure-panel'))) return;

    measureState.space = overlaySpaceForDataset();

    if (measureState.distLine) {
        const hit = measureDistHitTest(e.clientX, e.clientY);
        if (hit) {
            measureState.distEditMode = hit;
            measureState.distEditStart = {
                pt: overlayMouseToPt(e.clientX, e.clientY),
                line: { ...measureState.distLine },
            };
            viewerEl.style.cursor = hit === 'move' ? 'grabbing' : 'crosshair';
            e.preventDefault();
            return;
        }
    }

    const p = overlayMouseToPt(e.clientX, e.clientY);
    measureState.distDrawing = true;
    measureState.distEditMode = null;
    measureState.distEditStart = null;
    measureState.distLine = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    updateMeasurePanel();
    drawProfileOverlay();
    e.preventDefault();
});

viewerEl.addEventListener('mousedown', (e) => {
    if (view3dActive) return;
    if (cursorMode !== 'area') return;
    if (e.button !== 0) return;
    if (!currentDataset) return;
    if (e.target.closest && (e.target.closest('.profile-panel') || e.target.closest('.measure-panel'))) return;

    measureState.space = overlaySpaceForDataset();

    if (measureState.areaRect && measureState.areaStats) {
        const hit = measureAreaHitTest(e.clientX, e.clientY);
        if (hit) {
            measureState.areaEditMode = hit;
            measureState.areaEditStart = {
                pt: overlayMouseToPt(e.clientX, e.clientY),
                rect: { ...measureState.areaRect },
            };
            viewerEl.style.cursor = hit === 'move' ? 'grabbing' : 'crosshair';
            e.preventDefault();
            return;
        }
    }

    const p = overlayMouseToPt(e.clientX, e.clientY);
    measureState.areaDrawing = true;
    measureState.areaEditMode = null;
    measureState.areaEditStart = null;
    measureState.areaRect = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    measureState.areaStats = null;
    updateMeasurePanel();
    drawProfileOverlay();
    e.preventDefault();
});

viewerEl.addEventListener('mousemove', (e) => {
    if (view3dActive) return;
    if (profileState.drawing || profileState.editMode) return;
    if (measureState.distDrawing || measureState.distEditMode
        || measureState.areaDrawing || measureState.areaEditMode) return;

    if (cursorMode === 'measure' && measureState.distLine && !measureState.distDrawing) {
        const hit = measureDistHitTest(e.clientX, e.clientY);
        if (hit === 'ep0' || hit === 'ep1') viewerEl.style.cursor = 'pointer';
        else if (hit === 'move') viewerEl.style.cursor = 'move';
        else viewerEl.style.cursor = '';
        return;
    }
    if (cursorMode === 'area' && measureState.areaRect && measureState.areaStats && !measureState.areaDrawing) {
        const hit = measureAreaHitTest(e.clientX, e.clientY);
        if (hit && hit !== 'move') viewerEl.style.cursor = 'nwse-resize';
        else if (hit === 'move') viewerEl.style.cursor = 'move';
        else viewerEl.style.cursor = '';
    }
});

window.addEventListener('mousemove', (e) => {
    if (measureState.distEditMode && measureState.distEditStart) {
        const p = overlayMouseToPt(e.clientX, e.clientY);
        const s = measureState.distEditStart;
        const dx = p.x - s.pt.x, dy = p.y - s.pt.y;
        let L;
        if (measureState.distEditMode === 'ep0') {
            L = { ...measureState.distLine, x0: s.line.x0 + dx, y0: s.line.y0 + dy };
        } else if (measureState.distEditMode === 'ep1') {
            L = { ...measureState.distLine, x1: s.line.x1 + dx, y1: s.line.y1 + dy };
        } else {
            L = {
                x0: s.line.x0 + dx, y0: s.line.y0 + dy,
                x1: s.line.x1 + dx, y1: s.line.y1 + dy,
            };
        }
        if (measureState.space === 'image') L = clampMeasureLine(L);
        measureState.distLine = L;
        updateMeasurePanel();
        drawProfileOverlay();
        return;
    }
    if (measureState.areaEditMode && measureState.areaEditStart) {
        const p = overlayMouseToPt(e.clientX, e.clientY);
        const s = measureState.areaEditStart;
        const dx = p.x - s.pt.x, dy = p.y - s.pt.y;
        let R = { ...s.rect };
        if (measureState.areaEditMode === 'move') {
            R = { x0: s.rect.x0 + dx, y0: s.rect.y0 + dy, x1: s.rect.x1 + dx, y1: s.rect.y1 + dy };
        } else if (measureState.areaEditMode === 'tl') {
            R = { x0: p.x, y0: p.y, x1: s.rect.x1, y1: s.rect.y1 };
        } else if (measureState.areaEditMode === 'tr') {
            R = { x0: s.rect.x0, y0: p.y, x1: p.x, y1: s.rect.y1 };
        } else if (measureState.areaEditMode === 'bl') {
            R = { x0: p.x, y0: s.rect.y0, x1: s.rect.x1, y1: p.y };
        } else if (measureState.areaEditMode === 'br') {
            R = { x0: s.rect.x0, y0: s.rect.y0, x1: p.x, y1: p.y };
        }
        if (measureState.space === 'image') R = clampMeasureRect(R);
        measureState.areaRect = R;
        measureState.areaStats = computeAreaStats(R);
        updateMeasurePanel();
        drawProfileOverlay();
        return;
    }
    if (measureState.distDrawing) {
        const p = overlayMouseToPt(e.clientX, e.clientY);
        measureState.distLine.x1 = p.x;
        measureState.distLine.y1 = p.y;
        updateMeasurePanel();
        drawProfileOverlay();
        return;
    }
    if (measureState.areaDrawing) {
        const p = overlayMouseToPt(e.clientX, e.clientY);
        measureState.areaRect.x1 = p.x;
        measureState.areaRect.y1 = p.y;
        drawProfileOverlay();
        return;
    }
});

window.addEventListener('mouseup', () => {
    if (measureState.distEditMode) {
        const L = measureState.distLine;
        const revert = measureState.distEditStart && measureState.distEditStart.line;
        if (!L || Math.hypot(L.x1 - L.x0, L.y1 - L.y0) < measureMinLineLen()) {
            if (revert) measureState.distLine = { ...revert };
        }
        measureState.distEditMode = null;
        measureState.distEditStart = null;
        viewerEl.style.cursor = '';
        updateMeasurePanel();
        drawProfileOverlay();
        return;
    }
    if (measureState.areaEditMode) {
        const revert = measureState.areaEditStart && measureState.areaEditStart.rect;
        const R = measureState.areaRect;
        const n = R ? normalizeMeasureRect(R) : null;
        if (!n || (n.x1 - n.x0) < measureMinRectSize() || (n.y1 - n.y0) < measureMinRectSize()) {
            if (revert) {
                measureState.areaRect = { ...revert };
                measureState.areaStats = computeAreaStats(revert);
            } else {
                measureState.areaRect = null;
                measureState.areaStats = null;
            }
        } else {
            measureState.areaRect = n;
            measureState.areaStats = computeAreaStats(n);
        }
        measureState.areaEditMode = null;
        measureState.areaEditStart = null;
        viewerEl.style.cursor = '';
        updateMeasurePanel();
        drawProfileOverlay();
        return;
    }
    if (measureState.distDrawing) {
        measureState.distDrawing = false;
        finishMeasureDistance();
        return;
    }
    if (measureState.areaDrawing) {
        measureState.areaDrawing = false;
        finishMeasureArea();
    }
});


const modeIndicator = document.getElementById('modeIndicator');
const modeIndicatorLabel = document.getElementById('modeIndicatorLabel');
const viewerCursorToolbar = document.getElementById('viewerCursorToolbar');
const CURSOR_MODE_BTNS = '#cursorToggle button, #viewerCursorToolbar button';

/** 同步頂部與浮空工具列的滑鼠模式按鈕 active 狀態 */
function syncCursorModeButtons(mode) {
    document.querySelectorAll(CURSOR_MODE_BTNS).forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-cursor') === mode);
    });
}

/** 更新左上角「目前滑鼠模式」標章與右側浮空工具列（僅在 2D 且已載入資料時顯示） */
function updateModeIndicator() {
    const in3d = (typeof view3dActive !== 'undefined') && view3dActive;
    const showTools = !!currentDataset && !in3d;

    if (modeIndicator && modeIndicatorLabel) {
        const key = cursorMode === 'inspect' ? 'modeBadgeInspect'
                  : cursorMode === 'profile' ? 'modeBadgeProfile'
                  : cursorMode === 'measure' ? 'modeBadgeMeasure'
                  : cursorMode === 'area' ? 'modeBadgeArea'
                  : 'modeBadgePan';
        modeIndicatorLabel.textContent = t(key);
        modeIndicator.classList.toggle('show', showTools);
    }
    if (viewerCursorToolbar) {
        viewerCursorToolbar.classList.toggle('show', showTools);
    }
}

/** 切換鼠標模式 */
function applyCursorMode(mode, opts) {
    opts = opts || {};
    if (mode !== 'pan' && mode !== 'inspect' && mode !== 'profile'
        && mode !== 'measure' && mode !== 'area') mode = 'pan';

    cursorMode = mode;
    setUserPref('cursorMode', mode);

    syncCursorModeButtons(mode);

    // Canvas 鼠標樣式
    canvasEl.classList.toggle('inspect-mode', mode === 'inspect');
    canvasEl.classList.toggle('profile-mode', mode === 'profile');
    canvasEl.classList.toggle('measure-mode', mode === 'measure');
    canvasEl.classList.toggle('area-mode', mode === 'area');
    viewerEl.classList.toggle('profile-mode', mode === 'profile');
    viewerEl.classList.toggle('measure-mode', mode === 'measure');
    viewerEl.classList.toggle('area-mode', mode === 'area');

    // 切離 inspect 模式時隱藏數值顯示器
    if (mode !== 'inspect') {
        valueIndicator.classList.remove('show');
    }

    // 切換模式時結束任何尚未結束的平移
    if (panning) {
        panning = false;
        canvasEl.classList.remove('grabbing');
    }

    // 進入剖面模式時顯示提示；離開時取消任何進行中的拉線或編輯
    if (mode === 'profile' && !opts.silent) {
        const hint = isPcdScatterDataset(currentDataset) ? 'profileHintScatter' : 'profileHint';
        showToast(t(hint), 'info');
    } else if (profileState.drawing || profileState.editMode) {
        profileState.drawing = false;
        profileState.editMode = null;
        profileState.editStart = null;
        viewerEl.style.cursor = '';
    }

    if (mode === 'measure' && !opts.silent) {
        const hint = isPcdScatterDataset(currentDataset) ? 'measureHintScatter' : 'measureHint';
        showToast(t(hint), 'info');
    } else if (measureState.distDrawing || measureState.distEditMode) {
        measureState.distDrawing = false;
        measureState.distEditMode = null;
        measureState.distEditStart = null;
        viewerEl.style.cursor = '';
    }

    if (mode === 'area' && !opts.silent) {
        const hint = isPcdScatterDataset(currentDataset) ? 'areaHintScatter' : 'areaHint';
        showToast(t(hint), 'info');
    } else if (measureState.areaDrawing || measureState.areaEditMode) {
        measureState.areaDrawing = false;
        measureState.areaEditMode = null;
        measureState.areaEditStart = null;
        viewerEl.style.cursor = '';
    }

    if (typeof updateMeasurePanel === 'function') updateMeasurePanel();
    updateModeIndicator();
}

// 鼠標模式切換按鈕事件（頂部工具列 + 圖像區浮空工具列）
document.querySelectorAll(CURSOR_MODE_BTNS).forEach(btn => {
    btn.addEventListener('click', () => {
        applyCursorMode(btn.getAttribute('data-cursor'));
    });
});

// Max/Min 數值點標記切換
const btnMinMax = document.getElementById('btnMinMax');
if (btnMinMax) {
    btnMinMax.addEventListener('click', () => {
        showMinMax = !showMinMax;
        setUserPref('showMinMax', showMinMax);
        btnMinMax.classList.toggle('tool-active', showMinMax);
        btnMinMax.setAttribute('aria-pressed', showMinMax ? 'true' : 'false');
        if (showMinMax && !currentDataset) {
            showToast(t('toastNoData'), 'info');
        }
        drawProfileOverlay();
    });
}

// 雙擊還原 fit
viewerEl.addEventListener('dblclick', (e) => {
    if (view3dActive) return;
    if (!currentDataset) return;
    e.preventDefault();
    fitImageToViewer();
});

// 初始繪製 colorbar
renderColorbar(cmapSelect.value);
setupColorbarHandles();

// 語言切換
document.querySelectorAll('#langToggle button').forEach(btn => {
    btn.addEventListener('click', () => {
        applyLanguage(btn.getAttribute('data-lang'));
    });
});

// 「更多」下拉選單：關閉（開關由 setupOverflowToolbar 統一處理）
function closeMoreMenu() {
    const wrap = document.getElementById('viewerMoreWrap');
    const btn  = document.getElementById('btnMore');
    if (!wrap) return;
    wrap.classList.remove('open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
}
document.addEventListener('click', () => {
    closeMoreMenu();
    if (typeof closeEdMoreMenu === 'function') closeEdMoreMenu();
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeMoreMenu();
        if (typeof closeEdMoreMenu === 'function') closeEdMoreMenu();
        closeAllColormapPickers();
    }
});


