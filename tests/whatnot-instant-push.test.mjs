// Store, 2026-11-05: "do the whatnot instant push" -- an item sold in the
// store (register, or a sale recorded from somewhere else) drops on Whatnot
// now, not at the next 10-minute run.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runWhatnotListingSync } from '../scripts/whatnot-sync.mjs';

const ID = n => '00000000-0000-4000-8000-00000000000' + n;
const kv = {}, sets = [], created = [];
const rows = [1, 2, 3].map(n => ({ id: ID(n), status: n === 2 ? 'sold' : 'in_stock', updated_at: 't', data: { sellOnWhatnot: true, quantity: n === 2 ? 0 : 1, category: 'Comic' } }));
for (const r of rows) kv[`whatnot-link:s:${r.id}`] = { productId: 'p' + r.id.slice(-1), variantId: 'v' + r.id.slice(-1), qty: 1, price: 5, published: true };
kv['whatnot-linked:s'] = Object.fromEntries(rows.map(r => [r.id, 'ok']));
kv['whatnot-sync-seen-v4:s'] = Object.fromEntries(rows.map(r => [r.id, 't'])); // the last run saw them all
const api = async (method, path, body) => {
  if (method === 'POST' && path === '/products') { created.push(body); return { ok: true, status: 201, data: { id: 'new' } }; }
  if (path === '/inventory/set') { sets.push(...body.items.map(i => [i.variant_id, i.quantity])); return { ok: true, status: 200, data: { results: [{ status: 'applied' }] } }; }
  if (method === 'GET') return { ok: true, status: 200, data: { data: [{ id: 'v' }] } };
  return { ok: true, status: 200, data: {} };
};
const deps = {
  api, kvGet: async k => kv[k] ?? null, kvPut: async (k, v) => { kv[k] = v; },
  db: async path => ({ data: rows.filter(r => !path.includes('id=in.(') || path.includes(r.id)) }),
  shape: row => ({ name: 'X', price: 5, quantity: row.data.quantity, categorySlug: 'comics', category: 'Comic', photos: ['https://i/x.jpg'], description: 'd' }),
};
// A normal run: nothing changed since the last one -- nothing to do.
assert.equal((await runWhatnotListingSync('s', deps)).checked, 0);
// The instant push: just the sold item, even though the last run saw it.
const out = await runWhatnotListingSync('s', deps, { onlyIds: [ID(2)] });
assert.equal(out.checked, 1, 'only that item');
assert.ok(sets.some(([v, q]) => v === 'v2' && q === 0), 'its Whatnot listing goes to 0: ' + JSON.stringify(sets));
assert.equal(created.length, 0, 'never creates a listing');

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.match(worker, /url\.pathname === '\/whatnot\/push-items' && request\.method === 'POST'/);
assert.match(worker, /return runWhatnotListingSync\(storeId, deps, \{ onlyIds: ids, allowCreate: false \}\);/);
// A sale recorded elsewhere pushes too; a Whatnot sale doesn't (Whatnot knows).
assert.match(worker, /if \(!\/whatnot\/i\.test\(channel\) && \(d\.sellOnWhatnot === true \|\| d\.whatnotListing\)\) \{\n\s+const push = pushWhatnotItemsNow\(env, ctx, storeId, \[invRow\.id\]\)/);
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
assert.match(app, /storeWorkerFetch\('\/whatnot\/push-items', \{ method:'POST'/, 'a register sale sends its Whatnot items');
console.log('Whatnot instant push: a store sale drops the Whatnot listing now');
