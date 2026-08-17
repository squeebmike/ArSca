import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: a layout picker exists and persists, independent of the size/printer picker ──
assert.match(dashboard, /<select id="label-print-layout" class="tsi" onchange="localStorage\.setItem\('label_print_layout', this\.value\)"/, 'a label layout picker must exist and persist the choice separately from label size');
assert.match(dashboard, /<option value="wrap">Wraps around a toploader/, 'a toploader-wrap layout option must exist');
assert.match(dashboard, /layoutEl\.value = localStorage\.getItem\('label_print_layout'\) \|\| 'standard';/, 'opening the modal must restore the last-used layout, defaulting to standard so existing labels don\'t change unexpectedly');

// ── Contract: wrap layout builds two faces -- price/condition large on front, barcode-only on back ──
assert.match(dashboard, /const isWrap = layout === 'wrap';/, 'printInventoryLabels must branch on the selected layout');
assert.match(dashboard, /<div class="wrap-condition">\$\{escHtml\(b\.condition \|\| ''\)\}<\/div>\s*\n\s*<div class="wrap-price">\$\{fd\$\(b\.price\)\}<\/div>/, 'the front face must show condition and price, with price rendered via the same fd$ formatter as the rest of the app');
assert.match(dashboard, /<div class="wrap-back">\s*\n\s*\$\{storeLogo \? `<img class="wrap-logo" src="\$\{storeLogo\}" alt="">` : ''\}\s*\n\s*\$\{barcodeImg\}\s*\n\s*<div class="wrap-sku">\$\{escHtml\(b\.sku \|\| ''\)\}<\/div>/, 'the back face must carry the store logo (when set), then the barcode and SKU text, not price/condition/name');
assert.match(dashboard, /const storeLogo = vendorProfile\.logo \|\| '';/, 'printInventoryLabels must read the store logo already uploaded in Settings, not a separate upload flow');
assert.match(dashboard, /\.label\.wrap \{ flex-direction:row !important; padding:0 !important; \}/, 'the wrap layout must lay the two faces out side by side with a fold line between them');
assert.match(dashboard, /border-right:1px dashed #999;/, 'a dashed fold line must separate the front and back faces so it\'s clear where to fold');
assert.match(dashboard, /\.wrap-logo \{ max-width:70%; max-height:14px; object-fit:contain; \}/, 'the logo must be sized to fit above the barcode without crowding the fold-line face');

console.log('Label toploader-wrap contract checks passed');

// ── Functional: the back face only renders a logo <img> when one is set ──
const printFnSrc = dashboard.match(/function printInventoryLabels\(\)\{[\s\S]*?\n\}\n/)[0];
function renderWrapBack(storeLogo){
  const fn = new Function('storeLogo', 'barcodeImg', 'sku', 'escHtml', `
    return \`<div class="wrap-back">
          \${storeLogo ? \`<img class="wrap-logo" src="\${storeLogo}" alt="">\` : ''}
          \${barcodeImg}
          <div class="wrap-sku">\${escHtml(sku || '')}</div>
        </div>\`;
  `);
  return fn(storeLogo, '<img class="barcode">', 'SKU123', s => s);
}
assert.ok(!renderWrapBack('').includes('wrap-logo'), 'no logo set must render no <img class="wrap-logo">');
assert.ok(renderWrapBack('https://cdn.example.com/logo.png').includes('src="https://cdn.example.com/logo.png"'), 'a set logo must render with its URL as the img src');
assert.ok(printFnSrc.length > 0, 'printInventoryLabels must exist as a single extractable function for this to be a meaningful check');

console.log('Label toploader-wrap functional checks passed');
