import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store decision: new inventory used to default to onlineListed:false (a
// deliberate review gate added earlier this session), requiring a manual
// "Publish to Storefront" click before a genuinely in-stock item showed on
// themanapocket.com. That gate caused more real friction than it
// prevented -- repeated store reports of items that were in stock and
// never showing up, with the operator not realizing a manual publish step
// was needed at all. Reversed: new items now default to listed
// immediately. Also adds forcePublishToStorefront -- an unconditional
// write (never reads/branches on this device's possibly-stale cached
// onlineListed value) for the specific failure mode found alongside this
// report: the normal toggle and bulk "Publish This View" both compute
// their action off the LOCAL cached value, so a stale local cache (e.g. a
// queued edit that never actually landed) can make an item look already
// published on this device while the real Supabase row still says
// onlineListed:false, with no button left that would actually fix it.

const createStart = dashboard.indexOf('async function createBuiltInInventoryItem(');
const createEnd = dashboard.indexOf('\n}', createStart) + 2;
const createFn = dashboard.slice(createStart, createEnd);
assert.ok(createStart !== -1, 'createBuiltInInventoryItem must exist');
assert.match(createFn, /onlineListed:\(item\?\.onlineListed \?\? updates\?\.onlineListed \?\? true\),/,
  'a freshly created item must default onlineListed to true -- reversed from the original review-gate default');

assert.match(dashboard, /async function forcePublishToStorefront\(id\)\{/, 'missing forcePublishToStorefront');
{
  const fnStart = dashboard.indexOf('async function forcePublishToStorefront(id){');
  const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
  const fn = dashboard.slice(fnStart, fnEnd);
  assert.match(fn, /await saveInventoryEdit\(item, \{ onlineListed: true \}\);/, 'must write onlineListed:true directly, not read/toggle off the current cached value');
  assert.doesNotMatch(fn, /item\.onlineListed === false/, 'must NOT branch on the item\'s current cached onlineListed value -- that\'s exactly the stale-read bug this function exists to sidestep');
}

assert.match(dashboard, /\(isInStock && item\?\.onlineListed !== false\)\?`<button class="hbtn" style="\$\{btnStyle\};color:var\(--blue\)" onclick="forcePublishToStorefront\('\$\{id\}'\);closeInvRowMenu\(\)"/,
  'the row menu must offer Force Publish specifically when the local cache claims the item is already published -- that\'s the scenario where the normal toggle has no "publish" direction left to offer');

const checkStart = dashboard.indexOf('async function checkStorefrontStatus(id){');
const checkEnd = dashboard.indexOf('\n}', checkStart) + 2;
const checkFn = dashboard.slice(checkStart, checkEnd);
assert.ok(checkStart !== -1, 'checkStorefrontStatus must exist');
assert.match(checkFn, /if\(onlyReasonIsUnpublished && confirm\('Publish this item to the storefront now\?'\)\) await forcePublishToStorefront\(id\);/,
  'when the live check confirms publishing is the ONLY blocker, the diagnostic must offer to fix it inline via the unconditional write, not just describe what to do');

console.log('Storefront default-published + force-publish contract checks passed');

// ── Functional: the "only reason is unpublished" gating logic ──
function onlyReasonIsUnpublished(d, STOREFRONT_EXCLUDED_STATUS_REASONS) {
  const reasons = [];
  if (!(Number(d.quantity) > 0)) reasons.push('quantity');
  if (d.onlineListed === false) reasons.push('onlineListed');
  if (d.soldAt) reasons.push('soldAt');
  if (d.archivedAt) reasons.push('archivedAt');
  if (STOREFRONT_EXCLUDED_STATUS_REASONS[d.inventoryStatus]) reasons.push('status');
  return reasons.length === 1 && d.onlineListed === false;
}
const EXCLUDED = { sold:1, archived:1, hold:1 };

{
  const d = { quantity: 3, onlineListed: false, soldAt: '', archivedAt: '', inventoryStatus: 'in_stock' };
  assert.equal(onlyReasonIsUnpublished(d, EXCLUDED), true, 'must offer the inline fix when unpublished is the sole blocker');
}
{
  const d = { quantity: 0, onlineListed: false, soldAt: '', archivedAt: '', inventoryStatus: 'in_stock' };
  assert.equal(onlyReasonIsUnpublished(d, EXCLUDED), false, 'must NOT offer the inline fix if quantity is also a problem -- publishing alone wouldn\'t actually fix it');
}
{
  const d = { quantity: 3, onlineListed: true, soldAt: '', archivedAt: '', inventoryStatus: 'hold' };
  assert.equal(onlyReasonIsUnpublished(d, EXCLUDED), false, 'must NOT offer the inline fix when the real blocker is something publishing can\'t solve (e.g. On Hold)');
}

console.log('Storefront default-published + force-publish functional checks passed');
