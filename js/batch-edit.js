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
    const runBox = document.getElementById('batchEditRunBox');
    const runHint = document.getElementById('batchEditRunHint');
    const saveFormat = document.getElementById('batchEditSaveFormat');
    const workspace = document.getElementById('batchEditWorkspace');
    const fileList = document.getElementById('batchEditFileList');
    const resultScroll = document.getElementById('batchEditResultScroll');
    const colHead = document.getElementById('batchEditColHead');
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
            if (item.separator) {
                const sep = document.createElement('div');
                sep.className = 'ctx-menu-sep';
                menu.appendChild(sep);
                return;
            }
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

    function stepColumnCount() {
        const bf = BatchFileManager.getCurrent();
        return bf && bf.steps ? bf.steps.length : 0;
    }

    function buildStepPreviewCards(ds, bf) {
        const cards = [{ kind: 'original', ds: cloneDatasetDeep(ds) }];
        let working = cloneDatasetDeep(ds);
        for (let i = 0; i < bf.steps.length; i++) {
            const res = batchApplyStep(working, bf.steps[i]);
            if (!res.ok) break;
            cards.push({
                kind: 'step',
                stepIndex: i + 1,
                step: bf.steps[i],
                ds: cloneDatasetDeep(working),
            });
        }
        return cards;
    }

    function previewHoverText(el) {
        if (!el) return '';
        if (el.dataset.kind === 'original') return t('batchEditPreviewOriginal');
        if (el.dataset.kind === 'step') {
            const name = describeBatchStep(el._step);
            return name ? `${el.dataset.stepIndex}. ${name}` : String(el.dataset.stepIndex || '');
        }
        if (el.dataset.kind === 'error') return el.dataset.error || '';
        return '';
    }

    function appendStepThumb(container, card) {
        const el = document.createElement('div');
        el.className = 'batch-edit-step-thumb is-loaded';
        el.dataset.kind = card.kind;
        if (card.kind === 'step') {
            el.dataset.stepIndex = String(card.stepIndex);
            el._step = card.step;
        }
        el.setAttribute('aria-label', previewHoverText(el));
        el._ds = card.ds;
        const cv = document.createElement('canvas');
        renderDatasetPreviewThumb(card.ds, cv, 72);
        el.appendChild(cv);
        el.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openZoomPreview(el);
        });
        el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            hideHoverLabel();
            const ds = card.ds;
            const items = buildPreviewSendMenuItems({
                ds,
                onBeforeAction: hidePreviewCtxMenu,
            });
            items.push({ separator: true });
            items.push(
                { label: t('imgSaveFull'), action: () => savePreviewDataset('full', ds) },
            );
            showPreviewCtxMenu(e.clientX, e.clientY, items);
        });
        container.appendChild(el);
    }

    function appendEmptyCell(container) {
        const el = document.createElement('div');
        el.className = 'batch-edit-step-thumb is-empty';
        container.appendChild(el);
    }

    function previewEmptyMessage() {
        const bf = BatchFileManager.getCurrent();
        if (!bf || !bf.steps.length) return t('batchEditPreviewEmpty');
        return t('batchEditPreviewNotRun');
    }

    function renderEntryPreviews(entry, container) {
        container.innerHTML = '';
        const n = stepColumnCount();
        if (!n) {
            container.classList.remove('has-cols');
            container.setAttribute('data-empty', previewEmptyMessage());
            return;
        }
        container.classList.add('has-cols');
        container.removeAttribute('data-empty');
        const cards = entry.previewCards;
        if (!cards || !cards.length) {
            const hint = document.createElement('div');
            hint.className = 'batch-edit-preview-pending' + (entry.status === 'error' ? ' is-error' : '');
            hint.textContent = entry.status === 'error' && entry.error
                ? entry.error
                : previewEmptyMessage();
            container.appendChild(hint);
            return;
        }
        for (let col = 0; col < n + 1; col++) {
            const card = cards[col];
            if (card && card.ds) appendStepThumb(container, card);
            else appendEmptyCell(container);
        }
    }

    function renderColumnHead() {
        if (!colHead || !resultScroll) return;
        const bf = BatchFileManager.getCurrent();
        const steps = bf && bf.steps ? bf.steps : [];
        const show = entries.length > 0 && steps.length > 0;
        colHead.hidden = !show;
        if (!show) {
            resultScroll.style.removeProperty('--batch-edit-cols');
            colHead.replaceChildren();
            return;
        }
        resultScroll.style.setProperty('--batch-edit-cols', String(steps.length + 1));
        const idx = document.createElement('span');
        idx.className = 'batch-edit-sticky-idx';
        const file = document.createElement('span');
        file.className = 'batch-edit-sticky-name batch-edit-colhead-file';
        file.textContent = t('batchEditColFile');
        const stepsEl = document.createElement('div');
        stepsEl.className = 'batch-edit-colhead-steps';
        const orig = document.createElement('span');
        orig.className = 'batch-edit-colhead-cell is-original';
        orig.dataset.kind = 'original';
        orig.textContent = t('batchEditPreviewOriginal');
        stepsEl.appendChild(orig);
        steps.forEach((step, i) => {
            const cell = document.createElement('span');
            cell.className = 'batch-edit-colhead-cell';
            cell.dataset.kind = 'step';
            cell.dataset.stepIndex = String(i + 1);
            cell._step = step;
            cell.textContent = String(i + 1);
            cell.setAttribute('aria-label', previewHoverText(cell));
            stepsEl.appendChild(cell);
        });
        colHead.replaceChildren(idx, file, stepsEl, document.createElement('span'), document.createElement('span'), document.createElement('span'));
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

    function updateRunHint() {
        if (!runHint) return;
        const bf = BatchFileManager.getCurrent();
        const hasBatch = !!bf && bf.steps.length > 0;
        const ready = hasBatch && entries.length > 0;
        if (runBox) runBox.classList.toggle('is-ready', ready && !running);
        if (running) {
            runHint.textContent = t('batchEditRunHintRunning');
            return;
        }
        if (!hasBatch && !entries.length) {
            runHint.textContent = t('batchEditRunHintIdle');
        } else if (!hasBatch) {
            runHint.textContent = t('batchEditNoBatch');
        } else if (!entries.length) {
            runHint.textContent = t('batchEditNoFiles');
        } else {
            runHint.textContent = t('batchEditRunHintReady', entries.length);
        }
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
        updateRunHint();
    }

    function updateFileListStatuses() {
        entries.forEach((entry) => {
            const li = fileList.querySelector(`[data-id="${entry.id}"]`);
            if (!li) return;
            const st = li.querySelector('.batch-file-status');
            if (st) {
                st.className = 'batch-file-status' + (entry.status === 'ok' ? ' ok' : entry.status === 'error' ? ' err' : entry.status === 'busy' ? ' busy' : '');
                st.textContent = entry.statusText || t('batchItemPending');
                st.title = entry.error || '';
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
        updateRunHint();
    }

    function renderFileList() {
        hideHoverLabel();
        closeZoomPreview();
        renderColumnHead();
        fileList.innerHTML = '';
        if (!entries.length) {
            fileList.setAttribute('data-empty', t('batchEditStatusIdle'));
        } else {
            fileList.removeAttribute('data-empty');
        }
        const emptyPreview = previewEmptyMessage();
        const hasCols = stepColumnCount() > 0;
        entries.forEach((entry, idx) => {
            const li = document.createElement('li');
            li.className = 'batch-file-item batch-edit-file-item';
            li.dataset.id = entry.id;

            const idxWrap = document.createElement('span');
            idxWrap.className = 'batch-edit-sticky-idx';
            const idxEl = document.createElement('span');
            idxEl.className = 'batch-file-idx';
            idxEl.textContent = String(idx + 1);
            idxWrap.appendChild(idxEl);

            const nameWrap = document.createElement('span');
            nameWrap.className = 'batch-edit-sticky-name';
            const name = document.createElement('span');
            name.className = 'batch-file-name';
            name.textContent = entry.file.name;
            name.title = entry.file.name;
            nameWrap.appendChild(name);

            const previews = document.createElement('div');
            previews.className = 'batch-edit-step-previews';
            if (!hasCols) previews.setAttribute('data-empty', emptyPreview);

            const st = document.createElement('span');
            st.className = 'batch-file-status' + (entry.status === 'ok' ? ' ok' : entry.status === 'error' ? ' err' : entry.status === 'busy' ? ' busy' : '');
            st.textContent = entry.statusText || t('batchItemPending');
            if (entry.error) st.title = entry.error;

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

            li.append(idxWrap, nameWrap, previews, st, dl, rm);
            fileList.appendChild(li);
            if (hasCols) renderEntryPreviews(entry, previews);
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
                if (isLoadCancelled(err)) continue;
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
        renderFileList();
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
                if (isLoadCancelled(err)) {
                    entry.status = 'pending';
                    entry.statusText = t('statusLoadCancelled');
                    entry.error = '';
                    fail++;
                    updateFileListStatuses();
                    continue;
                }
                console.error(err);
                entry.status = 'error';
                entry.statusText = t('batchItemFailed');
                entry.error = err.message || String(err);
                if (previewContainer) renderEntryPreviews(entry, previewContainer);
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

    const hoverLabel = document.createElement('div');
    hoverLabel.className = 'batch-edit-hover-label';
    hoverLabel.hidden = true;
    hoverLabel.setAttribute('role', 'tooltip');
    document.body.appendChild(hoverLabel);

    function hideHoverLabel() {
        hoverLabel.hidden = true;
        hoverLabel.textContent = '';
    }

    function placeHoverLabel(anchor, text) {
        hoverLabel.textContent = text;
        hoverLabel.hidden = false;
        const r = anchor.getBoundingClientRect();
        const tip = hoverLabel.getBoundingClientRect();
        let left = r.left + (r.width - tip.width) / 2;
        let top = r.top - tip.height - 8;
        if (top < 8) top = r.bottom + 8;
        left = Math.max(8, Math.min(left, window.innerWidth - tip.width - 8));
        hoverLabel.style.left = left + 'px';
        hoverLabel.style.top = top + 'px';
    }

    function hoverAnchorFromEvent(e) {
        return e.target.closest('.batch-edit-step-thumb.is-loaded, .batch-edit-colhead-cell');
    }

    if (resultScroll) {
        resultScroll.addEventListener('mouseover', (e) => {
            const anchor = hoverAnchorFromEvent(e);
            if (!anchor || !zoom.hidden) {
                hideHoverLabel();
                return;
            }
            const text = previewHoverText(anchor);
            if (!text) { hideHoverLabel(); return; }
            placeHoverLabel(anchor, text);
        });
        resultScroll.addEventListener('mouseout', (e) => {
            const anchor = hoverAnchorFromEvent(e);
            if (!anchor) return;
            const next = e.relatedTarget;
            if (next && anchor.contains(next)) return;
            if (next && next.closest && next.closest('.batch-edit-step-thumb.is-loaded, .batch-edit-colhead-cell')) return;
            hideHoverLabel();
        });
        resultScroll.addEventListener('scroll', () => {
            hideHoverLabel();
            closeZoomPreview();
        }, { passive: true });
    }

    const zoom = document.createElement('div');
    zoom.className = 'batch-edit-zoom';
    zoom.hidden = true;
    zoom.setAttribute('role', 'dialog');
    const zoomCard = document.createElement('div');
    zoomCard.className = 'batch-edit-zoom-card';
    const zoomHead = document.createElement('div');
    zoomHead.className = 'batch-edit-zoom-head';
    const zoomText = document.createElement('div');
    zoomText.className = 'batch-edit-zoom-text';
    const zoomTitle = document.createElement('div');
    zoomTitle.className = 'batch-edit-zoom-title';
    const zoomFile = document.createElement('div');
    zoomFile.className = 'batch-edit-zoom-file';
    zoomText.append(zoomTitle, zoomFile);
    const zoomClose = document.createElement('button');
    zoomClose.type = 'button';
    zoomClose.className = 'batch-edit-zoom-close';
    zoomClose.textContent = '×';
    zoomHead.append(zoomText, zoomClose);
    const zoomBody = document.createElement('div');
    zoomBody.className = 'batch-edit-zoom-body';
    const zoomStage = document.createElement('div');
    zoomStage.className = 'batch-edit-zoom-stage';
    const zoomCanvas = document.createElement('canvas');
    zoomStage.appendChild(zoomCanvas);
    zoomBody.appendChild(zoomStage);
    zoomCard.append(zoomHead, zoomBody);
    zoom.appendChild(zoomCard);
    ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].forEach((dir) => {
        const handle = document.createElement('div');
        handle.className = 'batch-edit-zoom-handle is-' + dir;
        handle.addEventListener('pointerdown', (e) => startZoomResize(e, dir));
        zoom.appendChild(handle);
    });
    document.body.appendChild(zoom);

    let zoomDs = null;
    let zoomScale = 1;
    let zoomRenderRaf = 0;
    let zoomAnchor = null;
    let zoomFrame = null;

    function clampZoomOrigin(left, top, width, height) {
        const margin = 8;
        const maxLeft = Math.max(margin, window.innerWidth - width - margin);
        const maxTop = Math.max(margin, window.innerHeight - height - margin);
        return {
            left: Math.min(maxLeft, Math.max(margin, left)),
            top: Math.min(maxTop, Math.max(margin, top)),
        };
    }

    function rememberZoomFrame() {
        if (zoom.hidden) return;
        const r = zoom.getBoundingClientRect();
        zoomFrame = { left: r.left, top: r.top, width: r.width, height: r.height };
    }

    function applyZoomFrame(frame) {
        const width = Math.min(window.innerWidth - 16, Math.max(260, frame.width));
        const height = Math.min(window.innerHeight - 16, Math.max(200, frame.height));
        const pos = clampZoomOrigin(frame.left, frame.top, width, height);
        zoom.style.left = pos.left + 'px';
        zoom.style.top = pos.top + 'px';
        zoom.style.width = width + 'px';
        zoom.style.height = height + 'px';
    }

    function closeZoomPreview() {
        zoom.hidden = true;
        zoom.classList.remove('is-resizing', 'is-panning', 'is-zoomed');
        hidePreviewCtxMenu();
        zoomDs = null;
        zoomAnchor = null;
        if (zoomRenderRaf) {
            cancelAnimationFrame(zoomRenderRaf);
            zoomRenderRaf = 0;
        }
    }

    function zoomFitWidth(ds) {
        const maxW = Math.min(480, Math.max(120, window.innerWidth - 64));
        const maxH = Math.min(420, Math.max(80, window.innerHeight - 150));
        const sw = Math.max(1, ds.width || 1);
        const sh = Math.max(1, ds.height || 1);
        return Math.max(1, Math.round(Math.min(maxW, maxH * sw / sh)));
    }

    function clampZoomScale(next) {
        const pad = 20;
        const bodyW = Math.max(1, zoomBody.clientWidth - pad);
        const bodyH = Math.max(1, zoomBody.clientHeight - pad);
        const sw = Math.max(1, zoomDs.width || 1);
        const sh = Math.max(1, zoomDs.height || 1);
        const fit = Math.min(bodyW / sw, bodyH / sh);
        const fitLong = Math.max(sw, sh) * fit;
        const maxScale = Math.max(1, 3200 / Math.max(1, fitLong));
        return Math.min(maxScale, Math.max(0.2, next));
    }

    function renderZoomCanvas() {
        if (!zoomDs || zoom.hidden) return;
        const pad = 20;
        const bodyW = Math.max(1, zoomBody.clientWidth - pad);
        const bodyH = Math.max(1, zoomBody.clientHeight - pad);
        const sw = Math.max(1, zoomDs.width || 1);
        const sh = Math.max(1, zoomDs.height || 1);
        const fit = Math.min(bodyW / sw, bodyH / sh);
        const dispW = Math.max(1, sw * fit * zoomScale);
        const dispH = Math.max(1, sh * fit * zoomScale);
        const long = Math.max(dispW, dispH);
        const renderW = Math.max(1, Math.round(dispW * (long > 1600 ? 1600 / long : 1)));
        renderDatasetPreviewThumb(zoomDs, zoomCanvas, renderW);
        zoomCanvas.style.width = dispW + 'px';
        zoomCanvas.style.height = dispH + 'px';
        zoom.classList.toggle('is-zoomed',
            zoomBody.scrollWidth > zoomBody.clientWidth + 1
            || zoomBody.scrollHeight > zoomBody.clientHeight + 1);
        if (!zoomAnchor) return;
        const anchor = zoomAnchor;
        zoomAnchor = null;
        const stageW = zoomStage.offsetWidth;
        const stageH = zoomStage.offsetHeight;
        const left = (stageW - zoomCanvas.offsetWidth) / 2;
        const top = (stageH - zoomCanvas.offsetHeight) / 2;
        zoomBody.scrollLeft = left + anchor.fx * zoomCanvas.offsetWidth - (anchor.clientX - anchor.bodyLeft);
        zoomBody.scrollTop = top + anchor.fy * zoomCanvas.offsetHeight - (anchor.clientY - anchor.bodyTop);
    }

    function scheduleZoomRender() {
        if (zoomRenderRaf) return;
        zoomRenderRaf = requestAnimationFrame(() => {
            zoomRenderRaf = 0;
            renderZoomCanvas();
        });
    }

    function placeZoom(anchor) {
        const margin = 8;
        const card = zoom.getBoundingClientRect();
        const tr = anchor.getBoundingClientRect();
        let left = tr.left + (tr.width - card.width) / 2;
        let top = tr.bottom + 10;
        if (top + card.height > window.innerHeight - margin) top = tr.top - card.height - 10;
        if (top < margin) top = Math.max(margin, (window.innerHeight - card.height) / 2);
        left = Math.max(margin, Math.min(left, window.innerWidth - card.width - margin));
        zoom.style.left = left + 'px';
        zoom.style.top = top + 'px';
    }

    function openZoomPreview(thumb) {
        const ds = thumb && thumb._ds;
        if (!ds) return;
        hideHoverLabel();
        hidePreviewCtxMenu();
        const title = previewHoverText(thumb);
        const fileName = thumb.closest('.batch-edit-file-item')?.querySelector('.batch-file-name')?.textContent || '';
        zoomTitle.textContent = title;
        zoomFile.textContent = fileName;
        zoomFile.hidden = !fileName;
        zoomClose.setAttribute('aria-label', t('infoClose'));
        zoom.setAttribute('aria-label', title);
        zoomDs = ds;
        zoomScale = 1;
        zoomBody.scrollLeft = 0;
        zoomBody.scrollTop = 0;
        const sw = Math.max(1, ds.width || 1);
        const sh = Math.max(1, ds.height || 1);
        const fitW = zoomFitWidth(ds);
        const fitH = Math.max(1, Math.round(fitW * sh / sw));
        zoom.hidden = false;
        if (zoomFrame) {
            applyZoomFrame(zoomFrame);
        } else {
            const headH = zoomHead.offsetHeight || 44;
            zoom.style.width = Math.min(window.innerWidth - 16, Math.max(260, fitW + 22)) + 'px';
            zoom.style.height = Math.min(window.innerHeight - 16, Math.max(200, fitH + headH + 22)) + 'px';
            placeZoom(thumb);
            rememberZoomFrame();
        }
        renderZoomCanvas();
    }

    zoomHead.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || zoom.hidden || e.target.closest('button')) return;
        e.preventDefault();
        const origin = zoom.getBoundingClientRect();
        const startX = e.clientX;
        const startY = e.clientY;
        zoom.classList.add('is-dragging');
        const move = (ev) => {
            const pos = clampZoomOrigin(
                origin.left + ev.clientX - startX,
                origin.top + ev.clientY - startY,
                origin.width,
                origin.height
            );
            zoom.style.left = pos.left + 'px';
            zoom.style.top = pos.top + 'px';
        };
        const up = () => {
            zoom.classList.remove('is-dragging');
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', up);
            rememberZoomFrame();
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
    });

    zoomBody.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || zoom.hidden) return;
        if (zoomBody.scrollWidth <= zoomBody.clientWidth + 1
            && zoomBody.scrollHeight <= zoomBody.clientHeight + 1) return;
        e.preventDefault();
        const startX = e.clientX;
        const startY = e.clientY;
        const startLeft = zoomBody.scrollLeft;
        const startTop = zoomBody.scrollTop;
        zoom.classList.add('is-panning');
        const move = (ev) => {
            zoomBody.scrollLeft = startLeft - (ev.clientX - startX);
            zoomBody.scrollTop = startTop - (ev.clientY - startY);
        };
        const up = () => {
            zoom.classList.remove('is-panning');
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', up);
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
    });

    function zoomViewPixelBounds() {
        if (!zoomDs || zoomDs.type === 'pcd-scatter') return null;
        const sw = Math.max(1, zoomDs.width | 0);
        const sh = Math.max(1, zoomDs.height | 0);
        const canvasRect = zoomCanvas.getBoundingClientRect();
        if (canvasRect.width < 1 || canvasRect.height < 1) return null;
        const bodyRect = zoomBody.getBoundingClientRect();
        const viewLeft = bodyRect.left + zoomBody.clientLeft;
        const viewTop = bodyRect.top + zoomBody.clientTop;
        const viewRight = viewLeft + zoomBody.clientWidth;
        const viewBottom = viewTop + zoomBody.clientHeight;
        const left = Math.max(viewLeft, canvasRect.left);
        const top = Math.max(viewTop, canvasRect.top);
        const right = Math.min(viewRight, canvasRect.right);
        const bottom = Math.min(viewBottom, canvasRect.bottom);
        if (right - left < 0.5 || bottom - top < 0.5) return null;
        const c0 = Math.max(0, Math.min(sw - 1, Math.floor((left - canvasRect.left) / canvasRect.width * sw)));
        const r0 = Math.max(0, Math.min(sh - 1, Math.floor((top - canvasRect.top) / canvasRect.height * sh)));
        const c1 = Math.max(c0 + 1, Math.min(sw, Math.ceil((right - canvasRect.left) / canvasRect.width * sw)));
        const r1 = Math.max(r0 + 1, Math.min(sh, Math.ceil((bottom - canvasRect.top) / canvasRect.height * sh)));
        return { c0, r0, c1, r1 };
    }

    function cropDatasetToPixels(ds, bounds) {
        const sw = ds.width | 0;
        const sh = ds.height | 0;
        const c0 = bounds.c0;
        const r0 = bounds.r0;
        const w = bounds.c1 - c0;
        const h = bounds.r1 - r0;
        if (w < 1 || h < 1 || !ds.data) return null;
        const src = ds.data;
        const data = new Float32Array(w * h);
        for (let y = 0; y < h; y++) {
            const srcOff = (r0 + y) * sw + c0;
            for (let x = 0; x < w; x++) data[y * w + x] = src[srcOff + x];
        }
        const out = cloneDatasetForTransfer(ds);
        out.data = data;
        out.width = w;
        out.height = h;
        const header = { ...(out.header || {}) };
        const fullXl = parseFloat(header.xlength ?? header['x-length']);
        const fullYl = parseFloat(header.ylength ?? header['y-length']);
        const pitchX = sw > 1 && fullXl > 0 ? fullXl / (sw - 1) : 0;
        const pitchY = sh > 1 && fullYl > 0 ? fullYl / (sh - 1) : 0;
        if (pitchX) {
            const xl = pitchX * Math.max(0, w - 1);
            header.xlength = String(xl);
            header['x-length'] = String(xl);
        }
        if (pitchY) {
            const yl = pitchY * Math.max(0, h - 1);
            header.ylength = String(yl);
            header['y-length'] = String(yl);
        }
        const writeOffset = (keys, delta) => {
            if (!delta) return;
            let wrote = false;
            keys.forEach((key) => {
                if (header[key] == null || header[key] === '') return;
                const n = parseFloat(header[key]);
                if (!Number.isFinite(n)) return;
                header[key] = String(n + delta);
                wrote = true;
            });
            if (!wrote) header[keys[0]] = String(delta);
        };
        writeOffset(['xoffset', 'x-offset'], c0 * pitchX);
        writeOffset(['yoffset', 'y-offset'], r0 * pitchY);
        header.xpixels = w;
        header.ypixels = h;
        header['x-pixels'] = w;
        header['y-pixels'] = h;
        out.header = header;
        delete out.vmin;
        delete out.vmax;
        return out;
    }

    function saveSuggestedDataset(ds, fallbackName) {
        const raw = String((ds && ds.filename) || fallbackName || 'image').replace(/[\\/:*?"<>|]/g, '_');
        if (ds && ds.filename === raw) return ds;
        return { ...ds, filename: raw };
    }

    function previewSaveVisual(ds) {
        let cmin = Number.isFinite(ds && ds.vmin) ? ds.vmin : NaN;
        let cmax = Number.isFinite(ds && ds.vmax) ? ds.vmax : NaN;
        if ((!Number.isFinite(cmin) || !Number.isFinite(cmax)) && ds && ds.data && typeof computeRange === 'function') {
            const range = computeRange(ds.data);
            cmin = range.vmin;
            cmax = range.vmax;
        }
        if (!Number.isFinite(cmin)) cmin = 0;
        if (!Number.isFinite(cmax)) cmax = cmin + 1;
        return {
            cmap: (typeof BATCH_EXPORT_CMAP === 'string') ? BATCH_EXPORT_CMAP : 'jet',
            cmin,
            crange: (cmax - cmin) || 1,
        };
    }

    /** 右鍵只決定存整張或目前視野；檔案種類在儲存視窗裡選，與點雲檢視相同。 */
    async function savePreviewDataset(kind, ds, bounds) {
        if (!ds || ds.type === 'pcd-scatter' || !ds.data) {
            showToast(t('batchEditZoomSaveFailed'), 'error');
            return;
        }
        let target = ds;
        let nameSuffix = '';
        if (kind === 'view') {
            if (!bounds) {
                showToast(t('batchEditZoomSaveEmpty'), 'error');
                return;
            }
            target = cropDatasetToPixels(ds, bounds);
            if (!target) {
                showToast(t('batchEditZoomSaveEmpty'), 'error');
                return;
            }
            nameSuffix = '_view';
        }
        try {
            const result = await commitDatasetSave(saveSuggestedDataset(target, zoomFile && zoomFile.textContent), {
                preferred: (saveFormat && saveFormat.value) || 'bcrf',
                nameSuffix,
                visual: previewSaveVisual(ds),
            });
            if (!result || result.cancelled) return;
            if (result.rejected) {
                showToast(t('savePcdScatter'), 'info');
                return;
            }
            showToast(t('toastSaved', result.fullName), 'info');
        } catch (err) {
            console.error(err);
            showToast(t('batchEditZoomSaveFailed'), 'error');
        }
    }

    function showZoomCtxMenu(x, y) {
        const ds = zoomDs;
        if (!ds) return;
        const bounds = zoomViewPixelBounds();
        const items = buildPreviewSendMenuItems({
            ds,
            onBeforeAction: closeZoomPreview,
        });
        items.push({ separator: true });
        items.push(
            { label: t('imgSaveFull'), action: () => savePreviewDataset('full', ds) },
            { label: t('imgSaveView'), action: () => savePreviewDataset('view', ds, bounds) },
        );
        showPreviewCtxMenu(x, y, items);
    }

    zoom.addEventListener('contextmenu', (e) => {
        if (zoom.hidden || !zoomDs) return;
        e.preventDefault();
        e.stopPropagation();
        showZoomCtxMenu(e.clientX, e.clientY);
    });

    function startZoomResize(e, dir) {
        if (e.button !== 0 || zoom.hidden) return;
        e.preventDefault();
        e.stopPropagation();
        const origin = zoom.getBoundingClientRect();
        const startX = e.clientX;
        const startY = e.clientY;
        const minW = 260;
        const minH = 200;
        const margin = 8;
        zoom.classList.add('is-resizing');
        const move = (ev) => {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            let left = origin.left;
            let top = origin.top;
            let w = origin.width;
            let h = origin.height;
            if (dir.indexOf('e') !== -1) w = origin.width + dx;
            if (dir.indexOf('s') !== -1) h = origin.height + dy;
            if (dir.indexOf('w') !== -1) { w = origin.width - dx; left = origin.left + dx; }
            if (dir.indexOf('n') !== -1) { h = origin.height - dy; top = origin.top + dy; }
            if (w < minW) {
                if (dir.indexOf('w') !== -1) left -= (minW - w);
                w = minW;
            }
            if (h < minH) {
                if (dir.indexOf('n') !== -1) top -= (minH - h);
                h = minH;
            }
            if (left < margin) { w -= (margin - left); left = margin; }
            if (top < margin) { h -= (margin - top); top = margin; }
            const maxR = window.innerWidth - margin;
            const maxB = window.innerHeight - margin;
            if (left + w > maxR) w = maxR - left;
            if (top + h > maxB) h = maxB - top;
            zoom.style.left = left + 'px';
            zoom.style.top = top + 'px';
            zoom.style.width = Math.max(minW, w) + 'px';
            zoom.style.height = Math.max(minH, h) + 'px';
            scheduleZoomRender();
        };
        const up = () => {
            zoom.classList.remove('is-resizing');
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', up);
            rememberZoomFrame();
            renderZoomCanvas();
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
    }

    zoom.addEventListener('wheel', (e) => {
        if (zoom.hidden || !zoomDs) return;
        e.preventDefault();
        const canvasRect = zoomCanvas.getBoundingClientRect();
        const bodyRect = zoomBody.getBoundingClientRect();
        const inside = e.clientX >= canvasRect.left && e.clientX <= canvasRect.right
            && e.clientY >= canvasRect.top && e.clientY <= canvasRect.bottom;
        const fx = inside ? (e.clientX - canvasRect.left) / Math.max(1, canvasRect.width) : 0.5;
        const fy = inside ? (e.clientY - canvasRect.top) / Math.max(1, canvasRect.height) : 0.5;
        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16;
        else if (e.deltaMode === 2) dy *= window.innerHeight;
        const factor = Math.exp(-dy * 0.0015);
        const next = clampZoomScale(zoomScale * Math.min(1.25, Math.max(0.8, factor)));
        if (Math.abs(next - zoomScale) < 0.001) return;
        zoomScale = next;
        zoomAnchor = {
            fx, fy,
            clientX: e.clientX,
            clientY: e.clientY,
            bodyLeft: bodyRect.left,
            bodyTop: bodyRect.top,
        };
        scheduleZoomRender();
    }, { passive: false });

    zoomClose.addEventListener('click', (e) => {
        e.stopPropagation();
        closeZoomPreview();
    });
    document.addEventListener('pointerdown', (e) => {
        if (zoom.hidden || zoom.contains(e.target)) return;
        if (previewCtxMenu && previewCtxMenu.contains(e.target)) return;
        closeZoomPreview();
    }, true);
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (previewCtxMenu) {
            hidePreviewCtxMenu();
            return;
        }
        if (!zoom.hidden) closeZoomPreview();
    });

    window.refreshBatchEditLang = function () {
        if (running) {
            updateRunHint();
            renderColumnHead();
            return;
        }
        renderFileList();
    };

    updateControls();
})();

