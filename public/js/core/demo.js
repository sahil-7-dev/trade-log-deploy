// ═══════════════════════════════════════════════════════════════════════════
// Demo mode: the fixed sample data shown to visitors who aren't signed in.
// ═══════════════════════════════════════════════════════════════════════════

// ─── DEMO MODE ────────────────────────────────────────────────────────────────
// First-time visitors with no saved session land in a fully-populated,
// read-only demo instead of a bare sign-in wall — they can click around real
// UI with real (fixed, fictional) data before ever creating an account.
// Every mutating action is gated behind demoGuard() further down.
let isDemoMode = false;

const DEMO_PROFILE_NAME = 'demo_trader';

// Raw inputs only — pnl/rr/status are derived by buildDemoTrades() using the
// exact same formulas the real app (and Postgres) use, so the numbers are
// always internally consistent, never hand-typed and possibly wrong.
const DEMO_RAW_TRADES = [
  { date: '2026-01-06', symbol: 'BTC',     type: 'Crypto', dir: 'Long',  entry: 42500,  exit: 44200,  size: 800, sl: 41200,  tp: 46000,  notes: 'Breakout above range high, held through a small pullback.' },
  { date: '2026-01-14', symbol: 'EURUSD',  type: 'Forex',  dir: 'Short', entry: 1.0950, exit: 1.0870, size: 1000, sl: 1.1010, tp: 1.0800, notes: 'Faded the post-NFP spike.' },
  { date: '2026-01-22', symbol: 'AAPL',    type: 'Stocks', dir: 'Long',  entry: 192.40, exit: 188.10, size: 600, sl: 187.00, tp: 200.00, notes: 'Earnings gap didn\'t hold, stopped out early.' },
  { date: '2026-02-03', symbol: 'ETH',     type: 'Crypto', dir: 'Long',  entry: 2380,   exit: 2510,   size: 700, sl: 2290,  tp: 2600 },
  { date: '2026-02-11', symbol: 'GBPUSD',  type: 'Forex',  dir: 'Long',  entry: 1.2650, exit: 1.2590, size: 900, sl: 1.2580, tp: 1.2780 },
  { date: '2026-02-19', symbol: 'SOL',     type: 'Crypto', dir: 'Short', entry: 118.5,  exit: 109.2,  size: 500, sl: 123.0,  tp: 105.0 },
  { date: '2026-03-02', symbol: 'NVDA',    type: 'Stocks', dir: 'Long',  entry: 725,    exit: 780,    size: 900, sl: 700,   tp: 800 },
  { date: '2026-03-10', symbol: 'USDJPY',  type: 'Forex',  dir: 'Short', entry: 149.80, exit: 150.60, size: 700, sl: 150.50, tp: 148.00, notes: 'Stopped out — BOJ comments reversed the move.' },
  { date: '2026-03-21', symbol: 'BTC',     type: 'Crypto', dir: 'Short', entry: 68200,  exit: 66500,  size: 1000, sl: 69500, tp: 64000 },
  { date: '2026-04-02', symbol: 'SPY',     type: 'Stocks', dir: 'Long',  entry: 512,    exit: 508,    size: 600, sl: 505,   tp: 525 },
  { date: '2026-04-15', symbol: 'ETH',     type: 'Crypto', dir: 'Long',  entry: 3150,   exit: 3340,   size: 800, sl: 3020,  tp: 3400 },
  { date: '2026-04-27', symbol: 'EURUSD',  type: 'Forex',  dir: 'Long',  entry: 1.0780, exit: 1.0850, size: 900, sl: 1.0730, tp: 1.0900 },
  { date: '2026-05-08', symbol: 'TSLA',    type: 'Stocks', dir: 'Short', entry: 245,    exit: 258,    size: 700, sl: 255,   tp: 220, notes: 'Squeeze on a short-covering rally — cut it a bit late.' },
  { date: '2026-05-19', symbol: 'SOL',     type: 'Crypto', dir: 'Long',  entry: 142,    exit: 156,    size: 600, sl: 135,   tp: 165 },
  { date: '2026-06-03', symbol: 'GBPUSD',  type: 'Forex',  dir: 'Short', entry: 1.2720, exit: 1.2650, size: 800, sl: 1.2780, tp: 1.2580 },
  { date: '2026-06-14', symbol: 'BTC',     type: 'Crypto', dir: 'Long',  entry: 71000,  exit: null,   size: 900, sl: 69000, tp: 76000, notes: 'Took half off into resistance, riding the rest.', partial: { date: '2026-06-20', exit: 73500, size: 450 } },
  { date: '2026-06-25', symbol: 'AAPL',    type: 'Stocks', dir: 'Long',  entry: 198.5,  exit: null,   size: 700, sl: 194.0, tp: 210.0 },
  { date: '2026-07-02', symbol: 'ETH',     type: 'Crypto', dir: 'Short', entry: 3480,   exit: 3540,   size: 750, sl: 3550,  tp: 3300 },
];

const DEMO_EMOTIONS_WIN = ['Calm', 'Confident', 'Calm', 'Patient'];
const DEMO_EMOTIONS_LOSS = ['FOMO', 'Impatient', 'Revenge', 'Fearful'];
const DEMO_MISTAKES = [['Moved stop loss'], ['Late exit'], ['Chased entry'], ['Oversized'], ['No plan']];

function buildDemoTrades() {
  return DEMO_RAW_TRADES.map(({ partial, ...t }, i) => {
    const gross = t.exit != null
      ? parseFloat(((t.dir === 'Long' ? (t.exit - t.entry) / t.entry : (t.entry - t.exit) / t.entry) * t.size).toFixed(2))
      : 0;
    // 0.055% taker fee each way, like a typical exchange (the demo's fee rates):
    // on the size at entry, on the exit value at exit
    const entryFee = parseFloat((t.size * 0.00055).toFixed(2));
    const exitFee = t.exit != null ? parseFloat((t.size * t.exit / t.entry * 0.00055).toFixed(2)) : 0;
    const fees = parseFloat((entryFee + exitFee).toFixed(2));
    const buyFee = t.dir === 'Long' ? entryFee : exitFee, sellFee = t.dir === 'Long' ? exitFee : entryFee;
    const pnl = parseFloat((gross - fees).toFixed(2)); // net, same as the net_pnl column
    const risk = (t.exit != null && t.sl != null) ? Math.abs(t.entry - t.sl) / t.entry * t.size : 0;
    const rr = (t.exit != null && risk > 0) ? parseFloat((pnl / risk).toFixed(4)) : null;
    const status = t.exit == null ? 'Open'
      : pnl === 0 ? 'Breakeven' // same rule as the database: net P&L rounds to $0.00
      : pnl > 0 ? 'Win' : 'Loss';
    // Plausible journaling + timing so the analytics pages have something to show
    const holdHours = 2 + (i * 7) % 46;
    const closedAt = new Date(`${t.date}T${String(9 + (i * 5) % 12).padStart(2, '0')}:${String((i * 13) % 60).padStart(2, '0')}:00`);
    const openedAt = new Date(closedAt.getTime() - holdHours * 3600e3);
    const won = status === 'Win';
    const trade = {
      id: `demo-trade-${i}`, user_id: 'demo', pnl, grossPnl: gross, fees, buyFee, sellFee, rr, status,
      closes: [], original_size: null, realized_exit_value: 0, source: 'manual',
      opened_at: openedAt.toISOString(), closed_at: t.exit != null ? closedAt.toISOString() : null,
      setup: ['Breakout', 'Pullback', 'Range fade', 'Trend follow'][i % 4],
      emotion: (won ? DEMO_EMOTIONS_WIN : DEMO_EMOTIONS_LOSS)[i % 4],
      followed_plan: won ? i % 5 !== 0 : i % 3 === 0,
      mistakes: won || t.exit == null ? [] : DEMO_MISTAKES[i % DEMO_MISTAKES.length],
      tags: [i % 2 ? 'swing' : 'scalp'],
      ...t
    };
    if (partial) {
      // Partly closed, still Open — same shape closeTradeSubmit() produces
      trade.original_size = t.size;
      trade.size = t.size - partial.size;
      trade.realized_exit_value = parseFloat((partial.size * partial.exit / t.entry).toFixed(2));
      trade.closes = [{ id: `demo-fill-${i}`, ...partial, pnl: fillPnl(t.dir, t.entry, partial.exit, partial.size), fee: 0.25 }];
      trade.fees = parseFloat((trade.fees + 0.25).toFixed(2));
      if (t.dir === 'Long') trade.sellFee = parseFloat((trade.sellFee + 0.25).toFixed(2)); else trade.buyFee = parseFloat((trade.buyFee + 0.25).toFixed(2));
    }
    return trade;
  });
}

const DEMO_FUNDS = [
  { date: '2026-01-02', account: 'trading',   kind: 'deposit',          amount: 1000,  note: 'Initial deposit' },
  { date: '2026-04-30', account: 'trading',   kind: 'withdraw_bank',    amount: -150,  note: 'Took profits to HDFC' },
  { date: '2026-05-15', account: 'trading',   kind: 'transfer_out',     amount: -100,  note: 'To investing', transfer_id: 'demo-xfer-1' },
  { date: '2026-05-15', account: 'investing', kind: 'transfer_in',      amount: 100,   note: 'From trading', transfer_id: 'demo-xfer-1' },
  { date: '2025-11-01', account: 'investing', kind: 'deposit',          amount: 2500,  note: 'Savings' },
  { date: '2026-02-14', account: 'investing', kind: 'withdraw_removed', amount: -50,   note: 'Gift' },
].map((f, i) => ({ id: `demo-fund-${i}`, user_id: 'demo', created_at: `${f.date}T12:00:00Z`, transfer_id: null, ...f }));

// ~90 days of gently drifting portfolio value ending at today's demo value
function buildDemoSnapshots(holdings, cash) {
  const value = holdings.reduce((s, h) => s + h.qty * h.curPrice, 0);
  const cost = holdings.reduce((s, h) => s + h.qty * h.buyPrice, 0);
  const out = [];
  for (let d = 89; d >= 0; d--) {
    const day = new Date(Date.now() - d * 86400e3);
    const drift = 1 - d * 0.0021 + Math.sin(d / 6) * 0.025;
    out.push({ date: localDateOf(day), holdings_value: parseFloat((value * drift).toFixed(2)), cost_basis: parseFloat(cost.toFixed(2)), cash });
  }
  return out;
}

const DEMO_RAW_HOLDINGS = [
  { symbol: 'BTC',  type: 'Crypto', qty: 0.15, buyPrice: 45000,  curPrice: 68500 },
  { symbol: 'ETH',  type: 'Crypto', qty: 2.2,  buyPrice: 2200,   curPrice: 3450 },
  { symbol: 'AAPL', type: 'Stocks', qty: 12,   buyPrice: 178.50, curPrice: 195.20 },
  { symbol: 'SOL',  type: 'Crypto', qty: 25,   buyPrice: 95.00,  curPrice: 138.00 },
  { symbol: 'NVDA', type: 'Stocks', qty: 4,    buyPrice: 620.00, curPrice: 745.00 },
];

function buildDemoHoldings() {
  return DEMO_RAW_HOLDINGS.map((h, i) => ({
    id: `demo-holding-${i}`, user_id: 'demo', buy_date: '2025-11-01',
    color: assetColor(h.symbol), livePrice: false, ...h
  }));
}

const DEMO_CASH_BALANCE = 850.00;
const DEMO_REALIZED_HISTORY = [
  { id: 'demo-realized-0', date: '2026-03-15', symbol: 'DOGE', type: 'Crypto', qtySold: 500, avgCost: 0.08, exitPrice: 0.14, realizedPnl: 30.00, proceeds: 70.00, closeType: 'Full', buyDate: '2025-12-01' }
];
const DEMO_PREFS = { monthlyTarget: 300, dailyLossLimit: 100, riskPct: 1, autoSync: false, feeBuyPct: 0.055, feeSellPct: 0.055 };
let lastPriceUpdate = null;

