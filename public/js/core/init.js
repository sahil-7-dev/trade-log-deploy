// ═══════════════════════════════════════════════════════════════════════════
// Start-up. Loads the page + modal HTML, builds the sidebar from the page
// registry, then restores the session (or enters demo mode). Fires
// "app-ready" on window when the first render is done.
// ═══════════════════════════════════════════════════════════════════════════

// Sanitize localStorage — clean up corrupted values from older buggy versions
// (e.g. sb_refresh stored as literal string "undefined")
['sb_refresh', 'sb_token', 'sb_user'].forEach(key => {
  const val = localStorage.getItem(key);
  if (val === 'undefined' || val === 'null') {
    log.warn(`[INIT] Cleaning corrupted localStorage key: ${key}`);
    localStorage.removeItem(key);
  }
});

(async function startApp() {
  try {
    await loadPartials();
  } catch (e) {
    log.error('[INIT] Could not load page files:', e.message);
    // Opened by double-clicking index.html: browsers block loading the page
    // files from disk, so say exactly how to run it instead.
    const msg = location.protocol === 'file:'
      ? 'TradeLog can’t run from a file opened on disk. In a terminal in the project folder run <code>npm run dev</code>, then open <a href="http://localhost:3000">http://localhost:3000</a>.'
      : 'Could not load the app page files — check your connection and reload.';
    document.body.insertAdjacentHTML('afterbegin', `<div class="app-banner danger" style="font-size:14px;padding:16px 24px"><span>${msg}</span></div>`);
    return;
  }
  buildNav();
  try { if (localStorage.getItem('sidebar_collapsed') === '1') document.body.classList.add('sidebar-collapsed'); } catch (e) { /* convenience only */ }
  renderPresets();
  renderSchema();
  renderConditions();
  applyBalanceVisibility();
  syncRangeControls();
  updateFxTooltip();
  refreshFxRate();
  // Open the page in the URL (#/risk etc.), without adding a history entry
  showPage(pageFromHash() || 'dashboard', null, { push: false });
  await restoreSessionOrDemo();
  window.dispatchEvent(new Event('app-ready'));
})();

async function restoreSessionOrDemo() {
  // Arriving from a password-reset email: show "choose a new password" instead
  if (handlePasswordResetRedirect()) return;

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
    log.info('[INIT] No saved session, entering demo mode');
    enterDemoMode();
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
  await loadAllData();
}

