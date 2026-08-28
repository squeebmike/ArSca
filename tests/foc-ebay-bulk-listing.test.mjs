import fs from 'node:fs';
import assert from 'node:assert/strict';

const focDash = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');

// Store request: listing eligible FOC covers on eBay one at a time (open the
// review modal, edit, LIST, close, find the next one, repeat) was too much
// clicking for a whole cycle's worth of ratio/incentive books. Adds
// selection (checkboxes + SELECT ALL ELIGIBLE/SELECT NONE) and a bulk queue
// that reuses the SAME single-cover review-and-edit modal for every step --
// submitting one opens the next selected cover's review automatically
// instead of just closing, until the queue is empty.

// ── Selection state and controls ──
assert.match(focDash, /var focEbayBulkSelectedIds=new Set\(\);/, 'missing focEbayBulkSelectedIds selection state');
assert.match(focDash, /function focEbayBulkCheckboxChanged\(cb\)\{/, 'missing focEbayBulkCheckboxChanged');
assert.match(focDash, /function toggleFocEbayBulkSelectAll\(checked\)\{/, 'missing toggleFocEbayBulkSelectAll');
assert.match(focDash, /function renderFocEbayBulkCount\(\)\{/, 'missing renderFocEbayBulkCount');
assert.match(focDash, /onclick="toggleFocEbayBulkSelectAll\(true\)">SELECT ALL ELIGIBLE<\/button>/, 'toolbar must expose a SELECT ALL ELIGIBLE button');
assert.match(focDash, /onclick="toggleFocEbayBulkSelectAll\(false\)">SELECT NONE<\/button>/, 'toolbar must expose a SELECT NONE button');
assert.match(focDash, /onclick="startFocEbayBulkListing\(\)">LIST SELECTED ON EBAY<\/button>/, 'toolbar must expose a LIST SELECTED ON EBAY button');
assert.match(focDash, /id="foc-ebay-bulk-count"/, 'toolbar must show a live selected/eligible count');

// A checkbox must exist on every ELIGIBLE_NOW cover, tied to the sku id.
{
  const fnStart = focDash.indexOf('function ebaySection(v){');
  const fnEnd = focDash.indexOf('\n}', fnStart) + 2;
  const fn = focDash.slice(fnStart, fnEnd);
  assert.match(fn, /class="foc-ebay-bulk-cb" value="'\+esc\(v\.id\)\+'"/, 'the bulk-select checkbox must carry this cover\'s sku id');
  assert.match(fn, /onchange="focEbayBulkCheckboxChanged\(this\)"/, 'the checkbox must update the tracked selection, not just its own DOM state');
}

console.log('FOC eBay bulk listing selection contract checks passed');

// ── The queue itself ──
assert.match(focDash, /var focEbayBulkQueue=null;/, 'missing focEbayBulkQueue');
assert.match(focDash, /function startFocEbayBulkListing\(\)\{/, 'missing startFocEbayBulkListing');
assert.match(focDash, /function focEbayBulkAdvance\(\)\{/, 'missing focEbayBulkAdvance');
assert.match(focDash, /function cancelFocEbayBulkListing\(\)\{/, 'missing cancelFocEbayBulkListing');
assert.match(focDash, /function skipFocEbayBulkItem\(\)\{/, 'missing skipFocEbayBulkItem');
{
  const fnStart = focDash.indexOf('function startFocEbayBulkListing(){');
  const fnEnd = focDash.indexOf('\n}', fnStart) + 2;
  const fn = focDash.slice(fnStart, fnEnd);
  assert.match(fn, /if\(!ids\.length\)\{toast_dash\('Select at least one eligible cover first'\);return;\}/, 'must refuse to start an empty bulk run');
  assert.match(fn, /focEbayBulkAdvance\(\);/, 'must actually kick off the queue by opening the first review');
}
{
  const fnStart = focDash.indexOf('function focEbayBulkAdvance(){');
  const fnEnd = focDash.indexOf('\n}', fnStart) + 2;
  const fn = focDash.slice(fnStart, fnEnd);
  assert.match(fn, /var next=focEbayBulkQueue\.shift\(\);/, 'must dequeue the next sku, not re-review the same one forever');
  assert.match(fn, /openEbayPresaleReview\(next\);/, 'must open the SAME single-cover review modal for the next cover, not a separate bulk UI');
}

console.log('FOC eBay bulk listing queue contract checks passed');

// ── The review modal must actually chain, and let the operator bail out or
// skip without losing the rest of the batch ──
{
  const fnStart = focDash.indexOf('async function openEbayPresaleReview(skuId){');
  const fnEnd = focDash.indexOf('\n}', fnStart) + 2;
  const fn = focDash.slice(fnStart, fnEnd);
  assert.match(fn, /onclick="cancelFocEbayBulkListing\(\)"/, 'the × close button must go through cancelFocEbayBulkListing, which knows whether a bulk run is in progress');
  assert.match(fn, /onclick="skipFocEbayBulkItem\(\)"/, 'must offer a way to skip the current cover without listing it and without stopping the whole run');
}
{
  const fnStart = focDash.indexOf('function cancelFocEbayBulkListing(){');
  const fnEnd = focDash.indexOf('\n}', fnStart) + 2;
  const fn = focDash.slice(fnStart, fnEnd);
  assert.match(fn, /focEbayBulkQueue=null;/, 'canceling must actually stop the run, not just close this one modal');
  assert.doesNotMatch(fn, /focEbayBulkSelectedIds\.clear\(\)/, 'canceling must NOT clear the remaining selection -- those covers stay selected so LIST SELECTED ON EBAY can resume');
}
{
  const fnStart = focDash.indexOf('async function submitEbayPresaleReview(skuId){');
  const fnEnd = focDash.indexOf('\n}', fnStart) + 2;
  const fn = focDash.slice(fnStart, fnEnd);
  assert.match(fn, /if\(focEbayBulkQueue\)\{\s*\n\s*if\(focEbayBulkQueue\.length\)focEbayBulkAdvance\(\);/,
    'after a successful listing, a bulk run must open the next selected cover automatically instead of just closing');
  assert.match(fn, /else\{focEbayBulkQueue=null;toast_dash\('Bulk eBay listing complete'\);\}/,
    'the last cover in the queue must end the run with a clear completion message, not silently stop');
}

console.log('FOC eBay bulk listing chaining contract checks passed');

// ── openCycle must clear the bulk selection/queue on a genuine cycle
// switch (sku ids from a different cycle are meaningless here), but not on
// a same-cycle refresh -- this is covered end-to-end by
// foc-single-item-refresh-preserves-filters.test.mjs's assertion on the
// exact openCycle guard line, so only spot-check it's part of that guard. ──
assert.match(focDash, /focEbayBulkSelectedIds\.clear\(\);focEbayBulkQueue=null;\}/, 'switching to a different cycle must clear the bulk eBay selection/queue');

console.log('FOC eBay bulk listing cycle-switch cleanup contract check passed');
