// Bybit sync engine tests: simulates Bybit + Supabase in memory and runs
// syncBybitPositions through open → partial close → full close, scale-ins,
// orphaned rows, re-syncs and timezone dates. Run: npm test
const assert = require('assert');
process.env.BYBIT_API_KEY = 'k';
process.env.BYBIT_API_SECRET = 's';
const path = require('path');
const { syncBybitPositions } = require(process.argv[2] || path.join(__dirname, '..', 'api', '_bybit-shared.js'));

let bybit = { open: [], closed: [] };
global.fetch = async (url) => {
  const list = url.includes('/position/list') ? bybit.open
    : [...bybit.closed].sort((a, b) => b.updatedTime - a.updatedTime); // Bybit: newest first
  return { ok: true, json: async () => ({ retCode: 0, result: { list } }) };
};

let rows = [], nextId = 1;
const pnl = r => r.exit == null ? 0 : (r.dir === 'Long' ? (r.exit - r.entry) : (r.entry - r.exit)) / r.entry * r.size;
function parse(path) {
  const q = new URLSearchParams(path.split('?')[1]);
  return Object.fromEntries([...q].filter(([k]) => k !== 'select' && k !== 'on_conflict'));
}
function match(row, filters) {
  return Object.entries(filters).every(([k, v]) => {
    if (v.startsWith('eq.')) return String(row[k]) === v.slice(3);
    if (v.startsWith('like.')) {
      const re = new RegExp('^' + v.slice(5).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      return row[k] != null && re.test(row[k]);
    }
    throw new Error('unsupported filter ' + v);
  });
}
async function dbFetch(method, path, body) {
  const f = parse(path);
  if (method === 'GET') return rows.filter(r => match(r, f)).map(r => ({ ...r }));
  if (method === 'PATCH') { rows.filter(r => match(r, f)).forEach(r => Object.assign(r, body)); return []; }
  if (method === 'POST') {
    for (const b of body) {
      const dup = rows.find(r => r.user_id === b.user_id && r.external_id === b.external_id);
      if (dup) Object.assign(dup, b);
      else rows.push({ id: String(nextId++), created_at: new Date(Date.now()).toISOString(), notes: null, closes: [], ...b });
    }
    return null;
  }
}
const sync = (tz = 0) => syncBybitPositions(dbFetch, 'u1', { tzOffsetMinutes: tz });
const reset = () => { rows = []; bybit = { open: [], closed: [] }; };
const t0 = Date.parse('2026-10-20T10:00:00Z');

(async () => {
  // 1. Open, then fully close: must update the SAME row (old code left it stuck as Open)
  reset();
  bybit.open = [{ symbol: 'BTCUSDT', side: 'Buy', positionIdx: 0, size: '0.1', avgPrice: '60000', positionValue: '6000', createdTime: String(t0) }];
  await sync();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].exit, null);
  rows[0].notes = 'my breakout setup';
  bybit.open = [];
  bybit.closed = [{ orderId: 'o1', symbol: 'BTCUSDT', side: 'Sell', positionIdx: 0, avgEntryPrice: '60000', avgExitPrice: '61000', cumEntryValue: '6000', cumExitValue: '6100', closedPnl: '95.5', updatedTime: String(t0 + 3600e3) }];
  let r = await sync();
  assert.strictEqual(rows.length, 1, 'close must merge into the open row, not add a second one');
  assert.strictEqual(rows[0].exit, 61000);
  assert.strictEqual(rows[0].external_id, 'bybit-closed:o1');
  assert.ok(rows[0].notes.startsWith('my breakout setup\n'), 'user notes kept');
  assert.strictEqual(Math.round(pnl(rows[0])), 100);
  await sync(); // re-sync is a no-op
  assert.strictEqual(rows.length, 1);
  console.log('✓ open → close merges into one row, keeps notes, idempotent');

  // 2. Short position, partial + final close arriving in the same sync
  reset();
  bybit.open = [{ symbol: 'ETHUSDT', side: 'Sell', positionIdx: 0, size: '1', avgPrice: '3000', positionValue: '3000', createdTime: String(t0) }];
  await sync();
  bybit.open = [];
  bybit.closed = [
    { orderId: 'p1', symbol: 'ETHUSDT', side: 'Buy', positionIdx: 0, avgEntryPrice: '3000', avgExitPrice: '2900', cumEntryValue: '1200', cumExitValue: '1160', closedPnl: '39', updatedTime: String(t0 + 1000) },
    { orderId: 'p2', symbol: 'ETHUSDT', side: 'Buy', positionIdx: 0, avgEntryPrice: '3000', avgExitPrice: '2800', cumEntryValue: '1800', cumExitValue: '1680', closedPnl: '118', updatedTime: Date.parse('2026-10-22T10:00:00Z') },
  ];
  await sync();
  const eth = rows.filter(x => x.symbol === 'ETHUSDT');
  assert.strictEqual(eth.length, 1);
  assert.strictEqual(eth[0].size, 3000);
  assert.strictEqual(eth[0].date, '2026-10-22', 'merged trade dated by the final close');
  assert.strictEqual(Math.round(pnl(eth[0])), 160); // (3000-2840)/3000*3000
  console.log('✓ short with partial + final close in one sync → one merged trade, correct P&L/date');

  // 3. Scale-in while open is tracked, then close
  reset();
  bybit.open = [{ symbol: 'SOLUSDT', side: 'Buy', positionIdx: 0, size: '10', avgPrice: '100', positionValue: '1000', createdTime: String(t0) }];
  await sync();
  bybit.open = [{ symbol: 'SOLUSDT', side: 'Buy', positionIdx: 0, size: '20', avgPrice: '110', positionValue: '2200', createdTime: String(t0) }];
  await sync();
  assert.strictEqual(rows[0].entry, 110);
  assert.strictEqual(rows[0].size, 2200);
  assert.strictEqual(rows[0].original_size, 2200);
  console.log('✓ scale-in updates entry/size of the tracked row');

  // 4. Orphan left behind by the old bug (stuck Open + separate closed copy)
  reset();
  rows.push({ id: '90', user_id: 'u1', created_at: '2026-09-01T00:00:00Z', symbol: 'BTCUSDT', dir: 'Long', entry: 50000, exit: null, size: 500, source: 'bybit', external_id: 'bybit-open:BTCUSDT:Buy:0', notes: null });
  rows.push({ id: '91', user_id: 'u1', created_at: '2026-09-02T00:00:00Z', symbol: 'BTCUSDT', dir: 'Long', entry: 50000, exit: 52000, size: 500, source: 'bybit', external_id: 'bybit-closed:old', notes: null });
  nextId = 100;
  await sync();
  assert.strictEqual(rows.find(x => x.id === '90').external_id, 'bybit-stale:90');
  assert.ok(rows.find(x => x.id === '90').notes.includes('No longer open on Bybit'));
  console.log('✓ stale orphan row gets its open key retired and flagged');

  // 5. Orphan sharing a key with a NEW open position → retire orphan, track new one
  reset();
  rows.push({ id: '90', user_id: 'u1', created_at: '2026-09-01T00:00:00Z', symbol: 'BTCUSDT', dir: 'Long', entry: 50000, exit: null, size: 500, source: 'bybit', external_id: 'bybit-open:BTCUSDT:Buy:0', notes: null });
  nextId = 100;
  bybit.open = [{ symbol: 'BTCUSDT', side: 'Buy', positionIdx: 0, size: '0.1', avgPrice: '65000', positionValue: '6500', createdTime: String(t0) }];
  await sync();
  assert.strictEqual(rows.find(x => x.id === '90').external_id, 'bybit-stale:90');
  const fresh = rows.find(x => x.external_id === 'bybit-open:BTCUSDT:Buy:0');
  assert.ok(fresh && fresh.entry === 65000);
  console.log('✓ orphan sharing a key with a new position is retired; new position tracked');

  // 6. Orphan + new position opened AND closed between syncs → must not merge into orphan
  reset();
  rows.push({ id: '90', user_id: 'u1', created_at: '2026-09-01T00:00:00Z', symbol: 'BTCUSDT', dir: 'Long', entry: 50000, exit: null, size: 500, source: 'bybit', external_id: 'bybit-open:BTCUSDT:Buy:0', notes: null });
  nextId = 100;
  bybit.closed = [{ orderId: 'n1', symbol: 'BTCUSDT', side: 'Sell', positionIdx: 0, avgEntryPrice: '65000', avgExitPrice: '66000', cumEntryValue: '6500', cumExitValue: '6600', closedPnl: '99', updatedTime: String(t0) }];
  await sync();
  assert.strictEqual(rows.find(x => x.id === '90').exit, null, 'orphan untouched by unrelated close');
  assert.ok(rows.find(x => x.external_id === 'bybit-closed:n1' && x.entry === 65000));
  console.log('✓ unrelated close is not merged into an orphan with a different entry');

  // 7. Timezone: close at 01:00 IST (19:30 UTC previous day)
  reset();
  bybit.closed = [{ orderId: 'z1', symbol: 'XRPUSDT', side: 'Sell', positionIdx: 0, avgEntryPrice: '1', avgExitPrice: '1.1', cumEntryValue: '100', cumExitValue: '110', closedPnl: '9', updatedTime: String(Date.parse('2026-10-20T19:30:00Z')) }];
  await sync(330);
  assert.strictEqual(rows[0].date, '2026-10-21');
  console.log('✓ IST close after midnight is dated on the local day');

  // 8. YOUR CASE: $100 Long, close $50 → same trade, still Open, survives re-syncs
  reset();
  const pos = (size, pv) => [{ symbol: 'BTCUSDT', side: 'Buy', positionIdx: 0, size, avgPrice: '100', positionValue: pv, createdTime: String(t0) }];
  bybit.open = pos('1', '100');
  await sync();
  bybit.open = pos('0.5', '50');
  bybit.closed = [{ orderId: 'h1', symbol: 'BTCUSDT', side: 'Sell', positionIdx: 0, avgEntryPrice: '100', avgExitPrice: '110', cumEntryValue: '50', cumExitValue: '55', closedPnl: '4.9', updatedTime: String(t0 + 1000) }];
  for (let i = 0; i < 3; i++) await sync();
  assert.strictEqual(rows.length, 1, 'still one trade');
  assert.strictEqual(rows[0].exit, null, 'still Open → stays out of stats');
  assert.strictEqual(rows[0].size, 50);
  assert.strictEqual(rows[0].original_size, 100);
  assert.strictEqual(rows[0].closes.length, 1);
  assert.strictEqual(rows[0].closes[0].pnl, 5);
  console.log('✓ $100 position, $50 closed → one Open trade, $50 remaining, survives 3 re-syncs');

  // 9. ...then close the remaining $50 → the main trade is updated as a whole
  bybit.open = [];
  bybit.closed.push({ orderId: 'h2', symbol: 'BTCUSDT', side: 'Sell', positionIdx: 0, avgEntryPrice: '100', avgExitPrice: '90', cumEntryValue: '50', cumExitValue: '45', closedPnl: '-5.1', updatedTime: String(t0 + 2000) });
  await sync(); await sync();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].size, 100, 'full original size');
  assert.strictEqual(rows[0].exit, 100, 'averaged exit: half @110, half @90');
  assert.ok(Math.abs(pnl(rows[0])) < 0.005, 'nets to $0 → breakeven');
  assert.strictEqual(rows[0].closes.length, 2);
  console.log('✓ final close updates the main trade: size $100, avg exit 100, P&L $0 (breakeven)');

  // 10. Partial close happened BEFORE the first sync, position still open
  reset();
  bybit.open = [{ symbol: 'ETHUSDT', side: 'Buy', positionIdx: 0, size: '0.6', avgPrice: '2000', positionValue: '1200', createdTime: String(t0) }];
  bybit.closed = [{ orderId: 'q1', symbol: 'ETHUSDT', side: 'Sell', positionIdx: 0, avgEntryPrice: '2000', avgExitPrice: '2100', cumEntryValue: '800', cumExitValue: '840', closedPnl: '39', updatedTime: String(t0 + 1000) }];
  await sync(); await sync();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].original_size, 2000);
  assert.strictEqual(rows[0].size, 1200);
  assert.strictEqual(rows[0].exit, null);
  console.log('✓ partial close before first sync → one Open trade ($2000 original, $1200 left)');

  // 11. Opened, partially closed and fully closed all between two syncs
  reset();
  bybit.closed = [
    { orderId: 'r1', symbol: 'SOLUSDT', side: 'Buy', positionIdx: 0, avgEntryPrice: '150', avgExitPrice: '140', cumEntryValue: '300', cumExitValue: '280', closedPnl: '19', updatedTime: String(t0 + 1000) },
    { orderId: 'r2', symbol: 'SOLUSDT', side: 'Buy', positionIdx: 0, avgEntryPrice: '150', avgExitPrice: '130', cumEntryValue: '300', cumExitValue: '260', closedPnl: '39', updatedTime: String(t0 + 2000) },
  ];
  await sync(); await sync();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].dir, 'Short');
  assert.strictEqual(rows[0].size, 600);
  assert.strictEqual(rows[0].exit, 135);
  assert.strictEqual(Math.round(pnl(rows[0])), 60);
  console.log('✓ open + partial + final between syncs → merged into one closed trade');

  console.log('\nALL BYBIT SYNC TESTS PASSED');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
