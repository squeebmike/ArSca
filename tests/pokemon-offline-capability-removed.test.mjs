import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const sca = fs.readFileSync('sca.html', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// Store report: switching to a phone hotspot at vending shows instead of
// paying for a pricier "offline capable" PokemonPriceTracker plan -- the
// live API plan is kept, but every bit of machinery built to browse/search
// Pokemon prices without a network connection (bulk CSV export sync, a
// daily-synced set+price snapshot, bulk card-image harvesting, an
// offline_first/online_only/offline_only search mode, and the offline
// banner/cache UI) needed to come out, in dashboard.html, the mobile
// scanner (sca.html), and the Worker's backing routes -- while the LIVE
// PokemonPriceTracker lookups (search, exact hydration, sealed products,
// parse-title) keep working exactly as before.

// ── dashboard.html: no offline-search machinery left ──
for (const gone of [
  'searchPokemonOfflineCache', 'pokemonOfflineCatalogAvailable', 'pokemonOfflineSearchMode',
  'setPokemonOfflineSearchMode', 'savePokemonCacheResults', 'setPokemonOfflineBanner',
  'searchPokemonCatalogExport', 'searchPokemonSealedCatalogLocal', 'pokemonOfflineCardToQplRow',
  'pokemonOfflineSealedToQplRow', 'downloadPokemonExport', 'clearPokemonExport',
  'syncPokemonPricesFromCloud', 'POKEMON_PRICES_CLOUD_TYPES', 'PPT_EXPORT_TYPES',
  'pokemonCatalogExportSets', 'pokemonCatalogExportCardsBySet', 'ArsCaPokemonOfflineImages',
  'syncPokemonOfflineSets', 'syncPokemonOfflineImages', 'clearPokemonOfflineImages',
  'ensureOfflineCachePanel', 'renderOfflineCachePanel', 'pokemonPrepForShow',
  'pstWriteCard', 'pstSyncOneSet', 'resolvePokemonCatalogImageUrl',
  'resolvePokemonCatalogImagesForVisibleCards', 'pokemon-offline-banner',
]) {
  assert.ok(!dashboard.includes(gone), `dashboard.html must not contain ${gone} -- Pokemon offline capability must be fully removed, not just hidden`);
}

// ── dashboard.html: the live PPT lookups this all sat on top of must still work ──
for (const kept of [
  'searchPokemonPriceTrackerCards', 'searchPokemonSealedProducts', 'parsePokemonPriceTrackerTitle',
  'fetchPokemonPriceTrackerExactDetail', 'applyPokemonPriceTrackerPrice', 'pokemonPriceTrackerCardToQplRow',
]) {
  assert.ok(dashboard.includes(kept), `dashboard.html must still contain ${kept} -- live PokemonPriceTracker lookups must be untouched`);
}

// A Pokemon search while offline must fail closed with a clear reconnect
// message instead of silently returning nothing or crashing on a removed
// offline path.
assert.match(dashboard, /if\(wantsPokemon && !navigator\.onLine\)\{el\.innerHTML='<div style="color:var\(--gold\)">Pokemon pricing requires the live PokemonPriceTracker API\. Reconnect and search again\.<\/div>';return;\}/,
  'an offline Pokemon search must show a reconnect message, not attempt a removed offline lookup');

// The live per-card price-hydration cache (walkoff_pokemon_cache_v1/cards --
// avoids re-spending a PPT credit on a card already exact-hydrated recently)
// and the live Comps panel are NOT offline browsing capability -- they back
// live/online features and must survive this removal.
assert.match(dashboard, /function pokemonOfflineDb\(\)\{/, 'the live price-hydration + comps IndexedDB wrapper must still exist');
assert.match(dashboard, /async function cachePokemonPriceTrackerCard\(row = \{\}, card = null\)\{/, 'the live exact-hydration cache writer must still exist');
assert.match(dashboard, /async function savePokemonCompsFromRow\(row = \{\}, cardKey = pokemonCardKey\(row\)\)\{/, 'the live Comps panel writer must still exist');

// ── sca.html: the mobile scanner had its own, separate Pokemon offline cache ──
for (const gone of ['scannerSavePokemonCache', 'scannerSearchPokemonCache', 'scannerPokemonDb', 'scannerPokemonIntent']) {
  assert.ok(!sca.includes(gone), `sca.html must not contain ${gone} -- the scanner's own Pokemon offline cache must be removed too`);
}
assert.ok(sca.includes('scannerUnifiedSearch'), 'sca.html must still search live -- only the offline cache layer around it is gone');

// ── cloudflare-worker-full.js: offline bulk/backend routes gone, live routes kept ──
for (const gone of [
  "'/catalog/pokemon/manifest'", "'/catalog/pokemon/download'", "'/catalog/pokemon/prices/manifest'",
  "'/catalog/pokemon/prices/download'", "'/catalog/pokemon/images/manifest'", "'/catalog/pokemon/image'",
  "'/pricing/pokemon/export'", 'POKEMON_CATALOG_FILE_TYPES', 'POKEMON_IMAGE_SIZES', 'POKEMON_PRICES_FILE_TYPES',
]) {
  assert.ok(!worker.includes(gone), `cloudflare-worker-full.js must not contain ${gone} -- the offline bulk/backend routes must be fully removed`);
}
assert.ok(worker.includes("startsWith('/pricing/pokemonpricetracker/')"), 'the live PokemonPriceTracker proxy route must be untouched');

console.log('Pokemon offline capability removal contract checks passed');
