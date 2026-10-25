// ═══════════════════════════════════════════════════════════════════════════
// Auth: sign up / in / out, demo ↔ account switching, session tokens.
// ═══════════════════════════════════════════════════════════════════════════

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function showAuthScreen() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app-shell').style.display = 'none';
}
function showAppShell() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = 'flex';
}

function enterDemoMode() {
  isDemoMode = true;
  TRADES = buildDemoTrades();
  HOLDINGS = buildDemoHoldings();
  cashBalance = DEMO_CASH_BALANCE;
  FUNDS = DEMO_FUNDS.map(f => ({ ...f }));
  // Trading balance = money moved in/out + every closed trade's net P&L
  tradingBalance = parseFloat((FUNDS.filter(f => f.account === 'trading').reduce((s, f) => s + f.amount, 0) +
    TRADES.filter(t => t.status !== 'Open').reduce((s, t) => s + t.pnl, 0)).toFixed(2));
  realizedHistory = DEMO_REALIZED_HISTORY.map(r => ({ ...r }));
  SNAPSHOTS = buildDemoSnapshots(HOLDINGS, DEMO_CASH_BALANCE);
  PREFS = { ...DEMO_PREFS };
  DB_READY = true; // demo data has every new field, so show every feature
  FEE_SPLIT_READY = true;
  LEDGER_READY = false; // nothing is saved in demo mode
  // Like a real account after the database update: what the balances hold
  // beyond the demo history is an "Opening balance" row in the funds history
  anchorBalances(tradingBalance, cashBalance);
  [['trading', 'trading'], ['investing', 'cash']].forEach(([account, key]) => {
    if (balanceOffsets[key]) FUNDS.push({ id: `demo-opening-${account}`, user_id: 'demo', date: '2025-11-01', account, kind: 'adjustment',
      amount: balanceOffsets[key], note: 'Opening balance (carried over from before the funds history)', transfer_id: null });
  });
  balanceOffsets = { trading: 0, cash: 0 };
  recomputeBalances();
  profileName = DEMO_PROFILE_NAME;
  profilePhoto = null;

  const emailEl = document.getElementById('user-email');
  if (emailEl) { emailEl.textContent = 'Demo Mode'; emailEl.style.display = 'block'; }
  const banner = document.getElementById('demo-banner');
  if (banner) banner.style.display = 'flex';
  const signOutBtn = document.querySelector('[data-action="sign-out"]');
  if (signOutBtn) signOutBtn.textContent = 'Sign In';

  showAppShell();
  loadProfile();
  renderAll();
}

function goToAuthFromDemo() {
  showAuthScreen();
  const backBtn = document.getElementById('back-to-demo-btn');
  if (backBtn) backBtn.style.display = 'block';
}

function backToDemo() {
  showAppShell();
}

function exitDemoMode() {
  if (!isDemoMode) return;
  isDemoMode = false;
  const banner = document.getElementById('demo-banner');
  if (banner) banner.style.display = 'none';
  const signOutBtn = document.querySelector('[data-action="sign-out"]');
  if (signOutBtn) signOutBtn.textContent = 'Sign out';
  const backBtn = document.getElementById('back-to-demo-btn');
  if (backBtn) backBtn.style.display = 'none';
}

// Every write-triggering function calls this first. Returns true (and blocks
// the caller via early return) only in demo mode — real accounts are never
// affected by this check.
function demoGuard() {
  if (!isDemoMode) return false;
  toast('This is demo data — sign in to save your own', 'err');
  goToAuthFromDemo();
  return true;
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
    exitDemoMode();
    restoreAccountStateFromCache(currentUser.id);
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
  if (priceRefreshTimer) { clearInterval(priceRefreshTimer); priceRefreshTimer = null; }
  clearAuthStorage();
  clearAccountCache();
  currentUser = null; userToken = null;
  TRADES = []; HOLDINGS = [];
  cashBalance = 0; tradingBalance = 0; realizedHistory = [];
  FUNDS = []; SNAPSHOTS = []; PREFS = {}; DB_READY = false; prefsLoaded = false; LEDGER_READY = false; FEE_SPLIT_READY = false;
  balanceOffsets = { trading: 0, cash: 0 };
  profileName = ''; profilePhoto = null;
  if (typeof stopBybitAutoSync === 'function') stopBybitAutoSync();
  // nothing of this account may carry over to the next one on this browser
  snapshotSavedFor = null; lastPriceUpdate = null;
  autoSyncUnavailable = false; lastBybitSync = null;
  Object.keys(livePrices).forEach(k => delete livePrices[k]);
  try { renderAll(); } catch (e) { /* the app is hidden behind the sign-in screen */ }
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


function clearAuthStorage() {
  localStorage.removeItem('sb_token');
  localStorage.removeItem('sb_refresh');
  localStorage.removeItem('sb_expires');
  localStorage.removeItem('sb_user');
}

