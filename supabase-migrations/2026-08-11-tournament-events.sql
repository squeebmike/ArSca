-- Walk-Off tournament / event management.
-- Run after pos-money-ledger.sql and 2026-08-10-customers-loyalty-gift-cards.sql
-- (event registrations optionally link to the customers table).

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  game text not null default 'Other',
  format text,
  event_date date,
  entry_fee numeric(12,2) not null default 0,
  max_players integer,
  status text not null default 'upcoming',
  structure text not null default 'swiss',
  round_count integer,
  current_round integer not null default 0,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.event_registrations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  player_name text not null,
  contact text,
  paid boolean not null default false,
  paid_amount numeric(12,2) not null default 0,
  sale_id uuid references public.pos_sales(id) on delete set null,
  dropped boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.event_matches (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  round_number integer not null,
  table_number integer,
  player1_registration_id uuid not null references public.event_registrations(id) on delete cascade,
  player2_registration_id uuid references public.event_registrations(id) on delete cascade,
  result text,
  player1_game_wins integer not null default 0,
  player2_game_wins integer not null default 0,
  reported_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_events_store on public.events(store_id, event_date desc);
create index if not exists idx_event_registrations_event on public.event_registrations(event_id, created_at asc);
create index if not exists idx_event_matches_event_round on public.event_matches(event_id, round_number);

alter table public.events enable row level security;
alter table public.event_registrations enable row level security;
alter table public.event_matches enable row level security;

drop policy if exists events_select_member on public.events;
create policy events_select_member on public.events for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists events_insert_employee on public.events;
create policy events_insert_employee on public.events for insert with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists events_update_employee on public.events;
create policy events_update_employee on public.events for update using (public.current_store_role(store_id) in ('owner','admin','manager','employee')) with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));

drop policy if exists event_registrations_select_member on public.event_registrations;
create policy event_registrations_select_member on public.event_registrations for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists event_registrations_insert_employee on public.event_registrations;
create policy event_registrations_insert_employee on public.event_registrations for insert with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists event_registrations_update_employee on public.event_registrations;
create policy event_registrations_update_employee on public.event_registrations for update using (public.current_store_role(store_id) in ('owner','admin','manager','employee')) with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));

drop policy if exists event_matches_select_member on public.event_matches;
create policy event_matches_select_member on public.event_matches for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists event_matches_insert_employee on public.event_matches;
create policy event_matches_insert_employee on public.event_matches for insert with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists event_matches_update_employee on public.event_matches;
create policy event_matches_update_employee on public.event_matches for update using (public.current_store_role(store_id) in ('owner','admin','manager','employee')) with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
