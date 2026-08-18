import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Barcode library + entry points ──────────────────────────────────
assert.match(dashboard, /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/jsbarcode@3\.11\.6\/dist\/JsBarcode\.all\.min\.js" defer><\/script>/, 'missing the JsBarcode CDN script');
assert.match(dashboard, /id="label-print-modal"/, 'missing the label print batch modal');
assert.match(dashboard, /onclick="openLabelPrintModal\(\)" title="Build a batch of barcode\/price labels to print"/, 'missing the inventory toolbar PRINT LABELS button');
assert.match(dashboard, /onclick="openLabelPrintModal\('\$\{id\}'\);this\.closest\('\.inv-row-menu'\)\.remove\(\)">🏷️ Print Label<\/button>/, 'missing the per-row quick Print Label action');

console.log('Label printing entry-point checks passed');

// ── Core functions exist ────────────────────────────────────────────
for (const fn of ['labelBarcodeValue', 'openLabelPrintModal', 'closeLabelPrintModal', 'renderLabelPrintSearchResults',
  'addToLabelPrintBatch', 'removeFromLabelPrintBatch', 'setLabelPrintQty', 'renderLabelPrintBatchList', 'printInventoryLabels']) {
  assert.match(dashboard, new RegExp(`function ${fn}\\(`), `missing ${fn}`);
}

// Labels must actually render a scannable code via generateLabelCodeCanvas (CODE128 barcode or QR), not just text.
assert.match(dashboard, /const canvas = await generateLabelCodeCanvas\(b\.sku \|\| b\.id, codeStyle\);/, 'printed labels must render a real scan code via generateLabelCodeCanvas');
assert.match(dashboard, /JsBarcode\(canvas, value, \{ format:'CODE128', displayValue:false, margin:0 \}\);/, 'generateLabelCodeCanvas must fall back to a real CODE128 barcode');
assert.match(dashboard, /if\(typeof JsBarcode === 'undefined'\) return alert/, 'printing must fail gracefully if the barcode library has not finished loading yet, not silently produce blank barcodes');

console.log('Label printing core function checks passed');

// ── Functional check: labelBarcodeValue precedence ──────────────────
{
  const src = dashboard.match(/function labelBarcodeValue\(item\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(src, 'could not extract labelBarcodeValue for functional testing');
  const { labelBarcodeValue } = new Function(`${src}\nreturn { labelBarcodeValue };`)();

  assert.equal(labelBarcodeValue({ upc:'012345678905', inventorySku:'SKU1', id:'x1' }), '012345678905', 'UPC must take precedence when present');
  assert.equal(labelBarcodeValue({ inventorySku:'SKU1', id:'x1' }), 'SKU1', 'SKU must be used when there is no UPC');
  assert.equal(labelBarcodeValue({ id:'x1' }), 'x1', 'the internal id must be the last-resort barcode value');
}

console.log('labelBarcodeValue functional checks passed');

// ── Functional check: batch add/remove/qty logic ────────────────────
{
  const barcodeSrc = dashboard.match(/function labelBarcodeValue\(item\)\{[\s\S]*?\n\}/)?.[0];
  const addSrc = dashboard.match(/function addToLabelPrintBatch\(itemId\)\{[\s\S]*?\n\}/)?.[0];
  const removeSrc = dashboard.match(/function removeFromLabelPrintBatch\(itemId\)\{[\s\S]*?\n\}/)?.[0];
  const qtySrc = dashboard.match(/function setLabelPrintQty\(itemId, qty\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(barcodeSrc && addSrc && removeSrc && qtySrc, 'could not extract batch functions for functional testing');

  const noop = () => {};
  const document = { getElementById: () => null };
  const all = [
    { id:'i1', name:'Charizard VMAX', status:'in_stock', salePrice:50, market:45, upc:'', inventorySku:'SKU1' },
    { id:'i2', name:'Pikachu VMAX', status:'in_stock', salePrice:20, market:18, upc:'', inventorySku:'SKU2' },
  ];
  const inventoryListPrice = (item) => item.salePrice || item.market || 0;
  const fd$ = (n) => '$' + Number(n || 0).toFixed(2);
  const escHtml = (s) => String(s == null ? '' : s);
  const renderLabelPrintBatchList = noop;

  const { addToLabelPrintBatch, removeFromLabelPrintBatch, setLabelPrintQty, getBatch } = new Function(
    'document', 'all', 'inventoryListPrice', 'fd$', 'escHtml', 'renderLabelPrintBatchList',
    `let labelPrintBatch = [];
     ${barcodeSrc}
     ${addSrc}
     ${removeSrc}
     ${qtySrc}
     return { addToLabelPrintBatch, removeFromLabelPrintBatch, setLabelPrintQty, getBatch: () => labelPrintBatch };`
  )(document, all, inventoryListPrice, fd$, escHtml, renderLabelPrintBatchList);

  addToLabelPrintBatch('i1');
  assert.equal(getBatch().length, 1, 'adding a new item must add one batch entry');
  assert.equal(getBatch()[0].qty, 1, 'a newly added item must start at qty 1');

  addToLabelPrintBatch('i1');
  assert.equal(getBatch().length, 1, 'adding the same item twice must not create a duplicate entry');
  assert.equal(getBatch()[0].qty, 2, 'adding the same item twice must increment its qty instead');

  addToLabelPrintBatch('i2');
  assert.equal(getBatch().length, 2, 'adding a different item must add a second entry');

  setLabelPrintQty('i2', '5');
  assert.equal(getBatch().find(b => b.id === 'i2').qty, 5, 'setLabelPrintQty must update the given entry\'s qty');

  setLabelPrintQty('i2', '0');
  assert.equal(getBatch().find(b => b.id === 'i2').qty, 1, 'setLabelPrintQty must clamp qty to a minimum of 1, not allow 0 or negative labels');

  removeFromLabelPrintBatch('i1');
  assert.equal(getBatch().length, 1, 'removing an item must drop it from the batch');
  assert.equal(getBatch()[0].id, 'i2', 'the remaining entry must be the one not removed');
}

console.log('Label batch functional checks passed');
