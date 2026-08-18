-- Customer-facing web accounts: links a themanapocket.com login (Supabase
-- Auth user) to the in-store `customers` record via a phone-verified OTP,
-- adds a real persistent trade-in credit balance (previously spend-only
-- within the same buy visit -- see 2026-08-10-customers-loyalty-gift-cards.sql),
-- and gives every POS sale a customer_id so "purchases connected to my
-- phone number" has something reliable to query.
-- Run after 2026-08-10-customers-loyalty-gift-cards.sql.

-- pos_sales never recorded which customer (if any) a sale belonged to --
-- only loyalty_ledger/gift_card_transactions did, and only when loyalty
-- accrual or a gift card redemption actually happened on that sale. A cash
-- sale at a store with loyalty off left no link at all. This column is
-- backfilled going forward by dashboard.html's checkout flow any time a
-- phone number is captured, independent of whether loyalty points accrue.
alter table public.pos_sales add column if not exists customer_id uuid references public.customers(id) on delete set null;
create index if not exists idx_pos_sales_customer on public.pos_sales(customer_id) where customer_id is not null;

-- One web login can be linked to at most one customer record per store,
-- established only after the phone-verification code below succeeds. A
-- customer with no web account yet has this null.
alter table public.customers add column if not exists linked_user_id uuid references auth.users(id) on delete set null;
alter table public.customers add column if not exists trade_credit_balance numeric(12,2) not null default 0;
create unique index if not exists idx_customers_linked_user on public.customers(store_id, linked_user_id) where linked_user_id is not null;

create table if not exists public.trade_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  sale_id text references public.pos_sales(id) on delete set null,
  amount numeric(12,2) not null,
  reason text not null,
  balance_after numeric(12,2) not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_trade_credit_ledger_store on public.trade_credit_ledger(store_id, created_at desc);
create index if not exists idx_trade_credit_ledger_customer on public.trade_credit_ledger(customer_id, created_at desc);

-- One-time SMS codes for the "link my phone number" flow on the website.
-- Row-owned by the signed-in web user (auth.uid()), never readable by
-- other users; the actual send/verify logic runs server-side in the Worker
-- using the service-role key, these RLS policies only matter if a client
-- ever queries the table directly (defense in depth, not the primary gate).
create table if not exists public.phone_verifications (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  phone text not null,
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_phone_verifications_user on public.phone_verifications(user_id, created_at desc);

alter table public.trade_credit_ledger enable row level security;
alter table public.phone_verifications enable row level security;

drop policy if exists trade_credit_ledger_select_member on public.trade_credit_ledger;
create policy trade_credit_ledger_select_member on public.trade_credit_ledger for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists trade_credit_ledger_insert_employee on public.trade_credit_ledger;
create policy trade_credit_ledger_insert_employee on public.trade_credit_ledger for insert with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));

drop policy if exists phone_verifications_owner on public.phone_verifications;
create policy phone_verifications_owner on public.phone_verifications for select using (user_id = auth.uid());

-- Mirrors accrue_loyalty_points/redeem_loyalty_points exactly, for the new
-- durable trade-in balance. Staff-only (POS register use); the Worker's
-- customer-facing routes only ever read this balance, never call these.
create or replace function public.accrue_trade_credit(p_store_id uuid, p_customer_id uuid, p_amount numeric, p_sale_id text, p_reason text default 'trade_in')
returns numeric
language plpgsql
as $$
declare
  v_balance numeric;
begin
  if public.current_store_role(p_store_id) not in ('owner','admin','manager','employee') then
    raise exception 'not authorized';
  end if;
  if p_amount <= 0 then
    raise exception 'trade credit to accrue must be positive';
  end if;
  update public.customers set trade_credit_balance = trade_credit_balance + p_amount, updated_at = now()
    where id = p_customer_id and store_id = p_store_id
    returning trade_credit_balance into v_balance;
  if v_balance is null then
    raise exception 'customer not found';
  end if;
  insert into public.trade_credit_ledger(store_id, customer_id, sale_id, amount, reason, balance_after, created_by)
    values (p_store_id, p_customer_id, p_sale_id, p_amount, p_reason, v_balance, auth.uid());
  return v_balance;
end;
$$;

create or replace function public.redeem_trade_credit(p_store_id uuid, p_customer_id uuid, p_amount numeric, p_sale_id text)
returns numeric
language plpgsql
as $$
declare
  v_balance numeric;
begin
  if public.current_store_role(p_store_id) not in ('owner','admin','manager','employee') then
    raise exception 'not authorized';
  end if;
  if p_amount <= 0 then
    raise exception 'trade credit to redeem must be positive';
  end if;
  select trade_credit_balance into v_balance from public.customers
    where id = p_customer_id and store_id = p_store_id
    for update;
  if v_balance is null then
    raise exception 'customer not found';
  end if;
  if v_balance < p_amount then
    raise exception 'insufficient trade credit balance';
  end if;
  v_balance := v_balance - p_amount;
  update public.customers set trade_credit_balance = v_balance, updated_at = now() where id = p_customer_id;
  insert into public.trade_credit_ledger(store_id, customer_id, sale_id, amount, reason, balance_after, created_by)
    values (p_store_id, p_customer_id, p_sale_id, -p_amount, 'redeem', v_balance, auth.uid());
  return v_balance;
end;
$$;
