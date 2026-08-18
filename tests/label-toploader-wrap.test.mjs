import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: a layout picker exists and persists, independent of the size/printer picker ──
assert.match(dashboard, /<select id="label-print-layout" class="tsi" onchange="localStorage\.setItem\('label_print_layout', this\.value\)"/, 'a label layout picker must exist and persist the choice separately from label size');
assert.match(dashboard, /<option value="wrap">Wraps around a toploader/, 'a toploader-wrap layout option must exist');
assert.match(dashboard, /layoutEl\.value = localStorage\.getItem\('label_print_layout'\) \|\| 'standard';/, 'opening the modal must restore the last-used layout, defaulting to standard so existing labels don\'t change unexpectedly');

// ── Contract: only one badge line fits under the name, so labelBadgeText
// picks the single highest-priority thing worth calling out rather than
// stacking several -- signed (the store's own added-value claim, tied to a
// real price) beats key issue (a fact about the book, with its own reason)
// beats a detected ratio/incentive/promo variant signal (the weakest of the
// three, and the only one with no dedicated field behind it). ──
assert.match(dashboard, /function labelBadgeText\(item\)\{/, 'missing labelBadgeText');
assert.match(dashboard, /if\(item\.is_signed\) return 'Signed: ' \+ \(item\.signed_by \|\| 'Signed'\);/, 'a signed item must take top priority for the single badge slot');
assert.match(dashboard, /if\(item\.is_key\) return 'Key Issue' \+ \(item\.key_notes \? ': ' \+ item\.key_notes : ''\);/, 'a key issue must be the second priority, including its stored reason when present');
assert.match(dashboard, /const signal = typeof detectVariantSignal === 'function' \? detectVariantSignal\(item\.variant \|\| ''\) : '';/, 'lacking a signed or key flag, the badge must fall back to the existing ratio/incentive/promo variant-signal detector rather than a separate reimplementation');

console.log('Label toploader-wrap badge-priority contract checks passed');

// ── Contract: wrap layout builds two faces -- item name, an optional badge
// (signed/key/promo -- see labelBadgeText), a price (small $ + big
// whole-dollar digits, price-tag style), and condition on the front (a loose
// label must still be identifiable by eye), the shop name as plain text plus
// a LARGE scan code on the back. A prior version drew an illustrated logo
// image on the back, but a real printed label showed it as an unreadable
// blob (a detailed graffiti wordmark cannot survive being thresholded to
// pure black/white at thermal-print resolution) while every text element on
// the same label stayed crisp -- so the logo was replaced with plain bold
// text. ──
assert.match(dashboard, /const isWrap = layout === 'wrap';/, 'printInventoryLabels must branch on the selected layout');
assert.match(dashboard, /<div class="wrap-front">\s*\n\s*<div class="wrap-name">\$\{escHtml\(b\.name\)\}<\/div>\s*\n\s*\$\{b\.badge \? `<div class="wrap-badge">\$\{escHtml\(b\.badge\)\}<\/div>` : ''\}\s*\n\s*<div class="wrap-price"><span class="wrap-price-dollar">\$\{escHtml\(fdLabelPrice\$\(b\.price\)\.charAt\(0\)\)\}<\/span><span class="wrap-price-num">\$\{escHtml\(fdLabelPrice\$\(b\.price\)\.slice\(1\)\)\}<\/span><\/div>\s*\n\s*<div class="wrap-condition">\$\{escHtml\(b\.condition \|\| ''\)\}<\/div>\s*\n\s*<\/div>/, 'the front face must show the item name, an optional badge, a price-tag-style price (small $ raised above the digits\' baseline), and condition in that order (whole dollars, no cents)');
assert.ok(!/<div class="wrap-front">[\s\S]{0,20}label-store/.test(dashboard), 'the wrap front face must not carry the store name header the standard layout uses');
assert.match(dashboard, /<div class="wrap-back">\s*\n\s*<div class="wrap-shopname">THE MANA POCKET<\/div>\s*\n\s*\$\{barcodeImg\}\s*\n\s*<\/div>/, 'the back face must carry only the shop name as plain text and the scan code -- no image logo, no SKU text');
assert.ok(!/wrap-logo/.test(dashboard), 'the illustrated logo image class must be fully removed -- it was confirmed unreadable on a real printed label');
assert.match(dashboard, /const codeStyle = isWrap \? 'qr' : \(document\.getElementById\('label-print-code-style'\)\?\.value \|\| 'barcode'\);/, 'the wrap back face must always use QR regardless of the barcode-style dropdown -- a linear barcode reads worse than a QR at that size');
assert.match(dashboard, /const codeGenSize = isWrap \? 500 : 260;/, 'the wrap QR must be generated at a much bigger native size than the standard layout\'s code -- undersized generation followed by scaling is what made a confirmed-real QR fail to scan');
assert.match(dashboard, /\.label\.wrap \{ flex-direction:row !important; padding:0 !important; \}/, 'the wrap layout must lay the two faces out side by side with a fold line between them');
assert.match(dashboard, /border-right:1px dashed #999;/, 'a dashed fold line must separate the front and back faces so it\'s clear where to fold');
assert.match(dashboard, /\.label\.wrap \.wrap-back \{ padding:8px 6px 5px; justify-content:flex-start; gap:8px; \}/, 'the back face must use equal top-padding and shopname-to-code gap so the two spaces read as symmetric');
assert.match(dashboard, /\.wrap-shopname \{ font-size:9px; font-weight:800; letter-spacing:\.03em; text-align:center; \}/, 'the shop name must be a bit bigger than before, still a small fixed text band');
assert.match(dashboard, /\.wrap-name \{ font-size:8px; font-weight:700; line-height:1\.1; max-height:18px; overflow:hidden; text-align:center; \}/, 'the item name must be a bit bigger than before while still not crowding out condition/price');
assert.match(dashboard, /\.wrap-badge \{ font-size:6px; font-weight:400; text-transform:uppercase; text-align:center; \}/, 'the badge (whichever one applies) must not be bold -- it is secondary to the item name');
assert.match(dashboard, /\.wrap-condition \{ font-size:11px; font-weight:800; text-transform:uppercase; align-self:flex-start; \}/, 'the condition must sit at the left edge of the front face, not centered');
assert.match(dashboard, /\.wrap-price \{ font-size:14px; font-weight:900; line-height:1; margin-left:8px; margin-top:auto; \}/, 'the price\'s base size is the small $ sign size -- the digits get their own bigger size via a nested span');
assert.match(dashboard, /\.wrap-price-dollar \{ vertical-align:9px; \}/, 'the $ sign must be raised above the digits\' own baseline via vertical-align, not sunk to it');
assert.match(dashboard, /\.wrap-price-num \{ font-size:24px; \}/, 'the whole-dollar digits must render bigger than the $ sign -- classic price-tag styling');

console.log('Label toploader-wrap contract checks passed');

// ── Contract: the download-PNG path draws the shop name as plain bold canvas
// text (not an image), the single highest-priority badge only when one
// applies, a price-tag-style price (small $ sign, big whole-dollar digits,
// right-aligned), equal padding above and below the shop name, and generates
// its QR at the code's own real pixel size (not a fixed size that then gets
// blurrily scaled to fit) ──
assert.ok(!/WRAP_LOGO_SRC/.test(dashboard), 'the illustrated logo image asset must no longer be referenced from the PNG download path -- it was confirmed unreadable on a real printed label');
assert.ok(!/loadWrapLogoImage/.test(dashboard), 'the logo-preload helper must be fully removed along with the image-based logo');
assert.ok(!/wrapLogoImg/.test(dashboard), 'no wrap-logo-image variable may remain in the download path');
assert.match(dashboard, /const nameFont = Math\.round\(h \* 0\.085\);/, 'the item name must be drawn a bit bigger than before');
assert.match(dashboard, /if\(b\.badge\)\{\s*\n(?:[^\n]*\n)*?\s*ctx\.font = `\$\{Math\.round\(h \* 0\.06\)\}px sans-serif`;\s*\n\s*ctx\.fillText\(b\.badge\.toUpperCase\(\), halfW \/ 2, h \* 0\.24\);\s*\n\s*\}/, 'the front face must draw whichever single badge applies, and it must not be bold -- it is secondary to the item name');
assert.match(dashboard, /const priceStr = fdLabelPrice\$\(b\.price\);\s*\n\s*const dollarSign = priceStr\.charAt\(0\), priceDigits = priceStr\.slice\(1\);/, 'the price must be split into a $ sign and whole-dollar digits so they can be drawn at different sizes');
assert.match(dashboard, /const priceBigFont = Math\.round\(h \* 0\.3\), priceSmallFont = Math\.round\(priceBigFont \* 0\.55\);/, 'the $ sign must be drawn noticeably smaller than the digits -- classic price-tag styling');
assert.match(dashboard, /ctx\.fillText\(priceDigits, priceRight, priceBaseline\);/, 'the whole-dollar digits must be drawn at the big font size');
assert.match(dashboard, /const dollarBaseline = priceBaseline - priceBigFont \* 0\.36;/, 'the $ sign must be raised above the digits\' baseline rather than sinking to it');
assert.match(dashboard, /ctx\.fillText\(dollarSign, priceRight - priceDigitsWidth, dollarBaseline\);/, 'the $ sign must be pinned immediately to the left of the digits, at its raised baseline');
assert.match(dashboard, /ctx\.textAlign = 'left'; ctx\.textBaseline = 'top';\s*\n\s*ctx\.font = `bold \$\{Math\.round\(h \* 0\.13\)\}px sans-serif`;\s*\n\s*ctx\.fillText\(String\(b\.condition \|\| ''\)\.toUpperCase\(\), padX, h \* 0\.8\);/, 'the condition must be drawn at the left edge of the front face, not centered');
assert.match(dashboard, /const shopFont = Math\.round\(h \* 0\.065\), shopPad = h \* 0\.032;/, 'the shop name must be drawn a bit bigger than before, with an explicit symmetric padding value');
assert.match(dashboard, /ctx\.fillText\('THE MANA POCKET', halfW \+ halfW \/ 2, shopPad\);/, 'the back face shop name must be drawn as plain bold text, not an illustrated logo image, using the symmetric top padding');
assert.match(dashboard, /const logoBottom = shopPad \+ shopFont \* 1\.2 \+ shopPad;/, 'the code region must start below a band with equal padding above and below the shop-name text, not eyeballed constants');
assert.match(dashboard, /const codeSize = Math\.min\(h - logoBottom - codeMargin \* 2, halfW - codeMargin \* 2\);/, 'the code must be sized to fill essentially all of the remaining back-face room below the shop name');
assert.match(dashboard, /const codeCanvas = await generateLabelCodeCanvas\(codeValue, codeStyle, Math\.round\(codeSize\)\);/, 'the code canvas must be generated at exactly its real on-label pixel size, not a fixed size scaled down at draw time -- that scale-then-threshold combination is what broke a real scan');
assert.match(dashboard, /ctx\.imageSmoothingEnabled = false;/, 'canvas image smoothing must be disabled so any residual scaling stays crisp (hard edges) instead of blurring modules together before the black/white threshold pass runs');

console.log('Label toploader-wrap PNG-download contract checks passed');

// ── Functional: labelBadgeText picks exactly one badge, in priority order ──
function labelBadgeText(item, detectVariantSignal){
  if(item.is_signed) return 'Signed: ' + (item.signed_by || 'Signed');
  if(item.is_key) return 'Key Issue' + (item.key_notes ? ': ' + item.key_notes : '');
  const signal = typeof detectVariantSignal === 'function' ? detectVariantSignal(item.variant || '') : '';
  return signal || '';
}
const fakeDetectVariantSignal = (label) => /1\s*:\s*(\d+)/.test(label) ? `1:${label.match(/1\s*:\s*(\d+)/)[1]} INCENTIVE` : '';

assert.equal(labelBadgeText({ is_signed:true, signed_by:'Ash Ketchum', is_key:true, key_notes:'1st app' }, fakeDetectVariantSignal), 'Signed: Ash Ketchum', 'signed must win over key issue and variant signal when multiple apply');
assert.equal(labelBadgeText({ is_signed:true, is_key:true }, fakeDetectVariantSignal), 'Signed: Signed', 'a signed item with no recorded signer name must still show a generic signed badge');
assert.equal(labelBadgeText({ is_key:true, key_notes:'1st appearance of X', variant:'1:25 ratio' }, fakeDetectVariantSignal), 'Key Issue: 1st appearance of X', 'key issue must win over a variant signal when both apply');
assert.equal(labelBadgeText({ is_key:true }, fakeDetectVariantSignal), 'Key Issue', 'a key issue with no stored reason must still show a generic key-issue badge, no stray colon');
assert.equal(labelBadgeText({ variant:'1:25 ratio incentive cover' }, fakeDetectVariantSignal), '1:25 INCENTIVE', 'lacking signed/key flags, a detected variant signal must be used');
assert.equal(labelBadgeText({}, fakeDetectVariantSignal), '', 'an item with no signed/key flag and no variant signal must show no badge at all');

console.log('labelBadgeText functional checks passed');

// ── Functional: the front face always includes the item name, condition, and a
// whole-dollar price -- never the store name, never cents -- and the badge
// only appears when one actually applies ──
function renderWrapFront(name, badge, condition, price, fdLabelPrice$, escHtml){
  const priceStr = fdLabelPrice$(price);
  return `<div class="wrap-front">
          <div class="wrap-name">${escHtml(name)}</div>
          ${badge ? `<div class="wrap-badge">${escHtml(badge)}</div>` : ''}
          <div class="wrap-price">${escHtml(priceStr.charAt(0))}<span class="wrap-price-num">${escHtml(priceStr.slice(1))}</span></div>
          <div class="wrap-condition">${escHtml(condition || '')}</div>
        </div>`;
}
const fdLabelPrice$ = n => '$' + Math.round(Number(n || 0));
const front = renderWrapFront('Charizard VMAX', '', 'NM', 12.5, fdLabelPrice$, s => s);
assert.ok(!front.includes('label-store'), 'the front face template must never include a store-name element');
assert.ok(front.includes('wrap-name') && front.includes('Charizard VMAX'), 'the front face must include the item name so a loose label is still identifiable by eye');
assert.ok(front.includes('NM') && front.includes('$') && front.includes('13') && !front.includes('12.50'), 'the front face must show the condition and a whole-dollar rounded price, never cents');
assert.ok(front.includes('wrap-price-num'), 'the digits must render in their own bigger-font span, separate from the $ sign');
assert.ok(!front.includes('wrap-badge'), 'an item with no applicable badge must not render a badge element at all');

const badgedFront = renderWrapFront('Booster Box', 'Signed: Ash Ketchum', 'NM', 10, fdLabelPrice$, s => s);
assert.ok(badgedFront.includes('wrap-badge') && badgedFront.includes('Signed: Ash Ketchum'), 'an item with an applicable badge must render it with its full text');

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
// the symmetric-padding text band leaves essentially the same room for the
// code as the old eyeballed-constant version did ──
function wrapCodeSize(h, halfW){
  const shopFont = Math.round(h * 0.065), shopPad = h * 0.032;
  const logoBottom = shopPad + shopFont * 1.2 + shopPad;
  const codeMargin = (halfW * 2) * 0.015;
  return Math.min(h - logoBottom - codeMargin * 2, halfW - codeMargin * 2);
}
const oldFixedCodeSize = 203 * 0.42; // the previous fixed 42%-of-height allocation, for comparison
const newCodeSize = wrapCodeSize(203, 203);
assert.ok(newCodeSize > oldFixedCodeSize * 1.5, `the new code size (${newCodeSize.toFixed(1)}) must be substantially bigger (>1.5x) than the old fixed allocation (${oldFixedCodeSize.toFixed(1)}) -- "make it bigger" must actually be reflected in the math, not just words`);
assert.ok(newCodeSize <= 203, 'the code must never be sized larger than the square back face it has to fit inside');

// ── Functional: the price-tag price-splitting logic actually separates a $
// sign from whole-dollar digits, for both single- and multi-digit prices ──
function splitPrice(price, fdLabelPrice$){
  const priceStr = fdLabelPrice$(price);
  return { dollarSign: priceStr.charAt(0), digits: priceStr.slice(1) };
}
assert.deepEqual(splitPrice(10, fdLabelPrice$), { dollarSign: '$', digits: '10' }, 'a whole-dollar price must split into a $ sign and its digits');
assert.deepEqual(splitPrice(9.99, fdLabelPrice$), { dollarSign: '$', digits: '10' }, 'a price that rounds up must still split correctly after rounding');
assert.deepEqual(splitPrice(0, fdLabelPrice$), { dollarSign: '$', digits: '0' }, 'a zero price must still split into a $ sign and a lone 0 digit, not blank out');

console.log('Label toploader-wrap functional checks passed');
