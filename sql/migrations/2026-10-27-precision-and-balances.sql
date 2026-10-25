-- ============================================
-- TradeLog — migration: keep tiny prices exactly, work balances out from
-- the history (carrying today's balances over unchanged), and record buy /
-- sell fees separately.
--
-- Prices were stored with 6 decimals, so a meme coin bought at 0.00000123
-- was saved as 0.000001 — its cost basis and P&L came back wrong after a
-- reload. Prices now keep 12 decimals (up to 18 digits before the point).
--
-- Run in: Supabase Dashboard → SQL Editor, AFTER 2026-10-26-features.sql,
-- Runs as one transaction: all of it applies, or none of it.
-- Safe to re-run. Nothing is lost: the generated columns (pnl, net_pnl,
-- status) are recomputed from entry/exit/size/fees.
-- ============================================

begin;

-- A column used by a generated column can't change type, so the generated
-- columns are dropped first and re-added with the same definitions.
drop index if exists idx_trades_status;
drop index if exists idx_trades_pnl;
alter table trades drop column if exists status;
alter table trades drop column if exists net_pnl;
alter table trades drop column if exists pnl;

alter table trades
  alter column entry type numeric(30,12),
  alter column exit  type numeric(30,12),
  alter column sl    type numeric(30,12),
  alter column tp    type numeric(30,12);

alter table trades add column pnl numeric(18,2) generated always as (
  case when exit is null then 0
       when dir = 'Long' then (exit - entry) / entry * size
       else                   (entry - exit) / entry * size
  end
) stored;
alter table trades add column net_pnl numeric(18,2) generated always as (
  case when exit is null then 0
       when dir = 'Long' then (exit - entry) / entry * size - fees
       else                   (entry - exit) / entry * size - fees
  end
) stored;
alter table trades add column status text generated always as (
  case when exit is null then 'Open'
       when round((case when dir = 'Long' then exit - entry else entry - exit end) / entry * size - fees, 2) = 0 then 'Breakeven'
       when       (case when dir = 'Long' then exit - entry else entry - exit end) / entry * size - fees > 0 then 'Win'
       else 'Loss'
  end
) stored;
create index idx_trades_status on trades(status);
create index idx_trades_pnl    on trades(pnl);

alter table investments
  alter column buy_price type numeric(30,12),
  alter column cur_price type numeric(30,12);

alter table realized_positions
  alter column avg_cost   type numeric(30,12),
  alter column exit_price type numeric(30,12);


-- ─── Balances worked out from the history ──────────────────────────────────
-- The app now calculates both balances from your history instead of storing
-- and nudging them:
--   trading = trading funds movements + net P&L of fully closed trades
--   cash    = investing funds movements − holdings' cost + realized sale gains
-- Whatever each stored balance holds that the history doesn't explain (money
-- from before the funds history existed, corrections) becomes one visible
-- "Opening balance" adjustment, dated at the start of your history — so both
-- balances read exactly what they read before. Done once per user.
alter table user_settings add column if not exists ledger_balances boolean not null default false;

insert into fund_transactions (user_id, date, account, kind, amount, note)
select s.user_id,
       coalesce(least((select min(t.date) from trades t where t.user_id = s.user_id),
                      (select min(f.date) from fund_transactions f where f.user_id = s.user_id)), current_date),
       'trading', 'adjustment', x.diff,
       'Opening balance (carried over from before the funds history)'
from user_settings s
cross join lateral (select round(s.trading_balance
    - coalesce((select sum(f.amount) from fund_transactions f where f.user_id = s.user_id and f.account = 'trading'), 0)
    - coalesce((select sum(t.net_pnl) from trades t where t.user_id = s.user_id and t.status <> 'Open'), 0), 2) as diff) x
where not s.ledger_balances and x.diff <> 0;

insert into fund_transactions (user_id, date, account, kind, amount, note)
select s.user_id,
       coalesce(least((select min(i.buy_date) from investments i where i.user_id = s.user_id),
                      (select min(r.date) from realized_positions r where r.user_id = s.user_id),
                      (select min(f.date) from fund_transactions f where f.user_id = s.user_id)), current_date),
       'investing', 'adjustment', x.diff,
       'Opening balance (carried over from before the funds history)'
from user_settings s
cross join lateral (select round(s.cash_balance
    - coalesce((select sum(f.amount) from fund_transactions f where f.user_id = s.user_id and f.account = 'investing'), 0)
    + coalesce((select sum(i.qty * i.buy_price) from investments i where i.user_id = s.user_id), 0)
    - coalesce((select sum(r.realized_pnl) from realized_positions r where r.user_id = s.user_id), 0), 2) as diff) x
where not s.ledger_balances and x.diff <> 0;

update user_settings set ledger_balances = true where not ledger_balances;
-- accounts created from now on start on the history straight away
alter table user_settings alter column ledger_balances set default true;

-- ─── Trading fees split into buy and sell ───────────────────────────────────
-- fees stays the total (net P&L uses it); these record how much of it was
-- the buy side and the sell side. Empty for older trades and Bybit trades
-- (Bybit reports one combined fee).
alter table trades add column if not exists buy_fee  numeric(18,2);
alter table trades add column if not exists sell_fee numeric(18,2);

commit;

-- Make the REST API pick up the changed columns right away
notify pgrst, 'reload schema';
