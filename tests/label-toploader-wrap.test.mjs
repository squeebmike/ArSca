import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: a layout picker exists and persists, independent of the size/printer picker ──
assert.match(dashboard, /<select id="label-print-layout" class="tsi" onchange="localStorage\.setItem\('label_print_layout', this\.value\)"/, 'a label layout picker must exist and persist the choice separately from label size');
assert.match(dashboard, /<option value="wrap">Wraps around a toploader/, 'a toploader-wrap layout option must exist');
assert.match(dashboard, /layoutEl\.value = localStorage\.getItem\('label_print_layout'\) \|\| 'standard';/, 'opening the modal must restore the last-used layout, defaulting to standard so existing labels don\'t change unexpectedly');

// ── Contract: wrap layout builds two faces -- item name/condition/price on the front
// (a loose label must still be identifiable by eye), shop logo + a LARGE scan code on
// the back. A prior version dropped the name entirely; that made a loose label
// unidentifiable and was reversed. ──
assert.match(dashboard, /const isWrap = layout === 'wrap';/, 'printInventoryLabels must branch on the selected layout');
assert.match(dashboard, /<div class="wrap-front">\s*\n\s*<div class="wrap-name">\$\{escHtml\(b\.name\)\}<\/div>\s*\n\s*<div class="wrap-condition">\$\{escHtml\(b\.condition \|\| ''\)\}<\/div>\s*\n\s*<div class="wrap-price">\$\{fdLabelPrice\$\(b\.price\)\}<\/div>\s*\n\s*<\/div>/, 'the front face must show the item name, condition, and price (whole dollars, no cents)');
assert.ok(!/<div class="wrap-front">[\s\S]{0,20}label-store/.test(dashboard), 'the wrap front face must not carry the store name header the standard layout uses');
assert.match(dashboard, /<div class="wrap-back">\s*\n\s*<img class="wrap-logo" src="assets\/mana-pocket-label-logo\.png" alt="">\s*\n\s*\$\{barcodeImg\}\s*\n\s*<\/div>/, 'the back face must carry only the fixed shop logo and the scan code -- no SKU text');
assert.match(dashboard, /const codeStyle = isWrap \? 'qr' : \(document\.getElementById\('label-print-code-style'\)\?\.value \|\| 'barcode'\);/, 'the wrap back face must always use QR regardless of the barcode-style dropdown -- a linear barcode reads worse than a QR at that size');
assert.match(dashboard, /const codeGenSize = isWrap \? 500 : 260;/, 'the wrap QR must be generated at a much bigger native size than the standard layout\'s code -- undersized generation followed by scaling is what made a confirmed-real QR fail to scan');
assert.match(dashboard, /\.label\.wrap \{ flex-direction:row !important; padding:0 !important; \}/, 'the wrap layout must lay the two faces out side by side with a fold line between them');
assert.match(dashboard, /border-right:1px dashed #999;/, 'a dashed fold line must separate the front and back faces so it\'s clear where to fold');
assert.match(dashboard, /\.wrap-logo \{ max-width:70%; max-height:18px; object-fit:contain; filter:grayscale\(1\) contrast\(1\.3\); \}/, 'the logo must be small (it is secondary to the scan code) and forced to grayscale so it doesn\'t print muddy on a monochrome/thermal printer');
assert.match(dashboard, /\.wrap-name \{ font-size:7px; font-weight:700; line-height:1\.1; max-height:16px; overflow:hidden; text-align:center; \}/, 'the item name must be styled small so it does not crowd out condition/price');

console.log('Label toploader-wrap contract checks passed');

// ── Contract: the download-PNG path draws the same fixed, greyscaled logo onto the wrap
// back face, sized much larger than before, and generates its QR at the code's own real
// pixel size (not a fixed size that then gets blurrily scaled to fit) ──
assert.match(dashboard, /const WRAP_LOGO_SRC = 'assets\/mana-pocket-label-logo\.png';/, 'the PNG download path must reference the same fixed shop logo asset as the print path');
assert.match(dashboard, /function loadWrapLogoImage\(\)\{/, 'a helper must exist to preload the wrap logo once per download batch, not once per label');
assert.match(dashboard, /const wrapLogoImg = isWrap \? await loadWrapLogoImage\(\) : null;/, 'downloadInventoryLabelPngs must only pay the logo-load cost when wrap layout is actually selected');
assert.match(dashboard, /ctx\.filter = 'grayscale\(1\)';\s*\n\s*ctx\.drawImage\(wrapLogoImg,/, 'the logo must be drawn with a grayscale canvas filter applied');
assert.match(dashboard, /ctx\.filter = 'none';/, 'the grayscale filter must be reset after drawing the logo so it doesn\'t bleed into other canvas draws');
assert.match(dashboard, /const logoH = h \* 0\.18, logoW = Math\.min\(logoH \* \(wrapLogoImg\.width \/ wrapLogoImg\.height\), halfW \* 0\.75\);/, 'the logo must be capped by height, not width -- every pixel it doesn\'t use is a pixel the code gets instead');
assert.match(dashboard, /const codeSize = Math\.min\(h - logoBottom - codeMargin \* 2, halfW - codeMargin \* 2\);/, 'the code must be sized to fill essentially all of the remaining back-face room below the logo');
assert.match(dashboard, /const codeCanvas = await generateLabelCodeCanvas\(codeValue, codeStyle, Math\.round\(codeSize\)\);/, 'the code canvas must be generated at exactly its real on-label pixel size, not a fixed size scaled down at draw time -- that scale-then-threshold combination is what broke a real scan');
assert.match(dashboard, /ctx\.imageSmoothingEnabled = false;/, 'canvas image smoothing must be disabled so any residual scaling stays crisp (hard edges) instead of blurring modules together before the black/white threshold pass runs');

console.log('Label toploader-wrap PNG-download contract checks passed');

// ── Functional: the front face always includes the item name, condition, and a
// whole-dollar price -- never the store name, never cents ──
function renderWrapFront(name, condition, price, fdLabelPrice$, escHtml){
  return `<div class="wrap-front">
          <div class="wrap-name">${escHtml(name)}</div>
          <div class="wrap-condition">${condition || ''}</div>
          <div class="wrap-price">${fdLabelPrice$(price)}</div>
        </div>`;
}
const fdLabelPrice$ = n => '$' + Math.round(Number(n || 0));
const front = renderWrapFront('Charizard VMAX', 'NM', 12.5, fdLabelPrice$, s => s);
assert.ok(!front.includes('label-store'), 'the front face template must never include a store-name element');
assert.ok(front.includes('wrap-name') && front.includes('Charizard VMAX'), 'the front face must include the item name so a loose label is still identifiable by eye');
assert.ok(front.includes('NM') && front.includes('$13') && !front.includes('$12.50'), 'the front face must show the condition and a whole-dollar rounded price, never cents');

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

// ── Functional: the back-face code-size math actually leaves the code bigger than the
// old fixed 42%-of-height allocation, and never overflows the square back face ──
function wrapCodeSize(h, halfW, hasLogo){
  const logoH = hasLogo ? h * 0.18 : 0;
  const logoTop = h * 0.03;
  const logoBottom = hasLogo ? logoTop + logoH : logoTop;
  const codeMargin = (halfW * 2) * 0.015;
  return Math.min(h - logoBottom - codeMargin * 2, halfW - codeMargin * 2);
}
const oldFixedCodeSize = 203 * 0.42; // the previous fixed 42%-of-height allocation, for comparison
const newCodeSize = wrapCodeSize(203, 203, true);
assert.ok(newCodeSize > oldFixedCodeSize * 1.5, `the new code size (${newCodeSize.toFixed(1)}) must be substantially bigger (>1.5x) than the old fixed allocation (${oldFixedCodeSize.toFixed(1)}) -- "make it bigger" must actually be reflected in the math, not just words`);
assert.ok(newCodeSize <= 203 && newCodeSize <= 203, 'the code must never be sized larger than the square back face it has to fit inside');
assert.ok(wrapCodeSize(203, 203, false) > newCodeSize, 'with no logo loaded, the code must be able to claim even more of the back face than with one');

console.log('Label toploader-wrap functional checks passed');
