import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store report: "I want to be able to scan qr to cart while im in the sale
// tab" -- SCAN TO CART (openCartScanModal, which already supports both
// barcode and QR formats -- see the 'qr_code' entry in its BarcodeDetector
// formats list) only ever had a button on the Inventory tab's toolbar.
// The scan flow itself already operates on the active cart directly (not
// scoped to whatever tab is open), so this only needed a button added to
// the SELL tab -- no new scanning logic.

const sellTabStart = dashboard.indexOf('<div id="tab-display" class="tab-panel">');
const sellTabEnd = dashboard.indexOf('id="dealer-checkout-actions"', sellTabStart);
const sellTabBody = dashboard.slice(sellTabStart, sellTabEnd);
assert.ok(sellTabStart !== -1, 'the SELL/checkout tab panel must exist');
assert.match(sellTabBody, /<button class="hbtn" onclick="openCartScanModal\(\)" style="margin-bottom:10px" title="Scan a printed shelf\/price label's barcode or QR code to add that exact item to the active cart">📷 SCAN TO CART<\/button>/,
  'the SELL tab\'s dealer checkout panel must have a SCAN TO CART button calling the same openCartScanModal used on Inventory');
assert.match(sellTabBody, /<div class="ph">DEALER CHECKOUT PANEL/, 'the scan button must live in the dealer (staff-only) checkout panel, not the customer-facing display');

// The underlying scan flow itself must already support QR codes, not just
// barcodes -- confirms the fix is real (a button to a flow that already
// works), not a promise of QR support that doesn't actually exist yet.
const cameraStart = dashboard.indexOf('async function startCartScanCamera(){');
const cameraEnd = dashboard.indexOf('\n}', cameraStart) + 2;
const cameraBody = dashboard.slice(cameraStart, cameraEnd);
assert.ok(cameraStart !== -1, 'startCartScanCamera must exist');
assert.match(cameraBody, /'qr_code'/, 'the scan-to-cart camera detector must include qr_code in its supported formats');

console.log('Sell-tab scan-to-cart contract checks passed');
