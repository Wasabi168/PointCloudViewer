/**
 * 計算機 (像素運算)
 * 依賴：viewer-ui.js / image-view 資料集
 * 匯出（全域）：計算機 modal 邏輯
 */
/* =========================================================================
 *  5. 計算機 (對所有像素值套用 +、-、*、/ 運算) — 點雲編輯器專用
 * ========================================================================= */

const edBtnCalc       = document.getElementById('edBtnCalc');
const calcOverlay     = document.getElementById('calcOverlay');
const calcCloseBtn    = document.getElementById('calcCloseBtn');
const calcCancelBtn   = document.getElementById('calcCancelBtn');
const calcApplyBtn    = document.getElementById('calcApplyBtn');
const calcOperandEl   = document.getElementById('calcOperand');
const calcStatusEl    = document.getElementById('calcStatus');
const calcOpsEl       = document.getElementById('calcOps');

let calcOp = '+';   // 目前選中的運算子

function setCalcStatus(msg, type) {
    calcStatusEl.classList.remove('error', 'ok');
    if (type) calcStatusEl.classList.add(type);
    calcStatusEl.textContent = msg || '';
}

function openCalc() {
    if (typeof closeEdMoreMenu === 'function') closeEdMoreMenu();
    if (typeof editorView === 'undefined' || !editorView.hasData()) {
        showToast(t('calcNoData'), 'error');
        return;
    }
    if (!editorView.canUseCalc()) {
        showToast(t('calcPcdScatter'), 'info');
        return;
    }
    calcOverlay.classList.add('show');
    setCalcStatus('');
    setTimeout(() => {
        calcOperandEl.focus();
        calcOperandEl.select();
    }, 0);
}

function closeCalc() {
    calcOverlay.classList.remove('show');
    setCalcStatus('');
}

/** 透過編輯器對所有像素套用 op 與 operand，並更新畫面 */
function applyCalcOperation(op, operand) {
    if (typeof editorView === 'undefined') {
        setCalcStatus(t('calcNoData'), 'error');
        return false;
    }
    const result = editorView.applyCalc(op, operand);
    if (!result.ok) {
        const msgs = {
            noData: 'calcNoData',
            scatter: 'calcPcdScatter',
            invalid: 'calcInvalidOperand',
            divZero: 'calcDivByZero',
        };
        setCalcStatus(t(msgs[result.reason] || 'calcInvalidOperand'), 'error');
        return false;
    }
    const opSymbol = ({ '+': '+', '-': '−', '*': '×', '/': '÷' })[op] || op;
    setCalcStatus(t('calcApplied', opSymbol, operand), 'ok');
    return true;
}

// --- 事件綁定 ---

if (edBtnCalc) edBtnCalc.addEventListener('click', openCalc);
calcCloseBtn.addEventListener('click', closeCalc);
calcCancelBtn.addEventListener('click', closeCalc);

// 點背景關閉
calcOverlay.addEventListener('click', (e) => {
    if (e.target === calcOverlay) closeCalc();
});

// Esc 關閉、Enter 套用
document.addEventListener('keydown', (e) => {
    if (!calcOverlay.classList.contains('show')) return;
    if (e.key === 'Escape') {
        e.preventDefault();
        closeCalc();
    } else if (e.key === 'Enter') {
        e.preventDefault();
        calcApplyBtn.click();
    }
});

// 運算子按鈕切換
calcOpsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-op]');
    if (!btn) return;
    calcOp = btn.getAttribute('data-op');
    calcOpsEl.querySelectorAll('button').forEach(b => {
        b.classList.toggle('active', b === btn);
    });
    calcOperandEl.focus();
});

// 套用
calcApplyBtn.addEventListener('click', () => {
    const raw = calcOperandEl.value.trim();
    if (raw === '') {
        setCalcStatus(t('calcInvalidOperand'), 'error');
        return;
    }
    const operand = parseFloat(raw);
    applyCalcOperation(calcOp, operand);
});


