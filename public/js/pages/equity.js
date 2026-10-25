// ═══════════════════════════════════════════════════════════════════════════
// Equity page: overall equity, money put in vs taken out, return on capital,
// the trading account balance (with deposit / withdrawal markers), the
// trading equity curve, and monthly / cumulative P&L.
// ═══════════════════════════════════════════════════════════════════════════

registerPage('equity', {
  title: 'Equity', subtitle: 'Account balance and growth over time', icon: '↗', section: 'Investing', order: 11,
  render: renderEquityPage,
});

function renderEquityPage(ctx) {
  const s = ctx.stats;
  const nw = computeNetWorth(); // trading account + investing account, same as the Net Worth page
  setHtml('ov-equity', TRADES.length || HOLDINGS.length || cashBalance || tradingBalance ? bv(fmtVal(nw.total)) : '—');
  setHtml('ov-return', s.closed.length ? bv(fmt(s.totalPnl)) : '—');
  setValClass('ov-return', s.totalPnl >= 0);
  setText('ov-return-sub', s.closed.length ? 'Trading P&L in period' : '—');
  setHtml('ov-dd', s.maxDrawdown ? s.maxDrawdown.toFixed(1) + '%' : '—');
  setHtml('ov-trades', s.closed.length || '—');
  setText('ov-meta', s.closed.length ? `${s.closed.length} closed trades` : '');

  renderBalanceCurve();

  const chrono = chronological(s.closed);
  let cum = 0;
  lineChart('overallEquityChart', chrono.map(t => t.date), [{ label: 'Cumulative net P&L', data: chrono.map(t => round2(cum += t.pnl)), color: s.totalPnl >= 0 ? CHART.profit : CHART.loss, fill: true }],
    { empty: !chrono.length });

  // Monthly bars + cumulative line for the current calendar year
  const year = new Date().getFullYear();
  setText('equity-year', String(year));
  const monthly = getMonthlyPnl(year).map(v => v != null ? round2(v) : 0);
  barChart('yearlyChart', MONTHLY_LABELS, monthly, { polarity: true, label: 'Net P&L' });
  let c = 0;
  lineChart('monthlyRetChart', MONTHLY_LABELS, [{ label: 'Cumulative', data: monthly.map(v => round2(c += v)), color: CHART.series[0], points: true }]);
}

function renderBalanceCurve() {
  if (!document.getElementById('balanceChart')) return;
  const ledger = FUNDS.filter(f => f.account === 'trading');
  const closed = TRADES.filter(t => t.status !== 'Open');
  const untracked = untrackedTradingFunds();
  const t = fundTotals('trading');
  const putIn = Math.max(0, untracked) + t.deposited + sum(ledger.filter(f => f.kind === 'transfer_in'), f => f.amount) + Math.max(0, t.adjustments);
  const takenOut = t.toBank + t.removed + -sum(ledger.filter(f => f.kind === 'transfer_out'), f => f.amount);
  const netPnl = sum(closed, x => x.pnl);

  setHtml('ov-capital', bv(fmtMoney(putIn)));
  setHtml('ov-withdrawn', bv(fmtMoney(takenOut)));
  setHtml('ov-roc', putIn > 0 ? `${netPnl >= 0 ? '+' : ''}${(netPnl / putIn * 100).toFixed(1)}%` : '—');
  setValClass('ov-roc', netPnl >= 0);

  // Every balance change by date: ledger movements + closed trades' net P&L
  const events = [
    ...ledger.map(f => ({ date: f.date, delta: f.amount, kind: f.amount >= 0 ? 'in' : 'out' })),
    ...closed.map(x => ({ date: x.date, delta: x.pnl, kind: 'trade' })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const dates = [...new Set(events.map(e => e.date))];
  let bal = untracked;
  const balance = [], ins = [], outs = [];
  for (const d of dates) {
    const dayEvents = events.filter(e => e.date === d);
    bal += sum(dayEvents, e => e.delta);
    balance.push(round2(bal));
    ins.push(dayEvents.some(e => e.kind === 'in') ? round2(bal) : null);
    outs.push(dayEvents.some(e => e.kind === 'out') ? round2(bal) : null);
  }
  lineChart('balanceChart', dates, [
    { label: 'Balance', data: balance, color: CHART.series[0], fill: true, stepped: 'after' },
    { label: 'Money in', data: ins, color: CHART.in, showLine: false, points: true, pointStyle: 'triangle', tableHidden: false },
    { label: 'Money out', data: outs, color: CHART.out, showLine: false, points: true, pointStyle: 'triangle', rotation: 180 },
  ], { empty: !dates.length, opts: { plugins: { legend: { labels: { pointStyle: undefined } } } } });
}
