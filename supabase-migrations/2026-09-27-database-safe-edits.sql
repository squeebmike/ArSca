-- Safe edits from the dashboard's Database viewer: a sale line's cost and
-- category, an inventory item's cost and category, and a customer's points.
-- Nothing can be deleted there; money corrections still go through void /
-- refund. Every edit leaves a row here with who, when, and old -> new.
--
-- Only the Worker (service_role) writes this table; owners/admins can read
-- it. No update or delete policy exists, so the log can't be rewritten.

create table if not exists public.database_edit_log (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  table_name text not null,
  row_id text not null,
  field text not null,
  old_value jsonb,
  new_value jsonb,
  reason text,
  edited_by uuid references auth.users(id) on delete set null,
  edited_by_email text,
  created_at timestamptz not null default now()
);
create index if not exists idx_database_edit_log_store_time on public.database_edit_log(store_id, created_at desc);
create index if not exists idx_database_edit_log_row on public.database_edit_log(store_id, table_name, row_id);

alter table public.database_edit_log enable row level security;
drop policy if exists database_edit_log_read on public.database_edit_log;
create policy database_edit_log_read on public.database_edit_log
  for select to authenticated
  using (public.current_store_role(store_id) in ('owner', 'admin'));
revoke insert, update, delete, truncate on public.database_edit_log from anon, authenticated;

-- Adds or removes points with a reason; the ledger row, the balance and the
-- audit row change together or not at all. A balance can't go below zero.
create or replace function public.adjust_customer_points(p_store_id uuid, p_customer_id uuid, p_delta integer, p_reason text, p_user_id uuid, p_user_email text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old integer;
  v_new integer;
begin
  if p_delta is null or p_delta = 0 then
    raise exception 'points change is required';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'a reason is required';
  end if;
  select loyalty_points_balance into v_old from public.customers
    where id = p_customer_id and store_id = p_store_id
    for update;
  if v_old is null then
    raise exception 'customer not found';
  end if;
  v_new := v_old + p_delta;
  if v_new < 0 then
    raise exception 'that would take the balance below zero (it is %)', v_old;
  end if;
  update public.customers set loyalty_points_balance = v_new, updated_at = now() where id = p_customer_id;
  insert into public.loyalty_ledger(store_id, customer_id, points, reason, balance_after, created_by)
    values (p_store_id, p_customer_id, p_delta, 'manual_adjust', v_new, p_user_id);
  insert into public.database_edit_log(store_id, table_name, row_id, field, old_value, new_value, reason, edited_by, edited_by_email)
    values (p_store_id, 'customers', p_customer_id::text, 'loyalty_points_balance', to_jsonb(v_old), to_jsonb(v_new), trim(p_reason), p_user_id, p_user_email);
  return v_new;
end;
$$;

revoke all on function public.adjust_customer_points(uuid, uuid, integer, text, uuid, text) from public, anon, authenticated;
grant execute on function public.adjust_customer_points(uuid, uuid, integer, text, uuid, text) to service_role;
