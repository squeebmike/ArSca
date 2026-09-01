import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// Store request: bumping a still-live FOC presale listing's quantity at
// PRH order-lock time (see adminPrhSubmission) needs a quantity-only
// revise that doesn't disturb anything else already set on the offer.
// ebayReviseOfferPrice (its sibling, used by the scheduled markdown job)
// does NOT carry fulfillmentPolicyId or storeCategoryNames through from
// the GET into the PUT -- since eBay's offer PUT is a full replace, that
// silently wipes both fields on every price drop. This new helper must
// not repeat that mistake.
const qtyHelperStart = worker.indexOf('async function ebayReviseOfferQuantity(env, ebayToken, offerId, newQuantity) {');
const qtyHelperEnd = worker.indexOf('\n// Drops the price of eBay listings', qtyHelperStart);
const qtyHelperBody = worker.slice(qtyHelperStart, qtyHelperEnd);
assert.ok(qtyHelperStart !== -1, 'ebayReviseOfferQuantity must exist');
assert.match(qtyHelperBody, /fulfillmentPolicyId: offer\.listingPolicies\?\.fulfillmentPolicyId \|\| '',/,
  'must carry the existing fulfillmentPolicyId through from the GET, or a quantity-only bump would silently wipe the listing\'s shipping policy');
assert.match(qtyHelperBody, /storeCategoryNames: offer\.storeCategoryNames \|\| \[\],/,
  'must carry the existing storeCategoryNames through from the GET, or a quantity-only bump would silently wipe the listing\'s store category');
assert.doesNotMatch(qtyHelperBody, /buildEbayInventoryItemBody/, 'must only ever touch the offer (quantity), never the inventory_item (title/condition/aspects/images)');

console.log('ebayReviseOfferQuantity contract checks passed');

// Store request: once the PRH order is locked in, a live FOC presale
// eBay listing's buyable quantity should sync to the real ordered total
// for that cover -- see adminPrhSubmission in scripts/foc-preorders.mjs
// (covered directly in tests/foc-ebay-presale-review.test.mjs). Functional
// check here of the pure "how much should be available now" math against
// the scenarios that actually matter for real money: under-ordered,
// over-ordered, and a SKU that already sold through eBay presale.
function orderLockNewAvailable(orderedTotal, focPresaleOriginalQty, currentAvailable) {
  const alreadySold = Math.max(0, (focPresaleOriginalQty || currentAvailable) - currentAvailable);
  return Math.max(0, orderedTotal - alreadySold);
}
{
  // Listed 10 for presale, sold 3 (available=7) -- PRH allocation came in
  // higher than expected at 15. The listing should now show 12 available
  // (15 ordered minus the 3 already sold), not just the original 7.
  const newAvailable = orderLockNewAvailable(15, 10, 7);
  assert.equal(newAvailable, 12, 'a higher-than-listed PRH allocation must raise the live listing\'s available quantity, preserving already-sold units');
}
{
  // Same listing (originally 10, sold 3, available 7), but PRH allocation
  // came in LOWER than expected at 5 total. The listing must drop to 2
  // available (5 ordered minus the 3 already sold) -- never negative,
  // and never still showing the stale higher number.
  const newAvailable = orderLockNewAvailable(5, 10, 7);
  assert.equal(newAvailable, 2, 'a lower-than-listed PRH allocation must reduce the live listing\'s available quantity, not leave it overselling the true order');
}
{
  // Nothing has sold yet (available === originalQty) -- the listing should
  // simply be set to the ordered total outright.
  const newAvailable = orderLockNewAvailable(20, 10, 10);
  assert.equal(newAvailable, 20, 'with nothing sold yet, the listing should be set straight to the ordered total');
}
{
  // Defensive: an ordered total somehow lower than what's already sold
  // must clamp to zero, never a negative available quantity.
  const newAvailable = orderLockNewAvailable(2, 10, 7);
  assert.equal(newAvailable, 0, 'available quantity must never go negative even if the ordered total is implausibly low');
}

console.log('FOC order-lock quantity-sync functional checks passed');

// Store request: a book that's actually in stock and ready to ship fast
// should switch off the long "FOC 40D Handling" presale policy -- picked
// once in Settings (mirrors the FOC presale review modal's own picker:
// same /ebay/business-policies source, same FOC-clone exclusion) and
// applied by every /foc/ebay/convert-to-instock conversion.
assert.match(dashboard, /async function loadEbayNormalPolicyOptions\(savedId\)\{/, 'missing loadEbayNormalPolicyOptions');
assert.match(dashboard, /const FOC_HANDLING_CLONE_NAME_RE = \/-\\s\*FOC\\s\+\\d\+D\\s\+Handling\\s\*\$\/i;/,
  'the normal-policy picker must exclude the store\'s own FOC handling-time clones too, same as the presale picker -- picking a clone by mistake here would clone-of-a-clone the same way');
assert.match(dashboard, /const policies = \(d\.fulfillment\?\.policies \|\| \[\]\)\.filter\(p => !FOC_HANDLING_CLONE_NAME_RE\.test\(p\.name \|\| ''\)\);/,
  'must filter the real policy list, not show every policy including clones');
assert.match(dashboard, /function saveEbayNormalPolicySettings\(\)\{/, 'missing saveEbayNormalPolicySettings');
assert.match(dashboard, /const ebayNormalFulfillmentPolicyId = document\.getElementById\('vp-ebay-normal-policy'\)\?\.value \|\| '';/,
  'must actually read the selected policy id from the picker before saving');
assert.match(dashboard, /saveVendorProfile\(\{ ebayNormalFulfillmentPolicyId \}\);/, 'must persist the chosen policy id');
assert.match(dashboard, /id="vp-ebay-normal-policy"/, 'the settings panel must expose the picker element the save/load functions target');

// receipt_settings is a full-replace column written from two places
// (saveVendorProfile + savePaymentSettings) -- the new field must be in
// BOTH explicit whitelists or one of them will silently wipe it out,
// same class of bug this repo already hit once with ebayAutoReprice.
const normalPolicyInWhitelist = (dashboard.match(/ebayNormalFulfillmentPolicyId:next\.ebayNormalFulfillmentPolicyId \|\| '',/g) || []).length;
assert.equal(normalPolicyInWhitelist, 2, 'ebayNormalFulfillmentPolicyId must be carried in both receipt_settings whitelists (saveVendorProfile and savePaymentSettings), or one will erase the other\'s write');

console.log('Normal-handling-policy setting + wiring checks passed');
