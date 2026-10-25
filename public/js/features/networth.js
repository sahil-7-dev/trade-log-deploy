// ═══════════════════════════════════════════════════════════════════════════
// Net worth: everything across both accounts, split into realized and
// unrealized gains. One calculation, used by the Net Worth page, the
// Overview card and the sidebar so they always agree.
//
//   net worth = trading balance
//             + realized on partial closes (not in the balance until the full close)
//             + live P&L of open trades
//             + investing cash
//             + holdings at market value
//
// Open trades add only their live P&L — the money behind them is already in
// the trading balance. Holdings add their full value — buying them took the
// money out of cash. Everything that isn't a gain is "money put in", so:
//   net worth = money put in + realized + unrealized   (exactly, by construction)
// ═══════════════════════════════════════════════════════════════════════════

function computeNetWorth() {
  const open = TRADES.filter(t => t.status === 'Open');
  const closed = TRADES.filter(t => t.status !== 'Open');

  const closedPnl = sum(closed, t => t.pnl);
  const partialRealized = sum(open.map(partialCloseInfo).filter(Boolean), p => p.realized);
  const live = open.map(unrealizedPnl);
  const openUnrealized = sum(live.filter(v => v != null));
  const openUnpriced = live.filter(v => v == null).length;

  const holdingsValue = sum(HOLDINGS, h => h.qty * h.curPrice);
  const holdingsCost = sum(HOLDINGS, h => h.qty * h.buyPrice);
  const realizedInvesting = sum(realizedHistory, r => r.realizedPnl);

  const tradingAccount = tradingBalance + partialRealized + openUnrealized;
  const investingAccount = cashBalance + holdingsValue;
  const total = tradingAccount + investingAccount;

  const realized = { trading: closedPnl + partialRealized, investing: realizedInvesting };
  const unrealized = { trading: openUnrealized, investing: holdingsValue - holdingsCost };
  const gains = realized.trading + realized.investing + unrealized.trading + unrealized.investing;
  const moneyIn = total - gains;

  // What the money put in is made of: recorded movements (transfers between
  // your own accounts cancel out) + whatever predates the funds history.
  const external = FUNDS.filter(f => f.kind !== 'transfer_in' && f.kind !== 'transfer_out');
  const deposited = sum(external.filter(f => f.kind === 'deposit'), f => f.amount);
  const withdrawn = -sum(external.filter(f => f.kind === 'withdraw_bank' || f.kind === 'withdraw_removed'), f => f.amount);
  const adjustments = sum(external.filter(f => f.kind === 'adjustment'), f => f.amount);
  const untracked = moneyIn - (deposited - withdrawn + adjustments);

  return {
    total, tradingAccount, investingAccount,
    tradingBalance, partialRealized, openUnrealized, openCount: open.length, openUnpriced,
    investingCash: cashBalance, holdingsValue, holdingsCost,
    realized, unrealized,
    realizedTotal: realized.trading + realized.investing,
    unrealizedTotal: unrealized.trading + unrealized.investing,
    gains, moneyIn, returnPct: moneyIn > 0 ? gains / moneyIn * 100 : null,
    deposited, withdrawn, adjustments, untracked,
  };
}

// Today: realized today (trades + partial closes + sales) + the last 24h
// price move of crypto holdings (from the live prices). Open trades' intraday
// move isn't known, so it's not included.
function netWorthToday() {
  const today = localToday();
  const realizedToday = realizedOn(today) + sum(realizedHistory.filter(r => r.date === today), r => r.realizedPnl);
  let priceMove = 0;
  HOLDINGS.forEach(h => {
    const lp = livePrices[cleanSymbol(h.symbol)];
    if (h.livePrice && lp && lp.change24h) {
      const value = h.qty * h.curPrice;
      priceMove += value - value / (1 + lp.change24h / 100);
    }
  });
  return { realizedToday, priceMove, total: realizedToday + priceMove };
}
