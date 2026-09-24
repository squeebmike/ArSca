import assert from 'node:assert/strict';

const STORE_ID = '0f9dd4bc-42a7-487e-a972-2905d24513e9';
const TOKEN = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_TOKEN = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ORDER_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const SALE_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const ITEM_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const NOT_PURCHASED_ITEM_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

const order = { id: ORDER_ID, store_id: STORE_ID, sale_id: SALE_ID, customer_name: 'Alex Rivera', customer_email: 'alex@example.com', review_token: TOKEN };
const saleLine = { item_id: ITEM_ID, title: 'Amazing Spider-Man #1', image_url: 'https://img.example/asm1.jpg' };
let itemData = { name: 'Amazing Spider-Man #1', reviews: [] };
const patchedBodies = [];

const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
globalThis.fetch = async (input, init) => {
  const url = String(input);
  const method = (init && init.method) || 'GET';

  if (url.includes('storefront_orders')) {
    const tokenMatch = url.match(/review_token=eq\.([^&]+)/);
    const token = tokenMatch ? decodeURIComponent(tokenMatch[1]) : '';
    return new Response(JSON.stringify(token === TOKEN ? [order] : []), { headers: { 'Content-Type': 'application/json' } });
  }
  if (url.includes('pos_sale_lines')) {
    const itemIdMatch = url.match(/item_id=eq\.([^&]+)/);
    if (itemIdMatch) {
      const itemId = decodeURIComponent(itemIdMatch[1]);
      return new Response(JSON.stringify(itemId === ITEM_ID ? [saleLine] : []), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify([saleLine]), { headers: { 'Content-Type': 'application/json' } });
  }
  if (url.includes('inventory_items')) {
    if (method === 'PATCH') {
      const body = JSON.parse(init.body);
      patchedBodies.push(body);
      itemData = body.data;
      return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify([{ id: ITEM_ID, data: itemData }]), { headers: { 'Content-Type': 'application/json' } });
  }
  return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
};

const env = { SUPABASE_URL: 'https://database.example', SUPABASE_SERVICE_ROLE_KEY: 'test-only' };
const edge = { waitUntil: () => {} };

try {
  const { default: api } = await import('../cloudflare-worker-full.js');
  const get = (path) => api.fetch(new Request('https://themanapocket.com' + path), env, edge);
  const post = (path, body) => api.fetch(new Request('https://themanapocket.com' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env, edge);

  // GET /review renders the real purchased item(s), not fabricated ones.
  {
    const res = await get('/review?token=' + TOKEN);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Amazing Spider-Man #1/);
    assert.match(html, new RegExp('data-item-id="' + ITEM_ID + '"'));
    assert.match(html, /<meta name="robots" content="noindex,follow">/, 'a personal review-submission page must never be indexed');
  }

  // A bad/unknown token must not error or leak whether any order exists.
  {
    const res = await get('/review?token=' + OTHER_TOKEN);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /no longer valid/i);
  }

  // Submitting a real review: verified against the real order + real
  // purchased item, stored unapproved.
  {
    const res = await post('/public/storefront/review', { token: TOKEN, itemId: ITEM_ID, rating: '5', text: 'Great shipping!', name: 'Alex' });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.ok, true);
    assert.equal(patchedBodies.length, 1);
    const saved = patchedBodies[0].data.reviews[0];
    assert.equal(saved.rating, 5);
    assert.equal(saved.text, 'Great shipping!');
    assert.equal(saved.author, 'Alex');
    assert.equal(saved.orderId, ORDER_ID);
    assert.equal(saved.approved, false, 'a fresh submission must never be auto-approved/public');
  }

  // Resubmitting the same order+item must be a no-op, not a duplicate entry.
  {
    const res = await post('/public/storefront/review', { token: TOKEN, itemId: ITEM_ID, rating: '3', text: 'changed my mind', name: 'Alex' });
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.alreadySubmitted, true);
    assert.equal(patchedBodies.length, 1, 'must not have issued a second PATCH for the same order+item');
  }

  // A token can never be used to review an item that wasn't actually part
  // of that order.
  {
    const res = await post('/public/storefront/review', { token: TOKEN, itemId: NOT_PURCHASED_ITEM_ID, rating: '5', text: 'trying to review something I did not buy' });
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.equal(data.ok, false);
    assert.match(data.error, /not part of this order/i);
  }

  // An invalid token must be rejected, not silently accepted.
  {
    const res = await post('/public/storefront/review', { token: OTHER_TOKEN, itemId: ITEM_ID, rating: '5', text: 'spoofed token' });
    const data = await res.json();
    assert.equal(res.status, 404);
    assert.equal(data.ok, false);
  }

  // Out-of-range ratings and empty text must be rejected.
  {
    const res = await post('/public/storefront/review', { token: TOKEN, itemId: ITEM_ID, rating: '9', text: 'bad rating' });
    assert.equal((await res.json()).ok, false);
  }

  console.log('Storefront review submission checks passed');
} finally {
  globalThis.fetch = originalFetch;
  globalThis.caches = originalCaches;
}
