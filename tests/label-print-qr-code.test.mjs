import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: the QR library is loaded from a local vendored asset, not a CDN --
// the published qrcode@1.5.3 npm package does not actually ship the prebuilt
// build/qrcode.min.js its own docs reference (confirmed by pulling the real
// registry tarball: no build/ directory in it at all), so that CDN path 404s
// silently and QRCode never gets defined -- which is exactly why QR labels
// kept rendering as plain barcodes even with QR selected. Vendoring the file
// locally means there is no network call, no CDN version drift, and no way
// for this specific failure mode to recur. ──
assert.ok(fs.existsSync('assets/qrcode-generator.js'), 'the vendored QR library must exist on disk at assets/qrcode-generator.js');
assert.match(dashboard, /<script src="assets\/qrcode-generator\.js" defer><\/script>/, 'dashboard.html must load the vendored QR library, not an external CDN');
assert.doesNotMatch(dashboard, /cdn\.jsdelivr\.net\/npm\/qrcode/, 'no CDN reference to the broken qrcode@1.5.3 build path should remain');
const qrLibSrc = fs.readFileSync('assets/qrcode-generator.js', 'utf8');
assert.match(qrLibSrc, /var qrcode = function\(\)/, 'the vendored file must actually define the qrcode() constructor as a plain global var');
assert.match(qrLibSrc, /_this\.addData = function/, 'the vendored file must expose addData');
assert.match(qrLibSrc, /_this\.isDark = function/, 'the vendored file must expose isDark');
assert.match(qrLibSrc, /_this\.getModuleCount = function/, 'the vendored file must expose getModuleCount');

assert.match(dashboard, /<select id="label-print-code-style" class="tsi" onchange="localStorage\.setItem\('label_print_code_style', this\.value\)"/, 'a barcode-style picker must exist and persist the choice');
assert.match(dashboard, /<option value="barcode">Linear barcode \(CODE128\)/, 'a linear-barcode option must exist');
assert.match(dashboard, /<option value="qr">QR code/, 'a QR-code option must exist');
assert.match(dashboard, /codeStyleEl\.value = localStorage\.getItem\('label_print_code_style'\) \|\| 'barcode';/, 'opening the modal must restore the last-used code style, defaulting to barcode so existing labels don\'t change unexpectedly');

// ── Contract: a shared helper renders either a barcode or a QR code onto a canvas,
// using the vendored library's real matrix API (qrcode(...).addData/.make/.isDark),
// not the nonexistent QRCode.toCanvas API from the broken CDN build ──
assert.match(dashboard, /async function generateLabelCodeCanvas\(value, style\)\{/, 'missing generateLabelCodeCanvas helper');
assert.match(dashboard, /if\(style === 'qr' && typeof qrcode !== 'undefined'\)\{/, 'the helper must only attempt QR generation when the vendored qrcode library has actually loaded');
assert.match(dashboard, /const qr = qrcode\(0, 'M'\);/, 'QR generation must use the vendored library\'s constructor (auto type-size, M error correction)');
assert.match(dashboard, /qr\.addData\(String\(value \|\| ''\)\);/, 'the value must be added to the QR matrix');
assert.match(dashboard, /qr\.make\(\);/, 'the QR matrix must actually be built before reading it');
assert.match(dashboard, /if\(qr\.isDark\(row, col\)\)\{/, 'each dark module must be drawn onto the canvas by hand, since the vendored library has no built-in canvas renderer call');
assert.match(dashboard, /JsBarcode\(canvas, value, \{ format:'CODE128', displayValue:false, margin:0 \}\);/, 'the helper must fall back to (or default to) a real CODE128 barcode');

// ── Contract: both the print path and the PNG-download path actually call the shared helper,
// reading the code-style dropdown for the standard layout, but the toploader-wrap layout's
// back face always forces QR regardless of that dropdown -- a linear barcode reads worse
// than a QR does on that smaller, more square-ish back face ──
const codeStyleReads = dashboard.match(/const codeStyle = isWrap \? 'qr' : \(document\.getElementById\('label-print-code-style'\)\?\.value \|\| 'barcode'\);/g) || [];
assert.equal(codeStyleReads.length, 2, 'both printInventoryLabels and downloadInventoryLabelPngs must force QR for wrap and otherwise read the code-style dropdown');
assert.match(dashboard, /const canvas = await generateLabelCodeCanvas\(codeStyle === 'qr' \? labelQrPayload\(b\) : \(b\.sku \|\| b\.id\), codeStyle\);/, 'printInventoryLabels must generate its code image via the shared helper');
assert.match(dashboard, /const codeCanvas = await generateLabelCodeCanvas\(codeStyle === 'qr' \? labelQrPayload\(b\) : \(b\.sku \|\| b\.id\), codeStyle\);/, 'downloadInventoryLabelPngs must generate its code image via the shared helper');

// ── Contract: scan-to-cart (reading our own printed labels back into the cart) must
// accept QR as a detectable format alongside the existing linear formats -- this is
// distinct from the research/product-lookup scanner and the CardSight scanner, which
// look up EXTERNAL products by their real UPC/EAN and must not be touched here ──
assert.match(dashboard, /const formats=\['upc_a','upc_e','ean_13','ean_8','code_128','qr_code'\]\.filter\(x=>!supported\.length\|\|supported\.includes\(x\)\);\s*\n\s*cartScanDetector=/, 'startCartScanCamera must include qr_code in its detectable formats so printed QR labels can be scanned back into the cart');

console.log('Label QR code contract checks passed');

// ── Functional: load the REAL vendored library (not a mock) and prove it actually
// generates a valid, non-blank QR module matrix for values like the ones this
// feature encodes -- a plain SKU, and a long UUID fallback (the original bug
// report: the CDN script 404'd, so this whole path silently no-op'd before). ──
{
  const vm = await import('node:vm');
  const context = {};
  vm.createContext(context);
  vm.runInContext(qrLibSrc, context);
  assert.equal(typeof context.qrcode, 'function', 'evaluating the vendored file must define a global qrcode() function, matching what dashboard.html expects at runtime');

  function moduleGrid(value){
    const qr = context.qrcode(0, 'M');
    qr.addData(String(value));
    qr.make();
    const count = qr.getModuleCount();
    let dark = 0;
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (qr.isDark(r, c)) dark++;
    return { count, dark };
  }

  const short = moduleGrid('WO-1001');
  assert.ok(short.count >= 21, 'even a short SKU must produce at least a version-1 (21x21) QR matrix');
  assert.ok(short.dark > 0 && short.dark < short.count * short.count, 'a real QR matrix must have a realistic mix of dark and light modules, not be blank or fully filled');

  const longUuid = moduleGrid('3f1c9a2e-6b7d-4e10-9c3a-1f8e5d2b7a44');
  assert.ok(longUuid.count > short.count, 'a long UUID fallback value must produce a larger matrix than a short SKU -- proving the library actually scales with input length instead of erroring or truncating');
  assert.ok(longUuid.dark > 0, 'the long-UUID QR matrix must not be blank');
}

console.log('Label QR code functional checks passed (verified against the real vendored library)');
