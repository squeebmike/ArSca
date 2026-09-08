-- Whatnot/live-selling show planning + running: a "show" is a planned live
-- session (Whatnot, eBay Live, Twitch) built from current inventory ahead
-- of time (Show Builder / Show Inventory Bucket), then driven live via the
-- existing Whatnot Mode tab (Live Auction Companion), then closed out into
-- a Show P&L. whatnot_shows is the session itself; whatnot_show_items is
-- its running order -- one row per item pulled into the show, independent
-- of the live inventory_items row (name/price/cost snapshotted at the time
-- it was added to the show, same reasoning as storefront_orders/
-- pos_sale_lines snapshotting instead of just referencing a live row that
-- could later change or get deleted).

create table if not exists public.whatnot_shows (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  platform text not null default 'whatnot' check (platform in ('whatnot','ebay_live','twitch')),
  title text not null,
  category text not null default 'Mixed',
  planned_length_minutes integer not null default 60,
  status text not null default 'planning' check (status in ('planning','live','ended')),
  started_at timestamptz,
  ended_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists whatnot_shows_store_status on public.whatnot_shows(store_id, status, created_at desc);

create table if not exists public.whatnot_show_items (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references public.whatnot_shows(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  name text not null,
  category text,
  image_url text,
  cost_cents integer not null default 0,
  market_price_cents integer not null default 0,
  -- warm-up (opener) -> filler between bigger items (engagement) -> the
  -- best inventory once the room's warmed up (anchor) -> giveaway ->
  -- finale (closer). Matches the Show Builder's run-of-show slotting.
  role text not null default 'engagement' check (role in ('opener','engagement','anchor','giveaway','closer')),
  position integer not null default 0,
  status text not null default 'queued' check (status in ('queued','sold','passed','giveaway','pulled_for_later','needs_relisting')),
  sold_price_cents integer,
  sold_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists whatnot_show_items_show_position on public.whatnot_show_items(show_id, position);
create index if not exists whatnot_show_items_store on public.whatnot_show_items(store_id);

alter table public.whatnot_shows enable row level security;
alter table public.whatnot_show_items enable row level security;

-- Any staff member might plan or run a show -- same all-employee bar as
-- grading_submissions/price_change_alerts, not owner/admin-only.
drop policy if exists whatnot_shows_select_member on public.whatnot_shows;
create policy whatnot_shows_select_member on public.whatnot_shows for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists whatnot_shows_insert_employee on public.whatnot_shows;
create policy whatnot_shows_insert_employee on public.whatnot_shows for insert with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists whatnot_shows_update_employee on public.whatnot_shows;
create policy whatnot_shows_update_employee on public.whatnot_shows for update using (public.current_store_role(store_id) in ('owner','admin','manager','employee')) with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists whatnot_shows_delete_employee on public.whatnot_shows;
create policy whatnot_shows_delete_employee on public.whatnot_shows for delete using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));

drop policy if exists whatnot_show_items_select_member on public.whatnot_show_items;
create policy whatnot_show_items_select_member on public.whatnot_show_items for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists whatnot_show_items_insert_employee on public.whatnot_show_items;
create policy whatnot_show_items_insert_employee on public.whatnot_show_items for insert with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists whatnot_show_items_update_employee on public.whatnot_show_items;
create policy whatnot_show_items_update_employee on public.whatnot_show_items for update using (public.current_store_role(store_id) in ('owner','admin','manager','employee')) with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists whatnot_show_items_delete_employee on public.whatnot_show_items;
create policy whatnot_show_items_delete_employee on public.whatnot_show_items for delete using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
