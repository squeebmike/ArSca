import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const buildScript = fs.readFileSync('scripts/mtg/build-mtg-offline-images.mjs', 'utf8');
const clientModule = fs.readFileSync('scripts/mtg/mtg-offline-images-browser.js', 'utf8');
const workflow = fs.readFileSync('.github/workflows/mtg-offline-images.yml', 'utf8');

// MTG never had a bulk card-image pipeline -- only an opportunistic
// per-search cache (ArsCaMtgOffline.cacheImage) that only ever caches a
// card actually searched for while online. This mirrors Pokemon's existing
// image pipeline (build server-side once, sync in bulk to devices) so MTG
// gets the same "search offline, images still show" experience.

// ── Worker routes ───────────────────────────────────────────────────────
assert.match(worker, /const MTG_IMAGE_SIZES = new Set\(\['small', 'normal'\]\);/, 'must define the two cached MTG image sizes');

const manifestRouteStart = worker.indexOf("url.pathname === '/catalog/mtg/images/manifest'");
assert(manifestRouteStart >= 0, 'missing /catalog/mtg/images/manifest route');
const imageRouteStart = worker.indexOf("url.pathname === '/catalog/mtg/image'");
assert(imageRouteStart > manifestRouteStart, 'missing /catalog/mtg/image route');
const imageRouteEnd = worker.indexOf('\n\n', worker.indexOf('response.headers.set(\'Content-Type\', \'image/jpeg\');', imageRouteStart));
const mtgImageRoutes = worker.slice(manifestRouteStart, imageRouteEnd > 0 ? imageRouteEnd : imageRouteStart + 2000);

assert.match(mtgImageRoutes, /env\.MTG_CATALOG_R2\.get\('mtg\/images\/index-all\.json'\)/, 'set=all must prefer the precomputed index-all.json when it exists');
assert.match(mtgImageRoutes, /env\.MTG_CATALOG_R2\.list\(\{ prefix: 'mtg\/images\/index-set-'/, 'set=all must fall back to merging per-set indexes when index-all.json is missing -- a multi-day build across MTG\'s much larger catalog is even more likely to need this than Pokemon\'s already does');
assert.match(mtgImageRoutes, /listing\.truncated/, 'the R2 list() fallback must page through truncated results, not just the first page');
assert.match(mtgImageRoutes, /env\.MTG_CATALOG_R2\.get\(`mtg\/images\/\$\{id\}\/\$\{size\}\.jpg`/, 'the image route must serve from the mtg/images/<id>/<size>.jpg key layout');
assert.match(mtgImageRoutes, /!MTG_IMAGE_SIZES\.has\(size\)/, 'the image route must reject any size other than small/normal');

// ── Build script ────────────────────────────────────────────────────────
assert.match(buildScript, /const scope = String\(args\.get\('scope'\) \|\| 'all'\)\.toLowerCase\(\);/, 'must support an "all" or specific-set-code scope, mirroring the Pokemon image build script');
assert.match(buildScript, /normalizeScryfallCard, stableHash \} from '\.\/mtg-offline-core\.mjs';/, 'must reuse the existing card normalizer rather than re-parsing Scryfall\'s raw shape');
assert.match(buildScript, /const uris = \(card\.imageUris && card\.imageUris\.small\) \? card\.imageUris : \(card\.cardFaces\?\.\[0\]\?\.imageUris \|\| \{\}\);/, 'double-faced cards keep their images on card_faces[0], not the top-level image_uris -- must fall back to the front face');
assert.match(buildScript, /uploadObject\(`mtg\/images\/\$\{id\}\/\$\{size\}\.jpg`/, 'must upload each harvested image under the same key layout the Worker route serves from');
assert.match(buildScript, /uploadObject\('mtg\/images\/index-all\.json', allIndexPath\);/, 'an all-scope run must also publish the merged all-sets index');

// ── GitHub Action ───────────────────────────────────────────────────────
assert.match(workflow, /timeout-minutes: 360/, 'must use the GitHub-hosted runner\'s hard ceiling -- MTG\'s catalog is far bigger than Pokemon\'s, an all-scope run is even more likely to need it');
// scope=all fans out across the real (non-digital, non-token/memorabilia)
// Scryfall set list instead of iterating it inside one job -- MTG's ~676
// sets exceed GitHub's 256-job matrix cap on their own, so legs each carry
// a batch of set codes rather than one set per leg.
assert.match(workflow, /const batchSize = 15;/, 'set codes must be grouped into batches to stay well under the 256-job matrix cap');
assert.match(workflow, /matrix:\s*\n\s*batch: \$\{\{ fromJson\(needs\.list-sets\.outputs\.matrix\) \}\}/, 'the matrix must fan out over batches, not individual sets');
// The build script re-downloads Scryfall's entire (100s of MB) bulk file
// from scratch on every invocation unless given a local copy via
// --scryfall -- looping through a batch's sets without it turns one batch
// into N full bulk re-downloads. Each job fetches the bulk file exactly
// once and reuses it for every set in its batch.
assert.match(workflow, /id: bulk/, 'the bulk-download step must be addressable so its output path can be reused');
assert.match(workflow, /npm run mtg:images:build -- --scope="\$SCOPE" --scryfall="\$\{\{ steps\.bulk\.outputs\.file \}\}" --upload/, 'must invoke the build script with the dispatched scope and the batch\'s single shared bulk-file download');

// ── Client module ───────────────────────────────────────────────────────
assert.match(clientModule, /const DB_NAME = 'arscaMtgOfflineImages';/, 'must use its own IndexedDB, separate from both the price/card catalog DB and the opportunistic per-search image cache');
assert.match(clientModule, /db\.createObjectStore\('images',\{keyPath:\['scryfallId','size'\]\}\)/, 'images must be keyed by scryfallId+size, mirroring the Pokemon module\'s tcgPlayerId+size keying');
assert.match(clientModule, /async function syncImages\(\{workerBase='',scope='all',force=false,onProgress,concurrency=4\}=\{\}\)/, 'must expose the same syncImages(scope) shape the Pokemon module already has');
// The exact bug just fixed in the Pokemon module (status() never surfacing
// its own lastSyncAt, so the UI showed "Not downloaded" next to a real
// image count) must not be reintroduced here -- built correct from day one.
assert.match(clientModule, /getAllMeta\(\)/, 'status() must be able to enumerate every meta record to find the real last-sync date');
assert.match(clientModule, /lastImageSyncAt:imageSyncTimes\.length\?imageSyncTimes\[imageSyncTimes\.length-1\]:''/, 'status() must surface a real last-image-sync date, not leave the caller with nothing to show');
assert.match(clientModule, /root\.ArsCaMtgOfflineImages=\{openDb,syncImages,status,clear,getImageBlob,DB_NAME\};/, 'must export the same shape the Pokemon module exposes');

// ── dashboard.html wiring ───────────────────────────────────────────────
assert.match(dashboard, /<script src="scripts\/mtg\/mtg-offline-images-browser\.js\?v=/, 'the new module must actually be loaded by the page');
assert.match(dashboard, /async function syncMtgOfflineImages\(\)\{/, 'missing syncMtgOfflineImages()');
assert.match(dashboard, /async function clearMtgOfflineImages\(\)\{/, 'missing clearMtgOfflineImages()');
assert.match(dashboard, /id="mtg-image-set-select"/, 'missing the MTG image-scope selector in the offline catalog panel');
assert.match(dashboard, /onclick="syncMtgOfflineImages\(\)"/, 'the SYNC IMAGES FOR SCOPE button must be wired up');

// inventoryImageUrl(): same offline-blob-swap fix already shipped for
// Pokemon, now also covering MTG inventory items.
const invImgFnStart = dashboard.indexOf('function inventoryImageUrl(item={})');
const invImgFnEnd = dashboard.indexOf('\nfunction inventoryImageSourceLabel', invImgFnStart);
const invImgFn = dashboard.slice(invImgFnStart, invImgFnEnd);
// A cached offline image must win whenever one exists, online or not -- not
// only while offline. See the same principle applied to Pokemon items just
// above it in this same function.
assert.match(invImgFn, /if\(\/magic\|\\bmtg\\b\/i\.test\(String\(item\.category\|\|raw\.category\|\|''\)\)\)\{/, 'the offline-image-cache check must run for every MTG item regardless of connectivity, not only while offline');
assert.match(invImgFn, /mtgInventoryScryfallId\(item\)/, 'must resolve the scryfallId through the existing shared helper');
assert.match(invImgFn, /hydrateMtgOfflineImageUrl\(scryfallId\)/, 'must kick off async hydration from the bulk-synced image cache when not yet warmed');

// searchMtgCatalogExport(): bulk-synced images must be checked before the
// opportunistic per-search cache, since they're reliable regardless of
// whether this exact card was ever searched online before.
const searchFnStart = dashboard.indexOf('async function searchMtgCatalogExport(query)');
const searchFnEnd = dashboard.indexOf('\n}\n\nfunction mtgOfflinePriceProductToQplRow', searchFnStart);
const searchFn = dashboard.slice(searchFnStart, searchFnEnd);
assert.match(searchFn, /ArsCaMtgOfflineImages\?\.getImageBlob\(card\.scryfallId, 'normal'\)/, 'offline MTG search must check the bulk-synced image cache');
assert.match(searchFn, /if\(blob\) \{ useOfflineRowImage\(row, blob\); return; \}/, 'a bulk-synced image must win over the opportunistic per-search cache when both could apply, going through useOfflineRowImage so the real CDN URL survives as liveImageUrl instead of being discarded');

console.log('MTG offline images pipeline checks passed');
