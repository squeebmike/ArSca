import assert from 'node:assert/strict';
import fs from 'node:fs';

// Paid website orders nobody has marked picked up/shipped get a daily
// reminder email. Unpaid (abandoned/test) checkouts never do.
const DAY = 86400000;
const NOW = Date.parse('2026-10-01T18:00:00Z'); // the 11am Pacific cron run
const STORE = '0f9dd4bc-42a7-487e-a972-2905d24513e9';
const orders = [
  { id: 'o-paid-old', store_id: STORE, sale_id: 's-paid-old', confirmation_number: 'ORD-PAID1', customer_name: 'Alex', fulfillment_method: 'pickup_fedway', created_at: new Date(NOW - 3 * DAY).toISOString() },
  { id: 'o-unpaid-old', store_id: STORE, sale_id: 's-unpaid-old', confirmation_number: 'ORD-TEST1', customer_name: 'Test', fulfillment_method: 'pickup_fedway', created_at: new Date(NOW - 60 * DAY).toISOString() },
];
const sales = [{ id: 's-paid-old', total: 16, status: 'completed' }];
const emails = [];
const kv = new Map();
let orderQuery = '';

const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const ok = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  if (url.includes('/rest/v1/storefront_orders?fulfillment_status=neq.fulfilled')) { orderQuery = url; return ok(orders); }
  if (url.includes('/rest/v1/pos_sales?id=in.')) return ok(url.includes('status=eq.completed') ? sales : []);
  if (url.includes('/rest/v1/store_settings')) return ok([{ receipt_settings: { email: 'shop@example.com' } }]);
  if (url.includes('comms.twilio.com/v1/Emails')) {
    emails.push(String(init.body || ''));
    return new Response('{}', { status: 202, headers: { 'Content-Type': 'application/json' } });
  }
  return ok([]);
};

const env = {
  SUPABASE_URL: 'https://database.example', SUPABASE_SERVICE_ROLE_KEY: 'test-only',
  TWILIO_ACCOUNT_SID: 'AC-test', TWILIO_AUTH_TOKEN: 'test', TWILIO_EMAIL_FROM_ADDRESS: 'hello@example.com',
  LBA_KV: { get: async k => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async k => { kv.delete(k); } },
};

const realNow = Date.now;
async function runCron(scheduledTime) {
  Date.now = () => scheduledTime;
  const pending = [];
  const { default: api } = await import('../cloudflare-worker-full.js');
  await api.scheduled({ scheduledTime, cron: '0 */6 * * *' }, env, { waitUntil: p => pending.push(p) });
  await Promise.allSettled(pending);
  Date.now = realNow;
}

try {
  await runCron(NOW);
  assert.ok(orderQuery.includes('created_at=lte.'), 'only orders older than the waiting window are scanned');
  const reminderKeys = [...kv.keys()].filter(k => k.startsWith('stale-web-orders:'));
  assert.deepEqual(reminderKeys, [`stale-web-orders:${STORE}:2026-10-01`], 'one reminder claimed for the store today');
  const sent = emails.join('\n');
  assert.equal(emails.length, 1, 'exactly one reminder email');
  assert.match(sent, /ORD-PAID1/);
  assert.doesNotMatch(sent, /ORD-TEST1/, 'an unpaid checkout is never in the reminder');

  // Same day, later run: no second email.
  await runCron(NOW + 6 * 3600000);
  assert.equal(emails.length, 1, 'still one email that day');

  // Early-morning UTC run (evening Pacific) does not send.
  kv.clear(); emails.length = 0;
  await runCron(Date.parse('2026-10-02T06:00:00Z'));
  assert.equal(emails.length, 0, 'no reminder from the overnight run');
} finally {
  globalThis.fetch = originalFetch;
  globalThis.caches = originalCaches;
  Date.now = realNow;
}
console.log('Stale web order reminder: paid orders only, once a day');

const dash = fs.readFileSync('dashboard.html', 'utf8');
assert.match(dash, /updateWebOrdersAlert\(pending\.length, stale\.length\)/, 'orders list feeds the header alert');
assert.match(dash, /btn\.onclick = \(\) => switchTab\('orders'\)/, 'header alert opens the Orders tab');
assert.match(dash, /WAITING \$\{webOrderWaitingDays\(o\)\} DAYS/, 'old orders are flagged in the list');
console.log('Dashboard web order alert checks passed');
