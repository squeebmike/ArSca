-- Card Intake: any image source (rapid phone camera, bulk upload, auto-feed
-- scanner, desktop camera) feeds one common processing queue: capture first,
-- identify/price in the background, human verification, then promote into
-- inventory_items -- or into a collection_buys evaluation when the batch is
-- attached to a collection purchase in progress.
--
-- Deliberately jsonb-leaning, matching this schema's existing convention
-- (inventory_items.data, scan_queue.payload, buylist_submissions.items) --
-- candidates/best-match/final fields live on the item row itself rather than
-- in a maze of normalized child tables, so the fast review screen never needs
-- more than one row per card. card_identification_attempts and card_reviews
-- stay as real append-only history tables since "identification history" and
-- an audit trail of review actions were explicit requirements.
--
-- No card_products/card_variants table: Pokemon/MTG/sports product catalogs
-- already live outside Postgres (PokemonPriceTracker, the MTG offline cache,
-- the Topps R2 catalog) and are already resolved client-side via
-- searchQuickCatalog/resolveOwnCardIdentifyCard -- duplicating them here
-- would just be a second, driftable copy. A resolved catalog match is stored
-- as a jsonb snapshot (best_match) instead, alongside the external id it
-- came from.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'card_intake_source') then
    create type public.card_intake_source as enum ('PHONE_CAMERA','BULK_UPLOAD','SCANNER','DESKTOP_CAMERA','MANUAL');
  end if;
  if not exists (select 1 from pg_type where typname = 'card_intake_batch_status') then
    create type public.card_intake_batch_status as enum ('open','finished','archived');
  end if;
  if not exists (select 1 from pg_type where typname = 'card_intake_item_status') then
    create type public.card_intake_item_status as enum ('captured','processing','needs_review','needs_back','approved','rejected','duplicate','failed');
  end if;
  if not exists (select 1 from pg_type where typname = 'collection_buy_status') then
    create type public.collection_buy_status as enum ('draft','evaluating','offered','purchased','declined');
  end if;
end $$;

create table if not exists public.collection_buys (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  seller text,
  name text,
  category text,
  estimated_card_count int,
  asking_price_cents int,
  notes text,
  target_buy_percentage numeric,
  status public.collection_buy_status not null default 'draft',
  total_cost_cents int,
  purchased_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.card_intake_batches (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  collection_buy_id uuid references public.collection_buys(id) on delete set null,
  source public.card_intake_source not null,
  status public.card_intake_batch_status not null default 'open',
  label text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.card_intake_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.card_intake_batches(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  collection_buy_id uuid references public.collection_buys(id) on delete set null,
  sequence int not null default 1,
  source public.card_intake_source not null,
  status public.card_intake_item_status not null default 'captured',
  front_image_url text,
  back_image_url text,
  thumbnail_url text,
  category text,
  card_id_confidence numeric,
  variant_confidence numeric,
  best_match jsonb,
  candidates jsonb not null default '[]'::jsonb,
  final_fields jsonb,
  condition text,
  cost_cents int,
  market_cents int,
  high_value boolean not null default false,
  error text,
  inventory_item_id uuid,
  captured_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.card_identification_attempts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.card_intake_items(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  provider text not null,
  request jsonb,
  response jsonb,
  card_id_confidence numeric,
  variant_confidence numeric,
  status text not null default 'ok',
  created_at timestamptz not null default now()
);

create table if not exists public.card_reviews (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.card_intake_items(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  reviewer_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  chosen_candidate_index int,
  final_fields jsonb,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.pricing_snapshots (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references public.card_intake_items(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  provider text not null,
  price_cents int,
  raw jsonb,
  as_of timestamptz not null default now()
);

create table if not exists public.acquisition_rules (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  category text not null default 'default',
  tiers jsonb not null default '[]'::jsonb,
  effective_date timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(store_id, category)
);

create table if not exists public.scanner_workstations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  token_hash text not null,
  last_seen_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_card_intake_batches_store on public.card_intake_batches(store_id, status, created_at desc);
create index if not exists idx_card_intake_batches_collection on public.card_intake_batches(collection_buy_id);
create index if not exists idx_card_intake_items_batch on public.card_intake_items(batch_id, sequence);
create index if not exists idx_card_intake_items_store_status on public.card_intake_items(store_id, status, captured_at desc);
create index if not exists idx_card_intake_items_collection on public.card_intake_items(collection_buy_id);
create index if not exists idx_card_identification_attempts_item on public.card_identification_attempts(item_id, created_at desc);
create index if not exists idx_card_reviews_item on public.card_reviews(item_id, created_at desc);
create index if not exists idx_pricing_snapshots_item on public.pricing_snapshots(item_id, as_of desc);
create index if not exists idx_scanner_workstations_store on public.scanner_workstations(store_id);

drop trigger if exists trg_card_intake_items_updated_at on public.card_intake_items;
create trigger trg_card_intake_items_updated_at
before update on public.card_intake_items
for each row execute function public.touch_updated_at();

drop trigger if exists trg_collection_buys_updated_at on public.collection_buys;
create trigger trg_collection_buys_updated_at
before update on public.collection_buys
for each row execute function public.touch_updated_at();

alter table public.collection_buys enable row level security;
alter table public.card_intake_batches enable row level security;
alter table public.card_intake_items enable row level security;
alter table public.card_identification_attempts enable row level security;
alter table public.card_reviews enable row level security;
alter table public.pricing_snapshots enable row level security;
alter table public.acquisition_rules enable row level security;
alter table public.scanner_workstations enable row level security;

drop policy if exists collection_buys_select_member on public.collection_buys;
create policy collection_buys_select_member on public.collection_buys for select using (public.is_store_member(store_id));
drop policy if exists collection_buys_write_member on public.collection_buys;
create policy collection_buys_write_member on public.collection_buys for all using (public.can_sell_or_scan(store_id)) with check (public.can_sell_or_scan(store_id));

drop policy if exists card_intake_batches_select_member on public.card_intake_batches;
create policy card_intake_batches_select_member on public.card_intake_batches for select using (public.is_store_member(store_id));
drop policy if exists card_intake_batches_write_member on public.card_intake_batches;
create policy card_intake_batches_write_member on public.card_intake_batches for all using (public.can_sell_or_scan(store_id)) with check (public.can_sell_or_scan(store_id));

drop policy if exists card_intake_items_select_member on public.card_intake_items;
create policy card_intake_items_select_member on public.card_intake_items for select using (public.is_store_member(store_id));
drop policy if exists card_intake_items_write_member on public.card_intake_items;
create policy card_intake_items_write_member on public.card_intake_items for all using (public.can_sell_or_scan(store_id)) with check (public.can_sell_or_scan(store_id));

drop policy if exists card_identification_attempts_select_member on public.card_identification_attempts;
create policy card_identification_attempts_select_member on public.card_identification_attempts for select using (public.is_store_member(store_id));
drop policy if exists card_identification_attempts_insert_member on public.card_identification_attempts;
create policy card_identification_attempts_insert_member on public.card_identification_attempts for insert with check (public.can_sell_or_scan(store_id));

drop policy if exists card_reviews_select_member on public.card_reviews;
create policy card_reviews_select_member on public.card_reviews for select using (public.is_store_member(store_id));
drop policy if exists card_reviews_insert_member on public.card_reviews;
create policy card_reviews_insert_member on public.card_reviews for insert with check (public.can_sell_or_scan(store_id));

drop policy if exists pricing_snapshots_select_member on public.pricing_snapshots;
create policy pricing_snapshots_select_member on public.pricing_snapshots for select using (public.is_store_member(store_id));
drop policy if exists pricing_snapshots_insert_member on public.pricing_snapshots;
create policy pricing_snapshots_insert_member on public.pricing_snapshots for insert with check (public.can_sell_or_scan(store_id));

drop policy if exists acquisition_rules_select_member on public.acquisition_rules;
create policy acquisition_rules_select_member on public.acquisition_rules for select using (public.is_store_member(store_id));
drop policy if exists acquisition_rules_manage_admin on public.acquisition_rules;
create policy acquisition_rules_manage_admin on public.acquisition_rules for all using (public.can_manage_store(store_id)) with check (public.can_manage_store(store_id));

drop policy if exists scanner_workstations_select_member on public.scanner_workstations;
create policy scanner_workstations_select_member on public.scanner_workstations for select using (public.is_store_member(store_id));
drop policy if exists scanner_workstations_manage_admin on public.scanner_workstations;
create policy scanner_workstations_manage_admin on public.scanner_workstations for all using (public.can_manage_store(store_id)) with check (public.can_manage_store(store_id));
