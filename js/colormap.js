/**
 * 彩色映射 (Colormap)
 * 依賴：無
 * 匯出（全域）：colormap 查表與套用
 */
/* =========================================================================
 *  2. 彩色映射 (Colormap)
 * ========================================================================= */

// 常用 colormap (簡化版)：每個色階是 [r, g, b] (0~1)
const COLORMAPS = {
    viridis: [
        [0.267, 0.005, 0.329], [0.283, 0.141, 0.458], [0.254, 0.265, 0.530],
        [0.207, 0.372, 0.553], [0.164, 0.471, 0.558], [0.128, 0.567, 0.551],
        [0.135, 0.659, 0.518], [0.267, 0.749, 0.441], [0.478, 0.821, 0.318],
        [0.741, 0.873, 0.150], [0.993, 0.906, 0.144]
    ],
    jet: [
        [0, 0, 0.5], [0, 0, 1], [0, 0.5, 1], [0, 1, 1],
        [0.5, 1, 0.5], [1, 1, 0], [1, 0.5, 0], [1, 0, 0], [0.5, 0, 0]
    ],
    hot: [
        [0, 0, 0], [0.3, 0, 0], [0.6, 0, 0], [1, 0, 0],
        [1, 0.3, 0], [1, 0.6, 0], [1, 1, 0], [1, 1, 0.5], [1, 1, 1]
    ],
    gray: [[0, 0, 0], [1, 1, 1]],
    inferno: [
        [0.001, 0.000, 0.014], [0.112, 0.065, 0.302], [0.317, 0.072, 0.405],
        [0.510, 0.121, 0.408], [0.705, 0.182, 0.350], [0.866, 0.290, 0.217],
        [0.964, 0.493, 0.076], [0.993, 0.720, 0.128], [0.961, 0.936, 0.488],
        [0.988, 0.998, 0.645]
    ]
};

/**
 * 依 t (0~1) 在 stops 中線性內插得到 [r, g, b]
 */
function sampleColormap(cmapName, t) {
    const stops = COLORMAPS[cmapName] || COLORMAPS.viridis;
    if (t <= 0) return stops[0];
    if (t >= 1) return stops[stops.length - 1];
    const scaled = t * (stops.length - 1);
    const i = Math.floor(scaled);
    const f = scaled - i;
    const a = stops[i], b = stops[i + 1];
    return [
        a[0] + (b[0] - a[0]) * f,
        a[1] + (b[1] - a[1]) * f,
        a[2] + (b[2] - a[2]) * f
    ];
}

/** 建立 256 階 RGB 查表 (0~255) */
function buildColormapLut(cmapName) {
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
        const [r, g, b] = sampleColormap(cmapName, i / 255);
        lut[i * 3]     = Math.round(r * 255);
        lut[i * 3 + 1] = Math.round(g * 255);
        lut[i * 3 + 2] = Math.round(b * 255);
    }
    return lut;
}

/** 繪製完整色階預覽條 */
function renderColormapPreview(cmapName, canvasEl) {
    if (!canvasEl) return;
    const ctx = canvasEl.getContext('2d');
    const w = canvasEl.width, h = canvasEl.height;
    const lut = buildColormapLut(cmapName);
    const img = ctx.createImageData(w, h);
    for (let x = 0; x < w; x++) {
        const lo = (x / (w - 1) * 255) | 0;
        const r = lut[lo * 3], g = lut[lo * 3 + 1], b = lut[lo * 3 + 2];
        for (let y = 0; y < h; y++) {
            const p = (y * w + x) * 4;
            img.data[p] = r; img.data[p + 1] = g; img.data[p + 2] = b; img.data[p + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
}

/** 將原生 <select> 換成可預覽色條的自訂色彩選單 */
function setupColormapPicker(selectEl) {
    if (!selectEl || selectEl.dataset.colormapPicker) return;

    selectEl.dataset.colormapPicker = '1';
    const wrap = document.createElement('div');
    wrap.className = 'colormap-picker';
    selectEl.parentNode.insertBefore(wrap, selectEl);
    wrap.appendChild(selectEl);
    selectEl.classList.add('colormap-picker-native');
    selectEl.tabIndex = -1;

    const ui = document.createElement('div');
    ui.className = 'colormap-picker-ui';
    wrap.appendChild(ui);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'colormap-picker-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    ui.appendChild(trigger);

    const menu = document.createElement('div');
    menu.className = 'colormap-picker-menu';
    menu.setAttribute('role', 'listbox');
    ui.appendChild(menu);

    const previewWrap = document.createElement('div');
    previewWrap.className = 'colormap-picker-preview-wrap';
    const previewCanvas = document.createElement('canvas');
    previewCanvas.className = 'colormap-picker-preview';
    previewCanvas.width = 200;
    previewCanvas.height = 14;
    previewCanvas.setAttribute('role', 'img');
    previewCanvas.setAttribute('aria-hidden', 'true');
    previewWrap.appendChild(previewCanvas);
    menu.appendChild(previewWrap);

    const optionEls = [];
    [...selectEl.options].forEach(opt => {
        const item = document.createElement('div');
        item.className = 'colormap-picker-option';
        item.setAttribute('role', 'option');
        item.dataset.value = opt.value;
        item.textContent = opt.textContent;
        menu.appendChild(item);
        optionEls.push(item);

        item.addEventListener('mouseenter', () => {
            showColormapPreview(opt.value, item);
        });
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            selectValue(opt.value);
        });
    });

    function showColormapPreview(value, focusItem) {
        wrap.classList.add('preview-visible');
        renderColormapPreview(value, previewCanvas);
        optionEls.forEach(o => o.classList.toggle('focused', o === focusItem));
    }

    function showCurrentColormapPreview() {
        const current = optionEls.find(o => o.dataset.value === selectEl.value) || null;
        showColormapPreview(selectEl.value, current);
    }

    menu.addEventListener('mouseleave', () => {
        showCurrentColormapPreview();
    });
    menu.addEventListener('click', (e) => e.stopPropagation());

    function syncTrigger() {
        const opt = selectEl.options[selectEl.selectedIndex];
        trigger.textContent = opt ? opt.textContent : '';
        optionEls.forEach(o => o.classList.toggle('selected', o.dataset.value === selectEl.value));
    }

    function selectValue(value) {
        if (selectEl.value !== value) {
            selectEl.value = value;
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
            syncTrigger();
        }
        closeMenu();
    }

    function openMenu() {
        wrap.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
        syncTrigger();
        showCurrentColormapPreview();
    }

    function closeMenu() {
        wrap.classList.remove('open', 'preview-visible');
        trigger.setAttribute('aria-expanded', 'false');
        optionEls.forEach(o => o.classList.remove('focused'));
    }

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (wrap.classList.contains('open')) closeMenu();
        else openMenu();
    });

    document.addEventListener('click', (e) => {
        if (!wrap.contains(e.target)) closeMenu();
    });

    selectEl.addEventListener('change', syncTrigger);
    selectEl._syncColormapPicker = syncTrigger;
    syncTrigger();
}

function syncColormapPicker(selectEl) {
    if (selectEl && typeof selectEl._syncColormapPicker === 'function') {
        selectEl._syncColormapPicker();
    }
}

function closeAllColormapPickers() {
    document.querySelectorAll('.colormap-picker.open').forEach(wrap => {
        wrap.classList.remove('open', 'preview-visible');
        const trigger = wrap.querySelector('.colormap-picker-trigger');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
        wrap.querySelectorAll('.colormap-picker-option.focused').forEach(o => o.classList.remove('focused'));
    });
}

/** 世界座標 → 畫布像素（Y 軸向上，畫布 Y 向下） */
function pcdWorldToCanvasPx(dataset, wx, wy) {
    const { bounds, width, height } = dataset;
    const spanX = bounds.xmax - bounds.xmin || 1;
    const spanY = bounds.ymax - bounds.ymin || 1;
    return {
        px: ((wx - bounds.xmin) / spanX) * (width - 1),
        py: ((bounds.ymax - wy) / spanY) * (height - 1),
    };
}

/** 在 ImageData 上畫單像素點 */
function stampPixel(px, width, height, ix, iy, r, g, b) {
    if (ix < 0 || iy < 0 || ix >= width || iy >= height) return;
    const po = (iy * width + ix) * 4;
    px[po] = r;
    px[po + 1] = g;
    px[po + 2] = b;
    px[po + 3] = 255;
}

/** 在 ImageData 上戳印實心圓點 */
function stampDisk(px, width, height, cx, cy, radius, r, g, b) {
    if (radius <= 0) {
        stampPixel(px, width, height, Math.round(cx), Math.round(cy), r, g, b);
        return;
    }
    const r2 = radius * radius;
    const x0 = Math.max(0, Math.ceil(cx - radius));
    const x1 = Math.min(width - 1, Math.floor(cx + radius));
    const y0 = Math.max(0, Math.ceil(cy - radius));
    const y1 = Math.min(height - 1, Math.floor(cy + radius));
    for (let y = y0; y <= y1; y++) {
        const dy = y - cy;
        for (let x = x0; x <= x1; x++) {
            const dx = x - cx;
            if (dx * dx + dy * dy > r2) continue;
            const po = (y * width + x) * 4;
            px[po] = r;
            px[po + 1] = g;
            px[po + 2] = b;
            px[po + 3] = 255;
        }
    }
}

/** 散布繪製：世界座標 → 螢幕座標，點大小為可調螢幕像素 */
function renderPcdScatter(dataset, cmap) {
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const { x, y, z, vmin, vmax } = dataset;
    const n = z.length;
    const R = (typeof getScatterPointSize === 'function')
        ? getScatterPointSize()
        : DEFAULT_SCATTER_POINT_SCREEN_RADIUS;

    const { w: sw, h: sh } = getScatterViewerSize();
    scatterView.screenW = sw;
    scatterView.screenH = sh;

    // putImageData 不受 ctx 變換影響，緩衝區須用實際 device 像素（含 HiDPI）
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.max(1, Math.round(sw * dpr));
    const bh = Math.max(1, Math.round(sh * dpr));
    canvas.width = bw;
    canvas.height = bh;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const img = ctx.createImageData(bw, bh);
    const px = img.data;
    const lut = buildColormapLut(cmap);
    const { cmin, crange } = effectiveColorRange(dataset);
    const rBuf = R > 0 ? R * dpr : 0;

    const screenX = new Int16Array(n);
    const screenY = new Int16Array(n);

    for (let i = 0; i < n; i++) {
        const { sx, sy } = scatterWorldToScreen(x[i], y[i]);
        const ix = Math.round(sx);
        const iy = Math.round(sy);
        screenX[i] = ix;
        screenY[i] = iy;

        if (ix < -R || iy < -R || ix > sw + R || iy > sh + R) continue;

        const bx = Math.round(sx * dpr);
        const by = Math.round(sy * dpr);

        let t = (z[i] - cmin) / crange;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        const li = (t * 255) | 0;
        const lo = li * 3;
        const cr = lut[lo], cg = lut[lo + 1], cb = lut[lo + 2];
        if (R <= 0) stampPixel(px, bw, bh, bx, by, cr, cg, cb);
        else stampDisk(px, bw, bh, sx * dpr, sy * dpr, rBuf, cr, cg, cb);
    }

    ctx.putImageData(img, 0, 0);

    const pickCell = 24;
    const buckets = new Map();
    for (let i = 0; i < n; i++) {
        const bx = (screenX[i] / pickCell) | 0;
        const by = (screenY[i] / pickCell) | 0;
        const key = bx + ',' + by;
        let list = buckets.get(key);
        if (!list) { list = []; buckets.set(key, list); }
        list.push(i);
    }
    dataset._pick = { buckets, screenX, screenY, pickCell, pickRadius: Math.max(6, R + 4) };
}

/** 散布模式：找游標附近最近的點 */
function findNearestPcdPoint(dataset, canvasPx, canvasPy) {
    const pick = dataset._pick;
    if (!pick) return null;

    const { buckets, screenX, screenY, pickCell, pickRadius } = pick;
    const bx = (canvasPx / pickCell) | 0;
    const by = (canvasPy / pickCell) | 0;
    const r2max = pickRadius * pickRadius;
    let best = null;
    let bestD2 = r2max;

    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            const list = buckets.get((bx + dx) + ',' + (by + dy));
            if (!list) continue;
            for (let k = 0; k < list.length; k++) {
                const i = list[k];
                const ddx = screenX[i] - canvasPx;
                const ddy = screenY[i] - canvasPy;
                const d2 = ddx * ddx + ddy * ddy;
                if (d2 < bestD2) {
                    bestD2 = d2;
                    best = i;
                }
            }
        }
    }
    return best;
}


