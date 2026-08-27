import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store report: a real eBay order auto-synced via /ebay/orders/sync recorded
// profit as exactly salePrice-cost, with no eBay fee held back at all --
// /ebay/orders/sync's own fee math (EBAY_DEFAULT_FEE_PCT, kept in sync with
// EXTERNAL_SALE_FEE_DEFAULTS.eBay here) checks out correctly on inspection
// and has been live since before FOC eBay presale listings existed, and the
// store confirmed this was an automatic sync, not a manually-recorded sale
// -- the exact original cause could not be reproduced from the code alone.
// Rather than leave the store stuck with a wrong number, this targets the
// SYMPTOM directly: any sold eBay-channel item whose profit exactly equals
// the fee-less figure gets its profit recomputed with the standard fee.
assert.match(dashboard, /function itemsWithFeelessEbayProfit\(items=all\)\{/, 'missing itemsWithFeelessEbayProfit');
assert.match(dashboard,
  /return \(items \|\| \[\]\)\.filter\(i => i\.status === 'sold' && i\.channel === 'eBay' && Number\(i\.salePrice \|\| 0\) > 0\s*\n\s*&& Math\.abs\(Number\(i\.profit \|\| 0\) - \(Number\(i\.salePrice \|\| 0\) - Number\(i\.cost \|\| 0\)\)\) < 0\.01\);/,
  'itemsWithFeelessEbayProfit must only flag sold eBay-channel items whose stored profit exactly matches the fee-less salePrice-cost figure');

assert.match(dashboard, /async function backfillEbayProfitFees\(\)\{/, 'missing backfillEbayProfitFees');
{
  const start = dashboard.indexOf('async function backfillEbayProfitFees(){');
  const end = dashboard.indexOf('\n}', start) + 2;
  const fn = dashboard.slice(start, end);
  assert.match(fn, /if\(!matches\.length\)\{ toast_dash\('No eBay sales found with a missing fee deduction'\); return; \}/,
    'backfill must no-op cleanly (with feedback) when nothing needs fixing');
  assert.match(fn, /const pct = EXTERNAL_SALE_FEE_DEFAULTS\.eBay\.pct;/, 'must reuse the same eBay fee default the manual external-sale flow and the Worker both use, not a duplicated constant');
  assert.match(fn, /if\(!confirm\(/, 'must ask for confirmation before mutating every matching sold row');
  assert.match(fn, /const fee = Math\.round\(Number\(item\.salePrice \|\| 0\) \* \(pct \/ 100\) \* 100\) \/ 100;/, 'fee must be computed the same way the Worker\'s own fee math rounds it');
  assert.match(fn, /const profit = Number\(item\.salePrice \|\| 0\) - Number\(item\.cost \|\| 0\) - fee;/, 'profit must be salePrice minus cost minus the recomputed fee');
  assert.match(fn, /await saveInventoryEdit\(item, \{ profit \}\);/, 'backfill must reuse the existing saveInventoryEdit save path, not a bespoke write');
}

// profit was previously not a writable field through saveInventoryEdit's
// built_in path at all (builtInDataFromItem only ever set it once, at
// mapBuiltInItem's initial read, and silently preserved-but-never-updated
// it afterward via the ...item.raw spread) -- must be a real passthrough
// field now, or the backfill above has nothing to actually persist to.
assert.match(dashboard, /\['profit',0,'num'\],/, 'profit must be added to BUILT_IN_ITEM_SIMPLE_FIELDS so saveInventoryEdit can actually persist a recomputed value');

// Health panel: a dedicated card runs the backfill directly, same pattern
// as the existing Print Run In Name card.
assert.match(dashboard, /ebayProfitMissingFee:itemsWithFeelessEbayProfit\(items\)\.length,/, 'inventoryHealthSummary must surface the fee-missing eBay sale count');
assert.match(dashboard, /\['ebay_fee_missing','eBay Fee Missing',h\.ebayProfitMissingFee,'tap to recompute profit','backfillEbayProfitFees\(\)'\],/,
  'the inventory health grid must include an eBay Fee Missing card wired to run the backfill');

console.log('eBay profit fee-backfill contract checks passed');

// ── Functional: only a sold eBay-channel item with an exactly fee-less
// profit gets flagged -- never a non-eBay sale, an in-stock item, or one
// that already had a fee deducted ──
{
  const fnStart = dashboard.indexOf("function itemsWithFeelessEbayProfit(items=all){");
  const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
  const itemsWithFeelessEbayProfit = new Function(dashboard.slice(fnStart, fnEnd) + '\nreturn itemsWithFeelessEbayProfit;')();

  const feelessEbaySale = { id:'a', status:'sold', channel:'eBay', salePrice:4.99, cost:2.50, profit:2.49 };
  const properlyFeedEbaySale = { id:'b', status:'sold', channel:'eBay', salePrice:4.99, cost:2.50, profit:1.83 };
  const feelessButWhatnot = { id:'c', status:'sold', channel:'Whatnot', salePrice:4.99, cost:2.50, profit:2.49 };
  const feelessButInStock = { id:'d', status:'in_stock', channel:'eBay', salePrice:4.99, cost:2.50, profit:2.49 };
  const feelessNoSalePrice = { id:'e', status:'sold', channel:'eBay', salePrice:0, cost:0, profit:0 };

  const result = itemsWithFeelessEbayProfit([feelessEbaySale, properlyFeedEbaySale, feelessButWhatnot, feelessButInStock, feelessNoSalePrice]);
  assert.deepEqual(result.map(i => i.id), ['a'], 'only a sold eBay-channel item with a priced sale and an exactly fee-less stored profit may be flagged');
}

console.log('eBay profit fee-backfill functional checks passed');
