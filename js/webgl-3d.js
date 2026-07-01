/**
 * 3D WebGL 點雲渲染
 * 依賴：colormap.js
 * 匯出（全域）：WebGL 渲染器
 */
/* =========================================================================
 *  6. 3D 立體顯示 (自包含 WebGL 點雲渲染器，含軌道控制，不依賴外部函式庫)
 * ========================================================================= */

const Viewer3D = (() => {
    const canvas = document.getElementById('canvas3d');
    const MAX_POINTS = 2_000_000;       // 超過則等距抽樣，維持互動順暢
    const POINT_PX   = 2.2;             // 點的螢幕像素大小 (再乘 dpr)

    let gl = null;
    let program = null;
    let posBuffer = null;
    let colorBuffer = null;
    let attribPos = -1, attribColor = -1;
    let uMVP = null, uPointSize = null;
    let supported = null;               // null=未測試, true/false=結果

    let vertexCount = 0;
    let positions = null;               // Float32Array(count*3) 已置中、正規化
    let stride = 1;                     // 抽樣間隔
    let active = false;
    let renderQueued = false;

    // 軌道相機狀態：target 固定原點 (幾何已置中)，以方位角/仰角/距離環繞
    const cam = { theta: 0.7, phi: 0.85, dist: 2.4, tx: 0, ty: 0, tz: 0 };
    const DEFAULT_CAM = { theta: 0.7, phi: 0.85, dist: 2.4 };

    /* ---- 簡易 4x4 矩陣 (column-major)，僅供本模組使用 ---- */
    function mat4Perspective(fovy, aspect, near, far) {
        const f = 1 / Math.tan(fovy / 2);
        const nf = 1 / (near - far);
        return new Float32Array([
            f / aspect, 0, 0, 0,
            0, f, 0, 0,
            0, 0, (far + near) * nf, -1,
            0, 0, 2 * far * near * nf, 0,
        ]);
    }
    function mat4LookAt(eye, center, up) {
        let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
        let zl = Math.hypot(zx, zy, zz) || 1; zx /= zl; zy /= zl; zz /= zl;
        let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
        let xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xy /= xl; xz /= xl;
        const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
        return new Float32Array([
            xx, yx, zx, 0,
            xy, yy, zy, 0,
            xz, yz, zz, 0,
            -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
            -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
            -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
            1,
        ]);
    }
    function mat4Mul(a, b) {
        const o = new Float32Array(16);
        for (let c = 0; c < 4; c++) {
            for (let r = 0; r < 4; r++) {
                o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
                               a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
            }
        }
        return o;
    }

    function compile(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            console.error('shader error:', gl.getShaderInfoLog(s));
            gl.deleteShader(s);
            return null;
        }
        return s;
    }

    function initGL() {
        if (supported !== null) return supported;
        try {
            gl = canvas.getContext('webgl', { antialias: true, alpha: false }) ||
                 canvas.getContext('experimental-webgl', { antialias: true, alpha: false });
        } catch (_) { gl = null; }
        if (!gl) { supported = false; return false; }

        const vs = compile(gl.VERTEX_SHADER, `
            attribute vec3 aPos;
            attribute vec3 aColor;
            uniform mat4 uMVP;
            uniform float uPointSize;
            varying vec3 vColor;
            void main() {
                gl_Position = uMVP * vec4(aPos, 1.0);
                gl_PointSize = uPointSize;
                vColor = aColor;
            }
        `);
        const fs = compile(gl.FRAGMENT_SHADER, `
            precision mediump float;
            varying vec3 vColor;
            void main() {
                vec2 d = gl_PointCoord - vec2(0.5);
                if (dot(d, d) > 0.25) discard;
                gl_FragColor = vec4(vColor, 1.0);
            }
        `);
        if (!vs || !fs) { supported = false; return false; }

        program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('program link error:', gl.getProgramInfoLog(program));
            supported = false;
            return false;
        }
        attribPos    = gl.getAttribLocation(program, 'aPos');
        attribColor  = gl.getAttribLocation(program, 'aColor');
        uMVP         = gl.getUniformLocation(program, 'uMVP');
        uPointSize   = gl.getUniformLocation(program, 'uPointSize');
        posBuffer    = gl.createBuffer();
        colorBuffer  = gl.createBuffer();

        gl.clearColor(0.078, 0.082, 0.11, 1.0);
        gl.enable(gl.DEPTH_TEST);
        supported = true;
        return true;
    }

    /** 由 dataset 計算每個點的平面座標(px,pz)、高度值，回傳擷取器 */
    function datasetAccessors(ds) {
        if (isPcdScatterDataset(ds)) {
            const { x, y, z } = ds;
            const n = z.length;
            return {
                count: n,
                isImage: false,
                planarX: (i) => x[i],
                planarZ: (i) => y[i],
                height:  (i) => z[i],
                valid:   (i) => Number.isFinite(z[i]) && Number.isFinite(x[i]) && Number.isFinite(y[i]),
            };
        }
        const { data, width, height } = ds;
        const n = data.length;
        // 以 header 的實體尺寸 (x-length/y-length) 決定平面長寬比；
        // 缺少時退回像素數。如此非正方形掃描不會被拉歪。
        const hdr = ds.header || {};
        let xl = parseFloat(hdr.xlength ?? hdr['x-length'] ?? 0);
        let yl = parseFloat(hdr.ylength ?? hdr['y-length'] ?? 0);
        if (!Number.isFinite(xl) || xl <= 0) xl = width;
        if (!Number.isFinite(yl) || yl <= 0) yl = height;
        const dx = xl / Math.max(1, width - 1);
        const dy = yl / Math.max(1, height - 1);
        return {
            count: n,
            isImage: true,
            planarX: (i) => (i % width) * dx,
            planarZ: (i) => ((i / width) | 0) * dy,
            height:  (i) => data[i],
            valid:   (i) => Number.isFinite(data[i]),
        };
    }

    /** 依資料建立頂點 (置中 + 正規化)；平的高度圖會自動誇張高度方便觀察 */
    function buildGeometry(ds) {
        const acc = datasetAccessors(ds);
        const n = acc.count;

        let xmin = Infinity, xmax = -Infinity;
        let zmin = Infinity, zmax = -Infinity;
        let hmin = Infinity, hmax = -Infinity;
        let valid = 0;
        for (let i = 0; i < n; i++) {
            if (!acc.valid(i)) continue;
            valid++;
            const px = acc.planarX(i), pz = acc.planarZ(i), h = acc.height(i);
            if (px < xmin) xmin = px; if (px > xmax) xmax = px;
            if (pz < zmin) zmin = pz; if (pz > zmax) zmax = pz;
            if (h < hmin) hmin = h;  if (h > hmax) hmax = h;
        }
        if (valid === 0) { vertexCount = 0; positions = null; return false; }

        stride = Math.max(1, Math.ceil(valid / MAX_POINTS));

        const spanX = (xmax - xmin) || 1;
        const spanZ = (zmax - zmin) || 1;
        const spanH = (hmax - hmin) || 1;
        const xmid = (xmin + xmax) / 2;
        const zmid = (zmin + zmax) / 2;
        const hmid = (hmin + hmax) / 2;

        const spanXZ = Math.max(spanX, spanZ);
        const scaleXZ = 1 / spanXZ;
        let scaleY;
        if (acc.isImage) {
            // 影像高度圖：z 與平面常為不同單位 (例如平面 nm/µm、z 為 nm)，
            // 無法可靠比較，統一把高度範圍縮放到平面的固定比例，避免比例失真。
            scaleY = 0.35 / spanH;
        } else {
            // 真實點雲：x/y/z 同單位，盡量維持真實比例；太扁才誇張到 0.4。
            const trueH = spanH * scaleXZ;
            scaleY = (trueH < 0.15 && spanH > 0) ? (0.4 / spanH) : scaleXZ;
        }

        const outCount = Math.ceil(valid / stride);
        positions = new Float32Array(outCount * 3);
        let w = 0, seen = 0;
        for (let i = 0; i < n; i++) {
            if (!acc.valid(i)) continue;
            if ((seen++ % stride) !== 0) continue;
            positions[w * 3]     = (acc.planarX(i) - xmid) * scaleXZ;
            positions[w * 3 + 1] = (acc.height(i)  - hmid) * scaleY;
            positions[w * 3 + 2] = (acc.planarZ(i) - zmid) * scaleXZ;
            w++;
        }
        vertexCount = w;

        gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, positions.subarray(0, w * 3), gl.STATIC_DRAW);
        return true;
    }

    /** 依目前色階重新計算每個點顏色 (與 2D 共用 colormap / colorClip) */
    function buildColors(ds) {
        if (vertexCount === 0) return;
        const acc = datasetAccessors(ds);
        const n = acc.count;
        const lut = buildColormapLut(cmapSelect.value);
        const { cmin, crange } = effectiveColorRange(ds);

        const colors = new Float32Array(vertexCount * 3);
        let w = 0, seen = 0;
        for (let i = 0; i < n; i++) {
            if (!acc.valid(i)) continue;
            if ((seen++ % stride) !== 0) continue;
            let tt = (acc.height(i) - cmin) / crange;
            if (tt < 0) tt = 0; else if (tt > 1) tt = 1;
            const li = (tt * 255 | 0) * 3;
            colors[w * 3]     = lut[li] / 255;
            colors[w * 3 + 1] = lut[li + 1] / 255;
            colors[w * 3 + 2] = lut[li + 2] / 255;
            w++;
            if (w >= vertexCount) break;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
    }

    function resize() {
        if (!gl) return;
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
        const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
        gl.viewport(0, 0, canvas.width, canvas.height);
    }

    function draw() {
        if (!gl) return;
        resize();
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        if (vertexCount === 0) return;

        const aspect = canvas.width / canvas.height || 1;
        const proj = mat4Perspective(50 * Math.PI / 180, aspect, 0.01, 100);

        const cp = Math.cos(cam.phi), sp = Math.sin(cam.phi);
        const ct = Math.cos(cam.theta), st = Math.sin(cam.theta);
        const eye = [
            cam.tx + cam.dist * cp * st,
            cam.ty + cam.dist * sp,
            cam.tz + cam.dist * cp * ct,
        ];
        const view = mat4LookAt(eye, [cam.tx, cam.ty, cam.tz], [0, 1, 0]);
        const mvp = mat4Mul(proj, view);

        gl.useProgram(program);
        gl.uniformMatrix4fv(uMVP, false, mvp);
        gl.uniform1f(uPointSize, POINT_PX * (window.devicePixelRatio || 1));

        gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
        gl.enableVertexAttribArray(attribPos);
        gl.vertexAttribPointer(attribPos, 3, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
        gl.enableVertexAttribArray(attribColor);
        gl.vertexAttribPointer(attribColor, 3, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.POINTS, 0, vertexCount);
    }

    function requestDraw() {
        if (renderQueued) return;
        renderQueued = true;
        requestAnimationFrame(() => { renderQueued = false; if (active) draw(); });
    }

    function resetCamera() {
        cam.theta = DEFAULT_CAM.theta;
        cam.phi   = DEFAULT_CAM.phi;
        cam.dist  = DEFAULT_CAM.dist;
        cam.tx = cam.ty = cam.tz = 0;
    }

    /* ---- 軌道控制：左鍵旋轉 / 右鍵或 Shift 平移 / 滾輪縮放 ---- */
    let drag = null;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
        const pan = (e.button === 2) || e.shiftKey;
        drag = { x: e.clientX, y: e.clientY, pan };
        canvas.classList.add('grabbing');
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        drag.x = e.clientX; drag.y = e.clientY;
        if (drag.pan) {
            // forward = target - eye (單位向量)
            const cp = Math.cos(cam.phi), sp = Math.sin(cam.phi);
            const ct = Math.cos(cam.theta), st = Math.sin(cam.theta);
            const fnx = -cp * st, fny = -sp, fnz = -cp * ct;
            // right = forward × worldUp(0,1,0) = (-fz, 0, fx)
            let rx = -fnz, ry = 0, rz = fnx;
            const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
            // up = right × forward
            const ux = ry * fnz - rz * fny;
            const uy = rz * fnx - rx * fnz;
            const uz = rx * fny - ry * fnx;
            const k = cam.dist * 0.0018;
            cam.tx += (-dx * rx + dy * ux) * k;
            cam.ty += (-dx * ry + dy * uy) * k;
            cam.tz += (-dx * rz + dy * uz) * k;
        } else {
            cam.theta -= dx * 0.008;
            cam.phi   += dy * 0.008;
            const lim = 1.5533;   // 約 89°，避免翻轉
            if (cam.phi > lim) cam.phi = lim;
            if (cam.phi < -lim) cam.phi = -lim;
        }
        requestDraw();
    });
    function endDrag(e) {
        if (!drag) return;
        drag = null;
        canvas.classList.remove('grabbing');
        if (e && e.pointerId != null) { try { canvas.releasePointerCapture(e.pointerId); } catch (_) {} }
    }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const f = Math.exp(e.deltaY * 0.0012);
        cam.dist *= f;
        if (cam.dist < 0.05) cam.dist = 0.05;
        if (cam.dist > 50) cam.dist = 50;
        requestDraw();
    }, { passive: false });
    canvas.addEventListener('dblclick', (e) => { e.preventDefault(); resetCamera(); requestDraw(); });

    return {
        isSupported() { return initGL(); },
        isActive() { return active; },
        enter(ds) {
            if (!initGL()) return false;
            if (!buildGeometry(ds)) return false;
            buildColors(ds);
            resetCamera();
            active = true;
            requestAnimationFrame(() => { resize(); draw(); });
            return true;
        },
        exit() { active = false; },
        /** 切換色彩或色階範圍時更新顏色 */
        refreshColors() {
            if (!active) return;
            buildColors(currentDataset);
            requestDraw();
        },
        /** 載入新資料時重建幾何 */
        rebuild() {
            if (!active) return false;
            if (!buildGeometry(currentDataset)) { active = false; return false; }
            buildColors(currentDataset);
            resetCamera();
            requestDraw();
            return true;
        },
        onResize() { if (active) requestDraw(); },
    };
})();

let view3dActive = false;

function updateViewModeButtons() {
    document.querySelectorAll('#viewModeToggle button').forEach(b => {
        const is3d = b.getAttribute('data-viewmode') === '3d';
        b.classList.toggle('active', is3d === view3dActive);
    });
}

function setViewMode(mode) {
    const want3d = (mode === '3d');
    const viewer = document.getElementById('viewer');

    if (want3d) {
        if (!currentDataset) {
            showToast(t('toast3dNoData'), 'info');
            updateViewModeButtons();
            return;
        }
        if (!Viewer3D.isSupported() || !Viewer3D.enter(currentDataset)) {
            showToast(t('toast3dNoWebgl'), 'error');
            updateViewModeButtons();
            return;
        }
        view3dActive = true;
        viewer.classList.add('mode-3d');
        setUserPref('viewMode', '3d');
    } else {
        Viewer3D.exit();
        view3dActive = false;
        viewer.classList.remove('mode-3d');
        setUserPref('viewMode', '2d');
        // 回到 2D：重新套用縮放/平移與剖面覆蓋層
        if (currentDataset) {
            applyTransform();
            if (typeof drawProfileOverlay === 'function') drawProfileOverlay();
        }
    }
    updateViewModeButtons();
    if (typeof updateModeIndicator === 'function') updateModeIndicator();
}

document.querySelectorAll('#viewModeToggle button').forEach(btn => {
    btn.addEventListener('click', () => setViewMode(btn.getAttribute('data-viewmode')));
});

