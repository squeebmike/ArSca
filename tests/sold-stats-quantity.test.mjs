import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: quantity is written through the whole sold-tracking chain, not dropped ──
assert.match(dashboard, /items:bundle\.saleLines\.map\(l => \(\{ name:l\.title, price:l\.adjusted_price, cost:l\.cost_basis, category:l\.category, soldAt:paidAt, shopId:l\.item_id\|\|'', sourceType:l\.source_type\|\|'inventory', quantity:Number\(l\.quantity\|\|1\) \}\)\)/, 'finalizeCompletedCheckout must write quantity into the pos_transactions log, not drop it');
assert.match(dashboard, /const quantity = Math\.max\(1, Number\(i\.quantity \|\| i\.qty \|\| 1\)\);\s*\n\s*const cost = Number\(i\.cost \|\| 0\);\s*\n\s*const totalCost = cost \* quantity;/, 'transactionSoldRows must scale per-unit cost by quantity before computing profit');
assert.match(dashboard, /quantity,\s*\n\s*salePrice,/, 'transactionSoldRows must include quantity in its returned row shape');
assert.match(dashboard, /inv\.soldQuantity=quantitySold;/, 'markCartItemsSoldFromPayment must record how many units this sale event moved on the inventory row itself');

// ── Contract: the "N sold" stats sum quantity instead of counting rows ──
assert.match(dashboard, /const soldUnits=sol\.reduce\(\(a,i\)=>a\+Number\(i\.soldQuantity \?\? i\.quantity \?\? 1\),0\);/, 'renderStats must sum sold units, not count sale rows');
assert.match(dashboard, /document\.getElementById\('s3b'\)\.textContent=soldUnits\+' sold · ROI '\+roi\.toFixed\(0\)\+'%';/, 's3b must display summed sold units');
assert.match(dashboard, /document\.getElementById\('s4'\)\.textContent=soldUnits;/, 's4 (the Items Sold home stat) must display summed sold units, not sol.length');
assert.match(dashboard, /const totalItems = dayTx\.reduce\(\(a,t\)=>a\+\(t\.items\|\|\[\]\)\.reduce\(\(s,i\)=>s\+Number\(i\.quantity\|\|1\),0\),0\);/, 'the EOD report Items Sold total must sum quantity across transaction items, not count them');

console.log('Sold-stats quantity contract checks passed');

// ── Functional: 3 White Flare bundles sold in one line must count as 3, not 1 ──
function reimplementedTransactionSoldRow(i){
  const salePrice = Number(i.adjustedPrice ?? i.price ?? 0);
  const quantity = Math.max(1, Number(i.quantity || i.qty || 1));
  const cost = Number(i.cost || 0);
  const totalCost = cost * quantity;
  return { salePrice, quantity, cost, profit: salePrice - totalCost };
}

// One cart line: 3 White Flare bundles ($20/unit, no discount) sold as a single quantity-3 line.
const row = reimplementedTransactionSoldRow({ price: 60, cost: 12, quantity: 3 });
assert.equal(row.quantity, 3, 'a single multi-unit transaction line must report quantity 3, not default to 1');
assert.equal(row.profit, 24, 'profit must subtract cost-per-unit x3 (36), not cost-per-unit x1 (12), from the $60 line total');

function sumSoldUnits(rows){
  return rows.reduce((a,i)=>a+Number(i.soldQuantity ?? i.quantity ?? 1),0);
}
assert.equal(sumSoldUnits([row]), 3, 'the sold-units total for this one transaction must be 3, matching what was actually sold');
assert.equal(sumSoldUnits([{ quantity: undefined }]), 1, 'a legacy row with no quantity field at all must still default to counting as 1, not 0 or NaN');

console.log('Sold-stats quantity functional checks passed');
