/**
 * 批次轉檔頁
 * 依賴：file-parse.js, file-export.js
 * 匯出（全域）：批次轉檔 UI
 */
/* =========================================================================
 *  6b. 批次轉檔
 * ========================================================================= */
(function initBatchConverter() {
    const batchFileInput = document.getElementById('batchFileInput');
    const batchBtnClear = document.getElementById('batchBtnClear');
    const batchBtnConvert = document.getElementById('batchBtnConvert');
    const batchSaveFormat = document.getElementById('batchSaveFormat');
    const batchPreviewEnable = document.getElementById('batchPreviewEnable');
    const batchDropZone = document.getElementById('batchDropZone');
    const batchDropIcon = document.getElementById('batchDropIcon');
    const batchFileList = document.getElementById('batchFileList');
    const batchFileCount = document.getElementById('batchFileCount');
    const batchProgress = document.getElementById('batchProgress');
    const batchProgressBar = document.getElementById('batchProgressBar');
    const batchStatus = document.getElementById('batchStatus');
    const batchAddLabel = batchFileInput && batchFileInput.closest('label.file-btn');
    const supportsDirPicker = (typeof window.showDirectoryPicker === 'function');

    if (!batchFileInput || !batchDropZone) return;

    applySelectPref(batchSaveFormat, 'batchSaveFormat');

    let batchEntries = [];
    let batchNextId = 1;
    let batchDragDepth = 0;
    let batchConverting = false;
    let batchPreviewGen = 0;
    let batchPreviewCtxMenu = null;
    let batchPreviewObserver = null;
    let batchPreviewQueue = [];
    let batchPreviewActive = 0;
    const BATCH_PREVIEW_CONCURRENCY = 2;

    function teardownBatchPreviewObserver() {
        if (batchPreviewObserver) {
            batchPreviewObserver.disconnect();
            batchPreviewObserver = null;
        }
        batchPreviewQueue = [];
    }

    function bindBatchThumbContextMenu(thumb, entry) {
        if (thumb.dataset.ctxBound) return;
        thumb.dataset.ctxBound = '1';
        thumb.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showBatchPreviewCtxMenu(e.clientX, e.clientY, buildPreviewSendMenuItems({
                file: entry.file,
                entry,
                ds: entry.previewDs,
                onBeforeAction: hideBatchPreviewCtxMenu,
            }));
        });
    }

    function setBatchThumbState(thumb, state) {
        thumb.classList.toggle('is-loading', state === 'loading');
        thumb.classList.toggle('is-loaded', state === 'loaded');
        thumb.classList.toggle('is-error', state === 'error');
    }

    async function renderBatchEntryThumb(entry, canvas) {
        if (isRasterImageFile(entry.file)) {
            await renderImageFileThumb(entry.file, canvas, 64);
            return;
        }
        const ds = await ensureEntryPreview(entry);
        if (!ds) throw new Error(entry.previewError || t('batchItemFailed'));
        renderDatasetPreviewThumb(cloneDatasetDeep(ds), canvas, 64);
    }

    async function loadOneBatchThumb(li) {
        const gen = batchPreviewGen;
        const entry = batchEntries.find(e => String(e.id) === li.dataset.id);
        const thumb = li.querySelector('.batch-file-thumb');
        const cv = thumb && thumb.querySelector('canvas');
        if (!entry || !thumb || !cv || thumb.classList.contains('is-loaded')) return;

        setBatchThumbState(thumb, 'loading');
        try {
            await renderBatchEntryThumb(entry, cv);
            if (gen !== batchPreviewGen) return;
            setBatchThumbState(thumb, 'loaded');
            thumb.title = '';
            bindBatchThumbContextMenu(thumb, entry);
        } catch (err) {
            if (gen !== batchPreviewGen) return;
            setBatchThumbState(thumb, 'error');
            thumb.title = err.message || String(err);
        }
    }

    function pumpBatchPreviewQueue() {
        while (batchPreviewActive < BATCH_PREVIEW_CONCURRENCY && batchPreviewQueue.length) {
            const li = batchPreviewQueue.shift();
            if (!li || !li.isConnected) continue;
            const thumb = li.querySelector('.batch-file-thumb');
            if (!thumb || thumb.classList.contains('is-loaded') || thumb.classList.contains('is-loading')) continue;
            batchPreviewActive++;
            loadOneBatchThumb(li).finally(() => {
                batchPreviewActive--;
                pumpBatchPreviewQueue();
            });
        }
    }

    function scheduleBatchThumbLoad(li) {
        if (!li || batchPreviewQueue.includes(li)) return;
        batchPreviewQueue.push(li);
        pumpBatchPreviewQueue();
    }

    function setupBatchPreviewObserver() {
        if (batchPreviewObserver) return;
        batchPreviewObserver = new IntersectionObserver((records) => {
            records.forEach((record) => {
                if (!record.isIntersecting) return;
                const li = record.target.closest('.batch-file-item--preview');
                if (li) scheduleBatchThumbLoad(li);
                batchPreviewObserver.unobserve(record.target);
            });
        }, { root: batchFileList, rootMargin: '120px' });
    }

    function isBatchPreviewOn() {
        return batchPreviewEnable && batchPreviewEnable.classList.contains('tool-active');
    }

    function loadBatchItemPreviews() {
        if (!isBatchPreviewOn()) {
            teardownBatchPreviewObserver();
            return;
        }
        setupBatchPreviewObserver();
        batchFileList.querySelectorAll('.batch-file-item--preview .batch-file-thumb:not(.is-loaded)').forEach((thumb) => {
            batchPreviewObserver.observe(thumb);
        });
    }

    function hideBatchPreviewCtxMenu() {
        if (batchPreviewCtxMenu) batchPreviewCtxMenu.remove();
        batchPreviewCtxMenu = null;
    }

    function showBatchPreviewCtxMenu(x, y, items) {
        hideBatchPreviewCtxMenu();
        const menu = document.createElement('div');
        menu.className = 'ctx-menu';
        menu.setAttribute('role', 'menu');
        items.forEach((item) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ctx-menu-item';
            btn.textContent = item.label;
            btn.setAttribute('role', 'menuitem');
            btn.addEventListener('click', () => {
                hideBatchPreviewCtxMenu();
                item.action();
            });
            menu.appendChild(btn);
        });
        document.body.appendChild(menu);
        const rect = menu.getBoundingClientRect();
        const left = Math.min(x, window.innerWidth - rect.width - 8);
        const top = Math.min(y, window.innerHeight - rect.height - 8);
        menu.style.left = Math.max(8, left) + 'px';
        menu.style.top = Math.max(8, top) + 'px';
        batchPreviewCtxMenu = menu;
    }

    document.addEventListener('click', (e) => {
        if (batchPreviewCtxMenu && !batchPreviewCtxMenu.contains(e.target)) hideBatchPreviewCtxMenu();
    });
    document.addEventListener('contextmenu', (e) => {
        if (!batchPreviewCtxMenu) return;
        if (!batchPreviewCtxMenu.contains(e.target)) hideBatchPreviewCtxMenu();
    });
    window.addEventListener('scroll', hideBatchPreviewCtxMenu, true);
    window.addEventListener('resize', hideBatchPreviewCtxMenu);

    async function ensureEntryPreview(entry) {
        if (entry.previewDs) return entry.previewDs;
        if (entry.previewLoading) return entry.previewLoading;
        entry.previewLoading = parseFileToDataset(entry.file)
            .then((ds) => {
                entry.previewDs = ds;
                entry.previewError = '';
                entry.previewLoading = null;
                return ds;
            })
            .catch((err) => {
                entry.previewError = err.message || String(err);
                entry.previewLoading = null;
                return null;
            });
        return entry.previewLoading;
    }

    function setBatchProgress(p) {
        batchProgress.classList.add('show');
        batchProgressBar.style.width = (p * 100).toFixed(1) + '%';
    }
    function hideBatchProgress() {
        setTimeout(() => batchProgress.classList.remove('show'), 300);
    }

    function updateBatchEmptyAttr() {
        batchFileList.setAttribute('data-empty', t('batchStatusIdle'));
    }

    function updateBatchControls() {
        const hasFiles = batchEntries.length > 0;
        batchBtnClear.disabled = !hasFiles || batchConverting;
        batchBtnConvert.disabled = !hasFiles || batchConverting;
        if (batchPreviewEnable) batchPreviewEnable.disabled = batchConverting;
        batchFileCount.textContent = String(batchEntries.length);
        if (batchAddLabel) batchAddLabel.classList.toggle('is-busy', batchConverting);
    }

    function updateBatchEntryRow(entry) {
        const li = batchFileList.querySelector(`[data-id="${entry.id}"]`);
        if (!li) return;
        const status = li.querySelector('.batch-file-status');
        if (!status) return;
        status.className = 'batch-file-status';
        if (entry.status === 'ok') {
            status.classList.add('ok');
            status.textContent = t('batchItemDone');
            status.title = '';
        } else if (entry.status === 'error') {
            status.classList.add('err');
            status.textContent = entry.error || t('batchItemFailed');
            status.title = entry.error || '';
        } else if (entry.status === 'reading') {
            status.classList.add('busy');
            status.textContent = t('batchItemReading');
            status.title = '';
        } else if (entry.status === 'converting') {
            status.classList.add('busy');
            status.textContent = t('batchItemConverting');
            status.title = '';
        } else {
            status.textContent = t('batchItemPending');
            status.title = '';
        }
        const removeBtn = li.querySelector('.batch-file-remove');
        if (removeBtn) removeBtn.disabled = batchConverting;
    }

    function renderBatchFileList() {
        const previewOn = isBatchPreviewOn();
        batchPreviewGen++;
        teardownBatchPreviewObserver();
        batchFileList.innerHTML = '';
        batchEntries.forEach((entry, index) => {
            const li = document.createElement('li');
            li.className = 'batch-file-item' + (previewOn ? ' batch-file-item--preview' : '');
            li.dataset.id = String(entry.id);

            const idx = document.createElement('span');
            idx.className = 'batch-file-idx';
            idx.textContent = String(index + 1);

            const name = document.createElement('span');
            name.className = 'batch-file-name';
            name.textContent = entry.file.name;
            name.title = entry.file.name;

            const status = document.createElement('span');
            status.className = 'batch-file-status';
            if (entry.status === 'ok') {
                status.classList.add('ok');
                status.textContent = t('batchItemDone');
            } else if (entry.status === 'error') {
                status.classList.add('err');
                status.textContent = entry.error || t('batchItemFailed');
                status.title = entry.error || '';
            } else if (entry.status === 'reading') {
                status.classList.add('busy');
                status.textContent = t('batchItemReading');
            } else if (entry.status === 'converting') {
                status.classList.add('busy');
                status.textContent = t('batchItemConverting');
            } else {
                status.textContent = t('batchItemPending');
            }

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'batch-file-remove';
            removeBtn.textContent = '×';
            removeBtn.title = t('batchRemoveTitle');
            removeBtn.disabled = batchConverting;
            removeBtn.addEventListener('click', () => {
                batchEntries = batchEntries.filter(e => e.id !== entry.id);
                renderBatchFileList();
                updateBatchControls();
                if (!batchEntries.length) batchStatus.textContent = t('batchStatusIdle');
            });

            if (previewOn) {
                const thumb = document.createElement('div');
                thumb.className = 'batch-file-thumb';
                thumb.appendChild(document.createElement('canvas'));
                li.append(thumb, idx, name, status, removeBtn);
            } else {
                li.append(idx, name, status, removeBtn);
            }
            batchFileList.appendChild(li);
        });
        updateBatchControls();
        loadBatchItemPreviews();
    }

    function addBatchFiles(fileList) {
        const files = Array.from(fileList || []);
        if (!files.length) return;

        let added = 0;
        const existing = new Set(batchEntries.map(e => `${e.file.name}\0${e.file.size}\0${e.file.lastModified}`));

        for (const file of files) {
            const ext = getExt(file.name);
            if (!SUPPORTED_EXTS.includes(ext)) {
                showToast(t('batchUnsupported', file.name), 'error');
                continue;
            }
            const key = `${file.name}\0${file.size}\0${file.lastModified}`;
            if (existing.has(key)) continue;
            existing.add(key);
            batchEntries.push({ id: batchNextId++, file, status: 'pending', error: '' });
            added++;
        }

        if (added > 0) {
            renderBatchFileList();
            batchStatus.textContent = t('batchStatusAdded', added, batchEntries.length);
        }
    }

    function batchDragHasFiles(e) {
        if (!e.dataTransfer) return false;
        const types = e.dataTransfer.types;
        if (!types) return false;
        for (let i = 0; i < types.length; i++) {
            if (types[i] === 'Files') return true;
        }
        return false;
    }

    batchDropZone.addEventListener('dragenter', (e) => {
        if (!batchDragHasFiles(e)) return;
        e.preventDefault();
        batchDragDepth++;
        batchDropZone.classList.remove('drag-reject');
        batchDropZone.classList.add('drag-over');
        if (batchDropIcon) batchDropIcon.innerHTML = '&#x2B07;';
    });

    batchDropZone.addEventListener('dragover', (e) => {
        if (!batchDragHasFiles(e)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });

    batchDropZone.addEventListener('dragleave', (e) => {
        if (!batchDragHasFiles(e)) return;
        batchDragDepth--;
        if (batchDragDepth <= 0) {
            batchDragDepth = 0;
            batchDropZone.classList.remove('drag-over', 'drag-reject');
        }
    });

    batchDropZone.addEventListener('drop', (e) => {
        if (!batchDragHasFiles(e)) return;
        e.preventDefault();
        batchDragDepth = 0;
        batchDropZone.classList.remove('drag-over', 'drag-reject');
        if (e.dataTransfer && e.dataTransfer.files) addBatchFiles(e.dataTransfer.files);
    });

    batchFileInput.addEventListener('change', (e) => {
        if (e.target.files) addBatchFiles(e.target.files);
        batchFileInput.value = '';
    });

    batchBtnClear.addEventListener('click', () => {
        if (batchConverting || !batchEntries.length) return;
        batchEntries = [];
        renderBatchFileList();
        batchStatus.textContent = t('batchStatusCleared');
        updateBatchEmptyAttr();
    });

    if (batchPreviewEnable) {
        batchPreviewEnable.addEventListener('click', () => {
            if (batchConverting) return;
            batchPreviewEnable.classList.toggle('tool-active');
            batchPreviewEnable.setAttribute('aria-pressed', isBatchPreviewOn() ? 'true' : 'false');
            renderBatchFileList();
        });
    }

    async function batchSaveBlob(blob, filename, dirHandle) {
        if (dirHandle) {
            const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
            return;
        }
        triggerDownload(blob, filename);
        await new Promise(r => setTimeout(r, 400));
    }

    async function convertOneBatchEntry(entry, format, dirHandle, fileProgress) {
        entry.status = 'reading';
        entry.error = '';
        updateBatchEntryRow(entry);

        const dataset = await parseFileToDataset(entry.file, (p) => {
            if (fileProgress) fileProgress(p * 0.45);
        });
        entry.previewDs = dataset;

        const allowed = getAllowedSaveFormats(dataset);
        if (!allowed.includes(format)) {
            throw new Error(t('savePcdScatter'));
        }

        entry.status = 'converting';
        updateBatchEntryRow(entry);

        const exportDs = prepareDatasetForExport(dataset, format);
        const blob = await buildSaveBlob(exportDs, format, (p) => {
            if (fileProgress) fileProgress(0.45 + p * 0.5);
        });

        const base = stripExt(entry.file.name);
        const outName = `${base}.${formatToExt(format)}`;
        await batchSaveBlob(blob, outName, dirHandle);

        if (fileProgress) fileProgress(1);
        entry.status = 'ok';
        updateBatchEntryRow(entry);
    }

    batchBtnConvert.addEventListener('click', async () => {
        if (batchConverting) return;
        if (!batchEntries.length) {
            showToast(t('batchNoFiles'), 'error');
            return;
        }

        const format = batchSaveFormat.value;
        batchConverting = true;
        batchBtnConvert.classList.add('is-busy');
        batchEntries.forEach((e) => {
            e.status = 'pending';
            e.error = '';
            updateBatchEntryRow(e);
        });
        updateBatchControls();
        setBatchProgress(0);

        let dirHandle = null;
        if (supportsDirPicker) {
            try {
                dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
            } catch (err) {
                if (err && err.name === 'AbortError') {
                    batchConverting = false;
                    batchBtnConvert.classList.remove('is-busy');
                    updateBatchControls();
                    hideBatchProgress();
                    return;
                }
                console.warn('showDirectoryPicker 失敗，改為逐一下載：', err);
            }
        }

        let ok = 0, fail = 0;
        const total = batchEntries.length;

        for (let i = 0; i < total; i++) {
            const entry = batchEntries[i];
            batchStatus.textContent = t('batchStatusConverting', i + 1, total, entry.file.name);

            try {
                await convertOneBatchEntry(entry, format, dirHandle, (p) => {
                    setBatchProgress((i + p) / total);
                });
                ok++;
            } catch (err) {
                console.error(err);
                entry.status = 'error';
                entry.error = err.message || String(err);
                updateBatchEntryRow(entry);
                fail++;
            }
        }

        setBatchProgress(1);
        batchStatus.textContent = t('batchStatusDone', ok, fail);
        if (fail === 0) showToast(t('batchStatusDone', ok, fail), 'info');
        else showToast(t('batchStatusDone', ok, fail), fail === total ? 'error' : 'info');

        batchConverting = false;
        batchBtnConvert.classList.remove('is-busy');
        updateBatchControls();
        hideBatchProgress();
    });

    updateBatchEmptyAttr();
    updateBatchControls();
})();

