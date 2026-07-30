-- ============================================
-- TradeLog — Supabase Schema
-- Run in: Supabase Dashboard → SQL Editor
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
  entry       numeric(18,6) not null,
  exit        numeric(18,6),
  size        numeric(18,2) not null,
  sl          numeric(18,6),
  tp          numeric(18,6),
  pnl         numeric(18,2) generated always as (
                case when exit is null then 0
                     when dir = 'Long'  then (exit - entry) / entry * size
                     else               (entry - exit) / entry * size
                end
              ) stored,
  rr          numeric(8,4),
  status      text generated always as (
                case when exit is null then 'Open'
                     when exit = entry then 'Breakeven'
                     when ((dir='Long' and exit>entry) or (dir='Short' and exit<entry)) then 'Win'
                     else 'Loss'
                end
              ) stored,
  setup       text,
  notes       text,
  tags        text[],
  -- Populated only for trades imported via an exchange sync (e.g. Bybit);
  -- null for anything logged manually through the app. A plain unique
  -- constraint is enough here — SQL treats every NULL as distinct from every
  -- other NULL, so manual trades (external_id always null) never conflict
  -- with each other; only a repeated import of the *same* external_id would.
  source      text default 'manual',
  external_id text,
  -- Both only meaningful while a Bybit-synced position is open and being
  -- partially closed over time: original_size is the position's full size at
  -- open (never shrinks — needed so the FINAL close's P&L is computed over
  -- the whole position, not just its last remaining sliver, merging every
  -- partial close into one final trade instead of a fragmented row per
  -- close); realized_exit_value accumulates the exit-side notional value
  -- from each partial close as it happens, so the eventual full close can
  -- compute a correctly weighted-average exit price across every fill
  -- combined. Stay null/irrelevant for manual trades and for trades that
  -- were never partially closed.
  original_size        numeric(18,2),
  realized_exit_value  numeric(18,2) default 0,
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
  buy_price   numeric(18,6) not null,
  cur_price   numeric(18,6),
  notes       text
);

-- One row per user: public-ish display name (checked for uniqueness at signup/edit).
-- Case-insensitive uniqueness so "TraderDotETH" and "traderdoteth" can't both exist.
create table profiles (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null,
  updated_at    timestamptz default now()
);

create unique index idx_profiles_display_name_lower on profiles (lower(display_name));

-- One row per user: cash balance + realized (closed-position) P&L history +
-- trading balance (separate from cash — tracks a notional trading account
-- that moves with realized trade P&L, plus manual deposits).
-- Upserted via PostgREST on_conflict=user_id, so no separate insert/update path needed.
create table user_settings (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  cash_balance      numeric(18,2) not null default 0,
  trading_balance   numeric(18,2) not null default 0,
  realized_history  jsonb not null default '[]'::jsonb,
  updated_at        timestamptz default now()
);

create index idx_trades_user   on trades(user_id);
create index idx_trades_date   on trades(date desc);
create index idx_trades_type   on trades(type);
create index idx_trades_status on trades(status);
create index idx_trades_rr     on trades(rr);
create index idx_trades_pnl    on trades(pnl);
create index idx_invest_user   on investments(user_id);

alter table trades        enable row level security;
alter table investments   enable row level security;
alter table profiles      enable row level security;
alter table user_settings enable row level security;

create policy "Users see own trades"
  on trades for all using (auth.uid() = user_id);

create policy "Users see own investments"
  on investments for all using (auth.uid() = user_id);

create policy "Users manage own profile"
  on profiles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage own settings"
  on user_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

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
