// ═══════════════════════════════════════════════════════════════════════════
// Command palette (Ctrl/⌘ + K): jump to any page, run any action, or find a
// trade by symbol / setup / tag. Pages come from the router's registry, so
// new pages appear here automatically.
// ═══════════════════════════════════════════════════════════════════════════

const PALETTE_ACTIONS = [
  { title: 'Log trade', icon: '⇄', keys: 'new add trade', hint: 'N', run: () => openAddTrade() },
  { title: 'Add investment', icon: '◆', keys: 'buy holding stock crypto', hint: 'I', run: () => openAddInvestment() },
  { title: 'Deposit', icon: '＋', keys: 'add funds money', hint: 'D', run: () => openFundsModal('trading', 'deposit') },
  { title: 'Withdraw to bank', icon: '－', keys: 'withdrawal money out', hint: 'W', run: () => openFundsModal('trading', 'withdraw_bank') },
  { title: 'Transfer between accounts', icon: '⇆', keys: 'move money', run: () => openFundsModal('trading', 'transfer') },
  { title: 'Adjust balance', icon: '±', keys: 'correct fix balance', run: () => openFundsModal('trading', 'adjustment') },
  { title: 'Position size calculator', icon: '⊞', keys: 'risk size lot', hint: 'C', run: () => openCalculator() },
  { title: 'Sync Bybit now', icon: '⟳', keys: 'refresh exchange', hint: 'S', run: () => syncBybit() },
  { title: 'Import trades from CSV', icon: '↥', keys: 'upload file', run: () => openImport() },
  { title: 'Export trades as CSV', icon: '↓', keys: 'download spreadsheet', run: () => exportCSV() },
  { title: 'Monthly report (PDF)', icon: '▤', keys: 'print summary', run: () => openReport() },
  { title: 'Download full backup', icon: '⛁', keys: 'json export data', run: () => downloadBackup() },
  { title: 'Hide / show balances', icon: '👁', keys: 'privacy blur', hint: 'H', run: () => toggleBalanceVisibility() },
  { title: 'Switch currency USD ⇄ INR', icon: '₹', keys: 'rupee dollar', run: () => setCurrency(currency === 'USD' ? 'INR' : 'USD') },
  { title: 'Collapse / expand sidebar', icon: '«', keys: 'compact menu', hint: '[', run: () => toggleSidebarCollapsed() },
  { title: 'Keyboard shortcuts', icon: '⌨', keys: 'help keys', hint: '?', run: () => openModal('shortcuts-modal') },
  { title: 'Edit profile', icon: '◉', keys: 'name photo avatar', run: () => openProfileModal_internal() },
];

let paletteItems = [];
let paletteIndex = 0;

function openCommandPalette() {
  const el = document.getElementById('cmdk');
  if (!el) return;
  el.classList.add('open');
  const input = document.getElementById('cmdk-input');
  input.value = '';
  renderPalette('');
  setTimeout(() => input.focus(), 0);
}
function closeCommandPalette() {
  const el = document.getElementById('cmdk');
  if (el) el.classList.remove('open');
}

function paletteResults(q) {
  q = q.trim().toLowerCase();
  const score = (text) => {
    if (!q) return 1;
    const t = text.toLowerCase();
    if (t.startsWith(q)) return 3;
    if (t.split(/\s+/).some(w => w.startsWith(q))) return 2;
    return t.includes(q) ? 1 : 0;
  };
  const pages = Object.values(PAGES).filter(p => p.nav || p.id === 'schema')
    .map(p => ({ group: 'Pages', icon: p.icon, title: p.title, hint: p.subtitle, s: score(`${p.title} ${p.subtitle || ''} ${p.id}`), run: () => showPage(p.id) }));
  const actions = PALETTE_ACTIONS.map(a => ({ group: 'Actions', ...a, s: score(`${a.title} ${a.keys || ''}`) }));
  let trades = [];
  if (q.length >= 2) {
    trades = TRADES.filter(t => [t.symbol, t.setup, ...(t.tags || [])].some(v => v && String(v).toLowerCase().includes(q)))
      .slice(0, 8)
      .map(t => ({ group: 'Trades', icon: t.dir === 'Long' ? '▲' : '▼', title: `${t.symbol} · ${t.date}`,
        hint: t.status === 'Open' ? 'Open' : fmt(t.pnl), s: 1, run: () => openTradeDetail(t.id) }));
  }
  return [...pages, ...actions].filter(x => x.s > 0).sort((a, b) => b.s - a.s).concat(trades);
}

function renderPalette(q) {
  paletteItems = paletteResults(q);
  paletteIndex = 0;
  const list = document.getElementById('cmdk-list');
  if (!paletteItems.length) { list.innerHTML = `<div class="cmdk-empty">No matches for “${esc(q)}”</div>`; return; }
  let html = '', group = null;
  paletteItems.forEach((it, i) => {
    if (it.group !== group) { group = it.group; html += `<div class="cmdk-group">${group}</div>`; }
    html += `<div class="cmdk-item${i === 0 ? ' selected' : ''}" role="option" data-index="${i}" aria-selected="${i === 0}">
      <span class="icon">${it.icon || '•'}</span><span>${esc(it.title)}</span>${it.hint ? `<span class="hint">${esc(String(it.hint))}</span>` : ''}</div>`;
  });
  list.innerHTML = html;
}

function movePalette(delta) {
  if (!paletteItems.length) return;
  paletteIndex = (paletteIndex + delta + paletteItems.length) % paletteItems.length;
  document.querySelectorAll('#cmdk-list .cmdk-item').forEach(el => {
    const on = +el.dataset.index === paletteIndex;
    el.classList.toggle('selected', on);
    el.setAttribute('aria-selected', String(on));
    if (on) el.scrollIntoView({ block: 'nearest' });
  });
}

function runPaletteItem(i) {
  const it = paletteItems[i];
  if (!it) return;
  closeCommandPalette();
  it.run();
}

INPUT_HANDLERS['cmdk-input'] = el => renderPalette(el.value);
ACTIONS['open-command-palette'] = () => openCommandPalette();

document.addEventListener('keydown', e => {
  const open = document.getElementById('cmdk') && document.getElementById('cmdk').classList.contains('open');
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    open ? closeCommandPalette() : openCommandPalette();
    return;
  }
  if (!open) return;
  if (e.key === 'Escape') { e.preventDefault(); closeCommandPalette(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); movePalette(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); movePalette(-1); }
  else if (e.key === 'Enter') { e.preventDefault(); runPaletteItem(paletteIndex); }
});
document.addEventListener('click', e => {
  const item = e.target.closest && e.target.closest('.cmdk-item');
  if (item) return runPaletteItem(+item.dataset.index);
  if (e.target.id === 'cmdk') closeCommandPalette();
});
