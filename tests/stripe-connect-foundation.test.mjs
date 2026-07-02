import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const tablet = fs.readFileSync('sca.html', 'utf8');
const schema = fs.readFileSync('supabase/stripe-connect-and-consignments.sql', 'utf8');

for (const route of ['/stripe/connect/account','/stripe/connect/onboarding-link','/stripe/connect/status','/stripe/connect/dashboard-link','/stripe/payments/create-intent','/stripe/payments/status','/stripe/refunds/create','/stripe/webhook']) {
  assert.ok(worker.includes(route), `missing Worker route ${route}`);
}
assert.ok(worker.includes("'controller[fees][payer]':'account'"), 'connected account fee payer must be explicit');
assert.ok(worker.includes("mode==='live'&&!row.fee_payer_verified"), 'live charge fee-payer guard missing');
assert.ok(worker.includes("'Stripe-Account'"), 'direct-charge connected account header missing');
assert.ok(worker.includes('verifyStripeWebhook'), 'webhook verification missing');
assert.ok(worker.includes('stripe_webhook_events'), 'webhook idempotency persistence missing');
assert.ok(worker.includes('requireStoreUser'), 'store membership authorization missing');
assert.ok(worker.includes("['owner','admin']"), 'owner/admin refund/onboarding authorization missing');
assert.ok(dashboard.includes('elements.create(\'payment\''), 'Stripe Payment Element missing');
assert.ok(dashboard.includes("verified.status!=='succeeded'"), 'checkout must verify success before finalizing');
assert.ok(dashboard.includes('openStripeRefundModal'), 'refund UI missing');
assert.ok(dashboard.includes('loadStripePaymentHistory'), 'payment history missing');
assert.ok(!/pk_live_[A-Za-z0-9]{20,}/.test(tablet), 'live publishable key must not be hardcoded in tablet');
for (const table of ['consignor_people','consignment_items','consignment_alerts','store_stripe_accounts','pos_refunds','inventory_movements','stripe_webhook_events']) {
  assert.ok(schema.includes(`public.${table}`), `missing schema table ${table}`);
}
assert.ok(schema.includes('enable row level security'), 'RLS missing');
assert.ok(dashboard.includes('loadConsignmentsFromCloud'), 'cloud consignment load missing');
assert.ok(dashboard.includes(".eq('store_id',storeId)"), 'active store filter missing from cloud consignment load');
console.log('Stripe Connect and cloud consignment contract checks passed');

