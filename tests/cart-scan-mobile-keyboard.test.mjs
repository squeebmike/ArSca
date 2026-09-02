import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store report (with screenshot): opening SCAN TO CART on a phone popped
// the on-screen keyboard immediately, covering most of the camera view.
// Root cause: openCartScanModal unconditionally auto-focused the manual
// barcode-entry field 80ms after opening, regardless of whether a camera
// was about to take over as the actual input method. Auto-focus only
// matters for a desktop register with a USB/Bluetooth scanner gun (those
// act as a keyboard and need the field focused to type into) -- wherever
// the browser's own camera scanner is available (every phone this was
// reported from), that's the primary input and doesn't need the keyboard.

const fnStart = dashboard.indexOf('function openCartScanModal(mode){');
const fnEnd = dashboard.indexOf('\nfunction openInventoryFindScanner', fnStart);
const fnBody = dashboard.slice(fnStart, fnEnd);
assert.ok(fnStart !== -1, 'openCartScanModal must exist');
assert.match(fnBody, /const canUseCamera = navigator\.mediaDevices\?\.getUserMedia && 'BarcodeDetector' in window;/,
  'must compute whether the camera scanner will actually be used');
assert.match(fnBody, /if\(canUseCamera\) startCartScanCamera\(\);\s*\n\s*else setTimeout\(\(\)=>document\.getElementById\('cart-scan-manual-input'\)\?\.focus\(\),80\);/,
  'must only auto-focus the manual-entry field (and pop the mobile keyboard) when the camera scanner is NOT available -- never both at once');

console.log('Scan-to-cart mobile keyboard contract checks passed');
