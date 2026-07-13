import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard=fs.readFileSync(new URL('../dashboard.html',import.meta.url),'utf8');
const worker=fs.readFileSync(new URL('../cloudflare-worker-full.js',import.meta.url),'utf8');
const routing=fs.readFileSync(new URL('../scripts/query-routing.js',import.meta.url),'utf8');
const offline=fs.readFileSync(new URL('../scripts/pricecharting/offline-browser.js',import.meta.url),'utf8');
const builder=fs.readFileSync(new URL('../scripts/pricecharting/build-offline-bundle.mjs',import.meta.url),'utf8');

const lookup=dashboard.slice(dashboard.indexOf('async function runPriceLookup()'),dashboard.indexOf('async function fetchComicVineCover'));
assert.ok(lookup.indexOf('const mySeq = ++_qplSearchSeq') < lookup.indexOf('resolveMtgTcgplayerProductRows'), 'sequence guard must start before exact-product async work');
assert.match(lookup,/\.\.\.cachedResults, \.\.\.liveResults/, 'live results must merge with already-rendered cached results');
assert.match(dashboard,/await Promise\.allSettled\(providerTasks\)/, 'independent catalog providers must run concurrently');
assert.match(dashboard,/const pokemonOnly = plannedCategories\.has\('pokemon'\)/, 'Pokemon searches must be isolated from generic providers');
assert.doesNotMatch(dashboard,/queueProvider\([^\n]+fetchPriceChartingCsvCatalog\(q,cat\)/, 'retired PriceCharting CSV search must not run in live research');
assert.doesNotMatch(dashboard,/queueProvider\([^\n]+fetchPokemonCatalog\(q\)/, 'direct PokemonTCG browser requests must not run in live research');
assert.match(dashboard,/fetchPokemonSealedProductExact\(product\.productId\)/, 'Pokemon TCGplayer IDs must try PPT sealed-product resolution');
assert.match(dashboard,/pricing\/justtcg\/tcgplayer\//, 'TCGplayer product IDs must resolve through an exact provider route');
assert.match(dashboard,/^\s*} else if\(\/\^\\d\{5,8\}\$\/\.test\(text\)\)/m, 'bare TCGplayer product IDs must work without a preselected category');
assert.match(dashboard,/searchPriceChartingOfflineCatalog\('sports'/, 'sports research must use the shared offline snapshot');
assert.match(dashboard,/searchPriceChartingOfflineCatalog\('comics'/, 'comics research must use the shared offline snapshot');
assert.match(worker,/catalog\\\/pricecharting\\\/\(sports\|comics\)/, 'Worker must serve shared PriceCharting manifests and downloads');
assert.match(routing,/exact sealed product type/, 'sealed product type must affect ranking');
assert.match(routing,/intent\.confidenceByCategory\.pokemon>0/, 'Pokemon sealed API must only run for Pokemon intent');
assert.match(offline,/checksum mismatch/, 'offline imports must verify bundle checksums');
assert.match(builder,/manifest\.json/, 'business download builder must publish versioned manifests');

console.log('research pipeline contract tests passed');
