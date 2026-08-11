-- Comic pull lists: ongoing series the shop tracks, upcoming issues with
-- order-cutoff dates, and customer subscriptions ("send me every issue of
-- X"). Run after pos-money-ledger.sql and
-- 2026-08-10-customers-loyalty-gift-cards.sql (subscriptions link to the
-- customers table).
--
-- Deliberately does not attempt to auto-populate from any distributor feed
-- (Penguin Random House Comics Retail / Lunar / Diamond) -- none of them
-- expose a public retailer API, so upcoming issues are entered by staff
-- (from whatever catalog/solicitation source they're looking at) rather
-- than scraped from a login-gated portal.

create table if not exists public.pull_list_series (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  title text not null,
  publisher text,
  notes text,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pull_list_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  series_id uuid not null references public.pull_list_series(id) on delete cascade,
  issue_number text not null,
  variant_label text,
  cover_image_url text,
  foc_date date,
  street_date date,
  status text not null default 'upcoming',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pull_list_subscriptions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  series_id uuid not null references public.pull_list_series(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  -- Denormalized (same convention as event_registrations.player_name) so
  -- rendering the subscriber list never needs a join back to customers.
  customer_name text not null,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists idx_pull_list_subscriptions_unique on public.pull_list_subscriptions(series_id, customer_id);

create index if not exists idx_pull_list_series_store on public.pull_list_series(store_id, title);
create index if not exists idx_pull_list_items_series on public.pull_list_items(series_id, foc_date asc);
create index if not exists idx_pull_list_items_store_foc on public.pull_list_items(store_id, foc_date asc) where status = 'upcoming';
create index if not exists idx_pull_list_subscriptions_series on public.pull_list_subscriptions(series_id) where active;

alter table public.pull_list_series enable row level security;
alter table public.pull_list_items enable row level security;
alter table public.pull_list_subscriptions enable row level security;

drop policy if exists pull_list_series_select_member on public.pull_list_series;
create policy pull_list_series_select_member on public.pull_list_series for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists pull_list_series_insert_employee on public.pull_list_series;
create policy pull_list_series_insert_employee on public.pull_list_series for insert with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists pull_list_series_update_employee on public.pull_list_series;
create policy pull_list_series_update_employee on public.pull_list_series for update using (public.current_store_role(store_id) in ('owner','admin','manager','employee')) with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));

drop policy if exists pull_list_items_select_member on public.pull_list_items;
create policy pull_list_items_select_member on public.pull_list_items for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists pull_list_items_insert_employee on public.pull_list_items;
create policy pull_list_items_insert_employee on public.pull_list_items for insert with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists pull_list_items_update_employee on public.pull_list_items;
create policy pull_list_items_update_employee on public.pull_list_items for update using (public.current_store_role(store_id) in ('owner','admin','manager','employee')) with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));

drop policy if exists pull_list_subscriptions_select_member on public.pull_list_subscriptions;
create policy pull_list_subscriptions_select_member on public.pull_list_subscriptions for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists pull_list_subscriptions_insert_employee on public.pull_list_subscriptions;
create policy pull_list_subscriptions_insert_employee on public.pull_list_subscriptions for insert with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists pull_list_subscriptions_update_employee on public.pull_list_subscriptions;
create policy pull_list_subscriptions_update_employee on public.pull_list_subscriptions for update using (public.current_store_role(store_id) in ('owner','admin','manager','employee')) with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
