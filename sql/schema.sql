-- ============================================
-- TradeLog — Supabase Schema (fresh install)
-- Run in: Supabase Dashboard → SQL Editor
-- Existing databases: run the files in sql/migrations/ in date order instead.
-- ============================================

create extension if not exists "pgcrypto";

create table trades (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  created_at  timestamptz default now(),
  date        date not null,
  symbol      text not null,
  type        text check (type in ('Crypto','Forex','Stocks')) not null,
  dir         text check (dir in ('Long','Short')) not null,
  entry       numeric(30,12) not null,
  exit        numeric(30,12),
  size        numeric(18,2) not null,
  sl          numeric(30,12),
  tp          numeric(30,12),
  -- Total fees for the trade (exchange fees + funding). Synced Bybit trades
  -- fill this in from the exchange's own net P&L.
  fees        numeric(18,2) not null default 0,
  -- How much of fees was the buy side and the sell side (from your fee
  -- rates or typed in). Empty for Bybit trades: Bybit reports one total.
  buy_fee     numeric(18,2),
  sell_fee    numeric(18,2),
  -- Gross P&L from the price move alone.
  pnl         numeric(18,2) generated always as (
                case when exit is null then 0
                     when dir = 'Long'  then (exit - entry) / entry * size
                     else               (entry - exit) / entry * size
                end
              ) stored,
  -- Net P&L = gross − fees. Every stat, the trading balance and the status
  -- below use this.
  net_pnl     numeric(18,2) generated always as (
                case when exit is null then 0
                     when dir = 'Long'  then (exit - entry) / entry * size - fees
                     else               (entry - exit) / entry * size - fees
                end
              ) stored,
  rr          numeric(8,4),
  -- Breakeven = NET P&L rounds to $0.00, not just exit exactly equal to
  -- entry — an averaged exit across partial closes, or a one-tick move on a
  -- small position, would otherwise show "$0.00 · Win".
  status      text generated always as (
                case when exit is null then 'Open'
                     when round((case when dir = 'Long' then exit - entry else entry - exit end) / entry * size - fees, 2) = 0 then 'Breakeven'
                     when       (case when dir = 'Long' then exit - entry else entry - exit end) / entry * size - fees > 0 then 'Win'
                     else 'Loss'
                end
              ) stored,
  setup       text,
  notes       text,
  tags        text[],
  -- Journaling: what went wrong, how it felt, whether the plan was followed.
  mistakes       text[],
  emotion        text,
  followed_plan  boolean,
  -- When the position was opened / fully closed (holding time, time-of-day
  -- stats). Optional for manual trades; Bybit sync always fills them.
  opened_at   timestamptz,
  closed_at   timestamptz,
  -- Populated only for trades imported via an exchange sync (e.g. Bybit);
  -- null for anything logged manually through the app. A plain unique
  -- constraint is enough here — SQL treats every NULL as distinct from every
  -- other NULL, so manual trades (external_id always null) never conflict
  -- with each other; only a repeated import of the *same* external_id would.
  source      text default 'manual',
  external_id text,
  -- original_size: the position's full size before any partial close.
  -- realized_exit_value: exit-side $ realized so far by partial closes, so
  -- the final close can compute the size-weighted average exit price.
  original_size        numeric(18,2),
  realized_exit_value  numeric(18,2) default 0,
  -- Every individual close of this trade, oldest first:
  --   { id, date, exit, size, pnl, fee }  (size = entry-side $ closed by that fill)
  -- A partially closed trade stays Open (exit null, so P&L 0 and out of the
  -- stats) with size = what's still open; the final close sets exit to the
  -- size-weighted average of all fills and size back to original_size, so
  -- it counts as ONE trade. "id" is Bybit's orderId for synced fills, which
  -- is also what stops a re-sync from applying the same close twice.
  closes      jsonb not null default '[]'::jsonb,
  unique (user_id, external_id)
);

create table investments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  created_at  timestamptz default now(),
  symbol      text not null,
  type        text check (type in ('Crypto','Stocks','ETF','Other')) not null,
  buy_date    date not null,
  qty         numeric(18,8) not null,
  buy_price   numeric(30,12) not null,
  cur_price   numeric(30,12),
  notes       text
);

-- One row per user: public-ish display name (checked for uniqueness at signup/edit).
-- Case-insensitive uniqueness so "TraderDotETH" and "traderdoteth" can't both exist.
create table profiles (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null,
  avatar        text,  -- small JPEG data URL (~20 KB), synced across devices
  updated_at    timestamptz default now()
);

create unique index idx_profiles_display_name_lower on profiles (lower(display_name));

-- One row per user: cash balance + trading balance + preferences (goals,
-- risk limits, auto-sync). realized_history is legacy — closed investment
-- positions now live in realized_positions.
-- Upserted via PostgREST on_conflict=user_id, so no separate insert/update path needed.
create table user_settings (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  cash_balance      numeric(18,2) not null default 0,
  trading_balance   numeric(18,2) not null default 0,
  realized_history  jsonb not null default '[]'::jsonb,
  preferences       jsonb not null default '{}'::jsonb,
  -- true: the app works both balances out from the history (funds + trades
  -- + holdings + sales); the two balance columns above are no longer used
  ledger_balances   boolean not null default true,
  updated_at        timestamptz default now()
);

-- Every deposit, withdrawal, adjustment and transfer. amount is signed:
-- + adds to the account's balance, − takes from it. A transfer is two rows
-- (transfer_out + transfer_in) sharing one transfer_id.
create table fund_transactions (
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

-- Closed (sold) investment positions, one row per sale.
create table realized_positions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at    timestamptz default now(),
  date          date not null,
  symbol        text not null,
  type          text,
  qty_sold      numeric(18,8) not null,
  avg_cost      numeric(30,12) not null,
  exit_price    numeric(30,12) not null,
  realized_pnl  numeric(18,2) not null,
  proceeds      numeric(18,2) not null,
  close_type    text not null default 'Full' check (close_type in ('Full','Partial')),
  buy_date      date
);

-- One row per user per day: portfolio value, for the history chart.
create table portfolio_snapshots (
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date            date not null,
  holdings_value  numeric(18,2) not null,
  cost_basis      numeric(18,2) not null,
  cash            numeric(18,2) not null,
  primary key (user_id, date)
);

create index idx_trades_user    on trades(user_id);
create index idx_trades_date    on trades(date desc);
create index idx_trades_type    on trades(type);
create index idx_trades_status  on trades(status);
create index idx_trades_rr      on trades(rr);
create index idx_trades_pnl     on trades(pnl);
create index idx_invest_user    on investments(user_id);
create index idx_funds_user     on fund_transactions(user_id, date desc);
create index idx_realized_user  on realized_positions(user_id, date desc);

alter table trades              enable row level security;
alter table investments         enable row level security;
alter table profiles            enable row level security;
alter table user_settings       enable row level security;
alter table fund_transactions   enable row level security;
alter table realized_positions  enable row level security;
alter table portfolio_snapshots enable row level security;

create policy "Users see own trades"
  on trades for all using (auth.uid() = user_id);

create policy "Users see own investments"
  on investments for all using (auth.uid() = user_id);

create policy "Users manage own profile"
  on profiles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage own settings"
  on user_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage own fund transactions"
  on fund_transactions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage own realized positions"
  on realized_positions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage own snapshots"
  on portfolio_snapshots for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on trades, investments, profiles, user_settings,
  fund_transactions, realized_positions, portfolio_snapshots to authenticated;

-- Narrow, safe availability check: returns only true/false, never leaks any
-- other user's row data. Runs as SECURITY DEFINER so it can see across all
-- profiles despite the RLS policy above restricting normal reads to one's own row.
create or replace function is_display_name_available(check_name text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select not exists (
    select 1 from profiles
    where lower(display_name) = lower(check_name)
      and user_id <> auth.uid()
  );
$$;

revoke all on function is_display_name_available(text) from public;
grant execute on function is_display_name_available(text) to authenticated;

