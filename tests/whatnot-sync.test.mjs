import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  whatnotCategoryId, whatnotDesired, syncWhatnotItem, runWhatnotListingSync,
  processWhatnotOrder, reconcileWhatnotOrders, whatnotFee, whatnotClient, WHATNOT_PROFILES,
  summarizeWhatnotShow, refreshWhatnotShow, whatnotShowOrders,
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

// A giveaway still uses up the item (recorded at $0); a Whatnot-only giveaway has nothing to record.
{
  const kv = new Map(), sales = [];
  const deps = {
    storeId: 'S', feeSettings: {}, kvGet: async k => kv.get(k) ?? null, kvPut: async (k, v) => { kv.set(k, v); },
    api: async () => ({ ok: true, status: 200, data: { data: [
      { id: 'g1', quantity: 1, unit_price: { amount: '0.00' }, product_external_id: '22222222-2222-4222-8222-222222222222', purchased_item: { title: 'Pack giveaway' } },
      { id: 'g2', quantity: 1, unit_price: { amount: '0.00' }, product_external_id: null, purchased_item: { title: 'Sticker' } },
    ], next_cursor: null } }),
    recordSale: async body => { sales.push(body); return { ok: true, status: 200, data: { ok: true } }; },
    voidOrder: async () => 0,
  };
  const res = await processWhatnotOrder({ id: 'ordG', status: 'completed', transaction_type: 'giveaway' }, deps);
  assert.equal(sales.length, 1);
  assert.equal(sales[0].giveaway, true); assert.equal(sales[0].salePrice, 0); assert.equal(sales[0].feeAmount, 0);
  assert.equal(res.recorded[1].skipped, 'not ours');
}

// Shows: worked out from Whatnot's own orders and analytics, no import.
{
  const order = (id, sub, { buyer = 'amy', ...extra } = {}) => ({ id, status: 'completed', show_id: 'show1', created_at: '2026-10-31T23:00:00Z', amounts: { subtotal: { amount: String(sub) } }, buyer: { username: buyer }, ...extra });
  const orders = [order('o1', 20), order('o2', 10, { buyer: 'bob' }), order('o3', 0, { transaction_type: 'giveaway' }), order('o4', 50, { status: 'cancelled' })];
  const costs = { o1: 5, o2: 4, o3: 2 };
  let sum = summarizeWhatnotShow({ orders, analytics: { calculation_status: 'PENDING' }, costs });
  assert.equal(sum.final, false);
  assert.equal(sum.gross, 30); assert.equal(sum.sold, 2); assert.equal(sum.giveaways, 1); assert.equal(sum.cancelled, 1);
  assert.equal(sum.fees, whatnotFee(20, {}) + whatnotFee(10, {}), 'estimated until Whatnot has the numbers');
  assert.equal(sum.cogs, 9); assert.equal(sum.giveawayCost, 2);
  assert.equal(sum.net, Math.round((30 - sum.fees - 9 - 2) * 100) / 100);
  assert.deepEqual(sum.buyers.map(b => b.buyer), ['amy', 'bob']);
  sum = summarizeWhatnotShow({ orders, analytics: { calculation_status: 'GENERATED', sales: { amount: '30.00' }, estimated_earnings: { amount: '25.50' }, max_concurrent_viewers: 41, buyers_count: 2 }, costs });
  assert.equal(sum.final, true); assert.equal(sum.fees, 4.5, "Whatnot's real fees: gross minus earnings"); assert.equal(sum.earnings, 25.5);
  assert.equal(sum.net, 25.5 - 9 - 2); assert.equal(sum.peakViewers, 41);
  assert.equal(summarizeWhatnotShow({ orders: [order('o9', 10)], costs: {} }).missingCost, 1, 'an order with nothing recorded yet is flagged');

  // Orders paging stops once past the show's start.
  let pages = 0;
  const pagedApi = async (m, path) => { pages++; return { ok: true, status: 200, data: pages === 1 ? { data: [order('a', 1), { ...order('b', 1), show_id: 'other' }], next_cursor: 'c2' } : { data: [{ ...order('c', 1), created_at: '2026-10-01T00:00:00Z' }], next_cursor: 'c3' } }; };
  const got = await whatnotShowOrders(pagedApi, 'show1', '2026-10-30T00:00:00Z');
  assert.deepEqual(got.map(o => o.id), ['a', 'c']); assert.equal(pages, 2);

  // refresh: saved with its Whatnot id; final once analytics are generated.
  const kv = new Map(), saved = [];
  let analyticsStatus = 'PENDING';
  const api = async (m, path) => {
    if (path === '/shows/show1') return { ok: true, status: 200, data: { id: 'show1', title: 'Friday Rips', status: 'ended', scheduled_start_at: '2026-10-31T22:00:00.000Z', ended_at: '2026-11-01T01:00:00.000Z' } };
    if (path === '/analytics/shows/show1') return { ok: true, status: 200, data: analyticsStatus === 'GENERATED' ? { calculation_status: 'GENERATED', start_time: '2026-10-31T22:05:00.000Z', sales: { amount: '30.00' }, estimated_earnings: { amount: '25.50' } } : { calculation_status: analyticsStatus } };
    if (path.startsWith('/orders?')) return { ok: true, status: 200, data: { data: orders, next_cursor: null } };
    throw new Error(path);
  };
  const deps = { storeId: 'S', api, feeSettings: {}, kvGet: async k => kv.get(k) ?? null, kvPut: async (k, v) => { kv.set(k, v); }, costsForOrders: async ids => { assert.deepEqual(ids, ['o1', 'o2', 'o3', 'o4']); return costs; }, upsertShow: async row => { saved.push(row); } };
  await refreshWhatnotShow('show1', deps);
  assert.equal(saved[0].whatnot_show_id, 'show1'); assert.equal(saved[0].status, 'ended'); assert.equal(saved[0].title, 'Friday Rips');
  assert.equal(saved[0].report_summary.final, false);
  analyticsStatus = 'GENERATED';
  await refreshWhatnotShow('show1', deps);
  assert.equal(saved[1].report_summary.final, true); assert.equal(saved[1].started_at, '2026-10-31T22:05:00.000Z');
  await refreshWhatnotShow('show1', deps);
  assert.equal(saved[2].report_summary, undefined, 'once final, the numbers are left alone');
  // A scheduled show is kept as planning, no numbers yet.
  saved.length = 0;
  await refreshWhatnotShow({ id: 'show2', title: 'Next week', status: 'scheduled' }, deps);
  assert.deepEqual(saved[0], { whatnot_show_id: 'show2', platform: 'whatnot', title: 'Next week', status: 'planning', started_at: null, ended_at: null });
  assert.equal((await refreshWhatnotShow({ id: 'show3', status: 'cancelled' }, deps)).skipped, 'cancelled');
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
assert.match(worker, /handleWhatnotWebhook\(request, env, \{ json, onEvent: record => ctx\?\.waitUntil\?\.\(handleWhatnotEventRecord\(env, ctx, record\)\), background: /);
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
assert.match(worker, /whatnot_shows\?on_conflict=store_id,whatnot_show_id/);
assert.match(worker, /const showId = type\.startsWith\('shows\.'\) \? \(data\.show_id \|\| data\.id\) : '';/);
assert.match(fs.readFileSync('supabase-migrations/2026-10-31-whatnot-show-id.sql', 'utf8'), /create unique index if not exists whatnot_shows_store_whatnot_id on public\.whatnot_shows\(store_id, whatnot_show_id\)/);
console.log('whatnot sync checks passed');
