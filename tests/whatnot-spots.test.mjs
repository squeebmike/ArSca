// SPOTS ON WHATNOT (store, 2026-11-13: "an easy way to make surprise set items and games for the Whatnot app and
// not have all those items on the site in inventory ... a break with 75 character spots" -- "yes").
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const W = await import('../scripts/whatnot-sync.mjs');
const calls = [], kv = new Map();
const api = async (method, path, body) => { calls.push([method, path, body]);
  if (method === 'POST' && path === '/products') return { ok: true, status: 200, data: { id: 'p' + calls.length, url: 'https://whatnot.example/p' } };
  if (method === 'GET' && /\/variants/.test(path)) return { ok: true, status: 200, data: { data: [{ id: 'v1' }] } };
  return { ok: true, status: 200, data: {} }; };
const deps = { api, storeId: 's1', kvGet: async k => kv.get(k), kvPut: async (k, v) => { kv.set(k, v); }, profileId: async () => '', saveProfileId: async () => {} };
const SHOW = '11111111-2222-3333-4444-555555555555';
const spots = [{ ext: 'spot-abc-1', title: 'SPIDER-MAN', price: 4.5 }, { ext: 'spot-abc-2', title: 'BATMAN', price: 5 }, { ext: 'not-a-spot', title: 'X', price: 5 }];
// No photo: nothing is sent.
assert.ok((await W.listSpotsInShow(spots, SHOW, deps, {})).every(r => r.error)); assert.equal(calls.length, 0);
const out = await W.listSpotsInShow(spots, SHOW, deps, { photo: 'https://img.example/box.jpg', category: 'comics' });
assert.deepEqual(out.map(r => !!r.listed), [true, true, false]);
const made = calls.filter(c => c[0] === 'POST' && c[1] === '/products').map(c => c[2]);
assert.equal(made.length, 2); assert.equal(made[0].external_id, 'spot-abc-1', 'the spot\'s own id -- not inventory'); assert.equal(made[0].category.id, '244'); assert.deepEqual(made[0].media, [{ url: 'https://img.example/box.jpg' }]);
const priced = calls.find(c => c[0] === 'PATCH' && /variants/.test(c[1])); assert.equal(priced[2].variants[0].price.amount, '5.00', 'whole dollars, rounded up');
const inv = calls.find(c => c[1] === '/inventory/set'); assert.equal(inv[2].items[0].quantity, 1);
const merch = calls.find(c => /\/merchandising\/products\//.test(c[1])); assert.equal(merch[2].transaction_type, 'buy_it_now'); assert.equal(merch[2].reserve_for_live, true, 'show only, never the shop'); assert.deepEqual(merch[2].shows, { strategy: 'ADD', show_ids: [SHOW] });
// Again: the same listing (no duplicate), now an auction.
calls.length = 0; await W.listSpotsInShow(spots.slice(0, 1), SHOW, deps, { photo: 'https://img.example/box.jpg', mode: 'auction' });
assert.equal(calls.filter(c => c[1] === '/products').length, 0, 'never listed twice'); assert.equal(calls.find(c => /merchandising/.test(c[1]))[2].transaction_type, 'auction');
assert.ok(W.SPOT_EXT.test('spot-abc-75') && !W.SPOT_EXT.test('11111111-2222-3333-4444-555555555555'));
// The worker route, the room and the remote.
const wk = read('cloudflare-worker-full.js'), room = read('scripts/live-studio-room.mjs'), ctl = read('scripts/live-studio-controls.js');
assert.ok(wk.includes("if (url.pathname === '/whatnot/spots-list' && request.method === 'POST') {") && wk.includes("requireStoreUser(request, env, storeId, ['owner','admin','manager'])") && wk.includes("const w = chanceWordIn(sp.title);"));
assert.ok(room.includes("m.items = m.items.map((it, i) => ({ ...it, ext: 'spot-' + m.batch + '-' + (i + 1) }));") && room.includes("const hitAt = s.machine.items.findIndex(it => !it.sold && it.ext && exts.has(it.ext));"));
assert.ok(ctl.includes('id="vm-wn-go"') && ctl.includes("if(!confirm('List '+todo.length+' spots on Whatnot") && ctl.includes("if(!connectedStore)throw Error('Connect first"));
console.log('Spots on Whatnot (no inventory): passed');
