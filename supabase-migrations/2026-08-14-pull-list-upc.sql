-- Lets a pull-list item carry its distributor UPC (from a PRH FOC-list
-- import), used as the primary dedupe key on re-import so importing the
-- same weekly file twice, or overlapping FOC batches, doesn't create
-- duplicate rows. Run after 2026-08-12-pull-lists.sql.

alter table public.pull_list_items add column if not exists upc text;
create unique index if not exists idx_pull_list_items_upc on public.pull_list_items(series_id, upc) where upc is not null;
