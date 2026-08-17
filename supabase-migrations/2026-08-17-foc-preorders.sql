begin;

-- The Mana Pocket weekly PRH FOC preorder catalog. This is deliberately
-- additive: pull_list_* remains the staff subscription tracker, while these
-- tables model distributor SKUs, exact cover commitments, and paid preorders.

create or replace function public.foc_default_customer_cutoff(p_foc_date date)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select (p_foc_date::timestamp + interval '1 minute') at time zone 'America/Los_Angeles';
$$;

create or replace function public.foc_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.foc_cycle_default_cutoff()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.customer_cutoff_at is null then
    new.customer_cutoff_at := public.foc_default_customer_cutoff(new.foc_date);
  end if;
  return new;
end;
$$;

create table if not exists public.foc_cycles (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  distributor text not null default 'PRH',
  foc_date date not null,
  customer_cutoff_at timestamptz not null,
  status text not null default 'open' check (status in ('open','closed','archived')),
  preorder_mode text not null default 'pay_now' check (preorder_mode in ('pay_now','reserve','both')),
  source_filename text,
  source_sha256 text,
  source_row_count integer not null default 0 check (source_row_count >= 0),
  import_report jsonb not null default '{}'::jsonb,
  imported_by uuid references auth.users(id) on delete set null,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, distributor, foc_date)
);

create table if not exists public.comic_title_families (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  cycle_id uuid not null references public.foc_cycles(id) on delete cascade,
  distributor_family_id text not null,
  title text not null,
  series_name text,
  issue_number text,
  publisher text,
  imprint text,
  comic_type text,
  description text,
  writer text,
  interior_artist text,
  on_sale_date date,
  is_first_issue boolean not null default false,
  is_new_series boolean not null default false,
  heat smallint check (heat between 1 and 5),
  heat_category text check (heat_category is null or heat_category in ('dont_sleep','sleeper_watch','solid_stock','special_order','pass')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cycle_id, distributor_family_id)
);

create table if not exists public.comic_skus (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  cycle_id uuid not null references public.foc_cycles(id) on delete cascade,
  family_id uuid not null references public.comic_title_families(id) on delete cascade,
  distributor text not null default 'PRH',
  distributor_sku text not null,
  upc text not null,
  isbn text,
  title text not null,
  subtitle text,
  variant_label text,
  variant_type text,
  order_requirement text,
  order_requirement_upc text,
  ratio_threshold integer check (ratio_threshold is null or ratio_threshold > 0),
  is_incentive boolean not null default false,
  cover_artist text,
  cover_image_url text,
  cover_available boolean not null default false,
  writer text,
  interior_artist text,
  publisher text,
  imprint text,
  description text,
  foc_date date not null,
  on_sale_date date,
  msrp_cents integer not null default 0 check (msrp_cents >= 0),
  customer_price_cents integer not null default 0 check (customer_price_cents >= 0),
  store_quantity integer not null default 0 check (store_quantity >= 0),
  secured_quantity integer not null default 0 check (secured_quantity >= 0),
  qualification_override_total integer check (qualification_override_total is null or qualification_override_total >= 0),
  qualification_note text,
  customer_enabled boolean not null default true,
  raw_distributor_data jsonb not null default '{}'::jsonb,
  row_sha256 text,
  flags jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cycle_id, distributor_sku),
  constraint comic_skus_upc_exact check (upc ~ '^[0-9A-Za-z-]+$')
);

create table if not exists public.foc_preorder_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  store_id uuid not null references public.stores(id) on delete restrict,
  cycle_id uuid not null references public.foc_cycles(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'payment_pending' check (status in ('draft','payment_pending','paid','reserved','payment_failed','cancelled','refunded','partially_refunded','ready_for_pickup','shipped','completed')),
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
  cancellation_requested_at timestamptz,
  cancelled_at timestamptz,
  paid_at timestamptz,
  fulfilled_at timestamptz,
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.foc_preorder_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.foc_preorder_orders(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete restrict,
  cycle_id uuid not null references public.foc_cycles(id) on delete restrict,
  sku_id uuid not null references public.comic_skus(id) on delete restrict,
  quantity integer not null check (quantity between 1 and 50),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  line_total_cents integer generated always as (quantity * unit_price_cents) stored,
  status text not null default 'committed' check (status in ('committed','cancelled','refunded','ready_for_pickup','shipped','completed')),
  sku_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, sku_id)
);

create table if not exists public.foc_incentive_requests (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  cycle_id uuid not null references public.foc_cycles(id) on delete cascade,
  sku_id uuid not null references public.comic_skus(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  requested_quantity integer not null default 1 check (requested_quantity between 1 and 10),
  status text not null default 'waitlisted' check (status in ('waitlisted','offered','converted','declined','cancelled')),
  customer_note text,
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, sku_id)
);

create table if not exists public.foc_favorites (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  favorite_type text not null check (favorite_type in ('series','character','publisher','cover_artist','search')),
  favorite_value text not null,
  created_at timestamptz not null default now(),
  unique (store_id, user_id, favorite_type, favorite_value)
);

create table if not exists public.foc_pick_lists (
  id uuid primary key default gen_random_uuid(),
  public_token uuid not null default gen_random_uuid() unique,
  store_id uuid not null references public.stores(id) on delete cascade,
  cycle_id uuid not null references public.foc_cycles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'My FOC Picks',
  shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.foc_pick_list_items (
  id uuid primary key default gen_random_uuid(),
  pick_list_id uuid not null references public.foc_pick_lists(id) on delete cascade,
  sku_id uuid not null references public.comic_skus(id) on delete cascade,
  quantity integer not null default 1 check (quantity between 1 and 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pick_list_id, sku_id)
);

create index if not exists idx_foc_cycles_store_date on public.foc_cycles(store_id, foc_date desc);
create index if not exists idx_foc_cycles_cutoff on public.foc_cycles(store_id, customer_cutoff_at, status);
create index if not exists idx_comic_families_cycle_title on public.comic_title_families(cycle_id, title);
create index if not exists idx_comic_skus_cycle_family on public.comic_skus(cycle_id, family_id);
create index if not exists idx_comic_skus_cycle_publisher on public.comic_skus(cycle_id, publisher);
create index if not exists idx_comic_skus_cover_artist on public.comic_skus(cycle_id, cover_artist);
create index if not exists idx_comic_skus_upc on public.comic_skus(store_id, upc);
create index if not exists idx_foc_orders_user on public.foc_preorder_orders(user_id, created_at desc);
create index if not exists idx_foc_orders_cycle_status on public.foc_preorder_orders(cycle_id, status);
create index if not exists idx_foc_items_sku on public.foc_preorder_items(sku_id, status);
create index if not exists idx_foc_requests_sku on public.foc_incentive_requests(sku_id, status);
create index if not exists idx_foc_favorites_match on public.foc_favorites(store_id, favorite_type, lower(favorite_value));
create index if not exists idx_comic_families_store on public.comic_title_families(store_id);
create index if not exists idx_comic_skus_family on public.comic_skus(family_id);
create index if not exists idx_foc_cycles_imported_by on public.foc_cycles(imported_by);
create index if not exists idx_foc_favorites_user on public.foc_favorites(user_id);
create index if not exists idx_foc_requests_cycle on public.foc_incentive_requests(cycle_id);
create index if not exists idx_foc_requests_store on public.foc_incentive_requests(store_id);
create index if not exists idx_foc_pick_items_sku on public.foc_pick_list_items(sku_id);
create index if not exists idx_foc_pick_lists_cycle on public.foc_pick_lists(cycle_id);
create index if not exists idx_foc_pick_lists_store on public.foc_pick_lists(store_id);
create index if not exists idx_foc_pick_lists_user on public.foc_pick_lists(user_id);
create index if not exists idx_foc_items_cycle on public.foc_preorder_items(cycle_id);
create index if not exists idx_foc_items_store on public.foc_preorder_items(store_id);
create index if not exists idx_foc_orders_store on public.foc_preorder_orders(store_id);

drop trigger if exists foc_cycles_touch_updated_at on public.foc_cycles;
create trigger foc_cycles_touch_updated_at before update on public.foc_cycles for each row execute function public.foc_touch_updated_at();
drop trigger if exists foc_cycles_default_cutoff on public.foc_cycles;
create trigger foc_cycles_default_cutoff before insert or update of foc_date, customer_cutoff_at on public.foc_cycles for each row execute function public.foc_cycle_default_cutoff();
drop trigger if exists comic_title_families_touch_updated_at on public.comic_title_families;
create trigger comic_title_families_touch_updated_at before update on public.comic_title_families for each row execute function public.foc_touch_updated_at();
drop trigger if exists comic_skus_touch_updated_at on public.comic_skus;
create trigger comic_skus_touch_updated_at before update on public.comic_skus for each row execute function public.foc_touch_updated_at();
drop trigger if exists foc_preorder_orders_touch_updated_at on public.foc_preorder_orders;
create trigger foc_preorder_orders_touch_updated_at before update on public.foc_preorder_orders for each row execute function public.foc_touch_updated_at();
drop trigger if exists foc_preorder_items_touch_updated_at on public.foc_preorder_items;
create trigger foc_preorder_items_touch_updated_at before update on public.foc_preorder_items for each row execute function public.foc_touch_updated_at();
drop trigger if exists foc_incentive_requests_touch_updated_at on public.foc_incentive_requests;
create trigger foc_incentive_requests_touch_updated_at before update on public.foc_incentive_requests for each row execute function public.foc_touch_updated_at();
drop trigger if exists foc_pick_lists_touch_updated_at on public.foc_pick_lists;
create trigger foc_pick_lists_touch_updated_at before update on public.foc_pick_lists for each row execute function public.foc_touch_updated_at();
drop trigger if exists foc_pick_list_items_touch_updated_at on public.foc_pick_list_items;
create trigger foc_pick_list_items_touch_updated_at before update on public.foc_pick_list_items for each row execute function public.foc_touch_updated_at();

alter table public.foc_cycles enable row level security;
alter table public.comic_title_families enable row level security;
alter table public.comic_skus enable row level security;
alter table public.foc_preorder_orders enable row level security;
alter table public.foc_preorder_items enable row level security;
alter table public.foc_incentive_requests enable row level security;
alter table public.foc_favorites enable row level security;
alter table public.foc_pick_lists enable row level security;
alter table public.foc_pick_list_items enable row level security;

-- Catalog/admin records are managed by existing store roles. The public shop
-- reads them through the Worker service role, never through an anonymous table
-- grant, so raw distributor JSON and internal heat notes stay private.
create policy foc_cycles_staff_select on public.foc_cycles for select to authenticated
  using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
create policy foc_cycles_staff_insert on public.foc_cycles for insert to authenticated
  with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
create policy foc_cycles_staff_update on public.foc_cycles for update to authenticated
  using (public.current_store_role(store_id) in ('owner','admin','manager','employee'))
  with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));

create policy comic_title_families_staff_all on public.comic_title_families for all to authenticated
  using (public.current_store_role(store_id) in ('owner','admin','manager','employee'))
  with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
create policy comic_skus_staff_all on public.comic_skus for all to authenticated
  using (public.current_store_role(store_id) in ('owner','admin','manager','employee'))
  with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));

create policy foc_orders_customer_select on public.foc_preorder_orders for select to authenticated
  using (user_id = (select auth.uid()) or public.current_store_role(store_id) in ('owner','admin','manager','employee'));
create policy foc_orders_staff_update on public.foc_preorder_orders for update to authenticated
  using (public.current_store_role(store_id) in ('owner','admin','manager','employee'))
  with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));

create policy foc_items_customer_select on public.foc_preorder_items for select to authenticated
  using (
    exists (select 1 from public.foc_preorder_orders o where o.id = order_id and (o.user_id = (select auth.uid()) or public.current_store_role(o.store_id) in ('owner','admin','manager','employee')))
  );
create policy foc_items_staff_update on public.foc_preorder_items for update to authenticated
  using (public.current_store_role(store_id) in ('owner','admin','manager','employee'))
  with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));

create policy foc_requests_customer_select on public.foc_incentive_requests for select to authenticated
  using (user_id = (select auth.uid()) or public.current_store_role(store_id) in ('owner','admin','manager','employee'));
create policy foc_requests_customer_insert on public.foc_incentive_requests for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy foc_requests_customer_update on public.foc_incentive_requests for update to authenticated
  using (user_id = (select auth.uid()) or public.current_store_role(store_id) in ('owner','admin','manager','employee'))
  with check (user_id = (select auth.uid()) or public.current_store_role(store_id) in ('owner','admin','manager','employee'));

create policy foc_favorites_select on public.foc_favorites for select to authenticated
  using (user_id = (select auth.uid()) or public.current_store_role(store_id) in ('owner','admin','manager','employee'));
create policy foc_favorites_insert on public.foc_favorites for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy foc_favorites_update on public.foc_favorites for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy foc_favorites_delete on public.foc_favorites for delete to authenticated
  using (user_id = (select auth.uid()));

create policy foc_pick_lists_own_all on public.foc_pick_lists for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy foc_pick_list_items_own_all on public.foc_pick_list_items for all to authenticated
  using (exists (select 1 from public.foc_pick_lists p where p.id = pick_list_id and p.user_id = (select auth.uid())))
  with check (exists (select 1 from public.foc_pick_lists p where p.id = pick_list_id and p.user_id = (select auth.uid())));

revoke all on public.foc_cycles, public.comic_title_families, public.comic_skus,
  public.foc_preorder_orders, public.foc_preorder_items, public.foc_incentive_requests,
  public.foc_favorites, public.foc_pick_lists, public.foc_pick_list_items from anon;
grant select, insert, update on public.foc_cycles, public.comic_title_families, public.comic_skus to authenticated;
grant select, update on public.foc_preorder_orders, public.foc_preorder_items to authenticated;
grant select, insert, update on public.foc_incentive_requests to authenticated;
grant select, insert, update, delete on public.foc_favorites, public.foc_pick_lists, public.foc_pick_list_items to authenticated;
grant execute on function public.foc_default_customer_cutoff(date) to authenticated;

commit;
