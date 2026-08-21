import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Second surfacing of the same bug class fixed for inventory in
// blob-url-image-persistence.test.mjs: the live Pokemon search paths swap a
// result row's imageUrl for a URL.createObjectURL(blob) preview when a
// bulk-synced offline image is found. That blob: URL only works in the tab
// that created it. Search results also get persisted -- via
// savePokemonCacheResults() into sessionStorage, for offline replay -- and
// the Research/live-buying card renderer (quickLookupResultCard) read
// row.imageUrl straight into an <img src> with no sanitization at all. On
// a later reload (the user reloads constantly to stay on the latest
// build), the cached blob: URL is dead, so Research/live-buying cards
// showed "NO IMAGE" for cards that should have had one -- both online and
// offline, since the initial render never even tried the bulk offline
// image cache the way inventory does.

// ── quickLookupResultCard must sanitize the row's imageUrl before ever
// using it as an <img src>.
const cardFnStart = dashboard.indexOf('function quickLookupResultCard(r, idx){');
assert(cardFnStart >= 0, 'quickLookupResultCard must exist');
const cardFnEnd = dashboard.indexOf('\nfunction ', cardFnStart + 10);
const cardFn = dashboard.slice(cardFnStart, cardFnEnd);
assert.match(cardFn, /const qplSafeImageUrl = durableImageUrl\(r\.imageUrl\);/,
  'the card renderer must strip a dead blob: URL before treating it as a real image source');
assert.match(cardFn, /img src="\$\{escHtml\(qplSafeImageUrl\)\}"/,
  'the <img> must be built from the sanitized URL, not the raw row.imageUrl');

// ── savePokemonCacheResults() must never persist a blob: URL into the
// offline search-replay cache.
const saveCacheStart = dashboard.indexOf('async function savePokemonCacheResults(query, rows = [], source');
assert(saveCacheStart >= 0, 'savePokemonCacheResults must exist');
const saveCacheEnd = dashboard.indexOf('\n}', saveCacheStart);
const saveCacheFn = dashboard.slice(saveCacheStart, saveCacheEnd);
assert.match(saveCacheFn, /imageUrl:durableImageUrl\(row\.imageUrl\),/,
  'cached search-replay rows must have their imageUrl sanitized before being written to sessionStorage');

// ── resolvePokemonCatalogImagesForVisibleCards() must check the bulk
// offline image cache (the one that already makes inventory images work
// offline) before/alongside the older name+number catalog, and must not
// be fooled into thinking a dead blob: src is "already resolved". Crucially,
// it must target the .qpl-img-shell CONTAINER, not an inner <img> --
// sanitizing a dead blob: URL at render time means the row often has no
// <img> tag at all yet (the "NO IMAGE" placeholder branch), so a fix that
// only ever swaps an existing <img>'s src silently does nothing for exactly
// the rows this function exists to repair.
const resolveFnStart = dashboard.indexOf('function resolvePokemonCatalogImagesForVisibleCards(){');
assert(resolveFnStart >= 0, 'resolvePokemonCatalogImagesForVisibleCards must exist');
const resolveFnEnd = dashboard.indexOf('\n}', dashboard.indexOf('});', resolveFnStart));
const resolveFn = dashboard.slice(resolveFnStart, resolveFnEnd);
assert.match(resolveFn, /const shell = card\.querySelector\('\.qpl-img-shell'\);/,
  'must target the always-present .qpl-img-shell container, not an inner <img> that may not exist when the row started with no image');
assert.match(resolveFn, /const existingImg = shell\.querySelector\('img'\);/,
  'must check for an existing <img> inside the shell without assuming one is there');
assert.match(resolveFn, /!\/\^blob:\/i\.test\(existingImg\.src\)/,
  'an existing blob: src must not be treated as already-working -- it is guaranteed dead outside the tab that created it');
assert.match(resolveFn, /inventoryTcgPlayerId\(r\)/,
  'must resolve the tcgPlayerId the same way inventory does, to key into the same bulk offline image cache');
assert.match(resolveFn, /window\.ArsCaPokemonOfflineImages\.getImageBlob\(tcgPlayerId, '400'\)/,
  'must check the bulk-synced offline image cache -- the same store that already makes inventory images work offline -- not only the older legacy catalog');
assert.match(resolveFn, /shell\.innerHTML = `<img src="\$\{escHtml\(url\)\}"/,
  'must actually insert a real <img> into the shell when no image existed at all, not just try to update one that may not exist');
assert.match(resolveFn, /shell\.onclick = \(\) => openQplImageLightbox\(idx\);/,
  'a freshly-inserted image must still be tap-to-zoom, matching the initial render for rows that had an image from the start');

console.log('QPL research offline-image-priority checks passed');
