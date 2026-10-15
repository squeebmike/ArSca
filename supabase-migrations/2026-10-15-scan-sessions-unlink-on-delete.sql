-- Store report: "Delete failed" when permanently deleting an inventory item.
-- scan_sessions.inventory_item_id referenced inventory_items with no ON
-- DELETE action, so any item that came in through a scan (most of them)
-- could never be deleted -- Postgres: violates foreign key constraint
-- "scan_sessions_inventory_item_id_fkey". A scan session is buying history
-- and stays; it just stops pointing at the deleted item, same as
-- grading_submissions and whatnot_show_items already do.
alter table public.scan_sessions drop constraint if exists scan_sessions_inventory_item_id_fkey;
alter table public.scan_sessions
  add constraint scan_sessions_inventory_item_id_fkey
  foreign key (inventory_item_id) references public.inventory_items(id) on delete set null;
