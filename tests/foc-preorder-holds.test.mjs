import fs from 'node:fs';
import assert from 'node:assert/strict';
import { holdGroups, handleFocRequest } from '../scripts/foc-preorders.mjs';

// Store report: Sean's paid preorder copy (Midnight X-Men #1 Cover D) came in
// as plain shelf stock and got rung up at the register. Receiving puts paid
// preorder copies ON HOLD in their own rows; HANDED OVER / SHIPPED clears them.
const O1 = '11111111-1111-4111-8111-111111111111';
const holdRow = (id, name, qty, orderId = O1) => ({ id, created_at:'2026-10-14T10:00:00Z', data:{ source:'foc_hold', lifecycle:'hold', name, qty, image:'', preorderHold:{ orderId, orderNumber:'FOC-20260831-E1E8A598', customerName:'Sean Vanoverbeke', fulfillment:'pickup', heldAt:'2026-10-14T10:00:00Z' } } });
{
  const g = holdGroups([holdRow('h1', 'MIDNIGHT X-MEN #1 -- COVER F', 1), holdRow('h2', 'MIDNIGHT X-MEN #1 -- COVER I', 1)],
    [{ id:O1, status:'paid', customer_phone:'3605350308' }],
    [{ order_id:O1, status:'ready_for_pickup', sku:{ title:'MIDNIGHT X-MEN #1', variant_label:'COVER F' } }, { order_id:O1, status:'committed', sku:{ title:'DOOM ALL-ON-ONE #1 BEN HARVEY VARIANT', variant_label:'BEN HARVEY VARIANT' } }]);
  assert.equal(g.length, 1);
  assert.deepEqual([g[0].customerName, g[0].books.length, g[0].phone], ['Sean Vanoverbeke', 2, '3605350308']);
  assert.deepEqual(g[0].stillComing, ['DOOM ALL-ON-ONE #1 BEN HARVEY VARIANT · BEN HARVEY VARIANT']);
}
// HANDED OVER: the held rows leave stock (archived, not a new sale); handed
// books are completed; the order stays open while books are still coming.
{
  const patches = [];
  let items = [{ status:'ready_for_pickup' }, { status:'committed' }];
  const deps = { json:(data, status = 200) => ({ status, data }), requireStoreUser:async () => ({ user:{ id:'u' } }), readJsonWithLimit:async req => ({ data:JSON.parse(req.body) }),
    supabaseAdminFetch:async (env, path, opts = {}) => {
      if (opts.method === 'PATCH') { patches.push([path, JSON.parse(opts.body)]); if (path.startsWith('foc_preorder_items?order_id=') && path.includes('status=eq.ready_for_pickup')) items = items.map(i => i.status === 'ready_for_pickup' ? { status:'completed' } : i); return { data:null }; }
      if (path.startsWith('foc_preorder_orders?id=')) return { data:[{ id:O1, status:'paid', fulfillment_method:'pickup' }] };
      if (path.startsWith('inventory_items?store_id=eq.st&data->>source=eq.foc_hold')) { assert.match(path, new RegExp('data->preorderHold->>orderId=eq.' + O1)); return { data:[holdRow('h1', 'MIDNIGHT X-MEN #1 -- COVER F', 1)] }; }
      if (path.startsWith('foc_preorder_items?order_id=')) return { data:items };
      return { data:[] };
    } };
  const res = await handleFocRequest({ method:'POST', headers:{ get:() => null }, body:JSON.stringify({ storeId:'st', orderId:O1 }) }, {}, new URL('https://x/foc/admin/holds'), deps);
  assert.deepEqual(res.data, { ok:true, released:1, orderDone:false, stillComing:1 });
  const archived = patches.find(p => p[0].startsWith('inventory_items?id=eq.h1'))[1];
  assert.equal(archived.status, 'archived');
  assert.equal(archived.data.archiveReason, 'Handed over to Sean Vanoverbeke (preorder FOC-20260831-E1E8A598)');
  assert.ok(!patches.some(p => p[0].startsWith('foc_preorder_orders?id=')), 'the order stays open: Doom variants still coming');
  items = [{ status:'ready_for_pickup' }];
  patches.length = 0;
  const done = await handleFocRequest({ method:'POST', headers:{ get:() => null }, body:JSON.stringify({ storeId:'st', orderId:O1 }) }, {}, new URL('https://x/foc/admin/holds'), deps);
  assert.equal(done.data.orderDone, true);
  assert.equal(patches.find(p => p[0].startsWith('foc_preorder_orders?id=eq.'))[1].status, 'completed');
}
const foc = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');
const orders = foc.slice(foc.indexOf('async function adminOrders('), foc.indexOf('function focShippoError('));
assert.match(orders, /await releaseOrderHolds\(db,storeId,order\.id,next==='shipped'\?'shipped':'handed_over'\);/, 'completing or shipping an order from the orders screen clears its holds too');
assert.match(foc, /if\(!items\.some\(item=>item\.status==='ready_for_pickup'\)\|\|!items\.every/, 'an order is ready once every item is in hand');
assert.doesNotMatch(foc, /JSON\.stringify\(\{status:'received'\}\)/, "'received' is not an allowed item status");

// The register won't sell a held copy, whatever the device's lifecycle map says.
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const extractFn = name => { const s = dashboard.indexOf('function ' + name + '('); assert.ok(s >= 0, name); return dashboard.slice(s, dashboard.indexOf('\n}\n', s) + 2); };
const sellable = new Function(dashboard.slice(dashboard.indexOf('function inventoryRowPreorderHold('), dashboard.indexOf('\n', dashboard.indexOf('function inventoryRowPreorderHold('))) + extractFn('inventoryAvailableQuantity') + extractFn('inventoryItemIsSellable') + 'return inventoryItemIsSellable;')();
assert.equal(sellable({ status:'in_stock', lifecycle:'in_stock', qty:1, raw:{ source:'foc_hold', lifecycle:'hold' } }), false);
assert.equal(sellable({ status:'in_stock', lifecycle:'in_stock', qty:1, raw:{ source:'foc_receive' } }), true);
assert.match(dashboard, /lifecycle:\(d\.source === 'foc_hold' && d\.lifecycle === 'hold'\) \? 'hold' : getLifecycle\(/);
assert.match(extractFn('addSaleItemToCart'), /toast_dash\(who \? `On hold for \$\{who\}'s preorder -- hand it over from FOC → 📌 ON HOLD`/);
assert.match(extractFn('openSellModal'), /if\(inventoryRowPreorderHold\(item\.raw\)\) \{/);
const ui = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
assert.match(ui, /onclick="openFocHolds\(\)">📌 ON HOLD<\/button>/);
assert.match(ui, /if\(!confirm\(ship\?'Mark these books shipped\?/);
console.log('FOC preorder hold checks passed');
