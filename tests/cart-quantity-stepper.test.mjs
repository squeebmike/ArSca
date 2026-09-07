import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: quantity stepper exists and is gated to real unified-cart-model lines ──
assert.match(dashboard, /const qtyAdjustable = i\.unitPrice != null;/, 'cart line render must gate the qty stepper to lines that carry a real per-unit price');
assert.match(dashboard, /adjustCartLineQuantity\(\$\{idx\},-1\)/, 'cart line must render a decrement control');
assert.match(dashboard, /adjustCartLineQuantity\(\$\{idx\},1\)/, 'cart line must render an increment control');

// ── Contract: adjustCartLineQuantity recomputes price from unitPrice, and stock-checks inventory-linked lines ──
// Store report: bumping quantity after manually editing a line's price
// (editCartLinePrice, the "Edit Price" button) silently threw the edit
// away -- it always recomputed straight from item.unitPrice, which
// editCartLinePrice never touches. Once a manual edit is on record
// (adjustmentReason set), the per-unit rate the edit implies (price at the
// OLD quantity, divided by that quantity) must be preserved instead.
assert.match(dashboard, /async function adjustCartLineQuantity\(idx, delta\)\{[\s\S]*?item\.quantity = nextQty;[\s\S]*?item\.qty = nextQty;[\s\S]*?const effectiveUnitPrice = item\.adjustmentReason\s*\n\s*\? Number\(item\.price \|\| 0\) \/ currentQty\s*\n\s*: Number\(item\.unitPrice \|\| 0\);[\s\S]*?item\.price = Math\.round\(effectiveUnitPrice \* nextQty \* 100\) \/ 100;[\s\S]*?\n\}/,
  'adjustCartLineQuantity must preserve a manually-edited price\'s per-unit rate across a quantity change, not always recompute from the original unitPrice');
assert.match(dashboard, /if\(delta > 0 && nextQty \+ otherLinesQty > available\)\{/, 'adjustCartLineQuantity must refuse to increment past available stock');

// ── Contract: profit calc no longer treats per-unit cost as if it were the whole line's cost ──
assert.match(dashboard, /const totalCost = Number\(cartItem\.cost \?\? inv\?\.cost \?\? 0\) \* quantitySold;/, 'markCartItemsSoldFromPayment must scale cost by quantitySold before computing profit');
assert.match(dashboard, /'profit':salePrice - totalCost,/, 'fieldData.profit must use the quantity-scaled total cost');
assert.match(dashboard, /inv\.profit=salePrice - totalCost;/, 'inv.profit must use the quantity-scaled total cost');

console.log('Cart quantity stepper contract checks passed');

// ── Functional: reimplement the exact stock-check + price-recompute rules and verify them ──
function computeAdjustment(item, otherLinesQty, available, delta){
  const currentQty = Math.max(1, Number(item.quantity || item.qty || 1));
  const nextQty = currentQty + delta;
  if(nextQty < 1) return null;
  if(delta > 0 && nextQty + otherLinesQty > available) return null;
  const effectiveUnitPrice = item.adjustmentReason
    ? Number(item.price || 0) / currentQty
    : Number(item.unitPrice || 0);
  return { quantity:nextQty, qty:nextQty, price:Math.round(effectiveUnitPrice * nextQty * 100) / 100 };
}

// Selling a 3rd toploader when 5 are in stock and 0 already in other lines must succeed.
const toploader = { unitPrice:2.5, quantity:1, price:2.5 };
const afterFirstBump = computeAdjustment(toploader, 0, 5, 1);
assert.deepEqual(afterFirstBump, { quantity:2, qty:2, price:5 }, 'bumping qty 1->2 must double the line price from unitPrice');
const afterSecondBump = computeAdjustment({ ...toploader, ...afterFirstBump }, 0, 5, 1);
assert.deepEqual(afterSecondBump, { quantity:3, qty:3, price:7.5 }, 'bumping qty 2->3 must scale price to 3x unitPrice');

// Refuse to oversell: only 2 left in stock, already 1 in this line -- can't go to 2 if another line already holds 1 (total would be 3 > 2 available).
const overStock = computeAdjustment({ unitPrice:2.5, quantity:1 }, 1, 2, 1);
assert.equal(overStock, null, 'must refuse to increment past available stock once other cart lines are counted');

// Never allow going below quantity 1 via the decrement button.
const belowOne = computeAdjustment({ unitPrice:2.5, quantity:1 }, 0, 5, -1);
assert.equal(belowOne, null, 'must refuse to decrement a line below quantity 1');

// Store report: a card added at $10 (unitPrice), manually re-priced to $15
// via Edit Price, then bumped to qty 2 -- must charge $30 (the $15/unit the
// edit implied), never snap back to $20 (2 x the original $10 unitPrice).
const editedCard = { unitPrice:10, quantity:1, price:15, adjustmentReason:'Trade-in credit' };
const afterEditThenBump = computeAdjustment(editedCard, 0, 5, 1);
assert.deepEqual(afterEditThenBump, { quantity:2, qty:2, price:30 }, 'a manually-edited price must scale by its own per-unit rate on qty bump, not revert to the original unitPrice');

// The edit must keep holding across repeated quantity changes, not just the
// first bump immediately after the edit.
const afterSecondBumpEdited = computeAdjustment({ ...editedCard, ...afterEditThenBump }, 0, 5, 1);
assert.deepEqual(afterSecondBumpEdited, { quantity:3, qty:3, price:45 }, 'the edited per-unit rate must keep applying across further quantity changes');

// Decrementing an edited line must scale down by the same edited rate, not the original unitPrice.
const afterDecrementEdited = computeAdjustment({ ...editedCard, quantity:2, price:30 }, 0, 5, -1);
assert.deepEqual(afterDecrementEdited, { quantity:1, qty:1, price:15 }, 'decrementing an edited line must scale down using the edited per-unit rate too');

// A line with no manual edit at all must behave exactly as before -- pure
// unitPrice x quantity, with no regression from this fix.
const unedited = computeAdjustment({ unitPrice:2.5, quantity:1, price:2.5 }, 0, 5, 1);
assert.deepEqual(unedited, { quantity:2, qty:2, price:5 }, 'a line with no adjustmentReason must still use the plain unitPrice x quantity calc');

// Profit must scale cost by quantitySold, matching markCartItemsSoldFromPayment's fix.
function computeProfit(cartItem, inv){
  const salePrice = Number(cartItem.price || 0);
  const quantitySold = Math.max(1, Number(cartItem.quantity || 1));
  const totalCost = Number(cartItem.cost ?? inv?.cost ?? 0) * quantitySold;
  return salePrice - totalCost;
}
assert.equal(computeProfit({ price:7.5, cost:1, quantity:3 }, null), 4.5, 'profit on a 3-unit line must subtract cost x3, not cost x1');

console.log('Cart quantity stepper functional checks passed');
