create extension if not exists pgcrypto;

create table if not exists public.records (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) <= 180),
  barcode text not null default '' check (char_length(barcode) <= 80),
  created_at timestamptz not null default now(),
  sale_price numeric not null default 0,
  purchase_price numeric not null default 0,
  shipping_fee numeric not null default 0,
  commission_rate numeric not null default 0,
  withholding_rate numeric not null default 0,
  vat_rate numeric not null default 0,
  sale_mode text not null default 'includingVat' check (sale_mode in ('includingVat', 'excludingVat')),
  commission_base text not null default 'salePrice' check (commission_base in ('salePrice', 'saleNet')),
  sale_net numeric not null default 0,
  commission_fee numeric not null default 0,
  withholding_fee numeric not null default 0,
  profit numeric not null default 0
);

alter table public.records add column if not exists barcode text not null default '' check (char_length(barcode) <= 80);
alter table public.records drop constraint if exists records_name_check;
alter table public.records drop constraint if exists records_name_length_check;
alter table public.records add constraint records_name_length_check check (char_length(name) <= 180);
alter table public.records enable row level security;

drop policy if exists "Anyone can read product records" on public.records;
drop policy if exists "Anyone can add product records" on public.records;
drop policy if exists "Anyone can update product records" on public.records;
drop policy if exists "Anyone can delete product records" on public.records;

create policy "Anyone can read product records"
  on public.records
  for select
  to anon
  using (true);

create policy "Anyone can add product records"
  on public.records
  for insert
  to anon
  with check (true);

create policy "Anyone can update product records"
  on public.records
  for update
  to anon
  using (true)
  with check (true);

create policy "Anyone can delete product records"
  on public.records
  for delete
  to anon
  using (true);

create index if not exists records_profit_idx on public.records (profit desc);
create index if not exists records_created_at_idx on public.records (created_at desc);
create index if not exists records_barcode_idx on public.records (barcode);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  note text not null check (char_length(note) <= 500),
  created_at timestamptz not null default now()
);

alter table public.notes enable row level security;

drop policy if exists "Anyone can read notes" on public.notes;
drop policy if exists "Anyone can add notes" on public.notes;
drop policy if exists "Anyone can delete notes" on public.notes;

create policy "Anyone can read notes"
  on public.notes
  for select
  to anon
  using (true);

create policy "Anyone can add notes"
  on public.notes
  for insert
  to anon
  with check (true);

create policy "Anyone can delete notes"
  on public.notes
  for delete
  to anon
  using (true);

create index if not exists notes_created_at_idx on public.notes (created_at desc);

create table if not exists public.market_cache (
  scope text primary key check (char_length(scope) <= 80),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.market_cache enable row level security;

drop policy if exists "Anyone can read market cache" on public.market_cache;
drop policy if exists "Anyone can upsert market cache" on public.market_cache;

create policy "Anyone can read market cache"
  on public.market_cache
  for select
  to anon
  using (true);

create policy "Anyone can upsert market cache"
  on public.market_cache
  for all
  to anon
  using (true)
  with check (true);

create index if not exists market_cache_updated_at_idx on public.market_cache (updated_at desc);
