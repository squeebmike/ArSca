import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: an empty, unnamed cart is never indexed, and gets actively purged if already there ──
assert.match(dashboard, /const isMeaningful = entry\.itemCount > 0 \|\| !!cart\.customerName;/, 'upsertSaleCartIndexEntry must only index carts that have items or a customer name');
assert.match(dashboard, /if\(!isMeaningful\)\{ await removeSaleCartFromIndex\(entry\.id\); return; \}/, 'an empty/unnamed cart must be actively removed from the shared index instead of upserted, self-healing existing ghosts');

console.log('Empty-cart-not-indexed contract checks passed');

// ── Functional: reimplement the exact meaningful-cart rule and verify it ──
function isMeaningfulCart(cart){
  const itemCount = (cart.items || []).length;
  return itemCount > 0 || !!cart.customerName;
}
assert.equal(isMeaningfulCart({ items:[], customerName:'' }), false, 'a brand-new empty unnamed cart (e.g. from + NEW CART) must not be indexed');
assert.equal(isMeaningfulCart({ items:[{ id:'x' }], customerName:'' }), true, 'a cart with at least one item must be indexed even with no name yet');
assert.equal(isMeaningfulCart({ items:[], customerName:'Jane' }), true, 'a named-but-still-empty cart (staff typed the customer name first) must be indexed');

console.log('Empty-cart-not-indexed functional checks passed');
