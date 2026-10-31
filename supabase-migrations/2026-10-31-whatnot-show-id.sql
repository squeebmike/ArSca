-- Whatnot shows kept automatically from the Seller API (scripts/whatnot-sync.mjs):
-- each row is matched to its show on Whatnot by this id, so its numbers
-- (report_summary) are refreshed in place. Shows made by hand in the
-- dashboard have none.
alter table public.whatnot_shows add column if not exists whatnot_show_id text;
create unique index if not exists whatnot_shows_store_whatnot_id on public.whatnot_shows(store_id, whatnot_show_id);
