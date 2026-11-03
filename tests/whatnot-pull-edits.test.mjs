import assert from 'node:assert/strict';
import fs from 'node:fs';
import { whatnotEditPlan, pullWhatnotEdits, PULL_DROP_CONFIRM_MS } from '../scripts/whatnot-sync.mjs';

// Store, 2026-11-03: "I'd need Whatnot to update the prices to our dash and
// the counts as well." Edits made in the Whatnot app come back.
const t0 = Date.parse('2026-11-03T20:00:00Z');
const link = { productId: 'p1', variantId: 'v1', price: 20, qty: 3 };
const same = { price: 20, qty: 3 };
assert.deepEqual(whatnotEditPlan({ link, want: same, wnPrice: 25, wnQty: 3, now: t0 }), { price: 25, qty: null, pendingDrop: null }, 'price edited on Whatnot');
assert.deepEqual(whatnotEditPlan({ link, want: same, wnPrice: 20, wnQty: 5, now: t0 }), { price: null, qty: 5, pendingDrop: null }, 'count raised on Whatnot: at once');
let p = whatnotEditPlan({ link, want: same, wnPrice: 20, wnQty: 1, now: t0 });
assert.equal(p.qty, null, 'a drop waits (could be a sale not recorded yet)');
assert.deepEqual(p.pendingDrop, { qty: 1, at: new Date(t0).toISOString() });
const waiting = { ...link, pendingDrop: p.pendingDrop };
assert.equal(whatnotEditPlan({ link: waiting, want: same, wnPrice: 20, wnQty: 1, now: t0 + 5 * 60000 }).qty, null, 'still too soon');
assert.equal(whatnotEditPlan({ link: waiting, want: same, wnPrice: 20, wnQty: 1, now: t0 + PULL_DROP_CONFIRM_MS }).qty, 1, 'still there 20 min later: taken');
// A sale recorded meanwhile took the copy off the dashboard: dashboard wins.
assert.deepEqual(whatnotEditPlan({ link: waiting, want: { price: 20, qty: 2 }, wnPrice: 20, wnQty: 2, now: t0 + PULL_DROP_CONFIRM_MS }), { price: null, qty: null, pendingDrop: null }, 'a sale is never taken twice');
assert.deepEqual(whatnotEditPlan({ link, want: { price: 22, qty: 3 }, wnPrice: 25, wnQty: 3, now: t0 }), { price: null, qty: null, pendingDrop: null }, 'edited on both: dashboard wins');
assert.deepEqual(whatnotEditPlan({ link, want: same, wnPrice: null, wnQty: null, now: t0 }), { price: null, qty: null, pendingDrop: null }, 'fields Whatnot did not send are left alone');

// The run: a slice of linked items, KV written only on a change.
const kv = { 'whatnot-linked:s': { a: 'ok', b: 'ok', c: 'ok' }, 'whatnot-link:s:a': { ...link }, 'whatnot-link:s:b': { ...link, productId: 'p2', variantId: 'v2' }, 'whatnot-link:s:c': { ...link, productId: 'p3', variantId: 'v3' } };
const puts = [], updates = [];
const wn = { p1: { pricing: { buy_it_now: { price: { amount: '25.00' } } }, inventory: { quantity: 3 } }, p2: { pricing: { buy_it_now: { price: { amount: '20.00' } } }, inventory: { quantity: 3 } }, p3: { pricing: { buy_it_now: { price: { amount: '20.00' } } }, inventory: { quantity: 1 } } };
const deps = {
  storeId: 's',
  api: async (m, path) => { const id = path.match(/products\/(p\d)\//)[1]; return { ok: true, status: 200, data: { data: [{ id: 'v' + id.slice(1), ...wn[id] }] } }; },
  kvGet: async k => kv[k] ?? null, kvPut: async (k, v) => { puts.push(k); kv[k] = v; },
  rows: async ids => ids.map(id => ({ id, status: 'in_stock', data: { sellOnWhatnot: true, quantity: 3, category: 'Comic' } })),
  shape: () => ({ price: 20, name: 'X', photos: [] }),
  updateItem: async (id, row, patch) => updates.push([id, patch]),
};
const out = await pullWhatnotEdits('s', deps, { now: t0 });
assert.deepEqual(updates, [['a', { priceOverride: 25 }]], 'only the edited price comes back');
assert.equal(out.prices, 1); assert.equal(out.waiting, 1, 'c: a drop waits');
assert.equal(kv['whatnot-link:s:a'].price, 25, 'so it is not pushed back');
assert.ok(!puts.includes('whatnot-link:s:b'), 'nothing changed for b: no KV write');
assert.ok(kv['whatnot-link:s:c'].pendingDrop);

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const run = worker.slice(worker.indexOf('async function runWhatnotSyncForStore('), worker.indexOf('async function runWhatnotSyncForStore(') + 3000);
assert.ok(run.indexOf('reconcileWhatnotOrders') < run.indexOf('pullWhatnotEdits('), 'orders recorded before edits are read');
assert.match(run, /if \(patch\.quantity != null\) data\.qty = patch\.quantity;/);
console.log('Whatnot edits -> dashboard: price, raised/dropped counts, sale race, dashboard wins, KV writes passed');
