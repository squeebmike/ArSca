import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store ask: "Add the typed price and ceiling filters." A typed List / Sale
// Price is saved as priceOverride and kept as typed (price syncs only move
// Market); a ceiling is ceilingPrice. Both get a FLAGS chip and a health card.
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const extractFn = (name, prefix = 'function ') => { const s = dashboard.indexOf(prefix + name + '('); assert.ok(s >= 0, name); return dashboard.slice(s, dashboard.indexOf('\n}\n', s) + 2); };

assert.match(dashboard, /<button class="fb" data-filter-group="flag" onclick="setF\('flag','typed_price',this\)"[^>]*>Typed Price<\/button>/);
assert.match(dashboard, /<button class="fb" data-filter-group="flag" onclick="setF\('flag','has_ceiling',this\)"[^>]*>Has Ceiling<\/button>/);
assert.match(extractFn('renderInventoryHealthPanel'), /\['typed_price','Typed Price',h\.typedPrice,'list price locked as typed'\],\s*\['has_ceiling','Has Ceiling',h\.hasCeiling,'capped at a max price'\],/);
assert.match(extractFn('inventoryHealthSummary'), /typedPrice:inStock\.filter\(i=>inventoryPriceOverride\(i\) > 0\)\.length,\s*hasCeiling:inStock\.filter\(i=>inventoryCeilingPrice\(i\) > 0\)\.length,/);

const matches = new Function('inventoryPriceOverride', 'inventoryCeilingPrice', 'inventoryNeedsSticker', 'inventoryImageUrl', 'qplCategoryKey', 'inventoryCostBasis', 'inventoryMarketPrice', 'inventoryIsPriceStale', 'inventoryProfitStats',
  extractFn('inventoryMatchesFlag') + '\nreturn inventoryMatchesFlag;')(
  i => Number(i.priceOverride ?? i.raw?.priceOverride ?? 0) || 0, i => Number(i.ceilingPrice ?? i.raw?.ceilingPrice ?? 0) || 0,
  () => false, () => 'x', () => '', () => 1, () => 1, () => false, () => ({ cost:0, list:0 }));
assert.equal(matches({ status:'in_stock', priceOverride:7 }, 'typed_price'), true);
assert.equal(matches({ status:'in_stock', priceOverride:0, market:6.69 }, 'typed_price'), false, 'list price that just follows market');
assert.equal(matches({ status:'in_stock', raw:{ ceilingPrice:10 } }, 'has_ceiling'), true);
assert.equal(matches({ status:'in_stock', ceilingPrice:0 }, 'has_ceiling'), false);
assert.equal(matches({ status:'sold', priceOverride:7, ceilingPrice:10 }, 'typed_price'), false, 'in-stock only, like the other flags');
console.log('Typed price + ceiling filter checks passed');
