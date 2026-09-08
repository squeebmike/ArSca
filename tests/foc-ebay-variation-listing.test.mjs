import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const preorders = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');
const focDash = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');

// Store request: a real competitor eBay listing showed ONE page with a
// native "Cover: Select" dropdown (Cover A / Cover B / Cover C / "All
// Covers Bundle") instead of this app's existing one-listing-per-cover FOC
// presale flow ("how do I do it this way?! the bundles should list like
// that"). This uses eBay's real multiple-variation-listing mechanics
// (inventory_item_group + publish_by_inventory_item_group) to publish every
// checked cover of one FOC title as a single shared listing.

// ---------------------------------------------------------------------
// Backend: createAndPublishEbayVariationListing
// ---------------------------------------------------------------------
const createGroupStart = worker.indexOf('async function createAndPublishEbayVariationListing');
assert.ok(createGroupStart !== -1, 'createAndPublishEbayVariationListing must exist');
const createGroupEnd = worker.indexOf('async function withdrawEbayOfferGroup', createGroupStart);
const createGroupBody = worker.slice(createGroupStart, createGroupEnd);

assert.match(createGroupBody, /if \(!Array\.isArray\(variants\) \|\| variants\.length < 2\)/,
  'must require at least 2 variants -- a single-cover "group" is just createAndPublishEbayListing');
assert.match(createGroupBody, /await ensureEbayMerchantLocation\(env, storeId, ebayToken\)/,
  'must use the same shared merchant-location/shipFrom enforcement as the single-cover listing path, not a second copy');

// Each variant gets its own real inventory_item (own image/UPC/aspects,
// with the varying aspect -- e.g. Cover -- set to that variant's own label)
// -- reusing buildEbayInventoryItemBody, the same helper the single-cover
// flow uses, so both paths stay consistent for every other field.
assert.match(createGroupBody, /buildEbayInventoryItemBody\(\{/, 'must build a real inventory_item per variant via the shared builder');
assert.match(createGroupBody, /customAspects: \{ \.\.\.\(b\.customAspects \|\| \{\}\), \.\.\.\(v\.aspectOverrides \|\| \{\}\), \[variantAspectName\]: v\.label \}/,
  'each variant\'s inventory_item must carry the varying aspect (e.g. Cover) set to its own label, on top of the shared aspects and any per-variant override (e.g. a distinct Cover Artist)');
assert.match(createGroupBody, /fetch\(`https:\/\/api\.ebay\.com\/sell\/inventory\/v1\/inventory_item\/\$\{sku\}`, \{\s*\n\s*method: 'PUT',/,
  'must PUT each variant\'s inventory_item individually before the group is created');

// The inventory_item_group is what makes eBay render the native variation
// dropdown -- variesBy.specifications names the aspect and its possible
// values, aspectsImageVaryBy makes eBay swap the shown photo per selection
// (each cover really does have its own art).
assert.match(createGroupBody, /inventory_item_group\/\$\{groupKey\}/, 'must PUT the inventory_item_group tying the variant SKUs together');
assert.match(createGroupBody, /variantSKUs: built\.map\(v => v\.sku\)/, 'the group must list every variant SKU just created');
assert.match(createGroupBody, /aspectsImageVaryBy: \[variantAspectName\]/, 'the group must vary its shown image by the same aspect (e.g. Cover), so each variant shows its own cover art like the real eBay example');
assert.match(createGroupBody, /specifications: \[\{ name: variantAspectName, values: built\.map\(v => v\.label\) \}\]/, 'the group must declare the dropdown values as every variant\'s own label');

// Offers are created per-variant (own price/quantity) but never published
// individually -- publish_by_inventory_item_group publishes the whole set
// at once under one shared listingId, which is the entire point (one
// listing page, not N).
assert.match(createGroupBody, /buildEbayOfferBody\(\{ \.\.\.b, price: v\.price, quantity: v\.quantity \}, v\.sku, locationKey, env\)/,
  'each variant must get its own offer with its own price/quantity');
assert.doesNotMatch(createGroupBody, /\/offer\/\$\{[^}]*\}\/publish['"`]/, 'individual offers must never be published one at a time -- that would create N separate listings, not one');
assert.match(createGroupBody, /offer\/publish_by_inventory_item_group/, 'must publish the whole group at once via eBay\'s group-publish endpoint');
assert.match(createGroupBody, /inventoryItemGroupKey: groupKey, marketplaceId: 'EBAY_US'/, 'the group-publish call must name the group key and marketplace');

assert.match(createGroupBody, /if \(!listingId\) warnings\.push\(/, 'must warn (not silently proceed) if eBay\'s publish response does not carry a listingId back -- same "verify, don\'t just trust a 200" discipline the rest of this file uses for eBay responses');

// ---------------------------------------------------------------------
// Backend: withdrawEbayOfferGroup (ending the WHOLE shared listing)
// ---------------------------------------------------------------------
const withdrawGroupStart = worker.indexOf('async function withdrawEbayOfferGroup');
assert.ok(withdrawGroupStart !== -1, 'withdrawEbayOfferGroup must exist');
const withdrawGroupEnd = worker.indexOf("if (url.pathname === '/ebay/list')", withdrawGroupStart);
const withdrawGroupBody = worker.slice(withdrawGroupStart, withdrawGroupEnd);
assert.match(withdrawGroupBody, /offer\/withdraw_by_inventory_item_group/, 'must use eBay\'s group-withdraw endpoint to end the whole shared listing at once');
assert.match(withdrawGroupBody, /inventoryItemGroupKey, marketplaceId: 'EBAY_US'/, 'the group-withdraw call must name the group key and marketplace');

// Both new helpers must be injected into the FOC request handler's deps,
// alongside the existing single-offer withdraw/token helpers.
assert.match(worker, /addBusinessDays, getEbayPresaleSafeBusinessDays, getEbayUserAccessToken, withdrawEbayOffer, withdrawEbayOfferGroup, endEbayVolumeDiscount, ebayReviseOfferQuantity,/,
  'withdrawEbayOfferGroup must be injected into the FOC request handler alongside the other eBay deps');

// ---------------------------------------------------------------------
// Backend: /foc/ebay/presale-group-preview + /foc/ebay/create-presale-group
// ---------------------------------------------------------------------
const routeStart = worker.indexOf("url.pathname === '/foc/ebay/presale-group-preview'");
assert.ok(routeStart !== -1, 'the group preview/create route must exist');
const routeEnd = worker.indexOf("if (url.pathname === '/foc/ebay/convert-to-instock')", routeStart);
const routeBody = worker.slice(routeStart, routeEnd);

assert.match(routeBody, /requireStoreUser\(request, env, storeId, \['owner','admin'\]\)/,
  'publishing a shared multi-cover eBay listing is consequential -- must be owner/admin only, same bar as the single-cover create-presale route');

// Eligibility must be recomputed server-side from the trusted comic_skus
// rows, exactly like the single-cover route -- a stale/tampered client
// request must never be able to list an ineligible cover.
assert.match(routeBody, /const eligibleDate = addBusinessDays\(onSaleDate, -safeBusinessDays\);/, 'must recompute the same eligibility window as the single-cover route from the trusted DB row, not trust the client');
assert.match(routeBody, /if \(!cover\.eligible\) return json\(\{ ok: false, error: `"\$\{cover\.variantLabel\}" is not eligible for eBay presale: \$\{cover\.reason\}` \}, 409\);/,
  'must reject publishing any cover the server itself determined is ineligible, even if the client asked for it');
assert.match(routeBody, /if \(chosen\.length < 2\) return json\(\{ ok: false, error: 'Select at least 2 covers to list as one eBay variation listing' \}, 400\);/,
  'must require at least 2 real covers server-side too, not just in the UI');
assert.match(routeBody, /if \(!basePolicyId\) return json\(\{ ok: false, error: 'Pick a shipping policy in the review screen before publishing/,
  'must keep the store\'s "never auto-detect a shipping policy for FOC listings" rule for the group flow too');

// The optional "All Covers Bundle" variant must never become a free/
// unlimited listing by accident -- both a real price AND a real quantity
// are required before it's included at all.
assert.match(routeBody, /if \(bundlePriceCents > 0 && bundleQty > 0\) \{/, 'the bundle variant must require both a positive price and a positive quantity before being included');
assert.match(routeBody, /label: \(typeof body\.bundle\.label === 'string' && body\.bundle\.label\.trim\(\)\) \? body\.bundle\.label\.trim\(\)\.substring\(0, 60\) : `All Covers Bundle \(\$\{built\.length\}( Books\)`)?/,
  'the bundle variant must default to a sensible auto-generated label when the store does not type one');

// Every real cover variant (and the bundle, if included) becomes its own
// inventory_items presale row, same schema the single-cover route already
// uses, but sharing the group's listingId/groupKey and each carrying its
// OWN offerId/sku (offers are per-variant even though the listing is
// shared) -- this is what lets receiving/ending logic still work per cover.
assert.match(routeBody, /ebayListingId: listingResult\.listingId, ebayOfferId: matched\.offerId,/, 'each created row must record the shared listingId but its OWN per-variant offerId');
assert.match(routeBody, /ebayInventoryItemGroupKey: listingResult\.inventoryItemGroupKey,/, 'each created row must record the group key so later withdrawal logic can find its siblings');
assert.match(routeBody, /source: v\.skuId \? 'foc_presale' : 'foc_presale_bundle',/, 'the bundle variant\'s row must be tagged with a distinct source, since it has no real focSkuId of its own');
assert.match(routeBody, /focBundleSkuIds: v\.skuId \? undefined : built\.filter\(x => x\.skuId\)\.map\(x => x\.skuId\),/, 'the bundle row must reference every real cover it bundles, for later auditing');

// ---------------------------------------------------------------------
// Backend: withdrawFocPresaleRow (group-aware ending, foc-preorders.mjs)
// ---------------------------------------------------------------------
const withdrawRowStart = preorders.indexOf('async function withdrawFocPresaleRow');
assert.ok(withdrawRowStart !== -1, 'withdrawFocPresaleRow must exist');
const withdrawRowEnd = preorders.indexOf('async function adminEndFocEbayListings', withdrawRowStart);
const withdrawRowBody = preorders.slice(withdrawRowStart, withdrawRowEnd);

assert.match(withdrawRowBody, /if\(!groupKey\|\|!deps\.ebayReviseOfferQuantity\|\|!deps\.withdrawEbayOfferGroup\)\{\s*\n\s*await deps\.withdrawEbayOffer\(env,ebayToken,row\.data\.ebayOfferId\);/,
  'a row with no group key (the normal single-cover listing) must still just withdraw its own offer directly, unchanged from before this feature');
assert.match(withdrawRowBody, /const siblingStillLive=\(allPresaleRows\|\|\[\]\)\.some\(r=>r\.id!==row\.id&&!withdrawingIds\.has\(r\.id\)&&\(r\.data\|\|\{\}\)\.ebayInventoryItemGroupKey===groupKey&&!r\.data\.ebayWithdrawnAt&&Number\(r\.data\.qty\?\?r\.data\.quantity\?\?0\)>0\);/,
  'must check whether another cover in the SAME group is still live (and not also being withdrawn in this same batch) before deciding how to end this row');
assert.match(withdrawRowBody, /if\(siblingStillLive\)await deps\.ebayReviseOfferQuantity\(env,ebayToken,row\.data\.ebayOfferId,0\);/,
  'ending one cover while a sibling cover in the same shared listing is still live must only zero that cover\'s own offer quantity, never take the whole shared listing down');
assert.match(withdrawRowBody, /else await deps\.withdrawEbayOfferGroup\(env,ebayToken,groupKey\);/,
  'ending the LAST live cover in a group must actually withdraw the whole shared listing, not leave an empty zero-quantity listing live on eBay forever');

// Both real call sites (the PRH-submit auto-sweep for unordered books, and
// the manual bulk "end remaining listings" tool) must route through the
// group-aware helper instead of calling withdrawEbayOffer directly, or a
// grouped listing would still get silently killed by ending just one cover.
const prhSweepStart = preorders.indexOf('async function adminPrhSubmission');
const prhSweepEnd = preorders.indexOf('async function adminCycle', prhSweepStart);
const prhSweepBody = preorders.slice(prhSweepStart, prhSweepEnd);
assert.match(prhSweepBody, /const withdrawingIds=new Set\(toWithdraw\.map\(r=>r\.id\)\);/, 'the PRH-submit auto-sweep must know every row it is withdrawing in this same batch, so two sibling covers withdrawn together correctly fall through to one group withdraw');
assert.match(prhSweepBody, /await withdrawFocPresaleRow\(env,deps,ebayToken,row,presaleRows,withdrawingIds\);/, 'the PRH-submit auto-sweep must use the group-aware withdrawal helper');

const bulkEndStart = preorders.indexOf('async function adminEndFocEbayListings');
const bulkEndEnd = preorders.indexOf('async function adminCycle', bulkEndStart);
const bulkEndBody = preorders.slice(bulkEndStart, bulkEndEnd);
assert.match(bulkEndBody, /const withdrawingIds=new Set\(toWithdraw\.map\(r=>r\.id\)\);/, 'the manual bulk-end tool must know every row it is withdrawing in this same batch too');
assert.match(bulkEndBody, /await withdrawFocPresaleRow\(env,deps,ebayToken,row,presaleRows,withdrawingIds\);/, 'the manual bulk-end tool must use the group-aware withdrawal helper');

// ---------------------------------------------------------------------
// Frontend: the review modal + window exposure
// ---------------------------------------------------------------------
assert.match(focDash, /async function openFamilyEbayGroupReview\(familyId\)\{/, 'the review-modal opener must exist');
assert.match(focDash, /async function submitFamilyEbayGroupReview\(familyId\)\{/, 'the submit handler must exist');
assert.match(focDash, /window\.openFamilyEbayGroupReview=openFamilyEbayGroupReview;window\.submitFamilyEbayGroupReview=submitFamilyEbayGroupReview;/,
  'both handlers must be exposed on window -- this file is an IIFE, so an onclick attribute cannot reach them otherwise (see foc-dashboard-window-exposure.test.mjs)');

// The entry point button only makes sense once a title has 2+ covers.
assert.match(focDash, /var groupListBtn=\(f\.variants\|\|\[\]\)\.length>=2\?'<button/,
  'the family card must only offer the group-listing button when there are at least 2 covers to put a dropdown between');
assert.match(focDash, /onclick="openFamilyEbayGroupReview\(/, 'the group-listing button must open the review modal for its own family id');

// Submitting must refuse to publish with fewer than 2 checked covers or no
// shipping policy picked, matching the server-side guards above.
const submitGroupStart = focDash.indexOf('async function submitFamilyEbayGroupReview');
const submitGroupEnd = focDash.indexOf('\n// ═══════', submitGroupStart);
const submitGroupBody = focDash.slice(submitGroupStart, submitGroupEnd);
assert.match(submitGroupBody, /if\(variants\.length<2\)\{toast_dash\('Check at least 2 covers to list as one eBay variation listing'\);return;\}/,
  'must block submitting with fewer than 2 checked covers client-side too, before ever hitting the network');
assert.match(submitGroupBody, /if\(!basePolicyId\)\{toast_dash\('Select a shipping policy before publishing'\);return;\}/,
  'must require an explicit shipping policy pick, same as the single-cover review modal');
assert.match(submitGroupBody, /api\('\/foc\/ebay\/create-presale-group',\{method:'POST'/, 'must submit to the new group-create route');

console.log('FOC eBay multi-cover variation listing contract checks passed');
