/**
 * 應用程式初始化與頁面切換
 * 依賴：所有模組
 * 匯出（全域）：switchPage(), syncCrossLoadPrompt(), 啟動邏輯
 */
/* =========================================================================
 *  7. 視窗切換 (點雲檢視器 / 點雲編輯器 / 批次編輯 / 批次轉檔)
 * ========================================================================= */
const APP_PAGES = ['viewer', 'editor', 'analysis', 'batchEdit', 'batch'];
let currentPage = 'viewer';

/** 暫時詢問停留時間，之後才開始淡出 */
const CROSS_LOAD_HOLD_MS = 5000;
/** 與 CSS transition 時間一致；系統要求減少動態時縮短 */
const CROSS_LOAD_FADE_MS = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 200 : 1400;

const crossLoadPromptEl = document.getElementById('crossLoadPrompt');
const crossLoadTextEl = document.getElementById('crossLoadPromptText');
const crossLoadTimerBar = document.getElementById('crossLoadTimerBar');
let crossLoadActive = false;
let crossLoadPaused = false;
let crossLoadRemain = 0;
let crossLoadDeadline = 0;
let crossLoadTimer = null;
let crossLoadFadeTimer = null;
let crossLoadRaf = 0;

function viewerHasData() {
    return typeof currentDataset !== 'undefined' && !!currentDataset;
}

function editorHasData() {
    return typeof editorView !== 'undefined' && editorView.hasData && editorView.hasData();
}

/** 語系切換時重畫詢問文字 */
function syncCrossLoadPrompt() {
    if (!crossLoadPromptEl || crossLoadPromptEl.hidden) return;
    const source = crossLoadPromptEl.dataset.source;
    const name = crossLoadPromptEl.dataset.filename || '';
    if (!crossLoadTextEl || (source !== 'viewer' && source !== 'editor')) return;
    if (name) {
        const key = source === 'viewer' ? 'crossLoadToEditor' : 'crossLoadToViewer';
        crossLoadTextEl.textContent = t(key, name);
    } else {
        const key = source === 'viewer' ? 'crossLoadToEditorPlain' : 'crossLoadToViewerPlain';
        crossLoadTextEl.textContent = t(key);
    }
}

function tickCrossLoadBar() {
    if (!crossLoadActive || crossLoadPaused || !crossLoadTimerBar) return;
    const left = Math.max(0, crossLoadDeadline - performance.now());
    crossLoadTimerBar.style.transform = 'scaleX(' + (left / CROSS_LOAD_HOLD_MS) + ')';
    if (left > 0) crossLoadRaf = requestAnimationFrame(tickCrossLoadBar);
}

function armCrossLoadTimer() {
    crossLoadDeadline = performance.now() + crossLoadRemain;
    if (crossLoadTimer) clearTimeout(crossLoadTimer);
    crossLoadTimer = setTimeout(() => dismissCrossLoad(false), crossLoadRemain);
    tickCrossLoadBar();
}

function pauseCrossLoad() {
    if (!crossLoadActive || crossLoadPaused) return;
    crossLoadRemain = Math.max(0, crossLoadDeadline - performance.now());
    crossLoadPaused = true;
    if (crossLoadTimer) clearTimeout(crossLoadTimer);
    crossLoadTimer = null;
    if (crossLoadRaf) cancelAnimationFrame(crossLoadRaf);
    crossLoadRaf = 0;
}

function resumeCrossLoad() {
    if (!crossLoadActive || !crossLoadPaused) return;
    crossLoadPaused = false;
    if (crossLoadRemain <= 0) {
        dismissCrossLoad(false);
        return;
    }
    armCrossLoadTimer();
}

function dismissCrossLoad(immediate) {
    if (!crossLoadPromptEl) return;
    if (!crossLoadActive && crossLoadPromptEl.hidden && !crossLoadFadeTimer) return;
    crossLoadActive = false;
    crossLoadPaused = false;
    if (crossLoadTimer) clearTimeout(crossLoadTimer);
    crossLoadTimer = null;
    if (crossLoadRaf) cancelAnimationFrame(crossLoadRaf);
    crossLoadRaf = 0;
    if (crossLoadFadeTimer) clearTimeout(crossLoadFadeTimer);
    crossLoadFadeTimer = null;
    crossLoadPromptEl.classList.remove('show');
    if (immediate) {
        crossLoadPromptEl.hidden = true;
        crossLoadPromptEl.setAttribute('aria-hidden', 'true');
        return;
    }
    crossLoadFadeTimer = setTimeout(() => {
        crossLoadFadeTimer = null;
        if (crossLoadActive) return;
        crossLoadPromptEl.hidden = true;
        crossLoadPromptEl.setAttribute('aria-hidden', 'true');
    }, CROSS_LOAD_FADE_MS);
}

/**
 * 使用者手動從有圖的頁面切到沒有圖的另一頁時，在角落詢問是否載入。
 * 只在分頁按鈕觸發；「傳送到檢視／編輯」不會再問一次。
 */
function offerCrossPageLoad(from, to) {
    if (!crossLoadPromptEl) return;
    if (typeof datasetTransferInProgress !== 'undefined' && datasetTransferInProgress) {
        dismissCrossLoad(true);
        return;
    }
    let source = null;
    if (from === 'viewer' && to === 'editor' && viewerHasData() && !editorHasData()) source = 'viewer';
    else if (from === 'editor' && to === 'viewer' && editorHasData() && !viewerHasData()) source = 'editor';
    if (!source) {
        dismissCrossLoad(false);
        return;
    }

    const filename = source === 'viewer'
        ? ((currentDataset && currentDataset.filename) || '')
        : (editorView.getFilename ? editorView.getFilename() : '');
    dismissCrossLoad(true);
    crossLoadPromptEl.dataset.source = source;
    crossLoadPromptEl.dataset.filename = filename;
    crossLoadPromptEl.hidden = false;
    crossLoadPromptEl.setAttribute('aria-hidden', 'false');
    syncCrossLoadPrompt();
    if (crossLoadTimerBar) crossLoadTimerBar.style.transform = 'scaleX(1)';
    crossLoadPromptEl.classList.remove('show');
    void crossLoadPromptEl.offsetWidth;
    crossLoadPromptEl.classList.add('show');
    crossLoadActive = true;
    crossLoadPaused = false;
    crossLoadRemain = CROSS_LOAD_HOLD_MS;
    armCrossLoadTimer();
}

function acceptCrossLoad() {
    const source = crossLoadPromptEl ? crossLoadPromptEl.dataset.source : '';
    dismissCrossLoad(true);
    if (source === 'viewer') {
        if (!viewerHasData() || editorHasData() || typeof editorView === 'undefined' || !editorView.loadDataset) return;
        const clone = cloneDatasetForTransfer(currentDataset);
        const cmapEl = document.getElementById('colormap');
        const opts = cmapEl ? { colormap: cmapEl.value } : undefined;
        if (editorView.loadDataset(clone, opts)) showToast(t('sentToEditor'), 'info');
    } else if (source === 'editor') {
        if (viewerHasData() || !editorHasData() || typeof loadDatasetIntoViewer !== 'function') return;
        const ds = editorView.getDataset();
        const cmapEl = document.getElementById('edColormap');
        const opts = cmapEl ? { colormap: cmapEl.value } : undefined;
        if (ds && loadDatasetIntoViewer(ds, opts)) showToast(t('sentToViewer'), 'info');
    }
}

if (crossLoadPromptEl) {
    crossLoadPromptEl.addEventListener('pointerenter', pauseCrossLoad);
    crossLoadPromptEl.addEventListener('pointerleave', resumeCrossLoad);
    const yesBtn = document.getElementById('crossLoadYes');
    const noBtn = document.getElementById('crossLoadNo');
    if (yesBtn) yesBtn.addEventListener('click', acceptCrossLoad);
    if (noBtn) noBtn.addEventListener('click', () => dismissCrossLoad(false));
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || crossLoadPromptEl.hidden) return;
        dismissCrossLoad(false);
    });
}

function switchPage(page, opts) {
    if (!APP_PAGES.includes(page) || page === currentPage) return;
    const from = currentPage;
    opts = opts || {};
    currentPage = page;
    setUserPref('page', page);
    document.querySelectorAll('.page').forEach(el => {
        el.classList.toggle('active', el.getAttribute('data-page') === page);
    });
    document.querySelectorAll('.app-tab').forEach(btn => {
        const active = btn.getAttribute('data-page') === page;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (typeof BatchFileManager !== 'undefined' && BatchFileManager.setPageContext) {
        BatchFileManager.setPageContext(page);
    }
    requestAnimationFrame(() => {
        if (page === 'editor') {
            // 切換到編輯器時重新調整影像（隱藏狀態下尺寸為 0，需重新 fit）
            if (typeof editorView !== 'undefined') editorView.refit();
            if (typeof layoutEdToolbar === 'function') layoutEdToolbar();
        } else if (page === 'viewer') {
            if (typeof layoutViewerToolbar === 'function') layoutViewerToolbar();
        } else if (page === 'analysis') {
            if (typeof AnalysisView !== 'undefined' && AnalysisView.refit) AnalysisView.refit();
        }
        if (opts.offerLoad) offerCrossPageLoad(from, page);
        else dismissCrossLoad(true);
    });
}

document.querySelectorAll('.app-tab').forEach(btn => {
    btn.addEventListener('click', () => switchPage(btn.getAttribute('data-page'), { offerLoad: true }));
});

// 套用已儲存的游標模式與 Max/Min 偏好
applyCursorMode(cursorMode, { silent: true });
if (btnMinMax) {
    btnMinMax.classList.toggle('tool-active', showMinMax);
    btnMinMax.setAttribute('aria-pressed', showMinMax ? 'true' : 'false');
}

// 還原上次使用的頁面
const savedPage = getUserPref('page');
if (savedPage === 'editor' || savedPage === 'analysis' || savedPage === 'batch' || savedPage === 'batchEdit') {
    switchPage(savedPage);
}
else if (typeof BatchFileManager !== 'undefined' && BatchFileManager.setPageContext) {
    BatchFileManager.setPageContext(currentPage);
}

// 套用初始語言
applyLanguage(currentLang);
