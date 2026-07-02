-- ArSca store-scoped consignments + Stripe Connect payment foundation.
-- Run after walkoff-auth-workspaces.sql and pos-money-ledger.sql.

create table if not exists public.consignor_people (
  id text primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  contact text not null default '',
  store_split_percent numeric(5,2) not null default 25 check (store_split_percent between 0 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists consignor_people_store_name
  on public.consignor_people(store_id, lower(name));

create table if not exists public.consignment_items (
  id text primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  consignor_id text references public.consignor_people(id) on delete set null,
  inventory_item_id text,
  item_name text not null,
  owner_name text not null,
  contact text not null default '',
  list_price numeric(12,2) not null default 0,
  store_split_percent numeric(5,2) not null default 25 check (store_split_percent between 0 and 100),
  cost_basis numeric(12,2) not null default 0,
  market_value numeric(12,2) not null default 0,
  inventory_sku text not null default '',
  notes text not null default '',
  expires_on date,
  status text not null default 'active' check (status in ('active','sold','returned','archived')),
  sale_id text references public.pos_sales(id) on delete set null,
  sale_price numeric(12,2),
  paid_out boolean not null default false,
  added_at timestamptz not null default now(),
  sold_at timestamptz,
  returned_at timestamptz,
  paid_out_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.consignment_alerts (
  id text primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  consignment_id text not null references public.consignment_items(id) on delete cascade,
  inventory_item_id text,
  sale_id text references public.pos_sales(id) on delete set null,
  owner_name text not null,
  item_name text not null,
  sale_price numeric(12,2) not null default 0,
  store_cut numeric(12,2) not null default 0,
  owner_payout numeric(12,2) not null default 0,
  source text not null default 'sale',
  status text not null default 'open' check (status in ('open','settled','dismissed')),
  sold_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.store_stripe_accounts (
  store_id uuid not null references public.stores(id) on delete cascade,
  mode text not null check (mode in ('test','live')),
  connected_account_id text not null,
  account_type text,
  fee_payer text,
  fee_payer_verified boolean not null default false,
  details_submitted boolean not null default false,
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  onboarding_status text not null default 'not_started',
  requirements_currently_due jsonb not null default '[]'::jsonb,
  requirements_eventually_due jsonb not null default '[]'::jsonb,
  requirements_past_due jsonb not null default '[]'::jsonb,
  disabled_reason text not null default '',
  last_refreshed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (store_id, mode),
  unique (mode, connected_account_id)
);

alter table public.pos_payments
  add column if not exists provider text,
  add column if not exists stripe_mode text,
  add column if not exists stripe_connected_account_id text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_charge_id text,
  add column if not exists currency text not null default 'usd',
  add column if not exists amount_cents integer,
  add column if not exists application_fee_amount_cents integer not null default 0,
  add column if not exists processing_fee_paid_by text,
  add column if not exists card_brand text,
  add column if not exists card_last4 text,
  add column if not exists refunded_amount_cents integer not null default 0,
  add column if not exists provider_metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

alter table public.pos_sales
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists refund_total_cents integer not null default 0,
  add column if not exists refundable_remaining_cents integer not null default 0,
  add column if not exists inventory_restock_status text;

create table if not exists public.pos_refunds (
  id text primary key default gen_random_uuid()::text,
  store_id uuid not null references public.stores(id) on delete cascade,
  sale_id text not null references public.pos_sales(id) on delete cascade,
  payment_id text not null references public.pos_payments(id) on delete cascade,
  provider text not null default 'stripe',
  stripe_refund_id text unique,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  stripe_connected_account_id text,
  stripe_mode text not null check (stripe_mode in ('test','live')),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd',
  reason text,
  internal_note text,
  status text not null default 'pending',
  refund_application_fee boolean not null default true,
  application_fee_refund_amount_cents integer not null default 0,
  restock_mode text not null default 'no_restock',
  line_item_ids jsonb not null default '[]'::jsonb,
  restock_completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  failure_reason text not null default '',
  stripe_reference text not null default '',
  idempotency_key text not null unique
);

create table if not exists public.inventory_movements (
  id text primary key default gen_random_uuid()::text,
  store_id uuid not null references public.stores(id) on delete cascade,
  inventory_item_id text not null,
  sale_id text references public.pos_sales(id) on delete set null,
  refund_id text references public.pos_refunds(id) on delete set null,
  sale_line_id text references public.pos_sale_lines(id) on delete set null,
  movement_type text not null,
  quantity numeric(12,2) not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (refund_id, sale_line_id, movement_type)
);

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  mode text not null check (mode in ('test','live')),
  event_type text not null,
  connected_account_id text,
  status text not null default 'processing',
  processed_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists consignment_items_store_status on public.consignment_items(store_id, status, updated_at desc);
create index if not exists consignment_alerts_store_status on public.consignment_alerts(store_id, status, created_at desc);
create index if not exists pos_refunds_store_sale on public.pos_refunds(store_id, sale_id, created_at desc);
create index if not exists inventory_movements_store_item on public.inventory_movements(store_id, inventory_item_id, created_at desc);
create unique index if not exists pos_payments_stripe_intent on public.pos_payments(stripe_mode, stripe_connected_account_id, stripe_payment_intent_id) where stripe_payment_intent_id is not null;

alter table public.consignor_people enable row level security;
alter table public.consignment_items enable row level security;
alter table public.consignment_alerts enable row level security;
alter table public.store_stripe_accounts enable row level security;
alter table public.pos_refunds enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.stripe_webhook_events enable row level security;

drop policy if exists consignor_people_member_select on public.consignor_people;
drop policy if exists consignor_people_manager_insert on public.consignor_people;
drop policy if exists consignor_people_manager_update on public.consignor_people;
drop policy if exists consignor_people_owner_delete on public.consignor_people;
create policy consignor_people_member_select on public.consignor_people for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
create policy consignor_people_manager_insert on public.consignor_people for insert with check (public.current_store_role(store_id) in ('owner','admin','manager'));
create policy consignor_people_manager_update on public.consignor_people for update using (public.current_store_role(store_id) in ('owner','admin','manager')) with check (public.current_store_role(store_id) in ('owner','admin','manager'));
create policy consignor_people_owner_delete on public.consignor_people for delete using (public.current_store_role(store_id) in ('owner','admin'));

drop policy if exists consignment_items_member_select on public.consignment_items;
drop policy if exists consignment_items_manager_insert on public.consignment_items;
drop policy if exists consignment_items_manager_update on public.consignment_items;
drop policy if exists consignment_items_owner_delete on public.consignment_items;
create policy consignment_items_member_select on public.consignment_items for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
create policy consignment_items_manager_insert on public.consignment_items for insert with check (public.current_store_role(store_id) in ('owner','admin','manager'));
create policy consignment_items_manager_update on public.consignment_items for update using (public.current_store_role(store_id) in ('owner','admin','manager')) with check (public.current_store_role(store_id) in ('owner','admin','manager'));
create policy consignment_items_owner_delete on public.consignment_items for delete using (public.current_store_role(store_id) in ('owner','admin'));

drop policy if exists consignment_alerts_member_select on public.consignment_alerts;
drop policy if exists consignment_alerts_manager_insert on public.consignment_alerts;
drop policy if exists consignment_alerts_manager_update on public.consignment_alerts;
create policy consignment_alerts_member_select on public.consignment_alerts for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
create policy consignment_alerts_manager_insert on public.consignment_alerts for insert with check (public.current_store_role(store_id) in ('owner','admin','manager'));
create policy consignment_alerts_manager_update on public.consignment_alerts for update using (public.current_store_role(store_id) in ('owner','admin','manager')) with check (public.current_store_role(store_id) in ('owner','admin','manager'));

drop policy if exists stripe_accounts_owner_select on public.store_stripe_accounts;
drop policy if exists refunds_member_select on public.pos_refunds;
drop policy if exists movements_member_select on public.inventory_movements;
create policy stripe_accounts_owner_select on public.store_stripe_accounts for select using (public.current_store_role(store_id) in ('owner','admin'));
create policy refunds_member_select on public.pos_refunds for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
create policy movements_member_select on public.inventory_movements for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));

grant select, insert, update, delete on public.consignor_people, public.consignment_items to authenticated;
grant select, insert, update on public.consignment_alerts to authenticated;
grant select on public.store_stripe_accounts, public.pos_refunds, public.inventory_movements to authenticated;
