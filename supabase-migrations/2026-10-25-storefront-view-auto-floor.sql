-- Storefront catalog view: add autoFloor (2026-10-25).
--
-- Each item now carries an automatic floor (autoFloor: cost + a minimum
-- profit after eBay fees, stamped by the dashboard -- see computeAutoFloor),
-- and the shop never prices below it. Same view as
-- 2026-10-21-storefront-inventory-view.sql with that one key added; the key
-- list must match STOREFRONT_DATA_KEYS in cloudflare-worker-full.js (plus raw
-- and externalRefs), and a test checks it.
create or replace view public.storefront_inventory with (security_invoker = true) as
select i.id, i.store_id, i.status, i.created_at, i.updated_at,
  (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
     from jsonb_each(i.data) e
    where e.key = any (array['archivedAt', 'brand', 'cardNumber', 'cardSubset', 'category', 'checklistSection', 'collectorNumber', 'collector_number', 'comicMetadata', 'condition', 'configuration', 'customUrl', 'description', 'dropship', 'ean', 'finish', 'focComicDetail', 'focReceivedAt', 'game', 'grade', 'grader', 'grading_company', 'gtin', 'image', 'imageUrl', 'image_url', 'images', 'img', 'isSealed', 'is_relic', 'is_sealed', 'is_signed', 'isbn', 'itemType', 'item_type', 'language', 'lifecycle', 'linkUrl', 'manufacturer', 'manufacturerPartNumber', 'manufacturer_part_number', 'market', 'marketPrice', 'autoFloor', 'minPrice', 'mpn', 'name', 'number', 'onlineListed', 'photo', 'photoDataUrl', 'photos', 'player', 'priceOverride', 'priceRule', 'productType', 'product_type', 'qty', 'quantity', 'rarity', 'rawMarketPrice', 'reviews', 'scryfallId', 'scryfall_id', 'series', 'set', 'setCode', 'set_code', 'showSoldOut', 'signature_value', 'signed_by', 'sku', 'soldAt', 'sold_at', 'source', 'sport', 'status', 'subject', 'subset', 'supplierAvailability', 'supplierCategoryPaths', 'supplierSellingUnit', 'supplierSku', 'supplierSpecifications', 'supplierUpc', 'tcgPlayerId', 'tcgplayerId', 'tcgplayerProductId', 'team', 'thumbnail', 'title', 'treatment', 'type', 'upc', 'variant', 'vendor', 'year', 'raw', 'externalRefs'])) as data
from public.inventory_items i;

revoke all on public.storefront_inventory from public, anon, authenticated;
grant select on public.storefront_inventory to service_role;
