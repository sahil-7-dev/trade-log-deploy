// ═══════════════════════════════════════════════════════════════════════════
// Overview page: hero net P&L, KPI tiles with running sparklines and deltas
// vs the previous period, equity curve, goals, outcomes, daily P&L, open
// positions, monthly heatmap and this month's trades.
// ═══════════════════════════════════════════════════════════════════════════

registerPage('dashboard', {
  title: 'Overview', subtitle: 'Your trading at a glance', icon: '◉', section: 'Trading', order: 1,
  render: renderDashboard,
});

function renderDashboard(ctx) {
  const s = ctx.stats;
  const prevTrades = previousRangeTrades();
  const p = prevTrades ? computeStats(prevTrades) : null;
  const chrono = chronological(s.closed);
  const period = rangeLabel();
  setText('dash-period', `${period} · ${s.closed.length} closed trade${s.closed.length !== 1 ? 's' : ''}${s.open.length ? ` · ${s.open.length} open` : ''}`);

  // ── Hero
  let cum = 0;
  const curve = chrono.map(t => (cum += t.pnl));
  setHtml('dash-hero', `
    <div>
      <div class="hero-label">Net P&amp;L · ${esc(period)}</div>
      <div class="hero-value ${s.totalPnl >= 0 ? 'green' : 'red'}"><span class="balance-val">${s.closed.length ? fmt(s.totalPnl) : fmtMoney(0)}</span></div>
      <div class="hero-meta">
        ${p ? deltaBadge(s.totalPnl, p.totalPnl) + '<span>vs previous period</span>' : ''}
        <span>Trading balance <strong class="num balance-val" style="color:var(--text)">${fmtMoney(tradingBalance)}</strong></span>
        ${s.partlyClosed.length ? `<span>+ ${bv(fmt(s.partialRealized))} realized on open trades</span>` : ''}
      </div>
    </div>
    <div class="hero-chart">${curve.length > 1 ? sparkline([0, ...curve], { height: 96, zero: true, polarity: true }) : '<div class="muted" style="font-size:12px;text-align:center;padding-top:36px">Close a few trades to see your curve</div>'}</div>`);

  // ── KPI tiles (running value as the sparkline, delta vs previous period)
  const wr = ts => { const w = ts.filter(t => t.status === 'Win').length, l = ts.filter(t => t.status === 'Loss').length; return w + l ? w / (w + l) * 100 : null; };
  // same definition as computeStats (by status, so a breakeven trade's fee-only loss isn't a "loss")
  const pf = ts => { const gw = sum(ts.filter(t => t.status === 'Win'), t => t.pnl), gl = -sum(ts.filter(t => t.status === 'Loss'), t => t.pnl); return gl ? gw / gl : null; };
  const ex = ts => ts.length ? sum(ts, t => t.pnl) / ts.length : null;
  const avgR = ts => { const r = ts.filter(t => t.rr != null); return r.length ? sum(r, t => t.rr) / r.length : null; };
  const wrNow = s.winRate != null ? parseFloat(s.winRate) : null;
  setHtml('dash-kpis', [
    statTile({
      label: 'Win rate', value: wrNow != null ? s.winRate + '%' : '—', cls: wrNow == null ? '' : wrNow >= 50 ? 'green' : 'amber',
      sub: s.closed.length ? `${s.wins.length}W / ${s.losses.length}L${s.breakeven.length ? ` / ${s.breakeven.length} BE` : ''}` : 'No closed trades',
      delta: p && p.winRate != null && wrNow != null ? deltaBadge(wrNow, parseFloat(p.winRate), { pct: true }) : '',
      spark: runningSeries(s.closed, wr), sparkColor: CHART.series[0],
      tip: 'Wins ÷ (wins + losses). Breakeven trades are left out.',
    }),
    statTile({
      label: 'Profit factor', value: s.profitFactor != null ? s.profitFactor.toFixed(2) : '—',
      cls: s.profitFactor >= 1.5 ? 'green' : s.profitFactor != null && s.profitFactor < 1 ? 'red' : '',
      sub: 'gross win ÷ gross loss', spark: runningSeries(s.closed, pf), sparkColor: CHART.series[0],
      delta: p && p.profitFactor != null && s.profitFactor != null ? deltaBadge(s.profitFactor, p.profitFactor, { format: v => v.toFixed(2) }) : '',
      tip: 'Above 1 = profitable; above 1.5 is solid.',
    }),
    statTile({
      label: 'Expectancy', value: s.closed.length ? bv(fmt(s.expectancy)) : '—', cls: s.expectancy >= 0 ? 'green' : 'red',
      sub: 'avg net P&L per trade', spark: runningSeries(s.closed, ex), sparkZero: true,
      delta: p && p.closed.length ? deltaBadge(s.expectancy, p.expectancy) : '',
    }),
    statTile({
      label: 'Avg R achieved', value: s.avgRR != null ? s.avgRR.toFixed(2) + 'R' : '—', cls: s.avgRR > 0 ? 'blue' : s.avgRR < 0 ? 'red' : '',
      sub: s.avgRR != null ? 'per trade with a stop' : 'add stop losses to see R', spark: runningSeries(s.closed, avgR), sparkColor: CHART.series[0],
      tip: 'Net P&L ÷ the money at risk to your stop loss.',
    }),
    statTile({
      label: 'Max drawdown', value: s.maxDrawdown ? s.maxDrawdown.toFixed(1) + '%' : '—', cls: 'red',
      sub: 'peak → trough of equity', tip: 'Biggest fall from a high point of your trading account, in this period.',
    }),
    statTile({
      label: 'Best / worst', value: s.bestTrade ? `<span class="${s.bestTrade.pnl > 0 ? 'green' : s.bestTrade.pnl < 0 ? 'red' : ''}">${bv(fmt(s.bestTrade.pnl))}</span>` : '—',
      sub: s.worstTrade ? `worst ${bv(fmt(s.worstTrade.pnl))} · ${esc(s.worstTrade.symbol)}` : '—',
      tip: s.bestTrade ? `Best: ${s.bestTrade.symbol} on ${s.bestTrade.date}` : '',
    }),
  ].join(''));

  // ── Equity curve
  setHtml('eq-meta', s.closed.length ? bv(fmt(s.totalPnl)) + ' total' : '');
  lineChart('equityChart', chrono.map(t => t.date), [{ label: 'Cumulative net P&L', data: curve.map(round2), color: s.totalPnl >= 0 ? CHART.profit : CHART.loss, fill: true }],
    { empty: !chrono.length });

  // ── Net worth (both accounts) — full breakdown on the Net Worth page
  const nw = computeNetWorth();
  const cls = v => v > 0 ? 'green' : v < 0 ? 'red' : '';
  setHtml('dash-networth', `
    <div class="stat-val" style="font-size:24px;margin:0 0 10px">${bv(fmtMoney(nw.total))}</div>
    ${compositionBar([
      { label: 'Trading', value: Math.max(0, nw.tradingAccount), color: NW_COLORS.trading },
      { label: 'Cash', value: Math.max(0, nw.investingCash), color: NW_COLORS.investCash },
      { label: 'Holdings', value: Math.max(0, nw.holdingsValue), color: NW_COLORS.holdings },
    ], { format: v => fmtMoney(v) })}
    <div class="grid-3" style="gap:8px;margin-top:12px">
      <div><div class="stat-label">Realized</div><div class="num ${cls(nw.realizedTotal)}" style="font-weight:700">${bv(fmt(nw.realizedTotal))}</div></div>
      <div><div class="stat-label">Unrealized</div><div class="num ${cls(nw.unrealizedTotal)}" style="font-weight:700">${bv(fmt(nw.unrealizedTotal))}</div></div>
      <div><div class="stat-label">Return</div><div class="num ${cls(nw.returnPct || 0)}" style="font-weight:700">${nw.returnPct != null ? (nw.returnPct >= 0 ? '+' : '') + nw.returnPct.toFixed(1) + '%' : '—'}</div></div>
    </div>`);

  // ── Goals & limits, outcomes
  renderGoals();
  setText('wl-meta', `${s.closed.length + s.open.length} trades`);
  setHtml('dash-outcomes', s.closed.length + s.open.length ? compositionBar([
    { label: 'Wins', value: s.wins.length, color: CHART.profit },
    { label: 'Losses', value: s.losses.length, color: CHART.loss },
    { label: 'Breakeven', value: s.breakeven.length, color: CHART.series[0] },
    { label: 'Open', value: s.open.length, color: CHART.series[3] },
  ]) : emptyState('◎', 'No trades yet', 'Log a trade or sync Bybit to get started.', '<button class="btn btn-primary btn-sm" data-action="open-add-trade">+ Log trade</button>'));

  // ── Daily P&L (last 30 trading days in range)
  const byDay = new Map();
  chrono.forEach(t => byDay.set(t.date, (byDay.get(t.date) || 0) + t.pnl));
  const days = [...byDay.keys()].sort().slice(-30);
  barChart('dailyPnlChart', days.map(d => d.slice(5)), days.map(d => round2(byDay.get(d))), { polarity: true, label: 'Net P&L', empty: !days.length });

  // ── Open positions with live P&L
  renderDashOpen();

  renderHeatmap();
  renderRecentTrades();
}

function renderDashOpen() {
  const open = TRADES.filter(t => t.status === 'Open');
  const priced = open.map(unrealizedPnl).filter(v => v != null);
  setHtml('dash-open-meta', open.length ? `${open.length} open${priced.length ? ' · ' + bv(fmt(sum(priced))) + ' live' : ''}` : '');
  setHtml('dash-open-body', open.length ? open.map(t => {
    const u = unrealizedPnl(t), live = livePriceForTrade(t);
    return `<tr>
      <td style="font-weight:600"><span class="trade-link" data-action="open-trade-detail" data-id="${esc(t.id)}">${esc(t.symbol)}</span></td>
      <td><span class="badge ${t.dir === 'Long' ? 'badge-long' : 'badge-short'}">${esc(t.dir)}</span></td>
      <td class="num"><span class="balance-val">${fmtMoney(t.size)}</span></td>
      <td class="num">${fmtPx(t.entry)}</td>
      <td class="num">${live ? live.toLocaleString(undefined, { maximumSignificantDigits: 6 }) : '<span class="muted">—</span>'}</td>
      <td class="num ${u > 0 ? 'green' : u < 0 ? 'red' : ''}">${u != null ? `<span class="balance-val">${fmt(u)}</span>` : '<span class="muted" data-tip="Live prices are for crypto only">—</span>'}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="6">${emptyState('◌', 'No open positions', 'Open trades show here with live P&L.')}</td></tr>`);
}

function renderRecentTrades() {
  const body = document.getElementById('recent-trades-body');
  if (!body) return;
  const now = new Date();
  setText('recent-trades-title', `${now.toLocaleString('default', { month: 'long' })} Trades`);
  let recent = TRADES.filter(t => {
    const [y, m] = t.date.split('-');
    return parseInt(m, 10) - 1 === now.getMonth() && parseInt(y, 10) === now.getFullYear();
  });
  if (recentFilter !== 'All') recent = recent.filter(t => t.type === recentFilter);
  body.innerHTML = recent.length === 0
    ? emptyRow(10, TRADES.length === 0 ? 'No trades yet — click "+ Log Trade" to add your first' : 'No trades this month')
    : recent.map(t => tradeRow(t)).join('');
}
