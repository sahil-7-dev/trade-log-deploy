// ═══════════════════════════════════════════════════════════════════════════
// Loading all of a user's data, and detecting whether migrations have run.
// ═══════════════════════════════════════════════════════════════════════════

// ─── LOAD DATA ────────────────────────────────────────────────────────────────
async function loadAllData({ keepOffsets = false } = {}) {
  showLoading(true);
  try {
    // The funds ledger doubles as the "has the 2026-10-26 migration run?"
    // probe: everything that depends on it is switched on only when it has.
    const funds = await sbSelectOptional(`fund_transactions?select=*&order=date.desc,created_at.desc,id.desc`);
    DB_READY = Array.isArray(funds);
    FEE_SPLIT_READY = DB_READY && (await sbRequest('GET', 'trades?select=buy_fee&limit=1')).ok;
    showMigrationBanner(!DB_READY);

    const [trades, investments, settings, profile, realized, snapshots] = await Promise.all([
      sbSelect('trades', 'select=*'),
      sbSelect('investments', 'select=*'),
      sbGetSettings().catch(e => { log.warn('[loadAllData] Settings fetch failed:', e.message); return null; }),
      sbGetProfile().catch(e => { log.warn('[loadAllData] Profile fetch failed:', e.message); return null; }),
      DB_READY ? sbSelectOptional('realized_positions?select=*&order=date.desc,created_at.desc,id.desc') : null,
      DB_READY ? sbSelectOptional('portfolio_snapshots?select=*&order=date.asc') : null,
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
    FUNDS = DB_READY ? funds.map(normalizeFund) : [];
    SNAPSHOTS = Array.isArray(snapshots) ? snapshots.map(s => ({
      date: s.date, holdings_value: parseFloat(s.holdings_value) || 0,
      cost_basis: parseFloat(s.cost_basis) || 0, cash: parseFloat(s.cash) || 0,
    })) : [];

    // Balances: worked out from the history once the 2026-10-27 update has
    // run (ledger_balances). An older database still stores them: the stored
    // values are kept, anchored to the history (core/balances.js).
    // keepOffsets: a reload after this device changed things the stored
    // values don't know about yet (a Bybit sync on an older database).
    const prevOffsets = { ...balanceOffsets };
    if (Array.isArray(settings) && settings.length > 0) {
      LEDGER_READY = FEE_SPLIT_READY && settings[0].ledger_balances === true;
      PREFS = (settings[0].preferences && typeof settings[0].preferences === 'object') ? settings[0].preferences : {};
      prefsLoaded = true;
      realizedHistory = DB_READY && Array.isArray(realized)
        ? realized.map(normalizeRealized)
        : (Array.isArray(settings[0].realized_history) ? settings[0].realized_history : []);
      if (LEDGER_READY) balanceOffsets = { trading: 0, cash: 0 };
      else anchorBalances(parseFloat(settings[0].trading_balance) || 0, parseFloat(settings[0].cash_balance) || 0);
      safeLocalSet('realized_history', JSON.stringify(realizedHistory));
      safeLocalSet('cache_owner', currentUser.id);
    } else if (settings !== null) {
      // No row yet: a new account. With the update, its balances are the
      // history from the start; on an older database the cached values are
      // kept and saved up so they aren't lost.
      prefsLoaded = true;
      LEDGER_READY = FEE_SPLIT_READY;
      if (DB_READY && Array.isArray(realized)) realizedHistory = realized.map(normalizeRealized);
      if (LEDGER_READY) balanceOffsets = { trading: 0, cash: 0 };
      else {
        anchorBalances(tradingBalance, cashBalance);
        sbUpsertSettings().catch(e => log.warn('[loadAllData] Initial settings migration failed:', e.message));
      }
    } else {
      // Settings fetch failed (offline blip): keep showing what was showing
      anchorBalances(tradingBalance, cashBalance);
    }
    if (keepOffsets && !LEDGER_READY) balanceOffsets = prevOffsets;
    recomputeBalances();
    safeLocalSet('cash_balance', cashBalance.toString());
    safeLocalSet('trading_balance', tradingBalance.toString());

    if (Array.isArray(profile) && profile.length > 0) {
      // Server has a claimed display name — it's the source of truth
      profileName = profile[0].display_name || '';
      safeLocalSet('profile_name', profileName);
      // Photo synced across devices; a photo only this browser has gets
      // uploaded once so other devices see it too.
      if (profile[0].avatar) {
        profilePhoto = profile[0].avatar;
        safeLocalSet('profile_photo', profilePhoto);
      } else if (DB_READY && profilePhoto && profilePhoto === localStorage.getItem('profile_photo')) {
        sbUpsertProfile(profileName, profilePhoto).catch(e => log.warn('[loadAllData] Photo upload failed:', e.message));
      }
      loadProfile();
    } else if (profile !== null && profileName) {
      // No server row yet, but a local name exists from before this feature —
      // try to claim it server-side. If someone else already has it, leave it
      // local-only; the profile modal will prompt for a different name next
      // time it's opened, same as any other "taken" case.
      sbUpsertProfile(profileName, profilePhoto || undefined).catch(e => log.warn('[loadAllData] Initial profile migration failed:', e.message));
    }

    log.info('[loadAllData] Success — trades:', TRADES.length, 'holdings:', HOLDINGS.length);
    renderAll();
    startPriceRefresh();
    if (typeof startBybitAutoSync === 'function') startBybitAutoSync();
  } catch (e) {
    log.error('[loadAllData] Failed:', e.message);
    if (e.code === 'SESSION_EXPIRED') {
      toast(e.message, 'err'); // sbRequest already signs out
    } else {
      toast('Failed to load data: ' + e.message, 'err');
    }
  }
  showLoading(false);
}

// Writes that need the 2026-10-26 tables call this first (like demoGuard)
function migrationGuard() {
  if (DB_READY) return false;
  toast('Database update needed first — see the banner at the top', 'err');
  return true;
}

