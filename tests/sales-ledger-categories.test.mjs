import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const fnSource = name => { let s = dashboard.indexOf(`function ${name}(`); if (dashboard.slice(s - 6, s) === 'async ') s -= 6; assert.notEqual(s, -1, `missing ${name}`); return dashboard.slice(s, dashboard.indexOf('\n}', s) + 2); };

// --- canonicalSaleCategory: one sports category, not "Sports" + "Sports Card"
const STANDARD_INVENTORY_CATEGORIES = JSON.parse(dashboard.match(/const STANDARD_INVENTORY_CATEGORIES = (\[[^\]]+\]);/)[1].replace(/'/g, '"'));
const canonicalSaleCategory = new Function('STANDARD_INVENTORY_CATEGORIES', `${fnSource('canonicalSaleCategory')}; return canonicalSaleCategory;`)(STANDARD_INVENTORY_CATEGORIES);
for (const v of ['Sports Card', 'Sports Cards', 'sports', 'Baseball']) assert.equal(canonicalSaleCategory(v), 'Sports', v);
assert.equal(canonicalSaleCategory('Comic Preorder'), 'Comic', 'website preorder sales count as Comic');
assert.equal(canonicalSaleCategory('Pokemon TCG'), 'Pokemon TCG');
assert.equal(canonicalSaleCategory('Pokémon'), 'Pokemon TCG');
assert.equal(canonicalSaleCategory('Gift Card'), 'Gift Card', 'unknown categories pass through unchanged');
assert.equal(canonicalSaleCategory(''), 'Other');

// The one-off popup must only offer real inventory category names.
const oneOffSelect = dashboard.match(/<select id="oneoff-category">([\s\S]*?)<\/select>/)[1];
const offered = [...oneOffSelect.matchAll(/value="([^"]*)"/g)].map(m => m[1]).filter(Boolean);
for (const v of offered) assert.ok(v === 'Other' || STANDARD_INVENTORY_CATEGORIES.includes(v), `one-off category "${v}" is not an inventory category -- it would split that category's profit`);
// And every sale line is normalized when written, whatever path it came from.
assert.match(dashboard, /category:canonicalSaleCategory\(item\.categoryName \|\| item\.category\),/);
assert.match(dashboard, /getCategory\(line\.category \? canonicalSaleCategory\(line\.category\) : 'Uncategorized'\)/, 'Reports must group by the normalized category too');
console.log('Sale category normalization checks passed');

// --- Sales list + Profit by Category read the real ledger ----------------------
const load = fnSource('loadLedgerSoldRows');
assert.match(load, /sb\.from\('pos_sales'\)/);
assert.match(load, /pos_sale_lines\(id,title,category,quantity,adjusted_price,cost_basis,profit,item_id\)/);
assert.match(load, /\.in\('status', \['completed','succeeded'\]\)/, 'voided/pending sales must not show');
assert.match(fnSource('renderSoldTable'), /const sourceRows=ledgerSoldRows \|\| soldData\.concat\(getUnlinkedTransactionRows\(soldData\)\);/, 'Sales list must use the ledger, falling back to the local merge only when it is unavailable');
assert.match(fnSource('renderProfitMeter'), /const sol=ledgerSoldRows \|\| /);
assert.match(fnSource('renderProfitMeter'), /canonicalSaleCategory\(i\.category\)===c/);
assert.match(fnSource('renderAll'), /markLedgerSoldRowsStale\(\);/, 'the ledger copy must refresh after sales/voids');

// A ledger line maps to exactly one row, with the price it actually sold for.
const mapRows = new Function('canonicalSaleCategory', 'all', 'getSupabaseClient', 'getActiveStoreId', 'getAccountContext', `${load}; return loadLedgerSoldRows;`);
const sales = [{ id:'sale-1', completed_at:'2026-09-26T19:55:29Z', pos_payments:[{ method:'Cash' }], pos_sale_lines:[{ id:'l1', title:'Lazaro Montes #BPA-LM', category:'Sports', quantity:1, adjusted_price:'75.00', cost_basis:'15.00', profit:'60.00', item_id:'inv-1' }] },
  { id:'sale-2', completed_at:'2026-09-26T18:00:00Z', pos_payments:[], pos_sale_lines:[{ id:'l2', title:'Kirby', category:'Sports Card', quantity:2, adjusted_price:'100.00', cost_basis:'20.00', profit:'80.00', item_id:'' }] }];
const chain = { select(){ return chain; }, eq(){ return chain; }, in(){ return chain; }, order(){ return chain; }, limit(){ return Promise.resolve({ data:sales, error:null }); } };
const rows = await mapRows(canonicalSaleCategory, [{ id:'inv-1', set:'2023 Bowman Inception Autograph', category:'Sports' }], () => ({ from:() => chain }), () => 'store-1', () => ({ isDemo:false }))();
assert.equal(rows.length, 2);
assert.equal(rows[0].salePrice, 75, 'the real sold price, not the stale $22 list price');
assert.equal(rows[0].set, '2023 Bowman Inception Autograph', 'set details come from the linked inventory item');
assert.equal(rows[0].channel, 'Cash');
assert.equal(rows[1].category, 'Sports', 'old one-off lines saved as "Sports Card" count as Sports');
assert.equal(rows[1].cost, 10, 'cost is per-unit (renderSoldTable multiplies by quantity)');
console.log('Sales ledger checks passed');
