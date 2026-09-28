import assert from 'node:assert/strict';
import { ebayOrderMoney, ebayLineProfit, estimateEbayFeeCents, financeAdjustments, splitCents } from '../scripts/ebay-order-money.mjs';

// --- Money math ------------------------------------------------------------------
assert.deepEqual(splitCents(100, [1, 1, 1]), [33, 33, 34], 'parts always add up');
assert.deepEqual(splitCents(96, [499]), [96]);
assert.equal(estimateEbayFeeCents(999), Math.round(999 * 0.1325) + 30, '$0.30 per-order fee at $10 and under');
assert.equal(estimateEbayFeeCents(1500), Math.round(1500 * 0.1325) + 40, '$0.40 above $10');

const order = (extra = {}) => ({
  orderId: '27-1', creationDate: '2026-09-27T19:48:17.000Z',
  pricingSummary: { deliveryCost: { value: '4.99' } },
  lineItems: [{ lineItemId: 'L1', sku: 'lba-1', lineItemCost: { value: '4.99' }, quantity: 1,
    deliveryCost: { shippingCost: { value: '4.99' } }, ebayCollectAndRemitTaxes: [{ amount: { value: '0.90' } }] }],
  ...extra,
});
// eBay's own fee for the order wins.
let [m] = ebayOrderMoney(order({ totalMarketplaceFee: { value: '1.74' } }));
assert.deepEqual(m, { lineItemId: 'L1', itemPrice: 4.99, shipping: 4.99, fee: 1.74, feeSource: 'ebay' });
assert.equal(ebayLineProfit(m, 2.5), 0.75, 'no label yet: assumed to cost the $4.99 shipping, so $4.99 - $2.50 cost - $1.74 fee');
assert.equal(ebayLineProfit({ ...m, labelCost: 4.25 }, 2.5), 1.49, 'the real $4.25 label replaces the assumption: $4.99 + $4.99 - $2.50 - $1.74 - $4.25');
assert.ok(ebayLineProfit(m, 2.5) < m.itemPrice, 'profit never above the item price while the label is pending');
// No fee from eBay: estimated on item + shipping + tax, not the item alone.
[m] = ebayOrderMoney(order());
assert.equal(m.feeSource, 'estimate');
assert.equal(m.fee, (Math.round(1088 * 0.1325) + 40) / 100, '13.25% of $10.88 + $0.40');
// Two lines, order-level shipping and fee split by item price.
const two = ebayOrderMoney({ orderId: 'x', totalMarketplaceFee: { value: '3.00' }, pricingSummary: { deliveryCost: { value: '6.00' } },
  lineItems: [{ lineItemId: 'a', lineItemCost: { value: '10.00' } }, { lineItemId: 'b', lineItemCost: { value: '20.00' } }] });
assert.deepEqual(two.map(x => [x.shipping, x.fee]), [[2, 1], [4, 2]]);

// Finances transactions -> adjustments.
const adj = financeAdjustments([
  { transactionId: 'T1', transactionType: 'SHIPPING_LABEL', bookingEntry: 'DEBIT', amount: { value: '4.25' }, references: [{ referenceType: 'ORDER_ID', referenceId: '27-1' }] },
  { transactionId: 'T2', transactionType: 'SHIPPING_LABEL', bookingEntry: 'CREDIT', amount: { value: '4.25' }, orderId: '27-2' },
  { transactionId: 'T3', transactionType: 'SALE', orderId: '27-3', orderLineItems: [{ lineItemId: 'L9', marketplaceFees: [{ amount: { value: '1.10' } }, { amount: { value: '0.40' } }] }] },
]);
assert.deepEqual(adj.labels.get('27-1'), [{ id: 'T1', cents: 425 }]);
assert.deepEqual(adj.labels.get('27-2'), [{ id: 'T2', cents: -425 }], 'a voided label is credited back');
assert.equal(adj.fees.get('L9'), 150);
console.log('eBay order money checks passed');

// --- Through the worker ------------------------------------------------------------
const { default: api } = await import('../cloudflare-worker-full.js');
const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
const kv = new Map([['secret:EBAY_ACCESS_TOKEN', 'tok'], ['secret:EBAY_ACCESS_EXPIRES', String(Date.now() + 3600e3)]]);
const env = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'k', EBAY_REFRESH_TOKEN: 'r',
  LBA_KV: { get: async k => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async k => { kv.delete(k); } } };
const db = { pos_sales: [], pos_sale_lines: [], pos_payments: [] };
let ebayOrders = [], financeTxns = [];
const ok = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
function where(rows, q) {
  return rows.filter(r => [...q.entries()].every(([k, v]) => {
    if (['select', 'limit', 'order'].includes(k)) return true;
    const [op, ...rest] = v.split('.'); const val = rest.join('.');
    const cur = k.includes('->>') ? r[k.split('->>')[0]]?.[k.split('->>')[1]] : r[k];
    if (op === 'eq') return String(cur) === val;
    if (op === 'is') return cur == null;
    if (op === 'in') return val.slice(1, -1).split(',').map(x => x.replace(/^"|"$/g, '')).includes(String(cur));
    if (op === 'neq') return String(cur) !== val;
    return true;
  }));
}
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input.url || input));
  if (url.host === 'api.ebay.com') return ok({ total: ebayOrders.length, orders: ebayOrders });
  if (url.host === 'apiz.ebay.com') return ok({ transactions: financeTxns });
  const table = url.pathname.split('/rest/v1/')[1];
  if (table === 'store_members') return ok([{ store_id: 'store-1' }]);
  if (table === 'inventory_items' && url.searchParams.has('or')) return ok([{ id: 'item-1' }]);
  if (table === 'store_settings' || table === 'inventory_items' && !init.method) return ok(table === 'inventory_items' ? [{ id: 'item-1', status: 'presale', data: { name: 'He-Man #4', ebaySku: 'lba-1', quantity: 10, cost: 2.5, source: 'foc_presale' } }] : []);
  if (!db[table]) return ok([]);
  if (init.method === 'POST') { db[table].push(...[].concat(JSON.parse(init.body))); return ok([]); }
  const rows = where(db[table], url.searchParams);
  if (init.method === 'PATCH') { const patch = JSON.parse(init.body); rows.forEach(r => Object.assign(r, patch)); return ok(rows); }
  return ok(rows);
};
const cron = async () => { const waits = []; await api.scheduled({}, env, { waitUntil: p => waits.push(p) }); await Promise.all(waits); };
try {
  // A new sale: real fee, shipping in the total and profit, order kept on the payment.
  ebayOrders = [{ ...order({ totalMarketplaceFee: { value: '1.74' } }), orderPaymentStatus: 'PAID', lineItems: [{ ...order().lineItems[0], title: 'He-Man #4' }] }];
  await cron();
  assert.equal(db.pos_sales.length, 1);
  assert.equal(db.pos_sales[0].total, 4.99, 'sales count the item price; shipping is not a sale');
  assert.equal(db.pos_sale_lines[0].profit, 0.75, 'label pending: shipping nets to zero');
  const pay = db.pos_payments[0];
  assert.equal(pay.reference, '27-1');
  assert.equal(pay.amount, 4.99);
  assert.equal(pay.provider_metadata.shipping, 4.99, 'shipping kept in the breakdown');
  assert.equal(pay.provider_metadata.feeSource, 'ebay');

  // The label bought on eBay later comes off -- once, however often the job runs.
  financeTxns = [{ transactionId: 'T1', transactionType: 'SHIPPING_LABEL', bookingEntry: 'DEBIT', amount: { value: '4.25' }, references: [{ referenceType: 'ORDER_ID', referenceId: '27-1' }] }];
  await cron();
  await cron();
  assert.equal(pay.provider_metadata.labelCost, 4.25);
  assert.deepEqual(pay.provider_metadata.labelTransactionIds, ['T1']);
  assert.equal(db.pos_sale_lines[0].profit, 1.49, 'label taken off once');
  // Label voided: credited back.
  financeTxns.push({ transactionId: 'T2', transactionType: 'SHIPPING_LABEL', bookingEntry: 'CREDIT', amount: { value: '4.25' }, orderId: '27-1' });
  await cron();
  assert.equal(pay.provider_metadata.labelCost, 0);
  assert.equal(db.pos_sale_lines[0].profit, 0.75, 'voided with no replacement: back to the assumption');

  // A sale recorded before this (no order on it, item price only, old fee):
  // linked and corrected when the sync sees its order again.
  db.pos_sales.push({ id: 's-old', store_id: 'store-1', total: 4.99 });
  db.pos_sale_lines.push({ id: 'l-old', sale_id: 's-old', store_id: 'store-1', cost_basis: 2.5, profit: 1.53 });
  db.pos_payments.push({ id: 'p-old', sale_id: 's-old', store_id: 'store-1', provider: 'ebay', amount: 4.99, reference: null, created_at: '2026-09-20T10:00:00.000Z' });
  kv.set('ebay_order_synced:store-1:27-9:lba-1', '1');
  ebayOrders = [{ ...order({ totalMarketplaceFee: { value: '1.74' } }), orderId: '27-9', creationDate: '2026-09-20T10:00:00.000Z', orderPaymentStatus: 'PAID' }];
  await cron();
  const old = db.pos_payments.find(p => p.id === 'p-old');
  assert.equal(old.reference, '27-9');
  assert.equal(old.amount, 4.99);
  assert.equal(db.pos_sale_lines.find(l => l.id === 'l-old').profit, 0.75);
  assert.equal(db.pos_sales.find(s => s.id === 's-old').total, 4.99);
  assert.equal(db.pos_sales.length, 2, 'linked, not recorded a second time');

  // An estimated fee is replaced by eBay's real one from its SALE transaction.
  db.pos_payments.find(p => p.id === 'p-old').provider_metadata.feeSource = 'estimate';
  financeTxns = [{ transactionId: 'T9', transactionType: 'SALE', orderId: '27-9', orderLineItems: [{ lineItemId: 'L1', marketplaceFees: [{ amount: { value: '1.50' } }] }] }];
  await cron();
  assert.equal(old.provider_metadata.fee, 1.5);
  assert.equal(old.provider_metadata.feeSource, 'ebay');
  assert.equal(db.pos_sale_lines.find(l => l.id === 'l-old').profit, 0.99, '$4.99 - $2.50 - $1.50 real fee, label pending');

  // Profit follows each linked sale's recorded money on every run.
  db.pos_sale_lines.find(l => l.id === 'l-old').profit = 6.34;
  old.amount = 10.71; db.pos_sales.find(s => s.id === 's-old').total = 10.71;
  financeTxns = [];
  await cron();
  assert.equal(db.pos_sale_lines.find(l => l.id === 'l-old').profit, 0.99);
  assert.equal(old.amount, 4.99, 'a sale recorded as item + shipping goes back to the item price');
  assert.equal(db.pos_sales.find(s => s.id === 's-old').total, 4.99);
} finally { globalThis.fetch = originalFetch; globalThis.caches = originalCaches; }
console.log('eBay fees, shipping and label reconcile checks passed');
