// ═══════════════════════════════════════════════════════════════════════════
// Query Builder page: filter trades by conditions, with the equivalent SQL.
// ═══════════════════════════════════════════════════════════════════════════

registerPage('query', {
  title: 'Query Builder', subtitle: 'Filter trades with conditions', icon: '⌖', section: 'Tools', order: 32,
  // after trades change, refresh results that are already on screen
  render: () => { if (document.getElementById('query-results')?.style.display === 'block') runQuery(); },
});

const FIELDS = [
  { key: 'rr',     label: 'RR Achieved',  type: 'number', ops: ['>', '<', '>=', '<=', '='] },
  { key: 'pnl',    label: 'P&L ($)',       type: 'number', ops: ['>', '<', '>=', '<=', '='] },
  { key: 'size',   label: 'Position Size', type: 'number', ops: ['>', '<', '>=', '<=', '='] },
  { key: 'status', label: 'Status',        type: 'select', opts: ['Win', 'Loss', 'Breakeven', 'Open'], ops: ['=', '!='] },
  { key: 'type',   label: 'Asset Type',    type: 'select', opts: ['Crypto', 'Forex', 'Stocks'], ops: ['=', '!='] },
  { key: 'dir',    label: 'Direction',     type: 'select', opts: ['Long', 'Short'], ops: ['=', '!='] },
  { key: 'symbol', label: 'Symbol',        type: 'text',   ops: ['=', 'contains'] },
  { key: 'date',   label: 'Date',          type: 'date',   ops: ['>', '<', '>=', '<=', '='] },
  { key: 'entry',  label: 'Entry Price',   type: 'number', ops: ['>', '<', '>=', '<=', '='] },
];

const PRESETS = [
  { label: 'RR > 2',             conds: [{ field: 'rr',     op: '>',  val: '2' }] },
  { label: 'All Wins',           conds: [{ field: 'status', op: '=',  val: 'Win' }] },
  { label: 'All Losses',         conds: [{ field: 'status', op: '=',  val: 'Loss' }] },
  { label: 'Crypto only',        conds: [{ field: 'type',   op: '=',  val: 'Crypto' }] },
  { label: 'Forex only',         conds: [{ field: 'type',   op: '=',  val: 'Forex' }] },
  { label: 'Longs > $1000',      conds: [{ field: 'dir',    op: '=',  val: 'Long' }, { field: 'size', op: '>', val: '1000' }] },
  { label: 'P&L > $200',         conds: [{ field: 'pnl',    op: '>',  val: '200' }] },
  { label: 'Crypto Wins RR>1.5', conds: [{ field: 'type',   op: '=',  val: 'Crypto' }, { field: 'status', op: '=', val: 'Win' }, { field: 'rr', op: '>', val: '1.5' }] },
  { label: 'Open Positions',     conds: [{ field: 'status', op: '=',  val: 'Open' }] },
  { label: 'Losses > -$100',     conds: [{ field: 'pnl',    op: '<',  val: '-100' }] },
];

let conditions = [];
let condId = 0;

function addCondition(prefill = {}) {
  const id = condId++;
  conditions.push({ id, field: prefill.field || 'rr', op: prefill.op || '>', val: prefill.val || '' });
  renderConditions();
}

function removeCondition(id) {
  conditions = conditions.filter(c => c.id !== id);
  renderConditions();
}

function renderConditions() {
  const wrap = document.getElementById('conditions-wrap');
  if (!wrap) return;
  if (conditions.length === 0) {
    wrap.innerHTML = `<div style="text-align:center;padding:20px;color:var(--muted);font-size:12px">No filters — click "+ Add Filter" or choose a Quick Filter above</div>`;
    return;
  }
  wrap.innerHTML = conditions.map((c, idx) => {
    const field = FIELDS.find(f => f.key === c.field) || FIELDS[0];
    const opsHtml = field.ops.map(o => `<option value="${o}" ${c.op === o ? 'selected' : ''}>${o}</option>`).join('');
    const fieldHtml = FIELDS.map(f => `<option value="${f.key}" ${c.field === f.key ? 'selected' : ''}>${f.label}</option>`).join('');
    let valHtml;
    if (field.type === 'select') {
      valHtml = `<select data-action="update-cond" data-cond-id="${c.id}" data-cond-field="val">${field.opts.map(o => `<option value="${o}" ${c.val === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
    } else if (field.type === 'date') {
      valHtml = `<input type="date" value="${esc(c.val)}" data-action="update-cond" data-cond-id="${c.id}" data-cond-field="val" style="width:140px">`;
    } else {
      valHtml = `<input type="${field.type === 'number' ? 'number' : 'text'}" value="${esc(c.val)}" placeholder="value" data-action="update-cond" data-cond-id="${c.id}" data-cond-field="val" style="width:100px">`;
    }
    return `<div class="condition-row">
      ${idx > 0 ? `<span class="logic-badge">AND</span>` : '<span style="font-family:var(--mono);font-size:9px;color:var(--muted);min-width:32px">WHERE</span>'}
      <select data-action="update-cond" data-cond-id="${c.id}" data-cond-field="field">${fieldHtml}</select>
      <select data-action="update-cond" data-cond-id="${c.id}" data-cond-field="op">${opsHtml}</select>
      ${valHtml}
      <button class="remove-cond" data-action="remove-condition" data-cond-id="${c.id}">✕</button>
    </div>`;
  }).join('');
}

function updateCond(id, key, val) {
  const c = conditions.find(c => c.id === id);
  if (!c) return;
  c[key] = val;
  if (key === 'field') {
    const field = FIELDS.find(f => f.key === val);
    c.op = field.ops[0];
    c.val = field.type === 'select' ? field.opts[0] : '';
  }
  renderConditions();
}

function loadPreset(preset) {
  conditions = []; condId = 0;
  preset.conds.forEach(c => addCondition(c));
}

function runQuery() {
  const sortField = document.getElementById('q-sort-field').value;
  const sortDir = document.getElementById('q-sort-dir').value;

  let results = TRADES.filter(t => {
    return conditions.every(c => {
      let tv = t[c.field];
      let cv = c.val;
      if (['pnl', 'rr', 'size', 'entry'].includes(c.field)) {
        // an open trade has no P&L or R yet — it never matches a P&L/R condition
        if ((c.field === 'pnl' || c.field === 'rr') && t.status === 'Open') return false;
        tv = parseFloat(tv); cv = parseFloat(cv);
        if (isNaN(tv)) return false;
        // to the cent, so 12.340000000000002 "= 12.34"
        if (c.op === '=') return Math.abs(tv - cv) < 0.005;
      }
      if (c.op === '>') return tv > cv;
      if (c.op === '<') return tv < cv;
      if (c.op === '>=') return tv >= cv;
      if (c.op === '<=') return tv <= cv;
      if (c.op === '=') return String(tv).toLowerCase() === String(cv).toLowerCase();
      if (c.op === '!=') return String(tv).toLowerCase() !== String(cv).toLowerCase();
      if (c.op === 'contains') return String(tv || '').toLowerCase().includes(String(cv).toLowerCase());
      return true;
    });
  });

  results.sort((a, b) => {
    // dates compare as text (parseFloat('2026-10-25') is just 2026), by close time within a day
    const diff = sortField === 'date'
      ? closeSortKey(a).localeCompare(closeSortKey(b))
      : (parseFloat(a[sortField]) || 0) - (parseFloat(b[sortField]) || 0);
    return sortDir === 'desc' ? -diff : diff;
  });

  const whereClause = conditions.map(c => {
    const f = FIELDS.find(f => f.key === c.field);
    const val = (f.type === 'text' || f.type === 'select') ? `'${c.val}'` : c.val;
    if (c.op === 'contains') return `${c.field} ILIKE '%${c.val}%'`;
    return `${c.field} ${c.op} ${val}`;
  }).join('\n  AND ');

  const sql = conditions.length > 0
    ? `SELECT *\nFROM trades\nWHERE ${whereClause}\nORDER BY ${sortField} ${sortDir.toUpperCase()};`
    : `SELECT *\nFROM trades\nORDER BY ${sortField} ${sortDir.toUpperCase()};`;

  document.getElementById('sql-output').textContent = sql;
  document.getElementById('sql-card').style.display = 'block';

  const closed = results.filter(t => t.status !== 'Open');
  const winsR = results.filter(t => t.status === 'Win');
  const totalPnl = closed.reduce((s, t) => s + t.pnl, 0);
  const rrVals = closed.filter(t => t.rr != null).map(t => t.rr);
  const avgRR = rrVals.length ? rrVals.reduce((a, b) => a + b, 0) / rrVals.length : null;
  // Same definition as computeStats(): wins over decided trades, breakeven excluded
  const decidedR = winsR.length + results.filter(t => t.status === 'Loss').length;
  const wr = decidedR ? (winsR.length / decidedR * 100).toFixed(1) + '%' : '—';

  document.getElementById('res-pnl').textContent = fmt(totalPnl);
  document.getElementById('res-rr').textContent = avgRR != null ? avgRR.toFixed(2) + 'R' : '—';
  document.getElementById('res-wr').textContent = wr;
  document.getElementById('result-count').textContent = `${results.length} trade${results.length !== 1 ? 's' : ''}`;
  document.getElementById('q-count').textContent = `${results.length} result${results.length !== 1 ? 's' : ''}`;

  const tbody = document.getElementById('query-results-body');
  tbody.innerHTML = results.length === 0
    ? `<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--muted)">No trades match this query</td></tr>`
    : results.map(t => `<tr>
        <td class="mono" style="color:var(--muted)">${esc(t.date)}</td>
        <td style="font-weight:600">${esc(t.symbol)}</td>
        <td><span style="font-size:10px;color:var(--muted)">${esc(t.type)}</span></td>
        <td><span class="badge ${t.dir === 'Long' ? 'badge-long' : 'badge-short'}">${esc(t.dir)}</span></td>
        <td class="mono">${fmtPx(t.entry)}</td>
        <td class="mono">${t.exit != null ? fmtPx(t.exit) : '<span style="color:var(--amber)">Open</span>'}</td>
        <td class="mono ${t.pnl > 0 ? 'green' : t.pnl < 0 ? 'red' : ''}"><span class="balance-val">${t.status === 'Open' ? '—' : fmt(t.pnl)}</span></td>
        <td class="mono ${t.rr != null && t.rr > 0 ? 'green' : t.rr != null && t.rr < 0 ? 'red' : ''}">${t.rr != null ? t.rr.toFixed(2) + 'R' : '—'}</td>
        <td><span class="badge ${t.status === 'Win' ? 'badge-win' : t.status === 'Loss' ? 'badge-loss' : t.status === 'Breakeven' ? 'badge-breakeven' : 'badge-open'}">${esc(t.status)}</span></td>
      </tr>`).join('');

  document.getElementById('query-results').style.display = 'block';
}

function copySQL() {
  navigator.clipboard.writeText(document.getElementById('sql-output').textContent);
  toast('SQL copied ✓');
}

function renderPresets() {
  const bar = document.getElementById('presets-bar');
  if (!bar) return;
  bar.innerHTML = PRESETS.map((p, i) => `<button class="preset-chip" data-action="load-preset" data-preset-index="${i}">${p.label}</button>`).join('');
}

