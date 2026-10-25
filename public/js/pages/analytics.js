// ═══════════════════════════════════════════════════════════════════════════
// Performance page: where P&L comes from — month, setup, symbol, asset type,
// and the distribution of trade results.
// ═══════════════════════════════════════════════════════════════════════════

registerPage('analytics', {
  title: 'Performance', subtitle: 'Where your P&L comes from', icon: '◈', section: 'Trading', order: 3,
  render: renderPerformancePage,
});

const ASSET_TYPES = ['Crypto', 'Forex', 'Stocks'];

function renderPerformancePage(ctx) {
  const s = ctx.stats;
  const closed = chronological(s.closed);

  // ── KPI tiles
  const months = groupBy(closed, t => t.date.slice(0, 7));
  const monthTotals = [...months.values()].map(ts => sum(ts, t => t.pnl));
  const greenMonths = monthTotals.filter(v => v > 0).length;
  const bestMonth = [...months.entries()].sort((a, b) => sum(b[1], t => t.pnl) - sum(a[1], t => t.pnl))[0];
  const symbols = groupBy(closed, t => t.symbol);
  const topSymbol = [...symbols.entries()].sort((a, b) => sum(b[1], t => t.pnl) - sum(a[1], t => t.pnl))[0];
  setHtml('perf-kpis', [
    statTile({ label: 'Net P&L', value: s.closed.length ? bv(fmt(s.totalPnl)) : '—', cls: s.totalPnl >= 0 ? 'green' : 'red', sub: `${s.closed.length} closed trades` }),
    statTile({ label: 'Gross profit', value: bv(fmtMoney(s.grossWin)), cls: 'green', sub: `${s.wins.length} winners` }),
    statTile({ label: 'Gross loss', value: bv(fmtMoney(-s.grossLoss)), cls: 'red', sub: `${s.losses.length} losers` }),
    statTile({ label: 'Green months', value: months.size ? `${greenMonths}/${months.size}` : '—', sub: months.size ? `${(greenMonths / months.size * 100).toFixed(0)}% of months profitable` : 'No months yet', spark: monthTotals, sparkZero: true }),
    statTile({ label: 'Best month', value: bestMonth ? bv(fmt(sum(bestMonth[1], t => t.pnl))) : '—', cls: bestMonth && sum(bestMonth[1], t => t.pnl) < 0 ? 'red' : 'green', sub: bestMonth ? bestMonth[0] : '—' }),
    statTile({ label: 'Top symbol', value: topSymbol ? esc(topSymbol[0]) : '—', sub: topSymbol ? `${bv(fmt(sum(topSymbol[1], t => t.pnl)))} · ${topSymbol[1].length} trades` : '—' }),
  ].join(''));

  // ── Monthly net P&L (bars above/below zero)
  const monthKeys = [...months.keys()].sort();
  barChart('monthlyPnlChart', monthKeys.map(k => `${MONTHLY_LABELS[+k.slice(5) - 1]} ${k.slice(2, 4)}`),
    monthKeys.map(k => round2(sum(months.get(k), t => t.pnl))), { polarity: true, label: 'Net P&L' });

  // ── Cumulative P&L by setup: top 4 by |P&L| as lines, the rest folded into
  //    "Other" (categorical colors in fixed order — never more than 5 lines)
  const setups = groupBy(closed, t => t.setup || '(no setup)');
  const ranked = [...setups.entries()].sort((a, b) => Math.abs(sum(b[1], t => t.pnl)) - Math.abs(sum(a[1], t => t.pnl)));
  const top = ranked.slice(0, 4).map(([name]) => name);
  const dates = [...new Set(closed.map(t => t.date))];
  const seriesFor = (match) => {
    let c = 0;
    const byDate = groupBy(closed.filter(match), t => t.date);
    return dates.map(d => round2(c += sum(byDate.get(d) || [], t => t.pnl)));
  };
  const series = top.map((name, i) => ({ label: name, data: seriesFor(t => (t.setup || '(no setup)') === name), color: CHART.series[i] }));
  if (ranked.length > 4) series.push({ label: 'Other', data: seriesFor(t => !top.includes(t.setup || '(no setup)')), color: CHART.other });
  lineChart('setupCurveChart', dates, series, { empty: !closed.length });

  // ── P&L by symbol (top 10 by absolute P&L, horizontal)
  const symRanked = [...symbols.entries()].map(([k, ts]) => [k, round2(sum(ts, t => t.pnl))])
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 10).sort((a, b) => b[1] - a[1]);
  barChart('symbolPnlChart', symRanked.map(x => x[0]), symRanked.map(x => x[1]), { polarity: true, horizontal: true, label: 'Net P&L' });

  // ── By asset type
  barChart('assetPnlChart', ASSET_TYPES, ASSET_TYPES.map(type => round2(sum(closed.filter(t => t.type === type), t => t.pnl))),
    { polarity: true, label: 'Net P&L' });
  // Same definition as computeStats(): wins over decided trades, breakeven excluded
  const wrByAsset = ASSET_TYPES.map(type => {
    const decided = closed.filter(t => t.type === type && (t.status === 'Win' || t.status === 'Loss'));
    return decided.length ? round2(decided.filter(t => t.status === 'Win').length / decided.length * 100) : null; // no bar, not a 0% bar
  });
  barChart('winRateAssetChart', ASSET_TYPES, wrByAsset, {
    color: CHART.series[0], label: 'Win rate', format: v => v + '%',
    axis: { max: 100, min: 0, ticks: { callback: v => v + '%' } },
    empty: !wrByAsset.some(v => v != null), // all losses is a real 0%, not "no data"
  });

  // ── P&L distribution: how many trades landed in each result bucket
  const absMax = Math.max(...closed.map(t => Math.abs(t.pnl)), 1);
  const step = niceStep(absMax / 4);
  const edges = [-3, -2, -1, 0, 1, 2, 3].map(k => k * step);
  const h = histogram(closed.map(t => t.pnl), edges, (lo, hi) => lo == null ? `< ${fmtCompact(hi)}` : hi == null ? `≥ ${fmtCompact(lo)}` : `${fmtCompact(lo)}…`);
  barChart('pnlDistChart', h.labels, h.counts, {
    colors: h.labels.map((_, i) => i < 4 ? CHART.loss : CHART.profit), label: 'Trades',
    format: v => `${v} trade${v !== 1 ? 's' : ''}`, axis: { ticks: { precision: 0 } }, empty: !closed.length,
  });
}

function groupBy(list, keyFn) {
  const m = new Map();
  list.forEach(x => { const k = keyFn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
  return m;
}

// 1, 2, 5 × 10^n step that's ≥ raw
function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  return [1, 2, 5, 10].map(m => m * p).find(v => v >= raw) || p * 10;
}
