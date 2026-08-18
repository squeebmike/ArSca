import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Bug: the Sold Items table showed sale price as the LINE TOTAL (already
// extended across every unit sold) next to cost as the raw PER-UNIT basis,
// so a multi-unit line's numbers looked like they didn't add up to the
// profit column shown (which correctly used total cost internally). The fix
// extends the displayed cost by quantity too, so all three numbers agree. ──

assert.match(dashboard, /const qty=Math\.max\(1,Number\(i\.quantity \?\? i\.soldQuantity \?\? 1\)\);\s*\n\s*const totalCost=Number\(i\.cost\|\|0\)\*qty;/, 'renderSoldTable must extend the per-unit cost by quantity before displaying it, matching how salePrice is already extended');
assert.match(dashboard, /const pft=Number\(i\.profit \|\| \(\(i\.salePrice \|\| 0\) - totalCost\) \|\| 0\);/, 'the profit fallback calculation must also use the quantity-extended total cost, not the raw per-unit cost');
assert.match(dashboard, /<td class="pp pd">\$\{totalCost>0\?fd\$\(totalCost\):'—'\}<\/td>/, 'the displayed COST column must show the extended total cost, not the raw per-unit i.cost');
assert.ok(!/<td class="pp pd">\$\{i\.cost>0\?fd\$\(i\.cost\):'—'\}<\/td>/.test(dashboard), 'the old per-unit-only cost display must be gone from renderSoldTable');

console.log('Sold table total-cost display contract checks passed');

// ── Functional: extract the row-building logic and confirm a multi-unit
// line's three displayed numbers actually reconcile (the exact user-facing
// symptom: "$14 sale, $10 cost, but profit shows -$6") ──
{
  const src = dashboard.match(/tb\.innerHTML=rows\.slice\(0,100\)\.map\(i=>\{[\s\S]*?\n\s*\}\)\.join\(''\);/)?.[0];
  assert.ok(src, 'could not extract the renderSoldTable row-mapping logic for functional testing');
  const fd$ = (n) => '$' + Number(n).toFixed(2);
  const isVoidableSaleId = () => false;
  const tb = { innerHTML: '' };
  const rows = [
    // 2 packs sold together for a $14 total line price, $10 PER-UNIT cost
    // (i.e. $20 real total cost) -- a genuine $6 loss on the line.
    { name:'Packs', category:'Pokemon TCG', categoryName:'Pokemon TCG', salePrice:14, cost:10, quantity:2, profit:0, channel:'card', soldAt:'2026-08-15T00:00:00Z', saleId:'' },
    // A plain single-unit sale for comparison -- must be unaffected.
    { name:'Single Pack', category:'Pokemon TCG', categoryName:'Pokemon TCG', salePrice:8, cost:5, quantity:1, profit:0, channel:'cash', soldAt:'2026-08-15T00:00:00Z', saleId:'' },
  ];
  new Function('tb', 'rows', 'fd$', 'isVoidableSaleId', src)(tb, rows, fd$, isVoidableSaleId);

  assert.ok(tb.innerHTML.includes('$14.00'), 'sale price must render as the line total, unchanged');
  assert.ok(tb.innerHTML.includes('$20.00'), 'displayed cost for the 2-unit line must be the extended total ($10 x 2 = $20), not the raw per-unit $10');
  assert.ok(tb.innerHTML.includes('$-6.00'), 'profit must correctly show a $6 loss ($14 sale - $20 real total cost) -- fd$() puts the sign before the digits, e.g. "$-6.00"');
  assert.ok(tb.innerHTML.includes('$8.00') && tb.innerHTML.includes('$5.00') && tb.innerHTML.includes('+$3.00'), 'a single-unit line must be unaffected: $8 sale - $5 cost = +$3 profit');
}

console.log('Sold table total-cost functional checks passed');

// ── Contract: a bulk way to clear every FAILED sync-queue item exists, for
// when a whole class of jobs will never succeed (e.g. a third-party plan
// limit) and clicking REMOVE on each one individually isn't realistic once
// the queue has piled up to dozens or hundreds of entries ──
assert.match(dashboard, /function clearFailedSyncQueue\(\)\{/, 'missing clearFailedSyncQueue');
assert.match(dashboard, /saveSyncQueue\(getSyncQueue\(\)\.filter\(x => x\.status !== 'failed'\)\);/, 'clearFailedSyncQueue must remove only failed items, leaving pending/done items untouched');
const clearFailedButtonOccurrences = (dashboard.match(/<button class="hbtn danger" onclick="clearFailedSyncQueue\(\)">CLEAR FAILED<\/button>/g) || []).length;
assert.equal(clearFailedButtonOccurrences, 2, 'CLEAR FAILED must be wired into both sync-queue panel renderers (ensureSyncQueuePanel and the inventory sync panel), or one of them silently keeps no bulk-clear option');

console.log('Bulk clear-failed sync queue contract checks passed');
