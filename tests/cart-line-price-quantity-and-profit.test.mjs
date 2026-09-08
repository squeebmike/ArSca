import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store report: "Comics and comic pre orders don't seem to be calculating
// profits and sales correctly. Especially 1 off and comic selected." Two
// bugs, both stemming from the same violated invariant: every reader of a
// cart line (normalizeCartTotals, customerSafeLine, and
// renderDealerCartTools's own comment -- "quick-sale/bulk-lot lines store
// `price` as an already-total lump sum") treats a cart line's `price` as
// the FULL EXTENDED total for that line, not a per-unit rate. The +/-
// quantity stepper (adjustCartLineQuantity) already maintains that
// correctly (`item.price = effectiveUnitPrice * nextQty`), but a line
// added with its INITIAL quantity > 1 -- the ONE-OFF modal (any qty typed
// directly), or the normal Sell modal on a quantity-grouped comic row
// (selling 3 of 5 copies at once) -- set price to the bare per-unit rate
// instead, silently undercounting that line's cart total/revenue by a
// factor of its quantity. And separately, item.cost/costBasis is always
// PER-UNIT (never touched by the stepper) -- customerSafeLine, which
// builds the actual pos_sale_lines rows Reports/profit reads, was still
// treating it as if it were the whole line's cost, the same bug already
// fixed on the inventory-tracking side in markCartItemsSoldFromPayment
// (see tests/cart-quantity-stepper.test.mjs) but missing here.

// ---------------------------------------------------------------------
// addSaleItemToCart: price must be the extended total from creation,
// not just once the stepper later touches it.
// ---------------------------------------------------------------------
const addSaleStart = dashboard.indexOf('function addSaleItemToCart(item = {}, options = {}){');
assert.ok(addSaleStart !== -1, 'addSaleItemToCart must exist');
const addSaleEnd = dashboard.indexOf('\nfunction addCustomBulkLotToCart', addSaleStart);
const addSaleBody = dashboard.slice(addSaleStart, addSaleEnd);

assert.match(addSaleBody, /price: Math\.round\(unitPrice \* quantity \* 100\) \/ 100,/,
  'a cart line\'s price must be initialized as unitPrice * quantity (the extended total), matching what the +/- stepper already maintains -- not the bare per-unit rate');
assert.doesNotMatch(addSaleBody, /\n\s*price: unitPrice,/,
  'must not still initialize price as the bare per-unit rate anywhere in this function');
// unitPrice itself must stay the true per-unit rate (adjustCartLineQuantity's
// own fallback depends on this staying accurate).
assert.match(addSaleBody, /unitPrice,\s*\n\s*costBasis,/, 'the true per-unit rate must still be preserved separately as unitPrice');

// ---------------------------------------------------------------------
// customerSafeLine: cost_basis/profit must scale cost by the line's quantity
// ---------------------------------------------------------------------
const customerSafeLineStart = dashboard.indexOf('function customerSafeLine(item){');
assert.ok(customerSafeLineStart !== -1, 'customerSafeLine must exist');
const customerSafeLineEnd = dashboard.indexOf('\nfunction createLockedCheckoutSnapshot', customerSafeLineStart);
const customerSafeLineBody = dashboard.slice(customerSafeLineStart, customerSafeLineEnd);

assert.match(customerSafeLineBody, /const lineQuantity = Number\(item\.qty \|\| item\.quantity \|\| 1\);/, 'must read the line\'s real quantity');
assert.match(customerSafeLineBody, /const extendedCost = Number\(item\.cost \|\| 0\) \* lineQuantity;/, 'must scale the per-unit cost by quantity before using it -- same fix already applied in markCartItemsSoldFromPayment');
assert.match(customerSafeLineBody, /cost_basis:extendedCost,/, 'cost_basis written to pos_sale_lines must be the quantity-scaled cost, not a bare per-unit figure');
assert.match(customerSafeLineBody, /profit:Number\(item\.price \|\| 0\) - extendedCost,/, 'profit must subtract the quantity-scaled cost from the (already-extended) price');
assert.doesNotMatch(customerSafeLineBody, /cost_basis:Number\(item\.cost \|\| 0\),\s*\n\s*profit:Number\(item\.price \|\| 0\) - Number\(item\.cost \|\| 0\),/,
  'the old per-unit-cost-as-if-extended computation must be gone');

console.log('Cart line price/quantity extension + comic profit fix contract checks passed');

// ---------------------------------------------------------------------
// Functional: reimplement both fixed formulas and verify against the
// exact real-world scenarios from the store report.
// ---------------------------------------------------------------------

// ONE-OFF modal: typing a quantity > 1 directly (never touching the +/-
// stepper) must still produce the correct extended line total.
function simulateAddSaleItemToCart(unitPrice, quantity){
  return Math.round(unitPrice * quantity * 100) / 100;
}
assert.equal(simulateAddSaleItemToCart(10, 3), 30, 'a one-off added at $10/ea x3 must show/charge $30 for the line, not $10');
assert.equal(simulateAddSaleItemToCart(4.99, 1), 4.99, 'the common qty=1 case must be unaffected (no behavior change)');

// Normal Sell modal on a quantity-grouped comic row: selling 3 of 5
// in-stock copies at $6/ea, cost $2.50/ea (comic receiving's real PRH
// 50%-of-MSRP cost) -- pos_sale_lines must show $18 revenue, $7.50 cost,
// $10.50 profit, not the old $6 revenue / $2.50 cost / $3.50 profit
// (as if only 1 copy had sold).
function simulateCustomerSafeLine(price, cost, qty){
  const lineQuantity = qty;
  const extendedCost = cost * lineQuantity;
  return { adjusted_price:price, cost_basis:extendedCost, profit:price - extendedCost };
}
const comicLine = simulateCustomerSafeLine(simulateAddSaleItemToCart(6, 3), 2.5, 3);
assert.deepEqual(comicLine, { adjusted_price:18, cost_basis:7.5, profit:10.5 },
  'selling 3 copies of a quantity-grouped comic at once must record revenue/cost/profit for all 3, not just 1');

// A one-off sold at qty 1 (the common case) must be unaffected.
const oneOffQty1 = simulateCustomerSafeLine(simulateAddSaleItemToCart(10, 1), 4, 1);
assert.deepEqual(oneOffQty1, { adjusted_price:10, cost_basis:4, profit:6 }, 'a plain qty-1 one-off must behave exactly as before');

console.log('Cart line price/quantity extension + comic profit fix functional checks passed');
