// ═══════════════════════════════════════════════════════════════════════════
// Chart engine: one theme for every chart (Chart.js), builders for the chart
// forms the app uses, and per-page chart ownership so only the visible page's
// charts are drawn (and destroyed when that page re-renders).
// Mark specs follow the dataviz rules: hairline grid, ≤24px bars with a 4px
// rounded data end, 2px lines, area = 10% wash, value-first tooltips, a
// legend only for 2+ series, a table view on every chart card.
// ═══════════════════════════════════════════════════════════════════════════

const MONTHLY_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ─── Theme ───────────────────────────────────────────────────────────────────
(function applyChartTheme() {
  if (!window.Chart) return;
  const d = Chart.defaults;
  d.color = CHART.muted;
  d.font.family = "'JetBrains Mono', ui-monospace, monospace";
  d.font.size = 10;
  d.borderColor = CHART.grid;
  d.maintainAspectRatio = false;
  d.animation.duration = 450;
  d.plugins.legend.display = false;
  Object.assign(d.plugins.tooltip, {
    backgroundColor: '#0b0d12', borderColor: '#2a2f40', borderWidth: 1, padding: 10, cornerRadius: 8,
    titleColor: CHART.muted, titleFont: { weight: '500', size: 10 },
    bodyColor: '#e8eaf0', bodyFont: { weight: '600', size: 11 }, boxPadding: 4, usePointStyle: true,
  });
  d.plugins.legend.labels.usePointStyle = true;
  d.plugins.legend.labels.boxWidth = 10;
  d.plugins.legend.labels.color = CHART.text;
  d.elements.line.borderWidth = 2;
  d.elements.line.tension = 0.3;
  d.elements.line.cubicInterpolationMode = 'monotone'; // smooth, but never overshoots the data
  d.elements.line.borderCapStyle = 'round';
  d.elements.line.borderJoinStyle = 'round';
  d.elements.point.radius = 0;
  d.elements.point.hoverRadius = 4;
  d.elements.point.hitRadius = 12;
  d.elements.point.borderWidth = 2;
  d.elements.point.borderColor = CHART.surface; // 2px surface ring
  d.elements.bar.borderRadius = 4;
  d.elements.bar.borderSkipped = 'start';       // square at the baseline, rounded data end
  d.datasets.bar.maxBarThickness = 24;
  d.datasets.bar.categoryPercentage = 0.8;
  d.scale.grid.color = CHART.grid;
  d.scale.grid.tickColor = 'transparent';
  d.scale.border.color = CHART.axis;
  d.scale.ticks.color = CHART.muted;
  d.scale.ticks.maxTicksLimit = 8;

  // Crosshair: a vertical hairline at the hovered X on line charts
  Chart.register({
    id: 'crosshair',
    afterDraw(chart) {
      const opts = chart.options.plugins.crosshair;
      const active = chart.tooltip && chart.tooltip.getActiveElements();
      if (!opts || !active || !active.length) return;
      const x = active[0].element.x, { top, bottom } = chart.chartArea, ctx = chart.ctx;
      ctx.save();
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom);
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(185,188,203,0.35)'; ctx.stroke();
      ctx.restore();
    },
  });
})();

// ─── Formatting for axes & tooltips ──────────────────────────────────────────
function fmtCompact(v) {
  const abs = Math.abs(v), sign = v < 0 ? '-' : '';
  const k = currency === 'INR' ? abs * USD_INR : abs;
  const sym = currency === 'INR' ? '₹' : '$';
  if (k >= 1e6) return `${sign}${sym}${(k / 1e6).toFixed(1)}M`;
  // enough decimals that neighbouring axis ticks never print the same label
  if (k >= 1e3) return `${sign}${sym}${parseFloat((k / 1e3).toFixed(k >= 1e5 ? 0 : k >= 1e4 ? 1 : 2))}K`;
  return `${sign}${sym}${k.toFixed(k < 10 ? 2 : 0)}`;
}
const moneyAxis = { ticks: { callback: v => fmtCompact(v) } };
const pctAxis = { ticks: { callback: v => v + '%' } };

// ─── Ownership: which page's render created which chart ─────────────────────
let renderingPage = null;          // set by the router while a page renders
const PAGE_CHARTS = {};            // pageId → [canvasId]

function destroyChart(id) {
  if (chartInstances[id]) { try { chartInstances[id].destroy(); } catch (e) { /* already gone */ } delete chartInstances[id]; }
}
function destroyPageCharts(pageId) {
  (PAGE_CHARTS[pageId] || []).forEach(destroyChart);
  PAGE_CHARTS[pageId] = [];
}
// Back-compat: destroy everything
function destroyCharts() { Object.keys(chartInstances).forEach(destroyChart); }

// Create (or replace) the chart on canvas #id. emptyText shows an overlay
// instead when there's nothing to plot.
function makeChart(id, config, { empty = false, emptyText = 'No data in this period yet' } = {}) {
  const canvas = document.getElementById(id);
  if (!canvas || !window.Chart) return null;
  destroyChart(id);
  const wrap = canvas.parentElement;
  let overlay = wrap.querySelector('.chart-empty');
  if (empty) {
    if (!overlay) { overlay = document.createElement('div'); overlay.className = 'chart-empty'; wrap.appendChild(overlay); }
    overlay.textContent = emptyText;
  } else if (overlay) overlay.remove();
  const chart = new Chart(canvas, config);
  chartInstances[id] = chart;
  // Owned by the page rendering it — or, for charts redrawn by a control on
  // the page (e.g. the yearly recap's year picker), the page on screen.
  const owner = renderingPage || (typeof activePage !== 'undefined' ? activePage : null);
  if (owner) (PAGE_CHARTS[owner] = PAGE_CHARTS[owner] || []).push(id);
  return chart;
}

const deepMerge = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof v !== 'function' && a[k] && typeof a[k] === 'object' ? deepMerge(a[k], v) : v;
  }
  return out;
};

function valueTooltip(format) {
  return { callbacks: { label: c => `${format(c.parsed.y ?? c.parsed)}${c.dataset.label ? '  ' + c.dataset.label : ''}` } };
}

// ─── Builders ────────────────────────────────────────────────────────────────
// Line / area over time. series: [{ label, data, color, fill, dashed }]
function lineChart(id, labels, series, { format = fmt, yAxis = moneyAxis, opts = {}, empty, emptyText } = {}) {
  const multi = series.length > 1;
  return makeChart(id, {
    type: 'line',
    data: {
      labels,
      datasets: series.map(s => ({
        label: s.label, data: s.data, borderColor: s.color, backgroundColor: hexA(s.color, 0.1),
        fill: s.fill ? 'origin' : false, borderDash: s.dashed ? [5, 4] : undefined,
        pointBackgroundColor: s.color, pointRadius: s.points ? 3 : 0, spanGaps: true, tableHidden: s.tableHidden,
        showLine: s.showLine !== false, pointStyle: s.pointStyle, rotation: s.rotation, stepped: s.stepped || false,
      })),
    },
    options: deepMerge({
      interaction: { mode: 'index', intersect: false },
      plugins: {
        crosshair: true,
        legend: { display: multi, position: 'bottom', labels: { pointStyle: 'line' } },
        tooltip: valueTooltip(format),
      },
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 18 } }, y: yAxis },
    }, opts),
  }, { empty: empty ?? !labels.length, emptyText });
}

// Bars. polarity: color each bar by sign (profit/loss). colors: per-bar list.
function barChart(id, labels, data, { polarity = false, color = CHART.series[0], colors, horizontal = false, format = fmt, axis = moneyAxis, label = '', opts = {}, empty } = {}) {
  const bg = colors || (polarity ? data.map(v => v >= 0 ? CHART.profit : CHART.loss) : color);
  const valueScale = horizontal ? 'x' : 'y', catScale = horizontal ? 'y' : 'x';
  return makeChart(id, {
    type: 'bar',
    data: { labels, datasets: [{ label, data, backgroundColor: bg, hoverBackgroundColor: bg }] },
    options: deepMerge({
      indexAxis: horizontal ? 'y' : 'x',
      plugins: { tooltip: { callbacks: { label: c => format(horizontal ? c.parsed.x : c.parsed.y) } } },
      scales: {
        [catScale]: { grid: { display: false }, ticks: { autoSkip: !horizontal, maxRotation: 0 } },
        [valueScale]: deepMerge({ grid: { color: CHART.grid } }, axis),
      },
    }, opts),
  }, { empty: empty ?? !data.some(v => v) });
}

// Grouped/stacked bars with 2+ named series: [{label, data, color}]
function multiBarChart(id, labels, series, { stacked = false, format = fmt, axis = moneyAxis, opts = {}, empty } = {}) {
  return makeChart(id, {
    type: 'bar',
    data: { labels, datasets: series.map(s => ({ label: s.label, data: s.data, backgroundColor: s.color, borderSkipped: stacked ? false : 'start' })) },
    options: deepMerge({
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: true, position: 'bottom', labels: { pointStyle: 'rect' } }, tooltip: valueTooltip(format) },
      scales: { x: { stacked, grid: { display: false }, ticks: { maxRotation: 0 } }, y: deepMerge({ stacked }, axis) },
    }, opts),
  }, { empty: empty ?? !series.some(s => s.data.some(v => v)) });
}

// Doughnut for part-to-whole (≤ 6 parts + Other). parts: [{label, value, color}]
function donutChart(id, parts, { format = fmtMoney, empty } = {}) {
  const total = sum(parts, p => p.value);
  return makeChart(id, {
    type: 'doughnut',
    data: { labels: parts.map(p => p.label), datasets: [{ data: parts.map(p => round2(p.value)), backgroundColor: parts.map(p => p.color), borderColor: CHART.surface, borderWidth: 2, hoverOffset: 6 }] },
    options: {
      cutout: '68%',
      plugins: {
        legend: { display: true, position: 'right', labels: { pointStyle: 'rect' } },
        tooltip: { callbacks: { label: c => `${format(c.parsed)}  ${c.label} · ${total ? (c.parsed / total * 100).toFixed(1) : 0}%` } },
      },
    },
  }, { empty: empty ?? !total });
}

// Scatter: datasets [{label, data:[{x,y,meta}], color}]
function scatterChart(id, datasets, { xFormat = v => v, yFormat = fmt, xTitle = '', yAxis = moneyAxis, opts = {}, empty } = {}) {
  return makeChart(id, {
    type: 'scatter',
    data: { datasets: datasets.map(d => ({ label: d.label, data: d.data, backgroundColor: hexA(d.color, 0.85), pointRadius: 5, pointHoverRadius: 7, pointBorderColor: CHART.surface, pointBorderWidth: 2 })) },
    options: deepMerge({
      plugins: {
        legend: { display: datasets.length > 1, position: 'bottom', labels: { pointStyle: 'circle' } },
        tooltip: { callbacks: { label: c => `${yFormat(c.parsed.y)} · ${xFormat(c.parsed.x)}${c.raw.meta ? '  ' + c.raw.meta : ''}` } },
      },
      scales: { x: { title: { display: !!xTitle, text: xTitle, color: CHART.muted }, ticks: { callback: v => xFormat(v) } }, y: yAxis },
    }, opts),
  }, { empty: empty ?? !datasets.some(d => d.data.length) });
}

// Bridge (waterfall): a starting total, signed steps, and the resulting total.
// steps: [{ label, value, kind: 'total' | 'step' }] — totals stand on zero,
// steps float from where the previous bar ended (profit / loss colored).
function bridgeChart(id, steps, { format = fmt, empty } = {}) {
  let level = 0;
  const bars = steps.map(s => {
    if (s.kind === 'total') { level = s.value; return [0, round2(s.value)]; }
    const from = level; level += s.value;
    return [round2(from), round2(level)];
  });
  const colors = steps.map(s => s.kind === 'total' ? CHART.series[0] : s.value >= 0 ? CHART.profit : CHART.loss);
  return makeChart(id, {
    type: 'bar',
    data: { labels: steps.map(s => s.label), datasets: [{ label: '', data: bars, backgroundColor: colors, borderSkipped: false, tableHidden: true, minBarLength: 4 },
      // invisible twin so the table view lists the signed step values
      { label: 'Amount', data: steps.map(s => round2(s.value)), hidden: true }] },
    options: {
      plugins: { tooltip: { filter: c => c.datasetIndex === 0, callbacks: { label: c => {
        const s = steps[c.dataIndex];
        return s.kind === 'total' ? fmtMoney(s.value) : `${format(s.value)}  change`;
      } } } },
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: false } }, y: moneyAxis },
    },
  }, { empty: empty ?? !steps.some(s => s.value) });
}

// Counts per bin. edges: ascending bin boundaries; values below/above fall
// into the first/last bin. Returns { labels, counts }.
function histogram(values, edges, labelFn) {
  const counts = Array(edges.length + 1).fill(0);
  values.forEach(v => {
    let i = edges.findIndex(e => v < e);
    if (i === -1) i = edges.length;
    counts[i]++;
  });
  const labels = counts.map((_, i) => labelFn(i === 0 ? null : edges[i - 1], i === edges.length ? null : edges[i]));
  return { labels, counts };
}

function hexA(hex, a) {
  if (!hex || hex[0] !== '#') return hex;
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// ─── Monthly heatmap (12 cells) ──────────────────────────────────────────────
function getMonthlyPnl(year) {
  const y = year || new Date().getFullYear();
  const monthly = Array(12).fill(0);
  const hasData = Array(12).fill(false);
  TRADES.filter(t => t.status !== 'Open' && parseInt(t.date.split('-')[0], 10) === y).forEach(t => {
    const m = parseInt(t.date.split('-')[1], 10) - 1; // local month, no UTC shift
    monthly[m] += t.pnl;
    hasData[m] = true;
  });
  return monthly.map((v, i) => hasData[i] ? v : null);
}

// Adaptive precision so small accounts (cents-level P&L) don't get rounded to
// an indistinguishable "0" — and explicitly signs the value so a small loss
// like -0.02 never collapses into JS's "-0 stringifies as 0" quirk.
function fmtHeatmapVal(v) {
  const abs = Math.abs(v);
  const sign = v > 0 ? '+' : v < 0 ? '-' : '';
  if (abs === 0) return '0';
  if (abs >= 1000) return sign + (Math.round(abs / 100) / 10) + 'k';
  if (abs < 10) return sign + abs.toFixed(2);
  return sign + Math.round(abs);
}

function renderHeatmapInto(gridId, year) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  const pnlData = getMonthlyPnl(year);
  const maxAbs = Math.max(...pnlData.filter(v => v !== null).map(v => Math.abs(v)), 1);
  grid.innerHTML = pnlData.map((v, i) => {
    if (v === null) return `<div class="heatmap-cell" style="background:var(--chart-neutral);color:var(--muted)" data-tip="${MONTHLY_LABELS[i]} ${year}: no closed trades">–</div>`;
    const bg = divergingColor(v, maxAbs);
    return `<div class="heatmap-cell" style="background:${bg};color:#fff" data-tip="${MONTHLY_LABELS[i]} ${year}: ${fmt(v)}" tabindex="0">${fmtHeatmapVal(v)}</div>`;
  }).join('');
}

function renderHeatmap() {
  const y = new Date().getFullYear();
  const label = document.getElementById('heatmap-year-label');
  if (label) label.textContent = '— ' + y;
  renderHeatmapInto('heatmap', y);
}

// ─── Year activity heatmap (GitHub-style, one cell per day) ──────────────────
function renderYearHeat(containerId, year) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const byDay = new Map();
  TRADES.filter(t => t.status !== 'Open' && t.date.startsWith(String(year))).forEach(t => {
    const d = byDay.get(t.date) || { pnl: 0, n: 0 };
    d.pnl += t.pnl; d.n++;
    byDay.set(t.date, d);
  });
  const maxAbs = Math.max(...[...byDay.values()].map(d => Math.abs(d.pnl)), 1);
  const start = new Date(year, 0, 1);
  const lead = (start.getDay() + 6) % 7; // weeks start Monday
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<div class="year-cell empty"></div>');
  const months = [];
  for (let d = new Date(start); d.getFullYear() === year; d.setDate(d.getDate() + 1)) {
    const key = localDateOf(d);
    const info = byDay.get(key);
    if (d.getDate() === 1) months.push({ m: d.getMonth(), col: Math.floor((cells.length) / 7) });
    cells.push(info
      ? `<div class="year-cell" style="background:${divergingColor(info.pnl, maxAbs)}" data-tip="${key}\n${fmt(info.pnl)} · ${info.n} trade${info.n !== 1 ? 's' : ''}" tabindex="0"></div>`
      : `<div class="year-cell" data-tip="${key}: no closed trades"></div>`);
  }
  const monthRow = months.map((m, i) => {
    const next = months[i + 1] ? months[i + 1].col : Math.ceil(cells.length / 7);
    return `<span style="width:${(next - m.col) * 15}px">${MONTHLY_LABELS[m.m]}</span>`;
  }).join('');
  el.innerHTML = `<div class="year-heat-months">${monthRow}</div>
    <div class="year-heat">
      <div class="year-heat-days"><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span><span>Sun</span></div>
      <div class="year-heat-grid">${cells.join('')}</div>
    </div>`;
}
