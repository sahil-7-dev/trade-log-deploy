// ═══════════════════════════════════════════════════════════════════════════
// Investments: add / edit / buy more / delete holdings, close (sell)
// positions, undo a sale, realized P&L history.
// ═══════════════════════════════════════════════════════════════════════════

// ─── ADD / EDIT INVESTMENT ────────────────────────────────────────────────────
// 'add' | 'edit' | 'buy' (buy more of an existing holding)
let investModalMode = 'add';

function setInvestSymbolLocked(locked) {
  document.getElementById('i-symbol').readOnly = locked;
  document.getElementById('i-symbol').style.opacity = locked ? '0.5' : '1';
  document.getElementById('i-type').disabled = locked;
}

function openEditInvestment(id) {
  const h = HOLDINGS.find(h => h.id === id);
  if (!h) return;
  investModalMode = 'edit';
  document.getElementById('invest-modal-title').textContent = 'Edit Investment';
  document.getElementById('add-invest-btn').textContent = 'Save Changes';
  document.getElementById('i-edit-id').value = id;
  document.getElementById('i-symbol').value = h.symbol;
  document.getElementById('i-type').value = h.type;
  document.getElementById('i-date').value = h.buy_date || '';
  document.getElementById('i-qty').value = h.qty;
  document.getElementById('i-price').value = h.buyPrice;
  document.getElementById('i-cur').value = h.livePrice ? '' : h.curPrice || '';
  document.getElementById('i-notes').value = h.notes || '';
  setInvestSymbolLocked(true);
  openModal('invest-modal');
}

function openAddInvestment() {
  investModalMode = 'add';
  document.getElementById('invest-modal-title').textContent = 'Add Investment';
  document.getElementById('add-invest-btn').textContent = 'Add Holding';
  document.getElementById('i-edit-id').value = '';
  setInvestSymbolLocked(false);
  ['i-symbol', 'i-qty', 'i-price', 'i-cur', 'i-notes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('i-date').value = localToday();
  openModal('invest-modal');
}

// Buy more of a holding: qty + price of THIS purchase; saved as one holding
// with the quantity added and the buy price re-averaged.
function openBuyMore(id) {
  const h = HOLDINGS.find(h => h.id === id);
  if (!h) return;
  investModalMode = 'buy';
  document.getElementById('invest-modal-title').textContent = `Buy More — ${h.symbol}`;
  document.getElementById('add-invest-btn').textContent = 'Buy';
  document.getElementById('i-edit-id').value = id;
  document.getElementById('i-symbol').value = h.symbol;
  document.getElementById('i-type').value = h.type;
  setInvestSymbolLocked(true);
  ['i-qty', 'i-cur', 'i-notes'].forEach(f => document.getElementById(f).value = '');
  document.getElementById('i-price').value = h.livePrice ? h.curPrice : '';
  document.getElementById('i-date').value = localToday();
  openModal('invest-modal');
}
ACTIONS['open-buy-more'] = el => openBuyMore(el.dataset.id);

// Adds qty bought at price to an existing holding, re-averaging its cost
async function mergeIntoHolding(h, qty, price) {
  const newQty = parseFloat((h.qty + qty).toFixed(8));
  const newAvg = parseFloat(((h.qty * h.buyPrice + qty * price) / newQty).toFixed(12));
  await sbUpdate('investments', h.id, { qty: newQty, buy_price: newAvg });
  h.qty = newQty;
  h.buyPrice = newAvg;
  if (!h.livePrice && !(h.curPrice > 0)) h.curPrice = price;
  return { newQty, newAvg };
}

async function saveInvestment() {
  if (demoGuard()) return;
  const editId = document.getElementById('i-edit-id').value;
  const symbol = document.getElementById('i-symbol').value.trim().toUpperCase();
  const type = document.getElementById('i-type').value;
  const qty = parseFloat(document.getElementById('i-qty').value);
  const buy_price = parseFloat(document.getElementById('i-price').value);
  const cur_price = document.getElementById('i-cur').value ? parseFloat(document.getElementById('i-cur').value) : null;

  if (!symbol || !(qty > 0) || !(buy_price > 0)) return toast('Symbol, qty, and buy price (greater than 0) required', 'err');

  const cost = parseFloat((qty * buy_price).toFixed(2));
  // Buying something already held (from "+ Add Investment") — same holding
  const existing = investModalMode === 'buy'
    ? HOLDINGS.find(h => h.id === editId)
    : investModalMode === 'add' ? HOLDINGS.find(h => h.symbol === symbol && h.type === type) : null;

  if (investModalMode !== 'edit') {
    if (existing && investModalMode === 'add') {
      const ok = await confirmDialog({
        title: `You already hold ${symbol}`,
        message: `Add these ${qty} units to your existing ${symbol} holding? Its buy price will be re-averaged.`,
        confirmText: 'Add to holding',
      });
      if (!ok) return;
    }
    if (cost > cashBalance + 0.005) {
      const ok = await confirmDialog({
        title: 'Not enough cash',
        message: `This costs $${cost.toFixed(2)} but your cash balance is $${cashBalance.toFixed(2)}.\nRecord it anyway (cash goes negative), or cancel and deposit funds first.`,
        confirmText: 'Record anyway',
      });
      if (!ok) return;
    }
  }

  const btn = document.getElementById('add-invest-btn');
  const btnText = btn.textContent;
  btn.textContent = 'Saving…'; btn.disabled = true;

  const payload = {
    symbol, type,
    buy_date: document.getElementById('i-date').value || localToday(),
    qty, buy_price, cur_price,
    notes: document.getElementById('i-notes').value || null
  };

  try {
    if (investModalMode === 'edit') {
      // EDIT MODE — cash follows the new cost basis by itself
      const idx = HOLDINGS.findIndex(h => h.id === editId);

      const result = await sbUpdate('investments', editId, payload);
      const updated = result && result[0] ? result[0] : { ...payload, id: editId };
      if (idx !== -1) {
        HOLDINGS[idx] = {
          ...HOLDINGS[idx],
          ...updated,
          buyPrice: buy_price,
          // cleared price → buy price, as a reload would show (a live price stays)
          curPrice: cur_price > 0 ? cur_price : HOLDINGS[idx].livePrice ? HOLDINGS[idx].curPrice : buy_price,
          qty,
          color: assetColor(symbol),
        };
      }

      await persistBalances();
      toast('Investment updated ✓');
    } else if (existing) {
      // BUY MORE — one holding, quantity added, buy price re-averaged
      const { newQty, newAvg } = await mergeIntoHolding(existing, qty, buy_price);
      await persistBalances();
      toast(`Bought ${qty} ${symbol} ✓  Now ${newQty} @ avg $${newAvg}`);
    } else {
      // ADD MODE — buying with cash: the holding's cost comes out of cash
      const result = await sbInsert('investments', { ...payload, user_id: currentUser.id });
      if (result && result[0]) {
        HOLDINGS.push({
          ...result[0],
          buyPrice: buy_price,
          curPrice: cur_price > 0 ? cur_price : buy_price,
          qty,
          color: assetColor(symbol),
          livePrice: false,
        });
        await persistBalances();
        toast(`Investment added ✓  $${cost.toFixed(2)} deducted from cash`);
      }
    }

    closeModal('invest-modal');
    setInvestSymbolLocked(false);
    renderAll();
    // Re-fetch live price for this symbol
    fetchLivePrices();
  } catch (e) {
    toast(e.message, 'err');
  }

  btn.textContent = btnText;
  btn.disabled = false;
}


// ─── DELETE HOLDING ───────────────────────────────────────────────────────────
async function deleteHolding(id) {
  if (demoGuard()) return;
  const h = HOLDINGS.find(h => h.id === id);
  if (!h) return;
  const refund = parseFloat((h.qty * h.buyPrice).toFixed(2));
  const ok = await confirmDialog({
    title: `Remove ${h.symbol}?`,
    message: `Its cost basis ($${refund.toFixed(2)}) goes back to your cash balance — use this for a holding entered by mistake.\nTo record a sale, use "Close" instead.`,
    confirmText: 'Remove', danger: true,
  });
  if (!ok) return;
  try {
    await sbDelete('investments', id);
    HOLDINGS = HOLDINGS.filter(x => x.id !== id);
    await persistBalances();
    renderAll();
    toastAction('Holding removed', 'Undo', async () => {
      const row = {
        id: h.id, user_id: h.user_id, created_at: h.created_at, symbol: h.symbol, type: h.type,
        buy_date: h.buy_date, qty: h.qty, buy_price: h.buyPrice, cur_price: h.cur_price, notes: h.notes,
      };
      await sbInsert('investments', row);
      HOLDINGS.push(h);
      await persistBalances();
      renderAll();
      toast('Holding restored ✓');
    });
  } catch (e) {
    toast(e.message, 'err');
  }
}


async function clearRealizedHistory() {
  if (demoGuard()) return;
  const ok = await confirmDialog({
    title: 'Clear realized P&L history?',
    message: `Deletes all ${realizedHistory.length} closed-position records. Your cash balance and holdings are not changed.\nThis can't be undone.`,
    confirmText: 'Clear history', danger: true,
  });
  if (!ok) return;
  try {
    if (DB_READY) {
      const res = await sbRequest('DELETE', `realized_positions?user_id=eq.${currentUser.id}`);
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
    }
    // cash includes those sales' gains — they stay, as one adjustment
    const gains = sum(realizedHistory, r => r.realizedPnl);
    realizedHistory = [];
    await holdBalance('investing', gains, 'Realized gains from cleared sale history');
    await persistBalances();
    renderAll();
    toast('Realized history cleared');
  } catch (e) {
    toast(e.message, 'err');
  }
}

// ─── OPEN CLOSE POSITION MODAL ────────────────────────────────────────────────
function openClosePosition(id) {
  const h = HOLDINGS.find(h => h.id === id);
  if (!h) return;

  document.getElementById('cp-holding-id').value = id;
  document.getElementById('cp-date').value = localToday();
  document.getElementById('cp-exit-price').value = h.curPrice > 0 ? h.curPrice : '';
  document.getElementById('cp-qty').value = h.qty;
  document.getElementById('cp-type').value = 'full';

  document.getElementById('close-pos-info').innerHTML = `
    <div><div style="color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:0.5px">Symbol</div><div style="font-family:var(--mono);font-weight:700;margin-top:2px">${esc(h.symbol)}</div></div>
    <div><div style="color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:0.5px">Holdings</div><div style="font-family:var(--mono);font-weight:700;margin-top:2px">${h.qty} units</div></div>
    <div><div style="color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:0.5px">Avg Buy Price</div><div style="font-family:var(--mono);font-weight:700;margin-top:2px">${fmtPrice(h.buyPrice)}</div></div>
    <div><div style="color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:0.5px">Current Price</div><div style="font-family:var(--mono);font-weight:700;margin-top:2px;color:${h.livePrice ? 'var(--green)' : 'var(--text)'}">${fmtPrice(h.curPrice)}${h.livePrice ? ' ●' : ''}</div></div>
  `;

  updateClosePnl();
  document.getElementById('close-position-modal').classList.add('open');
}

function onCloseTypeChange() {
  const id = document.getElementById('cp-holding-id').value;
  const h = HOLDINGS.find(h => h.id === id);
  if (!h) return;
  const type = document.getElementById('cp-type').value;
  if (type === 'full') document.getElementById('cp-qty').value = h.qty;
  updateClosePnl();
}

function updateClosePnl() {
  const id = document.getElementById('cp-holding-id').value;
  const h = HOLDINGS.find(h => h.id === id);
  if (!h) return;

  const exitPrice = parseFloat(document.getElementById('cp-exit-price').value) || 0;
  const qty = parseFloat(document.getElementById('cp-qty').value) || 0;
  // The type follows the qty typed, so "Full" can't sit next to a smaller qty
  if (qty > 0) document.getElementById('cp-type').value = Math.abs(qty - h.qty) < 1e-6 ? 'full' : 'partial';

  if (!exitPrice || !qty) {
    document.getElementById('cp-pnl-val').textContent = '—';
    document.getElementById('cp-proceeds-val').textContent = '—';
    document.getElementById('cp-ret-val').textContent = '—';
    return;
  }

  const realizedPnl = (exitPrice - h.buyPrice) * qty;
  const proceeds = exitPrice * qty;
  const retPct = ((exitPrice - h.buyPrice) / h.buyPrice * 100).toFixed(2);

  const pnlEl = document.getElementById('cp-pnl-val');
  const procEl = document.getElementById('cp-proceeds-val');
  const retEl  = document.getElementById('cp-ret-val');

  pnlEl.textContent = (realizedPnl >= 0 ? '+$' : '-$') + Math.abs(realizedPnl).toFixed(2);
  pnlEl.style.color = realizedPnl >= 0 ? 'var(--green)' : 'var(--red)';
  procEl.textContent = '$' + proceeds.toFixed(2);
  procEl.style.color = 'var(--text)';
  retEl.textContent = (retPct >= 0 ? '+' : '') + retPct + '%';
  retEl.style.color = retPct >= 0 ? 'var(--green)' : 'var(--red)';
}

// ─── SUBMIT CLOSE POSITION ────────────────────────────────────────────────────
async function submitClosePosition() {
  if (demoGuard()) return;
  const id = document.getElementById('cp-holding-id').value;
  const h = HOLDINGS.find(h => h.id === id);
  if (!h) return;

  const exitPrice = parseFloat(document.getElementById('cp-exit-price').value);
  const qtySold   = parseFloat(document.getElementById('cp-qty').value);
  const closeDate = document.getElementById('cp-date').value || localToday();

  if (!(exitPrice > 0) || !(qtySold > 0)) return toast('Enter an exit price and qty greater than 0', 'err');
  if (qtySold > h.qty) return toast(`Max qty is ${h.qty}`, 'err');

  const realizedPnl = (exitPrice - h.buyPrice) * qtySold;
  const proceeds    = exitPrice * qtySold;

  const btn = document.getElementById('cp-submit-btn');
  btn.textContent = 'Processing…'; btn.disabled = true;

  try {
    // Decided by the qty sold, never the dropdown alone: "Full" with a smaller
    // qty used to delete the whole holding while paying out only the qty sold
    const isFullClose = Math.abs(qtySold - h.qty) < 0.000001;
    const record = {
      date: closeDate,
      symbol: h.symbol,
      type: h.type,
      buyDate: h.buy_date || null,
      qtySold: parseFloat(qtySold.toFixed(8)),
      avgCost: parseFloat(h.buyPrice.toFixed(12)),
      exitPrice: parseFloat(exitPrice.toFixed(12)),
      realizedPnl: parseFloat(realizedPnl.toFixed(2)),
      proceeds: parseFloat(proceeds.toFixed(2)),
      closeType: isFullClose ? 'Full' : 'Partial'
    };
    // Record the sale first — if that fails, the holding is left untouched
    if (DB_READY) {
      const inserted = await sbInsert('realized_positions', {
        user_id: currentUser.id, date: record.date, symbol: record.symbol, type: record.type,
        buy_date: record.buyDate, qty_sold: record.qtySold, avg_cost: record.avgCost,
        exit_price: record.exitPrice, realized_pnl: record.realizedPnl, proceeds: record.proceeds,
        close_type: record.closeType,
      });
      record.id = inserted && inserted[0] ? inserted[0].id : null;
    } else {
      record.id = Date.now().toString();
    }

    if (isFullClose) {
      await sbDelete('investments', id);
      HOLDINGS = HOLDINGS.filter(h => h.id !== id);
    } else {
      const newQty = parseFloat((h.qty - qtySold).toFixed(8));
      await sbUpdate('investments', id, { qty: newQty, cur_price: exitPrice });
      const idx = HOLDINGS.findIndex(h => h.id === id);
      if (idx !== -1) {
        HOLDINGS[idx].qty = newQty;
        if (!HOLDINGS[idx].livePrice) HOLDINGS[idx].curPrice = exitPrice; // same as what was saved
      }
    }

    realizedHistory.unshift(record);
    await persistBalances();

    closeModal('close-position-modal');
    renderAll();
    toast(`Position closed ✓  ${realizedPnl >= 0 ? '+' : ''}$${realizedPnl.toFixed(2)} realized`);
  } catch (e) {
    toast(e.message, 'err');
  }

  btn.textContent = 'Close Position'; btn.disabled = false;
}

// ─── UNDO A CLOSED POSITION ───────────────────────────────────────────────────
// Puts the sold units back into the holding (re-averaging its buy price, or
// re-creating it if it was fully closed), takes the proceeds back out of
// cash, and deletes the record — exactly as if the sale never happened.
async function undoRealizedPosition(id) {
  if (demoGuard()) return;
  const r = realizedHistory.find(x => String(x.id) === String(id));
  if (!r) return;
  const ok = await confirmDialog({
    title: `Undo ${r.symbol} sale?`,
    message: `${r.qtySold} units go back into your ${r.symbol} holding, and $${r.proceeds.toFixed(2)} comes back out of cash.\nUse this to fix a sale entered by mistake, then close it again with the right numbers.`,
    confirmText: 'Undo sale',
  });
  if (!ok) return;
  try {
    const h = HOLDINGS.find(x => x.symbol === r.symbol && x.type === r.type);
    if (h) {
      const qty = parseFloat((h.qty + r.qtySold).toFixed(8));
      const buyPrice = parseFloat(((h.qty * h.buyPrice + r.qtySold * r.avgCost) / qty).toFixed(12));
      await sbUpdate('investments', h.id, { qty, buy_price: buyPrice });
      h.qty = qty; h.buyPrice = buyPrice;
    } else {
      const result = await sbInsert('investments', {
        user_id: currentUser.id, symbol: r.symbol, type: r.type || 'Other',
        buy_date: r.buyDate || r.date, qty: r.qtySold, buy_price: r.avgCost, cur_price: r.exitPrice,
      });
      if (result && result[0]) {
        HOLDINGS.push({ ...result[0], buyPrice: r.avgCost, curPrice: r.exitPrice, qty: r.qtySold, color: assetColor(r.symbol), livePrice: false });
      }
    }
    if (DB_READY) await sbDelete('realized_positions', r.id);
    realizedHistory = realizedHistory.filter(x => x !== r);
    await persistBalances();
    renderAll();
    fetchLivePrices();
    toast(`${r.symbol} sale undone ✓`);
  } catch (e) {
    toast(e.message, 'err');
  }
}

// ─── RENDER REALIZED HISTORY ──────────────────────────────────────────────────
function renderRealizedHistory() {
  const card = document.getElementById('realized-history-card');
  const body = document.getElementById('realized-history-body');
  if (!card || !body) return;

  if (realizedHistory.length === 0) {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';

  body.innerHTML = realizedHistory.map(r => `<tr>
    <td class="mono" style="color:var(--muted)">${esc(r.date)}</td>
    <td style="font-weight:600">${esc(r.symbol)} <span style="font-size:9px;color:var(--muted)">${esc(r.closeType)}</span></td>
    <td class="mono">${r.qtySold}</td>
    <td class="mono" style="color:var(--muted)">${fmtPrice(r.avgCost)}</td>
    <td class="mono">${fmtPrice(r.exitPrice)}</td>
    <td class="mono ${r.realizedPnl >= 0 ? 'green' : 'red'}"><span class="balance-val">${fmt(r.realizedPnl)}</span></td>
    <td class="mono"><span class="balance-val">${fmtMoney(r.proceeds)}</span></td>
    <td><button class="btn-close-mini" data-action="undo-realized" data-id="${esc(r.id)}" title="Undo this sale">Undo</button></td>
  </tr>`).join('');
}
ACTIONS['undo-realized'] = el => undoRealizedPosition(el.dataset.id);
