// ═══════════════════════════════════════════════════════════════════════════
// Portfolio page: holdings with live prices, cash, realized P&L, allocation
// (by holding and by asset type), return per holding, value history, sales.
// ═══════════════════════════════════════════════════════════════════════════

registerPage('investing', {
  title: 'Portfolio', subtitle: 'Long-term holdings, cash and allocation', icon: '◆', section: 'Investing', order: 10,
  render: renderPortfolioPage,
});

function renderPortfolioPage(ctx) {
  const s = ctx.stats;
  const invPct = s.invCost > 0 ? s.invPnl / s.invCost * 100 : null;
  const pctText = v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
  setHtml('inv-ret-pct', invPct != null ? `<span class="${invPct >= 0 ? 'green' : 'red'}">${pctText(invPct)}</span>` : '—');
  setText('inv-count', HOLDINGS.length ? `Across ${HOLDINGS.length} asset${HOLDINGS.length !== 1 ? 's' : ''}` : 'No holdings');
  setHtml('inv-pnl', s.invTotal ? bv(fmt(s.invPnl)) : '—');
  setValClass('inv-pnl', s.invPnl >= 0);
  setText('inv-pnl-pct', invPct != null ? `${pctText(invPct)} on cost` : '—');
  const ret = h => (h.curPrice - h.buyPrice) / h.buyPrice * 100;
  const byRet = [...HOLDINGS].sort((a, b) => ret(b) - ret(a));
  setHtml('inv-best', byRet.length ? pctText(ret(byRet[0])) : '—');
  setHtml('inv-best-sym', byRet.length ? esc(byRet[0].symbol) : '—');
  setHtml('inv-worst', byRet.length ? pctText(ret(byRet[byRet.length - 1])) : '—');
  setHtml('inv-worst-sym', byRet.length ? esc(byRet[byRet.length - 1].symbol) : '—');
  // Color by sign — the best holding can be a loss, the worst can be a gain
  if (byRet.length) { setValClass('inv-best', ret(byRet[0]) >= 0); setValClass('inv-worst', ret(byRet[byRet.length - 1]) >= 0); }
  if (isDemoMode) setText('price-status', 'Demo prices');

  renderInvestingStats();
  renderHoldings();
  renderRealizedHistory();
  renderAllocation();
  renderPortfolioHistory();
}

// Allocation: by holding (≤ 6 + Other, cash its own slice) and by asset type
function renderAllocation() {
  const parts = HOLDINGS.map(h => ({ label: h.symbol, value: h.qty * h.curPrice })).sort((a, b) => b.value - a.value);
  const top = parts.slice(0, 6).map((p, i) => ({ ...p, color: CHART.series[i] }));
  const rest = sum(parts.slice(6), p => p.value);
  if (rest > 0) top.push({ label: 'Other', value: rest, color: CHART.other });
  if (cashBalance > 0) top.push({ label: 'Cash', value: cashBalance, color: '#3d4252' });
  donutChart('allocChart', top);

  const types = ['Crypto', 'Stocks', 'ETF', 'Other'];
  const total = sum(HOLDINGS, h => h.qty * h.curPrice) + Math.max(0, cashBalance);
  const rows = types.map(t => ({ label: t, value: sum(HOLDINGS.filter(h => h.type === t), h => h.qty * h.curPrice) }))
    .concat([{ label: 'Cash', value: Math.max(0, cashBalance) }]).filter(r => r.value > 0);
  setHtml('alloc-types', total ? rows.map(r => `<div class="alloc-row"><span>${r.label}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${r.value / total * 100}%;background:${CHART.series[0]}"></div></div>
      <span class="num" style="text-align:right">${(r.value / total * 100).toFixed(1)}%</span></div>`).join('')
    : emptyState('◆', 'Nothing invested yet', 'Add a holding or deposit cash to see your allocation.'));

  const rets = HOLDINGS.map(h => ({ s: h.symbol, v: round2((h.curPrice - h.buyPrice) / h.buyPrice * 100) })).sort((a, b) => b.v - a.v);
  barChart('holdingRetChart', rets.map(r => r.s), rets.map(r => r.v), {
    polarity: true, horizontal: true, label: 'Return', format: v => `${v >= 0 ? '+' : ''}${v}%`, axis: { ticks: { callback: v => v + '%' } },
  });
}

function renderInvestingStats() {
  const totalRealized = realizedHistory.reduce((s, r) => s + r.realizedPnl, 0);
  const holdingsVal = HOLDINGS.reduce((s, h) => s + h.qty * h.curPrice, 0);
  const totalEquity = holdingsVal + cashBalance;

  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };

  set('inv-cash', `<span class="balance-val">${fmtMoney(cashBalance)}</span>`);
  const cashEl = document.getElementById('inv-cash');
  if (cashEl) cashEl.className = 'stat-val ' + (cashBalance >= 0 ? 'green' : 'red');

  set('inv-realized', `<span class="balance-val">${fmt(totalRealized)}</span>`);
  const realizedEl = document.getElementById('inv-realized');
  if (realizedEl) realizedEl.className = 'stat-val ' + (totalRealized >= 0 ? 'green' : 'red');
  set('inv-realized-sub', `${realizedHistory.length} closed position${realizedHistory.length !== 1 ? 's' : ''}`);

  set('inv-total-equity', `<span class="balance-val">${fmtMoney(totalEquity)}</span>`);
  const eqEl = document.getElementById('inv-total-equity');
  if (eqEl) eqEl.className = 'stat-val ' + (totalEquity >= 0 ? 'green' : 'red');
}


function renderHoldings() {
  const list = document.getElementById('holdings-list');
  if (!list) return;

  // USD isn't a real `investments` row (no id, nothing to close/edit/delete) —
  // it's the cash balance rendered as a holdings-list entry for a true picture
  // of the portfolio. Always shown, even at $0, so "+ Deposit" is discoverable.
  const usdRow = `<div class="holding-row">
    <div class="holding-icon" style="background:#00D4AA22;color:#00D4AA">USD</div>
    <div class="holding-info">
      <div class="holding-name" style="display:flex;align-items:center;gap:4px">
        US Dollar
        <span style="font-size:10px;color:var(--muted);font-weight:400">Cash</span>
      </div>
      <div class="holding-qty">Available cash balance</div>
    </div>
    <div class="holding-vals">
      <div class="holding-val"><span class="balance-val">${fmtMoney(cashBalance)}</span></div>
      <div class="holding-ret" style="color:var(--muted)">—</div>
    </div>
    <button class="btn btn-ghost" data-action="open-deposit-cash" style="font-size:10px;padding:3px 10px;margin-left:4px;text-transform:none;letter-spacing:normal">± Funds</button>
  </div>`;

  if (HOLDINGS.length === 0) {
    list.innerHTML = usdRow + `<div style="text-align:center;padding:32px;color:var(--muted)">No holdings yet — click "+ Add Investment"</div>`;
    return;
  }
  list.innerHTML = usdRow + HOLDINGS.map(h => {
    const cost = h.qty * h.buyPrice;
    const val = h.qty * h.curPrice;
    const pnl = val - cost;
    const pct = cost > 0 ? (pnl / cost * 100).toFixed(1) : '0.0';

    // 24h change from live data
    const sym = cleanSymbol(h.symbol);
    const liveData = livePrices[sym];
    const change24h = liveData ? liveData.change24h : null;
    const change24hStr = change24h != null
      ? `<span style="font-family:var(--mono);font-size:10px;color:${change24h >= 0 ? 'var(--green)' : 'var(--red)'}">
           ${change24h >= 0 ? '▲' : '▼'} ${Math.abs(change24h).toFixed(2)}% 24h
         </span>`
      : '';

    const liveBadge = h.livePrice
      ? `<span style="font-size:8px;font-family:var(--mono);color:var(--green);background:var(--green-dim);padding:2px 5px;border-radius:3px;margin-left:4px;letter-spacing:0.3px">LIVE</span>`
      : `<span style="font-size:8px;font-family:var(--mono);color:var(--muted);background:var(--faint);padding:2px 5px;border-radius:3px;margin-left:4px">MANUAL</span>`;

    const curPriceStr = h.livePrice
      ? `<span style="font-family:var(--mono);font-size:10px;color:var(--muted)">@ ${fmtPrice(h.curPrice)}</span>`
      : '';

    const safeSym    = esc(sym.slice(0, 3));
    const safeSymbol = esc(h.symbol);
    const safeType   = esc(h.type);
    const safeId     = esc(h.id);

    return `<div class="holding-row">
      <div class="holding-icon" style="background:${h.color}22;color:${h.color}">${safeSym}</div>
      <div class="holding-info">
        <div class="holding-name" style="display:flex;align-items:center;gap:4px">
          ${safeSymbol}
          <span style="font-size:10px;color:var(--muted);font-weight:400">${safeType}</span>
          ${liveBadge}
        </div>
        <div class="holding-qty" style="display:flex;align-items:center;gap:8px">
          ${h.qty} units · Avg <span class="balance-val">${fmtPrice(h.buyPrice)}</span>
          ${h.livePrice ? `<span class="balance-val" style="font-family:var(--mono);font-size:10px;color:var(--muted)">@ ${fmtVal(h.curPrice)}</span>` : ''}
          ${change24hStr}
        </div>
      </div>
      <div class="holding-vals">
        <div class="holding-val"><span class="balance-val">${fmtVal(val)}</span></div>
        <div class="holding-ret ${pnl >= 0 ? 'green' : 'red'}"><span class="balance-val">${fmt(pnl)}</span> (${pnl >= 0 ? '+' : ''}${pct}%)</div>
      </div>
      <button class="btn-close-mini" data-action="open-buy-more" data-id="${safeId}" title="Buy more" style="border:none;cursor:pointer;font-size:10px;padding:3px 8px;border-radius:4px;font-family:var(--mono);font-weight:600;margin-left:4px">+ Buy</button>
      <button class="btn-close-position" data-action="open-close-position" data-id="${safeId}" style="border:1px solid var(--green);cursor:pointer;font-size:10px;padding:3px 8px;border-radius:4px;font-family:var(--mono);font-weight:600;margin-left:4px">Close</button>
      <button class="icon-btn-edit" data-action="open-edit-investment" data-id="${safeId}" style="background:none;border:none;cursor:pointer;font-size:12px;padding:2px 8px;border-radius:4px">✎</button>
      <button class="icon-btn-delete" data-action="delete-holding" data-id="${safeId}" style="background:none;border:none;cursor:pointer;font-size:12px;padding:2px 8px;margin-left:2px;border-radius:4px">✕</button>
    </div>`;
  }).join('');
}

// ─── PORTFOLIO SNAPSHOTS (one per day, for the history chart) ────────────────
// Taken from the browser whenever the app is open (once live prices are in),
// so days the app wasn't opened have no point — the line just connects.
// Re-saved through the day: at once when money moves (deposit, buy, sale —
// cost basis or cash changed), and at most every 15 minutes for price moves,
// so each day's point is that day's latest value, not its first.
let snapshotSavedFor = null; // "date|cost|cash" of the last save
let snapshotSavedAt = 0;
const SNAPSHOT_EVERY_MS = 15 * 60 * 1000;
async function maybeSaveSnapshot() {
  if (isDemoMode || !DB_READY || !currentUser) return;
  const today = localToday();
  const hasCrypto = HOLDINGS.some(h => h.type === 'Crypto');
  if (hasCrypto && !lastPriceUpdate) return; // wait for live prices
  if (!HOLDINGS.length && !cashBalance) return;
  const row = {
    user_id: currentUser.id, date: today,
    holdings_value: round2(sum(HOLDINGS, h => h.qty * h.curPrice)),
    cost_basis: round2(sum(HOLDINGS, h => h.qty * h.buyPrice)),
    cash: round2(cashBalance),
  };
  const key = [today, row.cost_basis, row.cash].join('|');
  if (key === snapshotSavedFor && Date.now() - snapshotSavedAt < SNAPSHOT_EVERY_MS) return;
  snapshotSavedFor = key; snapshotSavedAt = Date.now();
  try {
    const res = await sbRequest('POST', 'portfolio_snapshots?on_conflict=user_id,date', row, false, 'resolution=merge-duplicates,return=minimal');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    SNAPSHOTS = SNAPSHOTS.filter(s => s.date !== today).concat([row]);
  } catch (e) {
    snapshotSavedFor = null;
    log.warn('[snapshot] save failed:', e.message);
  }
}

function renderPortfolioHistory() {
  if (!document.getElementById('portfolioHistoryChart')) return;
  const card = document.getElementById('portfolio-history-card');
  if (card) card.style.display = DB_READY ? '' : 'none';
  // Today's point is always the live value, saved snapshot or not
  const live = {
    date: localToday(), holdings_value: sum(HOLDINGS, h => h.qty * h.curPrice),
    cost_basis: sum(HOLDINGS, h => h.qty * h.buyPrice), cash: cashBalance,
  };
  const pts = [...SNAPSHOTS.filter(s => s.date !== live.date), ...(HOLDINGS.length || cashBalance ? [live] : [])]
    .sort((a, b) => a.date.localeCompare(b.date));
  setText('portfolio-history-meta', pts.length ? `${pts.length} day${pts.length !== 1 ? 's' : ''} recorded` : 'Builds up one point per day you open the app');
  lineChart('portfolioHistoryChart', pts.map(p => p.date), [
    { label: 'Total value', data: pts.map(p => round2(p.holdings_value + p.cash)), color: CHART.series[0], fill: true },
    { label: 'Money in (cost + cash)', data: pts.map(p => round2(p.cost_basis + p.cash)), color: CHART.other, dashed: true },
  ], { empty: !pts.length });
}

// Saved from whichever page is open, once a day
RENDER_HOOKS.push(() => { maybeSaveSnapshot(); });
