begin;

-- PRH's full backlist catalog (comics AND regular books -- trade paperbacks,
-- hardcovers, kids books, everything PRH currently has in print), sold on
-- themanapocket.com with no FOC-style weekly cutoff: a title is orderable any
-- time it's active, and a purchase rides whichever weekly PRH order comes
-- next rather than a specific street date. Deliberately kept separate from
-- foc_cycles/comic_title_families/comic_skus (the FOC weekly-release model)
-- rather than overloading them -- those tables' uniqueness keys and RLS are
-- built around a real cycle_id/cutoff that a perpetually-open backlist row
-- would have to fake, risking the currently-working FOC feature. Reuses
-- foc_touch_updated_at() (defined in 2026-08-17-foc-preorders.sql) for the
-- updated_at triggers below.

create table if not exists public.backlist_imports (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  source_filename text,
  source_sha256 text,
  source_row_count integer not null default 0 check (source_row_count >= 0),
  status text not null default 'processing' check (status in ('processing','completed','failed')),
  import_report jsonb not null default '{}'::jsonb,
  imported_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.backlist_titles (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  distributor_family_id text not null,
  title text not null,
  subtitle text,
  series_name text,
  series_number text,
  publisher text,
  imprint text,
  format_code text,
  format_name text,
  bisac1 text,
  bisac1_description text,
  bisac2 text,
  bisac2_description text,
  age_range text,
  description text,
  writer text,
  artist text,
  cover_artist text,
  contributor text,
  all_contributors text,
  page_count integer,
  cover_image_url text,
  is_published boolean not null default false,
  last_seen_import_id uuid references public.backlist_imports(id) on delete set null,
  last_seen_at timestamptz,
  first_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, distributor_family_id)
);

create table if not exists public.backlist_skus (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  title_id uuid not null references public.backlist_titles(id) on delete cascade,
  distributor_sku text not null,
  upc text not null,
  isbn text,
  format_code text,
  format_name text,
  variant_type text,
  order_requirement text,
  order_requirement_upc text,
  ratio_threshold integer check (ratio_threshold is null or ratio_threshold > 0),
  is_incentive boolean not null default false,
  sales_status_code text,
  sales_status text,
  on_sale_date date,
  catalog_date date,
  msrp_cents integer not null default 0 check (msrp_cents >= 0),
  customer_price_cents integer not null default 0 check (customer_price_cents >= 0),
  customer_enabled boolean not null default true,
  is_orderable boolean not null default false,
  is_published boolean not null default false,
  last_seen_import_id uuid references public.backlist_imports(id) on delete set null,
  last_seen_at timestamptz,
  raw_distributor_data jsonb not null default '{}'::jsonb,
  row_sha256 text,
  flags jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, distributor_sku),
  constraint backlist_skus_upc_exact check (upc ~ '^[0-9A-Za-z-]+$')
);

create table if not exists public.backlist_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  store_id uuid not null references public.stores(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'payment_pending' check (status in ('draft','payment_pending','paid','payment_failed','cancelled','refunded','partially_refunded','ready_for_pickup','shipped','completed')),
  customer_name text not null,
  customer_email text not null,
  customer_phone text,
  fulfillment_method text not null default 'pickup' check (fulfillment_method in ('pickup','shipping')),
  shipping_address jsonb,
  shipping_provider text,
  shipping_rate_id text,
  shipping_service text,
  subtotal_cents integer not null default 0 check (subtotal_cents >= 0),
  shipping_cents integer not null default 0 check (shipping_cents >= 0),
  total_cents integer not null default 0 check (total_cents >= 0),
  currency text not null default 'usd',
  stripe_mode text,
  stripe_payment_intent_id text unique,
  stripe_charge_id text,
  stripe_refund_id text,
  estimated_ship_earliest date,
  estimated_ship_latest date,
  cancellation_requested_at timestamptz,
  cancelled_at timestamptz,
  paid_at timestamptz,
  fulfilled_at timestamptz,
  confirmation_email_sent_at timestamptz,
  confirmation_email_error text,
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.backlist_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.backlist_orders(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete restrict,
  sku_id uuid not null references public.backlist_skus(id) on delete restrict,
  quantity integer not null check (quantity between 1 and 50),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  line_total_cents integer generated always as (quantity * unit_price_cents) stored,
  status text not null default 'committed' check (status in ('committed','cancelled','refunded','received','ready_for_pickup','shipped','completed')),
  sku_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, sku_id)
);

-- Full-text title/author/series search, the realistic backend for a first
-- version of browsing a tens-of-thousands-of-title catalog via PostgREST.
create index if not exists idx_backlist_titles_search on public.backlist_titles
  using gin (to_tsvector('english', title || ' ' || coalesce(subtitle,'') || ' ' || coalesce(writer,'') || ' ' || coalesce(series_name,'')));
create index if not exists idx_backlist_titles_store_published on public.backlist_titles(store_id, is_published);
create index if not exists idx_backlist_titles_publisher on public.backlist_titles(store_id, publisher);
create index if not exists idx_backlist_titles_last_seen on public.backlist_titles(store_id, last_seen_import_id);
create index if not exists idx_backlist_skus_title on public.backlist_skus(title_id);
create index if not exists idx_backlist_skus_isbn on public.backlist_skus(store_id, isbn);
create index if not exists idx_backlist_skus_upc on public.backlist_skus(store_id, upc);
create index if not exists idx_backlist_skus_orderable on public.backlist_skus(store_id, is_published, is_orderable);
create index if not exists idx_backlist_skus_last_seen on public.backlist_skus(store_id, last_seen_import_id);
create index if not exists idx_backlist_orders_user on public.backlist_orders(user_id, created_at desc);
create index if not exists idx_backlist_orders_store_status on public.backlist_orders(store_id, status);
create index if not exists idx_backlist_items_sku on public.backlist_order_items(sku_id, status);
create index if not exists idx_backlist_items_store on public.backlist_order_items(store_id);
create index if not exists idx_backlist_imports_store on public.backlist_imports(store_id, started_at desc);

drop trigger if exists backlist_titles_touch_updated_at on public.backlist_titles;
create trigger backlist_titles_touch_updated_at before update on public.backlist_titles for each row execute function public.foc_touch_updated_at();
drop trigger if exists backlist_skus_touch_updated_at on public.backlist_skus;
create trigger backlist_skus_touch_updated_at before update on public.backlist_skus for each row execute function public.foc_touch_updated_at();
drop trigger if exists backlist_orders_touch_updated_at on public.backlist_orders;
create trigger backlist_orders_touch_updated_at before update on public.backlist_orders for each row execute function public.foc_touch_updated_at();
drop trigger if exists backlist_order_items_touch_updated_at on public.backlist_order_items;
create trigger backlist_order_items_touch_updated_at before update on public.backlist_order_items for each row execute function public.foc_touch_updated_at();

alter table public.backlist_imports enable row level security;
alter table public.backlist_titles enable row level security;
alter table public.backlist_skus enable row level security;
alter table public.backlist_orders enable row level security;
alter table public.backlist_order_items enable row level security;

-- Same convention as foc_cycles/comic_skus: staff manage the catalog
-- directly; the public shop reads it through the Worker's service role
-- (never a direct anon grant), so raw distributor JSON stays private.
create policy backlist_imports_staff_all on public.backlist_imports for all to authenticated
  using (public.current_store_role(store_id) in ('owner','admin','manager','employee'))
  with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
create policy backlist_titles_staff_all on public.backlist_titles for all to authenticated
  using (public.current_store_role(store_id) in ('owner','admin','manager','employee'))
  with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
create policy backlist_skus_staff_all on public.backlist_skus for all to authenticated
  using (public.current_store_role(store_id) in ('owner','admin','manager','employee'))
  with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));

create policy backlist_orders_customer_select on public.backlist_orders for select to authenticated
  using (user_id = (select auth.uid()) or public.current_store_role(store_id) in ('owner','admin','manager','employee'));
create policy backlist_orders_staff_update on public.backlist_orders for update to authenticated
  using (public.current_store_role(store_id) in ('owner','admin','manager','employee'))
  with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));

create policy backlist_items_customer_select on public.backlist_order_items for select to authenticated
  using (
    exists (select 1 from public.backlist_orders o where o.id = order_id and (o.user_id = (select auth.uid()) or public.current_store_role(o.store_id) in ('owner','admin','manager','employee')))
  );
create policy backlist_items_staff_update on public.backlist_order_items for update to authenticated
  using (public.current_store_role(store_id) in ('owner','admin','manager','employee'))
  with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));

revoke all on public.backlist_imports, public.backlist_titles, public.backlist_skus,
  public.backlist_orders, public.backlist_order_items from anon;
grant select, insert, update on public.backlist_imports, public.backlist_titles, public.backlist_skus to authenticated;
grant select, update on public.backlist_orders, public.backlist_order_items to authenticated;

commit;
