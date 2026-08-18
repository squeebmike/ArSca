import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: the QR library is loaded, and a barcode-style picker exists and persists ──
assert.match(dashboard, /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/qrcode@1\.5\.3\/build\/qrcode\.min\.js" defer><\/script>/, 'missing the qrcode CDN script');
assert.match(dashboard, /<select id="label-print-code-style" class="tsi" onchange="localStorage\.setItem\('label_print_code_style', this\.value\)"/, 'a barcode-style picker must exist and persist the choice');
assert.match(dashboard, /<option value="barcode">Linear barcode \(CODE128\)/, 'a linear-barcode option must exist');
assert.match(dashboard, /<option value="qr">QR code/, 'a QR-code option must exist');
assert.match(dashboard, /codeStyleEl\.value = localStorage\.getItem\('label_print_code_style'\) \|\| 'barcode';/, 'opening the modal must restore the last-used code style, defaulting to barcode so existing labels don\'t change unexpectedly');

// ── Contract: a shared helper renders either a barcode or a QR code onto a canvas ──
assert.match(dashboard, /async function generateLabelCodeCanvas\(value, style\)\{/, 'missing generateLabelCodeCanvas helper');
assert.match(dashboard, /if\(style === 'qr' && typeof QRCode !== 'undefined'\)\{/, 'the helper must only attempt QR generation when the qrcode library has actually loaded');
assert.match(dashboard, /await QRCode\.toCanvas\(canvas, String\(value \|\| ''\), \{ margin:0, width:220 \}\);/, 'QR generation must draw onto the canvas via QRCode.toCanvas');
assert.match(dashboard, /JsBarcode\(canvas, value, \{ format:'CODE128', displayValue:false, margin:0 \}\);/, 'the helper must fall back to (or default to) a real CODE128 barcode');

// ── Contract: both the print path and the PNG-download path actually call the shared helper,
// reading the code-style dropdown for the standard layout, but the toploader-wrap layout's
// back face always forces QR regardless of that dropdown -- a linear barcode reads worse
// than a QR does on that smaller, more square-ish back face ──
const codeStyleReads = dashboard.match(/const codeStyle = isWrap \? 'qr' : \(document\.getElementById\('label-print-code-style'\)\?\.value \|\| 'barcode'\);/g) || [];
assert.equal(codeStyleReads.length, 2, 'both printInventoryLabels and downloadInventoryLabelPngs must force QR for wrap and otherwise read the code-style dropdown');
assert.match(dashboard, /const canvas = await generateLabelCodeCanvas\(b\.sku \|\| b\.id, codeStyle\);/, 'printInventoryLabels must generate its code image via the shared helper');
assert.match(dashboard, /const codeCanvas = await generateLabelCodeCanvas\(b\.sku \|\| b\.id, codeStyle\);/, 'downloadInventoryLabelPngs must generate its code image via the shared helper');

// ── Contract: scan-to-cart (reading our own printed labels back into the cart) must
// accept QR as a detectable format alongside the existing linear formats -- this is
// distinct from the research/product-lookup scanner and the CardSight scanner, which
// look up EXTERNAL products by their real UPC/EAN and must not be touched here ──
assert.match(dashboard, /const formats=\['upc_a','upc_e','ean_13','ean_8','code_128','qr_code'\]\.filter\(x=>!supported\.length\|\|supported\.includes\(x\)\);\s*\n\s*cartScanDetector=/, 'startCartScanCamera must include qr_code in its detectable formats so printed QR labels can be scanned back into the cart');

console.log('Label QR code contract checks passed');

// ── Functional: generateLabelCodeCanvas picks the right library call per style,
// and falls back to barcode if QR generation throws for a given value ──
{
  async function generateLabelCodeCanvas(value, style, { QRCode, JsBarcode, makeCanvas }){
    const canvas = makeCanvas();
    if(style === 'qr' && typeof QRCode !== 'undefined'){
      try {
        await QRCode.toCanvas(canvas, String(value || ''), { margin:0, width:220 });
        return canvas;
      } catch(e) { /* fall through to barcode if QR generation fails for this value */ }
    }
    try { JsBarcode(canvas, value, { format:'CODE128', displayValue:false, margin:0 }); } catch(e) {}
    return canvas;
  }

  const calls = [];
  const okQr = { toCanvas: async (c, v, o) => { calls.push(['qr', v, o]); } };
  const okBarcode = (c, v, o) => calls.push(['barcode', v, o]);
  await generateLabelCodeCanvas('ABC123', 'qr', { QRCode: okQr, JsBarcode: okBarcode, makeCanvas: () => ({}) });
  assert.deepEqual(calls, [['qr', 'ABC123', { margin:0, width:220 }]], 'style=qr with a working QRCode lib must call QRCode.toCanvas and not fall through to JsBarcode');

  calls.length = 0;
  await generateLabelCodeCanvas('ABC123', 'barcode', { QRCode: okQr, JsBarcode: okBarcode, makeCanvas: () => ({}) });
  assert.deepEqual(calls, [['barcode', 'ABC123', { format:'CODE128', displayValue:false, margin:0 }]], 'style=barcode must call JsBarcode directly, even when a QRCode lib is available');

  calls.length = 0;
  const throwingQr = { toCanvas: async () => { throw new Error('bad value for QR'); } };
  await generateLabelCodeCanvas('some-very-long-uuid-value-1234', 'qr', { QRCode: throwingQr, JsBarcode: okBarcode, makeCanvas: () => ({}) });
  assert.deepEqual(calls, [['barcode', 'some-very-long-uuid-value-1234', { format:'CODE128', displayValue:false, margin:0 }]], 'if QR generation throws for a given value, it must fall back to a barcode instead of producing a blank label');
}

console.log('Label QR code functional checks passed');
