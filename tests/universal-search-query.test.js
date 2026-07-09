const assert = require('assert');
const fs = require('fs');
const path = require('path');
const adapter = require('../scripts/query-routing');

const root = path.resolve(__dirname, '..');
const dashboard = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'cloudflare-worker-full.js'), 'utf8');

for(const input of ['143/142', '143 / 142', '143 slash 142', '143 over 142', '143 out of 142', 'number 143 of 142']){
  assert.equal(adapter.normalizeUserQuery(input).normalized, '143/142', `slash normalization failed: ${input}`);
}
assert.ok(adapter.normalizeUserQuery('pikachu SWSH050').collectorNumbers.includes('SWSH050'));
assert.ok(adapter.normalizeUserQuery('randy johnson 75YA-RJ').collectorNumbers.includes('75YA-RJ'));

const pokemon = adapter.buildSearchPlan('charizard ex 199/165', 'Pokemon TCG');
assert.deepEqual(pokemon.intent.inferredCategories, ['pokemon']);
assert.equal(pokemon.adapters[0].route, '/pricing/pokemon/cards');
assert.ok(pokemon.adapters[0].queries[0].includes('199/165'));
assert.equal(pokemon.adapters[0].filters.limit, 5);

const griffey = adapter.buildSearchPlan('griffey 89 upper deck #1', 'Sports Card');
const griffeyQueries = adapter.queriesFor(griffey, 'sports', 'SportsCardsPro');
assert.equal(griffeyQueries[0], '1989 Upper Deck Ken Griffey Jr #1');
assert.ok(griffeyQueries.length <= 5);
assert.ok(griffey.adapters.some(a => a.provider === 'PriceCharting' && a.filters.endpoint === '/api/products'));

const sportsRanked = adapter.mergeAndRankResults([
  { source:'sportscardspro', name:'1990 Star Ken Griffey Jr Blue', set:'1990 Star', card_number:'1', year:'1990', category:'Sports Cards' },
  { source:'sportscardspro', name:'Ken Griffey Jr #1', set:'1989 Upper Deck Baseball', card_number:'1', year:'1989', category:'Sports Cards' }
], griffey);
assert.match(sportsRanked[0].set, /1989 Upper Deck/);
assert.ok(sportsRanked[0].searchExplain.matchedOn.includes('exact card number'));

const randy = adapter.buildSearchPlan('randy johnson 75ya-rj', 'Sports Card');
assert.match(adapter.queriesFor(randy, 'sports', 'SportsCardsPro')[0], /75YA-RJ/);

const jordan = adapter.buildSearchPlan('jordan fleer 57', 'Sports Card');
assert.equal(adapter.queriesFor(jordan, 'sports', 'SportsCardsPro')[0], '1986 Fleer Michael Jordan #57');

const comic = adapter.buildSearchPlan('asm 300 venom', 'Comic');
assert.equal(comic.intent.inferredCategories[0], 'comic');
assert.match(adapter.queriesFor(comic, 'comic', 'PriceCharting')[0], /amazing spider-man #300/i);
assert.equal(comic.adapters[0].filters.endpoint, '/api/products');

const comicCases = [
  ['asm 300', /amazing spider-man #300/i],
  ['tmnt 1 mirage', /teenage mutant ninja turtles #1 mirage/i],
  ['spawn 1 newsstand', /spawn #1 newsstand/i],
  ['hulk 181', /incredible hulk #181/i],
  ['x-men 266', /x-men #266/i],
  ['tec 27', /detective comics #27/i],
  ['walking dead 1', /the walking dead #1/i]
];
for(const [input, expected] of comicCases){
  const plan = adapter.buildSearchPlan(input, 'Comic');
  assert.match(adapter.queriesFor(plan, 'comic', 'PriceCharting')[0], expected, `comic query expansion failed: ${input}`);
}

const spawnPlan = adapter.buildSearchPlan('spawn 1 newsstand', 'Comic');
const comicRanked = adapter.mergeAndRankResults([
  { source:'PriceCharting', productId:'direct', name:'Spawn #1 Direct Edition', category:'Comic' },
  { source:'PriceCharting', productId:'newsstand', name:'Spawn #1 Newsstand', category:'Comic' },
  { source:'PriceCharting', productId:'facsimile', name:'Spawn #1 Facsimile Reprint', category:'Comic' }
], spawnPlan);
assert.equal(comicRanked[0].productId, 'newsstand');
assert.ok(comicRanked[0].searchExplain.matchedOn.includes('variant/edition match'));

const originalPlan = adapter.buildSearchPlan('asm 300', 'Comic');
const originalRanked = adapter.mergeAndRankResults([
  { source:'PriceCharting', productId:'facsimile', name:'Amazing Spider-Man #300 Facsimile Reprint', category:'Comic' },
  { source:'PriceCharting', productId:'original', name:'Amazing Spider-Man #300', category:'Comic' }
], originalPlan);
assert.equal(originalRanked[0].productId, 'original');

const mtg = adapter.buildSearchPlan('deathtouch landfall', 'Magic: The Gathering');
assert.equal(mtg.intent.inferredCategories[0], 'mtg');
assert.equal(adapter.queriesFor(mtg, 'mtg', 'Scryfall')[0], 'o:deathtouch o:landfall');
assert.equal(mtg.adapters[0].filters.mode, 'oracle');
assert.match(adapter.queriesFor(adapter.buildSearchPlan('rhystic', ''), 'mtg', 'Scryfall')[0], /Rhystic Study/);
assert.equal(adapter.buildSearchPlan('Arcane Signet', '').intent.inferredCategories[0], 'mtg');
assert.equal(adapter.buildSearchPlan('Command Tower', '').intent.inferredCategories[0], 'mtg');
assert.match(adapter.queriesFor(adapter.buildSearchPlan('Arcane Signet', ''), 'mtg', 'Scryfall')[0], /^arcane signet$/i);
assert.match(adapter.queriesFor(adapter.buildSearchPlan('Command Tower', ''), 'mtg', 'Scryfall')[0], /^command tower$/i);

const sealed = adapter.buildSearchPlan('151 booster bundle', '');
assert.ok(sealed.intent.inferredCategories.includes('sealed'));
assert.ok(sealed.adapters.some(a => a.route === '/pricing/pokemon/sealed-products'));

const mtgSealed = adapter.buildSearchPlan('Magic The Gathering Marvel Super Heroes Play Booster Display', 'Sealed');
assert.ok(mtgSealed.intent.inferredCategories.includes('sealed'));
assert.ok(mtgSealed.adapters.some(a => a.provider === 'TCGplayerProduct' && a.route === 'local:tcgplayer-product'));
assert.ok(mtgSealed.adapters.some(a => a.route === '/pricing/pokemon/sealed-products'));
assert.match(dashboard, /data-cat="Sealed"[^>]*>SEALED/);
assert.match(dashboard, /parseTcgplayerProductInput/);
assert.match(dashboard, /tcgplayer_product_url/);
assert.match(dashboard, /isMtgSealedSearchIntent/);
assert.match(dashboard, /mtgSealedCardSearchQuery/);
assert.match(dashboard, /tcgplayer_search_link/);
assert.match(dashboard, /effectiveCategory === 'sealed' \? sealedPcCat/);
assert.match(dashboard, /secret\\s\*lair.*key === 'mtg'/s);
assert.match(dashboard, /parsePriceChartingProductInput/);
assert.match(dashboard, /tcgPlayerId:c\.tcgplayer_id/);
assert.match(dashboard, /item\.raw\?\.purchase_uris\?\.tcgplayer/);
assert.match(dashboard, /SPORTS SETS/);
assert.match(dashboard, /openSportsSetBrowserFromResearch/);
assert.match(dashboard, /resolveMtgTcgplayerProductRows/);
assert.match(dashboard, /TCGplayer MTG URL resolved through local MTG catalog/);
assert.match(dashboard, /PriceCharting offline condition guide estimate/);
assert.match(dashboard, /isMtgItem \? 'magic'/);

const julio = adapter.buildSearchPlan('Julio Logoman', '');
assert.equal(julio.intent.inferredCategories[0], 'sports');
assert.match(adapter.queriesFor(julio, 'sports', 'SportsCardsPro')[0], /Julio Rodriguez.*Logoman/i);

const ohtani = adapter.buildSearchPlan('Ohtani Cosmic Uranus', '');
assert.equal(ohtani.intent.inferredCategories[0], 'sports');
assert.match(adapter.queriesFor(ohtani, 'sports', 'SportsCardsPro')[0], /Shohei Ohtani.*Cosmic Uranus/i);

const psaCharmander = adapter.buildSearchPlan('PSA 10 Charmander', '');
assert.ok(psaCharmander.intent.inferredCategories.includes('graded'));
assert.ok(psaCharmander.adapters.some(a => a.category === 'graded' && a.provider === 'PriceCharting'));
assert.match(adapter.queriesFor(psaCharmander, 'graded', 'PriceCharting')[0], /PSA 10 Charmander/i);
assert.doesNotMatch(adapter.queriesFor(psaCharmander, 'graded', 'PriceCharting')[0], /#10/);

assert.match(worker, /pcFetch\('\/api\/products'/, 'PriceCharting search must use multi-result /api/products');
assert.match(worker, /pcFetch\('\/api\/product'/, 'PriceCharting detail must use /api/product by id');
assert.match(dashboard, /_qplSearchSeq/, 'active search guard must remain present');
assert.match(dashboard, /qplSearchStillActive/, 'adapter must integrate with stale-response guard');
assert.match(dashboard, /plannedCategories\.has\('graded'\)/, 'graded search plans must execute live PriceCharting lookups');
assert.match(dashboard, /effectiveCategory === 'graded' \? gradedPcCat/, 'graded PriceCharting searches must choose Pokemon, comics, or sports category from the query');
assert.match(dashboard, /limit:'5'/, 'normal Pokemon search must cap results at five');
assert.match(dashboard, /Graded 9\.8 estimate/, 'comic UI must use neutral graded estimate labels');
assert.match(dashboard, /\/pricing\/pricecharting\/product\//, 'comic refresh must hydrate the exact selected PriceCharting product');
assert.match(dashboard, /userPhotoBlobKey/, 'comic user photos must persist by IndexedDB key');
assert.doesNotMatch(dashboard, /PRICECHARTING_TOKEN\s*=|POKEMONPRICE_API_KEY\s*=\s*['"][^'"]+/, 'dashboard must not contain provider secrets');

console.log('Universal search adapter checks passed');
