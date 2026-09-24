-- Post-purchase review-request links for storefront orders. Real reviews
-- only -- the /item/{id} detail page already has Review/AggregateRating
-- schema.org markup wired up (reviewSchemaAndHtml in cloudflare-worker-
-- full.js) but nothing ever wrote to an item's `reviews` field, so it has
-- rendered nothing on every item so far. This is what closes that loop.
--
-- Same "unguessable random UUID as a bearer token in a URL, looked up
-- directly, no HMAC/signing" pattern already used for
-- email_notify_contacts.unsubscribe_token (see 2026-08-19-email-notify-
-- contacts.sql) -- one token per order, emailed to the customer once
-- their order is marked fulfilled, and reused by every item's review form
-- on that order's /review page.

alter table public.storefront_orders add column if not exists review_token uuid not null default gen_random_uuid();
alter table public.storefront_orders add column if not exists review_email_sent_at timestamptz;
alter table public.storefront_orders add column if not exists review_email_error text;

create index if not exists storefront_orders_review_token_idx
  on public.storefront_orders (review_token);

-- Scheduled job (runScheduledStorefrontReviewRequests) scans for orders
-- that are fulfilled, not yet emailed, and past the wait window --
-- this index is what makes that scan cheap instead of a full table scan
-- as the order history grows.
create index if not exists storefront_orders_review_pending_idx
  on public.storefront_orders (fulfillment_status, review_email_sent_at, fulfilled_at)
  where fulfillment_status = 'fulfilled' and review_email_sent_at is null;
