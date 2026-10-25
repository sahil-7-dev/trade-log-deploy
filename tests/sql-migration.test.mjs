// Database test: runs sql/schema.sql and the 2026-10-27 migration on a real
// Postgres (PGlite, in-process, nothing to install beyond npm install) and
// checks the opening balances make the worked-out balances equal the stored
// ones, that the update is safe to re-run, and that tiny prices are kept.
// Run: npm run test:sql
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import { fileURLToPath } from 'url';
const root = fileURLToPath(new URL('../sql/', import.meta.url));
const db = new PGlite();
const ok = (name, cond, detail) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' → ' + JSON.stringify(detail))); if (!cond) process.exitCode = 1; };

// Supabase bits the schema expects
await db.exec(`create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
  create role authenticated; create role anon;`);
await db.exec(fs.readFileSync(root + 'schema.sql', 'utf8').replace(/^create extension.*$/gim, '-- (extension skipped: gen_random_uuid is built in)'));
console.log('schema.sql ran');

// Put the database back to how it looks before the update: old flag default,
// no fee columns, 6-decimal prices
await db.exec(`alter table user_settings alter column ledger_balances set default false;
  alter table trades drop column buy_fee; alter table trades drop column sell_fee;`);

const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222';
await db.exec(`insert into auth.users values ('${A}'), ('${B}');
  insert into user_settings (user_id, trading_balance, cash_balance, ledger_balances) values ('${A}', 1000, 160, false), ('${B}', 50, 0, false);
  -- A: a closed trade (net +98), an open one, a $500 deposit; investing: $200 in, holding cost $100, a sale +$30
  insert into trades (user_id, date, symbol, type, dir, entry, exit, size, fees) values
    ('${A}', '2026-01-05', 'BTC', 'Crypto', 'Long', 100, 110, 1000, 2),
    ('${A}', '2026-02-01', 'ETH', 'Crypto', 'Long', 100, null, 500, 0);
  insert into fund_transactions (user_id, date, account, kind, amount) values
    ('${A}', '2026-03-01', 'trading', 'deposit', 500), ('${A}', '2026-03-02', 'investing', 'deposit', 200);
  insert into investments (user_id, symbol, type, buy_date, qty, buy_price) values ('${A}', 'PEPE', 'Crypto', '2025-12-20', 2, 50);
  insert into realized_positions (user_id, date, symbol, qty_sold, avg_cost, exit_price, realized_pnl, proceeds) values
    ('${A}', '2026-04-01', 'SOL', 1, 70, 100, 30, 100);
  -- B: balance fully explained by one closed trade (+50) — needs no opening row
  insert into trades (user_id, date, symbol, type, dir, entry, exit, size) values ('${B}', '2026-05-05', 'X', 'Stocks', 'Long', 100, 105, 1000);`);

const mig = fs.readFileSync(root + 'migrations/2026-10-27-precision-and-balances.sql', 'utf8');
await db.exec(mig);
console.log('migration ran');

const q = async (sql) => (await db.query(sql)).rows;
const derived = async (u) => (await q(`select
  (select coalesce(sum(amount),0) from fund_transactions where user_id='${u}' and account='trading')
   + (select coalesce(sum(net_pnl),0) from trades where user_id='${u}' and status <> 'Open') as trading,
  (select coalesce(sum(amount),0) from fund_transactions where user_id='${u}' and account='investing')
   - (select coalesce(sum(qty*buy_price),0) from investments where user_id='${u}')
   + (select coalesce(sum(realized_pnl),0) from realized_positions where user_id='${u}') as cash`))[0];

const opensA = await q(`select account, amount::float, date::text from fund_transactions where user_id='${A}' and kind='adjustment' order by account`);
ok('A: two opening rows (trading +402, investing +30)', opensA.length === 2 && opensA.find(r => r.account === 'trading').amount === 402 && opensA.find(r => r.account === 'investing').amount === 30, opensA);
ok('A: opening rows dated at the start of the history', opensA.find(r => r.account === 'trading').date === '2026-01-05' && opensA.find(r => r.account === 'investing').date === '2025-12-20', opensA);
const dA = await derived(A);
ok('A: worked-out balances = stored ones (1000 / 160)', Number(dA.trading) === 1000 && Number(dA.cash) === 160, dA);
const opensB = await q(`select * from fund_transactions where user_id='${B}'`);
ok('B: nothing to carry over → no rows', opensB.length === 0, opensB);
ok('every user switched over', (await q(`select count(*)::int n from user_settings where not ledger_balances`))[0].n === 0);
ok('new rows default to the history', (await q(`select column_default from information_schema.columns where table_name='user_settings' and column_name='ledger_balances'`))[0].column_default === 'true');
ok('fee columns added', (await q(`select count(*)::int n from information_schema.columns where table_name='trades' and column_name in ('buy_fee','sell_fee')`))[0].n === 2);
const t = await q(`select pnl::float, net_pnl::float, status from trades where symbol='BTC'`);
ok('generated columns rebuilt (pnl 100, net 98, Win)', t[0].pnl === 100 && t[0].net_pnl === 98 && t[0].status === 'Win', t);
await db.exec(`insert into investments (user_id, symbol, type, buy_date, qty, buy_price) values ('${A}', 'TINY', 'Crypto', '2026-06-01', 1, 0.00000123)`);
ok('tiny prices kept exactly', (await q(`select buy_price::text p from investments where symbol='TINY'`))[0].p === '0.000001230000', await q(`select buy_price::text p from investments where symbol='TINY'`));

await db.exec(mig); // safe to re-run
ok('re-running adds nothing', (await q(`select count(*)::int n from fund_transactions where kind='adjustment'`))[0].n === 2);

console.log(process.exitCode ? '\nDATABASE TESTS FAILED' : '\nALL DATABASE TESTS PASSED');
