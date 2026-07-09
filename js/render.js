/**
 * 2D 繪製
 * 依賴：colormap.js
 * 匯出（全域）：canvas 繪製函式
 */
/* =========================================================================
 *  3. 繪製
 * ========================================================================= */

let currentDataset = null;   // { data, width, height, vmin, vmax, header }

/* 色階顯示範圍：以資料 [vmin, vmax] 的比例表示（0~1）。
 * 拖曳 colorbar 上的兩個標籤即可調整哪段數值對應整條色帶。*/
const colorClip = { lo: 0, hi: 1 };

/** 依目前 colorClip 換算實際的色階上下界與區間 */
function effectiveColorRange(dataset) {
    const span = (dataset.vmax - dataset.vmin) || 1;
    const cmin = dataset.vmin + colorClip.lo * span;
    const cmax = dataset.vmin + colorClip.hi * span;
    return { cmin, cmax, crange: (cmax > cmin) ? (cmax - cmin) : 1e-12 };
}

function computeRange(data) {
    let vmin = Infinity, vmax = -Infinity;
    for (let i = 0; i < data.length; i++) {
        const v = data[i];
        if (!Number.isFinite(v)) continue;
        if (v < vmin) vmin = v;
        if (v > vmax) vmax = v;
    }
    if (!Number.isFinite(vmin) || !Number.isFinite(vmax)) { vmin = 0; vmax = 1; }
    if (vmin === vmax) { vmax = vmin + 1; }
    return { vmin, vmax };
}

function isLargeDataset(ds) {
    if (!ds) return false;
    if (ds.type === 'pcd-scatter') return (ds.pointCount || ds.z?.length || 0) >= 500_000;
    return (ds.width * ds.height) >= LARGE_PIXEL_THRESHOLD;
}

async function computeRangeAsync(data) {
    if (!data || data.length < LARGE_PIXEL_THRESHOLD) return computeRange(data);
    let vmin = Infinity, vmax = -Infinity;
    const chunk = 1_000_000;
    for (let i = 0; i < data.length; i += chunk) {
        const end = Math.min(data.length, i + chunk);
        for (let j = i; j < end; j++) {
            const v = data[j];
            if (!Number.isFinite(v)) continue;
            if (v < vmin) vmin = v;
            if (v > vmax) vmax = v;
        }
        await yieldToMain();
    }
    if (!Number.isFinite(vmin) || !Number.isFinite(vmax)) { vmin = 0; vmax = 1; }
    if (vmin === vmax) { vmax = vmin + 1; }
    return { vmin, vmax };
}

/* 畫面狀態：scale = CSS 顯示像素 / 影像像素；tx/ty 為左上角的位移(CSS px) */
const view = { scale: 1, tx: 0, ty: 0, minScale: 0.02, maxScale: 100 };

/** 散布點雲視埠：縮放只改變可見世界範圍，點在螢幕上維持固定像素大小 */
const scatterView = {
    centerX: 0,
    centerY: 0,
    worldPerPx: 1,
    baseWorldPerPx: 1,
    screenW: 1,
    screenH: 1,
    minWorldPerPx: 1e-6,
    maxWorldPerPx: 1e9,
};
/** 2D 散布點預設半徑（螢幕 CSS px）；會話內可調，不寫入偏好 */
const DEFAULT_SCATTER_POINT_SCREEN_RADIUS = 1;
const SCATTER_POINT_SIZE_MIN = 0.5;
const SCATTER_POINT_SIZE_MAX = 12;
let scatterPointScreenRadius = DEFAULT_SCATTER_POINT_SCREEN_RADIUS;
const SCATTER_POINT_SCREEN_RADIUS = DEFAULT_SCATTER_POINT_SCREEN_RADIUS;
let scatterRedrawQueued = false;

function clampScatterPointSize(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return DEFAULT_SCATTER_POINT_SCREEN_RADIUS;
    return Math.min(SCATTER_POINT_SIZE_MAX, Math.max(SCATTER_POINT_SIZE_MIN, n));
}

function getScatterPointSize() { return scatterPointScreenRadius; }

function setScatterPointSize(v, opts) {
    opts = opts || {};
    scatterPointScreenRadius = clampScatterPointSize(v);
    if (opts.redraw !== false && isPcdScatterDataset(currentDataset)
        && !(typeof view3dActive !== 'undefined' && view3dActive)) {
        requestScatterRedraw();
    }
    return scatterPointScreenRadius;
}

function resetScatterPointSize(opts) {
    return setScatterPointSize(DEFAULT_SCATTER_POINT_SCREEN_RADIUS, opts);
}

function isPcdScatterDataset(ds) {
    return ds && ds.type === 'pcd-scatter';
}

function getScatterViewerSize() {
    const viewer = document.getElementById('viewer');
    return {
        w: Math.max(1, viewer.clientWidth),
        h: Math.max(1, viewer.clientHeight),
    };
}

function fitScatterToViewer(dataset) {
    const { w, h } = getScatterViewerSize();
    const pad = 24;
    const b = dataset.bounds;
    const spanX = (b.xmax - b.xmin) || 1;
    const spanY = (b.ymax - b.ymin) || 1;
    const wpp = Math.max(spanX / Math.max(1, w - pad * 2), spanY / Math.max(1, h - pad * 2));

    scatterView.screenW = w;
    scatterView.screenH = h;
    scatterView.centerX = (b.xmin + b.xmax) * 0.5;
    scatterView.centerY = (b.ymin + b.ymax) * 0.5;
    scatterView.worldPerPx = wpp;
    scatterView.baseWorldPerPx = wpp;
    scatterView.minWorldPerPx = wpp / 100;
    scatterView.maxWorldPerPx = wpp * 100;
}

function scatterWorldToScreen(wx, wy) {
    const halfW = scatterView.screenW * 0.5;
    const halfH = scatterView.screenH * 0.5;
    return {
        sx: (wx - scatterView.centerX) / scatterView.worldPerPx + halfW,
        sy: (scatterView.centerY - wy) / scatterView.worldPerPx + halfH,
    };
}

/** 螢幕(viewer CSS) 座標 → 世界座標（scatterWorldToScreen 的逆運算） */
function scatterScreenToWorld(sx, sy) {
    const halfW = scatterView.screenW * 0.5;
    const halfH = scatterView.screenH * 0.5;
    return {
        wx: scatterView.centerX + (sx - halfW) * scatterView.worldPerPx,
        wy: scatterView.centerY - (sy - halfH) * scatterView.worldPerPx,
    };
}

function scatterZoomAt(screenX, screenY, zoomFactor) {
    const worldX = scatterView.centerX + (screenX - scatterView.screenW * 0.5) * scatterView.worldPerPx;
    const worldY = scatterView.centerY - (screenY - scatterView.screenH * 0.5) * scatterView.worldPerPx;

    let wpp = scatterView.worldPerPx / zoomFactor;
    if (wpp < scatterView.minWorldPerPx) wpp = scatterView.minWorldPerPx;
    if (wpp > scatterView.maxWorldPerPx) wpp = scatterView.maxWorldPerPx;

    scatterView.worldPerPx = wpp;
    scatterView.centerX = worldX - (screenX - scatterView.screenW * 0.5) * wpp;
    scatterView.centerY = worldY + (screenY - scatterView.screenH * 0.5) * wpp;
}

function scatterPanBy(dScreenX, dScreenY) {
    scatterView.centerX -= dScreenX * scatterView.worldPerPx;
    scatterView.centerY += dScreenY * scatterView.worldPerPx;
}

function requestScatterRedraw() {
    if (!isPcdScatterDataset(currentDataset)) return;
    if (scatterRedrawQueued) return;
    scatterRedrawQueued = true;
    requestAnimationFrame(() => {
        scatterRedrawQueued = false;
        if (!isPcdScatterDataset(currentDataset)) return;
        renderPcdScatter(currentDataset, cmapSelect.value);
        applyTransform();
    });
}

function applyTransform() {
    const canvas = document.getElementById('canvas');
    const ind = document.getElementById('zoomIndicator');

    if (isPcdScatterDataset(currentDataset)) {
        canvas.style.transform = 'none';
        const pct = (scatterView.baseWorldPerPx / scatterView.worldPerPx) * 100;
        ind.textContent = (pct >= 100 ? pct.toFixed(0) : pct.toFixed(1)) + '%';
        drawProfileOverlay();
        return;
    }

    canvas.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
    ind.textContent = (view.scale * 100).toFixed(view.scale >= 1 ? 0 : 1) + '%';
    drawProfileOverlay();
}

function fitImageToViewer() {
    if (!currentDataset) return;
    if (isPcdScatterDataset(currentDataset)) {
        fitScatterToViewer(currentDataset);
        renderPcdScatter(currentDataset, cmapSelect.value);
        applyTransform();
        return;
    }
    const viewer = document.getElementById('viewer');
    const vw = viewer.clientWidth;
    const vh = viewer.clientHeight;
    const w = currentDataset.width;
    const h = currentDataset.height;
    const padding = 24;
    const s = Math.min((vw - padding * 2) / w, (vh - padding * 2) / h, 8);
    view.scale = s > 0 ? s : 1;
    view.tx = (vw - w * view.scale) / 2;
    view.ty = (vh - h * view.scale) / 2;
    applyTransform();
}

/* 只重繪像素，不改變顯示 transform */
function renderPixels(dataset, cmap) {
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const { data, width, height, vmin, vmax } = dataset;

    canvas.width = width;
    canvas.height = height;

    const img = ctx.createImageData(width, height);
    const { cmin, crange } = effectiveColorRange(dataset);

    const lut = buildColormapLut(cmap);
    const px = img.data;
    for (let i = 0; i < data.length; i++) {
        const po = i * 4;
        const v = data[i];
        if (!Number.isFinite(v)) {
            px[po] = px[po + 1] = px[po + 2] = 0;
            px[po + 3] = 255;
            continue;
        }
        let t = (v - cmin) / crange;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        const idx = (t * 255) | 0;
        const lo = idx * 3;
        px[po]     = lut[lo];
        px[po + 1] = lut[lo + 1];
        px[po + 2] = lut[lo + 2];
        px[po + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
}

async function renderPixelsAsync(dataset, cmap, onProgress, canvasEl, colorRangeFn) {
    const canvas = canvasEl || document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const { data, width, height } = dataset;

    canvas.width = width;
    canvas.height = height;

    const img = ctx.createImageData(width, height);
    const rangeFn = colorRangeFn || ((ds) => effectiveColorRange(ds));
    const { cmin, crange } = rangeFn(dataset);
    const lut = buildColormapLut(cmap);
    const px = img.data;
    const rowChunk = (width * height) >= LARGE_PIXEL_THRESHOLD
        ? Math.max(4, Math.floor(400_000 / width))
        : 96;

    for (let row0 = 0; row0 < height; row0 += rowChunk) {
        const row1 = Math.min(height, row0 + rowChunk);
        for (let y = row0; y < row1; y++) {
            const rowOff = y * width;
            for (let x = 0; x < width; x++) {
                const i = rowOff + x;
                const po = i * 4;
                const v = data[i];
                if (!Number.isFinite(v)) {
                    px[po] = px[po + 1] = px[po + 2] = 0;
                    px[po + 3] = 255;
                    continue;
                }
                let t = (v - cmin) / crange;
                if (t < 0) t = 0; else if (t > 1) t = 1;
                const idx = (t * 255) | 0;
                const lo = idx * 3;
                px[po]     = lut[lo];
                px[po + 1] = lut[lo + 1];
                px[po + 2] = lut[lo + 2];
                px[po + 3] = 255;
            }
        }
        if (onProgress) onProgress(row1 / height);
        await yieldToMain();
    }
    ctx.putImageData(img, 0, 0);
}

/**
 * 完整渲染：畫像素、(視需要)重設縮放與平移、同步色階資訊
 * @param {boolean} resetView 是否重新 fit 到檢視區（載入新檔 / 視窗改變時為 true）
 */
function render(dataset, cmap, resetView = false) {
    const canvas = document.getElementById('canvas');
    if (dataset.type === 'pcd-scatter') {
        canvas.classList.add('scatter-view');
        renderPcdScatter(dataset, cmap);
    } else {
        canvas.classList.remove('scatter-view');
        // 清除散布模式遺留的行內尺寸，讓影像 canvas 依點陣大小 + transform 縮放顯示
        canvas.style.width = '';
        canvas.style.height = '';
        renderPixels(dataset, cmap);
    }

    canvas.style.display = 'block';
    document.getElementById('placeholder').style.display = 'none';
    document.getElementById('zoomIndicator').classList.add('show');
    document.getElementById('zoomHint').classList.add('show');

    if (resetView) fitImageToViewer();
    else applyTransform();

    renderColorbar(cmap);
    document.getElementById('zMin').textContent = dataset.vmin.toFixed(4);
    document.getElementById('zMax').textContent = dataset.vmax.toFixed(4);
    syncColorbarHandles();
    if (typeof updateModeIndicator === 'function') updateModeIndicator();
}

function renderColorbar(cmap) {
    const cb = document.getElementById('colorbarCanvas');
    const ctx = cb.getContext('2d');
    const w = cb.width, h = cb.height;
    const img = ctx.createImageData(w, h);
    // 色帶橫軸代表完整資料範圍；漸層只壓縮在 [lo, hi] 之間，
    // 兩游標越靠近，整條色彩被擠進越小的數值區間 = 對比越高。
    const lo = colorClip.lo, hi = colorClip.hi;
    const span = (hi > lo) ? (hi - lo) : 1e-12;
    for (let x = 0; x < w; x++) {
        const f = x / (w - 1);              // 0~1 對應 vmin~vmax
        let t = (f - lo) / span;            // 映射到色彩漸層位置
        if (t < 0) t = 0; else if (t > 1) t = 1;
        const [r, g, b] = sampleColormap(cmap, t);
        for (let y = 0; y < h; y++) {
            const p = (y * w + x) * 4;
            img.data[p]     = Math.round(r * 255);
            img.data[p + 1] = Math.round(g * 255);
            img.data[p + 2] = Math.round(b * 255);
            img.data[p + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
}

/** 依 colorClip 更新兩個標籤的位置與數值文字 */
function syncColorbarHandles() {
    const hLo = document.getElementById('cbHandleLo');
    const hHi = document.getElementById('cbHandleHi');
    const valLo = document.getElementById('cbValLo');
    const valHi = document.getElementById('cbValHi');
    if (!hLo || !hHi) return;

    hLo.style.left = (colorClip.lo * 100) + '%';
    hHi.style.left = (colorClip.hi * 100) + '%';

    if (currentDataset) {
        const span = currentDataset.vmax - currentDataset.vmin;
        const lo = currentDataset.vmin + colorClip.lo * span;
        const hi = currentDataset.vmin + colorClip.hi * span;
        valLo.textContent = lo.toFixed(3);
        valHi.textContent = hi.toFixed(3);
    } else {
        valLo.textContent = '';
        valHi.textContent = '';
    }
}

/** 重設色階顯示範圍為完整資料範圍 */
function resetColorClip(rerender = true) {
    colorClip.lo = 0;
    colorClip.hi = 1;
    if (rerender && currentDataset) {
        render(currentDataset, cmapSelect.value, false);
        if (typeof Viewer3D !== 'undefined' && Viewer3D.isActive()) Viewer3D.refreshColors();
    } else {
        syncColorbarHandles();
    }
}

/** 綁定 colorbar 兩個標籤的拖曳行為 */
function setupColorbarHandles() {
    const track = document.getElementById('colorbarTrack');
    const hLo = document.getElementById('cbHandleLo');
    const hHi = document.getElementById('cbHandleHi');
    const resetBtn = document.getElementById('cbReset');
    if (!track || !hLo || !hHi) return;

    const MIN_GAP = 0.01;
    let dragging = null;
    let rafPending = false;

    function fracFromClientX(clientX) {
        const r = track.getBoundingClientRect();
        if (r.width <= 0) return 0;
        let f = (clientX - r.left) / r.width;
        return Math.min(1, Math.max(0, f));
    }

    function scheduleRender() {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => {
            rafPending = false;
            if (currentDataset) render(currentDataset, cmapSelect.value, false);
            else syncColorbarHandles();
            if (typeof Viewer3D !== 'undefined' && Viewer3D.isActive()) Viewer3D.refreshColors();
        });
    }

    function onMove(e) {
        if (!dragging) return;
        const f = fracFromClientX(e.clientX);
        if (dragging === 'lo') {
            colorClip.lo = Math.min(f, colorClip.hi - MIN_GAP);
            if (colorClip.lo < 0) colorClip.lo = 0;
        } else {
            colorClip.hi = Math.max(f, colorClip.lo + MIN_GAP);
            if (colorClip.hi > 1) colorClip.hi = 1;
        }
        scheduleRender();
    }

    function endDrag() {
        if (!dragging) return;
        (dragging === 'lo' ? hLo : hHi).classList.remove('dragging');
        dragging = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', endDrag);
    }

    function startDrag(which, handle, e) {
        dragging = which;
        handle.classList.add('dragging');
        e.preventDefault();
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', endDrag);
    }

    hLo.addEventListener('pointerdown', (e) => startDrag('lo', hLo, e));
    hHi.addEventListener('pointerdown', (e) => startDrag('hi', hHi, e));

    if (resetBtn) resetBtn.addEventListener('click', () => resetColorClip(true));

    syncColorbarHandles();
}

function renderInfo(header, width, height, extra) {
    const list = document.getElementById('infoList');
    list.innerHTML = '';

    const addRow = (k, v) => {
        const row = document.createElement('div');
        row.className = 'info-row';
        row.innerHTML = `<span class="k">${k}</span><span class="v">${v}</span>`;
        list.appendChild(row);
    };

    if (extra && extra.pointCount != null) {
        addRow(t('infoPcdPoints'), String(extra.pointCount));
        addRow(t('infoSize'), `${width} × ${height} (${t('infoPcdScatter')})`);
    } else {
        addRow(t('infoSize'), `${width} × ${height}`);
    }
    for (const [k, v] of Object.entries(header)) {
        if (v === '' || v == null) continue;
        addRow(k, String(v).length > 30 ? String(v).slice(0, 30) + '…' : v);
    }
}


