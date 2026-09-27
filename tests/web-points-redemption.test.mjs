import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  redeemablePoints, planWebRedemption, recordWebPointsTender, releaseWebOrderPoints, pointsHoldActive,
  loyaltyPaymentRow, awardWebOrderLoyalty, MIN_CARD_CHARGE_CENTS,
} from '../scripts/web-loyalty.mjs';

// --- How many points an order can take ----------------------------------------
// 1 point = 1 cent; points cover merchandise only; the card always pays >= 50c.
assert.equal(MIN_CARD_CHARGE_CENTS, 50);
assert.equal(redeemablePoints({ requested: 500, balance: 1000, merchandiseCents: 2000, totalCents: 2500 }), 500);
assert.equal(redeemablePoints({ requested: 5000, balance: 1000, merchandiseCents: 2000, totalCents: 2500 }), 1000, 'capped at the balance');
assert.equal(redeemablePoints({ requested: 5000, balance: 9000, merchandiseCents: 2000, totalCents: 2500 }), 2000, 'never pays for shipping');
assert.equal(redeemablePoints({ requested: 5000, balance: 9000, merchandiseCents: 2000, totalCents: 2000 }), 1950, 'leaves the card minimum');
assert.equal(redeemablePoints({ requested: 100, balance: 100, merchandiseCents: 30, totalCents: 30 }), 0, 'an order under the card minimum takes no points');
assert.equal(redeemablePoints({ requested: -5, balance: 100, merchandiseCents: 2000, totalCents: 2000 }), 0);
assert.equal(redeemablePoints({ requested: 12.9, balance: 100, merchandiseCents: 2000, totalCents: 2000 }), 12, 'whole points only');
console.log('Redeemable points math checks passed');

function mockDb({ customers = [], loyaltyRate = 3, ledger = [], finalize = true } = {}) {
  const calls = [];
  const fetch = async (env, path, options = {}) => {
    calls.push({ path, options });
    if (path.startsWith('store_settings?')) return { data: [{ receipt_settings: { loyaltyRate } }] };
    if (path.startsWith('customers?') && path.includes('linked_user_id=eq.')) {
      const id = decodeURIComponent(path.match(/linked_user_id=eq\.([^&]+)/)[1]);
      return { data: customers.filter(c => c.linked_user_id === id) };
    }
    if (path.startsWith('loyalty_ledger?')) {
      const ref = decodeURIComponent(path.match(/order_ref=eq\.([^&]+)/)[1]);
      const reason = path.match(/reason=eq\.([^&]+)/)?.[1];
      return { data: ledger.filter(r => r.order_ref === ref && (!reason || r.reason === reason)) };
    }
    if (path === 'rpc/finalize_web_order_points') return { data: finalize };
    if (path === 'rpc/release_web_order_points') throw new Error('network down');
    if (path === 'rpc/accrue_web_order_loyalty') return { data: 50 };
    return { data: null };
  };
  return { fetch, calls };
}

// --- Who may spend --------------------------------------------------------------
{
  const { fetch } = mockDb();
  assert.deepEqual(await planWebRedemption({}, fetch, { storeId: 's', userId: null, requested: 0 }), { customer: null, points: 0 }, 'no points asked for: guest checkout is untouched');
  assert.match((await planWebRedemption({}, fetch, { storeId: 's', userId: null, requested: 100 })).error, /Sign in/);
  assert.match((await planWebRedemption({}, fetch, { storeId: 's', userId: 'u1', requested: 100 })).error, /Link your account/, 'only a linked customer record can spend');
}
{
  const { fetch } = mockDb({ loyaltyRate: 0, customers: [{ id: 'c1', linked_user_id: 'u1', loyalty_points_balance: 800 }] });
  assert.match((await planWebRedemption({}, fetch, { storeId: 's', userId: 'u1', requested: 100, merchandiseCents: 2000, totalCents: 2000 })).error, /not being accepted/, 'loyalty switched off means no redeeming either');
}
{
  const { fetch } = mockDb({ customers: [{ id: 'c1', linked_user_id: 'u1', loyalty_points_balance: 800 }] });
  const plan = await planWebRedemption({}, fetch, { storeId: 's', userId: 'u1', requested: 5000, merchandiseCents: 2000, totalCents: 2600 });
  assert.equal(plan.customer.id, 'c1');
  assert.equal(plan.points, 800, 'asking for more than the balance uses the whole balance');
}
console.log('Redemption eligibility checks passed');

// --- Paid order: points become a Loyalty Points tender ------------------------------
{
  const { fetch, calls } = mockDb({ ledger: [{ order_ref: 'foc:o1', reason: 'web_redeem', customer_id: 'c1' }] });
  assert.equal(await recordWebPointsTender({}, fetch, { storeId: 's', orderRef: 'foc:o1', saleId: 'o1', paymentId: 'foc-points-o1', points: 450, at: 't' }), 'c1');
  const row = JSON.parse(calls.find(c => c.path.startsWith('pos_payments')).options.body);
  assert.deepEqual(row, loyaltyPaymentRow({ id: 'foc-points-o1', saleId: 'o1', storeId: 's', points: 450, customerId: 'c1', at: 't' }));
  assert.equal(row.method, 'loyalty_redeem', 'same tender key the register records');
  assert.equal(row.amount, 4.5);
}
{
  // Hold was released before the payment landed: no tender is written.
  const { fetch, calls } = mockDb({ ledger: [{ order_ref: 'foc:o2', reason: 'web_redeem', customer_id: 'c1' }], finalize: false });
  assert.equal(await recordWebPointsTender({}, fetch, { storeId: 's', orderRef: 'foc:o2', saleId: 'o2', paymentId: 'p', points: 450, at: 't' }), null);
  assert.ok(!calls.some(c => c.path.startsWith('pos_payments')));
}
{
  const { fetch } = mockDb();
  assert.equal(await releaseWebOrderPoints({}, fetch, 's', 'foc:o3'), null, 'release never throws');
  assert.equal(await pointsHoldActive({}, mockDb({ ledger: [{ order_ref: 'x', reason: 'web_redeem' }] }).fetch, 's', 'x'), true);
  assert.equal(await pointsHoldActive({}, mockDb({ ledger: [{ order_ref: 'x', reason: 'web_redeem' }, { order_ref: 'x', reason: 'web_redeem_release' }] }).fetch, 's', 'x'), false);
}
{
  // Earning after spending goes to the spender, not an email/phone match.
  const { fetch, calls } = mockDb();
  await awardWebOrderLoyalty({}, fetch, { storeId: 's', saleId: 'sale', amountDollars: 10, customerId: 'spender', email: 'someone@else.com' });
  assert.equal(JSON.parse(calls.find(c => c.path === 'rpc/accrue_web_order_loyalty').options.body).p_customer_id, 'spender');
  assert.ok(!calls.some(c => c.path.startsWith('customers')), 'no customer lookup when the spender is known');
}
console.log('Points tender checks passed');

// --- Wiring in every checkout -----------------------------------------------------
const migration = fs.readFileSync('supabase-migrations/2026-09-27-web-points-redemption.sql', 'utf8');
for (const fn of ['hold_web_order_points', 'release_web_order_points', 'finalize_web_order_points']) {
  assert.match(migration, new RegExp(`security definer[\\s\\S]*?`), fn);
  assert.match(migration, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role;`), `${fn} is service_role only`);
  assert.match(migration, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`));
}
assert.match(migration, /for update/, 'balance is row-locked so points cannot be spent twice');
assert.match(migration, /v_hold\.sale_id is not null/, 'a paid order can never be released');

const foc = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');
const backlist = fs.readFileSync('scripts/backlist-catalog.mjs', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
for (const [name, src, ref] of [['foc', foc, 'foc:'], ['backlist', backlist, 'backlist:']]) {
  assert.match(src, /const totalCents = orderCents - pointsRedeemed;/, `${name}: card is charged the remainder`);
  assert.match(src, /points_redeemed ?: ?pointsRedeemed/, `${name}: order records the points`);
  assert.match(src, new RegExp(`holdWebOrderPoints\\([\\s\\S]{0,200}orderRef`), `${name}: points held before payment`);
  assert.match(src, /status ?=== ?'cancelled' ?&& ?order\?\.points_redeemed/, `${name}: cancelled payment releases points`);
  assert.match(src, /Number\(order\.total_cents ?\|\| ?0\) ?\+ ?pointsCents\) ?\/ ?100/, `${name}: sale total is the whole order`);
  assert.match(src, new RegExp(`recordWebPointsTender\\([^)]*orderRef: ?\`${ref}`), `${name}: points recorded as a tender`);
  assert.match(src, /subtotal_cents ?\|\| ?0\) ?- ?Number\(existingOrder\.points_redeemed/, `${name}: no points earned on points`);
}
assert.match(worker, /amount:String\(chargeCents\)/, 'shop: card charged the remainder');
assert.match(worker, /points_redeemed:pointsRedeemed, fulfillment_status:'pending'/);
assert.match(worker, /releaseStorefrontPointsIfUnpayable/);
assert.match(worker, /ctx\.waitUntil\(Promise\.all\(\[[^\]]*runScheduledPointsHoldSweep\(env\)[^\]]*\]\)\)/, 'abandoned holds are swept by the cron');
assert.match(worker, /redeemRequested && request\.headers\.get\('Authorization'\)/, 'guest checkout never requires sign-in');
console.log('Checkout wiring checks passed');
