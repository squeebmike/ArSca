-- "Save for later" wishlist for backlist books, mirroring comics'
-- foc_pick_lists/foc_pick_list_items pattern but flat: backlist has no FOC
-- cycle to group by (always orderable), so one row per saved sku is enough
-- -- no separate "list" table needed the way comics' cycle-grouped picks do.

create table if not exists public.backlist_picks (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  user_id uuid not null,
  title_id uuid not null references public.backlist_titles(id) on delete cascade,
  sku_id uuid not null references public.backlist_skus(id) on delete cascade,
  quantity integer not null default 1,
  created_at timestamptz not null default now(),
  unique (user_id, sku_id)
);

create index if not exists idx_backlist_picks_user on public.backlist_picks(store_id, user_id);

alter table public.backlist_picks enable row level security;

-- Same convention as backlist_orders_customer_select: the customer owns
-- their own saved rows outright (a wishlist has no staff-approval step),
-- while actual reads/writes still go through the Worker's service role --
-- this policy is defense-in-depth, not the only gate.
create policy backlist_picks_customer_all on public.backlist_picks for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.backlist_picks from anon;
grant select, insert, update, delete on public.backlist_picks to authenticated;
