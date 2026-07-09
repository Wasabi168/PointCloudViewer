/**
 * 應用程式初始化與頁面切換
 * 依賴：所有模組
 * 匯出（全域）：switchPage(), 啟動邏輯
 */
/* =========================================================================
 *  7. 視窗切換 (點雲檢視器 / 點雲編輯器 / 批次編輯 / 批次轉檔)
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

document.querySelectorAll('.app-tab').forEach(btn => {
    btn.addEventListener('click', () => switchPage(btn.getAttribute('data-page')));
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
