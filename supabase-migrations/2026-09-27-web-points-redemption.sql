-- Spending loyalty points at website checkout (shop, comic preorders,
-- backlist books). 100 points = $1, same as the register.
--
-- The points come off the balance when checkout starts ("hold"), so they
-- can't be spent twice while the card payment is in flight. If the payment
-- fails, is cancelled or is abandoned, the hold is released. Once the payment
-- succeeds the hold is finalized (stamped with the sale id) and can no longer
-- be released.
--
-- A preorder/backlist order has no pos_sales row until it's paid, and
-- loyalty_ledger.sale_id references pos_sales -- so holds are keyed on
-- order_ref ('foc:<id>', 'backlist:<id>', 'shop:<sale id>') instead.

alter table public.loyalty_ledger add column if not exists order_ref text;

-- One hold and at most one release per order.
create unique index if not exists idx_loyalty_ledger_order_ref_once
  on public.loyalty_ledger(store_id, order_ref, reason) where order_ref is not null;

-- Points spent on the order (0 = none). total_cents stays the amount charged
-- to the card, so refunds and receipts keep working off it unchanged.
alter table public.foc_preorder_orders add column if not exists points_redeemed integer not null default 0;
alter table public.backlist_orders add column if not exists points_redeemed integer not null default 0;
alter table public.storefront_orders add column if not exists points_redeemed integer not null default 0;
do $$ begin
  alter table public.foc_preorder_orders add constraint foc_preorder_orders_points_redeemed_check check (points_redeemed >= 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.backlist_orders add constraint backlist_orders_points_redeemed_check check (points_redeemed >= 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.storefront_orders add constraint storefront_orders_points_redeemed_check check (points_redeemed >= 0);
exception when duplicate_object then null; end $$;

create or replace function public.hold_web_order_points(p_store_id uuid, p_customer_id uuid, p_points integer, p_order_ref text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  if p_points is null or p_points <= 0 or coalesce(p_order_ref, '') = '' then
    raise exception 'points and order are required';
  end if;
  select loyalty_points_balance into v_balance from public.customers
    where id = p_customer_id and store_id = p_store_id
    for update;
  if v_balance is null then
    raise exception 'customer not found';
  end if;
  if exists (select 1 from public.loyalty_ledger where store_id = p_store_id and order_ref = p_order_ref and reason = 'web_redeem') then
    raise exception 'points already held for this order';
  end if;
  if v_balance < p_points then
    raise exception 'insufficient loyalty points balance';
  end if;
  v_balance := v_balance - p_points;
  update public.customers set loyalty_points_balance = v_balance, updated_at = now() where id = p_customer_id;
  insert into public.loyalty_ledger(store_id, customer_id, points, reason, balance_after, order_ref)
    values (p_store_id, p_customer_id, -p_points, 'web_redeem', v_balance, p_order_ref);
  return v_balance;
end;
$$;

-- Gives held points back. Safe to call any number of times: returns null when
-- there's no hold, it was already released, or the order was paid.
create or replace function public.release_web_order_points(p_store_id uuid, p_order_ref text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hold public.loyalty_ledger%rowtype;
  v_balance integer;
begin
  select * into v_hold from public.loyalty_ledger
    where store_id = p_store_id and order_ref = p_order_ref and reason = 'web_redeem'
    for update;
  if v_hold.id is null or v_hold.sale_id is not null then
    return null;
  end if;
  if exists (select 1 from public.loyalty_ledger where store_id = p_store_id and order_ref = p_order_ref and reason = 'web_redeem_release') then
    return null;
  end if;
  update public.customers set loyalty_points_balance = loyalty_points_balance + abs(v_hold.points), updated_at = now()
    where id = v_hold.customer_id and store_id = p_store_id
    returning loyalty_points_balance into v_balance;
  if v_balance is null then
    return null;
  end if;
  insert into public.loyalty_ledger(store_id, customer_id, points, reason, balance_after, order_ref)
    values (p_store_id, v_hold.customer_id, abs(v_hold.points), 'web_redeem_release', v_balance, p_order_ref);
  return v_balance;
end;
$$;

-- Called once the card payment succeeds: ties the hold to the sale, which
-- also stops any later release. Returns false if the hold had already been
-- released (the order was abandoned and then paid anyway), so the caller can
-- flag it for the store.
create or replace function public.finalize_web_order_points(p_store_id uuid, p_order_ref text, p_sale_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hold public.loyalty_ledger%rowtype;
begin
  select * into v_hold from public.loyalty_ledger
    where store_id = p_store_id and order_ref = p_order_ref and reason = 'web_redeem'
    for update;
  if v_hold.id is null then
    return false;
  end if;
  if exists (select 1 from public.loyalty_ledger where store_id = p_store_id and order_ref = p_order_ref and reason = 'web_redeem_release') then
    return false;
  end if;
  if v_hold.sale_id is null then
    update public.loyalty_ledger set sale_id = p_sale_id where id = v_hold.id;
  end if;
  return true;
end;
$$;

revoke all on function public.hold_web_order_points(uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.release_web_order_points(uuid, text) from public, anon, authenticated;
revoke all on function public.finalize_web_order_points(uuid, text, text) from public, anon, authenticated;
grant execute on function public.hold_web_order_points(uuid, uuid, integer, text) to service_role;
grant execute on function public.release_web_order_points(uuid, text) to service_role;
grant execute on function public.finalize_web_order_points(uuid, text, text) to service_role;
