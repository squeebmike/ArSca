import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  whatnotCategoryId, whatnotDesired, syncWhatnotItem, runWhatnotListingSync,
  processWhatnotOrder, reconcileWhatnotOrders, whatnotFee, whatnotClient, WHATNOT_PROFILES,
} from '../scripts/whatnot-sync.mjs';

// Store, 2026-10-31: "Anything I checkbox will be put on whatnot and synced.
// Whenever we run a price update, the whatnot should update also." -- same
// price as the dashboard, Buy It Now any time, simple shipping profiles.

// Categories (Whatnot's product taxonomy ids).
assert.equal(whatnotCategoryId({ categorySlug: 'pokemon' }), '2');
assert.equal(whatnotCategoryId({ categorySlug: 'mtg' }), '9');
assert.equal(whatnotCategoryId({ categorySlug: 'comics', year: '2024' }), '244');
assert.equal(whatnotCategoryId({ categorySlug: 'comics', year: '1978' }), '243', 'vintage comics');
assert.equal(whatnotCategoryId({ categorySlug: 'sports-cards', sport: 'Baseball' }), '586');
assert.equal(whatnotCategoryId({ categorySlug: 'sports-cards', sport: 'Basketball' }), '593');
assert.equal(whatnotCategoryId({ categorySlug: 'sports-cards', sport: '' , name: 'Lacrosse star' }), '139');
assert.equal(whatnotCategoryId({ categorySlug: 'other' }), null);

// What Whatnot should show.
const row = (over = {}) => ({ id: '11111111-1111-4111-8111-111111111111', status: 'in_stock', updated_at: 't1', data: { name: 'Charizard', sellOnWhatnot: true, quantity: 3, ...over } });
const shape = r => ({ name: r.data.name, price: r.data.price ?? 12.5, categorySlug: r.data.slug || 'pokemon', photos: ['https://img.example/a.jpg', 'data:image/png;base64,xx'], set: 'Base Set', condition: 'NM', category: 'Pokemon' });
let w = whatnotDesired(row(), shape(row()));
assert.equal(w.qty, 3); assert.equal(w.price, 12.5); assert.equal(w.categoryId, '2');
assert.deepEqual(w.media, [{ url: 'https://img.example/a.jpg' }], 'only real https photos');
assert.equal(whatnotDesired(row({ sellOnWhatnot: false }), shape(row())).qty, 0, 'unchecked: 0 on Whatnot');
assert.equal(whatnotDesired(row({ status: 'sold' }), shape(row())).qty, 0, 'sold: 0');
assert.equal(whatnotDesired({ ...row(), status: 'presale', data: { ...row().data, status: 'presale' } }, shape(row())).qty, 0, 'presales stay off');

// A fake Whatnot.
function fakeWhatnot() {
  const calls = [];
  const products = new Map();
  let n = 0;
  const api = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'POST' && path === '/products') { const id = 'p' + (++n); products.set(id, { variant: 'v' + n, qty: 0 }); return { ok: true, status: 201, data: { id, url: 'https://whatnot.example/' + id, dimension_profile: { id: '900' + n } } }; }
    let m = path.match(/^\/products\/(p\d+)\/variants\?/);
    if (method === 'GET' && m) return { ok: true, status: 200, data: { data: products.has(m[1]) ? [{ id: products.get(m[1]).variant }] : [], next_cursor: null } };
    m = path.match(/^\/products\/(p\d+)\/variants$/);
    if (method === 'PATCH' && m) return products.has(m[1]) ? { ok: true, status: 200, data: { variants: body.variants } } : { ok: false, status: 404, data: { title: 'Not found' } };
    if (method === 'POST' && path.startsWith('/merchandising/products/')) return { ok: true, status: 200, data: {} };
    if (method === 'POST' && path === '/inventory/set') {
      const it = body.items[0];
      const p = [...products.values()].find(x => x.variant === it.variant_id);
      if (!p) return { ok: true, status: 200, data: { results: [{ status: 'variant_not_found' }] } };
      p.qty = it.quantity;
      return { ok: true, status: 200, data: { results: [{ status: 'applied' }] } };
    }
    throw new Error('unexpected ' + method + ' ' + path);
  };
  return { api, calls, products };
}

// Created: product (external id = our id, category, simple shipping profile),
// Buy It Now any time, price and quantity.
let wn = fakeWhatnot();
const profiles = {};
const opts = { profileId: k => profiles[k] || '', saveProfileId: (k, id) => { profiles[k] = id; } };
let r = await syncWhatnotItem(wn.api, row(), shape(row()), null, opts);
assert.equal(r.action, 'created');
const create = wn.calls.find(c => c.path === '/products').body;
assert.equal(create.external_id, row().id);
assert.deepEqual(create.category, { id: '2' });
assert.deepEqual(create.dimension_profile, WHATNOT_PROFILES.card, 'a simple card profile is made the first time');
assert.equal(profiles.card, '9001', 'and reused after');
assert.deepEqual(wn.calls.find(c => c.path.startsWith('/merchandising')).body, { transaction_type: 'buy_it_now', reserve_for_live: false });
assert.deepEqual(wn.calls.find(c => c.method === 'PATCH').body.variants[0].pricing, { buy_it_now: { price: { amount: '12.50', currency: 'USD' } } });
assert.equal(wn.products.get('p1').qty, 3);
let link = r.link;
assert.equal(link.productId, 'p1'); assert.equal(link.qty, 3); assert.equal(link.price, 12.5);

// Nothing changed: no calls.
wn.calls.length = 0;
r = await syncWhatnotItem(wn.api, row(), shape(row()), link, opts);
assert.equal(r.action, 'none'); assert.equal(wn.calls.length, 0);

// A price update: only the price goes.
wn.calls.length = 0;
r = await syncWhatnotItem(wn.api, row({ price: 14 }), shape(row({ price: 14 })), link, opts);
assert.equal(r.action, 'updated');
assert.deepEqual(wn.calls.map(c => c.method + ' ' + c.path), ['PATCH /products/p1/variants']);
link = r.link;

// Sold one in the store: quantity follows.
r = await syncWhatnotItem(wn.api, row({ price: 14, quantity: 2 }), shape(row({ price: 14 })), link, opts);
assert.equal(wn.products.get('p1').qty, 2); link = r.link;

// Unchecked: 0 on Whatnot, the link kept.
r = await syncWhatnotItem(wn.api, row({ sellOnWhatnot: false, price: 14 }), shape(row({ price: 14 })), link, opts);
assert.equal(wn.products.get('p1').qty, 0); assert.equal(r.link.qty, 0); link = r.link;

// Deleted on Whatnot: link dropped and made again next time.
wn.products.delete('p1');
r = await syncWhatnotItem(wn.api, row({ price: 15 }), shape(row({ price: 15 })), link, opts);
assert.equal(r.link, null); assert.equal(r.retry, true);

// A problem with the item is kept to show, not retried every run.
r = await syncWhatnotItem(wn.api, row({ slug: 'other' }), { ...shape(row()), categorySlug: 'other', category: 'Misc' }, null, opts);
assert.match(r.link.error, /No Whatnot category/); assert.equal(r.retry, false);
// Never created and not wanted: nothing.
wn.calls.length = 0;
r = await syncWhatnotItem(wn.api, row({ sellOnWhatnot: false }), shape(row()), null, opts);
assert.equal(r.link, null); assert.equal(wn.calls.length, 0);

// Whatnot's errors are readable.
const failing = async () => ({ ok: false, status: 422, data: { detail: [{ loc: ['body', 'title'], msg: 'String too long' }] } });
r = await syncWhatnotItem(failing, row(), shape(row()), null, opts);
assert.equal(r.link.error, 'title: String too long');

// The store run: only items edited since last time are looked at.
{
  wn = fakeWhatnot();
  const kv = new Map();
  const items = new Map([['a', { id: 'a', status: 'in_stock', updated_at: '1', data: { name: 'A', sellOnWhatnot: true, quantity: 1 } }], ['b', { id: 'b', status: 'in_stock', updated_at: '1', data: { name: 'B', sellOnWhatnot: true, quantity: 2 } }]]);
  const dbCalls = [];
  const deps = {
    api: wn.api, shape,
    kvGet: async k => kv.has(k) ? structuredClone(kv.get(k)) : null,
    kvPut: async (k, v) => { if (v == null) kv.delete(k); else kv.set(k, structuredClone(v)); },
    db: async path => {
      dbCalls.push(path);
      if (path.includes('select=id,updated_at')) { assert.match(path, /data->>sellOnWhatnot=eq\.true/); return { data: [...items.values()].filter(r => r.data.sellOnWhatnot).map(r => ({ id: r.id, updated_at: r.updated_at })) }; }
      const ids = decodeURIComponent(path.match(/id=in\.\(([^)]*)\)/)[1]).split(',');
      return { data: ids.map(id => items.get(id)).filter(Boolean) };
    },
  };
  let out = await runWhatnotListingSync('S', deps);
  assert.equal(out.created, 2);
  assert.equal(wn.calls.filter(c => c.path === '/products').length, 2);
  // Quiet run: one small query, nothing sent.
  wn.calls.length = 0; dbCalls.length = 0;
  out = await runWhatnotListingSync('S', deps);
  assert.equal(out.checked, 0); assert.equal(wn.calls.length, 0); assert.equal(dbCalls.length, 1);
  // Item B unchecked (it drops out of the checked list): goes to 0.
  items.get('b').data.sellOnWhatnot = false; items.get('b').updated_at = '2';
  out = await runWhatnotListingSync('S', deps);
  assert.equal(out.checked, 1);
  assert.equal(wn.products.get('p2').qty, 0, 'unchecked item set to 0 on Whatnot');
  wn.calls.length = 0;
  out = await runWhatnotListingSync('S', deps);
  assert.equal(wn.calls.length, 0, 'and then left alone');
  // Item A deleted from the store: 0 too.
  items.delete('a');
  out = await runWhatnotListingSync('S', deps);
  assert.equal(wn.products.get('p1').qty, 0);
  // The links live in KV, never in the item's data.
  assert.ok(kv.get('whatnot-link:S:b').productId === 'p2');
}

// Orders: each item recorded once, through record-external-sale.
{
  const kv = new Map();
  const sales = [];
  const order = { id: 'ord1', status: 'pending_fulfillment', created_at: '2026-10-31T20:00:00Z' };
  const api = async (method, path) => {
    assert.equal(path, '/orders/ord1/items?limit=50');
    return { ok: true, status: 200, data: { data: [
      { id: 'oi1', quantity: 1, unit_price: { amount: '20.00', currency: 'USD' }, product_external_id: '11111111-1111-4111-8111-111111111111', purchased_item: { title: 'Charizard' } },
      { id: 'oi2', quantity: 2, unit_price: { amount: '5.00', currency: 'USD' }, product_external_id: null, purchased_item: { title: 'Mystery pack' } },
    ], next_cursor: null } };
  };
  let voids = 0;
  const deps = {
    storeId: 'S', api, feeSettings: {},
    kvGet: async k => kv.get(k) ?? null, kvPut: async (k, v) => { kv.set(k, v); },
    recordSale: async body => { sales.push(body); return { ok: true, status: 200, data: { ok: true } }; },
    voidOrder: async () => { voids++; return 1; },
  };
  let res = await processWhatnotOrder(order, deps);
  assert.equal(sales.length, 2);
  assert.deepEqual(sales[0], { itemId: '11111111-1111-4111-8111-111111111111', title: 'Charizard', channel: 'Whatnot', salePrice: 20, quantitySold: 1, soldAt: '2026-10-31T20:00:00Z', feeAmount: whatnotFee(20, {}), externalRef: 'whatnot-api:ord1:oi1' });
  assert.equal(sales[1].itemId, '', 'a Whatnot-only listing is recorded by its title');
  assert.equal(sales[1].salePrice, 10);
  assert.equal(sales[1].feeAmount, whatnotFee(10, {}, { first: false }), 'the $0.30 is once per order');
  assert.equal(whatnotFee(20, {}), 2.48, '8% + 2.9% + $0.30');
  assert.equal(whatnotFee(20, { whatnotFeePct: 10, whatnotFeeFlat: 0 }), 2, "the store's own rate wins");
  res = await processWhatnotOrder(order, deps);
  assert.equal(res.skipped, 'already recorded'); assert.equal(sales.length, 2);
  // Cancelled: voided once.
  await processWhatnotOrder({ ...order, status: 'cancelled' }, deps);
  await processWhatnotOrder({ ...order, status: 'cancelled' }, deps);
  assert.equal(voids, 1);
  // Already sold here: the money is still recorded, unlinked.
  kv.clear(); sales.length = 0;
  deps.recordSale = async body => { sales.push(body); return body.itemId ? { ok: false, status: 409, data: { error: 'That item is already marked sold' } } : { ok: true, status: 200, data: { ok: true, unlinked: true } }; };
  res = await processWhatnotOrder(order, deps);
  assert.deepEqual(sales.map(s => s.itemId), ['11111111-1111-4111-8111-111111111111', '', '']);
  // A failure is not marked done, so the next run retries.
  kv.clear();
  deps.recordSale = async () => ({ ok: false, status: 500, data: { error: 'Supabase 522' } });
  await assert.rejects(() => processWhatnotOrder(order, deps), /Supabase 522/);
  assert.equal(kv.get('whatnot-order:S:ord1'), undefined);
  // Reconcile goes through recent orders.
  kv.clear(); sales.length = 0;
  deps.recordSale = async body => { sales.push(body); return { ok: true, status: 200, data: { ok: true } }; };
  deps.api = async (m, path) => path.startsWith('/orders?') ? { ok: true, status: 200, data: { data: [order], next_cursor: null } } : api(m, path);
  const rec = await reconcileWhatnotOrders(deps);
  assert.equal(rec[0].recorded.length, 2);
}

// The client: Bearer token, retries a 429.
{
  const seen = [];
  let first = true;
  const client = whatnotClient({ WHATNOT_API_KEY: ' wn_pat_tk_abc\n' }, { wait: async () => {}, fetchImpl: async (url, init) => {
    seen.push([url, init.headers.Authorization]);
    if (first) { first = false; return new Response('{}', { status: 429, headers: { 'retry-after': '1' } }); }
    return new Response(JSON.stringify({ id: 'u' }), { status: 200 });
  } });
  const res = await client('GET', '/users/me');
  assert.equal(res.ok, true); assert.equal(seen.length, 2);
  assert.deepEqual(seen[1], ['https://api.whatnot.com/seller-api/rest/v2/users/me', 'Bearer wn_pat_tk_abc']);
}

// Wiring.
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.match(worker, /const WHATNOT_SYNC_CRON = '\*\/10 \* \* \* \*';/);
assert.match(worker, /if \(event\?\.cron === WHATNOT_SYNC_CRON\) \{ ctx\.waitUntil\(runScheduledWhatnotSync\(env, ctx\)\); return; \}/);
assert.match(fs.readFileSync('wrangler.deploy.jsonc', 'utf8'), /"\*\/10 \* \* \* \*"/, 'the 10-minute trigger is deployed');
assert.match(worker, /handleWhatnotWebhook\(request, env, \{ json, onEvent: record => ctx\?\.waitUntil\?\.\(handleWhatnotEventRecord\(env, ctx, record\)\) \}\)/);
assert.match(worker, /focInternalPost\(env, ctx, storeId, '\/inventory\/record-external-sale', body\)/);
assert.equal((worker.match(/confirmed_by: auth\.user\.id \|\| null, confirmed_at: soldAt/g) || []).length, 2, 'internal callers have no user id; the payment row takes null');
assert.match(worker, /url\.pathname === '\/whatnot\/sync' && request\.method === 'POST'[\s\S]{0,200}\['owner','admin','manager'\]/);
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
assert.match(app, /\['sellOnWhatnot', false, 'bool'\],/);
assert.equal((app.match(/sellOnWhatnot: !!document\.getElementById\('edit-sell-whatnot'\)\?\.checked,/g) || []).length, 2);
assert.match(app, /if\(nextData\.sellOnWhatnot === true \|\| item\.sellOnWhatnot === true\) queueWhatnotSync\(\);/);
assert.match(fs.readFileSync('dashboard.html', 'utf8'), /id="edit-sell-whatnot"/);
assert.doesNotMatch(app, /\['whatnotProductId'/, 'Whatnot ids are never saved from the dashboard copy');
// The show-report import skips sales already recorded from Whatnot's notifications.
const bridge = fs.readFileSync('scripts/whatnot-bridge.js', 'utf8');
assert.match(bridge, /\.or\('reference\.like\.whatnot-live:%,reference\.like\.whatnot-api:%'\)/);
assert.match(bridge, /reason = liveHit\.auto \? 'Already recorded from Whatnot automatically'/);
assert.match(worker, /reference=like\.\$\{encodeURIComponent\('whatnot-api:' \+ orderId \+ ':'\)\}\*/, 'a cancellation voids only that order\'s automatic sales');
console.log('whatnot sync checks passed');
