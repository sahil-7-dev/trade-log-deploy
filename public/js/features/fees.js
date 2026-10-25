// ═══════════════════════════════════════════════════════════════════════════
// Trading fees: your default buy / sell fee rates (Settings → Trading fees),
// filled in automatically when you log or close a trade by hand, and the
// buy / sell fee totals shown on the Trade Log and Insights pages.
//
// Rates are a % of the trade's value. A Long buys on entry and sells on exit;
// a Short sells on entry and buys on exit. The entry fee is charged on the
// position size, the exit fee on what it was worth at the exit price.
// Each trade stores the fee amounts it was saved with, so changing the rates
// only affects trades logged from then on. Bybit-synced trades always keep
// the fees Bybit actually charged.
// ═══════════════════════════════════════════════════════════════════════════

// Rates as fractions (0.1% → 0.001)
function feeRates() {
  const pct = v => { const n = parseFloat(v); return n > 0 ? n / 100 : 0; };
  return { buy: pct(PREFS.feeBuyPct), sell: pct(PREFS.feeSellPct) };
}
const hasFeeRates = () => { const r = feeRates(); return r.buy > 0 || r.sell > 0; };
const entrySide = dir => dir === 'Short' ? 'sell' : 'buy';
const exitSide = dir => dir === 'Short' ? 'buy' : 'sell';

// Fee for opening `size` ($) and for closing `size` of it at `exit`
function entryFeeFor(dir, size) {
  return size > 0 ? round2(size * feeRates()[entrySide(dir)]) : 0;
}
function exitFeeFor(dir, entry, exit, size) {
  return size > 0 && entry > 0 && exit > 0 ? round2(size * exit / entry * feeRates()[exitSide(dir)]) : 0;
}

// A trade's fees split by side. Trades saved before the split (or synced
// from Bybit, which reports one combined fee) have only a total: "unsplit".
function tradeFeeSplit(t) {
  if (t.buyFee == null && t.sellFee == null) return { buy: 0, sell: 0, unsplit: t.fees || 0 };
  const buy = t.buyFee || 0, sell = t.sellFee || 0;
  return { buy, sell, unsplit: Math.max(0, round2((t.fees || 0) - buy - sell)) };
}

// Fees paid on a set of trades (open ones included — their entry fee and
// partial-close fees are already paid), plus fees as a share of the gross
// profit of the closed ones.
function feeBreakdown(trades) {
  const out = { buy: 0, sell: 0, unsplit: 0, total: 0 };
  trades.forEach(t => {
    const s = tradeFeeSplit(t);
    out.buy += s.buy; out.sell += s.sell; out.unsplit += s.unsplit;
    out.total += t.fees || 0;
  });
  const closed = trades.filter(t => t.status !== 'Open');
  const gross = sum(closed, t => t.grossPnl);
  const closedFees = sum(closed, t => t.fees);
  out.pctOfGross = gross > 0 ? closedFees / gross * 100 : null;
  ['buy', 'sell', 'unsplit', 'total'].forEach(k => { out[k] = round2(out[k]); });
  return out;
}

// One-line summary for a stat tile's sub-text
function feeSplitText(f) {
  return `buy ${fmtMoney(f.buy)} · sell ${fmtMoney(f.sell)}${f.unsplit ? ` · other ${fmtMoney(f.unsplit)}` : ''}`;
}

// ─── Auto-fill in the Log / Edit trade form ──────────────────────────────────
// A fee field fills itself from the rates until you type in it (data-auto=1).
// The form shows Buy fee + Sell fee, or — for a trade whose fees were never
// split (older trades, Bybit trades) or before the database update — one
// total Fees field.
function setTradeFeeMode(split) {
  document.getElementById('trade-modal').dataset.feeMode = split ? 'split' : 'total';
  const show = (id, on) => { document.getElementById(id).style.display = DB_READY && on ? '' : 'none'; };
  show('t-fees-group', !split);
  show('t-buy-fee-group', split);
  show('t-sell-fee-group', split);
}
const tradeFeeMode = () => document.getElementById('trade-modal').dataset.feeMode || 'total';

function markFeeAuto(id, auto) { document.getElementById(id).dataset.auto = auto ? '1' : '0'; }

function refreshTradeFeeDefaults() {
  const val = id => document.getElementById(id).value;
  const dir = val('t-dir'), entry = parseFloat(val('t-entry')), size = parseFloat(val('t-size'));
  const exit = val('t-exit') ? parseFloat(val('t-exit')) : null;
  const onEntry = entryFeeFor(dir, size);
  const onExit = exit != null ? exitFeeFor(dir, entry, exit, size) : 0;
  const bySide = { buy: 0, sell: 0 };
  bySide[entrySide(dir)] += onEntry;
  bySide[exitSide(dir)] += onExit;
  const put = (id, v) => {
    const el = document.getElementById(id);
    if (el.dataset.auto === '1') el.value = v > 0 ? round2(v).toFixed(2) : '';
  };
  if (tradeFeeMode() === 'split') { put('t-buy-fee', bySide.buy); put('t-sell-fee', bySide.sell); }
  else put('t-fees', bySide.buy + bySide.sell);

  const r = feeRates();
  setText('t-fee-hint', hasFeeRates()
    ? `Auto from your rates: buy ${(r.buy * 100).toFixed(3).replace(/\.?0+$/, '')}% · sell ${(r.sell * 100).toFixed(3).replace(/\.?0+$/, '')}% — change them in Settings`
    : 'Tip: set your buy / sell fee % in Settings and they fill in here');
}

['t-entry', 't-exit', 't-size'].forEach(id => { INPUT_HANDLERS[id] = () => refreshTradeFeeDefaults(); });
CHANGE_HANDLERS['t-dir'] = () => refreshTradeFeeDefaults();
['t-fees', 't-buy-fee', 't-sell-fee'].forEach(id => { INPUT_HANDLERS[id] = () => markFeeAuto(id, false); });

// ─── Auto-fill in the Close trade dialog ─────────────────────────────────────
function refreshCloseFeeDefault(t) {
  const el = document.getElementById('ct-fee');
  if (!el || !t) return;
  const side = exitSide(t.dir);
  const rate = feeRates()[side];
  setText('ct-fee-hint', t.source === 'bybit' ? 'Bybit trades get their fees from Bybit'
    : rate ? `Auto: ${side} fee ${(rate * 100).toFixed(3).replace(/\.?0+$/, '')}% from Settings` : '');
  if (el.dataset.auto !== '1' || t.source === 'bybit') return;
  const exit = parseFloat(document.getElementById('ct-exit').value);
  const amount = document.getElementById('ct-mode').value === 'partial'
    ? parseFloat(document.getElementById('ct-amount').value) : t.size;
  const fee = exitFeeFor(t.dir, t.entry, exit, Math.min(amount, t.size));
  el.value = fee > 0 ? fee.toFixed(2) : '';
}
// Typing a fee yourself stops the auto-fill (capture phase: before the
// dialog's own input handler recalculates)
document.addEventListener('input', e => { if (e.target.id === 'ct-fee') markFeeAuto('ct-fee', false); }, true);
