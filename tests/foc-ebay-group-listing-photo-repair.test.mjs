import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const focDash = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');

// Store report (live listing, checked directly against production data):
// every group listing created before the photo-position-binding fix
// (see foc-ebay-group-image-position-binding.test.mjs) still carries the
// OLD, broken group-level imageUrls array on eBay -- the fix only changes
// what NEW listings send, it doesn't retroactively repair ones already
// published. This route/function re-derives the correct 1:1 array from
// each variant's own per-row image (which the bug never touched) and PUTs
// it back to the already-live group listing.

const repairFnStart = worker.indexOf('async function repairEbayGroupListingImages');
assert.ok(repairFnStart !== -1, 'repairEbayGroupListingImages must exist');
const repairFnEnd = worker.indexOf('// Ends (withdraws) an ENTIRE multi-variation listing at once', repairFnStart);
const repairFnBody = worker.slice(repairFnStart, repairFnEnd);

assert.match(repairFnBody, /fetch\(`https:\/\/api\.ebay\.com\/sell\/inventory\/v1\/inventory_item_group\/\$\{groupKey\}`, \{\s*headers:/,
  'must GET the group\'s current state from eBay first -- title/description/aspects/variesBy are preserved from what eBay already has, only imageUrls is corrected, so this can never accidentally drift the listing\'s other fields');
assert.match(repairFnBody, /const variantSKUs = Array\.isArray\(group\.variantSKUs\)/, 'must read the live variantSKUs order from eBay -- that order defines the position each corrected image must land in');
assert.match(repairFnBody, /r\.data\?\.ebayInventoryItemGroupKey === groupKey && r\.data\?\.ebaySku/,
  'must map each variant SKU back to that inventory_item row\'s OWN stored image -- the per-row image was never touched by the shared-array bug, so it is the trustworthy source for the repair');
assert.match(repairFnBody, /const correctedImageUrls = variantSKUs\.map\(sku => imageBySku\[sku\] \|\| fallbackImage\)/,
  'the corrected array must stay exactly one entry per live variant SKU, in eBay\'s own order -- never shorter/longer than variantSKUs or the position-binding contract breaks again');
assert.match(repairFnBody, /if \(!fallbackImage\) \{ const e = new Error\('No usable cover image found on file/,
  'must refuse to repair (not push an all-empty imageUrls array) when no real image can be found at all');
assert.match(repairFnBody, /method: 'PUT',[\s\S]*?imageUrls: correctedImageUrls, variantSKUs, variesBy: group\.variesBy,/,
  'the repair PUT must send back the group\'s own existing title/description/aspects/variesBy alongside the corrected imageUrls');

console.log('repairEbayGroupListingImages checks passed');

// Backend route: batch-repairs every still-live group listing for the
// store in one call (or just one, if a specific groupKey is given) --
// this is a one-time cleanup action, not a per-listing chore the store
// should have to remember to run for each affected book individually.

const routeStart = worker.indexOf("url.pathname === '/foc/ebay/repair-group-listing-photos'");
assert.ok(routeStart !== -1, 'the repair route must exist');
const routeEnd = worker.indexOf('// Flips any eBay presale listings for a FOC cycle over to in-stock', routeStart);
const routeBody = worker.slice(routeStart, routeEnd);

assert.match(routeBody, /requireStoreUser\(request, env, storeId, \['owner','admin'\]\)/, 'must require owner/admin auth, same as the other FOC eBay admin routes');
assert.match(routeBody, /groupKeys = \[\.\.\.new Set\(\(rows \|\| \[\]\)\.map\(r => r\.data\?\.ebayInventoryItemGroupKey\)\.filter\(Boolean\)\)\]/,
  'when no specific groupKey is given, must discover every distinct group listing on file for the store and repair them all in one pass');
assert.match(routeBody, /for \(const groupKey of groupKeys\) \{\s*try \{ repaired\.push\(await repairEbayGroupListingImages/,
  'must attempt every group listing independently -- one listing failing (e.g. already ended on eBay) must not block repairing the rest');
assert.match(routeBody, /catch \(e\) \{ failed\.push\(\{ groupKey, error: e\.message \}\); \}/, 'a failed repair must be reported back per-listing, not thrown and lost');

console.log('FOC eBay group-listing photo repair route checks passed');

// Duplicate-listing guard fix: the guard (see
// foc-ebay-group-duplicate-guard-and-description.test.mjs) never checked
// ebayWithdrawnAt, so a cover whose listing had genuinely ended -- either
// through this app's own END REMAINING EBAY LISTINGS flow (which sets
// ebayWithdrawnAt but never clears ebayListingId) or ended directly on
// eBay itself -- permanently blocked ever re-listing that cover again,
// with the confusing "Already listed on eBay" error even though nothing
// was actually live anymore.

const guardIdx = worker.indexOf('d.focSkuId && d.ebayListingId && !d.ebayWithdrawnAt');
assert.ok(guardIdx !== -1, 'the "already listed" duplicate guard must also require the row NOT be withdrawn -- otherwise a properly-ended listing can never be re-listed');

console.log('Duplicate-listing guard withdrawn-check fix verified');

// Frontend: a REPAIR LISTING PHOTOS button in the FOC Review toolbar (same
// screen as END REMAINING EBAY LISTINGS, which already manages this
// cycle's group listings), wired to the batch-repair route, and exposed on
// window since this file is an IIFE (see foc-dashboard-window-exposure.test.mjs).

assert.match(focDash, /onclick="repairFocEbayGroupPhotos\(\)">REPAIR LISTING PHOTOS<\/button>/, 'the FOC Review toolbar must have a REPAIR LISTING PHOTOS button');
assert.match(focDash, /async function repairFocEbayGroupPhotos\(\)\{/, 'the repair handler must exist');
assert.match(focDash, /api\('\/foc\/ebay\/repair-group-listing-photos',\{method:'POST'/, 'the handler must call the batch-repair route');
assert.match(focDash, /window\.repairFocEbayGroupPhotos=repairFocEbayGroupPhotos;/, 'the handler must be exposed on window for its onclick to find it');

console.log('FOC eBay group-listing photo repair frontend checks passed');
