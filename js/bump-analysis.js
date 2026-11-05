/**
 * Bump 分析（點雲分析頁的子功能）：子頁切換（分析 / 疊圖分析）、關於對話框、與 AnalysisView 的整合
 * 依賴：i18n.js, prefs.js, bump-engine.js, bump-inspection.js, bump-overlay.js
 * 匯出（全域）：BumpAnalysis
 */
const BumpAnalysis = (() => {
    const root = document.getElementById('bcRoot');
    const PAGES = ['bcPageInspect', 'bcPageOverlay'];
    let active = false;
    let current = 'bcPageInspect';

    function pageOf(id) {
        return document.getElementById(id);
    }

    function resizeCurrent() {
        if (!active) return;
        if (current === 'bcPageOverlay') {
            if (typeof BumpOverlay !== 'undefined') BumpOverlay.resize();
        } else if (typeof BumpInspection !== 'undefined') {
            BumpInspection.resize();
        }
    }

    /** 切換子頁：'bcPageInspect'（分析）或 'bcPageOverlay'（疊圖分析） */
    function setPage(pageId, opts) {
        opts = opts || {};
        if (!PAGES.includes(pageId)) return;
        current = pageId;
        root.querySelectorAll('.bc-subtab[data-bc-page]').forEach((btn) => {
            const on = btn.getAttribute('data-bc-page') === pageId;
            btn.classList.toggle('active', on);
            btn.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        PAGES.forEach((id) => {
            const page = pageOf(id);
            if (page) page.classList.toggle('active', id === pageId);
        });
        if (opts.persist !== false && typeof setUserPref === 'function') {
            setUserPref('bcSubTab', pageId === 'bcPageOverlay' ? 'overlay' : 'inspect');
        }
        requestAnimationFrame(resizeCurrent);
    }

    function bindInfoDialog(openId, dialogId, closeId) {
        const dialog = document.getElementById(dialogId);
        const open = document.getElementById(openId);
        const close = document.getElementById(closeId);
        if (!dialog) return;
        if (open) open.addEventListener('click', () => { dialog.hidden = false; });
        if (close) close.addEventListener('click', () => { dialog.hidden = true; });
        dialog.addEventListener('click', (event) => {
            if (event.target === dialog) dialog.hidden = true;
        });
    }

    function bind() {
        if (!root) return;
        if (typeof BumpInspection !== 'undefined') BumpInspection.bind();
        if (typeof BumpOverlay !== 'undefined') BumpOverlay.bind();
        bindInfoDialog('bcBtnInfo', 'bcInfoDialog', 'bcInfoClose');
        bindInfoDialog('bcOverlayBtnInfo', 'bcOverlayInfoDialog', 'bcOverlayInfoClose');
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            ['bcInfoDialog', 'bcOverlayInfoDialog'].forEach((id) => {
                const dialog = document.getElementById(id);
                if (dialog && !dialog.hidden) dialog.hidden = true;
            });
        });
        root.querySelectorAll('.bc-subtab[data-bc-page]').forEach((btn) => {
            btn.addEventListener('click', () => setPage(btn.getAttribute('data-bc-page')));
        });
        const saved = typeof getUserPref === 'function' ? getUserPref('bcSubTab') : 'inspect';
        setPage(saved === 'overlay' ? 'bcPageOverlay' : 'bcPageInspect', { persist: false });
    }

    /** AnalysisView 切換到／離開 Bump 分析時呼叫 */
    function setActive(on) {
        active = !!on;
        const page = document.getElementById('pageAnalysis');
        if (page) page.classList.toggle('an-page-bump', active);
        if (active) requestAnimationFrame(resizeCurrent);
    }

    function refit() {
        resizeCurrent();
    }

    function syncLang() {
        if (typeof BumpInspection !== 'undefined') BumpInspection.onLanguage();
        if (typeof BumpOverlay !== 'undefined') BumpOverlay.onLanguage();
    }

    function hasData() {
        return typeof BumpInspection !== 'undefined' && BumpInspection.hasData();
    }

    bind();

    return { setPage, setActive, refit, syncLang, hasData, isActive: () => active };
})();
