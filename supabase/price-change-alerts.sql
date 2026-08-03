-- Price Movers alerts, shared across every device signed into a store.
-- Previously this list lived only in one browser's localStorage, so a
-- price sync run on one device never showed up as a re-sticker reminder
-- on any other device. See dashboard.html's price-change-alerts feature.

create table if not exists public.price_change_alerts (
  id text primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  inventory_item_id text,
  item_name text not null,
  old_price numeric(12,2) not null default 0,
  new_price numeric(12,2) not null default 0,
  dollar_change numeric(12,2) not null default 0,
  pct_change numeric(8,4) not null default 0,
  status text not null default 'open' check (status in ('open','dismissed')),
  last_checked timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists price_change_alerts_store_status on public.price_change_alerts(store_id, status, created_at desc);

alter table public.price_change_alerts enable row level security;

drop policy if exists price_change_alerts_member_select on public.price_change_alerts;
drop policy if exists price_change_alerts_member_insert on public.price_change_alerts;
drop policy if exists price_change_alerts_member_update on public.price_change_alerts;
create policy price_change_alerts_member_select on public.price_change_alerts for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
create policy price_change_alerts_member_insert on public.price_change_alerts for insert with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
create policy price_change_alerts_member_update on public.price_change_alerts for update using (public.current_store_role(store_id) in ('owner','admin','manager','employee')) with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));

grant select, insert, update on public.price_change_alerts to authenticated;
