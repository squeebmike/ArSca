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

const mtg = adapter.buildSearchPlan('deathtouch landfall', 'Magic: The Gathering');
assert.equal(mtg.intent.inferredCategories[0], 'mtg');
assert.equal(adapter.queriesFor(mtg, 'mtg', 'Scryfall')[0], 'o:deathtouch o:landfall');
assert.equal(mtg.adapters[0].filters.mode, 'oracle');
assert.match(adapter.queriesFor(adapter.buildSearchPlan('rhystic', ''), 'mtg', 'Scryfall')[0], /Rhystic Study/);

const sealed = adapter.buildSearchPlan('151 booster bundle', '');
assert.ok(sealed.intent.inferredCategories.includes('sealed'));
assert.ok(sealed.adapters.some(a => a.route === '/pricing/pokemon/sealed-products'));

assert.match(worker, /pcFetch\('\/api\/products'/, 'PriceCharting search must use multi-result /api/products');
assert.match(worker, /pcFetch\('\/api\/product'/, 'PriceCharting detail must use /api/product by id');
assert.match(dashboard, /_qplSearchSeq/, 'active search guard must remain present');
assert.match(dashboard, /qplSearchStillActive/, 'adapter must integrate with stale-response guard');
assert.match(dashboard, /limit:'5'/, 'normal Pokemon search must cap results at five');
assert.doesNotMatch(dashboard, /PRICECHARTING_TOKEN\s*=|POKEMONPRICE_API_KEY\s*=\s*['"][^'"]+/, 'dashboard must not contain provider secrets');

console.log('Universal search adapter checks passed');
