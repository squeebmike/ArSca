# Pocket Scout

Universal thrift/resale item scanner: photograph almost anything (not just
cards), get an identity, a value read, and a buy/pass call, before
committing to the purchase.

## Architecture

One scan session = one physical item, and can hold 1-10 photos. Each photo
upload runs Claude vision identification and eBay's image-search Browse API
endpoint concurrently, fuses the result into the session's running identity
(preferring whichever photo had higher per-field confidence rather than
letting the newest photo silently overwrite an earlier read), and returns
comps (active listings + sold comps where available) and a suggested next
photo in one response.

Reuses existing infrastructure rather than building a parallel system:

- **Sessions/candidates**: the previously unused `scan_sessions` /
  `scan_queue` tables (provisioned early in the project, never wired to any
  route) instead of new tables. `scan_sessions` = one row per item scan;
  `scan_queue` = one row per eBay candidate match, `status`
  pending/rejected tracks the comps-drawer "not a match" flow. Only
  `pocket_scout_images` (one row per photo) is genuinely new.
- **Vision call**: same Anthropic Messages API plumbing as `/identify/card`
  (the existing card-scanner route), just a general-purpose prompt instead
  of a card-specific one, folding OCR into the same call rather than a
  separate OCR provider.
- **eBay comps**: reuses `fetchEbayActiveListings` and `fetchEbaySoldComps`
  (already used elsewhere for deal-scanning), plus one new function,
  `fetchEbayImageSearch`, for the Browse API's `search_by_image` endpoint.
  Same app-level OAuth token as the existing active-listing search.
- **Photo storage**: same R2 bucket/binding as inventory photos
  (`MTG_CATALOG_R2`), under a `pocket-scout/` key prefix.
- **Rate limiting**: same KV fixed-window limiter (`enforceUsageLimit`)
  every other AI/vision route already uses.
- **Settings**: `store_settings.receipt_settings.pocketScout`, the same
  jsonb blob eBay auto-reprice settings already live in.
- **Add to inventory**: identical to every other "add to inventory" flow in
  the app -- client-side `getSupabaseClient().from('inventory_items').insert(...)`
  with the existing `generateWalkoffInventorySku()` SKU generator. No new
  inventory-writing backend route.

## Worker routes (`cloudflare-worker-full.js`)

- `POST /pocket-scout/session/start` -- begin a session.
- `POST /pocket-scout/session/photo?session_id=&image_type=&sequence=` --
  body is raw image bytes (client resizes to ~1600px/JPEG before sending).
  Uploads to R2, runs vision-identify + eBay image search concurrently,
  fuses identity, runs comp search, persists candidates + the photo row +
  the updated session, returns everything the result screen needs.
- `GET /pocket-scout/photo/pocket-scout/...` -- serves a stored photo.
- `POST /pocket-scout/session/candidate/reject` -- "not a match"; recomputes
  active comp stats from the remaining candidates.
- `POST /pocket-scout/session/manual-search` -- text-query fallback (same
  comp pipeline, no vision call) so a bad AI read never traps the employee.
- `POST /pocket-scout/session/close` -- records the buy/pass decision and
  (if bought) the resulting `inventory_item_id` on the session, for the
  future learning loop.
- `GET`/`POST /pocket-scout/settings` -- buy/pass thresholds.

## Database

Migration `pocket_scout_v1` (applied to the production Supabase project):

- `ALTER TABLE scan_sessions` -- added `identity_json`, `confidence`,
  `comp_snapshot_json`, `purchase_price`, `condition`, `sourcing_location`,
  `expected_profit_low/high`, `decision`, `inventory_item_id`,
  `actual_sale_price`, `actual_profit`, `updated_at`, plus indexes.
- `scan_queue` -- unchanged schema, new indexes only. Reused as the
  candidate table (`payload` jsonb holds source/title/image/price/etc).
- `CREATE TABLE pocket_scout_images` -- one row per photo (session_id,
  storage_path, image_type, sequence, ocr_json, barcode_json,
  analysis_json). RLS enabled, no client-facing policy -- written only via
  the Worker's service-role key, same convention as `inventory_items`
  backend mutations.

## Environment variables

No new secrets. Reuses:

- `ANTHROPIC_API_KEY` -- vision identify.
- `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` -- eBay app token (image search +
  active listings). `EBAY_APP_ID` -- Finding API sold comps.
- `MTG_CATALOG_R2` binding -- photo storage.
- `LBA_KV` binding -- rate limiting.

## What works today

- Multi-photo scan sessions with progressive results after the first photo.
- Real Claude vision identification (general-purpose, non-card items) with
  a next-best-photo suggestion baked into the same call, plus a static
  fallback table per category.
- Real eBay image search (`search_by_image`) and real eBay active-listing +
  sold-comp text search, deduped and merged.
- Evidence fusion across multiple photos (confidence-based, conflict-logged,
  not last-write-wins).
- Junk-listing filtering (lots, reprints, parts-only, empty boxes, etc) and
  median-first comp stats with outlier trimming.
- A real, testable, configurable profit/ROI/decision engine
  (BUY/MAYBE/PASS/GREAT BUY) that requires dollar profit AND ROI AND
  confidence together -- a high-ROI trivial-dollar item does not auto-buy.
- Comps drawer with per-candidate "not a match" rejection that live
  -recalculates pricing.
- Manual text-search fallback using the identical comp pipeline.
- Add-to-inventory with sourcing location, scan confidence, comp snapshots,
  and decision-at-purchase captured on the inventory row for the future
  learning loop.
- Configurable thresholds (min/preferred profit, min ROI, min confidence
  for auto-BUY, fee %, packaging allowance) via a settings panel.
- Card routing hint: an item the vision model confidently reads as a
  trading card surfaces a message pointing back at the existing card
  scanner instead of trying to duplicate that pipeline.

## What is stubbed / not built in this pass

- **`sca.html` (the `scanner_only` role's interface) was not touched.**
  That role is redirected straight past the full dashboard on login, so
  Pocket Scout is currently unreachable for scanner-only staff -- only
  employee/manager/admin/owner accounts using the full dashboard can use
  it. Extending `sca.html` is a separate, real piece of work.
- **No server-side image compression.** The client canvas-resizes to
  ~1600px JPEG before upload (satisfies "compress before external
  requests"), but there's no additional server-side resize/optimization
  pass, and no verification yet against Anthropic's real per-image size
  limits with an actual large phone photo.
- **eBay `search_by_image` is unverified against a live account.** The
  request/response contract is implemented per the Browse API's documented
  shape and reuses the exact same OAuth path as the already-working
  active-listing search, but this specific endpoint has never been called
  from this codebase before and has not been exercised against real eBay
  credentials in this session. First real deploy needs to confirm it
  actually returns image-similarity results and not a permissions error.
- **Candidate picker UI ("Which one is it?" swipeable cards with
  photo/year/brand diffs) was simplified** to a plain comps-drawer list
  with reject buttons, not the dedicated large-touch-target picker the
  original spec described.
- **Shippo is not wired in.** Shipping cost is a flat per-size-bucket
  settings value (tiny/small/medium/large/oversize), not a real Shippo
  quote -- consistent with the spec's own note that a full address
  shouldn't be required mid-store, but Shippo's zone-based estimate
  capability was never actually reachable in the existing integration (see
  prior feasibility review), so this stays a manual settings number rather
  than an API call.
- **No barcode decoding in this flow.** Pocket Scout relies on the vision
  model reading a UPC/EAN it can see printed as text; there's no
  `BarcodeDetector` pass over scan-session photos and no dedicated barcode
  capture step.
- **Card pipeline handoff is a UI hint only**, not a deep integration --
  when the vision model reads an item as a trading card, the result screen
  tells the employee to use the existing card scanner instead; it does not
  automatically invoke that pipeline or pass photos into it.
- **Sell-through / learning loop is schema-only.** `scan_sessions` has
  `actual_sale_price`/`actual_profit` columns and the inventory row carries
  `scanSessionId`/`decisionAtPurchase`/expected-profit fields, but nothing
  yet writes `actual_sale_price`/`actual_profit` back when the item
  eventually sells, and there is no dedicated `comp_snapshots` history
  table (the session only holds the latest snapshot, not a time series) or
  any analytics/reporting UI over this data.
- **No provider adapter files** (`providers/ebay.ts`, `providers/ocr.ts`,
  etc as literal files) -- this codebase is one large `cloudflare-worker-full.js`,
  not a modular app, so "provider abstraction" here means separate,
  independently callable functions (`fetchEbayImageSearch`,
  `fetchEbayActiveListings`, `fetchEbaySoldComps`, `pocketScoutVisionIdentify`)
  rather than a file-per-provider structure.
- **No manager-approval gate for MAYBE decisions** -- the
  `maybeRequiresApproval` setting exists in the defaults/schema but nothing
  enforces it yet.
- **No employee-attribution or sourcing-performance analytics** beyond the
  raw fields being captured (`employee`, `sourcingLocation` on the
  inventory row).

## Test steps (phone to inventory)

1. Deploy the Worker (`cloudflare-worker-full.js` changes) and confirm
   `/pocket-scout/settings` (GET) returns default thresholds for a real
   store.
2. Add `POKEMONPRICE_API_KEY`-style verification isn't needed here, but
   confirm `ANTHROPIC_API_KEY` and `EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET`
   are set as Worker secrets (already required for existing features).
3. On a phone, open the dashboard, sign in as an employee/manager/admin/
   owner, open the **POCKET SCOUT** tab.
4. Tap **SCAN ITEM**, then take a photo of a real secondhand item.
5. Confirm: a status line progresses (uploading -> reading label ->
   checking eBay -> comparing), then a result card appears with a title,
   confidence %, active/sold price, and a BUY/MAYBE/PASS badge.
6. Enter a store price, change condition/size, confirm the profit
   breakdown and decision update live.
7. Tap **VIEW COMPS**, reject an obviously wrong candidate, confirm the
   active median updates.
8. Tap **ADD ANOTHER PHOTO**, take a second photo (e.g. a tag or barcode),
   confirm the identity/confidence updates rather than resets.
9. Tap **BUY + ADD INVENTORY**, enter a sourcing location when prompted,
   confirm a toast with the generated SKU and that the item now appears in
   the Inventory tab with `source: pocket_scout` and the scan photos
   attached.
10. Tap **NEW ITEM**, repeat with a completely different object type to
    confirm sessions don't bleed into each other.
