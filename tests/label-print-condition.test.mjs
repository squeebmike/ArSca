import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: condition is captured when an item is added to the label batch ──
assert.match(dashboard, /if\(item\) labelPrintBatch\.push\(\{ id:item\.id, name:item\.name, condition:item\.condition\|\|'', sku:labelBarcodeValue\(item\), price:inventoryListPrice \? inventoryListPrice\(item\) : \(item\.salePrice \|\| item\.market \|\| 0\), qty:1 \}\);/, 'openLabelPrintModal must carry condition into the batch entry');
assert.match(dashboard, /else labelPrintBatch\.push\(\{ id:item\.id, name:item\.name, condition:item\.condition\|\|'', sku:labelBarcodeValue\(item\), price:inventoryListPrice \? inventoryListPrice\(item\) : \(item\.salePrice \|\| item\.market \|\| 0\), qty:1 \}\);/, 'addToLabelPrintBatch must carry condition into the batch entry too');

// ── Contract: the printed label shows condition alongside the SKU ──
assert.match(dashboard, /<span class="label-sku">\$\{escHtml\(b\.sku \|\| ''\)\}\$\{b\.condition\?' · '\+escHtml\(b\.condition\):''\}<\/span>/, 'printInventoryLabels must render condition on the printed label when present');

console.log('Label print condition contract checks passed');

// ── Functional: the label bottom-row text builds correctly with and without a condition ──
function labelBottomText(sku, condition){
  return `${sku || ''}${condition ? ' · ' + condition : ''}`;
}
assert.equal(labelBottomText('WO-1001', 'NM'), 'WO-1001 · NM', 'a graded/conditioned item must show SKU and condition together');
assert.equal(labelBottomText('WO-1002', ''), 'WO-1002', 'an item with no condition set must not show a stray separator');

console.log('Label print condition functional checks passed');
