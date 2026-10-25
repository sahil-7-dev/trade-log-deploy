// ═══════════════════════════════════════════════════════════════════════════
// Position size calculator: risk a fixed % of the account to the stop.
// ═══════════════════════════════════════════════════════════════════════════

// ─── POSITION SIZE CALCULATOR ────────────────────────────────────────────────
// Risk a fixed % of the account: size so that hitting the stop loses exactly
// that much. Sizes are $ notional at entry, same as the trade log.
function openCalculator() {
  document.getElementById('calc-balance').value = tradingBalance > 0 ? tradingBalance.toFixed(2) : '';
  document.getElementById('calc-risk').value = PREFS.riskPct || 1;
  ['calc-entry', 'calc-sl', 'calc-tp', 'calc-symbol'].forEach(id => { document.getElementById(id).value = ''; });
  updateCalculator();
  openModal('calc-modal');
}

function calcPlan() {
  const v = id => parseFloat(document.getElementById(id).value);
  const balance = v('calc-balance'), riskPct = v('calc-risk'), entry = v('calc-entry'), sl = v('calc-sl'), tp = v('calc-tp');
  if (!(balance > 0) || !(riskPct > 0) || !(entry > 0) || !(sl > 0) || sl === entry) return null;
  const dir = sl < entry ? 'Long' : 'Short';
  const riskAmount = balance * riskPct / 100;
  const stopFrac = Math.abs(entry - sl) / entry;
  const size = riskAmount / stopFrac;
  const plan = { dir, riskAmount, size, qty: size / entry, stopPct: stopFrac * 100, leverage: size / balance };
  if (tp > 0 && ((dir === 'Long' && tp > entry) || (dir === 'Short' && tp < entry))) {
    plan.rr = Math.abs(tp - entry) / Math.abs(entry - sl);
    plan.reward = riskAmount * plan.rr;
  }
  return plan;
}

function updateCalculator() {
  const p = calcPlan();
  const out = document.getElementById('calc-result');
  if (!p) { out.innerHTML = '<div style="color:var(--muted)">Enter balance, risk %, entry and stop loss.</div>'; return; }
  const row = (label, value, cls = '') => `<div class="calc-row"><span>${label}</span><span class="mono ${cls}">${value}</span></div>`;
  out.innerHTML = [
    row('Direction', p.dir, p.dir === 'Long' ? 'blue' : 'red'),
    row('Risk if stopped out', `$${p.riskAmount.toFixed(2)}`, 'red'),
    row('Position size', `$${p.size.toFixed(2)}`, 'green'),
    row('Quantity', p.qty < 1 ? p.qty.toPrecision(4) : p.qty.toFixed(4)),
    row('Stop distance', `${p.stopPct.toFixed(2)}%`),
    row('Leverage needed', `${p.leverage.toFixed(2)}×`, p.leverage > 10 ? 'amber' : ''),
    p.rr != null ? row('Planned R:R', `${p.rr.toFixed(2)}R`, p.rr >= 2 ? 'green' : p.rr < 1 ? 'red' : '') : '',
    p.reward != null ? row('Profit at target', `$${p.reward.toFixed(2)}`, 'green') : '',
  ].join('');
}
['calc-balance', 'calc-risk', 'calc-entry', 'calc-sl', 'calc-tp'].forEach(id => { INPUT_HANDLERS[id] = updateCalculator; });

ACTIONS['open-calculator'] = () => openCalculator();
ACTIONS['calc-use'] = () => {
  const p = calcPlan();
  if (!p) return toast('Fill in the calculator first', 'err');
  closeModal('calc-modal');
  const g = id => document.getElementById(id).value;
  openAddTrade({
    symbol: g('calc-symbol').toUpperCase(), dir: p.dir, entry: g('calc-entry'), sl: g('calc-sl'),
    tp: g('calc-tp'), size: p.size.toFixed(2),
  });
};
