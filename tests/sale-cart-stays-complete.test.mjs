import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Pilot dry run (2026-10-26): a trade-in paid for a $15 card and $17 went
// back in cash, yet the cart came back open with the full $32 credit on it.
// Checkout's "empty cart" save ran unawaited; its open copy of the cart and
// its index upsert landed after the cart was completed, so any register
// joining it would have been offered the $32 again.
const STORE = '11111111-2222-4333-8444-555555555555';
const kv = new Map();
const env = {
  SUPABASE_URL: 'https://database.example', SUPABASE_SERVICE_ROLE_KEY: 'test-only',
  LBA_KV: { get: async k => kv.has(k) ? kv.get(k) : null, put: async (k, v) => { kv.set(k, v); }, delete: async k => { kv.delete(k); } },
};
const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
globalThis.fetch = async (input) => {
  const url = String(input);
  const ok = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  if (url.includes('/auth/v1/user')) return ok({ id: 'user-1', email: 'owner@example.com' });
  if (url.includes('/rest/v1/store_members')) return ok([{ role: 'owner' }]);
  return ok([]);
};
try {
  const { default: api } = await import('../cloudflare-worker-full.js');
  const post = async (path, body) => {
    const res = await api.fetch(new Request('https://w.example' + path + '?store=' + STORE, { method: 'POST', headers: { Authorization: 'Bearer t', 'X-Store-Id': STORE, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env, { waitUntil() {}, passThroughOnException() {} });
    return res.json();
  };
  const get = async path => JSON.parse((await (await api.fetch(new Request('https://w.example' + path + '?store=' + STORE, { headers: { Authorization: 'Bearer t', 'X-Store-Id': STORE } }), env, { waitUntil() {}, passThroughOnException() {} })).json()).value || 'null');
  const credit = { id: 'credit-1', amount: 32, remainingBalance: 32, customerName: 'Walk-in trade' };
  const open = { cartId: 'c1', status: 'open', customerName: 'Walk-in trade', items: [], tradeCredit: credit };
  const entry = { id: 'c1', customerName: 'Walk-in trade', itemCount: 0, tradeAmount: 32, status: 'open' };

  await post('/kv/sale_cart_c1', open);
  await post('/kv/sale-cart-index/upsert', { entry });
  // Checkout completes the cart and takes it off the list...
  await post('/kv/sale_cart_c1', { ...open, status: 'complete', saleId: 'sale-1', tradeCredit: null });
  await post('/kv/sale-cart-index/remove', { id: 'c1' });
  // ...then the slow open save lands.
  const late = await post('/kv/sale_cart_c1', open);
  assert.equal(late.complete, true, 'the late open save is ignored');
  const index = (await post('/kv/sale-cart-index/upsert', { entry })).index;

  const saved = await get('/kv/sale_cart_c1');
  assert.equal(saved.status, 'complete', 'the cart stays complete');
  assert.equal(saved.tradeCredit, null, 'with no trade credit left to offer');
  assert.ok(!index.some(e => e.id === 'c1'), 'and it is not re-listed for other registers');
  assert.ok(!(await get('/kv/sale_carts_index')).some(e => e.id === 'c1'));

  // An open cart still saves and lists as before.
  await post('/kv/sale_cart_c2', { ...open, cartId: 'c2' });
  assert.ok((await post('/kv/sale-cart-index/upsert', { entry: { ...entry, id: 'c2' } })).index.some(e => e.id === 'c2'));
  assert.equal((await get('/kv/sale_cart_c2')).status, 'open');
} finally { globalThis.fetch = originalFetch; globalThis.caches = originalCaches; }

// Client: the empty-cart save finishes before the cart is completed, and a
// completed cart drops its trade credit.
const ui = readFileSync(new URL('../scripts/dashboard-app.js', import.meta.url), 'utf8');
const finalize = ui.slice(ui.indexOf('async function finalizeCompletedCheckout('), ui.indexOf('function showReceiptCaptureScreen('));
assert.ok(finalize.includes('await postCartToWorker(empty);'), 'checkout waits for the empty-cart save');
assert.ok(finalize.indexOf('await postCartToWorker(empty);') < finalize.indexOf('await completeActiveSaleCartAfterCheckout('), 'before completing the cart');
const complete = ui.slice(ui.indexOf('async function completeActiveSaleCartAfterCheckout('), ui.indexOf('function renderSaleCartSwitcher('));
assert.ok(complete.indexOf('cart.tradeCredit = null;') > 0 && complete.indexOf('cart.tradeCredit = null;') < complete.indexOf('storeWorkerFetch('), 'a completed cart is saved without its trade credit');
console.log('sale cart stays complete checks passed');
