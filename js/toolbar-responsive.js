/**
 * 工具列響應式收納
 * 依賴：無
 * 匯出（全域）：「更多」選單收納邏輯
 */
/* =========================================================================
 *  6b. 工具列響應式收納（視窗縮小時收進「更多」）
 * ========================================================================= */
function setupOverflowToolbar(cfg) {
    const controls = document.getElementById(cfg.controlsId);
    const moreMenu = document.getElementById(cfg.moreMenuId);
    const moreWrap = document.getElementById(cfg.moreWrapId);
    const moreSep  = document.getElementById(cfg.moreSepId);
    const btnMore  = document.getElementById(cfg.btnMoreId);
    const observeEl = document.getElementById(cfg.observeId) || controls;
    const overflowTarget = cfg.overflowTargetId
        ? document.getElementById(cfg.overflowTargetId)
        : moreMenu;
    const alwaysShowMore = !!cfg.alwaysShowMore;
    if (!controls || !moreMenu || !moreWrap || !overflowTarget) return;

    const entries = cfg.groups.map(g => ({
        group: document.getElementById(g.id),
        sep:   document.getElementById(g.sepId),
        priority: g.priority,
    })).filter(e => e.group);

    const anchor = moreSep || moreWrap;

    function restoreAll() {
        entries.forEach(e => {
            if (e.sep && e.sep.parentElement !== controls) {
                controls.insertBefore(e.sep, anchor);
            }
            if (e.group.parentElement !== controls) {
                controls.insertBefore(e.group, anchor);
            }
            e.group.classList.remove('toolbar-overflow-group');
        });
    }

    function toolbarContentWidth() {
        let w = 0;
        let n = 0;
        for (const ch of controls.children) {
            if (ch === moreWrap || ch === moreSep) continue;
            const r = ch.getBoundingClientRect();
            if (r.width < 1) continue;
            w += r.width;
            n++;
        }
        if (n > 1) w += (n - 1) * 10;
        return w;
    }

    function reservedMoreWidth() {
        moreWrap.style.display = '';
        if (moreSep) moreSep.style.display = '';
        return moreWrap.offsetWidth + (moreSep ? moreSep.offsetWidth + 10 : 10);
    }

    function layout() {
        if (cfg.pageId) {
            const page = document.getElementById(cfg.pageId);
            if (!page || !page.classList.contains('active')) return;
        }
        if (controls.clientWidth < 1) return;

        restoreAll();
        moreWrap.classList.remove('open');
        if (btnMore) btnMore.setAttribute('aria-expanded', 'false');

        const available = controls.clientWidth;

        if (!alwaysShowMore) {
            moreWrap.style.display = 'none';
            if (moreSep) moreSep.style.display = 'none';
            if (toolbarContentWidth() <= available) return;
        }

        const reserved = reservedMoreWidth();

        const candidates = entries
            .filter(e => e.priority > 0)
            .sort((a, b) => b.priority - a.priority);

        for (const e of candidates) {
            if (toolbarContentWidth() + reserved <= available) break;
            if (e.sep) overflowTarget.appendChild(e.sep);
            overflowTarget.appendChild(e.group);
            e.group.classList.add('toolbar-overflow-group');
        }

        if (!alwaysShowMore) {
            const hasOverflow = overflowTarget.children.length > 0;
            moreWrap.style.display = hasOverflow ? '' : 'none';
            if (moreSep) moreSep.style.display = hasOverflow ? '' : 'none';
        }
    }

    if (btnMore) {
        btnMore.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const open = !moreWrap.classList.contains('open');
            moreWrap.classList.toggle('open', open);
            btnMore.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
    }
    moreMenu.addEventListener('click', (ev) => ev.stopPropagation());

    if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => layout()).observe(observeEl);
    }
    window.addEventListener('resize', layout);
    requestAnimationFrame(layout);
    return layout;
}

function closeEdMoreMenu() {
    const wrap = document.getElementById('edMoreWrap');
    const btn  = document.getElementById('edBtnMore');
    if (!wrap) return;
    wrap.classList.remove('open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
}

const layoutViewerToolbar = setupOverflowToolbar({
    controlsId: 'viewerControls',
    observeId: 'viewerHeader',
    pageId: 'pageViewer',
    moreMenuId: 'moreMenu',
    moreWrapId: 'viewerMoreWrap',
    moreSepId: 'viewerSepMore',
    btnMoreId: 'btnMore',
    overflowTargetId: 'viewerMoreOverflow',
    alwaysShowMore: true,
    groups: [
        { id: 'viewerDisplayGroup', sepId: 'viewerSepDisplay', priority: 35 },
        { id: 'viewerToolsGroup',   sepId: 'viewerSepTools',   priority: 45 },
        { id: 'viewerSendGroup',   sepId: 'viewerSepSend',   priority: 50 },
    ],
});

const layoutEdToolbar = setupOverflowToolbar({
    controlsId: 'edControls',
    observeId: 'edHeader',
    pageId: 'pageEditor',
    moreMenuId: 'edMoreMenu',
    moreWrapId: 'edMoreWrap',
    moreSepId: 'edSepMore',
    btnMoreId: 'edBtnMore',
    overflowTargetId: 'edMoreOverflow',
    alwaysShowMore: true,
    groups: [
        { id: 'edDisplayGroup',  sepId: 'edSepDisplay',      priority: 35 },
        { id: 'edHistoryGroup',  sepId: 'edSepHistory',      priority: 25 },
        { id: 'edCropGroup',     sepId: 'edSepEdit',         priority: 10 },
        { id: 'edProcessGroup',  sepId: 'edSepCropProcess',  priority: 12 },
        { id: 'edCalibGroup',    sepId: 'edSepProcessCalib', priority: 50 },
        { id: 'edSendGroup',     sepId: 'edSepSend',         priority: 55 },
    ],
});

