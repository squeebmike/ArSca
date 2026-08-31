import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const preorders = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');
const focDash = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');

// Store report: covers that WERE ordered from PRH keep their eBay presale
// listing live indefinitely -- the existing auto-sweep in
// adminPrhSubmission only withdraws listings for covers that ended up
// with zero copies ordered. Nothing caps a listing once its unsold
// quantity roughly matches what was ordered, and nothing is tied to the
// FOC cutoff timestamp at all. First fix: a bulk "end all remaining"
// route/button. Follow-up (this test's real subject): that was
// all-or-nothing for the whole cycle -- no way to keep a specific cover's
// presale running while ending the rest. Now the dealer sees a checklist
// of every still-live listing, pre-checked, and unchecks whichever ones
// they want to KEEP live before confirming.

const routeStart = preorders.indexOf('async function adminEndFocEbayListings');
const routeEnd = preorders.indexOf('async function adminCycle', routeStart);
const routeBody = preorders.slice(routeStart, routeEnd);

assert.ok(routeStart !== -1, 'adminEndFocEbayListings must exist');
assert.match(routeBody, /requireStoreUser\(request,env,storeId,\['owner','admin'\]\)/,
  'ending live eBay listings is consequential -- must be owner/admin only, same bar as submitting the PRH order');

assert.match(routeBody, /const focSkuIds=Array\.isArray\(body\.focSkuIds\)\?new Set\(body\.focSkuIds\.map\(String\)\):null;/,
  'must accept an optional allow-list of specific covers to end, so the dealer can choose to keep some listings running');
assert.match(routeBody,
  /if\(!\(d\.source==='foc_presale'&&d\.focCycleId===cycleId&&d\.ebayOfferId&&Number\(d\.qty\?\?d\.quantity\?\?0\)>0\)\)return false;/,
  'must still match only real, still-live FOC presale listings for this cycle');
assert.match(routeBody, /return focSkuIds\?focSkuIds\.has\(String\(d\.focSkuId\)\):true;/,
  'when an allow-list is given, must only end the specifically selected covers -- when omitted, must fall back to ending everything live (the original behavior)');
assert.doesNotMatch(routeBody, /includedSkuIds/,
  'must stay independent of the PRH-order-inclusion set used by the separate auto-sweep in adminPrhSubmission -- this tool ends listings regardless of order status');

assert.match(routeBody, /await deps\.withdrawEbayOffer\(env,ebayToken,row\.data\.ebayOfferId\)/, 'must actually withdraw each eBay offer');
assert.match(routeBody, /deps\.endEbayVolumeDiscount\(env,ebayToken,row\.data\.ebayVolumeDiscountPromotionId\)/, 'must also end any attached volume-discount promotion so it does not outlive the listing');
assert.match(routeBody, /ebayWithdrawnReason:'manual_bulk_end'/, "must record a distinct reason from the auto-sweep's 'not_included_in_prh_order', for later auditing");
assert.match(routeBody, /return deps\.json\(\{ok:true,endedCount,failedCount:errors\.length,errors\}\)/, 'response must report how many succeeded/failed');

// Route wiring
assert.match(preorders, /if\(path==='\/foc\/admin\/end-ebay-listings'&&request\.method==='POST'\)return adminEndFocEbayListings\(request,env,deps\);/,
  'the route must actually be wired into handleFocRequest');
assert.match(worker, /url\.pathname\.startsWith\('\/foc\/admin\/'\)/, 'the generic /foc/admin/ prefix route must still exist for this new path to reach handleFocRequest');

// Dashboard: the toolbar button opens the selection modal (no longer ends
// everything immediately on click).
assert.match(focDash, /onclick="endFocEbayListings\(\)">END REMAINING EBAY LISTINGS</, 'the FOC Review screen must have a button to open the end-listings review');

const openStart = focDash.indexOf('function endFocEbayListings');
const openEnd = focDash.indexOf('\nfunction toggleFocEndEbayAll', openStart);
const openBody = focDash.slice(openStart, openEnd);
assert.ok(openStart !== -1, 'endFocEbayListings must exist');
assert.match(openBody, /var live=allFocSkus\(\)\.filter\(function\(v\)\{return v\.ebayPresaleStatus==='LISTED';\}\);/,
  'must build the checklist from the covers that are actually still live, not every SKU in the cycle');
assert.match(openBody, /class="foc-end-ebay-cb" value="'\+esc\(v\.id\)\+'" checked/,
  'every row must be pre-checked by default, so confirming with no changes matches ending everything (the original behavior)');
assert.match(openBody, /onclick="confirmEndFocEbayListings\(\)">END SELECTED LISTINGS</, 'must hand off to the confirm step, not act immediately');

const confirmStart = focDash.indexOf('async function confirmEndFocEbayListings');
const confirmEnd = focDash.indexOf('\nasync function loadEbaySafeDays', confirmStart);
const confirmBody = focDash.slice(confirmStart, confirmEnd);
assert.ok(confirmStart !== -1, 'confirmEndFocEbayListings must exist');
assert.match(confirmBody, /var ids=Array\.prototype\.slice\.call\(document\.querySelectorAll\('\.foc-end-ebay-cb:checked'\)\)\.map\(function\(cb\)\{return cb\.value;\}\);/,
  'must collect only the checked covers, or unchecking one to keep it live would do nothing');
assert.match(confirmBody, /if\(!ids\.length\)\{toast_dash\('Nothing selected to end'\);return;\}/, 'must guard against confirming with everything unchecked');
assert.match(confirmBody, /api\('\/foc\/admin\/end-ebay-listings',\{method:'POST',headers:\{'Content-Type':'application\/json'\},body:JSON\.stringify\(\{storeId:getActiveStoreId\(\),cycleId:state\.cycle\.id,focSkuIds:ids\}\)\}\)/,
  'must send the selected ids as the allow-list, or the server has no way to know which covers to spare');

assert.match(focDash, /window\.endFocEbayListings=endFocEbayListings;window\.toggleFocEndEbayAll=toggleFocEndEbayAll;window\.confirmEndFocEbayListings=confirmEndFocEbayListings;/,
  'all three handlers must be exposed on window for their onclick attributes to find them');

console.log('FOC selective eBay end-listings contract checks passed');
