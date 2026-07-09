/**
 * 關於與說明視窗
 * 依賴：i18n.js
 * 匯出（全域）：openInfoDialog(), closeInfoDialog()
 */

const btnInfo       = document.getElementById('btnInfo');
const infoOverlay   = document.getElementById('infoOverlay');
const infoCloseBtn  = document.getElementById('infoCloseBtn');

function openInfoDialog() {
    infoOverlay.classList.add('show');
}

function closeInfoDialog() {
    infoOverlay.classList.remove('show');
}

if (btnInfo) {
    btnInfo.addEventListener('click', openInfoDialog);
}
if (infoCloseBtn) {
    infoCloseBtn.addEventListener('click', closeInfoDialog);
}
if (infoOverlay) {
    infoOverlay.addEventListener('click', (e) => {
        if (e.target === infoOverlay) closeInfoDialog();
    });
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && infoOverlay && infoOverlay.classList.contains('show')) {
        closeInfoDialog();
    }
});
