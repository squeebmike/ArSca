import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store report: a sports card's Category field showed up as a one-off
// dropdown option like "Baseball Cards 2023 Topps" in the Edit modal,
// splitting it from the shared "Sports" bucket every other card uses.
// getInventoryCategories() unions in every category string that has EVER
// existed on a real item, so a single bad add permanently pollutes the
// dropdown for the whole store, and that card is invisible from wherever
// "Sports" actually gets filtered/browsed (category dashboards, the public
// storefront's category filter).
//
// Two independent leaks fed this, traced from a live screenshot of the
// actual stray dropdown option:

// 1. fetchPriceChartingLiveCatalog only forced category:'Sports' when the
// SEARCH ITSELF was already scoped to sports (isSports) -- a plain
// Research-tab search for a card by name with no category filter selected
// left isSports false even for a genuine baseball card, so the result's
// category fell through to the raw PriceCharting console name.
assert.match(dashboard, /const looksLikeSports = isSports \|\| \/sport\|\\b\(\?:baseball\|football\|basketball\|hockey\|soccer\|wrestling\|racing\)\\b\/i\.test\(m\.consoleName \|\| ''\);/,
  'fetchPriceChartingLiveCatalog must also detect sports from the returned product\'s own console name, not only from whether the search was pre-scoped to sports');
assert.match(dashboard, /category:looksLikeSports \? 'Sports' : \(m\.consoleName \|\| cat \|\| 'Collectibles'\),/,
  'the category assignment must use the broadened sports detection');

// 2. The barcode scanner used a DIFFERENT string, "Sports Card" (singular),
// for the same conceptual bucket every other add path calls "Sports".
assert.match(dashboard, /const categoryMap=\{comics:'Comic',pokemon:'Pokemon TCG',mtg:'Magic: The Gathering',sports:'Sports',other:'Collectibles'\};/,
  'barcodeCandidateToResearch must use the same "Sports" category string as every other add path, not a one-off "Sports Card"');
assert.doesNotMatch(dashboard, /sports:'Sports Card'/, 'the old mismatched "Sports Card" string must be gone');

console.log('Sports category fragmentation source-fix contract checks passed');

// ── Repair path for cards already saved under a bogus category ──
assert.match(dashboard, /function itemsWithBogusSportsCategory\(items=all\)\{/, 'missing itemsWithBogusSportsCategory');
assert.match(dashboard, /async function backfillBogusSportsCategory\(\)\{/, 'missing backfillBogusSportsCategory');
assert.match(dashboard, /bogusSportsCategory:itemsWithBogusSportsCategory\(items\)\.length,/, 'inventoryHealthSummary must surface a count of bogus-sports-category items');
assert.match(dashboard, /\['bogus_sports_category','Sports Category Fix',h\.bogusSportsCategory,'tap to repair','backfillBogusSportsCategory\(\)'\],/,
  'the inventory health panel must expose a one-tap fix for bogus sports categories');

// ── Functional: verify the detection logic itself, independent of DOM/network state ──
{
  const fnStart = dashboard.indexOf('function itemsWithBogusSportsCategory(items=all){');
  const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
  const src = "const STANDARD_INVENTORY_CATEGORIES = ['Pokemon TCG','Magic: The Gathering','One Piece TCG','Yu-Gi-Oh!','Disney Lorcana','Sports','Comic','Collectibles','Supplies'];\n"
    + dashboard.slice(fnStart, fnEnd) + '\nreturn itemsWithBogusSportsCategory;';
  const itemsWithBogusSportsCategory = new Function(src)();

  const items = [
    { status:'in_stock', category:'Sports' },                            // already correct
    { status:'in_stock', category:'Sports Card' },                       // barcode-scanner leak
    { status:'in_stock', category:'Baseball Cards 2023 Topps' },         // PriceCharting console-name leak
    { status:'in_stock', category:'Pokemon TCG' },                       // unrelated, must not match
    { status:'in_stock', category:'Collectibles' },                      // unrelated, must not match
    { status:'sold', category:'Baseball Cards 2023 Topps' },             // sold rows are out of scope
  ];
  const matches = itemsWithBogusSportsCategory(items);
  assert.equal(matches.length, 2, 'must find exactly the two in-stock bogus-category sports cards');
  assert.ok(matches.every(i => i.category !== 'Sports' && i.category !== 'Pokemon TCG' && i.category !== 'Collectibles'), 'must never flag an already-correct or unrelated category');
}

console.log('itemsWithBogusSportsCategory functional checks passed');
