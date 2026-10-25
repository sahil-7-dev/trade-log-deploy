// ═══════════════════════════════════════════════════════════════════════════
// App state: Supabase config, in-memory data (TRADES, HOLDINGS, FUNDS...),
// balances, the live USD→INR rate, and the per-account local cache.
// ═══════════════════════════════════════════════════════════════════════════

// ─── SUPABASE CONFIG (loaded from config.js) ─────────────────────────────────
// Defensive normalization: strips any accidental path/trailing-slash a
// hand-copied config.js might have (e.g. ".../rest/v1/" instead of the bare
// project URL). The build script does the same for Vercel deploys.
function normalizeSupabaseUrl(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return String(url).replace(/\/+$/, '');
  }
}
const SUPABASE_URL = normalizeSupabaseUrl(APP_CONFIG.SUPABASE_URL);
const SUPABASE_KEY = APP_CONFIG.SUPABASE_ANON_KEY;
const SB_HEADERS = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`
};

// ─── STATE ────────────────────────────────────────────────────────────────────
let currency = 'USD';
// Live USD→INR from Frankfurter (ECB reference rates — free, no key), cached
// for 12h. Falls back to the last fetched rate, then to a recent fixed value.
let USD_INR = parseFloat(localStorage.getItem('fx_usd_inr')) || 95;
let currentUser = null;
let userToken = null;
let TRADES = [];
let HOLDINGS = [];
let chartInstances = {};
let realizedHistory = JSON.parse(localStorage.getItem('realized_history') || '[]');
let cashBalance     = parseFloat(localStorage.getItem('cash_balance') || '0');
let tradingBalance  = parseFloat(localStorage.getItem('trading_balance') || '0');
let livePrices = {};       // { BTC: 65000, ETH: 3200, ... }
let priceRefreshTimer = null;
let FUNDS = [];            // fund_transactions rows: deposits, withdrawals, adjustments, transfers
let SNAPSHOTS = [];        // portfolio_snapshots rows, oldest first
let PREFS = {};            // user_settings.preferences: goals, risk %, auto-sync...
// False until the 2026-10-26 migration is detected in Supabase. Features that
// need its tables are disabled (with a banner) instead of failing on save.
let DB_READY = false;
// True once trades have buy_fee / sell_fee (2026-10-27 migration)
let FEE_SPLIT_READY = false;

async function refreshFxRate() {
  const fetchedAt = parseInt(localStorage.getItem('fx_usd_inr_at') || '0', 10);
  if (Date.now() - fetchedAt < 12 * 3600e3) return;
  try {
    const res = await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const rate = data && data.rates && parseFloat(data.rates.INR);
    if (!(rate > 0)) throw new Error('no INR rate');
    USD_INR = rate;
    safeLocalSet('fx_usd_inr', String(rate));
    safeLocalSet('fx_usd_inr_at', String(Date.now()));
    safeLocalSet('fx_usd_inr_date', data.date || '');
    if (currency === 'INR') renderAll();
  } catch (e) {
    log.warn('[refreshFxRate] Using cached/fallback USD→INR rate:', e.message);
  }
  updateFxTooltip();
}

function updateFxTooltip() {
  const btn = document.querySelector('[data-currency="INR"]');
  if (btn) btn.title = `1 USD = ₹${USD_INR.toFixed(2)} (ECB rate${localStorage.getItem('fx_usd_inr_date') ? ', ' + localStorage.getItem('fx_usd_inr_date') : ''})`;
}

// Balances, realized history and display name are cached in localStorage so
// the app still works offline, but Supabase holds the real copy. The cache
// is tagged with its owner's user id: loadAllData() uploads the cache to a
// brand-new account, so it must never carry another account's numbers (or
// the demo's) into one.
const ACCOUNT_CACHE_KEYS = ['cash_balance', 'trading_balance', 'realized_history', 'profile_name', 'profile_photo', 'cache_owner'];
// True once balances are worked out from the history (2026-10-27 update):
// see core/balances.js. False on an older database, which still stores them.
let LEDGER_READY = false;
// false until this account's preferences have loaded from the server
let prefsLoaded = false;

function clearAccountCache() {
  ACCOUNT_CACHE_KEYS.forEach(k => localStorage.removeItem(k));
}

// Reload in-memory account state from the cache for the user who just signed
// in — replacing whatever is in memory (demo data, or a previous account's).
function restoreAccountStateFromCache(userId) {
  const owner = localStorage.getItem('cache_owner');
  if (owner && owner !== userId) clearAccountCache();
  try {
    realizedHistory = JSON.parse(localStorage.getItem('realized_history') || '[]');
  } catch (e) {
    realizedHistory = [];
  }
  cashBalance    = parseFloat(localStorage.getItem('cash_balance') || '0') || 0;
  tradingBalance = parseFloat(localStorage.getItem('trading_balance') || '0') || 0;
  profileName    = localStorage.getItem('profile_name') || '';
  profilePhoto   = localStorage.getItem('profile_photo') || null;
  TRADES = []; HOLDINGS = []; FUNDS = []; SNAPSHOTS = []; PREFS = {};
  DB_READY = false; prefsLoaded = false; LEDGER_READY = false; FEE_SPLIT_READY = false;
  // the cached balances show until the account's data has loaded
  anchorBalances(tradingBalance, cashBalance);
}

