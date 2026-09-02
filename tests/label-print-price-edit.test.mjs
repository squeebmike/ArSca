import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store report: after buying a lot and before printing labels, there was no
// way to fix a wrong retail price -- renderLabelPrintBatchList rendered
// price as a read-only <span>, only qty had an editable <input>. A fix that
// only updated the in-memory label-batch entry (so the printed label showed
// a "new" price) without also persisting it to the real inventory record
// would be worse than the original gap: the label and the actual checkout
// price would silently diverge. The correct fix writes through
// saveInventoryEdit, the same universal update path the rest of the app
// uses for inventory edits, so the label, the inventory record, and every
// other device converge on the same price.

const batchListStart = dashboard.indexOf('function renderLabelPrintBatchList(){');
const batchListEnd = dashboard.indexOf('\n\n// Batch size before yielding', batchListStart);
const batchListBody = dashboard.slice(batchListStart, batchListEnd);
assert.ok(batchListStart !== -1, 'renderLabelPrintBatchList must exist');
assert.doesNotMatch(batchListBody, /<span[^>]*>\$\{fd\$\(b\.price\)\}<\/span>/,
  'price must no longer be rendered as a read-only span -- that was the whole gap');
assert.match(batchListBody, /<input type="number" min="0" step="0\.01" value="\$\{b\.price\}"[^>]*onchange="setLabelPrintPrice\('\$\{b\.id\}', this\.value\)">/,
  'price must be an editable input wired to setLabelPrintPrice, mirroring the existing qty input pattern');

const setPriceStart = dashboard.indexOf('async function setLabelPrintPrice(itemId, rawVal){');
const setPriceEnd = dashboard.indexOf('\n\nfunction renderLabelPrintBatchList(){', setPriceStart);
const setPriceBody = dashboard.slice(setPriceStart, setPriceEnd);
assert.ok(setPriceStart !== -1, 'setLabelPrintPrice must exist');
assert.match(setPriceBody, /entry\.price = val;/, 'the in-memory batch entry price must update so the printed label reflects the new value');
assert.match(setPriceBody, /await saveInventoryEdit\(item, \{ listPrice:val, salePrice:val, displayPrice:val \}\);/,
  'the price change must be persisted to the real inventory record via the universal update path, or the label would lie about the actual checkout price');
assert.match(setPriceBody, /entry\.price = prevPrice;/, 'a failed save must roll the label entry back rather than leave it showing an unsaved price');

console.log('Label print price-edit contract checks passed');

// ── Functional: the update/rollback logic itself, independent of DOM ──
function makeSetLabelPrintPrice(labelPrintBatch, inventoryById, saveInventoryEdit) {
  return async function setLabelPrintPrice(itemId, rawVal) {
    const entry = labelPrintBatch.find(b => b.id === itemId);
    if (!entry) return;
    const val = parseFloat(rawVal);
    if (isNaN(val) || val < 0) return;
    const prevPrice = entry.price;
    entry.price = val;
    const item = inventoryById.get(itemId);
    if (!item) return;
    try {
      await saveInventoryEdit(item, { listPrice: val, salePrice: val, displayPrice: val });
      item.listPrice = val; item.salePrice = val; item.displayPrice = val;
    } catch (e) {
      entry.price = prevPrice;
      throw e;
    }
  };
}

{
  // A successful edit must update both the printed-label entry and the
  // real inventory record together -- that's the whole point of the fix.
  const batch = [{ id: 'x', name: 'Amazing Spider-Man #1', price: 10, qty: 1 }];
  const item = { id: 'x', listPrice: 10, salePrice: 10, displayPrice: 10 };
  const inventoryById = new Map([['x', item]]);
  const fn = makeSetLabelPrintPrice(batch, inventoryById, async (i, updates) => Object.assign({}, updates));
  await fn('x', '15.50');
  assert.equal(batch[0].price, 15.5, 'label entry price must reflect the new value');
  assert.equal(item.listPrice, 15.5, 'the real inventory record must be updated too');
  assert.equal(item.salePrice, 15.5);
  assert.equal(item.displayPrice, 15.5);
}

{
  // If the persist fails (e.g. offline write error), the label must not be
  // left silently showing a price that was never actually saved.
  const batch = [{ id: 'x', name: 'Batman #1', price: 8, qty: 1 }];
  const item = { id: 'x', listPrice: 8, salePrice: 8, displayPrice: 8 };
  const inventoryById = new Map([['x', item]]);
  const fn = makeSetLabelPrintPrice(batch, inventoryById, async () => { throw new Error('offline'); });
  await assert.rejects(() => fn('x', '20'));
  assert.equal(batch[0].price, 8, 'label entry must roll back to the last known-saved price on a failed write');
  assert.equal(item.listPrice, 8, 'inventory record must be untouched by a failed write');
}

{
  // Garbage input (empty, negative, NaN) must not corrupt the batch entry.
  const batch = [{ id: 'x', name: 'Superman #1', price: 5, qty: 1 }];
  const item = { id: 'x', listPrice: 5, salePrice: 5, displayPrice: 5 };
  const inventoryById = new Map([['x', item]]);
  const fn = makeSetLabelPrintPrice(batch, inventoryById, async () => {});
  await fn('x', '');
  assert.equal(batch[0].price, 5, 'empty input must not change the price');
  await fn('x', '-3');
  assert.equal(batch[0].price, 5, 'a negative price must not be accepted');
}

console.log('Label print price-edit functional checks passed');
