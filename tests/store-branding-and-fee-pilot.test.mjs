import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLATFORM_STORE_ID, featureForPath, clearStoreFeatureCache } from '../scripts/store-features.mjs';

// Second-store pilot (2026-10-26): their customers see their store's name,
// not The Mana Pocket's; no texts go out from The Mana Pocket's number for
// them; and The Mana Pocket's cut of their card sales is 10 cents a sale.
const OTHER = '11111111-2222-4333-8444-555555555555';

assert.equal(featureForPath('/phone/sms/send'), 'sms');
assert.equal(featureForPath('/twilio/voice/token'), 'sms');

const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
const emails = [], texts = [], intents = [];
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const ok = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.includes('/auth/v1/user')) return ok({ id: 'user-1' });
  if (url.includes('/rest/v1/store_members')) return ok([{ role: 'owner' }]);
  if (url.includes('/rest/v1/store_features')) return ok([]); // pilot defaults: texts off, 10 cent fee
  if (url.includes('/rest/v1/stores?id=eq.' + OTHER)) return ok([{ display_name: 'Card Corner Vending', name: 'Card Corner' }]);
  if (url.includes('/rest/v1/store_settings')) return ok([{ receipt_settings: { email: 'cardcorner@example.com' } }]);
  if (url.includes('/rest/v1/pos_sales?id=eq.sale-1')) return ok([{ id: 'sale-1', total: 10, store_id: OTHER }]);
  if (url.includes('/rest/v1/store_stripe_accounts')) return ok([{ store_id: OTHER, mode: 'test', connected_account_id: 'acct_them', charges_enabled: true, fee_payer_verified: true }]);
  if (url.includes('comms.twilio.com/v1/Emails')) { emails.push(JSON.parse(init.body)); return ok({}, 202); }
  if (url.includes('api.twilio.com')) { texts.push(url); return ok({ sid: 'SM1' }); }
  if (url.includes('api.stripe.com/v1/payment_intents')) { intents.push({ body: new URLSearchParams(init.body), account: init.headers?.get?.('Stripe-Account') }); return ok({ id: 'pi_1', client_secret: 'cs', status: 'requires_payment_method', currency: 'usd' }); }
  if (init.method === 'POST' || init.method === 'PATCH') return new Response(null, { status: 201 });
  return ok([]);
};
const env = {
  SUPABASE_URL: 'https://database.example', SUPABASE_SERVICE_ROLE_KEY: 'test-only',
  TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM_NUMBER: '+15550001111', TWILIO_EMAIL_FROM_ADDRESS: 'hello@themanapocket.com',
  STRIPE_SECRET_KEY_TEST: 'sk_test', STRIPE_PLATFORM_MODE: 'test',
  LBA_KV: { get: async () => null, put: async () => {}, delete: async () => {} },
};
try {
  const { default: api } = await import('../cloudflare-worker-full.js');
  const call = (path, store, body) => api.fetch(new Request('https://w.example' + path, { method: 'POST', headers: { Authorization: 'Bearer t', 'X-Store-Id': store, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env, { waitUntil() {}, passThroughOnException() {} });
  clearStoreFeatureCache();

  // Texts: walled, and a customer notification won't text for them.
  let res = await call('/phone/sms/send', OTHER, { to: '+15555550123', body: 'hi' });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).featureDisabled, 'sms');
  res = await call('/notify/send', OTHER, { contact: '+15555550123', message: 'Your card is in', consent: true });
  assert.match(JSON.stringify(await res.json()), /Texts are off for this store/);
  assert.equal(texts.length, 0, 'nothing sent from your number');

  // Their emails: their name, and how to reach them.
  res = await call('/notify/send', OTHER, { contact: 'buyer@example.com', subject: 'Back in stock', message: 'Your card is in' });
  assert.equal(res.status, 200);
  const theirs = emails.at(-1);
  assert.equal(theirs.from.name, 'Card Corner Vending');
  assert.match(theirs.content.text, /Questions\? Contact Card Corner Vending at cardcorner@example\.com\./);
  assert.ok(!/Mana Pocket/.test(JSON.stringify(theirs)), 'no Mana Pocket in their email');

  // Yours: exactly as before.
  res = await call('/notify/send', PLATFORM_STORE_ID, { contact: 'buyer@example.com', subject: 'Back in stock', message: 'Your card is in' });
  const yours = emails.at(-1);
  assert.equal(yours.from.name, 'The Mana Pocket');
  assert.ok(!/Questions\? Contact/.test(yours.content.text), 'your emails unchanged');

  // Their card sale: 10 cents to you, charged on their own Stripe account.
  res = await call('/stripe/payments/create-intent', OTHER, { storeId: OTHER, saleId: 'sale-1', amountCents: 1000, mode: 'test' });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal((await res.json()).applicationFeeAmount, 10);
  assert.equal(intents.at(-1).body.get('application_fee_amount'), '10');
  assert.equal(intents.at(-1).account, 'acct_them', 'charged on their connected account');
} finally { globalThis.fetch = originalFetch; globalThis.caches = originalCaches; }

// Dashboard: their name on wrap labels and statements; yours unchanged.
const ui = readFileSync(new URL('../scripts/dashboard-app.js', import.meta.url), 'utf8');
{
  const src = ui.slice(ui.indexOf('const TAB_STORE_FEATURE'), ui.indexOf('function storeFeatureEnabled('));
  const make = (features, store) => new Function('window', 'localStorage', 'getActiveStoreId', 'getActiveStore', 'getVendorProfile', src + '; return storeBrandName;')({ _storeFeatures: features }, { getItem: () => null }, () => 'x', () => store, () => ({}));
  assert.equal(make(null, { displayName: 'Card Corner Vending' })(), 'The Mana Pocket', 'unknown = your wording');
  assert.equal(make({ platform: true }, { displayName: 'The Mana Pocket' })(), 'The Mana Pocket');
  assert.equal(make({ platform: false }, { displayName: 'Card Corner Vending' })(), 'Card Corner Vending');
  assert.equal(make({ platform: false }, { displayName: '' })(), 'Our store');
}
assert.ok(ui.includes('<div class="wrap-shopname">${escHtml(storeBrandName().toUpperCase())}</div>') && ui.includes('drawLines([storeBrandName().toUpperCase()],'), 'wrap label, both renderers');
assert.ok(!/'THE MANA POCKET'|>THE MANA POCKET</.test(ui), 'no hard-coded shop name left on labels');
console.log('second-store pilot: branding, texts and fee checks passed');
