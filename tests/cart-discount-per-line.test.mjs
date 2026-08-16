import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: createLockedCheckoutSnapshot redistributes the cart-level discount into each line ──
assert.match(dashboard, /const discountRatio = subtotal > 0 \? discountTotal \/ subtotal : 0;/, 'createLockedCheckoutSnapshot must compute a discount ratio to redistribute across lines');
assert.match(dashboard, /const discountedItems = rawItems\.map\(\(item, idx\) => \{/, 'createLockedCheckoutSnapshot must build discount-adjusted line items before mapping through customerSafeLine');
assert.match(dashboard, /lines:discountedItems\.map\(customerSafeLine\),/, 'the locked snapshot lines must be built from the discount-adjusted items, not the raw pre-discount ones');
assert.doesNotMatch(dashboard, /lines:\(normalized\.items \|\| \[\]\)\.map\(customerSafeLine\),/, 'the old pre-discount line mapping must be gone');

console.log('Cart discount per-line contract checks passed');

// ── Functional: reimplement the exact remainder-to-last-line allocation and verify it ──
function allocateDiscount(items, subtotal, discountTotal){
  const discountRatio = subtotal > 0 ? discountTotal / subtotal : 0;
  let allocated = 0;
  return items.map((item, idx) => {
    const linePrice = Number(item.price || 0);
    const isLast = idx === items.length - 1;
    const discountedPrice = isLast
      ? Math.round((subtotal - discountTotal - allocated) * 100) / 100
      : Math.round((linePrice - linePrice * discountRatio) * 100) / 100;
    allocated += discountedPrice;
    return { ...item, price: discountedPrice };
  });
}

// Sold 3 White Flare bundles at $25 each ($75 subtotal) with a $10 flat discount applied in cart.
const single = allocateDiscount([{ price:75 }], 75, 10);
assert.equal(single[0].price, 65, 'a single multi-unit line (quantity stepper) must receive the full discount, not $0 or the undiscounted $75');

// Two different items in the same discounted cart -- discount must split proportionally, not go to one line only.
const multi = allocateDiscount([{ price:60 }, { price:40 }], 100, 20);
assert.equal(multi[0].price, 48, 'the larger line must absorb a proportional share of the discount');
assert.equal(multi[1].price, 32, 'the smaller line must absorb its proportional share of the discount');
const multiSum = Math.round((multi[0].price + multi[1].price) * 100) / 100;
assert.equal(multiSum, 80, 'discounted line prices must sum exactly to (subtotal - discountTotal), not drift from rounding');

// No discount at all -- every line must be completely unaffected (covers the overwhelmingly common case).
const none = allocateDiscount([{ price:12.99 }], 12.99, 0);
assert.equal(none[0].price, 12.99, 'a cart with no discount must leave line prices untouched');

// A $0 comp/giveaway line must stay $0 even inside a discounted cart with other items.
const withComp = allocateDiscount([{ price:0 }, { price:50 }], 50, 5);
assert.equal(withComp[0].price, 0, 'a $0 comp line must remain $0 after discount redistribution, never go negative');

console.log('Cart discount per-line functional checks passed');
