// ═══════════════════════════════════════════════════════════════════════════
// CSV import from any exchange / spreadsheet: auto column matching,
// date-format choice, duplicate skipping, preview, batch insert.
// ═══════════════════════════════════════════════════════════════════════════

// ─── CSV IMPORT ──────────────────────────────────────────────────────────────
// RFC-4180-ish parser: quoted fields, "" escapes, commas/newlines in quotes, BOM
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(v => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(v => v.trim() !== '')) rows.push(row);
  return rows;
}

// Our own export's headers come first in each alias list, so a TradeLog CSV
// maps itself with no clicks.
const IMPORT_FIELDS = [
  { key: 'date',      label: 'Date',            required: true, aliases: ['date', 'trade date', 'close date', 'closed date', 'exit date', 'trade time', 'time', 'create time', 'closing time'] },
  { key: 'symbol',    label: 'Symbol',          required: true, aliases: ['symbol', 'ticker', 'pair', 'contracts', 'contract', 'market', 'instrument', 'asset'] },
  { key: 'dir',       label: 'Direction',       required: true, aliases: ['direction', 'side', 'dir', 'position', 'closing direction', 'trade type'] },
  { key: 'entry',     label: 'Entry price',     required: true, aliases: ['entry', 'entry price', 'avg entry price', 'open price', 'entry_price', 'buy price'] },
  { key: 'exit',      label: 'Exit price',      aliases: ['exit', 'exit price', 'avg exit price', 'close price', 'closing price', 'exit_price', 'sell price'] },
  { key: 'size',      label: 'Size ($)',        aliases: ['size', 'position size', 'size ($)', 'notional', 'position value', 'value', 'amount'] },
  { key: 'qty',       label: 'Quantity',        aliases: ['qty', 'quantity', 'units', 'closed qty', 'filled qty'] },
  { key: 'type',      label: 'Asset type',      aliases: ['type', 'asset type', 'asset class', 'category'] },
  { key: 'sl',        label: 'Stop loss',       aliases: ['sl', 'stop loss', 'stop', 'stop_loss'] },
  { key: 'tp',        label: 'Take profit',     aliases: ['tp', 'take profit', 'target', 'take_profit'] },
  { key: 'fees',      label: 'Fees',            aliases: ['fees', 'fee', 'commission', 'trading fee', 'trading fees'] },
  { key: 'setup',     label: 'Setup',           aliases: ['setup', 'strategy'] },
  { key: 'tags',      label: 'Tags',            aliases: ['tags', 'tag'] },
  { key: 'mistakes',  label: 'Mistakes',        aliases: ['mistakes', 'mistake'] },
  { key: 'emotion',   label: 'Emotion',         aliases: ['emotion', 'feeling'] },
  { key: 'followed',  label: 'Followed plan',   aliases: ['followed plan', 'followed_plan'] },
  { key: 'opened_at', label: 'Opened at',       aliases: ['opened at', 'open time', 'entry time', 'opened_at'] },
  { key: 'closed_at', label: 'Closed at',       aliases: ['closed at', 'close time', 'exit time', 'closed_at'] },
  { key: 'notes',     label: 'Notes',           aliases: ['notes', 'note', 'comment', 'comments'] },
];

let IMPORT = { headers: [], rows: [], map: {}, prepared: [] };

function openImport() {
  IMPORT = { headers: [], rows: [], map: {}, prepared: [] };
  document.getElementById('import-file').value = '';
  setHtml('import-mapping', '');
  setHtml('import-preview', '');
  setText('import-summary', '');
  document.getElementById('import-submit').disabled = true;
  openModal('import-modal');
}

function guessMapping(headers) {
  const norm = headers.map(h => h.trim().toLowerCase());
  const map = {};
  for (const f of IMPORT_FIELDS) {
    let idx = -1;
    for (const a of f.aliases) { idx = norm.indexOf(a); if (idx !== -1) break; }
    map[f.key] = idx;
  }
  return map;
}

CHANGE_HANDLERS['import-file'] = async (el) => {
  const file = el.files && el.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) return toast('CSV must be under 5MB', 'err');
  const rows = parseCSV(await file.text());
  if (rows.length < 2) return toast('That file has no data rows', 'err');
  IMPORT.headers = rows[0].map(h => h.trim());
  IMPORT.rows = rows.slice(1);
  IMPORT.map = guessMapping(IMPORT.headers);
  // Exchange "closing direction" columns hold the closing side (Sell closes a Long)
  document.getElementById('import-dir-closing').checked =
    IMPORT.map.dir !== -1 && /closing/i.test(IMPORT.headers[IMPORT.map.dir]);
  renderImportMapping();
  prepareImport();
};

function renderImportMapping() {
  const opts = ['<option value="-1">— not in file —</option>', ...IMPORT.headers.map((h, i) => `<option value="${i}">${esc(h)}</option>`)].join('');
  setHtml('import-mapping', IMPORT_FIELDS.map(f => `
    <div class="form-group">
      <label class="form-label">${f.label}${f.required ? ' *' : ''}${f.key === 'size' ? ' (or Quantity)' : ''}</label>
      <select class="form-select" id="imap-${f.key}">${opts}</select>
    </div>`).join(''));
  IMPORT_FIELDS.forEach(f => {
    const el = document.getElementById('imap-' + f.key);
    el.value = String(IMPORT.map[f.key]);
    CHANGE_HANDLERS['imap-' + f.key] = e => { IMPORT.map[f.key] = parseInt(e.value, 10); prepareImport(); };
  });
}
['import-date-format', 'import-default-type', 'import-dir-closing'].forEach(id => { CHANGE_HANDLERS[id] = () => prepareImport(); });

function parseImportDate(raw, format) {
  const s = String(raw || '').trim();
  if (!s) return null;
  // A full timestamp with its own zone (our CSV export, ISO "…Z" / "+05:30")
  // is an exact moment — reading it as local time would shift it by the
  // UTC offset, onto the wrong day for anything near midnight
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[+-]\d{2}(:?\d{2})?)$/i.test(s)) {
    // normalise to strict ISO: "T", no space before the zone, "+05:30" / "+00:00"
    const iso = s.replace(' ', 'T').replace(/\s+/, '')
      .replace(/([+-]\d{2})(\d{2})$/, '$1:$2').replace(/([+-]\d{2})$/, '$1:00');
    const d = new Date(iso);
    if (!isNaN(d)) return d;
  }
  let m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/))) {
    return mkDate(+m[1], +m[2], +m[3], m[4], m[5], m[6]);
  }
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/))) {
    const [a, b] = [+m[1], +m[2]];
    const [d, mo] = format === 'mdy' ? [b, a] : [a, b];
    return mkDate(+m[3], mo, d, m[4], m[5], m[6]);
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
  function mkDate(y, mo, d, h, mi, se) {
    const dt = new Date(y, mo - 1, d, +(h || 0), +(mi || 0), +(se || 0));
    return isNaN(dt) || dt.getMonth() !== mo - 1 ? null : dt;
  }
}

const importNum = v => {
  if (v == null || String(v).trim() === '') return null;
  const n = parseFloat(String(v).replace(/[$,₹\s]/g, ''));
  return isNaN(n) ? null : n;
};

// Turns the mapped CSV rows into trade rows (or per-row errors)
function prepareImport() {
  const fmtSel = document.getElementById('import-date-format').value;
  const defaultType = document.getElementById('import-default-type').value;
  const dirIsClosing = document.getElementById('import-dir-closing').checked;
  const get = (row, key) => IMPORT.map[key] >= 0 ? row[IMPORT.map[key]] : undefined;
  const existing = new Set(TRADES.map(importKey));
  const seen = new Set();

  IMPORT.prepared = IMPORT.rows.map((row, i) => {
    const errors = [];
    const dateObj = parseImportDate(get(row, 'date'), fmtSel);
    const closedAt = parseImportDate(get(row, 'closed_at'), fmtSel);
    const openedAt = parseImportDate(get(row, 'opened_at'), fmtSel);
    const symbol = String(get(row, 'symbol') || '').trim().toUpperCase();
    let dirRaw = String(get(row, 'dir') || '').trim().toLowerCase();
    let dir = /^(long|buy|l|b)$/.test(dirRaw) ? 'Long' : /^(short|sell|s)$/.test(dirRaw) ? 'Short' : null;
    if (dir && dirIsClosing) dir = dir === 'Long' ? 'Short' : 'Long';
    const entry = importNum(get(row, 'entry'));
    const exit = importNum(get(row, 'exit'));
    let size = importNum(get(row, 'size'));
    const qty = importNum(get(row, 'qty'));
    if (size == null && qty != null && entry) size = Math.abs(qty) * entry;
    const typeRaw = String(get(row, 'type') || '').trim().toLowerCase();
    const type = /crypto|coin|perp|future/.test(typeRaw) ? 'Crypto' : /forex|fx|currency/.test(typeRaw) ? 'Forex'
      : /stock|equit|share/.test(typeRaw) ? 'Stocks' : defaultType;

    if (!dateObj && !closedAt) errors.push('date');
    if (!symbol) errors.push('symbol');
    if (!dir) errors.push('direction');
    if (!(entry > 0)) errors.push('entry');
    if (!(size > 0)) errors.push('size/qty');
    if (exit != null && !(exit > 0)) errors.push('exit');
    if (errors.length) return { line: i + 2, errors };

    const date = localDateOf(closedAt || dateObj);
    const sl = importNum(get(row, 'sl')), tp = importNum(get(row, 'tp'));
    const fees = Math.abs(importNum(get(row, 'fees')) || 0);
    let rr = null;
    if (exit && sl) {
      const risk = Math.abs(entry - sl) / entry * size;
      rr = risk > 0 ? parseFloat((((dir === 'Long' ? exit - entry : entry - exit) / entry * size - fees) / risk).toFixed(4)) : null;
    }
    const list = v => v ? String(v).split(/[;,]/).map(s => s.trim()).filter(Boolean) : null;
    const followedRaw = String(get(row, 'followed') || '').trim().toLowerCase();
    const trade = {
      date, symbol, type, dir, entry, exit: exit ?? null, size: round2(size), sl, tp, rr,
      setup: (get(row, 'setup') || '').trim() || null,
      notes: (get(row, 'notes') || '').trim() || null,
      tags: (list(get(row, 'tags')) || []).map(s => s.toLowerCase()),
      source: 'import',
    };
    if (!trade.tags.length) trade.tags = null;
    if (DB_READY) Object.assign(trade, {
      fees,
      opened_at: openedAt ? openedAt.toISOString() : null,
      closed_at: exit != null && closedAt ? closedAt.toISOString() : null,
      mistakes: list(get(row, 'mistakes')),
      emotion: (get(row, 'emotion') || '').trim() || null,
      followed_plan: /^(yes|y|true|1)$/.test(followedRaw) ? true : /^(no|n|false|0)$/.test(followedRaw) ? false : null,
    });
    const key = importKey(trade);
    const dup = existing.has(key) || seen.has(key);
    seen.add(key);
    return { line: i + 2, trade, dup };
  });

  const ok = IMPORT.prepared.filter(p => p.trade && !p.dup);
  const dups = IMPORT.prepared.filter(p => p.dup).length;
  const bad = IMPORT.prepared.filter(p => p.errors);
  setText('import-summary', `${ok.length} to import · ${dups} duplicate${dups !== 1 ? 's' : ''} skipped · ${bad.length} with problems`
    + (bad.length ? ` (e.g. line ${bad[0].line}: missing/invalid ${bad[0].errors.join(', ')})` : ''));
  setHtml('import-preview', ok.length ? `<table><thead><tr><th>Date</th><th>Symbol</th><th>Dir</th><th>Entry</th><th>Exit</th><th>Size</th><th>Fees</th></tr></thead><tbody>
    ${ok.slice(0, 6).map(p => `<tr style="cursor:default"><td class="mono">${esc(p.trade.date)}</td><td>${esc(p.trade.symbol)}</td><td>${p.trade.dir}</td>
      <td class="mono">${fmtPx(p.trade.entry)}</td><td class="mono">${p.trade.exit != null ? fmtPx(p.trade.exit) : 'Open'}</td><td class="mono">$${p.trade.size.toFixed(2)}</td><td class="mono">${p.trade.fees ? '$' + p.trade.fees.toFixed(2) : '—'}</td></tr>`).join('')}
    </tbody></table>${ok.length > 6 ? `<div class="goal-sub" style="padding:6px 0">…and ${ok.length - 6} more</div>` : ''}` : '');
  const btn = document.getElementById('import-submit');
  btn.disabled = ok.length === 0;
  btn.textContent = ok.length ? `Import ${ok.length} trade${ok.length !== 1 ? 's' : ''}` : 'Import';
}

// Imported closed trades count in the trading balance like any other. With
// "add to trading balance" unticked (history from another account), their
// P&L is kept out by one visible adjustment in the funds history.
async function keepImportOutOfBalance(inserted, addToBalance) {
  if (addToBalance) return;
  const pnl = round2(sum(inserted.filter(t => t.status !== 'Open'), t => t.pnl));
  if (pnl) await holdBalance('trading', -pnl, `P&L of ${inserted.length} imported trade${inserted.length !== 1 ? 's' : ''} kept out of the balance`);
}

function importKey(t) {
  const r = v => v == null ? '' : (+v).toFixed(6);
  return [t.date, (t.symbol || '').toUpperCase(), t.dir, r(t.entry), r(t.exit), r(t.size)].join('|');
}

async function submitImport() {
  if (demoGuard()) return;
  const toInsert = IMPORT.prepared.filter(p => p.trade && !p.dup).map(p => ({ ...p.trade, user_id: currentUser.id }));
  if (!toInsert.length) return;
  const addToBalance = document.getElementById('import-add-balance').checked;
  const btn = document.getElementById('import-submit');
  btn.disabled = true; btn.textContent = 'Importing…';
  let inserted = [];
  try {
    for (let i = 0; i < toInsert.length; i += 200) {
      const res = await sbInsert('trades', toInsert.slice(i, i + 200));
      inserted = inserted.concat((res || []).map(normalizeTrade));
    }
    TRADES = TRADES.concat(inserted);
    await keepImportOutOfBalance(inserted, addToBalance);
    await persistBalances();
    closeModal('import-modal');
    renderAll();
    fetchLivePrices();
    toast(`Imported ${inserted.length} trade${inserted.length !== 1 ? 's' : ''} ✓`);
  } catch (e) {
    toast(`Import stopped after ${inserted.length}: ${e.message}`, 'err');
    if (inserted.length) {
      TRADES = TRADES.concat(inserted.filter(t => !TRADES.includes(t)));
      // the rows that did go in are in the history — same balance rule as a full import
      await keepImportOutOfBalance(inserted, addToBalance).catch(err => log.warn('[import] adjustment failed:', err.message));
      await persistBalances().catch(() => {});
      renderAll();
      // …and are now duplicates, so "Retry" only sends the rest
      prepareImport();
    }
    if (IMPORT.prepared.some(p => p.trade && !p.dup)) { btn.disabled = false; btn.textContent = 'Retry import'; }
  }
}

ACTIONS['open-import'] = () => openImport();
ACTIONS['submit-import'] = () => submitImport();
