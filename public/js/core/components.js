// ═══════════════════════════════════════════════════════════════════════════
// UI component builders. Each returns an HTML string (or wires behaviour) so
// pages compose them instead of hand-writing markup. Anything that renders
// user text goes through esc().
// ═══════════════════════════════════════════════════════════════════════════

const CHART = {
  profit: '#12ad86',
  loss: '#b82e46',
  in: '#3987e5',
  out: '#d95926',
  neutral: '#262a36',
  grid: '#1a1e2a',
  axis: '#2a2f40',
  muted: '#8b8fa8',
  text: '#b9bccb',
  surface: '#101218',
  // Categorical, fixed order — never cycled (fold extras into "Other")
  series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
  other: '#5b6070',
};

// ─── Sparkline (inline SVG, no chart library) ────────────────────────────────
// values: numbers in time order. Polarity colors the line by the last value
// vs the first unless a color is given.
function sparkline(values, { color, height = 28, fill = true, zero = false, polarity = false } = {}) {
  const pts = (values || []).filter(v => Number.isFinite(v));
  if (pts.length < 2) return '';
  const w = 100, h = height, pad = 3;
  const min = Math.min(...pts, zero ? 0 : Infinity), max = Math.max(...pts, zero ? 0 : -Infinity);
  const span = max - min || 1;
  const x = i => (i / (pts.length - 1)) * w;
  const y = v => pad + (1 - (v - min) / span) * (h - pad * 2);
  // A running metric isn't good/bad by direction — neutral unless it's P&L
  const c = color || (polarity ? (pts[pts.length - 1] >= 0 ? CHART.profit : CHART.loss) : CHART.series[0]);
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join('');
  const area = fill ? `<path d="${d}L${w},${h}L0,${h}Z" fill="${c}" opacity="0.1"/>` : '';
  const zeroLine = zero && min < 0 && max > 0 ? `<line x1="0" x2="${w}" y1="${y(0)}" y2="${y(0)}" stroke="${CHART.axis}" stroke-width="1" vector-effect="non-scaling-stroke"/>` : '';
  const last = pts.length - 1;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${zeroLine}${area}
    <path d="${d}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <circle cx="${x(last)}" cy="${y(pts[last])}" r="2.5" fill="${c}" stroke="${CHART.surface}" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
}

// ─── Change vs previous period ───────────────────────────────────────────────
// goodUp: is an increase good? (P&L yes; drawdown no)
function deltaBadge(cur, prev, { goodUp = true, format = v => fmt(v), pct = false } = {}) {
  if (prev == null || cur == null || !Number.isFinite(cur) || !Number.isFinite(prev)) return '';
  const diff = cur - prev;
  if (Math.abs(diff) < 0.005) return `<span class="delta flat" data-tip="Same as the previous period">— 0</span>`;
  const up = diff > 0;
  const good = up === goodUp;
  const label = pct ? `${up ? '+' : ''}${diff.toFixed(1)} pts` : format(diff);
  return `<span class="delta ${good ? 'up' : 'down'}" data-tip="vs previous period: ${esc(pct ? prev.toFixed(1) + '%' : format(prev))}">${up ? '▲' : '▼'} ${label}</span>`;
}

// ─── Stat tile ───────────────────────────────────────────────────────────────
// { label, value, sub, cls, delta, spark (array), sparkColor, tip, id }
function statTile(o) {
  return `<div class="stat-card"${o.id ? ` id="${o.id}"` : ''}>
    <div class="stat-label">${o.label}${o.tip ? ` <span class="muted" data-tip="${esc(o.tip)}" tabindex="0">ⓘ</span>` : ''}</div>
    <div class="stat-val ${o.cls || ''}">${o.value}</div>
    <div class="stat-sub">${o.delta ? o.delta + ' ' : ''}${o.sub || ''}</div>
    ${o.spark && o.spark.length > 1 ? `<div class="stat-spark">${sparkline(o.spark, { color: o.sparkColor, zero: o.sparkZero })}</div>` : ''}
  </div>`;
}

function meter({ label, valueText, pct, cls = 'pos', sub = '' }) {
  return `<div class="meter">
    <div class="meter-head"><span>${label}</span><span class="num">${valueText}</span></div>
    <div class="bar-track" style="height:8px"><div class="bar-fill ${cls}" style="width:${Math.max(0, Math.min(100, pct || 0))}%"></div></div>
    ${sub ? `<div class="goal-sub">${sub}</div>` : ''}
  </div>`;
}

function emptyState(icon, title, text, actionHtml = '') {
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><h3>${title}</h3><p>${text}</p>${actionHtml}</div>`;
}

// Composition bar with legend: parts = [{label, value, color}]
// format: how to show each value in the legend (default: a count)
function compositionBar(parts, { format = v => v } = {}) {
  const total = sum(parts, p => p.value);
  if (!total) return '<div class="comp-bar"></div>';
  return `<div class="comp-bar" role="img" aria-label="${esc(parts.map(p => `${p.label} ${p.value}`).join(', '))}">
    ${parts.filter(p => p.value > 0).map(p => `<span style="flex:${p.value};background:${p.color}" data-tip="${esc(p.label)}: ${format(p.value)} (${(p.value / total * 100).toFixed(0)}%)"></span>`).join('')}
  </div>
  <div class="comp-legend">${parts.map(p => `<span><span class="key" style="background:${p.color}"></span>${esc(p.label)} <strong class="num">${format(p.value)}</strong> <span class="muted">${(p.value / total * 100).toFixed(0)}%</span></span>`).join('')}</div>`;
}

// ─── Diverging color for P&L heat cells: loss ← neutral → profit ────────────
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`;
}
function divergingColor(value, maxAbs) {
  if (!value || !maxAbs) return CHART.neutral;
  const t = Math.min(1, Math.sqrt(Math.abs(value) / maxAbs)); // sqrt: small days stay visible
  return mixHex(CHART.neutral, value > 0 ? CHART.profit : CHART.loss, 0.25 + 0.75 * t);
}

// ─── Floating tooltip for any element with data-tip ──────────────────────────
// textContent only — tips can contain trade symbols/notes.
(function setupTooltip() {
  let tip = null;
  const show = (el) => {
    if (!tip) { tip = document.createElement('div'); tip.id = 'ui-tooltip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip); }
    tip.textContent = el.getAttribute('data-tip');
    tip.classList.add('show');
    const r = el.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = r.left + r.width / 2 - tw / 2;
    let top = r.top - th - 8;
    if (top < 6) top = r.bottom + 8;
    left = Math.max(6, Math.min(left, window.innerWidth - tw - 6));
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  };
  const hide = () => tip && tip.classList.remove('show');
  document.addEventListener('mouseover', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) show(el); });
  document.addEventListener('mouseout', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el && !el.contains(e.relatedTarget)) hide(); });
  document.addEventListener('focusin', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) show(el); });
  document.addEventListener('focusout', hide);
  document.addEventListener('scroll', hide, true);
})();

// ─── Chart ⇄ table toggle (every chart card can show its data as a table) ────
ACTIONS['toggle-chart-table'] = (el) => {
  const card = el.closest('.chart-card');
  if (!card) return;
  const canvas = card.querySelector('canvas');
  const chart = canvas && chartInstances[canvas.id];
  let box = card.querySelector('.chart-table');
  if (!box) { box = document.createElement('div'); box.className = 'chart-table'; card.appendChild(box); }
  const showing = card.classList.toggle('show-table');
  el.textContent = showing ? '◫ Chart' : '⊞ Table';
  el.setAttribute('aria-pressed', String(showing));
  if (showing && chart) box.innerHTML = chartDataTable(chart);
};

// Generic table from a Chart.js chart's data (labels × datasets)
function chartDataTable(chart) {
  const labels = chart.data.labels || [];
  const sets = chart.data.datasets.filter(d => !d.tableHidden);
  const cell = v => v == null ? '—' : typeof v === 'object' ? (v.y != null ? `${v.x} → ${v.y}` : JSON.stringify(v)) : (typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : esc(String(v)));
  if (chart.config.type === 'scatter') {
    const rows = sets.flatMap(ds => ds.data.map(p => `<tr><td>${esc(ds.label || '')}</td><td class="num">${cell(p.x)}</td><td class="num">${cell(p.y)}</td></tr>`));
    return `<table><thead><tr><th>Series</th><th>X</th><th>Y</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }
  return `<table><thead><tr><th></th>${sets.map(d => `<th>${esc(d.label || 'Value')}</th>`).join('')}</tr></thead><tbody>
    ${labels.map((l, i) => `<tr><td>${esc(String(l))}</td>${sets.map(d => `<td class="num">${cell(d.data[i])}</td>`).join('')}</tr>`).join('')}
  </tbody></table>`;
}

// Standard chart-card header tools: optional meta text + table toggle
function chartTools(meta = '') {
  return `<div class="chart-tools">${meta ? `<span class="chart-meta">${meta}</span>` : ''}<button class="filter-btn chart-toggle" data-action="toggle-chart-table" aria-pressed="false">⊞ Table</button></div>`;
}

// ─── Dropdown menus: <div class="menu-wrap"><button data-action="toggle-menu"> + .menu
ACTIONS['toggle-menu'] = (el, e) => {
  const menu = el.parentElement.querySelector('.menu');
  const open = !menu.classList.contains('open');
  document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open'));
  if (open) menu.classList.add('open');
  e.stopPropagation();
};
document.addEventListener('click', e => {
  if (!e.target.closest('.menu-wrap')) document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open'));
  else if (e.target.closest('.menu-item')) document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open'));
});

// In-page anchor links (settings section nav) without changing the route
ACTIONS['scroll-to'] = (el, e) => {
  e.preventDefault();
  const target = document.getElementById(el.dataset.target);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
