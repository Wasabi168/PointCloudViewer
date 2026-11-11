/**
 * Bump 分析／疊圖分析子頁：正面 / 背面載入、左右鏡像、孔位對位後相加，三圖同步量測（移植自 BumpCop overlay-ui.js）
 * 依賴：i18n.js, prefs.js, colormap.js, viewer-ui.js(showToast), bump-engine.js
 * 匯出（全域）：BumpOverlay
 * 所有 DOM id 皆加上 bc 前綴；i18n 鍵加 bc. 前綴；偏好鍵加 bc 前綴。
 */
const BumpOverlay = (() => {
    /* ---- WebViewer 整合：區域包裝（i18n 鍵加 bc. 前綴、偏好鍵加 bc 前綴、引擎改為本機 BumpEngine） ---- */
    const t = (key, ...args) => window.t('bc.' + key, ...args);
    const showToast = (message, kind) => window.showToast(message, (kind === 'err' || kind === 'error') ? 'error' : 'info');
    const prefKey = (key) => 'bc' + key.charAt(0).toUpperCase() + key.slice(1);
    const getUserPref = (key) => window.getUserPref(prefKey(key));
    const setUserPref = (key, value) => window.setUserPref(prefKey(key), value);
    const isHeightFile = bcIsHeightFile;
    const parseHeightFile = bcParseHeightFile;
    const encodeAsc = bcEncodeAsc;
    const encodeBcrf = bcEncodeBcrf;
    const Api = BumpEngine;

    const TOOLS = [
        ['pan', 'cursorPanTitle', panIcon],
        ['inspect', 'cursorInspectTitle', inspectIcon],
        ['measure', 'cursorMeasureTitle', measureIcon],
        ['step', 'stepHeightTitle', stepIcon],
    ];

    const STEP_HIT_RADIUS = 10;
    const STEP_CHART_PICK = 22;
    const STEP_MAX_SETS = 5;
    const DELETE_SIZE = 12;
    const STEP_STYLES = [
        { colors: ['#ff6b6b', '#51cf66'], dist: '#ffd24a', step: '#ff7b72', fill: 'rgba(255,210,74,0.12)' },
        { colors: ['#74c0fc', '#b197fc'], dist: '#66d9e8', step: '#da77f2', fill: 'rgba(102,217,232,0.12)' },
        { colors: ['#ffa94d', '#69db7c'], dist: '#ffc078', step: '#ff8787', fill: 'rgba(255,169,77,0.12)' },
        { colors: ['#ff8787', '#63e6be'], dist: '#ffe066', step: '#f783ac', fill: 'rgba(255,224,102,0.12)' },
        { colors: ['#a9e34b', '#4dabf7'], dist: '#c0eb75', step: '#748ffc', fill: 'rgba(169,227,75,0.12)' },
    ];

    const state = {
        step: 0,
        colormap: 'jet',
        lut: null,
        running: false,
        result: null,
        shared: emptyInteract(),
        dotScale: 1,
        bumpToken: 0,
    };

    const el = {};
    const loadPanes = {};
    const resultPanes = {};

    function emptyInteract() {
        return {
            tool: 'pan',
            view: { scale: 1, col: 0, row: 0 },
            measure: null,
            profile: null,
            profileSets: [],
            profileDraft: [],
            profilePicking: false,
        };
    }

    function bind() {
        el.page = document.getElementById('bcPageOverlay');
        el.stepLoad = document.getElementById('bcOverlayStepLoad');
        el.stepResult = document.getElementById('bcOverlayStepResult');
        el.loadBoard = document.getElementById('bcOverlayLoad');
        el.resultBoard = document.getElementById('bcOverlayResult');
        el.sideLoad = document.getElementById('bcOverlaySideLoad');
        el.sideResult = document.getElementById('bcOverlaySideResult');
        el.start = document.getElementById('bcOverlayStart');
        el.status = document.getElementById('bcOverlayStatus');
        el.clearBtn = document.getElementById('bcOverlayClear');
        el.stats = document.getElementById('bcOverlayStats');
        el.progress = document.getElementById('bcOverlayProgress');
        el.progressBar = document.getElementById('bcOverlayProgressBar');
        el.colormap = document.getElementById('bcOverlayColormap');
        el.dotSize = document.getElementById('bcOverlayDotSize');
        el.dotSizeValue = document.getElementById('bcOverlayDotSizeValue');
        el.measureReadout = document.getElementById('bcOverlayMeasureReadout');

        state.colormap = COLORMAPS[getUserPref('colormap')] ? getUserPref('colormap') : 'jet';
        if (el.colormap) {
            el.colormap.value = state.colormap;
            setupColormapPicker(el.colormap);
            el.colormap.addEventListener('change', () => {
                state.colormap = el.colormap.value || 'jet';
                setUserPref('colormap', state.colormap);
                state.lut = buildColormapLut(state.colormap);
                requestMaps();
            });
        }
        state.lut = buildColormapLut(state.colormap);
        const savedDot = Number(getUserPref('dotScale'));
        state.dotScale = Number.isFinite(savedDot) ? clamp(savedDot, 0.4, 4) : 1;
        syncDotSize();
        if (el.dotSize) {
            el.dotSize.addEventListener('input', () => {
                applyDotScale(clamp(Number(el.dotSize.value), 0.4, 4));
            });
        }

        loadPanes.front = makePane(el.loadBoard, 'front', 'load');
        loadPanes.back = makePane(el.loadBoard, 'back', 'load');
        resultPanes.front = makePane(el.resultBoard, 'front', 'result');
        resultPanes.back = makePane(el.resultBoard, 'back', 'result');
        resultPanes.sum = makePane(el.resultBoard, 'sum', 'result');

        el.start.addEventListener('click', () => { runAnalysis(); });
        if (el.clearBtn) el.clearBtn.addEventListener('click', clearLoaded);
        el.stepLoad.addEventListener('click', () => setStep(0));
        el.stepResult.addEventListener('click', () => {
            if (state.result) setStep(1);
        });
        window.addEventListener('resize', () => {
            if (!el.page.classList.contains('active')) return;
            requestMaps();
        });
        bindOverlayMenu();
        setStep(0);
        refreshStart();
    }

    function makePane(board, key, stage) {
        const root = document.createElement('section');
        root.className = 'overlay-pane';
        root.innerHTML =
            '<div class="overlay-pane-bar">' +
                '<strong class="overlay-pane-name"></strong>' +
                '<span class="overlay-pane-span"></span>' +
                '<span class="overlay-pane-file"></span>' +
                '<span class="overlay-pane-range"></span>' +
                '<button type="button" class="tool-btn overlay-mirror"></button>' +
                '<button type="button" class="tool-btn overlay-collapse" hidden></button>' +
            '</div>' +
            '<div class="overlay-stage">' +
                '<div class="overlay-placeholder"></div>' +
                '<canvas class="overlay-map"></canvas>' +
                '<canvas class="overlay-marks"></canvas>' +
                '<div class="bc-viewer-cursor-toolbar overlay-toolbar"></div>' +
                '<div class="overlay-tip"></div>' +
            '</div>' +
            profilePanelHtml();
        board.appendChild(root);
        const pane = {
            key,
            stage,
            root,
            name: root.querySelector('.overlay-pane-name'),
            span: root.querySelector('.overlay-pane-span'),
            file: root.querySelector('.overlay-pane-file'),
            range: root.querySelector('.overlay-pane-range'),
            mirrorBtn: root.querySelector('.overlay-mirror'),
            collapseBtn: root.querySelector('.overlay-collapse'),
            stageEl: root.querySelector('.overlay-stage'),
            placeholder: root.querySelector('.overlay-placeholder'),
            map: root.querySelector('.overlay-map'),
            marks: root.querySelector('.overlay-marks'),
            toolbar: root.querySelector('.overlay-toolbar'),
            tip: root.querySelector('.overlay-tip'),
            profilePanel: root.querySelector('.overlay-profile'),
            profileMeta: root.querySelector('.overlay-profile .bc-profile-meta'),
            profileCanvas: root.querySelector('.overlay-profile-canvas'),
            profilePlot: root.querySelector('.overlay-profile .bc-profile-plot'),
            profileTip: root.querySelector('.overlay-profile .bc-profile-tip'),
            profilePick: root.querySelector('.overlay-profile-pick'),
            profileClear: root.querySelector('.overlay-profile-clear'),
            chartStyle: 'line',
            markHover: '',
            hoverIndex: null,
            chartHover: null,
            layouts: [],
            profileData: null,
            geom: null,
            measureDecor: null,
            profileDecor: null,
            original: null,
            flipped: null,
            mirror: false,
            sessionId: null,
            uploading: false,
            loadSerial: 0,
            progressTimer: 0,
            collapsed: false,
            tool: 'pan',
            view: { scale: 1, col: 0, row: 0 },
            measure: null,
            profile: null,
            profileSets: [],
            profileDraft: [],
            profilePicking: false,
            vmin: 0,
            vmax: 1,
        };
        pane.name.textContent = paneTitle(key);
        pane.placeholder.textContent = key === 'back' ? t('overlayDropBack') : key === 'front' ? t('overlayDropFront') : '';
        pane.mirrorBtn.textContent = t('overlayMirror');
        pane.collapseBtn.textContent = t('overlayCollapse');
        if (stage === 'result') pane.mirrorBtn.hidden = true;
        if (stage === 'load') pane.collapseBtn.hidden = true;
        if (stage === 'result' && key === 'sum') {
            pane.collapseBtn.classList.add('overlay-collapse-spacer');
            pane.collapseBtn.disabled = true;
            pane.collapseBtn.tabIndex = -1;
            pane.collapseBtn.setAttribute('aria-hidden', 'true');
        }
        buildToolbar(pane);
        if (stage === 'load') {
            const progress = document.createElement('div');
            progress.className = 'load-progress';
            progress.hidden = true;
            const bar = document.createElement('div');
            bar.className = 'load-progress-bar';
            progress.appendChild(bar);
            const label = document.createElement('div');
            label.className = 'load-progress-label';
            label.hidden = true;
            label.setAttribute('role', 'status');
            const text = document.createElement('span');
            label.appendChild(text);
            pane.stageEl.appendChild(progress);
            pane.stageEl.appendChild(label);
            pane.progress = progress;
            pane.progressBar = bar;
            pane.progressLabel = label;
            pane.progressText = text;
            pane.mirrorBtn.addEventListener('click', () => toggleMirror(key));
            const open = document.createElement('label');
            open.className = 'bc-icon-btn bc-file-btn overlay-pane-open';
            open.innerHTML = folderIcon()
                + '<input type="file" accept=".bcrf,.asc,.tif,.tiff,.pcd,.txt,.csv,.bmp,.png,.jpg,.jpeg" />';
            const clear = document.createElement('button');
            clear.type = 'button';
            clear.className = 'bc-icon-btn overlay-pane-clear';
            clear.disabled = true;
            clear.innerHTML = trashIcon();
            pane.mirrorBtn.before(open, clear);
            pane.openBtn = open;
            pane.clearBtn = clear;
            const input = open.querySelector('input');
            pane.fileInput = input;
            syncPaneFileActions(pane);
            input.addEventListener('change', () => {
                const file = input.files && input.files[0];
                input.value = '';
                if (file) loadFile(key, file);
            });
            clear.addEventListener('click', () => clearOne(pane));
            pane.stageEl.addEventListener('dblclick', (event) => {
                if (event.target.closest('.bc-viewer-cursor-toolbar')) return;
                if (!pane.original) input.click();
            });
            pane.stageEl.addEventListener('dragover', (event) => {
                event.preventDefault();
                pane.stageEl.classList.add('drag-over');
            });
            pane.stageEl.addEventListener('dragleave', () => pane.stageEl.classList.remove('drag-over'));
            pane.stageEl.addEventListener('drop', (event) => {
                event.preventDefault();
                pane.stageEl.classList.remove('drag-over');
                const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
                if (file) loadFile(key, file);
            });
        } else if (key !== 'sum') {
            pane.collapseBtn.hidden = false;
            pane.collapseBtn.addEventListener('click', () => {
                pane.collapsed = !pane.collapsed;
                pane.root.classList.toggle('collapsed', pane.collapsed);
                pane.collapseBtn.textContent = pane.collapsed ? t('overlayExpand') : t('overlayCollapse');
                requestMaps();
            });
        }
        const marks = pane.marks;
        marks.addEventListener('pointerdown', (event) => onPointerDown(event, pane));
        marks.addEventListener('pointermove', (event) => onPointerMove(event, pane));
        marks.addEventListener('pointerup', (event) => onPointerUp(event, pane));
        marks.addEventListener('pointerleave', () => {
            hideTip(pane);
            if (pane.markHover) {
                pane.markHover = '';
                paintMarks(pane);
            }
        });
        bindPaneProfile(pane);
        if (stage === 'result') bindExtremePanel(pane);
        marks.addEventListener('wheel', (event) => onWheel(event, pane), { passive: false });
        marks.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            if (pane.stage !== 'result' || pane.root.classList.contains('collapsed') || !displayed(pane)) return;
            openOverlayMenu(event, pane);
        });
        watchStage(pane);
        return pane;
    }

    function stagePixels(pane) {
        const rect = pane.stageEl.getBoundingClientRect();
        return {
            width: Math.max(1, Math.round(rect.width)),
            height: Math.max(1, Math.round(rect.height)),
        };
    }

    function watchStage(pane) {
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(() => {
            if (!el.page.classList.contains('active')) return;
            if (pane.root.classList.contains('collapsed')) return;
            const boardHidden = pane.stage === 'result' ? el.resultBoard.hidden : el.loadBoard.hidden;
            if (boardHidden || !displayed(pane)) return;
            const size = stagePixels(pane);
            if (size.width < 2 || size.height < 2) return;
            if (pane.map.width === size.width && pane.map.height === size.height
                && pane.marks.width === size.width && pane.marks.height === size.height) return;
            requestMaps();
        });
        observer.observe(pane.stageEl);
    }

    function buildToolbar(pane) {
        TOOLS.forEach(([tool, key, icon]) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.tool = tool;
            button.title = t(key);
            button.setAttribute('aria-label', t(key));
            button.innerHTML = icon();
            button.addEventListener('click', () => setTool(pane, tool));
            pane.toolbar.appendChild(button);
        });
        const sep = document.createElement('span');
        sep.className = 'bc-viewer-cursor-toolbar-sep';
        pane.toolbar.appendChild(sep);
        const clear = document.createElement('button');
        clear.type = 'button';
        clear.dataset.tool = 'clear';
        clear.title = t('measureClearTitle');
        clear.setAttribute('aria-label', t('measureClearTitle'));
        clear.innerHTML = clearIcon();
        clear.addEventListener('click', () => {
            clearMarks(bagFor(pane));
            refreshMarks();
        });
        pane.toolbar.appendChild(clear);
        syncToolbar(pane);
    }

    function paneTitle(key) {
        if (key === 'front') return t('overlayFront');
        if (key === 'back') return t('overlayBack');
        return t('overlaySum');
    }

    function peakSpan(pane) {
        const markers = state.result && state.result.markers && state.result.markers[pane.key];
        if (markers && markers.length) {
            const extremes = markerExtremes(markers);
            if (Number.isFinite(extremes.highValue) && Number.isFinite(extremes.lowValue)) {
                return extremes.highValue - extremes.lowValue;
            }
        }
        if (Number.isFinite(pane.vmax) && Number.isFinite(pane.vmin)) return pane.vmax - pane.vmin;
        return NaN;
    }

    function syncPaneTitle(pane) {
        pane.name.textContent = paneTitle(pane.key);
        if (!pane.span) return;
        const dataset = displayed(pane);
        const span = pane.stage === 'result' && dataset ? peakSpan(pane) : NaN;
        if (!Number.isFinite(span)) {
            pane.span.textContent = '';
            return;
        }
        const unit = zUnit(pane);
        pane.span.textContent = t('overlayPeakRange') + ' ' + formatNum(span, 3) + (unit ? ' ' + unit : '');
    }

    function loadSide(key) {
        return loadPanes[key];
    }

    function displayed(pane) {
        if (pane.stage === 'load') {
            const side = loadSide(pane.key);
            if (!side || !side.original) return null;
            return side.mirror ? side.flipped : side.original;
        }
        if (!state.result) return null;
        if (pane.key === 'front') return state.result.front;
        if (pane.key === 'back') return state.result.back;
        return state.result.sum;
    }

    function bagFor(pane) {
        return pane.stage === 'result' ? state.shared : pane;
    }

    function interactBag() {
        return state.step === 1 ? state.shared : (activeLoadBag || loadPanes.front);
    }

    let activeLoadBag = null;

    function setTool(pane, tool) {
        bagFor(pane).tool = tool;
        const panes = pane.stage === 'result' ? Object.values(resultPanes) : [pane];
        panes.forEach((other) => {
            syncToolbar(other);
            if (tool !== 'inspect') hideTip(other);
        });
    }

    function syncToolbar(pane) {
        const tool = bagFor(pane).tool;
        pane.toolbar.querySelectorAll('button[data-tool]').forEach((button) => {
            button.classList.toggle('active', button.dataset.tool === tool);
        });
    }

    function clearMarks(bag) {
        bag.measure = null;
        bag.profile = null;
        bag.profileSets = [];
        bag.profileDraft = [];
        bag.profilePicking = false;
        syncProfileButtons();
    }

    function showPaneProgress(pane, fraction) {
        clearTimeout(pane.progressTimer);
        const value = clamp(fraction, 0, 1);
        pane.progress.hidden = false;
        pane.progressLabel.hidden = false;
        pane.progressBar.style.width = (value * 100).toFixed(1) + '%';
        pane.progressText.textContent = t('loadProgress', Math.round(value * 100));
    }

    function hidePaneProgress(pane) {
        clearTimeout(pane.progressTimer);
        pane.progressTimer = setTimeout(() => {
            pane.progress.hidden = true;
            pane.progressLabel.hidden = true;
            pane.progressBar.style.width = '0%';
        }, 300);
    }

    async function loadFile(key, file) {
        const pane = loadPanes[key];
        if (!isHeightFile(file.name)) {
            showToast(t('dropReject'));
            return;
        }
        const serial = ++pane.loadSerial;
        pane.uploading = true;
        pane.file.textContent = t('overlayUploading');
        refreshStart();
        showPaneProgress(pane, 0.01);
        let lastPaint = 0;
        const reportParse = async (fraction) => {
            if (serial !== pane.loadSerial) return;
            showPaneProgress(pane, 0.02 + fraction * 0.58);
            const now = performance.now();
            if (now - lastPaint < 48) return;
            lastPaint = now;
            await yieldFrame();
        };
        try {
            const parsed = await parseHeightFile(file, reportParse);
            if (serial !== pane.loadSerial) return;
            pane.original = parsed;
            pane.flipped = null;
            pane.mirror = false;
            pane.sessionId = null;
            pane.mirrorBtn.classList.remove('active');
            pane.mirrorBtn.textContent = t('overlayMirror');
            fitView(pane, parsed);
            clearResult();
            paintPane(pane);
            showPaneProgress(pane, 0.62);
            const session = await Api.upload(parsed, (fraction) => {
                if (serial !== pane.loadSerial) return;
                showPaneProgress(pane, 0.62 + clamp(fraction, 0, 1) * 0.38);
            });
            if (serial !== pane.loadSerial) {
                if (session && session.session_id) Api.release(session.session_id);
                return;
            }
            pane.sessionId = session.session_id;
            pane.file.textContent = file.name;
            showPaneProgress(pane, 1);
            hidePaneProgress(pane);
            showToast(t('toastLoaded', file.name));
        } catch (error) {
            if (serial !== pane.loadSerial) return;
            pane.file.textContent = '';
            hidePaneProgress(pane);
            showToast(error.message || t('toastSaveFailed'), 'err');
        } finally {
            if (serial === pane.loadSerial) {
                pane.uploading = false;
                refreshStart();
            }
        }
    }

    function toggleMirror(key) {
        const pane = loadPanes[key];
        if (!pane.original) return;
        pane.mirror = !pane.mirror;
        if (pane.mirror && !pane.flipped) pane.flipped = flipHorizontal(pane.original);
        pane.mirrorBtn.classList.toggle('active', pane.mirror);
        pane.mirrorBtn.textContent = pane.mirror ? t('overlayMirrorOn') : t('overlayMirror');
        clearMarks(pane);
        clearResult();
        fitView(pane, currentLoadData(pane));
        paintPane(pane);
        refreshStart();
    }

    function currentLoadData(pane) {
        if (!pane.original) return null;
        return pane.mirror ? pane.flipped : pane.original;
    }

    function flipHorizontal(dataset) {
        const width = dataset.width;
        const height = dataset.height;
        const src = dataset.data;
        const data = new Float32Array(src.length);
        for (let y = 0; y < height; y++) {
            const row = y * width;
            for (let x = 0; x < width; x++) data[row + x] = src[row + (width - 1 - x)];
        }
        return { header: dataset.header, data, width, height, name: dataset.name };
    }

    function clearResult() {
        state.result = null;
        state.shared = emptyInteract();
        el.stepResult.disabled = true;
        if (state.step === 1) setStep(0);
        el.stats.innerHTML = '';
    }

    function syncPaneFileActions(pane) {
        if (!pane || !pane.openBtn) return;
        const title = t('btnOpen');
        pane.openBtn.title = title;
        pane.openBtn.setAttribute('aria-label', title);
        const clearTitle = t('overlayClearSideTitle');
        pane.clearBtn.title = clearTitle;
        pane.clearBtn.setAttribute('aria-label', clearTitle);
        const busy = state.running;
        const has = !!(pane.original || pane.uploading);
        pane.openBtn.classList.toggle('is-disabled', busy);
        if (pane.fileInput) pane.fileInput.disabled = busy;
        pane.clearBtn.disabled = busy || !has;
    }

    function clearOne(pane) {
        if (state.running || !pane || (!pane.original && !pane.uploading)) return;
        clearPane(pane);
        clearResult();
        refreshStart();
    }

    function clearPane(pane) {
        if (!pane) return;
        pane.loadSerial += 1;
        if (pane.sessionId) {
            Api.release(pane.sessionId);
            pane.sessionId = null;
        }
        pane.original = null;
        pane.flipped = null;
        pane.mirror = false;
        pane.uploading = false;
        pane.file.textContent = '';
        pane.mirrorBtn.classList.remove('active');
        pane.mirrorBtn.textContent = t('overlayMirror');
        clearMarks(pane);
        if (pane.progress) {
            pane.progress.hidden = true;
            pane.progressLabel.hidden = true;
            pane.progressBar.style.width = '0%';
        }
        paintPane(pane);
    }

    function clearLoaded() {
        if (state.running) return;
        clearPane(loadPanes.front);
        clearPane(loadPanes.back);
        clearResult();
        refreshStart();
    }

    function refreshStart() {
        const ready = loadPanes.front && loadPanes.front.sessionId && loadPanes.back && loadPanes.back.sessionId && !state.running;
        const hasData = !!(
            (loadPanes.front && (loadPanes.front.original || loadPanes.front.uploading))
            || (loadPanes.back && (loadPanes.back.original || loadPanes.back.uploading))
            || state.result
        );
        el.start.disabled = !ready;
        if (el.clearBtn) el.clearBtn.disabled = state.running || !hasData;
        Object.values(loadPanes).forEach(syncPaneFileActions);
        if (!el.status) return;
        if (state.running) el.status.textContent = t('overlayWorking');
        else if (ready) el.status.textContent = t('overlayReady');
        else el.status.textContent = t('overlayNeedBoth');
    }

    async function runAnalysis() {
        if (el.start.disabled) return;
        state.running = true;
        refreshStart();
        setProgress(0.02, t('overlayWorking'));
        try {
            const payload = await Api.overlay({
                front_session_id: loadPanes.front.sessionId,
                back_session_id: loadPanes.back.sessionId,
                mirror_front: loadPanes.front.mirror,
                mirror_back: loadPanes.back.mirror,
            }, (fraction) => setProgress(fraction * 0.72, t('overlayWorking')));
            const front = currentLoadData(loadPanes.front);
            const back = currentLoadData(loadPanes.back);
            setProgress(0.74, t('overlayWarp'));
            const warped = await warpToFront(back, front.width, front.height, payload, (fraction) => {
                setProgress(0.74 + fraction * 0.16, t('overlayWarp'));
            });
            setProgress(0.92, t('overlayPaint'));
            const sum = await paintSum(front, payload.pairs || [], (fraction) => {
                setProgress(0.92 + fraction * 0.08, t('overlayPaint'));
            });
            state.result = {
                payload,
                front,
                back: warped,
                sum,
                markers: null,
                markerIndex: {},
            };
            state.bumpToken += 1;
            collectResultMarkers(state.bumpToken);
            state.shared = emptyInteract();
            el.stepResult.disabled = false;
            renderStats(payload);
            setStep(1);
            fitShared(front);
            hideProgress();
            requestMaps();
        } catch (error) {
            hideProgress();
            showToast(error.message || t('toastSaveFailed'), 'err');
        } finally {
            state.running = false;
            refreshStart();
        }
    }

    function setStep(step) {
        if (step === 1) {
            const saved = Number(getUserPref('dotScale'));
            if (Number.isFinite(saved)) state.dotScale = clamp(saved, 0.4, 4);
            syncDotSize();
        }
        state.step = step;
        el.stepLoad.classList.toggle('active', step === 0);
        el.stepResult.classList.toggle('active', step === 1);
        el.stepLoad.classList.toggle('done', step > 0);
        el.loadBoard.hidden = step !== 0;
        el.resultBoard.hidden = step !== 1;
        el.sideLoad.hidden = step !== 0;
        el.sideResult.hidden = step !== 1;
        refreshMarks();
        requestMaps();
    }

    function renderStats(payload) {
        const unit = payload.z_unit ? ' ' + payload.z_unit : '';
        const dx = payload.dx_front || 0;
        const rows = [
            [t('overlayStatPaired'), String(payload.paired_count)],
            [t('overlayStatFrontOnly'), String(payload.front_only_count)],
            [t('overlayStatBackOnly'), String(payload.back_only_count)],
            [t('overlayStatFront'), String(payload.front_count)],
            [t('overlayStatBack'), String(payload.back_count)],
            [t('overlayStatRotation'), formatNum(payload.rotation_deg, 3) + ' ' + t('unitDeg')],
            [t('overlayStatHole'), formatNum(payload.hole_residual_px, 2) + ' px'],
            [t('overlayStatOverlap'), formatNum(payload.match_fraction * 100, 1) + ' %'],
            [t('overlayStatDist'), formatNum(payload.pair_dist_median_px, 2) + ' / ' + formatNum(payload.pair_dist_max_px, 2) + ' px'],
            [t('overlayStatPitch'), formatNum(payload.pitch_px * dx, 3) + ' mm'],
            [t('overlayStatDisk'), formatNum(payload.disk_diameter_px * dx, 3) + ' mm'],
            [t('overlayStatSum'), formatNum(payload.sum_median, 3) + unit],
            [t('overlayStatSumSpan'), formatNum(payload.sum_p05, 2) + ' – ' + formatNum(payload.sum_p95, 2) + unit],
            [t('overlayStatSumRange'), formatNum(payload.sum_min, 2) + ' / ' + formatNum(payload.sum_max, 2) + unit],
        ];
        el.stats.innerHTML = rows.map(([label, value]) =>
            '<div><span>' + label + '</span><strong>' + value + '</strong></div>'
        ).join('');
    }

    function formatNum(value, digits) {
        return Number.isFinite(value) ? Number(value).toFixed(digits) : '—';
    }

    function fitView(pane, dataset) {
        const rect = pane.stageEl.getBoundingClientRect();
        const w = Math.max(rect.width, 240);
        const h = Math.max(rect.height, 180);
        pane.view.scale = Math.min(w / dataset.width, h / dataset.height) * 0.92;
        pane.view.col = (dataset.width - 1) / 2;
        pane.view.row = (dataset.height - 1) / 2;
        const range = finiteRange(dataset.data);
        pane.vmin = range.vmin;
        pane.vmax = range.vmax;
    }

    function fitShared(dataset) {
        const rect = resultPanes.sum.stageEl.getBoundingClientRect();
        const w = Math.max(rect.width, 240);
        const h = Math.max(rect.height, 180);
        state.shared.view.scale = Math.min(w / dataset.width, h / dataset.height) * 0.92;
        state.shared.view.col = (dataset.width - 1) / 2;
        state.shared.view.row = (dataset.height - 1) / 2;
        ['front', 'back', 'sum'].forEach((key) => {
            const data = key === 'front' ? state.result.front : key === 'back' ? state.result.back : state.result.sum;
            const range = finiteRange(data.data);
            resultPanes[key].vmin = range.vmin;
            resultPanes[key].vmax = range.vmax;
        });
    }

    function finiteRange(data) {
        let vmin = Infinity;
        let vmax = -Infinity;
        let count = 0;
        const step = data.length > 4000000 ? 7 : 1;
        for (let i = 0; i < data.length; i += step) {
            const value = data[i];
            if (!Number.isFinite(value)) continue;
            if (value < vmin) vmin = value;
            if (value > vmax) vmax = value;
            count++;
        }
        if (!count) return { vmin: 0, vmax: 1 };
        if (vmin === vmax) vmax = vmin + 1;
        return { vmin, vmax };
    }

    let mapFrame = 0;
    function requestMaps() {
        if (mapFrame) return;
        mapFrame = requestAnimationFrame(() => {
            mapFrame = 0;
            paintVisible();
        });
    }

    function visiblePanes() {
        return state.step === 0 ? [loadPanes.front, loadPanes.back] : Object.values(resultPanes);
    }

    function syncProfileLayout(panes) {
        panes.forEach((pane) => {
            pane.profilePanel.hidden = pane.root.classList.contains('collapsed') || !bagFor(pane).profile;
        });
    }

    function paintVisible() {
        const panes = visiblePanes();
        syncProfileLayout(panes);
        panes.forEach((pane) => {
            if (pane.root.classList.contains('collapsed')) return;
            paintPane(pane);
        });
        paintProfile();
        paintMeasureReadout();
    }

    function refreshMarks() {
        const panes = visiblePanes();
        syncProfileLayout(panes);
        panes.forEach((pane) => {
            if (pane.root.classList.contains('collapsed')) return;
            const dataset = displayed(pane);
            if (dataset) {
                const size = stagePixels(pane);
                if (pane.map.width !== size.width || pane.map.height !== size.height) paintMap(pane, dataset);
            }
            paintMarks(pane);
        });
        paintProfile();
        paintMeasureReadout();
        syncProfileButtons();
    }

    function paintPane(pane) {
        const dataset = displayed(pane);
        pane.placeholder.hidden = !!dataset;
        pane.toolbar.hidden = false;
        syncPaneTitle(pane);
        if (pane.stage === 'load') {
            pane.file.textContent = dataset ? (dataset.name || '') : '';
        }
        if (!dataset) {
            pane.range.textContent = '';
            clearCanvas(pane.map);
            clearCanvas(pane.marks);
            return;
        }
        pane.range.textContent = formatNum(pane.vmin, 2) + ' – ' + formatNum(pane.vmax, 2);
        paintMap(pane, dataset);
        paintMarks(pane);
    }

    function clearCanvas(canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    function syncDotSize() {
        const scale = clamp(Number(state.dotScale), 0.4, 4);
        state.dotScale = scale;
        if (el.dotSize && document.activeElement !== el.dotSize) el.dotSize.value = String(scale);
        if (el.dotSizeValue) el.dotSizeValue.textContent = scale.toFixed(1) + '×';
    }

    function applyDotScale(scale) {
        state.dotScale = clamp(scale, 0.4, 4);
        if (state.result) state.result.markerIndex = {};
        syncDotSize();
        setUserPref('dotScale', state.dotScale);
        const other = document.getElementById('bcDotSize');
        if (other && Math.abs(Number(other.value) - state.dotScale) > 0.001) {
            other.value = String(state.dotScale);
            other.dispatchEvent(new Event('input', { bubbles: true }));
        }
        requestMaps();
    }

    function bumpScreenRadius() {
        const user = clamp(Number(state.dotScale), 0.4, 4);
        const diameter = state.result && state.result.payload && Number(state.result.payload.disk_diameter_px);
        const imageRadius = Math.max(1.5, (diameter || 8) * 0.5) * user;
        const view = (state.shared.view && state.shared.view.scale) || 1;
        return Math.max(2.5 * user, Math.min(42 * user, imageRadius * view));
    }

    function bumpImageRadius() {
        const view = (state.shared.view && state.shared.view.scale) || 1;
        return bumpScreenRadius() / view;
    }

    function bumpDataRadius() {
        const user = clamp(Number(state.dotScale), 0.4, 4);
        const diameter = state.result && state.result.payload && Number(state.result.payload.disk_diameter_px);
        return Math.max(1.5, (diameter || 8) * 0.5) * user;
    }

    function paintMap(pane, dataset) {
        const markers = pane.stage === 'result' && state.result && state.result.markers && state.result.markers[pane.key];
        if (markers) {
            paintBumpCircles(pane, markers);
            return;
        }
        const size = stagePixels(pane);
        const width = size.width;
        const height = size.height;
        if (pane.map.width !== width) pane.map.width = width;
        if (pane.map.height !== height) pane.map.height = height;
        const ctx = pane.map.getContext('2d', { alpha: false });
        const image = ctx.createImageData(width, height);
        const pixels = image.data;
        const lut = state.lut;
        const view = bagFor(pane).view;
        const vmin = pane.vmin;
        const span = pane.vmax - pane.vmin || 1;
        const data = dataset.data;
        const dw = dataset.width;
        const dh = dataset.height;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const col = (x + 0.5 - width / 2) / view.scale + view.col;
                const row = (y + 0.5 - height / 2) / view.scale + view.row;
                const c = col | 0;
                const r = row | 0;
                const offset = (y * width + x) * 4;
                let value = NaN;
                if (r >= 0 && c >= 0 && r < dh && c < dw) value = data[r * dw + c];
                if (!Number.isFinite(value)) {
                    paintMissingPixel(pixels, offset);
                } else {
                    const index = Math.max(0, Math.min(255, ((value - vmin) / span) * 255)) | 0;
                    pixels[offset] = lut[index * 3];
                    pixels[offset + 1] = lut[index * 3 + 1];
                    pixels[offset + 2] = lut[index * 3 + 2];
                }
                pixels[offset + 3] = 255;
            }
        }
        ctx.putImageData(image, 0, 0);
    }

    function paintBumpCircles(pane, markers) {
        const size = stagePixels(pane);
        const width = size.width;
        const height = size.height;
        if (pane.map.width !== width) pane.map.width = width;
        if (pane.map.height !== height) pane.map.height = height;
        const ctx = pane.map.getContext('2d', { alpha: false });
        const bg = (typeof readMissingPixelRgb === 'function') ? readMissingPixelRgb() : [30, 30, 40];
        ctx.fillStyle = 'rgb(' + bg[0] + ',' + bg[1] + ',' + bg[2] + ')';
        ctx.fillRect(0, 0, width, height);
        const radius = bumpScreenRadius();
        const lut = state.lut;
        const view = bagFor(pane).view;
        const vmin = pane.vmin;
        const span = pane.vmax - pane.vmin || 1;
        for (let i = 0; i < markers.length; i++) {
            const marker = markers[i];
            const x = (marker.x - view.col) * view.scale + width / 2;
            const y = (marker.y - view.row) * view.scale + height / 2;
            if (x < -radius || y < -radius || x > width + radius || y > height + radius) continue;
            const index = Math.max(0, Math.min(255, ((marker.z - vmin) / span) * 255)) | 0;
            ctx.fillStyle = 'rgb(' + lut[index * 3] + ',' + lut[index * 3 + 1] + ',' + lut[index * 3 + 2] + ')';
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    async function collectResultMarkers(token) {
        const result = state.result;
        if (!result) return;
        const markers = {};
        const keys = ['front', 'back', 'sum'];
        for (let i = 0; i < keys.length; i++) {
            if (token !== state.bumpToken || state.result !== result) return;
            markers[keys[i]] = await collectBumps(result[keys[i]]);
        }
        if (token !== state.bumpToken || state.result !== result) return;
        result.markers = markers;
        result.markerIndex = {};
        requestMaps();
    }

    function collectBumps(dataset) {
        const width = dataset.width;
        const height = dataset.height;
        const data = dataset.data;
        const seen = new Uint8Array(data.length);
        const markers = [];
        let y0 = 0;
        const chunk = 48;
        return new Promise((resolve) => {
            const step = () => {
                const y1 = Math.min(height, y0 + chunk);
                for (let y = y0; y < y1; y++) {
                    const row = y * width;
                    for (let x = 0; x < width; x++) {
                        const start = row + x;
                        if (seen[start] || !Number.isFinite(data[start])) continue;
                        let count = 0;
                        let sx = 0;
                        let sy = 0;
                        let sz = 0;
                        const stack = [start];
                        seen[start] = 1;
                        while (stack.length) {
                            const p = stack.pop();
                            const py = (p / width) | 0;
                            const px = p - py * width;
                            count++;
                            sx += px;
                            sy += py;
                            sz += data[p];
                            const right = p + 1;
                            if (px + 1 < width && !seen[right] && Number.isFinite(data[right])) {
                                seen[right] = 1;
                                stack.push(right);
                            }
                            const left = p - 1;
                            if (px > 0 && !seen[left] && Number.isFinite(data[left])) {
                                seen[left] = 1;
                                stack.push(left);
                            }
                            const down = p + width;
                            if (py + 1 < height && !seen[down] && Number.isFinite(data[down])) {
                                seen[down] = 1;
                                stack.push(down);
                            }
                            const up = p - width;
                            if (py > 0 && !seen[up] && Number.isFinite(data[up])) {
                                seen[up] = 1;
                                stack.push(up);
                            }
                        }
                        if (count >= 4) markers.push({ x: sx / count, y: sy / count, z: sz / count });
                    }
                }
                y0 = y1;
                if (y0 < height) requestAnimationFrame(step);
                else resolve(markers);
            };
            requestAnimationFrame(step);
        });
    }

    function markerIndexFor(key, radius) {
        const result = state.result;
        const markers = result && result.markers && result.markers[key];
        if (!markers) return null;
        const current = result.markerIndex && result.markerIndex[key];
        if (current && Math.abs(current.cell - radius) <= radius * 0.25) return current;
        const grid = new Map();
        for (let i = 0; i < markers.length; i++) {
            const marker = markers[i];
            const gx = Math.floor(marker.x / radius);
            const gy = Math.floor(marker.y / radius);
            const id = gx * 100003 + gy;
            let bucket = grid.get(id);
            if (!bucket) grid.set(id, bucket = []);
            bucket.push(marker);
        }
        const index = { grid: grid, cell: radius };
        result.markerIndex[key] = index;
        return index;
    }

    function hitMarker(key, point) {
        const radius = bumpImageRadius();
        if (!(radius > 0) || !state.result || !state.result.markers) return null;
        const index = markerIndexFor(key, radius);
        if (!index) return null;
        const cx = Math.floor(point.col / radius);
        const cy = Math.floor(point.row / radius);
        const limit = radius * radius;
        let best = null;
        let bestD = limit;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const bucket = index.grid.get((cx + dx) * 100003 + (cy + dy));
                if (!bucket) continue;
                for (let i = 0; i < bucket.length; i++) {
                    const marker = bucket[i];
                    const ddx = marker.x - point.col;
                    const ddy = marker.y - point.row;
                    const dist = ddx * ddx + ddy * ddy;
                    if (dist <= bestD) {
                        bestD = dist;
                        best = marker;
                    }
                }
            }
        }
        return best;
    }

    function displayedValue(key, point) {
        if (!state.result || !state.result.markers || !state.result.markers[key]) {
            return sampleDataset(state.result && state.result[key], point);
        }
        const hit = hitMarker(key, point);
        return hit ? hit.z : NaN;
    }

    function paintMarks(pane) {
        const size = stagePixels(pane);
        const width = size.width;
        const height = size.height;
        if (pane.marks.width !== width) pane.marks.width = width;
        if (pane.marks.height !== height) pane.marks.height = height;
        const ctx = pane.marks.getContext('2d');
        ctx.clearRect(0, 0, width, height);
        const bag = bagFor(pane);
        pane.profileData = buildProfileData(pane);
        pane.measureDecor = bag.measure ? lineDecor(pane, bag.measure, width, height, true) : null;
        pane.profileDecor = bag.profile ? lineDecor(pane, bag.profile, width, height, false) : null;
        if (pane.measureDecor) drawImageLine(ctx, pane.measureDecor, '#3ecf8e', pane.markHover === 'measure');
        if (pane.profileDecor) drawImageLine(ctx, pane.profileDecor, '#4f8cff', pane.markHover === 'profile');
        drawStepDots(ctx, pane, bag, width, height);
        if (pane.showExtremes) drawExtremeLabels(ctx, pane, width, height);
    }

    function bindExtremePanel(pane) {
        const panel = document.createElement('div');
        panel.className = 'layer-panel overlay-extreme-panel';
        panel.innerHTML =
            '<button type="button" class="fold-bar" aria-expanded="true">' +
                '<span class="fold-bar-title" data-i18n="bc.layerTitle">顯示</span>' +
                '<svg class="fold-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 14.5 12 8.5l6 6"/></svg>' +
            '</button>' +
            '<div class="layer-body">' +
                '<label class="height-extreme-toggle">' +
                    '<input type="checkbox" />' +
                    '<span data-i18n="bc.overlayExtremeToggle">標記最高 / 最低</span>' +
                '</label>' +
            '</div>';
        pane.stageEl.appendChild(panel);
        pane.extremePanel = panel;
        pane.extremeFold = panel.querySelector('.fold-bar');
        pane.extremeToggle = panel.querySelector('input');
        pane.showExtremes = false;
        pane.extremeCollapsed = false;
        pane.extremeFold.addEventListener('click', () => {
            pane.extremeCollapsed = !pane.extremeCollapsed;
            pane.extremePanel.classList.toggle('is-collapsed', pane.extremeCollapsed);
            pane.extremeFold.setAttribute('aria-expanded', pane.extremeCollapsed ? 'false' : 'true');
        });
        pane.extremeToggle.addEventListener('change', () => {
            pane.showExtremes = pane.extremeToggle.checked;
            paintMarks(pane);
        });
    }

    function markerExtremes(markers) {
        let highValue = -Infinity;
        let lowValue = Infinity;
        for (let i = 0; i < markers.length; i++) {
            const value = markers[i].z;
            if (!Number.isFinite(value)) continue;
            if (value > highValue) highValue = value;
            if (value < lowValue) lowValue = value;
        }
        const high = [];
        const low = [];
        if (highValue === -Infinity) return { high: high, low: low, highValue: NaN, lowValue: NaN };
        for (let i = 0; i < markers.length; i++) {
            const value = markers[i].z;
            if (value === highValue) high.push(markers[i]);
            if (value === lowValue) low.push(markers[i]);
        }
        return { high: high, low: low, highValue: highValue, lowValue: lowValue };
    }

    function drawExtremeLabels(ctx, pane, width, height) {
        const markers = state.result && state.result.markers && state.result.markers[pane.key];
        if (!markers || !markers.length) return;
        const extremes = markerExtremes(markers);
        const radius = bumpScreenRadius() + 4;
        const unit = (zUnit(pane) || '').trim();
        const highSet = new Set(extremes.high);
        const draw = (marker, kind) => {
            const point = imageToScreen(pane, marker.x, marker.y, width, height);
            const color = kind === 'low' ? '#6cb6ff' : '#ffb020';
            const value = kind === 'low' ? extremes.lowValue : extremes.highValue;
            const valueText = Number.isFinite(value) ? value.toFixed(4) + (unit ? ' ' + unit : '') : '';
            let text = kind === 'both'
                ? t('overlayExtremeHigh') + ' / ' + t('overlayExtremeLow')
                : kind === 'high' ? t('overlayExtremeHigh') : t('overlayExtremeLow');
            if (valueText) text += ' ' + valueText;
            ctx.save();
            ctx.lineWidth = 2;
            ctx.strokeStyle = color;
            ctx.beginPath();
            ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.font = '12px "Segoe UI", "Microsoft JhengHei", sans-serif';
            const padX = 6;
            const boxH = 18;
            const boxW = Math.ceil(ctx.measureText(text).width) + padX * 2;
            let boxX = point.x - boxW / 2;
            let boxY = kind === 'low' ? point.y + radius + 6 : point.y - radius - boxH - 6;
            boxX = clamp(boxX, 4, Math.max(4, width - boxW - 4));
            boxY = clamp(boxY, 4, Math.max(4, height - boxH - 4));
            ctx.fillStyle = 'rgba(16, 16, 22, 0.9)';
            ctx.beginPath();
            ctx.roundRect(boxX, boxY, boxW, boxH, 4);
            ctx.fill();
            ctx.fillStyle = color;
            ctx.textBaseline = 'middle';
            ctx.fillText(text, boxX + padX, boxY + boxH / 2);
            ctx.restore();
        };
        extremes.high.forEach((marker) => draw(marker, extremes.lowValue === extremes.highValue ? 'both' : 'high'));
        if (extremes.lowValue !== extremes.highValue) {
            extremes.low.forEach((marker) => {
                if (!highSet.has(marker)) draw(marker, 'low');
            });
        }
    }

    function drawImageLine(ctx, decor, color, showDelete) {
        const start = decor.start;
        const end = decor.end;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
        [start, end].forEach((point) => {
            ctx.beginPath();
            ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#fff';
            ctx.stroke();
        });
        if (decor.labels && decor.label) {
            ctx.font = '12px Consolas, monospace';
            ctx.fillStyle = 'rgba(0,0,0,0.72)';
            ctx.fillRect(decor.label.x, decor.label.y, decor.label.w, decor.label.h);
            ctx.fillStyle = color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            decor.labels.forEach((label, index) => {
                ctx.fillText(label, decor.label.x + decor.label.w / 2, decor.label.y + 10 + index * 16);
            });
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
        }
        if (showDelete) drawDeleteButton(ctx, decor.button, decor.hot);
    }

    function drawStepDots(ctx, pane, bag, width, height) {
        const line = bag.profile;
        const data = pane.profileData;
        if (!line || !data) return;
        const mark = (index, color) => {
            const at = indexPoint(line, index, data.count);
            const point = imageToScreen(pane, at.col, at.row, width, height);
            ctx.beginPath();
            ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#fff';
            ctx.stroke();
        };
        if (pane.hoverIndex != null && !bag.profilePicking) {
            const at = indexPoint(line, pane.hoverIndex, data.count);
            const hover = imageToScreen(pane, at.col, at.row, width, height);
            ctx.beginPath();
            ctx.arc(hover.x, hover.y, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#ffd24a';
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#000';
            ctx.stroke();
        }
        bag.profileSets.forEach((pts, setIndex) => {
            const style = stepStyle(setIndex);
            pts.forEach((index, pointIndex) => mark(index, style.colors[pointIndex % style.colors.length]));
        });
        const draft = stepStyle(bag.profileSets.length);
        bag.profileDraft.forEach((index, pointIndex) => mark(index, draft.colors[pointIndex % draft.colors.length]));
    }

    function imageToScreen(pane, col, row, width, height) {
        const view = bagFor(pane).view;
        return {
            x: (col - view.col) * view.scale + width / 2,
            y: (row - view.row) * view.scale + height / 2,
        };
    }

    function screenToImage(pane, x, y) {
        const rect = pane.stageEl.getBoundingClientRect();
        const view = bagFor(pane).view;
        return {
            col: (x - rect.width / 2) / view.scale + view.col,
            row: (y - rect.height / 2) / view.scale + view.row,
        };
    }

    function eventPoint(event, pane) {
        const rect = pane.marks.getBoundingClientRect();
        return screenToImage(pane, event.clientX - rect.left, event.clientY - rect.top);
    }

    let drag = null;

    function onPointerDown(event, pane) {
        const dataset = displayed(pane);
        if (!dataset || event.button === 2) return;
        try { pane.marks.setPointerCapture(event.pointerId); } catch (_) {}
        activeLoadBag = pane;
        const bag = bagFor(pane);
        if (event.button === 0 && deleteMarkAt(event, pane, bag)) return;
        const point = eventPoint(event, pane);
        if (event.button === 1 || bag.tool === 'pan') {
            drag = { kind: 'pan', pane, x: event.clientX, y: event.clientY, col: bag.view.col, row: bag.view.row };
            return;
        }
        if (event.button !== 0) return;
        if (bag.tool === 'measure') {
            const hit = hitLine(event, pane, bag.measure);
            if (hit === 'a' || hit === 'b' || hit === 'line') {
                drag = { kind: 'measure-' + hit, pane, line: cloneLine(bag.measure), x: event.clientX, y: event.clientY };
            } else {
                bag.measure = { c0: point.col, r0: point.row, c1: point.col, r1: point.row };
                drag = { kind: 'measure-new', pane };
            }
            refreshMarks();
        } else if (bag.tool === 'step') {
            const hit = hitLine(event, pane, bag.profile);
            if (hit === 'a' || hit === 'b' || hit === 'line') {
                drag = { kind: 'profile-' + hit, pane, line: cloneLine(bag.profile), x: event.clientX, y: event.clientY };
            } else {
                bag.profile = { c0: point.col, r0: point.row, c1: point.col, r1: point.row };
                bag.profileSets = [];
                bag.profileDraft = [];
                drag = { kind: 'profile-new', pane };
            }
            refreshMarks();
        }
    }

    function onPointerMove(event, pane) {
        const dataset = displayed(pane);
        if (!dataset) return;
        if (!drag) updateMarkHover(event, pane);
        if (bagFor(pane).tool === 'inspect') showTip(event, pane, dataset);
        else hideTip(pane);
        if (!drag || drag.pane !== pane) return;
        const bag = bagFor(pane);
        const point = eventPoint(event, pane);
        if (drag.kind === 'pan') {
            const view = bag.view;
            view.col = drag.col - (event.clientX - drag.x) / view.scale;
            view.row = drag.row - (event.clientY - drag.y) / view.scale;
            requestMaps();
            return;
        }
        if (drag.kind === 'measure-new') {
            bag.measure.c1 = point.col;
            bag.measure.r1 = point.row;
        } else if (drag.kind === 'profile-new') {
            bag.profile.c1 = point.col;
            bag.profile.r1 = point.row;
        } else if (drag.kind === 'measure-a' || drag.kind === 'profile-a') {
            const line = drag.kind.startsWith('measure') ? bag.measure : bag.profile;
            line.c0 = point.col;
            line.r0 = point.row;
            if (drag.kind.startsWith('profile')) resetProfilePicks(bag);
        } else if (drag.kind === 'measure-b' || drag.kind === 'profile-b') {
            const line = drag.kind.startsWith('measure') ? bag.measure : bag.profile;
            line.c1 = point.col;
            line.r1 = point.row;
            if (drag.kind.startsWith('profile')) resetProfilePicks(bag);
        } else if (drag.kind === 'measure-line' || drag.kind === 'profile-line') {
            const line = drag.kind.startsWith('measure') ? bag.measure : bag.profile;
            const view = bag.view;
            const dc = (event.clientX - drag.x) / view.scale;
            const dr = (event.clientY - drag.y) / view.scale;
            line.c0 = drag.line.c0 + dc;
            line.r0 = drag.line.r0 + dr;
            line.c1 = drag.line.c1 + dc;
            line.r1 = drag.line.r1 + dr;
            if (drag.kind.startsWith('profile')) resetProfilePicks(bag);
        }
        refreshMarks();
    }

    function onPointerUp(event, pane) {
        if (drag && drag.pane === pane) drag = null;
        try { pane.marks.releasePointerCapture(event.pointerId); } catch (_) {}
    }

    function onWheel(event, pane) {
        const dataset = displayed(pane);
        if (!dataset) return;
        event.preventDefault();
        const bag = bagFor(pane);
        const before = eventPoint(event, pane);
        const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
        bag.view.scale = Math.min(80, Math.max(dataset.width > 0 ? 0.02 : 0.02, bag.view.scale * factor));
        const rect = pane.marks.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        bag.view.col = before.col - (x - rect.width / 2) / bag.view.scale;
        bag.view.row = before.row - (y - rect.height / 2) / bag.view.scale;
        requestMaps();
    }

    function showTip(event, pane, dataset) {
        const point = eventPoint(event, pane);
        const lines = tipLines(pane, dataset, point);
        pane.tip.innerHTML = lines.map((line) => '<div>' + line + '</div>').join('');
        const rect = pane.stageEl.getBoundingClientRect();
        pane.tip.style.left = Math.min(rect.width - 160, event.clientX - rect.left + 14) + 'px';
        pane.tip.style.top = Math.min(rect.height - 72, event.clientY - rect.top + 14) + 'px';
        pane.tip.classList.add('show');
    }

    function tipLines(pane, dataset, point) {
        if (pane.stage === 'result' && state.result) {
            return [
                t('overlayFront') + ' ' + formatZ(displayedValue('front', point)),
                t('overlayBack') + ' ' + formatZ(displayedValue('back', point)),
                t('overlaySum') + ' ' + formatZ(displayedValue('sum', point)),
            ];
        }
        return [formatZ(sampleDataset(dataset, point))];
    }

    function formatZ(value) {
        return Number.isFinite(value) ? value.toFixed(3) : t('overlayNoValue');
    }

    function hideTip(pane) {
        pane.tip.classList.remove('show');
    }

    function sampleDataset(dataset, point) {
        if (!dataset) return NaN;
        const c = point.col | 0;
        const r = point.row | 0;
        if (r < 0 || c < 0 || r >= dataset.height || c >= dataset.width) return NaN;
        return dataset.data[r * dataset.width + c];
    }

    function hitLine(event, pane, line) {
        if (!line) return '';
        const rect = pane.marks.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const a = imageToScreen(pane, line.c0, line.r0, width, height);
        const b = imageToScreen(pane, line.c1, line.r1, width, height);
        if (Math.hypot(x - a.x, y - a.y) <= 10) return 'a';
        if (Math.hypot(x - b.x, y - b.y) <= 10) return 'b';
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        if (len2 < 1) return '';
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
        const px = a.x + dx * t;
        const py = a.y + dy * t;
        if (Math.hypot(x - px, y - py) <= 8) return 'line';
        return '';
    }

    function cloneLine(line) {
        return line ? { c0: line.c0, r0: line.r0, c1: line.c1, r1: line.r1 } : null;
    }

    function resetProfilePicks(bag) {
        bag.profileSets = [];
        bag.profileDraft = [];
    }

    function spacingOf(dataset) {
        const header = dataset.header || {};
        const width = Math.max(1, dataset.width - 1);
        const height = Math.max(1, dataset.height - 1);
        const xlength = Number(header.xlength || header['x-length'] || dataset.width);
        const ylength = Number(header.ylength || header['y-length'] || dataset.height);
        return {
            dx: xlength / width,
            dy: ylength / height,
            unit: header.zunit || header['z-unit'] || '',
        };
    }

    function profilePanelHtml() {
        return '<div class="bc-profile-panel overlay-profile" hidden>' +
            '<div class="bc-profile-head">' +
                '<span class="bc-profile-title" data-i18n="bc.profileTitle">剖面</span>' +
                '<span class="bc-profile-meta"></span>' +
                '<div class="profile-chart-toggle" role="group" data-i18n-aria="bc.profileChartStyleTitle" aria-label="剖面圖樣式">' +
                    '<button type="button" data-profile-chart="line" class="active" data-i18n-title="bc.profileChartLineTitle" data-i18n-aria="bc.profileChartLineTitle" title="折線圖" aria-label="折線圖" aria-pressed="true">' +
                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19h16"/><path d="M5 15l4-5 4 3 5-8 4 4"/></svg>' +
                    '</button>' +
                    '<button type="button" data-profile-chart="dots" data-i18n-title="bc.profileChartDotsTitle" data-i18n-aria="bc.profileChartDotsTitle" title="散點圖" aria-label="散點圖" aria-pressed="false">' +
                        '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="6" cy="16" r="1.8"/><circle cx="10" cy="10" r="1.8"/><circle cx="14" cy="14" r="1.8"/><circle cx="18" cy="7" r="1.8"/><circle cx="8" cy="6" r="1.8"/><circle cx="16" cy="18" r="1.8"/></svg>' +
                    '</button>' +
                '</div>' +
                '<button type="button" class="bc-profile-icon-btn overlay-profile-pick" data-i18n-title="bc.profileMeasureTitle" data-i18n-aria="bc.profileMeasureTitle" title="量階高" aria-label="量階高">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 18h18"/><path d="M4 16 8 11 12 14 16 7 20 10"/><path d="M12 4v14" stroke-dasharray="2.5 2.5"/></svg>' +
                '</button>' +
                '<button type="button" class="bc-profile-icon-btn overlay-profile-clear" data-i18n-title="bc.profileMeasureClearTitle" data-i18n-aria="bc.profileMeasureClearTitle" title="清除階高測量" aria-label="清除階高測量" disabled>' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
                '</button>' +
            '</div>' +
            '<div class="bc-profile-plot"><canvas class="overlay-profile-canvas"></canvas><div class="bc-profile-tip"></div></div>' +
        '</div>';
    }

    function bindPaneProfile(pane) {
        pane.profilePick.addEventListener('click', () => toggleProfilePick(pane));
        pane.profileClear.addEventListener('click', () => {
            const bag = bagFor(pane);
            bag.profileSets = [];
            bag.profileDraft = [];
            bag.profilePicking = false;
            refreshMarks();
        });
        pane.profilePanel.querySelectorAll('button[data-profile-chart]').forEach((button) => {
            button.addEventListener('click', () => {
                pane.chartStyle = button.getAttribute('data-profile-chart');
                syncProfileButtons();
                renderPaneProfile(pane);
            });
        });
        const canvas = pane.profileCanvas;
        canvas.addEventListener('pointerdown', (event) => onProfilePointerDown(event, pane));
        canvas.addEventListener('pointermove', (event) => onProfilePointerMove(event, pane));
        canvas.addEventListener('pointerup', (event) => onProfilePointerUp(event, pane));
        canvas.addEventListener('pointercancel', (event) => onProfilePointerUp(event, pane));
        canvas.addEventListener('pointerleave', () => {
            const peers = profilePeers(pane);
            const dirty = peers.some((other) => other.chartHover || other.hoverIndex != null);
            peers.forEach((other) => {
                other.chartHover = null;
                other.hoverIndex = null;
                other.profileTip.classList.remove('show');
            });
            if (!dirty) return;
            peers.forEach((other) => {
                renderPaneProfile(other);
                paintMarks(other);
            });
        });
        canvas.addEventListener('click', (event) => onProfileClick(event, pane));
    }

    function toggleProfilePick(pane) {
        const bag = bagFor(pane);
        if (!bag.profile) return;
        if (bag.profilePicking) {
            bag.profilePicking = false;
            bag.profileDraft = [];
        } else if (bag.profileSets.length >= STEP_MAX_SETS) {
            showToast(t('profileMeasureMaxSets', STEP_MAX_SETS), 'info');
        } else {
            bag.profilePicking = true;
            bag.profileDraft = [];
        }
        pane.profileTip.classList.remove('show');
        refreshMarks();
    }

    function currentPanes() {
        const panes = state.step === 0
            ? [loadPanes.front, loadPanes.back]
            : [resultPanes.front, resultPanes.back, resultPanes.sum];
        return panes.filter(Boolean);
    }

    function clearMarkHover(bag) {
        currentPanes().forEach((pane) => {
            if (bagFor(pane) !== bag) return;
            pane.markHover = '';
            pane.markHot = false;
            pane.hoverIndex = null;
            pane.chartHover = null;
            pane.profileTip.classList.remove('show');
        });
    }

    function deleteMarkAt(event, pane, bag) {
        const pos = canvasPos(event, pane.marks);
        if (bag.measure && pane.measureDecor && pointInBox(pos.x, pos.y, pane.measureDecor.button, 3)) {
            bag.measure = null;
            clearMarkHover(bag);
            refreshMarks();
            return true;
        }
        if (bag.profile && pane.profileDecor && pointInBox(pos.x, pos.y, pane.profileDecor.button, 3)) {
            bag.profile = null;
            bag.profileSets = [];
            bag.profileDraft = [];
            bag.profilePicking = false;
            clearMarkHover(bag);
            refreshMarks();
            return true;
        }
        return false;
    }

    function updateMarkHover(event, pane) {
        const bag = bagFor(pane);
        const pos = canvasPos(event, pane.marks);
        let hover = '';
        let hot = false;
        if (bag.measure && pane.measureDecor && markBodyHit(event, pane, bag.measure, pane.measureDecor, pos)) {
            hover = 'measure';
            hot = pointInBox(pos.x, pos.y, pane.measureDecor.button, 3);
        } else if (bag.profile && pane.profileDecor && markBodyHit(event, pane, bag.profile, pane.profileDecor, pos)) {
            hover = 'profile';
            hot = pointInBox(pos.x, pos.y, pane.profileDecor.button, 3);
        }
        if (pane.markHover === hover && pane.markHot === hot) return;
        pane.markHover = hover;
        pane.markHot = hot;
        paintMarks(pane);
    }

    function markBodyHit(event, pane, line, decor, pos) {
        if (pointInBox(pos.x, pos.y, decor.button, 3)) return true;
        if (pointInBox(pos.x, pos.y, decor.bridge, 0)) return true;
        if (decor.label && pointInBox(pos.x, pos.y, decor.label, 2)) return true;
        return !!hitLine(event, pane, line);
    }

    function canvasPos(event, canvas) {
        const rect = canvas.getBoundingClientRect();
        const width = canvas.width || rect.width;
        const height = canvas.height || rect.height;
        return {
            x: (event.clientX - rect.left) * (width / Math.max(1, rect.width)),
            y: (event.clientY - rect.top) * (height / Math.max(1, rect.height)),
            width: width,
            height: height,
        };
    }

    function cssPos(event, canvas) {
        const rect = canvas.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    function clamp(value, lo, hi) {
        return Math.max(lo, Math.min(hi, value));
    }

    function pointInBox(px, py, box, pad) {
        if (!box) return false;
        const extra = pad || 0;
        const x = box.x != null ? box.x : box.left;
        const y = box.y != null ? box.y : box.top;
        const w = box.w != null ? box.w : box.width;
        const h = box.h != null ? box.h : box.height;
        return px >= x - extra && py >= y - extra && px <= x + w + extra && py <= y + h + extra;
    }

    function rightmostAnchor(candidates) {
        let bestEdge = -Infinity;
        const tied = [];
        candidates.forEach((item) => {
            const edge = item.x + item.clearance;
            if (edge > bestEdge + 0.5) {
                bestEdge = edge;
                tied.length = 0;
                tied.push(item);
            } else if (edge >= bestEdge - 0.5) tied.push(item);
        });
        let y = 0;
        tied.forEach((item) => { y += item.y; });
        return { x: tied[0].x, y: y / tied.length, clearance: tied[0].clearance };
    }

    function attachDeleteButton(x, y, clearance, width, height) {
        const size = DELETE_SIZE;
        const margin = 2;
        let bx = x + clearance + 5;
        let by = y - size / 2;
        if (bx + size > width - margin) bx = x + clearance - size;
        bx = clamp(bx, margin, Math.max(margin, width - margin - size));
        by = clamp(by, margin, Math.max(margin, height - margin - size));
        const button = { x: bx, y: by, w: size, h: size };
        const x0 = Math.min(x, button.x) - 6;
        const y0 = Math.min(y, button.y) - 8;
        const x1 = Math.max(x, button.x + button.w) + 2;
        const y1 = Math.max(y, button.y + button.h) + 8;
        return { button: button, bridge: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
    }

    function drawDeleteButton(ctx, button, hot) {
        const cx = button.x + button.w / 2;
        const cy = button.y + button.h / 2;
        const arm = 2.6;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, button.w / 2, 0, Math.PI * 2);
        ctx.fillStyle = hot ? '#d64545' : 'rgba(16, 16, 22, 0.92)';
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255,255,255,0.92)';
        ctx.stroke();
        ctx.beginPath();
        ctx.lineWidth = 1.6;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#fff';
        ctx.moveTo(cx - arm, cy - arm);
        ctx.lineTo(cx + arm, cy + arm);
        ctx.moveTo(cx + arm, cy - arm);
        ctx.lineTo(cx - arm, cy + arm);
        ctx.stroke();
        ctx.restore();
    }

    function spacingDataset(pane) {
        if (pane.stage === 'result' && state.result) return state.result.front;
        return displayed(pane);
    }

    function zUnit(pane) {
        const dataset = displayed(pane);
        const header = dataset && dataset.header;
        if (!header) return '';
        return header.zunit || header['z-unit'] || '';
    }

    function distInfo(pane, distPx, line) {
        const pxText = formatNum(distPx, 1) + ' ' + t('measureUnitPx');
        const dataset = spacingDataset(pane);
        if (!dataset || !line) return { text: pxText, pxText: null };
        const lenPx = Math.hypot(line.c1 - line.c0, line.r1 - line.r0);
        if (!(lenPx > 0)) return { text: pxText, pxText: null };
        const space = spacingOf(dataset);
        const per = Math.hypot((line.c1 - line.c0) / lenPx * space.dx, (line.r1 - line.r0) / lenPx * space.dy);
        const header = dataset.header || {};
        const unit = header.xunit || header['x-unit'] || 'mm';
        return { text: formatNum(distPx * per, 3) + ' ' + unit, pxText: pxText };
    }

    function lineDecor(pane, line, width, height, withLabel) {
        const start = imageToScreen(pane, line.c0, line.r0, width, height);
        const end = imageToScreen(pane, line.c1, line.r1, width, height);
        const anchors = [
            { x: start.x, y: start.y, clearance: 12 },
            { x: end.x, y: end.y, clearance: 12 },
        ];
        let labels = null;
        let label = null;
        if (withLabel) {
            const info = distInfo(pane, Math.hypot(line.c1 - line.c0, line.r1 - line.r0), line);
            labels = info.pxText ? [info.pxText, info.text] : [info.text];
            const ctx = pane.marks.getContext('2d');
            ctx.save();
            ctx.font = '12px Consolas, monospace';
            let boxW = 0;
            labels.forEach((text) => { boxW = Math.max(boxW, ctx.measureText(text).width); });
            ctx.restore();
            boxW += 10;
            const boxH = labels.length * 16 + 4;
            const midX = (start.x + end.x) * 0.5;
            const midY = (start.y + end.y) * 0.5;
            label = { x: midX - boxW * 0.5, y: midY - boxH - 6, w: boxW, h: boxH };
            anchors.push({ x: label.x + label.w, y: label.y + label.h / 2, clearance: 0 });
        }
        const anchor = rightmostAnchor(anchors);
        const attached = attachDeleteButton(anchor.x, anchor.y, anchor.clearance, width, height);
        const hot = withLabel ? pane.markHover === 'measure' && pane.markHot : pane.markHover === 'profile' && pane.markHot;
        return { start: start, end: end, labels: labels, label: label, button: attached.button, bridge: attached.bridge, hot: hot };
    }

    function indexPoint(line, index, count) {
        const tt = count > 1 ? index / (count - 1) : 0;
        return {
            col: line.c0 + (line.c1 - line.c0) * tt,
            row: line.r0 + (line.r1 - line.r0) * tt,
        };
    }

    function buildProfileData(pane) {
        const bag = bagFor(pane);
        const dataset = displayed(pane);
        const line = bag && bag.profile;
        if (!line || !dataset) return null;
        const dx = line.c1 - line.c0;
        const dy = line.r1 - line.r0;
        const distPx = Math.hypot(dx, dy);
        const count = Math.max(2, Math.ceil(Math.min(distPx, 4000)));
        const vals = new Float32Array(count);
        const dist = new Float32Array(count);
        let vmin = Infinity;
        let vmax = -Infinity;
        let any = false;
        for (let i = 0; i < count; i++) {
            const tt = count > 1 ? i / (count - 1) : 0;
            dist[i] = distPx * tt;
            const at = { col: line.c0 + dx * tt, row: line.r0 + dy * tt };
            const value = pane.stage === 'result' ? displayedValue(pane.key, at) : sampleDataset(dataset, at);
            vals[i] = value;
            if (!Number.isFinite(value)) continue;
            any = true;
            if (value < vmin) vmin = value;
            if (value > vmax) vmax = value;
        }
        if (!any) { vmin = 0; vmax = 1; }
        else if (vmin === vmax) { vmin -= 0.5; vmax += 0.5; }
        return { vals: vals, dist: dist, distPx: distPx, count: count, vmin: vmin, vmax: vmax, any: any };
    }

    function stepStyle(index) {
        return STEP_STYLES[((index % STEP_STYLES.length) + STEP_STYLES.length) % STEP_STYLES.length];
    }

    function measureResult(data, pts) {
        if (!data || !pts || pts.length < 2) return null;
        const z0 = data.vals[pts[0]];
        const z1 = data.vals[pts[1]];
        if (!Number.isFinite(z0) || !Number.isFinite(z1)) return null;
        return { dist: Math.abs(data.dist[pts[1]] - data.dist[pts[0]]), step: Math.abs(z1 - z0) };
    }

    function paintProfile() {
        currentPanes().forEach((pane) => {
            if (!pane.root.classList.contains('collapsed')) renderPaneProfile(pane);
            else pane.profilePanel.hidden = true;
        });
        syncProfileButtons();
    }

    function paintMeasureReadout() {
        if (!el.measureReadout) return;
        el.measureReadout.hidden = true;
        el.measureReadout.innerHTML = '';
    }

    function syncProfileButtons() {
        currentPanes().forEach((pane) => {
            const bag = bagFor(pane);
            const atMax = bag.profileSets.length >= STEP_MAX_SETS;
            pane.profilePick.classList.toggle('active', !!bag.profilePicking);
            pane.profilePick.disabled = !bag.profile || (!bag.profilePicking && atMax);
            pane.profileClear.disabled = !(bag.profileSets.length || bag.profileDraft.length);
            pane.profilePlot.classList.toggle('measure-mode', !!bag.profilePicking);
            pane.profilePanel.querySelectorAll('button[data-profile-chart]').forEach((button) => {
                const on = button.getAttribute('data-profile-chart') === pane.chartStyle;
                button.classList.toggle('active', on);
                button.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
        });
    }

    function profileMetaText(pane, data) {
        const bag = bagFor(pane);
        const parts = [
            t('profileLength') + ': ' + formatNum(data.distPx, 1) + ' ' + t('measureUnitPx'),
            t('profileSamples') + ': ' + data.count,
            t('profileRange') + ': ' + formatNum(data.vmin, 3) + ' ~ ' + formatNum(data.vmax, 3),
        ];
        const many = bag.profileSets.length > 1;
        const unit = zUnit(pane);
        bag.profileSets.forEach((pts, index) => {
            const result = measureResult(data, pts);
            if (!result) return;
            const dist = distInfo(pane, result.dist, bag.profile);
            let text = (many ? '#' + (index + 1) + ' ' : '') + t('measureDist') + ' ' + dist.text;
            if (dist.pxText) text += ' (' + dist.pxText + ')';
            text += ' · ' + t('profileMeasureStep') + ' ' + formatNum(result.step, 3) + (unit ? ' ' + unit : '');
            parts.push(text);
        });
        return parts.join(' · ');
    }

    function renderPaneProfile(pane) {
        const bag = bagFor(pane);
        const data = buildProfileData(pane);
        pane.profileData = data;
        pane.profilePanel.hidden = !bag.profile;
        if (!bag.profile || !data) {
            pane.layouts = [];
            return;
        }
        pane.profileMeta.textContent = profileMetaText(pane, data);
        const canvas = pane.profileCanvas;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.max(1, canvas.clientWidth || canvas.parentElement.clientWidth || 280);
        const height = Math.max(1, canvas.clientHeight || 150);
        const bitmapW = Math.round(width * dpr);
        const bitmapH = Math.round(height * dpr);
        if (canvas.width !== bitmapW) canvas.width = bitmapW;
        if (canvas.height !== bitmapH) canvas.height = bitmapH;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        const padL = 54;
        const padR = 12;
        const padT = 10;
        const padB = 22;
        const plotW = Math.max(1, width - padL - padR);
        const plotH = Math.max(1, height - padT - padB);
        const geom = { padL: padL, padT: padT, plotW: plotW, plotH: plotH, width: width, height: height };
        pane.geom = geom;
        ctx.fillStyle = 'rgba(255,255,255,0.03)';
        ctx.fillRect(padL, padT, plotW, plotH);
        ctx.font = '11px Consolas, monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const span = (data.vmax - data.vmin) || 1;
        for (let i = 0; i <= 4; i++) {
            const py = padT + plotH * (i / 4);
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.beginPath();
            ctx.moveTo(padL, py);
            ctx.lineTo(padL + plotW, py);
            ctx.stroke();
            ctx.fillStyle = '#9a9ab0';
            ctx.fillText(formatNum(data.vmax - span * (i / 4), 2), padL - 6, py);
        }
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (let i = 0; i <= 5; i++) {
            const px = padL + plotW * (i / 5);
            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.beginPath();
            ctx.moveTo(px, padT);
            ctx.lineTo(px, padT + plotH);
            ctx.stroke();
            ctx.fillStyle = '#9a9ab0';
            ctx.fillText((data.distPx * (i / 5)).toFixed(0), px, padT + plotH + 4);
        }
        ctx.save();
        ctx.beginPath();
        ctx.rect(padL, padT, plotW, plotH);
        ctx.clip();
        if (pane.chartStyle === 'dots') {
            ctx.fillStyle = '#4f8cff';
            for (let i = 0; i < data.count; i++) {
                const point = chartPoint(data, geom, i);
                if (!point) continue;
                ctx.beginPath();
                ctx.arc(point.px, point.py, 2.2, 0, Math.PI * 2);
                ctx.fill();
            }
        } else {
            ctx.strokeStyle = '#4f8cff';
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            let started = false;
            for (let i = 0; i < data.count; i++) {
                const point = chartPoint(data, geom, i);
                if (!point) { started = false; continue; }
                if (!started) { ctx.moveTo(point.px, point.py); started = true; }
                else ctx.lineTo(point.px, point.py);
            }
            ctx.stroke();
        }
        ctx.restore();
        if (pane.hoverIndex != null && !bag.profilePicking) {
            const point = chartPoint(data, geom, pane.hoverIndex);
            const frac = data.distPx > 0 ? data.dist[pane.hoverIndex] / data.distPx : 0;
            const px = padL + frac * plotW;
            ctx.strokeStyle = 'rgba(255,210,74,0.85)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(px, padT);
            ctx.lineTo(px, padT + plotH);
            ctx.stroke();
            if (point) {
                ctx.fillStyle = '#ffd24a';
                ctx.beginPath();
                ctx.arc(point.px, point.py, 3.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        drawProfileMeasures(ctx, pane, bag, data, geom);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }

    function chartPoint(data, geom, index) {
        const value = data.vals[index];
        if (!Number.isFinite(value)) return null;
        const span = (data.vmax - data.vmin) || 1;
        return {
            px: geom.padL + (data.dist[index] / (data.distPx || 1)) * geom.plotW,
            py: geom.padT + (1 - (value - data.vmin) / span) * geom.plotH,
        };
    }

    function drawProfileMeasures(ctx, pane, bag, data, geom) {
        pane.layouts = [];
        const drawPair = (pts, style, setNum, key) => {
            const layout = profileMeasureLayout(ctx, pane, data, geom, pts, setNum);
            if (!layout) return;
            layout.key = key;
            pane.layouts.push(layout);
            if (layout.corner && layout.p0 && layout.p1) {
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(layout.p0.px, layout.p0.py);
                ctx.lineTo(layout.corner.px, layout.corner.py);
                ctx.lineTo(layout.p1.px, layout.p1.py);
                ctx.closePath();
                ctx.fillStyle = style.fill;
                ctx.fill();
                ctx.setLineDash([5, 4]);
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(layout.p0.px, layout.p0.py);
                ctx.lineTo(layout.corner.px, layout.corner.py);
                ctx.strokeStyle = 'rgba(0,0,0,0.55)';
                ctx.lineWidth = 3;
                ctx.stroke();
                ctx.strokeStyle = style.dist;
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(layout.corner.px, layout.corner.py);
                ctx.lineTo(layout.p1.px, layout.p1.py);
                ctx.strokeStyle = 'rgba(0,0,0,0.55)';
                ctx.lineWidth = 3;
                ctx.stroke();
                ctx.strokeStyle = style.step;
                ctx.lineWidth = 2;
                ctx.stroke();
                if (layout.labels.length) {
                    paintChartLabel(ctx, layout.labels[0], style.dist);
                    paintChartLabel(ctx, layout.labels[1], style.step);
                }
                ctx.restore();
            }
            pts.forEach((index, pointIndex) => {
                const point = chartPoint(data, geom, index);
                if (!point) return;
                ctx.beginPath();
                ctx.arc(point.px, point.py, 5, 0, Math.PI * 2);
                ctx.fillStyle = style.colors[pointIndex % style.colors.length];
                ctx.fill();
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = '#fff';
                ctx.stroke();
            });
        };
        const showNum = bag.profileSets.length > 1;
        bag.profileSets.forEach((pts, index) => drawPair(pts, stepStyle(index), showNum ? index + 1 : null, index));
        if (bag.profileDraft.length) drawPair(bag.profileDraft, stepStyle(bag.profileSets.length), null, 'draft');
        const hover = pane.chartHover;
        if (hover && !pane.chartDrag) {
            for (let i = 0; i < pane.layouts.length; i++) {
                if (pane.layouts[i].key !== hover.key) continue;
                drawDeleteButton(ctx, pane.layouts[i].button, hover.part === 'delete');
                break;
            }
        }
    }

    function profileMeasureLayout(ctx, pane, data, geom, pts, setNum) {
        const bag = bagFor(pane);
        const p0 = chartPoint(data, geom, pts[0]);
        const p1 = pts.length > 1 ? chartPoint(data, geom, pts[1]) : null;
        if (!p0 && !p1) return null;
        const labels = [];
        let corner = null;
        if (pts.length === 2 && p0 && p1) {
            corner = { px: p1.px, py: p0.py };
            const result = measureResult(data, pts);
            if (result) {
                const prefix = setNum != null ? '#' + setNum + ' ' : '';
                const dist = distInfo(pane, result.dist, bag.profile);
                let distText = prefix + t('measureDist') + ' ' + dist.text;
                if (dist.pxText) distText += ' (' + dist.pxText + ')';
                const unit = zUnit(pane);
                const stepText = prefix + t('profileMeasureStep') + ' ' + formatNum(result.step, 3) + (unit ? ' ' + unit : '');
                const distX = (p0.px + corner.px) / 2;
                const stepY = (corner.py + p1.py) / 2;
                const above = p0.py - geom.padT > 22 ? -14 : 14;
                const roomRight = geom.padL + geom.plotW - corner.px;
                const roomLeft = corner.px - geom.padL;
                const side = roomRight >= roomLeft ? 10 : -10;
                const frame = { x: 4, y: 4, w: geom.width - 8, h: geom.height - 8 };
                const distBox = clampChartLabel(chartLabelBox(ctx, distText, distX, p0.py + above, 'center'), frame);
                let stepBox = clampChartLabel(chartLabelBox(ctx, stepText, corner.px + side, stepY, side > 0 ? 'left' : 'right'), frame);
                if (labelsOverlap(distBox, stepBox)) {
                    stepBox.top = clamp(distBox.top + distBox.height + 4, frame.y, frame.y + frame.h - stepBox.height);
                }
                labels.push(distBox, stepBox);
            }
        }
        const candidates = [];
        if (p0) candidates.push({ x: p0.px, y: p0.py, clearance: 12 });
        if (p1) candidates.push({ x: p1.px, y: p1.py, clearance: 12 });
        if (corner) candidates.push({ x: corner.px, y: corner.py, clearance: 8 });
        labels.forEach((label) => candidates.push({ x: label.left + label.width, y: label.top + label.height / 2, clearance: 0 }));
        if (!candidates.length) return null;
        const anchor = rightmostAnchor(candidates);
        const attached = attachDeleteButton(anchor.x, anchor.y, anchor.clearance, geom.width, geom.height);
        return { p0: p0, p1: p1, corner: corner, labels: labels, button: attached.button, bridge: attached.bridge };
    }

    function chartLabelBox(ctx, text, x, y, align) {
        ctx.font = '11px Consolas, monospace';
        const width = ctx.measureText(text).width + 10;
        const height = 16;
        let left = x;
        if (align === 'center') left -= width / 2;
        else if (align === 'right') left -= width;
        return { text: text, left: left, top: y - height / 2, width: width, height: height };
    }

    function clampChartLabel(box, bounds) {
        box.left = clamp(box.left, bounds.x, Math.max(bounds.x, bounds.x + bounds.w - box.width));
        box.top = clamp(box.top, bounds.y, Math.max(bounds.y, bounds.y + bounds.h - box.height));
        return box;
    }

    function labelsOverlap(a, b) {
        return !(a.left + a.width + 4 <= b.left || b.left + b.width + 4 <= a.left
            || a.top + a.height + 4 <= b.top || b.top + b.height + 4 <= a.top);
    }

    function paintChartLabel(ctx, box, color) {
        ctx.font = '11px Consolas, monospace';
        ctx.fillStyle = 'rgba(0,0,0,0.78)';
        ctx.fillRect(box.left, box.top, box.width, box.height);
        ctx.fillStyle = color;
        ctx.fillRect(box.left, box.top, 2, box.height);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(box.text, box.left + 6, box.top + box.height / 2 + 0.5);
    }

    function profileMeasurePointer(pane, mx, my) {
        let best = null;
        let bestDist = Infinity;
        for (let i = pane.layouts.length - 1; i >= 0; i--) {
            const item = pane.layouts[i];
            if (pointInBox(mx, my, item.button, 3)) return { key: item.key, part: 'delete' };
        }
        for (let i = pane.layouts.length - 1; i >= 0; i--) {
            const item = pane.layouts[i];
            const dist = layoutBodyDist(mx, my, item);
            if (dist != null && dist < bestDist) {
                bestDist = dist;
                best = { key: item.key, part: 'body' };
            }
        }
        return best;
    }

    function layoutBodyDist(mx, my, item) {
        if (pointInBox(mx, my, item.bridge, 0)) return 0;
        let best = Infinity;
        const near = (point) => { if (point) best = Math.min(best, Math.hypot(mx - point.px, my - point.py)); };
        near(item.p0);
        near(item.p1);
        if (item.p0 && item.corner) best = Math.min(best, distToSegment(mx, my, item.p0.px, item.p0.py, item.corner.px, item.corner.py));
        if (item.corner && item.p1) best = Math.min(best, distToSegment(mx, my, item.corner.px, item.corner.py, item.p1.px, item.p1.py));
        for (let i = 0; i < item.labels.length; i++) {
            if (pointInBox(mx, my, item.labels[i], 2)) return 0;
        }
        return best <= STEP_HIT_RADIUS ? best : null;
    }

    function distToSegment(px, py, x0, y0, x1, y1) {
        const dx = x1 - x0;
        const dy = y1 - y0;
        const len2 = dx * dx + dy * dy;
        if (len2 <= 0) return Math.hypot(px - x0, py - y0);
        const tt = clamp(((px - x0) * dx + (py - y0) * dy) / len2, 0, 1);
        return Math.hypot(px - (x0 + tt * dx), py - (y0 + tt * dy));
    }

    function profileMeasureHit(pane, mx, my) {
        const data = pane.profileData;
        const geom = pane.geom;
        const bag = bagFor(pane);
        if (!data || !geom) return null;
        const limit = STEP_HIT_RADIUS * STEP_HIT_RADIUS;
        let best = null;
        let bestDist = Infinity;
        const consider = (setKey, pts) => {
            pts.forEach((index, ptIndex) => {
                const point = chartPoint(data, geom, index);
                if (!point) return;
                const dist = (mx - point.px) * (mx - point.px) + (my - point.py) * (my - point.py);
                if (dist <= limit && dist < bestDist) {
                    bestDist = dist;
                    best = { setKey: setKey, ptIndex: ptIndex };
                }
            });
        };
        bag.profileSets.forEach((pts, index) => consider(index, pts));
        consider('draft', bag.profileDraft);
        return best;
    }

    function measurePts(bag, key) {
        if (key === 'draft') return bag.profileDraft;
        return bag.profileSets[key] || null;
    }

    function indexTaken(bag, index) {
        if (bag.profileDraft.includes(index)) return true;
        return bag.profileSets.some((pts) => pts.includes(index));
    }

    function chartPick(pane, mx, my) {
        const data = pane.profileData;
        const geom = pane.geom;
        if (!data || !geom) return null;
        let best = -1;
        let bestDist = Infinity;
        const limit = STEP_CHART_PICK * STEP_CHART_PICK;
        for (let i = 0; i < data.count; i++) {
            const point = chartPoint(data, geom, i);
            if (!point) continue;
            const dist = (mx - point.px) * (mx - point.px) + (my - point.py) * (my - point.py);
            if (dist < bestDist) { bestDist = dist; best = i; }
        }
        return bestDist <= limit ? best : null;
    }

    function chartNearestX(pane, mx) {
        const data = pane.profileData;
        const geom = pane.geom;
        if (!data || !geom) return null;
        const frac = clamp((mx - geom.padL) / geom.plotW, 0, 1);
        const target = frac * data.distPx;
        let best = 0;
        let bestDist = Infinity;
        for (let i = 0; i < data.count; i++) {
            const dist = Math.abs(data.dist[i] - target);
            if (dist < bestDist) { bestDist = dist; best = i; }
        }
        return best;
    }

    function chartNearestPoint(pane, mx, my) {
        const data = pane.profileData;
        const geom = pane.geom;
        if (!data || !geom) return null;
        let best = -1;
        let bestDist = Infinity;
        for (let i = 0; i < data.count; i++) {
            const point = chartPoint(data, geom, i);
            if (!point) continue;
            const dist = (mx - point.px) * (mx - point.px) + (my - point.py) * (my - point.py);
            if (dist < bestDist) { bestDist = dist; best = i; }
        }
        return best >= 0 ? best : null;
    }

    function deleteProfileMeasure(bag, key) {
        if (key === 'draft') bag.profileDraft = [];
        else if (typeof key === 'number' && bag.profileSets[key]) bag.profileSets.splice(key, 1);
        else return;
        clearMarkHover(bag);
        refreshMarks();
    }

    function repaintProfiles(bag) {
        currentPanes().forEach((pane) => {
            if (bagFor(pane) !== bag || pane.root.classList.contains('collapsed')) return;
            renderPaneProfile(pane);
            paintMarks(pane);
        });
        syncProfileButtons();
    }

    function onProfilePointerDown(event, pane) {
        if (event.button !== 0) return;
        const pos = cssPos(event, pane.profileCanvas);
        const hover = profileMeasurePointer(pane, pos.x, pos.y);
        if (hover && hover.part === 'delete') {
            event.preventDefault();
            pane.suppressClick = true;
            deleteProfileMeasure(bagFor(pane), hover.key);
            return;
        }
        const hit = profileMeasureHit(pane, pos.x, pos.y);
        if (!hit) return;
        event.preventDefault();
        pane.chartHover = null;
        pane.chartDrag = { id: event.pointerId, key: hit.setKey, ptIndex: hit.ptIndex, moved: false };
        try { pane.profileCanvas.setPointerCapture(event.pointerId); } catch (_) {}
        renderPaneProfile(pane);
    }

    function profilePeers(pane) {
        const bag = bagFor(pane);
        return currentPanes().filter((other) => bagFor(other) === bag && !other.root.classList.contains('collapsed'));
    }

    function fillProfileTip(pane, index) {
        const data = pane.profileData;
        if (!data || index == null || index < 0 || index >= data.count) {
            pane.profileTip.classList.remove('show');
            return;
        }
        const unit = zUnit(pane);
        pane.profileTip.innerHTML = '<div><span class="k">Z</span>' + formatZ(data.vals[index]) + (unit ? ' ' + unit : '') + '</div>'
            + '<div><span class="k">' + t('measureDist') + '</span>' + formatNum(data.dist[index], 1) + ' ' + t('measureUnitPx') + '</div>';
        pane.profileTip.classList.add('show');
    }

    function moveProfileTip(pane, relX, relY) {
        const plot = pane.profilePlot.getBoundingClientRect();
        const width = plot.width || 1;
        const height = plot.height || 1;
        let left = relX * width + 12;
        let top = relY * height + 12;
        if (left + 150 > width) left = relX * width - 154;
        if (top + 48 > height) top = relY * height - 52;
        pane.profileTip.style.left = Math.max(2, left) + 'px';
        pane.profileTip.style.top = Math.max(2, top) + 'px';
    }

    function paintProfileHover(peers) {
        peers.forEach((other) => {
            renderPaneProfile(other);
            paintMarks(other);
        });
    }

    function onProfilePointerMove(event, pane) {
        const bag = bagFor(pane);
        const drag = pane.chartDrag;
        if (drag && drag.id === event.pointerId) {
            const pos = cssPos(event, pane.profileCanvas);
            const index = chartNearestPoint(pane, pos.x, pos.y);
            const pts = measurePts(bag, drag.key);
            if (index == null || !pts || pts[drag.ptIndex] === index) return;
            pts[drag.ptIndex] = index;
            drag.moved = true;
            repaintProfiles(bag);
            return;
        }
        if (!pane.profileData || !pane.geom) return;
        const peers = profilePeers(pane);
        const pos = cssPos(event, pane.profileCanvas);
        const hover = profileMeasurePointer(pane, pos.x, pos.y);
        const prev = pane.chartHover;
        const same = !!prev && !!hover && prev.key === hover.key && prev.part === hover.part;
        if (hover) {
            pane.chartHover = hover;
            pane.profileCanvas.style.cursor = hover.part === 'delete' ? 'pointer' : (profileMeasureHit(pane, pos.x, pos.y) ? 'grab' : 'default');
            let dirty = !same;
            peers.forEach((other) => {
                if (other !== pane) other.chartHover = null;
                if (other.hoverIndex != null) dirty = true;
                other.hoverIndex = null;
                other.profileTip.classList.remove('show');
            });
            if (dirty) paintProfileHover(peers);
            return;
        }
        if (prev) peers.forEach((other) => { other.chartHover = null; });
        pane.profileCanvas.style.cursor = bag.profilePicking ? 'crosshair' : '';
        const index = bag.profilePicking ? chartPick(pane, pos.x, pos.y) : chartNearestX(pane, pos.x);
        const plot = pane.profilePlot.getBoundingClientRect();
        const relX = plot.width ? (event.clientX - plot.left) / plot.width : 0;
        const relY = plot.height ? (event.clientY - plot.top) / plot.height : 0;
        let indexChanged = !!prev;
        peers.forEach((other) => {
            if (other.hoverIndex !== index) indexChanged = true;
            other.hoverIndex = index;
            fillProfileTip(other, index);
            if (index != null) moveProfileTip(other, relX, relY);
        });
        if (indexChanged) paintProfileHover(peers);
    }

    function onProfilePointerUp(event, pane) {
        const drag = pane.chartDrag;
        if (!drag || drag.id !== event.pointerId) return;
        if (drag.moved) pane.suppressClick = true;
        pane.chartDrag = null;
        repaintProfiles(bagFor(pane));
    }

    function onProfileClick(event, pane) {
        if (pane.suppressClick) {
            pane.suppressClick = false;
            return;
        }
        const bag = bagFor(pane);
        if (!bag.profile || !bag.profilePicking) return;
        const pos = cssPos(event, pane.profileCanvas);
        const index = chartPick(pane, pos.x, pos.y);
        if (index == null || indexTaken(bag, index)) return;
        bag.profileDraft.push(index);
        if (bag.profileDraft.length >= 2) {
            if (bag.profileSets.length >= STEP_MAX_SETS) bag.profileSets.shift();
            bag.profileSets.push(bag.profileDraft.slice());
            bag.profileDraft = [];
            bag.profilePicking = false;
        }
        refreshMarks();
    }

    let overlayMenuPane = null;

    function bindOverlayMenu() {
        const source = document.getElementById('bcImageMenu');
        if (!source) return;
        const menu = source.cloneNode(true);
        menu.id = 'bcOverlayImageMenu';
        menu.hidden = true;
        (document.getElementById('bcRoot') || document.body).appendChild(menu);
        el.imageMenu = menu;
        menu.addEventListener('contextmenu', (event) => event.preventDefault());
        menu.addEventListener('click', (event) => {
            const button = event.target.closest('button[data-save]');
            if (!button || !menu.contains(button)) return;
            const kind = button.getAttribute('data-save');
            const fmt = button.getAttribute('data-fmt');
            const pane = overlayMenuPane;
            closeOverlayMenu();
            saveOverlayImage(pane, kind, fmt);
        });
        document.addEventListener('pointerdown', (event) => {
            if (menu.hidden || menu.contains(event.target)) return;
            closeOverlayMenu();
        }, true);
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') closeOverlayMenu();
        });
        window.addEventListener('wheel', () => closeOverlayMenu(), { capture: true, passive: true });
    }

    function openOverlayMenu(event, pane) {
        const menu = el.imageMenu;
        if (!menu || !displayed(pane)) return;
        const other = document.getElementById('bcImageMenu');
        if (other) other.hidden = true;
        overlayMenuPane = pane;
        const margin = 8;
        menu.style.left = (event.clientX + 2) + 'px';
        menu.style.top = (event.clientY + 2) + 'px';
        menu.hidden = false;
        const rect = menu.getBoundingClientRect();
        let x = event.clientX + 2;
        let y = event.clientY + 2;
        if (x + rect.width > window.innerWidth - margin) x = window.innerWidth - rect.width - margin;
        if (y + rect.height > window.innerHeight - margin) y = window.innerHeight - rect.height - margin;
        menu.style.left = Math.max(margin, x) + 'px';
        menu.style.top = Math.max(margin, y) + 'px';
    }

    function closeOverlayMenu() {
        if (!el.imageMenu || el.imageMenu.hidden) return;
        el.imageMenu.hidden = true;
        overlayMenuPane = null;
    }

    function usingCircles(pane) {
        return !!(pane && state.result && state.result.markers && state.result.markers[pane.key]);
    }

    function viewPixelBounds(pane, dataset) {
        const view = bagFor(pane).view;
        const size = stagePixels(pane);
        const scale = view.scale || 1;
        const spanW = size.width / scale;
        const spanH = size.height / scale;
        const col = view.col - spanW / 2;
        const row = view.row - spanH / 2;
        const eps = 1e-6;
        const c0 = clamp(Math.floor(col + eps), 0, dataset.width);
        const r0 = clamp(Math.floor(row + eps), 0, dataset.height);
        const c1 = clamp(Math.ceil(col + spanW - eps), 0, dataset.width);
        const r1 = clamp(Math.ceil(row + spanH - eps), 0, dataset.height);
        if (c1 <= c0 || r1 <= r0) return null;
        return { c0: c0, r0: r0, c1: c1, r1: r1 };
    }

    function rasterizeMarkers(key, bounds, width, height, c0, r0) {
        const markers = state.result.markers[key] || [];
        const data = new Float32Array(width * height);
        data.fill(NaN);
        const radius = bumpDataRadius();
        const limit = radius * radius;
        const reach = Math.ceil(radius);
        for (let i = 0; i < markers.length; i++) {
            const marker = markers[i];
            const col = Math.round(marker.x);
            const row = Math.round(marker.y);
            const value = marker.z;
            for (let dy = -reach; dy <= reach; dy++) {
                const rr = row + dy;
                if (rr < r0 || rr >= r0 + height) continue;
                const ddy = dy * dy;
                for (let dx = -reach; dx <= reach; dx++) {
                    if (dx * dx + ddy > limit) continue;
                    const cc = col + dx;
                    if (cc < c0 || cc >= c0 + width) continue;
                    data[(rr - r0) * width + (cc - c0)] = value;
                }
            }
        }
        return { data: data, width: width, height: height, c0: c0, r0: r0 };
    }

    function extractOverlayGrid(pane, dataset, bounds) {
        const c0 = bounds ? bounds.c0 : 0;
        const r0 = bounds ? bounds.r0 : 0;
        const width = bounds ? bounds.c1 - bounds.c0 : dataset.width;
        const height = bounds ? bounds.r1 - bounds.r0 : dataset.height;
        if (width < 1 || height < 1) return null;
        if (usingCircles(pane)) return rasterizeMarkers(pane.key, bounds, width, height, c0, r0);
        if (!bounds) return { data: dataset.data, width: width, height: height, c0: 0, r0: 0 };
        const data = new Float32Array(width * height);
        const src = dataset.data;
        const sw = dataset.width;
        for (let row = 0; row < height; row++) {
            const dest = row * width;
            const srcRow = (r0 + row) * sw + c0;
            for (let col = 0; col < width; col++) {
                const value = src[srcRow + col];
                data[dest + col] = Number.isFinite(value) ? value : NaN;
            }
        }
        return { data: data, width: width, height: height, c0: c0, r0: r0 };
    }

    function formatHeaderNumber(value) {
        if (!Number.isFinite(value)) return '0';
        const abs = Math.abs(value);
        if (abs !== 0 && (abs < 1e-4 || abs >= 1e7)) return value.toExponential(8);
        return String(Number(value.toPrecision(10)));
    }

    function cleanUnit(unit, fallback) {
        const text = String(unit || '').replace(/[\r\n=]/g, '').trim();
        return text || fallback;
    }

    function exportMeta(dataset, grid) {
        const header = dataset.header || {};
        const space = spacingOf(dataset);
        const full = grid.c0 === 0 && grid.r0 === 0 && grid.width === dataset.width && grid.height === dataset.height;
        const rawX = header.xlength != null ? header.xlength : header['x-length'];
        const rawY = header.ylength != null ? header.ylength : header['y-length'];
        let xlength;
        let ylength;
        if (full && rawX != null && String(rawX).trim() && rawY != null && String(rawY).trim()) {
            xlength = String(rawX).trim();
            ylength = String(rawY).trim();
        } else if (full) {
            const xl = Number(rawX);
            const yl = Number(rawY);
            xlength = formatHeaderNumber(Number.isFinite(xl) && xl > 0 ? xl : space.dx * Math.max(1, dataset.width - 1));
            ylength = formatHeaderNumber(Number.isFinite(yl) && yl > 0 ? yl : space.dy * Math.max(1, dataset.height - 1));
        } else {
            xlength = formatHeaderNumber(space.dx * Math.max(1, grid.width - 1));
            ylength = formatHeaderNumber(space.dy * Math.max(1, grid.height - 1));
        }
        return {
            xlength: xlength,
            ylength: ylength,
            xunit: cleanUnit(header.xunit || header['x-unit'], 'mm'),
            yunit: cleanUnit(header.yunit || header['y-unit'], 'mm'),
            zunit: cleanUnit(header.zunit || header['z-unit'], 'um'),
        };
    }

    function exportName(dataset, kind, ext) {
        const raw = String(dataset.name || 'heightmap').replace(/[\\/:*?"<>|]/g, '_');
        const dot = raw.lastIndexOf('.');
        const stem = (dot > 0 ? raw.slice(0, dot) : raw) || 'heightmap';
        return stem + (kind === 'view' ? '_view' : '') + '.' + ext;
    }

    function downloadBlob(blob, name) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
    }

    function saveOverlayImage(pane, kind, fmt) {
        const dataset = pane && displayed(pane);
        if (!dataset) return;
        try {
            const bounds = kind === 'view' ? viewPixelBounds(pane, dataset) : null;
            if (kind === 'view' && !bounds) {
                showToast(t('toastSaveEmpty'), 'error');
                return;
            }
            const grid = extractOverlayGrid(pane, dataset, bounds);
            if (!grid) {
                showToast(t('toastSaveEmpty'), 'error');
                return;
            }
            const meta = exportMeta(dataset, grid);
            const blob = fmt === 'asc' ? encodeAsc(grid, meta) : encodeBcrf(grid, meta);
            const name = exportName(dataset, kind, fmt === 'asc' ? 'asc' : 'bcrf');
            downloadBlob(blob, name);
            showToast(t('toastSaved', name));
        } catch (err) {
            showToast(t('toastSaveFailed'), 'error');
        }
    }

    function setProgress(fraction, text) {
        el.progress.hidden = false;
        el.progressBar.style.width = Math.max(0, Math.min(1, fraction)) * 100 + '%';
        el.status.textContent = text || '';
    }

    function hideProgress() {
        el.progress.hidden = true;
        el.progressBar.style.width = '0%';
    }

    async function warpToFront(back, width, height, payload, onProgress) {
        const data = new Float32Array(width * height);
        data.fill(NaN);
        const matrix = payload.matrix;
        const t0 = payload.t_mm[0];
        const t1 = payload.t_mm[1];
        const r00 = matrix[0][0];
        const r01 = matrix[0][1];
        const r10 = matrix[1][0];
        const r11 = matrix[1][1];
        const dxf = payload.dx_front;
        const dyf = payload.dy_front;
        const dxb = payload.dx_back;
        const dyb = payload.dy_back;
        const src = back.data;
        const bw = back.width;
        const bh = back.height;
        const chunk = 32;
        for (let y0 = 0; y0 < height; y0 += chunk) {
            const y1 = Math.min(height, y0 + chunk);
            for (let y = y0; y < y1; y++) {
                const fy = y * dyf;
                const row = y * width;
                const sy0 = r10 * (fy - t1);
                const sy1 = r11 * (fy - t1);
                for (let x = 0; x < width; x++) {
                    const fx = x * dxf;
                    const bx = (r00 * (fx - t0) + sy0) / dxb;
                    const by = (r01 * (fx - t0) + sy1) / dyb;
                    const c = Math.round(bx);
                    const r = Math.round(by);
                    if (c < 0 || r < 0 || c >= bw || r >= bh) continue;
                    const value = src[r * bw + c];
                    if (Number.isFinite(value)) data[row + x] = value;
                }
            }
            if (onProgress) onProgress(y1 / height);
            await yieldFrame();
        }
        return { header: back.header, data, width, height, name: back.name };
    }

    async function paintSum(front, pairs, onProgress) {
        const data = new Float32Array(front.data.length);
        data.fill(NaN);
        const width = front.width;
        const height = front.height;
        const src = front.data;
        for (let i = 0; i < pairs.length; i++) {
            const col = Math.round(pairs[i][0]);
            const row = Math.round(pairs[i][1]);
            const sum = pairs[i][4];
            const pixels = floodDisk(src, width, height, col, row);
            for (let k = 0; k < pixels.length; k++) data[pixels[k]] = sum;
            if (i % 80 === 0) {
                if (onProgress) onProgress(pairs.length ? i / pairs.length : 1);
                await yieldFrame();
            }
        }
        return { header: front.header, data, width, height, name: t('overlaySum') };
    }

    function floodDisk(src, width, height, col, row) {
        let c = col;
        let r = row;
        const finiteAt = (rr, cc) => rr >= 0 && cc >= 0 && rr < height && cc < width && Number.isFinite(src[rr * width + cc]);
        if (!finiteAt(r, c)) {
            let found = false;
            for (let radius = 1; radius <= 6 && !found; radius++) {
                for (let dy = -radius; dy <= radius && !found; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        if (finiteAt(r + dy, c + dx)) {
                            r += dy;
                            c += dx;
                            found = true;
                            break;
                        }
                    }
                }
            }
            if (!found) return [];
        }
        const seen = new Set();
        const stack = [r * width + c];
        seen.add(stack[0]);
        const out = [];
        while (stack.length) {
            const index = stack.pop();
            out.push(index);
            const rr = (index / width) | 0;
            const cc = index - rr * width;
            const neighbors = [[0, -1], [0, 1], [-1, 0], [1, 0]];
            for (let i = 0; i < neighbors.length; i++) {
                const nr = rr + neighbors[i][0];
                const nc = cc + neighbors[i][1];
                if (!finiteAt(nr, nc)) continue;
                const n = nr * width + nc;
                if (seen.has(n)) continue;
                seen.add(n);
                stack.push(n);
            }
        }
        return out;
    }

    function yieldFrame() {
        return new Promise((resolve) => { requestAnimationFrame(() => resolve()); });
    }

    function resize() {
        if (state.step === 1) {
            const saved = Number(getUserPref('dotScale'));
            if (Number.isFinite(saved)) {
                const scale = clamp(saved, 0.4, 4);
                if (Math.abs(scale - state.dotScale) > 0.001) {
                    state.dotScale = scale;
                    if (state.result) state.result.markerIndex = {};
                    syncDotSize();
                }
            }
        }
        requestMaps();
    }

    function repaint() {
        const visible = visiblePanes().some((pane) => pane && pane.stageEl && pane.stageEl.clientWidth >= 2);
        if (!visible) return;
        requestMaps();
    }

    function onLanguage() {
        Object.values(loadPanes).concat(Object.values(resultPanes)).forEach((pane) => {
            if (!pane) return;
            syncPaneTitle(pane);
            pane.mirrorBtn.textContent = pane.mirror ? t('overlayMirrorOn') : t('overlayMirror');
            pane.collapseBtn.textContent = pane.collapsed ? t('overlayExpand') : t('overlayCollapse');
            syncPaneFileActions(pane);
            if (!displayed(pane)) {
                pane.placeholder.textContent = pane.key === 'back' ? t('overlayDropBack') : pane.key === 'front' ? t('overlayDropFront') : '';
            }
            pane.toolbar.querySelectorAll('button[data-tool]').forEach((button) => {
                const key = { pan: 'cursorPanTitle', inspect: 'cursorInspectTitle', measure: 'cursorMeasureTitle', step: 'stepHeightTitle', clear: 'measureClearTitle' }[button.dataset.tool];
                if (key) {
                    button.title = t(key);
                    button.setAttribute('aria-label', t(key));
                }
            });
        });
        if (state.result) renderStats(state.result.payload);
        refreshStart();
        requestMaps();
    }

    function folderIcon() {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 19a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1"/><path d="M5 19h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2H9l-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2z"/></svg>';
    }
    function trashIcon() {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a1 1 0 0 0 1 .9h8a1 1 0 0 0 1-.9L18 7"/><path d="M10 11v5"/><path d="M14 11v5"/></svg>';
    }
    function panIcon() {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 11V7.5a2 2 0 1 1 4 0V11"/><path d="M11 11V6.5a2 2 0 1 1 4 0V11"/><path d="M15 11V8a2 2 0 1 1 4 0v5a6 6 0 0 1-6 6h-2a6 6 0 0 1-6-6v-2"/></svg>';
    }
    function inspectIcon() {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><circle cx="12" cy="12" r="2.5"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg>';
    }
    function measureIcon() {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8.5" width="18" height="8" rx="1.25"/><path d="M7 8.5v2.6M10.5 8.5v4M14 8.5v2.6M17.5 8.5v4"/></svg>';
    }
    function stepIcon() {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18h18"/><path d="M4 16 8 11 12 14 16 7 20 10"/><path d="M12 4v14" stroke-dasharray="2.5 2.5"/></svg>';
    }
    function clearIcon() {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    }

    return { bind, resize, repaint, onLanguage };
})();
