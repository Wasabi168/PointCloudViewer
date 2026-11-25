/**
 * 跨視窗資料傳送（同一瀏覽器、同網域的多個分頁之間，透過 BroadcastChannel）
 * - 空白頁的佔位區塊下方列出其他視窗的資料，點一下即載入（不主動彈出詢問）
 * - 「傳送」選單：新視窗（開新分頁並直接帶入）、其他視窗（推送到已開啟的分頁）
 * 依賴：prefs.js（t, currentLang）、viewer-ui.js（currentDataset, cloneDatasetForTransfer,
 *       transferDatasetToViewer, transferDatasetToEditor, showToast）、image-view.js（editorView）、
 *       analysis-ui.js（AnalysisView, transferDatasetToAnalysis）、bump-*.js（BumpInspection, BumpAnalysis）、
 *       app.js（currentPage，執行期才讀取）
 * 匯出（全域）：CrossWindow.syncLang()
 */
const CrossWindow = (() => {
    const CHANNEL_NAME = 'cloudmap-xwin';
    const HANDOFF_PARAM = 'xwin';
    /** 廣播詢問後，這段時間內沒回應的視窗視為已關閉或被瀏覽器凍結 */
    const QUERY_SETTLE_MS = 1200;
    const REQUEST_TIMEOUT_MS = 20000;
    const HANDOFF_TTL_MS = 60000;
    const HANDOFF_CLAIM_WARN_MS = 5000;
    const HANDOFF_RETRY_MS = 500;
    const HANDOFF_MAX_TRIES = 30;
    const STATE_POLL_MS = 1500;
    const THUMB_W = 112;
    const THUMB_H = 80;
    const PANEL_MAX_ITEMS = 6;

    let channel = null;
    try {
        if (typeof BroadcastChannel === 'function') channel = new BroadcastChannel(CHANNEL_NAME);
    } catch (_) {
        channel = null;
    }

    const selfId = makeId();
    /** id -> { info, seenAt } */
    const peers = new Map();
    /** reqId -> { resolve, timer } */
    const pending = new Map();
    /** token -> { kind, ds, opts } */
    const handoffs = new Map();
    const dsIds = new WeakMap();
    let dsSeq = 0;
    let focusedAt = document.hasFocus() ? Date.now() : 0;
    let lastStateKey = '';
    let queryTimer = null;
    let handoffPending = false;

    function makeId() {
        if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
        return Date.now().toString(36) + Math.random().toString(36).slice(2);
    }

    function safeCall(fn, fallback) {
        try { return fn(); } catch (_) { return fallback; }
    }

    function currentPageName() {
        return typeof currentPage !== 'undefined' ? currentPage : 'viewer';
    }

    function colormapOf(id) {
        const sel = document.getElementById(id);
        return sel ? sel.value : undefined;
    }

    /* ---------- 可提供資料的來源（點雲檢視、點雲編輯） ---------- */

    const SOURCES = {
        viewer: {
            labelKey: 'xwinFromViewer',
            canvasId: 'canvas',
            ref: () => (typeof currentDataset !== 'undefined' ? currentDataset : null),
            snapshot: () => (currentDataset ? cloneDatasetForTransfer(currentDataset) : null),
            sendSnapshot: () => {
                if (!currentDataset) { showToast(t('sendNoData'), 'info'); return null; }
                return cloneDatasetForTransfer(currentDataset);
            },
            opts: () => ({ colormap: colormapOf('colormap') }),
        },
        editor: {
            labelKey: 'xwinFromEditor',
            canvasId: 'edCanvas',
            ref: () => (typeof editorView !== 'undefined' && editorView.getDatasetRef ? editorView.getDatasetRef() : null),
            snapshot: () => (typeof editorView !== 'undefined' ? editorView.getDataset() : null),
            sendSnapshot: () => (typeof editorView !== 'undefined' && editorView.prepareSendDataset
                ? editorView.prepareSendDataset()
                : null),
            opts: () => ({ colormap: colormapOf('edColormap') }),
        },
    };

    /* ---------- 可接收資料的位置（各頁的空白佔位區塊） ---------- */

    async function loadIntoBump(ds) {
        if (typeof BumpInspection === 'undefined' || !BumpInspection.loadDataset) return false;
        if (typeof BumpAnalysis !== 'undefined' && BumpAnalysis.setPage) BumpAnalysis.setPage('bcPageInspect');
        const ok = await BumpInspection.loadDataset(ds);
        if (ok && typeof BumpAnalysis !== 'undefined' && BumpAnalysis.refit) BumpAnalysis.refit();
        return ok;
    }

    const TARGETS = {
        viewer: {
            placeholderId: 'placeholder',
            gridOnly: false,
            load: (ds, opts) => transferDatasetToViewer({ ds, colormap: opts && opts.colormap }),
        },
        editor: {
            placeholderId: 'edPlaceholder',
            gridOnly: false,
            load: (ds) => transferDatasetToEditor({ ds }),
        },
        analysis: {
            placeholderId: 'anPlaceholder',
            gridOnly: true,
            load: (ds) => transferDatasetToAnalysis({ ds }),
        },
        bump: {
            placeholderId: 'bcPlaceholder',
            gridOnly: true,
            load: loadIntoBump,
        },
    };

    /* ---------- 本視窗狀態 ---------- */

    function datasetId(ds) {
        if (!ds) return 0;
        let id = dsIds.get(ds);
        if (!id) { id = ++dsSeq; dsIds.set(ds, id); }
        return id;
    }

    function describeSource(kind) {
        const ds = safeCall(SOURCES[kind].ref, null);
        if (!ds) return null;
        return {
            filename: ds.filename || '',
            type: ds.type || '',
            width: ds.width || 0,
            height: ds.height || 0,
            pointCount: ds.pointCount || 0,
        };
    }

    function makeThumb(canvasId) {
        const src = document.getElementById(canvasId);
        if (!src || src.width < 2 || src.height < 2) return '';
        const scale = Math.min(THUMB_W / src.width, THUMB_H / src.height, 1);
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(src.width * scale));
        c.height = Math.max(1, Math.round(src.height * scale));
        try {
            c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
            return c.toDataURL('image/png');
        } catch (_) {
            return '';
        }
    }

    function buildInfo() {
        const sources = {};
        Object.keys(SOURCES).forEach((kind) => {
            const d = describeSource(kind);
            if (!d) return;
            d.thumb = makeThumb(SOURCES[kind].canvasId);
            sources[kind] = d;
        });
        return { id: selfId, page: currentPageName(), focusedAt, sources };
    }

    function stateKey() {
        return JSON.stringify([
            currentPageName(),
            Object.keys(SOURCES).map((kind) => [describeSource(kind), datasetId(safeCall(SOURCES[kind].ref, null))]),
        ]);
    }

    function windowName(info) {
        const order = info.page === 'editor' ? ['editor', 'viewer'] : ['viewer', 'editor'];
        for (const kind of order) {
            const s = info.sources && info.sources[kind];
            if (s) return s.filename || t('xwinUntitled');
        }
        return '';
    }

    function updateTitle() {
        const name = windowName({ page: currentPageName(), sources: {
            viewer: describeSource('viewer'),
            editor: describeSource('editor'),
        } });
        const base = t('appTitle');
        document.title = name ? name + ' – ' + base : base;
    }

    /* ---------- 傳訊 ---------- */

    function post(msg) {
        if (!channel) return false;
        try {
            channel.postMessage({ ...msg, from: selfId });
            return true;
        } catch (err) {
            console.error(err);
            return false;
        }
    }

    function request(to, msg, timeoutMs) {
        return new Promise((resolve) => {
            const reqId = makeId();
            const timer = setTimeout(() => {
                pending.delete(reqId);
                resolve(null);
            }, timeoutMs || REQUEST_TIMEOUT_MS);
            pending.set(reqId, { resolve, timer });
            if (!post({ ...msg, to, reqId })) {
                clearTimeout(timer);
                pending.delete(reqId);
                resolve({ ok: false, sendFailed: true });
            }
        });
    }

    function replyTo(m, payload) {
        if (post({ t: 'reply', to: m.from, reqId: m.reqId, ...payload })) return;
        post({ t: 'reply', to: m.from, reqId: m.reqId, ok: false, sendFailed: true });
    }

    /** 去掉函式與 DOM 參照，避免結構化複製失敗 */
    function sanitize(ds) {
        const out = {};
        Object.keys(ds).forEach((k) => {
            const v = ds[k];
            if (typeof v === 'function') return;
            if (typeof Node !== 'undefined' && v instanceof Node) return;
            out[k] = v;
        });
        return out;
    }

    function rememberPeer(info) {
        if (!info || !info.id || info.id === selfId) return;
        peers.set(info.id, { info, seenAt: Date.now() });
        onPeersChanged();
    }

    function query() {
        if (!channel) return;
        const start = Date.now();
        post({ t: 'hello', info: buildInfo() });
        if (queryTimer) clearTimeout(queryTimer);
        queryTimer = setTimeout(() => {
            queryTimer = null;
            let changed = false;
            peers.forEach((p, id) => {
                if (p.seenAt < start) { peers.delete(id); changed = true; }
            });
            if (changed) onPeersChanged();
        }, QUERY_SETTLE_MS);
    }

    function answerGet(m) {
        const src = SOURCES[m.kind];
        const ds = src ? safeCall(src.snapshot, null) : null;
        if (!ds) { replyTo(m, { ok: false }); return; }
        replyTo(m, { ok: true, ds: sanitize(ds), opts: src.opts() });
    }

    async function receivePush(m) {
        const target = TARGETS[m.kind];
        if (!target || !m.ds) { replyTo(m, { ok: false }); return; }
        replyTo(m, { ok: true });
        const ok = await target.load(m.ds, m.opts);
        if (ok) showToast(t('xwinReceived', m.ds.filename || t('xwinUntitled')), 'info');
    }

    function answerClaim(m) {
        const h = handoffs.get(m.token);
        if (!h) return;
        handoffs.delete(m.token);
        clearTimeout(h.warnTimer);
        replyTo(m, { ok: true, kind: h.kind, ds: h.ds, opts: h.opts });
    }

    function settle(m) {
        const p = pending.get(m.reqId);
        if (!p) return;
        pending.delete(m.reqId);
        if (p.timer) clearTimeout(p.timer);
        p.resolve(m);
    }

    function onMessage(e) {
        const m = e.data;
        if (!m || m.from === selfId) return;
        if (m.to && m.to !== selfId) return;
        switch (m.t) {
            case 'hello':
                rememberPeer(m.info);
                post({ t: 'info', info: buildInfo() });
                break;
            case 'info':
                rememberPeer(m.info);
                break;
            case 'bye':
                if (peers.delete(m.from)) onPeersChanged();
                break;
            case 'get':
                answerGet(m);
                break;
            case 'push':
                receivePush(m);
                break;
            case 'claim':
                answerClaim(m);
                break;
            case 'reply':
                settle(m);
                break;
        }
    }

    /* ---------- 其他視窗清單 ---------- */

    function sortedPeers() {
        return [...peers.values()]
            .map((p) => p.info)
            .sort((a, b) => (b.focusedAt || 0) - (a.focusedAt || 0));
    }

    function sizeText(src) {
        if (src.type === 'pcd-scatter') return t('xwinPoints', src.pointCount);
        return src.width + '×' + src.height;
    }

    function candidatesFor(targetKey) {
        const target = TARGETS[targetKey];
        const items = [];
        sortedPeers().forEach((info) => {
            Object.keys(SOURCES).forEach((kind) => {
                const src = info.sources && info.sources[kind];
                if (!src) return;
                if (target.gridOnly && src.type === 'pcd-scatter') return;
                items.push({ peerId: info.id, kind, src });
            });
        });
        return items.slice(0, PANEL_MAX_ITEMS);
    }

    /* ---------- 空白頁的「從其他視窗載入」區塊 ---------- */

    const panels = [];

    function placeholderShown(ph) {
        return !ph.hidden && ph.style.display !== 'none';
    }

    function buildCard(entry, item) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'xwin-card';

        const thumb = document.createElement('span');
        thumb.className = 'xwin-thumb';
        if (item.src.thumb) {
            const img = document.createElement('img');
            img.src = item.src.thumb;
            img.alt = '';
            thumb.appendChild(img);
        }

        const body = document.createElement('span');
        body.className = 'xwin-card-body';
        const name = document.createElement('span');
        name.className = 'xwin-card-name';
        name.textContent = item.src.filename || t('xwinUntitled');
        name.title = name.textContent;
        const meta = document.createElement('span');
        meta.className = 'xwin-card-meta';
        const metaText = t(SOURCES[item.kind].labelKey) + ' · ' + sizeText(item.src);
        meta.textContent = metaText;
        body.append(name, meta);
        card.append(thumb, body);

        card.addEventListener('click', async () => {
            if (card.disabled) return;
            card.disabled = true;
            meta.textContent = t('xwinLoading');
            try {
                const reply = await request(item.peerId, { t: 'get', kind: item.kind });
                if (!reply || !reply.ok || !reply.ds) {
                    showToast(t(reply && reply.sendFailed ? 'xwinSendFailed' : 'xwinSourceGone'), 'error');
                    if (!reply) peers.delete(item.peerId);
                    return;
                }
                const ok = await TARGETS[entry.key].load(reply.ds, reply.opts);
                if (ok) showToast(t('xwinLoaded', reply.ds.filename || t('xwinUntitled')), 'info');
            } finally {
                card.disabled = false;
                meta.textContent = metaText;
                onPeersChanged();
            }
        });
        return card;
    }

    function renderPanel(entry, items) {
        const title = document.createElement('div');
        title.className = 'xwin-panel-title';
        title.textContent = t('xwinPanelTitle');
        const list = document.createElement('div');
        list.className = 'xwin-list';
        items.forEach((item) => list.appendChild(buildCard(entry, item)));
        entry.panel.replaceChildren(title, list);
    }

    function refreshPanel(entry) {
        const show = !!channel && !handoffPending && placeholderShown(entry.ph);
        const items = show ? candidatesFor(entry.key) : [];
        const visible = items.length > 0;
        const key = visible
            ? JSON.stringify([currentLang, items.map((i) => [i.peerId, i.kind, i.src])])
            : '';
        const loading = !!entry.panel.querySelector('.xwin-card:disabled');
        if (!loading && key !== entry.renderKey) {
            entry.renderKey = key;
            if (visible) renderPanel(entry, items);
            else entry.panel.replaceChildren();
        }
        entry.panel.hidden = !visible;
        entry.ph.classList.toggle('xwin-shift', visible);
    }

    function refreshPanels() {
        panels.forEach(refreshPanel);
    }

    function setupPanels() {
        Object.keys(TARGETS).forEach((key) => {
            const ph = document.getElementById(TARGETS[key].placeholderId);
            if (!ph) return;
            const panel = document.createElement('div');
            panel.className = 'xwin-panel';
            panel.hidden = true;
            ph.insertAdjacentElement('afterend', panel);
            const entry = { key, ph, panel, renderKey: '' };
            panels.push(entry);
            new MutationObserver(() => refreshPanel(entry))
                .observe(ph, { attributes: true, attributeFilter: ['style', 'hidden'] });
        });
    }

    /* ---------- 「傳送」選單：新視窗、其他視窗 ---------- */

    const MENUS = [
        { kind: 'viewer', wrapId: 'viewerSendWrap', triggerId: 'btnSendMenu', newWinId: 'btnSendToNewWindow', listId: 'viewerSendXwin' },
        { kind: 'editor', wrapId: 'edSendWrap', triggerId: 'edSendMenu', newWinId: 'edSendToNewWindow', listId: 'edSendXwin' },
    ];

    function closeMenu(m) {
        m.wrap.classList.remove('open');
        m.trigger.setAttribute('aria-expanded', 'false');
        const menu = m.wrap.querySelector('.send-menu');
        if (menu) menu.setAttribute('hidden', '');
    }

    function renderMenu(m) {
        const list = sortedPeers();
        if (list.length === 0) {
            m.list.replaceChildren();
            m.list.hidden = true;
            return;
        }
        const label = document.createElement('div');
        label.className = 'send-menu-label';
        label.textContent = t('xwinMenuLabel');
        const targetLabel = t(SOURCES[m.kind].labelKey);
        const rows = list.map((info) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.setAttribute('role', 'menuitem');
            btn.className = 'send-xwin-item';
            btn.title = t('xwinPushTitle');
            const name = document.createElement('span');
            name.className = 'send-xwin-name';
            name.textContent = windowName(info) || t('xwinBlankWindow');
            const hint = document.createElement('span');
            hint.className = 'send-xwin-hint';
            const existing = info.sources && info.sources[m.kind];
            if (existing) {
                hint.classList.add('warn');
                hint.textContent = t('xwinPushReplace', targetLabel, existing.filename || t('xwinUntitled'));
            } else {
                hint.textContent = t('xwinPushInto', targetLabel);
            }
            btn.append(name, hint);
            btn.addEventListener('click', () => {
                closeMenu(m);
                pushTo(info.id, m.kind);
            });
            return btn;
        });
        m.list.replaceChildren(label, ...rows);
        m.list.hidden = false;
    }

    function refreshOpenMenus() {
        MENUS.forEach((m) => {
            if (m.wrap && m.wrap.classList.contains('open')) renderMenu(m);
        });
    }

    async function pushTo(peerId, kind) {
        const src = SOURCES[kind];
        const ds = safeCall(src.sendSnapshot, null);
        if (!ds) return;
        const reply = await request(peerId, { t: 'push', kind, ds: sanitize(ds), opts: src.opts() });
        if (reply && reply.ok) {
            showToast(t('xwinSent'), 'info');
        } else {
            showToast(t(reply && reply.sendFailed ? 'xwinSendFailed' : 'xwinNoResponse'), 'error');
            if (!reply) { peers.delete(peerId); onPeersChanged(); }
        }
    }

    function openInNewWindow(kind) {
        const src = SOURCES[kind];
        const ds = safeCall(src.sendSnapshot, null);
        if (!ds) return;
        const token = makeId();
        // 部分瀏覽器開成功也會回傳 null，所以不看 window.open 的結果，改看新視窗有沒有來領資料
        const warnTimer = setTimeout(() => {
            if (handoffs.has(token)) showToast(t('xwinPopupBlocked'), 'error');
        }, HANDOFF_CLAIM_WARN_MS);
        handoffs.set(token, { kind, ds: sanitize(ds), opts: src.opts(), warnTimer });
        setTimeout(() => handoffs.delete(token), HANDOFF_TTL_MS);
        const url = new URL(location.href);
        url.hash = '';
        url.searchParams.set(HANDOFF_PARAM, token);
        window.open(url.href, '_blank');
    }

    function setupMenus() {
        MENUS.forEach((m) => {
            m.wrap = document.getElementById(m.wrapId);
            m.trigger = document.getElementById(m.triggerId);
            m.list = document.getElementById(m.listId);
            const newWin = document.getElementById(m.newWinId);
            if (!m.wrap || !m.trigger || !m.list) return;
            if (!channel) {
                m.wrap.querySelectorAll('.xwin-only').forEach((el) => { el.hidden = true; });
                return;
            }
            m.trigger.addEventListener('click', () => {
                if (!m.wrap.classList.contains('open')) return;
                renderMenu(m);
                query();
            });
            if (newWin) {
                newWin.addEventListener('click', () => {
                    closeMenu(m);
                    openInNewWindow(m.kind);
                });
            }
        });
    }

    /* ---------- 新視窗啟動時接手資料 ---------- */

    function takeHandoffToken() {
        try {
            const url = new URL(location.href);
            const token = url.searchParams.get(HANDOFF_PARAM);
            if (!token) return null;
            url.searchParams.delete(HANDOFF_PARAM);
            history.replaceState(history.state, '', url.href);
            return token;
        } catch (_) {
            return null;
        }
    }

    function claimHandoff(token) {
        return new Promise((resolve) => {
            const reqId = makeId();
            let tries = 0;
            let timer = null;
            const finish = (reply) => {
                clearInterval(timer);
                pending.delete(reqId);
                resolve(reply);
            };
            pending.set(reqId, { resolve: finish, timer: null });
            const send = () => {
                if (++tries > HANDOFF_MAX_TRIES) { finish(null); return; }
                post({ t: 'claim', token, reqId });
            };
            timer = setInterval(send, HANDOFF_RETRY_MS);
            send();
        });
    }

    async function runHandoff(token) {
        handoffPending = true;
        refreshPanels();
        const reply = channel ? await claimHandoff(token) : null;
        handoffPending = false;
        const target = reply && reply.ok && reply.ds ? TARGETS[reply.kind] : null;
        if (!target) {
            showToast(t('xwinHandoffFailed'), 'error');
            refreshPanels();
            return;
        }
        const ok = await target.load(reply.ds, reply.opts);
        if (ok) showToast(t('xwinLoaded', reply.ds.filename || t('xwinUntitled')), 'info');
        refreshPanels();
    }

    /* ---------- 啟動 ---------- */

    function onPeersChanged() {
        refreshPanels();
        refreshOpenMenus();
    }

    function tick() {
        const key = stateKey();
        if (key === lastStateKey) return;
        lastStateKey = key;
        updateTitle();
        post({ t: 'info', info: buildInfo() });
    }

    function init() {
        setupPanels();
        setupMenus();
        const token = takeHandoffToken();
        if (token) handoffPending = true;

        if (channel) {
            channel.addEventListener('message', onMessage);
            window.addEventListener('focus', () => {
                focusedAt = Date.now();
                query();
            });
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') query();
            });
            window.addEventListener('pagehide', () => post({ t: 'bye' }));
            window.addEventListener('pageshow', (e) => { if (e.persisted) query(); });
            setInterval(tick, STATE_POLL_MS);
        }

        const start = () => {
            lastStateKey = stateKey();
            updateTitle();
            query();
            if (token) runHandoff(token);
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
        else setTimeout(start, 0);
    }

    init();

    return {
        syncLang() {
            updateTitle();
            panels.forEach((entry) => { entry.renderKey = ''; });
            refreshPanels();
            refreshOpenMenus();
        },
    };
})();
