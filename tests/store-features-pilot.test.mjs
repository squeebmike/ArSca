import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PLATFORM_STORE_ID, PILOT_DEFAULTS, isPlatformStore, featuresFromRow, rowFromFeatures, storeFeatures,
  featureForPath, walledRequest, storesWithFeature, clearStoreFeatureCache,
} from '../scripts/store-features.mjs';

// Second-store pilot (2026-10-26): another vendor's store must never reach
// The Mana Pocket's eBay, Shopify, comic/FOC workflow or website orders --
// and nothing may change for The Mana Pocket itself.
const OTHER = '11111111-2222-4333-8444-555555555555';
const throwing = async () => { throw new Error('database down'); };

// ── The Mana Pocket: always everything, never looked up ──
assert.equal(isPlatformStore(PLATFORM_STORE_ID), true);
assert.equal(isPlatformStore(OTHER), false);
assert.equal(isPlatformStore(OTHER, { OWNER_STORE_IDS: 'x, ' + OTHER }), true, 'an owner store from the env counts too');
assert.equal(isPlatformStore(''), false);
{
  let reads = 0;
  const f = await storeFeatures({}, PLATFORM_STORE_ID, async () => { reads++; return { ebay:false }; });
  assert.equal(reads, 0, 'never read');
  for (const k of ['ebay','shopify','comics','website','sms','sharedPricingKeys','consignment','whatnot']) assert.equal(f[k], true, k);
  assert.equal(f.feeFixedCents, 0, 'no fee on your own sales');
  assert.equal((await storeFeatures({}, PLATFORM_STORE_ID, throwing)).ebay, true, 'an outage takes nothing away');
}

// ── Another store: its row, else pilot defaults; fails closed ──
clearStoreFeatureCache();
assert.deepEqual(await storeFeatures({}, OTHER, async () => null), { ...PILOT_DEFAULTS });
assert.equal(PILOT_DEFAULTS.ebay, false); assert.equal(PILOT_DEFAULTS.comics, false); assert.equal(PILOT_DEFAULTS.feeFixedCents, 10, '10 cents a card sale');
clearStoreFeatureCache();
assert.equal((await storeFeatures({}, OTHER, async () => ({ ebay:true, platform_fee_fixed_cents:25 }))).ebay, true, 'a row turns a feature on');
clearStoreFeatureCache();
assert.equal((await storeFeatures({}, OTHER, throwing)).ebay, false, 'a failed read fails closed');
{
  clearStoreFeatureCache();
  let reads = 0; const read = async () => { reads++; return null; };
  await storeFeatures({}, OTHER, read, 1000); await storeFeatures({}, OTHER, read, 30000);
  assert.equal(reads, 1, 'cached for a minute');
  await storeFeatures({}, OTHER, read, 1000 + 61000);
  assert.equal(reads, 2, 'then read again');
  clearStoreFeatureCache();
}
assert.deepEqual(featuresFromRow({ ebay:true, shared_pricing_keys:true, platform_fee_bps:100 }), { ...PILOT_DEFAULTS, ebay:true, sharedPricingKeys:true, feeBps:100 });
assert.deepEqual(rowFromFeatures(OTHER, { ebay:true, sharedPricingKeys:false, feeFixedCents:-5, feeBps:99999 }), { store_id:OTHER, ebay:true, shared_pricing_keys:false, platform_fee_fixed_cents:0, platform_fee_bps:2000 }, 'fees clamped');

// ── Which paths are walled ──
for (const [path, feature] of [
  ['/ebay/list', 'ebay'], ['/ebay/oauth/callback', 'ebay'], ['/foc/ebay/auto-list', 'ebay'], ['/dealscan/latest', 'ebay'],
  ['/shopify/sync', 'shopify'],
  ['/foc/admin/cycles', 'comics'], ['/backlist/admin/picks', 'comics'], ['/comic/pricing', 'comics'], ['/preorders/pull-list', 'comics'],
  ['/store/storefront-orders', 'website'], ['/store/stuck-payments/resolve', 'website'],
  ['/proxy/sites', 'website'], ['/proxy/collections/abc/items', 'website'],
  ['/public/storefront', 'website'], ['/public/storefront/item', 'website'], ['/public/storefront/checkout', 'website'], ['/public/storefronts', null],
  ['/public/account/me', 'website'], ['/public/fan-club/join', 'website'], ['/public/shipping/quotes', 'website'],
  ['/public/preorders', 'comics'], ['/public/preorders/checkout', 'comics'], ['/preorders/catalog', 'comics'], ['/public/comics/new-releases', 'comics'], ['/public/backlist/search', 'comics'],
  ['/pricing/sportscardspro/products', 'sharedPricingKeys'], ['/pricing/sportscardspro/image', 'sharedPricingKeys'],
  ['/inventory/record-external-sale', null], ['/pricing/pokemon/cards', null], ['/pos/sale', null], ['/store/features', null], ['/public/products', null],
]) assert.equal(featureForPath(path), feature, path);

// ── The guard: any store the request names ──
const req = (path, store) => new Request('https://w.example' + path, { headers: store ? { 'X-Store-Id': store } : {} });
const none = async () => null;
clearStoreFeatureCache();
assert.equal(await walledRequest({}, req('/ebay/list', PLATFORM_STORE_ID), new URL('https://w.example/ebay/list'), throwing), null, 'your store goes through, even with the database down');
assert.deepEqual(await walledRequest({}, req('/ebay/list', OTHER), new URL('https://w.example/ebay/list'), none), { feature:'ebay', storeId:OTHER });
assert.deepEqual(await walledRequest({}, req('/ebay/list'), new URL('https://w.example/ebay/list'), none, { storeId:OTHER }), { feature:'ebay', storeId:OTHER }, 'a store named only in the body is caught');
assert.deepEqual(await walledRequest({}, req('/ebay/list', PLATFORM_STORE_ID), new URL('https://w.example/ebay/list?store=' + OTHER), none), { feature:'ebay', storeId:OTHER }, 'naming your store in the header does not cover another in the query');
assert.equal(await walledRequest({}, req('/ebay/oauth/callback'), new URL('https://w.example/ebay/oauth/callback?code=x'), none), null, 'no store named: the route handles it');
assert.equal(await walledRequest({}, req('/pos/sale', OTHER), new URL('https://w.example/pos/sale'), none), null, 'register is not walled');
clearStoreFeatureCache();
assert.deepEqual(await storesWithFeature({}, [PLATFORM_STORE_ID, OTHER], 'ebay', none), [PLATFORM_STORE_ID], 'scheduled jobs skip the pilot store');
clearStoreFeatureCache();

// ── The Worker, end to end ──
const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
const seen = [];
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
globalThis.fetch = async (input) => {
  const url = String(input); seen.push(url);
  const ok = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  if (url.includes('/auth/v1/user')) return ok({ id: 'user-1', email: 'owner@example.com' });
  if (url.includes('/rest/v1/store_members')) return ok([{ role: 'owner' }]);
  if (url.includes('/rest/v1/store_features')) return ok([]);
  return ok([]);
};
const env = { SUPABASE_URL: 'https://database.example', SUPABASE_SERVICE_ROLE_KEY: 'test-only', LBA_KV: { get: async () => null, put: async () => {}, delete: async () => {} } };
try {
  const { default: api } = await import('../cloudflare-worker-full.js');
  const call = (path, store, init = {}) => api.fetch(new Request('https://w.example' + path, { ...init, headers: { Authorization: 'Bearer t', ...(store ? { 'X-Store-Id': store } : {}), ...(init.headers || {}) } }), env, { waitUntil() {}, passThroughOnException() {} });

  let res = await call('/ebay/status', OTHER);
  assert.equal(res.status, 403, 'pilot store: eBay refused');
  assert.equal((await res.json()).featureDisabled, 'ebay');
  res = await call('/foc/admin/cycles', OTHER);
  assert.equal(res.status, 403, 'pilot store: FOC refused');
  res = await call('/ebay/list', '', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeId: OTHER }) });
  assert.equal(res.status, 403, 'pilot store named in the body: refused');

  // Your Webflow site and your SportsCardsPro token (pilot dry run).
  const wfEnv = { ...env, WEBFLOW_TOKEN: 'wf-secret', SCP_ACCESS_TOKEN: 'scp-secret' };
  const callWith = (e, path, store, init = {}) => api.fetch(new Request('https://w.example' + path, { ...init, headers: { Authorization: 'Bearer t', ...(store ? { 'X-Store-Id': store } : {}), ...(init.headers || {}) } }), e, { waitUntil() {}, passThroughOnException() {} });
  seen.length = 0;
  for (const [method, path] of [['GET', '/proxy/sites'], ['PATCH', '/proxy/collections/abc/items/1'], ['DELETE', '/proxy/collections/abc/items/1']]) {
    res = await callWith(wfEnv, path, OTHER, { method });
    assert.equal(res.status, 403, method + ' ' + path + ': pilot store refused');
    assert.equal((await res.json()).featureDisabled, 'website');
  }
  res = await callWith(wfEnv, '/pricing/sportscardspro/products?q=trout', OTHER);
  assert.equal(res.status, 403, 'pilot store: SportsCardsPro refused');
  assert.equal((await res.json()).featureDisabled, 'sharedPricingKeys');
  assert.ok(!seen.some(u => u.includes('webflow.com') || u.includes('sportscardspro.com')), 'nothing reaches Webflow or SportsCardsPro for the pilot store');
  // No other store's stock or orders on your website (store, 2026-10-26).
  for (const path of ['/public/storefront?store_id=' + OTHER, '/public/storefront/item?store_id=' + OTHER + '&id=x']) {
    res = await callWith(wfEnv, path, '');
    assert.equal(res.status, 403, path + ': another store never shows on your storefront');
  }
  for (const contentType of ['application/json', 'text/plain']) {
    res = await callWith(wfEnv, '/public/storefront/checkout', '', { method: 'POST', headers: { 'Content-Type': contentType }, body: JSON.stringify({ storeId: OTHER, items: [] }) });
    assert.equal(res.status, 403, 'checkout for another store refused (' + contentType + ')');
  }
  assert.ok(!seen.some(u => u.includes('inventory_items') || u.includes('storefront_inventory')), 'and its inventory is never read');
  // Nor its customers through your website's accounts, fan club or comic preorders.
  for (const [path, feature] of [['/public/account/me?store_id=' + OTHER, 'website'], ['/public/preorders?store_id=' + OTHER, 'comics']]) {
    res = await callWith(wfEnv, path, '');
    assert.equal(res.status, 403, path);
    assert.equal((await res.json()).featureDisabled, feature);
  }
  res = await callWith(wfEnv, '/public/fan-club/join', '', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ storeId: OTHER, email: 'a@example.com' }) });
  assert.equal(res.status, 403, 'fan club signup for another store refused');
  res = await callWith(wfEnv, '/public/storefront?store_id=' + PLATFORM_STORE_ID, '');
  assert.notEqual((await res.clone().json().catch(() => ({}))).featureDisabled, 'website', 'your storefront goes through as before');
  res = await callWith(wfEnv, '/proxy/sites', PLATFORM_STORE_ID);
  assert.ok(seen.some(u => u.includes('api.webflow.com')), 'your store still reaches Webflow');
  seen.length = 0;
  res = await callWith(wfEnv, '/pricing/sportscardspro/products?q=trout', PLATFORM_STORE_ID);
  assert.ok(seen.some(u => u.includes('sportscardspro.com/api/products')), 'your store still reaches SportsCardsPro');

  seen.length = 0;
  res = await call('/ebay/status', PLATFORM_STORE_ID);
  assert.notEqual((await res.clone().json().catch(() => ({}))).featureDisabled, 'ebay', 'your store reaches the eBay route as before');
  assert.ok(!seen.some(u => u.includes('store_features')), 'and its features are never looked up');

  res = await call('/store/features', OTHER);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).features.ebay, false, 'the dashboard learns what to hide');
  res = await call('/store/features', PLATFORM_STORE_ID);
  assert.equal((await res.json()).features.ebay, true);

  // Platform admin turns a feature on; your store can't be switched.
  let upsert = null;
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes('/rest/v1/platform_admins')) return new Response(JSON.stringify([{ user_id: 'user-1', role: 'super_admin' }]), { headers: { 'Content-Type': 'application/json' } });
    if (url.includes('/rest/v1/store_features?on_conflict=store_id')) { upsert = JSON.parse(init.body); return new Response(null, { status: 201 }); }
    return prevFetch(input, init);
  };
  try {
    res = await call('/admin/stores/' + OTHER + '/features', '', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ features: { whatnot: true, feeFixedCents: 15 }, reason: 'test' }) });
    assert.equal(res.status, 200, 'admin save works');
    assert.equal(upsert.whatnot, true); assert.equal(upsert.platform_fee_fixed_cents, 15); assert.equal(upsert.updated_by, 'user-1');
    res = await call('/admin/stores/' + PLATFORM_STORE_ID + '/features', '', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ features: { ebay: false } }) });
    assert.equal(res.status, 400, 'your store cannot be switched off');
  } finally { globalThis.fetch = prevFetch; }
} finally { globalThis.fetch = originalFetch; globalThis.caches = originalCaches; }

// ── Wiring ──
const worker = readFileSync(new URL('../cloudflare-worker-full.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../scripts/dashboard-app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const deploy = readFileSync(new URL('../.github/workflows/deploy-worker.yml', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase-migrations/2026-10-26-store-features.sql', import.meta.url), 'utf8');
assert.ok(worker.indexOf('const walled = await walledRequest(') < worker.indexOf("if(url.pathname.startsWith('/reference-collector/'))"), 'the guard runs before any route');
assert.ok(worker.includes("if (!isPlatformStore(stateStore, env) && !(await storeFeaturesFor(env, stateStore)).ebay) return json({ error:'eBay is not available for this store' }, 403);"), 'a pilot store can never replace your eBay connection');
for (const fn of ['runScheduledDealScans', 'runScheduledEbayReprice', 'storesWithEbayListings']) {
  const body = worker.slice(worker.indexOf('async function ' + fn + '('), worker.indexOf('async function ' + fn + '(') + 700);
  assert.ok(body.includes("await storesWithFeature(env, storeIds, 'ebay', storeFeatureReader(env))"), fn + ' skips stores without eBay');
}
assert.ok(worker.includes("await storesWithFeature(env, stores, 'comics', storeFeatureReader(env))"), 'FOC auto-list skips stores without comics');
assert.ok(worker.includes('const storeEnv = await pricingEnvForStore(env, storeId);') && worker.includes('    if (!key) continue;'), 'overnight Pokémon pricing: each store on its own key, none = skipped');
assert.ok(worker.includes('if (!(await storeFeaturesFor(env, storeId)).ebay) return [];'), 'eBay quantity follow-ups only for eBay stores');
assert.ok(worker.includes('d.ebayOfferId && !d.ebayWithdrawnAt && saleFeatures.ebay') && worker.includes('d.shopifyProductId && !d.shopifyWithdrawnAt && saleFeatures.shopify'), 'a recorded sale only ends listings on accounts the store has');
assert.ok(worker.includes("if (isPlatformStore(storeId, env)) return json({ ok:false, error:'The Mana Pocket always has every feature' }, 400);"), 'admin can never switch your store off');
assert.ok(worker.includes("'store_features.update'"), 'changes are audited');
assert.match(migration, /-- grants: service_role only store_features/);
assert.match(migration, /alter table public\.store_features enable row level security;/);
assert.ok(deploy.includes('scripts/store-features.mjs'), 'deploys on change');
assert.ok(admin.includes('data-tab="features">Features') && admin.includes('async function renderFeatures()'), 'admin Features tab');
assert.ok(ui.includes('return allowed && planCanAccessTab(tab) && featureCanAccessTab(tab);'));
assert.ok(html.includes('body.store-no-ebay [onclick*="ebay" i]{display:none !important;}'));

// Dashboard tab rules: unknown = nothing hidden; pilot store = account tabs hidden.
{
  const src = ui.slice(ui.indexOf('const TAB_STORE_FEATURE'), ui.indexOf('async function loadStoreFeatures('));
  const make = features => new Function('window', 'localStorage', 'getActiveStoreId', src + '; return featureCanAccessTab;')({ _storeFeatures: features }, { getItem: () => null }, () => 'x');
  const unknown = make(null);
  for (const tab of ['foc', 'channels', 'orders', 'pos', 'inventory']) assert.equal(unknown(tab), true, 'unknown keeps ' + tab);
  const pilot = make({ ...PILOT_DEFAULTS });
  for (const tab of ['foc', 'backlist', 'pulllists', 'channels', 'orders', 'phone', 'consign', 'whatnot']) assert.equal(pilot(tab), false, 'pilot hides ' + tab);
  for (const tab of ['pos', 'inventory', 'intake', 'research', 'shows', 'display', 'reports', 'backoffice']) assert.equal(pilot(tab), true, 'pilot keeps ' + tab);
}
console.log('second-store pilot: features and walls checks passed');
