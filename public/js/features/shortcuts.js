// ═══════════════════════════════════════════════════════════════════════════
// Keyboard shortcuts. Single keys act only when you're not typing in a field
// and no dialog is open. "g" then a letter jumps to a page.
// The list in partials/modals/shortcuts.html mirrors these.
// ═══════════════════════════════════════════════════════════════════════════

const SHORTCUT_KEYS = {
  n: () => openAddTrade(),
  i: () => openAddInvestment(),
  d: () => openFundsModal('trading', 'deposit'),
  w: () => openFundsModal('trading', 'withdraw_bank'),
  c: () => openCalculator(),
  s: () => syncBybit(),
  h: () => toggleBalanceVisibility(),
  '[': () => toggleSidebarCollapsed(),
  '?': () => openModal('shortcuts-modal'),
  '/': () => { showPage('trades'); setTimeout(() => { const el = document.getElementById('tl-search'); if (el) el.focus(); }, 50); },
};
const GOTO_KEYS = { o: 'dashboard', t: 'trades', p: 'analytics', n: 'insights', r: 'risk', f: 'investing', e: 'equity', m: 'money', w: 'networth', c: 'calendar', y: 'yearly', q: 'query', s: 'settings' };

let gPressedAt = 0;

function isTyping(e) {
  const t = e.target;
  return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const open = [...document.querySelectorAll('.modal-overlay.open')].pop();
    if (open && open.id !== 'confirm-modal') { open.classList.remove('open'); return; }
  }
  if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return;
  if (document.querySelector('.modal-overlay.open') || (document.getElementById('cmdk') || {}).classList?.contains('open')) return;
  if (document.getElementById('app-shell').style.display === 'none') return; // sign-in screen

  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (Date.now() - gPressedAt < 1200 && GOTO_KEYS[key]) {
    gPressedAt = 0;
    e.preventDefault();
    showPage(GOTO_KEYS[key]);
    return;
  }
  if (key === 'g') { gPressedAt = Date.now(); return; }
  if (SHORTCUT_KEYS[e.key] || SHORTCUT_KEYS[key]) {
    e.preventDefault();
    (SHORTCUT_KEYS[e.key] || SHORTCUT_KEYS[key])();
  }
});

ACTIONS['open-shortcuts'] = () => openModal('shortcuts-modal');
