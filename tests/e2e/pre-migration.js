// Before the 2026-10-26 migration has run: the new tables/columns are missing.
// The app must keep working (log/close trades) and show the database banner.
// Run with: npm run test:e2e
window.__errors = [];
window.addEventListener('error', e => window.__errors.push(e.message));
window.addEventListener('app-ready', () => setTimeout(async () => {
  const out = [];
  const check = (name, cond, detail) => out.push(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' → ' + JSON.stringify(detail)}`);
  const $ = id => document.getElementById(id);
  const r2 = n => Math.round(n * 100) / 100;
  // Only the columns that existed before the migration
  const OLD_TRADE_COLS = ['id', 'user_id', 'created_at', 'date', 'symbol', 'type', 'dir', 'entry', 'exit', 'size', 'sl', 'tp', 'pnl', 'rr', 'status',
    'setup', 'notes', 'tags', 'source', 'external_id', 'original_size', 'realized_exit_value', 'closes'];
  const DB = { trades: [], investments: [], user_settings: [], profiles: [] };
  const resp = (status, body) => ({ ok: status < 300, status, json: async () => JSON.parse(JSON.stringify(body)) });
  const gen = r => Object.assign(r, {
    pnl: r.exit == null ? 0 : r2((r.exit - r.entry) / r.entry * r.size),
    status: r.exit == null ? 'Open' : r.exit > r.entry ? 'Win' : 'Loss',
  });
  sbRequest = async (method, path, body) => {
    const [table, qs] = path.split('?');
    const params = new URLSearchParams(qs || '');
    if (!DB[table]) return resp(404, { message: 'relation does not exist' });
    const sel = params.get('select');
    if (sel && sel !== '*' && sel.split(',').some(c => (table === 'user_settings' && c === 'preferences') || (table === 'profiles' && c === 'avatar'))) {
      return resp(400, { message: 'column does not exist' });
    }
    const items = Array.isArray(body) ? body : body ? [body] : [];
    if (table === 'trades' && items.some(b => Object.keys(b).some(k => !OLD_TRADE_COLS.includes(k)))) return resp(400, { message: 'column does not exist' });
    if (table === 'user_settings' && items.some(b => 'preferences' in b)) return resp(400, { message: 'column preferences does not exist' });
    const match = r => [...params].every(([k, v]) => ['select', 'order', 'on_conflict', 'limit', 'offset'].includes(k) || String(r[k]) === v.replace(/^eq\./, ''));
    if (method === 'GET') {
      const off = +(params.get('offset') || 0), lim = params.get('limit') ? +params.get('limit') : Infinity;
      return resp(200, DB[table].filter(match).slice(off, off + lim));
    }
    if (method === 'POST') {
      return resp(201, items.map(b => {
        const ex = params.get('on_conflict') && DB[table].find(r => r.user_id === b.user_id);
        if (ex) return Object.assign(ex, b);
        const row = { id: crypto.randomUUID(), closes: [], ...b };
        if (table === 'trades') gen(row);
        DB[table].push(row);
        return row;
      }));
    }
    if (method === 'PATCH') {
      const hit = DB[table].filter(match);
      hit.forEach(r => { Object.assign(r, body); if (table === 'trades') gen(r); });
      return resp(200, hit);
    }
    if (method === 'DELETE') DB[table] = DB[table].filter(r => !match(r));
    return resp(204, []);
  };
  confirmDialog = async () => true;
  window.fetch = async () => resp(404, {});

  try {
    localStorage.clear();
    exitDemoMode();
    currentUser = { id: 'u-2', email: 'old@test.dev' }; userToken = 't';
    restoreAccountStateFromCache('u-2');
    await loadAllData();
    check('old DB: DB_READY false + banner shown', DB_READY === false && $('migration-banner').style.display === 'flex');
    showPage('money');
    check('old DB: money page explains the update', $('money-migration').style.display !== 'none');
    openAddTrade();
    check('old DB: fee/journal fields hidden in trade form', $('t-fees').closest('.form-group').style.display === 'none');
    Object.entries({ 't-symbol': 'BTC', 't-entry': '100', 't-exit': '110', 't-size': '100' }).forEach(([id, v]) => { $(id).value = v; });
    await saveTrade();
    check('old DB: logging a closed trade still works', TRADES.length === 1 && TRADES[0].pnl === 10 && tradingBalance === 10, { n: TRADES.length, b: tradingBalance });
    check('old DB: balance saved without preferences', DB.user_settings[0] && +DB.user_settings[0].trading_balance === 10);
    openAddTrade();
    Object.entries({ 't-symbol': 'ETH', 't-entry': '100', 't-size': '100' }).forEach(([id, v]) => { $(id).value = v; });
    await saveTrade();
    openCloseTrade(TRADES[0].id);
    $('ct-mode').value = 'partial'; $('ct-amount').value = '50'; $('ct-exit').value = '120';
    await closeTradeSubmit();
    check('old DB: partial close still works', TRADES[0].status === 'Open' && TRADES[0].size === 50, TRADES[0]);
    openFundsModal('trading', 'deposit'); $('fm-amount').value = '5'; await submitFunds();
    check('old DB: funds blocked with a clear message', /Database update needed/.test($('toast').textContent) && tradingBalance === 10, $('toast').textContent);
    // an older database still stores the balance: a reload keeps it, money the
    // history can't explain stays, and changes move it and are saved
    await loadAllData();
    check('old DB: reload keeps the balance', tradingBalance === 10, tradingBalance);
    DB.user_settings[0].trading_balance = 510; // e.g. a $500 starting balance from before any history
    await loadAllData();
    check('old DB: stored balance kept even where history can\'t explain it', tradingBalance === 510, tradingBalance);
    await deleteTrade(TRADES.find(t => t.symbol === 'BTC').id);
    check('old DB: deleting the +$10 trade → 500, saved', tradingBalance === 500 && +DB.user_settings[0].trading_balance === 500, [tradingBalance, DB.user_settings[0].trading_balance]);
    for (const id of Object.keys(PAGES)) showPage(id);
    check('old DB: every page renders without errors', window.__errors.length === 0, window.__errors);
  } catch (e) { out.push('FAIL threw ' + e.message + ' ' + (e.stack || '').split('\n')[1]); }
  console.log('SMOKE RESULT ' + btoa(unescape(encodeURIComponent(JSON.stringify({ checks: out, errors: window.__errors })))));
}, 300));
