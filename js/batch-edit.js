/**
 * 批次編輯頁
 * 依賴：batch-file-manager.js, batch-pipeline.js, image-view.js
 * 匯出（全域）：批次編輯 UI
 */
/* =========================================================================
 *  6d. 批次編輯頁
 * ========================================================================= */
(function initBatchEdit() {
    const fileInput = document.getElementById('batchEditFileInput');
    const btnClear = document.getElementById('batchEditBtnClear');
    const btnOpenBatch = document.getElementById('batchEditBtnOpenBatch');
    const btnRun = document.getElementById('batchEditBtnRun');
    const saveFormat = document.getElementById('batchEditSaveFormat');
    const workspace = document.getElementById('batchEditWorkspace');
    const fileList = document.getElementById('batchEditFileList');
    const fileCount = document.getElementById('batchEditFileCount');
    const batchInfo = document.getElementById('batchEditBatchInfo');
    const batchBadge = document.getElementById('batchEditBatchBadge');
    const statusEl = document.getElementById('batchEditStatus');
    const progress = document.getElementById('batchEditProgress');
    const progressBar = document.getElementById('batchEditProgressBar');
    const btnDownloadAll = document.getElementById('batchEditBtnDownloadAll');

    let entries = [];
    let running = false;
    let downloading = false;
    let entryIdSeq = 0;
    let previewCtxMenu = null;

    function hidePreviewCtxMenu() {
        if (previewCtxMenu) previewCtxMenu.remove();
        previewCtxMenu = null;
    }

    function showPreviewCtxMenu(x, y, items) {
        hidePreviewCtxMenu();
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
                hidePreviewCtxMenu();
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
        previewCtxMenu = menu;
    }

    document.addEventListener('click', (e) => {
        if (previewCtxMenu && !previewCtxMenu.contains(e.target)) hidePreviewCtxMenu();
    });
    document.addEventListener('contextmenu', (e) => {
        if (!previewCtxMenu) return;
        if (!previewCtxMenu.contains(e.target)) hidePreviewCtxMenu();
    });
    window.addEventListener('scroll', hidePreviewCtxMenu, true);
    window.addEventListener('resize', hidePreviewCtxMenu);

    function setProgress(p) {
        progress.classList.add('show');
        progressBar.style.width = (p * 100).toFixed(1) + '%';
    }
    function hideProgress() { setTimeout(() => progress.classList.remove('show'), 300); }

    function updateBatchInfo() {
        const bf = BatchFileManager.getCurrent();
        if (!bf) {
            batchInfo.textContent = t('batchEditNoBatchFile');
            batchBadge.style.display = 'none';
            return;
        }
        batchInfo.textContent = bf.name || t('bfmNamePlaceholder');
        batchBadge.style.display = 'block';
        batchBadge.className = 'batch-file-badge ok';
        batchBadge.textContent = describeBatchFileMeta(bf, { withNote: false });
    }

    function buildStepPreviewCards(ds, bf) {
        const cards = [{ label: t('batchEditPreviewOriginal'), ds: cloneDatasetDeep(ds) }];
        let working = cloneDatasetDeep(ds);
        for (let i = 0; i < bf.steps.length; i++) {
            const res = batchApplyStep(working, bf.steps[i]);
            if (!res.ok) break;
            cards.push({ label: `${i + 1}. ${describeBatchStep(bf.steps[i])}`, ds: cloneDatasetDeep(working) });
        }
        return cards;
    }

    function appendStepThumb(container, card) {
        const el = document.createElement('div');
        el.className = 'batch-edit-step-thumb is-loaded';
        el.title = card.label;
        const cv = document.createElement('canvas');
        renderDatasetPreviewThumb(card.ds, cv, 68);
        el.appendChild(cv);
        el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showPreviewCtxMenu(e.clientX, e.clientY, buildPreviewSendMenuItems({
                ds: card.ds,
                onBeforeAction: hidePreviewCtxMenu,
            }));
        });
        container.appendChild(el);
    }

    function previewEmptyMessage() {
        const bf = BatchFileManager.getCurrent();
        if (!bf || !bf.steps.length) return t('batchEditPreviewEmpty');
        return t('batchEditPreviewNotRun');
    }

    function renderEntryPreviews(entry, container) {
        container.innerHTML = '';
        if (!entry.previewCards || !entry.previewCards.length) {
            container.setAttribute('data-empty', previewEmptyMessage());
            return;
        }
        container.removeAttribute('data-empty');
        entry.previewCards.forEach((card) => appendStepThumb(container, card));
    }

    function resetEntryResults() {
        entries.forEach((entry) => {
            entry.resultDs = null;
            entry.previewCards = null;
            entry.status = 'pending';
            entry.statusText = '';
            entry.error = '';
        });
        fileList.querySelectorAll('.batch-edit-step-previews').forEach((container) => {
            container.innerHTML = '';
            container.setAttribute('data-empty', previewEmptyMessage());
        });
    }

    function updateControls() {
        const bf = BatchFileManager.getCurrent();
        const hasBatch = !!bf && bf.steps.length > 0;
        const hasResults = entries.some(e => e.resultDs);
        fileCount.textContent = String(entries.length);
        btnClear.disabled = !entries.length || running;
        btnRun.disabled = !entries.length || !hasBatch || running;
        if (btnDownloadAll) btnDownloadAll.disabled = !hasResults || running || downloading;
        updateBatchInfo();
    }

    function updateFileListStatuses() {
        entries.forEach((entry) => {
            const li = fileList.querySelector(`[data-id="${entry.id}"]`);
            if (!li) return;
            const st = li.querySelector('.batch-file-status');
            if (st) {
                st.className = 'batch-file-status' + (entry.status === 'ok' ? ' ok' : entry.status === 'error' ? ' err' : entry.status === 'busy' ? ' busy' : '');
                st.textContent = entry.statusText || t('batchItemPending');
            }
            const dl = li.querySelector('.batch-file-download');
            if (dl) dl.disabled = running || downloading || !entry.resultDs;
            const rm = li.querySelector('.batch-file-remove');
            if (rm) rm.disabled = running;
        });
        fileCount.textContent = String(entries.length);
        btnClear.disabled = !entries.length || running;
        const bf = BatchFileManager.getCurrent();
        btnRun.disabled = !entries.length || !bf || !bf.steps.length || running;
        if (btnDownloadAll) btnDownloadAll.disabled = running || downloading || !entries.some(e => e.resultDs);
    }

    function renderFileList() {
        fileList.innerHTML = '';
        if (!entries.length) {
            fileList.setAttribute('data-empty', t('batchEditStatusIdle'));
        } else {
            fileList.removeAttribute('data-empty');
        }
        const emptyPreview = previewEmptyMessage();
        entries.forEach((entry, idx) => {
            const li = document.createElement('li');
            li.className = 'batch-file-item batch-edit-file-item';
            li.dataset.id = entry.id;

            const idxEl = document.createElement('span');
            idxEl.className = 'batch-file-idx';
            idxEl.textContent = String(idx + 1);

            const name = document.createElement('span');
            name.className = 'batch-file-name';
            name.textContent = entry.file.name;
            name.title = entry.file.name;

            const previews = document.createElement('div');
            previews.className = 'batch-edit-step-previews';
            if (!entry.previewCards) previews.setAttribute('data-empty', emptyPreview);

            const st = document.createElement('span');
            st.className = 'batch-file-status' + (entry.status === 'ok' ? ' ok' : entry.status === 'error' ? ' err' : entry.status === 'busy' ? ' busy' : '');
            st.textContent = entry.statusText || t('batchItemPending');

            const dl = document.createElement('button');
            dl.type = 'button';
            dl.className = 'batch-file-download';
            dl.textContent = '↓';
            dl.title = t('batchEditDownload');
            dl.disabled = running || downloading || !entry.resultDs;

            const rm = document.createElement('button');
            rm.type = 'button';
            rm.className = 'batch-file-remove';
            rm.textContent = '×';
            rm.title = t('batchRemoveTitle');
            rm.disabled = running;

            li.append(idxEl, name, previews, st, dl, rm);
            fileList.appendChild(li);
            if (entry.previewCards) renderEntryPreviews(entry, previews);
        });
        updateControls();
    }

    fileList.addEventListener('click', (e) => {
        const dlBtn = e.target.closest('.batch-file-download');
        if (dlBtn && !dlBtn.disabled && !running && !downloading) {
            e.preventDefault();
            e.stopPropagation();
            const li = dlBtn.closest('.batch-file-item');
            const entry = entries.find(en => en.id === li?.dataset.id);
            if (entry) {
                downloadEntry(entry).catch((err) => {
                    console.error(err);
                    showToast((err.message || String(err)), 'error');
                });
            }
            return;
        }
        const btn = e.target.closest('.batch-file-remove');
        if (!btn || running || btn.disabled) return;
        e.preventDefault();
        e.stopPropagation();
        const li = btn.closest('.batch-file-item');
        if (!li || !li.dataset.id) return;
        entries = entries.filter(en => en.id !== li.dataset.id);
        renderFileList();
    });

    function isWbatchConfigFile(file) {
        const ext = getExt(file.name);
        return ext === 'wbatch' || ext === 'json';
    }

    function partitionDroppedFiles(files) {
        const batchConfigs = [];
        const dataFiles = [];
        for (const file of files) {
            if (isWbatchConfigFile(file)) batchConfigs.push(file);
            else dataFiles.push(file);
        }
        return { batchConfigs, dataFiles };
    }

    async function handleDroppedFiles(files) {
        const list = Array.from(files || []);
        if (!list.length) return;
        const { batchConfigs, dataFiles } = partitionDroppedFiles(list);
        if (batchConfigs.length > 1) {
            showToast(t('batchEditDropMultipleBatch', batchConfigs.length - 1), 'info');
        }
        if (batchConfigs.length) {
            await BatchFileManager.loadFromFile(batchConfigs[0]);
        }
        if (dataFiles.length) {
            await addFiles(dataFiles);
        }
    }

    function fileSignatureKey(file) {
        return `${file.name}|${file.size}|${file.lastModified}`;
    }

    async function addFiles(files) {
        let bf = BatchFileManager.getCurrent();
        let added = 0;
        const existing = new Set(entries.map(e => fileSignatureKey(e.file)));
        for (const file of files) {
            if (!SUPPORTED_EXTS.includes(getExt(file.name))) { showToast(t('batchUnsupported', file.name), 'error'); continue; }
            const key = fileSignatureKey(file);
            if (existing.has(key)) continue;
            let ds;
            try {
                ds = await parseFileToDataset(file);
                if (!bf) {
                    bf = createEmptyBatchFile(getDatasetSignature(ds));
                    BatchFileManager.setCurrent(bf);
                } else if (!datasetMatchesBatchFile(ds, bf)) {
                    showToast(t('batchEditMismatch', file.name), 'error');
                    continue;
                }
            } catch (err) {
                console.error(err);
                showToast(t('batchUnsupported', file.name), 'error');
                continue;
            }
            entries.push({
                id: 'be' + (++entryIdSeq),
                file,
                status: 'pending',
                statusText: '',
                signature: getDatasetSignature(ds),
                resultDs: null,
                previewCards: null,
            });
            existing.add(key);
            added++;
        }
        if (added) {
            statusEl.textContent = t('batchEditStatusAdded', added, entries.length);
            renderFileList();
        }
    }

    function batchEditDragHasFiles(e) {
        if (!e.dataTransfer) return false;
        const types = e.dataTransfer.types;
        if (!types) return false;
        for (let i = 0; i < types.length; i++) {
            if (types[i] === 'Files') return true;
        }
        return false;
    }

    let batchEditDragDepth = 0;
    if (workspace) {
        workspace.addEventListener('dragenter', (e) => {
            if (!batchEditDragHasFiles(e)) return;
            e.preventDefault();
            batchEditDragDepth++;
            workspace.classList.remove('drag-reject');
            workspace.classList.add('drag-over');
        });
        workspace.addEventListener('dragover', (e) => {
            if (!batchEditDragHasFiles(e)) return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        });
        workspace.addEventListener('dragleave', (e) => {
            if (!batchEditDragHasFiles(e)) return;
            batchEditDragDepth--;
            if (batchEditDragDepth <= 0) {
                batchEditDragDepth = 0;
                workspace.classList.remove('drag-over', 'drag-reject');
            }
        });
        workspace.addEventListener('drop', (e) => {
            if (!batchEditDragHasFiles(e)) return;
            e.preventDefault();
            batchEditDragDepth = 0;
            workspace.classList.remove('drag-over', 'drag-reject');
            const files = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
            if (files.length) handleDroppedFiles(files);
        });
    }

    btnOpenBatch.addEventListener('click', () => document.getElementById('bfmFileInput').click());
    btnClear.addEventListener('click', () => {
        if (running) return;
        entries = [];
        statusEl.textContent = t('batchEditStatusCleared');
        renderFileList();
    });
    fileInput.addEventListener('change', (e) => {
        const files = e.target.files ? Array.from(e.target.files) : [];
        fileInput.value = '';
        if (files.length) addFiles(files);
    });
    BatchFileManager.setSignatureProvider(() => {
        const entry = entries.find(e => e.signature);
        return entry ? entry.signature : null;
    });
    BatchFileManager.onChange(() => {
        resetEntryResults();
        updateControls();
        updateFileListStatuses();
    });

    function makeBatchEditExportFilename(entry, format, usedNames) {
        const ext = formatToExt(format);
        const rawBase = stripExt(entry.file.name).replace(/[^\w\u4e00-\u9fff.-]+/g, '_') || 'image';
        let name = `${rawBase}_edited.${ext}`;
        const norm = (s) => s.toLowerCase();
        if (!usedNames || !usedNames.has(norm(name))) {
            if (usedNames) usedNames.add(norm(name));
            return name;
        }
        let n = 2;
        while (usedNames.has(norm(`${rawBase}_edited_${n}.${ext}`))) n++;
        name = `${rawBase}_edited_${n}.${ext}`;
        usedNames.add(norm(name));
        return name;
    }

    async function batchEditSaveBlob(blob, filename, dirHandle, multiFallback) {
        if (dirHandle) {
            const fh = await dirHandle.getFileHandle(filename, { create: true });
            const w = await fh.createWritable();
            await w.write(blob);
            await w.close();
            return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 8000);
        if (multiFallback) {
            await new Promise(r => setTimeout(r, 1500));
        }
    }

    async function downloadEntry(entry, dirHandle, usedNames, multiFallback) {
        if (!entry?.resultDs) return false;
        const format = saveFormat.value;
        const allowed = getAllowedSaveFormats(entry.resultDs);
        if (!allowed.includes(format)) {
            showToast(t('savePcdScatter'), 'error');
            return false;
        }
        const prepared = prepareDatasetForExport(entry.resultDs, format);
        const blob = await buildSaveBlob(prepared, format);
        const filename = makeBatchEditExportFilename(entry, format, usedNames);
        await batchEditSaveBlob(blob, filename, dirHandle, multiFallback);
        return true;
    }

    if (btnDownloadAll) {
        btnDownloadAll.addEventListener('click', async () => {
        if (downloading) return;
        const ready = entries.filter(e => e.resultDs);
        if (!ready.length) {
            showToast(t('batchEditNoResults'), 'error');
            return;
        }

        const supportsDirPicker = (typeof window.showDirectoryPicker === 'function');
        let dirHandle = null;
        const multi = ready.length > 1;

        if (multi && supportsDirPicker) {
            try {
                dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
            } catch (err) {
                if (err && err.name === 'AbortError') return;
                console.warn(err);
            }
            if (!dirHandle) {
                showToast(t('batchEditDownloadNeedFolder'), 'error');
                return;
            }
        } else if (multi) {
            showToast(t('batchEditDownloadMultiHint'), 'info');
        }

        downloading = true;
        updateFileListStatuses();
        updateControls();

        const usedNames = new Set();
        let ok = 0;
        try {
            for (const entry of ready) {
                try {
                    if (await downloadEntry(entry, dirHandle, usedNames, multi && !dirHandle)) ok++;
                } catch (err) {
                    console.error(err);
                    showToast(t('batchItemFailed') + ': ' + entry.file.name, 'error');
                }
            }
            if (ok) showToast(t('batchEditDownloadDone', ok), 'info');
        } finally {
            downloading = false;
            updateFileListStatuses();
            updateControls();
        }
        });
    }

    btnRun.addEventListener('click', async () => {
        if (running) return;
        const bf = BatchFileManager.getCurrent();
        if (!bf || !bf.steps.length) { showToast(t('batchEditNoBatch'), 'error'); return; }
        if (!entries.length) { showToast(t('batchEditNoFiles'), 'error'); return; }

        running = true;
        btnRun.classList.add('is-busy');
        entries.forEach((entry) => {
            entry.resultDs = null;
            entry.previewCards = null;
            entry.status = 'pending';
            entry.statusText = '';
            entry.error = '';
        });
        renderFileList();
        setProgress(0);

        let ok = 0, fail = 0;
        const total = entries.length;

        for (let i = 0; i < total; i++) {
            const entry = entries[i];
            entry.status = 'busy';
            entry.statusText = t('batchItemReading');
            updateFileListStatuses();
            statusEl.textContent = t('batchEditStatusRunning', i + 1, total, entry.file.name);

            const li = fileList.querySelector(`[data-id="${entry.id}"]`);
            const previewContainer = li?.querySelector('.batch-edit-step-previews');

            try {
                let ds = await parseFileToDataset(entry.file);
                if (!datasetMatchesBatchFile(ds, bf)) throw new Error(t('batchEditMismatch', entry.file.name));

                const stepsCheck = validateBatchFileSteps(bf);
                if (!stepsCheck.ok) throw new Error(batchStepRejectMessage(stepsCheck.reason));

                entry.statusText = t('batchItemConverting');
                updateFileListStatuses();

                const pipe = batchApplyPipeline(ds, bf.steps);
                if (!pipe.ok) {
                    const reasonMsg = (pipe.reason === 'pcdOnlyScatterGrid' || pipe.reason === 'pcdNoMoreSteps' || pipe.reason === 'kindMismatch')
                        ? batchStepRejectMessage(pipe.reason)
                        : (pipe.reason || '');
                    throw new Error(describeBatchStep(pipe.step) + ': ' + reasonMsg);
                }

                entry.previewCards = buildStepPreviewCards(ds, bf);
                entry.resultDs = cloneDatasetDeep(pipe.dataset);
                entry.resultDs.filename = entry.file.name;

                if (previewContainer) renderEntryPreviews(entry, previewContainer);

                entry.status = 'ok';
                entry.statusText = t('batchItemDone');
                ok++;
            } catch (err) {
                console.error(err);
                entry.status = 'error';
                entry.statusText = t('batchItemFailed');
                entry.error = err.message || String(err);
                if (previewContainer) {
                    previewContainer.innerHTML = '';
                    const errThumb = document.createElement('div');
                    errThumb.className = 'batch-edit-step-thumb is-error';
                    errThumb.title = entry.error;
                    previewContainer.appendChild(errThumb);
                    previewContainer.removeAttribute('data-empty');
                }
                fail++;
            }
            setProgress((i + 1) / total);
            updateFileListStatuses();
        }

        statusEl.textContent = t('batchEditStatusDone', ok, fail);
        running = false;
        btnRun.classList.remove('is-busy');
        updateFileListStatuses();
        updateControls();
        hideProgress();
    });

    updateControls();
})();

