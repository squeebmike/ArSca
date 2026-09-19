import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// inventory_items.data.profit/.salePrice/.channel/.soldAt are never
// reliably written for a partial (non-depleting) sale on ANY channel --
// decrementInventoryRow/syncEbayOrdersForStore in cloudflare-worker-full.js
// only stamp those fields when an item fully sells out, by design (a
// presale/multi-quantity item must stay visibly in-stock while copies
// remain). The real, complete record of every sale -- full or partial --
// only ever lives in pos_sales/pos_sale_lines, the same ledger the
// Reports/P&L tab (aggregateReportsData) already reads. These checks guard
// that the Home "Today" tile, Sales-tab analytics cards, and Home "Recent
// Activity" feed all source their numbers from that ledger too, instead of
// the inventory-item cache that structurally cannot represent a partial sale.

assert.match(dashboard, /async function computeSalesFromLedgerSince\(sinceDate\)\{/, 'missing the shared ledger-query helper');
{
  const start = dashboard.indexOf('async function computeSalesFromLedgerSince(sinceDate){');
  const end = dashboard.indexOf('\n}', start) + 2;
  const fn = dashboard.slice(start, end);
  assert.match(fn, /sb\.from\('pos_sales'\)/, 'must query the real pos_sales table');
  assert.match(fn, /pos_sale_lines\(quantity,adjusted_price,cost_basis,profit\)/, 'must embed pos_sale_lines to get real per-line profit, not the inventory cache\'s never-written profit field');
  assert.match(fn, /\.in\('status', \['completed','succeeded'\]\)/, 'must only count sales that actually completed');
  assert.match(fn, /\.gte\('completed_at', sinceDate\.toISOString\(\)\)/, 'must be scoped by the caller-supplied date, not hardcoded to "today" only, so it can serve both the Today tile and Month figures');
}

{
  const start = dashboard.indexOf('async function computePulseData(){');
  assert.notEqual(start, -1, 'missing computePulseData');
  const end = dashboard.indexOf('\nasync function renderPulse(){', start);
  const fn = dashboard.slice(start, end);
  assert.match(fn, /const ledger = await computeSalesFromLedgerSince\(startOfToday\);/, 'Today tile must pull real numbers from the ledger');
  assert.match(fn, /grossToday = ledger\.grossToday; profitToday = ledger\.profitToday; soldTodayCount = ledger\.soldTodayCount;/, 'ledger numbers must override the inventory-cache estimate when available');
  assert.match(fn, /catch\(e\)\{ \/\* best-effort -- fall back to the inventory-cache estimate above \*\/ \}/, 'a ledger query failure must fall back to the old estimate, never leave the tile blank');
}

{
  const start = dashboard.indexOf('async function ownerAnalyticsDataWithLedger(){');
  assert.notEqual(start, -1, 'missing ownerAnalyticsDataWithLedger');
  const end = dashboard.indexOf('\nasync function renderOwnerAnalyticsPanel(){', start);
  const fn = dashboard.slice(start, end);
  assert.match(fn, /computeSalesFromLedgerSince\(startOfToday\)/, 'Sales-tab Today card must use the same ledger helper as the Home tile');
  assert.match(fn, /computeSalesFromLedgerSince\(startOfMonth\)/, 'Sales-tab Month card must also be ledger-sourced');
  assert.match(fn, /d\.revenueToday = todayLedger\.grossToday; d\.profitToday = todayLedger\.profitToday; d\.todayCount = todayLedger\.soldTodayCount;/, 'must override the today figures computed from soldData');
}
assert.match(dashboard, /async function renderOwnerAnalyticsPanel\(\)\{/, 'renderOwnerAnalyticsPanel must be async to await the ledger overlay');
assert.match(dashboard, /const d = await ownerAnalyticsDataWithLedger\(\);/, 'renderOwnerAnalyticsPanel must actually await the ledger-backed data, not the raw synchronous ownerAnalyticsData()');
assert.match(dashboard, /\$\{d\.todayCount\} sold · profit \$\{fd\$\(d\.profitToday\)\}/, 'Today Sales card must render the ledger-backed count, not d.salesToday.length (which undercounts the same way the old Today tile did)');
assert.match(dashboard, /\$\{d\.monthCount\} sold · profit \$\{fd\$\(d\.profitMonth\)\}/, 'Month Sales card must render the ledger-backed count');

{
  const start = dashboard.indexOf('function inferLedgerSaleChannel(line){');
  assert.notEqual(start, -1, 'missing inferLedgerSaleChannel');
  const end = dashboard.indexOf('\n}', start) + 2;
  const fn = dashboard.slice(start, end);
  assert.match(fn, /src\.startsWith\('ebay:'\)\)return'eBay'/, 'must recognize eBay-sourced sale lines by their source_id prefix');
  assert.match(fn, /src\.startsWith\('backlist:'\)\|\|src\.startsWith\('foc:'\)\)return'Website'/, 'must recognize backlist/FOC preorder lines as Website-channel');
}
assert.match(dashboard, /async function fetchRecentSoldLedgerEvents\(limit\)\{/, 'missing fetchRecentSoldLedgerEvents');
assert.match(dashboard, /if\(line\.category==='Shipping'\)continue;/, 'must skip the synthetic shipping fee line -- it is not a product sale');

{
  const start = dashboard.indexOf('async function renderFeed(){');
  assert.notEqual(start, -1, 'renderFeed must be async to await the ledger fetch');
  const end = dashboard.indexOf('\nfunction renderChannels(){', start);
  const fn = dashboard.slice(start, end);
  assert.match(fn, /i\.status!=='sold'\)\.map\(i=>\(\{type:'add'/, 'the "added" side of the feed still comes from the inventory cache -- that part was never broken');
  assert.match(fn, /await fetchRecentSoldLedgerEvents\(20\)/, 'the "sold" side must come from the real ledger so a partial (non-depleting) sale on any channel still shows up here, not just full depletions');
  assert.match(fn, /catch\(e\)\{[\s\S]{0,260}i\.status==='sold'\)\.map/, 'a ledger fetch failure must fall back to the old inventory-cache view rather than showing an empty feed');
}

console.log('Home/Sales-tab real-ledger sourcing checks passed');
