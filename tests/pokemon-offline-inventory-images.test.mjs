import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// inventoryImageUrl() is the single function every inventory surface (main
// table, owner flags, no-photo filter, edit modal, needs-review queues...)
// calls to get an item's thumbnail. For Pokemon items it always returned
// the item's stored remote TCGPlayer/PPT CDN URL, even while offline --
// that URL can never load with no connection, so despite having already
// synced thousands of card images into ArsCaPokemonOfflineImages (a
// separate IndexedDB cache keyed by tcgPlayerId), inventory never used them
// and just showed "NO IMAGE" offline.
const fnStart = dashboard.indexOf('function inventoryImageUrl(item={})');
assert(fnStart >= 0, 'inventoryImageUrl() must exist');
const fnEnd = dashboard.indexOf('\nfunction inventoryImageSourceLabel', fnStart);
assert(fnEnd > fnStart, 'could not bound inventoryImageUrl() source');
const fn = dashboard.slice(fnStart, fnEnd);

assert.match(fn, /!navigator\.onLine && \/pokemon\/i\.test\(String\(item\.category\|\|raw\.category\|\|''\)\)/,
  'must special-case offline Pokemon items the same way offline comics already are');
assert.match(fn, /inventoryTcgPlayerId\(item\)/,
  'must resolve the tcgPlayerId through the shared helper (covers every field-name variant items are stored under)');
assert.match(fn, /window\._pokemonOfflineImageUrls\?\.\[tcgPlayerId\]/,
  'must read from a synchronous cache -- inventoryImageUrl() is called from synchronous render code, it cannot await IndexedDB itself');
assert.match(fn, /hydratePokemonOfflineImageUrl\(tcgPlayerId\)/,
  'must kick off async hydration from the cached blob when not yet warmed');

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
