import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const preorders = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');
const focDash = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');

// Store owner asked: covers that WERE ordered from PRH keep their eBay
// presale listing live indefinitely after SUBMIT PRH ORDER -- that sweep
// only withdraws listings for covers that got ZERO copies ordered
// (see foc-ebay-presale-review.test.mjs). Nothing caps or ends a listing
// for a cover that WAS ordered, and nothing is tied to the FOC cutoff
// timestamp at all, so a listing can keep selling on eBay past what the
// distributor order locked in -- a real oversell risk. This is a
// deliberately MANUAL (owner-triggered) bulk tool to end every still-live
// FOC presale listing for a cycle at once, regardless of whether that SKU
// made it into the PRH order -- unlike the auto-sweep, it does not filter
// by includedSkuIds.

const routeStart = preorders.indexOf('async function adminEndFocEbayListings');
const routeEnd = preorders.indexOf('async function adminCycle', routeStart);
const routeBody = preorders.slice(routeStart, routeEnd);

assert.ok(routeStart !== -1, 'adminEndFocEbayListings must exist');
assert.match(routeBody, /requireStoreUser\(request,env,storeId,\['owner','admin'\]\)/,
  'ending live eBay listings is consequential -- must be owner/admin only, same bar as submitting the PRH order');
assert.match(routeBody, /d\.source==='foc_presale'&&d\.focCycleId===cycleId&&d\.ebayOfferId&&Number\(d\.qty\?\?d\.quantity\?\?0\)>0/,
  'must match every still-live FOC presale listing for the cycle');
assert.doesNotMatch(routeBody, /includedSkuIds/,
  'unlike the auto-sweep inside adminPrhSubmission, this bulk tool must NOT filter to only unordered SKUs -- it ends listings for ordered covers too, since that is the whole point of this tool');
assert.match(routeBody, /await deps\.withdrawEbayOffer\(env,ebayToken,row\.data\.ebayOfferId\)/, 'must actually withdraw each eBay offer');
assert.match(routeBody, /deps\.endEbayVolumeDiscount\(env,ebayToken,row\.data\.ebayVolumeDiscountPromotionId\)/, 'must also end any attached volume-discount promotion so it does not outlive the listing');
assert.match(routeBody, /ebayWithdrawnReason:'manual_bulk_end'/, "must record a distinct reason from the auto-sweep's 'not_included_in_prh_order', for later auditing");
assert.match(routeBody, /return deps\.json\(\{ok:true,endedCount,failedCount:errors\.length,errors\}\)/, 'response must report how many succeeded/failed');

// Route wiring
assert.match(preorders, /if\(path==='\/foc\/admin\/end-ebay-listings'&&request\.method==='POST'\)return adminEndFocEbayListings\(request,env,deps\);/,
  'the route must actually be wired into handleFocRequest');

// The worker already injects withdrawEbayOffer/getEbayUserAccessToken/
// endEbayVolumeDiscount into the FOC module's deps for the existing
// auto-sweep -- this new route reuses the same deps, no new wiring needed
// there, but confirm the /foc/admin/ prefix still reaches handleFocRequest.
assert.match(worker, /url\.pathname\.startsWith\('\/foc\/admin\/'\)/, 'the generic /foc/admin/ prefix route must still exist for this new path to reach handleFocRequest');

// Dashboard button + handler
assert.match(focDash, /onclick="endFocEbayListings\(\)">END REMAINING EBAY LISTINGS</, 'the FOC Review screen must have a button to trigger this');
const handlerStart = focDash.indexOf('async function endFocEbayListings');
const handlerEnd = focDash.indexOf('\nasync function loadEbaySafeDays', handlerStart);
const handlerBody = focDash.slice(handlerStart, handlerEnd);
assert.ok(handlerStart !== -1, 'endFocEbayListings handler must exist in foc-dashboard.js');
assert.match(handlerBody, /if\(!confirm\(/, 'must confirm before ending live eBay listings -- this is a real, consequential action');
assert.match(handlerBody, /api\('\/foc\/admin\/end-ebay-listings',\{method:'POST'/, 'must POST to the new route');
assert.match(focDash, /window\.endFocEbayListings=endFocEbayListings;/, 'the handler must be exposed on window for the onclick to find it');

console.log('FOC bulk eBay end-listings contract checks passed');
