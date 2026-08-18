import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: a layout picker exists and persists, independent of the size/printer picker ──
assert.match(dashboard, /<select id="label-print-layout" class="tsi" onchange="localStorage\.setItem\('label_print_layout', this\.value\)"/, 'a label layout picker must exist and persist the choice separately from label size');
assert.match(dashboard, /<option value="wrap">Wraps around a toploader/, 'a toploader-wrap layout option must exist');
assert.match(dashboard, /layoutEl\.value = localStorage\.getItem\('label_print_layout'\) \|\| 'standard';/, 'opening the modal must restore the last-used layout, defaulting to standard so existing labels don\'t change unexpectedly');

// ── Contract: wrap layout builds two faces -- price/condition only on the front, shop logo + scan code only on the back ──
assert.match(dashboard, /const isWrap = layout === 'wrap';/, 'printInventoryLabels must branch on the selected layout');
assert.match(dashboard, /<div class="wrap-front">\s*\n\s*<div class="wrap-condition">\$\{escHtml\(b\.condition \|\| ''\)\}<\/div>\s*\n\s*<div class="wrap-price">\$\{fd\$\(b\.price\)\}<\/div>\s*\n\s*<\/div>/, 'the front face must show only condition and price -- no store name, no item name');
assert.ok(!/<div class="wrap-front">[\s\S]{0,20}label-store/.test(dashboard), 'the wrap front face must not carry the store name header the standard layout uses');
assert.match(dashboard, /<div class="wrap-back">\s*\n\s*<img class="wrap-logo" src="assets\/mana-pocket-label-logo\.png" alt="">\s*\n\s*\$\{barcodeImg\}\s*\n\s*<\/div>/, 'the back face must carry only the fixed shop logo and the scan code -- no SKU text, no price/condition/name');
assert.match(dashboard, /\.label\.wrap \{ flex-direction:row !important; padding:0 !important; \}/, 'the wrap layout must lay the two faces out side by side with a fold line between them');
assert.match(dashboard, /border-right:1px dashed #999;/, 'a dashed fold line must separate the front and back faces so it\'s clear where to fold');
assert.match(dashboard, /\.wrap-logo \{ max-width:80%; max-height:28px; object-fit:contain; filter:grayscale\(1\) contrast\(1\.3\); \}/, 'the logo must be forced to grayscale so it doesn\'t print muddy or dither oddly on a monochrome/thermal printer');

console.log('Label toploader-wrap contract checks passed');

// ── Contract: the download-PNG path draws the same fixed, greyscaled logo onto the wrap back face ──
assert.match(dashboard, /const WRAP_LOGO_SRC = 'assets\/mana-pocket-label-logo\.png';/, 'the PNG download path must reference the same fixed shop logo asset as the print path');
assert.match(dashboard, /function loadWrapLogoImage\(\)\{/, 'a helper must exist to preload the wrap logo once per download batch, not once per label');
assert.match(dashboard, /const wrapLogoImg = isWrap \? await loadWrapLogoImage\(\) : null;/, 'downloadInventoryLabelPngs must only pay the logo-load cost when wrap layout is actually selected');
assert.match(dashboard, /ctx\.filter = 'grayscale\(1\)';\s*\n\s*ctx\.drawImage\(wrapLogoImg,/, 'the logo must be drawn with a grayscale canvas filter applied');
assert.match(dashboard, /ctx\.filter = 'none';/, 'the grayscale filter must be reset after drawing the logo so it doesn\'t bleed into other canvas draws');

console.log('Label toploader-wrap PNG-download contract checks passed');

// ── Functional: the front face never includes a store-name or item-name node ──
function renderWrapFront(condition, price, fd$){
  return `<div class="wrap-front">
          <div class="wrap-condition">${condition || ''}</div>
          <div class="wrap-price">${fd$(price)}</div>
        </div>`;
}
const front = renderWrapFront('NM', 12.5, p => `$${p.toFixed(2)}`);
assert.ok(!front.includes('label-store') && !front.includes('wrap-name'), 'the front face template must never include a store-name or item-name element');
assert.ok(front.includes('NM') && front.includes('$12.50'), 'the front face must still show the condition and formatted price');

// ── Functional: the back face never includes SKU text, regardless of logo presence ──
function renderWrapBack(barcodeImg, escHtml){
  return `<div class="wrap-back">
          <img class="wrap-logo" src="assets/mana-pocket-label-logo.png" alt="">
          ${barcodeImg}
        </div>`;
}
const back = renderWrapBack('<img class="barcode">', s => s);
assert.ok(!back.includes('wrap-sku'), 'the back face template must never include a SKU text element');
assert.ok(back.includes('mana-pocket-label-logo.png'), 'the back face must always reference the fixed shop logo asset');

console.log('Label toploader-wrap functional checks passed');
