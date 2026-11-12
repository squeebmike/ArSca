-- Which article sent a website buyer (2026-11-12: "books sold from someone
-- coming in the website and buying any book, but coming in through his
-- articles"). "article:<slug>" when the buyer read one of the articles in the
-- 7 days before checkout; null otherwise.
alter table public.storefront_orders add column if not exists referral text;
create index if not exists storefront_orders_referral_idx on public.storefront_orders (store_id, referral) where referral is not null;
