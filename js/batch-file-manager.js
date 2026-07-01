/**
 * 批次檔管理器
 * 依賴：batch-pipeline.js
 * 匯出（全域）：BatchFileManager
 */
/* =========================================================================
 *  6c. 批次檔管理器（編輯器 / 批次編輯共用）
 * ========================================================================= */
const BatchFileManager = (() => {
    let currentFile = null;
    let onChangeCallback = null;
    let isOpen = false;
    let signatureProvider = null;

    const panel = document.getElementById('batchFileManagerPanel');
    const dragHandle = document.getElementById('bfmDragHandle');
    const stepsEl = document.getElementById('bfmSteps');
    const metaEl = document.getElementById('bfmMeta');
    const nameInput = document.getElementById('bfmNameInput');
    const btnNew = document.getElementById('bfmBtnNew');
    const btnOpen = document.getElementById('bfmBtnOpen');
    const btnSave = document.getElementById('bfmBtnSave');
    const btnClear = document.getElementById('bfmBtnClear');
    const btnAddStep = document.getElementById('bfmBtnAddStep');
    const lastEditHint = document.getElementById('bfmLastEditHint');
    const btnDone = document.getElementById('bfmBtnDone');
    const btnClose = document.getElementById('bfmCloseBtn');
    const fileInput = document.getElementById('bfmFileInput');
    const toggleBtns = [
        document.getElementById('edBtnBatchFile'),
        document.getElementById('batchEditBtnManage'),
    ].filter(Boolean);

    function syncToggleButtons() {
        toggleBtns.forEach(btn => btn.classList.toggle('active', isOpen));
    }

    function notifyChange() {
        if (typeof onChangeCallback === 'function') onChangeCallback(currentFile);
    }

    function updateLastEditHint() {
        const step = editorView.getLastEditStep();
        if (!step) {
            lastEditHint.textContent = t('bfmNoLastEditHint');
            lastEditHint.classList.remove('has-step');
            if (currentFile) btnAddStep.disabled = true;
            return;
        }
        lastEditHint.textContent = t('bfmLastEditLabel', describeBatchStep(step));
        lastEditHint.classList.add('has-step');
        if (currentFile) {
            btnAddStep.disabled = step.type === 'calc' && currentFile.kind === 'pcd';
        }
    }

    function renderMeta() {
        if (!currentFile) {
            metaEl.textContent = t('bfmNoFile');
            nameInput.value = '';
            btnSave.disabled = true;
            btnClear.disabled = true;
            btnAddStep.disabled = true;
            updateLastEditHint();
            return;
        }
        metaEl.innerHTML = t('bfmMetaInfo',
            batchKindLabel(currentFile.kind),
            currentFile.width,
            currentFile.height,
            currentFile.steps.length);
        nameInput.value = currentFile.name || '';
        btnSave.disabled = false;
        btnClear.disabled = false;
        updateLastEditHint();
    }

    function renderSteps() {
        stepsEl.innerHTML = '';
        if (!currentFile || !currentFile.steps.length) {
            stepsEl.setAttribute('data-empty', t('bfmNoSteps'));
            return;
        }
        stepsEl.removeAttribute('data-empty');
        currentFile.steps.forEach((step, idx) => {
            const li = document.createElement('div');
            li.className = 'bfm-step-item';
            li.dataset.idx = String(idx);

            const handle = document.createElement('span');
            handle.className = 'bfm-step-drag-handle';
            handle.textContent = '⋮⋮';
            handle.title = t('bfmStepDragTitle');
            handle.setAttribute('aria-hidden', 'true');

            const idxEl = document.createElement('span');
            idxEl.className = 'bfm-step-idx';
            idxEl.textContent = String(idx + 1);

            const desc = document.createElement('div');
            desc.className = 'bfm-step-desc';
            desc.innerHTML = `<strong>${idx + 1}. ${describeBatchStep(step)}</strong>`;

            const actions = document.createElement('div');
            actions.className = 'bfm-step-actions';
            const btnRm = document.createElement('button');
            btnRm.type = 'button';
            btnRm.className = 'btn-secondary';
            btnRm.textContent = '×';
            btnRm.title = t('bfmStepRemove');
            btnRm.addEventListener('click', () => removeStep(idx));
            actions.appendChild(btnRm);

            li.append(handle, idxEl, desc, actions);
            stepsEl.appendChild(li);
        });
    }

    let stepSortState = null;

    function getStepItems() {
        return Array.from(stepsEl.querySelectorAll('.bfm-step-item'));
    }

    function clearStepSortVisuals() {
        getStepItems().forEach((el) => {
            el.classList.remove('bfm-dragging', 'bfm-sort-shift');
            el.style.transform = '';
            el.style.zIndex = '';
        });
        stepsEl.classList.remove('bfm-steps-sorting');
    }

    function targetIdxAtY(clientY, excludeIdx) {
        const items = getStepItems();
        if (!items.length) return 0;
        for (let i = 0; i < items.length; i++) {
            if (i === excludeIdx) continue;
            const r = items[i].getBoundingClientRect();
            if (clientY < r.top + r.height * 0.5) return i;
        }
        return items.length - 1;
    }

    function applyStepSortVisuals(fromIdx, toIdx, dragDy) {
        const items = getStepItems();
        const dragged = items[fromIdx];
        if (!dragged) return;
        const h = dragged.offsetHeight || 36;
        items.forEach((el, i) => {
            el.classList.remove('bfm-dragging', 'bfm-sort-shift');
            el.style.transform = '';
            el.style.zIndex = '';
            if (i === fromIdx) {
                el.classList.add('bfm-dragging');
                el.style.transform = `translateY(${dragDy}px)`;
                el.style.zIndex = '3';
            } else {
                let shift = 0;
                if (fromIdx < toIdx && i > fromIdx && i <= toIdx) shift = -h;
                else if (fromIdx > toIdx && i >= toIdx && i < fromIdx) shift = h;
                if (shift) {
                    el.classList.add('bfm-sort-shift');
                    el.style.transform = `translateY(${shift}px)`;
                }
            }
        });
    }

    function finishStepSort() {
        if (!stepSortState || !currentFile) return;
        const { fromIdx, toIdx, pointerId, handle } = stepSortState;
        stepSortState = null;
        try { handle.releasePointerCapture(pointerId); } catch (_) {}

        if (fromIdx !== toIdx) {
            const steps = currentFile.steps;
            const [moved] = steps.splice(fromIdx, 1);
            steps.splice(toIdx, 0, moved);
            notifyChange();
        }
        clearStepSortVisuals();
        renderSteps();
    }

    function setupStepsDragSort() {
        if (stepsEl._bfmSortBound) return;
        stepsEl._bfmSortBound = true;

        stepsEl.addEventListener('pointerdown', (e) => {
            if (!currentFile || stepSortState) return;
            const handle = e.target.closest('.bfm-step-drag-handle');
            if (!handle) return;
            e.preventDefault();
            const item = handle.closest('.bfm-step-item');
            if (!item) return;
            const fromIdx = parseInt(item.dataset.idx, 10);
            if (!Number.isFinite(fromIdx)) return;
            stepSortState = {
                fromIdx,
                toIdx: fromIdx,
                startY: e.clientY,
                pointerId: e.pointerId,
                handle,
            };
            handle.setPointerCapture(e.pointerId);
            stepsEl.classList.add('bfm-steps-sorting');
            applyStepSortVisuals(fromIdx, fromIdx, 0);
        });

        stepsEl.addEventListener('pointermove', (e) => {
            if (!stepSortState || e.pointerId !== stepSortState.pointerId) return;
            const dy = e.clientY - stepSortState.startY;
            let toIdx = targetIdxAtY(e.clientY, stepSortState.fromIdx);
            toIdx = Math.max(0, Math.min(currentFile.steps.length - 1, toIdx));
            stepSortState.toIdx = toIdx;
            applyStepSortVisuals(stepSortState.fromIdx, toIdx, dy);
        });

        const endStepSort = (e) => {
            if (!stepSortState || e.pointerId !== stepSortState.pointerId) return;
            finishStepSort();
        };
        stepsEl.addEventListener('pointerup', endStepSort);
        stepsEl.addEventListener('pointercancel', endStepSort);
    }

    setupStepsDragSort();

    function render() {
        renderMeta();
        renderSteps();
    }

    function removeStep(idx) {
        if (!currentFile) return;
        currentFile.steps.splice(idx, 1);
        render();
        notifyChange();
    }

    const BFM_MARGIN = 8;
    const BFM_TOP_MIN = 48;
    const BFM_MIN_VISIBLE = 56;

    function panelHasLayout() {
        return panel.classList.contains('show') && panel.getBoundingClientRect().width > 0;
    }

    function isPanelInViewport() {
        if (!panelHasLayout()) return false;
        const rect = panel.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        return rect.top < vh - BFM_MIN_VISIBLE
            && rect.bottom > BFM_TOP_MIN
            && rect.left < vw - BFM_MIN_VISIBLE
            && rect.right > BFM_MIN_VISIBLE;
    }

    function resetPanelPosition() {
        panel.style.left = 'auto';
        panel.style.top = 'auto';
        panel.style.right = BFM_MARGIN + 'px';
        panel.style.bottom = BFM_MARGIN + 'px';
    }

    function clampPanelToViewport() {
        if (!panel.classList.contains('show')) return;
        const rect = panel.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let left = rect.left;
        let top = rect.top;
        const w = rect.width;
        const h = rect.height;
        left = Math.max(BFM_MARGIN, Math.min(left, vw - w - BFM_MARGIN));
        top = Math.max(BFM_TOP_MIN, Math.min(top, vh - h - BFM_MARGIN));
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.left = left + 'px';
        panel.style.top = top + 'px';
    }

    function ensurePanelVisible() {
        if (!isOpen) return;
        if (!isPanelInViewport()) resetPanelPosition();
        clampPanelToViewport();
    }

    function newFromEditor() {
        const sig = editorView.getDatasetSignature();
        if (!sig) { showToast(t('bfmNewNeedData'), 'info'); return; }
        setCurrent(createEmptyBatchFile(sig));
    }

    function tryAutoCreateBatchFile() {
        if (currentFile) return true;
        let sig = editorView.getDatasetSignature();
        if (!sig && typeof signatureProvider === 'function') sig = signatureProvider();
        if (!sig) return false;
        setCurrent(createEmptyBatchFile(sig));
        return true;
    }

    function open() {
        if (!currentFile) tryAutoCreateBatchFile();
        isOpen = true;
        panel.classList.add('show');
        panel.setAttribute('aria-hidden', 'false');
        syncToggleButtons();
        render();
        requestAnimationFrame(() => {
            ensurePanelVisible();
            requestAnimationFrame(ensurePanelVisible);
        });
    }

    function close() {
        isOpen = false;
        panel.classList.remove('show');
        panel.setAttribute('aria-hidden', 'true');
        syncToggleButtons();
    }

    function toggle() {
        if (isOpen) {
            if (!isPanelInViewport()) {
                resetPanelPosition();
                requestAnimationFrame(ensurePanelVisible);
                return;
            }
            close();
        } else {
            open();
        }
    }

    function isVisible() {
        return isOpen;
    }

    function getCurrent() {
        return currentFile;
    }

    function setCurrent(file) {
        currentFile = file;
        render();
        notifyChange();
    }

    function addLastEditStep() {
        if (!currentFile) return;
        const step = editorView.getLastEditStep();
        if (!step) { showToast(t('bfmNoLastEdit'), 'info'); return; }
        if (step.type === 'calc' && currentFile.kind === 'pcd') {
            showToast(t('bfmKindMismatch'), 'error');
            return;
        }
        currentFile.steps.push(JSON.parse(JSON.stringify(step)));
        editorView.clearLastEditStep();
        render();
        notifyChange();
        showToast(t('bfmStepAdded'), 'info');
    }

    async function saveFile() {
        if (!currentFile) return;
        currentFile.name = nameInput.value.trim() || t('bfmNamePlaceholder');
        const blob = new Blob([JSON.stringify(currentFile, null, 2)], { type: 'application/json' });
        const base = (currentFile.name || 'batch').replace(/[^\w\u4e00-\u9fff.-]+/g, '_');
        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: base + '.wbatch',
                    types: [{ description: 'WebViewer Batch', accept: { 'application/json': ['.wbatch', '.json'] } }],
                });
                const w = await handle.createWritable();
                await w.write(blob);
                await w.close();
                showToast(t('bfmSaved'), 'info');
                return;
            } catch (err) {
                if (err && err.name === 'AbortError') return;
            }
        }
        triggerDownload(blob, base + '.wbatch');
        showToast(t('bfmSaved'), 'info');
    }

    function loadFromJson(json) {
        const file = parseBatchFile(json);
        setCurrent(file);
        showToast(t('bfmLoaded', file.name || ''), 'info');
    }

    function isWbatchFile(file) {
        if (!file || !file.name) return false;
        const ext = getExt(file.name);
        return ext === 'wbatch' || ext === 'json';
    }

    async function loadFromFile(file) {
        if (!file) return;
        if (!isWbatchFile(file)) {
            showToast(t('bfmDropUnsupported'), 'error');
            return;
        }
        try {
            const text = await file.text();
            loadFromJson(JSON.parse(text));
        } catch (err) {
            console.error(err);
            showToast(t('batchUnsupported', file.name), 'error');
        }
    }

    function clearCurrent() {
        if (!currentFile) return;
        currentFile = null;
        render();
        notifyChange();
        showToast(t('bfmCleared'), 'info');
    }

    btnNew.addEventListener('click', newFromEditor);
    btnOpen.addEventListener('click', () => fileInput.click());
    btnSave.addEventListener('click', saveFile);
    btnClear.addEventListener('click', clearCurrent);
    btnAddStep.addEventListener('click', addLastEditStep);
    btnDone.addEventListener('click', close);
    btnClose.addEventListener('click', close);
    nameInput.addEventListener('change', () => {
        if (currentFile) currentFile.name = nameInput.value.trim();
        notifyChange();
    });
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        fileInput.value = '';
        if (file) await loadFromFile(file);
    });

    function bfmDragHasFiles(e) {
        if (!e.dataTransfer) return false;
        const types = e.dataTransfer.types;
        if (!types) return false;
        for (let i = 0; i < types.length; i++) {
            if (types[i] === 'Files') return true;
        }
        return false;
    }

    function pickWbatchFromDrop(dt) {
        if (!dt || !dt.files || !dt.files.length) return null;
        for (let i = 0; i < dt.files.length; i++) {
            if (isWbatchFile(dt.files[i])) return dt.files[i];
        }
        return null;
    }

    let bfmFileDragDepth = 0;
    panel.addEventListener('dragenter', (e) => {
        if (!bfmDragHasFiles(e)) return;
        e.preventDefault();
        bfmFileDragDepth++;
        panel.classList.remove('bfm-drag-reject');
        panel.classList.add('bfm-drag-over');
    });
    panel.addEventListener('dragover', (e) => {
        if (!bfmDragHasFiles(e)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    panel.addEventListener('dragleave', (e) => {
        if (!bfmDragHasFiles(e)) return;
        bfmFileDragDepth--;
        if (bfmFileDragDepth <= 0) {
            bfmFileDragDepth = 0;
            panel.classList.remove('bfm-drag-over', 'bfm-drag-reject');
        }
    });
    panel.addEventListener('drop', async (e) => {
        if (!bfmDragHasFiles(e)) return;
        e.preventDefault();
        bfmFileDragDepth = 0;
        panel.classList.remove('bfm-drag-over', 'bfm-drag-reject');
        const file = pickWbatchFromDrop(e.dataTransfer);
        if (!file) {
            panel.classList.add('bfm-drag-reject');
            showToast(t('bfmDropUnsupported'), 'error');
            setTimeout(() => panel.classList.remove('bfm-drag-reject'), 400);
            return;
        }
        await loadFromFile(file);
    });

    /* 拖曳浮動視窗 */
    let dragState = null;
    dragHandle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target.closest('.bfm-close')) return;
        const rect = panel.getBoundingClientRect();
        dragState = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            origLeft: rect.left,
            origTop: rect.top,
        };
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.left = rect.left + 'px';
        panel.style.top = rect.top + 'px';
        dragHandle.setPointerCapture(e.pointerId);
        e.preventDefault();
    });
    dragHandle.addEventListener('pointermove', (e) => {
        if (!dragState || dragState.pointerId !== e.pointerId) return;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const rect = panel.getBoundingClientRect();
        let left = dragState.origLeft + (e.clientX - dragState.startX);
        let top = dragState.origTop + (e.clientY - dragState.startY);
        left = Math.max(BFM_MARGIN, Math.min(left, vw - rect.width - BFM_MARGIN));
        top = Math.max(BFM_TOP_MIN, Math.min(top, vh - rect.height - BFM_MARGIN));
        panel.style.left = left + 'px';
        panel.style.top = top + 'px';
    });
    const endDrag = (e) => {
        if (!dragState || dragState.pointerId !== e.pointerId) return;
        dragState = null;
        try { dragHandle.releasePointerCapture(e.pointerId); } catch (_) {}
        clampPanelToViewport();
    };
    dragHandle.addEventListener('pointerup', endDrag);
    dragHandle.addEventListener('pointercancel', endDrag);

    let resizeRaf = 0;
    window.addEventListener('resize', () => {
        if (!isOpen) return;
        if (resizeRaf) cancelAnimationFrame(resizeRaf);
        resizeRaf = requestAnimationFrame(() => {
            resizeRaf = 0;
            ensurePanelVisible();
        });
    });

    document.body.appendChild(panel);

    return {
        open, close, toggle, isVisible, getCurrent, setCurrent,
        onChange: (fn) => { onChangeCallback = fn; },
        setSignatureProvider: (fn) => { signatureProvider = fn; },
        refreshLastEditHint: updateLastEditHint,
        loadFromJson,
        loadFromFile,
    };
})();

document.getElementById('edBtnBatchFile').addEventListener('click', () => BatchFileManager.toggle());

