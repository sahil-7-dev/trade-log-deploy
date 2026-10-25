// ═══════════════════════════════════════════════════════════════════════════
// Trade Log page: trading balance, stats, the full trade table (search,
// filters, sortable columns, pages), breakeven trades. tradeRow() is also
// used by the Overview page's recent-trades table.
// ═══════════════════════════════════════════════════════════════════════════

registerPage('trades', {
  title: 'Trade Log', subtitle: 'Every trade, searchable and sortable', icon: '⇄', section: 'Trading', order: 2,
  render: renderTradeLogPage,
});

function renderTradeLogPage(ctx) {
  const s = ctx.stats;
  renderTradingBalance();
  // the same date range as the table and every stat below
  setHtml('tl-total', ctx.ranged.length || '—');
  setHtml('tl-total-sub', ctx.ranged.length ? `${s.closed.length} closed, ${s.open.length} open` : '—');
  setHtml('tl-pf', s.profitFactor != null ? s.profitFactor.toFixed(2) : '—');
  const fb = feeBreakdown(ctx.ranged);
  setHtml('tl-fees', fb.total ? bv(fmtMoney(fb.total)) : '—');
  setHtml('tl-fees-sub', fb.total ? bv(feeSplitText(fb)) : 'No fees recorded');
  setHtml('tl-avgwin', s.wins.length ? bv(fmt(s.avgWin)) : '—');
  setHtml('tl-avgloss', s.losses.length ? bv(fmt(s.avgLoss)) : '—');
  setHtml('tl-bstreak', s.bestStreak > 0 ? s.bestStreak + 'W' : '—');
  setHtml('tl-wstreak', s.worstStreak < 0 ? Math.abs(s.worstStreak) + 'L' : '—');
  setHtml('tl-closed-pos', s.closed.length ? bv(fmt(s.totalPnl)) : '—');
  setValClass('tl-closed-pos', s.totalPnl >= 0);
  setHtml('tl-closed-pos-sub', s.closed.length
    ? `${s.closed.length} position${s.closed.length !== 1 ? 's' : ''} fully closed${s.winRate != null ? ` · ${s.winRate}% win rate` : ''}`
    : 'No fully closed positions');
  setHtml('tl-closed-trades', s.closedTradesCount ? bv(fmt(s.closedTradesPnl)) : '—');
  setValClass('tl-closed-trades', s.closedTradesPnl >= 0);
  setHtml('tl-closed-trades-sub', s.closedTradesCount
    ? `${s.closedTradesCount} trade${s.closedTradesCount !== 1 ? 's' : ''}` +
      (s.partlyClosed.length ? ` · incl. ${s.partlyClosed.length} partly closed (${bv(fmt(s.partialRealized))})` : ' · none partly closed')
    : 'Nothing closed yet');
  renderOpenPnl();
  refreshTradeLogFilterOptions();
  renderTrades();
  renderBreakevenTrades();
}

let recentFilter = 'All';
let allFilter = 'All';

function filterRecent(f, btn) {
  recentFilter = f;
  document.querySelectorAll('#page-dashboard .table-filters .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderRecentTrades();
}

function filterAll(f, btn) {
  allFilter = f;
  document.querySelectorAll('#page-trades .table-filters .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  TL_PAGE = 1;
  renderTrades();
}

function tradeRow(t, showNotes = false, showActions = false) {
  const pnl = t.pnl;
  const rr = t.rr;
  // Escape all user-supplied strings before injection into innerHTML
  const safeSymbol = esc(t.symbol);
  const safeType   = esc(t.type);
  const safeDir    = esc(t.dir);
  const safeStatus = esc(t.status);
  const safeNotes  = esc(t.notes) || '—';
  const safeId     = esc(t.id);
  const tagsHtml   = Array.isArray(t.tags) && t.tags.length
    ? t.tags.map(tag => `<span class="tag-chip">${esc(tag)}</span>`).join('')
    : '—';

  // Partial closes live inside this trade: show progress while it's open,
  // and "avg of N closes" once it's done. Hover lists every close.
  const partial = partialCloseInfo(t);
  const fillsTitle = t.closes.length
    ? esc(t.closes.map(f => `${f.date || ''}: closed $${(+f.size).toFixed(2)} @ ${fmtPx(f.exit)} (${f.pnl >= 0 ? '+' : '-'}$${Math.abs(f.pnl).toFixed(2)})`).join('\n'))
    : '';
  const subLine = txt => `<div style="font-size:9px;color:var(--muted);margin-top:2px">${txt}</div>`;
  let exitCell, pnlCell;
  if (t.exit != null) {
    exitCell = fmtPx(t.exit) + (t.closes.length > 1 ? subLine(`avg of ${t.closes.length} closes`) : '');
    pnlCell = fmt(pnl);
  } else {
    exitCell = '<span style="color:var(--amber)">Open</span>' +
      (partial ? subLine(`${Math.round(partial.closedSize / partial.originalSize * 100)}% closed · $${t.size.toFixed(2)} left`) : '');
    // Live unrealized P&L (crypto, from the same CoinGecko prices as holdings)
    const u = unrealizedPnl(t);
    const parts = [];
    if (u != null) parts.push(`<span class="${u >= 0 ? 'green' : 'red'}" title="Unrealized at ${esc(String(livePriceForTrade(t)))}">${fmt(u)}</span>`);
    if (partial) parts.push(`<span style="color:var(--muted);font-size:10px">${fmt(partial.realized)} realized</span>`);
    pnlCell = parts.length ? parts.join('<br>') : '—';
  }

  return `<tr>
    <td class="mono" style="color:var(--muted)">${esc(t.date)}</td>
    <td style="font-weight:600"><span class="trade-link" data-action="open-trade-detail" data-id="${safeId}" title="Open trade details">${safeSymbol}</span></td>
    <td><span style="font-size:10px;color:var(--muted)">${safeType}</span></td>
    <td><span class="badge ${safeDir === 'Long' ? 'badge-long' : 'badge-short'}">${safeDir}</span></td>
    <td class="mono">${fmtPx(t.entry)}</td>
    <td class="mono" ${fillsTitle ? `title="${fillsTitle}" style="cursor:help"` : ''}>${exitCell}</td>
    <td class="mono ${pnl > 0 ? 'green' : pnl < 0 ? 'red' : ''}"><span class="balance-val">${pnlCell}</span></td>
    <td class="mono ${rr != null && rr > 0 ? 'green' : rr != null && rr < 0 ? 'red' : ''}">${rr != null ? rr.toFixed(2) + 'R' : '—'}</td>
    <td><span class="badge ${safeStatus === 'Win' ? 'badge-win' : safeStatus === 'Loss' ? 'badge-loss' : safeStatus === 'Breakeven' ? 'badge-breakeven' : 'badge-open'}">${safeStatus}</span></td>
    ${showNotes ? `<td style="max-width:120px">${tagsHtml}</td>` : ''}
    ${showNotes ? `<td style="color:var(--muted);font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis">${safeNotes}</td>` : ''}
    ${showActions ? `<td style="white-space:nowrap">
      ${safeStatus === 'Open' ? `<button class="btn-close-mini" data-action="open-close-trade" data-id="${safeId}">${partial ? 'Close rest' : 'Close'}</button>` : ''}
      <button class="icon-btn-edit" data-action="open-edit-trade" data-id="${safeId}" style="background:none;border:none;cursor:pointer;font-size:12px;padding:2px 5px;border-radius:4px">✎</button>
      <button class="icon-btn-delete" data-action="delete-trade" data-id="${safeId}" style="background:none;border:none;cursor:pointer;font-size:12px;padding:2px 5px;border-radius:4px">✕</button>
    </td>` : ''}
  </tr>`;
}

function emptyRow(cols, msg) {
  return `<tr><td colspan="${cols}" style="text-align:center;padding:32px;color:var(--muted)">${msg}</td></tr>`;
}



function renderBreakevenTrades() {
  const card = document.getElementById('breakeven-card');
  const body = document.getElementById('breakeven-body');
  const summary = document.getElementById('breakeven-summary');
  if (!card || !body) return;

  const breakevenTrades = tradesInRange().filter(t => t.status === 'Breakeven');
  if (breakevenTrades.length === 0) {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';

  const totalPnl = breakevenTrades.reduce((s, t) => s + t.pnl, 0);
  if (summary) {
    summary.textContent = `${breakevenTrades.length} trade${breakevenTrades.length === 1 ? '' : 's'} · ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)} total — still counted in overall P&L`;
  }

  body.innerHTML = [...breakevenTrades].sort((a, b) => new Date(b.date) - new Date(a.date)).map(t => {
    const safeSymbol = esc(t.symbol), safeType = esc(t.type), safeDir = esc(t.dir);
    return `<tr>
    <td class="mono" style="color:var(--muted)">${esc(t.date)}</td>
    <td style="font-weight:600">${safeSymbol}</td>
    <td class="col-type">${safeType}</td>
    <td><span class="badge ${t.dir === 'Long' ? 'badge-long' : 'badge-short'}">${safeDir}</span></td>
    <td class="mono">${fmtPx(t.entry)}</td>
    <td class="mono">${fmtPx(t.exit)}</td>
    <td class="mono" style="color:var(--muted)">$${t.pnl.toFixed(2)}</td>
  </tr>`;
  }).join('');
}

function renderTradingBalance() {
  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  set('tl-balance', `<span class="balance-val">${fmtMoney(tradingBalance)}</span>`);
  const el = document.getElementById('tl-balance');
  if (el) el.className = 'stat-val ' + (tradingBalance >= 0 ? 'green' : 'red');
}

// Sortable columns: click a header (data-sort) to sort, again to flip
const TL_SORT = { key: 'date', dir: 'desc' };
const TL_SORTERS = {
  // local close day + time (raw closed_at is UTC, which misorders trades near midnight)
  date: t => closeSortKey(t) + (t.created_at || ''),
  symbol: t => t.symbol, type: t => t.type, dir: t => t.dir,
  entry: t => t.entry, exit: t => t.exit ?? -Infinity, pnl: t => t.status === 'Open' ? (unrealizedPnl(t) ?? 0) : t.pnl,
  rr: t => t.rr ?? -Infinity, status: t => t.status,
};
ACTIONS['tl-sort'] = el => {
  const key = el.dataset.sort;
  TL_SORT.dir = TL_SORT.key === key && TL_SORT.dir === 'desc' ? 'asc' : 'desc';
  TL_SORT.key = key;
  renderTrades();
};
function sortTrades(list) {
  const get = TL_SORTERS[TL_SORT.key] || TL_SORTERS.date;
  const m = TL_SORT.dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => { const x = get(a), y = get(b); return (x > y ? 1 : x < y ? -1 : 0) * m; });
}

function renderTrades() {
  const allBody = document.getElementById('all-trades-body');
  if (!allBody) return;
  // Trade Log: date range → status buttons → search/filter bar → sort → one page
  let allTrades = tradesInRange();
  if (allFilter !== 'All') allTrades = allTrades.filter(t => t.status === allFilter);
  allTrades = sortTrades(applyTradeLogFilters(allTrades));
  const pageTrades = paginateTradeLog(allTrades);
  document.querySelectorAll('#page-trades th[data-sort]').forEach(th => {
    th.classList.toggle('sort-asc', th.dataset.sort === TL_SORT.key && TL_SORT.dir === 'asc');
    th.classList.toggle('sort-desc', th.dataset.sort === TL_SORT.key && TL_SORT.dir === 'desc');
    th.setAttribute('aria-sort', th.dataset.sort === TL_SORT.key ? (TL_SORT.dir === 'asc' ? 'ascending' : 'descending') : 'none');
  });
  allBody.innerHTML = allTrades.length === 0
    ? `<tr><td colspan="13">${TRADES.length === 0
        ? emptyState('⇄', 'No trades yet', 'Log your first trade, import a CSV, or sync Bybit.', '<button class="btn btn-primary btn-sm" data-action="open-add-trade">+ Log trade</button> <button class="btn btn-ghost btn-sm" data-action="open-import">Import CSV</button>')
        : emptyState('⌕', 'No trades match', 'Try clearing the filters or widening the date range.', '<button class="btn btn-ghost btn-sm" data-action="tl-clear-filters">Clear filters</button>')}</td></tr>`
    : pageTrades.map(t => tradeRow(t, true, true)).join('');
}

// ─── TRADE LOG: SEARCH, FILTERS, PAGINATION ──────────────────────────────────
const TL_FILTERS = { q: '', type: '', dir: '', setup: '', tag: '', source: '' };
let TL_PAGE = 1;
let TL_PAGE_SIZE = 25;

function applyTradeLogFilters(list) {
  const q = TL_FILTERS.q.trim().toLowerCase();
  return list.filter(t =>
    (!q || [t.symbol, t.notes, t.setup, ...(t.tags || []), ...(t.mistakes || [])]
      .some(v => v && String(v).toLowerCase().includes(q))) &&
    (!TL_FILTERS.type || t.type === TL_FILTERS.type) &&
    (!TL_FILTERS.dir || t.dir === TL_FILTERS.dir) &&
    (!TL_FILTERS.setup || (t.setup || '') === TL_FILTERS.setup) &&
    (!TL_FILTERS.tag || (t.tags || []).includes(TL_FILTERS.tag)) &&
    (!TL_FILTERS.source || (t.source || 'manual') === TL_FILTERS.source));
}

function paginateTradeLog(list) {
  const pages = Math.max(1, Math.ceil(list.length / TL_PAGE_SIZE));
  if (TL_PAGE > pages) TL_PAGE = pages;
  const start = (TL_PAGE - 1) * TL_PAGE_SIZE;
  setHtml('tl-pager', list.length <= TL_PAGE_SIZE ? `<span>${list.length} trade${list.length !== 1 ? 's' : ''}</span>` : `
    <span>${start + 1}–${Math.min(start + TL_PAGE_SIZE, list.length)} of ${list.length}</span>
    <button class="filter-btn" data-action="tl-page" data-dir="-1" ${TL_PAGE === 1 ? 'disabled' : ''}>‹ Prev</button>
    <span>Page ${TL_PAGE} / ${pages}</span>
    <button class="filter-btn" data-action="tl-page" data-dir="1" ${TL_PAGE === pages ? 'disabled' : ''}>Next ›</button>`);
  return list.slice(start, start + TL_PAGE_SIZE);
}

// Keep the setup / tag dropdowns (and the trade form's setup suggestions)
// in step with what's actually been logged
function refreshTradeLogFilterOptions() {
  const setups = [...new Set(TRADES.map(t => t.setup).filter(Boolean))].sort();
  const tags = [...new Set(TRADES.flatMap(t => t.tags || []))].sort();
  const fill = (id, values, allLabel) => {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = `<option value="">${allLabel}</option>` + values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    el.value = values.includes(cur) ? cur : '';
  };
  fill('tl-f-setup', setups, 'All setups');
  fill('tl-f-tag', tags, 'All tags');
  setHtml('setup-suggestions', setups.map(s => `<option value="${esc(s)}">`).join(''));
}

let tlSearchTimer = null;
INPUT_HANDLERS['tl-search'] = el => {
  clearTimeout(tlSearchTimer);
  tlSearchTimer = setTimeout(() => { TL_FILTERS.q = el.value; TL_PAGE = 1; renderTrades(); }, 200);
};
[['tl-f-type', 'type'], ['tl-f-dir', 'dir'], ['tl-f-setup', 'setup'], ['tl-f-tag', 'tag'], ['tl-f-source', 'source']]
  .forEach(([id, key]) => { CHANGE_HANDLERS[id] = el => { TL_FILTERS[key] = el.value; TL_PAGE = 1; renderTrades(); }; });
CHANGE_HANDLERS['tl-page-size'] = el => { TL_PAGE_SIZE = parseInt(el.value, 10) || 25; TL_PAGE = 1; renderTrades(); };
ACTIONS['tl-page'] = el => { TL_PAGE += parseInt(el.dataset.dir, 10); renderTrades(); };
ACTIONS['tl-clear-filters'] = () => {
  Object.keys(TL_FILTERS).forEach(k => { TL_FILTERS[k] = ''; });
  ['tl-search', 'tl-f-type', 'tl-f-dir', 'tl-f-setup', 'tl-f-tag', 'tl-f-source'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  TL_PAGE = 1;
  renderTrades();
};

// ─── OPEN P&L CARD ───────────────────────────────────────────────────────────
function renderOpenPnl() {
  const open = TRADES.filter(t => t.status === 'Open');
  const priced = open.map(t => unrealizedPnl(t)).filter(v => v != null);
  const total = sum(priced);
  setHtml('tl-open-pnl', priced.length ? bv(fmt(total)) : '—');
  setValClass('tl-open-pnl', total >= 0);
  setText('tl-open-pnl-sub', open.length
    ? `${open.length} open · ${priced.length} with live price${priced.length < open.length ? ' (crypto only)' : ''}`
    : 'No open trades');
}
