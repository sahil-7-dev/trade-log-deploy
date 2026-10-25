-- ============================================
-- TradeLog — migration: funds ledger, fees, realized positions table,
-- preferences (goals / risk / auto-sync), trade journaling fields,
-- portfolio snapshots, synced profile photo.
--
-- Run ONCE in: Supabase Dashboard → SQL Editor, AFTER
-- 2026-10-25-partial-closes.sql and BEFORE deploying the app version that
-- uses it. Safe to re-run.
-- ============================================

-- ─── 1. Trades: fees, net P&L, timestamps, journaling ───────────────────────
alter table trades add column if not exists fees          numeric(18,2) not null default 0;
alter table trades add column if not exists opened_at     timestamptz;
alter table trades add column if not exists closed_at     timestamptz;
alter table trades add column if not exists mistakes      text[];
alter table trades add column if not exists emotion       text;
alter table trades add column if not exists followed_plan boolean;

-- net_pnl = gross P&L minus fees. Win / Loss / Breakeven now follow NET P&L:
-- a trade whose price move is +$0.40 but paid $0.60 in fees lost money.
-- Generated columns can't be altered in place — drop and re-add (values are
-- recomputed from entry/exit/size/fees; nothing is lost).
drop index if exists idx_trades_status;
alter table trades drop column if exists status;
alter table trades drop column if exists net_pnl;
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

-- ─── 2. Funds ledger: deposits, withdrawals, adjustments, transfers ─────────
-- amount is signed: + adds to the account's balance, − takes from it.
-- A transfer is two rows (transfer_out on one account, transfer_in on the
-- other) sharing one transfer_id, so they're deleted/undone together.
create table if not exists fund_transactions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at   timestamptz default now(),
  date         date not null,
  account      text not null check (account in ('trading','investing')),
  kind         text not null check (kind in ('deposit','withdraw_bank','withdraw_removed','adjustment','transfer_in','transfer_out')),
  amount       numeric(18,2) not null,
  transfer_id  uuid,
  note         text
);
create index if not exists idx_funds_user on fund_transactions(user_id, date desc);
alter table fund_transactions enable row level security;
drop policy if exists "Users manage own fund transactions" on fund_transactions;
create policy "Users manage own fund transactions"
  on fund_transactions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─── 3. Realized (closed) investment positions — was a JSON list on
--        user_settings; a real table makes "undo this close" possible ───────
create table if not exists realized_positions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at    timestamptz default now(),
  date          date not null,
  symbol        text not null,
  type          text,
  qty_sold      numeric(18,8) not null,
  avg_cost      numeric(18,6) not null,
  exit_price    numeric(18,6) not null,
  realized_pnl  numeric(18,2) not null,
  proceeds      numeric(18,2) not null,
  close_type    text not null default 'Full' check (close_type in ('Full','Partial')),
  buy_date      date
);
create index if not exists idx_realized_user on realized_positions(user_id, date desc);
alter table realized_positions enable row level security;
drop policy if exists "Users manage own realized positions" on realized_positions;
create policy "Users manage own realized positions"
  on realized_positions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Copy each user's existing history across — once (skipped for any user who
-- already has rows here, so re-running never duplicates).
insert into realized_positions (user_id, date, symbol, type, qty_sold, avg_cost, exit_price, realized_pnl, proceeds, close_type)
select s.user_id,
       coalesce(nullif(e->>'date', '')::date, current_date),
       coalesce(e->>'symbol', '?'),
       e->>'type',
       coalesce((e->>'qtySold')::numeric, 0),
       coalesce((e->>'avgCost')::numeric, 0),
       coalesce((e->>'exitPrice')::numeric, 0),
       coalesce((e->>'realizedPnl')::numeric, 0),
       coalesce((e->>'proceeds')::numeric, 0),
       case when e->>'closeType' = 'Partial' then 'Partial' else 'Full' end
from user_settings s
cross join lateral jsonb_array_elements(coalesce(s.realized_history, '[]'::jsonb)) e
where not exists (select 1 from realized_positions r where r.user_id = s.user_id);

-- ─── 4. Preferences: goals, risk limits, auto-sync, etc. ─────────────────────
alter table user_settings add column if not exists preferences jsonb not null default '{}'::jsonb;

-- ─── 5. Daily portfolio value snapshots (for the history chart) ─────────────
create table if not exists portfolio_snapshots (
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date            date not null,
  holdings_value  numeric(18,2) not null,
  cost_basis      numeric(18,2) not null,
  cash            numeric(18,2) not null,
  primary key (user_id, date)
);
alter table portfolio_snapshots enable row level security;
drop policy if exists "Users manage own snapshots" on portfolio_snapshots;
create policy "Users manage own snapshots"
  on portfolio_snapshots for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─── 6. Profile photo, synced across devices (small JPEG data URL, ~20 KB) ──
alter table profiles add column if not exists avatar text;

-- ─── 7. Explicit API access. Supabase is moving to NOT exposing new tables
--        to the REST API automatically; granting is harmless if it already is.
grant select, insert, update, delete on trades, investments, profiles, user_settings,
  fund_transactions, realized_positions, portfolio_snapshots to authenticated;
