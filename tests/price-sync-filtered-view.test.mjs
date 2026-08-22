import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// The per-category FETCH/SYNC PRICES buttons (Pokemon, MTG, comics,
// sports/other) always re-scan the *entire* inventory. Two related gaps:
// (1) no way to just check prices for whatever's currently on screen (e.g.
// the Stale Prices filter chip) without a full inventory scan, and
// (2) no way to refresh a single item's price from its row menu without
// opening the sync modal and hunting for that one card in a big batch.
// Both are now solved by threading an optional restrictToIds scope through
// the existing category builders, rather than building a parallel pricing
// pipeline.

// ── Each category builder must accept and honor restrictToIds ──
const comicBuildStart = dashboard.indexOf('async function buildLiveComicPriceSyncProposal(options = {}){');
assert(comicBuildStart >= 0, 'buildLiveComicPriceSyncProposal must exist');
assert.match(dashboard.slice(comicBuildStart, comicBuildStart + 300),
  /const items=comicInventoryPriceSyncItems\(\)\.filter\(i=>!options\.restrictToIds\|\|options\.restrictToIds\.has\(i\.id\)\);/,
  'comic price sync must respect restrictToIds');

const mtgBuildStart = dashboard.indexOf('async function buildOfflineMtgPriceSyncProposal(options = {}){');
assert(mtgBuildStart >= 0, 'buildOfflineMtgPriceSyncProposal must exist');
assert.match(dashboard.slice(mtgBuildStart, mtgBuildStart + 400),
  /const items = mtgOfflineInventoryItems\(\)\.filter\(i=>!options\.restrictToIds\|\|options\.restrictToIds\.has\(i\.id\)\);/,
  'MTG price sync must respect restrictToIds');

const pokemonBuildStart = dashboard.indexOf('async function buildLivePokemonPriceSyncProposal(options = {}){');
assert(pokemonBuildStart >= 0, 'buildLivePokemonPriceSyncProposal must exist');
assert.match(dashboard.slice(pokemonBuildStart, pokemonBuildStart + 900),
  /return st !== 'sold' && st !== 'archived' && isPokemonInventorySyncItem\(i\) && \(!options\.restrictToIds \|\| options\.restrictToIds\.has\(i\.id\)\);/,
  'Pokemon price sync must respect restrictToIds');

const otherBuildStart = dashboard.indexOf('async function buildOtherTcgSportsPriceSyncProposal(options = {}){');
assert(otherBuildStart >= 0, 'buildOtherTcgSportsPriceSyncProposal must exist');
assert.match(dashboard.slice(otherBuildStart, otherBuildStart + 750),
  /items = items\.filter\(i => isOtherTcgSportsInventorySyncItem\(i\) && \(!options\.restrictToIds \|\| options\.restrictToIds\.has\(i\.id\)\)\);/,
  'sports/other price sync must respect restrictToIds');

console.log('restrictToIds threading contract checks passed');

// ── runPriceSyncForFilteredItems: reuses `filtered` (the Inventory table's
// already-narrowed view -- category chip + search combined), splits by
// category, and runs only the builders that apply, restricted to exactly
// those items ──
const runnerStart = dashboard.indexOf('async function runPriceSyncForFilteredItems(){');
assert(runnerStart >= 0, 'runPriceSyncForFilteredItems must exist');
const runnerEnd = dashboard.indexOf('\nfunction updatePriceAlertBanner', runnerStart);
const runnerFn = dashboard.slice(runnerStart, runnerEnd);
assert.match(runnerFn, /const items = \(typeof filtered !== 'undefined' \? filtered : \[\]\)\.filter\(i => i\.status === 'in_stock'\);/,
  'must source items from the Inventory table\'s already-filtered `filtered` array, restricted to in-stock items');
assert.match(runnerFn, /if\(!items\.length\)\{ toast_dash\('No in-stock items in the current view to look up'\); return; \}/,
  'must give clear feedback instead of silently doing nothing when the current view has nothing in stock');
assert.match(runnerFn, /ids:new Set\(items\.filter\(isPokemonInventorySyncItem\)\.map\(i => i\.id\)\), label:'Pokemon', build:buildLivePokemonPriceSyncProposal/,
  'must split the filtered items into a Pokemon-only id set for the Pokemon builder');
assert.match(runnerFn, /ids:new Set\(items\.filter\(isMtgInventorySyncItem\)\.map\(i => i\.id\)\), label:'MTG'/,
  'must split the filtered items into an MTG-only id set for the MTG builder');
assert.match(runnerFn, /ids:new Set\(items\.filter\(i => qplCategoryKey\(i\.category\|\|''\) === 'comic'\)\.map\(i => i\.id\)\), label:'Comics', build:buildLiveComicPriceSyncProposal/,
  'must split the filtered items into a comics-only id set for the comic builder');
assert.match(runnerFn, /ids:new Set\(items\.filter\(isOtherTcgSportsInventorySyncItem\)\.map\(i => i\.id\)\), label:'Sports\/Other', build:buildOtherTcgSportsPriceSyncProposal/,
  'must split the filtered items into a sports/other-only id set for that builder');
assert.match(runnerFn, /if\(!runner\.ids\.size\) continue;/,
  'must skip a category entirely when the current view has none of that category, instead of calling its builder with an empty scope');
assert.match(runnerFn, /_priceSyncProposal = mergePendingPriceSyncProposals\(pendingBeforeRun, combined\);/,
  'must merge into the existing pending-proposal mechanism so results show in the same review/apply UI as the other sync buttons');

console.log('runPriceSyncForFilteredItems contract checks passed');

// ── Toolbar button wiring ──
assert.match(dashboard, /<button class="tab primary" onclick="runPriceSyncForFilteredItems\(\)"[^>]*>💹 LOOK UP THIS VIEW<\/button>/,
  'an Inventory toolbar button must trigger the scoped price-lookup flow');

// ── applyPriceSyncEntry: extracted so the bulk "UPDATE SELECTED" path and
// the new single-item refresh path apply identical fields, instead of two
// copies that could drift out of sync ──
const applyEntryStart = dashboard.indexOf('async function applyPriceSyncEntry(p){');
assert(applyEntryStart >= 0, 'applyPriceSyncEntry must exist as its own function');
const applyEntryEnd = dashboard.indexOf('\nasync function applySelectedPriceSyncUpdates', applyEntryStart);
const applyEntryFn = dashboard.slice(applyEntryStart, applyEntryEnd);
assert.match(applyEntryFn, /await saveInventoryEdit\(fullItem, \{/, 'applyPriceSyncEntry must actually persist the new price via saveInventoryEdit');
assert.match(applyEntryFn, /return true;/, 'applyPriceSyncEntry must report success back to its caller');
assert.match(applyEntryFn, /catch\(e\)\{ console\.warn\('\[syncPrices\] Apply failed:', priceSyncItemTitle\(p\.item\), e\); return false; \}/, 'applyPriceSyncEntry must report failure back to its caller instead of silently swallowing it');

const applySelectedStart = dashboard.indexOf('async function applySelectedPriceSyncUpdates(){');
const applySelectedEnd = dashboard.indexOf('\nfunction updatePriceAlertBanner', applySelectedStart);
const applySelectedFn = dashboard.slice(applySelectedStart, applySelectedEnd);
assert.match(applySelectedFn, /if\(await applyPriceSyncEntry\(p\)\) ok\+\+;/, 'the bulk apply loop must reuse applyPriceSyncEntry rather than duplicating the save logic');

console.log('applyPriceSyncEntry extraction contract checks passed');

// ── refreshInventoryItemPriceFromMarket: single-item "get its price from
// market" action, dispatching to the right category builder ──
const refreshStart = dashboard.indexOf('async function refreshInventoryItemPriceFromMarket(itemId){');
assert(refreshStart >= 0, 'refreshInventoryItemPriceFromMarket must exist');
const refreshEnd = dashboard.indexOf('\n\nfunction updatePriceAlertBanner', refreshStart);
const refreshFn = dashboard.slice(refreshStart, refreshEnd);
assert.match(refreshFn, /if\(!navigator\.onLine\)\{ toast_dash\('Connect to the internet to look up a live price'\); return; \}/,
  'must fail clearly offline rather than attempt a live lookup with no network');
assert.match(refreshFn, /const restrictToIds = new Set\(\[itemId\]\);/, 'must restrict whichever builder runs to exactly this one item');
assert.match(refreshFn, /const build = isPokemonInventorySyncItem\(item\) \? buildLivePokemonPriceSyncProposal/, 'must dispatch to the Pokemon builder for Pokemon items');
assert.match(refreshFn, /: isMtgInventorySyncItem\(item\) \? \(opts => buildOfflineMtgPriceSyncProposal\(\{ \.\.\.opts, preferOnline:true \}\)\)/, 'must dispatch to the MTG builder (forcing online lookup, not the offline-catalog fallback) for MTG items');
assert.match(refreshFn, /: qplCategoryKey\(item\.category \|\| ''\) === 'comic' \? buildLiveComicPriceSyncProposal/, 'must dispatch to the comic builder for comics');
assert.match(refreshFn, /: buildOtherTcgSportsPriceSyncProposal;/, 'must fall back to the sports/other builder for everything else (sports, graded, generic TCG)');
assert.match(refreshFn, /const applied = await applyPriceSyncEntry\(proposal\[0\]\);/, 'a found price change must be applied immediately via the shared apply function, not left for manual review');
assert.match(refreshFn, /toast_dash\(applied\s*\n\s*\? 'Price updated: ' \+ fd\$\(proposal\[0\]\.oldPrice\) \+ ' → ' \+ fd\$\(proposal\[0\]\.newPrice\)/,
  'a successful refresh must tell the dealer the old and new price, not just "done"');
assert.match(refreshFn, /const issue = \(_priceSyncLastSummary\?\.issues \|\| \[\]\)\[0\];/, 'when nothing changed or no match was found, must surface the real reason from the builder\'s own issue list rather than a generic failure message');

console.log('refreshInventoryItemPriceFromMarket contract checks passed');

// ── Row-menu wiring, and gated to in-stock items only (refreshing a sold
// item's price makes no sense) ──
assert.match(dashboard, /isInStock\?`<button class="hbtn" style="\$\{btnStyle\};color:var\(--blue\)" onclick="refreshInventoryItemPriceFromMarket\('\$\{id\}'\);closeInvRowMenu\(\)">💹 Refresh Price<\/button>`:''/,
  'the inventory row menu must expose a per-item Refresh Price action, only for in-stock items');

console.log('Price-sync-filtered-view checks passed');
