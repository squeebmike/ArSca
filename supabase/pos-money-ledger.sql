-- Walk-Off POS money ledger.
-- Run after walkoff-auth-workspaces.sql.

create table if not exists public.pos_sales (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  show_session_id text,
  drawer_session_id uuid,
  checkout_snapshot_id uuid,
  subtotal numeric(12,2) not null default 0,
  discount_total numeric(12,2) not null default 0,
  tax_total numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  status text not null default 'completed',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.pos_sale_lines (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.pos_sales(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  item_id text,
  title text not null,
  category text,
  quantity numeric(12,2) not null default 1,
  unit_price numeric(12,2) not null default 0,
  original_price numeric(12,2) not null default 0,
  adjusted_price numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  cost_basis numeric(12,2) not null default 0,
  profit numeric(12,2) not null default 0,
  condition text,
  finish text,
  source_id text,
  image_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.pos_payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.pos_sales(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  drawer_session_id uuid,
  method text not null,
  amount numeric(12,2) not null default 0,
  reference text,
  status text not null default 'confirmed',
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.pos_drawer_sessions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  show_session_id text,
  register_name text,
  status text not null default 'open',
  starting_cash numeric(12,2) not null default 0,
  expected_cash numeric(12,2) not null default 0,
  counted_cash numeric(12,2),
  over_short numeric(12,2),
  opened_by uuid references auth.users(id) on delete set null,
  closed_by uuid references auth.users(id) on delete set null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.pos_drawer_movements (
  id uuid primary key default gen_random_uuid(),
  drawer_session_id uuid not null references public.pos_drawer_sessions(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  sale_id uuid references public.pos_sales(id) on delete set null,
  movement_type text not null,
  amount numeric(12,2) not null default 0,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.customer_receipts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  sale_id uuid references public.pos_sales(id) on delete set null,
  phone text not null,
  sms_status text not null default 'requested',
  created_at timestamptz not null default now()
);

create table if not exists public.customer_wants (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  sale_id uuid references public.pos_sales(id) on delete set null,
  phone text,
  customer_name text,
  want_text text not null,
  categories text[] not null default '{}',
  marketing_opt_in boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.pos_audit_log (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  event_type text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_pos_sales_store on public.pos_sales(store_id, completed_at desc);
create index if not exists idx_pos_sale_lines_store on public.pos_sale_lines(store_id, created_at desc);
create index if not exists idx_pos_payments_store on public.pos_payments(store_id, created_at desc);
create index if not exists idx_pos_drawer_sessions_store on public.pos_drawer_sessions(store_id, opened_at desc);
create index if not exists idx_pos_drawer_movements_store on public.pos_drawer_movements(store_id, created_at desc);
create index if not exists idx_customer_receipts_store on public.customer_receipts(store_id, created_at desc);
create index if not exists idx_customer_wants_store on public.customer_wants(store_id, created_at desc);
create index if not exists idx_pos_audit_log_store on public.pos_audit_log(store_id, created_at desc);

alter table public.pos_sales enable row level security;
alter table public.pos_sale_lines enable row level security;
alter table public.pos_payments enable row level security;
alter table public.pos_drawer_sessions enable row level security;
alter table public.pos_drawer_movements enable row level security;
alter table public.customer_receipts enable row level security;
alter table public.customer_wants enable row level security;
alter table public.pos_audit_log enable row level security;

drop policy if exists pos_sales_select_member on public.pos_sales;
create policy pos_sales_select_member on public.pos_sales for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists pos_sales_insert_employee on public.pos_sales;
create policy pos_sales_insert_employee on public.pos_sales for insert with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));

drop policy if exists pos_sale_lines_select_member on public.pos_sale_lines;
create policy pos_sale_lines_select_member on public.pos_sale_lines for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists pos_sale_lines_insert_employee on public.pos_sale_lines;
create policy pos_sale_lines_insert_employee on public.pos_sale_lines for insert with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));

drop policy if exists pos_payments_select_member on public.pos_payments;
create policy pos_payments_select_member on public.pos_payments for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists pos_payments_insert_employee on public.pos_payments;
create policy pos_payments_insert_employee on public.pos_payments for insert with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));

drop policy if exists pos_drawer_sessions_select_member on public.pos_drawer_sessions;
create policy pos_drawer_sessions_select_member on public.pos_drawer_sessions for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists pos_drawer_sessions_insert_employee on public.pos_drawer_sessions;
create policy pos_drawer_sessions_insert_employee on public.pos_drawer_sessions for insert with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists pos_drawer_sessions_update_manager on public.pos_drawer_sessions;
create policy pos_drawer_sessions_update_manager on public.pos_drawer_sessions for update using (public.current_store_role(store_id) in ('owner','admin','manager')) with check (public.current_store_role(store_id) in ('owner','admin','manager'));

drop policy if exists pos_drawer_movements_select_member on public.pos_drawer_movements;
create policy pos_drawer_movements_select_member on public.pos_drawer_movements for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists pos_drawer_movements_insert_employee on public.pos_drawer_movements;
create policy pos_drawer_movements_insert_employee on public.pos_drawer_movements for insert with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));

drop policy if exists customer_receipts_select_member on public.customer_receipts;
create policy customer_receipts_select_member on public.customer_receipts for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists customer_receipts_insert_employee on public.customer_receipts;
create policy customer_receipts_insert_employee on public.customer_receipts for insert with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));

drop policy if exists customer_wants_select_member on public.customer_wants;
create policy customer_wants_select_member on public.customer_wants for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists customer_wants_insert_employee on public.customer_wants;
create policy customer_wants_insert_employee on public.customer_wants for insert with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));

drop policy if exists pos_audit_log_select_member on public.pos_audit_log;
create policy pos_audit_log_select_member on public.pos_audit_log for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists pos_audit_log_insert_employee on public.pos_audit_log;
create policy pos_audit_log_insert_employee on public.pos_audit_log for insert with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
