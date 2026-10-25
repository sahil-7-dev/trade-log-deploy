// ═══════════════════════════════════════════════════════════════════════════
// Supabase REST access (PostgREST via fetch) + settings/profile reads and writes.
// ═══════════════════════════════════════════════════════════════════════════

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
    // sign out properly (stops price/auto-sync timers, clears this account
    // from memory) once the caller has shown the error
    setTimeout(() => { if (currentUser) sbSignOut(); }, 0);
    const err = new Error('Your session expired — please sign in again');
    err.code = 'SESSION_EXPIRED';
    throw err;
  }
  return res;
}

// Supabase returns at most 1,000 rows per request (its default max-rows), so
// a bigger table would be silently cut off — page through it instead. The
// order must be total (id last) for the pages not to overlap or skip rows.
const PAGE_ROWS = 1000;
async function sbGetAll(path) {
  let rows = [];
  for (let offset = 0; ; offset += PAGE_ROWS) {
    const res = await sbRequest("GET", `${path}${path.includes('?') ? '&' : '?'}limit=${PAGE_ROWS}&offset=${offset}`);
    if (!res.ok) return { ok: false, status: res.status };
    const page = await res.json();
    rows = rows.concat(page);
    if (page.length < PAGE_ROWS) return { ok: true, rows };
  }
}

async function sbSelect(table, query = "") {
  const orderCol = table === "investments" ? "buy_date" : "date";
  // Sorting by orderCol alone leaves ties completely undefined — e.g. a
  // trade that gets closed today has its `date` overwritten to today too
  // (needed so the P&L calendar attributes realized P&L to the right month),
  // so an old trade closed today and a brand-new trade opened today can tie
  // on `date` with no guaranteed order between them. created_at (set once,
  // at insert, never touched by later updates) breaks that tie reliably —
  // the truly most-recently-added row always sorts first among ties.
  const res = await sbGetAll(`${table}?${query}&order=${orderCol}.desc,created_at.desc,id.desc`);
  if (!res.ok) throw new Error(`DB error: ${res.status}`);
  return res.rows;
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
  const cols = 'cash_balance,trading_balance,realized_history' + (DB_READY ? ',preferences' : '') + (FEE_SPLIT_READY ? ',ledger_balances' : '');
  const res = await sbRequest("GET", `user_settings?user_id=eq.${currentUser.id}&select=${cols}`);
  if (!res.ok) throw new Error(`Settings load failed: ${res.status}`);
  return res.json();
}

// Older database only: the stored balances + preferences / legacy history.
async function sbUpsertSettings() {
  recomputeBalances();
  // Once migrated, closed investment positions live in realized_positions and
  // preferences get saved; before that, the legacy JSON list is kept current.
  const body = { user_id: currentUser.id, cash_balance: cashBalance, trading_balance: tradingBalance };
  // Only send preferences once they've actually been loaded — if loading
  // failed (offline blip), PREFS is empty and would erase the saved goals
  if (DB_READY && prefsLoaded) body.preferences = PREFS;
  else body.realized_history = realizedHistory;
  const res = await sbRequest(
    "POST",
    "user_settings?on_conflict=user_id",
    body,
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
  const res = await sbRequest("GET", `profiles?user_id=eq.${currentUser.id}&select=${DB_READY ? 'display_name,avatar' : 'display_name'}`);
  if (!res.ok) throw new Error(`Profile load failed: ${res.status}`);
  return res.json();
}

async function sbCheckNameAvailable(name) {
  const res = await sbRequest("POST", "rpc/is_display_name_available", { check_name: name });
  if (!res.ok) throw new Error(`Availability check failed: ${res.status}`);
  return res.json(); // true | false
}

async function sbUpsertProfile(name, avatar) {
  const body = { user_id: currentUser.id, display_name: name };
  if (DB_READY && avatar !== undefined) body.avatar = avatar;
  const res = await sbRequest(
    "POST",
    "profiles?on_conflict=user_id",
    body,
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

// Plain GET of a table that only exists after the 2026-10-26 migration.
// Resolves to null (instead of throwing) when the table isn't there yet.
async function sbSelectOptional(path) {
  const res = await sbGetAll(path);
  return res.ok ? res.rows : null;
}

// realized_positions row → the in-memory shape the UI already uses
function normalizeRealized(r) {
  return {
    id: r.id, date: r.date, symbol: r.symbol, type: r.type, buyDate: r.buy_date,
    qtySold: parseFloat(r.qty_sold) || 0, avgCost: parseFloat(r.avg_cost) || 0,
    exitPrice: parseFloat(r.exit_price) || 0, realizedPnl: parseFloat(r.realized_pnl) || 0,
    proceeds: parseFloat(r.proceeds) || 0, closeType: r.close_type,
  };
}

function normalizeFund(f) {
  return { ...f, amount: parseFloat(f.amount) || 0 };
}

function showMigrationBanner(show) {
  const el = document.getElementById('migration-banner');
  if (el) el.style.display = show ? 'flex' : 'none';
}


// Saves preferences (and, on an older database, the stored balances).
// Returns true when the server has them. Saves run one at a time.
let settingsSaveChain = Promise.resolve();
function saveUserSettings() {
  recomputeBalances();
  safeLocalSet('realized_history', JSON.stringify(realizedHistory));
  safeLocalSet('cash_balance', cashBalance.toString());
  safeLocalSet('trading_balance', tradingBalance.toString());
  if (currentUser) safeLocalSet('cache_owner', currentUser.id);
  const run = settingsSaveChain.then(async () => {
    try {
      if (LEDGER_READY) await sbUpsertPrefs();
      else await sbUpsertSettings();
      return true;
    } catch (e) {
      log.warn('[saveUserSettings] Supabase save failed:', e.message);
      toast(LEDGER_READY ? 'Settings couldn\'t be saved to the server — try again' : 'Saved on this device — the server save failed', 'err');
      return false;
    }
  });
  settingsSaveChain = run;
  return run;
}

// Preferences only (goals, limits, auto-sync) — balances untouched
async function sbUpsertPrefs() {
  if (!prefsLoaded) return;
  const res = await sbRequest('POST', 'user_settings?on_conflict=user_id', { user_id: currentUser.id, preferences: PREFS },
    false, 'resolution=merge-duplicates,return=minimal');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Settings save failed: ${res.status}`);
  }
}

// Clears the list only. It used to also zero the cash balance, which wiped
// real money from the books — use a funds adjustment for that instead.
