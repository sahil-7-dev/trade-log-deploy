// ═══════════════════════════════════════════════════════════════════════════
// Small shared helpers: hide-balance toggle, escaping, logging, toast,
// money/date formatting, modals, safe localStorage writes.
// ═══════════════════════════════════════════════════════════════════════════

// ─── HIDE BALANCE TOGGLE ──────────────────────────────────────────────────────
let balanceHidden = localStorage.getItem('balance_hidden') === 'true';

function toggleBalanceVisibility() {
  balanceHidden = !balanceHidden;
  localStorage.setItem('balance_hidden', balanceHidden);
  applyBalanceVisibility();
}

function applyBalanceVisibility() {
  document.body.classList.toggle('balance-hidden', balanceHidden);
  const btn = document.getElementById('hide-balance-btn');
  if (btn) btn.textContent = balanceHidden ? '🙈' : '👁';
}

// ─── SECURITY HELPERS ─────────────────────────────────────────────────────────
// Escape any string before inserting into innerHTML to prevent XSS
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// Production-safe logger — only logs warnings/errors, never sensitive session state
const log = {
  warn:  (...a) => console.warn(...a),
  error: (...a) => console.error(...a),
  // info/debug are no-ops in production — swap to console.log for local debugging
  info:  (...a) => {},
  debug: (...a) => {},
};

// ─── TOAST ────────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, type = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3000);
}

// ─── FORMAT HELPERS ───────────────────────────────────────────────────────────
const fmt = (v, decimals = 2) => {
  v = parseFloat(v) || 0;
  const abs = Math.abs(v);
  const str = abs.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const sign = v >= 0 ? '+' : '-';
  return currency === 'USD'
    ? `${sign}$${str}`
    : `${sign}₹${(abs * USD_INR).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};
const fmtVal = (v) => {
  v = parseFloat(v) || 0;
  return currency === 'USD'
    ? `$${v.toLocaleString('en-US', { minimumFractionDigits: 0 })}`
    : `₹${(v * USD_INR).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};
// A price, readable at any size: 4 decimals above 1, 6 significant digits
// below (PEPE's 0.00001234 would otherwise show as "0")
const fmtPx = (v) => {
  v = parseFloat(v);
  if (!isFinite(v)) return '—';
  return v.toLocaleString('en-US', Math.abs(v) >= 1 ? { maximumFractionDigits: 4 } : { maximumSignificantDigits: 6 });
};
// A price in the display currency (holdings' avg / current price)
const fmtPrice = (v) => currency === 'USD' ? '$' + fmtPx(v) : '₹' + fmtPx((parseFloat(v) || 0) * USD_INR);
// Unsigned balance with cents (USD) — respects the USD/INR toggle like fmt/fmtVal.
const fmtMoney = (v) => {
  v = parseFloat(v) || 0;
  const sign = v < 0 ? '-' : '';
  return currency === 'USD'
    ? `${sign}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `${sign}₹${(Math.abs(v) * USD_INR).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

// Today as YYYY-MM-DD in the user's own timezone. toISOString() is UTC, so
// between midnight and 05:30 IST it still returns yesterday's date.
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}


// ─── MODAL ────────────────────────────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// Click on the dimmed backdrop closes a modal (delegated: modals load after start-up)
document.addEventListener('click', e => {
  if (e.target.classList && e.target.classList.contains('modal-overlay') && e.target.id !== 'confirm-modal') e.target.classList.remove('open');
});


function safeLocalSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch(e) {
    log.warn(`localStorage quota exceeded for key "${key}":`, e.message);
    if (key === 'profile_photo') {
      toast('Photo too large to save — try a smaller image', 'err');
    }
  }
}

