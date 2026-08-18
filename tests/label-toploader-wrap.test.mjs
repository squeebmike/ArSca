import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: a layout picker exists and persists, independent of the size/printer picker ──
assert.match(dashboard, /<select id="label-print-layout" class="tsi" onchange="localStorage\.setItem\('label_print_layout', this\.value\)"/, 'a label layout picker must exist and persist the choice separately from label size');
assert.match(dashboard, /<option value="wrap">Wraps around a toploader/, 'a toploader-wrap layout option must exist');
assert.match(dashboard, /layoutEl\.value = localStorage\.getItem\('label_print_layout'\) \|\| 'standard';/, 'opening the modal must restore the last-used layout, defaulting to standard so existing labels don\'t change unexpectedly');

// ── Contract: wrap layout builds two faces -- item name, an optional "Signed by"
// badge, price, and condition on the front (a loose label must still be
// identifiable by eye), the shop name as plain text plus a LARGE scan code on
// the back. A prior version drew an illustrated logo image on the back, but a
// real printed label showed it as an unreadable blob (a detailed graffiti
// wordmark cannot survive being thresholded to pure black/white at thermal-print
// resolution) while every text element on the same label stayed crisp -- so the
// logo was replaced with plain bold text. ──
assert.match(dashboard, /const isWrap = layout === 'wrap';/, 'printInventoryLabels must branch on the selected layout');
assert.match(dashboard, /<div class="wrap-front">\s*\n\s*<div class="wrap-name">\$\{escHtml\(b\.name\)\}<\/div>\s*\n\s*\$\{b\.signedBy \? `<div class="wrap-signed">Signed: \$\{escHtml\(b\.signedBy\)\}<\/div>` : ''\}\s*\n\s*<div class="wrap-price">\$\{fdLabelPrice\$\(b\.price\)\}<\/div>\s*\n\s*<div class="wrap-condition">\$\{escHtml\(b\.condition \|\| ''\)\}<\/div>\s*\n\s*<\/div>/, 'the front face must show the item name, an optional signed-by badge, price, and condition in that order (whole-dollar price, no cents)');
assert.ok(!/<div class="wrap-front">[\s\S]{0,20}label-store/.test(dashboard), 'the wrap front face must not carry the store name header the standard layout uses');
assert.match(dashboard, /<div class="wrap-back">\s*\n\s*<div class="wrap-shopname">THE MANA POCKET<\/div>\s*\n\s*\$\{barcodeImg\}\s*\n\s*<\/div>/, 'the back face must carry only the shop name as plain text and the scan code -- no image logo, no SKU text');
assert.ok(!/wrap-logo/.test(dashboard), 'the illustrated logo image class must be fully removed -- it was confirmed unreadable on a real printed label');
assert.match(dashboard, /const codeStyle = isWrap \? 'qr' : \(document\.getElementById\('label-print-code-style'\)\?\.value \|\| 'barcode'\);/, 'the wrap back face must always use QR regardless of the barcode-style dropdown -- a linear barcode reads worse than a QR at that size');
assert.match(dashboard, /const codeGenSize = isWrap \? 500 : 260;/, 'the wrap QR must be generated at a much bigger native size than the standard layout\'s code -- undersized generation followed by scaling is what made a confirmed-real QR fail to scan');
assert.match(dashboard, /\.label\.wrap \{ flex-direction:row !important; padding:0 !important; \}/, 'the wrap layout must lay the two faces out side by side with a fold line between them');
assert.match(dashboard, /border-right:1px dashed #999;/, 'a dashed fold line must separate the front and back faces so it\'s clear where to fold');
assert.match(dashboard, /\.wrap-shopname \{ font-size:8px; font-weight:800; letter-spacing:\.03em; text-align:center; \}/, 'the shop name must be styled as a small fixed text band -- every pixel it doesn\'t use is a pixel the code gets instead');
assert.match(dashboard, /\.wrap-name \{ font-size:7px; font-weight:700; line-height:1\.1; max-height:16px; overflow:hidden; text-align:center; \}/, 'the item name must be styled small so it does not crowd out condition/price');
assert.match(dashboard, /\.wrap-signed \{ font-size:6px; font-weight:700; text-transform:uppercase; text-align:center; \}/, 'the signed-by badge must be styled small so it does not crowd out price/condition');
assert.match(dashboard, /\.wrap-price \{ font-size:24px; font-weight:900; line-height:1; \}/, 'the price must be the dominant, largest element on the front face');

console.log('Label toploader-wrap contract checks passed');

// ── Contract: the download-PNG path draws the shop name as plain bold canvas
// text (not an image), a "Signed by" badge only when the item is marked
// signed, price as the dominant element, and generates its QR at the code's
// own real pixel size (not a fixed size that then gets blurrily scaled to fit) ──
assert.ok(!/WRAP_LOGO_SRC/.test(dashboard), 'the illustrated logo image asset must no longer be referenced from the PNG download path -- it was confirmed unreadable on a real printed label');
assert.ok(!/loadWrapLogoImage/.test(dashboard), 'the logo-preload helper must be fully removed along with the image-based logo');
assert.ok(!/wrapLogoImg/.test(dashboard), 'no wrap-logo-image variable may remain in the download path');
assert.match(dashboard, /if\(b\.signedBy\)\{\s*\n\s*ctx\.font = `bold \$\{Math\.round\(h \* 0\.06\)\}px sans-serif`;\s*\n\s*ctx\.fillText\(\('Signed: ' \+ b\.signedBy\)\.toUpperCase\(\), halfW \/ 2, h \* 0\.24\);\s*\n\s*\}/, 'the front face must draw a "Signed by" badge only when the item is marked signed');
assert.match(dashboard, /ctx\.font = `900 \$\{Math\.round\(h \* 0\.3\)\}px sans-serif`;\s*\n\s*ctx\.fillText\(fdLabelPrice\$\(b\.price\), halfW \/ 2, h \* 0\.34\);/, 'the price must be drawn as the biggest, most dominant element on the front face');
assert.match(dashboard, /ctx\.font = `bold \$\{Math\.round\(h \* 0\.055\)\}px sans-serif`;\s*\n\s*ctx\.fillText\('THE MANA POCKET', halfW \+ halfW \/ 2, h \* 0\.03\);/, 'the back face shop name must be drawn as plain bold text, not an illustrated logo image');
assert.match(dashboard, /const logoBottom = h \* 0\.03 \+ h \* 0\.08;/, 'the code region must start below a fixed-height shop-name text band, not a variable image-logo height');
assert.match(dashboard, /const codeSize = Math\.min\(h - logoBottom - codeMargin \* 2, halfW - codeMargin \* 2\);/, 'the code must be sized to fill essentially all of the remaining back-face room below the shop name');
assert.match(dashboard, /const codeCanvas = await generateLabelCodeCanvas\(codeValue, codeStyle, Math\.round\(codeSize\)\);/, 'the code canvas must be generated at exactly its real on-label pixel size, not a fixed size scaled down at draw time -- that scale-then-threshold combination is what broke a real scan');
assert.match(dashboard, /ctx\.imageSmoothingEnabled = false;/, 'canvas image smoothing must be disabled so any residual scaling stays crisp (hard edges) instead of blurring modules together before the black/white threshold pass runs');

console.log('Label toploader-wrap PNG-download contract checks passed');

// ── Functional: the front face always includes the item name, condition, and a
// whole-dollar price -- never the store name, never cents -- and the signed-by
// badge only appears when the item is actually marked signed ──
function renderWrapFront(name, signedBy, condition, price, fdLabelPrice$, escHtml){
  return `<div class="wrap-front">
          <div class="wrap-name">${escHtml(name)}</div>
          ${signedBy ? `<div class="wrap-signed">Signed: ${escHtml(signedBy)}</div>` : ''}
          <div class="wrap-price">${fdLabelPrice$(price)}</div>
          <div class="wrap-condition">${escHtml(condition || '')}</div>
        </div>`;
}
const fdLabelPrice$ = n => '$' + Math.round(Number(n || 0));
const front = renderWrapFront('Charizard VMAX', '', 'NM', 12.5, fdLabelPrice$, s => s);
assert.ok(!front.includes('label-store'), 'the front face template must never include a store-name element');
assert.ok(front.includes('wrap-name') && front.includes('Charizard VMAX'), 'the front face must include the item name so a loose label is still identifiable by eye');
assert.ok(front.includes('NM') && front.includes('$13') && !front.includes('$12.50'), 'the front face must show the condition and a whole-dollar rounded price, never cents');
assert.ok(!front.includes('wrap-signed'), 'an unsigned item must not render a signed-by badge at all');

const signedFront = renderWrapFront('Booster Box', 'Ash Ketchum', 'NM', 10, fdLabelPrice$, s => s);
assert.ok(signedFront.includes('wrap-signed') && signedFront.includes('Signed: Ash Ketchum'), 'a signed item must render its signed-by badge with the signer\'s name');

// ── Functional: the back face never includes SKU text or an image logo ──
function renderWrapBack(barcodeImg, escHtml){
  return `<div class="wrap-back">
          <div class="wrap-shopname">THE MANA POCKET</div>
          ${barcodeImg}
        </div>`;
}
const back = renderWrapBack('<img class="barcode">', s => s);
assert.ok(!back.includes('wrap-sku'), 'the back face template must never include a SKU text element');
assert.ok(!back.includes('wrap-logo'), 'the back face must never reference the old image logo class');
assert.ok(back.includes('THE MANA POCKET'), 'the back face must always show the shop name as plain text');

// ── Functional: the back-face code-size math leaves the code bigger than the
// old fixed 42%-of-height allocation, and never overflows the square back face --
// the fixed-height text band leaves more room for the code than the old
// variable-height image logo did ──
function wrapCodeSize(h, halfW){
  const logoBottom = h * 0.03 + h * 0.08;
  const codeMargin = (halfW * 2) * 0.015;
  return Math.min(h - logoBottom - codeMargin * 2, halfW - codeMargin * 2);
}
const oldFixedCodeSize = 203 * 0.42; // the previous fixed 42%-of-height allocation, for comparison
const newCodeSize = wrapCodeSize(203, 203);
assert.ok(newCodeSize > oldFixedCodeSize * 1.5, `the new code size (${newCodeSize.toFixed(1)}) must be substantially bigger (>1.5x) than the old fixed allocation (${oldFixedCodeSize.toFixed(1)}) -- "make it bigger" must actually be reflected in the math, not just words`);
assert.ok(newCodeSize <= 203, 'the code must never be sized larger than the square back face it has to fit inside');

console.log('Label toploader-wrap functional checks passed');
