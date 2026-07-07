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
const USD_INR = 83.5;
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
let lastPriceUpdate = null;

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

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function showAuthScreen() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app-shell').style.display = 'none';
}
function showAppShell() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = 'flex';
}

async function sbSignUp() {
  const email = document.getElementById('auth-email').value.trim();
  const pass  = document.getElementById('auth-pass').value;
  if (!email || !pass) return setAuthMsg('Enter email and password', 'red');
  setAuthMsg('Creating account…', 'muted');
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST', headers: SB_HEADERS,
      body: JSON.stringify({ email, password: pass })
    });
    let data;
    try {
      data = await res.json();
    } catch (parseErr) {
      // Response wasn't JSON — almost always means SUPABASE_URL is wrong/missing
      // (fetch hit a 404/HTML page instead of the real Supabase API).
      throw new Error('Unexpected server response. Check that config.js has valid Supabase settings.');
    }
    if (!res.ok || data.error || data.error_description) {
      const msg = data.error_description || data.msg || data.message
        || (data.error && data.error.message) || data.error
        || `Signup failed (${res.status})`;
      return setAuthMsg(msg, 'red');
    }
    setAuthMsg('Check your email to confirm, then sign in.', 'green');
  } catch (e) {
    log.error('[sbSignUp] Failed:', e.message);
    setAuthMsg(e.message === 'Failed to fetch'
      ? 'Network error — check your connection and try again.'
      : e.message || 'Signup failed', 'red');
  }
}

async function sbSignIn() {
  const email = document.getElementById('auth-email').value.trim();
  const pass  = document.getElementById('auth-pass').value;
  if (!email || !pass) return setAuthMsg('Enter email and password', 'red');
  setAuthMsg('Signing in…', 'muted');
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: SB_HEADERS,
      body: JSON.stringify({ email, password: pass })
    });
    let data;
    try {
      data = await res.json();
    } catch (parseErr) {
      throw new Error('Unexpected server response. Check that config.js has valid Supabase settings.');
    }
    if (!res.ok || data.error || data.error_description || !data.access_token) {
      const msg = data.error_description || data.msg || data.message || data.error
        || `Sign in failed (${res.status})`;
      return setAuthMsg(msg, 'red');
    }
    applySession(data);
    document.getElementById('user-email').textContent = currentUser.email;
    showAppShell();
    loadProfile();
    await loadAllData();
  } catch (e) {
    log.error('[sbSignIn] Failed:', e.message);
    setAuthMsg(e.message === 'Failed to fetch'
      ? 'Network error — check your connection and try again.'
      : e.message || 'Sign in failed', 'red');
  }
}

function applySession(data) {
  currentUser = data.user;
  userToken = data.access_token;
  const expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  safeLocalSet('sb_token', userToken);
  safeLocalSet('sb_expires', expiresAt);
  safeLocalSet('sb_user', JSON.stringify(currentUser));
  if (data.refresh_token) {
    safeLocalSet('sb_refresh', data.refresh_token);
  }
  scheduleTokenRefresh(data.expires_in || 3600);
}

let refreshTimer = null;
function scheduleTokenRefresh(expiresInSeconds) {
  if (refreshTimer) clearTimeout(refreshTimer);
  // Refresh 2 minutes before expiry, minimum 30 seconds delay
  const delay = Math.max((expiresInSeconds - 120) * 1000, 30000);
  refreshTimer = setTimeout(refreshToken, delay);
}

async function refreshToken() {
  const refreshTk = localStorage.getItem('sb_refresh');
  if (!refreshTk) { showAuthScreen(); return; }
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', headers: SB_HEADERS,
      body: JSON.stringify({ refresh_token: refreshTk })
    });
    const data = await res.json();
    if (data.error || data.error_description || !data.access_token) {
      // Refresh token truly expired — force login but keep user data
      clearAuthStorage();
      showAuthScreen();
      return;
    }
    applySession(data);
  } catch(e) {
    log.warn('Token refresh failed:', e.message);
    scheduleTokenRefresh(300); // retry in 5 min
  }
}

async function sbSignOut() {
  try {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, { method: 'POST', headers: authHeaders() });
  } catch(e) {}
  if (refreshTimer) clearTimeout(refreshTimer);
  clearAuthStorage();
  currentUser = null; userToken = null;
  TRADES = []; HOLDINGS = [];
  showAuthScreen();
}

function setAuthMsg(msg, color) {
  const el = document.getElementById('auth-msg');
  el.textContent = msg;
  el.style.color = color === 'green' ? 'var(--green)' : color === 'red' ? 'var(--red)' : 'var(--muted)';
}

function authHeaders() {
  // Always read latest token from memory OR localStorage as fallback
  const token = userToken || localStorage.getItem('sb_token') || '';
  return { ...SB_HEADERS, 'Authorization': `Bearer ${token}` };
}

// ─── TOKEN REFRESH + RETRY HELPER ────────────────────────────────────────────
async function ensureFreshToken() {
  const savedExpires = parseInt(localStorage.getItem('sb_expires') || '0');
  const savedRefresh = localStorage.getItem('sb_refresh');

  // Only refresh if expiry is known AND token expires within 5 minutes
  // If no expiry stored, assume token is fine — don't burn the refresh token
  const tokenExpiresSoon = savedExpires > 0 && Date.now() > savedExpires - 300000;

  if (!tokenExpiresSoon) return false; // token is fine, skip

  if (!savedRefresh) return false;

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', headers: SB_HEADERS,
      body: JSON.stringify({ refresh_token: savedRefresh })
    });
    const data = await res.json();
    if (data.access_token) {
      applySession(data);
      return true;
    }
  } catch(e) {
    log.warn('ensureFreshToken failed:', e.message);
  }
  return false;
}

// Called only when a request actually gets a 401 — forces a refresh attempt
async function forceRefreshToken() {
  const savedRefresh = localStorage.getItem('sb_refresh');
  if (!savedRefresh) {
    log.warn('forceRefreshToken: no refresh token stored — user must sign in again');
    return false;
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', headers: SB_HEADERS,
      body: JSON.stringify({ refresh_token: savedRefresh })
    });
    const data = await res.json();
    if (data.access_token) {
      applySession(data);
      log.info('forceRefreshToken: success, new token applied');
      return true;
    }
    log.warn('forceRefreshToken: refresh returned error:', data.error || data.error_description);
  } catch(e) {
    log.warn('forceRefreshToken failed:', e.message);
  }
  return false;
}

// ─── SUPABASE CRUD ────────────────────────────────────────────────────────────
async function sbRequest(method, path, body = null, isRetry = false, preferHeader = "return=representation") {
  const headers = { ...authHeaders(), "Prefer": preferHeader };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts);
  log.info(`[sbRequest] ${method} ${path} → ${res.status}`);
  if (res.status === 401 && !isRetry) {
    log.warn('[sbRequest] Got 401, attempting token refresh...');
    const refreshed = await forceRefreshToken();
    if (refreshed) {
      log.info('[sbRequest] Refresh succeeded, retrying request...');
      return sbRequest(method, path, body, true, preferHeader);
    }
    log.error('[sbRequest] Refresh failed — session truly expired');
    throw new Error('SESSION_EXPIRED');
  }
  return res;
}

async function sbSelect(table, query = "") {
  const orderCol = table === "investments" ? "buy_date" : "date";
  const res = await sbRequest("GET", `${table}?${query}&order=${orderCol}.desc`);
  if (!res.ok) throw new Error(`DB error: ${res.status}`);
  return res.json();
}

async function sbInsert(table, body) {
  const res = await sbRequest("POST", table, body);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || `Insert failed: ${res.status}`);
  }
  return res.json();
}

async function sbDelete(table, id) {
  const res = await sbRequest("DELETE", `${table}?id=eq.${id}`);
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
}

async function sbUpdate(table, id, body) {
  const res = await sbRequest("PATCH", `${table}?id=eq.${id}`, body);
  if (!res.ok) throw new Error(`Update failed: ${res.status}`);
  return res.json();
}

// user_settings is a single row per user (cash balance + realized history).
// POST with on_conflict + merge-duplicates does an atomic upsert in one call.
async function sbGetSettings() {
  const res = await sbRequest("GET", `user_settings?user_id=eq.${currentUser.id}&select=cash_balance,trading_balance,realized_history`);
  if (!res.ok) throw new Error(`Settings load failed: ${res.status}`);
  return res.json();
}

async function sbUpsertSettings() {
  const res = await sbRequest(
    "POST",
    "user_settings?on_conflict=user_id",
    { user_id: currentUser.id, cash_balance: cashBalance, trading_balance: tradingBalance, realized_history: realizedHistory },
    false,
    "resolution=merge-duplicates,return=minimal"
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Settings save failed: ${res.status}`);
  }
}

// profiles — display name, checked for global uniqueness via a security-definer
// RPC so the client never needs read access to other users' rows.
async function sbGetProfile() {
  const res = await sbRequest("GET", `profiles?user_id=eq.${currentUser.id}&select=display_name`);
  if (!res.ok) throw new Error(`Profile load failed: ${res.status}`);
  return res.json();
}

async function sbCheckNameAvailable(name) {
  const res = await sbRequest("POST", "rpc/is_display_name_available", { check_name: name });
  if (!res.ok) throw new Error(`Availability check failed: ${res.status}`);
  return res.json(); // true | false
}

async function sbUpsertProfile(name) {
  const res = await sbRequest(
    "POST",
    "profiles?on_conflict=user_id",
    { user_id: currentUser.id, display_name: name },
    false,
    "resolution=merge-duplicates,return=minimal"
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    // Postgres unique_violation — the case-insensitive index rejected it.
    // (Belt-and-braces: the live availability check already tries to prevent
    // this, but a race between two people saving the same name at once is
    // only actually stopped here, at the database constraint.)
    if (err.code === '23505') throw new Error('TAKEN');
    throw new Error(err.message || `Profile save failed: ${res.status}`);
  }
}

// ─── LOAD DATA ────────────────────────────────────────────────────────────────
async function loadAllData() {
  showLoading(true);
  try {
    const [trades, investments, settings, profile] = await Promise.all([
      sbSelect('trades', 'select=*'),
      sbSelect('investments', 'select=*'),
      sbGetSettings().catch(e => { log.warn('[loadAllData] Settings fetch failed:', e.message); return null; }),
      sbGetProfile().catch(e => { log.warn('[loadAllData] Profile fetch failed:', e.message); return null; })
    ]);
    TRADES = Array.isArray(trades) ? trades.map(normalizeTrade) : [];
    HOLDINGS = Array.isArray(investments) ? investments.map(h => ({
      ...h,
      buyPrice: parseFloat(h.buy_price) || 0,
      curPrice: parseFloat(h.cur_price) > 0 ? parseFloat(h.cur_price) : parseFloat(h.buy_price) || 0,
      qty: parseFloat(h.qty) || 0,
      color: assetColor(h.symbol),
      livePrice: false
    })) : [];

    if (Array.isArray(settings) && settings.length > 0) {
      // Row exists on the server — it's the source of truth across devices
      cashBalance = parseFloat(settings[0].cash_balance) || 0;
      tradingBalance = parseFloat(settings[0].trading_balance) || 0;
      realizedHistory = Array.isArray(settings[0].realized_history) ? settings[0].realized_history : [];
      safeLocalSet('cash_balance', cashBalance.toString());
      safeLocalSet('trading_balance', tradingBalance.toString());
      safeLocalSet('realized_history', JSON.stringify(realizedHistory));
    } else if (settings !== null) {
      // No row yet — first login since this feature shipped. Push whatever's
      // in the local cache (cashBalance/tradingBalance/realizedHistory already
      // loaded from localStorage at startup) up to Supabase so it isn't lost.
      sbUpsertSettings().catch(e => log.warn('[loadAllData] Initial settings migration failed:', e.message));
    }
    // If settings === null (fetch failed, e.g. offline), keep using the
    // localStorage-derived values already in memory rather than resetting them.

    if (Array.isArray(profile) && profile.length > 0) {
      // Server has a claimed display name — it's the source of truth
      profileName = profile[0].display_name || '';
      safeLocalSet('profile_name', profileName);
      loadProfile();
    } else if (profile !== null && profileName) {
      // No server row yet, but a local name exists from before this feature —
      // try to claim it server-side. If someone else already has it, leave it
      // local-only; the profile modal will prompt for a different name next
      // time it's opened, same as any other "taken" case.
      sbUpsertProfile(profileName).catch(e => log.warn('[loadAllData] Initial profile migration failed:', e.message));
    }

    log.info('[loadAllData] Success — trades:', TRADES.length, 'holdings:', HOLDINGS.length);
    renderAll();
    startPriceRefresh();
  } catch (e) {
    log.error('[loadAllData] Failed:', e.message);
    if (e.message === 'SESSION_EXPIRED') {
      toast('Session expired — please sign in again', 'err');
      clearAuthStorage();
      showAuthScreen();
    } else {
      toast('Failed to load data: ' + e.message, 'err');
    }
  }
  showLoading(false);
}

// ─── LIVE CRYPTO PRICES (CoinGecko Pro) ──────────────────────────────────────
const CG_KEY = APP_CONFIG.COINGECKO_API_KEY;
const CG_BASE = 'https://api.coingecko.com/api/v3';
const CG_HEADERS = { 'x-cg-demo-api-key': CG_KEY };

// Well-known overrides to avoid ambiguity (symbol → coingecko id)
const CG_OVERRIDES = {
  BTC:'bitcoin', ETH:'ethereum', SOL:'solana', BNB:'binancecoin',
  XRP:'ripple', ADA:'cardano', DOGE:'dogecoin', MATIC:'matic-network',
  AVAX:'avalanche-2', DOT:'polkadot', LINK:'chainlink', UNI:'uniswap',
  LTC:'litecoin', ATOM:'cosmos', FTM:'fantom', NEAR:'near',
  ALGO:'algorand', VET:'vechain', SHIB:'shiba-inu', TON:'the-open-network',
  PEPE:'pepe', WIF:'dogwifcoin', BONK:'bonk', JUP:'jupiter-exchange-solana',
  OP:'optimism', ARB:'arbitrum', SUI:'sui', INJ:'injective-protocol',
  TIA:'celestia', SEI:'sei-network', PYTH:'pyth-network', RENDER:'render-token',
  FET:'fetch-ai', GRT:'the-graph', AAVE:'aave', MKR:'maker',
  CRV:'curve-dao-token', SNX:'synthetix-network-token', COMP:'compound-governance-token',
  SUSHI:'sushi', YFI:'yearn-finance', BAT:'basic-attention-token',
  CHZ:'chiliz', XLM:'stellar', TRX:'tron', XMR:'monero',
  BCH:'bitcoin-cash', ETC:'ethereum-classic', LDO:'lido-dao',
  STETH:'staked-ether', WBTC:'wrapped-bitcoin', APT:'aptos',
};

// Cache: symbol → coingecko id (session only)
let symbolIdCache = JSON.parse(sessionStorage.getItem('cg_id_cache') || '{}');

function cleanSymbol(raw) {
  return (raw || '').toUpperCase()
    .replace('/USDT','').replace('/USDC','').replace('/USD','')
    .replace('/BTC','').replace('/ETH','').trim();
}

// Resolve unknown symbols via CoinGecko search (one call per unknown symbol)
async function resolveSymbolIds(symbols) {
  const unknown = symbols.filter(s => !symbolIdCache[s] && !CG_OVERRIDES[s]);
  for (const sym of unknown) {
    try {
      const res = await fetch(`${CG_BASE}/search?query=${sym}`, { headers: CG_HEADERS });
      if (!res.ok) continue;
      const data = await res.json();
      // Pick first coin whose symbol matches exactly
      const match = (data.coins || []).find(c => c.symbol.toUpperCase() === sym);
      if (match) {
        symbolIdCache[sym] = match.id;
      }
    } catch(e) {
      log.warn('CoinGecko search failed for', sym, e.message);
    }
  }
  sessionStorage.setItem('cg_id_cache', JSON.stringify(symbolIdCache));
}

async function fetchLivePrices() {
  const cryptoHoldings = HOLDINGS.filter(h => h.type === 'Crypto');
  if (cryptoHoldings.length === 0) return;

  const symbols = [...new Set(cryptoHoldings.map(h => cleanSymbol(h.symbol)))];
  setPriceStatus('fetching');

  // Resolve unknown symbols
  await resolveSymbolIds(symbols);

  // Build id list: overrides first, then cache
  const ids = symbols.map(s => CG_OVERRIDES[s] || symbolIdCache[s]).filter(Boolean);
  if (ids.length === 0) { setPriceStatus('error'); return; }

  try {
    const res = await fetch(
      `${CG_BASE}/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`,
      { headers: CG_HEADERS }
    );
    if (!res.ok) throw new Error('CoinGecko ' + res.status);
    const data = await res.json();

    // Map results back to symbols
    symbols.forEach(sym => {
      const id = CG_OVERRIDES[sym] || symbolIdCache[sym];
      if (id && data[id] && data[id].usd) {
        livePrices[sym] = {
          price: data[id].usd,
          change24h: data[id].usd_24h_change || 0,
        };
      }
    });

    // Apply live prices to HOLDINGS
    HOLDINGS.forEach(h => {
      const sym = cleanSymbol(h.symbol);
      if (livePrices[sym]) {
        h.curPrice = livePrices[sym].price;
        h.livePrice = true;
      }
    });

    lastPriceUpdate = new Date();
    setPriceStatus('live');
    renderAll();
  } catch (e) {
    log.warn('Live price fetch failed:', e.message);
    setPriceStatus('error');
  }
}

function setPriceStatus(status) {
  const el = document.getElementById('price-status');
  if (!el) return;
  const map = {
    fetching: { text: '⟳ Fetching prices…', color: 'var(--muted)' },
    live:     { text: `● Live · ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`, color: 'var(--green)' },
    error:    { text: '⚠ Price fetch failed', color: 'var(--amber)' },
  };
  const s = map[status] || map.error;
  el.textContent = s.text;
  el.style.color = s.color;
}

function startPriceRefresh() {
  fetchLivePrices();
  if (priceRefreshTimer) clearInterval(priceRefreshTimer);
  priceRefreshTimer = setInterval(fetchLivePrices, 60000); // refresh every 60s
}

// ─── NORMALIZE TRADE ──────────────────────────────────────────────────────────
// Normalize trade fields from DB (generated columns come back from Supabase)
function normalizeTrade(t) {
  return {
    ...t,
    entry: parseFloat(t.entry),
    exit: t.exit != null ? parseFloat(t.exit) : null,
    size: parseFloat(t.size),
    pnl: parseFloat(t.pnl) || 0,
    rr: t.rr != null ? parseFloat(t.rr) : null,
    sl: t.sl != null ? parseFloat(t.sl) : null,
    tp: t.tp != null ? parseFloat(t.tp) : null,
  };
}

function assetColor(sym) {
  const map = { BTC: '#F7931A', ETH: '#627EEA', SOL: '#9945FF', BNB: '#F3BA2F', ADA: '#0033AD', NVDA: '#76B900', AAPL: '#555', MSFT: '#00A4EF', SPY: '#4A9EFF', GOLD: '#FFD700' };
  return map[(sym||'').toUpperCase()] || '#8B8FA8';
}

function showLoading(on) {
  document.getElementById('loading-bar').style.display = on ? 'block' : 'none';
}

// ─── NAVIGATION ───────────────────────────────────────────────────────────────
const PAGE_TITLES = { dashboard: 'Dashboard', trades: 'Trade Log', analytics: 'Analytics', investing: 'Portfolio', equity: 'Equity Curve', calendar: 'P&L Calendar', query: 'Query Builder', yearly: 'Yearly Recap', schema: 'DB Schema' };

function showPage(id, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  el.classList.add('active');
  document.getElementById('page-title').textContent = PAGE_TITLES[id] || id;
  // Re-render calendar fresh every time it's navigated to
  if (id === 'calendar') {
    renderCalendar();
    renderDailyPnlLog();
  }
  if (id === 'yearly') {
    renderYearlyRecap();
  }
}

// ─── CURRENCY ─────────────────────────────────────────────────────────────────
function setCurrency(c, btn) {
  currency = c;
  document.querySelectorAll('.currency-toggle button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderAll();
}

function renderAll() {
  const stats = computeStats();
  updateStatCards(stats);
  renderTrades();
  renderHoldings();
  renderRealizedHistory();
  renderInvestingStats();
  renderTradingBalance();
  renderHeatmap();
  renderCalendar();
  renderDailyPnlLog();
  destroyCharts();
  initCharts(stats);
}

// ─── STATS COMPUTATION ────────────────────────────────────────────────────────
function computeStats(tradesOverride) {
  const src = tradesOverride || TRADES;
  const closed = src.filter(t => t.status !== 'Open');
  const wins = closed.filter(t => t.status === 'Win');
  const losses = closed.filter(t => t.status === 'Loss');
  const open = src.filter(t => t.status === 'Open');

  const totalPnl = closed.reduce((s, t) => s + t.pnl, 0);
  const winRate = closed.length ? (wins.length / closed.length * 100).toFixed(1) : '0.0';
  const rrVals = closed.filter(t => t.rr != null).map(t => t.rr);
  const avgRR = rrVals.length ? (rrVals.reduce((a, b) => a + b, 0) / rrVals.length) : null;
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
  const expectancy = closed.length ? (wins.length / closed.length) * avgWin + (losses.length / closed.length) * avgLoss : 0;
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? (grossWin / grossLoss) : null;

  const sortedClosed = [...closed].sort((a, b) => b.pnl - a.pnl);
  const bestTrade = sortedClosed[0] || null;
  const worstTrade = sortedClosed[sortedClosed.length - 1] || null;

  // Streaks
  let bestStreak = 0, worstStreak = 0, cur = 0;
  const statusSeq = [...src].sort((a, b) => new Date(a.date) - new Date(b.date))
    .filter(t => t.status !== 'Open').map(t => t.status);
  for (const s of statusSeq) {
    if (s === 'Win') { cur = cur >= 0 ? cur + 1 : 1; bestStreak = Math.max(bestStreak, cur); }
    else { cur = cur <= 0 ? cur - 1 : -1; worstStreak = Math.min(worstStreak, cur); }
  }

  // Max drawdown
  let peak = 0, dd = 0, running2 = 0;
  for (const t of [...closed].sort((a, b) => new Date(a.date) - new Date(b.date))) {
    running2 += t.pnl;
    if (running2 > peak) peak = running2;
    const curDd = peak > 0 ? (running2 - peak) / peak * 100 : 0;
    if (curDd < dd) dd = curDd;
  }

  // Investments
  const invTotal = HOLDINGS.reduce((s, h) => s + h.qty * h.curPrice, 0);
  const invCost = HOLDINGS.reduce((s, h) => s + h.qty * h.buyPrice, 0);
  const invPnl = invTotal - invCost;

  // Best holding
  const bestHolding = HOLDINGS.length ? HOLDINGS.reduce((a, b) => {
    const aRet = (a.curPrice - a.buyPrice) / a.buyPrice;
    const bRet = (b.curPrice - b.buyPrice) / b.buyPrice;
    return aRet > bRet ? a : b;
  }) : null;

  return {
    totalPnl, winRate, avgRR, avgWin, avgLoss, expectancy,
    grossWin, grossLoss, profitFactor,
    bestTrade, worstTrade, bestStreak, worstStreak,
    wins, losses, open, closed, maxDrawdown: dd,
    invTotal, invCost, invPnl, bestHolding
  };
}

// Wrap a value in balance-val span so blur applies to it
const bv = (val) => `<span class="balance-val">${val}</span>`;

function updateStatCards(s) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerHTML = val; };
  const setClass = (id, cls) => { const el = document.getElementById(id); if (el) el.className = 'stat-val ' + cls; };

  // Dashboard
  set('stat-pnl', s.totalPnl !== 0 || s.closed.length ? bv(fmt(s.totalPnl)) : '—');
  setClass('stat-pnl', s.totalPnl >= 0 ? 'green' : 'red');
  set('stat-pnl-sub', s.closed.length ? `${s.winRate}% win rate` : 'No closed trades');
  set('stat-winrate', s.closed.length ? s.winRate + '%' : '—');
  set('stat-winrate-sub', s.closed.length ? `${s.wins.length}W / ${s.losses.length}L / ${s.open.length} Open` : '—');
  set('stat-rr', s.avgRR != null ? s.avgRR.toFixed(2) + 'R' : '—');
  set('stat-rr-sub', s.avgRR ? 'Avg achieved' : 'No RR data');
  set('stat-expect', s.closed.length ? bv(fmt(s.expectancy)) : '—');
  setClass('stat-expect', s.expectancy >= 0 ? 'stat-val green' : 'stat-val red');
  set('stat-best', s.bestTrade ? bv(fmt(s.bestTrade.pnl)) : '—');
  set('stat-best-sym', s.bestTrade ? s.bestTrade.symbol : '—');
  set('stat-worst', s.worstTrade ? bv(fmt(s.worstTrade.pnl)) : '—');
  set('stat-worst-sym', s.worstTrade ? s.worstTrade.symbol : '—');
  set('eq-meta', s.totalPnl !== 0 ? bv(fmt(s.totalPnl)) + ' total' : 'No data');
  set('wl-meta', s.closed.length + ' closed trades');

  // Trade log
  set('tl-total', TRADES.length || '—');
  set('tl-total-sub', TRADES.length ? `${s.closed.length} closed, ${s.open.length} open` : '—');
  set('tl-pf', s.profitFactor != null ? s.profitFactor.toFixed(2) : '—');
  set('tl-avgwin', s.wins.length ? bv(fmt(s.avgWin)) : '—');
  set('tl-avgloss', s.losses.length ? bv(fmt(s.avgLoss)) : '—');
  set('tl-bstreak', s.bestStreak > 0 ? s.bestStreak + 'W' : '—');
  set('tl-wstreak', s.worstStreak < 0 ? Math.abs(s.worstStreak) + 'L' : '—');

  // Portfolio
  const invPct = s.invCost > 0 ? (s.invPnl / s.invCost * 100).toFixed(1) : null;
  set('inv-ret-pct', invPct != null ? `<span class="${parseFloat(invPct) >= 0 ? 'green' : 'red'}">${parseFloat(invPct) >= 0 ? '+' : ''}${invPct}%</span>` : '—');
  set('inv-count', HOLDINGS.length ? `Across ${HOLDINGS.length} asset${HOLDINGS.length !== 1 ? 's' : ''}` : 'No holdings');
  set('inv-pnl', s.invTotal ? bv(fmt(s.invPnl)) : '—');
  set('inv-pnl-pct', invPct ? `${parseFloat(invPct) >= 0 ? '+' : ''}${invPct}% on cost` : '—');
  const el = document.getElementById('inv-pnl');
  if (el) el.className = 'stat-val ' + (s.invPnl >= 0 ? 'green' : 'red');
  if (s.bestHolding) {
    const bh = s.bestHolding;
    const bhPct = ((bh.curPrice - bh.buyPrice) / bh.buyPrice * 100).toFixed(1);
    set('inv-best', `${parseFloat(bhPct) >= 0 ? '+' : ''}${bhPct}%`);
    set('inv-best-sym', bh.symbol);
  } else {
    set('inv-best', '—'); set('inv-best-sym', '—');
  }
  // Worst holding
  if (HOLDINGS.length > 0) {
    const worstH = HOLDINGS.reduce((a, b) => {
      const ar = (a.curPrice - a.buyPrice) / a.buyPrice;
      const br = (b.curPrice - b.buyPrice) / b.buyPrice;
      return ar < br ? a : b;
    });
    const wPct = ((worstH.curPrice - worstH.buyPrice) / worstH.buyPrice * 100).toFixed(1);
    set('inv-worst', `${parseFloat(wPct) >= 0 ? '+' : ''}${wPct}%`);
    set('inv-worst-sym', worstH.symbol);
  } else {
    set('inv-worst', '—'); set('inv-worst-sym', '—');
  }

  // Equity curve page - show % return not raw equity
  const tradingRetPct = s.closed.length && s.closed[0]?.size
    ? null // Can't easily compute initial capital, skip
    : null;
  set('ov-equity', s.invTotal ? `<span class="balance-val">${fmtVal(s.invTotal)}</span>` : '—');
  set('ov-return', s.closed.length ? bv(fmt(s.totalPnl)) : '—');
  const retEl2 = document.getElementById('ov-return');
  if (retEl2) retEl2.className = 'stat-val ' + (s.totalPnl >= 0 ? 'green' : 'red');
  set('ov-return-sub', s.closed.length ? 'Trading P&L' : '—');
  set('ov-dd', s.maxDrawdown ? s.maxDrawdown.toFixed(1) + '%' : '—');
  set('ov-trades', s.closed.length || '—');
  set('ov-meta', s.closed.length ? `${s.closed.length} closed trades` : 'No data');

  // Sidebar — show % return if we have portfolio data, else trading P&L
  const sidebarPct = s.invCost > 0 ? (s.invPnl / s.invCost * 100).toFixed(1) : null;
  set('sidebar-equity', bv(s.invTotal ? fmtVal(s.invTotal) : fmtVal(0)));
  set('sidebar-change', sidebarPct
    ? `${parseFloat(sidebarPct) >= 0 ? '+' : ''}${sidebarPct}% portfolio return`
    : s.totalPnl !== 0 ? bv(fmt(s.totalPnl)) + ' trading' : 'No data');
}

// ─── YEARLY RECAP ─────────────────────────────────────────────────────────────
let selectedRecapYear = null;

function getAvailableYears() {
  const years = new Set(TRADES.map(t => parseInt(t.date.split('-')[0], 10)));
  years.add(new Date().getFullYear()); // always offer the current year, even with no trades logged yet
  return [...years].sort((a, b) => b - a);
}

function renderYearlyRecap() {
  const years = getAvailableYears();
  if (selectedRecapYear === null || !years.includes(selectedRecapYear)) {
    selectedRecapYear = years[0];
  }

  const sel = document.getElementById('yr-year-select');
  if (sel) {
    sel.innerHTML = years.map(y => `<option value="${y}" ${y === selectedRecapYear ? 'selected' : ''}>${y}</option>`).join('');
  }

  const yearTrades = TRADES.filter(t => parseInt(t.date.split('-')[0], 10) === selectedRecapYear);
  const s = computeStats(yearTrades);

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerHTML = val; };
  const setClass = (id, cls) => { const el = document.getElementById(id); if (el) el.className = 'stat-val ' + cls; };

  set('yr-pnl', s.totalPnl !== 0 || s.closed.length ? bv(fmt(s.totalPnl)) : '—');
  setClass('yr-pnl', s.totalPnl >= 0 ? 'green' : 'red');
  set('yr-pnl-sub', s.closed.length ? `${s.winRate}% win rate` : 'No closed trades');

  set('yr-winrate', s.closed.length ? s.winRate + '%' : '—');
  set('yr-winrate-sub', s.closed.length ? `${s.wins.length}W / ${s.losses.length}L / ${s.open.length} Open` : '—');

  set('yr-rr', s.avgRR != null ? s.avgRR.toFixed(2) + 'R' : '—');
  set('yr-rr-sub', s.avgRR ? 'Avg achieved' : 'No RR data');

  set('yr-expect', s.closed.length ? bv(fmt(s.expectancy)) : '—');
  setClass('yr-expect', s.expectancy >= 0 ? 'green' : 'red');

  set('yr-best', s.bestTrade ? bv(fmt(s.bestTrade.pnl)) : '—');
  set('yr-best-sym', s.bestTrade ? s.bestTrade.symbol : '—');
  set('yr-worst', s.worstTrade ? bv(fmt(s.worstTrade.pnl)) : '—');
  set('yr-worst-sym', s.worstTrade ? s.worstTrade.symbol : '—');

  renderHeatmapInto('yearly-heatmap', selectedRecapYear);
}

function onRecapYearChange(value) {
  selectedRecapYear = parseInt(value, 10);
  renderYearlyRecap();
}

// ─── MODAL ────────────────────────────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ─── ADD FUNDS (shared modal — deposits to either cash or trading balance) ───
function openAddFundsModal(target) {
  document.getElementById('af-target').value = target;
  document.getElementById('af-title').textContent = target === 'trading' ? 'Add Funds — Trading Balance' : 'Deposit Cash';
  document.getElementById('af-sub').textContent = target === 'trading'
    ? 'Adds directly to your trading balance, separate from realized trade P&L.'
    : 'Adds directly to your investment cash balance.';
  document.getElementById('af-amount').value = '';
  openModal('add-funds-modal');
}

async function submitAddFunds() {
  const target = document.getElementById('af-target').value;
  const amount = parseFloat(document.getElementById('af-amount').value);
  if (!amount || amount <= 0) return toast('Enter an amount greater than 0', 'err');

  const btn = document.getElementById('af-submit-btn');
  btn.textContent = 'Adding…'; btn.disabled = true;

  try {
    if (target === 'trading') {
      tradingBalance = parseFloat((tradingBalance + amount).toFixed(2));
    } else {
      cashBalance = parseFloat((cashBalance + amount).toFixed(2));
    }
    await saveUserSettings();
    closeModal('add-funds-modal');
    renderAll();
    toast(`$${amount.toFixed(2)} added ✓`);
  } catch (e) {
    toast(e.message, 'err');
  }
  btn.textContent = 'Add Funds'; btn.disabled = false;
}
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.modal-overlay').forEach(o => {
    o.addEventListener('click', e => { if (e.target === o) o.classList.remove('open'); });
  });
  document.getElementById('t-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('i-date').value = new Date().toISOString().split('T')[0];
});

// ─── TRADE MODAL OPEN/RESET ───────────────────────────────────────────────────
function openAddTrade() {
  document.getElementById('trade-modal-title').textContent = 'Log New Trade';
  document.getElementById('log-trade-btn').textContent = 'Log Trade';
  document.getElementById('t-edit-id').value = '';
  ['t-symbol','t-entry','t-exit','t-size','t-sl','t-tp','t-setup','t-notes','t-tags'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('t-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('t-type').value = 'Crypto';
  document.getElementById('t-dir').value = 'Long';
  openModal('trade-modal');
}

function openEditTrade(id) {
  const t = TRADES.find(t => t.id === id);
  if (!t) return;
  document.getElementById('trade-modal-title').textContent = 'Edit Trade';
  document.getElementById('log-trade-btn').textContent = 'Save Changes';
  document.getElementById('t-edit-id').value = id;
  document.getElementById('t-symbol').value = t.symbol || '';
  document.getElementById('t-type').value = t.type || 'Crypto';
  document.getElementById('t-dir').value = t.dir || 'Long';
  document.getElementById('t-date').value = t.date || '';
  document.getElementById('t-entry').value = t.entry || '';
  document.getElementById('t-exit').value = t.exit != null ? t.exit : '';
  document.getElementById('t-size').value = t.size || '';
  document.getElementById('t-sl').value = t.sl != null ? t.sl : '';
  document.getElementById('t-tp').value = t.tp != null ? t.tp : '';
  document.getElementById('t-setup').value = t.setup || '';
  document.getElementById('t-notes').value = t.notes || '';
  document.getElementById('t-tags').value = Array.isArray(t.tags) ? t.tags.join(', ') : (t.tags || '');
  openModal('trade-modal');
}

// ─── SAVE TRADE (ADD + EDIT) ──────────────────────────────────────────────────
async function saveTrade() {
  const editId = document.getElementById('t-edit-id').value;
  const entry = parseFloat(document.getElementById('t-entry').value);
  const exitVal = document.getElementById('t-exit').value;
  const exit = exitVal ? parseFloat(exitVal) : null;
  const size = parseFloat(document.getElementById('t-size').value);
  const sl = document.getElementById('t-sl').value ? parseFloat(document.getElementById('t-sl').value) : null;
  const tp = document.getElementById('t-tp').value ? parseFloat(document.getElementById('t-tp').value) : null;
  const symbol = document.getElementById('t-symbol').value.trim().toUpperCase() || 'UNKNOWN';
  const dir = document.getElementById('t-dir').value;
  const tagsRaw = document.getElementById('t-tags').value;
  const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) : null;

  if (!entry || !size) return toast('Entry price and size are required', 'err');

  let rr = null;
  if (exit && sl) {
    const risk = Math.abs(entry - sl) / entry * size;
    const pnlCalc = (dir === 'Long' ? (exit - entry) / entry : (entry - exit) / entry) * size;
    rr = risk > 0 ? parseFloat((pnlCalc / risk).toFixed(4)) : null;
  }

  const payload = {
    date: document.getElementById('t-date').value || new Date().toISOString().split('T')[0],
    symbol, type: document.getElementById('t-type').value,
    dir, entry, exit, size, sl, tp, rr,
    setup: document.getElementById('t-setup').value || null,
    notes: document.getElementById('t-notes').value || null,
    tags
  };

  const btn = document.getElementById('log-trade-btn');
  btn.textContent = 'Saving…'; btn.disabled = true;

  try {
    if (editId) {
      const result = await sbUpdate('trades', editId, payload);
      const updated = result && result[0] ? normalizeTrade(result[0]) : null;
      if (updated) {
        const idx = TRADES.findIndex(t => t.id === editId);
        const oldPnl = idx !== -1 ? (TRADES[idx].pnl || 0) : 0;
        if (idx !== -1) TRADES[idx] = updated;

        // Trading balance tracks realized P&L, not the trade itself — only
        // the delta between old and new realized P&L needs to move it
        // (covers going Open→Closed, Closed→Open, or a correction to an
        // already-closed trade's numbers).
        const delta = parseFloat(((updated.pnl || 0) - oldPnl).toFixed(2));
        if (delta !== 0) {
          tradingBalance = parseFloat((tradingBalance + delta).toFixed(2));
          await saveUserSettings();
        }
      }
      toast('Trade updated ✓');
    } else {
      const result = await sbInsert('trades', { ...payload, user_id: currentUser.id });
      if (result && result[0]) {
        const inserted = normalizeTrade(result[0]);
        TRADES.unshift(inserted);

        // Logged already-closed (exit filled in at creation) — realize its P&L immediately.
        if (inserted.pnl) {
          tradingBalance = parseFloat((tradingBalance + inserted.pnl).toFixed(2));
          await saveUserSettings();
        }
        toast('Trade logged ✓');
      }
    }
    closeModal('trade-modal');
    renderAll();
  } catch (e) {
    toast(e.message, 'err');
  }
  btn.textContent = editId ? 'Save Changes' : 'Log Trade';
  btn.disabled = false;
}

// ─── CLOSE TRADE (QUICK EXIT) ─────────────────────────────────────────────────
function openCloseTrade(id) {
  const t = TRADES.find(t => t.id === id);
  if (!t) return;
  document.getElementById('ct-trade-id').value = id;
  document.getElementById('ct-exit').value = '';
  document.getElementById('ct-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('close-trade-info').textContent =
    `${t.symbol} ${t.dir} · Entry: ${t.entry.toLocaleString()}`;
  openModal('close-trade-modal');
}

async function closeTradeSubmit() {
  const id = document.getElementById('ct-trade-id').value;
  const exit = parseFloat(document.getElementById('ct-exit').value);
  const date = document.getElementById('ct-date').value;
  if (!exit) return toast('Enter exit price', 'err');

  const t = TRADES.find(t => t.id === id);
  if (!t) return;

  let rr = null;
  if (t.sl) {
    const risk = Math.abs(t.entry - t.sl) / t.entry * t.size;
    const pnlCalc = (t.dir === 'Long' ? (exit - t.entry) / t.entry : (t.entry - exit) / t.entry) * t.size;
    rr = risk > 0 ? parseFloat((pnlCalc / risk).toFixed(4)) : null;
  }

  const btn = document.getElementById('close-trade-btn');
  btn.textContent = 'Closing…'; btn.disabled = true;

  try {
    const oldPnl = t.pnl || 0; // 0 for an open trade, but computed generically for safety
    const result = await sbUpdate('trades', id, { exit, date, rr });
    const updated = result && result[0] ? normalizeTrade(result[0]) : null;
    if (updated) {
      const idx = TRADES.findIndex(t => t.id === id);
      if (idx !== -1) TRADES[idx] = updated;

      const delta = parseFloat(((updated.pnl || 0) - oldPnl).toFixed(2));
      if (delta !== 0) {
        tradingBalance = parseFloat((tradingBalance + delta).toFixed(2));
        await saveUserSettings();
      }
    }
    closeModal('close-trade-modal');
    renderAll();
    toast(`Trade closed ✓  Trading balance updated`);
  } catch (e) {
    toast(e.message, 'err');
  }
  btn.textContent = 'Close Trade'; btn.disabled = false;
}

// ─── EXPORT CSV ───────────────────────────────────────────────────────────────
function exportCSV() {
  if (TRADES.length === 0) return toast('No trades to export', 'err');
  const headers = ['Date','Symbol','Type','Direction','Entry','Exit','Size','P&L','RR','Status','Setup','Tags','Notes'];
  const rows = TRADES.map(t => [
    t.date, t.symbol, t.type, t.dir,
    t.entry, t.exit != null ? t.exit : '',
    t.size, t.pnl.toFixed(2),
    t.rr != null ? t.rr.toFixed(4) : '',
    t.status, t.setup || '',
    Array.isArray(t.tags) ? t.tags.join(';') : (t.tags || ''),
    (t.notes || '').replace(/,/g, ';').replace(/\n/g, ' ')
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tradelog_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV exported ✓');
}

// ─── DAILY P&L LOG ────────────────────────────────────────────────────────────
function renderDailyPnlLog() {
  const body = document.getElementById('daily-pnl-body');
  if (!body) return;

  // Group all closed trades by date
  const dayMap = {};
  TRADES.filter(t => t.status !== 'Open').forEach(t => {
    if (!dayMap[t.date]) dayMap[t.date] = [];
    dayMap[t.date].push(t);
  });

  // Sort dates descending (most recent first)
  const today = new Date().toISOString().split('T')[0];
  const sortedDays = Object.keys(dayMap)
    .filter(d => d <= today) // only past/today
    .sort((a, b) => b.localeCompare(a));

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
      <td class="mono" style="color:var(--muted)">${d}${isToday ? ' <span style="color:var(--amber);font-size:9px">TODAY</span>' : ''}</td>
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
  renderCalendarGrid();
  calSelectDay(calSelectedDay);
  // Scroll to calendar
  document.getElementById('page-calendar').scrollTo({ top: 0, behavior: 'smooth' });
}
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();
let calSelectedDay = null;

function calPrevMonth() {
  calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
  renderCalendar();
}
function calNextMonth() {
  calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
  renderCalendar();
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
      const intensity = Math.min(Math.abs(dayPnl) / maxAbs, 1);
      bg = dayPnl > 0
        ? `rgba(0,212,170,${0.15 + intensity * 0.55})`
        : `rgba(255,77,109,${0.15 + intensity * 0.55})`;

      // Smart formatting: use 0 decimals for large amounts, 2 for small
      let dispPnl;
      const absPnl = Math.abs(dayPnl);
      if (absPnl >= 10000) dispPnl = (dayPnl > 0 ? '+' : '-') + '$' + Math.round(absPnl / 1000) + 'k';
      else if (absPnl >= 1000) dispPnl = (dayPnl > 0 ? '+' : '-') + '$' + (Math.round(absPnl / 100) / 10) + 'k';
      else if (absPnl >= 1) dispPnl = fmt(dayPnl, 0);
      else dispPnl = fmt(dayPnl, 2); // small amounts like $0.11

      pnlStr = `<div class="cal-cell-pnl balance-val" style="color:${dayPnl > 0 ? 'var(--green)' : 'var(--red)'}; font-size:${absPnl < 1 ? '9px' : '10px'}">${dispPnl}</div>
                <div class="cal-cell-trades" style="color:${dayPnl > 0 ? 'var(--green)' : 'var(--red)'};opacity:0.7">${trades.length}t</div>`;
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

function calSelectDay(d) {
  // Toggle off if same day clicked
  calSelectedDay = calSelectedDay === d ? null : d;

  // Update active-day highlight without re-running full renderCalendar
  document.querySelectorAll('.cal-cell').forEach((el, idx) => {
    el.classList.remove('active-day');
  });
  // Re-render just the grid highlight by rebuilding cells
  renderCalendarGrid();

  const panel = document.getElementById('cal-day-trades');
  const title = document.getElementById('cal-day-title');
  const body = document.getElementById('cal-day-body');
  if (!panel) return;

  if (!calSelectedDay) { panel.style.display = 'none'; return; }

  const dayTrades = TRADES.filter(t => {
    const parts = t.date.split('-');
    return parseInt(parts[0]) === calYear && parseInt(parts[1]) - 1 === calMonth && parseInt(parts[2]) === calSelectedDay;
  });

  if (dayTrades.length === 0) { panel.style.display = 'none'; return; }

  const dateStr = new Date(calYear, calMonth, calSelectedDay).toLocaleDateString('default', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const dayPnl = dayTrades.reduce((s, t) => s + t.pnl, 0);
  title.innerHTML = `${dateStr} &nbsp;<span class="balance-val" style="font-family:var(--mono);font-size:11px;color:${dayPnl >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt(dayPnl)}</span>`;

  body.innerHTML = dayTrades.map(t => `<tr>
    <td style="font-weight:600">${t.symbol}</td>
    <td><span class="badge ${t.dir === 'Long' ? 'badge-long' : 'badge-short'}">${t.dir}</span></td>
    <td class="mono">${t.entry.toLocaleString()}</td>
    <td class="mono">${t.exit != null ? t.exit.toLocaleString() : '—'}</td>
    <td class="mono ${t.pnl > 0 ? 'green' : t.pnl < 0 ? 'red' : ''}"><span class="balance-val">${fmt(t.pnl)}</span></td>
    <td class="mono">${t.rr != null ? t.rr.toFixed(2) + 'R' : '—'}</td>
    <td><span class="badge ${t.status === 'Win' ? 'badge-win' : t.status === 'Loss' ? 'badge-loss' : 'badge-open'}">${t.status}</span></td>
  </tr>`).join('');
  panel.style.display = 'block';
}

// ─── ADD / EDIT INVESTMENT ────────────────────────────────────────────────────
function openEditInvestment(id) {
  const h = HOLDINGS.find(h => h.id === id);
  if (!h) return;

  document.getElementById('invest-modal-title').textContent = 'Edit Investment';
  document.getElementById('add-invest-btn').textContent = 'Save Changes';
  document.getElementById('i-edit-id').value = id;
  document.getElementById('i-symbol').value = h.symbol;
  document.getElementById('i-type').value = h.type;
  document.getElementById('i-date').value = h.buy_date || '';
  document.getElementById('i-qty').value = h.qty;
  document.getElementById('i-price').value = h.buyPrice;
  document.getElementById('i-cur').value = h.livePrice ? '' : h.curPrice || '';
  document.getElementById('i-notes').value = h.notes || '';

  // Lock symbol when editing
  document.getElementById('i-symbol').readOnly = true;
  document.getElementById('i-symbol').style.opacity = '0.5';

  openModal('invest-modal');
}

function openAddInvestment() {
  document.getElementById('invest-modal-title').textContent = 'Add Investment';
  document.getElementById('add-invest-btn').textContent = 'Add Holding';
  document.getElementById('i-edit-id').value = '';
  document.getElementById('i-symbol').readOnly = false;
  document.getElementById('i-symbol').style.opacity = '1';
  ['i-symbol', 'i-qty', 'i-price', 'i-cur', 'i-notes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('i-date').value = new Date().toISOString().split('T')[0];
  openModal('invest-modal');
}

async function saveInvestment() {
  const editId = document.getElementById('i-edit-id').value;
  const symbol = document.getElementById('i-symbol').value.trim().toUpperCase();
  const qty = parseFloat(document.getElementById('i-qty').value);
  const buy_price = parseFloat(document.getElementById('i-price').value);
  const cur_price = document.getElementById('i-cur').value ? parseFloat(document.getElementById('i-cur').value) : null;

  if (!symbol || !qty || !buy_price) return toast('Symbol, qty, and buy price required', 'err');

  const btn = document.getElementById('add-invest-btn');
  btn.textContent = 'Saving…'; btn.disabled = true;

  const payload = {
    symbol, type: document.getElementById('i-type').value,
    buy_date: document.getElementById('i-date').value || new Date().toISOString().split('T')[0],
    qty, buy_price, cur_price,
    notes: document.getElementById('i-notes').value || null
  };

  try {
    if (editId) {
      // EDIT MODE — adjust cash by the delta between old and new cost basis
      const idx = HOLDINGS.findIndex(h => h.id === editId);
      const oldCost = idx !== -1 ? HOLDINGS[idx].qty * HOLDINGS[idx].buyPrice : 0;
      const newCost = qty * buy_price;

      const result = await sbUpdate('investments', editId, payload);
      const updated = result && result[0] ? result[0] : { ...payload, id: editId };
      if (idx !== -1) {
        HOLDINGS[idx] = {
          ...HOLDINGS[idx],
          ...updated,
          buyPrice: buy_price,
          curPrice: cur_price > 0 ? cur_price : HOLDINGS[idx].curPrice || buy_price,
          qty,
          color: assetColor(symbol),
        };
      }

      cashBalance = parseFloat((cashBalance + oldCost - newCost).toFixed(2));
      await saveUserSettings();
      toast('Investment updated ✓');
    } else {
      // ADD MODE — buying with cash, so deduct the cost from cash balance
      const fullPayload = { ...payload, user_id: currentUser.id };
      const result = await sbInsert('investments', fullPayload);
      if (result && result[0]) {
        HOLDINGS.push({
          ...result[0],
          buyPrice: buy_price,
          curPrice: cur_price > 0 ? cur_price : buy_price,
          qty,
          color: assetColor(symbol),
          livePrice: false,
        });

        const cost = parseFloat((qty * buy_price).toFixed(2));
        cashBalance = parseFloat((cashBalance - cost).toFixed(2));
        await saveUserSettings();

        toast(`Investment added ✓  $${cost.toFixed(2)} deducted from cash`);
      }
    }

    closeModal('invest-modal');
    document.getElementById('i-symbol').readOnly = false;
    document.getElementById('i-symbol').style.opacity = '1';
    renderAll();
    // Re-fetch live price for this symbol
    fetchLivePrices();
  } catch (e) {
    toast(e.message, 'err');
  }

  btn.textContent = editId ? 'Save Changes' : 'Add Holding';
  btn.disabled = false;
}

// ─── DELETE TRADE ─────────────────────────────────────────────────────────────
async function deleteTrade(id) {
  const t = TRADES.find(t => t.id === id);
  const hasPnl = t && t.pnl;
  const confirmMsg = hasPnl
    ? `Delete this trade? Its realized P&L ($${t.pnl.toFixed(2)}) will be reversed from your trading balance.`
    : 'Delete this trade?';
  if (!confirm(confirmMsg)) return;
  try {
    await sbDelete('trades', id);
    TRADES = TRADES.filter(t => t.id !== id);

    if (hasPnl) {
      tradingBalance = parseFloat((tradingBalance - t.pnl).toFixed(2));
      await saveUserSettings();
    }

    renderAll();
    toast('Trade deleted');
  } catch (e) {
    toast(e.message, 'err');
  }
}

// ─── DELETE HOLDING ───────────────────────────────────────────────────────────
async function deleteHolding(id) {
  if (!confirm('Remove this holding? Its cost basis will be refunded to your cash balance.')) return;
  try {
    const h = HOLDINGS.find(h => h.id === id);
    await sbDelete('investments', id);
    HOLDINGS = HOLDINGS.filter(h => h.id !== id);

    if (h) {
      const refund = parseFloat((h.qty * h.buyPrice).toFixed(2));
      cashBalance = parseFloat((cashBalance + refund).toFixed(2));
      await saveUserSettings();
    }

    renderAll();
    toast('Holding removed');
  } catch (e) {
    toast(e.message, 'err');
  }
}

// ─── RENDER TABLES ────────────────────────────────────────────────────────────
let recentFilter = 'All';
let allFilter = 'All';

function filterRecent(f, btn) {
  recentFilter = f;
  document.querySelectorAll('#page-dashboard .table-filters .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderTrades();
}

function filterAll(f, btn) {
  allFilter = f;
  document.querySelectorAll('#page-trades .table-filters .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderTrades();
}

function tradeRow(t, showNotes = false, showActions = false) {
  const pnl = t.pnl;
  const rr = t.rr;
  // Escape all user-supplied strings before injection into innerHTML
  const safeSymbol = esc(t.symbol);
  const safeType   = esc(t.type);
  const safeDir    = esc(t.dir);
  const safeStatus = esc(t.status);
  const safeNotes  = esc(t.notes) || '—';
  const safeId     = esc(t.id);
  const tagsHtml   = Array.isArray(t.tags) && t.tags.length
    ? t.tags.map(tag => `<span class="tag-chip">${esc(tag)}</span>`).join('')
    : '—';

  return `<tr>
    <td class="mono" style="color:var(--muted)">${esc(t.date)}</td>
    <td style="font-weight:600">${safeSymbol}</td>
    <td><span style="font-size:10px;color:var(--muted)">${safeType}</span></td>
    <td><span class="badge ${safeDir === 'Long' ? 'badge-long' : 'badge-short'}">${safeDir}</span></td>
    <td class="mono">${t.entry.toLocaleString()}</td>
    <td class="mono">${t.exit != null ? t.exit.toLocaleString() : '<span style="color:var(--amber)">Open</span>'}</td>
    <td class="mono ${pnl > 0 ? 'green' : pnl < 0 ? 'red' : ''}"><span class="balance-val">${safeStatus === 'Open' ? '—' : fmt(pnl)}</span></td>
    <td class="mono ${rr != null && rr > 0 ? 'green' : rr != null && rr < 0 ? 'red' : ''}">${rr != null ? rr.toFixed(2) + 'R' : '—'}</td>
    <td><span class="badge ${safeStatus === 'Win' ? 'badge-win' : safeStatus === 'Loss' ? 'badge-loss' : 'badge-open'}">${safeStatus}</span></td>
    ${showNotes ? `<td style="max-width:120px">${tagsHtml}</td>` : ''}
    ${showNotes ? `<td style="color:var(--muted);font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis">${safeNotes}</td>` : ''}
    ${showActions ? `<td style="white-space:nowrap">
      ${safeStatus === 'Open' ? `<button class="btn-close-mini" data-action="open-close-trade" data-id="${safeId}">Close</button>` : ''}
      <button class="icon-btn-edit" data-action="open-edit-trade" data-id="${safeId}" style="background:none;border:none;cursor:pointer;font-size:12px;padding:2px 5px;border-radius:4px">✎</button>
      <button class="icon-btn-delete" data-action="delete-trade" data-id="${safeId}" style="background:none;border:none;cursor:pointer;font-size:12px;padding:2px 5px;border-radius:4px">✕</button>
    </td>` : ''}
  </tr>`;
}

function emptyRow(cols, msg) {
  return `<tr><td colspan="${cols}" style="text-align:center;padding:32px;color:var(--muted)">${msg}</td></tr>`;
}

// ─── REALIZED P&L / CASH SYSTEM ───────────────────────────────────────────────
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

async function saveUserSettings() {
  safeLocalSet('realized_history', JSON.stringify(realizedHistory));
  safeLocalSet('cash_balance', cashBalance.toString());
  safeLocalSet('trading_balance', tradingBalance.toString());
  try {
    await sbUpsertSettings();
  } catch (e) {
    log.warn('[saveUserSettings] Supabase sync failed, kept locally:', e.message);
    toast('Saved locally — sync to server failed', 'err');
  }
}

async function clearRealizedHistory() {
  if (!confirm('Clear all realized P&L history and reset cash balance to $0?')) return;
  realizedHistory = [];
  cashBalance = 0;
  await saveUserSettings();
  renderRealizedHistory();
  renderInvestingStats();
  toast('Realized history cleared');
}

// ─── OPEN CLOSE POSITION MODAL ────────────────────────────────────────────────
function openClosePosition(id) {
  const h = HOLDINGS.find(h => h.id === id);
  if (!h) return;

  document.getElementById('cp-holding-id').value = id;
  document.getElementById('cp-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('cp-exit-price').value = h.curPrice > 0 ? h.curPrice : '';
  document.getElementById('cp-qty').value = h.qty;
  document.getElementById('cp-type').value = 'full';

  document.getElementById('close-pos-info').innerHTML = `
    <div><div style="color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:0.5px">Symbol</div><div style="font-family:var(--mono);font-weight:700;margin-top:2px">${esc(h.symbol)}</div></div>
    <div><div style="color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:0.5px">Holdings</div><div style="font-family:var(--mono);font-weight:700;margin-top:2px">${h.qty} units</div></div>
    <div><div style="color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:0.5px">Avg Buy Price</div><div style="font-family:var(--mono);font-weight:700;margin-top:2px">$${h.buyPrice.toFixed(4)}</div></div>
    <div><div style="color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:0.5px">Current Price</div><div style="font-family:var(--mono);font-weight:700;margin-top:2px;color:${h.livePrice ? 'var(--green)' : 'var(--text)'}">$${h.curPrice.toFixed(4)}${h.livePrice ? ' ●' : ''}</div></div>
  `;

  updateClosePnl();
  document.getElementById('close-position-modal').classList.add('open');
}

function onCloseTypeChange() {
  const id = document.getElementById('cp-holding-id').value;
  const h = HOLDINGS.find(h => h.id === id);
  if (!h) return;
  const type = document.getElementById('cp-type').value;
  if (type === 'full') document.getElementById('cp-qty').value = h.qty;
  updateClosePnl();
}

function updateClosePnl() {
  const id = document.getElementById('cp-holding-id').value;
  const h = HOLDINGS.find(h => h.id === id);
  if (!h) return;

  const exitPrice = parseFloat(document.getElementById('cp-exit-price').value) || 0;
  const qty = parseFloat(document.getElementById('cp-qty').value) || 0;

  if (!exitPrice || !qty) {
    document.getElementById('cp-pnl-val').textContent = '—';
    document.getElementById('cp-proceeds-val').textContent = '—';
    document.getElementById('cp-ret-val').textContent = '—';
    return;
  }

  const realizedPnl = (exitPrice - h.buyPrice) * qty;
  const proceeds = exitPrice * qty;
  const retPct = ((exitPrice - h.buyPrice) / h.buyPrice * 100).toFixed(2);

  const pnlEl = document.getElementById('cp-pnl-val');
  const procEl = document.getElementById('cp-proceeds-val');
  const retEl  = document.getElementById('cp-ret-val');

  pnlEl.textContent = (realizedPnl >= 0 ? '+$' : '-$') + Math.abs(realizedPnl).toFixed(2);
  pnlEl.style.color = realizedPnl >= 0 ? 'var(--green)' : 'var(--red)';
  procEl.textContent = '$' + proceeds.toFixed(2);
  procEl.style.color = 'var(--text)';
  retEl.textContent = (retPct >= 0 ? '+' : '') + retPct + '%';
  retEl.style.color = retPct >= 0 ? 'var(--green)' : 'var(--red)';
}

// ─── SUBMIT CLOSE POSITION ────────────────────────────────────────────────────
async function submitClosePosition() {
  const id = document.getElementById('cp-holding-id').value;
  const h = HOLDINGS.find(h => h.id === id);
  if (!h) return;

  const exitPrice = parseFloat(document.getElementById('cp-exit-price').value);
  const qtySold   = parseFloat(document.getElementById('cp-qty').value);
  const closeDate = document.getElementById('cp-date').value;
  const closeType = document.getElementById('cp-type').value;

  if (!exitPrice || !qtySold) return toast('Enter exit price and qty', 'err');
  if (qtySold > h.qty) return toast(`Max qty is ${h.qty}`, 'err');

  const realizedPnl = (exitPrice - h.buyPrice) * qtySold;
  const proceeds    = exitPrice * qtySold;

  const btn = document.getElementById('cp-submit-btn');
  btn.textContent = 'Processing…'; btn.disabled = true;

  try {
    const isFullClose = closeType === 'full' || Math.abs(qtySold - h.qty) < 0.000001;

    if (isFullClose) {
      await sbDelete('investments', id);
      HOLDINGS = HOLDINGS.filter(h => h.id !== id);
    } else {
      const newQty = parseFloat((h.qty - qtySold).toFixed(8));
      await sbUpdate('investments', id, { qty: newQty, cur_price: exitPrice });
      const idx = HOLDINGS.findIndex(h => h.id === id);
      if (idx !== -1) HOLDINGS[idx].qty = newQty;
    }

    const record = {
      id: Date.now().toString(),
      date: closeDate,
      symbol: h.symbol,
      type: h.type,
      qtySold: parseFloat(qtySold.toFixed(8)),
      avgCost: parseFloat(h.buyPrice.toFixed(6)),
      exitPrice: parseFloat(exitPrice.toFixed(6)),
      realizedPnl: parseFloat(realizedPnl.toFixed(2)),
      proceeds: parseFloat(proceeds.toFixed(2)),
      closeType: isFullClose ? 'Full' : 'Partial'
    };
    realizedHistory.unshift(record);

    cashBalance = parseFloat((cashBalance + proceeds).toFixed(2));
    await saveUserSettings();

    closeModal('close-position-modal');
    renderAll();
    toast(`Position closed ✓  ${realizedPnl >= 0 ? '+' : ''}$${realizedPnl.toFixed(2)} realized`);
  } catch (e) {
    toast(e.message, 'err');
  }

  btn.textContent = 'Close Position'; btn.disabled = false;
}

// ─── RENDER REALIZED HISTORY ──────────────────────────────────────────────────
function renderRealizedHistory() {
  const card = document.getElementById('realized-history-card');
  const body = document.getElementById('realized-history-body');
  if (!card || !body) return;

  if (realizedHistory.length === 0) {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';

  body.innerHTML = realizedHistory.map(r => `<tr>
    <td class="mono" style="color:var(--muted)">${esc(r.date)}</td>
    <td style="font-weight:600">${esc(r.symbol)} <span style="font-size:9px;color:var(--muted)">${esc(r.closeType)}</span></td>
    <td class="mono">${r.qtySold}</td>
    <td class="mono" style="color:var(--muted)">$${r.avgCost.toFixed(4)}</td>
    <td class="mono">$${r.exitPrice.toFixed(4)}</td>
    <td class="mono ${r.realizedPnl >= 0 ? 'green' : 'red'}"><span class="balance-val">${r.realizedPnl >= 0 ? '+' : ''}$${r.realizedPnl.toFixed(2)}</span></td>
    <td class="mono"><span class="balance-val">$${r.proceeds.toFixed(2)}</span></td>
  </tr>`).join('');
}

// ─── RENDER INVESTING STATS (cash/realized cards) ─────────────────────────────
function renderInvestingStats() {
  const totalRealized = realizedHistory.reduce((s, r) => s + r.realizedPnl, 0);
  const holdingsVal = HOLDINGS.reduce((s, h) => s + h.qty * h.curPrice, 0);
  const totalEquity = holdingsVal + cashBalance;

  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };

  set('inv-cash', `<span class="balance-val">$${cashBalance.toFixed(2)}</span>`);
  const cashEl = document.getElementById('inv-cash');
  if (cashEl) cashEl.className = 'stat-val ' + (cashBalance >= 0 ? 'green' : 'red');

  set('inv-realized', `<span class="balance-val">${totalRealized >= 0 ? '+' : ''}$${totalRealized.toFixed(2)}</span>`);
  const realizedEl = document.getElementById('inv-realized');
  if (realizedEl) realizedEl.className = 'stat-val ' + (totalRealized >= 0 ? 'green' : 'red');
  set('inv-realized-sub', `${realizedHistory.length} closed position${realizedHistory.length !== 1 ? 's' : ''}`);

  set('inv-total-equity', `<span class="balance-val">$${totalEquity.toFixed(2)}</span>`);
  const eqEl = document.getElementById('inv-total-equity');
  if (eqEl) eqEl.className = 'stat-val ' + (totalEquity >= 0 ? 'green' : 'red');
}

function renderTradingBalance() {
  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  set('tl-balance', `<span class="balance-val">$${tradingBalance.toFixed(2)}</span>`);
  const el = document.getElementById('tl-balance');
  if (el) el.className = 'stat-val ' + (tradingBalance >= 0 ? 'green' : 'red');
}

function renderTrades() {
  const recentBody = document.getElementById('recent-trades-body');
  const allBody = document.getElementById('all-trades-body');

  const now = new Date();
  const curMonth = now.getMonth();
  const curYear = now.getFullYear();
  const monthName = now.toLocaleString('default', { month: 'long' });
  const titleEl = document.getElementById('recent-trades-title');
  if (titleEl) titleEl.textContent = `${monthName} Trades`;

  let recentTrades = TRADES.filter(t => {
    const parts = t.date.split('-');
    return parseInt(parts[1]) - 1 === curMonth && parseInt(parts[0]) === curYear;
  });
  if (recentFilter !== 'All') recentTrades = recentTrades.filter(t => t.type === recentFilter);
  let allTrades = TRADES;
  if (allFilter !== 'All') allTrades = TRADES.filter(t => t.status === allFilter);

  if (recentBody) {
    recentBody.innerHTML = recentTrades.length === 0
      ? emptyRow(10, TRADES.length === 0 ? 'No trades yet — click "+ Log Trade" to add your first' : 'No trades this month')
      : recentTrades.map(t => tradeRow(t)).join('');
  }
  if (allBody) {
    allBody.innerHTML = allTrades.length === 0
      ? emptyRow(13, TRADES.length === 0 ? 'No trades yet' : 'No trades match this filter')
      : allTrades.map(t => tradeRow(t, true, true)).join('');
  }
}

function renderHoldings() {
  const list = document.getElementById('holdings-list');
  if (!list) return;

  // USD isn't a real `investments` row (no id, nothing to close/edit/delete) —
  // it's the cash balance rendered as a holdings-list entry for a true picture
  // of the portfolio. Always shown, even at $0, so "+ Deposit" is discoverable.
  const usdRow = `<div class="holding-row">
    <div class="holding-icon" style="background:#00D4AA22;color:#00D4AA">USD</div>
    <div class="holding-info">
      <div class="holding-name" style="display:flex;align-items:center;gap:4px">
        US Dollar
        <span style="font-size:10px;color:var(--muted);font-weight:400">Cash</span>
      </div>
      <div class="holding-qty">Available cash balance</div>
    </div>
    <div class="holding-vals">
      <div class="holding-val"><span class="balance-val">$${cashBalance.toFixed(2)}</span></div>
      <div class="holding-ret" style="color:var(--muted)">—</div>
    </div>
    <button class="btn btn-ghost" data-action="open-deposit-cash" style="font-size:10px;padding:3px 10px;margin-left:4px;text-transform:none;letter-spacing:normal">+ Deposit</button>
  </div>`;

  if (HOLDINGS.length === 0) {
    list.innerHTML = usdRow + `<div style="text-align:center;padding:32px;color:var(--muted)">No holdings yet — click "+ Add Investment"</div>`;
    return;
  }
  list.innerHTML = usdRow + HOLDINGS.map(h => {
    const cost = h.qty * h.buyPrice;
    const val = h.qty * h.curPrice;
    const pnl = val - cost;
    const pct = cost > 0 ? (pnl / cost * 100).toFixed(1) : '0.0';

    // 24h change from live data
    const sym = cleanSymbol(h.symbol);
    const liveData = livePrices[sym];
    const change24h = liveData ? liveData.change24h : null;
    const change24hStr = change24h != null
      ? `<span style="font-family:var(--mono);font-size:10px;color:${change24h >= 0 ? 'var(--green)' : 'var(--red)'}">
           ${change24h >= 0 ? '▲' : '▼'} ${Math.abs(change24h).toFixed(2)}% 24h
         </span>`
      : '';

    const liveBadge = h.livePrice
      ? `<span style="font-size:8px;font-family:var(--mono);color:var(--green);background:var(--green-dim);padding:2px 5px;border-radius:3px;margin-left:4px;letter-spacing:0.3px">LIVE</span>`
      : `<span style="font-size:8px;font-family:var(--mono);color:var(--muted);background:var(--faint);padding:2px 5px;border-radius:3px;margin-left:4px">MANUAL</span>`;

    const curPriceStr = h.livePrice
      ? `<span style="font-family:var(--mono);font-size:10px;color:var(--muted)">@ ${fmtVal(h.curPrice)}</span>`
      : '';

    const safeSym    = esc(sym.slice(0, 3));
    const safeSymbol = esc(h.symbol);
    const safeType   = esc(h.type);
    const safeId     = esc(h.id);

    return `<div class="holding-row">
      <div class="holding-icon" style="background:${h.color}22;color:${h.color}">${safeSym}</div>
      <div class="holding-info">
        <div class="holding-name" style="display:flex;align-items:center;gap:4px">
          ${safeSymbol}
          <span style="font-size:10px;color:var(--muted);font-weight:400">${safeType}</span>
          ${liveBadge}
        </div>
        <div class="holding-qty" style="display:flex;align-items:center;gap:8px">
          ${h.qty} units · Avg <span class="balance-val">${fmtVal(h.buyPrice)}</span>
          ${h.livePrice ? `<span class="balance-val" style="font-family:var(--mono);font-size:10px;color:var(--muted)">@ ${fmtVal(h.curPrice)}</span>` : ''}
          ${change24hStr}
        </div>
      </div>
      <div class="holding-vals">
        <div class="holding-val"><span class="balance-val">${fmtVal(val)}</span></div>
        <div class="holding-ret ${pnl >= 0 ? 'green' : 'red'}"><span class="balance-val">${fmt(pnl)}</span> (${pnl >= 0 ? '+' : ''}${pct}%)</div>
      </div>
      <button class="btn-close-position" data-action="open-close-position" data-id="${safeId}" style="border:1px solid var(--green);cursor:pointer;font-size:10px;padding:3px 8px;border-radius:4px;font-family:var(--mono);font-weight:600;margin-left:4px">Close</button>
      <button class="icon-btn-edit" data-action="open-edit-investment" data-id="${safeId}" style="background:none;border:none;cursor:pointer;font-size:12px;padding:2px 8px;border-radius:4px">✎</button>
      <button class="icon-btn-delete" data-action="delete-holding" data-id="${safeId}" style="background:none;border:none;cursor:pointer;font-size:12px;padding:2px 8px;margin-left:2px;border-radius:4px">✕</button>
    </div>`;
  }).join('');
}

const MONTHLY_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ─── HEATMAP ──────────────────────────────────────────────────────────────────
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
    if (v === null) return `<div class="heatmap-cell" style="background:var(--faint);color:var(--muted)" title="${MONTHLY_LABELS[i]} ${year}: No data">–</div>`;
    const intensity = Math.min(Math.abs(v) / maxAbs, 1);
    const bg = v > 0 ? `rgba(0,212,170,${0.15 + intensity * 0.65})` : v < 0 ? `rgba(255,77,109,${0.15 + intensity * 0.65})` : 'var(--faint)';
    const col = v > 0 ? '#00D4AA' : v < 0 ? '#FF4D6D' : 'var(--muted)';
    return `<div class="heatmap-cell" style="background:${bg};color:${col}" title="${MONTHLY_LABELS[i]} ${year}: ${v > 0 ? '+' : v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}">${fmtHeatmapVal(v)}</div>`;
  }).join('');
}

function renderHeatmap() {
  const y = new Date().getFullYear();
  const label = document.getElementById('heatmap-year-label');
  if (label) label.textContent = '— ' + y;
  renderHeatmapInto('heatmap', y);
}

// ─── CHARTS ───────────────────────────────────────────────────────────────────
function destroyCharts() {
  Object.values(chartInstances).forEach(c => { try { c.destroy(); } catch (e) { } });
  chartInstances = {};
}

const chartDefaults = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { backgroundColor: '#181B22', titleColor: '#8B8FA8', bodyColor: '#E8EAF0', borderColor: '#1E2230', borderWidth: 1 } },
  scales: {
    x: { grid: { color: '#1E2230' }, ticks: { color: '#8B8FA8', font: { family: 'JetBrains Mono', size: 10 } } },
    y: { grid: { color: '#1E2230' }, ticks: { color: '#8B8FA8', font: { family: 'JetBrains Mono', size: 10 } } }
  }
};

function mkChart(id, type, labels, datasets, extraOpts = {}) {
  const ctx = document.getElementById(id);
  if (!ctx) return null;
  return new Chart(ctx, { type, data: { labels, datasets }, options: { ...chartDefaults, ...extraOpts } });
}

function initCharts(stats) {
  const closed = stats ? stats.closed : TRADES.filter(t => t.status !== 'Open');

  // Equity curve
  const sortedClosed = [...closed].sort((a, b) => new Date(a.date) - new Date(b.date));
  let running = 0;
  const eqPoints = sortedClosed.map(t => { running += t.pnl; return parseFloat(running.toFixed(2)); });
  const eqLabels = sortedClosed.map(t => t.date);

  chartInstances.equity = mkChart('equityChart', 'line',
    eqLabels.length ? eqLabels : ['—'],
    [{
      data: eqPoints.length ? eqPoints : [0],
      borderColor: '#00D4AA', borderWidth: 2, pointRadius: 2, pointBackgroundColor: '#00D4AA',
      fill: true,
      backgroundColor: (ctx) => {
        const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 200);
        g.addColorStop(0, 'rgba(0,212,170,0.2)'); g.addColorStop(1, 'rgba(0,212,170,0)'); return g;
      },
      tension: 0.4
    }],
    { scales: { ...chartDefaults.scales, x: { ...chartDefaults.scales.x, ticks: { ...chartDefaults.scales.x.ticks, maxTicksLimit: 8 } } } }
  );

  // Win/Loss donut
  const wins = TRADES.filter(t => t.status === 'Win').length;
  const losses = TRADES.filter(t => t.status === 'Loss').length;
  const openC = TRADES.filter(t => t.status === 'Open').length;
  const wlCtx = document.getElementById('winLossChart');
  if (wlCtx) {
    chartInstances.winloss = new Chart(wlCtx, {
      type: 'doughnut',
      data: { labels: ['Win', 'Loss', 'Open'], datasets: [{ data: [wins, losses, openC], backgroundColor: ['#00D4AA', '#FF4D6D', '#F5A623'], borderWidth: 0, hoverOffset: 6 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '70%',
        plugins: {
          legend: { display: true, position: 'right', labels: { color: '#8B8FA8', font: { family: 'JetBrains Mono', size: 10 }, boxWidth: 10 } },
          tooltip: { backgroundColor: '#181B22', titleColor: '#8B8FA8', bodyColor: '#E8EAF0', borderColor: '#1E2230', borderWidth: 1 }
        }
      }
    });
  }

  // Monthly P&L bars
  const monthlyPnl = getMonthlyPnl().map(v => v != null ? parseFloat(v.toFixed(2)) : 0);
  chartInstances.monthly = mkChart('monthlyPnlChart', 'bar', MONTHLY_LABELS,
    [{ data: monthlyPnl, backgroundColor: monthlyPnl.map(v => v >= 0 ? 'rgba(0,212,170,0.8)' : 'rgba(255,77,109,0.8)'), borderRadius: 4, borderSkipped: false }]
  );

  // Asset P&L
  const assetTypes = ['Crypto', 'Forex', 'Stocks'];
  const assetPnl = assetTypes.map(type =>
    parseFloat(TRADES.filter(t => t.type === type && t.status !== 'Open').reduce((s, t) => s + t.pnl, 0).toFixed(2))
  );
  chartInstances.assetPnl = mkChart('assetPnlChart', 'bar', assetTypes,
    [{ data: assetPnl, backgroundColor: assetPnl.map(v => v >= 0 ? 'rgba(0,212,170,0.8)' : 'rgba(255,77,109,0.8)'), borderRadius: 4 }]
  );

  // RR Distribution
  const rrBuckets = [0, 0, 0, 0];
  TRADES.filter(t => t.rr != null && t.status !== 'Open').forEach(t => {
    const r = t.rr;
    if (r < 1) rrBuckets[0]++;
    else if (r < 2) rrBuckets[1]++;
    else if (r < 3) rrBuckets[2]++;
    else rrBuckets[3]++;
  });
  chartInstances.rr = mkChart('rrDistChart', 'bar', ['0–1R', '1–2R', '2–3R', '3R+'],
    [{ data: rrBuckets, backgroundColor: 'rgba(74,158,255,0.7)', borderRadius: 4 }]
  );

  // Win rate by asset
  const wrByAsset = assetTypes.map(type => {
    const closedByType = TRADES.filter(t => t.type === type && t.status !== 'Open');
    return closedByType.length ? parseFloat((TRADES.filter(t => t.type === type && t.status === 'Win').length / closedByType.length * 100).toFixed(1)) : 0;
  });
  chartInstances.wrAsset = mkChart('winRateAssetChart', 'bar', assetTypes,
    [{ data: wrByAsset, backgroundColor: ['rgba(0,212,170,0.7)', 'rgba(74,158,255,0.7)', 'rgba(245,166,35,0.7)'], borderRadius: 4 }],
    { scales: { ...chartDefaults.scales, y: { ...chartDefaults.scales.y, max: 100, ticks: { ...chartDefaults.scales.y.ticks, callback: (v) => v + '%' } } } }
  );

  // Portfolio allocation (cash counts as its own slice, same as a holding)
  if (HOLDINGS.length > 0 || cashBalance > 0) {
    const allocLabels = HOLDINGS.map(h => h.symbol);
    const allocVals   = HOLDINGS.map(h => h.qty * h.curPrice);
    const allocColors = HOLDINGS.map(h => h.color + 'CC');
    if (cashBalance > 0) {
      allocLabels.push('USD');
      allocVals.push(cashBalance);
      allocColors.push('#00D4AACC');
    }
    const allocCtx = document.getElementById('allocChart');
    if (allocCtx) {
      chartInstances.alloc = new Chart(allocCtx, {
        type: 'doughnut',
        data: { labels: allocLabels, datasets: [{ data: allocVals, backgroundColor: allocColors, borderWidth: 0, hoverOffset: 6 }] },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '60%',
          plugins: {
            legend: { display: true, position: 'right', labels: { color: '#8B8FA8', font: { family: 'JetBrains Mono', size: 10 }, boxWidth: 10 } },
            tooltip: { backgroundColor: '#181B22', titleColor: '#8B8FA8', bodyColor: '#E8EAF0', borderColor: '#1E2230', borderWidth: 1 }
          }
        }
      });
    }
  }
  // Per-asset return % — cash has no "return", so this stays holdings-only
  if (HOLDINGS.length > 0) {
    const holdRets = HOLDINGS.map(h => parseFloat(((h.curPrice - h.buyPrice) / h.buyPrice * 100).toFixed(1)));
    chartInstances.holdRet = mkChart('holdingRetChart', 'bar', HOLDINGS.map(h => h.symbol),
      [{ data: holdRets, backgroundColor: holdRets.map(v => v >= 0 ? 'rgba(0,212,170,0.75)' : 'rgba(255,77,109,0.75)'), borderRadius: 4 }],
      { scales: { ...chartDefaults.scales, y: { ...chartDefaults.scales.y, ticks: { ...chartDefaults.scales.y.ticks, callback: (v) => v + '%' } } } }
    );
  }

  // Overall equity curve
  chartInstances.overall = mkChart('overallEquityChart', 'line',
    eqLabels.length ? eqLabels : ['—'],
    [{
      label: 'Equity', data: eqPoints.length ? eqPoints : [0],
      borderColor: '#00D4AA', borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: '#00D4AA',
      fill: true,
      backgroundColor: (ctx) => {
        const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 260);
        g.addColorStop(0, 'rgba(0,212,170,0.18)'); g.addColorStop(1, 'rgba(0,212,170,0)'); return g;
      },
      tension: 0.4
    }],
    { scales: { ...chartDefaults.scales, x: { ...chartDefaults.scales.x, ticks: { ...chartDefaults.scales.x.ticks, maxTicksLimit: 10 } } } }
  );

  // Monthly P&L on equity page
  chartInstances.yearlyBar = mkChart('yearlyChart', 'bar', MONTHLY_LABELS,
    [{ data: monthlyPnl, backgroundColor: monthlyPnl.map(v => v >= 0 ? 'rgba(0,212,170,0.8)' : 'rgba(255,77,109,0.8)'), borderRadius: 4 }]
  );

  // Cumulative by month
  let cumSum = 0;
  const cumMonthly = monthlyPnl.map(v => { cumSum += v; return parseFloat(cumSum.toFixed(2)); });
  chartInstances.monthlyRet = mkChart('monthlyRetChart', 'line', MONTHLY_LABELS,
    [{ data: cumMonthly, borderColor: '#4A9EFF', borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#4A9EFF', fill: false, tension: 0.4 }]
  );
}

// ─── QUERY BUILDER ────────────────────────────────────────────────────────────
const FIELDS = [
  { key: 'rr',     label: 'RR Achieved',  type: 'number', ops: ['>', '<', '>=', '<=', '='] },
  { key: 'pnl',    label: 'P&L ($)',       type: 'number', ops: ['>', '<', '>=', '<=', '='] },
  { key: 'size',   label: 'Position Size', type: 'number', ops: ['>', '<', '>=', '<=', '='] },
  { key: 'status', label: 'Status',        type: 'select', opts: ['Win', 'Loss', 'Open'], ops: ['=', '!='] },
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
      valHtml = `<input type="date" value="${c.val}" data-action="update-cond" data-cond-id="${c.id}" data-cond-field="val" style="width:140px">`;
    } else {
      valHtml = `<input type="${field.type === 'number' ? 'number' : 'text'}" value="${c.val}" placeholder="value" data-action="update-cond" data-cond-id="${c.id}" data-cond-field="val" style="width:100px">`;
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
      if (['pnl', 'rr', 'size', 'entry'].includes(c.field)) { tv = parseFloat(tv); cv = parseFloat(cv); }
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
    const av = a[sortField], bv = b[sortField];
    return sortDir === 'desc' ? (parseFloat(bv) || 0) - (parseFloat(av) || 0) : (parseFloat(av) || 0) - (parseFloat(bv) || 0);
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
  const wr = closed.length ? (winsR.length / closed.length * 100).toFixed(1) + '%' : '—';

  document.getElementById('res-pnl').textContent = fmt(totalPnl);
  document.getElementById('res-rr').textContent = avgRR != null ? avgRR.toFixed(2) + 'R' : '—';
  document.getElementById('res-wr').textContent = wr;
  document.getElementById('result-count').textContent = `${results.length} trade${results.length !== 1 ? 's' : ''}`;
  document.getElementById('q-count').textContent = `${results.length} result${results.length !== 1 ? 's' : ''}`;

  const tbody = document.getElementById('query-results-body');
  tbody.innerHTML = results.length === 0
    ? `<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--muted)">No trades match this query</td></tr>`
    : results.map(t => `<tr>
        <td class="mono" style="color:var(--muted)">${t.date}</td>
        <td style="font-weight:600">${t.symbol}</td>
        <td><span style="font-size:10px;color:var(--muted)">${t.type}</span></td>
        <td><span class="badge ${t.dir === 'Long' ? 'badge-long' : 'badge-short'}">${t.dir}</span></td>
        <td class="mono">${t.entry.toLocaleString()}</td>
        <td class="mono">${t.exit != null ? t.exit.toLocaleString() : '<span style="color:var(--amber)">Open</span>'}</td>
        <td class="mono ${t.pnl > 0 ? 'green' : t.pnl < 0 ? 'red' : ''}"><span class="balance-val">${t.status === 'Open' ? '—' : fmt(t.pnl)}</span></td>
        <td class="mono ${t.rr != null && t.rr > 0 ? 'green' : t.rr != null && t.rr < 0 ? 'red' : ''}">${t.rr != null ? t.rr.toFixed(2) + 'R' : '—'}</td>
        <td><span class="badge ${t.status === 'Win' ? 'badge-win' : t.status === 'Loss' ? 'badge-loss' : 'badge-open'}">${t.status}</span></td>
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

// ─── SCHEMA ───────────────────────────────────────────────────────────────────
const SCHEMA_SQL = `-- ============================================
-- TradeLog — Supabase Schema
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================

create extension if not exists "pgcrypto";

create table trades (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  created_at  timestamptz default now(),
  date        date not null,
  symbol      text not null,
  type        text check (type in ('Crypto','Forex','Stocks')) not null,
  dir         text check (dir in ('Long','Short')) not null,
  entry       numeric(18,6) not null,
  exit        numeric(18,6),
  size        numeric(18,2) not null,
  sl          numeric(18,6),
  tp          numeric(18,6),
  pnl         numeric(18,2) generated always as (
                case when exit is null then 0
                     when dir = 'Long'  then (exit - entry) / entry * size
                     else               (entry - exit) / entry * size
                end
              ) stored,
  rr          numeric(8,4),
  status      text generated always as (
                case when exit is null then 'Open'
                     when ((dir='Long' and exit>entry) or (dir='Short' and exit<entry)) then 'Win'
                     else 'Loss'
                end
              ) stored,
  setup       text,
  notes       text,
  tags        text[]
);

create table investments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  created_at  timestamptz default now(),
  symbol      text not null,
  type        text check (type in ('Crypto','Stocks','ETF','Other')) not null,
  buy_date    date not null,
  qty         numeric(18,8) not null,
  buy_price   numeric(18,6) not null,
  cur_price   numeric(18,6),
  notes       text
);

create index idx_trades_user   on trades(user_id);
create index idx_trades_date   on trades(date desc);
create index idx_trades_type   on trades(type);
create index idx_trades_status on trades(status);
create index idx_trades_rr     on trades(rr);
create index idx_trades_pnl    on trades(pnl);
create index idx_invest_user   on investments(user_id);

alter table trades      enable row level security;
alter table investments enable row level security;

create policy "Users see own trades"
  on trades for all using (auth.uid() = user_id);

create policy "Users see own investments"
  on investments for all using (auth.uid() = user_id);`;

const TRADES_COLS = [
  { name: 'id', type: 'uuid', desc: 'Auto-generated primary key', pk: true },
  { name: 'user_id', type: 'uuid', desc: 'Links to auth.users — RLS enforced' },
  { name: 'date', type: 'date', desc: 'Trade date' },
  { name: 'symbol', type: 'text', desc: 'e.g. BTC/USDT, EUR/USD, AAPL' },
  { name: 'type', type: 'text', desc: 'Crypto | Forex | Stocks' },
  { name: 'dir', type: 'text', desc: 'Long | Short' },
  { name: 'entry', type: 'numeric', desc: 'Entry price' },
  { name: 'exit', type: 'numeric', desc: 'Exit price — null if open' },
  { name: 'size', type: 'numeric', desc: 'Position size in USD' },
  { name: 'sl', type: 'numeric', desc: 'Stop loss price' },
  { name: 'tp', type: 'numeric', desc: 'Take profit price' },
  { name: 'pnl', type: 'numeric', desc: 'Auto-calculated by DB (generated column)' },
  { name: 'rr', type: 'numeric', desc: 'Risk/reward achieved — set on close' },
  { name: 'status', type: 'text', desc: 'Auto-calculated: Open | Win | Loss' },
  { name: 'setup', type: 'text', desc: 'Strategy / setup name' },
  { name: 'notes', type: 'text', desc: 'Trade notes' },
  { name: 'tags', type: 'text[]', desc: 'Optional tags array' },
];

const INVEST_COLS = [
  { name: 'id', type: 'uuid', desc: 'Primary key', pk: true },
  { name: 'user_id', type: 'uuid', desc: 'Links to auth.users' },
  { name: 'symbol', type: 'text', desc: 'Asset ticker' },
  { name: 'type', type: 'text', desc: 'Crypto | Stocks | ETF | Other' },
  { name: 'buy_date', type: 'date', desc: 'Purchase date' },
  { name: 'qty', type: 'numeric', desc: 'Units held' },
  { name: 'buy_price', type: 'numeric', desc: 'Average buy price' },
  { name: 'cur_price', type: 'numeric', desc: 'Current market price' },
  { name: 'notes', type: 'text', desc: 'Investment thesis' },
];

const EXAMPLE_QUERIES = [
  { label: 'All winning trades with RR above 2', sql: `SELECT symbol, date, pnl, rr\nFROM trades\nWHERE status = 'Win' AND rr > 2\nORDER BY rr DESC;` },
  { label: 'Monthly P&L summary', sql: `SELECT\n  date_trunc('month', date) AS month,\n  SUM(pnl) AS total_pnl,\n  COUNT(*) FILTER (WHERE status='Win') AS wins,\n  COUNT(*) FILTER (WHERE status='Loss') AS losses\nFROM trades\nGROUP BY 1\nORDER BY 1;` },
  { label: 'Win rate by asset type', sql: `SELECT\n  type,\n  ROUND(COUNT(*) FILTER (WHERE status='Win') * 100.0 / COUNT(*), 1) AS win_rate,\n  AVG(rr) FILTER (WHERE rr IS NOT NULL) AS avg_rr\nFROM trades\nWHERE status != 'Open'\nGROUP BY type;` },
  { label: 'Best setup / strategy', sql: `SELECT\n  setup,\n  COUNT(*) AS trades,\n  SUM(pnl) AS total_pnl,\n  AVG(rr) AS avg_rr\nFROM trades\nWHERE setup IS NOT NULL\nGROUP BY setup\nORDER BY total_pnl DESC;` },
];

function renderSchema() {
  const sEl = document.getElementById('schema-sql');
  if (sEl) sEl.textContent = SCHEMA_SQL;
  const renderCols = (id, cols) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = cols.map(c => `<div class="schema-col">
      <span class="col-name">${c.name}${c.pk ? ` <span class="col-pk">PK</span>` : ''}</span>
      <span class="col-type">${c.type}</span>
      <span class="col-desc">${c.desc}</span>
    </div>`).join('');
  };
  renderCols('schema-trades-cols', TRADES_COLS);
  renderCols('schema-invest-cols', INVEST_COLS);
  const eqEl = document.getElementById('example-queries');
  if (eqEl) eqEl.innerHTML = EXAMPLE_QUERIES.map(q => `<div class="example-q"><div class="example-q-label">${q.label}</div><pre>${q.sql}</pre></div>`).join('');
}

function copySchema() {
  navigator.clipboard.writeText(SCHEMA_SQL);
  toast('Schema SQL copied ✓');
}

// ─── PROFILE ──────────────────────────────────────────────────────────────────
let profilePhoto = localStorage.getItem('profile_photo') || null;
let profileName  = localStorage.getItem('profile_name')  || '';

function loadProfile() {
  const nameEl = document.getElementById('sidebar-name');
  if (nameEl) nameEl.textContent = profileName || 'Set your name';

  const imgEl  = document.getElementById('profile-avatar-img');
  const initEl = document.getElementById('profile-avatar-initials');
  if (!imgEl || !initEl) return;
  if (profilePhoto) {
    imgEl.src = profilePhoto; imgEl.style.display = 'block';
    initEl.style.display = 'none';
  } else {
    imgEl.style.display = 'none'; initEl.style.display = '';
    const initials = profileName ? profileName.trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) : '?';
    initEl.textContent = initials;
  }
}

function openProfileModal_internal() {
  document.getElementById('profile-name-input').value = profileName || '';
  setNameStatus('');
  const emailEl = document.getElementById('profile-email-display');
  if (emailEl && currentUser) emailEl.textContent = currentUser.email || '—';
  const imgEl  = document.getElementById('profile-avatar-img');
  const initEl = document.getElementById('profile-avatar-initials');
  if (profilePhoto) {
    imgEl.src = profilePhoto; imgEl.style.display = 'block';
    initEl.style.display = 'none';
  } else {
    imgEl.style.display = 'none'; initEl.style.display = '';
    initEl.textContent = profileName ? profileName.trim().split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2) : '?';
  }
  document.getElementById('profile-modal').classList.add('open');
}

function handleProfilePhoto(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) return toast('Image must be under 5MB', 'err');

  const reader = new FileReader();
  reader.onload = (e) => {
    // Compress image to max 200x200 before storing in localStorage
    // This prevents hitting the 5-10MB localStorage quota
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX = 200;
      const ratio = Math.min(MAX / img.width, MAX / img.height, 1);
      canvas.width  = Math.round(img.width  * ratio);
      canvas.height = Math.round(img.height * ratio);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      profilePhoto = canvas.toDataURL('image/jpeg', 0.82);

      const imgEl  = document.getElementById('profile-avatar-img');
      const initEl = document.getElementById('profile-avatar-initials');
      if (imgEl) { imgEl.src = profilePhoto; imgEl.style.display = 'block'; }
      if (initEl) initEl.style.display = 'none';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function saveProfile() {
  const name = document.getElementById('profile-name-input').value.trim();
  if (!name) return toast('Enter a display name', 'err');

  const btn = document.querySelector('#profile-modal [data-action="save-profile"]');
  const prevText = btn ? btn.textContent : '';
  if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }

  try {
    // Skip the round-trip only if the name is byte-identical to what's already
    // saved (e.g. they just changed the photo). Any actual change — including
    // a case-only re-cast — goes through the upsert so casing stays correct
    // in Supabase too.
    if (name !== profileName) {
      await sbUpsertProfile(name);
    }
    profileName = name;
    safeLocalSet('profile_name', profileName);
    if (profilePhoto) safeLocalSet('profile_photo', profilePhoto);
    loadProfile();
    closeModal('profile-modal');
    setNameStatus('');
    toast('Profile saved ✓');
  } catch (e) {
    if (e.message === 'TAKEN') {
      setNameStatus('✗ Already taken — try a different display name', 'red');
    } else {
      toast(e.message || 'Failed to save profile', 'err');
    }
  }

  if (btn) { btn.textContent = prevText; btn.disabled = false; }
}

// ─── DISPLAY NAME AVAILABILITY (live check as the user types) ────────────────
function setNameStatus(msg, color) {
  const el = document.getElementById('profile-name-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = color === 'red' ? 'var(--red)' : color === 'green' ? 'var(--green)' : 'var(--muted)';
}

let nameCheckTimer = null;
let nameCheckToken = 0;
function onProfileNameInput(value) {
  const name = value.trim();
  clearTimeout(nameCheckTimer);

  if (!name) { setNameStatus(''); return; }
  if (name.toLowerCase() === (profileName || '').toLowerCase()) { setNameStatus(''); return; }
  if (name.length < 3) { setNameStatus('Minimum 3 characters', 'red'); return; }

  setNameStatus('Checking…');
  const myToken = ++nameCheckToken;

  nameCheckTimer = setTimeout(async () => {
    try {
      const available = await sbCheckNameAvailable(name);
      if (myToken !== nameCheckToken) return; // a newer keystroke superseded this check
      setNameStatus(available ? '✓ Available' : '✗ Already taken — try a different display name', available ? 'green' : 'red');
    } catch (e) {
      if (myToken !== nameCheckToken) return;
      setNameStatus('');
      log.warn('[onProfileNameInput] Availability check failed:', e.message);
    }
  }, 450);
}

// ─── EVENT DELEGATION (CSP-safe replacement for inline on* handlers) ─────────
// Strict CSP (script-src 'self') blocks inline onclick/onchange/etc attributes.
// Every interactive element in the HTML/templates instead carries a
// data-action attribute; these three listeners route all UI events centrally.

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const a = t.dataset.action;
  switch (a) {
    case 'sign-in': sbSignIn(); break;
    case 'sign-up': sbSignUp(); break;
    case 'sign-out': sbSignOut(); break;
    case 'set-currency': setCurrency(t.dataset.currency, t); break;
    case 'show-page': showPage(t.dataset.page, t); break;
    case 'toggle-balance': toggleBalanceVisibility(); break;
    case 'open-profile-modal': openProfileModal_internal(); break;
    case 'export-csv': exportCSV(); break;
    case 'open-add-investment': openAddInvestment(); break;
    case 'open-deposit-cash': openAddFundsModal('cash'); break;
    case 'open-add-funds': openAddFundsModal('trading'); break;
    case 'submit-add-funds': submitAddFunds(); break;
    case 'open-add-trade': openAddTrade(); break;
    case 'filter-recent': filterRecent(t.dataset.filter, t); break;
    case 'filter-all': filterAll(t.dataset.filter, t); break;
    case 'fetch-live-prices': fetchLivePrices(); break;
    case 'clear-realized-history': clearRealizedHistory(); break;
    case 'cal-prev-month': calPrevMonth(); break;
    case 'cal-next-month': calNextMonth(); break;
    case 'cal-goto-day': calGotoDay(t.dataset.date); break;
    case 'cal-select-day': calSelectDay(parseInt(t.dataset.day, 10)); break;
    case 'add-condition': addCondition(); break;
    case 'remove-condition': removeCondition(parseInt(t.dataset.condId, 10)); break;
    case 'load-preset': loadPreset(PRESETS[parseInt(t.dataset.presetIndex, 10)]); break;
    case 'run-query': runQuery(); break;
    case 'copy-sql': copySQL(); break;
    case 'copy-schema': copySchema(); break;
    case 'close-modal': closeModal(t.dataset.modal); break;
    case 'save-trade': saveTrade(); break;
    case 'close-trade-submit': closeTradeSubmit(); break;
    case 'save-investment': saveInvestment(); break;
    case 'save-profile': saveProfile(); break;
    case 'submit-close-position': submitClosePosition(); break;
    case 'trigger-photo-upload': document.getElementById('profile-photo-input').click(); break;
    case 'open-close-trade': openCloseTrade(t.dataset.id); break;
    case 'open-edit-trade': openEditTrade(t.dataset.id); break;
    case 'delete-trade': deleteTrade(t.dataset.id); break;
    case 'open-close-position': openClosePosition(t.dataset.id); break;
    case 'open-edit-investment': openEditInvestment(t.dataset.id); break;
    case 'delete-holding': deleteHolding(t.dataset.id); break;
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'profile-photo-input') return handleProfilePhoto(t);
  if (t.id === 'cp-type') return onCloseTypeChange();
  if (t.id === 'yr-year-select') return onRecapYearChange(t.value);
  if (t.dataset && t.dataset.action === 'update-cond') {
    return updateCond(parseInt(t.dataset.condId, 10), t.dataset.condField, t.value);
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'cp-exit-price' || t.id === 'cp-qty') updateClosePnl();
  if (t.id === 'profile-name-input') onProfileNameInput(t.value);
});

document.addEventListener('keydown', (e) => {
  if (e.target.id === 'auth-pass' && e.key === 'Enter') sbSignIn();
});

// ─── INIT ─────────────────────────────────────────────────────────────────────
renderPresets();
renderSchema();
renderConditions();
applyBalanceVisibility();

// Sanitize localStorage — clean up corrupted values from older buggy versions
// (e.g. sb_refresh stored as literal string "undefined")
['sb_refresh', 'sb_token', 'sb_user'].forEach(key => {
  const val = localStorage.getItem(key);
  if (val === 'undefined' || val === 'null') {
    log.warn(`[INIT] Cleaning corrupted localStorage key: ${key}`);
    localStorage.removeItem(key);
  }
});

(async () => {
  const savedToken   = localStorage.getItem('sb_token');
  const savedUser    = localStorage.getItem('sb_user');
  const savedRefresh = localStorage.getItem('sb_refresh');
  const savedExpires = parseInt(localStorage.getItem('sb_expires') || '0');

  log.info('[INIT] savedToken exists:', !!savedToken);
  log.info('[INIT] savedUser exists:', !!savedUser);
  log.info('[INIT] savedRefresh exists:', !!savedRefresh, savedRefresh === 'undefined' ? '(STRING "undefined" BUG!)' : '');
  log.info('[INIT] savedExpires:', savedExpires, savedExpires > 0 ? new Date(savedExpires).toLocaleString() : 'not set');
  log.info('[INIT] now:', Date.now(), new Date().toLocaleString());

  if (!savedToken || !savedUser) {
    log.info('[INIT] No saved session, showing auth screen');
    showAuthScreen();
    return;
  }

  userToken = savedToken;

  try {
    currentUser = JSON.parse(savedUser);
    document.getElementById('user-email').textContent = currentUser.email;
    log.info('[INIT] Restored user:', currentUser.email);
  } catch(e) {
    log.error('[INIT] Failed to parse savedUser:', e);
    showAuthScreen();
    return;
  }

  const isExpired = savedExpires > 0 && Date.now() > savedExpires - 10000;
  log.info('[INIT] isExpired:', isExpired);

  if (isExpired && savedRefresh && savedRefresh !== 'undefined' && savedRefresh !== 'null') {
    log.info('[INIT] Token expired, attempting refresh...');
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST', headers: SB_HEADERS,
        body: JSON.stringify({ refresh_token: savedRefresh })
      });
      const data = await res.json();
      log.info('[INIT] Refresh response status:', res.status, 'has access_token:', !!data.access_token);
      if (data.access_token) {
        applySession(data);
        currentUser = data.user;
        document.getElementById('user-email').textContent = currentUser.email;
        log.info('[INIT] Refresh succeeded');
      } else {
        log.warn('[INIT] Refresh response had no access_token:', data.error || data.error_description || data.msg);
        // Don't immediately log out — fall through and try the old token anyway.
        // It might still be valid (clock skew, etc) and loadAllData's own retry will catch a real 401.
      }
    } catch(e) {
      log.warn('[INIT] Refresh request threw network error:', e.message);
      // Network error — proceed with existing (possibly stale) token, loadAllData will retry on 401
    }
  } else if (savedExpires > 0 && !isExpired) {
    const remaining = Math.max(savedExpires - Date.now(), 0) / 1000;
    log.info('[INIT] Token still valid for', Math.round(remaining), 'seconds');
    scheduleTokenRefresh(remaining);
  } else {
    log.info('[INIT] No expiry info or no usable refresh token — using stored access token as-is');
  }

  log.info('[INIT] Showing app shell and loading data...');
  showAppShell();
  loadProfile();
  loadAllData();
})();

function clearAuthStorage() {
  localStorage.removeItem('sb_token');
  localStorage.removeItem('sb_refresh');
  localStorage.removeItem('sb_expires');
  localStorage.removeItem('sb_user');
}
