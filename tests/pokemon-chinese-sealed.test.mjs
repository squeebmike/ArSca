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
console.log('Pokemon Chinese sealed product checks passed');
