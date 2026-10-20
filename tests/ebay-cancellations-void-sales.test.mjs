import assert from 'node:assert/strict';
import fs from 'node:fs';

// Store report: "Just had eBay cancellations. Does it hit the dashboard and
// update anything? Profits etc." It didn't. The order sync now voids the
// recorded sale of a cancelled eBay order and puts the copy back.
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const fn = name => { const s = worker.indexOf('function ' + name + '('); assert.ok(s >= 0, name); const start = worker.slice(Math.max(0, s - 6), s) === 'async ' ? s - 6 : s; return worker.slice(start, worker.indexOf('\n}\n', s) + 2); };

const isCancelled = new Function(fn('ebayOrderIsCancelled') + '; return ebayOrderIsCancelled;')();
assert.equal(isCancelled({ cancelStatus:{ cancelState:'CANCELED' }, orderPaymentStatus:'PAID' }), true);
assert.equal(isCancelled({ cancelStatus:{ cancelState:'NONE_REQUESTED' }, orderPaymentStatus:'FULLY_REFUNDED', orderFulfillmentStatus:'NOT_STARTED' }), true, 'refunded in full before it shipped');
assert.equal(isCancelled({ cancelStatus:{ cancelState:'NONE_REQUESTED' }, orderPaymentStatus:'FULLY_REFUNDED', orderFulfillmentStatus:'FULFILLED' }), false, 'a shipped-then-refunded order is a return, not a cancellation');
assert.equal(isCancelled({ cancelStatus:{ cancelState:'IN_PROGRESS' }, orderPaymentStatus:'PAID' }), false, 'a cancel request still pending is not a cancellation yet');
assert.equal(isCancelled({ orderPaymentStatus:'PAID' }), false);

// The sweep: voids each recorded sale once, restocks, marks the payment refunded.
function harness({ sales, items }) {
  const calls = [];
  const db = async (env, path, options = {}) => {
    const method = options.method || 'GET';
    calls.push([method, path, options.body ? JSON.parse(options.body) : null]);
    if (path.startsWith('pos_payments?store_id=') && method === 'GET') {
      const ref = decodeURIComponent(path.match(/reference=eq\.([^&]+)/)[1]);
      return { data: sales.filter(s => s.orderId === ref).map(s => ({ id:'p-' + s.id, sale_id:s.id })) };
    }
    if (path.startsWith('pos_sales?id=eq.') && method === 'PATCH') {
      const id = decodeURIComponent(path.match(/id=eq\.([^&]+)/)[1]); const sale = sales.find(s => s.id === id);
      if (!sale || !['completed', 'succeeded'].includes(sale.status)) return { data: [] };
      sale.status = 'voided'; return { data: [{ id, total: sale.total }] };
    }
    if (path.startsWith('pos_sale_lines?sale_id=eq.')) {
      const id = decodeURIComponent(path.match(/sale_id=eq\.([^&]+)/)[1]); return { data: sales.find(s => s.id === id).lines };
    }
    if (path.startsWith('inventory_items?id=eq.') && method === 'GET') {
      const id = path.match(/id=eq\.([^&]+)/)[1]; const it = items[id]; return { data: it ? [{ id, data:{ ...it.data }, status:it.status }] : [] };
    }
    if (path.startsWith('inventory_items?id=eq.') && method === 'PATCH') {
      const id = path.match(/id=eq\.([^&]+)/)[1]; const body = JSON.parse(options.body); items[id] = { data:body.data, status:body.status }; return { data: null };
    }
    return { data: [] };
  };
  const fetchStub = async (url) => {
    if (String(url).includes('post-order/v2/cancellation/search')) return new Response(JSON.stringify({ members:[{ legacyOrderId:'22-2222-2222' }, { legacyOrderId:'33-3333-3333' }] }));
    if (String(url).includes('/sell/fulfillment/v1/order/22-2222-2222')) return new Response(JSON.stringify({ orderId:'22-2222-2222', cancelStatus:{ cancelState:'CANCELED' } }));
    if (String(url).includes('/sell/fulfillment/v1/order/33-3333-3333')) return new Response(JSON.stringify({ orderId:'33-3333-3333', cancelStatus:{ cancelState:'IN_PROGRESS' }, orderPaymentStatus:'PAID' }));
    return new Response('{}', { status:404 });
  };
  const voidFn = new Function('supabaseAdminFetch', 'fetch', 'console', [fn('ebayOrderIsCancelled'), fn('restockVoidedSaleLines'), fn('voidCancelledEbayOrders'), 'return voidCancelledEbayOrders;'].join('\n'))(db, fetchStub, { warn(){} });
  return { calls, voidFn };
}
const U1 = '11111111-1111-1111-1111-111111111111', U2 = '22222222-2222-2222-2222-222222222222', U3 = '33333333-3333-3333-3333-333333333333';
{
  const sales = [
    { id:'s1', orderId:'11-1111-1111', status:'completed', total:119.96, lines:[{ id:'l1', item_id:U1, quantity:1, title:'MAXIMUM X-MEN #1 1:100 - PRESALE' }] },
    { id:'s2', orderId:'22-2222-2222', status:'completed', total:9.98, lines:[{ id:'l2', item_id:U2, quantity:2, title:'TMNT #23 Var D' }] },
    { id:'s3', orderId:'44-4444-4444', status:'completed', total:5, lines:[{ id:'l3', item_id:U3, quantity:1, title:'Not cancelled' }] },
  ];
  const items = {
    [U1]: { status:'sold', data:{ source:'foc_presale', qty:0, quantity:0, status:'sold', soldAt:'x' } },   // presale, books not in yet
    [U2]: { status:'in_stock', data:{ source:'built_in', qty:1, quantity:1, status:'in_stock' } },
    [U3]: { status:'in_stock', data:{ qty:3, quantity:3 } },
  };
  const { calls, voidFn } = harness({ sales, items });
  const orders = [{ orderId:'11-1111-1111', cancelStatus:{ cancelState:'CANCELED' } }, { orderId:'44-4444-4444', orderPaymentStatus:'PAID' }];
  const voided = await voidFn({}, 'store-1', 'tok', orders, 'user-1');
  assert.deepEqual(voided.map(v => [v.orderId, v.saleId, v.restocked]).sort(), [['11-1111-1111', 's1', 1], ['22-2222-2222', 's2', 1]], 'the synced cancellation and the one from eBay\'s cancellation list; not the pending one or a normal order');
  assert.equal(sales.find(s => s.id === 's1').status, 'voided');
  assert.equal(sales.find(s => s.id === 's3').status, 'completed');
  assert.equal(items[U1].status, 'presale', 'an unreceived eBay presale goes back to being a presale');
  assert.equal(items[U1].data.qty, 1);
  assert.equal(items[U2].status, 'in_stock');
  assert.equal(items[U2].data.qty, 3, 'both copies of a 2-copy order come back');
  assert.ok(calls.some(([m, p, b]) => m === 'PATCH' && p.startsWith('pos_payments?sale_id=eq.s1') && b.status === 'refunded'));
  assert.ok(calls.some(([m, p]) => m === 'POST' && p === 'inventory_movements'), 'the restock is logged as an inventory movement');
  assert.equal(voided.find(v => v.saleId === 's1').total, 119.96);
  // Running again does nothing (already voided).
  const again = await voidFn({}, 'store-1', 'tok', orders, 'user-1');
  assert.equal(again.length, 0, 'idempotent');
}

// Wired in: cancelled orders are never recorded, the sweep runs on every sync,
// and the dashboard says what it voided.
assert.match(worker, /if \(order\.orderPaymentStatus !== 'PAID'\) continue;\n\s*if \(ebayOrderIsCancelled\(order\)\) continue;/);
assert.match(worker, /cancelled = await voidCancelledEbayOrders\(env, storeId, ebayToken, orders, confirmedBy\);/);
assert.match(worker, /return \{ ok: true, checked: orders\.length, matched: matchedCount, recorded: results\.length, results, errors, cancelled \};/);
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
assert.match(app, /cancelled eBay order\$\{cancelled\.length === 1 \? '' : 's'\}: sale/);
console.log('eBay cancellations void sales checks passed');
