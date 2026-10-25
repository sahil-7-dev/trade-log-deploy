// ═══════════════════════════════════════════════════════════════════════════
// Insights page: advanced metrics, performance broken down by any dimension
// (setup, tag, mistake, emotion, plan, weekday, hour, session, holding
// time...), the weekday × hour heatmap, the cost of each mistake, plan vs no
// plan, holding time vs result, and P&L by market session.
// ═══════════════════════════════════════════════════════════════════════════

registerPage('insights', {
  title: 'Insights', subtitle: 'What separates your winners from your losers', icon: '✦', section: 'Trading', order: 4,
  render: renderInsightsPage,
});

function renderInsightsPage(ctx) {
  const closed = ctx.stats.closed;
  lastAnalyticsClosed = closed;
  renderAdvancedMetrics(ctx.stats);
  renderGroupTable(closed);
  renderWeekHourHeat(closed);
  renderPlanCompare(closed);
  renderMistakeCost(closed);
  renderHoldScatter(closed);
  renderSessionChart(closed);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// When a closed trade closed: its exact close time if known, else its date
function closeMoment(t) {
  return t.closed_at ? new Date(t.closed_at) : new Date(t.date + 'T12:00:00');
}
function holdMs(t) {
  return t.opened_at && t.closed_at ? new Date(t.closed_at) - new Date(t.opened_at) : null;
}

// Market session by the UTC hour the trade closed
function sessionOf(t) {
  if (!t.closed_at) return '(no time)';
  const h = new Date(t.closed_at).getUTCHours();
  return h < 7 ? 'Asia (00–07 UTC)' : h < 13 ? 'London (07–13 UTC)' : h < 21 ? 'New York (13–21 UTC)' : 'Late (21–24 UTC)';
}

function holdBucket(t) {
  const ms = holdMs(t);
  if (ms == null) return '(no times)';
  const h = ms / 3600e3;
  return h < 1 ? '< 1 hour' : h < 4 ? '1–4 hours' : h < 24 ? '4–24 hours' : h < 168 ? '1–7 days' : '> 7 days';
}

// key → list of group names a closed trade belongs to (a trade with two
// tags counts once in each tag's row)
const GROUPERS = {
  setup:    { label: 'Setup',            fn: t => [t.setup || '(none)'] },
  tag:      { label: 'Tag',              fn: t => (t.tags && t.tags.length ? t.tags : ['(none)']) },
  symbol:   { label: 'Symbol',           fn: t => [t.symbol] },
  mistake:  { label: 'Mistake',          fn: t => (t.mistakes && t.mistakes.length ? t.mistakes : ['(no mistakes)']) },
  emotion:  { label: 'Emotion',          fn: t => [t.emotion || '(not set)'] },
  followed: { label: 'Followed plan',    fn: t => [t.followed_plan == null ? '(not set)' : t.followed_plan ? 'Followed plan' : 'Broke plan'] },
  dir:      { label: 'Direction',        fn: t => [t.dir] },
  type:     { label: 'Asset type',       fn: t => [t.type] },
  weekday:  { label: 'Weekday',          fn: t => [WEEKDAYS[closeMoment(t).getDay()]], order: WEEKDAYS },
  hour:     { label: 'Hour closed',      fn: t => [t.closed_at ? `${String(new Date(t.closed_at).getHours()).padStart(2, '0')}:00` : '(no time)'], sortByName: true },
  session:  { label: 'Session',          fn: t => [sessionOf(t)] },
  hold:     { label: 'Holding time',     fn: t => [holdBucket(t)], order: ['< 1 hour', '1–4 hours', '4–24 hours', '1–7 days', '> 7 days', '(no times)'] },
  source:   { label: 'Source',           fn: t => [t.source === 'bybit' ? 'Bybit sync' : t.source === 'import' ? 'Imported' : 'Manual'] },
};

function groupPerformance(closed, key) {
  const g = GROUPERS[key];
  const map = new Map();
  for (const t of closed) for (const name of g.fn(t)) {
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(t);
  }
  const rows = [...map.entries()].map(([name, ts]) => {
    const wins = ts.filter(t => t.status === 'Win').length;
    const losses = ts.filter(t => t.status === 'Loss').length;
    const rrs = ts.filter(t => t.rr != null).map(t => t.rr);
    const net = sum(ts, t => t.pnl);
    return {
      name, n: ts.length, wins, losses,
      winRate: wins + losses ? wins / (wins + losses) * 100 : null,
      net, avg: net / ts.length,
      avgR: rrs.length ? sum(rrs) / rrs.length : null,
      fees: sum(ts, t => t.fees),
    };
  });
  if (g.order) rows.sort((a, b) => g.order.indexOf(a.name) - g.order.indexOf(b.name));
  else if (g.sortByName) rows.sort((a, b) => a.name.localeCompare(b.name));
  else rows.sort((a, b) => b.net - a.net);
  return rows;
}

let groupByKey = 'setup';
CHANGE_HANDLERS['group-by'] = el => { groupByKey = el.value; renderGroupTable(lastAnalyticsClosed); };
let lastAnalyticsClosed = [];

function renderGroupTable(closed) {
  const body = document.getElementById('group-table-body');
  if (!body) return;
  const rows = groupPerformance(closed, groupByKey);
  setText('group-col-name', GROUPERS[groupByKey].label);
  if (!rows.length) { body.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--muted)">No closed trades in this period</td></tr>`; return; }
  const maxAbs = Math.max(...rows.map(r => Math.abs(r.net)), 1);
  body.innerHTML = rows.map(r => `<tr style="cursor:default">
    <td style="font-weight:600">${esc(r.name)}</td>
    <td class="mono">${r.n}</td>
    <td class="mono">${r.winRate != null ? r.winRate.toFixed(0) + '%' : '—'}</td>
    <td class="mono ${r.net >= 0 ? 'green' : 'red'}"><span class="balance-val">${fmt(r.net)}</span></td>
    <td><div class="bar-track"><div class="bar-fill ${r.net >= 0 ? 'pos' : 'neg'}" style="width:${Math.abs(r.net) / maxAbs * 100}%"></div></div></td>
    <td class="mono ${r.avg >= 0 ? 'green' : 'red'}"><span class="balance-val">${fmt(r.avg)}</span></td>
    <td class="mono">${r.avgR != null ? r.avgR.toFixed(2) + 'R' : '—'}</td>
    <td class="mono" style="color:var(--muted)">${r.fees ? '$' + r.fees.toFixed(2) : '—'}</td>
  </tr>`).join('');
}


// ─── ADVANCED METRICS ────────────────────────────────────────────────────────
function advancedMetrics(stats) {
  const closed = [...stats.closed].sort((a, b) => closeMoment(a) - closeMoment(b));
  const allTimePnl = sum(TRADES.filter(t => t.status !== 'Open'), t => t.pnl);
  const base = tradingBalance - allTimePnl; // money in before any closed trade

  // Daily net P&L → daily returns on the equity at the start of each day
  const byDay = new Map();
  closed.forEach(t => byDay.set(t.date, (byDay.get(t.date) || 0) + t.pnl));
  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const start = equityPath(closed).start; // equity before this period
  // Max drawdown in $ is the same per-trade figure as the Risk page and the % tile
  const maxDdAmt = stats.maxDdAmt;
  // Sharpe/Sortino need a return for EVERY calendar day (0 on days without
  // closed trades) — using only trading days and then annualizing by √365
  // inflates the ratio several times over for anyone who doesn't trade daily.
  const returns = [];
  if (days.length) {
    let eq = start;
    const pnlByDay = new Map(days);
    for (let d = new Date(days[0][0] + 'T12:00:00'), end = new Date(days[days.length - 1][0] + 'T12:00:00'); d <= end; d.setDate(d.getDate() + 1)) {
      const pnl = pnlByDay.get(localDateOf(d)) || 0;
      if (eq > 0) returns.push(pnl / eq);
      eq += pnl;
    }
  }
  const mean = returns.length ? sum(returns) / returns.length : 0;
  const sd = returns.length > 1 ? Math.sqrt(sum(returns, r => (r - mean) ** 2) / (returns.length - 1)) : 0;
  const downside = returns.filter(r => r < 0);
  // Downside deviation over ALL days (non-losing days count as 0), the standard Sortino definition
  const dsd = downside.length ? Math.sqrt(sum(downside, r => r ** 2) / returns.length) : 0;
  const enoughDays = days.length >= 5 && base > 0;

  const winHolds = closed.filter(t => t.status === 'Win').map(holdMs).filter(v => v != null);
  const lossHolds = closed.filter(t => t.status === 'Loss').map(holdMs).filter(v => v != null);
  const avgOf = arr => arr.length ? sum(arr) / arr.length : null;

  const decided = stats.wins.length + stats.losses.length;
  const W = decided ? stats.wins.length / decided : 0;
  const payoff = stats.avgLoss ? stats.avgWin / Math.abs(stats.avgLoss) : null;
  const side = dir => {
    const ts = closed.filter(t => t.dir === dir);
    const w = ts.filter(t => t.status === 'Win').length, l = ts.filter(t => t.status === 'Loss').length;
    return { n: ts.length, wr: w + l ? w / (w + l) * 100 : null, pnl: sum(ts, t => t.pnl) };
  };
  return {
    sharpe: enoughDays && sd > 0 ? mean / sd * Math.sqrt(365) : null,
    sortino: enoughDays && dsd > 0 ? mean / dsd * Math.sqrt(365) : null,
    payoff,
    kelly: payoff ? (W - (1 - W) / payoff) * 100 : null,
    recovery: maxDdAmt > 0 ? stats.totalPnl / maxDdAmt : null,
    maxDdAmt,
    avgHoldWin: avgOf(winHolds), avgHoldLoss: avgOf(lossHolds),
    fees: sum(closed, t => t.fees),
    feeSplit: feeBreakdown([...stats.closed, ...stats.open]),
    long: side('Long'), short: side('Short'),
    tradingDays: days.length,
  };
}

function renderAdvancedMetrics(stats) {
  const el = document.getElementById('adv-metrics');
  if (!el) return;
  const m = advancedMetrics(stats);
  const num = (v, d = 2, suffix = '') => v == null || !isFinite(v) ? '—' : v.toFixed(d) + suffix;
  const cell = (label, value, sub, cls = '', tip = '') =>
    `<div class="metric" title="${esc(tip)}"><div class="stat-label">${label}</div><div class="metric-val ${cls}">${value}</div><div class="stat-sub">${sub}</div></div>`;
  const side = s => s.n ? `${s.n} · ${num(s.wr, 0, '%')} win · ${fmt(s.pnl)}` : '—';
  el.innerHTML = [
    cell('Sharpe ratio', num(m.sharpe), 'annualized, daily', m.sharpe > 1 ? 'green' : m.sharpe < 0 ? 'red' : '', 'Average daily return ÷ its volatility, ×√365, counting every calendar day. Above 1 is good, above 2 is excellent. Needs 5+ trading days.'),
    cell('Sortino ratio', num(m.sortino), 'downside only', m.sortino > 1 ? 'green' : m.sortino < 0 ? 'red' : '', 'Like Sharpe, but only losing days count as risk.'),
    cell('Profit factor', stats.profitFactor != null ? stats.profitFactor.toFixed(2) : '—', 'gross win ÷ gross loss', stats.profitFactor >= 1.5 ? 'green' : stats.profitFactor < 1 ? 'red' : ''),
    cell('Payoff ratio', num(m.payoff), 'avg win ÷ avg loss', '', 'How big your average winner is compared with your average loser.'),
    cell('Expectancy (R)', stats.avgRR != null ? stats.avgRR.toFixed(2) + 'R' : '—', 'avg R per trade', stats.avgRR > 0 ? 'green' : stats.avgRR < 0 ? 'red' : '', 'Average R:R achieved — how many "risks" each trade makes or loses on average.'),
    cell('Recovery factor', num(m.recovery), 'net P&L ÷ max drawdown', m.recovery > 2 ? 'green' : '', 'How many times over your profit covers your worst drawdown.'),
    cell('Max drawdown', m.maxDdAmt ? bv('-' + fmtMoney(m.maxDdAmt).replace('-', '')) : '—', stats.maxDrawdown ? stats.maxDrawdown.toFixed(1) + '% of equity' : '—', 'red'),
    cell('Kelly %', num(m.kelly, 1, '%'), 'theoretical max risk', '', 'Kelly criterion from your win rate and payoff. Most traders risk a quarter of this or less.'),
    cell('Avg hold — winners', m.avgHoldWin ? fmtDuration(m.avgHoldWin) : '—', 'open → close', 'green'),
    cell('Avg hold — losers', m.avgHoldLoss ? fmtDuration(m.avgHoldLoss) : '—', 'open → close', 'red', 'Holding losers longer than winners is a classic leak.'),
    cell('Longs', side(m.long), '', ''),
    cell('Shorts', side(m.short), '', ''),
    cell('Fees paid', m.feeSplit.total ? bv(fmtMoney(m.feeSplit.total)) : '—', m.feeSplit.total ? bv(feeSplitText(m.feeSplit)) : 'none recorded', 'amber',
      'Every fee in this period, open trades included. "Other" = fees not split by side (Bybit reports one combined fee).'),
    cell('Fees vs gross P&L', num(m.feeSplit.pctOfGross, 1, '%'), 'of profit before fees', m.feeSplit.pctOfGross > 25 ? 'red' : '',
      'How much of your gross profit (closed trades, before fees) went to fees.'),
  ].join('');
}


// ─── WEEKDAY × HOUR HEATMAP (local time of close) ───────────────────────────
function renderWeekHourHeat(closed) {
  const el = document.getElementById('wh-heat');
  if (!el) return;
  const timed = closed.filter(t => t.closed_at);
  const cells = new Map();
  timed.forEach(t => {
    const d = new Date(t.closed_at), k = `${(d.getDay() + 6) % 7}-${d.getHours()}`;
    const c = cells.get(k) || { pnl: 0, n: 0 };
    c.pnl += t.pnl; c.n++;
    cells.set(k, c);
  });
  const maxAbs = Math.max(...[...cells.values()].map(c => Math.abs(c.pnl)), 1);
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  let html = '<div></div>' + [...Array(24).keys()].map(h => `<div class="wh-hour">${h % 3 === 0 ? String(h).padStart(2, '0') : ''}</div>`).join('');
  days.forEach((name, di) => {
    html += `<div class="wh-label">${name}</div>`;
    for (let h = 0; h < 24; h++) {
      const c = cells.get(`${di}-${h}`);
      html += c
        ? `<div class="wh-cell" style="background:${divergingColor(c.pnl, maxAbs)}" data-tip="${name} ${String(h).padStart(2, '0')}:00–${String(h + 1).padStart(2, '0')}:00
${fmt(c.pnl)} · ${c.n} trade${c.n !== 1 ? 's' : ''}" tabindex="0"></div>`
        : '<div class="wh-cell"></div>';
    }
  });
  el.innerHTML = timed.length ? `<div style="overflow-x:auto"><div class="wh-grid">${html}</div></div>`
    : emptyState('◷', 'No close times yet', 'Trades with a close time (Bybit sync fills it in; set it when logging) show up here by weekday and hour.');
  setText('wh-meta', timed.length < closed.length ? `${timed.length} of ${closed.length} trades have a close time` : 'Your local time');
}

// ─── FOLLOWED PLAN vs BROKE PLAN ─────────────────────────────────────────────
function renderPlanCompare(closed) {
  const el = document.getElementById('plan-compare');
  if (!el) return;
  const side = (label, ts, cls) => {
    const w = ts.filter(t => t.status === 'Win').length, l = ts.filter(t => t.status === 'Loss').length;
    const net = sum(ts, t => t.pnl);
    return `<div class="stat-card" style="box-shadow:none">
      <div class="stat-label">${label}</div>
      <div class="stat-val ${net >= 0 ? 'green' : 'red'}">${ts.length ? bv(fmt(net)) : '—'}</div>
      <div class="stat-sub">${ts.length} trades · ${w + l ? (w / (w + l) * 100).toFixed(0) + '% win' : '—'} · avg ${ts.length ? bv(fmt(net / ts.length)) : '—'}</div>
    </div>`;
  };
  const yes = closed.filter(t => t.followed_plan === true), no = closed.filter(t => t.followed_plan === false);
  el.innerHTML = yes.length + no.length
    ? `<div class="grid-2">${side('✓ Followed plan', yes)}${side('✗ Broke plan', no)}</div>` + (yes.length && no.length
      ? `<div class="goal-sub" style="margin-top:10px">Breaking your plan cost on average <strong>${bv(fmt(sum(no, t => t.pnl) / no.length - sum(yes, t => t.pnl) / yes.length))}</strong> per trade vs following it.</div>` : '')
    : emptyState('✓', 'Not tracked yet', 'Mark "Followed my plan?" when logging or editing trades to compare.');
}

// ─── COST OF EACH MISTAKE ────────────────────────────────────────────────────
function renderMistakeCost(closed) {
  const rows = groupPerformance(closed, 'mistake').filter(r => r.name !== '(no mistakes)').sort((a, b) => a.net - b.net).slice(0, 8);
  barChart('mistakeChart', rows.map(r => r.name), rows.map(r => round2(r.net)), {
    polarity: true, horizontal: true, label: 'Net P&L', empty: !rows.length,
  });
}

// ─── HOLDING TIME vs RESULT ──────────────────────────────────────────────────
function renderHoldScatter(closed) {
  const pts = closed.filter(t => holdMs(t) != null).map(t => ({ x: round2(holdMs(t) / 3600e3), y: t.pnl, meta: t.symbol, status: t.status }));
  scatterChart('holdScatterChart', [
    { label: 'Winners', data: pts.filter(p => p.status === 'Win'), color: CHART.profit },
    { label: 'Losers', data: pts.filter(p => p.status === 'Loss'), color: CHART.loss },
    { label: 'Breakeven', data: pts.filter(p => p.status === 'Breakeven'), color: CHART.muted },
  ], { xFormat: v => fmtDuration(v * 3600e3), xTitle: 'Holding time', empty: !pts.length,
       opts: { scales: { x: { type: 'logarithmic', ticks: { callback: v => [0.1, 1, 4, 24, 168, 720].includes(+v) ? fmtDuration(v * 3600e3) : '' } } } } });
}

// ─── P&L BY MARKET SESSION ───────────────────────────────────────────────────
function renderSessionChart(closed) {
  const rows = groupPerformance(closed, 'session').filter(r => r.name !== '(no time)');
  const order = ['Asia (00–07 UTC)', 'London (07–13 UTC)', 'New York (13–21 UTC)', 'Late (21–24 UTC)'];
  rows.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  barChart('sessionChart', rows.map(r => r.name.split(' (')[0]), rows.map(r => round2(r.net)), { polarity: true, label: 'Net P&L', empty: !rows.length });
}
