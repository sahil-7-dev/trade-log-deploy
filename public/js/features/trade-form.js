// ═══════════════════════════════════════════════════════════════════════════
// Trade form: log / edit trades, close (fully or partly), delete with undo.
// ═══════════════════════════════════════════════════════════════════════════

// ─── TRADE MODAL OPEN/RESET ───────────────────────────────────────────────────
// Fields added by the 2026-10-26 migration — hidden until it has run
const TRADE_JOURNAL_FIELDS = ['t-fees', 't-buy-fee', 't-sell-fee', 't-opened-at', 't-closed-at', 't-emotion', 't-followed', 't-mistakes'];

function setTradeJournalFieldsVisible() {
  document.querySelectorAll('.needs-db').forEach(el => { el.style.display = DB_READY ? '' : 'none'; });
}

// prefill: optional values from the position-size calculator
function openAddTrade(prefill = {}) {
  document.getElementById('trade-modal-title').textContent = 'Log New Trade';
  document.getElementById('log-trade-btn').textContent = 'Log Trade';
  document.getElementById('t-edit-id').value = '';
  ['t-symbol','t-entry','t-exit','t-size','t-sl','t-tp','t-setup','t-notes','t-tags', ...TRADE_JOURNAL_FIELDS]
    .forEach(id => document.getElementById(id).value = '');
  document.getElementById('t-date').value = localToday();
  const openedEl = document.getElementById('t-opened-at');
  openedEl.value = openedEl.dataset.auto = toDatetimeLocal(new Date());
  document.getElementById('t-type').value = 'Crypto';
  document.getElementById('t-dir').value = 'Long';
  for (const [k, v] of Object.entries(prefill)) {
    const el = document.getElementById('t-' + k);
    if (el && v != null) el.value = v;
  }
  setTradeJournalFieldsVisible();
  // fees fill in from your rates (Settings → Trading fees) until you type one
  setTradeFeeMode(FEE_SPLIT_READY);
  ['t-fees', 't-buy-fee', 't-sell-fee'].forEach(id => markFeeAuto(id, true));
  refreshTradeFeeDefaults();
  openModal('trade-modal');
}

function openEditTrade(id) {
  const t = TRADES.find(t => t.id === id);
  if (!t) return;
  document.getElementById('trade-modal-title').textContent = 'Edit Trade';
  document.getElementById('log-trade-btn').textContent = 'Save Changes';
  document.getElementById('t-edit-id').value = id;
  document.getElementById('t-symbol').value = t.symbol || '';
  document.getElementById('t-type').value = t.type || 'Crypto';
  document.getElementById('t-dir').value = t.dir || 'Long';
  document.getElementById('t-date').value = t.date || '';
  document.getElementById('t-entry').value = t.entry || '';
  document.getElementById('t-exit').value = t.exit != null ? t.exit : '';
  document.getElementById('t-size').value = t.size || '';
  document.getElementById('t-sl').value = t.sl != null ? t.sl : '';
  document.getElementById('t-tp').value = t.tp != null ? t.tp : '';
  document.getElementById('t-setup').value = t.setup || '';
  document.getElementById('t-notes').value = t.notes || '';
  document.getElementById('t-tags').value = Array.isArray(t.tags) ? t.tags.join(', ') : (t.tags || '');
  document.getElementById('t-fees').value = t.fees ? t.fees : '';
  document.getElementById('t-buy-fee').value = t.buyFee ? t.buyFee : '';
  document.getElementById('t-sell-fee').value = t.sellFee ? t.sellFee : '';
  document.getElementById('t-opened-at').value = t.opened_at ? toDatetimeLocal(t.opened_at) : '';
  document.getElementById('t-closed-at').value = t.closed_at ? toDatetimeLocal(t.closed_at) : '';
  document.getElementById('t-emotion').value = t.emotion || '';
  document.getElementById('t-followed').value = t.followed_plan == null ? '' : String(t.followed_plan);
  document.getElementById('t-mistakes').value = (t.mistakes || []).join(', ');
  setTradeJournalFieldsVisible();
  // Buy / sell fields when this trade's fees are split (or it has none yet);
  // one total for older or Bybit trades. Saved fees are never recalculated —
  // only the exit-side fee of a still-open trade fills in when you add an exit.
  const split = FEE_SPLIT_READY && (t.buyFee != null || t.sellFee != null || (!t.fees && t.source !== 'bybit'));
  setTradeFeeMode(split);
  ['t-fees', 't-buy-fee', 't-sell-fee'].forEach(id => markFeeAuto(id, false));
  if (split && t.exit == null && t.source !== 'bybit') {
    const exitField = exitSide(t.dir) === 'buy' ? 't-buy-fee' : 't-sell-fee';
    if (!document.getElementById(exitField).value) markFeeAuto(exitField, true);
  }
  refreshTradeFeeDefaults();
  openModal('trade-modal');
}

const splitList = (raw, lower = true) => raw
  ? raw.split(',').map(s => lower ? s.trim().toLowerCase() : s.trim()).filter(Boolean)
  : null;

// ─── SAVE TRADE (ADD + EDIT) ──────────────────────────────────────────────────
async function saveTrade() {
  if (demoGuard()) return;
  const val = id => document.getElementById(id).value;
  const editId = val('t-edit-id');
  const entry = parseFloat(val('t-entry'));
  const exit = val('t-exit') ? parseFloat(val('t-exit')) : null;
  const size = parseFloat(val('t-size'));
  const sl = val('t-sl') ? parseFloat(val('t-sl')) : null;
  const tp = val('t-tp') ? parseFloat(val('t-tp')) : null;
  // Buy + sell fee fields, or one total for trades whose fees aren't split
  const feeSplit = DB_READY && FEE_SPLIT_READY && tradeFeeMode() === 'split';
  const buyFee = feeSplit && val('t-buy-fee') ? parseFloat(val('t-buy-fee')) : 0;
  const sellFee = feeSplit && val('t-sell-fee') ? parseFloat(val('t-sell-fee')) : 0;
  if (!(buyFee >= 0) || !(sellFee >= 0)) return toast('Fees can\'t be negative', 'err');
  const fees = feeSplit ? round2(buyFee + sellFee) : (val('t-fees') ? parseFloat(val('t-fees')) : 0);
  const symbol = val('t-symbol').trim().toUpperCase() || 'UNKNOWN';
  const dir = val('t-dir');

  if (!(entry > 0) || !(size > 0)) return toast('Entry price and size must be greater than 0', 'err');
  if (exit != null && !(exit > 0)) return toast('Exit price must be greater than 0', 'err');
  if (!(fees >= 0)) return toast('Fees can\'t be negative', 'err');

  // R:R achieved, on NET P&L (after fees), against the planned risk
  let rr = null;
  if (exit && sl) {
    const risk = Math.abs(entry - sl) / entry * size;
    const netPnl = (dir === 'Long' ? (exit - entry) / entry : (entry - exit) / entry) * size - fees;
    rr = risk > 0 ? parseFloat((netPnl / risk).toFixed(4)) : null;
  }

  const payload = {
    date: val('t-date') || localToday(),
    symbol, type: val('t-type'),
    dir, entry, exit, size, sl, tp, rr,
    setup: val('t-setup') || null,
    notes: val('t-notes') || null,
    tags: splitList(val('t-tags'))
  };
  const orig = editId && TRADES.find(t => t.id === editId);
  // Exit added to an open trade in Edit = closing it now (unless a close
  // time or a different date is given) — not on the day it was opened
  const closingNow = orig && orig.exit == null && exit != null;
  if (closingNow && payload.date === orig.date) payload.date = localToday();
  if (DB_READY) {
    let openedAt = val('t-opened-at');
    let closedAt = val('t-closed-at');
    // Editing only the Date of a closed trade moves its close time to that day
    // (same clock time) — otherwise the old close time would win below and
    // the trade would silently stay on its old calendar day.
    const origClosedAt = orig && orig.closed_at ? toDatetimeLocal(orig.closed_at) : '';
    if (closedAt && closedAt === origClosedAt && val('t-date') && closedAt.slice(0, 10) !== val('t-date')) {
      closedAt = val('t-date') + closedAt.slice(10);
    }
    if (closingNow && !closedAt) closedAt = payload.date === localToday() ? toDatetimeLocal(new Date()) : '';
    // The open time pre-filled with "now" is only a guess: drop it when the
    // trade is backdated or closed before it (holding time would be wrong)
    const openedAuto = !editId && openedAt && openedAt === document.getElementById('t-opened-at').dataset.auto;
    if (openedAuto && (val('t-date') !== localToday() || (closedAt && closedAt < openedAt))) openedAt = '';
    if (openedAt && closedAt && exit != null && new Date(closedAt) < new Date(openedAt)) {
      return toast('Close time is before the open time', 'err');
    }
    if (feeSplit) Object.assign(payload, { buy_fee: round2(buyFee), sell_fee: round2(sellFee) });
    Object.assign(payload, {
      fees,
      opened_at: openedAt ? new Date(openedAt).toISOString() : null,
      closed_at: exit != null && closedAt ? new Date(closedAt).toISOString() : null,
      emotion: val('t-emotion') || null,
      followed_plan: val('t-followed') === '' ? null : val('t-followed') === 'true',
      mistakes: splitList(val('t-mistakes'), false),
    });
    // A close time sets the trade date (the P&L calendar files it by that day)
    if (payload.closed_at) payload.date = localDateOf(payload.closed_at);
  } else if (fees) {
    return toast('Fees need the database update first — see the banner at the top', 'err');
  }

  const btn = document.getElementById('log-trade-btn');
  btn.textContent = 'Saving…'; btn.disabled = true;

  try {
    if (editId) {
      // Reopening a closed trade (exit cleared) discards its close history —
      // otherwise its old fills would show it as partly closed.
      const before = TRADES.find(t => t.id === editId);
      const hasFills = before && (before.closes.length || before.realized_exit_value > 0 || before.original_size != null);
      if (before && before.exit != null && exit == null && hasFills) {
        Object.assign(payload, { closes: [], original_size: null, realized_exit_value: 0 });
      }
      // Closing a partly-closed trade here must count its earlier partial
      // closes too — the same maths as "Close rest" (the form's size is only
      // what's still open, so on its own it would drop their P&L)
      if (before && before.exit == null && exit != null && hasFills) {
        const extraFee = DB_READY ? Math.max(0, fees - before.fees) : 0;
        const plan = planTradeClose({ ...before, entry, dir, size }, 'full', null, exit, extraFee);
        if (plan.error) throw new Error(plan.error);
        const closedAtIso = payload.closed_at || new Date().toISOString();
        let planRr = null;
        if (sl) {
          const risk = Math.abs(entry - sl) / entry * plan.originalSize;
          planRr = risk > 0 ? parseFloat((plan.netPnl / risk).toFixed(4)) : null;
        }
        Object.assign(payload, {
          exit: plan.avgExit, size: plan.originalSize, rr: planRr,
          original_size: plan.originalSize,
          realized_exit_value: parseFloat(plan.exitValue.toFixed(2)),
          closes: [...before.closes, { ...plan.fill, date: payload.date }],
        });
        if (DB_READY) Object.assign(payload, { fees: plan.totalFees, closed_at: closedAtIso });
      }
      const result = await sbUpdate('trades', editId, payload);
      const updated = result && result[0] ? normalizeTrade(result[0]) : null;
      if (updated) {
        const idx = TRADES.findIndex(t => t.id === editId);
        if (idx !== -1) TRADES[idx] = updated;
        await persistBalances(); // the trading balance follows the trade's new P&L
      }
      toast('Trade updated ✓');
    } else {
      const result = await sbInsert('trades', { ...payload, user_id: currentUser.id });
      if (result && result[0]) {
        const inserted = normalizeTrade(result[0]);
        TRADES.unshift(inserted);
        if (inserted.pnl) await persistBalances(); // logged already closed: its P&L counts now
        toast('Trade logged ✓');
      }
    }
    closeModal('trade-modal');
    renderAll();
  } catch (e) {
    toast(e.message, 'err');
  }
  btn.textContent = editId ? 'Save Changes' : 'Log Trade';
  btn.disabled = false;
}

// ─── CLOSE TRADE (QUICK EXIT) ─────────────────────────────────────────────────
function openCloseTrade(id) {
  const t = TRADES.find(t => t.id === id);
  if (!t) return;
  document.getElementById('ct-trade-id').value = id;
  document.getElementById('ct-exit').value = '';
  document.getElementById('ct-amount').value = '';
  document.getElementById('ct-mode').value = 'full';
  document.getElementById('ct-amount-group').style.display = 'none';
  document.getElementById('ct-date').value = toDatetimeLocal(new Date());
  document.getElementById('ct-fee').value = '';
  markFeeAuto('ct-fee', true); // fills from your exit-side fee rate until you type one
  setTradeJournalFieldsVisible();
  const p = partialCloseInfo(t);
  document.getElementById('close-trade-info').textContent =
    `${t.symbol} ${t.dir} · Entry: ${fmtPx(t.entry)} · Open: $${t.size.toFixed(2)}` +
    (p ? ` of $${p.originalSize.toFixed(2)} (closed $${p.closedSize.toFixed(2)} so far, ${p.realized >= 0 ? '+' : '-'}$${Math.abs(p.realized).toFixed(2)})` : '');
  updateCloseTradePreview();
  openModal('close-trade-modal');
}

// Works out what a close would do. Returns { error } or the fill plus, for a
// full close, the whole trade's final numbers.
function planTradeClose(t, mode, amountInput, exit, feeInput) {
  if (!(exit > 0)) return { error: 'Enter an exit price greater than 0' };
  const fee = feeInput ? parseFloat(feeInput) : 0;
  if (!(fee >= 0)) return { error: 'Fee can\'t be negative' };
  const remaining = t.size;
  let amount = remaining;
  if (mode === 'partial') {
    amount = parseFloat(amountInput);
    if (!(amount > 0)) return { error: 'Enter the amount to close' };
    if (amount > remaining * 1.001) return { error: `Only $${remaining.toFixed(2)} is still open` };
  }
  // Closing (almost) everything that's left is the full close
  const isFull = amount >= remaining * 0.999;
  if (isFull) amount = remaining;

  const fill = {
    id: `m-${Date.now()}`, date: null, exit, size: parseFloat(amount.toFixed(2)),
    pnl: fillPnl(t.dir, t.entry, exit, amount), fee: parseFloat(fee.toFixed(2)),
  };
  const priorFills = t.closes.length > 0 || t.realized_exit_value > 0;
  const priorExitValue = t.realized_exit_value ||
    t.closes.reduce((s, f) => s + f.size * f.exit / t.entry, 0);
  const exitValue = priorExitValue + amount * exit / t.entry;
  const originalSize = t.original_size || remaining;
  // Fees of the whole trade = every close's fee (incl. this one) + any fee
  // already on the trade that isn't attributed to a close
  const fillFees = t.closes.reduce((s, f) => s + (parseFloat(f.fee) || 0), 0) + fill.fee;
  const totalFees = parseFloat(Math.max(fillFees, t.fees + fill.fee).toFixed(2));
  if (!isFull) return { isFull, fill, amount, remaining, originalSize, exitValue, totalFees };

  // Size-weighted average exit across every close: total exit value ÷
  // original size is the exit/entry ratio (sizes are entry-side $).
  const avgExit = priorFills ? parseFloat((t.entry * exitValue / originalSize).toFixed(12)) : exit;
  const totalPnl = fillPnl(t.dir, t.entry, avgExit, originalSize);
  const netPnl = parseFloat((totalPnl - totalFees).toFixed(2));
  return { isFull, fill, amount, remaining, originalSize, exitValue, avgExit, totalPnl, netPnl, totalFees, priorFills };
}

function readCloseTradePlan(t) {
  return planTradeClose(t,
    document.getElementById('ct-mode').value,
    document.getElementById('ct-amount').value,
    parseFloat(document.getElementById('ct-exit').value),
    document.getElementById('ct-fee').value);
}

function updateCloseTradePreview() {
  const t = TRADES.find(t => t.id === document.getElementById('ct-trade-id').value);
  const el = document.getElementById('ct-preview');
  if (!t || !el) return;
  const mode = document.getElementById('ct-mode').value;
  document.getElementById('ct-amount-group').style.display = mode === 'partial' ? 'block' : 'none';
  refreshCloseFeeDefault(t);
  const plan = readCloseTradePlan(t);
  if (plan.error) { el.textContent = ''; return; }
  const money = v => `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(2)}`;
  const feeNote = plan.totalFees ? ` (${money(plan.totalPnl)} before $${plan.totalFees.toFixed(2)} fees)` : '';
  el.textContent = plan.isFull
    ? (plan.priorFills
        ? `Closes the remaining $${plan.amount.toFixed(2)} (${money(plan.fill.pnl)}). Whole trade: avg exit ${fmtPx(plan.avgExit)}, P&L ${money(plan.netPnl)}${feeNote}.`
        : `Closes the whole trade: P&L ${money(plan.netPnl)}${feeNote}.`)
    : `Closes $${plan.amount.toFixed(2)} (${money(plan.fill.pnl - plan.fill.fee)}). Trade stays open with $${(plan.remaining - plan.amount).toFixed(2)} left — stats update when it's fully closed.`;
}

async function closeTradeSubmit() {
  if (demoGuard()) return;
  const id = document.getElementById('ct-trade-id').value;
  const t = TRADES.find(t => t.id === id);
  if (!t) return;
  const when = document.getElementById('ct-date').value;
  const closedAt = when ? new Date(when) : new Date();
  const date = localDateOf(closedAt);
  const plan = readCloseTradePlan(t);
  if (plan.error) return toast(plan.error, 'err');
  if (plan.fill.fee && !DB_READY) return toast('Fees need the database update first — see the banner at the top', 'err');
  const closes = [...t.closes, { ...plan.fill, date }];
  // This close's fee is on the exit side (a Long sells, a Short buys back) —
  // added to that side's total when this trade's fees are split
  const feeSplitPatch = {};
  if (FEE_SPLIT_READY && (t.buyFee != null || t.sellFee != null || !t.fees)) {
    const side = exitSide(t.dir);
    feeSplitPatch.buy_fee = round2((t.buyFee || 0) + (side === 'buy' ? plan.fill.fee : 0));
    feeSplitPatch.sell_fee = round2((t.sellFee || 0) + (side === 'sell' ? plan.fill.fee : 0));
  }

  let payload;
  if (plan.isFull) {
    // R:R achieved over the whole position, from the average exit, after fees
    let rr = null;
    if (t.sl) {
      const risk = Math.abs(t.entry - t.sl) / t.entry * plan.originalSize;
      rr = risk > 0 ? parseFloat((plan.netPnl / risk).toFixed(4)) : null;
    }
    payload = {
      exit: plan.avgExit, date, rr,
      size: plan.originalSize,
      original_size: plan.priorFills ? plan.originalSize : t.original_size,
      realized_exit_value: parseFloat(plan.exitValue.toFixed(2)),
      closes,
    };
    if (DB_READY) Object.assign(payload, { fees: plan.totalFees, closed_at: closedAt.toISOString() }, feeSplitPatch);
  } else {
    // Partial: same trade, still Open (exit stays null → P&L 0 → no stats,
    // no trading balance change until the rest is closed)
    payload = {
      size: parseFloat((plan.remaining - plan.amount).toFixed(2)),
      original_size: plan.originalSize,
      realized_exit_value: parseFloat(plan.exitValue.toFixed(2)),
      closes,
    };
    if (DB_READY) Object.assign(payload, { fees: plan.totalFees }, feeSplitPatch);
  }

  const btn = document.getElementById('close-trade-btn');
  btn.textContent = 'Closing…'; btn.disabled = true;

  try {
    const result = await sbUpdate('trades', id, payload);
    const updated = result && result[0] ? normalizeTrade(result[0]) : null;
    if (updated) {
      const idx = TRADES.findIndex(t => t.id === id);
      if (idx !== -1) TRADES[idx] = updated;
      await persistBalances();
    }
    closeModal('close-trade-modal');
    renderAll();
    toast(plan.isFull
      ? 'Trade closed ✓  Trading balance updated'
      : `Closed $${plan.amount.toFixed(2)} ✓  $${(plan.remaining - plan.amount).toFixed(2)} still open`);
  } catch (e) {
    toast(e.message, 'err');
  }
  btn.textContent = 'Close Trade'; btn.disabled = false;
}


// ─── DELETE TRADE ─────────────────────────────────────────────────────────────
// The row as it can be re-inserted (for Undo): generated columns and the
// client-only fields normalizeTrade() adds are dropped.
function tradeInsertRow(t) {
  const row = { ...t };
  ['pnl', 'net_pnl', 'status', 'grossPnl', 'buyFee', 'sellFee'].forEach(k => delete row[k]);
  if (!FEE_SPLIT_READY) ['buy_fee', 'sell_fee'].forEach(k => delete row[k]);
  if (!DB_READY) ['fees', 'mistakes', 'opened_at', 'closed_at', 'emotion', 'followed_plan'].forEach(k => delete row[k]);
  return row;
}

async function deleteTrade(id) {
  if (demoGuard()) return;
  const t = TRADES.find(t => t.id === id);
  if (!t) return;
  const hasPnl = !!t.pnl;
  const ok = await confirmDialog({
    title: `Delete ${t.symbol} trade?`,
    message: hasPnl
      ? `Its realized P&L (${fmt(t.pnl)}) will be reversed from your trading balance.\nYou can undo this for a few seconds.`
      : 'You can undo this for a few seconds.',
    confirmText: 'Delete', danger: true,
  });
  if (!ok) return;
  try {
    await sbDelete('trades', id);
    TRADES = TRADES.filter(x => x.id !== id);
    if (hasPnl) await persistBalances();
    renderAll();
    toastAction('Trade deleted', 'Undo', async () => {
      const result = await sbInsert('trades', tradeInsertRow(t));
      TRADES.push(result && result[0] ? normalizeTrade(result[0]) : t);
      if (hasPnl) await persistBalances();
      renderAll();
      toast('Trade restored ✓');
    });
  } catch (e) {
    toast(e.message, 'err');
  }
}

