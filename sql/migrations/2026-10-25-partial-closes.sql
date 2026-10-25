-- ============================================
-- TradeLog — migration: partial closes + breakeven by P&L
-- Run ONCE in: Supabase Dashboard → SQL Editor, BEFORE deploying the app
-- version that uses it. Safe to re-run.
-- ============================================

-- Partial-close tracking. original_size / realized_exit_value already exist
-- if the Bybit integration was set up; "if not exists" makes this a no-op then.
alter table trades add column if not exists original_size       numeric(18,2);
alter table trades add column if not exists realized_exit_value numeric(18,2) default 0;
alter table trades add column if not exists closes              jsonb not null default '[]'::jsonb;

-- Breakeven = P&L rounds to $0.00, instead of exit exactly equal to entry.
-- A generated column's expression can't be altered in place, so it's
-- dropped and re-added (values are recomputed from existing rows — no data
-- is lost; status was never stored independently of entry/exit/size).
drop index if exists idx_trades_status;
alter table trades drop column if exists status;
alter table trades add column status text generated always as (
  case when exit is null then 'Open'
       when round(abs(exit - entry) / entry * size, 2) = 0 then 'Breakeven'
       when ((dir='Long' and exit>entry) or (dir='Short' and exit<entry)) then 'Win'
       else 'Loss'
  end
) stored;
create index idx_trades_status on trades(status);
