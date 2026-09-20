-- Curated homepage shelves for /books: "Staff Picks" needs a real staff choice
-- (unlike "New Arrivals"/"Under $10", which read existing columns --
-- first_seen_at and backlist_skus.customer_price_cents -- with no schema
-- change at all). featured_rank lets staff order picks deliberately instead
-- of an arbitrary tiebreak; null ranks sort last (see backlistShelves()).

alter table public.backlist_titles
  add column if not exists is_featured boolean not null default false,
  add column if not exists featured_rank integer;

create index if not exists idx_backlist_titles_featured
  on public.backlist_titles(store_id, is_featured)
  where is_featured = true;
