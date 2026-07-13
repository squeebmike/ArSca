import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard=fs.readFileSync(new URL('../dashboard.html',import.meta.url),'utf8');
const worker=fs.readFileSync(new URL('../cloudflare-worker-full.js',import.meta.url),'utf8');
const routing=fs.readFileSync(new URL('../scripts/query-routing.js',import.meta.url),'utf8');
const offline=fs.readFileSync(new URL('../scripts/pricecharting/offline-browser.js',import.meta.url),'utf8');
const builder=fs.readFileSync(new URL('../scripts/pricecharting/build-offline-bundle.mjs',import.meta.url),'utf8');

assert.match(dashboard,/onkeydown="if\(event\.key==='Enter'\)\{event\.preventDefault\(\);runPriceLookup\(\)\}"/,'Enter should submit research immediately');
assert.match(dashboard,/if\(typeof done === 'function'\) done\(\);/,'voice final result should submit immediately');
assert.doesNotMatch(dashboard,/if\(typeof done === 'function'\) setTimeout\(done, 100\)/,'voice search must not keep the old delay');
assert.match(dashboard,/UPDATE SELECTED \(\$\{selectedKeys\.length\}\)/,'offline catalogs should update only the device selection');
assert.match(dashboard,/return \{mtg:true,video_games:false,yugioh:false,one_piece:false\}/,'new devices should choose optional catalogs instead of downloading all');

const lookup=dashboard.slice(dashboard.indexOf('async function runPriceLookup()'),dashboard.indexOf('async function fetchComicVineCover'));
assert.ok(lookup.indexOf('const mySeq = ++_qplSearchSeq') < lookup.indexOf('resolveMtgTcgplayerProductRows'), 'sequence guard must start before exact-product async work');
assert.match(dashboard,/\/pricing\/tcgplayer\/product\//,'sealed TCGplayer exact-ID route must be wired');
assert.match(dashboard,/tcgplayerSealedProductToQplRow/,'sealed TCGplayer response must render as a priced product row');
assert.match(worker,/mpapi\.tcgplayer\.com\/v2\/product/,'Worker must proxy exact-ID marketplace pricepoints with CORS');
assert.match(lookup,/\.\.\.cachedResults, \.\.\.liveResults/, 'live results must merge with already-rendered cached results');
assert.match(dashboard,/await Promise\.allSettled\(providerTasks\)/, 'independent catalog providers must run concurrently');
assert.match(dashboard,/const pokemonOnly = plannedCategories\.has\('pokemon'\)/, 'Pokemon searches must be isolated from generic providers');
assert.doesNotMatch(dashboard,/queueProvider\([^\n]+fetchPriceChartingCsvCatalog\(q,cat\)/, 'retired PriceCharting CSV search must not run in live research');
assert.doesNotMatch(dashboard,/queueProvider\([^\n]+fetchPokemonCatalog\(q\)/, 'direct PokemonTCG browser requests must not run in live research');
assert.match(dashboard,/fetchPokemonSealedProductExact\(product\.productId\)/, 'Pokemon TCGplayer IDs must try PPT sealed-product resolution');
assert.match(dashboard,/pricing\/justtcg\/tcgplayer\//, 'TCGplayer product IDs must resolve through an exact provider route');
assert.match(dashboard,/^\s*} else if\(\/\^\\d\{5,8\}\$\/\.test\(text\)\)/m, 'bare TCGplayer product IDs must work without a preselected category');
assert.doesNotMatch(dashboard,/searchPriceChartingOfflineCatalog\('sports'/, 'sports must use live providers because no CSV export is available');
assert.doesNotMatch(dashboard,/searchPriceChartingOfflineCatalog\('comics'/, 'comics must use live providers and its saved-search cache because no CSV export is available');
assert.match(worker,/catalog\\\/pricecharting\\\/\(\[a-z0-9_\]\+\)/, 'Worker must serve shared PriceCharting manifests and downloads');
assert.match(routing,/exact sealed product type/, 'sealed product type must affect ranking');
assert.match(routing,/intent\.confidenceByCategory\.pokemon>0/, 'Pokemon sealed API must only run for Pokemon intent');
assert.match(offline,/checksum mismatch/, 'offline imports must verify bundle checksums');
assert.match(builder,/manifest\.json/, 'business download builder must publish versioned manifests');

console.log('research pipeline contract tests passed');
