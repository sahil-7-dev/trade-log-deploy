// ═══════════════════════════════════════════════════════════════════════════
// P&L Calendar page: year activity heatmap, month grid, day detail and the
// daily P&L log. Keeps its own period (not the top-bar date range).
// ═══════════════════════════════════════════════════════════════════════════

registerPage('calendar', {
  title: 'P&L Calendar', subtitle: 'Every trading day at a glance', icon: '▦', section: 'Tools', order: 30,
  // re-renders after any data change also refresh an open day panel
  render: () => { renderYearActivity(); renderCalendar(); renderDayPanel(); renderDailyPnlLog(); },
});

let heatYear = new Date().getFullYear();
function renderYearActivity() {
  setText('cal-year-label', String(heatYear));
  renderYearHeat('year-heat', heatYear);
}
ACTIONS['cal-year-prev'] = () => { heatYear--; renderYearActivity(); };
ACTIONS['cal-year-next'] = () => { heatYear++; renderYearActivity(); };

function renderDailyPnlLog() {
  const body = document.getElementById('daily-pnl-body');
  if (!body) return;

  // Group all closed trades by date
  const dayMap = {};
  TRADES.filter(t => t.status !== 'Open').forEach(t => {
    if (!dayMap[t.date]) dayMap[t.date] = [];
    dayMap[t.date].push(t);
  });

  // Most recent first. Every day the calendar shows is listed (a date in the
  // future — usually a typo — is flagged, not silently dropped, so the
  // cumulative column always matches the calendar's totals).
  const today = localToday();
  const sortedDays = Object.keys(dayMap).sort((a, b) => b.localeCompare(a));

  if (sortedDays.length === 0) {
    body.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--muted)">No closed trades yet</td></tr>`;
    return;
  }

  // Compute cumulative running from oldest to newest, then reverse for display
  const ascending = [...sortedDays].reverse();
  let cumulative = 0;
  const cumulativeMap = {};
  ascending.forEach(d => {
    const dayPnl = dayMap[d].reduce((s, t) => s + t.pnl, 0);
    cumulative += dayPnl;
    cumulativeMap[d] = cumulative;
  });

  const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  body.innerHTML = sortedDays.map(d => {
    const trades = dayMap[d];
    const dayPnl = trades.reduce((s, t) => s + t.pnl, 0);
    const wins = trades.filter(t => t.status === 'Win').length;
    const losses = trades.filter(t => t.status === 'Loss').length;
    const cum = cumulativeMap[d];
    const dayName = DAYS[new Date(d + 'T00:00:00').getDay()];
    const isToday = d === today;

    return `<tr style="${isToday ? 'background:var(--surface2);' : ''}cursor:pointer" data-action="cal-goto-day" data-date="${d}">
      <td class="mono" style="color:var(--muted)">${d}${isToday ? ' <span style="color:var(--amber);font-size:9px">TODAY</span>' : ''}${d > today ? ' <span style="color:var(--amber);font-size:9px" data-tip="This trade is dated in the future — check its date">FUTURE DATE</span>' : ''}</td>
      <td style="color:var(--muted);font-size:11px">${dayName}</td>
      <td class="mono">${trades.length}</td>
      <td class="mono green">${wins > 0 ? wins + 'W' : '—'}</td>
      <td class="mono red">${losses > 0 ? losses + 'L' : '—'}</td>
      <td class="mono ${dayPnl > 0 ? 'green' : dayPnl < 0 ? 'red' : ''}"><span class="balance-val">${fmt(dayPnl)}</span></td>
      <td class="mono ${cum > 0 ? 'green' : cum < 0 ? 'red' : ''}"><span class="balance-val">${fmt(cum)}</span></td>
    </tr>`;
  }).join('');
}

// Navigate calendar to a specific date from daily log click
function calGotoDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  calYear = d.getFullYear();
  calMonth = d.getMonth();
  calSelectedDay = d.getDate();
  renderCalendar();
  renderDayPanel();
  // The page scrolls inside .content — bring the day's trades into view
  const panel = document.getElementById('cal-day-trades');
  (panel && panel.style.display !== 'none' ? panel : document.getElementById('cal-grid')).scrollIntoView({ behavior: 'smooth', block: 'center' });
}
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();
let calSelectedDay = null;

// Changing month clears the selected day — day 5 of March isn't day 5 of April
function calPrevMonth() {
  calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
  calSelectedDay = null;
  renderCalendar();
  renderDayPanel();
}
function calNextMonth() {
  calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
  calSelectedDay = null;
  renderCalendar();
  renderDayPanel();
}

function renderCalendarGrid() {
  const grid = document.getElementById('cal-grid');
  if (!grid) return;

  const dayMap = {};
  TRADES.filter(t => t.status !== 'Open').forEach(t => {
    // Parse as local date to avoid UTC timezone shift (IST = UTC+5:30)
    const parts = t.date.split('-');
    const year = parseInt(parts[0]), month = parseInt(parts[1]) - 1, day = parseInt(parts[2]);
    if (year === calYear && month === calMonth) {
      if (!dayMap[day]) dayMap[day] = [];
      dayMap[day].push(t);
    }
  });

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const maxAbs = Math.max(...Object.values(dayMap).map(ts => Math.abs(ts.reduce((s, t) => s + t.pnl, 0))), 1);

  let cells = '';
  for (let i = 0; i < firstDay; i++) cells += `<div style="height:72px;border-radius:6px"></div>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const trades = dayMap[d] || [];
    const dayPnl = trades.reduce((s, t) => s + t.pnl, 0);
    const hasTrades = trades.length > 0;
    // Use local date parts to avoid UTC shift for today check
    const now = new Date();
    const isToday = now.getDate() === d && now.getMonth() === calMonth && now.getFullYear() === calYear;
    const isSelected = calSelectedDay === d;
    const isFuture = new Date(calYear, calMonth, d) > now;

    let bg = isFuture ? 'transparent' : 'var(--faint)';
    let border = isToday ? 'var(--amber)' : isSelected ? 'var(--green)' : 'var(--border)';
    let pnlStr = '';

    if (hasTrades) {
      bg = divergingColor(dayPnl, maxAbs); // same validated loss ← neutral → profit scale as every heatmap

      // Smart formatting: use 0 decimals for large amounts, 2 for small
      let dispPnl;
      const absPnl = Math.abs(dayPnl);
      if (absPnl >= 10000) dispPnl = (dayPnl > 0 ? '+' : '-') + '$' + Math.round(absPnl / 1000) + 'k';
      else if (absPnl >= 1000) dispPnl = (dayPnl > 0 ? '+' : '-') + '$' + (Math.round(absPnl / 100) / 10) + 'k';
      else if (absPnl >= 1) dispPnl = fmt(dayPnl, 0);
      else dispPnl = fmt(dayPnl, 2); // small amounts like $0.11

      pnlStr = `<div class="cal-cell-pnl balance-val" style="color:#fff; font-size:${absPnl < 1 ? '9px' : '10px'}">${dispPnl}</div>
                <div class="cal-cell-trades" style="color:#fff;opacity:0.75">${trades.length}t</div>`;
    }

    cells += `<div class="cal-cell ${isSelected ? 'active-day' : ''}"
      style="background:${bg};border:1px solid ${border};opacity:${isFuture ? '0.3' : '1'}"
      data-action="cal-select-day" data-day="${d}">
      <div class="cal-cell-date" style="color:${isToday ? 'var(--amber)' : 'var(--muted)'};font-weight:${isToday ? '700' : '400'}">${d}</div>
      ${pnlStr}
    </div>`;
  }
  grid.innerHTML = cells;
}

function renderCalendar() {
  const label = document.getElementById('cal-month-label');
  if (label) label.textContent = new Date(calYear, calMonth).toLocaleString('default', { month: 'long', year: 'numeric' });

  // Build day→trades map for this month (parse as local date to avoid UTC shift)
  const dayMap = {};
  TRADES.filter(t => t.status !== 'Open').forEach(t => {
    const parts = t.date.split('-');
    const year = parseInt(parts[0]), month = parseInt(parts[1]) - 1, day = parseInt(parts[2]);
    if (year === calYear && month === calMonth) {
      if (!dayMap[day]) dayMap[day] = [];
      dayMap[day].push(t);
    }
  });

  // Month stats
  const allPnl = Object.values(dayMap).flat().reduce((s, t) => s + t.pnl, 0);
  const profitDays = Object.values(dayMap).filter(ts => ts.reduce((s, t) => s + t.pnl, 0) > 0).length;
  const lossDays = Object.values(dayMap).filter(ts => ts.reduce((s, t) => s + t.pnl, 0) < 0).length;
  const totalTrades = Object.values(dayMap).flat().length;

  const statsEl = document.getElementById('cal-stats-row');
  if (statsEl) statsEl.innerHTML = [
    { label: 'Month P&L', val: `<span class="balance-val">${fmt(allPnl)}</span>`, cls: allPnl >= 0 ? 'green' : 'red' },
    { label: 'Profit Days', val: profitDays, cls: 'green' },
    { label: 'Loss Days', val: lossDays, cls: 'red' },
    { label: 'Total Trades', val: totalTrades, cls: '' },
  ].map(s => `<div class="cal-stat"><div class="cal-stat-label">${s.label}</div><div class="cal-stat-val ${s.cls}">${s.val}</div></div>`).join('');

  renderCalendarGrid();
}

// Clicking a day toggles it open/closed
function calSelectDay(d) {
  calSelectedDay = calSelectedDay === d ? null : d;
  renderCalendarGrid();
  renderDayPanel();
}

// The selected day's trades — exactly the ones its cell counts: trades that
// CLOSED that day (same as the cell, month stats and daily log). Partial
// closes made that day are noted separately: they count on the day the
// trade fully closes.
function renderDayPanel() {
  const panel = document.getElementById('cal-day-trades');
  const title = document.getElementById('cal-day-title');
  const body = document.getElementById('cal-day-body');
  if (!panel) return;
  if (!calSelectedDay) { panel.style.display = 'none'; return; }

  const key = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(calSelectedDay).padStart(2, '0')}`;
  const dayTrades = chronological(TRADES.filter(t => t.status !== 'Open' && t.date === key));
  const partials = TRADES.filter(t => t.status === 'Open').flatMap(t => t.closes.filter(f => f.date === key).map(f => ({ t, f })));
  if (!dayTrades.length && !partials.length) { panel.style.display = 'none'; return; }

  const dateStr = new Date(calYear, calMonth, calSelectedDay).toLocaleDateString('default', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const dayPnl = dayTrades.reduce((s, t) => s + t.pnl, 0);
  title.innerHTML = `${dateStr} &nbsp;<span class="balance-val" style="font-family:var(--mono);font-size:11px;color:${dayPnl >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt(dayPnl)}</span> <span class="chart-sub">${dayTrades.length} closed</span>`;

  const partialNote = partials.length ? `<tr><td colspan="7" style="color:var(--muted);font-size:11px;white-space:normal">
    Also partly closed this day: ${partials.map(({ t, f }) => `${esc(t.symbol)} ${fmt((parseFloat(f.pnl) || 0) - (parseFloat(f.fee) || 0))}`).join(', ')} —
    counted on the day those trades fully close.</td></tr>` : '';
  body.innerHTML = dayTrades.map(t => `<tr>
    <td style="font-weight:600">${esc(t.symbol)}</td>
    <td><span class="badge ${t.dir === 'Long' ? 'badge-long' : 'badge-short'}">${esc(t.dir)}</span></td>
    <td class="mono">${fmtPx(t.entry)}</td>
    <td class="mono">${t.exit != null ? fmtPx(t.exit) : '—'}</td>
    <td class="mono ${t.pnl > 0 ? 'green' : t.pnl < 0 ? 'red' : ''}"><span class="balance-val">${fmt(t.pnl)}</span></td>
    <td class="mono">${t.rr != null ? t.rr.toFixed(2) + 'R' : '—'}</td>
    <td><span class="badge ${t.status === 'Win' ? 'badge-win' : t.status === 'Loss' ? 'badge-loss' : t.status === 'Breakeven' ? 'badge-breakeven' : 'badge-open'}">${esc(t.status)}</span></td>
  </tr>`).join('') + partialNote;
  panel.style.display = 'block';
}

