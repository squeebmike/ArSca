import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: all three search boxes call a debounced wrapper, not the
// expensive render function directly on every keystroke ──
assert.match(dashboard, /const filterSoldDebounced = debounce\(filterSold, 200\);/, 'Sold Items search must be debounced');
assert.match(dashboard, /oninput="filterSoldDebounced\(\)"/, 'the Sold Items search input must use the debounced wrapper');

assert.match(dashboard, /const renderCustomerInventoryBrowserDebounced = debounce\(renderCustomerInventoryBrowser, 200\);/, 'Customer Browse search must be debounced');
assert.match(dashboard, /oninput="renderCustomerInventoryBrowserDebounced\(\)"/, 'the Customer Browse search input must use the debounced wrapper');

assert.match(dashboard, /const renderEbayBulkListDebounced = debounce\(renderEbayBulkList, 200\);/, 'eBay Bulk Listing search must be debounced');
assert.match(dashboard, /oninput="renderEbayBulkListDebounced\(\)"/, 'the eBay Bulk Listing search input must use the debounced wrapper');

console.log('Debounce wiring contract checks passed');

// ── Contract: non-typing callers (buttons, mode switches, dropdown filters)
// still call the immediate version directly -- only the keystroke source
// should be debounced, everything else should feel instant ──
assert.match(dashboard, /function enterCustomerBrowseMode\(\)\{document\.body\.classList\.add\('customer-browse-mode'\);switchTab\('browse'\);renderCustomerInventoryBrowser\(\);\}/, 'entering customer browse mode must render immediately, not wait out a debounce delay');
assert.match(dashboard, /<button class="hbtn" onclick="renderEbayBulkList\(\)">LOAD LISTABLE ITEMS<\/button>/, 'the LOAD LISTABLE ITEMS button must call the immediate render, not the debounced one');
assert.match(dashboard, /onchange="renderCustomerInventoryBrowser\(\)"/, 'the category/sort dropdowns must stay on the immediate render -- change is already a discrete, infrequent event');

console.log('Immediate-caller contract checks passed');

// ── Contract: eBay Bulk Listing also got a render cap (previously fully
// unbounded, unlike Sold Items (100) and Customer Browse (500)) ──
assert.match(dashboard, /const EBAY_BULK_LIST_RENDER_CAP = 300;/, 'eBay Bulk Listing must define a render cap');
assert.match(dashboard, /const shown = filtered\.slice\(0, EBAY_BULK_LIST_RENDER_CAP\);/, 'eBay Bulk Listing must slice to the cap before building DOM nodes');
assert.match(dashboard, /\+ \$\{overflow\} more match -- refine your search to see them/, 'items past the cap must be acknowledged with an overflow notice, not silently dropped with no explanation');

console.log('eBay Bulk Listing render cap contract checks passed');

// ── Functional: debounce collapses rapid calls (a fast typist) into one ──
function debounce(fn, waitMs){
  let timer = null;
  return function(...args){ clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), waitMs); };
}
let calls = 0;
const debounced = debounce(() => { calls++; }, 20);
debounced(); debounced(); debounced(); debounced();
assert.equal(calls, 0, 'debounce must not fire synchronously on any of the rapid calls');
await new Promise(resolve => setTimeout(resolve, 40));
assert.equal(calls, 1, 'four rapid keystrokes must collapse into exactly one expensive render, not four');

console.log('Debounce functional checks passed');

// ── Functional: reimplement the eBay Bulk List cap/overflow slicing logic ──
function capAndOverflow(filtered, cap){
  const shown = filtered.slice(0, cap);
  const overflow = filtered.length - shown.length;
  return { shown, overflow };
}
const under = capAndOverflow(Array.from({ length: 50 }, (_, i) => i), 300);
assert.equal(under.shown.length, 50);
assert.equal(under.overflow, 0, 'a store with fewer listable items than the cap must show all of them with no overflow notice');

const over = capAndOverflow(Array.from({ length: 1200 }, (_, i) => i), 300);
assert.equal(over.shown.length, 300, 'a store with far more listable items than the cap must still only render the cap');
assert.equal(over.overflow, 900, 'the overflow count must reflect exactly how many items were left out, for the notice text');

console.log('eBay Bulk Listing cap functional checks passed');
