import assert from 'node:assert/strict';
import { handleFocRequest, sharedCycleCatalog } from '../scripts/foc-preorders.mjs';
import { clearPublicCatalogBackoff } from '../scripts/public-catalog-cache.mjs';

// Supabase egress over the Free Plan (2026-10-31): the comic catalog pages
// read whole FOC weeks (~1 MB each) far too often. The /preorders/catalog
// directory (every week, PRH and Lunar) now keeps one shared copy for 3
// hours, and a single week on /preorders is shared for 3 minutes.
const kv = new Map();
const LBA_KV = {
  get: async (k, type) => { const v = kv.get(k); return v == null ? null : type === 'json' ? JSON.parse(v) : v; },
  put: async (k, v) => { kv.set(k, v); },
};
const env = { LBA_KV };

// One week, shared.
let loads = 0;
const load = async () => { loads++; return { cycle: { id: 'c' }, families: [{ id: 'f' + loads }] }; };
const id = '11111111-2222-3333-4444-555555555555';
const first = await sharedCycleCatalog(env, 'S', 'PRH', id, load);
const second = await sharedCycleCatalog(env, 'S', 'PRH', id, load);
assert.equal(loads, 1, 'a second visitor within 3 minutes reads the shared copy');
assert.deepEqual(second, first);
await sharedCycleCatalog(env, 'S', 'Lunar', id, load);
assert.equal(loads, 2, 'each distributor + week is its own copy');
// Past 3 minutes it reloads.
const key = 'public-catalog:preorder-cycle:S:PRH:' + id;
const saved = JSON.parse(kv.get(key)); saved.at -= 181000; kv.set(key, JSON.stringify(saved));
const third = await sharedCycleCatalog(env, 'S', 'PRH', id, load);
assert.equal(loads, 3);
assert.equal(third.families[0].id, 'f3');
// A missing week isn't an error.
assert.equal(await sharedCycleCatalog(env, 'S', 'PRH', '99999999-2222-3333-4444-555555555555', async () => null), null);
// No KV: straight through.
assert.equal((await sharedCycleCatalog({}, 'S', 'PRH', id, load)).families[0].id, 'f4');
clearPublicCatalogBackoff();

// The route: a full week by id goes through the shared copy; a paged
// request (the shop's "load more") and a date lookup don't.
let dbCalls = 0;
const deps = {
  json: (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }),
  supabaseAdminFetch: async (_env, path) => { dbCalls++; return { response: { ok: true, status: 200 }, data: path.startsWith('foc_cycles') ? [{ id, store_id: 'S', distributor: 'PRH', foc_date: '2026-11-02', status: 'open', customer_cutoff_at: '2099-01-01T00:00:00Z' }] : [] }; },
  addBusinessDays: (d) => d,
};
kv.clear();
const get = q => handleFocRequest(new Request('https://w.example/public/preorders?' + q), env, new URL('https://w.example/public/preorders?' + q), deps);
let res = await get('store_id=S&cycle=' + id);
assert.equal(res.status, 200, await res.clone().text());
const afterFirst = dbCalls;
res = await get('store_id=S&cycle=' + id);
assert.equal(res.status, 200);
assert.equal(dbCalls, afterFirst, 'the second visitor reads no database rows');
await get('store_id=S&cycle=' + id + '&limit=8&offset=0');
assert.ok(dbCalls > afterFirst, 'paged requests still read live');

// The directory: one shared copy for 3 hours, the last copy if a rebuild fails.
const oldCaches = globalThis.caches;
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
try {
  kv.clear();
  let directoryLoads = 0;
  const dirDeps = {
    ...deps, publicStoreId: 'S', mtgEscapeHtml: s => String(s), mtgPageShell: ({ bodyHtml }) => '<html>' + bodyHtml + '</html>',
    supabaseAdminFetch: async (_env, path) => {
      if (path.startsWith('foc_cycles')) directoryLoads++;
      return { response: { ok: true, status: 200 }, data: [] };
    },
  };
  kv.set('public-catalog:preorder-directory-v3', JSON.stringify({ at: Date.now(), entries: [{ id: 'x', name: 'Batman #25', reference: '', url: '/preorder/x/batman', image: '', price: 5, release: '', distributor: 'PRH', orderable: true }] }));
  const dir = q => handleFocRequest(new Request('https://www.themanapocket.com/preorders/catalog' + q), env, new URL('https://www.themanapocket.com/preorders/catalog' + q), dirDeps);
  res = await dir('');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Batman #25/);
  assert.equal(directoryLoads, 0, 'a fresh shared copy is used without reading any week');
  // 3 hours later it rebuilds.
  const s = JSON.parse(kv.get('public-catalog:preorder-directory-v3')); s.at -= 3 * 3600 * 1000 + 1000; kv.set('public-catalog:preorder-directory-v3', JSON.stringify(s));
  await dir('');
  assert.ok(directoryLoads > 0, 'an old copy is rebuilt');
  assert.ok(Date.now() - JSON.parse(kv.get('public-catalog:preorder-directory-v3')).at < 5000, 'and saved for everyone');
  // A failed rebuild shows the last copy instead of an error.
  kv.set('public-catalog:preorder-directory-v3', JSON.stringify({ ...s, at: Date.now() - 4 * 3600 * 1000 }));
  const failing = { ...dirDeps, supabaseAdminFetch: async () => ({ response: { ok: false, status: 522 }, data: null }) };
  res = await handleFocRequest(new Request('https://www.themanapocket.com/preorders/catalog'), env, new URL('https://www.themanapocket.com/preorders/catalog'), failing);
  assert.equal(res.status, 200, 'database down: the last copy is shown');
  assert.match(await res.text(), /Batman #25/);
} finally { globalThis.caches = oldCaches; }
console.log('preorder catalog shared cache checks passed');
