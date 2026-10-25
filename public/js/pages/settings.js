// ═══════════════════════════════════════════════════════════════════════════
// Settings page: goals & limits, Bybit sync, display, your data, account and
// database status. The form refills on open and when data loads — but never
// once you've started editing it, so a price refresh can't wipe your typing.
// ═══════════════════════════════════════════════════════════════════════════

registerPage('settings', {
  title: 'Settings', subtitle: 'Goals, limits, sync, display and your data', icon: '⚙', section: 'Tools', order: 40,
  // Re-renders (data loaded, price refresh) refill the form only while you
  // haven't started editing it — typing is never overwritten.
  render: () => { if (!settingsDirty) fillSettingsForm(); else renderSettingsStatus(); },
  onShow: () => { if (!settingsDirty) fillSettingsForm(); },
});

let settingsDirty = false;
['set-target', 'set-loss-limit', 'set-risk'].forEach(id => { INPUT_HANDLERS[id] = () => { settingsDirty = true; }; });
['set-fee-buy', 'set-fee-sell'].forEach(id => { INPUT_HANDLERS[id] = () => { settingsDirty = true; renderFeeExample(); }; });

// What the rates typed in would charge on a $1,000 Long closed at +10%
function renderFeeExample() {
  const pct = id => { const v = parseFloat(document.getElementById(id).value); return v > 0 ? v / 100 : 0; };
  const buy = round2(1000 * pct('set-fee-buy')), sell = round2(1100 * pct('set-fee-sell')); // same rounding as a trade
  setText('set-fee-example', buy || sell
    ? `$1,000 Long sold at +10%: buy $${buy.toFixed(2)} + sell $${sell.toFixed(2)} = $${(buy + sell).toFixed(2)}`
    : 'No default fees — enter them per trade');
}
CHANGE_HANDLERS['set-autosync'] = () => { settingsDirty = true; };

function fillSettingsForm() {
  const val = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  val('set-target', PREFS.monthlyTarget || '');
  val('set-loss-limit', PREFS.dailyLossLimit || '');
  val('set-risk', PREFS.riskPct || '');
  val('set-fee-buy', PREFS.feeBuyPct || '');
  val('set-fee-sell', PREFS.feeSellPct || '');
  renderFeeExample();
  const auto = document.getElementById('set-autosync');
  if (auto) auto.checked = PREFS.autoSync !== false;
  const compact = document.getElementById('set-compact');
  if (compact) compact.checked = document.body.classList.contains('sidebar-collapsed');
  const hide = document.getElementById('set-hide-balances');
  if (hide) hide.checked = balanceHidden;
  renderSettingsStatus();
}

// Read-only status bits — safe to refresh any time
function renderSettingsStatus() {
  setText('set-fx', `1 USD = ₹${USD_INR.toFixed(2)}${localStorage.getItem('fx_usd_inr_date') ? ' · ECB rate of ' + localStorage.getItem('fx_usd_inr_date') : ''}`);
  setText('set-sync-status', lastBybitSync
    ? `Last synced ${lastBybitSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${autoSyncUnavailable ? ' · auto-sync unavailable here' : ''}`
    : autoSyncUnavailable ? 'Sync isn\'t available here (no server function / Bybit keys)' : 'Not synced yet this session');
  setHtml('set-db-status', isDemoMode ? '<span class="muted">Demo mode</span>'
    : DB_READY ? '<span class="green">✓ Up to date</span>'
    : '<span class="amber">⚠ Needs <code>sql/migrations/2026-10-26-features.sql</code></span>');
  setText('set-account-email', isDemoMode ? 'Demo mode — not signed in' : (currentUser && currentUser.email) || '—');
  document.querySelectorAll('#page-settings [data-currency]').forEach(b => b.classList.toggle('active', b.dataset.currency === currency));
}

function openSettings() {
  showPage('settings');
  fillSettingsForm();
}

async function saveSettings() {
  if (demoGuard() || migrationGuard()) return;
  const num = id => { const v = parseFloat(document.getElementById(id).value); return v > 0 ? v : null; };
  const feeBuy = num('set-fee-buy'), feeSell = num('set-fee-sell');
  if ((feeBuy || 0) >= 10 || (feeSell || 0) >= 10) return toast('Fee rates are a % — e.g. 0.04 for 0.04%. 10% or more looks like a typo.', 'err');
  PREFS = {
    ...PREFS,
    monthlyTarget: num('set-target'),
    dailyLossLimit: num('set-loss-limit'),
    riskPct: num('set-risk'),
    feeBuyPct: feeBuy,
    feeSellPct: feeSell,
    autoSync: document.getElementById('set-autosync').checked,
  };
  const saved = await saveUserSettings();
  settingsDirty = false;
  if (PREFS.autoSync) { autoSyncUnavailable = false; startBybitAutoSync(); } else stopBybitAutoSync();
  renderAll();
  if (saved) toast('Settings saved ✓'); // otherwise saveUserSettings already said why
}

ACTIONS['open-settings'] = () => openSettings();
ACTIONS['save-settings'] = () => saveSettings();
CHANGE_HANDLERS['set-compact'] = el => toggleSidebarCollapsed(el.checked);
CHANGE_HANDLERS['set-hide-balances'] = el => { if (el.checked !== balanceHidden) toggleBalanceVisibility(); };
