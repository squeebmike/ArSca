import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Store ask: "I got the payment. It's in Stripe!" -- a website order
// (ORD-3B953ABC) was paid, but Stripe's webhook never reaches the worker
// (stripe_webhook_events has never had a row), so the order sat "pending"
// for two days. The worker now asks Stripe itself: right after checkout,
// every 6 hours, and on "resume payment".
const worker = readFileSync(new URL('../cloudflare-worker-full.js', import.meta.url), 'utf8');
const storefront = readFileSync(new URL('../storefront.html', import.meta.url), 'utf8');
const grab = (start, end) => { const s = worker.indexOf(start); assert.ok(s >= 0, start); const e = worker.indexOf(end, s); assert.ok(e > s, end); return worker.slice(s, e); };

const src = grab('const OPEN_STRIPE_PAYMENT_STATUSES =', 'async function syncStripeWebhookPayment(');
function harness(intents) {
  const calls = { patches: [], fulfilled: [], released: [], stripe: [], reads: [] };
  const supabaseAdminFetch = async (env, path, opts = {}) => {
    if (opts.method === 'PATCH') { calls.patches.push([path, JSON.parse(opts.body)]); return { data: null }; }
    calls.reads.push(path);
    return { data: harness.rows || [] };
  };
  const stripeApi = async (env, mode, path, o = {}) => {
    calls.stripe.push([mode, path, o.account]);
    if (path.startsWith('charges/')) return { id: 'ch_1', payment_method_details: { card: { brand: 'visa', last4: '4242' } } };
    const id = decodeURIComponent(path.split('/')[1]);
    if (!(id in intents)) throw new Error('Stripe unreachable');
    return { id, status: intents[id], latest_charge: intents[id] === 'succeeded' ? 'ch_1' : null };
  };
  const api = new Function('supabaseAdminFetch', 'stripeApi', 'stripeMode', 'fulfillStorefrontOrderInventory', 'releaseStorefrontPointsIfUnpayable',
    src + '; return { settleStripePaymentFromStripe, runScheduledStripePaymentCheck, OPEN_STRIPE_PAYMENT_STATUSES };')(
    supabaseAdminFetch, stripeApi, (env, m) => m || 'live',
    async (env, saleId, storeId) => { calls.fulfilled.push([saleId, storeId]); },
    async (env, saleId, storeId) => { calls.released.push([saleId, storeId]); });
  return { api, calls };
}
const env = { SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'k' };
const pay = (id, intent, extra = {}) => ({ id, sale_id: 'sale-' + id, store_id: 'store-1', status: 'requires_payment_method', stripe_mode: 'live', stripe_connected_account_id: null, stripe_payment_intent_id: intent, ...extra });

// Paid at Stripe: the order finishes exactly as the webhook would have.
{
  const { api, calls } = harness({ pi_paid: 'succeeded' });
  assert.equal(await api.settleStripePaymentFromStripe(env, pay('p1', 'pi_paid'), { confirmedBy: 'user-1' }), 'succeeded');
  assert.deepEqual(calls.fulfilled, [['sale-p1', 'store-1']], 'sale, stock, points and eBay go through the webhook\'s own fulfillment');
  const [path, body] = calls.patches[0];
  assert.equal(path, 'pos_payments?id=eq.p1');
  assert.equal(body.status, 'succeeded');
  assert.equal(body.card_last4, '4242');
  assert.equal(body.confirmed_by, 'user-1');
}
// Not paid yet: nothing changes, nothing is fulfilled.
{
  const { api, calls } = harness({ pi_open: 'requires_payment_method' });
  assert.equal(await api.settleStripePaymentFromStripe(env, pay('p2', 'pi_open')), 'requires_payment_method');
  assert.deepEqual(calls.patches, []);
  assert.deepEqual(calls.fulfilled, []);
}
// Cancelled at Stripe: recorded, and held points go back.
{
  const { api, calls } = harness({ pi_dead: 'canceled' });
  await api.settleStripePaymentFromStripe(env, pay('p3', 'pi_dead'));
  assert.equal(calls.patches[0][1].status, 'canceled');
  assert.deepEqual(calls.released, [['sale-p3', 'store-1']]);
  assert.deepEqual(calls.fulfilled, []);
}
// A connected-account payment is looked up on that account.
{
  const { api, calls } = harness({ pi_c: 'requires_action' });
  await api.settleStripePaymentFromStripe(env, pay('p4', 'pi_c', { stripe_connected_account_id: 'acct_9', stripe_mode: 'test' }));
  assert.deepEqual(calls.stripe[0], ['test', 'payment_intents/pi_c', 'acct_9']);
  assert.equal(calls.patches[0][1].status, 'requires_action');
}

// The 6-hour check: last week's open card payments, one Stripe error doesn't stop the rest.
{
  const { api, calls } = harness({ pi_paid: 'succeeded' });
  harness.rows = [pay('a', 'pi_missing'), pay('b', 'pi_paid')];
  await api.runScheduledStripePaymentCheck(env);
  harness.rows = null;
  assert.deepEqual(calls.fulfilled, [['sale-b', 'store-1']], 'the paid one finishes even though the first errored');
  const q = calls.reads[0];
  assert.ok(q.startsWith('pos_payments?provider=eq.stripe&status=in.(requires_payment_method,requires_confirmation,requires_action,processing)&stripe_payment_intent_id=not.is.null&created_at=gt.'), q);
  assert.ok(q.includes('&created_at=lt.'), 'a checkout still in progress is left alone');
}
assert.ok(grab('async function runScheduledPointsHoldSweep(env) {', "for (const [table, prefix]").includes('await runScheduledStripePaymentCheck(env);'), 'runs on the cron, before the points sweep');

// STUCK PAYMENTS "confirm" uses the same check.
assert.ok(grab("if (url.pathname === '/store/stuck-payments/resolve'", '// GET /store/customers').includes('status = await settleStripePaymentFromStripe(env, payment, { confirmedBy: auth.user.id });'));

// Right after checkout: the page tells the worker, which asks Stripe.
{
  const route = grab("if (url.pathname === '/public/storefront/paid' && request.method === 'POST') {", '// POST /public/storefront/shipping-quote');
  assert.ok(route.includes('enforceUsageLimit(env, `storefront-paid:'), 'rate limited');
  assert.ok(route.includes('storefront_orders?store_id=eq.${enc(storeId)}&confirmation_number=eq.${enc(confirmationNumber)}'), 'found by the order\'s own store + confirmation number');
  assert.ok(route.includes('await settleStripePaymentFromStripe(env, payment)'), 'paid or not comes from Stripe, not the caller');
  assert.ok(!/body\.(paid|status|amount)/.test(route), 'nothing the caller says about payment is used');
  assert.ok(storefront.includes("fetch(`${WORKER}/public/storefront/paid`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:currentStoreId, confirmationNumber:rt.confirmationNumber})}).catch(()=>{});"));
  assert.ok(storefront.indexOf('/public/storefront/paid') > storefront.indexOf('if(result.error) throw new Error(result.error.message);'), 'only after Stripe confirms the card');
}

// Resume payment on an order already paid finishes it -- never a second charge.
{
  const route = grab("if (url.pathname === '/public/storefront/resume' && request.method === 'POST') {", '// POST /public/storefront/paid');
  const paid = route.indexOf("if (existing.status === 'succeeded') {");
  assert.ok(paid > 0 && route.indexOf('await settleStripePaymentFromStripe(env, lastPayment);', paid) > paid);
  assert.ok(route.indexOf("return json({ ok:false, error:'This order is already paid -- thank you!' }, 409);", paid) > paid);
  assert.ok(paid < route.indexOf("const params = new URLSearchParams({ amount:String(totalCents)"), 'before any new payment is made');
}
console.log('Stripe payment check passed');
