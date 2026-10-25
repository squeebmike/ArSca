# Shared offers and cloud card references

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

## Chrome collector — cloud edition 1.1.0

Source: `extensions/pricecharting-collector/`. Load unpacked using its README.
One-click baseball/football directory discovery queues eligible linked sets.
Direct set URLs and pasted URL lists also work. The queue uses normal public
pages, includes variants, uploads each batch directly to Cloudflare, and pauses
for source access challenges or stalled pagination. Missing-photo identities
are retained. The download/export controls and download permission are removed.

`CARD_REFERENCE_ARCHIVE` is a separate persistent SQLite Durable Object binding
with the additive `card-reference-archive-v1` migration. Each source set has its
own object and card-number family index; a catalog object holds small summaries.
Only metadata and source/image URLs are stored, never image bytes or prices.
No reference expiration or scheduled provider scan is added. A collector visit
updates a source record. Failed or empty-photo captures retain prior photos.

`/reference-collector/{batch,sets,cards}` require the Mana Pocket owner/admin
using existing dashboard authentication. The extension calls the dashboard's
scoped request helper in its main world, without copying or storing the auth
token. The dashboard tab must remain open and signed in. Chrome retains queue
progress, a tab ID, and one pending metadata batch until cloud acknowledgement.
Replay is idempotent. Version 1.0 set shards can be migrated through Sync earlier
captures; they are removed locally only after successful upload.

Public card-photo lookups read the archive via its internal binding, with no
Supabase queries. Source set, subject, number, finish and known run must match;
shared photos across different finishes are rejected as exact references.
The archive remains independent of eBay quota and offer expiration. Source
URLs do not grant image-republication rights. Other TCG image sources remain
unchanged; this website reference lookup currently serves sports checklists.

## Verification

- `tests/public-ebay-cache.test.mjs`: 100 concurrent cold calls produce one
  upstream request; stale calls return immediately; background refreshes are
  shared; global quota pause, expiry, refreshed alarms and source age checked.
- `tests/pricecharting-collector.test.mjs`: DOM rows, card numbers, finishes,
  print runs, photos, missing photos, URL boundaries, persisted pause/resume,
  cloud capture and exact legacy import matching.
- `tests/cloud-card-references.test.mjs`: owner-only writes, persistent cloud
  references, duplicate replay, source URL validation, wrong-printing rejection,
  website family lookup and extension outbox/bridge recovery.
- Existing sports checklist, numbered parallel, article, baseball/football
  catalog and category SEO tests cover surrounding storefront behavior.

The extension is packaged for installation, not installed automatically.
Full installed-extension operation still requires loading it in Chrome.
