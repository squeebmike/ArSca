-- price_change_alerts was referenced by dashboard.html (loadPriceChangeAlertsFromCloud/
-- syncPriceChangeAlertsToCloud) but this table was never actually created --
-- every read/write has been 404ing against PostgREST since the client code
-- was written. The client already degrades gracefully to a device-local
-- cache when the table is missing (see the console.warn in
-- loadPriceChangeAlertsFromCloud), so the feature "worked" per-device, but
-- never actually cloud-synced a price-sync run's re-sticker checklist
-- across a store's devices the way it was designed to. Not gated to
-- managers (see maybeRaisePriceChangeAlert's callers) -- any routine price
-- refresh, by any store member, can raise one -- so this mirrors
-- grading_submissions' all-employee insert/update pattern, not
-- consignment_alerts' manager-only insert.

create table if not exists public.price_change_alerts (
  id text primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  inventory_item_id text,
  item_name text not null,
  old_price numeric(12,2) not null default 0,
  new_price numeric(12,2) not null default 0,
  dollar_change numeric(12,2) not null default 0,
  pct_change numeric(10,4) not null default 0,
  status text not null default 'open' check (status in ('open','dismissed')),
  last_checked timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists price_change_alerts_store_status
  on public.price_change_alerts(store_id, status, created_at desc);

alter table public.price_change_alerts enable row level security;

drop policy if exists price_change_alerts_select_member on public.price_change_alerts;
create policy price_change_alerts_select_member on public.price_change_alerts for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists price_change_alerts_insert_employee on public.price_change_alerts;
create policy price_change_alerts_insert_employee on public.price_change_alerts for insert with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists price_change_alerts_update_employee on public.price_change_alerts;
create policy price_change_alerts_update_employee on public.price_change_alerts for update using (public.current_store_role(store_id) in ('owner','admin','manager','employee')) with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
