-- ============================================================
-- My Portfolio — Schema + RLS
-- Run once in Supabase SQL editor (Dashboard → SQL → New query)
-- ============================================================

-- 1. portfolio_lots: each row = one buy ("ไม้")
create table if not exists public.portfolio_lots (
  id           uuid         primary key default gen_random_uuid(),
  user_id      uuid         not null references auth.users(id) on delete cascade,
  ticker       text         not null,
  entry_date   date         not null,
  amount_usd   numeric(14,2) not null check (amount_usd > 0),
  entry_price  numeric(14,4) not null check (entry_price > 0),
  shares       numeric(18,8) not null check (shares > 0),
  notes        text,
  created_at   timestamptz  not null default now()
);

create index if not exists portfolio_lots_user_idx
  on public.portfolio_lots (user_id, entry_date desc);

-- 2. portfolio_sells: each row = one partial/full sell of a lot
create table if not exists public.portfolio_sells (
  id           uuid         primary key default gen_random_uuid(),
  lot_id       uuid         not null references public.portfolio_lots(id) on delete cascade,
  user_id      uuid         not null references auth.users(id) on delete cascade,
  exit_date    date         not null,
  exit_price   numeric(14,4) not null check (exit_price > 0),
  shares_sold  numeric(18,8) not null check (shares_sold > 0),
  notes        text,
  created_at   timestamptz  not null default now()
);

create index if not exists portfolio_sells_lot_idx
  on public.portfolio_sells (lot_id);
create index if not exists portfolio_sells_user_idx
  on public.portfolio_sells (user_id, exit_date desc);

-- 3. RLS — each user only sees/edits their own rows
alter table public.portfolio_lots  enable row level security;
alter table public.portfolio_sells enable row level security;

-- portfolio_lots policies
drop policy if exists "lots_select_own" on public.portfolio_lots;
create policy "lots_select_own" on public.portfolio_lots
  for select using (auth.uid() = user_id);

drop policy if exists "lots_insert_own" on public.portfolio_lots;
create policy "lots_insert_own" on public.portfolio_lots
  for insert with check (auth.uid() = user_id);

drop policy if exists "lots_update_own" on public.portfolio_lots;
create policy "lots_update_own" on public.portfolio_lots
  for update using (auth.uid() = user_id);

drop policy if exists "lots_delete_own" on public.portfolio_lots;
create policy "lots_delete_own" on public.portfolio_lots
  for delete using (auth.uid() = user_id);

-- portfolio_sells policies
drop policy if exists "sells_select_own" on public.portfolio_sells;
create policy "sells_select_own" on public.portfolio_sells
  for select using (auth.uid() = user_id);

drop policy if exists "sells_insert_own" on public.portfolio_sells;
create policy "sells_insert_own" on public.portfolio_sells
  for insert with check (auth.uid() = user_id);

drop policy if exists "sells_update_own" on public.portfolio_sells;
create policy "sells_update_own" on public.portfolio_sells
  for update using (auth.uid() = user_id);

drop policy if exists "sells_delete_own" on public.portfolio_sells;
create policy "sells_delete_own" on public.portfolio_sells
  for delete using (auth.uid() = user_id);
