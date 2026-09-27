import assert from 'node:assert/strict';
import fs from 'node:fs';
import { customerProfile, searchInventory, itemProfile, phoneKey } from '../scripts/database-explorer.mjs';

const STORE = 'store-1';
const CUST = '9a802be7-bdf9-45ca-b2b2-28f513929b8e', USER = 'f9b30dd6-cef6-411e-b20a-620d86d38daa';
const ITEM = '06c9a68b-a797-4468-8d6f-2a5371cab57f', SKU = '11111111-2222-3333-4444-555555555555';
const tables = {
  customers: [{ id:CUST, store_id:STORE, name:'Sean', email:'sean@example.com', phone:'13605350308', linked_user_id:USER, loyalty_points_balance:102, trade_credit_balance:0, created_at:'2026-08-01' }],
  loyalty_ledger: [{ id:'l1', customer_id:CUST, points:102, reason:'web_order', balance_after:102, sale_id:'foc-1', created_at:'2026-09-26' }],
  pos_sales: [
    { id:'foc-1', customer_id:CUST, status:'completed', total:'33.95', created_at:'2026-08-24' },
    { id:'pos-1', customer_id:CUST, status:'completed', total:'10.00', created_at:'2026-09-01' },
    { id:'shop-sale', customer_id:null, status:'completed', total:'20.00', created_at:'2026-09-18' },
    { id:'voided', customer_id:CUST, status:'voided', total:'99.00', created_at:'2026-09-02' },
    { id:'lazaro-sale', customer_id:null, status:'completed', total:'75.00', created_at:'2026-09-26' },
  ],
  pos_sale_lines: [
    { id:'sl1', sale_id:'foc-1', title:'Comic', adjusted_price:'33.95', profit:'16.95', quantity:1 },
    { id:'sl2', sale_id:'lazaro-sale', item_id:ITEM, title:'Lazaro Montes #BPA-LM', adjusted_price:'75.00', cost_basis:'15.00', profit:'60.00', quantity:1 },
  ],
  pos_payments: [{ id:'p1', sale_id:'lazaro-sale', method:'Cash', amount:75, status:'confirmed' }],
  storefront_orders: [{ id:'so1', sale_id:'shop-sale', customer_email:null, customer_phone:'(360) 535-0308', created_at:'2026-09-18' }, { id:'so2', sale_id:'x', customer_email:null, customer_phone:'555-555-0308', created_at:'2026-09-18' }],
  foc_preorder_orders: [{ id:'foc-1', user_id:USER, customer_email:'SEAN@example.com', status:'paid', total_cents:3395, created_at:'2026-08-24' }],
  foc_preorder_items: [{ id:'fi1', order_id:'foc-1', sku_id:SKU, quantity:1, sku_snapshot:{ title:'Adventure Time #1' } }],
  inventory_items: [{ id:ITEM, store_id:STORE, status:'sold', data:{ name:'Lazaro Montes #BPA-LM', category:'Sports', cost:15, salePrice:22, focSkuId:SKU }, updated_at:'2026-09-26' }],
  comic_skus: [{ id:SKU, title:'Adventure Time #1' }],
};
const calls = [];
function mockFetch(env, path) {
  calls.push(path);
  const [table, qs] = path.split('?');
  const params = new URLSearchParams(qs);
  let rows = (tables[table] || []).slice();
  for (const [key, raw] of params) {
    if (['select','order','limit','offset','store_id'].includes(key)) continue;
    if (key === 'or') return Promise.resolve({ data: rows.filter(r => /Lazaro/i.test(r.data?.name || '')) });
    const [op, ...rest] = raw.split('.'); const val = rest.join('.');
    const get = r => key.startsWith('data->>') ? r.data?.[key.slice(7)] : r[key];
    if (op === 'eq') rows = rows.filter(r => String(get(r)) === val);
    if (op === 'in') { const set = val.slice(1, -1).split(',').map(v => v.replace(/^"|"$/g, '')); rows = rows.filter(r => set.includes(String(get(r)))); }
    if (op === 'ilike') rows = rows.filter(r => String(get(r) || '').toLowerCase() === val.toLowerCase());
    if (op === 'like') rows = rows.filter(r => String(get(r) || '').endsWith(val.replace('*', '')));
  }
  return Promise.resolve({ data: rows });
}

assert.equal(phoneKey('1 (360) 535-0308'), '3605350308');

// --- One person, every channel ---------------------------------------------------
const p = await customerProfile({}, mockFetch, STORE, { customerId:CUST });
assert.equal(p.identity.userId, USER, 'website login comes from the customer record');
assert.equal(p.summary.loyaltyPoints, 102);
assert.deepEqual(p.loyalty.map(l => l.points), [102]);
assert.deepEqual(p.shopOrders.map(o => o.id), ['so1'], 'guest shop order matched by phone (last 10 digits), a different number with the same last 4 is not');
assert.deepEqual(p.focOrders.map(o => o.id), ['foc-1'], 'preorder found by account and by email once, not twice');
assert.equal(p.focOrders[0].items.length, 1, 'order items attached');
const saleIds = p.sales.map(s => s.id).sort();
assert.deepEqual(saleIds, ['foc-1','pos-1','shop-sale','voided'].sort(), 'in-store, shop-order and preorder sales all included');
assert.equal(p.summary.purchases, 3, 'a voided sale is listed but never counted as a purchase');
assert.equal(p.summary.lifetimeSpend, 63.95);
assert.equal(p.sales.find(s => s.id === 'foc-1').lines.length, 1, 'sale line items attached');
assert.ok(calls.every(c => /store_id=eq\.store-1/.test(c)), 'every query must be scoped to the store');
console.log('Customer profile checks passed');

// --- One item, all of it ---------------------------------------------------------------
const item = await itemProfile({}, mockFetch, STORE, ITEM);
assert.equal(item.item.data.name, 'Lazaro Montes #BPA-LM');
assert.equal(item.history.length, 1);
assert.equal(item.history[0].channel, 'Cash');
assert.deepEqual(item.summary, { unitsSold:1, revenue:75, profit:60 }, 'real sold price, not the $22 list price');
assert.equal(item.focSku.id, SKU);
assert.equal(item.preorderItems.length, 1);
assert.equal(await itemProfile({}, mockFetch, STORE, 'not-a-uuid'), null, 'ids are validated before querying');
const hits = await searchInventory({}, mockFetch, STORE, 'lazaro');
assert.equal(hits[0].name, 'Lazaro Montes #BPA-LM');
console.log('Item profile checks passed');

// --- Routes: owner/admin, one gate for all three ----------------------------------------
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const route = worker.slice(worker.indexOf("url.pathname === '/store/db/customer' || url.pathname === '/store/db/items'"), worker.indexOf("url.pathname === '/store/db/table'"));
assert.match(route, /requireStoreUser\(request, env, storeId, \['owner','admin'\]\)/);
assert.match(worker, /c\.customerId = c\.customerId \|\| r\.id;/, 'customer list entries carry the roster id so a profile can open');
const viewer = fs.readFileSync('scripts/database-viewer.js', 'utf8');
for (const fn of ['openDatabaseCustomer', 'runDatabaseItemSearch', 'openDatabaseItem', 'setDatabaseTable']) assert.match(viewer, new RegExp(`window\\.${fn}=`));
console.log('Database explorer route checks passed');
