import fs from 'node:fs';
import assert from 'node:assert/strict';
import { orderItemState, orderStatus, buildOrdersBoard, handleOrdersBoard, handleOrderMarkShipped, SHIP_LATE_AFTER_DAYS, presaleTitleKey } from '../scripts/orders-board.mjs';

// Store ask: "Need organized area for ebay, whatnot, and website orders..
// Need to know whats in. When itll be in.. and whats late."
const today = '2026-10-09';

// ── One book ──
assert.deepEqual(orderItemState({ isPresale:false }, today), { state:'in', onSaleDate:'' }, 'in-stock stock is in');
assert.deepEqual(orderItemState({ isPresale:true, onSaleDate:'2026-12-02' }, today), { state:'coming', onSaleDate:'2026-12-02' }, 'a presale not out yet is coming, with its date');
assert.deepEqual(orderItemState({ isPresale:true, onSaleDate:'2026-10-01' }, today), { state:'late', onSaleDate:'2026-10-01' }, 'past its release date and not in: late');
assert.equal(orderItemState({ isPresale:true, received:true, onSaleDate:'2026-10-01' }, today).state, 'in', 'received presales are in');

// ── One order ──
assert.equal(orderStatus({ items:[{ state:'in' }], shipped:true, today }).status, 'shipped');
assert.equal(orderStatus({ items:[{ state:'in' }, { state:'late', onSaleDate:'2026-10-01' }], today }).status, 'late', 'one late book makes the order late');
{
  const s = orderStatus({ items:[{ state:'in' }, { state:'coming', onSaleDate:'2026-11-05' }, { state:'coming', onSaleDate:'2026-12-02' }], createdAt:'2026-10-08T10:00:00Z', today });
  assert.equal(s.status, 'waiting');
  assert.equal(s.expectedDate, '2026-12-02', 'the order is in when its LAST book is');
}
assert.equal(orderStatus({ items:[{ state:'in' }], createdAt:'2026-10-08T10:00:00Z', today }).status, 'ready', 'everything in, ordered yesterday: ready to ship');
{
  const s = orderStatus({ items:[{ state:'in' }], createdAt:'2026-10-01T10:00:00Z', today });
  assert.equal(s.status, 'late', `everything in but not shipped ${SHIP_LATE_AFTER_DAYS}+ days later: late`);
  assert.match(s.reason, /not shipped/);
}
assert.equal(orderStatus({ items:[{ state:'in', onSaleDate:'2026-10-08' }], createdAt:'2026-09-01T10:00:00Z', today }).status, 'ready', 'a presale that just came in counts from its release date, not the order date');

// ── The board ──
const inventoryById = new Map([
  ['inv-stock', { id:'inv-stock', status:'sold', src:'', name:'Julio Rodriguez #197' }],
  ['inv-presale', { id:'inv-presale', status:'presale', src:'foc_presale', onSaleDate:'2026-12-02', focSkuId:'sku-1', name:'Batman #1 - PRESALE' }],
  ['inv-late', { id:'inv-late', status:'presale', src:'foc_presale', onSaleDate:'2026-10-01', focSkuId:'sku-2', name:'Saga #1 - PRESALE' }],
  ['inv-arrived', { id:'inv-arrived', status:'presale', src:'foc_presale', onSaleDate:'2026-10-07', focSkuId:'sku-3', name:'X-Men #1 - PRESALE' }],
]);
const board = buildOrdersBoard({
  today,
  payments:[
    { sale_id:'s1', provider:'ebay', reference:'01-1', amount:'5', created_at:'2026-10-08T10:00:00Z', provider_metadata:{ ebayOrderId:'01-1', labelTransactionIds:[] } },
    { sale_id:'s2', provider:'ebay', reference:'02-2', amount:'7', created_at:'2026-10-02T10:00:00Z', provider_metadata:{ ebayOrderId:'02-2', labelTransactionIds:['L1'] } },
    { sale_id:'s3', provider:'ebay', reference:'03-3', amount:'4', created_at:'2026-10-05T10:00:00Z', provider_metadata:{ ebayOrderId:'03-3' } },
    { sale_id:'s4', provider:'ebay', reference:'03-3', amount:'6', created_at:'2026-10-05T10:00:00Z', provider_metadata:{ ebayOrderId:'03-3' } },
    { sale_id:'s5', provider:'whatnot', reference:'whatnot:W9:inv-late', amount:'9', created_at:'2026-09-20T10:00:00Z', provider_metadata:{} },
  ],
  lines:[
    { sale_id:'s1', item_id:'inv-stock', title:'Julio Rodriguez #197', quantity:1, unit_price:5 },
    { sale_id:'s2', item_id:'inv-stock', title:'Julio Rodriguez #197', quantity:1, unit_price:7 },
    { sale_id:'s3', item_id:'inv-arrived', title:'X-Men #1 - PRESALE', quantity:1, unit_price:4 },
    { sale_id:'s4', item_id:'inv-presale', title:'Batman #1 - PRESALE', quantity:2, unit_price:3 },
    { sale_id:'s5', item_id:'inv-late', title:'Saga #1 - PRESALE', quantity:1, unit_price:9 },
  ],
  inventoryById, receivedSkuIds:new Set(['sku-3']),
  storefrontOrders:[{ id:'sf-1', sale_id:'s9', confirmation_number:'TMP-100', customer_name:'Ana', fulfillment_method:'pickup_kitsap', fulfillment_status:'pending', created_at:'2026-10-08T10:00:00Z' }],
  storefrontLines:[{ sale_id:'s9', item_id:'inv-stock', title:'Julio Rodriguez #197', quantity:1, unit_price:5 }],
  focOrders:[{ id:'fo-1', order_number:'C-7', status:'paid', customer_name:'Ben', fulfillment_method:'pickup', total_cents:1299, paid_at:'2026-09-01T10:00:00Z' }],
  focItems:[{ order_id:'fo-1', sku_id:'sku-2', quantity:1, unit_price_cents:1299, sku:{ title:'Saga #1', variant_label:'Cover A', on_sale_date:'2026-10-01' } }],
});
const ebay = Object.fromEntries(board.channels.ebay.map(o => [o.id, o]));
assert.equal(ebay['01-1'].status, 'ready', 'in-stock eBay order from yesterday: ready to ship');
assert.equal(ebay['02-2'].status, 'shipped', 'an eBay label means shipped');
assert.equal(ebay['02-2'].shippedBy, 'eBay label');
assert.equal(ebay['03-3'].items.length, 2, 'one eBay order with two sales is one order');
assert.equal(ebay['03-3'].status, 'waiting', 'X-Men arrived but Batman is still coming');
assert.equal(ebay['03-3'].expectedDate, '2026-12-02');
assert.equal(ebay['03-3'].items.find(i => /X-Men/.test(i.title)).state, 'in', 'a received presale shows as in');
assert.equal(ebay['03-3'].items.find(i => /Batman/.test(i.title)).title, 'Batman #1', 'the " - PRESALE" tag is dropped from titles');
assert.equal(board.channels.whatnot[0].id, 'W9', 'Whatnot orders group by their Whatnot order id');
assert.equal(board.channels.whatnot[0].status, 'late', 'Saga #1 was due Oct 1 and never came');
const web = Object.fromEntries(board.channels.website.map(o => [o.number, o]));
assert.equal(web['TMP-100'].status, 'ready');
assert.equal(web['C-7'].status, 'late', 'a website preorder whose book is past due is late');
assert.equal(web['C-7'].items[0].title, 'Saga #1', 'Cover A is implied');
assert.deepEqual(board.counts.ebay, { late:0, ready:1, waiting:1, shipped:1 });
assert.equal(board.channels.ebay[0].status, 'ready', 'actionable orders first: late, then ready, then waiting, then shipped');

// A sale line with no inventory link: its " - PRESALE" title still counts.
{
  const b = buildOrdersBoard({ today, payments:[{ sale_id:'s7', provider:'ebay', reference:'07-7', amount:'18', created_at:'2026-10-08T10:00:00Z', provider_metadata:{ ebayOrderId:'07-7' } }],
    lines:[{ sale_id:'s7', item_id:null, title:'Sonic the Hedgehog x Godzilla #3 Variant RI (15) (Haines) - PRESALE', quantity:1, unit_price:18 }] });
  assert.equal(b.channels.ebay[0].status, 'waiting', 'an unlinked presale line is still waiting, not ready to ship');
  assert.equal(b.channels.ebay[0].items[0].title, 'Sonic the Hedgehog x Godzilla #3 Variant RI (15) (Haines)');
}

// Marked shipped by hand (Whatnot / eBay label bought elsewhere).
assert.equal(buildOrdersBoard({ today, payments:[{ sale_id:'s5', provider:'whatnot', reference:'whatnot:W9:x', amount:'9', created_at:'2026-09-20T10:00:00Z' }], lines:[], shippedMarks:new Set(['whatnot:W9']) }).channels.whatnot[0].status, 'shipped');

// ── The route ──
{
  const calls = [];
  const deps = {
    requireStoreUser: async () => ({ user:{ id:'u1' } }),
    json: (body, status = 200) => ({ status, body }),
    supabaseAdminFetch: async (env, path) => {
      calls.push(path);
      if(path.startsWith('pos_payments')) return { data:[{ sale_id:'s1', provider:'ebay', reference:'01-1', amount:'5', created_at:new Date().toISOString(), provider_metadata:{ ebayOrderId:'01-1' } }] };
      if(path.startsWith('pos_sale_lines')) return { data:[{ sale_id:'s1', item_id:'11111111-1111-1111-1111-111111111111', title:'Card', quantity:1, unit_price:5 }] };
      if(path.startsWith('inventory_items') && path.includes('foc_receive')) return { data:[] };
      if(path.startsWith('inventory_items')) return { data:[{ id:'11111111-1111-1111-1111-111111111111', status:'sold', src:'' }] };
      return { data:[] };
    },
  };
  const res = await handleOrdersBoard({}, {}, deps, new URL('https://w.test/orders/board?store_id=store1'));
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.channels.ebay[0].id, '01-1');
  assert.ok(calls.some(p => /^pos_payments\?store_id=eq\.store1&provider=in\.\(ebay,whatnot\)/.test(p)), 'reads only this store\'s eBay and Whatnot payments');
  assert.ok(calls.some(p => /^storefront_orders\?store_id=eq\.store1/.test(p)) && calls.some(p => /^foc_preorder_orders\?store_id=eq\.store1/.test(p)), 'and this store\'s website orders');
}
{
  const kv = new Map();
  const env = { LBA_KV:{ put:async (k, v) => kv.set(k, v), delete:async k => kv.delete(k) } };
  const deps = { requireStoreUser: async () => ({ user:{ id:'u1' } }), json:(body, status = 200) => ({ status, body }) };
  const req = body => ({ json: async () => body });
  assert.equal((await handleOrderMarkShipped(req({ storeId:'store1', channel:'whatnot', orderId:'W9', shipped:true }), env, deps)).body.ok, true);
  assert.ok(kv.has('order-shipped:store1:whatnot:W9'));
  await handleOrderMarkShipped(req({ storeId:'store1', channel:'whatnot', orderId:'W9', shipped:false }), env, deps);
  assert.ok(!kv.has('order-shipped:store1:whatnot:W9'), 'and can be undone');
  assert.equal((await handleOrderMarkShipped(req({ storeId:'store1', channel:'website', orderId:'X' }), env, deps)).status, 400, 'website orders are managed in their own panels');
}


// ── Found checking the store's real orders ──
// A pickup order with everything in is waiting on the customer, not late.
{
  const s = orderStatus({ items:[{ state:'in' }], createdAt:'2026-07-24T00:00:00Z', today, pickup:true });
  assert.deepEqual({ ...s }, { status:'ready', reason:'ready for pickup', expectedDate:'' });
  assert.equal(orderStatus({ items:[{ state:'late', onSaleDate:'2026-10-07' }], today, pickup:true }).status, 'late', 'a pickup still goes late when a book never came in');
  const board = buildOrdersBoard({
    storefrontOrders:[{ id:'sf-p', sale_id:'s-p', confirmation_number:'ORD-P', customer_name:'A', fulfillment_method:'pickup_fedway', fulfillment_status:'pending', created_at:'2026-07-24T00:00:00Z' }],
    storefrontLines:[{ sale_id:'s-p', item_id:'i-p', title:'Booster Pack', quantity:1, unit_price:7.88 }],
    inventoryById:new Map([['i-p', { id:'i-p', status:'in_stock', src:'built_in' }]]), today,
  });
  assert.equal(board.channels.website[0].status, 'ready');
  assert.equal(board.channels.website[0].pickup, true);
}
// A sale line never tied to inventory (Sonic x Godzilla #3 RI, eBay Sep 2)
// gets its due date from the FOC catalog by title.
{
  assert.equal(presaleTitleKey('Sonic the Hedgehog x Godzilla #3 Variant RI (15) (Haines) - PRESALE'), 'sonic the hedgehog x godzilla #3 variant ri (15) (haines)');
  const skuByTitle = new Map([[presaleTitleKey('Sonic the Hedgehog x Godzilla #3 Variant RI (15) (Haines)'), { id:'sku-sonic', on_sale_date:'2026-10-14' }]]);
  const args = {
    payments:[{ sale_id:'s-s', reference:'11-1', provider:'ebay', amount:17.99, created_at:'2026-09-02T00:00:00Z', provider_metadata:{ ebayOrderId:'11-1', labelTransactionIds:[] } }],
    lines:[{ sale_id:'s-s', item_id:null, title:'Sonic the Hedgehog x Godzilla #3 Variant RI (15) (Haines) - PRESALE', quantity:1, unit_price:17.99 }],
    skuByTitle, today,
  };
  const o = buildOrdersBoard(args).channels.ebay[0];
  assert.equal(o.status, 'waiting');
  assert.equal(o.expectedDate, '2026-10-14');
  assert.equal(o.items[0].onSaleDate, '2026-10-14');
  const inNow = buildOrdersBoard({ ...args, receivedSkuIds:new Set(['sku-sonic']) }).channels.ebay[0];
  assert.equal(inNow.items[0].state, 'in', 'and is in once a copy of that book is');
}
// The route counts any real copy of a book as in -- a connecting cover
// entered by hand and put straight into its bundle (Midnight X-Men #1
// Cover F) -- but never the presale listing itself; and looks unlinked
// presale lines up in the catalog.
{
  const calls = [];
  const deps = {
    requireStoreUser: async () => ({ user:{ id:'u1' } }), json:(body, status = 200) => ({ status, body }),
    supabaseAdminFetch: async (env, path) => {
      calls.push(path);
      if (path.startsWith('pos_payments')) return { data:[{ sale_id:'s-s', reference:'11-1', provider:'ebay', amount:17.99, created_at:new Date().toISOString(), provider_metadata:{ ebayOrderId:'11-1' } }] };
      if (path.startsWith('pos_sale_lines')) return { data:[{ sale_id:'s-s', item_id:null, title:'Sonic #3 RI - PRESALE', quantity:1, unit_price:17.99 }] };
      if (path.startsWith('comic_skus')) return { data:[{ id:'sku-sonic', title:'Sonic #3 RI', on_sale_date:'2099-10-14' }] };
      if (path.startsWith('foc_preorder_orders')) return { data:[{ id:'fo1', order_number:'FOC-1', status:'paid', fulfillment_method:'pickup', created_at:new Date().toISOString() }] };
      if (path.startsWith('foc_preorder_items')) return { data:[{ order_id:'fo1', sku_id:'sku-f', quantity:1, unit_price_cents:599, sku:{ title:'MIDNIGHT X-MEN #1 COVER F', on_sale_date:'2020-10-07' } }, { order_id:'fo1', sku_id:'sku-i', quantity:1, unit_price_cents:599, sku:{ title:'MIDNIGHT X-MEN #1 COVER I', on_sale_date:'2020-10-07' } }] };
      if (path.startsWith('inventory_items') && path.includes('data->>focSkuId=')) return { data:[{ sku:'sku-f', src:'built_in' }, { sku:'sku-sonic', src:'foc_presale' }] };
      return { data:[] };
    },
  };
  const res = await handleOrdersBoard({}, {}, deps, new URL('https://w.test/orders/board?store_id=store1'));
  assert.ok(calls.some(p => /^comic_skus\?store_id=eq\.store1&title=in\.\("Sonic #3 RI"\)/.test(p)), 'unlinked presale titles are looked up in this store\'s catalog');
  const lookup = calls.find(p => p.startsWith('inventory_items') && p.includes('data->>focSkuId='));
  assert.doesNotMatch(lookup, /data->>source=eq\.foc_receive/, 'not only FOC-received copies count');
  const sonic = res.body.channels.ebay[0];
  assert.equal(sonic.status, 'waiting', 'the presale listing row itself is not a copy in hand');
  assert.equal(sonic.expectedDate, '2099-10-14');
  const pre = res.body.channels.website[0];
  assert.equal(pre.items[0].state, 'in', 'cover F is in the store');
  assert.equal(pre.items[1].state, 'late', 'cover I never came in');
  assert.equal(pre.status, 'late');
}

// ── Wiring ──
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.match(worker, /import \{ handleOrdersBoard, handleOrderMarkShipped \} from '\.\/scripts\/orders-board\.mjs';/);
assert.match(worker, /if \(url\.pathname === '\/orders\/board' && request\.method === 'GET'\) \{\s*\n\s*return await handleOrdersBoard\(/);
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
assert.match(dashboard, /<div class="panel" id="orders-board-panel"/, 'the Orders tab has the board');
assert.match(dashboard, /if\(name === 'orders'\) setTimeout\(\(\)=>\{ renderOrdersBoard\(\);/, 'and loads it when opened');
assert.match(dashboard, /await storeWorkerFetch\('\/orders\/board\?store_id=' \+ encodeURIComponent\(getActiveStoreId\(\)\)/);
assert.match(dashboard, /\$\{o\.status === 'ready' && o\.pickup \? 'READY FOR PICKUP' : st\.label\}/, 'a pickup order says so');

console.log('Orders board checks passed');
