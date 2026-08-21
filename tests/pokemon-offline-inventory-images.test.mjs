import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// inventoryImageUrl() is the single function every inventory surface (main
// table, owner flags, no-photo filter, edit modal, needs-review queues...)
// calls to get an item's thumbnail. For Pokemon items it always returned
// the item's stored remote TCGPlayer/PPT CDN URL -- fine online, broken
// offline, but ALSO the wrong priority even while online: a cached offline
// image loads instantly with zero network dependency and is exactly what
// the device shows once it goes offline anyway, so it must win whenever one
// exists, online or not -- the live CDN URL is only ever the fallback for a
// card that hasn't been synced yet (or, offline with nothing cached, simply
// unavailable, where returning '' beats a dead URL).
const fnStart = dashboard.indexOf('function inventoryImageUrl(item={})');
assert(fnStart >= 0, 'inventoryImageUrl() must exist');
const fnEnd = dashboard.indexOf('\nfunction inventoryImageSourceLabel', fnStart);
assert(fnEnd > fnStart, 'could not bound inventoryImageUrl() source');
const fn = dashboard.slice(fnStart, fnEnd);

assert.match(fn, /if\(\/pokemon\/i\.test\(String\(item\.category\|\|raw\.category\|\|''\)\)\)\{/,
  'the offline-image-cache check must run for every Pokemon item regardless of connectivity, not only while offline');
assert.match(fn, /inventoryTcgPlayerId\(item\)/,
  'must resolve the tcgPlayerId through the shared helper (covers every field-name variant items are stored under)');
assert.match(fn, /window\._pokemonOfflineImageUrls\?\.\[tcgPlayerId\]/,
  'must read from a synchronous cache -- inventoryImageUrl() is called from synchronous render code, it cannot await IndexedDB itself');
assert.match(fn, /hydratePokemonOfflineImageUrl\(tcgPlayerId\)/,
  'must kick off async hydration from the cached blob when not yet warmed');
assert.match(fn, /if\(tcgPlayerId && typeof hydratePokemonOfflineImageUrl==='function'\) hydratePokemonOfflineImageUrl\(tcgPlayerId\);\s*\n\s*if\(!navigator\.onLine\) return '';\s*\n\s*\}/,
  'must only return an empty (no-image) result when actually offline with nothing cached -- while online it must fall through to the live CDN URL fallback below');

const hydrateStart = dashboard.indexOf('async function hydratePokemonOfflineImageUrl(tcgPlayerId)');
assert(hydrateStart >= 0, 'hydratePokemonOfflineImageUrl() must exist');
const hydrateEnd = dashboard.indexOf('\n}', hydrateStart);
const hydrate = dashboard.slice(hydrateStart, hydrateEnd);

assert.match(hydrate, /ArsCaPokemonOfflineImages\?\.getImageBlob\(tcgPlayerId,'400'\)/,
  'must read from the same offline image cache Settings > Offline Catalogs already syncs into');
assert.match(hydrate, /URL\.createObjectURL\(blob\)/, 'must turn the cached Blob into a usable <img src>');
assert.match(hydrate, /filterTable\(\)/, 'must re-render the inventory table once the image resolves, same pattern hydrateComicPhotoKey already uses');
assert.match(hydrate, /window\._pokemonOfflineImageUrls\[tcgPlayerId\]===null\)return/,
  'must dedupe concurrent/repeated hydration attempts for the same card the same way the comics photo cache already does');

console.log('Pokemon offline inventory image checks passed');
