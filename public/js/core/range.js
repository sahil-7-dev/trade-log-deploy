// ═══════════════════════════════════════════════════════════════════════════
// Global date range (top bar). Scopes stats, charts and the trade log on every
// page; the calendar, heatmaps and yearly recap keep their own period.
// ═══════════════════════════════════════════════════════════════════════════

// Applies to stats, charts and the Trade Log table. Open trades are always
// included — they have no closing date to filter by yet.
let RANGE = (() => {
  try { return JSON.parse(localStorage.getItem('date_range')) || { preset: 'all' }; }
  catch (e) { return { preset: 'all' }; }
})();

function rangeBounds() {
  const today = new Date();
  const iso = d => localDateOf(d);
  const daysAgo = n => iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - n));
  switch (RANGE.preset) {
    case 'today': return [iso(today), iso(today)];
    case '7d':    return [daysAgo(6), iso(today)];
    case 'month': return [iso(new Date(today.getFullYear(), today.getMonth(), 1)), iso(today)];
    case '30d':   return [daysAgo(29), iso(today)];
    case '90d':   return [daysAgo(89), iso(today)];
    case 'ytd':   return [`${today.getFullYear()}-01-01`, iso(today)];
    case 'lastyear': return [`${today.getFullYear() - 1}-01-01`, `${today.getFullYear() - 1}-12-31`];
    case 'custom': return [RANGE.from || '0000-01-01', RANGE.to || '9999-12-31'];
    default: return null;
  }
}

function tradesInRange() {
  const b = rangeBounds();
  if (!b) return TRADES;
  return TRADES.filter(t => t.status === 'Open' || (t.date >= b[0] && t.date <= b[1]));
}

function onRangeChange() {
  RANGE.preset = document.getElementById('range-select').value;
  if (RANGE.preset === 'custom') {
    RANGE.from = document.getElementById('range-from').value || RANGE.from || localToday();
    RANGE.to = document.getElementById('range-to').value || RANGE.to || localToday();
  }
  try { localStorage.setItem('date_range', JSON.stringify(RANGE)); } catch (e) { /* convenience only */ }
  syncRangeControls();
  if (typeof TL_PAGE !== 'undefined') TL_PAGE = 1;
  renderAll();
}
function syncRangeControls() {
  const sel = document.getElementById('range-select');
  if (sel) sel.value = RANGE.preset;
  const custom = document.getElementById('range-custom');
  if (custom) custom.style.display = RANGE.preset === 'custom' ? 'flex' : 'none';
  if (RANGE.preset === 'custom') {
    document.getElementById('range-from').value = RANGE.from || '';
    document.getElementById('range-to').value = RANGE.to || '';
  }
}
CHANGE_HANDLERS['range-select'] = onRangeChange;
CHANGE_HANDLERS['range-from'] = onRangeChange;
CHANGE_HANDLERS['range-to'] = onRangeChange;

// The same-length window just before the current range (for "vs previous
// period" deltas). null for "All time".
function previousRangeBounds() {
  const b = rangeBounds();
  if (!b || RANGE.preset === 'custom' && (!RANGE.from || !RANGE.to)) return null;
  const from = new Date(b[0] + 'T12:00:00'), to = new Date(b[1] + 'T12:00:00');
  const days = Math.round((to - from) / 86400e3) + 1;
  const pTo = new Date(from); pTo.setDate(pTo.getDate() - 1);
  const pFrom = new Date(pTo); pFrom.setDate(pFrom.getDate() - (days - 1));
  return [localDateOf(pFrom), localDateOf(pTo)];
}
function previousRangeTrades() {
  const b = previousRangeBounds();
  return b ? TRADES.filter(t => t.status !== 'Open' && t.date >= b[0] && t.date <= b[1]) : null;
}
function rangeLabel() {
  const sel = document.getElementById('range-select');
  const preset = sel && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : 'All time';
  const b = rangeBounds();
  return RANGE.preset === 'all' ? 'All time' : RANGE.preset === 'custom' && b ? `${b[0]} → ${b[1]}` : preset;
}

RENDER_HOOKS.push(() => syncRangeControls());
