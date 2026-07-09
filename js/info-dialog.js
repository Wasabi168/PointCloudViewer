/**
 * 關於與說明視窗
 * 依賴：i18n.js
 * 匯出（全域）：openInfoDialog(), closeInfoDialog(),
 *   openSegLevelInfoDialog(), closeSegLevelInfoDialog(),
 *   openSegSkewInfoDialog(), closeSegSkewInfoDialog()
 */

const btnInfo              = document.getElementById('btnInfo');
const infoOverlay          = document.getElementById('infoOverlay');
const infoCloseBtn         = document.getElementById('infoCloseBtn');
const btnSegLevelInfo      = document.getElementById('edSegLevelInfo');
const segLevelInfoOverlay  = document.getElementById('segLevelInfoOverlay');
const segLevelInfoCloseBtn = document.getElementById('segLevelInfoCloseBtn');
const btnSegSkewInfo       = document.getElementById('edSegSkewInfo');
const segSkewInfoOverlay   = document.getElementById('segSkewInfoOverlay');
const segSkewInfoCloseBtn  = document.getElementById('segSkewInfoCloseBtn');

function openInfoDialog() {
    if (infoOverlay) infoOverlay.classList.add('show');
}

function closeInfoDialog() {
    if (infoOverlay) infoOverlay.classList.remove('show');
}

function openSegLevelInfoDialog() {
    if (segLevelInfoOverlay) segLevelInfoOverlay.classList.add('show');
}

function closeSegLevelInfoDialog() {
    if (segLevelInfoOverlay) segLevelInfoOverlay.classList.remove('show');
}

function openSegSkewInfoDialog() {
    if (segSkewInfoOverlay) segSkewInfoOverlay.classList.add('show');
}

function closeSegSkewInfoDialog() {
    if (segSkewInfoOverlay) segSkewInfoOverlay.classList.remove('show');
}

function bindInfoOverlay(overlay, openFn, closeFn, triggerBtn, closeBtn) {
    if (triggerBtn) triggerBtn.addEventListener('click', openFn);
    if (closeBtn) closeBtn.addEventListener('click', closeFn);
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeFn();
        });
    }
}

bindInfoOverlay(infoOverlay, openInfoDialog, closeInfoDialog, btnInfo, infoCloseBtn);
bindInfoOverlay(segLevelInfoOverlay, openSegLevelInfoDialog, closeSegLevelInfoDialog, btnSegLevelInfo, segLevelInfoCloseBtn);
bindInfoOverlay(segSkewInfoOverlay, openSegSkewInfoDialog, closeSegSkewInfoDialog, btnSegSkewInfo, segSkewInfoCloseBtn);

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (infoOverlay && infoOverlay.classList.contains('show')) closeInfoDialog();
    if (segLevelInfoOverlay && segLevelInfoOverlay.classList.contains('show')) closeSegLevelInfoDialog();
    if (segSkewInfoOverlay && segSkewInfoOverlay.classList.contains('show')) closeSegSkewInfoDialog();
});
