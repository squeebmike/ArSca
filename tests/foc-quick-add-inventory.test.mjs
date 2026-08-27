import fs from 'node:fs';
import assert from 'node:assert/strict';

const focDash = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');

// Store report: no way existed to add a single book straight to inventory
// from the FOC cover wall -- RECEIVE SHIPMENT only lists covers that were
// actually ordered (customerQty+storeQuantity>0), and only as a bulk,
// whole-cycle action on a separate screen. quickAddFocSkuToInventory reuses
// the same trusted /foc/admin/receive path (paid-customer reservation
// first, real inventory_items rows, FOC linkage) for just the one cover
// clicked.
assert.match(focDash, /onclick="quickAddFocSkuToInventory\(\\''\+esc\(v\.id\)\+'\\'\)">\+ ADD TO INVENTORY<\/button>/,
  'every SKU card on the cover wall must have a direct add-to-inventory button');
assert.match(focDash, /async function quickAddFocSkuToInventory\(skuId\)\{/, 'missing quickAddFocSkuToInventory');

const fnStart = focDash.indexOf('async function quickAddFocSkuToInventory(skuId){');
const fnEnd = focDash.indexOf('\n}', fnStart) + 2;
const fn = focDash.slice(fnStart, fnEnd);

assert.match(fn, /if\(!state\.cycle\)return;/, 'must no-op cleanly if no cycle is open');
assert.match(fn, /var qty=Math\.max\(0,parseInt\(qtyStr,10\)\|\|0\);/, 'must parse the entered quantity defensively');
assert.match(fn, /if\(!qty\)\{toast_dash\('Enter a quantity greater than 0'\);return;\}/, 'must reject a zero/blank quantity instead of silently creating nothing');
assert.match(fn, /api\('\/foc\/admin\/receive',\{method:'POST',headers:\{'Content-Type':'application\/json'\},body:JSON\.stringify\(\{storeId:getActiveStoreId\(\),cycleId:state\.cycle\.id,lines:\[\{skuId:skuId,receivedQty:qty\}\]\}\)\}\)/,
  'must reuse the existing /foc/admin/receive route with a single-SKU line, not a bespoke inventory-creation path -- that route already handles paid-customer reservation and short-ship reporting correctly');
assert.match(fn, /var flagged=\(d\.receivedSummary\|\|\[\]\)\.filter\(function\(s\)\{return s\.shortShipped>0\|\|s\.incentiveNotReceived;\}\);/,
  'must surface a short-ship/incentive-not-received mismatch the same way the bulk receive flow does');
assert.match(fn, /api\('\/foc\/ebay\/convert-to-instock',\{method:'POST',headers:\{'Content-Type':'application\/json'\},body:JSON\.stringify\(\{storeId:getActiveStoreId\(\),cycleId:state\.cycle\.id\}\)\}\)/,
  'must also sweep any still-live eBay presale listings to in-stock wording, same as the bulk receive flow');
assert.match(fn, /await openCycle\(state\.cycle\.id\);/, 'must refresh the wall after adding so the new inventory/counts are visible');
assert.match(fn, /catch\(e\)\{toast_dash\('Could not add to inventory: '\+e\.message\);\}/, 'a failure must surface a real error, not fail silently');

console.log('FOC quick-add-to-inventory contract checks passed');
