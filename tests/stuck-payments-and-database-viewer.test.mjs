import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// Every /admin/* path is unconditionally claimed by the platform-admin
// catch-all (`url.pathname === '/admin/session' || url.pathname.startsWith
// ('/admin/')` -> handlePlatformAdmin -> requirePlatformAdmin), which is a
// wholly different, cross-tenant SaaS-operator role from a store's own
// owner/admin. A store-scoped route ever named /admin/... is silently
// unreachable for every real store owner -- it 403s as "Platform
// administrator access required" before its own handler runs. These three
// routes must live outside that prefix.
for (const path of ['/store/stuck-payments', '/store/stuck-payments/resolve', '/store/customers']) {
  assert.doesNotMatch(path, /^\/admin\//, `${path} must not sit under the reserved /admin/ prefix (platform-admin catch-all would swallow it)`);
}

// GET /store/stuck-payments -- surfaces pos_payments rows Stripe's webhook
// never confirmed (the chronic issue behind the SpongeBob Cookbook incident:
// stripe_webhook_events has never once recorded a processed event). It must
// be owner/admin gated, only look at genuinely stale rows, and never touch
// money/inventory itself (that's the resolve route's job).
{
  const start = worker.indexOf("if (url.pathname === '/store/stuck-payments' && request.method === 'GET') {");
  assert.notEqual(start, -1, 'missing GET /store/stuck-payments route');
  const end = worker.indexOf("if (url.pathname === '/store/stuck-payments/resolve'", start);
  const body = worker.slice(start, end);
  assert.match(body, /requireStoreUser\(request, env, storeId, \['owner','admin'\]\)/, 'stuck-payments listing must be owner/admin gated -- it exposes customer names/emails and payment amounts');
  assert.match(body, /status=eq\.requires_payment_method/, 'must filter on the never-confirmed Stripe status');
  assert.match(body, /provider=eq\.stripe/, 'must scope to Stripe-provider payments (other tenders do not go through this webhook path)');
  assert.match(body, /created_at=lt\.\$\{encodeURIComponent\(staleBefore\)\}/, 'must only surface payments older than the staleness cutoff, not in-flight checkouts');
  assert.doesNotMatch(body, /PATCH/, 'the listing route must be read-only -- it must never PATCH a payment or sale itself');
}

// POST /store/stuck-payments/resolve -- must re-verify against Stripe before
// writing anything (never trust the dashboard click alone), then replay the
// same succeeded-payment reconciliation the webhook itself would have done.
{
  const start = worker.indexOf("if (url.pathname === '/store/stuck-payments/resolve' && request.method === 'POST') {");
  assert.notEqual(start, -1, 'missing POST /store/stuck-payments/resolve route');
  const end = worker.indexOf('// POST /ebay/orders/ship', start);
  const body = worker.slice(start, end);
  assert.match(body, /requireStoreUser\(request, env, storeId, \['owner','admin'\]\)/, 'resolve route must be owner/admin gated');
  assert.match(body, /if \(payment\.status !== 'requires_payment_method'\) return json\(\{ ok: false,/, 'must refuse to act on a payment that is no longer in the stuck state (avoids double-processing)');
  assert.match(body, /stripeApi\(env, mode, `payment_intents\/\$\{encodeURIComponent\(payment\.stripe_payment_intent_id\)\}`/, 'must fetch the live PaymentIntent from Stripe -- never trust the resolve click by itself');
  assert.match(body, /if \(pi\.status !== 'succeeded'\) return json\(\{ ok: false,/, 'must refuse to mark paid unless Stripe itself reports succeeded');
  assert.match(body, /status: 'succeeded'.*confirmed_by: auth\.user\.id/, 'must patch pos_payments to succeeded with an audit trail of who confirmed it');
  assert.match(body, /await fulfillStorefrontOrderInventory\(env, payment\.sale_id, storeId\)/, 'must reuse the same fulfillStorefrontOrderInventory the webhook calls, not re-derive inventory/order-status logic separately');
  assert.match(body, /action === 'abandon'/, 'must support dismissing a genuinely-abandoned checkout without a Stripe round-trip');
}

// GET /store/customers -- the "DATABASE" tab's data source: a read-only
// rollup of the store's customer roster (so people who've never ordered
// online still show up) plus every order table, keyed by email with a
// phone fallback (storefront_orders is guest checkout that requires a
// phone but not an email).
{
  const start = worker.indexOf("if (url.pathname === '/store/customers' && request.method === 'GET') {");
  assert.notEqual(start, -1, 'missing GET /store/customers route');
  const end = worker.indexOf('// POST /ebay/orders/ship', start);
  const body = worker.slice(start, end);
  assert.match(body, /requireStoreUser\(request, env, storeId, \['owner','admin'\]\)/, 'customer database must be owner/admin gated -- it is customer PII across every order type');
  assert.match(body, /customers\?store_id=eq\./, 'must include the store\'s own customer roster, so a person with zero orders still shows up');
  assert.match(body, /storefront_orders\?store_id=eq\./, 'must include storefront (pickup/shipping) orders');
  assert.match(body, /foc_preorder_orders\?store_id=eq\./, 'must include FOC comic preorders');
  assert.match(body, /backlist_orders\?store_id=eq\./, 'must include PRH backlist (backorder) orders');
  assert.match(body, /const e = String\(email \|\| ''\)\.trim\(\)\.toLowerCase\(\);/, 'must key customers by normalized email so the same person is not split into multiple rows by casing');
  assert.match(body, /const p = normPhone\(phone\);\s*\n\s*if \(p\) return 'phone:' \+ p;/, 'must fall back to phone when no email is on file, so phone-only storefront guests are not silently dropped');
  assert.match(body, /for \(const r of roster \|\| \[\]\) \{/, 'roster rows must be seeded into the customer map before orders are applied, so orders enrich an existing person instead of duplicating them');
}

console.log('Stuck-payments and customer-database route checks passed');

// Dashboard wiring: both features must be reachable from the UI and gated
// the same way as the backend (owner/admin only), and the DATABASE tab must
// be excluded from the manager/employee tab allow-lists the same way
// backoffice/SETTINGS already is.
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
assert.match(dashboard, /show\('backoffice-stuck-payments-panel', ownerAdmin\);/, 'stuck-payments panel must be gated to owner/admin in applyVendorConfig');
assert.match(dashboard, /async function loadStuckPayments\(\)/, 'missing loadStuckPayments dashboard function');
assert.match(dashboard, /async function resolveStuckPayment\(paymentId, action\)/, 'missing resolveStuckPayment dashboard function');
assert.match(dashboard, /\['database', 'DATABASE'\]/, 'missing DATABASE entry in MORE_TABS');
assert.match(dashboard, /allowed = !\['backoffice','database'\]\.includes\(tab\)/, 'manager role must not see the DATABASE tab (customer PII), same as SETTINGS/ADMIN');
assert.match(dashboard, /window\.ensureDatabasePanel\?\.\(\)/, 'DATABASE tab must lazy-load its panel like the other MORE_TABS entries do');

console.log('Stuck-payments and database-viewer dashboard wiring checks passed');
