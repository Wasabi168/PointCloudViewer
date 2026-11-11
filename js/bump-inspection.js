/**
 * Bump 分析／分析子頁：五步檢測流程（移植自 BumpCop inspection-ui.js）
 * 依賴：i18n.js, prefs.js, colormap.js, viewer-ui.js(showToast), bump-engine.js
 * 匯出（全域）：BumpInspection
 * 所有 DOM id 皆加上 bc 前綴；i18n 鍵加 bc. 前綴；偏好鍵加 bc 前綴。
 */
const BumpInspection = (() => {
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

    const STEPS = ['load', 'denoise', 'bump', 'donut', 'result'];
    const HIST_BINS = 128;

    const el = {
        viewer: document.getElementById('bcViewer'),
        imageMenu: document.getElementById('bcImageMenu'),
        placeholder: document.getElementById('bcPlaceholder'),
        dropVeil: document.getElementById('bcDropVeil'),
        dropText: document.getElementById('bcDropText'),
        stageSingle: document.getElementById('bcStageSingle'),
        stageCompare: document.getElementById('bcStageCompare'),
        canvas: document.getElementById('bcCanvas'),
        canvasBump: document.getElementById('bcCanvasBump'),
        canvasBase: document.getElementById('bcCanvasBase'),
        minimap: document.getElementById('bcMinimap'),
        minimapCanvas: document.getElementById('bcMinimapCanvas'),
        minimapFold: document.getElementById('bcMinimapFold'),
        layerPanel: document.getElementById('bcLayerPanel'),
        layerFold: document.getElementById('bcLayerFold'),
        layerBump: document.getElementById('bcLayerBump'),
        layerDonut: document.getElementById('bcLayerDonut'),
        layerDenoise: document.getElementById('bcLayerDenoise'),
        layerRejected: document.getElementById('bcLayerRejected'),
        residualToggle: document.getElementById('bcResidualToggle'),
        showResiduals: document.getElementById('bcShowResiduals'),
        heightExtremeToggle: document.getElementById('bcHeightExtremeToggle'),
        showHeightExtremes: document.getElementById('bcShowHeightExtremes'),
        layerRawExtreme: document.getElementById('bcLayerRawExtreme'),
        showRawExtremes: document.getElementById('bcShowRawExtremes'),
        histPanel: document.getElementById('bcHistPanel'),
        histWrap: document.getElementById('bcHistWrap'),
        histCanvas: document.getElementById('bcHistCanvas'),
        histLo: document.getElementById('bcHistLo'),
        histHi: document.getElementById('bcHistHi'),
        histValLo: document.getElementById('bcHistValLo'),
        histValHi: document.getElementById('bcHistValHi'),
        histStats: document.getElementById('bcHistStats'),
        histMin: document.getElementById('bcHistMin'),
        histMax: document.getElementById('bcHistMax'),
        histTip: document.getElementById('bcHistTip'),
        rawHistPanel: document.getElementById('bcRawHistPanel'),
        rawHistFold: document.getElementById('bcRawHistFold'),
        rawHistWrap: document.getElementById('bcRawHistWrap'),
        rawHistCanvas: document.getElementById('bcRawHistCanvas'),
        rawHistLo: document.getElementById('bcRawHistLo'),
        rawHistHi: document.getElementById('bcRawHistHi'),
        rawHistValLo: document.getElementById('bcRawHistValLo'),
        rawHistValHi: document.getElementById('bcRawHistValHi'),
        rawHistStats: document.getElementById('bcRawHistStats'),
        rawHistMin: document.getElementById('bcRawHistMin'),
        rawHistMax: document.getElementById('bcRawHistMax'),
        rawHistTip: document.getElementById('bcRawHistTip'),
        bumpDetailToggle: document.getElementById('bcBumpDetailToggle'),
        showBumpDetail: document.getElementById('bcShowBumpDetail'),
        bumpDetailPanel: document.getElementById('bcBumpDetailPanel'),
        bumpDetailFold: document.getElementById('bcBumpDetailFold'),
        bumpDetailStats: document.getElementById('bcBumpDetailStats'),
        bumpDetailEmpty: document.getElementById('bcBumpDetailEmpty'),
        bumpDetailContent: document.getElementById('bcBumpDetailContent'),
        bumpDetailApexValue: document.getElementById('bcBumpDetailApexValue'),
        bumpDetailBaseValue: document.getElementById('bcBumpDetailBaseValue'),
        bumpDetailMedianValue: document.getElementById('bcBumpDetailMedianValue'),
        bumpDetailZTitle: document.getElementById('bcBumpDetailZTitle'),
        bumpDetailZ: document.getElementById('bcBumpDetailZ'),
        bumpDetailDonutTitle: document.getElementById('bcBumpDetailDonutTitle'),
        bumpDetailDonut: document.getElementById('bcBumpDetailDonut'),
        layerRawFiltered: document.getElementById('bcLayerRawFiltered'),
        showRawFiltered: document.getElementById('bcShowRawFiltered'),
        fileLabel: document.getElementById('bcFileLabel'),
        stepper: document.getElementById('bcStepper'),
        btnPrev: document.getElementById('bcBtnPrev'),
        btnNext: document.getElementById('bcBtnNext'),
        btnIdentify: document.getElementById('bcBtnIdentify'),
        lengthMin: document.getElementById('bcLengthMin'),
        lengthMax: document.getElementById('bcLengthMax'),
        widthMin: document.getElementById('bcWidthMin'),
        widthMax: document.getElementById('bcWidthMax'),
        isolationPx: document.getElementById('bcIsolationPx'),
        noiseMax: document.getElementById('bcNoiseMax'),
        donutWidth: document.getElementById('bcDonutWidth'),
        outlier: document.getElementById('bcOutlier'),
        bumpCount: document.getElementById('bcBumpCount'),
        resultBox: document.getElementById('bcResultBox'),
        resultTableBar: document.getElementById('bcResultTableBar'),
        btnExportCsv: document.getElementById('bcBtnExportCsv'),
        resultHead: document.getElementById('bcResultHead'),
        resultScroll: document.getElementById('bcResultScroll'),
        resultTable: document.getElementById('bcResultTable'),
        resultFocusHint: document.getElementById('bcResultFocusHint'),
        sidePanels: document.querySelectorAll('[data-side]'),
        viewerTools: document.getElementById('bcViewerTools'),
        btnPan: document.getElementById('bcBtnPan'),
        btnInspect: document.getElementById('bcBtnInspect'),
        valueIndicator: document.getElementById('bcValueIndicator'),
        btnMeasure: document.getElementById('bcBtnMeasure'),
        btnMeasureClear: document.getElementById('bcBtnMeasureClear'),
        measurePanel: document.getElementById('bcMeasurePanel'),
        measureMeta: document.getElementById('bcMeasureMeta'),
        btnStep: document.getElementById('bcBtnStep'),
        btnFocusClear: document.getElementById('bcBtnFocusClear'),
        profileOverlay: document.getElementById('bcProfileOverlay'),
        profileOverlayBump: document.getElementById('bcProfileOverlayBump'),
        profileOverlayBase: document.getElementById('bcProfileOverlayBase'),
        profilePanel: document.getElementById('bcProfilePanel'),
        profileMeta: document.getElementById('bcProfileMeta'),
        profilePlot: document.getElementById('bcProfilePlot'),
        profileCanvas: document.getElementById('bcProfileCanvas'),
        profileTip: document.getElementById('bcProfileTip'),
        profileChartStyle: document.getElementById('bcProfileChartStyle'),
        profileMeasureBtn: document.getElementById('bcProfileMeasureBtn'),
        profileMeasureClearBtn: document.getElementById('bcProfileMeasureClearBtn'),
        btnPeek: document.getElementById('bcBtnPeek'),
        peekBadge: document.getElementById('bcPeekBadge'),
        loadProgress: document.getElementById('bcLoadProgress'),
        loadProgressBar: document.getElementById('bcLoadProgressBar'),
        loadProgressLabel: document.getElementById('bcLoadProgressLabel'),
        loadProgressSpinner: document.getElementById('bcLoadProgressSpinner'),
        loadProgressText: document.getElementById('bcLoadProgressText'),
        resultViewTabs: document.getElementById('bcResultViewTabs'),
        dotSizeField: document.getElementById('bcDotSizeField'),
        dotSize: document.getElementById('bcDotSize'),
        dotSizeValue: document.getElementById('bcDotSizeValue'),
        colorbarTitle: document.getElementById('bcColorbarTitle'),
        colormap: document.getElementById('bcColormap'),
        colorbarBar: document.getElementById('bcColorbarBar'),
        colorbarCanvas: document.getElementById('bcColorbarCanvas'),
        colorbarTrack: document.getElementById('bcColorbarTrack'),
        cbHandleLo: document.getElementById('bcCbHandleLo'),
        cbHandleHi: document.getElementById('bcCbHandleHi'),
        cbValLo: document.getElementById('bcCbValLo'),
        cbValHi: document.getElementById('bcCbValHi'),
        cbFitView: document.getElementById('bcCbFitView'),
        cbReset: document.getElementById('bcCbReset'),
        zMin: document.getElementById('bcZMin'),
        zMax: document.getElementById('bcZMax'),
    };

    const state = {
        dataset: null,
        sessionId: null,
        vmin: 0,
        vmax: 1,
        colormap: 'jet',
        colorClips: freshClips(),
        colorSpans: freshColorSpans(),
        histLo: 0,
        histHi: 1,
        step: 0,
        maxStep: 0,
        centers: [],
        bumpMask: null,
        donutMask: null,
        donutMaskWidth: 0,
        result: null,
        resultView: 'map',
        resultSerial: 0,
        scatterDotScale: 1,
        scatterColor: freshScatterColor(),
        bumpKey: '',
        busy: false,
        view: { scale: 1, col: 0, row: 0 },
        dragDepth: 0,
        panning: null,
        tool: 'pan',
        measure: { drawing: false, line: null, editStart: null, hover: null, hoverCanvas: null },
        measuring: null,
        peekOriginal: false,
        showResiduals: false,
        showHeightExtremes: false,
        showRawExtremes: false,
        showRawFiltered: false,
        showDonutExtremes: false,
        showDonutFiltered: false,
        showBumpDetail: false,
        bumpDetailCollapsed: false,
        rawHistLo: 0,
        rawHistHi: 1,
        donutHistLo: 0,
        donutHistHi: 1,
        rawHistCollapsed: false,
        layers: { bump: true, donut: false, denoise: false, rejected: false },
        layerCollapsed: false,
        minimapCollapsed: false,
        resultSort: { key: 'colIndex', dir: 1 },
        selectedBump: -1,
        hoverBump: -1,
        bumpPick: null,
        profiling: null,
        profile: {
            drawing: false,
            pane: 'main',
            editStart: null,
            line: null,
            data: null,
            geom: null,
            hoverIndex: null,
            measureMode: false,
            measureSets: [],
            measurePts: [],
            measureDrag: null,
            lineHover: null,
            lineHoverCanvas: null,
            hoverMeasure: null,
        },
    };

    const RESULT_ROW_HEIGHT = 28;
    const resultView = {
        order: [],
        columns: null,
        result: null,
        start: -1,
        end: -1,
        resetScrollTop: false,
        scrollRaf: 0,
        restoreRaf: 0,
        sideScrollHold: null,
    };

    const STEP_HIT_RADIUS = 10;
    const STEP_CHART_PICK = 22;
    const STEP_MAX_SETS = 5;
    const STEP_STYLES = [
        { colors: ['#ff6b6b', '#51cf66'], dist: '#ffd24a', step: '#ff7b72', fill: 'rgba(255,210,74,0.12)' },
        { colors: ['#74c0fc', '#b197fc'], dist: '#66d9e8', step: '#da77f2', fill: 'rgba(102,217,232,0.12)' },
        { colors: ['#ffa94d', '#69db7c'], dist: '#ffc078', step: '#ff8787', fill: 'rgba(255,169,77,0.12)' },
        { colors: ['#ff8787', '#63e6be'], dist: '#ffe066', step: '#f783ac', fill: 'rgba(255,224,102,0.12)' },
        { colors: ['#a9e34b', '#4dabf7'], dist: '#c0eb75', step: '#748ffc', fill: 'rgba(169,227,75,0.12)' },
    ];
    let stepMeasureSuppressClick = false;
    let profileMeasureLayouts = [];
    const MEASURE_DELETE_SIZE = 12;
    let histCache = null;
    let profileChartStyle = 'line';

    function clamp(value, lo, hi) {
        return Math.max(lo, Math.min(hi, value));
    }

    function finiteRange(data) {
        let vmin = Infinity;
        let vmax = -Infinity;
        let count = 0;
        for (let i = 0; i < data.length; i++) {
            const value = data[i];
            if (!Number.isFinite(value)) continue;
            if (value < vmin) vmin = value;
            if (value > vmax) vmax = value;
            count++;
        }
        if (!count) return { vmin: 0, vmax: 1, count: 0 };
        if (vmin === vmax) vmax = vmin + 1;
        return { vmin, vmax, count };
    }

    function rangeAbs() {
        const span = state.vmax - state.vmin;
        return {
            z_lo: state.vmin + state.histLo * span,
            z_hi: state.vmin + state.histHi * span,
        };
    }

    function spacing(dataset) {
        const header = dataset.header || {};
        const xl = Number(header.xlength ?? header['x-length']);
        const yl = Number(header.ylength ?? header['y-length']);
        const xlen = Number.isFinite(xl) && xl > 0 ? xl : dataset.width;
        const ylen = Number.isFinite(yl) && yl > 0 ? yl : dataset.height;
        const zunit = String(header.zunit ?? header['z-unit'] ?? '').replace(/[\[\]]/g, '');
        return {
            dx: xlen / Math.max(1, dataset.width - 1),
            dy: ylen / Math.max(1, dataset.height - 1),
            zunit,
        };
    }

    function freshClips() {
        return STEPS.map(() => ({ lo: 0, hi: 1 }));
    }

    function freshColorSpans() {
        return STEPS.map(() => null);
    }

    function freshScatterColor() {
        return {
            h: { clip: { lo: 0, hi: 1 }, span: null },
            raw: { clip: { lo: 0, hi: 1 }, span: null },
            donut: { clip: { lo: 0, hi: 1 }, span: null },
        };
    }

    function resetScatterColor() {
        state.scatterColor = freshScatterColor();
        scatterRangeCache = null;
        bumpGrid = null;
        rawExtentCache = null;
        rawHistCache = null;
        state.rawHistLo = 0;
        state.rawHistHi = 1;
        state.donutHistLo = 0;
        state.donutHistHi = 1;
    }

    function clearComputedResult() {
        state.result = null;
        if (state.resultView !== 'map') state.resultView = 'map';
    }

    function isScatterView() {
        return state.step === 4 && (state.resultView === 'h' || state.resultView === 'raw' || state.resultView === 'donut');
    }

    function isFilteredScatter() {
        return state.resultView === 'raw' || state.resultView === 'donut';
    }

    function seriesViewSpec() {
        if (state.resultView === 'donut') {
            return {
                seriesKey: 'donut_median',
                lo: 'donutHistLo',
                hi: 'donutHistHi',
                extremes: 'showDonutExtremes',
                filtered: 'showDonutFiltered',
                inspect: 'inspectDonut',
                colorbar: 'colorbarDonut',
                histTitle: 'donutHistTitle',
                histAxis: 'donutHistAxis',
                fold: 'foldDonutHist',
                expand: 'expandDonutHist',
                extremeToggle: 'donutExtremeToggle',
                extremeHigh: 'donutExtremeHigh',
                extremeLow: 'donutExtremeLow',
                export: '_donutmedian',
            };
        }
        return {
            seriesKey: 'raw_step',
            lo: 'rawHistLo',
            hi: 'rawHistHi',
            extremes: 'showRawExtremes',
            filtered: 'showRawFiltered',
            inspect: 'inspectRaw',
            colorbar: 'colorbarRaw',
            histTitle: 'rawHistTitle',
            histAxis: 'rawHistAxis',
            fold: 'foldRawHist',
            expand: 'expandRawHist',
            extremeToggle: 'rawExtremeToggle',
            extremeHigh: 'rawExtremeHigh',
            extremeLow: 'rawExtremeLow',
            export: '_rawstep',
        };
    }

    function scatterSeries() {
        const result = state.result;
        if (!result) return null;
        if (state.resultView === 'h') return result.true_heights;
        if (isFilteredScatter()) return result[seriesViewSpec().seriesKey];
        return null;
    }

    function scatterValue(index) {
        return seriesNumber(scatterSeries(), index);
    }

    function scatterDotScale() {
        const value = Number(state.scatterDotScale);
        if (!Number.isFinite(value)) return 1;
        return clamp(value, 0.4, 4);
    }

    function scatterImageRadius() {
        const size = contourRange();
        const bumpPx = Math.max(size.lengthMax, size.widthMax, 4);
        return Math.max(1.5, bumpPx * 0.42) * scatterDotScale();
    }

    function scatterScreenRadius() {
        const user = scatterDotScale();
        return Math.max(2.5 * user, Math.min(42 * user, scatterImageRadius() * state.view.scale));
    }

    let scatterRangeCache = null;
    let bumpGrid = null;
    let rawExtentCache = null;
    let rawHistCache = null;
    let bumpDetailRenderKey = '';
    const bumpDetailSort = {
        bump: { key: '', dir: 1 },
        donut: { key: '', dir: 1 },
    };
    function resetBumpDetailSort() {
        bumpDetailSort.bump.key = '';
        bumpDetailSort.bump.dir = 1;
        bumpDetailSort.donut.key = '';
        bumpDetailSort.donut.dir = 1;
    }

    function rawExtent() {
        const key = state.resultSerial + ':' + state.resultView;
        if (rawExtentCache && rawExtentCache.key === key) return rawExtentCache;
        const series = isFilteredScatter() ? scatterSeries() : null;
        let min = Infinity;
        let max = -Infinity;
        let count = 0;
        if (series) {
            for (let i = 0; i < series.length; i++) {
                const value = seriesNumber(series, i);
                if (!Number.isFinite(value)) continue;
                if (value < min) min = value;
                if (value > max) max = value;
                count++;
            }
        }
        if (!count) {
            min = 0;
            max = 1;
        }
        rawExtentCache = { key, min, max, count };
        return rawExtentCache;
    }

    function rawFilterAbs() {
        const extent = rawExtent();
        const span = extent.max - extent.min;
        const spec = seriesViewSpec();
        const lo = state[spec.lo];
        const hi = state[spec.hi];
        if (!(span > 0)) return { lo: extent.min, hi: extent.max };
        return {
            lo: extent.min + lo * span,
            hi: extent.min + hi * span,
        };
    }

    function rawValueInside(value) {
        if (!Number.isFinite(value)) return false;
        const bounds = rawFilterAbs();
        return value >= bounds.lo && value <= bounds.hi;
    }

    function scatterDotShown(index) {
        const value = scatterValue(index);
        if (!Number.isFinite(value)) return false;
        if (!isFilteredScatter()) return true;
        return rawValueInside(value) || state[seriesViewSpec().filtered];
    }

    function rawHistCounts() {
        const key = state.resultSerial + ':' + state.resultView;
        if (rawHistCache && rawHistCache.key === key) return rawHistCache;
        const counts = new Float64Array(HIST_BINS);
        const extent = rawExtent();
        const span = extent.max - extent.min;
        const series = isFilteredScatter() ? scatterSeries() : null;
        let total = 0;
        if (series) {
            for (let i = 0; i < series.length; i++) {
                const value = seriesNumber(series, i);
                if (!Number.isFinite(value)) continue;
                total++;
                let frac = span > 0 ? (value - extent.min) / span : 0;
                if (frac < 0) frac = 0;
                else if (frac >= 1) frac = 0.999999;
                counts[(frac * HIST_BINS) | 0]++;
            }
        }
        let maxCount = 1;
        for (let i = 0; i < HIST_BINS; i++) if (counts[i] > maxCount) maxCount = counts[i];
        rawHistCache = { key, counts, total, maxCount };
        return rawHistCache;
    }

    function scatterDisplayRange() {
        const slot = state.scatterColor[state.resultView];
        if (slot && slot.span && slot.span.max > slot.span.min) return slot.span;
        const key = state.resultSerial + ':' + state.resultView;
        if (scatterRangeCache && scatterRangeCache.key === key) return scatterRangeCache.range;
        const range = finiteRange(scatterSeries() || []);
        const bounds = { min: range.vmin, max: range.vmax };
        scatterRangeCache = { key, range: bounds };
        return bounds;
    }

    function ensureBumpGrid() {
        const size = contourRange();
        const key = [state.centers.length, state.bumpKey, state.resultSerial, size.lengthMax, size.widthMax, scatterDotScale()].join('|');
        if (bumpGrid && bumpGrid.key === key) return bumpGrid;
        const cell = Math.max(4, scatterImageRadius() * 2);
        const buckets = new Map();
        state.centers.forEach((point, index) => {
            const id = Math.floor(point.col / cell) + ',' + Math.floor(point.row / cell);
            let list = buckets.get(id);
            if (!list) {
                list = [];
                buckets.set(id, list);
            }
            list.push(index);
        });
        bumpGrid = { key, cell, buckets };
        return bumpGrid;
    }

    function scatterValueNear(row, col) {
        if (!state.centers.length) return NaN;
        const grid = ensureBumpGrid();
        const radius = scatterImageRadius();
        const gx = Math.floor(col / grid.cell);
        const gy = Math.floor(row / grid.cell);
        let best = -1;
        let bestDist = radius;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const list = grid.buckets.get((gx + dx) + ',' + (gy + dy));
                if (!list) continue;
                for (let i = 0; i < list.length; i++) {
                    const index = list[i];
                    if (!scatterDotShown(index)) continue;
                    const point = state.centers[index];
                    const dist = Math.hypot(point.col - col, point.row - row);
                    if (dist <= bestDist) {
                        bestDist = dist;
                        best = index;
                    }
                }
            }
        }
        return best < 0 ? NaN : scatterValue(best);
    }

    function setActiveColorSpan(range) {
        if (isScatterView()) {
            state.scatterColor[state.resultView].span = range;
            scatterRangeCache = null;
            return;
        }
        state.colorSpans[state.step] = range;
    }

    function setResultView(view) {
        if (view !== 'map' && view !== 'h' && view !== 'raw' && view !== 'donut') return;
        if (view !== 'map' && !state.result) return;
        if (state.resultView === view) return;
        state.resultView = view;
        if (state.profile.line) profileRecompute(false);
        update();
    }

    function resetColorClips() {
        state.colorClips = freshClips();
        state.colorSpans = freshColorSpans();
    }

    function colorBounds() {
        if (isScatterView()) return scatterDisplayRange();
        const custom = state.colorSpans[state.step];
        if (custom && custom.max > custom.min) return custom;
        return { min: state.vmin, max: state.vmax };
    }

    function currentClip() {
        if (isScatterView()) return state.scatterColor[state.resultView].clip;
        return state.colorClips[state.step] || state.colorClips[0];
    }

    let colorLut = null;
    let colorLutName = '';

    function ensureColorLut() {
        const name = state.colormap || 'jet';
        if (!colorLut || colorLutName !== name) {
            colorLut = buildColormapLut(name);
            colorLutName = name;
        }
        return colorLut;
    }

    function colorRgb(value) {
        const clip = currentClip();
        const bounds = colorBounds();
        const span = (bounds.max - bounds.min) || 1;
        const cmin = bounds.min + clip.lo * span;
        const crange = Math.max((clip.hi - clip.lo) * span, 1e-12);
        let t = (value - cmin) / crange;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        const index = Math.min(255, (t * 255) | 0) * 3;
        const lut = ensureColorLut();
        return [lut[index], lut[index + 1], lut[index + 2]];
    }

    function formatColorValue(value) {
        if (!Number.isFinite(value)) return '-';
        return value.toFixed(3);
    }

    function setDataset(dataset, sessionId) {
        state.dataset = dataset;
        state.sessionId = sessionId;
        const range = finiteRange(dataset.data);
        state.vmin = range.vmin;
        state.vmax = range.vmax;
        histCache = null;
        resetColorClips();
        state.histLo = 0;
        state.histHi = 1;
        state.centers = [];
        state.bumpMask = null;
        state.donutMask = null;
        state.resultView = 'map';
        state.resultSerial += 1;
        clearComputedResult();
        resetScatterColor();
        state.bumpKey = '';
        state.step = 0;
        state.maxStep = 0;
        state.peekOriginal = false;
        state.showResiduals = false;
        state.showHeightExtremes = false;
        state.showRawExtremes = false;
        state.showRawFiltered = false;
        state.showDonutExtremes = false;
        state.showDonutFiltered = false;
        state.showBumpDetail = false;
        state.bumpDetailCollapsed = false;
        bumpDetailRenderKey = '';
        resetBumpDetailSort();
        resetLayers();
        resetResultSort();
        clearMeasure(false);
        clearProfile(false);
        el.fileLabel.textContent = dataset.name || '';
        fitView();
        update();
    }

    function fitView() {
        const dataset = state.dataset;
        const wrap = el.viewer;
        if (!dataset || !wrap) return;
        const w = Math.max(wrap.clientWidth, 320);
        const h = Math.max(wrap.clientHeight, 240);
        const viewW = state.step === 3 ? w / 2 : w;
        state.view.scale = Math.min(viewW / dataset.width, h / dataset.height) * 0.9;
        state.view.col = (dataset.width - 1) / 2;
        state.view.row = (dataset.height - 1) / 2;
    }

    function screenToImage(sx, sy, width, height) {
        return {
            col: (sx - width / 2) / state.view.scale + state.view.col,
            row: (sy - height / 2) / state.view.scale + state.view.row,
        };
    }

    function sampleAt(row, col) {
        const dataset = state.dataset;
        const r = row | 0;
        const c = col | 0;
        if (!dataset || r < 0 || c < 0 || r >= dataset.height || c >= dataset.width) return NaN;
        return dataset.data[r * dataset.width + c];
    }

    function maskFromRuns(runs) {
        const dataset = state.dataset;
        const mask = new Uint8Array(dataset.width * dataset.height);
        for (const run of runs) {
            const base = run[0] * dataset.width;
            for (let col = run[1]; col <= run[2]; col++) mask[base + col] = 1;
        }
        return mask;
    }

    function ensureDonutMask() {
        const widthPx = Number(el.donutWidth.value);
        if (state.donutMask && state.donutMaskWidth === widthPx) return;
        const src = state.bumpMask;
        const dataset = state.dataset;
        if (!src || !dataset || !(widthPx > 0)) {
            state.donutMask = null;
            return;
        }
        const w = dataset.width;
        const h = dataset.height;
        const out = new Uint8Array(src.length);
        const reach = Math.ceil(widthPx);
        const limit = widthPx * widthPx + 1e-9;
        for (let index = 0; index < src.length; index++) {
            if (!src[index]) continue;
            const row = (index / w) | 0;
            const col = index - row * w;
            const r0 = Math.max(0, row - reach);
            const r1 = Math.min(h - 1, row + reach);
            const c0 = Math.max(0, col - reach);
            const c1 = Math.min(w - 1, col + reach);
            for (let rr = r0; rr <= r1; rr++) {
                const dy = rr - row;
                const dy2 = dy * dy;
                const base = rr * w;
                for (let cc = c0; cc <= c1; cc++) {
                    const dx = cc - col;
                    if (dy2 + dx * dx <= limit) out[base + cc] = 1;
                }
            }
        }
        for (let index = 0; index < src.length; index++) {
            if (src[index]) out[index] = 0;
        }
        state.donutMask = out;
        state.donutMaskWidth = widthPx;
    }

    const BUMP_NEIGHBORS = [
        [-1, -1], [-1, 0], [-1, 1],
        [0, -1], [0, 1],
        [1, -1], [1, 0], [1, 1],
    ];

    function collectBumpPixels(row, col) {
        const dataset = state.dataset;
        const mask = state.bumpMask;
        if (!dataset || !mask) return [];
        const w = dataset.width;
        const h = dataset.height;
        const startRow = Math.round(row);
        const startCol = Math.round(col);
        if (startRow < 0 || startCol < 0 || startRow >= h || startCol >= w) return [];
        const start = startRow * w + startCol;
        if (!mask[start]) return [];
        const seen = new Set([start]);
        const stack = [start];
        const pixels = [];
        while (stack.length) {
            const index = stack.pop();
            const r = (index / w) | 0;
            const c = index - r * w;
            const z = dataset.data[index];
            pixels.push({ r, c, z: Number.isFinite(z) ? z : NaN });
            for (let i = 0; i < BUMP_NEIGHBORS.length; i++) {
                const nr = r + BUMP_NEIGHBORS[i][0];
                const nc = c + BUMP_NEIGHBORS[i][1];
                if (nr < 0 || nc < 0 || nr >= h || nc >= w) continue;
                const next = nr * w + nc;
                if (!mask[next] || seen.has(next)) continue;
                seen.add(next);
                stack.push(next);
            }
        }
        pixels.sort((a, b) => a.r - b.r || a.c - b.c);
        return pixels;
    }

    function collectDonutPixels(bumpPixels, widthPx) {
        const dataset = state.dataset;
        const mask = state.bumpMask;
        if (!dataset || !mask || !(widthPx > 0) || !bumpPixels.length) return [];
        const w = dataset.width;
        const h = dataset.height;
        const reach = Math.ceil(widthPx - 1e-12);
        const limit = widthPx * widthPx + 1e-9;
        const ring = new Set();
        for (let i = 0; i < bumpPixels.length; i++) {
            const pixel = bumpPixels[i];
            const r0 = Math.max(0, pixel.r - reach);
            const r1 = Math.min(h - 1, pixel.r + reach);
            const c0 = Math.max(0, pixel.c - reach);
            const c1 = Math.min(w - 1, pixel.c + reach);
            for (let rr = r0; rr <= r1; rr++) {
                const dy = rr - pixel.r;
                const dy2 = dy * dy;
                const base = rr * w;
                for (let cc = c0; cc <= c1; cc++) {
                    const dx = cc - pixel.c;
                    if (dy2 + dx * dx > limit) continue;
                    const index = base + cc;
                    if (mask[index]) continue;
                    ring.add(index);
                }
            }
        }
        const pixels = [];
        ring.forEach((index) => {
            const z = dataset.data[index];
            if (!Number.isFinite(z)) return;
            const r = (index / w) | 0;
            pixels.push({ r, c: index - r * w, z });
        });
        pixels.sort((a, b) => a.r - b.r || a.c - b.c);
        return pixels;
    }

    function medianOf(values) {
        const sorted = [];
        for (let i = 0; i < values.length; i++) {
            if (Number.isFinite(values[i])) sorted.push(values[i]);
        }
        if (!sorted.length) return NaN;
        sorted.sort((a, b) => a - b);
        const mid = sorted.length >> 1;
        if (sorted.length & 1) return sorted[mid];
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }

    function maskAt(mask, row, col) {
        const dataset = state.dataset;
        const r = row | 0;
        const c = col | 0;
        if (!mask || !dataset || r < 0 || c < 0 || r >= dataset.height || c >= dataset.width) return false;
        return mask[r * dataset.width + c] === 1;
    }

    function sampleFor(mode, row, col) {
        const value = sampleAt(row, col);
        if (!Number.isFinite(value)) return NaN;
        const abs = rangeAbs();
        const denoised = value >= abs.z_lo && value <= abs.z_hi ? value : NaN;
        if (mode === 'original') return value;
        if (mode === 'denoised') return denoised;
        if (mode === 'pure') return maskAt(state.bumpMask, row, col) ? denoised : NaN;
        if (mode === 'base') return maskAt(state.donutMask, row, col) ? value : NaN;
        if (mode === 'result') return sampleResult(value, Number.isFinite(denoised), row, col);
        if (mode === 'scatter') return scatterValueNear(row, col);
        return value;
    }

    function sampleResult(value, kept, row, col) {
        const bump = kept && maskAt(state.bumpMask, row, col);
        if (state.layers.bump && bump) return value;
        if (state.layers.donut && maskAt(state.donutMask, row, col)) return value;
        if (state.layers.denoise && !kept) return value;
        if (state.layers.rejected && kept && !bump) return value;
        return NaN;
    }

    function resetLayers() {
        state.layers.bump = true;
        state.layers.donut = false;
        state.layers.denoise = false;
        state.layers.rejected = false;
    }

    function drawCanvas(canvas, mode) {
        const wrap = canvas.parentElement;
        const width = Math.max(1, wrap.clientWidth);
        const height = Math.max(1, wrap.clientHeight);
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        const ctx = canvas.getContext('2d', { alpha: false });
        const image = ctx.createImageData(width, height);
        const pixels = image.data;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const point = screenToImage(x + 0.5, y + 0.5, width, height);
                const value = sampleFor(mode, point.row, point.col);
                const offset = (y * width + x) * 4;
                if (!Number.isFinite(value)) {
                    paintMissingPixel(pixels, offset);
                } else {
                    const rgb = colorRgb(value);
                    pixels[offset] = rgb[0];
                    pixels[offset + 1] = rgb[1];
                    pixels[offset + 2] = rgb[2];
                    pixels[offset + 3] = 255;
                }
            }
        }
        ctx.putImageData(image, 0, 0);
        drawMeasureOverlay(canvas);
        if (mode === 'result' && state.result && state.showResiduals) drawResiduals(ctx, width, height);
        if (mode === 'result' && state.result && state.showHeightExtremes) drawHeightExtremes(ctx, width, height);
        if (mode === 'result' && state.result) drawSelectedBump(ctx, width, height);
    }

    function drawScatterCanvas(canvas) {
        const wrap = canvas.parentElement;
        const width = Math.max(1, wrap.clientWidth);
        const height = Math.max(1, wrap.clientHeight);
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.fillStyle = '#1e1e28';
        ctx.fillRect(0, 0, width, height);
        const radius = scatterScreenRadius();
        const kept = [];
        const dropped = [];
        for (let index = 0; index < state.centers.length; index++) {
            const value = scatterValue(index);
            if (!Number.isFinite(value)) continue;
            if (isFilteredScatter() && !rawValueInside(value)) {
                if (state[seriesViewSpec().filtered]) dropped.push(index);
                continue;
            }
            kept.push(index);
        }
        const paintDots = (indices) => {
            for (let n = 0; n < indices.length; n++) {
                const index = indices[n];
                const screen = bumpScreenPoint(index, width, height);
                if (!screen) continue;
                if (screen.x < -radius || screen.y < -radius || screen.x > width + radius || screen.y > height + radius) continue;
                const rgb = colorRgb(scatterValue(index));
                ctx.fillStyle = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
                ctx.beginPath();
                ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
                ctx.fill();
            }
        };
        paintDots(dropped);
        paintDots(kept);
        drawMeasureOverlay(canvas);
        if (state.resultView === 'h' && state.result && state.showHeightExtremes) drawHeightExtremes(ctx, width, height);
        if (isFilteredScatter() && state.result && state[seriesViewSpec().extremes]) {
            const spec = seriesViewSpec();
            drawExtremeMarkers(ctx, width, height, rawExtremes(), spec.extremeHigh, spec.extremeLow);
        }
        if (state.result) drawSelectedBump(ctx, width, height);
    }

    function drawResiduals(ctx, width, height) {
        const residuals = state.result.residuals || [];
        let min = Infinity;
        let max = -Infinity;
        residuals.forEach((value) => {
            if (value < min) min = value;
            if (value > max) max = value;
        });
        const span = max - min || 1;
        state.centers.forEach((point, index) => {
            const sx = (point.col - state.view.col) * state.view.scale + width / 2;
            const sy = (point.row - state.view.row) * state.view.scale + height / 2;
            const t = ((residuals[index] ?? 0) - min) / span;
            ctx.beginPath();
            ctx.arc(sx, sy, Math.max(3, state.view.scale * 0.45), 0, Math.PI * 2);
            ctx.fillStyle = t > 0.5 ? '#ff5a7a' : '#7dffb3';
            ctx.fill();
        });
    }

    function drawSelectedBump(ctx, width, height) {
        const point = state.centers[state.selectedBump];
        if (!point) return;
        const sx = (point.col - state.view.col) * state.view.scale + width / 2;
        const sy = (point.row - state.view.row) * state.view.scale + height / 2;
        const radius = Math.max(10, state.view.scale * 1.35);
        ctx.save();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = '#4f8cff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, radius + 3.5, 0, Math.PI * 2);
        ctx.stroke();
        const arm = radius + 8;
        ctx.beginPath();
        ctx.moveTo(sx - arm, sy);
        ctx.lineTo(sx - radius - 2, sy);
        ctx.moveTo(sx + radius + 2, sy);
        ctx.lineTo(sx + arm, sy);
        ctx.moveTo(sx, sy - arm);
        ctx.lineTo(sx, sy - radius - 2);
        ctx.moveTo(sx, sy + radius + 2);
        ctx.lineTo(sx, sy + arm);
        ctx.stroke();
        ctx.restore();
    }

    function heightExtremes() {
        return seriesExtremes(state.result && state.result.true_heights);
    }

    function rawExtremes() {
        const series = isFilteredScatter() ? scatterSeries() : null;
        if (!series) return seriesExtremes(null);
        const values = [];
        for (let index = 0; index < series.length; index++) {
            const value = seriesNumber(series, index);
            values.push(rawValueInside(value) ? value : NaN);
        }
        return seriesExtremes(values);
    }

    function seriesExtremes(series) {
        const empty = { high: new Set(), low: new Set(), highValue: NaN, lowValue: NaN };
        if (!series) return empty;
        let highValue = -Infinity;
        let lowValue = Infinity;
        for (let index = 0; index < series.length; index++) {
            const value = Number(series[index]);
            if (!Number.isFinite(value)) continue;
            if (value > highValue) highValue = value;
            if (value < lowValue) lowValue = value;
        }
        if (highValue === -Infinity) return empty;
        const high = new Set();
        const low = new Set();
        for (let index = 0; index < series.length; index++) {
            const value = Number(series[index]);
            if (value === highValue) high.add(index);
            if (value === lowValue) low.add(index);
        }
        return { high, low, highValue, lowValue };
    }

    function activeExtremeMarks() {
        if (!state.result) return null;
        if (isFilteredScatter()) return state[seriesViewSpec().extremes] ? rawExtremes() : null;
        return state.showHeightExtremes ? heightExtremes() : null;
    }

    function drawHeightExtremes(ctx, width, height) {
        drawExtremeMarkers(ctx, width, height, heightExtremes(), 'heightExtremeHigh', 'heightExtremeLow');
    }

    function drawExtremeMarkers(ctx, width, height, extremes, highKey, lowKey) {
        const marked = new Set([...extremes.high, ...extremes.low]);
        marked.forEach((index) => {
            const kind = extremes.high.has(index) && extremes.low.has(index) ? 'both'
                : extremes.high.has(index) ? 'high' : 'low';
            drawHeightExtremeMarker(ctx, index, kind, extremes, width, height, highKey, lowKey);
        });
    }

    function drawHeightExtremeMarker(ctx, index, kind, extremes, width, height, highKey, lowKey) {
        const point = state.centers[index];
        if (!point) return;
        const sx = (point.col - state.view.col) * state.view.scale + width / 2;
        const sy = (point.row - state.view.row) * state.view.scale + height / 2;
        const color = kind === 'low' ? '#6cb6ff' : '#ffb020';
        const radius = isScatterView()
            ? scatterScreenRadius() + 4
            : Math.max(8, state.view.scale * 1.05);
        const value = kind === 'low' ? extremes.lowValue : extremes.highValue;
        const unit = (state.result.z_unit || axisUnit('z') || '').trim();
        const valueText = Number.isFinite(value) ? value.toFixed(4) + (unit ? ' ' + unit : '') : '';
        let text = kind === 'both'
            ? t(highKey) + ' / ' + t(lowKey)
            : kind === 'high' ? t(highKey) : t(lowKey);
        if (valueText) text += ' ' + valueText;
        ctx.save();
        ctx.lineWidth = 2;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.font = '12px "Segoe UI", "Microsoft JhengHei", sans-serif';
        const padX = 6;
        const boxH = 18;
        const boxW = Math.ceil(ctx.measureText(text).width) + padX * 2;
        let boxX = sx - boxW / 2;
        let boxY = kind === 'low' ? sy + radius + 6 : sy - radius - boxH - 6;
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
    }

    function applyHeightExtremeRows() {
        const extremes = activeExtremeMarks();
        el.resultTable.querySelectorAll('tr[data-bump]').forEach((row) => {
            const index = Number(row.dataset.bump);
            row.classList.toggle('extreme-high', !!(extremes && extremes.high.has(index)));
            row.classList.toggle('extreme-low', !!(extremes && extremes.low.has(index)));
        });
    }

    function focusBump(index) {
        const point = state.centers[index];
        const dataset = state.dataset;
        if (!point || !dataset) return;
        const wrap = el.viewer;
        const viewW = Math.max(wrap ? wrap.clientWidth : 0, 320);
        const viewH = Math.max(wrap ? wrap.clientHeight : 0, 240);
        const size = contourRange();
        const bumpPx = Math.max(size.lengthMax, size.widthMax, 8);
        if (state.view.scale * bumpPx < 40) {
            const windowPx = bumpPx * 7;
            state.view.scale = clamp(Math.min(viewW, viewH) * 0.42 / windowPx, 0.02, 80);
        }
        state.view.col = point.col;
        state.view.row = point.row;
        revealResultRow(index);
        syncOverlayUi();
        requestRender();
    }

    function selectBumpFromImage(index) {
        if (!state.centers[index] || !state.result) return;
        revealResultRow(index);
        syncOverlayUi();
        requestRender();
    }

    function revealResultRow(index) {
        state.selectedBump = index;
        const position = resultView.order.indexOf(index);
        const wrap = el.resultScroll;
        if (position >= 0 && wrap) {
            const rowH = RESULT_ROW_HEIGHT;
            const top = position * rowH;
            const viewH = wrap.clientHeight || 280;
            if (top < wrap.scrollTop) wrap.scrollTop = top;
            else if (top + rowH > wrap.scrollTop + viewH) wrap.scrollTop = Math.max(0, top + rowH - viewH);
        }
        renderResultWindow(true);
    }

    function clearSelectedBump(renderNow) {
        if (state.selectedBump < 0) return;
        state.selectedBump = -1;
        el.resultTable.querySelectorAll('tr[data-bump]').forEach((row) => {
            row.classList.remove('selected');
            row.removeAttribute('aria-current');
        });
        syncOverlayUi();
        if (renderNow !== false) requestRender();
    }

    let minimapCache = null;

    const MINIMAP_MARGIN = 12;
    const MINIMAP_TOOL_GAP = 10;
    // padding 4*2 + border 1*2，再留 2px，避免和實際外框差 1px 時又疊回去
    const MINIMAP_CHROME = 12;
    // 縮圖標題列（按鈕約 22px + 與圖的間距）
    const MINIMAP_FOLD_BAR = 28;

    function hideMinimap() {
        el.minimap.hidden = true;
        syncMinimapToolbar();
    }

    function estimatedMinimapOuter(canvasSize) {
        return canvasSize + MINIMAP_CHROME + MINIMAP_FOLD_BAR;
    }

    function toolbarClearsMinimap(canvasH) {
        const tools = el.viewerTools;
        if (tools.hidden) return true;
        const toolsH = tools.offsetHeight;
        if (!toolsH) return true;
        const centeredTop = (el.viewer.clientHeight - toolsH) / 2;
        return centeredTop >= MINIMAP_MARGIN + estimatedMinimapOuter(canvasH) + MINIMAP_TOOL_GAP;
    }

    function toolbarFitsBelowMinimap(canvasH) {
        const toolsH = el.viewerTools.offsetHeight;
        if (!toolsH) return true;
        const below = MINIMAP_MARGIN + estimatedMinimapOuter(canvasH) + MINIMAP_TOOL_GAP;
        return below + toolsH <= el.viewer.clientHeight - MINIMAP_MARGIN;
    }

    function minimapRoomBesideToolbar() {
        const toolsW = el.viewerTools.offsetWidth || 0;
        const layerW = el.layerPanel.hidden ? 0 : el.layerPanel.offsetWidth;
        const left = layerW ? MINIMAP_MARGIN + layerW + MINIMAP_TOOL_GAP : MINIMAP_MARGIN;
        return Math.floor(
            el.viewer.clientWidth - left - MINIMAP_MARGIN - toolsW - MINIMAP_TOOL_GAP - MINIMAP_CHROME
        );
    }

    // 剖面面板壓矮圖面後，垂直置中的工具列會上移進縮圖。能放下就只把工具列下移到縮圖下方；
    // 高度不夠時改把縮圖挪到工具列左側，並縮小寬度以免蓋到左側圖層面板。
    function syncMinimapToolbar() {
        const map = el.minimap;
        const tools = el.viewerTools;
        let toolsTop = '';
        let toolsTransform = '';
        let mapRight = '';
        if (!map.hidden && !tools.hidden) {
            const toolsH = tools.offsetHeight;
            const mapH = map.offsetHeight;
            const viewerH = el.viewer.clientHeight;
            if (toolsH && mapH) {
                const centeredTop = (viewerH - toolsH) / 2;
                const below = MINIMAP_MARGIN + mapH + MINIMAP_TOOL_GAP;
                if (centeredTop < below) {
                    const maxTop = viewerH - MINIMAP_MARGIN - toolsH;
                    if (below <= maxTop) {
                        toolsTop = Math.round(below) + 'px';
                        toolsTransform = 'none';
                    } else {
                        mapRight = (MINIMAP_MARGIN + tools.offsetWidth + MINIMAP_TOOL_GAP) + 'px';
                    }
                }
            }
        }
        if (tools.style.top !== toolsTop) tools.style.top = toolsTop;
        if (tools.style.transform !== toolsTransform) tools.style.transform = toolsTransform;
        if (map.style.right !== mapRight) map.style.right = mapRight;
    }

    function viewportOnImage(canvasW, canvasH) {
        const scale = state.view.scale || 1;
        const width = canvasW / scale;
        const height = canvasH / scale;
        return {
            col: state.view.col - width / 2,
            row: state.view.row - height / 2,
            width,
            height,
        };
    }

    function isZoomedIn(canvasW, canvasH) {
        const dataset = state.dataset;
        const view = viewportOnImage(canvasW, canvasH);
        return view.width < dataset.width - 0.5 || view.height < dataset.height - 0.5;
    }

    function minimapLayout() {
        const dataset = state.dataset;
        const wrap = el.viewer;
        const maxH = Math.max(72, Math.min(188, Math.floor(wrap.clientHeight * 0.34)));
        const fitTo = (limitW) => {
            const fit = Math.min(limitW / dataset.width, maxH / dataset.height);
            return {
                width: Math.max(1, Math.round(dataset.width * fit)),
                height: Math.max(1, Math.round(dataset.height * fit)),
            };
        };
        let maxW = Math.max(96, Math.min(188, Math.floor(wrap.clientWidth * 0.3)));
        let layout = fitTo(maxW);
        if (!toolbarClearsMinimap(layout.height) && !toolbarFitsBelowMinimap(layout.height)) {
            const room = minimapRoomBesideToolbar();
            if (room >= 48) maxW = Math.min(maxW, room);
            layout = fitTo(maxW);
        }
        return layout;
    }

    function minimapKey(width, height) {
        const layers = state.layers;
        const bounds = colorBounds();
        return [
            width,
            height,
            state.dataset.width,
            state.dataset.height,
            state.vmin,
            state.vmax,
            bounds.min,
            bounds.max,
            state.colormap,
            currentClip().lo,
            currentClip().hi,
            state.histLo,
            state.histHi,
            layers.bump ? 1 : 0,
            layers.donut ? 1 : 0,
            layers.denoise ? 1 : 0,
            layers.rejected ? 1 : 0,
            state.donutMaskWidth,
            state.bumpKey,
            state.centers.length,
            state.resultView,
            state.resultSerial,
            scatterDotScale(),
            state.rawHistLo,
            state.rawHistHi,
            state.showRawFiltered ? 1 : 0,
            state.donutHistLo,
            state.donutHistHi,
            state.showDonutFiltered ? 1 : 0,
        ].join('|');
    }

    function considerMinimapSample(best, width, height, dataset, row, col) {
        const value = sampleFor('result', row, col);
        if (!Number.isFinite(value)) return;
        const x = clamp(Math.floor((col + 0.5) * width / dataset.width), 0, width - 1);
        const y = clamp(Math.floor((row + 0.5) * height / dataset.height), 0, height - 1);
        const index = y * width + x;
        if (!Number.isFinite(best[index]) || value > best[index]) best[index] = value;
    }

    function renderScatterMinimap(width, height) {
        const dataset = state.dataset;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.fillStyle = '#1e1e28';
        ctx.fillRect(0, 0, width, height);
        const radius = Math.max(1.25, scatterImageRadius() * width / dataset.width);
        for (let index = 0; index < state.centers.length; index++) {
            const value = scatterValue(index);
            if (!scatterDotShown(index)) continue;
            const point = state.centers[index];
            const rgb = colorRgb(value);
            ctx.fillStyle = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
            ctx.beginPath();
            ctx.arc((point.col + 0.5) * width / dataset.width, (point.row + 0.5) * height / dataset.height, radius, 0, Math.PI * 2);
            ctx.fill();
        }
        return canvas;
    }

    function renderMinimapImage(width, height) {
        if (isScatterView()) return renderScatterMinimap(width, height);
        const dataset = state.dataset;
        const best = new Float32Array(width * height);
        best.fill(NaN);
        for (let y = 0; y < height; y++) {
            const row = Math.min(dataset.height - 1, Math.floor((y + 0.5) * dataset.height / height));
            for (let x = 0; x < width; x++) {
                const col = Math.min(dataset.width - 1, Math.floor((x + 0.5) * dataset.width / width));
                considerMinimapSample(best, width, height, dataset, row, col);
            }
        }
        const donut = state.layers.donut ? Math.max(1, Math.round(Number(el.donutWidth.value) || 1)) : 0;
        const size = contourRange();
        const bumpRadius = Math.max(1, Math.round(Math.max(size.lengthMax, size.widthMax, 1) / 2));
        const ring = bumpRadius + Math.max(1, Math.round(donut / 2));
        state.centers.forEach((point) => {
            considerMinimapSample(best, width, height, dataset, point.row, point.col);
            if (!donut) return;
            considerMinimapSample(best, width, height, dataset, point.row + ring, point.col);
            considerMinimapSample(best, width, height, dataset, point.row - ring, point.col);
            considerMinimapSample(best, width, height, dataset, point.row, point.col + ring);
            considerMinimapSample(best, width, height, dataset, point.row, point.col - ring);
        });
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { alpha: false });
        const image = ctx.createImageData(width, height);
        const pixels = image.data;
        for (let index = 0; index < best.length; index++) {
            const offset = index * 4;
            const value = best[index];
            if (!Number.isFinite(value)) {
                paintMissingPixel(pixels, offset);
            } else {
                const rgb = colorRgb(value);
                pixels[offset] = rgb[0];
                pixels[offset + 1] = rgb[1];
                pixels[offset + 2] = rgb[2];
            }
            pixels[offset + 3] = 255;
        }
        ctx.putImageData(image, 0, 0);
        return canvas;
    }

    function visibleBox(view, dataset, width, height) {
        const col1 = clamp(view.col, 0, dataset.width);
        const row1 = clamp(view.row, 0, dataset.height);
        const col2 = clamp(view.col + view.width, 0, dataset.width);
        const row2 = clamp(view.row + view.height, 0, dataset.height);
        const sx = width / dataset.width;
        const sy = height / dataset.height;
        if (col2 - col1 < 0.5 || row2 - row1 < 0.5) {
            const box = 4;
            const cx = clamp((view.col + view.width / 2) * sx, 0, width);
            const cy = clamp((view.row + view.height / 2) * sy, 0, height);
            return {
                x: clamp(cx - box / 2, 0, width - box),
                y: clamp(cy - box / 2, 0, height - box),
                w: box,
                h: box,
            };
        }
        let x = col1 * sx;
        let y = row1 * sy;
        let w = (col2 - col1) * sx;
        let h = (row2 - row1) * sy;
        const min = 4;
        if (w < min) {
            x = clamp(x - (min - w) / 2, 0, width - min);
            w = min;
        }
        if (h < min) {
            y = clamp(y - (min - h) / 2, 0, height - min);
            h = min;
        }
        return { x, y, w, h };
    }

    function placeMinimapBox(box, width, height) {
        const margin = 2;
        const w = Math.min(Math.max(6, box.w), Math.max(6, width - margin * 2));
        const h = Math.min(Math.max(6, box.h), Math.max(6, height - margin * 2));
        return {
            x: clamp(box.x, margin, width - margin - w),
            y: clamp(box.y, margin, height - margin - h),
            w,
            h,
        };
    }

    function strokeMinimapBox(ctx, box) {
        const thin = box.w < 14 || box.h < 14;
        const pad = thin ? 0.5 : 1.5;
        const w = Math.max(1, box.w - pad * 2);
        const h = Math.max(1, box.h - pad * 2);
        ctx.lineWidth = thin ? 1.5 : 3;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.82)';
        ctx.strokeRect(box.x + pad, box.y + pad, w, h);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#ffffff';
        ctx.strokeRect(box.x + pad, box.y + pad, w, h);
    }

    function drawMinimap(mainCanvas) {
        const dataset = state.dataset;
        if (!dataset || state.step !== 4 || !isZoomedIn(mainCanvas.width, mainCanvas.height)) {
            hideMinimap();
            return;
        }
        el.minimap.hidden = false;
        if (state.minimapCollapsed) {
            syncMinimapToolbar();
            return;
        }
        const layout = minimapLayout();
        const key = minimapKey(layout.width, layout.height);
        if (!minimapCache || minimapCache.key !== key) {
            minimapCache = {
                key,
                canvas: renderMinimapImage(layout.width, layout.height),
            };
        }
        const canvas = el.minimapCanvas;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const bitmapW = Math.max(1, Math.round(layout.width * dpr));
        const bitmapH = Math.max(1, Math.round(layout.height * dpr));
        if (canvas.width !== bitmapW) canvas.width = bitmapW;
        if (canvas.height !== bitmapH) canvas.height = bitmapH;
        canvas.style.width = layout.width + 'px';
        canvas.style.height = layout.height + 'px';
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.drawImage(minimapCache.canvas, 0, 0, layout.width, layout.height);
        const box = placeMinimapBox(
            visibleBox(viewportOnImage(mainCanvas.width, mainCanvas.height), dataset, layout.width, layout.height),
            layout.width,
            layout.height,
        );
        ctx.fillStyle = 'rgba(79, 140, 255, 0.25)';
        ctx.fillRect(box.x, box.y, box.w, box.h);
        strokeMinimapBox(ctx, box);
        syncMinimapToolbar();
    }

    let minimapDrag = null;

    function minimapPointer(event) {
        const rect = el.minimapCanvas.getBoundingClientRect();
        return {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
            width: rect.width,
            height: rect.height,
        };
    }

    function minimapBoxCss() {
        const dataset = state.dataset;
        const main = el.canvas;
        const point = { width: el.minimapCanvas.getBoundingClientRect().width, height: el.minimapCanvas.getBoundingClientRect().height };
        const layout = minimapLayout();
        const box = placeMinimapBox(
            visibleBox(viewportOnImage(main.width, main.height), dataset, layout.width, layout.height),
            layout.width,
            layout.height,
        );
        const sx = point.width / layout.width;
        const sy = point.height / layout.height;
        return { x: box.x * sx, y: box.y * sy, w: box.w * sx, h: box.h * sy };
    }

    function minimapHitsBox(point) {
        const box = minimapBoxCss();
        return point.x >= box.x && point.y >= box.y && point.x <= box.x + box.w && point.y <= box.y + box.h;
    }

    function bindMinimap() {
        const canvas = el.minimapCanvas;
        canvas.addEventListener('pointerdown', (event) => {
            if (event.button !== 0 || el.minimap.hidden || !state.dataset) return;
            const point = minimapPointer(event);
            if (!minimapHitsBox(point)) return;
            event.preventDefault();
            event.stopPropagation();
            capturePointer(canvas, event.pointerId);
            minimapDrag = {
                id: event.pointerId,
                x: point.x,
                y: point.y,
                col: state.view.col,
                row: state.view.row,
            };
            canvas.style.cursor = 'grabbing';
        });
        canvas.addEventListener('pointermove', (event) => {
            if (el.minimap.hidden || !state.dataset) return;
            const point = minimapPointer(event);
            if (!minimapDrag || minimapDrag.id !== event.pointerId) {
                canvas.style.cursor = minimapHitsBox(point) ? 'grab' : 'default';
                return;
            }
            const dataset = state.dataset;
            state.view.col = minimapDrag.col + (point.x - minimapDrag.x) * (dataset.width / point.width);
            state.view.row = minimapDrag.row + (point.y - minimapDrag.y) * (dataset.height / point.height);
            canvas.style.cursor = 'grabbing';
            requestRender();
        });
        const endDrag = (event) => {
            if (!minimapDrag || minimapDrag.id !== event.pointerId) return;
            minimapDrag = null;
            canvas.style.cursor = minimapHitsBox(minimapPointer(event)) ? 'grab' : 'default';
        };
        canvas.addEventListener('pointerup', endDrag);
        canvas.addEventListener('pointercancel', endDrag);
        canvas.addEventListener('pointerleave', () => {
            if (!minimapDrag) canvas.style.cursor = 'default';
        });
        canvas.addEventListener('wheel', (event) => {
            if (!state.dataset || el.minimap.hidden) return;
            event.preventDefault();
            const main = el.canvas.getBoundingClientRect();
            const anchor = screenToImage(main.width / 2, main.height / 2, main.width, main.height);
            const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
            state.view.scale = clamp(state.view.scale * factor, 0.02, 80);
            state.view.col = anchor.col;
            state.view.row = anchor.row;
            requestRender();
        }, { passive: false });
    }

    function placeHandleValues(clip, loAtEnd, hiAtEnd) {
        const trackW = el.colorbarTrack ? el.colorbarTrack.clientWidth : 0;
        if (trackW <= 0) return;
        const place = (label, fraction, edge) => {
            const labelW = label.offsetWidth || 0;
            const center = fraction * trackW;
            const shift = edge - (center - labelW / 2);
            label.style.left = '50%';
            label.style.right = 'auto';
            label.style.transform = 'translateX(calc(-50% + ' + shift.toFixed(2) + 'px))';
        };
        const loW = loAtEnd ? 0 : (el.cbValLo.offsetWidth || 0);
        const hiW = hiAtEnd ? 0 : (el.cbValHi.offsetWidth || 0);
        const loCenter = clip.lo * trackW;
        const hiCenter = clip.hi * trackW;
        let loEdge = Math.min(Math.max(loCenter, 0), Math.max(0, trackW - loW));
        let hiEdge = Math.min(Math.max(hiCenter - hiW, 0), Math.max(0, trackW - hiW));
        if (!loAtEnd && !hiAtEnd && loEdge + loW + 6 > hiEdge) {
            const mid = (loCenter + hiCenter) / 2;
            loEdge = Math.max(0, Math.min(mid - 3 - loW, trackW - loW));
            hiEdge = Math.min(Math.max(mid + 3, loEdge + loW + 6), Math.max(0, trackW - hiW));
        }
        if (!loAtEnd) place(el.cbValLo, clip.lo, loEdge);
        if (!hiAtEnd) place(el.cbValHi, clip.hi, hiEdge);
    }

    function syncResultViewTabs() {
        const tabs = el.resultViewTabs;
        if (!tabs) return;
        const show = state.step === 4 && !!state.dataset;
        tabs.hidden = !show;
        tabs.querySelectorAll('[data-result-view]').forEach((btn) => {
            const view = btn.getAttribute('data-result-view');
            const on = view === state.resultView;
            btn.classList.toggle('active', on);
            btn.setAttribute('aria-selected', on ? 'true' : 'false');
            btn.disabled = view !== 'map' && !state.result;
        });
        syncDotSize();
    }

    function syncDotSize() {
        const field = el.dotSizeField;
        if (!field) return;
        field.hidden = !isScatterView();
        const scale = scatterDotScale();
        if (el.dotSize && document.activeElement !== el.dotSize) el.dotSize.value = String(scale);
        if (el.dotSizeValue) el.dotSizeValue.textContent = scale.toFixed(1) + '×';
    }

    function colorbarTitle() {
        if (state.step === 4 && state.resultView === 'h') return t('colorbarH');
        if (state.step === 4 && isFilteredScatter()) return t(seriesViewSpec().colorbar);
        return t('sideColorbar');
    }

    function syncColorbarTitle() {
        if (el.colorbarTitle) el.colorbarTitle.textContent = colorbarTitle();
    }

    function syncColorbar(visible) {
        if (!el.colorbarBar) return;
        if (!visible) {
            el.colorbarBar.hidden = true;
            return;
        }
        el.colorbarBar.hidden = false;
        syncColorbarTitle();
        const clip = currentClip();
        const bounds = colorBounds();
        const span = bounds.max - bounds.min;
        el.cbHandleLo.style.left = (clip.lo * 100) + '%';
        el.cbHandleHi.style.left = (clip.hi * 100) + '%';
        el.cbValLo.textContent = formatColorValue(bounds.min + clip.lo * span);
        el.cbValHi.textContent = formatColorValue(bounds.min + clip.hi * span);
        el.zMin.textContent = formatColorValue(bounds.min);
        el.zMax.textContent = formatColorValue(bounds.max);
        const loAtEnd = clip.lo <= 0.0005;
        const hiAtEnd = clip.hi >= 0.9995;
        el.cbHandleLo.classList.toggle('at-end', loAtEnd);
        el.cbHandleHi.classList.toggle('at-end', hiAtEnd);
        placeHandleValues(clip, loAtEnd, hiAtEnd);
        const canvas = el.colorbarCanvas;
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const image = ctx.createImageData(width, height);
        const pixels = image.data;
        const clipSpan = clip.hi > clip.lo ? clip.hi - clip.lo : 1e-12;
        const lut = ensureColorLut();
        for (let x = 0; x < width; x++) {
            let t = (x / (width - 1) - clip.lo) / clipSpan;
            if (t < 0) t = 0;
            else if (t > 1) t = 1;
            const index = Math.min(255, (t * 255) | 0) * 3;
            const r = lut[index];
            const g = lut[index + 1];
            const b = lut[index + 2];
            for (let y = 0; y < height; y++) {
                const offset = (y * width + x) * 4;
                pixels[offset] = r;
                pixels[offset + 1] = g;
                pixels[offset + 2] = b;
                pixels[offset + 3] = 255;
            }
        }
        ctx.putImageData(image, 0, 0);
    }

    function bindColorbar() {
        const track = el.colorbarTrack;
        const handleLo = el.cbHandleLo;
        const handleHi = el.cbHandleHi;
        if (!track || !handleLo || !handleHi) return;
        const minGap = 0.01;
        let dragging = null;
        const fraction = (clientX) => {
            const rect = track.getBoundingClientRect();
            if (rect.width <= 0) return 0;
            return clamp((clientX - rect.left) / rect.width, 0, 1);
        };
        const onMove = (event) => {
            if (!dragging || !state.dataset) return;
            const clip = currentClip();
            const value = fraction(event.clientX);
            if (dragging === 'lo') clip.lo = Math.max(0, Math.min(value, clip.hi - minGap));
            else clip.hi = Math.min(1, Math.max(value, clip.lo + minGap));
            requestRender();
        };
        const endDrag = () => {
            if (!dragging) return;
            (dragging === 'lo' ? handleLo : handleHi).classList.remove('dragging');
            dragging = null;
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', endDrag);
        };
        const startDrag = (which, handle, event) => {
            if (!state.dataset || event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            dragging = which;
            handle.classList.add('dragging');
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', endDrag);
        };
        handleLo.addEventListener('pointerdown', (event) => startDrag('lo', handleLo, event));
        handleHi.addEventListener('pointerdown', (event) => startDrag('hi', handleHi, event));
        if (el.cbFitView) {
            el.cbFitView.addEventListener('click', () => {
                if (!state.dataset) return;
                const range = viewDataRange();
                if (!range) {
                    showToast(t('toastColorViewEmpty'), 'info');
                    return;
                }
                setActiveColorSpan(range);
                const clip = currentClip();
                clip.lo = 0;
                clip.hi = 1;
                requestRender();
            });
        }
        el.cbReset.addEventListener('click', () => {
            if (!state.dataset) return;
            setActiveColorSpan(null);
            const clip = currentClip();
            clip.lo = 0;
            clip.hi = 1;
            requestRender();
        });
    }

    function scatterViewRange() {
        const canvas = el.canvas;
        const bounds = canvas ? viewPixelBounds(canvas) : null;
        if (!bounds || !state.centers.length) return null;
        let vmin = Infinity;
        let vmax = -Infinity;
        let count = 0;
        for (let index = 0; index < state.centers.length; index++) {
            const point = state.centers[index];
            if (point.col < bounds.c0 || point.col >= bounds.c1 || point.row < bounds.r0 || point.row >= bounds.r1) continue;
            const value = scatterValue(index);
            if (!scatterDotShown(index)) continue;
            if (value < vmin) vmin = value;
            if (value > vmax) vmax = value;
            count++;
        }
        if (!count || !(vmax >= vmin)) return null;
        if (!(vmax > vmin)) {
            const pad = Math.max(Math.abs(vmin) * 0.001, 0.001);
            vmin -= pad;
            vmax += pad;
        }
        return { min: vmin, max: vmax };
    }

    function viewDataRange() {
        if (isScatterView()) return scatterViewRange();
        const dataset = state.dataset;
        if (!dataset) return null;
        const canvases = state.step === 3 ? [el.canvasBump, el.canvasBase] : [el.canvas];
        let vmin = Infinity;
        let vmax = -Infinity;
        let count = 0;
        const consider = (value) => {
            if (!Number.isFinite(value)) return;
            if (value < vmin) vmin = value;
            if (value > vmax) vmax = value;
            count++;
        };
        for (const canvas of canvases) {
            if (!canvas) continue;
            const bounds = viewPixelBounds(canvas);
            if (!bounds) continue;
            const mode = modeForCanvas(canvas);
            if (mode === 'original') {
                const data = dataset.data;
                const width = dataset.width;
                for (let row = bounds.r0; row < bounds.r1; row++) {
                    const base = row * width + bounds.c0;
                    const end = base + (bounds.c1 - bounds.c0);
                    for (let index = base; index < end; index++) consider(data[index]);
                }
            } else {
                for (let row = bounds.r0; row < bounds.r1; row++) {
                    for (let col = bounds.c0; col < bounds.c1; col++) consider(sampleFor(mode, row, col));
                }
            }
        }
        if (!count || !(vmax >= vmin)) return null;
        if (!(vmax > vmin)) {
            const pad = Math.max(Math.abs(vmin) * 0.001, 0.001);
            vmin -= pad;
            vmax += pad;
        }
        return { min: vmin, max: vmax };
    }

    let renderFrame = 0;
    function requestRender() {
        if (renderFrame) return;
        renderFrame = requestAnimationFrame(() => {
            renderFrame = 0;
            render();
        });
    }

    function watchCanvasWrap() {
        const wrap = el.stageSingle;
        if (!wrap || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(() => {
            const canvas = el.canvas;
            const width = wrap.clientWidth;
            const height = wrap.clientHeight;
            if (!canvas || width < 2 || height < 2) return;
            if (canvas.width === width && canvas.height === height) return;
            requestRender();
        });
        observer.observe(wrap);
    }

    function render() {
        const has = !!state.dataset;
        const compare = has && state.step === 3;
        el.placeholder.hidden = has;
        el.stageSingle.hidden = !has || compare;
        el.stageCompare.hidden = !compare;
        if (!has) {
            hideMinimap();
            syncColorbar(false);
            return;
        }
        syncColorbar(true);
        const target = compare ? el.canvasBump : el.canvas;
        if (target.parentElement.clientWidth < 2) {
            hideMinimap();
            requestRender();
            return;
        }
        if (compare || (state.step === 4 && state.resultView === 'map' && state.layers.donut)) ensureDonutMask();
        if (compare) {
            hideMinimap();
            drawCanvas(el.canvasBump, 'pure');
            drawCanvas(el.canvasBase, 'base');
            drawProfileOverlay();
        } else if (state.step === 4 && isScatterView()) {
            drawScatterCanvas(el.canvas);
            drawMinimap(el.canvas);
            drawProfileOverlay();
        } else if (state.step === 4) {
            drawCanvas(el.canvas, 'result');
            drawMinimap(el.canvas);
            drawProfileOverlay();
        } else {
            hideMinimap();
            drawCanvas(el.canvas, currentSampleMode());
            drawProfileOverlay();
        }
        if (state.step === 1) drawHist();
        if (state.step === 4 && isFilteredScatter() && state.result && el.rawHistPanel && !el.rawHistPanel.hidden && !state.rawHistCollapsed) drawRawHist();
    }

    function histCacheCurrent(data) {
        return !!(histCache && histCache.data === data && histCache.vmin === state.vmin && histCache.vmax === state.vmax);
    }

    function rebuildHistCache(data) {
        const counts = new Float64Array(HIST_BINS);
        const span = state.vmax - state.vmin || 1;
        const abs = rangeAbs();
        let total = 0;
        let keep = 0;
        for (let i = 0; i < data.length; i++) {
            const value = data[i];
            if (!Number.isFinite(value)) continue;
            total++;
            if (value >= abs.z_lo && value <= abs.z_hi) keep++;
            let frac = (value - state.vmin) / span;
            if (frac < 0) frac = 0;
            else if (frac >= 1) frac = 0.999999;
            counts[(frac * HIST_BINS) | 0]++;
        }
        let maxCount = 1;
        for (let i = 0; i < HIST_BINS; i++) if (counts[i] > maxCount) maxCount = counts[i];
        histCache = {
            data,
            vmin: state.vmin,
            vmax: state.vmax,
            counts,
            total,
            maxCount,
            lo: state.histLo,
            hi: state.histHi,
            keep,
        };
        return histCache;
    }

    function ensureHistKeep(cache, data) {
        if (cache.lo === state.histLo && cache.hi === state.histHi) return cache.keep;
        const abs = rangeAbs();
        let keep = 0;
        for (let i = 0; i < data.length; i++) {
            const value = data[i];
            if (!Number.isFinite(value)) continue;
            if (value >= abs.z_lo && value <= abs.z_hi) keep++;
        }
        cache.lo = state.histLo;
        cache.hi = state.histHi;
        cache.keep = keep;
        return keep;
    }

    function paintHist(cache, keep) {
        const wrap = el.histWrap;
        const canvas = el.histCanvas;
        const width = Math.max(1, wrap.clientWidth);
        const height = Math.max(1, wrap.clientHeight);
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, width, height);
        const counts = cache ? cache.counts : null;
        const maxCount = cache ? cache.maxCount : 1;
        const total = cache ? cache.total : 0;
        const binW = width / HIST_BINS;
        for (let i = 0; i < HIST_BINS; i++) {
            const f0 = i / HIST_BINS;
            const f1 = (i + 1) / HIST_BINS;
            const inside = f1 > state.histLo && f0 < state.histHi;
            const count = counts ? counts[i] : 0;
            const bar = Math.sqrt(count / maxCount) * (height - 4);
            ctx.fillStyle = inside ? 'rgba(79,140,255,0.9)' : 'rgba(120,120,140,0.35)';
            ctx.fillRect(i * binW, height - bar, Math.max(1, binW - 0.5), bar);
        }
        const abs = rangeAbs();
        el.histLo.style.left = (state.histLo * 100) + '%';
        el.histHi.style.left = (state.histHi * 100) + '%';
        el.histValLo.textContent = abs.z_lo.toFixed(3);
        el.histValHi.textContent = abs.z_hi.toFixed(3);
        el.histMin.textContent = state.vmin.toFixed(3);
        el.histMax.textContent = state.vmax.toFixed(3);
        if (keep != null) el.histStats.textContent = keep + ' / ' + total;
    }

    function drawHist() {
        const data = state.dataset ? state.dataset.data : [];
        const cache = histCacheCurrent(data) ? histCache : rebuildHistCache(data);
        paintHist(cache, ensureHistKeep(cache, data));
    }

    function drawRawHist() {
        const wrap = el.rawHistWrap;
        const canvas = el.rawHistCanvas;
        if (!wrap || !canvas) return;
        const width = wrap.clientWidth;
        const height = Math.max(1, wrap.clientHeight);
        if (width < 2) {
            if (!drawRawHist.pending) {
                drawRawHist.pending = true;
                requestAnimationFrame(() => {
                    drawRawHist.pending = false;
                    if (el.rawHistPanel && !el.rawHistPanel.hidden) requestRender();
                });
            }
            return;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, width, height);
        const cache = rawHistCounts();
        const spec = seriesViewSpec();
        const frac = { lo: state[spec.lo], hi: state[spec.hi] };
        const binW = width / HIST_BINS;
        for (let i = 0; i < HIST_BINS; i++) {
            const f0 = i / HIST_BINS;
            const f1 = (i + 1) / HIST_BINS;
            const inside = f1 > frac.lo && f0 < frac.hi;
            const count = cache.counts[i];
            const bar = Math.sqrt(count / cache.maxCount) * (height - 4);
            ctx.fillStyle = inside ? 'rgba(79,140,255,0.9)' : 'rgba(120,120,140,0.35)';
            ctx.fillRect(i * binW, height - bar, Math.max(1, binW - 0.5), bar);
        }
        const bounds = rawFilterAbs();
        const extent = rawExtent();
        el.rawHistLo.style.left = (frac.lo * 100) + '%';
        el.rawHistHi.style.left = (frac.hi * 100) + '%';
        el.rawHistValLo.textContent = bounds.lo.toFixed(4);
        el.rawHistValHi.textContent = bounds.hi.toFixed(4);
        el.rawHistMin.textContent = extent.min.toFixed(4);
        el.rawHistMax.textContent = extent.max.toFixed(4);
        let keep = 0;
        const series = scatterSeries();
        if (series) {
            for (let i = 0; i < series.length; i++) {
                if (rawValueInside(seriesNumber(series, i))) keep++;
            }
        }
        el.rawHistStats.textContent = keep + ' / ' + cache.total;
    }

    function previewHist() {
        const data = state.dataset ? state.dataset.data : null;
        if (!data) return;
        const cache = histCacheCurrent(data) ? histCache : rebuildHistCache(data);
        paintHist(cache, null);
    }

    function autoRange() {
        const data = state.dataset.data;
        const bins = 256;
        const counts = new Float64Array(bins);
        let total = 0;
        const span = state.vmax - state.vmin || 1;
        for (let i = 0; i < data.length; i++) {
            const value = data[i];
            if (!Number.isFinite(value)) continue;
            let frac = (value - state.vmin) / span;
            if (frac < 0) frac = 0;
            else if (frac >= 1) frac = 0.999999;
            counts[(frac * bins) | 0]++;
            total++;
        }
        if (total < 4) return;
        const percentile = (p) => {
            const target = p * total;
            let acc = 0;
            for (let i = 0; i < bins; i++) {
                acc += counts[i];
                if (acc >= target) return (i + 0.5) / bins;
            }
            return 1;
        };
        const q1 = state.vmin + percentile(0.25) * span;
        const q3 = state.vmin + percentile(0.75) * span;
        const iqr = q3 - q1;
        let loV;
        let hiV;
        if (iqr > 0) {
            loV = q1 - 1.5 * iqr;
            hiV = q3 + 1.5 * iqr;
        } else {
            loV = state.vmin + percentile(0.025) * span;
            hiV = state.vmin + percentile(0.975) * span;
        }
        setAbsRange(loV, hiV);
    }

    function setAbsRange(lo, hi) {
        const span = state.vmax - state.vmin || 1;
        let loF = clamp((lo - state.vmin) / span, 0, 0.995);
        let hiF = clamp((hi - state.vmin) / span, 0.005, 1);
        if (hiF - loF < 0.005) {
            loF = 0;
            hiF = 1;
        }
        state.histLo = loF;
        state.histHi = hiF;
        invalidateBumps();
    }

    function invalidateBumps() {
        state.centers = [];
        state.bumpMask = null;
        state.donutMask = null;
        clearComputedResult();
        state.bumpKey = '';
        if (state.maxStep > 2) state.maxStep = 2;
        if (state.step > 2) state.step = 2;
        state.peekOriginal = false;
    }

    function update(renderView) {
        el.stepper.querySelectorAll('.step').forEach((btn, index) => {
            btn.classList.toggle('active', index === state.step);
            btn.classList.toggle('done', index < state.step);
            btn.disabled = index > state.maxStep;
        });
        el.sidePanels.forEach((panel) => {
            panel.hidden = Number(panel.getAttribute('data-side')) !== state.step;
        });
        el.histPanel.hidden = state.step !== 1 || !state.dataset;
        el.rawHistPanel.hidden = !(state.step === 4 && isFilteredScatter() && state.result);
        el.btnPrev.disabled = state.step === 0 || state.busy;
        el.btnNext.disabled = state.busy || !state.dataset || (state.step === 2 && !state.centers.length) || state.step === 4;
        el.btnNext.textContent = state.step === 3 ? t('btnCompute') : t('btnNext');
        el.btnIdentify.disabled = state.busy || !state.dataset;
        el.bumpCount.textContent = state.centers.length ? t('bumpCount', state.centers.length) : '';
        syncOverlayUi();
        renderResult();
        if (state.step === 4 && state.profile.data) renderProfileChart();
        if (renderView !== false) requestRender();
    }

    function renderResult() {
        const box = el.resultBox;
        const table = el.resultTable;
        const show = !!state.result && state.step === 4;
        if (!state.result) state.selectedBump = -1;
        box.hidden = !show;
        if (el.resultTableBar) el.resultTableBar.hidden = !show;
        if (!state.result) {
            el.resultHead.replaceChildren();
            el.resultHead.style.transform = '';
            table.replaceChildren();
            table.removeAttribute('aria-rowcount');
            el.resultScroll.style.minHeight = '';
            resultView.order = [];
            resultView.columns = null;
            resultView.result = null;
            resultView.start = -1;
            resultView.end = -1;
            return;
        }
        const result = state.result;
        const unit = result.z_unit ? ' ' + result.z_unit : '';
        box.querySelector('[data-k="pv"]').textContent = result.intrinsic_coplanarity.toFixed(4) + unit;
        box.querySelector('[data-k="mean"]').textContent = result.mean_true_height.toFixed(4) + unit;
        box.querySelector('[data-k="tilt"]').textContent = result.max_tilt_deg.toFixed(3) + ' ' + t('unitDeg');
        box.querySelector('[data-k="inliers"]').textContent = String(result.base_inlier_count);
        box.querySelector('[data-k="bumps"]').textContent = String(result.bump_count);
        const columns = resultColumns(result);
        const order = sortedResultIndices(result, columns);
        const scroll = el.resultScroll;
        const keepScroll = resultView.resetScrollTop || resultView.result !== result ? 0 : scroll.scrollTop;
        const keepLeft = resultView.result !== result ? 0 : scroll.scrollLeft;
        const sideScroll = resultView.sideScrollHold || captureSideScroll();
        resultView.sideScrollHold = null;
        resultView.resetScrollTop = false;
        resultView.result = result;
        resultView.order = order;
        resultView.columns = columns;
        resultView.start = -1;
        resultView.end = -1;
        table.setAttribute('aria-rowcount', String(order.length));

        const sizing = document.createElement('tr');
        sizing.className = 'result-sizing';
        sizing.setAttribute('aria-hidden', 'true');
        widestColumnTexts(columns, result).forEach((text) => {
            const cell = document.createElement('th');
            cell.textContent = text;
            sizing.appendChild(cell);
        });

        const thead = document.createElement('thead');
        const head = document.createElement('tr');
        thead.append(sizing, head);
        columns.forEach((column) => {
            const cell = document.createElement('th');
            const active = state.resultSort.key === column.key;
            const dir = state.resultSort.dir === -1 ? -1 : 1;
            cell.setAttribute('aria-sort', active ? (dir > 0 ? 'ascending' : 'descending') : 'none');
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'sort-btn' + (active ? ' active' : '');
            const label = document.createElement('span');
            label.className = 'sort-label';
            const lines = t(column.key).split('\n');
            const unitText = columnUnit(column.key, result);
            if (unitText) lines.push('(' + unitText + ')');
            label.textContent = lines.join('\n');
            button.appendChild(label);
            if (column.titleKey) button.title = t(column.titleKey);
            const mark = document.createElement('span');
            mark.className = 'sort-mark' + (active ? '' : ' is-idle');
            mark.setAttribute('aria-hidden', 'true');
            mark.textContent = active && dir < 0 ? '▼' : '▲';
            button.appendChild(mark);
            button.addEventListener('click', () => {
                if (state.resultSort.key === column.key) state.resultSort.dir = dir > 0 ? -1 : 1;
                else state.resultSort = { key: column.key, dir: 1 };
                resultView.resetScrollTop = true;
                renderResult();
            });
            cell.appendChild(button);
            head.appendChild(cell);
        });
        const tbody = document.createElement('tbody');
        holdResultScrollHeight();
        el.resultHead.replaceChildren(thead);
        table.replaceChildren(tbody);
        syncResultColumns();
        renderResultWindow(true, keepScroll);
        restoreResultScroll(keepScroll, keepLeft, sideScroll);
    }

    function widestColumnTexts(columns, result) {
        const count = result.centers.length;
        return columns.map((column) => {
            let lo = Infinity;
            let hi = -Infinity;
            let loIndex = 0;
            let hiIndex = 0;
            let finite = false;
            for (let i = 0; i < count; i++) {
                const value = column.value(i);
                if (!Number.isFinite(value)) continue;
                finite = true;
                if (value < lo) {
                    lo = value;
                    loIndex = i;
                }
                if (value > hi) {
                    hi = value;
                    hiIndex = i;
                }
            }
            if (!finite) return '';
            const lowText = column.text(loIndex);
            const highText = column.text(hiIndex);
            return lowText.length >= highText.length ? lowText : highText;
        });
    }

    function syncResultHead() {
        const clip = el.resultHead.parentElement;
        if (clip && clip.scrollLeft) clip.scrollLeft = 0;
        el.resultHead.style.transform = 'translateX(' + (-el.resultScroll.scrollLeft) + 'px)';
    }

    function resultSide() {
        return el.resultScroll.closest('.bc-side');
    }

    function captureSideScroll() {
        const side = resultSide();
        if (!side) return null;
        return { side: side, top: side.scrollTop, left: side.scrollLeft };
    }

    function restoreSideScroll(saved) {
        if (!saved) return;
        const side = saved.side;
        const maxTop = Math.max(0, side.scrollHeight - side.clientHeight);
        const maxLeft = Math.max(0, side.scrollWidth - side.clientWidth);
        const top = Math.min(saved.top, maxTop);
        const left = Math.min(saved.left, maxLeft);
        if (Math.abs(side.scrollTop - top) > 1) side.scrollTop = top;
        if (Math.abs(side.scrollLeft - left) > 1) side.scrollLeft = left;
    }

    function holdResultScrollHeight() {
        const scroll = el.resultScroll;
        const height = scroll.offsetHeight;
        if (height > 0) scroll.style.minHeight = height + 'px';
    }

    function releaseResultScrollHeight() {
        el.resultScroll.style.minHeight = '';
    }

    function restoreResultScroll(top, left, sideScroll) {
        if (resultView.restoreRaf) cancelAnimationFrame(resultView.restoreRaf);
        const apply = () => {
            const scroll = el.resultScroll;
            const maxLeft = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
            const nextLeft = Math.min(Math.max(0, left), maxLeft);
            if (scroll.scrollTop !== top) scroll.scrollTop = top;
            if (maxLeft > 0 && Math.abs(scroll.scrollLeft - nextLeft) > 1) scroll.scrollLeft = nextLeft;
            releaseResultScrollHeight();
            restoreSideScroll(sideScroll);
            syncResultHead();
        };
        apply();
        resultView.restoreRaf = requestAnimationFrame(() => {
            resultView.restoreRaf = requestAnimationFrame(() => {
                resultView.restoreRaf = 0;
                apply();
            });
        });
    }

    function syncResultColumns() {
        const head = el.resultHead;
        const headRow = head.querySelector('thead tr:last-child');
        const sizingRow = head.querySelector('tr.result-sizing');
        if (!headRow) return;
        head.style.tableLayout = 'auto';
        head.style.width = 'max-content';
        const widths = [...headRow.children].map((cell, index) => {
            const sizingCell = sizingRow ? sizingRow.children[index] : null;
            const sizingWidth = sizingCell ? sizingCell.scrollWidth : 0;
            return Math.max(cell.getBoundingClientRect().width, sizingWidth);
        });
        if (widths.some((width) => width < 1)) return;
        head.style.tableLayout = '';
        applyResultCols(head, widths);
        applyResultCols(el.resultTable, widths);
    }

    function applyResultCols(table, widths) {
        let group = table.querySelector('colgroup');
        if (!group) {
            group = document.createElement('colgroup');
            table.prepend(group);
        }
        group.replaceChildren();
        let total = 0;
        widths.forEach((width) => {
            const col = document.createElement('col');
            const size = Math.ceil(width);
            total += size;
            col.style.width = size + 'px';
            group.appendChild(col);
        });
        table.style.width = total + 'px';
    }

    function renderResultWindow(force, scrollTop) {
        const order = resultView.order;
        const columns = resultView.columns;
        const tbody = el.resultTable.tBodies[0];
        if (!tbody || !columns || !order) return;
        const wrap = el.resultScroll;
        const rowH = RESULT_ROW_HEIGHT;
        const top = scrollTop == null ? wrap.scrollTop : scrollTop;
        const viewH = wrap.clientHeight || 280;
        const overscan = 8;
        const start = Math.max(0, Math.floor(top / rowH) - overscan);
        const end = Math.min(order.length, start + Math.ceil(viewH / rowH) + overscan * 2);
        if (!force && start === resultView.start && end === resultView.end) return;
        resultView.start = start;
        resultView.end = end;
        const extremes = activeExtremeMarks();
        const frag = document.createDocumentFragment();
        const topH = start * rowH;
        const bottomH = (order.length - end) * rowH;
        if (topH > 0) frag.appendChild(resultSpacerRow(columns.length, topH));
        for (let n = start; n < end; n++) frag.appendChild(resultDataRow(order[n], n, columns, extremes));
        if (bottomH > 0) frag.appendChild(resultSpacerRow(columns.length, bottomH));
        tbody.replaceChildren(frag);
    }

    function resultSpacerRow(colspan, height) {
        const row = document.createElement('tr');
        row.className = 'result-spacer';
        row.setAttribute('aria-hidden', 'true');
        const cell = document.createElement('td');
        cell.colSpan = colspan;
        cell.style.height = height + 'px';
        row.appendChild(cell);
        return row;
    }

    function resultDataRow(index, position, columns, extremes) {
        const row = document.createElement('tr');
        let className = 'result-row';
        if (index === state.selectedBump) className += ' selected';
        if (extremes && extremes.high.has(index)) className += ' extreme-high';
        if (extremes && extremes.low.has(index)) className += ' extreme-low';
        row.className = className;
        row.dataset.bump = String(index);
        row.tabIndex = 0;
        row.title = t('focusBump');
        row.setAttribute('aria-rowindex', String(position + 1));
        if (index === state.selectedBump) row.setAttribute('aria-current', 'true');
        columns.forEach((column) => {
            const cell = document.createElement('td');
            cell.textContent = column.text(index);
            row.appendChild(cell);
        });
        return row;
    }

    function onResultTableScroll() {
        syncResultHead();
        if (!resultView.order.length || resultView.scrollRaf) return;
        resultView.scrollRaf = requestAnimationFrame(() => {
            resultView.scrollRaf = 0;
            renderResultWindow(false);
        });
    }

    function resetResultSort() {
        state.resultSort = { key: 'colIndex', dir: 1 };
        state.selectedBump = -1;
        state.hoverBump = -1;
        state.bumpPick = null;
    }

    function columnUnit(key, result) {
        if (key === 'colX') return axisUnit('x');
        if (key === 'colY') return axisUnit('y');
        if (key === 'colApexZ' || key === 'colH' || key === 'colDz' || key === 'colDonut' || key === 'colRaw' || key === 'colGap' || key === 'colRes') {
            return (result.z_unit || axisUnit('z') || '').trim();
        }
        if (key === 'colTilt') return t('unitDeg');
        return '';
    }

    function axisUnit(axis) {
        const header = (state.dataset && state.dataset.header) || {};
        const raw = header[axis + 'unit'] ?? header[axis + '-unit'] ?? '';
        return String(raw).replace(/[\[\]]/g, '').trim();
    }

    function seriesNumber(series, index) {
        if (!series || index < 0 || index >= series.length) return NaN;
        const value = series[index];
        if (value == null || value === '') return NaN;
        const number = Number(value);
        return Number.isFinite(number) ? number : NaN;
    }

    function seriesText(series, index) {
        const value = seriesNumber(series, index);
        return Number.isFinite(value) ? value.toFixed(4) : '—';
    }

    function resultColumns(result) {
        return [
            { key: 'colIndex', value: (i) => i + 1, text: (i) => String(i + 1) },
            { key: 'colX', value: (i) => result.apexes[i][0], text: (i) => result.apexes[i][0].toFixed(3) },
            { key: 'colY', value: (i) => result.apexes[i][1], text: (i) => result.apexes[i][1].toFixed(3) },
            { key: 'colApexZ', value: (i) => result.apexes[i][2], text: (i) => result.apexes[i][2].toFixed(4) },
            { key: 'colH', titleKey: 'colHTitle', value: (i) => result.true_heights[i], text: (i) => result.true_heights[i].toFixed(4) },
            { key: 'colDz', titleKey: 'colDzTitle', value: (i) => result.delta_z[i], text: (i) => result.delta_z[i].toFixed(4) },
            { key: 'colDonut', titleKey: 'colDonutTitle', value: (i) => seriesNumber(result.donut_median, i), text: (i) => seriesText(result.donut_median, i) },
            { key: 'colRaw', titleKey: 'colRawTitle', value: (i) => seriesNumber(result.raw_step, i), text: (i) => seriesText(result.raw_step, i) },
            { key: 'colGap', titleKey: 'colGapTitle', value: (i) => seriesNumber(result.step_gap, i), text: (i) => seriesText(result.step_gap, i) },
            { key: 'colTilt', value: (i) => result.tilt_angles_deg[i], text: (i) => result.tilt_angles_deg[i].toFixed(3) },
            { key: 'colRes', value: (i) => result.residuals[i], text: (i) => result.residuals[i].toFixed(4) },
        ];
    }

    function csvCell(value) {
        const text = String(value ?? '');
        if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
        return text;
    }

    function resultCsvHeader(column, result) {
        const name = t(column.key).split('\n').join('');
        const unitText = columnUnit(column.key, result);
        return unitText ? name + ' (' + unitText + ')' : name;
    }

    function exportResultCsv() {
        const result = state.result;
        if (!result || state.step !== 4) return;
        const columns = resultView.columns || resultColumns(result);
        const order = resultView.order && resultView.order.length
            ? resultView.order
            : sortedResultIndices(result, columns);
        const lines = [columns.map((column) => csvCell(resultCsvHeader(column, result))).join(',')];
        for (let n = 0; n < order.length; n++) {
            const index = order[n];
            lines.push(columns.map((column) => csvCell(column.text(index))).join(','));
        }
        const blob = new Blob(['\uFEFF' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
        downloadBlob(blob, exportName('result', 'csv'));
    }

    function sortedResultIndices(result, columns) {
        const column = columns.find((item) => item.key === state.resultSort.key) || columns[0];
        const dir = state.resultSort.dir === -1 ? -1 : 1;
        const order = [];
        for (let i = 0; i < result.centers.length; i++) order.push(i);
        order.sort((a, b) => {
            const va = column.value(a);
            const vb = column.value(b);
            const aBad = !Number.isFinite(va);
            const bBad = !Number.isFinite(vb);
            if (aBad || bBad) {
                if (aBad === bBad) return a - b;
                return aBad ? 1 : -1;
            }
            if (va !== vb) return va < vb ? -dir : dir;
            return a - b;
        });
        return order;
    }

    function setStep(step) {
        const previous = state.step;
        state.step = step;
        if (step > state.maxStep) state.maxStep = step;
        if (step === 0 || step === 3 || previous === 3) fitView();
        if (state.profile.line) profileRecompute(false);
        update();
    }

    async function loadFile(file) {
        if (!isHeightFile(file.name)) {
            showToast(t('toastUnsupported', file.name), 'error');
            return;
        }
        const serial = ++loadSerial;
        state.busy = true;
        update();
        showProgress(0.01);
        let lastPaint = 0;
        const reportParse = async (fraction) => {
            if (serial !== loadSerial) return;
            showProgress(0.02 + fraction * 0.58);
            const now = performance.now();
            if (now - lastPaint < 48) return;
            lastPaint = now;
            await nextFrame();
        };
        try {
            const dataset = await parseHeightFile(file, reportParse);
            if (serial !== loadSerial) return;
            showProgress(0.62);
            const session = await Api.upload(dataset, (fraction) => {
                if (serial !== loadSerial) return;
                showProgress(0.62 + clamp(fraction, 0, 1) * 0.38);
            });
            if (serial !== loadSerial) return;
            setDataset(dataset, session.session_id);
            showProgress(1);
            showToast(t('toastLoaded', file.name), 'info');
        } catch (error) {
            if (serial === loadSerial) showToast(error.message, 'error');
        } finally {
            if (serial === loadSerial) {
                hideProgress();
                state.busy = false;
                update();
            }
        }
    }

    function addFiles(fileList) {
        for (const file of fileList) {
            if (!isHeightFile(file.name)) {
                showToast(t('toastUnsupported', file.name), 'error');
                continue;
            }
            loadFile(file);
            return;
        }
    }

    /** 從點雲編輯等已解析的高度圖載入（不經檔案選擇） */
    async function loadDataset(dataset) {
        if (!dataset || dataset.type === 'pcd-scatter' || !dataset.data || !dataset.width || !dataset.height) {
            return false;
        }
        const serial = ++loadSerial;
        state.busy = true;
        update();
        showProgress(0.2);
        try {
            const data = dataset.data instanceof Float32Array
                ? new Float32Array(dataset.data)
                : Float32Array.from(dataset.data);
            for (let i = 0; i < data.length; i++) if (!Number.isFinite(data[i])) data[i] = NaN;
            const prepared = {
                header: dataset.header ? { ...dataset.header } : {},
                data,
                width: dataset.width,
                height: dataset.height,
                name: dataset.name || dataset.filename || '',
            };
            const session = await Api.upload(prepared, (fraction) => {
                if (serial !== loadSerial) return;
                showProgress(0.2 + clamp(fraction, 0, 1) * 0.8);
            });
            if (serial !== loadSerial) return false;
            setDataset(prepared, session.session_id);
            showProgress(1);
            return true;
        } catch (error) {
            if (serial === loadSerial) showToast(error.message, 'error');
            return false;
        } finally {
            if (serial === loadSerial) {
                hideProgress();
                state.busy = false;
                update();
            }
        }
    }

    function currentKey() {
        const abs = rangeAbs();
        const size = contourRange();
        return [state.sessionId, abs.z_lo, abs.z_hi, size.lengthMin, size.lengthMax, size.widthMin, size.widthMax, size.isolation, size.noiseMax].join('|');
    }

    function contourRange() {
        return {
            lengthMin: Number(el.lengthMin.value),
            lengthMax: Number(el.lengthMax.value),
            widthMin: Number(el.widthMin.value),
            widthMax: Number(el.widthMax.value),
            isolation: Number(el.isolationPx.value),
            noiseMax: Number(el.noiseMax.value),
        };
    }

    function rangeIsValid(size) {
        return size.lengthMin >= 1 && size.lengthMax >= size.lengthMin
            && size.widthMin >= 1 && size.widthMax >= size.widthMin
            && Number.isFinite(size.isolation) && size.isolation >= 0
            && Number.isFinite(size.noiseMax) && size.noiseMax >= 0;
    }

    async function identify() {
        if (!state.sessionId) {
            showToast(t('toastNeedFile'), 'error');
            return false;
        }
        const size = contourRange();
        if (!rangeIsValid(size)) {
            showToast(t('toastBadRange'), 'error');
            return false;
        }
        state.busy = true;
        update(false);
        showBusy('identifyProgress');
        try {
            const abs = rangeAbs();
            const payload = await Api.bumps({
                session_id: state.sessionId,
                z_lo: abs.z_lo,
                z_hi: abs.z_hi,
                length_min: size.lengthMin,
                length_max: size.lengthMax,
                width_min: size.widthMin,
                width_max: size.widthMax,
                isolation_px: size.isolation,
                noise_max_px: size.noiseMax,
            });
            state.centers = payload.centers || [];
            state.bumpMask = maskFromRuns(payload.runs || []);
            state.donutMask = null;
            clearComputedResult();
            state.bumpKey = currentKey();
            if (!state.centers.length) {
                showToast(t('toastNoBumps'), 'error');
                return false;
            }
            if (state.maxStep < 2) state.maxStep = 2;
            return true;
        } catch (error) {
            showToast(error.message, 'error');
            return false;
        } finally {
            hideProgress();
            state.busy = false;
            update();
        }
    }

    async function compute() {
        if (state.bumpKey !== currentKey()) {
            const found = await identify();
            if (!found) return false;
        }
        state.busy = true;
        update(false);
        showBusy('computeProgress');
        try {
            const abs = rangeAbs();
            state.result = await Api.coplanarity({
                session_id: state.sessionId,
                z_lo: abs.z_lo,
                z_hi: abs.z_hi,
                length_min: contourRange().lengthMin,
                length_max: contourRange().lengthMax,
                width_min: contourRange().widthMin,
                width_max: contourRange().widthMax,
                isolation_px: contourRange().isolation,
                noise_max_px: contourRange().noiseMax,
                donut_width_px: Number(el.donutWidth.value),
                outlier_method: el.outlier.value,
            });
            if (state.result.height_trace && state.result.height_trace.line) {
                console.info(state.result.height_trace.line);
            }
            state.resultSerial += 1;
            resetScatterColor();
            resetResultSort();
            state.centers = state.result.centers || state.centers;
            return true;
        } catch (error) {
            showToast(error.message, 'error');
            return false;
        } finally {
            hideProgress();
            state.busy = false;
            update();
        }
    }

    async function goNext() {
        if (!state.dataset) {
            showToast(t('toastNeedFile'), 'error');
            return;
        }
        if (state.step === 0 || state.step === 1) {
            setStep(state.step + 1);
            return;
        }
        if (state.step === 2) {
            if (state.bumpKey !== currentKey()) {
                const found = await identify();
                if (!found) return;
            }
            setStep(3);
            return;
        }
        if (state.step === 3) {
            const ok = await compute();
            if (ok) setStep(4);
        }
    }

    function goPrev() {
        if (state.step > 0) setStep(state.step - 1);
    }

    function clearAll() {
        state.dataset = null;
        histCache = null;
        state.sessionId = null;
        state.centers = [];
        state.bumpMask = null;
        state.donutMask = null;
        state.resultView = 'map';
        state.resultSerial += 1;
        clearComputedResult();
        resetScatterColor();
        state.step = 0;
        state.maxStep = 0;
        resetColorClips();
        state.tool = 'pan';
        state.peekOriginal = false;
        state.showResiduals = false;
        state.showHeightExtremes = false;
        state.showRawExtremes = false;
        state.showRawFiltered = false;
        state.showDonutExtremes = false;
        state.showDonutFiltered = false;
        state.showBumpDetail = false;
        state.bumpDetailCollapsed = false;
        bumpDetailRenderKey = '';
        resetBumpDetailSort();
        resetLayers();
        resetResultSort();
        clearMeasure(false);
        clearProfile(false);
        el.canvas.style.cursor = '';
        el.fileLabel.textContent = '';
        closeImageMenu();
        update();
    }

    let progressHideTimer = 0;
    let loadSerial = 0;

    function nextFrame() {
        return new Promise((resolve) => requestAnimationFrame(resolve));
    }

    function showProgress(fraction, labelKey) {
        clearTimeout(progressHideTimer);
        const value = clamp(fraction, 0, 1);
        el.loadProgress.classList.remove('bc-is-busy');
        el.loadProgress.hidden = false;
        el.loadProgressLabel.hidden = false;
        el.loadProgressSpinner.hidden = true;
        el.loadProgressBar.style.width = (value * 100).toFixed(1) + '%';
        el.loadProgressText.textContent = t(labelKey || 'loadProgress', Math.round(value * 100));
    }

    function showBusy(labelKey) {
        clearTimeout(progressHideTimer);
        el.loadProgress.classList.add('bc-is-busy');
        el.loadProgress.hidden = false;
        el.loadProgressBar.style.width = '';
        el.loadProgressLabel.hidden = false;
        el.loadProgressSpinner.hidden = false;
        el.loadProgressText.textContent = t(labelKey);
    }

    function hideProgress() {
        clearTimeout(progressHideTimer);
        progressHideTimer = setTimeout(() => {
            el.loadProgress.hidden = true;
            el.loadProgress.classList.remove('bc-is-busy');
            el.loadProgressLabel.hidden = true;
            el.loadProgressSpinner.hidden = true;
            el.loadProgressBar.style.width = '0%';
        }, 300);
    }

    function hideValueReadout() {
        el.valueIndicator.classList.remove('show');
    }

    function updateValueReadout(event) {
        const indicator = el.valueIndicator;
        if (state.tool !== 'inspect' || !state.dataset || event.target.closest('#bcViewerTools, #bcResultViewTabs')) {
            indicator.classList.remove('show');
            return;
        }
        const canvases = state.step === 3 ? [el.canvasBump, el.canvasBase] : [el.canvas];
        let canvas = null;
        for (let i = 0; i < canvases.length; i++) {
            const rect = canvases[i].getBoundingClientRect();
            if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) {
                canvas = canvases[i];
                break;
            }
        }
        if (!canvas) {
            indicator.classList.remove('show');
            return;
        }
        const pos = eventToCanvas(event, canvas);
        const point = screenToImage(pos.sx, pos.sy, pos.width, pos.height);
        const dataset = state.dataset;
        const row = Math.floor(point.row);
        const col = Math.floor(point.col);
        if (row < 0 || col < 0 || row >= dataset.height || col >= dataset.width) {
            indicator.classList.remove('show');
            return;
        }
        let value = dataset.data[row * dataset.width + col];
        let prefix = '';
        let unit = spacing(dataset).zunit.trim();
        if (isScatterView()) {
            const hit = hitResidualBump(event, canvas);
            value = hit >= 0 ? scatterValue(hit) : NaN;
            prefix = (state.resultView === 'h' ? 'H' : t(seriesViewSpec().inspect)) + ' ';
            unit = ((state.result && state.result.z_unit) || unit).trim();
        }
        indicator.textContent = Number.isFinite(value)
            ? prefix + formatValue(value) + (unit ? ' ' + unit : '')
            : prefix + (isScatterView() ? '—' : 'NaN');
        indicator.classList.add('show');
        const viewer = el.viewer.getBoundingClientRect();
        const pad = 14;
        let left = event.clientX - viewer.left + pad;
        let top = event.clientY - viewer.top + pad;
        const width = indicator.offsetWidth;
        const height = indicator.offsetHeight;
        if (left + width > viewer.width - 4) left = event.clientX - viewer.left - width - pad;
        if (top + height > viewer.height - 4) top = event.clientY - viewer.top - height - pad;
        if (left < 4) left = 4;
        if (top < 4) top = 4;
        indicator.style.left = left + 'px';
        indicator.style.top = top + 'px';
    }

    function formatValue(value) {
        if (!Number.isFinite(value)) return String(value);
        const abs = Math.abs(value);
        if (abs !== 0 && (abs < 0.001 || abs >= 1e6)) return value.toExponential(4);
        return (Math.round(value * 10000) / 10000).toString();
    }

    function worldSpacing(dataset) {
        if (!dataset) return null;
        const header = dataset.header || {};
        const xl = Number(header.xlength ?? header['x-length']);
        const yl = Number(header.ylength ?? header['y-length']);
        if (!(xl > 0) || !(yl > 0)) return null;
        const xu = String(header.xunit ?? header['x-unit'] ?? '').replace(/[\[\]]/g, '').trim();
        const yu = String(header.yunit ?? header['y-unit'] ?? '').replace(/[\[\]]/g, '').trim();
        if (xu && yu && xu !== yu) return null;
        return {
            dx: xl / Math.max(1, dataset.width - 1),
            dy: yl / Math.max(1, dataset.height - 1),
            unit: xu || yu || '',
        };
    }

    function imageToScreen(col, row, width, height) {
        return {
            x: (col - state.view.col) * state.view.scale + width / 2,
            y: (row - state.view.row) * state.view.scale + height / 2,
        };
    }

    function eventToCanvas(event, canvas) {
        const rect = canvas.getBoundingClientRect();
        const width = canvas.width || rect.width || 1;
        const height = canvas.height || rect.height || 1;
        return {
            sx: rect.width ? (event.clientX - rect.left) * (width / rect.width) : 0,
            sy: rect.height ? (event.clientY - rect.top) * (height / rect.height) : 0,
            width,
            height,
        };
    }

    function eventToImage(event, canvas) {
        const pos = eventToCanvas(event, canvas);
        return screenToImage(pos.sx, pos.sy, pos.width, pos.height);
    }

    function clampPoint(point) {
        const dataset = state.dataset;
        return {
            col: clamp(point.col, 0, Math.max(0, dataset.width - 1)),
            row: clamp(point.row, 0, Math.max(0, dataset.height - 1)),
        };
    }

    function clampLine(line) {
        const start = clampPoint({ col: line.c0, row: line.r0 });
        const end = clampPoint({ col: line.c1, row: line.r1 });
        return { c0: start.col, r0: start.row, c1: end.col, r1: end.row };
    }

    function lineLength(line) {
        return Math.hypot(line.c1 - line.c0, line.r1 - line.r0);
    }

    function measureSummary(line) {
        const dx = line.c1 - line.c0;
        const dy = line.r1 - line.r0;
        const dist = Math.hypot(dx, dy);
        const world = worldSpacing(state.dataset);
        let worldText = '';
        if (world) {
            const length = Math.hypot(dx * world.dx, dy * world.dy);
            worldText = formatValue(length) + (world.unit ? ' ' + world.unit : '');
        }
        return {
            dist,
            dx,
            dy,
            worldText,
            v0: sampleAt(Math.round(line.r0), Math.round(line.c0)),
            v1: sampleAt(Math.round(line.r1), Math.round(line.c1)),
        };
    }

    function measureMetaText() {
        const line = state.measure.line;
        if (!line) return '';
        const info = measureSummary(line);
        let text = t('measureDist') + ': ' + formatValue(info.dist) + ' ' + t('measureUnitPx')
            + ' · ' + t('measureDelta') + 'X: ' + formatValue(info.dx)
            + ' · ' + t('measureDelta') + 'Y: ' + formatValue(info.dy);
        if (info.worldText) text += ' · ' + t('measureWorld') + ': ' + info.worldText;
        text += ' · V₀: ' + formatValue(info.v0) + ' · V₁: ' + formatValue(info.v1);
        return text;
    }

    function currentSampleMode() {
        if (state.step === 0) return 'original';
        if (state.step === 1) return 'denoised';
        if (state.step === 2) return state.bumpMask && !state.peekOriginal ? 'pure' : 'denoised';
        if (state.step === 3) return state.profile.pane === 'base' ? 'base' : 'pure';
        if (isScatterView()) return 'scatter';
        return 'result';
    }

    function syncFoldChrome() {
        const layerOpen = !state.layerCollapsed;
        el.layerPanel.classList.toggle('is-collapsed', state.layerCollapsed);
        el.layerFold.setAttribute('aria-expanded', layerOpen ? 'true' : 'false');
        const layerLabel = t(layerOpen ? 'foldLayers' : 'expandLayers');
        el.layerFold.title = layerLabel;
        el.layerFold.setAttribute('aria-label', layerLabel);

        const mapOpen = !state.minimapCollapsed;
        el.minimap.classList.toggle('is-collapsed', state.minimapCollapsed);
        el.minimapFold.setAttribute('aria-expanded', mapOpen ? 'true' : 'false');
        const mapLabel = t(mapOpen ? 'foldMinimap' : 'expandMinimap');
        el.minimapFold.title = mapLabel;
        el.minimapFold.setAttribute('aria-label', mapLabel);

        const rawOpen = !state.rawHistCollapsed;
        el.rawHistPanel.classList.toggle('is-collapsed', state.rawHistCollapsed);
        el.rawHistFold.setAttribute('aria-expanded', rawOpen ? 'true' : 'false');
        const histSpec = isFilteredScatter() ? seriesViewSpec() : null;
        const rawLabel = t(rawOpen
            ? (histSpec ? histSpec.fold : 'foldRawHist')
            : (histSpec ? histSpec.expand : 'expandRawHist'));
        el.rawHistFold.title = rawLabel;
        el.rawHistFold.setAttribute('aria-label', rawLabel);
        if (histSpec) {
            const title = el.rawHistFold.querySelector('.fold-bar-title');
            if (title) {
                title.setAttribute('data-i18n', 'bc.' + histSpec.histTitle);
                title.textContent = t(histSpec.histTitle);
            }
            const axis = document.getElementById('bcRawHistAxisLabel');
            if (axis) {
                axis.setAttribute('data-i18n', 'bc.' + histSpec.histAxis);
                axis.textContent = t(histSpec.histAxis);
            }
            const extreme = document.getElementById('bcRawExtremeLabel');
            if (extreme) {
                extreme.setAttribute('data-i18n', 'bc.' + histSpec.extremeToggle);
                extreme.textContent = t(histSpec.extremeToggle);
            }
        }

        const detailOpen = !state.bumpDetailCollapsed;
        el.bumpDetailPanel.classList.toggle('is-collapsed', state.bumpDetailCollapsed);
        el.bumpDetailFold.setAttribute('aria-expanded', detailOpen ? 'true' : 'false');
        const detailLabel = t(detailOpen ? 'foldBumpDetail' : 'expandBumpDetail');
        el.bumpDetailFold.title = detailLabel;
        el.bumpDetailFold.setAttribute('aria-label', detailLabel);
    }

    function bumpDetailZText(value) {
        return Number.isFinite(value) ? value.toFixed(6) : '—';
    }

    function bumpDetailWithUnit(value) {
        const text = bumpDetailZText(value);
        const unit = ((state.result && state.result.z_unit) || axisUnit('z') || '').trim();
        return unit && text !== '—' ? text + ' ' + unit : text;
    }

    function selectedBumpDetail() {
        const index = state.selectedBump;
        const result = state.result;
        const point = state.centers[index];
        if (index < 0 || !result || !point) return null;
        const row = Math.round(point.row);
        const col = Math.round(point.col);
        const pixels = collectBumpPixels(row, col);
        const donut = collectDonutPixels(pixels, Number(el.donutWidth.value));
        const apex = result.apexes && result.apexes[index] ? Number(result.apexes[index][2]) : NaN;
        const delta = Number(result.delta_z && result.delta_z[index]);
        const storedMedian = seriesNumber(result.donut_median, index);
        const computedMedian = medianOf(donut.map((pixel) => pixel.z));
        return {
            index,
            row,
            col,
            pixels,
            donut,
            apexZ: apex,
            baseZ: Number.isFinite(apex) && Number.isFinite(delta) ? apex - delta : NaN,
            donutMedian: donut.length ? computedMedian : storedMedian,
        };
    }

    function bumpDetailPixelKey(pixel) {
        return pixel.r + ':' + pixel.c;
    }

    function bumpDetailMedianKeys(pixels) {
        const finite = [];
        for (let i = 0; i < pixels.length; i++) {
            if (Number.isFinite(pixels[i].z)) finite.push(pixels[i]);
        }
        const keys = new Set();
        if (!finite.length) return keys;
        finite.sort((a, b) => a.z - b.z || a.r - b.r || a.c - b.c);
        const mid = finite.length >> 1;
        keys.add(bumpDetailPixelKey(finite[mid]));
        if ((finite.length & 1) === 0) keys.add(bumpDetailPixelKey(finite[mid - 1]));
        return keys;
    }

    function fillBumpValueTable(container, pixels, options) {
        const settings = options || {};
        const sort = settings.sort || { key: '', dir: 1 };
        const apex = settings.apex || null;
        const medianKeys = settings.medianKeys || null;
        const scroll = container.scrollTop;
        container.replaceChildren();
        if (!pixels.length) {
            const empty = document.createElement('p');
            empty.className = 'bump-detail-none';
            empty.textContent = t('bumpDetailNone');
            container.appendChild(empty);
            return;
        }
        const zOf = (pixel) => {
            if (apex && pixel.r === apex.r && pixel.c === apex.c && Number.isFinite(apex.z)) return apex.z;
            return pixel.z;
        };
        const rows = pixels.slice();
        if (sort.key === 'r' || sort.key === 'c' || sort.key === 'z') {
            const dir = sort.dir === -1 ? -1 : 1;
            rows.sort((a, b) => {
                const av = sort.key === 'z' ? zOf(a) : a[sort.key];
                const bv = sort.key === 'z' ? zOf(b) : b[sort.key];
                const aOk = Number.isFinite(av);
                const bOk = Number.isFinite(bv);
                if (aOk !== bOk) return aOk ? -1 : 1;
                if (aOk && av !== bv) return av < bv ? -dir : dir;
                if (a.r !== b.r) return a.r - b.r;
                return a.c - b.c;
            });
        }
        const table = document.createElement('table');
        const head = document.createElement('thead');
        const headRow = document.createElement('tr');
        [
            { key: 'r', label: t('bumpDetailColRow') },
            { key: 'c', label: t('bumpDetailColCol') },
            { key: 'z', label: 'Z' },
        ].forEach((column) => {
            const cell = document.createElement('th');
            const active = sort.key === column.key;
            const dir = sort.dir === -1 ? -1 : 1;
            cell.setAttribute('aria-sort', active ? (dir > 0 ? 'ascending' : 'descending') : 'none');
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'sort-btn' + (active ? ' active' : '');
            button.title = t('bumpDetailSortTitle', column.label);
            const label = document.createElement('span');
            label.className = 'sort-label';
            label.textContent = column.label;
            button.appendChild(label);
            const mark = document.createElement('span');
            mark.className = 'sort-mark' + (active ? '' : ' is-idle');
            mark.setAttribute('aria-hidden', 'true');
            mark.textContent = active && dir < 0 ? '▼' : '▲';
            button.appendChild(mark);
            button.addEventListener('click', () => {
                if (sort.key === column.key) sort.dir = dir > 0 ? -1 : 1;
                else {
                    sort.key = column.key;
                    sort.dir = 1;
                }
                fillBumpValueTable(container, pixels, settings);
                container.scrollTop = 0;
            });
            cell.appendChild(button);
            headRow.appendChild(cell);
        });
        const markHead = document.createElement('th');
        headRow.appendChild(markHead);
        head.appendChild(headRow);
        const body = document.createElement('tbody');
        const fragment = document.createDocumentFragment();
        rows.forEach((pixel) => {
            const row = document.createElement('tr');
            const isApex = !!(apex && pixel.r === apex.r && pixel.c === apex.c);
            const isMedian = !!(medianKeys && medianKeys.has(bumpDetailPixelKey(pixel)));
            if (isApex) row.className = 'is-apex';
            else if (isMedian) row.className = 'is-median';
            const note = isApex ? t('bumpDetailApexMark') : (isMedian ? t('bumpDetailMedianMark') : '');
            [String(pixel.r), String(pixel.c), bumpDetailZText(zOf(pixel)), note].forEach((text) => {
                const cell = document.createElement('td');
                cell.textContent = text;
                row.appendChild(cell);
            });
            fragment.appendChild(row);
        });
        body.appendChild(fragment);
        table.appendChild(head);
        table.appendChild(body);
        container.appendChild(table);
        container.scrollTop = scroll;
    }

    let bumpDetailBoxKey = '';
    function syncBumpDetailBox() {
        const panel = el.bumpDetailPanel;
        if (!panel) return;
        const key = [
            panel.hidden ? 0 : 1,
            state.bumpDetailCollapsed ? 1 : 0,
            el.bumpDetailContent && !el.bumpDetailContent.hidden ? 1 : 0,
        ].join(':');
        if (key === bumpDetailBoxKey) return;
        bumpDetailBoxKey = key;
        requestRender();
    }

    function renderBumpDetail() {
        const show = state.step === 4 && !!state.result && state.showBumpDetail;
        el.bumpDetailPanel.hidden = !show;
        el.bumpDetailToggle.hidden = !(state.step === 4 && state.result);
        el.showBumpDetail.checked = state.showBumpDetail;
        if (!show) {
            bumpDetailRenderKey = '';
            syncBumpDetailBox();
            return;
        }
        const widthPx = Number(el.donutWidth.value);
        const key = state.resultSerial + ':' + state.selectedBump + ':' + widthPx;
        if (key === bumpDetailRenderKey) return;
        bumpDetailRenderKey = key;
        const detail = selectedBumpDetail();
        if (!detail) {
            el.bumpDetailStats.textContent = '';
            el.bumpDetailEmpty.hidden = false;
            el.bumpDetailEmpty.textContent = t('bumpDetailEmpty');
            el.bumpDetailContent.hidden = true;
            syncBumpDetailBox();
            return;
        }
        el.bumpDetailEmpty.hidden = true;
        el.bumpDetailContent.hidden = false;
        el.bumpDetailStats.textContent = '#' + (detail.index + 1);
        el.bumpDetailApexValue.textContent = bumpDetailWithUnit(detail.apexZ);
        el.bumpDetailBaseValue.textContent = bumpDetailWithUnit(detail.baseZ);
        el.bumpDetailMedianValue.textContent = bumpDetailWithUnit(detail.donutMedian);
        el.bumpDetailZTitle.textContent = t('bumpDetailBumpZ', detail.pixels.length);
        el.bumpDetailDonutTitle.textContent = t('bumpDetailDonutZ', detail.donut.length);
        fillBumpValueTable(el.bumpDetailZ, detail.pixels, {
            sort: bumpDetailSort.bump,
            apex: { r: detail.row, c: detail.col, z: detail.apexZ },
        });
        fillBumpValueTable(el.bumpDetailDonut, detail.donut, {
            sort: bumpDetailSort.donut,
            medianKeys: bumpDetailMedianKeys(detail.donut),
        });
        syncBumpDetailBox();
    }

    function syncOverlayUi() {
        const hasImage = !!state.dataset;
        el.viewerTools.hidden = !hasImage;
        el.viewer.classList.toggle('measure-mode', hasImage && state.tool === 'measure');
        el.viewer.classList.toggle('step-mode', hasImage && state.tool === 'step');
        el.viewer.classList.toggle('inspect-mode', hasImage && state.tool === 'inspect');
        el.btnPan.classList.toggle('active', state.tool === 'pan');
        el.btnInspect.classList.toggle('active', state.tool === 'inspect');
        el.btnMeasure.classList.toggle('active', state.tool === 'measure');
        el.btnStep.classList.toggle('active', state.tool === 'step');
        if (state.tool !== 'inspect') el.valueIndicator.classList.remove('show');
        el.btnMeasureClear.disabled =
            !state.measure.line && !state.profile.line && !profileHasMeasures();
        const showPanel = hasImage && !!state.measure.line;
        el.measurePanel.hidden = !showPanel;
        if (showPanel) el.measureMeta.textContent = measureMetaText();
        const canPeek = state.step === 2 && hasImage && !!state.bumpMask;
        el.btnPeek.hidden = !canPeek;
        el.btnPeek.textContent = state.peekOriginal ? t('peekHide') : t('peekShow');
        el.btnPeek.setAttribute('aria-pressed', state.peekOriginal ? 'true' : 'false');
        el.btnPeek.classList.toggle('active', canPeek && state.peekOriginal);
        el.peekBadge.hidden = !(canPeek && state.peekOriginal);
        const onResult = state.step === 4 && !!state.dataset;
        const onMap = onResult && state.resultView === 'map';
        const onFiltered = onResult && isFilteredScatter() && !!state.result;
        el.layerPanel.hidden = !onResult || (isFilteredScatter() && !state.result);
        el.layerPanel.classList.toggle('scatter-h', state.resultView === 'h');
        el.layerPanel.classList.toggle('scatter-raw', onFiltered);
        el.layerRawFiltered.hidden = !onFiltered;
        el.layerRawExtreme.hidden = !onFiltered;
        if (onFiltered) {
            const spec = seriesViewSpec();
            el.showRawFiltered.checked = state[spec.filtered];
            el.showRawExtremes.checked = state[spec.extremes];
        }
        syncFoldChrome();
        if (showPanel && onResult && !el.layerPanel.hidden) el.measurePanel.style.top = (el.layerPanel.offsetHeight + 20) + 'px';
        else el.measurePanel.style.top = '';
        el.layerBump.checked = state.layers.bump;
        el.layerDonut.checked = state.layers.donut;
        el.layerDenoise.checked = state.layers.denoise;
        el.layerRejected.checked = state.layers.rejected;
        el.residualToggle.hidden = !(onMap && state.result);
        el.showResiduals.checked = state.showResiduals;
        el.heightExtremeToggle.hidden = !(state.result && (onMap || state.resultView === 'h'));
        syncResultViewTabs();
        syncColorbarTitle();
        el.showHeightExtremes.checked = state.showHeightExtremes;
        renderBumpDetail();
        el.btnFocusClear.disabled = state.selectedBump < 0;
        const showProfile = hasImage && !!state.profile.data;
        el.profilePanel.hidden = !showProfile;
        syncProfileMeasureUi();
        if (state.peekOriginal && el.measurePanel && !el.measurePanel.hidden) {
            el.peekBadge.style.top = (el.measurePanel.offsetHeight + 20) + 'px';
        } else {
            el.peekBadge.style.top = '';
        }
    }

    function clearMeasure(renderNow) {
        state.measure.drawing = false;
        state.measure.line = null;
        state.measure.editStart = null;
        state.measure.hover = null;
        state.measure.hoverCanvas = null;
        state.measuring = null;
        if (renderNow !== false) {
            syncOverlayUi();
            requestRender();
        }
    }

    function pointInBox(px, py, box, pad) {
        const extra = pad || 0;
        const x = box.x != null ? box.x : box.left;
        const y = box.y != null ? box.y : box.top;
        const w = box.w != null ? box.w : box.width;
        const h = box.h != null ? box.h : box.height;
        return px >= x - extra && py >= y - extra && px <= x + w + extra && py <= y + h + extra;
    }

    function placeDeleteButton(bounds, width, height) {
        const size = MEASURE_DELETE_SIZE;
        const gap = 5;
        const margin = 2;
        let x = bounds.right + gap;
        let y = (bounds.top + bounds.bottom - size) / 2;
        if (x + size > width - margin) x = bounds.right - size;
        x = clamp(x, margin, Math.max(margin, width - margin - size));
        y = clamp(y, margin, Math.max(margin, height - margin - size));
        return { x: x, y: y, w: size, h: size };
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
        const button = placeDeleteButton(
            { left: x, top: y, right: x + clearance, bottom: y },
            width,
            height,
        );
        const x0 = Math.min(x, button.x) - 6;
        const y0 = Math.min(y, button.y) - 8;
        const x1 = Math.max(x, button.x + button.w) + 2;
        const y1 = Math.max(y, button.y + button.h) + 8;
        return {
            button: button,
            bridge: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
        };
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

    function measureDecor(ctx, line, width, height) {
        const start = imageToScreen(line.c0, line.r0, width, height);
        const end = imageToScreen(line.c1, line.r1, width, height);
        const info = measureSummary(line);
        const labels = [formatValue(info.dist) + ' ' + t('measureUnitPx')];
        if (info.worldText) labels.push(info.worldText);
        ctx.save();
        ctx.font = '12px Consolas, monospace';
        let boxW = 0;
        labels.forEach((label) => {
            boxW = Math.max(boxW, ctx.measureText(label).width);
        });
        ctx.restore();
        boxW += 10;
        const boxH = labels.length * 16 + 4;
        const midX = (start.x + end.x) * 0.5;
        const midY = (start.y + end.y) * 0.5;
        const label = { x: midX - boxW * 0.5, y: midY - boxH - 6, w: boxW, h: boxH };
        const anchor = rightmostAnchor([
            { x: start.x, y: start.y, clearance: 12 },
            { x: end.x, y: end.y, clearance: 12 },
            { x: label.x + label.w, y: label.y + label.h / 2, clearance: 0 },
        ]);
        const attached = attachDeleteButton(anchor.x, anchor.y, anchor.clearance, width, height);
        return {
            start: start,
            end: end,
            labels: labels,
            label: label,
            button: attached.button,
            bridge: attached.bridge,
        };
    }

    function drawMeasureOverlay(canvas) {
        const line = state.measure.line;
        if (!line || !state.dataset) return;
        const width = canvas.width;
        const height = canvas.height;
        const ctx = canvas.getContext('2d', { alpha: false });
        const decor = measureDecor(ctx, line, width, height);
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
        ctx.strokeStyle = '#3ecf8e';
        ctx.lineWidth = 2;
        ctx.stroke();
        for (const point of [start, end]) {
            ctx.beginPath();
            ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#3ecf8e';
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#fff';
            ctx.stroke();
        }
        const labelBox = decor.label;
        ctx.font = '12px Consolas, monospace';
        ctx.fillStyle = 'rgba(0,0,0,0.72)';
        ctx.fillRect(labelBox.x, labelBox.y, labelBox.w, labelBox.h);
        ctx.fillStyle = '#3ecf8e';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        decor.labels.forEach((label, index) => {
            ctx.fillText(label, labelBox.x + labelBox.w / 2, labelBox.y + 10 + index * 16);
        });
        ctx.textAlign = 'left';
        if (state.measure.hover && state.measure.hoverCanvas === canvas && !state.measuring && !state.panning) {
            drawDeleteButton(ctx, decor.button, state.measure.hover === 'delete');
        }
    }

    function measureHit(event, canvas) {
        const line = state.measure.line;
        if (!line) return null;
        const pos = eventToCanvas(event, canvas);
        const start = imageToScreen(line.c0, line.r0, pos.width, pos.height);
        const end = imageToScreen(line.c1, line.r1, pos.width, pos.height);
        const radius = 10;
        if (Math.hypot(pos.sx - start.x, pos.sy - start.y) <= radius) return 'ep0';
        if (Math.hypot(pos.sx - end.x, pos.sy - end.y) <= radius) return 'ep1';
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const len2 = dx * dx + dy * dy;
        if (len2 > 0) {
            let tHit = ((pos.sx - start.x) * dx + (pos.sy - start.y) * dy) / len2;
            if (tHit < 0) tHit = 0;
            else if (tHit > 1) tHit = 1;
            const px = start.x + tHit * dx;
            const py = start.y + tHit * dy;
            if (Math.hypot(pos.sx - px, pos.sy - py) <= radius) return 'move';
        }
        return null;
    }

    function measurePointerTarget(event, canvas) {
        const line = state.measure.line;
        if (!line || !state.dataset || state.measuring) return null;
        const pos = eventToCanvas(event, canvas);
        const decor = measureDecor(canvas.getContext('2d', { alpha: false }), line, pos.width, pos.height);
        if (pointInBox(pos.sx, pos.sy, decor.button, 3)) return 'delete';
        if (pointInBox(pos.sx, pos.sy, decor.bridge, 0)) return 'body';
        if (pointInBox(pos.sx, pos.sy, decor.label, 2)) return 'body';
        if (measureHit(event, canvas)) return 'body';
        return null;
    }

    function setMeasureHover(canvas, target) {
        if (target) {
            const changed = state.measure.hover !== target || state.measure.hoverCanvas !== canvas;
            state.measure.hover = target;
            state.measure.hoverCanvas = canvas;
            return changed;
        }
        if (state.measure.hoverCanvas !== canvas) return false;
        state.measure.hover = null;
        state.measure.hoverCanvas = null;
        return true;
    }

    function beginMeasure(event, canvas) {
        state.measure.hover = null;
        state.measure.hoverCanvas = null;
        state.profile.lineHover = null;
        state.profile.lineHoverCanvas = null;
        const point = clampPoint(eventToImage(event, canvas));
        const hit = state.measure.line ? measureHit(event, canvas) : null;
        capturePointer(canvas, event.pointerId);
        if (hit) {
            state.measuring = { id: event.pointerId, mode: hit, canvas };
            state.measure.drawing = false;
            state.measure.editStart = { point, line: Object.assign({}, state.measure.line) };
        } else {
            state.measuring = { id: event.pointerId, mode: 'draw', canvas };
            state.measure.drawing = true;
            state.measure.editStart = null;
            state.measure.line = { c0: point.col, r0: point.row, c1: point.col, r1: point.row };
        }
        syncOverlayUi();
        render();
    }

    function moveMeasure(event) {
        const canvas = state.measuring.canvas || el.canvas;
        const point = clampPoint(eventToImage(event, canvas));
        const mode = state.measuring.mode;
        if (mode === 'draw') {
            state.measure.line.c1 = point.col;
            state.measure.line.r1 = point.row;
        } else if (state.measure.editStart) {
            const origin = state.measure.editStart;
            const dc = point.col - origin.point.col;
            const dr = point.row - origin.point.row;
            const src = origin.line;
            if (mode === 'ep0') {
                state.measure.line = clampLine({ c0: src.c0 + dc, r0: src.r0 + dr, c1: src.c1, r1: src.r1 });
            } else if (mode === 'ep1') {
                state.measure.line = clampLine({ c0: src.c0, r0: src.r0, c1: src.c1 + dc, r1: src.r1 + dr });
            } else {
                state.measure.line = clampLine({
                    c0: src.c0 + dc,
                    r0: src.r0 + dr,
                    c1: src.c1 + dc,
                    r1: src.r1 + dr,
                });
            }
        }
        syncOverlayUi();
        requestRender();
    }

    function finishMeasure() {
        const line = state.measure.line;
        const mode = state.measuring && state.measuring.mode;
        state.measure.drawing = false;
        if (!line || lineLength(line) < 1) {
            if (mode && mode !== 'draw' && state.measure.editStart) {
                state.measure.line = Object.assign({}, state.measure.editStart.line);
            } else {
                state.measure.line = null;
            }
        }
        state.measure.editStart = null;
        state.measuring = null;
        syncOverlayUi();
        requestRender();
    }

    function hoverMeasure(event, canvas) {
        if (state.tool !== 'measure' || !state.dataset) return;
        if (!state.measure.line || state.measuring) {
            canvas.style.cursor = '';
            return;
        }
        const hit = measureHit(event, canvas);
        if (hit === 'ep0' || hit === 'ep1') canvas.style.cursor = 'pointer';
        else if (hit === 'move') canvas.style.cursor = 'move';
        else canvas.style.cursor = '';
    }

    function capturePointer(target, pointerId) {
        try { target.setPointerCapture(pointerId); } catch (_) { /* 指標可能已經放開 */ }
    }

    function togglePeek() {
        if (!state.bumpMask || state.step !== 2) return;
        state.peekOriginal = !state.peekOriginal;
        syncOverlayUi();
        if (state.profile.line) profileRecompute(false);
        else render();
    }

    function stepStyle(index) {
        return STEP_STYLES[((index % STEP_STYLES.length) + STEP_STYLES.length) % STEP_STYLES.length];
    }

    function profileStepUnit() {
        return axisUnit('z');
    }

    function profileDistInfo(distPx) {
        const line = state.profile.line;
        const world = worldSpacing(state.dataset);
        const pxText = formatValue(distPx) + ' ' + t('measureUnitPx');
        if (!world || !line) return { text: pxText, pxText: null };
        const lenPx = Math.hypot(line.c1 - line.c0, line.r1 - line.r0);
        if (!(lenPx > 0)) return { text: pxText, pxText: null };
        const perPx = Math.hypot((line.c1 - line.c0) / lenPx * world.dx, (line.r1 - line.r0) / lenPx * world.dy);
        if (!(perPx > 0)) return { text: pxText, pxText: null };
        return {
            text: formatValue(distPx * perPx) + (world.unit ? ' ' + world.unit : ''),
            pxText,
        };
    }

    function profileMeasureResult(pts, data) {
        if (!data || !pts || pts.length < 2) return null;
        const i0 = pts[0];
        const i1 = pts[1];
        if (!Number.isFinite(data.vals[i0]) || !Number.isFinite(data.vals[i1])) return null;
        return {
            i0,
            i1,
            dist: Math.abs(data.dist[i1] - data.dist[i0]),
            step: Math.abs(data.vals[i1] - data.vals[i0]),
        };
    }

    function profileHasMeasures() {
        return state.profile.measureSets.length > 0 || state.profile.measurePts.length > 0;
    }

    function syncProfileChartStyle() {
        const wrap = el.profileChartStyle;
        if (!wrap) return;
        wrap.querySelectorAll('button[data-profile-chart]').forEach((btn) => {
            const on = btn.getAttribute('data-profile-chart') === profileChartStyle;
            btn.classList.toggle('active', on);
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    }

    function syncProfileMeasureUi() {
        const profile = state.profile;
        const atMax = profile.measureSets.length >= STEP_MAX_SETS;
        el.profileMeasureBtn.classList.toggle('active', profile.measureMode);
        el.profileMeasureBtn.disabled = !profile.data || (!profile.measureMode && atMax);
        el.profileMeasureClearBtn.disabled = !profileHasMeasures();
        el.profilePlot.classList.toggle('measure-mode', profile.measureMode);
    }

    function profileIndexPixel(line, index, count) {
        const dx = line.c1 - line.c0;
        const dy = line.r1 - line.r0;
        const tt = count > 1 ? index / (count - 1) : 0;
        return {
            row: Math.round(line.r0 + dy * tt),
            col: Math.round(line.c0 + dx * tt),
        };
    }

    function profileSample(line) {
        const dx = line.c1 - line.c0;
        const dy = line.r1 - line.r0;
        const distPx = Math.hypot(dx, dy);
        const count = Math.max(2, Math.ceil(distPx));
        const dist = new Float32Array(count);
        const vals = new Float32Array(count);
        let vmin = Infinity;
        let vmax = -Infinity;
        let anyValid = false;
        const mode = currentSampleMode();
        for (let i = 0; i < count; i++) {
            const tt = count > 1 ? i / (count - 1) : 0;
            const pixel = profileIndexPixel(line, i, count);
            const value = mode === 'scatter'
                ? scatterValueNear(pixel.row, pixel.col)
                : sampleFor(mode, pixel.row, pixel.col);
            dist[i] = distPx * tt;
            vals[i] = value;
            if (!Number.isFinite(value)) continue;
            anyValid = true;
            if (value < vmin) vmin = value;
            if (value > vmax) vmax = value;
        }
        if (!anyValid) {
            vmin = 0;
            vmax = 1;
        } else if (vmin === vmax) {
            vmin -= 0.5;
            vmax += 0.5;
        }
        return { dist, vals, vmin, vmax, distPx, count, anyValid };
    }

    function profileClearMeasures(renderChart) {
        state.profile.measureSets = [];
        state.profile.measurePts = [];
        state.profile.measureMode = false;
        state.profile.hoverIndex = null;
        state.profile.hoverMeasure = null;
        state.profile.measureDrag = null;
        profileMeasureLayouts = [];
        el.profileTip.classList.remove('show');
        if (renderChart !== false && state.profile.data) renderProfileChart();
        if (renderChart !== false) logStepMeasures();
    }

    function deleteProfileMeasure(key) {
        if (key === 'draft') state.profile.measurePts = [];
        else if (typeof key === 'number' && state.profile.measureSets[key]) state.profile.measureSets.splice(key, 1);
        else return;
        state.profile.hoverMeasure = null;
        state.profile.hoverIndex = null;
        el.profileTip.classList.remove('show');
        syncOverlayUi();
        renderProfileChart();
        drawProfileOverlay();
        if (key !== 'draft') logStepMeasures();
    }

    function clearProfile(renderNow) {
        state.profile.drawing = false;
        state.profile.editStart = null;
        state.profile.line = null;
        state.profile.data = null;
        state.profile.geom = null;
        state.profile.hoverIndex = null;
        state.profile.lineHover = null;
        state.profile.lineHoverCanvas = null;
        state.profiling = null;
        profileClearMeasures(false);
        el.profileTip.classList.remove('show');
        if (renderNow !== false) {
            syncOverlayUi();
            requestRender();
        }
    }

    function profileRecompute(notify) {
        const line = state.profile.line;
        if (!line || !state.dataset) return;
        if (state.layers.donut || currentSampleMode() === 'base') ensureDonutMask();
        const data = profileSample(line);
        state.profile.data = data;
        if (state.profile.hoverIndex != null && state.profile.hoverIndex >= data.count) {
            state.profile.hoverIndex = null;
        }
        if (notify && !data.anyValid) showToast(t('profileNoValid'), 'info');
        syncOverlayUi();
        renderProfileChart();
        requestRender();
        if (state.profile.measureSets.length) logStepMeasures();
    }

    function traceNum(value) {
        return Number.isFinite(value) ? value : null;
    }

    function tracePixel(index) {
        const data = state.profile.data;
        const pixel = profileIndexPixel(state.profile.line, index, data.count);
        const original = sampleAt(pixel.row, pixel.col);
        const abs = rangeAbs();
        const finite = Number.isFinite(original);
        const inRange = finite && original >= abs.z_lo && original <= abs.z_hi;
        const bump = inRange && maskAt(state.bumpMask, pixel.row, pixel.col);
        const donut = maskAt(state.donutMask, pixel.row, pixel.col);
        let layer = 'invalid';
        if (finite && bump) layer = 'bump';
        else if (finite && donut) layer = 'donut';
        else if (inRange) layer = 'rejected';
        else if (finite) layer = 'out-of-range';
        return {
            index,
            row: pixel.row,
            col: pixel.col,
            z: traceNum(data.vals[index]),
            original: traceNum(original),
            layer,
            shown: Number.isFinite(data.vals[index]),
        };
    }

    function logStepMeasures() {
        if (!state.sessionId || !state.result || !state.profile.line || !state.profile.data) return;
        ensureDonutMask();
        const abs = rangeAbs();
        const line = state.profile.line;
        const body = {
            session_id: state.sessionId,
            z_lo: abs.z_lo,
            z_hi: abs.z_hi,
            donut_width_px: Number(el.donutWidth.value),
            layers: {
                bump: state.layers.bump,
                donut: state.layers.donut,
                denoise: state.layers.denoise,
                rejected: state.layers.rejected,
            },
            line: { c0: line.c0, r0: line.r0, c1: line.c1, r1: line.r1 },
            measures: state.profile.measureSets.map((set) => ({
                points: set.pts.map((index) => tracePixel(index)),
            })),
        };
        Api.heightTrace(body).then((res) => {
            if (res && res.line && body.measures.length) console.info(res.line);
        }).catch((error) => {
            console.warn(error && error.message ? error.message : error);
        });
    }

    function profileMetaText() {
        const data = state.profile.data;
        if (!data) return '';
        const parts = [
            t('profileLength') + ': ' + data.distPx.toFixed(1) + ' ' + t('measureUnitPx'),
            t('profileSamples') + ': ' + data.count,
            t('profileRange') + ': ' + formatValue(data.vmin) + ' ~ ' + formatValue(data.vmax),
        ];
        const many = state.profile.measureSets.length > 1;
        state.profile.measureSets.forEach((set, index) => {
            const result = profileMeasureResult(set.pts, data);
            if (!result) return;
            const dist = profileDistInfo(result.dist);
            let text = (many ? '#' + (index + 1) + ' ' : '') + t('measureDist') + ' ' + dist.text;
            if (dist.pxText) text += ' (' + dist.pxText + ')';
            const unit = profileStepUnit();
            text += ' · ' + t('profileMeasureStep') + ' ' + formatValue(result.step) + (unit ? ' ' + unit : '');
            parts.push(text);
        });
        return parts.join(' · ');
    }

    function profileChartPoint(data, geom, index) {
        const value = data.vals[index];
        if (!Number.isFinite(value)) return null;
        const span = (geom.vmax - geom.vmin) || 1;
        return {
            px: geom.padL + (data.dist[index] / (data.distPx || 1)) * geom.plotW,
            py: geom.padT + (1 - (value - geom.vmin) / span) * geom.plotH,
        };
    }

    function profileChartPick(mx, my) {
        const data = state.profile.data;
        const geom = state.profile.geom;
        if (!data || !geom) return null;
        let best = -1;
        let bestDist = Infinity;
        const limit = STEP_CHART_PICK * STEP_CHART_PICK;
        for (let i = 0; i < data.count; i++) {
            const point = profileChartPoint(data, geom, i);
            if (!point) continue;
            const dist = (mx - point.px) * (mx - point.px) + (my - point.py) * (my - point.py);
            if (dist < bestDist) {
                bestDist = dist;
                best = i;
            }
        }
        return bestDist <= limit ? best : null;
    }

    function profileChartNearest(mx, my) {
        const data = state.profile.data;
        const geom = state.profile.geom;
        if (!data || !geom) return null;
        let best = -1;
        let bestDist = Infinity;
        for (let i = 0; i < data.count; i++) {
            const point = profileChartPoint(data, geom, i);
            if (!point) continue;
            const dist = (mx - point.px) * (mx - point.px) + (my - point.py) * (my - point.py);
            if (dist < bestDist) {
                bestDist = dist;
                best = i;
            }
        }
        return best >= 0 ? best : null;
    }

    function profileIndexTaken(index) {
        if (state.profile.measurePts.includes(index)) return true;
        return state.profile.measureSets.some((set) => set.pts.includes(index));
    }

    function profileMeasureHit(mx, my) {
        const data = state.profile.data;
        const geom = state.profile.geom;
        if (!data || !geom) return null;
        const limit = STEP_HIT_RADIUS * STEP_HIT_RADIUS;
        let best = null;
        let bestDist = Infinity;
        const consider = (setKey, pts) => {
            pts.forEach((index, ptIndex) => {
                const point = profileChartPoint(data, geom, index);
                if (!point) return;
                const dist = (mx - point.px) * (mx - point.px) + (my - point.py) * (my - point.py);
                if (dist <= limit && dist < bestDist) {
                    bestDist = dist;
                    best = { setKey, ptIndex };
                }
            });
        };
        state.profile.measureSets.forEach((set, index) => consider(index, set.pts));
        consider('draft', state.profile.measurePts);
        return best;
    }

    function profileMeasurePts(setKey) {
        if (setKey === 'draft') return state.profile.measurePts;
        const set = state.profile.measureSets[setKey];
        return set ? set.pts : null;
    }

    function profileLabelBox(ctx, text, x, y, align) {
        ctx.font = '11px Consolas, monospace';
        const width = ctx.measureText(text).width + 10;
        const height = 16;
        let left = x;
        if (align === 'center') left -= width / 2;
        else if (align === 'right') left -= width;
        return { text, left, top: y - height / 2, width, height };
    }

    function clampProfileLabel(box, bounds) {
        box.left = clamp(box.left, bounds.x, Math.max(bounds.x, bounds.x + bounds.w - box.width));
        box.top = clamp(box.top, bounds.y, Math.max(bounds.y, bounds.y + bounds.h - box.height));
        return box;
    }

    function profileLabelsOverlap(a, b) {
        return !(a.left + a.width + 4 <= b.left || b.left + b.width + 4 <= a.left
            || a.top + a.height + 4 <= b.top || b.top + b.height + 4 <= a.top);
    }

    function paintProfileLabel(ctx, box, color) {
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

    function distToSegment(px, py, x0, y0, x1, y1) {
        const dx = x1 - x0;
        const dy = y1 - y0;
        const len2 = dx * dx + dy * dy;
        if (len2 <= 0) return Math.hypot(px - x0, py - y0);
        const t = clamp(((px - x0) * dx + (py - y0) * dy) / len2, 0, 1);
        return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
    }

    function profileMeasureLayout(ctx, data, geom, pts, setNum) {
        const p0 = profileChartPoint(data, geom, pts[0]);
        const p1 = pts.length > 1 ? profileChartPoint(data, geom, pts[1]) : null;
        if (!p0 && !p1) return null;
        const labels = [];
        let corner = null;
        if (pts.length === 2 && p0 && p1) {
            corner = { px: p1.px, py: p0.py };
            const result = profileMeasureResult(pts, data);
            if (result) {
                const prefix = setNum != null ? '#' + setNum + ' ' : '';
                const dist = profileDistInfo(result.dist);
                let distText = prefix + t('measureDist') + ' ' + dist.text;
                if (dist.pxText) distText += ' (' + dist.pxText + ')';
                const unit = profileStepUnit();
                const stepText = prefix + t('profileMeasureStep') + ' ' + formatValue(result.step) + (unit ? ' ' + unit : '');
                const distX = (p0.px + corner.px) / 2;
                const stepY = (corner.py + p1.py) / 2;
                const above = p0.py - geom.padT > 22 ? -14 : 14;
                const roomRight = geom.padL + geom.plotW - corner.px;
                const roomLeft = corner.px - geom.padL;
                const side = roomRight >= roomLeft ? 10 : -10;
                const frame = { x: 4, y: 4, w: geom.width - 8, h: geom.height - 8 };
                const distBox = clampProfileLabel(profileLabelBox(ctx, distText, distX, p0.py + above, 'center'), frame);
                let stepBox = clampProfileLabel(
                    profileLabelBox(ctx, stepText, corner.px + side, stepY, side > 0 ? 'left' : 'right'),
                    frame,
                );
                if (profileLabelsOverlap(distBox, stepBox)) {
                    stepBox.top = clamp(distBox.top + distBox.height + 4, frame.y, frame.y + frame.h - stepBox.height);
                }
                labels.push(distBox, stepBox);
            }
        }
        const candidates = [];
        if (p0) candidates.push({ x: p0.px, y: p0.py, clearance: 12 });
        if (p1) candidates.push({ x: p1.px, y: p1.py, clearance: 12 });
        if (corner) candidates.push({ x: corner.px, y: corner.py, clearance: 8 });
        labels.forEach((label) => {
            candidates.push({
                x: label.left + label.width,
                y: label.top + label.height / 2,
                clearance: 0,
            });
        });
        if (!candidates.length) return null;
        const anchor = rightmostAnchor(candidates);
        const attached = attachDeleteButton(anchor.x, anchor.y, anchor.clearance, geom.width, geom.height);
        return {
            p0: p0,
            p1: p1,
            corner: corner,
            labels: labels,
            button: attached.button,
            bridge: attached.bridge,
        };
    }

    function profileLayoutBodyDist(mx, my, item) {
        if (pointInBox(mx, my, item.bridge, 0)) return 0;
        let best = Infinity;
        const near = (point) => {
            if (!point) return;
            best = Math.min(best, Math.hypot(mx - point.px, my - point.py));
        };
        near(item.p0);
        near(item.p1);
        if (item.p0 && item.corner) {
            best = Math.min(best, distToSegment(mx, my, item.p0.px, item.p0.py, item.corner.px, item.corner.py));
        }
        if (item.corner && item.p1) {
            best = Math.min(best, distToSegment(mx, my, item.corner.px, item.corner.py, item.p1.px, item.p1.py));
        }
        for (let i = 0; i < item.labels.length; i++) {
            if (pointInBox(mx, my, item.labels[i], 2)) return 0;
        }
        return best <= STEP_HIT_RADIUS ? best : null;
    }

    function profileMeasurePointer(mx, my) {
        let best = null;
        let bestDist = Infinity;
        for (let i = profileMeasureLayouts.length - 1; i >= 0; i--) {
            const item = profileMeasureLayouts[i];
            if (pointInBox(mx, my, item.button, 3)) return { key: item.key, part: 'delete' };
        }
        for (let i = profileMeasureLayouts.length - 1; i >= 0; i--) {
            const item = profileMeasureLayouts[i];
            const dist = profileLayoutBodyDist(mx, my, item);
            if (dist != null && dist < bestDist) {
                bestDist = dist;
                best = { key: item.key, part: 'body' };
            }
        }
        return best;
    }

    function drawProfileMeasure(ctx, data, geom) {
        profileMeasureLayouts = [];
        const drawPair = (pts, style, setNum, key) => {
            const layout = profileMeasureLayout(ctx, data, geom, pts, setNum);
            if (!layout) return;
            profileMeasureLayouts.push({
                key: key,
                p0: layout.p0,
                p1: layout.p1,
                corner: layout.corner,
                labels: layout.labels,
                button: layout.button,
                bridge: layout.bridge,
            });
            const p0 = layout.p0;
            const p1 = layout.p1;
            const corner = layout.corner;
            if (corner && p0 && p1) {
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(p0.px, p0.py);
                ctx.lineTo(corner.px, corner.py);
                ctx.lineTo(p1.px, p1.py);
                ctx.closePath();
                ctx.fillStyle = style.fill;
                ctx.fill();
                ctx.setLineDash([5, 4]);
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(p0.px, p0.py);
                ctx.lineTo(corner.px, corner.py);
                ctx.strokeStyle = 'rgba(0,0,0,0.55)';
                ctx.lineWidth = 3;
                ctx.stroke();
                ctx.strokeStyle = style.dist;
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(corner.px, corner.py);
                ctx.lineTo(p1.px, p1.py);
                ctx.strokeStyle = 'rgba(0,0,0,0.55)';
                ctx.lineWidth = 3;
                ctx.stroke();
                ctx.strokeStyle = style.step;
                ctx.lineWidth = 2;
                ctx.stroke();
                if (layout.labels.length) {
                    paintProfileLabel(ctx, layout.labels[0], style.dist);
                    paintProfileLabel(ctx, layout.labels[1], style.step);
                }
                ctx.restore();
            }
            pts.forEach((index, pointIndex) => {
                const point = profileChartPoint(data, geom, index);
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
        const showNum = state.profile.measureSets.length > 1;
        state.profile.measureSets.forEach((set, index) => {
            drawPair(set.pts, stepStyle(index), showNum ? index + 1 : null, index);
        });
        if (state.profile.measurePts.length) {
            drawPair(state.profile.measurePts, stepStyle(state.profile.measureSets.length), null, 'draft');
        }
        const hover = state.profile.hoverMeasure;
        if (hover && !state.profile.measureDrag) {
            for (let i = 0; i < profileMeasureLayouts.length; i++) {
                if (profileMeasureLayouts[i].key !== hover.key) continue;
                drawDeleteButton(ctx, profileMeasureLayouts[i].button, hover.part === 'delete');
                break;
            }
        }
    }

    function renderProfileChart() {
        const data = state.profile.data;
        const canvas = el.profileCanvas;
        if (!data || el.profilePanel.hidden) {
            profileMeasureLayouts = [];
            return;
        }
        el.profileMeta.textContent = profileMetaText();
        syncProfileMeasureUi();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.max(1, canvas.clientWidth || canvas.parentElement.clientWidth || 600);
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
        const geom = { padL, padT, plotW, plotH, width, height, vmin: data.vmin, vmax: data.vmax };
        state.profile.geom = geom;
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
            ctx.fillText(formatValue(data.vmax - span * (i / 4)), padL - 6, py);
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
        if (profileChartStyle === 'dots') {
            ctx.fillStyle = '#4f8cff';
            for (let i = 0; i < data.count; i++) {
                const point = profileChartPoint(data, geom, i);
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
                const point = profileChartPoint(data, geom, i);
                if (!point) {
                    started = false;
                    continue;
                }
                if (!started) {
                    ctx.moveTo(point.px, point.py);
                    started = true;
                } else ctx.lineTo(point.px, point.py);
            }
            ctx.stroke();
        }
        ctx.restore();
        if (state.profile.hoverIndex != null && !state.profile.measureMode) {
            const point = profileChartPoint(data, geom, state.profile.hoverIndex);
            const frac = data.distPx > 0 ? data.dist[state.profile.hoverIndex] / data.distPx : 0;
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
        drawProfileMeasure(ctx, data, geom);
        ctx.textAlign = 'left';
    }

    function profilePointOnImage(index, width, height) {
        const line = state.profile.line;
        const data = state.profile.data;
        const tt = data && data.count > 1 ? index / (data.count - 1) : 0;
        return imageToScreen(line.c0 + (line.c1 - line.c0) * tt, line.r0 + (line.r1 - line.r0) * tt, width, height);
    }

    function drawProfileOverlay() {
        if (state.step === 3) {
            paintProfileSurface(el.profileOverlayBump, 'bump');
            paintProfileSurface(el.profileOverlayBase, 'base');
            return;
        }
        paintProfileSurface(el.profileOverlay, 'main');
    }

    function paintProfileSurface(canvas, pane) {
        if (!canvas) return;
        const wrap = canvas.parentElement;
        const width = Math.max(1, wrap.clientWidth);
        const height = Math.max(1, wrap.clientHeight);
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, width, height);
        const onThisPane = state.step !== 3 || (pane === 'base') === (state.profile.pane === 'base');
        const line = onThisPane ? state.profile.line : null;
        if (!line) {
            if (pane === 'main') drawResidualHover(ctx, width, height);
            return;
        }
        const start = imageToScreen(line.c0, line.r0, width, height);
        const end = imageToScreen(line.c1, line.r1, width, height);
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
        ctx.strokeStyle = '#4f8cff';
        ctx.lineWidth = 2;
        ctx.stroke();
        [start, end].forEach((point) => {
            ctx.beginPath();
            ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#4f8cff';
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#fff';
            ctx.stroke();
        });
        const data = state.profile.data;
        const replacing = state.profiling && state.profiling.mode === 'draw' && state.profile.editStart && state.profile.editStart.keepData;
        if (!replacing) {
        if (!state.profile.measureMode && state.profile.hoverIndex != null && data) {
            const hover = profilePointOnImage(state.profile.hoverIndex, width, height);
            ctx.beginPath();
            ctx.arc(hover.x, hover.y, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#ffd24a';
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#000';
            ctx.stroke();
        }
        const mark = (index, color) => {
            const point = profilePointOnImage(index, width, height);
            ctx.beginPath();
            ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#fff';
            ctx.stroke();
        };
        state.profile.measureSets.forEach((set, setIndex) => {
            const style = stepStyle(setIndex);
            set.pts.forEach((index, pointIndex) => mark(index, style.colors[pointIndex % style.colors.length]));
        });
        const draft = stepStyle(state.profile.measureSets.length);
        state.profile.measurePts.forEach((index, pointIndex) => {
            mark(index, draft.colors[pointIndex % draft.colors.length]);
        });
        }
        if (pane === 'main') drawResidualHover(ctx, width, height);
        if (line && state.profile.lineHover && !state.profiling && !state.panning
            && state.profile.lineHoverCanvas === imageCanvasForOverlay(canvas)) {
            const decor = profileLineDecor(width, height);
            if (decor) drawDeleteButton(ctx, decor.button, state.profile.lineHover === 'delete');
        }
    }

    function imageCanvasForOverlay(overlay) {
        if (overlay === el.profileOverlayBump) return el.canvasBump;
        if (overlay === el.profileOverlayBase) return el.canvasBase;
        return el.canvas;
    }

    function profileLineDecor(width, height) {
        const line = state.profile.line;
        if (!line) return null;
        const start = imageToScreen(line.c0, line.r0, width, height);
        const end = imageToScreen(line.c1, line.r1, width, height);
        const anchor = rightmostAnchor([
            { x: start.x, y: start.y, clearance: 12 },
            { x: end.x, y: end.y, clearance: 12 },
        ]);
        return attachDeleteButton(anchor.x, anchor.y, anchor.clearance, width, height);
    }

    function profileLineOnCanvas(canvas) {
        if (!state.profile.line || !state.profile.data || state.profiling) return false;
        if (state.step === 3) {
            if (canvas === el.canvasBase) return state.profile.pane === 'base';
            if (canvas === el.canvasBump) return state.profile.pane !== 'base';
            return false;
        }
        return canvas === el.canvas;
    }

    function profileLinePointer(event, canvas) {
        if (!profileLineOnCanvas(canvas)) return null;
        const pos = eventToCanvas(event, canvas);
        const decor = profileLineDecor(pos.width, pos.height);
        if (!decor) return null;
        if (pointInBox(pos.sx, pos.sy, decor.button, 3)) return 'delete';
        if (pointInBox(pos.sx, pos.sy, decor.bridge, 0)) return 'body';
        if (profileHit(event, canvas)) return 'body';
        return null;
    }

    function setProfileLineHover(canvas, target) {
        if (target) {
            const changed = state.profile.lineHover !== target || state.profile.lineHoverCanvas !== canvas;
            state.profile.lineHover = target;
            state.profile.lineHoverCanvas = canvas;
            return changed;
        }
        if (state.profile.lineHoverCanvas !== canvas) return false;
        state.profile.lineHover = null;
        state.profile.lineHoverCanvas = null;
        return true;
    }

    function refreshMeasurementHover(event, canvas) {
        if (!state.dataset || state.measuring || state.profiling) {
            const changed = setMeasureHover(canvas, null) || setProfileLineHover(canvas, null);
            if (changed) requestRender();
            return false;
        }
        const measureTarget = measurePointerTarget(event, canvas);
        const profileTarget = profileLinePointer(event, canvas);
        const changed = setMeasureHover(canvas, measureTarget) || setProfileLineHover(canvas, profileTarget);
        if (changed) requestRender();
        return measureTarget === 'delete' || profileTarget === 'delete';
    }

    function deleteImageMeasurementAt(event, canvas) {
        const profileTarget = profileLinePointer(event, canvas);
        const measureTarget = measurePointerTarget(event, canvas);
        if (profileTarget === 'delete') {
            clearProfile(true);
            return true;
        }
        if (measureTarget === 'delete') {
            clearMeasure(true);
            return true;
        }
        const onMeasureLine = measureTarget === 'body' && !!measureHit(event, canvas);
        const onProfileLine = profileTarget === 'body' && !!profileHit(event, canvas);
        if (onMeasureLine || onProfileLine) return false;
        return measureTarget === 'body' || profileTarget === 'body';
    }

    function bumpScreenPoint(index, width, height) {
        const point = state.centers[index];
        if (!point) return null;
        return {
            x: (point.col - state.view.col) * state.view.scale + width / 2,
            y: (point.row - state.view.row) * state.view.scale + height / 2,
        };
    }

    function residualDotRadius() {
        return Math.max(3, state.view.scale * 0.45);
    }

    function residualHitRadius() {
        return Math.max(12, residualDotRadius() + 8);
    }

    function hitResidualBump(event, canvas) {
        if (state.step !== 4 || !state.result || !state.centers.length) return -1;
        const pos = eventToCanvas(event, canvas);
        const limit = isScatterView() ? Math.max(8, scatterScreenRadius() + 3) : residualHitRadius();
        let best = -1;
        let bestDist = limit;
        for (let index = 0; index < state.centers.length; index++) {
            if (isScatterView() && !scatterDotShown(index)) continue;
            const screen = bumpScreenPoint(index, pos.width, pos.height);
            if (!screen) continue;
            if (Math.abs(screen.x - pos.sx) > limit || Math.abs(screen.y - pos.sy) > limit) continue;
            const dist = Math.hypot(screen.x - pos.sx, screen.y - pos.sy);
            if (dist <= bestDist) {
                bestDist = dist;
                best = index;
            }
        }
        return best;
    }

    function drawResidualHover(ctx, width, height) {
        if (state.hoverBump < 0 || state.step !== 4) return;
        const screen = bumpScreenPoint(state.hoverBump, width, height);
        if (!screen) return;
        const radius = (isScatterView() ? scatterScreenRadius() : residualDotRadius()) + 5;
        ctx.save();
        ctx.fillStyle = 'rgba(255, 224, 102, 0.38)';
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, radius + 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    function clearResidualHover() {
        if (state.hoverBump < 0) return;
        state.hoverBump = -1;
        if (el.canvas) el.canvas.style.cursor = '';
        drawProfileOverlay();
    }

    function hoverResidual(event, canvas) {
        if (canvas !== el.canvas || state.step !== 4 || !state.result) {
            if (state.hoverBump >= 0) clearResidualHover();
            return false;
        }
        const hit = hitResidualBump(event, canvas);
        if (hit !== state.hoverBump) {
            state.hoverBump = hit;
            drawProfileOverlay();
        }
        if (hit >= 0) {
            canvas.style.cursor = 'pointer';
            return true;
        }
        if (canvas.style.cursor === 'pointer') canvas.style.cursor = '';
        return false;
    }

    function profileHit(event, canvas) {
        const line = state.profile.line;
        if (!line) return null;
        const pos = eventToCanvas(event, canvas);
        const start = imageToScreen(line.c0, line.r0, pos.width, pos.height);
        const end = imageToScreen(line.c1, line.r1, pos.width, pos.height);
        if (Math.hypot(pos.sx - start.x, pos.sy - start.y) <= STEP_HIT_RADIUS) return 'ep0';
        if (Math.hypot(pos.sx - end.x, pos.sy - end.y) <= STEP_HIT_RADIUS) return 'ep1';
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const len2 = dx * dx + dy * dy;
        if (len2 > 0) {
            let tHit = ((pos.sx - start.x) * dx + (pos.sy - start.y) * dy) / len2;
            tHit = clamp(tHit, 0, 1);
            if (Math.hypot(pos.sx - (start.x + tHit * dx), pos.sy - (start.y + tHit * dy)) <= STEP_HIT_RADIUS) return 'move';
        }
        return null;
    }

    function beginProfile(event, canvas, fixedPoint) {
        state.measure.hover = null;
        state.measure.hoverCanvas = null;
        state.profile.lineHover = null;
        state.profile.lineHoverCanvas = null;
        state.profile.pane = canvas === el.canvasBase ? 'base' : 'main';
        const point = fixedPoint || clampPoint(eventToImage(event, canvas));
        const hit = state.profile.line && state.profile.data ? profileHit(event, canvas) : null;
        capturePointer(canvas, event.pointerId);
        if (hit) {
            state.profiling = { id: event.pointerId, mode: hit, canvas };
            state.profile.editStart = { point, line: Object.assign({}, state.profile.line) };
        } else {
            state.profiling = { id: event.pointerId, mode: 'draw', canvas };
            const previous = state.profile.data && state.profile.line
                ? Object.assign({}, state.profile.line)
                : null;
            state.profile.editStart = previous ? { point, line: previous, keepData: true } : null;
            state.profile.line = { c0: point.col, r0: point.row, c1: point.col, r1: point.row };
            if (!previous) {
                state.profile.data = null;
                profileClearMeasures(false);
            }
        }
        syncOverlayUi();
        drawProfileOverlay();
    }

    function moveProfile(event) {
        const canvas = (state.profiling && state.profiling.canvas) || el.canvas;
        const point = clampPoint(eventToImage(event, canvas));
        const mode = state.profiling.mode;
        if (mode === 'draw') {
            state.profile.line.c1 = point.col;
            state.profile.line.r1 = point.row;
        } else if (state.profile.editStart) {
            const origin = state.profile.editStart;
            const dc = point.col - origin.point.col;
            const dr = point.row - origin.point.row;
            const src = origin.line;
            if (mode === 'ep0') {
                state.profile.line = clampLine({ c0: src.c0 + dc, r0: src.r0 + dr, c1: src.c1, r1: src.r1 });
            } else if (mode === 'ep1') {
                state.profile.line = clampLine({ c0: src.c0, r0: src.r0, c1: src.c1 + dc, r1: src.r1 + dr });
            } else {
                state.profile.line = clampLine({
                    c0: src.c0 + dc,
                    r0: src.r0 + dr,
                    c1: src.c1 + dc,
                    r1: src.r1 + dr,
                });
            }
        }
        drawProfileOverlay();
    }

    function finishProfile() {
        const mode = state.profiling && state.profiling.mode;
        const line = state.profile.line;
        state.profiling = null;
        const tooShort = !line || Math.hypot(line.c1 - line.c0, line.r1 - line.r0) < 1;
        const restorePrevious = state.profile.editStart && state.profile.editStart.line
            && (mode !== 'draw' || state.profile.editStart.keepData);
        if (tooShort) {
            if (restorePrevious) {
                state.profile.line = Object.assign({}, state.profile.editStart.line);
            } else {
                state.profile.line = null;
                state.profile.data = null;
            }
        } else {
            profileClearMeasures(false);
            profileRecompute(true);
            logStepMeasures();
        }
        state.profile.editStart = null;
        syncOverlayUi();
        requestRender();
    }

    function hoverProfile(event, canvas) {
        if (state.tool !== 'step' || !state.dataset) return;
        if (!state.profile.line || !state.profile.data || state.profiling) {
            canvas.style.cursor = '';
            return;
        }
        const hit = profileHit(event, canvas);
        if (hit === 'ep0' || hit === 'ep1') canvas.style.cursor = 'pointer';
        else if (hit === 'move') canvas.style.cursor = 'move';
        else canvas.style.cursor = '';
    }

    function showProfileTip(event, html) {
        const tip = el.profileTip;
        tip.innerHTML = html;
        tip.classList.add('show');
        const plot = el.profilePlot.getBoundingClientRect();
        let left = event.clientX - plot.left + 12;
        let top = event.clientY - plot.top + 12;
        const width = tip.offsetWidth;
        const height = tip.offsetHeight;
        if (left + width > plot.width - 4) left = event.clientX - plot.left - width - 12;
        if (top + height > plot.height - 4) top = event.clientY - plot.top - height - 12;
        tip.style.left = Math.max(2, left) + 'px';
        tip.style.top = Math.max(2, top) + 'px';
    }

    function toggleProfileMeasure() {
        const profile = state.profile;
        if (profile.measureMode) {
            profile.measureMode = false;
            profile.measurePts = [];
        } else if (profile.measureSets.length >= STEP_MAX_SETS) {
            showToast(t('profileMeasureMaxSets', STEP_MAX_SETS), 'info');
        } else {
            profile.measureMode = true;
            profile.measurePts = [];
        }
        el.profileTip.classList.remove('show');
        syncProfileMeasureUi();
        renderProfileChart();
        drawProfileOverlay();
    }

    function bindProfileChart() {
        const canvas = el.profileCanvas;
        canvas.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            const rect = canvas.getBoundingClientRect();
            const mx = event.clientX - rect.left;
            const my = event.clientY - rect.top;
            const hover = profileMeasurePointer(mx, my);
            if (hover && hover.part === 'delete') {
                event.preventDefault();
                stepMeasureSuppressClick = true;
                deleteProfileMeasure(hover.key);
                return;
            }
            if (!profileHasMeasures()) return;
            const hit = profileMeasureHit(mx, my);
            if (!hit) return;
            event.preventDefault();
            state.profile.hoverMeasure = null;
            state.profile.measureDrag = { id: event.pointerId, setKey: hit.setKey, ptIndex: hit.ptIndex, moved: false };
            capturePointer(canvas, event.pointerId);
            renderProfileChart();
            drawProfileOverlay();
        });
        canvas.addEventListener('pointermove', (event) => {
            const drag = state.profile.measureDrag;
            if (!drag || drag.id !== event.pointerId) return;
            const rect = canvas.getBoundingClientRect();
            const index = profileChartNearest(event.clientX - rect.left, event.clientY - rect.top);
            const pts = profileMeasurePts(drag.setKey);
            if (index == null || !pts || pts[drag.ptIndex] === index) return;
            pts[drag.ptIndex] = index;
            drag.moved = true;
            renderProfileChart();
            drawProfileOverlay();
        });
        const endDrag = (event) => {
            const drag = state.profile.measureDrag;
            if (!drag || drag.id !== event.pointerId) return;
            if (drag.moved) {
                stepMeasureSuppressClick = true;
                logStepMeasures();
            }
            state.profile.measureDrag = null;
            renderProfileChart();
            drawProfileOverlay();
        };
        canvas.addEventListener('pointerup', endDrag);
        canvas.addEventListener('pointercancel', endDrag);
        canvas.addEventListener('click', (event) => {
            if (stepMeasureSuppressClick) {
                stepMeasureSuppressClick = false;
                return;
            }
            if (!state.profile.measureMode || !state.profile.data) return;
            const rect = canvas.getBoundingClientRect();
            const mx = event.clientX - rect.left;
            const my = event.clientY - rect.top;
            if (profileMeasurePointer(mx, my)) return;
            const index = profileChartPick(mx, my);
            if (index == null || profileIndexTaken(index)) return;
            if (state.profile.measureSets.length >= STEP_MAX_SETS) {
                state.profile.measureMode = false;
                showToast(t('profileMeasureMaxSets', STEP_MAX_SETS), 'info');
                syncProfileMeasureUi();
                return;
            }
            state.profile.measurePts.push(index);
            let committed = false;
            if (state.profile.measurePts.length >= 2) {
                state.profile.measureSets.push({ pts: state.profile.measurePts.slice(0, 2) });
                state.profile.measurePts = [];
                state.profile.measureMode = false;
                committed = true;
            }
            state.profile.hoverIndex = null;
            el.profileTip.classList.remove('show');
            syncProfileMeasureUi();
            renderProfileChart();
            drawProfileOverlay();
            if (committed) logStepMeasures();
        });
        canvas.addEventListener('mousemove', (event) => {
            if (state.profile.measureDrag || !state.profile.data || !state.profile.geom) return;
            const rect = canvas.getBoundingClientRect();
            const mx = event.clientX - rect.left;
            const my = event.clientY - rect.top;
            const hover = profileMeasurePointer(mx, my);
            const prev = state.profile.hoverMeasure;
            const sameHover = !!prev && !!hover && prev.key === hover.key && prev.part === hover.part;
            if (hover) {
                state.profile.hoverMeasure = hover;
                if (hover.part === 'delete') canvas.style.cursor = 'pointer';
                else if (profileMeasureHit(mx, my)) canvas.style.cursor = 'grab';
                else canvas.style.cursor = 'default';
                state.profile.hoverIndex = null;
                el.profileTip.classList.remove('show');
                if (!sameHover) {
                    renderProfileChart();
                    drawProfileOverlay();
                }
                return;
            }
            if (prev) {
                state.profile.hoverMeasure = null;
                renderProfileChart();
                drawProfileOverlay();
            }
            canvas.style.cursor = '';
            const index = state.profile.measureMode
                ? profileChartPick(mx, my)
                : nearestProfileIndex(mx);
            state.profile.hoverIndex = index;
            renderProfileChart();
            drawProfileOverlay();
            if (index == null) {
                el.profileTip.classList.remove('show');
                return;
            }
            const data = state.profile.data;
            if (state.profile.measureMode) {
                const setNum = state.profile.measureSets.length + 1;
                const hint = state.profile.measurePts.length === 0
                    ? t('profileMeasurePick1Set', setNum)
                    : t('profileMeasurePick2Set', setNum);
                showProfileTip(event, '<div>' + hint + '</div>');
                return;
            }
            const dist = profileDistInfo(data.dist[index]);
            showProfileTip(event,
                '<div><span class="k">' + t('profileAxisDist') + ':</span>' + dist.text + '</div>'
                + '<div><span class="k">' + t('valueLabel') + ':</span>' + formatValue(data.vals[index]) + '</div>');
        });
        canvas.addEventListener('mouseleave', () => {
            if (state.profile.measureDrag) return;
            state.profile.hoverIndex = null;
            state.profile.hoverMeasure = null;
            el.profileTip.classList.remove('show');
            canvas.style.cursor = '';
            if (state.profile.data) {
                renderProfileChart();
                drawProfileOverlay();
            }
        });
    }

    function nearestProfileIndex(mx) {
        const data = state.profile.data;
        const geom = state.profile.geom;
        let frac = (mx - geom.padL) / geom.plotW;
        frac = clamp(frac, 0, 1);
        const target = frac * data.distPx;
        let best = 0;
        let bestDist = Infinity;
        for (let i = 0; i < data.count; i++) {
            const dist = Math.abs(data.dist[i] - target);
            if (dist < bestDist) {
                bestDist = dist;
                best = i;
            }
        }
        return best;
    }

    let imageMenuCanvas = null;

    function modeForCanvas(canvas) {
        if (canvas === el.canvasBump) return 'pure';
        if (canvas === el.canvasBase) return 'base';
        return currentSampleMode();
    }

    function viewPixelBounds(canvas) {
        const dataset = state.dataset;
        const view = viewportOnImage(canvas.width || canvas.clientWidth, canvas.height || canvas.clientHeight);
        const eps = 1e-6;
        const c0 = clamp(Math.floor(view.col + eps), 0, dataset.width);
        const r0 = clamp(Math.floor(view.row + eps), 0, dataset.height);
        const c1 = clamp(Math.ceil(view.col + view.width - eps), 0, dataset.width);
        const r1 = clamp(Math.ceil(view.row + view.height - eps), 0, dataset.height);
        if (c1 <= c0 || r1 <= r0) return null;
        return { c0, r0, c1, r1 };
    }

    function rasterizeScatter(bounds) {
        const dataset = state.dataset;
        const c0 = bounds ? bounds.c0 : 0;
        const r0 = bounds ? bounds.r0 : 0;
        const width = bounds ? bounds.c1 - bounds.c0 : dataset.width;
        const height = bounds ? bounds.r1 - bounds.r0 : dataset.height;
        if (width < 1 || height < 1) return null;
        const data = new Float32Array(width * height);
        data.fill(NaN);
        const radius = scatterImageRadius();
        const limit = radius * radius;
        const reach = Math.ceil(radius);
        for (let index = 0; index < state.centers.length; index++) {
            const value = scatterValue(index);
            if (!scatterDotShown(index)) continue;
            const point = state.centers[index];
            const col = Math.round(point.col);
            const row = Math.round(point.row);
            for (let dy = -reach; dy <= reach; dy++) {
                const rr = row + dy;
                if (rr < r0 || rr >= r0 + height) continue;
                for (let dx = -reach; dx <= reach; dx++) {
                    if (dx * dx + dy * dy > limit) continue;
                    const cc = col + dx;
                    if (cc < c0 || cc >= c0 + width) continue;
                    data[(rr - r0) * width + (cc - c0)] = value;
                }
            }
        }
        return { data, width, height, c0, r0 };
    }

    function extractGrid(mode, bounds) {
        if (mode === 'scatter') return rasterizeScatter(bounds);
        const dataset = state.dataset;
        const c0 = bounds ? bounds.c0 : 0;
        const r0 = bounds ? bounds.r0 : 0;
        const width = bounds ? bounds.c1 - bounds.c0 : dataset.width;
        const height = bounds ? bounds.r1 - bounds.r0 : dataset.height;
        if (width < 1 || height < 1) return null;
        if (!bounds && mode === 'original') {
            return { data: dataset.data, width, height, c0: 0, r0: 0 };
        }
        const data = new Float32Array(width * height);
        for (let row = 0; row < height; row++) {
            const dest = row * width;
            const srcRow = r0 + row;
            for (let col = 0; col < width; col++) {
                const value = sampleFor(mode, srcRow, c0 + col);
                data[dest + col] = Number.isFinite(value) ? value : NaN;
            }
        }
        return { data, width, height, c0, r0 };
    }

    function formatHeaderNumber(value) {
        if (!Number.isFinite(value)) return '0';
        const abs = Math.abs(value);
        if (abs !== 0 && (abs < 1e-4 || abs >= 1e7)) return value.toExponential(8);
        return String(Number(value.toPrecision(10)));
    }

    function cleanUnit(unit) {
        const text = String(unit || '').replace(/[\r\n=]/g, '').trim();
        return text || 'um';
    }

    function exportMeta(grid) {
        const dataset = state.dataset;
        const header = dataset.header || {};
        const space = spacing(dataset);
        const full = grid.c0 === 0 && grid.r0 === 0 && grid.width === dataset.width && grid.height === dataset.height;
        let xlength;
        let ylength;
        if (full) {
            const rawX = header.xlength ?? header['x-length'];
            const rawY = header.ylength ?? header['y-length'];
            const xl = Number(rawX);
            const yl = Number(rawY);
            if (rawX != null && String(rawX).trim() && Number.isFinite(xl) && xl > 0
                && rawY != null && String(rawY).trim() && Number.isFinite(yl) && yl > 0) {
                return {
                    xlength: String(rawX).trim(),
                    ylength: String(rawY).trim(),
                    xunit: cleanUnit(axisUnit('x')),
                    yunit: cleanUnit(axisUnit('y')),
                    zunit: cleanUnit(axisUnit('z')),
                };
            }
            xlength = Number.isFinite(xl) && xl > 0 ? xl : space.dx * Math.max(1, dataset.width - 1);
            ylength = Number.isFinite(yl) && yl > 0 ? yl : space.dy * Math.max(1, dataset.height - 1);
        } else {
            xlength = space.dx * Math.max(1, grid.width - 1);
            ylength = space.dy * Math.max(1, grid.height - 1);
        }
        return {
            xlength: formatHeaderNumber(xlength),
            ylength: formatHeaderNumber(ylength),
            xunit: cleanUnit(axisUnit('x')),
            yunit: cleanUnit(axisUnit('y')),
            zunit: cleanUnit(axisUnit('z')),
        };
    }

    function exportName(kind, ext, canvas) {
        const raw = String((state.dataset && state.dataset.name) || 'heightmap').replace(/[\\/:*?"<>|]/g, '_');
        const dot = raw.lastIndexOf('.');
        const stem = (dot > 0 ? raw.slice(0, dot) : raw) || 'heightmap';
        let suffix = '';
        if (canvas === el.canvasBump) suffix += '_bump';
        else if (canvas === el.canvasBase) suffix += '_base';
        else if (isScatterView()) suffix += state.resultView === 'h' ? '_h' : seriesViewSpec().export;
        if (kind === 'view') suffix += '_view';
        else if (kind === 'result') suffix += '_計算結果';
        return stem + suffix + '.' + ext;
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

    function saveHeightmap(kind, fmt, canvas) {
        const dataset = state.dataset;
        if (!dataset || !canvas) return;
        try {
            const bounds = kind === 'view' ? viewPixelBounds(canvas) : null;
            if (kind === 'view' && !bounds) {
                showToast(t('toastSaveEmpty'), 'error');
                return;
            }
            const grid = extractGrid(modeForCanvas(canvas), bounds);
            if (!grid) {
                showToast(t('toastSaveEmpty'), 'error');
                return;
            }
            const meta = exportMeta(grid);
            const blob = fmt === 'asc' ? encodeAsc(grid, meta) : encodeBcrf(grid, meta);
            const name = exportName(kind, fmt === 'asc' ? 'asc' : 'bcrf', canvas);
            downloadBlob(blob, name);
            showToast(t('toastSaved', name));
        } catch (err) {
            showToast(t('toastSaveFailed'), 'error');
        }
    }

    function openImageMenu(event, canvas) {
        const menu = el.imageMenu;
        if (!menu || !state.dataset) return;
        imageMenuCanvas = canvas;
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

    function closeImageMenu() {
        if (!el.imageMenu || el.imageMenu.hidden) return;
        el.imageMenu.hidden = true;
        imageMenuCanvas = null;
    }

    function bindImageMenu() {
        const menu = el.imageMenu;
        if (!menu) return;
        const openStage = (event, canvas) => {
            if (!state.dataset || !canvas) return;
            event.preventDefault();
            openImageMenu(event, canvas);
        };
        el.stageSingle.addEventListener('contextmenu', (event) => {
            if (el.stageSingle.hidden) return;
            openStage(event, el.canvas);
        });
        el.stageCompare.addEventListener('contextmenu', (event) => {
            if (el.stageCompare.hidden) return;
            const pane = event.target.closest('.pane');
            const canvas = pane ? pane.querySelector('canvas:not(.pane-overlay)') : null;
            openStage(event, canvas);
        });
        menu.addEventListener('contextmenu', (event) => event.preventDefault());
        menu.addEventListener('click', (event) => {
            const button = event.target.closest('button[data-save]');
            if (!button || !menu.contains(button)) return;
            const kind = button.getAttribute('data-save');
            const fmt = button.getAttribute('data-fmt');
            const canvas = imageMenuCanvas;
            closeImageMenu();
            saveHeightmap(kind, fmt, canvas);
        });
        document.addEventListener('pointerdown', (event) => {
            if (menu.hidden || menu.contains(event.target)) return;
            closeImageMenu();
        }, true);
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') closeImageMenu();
        });
        window.addEventListener('wheel', () => closeImageMenu(), { capture: true, passive: true });
    }

    function bindPointer(canvas) {
        canvas.addEventListener('pointerdown', (event) => {
            if (!state.dataset) return;
            if (event.button === 0 && event.detail > 1) {
                event.preventDefault();
                return;
            }
            const imageCanvas = canvas === el.canvas || canvas === el.canvasBump || canvas === el.canvasBase;
            if (imageCanvas && event.button === 0 && deleteImageMeasurementAt(event, canvas)) {
                event.preventDefault();
                return;
            }
            if (imageCanvas && state.tool === 'measure' && event.button === 0) {
                event.preventDefault();
                beginMeasure(event, canvas);
                return;
            }
            if (canvas === el.canvas && state.step === 4 && state.tool === 'pan' && event.button === 0) {
                const hit = hitResidualBump(event, canvas);
                if (hit >= 0) {
                    event.preventDefault();
                    capturePointer(canvas, event.pointerId);
                    state.bumpPick = {
                        id: event.pointerId,
                        index: hit,
                        x: event.clientX,
                        y: event.clientY,
                        moved: false,
                        point: clampPoint(eventToImage(event, canvas)),
                    };
                    return;
                }
            }
            if (imageCanvas && state.tool === 'step' && event.button === 0) {
                event.preventDefault();
                beginProfile(event, canvas);
                return;
            }
            if (event.button !== 0 && event.button !== 1) return;
            if (event.button === 1) event.preventDefault();
            capturePointer(canvas, event.pointerId);
            const hadHover = state.measure.hover || state.profile.lineHover;
            state.measure.hover = null;
            state.measure.hoverCanvas = null;
            state.profile.lineHover = null;
            state.profile.lineHoverCanvas = null;
            state.panning = { id: event.pointerId, x: event.clientX, y: event.clientY, canvas };
            if (hadHover) requestRender();
        });
        canvas.addEventListener('pointermove', (event) => {
            if (state.measuring && state.measuring.id === event.pointerId && canvas === state.measuring.canvas) {
                moveMeasure(event);
                return;
            }
            if (state.bumpPick && state.bumpPick.id === event.pointerId && canvas === el.canvas) {
                const pick = state.bumpPick;
                if (!pick.moved && Math.hypot(event.clientX - pick.x, event.clientY - pick.y) > 5) {
                    pick.moved = true;
                    state.panning = { id: event.pointerId, x: event.clientX, y: event.clientY, canvas };
                }
                if (pick.moved && state.panning && state.panning.id === event.pointerId) {
                    /* 交給下方的平移 */
                } else return;
            }
            if (state.profiling && state.profiling.id === event.pointerId && canvas === state.profiling.canvas) {
                moveProfile(event);
                return;
            }
            if (!state.panning || state.panning.id !== event.pointerId) {
                if (refreshMeasurementHover(event, canvas)) {
                    canvas.style.cursor = 'pointer';
                    return;
                }
                if (canvas.style.cursor === 'pointer') canvas.style.cursor = '';
                if (state.tool === 'pan' && hoverResidual(event, canvas)) return;
                hoverMeasure(event, canvas);
                hoverProfile(event, canvas);
                return;
            }
            const dx = event.clientX - state.panning.x;
            const dy = event.clientY - state.panning.y;
            state.panning.x = event.clientX;
            state.panning.y = event.clientY;
            state.view.col -= dx / state.view.scale;
            state.view.row -= dy / state.view.scale;
            requestRender();
        });
        const end = (event) => {
            if (state.bumpPick && state.bumpPick.id === event.pointerId && canvas === el.canvas) {
                const pick = state.bumpPick;
                state.bumpPick = null;
                if (!pick.moved && event.type !== 'pointercancel') {
                    selectBumpFromImage(pick.index);
                    return;
                }
            }
            if (state.measuring && state.measuring.id === event.pointerId && canvas === state.measuring.canvas) {
                finishMeasure();
                return;
            }
            if (state.profiling && state.profiling.id === event.pointerId && canvas === state.profiling.canvas) {
                finishProfile();
                return;
            }
            if (state.panning && state.panning.id === event.pointerId) state.panning = null;
        };
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);
        canvas.addEventListener('pointerleave', () => {
            const changed = setMeasureHover(canvas, null) || setProfileLineHover(canvas, null);
            if (changed && !state.measuring && !state.profiling) requestRender();
            if (canvas !== el.canvas || state.bumpPick || state.panning) return;
            clearResidualHover();
        });
        canvas.addEventListener('dblclick', (event) => {
            if (!state.dataset || event.button !== 0) return;
            event.preventDefault();
            fitView();
            requestRender();
        });
        canvas.addEventListener('wheel', (event) => {
            if (!state.dataset) return;
            event.preventDefault();
            const rect = canvas.getBoundingClientRect();
            const sx = event.clientX - rect.left;
            const sy = event.clientY - rect.top;
            const anchor = screenToImage(sx, sy, rect.width, rect.height);
            const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
            state.view.scale = clamp(state.view.scale * factor, 0.02, 80);
            state.view.col = anchor.col - (sx - rect.width / 2) / state.view.scale;
            state.view.row = anchor.row - (sy - rect.height / 2) / state.view.scale;
            state.measure.hover = null;
            state.measure.hoverCanvas = null;
            state.profile.lineHover = null;
            state.profile.lineHoverCanvas = null;
            requestRender();
        }, { passive: false });
    }

    function bindHist() {
        let drag = null;
        let changed = false;
        let previewFrame = 0;
        const move = (event) => {
            if (!drag) return;
            const rect = el.histWrap.getBoundingClientRect();
            if (rect.width <= 0) return;
            const frac = clamp((event.clientX - rect.left) / rect.width, 0, 1);
            if (!Number.isFinite(frac)) return;
            const nextLo = drag === 'lo' ? Math.min(frac, state.histHi - 0.005) : state.histLo;
            const nextHi = drag === 'hi' ? Math.max(frac, state.histLo + 0.005) : state.histHi;
            if (nextLo === state.histLo && nextHi === state.histHi) return;
            state.histLo = nextLo;
            state.histHi = nextHi;
            changed = true;
            if (previewFrame) return;
            previewFrame = requestAnimationFrame(() => {
                previewFrame = 0;
                if (drag) previewHist();
            });
        };
        const stop = () => {
            if (!drag) return;
            drag = null;
            if (previewFrame) {
                cancelAnimationFrame(previewFrame);
                previewFrame = 0;
            }
            if (!changed) return;
            changed = false;
            invalidateBumps();
            if (state.step < 1) state.step = 1;
            state.maxStep = Math.max(state.maxStep, 1);
            if (state.step > 1) state.step = 1;
            update();
        };
        [el.histLo, el.histHi].forEach((handle) => {
            handle.addEventListener('pointerdown', (event) => {
                if (!state.dataset || event.button !== 0) return;
                drag = handle === el.histLo ? 'lo' : 'hi';
                changed = false;
                handle.setPointerCapture(event.pointerId);
            });
            handle.addEventListener('pointermove', move);
            handle.addEventListener('pointerup', stop);
            handle.addEventListener('pointercancel', stop);
        });
        document.getElementById('bcBtnAuto').addEventListener('click', () => {
            if (!state.dataset) return;
            autoRange();
            update();
        });
        document.getElementById('bcBtnDenoiseCancel').addEventListener('click', () => {
            state.histLo = 0;
            state.histHi = 1;
            invalidateBumps();
            state.step = 1;
            state.maxStep = Math.max(1, Math.min(state.maxStep, 1));
            update();
        });
        bindHistHover(el.histWrap, el.histTip, () => {
            if (!state.dataset) return null;
            return { min: state.vmin, max: state.vmax, unit: axisUnit('z') };
        });
    }

    function bindRawHist() {
        let drag = null;
        let frame = 0;
        const move = (event) => {
            if (!drag) return;
            const rect = el.rawHistWrap.getBoundingClientRect();
            if (rect.width <= 0) return;
            const frac = clamp((event.clientX - rect.left) / rect.width, 0, 1);
            if (!Number.isFinite(frac)) return;
            const spec = seriesViewSpec();
            const lo = state[spec.lo];
            const hi = state[spec.hi];
            const nextLo = drag === 'lo' ? Math.min(frac, hi - 0.005) : lo;
            const nextHi = drag === 'hi' ? Math.max(frac, lo + 0.005) : hi;
            if (nextLo === lo && nextHi === hi) return;
            state[spec.lo] = nextLo;
            state[spec.hi] = nextHi;
            if (frame) return;
            frame = requestAnimationFrame(() => {
                frame = 0;
                if (!drag) return;
                requestRender();
                if (state[seriesViewSpec().extremes]) applyHeightExtremeRows();
            });
        };
        const stop = () => {
            if (!drag) return;
            drag = null;
            if (frame) {
                cancelAnimationFrame(frame);
                frame = 0;
            }
            requestRender();
            if (isFilteredScatter() && state[seriesViewSpec().extremes]) applyHeightExtremeRows();
        };
        [el.rawHistLo, el.rawHistHi].forEach((handle) => {
            handle.addEventListener('pointerdown', (event) => {
                if (state.step !== 4 || !isFilteredScatter() || !state.result || event.button !== 0) return;
                drag = handle === el.rawHistLo ? 'lo' : 'hi';
                handle.setPointerCapture(event.pointerId);
            });
            handle.addEventListener('pointermove', move);
            handle.addEventListener('pointerup', stop);
            handle.addEventListener('pointercancel', stop);
        });
        el.showRawFiltered.addEventListener('change', () => {
            if (!isFilteredScatter()) return;
            state[seriesViewSpec().filtered] = el.showRawFiltered.checked;
            requestRender();
        });
        bindHistHover(el.rawHistWrap, el.rawHistTip, () => {
            if (state.step !== 4 || !isFilteredScatter() || !state.result) return null;
            const extent = rawExtent();
            return {
                min: extent.min,
                max: extent.max,
                unit: (state.result.z_unit || axisUnit('z') || '').trim(),
            };
        });
    }

    function histDigits(step) {
        if (!(step > 0)) return 4;
        return clamp(Math.ceil(-Math.log10(step)) + 1, 3, 6);
    }

    function histIntervalText(min, max, bin, unit) {
        const span = max - min;
        const step = span > 0 ? span / HIST_BINS : 0;
        const lo = span > 0 ? min + bin * step : min;
        const hi = span > 0 ? min + (bin + 1) * step : max;
        const digits = histDigits(step);
        const start = lo.toFixed(digits);
        const end = hi.toFixed(digits);
        const body = start === end ? start : start + ' ～ ' + end;
        const suffix = (unit || '').trim();
        return suffix ? body + ' ' + suffix : body;
    }

    function bindHistHover(wrap, tip, readExtent) {
        const hide = () => { tip.hidden = true; };
        wrap.addEventListener('mousemove', (event) => {
            const rect = wrap.getBoundingClientRect();
            if (rect.width <= 0) return;
            const extent = readExtent();
            if (!extent || !Number.isFinite(extent.min) || !Number.isFinite(extent.max)) {
                hide();
                return;
            }
            const frac = clamp((event.clientX - rect.left) / rect.width, 0, 0.999999);
            const bin = Math.min(HIST_BINS - 1, (frac * HIST_BINS) | 0);
            tip.textContent = histIntervalText(extent.min, extent.max, bin, extent.unit);
            tip.hidden = false;
            const tipW = tip.offsetWidth;
            const tipH = tip.offsetHeight;
            let x = event.clientX - rect.left + 12;
            let y = event.clientY - rect.top - tipH - 8;
            if (x + tipW > rect.width - 4) x = event.clientX - rect.left - tipW - 12;
            if (y < 4) y = event.clientY - rect.top + 14;
            tip.style.left = clamp(x, 4, Math.max(4, rect.width - tipW - 4)) + 'px';
            tip.style.top = clamp(y, 4, Math.max(4, rect.height - tipH - 4)) + 'px';
        });
        wrap.addEventListener('mouseleave', hide);
    }

    function hasFiles(event) {
        const types = event.dataTransfer && event.dataTransfer.types;
        if (!types) return false;
        for (let i = 0; i < types.length; i++) if (types[i] === 'Files') return true;
        return false;
    }

    function filesFromDrop(dataTransfer) {
        return Array.from(dataTransfer.files || []);
    }

    function bindDrop() {
        el.viewer.addEventListener('dragenter', (event) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            state.dragDepth++;
            el.viewer.classList.add('drag-over');
            el.dropVeil.hidden = false;
            el.dropText.textContent = t('dropSupported');
        });
        el.viewer.addEventListener('dragover', (event) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        });
        el.viewer.addEventListener('dragleave', (event) => {
            if (!hasFiles(event)) return;
            state.dragDepth--;
            if (state.dragDepth <= 0) {
                state.dragDepth = 0;
                el.viewer.classList.remove('drag-over');
                el.dropVeil.hidden = true;
            }
        });
        el.viewer.addEventListener('drop', (event) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            state.dragDepth = 0;
            el.viewer.classList.remove('drag-over');
            el.dropVeil.hidden = true;
            addFiles(filesFromDrop(event.dataTransfer));
        });
        ['dragover', 'drop'].forEach((name) => {
            window.addEventListener(name, (event) => {
                if (hasFiles(event)) event.preventDefault();
            });
        });
    }

    function bind() {
        el.lengthMin.value = getUserPref('lengthMin');
        el.lengthMax.value = getUserPref('lengthMax');
        el.widthMin.value = getUserPref('widthMin');
        el.widthMax.value = getUserPref('widthMax');
        el.isolationPx.value = getUserPref('isolationPx');
        el.noiseMax.value = getUserPref('noiseMax');
        el.donutWidth.value = getUserPref('donutWidth');
        el.outlier.value = getUserPref('outlier');
        const savedDot = Number(getUserPref('dotScale'));
        state.scatterDotScale = Number.isFinite(savedDot) ? clamp(savedDot, 0.4, 4) : 1;
        if (el.dotSize) el.dotSize.value = String(state.scatterDotScale);
        const savedColormap = getUserPref('colormap');
        state.colormap = COLORMAPS[savedColormap] ? savedColormap : 'jet';
        if (el.colormap) {
            el.colormap.value = state.colormap;
            setupColormapPicker(el.colormap);
            el.colormap.addEventListener('change', () => {
                state.colormap = el.colormap.value || 'jet';
                setUserPref('colormap', state.colormap);
                colorLut = null;
                requestRender();
            });
        }
        bindColorbar();
        document.getElementById('bcFileInput').addEventListener('change', (event) => {
            addFiles(event.target.files);
            event.target.value = '';
        });
        document.getElementById('bcBtnClear').addEventListener('click', clearAll);
        el.btnPrev.addEventListener('click', goPrev);
        el.btnNext.addEventListener('click', goNext);
        el.btnIdentify.addEventListener('click', identify);
        const resetToolCursor = () => {
            [el.canvas, el.canvasBump, el.canvasBase].forEach((canvas) => {
                if (canvas) canvas.style.cursor = '';
            });
        };
        el.btnPan.addEventListener('click', () => {
            state.tool = 'pan';
            resetToolCursor();
            syncOverlayUi();
        });
        el.btnInspect.addEventListener('click', () => {
            state.tool = 'inspect';
            resetToolCursor();
            syncOverlayUi();
        });
        el.viewer.addEventListener('mousemove', updateValueReadout);
        el.viewer.addEventListener('mouseleave', hideValueReadout);
        el.btnMeasure.addEventListener('click', () => {
            state.tool = 'measure';
            resetToolCursor();
            syncOverlayUi();
        });
        el.btnMeasureClear.addEventListener('click', () => {
            clearMeasure(false);
            clearProfile(true);
        });
        el.btnStep.addEventListener('click', () => {
            state.tool = 'step';
            resetToolCursor();
            syncOverlayUi();
        });
        el.btnFocusClear.addEventListener('click', () => clearSelectedBump(true));
        el.btnExportCsv.addEventListener('click', exportResultCsv);
        el.resultTable.addEventListener('click', (event) => {
            const row = event.target.closest('tr[data-bump]');
            if (!row || !el.resultTable.contains(row)) return;
            focusBump(Number(row.dataset.bump));
        });
        el.resultTable.addEventListener('keydown', (event) => {
            const row = event.target.closest('tr[data-bump]');
            if (!row || (event.key !== 'Enter' && event.key !== ' ')) return;
            event.preventDefault();
            focusBump(Number(row.dataset.bump));
        });
        el.resultHead.addEventListener('mousedown', (event) => {
            const button = event.target.closest('.sort-btn');
            if (!button || !el.resultHead.contains(button)) return;
            event.preventDefault();
            resultView.sideScrollHold = captureSideScroll();
        }, true);
        window.addEventListener('mouseup', () => {
            const hold = resultView.sideScrollHold;
            if (!hold) return;
            setTimeout(() => {
                if (resultView.sideScrollHold === hold) resultView.sideScrollHold = null;
            }, 0);
        });
        el.resultScroll.addEventListener('scroll', onResultTableScroll, { passive: true });
        const savedChart = getUserPref('profileChartStyle');
        profileChartStyle = savedChart === 'dots' ? 'dots' : 'line';
        syncProfileChartStyle();
        if (el.profileChartStyle) {
            el.profileChartStyle.addEventListener('click', (event) => {
                const btn = event.target.closest('button[data-profile-chart]');
                if (!btn) return;
                const style = btn.getAttribute('data-profile-chart');
                if ((style !== 'line' && style !== 'dots') || style === profileChartStyle) return;
                profileChartStyle = style;
                setUserPref('profileChartStyle', style);
                syncProfileChartStyle();
                renderProfileChart();
            });
        }
        el.profileMeasureBtn.addEventListener('click', toggleProfileMeasure);
        el.profileMeasureClearBtn.addEventListener('click', () => {
            if (!profileHasMeasures()) return;
            profileClearMeasures(true);
            drawProfileOverlay();
            syncOverlayUi();
        });
        bindProfileChart();
        bindMinimap();
        el.layerFold.addEventListener('click', () => {
            state.layerCollapsed = !state.layerCollapsed;
            syncOverlayUi();
            requestRender();
        });
        el.minimapFold.addEventListener('click', () => {
            state.minimapCollapsed = !state.minimapCollapsed;
            syncOverlayUi();
            requestRender();
        });
        el.rawHistFold.addEventListener('click', () => {
            state.rawHistCollapsed = !state.rawHistCollapsed;
            syncFoldChrome();
            requestRender();
        });
        el.bumpDetailFold.addEventListener('click', () => {
            state.bumpDetailCollapsed = !state.bumpDetailCollapsed;
            syncFoldChrome();
            syncBumpDetailBox();
        });
        el.showBumpDetail.addEventListener('change', () => {
            state.showBumpDetail = el.showBumpDetail.checked;
            syncOverlayUi();
            syncBumpDetailBox();
        });
        el.btnPeek.addEventListener('click', togglePeek);
        el.showResiduals.addEventListener('change', () => {
            state.showResiduals = el.showResiduals.checked;
            requestRender();
        });
        el.showHeightExtremes.addEventListener('change', () => {
            state.showHeightExtremes = el.showHeightExtremes.checked;
            applyHeightExtremeRows();
            requestRender();
        });
        el.showRawExtremes.addEventListener('change', () => {
            if (!isFilteredScatter()) return;
            state[seriesViewSpec().extremes] = el.showRawExtremes.checked;
            applyHeightExtremeRows();
            requestRender();
        });
        [
            [el.layerBump, 'bump'],
            [el.layerDonut, 'donut'],
            [el.layerDenoise, 'denoise'],
            [el.layerRejected, 'rejected'],
        ].forEach(([input, key]) => {
            input.addEventListener('change', () => {
                state.layers[key] = input.checked;
                if (key === 'donut') ensureDonutMask();
                if (state.profile.line) profileRecompute(false);
                else requestRender();
            });
        });
        [el.lengthMin, el.lengthMax, el.widthMin, el.widthMax, el.isolationPx, el.noiseMax].forEach((input) => {
            input.addEventListener('change', () => {
                const size = contourRange();
                if (rangeIsValid(size)) {
                    setUserPref('lengthMin', size.lengthMin);
                    setUserPref('lengthMax', size.lengthMax);
                    setUserPref('widthMin', size.widthMin);
                    setUserPref('widthMax', size.widthMax);
                    setUserPref('isolationPx', size.isolation);
                    setUserPref('noiseMax', size.noiseMax);
                }
                invalidateBumps();
                update();
            });
        });
        el.donutWidth.addEventListener('input', () => {
            setUserPref('donutWidth', Number(el.donutWidth.value));
            state.donutMask = null;
            clearComputedResult();
            if (state.step === 4) state.step = 3;
            update();
        });
        el.outlier.addEventListener('change', () => {
            setUserPref('outlier', el.outlier.value);
            clearComputedResult();
        });
        if (el.dotSize) {
            el.dotSize.addEventListener('input', () => {
                const scale = clamp(Number(el.dotSize.value), 0.4, 4);
                state.scatterDotScale = scale;
                if (el.dotSizeValue) el.dotSizeValue.textContent = scale.toFixed(1) + '×';
                setUserPref('dotScale', scale);
                requestRender();
            });
        }
        if (el.resultViewTabs) {
            el.resultViewTabs.addEventListener('click', (event) => {
                const btn = event.target.closest('[data-result-view]');
                if (!btn || btn.disabled) return;
                setResultView(btn.getAttribute('data-result-view'));
            });
        }
        el.stepper.querySelectorAll('.step').forEach((btn) => {
            btn.addEventListener('click', () => {
                const index = Number(btn.getAttribute('data-step'));
                if (index <= state.maxStep) setStep(index);
            });
        });
        [el.canvas, el.canvasBump, el.canvasBase].forEach(bindPointer);
        bindImageMenu();
        bindHist();
        bindRawHist();
        bindDrop();
        window.addEventListener('resize', () => {
            closeImageMenu();
            requestRender();
            if (resultView.order.length) renderResultWindow(true);
        });
        watchCanvasWrap();
        update();
    }

    return {
        bind,
        onLanguage() {
            syncColormapPicker(el.colormap);
            update();
        },
        /** 容器重新顯示或尺寸改變時重繪（WebViewer 子頁切換用） */
        resize() {
            closeImageMenu();
            if (state.dataset) fitView();
            requestRender();
            if (resultView.order.length) renderResultWindow(true);
        },
        repaint() {
            if (!state.dataset) return;
            const stage = state.step === 3 ? el.stageCompare : el.stageSingle;
            if (!stage || stage.clientWidth < 2) return;
            requestRender();
            if (resultView.order.length) renderResultWindow(true);
        },
        hasData() {
            return !!state.dataset;
        },
        loadDataset,
    };
})();
