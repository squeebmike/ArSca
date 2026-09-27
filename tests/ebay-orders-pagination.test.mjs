import assert from 'node:assert/strict';

// Only the first page of eBay's order list used to be read (50 unshipped
// orders for the sync, 200 for the orders tab). Presales sit unshipped for
// weeks, so once more matched than fit, a new sale fell off the end and was
// never recorded. Every page is read now.
const { default: api } = await import('../cloudflare-worker-full.js');
const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
const kv = new Map([['secret:EBAY_ACCESS_TOKEN', 'tok'], ['secret:EBAY_ACCESS_EXPIRES', String(Date.now() + 3600e3)]]);
const env = {
  SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'k', EBAY_REFRESH_TOKEN: 'refresh',
  LBA_KV: { get: async k => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async k => { kv.delete(k); } },
};
const order = (id, sku) => ({ orderId: id, creationDate: '2026-09-27T20:00:00Z', orderPaymentStatus: 'PAID', lineItems: [{ lineItemId: 'li-' + id, sku, title: 'He-Man #4 PRESALE', quantity: 1, lineItemCost: { value: '5.99' } }] });
const ebayPages = [];
const writes = [];
globalThis.fetch = async (input, init = {}) => {
  const url = String(input.url || input);
  if (url.startsWith('https://api.ebay.com/sell/fulfillment/v1/order')) {
    ebayPages.push(url);
    const offset = Number(new URL(url).searchParams.get('offset') || 0);
    const body = offset === 0
      ? { total: 51, orders: Array.from({ length: 50 }, (_, i) => ({ ...order('old-' + i, 'other-' + i), orderPaymentStatus: 'PENDING' })), next: 'https://api.ebay.com/sell/fulfillment/v1/order?filter=x&limit=50&offset=50' }
      : { total: 51, orders: [order('new-1', 'lba-mtsxoe4q-8rb')] };
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  }
  if (url.includes('/rest/v1/store_members')) return new Response(JSON.stringify([{ store_id: 'store-1' }]), { headers: { 'Content-Type': 'application/json' } });
  if (url.includes('/rest/v1/inventory_items') && !init.method) return new Response(JSON.stringify([{ id: 'item-1', status: 'presale', data: { name: 'He-Man #4 PRESALE', ebaySku: 'lba-mtsxoe4q-8rb', quantity: 10, source: 'foc_presale' } }]), { headers: { 'Content-Type': 'application/json' } });
  if (init.method === 'POST' || init.method === 'PATCH') writes.push([init.method, url.split('/rest/v1/')[1]?.split('?')[0]]);
  return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
};
try {
  const waits = [];
  await api.scheduled({}, env, { waitUntil: p => waits.push(p) });
  await Promise.all(waits);
  assert.equal(ebayPages.length, 2, 'reads past the first page');
  assert.match(ebayPages[1], /offset=50/);
  assert.ok(writes.some(([m, t]) => m === 'POST' && t === 'pos_sales'), 'the sale on page 2 is recorded');
  assert.ok(writes.some(([m, t]) => m === 'PATCH' && t === 'inventory_items'), 'and its presale stock goes down');
  assert.ok(kv.has('ebay_order_synced:store-1:new-1:lba-mtsxoe4q-8rb'));
} finally { globalThis.fetch = originalFetch; globalThis.caches = originalCaches; }
console.log('eBay order pagination checks passed');
