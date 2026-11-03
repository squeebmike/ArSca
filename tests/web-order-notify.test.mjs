import assert from 'node:assert/strict';
import fs from 'node:fs';
import { webOrderEmail, runWebOrderNotify, WEB_ORDER_NOTIFY } from '../scripts/web-order-notify.mjs';

// Store, 2026-11-03: "I also want an email sent to hintline@themanapocket.com
// whenever we get an order through the website."
assert.deepEqual(WEB_ORDER_NOTIFY, { '0f9dd4bc-42a7-487e-a972-2905d24513e9': 'hintline@themanapocket.com' });
const m = webOrderEmail({ confirmation_number: 'ORD-1', customer_name: 'Sam', customer_email: 's@x.com', customer_phone: '555', fulfillment_method: 'shipping', shipping_address: { name: 'Sam', line1: '1 Main', city: 'Seattle', state: 'WA', postal_code: '98101' }, shipping_fee_cents: 500, notes: 'gift' }, { total: 45 }, [{ title: 'Spider-Man #300', quantity: 1, unit_price: 40 }]);
assert.equal(m.subject, 'New website order ORD-1 · $45.00 — Spider-Man #300');
for (const s of ['Customer: Sam', 'Email: s@x.com', 'Phone: 555', 'How: Shipping', '1 Main', 'Seattle, WA 98101', '1 × Spider-Man #300 — $40.00', 'Shipping: $5.00', 'Total paid: $45.00', 'Note from the customer: gift', 'WEB ORDERS WAITING']) assert.ok(m.body.includes(s), s);
assert.match(webOrderEmail({ fulfillment_method: 'pickup_kitsap' }, { total: 5 }, [{ title: 'A' }, { title: 'B' }]).subject, /— A \+1 more$/);

const now = Date.parse('2026-11-04T18:00:00Z');
const orders = [
  { id: 'o-old', sale_id: 's-old', confirmation_number: 'OLD', created_at: '2026-11-02T10:00:00Z' },
  { id: 'o-paid', sale_id: 's-paid', confirmation_number: 'PAID', created_at: '2026-11-04T17:00:00Z', fulfillment_method: 'pickup_fedway', customer_name: 'Jo' },
  { id: 'o-unpaid', sale_id: 's-unpaid', confirmation_number: 'UNPAID', created_at: '2026-11-04T17:30:00Z' },
];
const sales = { 's-paid': { id: 's-paid', status: 'completed', total: 12 }, 's-unpaid': { id: 's-unpaid', status: 'pending', total: 9 } };
const kv = {}, sent = [], paths = [];
const deps = {
  db: async path => { paths.push(path); if (path.startsWith('storefront_orders?')) { const from = decodeURIComponent(path.match(/created_at=gte\.([^&]+)/)[1]); return orders.filter(o => o.created_at >= from); } if (path.startsWith('pos_sales?')) { const id = path.match(/id=eq\.([^&]+)/)[1]; return sales[id] ? [sales[id]] : []; } return [{ title: 'Card', quantity: 1, unit_price: 12 }]; },
  kvGet: async k => kv[k] || null, kvPut: async (k, v) => { kv[k] = v; },
  send: async (to, subject, body) => sent.push({ to, subject }),
};
let out = await runWebOrderNotify(deps, { now });
assert.deepEqual(sent, [{ to: 'hintline@themanapocket.com', subject: 'New website order PAID · $12.00 — Card' }], 'only the paid order, only to hintline');
assert.ok(!paths.some(p => p.includes('s-old')), 'orders from before this started are not sent');
out = await runWebOrderNotify(deps, { now: now + 600000 });
assert.equal(sent.length, 1, 'each order once');
sales['s-unpaid'].status = 'completed';
await runWebOrderNotify(deps, { now: now + 1200000 });
assert.equal(sent.length, 2, 'emailed once it is paid');
// A failed send is tried again next run (not marked sent).
const fail = { ...deps, send: async () => { throw new Error('Email is not configured yet'); } };
orders.push({ id: 'o-3', sale_id: 's-paid', confirmation_number: 'THREE', created_at: '2026-11-04T17:40:00Z' });
out = await runWebOrderNotify(fail, { now: now + 1800000 });
assert.match(out[0].error, /not configured/); assert.equal(kv['web-order-notified:o-3'], undefined);

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.match(worker, /runFocEbayMatchOnce\(env, ctx\), runScheduledWebOrderNotify\(env\)\]\);/, 'every 10 minutes');
assert.match(fs.readFileSync('.github/workflows/deploy-worker.yml', 'utf8'), /scripts\/web-order-notify\.mjs/);
console.log('Website order email to hintline: paid only, once each, contents, retry on failure, wiring passed');
