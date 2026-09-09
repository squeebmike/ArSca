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
assert.match(repairFnBody, /if \(r\.data\?\.ebaySku\) imageBySku\[r\.data\.ebaySku\] = r\.data\.image \|\| '';/,
  'must map each variant SKU back to that inventory_item row\'s OWN stored image -- the per-row image was never touched by the shared-array bug, so it is the trustworthy source for the repair');
assert.match(repairFnBody, /const correctedImageUrls = variantSKUs\.map\(sku => imageBySku\[sku\] \|\| fallbackImage\)/,
  'the corrected array must stay exactly one entry per live variant SKU, in eBay\'s own order -- never shorter/longer than variantSKUs or the position-binding contract breaks again');
assert.match(repairFnBody, /if \(!fallbackImage\) \{ const e = new Error\('No usable cover image found on file/,
  'must refuse to repair (not push an all-empty imageUrls array) when no real image can be found at all');
assert.match(repairFnBody, /method: 'PUT',[\s\S]*?imageUrls: correctedImageUrls, variantSKUs, variesBy: group\.variesBy,/,
  'the repair PUT must send back the group\'s own existing title/description/aspects/variesBy alongside the corrected imageUrls');

// eBay's own Seller Hub "Add variation photos" tool -- described by eBay
// itself as "This determines which photos buyers see when they select a
// variation option" -- showed 0/12 photos assigned to EVERY cover on a
// listing built entirely through the REST Inventory API mechanism above
// (aspectsImageVaryBy + group-level imageUrls), confirmed directly on a
// live listing. That tool is actually driven by the older Trading (XML)
// API's VariationSpecificPictureSet (ReviseFixedPriceItem), a completely
// separate mechanism this app never called before. The REST-side repair
// above is still worth keeping (it fixes the general/fallback gallery),
// but it does not and cannot fix the actual per-cover dropdown-to-photo
// binding on its own.
assert.match(repairFnBody, /const specValues = \(group\.variesBy\?\.specifications\?\.\[0\]\?\.values\) \|\| \[\];/,
  'must read the live specifications.values from eBay to know each SKU\'s own dropdown label -- VariationSpecificValue has to be the exact buyer-facing label text, not a SKU or internal key');
assert.match(repairFnBody, /await setEbayVariationSpecificPhotos\(ebayToken, listingId, variantSKUs\.map\(sku => \(\{ label: labelBySku\[sku\], imageUrls: \[imageBySku\[sku\] \|\| fallbackImage\] \}\)\)\)/,
  'the repair must also call setEbayVariationSpecificPhotos with one entry per SKU, using each SKU\'s own stored image -- fixing only the REST-side gallery array leaves the actual buyer-facing symptom (dropdown does not change the photo) completely unfixed');
assert.match(repairFnBody, /warning = 'General gallery was repaired, but per-cover "Cover: Select" photo binding failed: '/,
  'a Trading API failure must not throw and lose the REST-side repair that already succeeded -- it must come back as a warning on the result instead');

console.log('repairEbayGroupListingImages checks passed');

// Trading API integration: this app never called eBay's older XML Trading
// API before -- setEbayVariationSpecificPhotos and its ebayTradingApiCall
// helper are new. The Trading API accepts the SAME OAuth user token
// already used for the REST Sell APIs via the X-EBAY-API-IAF-TOKEN header,
// so this needs no new credentials or a separate auth flow.

const helperStart = worker.indexOf('async function setEbayVariationSpecificPhotos');
assert.ok(helperStart !== -1, 'setEbayVariationSpecificPhotos must exist');
const helperFnEnd = worker.indexOf('async function createAndPublishEbayVariationListing', helperStart);
const helperBody = worker.slice(worker.indexOf('function xmlEscape'), helperFnEnd);

assert.match(helperBody, /'X-EBAY-API-IAF-TOKEN': ebayToken,/, 'the Trading API call must authenticate with the existing OAuth user token via the IAF header, not a separate legacy token/session');
assert.match(helperBody, /'X-EBAY-API-CALL-NAME': callName,/, 'must set the Trading API call-name header the way every XML Trading API call requires');
assert.match(helperBody, /const ack = \(txt\.match\(\/<Ack>\(\[\^<\]\+\)<\\\/Ack>\/\) \|\| \[\]\)\[1\] \|\| '';/, 'must actually check the XML response\'s Ack value -- a 200 HTTP status from this endpoint does not mean the call succeeded');
assert.match(helperBody, /if \(ack !== 'Success' && ack !== 'Warning'\) \{/, 'Failure and PartialFailure Acks must be treated as real errors, not silently accepted');
assert.match(helperBody, /VariationSpecificPictureSet>/, 'must build the VariationSpecificPictureSet XML container -- this is the actual per-variation photo mechanism, distinct from anything in the REST group repair above');
assert.match(helperBody, /<VariationSpecificValue>\$\{xmlEscape\(v\.label\)\}<\/VariationSpecificValue>/,
  'each picture set must be keyed by the variation\'s own label text (VariationSpecificValue) -- this has to exactly match the dropdown\'s own option text or eBay cannot bind the photos to the right cover');
assert.match(helperBody, /<Item><ItemID>\$\{xmlEscape\(listingId\)\}<\/ItemID><Variations><Pictures>\$\{sets\}<\/Pictures><\/Variations><\/Item>/,
  'the picture sets must be nested under Item.Variations.Pictures, eBay\'s documented hierarchy for this field -- a wrong nesting level is silently ignored rather than erroring');

console.log('eBay Trading API variation-photo helper checks passed');

// The same binding must also be set automatically when a NEW group
// listing is first published -- otherwise every future listing keeps
// landing with the same 0/12 gap this whole fix exists to close, and the
// store would have to remember to run REPAIR LISTING PHOTOS every time.

const createFnStart = worker.indexOf('async function createAndPublishEbayVariationListing');
const createFnEnd = worker.indexOf('// Repairs group-listing photo-to-cover binding', createFnStart);
const createFnBody = worker.slice(createFnStart, createFnEnd);
assert.match(createFnBody, /await setEbayVariationSpecificPhotos\(ebayToken, listingId, built\.map\(v => \(\{ label: v\.label, imageUrls: \[v\.imageUrl, \.\.\.\(v\.imageUrls \|\| \[\]\)\]\.filter\(Boolean\) \}\)\)\)/,
  'a freshly published group listing must have its per-cover photo binding set at publish time, using every real photo already gathered for that variant -- not left for a store to notice and repair later');
assert.match(createFnBody, /warnings\.push\('Could not set per-cover "Cover: Select" photo binding: '/,
  'a Trading API failure here must surface as a warning on the listing result, never throw and kill an otherwise-successful publish');

console.log('New-listing variation-photo binding checks passed');

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
