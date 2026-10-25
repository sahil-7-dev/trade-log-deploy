// ═══════════════════════════════════════════════════════════════════════════
// Yearly Recap page: any year in isolation — stats from the same engine as
// the dashboard, monthly bars, cumulative line and the monthly heatmap.
// ═══════════════════════════════════════════════════════════════════════════

registerPage('yearly', {
  title: 'Yearly Recap', subtitle: 'Any year in isolation', icon: '◫', section: 'Tools', order: 31,
  render: () => renderYearlyRecap(),
});

let selectedRecapYear = null;

function getAvailableYears() {
  const years = new Set(TRADES.map(t => parseInt(t.date.split('-')[0], 10)));
  years.add(new Date().getFullYear()); // always offer the current year, even with no trades logged yet
  return [...years].sort((a, b) => b - a);
}

function renderYearlyRecap() {
  const years = getAvailableYears();
  if (selectedRecapYear === null || !years.includes(selectedRecapYear)) {
    selectedRecapYear = years[0];
  }

  const sel = document.getElementById('yr-year-select');
  if (sel) {
    sel.innerHTML = years.map(y => `<option value="${y}" ${y === selectedRecapYear ? 'selected' : ''}>${y}</option>`).join('');
  }

  const yearTrades = TRADES.filter(t => parseInt(t.date.split('-')[0], 10) === selectedRecapYear);
  const s = computeStats(yearTrades);

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerHTML = val; };
  const setClass = (id, cls) => { const el = document.getElementById(id); if (el) el.className = 'stat-val ' + cls; };

  set('yr-pnl', s.totalPnl !== 0 || s.closed.length ? bv(fmt(s.totalPnl)) : '—');
  setClass('yr-pnl', s.totalPnl >= 0 ? 'green' : 'red');
  set('yr-pnl-sub', s.closed.length ? (s.winRate != null ? `${s.winRate}% win rate` : 'all breakeven') : 'No closed trades');

  set('yr-winrate', s.winRate != null ? s.winRate + '%' : '—');
  set('yr-winrate-sub', s.closed.length ? `${s.wins.length}W / ${s.losses.length}L${s.breakeven.length ? ' / ' + s.breakeven.length + ' BE' : ''} / ${s.open.length} Open` : '—');

  set('yr-rr', s.avgRR != null ? s.avgRR.toFixed(2) + 'R' : '—');
  set('yr-rr-sub', s.avgRR != null ? 'Avg achieved' : 'No RR data');

  set('yr-expect', s.closed.length ? bv(fmt(s.expectancy)) : '—');
  setClass('yr-expect', s.expectancy >= 0 ? 'green' : 'red');

  set('yr-best', s.bestTrade ? bv(fmt(s.bestTrade.pnl)) : '—');
  set('yr-best-sym', s.bestTrade ? esc(s.bestTrade.symbol) : '—');
  set('yr-worst', s.worstTrade ? bv(fmt(s.worstTrade.pnl)) : '—');
  set('yr-worst-sym', s.worstTrade ? esc(s.worstTrade.symbol) : '—');

  renderHeatmapInto('yearly-heatmap', selectedRecapYear);

  const monthly = getMonthlyPnl(selectedRecapYear).map(v => v != null ? round2(v) : 0);
  barChart('yrMonthlyChart', MONTHLY_LABELS, monthly, { polarity: true, label: 'Net P&L', empty: !s.closed.length });
  // The cumulative line stops at the current month — months still ahead have no result yet
  const now = new Date();
  const lastMonth = selectedRecapYear < now.getFullYear() ? 11 : selectedRecapYear > now.getFullYear() ? -1 : now.getMonth();
  let c = 0;
  lineChart('yrCumChart', MONTHLY_LABELS, [{ label: 'Cumulative', data: monthly.map((v, i) => i > lastMonth ? null : round2(c += v)), color: CHART.series[0], fill: true, points: true }],
    { empty: !s.closed.length });
}

function onRecapYearChange(value) {
  selectedRecapYear = parseInt(value, 10);
  renderYearlyRecap();
}

