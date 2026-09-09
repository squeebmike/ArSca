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
assert.match(repairFnBody, /imageBySku\[sku\] = r\.data\.image \|\| '';/,
  'must map each variant SKU back to that inventory_item row\'s OWN stored image -- the per-row image was never touched by the shared-array bug, so it is the trustworthy source for the repair');
assert.match(repairFnBody, /async function repairEbayGroupListingImages\(env, ebayToken, storeId, groupKey, rows\)/,
  'must accept the store\'s inventory_items rows as a parameter instead of re-fetching them itself -- the batch-repair route already has this same store-wide set and would otherwise re-fetch it once per group listing being repaired');
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
// eBay's own variantSKUs/specifications.values arrays are documented as
// positionally aligned -- but that is exactly the "documented as
// sufficient, not actually true in practice" assumption that broke the
// REST group-level imageUrls array before this repair tool existed (see
// foc-ebay-group-image-position-binding.test.mjs). Trusting it a SECOND
// time here to look up each SKU's label would risk silently cross-wiring
// one cover's photo onto a different cover's dropdown entry -- worse than
// the original bug, since a real (but wrong) photo would show up instead
// of no photo at all. The repair instead re-derives each cover's label
// from this app's OWN trusted data: focSkuId -> comic_skus.variant_label,
// the exact same label this app sent to eBay when the listing was created.
assert.doesNotMatch(repairFnBody, /specifications\?\.\[0\]\?\.values/,
  'must NOT re-derive per-SKU labels from eBay\'s specifications.values by array position -- that is an unverified assumption this app already got burned by once for the group imageUrls array, and a silent mismatch here would cross-wire covers instead of erroring');
assert.match(repairFnBody, /const focSkuIds = \[\.\.\.new Set\(Object\.values\(focSkuIdBySku\)\.filter\(Boolean\)\)\];/,
  'must collect each variant\'s own focSkuId from our own inventory_items rows, not from eBay\'s response');
assert.match(repairFnBody, /comic_skus\?id=in\.\(\$\{focSkuIds\.map\(id => encodeURIComponent\(id\)\)\.join\(','\)\}\)&select=id,variant_label/,
  'must look up each cover\'s real label from comic_skus by its own focSkuId -- the same source of truth the label was originally built from, not eBay\'s echoed array');
assert.match(repairFnBody, /label: focSkuIdBySku\[sku\] \? labelBySkuId\[focSkuIdBySku\[sku\]\] : nameBySku\[sku\],/,
  'a real cover uses its own comic_skus label; the synthetic bundle variant (no focSkuId) falls back to its own stored name, which already IS its label verbatim');
assert.match(repairFnBody, /const variantAspectName = group\.variesBy\?\.specifications\?\.\[0\]\?\.name \|\| 'Cover';/,
  'must derive the real variant aspect name (e.g. "Cover") from eBay\'s own live group data rather than assuming -- a wrong/empty aspect name gets the whole photo-binding request rejected outright (see the VariationSpecificName fix below)');
assert.match(repairFnBody, /const result = await setEbayVariationSpecificPhotos\(ebayToken, listingId, variantPhotos, variantAspectName\);/,
  'the repair must also call setEbayVariationSpecificPhotos with one entry per SKU AND the real aspect name -- fixing only the REST-side gallery array leaves the actual buyer-facing symptom (dropdown does not change the photo) completely unfixed');
assert.match(repairFnBody, /if \(result\.skipped\.length\) warning = `Per-cover photo binding was not set for: \$\{result\.skipped\.join\(', '\)\}/,
  'a variant skipped for missing a label/photo must be named in the warning, not silently omitted -- a partial binding must never look identical to full success');
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
// Store report (live error, TWICE more after each of the two earlier fix
// attempts here): "AddFixedPriceItem failed: Variation specific name ""
// used for pictures does not exist in variation specific set." Root
// cause, finally confirmed against eBay's own schema reference
// (PicturesType/VariationSpecificPictureSetType): VariationSpecificName
// belongs to the PARENT Pictures container, declared EXACTLY ONCE -- it
// is NOT a field of each individual VariationSpecificPictureSet entry.
// The first fix attempt sent no name at all; the second attempt (this
// exact wrong structure) repeated the name inside every single picture
// set instead of declaring it once up front, which eBay's parser also
// rejects since it never finds a name where it expects one (leading
// child of Pictures, before any VariationSpecificPictureSet).
assert.match(helperBody, /`<VariationSpecificPictureSet><VariationSpecificValue>\$\{xmlEscape\(v\.label\)\}<\/VariationSpecificValue>` \+/,
  'each picture set entry must carry ONLY the variation\'s own label text (VariationSpecificValue) -- the aspect name does not belong inside each repeated entry');
assert.match(helperBody, /async function setEbayVariationSpecificPhotos\(ebayToken, listingId, variantPhotos, variantAspectName = 'Cover'\)/,
  'must accept the real aspect name as a parameter (defaulting to \'Cover\', the only variant dimension this app has ever used) rather than hardcoding or omitting it');
assert.match(helperBody, /<Item><ItemID>\$\{xmlEscape\(listingId\)\}<\/ItemID><Variations><Pictures><VariationSpecificName>\$\{xmlEscape\(variantAspectName\)\}<\/VariationSpecificName>\$\{sets\}<\/Pictures><\/Variations><\/Item>/,
  'VariationSpecificName must be declared exactly ONCE, as the leading child of Pictures, before the repeated VariationSpecificPictureSet entries -- eBay\'s own schema puts the aspect name on the Pictures container itself, not on each picture set');
assert.match(helperBody, /const skipped = variantPhotos\.filter\(v => !\(v\.label && v\.imageUrls && v\.imageUrls\.length\)\)\.map\(v => v\.label \|\| v\.sku \|\| '\(unidentified cover\)'\);/,
  'a variant missing a label or photo must be tracked by name/sku, not just silently dropped from the request -- otherwise a partial binding (e.g. 4 of 5 covers set) looks identical to full success to every caller');
assert.match(helperBody, /return \{ \.\.\.result, skipped \};/, 'the skipped list must actually be returned to the caller, not just computed and discarded');

console.log('eBay Trading API variation-photo helper checks passed');

// The same binding must also be set automatically when a NEW group
// listing is first published -- otherwise every future listing keeps
// landing with the same 0/12 gap this whole fix exists to close, and the
// store would have to remember to run REPAIR LISTING PHOTOS every time.

const createFnStart = worker.indexOf('async function createAndPublishEbayVariationListing');
const createFnEnd = worker.indexOf('// Repairs group-listing photo-to-cover binding', createFnStart);
const createFnBody = worker.slice(createFnStart, createFnEnd);
assert.match(createFnBody, /const photoResult = await setEbayVariationSpecificPhotos\(ebayToken, listingId, built\.map\(v => \(\{ label: v\.label, sku: v\.sku, imageUrls: \[v\.imageUrl, \.\.\.\(v\.imageUrls \|\| \[\]\)\]\.filter\(Boolean\) \}\)\), variantAspectName\)/,
  'a freshly published group listing must have its per-cover photo binding set at publish time, using every real photo already gathered for that variant AND the real aspect name -- not left for a store to notice and repair later');
assert.match(createFnBody, /if \(photoResult\.skipped\.length\) warnings\.push\(`Per-cover photo binding was not set for: \$\{photoResult\.skipped\.join\(', '\)\}/,
  'a variant skipped for missing a label/photo at publish time must be named in the listing\'s own warnings, not silently omitted');
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
assert.match(routeBody, /const \{ data: rows \} = await supabaseAdminFetch\(env, `inventory_items\?store_id=eq\.\$\{encodeURIComponent\(storeId\)\}&status=neq\.sold&select=data`\);/,
  'must fetch the store\'s inventory_items exactly once regardless of how many groups get repaired, and pass that same set into every repairEbayGroupListingImages call -- re-fetching this per group would be redundant I/O for a store with several live listings');
assert.match(routeBody, /groupKeys = \[\.\.\.new Set\(\(rows \|\| \[\]\)\.map\(r => r\.data\?\.ebayInventoryItemGroupKey\)\.filter\(Boolean\)\)\]/,
  'when no specific groupKey is given, must discover every distinct group listing on file for the store and repair them all in one pass');
assert.match(routeBody, /for \(const groupKey of groupKeys\) \{\s*try \{ repaired\.push\(await repairEbayGroupListingImages\(env, ebayToken, storeId, groupKey, rows\)\); \}/,
  'must attempt every group listing independently, passing the already-fetched rows through -- one listing failing (e.g. already ended on eBay) must not block repairing the rest');
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

// A repair "succeeding" with a per-listing warning (e.g. the Trading API
// call failing while the REST gallery fix still went through) was only
// ever logged to the browser console -- invisible to a store owner who
// isn't running dev tools. They'd see "N listings repaired" and reasonably
// assume it worked, with no way to tell Claude what eBay actually said
// back when it still didn't. The real error text must be put directly in
// front of the person running this, not buried in console output only an
// engineer would think to open.
const repairHandlerStart = focDash.indexOf('async function repairFocEbayGroupPhotos(){');
const repairHandlerEnd = focDash.indexOf('async function loadEbaySafeDays', repairHandlerStart);
const repairHandlerBody = focDash.slice(repairHandlerStart, repairHandlerEnd);
assert.match(repairHandlerBody, /alert\('Some listings had issues:/,
  'a repair with any warnings or failures must alert() the actual per-listing message text directly to whoever clicked the button -- console.warn/console.error alone hides the real diagnostic from a non-technical store owner');
assert.match(repairHandlerBody, /r\.groupKey\+': '\+r\.warning/, 'the alert must include each warned listing\'s own message, not just a count');
assert.match(repairHandlerBody, /f\.groupKey\+': '\+f\.error/, 'the alert must include each failed listing\'s own message, not just a count');

console.log('FOC eBay group-listing photo repair warning-visibility checks passed');
