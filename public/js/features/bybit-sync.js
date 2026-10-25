// ═══════════════════════════════════════════════════════════════════════════
// Bybit sync: the Sync button (calls api/bybit-sync) and auto-sync while
// the app is open. Their P&L reaches the trading balance through the history.
// ═══════════════════════════════════════════════════════════════════════════

// silent: auto-sync mode — no toasts unless something new came in, and no
// button spinner. Returns 'ok' | 'unavailable' (no sync endpoint / no Bybit
// keys on the server — auto-sync stops trying) | 'error' | 'busy'.
// Synced trades' P&L reaches the trading balance by itself (core/balances.js).
let bybitSyncInFlight = false;
let lastBybitSync = null;

async function syncBybit({ silent = false, isRetry = false } = {}) {
  if (isDemoMode) { if (!silent) demoGuard(); return 'unavailable'; }
  if (bybitSyncInFlight && !isRetry) return 'busy';
  bybitSyncInFlight = true;
  const btn = document.querySelector('[data-action="sync-bybit"]');
  const prevText = '⟳ Sync Bybit';
  if (btn && !silent) { btn.textContent = 'Syncing…'; btn.disabled = true; }
  let outcome = 'ok';

  try {
    const token = userToken || localStorage.getItem('sb_token') || '';
    const res = await fetch('/api/bybit-sync', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      // Minutes east of UTC (IST = 330), so synced trades are dated by the
      // user's own calendar day rather than UTC's.
      body: JSON.stringify({ tzOffsetMinutes: -new Date().getTimezoneOffset() })
    });

    // Same resilience every other Supabase-backed request already has via
    // sbRequest() — this endpoint was bypassing that entirely with a plain
    // fetch(), so a session token that happened to be stale at click-time
    // failed outright instead of silently refreshing and retrying once.
    if (res.status === 401 && !isRetry) {
      log.warn('[syncBybit] Got 401, attempting token refresh...');
      const refreshed = await forceRefreshToken();
      if (refreshed) return await syncBybit({ silent, isRetry: true });
      throw new Error('Session expired — please sign in again');
    }
    // No serverless function here at all (e.g. `npm run dev`, which only
    // serves static files) — nothing to retry.
    if (res.status === 404) {
      outcome = 'unavailable';
      throw new Error('Bybit sync isn\'t available here (run with `npx vercel dev` locally)');
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // not set up on the server, or this login isn't the Bybit account's owner
      if (res.status === 403 || /not configured/i.test(data.error || '')) outcome = 'unavailable';
      throw new Error(data.error || 'Sync failed');
    }
    lastBybitSync = new Date();
    updateLastSyncLabel();

    const parts = [];
    if (data.imported > 0) parts.push(`${data.imported} imported`);
    if (data.updated > 0) parts.push(`${data.updated} updated`);
    if (parts.length) toast(`${silent ? 'Bybit auto-sync' : 'Synced'} ✓ ${parts.join(', ')}`);
    else if (!silent) toast('Already up to date — nothing new');
    if (data.imported > 0 || data.updated > 0) {
      // The server writes synced trades directly, so the trading balance
      // never saw their realized P&L — apply the change here, the same way
      // saveTrade/closeTradeSubmit do for manually logged trades.
      // The balance is worked out from the trades, so reloading them is all
      // it takes. (An older database still stores it: keep this device's
      // offset so the synced P&L moves the stored balance, then save it.)
      await loadAllData({ keepOffsets: true });
      if (!LEDGER_READY) { await persistBalances(); renderAll(); }
    }
  } catch (e) {
    if (outcome === 'ok') outcome = 'error';
    if (!silent) toast(e.message, 'err');
    else log.warn('[syncBybit] auto-sync failed:', e.message);
  } finally {
    bybitSyncInFlight = false;
    if (btn && !silent) { btn.textContent = prevText; btn.disabled = false; }
  }
  return outcome;
}

function updateLastSyncLabel() {
  const el = document.getElementById('last-sync-label');
  if (!el) return;
  el.textContent = lastBybitSync
    ? `synced ${lastBybitSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : '';
}

// ─── BYBIT AUTO-SYNC ─────────────────────────────────────────────────────────
// Syncs on open, when the tab comes back into view (if >1 min since the last
// sync) and every 3 minutes while it's visible — near real-time without a
// server running all the time. Turn off in Settings. Stops for the session
// if the sync endpoint or Bybit keys aren't available.
const AUTO_SYNC_EVERY_MS = 3 * 60 * 1000;
let autoSyncTimer = null;
let autoSyncUnavailable = false;
let lastAutoSyncAttempt = 0;

function autoSyncWanted() {
  return !isDemoMode && !!currentUser && PREFS.autoSync !== false && !autoSyncUnavailable;
}

async function autoSyncTick() {
  if (!autoSyncWanted() || document.visibilityState !== 'visible') return;
  if (Date.now() - lastAutoSyncAttempt < 60 * 1000) return;
  lastAutoSyncAttempt = Date.now();
  const outcome = await syncBybit({ silent: true });
  if (outcome === 'unavailable') {
    autoSyncUnavailable = true;
    stopBybitAutoSync();
    log.warn('[auto-sync] Bybit sync not available here — auto-sync off for this session');
  }
}

function startBybitAutoSync() {
  if (!autoSyncWanted() || autoSyncTimer) return; // already running (loadAllData re-calls this)
  autoSyncTimer = setInterval(autoSyncTick, AUTO_SYNC_EVERY_MS);
  autoSyncTick();
}

function stopBybitAutoSync() {
  if (autoSyncTimer) clearInterval(autoSyncTimer);
  autoSyncTimer = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') autoSyncTick();
});

RENDER_HOOKS.push(() => updateLastSyncLabel());
