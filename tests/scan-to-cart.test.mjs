import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: a dedicated modal + toolbar entry point exist, separate from the research scanner ──
assert.match(dashboard, /<div id="cart-scan-modal" class="barcode-modal-overlay"/, 'a dedicated Scan To Cart modal must exist, reusing the shared barcode modal CSS');
assert.match(dashboard, /<button class="tab primary" onclick="openCartScanModal\(\)" title="Scan a printed shelf\/price label to add that exact item to the cart">📷 SCAN TO CART<\/button>/, 'the Inventory tab toolbar must have a SCAN TO CART entry point');

// ── Contract: it uses its own camera state, not the research scanner's globals ──
assert.match(dashboard, /let cartScanStream=null, cartScanDetector=null, cartScanDetecting=false;/, 'scan-to-cart must keep its own camera state separate from the research barcode scanner (openBarcodeScanner)');

// ── Contract: it looks up inventory by the SAME value printed on labels (labelBarcodeValue), not an external catalog ──
assert.match(dashboard, /const item=\(all\|\|\[\]\)\.find\(i=>i\.status==='in_stock'&&labelBarcodeValue\(i\)===lookupValue\);/, 'handleCartScanValue must match against labelBarcodeValue so a printed label barcode round-trips back to the same item');
assert.match(dashboard, /dashAddToCart\(item\.id\);/, 'a matched item must be added to the cart via the standard dashAddToCart path (stock checks, unified cart model), not a separate ad-hoc cart write');

// ── Contract: repeated frames of the same still-in-view barcode do not add it to the cart repeatedly ──
assert.match(dashboard, /if\(lookupValue===_cartScanLastValue&&\(now-_cartScanLastAt\)<2500\) return;/, 'handleCartScanValue must debounce identical consecutive scans so holding a label in view does not add it dozens of times');

// ── Contract: a QR label may encode a full TCGPlayer URL (with our own SKU riding
// along as &wo_sku=) instead of a bare SKU -- that URL must be unwrapped back to
// our SKU before the inventory lookup runs, and a plain (non-URL) value -- which is
// what every non-TCGPlayer-matched item's QR/barcode still encodes -- must pass
// through completely unchanged ──
assert.match(dashboard, /function cartScanLookupValue\(value\)\{/, 'a dedicated helper must unwrap a scanned URL back to our own SKU');
assert.match(dashboard, /if\(!\/\^https\?:.+?i\.test\(value\)\) return value;/, 'a non-URL scanned value must be returned unchanged -- this is the case for every item without a TCGPlayer match');
assert.match(dashboard, /const woSku = new URL\(value\)\.searchParams\.get\('wo_sku'\);/, 'a URL value must have its wo_sku query param extracted');
assert.match(dashboard, /const lookupValue=cartScanLookupValue\(value\);/, 'handleCartScanValue must run every scanned value through the unwrap helper before comparing against inventory');

console.log('Scan-to-cart contract checks passed');

// ── Functional: reimplement the debounce + lookup rules and verify them ──
function makeDebounce(){
  let lastValue = '', lastAt = 0;
  return (value, now) => {
    if(value === lastValue && (now - lastAt) < 2500) return false;
    lastValue = value; lastAt = now;
    return true;
  };
}
const shouldAccept = makeDebounce();
assert.equal(shouldAccept('SKU123', 1000), true, 'the first scan of a barcode must always go through');
assert.equal(shouldAccept('SKU123', 1500), false, 'the same barcode scanned again 500ms later (still in camera view) must be suppressed');
assert.equal(shouldAccept('SKU123', 4000), true, 'the same barcode scanned again after the debounce window (2.5s) must go through again -- re-scanning the same item on purpose must work');
assert.equal(shouldAccept('SKU999', 4100), true, 'a different barcode scanned immediately after must never be suppressed by the previous item\'s debounce');

function findByLabelBarcode(items, value){
  const labelBarcodeValue = (item) => String(item.upc || item.inventorySku || item.sku || item.id || '').trim();
  return items.find(i => i.status === 'in_stock' && labelBarcodeValue(i) === value);
}
const inv = [
  { id:'a1', status:'in_stock', sku:'WO-1001', name:'Toploader 3-pack' },
  { id:'a2', status:'sold', sku:'WO-1002', name:'Sold Out Item' },
];
assert.equal(findByLabelBarcode(inv, 'WO-1001')?.name, 'Toploader 3-pack', 'a scanned label barcode must resolve to the exact in-stock item that printed it');
assert.equal(findByLabelBarcode(inv, 'WO-1002'), undefined, 'a sold-out item\'s label must not resolve to anything addable to cart');

console.log('Scan-to-cart functional checks passed');

// ── Functional: cartScanLookupValue unwraps a TCGPlayer-URL QR payload back to our
// SKU, and passes through anything that is not itself a URL (a bare SKU/UPC/ID, or a
// URL that -- for whatever reason -- doesn't carry a wo_sku param) unchanged. ──
function cartScanLookupValue(value){
  if(!/^https?:\/\//i.test(value)) return value;
  try {
    const woSku = new URL(value).searchParams.get('wo_sku');
    return woSku || value;
  } catch(e) { return value; }
}
assert.equal(cartScanLookupValue('WO-1001'), 'WO-1001', 'a plain SKU (no TCGPlayer match, the common case) must pass through untouched');
assert.equal(cartScanLookupValue('012345678905'), '012345678905', 'a plain UPC must pass through untouched');
assert.equal(
  cartScanLookupValue('https://www.tcgplayer.com/product/654135?page=1&Language=English&Condition=Near+Mint&wo_sku=WO-2044'),
  'WO-2044',
  'a QR-encoded TCGPlayer product URL must resolve to the SKU carried in its wo_sku param, so scan-to-cart still finds the item'
);
assert.equal(
  cartScanLookupValue('https://www.tcgplayer.com/search/pokemon/product?q=charizard'),
  'https://www.tcgplayer.com/search/pokemon/product?q=charizard',
  'a URL with no wo_sku param must fall through as-is rather than throwing or silently matching the wrong item'
);
assert.equal(cartScanLookupValue('not a url at all: WO-9'), 'not a url at all: WO-9', 'a value that merely contains "http" mid-string, not at the start, must not be treated as a URL');

console.log('cartScanLookupValue functional checks passed');
