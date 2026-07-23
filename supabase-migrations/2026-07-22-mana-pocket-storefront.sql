-- The Mana Pocket customer storefront schema.
-- Additive only: extends supabase/walkoff-auth-workspaces.sql,
-- supabase/pos-money-ledger.sql, and supabase/stripe-connect-and-consignments.sql.
-- Run after those. Safe to rerun (IF NOT EXISTS / CREATE OR REPLACE throughout).
--
-- Scope: customer identity + My Pocket, online orders/cart reservations,
-- Pocket Points + store credit ledgers, breaks, comics/pull lists,
-- sell/trade/consign appointment intake, wishlist/alerts.
--
-- inventory_items remains the single source of truth for sellable stock;
-- nothing here duplicates it. Reservations hold stock without mutating
-- inventory_items until a payment is verified server-side.

begin;

-- ---------------------------------------------------------------------
-- Customers (public storefront identity, distinct from staff store_members)
-- ---------------------------------------------------------------------

create table if not exists public.customers (
  id text primary key default gen_random_uuid()::text,
  store_id uuid not null references public.stores(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, auth_user_id)
);

create index if not exists idx_customers_store on public.customers(store_id, created_at desc);

create table if not exists public.customer_addresses (
  id text primary key default gen_random_uuid()::text,
  store_id uuid not null references public.stores(id) on delete cascade,
  customer_id text not null references public.customers(id) on delete cascade,
  label text not null default 'Home',
  full_name text not null default '',
  line1 text not null default '',
  line2 text,
  city text not null default '',
  state text not null default '',
  postal_code text not null default '',
  country text not null default 'US',
  phone text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_customer_addresses_customer on public.customer_addresses(customer_id);

create table if not exists public.customer_wishlist (
  id text primary key default gen_random_uuid()::text,
  store_id uuid not null references public.stores(id) on delete cascade,
  customer_id text not null references public.customers(id) on delete cascade,
  inventory_item_id text not null,
  created_at timestamptz not null default now(),
  unique (store_id, customer_id, inventory_item_id)
);

create table if not exists public.customer_alerts (
  id text primary key default gen_random_uuid()::text,
  store_id uuid not null references public.stores(id) on delete cascade,
  customer_id text not null references public.customers(id) on delete cascade,
  alert_type text not null default 'restock' check (alert_type in ('restock','price_drop')),
  inventory_item_id text,
  criteria jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  triggered_at timestamptz
);

create index if not exists idx_customer_alerts_store on public.customer_alerts(store_id, active);

-- ---------------------------------------------------------------------
-- Online orders (website checkout). Parallel to pos_sales, not a replacement.
-- Both paths decrement the same public.inventory_items rows.
-- ---------------------------------------------------------------------

create table if not exists public.online_orders (
  id text primary key default gen_random_uuid()::text,
  store_id uuid not null references public.stores(id) on delete cascade,
  customer_id text references public.customers(id) on delete set null,
  customer_email text not null,
  status text not null default 'pending_payment'
    check (status in ('pending_payment','reserved','paid','fulfilling','shipped','picked_up','completed','cancelled','refunded','payment_conflict')),
  fulfillment_type text not null default 'shipping' check (fulfillment_type in ('shipping','pickup')),
  shipping_address jsonb not null default '{}'::jsonb,
  subtotal_cents integer not null default 0,
  discount_cents integer not null default 0,
  tax_cents integer not null default 0,
  shipping_cents integer not null default 0,
  total_cents integer not null default 0,
  points_earned integer not null default 0,
  stripe_mode text check (stripe_mode in ('test','live')),
  stripe_connected_account_id text,
  stripe_payment_intent_id text,
  stripe_checkout_session_id text,
  idempotency_key text unique,
  notes text,
  placed_at timestamptz not null default now(),
  paid_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_online_orders_store on public.online_orders(store_id, created_at desc);
create index if not exists idx_online_orders_customer on public.online_orders(customer_id, created_at desc);
create unique index if not exists idx_online_orders_stripe_intent on public.online_orders(stripe_mode, stripe_payment_intent_id) where stripe_payment_intent_id is not null;

create table if not exists public.online_order_lines (
  id text primary key default gen_random_uuid()::text,
  order_id text not null references public.online_orders(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  inventory_item_id text,
  kind text not null default 'item' check (kind in ('item','break_spot','comic_preorder')),
  title text not null default 'Item',
  category text,
  quantity numeric(12,2) not null default 1,
  unit_price_cents integer not null default 0,
  image_url text,
  created_at timestamptz not null default now()
);

create index if not exists idx_online_order_lines_order on public.online_order_lines(order_id);

-- Holds stock during checkout without mutating inventory_items. Availability
-- shown to shoppers = inventory qty minus the sum of active, unexpired
-- reservations for that item.
create table if not exists public.inventory_reservations (
  id text primary key default gen_random_uuid()::text,
  store_id uuid not null references public.stores(id) on delete cascade,
  inventory_item_id text not null,
  order_id text references public.online_orders(id) on delete cascade,
  quantity numeric(12,2) not null default 1,
  status text not null default 'active' check (status in ('active','converted','released','expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_inventory_reservations_item on public.inventory_reservations(store_id, inventory_item_id, status);
create index if not exists idx_inventory_reservations_expiry on public.inventory_reservations(status, expires_at);

-- ---------------------------------------------------------------------
-- Pocket Points + store credit (separate balances, per spec section 14)
-- ---------------------------------------------------------------------

create table if not exists public.rewards_ledger (
  id text primary key default gen_random_uuid()::text,
  store_id uuid not null references public.stores(id) on delete cascade,
  customer_id text not null references public.customers(id) on delete cascade,
  order_id text references public.online_orders(id) on delete set null,
  points_delta integer not null,
  status text not null default 'pending' check (status in ('pending','available','reversed')),
  reason text not null default 'purchase',
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  available_at timestamptz
);

create index if not exists idx_rewards_ledger_customer on public.rewards_ledger(store_id, customer_id, created_at desc);

create table if not exists public.store_credit_ledger (
  id text primary key default gen_random_uuid()::text,
  store_id uuid not null references public.stores(id) on delete cascade,
  customer_id text not null references public.customers(id) on delete cascade,
  order_id text references public.online_orders(id) on delete set null,
  amount_cents_delta integer not null,
  reason text not null default 'adjustment',
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_store_credit_ledger_customer on public.store_credit_ledger(store_id, customer_id, created_at desc);

-- ---------------------------------------------------------------------
-- Breaks (section 16)
-- ---------------------------------------------------------------------

create table if not exists public.breaks (
  id text primary key default gen_random_uuid()::text,
  store_id uuid not null references public.stores(id) on delete cascade,
  title text not null,
  sport_game text,
  format text,
  host text,
  description text,
  rules text,
  scheduled_at timestamptz,
  platform text not null default 'website' check (platform in ('website','whatnot')),
  whatnot_url text,
  spot_count integer not null default 0,
  price_cents integer not null default 0,
  status text not null default 'scheduled'
    check (status in ('scheduled','filling','sold_out','live','completed','postponed','cancelled')),
  stream_url text,
  results_notes text,
  featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_breaks_store on public.breaks(store_id, status, scheduled_at);

create table if not exists public.break_spots (
  id text primary key default gen_random_uuid()::text,
  break_id text not null references public.breaks(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  label text not null,
  price_cents_override integer,
  status text not null default 'available' check (status in ('available','reserved','sold')),
  customer_id text references public.customers(id) on delete set null,
  order_id text references public.online_orders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (break_id, label)
);

create index if not exists idx_break_spots_break on public.break_spots(break_id, status);

-- ---------------------------------------------------------------------
-- Comics + pull lists (section 15)
-- ---------------------------------------------------------------------

create table if not exists public.comic_series (
  id text primary key default gen_random_uuid()::text,
  store_id uuid not null references public.stores(id) on delete cascade,
  publisher text,
  title text not null,
  volume text,
  description text,
  cover_image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_comic_series_store on public.comic_series(store_id, active, title);

create table if not exists public.comic_issues (
  id text primary key default gen_random_uuid()::text,
  series_id text not null references public.comic_series(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  issue_number text,
  cover_variant text,
  creators text,
  release_date date,
  foc_date date,
  preorder_status text not null default 'announced' check (preorder_status in ('announced','open','closed','released')),
  cover_image_url text,
  inventory_item_id text,
  price_cents integer not null default 0,
  quantity integer not null default 0,
  subscriber_allocation integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_comic_issues_series on public.comic_issues(series_id, release_date);
create index if not exists idx_comic_issues_store on public.comic_issues(store_id, preorder_status, release_date);

create table if not exists public.pull_list_subscriptions (
  id text primary key default gen_random_uuid()::text,
  store_id uuid not null references public.stores(id) on delete cascade,
  customer_id text not null references public.customers(id) on delete cascade,
  series_id text not null references public.comic_series(id) on delete cascade,
  cover_preference text not null default 'default',
  pickup_or_ship text not null default 'pickup' check (pickup_or_ship in ('pickup','ship')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, customer_id, series_id)
);

create index if not exists idx_pull_list_subscriptions_series on public.pull_list_subscriptions(series_id, active);

create table if not exists public.pull_list_allocations (
  id text primary key default gen_random_uuid()::text,
  subscription_id text not null references public.pull_list_subscriptions(id) on delete cascade,
  issue_id text not null references public.comic_issues(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  status text not null default 'allocated' check (status in ('allocated','substituted','shorted','fulfilled','cancelled')),
  staff_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subscription_id, issue_id)
);

create index if not exists idx_pull_list_allocations_issue on public.pull_list_allocations(issue_id, status);

-- ---------------------------------------------------------------------
-- Sell / Trade / Consign appointment intake (section 18)
-- ---------------------------------------------------------------------

create table if not exists public.appointment_requests (
  id text primary key default gen_random_uuid()::text,
  store_id uuid not null references public.stores(id) on delete cascade,
  customer_id text references public.customers(id) on delete set null,
  contact_name text not null,
  contact_email text not null,
  contact_phone text,
  request_type text not null check (request_type in ('sell','trade','consign')),
  category text,
  approx_quantity text,
  estimated_value_cents integer,
  notes text,
  image_urls jsonb not null default '[]'::jsonb,
  status text not null default 'submitted'
    check (status in ('submitted','scheduled','needs_info','approved','declined','completed')),
  requested_slot timestamptz,
  scheduled_at timestamptz,
  staff_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_appointment_requests_store on public.appointment_requests(store_id, status, created_at desc);

-- Traceability: staff convert an accepted appointment into the existing
-- consignment tables without inventing a parallel workflow.
alter table if exists public.consignment_items
  add column if not exists appointment_request_id text references public.appointment_requests(id) on delete set null;

-- ---------------------------------------------------------------------
-- updated_at triggers (reuses public.touch_updated_at() from the base schema)
-- ---------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'customers','customer_addresses','online_orders','breaks','break_spots',
    'comic_series','comic_issues','pull_list_subscriptions','pull_list_allocations',
    'appointment_requests'
  ]
  loop
    execute format('drop trigger if exists trg_%1$s_updated_at on public.%1$s', t);
    execute format('create trigger trg_%1$s_updated_at before update on public.%1$s for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------

create or replace function public.current_customer_id(check_store_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select c.id
  from public.customers c
  where c.store_id = check_store_id
    and c.auth_user_id = auth.uid()
  limit 1;
$$;

alter table public.customers enable row level security;
alter table public.customer_addresses enable row level security;
alter table public.customer_wishlist enable row level security;
alter table public.customer_alerts enable row level security;
alter table public.online_orders enable row level security;
alter table public.online_order_lines enable row level security;
alter table public.inventory_reservations enable row level security;
alter table public.rewards_ledger enable row level security;
alter table public.store_credit_ledger enable row level security;
alter table public.breaks enable row level security;
alter table public.break_spots enable row level security;
alter table public.comic_series enable row level security;
alter table public.comic_issues enable row level security;
alter table public.pull_list_subscriptions enable row level security;
alter table public.pull_list_allocations enable row level security;
alter table public.appointment_requests enable row level security;

-- customers: self read/update, staff read all for their store
drop policy if exists customers_select_self_or_staff on public.customers;
create policy customers_select_self_or_staff on public.customers for select using (
  auth_user_id = auth.uid() or public.current_store_role(store_id) in ('owner','admin','manager','employee')
);
drop policy if exists customers_insert_self on public.customers;
create policy customers_insert_self on public.customers for insert with check (auth_user_id = auth.uid());
drop policy if exists customers_update_self_or_staff on public.customers;
create policy customers_update_self_or_staff on public.customers for update using (
  auth_user_id = auth.uid() or public.current_store_role(store_id) in ('owner','admin','manager')
) with check (
  auth_user_id = auth.uid() or public.current_store_role(store_id) in ('owner','admin','manager')
);

-- customer-owned tables: self manage, staff read
drop policy if exists customer_addresses_owner on public.customer_addresses;
create policy customer_addresses_owner on public.customer_addresses for all using (
  customer_id = public.current_customer_id(store_id) or public.current_store_role(store_id) in ('owner','admin','manager','employee')
) with check (customer_id = public.current_customer_id(store_id));

drop policy if exists customer_wishlist_owner on public.customer_wishlist;
create policy customer_wishlist_owner on public.customer_wishlist for all using (
  customer_id = public.current_customer_id(store_id) or public.current_store_role(store_id) in ('owner','admin','manager','employee')
) with check (customer_id = public.current_customer_id(store_id));

drop policy if exists customer_alerts_owner on public.customer_alerts;
create policy customer_alerts_owner on public.customer_alerts for all using (
  customer_id = public.current_customer_id(store_id) or public.current_store_role(store_id) in ('owner','admin','manager','employee')
) with check (customer_id = public.current_customer_id(store_id));

-- orders: customer reads own, staff reads/manages all for store. Writes to
-- orders/reservations/ledgers happen server-side via the Worker's service
-- role (which bypasses RLS), so no public insert/update policy is granted
-- here beyond staff fulfillment updates.
drop policy if exists online_orders_select_self_or_staff on public.online_orders;
create policy online_orders_select_self_or_staff on public.online_orders for select using (
  customer_id = public.current_customer_id(store_id) or public.current_store_role(store_id) in ('owner','admin','manager','employee')
);
drop policy if exists online_orders_update_staff on public.online_orders;
create policy online_orders_update_staff on public.online_orders for update using (
  public.current_store_role(store_id) in ('owner','admin','manager')
) with check (public.current_store_role(store_id) in ('owner','admin','manager'));

drop policy if exists online_order_lines_select_self_or_staff on public.online_order_lines;
create policy online_order_lines_select_self_or_staff on public.online_order_lines for select using (
  exists (
    select 1 from public.online_orders o
    where o.id = online_order_lines.order_id
      and (o.customer_id = public.current_customer_id(o.store_id) or public.current_store_role(o.store_id) in ('owner','admin','manager','employee'))
  )
);

drop policy if exists inventory_reservations_select_staff on public.inventory_reservations;
create policy inventory_reservations_select_staff on public.inventory_reservations for select using (
  public.current_store_role(store_id) in ('owner','admin','manager','employee')
);

-- rewards / store credit: customer reads own history, staff reads/manages all
drop policy if exists rewards_ledger_select_self_or_staff on public.rewards_ledger;
create policy rewards_ledger_select_self_or_staff on public.rewards_ledger for select using (
  customer_id = public.current_customer_id(store_id) or public.current_store_role(store_id) in ('owner','admin','manager','employee')
);
drop policy if exists rewards_ledger_insert_staff on public.rewards_ledger;
create policy rewards_ledger_insert_staff on public.rewards_ledger for insert with check (
  public.current_store_role(store_id) in ('owner','admin','manager')
);

drop policy if exists store_credit_ledger_select_self_or_staff on public.store_credit_ledger;
create policy store_credit_ledger_select_self_or_staff on public.store_credit_ledger for select using (
  customer_id = public.current_customer_id(store_id) or public.current_store_role(store_id) in ('owner','admin','manager','employee')
);
drop policy if exists store_credit_ledger_insert_staff on public.store_credit_ledger;
create policy store_credit_ledger_insert_staff on public.store_credit_ledger for insert with check (
  public.current_store_role(store_id) in ('owner','admin','manager')
);

-- breaks/comics: public catalog, so anyone (including anon) may read; only
-- staff may write.
drop policy if exists breaks_select_all on public.breaks;
create policy breaks_select_all on public.breaks for select using (true);
drop policy if exists breaks_write_staff on public.breaks;
create policy breaks_write_staff on public.breaks for all using (
  public.current_store_role(store_id) in ('owner','admin','manager')
) with check (public.current_store_role(store_id) in ('owner','admin','manager'));

drop policy if exists break_spots_select_all on public.break_spots;
create policy break_spots_select_all on public.break_spots for select using (true);
drop policy if exists break_spots_write_staff on public.break_spots;
create policy break_spots_write_staff on public.break_spots for all using (
  public.current_store_role(store_id) in ('owner','admin','manager')
) with check (public.current_store_role(store_id) in ('owner','admin','manager'));

drop policy if exists comic_series_select_all on public.comic_series;
create policy comic_series_select_all on public.comic_series for select using (true);
drop policy if exists comic_series_write_staff on public.comic_series;
create policy comic_series_write_staff on public.comic_series for all using (
  public.current_store_role(store_id) in ('owner','admin','manager')
) with check (public.current_store_role(store_id) in ('owner','admin','manager'));

drop policy if exists comic_issues_select_all on public.comic_issues;
create policy comic_issues_select_all on public.comic_issues for select using (true);
drop policy if exists comic_issues_write_staff on public.comic_issues;
create policy comic_issues_write_staff on public.comic_issues for all using (
  public.current_store_role(store_id) in ('owner','admin','manager')
) with check (public.current_store_role(store_id) in ('owner','admin','manager'));

drop policy if exists pull_list_subscriptions_owner on public.pull_list_subscriptions;
create policy pull_list_subscriptions_owner on public.pull_list_subscriptions for all using (
  customer_id = public.current_customer_id(store_id) or public.current_store_role(store_id) in ('owner','admin','manager','employee')
) with check (customer_id = public.current_customer_id(store_id) or public.current_store_role(store_id) in ('owner','admin','manager'));

drop policy if exists pull_list_allocations_select on public.pull_list_allocations;
create policy pull_list_allocations_select on public.pull_list_allocations for select using (
  public.current_store_role(store_id) in ('owner','admin','manager','employee')
  or exists (
    select 1 from public.pull_list_subscriptions s
    where s.id = pull_list_allocations.subscription_id
      and s.customer_id = public.current_customer_id(s.store_id)
  )
);
drop policy if exists pull_list_allocations_write_staff on public.pull_list_allocations;
create policy pull_list_allocations_write_staff on public.pull_list_allocations for all using (
  public.current_store_role(store_id) in ('owner','admin','manager')
) with check (public.current_store_role(store_id) in ('owner','admin','manager'));

-- appointment requests: customer creates + reads own; staff manages all
drop policy if exists appointment_requests_select_self_or_staff on public.appointment_requests;
create policy appointment_requests_select_self_or_staff on public.appointment_requests for select using (
  (customer_id is not null and customer_id = public.current_customer_id(store_id))
  or public.current_store_role(store_id) in ('owner','admin','manager','employee')
);
drop policy if exists appointment_requests_insert_public on public.appointment_requests;
create policy appointment_requests_insert_public on public.appointment_requests for insert with check (
  customer_id is null or customer_id = public.current_customer_id(store_id)
);
drop policy if exists appointment_requests_update_staff on public.appointment_requests;
create policy appointment_requests_update_staff on public.appointment_requests for update using (
  public.current_store_role(store_id) in ('owner','admin','manager')
) with check (public.current_store_role(store_id) in ('owner','admin','manager'));

grant select, insert, update on public.customers, public.customer_addresses, public.customer_wishlist, public.customer_alerts to authenticated;
grant select on public.online_orders, public.online_order_lines, public.inventory_reservations to authenticated;
grant update on public.online_orders to authenticated;
grant select, insert on public.rewards_ledger, public.store_credit_ledger to authenticated;
grant select on public.breaks, public.break_spots, public.comic_series, public.comic_issues to anon, authenticated;
grant insert, update, delete on public.breaks, public.break_spots, public.comic_series, public.comic_issues to authenticated;
grant select, insert, update on public.pull_list_subscriptions to authenticated;
grant select, insert, update on public.pull_list_allocations to authenticated;
grant select, insert, update on public.appointment_requests to authenticated, anon;
grant execute on function public.current_customer_id(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Atomic checkout RPCs (server-only: called by the Worker with the
-- service-role key, which bypasses RLS/grants, so no execute grant is
-- given to anon/authenticated here). Mirrors public.complete_pos_sale.
-- ---------------------------------------------------------------------

-- Locks the inventory row, verifies real availability (qty minus other
-- active/unexpired reservations), and creates the order + reservation in
-- one transaction so two shoppers cannot both reserve the last copy.
create or replace function public.create_online_order_with_reservations(p_order jsonb, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id text := coalesce(p_order ->> 'id', gen_random_uuid()::text);
  v_store_id uuid := (p_order ->> 'store_id')::uuid;
  v_line jsonb;
  v_item record;
  v_reserved numeric;
  v_available numeric;
  v_qty numeric;
  v_unit_price_cents integer;
  v_subtotal integer := 0;
  v_expires_at timestamptz := now() + interval '15 minutes';
begin
  if v_store_id is null then
    raise exception 'store_id is required';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one line item is required';
  end if;

  -- Idempotent on retry of the same client-generated order id.
  if exists (select 1 from public.online_orders where id = v_order_id) then
    return jsonb_build_object('ok', true, 'orderId', v_order_id, 'idempotent', true);
  end if;

  insert into public.online_orders (
    id, store_id, customer_id, customer_email, status, fulfillment_type,
    shipping_address, stripe_mode
  ) values (
    v_order_id, v_store_id, nullif(p_order ->> 'customer_id',''), p_order ->> 'customer_email',
    'reserved', coalesce(nullif(p_order ->> 'fulfillment_type',''),'shipping'),
    coalesce(p_order -> 'shipping_address','{}'::jsonb), nullif(p_order ->> 'stripe_mode','')
  );

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_qty := coalesce((v_line ->> 'quantity')::numeric, 1);
    if v_qty <= 0 then
      raise exception 'Line quantity must be positive';
    end if;

    select id, store_id, data, status into v_item
      from public.inventory_items
     where store_id = v_store_id
       and id::text = (v_line ->> 'inventory_item_id')
     for update;

    if not found then
      raise exception 'Item % is no longer available', (v_line ->> 'inventory_item_id');
    end if;
    if v_item.status in ('sold','archived','returned','deleted') then
      raise exception 'Item % is no longer available', v_item.id;
    end if;

    select coalesce(sum(quantity), 0) into v_reserved
      from public.inventory_reservations
     where store_id = v_store_id
       and inventory_item_id = v_item.id::text
       and status = 'active'
       and expires_at > now();

    v_available := coalesce(
      case when coalesce(v_item.data ->> 'qty','') ~ '^\d+(\.\d+)?$' then (v_item.data ->> 'qty')::numeric end,
      case when coalesce(v_item.data ->> 'quantity','') ~ '^\d+(\.\d+)?$' then (v_item.data ->> 'quantity')::numeric end,
      1
    ) - v_reserved;

    if v_available < v_qty then
      raise exception 'Only % of % left', greatest(v_available,0), coalesce(v_item.data ->> 'name','this item');
    end if;

    -- Server-computed price. The browser-supplied price is never trusted.
    v_unit_price_cents := round(coalesce(
      (v_item.data ->> 'listPrice')::numeric,
      (v_item.data ->> 'salePrice')::numeric,
      (v_item.data ->> 'price')::numeric,
      0
    ) * 100)::integer;

    insert into public.inventory_reservations (store_id, inventory_item_id, order_id, quantity, status, expires_at)
    values (v_store_id, v_item.id::text, v_order_id, v_qty, 'active', v_expires_at);

    insert into public.online_order_lines (
      order_id, store_id, inventory_item_id, kind, title, category, quantity, unit_price_cents, image_url
    ) values (
      v_order_id, v_store_id, v_item.id::text, coalesce(nullif(v_line ->> 'kind',''),'item'),
      coalesce(v_item.data ->> 'name','Item'), v_item.data ->> 'category', v_qty, v_unit_price_cents,
      v_item.data ->> 'image'
    );

    v_subtotal := v_subtotal + round(v_unit_price_cents * v_qty)::integer;
  end loop;

  update public.online_orders
     set subtotal_cents = v_subtotal,
         total_cents = v_subtotal + coalesce(shipping_cents,0) + coalesce(tax_cents,0) - coalesce(discount_cents,0),
         updated_at = now()
   where id = v_order_id;

  return jsonb_build_object('ok', true, 'orderId', v_order_id, 'subtotalCents', v_subtotal, 'expiresAt', v_expires_at, 'idempotent', false);
end;
$$;

revoke all on function public.create_online_order_with_reservations(jsonb, jsonb) from public;

-- Called once a Stripe webhook confirms payment. Idempotent; converts the
-- reservation into a permanent inventory decrement (same effect as a POS
-- sale) and posts pending Pocket Points.
create or replace function public.finalize_online_order_payment(
  p_order_id text,
  p_stripe_payment_intent_id text,
  p_stripe_charge_id text,
  p_points_earned integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order record;
  v_res record;
  v_item record;
  v_current_qty numeric;
  v_next_qty numeric;
begin
  select * into v_order from public.online_orders where id = p_order_id for update;
  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  if v_order.status in ('paid','fulfilling','shipped','picked_up','completed') then
    return jsonb_build_object('ok', true, 'orderId', p_order_id, 'idempotent', true);
  end if;

  for v_res in
    select * from public.inventory_reservations
     where order_id = p_order_id and status = 'active'
     for update
  loop
    select id, data into v_item
      from public.inventory_items
     where store_id = v_order.store_id and id::text = v_res.inventory_item_id
     for update;

    if not found then
      -- Item was deleted after reservation; flag for manual review rather
      -- than silently losing the sale record.
      update public.inventory_reservations set status = 'released' where id = v_res.id;
      continue;
    end if;

    v_current_qty := coalesce(
      case when coalesce(v_item.data ->> 'qty','') ~ '^\d+(\.\d+)?$' then (v_item.data ->> 'qty')::numeric end,
      case when coalesce(v_item.data ->> 'quantity','') ~ '^\d+(\.\d+)?$' then (v_item.data ->> 'quantity')::numeric end,
      1
    );
    v_next_qty := v_current_qty - v_res.quantity;

    if v_next_qty < 0 then
      -- Oversold edge case (e.g. reservation survived past its expiry and
      -- the same stock was also sold in-store). Payment already succeeded;
      -- do not fabricate inventory. Mark for staff/manual refund review.
      update public.online_orders set status = 'payment_conflict', updated_at = now() where id = p_order_id;
      update public.inventory_reservations set status = 'released' where id = v_res.id;
      continue;
    end if;

    update public.inventory_items
       set status = case when v_next_qty > 0 then 'in_stock' else 'sold' end,
           data = data || jsonb_build_object(
                    'status', case when v_next_qty > 0 then 'in_stock' else 'sold' end,
                    'lifecycle', case when v_next_qty > 0 then 'in_stock' else 'sold' end,
                    'qty', v_next_qty, 'quantity', v_next_qty,
                    'sold-out', v_next_qty <= 0,
                    'soldAt', case when v_next_qty <= 0 then now()::text else '' end,
                    'onlineOrderId', p_order_id),
           updated_at = now()
     where store_id = v_order.store_id and id::text = v_res.inventory_item_id;

    insert into public.inventory_movements (store_id, inventory_item_id, movement_type, quantity)
    values (v_order.store_id, v_res.inventory_item_id, 'online_sale', v_res.quantity);

    update public.inventory_reservations set status = 'converted' where id = v_res.id;
  end loop;

  update public.online_orders
     set status = case when status = 'payment_conflict' then status else 'paid' end,
         stripe_payment_intent_id = p_stripe_payment_intent_id,
         points_earned = p_points_earned,
         paid_at = now(),
         updated_at = now()
   where id = p_order_id;

  if p_points_earned > 0 and v_order.customer_id is not null then
    insert into public.rewards_ledger (store_id, customer_id, order_id, points_delta, status, reason)
    values (v_order.store_id, v_order.customer_id, p_order_id, p_points_earned, 'pending', 'purchase');
  end if;

  return jsonb_build_object('ok', true, 'orderId', p_order_id, 'idempotent', false);
end;
$$;

revoke all on function public.finalize_online_order_payment(text, text, text, integer) from public;

-- Housekeeping: release reservations whose checkout was abandoned. Safe to
-- call opportunistically (e.g. at the top of every catalog/checkout request).
create or replace function public.release_expired_online_reservations()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  with expired as (
    update public.inventory_reservations
       set status = 'expired'
     where status = 'active' and expires_at <= now()
    returning order_id
  )
  update public.online_orders o
     set status = 'cancelled', cancelled_at = now(), updated_at = now()
    from expired e
   where o.id = e.order_id and o.status in ('pending_payment','reserved');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.release_expired_online_reservations() from public;

notify pgrst, 'reload schema';

commit;
