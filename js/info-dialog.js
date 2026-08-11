/**
 * 關於與說明視窗
 * 依賴：i18n.js
 * 匯出（全域）：openInfoDialog(), closeInfoDialog(),
 *   openSegLevelInfoDialog(), closeSegLevelInfoDialog(),
 *   openRoiLevelInfoDialog(), closeRoiLevelInfoDialog(),
 *   openSegSkewInfoDialog(), closeSegSkewInfoDialog(),
 *   openAnLambdaSInfoDialog(), closeAnLambdaSInfoDialog(),
 *   openAnLambdaCInfoDialog(), closeAnLambdaCInfoDialog(),
 *   openAnPfLambdaSInfoDialog(), closeAnPfLambdaSInfoDialog(),
 *   openAnPfLambdaCInfoDialog(), closeAnPfLambdaCInfoDialog(),
 *   openAnSaParamsInfoDialog(), closeAnSaParamsInfoDialog(),
 *   openAnRaParamsInfoDialog(), closeAnRaParamsInfoDialog(),
 *   openAnResidualInfoDialog(), closeAnResidualInfoDialog()
 */

const btnInfo              = document.getElementById('btnInfo');
const infoOverlay          = document.getElementById('infoOverlay');
const infoCloseBtn         = document.getElementById('infoCloseBtn');
const btnSegLevelInfo      = document.getElementById('edSegLevelInfo');
const segLevelInfoOverlay  = document.getElementById('segLevelInfoOverlay');
const segLevelInfoCloseBtn = document.getElementById('segLevelInfoCloseBtn');
const btnRoiLevelInfo      = document.getElementById('edRoiLevelInfo');
const roiLevelInfoOverlay  = document.getElementById('roiLevelInfoOverlay');
const roiLevelInfoCloseBtn = document.getElementById('roiLevelInfoCloseBtn');
const btnSegSkewInfo       = document.getElementById('edSegSkewInfo');
const segSkewInfoOverlay   = document.getElementById('segSkewInfoOverlay');
const segSkewInfoCloseBtn  = document.getElementById('segSkewInfoCloseBtn');
const btnAnLambdaSInfo     = document.getElementById('anLambdaSInfo');
const anLambdaSInfoOverlay = document.getElementById('anLambdaSInfoOverlay');
const anLambdaSInfoCloseBtn = document.getElementById('anLambdaSInfoCloseBtn');
const btnAnLambdaCInfo     = document.getElementById('anLambdaCInfo');
const anLambdaCInfoOverlay = document.getElementById('anLambdaCInfoOverlay');
const anLambdaCInfoCloseBtn = document.getElementById('anLambdaCInfoCloseBtn');
const btnAnPfLambdaSInfo     = document.getElementById('anPfLambdaSInfo');
const anPfLambdaSInfoOverlay = document.getElementById('anPfLambdaSInfoOverlay');
const anPfLambdaSInfoCloseBtn = document.getElementById('anPfLambdaSInfoCloseBtn');
const btnAnPfLambdaCInfo     = document.getElementById('anPfLambdaCInfo');
const anPfLambdaCInfoOverlay = document.getElementById('anPfLambdaCInfoOverlay');
const anPfLambdaCInfoCloseBtn = document.getElementById('anPfLambdaCInfoCloseBtn');
const btnAnSaParamsInfo      = document.getElementById('anSaParamsInfo');
const anSaParamsInfoOverlay  = document.getElementById('anSaParamsInfoOverlay');
const anSaParamsInfoCloseBtn = document.getElementById('anSaParamsInfoCloseBtn');
const btnAnRaParamsInfo      = document.getElementById('anRaParamsInfo');
const anRaParamsInfoOverlay  = document.getElementById('anRaParamsInfoOverlay');
const anRaParamsInfoCloseBtn = document.getElementById('anRaParamsInfoCloseBtn');
const btnAnResidualInfo     = document.getElementById('anResidualInfo');
const anResidualInfoOverlay = document.getElementById('anResidualInfoOverlay');
const anResidualInfoCloseBtn = document.getElementById('anResidualInfoCloseBtn');

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

function openRoiLevelInfoDialog() {
    if (roiLevelInfoOverlay) roiLevelInfoOverlay.classList.add('show');
}

function closeRoiLevelInfoDialog() {
    if (roiLevelInfoOverlay) roiLevelInfoOverlay.classList.remove('show');
}

function openSegSkewInfoDialog() {
    if (segSkewInfoOverlay) segSkewInfoOverlay.classList.add('show');
}

function closeSegSkewInfoDialog() {
    if (segSkewInfoOverlay) segSkewInfoOverlay.classList.remove('show');
}

function openAnLambdaSInfoDialog() {
    if (anLambdaSInfoOverlay) anLambdaSInfoOverlay.classList.add('show');
}

function closeAnLambdaSInfoDialog() {
    if (anLambdaSInfoOverlay) anLambdaSInfoOverlay.classList.remove('show');
}

function openAnLambdaCInfoDialog() {
    if (anLambdaCInfoOverlay) anLambdaCInfoOverlay.classList.add('show');
}

function closeAnLambdaCInfoDialog() {
    if (anLambdaCInfoOverlay) anLambdaCInfoOverlay.classList.remove('show');
}

function openAnPfLambdaSInfoDialog() {
    if (anPfLambdaSInfoOverlay) anPfLambdaSInfoOverlay.classList.add('show');
}

function closeAnPfLambdaSInfoDialog() {
    if (anPfLambdaSInfoOverlay) anPfLambdaSInfoOverlay.classList.remove('show');
}

function openAnPfLambdaCInfoDialog() {
    if (anPfLambdaCInfoOverlay) anPfLambdaCInfoOverlay.classList.add('show');
}

function closeAnPfLambdaCInfoDialog() {
    if (anPfLambdaCInfoOverlay) anPfLambdaCInfoOverlay.classList.remove('show');
}

function openAnSaParamsInfoDialog() {
    if (anSaParamsInfoOverlay) anSaParamsInfoOverlay.classList.add('show');
}

function closeAnSaParamsInfoDialog() {
    if (anSaParamsInfoOverlay) anSaParamsInfoOverlay.classList.remove('show');
}

function openAnRaParamsInfoDialog() {
    if (anRaParamsInfoOverlay) anRaParamsInfoOverlay.classList.add('show');
}

function closeAnRaParamsInfoDialog() {
    if (anRaParamsInfoOverlay) anRaParamsInfoOverlay.classList.remove('show');
}

function openAnResidualInfoDialog() {
    if (anResidualInfoOverlay) anResidualInfoOverlay.classList.add('show');
}

function closeAnResidualInfoDialog() {
    if (anResidualInfoOverlay) anResidualInfoOverlay.classList.remove('show');
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
bindInfoOverlay(roiLevelInfoOverlay, openRoiLevelInfoDialog, closeRoiLevelInfoDialog, btnRoiLevelInfo, roiLevelInfoCloseBtn);
bindInfoOverlay(segSkewInfoOverlay, openSegSkewInfoDialog, closeSegSkewInfoDialog, btnSegSkewInfo, segSkewInfoCloseBtn);
bindInfoOverlay(anLambdaSInfoOverlay, openAnLambdaSInfoDialog, closeAnLambdaSInfoDialog, btnAnLambdaSInfo, anLambdaSInfoCloseBtn);
bindInfoOverlay(anLambdaCInfoOverlay, openAnLambdaCInfoDialog, closeAnLambdaCInfoDialog, btnAnLambdaCInfo, anLambdaCInfoCloseBtn);
bindInfoOverlay(anPfLambdaSInfoOverlay, openAnPfLambdaSInfoDialog, closeAnPfLambdaSInfoDialog, btnAnPfLambdaSInfo, anPfLambdaSInfoCloseBtn);
bindInfoOverlay(anPfLambdaCInfoOverlay, openAnPfLambdaCInfoDialog, closeAnPfLambdaCInfoDialog, btnAnPfLambdaCInfo, anPfLambdaCInfoCloseBtn);
bindInfoOverlay(anSaParamsInfoOverlay, openAnSaParamsInfoDialog, closeAnSaParamsInfoDialog, btnAnSaParamsInfo, anSaParamsInfoCloseBtn);
bindInfoOverlay(anRaParamsInfoOverlay, openAnRaParamsInfoDialog, closeAnRaParamsInfoDialog, btnAnRaParamsInfo, anRaParamsInfoCloseBtn);
bindInfoOverlay(anResidualInfoOverlay, openAnResidualInfoDialog, closeAnResidualInfoDialog, btnAnResidualInfo, anResidualInfoCloseBtn);

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (infoOverlay && infoOverlay.classList.contains('show')) closeInfoDialog();
    if (segLevelInfoOverlay && segLevelInfoOverlay.classList.contains('show')) closeSegLevelInfoDialog();
    if (roiLevelInfoOverlay && roiLevelInfoOverlay.classList.contains('show')) closeRoiLevelInfoDialog();
    if (segSkewInfoOverlay && segSkewInfoOverlay.classList.contains('show')) closeSegSkewInfoDialog();
    if (anLambdaSInfoOverlay && anLambdaSInfoOverlay.classList.contains('show')) closeAnLambdaSInfoDialog();
    if (anLambdaCInfoOverlay && anLambdaCInfoOverlay.classList.contains('show')) closeAnLambdaCInfoDialog();
    if (anPfLambdaSInfoOverlay && anPfLambdaSInfoOverlay.classList.contains('show')) closeAnPfLambdaSInfoDialog();
    if (anPfLambdaCInfoOverlay && anPfLambdaCInfoOverlay.classList.contains('show')) closeAnPfLambdaCInfoDialog();
    if (anSaParamsInfoOverlay && anSaParamsInfoOverlay.classList.contains('show')) closeAnSaParamsInfoDialog();
    if (anRaParamsInfoOverlay && anRaParamsInfoOverlay.classList.contains('show')) closeAnRaParamsInfoDialog();
    if (anResidualInfoOverlay && anResidualInfoOverlay.classList.contains('show')) closeAnResidualInfoDialog();
});

