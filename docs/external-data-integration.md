# 外部 App 傳資料進 CloudMap（WebViewer）整合規格

這份文件寫給**要在其他專案開發 App，並把資料送進這個網頁**的開發者（包含 AI 代理人）。
照著做就能讓你的 App 開啟 CloudMap 並把高度圖或點雲顯示出來。

- 網頁名稱：CloudMap（專案資料夾為 WebViewer）
- 原始碼：<https://github.com/Wasabi168/PointCloudViewer>
- 部署：GitHub Pages，預設網址應為 `https://wasabi168.github.io/PointCloudViewer/`（實際網址以 repo 的 Pages 設定為準）
- 純靜態網頁，沒有後端、沒有 HTTP API
- 接收端實作：`js/cross-window.js` 的「外部 App」區段。文件和程式不一致時以程式為準，並請更新本文件。
- 協定版本：`1`

---

## 1. 唯一支援的方式：你的 App 開啟 CloudMap，再用 `postMessage` 傳資料

```
你的 App                                   CloudMap（新分頁）
   │  window.open(CloudMap 網址)  ───────────▶  載入頁面
   │                                            │
   │  ◀───────── { type: 'cloudmap:ready' } ────┘ 啟動完成後送給 window.opener
   │
   │  postMessage({ type: 'cloudmap:load', id, kind, dataset }) ──▶ 檢查、載入、切到指定頁面
   │
   │  ◀──── { type: 'cloudmap:result', id, ok, ... } ─────────────  載入完成（或失敗）後回覆
```

- **不同網域也可以用**。你的 App 放在任何網址都行，CloudMap 不需要知道你的網址。
- CloudMap **只接受開啟它的那個視窗**（`window.opener`）傳來的訊息，其他網頁或 iframe 送來的一律忽略。
- 只能傳給**你自己開的**那個 CloudMap 分頁。使用者原本已開著的 CloudMap 分頁收不到，瀏覽器的安全設計也不允許找到它。
- 同一個分頁可以重複傳送多份資料；後傳的會取代該頁面原本的資料。
- 資料只會單向傳進 CloudMap，CloudMap 不會把使用者的資料回傳給你的 App。

其他方式**都不是對外介面**，請不要使用：
- CloudMap 內部用 BroadcastChannel（頻道 `cloudmap-xwin`）在自己的分頁之間互傳，格式隨時可能改變。
- 網址參數 `?xwin=` 是內部「傳送 → 新視窗」功能使用的，外部 App 用不到。

使用者當然也能自己把檔案拖進 CloudMap 或用「讀取檔案」開啟；那是一般操作，不是整合方式。

---

## 2. 訊息格式

所有訊息都是一般物件，`type` 一律以 `cloudmap:` 開頭。

### 2.1 CloudMap → 你的 App：`cloudmap:ready`

CloudMap 啟動完成時送出一次。你的 App 也可以隨時送 `{ type: 'cloudmap:ping', id }`，CloudMap 會回一則相同內容的 ready，並帶回你的 `id`。

```js
{ type: 'cloudmap:ready', version: 1, kinds: ['viewer', 'editor', 'analysis', 'bump'] }
```

**一定要等收到 ready 才傳資料。** 在這之前送出的訊息會遺失。
使用者重新整理 CloudMap 分頁時會再收到一次 ready，資料也會清空；要的話就重傳。

### 2.2 你的 App → CloudMap：`cloudmap:load`

```js
win.postMessage({
    type: 'cloudmap:load',
    id: 'a1b2c3',            // 你自己產生的請求編號，回覆時原樣帶回
    kind: 'viewer',          // 要載入到哪個頁面，見下表；省略時為 'viewer'
    dataset: { ... },        // 資料集，見第 3 節
    options: { colormap: 'jet' }, // 可省略
}, cloudMapOrigin, transferList);
```

| `kind` | 頁面 | 接受散布點雲 |
|---|---|---|
| `viewer` | 點雲檢視 | 是 |
| `editor` | 點雲編輯 | 是 |
| `analysis` | 點雲分析（使用者原本在疊圖或 Bump 工具時，會切回表面粗糙度） | 否 |
| `bump` | 點雲分析 → Bump 分析的「分析」子頁 | 否 |

`options.colormap` 可用 `'viridis'`、`'jet'`、`'hot'`、`'gray'`、`'inferno'`、`'bwr'`，目前只有 `viewer` 會套用。

多則 `cloudmap:load` 會依序處理，不必等前一則完成才送下一則。

### 2.3 CloudMap → 你的 App：`cloudmap:result`

載入**完成之後**才回覆，所以 `ok: true` 代表資料已經顯示在畫面上。

```js
// 成功
{ type: 'cloudmap:result', id: 'a1b2c3', ok: true, kind: 'viewer', filename: 'scan.bcrf' }
// 失敗
{ type: 'cloudmap:result', id: 'a1b2c3', ok: false, kind: 'viewer', error: 'invalid-dataset', message: 'data.length must equal width * height' }
```

| `error` | 原因 |
|---|---|
| `invalid-dataset` | 資料集格式不對，`message` 會說明哪裡錯 |
| `unsupported-kind` | `kind` 不在上表中 |
| `scatter-not-supported` | 把散布點雲送到 `analysis` 或 `bump` |
| `busy` | CloudMap 正在處理另一筆傳送，等了 10 秒仍未完成 |
| `load-failed` | 頁面載入失敗，CloudMap 畫面上通常會顯示原因 |
| `origin-not-allowed` | CloudMap 有設定來源白名單，而你的網域不在其中（見第 5 節） |

成功時 CloudMap 會顯示提示「已載入外部 App（你的網域）傳來的「檔名」」；格式錯誤時也會在畫面上提示。

---

## 3. 資料集格式

陣列請用 `Float32Array`。一般陣列或其他型別的 TypedArray 也會被轉換，但大資料會比較慢。

### 3.1 網格高度圖（最常用）

```js
const dataset = {
    filename: 'scan.bcrf',            // 顯示用名稱；省略時為 'external'
    width: 640,                       // 欄數（x 方向像素），正整數
    height: 480,                      // 列數（y 方向像素），正整數
    data: new Float32Array(640 * 480),// 列優先：data[y * width + x]，y = 0 是畫面最上面一列；缺測點用 NaN
    header: {                         // 可省略，但沒有實際尺寸時量測和粗糙度沒有物理意義
        xlength: 1.28,                // x 方向實際總長度
        ylength: 0.96,                // y 方向實際總長度
        xunit: 'mm',                  // 'nm' | 'um' | 'mm' | 'cm'；x 和 y 要相同
        yunit: 'mm',
        zunit: 'um',                  // data 數值的單位：'nm' | 'um' | 'mm' | 'cm' | '%'
    },
};
```

- `data.length` 必須等於 `width * height`。
- `header` 的值可以是數字或字串，CloudMap 會一律轉成字串；物件型別的值會被略過。`xpixels`、`ypixels` 由 CloudMap 自動填入。
- 單位寫 `um`，不要寫 `µm`。
- 其他自訂的 header 鍵可以加，會顯示在資訊面板。
- 超過約 200 萬像素時，CloudMap 會改成分塊載入，仍然可以使用。

### 3.2 散布點雲（未網格化的 x/y/z）

```js
const dataset = {
    type: 'pcd-scatter',      // 必填
    filename: 'points.txt',
    x: new Float32Array(n),   // 三個陣列長度必須相同且大於 0
    y: new Float32Array(n),
    z: new Float32Array(n),
    header: { xunit: 'mm', yunit: 'mm', zunit: 'um' },
};
```

範圍、點數和繪圖畫布尺寸都由 CloudMap 計算，不必提供。

---

## 4. 傳送端參考實作（可直接複製）

```js
/**
 * CloudMap 傳送端。不需要任何套件，同網域或不同網域都可用。
 *
 * 用法：
 *   button.addEventListener('click', async () => {
 *       const cm = openCloudMap();                 // 必須在點擊處理函式中、任何 await 之前呼叫
 *       const r = await cm.load(dataset, { kind: 'viewer' });
 *       if (!r.ok) console.warn(r.error, r.message);
 *   });
 */
const CLOUDMAP_URL = 'https://wasabi168.github.io/PointCloudViewer/';

function openCloudMap(url = CLOUDMAP_URL, { readyTimeoutMs = 30000 } = {}) {
    const origin = new URL(url).origin;
    const waiting = new Map();
    let win = null;
    let resolveReady;
    let rejectReady;
    const ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });
    ready.catch(() => {});
    const readyTimer = setTimeout(() => rejectReady(new Error('not-ready')), readyTimeoutMs);

    window.addEventListener('message', (e) => {
        if (e.origin !== origin) return;
        const m = e.data;
        if (!m || typeof m.type !== 'string') return;
        if (m.type === 'cloudmap:ready') {
            // 部分瀏覽器的 window.open 開成功也回傳 null，所以以 ready 訊息的來源視窗為準
            if (!win || win.closed) win = e.source;
            if (e.source !== win) return;
            clearTimeout(readyTimer);
            resolveReady(m);
        } else if (m.type === 'cloudmap:result' && e.source === win && waiting.has(m.id)) {
            const done = waiting.get(m.id);
            waiting.delete(m.id);
            done(m);
        }
    });

    // 不可加 'noopener'，否則 CloudMap 拿不到 window.opener。
    // 回傳值可能是 null（被擋，或瀏覽器本來就不回傳），一律等 ready 或逾時來判斷。
    win = window.open(url, '_blank');

    function makeId() {
        return (crypto.randomUUID && crypto.randomUUID()) || Date.now().toString(36) + Math.random().toString(36).slice(2);
    }

    function buffersOf(ds) {
        const arrays = ds.type === 'pcd-scatter' ? [ds.x, ds.y, ds.z] : [ds.data];
        return [...new Set(arrays.filter((a) => a && a.buffer instanceof ArrayBuffer).map((a) => a.buffer))];
    }

    /**
     * @param {object} dataset 第 3 節的資料集
     * @param {{ kind?: string, options?: object, transfer?: boolean, timeoutMs?: number }} [opts]
     *   transfer: true 時直接移交陣列記憶體（大資料較快），但傳送後你這邊的陣列會變成長度 0
     * @returns {Promise<{ ok: boolean, kind?: string, filename?: string, error?: string, message?: string }>}
     */
    async function load(dataset, { kind = 'viewer', options, transfer = false, timeoutMs = 120000 } = {}) {
        try {
            await ready;
        } catch (err) {
            return { ok: false, error: err.message };
        }
        if (!win || win.closed) return { ok: false, error: 'window-closed' };
        const id = makeId();
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                waiting.delete(id);
                resolve({ ok: false, error: 'timeout' });
            }, timeoutMs);
            waiting.set(id, (m) => { clearTimeout(timer); resolve(m); });
            win.postMessage({ type: 'cloudmap:load', id, kind, dataset, options }, origin, transfer ? buffersOf(dataset) : []);
        });
    }

    return {
        load,
        ready,
        get window() { return win; },
        get closed() { return !win || win.closed; },
    };
}
```

### 4.1 用法範例

```js
// 一次開啟、傳一份
openButton.addEventListener('click', async () => {
    const cm = openCloudMap();
    const result = await cm.load({
        filename: 'scan_001',
        width: 640,
        height: 480,
        data: heightValues,   // Float32Array(640 * 480)
        header: { xlength: 1.28, ylength: 0.96, xunit: 'mm', yunit: 'mm', zunit: 'um' },
    });
    showStatus(result.ok ? '已在 CloudMap 開啟' : '傳送失敗：' + result.error);
});

// 重複使用同一個 CloudMap 分頁；使用者關掉後再按會重新開啟
let cloudMap = null;
sendButton.addEventListener('click', async () => {
    if (!cloudMap || cloudMap.closed) cloudMap = openCloudMap();
    const result = await cloudMap.load(currentDataset, { kind: 'editor' });
    // ...
});
```

注意：重複使用已經開著的分頁時，瀏覽器不會自動把它切到前景。這屬於瀏覽器限制；需要時可以提示使用者切換分頁。

---

## 5. 安全性與白名單

- CloudMap 只處理 `event.source === window.opener` 的訊息，所以只有開啟它的那個視窗能傳資料。
- 白名單在 `js/cross-window.js` 的 `OPENER_ALLOWED_ORIGINS`。
  - 預設是空陣列，表示**接受任何開啟它的網站**。
  - 填入網域（例如 `['https://my-app.example.com']`）後，其他來源會收到 `origin-not-allowed`。
  - 正式上線前，建議把已知的 App 網域填進去。
- 你的 App 端也要檢查 `e.origin` 和 `e.source`，參考實作已經這樣做，避免把別人的訊息當成 CloudMap 的回覆。

---

## 6. 常見問題

| 狀況 | 原因與解法 |
|---|---|
| 一直等不到 ready（`not-ready`），而且沒有開出分頁 | 彈出視窗被擋：`window.open` 不是在使用者點擊時同步呼叫的。請在點擊處理函式中、任何 `await` 之前呼叫 `openCloudMap()`，或請使用者允許這個網站開啟彈出式視窗。 |
| 一直等不到 ready（`not-ready`），分頁有開但沒有資料 | 開啟時用了 `noopener`、`<a target="_blank">` 或 `rel="noopener"`，CloudMap 拿不到 `window.opener`；或網址打錯；或瀏覽器把新分頁和你的頁面隔離了。請改用參考實作的 `window.open(url, '_blank')`。 |
| `window.open` 回傳 `null`，但分頁有開 | 有些瀏覽器會這樣，不代表失敗。參考實作不看這個回傳值，而是用 `cloudmap:ready` 訊息的 `e.source` 當作 CloudMap 視窗。 |
| 你的 App 有設定 `Cross-Origin-Opener-Policy: same-origin` | 這個標頭會切斷兩個視窗之間的連結，請改成 `same-origin-allow-popups`。GitHub Pages 本身沒有設定這個標頭。 |
| `invalid-dataset` | 看 `message`。最常見的是 `data.length` 不等於 `width * height`，或 `width`、`height` 不是整數。 |
| 陣列傳送後變成空的 | 用了 `transfer: true`，記憶體已經移交給 CloudMap。需要保留時改成 `false`（預設值）。 |
| 本機開發 | 兩邊都要用 http(s)，不要用 `file://`。例如 CloudMap 在 `http://127.0.0.1:8765/`、你的 App 在 `http://127.0.0.1:5173/`，不同連接埠也可以。 |

---

## 7. 檢查清單

- [ ] 在點擊處理函式中、任何 `await` 之前呼叫 `window.open`，而且沒有 `noopener`。
- [ ] 不要用 `window.open` 的回傳值判斷成功；以收到 `cloudmap:ready` 為準。
- [ ] 等收到 `cloudmap:ready` 才送 `cloudmap:load`。
- [ ] 檢查回覆的 `e.origin` 是 CloudMap 的網域、`e.source` 是你開的視窗。
- [ ] 資料陣列是 `Float32Array`，`width * height === data.length`，缺測用 `NaN`。
- [ ] header 有 `xlength`、`ylength`、`xunit`、`yunit`、`zunit`，單位在允許清單內。
- [ ] 散布點雲不要送到 `analysis` 或 `bump`。
- [ ] 處理 `ok: false` 和逾時。
