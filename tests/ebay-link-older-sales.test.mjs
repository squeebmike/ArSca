import fs from 'node:fs';
import assert from 'node:assert/strict';
import { ebayOrderMoney, ebayLineProfit } from '../scripts/ebay-order-money.mjs';

// eBay sales recorded before sales carried their order, and shipped since,
// never pass back through the regular (unshipped-only) sync. The finances
// reconcile now looks up exactly those orders -- by the order id kept on the
// sale line (source_id "ebay:<orderId>") -- and attaches each sale to the one
// line item it matches. It must never record a new sale.

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const grab = re => { const m = worker.match(re); assert.ok(m, 'missing ' + re); return m[0]; };
const src = [
  grab(/function ebaySaleMetadata\(order, m, previous = \{\}\) \{[\s\S]*?\n\}\n/),
  grab(/async function attachEbaySaleToOrder\(env, storeId, payment, line, order, m\) \{[\s\S]*?\n\}\n/),
  grab(/async function linkUnlinkedEbaySalesForStore\(env, storeId, ebayToken, \{ days = 120 \} = \{\}\) \{[\s\S]*?\n\}\n/),
].join('\n');

function harness({ payments, lines, orders }) {
  const writes = [];
  const ebayCalls = [];
  const supabaseAdminFetch = async (env, path, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'GET' && path.startsWith('pos_payments?')) return { data: payments.filter(p => p.reference == null).map(p => ({ id: p.id, sale_id: p.sale_id, amount: p.amount })) };
    if (method === 'GET' && path.startsWith('pos_sale_lines?')) {
      const ids = decodeURIComponent(path.match(/sale_id=in\.\(([^)]*)\)/)[1]).split(',');
      return { data: lines.filter(l => ids.includes(l.sale_id)) };
    }
    if (method === 'GET' && path.startsWith('store_settings?')) return { data: [] };
    if (method === 'PATCH') {
      const body = JSON.parse(options.body);
      writes.push({ path, body });
      if (path.startsWith('pos_payments?')) {
        const id = path.match(/id=eq\.([^&]+)/)[1];
        const p = payments.find(x => x.id === id);
        assert.match(path, /&reference=is\.null/, 'a payment is only claimed while unlinked');
        if (!p || p.reference != null) return { data: [] };
        Object.assign(p, body);
        return { data: [p] };
      }
      return { data: null };
    }
    if (method === 'POST') throw new Error('must never create records: ' + path);
    throw new Error('unexpected ' + method + ' ' + path);
  };
  const ebayFetchWithRetry = async url => {
    ebayCalls.push(url);
    const ids = decodeURIComponent(url.split('orderIds=')[1]).split(',');
    return { ok: true, json: async () => ({ orders: orders.filter(o => ids.includes(o.orderId)) }) };
  };
  const link = new Function('supabaseAdminFetch', 'ebayFetchWithRetry', 'ebayOrderMoney', 'ebayLineProfit', 'EBAY_DEFAULT_FEE_PCT',
    `${src}; return linkUnlinkedEbaySalesForStore;`)(supabaseAdminFetch, ebayFetchWithRetry, ebayOrderMoney, ebayLineProfit, 13.25);
  return { link, writes, ebayCalls, payments };
}

const lineItem = (id, price, ship) => ({ lineItemId: id, sku: '', title: 'x', quantity: 1, lineItemCost: { value: String(price) }, deliveryCost: { shippingCost: { value: String(ship) } } });

// 1. The real case: a $149 plush, one line, recorded with an estimated fee.
{
  const h = harness({
    payments: [{ id: 'pay1', sale_id: 'sale1', amount: '149.00', reference: null }],
    lines: [{ id: 'line1', sale_id: 'sale1', cost_basis: '0.00', source_id: 'ebay:19-15197-35449' }],
    orders: [{ orderId: '19-15197-35449', orderPaymentStatus: 'PAID', creationDate: '2026-09-25T18:17:47.000Z', totalMarketplaceFee: { value: '21.50' }, lineItems: [lineItem('L1', 149, 10)] }],
  });
  assert.equal(await h.link({}, 'S', 'tok'), 1, 'the unlinked sale is attached');
  const p = h.payments[0];
  assert.equal(p.reference, '19-15197-35449');
  assert.equal(p.amount, 149, 'sales stay the item price');
  assert.equal(p.provider_metadata.fee, 21.5, 'the real eBay fee replaces the estimate');
  assert.equal(p.provider_metadata.shipping, 10);
  assert.equal(p.provider_metadata.ebayLineItemId, 'L1');
  const lineWrite = h.writes.find(w => w.path.startsWith('pos_sale_lines?id=eq.line1'));
  assert.equal(lineWrite.body.profit, 127.5, 'profit = item + shipping - cost - fee - label (label assumed = shipping until bought)');
  assert.ok(h.writes.some(w => w.path.startsWith('pos_sales?id=eq.sale1') && w.body.total === 149));
  assert.ok(h.writes.every(w => w.path.includes('store_id=eq.S')), 'every write is scoped to the store');
  // Running again is a no-op: nothing left unlinked, no eBay calls.
  const before = h.ebayCalls.length;
  assert.equal(await h.link({}, 'S', 'tok'), 0);
  assert.equal(h.ebayCalls.length, before, 'no eBay lookup when nothing is unlinked');
}

// 2. Multi-line order: attached to the line with the same item price only.
{
  const h = harness({
    payments: [{ id: 'p2', sale_id: 's2', amount: '25.00', reference: null }],
    lines: [{ id: 'l2', sale_id: 's2', cost_basis: '5.00', source_id: 'ebay:ORD-2' }],
    orders: [{ orderId: 'ORD-2', orderPaymentStatus: 'PAID', lineItems: [lineItem('A', 10, 2), lineItem('B', 25, 3)] }],
  });
  assert.equal(await h.link({}, 'S', 'tok'), 1);
  assert.equal(h.payments[0].provider_metadata.ebayLineItemId, 'B');
}

// 3. Ambiguous (no price match, several lines), unpaid, non-eBay line, or
//    two sale lines: all left alone, and nothing is ever created.
{
  const h = harness({
    payments: [
      { id: 'p3', sale_id: 's3', amount: '99.00', reference: null },
      { id: 'p4', sale_id: 's4', amount: '12.00', reference: null },
      { id: 'p5', sale_id: 's5', amount: '8.00', reference: null },
      { id: 'p6', sale_id: 's6', amount: '8.00', reference: null },
    ],
    lines: [
      { id: 'l3', sale_id: 's3', cost_basis: '0', source_id: 'ebay:ORD-3' },
      { id: 'l4', sale_id: 's4', cost_basis: '0', source_id: 'ebay:ORD-4' },
      { id: 'l5', sale_id: 's5', cost_basis: '0', source_id: 'pos' },
      { id: 'l6a', sale_id: 's6', cost_basis: '0', source_id: 'ebay:ORD-6' },
      { id: 'l6b', sale_id: 's6', cost_basis: '0', source_id: 'ebay:ORD-6' },
    ],
    orders: [
      { orderId: 'ORD-3', orderPaymentStatus: 'PAID', lineItems: [lineItem('A', 10, 1), lineItem('B', 20, 1)] },
      { orderId: 'ORD-4', orderPaymentStatus: 'PENDING', lineItems: [lineItem('A', 12, 1)] },
    ],
  });
  assert.equal(await h.link({}, 'S', 'tok'), 0);
  assert.equal(h.writes.length, 0, 'no writes for anything it cannot match exactly');
  assert.ok(!h.ebayCalls.join().includes('ORD-6'), 'a sale with two lines is not looked up');
}

// Wiring: runs first in the finances reconcile (scheduled + manual sync), never blocking it.
const reconcile = grab(/async function reconcileEbayFinancesForStore\(env, storeId, ebayToken\) \{[\s\S]*?\n\}\n/);
assert.match(reconcile, /const olderLinked = await linkUnlinkedEbaySalesForStore\(env, storeId, ebayToken\)\s*\n\s*\.catch\(/, 'linking runs first and a failure does not stop the reconcile');
assert.ok(reconcile.indexOf('linkUnlinkedEbaySalesForStore') < reconcile.indexOf('fetchEbayFinanceTransactions'), 'linked sales get their labels/fees in the same run');
assert.match(reconcile, /return \{ olderLinked, labelsApplied, feesApplied, profitsCorrected \};/);

console.log('eBay older-sale linking checks passed');
