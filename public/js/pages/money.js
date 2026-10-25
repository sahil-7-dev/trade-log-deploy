// ═══════════════════════════════════════════════════════════════════════════
// Money page: both account balances, every deposit / withdrawal / adjustment
// / transfer, monthly cash flow (in vs out) and cumulative net deposits.
// Writes go through features/funds.js.
// ═══════════════════════════════════════════════════════════════════════════

registerPage('money', {
  title: 'Money', subtitle: 'Deposits, withdrawals and transfers', icon: '◍', section: 'Money', order: 20,
  render: renderMoneyPage,
});

const MONEY_FILTERS = { account: '', kind: '' };
CHANGE_HANDLERS['money-f-account'] = el => { MONEY_FILTERS.account = el.value; renderFundsTable(); };
CHANGE_HANDLERS['money-f-kind'] = el => { MONEY_FILTERS.kind = el.value; renderFundsTable(); };

function renderMoneyPage() {
  const migrated = DB_READY;
  const off = document.getElementById('money-migration');
  if (off) off.style.display = migrated ? 'none' : '';
  const tr = fundTotals('trading'), inv = fundTotals('investing');
  const untracked = untrackedTradingFunds();
  setHtml('money-kpis', [
    statTile({ label: 'Trading balance', value: bv(fmtMoney(tradingBalance)), cls: tradingBalance >= 0 ? 'green' : 'red', sub: 'deposits − withdrawals + net P&L' }),
    statTile({ label: 'Investing cash', value: bv(fmtMoney(cashBalance)), cls: cashBalance >= 0 ? 'green' : 'red', sub: 'ready to invest' }),
    statTile({ label: 'Deposited', value: bv(fmtMoney(tr.deposited + inv.deposited)), sub: `trading ${fmtMoney(tr.deposited)} · investing ${fmtMoney(inv.deposited)}` }),
    statTile({ label: 'Withdrawn to bank', value: bv(fmtMoney(tr.toBank + inv.toBank)), cls: 'amber', sub: 'still yours, in your bank' }),
    statTile({ label: 'Removed', value: bv(fmtMoney(tr.removed + inv.removed)), cls: tr.removed + inv.removed ? 'red' : '', sub: 'spent / gone' }),
    statTile({ label: 'Opening & adjustments', value: bv(fmt(tr.adjustments + inv.adjustments + untracked + round2(balanceOffsets.cash))), sub: 'opening balances + corrections',
      tip: 'Money from before the funds history ("Opening balance" rows, added once by the database update) plus any balance adjustments you made. Each one is in Funds history, where you can check or delete it.' }),
  ].join(''));

  // ── Monthly cash flow: money in above zero (blue), money out below (orange)
  //    Transfers between your own accounts aren't cash flow — left out.
  const external = FUNDS.filter(f => f.kind !== 'transfer_in' && f.kind !== 'transfer_out');
  const months = [...new Set(external.map(f => f.date.slice(0, 7)))].sort();
  const inByM = months.map(m => round2(sum(external.filter(f => f.date.startsWith(m) && f.amount > 0), f => f.amount)));
  const outByM = months.map(m => round2(sum(external.filter(f => f.date.startsWith(m) && f.amount < 0), f => f.amount)));
  const label = m => `${MONTHLY_LABELS[+m.slice(5) - 1]} ${m.slice(2, 4)}`;
  multiBarChart('cashFlowChart', months.map(label), [
    { label: 'Money in', data: inByM, color: CHART.in },
    { label: 'Money out', data: outByM, color: CHART.out },
  ], { stacked: true });

  // ── Cumulative net deposits (money in − money out, both accounts)
  let c = 0;
  const days = [...new Set(external.map(f => f.date))].sort();
  lineChart('netDepositsChart', days, [{ label: 'Net deposits', data: days.map(d => round2(c += sum(external.filter(f => f.date === d), f => f.amount))), color: CHART.series[0], fill: true, stepped: 'after' }],
    { empty: !days.length });

  renderFundsTable();
}

function renderFundsTable() {
  const rows = FUNDS.filter(f => (!MONEY_FILTERS.account || f.account === MONEY_FILTERS.account)
    && (!MONEY_FILTERS.kind || f.kind === MONEY_FILTERS.kind || (MONEY_FILTERS.kind === 'transfer' && f.transfer_id)));
  setText('money-count', `${rows.length} movement${rows.length !== 1 ? 's' : ''}`);
  setHtml('funds-body', rows.length === 0
    ? `<tr><td colspan="6">${emptyState('◍', FUNDS.length ? 'Nothing matches' : 'No deposits or withdrawals yet', FUNDS.length ? 'Try other filters.' : 'Record money moving in and out so your returns are measured against what you actually put in.', FUNDS.length ? '' : '<button class="btn btn-primary btn-sm" data-action="open-funds" data-account="trading" data-kind="deposit">＋ First deposit</button>')}</td></tr>`
    : rows.map(f => `<tr>
        <td class="num" style="color:var(--muted)">${esc(f.date)}</td>
        <td>${esc(ACCOUNT_LABELS[f.account] || f.account)}</td>
        <td><span class="badge ${f.amount >= 0 ? 'badge-win' : f.kind === 'withdraw_bank' ? 'badge-open' : 'badge-loss'}">${esc(FUND_KIND_LABELS[f.kind] || f.kind)}</span></td>
        <td class="num ${f.amount >= 0 ? 'green' : 'red'}"><span class="balance-val">${fmt(f.amount)}</span></td>
        <td style="color:var(--muted);font-size:11px;max-width:260px;overflow:hidden;text-overflow:ellipsis">${esc(f.note) || '—'}</td>
        <td><button class="icon-btn-delete" data-action="delete-fund" data-id="${esc(f.id)}" title="Delete (reverses the balance change)" style="background:none;border:none;cursor:pointer;font-size:12px;padding:2px 6px;border-radius:4px">✕</button></td>
      </tr>`).join(''));
}
