-- Backlist shelves (/public/backlist/shelves) read the ~23,000-title catalog
-- to pick 40 "New Arrivals" and 60 "Under $10" rows. With no index matching
-- either ordering, each shelf scanned and sorted every row -- 3-5s on this
-- database, and past the 8s statement timeout under load (the post-deploy
-- probe failed with "canceling statement due to statement timeout").
-- These partial indexes match the shelf queries exactly (same filters, same
-- order), so each reads only the rows it returns. Read-only change: no data
-- is modified.

-- New Arrivals: store_id=eq, is_published=eq.true, order=first_seen_at.desc
create index if not exists idx_backlist_titles_new_arrivals
  on public.backlist_titles (store_id, first_seen_at desc)
  where is_published;

-- Under $10: store_id=eq, is_published/is_orderable/customer_enabled=eq.true,
-- customer_price_cents gt.0 and lt.1000, order=customer_price_cents.asc
create index if not exists idx_backlist_skus_customer_price
  on public.backlist_skus (store_id, customer_price_cents)
  where is_published and is_orderable and customer_enabled and customer_price_cents > 0;
