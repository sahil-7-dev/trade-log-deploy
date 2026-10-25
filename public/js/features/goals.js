// ═══════════════════════════════════════════════════════════════════════════
// Goals & limits: monthly profit target, daily loss limit (with a banner on
// every page when it's hit), risk per trade. Set on the Settings page.
// ═══════════════════════════════════════════════════════════════════════════

// Realized on a day (net): every partial close made that day, plus trades
// fully closed that day — minus the partial closes they had on EARLIER days,
// which were already counted on those days. (A trade's P&L covers all its
// fills, so −$300 yesterday and −$10 today is −$10 today, not −$310.)
function realizedOn(dateStr) {
  const fillNet = f => (parseFloat(f.pnl) || 0) - (parseFloat(f.fee) || 0);
  let total = 0;
  for (const t of TRADES) {
    if (t.status !== 'Open' && t.date === dateStr) {
      total += t.pnl - sum(t.closes.filter(f => f.date && f.date !== dateStr), fillNet);
    } else {
      total += sum(t.closes.filter(f => f.date === dateStr), fillNet);
    }
  }
  return total;
}

function goalsSnapshot() {
  const today = localToday();
  const month = today.slice(0, 7);
  return {
    monthPnl: sum(TRADES.filter(t => t.status !== 'Open' && t.date.startsWith(month)), t => t.pnl),
    todayPnl: realizedOn(today),
    target: parseFloat(PREFS.monthlyTarget) || 0,
    limit: parseFloat(PREFS.dailyLossLimit) || 0,
    riskPct: parseFloat(PREFS.riskPct) || 0,
  };
}

// Meters for the target, today's loss vs the limit, and risk per trade
function goalsHtml() {
  const g = goalsSnapshot();
  const money = v => `<span class="balance-val">${fmt(v)}</span>`;
  return [
    g.target
      ? meter({ label: 'This month', valueText: `${money(g.monthPnl)} <span class="muted">/ ${fmtMoney(g.target)}</span>`, pct: g.monthPnl / g.target * 100, cls: 'pos',
          sub: g.monthPnl >= g.target ? '🎯 Target reached' : `${Math.max(0, g.monthPnl / g.target * 100).toFixed(0)}% of monthly target` })
      : meter({ label: 'This month', valueText: money(g.monthPnl), pct: 0, sub: 'No monthly target — set one in Settings' }),
    g.limit
      ? meter({ label: 'Today', valueText: `${money(g.todayPnl)} <span class="muted">/ −${fmtMoney(g.limit)}</span>`, pct: g.todayPnl < 0 ? -g.todayPnl / g.limit * 100 : 0,
          cls: g.todayPnl <= -g.limit ? 'neg' : -g.todayPnl > g.limit * 0.6 ? 'warn' : 'neg',
          sub: g.todayPnl <= -g.limit ? '⛔ Daily loss limit reached' : g.todayPnl < 0 ? `${(-g.todayPnl / g.limit * 100).toFixed(0)}% of daily loss limit used` : 'In profit today' })
      : meter({ label: 'Today', valueText: money(g.todayPnl), pct: 0, sub: 'No daily loss limit set' }),
    `<div class="meter"><div class="meter-head"><span>Risk per trade</span><span class="num">${g.riskPct ? g.riskPct + '%' : '—'}</span></div>
      <div class="goal-sub">${g.riskPct && tradingBalance > 0 ? `= ${fmtMoney(tradingBalance * g.riskPct / 100)} at your current balance` : 'Set it in Settings — used by the position-size calculator'}</div></div>`,
  ].join('');
}

function renderGoals() {
  setHtml('goals-body', goalsHtml());
}

// Shared (every page): the "daily loss limit reached" banner
function renderRiskBanner() {
  const banner = document.getElementById('risk-banner');
  if (!banner) return;
  const g = goalsSnapshot();
  const hit = g.limit > 0 && g.todayPnl <= -g.limit;
  banner.style.display = hit ? 'flex' : 'none';
  if (hit) setText('risk-banner-text', `Daily loss limit reached: ${fmt(g.todayPnl)} today (limit −${fmtMoney(g.limit)}). Consider stopping for the day.`);
}
RENDER_HOOKS.push(renderRiskBanner);
