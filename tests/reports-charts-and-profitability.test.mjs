import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync('dashboard.html', 'utf8');

// Financials v2: category/product profitability, top sellers, trends
// charts, payment-method mix, and a WA tax note, added on top of the
// Reports tab shipped in #354. Grounded in what the underlying Supabase
// data (pos_sales/pos_sale_lines/pos_payments) can actually support --
// see the plan's rationale for scoping "channel mix" down to "payment
// method mix" (eBay/Whatnot/storefront sales never write to these tables,
// so a real channel-mix chart from this data source would be misleading)
// and "top & slow movers" down to "top sellers" (full dead-stock detection
// needs a different data source than completed sales).

// 1. Data fetch: title/category added to the sale_lines select, and a new
// batched pos_payments fetch alongside it.
{
  const fnStart = html.indexOf('async function runReportsQuery(');
  const fnEnd = html.indexOf('\nfunction aggregateReportsData', fnStart);
  const fnBody = html.slice(fnStart, fnEnd);
  assert.match(fnBody, /\.select\('sale_id,title,category,adjusted_price,cost_basis,profit,taxable'\)/,
    'pos_sale_lines select must include title and category for the profitability/top-sellers breakdowns');
  assert.match(fnBody, /sb\.from\('pos_payments'\)\.select\('sale_id,method,amount'\)/,
    'must query pos_payments for the payment-method-mix section');
  assert.match(fnBody, /Promise\.all\(\[/, 'sale_lines and pos_payments should be fetched in parallel per chunk, matching the syncSharedShowTransactions dual-fetch pattern');
}

// 2. Aggregation: categoryStats/itemStats/paymentStats, and paymentStats
// must be normalized through normalizeTenderType (not raw pos_payments.method
// strings, which fragment -- e.g. 'card' vs 'Stripe Card').
{
  const fnStart = html.indexOf('function aggregateReportsData(');
  const fnEnd = html.indexOf('\n// Shared hand-rolled bar-chart', fnStart);
  const fnBody = html.slice(fnStart, fnEnd);
  assert.match(fnBody, /const c = getCategory\(line\.category \|\| 'Uncategorized'\);/, 'must aggregate by category');
  assert.match(fnBody, /const it = getItem\(line\.title \|\| 'Untitled'\);/, 'must aggregate by item title (not item_id -- inventory row ids are one-off and fragment repeat sales of the same product)');
  assert.doesNotMatch(fnBody, /getItem\(line\.item_id/, 'must not group top-sellers by item_id');
  assert.match(fnBody, /const key = normalizeTenderType\(pmt\.method\);/, 'payment aggregation must run through normalizeTenderType to avoid method-string fragmentation');
  assert.match(fnBody, /return \{ periods:periodList, totals, preFixRange, categoryList, topByRevenue, topByProfit, paymentList \};/,
    'the new breakdowns must be returned so exports and re-renders can reach them');
}

// 3. No misleading "channel mix" (eBay/Whatnot/storefront) claim anywhere
// in the Reports block -- those sales don't flow through pos_sales/
// pos_payments at all, so a chart claiming to show them would be wrong.
{
  const reportsStart = html.indexOf('// ===== REPORTS (sales tax owed');
  const reportsEnd = html.indexOf('\nfunction inventoryEmptySearchState', reportsStart);
  const reportsBlock = html.slice(reportsStart, reportsEnd);
  assert.doesNotMatch(reportsBlock, /CHANNEL MIX/i, 'must not claim a channel-mix chart -- pos_sales/pos_payments only ever contain in-person POS sales');
  assert.match(reportsBlock, /eBay, Whatnot, and storefront\/FOC preorder sales aren't included here/,
    'must explicitly disclose that other sales channels are not represented in the payment breakdown');
}

// 4. New UI sections actually render.
assert.match(html, /TOP SELLERS BY REVENUE/, 'top sellers by revenue section must exist');
assert.match(html, /TOP SELLERS BY PROFIT/, 'top sellers by profit section must exist');
assert.match(html, /CATEGORY \/ PRODUCT PROFITABILITY/, 'category profitability section must exist');
assert.match(html, /PROFIT BY CATEGORY/, 'category profit chart must exist');
assert.match(html, /PAYMENT METHOD MIX/, 'payment method mix section must exist');
assert.match(html, /Washington tax filing:/, 'WA-specific tax note must exist');
assert.match(html, /B&amp;O\)/, 'WA note must reference B&O tax as a separate, uncalculated figure');

// 5. reportsBarRows is the one shared chart-row builder -- reused by every
// new chart section, not a new one-off per section.
{
  const usages = html.match(/reportsBarRows\(/g) || [];
  assert.ok(usages.length >= 5, `reportsBarRows should be reused across all new chart sections (trends x2, top sellers x2, category, payment mix) -- found ${usages.length} usages`);
}

// 6. Category CSV export exists and is wired to a button.
assert.match(html, /function exportCategoryBreakdownCSV\(\)\{/, 'exportCategoryBreakdownCSV must exist');
assert.match(html, /onclick="exportCategoryBreakdownCSV\(\)">EXPORT CATEGORY BREAKDOWN CSV</, 'must be wired to a button in the controls panel');
{
  const fnStart = html.indexOf('function exportCategoryBreakdownCSV(');
  const fnEnd = html.indexOf('\n}', fnStart) + 2;
  const fnBody = html.slice(fnStart, fnEnd);
  assert.match(fnBody, /toast_dash\('Run a report first'\)/, 'must guard against exporting before any report has run, same as exportReportsCSV');
  assert.match(fnBody, /downloadCSV\(`mana-pocket-category-breakdown-/, 'must use the shared downloadCSV helper with a distinct filename from the period export');
}

console.log('Financials v2 (charts, profitability, payment mix, WA tax note) contract checks passed');
