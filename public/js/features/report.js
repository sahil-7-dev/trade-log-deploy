// ═══════════════════════════════════════════════════════════════════════════
// Monthly report: printable summary of any month (Save as PDF).
// ═══════════════════════════════════════════════════════════════════════════

// ─── MONTHLY REPORT (print / save as PDF) ────────────────────────────────────
function openReport() {
  document.getElementById('report-month').value = localToday().slice(0, 7);
  openModal('report-modal');
}

function buildReport(month) {
  const [y, m] = month.split('-').map(Number);
  const monthName = new Date(y, m - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' });
  const inMonth = d => d && d.startsWith(month);
  const trades = TRADES.filter(t => t.status !== 'Open' && inMonth(t.date)).sort((a, b) => a.date.localeCompare(b.date));
  const s = computeStats(trades);
  const funds = FUNDS.filter(f => inMonth(f.date));
  const sales = realizedHistory.filter(r => inMonth(r.date));
  const money = v => fmt(v);
  const stat = (label, value) => `<div class="rp-stat"><div class="rp-label">${label}</div><div class="rp-val">${value}</div></div>`;

  // Daily P&L + cumulative, with a small inline SVG bar chart
  const days = [...new Set(trades.map(t => t.date))];
  let cum = 0;
  const daily = days.map(d => {
    const pnl = sum(trades.filter(t => t.date === d), t => t.pnl);
    cum += pnl;
    return { d, n: trades.filter(t => t.date === d).length, pnl, cum };
  });
  const maxAbs = Math.max(...daily.map(x => Math.abs(x.pnl)), 1);
  const w = 680, h = 120, bw = daily.length ? Math.min(40, (w - 20) / daily.length - 4) : 0;
  const bars = daily.map((x, i) => {
    const bh = Math.abs(x.pnl) / maxAbs * (h / 2 - 8);
    const xPos = 10 + i * ((w - 20) / Math.max(daily.length, 1));
    return `<rect x="${xPos}" y="${x.pnl >= 0 ? h / 2 - bh : h / 2}" width="${bw}" height="${Math.max(bh, 1)}" fill="${x.pnl >= 0 ? '#0a9e80' : '#d43a57'}"/>`;
  }).join('');
  const svg = daily.length ? `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" aria-label="Daily P&L">
    <line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}" stroke="#bbb" stroke-width="1"/>${bars}</svg>` : '';

  const table = (head, rows) => rows.length
    ? `<table class="rp-table"><thead><tr>${head.map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`
    : '<p class="rp-muted">None this month.</p>';
  const bySetup = groupPerformance(trades, 'setup');
  const byMistake = groupPerformance(trades, 'mistake').filter(r => r.name !== '(no mistakes)');

  return `
    <div class="rp-head">
      <div><div class="rp-title">Trading Report — ${esc(monthName)}</div>
      <div class="rp-muted">${esc(profileName || (currentUser && currentUser.email) || 'TradeLog')} · generated ${new Date().toLocaleString()}</div></div>
      <div class="rp-brand">Trade<b>Log</b></div>
    </div>
    <div class="rp-stats">
      ${stat('Net P&L', money(s.totalPnl))}
      ${stat('Closed trades', s.closed.length)}
      ${stat('Win rate', s.winRate != null ? s.winRate + '%' : '—')}
      ${stat('Profit factor', s.profitFactor != null ? s.profitFactor.toFixed(2) : '—')}
      ${stat('Expectancy', s.closed.length ? money(s.expectancy) : '—')}
      ${stat('Avg R', s.avgRR != null ? s.avgRR.toFixed(2) + 'R' : '—')}
      ${stat('Fees', '$' + sum(trades, t => t.fees).toFixed(2))}
      ${stat('Best / worst', s.bestTrade ? `${money(s.bestTrade.pnl)} / ${money(s.worstTrade.pnl)}` : '—')}
    </div>
    <h3>Daily P&L</h3>${svg}
    ${table(['Date', 'Trades', 'Net P&L', 'Cumulative'], daily.map(x => `<tr><td>${x.d}</td><td>${x.n}</td><td>${money(x.pnl)}</td><td>${money(x.cum)}</td></tr>`))}
    <h3>By setup</h3>
    ${table(['Setup', 'Trades', 'Win rate', 'Net P&L', 'Avg R'], bySetup.map(r => `<tr><td>${esc(r.name)}</td><td>${r.n}</td><td>${r.winRate != null ? r.winRate.toFixed(0) + '%' : '—'}</td><td>${money(r.net)}</td><td>${r.avgR != null ? r.avgR.toFixed(2) + 'R' : '—'}</td></tr>`))}
    <h3>Mistakes</h3>
    ${table(['Mistake', 'Trades', 'Net P&L'], byMistake.map(r => `<tr><td>${esc(r.name)}</td><td>${r.n}</td><td>${money(r.net)}</td></tr>`))}
    <h3>Deposits & withdrawals</h3>
    ${table(['Date', 'Account', 'Type', 'Amount', 'Note'], funds.map(f => `<tr><td>${esc(f.date)}</td><td>${ACCOUNT_LABELS[f.account]}</td><td>${FUND_KIND_LABELS[f.kind]}</td><td>${money(f.amount)}</td><td>${esc(f.note) || ''}</td></tr>`))}
    <h3>Trades</h3>
    ${table(['Date', 'Symbol', 'Dir', 'Entry', 'Exit', 'Size', 'Net P&L', 'R', 'Setup'], trades.map(t => `<tr><td>${esc(t.date)}</td><td>${esc(t.symbol)}</td><td>${t.dir}</td><td>${fmtPx(t.entry)}</td><td>${fmtPx(t.exit)}</td><td>$${t.size.toFixed(2)}</td><td>${money(t.pnl)}</td><td>${t.rr != null ? t.rr.toFixed(2) : '—'}</td><td>${esc(t.setup) || ''}</td></tr>`))}
    <h3>Investments sold</h3>
    ${table(['Date', 'Symbol', 'Qty', 'Exit', 'Realized P&L', 'Proceeds'], sales.map(r => `<tr><td>${esc(r.date)}</td><td>${esc(r.symbol)}</td><td>${r.qtySold}</td><td>${r.exitPrice}</td><td>${money(r.realizedPnl)}</td><td>$${r.proceeds.toFixed(2)}</td></tr>`))}
  `;
}

ACTIONS['open-report'] = () => openReport();
ACTIONS['print-report'] = () => {
  const month = document.getElementById('report-month').value;
  if (!month) return toast('Pick a month', 'err');
  document.getElementById('report-view').innerHTML = buildReport(month);
  closeModal('report-modal');
  // Let the browser lay the report out before opening the print dialog
  setTimeout(() => window.print(), 100);
};
