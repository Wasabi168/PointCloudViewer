/**
 * 檔案輸出
 * 依賴：file-parse.js
 * 匯出（全域）：write/save 相關函式
 */
/* =========================================================================
 *  1b. 檔案輸出 (對應 wr_file.py 中的 write_*_file_thread)
 * ========================================================================= */

/** 將 header dict 的 key 由 ASC 風格轉回 BCRF 風格 */
function headerAscToBcrf(h) {
    const map = {
        'x-pixels': 'xpixels', 'y-pixels': 'ypixels',
        'x-length': 'xlength', 'y-length': 'ylength',
        'z-unit': 'zunit', 'x-unit': 'xunit', 'y-unit': 'yunit'
    };
    const out = {};
    for (const [k, v] of Object.entries(h || {})) {
        out[map[k] || k] = v;
    }
    if (out.zunit && !out.xunit && !out.yunit) {
        out.xunit = 'nm';
        out.yunit = 'nm';
    }
    delete out['File Format'];
    out.fileformat = out.fileformat || 'bcrf';
    return out;
}

/** 將 header dict 的 key 由 BCRF 風格轉為 ASC 風格 */
function headerBcrfToAsc(h) {
    const map = {
        xpixels: 'x-pixels', ypixels: 'y-pixels',
        xlength: 'x-length', ylength: 'y-length',
        zunit: 'z-unit', xunit: 'x-unit', yunit: 'y-unit'
    };
    const out = {};
    for (const [k, v] of Object.entries(h || {})) {
        out[map[k] || k] = v;
    }
    delete out.fileformat;
    out['File Format'] = 'ASCII';
    return out;
}

/** 建立一份「標準 BCRF header」，以目前資料補上遺漏的欄位 */
function buildCanonicalBcrfHeader(dataset) {
    const base = headerAscToBcrf(dataset.header);
    const defaults = {
        fileformat: 'bcrf_unicode',
        headersize: '2048',
        xpixels: dataset.width,
        ypixels: dataset.height,
        xlength: dataset.width,
        ylength: dataset.height,
        scanspeed: '0',
        intelmode: '1',
        bit2nm: '1',
        xoffset: '0',
        yoffset: '0',
        voidpixels: '0',
        zmin: '0',
        xunit: 'mm',
        yunit: 'mm',
        zunit: 'um',
        forcecurve: '0'
    };
    const out = { ...defaults, ...base };
    // 影像實際大小為最終依據
    out.xpixels = dataset.width;
    out.ypixels = dataset.height;
    return out;
}

/** 下載 Blob */
function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function stripExt(name) {
    if (!name) return 'image';
    return name.replace(/\.[^.\\/]+$/, '') || name;
}


/* ---------- BCRF ---------- */
function writeBcrf(dataset, onProgress) {
    const HEADER_SIZE = 2048;
    const h = buildCanonicalBcrfHeader(dataset);

    let headerStr = '';
    for (const [k, v] of Object.entries(h)) headerStr += `${k} = ${v}\n`;
    // 補 '%' 直到 2048 bytes (ASCII → 1 byte/char)
    if (headerStr.length < HEADER_SIZE) headerStr = headerStr.padEnd(HEADER_SIZE, '%');

    const encoder = new TextEncoder();
    const rawHeader = encoder.encode(headerStr);
    const headerBuf = new Uint8Array(HEADER_SIZE);
    headerBuf.set(rawHeader.subarray(0, HEADER_SIZE));
    if (onProgress) onProgress(0.2);

    // data 轉 float32 little-endian (Float32Array 本身就是 LE)
    // 保留 NaN / ±Inf 原始值 (IEEE 754 在 float32 中有對應的 bit pattern)
    let f32;
    if (dataset.data instanceof Float32Array) {
        f32 = dataset.data;
    } else {
        f32 = new Float32Array(dataset.data.length);
        for (let i = 0; i < dataset.data.length; i++) f32[i] = dataset.data[i];
    }
    const dataBuf = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
    if (onProgress) onProgress(0.9);

    const blob = new Blob([headerBuf, dataBuf], { type: 'application/octet-stream' });
    if (onProgress) onProgress(1.0);
    return blob;
}


/* ---------- ASC ---------- */
function writeAsc(dataset, onProgress) {
    const { data, width, height } = dataset;
    const h = headerBcrfToAsc(buildCanonicalBcrfHeader(dataset));
    h['x-pixels'] = width;
    h['y-pixels'] = height;

    let text = '';
    for (const [k, v] of Object.entries(h)) text += `# ${k} = ${v}\n`;
    text += '\n# Start of Data:\n';

    if (onProgress) onProgress(0.1);

    const parts = [text];
    // 一次處理一列，避免單一字串過大
    for (let y = 0; y < height; y++) {
        const rowParts = new Array(width);
        for (let x = 0; x < width; x++) {
            const v = data[y * width + x];
            // 保留 NaN / Inf（對應 Python 不做 nan_to_zero，np.round(NaN)=NaN → str 為 'nan'）
            if (Number.isNaN(v)) {
                rowParts[x] = 'nan';
            } else if (v === Infinity) {
                rowParts[x] = 'inf';
            } else if (v === -Infinity) {
                rowParts[x] = '-inf';
            } else {
                // 對應 Python np.round(data, 3)
                rowParts[x] = (Math.round(v * 1000) / 1000).toString();
            }
        }
        parts.push(rowParts.join(' ') + '\n');
        if (onProgress && (y & 31) === 0) onProgress(0.1 + 0.9 * (y + 1) / height);
    }

    const blob = new Blob(parts, { type: 'text/plain;charset=utf-8' });
    if (onProgress) onProgress(1.0);
    return blob;
}


/* ---------- TXT（三欄位 x y z，對應 MicroVu / readTxt） ---------- */
function writeTxt(dataset, onProgress) {
    if (!dataset || dataset.type !== 'pcd-scatter') {
        throw new Error(t('errSaveFmt', 'txt'));
    }
    const { x, y, z } = dataset;
    const n = dataset.pointCount || (z && z.length) || 0;
    if (!x || !y || !z || n === 0) throw new Error(t('errTxtNoData'));

    if (onProgress) onProgress(0.05);

    const parts = [];
    const batchSize = 50000;
    let chunk = '';
    for (let i = 0; i < n; i++) {
        chunk += `${x[i]} ${y[i]} ${z[i]}\n`;
        if ((i + 1) % batchSize === 0 || i === n - 1) {
            parts.push(chunk);
            chunk = '';
            if (onProgress) onProgress(0.05 + 0.9 * ((i + 1) / n));
        }
    }

    const blob = new Blob(parts, { type: 'text/plain;charset=utf-8' });
    if (onProgress) onProgress(1.0);
    return blob;
}


/* ---------- PCD（x y z，盡量沿用載入時的 DATA 編碼） ---------- */
function resolvePcdDataMode(dataset) {
    const d = String((dataset && dataset.header && dataset.header.DATA) || '').toLowerCase();
    if (d === 'ascii') return 'ascii';
    // binary_compressed 寫回改為 binary（仍為合法 PCD，無需 LZF）
    return 'binary';
}

function buildPcdHeaderText(n, dataMode, width, height) {
    const w = (width != null && width > 0) ? width : n;
    const h = (height != null && height > 0) ? height : 1;
    return [
        '# .PCD v0.7 - Point Cloud Data file format',
        'VERSION 0.7',
        'FIELDS x y z',
        'SIZE 4 4 4',
        'TYPE F F F',
        'COUNT 1 1 1',
        `WIDTH ${w}`,
        `HEIGHT ${h}`,
        'VIEWPOINT 0 0 0 1 0 0 0',
        `POINTS ${n}`,
        `DATA ${dataMode}`,
        ''
    ].join('\n');
}

/** 從散布點雲取出 x/y/z 陣列 */
function pcdScatterXYZ(dataset) {
    const { x, y, z } = dataset;
    const n = dataset.pointCount || (z && z.length) || 0;
    if (!x || !y || !z || n === 0) throw new Error(t('errTxtNoData'));
    return { x, y, z, n, width: n, height: 1 };
}

/**
 * 從高度網格重建 x/y/z（有序 PCD：WIDTH×HEIGHT）。
 * x/y 使用像素索引，與 organized 載入路徑相容。
 */
function pcdGridXYZ(dataset) {
    const { width, height, data } = dataset;
    if (!data || !width || !height) throw new Error(t('errSaveFmt', 'pcd'));
    const n = width * height;
    const x = new Float32Array(n);
    const y = new Float32Array(n);
    const z = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        x[i] = i % width;
        y[i] = (i / width) | 0;
        z[i] = data[i];
    }
    return { x, y, z, n, width, height };
}

function writePcdAscii(xyz, headerText, onProgress) {
    const { x, y, z, n } = xyz;
    const parts = [headerText];
    const batchSize = 50000;
    let chunk = '';
    for (let i = 0; i < n; i++) {
        const xi = x[i], yi = y[i], zi = z[i];
        chunk += `${xi} ${yi} ${zi}\n`;
        if ((i + 1) % batchSize === 0 || i === n - 1) {
            parts.push(chunk);
            chunk = '';
            if (onProgress) onProgress(0.1 + 0.85 * ((i + 1) / n));
        }
    }
    return new Blob(parts, { type: 'application/octet-stream' });
}

function writePcdBinary(xyz, headerText, onProgress) {
    const { x, y, z, n } = xyz;
    const headerBytes = new TextEncoder().encode(headerText);
    const payload = new ArrayBuffer(n * 12);
    const dv = new DataView(payload);
    const batchSize = 50000;
    for (let i = 0; i < n; i++) {
        const o = i * 12;
        dv.setFloat32(o, x[i], true);
        dv.setFloat32(o + 4, y[i], true);
        dv.setFloat32(o + 8, z[i], true);
        if (onProgress && ((i + 1) % batchSize === 0 || i === n - 1)) {
            onProgress(0.1 + 0.85 * ((i + 1) / n));
        }
    }
    return new Blob([headerBytes, payload], { type: 'application/octet-stream' });
}

function writePcd(dataset, onProgress) {
    if (!dataset) throw new Error(t('errSaveFmt', 'pcd'));

    let xyz;
    if (dataset.type === 'pcd-scatter') {
        xyz = pcdScatterXYZ(dataset);
    } else if (dataset.data && dataset.width && dataset.height) {
        xyz = pcdGridXYZ(dataset);
    } else {
        throw new Error(t('errSaveFmt', 'pcd'));
    }

    if (onProgress) onProgress(0.05);
    const dataMode = resolvePcdDataMode(dataset);
    const headerText = buildPcdHeaderText(xyz.n, dataMode, xyz.width, xyz.height);
    const blob = (dataMode === 'ascii')
        ? writePcdAscii(xyz, headerText, onProgress)
        : writePcdBinary(xyz, headerText, onProgress);
    if (onProgress) onProgress(1.0);
    return blob;
}


/* ---------- TIFF (float32，ImageDescription = JSON header) ---------- */
function writeTiff(dataset, onProgress) {
    const { width, height, data } = dataset;
    const h = buildCanonicalBcrfHeader(dataset);
    const descStr = JSON.stringify(h) + '\0'; // 以 NUL 結尾
    const descBytes = new TextEncoder().encode(descStr);

    if (onProgress) onProgress(0.1);

    // 保留 NaN / ±Inf 原始值 (IEEE 754 float32 bit pattern)
    let f32;
    if (data instanceof Float32Array && data.length === width * height) {
        f32 = data;
    } else {
        f32 = new Float32Array(width * height);
        for (let i = 0; i < data.length; i++) f32[i] = data[i];
    }
    const pixelBytes = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);

    // 檔案配置
    const numEntries = 11;
    const ifdSize = 2 + numEntries * 12 + 4;
    const tiffHeaderSize = 8;
    const ifdOffset = tiffHeaderSize;
    const descOffset = ifdOffset + ifdSize;
    const rawDescEnd = descOffset + descBytes.length;
    const padAfterDesc = (4 - (rawDescEnd % 4)) % 4;
    const pixelOffset = rawDescEnd + padAfterDesc;
    const totalSize = pixelOffset + pixelBytes.length;

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    const u8 = new Uint8Array(buffer);

    // TIFF header
    view.setUint16(0, 0x4949, true); // 'II'
    view.setUint16(2, 42, true);
    view.setUint32(4, ifdOffset, true);

    // IFD
    view.setUint16(ifdOffset, numEntries, true);

    let off = ifdOffset + 2;
    const entryLong = (tag, count, value) => {
        view.setUint16(off, tag, true);
        view.setUint16(off + 2, 4, true); // LONG
        view.setUint32(off + 4, count, true);
        view.setUint32(off + 8, value, true);
        off += 12;
    };
    const entryShort = (tag, count, value) => {
        view.setUint16(off, tag, true);
        view.setUint16(off + 2, 3, true); // SHORT
        view.setUint32(off + 4, count, true);
        view.setUint16(off + 8, value, true);
        view.setUint16(off + 10, 0, true);
        off += 12;
    };
    const entryAscii = (tag, count, valueOffset) => {
        view.setUint16(off, tag, true);
        view.setUint16(off + 2, 2, true); // ASCII
        view.setUint32(off + 4, count, true);
        view.setUint32(off + 8, valueOffset, true);
        off += 12;
    };

    // 標籤需依 tag 數值升序排列
    entryLong(256, 1, width);                   // ImageWidth
    entryLong(257, 1, height);                  // ImageLength
    entryShort(258, 1, 32);                     // BitsPerSample
    entryShort(259, 1, 1);                      // Compression = none
    entryShort(262, 1, 1);                      // Photometric = BlackIsZero
    entryAscii(270, descBytes.length, descOffset); // ImageDescription
    entryLong(273, 1, pixelOffset);             // StripOffsets
    entryShort(277, 1, 1);                      // SamplesPerPixel
    entryLong(278, 1, height);                  // RowsPerStrip
    entryLong(279, 1, pixelBytes.length);       // StripByteCounts
    entryShort(339, 1, 3);                      // SampleFormat = IEEE float

    view.setUint32(off, 0, true); // next IFD = 0

    u8.set(descBytes, descOffset);
    if (onProgress) onProgress(0.5);

    u8.set(pixelBytes, pixelOffset);
    if (onProgress) onProgress(1.0);

    return new Blob([buffer], { type: 'image/tiff' });
}


/* ---------- 資料 → 正規化灰階 (給 BMP / JPG 使用) ---------- */
function normalizeToGray(dataset) {
    const { data, vmin, vmax, width, height } = dataset;
    const range = (vmax > vmin) ? (vmax - vmin) : 1;
    const gray = new Uint8Array(width * height);
    for (let i = 0; i < data.length; i++) {
        let v = data[i];
        if (!Number.isFinite(v)) v = vmin;
        let t = (v - vmin) / range;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        gray[i] = (t * 255) | 0;
    }
    return gray;
}


/* ---------- BMP (24-bit 灰階) ---------- */
function writeBmp(dataset, onProgress) {
    const { width, height, header } = dataset;
    const gray = normalizeToGray(dataset);
    if (onProgress) onProgress(0.3);

    // 依 header 中的 xlength/ylength 與單位計算 biXPelsPerMeter
    const unitToMeter = (u) => {
        const key = String(u || 'mm').toLowerCase();
        const table = { m: 1, cm: 1e-2, mm: 1e-3, um: 1e-6, 'µm': 1e-6, nm: 1e-9 };
        return table[key] ?? 1e-3;
    };
    const xlength = parseFloat(header?.xlength ?? header?.['x-length'] ?? 0);
    const ylength = parseFloat(header?.ylength ?? header?.['y-length'] ?? 0);
    const xunit = header?.xunit ?? header?.['x-unit'] ?? 'mm';
    const yunit = header?.yunit ?? header?.['y-unit'] ?? 'mm';
    let xpelsPerMeter = 0, ypelsPerMeter = 0;
    if (xlength > 0) xpelsPerMeter = Math.floor(width / (xlength * unitToMeter(xunit)));
    if (ylength > 0) ypelsPerMeter = Math.floor(height / (ylength * unitToMeter(yunit)));
    if (!Number.isFinite(xpelsPerMeter) || xpelsPerMeter < 0) xpelsPerMeter = 0;
    if (!Number.isFinite(ypelsPerMeter) || ypelsPerMeter < 0) ypelsPerMeter = 0;

    // 24-bit BMP：每列 4-byte 對齊、bottom-up、BGR
    const rowSize = ((24 * width + 31) >> 5) * 4;
    const imageSize = rowSize * height;
    const fileSize = 54 + imageSize;

    const buf = new ArrayBuffer(fileSize);
    const view = new DataView(buf);
    const u8 = new Uint8Array(buf);

    // BITMAPFILEHEADER
    u8[0] = 0x42; u8[1] = 0x4D;              // 'BM'
    view.setUint32(2, fileSize, true);
    view.setUint32(6, 0, true);
    view.setUint32(10, 54, true);            // bfOffBits

    // BITMAPINFOHEADER
    view.setUint32(14, 40, true);            // biSize
    view.setInt32(18, width, true);
    view.setInt32(22, height, true);         // 正數 = bottom-up
    view.setUint16(26, 1, true);             // biPlanes
    view.setUint16(28, 24, true);            // biBitCount
    view.setUint32(30, 0, true);             // biCompression = BI_RGB
    view.setUint32(34, imageSize, true);
    view.setUint32(38, xpelsPerMeter, true);
    view.setUint32(42, ypelsPerMeter, true);
    view.setUint32(46, 0, true);
    view.setUint32(50, 0, true);

    // 像素資料 (bottom-up)
    for (let y = 0; y < height; y++) {
        const srcY = height - 1 - y;
        const dstRow = 54 + y * rowSize;
        for (let x = 0; x < width; x++) {
            const g = gray[srcY * width + x];
            const p = dstRow + x * 3;
            u8[p] = g; u8[p + 1] = g; u8[p + 2] = g; // BGR
        }
        // 末尾 padding 預設為 0
        if (onProgress && (y & 63) === 0) onProgress(0.3 + 0.7 * (y + 1) / height);
    }

    if (onProgress) onProgress(1.0);
    return new Blob([buf], { type: 'image/bmp' });
}


/* ---------- PNG (對應 write_png_file_thread：輸出目前彩色畫面) ---------- */
function writePng(dataset, onProgress) {
    const canvas = (dataset && dataset.canvasEl) || document.getElementById('canvas');
    if (onProgress) onProgress(0.5);
    return new Promise((resolve) => {
        canvas.toBlob((blob) => {
            if (onProgress) onProgress(1.0);
            resolve(blob);
        }, 'image/png');
    });
}


/* ---------- JPG (灰階正規化) ---------- */
function writeJpg(dataset, onProgress) {
    // 散布點雲沒有高度網格 (dataset.data)，無法做灰階正規化；改為擷取目前畫面，
    // 並補上不透明背景（JPG 不支援透明，否則透明區會變黑）。
    if (isPcdScatterDataset(dataset)) {
        const src = (dataset && dataset.canvasEl) || document.getElementById('canvas');
        const tmp = document.createElement('canvas');
        tmp.width = src.width;
        tmp.height = src.height;
        const ctx = tmp.getContext('2d');
        ctx.fillStyle = '#2a2a38';
        ctx.fillRect(0, 0, tmp.width, tmp.height);
        ctx.drawImage(src, 0, 0);
        if (onProgress) onProgress(0.7);
        return new Promise((resolve) => {
            tmp.toBlob((blob) => {
                if (onProgress) onProgress(1.0);
                resolve(blob);
            }, 'image/jpeg', 0.95);
        });
    }

    const { width, height } = dataset;
    const gray = normalizeToGray(dataset);
    if (onProgress) onProgress(0.3);

    const tmp = document.createElement('canvas');
    tmp.width = width;
    tmp.height = height;
    const ctx = tmp.getContext('2d');
    const img = ctx.createImageData(width, height);
    for (let i = 0; i < gray.length; i++) {
        const g = gray[i];
        const p = i * 4;
        img.data[p] = g;
        img.data[p + 1] = g;
        img.data[p + 2] = g;
        img.data[p + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    if (onProgress) onProgress(0.7);

    return new Promise((resolve) => {
        tmp.toBlob((blob) => {
            if (onProgress) onProgress(1.0);
            resolve(blob);
        }, 'image/jpeg', 0.95);
    });
}


/** 統一的存檔派送：依格式呼叫對應 writer，產生 Blob 後觸發下載 */
/** 依格式產生對應的檔案 Blob（不下載） */
async function buildSaveBlob(dataset, format, onProgress) {
    switch (format) {
        case 'bcrf': return writeBcrf(dataset, onProgress);
        case 'asc':  return writeAsc(dataset, onProgress);
        case 'txt':  return writeTxt(dataset, onProgress);
        case 'pcd':  return writePcd(dataset, onProgress);
        case 'tiff': return writeTiff(dataset, onProgress);
        case 'bmp':  return writeBmp(dataset, onProgress);
        case 'png':  return await writePng(dataset, onProgress);
        case 'jpg':  return await writeJpg(dataset, onProgress);
        default:     throw new Error(t('errSaveFmt', format));
    }
}

/** 格式 → 副檔名 */
function formatToExt(format) {
    return (format === 'tiff') ? 'tif' : format;
}

/** 各儲存格式的中繼資料（MIME 與接受的副檔名），供原生「另存新檔」視窗使用 */
const SAVE_FORMAT_META = {
    bcrf: { mime: 'application/octet-stream', exts: ['.bcrf'], descKey: 'saveFormat.bcrf' },
    asc:  { mime: 'text/plain',               exts: ['.asc'],  descKey: 'saveFormat.asc'  },
    txt:  { mime: 'text/plain',               exts: ['.txt'],  descKey: 'saveFormat.txt'  },
    pcd:  { mime: 'application/octet-stream', exts: ['.pcd'],  descKey: 'saveFormat.pcd'  },
    tiff: { mime: 'image/tiff',               exts: ['.tif', '.tiff'], descKey: 'saveFormat.tiff' },
    bmp:  { mime: 'image/bmp',                exts: ['.bmp'],  descKey: 'saveFormat.bmp'  },
    png:  { mime: 'image/png',                exts: ['.png'],  descKey: 'saveFormat.png'  },
    jpg:  { mime: 'image/jpeg',               exts: ['.jpg', '.jpeg'], descKey: 'saveFormat.jpg' },
};

/** 副檔名（不含點，小寫）→ 內部格式代碼 */
function extToFormat(ext) {
    switch ((ext || '').toLowerCase()) {
        case 'bcrf': return 'bcrf';
        case 'asc':  return 'asc';
        case 'txt':  return 'txt';
        case 'pcd':  return 'pcd';
        case 'tif':
        case 'tiff': return 'tiff';
        case 'bmp':  return 'bmp';
        case 'png':  return 'png';
        case 'jpg':
        case 'jpeg': return 'jpg';
        default:     return null;
    }
}

/** 此資料集允許儲存的格式（散布點雲支援 pcd / txt / png / jpg） */
function getAllowedSaveFormats(dataset) {
    if (dataset && dataset.type === 'pcd-scatter') return ['pcd', 'txt', 'png', 'jpg'];
    const formats = ['bcrf', 'asc', 'tiff', 'bmp', 'png', 'jpg'];
    // 由 PCD 載入的有序高度圖也可存回 PCD
    const ff = String((dataset && dataset.header && dataset.header.fileformat) || '').toLowerCase();
    if (ff === 'pcd' || ff.startsWith('pcd')) formats.splice(2, 0, 'pcd');
    return formats;
}

/** 建立 showSaveFilePicker 的 types 清單，preferred 格式排在最前面（成為視窗預設選項） */
function buildPickerTypes(formats, preferred) {
    const ordered = formats.slice();
    if (preferred && ordered.includes(preferred)) {
        ordered.splice(ordered.indexOf(preferred), 1);
        ordered.unshift(preferred);
    }
    return ordered.map(fmt => {
        const meta = SAVE_FORMAT_META[fmt];
        return { description: t(meta.descKey), accept: { [meta.mime]: meta.exts } };
    });
}

async function saveAs(dataset, format, onProgress) {
    const blob = await buildSaveBlob(dataset, format, onProgress);
    const base = stripExt(dataset.filename);
    triggerDownload(blob, `${base}.${formatToExt(format)}`);
}

const BATCH_EXPORT_CMAP = 'jet';

/** 將網格資料渲染到指定 canvas（供批次 PNG 匯出） */
function renderGridExportToCanvas(dataset, canvas, cmap) {
    const ctx = canvas.getContext('2d');
    const { data, width, height } = dataset;
    canvas.width = width;
    canvas.height = height;
    const span = (dataset.vmax - dataset.vmin) || 1;
    const cmin = dataset.vmin;
    const crange = span;
    const lut = buildColormapLut(cmap);
    const img = ctx.createImageData(width, height);
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

/** 將散布點雲渲染到指定 canvas（供批次 PNG/JPG 匯出） */
function renderScatterExportToCanvas(dataset, canvas, cmap, screenW, screenH) {
    const ctx = canvas.getContext('2d');
    const { x, y, z } = dataset;
    const n = z.length;
    const R = (typeof DEFAULT_SCATTER_POINT_SCREEN_RADIUS === 'number')
        ? DEFAULT_SCATTER_POINT_SCREEN_RADIUS
        : 1;
    const b = dataset.bounds;
    const pad = 24;
    const spanX = (b.xmax - b.xmin) || 1;
    const spanY = (b.ymax - b.ymin) || 1;
    const wpp = Math.max(spanX / Math.max(1, screenW - pad * 2), spanY / Math.max(1, screenH - pad * 2));
    const centerX = (b.xmin + b.xmax) * 0.5;
    const centerY = (b.ymin + b.ymax) * 0.5;
    const halfW = screenW * 0.5;
    const halfH = screenH * 0.5;
    const worldToScreen = (wx, wy) => ({
        sx: (wx - centerX) / wpp + halfW,
        sy: (centerY - wy) / wpp + halfH,
    });

    const bw = Math.max(1, screenW);
    const bh = Math.max(1, screenH);
    canvas.width = bw;
    canvas.height = bh;
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const img = ctx.createImageData(bw, bh);
    const px = img.data;
    const lut = buildColormapLut(cmap);
    const cmin = dataset.vmin;
    const crange = (dataset.vmax - dataset.vmin) || 1;

    for (let i = 0; i < n; i++) {
        const { sx, sy } = worldToScreen(x[i], y[i]);
        if (sx < -R || sy < -R || sx > screenW + R || sy > screenH + R) continue;
        const bx = Math.round(sx);
        const by = Math.round(sy);
        let t = (z[i] - cmin) / crange;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        const li = (t * 255) | 0;
        const lo = li * 3;
        const cr = lut[lo], cg = lut[lo + 1], cb = lut[lo + 2];
        if (R <= 0) stampPixel(px, bw, bh, bx, by, cr, cg, cb);
        else stampDisk(px, bw, bh, sx, sy, R, cr, cg, cb);
    }
    ctx.putImageData(img, 0, 0);
}

/** 為需要畫面的輸出格式附加離屏 canvas */
function prepareDatasetForExport(dataset, format) {
    const needsCanvas = format === 'png' || (format === 'jpg' && isPcdScatterDataset(dataset));
    if (!needsCanvas) return dataset;
    const canvas = document.createElement('canvas');
    if (isPcdScatterDataset(dataset)) {
        renderScatterExportToCanvas(dataset, canvas, BATCH_EXPORT_CMAP, 1024, 768);
    } else {
        renderGridExportToCanvas(dataset, canvas, BATCH_EXPORT_CMAP);
    }
    return { ...dataset, canvasEl: canvas };
}

