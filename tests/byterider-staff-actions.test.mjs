import fs from 'node:fs';
import assert from 'node:assert/strict';
// 2026-11-28 (store: "if I give you photos of books, can you put it in the cart? ... show you someone's order ...
// build all of it"): photos in, Worker-side find_items / orders, and buttons the staff member taps.
const S = await import('../scripts/byterider-staff.mjs'), L = await import('../scripts/byterider-staff-local.mjs');
const id = '0b6a1f3e-1111-4222-8333-444455556666';
// Photos: only real base64 images, at most 10, attached to the question.
const pic = { media_type: 'image/jpeg', data: 'A'.repeat(200) };
assert.equal(S.cleanImages(Array(14).fill(pic)).length, 10);
assert.equal(S.cleanImages([{ media_type: 'image/gif', data: 'A'.repeat(200) }, { media_type: 'image/png', data: '<script>' + 'A'.repeat(200) }]).length, 0);
let first;
const claude = async body => { first ||= body; return body.messages.length < 3
  ? { content: [{ type: 'tool_use', id: 't1', name: 'find_items', input: { query: 'jean grey 1' } }, { type: 'tool_use', id: 't2', name: 'suggest_actions', input: { actions: [{ kind: 'cart', label: 'Put Jean Grey in a new cart', item_ids: [id, 'not-an-id'] }, { kind: 'delete_everything', label: 'x' }] } }] }
  : { content: [{ type: 'text', text: 'Found Jean Grey #1 -- $4.99.' }] }; };
const local = async (tool, args) => (assert.equal(tool, 'find_items'), { items: [{ id, name: 'Jean Grey #1', qty: 2, price: 4.99 }] });
const out = await S.runStaffAsk({ question: '', images: [pic] }, { claude, local, data: async () => { throw new Error('the database lookup is not for find_items'); } });
assert.equal(out.ok, true);
assert.ok(Array.isArray(first.messages[0].content) && first.messages[0].content[0].type === 'image', 'the photo goes with the question');
assert.deepEqual(out.actions, [{ kind: 'cart', label: 'Put Jean Grey in a new cart', itemIds: [id] }], 'only known kinds, only real ids');
assert.deepEqual(S.cleanActions([{ kind: 'shipped', label: 'Mark shipped', channel: 'etsy', order_id: '1' }, { kind: 'shipped', label: 'Mark shipped', channel: 'whatnot', order_id: 'wn-9' }]), [{ kind: 'shipped', label: 'Mark shipped', channel: 'whatnot', orderId: 'wn-9' }]);
assert.match(S.staffSystemPrompt(), /cannot change anything yourself/);
// find_items: every word must match; sold-out items left out; ids come back.
const rows = [{ id, status: 'in_stock', data: { name: 'JEAN GREY #1 COVER A', quantity: 2, price: 4.99 } }, { id: id.replace('6666', '7777'), status: 'in_stock', data: { name: 'JEAN GREY #1 ITO VARIANT', quantity: 0, price: 4.99 } }, { id: id.replace('6666', '8888'), status: 'in_stock', data: { name: 'JEAN GREY #2', quantity: 1 } }];
let path = '';
const found = await L.byteriderStaffLocal('find_items', { query: 'Jean Grey #1' }, { storeId: 's1', db: async p => { path = p; return { data: rows }; } });
assert.deepEqual(found.items.map(i => i.id), [id]);
assert.match(path, /^inventory_items\?store_id=eq\.s1&/);
// orders: buyer first names only.
const board = async () => ({ ok: true, channels: { website: [{ id: 'sf-1', number: 'ORD-9439859E', buyer: 'Marie Abu-Zahra', createdAt: '2026-11-28T01:08:14Z', total: 11.7, status: 'ready', reason: 'ship by 2026-12-01', items: [{ title: 'JEAN GREY #1', qty: 1, price: 4.99, state: 'in' }] }], ebay: [], whatnot: [] } });
const o = await L.byteriderStaffLocal('orders', { query: 'marie' }, { storeId: 's1', board });
assert.equal(o.orders[0].buyer, 'Marie'); assert.equal(o.orders[0].total, 11.7);
// Worker and dashboard wiring.
const w = fs.readFileSync('cloudflare-worker-full.js', 'utf8'), dash = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
const route = w.slice(w.indexOf("url.pathname === '/staff/byterider/ask'"), w.indexOf("// The public Pokémon Set Guide's set list"));
assert.ok(route.includes('images: parsed.data?.images') && route.includes('local: (tool, args) => byteriderStaffLocal(') && !/temperature/.test(route), 'Haiku 5.5 takes no temperature');
assert.ok(fs.readFileSync('.github/workflows/deploy-worker.yml', 'utf8').includes('scripts/byterider-staff-local.mjs'));
const chat = dash.slice(dash.indexOf('function openStaffByteRider'), dash.indexOf('window.openStaffByteRider'));
assert.ok(chat.includes("if(a.kind === 'cart'){") && chat.includes('startNewSaleCart();') && chat.includes('dashAddToCart(id)'));
assert.ok(chat.includes("'/whatnot/show-only?store_id='") && chat.includes("'/orders/mark-shipped'") && chat.includes("'/store/dungeon-setups?store_id='"));
assert.ok((chat.match(/confirm\(/g) || []).length >= 2, 'cart and show ask first');
assert.ok(!/innerHTML/.test(chat), 'answers and buttons are text, never HTML');
console.log('Staff ByteRider photos, orders and tap-to-do buttons: passed');
