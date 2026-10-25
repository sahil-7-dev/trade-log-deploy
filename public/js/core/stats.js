// ═══════════════════════════════════════════════════════════════════════════
// Stats engine: computeStats() and helpers every page shares.
// ═══════════════════════════════════════════════════════════════════════════

// ─── STATS COMPUTATION ────────────────────────────────────────────────────────
function computeStats(tradesOverride) {
  const src = tradesOverride ?? TRADES; // ?? not ||: an empty date range must stay empty
  const closed = src.filter(t => t.status !== 'Open');
  const wins = closed.filter(t => t.status === 'Win');
  const losses = closed.filter(t => t.status === 'Loss');
  const breakeven = closed.filter(t => t.status === 'Breakeven');
  const open = src.filter(t => t.status === 'Open');

  const totalPnl = closed.reduce((s, t) => s + t.pnl, 0);
  const breakevenPnl = breakeven.reduce((s, t) => s + t.pnl, 0);
  // Win rate is "of the trades that were actually decided, how many did you
  // win" — a breakeven/scratch trade isn't a decision outcome, so it's
  // excluded from both sides of the ratio rather than diluting it as a loss.
  const decided = wins.length + losses.length;
  // null when nothing was decided (no trades, or all breakeven) — shown as "—", not a misleading 0%
  const winRate = decided ? (wins.length / decided * 100).toFixed(1) : null;
  const rrVals = closed.filter(t => t.rr != null).map(t => t.rr);
  const avgRR = rrVals.length ? (rrVals.reduce((a, b) => a + b, 0) / rrVals.length) : null;
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
  const avgBreakeven = breakeven.length ? breakevenPnl / breakeven.length : 0;
  // Expectancy stays weighted over ALL closed trades (not just decided ones)
  // since it's "average $ per trade taken," and a scratch is still a trade —
  // its near-zero pnl just barely moves the number, which is correct.
  const expectancy = closed.length
    ? (wins.length / closed.length) * avgWin + (losses.length / closed.length) * avgLoss + (breakeven.length / closed.length) * avgBreakeven
    : 0;
  // Closed Positions = fully closed only (everything above). Closed Trades
  // also counts trades still partly open, with what their partial closes
  // have realized so far — the only stat that sees partial closes.
  const partlyClosed = open.map(t => partialCloseInfo(t)).filter(Boolean);
  const partialRealized = partlyClosed.reduce((s, p) => s + p.realized, 0);
  const closedTradesCount = closed.length + partlyClosed.length;
  const closedTradesPnl = totalPnl + partialRealized;

  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? (grossWin / grossLoss) : null;

  const sortedClosed = [...closed].sort((a, b) => b.pnl - a.pnl);
  const bestTrade = sortedClosed[0] || null;
  const worstTrade = sortedClosed[sortedClosed.length - 1] || null;

  // Streaks — a breakeven trade is neutral: it resets the current streak
  // rather than extending or breaking either a win or loss run.
  let bestStreak = 0, worstStreak = 0, cur = 0;
  const statusSeq = [...src].sort((a, b) => closeSortKey(a).localeCompare(closeSortKey(b))) // in close order, incl. within a day
    .filter(t => t.status !== 'Open').map(t => t.status);
  for (const s of statusSeq) {
    if (s === 'Win') { cur = cur >= 0 ? cur + 1 : 1; bestStreak = Math.max(bestStreak, cur); }
    else if (s === 'Loss') { cur = cur <= 0 ? cur - 1 : -1; worstStreak = Math.min(worstStreak, cur); }
    else { cur = 0; } // Breakeven
  }

  // Max drawdown — measured on account equity after each trade (see
  // equityPath), not on cumulative P&L alone: falling from a +$10 P&L peak to
  // -$5 is a small dip on a $1,000 account, not a "-150%" drawdown.
  const path = equityPath(closed);
  let dd = 0, maxDdAmt = 0;
  if (path.base > 0) {
    let peak = path.start;
    for (const p of path.points) {
      if (p.equity > peak) peak = p.equity;
      maxDdAmt = Math.max(maxDdAmt, peak - p.equity);
      if (peak > 0) dd = Math.min(dd, (p.equity - peak) / peak * 100);
    }
  }

  // Investments
  const invTotal = HOLDINGS.reduce((s, h) => s + h.qty * h.curPrice, 0);
  const invCost = HOLDINGS.reduce((s, h) => s + h.qty * h.buyPrice, 0);
  const invPnl = invTotal - invCost;

  // Total portfolio value = holdings market value + idle cash. Cash itself
  // has no unrealized gain/loss (it's already realized dollars), so it's
  // added to both the value and the cost-basis side of the return % —
  // otherwise a mostly-cash portfolio would misleadingly show the same
  // return % as a fully-invested one with the same dollar gain.
  const totalEquity = invTotal + cashBalance;
  const totalEquityCost = invCost + cashBalance;
  const totalEquityPct = totalEquityCost > 0 ? (invPnl / totalEquityCost * 100) : null;

  // Best holding
  const bestHolding = HOLDINGS.length ? HOLDINGS.reduce((a, b) => {
    const aRet = (a.curPrice - a.buyPrice) / a.buyPrice;
    const bRet = (b.curPrice - b.buyPrice) / b.buyPrice;
    return aRet > bRet ? a : b;
  }) : null;

  return {
    totalPnl, winRate, avgRR, avgWin, avgLoss, expectancy,
    grossWin, grossLoss, profitFactor,
    bestTrade, worstTrade, bestStreak, worstStreak,
    wins, losses, breakeven, breakevenPnl, open, closed, maxDrawdown: dd, maxDdAmt,
    partlyClosed, partialRealized, closedTradesCount, closedTradesPnl,
    invTotal, invCost, invPnl, bestHolding,
    totalEquity, totalEquityCost, totalEquityPct
  };
}

// Wrap a value in balance-val span so blur applies to it
const bv = (val) => `<span class="balance-val">${val}</span>`;



// Running value of a metric across closed trades in time order, sampled to
// at most `points` values — the data behind a stat tile's sparkline.
// fn(tradesSoFar) → number | null
function runningSeries(closed, fn, points = 30) {
  const chrono = [...closed].sort((a, b) => closeSortKey(a).localeCompare(closeSortKey(b)));
  if (chrono.length < 2) return [];
  const step = Math.max(1, Math.floor(chrono.length / points));
  const out = [];
  for (let i = step; i <= chrono.length; i += step) {
    const v = fn(chrono.slice(0, i));
    if (v != null && Number.isFinite(v)) out.push(v);
  }
  const last = fn(chrono);
  if (out[out.length - 1] !== last && last != null && Number.isFinite(last)) out.push(last);
  return out;
}

// Closed trades in time order (by close time when known)
// Equity after each closed trade of a period, in close order. It starts
// from the money in the account before the period: the money put in
// (balance minus every closed trade's P&L) plus the P&L of every trade that
// closed before the period's first trade — so a YTD drawdown is measured on
// the account as it really stood, not on the original deposit.
function equityPath(closedInRange) {
  const chrono = chronological(closedInRange);
  const allClosed = TRADES.filter(t => t.status !== 'Open');
  const base = tradingBalance - sum(allClosed, t => t.pnl);
  // everything that closed before the period's first trade, by position in
  // the same close-order list (so trades closed in the same second count right)
  const inRange = new Set(chrono);
  const all = chronological(allClosed);
  const firstIdx = all.findIndex(t => inRange.has(t));
  const before = firstIdx > 0 ? sum(all.slice(0, firstIdx).filter(t => !inRange.has(t)), t => t.pnl) : 0;
  let equity = base + before;
  return { start: equity, base, points: chrono.map(t => ({ t, equity: (equity += t.pnl) })) };
}

function chronological(trades) {
  return [...trades].filter(t => t.status !== 'Open').sort((a, b) => closeSortKey(a).localeCompare(closeSortKey(b)));
}

// "YYYY-MM-DD HH:MM:SS" in LOCAL time: the trade's date (the day the calendar
// files it under), then its local close time (end of day if unknown).
// closed_at is stored in UTC — comparing it raw against local dates put a
// trade closed at 1am IST (still the previous day in UTC) before the
// previous day's trades.
function closeSortKey(t) {
  if (!t.closed_at) return t.date + ' 23:59:59';
  const d = new Date(t.closed_at);
  const hms = [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
  return t.date + ' ' + hms;
}
