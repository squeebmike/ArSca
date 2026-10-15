import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store report: "Comic Bundle x12" ($60) was a typed-in item -- the 12 books
// never left inventory and nothing knew which books sold. BUNDLE PRICE
// spreads one total across the real scanned books.
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const extractFn = name => { const s = dashboard.indexOf('function ' + name + '('); assert.ok(s >= 0, name); return dashboard.slice(s, dashboard.indexOf('\n}\n', s) + 2); };
const api = new Function(extractFn('cartBundlePrices') + extractFn('cartBundleLineIndexes') + 'return { cartBundlePrices, cartBundleLineIndexes };')();
const twelve = Array.from({ length:12 }, () => ({ price:5, category:'Comic', inventoryId:'x' }));
const p = api.cartBundlePrices(twelve, 60);
assert.equal(p.length, 12);
assert.ok(p.every(v => v === 5));
const mixed = api.cartBundlePrices([{ price:10 }, { price:5 }, { price:5 }], 27);
assert.deepEqual(mixed, [13.5, 6.75, 6.75], 'by each book\'s own price');
const odd = api.cartBundlePrices([{ price:5 }, { price:5 }, { price:5 }], 10);
assert.equal(Math.round(odd.reduce((a, b) => a + b, 0) * 100), 1000, 'adds up to the bundle total to the penny');
assert.deepEqual(api.cartBundlePrices([{ price:0 }, { price:0 }], 9), [4.5, 4.5], 'no prices: split evenly');
assert.deepEqual(api.cartBundlePrices([{ originalPrice:8, price:2 }, { price:8 }], 8), [4, 4], 'uses the original price, so re-bundling is stable');
assert.deepEqual(api.cartBundleLineIndexes([{ category:'Comic', inventoryId:'a' }, { category:'Pokemon', inventoryId:'b' }, { category:'Comic', inventoryId:'c' }, { name:'Comic Bundle x12', category:'Comic' }]), [0, 2], 'only the scanned comics; a typed-in item is left alone');
assert.deepEqual(api.cartBundleLineIndexes([{ category:'Pokemon', inventoryId:'a' }, { category:'Pokemon', inventoryId:'b' }]), [0, 1], 'no comics: any scanned items');
const fn = extractFn('bundleCartPrice');
assert.match(fn, /item\.adjustmentReason = reason;/);
assert.match(fn, /item\.bundleId = bundleId;/);
assert.match(fn, /if\(item\.unitPrice != null\) item\.unitPrice = Math\.round\(prices\[n\] \/ qty \* 100\) \/ 100;/);
const tools = dashboard.slice(dashboard.lastIndexOf('function renderDealerCartTools('));
assert.match(tools.slice(0, 9000), /onclick="bundleCartPrice\(\)">📦 BUNDLE PRICE<\/button>/, 'the button is in the cart tools that run (the last definition)');
console.log('Cart bundle price checks passed');
