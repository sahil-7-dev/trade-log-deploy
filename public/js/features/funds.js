// ═══════════════════════════════════════════════════════════════════════════
// Funds: deposits, withdrawals (to a bank account, or cash simply removed),
// balance adjustments and transfers between the Trading and Investing
// accounts. Every movement is a fund_transactions row (FUNDS), so there's a
// history to read, undo and total up — and the balances are worked out from
// it (core/balances.js), so adding or deleting a movement is all it takes.
// ═══════════════════════════════════════════════════════════════════════════

const FUND_KIND_LABELS = {
  deposit: 'Deposit',
  withdraw_bank: 'Withdrawn to bank',
  withdraw_removed: 'Removed',
  adjustment: 'Adjustment',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
};
const ACCOUNT_LABELS = { trading: 'Trading', investing: 'Investing cash' };

function accountBalance(account) {
  return account === 'trading' ? tradingBalance : cashBalance;
}

// Totals for one account's movements
function fundTotals(account) {
  const rows = FUNDS.filter(f => f.account === account);
  const by = kind => sum(rows.filter(f => f.kind === kind), f => f.amount);
  return {
    deposited: by('deposit'),
    toBank: -by('withdraw_bank'),
    removed: -by('withdraw_removed'),
    adjustments: by('adjustment'),
    transfersNet: by('transfer_in') + by('transfer_out'),
    net: sum(rows, f => f.amount),
  };
}

// Trading money the history doesn't explain. 0 once the database update has
// turned it into an "Opening balance" adjustment; an older database's
// stored balance can still hold some.
function untrackedTradingFunds() {
  return round2(balanceOffsets.trading);
}

// ─── MODAL ───────────────────────────────────────────────────────────────────
function openFundsModal(account = 'trading', action = 'deposit') {
  document.getElementById('fm-account').value = account;
  document.getElementById('fm-action').value = action;
  document.getElementById('fm-amount').value = '';
  document.getElementById('fm-note').value = '';
  document.getElementById('fm-adjust-dir').value = '+';
  document.getElementById('fm-date').value = localToday();
  updateFundsModal();
  openModal('funds-modal');
  setTimeout(() => document.getElementById('fm-amount').focus(), 50);
}

const otherAccount = a => a === 'trading' ? 'investing' : 'trading';

function updateFundsModal() {
  const account = document.getElementById('fm-account').value;
  const action = document.getElementById('fm-action').value;
  document.getElementById('fm-adjust-group').style.display = action === 'adjustment' ? '' : 'none';
  const bal = accountBalance(account);
  const hints = {
    deposit: `Adds money to ${ACCOUNT_LABELS[account]}.`,
    withdraw_bank: `Money moved out to your bank account — it's still yours, just not in ${ACCOUNT_LABELS[account]}.`,
    withdraw_removed: 'Cash taken out and spent, given away or otherwise gone (not to a bank).',
    adjustment: 'A one-off correction so the balance matches reality (e.g. P&L that was never recorded).',
    transfer: `Moves money from ${ACCOUNT_LABELS[account]} to ${ACCOUNT_LABELS[otherAccount(account)]}.`,
  };
  setText('fm-hint', `${hints[action]}  Available: $${bal.toFixed(2)}`);
  setText('fm-title', action === 'deposit' ? 'Deposit' : action === 'transfer' ? 'Transfer' : action === 'adjustment' ? 'Adjust Balance' : 'Withdraw');
  document.getElementById('fm-submit').textContent =
    action === 'deposit' ? 'Deposit' : action === 'transfer' ? 'Transfer' : action === 'adjustment' ? 'Save Adjustment' : 'Withdraw';
}
CHANGE_HANDLERS['fm-account'] = updateFundsModal;
CHANGE_HANDLERS['fm-action'] = updateFundsModal;

async function submitFunds() {
  if (demoGuard() || migrationGuard()) return;
  const account = document.getElementById('fm-account').value;
  const action = document.getElementById('fm-action').value;
  const amount = round2(parseFloat(document.getElementById('fm-amount').value));
  const date = document.getElementById('fm-date').value || localToday();
  const note = document.getElementById('fm-note').value.trim() || null;
  if (!(amount > 0)) return toast('Enter an amount greater than 0', 'err');

  const outgoing = action === 'withdraw_bank' || action === 'withdraw_removed' || action === 'transfer'
    || (action === 'adjustment' && document.getElementById('fm-adjust-dir').value === '-');
  if (outgoing && action !== 'adjustment' && amount > accountBalance(account) + 0.005) {
    return toast(`Only $${accountBalance(account).toFixed(2)} available in ${ACCOUNT_LABELS[account]}`, 'err');
  }

  const base = { user_id: currentUser.id, date, note };
  let rows;
  if (action === 'transfer') {
    const transfer_id = uuid();
    rows = [
      { ...base, account, kind: 'transfer_out', amount: -amount, transfer_id },
      { ...base, account: otherAccount(account), kind: 'transfer_in', amount, transfer_id },
    ];
  } else {
    rows = [{ ...base, account, kind: action, amount: outgoing ? -amount : amount, transfer_id: null }];
  }

  const btn = document.getElementById('fm-submit');
  const label = btn.textContent;
  btn.textContent = 'Saving…'; btn.disabled = true;
  try {
    const inserted = await sbInsert('fund_transactions', rows);
    (inserted || rows).forEach(r => {
      const f = normalizeFund(r);
      FUNDS.unshift(f);
    });
    FUNDS.sort((a, b) => b.date.localeCompare(a.date));
    await persistBalances();
    closeModal('funds-modal');
    renderAll();
    toast(`${action === 'transfer' ? 'Transfer' : FUND_KIND_LABELS[action]} of $${amount.toFixed(2)} saved ✓`);
  } catch (e) {
    toast(e.message, 'err');
  }
  btn.textContent = label; btn.disabled = false;
}

// Deleting a movement reverses its effect on the balance (both sides of a
// transfer together), with Undo.
async function deleteFund(id) {
  if (demoGuard()) return;
  const f = FUNDS.find(x => x.id === id);
  if (!f) return;
  const group = f.transfer_id ? FUNDS.filter(x => x.transfer_id === f.transfer_id) : [f];
  const ok = await confirmDialog({
    title: `Delete this ${FUND_KIND_LABELS[f.kind].toLowerCase()}?`,
    message: group.length > 1
      ? `Both sides of the transfer are removed and both balances change back.`
      : `${ACCOUNT_LABELS[f.account]} balance ${f.amount >= 0 ? 'goes down' : 'goes back up'} by $${Math.abs(f.amount).toFixed(2)}.`,
    confirmText: 'Delete', danger: true,
  });
  if (!ok) return;
  try {
    const res = await sbRequest('DELETE', `fund_transactions?id=in.(${group.map(g => g.id).join(',')})`);
    if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
    FUNDS = FUNDS.filter(x => !group.includes(x));
    await persistBalances();
    renderAll();
    toastAction('Deleted', 'Undo', async () => {
      await sbInsert('fund_transactions', group.map(g => ({
        id: g.id, user_id: g.user_id, date: g.date, account: g.account, kind: g.kind,
        amount: g.amount, transfer_id: g.transfer_id, note: g.note,
      })));
      group.forEach(g => FUNDS.push(g));
      FUNDS.sort((a, b) => b.date.localeCompare(a.date));
      await persistBalances();
      renderAll();
      toast('Restored ✓');
    });
  } catch (e) {
    toast(e.message, 'err');
  }
}

ACTIONS['open-funds'] = el => openFundsModal(el.dataset.account || 'trading', el.dataset.kind || 'deposit');
ACTIONS['open-add-funds'] = () => openFundsModal('trading', 'deposit');      // existing buttons
ACTIONS['open-deposit-cash'] = () => openFundsModal('investing', 'deposit'); // existing buttons
ACTIONS['submit-funds'] = () => submitFunds();
ACTIONS['delete-fund'] = el => deleteFund(el.dataset.id);
