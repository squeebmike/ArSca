-- Atomic, idempotent POS checkout commit.
-- Run after supabase/pos-money-ledger.sql and
-- supabase/stripe-connect-and-consignments.sql.

-- Some early production installs have the core POS ledger without these two
-- optional customer-capture tables. Creating them here is additive and makes
-- the receipt/wants screens match the deployed application.
alter table if exists public.store_invites add column if not exists email_status text not null default 'not_sent';
alter table if exists public.store_invites add column if not exists email_sent_at timestamptz;
alter table if exists public.store_invites add column if not exists email_error text;

-- Upgrade early/legacy POS tables in place. These are additive columns only:
-- existing rows, IDs, totals, and foreign keys are preserved.
alter table if exists public.pos_sales add column if not exists show_session_id text;
alter table if exists public.pos_sales add column if not exists drawer_session_id uuid;
alter table if exists public.pos_sales add column if not exists checkout_snapshot_id uuid;
alter table if exists public.pos_sales add column if not exists subtotal numeric(12,2) not null default 0;
alter table if exists public.pos_sales add column if not exists discount_total numeric(12,2) not null default 0;
alter table if exists public.pos_sales add column if not exists tax_total numeric(12,2) not null default 0;
alter table if exists public.pos_sales add column if not exists total numeric(12,2) not null default 0;
alter table if exists public.pos_sales add column if not exists status text not null default 'completed';
alter table if exists public.pos_sales add column if not exists created_by uuid;
alter table if exists public.pos_sales add column if not exists created_at timestamptz not null default now();
alter table if exists public.pos_sales add column if not exists completed_at timestamptz;

alter table if exists public.pos_sale_lines add column if not exists item_id text;
alter table if exists public.pos_sale_lines add column if not exists title text not null default 'Item';
alter table if exists public.pos_sale_lines add column if not exists category text;
alter table if exists public.pos_sale_lines add column if not exists quantity numeric(12,2) not null default 1;
alter table if exists public.pos_sale_lines add column if not exists unit_price numeric(12,2) not null default 0;
alter table if exists public.pos_sale_lines add column if not exists original_price numeric(12,2) not null default 0;
alter table if exists public.pos_sale_lines add column if not exists adjusted_price numeric(12,2) not null default 0;
alter table if exists public.pos_sale_lines add column if not exists discount_amount numeric(12,2) not null default 0;
alter table if exists public.pos_sale_lines add column if not exists cost_basis numeric(12,2) not null default 0;
alter table if exists public.pos_sale_lines add column if not exists profit numeric(12,2) not null default 0;
alter table if exists public.pos_sale_lines add column if not exists condition text;
alter table if exists public.pos_sale_lines add column if not exists finish text;
alter table if exists public.pos_sale_lines add column if not exists source_id text;
alter table if exists public.pos_sale_lines add column if not exists image_url text;
alter table if exists public.pos_sale_lines add column if not exists created_at timestamptz not null default now();

alter table if exists public.pos_payments add column if not exists drawer_session_id uuid;
alter table if exists public.pos_payments add column if not exists method text not null default 'other';
alter table if exists public.pos_payments add column if not exists amount numeric(12,2) not null default 0;
alter table if exists public.pos_payments add column if not exists reference text;
alter table if exists public.pos_payments add column if not exists status text not null default 'confirmed';
alter table if exists public.pos_payments add column if not exists confirmed_by uuid;
alter table if exists public.pos_payments add column if not exists confirmed_at timestamptz;
alter table if exists public.pos_payments add column if not exists created_at timestamptz not null default now();

alter table if exists public.pos_drawer_movements add column if not exists movement_type text not null default 'cash_sale';
alter table if exists public.pos_drawer_movements add column if not exists amount numeric(12,2) not null default 0;
alter table if exists public.pos_drawer_movements add column if not exists note text;
alter table if exists public.pos_drawer_movements add column if not exists created_by uuid;
alter table if exists public.pos_drawer_movements add column if not exists created_at timestamptz not null default now();

alter table if exists public.pos_audit_log add column if not exists event_type text not null default 'sale_event';
alter table if exists public.pos_audit_log add column if not exists entity_type text not null default 'pos_sale';
alter table if exists public.pos_audit_log add column if not exists entity_id text;
alter table if exists public.pos_audit_log add column if not exists details jsonb not null default '{}'::jsonb;
alter table if exists public.pos_audit_log add column if not exists created_by uuid;
alter table if exists public.pos_audit_log add column if not exists created_at timestamptz not null default now();

create table if not exists public.customer_receipts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  -- Production's original POS ledger uses text sale IDs. Keep this aligned
  -- with pos_sales.id instead of introducing an incompatible uuid FK.
  sale_id text references public.pos_sales(id) on delete set null,
  phone text not null,
  sms_status text not null default 'requested',
  created_at timestamptz not null default now()
);

create table if not exists public.customer_wants (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  sale_id text references public.pos_sales(id) on delete set null,
  phone text,
  customer_name text,
  want_text text not null,
  categories text[] not null default '{}',
  marketing_opt_in boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_customer_receipts_store on public.customer_receipts(store_id, created_at desc);
create index if not exists idx_customer_wants_store on public.customer_wants(store_id, created_at desc);
alter table public.customer_receipts enable row level security;
alter table public.customer_wants enable row level security;
drop policy if exists customer_receipts_select_member on public.customer_receipts;
create policy customer_receipts_select_member on public.customer_receipts for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists customer_receipts_insert_employee on public.customer_receipts;
create policy customer_receipts_insert_employee on public.customer_receipts for insert with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists customer_wants_select_member on public.customer_wants;
create policy customer_wants_select_member on public.customer_wants for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists customer_wants_insert_employee on public.customer_wants;
create policy customer_wants_insert_employee on public.customer_wants for insert with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
grant select, insert on public.customer_receipts, public.customer_wants to authenticated;

create or replace function public.complete_pos_sale(p_bundle jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sale jsonb := p_bundle -> 'sale';
  -- The original production ledger stores sale IDs as text. Values are still
  -- generated as UUID-shaped strings by the app, but the SQL type must match
  -- pos_sales.id for comparisons and foreign keys.
  v_sale_id text;
  v_store_id uuid;
  v_row jsonb;
  v_cash_delta numeric(12,2) := 0;
  v_current_qty numeric := 0;
  v_next_qty numeric := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if jsonb_typeof(p_bundle) <> 'object' or jsonb_typeof(v_sale) <> 'object' then
    raise exception 'Invalid sale bundle';
  end if;

  v_sale_id := v_sale ->> 'id';
  v_store_id := (v_sale ->> 'store_id')::uuid;
  if coalesce(public.current_store_role(v_store_id)::text,'') not in ('owner','admin','manager','employee') then
    raise exception 'Store access denied';
  end if;

  -- A retried outbox item must never duplicate money or inventory effects.
  if exists (select 1 from public.pos_sales where id = v_sale_id and store_id::text = v_store_id::text) then
    return jsonb_build_object('ok', true, 'saleId', v_sale_id, 'idempotent', true);
  end if;

  insert into public.pos_sales (
    id, store_id, show_session_id, drawer_session_id, checkout_snapshot_id,
    subtotal, discount_total, tax_total, total, status, created_by,
    created_at, completed_at
  ) values (
    v_sale_id, v_store_id, nullif(v_sale ->> 'show_session_id',''),
    nullif(v_sale ->> 'drawer_session_id','')::uuid,
    nullif(v_sale ->> 'checkout_snapshot_id','')::uuid,
    coalesce((v_sale ->> 'subtotal')::numeric,0),
    coalesce((v_sale ->> 'discount_total')::numeric,0),
    coalesce((v_sale ->> 'tax_total')::numeric,0),
    coalesce((v_sale ->> 'total')::numeric,0),
    coalesce(nullif(v_sale ->> 'status',''),'completed'), auth.uid(),
    coalesce((v_sale ->> 'created_at')::timestamptz,now()),
    coalesce((v_sale ->> 'completed_at')::timestamptz,now())
  );

  for v_row in select value from jsonb_array_elements(coalesce(p_bundle -> 'saleLines','[]'::jsonb)) loop
    if (v_row ->> 'store_id')::uuid <> v_store_id or v_row ->> 'sale_id' <> v_sale_id then
      raise exception 'Sale line scope mismatch';
    end if;
    insert into public.pos_sale_lines (
      id, sale_id, store_id, item_id, title, category, quantity, unit_price,
      original_price, adjusted_price, discount_amount, cost_basis, profit,
      condition, finish, source_id, image_url, created_at
    ) values (
      (v_row ->> 'id')::uuid, v_sale_id, v_store_id, v_row ->> 'item_id',
      coalesce(nullif(v_row ->> 'title',''),'Item'), v_row ->> 'category',
      coalesce((v_row ->> 'quantity')::numeric,1), coalesce((v_row ->> 'unit_price')::numeric,0),
      coalesce((v_row ->> 'original_price')::numeric,0), coalesce((v_row ->> 'adjusted_price')::numeric,0),
      coalesce((v_row ->> 'discount_amount')::numeric,0), coalesce((v_row ->> 'cost_basis')::numeric,0),
      coalesce((v_row ->> 'profit')::numeric,0), v_row ->> 'condition', v_row ->> 'finish',
      v_row ->> 'source_id', v_row ->> 'image_url', coalesce((v_row ->> 'created_at')::timestamptz,now())
    );
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_bundle -> 'payments','[]'::jsonb)) loop
    if (v_row ->> 'store_id')::uuid <> v_store_id or v_row ->> 'sale_id' <> v_sale_id then
      raise exception 'Payment scope mismatch';
    end if;
    insert into public.pos_payments (
      id, sale_id, store_id, drawer_session_id, method, amount, reference,
      status, confirmed_by, confirmed_at, created_at
    ) values (
      (v_row ->> 'id')::uuid, v_sale_id, v_store_id,
      nullif(v_row ->> 'drawer_session_id','')::uuid,
      coalesce(nullif(v_row ->> 'method',''),'other'), coalesce((v_row ->> 'amount')::numeric,0),
      v_row ->> 'reference', coalesce(nullif(v_row ->> 'status',''),'confirmed'), auth.uid(),
      coalesce((v_row ->> 'confirmed_at')::timestamptz,now()), coalesce((v_row ->> 'created_at')::timestamptz,now())
    );
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_bundle -> 'drawerMovements','[]'::jsonb)) loop
    if (v_row ->> 'store_id')::uuid <> v_store_id or v_row ->> 'sale_id' <> v_sale_id then
      raise exception 'Drawer movement scope mismatch';
    end if;
    insert into public.pos_drawer_movements (
      id, drawer_session_id, store_id, sale_id, movement_type, amount, note, created_by, created_at
    ) values (
      (v_row ->> 'id')::uuid, (v_row ->> 'drawer_session_id')::uuid, v_store_id, v_sale_id,
      coalesce(nullif(v_row ->> 'movement_type',''),'cash_sale'), coalesce((v_row ->> 'amount')::numeric,0),
      v_row ->> 'note', auth.uid(), coalesce((v_row ->> 'created_at')::timestamptz,now())
    );
    v_cash_delta := v_cash_delta + coalesce((v_row ->> 'amount')::numeric,0);
  end loop;

  if v_cash_delta <> 0 and nullif(v_sale ->> 'drawer_session_id','') is not null then
    update public.pos_drawer_sessions
       set expected_cash = expected_cash + v_cash_delta
     -- Production has legacy ledgers where this primary key is text, while
     -- fresh installs use uuid. Comparing their text representations works
     -- for both layouts and avoids the text = uuid operator failure.
     where id::text = (v_sale ->> 'drawer_session_id')
       and store_id::text = v_store_id::text;
  end if;

  for v_row in select value from jsonb_array_elements(coalesce(p_bundle -> 'inventoryUpdates','[]'::jsonb)) loop
    select coalesce(
             case when coalesce(data ->> 'qty','') ~ '^\d+(\.\d+)?$' then (data ->> 'qty')::numeric end,
             case when coalesce(data ->> 'quantity','') ~ '^\d+(\.\d+)?$' then (data ->> 'quantity')::numeric end,
             case when coalesce(data ->> 'inventory-count','') ~ '^\d+(\.\d+)?$' then (data ->> 'inventory-count')::numeric end,
             1
           )
      into v_current_qty
      from public.inventory_items
     where store_id::text = v_store_id::text
       and (id::text = v_row ->> 'item_id' or data ->> 'id' = v_row ->> 'item_id')
     limit 1
     for update;

    if found then
      v_next_qty := greatest(0, v_current_qty + coalesce((v_row ->> 'quantity_delta')::numeric,-1));
    else
      continue;
    end if;

    update public.inventory_items
       set status = case when v_next_qty > 0 then 'in_stock' else 'sold' end,
           data = data || jsonb_build_object(
                    'status', case when v_next_qty > 0 then 'in_stock' else 'sold' end,
                    'lifecycle', case when v_next_qty > 0 then 'in_stock' else 'sold' end,
                    'qty', v_next_qty,
                    'quantity', v_next_qty,
                    'sold-out', v_next_qty <= 0,
                    'inventory-count', v_next_qty,
                    'soldAt', case when v_next_qty <= 0 then coalesce(v_row ->> 'sold_at', now()::text) else '' end,
                    'saleId', v_sale_id::text),
           updated_at = now()
     where store_id::text = v_store_id::text
       and (id::text = v_row ->> 'item_id' or data ->> 'id' = v_row ->> 'item_id');
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_bundle -> 'audit','[]'::jsonb)) loop
    if (v_row ->> 'store_id')::uuid <> v_store_id then
      raise exception 'Audit event scope mismatch';
    end if;
    insert into public.pos_audit_log (
      id, store_id, event_type, entity_type, entity_id, details, created_by, created_at
    ) values (
      (v_row ->> 'id')::uuid, v_store_id, coalesce(nullif(v_row ->> 'event_type',''),'sale_event'),
      coalesce(nullif(v_row ->> 'entity_type',''),'pos_sale'), v_row ->> 'entity_id',
      coalesce(v_row -> 'details','{}'::jsonb), auth.uid(), coalesce((v_row ->> 'created_at')::timestamptz,now())
    );
  end loop;

  return jsonb_build_object('ok', true, 'saleId', v_sale_id, 'idempotent', false);
end;
$$;

revoke all on function public.complete_pos_sale(jsonb) from public;
grant execute on function public.complete_pos_sale(jsonb) to authenticated;

-- Make newly created tables/functions visible to PostgREST immediately.
notify pgrst, 'reload schema';
