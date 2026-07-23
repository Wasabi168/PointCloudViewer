/**
 * 使用者偏好 (localStorage)
 * 依賴：i18n.js
 * 匯出（全域）：userPrefs, getUserPref(), setUserPref(), saveUserPrefs()
 */
/* =========================================================================
 *  0b. 使用者偏好 (localStorage 持久化)
 * ========================================================================= */
const PREFS_STORAGE_KEY = 'pcviewer.prefs';
const PREFS_DEFAULTS = {
    colormap: 'jet',
    edColormap: 'jet',
    saveFormat: 'bcrf',
    edSaveFormat: 'bcrf',
    page: 'viewer',
    cursorMode: 'pan',
    viewMode: '2d',
    showMinMax: false,
    profileChartStyle: 'line',
    anNavCollapsed: false,
};

let userPrefs = (() => {
    try {
        const raw = localStorage.getItem(PREFS_STORAGE_KEY);
        if (raw) return { ...PREFS_DEFAULTS, ...JSON.parse(raw) };
    } catch (_) {}
    return { ...PREFS_DEFAULTS };
})();

function saveUserPrefs() {
    try { localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(userPrefs)); } catch (_) {}
}

function setUserPref(key, value) {
    if (!(key in PREFS_DEFAULTS)) return;
    userPrefs[key] = value;
    saveUserPrefs();
}

function getUserPref(key) {
    return userPrefs[key] ?? PREFS_DEFAULTS[key];
}

/** 將偏好套用到 <select>（僅在選項存在時） */
function applySelectPref(selectEl, key) {
    if (!selectEl) return;
    const v = getUserPref(key);
    if (v != null && [...selectEl.options].some(o => o.value === v)) {
        selectEl.value = v;
    }
}

function t(key, ...args) {
    const dict = I18N[currentLang] || I18N[DEFAULT_LANG];
    let s = (dict && dict[key] != null) ? dict[key] : (I18N[DEFAULT_LANG][key] ?? key);
    for (let i = 0; i < args.length; i++) {
        s = s.split('{' + i + '}').join(args[i]);
    }
    return s;
}

function applyLanguage(lang) {
    if (!I18N[lang]) lang = DEFAULT_LANG;
    currentLang = lang;
    try { localStorage.setItem('pcviewer.lang', lang); } catch (_) {}

    document.documentElement.lang = lang;

    // 更新所有帶 data-i18n 的節點
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        el.textContent = t(key);
    });

    // 標題
    const titleEl = document.querySelector('title[data-i18n-title]');
    if (titleEl) titleEl.textContent = t('appTitle');

    // 通用 tooltip 翻譯（data-i18n-title="key" 會更新該節點的 title 屬性）
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        if (key) el.title = t(key);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(el => {
        const key = el.getAttribute('data-i18n-aria');
        if (key) el.setAttribute('aria-label', t(key));
    });
    document.querySelectorAll('#viewerCursorToolbar button[data-i18n-title]').forEach(el => {
        el.setAttribute('aria-label', el.title);
    });
    document.querySelectorAll('#profilePanel button[data-i18n-title], #measurePanel button[data-i18n-title]').forEach(el => {
        el.setAttribute('aria-label', el.title);
    });
    const viewerCursorToolbar = document.getElementById('viewerCursorToolbar');
    if (viewerCursorToolbar) {
        viewerCursorToolbar.setAttribute('aria-label', t('cursorToolbarLabel'));
    }

    // 語言切換按鈕的 active 狀態
    document.querySelectorAll('#langToggle button').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-lang') === lang);
    });

    // 鼠標模式切換按鈕的 title
    const cursorPanBtn = document.querySelector('#cursorToggle button[data-cursor="pan"]');
    const cursorInspectBtn = document.querySelector('#cursorToggle button[data-cursor="inspect"]');
    const cursorProfileBtn = document.querySelector('#cursorToggle button[data-cursor="profile"]');
    const cursorMeasureBtn = document.querySelector('#cursorToggle button[data-cursor="measure"]');
    const cursorAreaBtn = document.querySelector('#cursorToggle button[data-cursor="area"]');
    if (cursorPanBtn) cursorPanBtn.title = t('cursorPanTitle');
    if (cursorInspectBtn) cursorInspectBtn.title = t('cursorInspectTitle');
    if (cursorProfileBtn) cursorProfileBtn.title = t('cursorProfileTitle');
    if (cursorMeasureBtn) cursorMeasureBtn.title = t('cursorMeasureTitle');
    if (cursorAreaBtn) cursorAreaBtn.title = t('cursorAreaTitle');
    const btnSendToEditor = document.getElementById('btnSendToEditor');
    if (btnSendToEditor) btnSendToEditor.title = t('sendToEditorTitle');
    const btnSendToAnalysis = document.getElementById('btnSendToAnalysis');
    if (btnSendToAnalysis) btnSendToAnalysis.title = t('sendToAnalysisTitle');
    const edSendToAnalysis = document.getElementById('edSendToAnalysis');
    if (edSendToAnalysis) edSendToAnalysis.title = t('sendToAnalysisTitle');

    // 目前模式標章文字（隨語言更新）
    if (typeof updateModeIndicator === 'function') updateModeIndicator();

    // Max/Min 標記切換按鈕的 title
    const minmaxBtn = document.getElementById('btnMinMax');
    if (minmaxBtn) minmaxBtn.title = t('btnMinMaxTitle');

    // 2D / 3D 顯示切換按鈕的 title
    const view2dBtn = document.querySelector('#viewModeToggle button[data-viewmode="2d"]');
    const view3dBtn = document.querySelector('#viewModeToggle button[data-viewmode="3d"]');
    if (view2dBtn) view2dBtn.title = t('view2dTitle');
    if (view3dBtn) view3dBtn.title = t('view3dTitle');

    // 剖面面板若開啟中則重新繪製（更新語系文字）
    if (typeof profileState !== 'undefined' && profileState && profileState.data) {
        renderProfileChart();
    }
    if (typeof updateMeasurePanel === 'function') updateMeasurePanel();

    // 計算機輸入框 placeholder
    const calcOperandInput = document.getElementById('calcOperand');
    if (calcOperandInput) calcOperandInput.placeholder = t('calcOperandPlaceholder');

    // 批次轉檔：空清單提示
    const batchListEl = document.getElementById('batchFileList');
    if (batchListEl) batchListEl.setAttribute('data-empty', t('batchStatusIdle'));

    // 狀態列依情境更新：已載入則重新翻譯，否則為 idle
    if (typeof statusEl !== 'undefined' && statusEl) {
        if (typeof currentDataset !== 'undefined' && currentDataset) {
            if (currentDataset.type === 'pcd-scatter') {
                statusEl.textContent = t('statusLoadedPcd',
                    currentDataset.filename,
                    currentDataset.pointCount);
            } else {
                statusEl.textContent = t('statusLoaded',
                    currentDataset.filename,
                    currentDataset.width,
                    currentDataset.height);
            }
        } else {
            statusEl.textContent = t('statusIdle');
        }
    }
    // 儲存按鈕若非儲存中，更新 tooltip
    if (typeof btnSave !== 'undefined' && btnSave && !btnSave.disabled && !btnSave.classList.contains('is-busy')) {
        btnSave.title = t('btnSave');
        btnSave.setAttribute('aria-label', t('btnSave'));
    }
    if (typeof btnClear !== 'undefined' && btnClear) {
        btnClear.title = t('btnClearTitle');
        btnClear.setAttribute('aria-label', t('btnClearTitle'));
    }
    // 更新拖放提示 (依目前是否為 drag-reject 狀態)
    if (typeof dropText !== 'undefined' && dropText && typeof viewerEl !== 'undefined' && viewerEl) {
        dropText.textContent = viewerEl.classList.contains('drag-reject')
            ? t('dropReject') : t('dropSupported');
    }

    // 同步「點雲編輯器」的動態文字（狀態列、儲存按鈕）
    if (typeof editorView !== 'undefined' && editorView && editorView.syncLang) {
        editorView.syncLang();
    }
    if (typeof AnalysisView !== 'undefined' && AnalysisView && AnalysisView.syncLang) {
        AnalysisView.syncLang();
    }

    if (typeof BatchFileManager !== 'undefined' && BatchFileManager.refreshLastEditHint) {
        BatchFileManager.refreshLastEditHint();
    }

    // 語系切換後按鈕文字寬度改變，需重新計算工具列收納
    requestAnimationFrame(() => {
        if (typeof layoutViewerToolbar === 'function') layoutViewerToolbar();
        if (typeof layoutEdToolbar === 'function') layoutEdToolbar();
    });
}


