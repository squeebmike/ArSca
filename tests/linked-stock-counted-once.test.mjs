import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Store report: Sales Analytics said INVENTORY VALUE $30,168 while the
// Inventory tab said SELL VALUE $25,713. The gap ($4,455) was the Dougvana
// poster: one stock of 99 posters listed three ways (plain $15, Standard
// Remarque $25, Deluxe Remarque $35). Analytics counted all three
// (99 x $75 = $7,425); the Inventory tab counted the plain poster twice
// ($2,970), because the remarques only link back to the plain one.
// Both now count it once at the cheapest option: $1,485.
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
const fn = name => { const s = app.indexOf('function ' + name + '('); assert.ok(s >= 0, name); return app.slice(s, app.indexOf('\n}\n', s) + 2); };
const ctx = {};
vm.runInNewContext(['function inventoryListPrice(i){ return i.price; }', fn('dedupeLinkedInventoryItems'), 'this.dedupe = dedupeLinkedInventoryItems;'].join('\n'), ctx);
const value = items => ctx.dedupe(items).reduce((a, i) => a + i.price * i.qty, 0);
const plain = { id: 'plain', price: 15, qty: 99, linkedStockIds: ['standard', 'deluxe'] };
const deluxe = { id: 'deluxe', price: 35, qty: 99, linkedStockIds: ['plain'] };
const standard = { id: 'standard', price: 25, qty: 99, linkedStockIds: ['plain'] };
const card = { id: 'card', price: 10, qty: 1 };
// Every order the items can come in -- the bug depended on it.
for (const order of [[plain, deluxe, standard], [deluxe, standard, plain], [deluxe, plain, standard], [standard, deluxe, plain]]) {
  assert.equal(value([...order, card]), 1485 + 10, order.map(i => i.id).join(',') + ': the posters once, at the cheapest option');
  assert.deepEqual(Array.from(ctx.dedupe([...order, card]), i => i.id).sort(), ['card', 'plain']);
}
// A chain counts once too; a link to an item that isn't in the list is ignored.
assert.equal(ctx.dedupe([{ id: 'a', price: 3, linkedStockIds: ['b'] }, { id: 'b', price: 2, linkedStockIds: ['c'] }, { id: 'c', price: 4, linkedStockIds: ['gone'] }]).length, 1);
assert.equal(ctx.dedupe([{ id: 'a', price: 3, linkedStockIds: ['a'] }, { id: 'b', price: 2 }]).length, 2, 'a self-link is harmless');

// Sales Analytics (and the aging buckets) count linked stock once too.
assert.match(fn('ownerAnalyticsData'), /const invForValue = dedupeLinkedInventoryItems\(inv\);\n\s*const value = invForValue\.reduce/);
assert.match(fn('ownerAnalyticsData'), /const cost = invForValue\.reduce/);
assert.match(fn('inventoryAgingBuckets'), /dedupeLinkedInventoryItems\(\(items \|\| \[\]\)\.filter/);
console.log('Linked stock counted once checks passed');
