// ═══════════════════════════════════════════════════════════════════════════
// Trade detail panel: everything about one trade, including every close.
// ═══════════════════════════════════════════════════════════════════════════

// ─── TRADE DETAIL PANEL ──────────────────────────────────────────────────────
function plannedRR(t) {
  if (t.sl == null || t.tp == null || !t.entry) return null;
  const risk = Math.abs(t.entry - t.sl);
  return risk > 0 ? Math.abs(t.tp - t.entry) / risk : null;
}

function openTradeDetail(id) {
  const t = TRADES.find(x => x.id === id);
  if (!t) return;
  const field = (label, value) => `<div class="detail-field"><div class="detail-label">${label}</div><div class="detail-value">${value}</div></div>`;
  const partial = partialCloseInfo(t);
  const unreal = unrealizedPnl(t);
  const prr = plannedRR(t);
  const hold = t.opened_at && t.closed_at ? fmtDuration(new Date(t.closed_at) - new Date(t.opened_at))
    : t.opened_at && t.status === 'Open' ? fmtDuration(Date.now() - new Date(t.opened_at)) + ' so far' : '—';
  const dt = v => v ? new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const statusBadge = `<span class="badge ${t.status === 'Win' ? 'badge-win' : t.status === 'Loss' ? 'badge-loss' : t.status === 'Breakeven' ? 'badge-breakeven' : 'badge-open'}">${esc(t.status)}</span>`;

  setHtml('td-title', `${esc(t.symbol)} <span class="badge ${t.dir === 'Long' ? 'badge-long' : 'badge-short'}">${esc(t.dir)}</span> ${statusBadge}`);
  const pnlCls = v => v > 0 ? 'green' : v < 0 ? 'red' : '';
  setHtml('td-grid', [
    field('Entry', fmtPx(t.entry)),
    field(t.closes.length > 1 && t.exit != null ? 'Avg exit' : 'Exit', t.exit != null ? fmtPx(t.exit) : 'Open'),
    field('Size', `$${t.size.toFixed(2)}${partial ? ` <span style="color:var(--muted)">of $${partial.originalSize.toFixed(2)}</span>` : ''}`),
    field('Stop / Target', `${t.sl ?? '—'} / ${t.tp ?? '—'}`),
    field('Net P&L', t.status === 'Open' ? '—' : `<span class="${pnlCls(t.pnl)} balance-val">${fmt(t.pnl)}</span>`),
    field('Gross P&L / Fees', t.status === 'Open' ? '—' : `<span class="balance-val">${fmt(t.grossPnl)}</span> / $${t.fees.toFixed(2)}`),
    field('R:R achieved', t.rr != null ? `<span class="${pnlCls(t.rr)}">${t.rr.toFixed(2)}R</span>` : '—'),
    field('R:R planned', prr != null ? prr.toFixed(2) + 'R' : '—'),
    field('Unrealized', unreal != null ? `<span class="${pnlCls(unreal)} balance-val">${fmt(unreal)}</span> @ ${livePriceForTrade(t)}` : '—'),
    field('Realized so far', partial ? `<span class="${pnlCls(partial.realized)} balance-val">${fmt(partial.realized)}</span>` : '—'),
    field('Opened', dt(t.opened_at)),
    field('Closed', t.status === 'Open' ? '—' : (t.closed_at ? dt(t.closed_at) : esc(t.date))),
    field('Holding time', hold),
    field('Setup', esc(t.setup) || '—'),
    field('Followed plan', t.followed_plan == null ? '—' : t.followed_plan ? '✓ Yes' : '✗ No'),
    field('Emotion', esc(t.emotion) || '—'),
    field('Source', t.source === 'bybit' ? 'Bybit sync' : t.source === 'import' ? 'CSV import' : 'Manual'),
    field('Asset type', esc(t.type)),
  ].join(''));

  const chips = arr => arr && arr.length ? arr.map(x => `<span class="tag-chip">${esc(x)}</span>`).join('') : '—';
  setHtml('td-tags', `<div class="detail-label">Tags</div><div style="margin-top:4px">${chips(t.tags)}</div>
    <div class="detail-label" style="margin-top:10px">Mistakes</div><div style="margin-top:4px">${chips(t.mistakes)}</div>`);

  setHtml('td-fills', t.closes.length ? `
    <div class="detail-label" style="margin-bottom:6px">Closes (${t.closes.length})</div>
    <table><thead><tr><th>Date</th><th>Closed</th><th>Exit</th><th>P&L</th><th>Fee</th></tr></thead><tbody>
    ${t.closes.map(f => `<tr style="cursor:default">
      <td class="mono" style="color:var(--muted)">${esc(f.date || '')}</td>
      <td class="mono">$${(+f.size).toFixed(2)}</td>
      <td class="mono">${esc(String(f.exit))}</td>
      <td class="mono ${pnlCls(f.pnl)}"><span class="balance-val">${fmt(f.pnl)}</span></td>
      <td class="mono" style="color:var(--muted)">${f.fee ? '$' + (+f.fee).toFixed(2) : '—'}</td>
    </tr>`).join('')}</tbody></table>` : '');

  setHtml('td-notes', `<div class="detail-label">Notes</div><div style="margin-top:4px;white-space:pre-wrap;font-size:12px;line-height:1.6">${esc(t.notes) || '<span style="color:var(--muted)">No notes</span>'}</div>`);

  const safeId = esc(t.id);
  setHtml('td-actions', `
    ${t.status === 'Open' ? `<button class="btn btn-ghost" data-action="td-close" data-id="${safeId}">${partial ? 'Close rest' : 'Close trade'}</button>` : ''}
    <button class="btn btn-ghost" data-action="td-edit" data-id="${safeId}">Edit</button>
    <button class="btn btn-ghost" data-action="td-delete" data-id="${safeId}" style="color:var(--red)">Delete</button>
    <button class="btn btn-primary" data-action="close-modal" data-modal="trade-detail-modal">Done</button>`);
  openModal('trade-detail-modal');
}
ACTIONS['open-trade-detail'] = (el, e) => { e.stopPropagation(); openTradeDetail(el.dataset.id); };
ACTIONS['td-edit'] = el => { closeModal('trade-detail-modal'); openEditTrade(el.dataset.id); };
ACTIONS['td-close'] = el => { closeModal('trade-detail-modal'); openCloseTrade(el.dataset.id); };
ACTIONS['td-delete'] = el => { closeModal('trade-detail-modal'); deleteTrade(el.dataset.id); };
