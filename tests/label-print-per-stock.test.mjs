import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Store ask: 10 copies of the same comic in stock = 10 labels.
const d = fs.readFileSync('dashboard.html', 'utf8');
const grab = re => { const m = d.match(re); assert.ok(m, 'missing ' + re); return m[0]; };
const src = [
  grab(/function inventoryAvailableQuantity\(item\)\{[\s\S]*?\n\}/),
  grab(/function labelBatchEntryFromItem\(item\)\{[\s\S]*?\n\}/),
  grab(/function labelPrintPerStock\(\)\{[^\n]*\n/),
  grab(/function setLabelPrintPerStock\(on\)\{[\s\S]*?\n\}/),
  grab(/function addToLabelPrintBatch\(itemId\)\{[\s\S]*?\n\}/),
].join('\n');
const store = new Map();
const ctx = {
  Number, Math, String,
  localStorage:{ getItem:k => store.get(k) ?? null, setItem:(k, v) => store.set(k, String(v)) },
  labelBarcodeValue:i => i.id, inventoryListPrice:i => i.salePrice, labelBadgeText:() => '', labelMetaText:() => '',
  isComicLabelItem:() => false, renderLabelPrintBatchList:() => {},
  all:[{ id:'c1', name:'Spider-Woman #1', salePrice:5, qty:10 }, { id:'c2', name:'One-off', salePrice:9, quantity:1 }, { id:'c3', name:'Zero', salePrice:9, qty:0 }],
};
vm.createContext(ctx);
vm.runInContext('var labelPrintBatch = [];' + src + ';this.batch=()=>labelPrintBatch;this.addToLabelPrintBatch=addToLabelPrintBatch;this.setLabelPrintPerStock=setLabelPrintPerStock;this.entry=labelBatchEntryFromItem;', ctx);

// On by default: a stack of 10 prints 10.
assert.equal(ctx.entry(ctx.all[0]).qty, 10);
assert.equal(ctx.entry(ctx.all[0]).stockQty, 10);
assert.equal(ctx.entry(ctx.all[1]).qty, 1);
assert.equal(ctx.entry(ctx.all[2]).qty, 1, 'never zero labels');
ctx.addToLabelPrintBatch('c1'); ctx.addToLabelPrintBatch('c2');
assert.deepEqual([...ctx.batch().map(b => b.qty)], [10, 1]);
// Off: one label each, and it's remembered.
ctx.setLabelPrintPerStock(false);
assert.deepEqual([...ctx.batch().map(b => b.qty)], [1, 1]);
assert.equal(ctx.entry(ctx.all[0]).qty, 1);
ctx.setLabelPrintPerStock(true);
assert.deepEqual([...ctx.batch().map(b => b.qty)], [10, 1]);

// The modal has the switch; LABEL THIS VIEW uses the same builder (so it
// gets stock counts and comic details too).
assert.match(d, /id="label-print-per-stock" onchange="setLabelPrintPerStock\(this\.checked\)"/);
assert.match(d, /const batch = items\.map\(item => labelBatchEntryFromItem\(item\)\);/);
console.log('Label per-stock-copy checks passed');
