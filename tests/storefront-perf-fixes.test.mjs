import fs from 'node:fs';
import assert from 'node:assert/strict';

const storefront = fs.readFileSync('storefront.html', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// ── Contract: the storefront search box is debounced, dropdowns stay instant ──
assert.match(storefront, /function debounce\(fn, waitMs\)\{/, 'storefront.html must define a debounce helper');
assert.match(storefront, /const renderDebounced = debounce\(render, 200\);/, 'render() must be wrapped in a debounced call');
assert.match(storefront, /document\.querySelectorAll\('\.controls input'\)\.forEach\(el=>el\.addEventListener\('input', renderDebounced\)\);/, 'the search input must use the debounced render, not render() directly');
assert.match(storefront, /document\.querySelectorAll\('\.controls select'\)\.forEach\(el=>el\.addEventListener\('change', render\)\);/, 'dropdown filters must stay on immediate render() -- change is already a discrete, infrequent event');

console.log('Storefront search debounce contract checks passed');

// ── Contract: storefront checkout batches item lookups instead of one
// sequential awaited fetch per cart line ──
const checkoutRouteSrc = worker.slice(worker.indexOf('const requestedItems = Array.isArray(body.items)'), worker.indexOf('if (subtotalCents < 50)'));
assert.match(checkoutRouteSrc, /const requestedIds = requestedItems\.map\(req => String\(req\.itemId \|\| ''\)\.trim\(\)\);/, 'item ids must be collected up front for a batched lookup');
assert.match(checkoutRouteSrc, /id=in\.\(\$\{requestedIds\.map\(id => encodeURIComponent\(id\)\)\.join\(','\)\}\)/, 'the checkout route must fetch every requested item in a single id=in.(...) query');
assert.match(checkoutRouteSrc, /const rowById = new Map\(\(fetchedRows \|\| \[\]\)\.map\(row => \[row\.id, row\]\)\);/, 'fetched rows must be indexed by id for O(1) lookup in the per-item loop');
assert.match(checkoutRouteSrc, /const row = rowById\.get\(itemId\);/, 'the per-item validation loop must read from the batched map, not fetch again');
assert.doesNotMatch(checkoutRouteSrc, /await supabaseAdminFetch\(env, `inventory_items\?id=eq\.\$\{encodeURIComponent\(itemId\)\}/, 'the old per-item sequential fetch inside the loop must be gone');

console.log('Storefront checkout batching contract checks passed');

// ── Functional: debounce collapses rapid calls into one trailing call ──
function debounce(fn, waitMs){
  let timer = null;
  return function(...args){ clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), waitMs); };
}
let calls = 0;
const debounced = debounce(() => { calls++; }, 20);
debounced(); debounced(); debounced();
assert.equal(calls, 0, 'debounce must not fire synchronously');
await new Promise(resolve => setTimeout(resolve, 40));
assert.equal(calls, 1, 'three rapid calls (a fast typist) must collapse into exactly one render, not three full catalog rebuilds');

console.log('Debounce functional checks passed');

// ── Functional: reimplement the batched-lookup validation loop and verify
// error precedence is unchanged -- the FIRST invalid item in the original
// cart order must still be the one reported, exactly as the sequential
// per-item version behaved, even though lookups now happen in one batch.
function validateCartAgainstBatch(requestedItems, rowById){
  for (const req of requestedItems) {
    const itemId = String(req.itemId || '').trim();
    const row = rowById.get(itemId);
    if (!row) return { ok:false, error:'An item in your cart is no longer available', itemId };
    if (row.status !== 'in_stock') return { ok:false, error:`"${row.name}" in your cart just sold out`, itemId };
  }
  return { ok:true };
}

const rowById = new Map([
  ['a', { id:'a', name:'Card A', status:'in_stock' }],
  ['b', { id:'b', name:'Card B', status:'sold' }],
  // 'c' intentionally missing -- simulates a deleted/never-existed item
]);

const soldOutFirst = validateCartAgainstBatch([{ itemId:'a' }, { itemId:'b' }], rowById);
assert.equal(soldOutFirst.ok, false);
assert.equal(soldOutFirst.itemId, 'b', 'the second cart line (sold out) must be the one reported when the first line is fine');

const missingItemFirst = validateCartAgainstBatch([{ itemId:'c' }, { itemId:'a' }], rowById);
assert.equal(missingItemFirst.ok, false);
assert.equal(missingItemFirst.itemId, 'c', 'a missing/deleted item earlier in cart order must still be reported before a later valid or sold-out one');

const allGood = validateCartAgainstBatch([{ itemId:'a' }], rowById);
assert.equal(allGood.ok, true, 'a fully valid cart must still pass');

console.log('Batched checkout validation-order functional checks passed');
