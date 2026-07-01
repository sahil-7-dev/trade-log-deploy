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
                     when ((dir='Long' and exit>entry) or (dir='Short' and exit<entry)) then 'Win'
                     else 'Loss'
                end
              ) stored,
  setup       text,
  notes       text,
  tags        text[]
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

create index idx_trades_user   on trades(user_id);
create index idx_trades_date   on trades(date desc);
create index idx_trades_type   on trades(type);
create index idx_trades_status on trades(status);
create index idx_trades_rr     on trades(rr);
create index idx_trades_pnl    on trades(pnl);
create index idx_invest_user   on investments(user_id);

alter table trades      enable row level security;
alter table investments enable row level security;

create policy "Users see own trades"
  on trades for all using (auth.uid() = user_id);

create policy "Users see own investments"
  on investments for all using (auth.uid() = user_id);
