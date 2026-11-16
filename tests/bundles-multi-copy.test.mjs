// BUNDLES WITH MORE THAN ONE COPY (store, 2026-11-16: bundles only took items with a quantity of 1). The copies that go
// in are split off into their own one-copy rows; the row keeps the rest.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
const grab = sig => { const i = app.indexOf(sig); assert.ok(i >= 0, sig); let d = 0, j = app.indexOf('){', i) + 1; for (; j < app.length; j++) { if (app[j] === '{') d++; else if (app[j] === '}' && !--d) break; } return app.slice(i, j + 1); };
const src = ['inventoryAvailableQuantity', 'bundleDraftCopiesOf', 'bundleDraftTotalCopies', 'splitInventoryCopies'].map(n => grab((n === 'splitInventoryCopies' ? 'async ' : '') + 'function ' + n + '(')).join('\n');
const created = [], updated = [], all = [];
const env = new Function('all', 'bundleDraftCopies', 'createBuiltInInventoryItem', 'updateBuiltInInventoryItem', 'mapBuiltInItem', 'logOpsEvent', src + '\nreturn { bundleDraftCopiesOf, bundleDraftTotalCopies, splitInventoryCopies };')(
  all, new Map([['hb', 2]]),
  async (_, data) => { created.push(data); return 'new_' + created.length; },
  async (item, u) => { updated.push([item.id, u]); },
  row => ({ id: row.id, ...row.data, raw: row.data }), () => {});
const hillbilly = { id: 'hb', name: 'Hillbilly #1', category: 'Comic', set: 'Albatross', cost: 2, qty: 5, raw: { id: 'hb', name: 'Hillbilly #1', cost: 2, qty: 5, ebayListingId: 'E1', coverImage: 'x.jpg' } };
const single = { id: 's', name: 'Hillbilly #2', qty: 1, raw: {} };
assert.equal(env.bundleDraftCopiesOf(hillbilly), 2); assert.equal(env.bundleDraftCopiesOf(single), 1);
assert.equal(env.bundleDraftTotalCopies([hillbilly, single]), 3, 'two copies of #1 and one #2');
const made = await env.splitInventoryCopies(hillbilly, 2);
assert.equal(made.length, 2); assert.equal(created.length, 2);
for (const c of created) { assert.equal(c.qty, 1); assert.equal(c.cost, 2, 'same cost each'); assert.equal(c.splitFromId, 'hb'); assert.equal(c.coverImage, 'x.jpg'); assert.equal(c.ebayListingId, undefined, "the original's eBay listing stays with it"); }
assert.deepEqual(updated, [['hb', { qty: 3, quantity: 3, 'inventory-count': 3 }]], 'the row keeps the other 3');
assert.equal(hillbilly.qty, 3); assert.equal(all.length, 2, 'new rows show in the list right away');
assert.ok(app.includes('const draftCopies = bundleDraftTotalCopies('), 'BUILD BUNDLE counts copies');
assert.ok(app.includes("COPIES <input type=\"number\" min=\"1\" max=\"${have}\""), 'pick how many copies');
console.log('Multi-copy bundles: passed');
