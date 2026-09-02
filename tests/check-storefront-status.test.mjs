import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// Store report: "publish all" said an item was live, the row menu agreed
// (showed Remove from Storefront, meaning onlineListed:true), and it still
// never showed on the live site -- with no way from the dashboard to see
// why. onlineListed is only ONE of several checks the live storefront
// route (isStorefrontItemAvailable in cloudflare-worker-full.js) applies --
// quantity>0, not sold/archived, and inventoryStatus/lifecycle not in an
// exclusion list that covers more than true sales (On Hold and Archived
// are in it too). checkStorefrontStatus calls the exact same live endpoint
// the storefront itself calls for one row (/public/storefront/item) and
// reports back which check is actually failing.

assert.match(dashboard, /<button class="hbtn" style="\$\{btnStyle\}" onclick="checkStorefrontStatus\('\$\{id\}'\);closeInvRowMenu\(\)">🔍 Check Storefront Status<\/button>/,
  'row menu must offer a way to check why an item is/isn\'t showing on the storefront');
assert.match(dashboard, /async function checkStorefrontStatus\(id\)\{/, 'missing checkStorefrontStatus');

const fnStart = dashboard.indexOf('async function checkStorefrontStatus(id){');
const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
const fnBody = dashboard.slice(fnStart, fnEnd);
assert.ok(fnStart !== -1, 'checkStorefrontStatus must exist');
assert.match(fnBody, /const res = await fetch\(WORKER \+ '\/public\/storefront\/item\?' \+ new URLSearchParams\(\{ store_id:storeId, id:rowId \}\)\);/,
  'must call the exact same live endpoint the storefront itself uses for one row, not a bespoke re-implementation');
assert.match(fnBody, /if\(!\(Number\(d\.quantity\) > 0\)\) reasons\.push/, 'must check quantity, one of the real gating conditions');
assert.match(fnBody, /if\(d\.onlineListed === false\) reasons\.push/, 'must check the onlineListed flag itself');
assert.match(fnBody, /if\(STOREFRONT_EXCLUDED_STATUS_REASONS\[d\.inventoryStatus\]\) reasons\.push/,
  'must check inventoryStatus/lifecycle against the real exclusion list -- this is the check that was invisible before (On Hold/Archived block a listed item silently)');

// The mirrored exclusion-reason list must exactly match the Worker's real
// isStorefrontItemAvailable exclusion list -- if these drift apart, the
// diagnostic tool would give a false "looks fine" for a status the live
// storefront actually still blocks.
const workerExclusionMatch = worker.match(/\['sold','archived','returned','deleted','sold_pending_pickup','sold_pending_shipment','hold','lost_damaged','presale'\]/);
assert.ok(workerExclusionMatch, 'the Worker\'s real exclusion list must exist to compare against');
const mirroredKeys = dashboard.match(/const STOREFRONT_EXCLUDED_STATUS_REASONS = \{([\s\S]*?)\};/)[1];
for (const status of ['sold','archived','returned','deleted','sold_pending_pickup','sold_pending_shipment','hold','lost_damaged','presale']) {
  assert.match(mirroredKeys, new RegExp(status + ':'), `STOREFRONT_EXCLUDED_STATUS_REASONS must mirror the Worker's own "${status}" exclusion, or this tool could wrongly clear an item the live storefront still blocks`);
}

console.log('Check Storefront Status contract checks passed');

// ── Functional: the reason-building logic itself ──
const STOREFRONT_EXCLUDED_STATUS_REASONS = {
  sold:'marked Sold', archived:'Archived', returned:'marked Returned', deleted:'marked Deleted',
  sold_pending_pickup:'Sold (pending pickup)', sold_pending_shipment:'Sold (pending shipment)',
  hold:'On Hold', lost_damaged:'Lost/Damaged', presale:'a FOC presale placeholder (not receivable stock)',
};
function buildReasons(d) {
  const reasons = [];
  if (!(Number(d.quantity) > 0)) reasons.push('quantity');
  if (d.onlineListed === false) reasons.push('onlineListed');
  if (d.soldAt) reasons.push('soldAt');
  if (d.archivedAt) reasons.push('archivedAt');
  if (STOREFRONT_EXCLUDED_STATUS_REASONS[d.inventoryStatus]) reasons.push('inventoryStatus:' + d.inventoryStatus);
  return reasons;
}

{
  // The exact scenario the store report was about: onlineListed is true,
  // everything LOOKS published, but the item is On Hold.
  const d = { quantity: 1, onlineListed: true, soldAt: '', archivedAt: '', inventoryStatus: 'hold' };
  assert.deepEqual(buildReasons(d), ['inventoryStatus:hold'], 'an On Hold item must be flagged even though onlineListed is true -- this is the exact silent-block scenario the report described');
}

{
  // A genuinely fine, live item must report no reasons.
  const d = { quantity: 3, onlineListed: true, soldAt: '', archivedAt: '', inventoryStatus: 'in_stock' };
  assert.deepEqual(buildReasons(d), [], 'a genuinely available item must report zero blocking reasons');
}

{
  // Multiple simultaneous problems must all surface, not just the first one found.
  const d = { quantity: 0, onlineListed: false, soldAt: '', archivedAt: '', inventoryStatus: 'in_stock' };
  assert.deepEqual(buildReasons(d), ['quantity', 'onlineListed'], 'every blocking reason must be reported together, not just the first match');
}

console.log('Check Storefront Status functional checks passed');
