// ═══════════════════════════════════════════════════════════════════════════
// Balances are worked out from the history, never stored and nudged:
//
//   trading balance = trading deposits/withdrawals/adjustments/transfers
//                     + net P&L of every fully closed trade
//   investing cash  = investing deposits/withdrawals/adjustments/transfers
//                     − what the holdings cost + realized gains from sales
//
// Logging, editing, closing, deleting, importing or syncing anything just
// changes the history; the balances follow by themselves (recomputeBalances,
// run before every render). Two devices can't overwrite each other and a
// sync can't count P&L twice, because there's no stored number to get out
// of step.
//
// Money from before the funds history existed is an "Opening balance"
// adjustment row, added once by the 2026-10-27 database update.
// balanceOffsets covers the cases that have no such row: demo data, and an
// older database (before that update), where the balances are still stored —
// the offset is whatever the stored balance holds that the history doesn't
// explain, and the result is saved back after each change.
// ═══════════════════════════════════════════════════════════════════════════

let balanceOffsets = { trading: 0, cash: 0 };

function ledgerBalances() {
  const funds = account => sum(FUNDS.filter(f => f.account === account), f => f.amount);
  return {
    trading: funds('trading') + sum(TRADES.filter(t => t.status !== 'Open'), t => t.pnl),
    cash: funds('investing') - sum(HOLDINGS, h => h.qty * h.buyPrice) + sum(realizedHistory, r => r.realizedPnl),
  };
}

function recomputeBalances() {
  const d = ledgerBalances();
  tradingBalance = round2(d.trading + balanceOffsets.trading);
  cashBalance = round2(d.cash + balanceOffsets.cash);
}

// Sets the offsets so the balances come out at these values right now
// (demo data, an older database's stored balances, the cached ones at start-up)
function anchorBalances(trading, cash) {
  const d = ledgerBalances();
  balanceOffsets = { trading: round2(trading - d.trading), cash: round2(cash - d.cash) };
  recomputeBalances();
}

// After a change: balances follow the history. Only an older database still
// stores them, so they're saved there; with the update nothing needs saving.
async function persistBalances() {
  recomputeBalances();
  safeLocalSet('trading_balance', tradingBalance.toString());
  safeLocalSet('cash_balance', cashBalance.toString());
  if (LEDGER_READY || isDemoMode || !currentUser) return true;
  return saveUserSettings();
}

// Records a change that must NOT move a balance (P&L of imported trades you
// chose to keep out, sale history you cleared) as a visible adjustment in the
// funds history — or, on a database without one, in the offset.
async function holdBalance(account, amount, note) {
  amount = round2(amount);
  if (!amount) return;
  if (DB_READY) {
    const rows = await sbInsert('fund_transactions', [{
      user_id: currentUser.id, date: localToday(), account, kind: 'adjustment', amount, note, transfer_id: null,
    }]);
    (rows || []).forEach(r => FUNDS.unshift(normalizeFund(r)));
  } else {
    balanceOffsets[account === 'trading' ? 'trading' : 'cash'] += amount;
  }
}
