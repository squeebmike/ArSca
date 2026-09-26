-- Web orders (shop, comic preorders, backlist books) earn loyalty points from
-- the Worker's payment paths, which run as service_role -- so they can't use
-- accrue_loyalty_points, which checks the caller's store role via auth.uid().

-- One award per web order: a redelivered Stripe webhook, or re-running the
-- backfill, hits this index and changes nothing.
create unique index if not exists idx_loyalty_ledger_web_order_once
  on public.loyalty_ledger(store_id, sale_id) where reason = 'web_order';

create or replace function public.accrue_web_order_loyalty(p_store_id uuid, p_customer_id uuid, p_points integer, p_sale_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
  v_ledger_id uuid;
begin
  if p_points is null or p_points <= 0 or p_sale_id is null then
    return null;
  end if;
  insert into public.loyalty_ledger(store_id, customer_id, sale_id, points, reason, balance_after)
    values (p_store_id, p_customer_id, p_sale_id, p_points, 'web_order', 0)
    on conflict (store_id, sale_id) where reason = 'web_order' do nothing
    returning id into v_ledger_id;
  if v_ledger_id is null then
    return null; -- already awarded for this order
  end if;
  update public.customers set loyalty_points_balance = loyalty_points_balance + p_points, updated_at = now()
    where id = p_customer_id and store_id = p_store_id
    returning loyalty_points_balance into v_balance;
  if v_balance is null then
    raise exception 'customer not found';
  end if;
  update public.loyalty_ledger set balance_after = v_balance where id = v_ledger_id;
  return v_balance;
end;
$$;

revoke all on function public.accrue_web_order_loyalty(uuid, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.accrue_web_order_loyalty(uuid, uuid, integer, text) to service_role;
