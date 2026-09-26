import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loyaltyPointsFor, storeLoyaltyRate, awardWebOrderLoyalty } from '../scripts/web-loyalty.mjs';

// --- Rate math: "% back", points redeem at 100 = $1 ---------------------------
assert.equal(loyaltyPointsFor(33.95, 3), 102, '3% back on $33.95 is $1.02 = 102 points');
assert.equal(loyaltyPointsFor(20, 3), 60);
assert.equal(loyaltyPointsFor(20, 0), 0, 'rate 0 means loyalty is off');
assert.equal(loyaltyPointsFor(-5, 3), 0);
assert.equal(storeLoyaltyRate(undefined), 3, 'a store that never saved a rate gets the dashboard default');
assert.equal(storeLoyaltyRate({}), 3);
assert.equal(storeLoyaltyRate({ loyaltyRate: 0 }), 0, 'an explicit 0 must switch loyalty off, not fall back to 3');
assert.equal(storeLoyaltyRate({ loyaltyRate: 5 }), 5);

// In-store accrual must use the same math as the web (the receipt screen
// promises "N% back"; the old formula paid N/100 of that).
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const accrue = dashboard.match(/async function accrueLoyaltyForContact[\s\S]*?\n}/)[0];
assert.match(accrue, /Math\.round\(Number\(total \|\| 0\) \* rate \* LOYALTY_POINTS_PER_DOLLAR \/ 100\)/);
assert.doesNotMatch(accrue, /\* rate \/ 100\)/);
console.log('Loyalty rate math checks passed');

// --- awardWebOrderLoyalty ------------------------------------------------------
function mockDb({ customers = [], loyaltyRate = 3, alreadyAwarded = false, fail = null } = {}) {
  const calls = [];
  const fetch = async (env, path, options = {}) => {
    calls.push({ path, options });
    if (fail && path.startsWith(fail)) throw new Error('boom');
    if (path.startsWith('store_settings?')) return { data: [{ receipt_settings: { loyaltyRate } }] };
    if (path.startsWith('customers?') && path.includes('linked_user_id=eq.')) {
      const id = decodeURIComponent(path.match(/linked_user_id=eq\.([^&]+)/)[1]);
      return { data: customers.filter(c => c.linked_user_id === id) };
    }
    if (path.startsWith('customers?')) return { data: customers };
    if (path === 'customers' && options.method === 'POST') return { data: [{ id: 'new-cust', ...JSON.parse(options.body) }] };
    if (path.startsWith('pos_sales?')) return { data: null };
    if (path === 'rpc/accrue_web_order_loyalty') return { data: alreadyAwarded ? null : 102 };
    return { data: [] };
  };
  return { fetch, calls };
}
const order = { storeId: 'store-1', saleId: 'sale-1', amountDollars: 33.95, userId: 'user-1', name: 'Sean', email: 'Sean_V@Example.com', phone: '1 (360) 555-0308' };

{
  // Signed-in buyer with a linked customer: credited there.
  const { fetch, calls } = mockDb({ customers: [{ id: 'linked', linked_user_id: 'user-1', email: 'x@y.z', phone: '' }] });
  const result = await awardWebOrderLoyalty({}, fetch, order);
  assert.deepEqual(result, { customerId: 'linked', points: 102, balance: 102 });
  const rpc = calls.find(c => c.path === 'rpc/accrue_web_order_loyalty');
  assert.deepEqual(JSON.parse(rpc.options.body), { p_store_id: 'store-1', p_customer_id: 'linked', p_points: 102, p_sale_id: 'sale-1' });
  const stamp = calls.find(c => c.path.startsWith('pos_sales?'));
  assert.match(stamp.path, /customer_id=is\.null/, 'must never overwrite a customer already on the sale');
  assert.equal(JSON.parse(stamp.options.body).customer_id, 'linked');
}
{
  // No linked record: an existing customer matched by exact email or phone
  // (last 10 digits) is credited, but a LIKE-wildcard near-miss is not, and
  // neither is a customer linked to somebody else's account.
  const { fetch } = mockDb({ customers: [
    { id: 'other-account', linked_user_id: 'user-2', email: 'sean_v@example.com', phone: '3605550308' },
    { id: 'near-miss', linked_user_id: null, email: 'seanXv@example.com', phone: '' },
    { id: 'phone-match', linked_user_id: null, email: '', phone: '360-555-0308' },
  ] });
  const result = await awardWebOrderLoyalty({}, fetch, { ...order, userId: null });
  assert.equal(result.customerId, 'phone-match');
}
{
  // Nobody matches: a new customer is created (linked to the buyer's own account).
  const { fetch, calls } = mockDb();
  const result = await awardWebOrderLoyalty({}, fetch, order);
  assert.equal(result.customerId, 'new-cust');
  const created = JSON.parse(calls.find(c => c.path === 'customers').options.body);
  assert.equal(created.email, 'sean_v@example.com');
  assert.equal(created.linked_user_id, 'user-1');
}
{
  // Redelivered webhook: the DB function reports "already awarded".
  const { fetch } = mockDb({ customers: [{ id: 'linked', linked_user_id: 'user-1' }], alreadyAwarded: true });
  const result = await awardWebOrderLoyalty({}, fetch, order);
  assert.equal(result.points, 0);
}
{
  // Loyalty off: customer still stamped on the sale, no points call.
  const { fetch, calls } = mockDb({ customers: [{ id: 'linked', linked_user_id: 'user-1' }], loyaltyRate: 0 });
  const result = await awardWebOrderLoyalty({}, fetch, order);
  assert.equal(result.points, 0);
  assert.ok(calls.some(c => c.path.startsWith('pos_sales?')));
  assert.ok(!calls.some(c => c.path.startsWith('rpc/')));
}
{
  // Must never throw into a payment webhook.
  const { fetch } = mockDb({ fail: 'store_settings' });
  assert.equal(await awardWebOrderLoyalty({}, fetch, order), null);
  assert.equal(await awardWebOrderLoyalty({}, mockDb().fetch, { ...order, saleId: '' }), null);
}
console.log('awardWebOrderLoyalty checks passed');

// --- Wired into all three web payment paths --------------------------------------
const foc = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');
const backlist = fs.readFileSync('scripts/backlist-catalog.mjs', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.match(foc.match(/export async function syncFocStripeEvent[\s\S]*?\n}/)[0], /awardWebOrderLoyalty\(env,deps\.supabaseAdminFetch,\{[^}]*subtotal_cents/, 'comic preorders must earn points on payment (merchandise subtotal)');
assert.match(backlist.match(/export async function syncBacklistStripeEvent[\s\S]*?\n}/)[0], /awardWebOrderLoyalty\(env, deps\.supabaseAdminFetch, \{[\s\S]*?subtotal_cents/, 'backlist orders must earn points on payment');
assert.match(worker.match(/async function fulfillStorefrontOrderInventory[\s\S]*?\n}/)[0], /awardWebOrderLoyalty\(env, supabaseAdminFetch, \{/, 'shop orders must earn points on payment');

const migration = fs.readFileSync('supabase-migrations/2026-09-26-web-order-loyalty.sql', 'utf8');
assert.match(migration, /create unique index if not exists idx_loyalty_ledger_web_order_once\s+on public\.loyalty_ledger\(store_id, sale_id\) where reason = 'web_order'/);
assert.match(migration, /on conflict \(store_id, sale_id\) where reason = 'web_order' do nothing/);
assert.match(migration, /revoke all on function public\.accrue_web_order_loyalty\(uuid, uuid, integer, text\) from public, anon, authenticated/, 'customers must not be able to call the award function directly');
console.log('Web order loyalty wiring checks passed');
