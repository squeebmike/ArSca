import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// A bulk-synced offline Pokemon card image must win over the live PPT CDN
// URL a search result was just built with -- online or not. Previously the
// live search paths (cards, sealed, parse-title) never checked the offline
// image cache at all, only the dedicated offline-first cache search did --
// so a card whose price came back from a live lookup (because it wasn't in
// the offline price cache) still showed no image even when that exact
// card's image had separately been bulk-synced.

// ── Cards path ──────────────────────────────────────────────────────────
const cardsPathStart = dashboard.indexOf("// Cards path: rank up to 20 results");
assert(cardsPathStart >= 0, 'missing the live cards-search path');
const cardsPathEnd = dashboard.indexOf('if(rows.length) {', cardsPathStart);
const cardsPath = dashboard.slice(cardsPathStart, cardsPathEnd);
assert.match(cardsPath, /window\.ArsCaPokemonOfflineImages\?\.getImageBlob\(row\.tcgPlayerId \|\| row\.tcgplayerId|id, '400'\)|getImageBlob\(id, '400'\)/,
  'the live cards path must check the bulk-synced offline image cache for every result');
assert.match(cardsPath, /if\(blob\) row\.imageUrl = URL\.createObjectURL\(blob\);/, 'a cached image must override the live CDN URL the row was built with');

// ── Sealed path ──────────────────────────────────────────────────────────
const sealedPathStart = dashboard.indexOf('const sealedRows = sealedResult.products.slice(0, 20).map(p => {');
assert(sealedPathStart >= 0, 'missing the live sealed-search path');
const sealedPathEnd = dashboard.indexOf('sealedRows.forEach(add);', sealedPathStart);
const sealedPath = dashboard.slice(sealedPathStart, sealedPathEnd);
assert.match(sealedPath, /window\.ArsCaPokemonOfflineImages\.getImageBlob\(id, '400'\)/, 'the live sealed path must check the bulk-synced offline image cache too');

// ── Parse-title path ────────────────────────────────────────────────────
const parseTitleStart = dashboard.indexOf("const hydratedRows = await Promise.all(parseTitleRows.map(async row => {");
assert(parseTitleStart >= 0, 'missing the parse-title hydration path');
const parseTitleEnd = dashboard.indexOf('}));', parseTitleStart);
const parseTitlePath = dashboard.slice(parseTitleStart, parseTitleEnd);
assert.match(parseTitlePath, /ArsCaPokemonOfflineImages\?\.getImageBlob\(row\.tcgPlayerId, '400'\)/, 'the parse-title path must check the bulk-synced offline image cache too');

// ── The dedicated offline-first cache search (searchPokemonOfflineCache)
// was already unconditional -- confirm it stayed that way rather than ever
// having an online/offline gate reintroduced. ──
const offlineCacheFnStart = dashboard.indexOf('async function searchPokemonOfflineCache(query');
assert(offlineCacheFnStart >= 0, 'missing searchPokemonOfflineCache');
const offlineCacheFnEnd = dashboard.indexOf('\n}', dashboard.indexOf('return rows;', offlineCacheFnStart));
const offlineCacheFn = dashboard.slice(offlineCacheFnStart, offlineCacheFnEnd);
assert.doesNotMatch(offlineCacheFn, /navigator\.onLine/, 'the offline-first cache search must never gate its image attachment on connectivity');

console.log('Pokemon search offline-image-priority checks passed');
