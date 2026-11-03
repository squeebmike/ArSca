import assert from 'node:assert/strict';
import { syncWhatnotItem, WHATNOT_PROFILES } from '../scripts/whatnot-sync.mjs';

// Store, 2026-11-03: 261 comics put on Whatnot, 1 listed. The size profile
// id from the first was refused for the rest: "Invalid product: Dimension
// profile not found. It must exist, be active, and belong to you or Whatnot."
const row = { id: '00000000-0000-4000-8000-000000000001', status: 'in_stock', data: { sellOnWhatnot: true, quantity: 1 } };
const item = { name: 'X-Force #4', price: 5, categorySlug: 'comics', category: 'Comic', photos: ['https://img/x.jpg'], description: 'x' };
const posts = [];
let saved = { comic: 'dp_123' };
const api = async (method, path, body) => {
  if (method === 'POST' && path === '/products') {
    posts.push(body.dimension_profile);
    if (body.dimension_profile?.id === 'dp_123') return { ok: false, status: 422, data: { title: 'Invalid product', detail: 'Dimension profile not found. It must exist, be active, and belong to you or Whatnot.' } };
    return { ok: true, status: 201, data: { id: 'p1', url: 'u', dimension_profile: { id: 'dp_new' } } };
  }
  if (method === 'GET') return { ok: true, status: 200, data: { data: [{ id: 'v1' }] } };
  if (path === '/inventory/set') return { ok: true, status: 200, data: { results: [{ status: 'applied' }] } };
  return { ok: true, status: 200, data: {} };
};
const opts = { profileId: k => saved[k] || '', saveProfileId: async (k, v) => { saved[k] = v; }, newKey: () => 'k' };
const r = await syncWhatnotItem(api, row, item, null, opts);
assert.equal(r.action, 'created', JSON.stringify(r));
assert.deepEqual(posts, [{ id: 'dp_123' }, WHATNOT_PROFILES.comic], 'refused id, then the size spelled out');
assert.equal(saved.comic, 'inline', 'the refused id is dropped for good, and the new one is not saved');
posts.length = 0;
await syncWhatnotItem(api, { ...row, id: '00000000-0000-4000-8000-000000000002' }, item, null, opts);
assert.deepEqual(posts, [WHATNOT_PROFILES.comic], 'next comics go straight to the spelled-out size');
console.log('Whatnot refused size profile: retried inline, never reused again passed');
