/**
 * 應用程式初始化與頁面切換
 * 依賴：所有模組
 * 匯出（全域）：switchPage(), 啟動邏輯
 */
/* =========================================================================
 *  7. 視窗切換 (點雲檢視器 / 點雲編輯器 / 批次編輯 / 批次轉檔，可按 Tab 循環切換)
 * ========================================================================= */
const APP_PAGES = ['viewer', 'editor', 'batchEdit', 'batch'];
let currentPage = 'viewer';

function switchPage(page) {
    if (!APP_PAGES.includes(page) || page === currentPage) return;
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
        }
    });
}

function toggleAppPage() {
    const idx = APP_PAGES.indexOf(currentPage);
    switchPage(APP_PAGES[(idx + 1) % APP_PAGES.length]);
}

document.querySelectorAll('.app-tab').forEach(btn => {
    btn.addEventListener('click', () => switchPage(btn.getAttribute('data-page')));
});

// 按 Tab 在兩個視窗之間來回切換
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey) return;
    // 計算機或說明視窗開啟時，保留原本的鍵盤操作
    if (typeof calcOverlay !== 'undefined' && calcOverlay && calcOverlay.classList.contains('show')) return;
    if (typeof infoOverlay !== 'undefined' && infoOverlay && infoOverlay.classList.contains('show')) return;
    if (typeof segLevelInfoOverlay !== 'undefined' && segLevelInfoOverlay && segLevelInfoOverlay.classList.contains('show')) return;
    if (typeof segSkewInfoOverlay !== 'undefined' && segSkewInfoOverlay && segSkewInfoOverlay.classList.contains('show')) return;
    // 焦點在輸入欄位時不攔截，避免影響表單操作
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' ||
               ae.tagName === 'SELECT' || ae.isContentEditable)) return;
    e.preventDefault();
    toggleAppPage();
});

// 套用已儲存的游標模式與 Max/Min 偏好
applyCursorMode(cursorMode, { silent: true });
if (btnMinMax) {
    btnMinMax.classList.toggle('tool-active', showMinMax);
    btnMinMax.setAttribute('aria-pressed', showMinMax ? 'true' : 'false');
}

// 還原上次使用的頁面
const savedPage = getUserPref('page');
if (savedPage === 'editor' || savedPage === 'batch' || savedPage === 'batchEdit') switchPage(savedPage);
else if (typeof BatchFileManager !== 'undefined' && BatchFileManager.setPageContext) {
    BatchFileManager.setPageContext(currentPage);
}

// 套用初始語言
applyLanguage(currentLang);
