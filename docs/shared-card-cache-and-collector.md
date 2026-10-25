# Shared card results and local collector

## Website cache

`PUBLIC_EBAY_CACHE` is a fetch-only SQLite Durable Object binding. The first
deployment adds the `public-ebay-cache-v1` migration; no routing or DNS change.
Only public affiliate searches use it. Dashboard selling/inventory operations
keep their existing behavior.

Each normalized search (query, campaign, limit, listing type, price filter and
sort) has one globally coordinated object. Its persistent result is fresh for
three hours. A later visit serves a recent saved result immediately and starts
one shared refresh. Concurrent cold requests await the same refresh. At five
hours 55 minutes the old eBay result stops displaying. Alarms clean up expired
snapshots; failed refreshes back off. The existing global eBay quota pause still
applies. Layered parsed/article caches preserve the upstream timestamp rather
than extending the lifetime of an old price/photo.

This reduces duplicate searches, but distinct cards/search queries still use
quota. It does not restore today's exhausted quota or guarantee a photo for
every printing. There is no background full-catalog scan. No new Supabase
tables, queries, or private data caches were added.

## Local Chrome collector

Source: `extensions/pricecharting-collector/`. Load unpacked using its README.
One-click baseball/football directory discovery queues eligible linked sets.
Direct set URLs and pasted URL lists also work. The queue uses normal public
pages, includes variants, saves each batch in local Chrome storage, and pauses
for source access challenges or stalled pagination. It retains missing-image
card identities. It does not manufacture photos or publish automatically.

`scripts/import-reference-capture.mjs` produces a dry-run review report by
default. An explicit `--write` imports only exact validated sports matches into
the existing reference-image seeds. Review rights and printing matches before
deploying. PriceCharting reference URLs do not grant image-republication rights.

## Verification

- `tests/public-ebay-cache.test.mjs`: 100 concurrent cold calls produce one
  upstream request; stale calls return immediately; background refreshes are
  shared; global quota pause, expiry, refreshed alarms and source age checked.
- `tests/pricecharting-collector.test.mjs`: DOM rows, card numbers, finishes,
  print runs, photos, missing photos, URL boundaries, persisted pause/resume,
  exports and exact import matching.
- Existing sports checklist, numbered parallel, article, baseball/football
  catalog and category SEO tests cover surrounding storefront behavior.

The extension is packaged for installation, not installed automatically.
Full installed-extension operation still requires loading it in Chrome.
