// ═══════════════════════════════════════════════════════════════════════════
// Net Worth page: trading + investing combined — total, where it sits,
// realized vs unrealized gains per account, the bridge from money put in to
// net worth, and net worth over time. Numbers come from computeNetWorth()
// (features/networth.js), shared with the Overview card and the sidebar.
// ═══════════════════════════════════════════════════════════════════════════

registerPage('networth', {
  title: 'Net Worth', subtitle: 'Trading + investing, realized and unrealized', icon: '◎', section: 'Money', order: 19,
  render: renderNetWorthPage,
});

const NW_COLORS = { trading: CHART.series[0], investCash: CHART.series[2], holdings: CHART.series[6] };

function renderNetWorthPage(ctx) {
  const nw = computeNetWorth();
  const today = netWorthToday();
  const money = v => bv(fmtMoney(v));
  const signed = v => bv(fmt(v));
  const cls = v => v > 0 ? 'green' : v < 0 ? 'red' : '';

  // ── Hero
  setHtml('nw-hero', `
    <div>
      <div class="hero-label">Total net worth</div>
      <div class="hero-value">${money(nw.total)}</div>
      <div class="hero-meta">
        <span class="delta ${today.total > 0 ? 'up' : today.total < 0 ? 'down' : 'flat'}" data-tip="Realized today ${fmt(today.realizedToday)} + crypto holdings' 24h price move ${fmt(today.priceMove)}. Open trades' intraday move isn't included.">${today.total >= 0 ? '▲' : '▼'} ${fmt(today.total)} today</span>
        <span>Trading <strong class="num" style="color:var(--text)">${money(nw.tradingAccount)}</strong></span>
        <span>Investing <strong class="num" style="color:var(--text)">${money(nw.investingAccount)}</strong></span>
      </div>
    </div>
    <div class="hero-chart" id="nw-hero-spark"></div>`);

  // ── Tiles
  const periodGains = gainsInRange();
  setHtml('nw-kpis', [
    statTile({ label: 'Realized gains', value: signed(nw.realizedTotal), cls: cls(nw.realizedTotal),
      sub: `trading ${fmt(nw.realized.trading)} · investing ${fmt(nw.realized.investing)}`, tip: 'Locked in: closed trades (net of fees), partial closes, and investments you sold.' }),
    statTile({ label: 'Unrealized gains', value: signed(nw.unrealizedTotal), cls: cls(nw.unrealizedTotal),
      sub: `trading ${fmt(nw.unrealized.trading)} · investing ${fmt(nw.unrealized.investing)}`, tip: 'On paper: open trades at live prices, and holdings at their current price vs what you paid.' }),
    statTile({ label: 'Total gains', value: signed(nw.gains), cls: cls(nw.gains), sub: 'realized + unrealized' }),
    statTile({ label: 'Money put in', value: money(nw.moneyIn), sub: `deposited ${fmtMoney(nw.deposited)} · withdrawn ${fmtMoney(nw.withdrawn)}`,
      tip: 'Your own money still in the accounts: deposits − withdrawals ± adjustments, plus any starting balance from before the funds history. Transfers between your two accounts cancel out.' }),
    statTile({ label: 'Return', value: nw.returnPct != null ? `${nw.returnPct >= 0 ? '+' : ''}${nw.returnPct.toFixed(1)}%` : '—', cls: cls(nw.returnPct || 0),
      sub: 'total gains ÷ money put in' }),
    statTile({ label: 'Gains in period', value: signed(periodGains), cls: cls(periodGains), sub: `realized · ${esc(rangeLabel())}`,
      tip: 'Realized gains dated inside the top-bar date range (closed trades, partial closes, sales). Unrealized gains are always "now".' }),
  ].join(''));

  // ── Where the money is (3 parts; open-trade P&L lives inside Trading)
  const parts = [
    { label: 'Trading account', value: Math.max(0, nw.tradingAccount), color: NW_COLORS.trading },
    { label: 'Investing cash', value: Math.max(0, nw.investingCash), color: NW_COLORS.investCash },
    { label: 'Holdings', value: Math.max(0, nw.holdingsValue), color: NW_COLORS.holdings },
  ];
  setText('nw-where-meta', fmtMoney(nw.total));
  setHtml('nw-where', nw.total > 0 ? compositionBar(parts, { format: v => fmtMoney(v) })
    : emptyState('◎', 'Nothing here yet', 'Deposit money or log a trade to start tracking your net worth.'));

  // ── Line-by-line: how the total is made
  const line = (label, v, opts = {}) => `<tr>
    <td style="${opts.indent ? 'padding-left:26px;color:var(--muted)' : 'font-weight:600'}">${label}${opts.tip ? ` <span class="muted" data-tip="${esc(opts.tip)}" tabindex="0">ⓘ</span>` : ''}</td>
    <td class="num ${opts.signed ? cls(v) : ''}" style="text-align:right${opts.bold ? ';font-weight:700' : ''}">${opts.signed ? signed(v) : money(v)}</td></tr>`;
  setHtml('nw-breakdown', [
    line('Trading account', nw.tradingAccount, { bold: true }),
    line('Trading balance', nw.tradingBalance, { indent: true }),
    nw.partialRealized ? line('Realized on partial closes', nw.partialRealized, { indent: true, signed: true, tip: 'Already taken on the exchange; the trading balance updates when the trade fully closes.' }) : '',
    nw.openCount ? line(`Open trades, live P&L${nw.openUnpriced ? ` (${nw.openUnpriced} without a live price)` : ''}`, nw.openUnrealized, { indent: true, signed: true,
      tip: nw.openUnpriced ? 'Live prices exist for crypto only — open trades in other markets add nothing here until they close.' : '' }) : '',
    line('Investing account', nw.investingAccount, { bold: true }),
    line('Cash', nw.investingCash, { indent: true }),
    line('Holdings at market value', nw.holdingsValue, { indent: true }),
    `<tr style="border-top:2px solid var(--border-strong)"><td style="font-weight:700">Net worth</td><td class="num" style="text-align:right;font-weight:700;font-size:14px">${money(nw.total)}</td></tr>`,
  ].join(''));

  // ── Gains table
  const row = (label, r, u, bold) => `<tr${bold ? ' style="border-top:2px solid var(--border-strong)"' : ''}>
    <td style="font-weight:${bold ? 700 : 600}">${label}</td>
    <td class="num ${cls(r)}">${signed(r)}</td><td class="num ${cls(u)}">${signed(u)}</td>
    <td class="num ${cls(r + u)}" style="font-weight:700">${signed(r + u)}</td></tr>`;
  setHtml('nw-gains-table', [
    row('Trading', nw.realized.trading, nw.unrealized.trading),
    row('Investing', nw.realized.investing, nw.unrealized.investing),
    row('Total', nw.realizedTotal, nw.unrealizedTotal, true),
  ].join(''));
  setHtml('nw-gains-note', `Net worth ${money(nw.total)} = money put in ${money(nw.moneyIn)} + gains ${signed(nw.gains)}.`
    + (nw.untracked && Math.abs(nw.untracked) >= 0.01 ? ` Money put in includes ${money(nw.untracked)} from before your funds history (e.g. a starting balance).` : ''));

  // ── Bridge: money put in → each gain → net worth
  bridgeChart('nwBridgeChart', [
    { label: 'Money put in', value: nw.moneyIn, kind: 'total' },
    { label: 'Realized · trading', value: nw.realized.trading },
    { label: 'Realized · investing', value: nw.realized.investing },
    { label: 'Unrealized · trading', value: nw.unrealized.trading },
    { label: 'Unrealized · investing', value: nw.unrealized.investing },
    { label: 'Net worth', value: nw.total, kind: 'total' },
  ], { empty: !nw.total && !nw.gains });

  renderNetWorthHistory(nw);
}

// Realized gains dated inside the top-bar date range
function gainsInRange() {
  const b = rangeBounds();
  const inRange = d => !b || (d >= b[0] && d <= b[1]);
  const trades = sum(TRADES.filter(t => t.status !== 'Open' && inRange(t.date)), t => t.pnl);
  const partials = sum(TRADES.filter(t => t.status === 'Open').flatMap(t => t.closes).filter(f => f.date && inRange(f.date)),
    f => (parseFloat(f.pnl) || 0) - (parseFloat(f.fee) || 0));
  const sales = sum(realizedHistory.filter(r => inRange(r.date)), r => r.realizedPnl);
  return trades + partials + sales;
}

// Net worth on each day a portfolio snapshot exists (+ today, live).
// Investing side = the snapshot; trading side = today's balance with every
// later movement and closed trade taken back out (exact). Open trades' past
// P&L isn't known, so history points leave it out.
function renderNetWorthHistory(nw) {
  const today = localToday();
  const tradingLedger = FUNDS.filter(f => f.account === 'trading');
  const external = FUNDS.filter(f => f.kind !== 'transfer_in' && f.kind !== 'transfer_out');
  const closed = TRADES.filter(t => t.status !== 'Open');
  const tradingAt = d => tradingBalance
    - sum(tradingLedger.filter(f => f.date > d), f => f.amount)
    - sum(closed.filter(t => t.date > d), t => t.pnl);
  const moneyInAt = d => nw.moneyIn - sum(external.filter(f => f.date > d), f => f.amount);

  const snaps = [...SNAPSHOTS].filter(s => s.date < today).sort((a, b) => a.date.localeCompare(b.date));
  const labels = [...snaps.map(s => s.date), today];
  const worth = [...snaps.map(s => round2(tradingAt(s.date) + s.holdings_value + s.cash)), round2(nw.total)];
  const putIn = labels.map(d => round2(d === today ? nw.moneyIn : moneyInAt(d)));
  setText('nw-history-meta', snaps.length ? `${labels.length} days · from daily portfolio snapshots` : 'builds up one point per day you open the app');
  setHtml('nw-hero-spark', worth.length > 1 ? sparkline(worth, { height: 96, color: CHART.series[0] }) : '');
  lineChart('nwHistoryChart', labels, [
    { label: 'Net worth', data: worth, color: CHART.series[0], fill: true },
    { label: 'Money put in', data: putIn, color: CHART.other, dashed: true, stepped: 'after' },
  ], { empty: labels.length < 2, emptyText: 'Net worth history builds up one point per day you open the app' });
}
