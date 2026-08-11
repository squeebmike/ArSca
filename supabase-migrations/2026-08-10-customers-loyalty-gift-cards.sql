-- Walk-Off customers, loyalty points, and gift cards.
-- Run after pos-money-ledger.sql.
--
-- Customers replaces the old localStorage-only pos_customers list with a
-- store-scoped, cross-device Supabase table so loyalty balances and gift
-- card ownership are readable/writable from any register.
--
-- Gift cards are a separate balance from trade-in store credit on purpose --
-- store credit only ever applies within the single buy visit it was created
-- in, gift cards are a standalone purchasable/reloadable-style balance.

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text,
  phone text,
  email text,
  notes text,
  loyalty_points_balance integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Not a hard NOT NULL/CHECK constraint: quick "just a name" contacts (e.g. the
-- command-bar quick-add) are a legitimate lower-value entry with no contact
-- info yet. Phone-or-email is enforced at the application layer only at the
-- specific points that need it (loyalty enrollment, gift card issuance).

create table if not exists public.loyalty_ledger (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  sale_id text references public.pos_sales(id) on delete set null,
  points integer not null,
  reason text not null,
  balance_after integer not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.gift_cards (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  code text not null,
  initial_value numeric(12,2) not null default 0,
  balance numeric(12,2) not null default 0,
  status text not null default 'active',
  customer_id uuid references public.customers(id) on delete set null,
  issued_sale_id text references public.pos_sales(id) on delete set null,
  issued_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gift_card_transactions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  gift_card_id uuid not null references public.gift_cards(id) on delete cascade,
  sale_id text references public.pos_sales(id) on delete set null,
  type text not null,
  amount numeric(12,2) not null default 0,
  balance_after numeric(12,2) not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_customers_store on public.customers(store_id, created_at desc);
create index if not exists idx_customers_phone on public.customers(store_id, phone);
create index if not exists idx_customers_email on public.customers(store_id, email);
create index if not exists idx_loyalty_ledger_store on public.loyalty_ledger(store_id, created_at desc);
create index if not exists idx_loyalty_ledger_customer on public.loyalty_ledger(customer_id, created_at desc);
create unique index if not exists idx_gift_cards_code on public.gift_cards(store_id, code);
create index if not exists idx_gift_card_transactions_card on public.gift_card_transactions(gift_card_id, created_at desc);

alter table public.customers enable row level security;
alter table public.loyalty_ledger enable row level security;
alter table public.gift_cards enable row level security;
alter table public.gift_card_transactions enable row level security;

drop policy if exists customers_select_member on public.customers;
create policy customers_select_member on public.customers for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists customers_insert_employee on public.customers;
create policy customers_insert_employee on public.customers for insert with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists customers_update_employee on public.customers;
create policy customers_update_employee on public.customers for update using (public.current_store_role(store_id) in ('owner','admin','manager','employee')) with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));

drop policy if exists loyalty_ledger_select_member on public.loyalty_ledger;
create policy loyalty_ledger_select_member on public.loyalty_ledger for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists loyalty_ledger_insert_employee on public.loyalty_ledger;
create policy loyalty_ledger_insert_employee on public.loyalty_ledger for insert with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));

drop policy if exists gift_cards_select_member on public.gift_cards;
create policy gift_cards_select_member on public.gift_cards for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists gift_cards_insert_employee on public.gift_cards;
create policy gift_cards_insert_employee on public.gift_cards for insert with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists gift_cards_update_employee on public.gift_cards;
create policy gift_cards_update_employee on public.gift_cards for update using (public.current_store_role(store_id) in ('owner','admin','manager','employee')) with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));

drop policy if exists gift_card_transactions_select_member on public.gift_card_transactions;
create policy gift_card_transactions_select_member on public.gift_card_transactions for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists gift_card_transactions_insert_employee on public.gift_card_transactions;
create policy gift_card_transactions_insert_employee on public.gift_card_transactions for insert with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));

-- Atomic balance mutators. Plain client-side read-balance-then-write-balance
-- update is a race between two registers redeeming the same card/customer at
-- the same time; these lock the row for the duration of the transaction so a
-- concurrent redemption sees the already-decremented balance. Both run as
-- SECURITY INVOKER (the default) so the calling user's RLS still applies --
-- these grant no privilege beyond what the policies above already allow.

create or replace function public.accrue_loyalty_points(p_store_id uuid, p_customer_id uuid, p_points integer, p_sale_id text, p_reason text default 'sale')
returns integer
language plpgsql
as $$
declare
  v_balance integer;
begin
  if public.current_store_role(p_store_id) not in ('owner','admin','manager','employee') then
    raise exception 'not authorized';
  end if;
  if p_points <= 0 then
    raise exception 'points to accrue must be positive';
  end if;
  update public.customers set loyalty_points_balance = loyalty_points_balance + p_points, updated_at = now()
    where id = p_customer_id and store_id = p_store_id
    returning loyalty_points_balance into v_balance;
  if v_balance is null then
    raise exception 'customer not found';
  end if;
  insert into public.loyalty_ledger(store_id, customer_id, sale_id, points, reason, balance_after, created_by)
    values (p_store_id, p_customer_id, p_sale_id, p_points, p_reason, v_balance, auth.uid());
  return v_balance;
end;
$$;

create or replace function public.redeem_loyalty_points(p_store_id uuid, p_customer_id uuid, p_points integer, p_sale_id text)
returns integer
language plpgsql
as $$
declare
  v_balance integer;
begin
  if public.current_store_role(p_store_id) not in ('owner','admin','manager','employee') then
    raise exception 'not authorized';
  end if;
  if p_points <= 0 then
    raise exception 'points to redeem must be positive';
  end if;
  select loyalty_points_balance into v_balance from public.customers
    where id = p_customer_id and store_id = p_store_id
    for update;
  if v_balance is null then
    raise exception 'customer not found';
  end if;
  if v_balance < p_points then
    raise exception 'insufficient loyalty points balance';
  end if;
  v_balance := v_balance - p_points;
  update public.customers set loyalty_points_balance = v_balance, updated_at = now() where id = p_customer_id;
  insert into public.loyalty_ledger(store_id, customer_id, sale_id, points, reason, balance_after, created_by)
    values (p_store_id, p_customer_id, p_sale_id, -p_points, 'redeem', v_balance, auth.uid());
  return v_balance;
end;
$$;

create or replace function public.redeem_gift_card(p_store_id uuid, p_code text, p_amount numeric, p_sale_id text)
returns table(gift_card_id uuid, balance numeric)
language plpgsql
as $$
declare
  v_id uuid;
  v_balance numeric;
begin
  if public.current_store_role(p_store_id) not in ('owner','admin','manager','employee') then
    raise exception 'not authorized';
  end if;
  if p_amount <= 0 then
    raise exception 'redeem amount must be positive';
  end if;
  select id, balance into v_id, v_balance from public.gift_cards
    where store_id = p_store_id and code = p_code and status = 'active'
    for update;
  if v_id is null then
    raise exception 'gift card not found or inactive';
  end if;
  if v_balance < p_amount then
    raise exception 'insufficient gift card balance';
  end if;
  v_balance := v_balance - p_amount;
  update public.gift_cards set balance = v_balance, status = case when v_balance <= 0 then 'redeemed' else status end, updated_at = now()
    where id = v_id;
  insert into public.gift_card_transactions(store_id, gift_card_id, sale_id, type, amount, balance_after, created_by)
    values (p_store_id, v_id, p_sale_id, 'redeem', -p_amount, v_balance, auth.uid());
  return query select v_id, v_balance;
end;
$$;
