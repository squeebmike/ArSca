import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// index-all.json and pokemon/manifest.json's setsCovered/allSetsCovered fields
// are both written only once, after every set in a run finishes -- the
// "Build Pokemon Offline Card Images" Action can run for hours across
// hundreds of sets and get killed by its own timeout before ever reaching
// that last step, even though each finished set's own index-set-<id>.json
// already landed in R2 along the way (confirmed: the one real run so far
// hit its 300-minute timeout and was cancelled). The manifest route for
// set=all must fall back to merging whatever per-set indexes already exist
// in R2 instead of 404ing just because index-all.json specifically is
// missing.
const manifestRouteStart = worker.indexOf("url.pathname === '/catalog/pokemon/images/manifest'");
assert(manifestRouteStart >= 0, 'Missing /catalog/pokemon/images/manifest route');
const manifestRouteEnd = worker.indexOf("url.pathname === '/catalog/pokemon/image'", manifestRouteStart);
assert(manifestRouteEnd > manifestRouteStart, 'Could not bound the manifest route source');
const manifestRoute = worker.slice(manifestRouteStart, manifestRouteEnd);

assert.match(manifestRoute, /env\.MTG_CATALOG_R2\.list\(\s*\{\s*prefix:\s*'pokemon\/images\/index-set-'/,
  'set=all must fall back to listing per-set indexes when index-all.json is missing');
assert.match(manifestRoute, /cachedAllIndex/, 'set=all must still prefer the precomputed index-all.json when it exists, for the common fast path');
assert.match(manifestRoute, /listing\.truncated/, 'the R2 list() fallback must page through truncated results, not just the first page');
assert.match(manifestRoute, /if \(!mergedIds\.size\) return json\(\{ ok: false, error: 'All-sets image index not built yet/,
  'must only 404 once the merge finds zero ids across every per-set index (i.e. genuinely nothing built yet)');

// /pricing/pokemon/export used to check the raw sub:store: KV record
// directly instead of going through storeHasSubscriptionAccess() like
// every other PokemonPriceTracker route -- that skipped the complimentary
// S Rank entitlement check, so an S Rank store that could use
// /pricing/pokemon/cards would still get 402'd trying to bulk-export
// cards/sealed/ebay/population CSVs.
const exportRouteStart = worker.indexOf("url.pathname === '/pricing/pokemon/export'");
assert(exportRouteStart >= 0, 'Missing /pricing/pokemon/export route');
const exportRouteEnd = worker.indexOf('let upRes;', exportRouteStart);
assert(exportRouteEnd > exportRouteStart, 'Could not bound the export route subscription-check source');
const exportRoute = worker.slice(exportRouteStart, exportRouteEnd);

assert.match(exportRoute, /if \(!bypassIds2\.includes\(pptStoreId2\) && !ownerIds2\.includes\(pptStoreId2\) && env\.LBA_KV\) \{/,
  '/pricing/pokemon/export must still gate on bypass/owner store ids only -- no demo/empty-storeId exemption');
assert.match(exportRoute, /storeHasSubscriptionAccess\(env, pptStoreId2\)/,
  'export route must reuse storeHasSubscriptionAccess() so S Rank entitlements are honored the same as every other PPT route');
assert.doesNotMatch(exportRoute, /s2 === 'active' \|\| s2 === 'trialing'/,
  'must not fall back to re-deriving active/trialing status by hand once storeHasSubscriptionAccess() already covers it');

console.log('Pokemon offline images manifest + export subscription contract checks passed');
