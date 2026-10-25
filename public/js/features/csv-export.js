// ═══════════════════════════════════════════════════════════════════════════
// Export trades as CSV (same columns the importer reads back).
// ═══════════════════════════════════════════════════════════════════════════

// ─── EXPORT CSV ───────────────────────────────────────────────────────────────
function exportCSV() {
  if (TRADES.length === 0) return toast('No trades to export', 'err');
  // Same columns the CSV importer recognizes, so export → import round-trips
  const headers = ['Date','Symbol','Type','Direction','Entry','Exit','Size','SL','TP','Fees','Gross P&L','Net P&L','RR','Status',
    'Setup','Tags','Mistakes','Emotion','Followed Plan','Opened At','Closed At','Notes'];
  const rows = TRADES.map(t => [
    t.date, t.symbol, t.type, t.dir,
    t.entry, t.exit != null ? t.exit : '',
    t.size, t.sl != null ? t.sl : '', t.tp != null ? t.tp : '',
    t.fees.toFixed(2), t.grossPnl.toFixed(2), t.pnl.toFixed(2),
    t.rr != null ? t.rr.toFixed(4) : '',
    t.status, t.setup || '',
    Array.isArray(t.tags) ? t.tags.join(';') : (t.tags || ''),
    (t.mistakes || []).join(';'), t.emotion || '',
    t.followed_plan == null ? '' : (t.followed_plan ? 'yes' : 'no'),
    t.opened_at || '', t.closed_at || '',
    (t.notes || '').replace(/\n/g, ' ')
  ]);
  // Standard CSV quoting: double any embedded quote. Text starting with
  // = + - @ is prefixed with ' so spreadsheets don't run it as a formula
  // (numeric values are left alone so negative P&L stays a number).
  const cell = v => {
    let s = String(v);
    if (/^[=+\-@]/.test(s) && isNaN(Number(s))) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = [headers, ...rows].map(r => r.map(cell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tradelog_${localToday()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV exported ✓');
}
