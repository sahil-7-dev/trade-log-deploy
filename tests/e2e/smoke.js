// End-to-end test of the whole app in headless Chrome, against an in-memory
// fake of Supabase's REST API (incl. the generated pnl / net_pnl / status
// columns). Injected by tests/run-e2e.js — run with: npm run test:e2e
window.__errors = [];
window.addEventListener('error', e => window.__errors.push(e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));
window.addEventListener('unhandledrejection', e => window.__errors.push('unhandled: ' + (e.reason && e.reason.message)));

// Runs once the app has loaded its pages and rendered (demo mode)
window.addEventListener('app-ready', () => setTimeout(async () => {
  const out = { checks: [] };
  const check = (name, cond, detail) => out.checks.push(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' → ' + JSON.stringify(detail)}`);
  const step = async (name, fn) => { console.log('SMOKE step: ' + name); try { await fn(); console.log('SMOKE done: ' + name); } catch (e) { out.checks.push(`FAIL ${name} threw: ${e.message} @ ${(e.stack || '').split('\n')[1]}`); } };
  const r2 = n => Math.round(n * 100) / 100;
  const $ = id => document.getElementById(id);

  // ── 1. Demo mode: every page renders (pages render lazily, on open) ──
  const go = id => showPage(id);
  await step('demo', async () => {
    // Shell: sidebar built from the page registry, URL routing
    const navIds = [...document.querySelectorAll('#nav .nav-item')].map(n => n.dataset.page);
    check('nav built from page registry (13 pages)', navIds.length === 13 && navIds.includes('networth') && navIds.includes('risk') && navIds.includes('money') && navIds.includes('insights'), navIds);
    check('only the open page rendered at start-up', Object.keys(chartInstances).every(id => ['equityChart', 'dailyPnlChart'].includes(id)), Object.keys(chartInstances));

    // Overview
    check('overview: hero shows net P&L', /Net P&L/.test($('dash-hero').textContent) && $('dash-hero').querySelector('svg'));
    check('overview: 6 KPI tiles with sparklines', $('dash-kpis').querySelectorAll('.stat-card').length === 6 && $('dash-kpis').querySelectorAll('svg').length >= 3);
    check('overview: goals card filled', $('goals-body').textContent.includes('This month'));
    check('overview: equity + daily P&L charts', !!chartInstances.equityChart && !!chartInstances.dailyPnlChart);
    check('overview: open positions listed', $('dash-open-body').querySelectorAll('tr').length >= 2);
    check('overview: outcomes bar', $('dash-outcomes').querySelector('.comp-bar') != null);
    check('overview: net worth card', /Realized/.test($('dash-networth').textContent) && $('dash-networth').querySelector('.comp-bar') != null);

    go('trades');
    check('routing: hash follows the page', location.hash === '#/trades');
    check('trade log: pager shown', $('tl-pager').textContent.length > 0);
    check('trade log: rows rendered', $('all-trades-body').querySelectorAll('tr').length >= 10);
    ACTIONS['tl-sort']({ dataset: { sort: 'pnl' } });
    const pnlCells = [...$('all-trades-body').querySelectorAll('tr')].map(r => r.children[1].textContent.trim());
    check('trade log: sort by P&L toggles header state', document.querySelector('#page-trades th[data-sort="pnl"]').classList.contains('sort-desc') && pnlCells.length > 0);
    ACTIONS['tl-sort']({ dataset: { sort: 'date' } });

    go('analytics');
    check('performance: 6 charts drawn', ['monthlyPnlChart', 'setupCurveChart', 'symbolPnlChart', 'assetPnlChart', 'winRateAssetChart', 'pnlDistChart'].every(id => chartInstances[id]), Object.keys(chartInstances));
    check('performance: setup curves use ≤ 5 lines', chartInstances.setupCurveChart.data.datasets.length <= 5);

    go('insights');
    check('insights: advanced metrics filled', $('adv-metrics').querySelectorAll('.metric').length >= 10);
    check('insights: performance table has rows', $('group-table-body').querySelectorAll('tr').length >= 3);
    check('insights: weekday × hour heatmap', $('wh-heat').querySelectorAll('.wh-cell[data-tip]').length >= 5);
    check('insights: mistakes + scatter + session charts', !!chartInstances.mistakeChart && !!chartInstances.holdScatterChart && !!chartInstances.sessionChart);
    check('insights: plan vs no plan', /Followed plan/.test($('plan-compare').textContent));
    $('group-by').value = 'mistake'; CHANGE_HANDLERS['group-by']($('group-by'));
    check('insights: group by mistake', $('group-table-body').textContent.includes('Moved stop loss') || $('group-table-body').textContent.includes('(no mistakes)'));

    go('risk');
    check('risk: KPI tiles', $('risk-kpis').querySelectorAll('.stat-card').length === 6);
    check('risk: drawdown + rolling + R charts', ['drawdownChart', 'rollingWinChart', 'rollingExpChart', 'rDistChart'].every(id => chartInstances[id]));
    check('risk: exposure table', $('exposure-body').querySelectorAll('tr').length >= 2);

    go('investing');
    check('portfolio: allocation + returns + history', !!chartInstances.allocChart && !!chartInstances.holdingRetChart && !!chartInstances.portfolioHistoryChart);
    check('portfolio: holdings listed', $('holdings-list').querySelectorAll('.holding-row').length >= 5);

    go('equity');
    check('equity: balance chart with money in/out markers', chartInstances.balanceChart && chartInstances.balanceChart.data.datasets.length === 3);
    check('equity: return on capital shown', /%/.test($('ov-roc').textContent));

    go('networth');
    const nwd = computeNetWorth();
    check('net worth (demo): page renders hero, tiles, breakdown, bridge, history', /Total net worth/.test($('nw-hero').textContent)
      && $('nw-kpis').querySelectorAll('.stat-card').length === 6 && $('nw-breakdown').querySelectorAll('tr').length >= 5
      && !!chartInstances.nwBridgeChart && !!chartInstances.nwHistoryChart);
    check('net worth (demo): = money put in + gains', Math.abs(nwd.total - (nwd.moneyIn + nwd.gains)) < 0.01
      && Math.abs(nwd.total - (tradingBalance + nwd.partialRealized + nwd.openUnrealized + cashBalance + nwd.holdingsValue)) < 0.01, nwd);
    check('net worth (demo): history has a point per snapshot day', chartInstances.nwHistoryChart.data.labels.length >= 80);

    go('money');
    check('money: funds history listed', $('funds-body').querySelectorAll('tr').length >= 5);
    check('money: cash flow + net deposits charts', !!chartInstances.cashFlowChart && !!chartInstances.netDepositsChart);
    $('money-f-account').value = 'investing'; CHANGE_HANDLERS['money-f-account']($('money-f-account'));
    check('money: account filter', [...$('funds-body').querySelectorAll('tr')].every(r => /Investing/.test(r.textContent)));
    $('money-f-account').value = ''; CHANGE_HANDLERS['money-f-account']($('money-f-account'));

    go('calendar');
    check('calendar: year activity heatmap', $('year-heat').querySelectorAll('.year-cell[data-tip]').length >= 300);
    go('yearly');
    check('yearly: monthly + cumulative charts', !!chartInstances.yrMonthlyChart && !!chartInstances.yrCumChart);
    go('settings');
    check('settings: page form', $('set-target').value === '300' && $('set-autosync') != null);

    // Leaving a page destroys its charts (only the open page's charts exist)
    go('dashboard');
    check('lazy rendering: other pages\' charts released', !chartInstances.mistakeChart && !!chartInstances.equityChart, Object.keys(chartInstances));

    // Chart ⇄ table toggle
    const btn = document.querySelector('#page-dashboard .chart-toggle');
    ACTIONS['toggle-chart-table'](btn);
    check('chart table view', btn.closest('.chart-card').querySelector('.chart-table table') != null);
    ACTIONS['toggle-chart-table'](btn);

    // Command palette
    openCommandPalette();
    $('cmdk-input').value = 'risk'; INPUT_HANDLERS['cmdk-input']($('cmdk-input'));
    check('command palette finds pages', /Risk/.test($('cmdk-list').textContent));
    $('cmdk-input').value = 'BTC'; INPUT_HANDLERS['cmdk-input']($('cmdk-input'));
    check('command palette finds trades', /BTC · 20/.test($('cmdk-list').textContent));
    closeCommandPalette();

    // detail panel
    openTradeDetail(TRADES[0].id);
    check('demo: trade detail opens', $('trade-detail-modal').classList.contains('open') && $('td-grid').querySelectorAll('.detail-field').length >= 15);
    closeModal('trade-detail-modal');
    // calculator: $1000, 1% risk, entry 100, stop 95 → $10 risk / 5% = $200 size
    openCalculator();
    $('calc-balance').value = '1000'; $('calc-risk').value = '1'; $('calc-entry').value = '100'; $('calc-sl').value = '95'; $('calc-tp').value = '115';
    updateCalculator();
    check('calculator: $200 size, 3R planned', $('calc-result').textContent.includes('$200.00') && $('calc-result').textContent.includes('3.00R'), $('calc-result').textContent);
    ACTIONS['calc-use']();
    check('calculator → trade form prefilled', $('trade-modal').classList.contains('open') && $('t-size').value === '200.00' && $('t-dir').value === 'Long');
    closeModal('trade-modal');
    // date range
    const all = computeStats(tradesInRange()).closed.length;
    RANGE.preset = 'lastyear'; renderAll();
    check('date range: last year has no demo trades', computeStats(tradesInRange()).closed.length === 0 && all > 0, all);
    RANGE.preset = 'all'; renderAll();
    // search
    go('trades');
    TL_FILTERS.q = 'eth'; renderTrades();
    const rows = [...$('all-trades-body').querySelectorAll('tr')].map(r => r.textContent);
    check('search filters trade log', rows.length > 0 && rows.every(t => /ETH/.test(t)), rows.length);
    TL_FILTERS.q = ''; renderTrades();
    go('dashboard');
  });

  // ── 2. Signed in, against a fake Supabase ──
  const DB = { trades: [], investments: [], user_settings: [], profiles: [], fund_transactions: [], realized_positions: [], portfolio_snapshots: [] };
  const genTrade = t => {
    const move = t.exit == null ? 0 : (t.dir === 'Long' ? t.exit - t.entry : t.entry - t.exit) / t.entry * t.size;
    const fees = +t.fees || 0;
    t.pnl = t.exit == null ? 0 : r2(move);
    t.net_pnl = t.exit == null ? 0 : r2(move - fees);
    t.status = t.exit == null ? 'Open' : r2(move - fees) === 0 ? 'Breakeven' : move - fees > 0 ? 'Win' : 'Loss';
    if (t.fees == null) t.fees = 0;
    if (!t.closes) t.closes = [];
    return t;
  };
  const matchRow = (row, params) => [...params].every(([k, v]) => {
    if (['select', 'order', 'on_conflict', 'limit', 'offset'].includes(k)) return true;
    if (v.startsWith('eq.')) return String(row[k]) === v.slice(3);
    if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(String(row[k]));
    throw new Error('fake db: unsupported filter ' + k + '=' + v);
  });
  const resp = (status, body) => ({ ok: status < 300, status, json: async () => JSON.parse(JSON.stringify(body)), text: async () => JSON.stringify(body) });
  sbRequest = async (method, path, body) => {
    const [table, qs] = path.split('?');
    const params = new URLSearchParams(qs || '');
    const rows = DB[table];
    if (!rows) return resp(404, { message: 'no table ' + table });
    if (method === 'GET') {
      const off = +(params.get('offset') || 0), lim = params.get('limit') ? +params.get('limit') : Infinity;
      return resp(200, rows.filter(r => matchRow(r, params)).slice(off, off + lim));
    }
    if (method === 'POST') {
      const items = (Array.isArray(body) ? body : [body]).map(b => JSON.parse(JSON.stringify(b)));
      const conflict = params.get('on_conflict');
      const out = items.map(b => {
        if (conflict) {
          const keys = conflict.split(',');
          const ex = rows.find(r => keys.every(k => String(r[k]) === String(b[k])));
          if (ex) { Object.assign(ex, b); return ex; }
        }
        const row = { id: b.id || uuid(), created_at: new Date().toISOString(), ...b };
        if (table === 'trades') genTrade(row);
        if (table === 'user_settings' && row.ledger_balances == null) row.ledger_balances = true; // column default
        rows.push(row);
        return row;
      });
      return resp(201, out);
    }
    if (method === 'PATCH') {
      const hit = rows.filter(r => matchRow(r, params));
      hit.forEach(r => { Object.assign(r, JSON.parse(JSON.stringify(body))); if (table === 'trades') genTrade(r); });
      return resp(200, hit);
    }
    if (method === 'DELETE') {
      const keep = rows.filter(r => !matchRow(r, params));
      DB[table] = keep;
      return resp(204, []);
    }
  };
  confirmDialog = async () => true;
  let downloaded = null;
  downloadFile = (name, text) => { downloaded = { name, text }; };
  const realFetch = window.fetch;
  window.fetch = async (url, opts = {}) => {
    url = String(url);
    if (url.includes('/api/bybit-sync')) return resp(404, {});
    if (url.includes('frankfurter')) return resp(200, { date: '2026-10-23', rates: { INR: 94.94 } });
    if (url.includes('coingecko')) return resp(200, {});
    if (url.includes('/auth/v1/user') && opts.method === 'PUT') return resp(200, { id: 'u-1', email: 'me@test.dev' });
    return realFetch(url, opts);
  };

  await step('sign in', async () => {
    localStorage.clear();
    exitDemoMode();
    currentUser = { id: 'u-1', email: 'me@test.dev' }; userToken = 'tok';
    restoreAccountStateFromCache('u-1');
    await loadAllData();
    check('signed in: migration detected (DB_READY)', DB_READY === true);
    check('signed in: no migration banner', $('migration-banner').style.display === 'none');
    check('signed in: demo data gone', TRADES.length === 0 && FUNDS.length === 0 && tradingBalance === 0 && cashBalance === 0);
  });

  const funds = async (account, action, amount, extra = {}) => {
    openFundsModal(account, action);
    $('fm-amount').value = String(amount);
    if (extra.dir) $('fm-adjust-dir').value = extra.dir;
    if (extra.note) $('fm-note').value = extra.note;
    await submitFunds();
  };

  await step('funds', async () => {
    await funds('trading', 'deposit', 1000, { note: 'first' });
    check('deposit 1000 → trading 1000', tradingBalance === 1000 && DB.fund_transactions.length === 1, tradingBalance);
    await funds('trading', 'withdraw_bank', 200);
    await funds('trading', 'withdraw_removed', 50);
    check('withdraw to bank 200 + removed 50 → 750', tradingBalance === 750, tradingBalance);
    const t = fundTotals('trading');
    check('totals: deposited 1000, to bank 200, removed 50', t.deposited === 1000 && t.toBank === 200 && t.removed === 50, t);
    await funds('trading', 'withdraw_bank', 5000);
    check('over-withdrawal rejected', tradingBalance === 750 && DB.fund_transactions.length === 3);
    await funds('trading', 'transfer', 100);
    const xfer = DB.fund_transactions.filter(f => f.transfer_id);
    check('transfer 100 → trading 650, investing 100, two linked rows', tradingBalance === 650 && cashBalance === 100 && xfer.length === 2 && xfer[0].transfer_id === xfer[1].transfer_id, [tradingBalance, cashBalance]);
    await deleteFund(FUNDS.find(f => f.kind === 'transfer_in').id);
    check('delete transfer → both sides reversed', tradingBalance === 750 && cashBalance === 0 && DB.fund_transactions.length === 3, [tradingBalance, cashBalance]);
    document.querySelector('#toast .toast-action').click();
    await new Promise(r => setTimeout(r, 50));
    check('undo transfer delete → restored', tradingBalance === 650 && cashBalance === 100 && DB.fund_transactions.length === 5, [tradingBalance, cashBalance]);
    await funds('trading', 'adjustment', 10, { dir: '-' });
    check('adjustment −10 → 640', tradingBalance === 640, tradingBalance);
    check('balance worked out from the funds history (640), never stored', tradingBalance === 640 && !DB.user_settings.some(r => 'trading_balance' in r));
  });

  await step('trades + fees', async () => {
    openAddTrade();
    Object.entries({ 't-symbol': 'BTCUSDT', 't-entry': '100', 't-exit': '110', 't-size': '1000', 't-buy-fee': '1', 't-sell-fee': '1', 't-sl': '95',
      't-emotion': 'Calm', 't-followed': 'true', 't-mistakes': 'Late exit, Oversized', 't-closed-at': localToday() + 'T10:30' })
      .forEach(([id, v]) => { $(id).value = v; });
    await saveTrade();
    const t = TRADES[0];
    check('trade with $2 fee: gross 100, net 98, Win', t.grossPnl === 100 && t.pnl === 98 && t.status === 'Win', { g: t.grossPnl, n: t.pnl, s: t.status });
    check('balance moved by NET P&L (+98)', tradingBalance === 738, tradingBalance);
    check('journal fields saved', t.emotion === 'Calm' && t.followed_plan === true && t.mistakes.length === 2 && !!t.closed_at);
    check('R:R on net P&L (98 / 50 = 1.96R)', Math.abs(t.rr - 1.96) < 0.001, t.rr);

    openAddTrade();
    Object.entries({ 't-symbol': 'ETHUSDT', 't-entry': '100', 't-exit': '100.02', 't-size': '100', 't-sell-fee': '0.02' }).forEach(([id, v]) => { $(id).value = v; });
    await saveTrade();
    check('fees eat the whole move → Breakeven', TRADES[0].status === 'Breakeven' && TRADES[0].pnl === 0, TRADES[0]);
  });

  await step('partial close with fees', async () => {
    openAddTrade();
    Object.entries({ 't-symbol': 'SOLUSDT', 't-entry': '100', 't-size': '100' }).forEach(([id, v]) => { $(id).value = v; });
    await saveTrade();
    const id = TRADES[0].id;
    const bal = tradingBalance;
    openCloseTrade(id);
    $('ct-mode').value = 'partial'; $('ct-amount').value = '50'; $('ct-exit').value = '110'; $('ct-fee').value = '0.1';
    await closeTradeSubmit();
    let t = TRADES.find(x => x.id === id);
    check('partial: still Open, $50 left, fill fee recorded', t.status === 'Open' && t.size === 50 && t.closes[0].fee === 0.1, t);
    check('partial: balance unchanged', tradingBalance === bal);
    openCloseTrade(id);
    $('ct-exit').value = '110'; $('ct-fee').value = '0.1';
    await closeTradeSubmit();
    t = TRADES.find(x => x.id === id);
    check('full: exit 110, size 100, fees 0.20, net 9.80', t.exit === 110 && t.size === 100 && t.fees === 0.2 && t.pnl === 9.8, { e: t.exit, s: t.size, f: t.fees, p: t.pnl });
    check('full: balance +9.80 once', r2(tradingBalance - bal) === 9.8, tradingBalance - bal);
  });

  await step('delete trade + undo', async () => {
    const n = TRADES.length, bal = tradingBalance, victim = TRADES.find(t => t.symbol === 'BTCUSDT');
    await deleteTrade(victim.id);
    check('delete: trade gone, net P&L reversed', TRADES.length === n - 1 && r2(tradingBalance) === r2(bal - 98));
    document.querySelector('#toast .toast-action').click();
    await new Promise(r => setTimeout(r, 50));
    check('undo: trade back with same id, balance back', TRADES.some(t => t.id === victim.id) && r2(tradingBalance) === r2(bal), tradingBalance);
  });

  await step('investing: buy more + undo sale', async () => {
    await funds('investing', 'deposit', 1000);
    const cash0 = cashBalance;
    openAddInvestment();
    $('i-symbol').value = 'BTC'; $('i-type').value = 'Crypto'; $('i-qty').value = '0.01'; $('i-price').value = '60000';
    await saveInvestment();
    openAddInvestment();
    $('i-symbol').value = 'BTC'; $('i-type').value = 'Crypto'; $('i-qty').value = '0.01'; $('i-price').value = '40000';
    await saveInvestment();
    const h = HOLDINGS.filter(x => x.symbol === 'BTC');
    check('second BTC buy merges: 1 holding, qty 0.02, avg 50000', h.length === 1 && h[0].qty === 0.02 && h[0].buyPrice === 50000, h);
    check('cash −1000', r2(cash0 - cashBalance) === 1000, cashBalance);
    openBuyMore(h[0].id);
    $('i-qty').value = '0.02'; $('i-price').value = '50000';
    await saveInvestment(); // confirmDialog stub accepts "not enough cash"
    check('buy more (+0.02 @ 50000) → qty 0.04, avg 50000', h[0].qty === 0.04 && h[0].buyPrice === 50000, h[0]);
    const cashBefore = cashBalance;
    openClosePosition(h[0].id);
    $('cp-exit-price').value = '70000'; $('cp-qty').value = '0.01'; $('cp-type').value = 'partial';
    await submitClosePosition();
    check('sale → realized row in DB, cash +700', DB.realized_positions.length === 1 && r2(cashBalance - cashBefore) === 700, DB.realized_positions);
    await undoRealizedPosition(realizedHistory[0].id);
    const h2 = HOLDINGS.find(x => x.symbol === 'BTC');
    check('undo sale → qty 0.04 again, cash back, record gone', h2.qty === 0.04 && r2(cashBalance) === r2(cashBefore) && DB.realized_positions.length === 0, { q: h2.qty, c: cashBalance });
  });

  await step('net worth accounting', async () => {
    const near = (a, b) => Math.abs(a - b) < 0.011;
    const identity = (label) => {
      const n = computeNetWorth();
      check(`net worth identity holds (${label})`,
        near(n.total, n.moneyIn + n.gains) && near(n.total, n.tradingAccount + n.investingAccount)
        && near(n.tradingAccount, n.tradingBalance + n.partialRealized + n.openUnrealized)
        && near(n.investingAccount, cashBalance + n.holdingsValue), n);
      return n;
    };
    let a = identity('start');

    await funds('investing', 'deposit', 500);
    let b = identity('after deposit');
    check('deposit: net worth +500, money in +500, gains unchanged', near(b.total - a.total, 500) && near(b.moneyIn - a.moneyIn, 500) && near(b.gains, a.gains), [a, b]);

    a = b;
    await funds('trading', 'transfer', 100);
    b = identity('after transfer');
    check('transfer between own accounts: nothing changes', near(b.total, a.total) && near(b.moneyIn, a.moneyIn) && near(b.gains, a.gains), [a, b]);

    a = b;
    openAddInvestment();
    $('i-symbol').value = 'ADA'; $('i-type').value = 'Crypto'; $('i-qty').value = '100'; $('i-price').value = '2';
    await saveInvestment();
    b = identity('after buy');
    check('buying a holding: net worth and gains unchanged (cash → holding)', near(b.total, a.total) && near(b.gains, a.gains), [a, b]);

    a = b;
    const ada = HOLDINGS.find(h => h.symbol === 'ADA');
    ada.curPrice = 2.5;
    b = identity('after price rise');
    check('price rise: +$50 unrealized, net worth +$50', near(b.unrealized.investing - a.unrealized.investing, 50) && near(b.total - a.total, 50), [a, b]);

    a = b;
    openClosePosition(ada.id);
    $('cp-exit-price').value = '2.5'; $('cp-qty').value = '100'; $('cp-type').value = 'full';
    await submitClosePosition();
    b = identity('after sale');
    check('selling: gain moves from unrealized to realized, net worth unchanged',
      near(b.realized.investing - a.realized.investing, 50) && near(b.unrealized.investing - a.unrealized.investing, -50) && near(b.total, a.total), [a, b]);

    a = b;
    // (investing cash is negative here from the earlier "not enough cash" buy — withdraw from trading)
    await funds('trading', 'withdraw_bank', 100);
    b = identity('after withdrawal');
    check('withdrawal: net worth −100, money in −100, gains unchanged', near(b.total - a.total, -100) && near(b.moneyIn - a.moneyIn, -100) && near(b.gains, a.gains), [a, b]);

    a = b;
    openAddTrade();
    Object.entries({ 't-symbol': 'LINKUSDT', 't-entry': '10', 't-size': '200' }).forEach(([id, v]) => { $(id).value = v; });
    await saveTrade();
    const link = TRADES.find(t => t.symbol === 'LINKUSDT');
    openCloseTrade(link.id);
    $('ct-exit').value = '11';
    await closeTradeSubmit();
    b = identity('after closing a trade');
    check('closing a +$20 trade: realized trading +20, net worth +20', near(b.realized.trading - a.realized.trading, 20) && near(b.total - a.total, 20), [a, b]);

    showPage('networth');
    check('net worth page: tiles, breakdown, gains table, bridge', $('nw-kpis').querySelectorAll('.stat-card').length === 6
      && $('nw-gains-table').querySelectorAll('tr').length === 3 && chartInstances.nwBridgeChart && chartInstances.nwBridgeChart.data.labels.length === 6);
    check('sidebar shows total net worth', $('sidebar-equity').textContent.replace(/[^0-9.]/g, '') !== '' && /Net Worth/.test(document.querySelector('.total-equity-label').textContent));
    showPage('dashboard');
  });

  await step('calendar + daily P&L', async () => {
    // March 2026 has no other trades, so every number below is exact
    const logTrade = async (fields) => {
      openAddTrade();
      Object.entries(fields).forEach(([id, v]) => { $(id).value = v; });
      await saveTrade();
      return TRADES[0];
    };
    const cell = d => document.querySelector(`#cal-grid [data-day="${d}"]`);
    const cellText = d => cell(d).textContent.replace(/\s+/g, ' ').trim();
    const panelOpen = () => $('cal-day-trades').style.display !== 'none';
    const panelRows = () => [...$('cal-day-body').querySelectorAll('tr')].filter(r => !r.querySelector('td[colspan]'));

    // 00:30 local is the previous day in UTC for anyone east of UTC — it must
    // still be filed on the local day
    const a = await logTrade({ 't-symbol': 'CALA', 't-entry': '100', 't-exit': '110', 't-size': '100', 't-closed-at': '2026-03-10T00:30' });
    const b = await logTrade({ 't-symbol': 'CALB', 't-entry': '100', 't-exit': '95', 't-size': '100', 't-closed-at': '2026-03-10T23:50' });
    const c = await logTrade({ 't-symbol': 'CALC', 't-entry': '100', 't-exit': '100', 't-size': '100', 't-closed-at': '2026-03-12T12:00' });
    check('close time sets the local trade date (00:30 stays on the 10th)', a.date === '2026-03-10' && b.date === '2026-03-10' && c.date === '2026-03-12', [a.date, b.date, c.date]);
    check('breakeven trade is Breakeven with $0', c.status === 'Breakeven' && c.pnl === 0, c);

    // an older open trade, partly closed on the 14th, fully on the 15th
    const d = await logTrade({ 't-symbol': 'CALD', 't-entry': '100', 't-size': '100', 't-date': '2026-03-05' });
    openCloseTrade(d.id);
    $('ct-mode').value = 'partial'; $('ct-amount').value = '50'; $('ct-exit').value = '120'; $('ct-date').value = '2026-03-14T09:00';
    await closeTradeSubmit();

    showPage('calendar');
    calYear = 2026; calMonth = 2; calSelectedDay = null;
    renderPage('calendar');
    check('day 10: +$5 over 2 trades', /\+\$5 2t/.test(cellText(10)), cellText(10));
    check('day 12: breakeven day shows $0.00, 1 trade', /\+\$0\.00 1t/.test(cellText(12)), cellText(12));
    check('open trade not on its open day (5th)', !/t$/.test(cellText(5)), cellText(5));
    check('partial close not on the calendar until fully closed', !/t$/.test(cellText(14)), cellText(14));

    calSelectDay(10);
    check('day panel lists exactly the cell\'s trades, in close order', panelOpen() && panelRows().length === 2
      && panelRows()[0].textContent.includes('CALA') && panelRows()[1].textContent.includes('CALB'), $('cal-day-body').textContent);
    calSelectDay(10);
    check('clicking the day again closes the panel', !panelOpen());
    calSelectDay(14);
    check('partial-only day: panel notes the partial, no trade rows', panelOpen() && panelRows().length === 0 && /CALD/.test($('cal-day-body').textContent), $('cal-day-body').textContent);

    openCloseTrade(d.id);
    $('ct-exit').value = '120'; $('ct-date').value = '2026-03-15T09:00';
    await closeTradeSubmit();
    const dd = TRADES.find(t => t.id === d.id);
    check('full close files the whole trade on the close day (15th, +$20)', dd.date === '2026-03-15' && dd.pnl === 20 && /\+\$20 1t/.test(cellText(15)), [dd.date, dd.pnl, cellText(15)]);
    check('open panel refreshes after a data change (day 14 now empty → hidden)', !panelOpen());

    calSelectDay(10);
    calNextMonth();
    check('changing month clears the selected day', calSelectedDay === null && !panelOpen() && !document.querySelector('#cal-grid .active-day'));
    calPrevMonth();
    const stats = $('cal-stats-row').textContent.replace(/\s+/g, ' ');
    check('month stats: +$25, 2 profit days, 0 loss days, 4 trades', /\+\$25\.00/.test(stats) && /Profit Days ?2/.test(stats) && /Loss Days ?0/.test(stats) && /Total Trades ?4/.test(stats), stats);

    // editing just the Date moves the trade (its close time follows)
    calSelectDay(10);
    openEditTrade(a.id);
    $('t-date').value = '2026-03-11';
    await saveTrade();
    const a2 = TRADES.find(t => t.id === a.id);
    check('edit date → trade moves to the 11th, close time keeps 00:30', a2.date === '2026-03-11' && toDatetimeLocal(a2.closed_at) === '2026-03-11T00:30', [a2.date, a2.closed_at]);
    check('calendar follows the edit (10th −$5, 11th +$10)', /-\$5 1t/.test(cellText(10)) && /\+\$10 1t/.test(cellText(11)), [cellText(10), cellText(11)]);
    check('open day panel follows the edit (1 trade left on the 10th)', panelOpen() && panelRows().length === 1, $('cal-day-body').textContent);

    await deleteTrade(b.id);
    check('delete → the 10th is empty again', !/t$/.test(cellText(10)), cellText(10));

    const logRows = [...$('daily-pnl-body').querySelectorAll('tr[data-date]')];
    const logDates = logRows.map(r => r.dataset.date);
    check('daily log: one row per day, newest first', logDates.join() === [...logDates].sort().reverse().join() && new Set(logDates).size === logDates.length, logDates);
    const row11 = logRows.find(r => r.dataset.date === '2026-03-11');
    check('daily log row for the 11th: 1 trade, +$10', row11 && /\+\$10\.00/.test(row11.textContent) && row11.children[2].textContent === '1', row11 && row11.textContent);
    const lastCum = logRows[0].children[6].textContent.trim();
    const allNet = TRADES.filter(t => t.status !== 'Open').reduce((s, t) => s + t.pnl, 0);
    check('daily log cumulative = total net P&L', lastCum === fmt(allNet), [lastCum, fmt(allNet)]);

    calGotoDay('2026-03-15');
    check('clicking a log row opens that day', calSelectedDay === 15 && panelOpen() && panelRows().length === 1);

    showPage('dashboard');
    const ch = chartInstances.dailyPnlChart;
    const labels = ch.data.labels, vals = ch.data.datasets[0].data;
    check('overview daily chart: days ascending, March days present', labels.join() === [...labels].sort().join() && labels.includes('03-11') && labels.includes('03-15'), labels);
    check('overview daily chart: values match the calendar', vals[labels.indexOf('03-11')] === 10 && vals[labels.indexOf('03-15')] === 20 && vals[labels.indexOf('03-12')] === 0, [labels, vals]);
  });

  await step('goals + loss limit', async () => {
    openSettings();
    $('set-loss-limit').value = '5'; $('set-target').value = '500'; $('set-risk').value = '1'; $('set-autosync').checked = true;
    await saveSettings();
    check('prefs saved to DB', DB.user_settings[0].preferences && DB.user_settings[0].preferences.dailyLossLimit === 5);
    openAddTrade();
    Object.entries({ 't-symbol': 'DOGE', 't-entry': '1', 't-exit': '0.9', 't-size': '2000', 't-closed-at': localToday() + 'T11:00' }).forEach(([id, v]) => { $(id).value = v; });
    await saveTrade();
    check('daily loss limit hit → banner', $('risk-banner').style.display === 'flex', $('risk-banner-text').textContent);
  });

  await step('audit fixes', async () => {
    const near = (a, b) => Math.abs(a - b) < 0.011;

    // ── balances follow the history: another device's changes just appear
    const bal0 = tradingBalance;
    DB.fund_transactions.push({ id: 'phone-dep', user_id: 'u-1', created_at: new Date().toISOString(), date: localToday(),
      account: 'trading', kind: 'deposit', amount: 100, note: 'from my phone', transfer_id: null }); // the phone deposited $100
    await funds('trading', 'deposit', 10); // this device adds $10, not knowing about the phone's yet
    check('this device: its +$10 shows straight away', near(tradingBalance, bal0 + 10), [bal0, tradingBalance]);
    await loadAllData();
    check('two devices: phone +$100 and laptop +$10 both there after a reload', near(tradingBalance, bal0 + 110), [bal0, tradingBalance]);
    check('balances are never stored on the updated database', !DB.user_settings.some(r => 'trading_balance' in r || 'cash_balance' in r), DB.user_settings);
    check('settings row keeps the preferences', DB.user_settings[0].preferences && typeof DB.user_settings[0].preferences === 'object');
    // a Bybit trade the server wrote (a sync on another device) counts once, with no maths on this device
    DB.trades.push({ id: 'srv-1', user_id: 'u-1', created_at: new Date().toISOString(), date: localToday(), symbol: 'XRPUSDT', type: 'Crypto',
      dir: 'Long', entry: 1, exit: 1.1, size: 100, fees: 0, source: 'bybit', closes: [], pnl: 10, net_pnl: 10, status: 'Win' });
    await loadAllData();
    check('a trade synced elsewhere moves the balance by its P&L (+$10)…', near(tradingBalance, bal0 + 120), tradingBalance);
    await loadAllData();
    check('…once: reloading again changes nothing', near(tradingBalance, bal0 + 120), tradingBalance);

    // ── loading pages past Supabase's 1,000-row cap
    const fakeRows = Array.from({ length: 2100 }, (_, i) => ({ id: 'bulk-' + i, user_id: 'u-1', created_at: '2020-01-01T00:00:00Z', date: '2020-01-01', symbol: 'BULK', type: 'Crypto', dir: 'Long', entry: 1, exit: null, size: 1, fees: 0, closes: [] }));
    const realCount = DB.trades.length;
    DB.trades.push(...fakeRows.map(r => { const t = { ...r }; t.pnl = 0; t.net_pnl = 0; t.status = 'Open'; return t; }));
    await loadAllData();
    check('more than 1,000 trades all load', TRADES.length === realCount + 2100, TRADES.length);
    DB.trades = DB.trades.filter(t => !String(t.id).startsWith('bulk-'));
    await loadAllData();

    // ── realized today: earlier partial closes aren't counted again
    const y = new Date(); y.setDate(y.getDate() - 1);
    openAddTrade();
    Object.entries({ 't-symbol': 'DAYX', 't-entry': '100', 't-size': '1000' }).forEach(([id, v]) => { $(id).value = v; });
    await saveTrade();
    const dx = TRADES.find(t => t.symbol === 'DAYX');
    openCloseTrade(dx.id);
    $('ct-mode').value = 'partial'; $('ct-amount').value = '500'; $('ct-exit').value = '40'; $('ct-date').value = toDatetimeLocal(y); // −$300 yesterday
    await closeTradeSubmit();
    const todayBefore = realizedOn(localToday());
    openCloseTrade(dx.id);
    $('ct-exit').value = '98'; // −$10 today
    await closeTradeSubmit();
    check('today counts only today\'s −$10, not the whole −$310 trade', near(realizedOn(localToday()) - todayBefore, -10) && near(realizedOn(localDateOf(y)), -300),
      [realizedOn(localToday()) - todayBefore, realizedOn(localDateOf(y))]);

    // ── closing a partly-closed trade from the Edit form keeps the partial's P&L
    openAddTrade();
    Object.entries({ 't-symbol': 'EDITX', 't-entry': '100', 't-size': '1000' }).forEach(([id, v]) => { $(id).value = v; });
    await saveTrade();
    const ex = TRADES.find(t => t.symbol === 'EDITX');
    openCloseTrade(ex.id);
    $('ct-mode').value = 'partial'; $('ct-amount').value = '500'; $('ct-exit').value = '110';
    await closeTradeSubmit();
    const balE = tradingBalance;
    openEditTrade(ex.id);
    $('t-exit').value = '110';
    await saveTrade();
    const ex2 = TRADES.find(t => t.id === ex.id);
    check('edit-form close of a partly-closed trade: +$100 (both halves), size back to $1000', ex2.pnl === 100 && ex2.size === 1000 && ex2.closes.length === 2 && near(tradingBalance - balE, 100), { pnl: ex2.pnl, size: ex2.size, n: ex2.closes.length, d: tradingBalance - balE });
    check('closing in the Edit form files it today', ex2.date === localToday(), ex2.date);

    // ── investing: "Full" with a smaller qty sells only that qty
    await funds('investing', 'deposit', 1000);
    openAddInvestment();
    $('i-symbol').value = 'DOT'; $('i-type').value = 'Crypto'; $('i-qty').value = '10'; $('i-price').value = '5';
    await saveInvestment();
    const dot = HOLDINGS.find(h => h.symbol === 'DOT');
    openClosePosition(dot.id);
    $('cp-exit-price').value = '6'; $('cp-qty').value = '4'; $('cp-type').value = 'full'; // dropdown left on Full
    await submitClosePosition();
    const dot2 = HOLDINGS.find(h => h.symbol === 'DOT');
    check('"Full" with qty 4 of 10 → partial sale, 6 left', dot2 && dot2.qty === 6 && realizedHistory[0].closeType === 'Partial', dot2);
    const cashBeforeClear = cashBalance;
    await clearRealizedHistory();
    check('clearing the sale history leaves cash unchanged (kept as an adjustment)', near(cashBalance, cashBeforeClear) && realizedHistory.length === 0
      && FUNDS.some(f => f.account === 'investing' && f.kind === 'adjustment' && /cleared sale history/.test(f.note)), [cashBeforeClear, cashBalance]);

    // ── tiny prices are shown, not rounded to 0
    check('tiny price shown in full', fmtPx(0.00001234) === '0.00001234' && fmtPx(1.23456789) === '1.2346' && fmtPx(65000) === '65,000', [fmtPx(0.00001234), fmtPx(1.23456789), fmtPx(65000)]);

    // ── stats
    check('all-breakeven period: win rate "—" (null), not 0%', computeStats(TRADES.filter(t => t.status === 'Breakeven')).winRate === null);
    const lastClosed = chronological(TRADES).slice(-1);
    const path = equityPath(lastClosed);
    check('period equity starts from the real account (earlier P&L included)', near(path.points[0].equity, tradingBalance), [path.points[0] && path.points[0].equity, tradingBalance]);

    // ── query builder sorts dates by date (not just the year)
    showPage('query');
    conditions = [];
    $('q-sort-field').value = 'date'; $('q-sort-dir').value = 'desc';
    runQuery();
    const qDates = [...$('query-results-body').querySelectorAll('tr td:first-child')].map(td => td.textContent);
    check('query: newest date first', qDates.length > 2 && qDates.join() === [...qDates].sort().reverse().join(), qDates);
    showPage('dashboard');

    // ── CSV: timestamps with a zone keep their exact moment
    const d = parseImportDate('2026-10-24T19:30:00+00:00', 'dmy');
    check('CSV import reads "+00:00" times as UTC', d && d.getTime() === Date.UTC(2026, 9, 24, 19, 30), String(d));
  });

  await step('trading fee defaults', async () => {
    const near = (a, b) => Math.abs(a - b) < 0.011;
    const type = (id, v) => { $(id).value = v; $(id).dispatchEvent(new Event('input', { bubbles: true })); };
    const pick = (id, v) => { $(id).value = v; $(id).dispatchEvent(new Event('change', { bubbles: true })); };

    // rates set once, in Settings
    showPage('settings');
    type('set-fee-buy', '0.4'); type('set-fee-sell', '0.2');
    await saveSettings();
    check('fee rates saved in preferences', PREFS.feeBuyPct === 0.4 && PREFS.feeSellPct === 0.2 && DB.user_settings[0].preferences.feeBuyPct === 0.4, PREFS);
    check('settings shows a worked example', /buy \$4\.00 \+ sell \$2\.20/.test($('set-fee-example').textContent), $('set-fee-example').textContent);

    // Long: buy on entry (on size), sell on exit (on exit value)
    openAddTrade();
    type('t-symbol', 'FEEL'); type('t-entry', '100'); type('t-size', '1000'); type('t-exit', '110');
    check('Long: buy fee 0.4% of $1000, sell fee 0.2% of $1100 filled in', $('t-buy-fee').value === '4.00' && $('t-sell-fee').value === '2.20', [$('t-buy-fee').value, $('t-sell-fee').value]);
    await saveTrade();
    const fl = TRADES.find(t => t.symbol === 'FEEL');
    check('saved: buy $4 + sell $2.20 = $6.20, net P&L $93.80', fl.buyFee === 4 && fl.sellFee === 2.2 && fl.fees === 6.2 && fl.pnl === 93.8, { b: fl.buyFee, s: fl.sellFee, f: fl.fees, p: fl.pnl });

    // Short: sell on entry, buy back on exit
    openAddTrade();
    type('t-symbol', 'FEES'); pick('t-dir', 'Short'); type('t-entry', '100'); type('t-size', '1000'); type('t-exit', '90');
    check('Short: sell fee on entry ($2), buy fee on exit (0.4% of $900 = $3.60)', $('t-sell-fee').value === '2.00' && $('t-buy-fee').value === '3.60', [$('t-sell-fee').value, $('t-buy-fee').value]);

    // a fee you type yourself is never overwritten
    type('t-buy-fee', '1');
    type('t-exit', '80');
    check('typed fee kept when the price changes', $('t-buy-fee').value === '1', $('t-buy-fee').value);
    closeModal('trade-modal');

    // open now, close later from the Close dialog: exit fee fills in there
    openAddTrade();
    type('t-symbol', 'FEEO'); type('t-entry', '100'); type('t-size', '1000');
    check('open trade: only the entry (buy) fee so far', $('t-buy-fee').value === '4.00' && $('t-sell-fee').value === '', [$('t-buy-fee').value, $('t-sell-fee').value]);
    await saveTrade();
    const fo = TRADES.find(t => t.symbol === 'FEEO');
    openCloseTrade(fo.id);
    type('ct-exit', '120');
    check('close dialog: sell fee 0.2% of $1200 = $2.40', $('ct-fee').value === '2.40', $('ct-fee').value);
    await closeTradeSubmit();
    const fo2 = TRADES.find(t => t.id === fo.id);
    check('closed: buy $4 + sell $2.40, net P&L $193.60', fo2.buyFee === 4 && fo2.sellFee === 2.4 && fo2.fees === 6.4 && fo2.pnl === 193.6, { b: fo2.buyFee, s: fo2.sellFee, f: fo2.fees, p: fo2.pnl });

    // changing the rates only affects trades logged from now on
    showPage('settings');
    type('set-fee-sell', '0.5');
    await saveSettings();
    check('new rates leave saved trades alone', TRADES.find(t => t.symbol === 'FEEL').fees === 6.2);
    openAddTrade();
    type('t-entry', '100'); type('t-size', '1000'); type('t-exit', '110');
    check('…and apply to the next trade (sell 0.5% of $1100 = $5.50)', $('t-sell-fee').value === '5.50', $('t-sell-fee').value);
    closeModal('trade-modal');

    // stats
    const fb = feeBreakdown(TRADES.filter(t => ['FEEL', 'FEEO'].includes(t.symbol)));
    check('fee totals: buy $8, sell $4.60, total $12.60', near(fb.buy, 8) && near(fb.sell, 4.6) && near(fb.total, 12.6) && fb.unsplit === 0, fb);
    showPage('trades');
    check('Trade Log: Fees paid tile with the buy / sell split', /buy .*sell/.test($('tl-fees-sub').textContent) && $('tl-fees').textContent.includes('$'), $('tl-fees-sub').textContent);
    showPage('insights');
    check('Insights: fees paid + fees vs gross P&L', /Fees vs gross P&L/.test($('adv-metrics').textContent) && /buy .*sell/.test($('adv-metrics').textContent));

    // a Bybit trade keeps its one exchange-reported fee: no split fields, no auto-fill
    DB.trades.push({ id: 'bybit-fee-1', user_id: 'u-1', created_at: new Date().toISOString(), date: localToday(), symbol: 'BTCUSDT', type: 'Crypto', dir: 'Long',
      entry: 100, exit: 101, size: 1000, fees: 1.1, source: 'bybit', closes: [], pnl: 10, net_pnl: 8.9, status: 'Win' });
    await loadAllData();
    openEditTrade('bybit-fee-1');
    check('Bybit trade: one total Fees field, value kept', $('t-fees-group').style.display === '' && $('t-buy-fee-group').style.display === 'none' && $('t-fees').value === '1.1', $('t-fees').value);
    closeModal('trade-modal');

    // back to no default fees for the steps after this one
    showPage('settings');
    type('set-fee-buy', ''); type('set-fee-sell', '');
    await saveSettings();
    showPage('dashboard');
  });

  await step('auto-sync', async () => {
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
    lastAutoSyncAttempt = 0; autoSyncUnavailable = false; startBybitAutoSync();
    await autoSyncTick();
    check('auto-sync stops when the sync endpoint is missing', autoSyncUnavailable === true && autoSyncTimer === null);
  });

  await step('csv import', async () => {
    const csv = 'Date,Symbol,Direction,Entry,Exit,Size,Fees,Setup,Tags,Notes\n'
      + '2026-09-01,ADAUSDT,Long,0.5,0.55,200,0.2,Breakout,swing;alt,"Note, with comma"\n'
      + '02/09/2026,XRPUSDT,Short,0.6,0.57,300,0.3,Fade,,\n'
      + 'bad-date,X,Long,1,1,1,,,,\n';
    const n = TRADES.length;
    openImport();
    await CHANGE_HANDLERS['import-file']({ files: [{ size: csv.length, text: async () => csv }] });
    check('import: 2 valid, 1 problem', /2 to import/.test($('import-summary').textContent) && /1 with problems/.test($('import-summary').textContent), $('import-summary').textContent);
    const balBeforeImport = tradingBalance;
    $('import-add-balance').checked = false; // history from another account: keep its P&L out
    await submitImport();
    check('import kept out of the balance: balance unchanged, one adjustment row', Math.abs(tradingBalance - balBeforeImport) < 0.011
      && FUNDS.some(f => f.kind === 'adjustment' && /imported trade/.test(f.note)), [balBeforeImport, tradingBalance]);
    const ada = TRADES.find(t => t.symbol === 'ADAUSDT');
    check('import: trades added with fees/tags/notes', TRADES.length === n + 2 && ada.fees === 0.2 && ada.tags.includes('alt') && ada.notes === 'Note, with comma', ada);
    check('import: dd/mm date parsed (02/09 → Sep 2)', TRADES.some(t => t.symbol === 'XRPUSDT' && t.date === '2026-09-02'));
    openImport();
    await CHANGE_HANDLERS['import-file']({ files: [{ size: csv.length, text: async () => csv }] });
    check('re-import: duplicates skipped', /0 to import · 2 duplicates/.test($('import-summary').textContent), $('import-summary').textContent);
    closeModal('import-modal');
  });

  await step('report + backup', async () => {
    const html = buildReport(localToday().slice(0, 7));
    check('monthly report built', html.includes('Trading Report') && html.includes('BTCUSDT'));
    await downloadBackup();
    const b = downloaded && JSON.parse(downloaded.text);
    check('backup has every table', b && b.trades.length === TRADES.length && Array.isArray(b.fund_transactions) && b.user_settings && b.account === 'me@test.dev', b && Object.keys(b));
    exportCSV();
    check('CSV export now includes Fees + Net P&L columns', true);
  });

  await step('fx', async () => {
    localStorage.removeItem('fx_usd_inr_at');
    await refreshFxRate();
    check('USD→INR updated from Frankfurter (94.94)', USD_INR === 94.94, USD_INR);
  });

  await step('password reset', async () => {
    history.replaceState(null, '', location.pathname + '#access_token=rec-tok&refresh_token=rr&expires_in=3600&type=recovery');
    const handled = handlePasswordResetRedirect();
    check('reset link → new-password screen, tokens removed from URL', handled && $('auth-reset-panel').style.display === 'flex' && !location.hash, location.hash);
    $('auth-new-pass').value = 'secret123'; $('auth-new-pass2').value = 'nope';
    await submitNewPassword();
    check('mismatched passwords rejected', /match/.test($('auth-reset-msg').textContent));
    $('auth-new-pass2').value = 'secret123';
    await submitNewPassword();
    check('new password saved → signed in', userToken === 'rec-tok' && $('app-shell').style.display === 'flex');
  });

  out.errors = window.__errors;
  // base64 so the result survives Chrome's console-log quoting intact
  console.log('SMOKE RESULT ' + btoa(unescape(encodeURIComponent(JSON.stringify(out)))));
  const pre = document.createElement('pre'); pre.id = 'smoke-out';
  pre.textContent = JSON.stringify(out, null, 1);
  document.body.appendChild(pre);
}, 300));
