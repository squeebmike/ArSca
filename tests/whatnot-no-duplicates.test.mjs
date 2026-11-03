import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runWhatnotListingSync, findDuplicateListings, removeDuplicateWhatnotListings } from '../scripts/whatnot-sync.mjs';

// Store, 2026-11-03: "Why's it adding 2 of each?!" -- the 10-minute run and a
// sync a dashboard save started ran at once and both created each comic.
const ID = n => '00000000-0000-4000-8000-00000000000' + n;
function world() {
  const kv = {}, created = [];
  const rows = [1, 2, 3].map(n => ({ id: ID(n), status: 'in_stock', updated_at: 't', data: { sellOnWhatnot: true, quantity: 1, category: 'Comic' } }));
  const api = async (method, path, body) => {
    if (method === 'POST' && path === '/products') { await new Promise(r => setTimeout(r, 5)); created.push(body.external_id); return { ok: true, status: 201, data: { id: 'p' + created.length } }; }
    if (method === 'GET') return { ok: true, status: 200, data: { data: [{ id: 'v1' }] } };
    if (path === '/inventory/set') return { ok: true, status: 200, data: { results: [{ status: 'applied' }] } };
    return { ok: true, status: 200, data: {} };
  };
  const deps = {
    api, kvGet: async k => kv[k] ?? null, kvPut: async (k, v) => { kv[k] = v; },
    db: async path => ({ data: rows }),
    shape: () => ({ name: 'X', price: 5, categorySlug: 'comics', category: 'Comic', photos: ['https://i/x.jpg'], description: 'd' }),
  };
  return { kv, created, deps };
}
{ // What happened: a dashboard save's sync running alongside the scheduled run.
  const w = world();
  await Promise.all([runWhatnotListingSync('s', w.deps), runWhatnotListingSync('s', w.deps, { allowCreate: false })]);
  assert.deepEqual(w.created.sort(), [ID(1), ID(2), ID(3)], 'one listing per item');
}
{ // A second run starting while one is mid-way: the "creating" mark keeps it off those items.
  const w = world();
  const a = runWhatnotListingSync('s', w.deps);
  await new Promise(r => setTimeout(r, 2));
  await Promise.all([a, runWhatnotListingSync('s', w.deps)]);
  assert.deepEqual(w.created.sort(), [ID(1), ID(2), ID(3)], 'one listing per item');
}
{ // A dashboard save's sync never creates; the scheduled run does.
  const w = world();
  const out = await runWhatnotListingSync('s', w.deps, { allowCreate: false });
  assert.equal(w.created.length, 0);
  await runWhatnotListingSync('s', w.deps);
  assert.equal(w.created.length, 3, 'still created by the scheduled run');
}
// Cleanup: keep the copy the dashboard tracks, remove the extras.
const products = [
  { id: 'a1', external_id: ID(1), title: 'Children of the Atom #6' }, { id: 'a2', external_id: ID(1), title: 'Children of the Atom #6' },
  { id: 'b1', external_id: ID(2) }, { id: 'c1', external_id: 'not-a-uuid' }, { id: 'c2', external_id: 'not-a-uuid' },
];
assert.deepEqual(findDuplicateListings(products, { [ID(1)]: { productId: 'a2' } }), [{ itemId: ID(1), productId: 'a1', keep: 'a2', title: 'Children of the Atom #6' }], 'the tracked copy stays; listings not made by the sync are left alone');
{
  const calls = [];
  const api = async (method, path, body) => {
    calls.push(method + ' ' + path);
    if (method === 'GET' && path.startsWith('/products?')) return { ok: true, status: 200, data: { data: products, next_cursor: '' } };
    if (method === 'DELETE') return { ok: false, status: 405, data: { title: 'Method not allowed' } };
    if (method === 'GET') return { ok: true, status: 200, data: { data: [{ id: 'va1' }] } };
    if (path === '/inventory/set') { assert.deepEqual(body.items.map(i => [i.variant_id, i.quantity]), [['va1', 0]]); return { ok: true, status: 200, data: {} }; }
    return { ok: true, status: 200, data: {} };
  };
  const out = await removeDuplicateWhatnotListings('s', { api, kvGet: async k => k === `whatnot-link:s:${ID(1)}` ? { productId: 'a2' } : null });
  assert.equal(out.duplicates, 1); assert.equal(out.zeroed, 1, "Whatnot won't delete: the extra is set to 0 instead");
  assert.ok(calls.includes('DELETE /products/a1') && !calls.includes('DELETE /products/a2'));
}
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.match(worker, /orders: body\.orders === true, allowCreate: false \}\);/, 'a dashboard save never creates');
assert.match(worker, /runScheduledWebOrderNotify\(env\), runWhatnotDuplicateCleanup\(env, ctx\)\]\);/);
assert.match(worker, /if \(!r\.error && r\.duplicates === 0\) state\.done = true;/);
console.log('Whatnot: no duplicate listings from overlapping runs; dashboard sync never creates; cleanup keeps the tracked copy passed');
