begin;

create index if not exists idx_comic_families_store on public.comic_title_families(store_id);
create index if not exists idx_comic_skus_family on public.comic_skus(family_id);
create index if not exists idx_foc_cycles_imported_by on public.foc_cycles(imported_by);
create index if not exists idx_foc_favorites_user on public.foc_favorites(user_id);
create index if not exists idx_foc_requests_cycle on public.foc_incentive_requests(cycle_id);
create index if not exists idx_foc_requests_store on public.foc_incentive_requests(store_id);
create index if not exists idx_foc_pick_items_sku on public.foc_pick_list_items(sku_id);
create index if not exists idx_foc_pick_lists_cycle on public.foc_pick_lists(cycle_id);
create index if not exists idx_foc_pick_lists_store on public.foc_pick_lists(store_id);
create index if not exists idx_foc_pick_lists_user on public.foc_pick_lists(user_id);
create index if not exists idx_foc_items_cycle on public.foc_preorder_items(cycle_id);
create index if not exists idx_foc_items_store on public.foc_preorder_items(store_id);
create index if not exists idx_foc_orders_store on public.foc_preorder_orders(store_id);

drop policy if exists foc_orders_customer_select on public.foc_preorder_orders;
create policy foc_orders_customer_select on public.foc_preorder_orders for select to authenticated
  using (user_id = (select auth.uid()) or public.current_store_role(store_id) in ('owner','admin','manager','employee'));

drop policy if exists foc_items_customer_select on public.foc_preorder_items;
create policy foc_items_customer_select on public.foc_preorder_items for select to authenticated
  using (exists (
    select 1 from public.foc_preorder_orders o
    where o.id = order_id
      and (o.user_id = (select auth.uid()) or public.current_store_role(o.store_id) in ('owner','admin','manager','employee'))
  ));

drop policy if exists foc_requests_customer_select on public.foc_incentive_requests;
drop policy if exists foc_requests_customer_insert on public.foc_incentive_requests;
drop policy if exists foc_requests_customer_update on public.foc_incentive_requests;
create policy foc_requests_customer_select on public.foc_incentive_requests for select to authenticated
  using (user_id = (select auth.uid()) or public.current_store_role(store_id) in ('owner','admin','manager','employee'));
create policy foc_requests_customer_insert on public.foc_incentive_requests for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy foc_requests_customer_update on public.foc_incentive_requests for update to authenticated
  using (user_id = (select auth.uid()) or public.current_store_role(store_id) in ('owner','admin','manager','employee'))
  with check (user_id = (select auth.uid()) or public.current_store_role(store_id) in ('owner','admin','manager','employee'));

drop policy if exists foc_favorites_own_all on public.foc_favorites;
drop policy if exists foc_favorites_staff_select on public.foc_favorites;
drop policy if exists foc_favorites_select on public.foc_favorites;
drop policy if exists foc_favorites_insert on public.foc_favorites;
drop policy if exists foc_favorites_update on public.foc_favorites;
drop policy if exists foc_favorites_delete on public.foc_favorites;
create policy foc_favorites_select on public.foc_favorites for select to authenticated
  using (user_id = (select auth.uid()) or public.current_store_role(store_id) in ('owner','admin','manager','employee'));
create policy foc_favorites_insert on public.foc_favorites for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy foc_favorites_update on public.foc_favorites for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy foc_favorites_delete on public.foc_favorites for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists foc_pick_lists_own_all on public.foc_pick_lists;
create policy foc_pick_lists_own_all on public.foc_pick_lists for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists foc_pick_list_items_own_all on public.foc_pick_list_items;
create policy foc_pick_list_items_own_all on public.foc_pick_list_items for all to authenticated
  using (exists (select 1 from public.foc_pick_lists p where p.id = pick_list_id and p.user_id = (select auth.uid())))
  with check (exists (select 1 from public.foc_pick_lists p where p.id = pick_list_id and p.user_id = (select auth.uid())));

commit;
