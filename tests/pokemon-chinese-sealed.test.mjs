import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store ask: adding a sealed Simplified Chinese Pokemon 30th Celebration
// booster box (barcode 6942600405783). PokemonPriceTracker only prices
// English/Japanese product, so the Pokemon syncs must leave it alone, and
// the quick-add form must keep its barcode so SCAN TO CART finds it.

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
function extractFn(name, prefix = 'function ') {
  const start = dashboard.indexOf(prefix + name + '(');
  assert.ok(start >= 0, name + ' must exist in dashboard.html');
  return dashboard.slice(start, dashboard.indexOf('\n}', start) + 2);
}

const unpriced = new Function('inventoryCardName', 'inventorySetName',
  extractFn('pokemonUnpricedLanguage') + '\nreturn pokemonUnpricedLanguage;')(i => i.name || '', i => i.set || '');

assert.equal(unpriced({ name:'Pokemon 30th Celebration Booster Box', language:'Chinese (Simplified)' }), 'Chinese');
assert.equal(unpriced({ name:'30th Celebration Booster Box (Simplified Chinese)' }), 'Chinese', 'the name alone is enough');
assert.equal(unpriced({ name:'Some Box', language:'Chinese (Traditional)' }), 'Traditional Chinese');
assert.equal(unpriced({ name:'Some Box', language:'Korean' }), 'Korean');
assert.equal(unpriced({ name:'Charizard ex', language:'English' }), '');
assert.equal(unpriced({ name:'Pikachu', language:'Japanese' }), '', 'Japanese is priced by PokemonPriceTracker');
assert.equal(unpriced({ name:'Pikachu' }), '');

const live = extractFn('buildLivePokemonPriceSyncProposal', 'async function ');
assert.ok(live.indexOf('pokemonUnpricedLanguage(item)') < live.indexOf('fetchLivePokemonInventoryCard(item)'),
  'live Pokemon sync skips unpriced languages before any provider lookup');
assert.match(extractFn('buildPriceSyncProposal', 'async function '), /isPokemonInventorySyncItem\(i\) && !pokemonUnpricedLanguage\(i\)/,
  'cached scan skips unpriced languages too');

const add = extractFn('addManualBuiltInInventory', 'async function ');
assert.match(add, /upc:\(document\.getElementById\('built-upc'\)/, 'quick add saves the barcode');
assert.match(add, /language:document\.getElementById\('built-language'\)/, 'quick add saves the language');
assert.match(dashboard, /<option>Chinese \(Simplified\)<\/option>/);
assert.match(extractFn('labelBarcodeValue'), /item\.upc/, 'scan to cart matches on the saved barcode');
// Japanese singles: lookups must ask PokemonPriceTracker for Japanese,
// never fall back to an English card of the same name.
const pptLanguage = new Function('inventoryCardName', 'inventorySetName',
  extractFn('pokemonInventoryPptLanguage') + '\nreturn pokemonInventoryPptLanguage;')(i => i.name || '', i => i.set || '');
assert.equal(pptLanguage({ name:'Pikachu', language:'Japanese' }), 'japanese');
assert.equal(pptLanguage({ name:'Pikachu 001/SV-P Japanese' }), 'japanese');
assert.equal(pptLanguage({ name:'Pikachu' }), 'english');
const fetchLive = extractFn('fetchLivePokemonInventoryCard', 'async function ');
assert.match(fetchLive, /params\.set\('language', language\)/, 'exact-ID lookups send the language');
assert.equal((fetchLive.match(/limit:'20', language \}/g) || []).length, 2, 'card and sealed name searches send the language');
assert.match(extractFn('findCachedCardForInventoryItem'), /pokemonInventoryPptLanguage\(item\) === 'japanese'\) return null;/,
  'cached scan never name-matches a Japanese card to an English one');
// Research: a Chinese Pokemon search goes to PriceCharting and keeps only its
// Chinese Pokemon products.
{
  const queries = [];
  const products = [
    { productId:'1', productName:'Pikachu #001', consoleName:'Pokemon Chinese 30th Celebration', prices:{ ungraded:12.5 } },
    { productId:'2', productName:'30th Celebration Booster Box', consoleName:'Pokemon Chinese 30th Celebration', prices:{ ungraded:180 } },
    { productId:'3', productName:'Pikachu #001', consoleName:'Pokemon 30th Celebration', prices:{ ungraded:40 } },
    { productId:'4', productName:'Pikachu #001', consoleName:'Pokemon Japanese 30th Celebration', prices:{ ungraded:30 } },
  ];
  const fetchStub = async url => { queries.push(new URL(url).searchParams.get('q')); return { json:async () => ({ ok:true, products }) }; };
  const search = new Function('fetch', 'WORKER', 'isSealedProductIntent',
    extractFn('searchChinesePokemonPriceCharting', 'async function ') + '\nreturn searchChinesePokemonPriceCharting;')(
    fetchStub, 'https://worker.test', name => /booster box/i.test(name));
  const rows = await search('Pikachu 30th Celebration Simplified Chinese');
  assert.deepEqual(rows.map(r => r.productId), ['1', '2'], 'English and Japanese products are never offered for a Chinese search');
  assert.equal(queries[0], 'pokemon chinese Pikachu 30th Celebration');
  assert.equal(rows[0].language, 'Chinese (Simplified)');
  assert.equal(rows[0].market, 12.5);
  assert.equal(rows[1].is_sealed, true);
  assert.equal(rows[1].condition, 'Factory Sealed');
  assert.equal(rows[1].pricecharting.productId, '2', 'the PriceCharting link rides along into inventory');
  const catalog = extractFn('searchQuickCatalog', 'async function ');
  assert.ok(catalog.indexOf('isChinesePokemonQuery(q)') < catalog.indexOf('const isJapanese'), 'Chinese searches skip PokemonPriceTracker');
}

// Sync: a Chinese item linked to PriceCharting is priced from that product.
{
  const live = extractFn('buildLivePokemonPriceSyncProposal', 'async function ');
  assert.ok(live.indexOf("mode:'pc-live'") > 0 && live.indexOf("mode:'pc-live'") < live.indexOf('fetchLivePokemonInventoryCard(item)'));
  assert.match(live, /\/pricing\/pricecharting\/products\/batch/);
  assert.match(extractFn('applyPriceSyncEntry', 'async function '), /p\.mode === 'other-live' \|\| p\.mode === 'pc-live'/,
    'applying keeps the PriceCharting link and marks the price live');
  assert.doesNotMatch(dashboard, /: `<option value="English">English<\/option>`/, 'a Chinese result is not saved as English');
}
console.log('Pokemon Chinese sealed product checks passed');
