import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Restock checklist must suggest a real reorder qty, not just flag items ──
// The checklist used to just list items sold >=2x with no stock -- staff had
// to guess how much to reorder by hand. It must now suggest a qty based on
// that item's own recent sales pace, editable before generating a PO.

assert.match(dashboard, /onclick="generateRestockPurchaseOrder\(\)">📋 Generate PO<\/a>/, 'missing the Generate PO action on the restock checklist');
assert.match(dashboard, /function restockSuggestedQty\(name, count, nameSalesSortedDesc\)\{/, 'missing restockSuggestedQty');
assert.match(dashboard, /function generateRestockPurchaseOrder\(\)\{/, 'missing generateRestockPurchaseOrder');
assert.match(dashboard, /class="rs-po-check" style="width:14px;height:14px" checked/, 'restock rows must default to checked (included in the PO) so staff opts OUT, not in');
assert.match(dashboard, /class="rs-po-qty" min="1" value="\$\{suggestion\.qty\}"/, 'each restock row must expose an editable suggested-qty input');

console.log('Restock PO contract checks passed');

// ── generateRestockPurchaseOrder must only include checked rows and respect edited qty ──
assert.match(dashboard, /row\.querySelector\('\.rs-po-check'\)\?\.checked/, 'unchecked restock rows must be excluded from the generated PO');
assert.match(dashboard, /parseInt\(row\.querySelector\('\.rs-po-qty'\)\?\.value, 10\) \|\| 1/, 'the PO must use the (possibly staff-edited) qty input value, not the original suggestion silently');
assert.match(dashboard, /No recent cost on file for these items -- fill in unit costs by hand before sending\./, 'a PO with no known costs anywhere must say so honestly, not print a fabricated total');

console.log('Restock PO generation logic checks passed');

// ── Functional check: restockSuggestedQty ───────────────────────────
{
  const src = dashboard.match(/function restockSuggestedQty\(name, count, nameSalesSortedDesc\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(src, 'could not extract restockSuggestedQty for functional testing');
  const { restockSuggestedQty } = new Function(`${src}\nreturn { restockSuggestedQty };`)();

  // Sold 4 times over the last 2 weeks (fast mover) -- suggests roughly 2/wk * 4wk = 8.
  const fastSales = [
    { soldAt: new Date(Date.now() - 1 * 86400000).toISOString(), cost: 10 },
    { soldAt: new Date(Date.now() - 4 * 86400000).toISOString(), cost: 10 },
    { soldAt: new Date(Date.now() - 9 * 86400000).toISOString(), cost: 8 },
    { soldAt: new Date(Date.now() - 13 * 86400000).toISOString(), cost: 8 },
  ];
  const fast = restockSuggestedQty('Fast Mover', 4, fastSales);
  assert.ok(fast.qty >= 6 && fast.qty <= 10, `fast-selling item should suggest a meaningful reorder qty, got ${fast.qty}`);
  assert.equal(fast.unitCost, 10, 'unit cost must come from the most recent sale that actually has a cost on file');

  // Sold twice, months apart (slow mover) -- suggestion must not be absurd.
  const slowSales = [
    { soldAt: new Date(Date.now() - 5 * 604800000).toISOString(), cost: 0 },
    { soldAt: new Date(Date.now() - 20 * 604800000).toISOString(), cost: 0 },
  ];
  const slow = restockSuggestedQty('Slow Mover', 2, slowSales);
  assert.ok(slow.qty >= 1 && slow.qty <= 3, `slow-selling item should suggest a small reorder qty, got ${slow.qty}`);
  assert.equal(slow.unitCost, 0, 'unit cost must be 0/unknown when no sale on file has a cost, not fabricated');

  // A single burst of sales must never suggest an absurd quantity (capped at 20).
  const burstSales = Array.from({ length: 20 }, (_, i) => ({ soldAt: new Date(Date.now() - i * 3600000).toISOString(), cost: 5 }));
  const burst = restockSuggestedQty('Burst Item', 20, burstSales);
  assert.ok(burst.qty <= 20, `reorder suggestion must be capped, got ${burst.qty}`);
}

console.log('restockSuggestedQty functional checks passed');
