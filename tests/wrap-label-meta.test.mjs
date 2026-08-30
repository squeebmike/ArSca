import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync('dashboard.html', 'utf8');

// Store report: the wrap label's bottom row used to show the raw UPC/SKU
// next to condition -- nobody reads a long id off a shelf, and its length
// was crowding condition and contributing to real print cutoff on a
// physical MUNBYN print. Replaced with set/year, and the long SKU string is
// no longer rendered as visible text anywhere on the wrap label.

assert.match(html, /function labelMetaText\(item\)\{ return \[item\.set, item\.year\]\.filter\(Boolean\)\.join\(' · '\); \}/,
  'missing labelMetaText -- must derive a short, human-useful set/year string');
assert.match(html, /function labelBatchEntryFromItem\(item\)\{/,
  'missing labelBatchEntryFromItem -- both batch-entry push sites must build entries the same way, or one could still be missing meta');

{
  const fnStart = html.indexOf("function labelBatchEntryFromItem(item){");
  const fnEnd = html.indexOf('\n}', fnStart) + 2;
  const fn = html.slice(fnStart, fnEnd);
  assert.match(fn, /meta:labelMetaText\(item\)/, 'the batch entry must actually carry the computed meta string');
  assert.match(fn, /sku:labelBarcodeValue\(item\)/, 'sku must still be carried (the QR/barcode on the back face still needs it), just not rendered as front-face text');
}

// Both places a label gets added to the print batch must build entries the
// same way, not duplicate the object literal (which is exactly how the old
// meta-less version could drift out of sync between the two call sites).
assert.match(html, /if\(item\) labelPrintBatch\.push\(labelBatchEntryFromItem\(item\)\);/, 'openLabelPrintModal must use the shared entry builder');
assert.match(html, /else labelPrintBatch\.push\(labelBatchEntryFromItem\(item\)\);/, 'addToLabelPrintBatch must use the shared entry builder');

console.log('label batch entry contract checks passed');

// ── The actual printed wrap label ──
{
  const fnStart = html.indexOf('async function printInventoryLabels(){');
  const fnEnd = html.indexOf('\n}', fnStart) + 2;
  const fn = html.slice(fnStart, fnEnd);
  assert.match(fn, /<span class="wrap-condition">\$\{escHtml\(b\.condition \|\| ''\)\}<\/span><span class="wrap-meta">\$\{escHtml\(b\.meta \|\| ''\)\}<\/span>/,
    'the wrap label bottom row must render meta (set/year), not the old raw sku/UPC text');
  assert.doesNotMatch(fn, /class="wrap-sku"/, 'the old wrap-sku span must be fully removed, not left dangling alongside the new one');
}

assert.match(html, /\.wrap-meta \{ font-size:6px; font-weight:400; color:#555; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:right; \}/,
  'wrap-meta must truncate gracefully with ellipsis instead of raw-overflowing the label edge like the old unbounded wrap-sku could');
assert.doesNotMatch(html, /wrap-sku\b/, 'no remaining references to the removed wrap-sku class');

console.log('printed wrap label contract checks passed');
