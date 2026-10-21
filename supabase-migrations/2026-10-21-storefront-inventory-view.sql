-- Storefront catalog projection (2026-10-21).
--
-- The Worker's public catalog load (fetchAllListableStorefrontItems) asked
-- PostgREST for ~100 separate data->'key' fields per inventory row. Postgres
-- de-TOASTs the whole data document once per field, so each load re-read
-- every row ~100 times and spilled its sort to temp files -- about 2.4s and
-- 5MB of temp writes per load, 1,079 loads in five hours, which is what
-- drained the Free plan's disk IO budget (see the 2026-10-19/20 outage notes
-- in scripts/public-catalog-cache.mjs). This view builds the same allowlisted
-- data object with one jsonb_each pass per row.
--
-- The key list must match STOREFRONT_DATA_KEYS in cloudflare-worker-full.js
-- (plus raw and externalRefs, read for their ids); a test checks it.
-- Only the Worker (service_role) reads it -- anon/authenticated get nothing,
-- and security_invoker keeps inventory_items' own RLS in force for anyone else.
create or replace view public.storefront_inventory with (security_invoker = true) as
select i.id, i.store_id, i.status, i.created_at, i.updated_at,
  (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
     from jsonb_each(i.data) e
    where e.key = any (array['archivedAt', 'brand', 'cardNumber', 'cardSubset', 'category', 'checklistSection', 'collectorNumber', 'collector_number', 'comicMetadata', 'condition', 'configuration', 'customUrl', 'description', 'dropship', 'ean', 'finish', 'focComicDetail', 'focReceivedAt', 'game', 'grade', 'grader', 'grading_company', 'gtin', 'image', 'imageUrl', 'image_url', 'images', 'img', 'isSealed', 'is_relic', 'is_sealed', 'is_signed', 'isbn', 'itemType', 'item_type', 'language', 'lifecycle', 'linkUrl', 'manufacturer', 'manufacturerPartNumber', 'manufacturer_part_number', 'market', 'marketPrice', 'minPrice', 'mpn', 'name', 'number', 'onlineListed', 'photo', 'photoDataUrl', 'photos', 'player', 'priceOverride', 'priceRule', 'productType', 'product_type', 'qty', 'quantity', 'rarity', 'rawMarketPrice', 'reviews', 'scryfallId', 'scryfall_id', 'series', 'set', 'setCode', 'set_code', 'showSoldOut', 'signature_value', 'signed_by', 'sku', 'soldAt', 'sold_at', 'source', 'sport', 'status', 'subject', 'subset', 'supplierAvailability', 'supplierCategoryPaths', 'supplierSellingUnit', 'supplierSku', 'supplierSpecifications', 'supplierUpc', 'tcgPlayerId', 'tcgplayerId', 'tcgplayerProductId', 'team', 'thumbnail', 'title', 'treatment', 'type', 'upc', 'variant', 'vendor', 'year', 'raw', 'externalRefs'])) as data
from public.inventory_items i;

revoke all on public.storefront_inventory from public, anon, authenticated;
grant select on public.storefront_inventory to service_role;
