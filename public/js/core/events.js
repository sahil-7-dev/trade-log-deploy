// ═══════════════════════════════════════════════════════════════════════════
// Event wiring: one delegated listener per event type (strict CSP — no
// inline handlers). Feature/page files register via ACTIONS etc. (ui.js).
// ═══════════════════════════════════════════════════════════════════════════

// ─── EVENT DELEGATION (CSP-safe replacement for inline on* handlers) ─────────
// Strict CSP (script-src 'self') blocks inline onclick/onchange/etc attributes.
// Every interactive element in the HTML/templates instead carries a
// data-action attribute; these three listeners route all UI events centrally.

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const a = t.dataset.action;
  switch (a) {
    case 'toggle-sidebar': toggleSidebar(); break;
    case 'sign-in': sbSignIn(); break;
    case 'show-auth-from-demo': goToAuthFromDemo(); break;
    case 'back-to-demo': backToDemo(); break;
    case 'sign-up': sbSignUp(); break;
    case 'sign-out': isDemoMode ? goToAuthFromDemo() : sbSignOut(); break;
    case 'set-currency': setCurrency(t.dataset.currency, t); break;
    case 'show-page': e.preventDefault(); showPage(t.dataset.page, t); break;
    case 'toggle-balance': toggleBalanceVisibility(); break;
    case 'open-profile-modal': openProfileModal_internal(); break;
    case 'export-csv': exportCSV(); break;
    case 'sync-bybit': syncBybit(); break;
    case 'open-add-investment': openAddInvestment(); break;
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
    default:
      // Actions registered by the feature files (see ui.js)
      if (ACTIONS[a]) {
        ACTIONS[a](t, e);
        if (t.classList.contains('nav-item')) closeSidebar(); // tools in the mobile drawer
      }
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'profile-photo-input') return handleProfilePhoto(t);
  if (t.id === 'cp-type') return onCloseTypeChange();
  if (t.id === 'ct-mode') return updateCloseTradePreview();
  if (t.id === 'yr-year-select') return onRecapYearChange(t.value);
  if (t.dataset && t.dataset.action === 'update-cond') {
    return updateCond(parseInt(t.dataset.condId, 10), t.dataset.condField, t.value);
  }
  if (t.id && CHANGE_HANDLERS[t.id]) return CHANGE_HANDLERS[t.id](t);
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'cp-exit-price' || t.id === 'cp-qty') updateClosePnl();
  if (t.id === 'ct-exit' || t.id === 'ct-amount' || t.id === 'ct-fee') updateCloseTradePreview();
  if (t.id === 'profile-name-input') onProfileNameInput(t.value);
  if (t.id && INPUT_HANDLERS[t.id]) INPUT_HANDLERS[t.id](t);
});

document.addEventListener('keydown', (e) => {
  if (e.target.id === 'auth-pass' && e.key === 'Enter') sbSignIn();
});

