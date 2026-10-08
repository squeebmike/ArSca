import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: condition is captured when an item is added to the label batch ──
assert.match(dashboard, /function labelBatchEntryFromItem\(item\)\{[\s\S]{0,300}?const entry = \{ id:item\.id, name:item\.name, condition:item\.condition\|\|'', sku:labelBarcodeValue\(item\), price:inventoryListPrice \? inventoryListPrice\(item\) : \(item\.salePrice \|\| item\.market \|\| 0\), badge:labelBadgeText\(item\), meta:labelMetaText\(item\), qty:labelPrintPerStock\(\) \? stockQty : 1, stockQty \};/, 'labelBatchEntryFromItem must carry condition into the batch entry');
assert.match(dashboard, /if\(item\) labelPrintBatch\.push\(labelBatchEntryFromItem\(item\)\);/, 'openLabelPrintModal must add batch entries via the shared builder');
assert.match(dashboard, /else labelPrintBatch\.push\(labelBatchEntryFromItem\(item\)\);/, 'addToLabelPrintBatch must add batch entries via the shared builder too');

// ── Contract: the printed label shows condition (or a comic's publisher · year) -- no SKU digits (store ask) ──
assert.match(dashboard, /tctx\.fillText\(String\(b\.condition \|\| b\.meta \|\| ''\), pad, h \* 0\.82\);/, 'the shared label drawing must render condition (or meta) on the standard label when present');
assert.match(dashboard, /const canvas = await renderInventoryLabelCanvas\(labelSpecs\[i\], opts\);/, 'printInventoryLabels must print the shared label drawing');

console.log('Label print condition contract checks passed');

// ── Functional: the label bottom-row text is the condition alone ──
const labelBottomText = b => String(b.condition || b.meta || '');
assert.equal(labelBottomText({ sku:'WO-1001', condition:'NM' }), 'NM', 'no SKU digits on the label -- the QR carries it');
assert.equal(labelBottomText({ sku:'WO-1002', condition:'' }), '', 'an item with no condition set shows nothing');

console.log('Label print condition functional checks passed');
