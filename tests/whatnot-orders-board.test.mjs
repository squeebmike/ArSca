import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildOrdersBoard } from '../scripts/orders-board.mjs';
import { orderBoardNotes, syncWhatnotShipments } from '../scripts/whatnot-sync.mjs';

// Store, 2026-11-01: Whatnot orders on the orders board -- buyer, show,
// what ships together, label and tracking -- with nothing imported.

// Payments recorded from Whatnot's orders: "whatnot-api:<order>:<item>".
const pay = (order, item, sale, amount) => ({ sale_id: sale, provider: 'whatnot', reference: `whatnot-api:${order}:${item}`, status: 'confirmed', amount, created_at: '2026-10-31T18:45:00Z' });
const payments = [pay('o1', 'a', 's1', 10), pay('o1', 'b', 's2', 5), pay('o2', 'c', 's3', 20), pay('o3', 'd', 's4', 7), pay('o4', 'e', 's5', 9), pay('o5', 'f', 's6', 4)];
const lines = ['s1', 's2', 's3', 's4', 's5', 's6'].map((sale, i) => ({ sale_id: sale, item_id: null, title: 'Book ' + i, quantity: 1, unit_price: 5 }));
const whatnotInfo = {
  orders: {
    o1: { buyer: 'riddleofsteel', showId: 'sh1', status: 'pending_fulfillment' },
    o2: { buyer: 'riddleofsteel', showId: 'sh1', status: 'pending_fulfillment' },
    o3: { buyer: 'richie5_0', showId: 'sh1', status: 'cancelled' },
    o4: { buyer: 'amy', showId: 'sh1', status: 'completed' },
    o5: { buyer: 'bob', showId: 'sh1', status: 'pending_fulfillment' },
  },
  ship: {
    o1: { shipmentId: 'ship1', status: 'label_generated', carrier: 'USPS', trackingCode: '9400', url: 'https://whatnot.example/s/1', dropoffDue: '2026-11-03T00:00:00-07:00' },
    o2: { shipmentId: 'ship1', status: 'label_generated', carrier: 'USPS', trackingCode: '9400', url: 'https://whatnot.example/s/1' },
    o5: { shipmentId: 'ship5', status: 'in_transit', carrier: 'USPS', trackingCode: '9405' },
  },
  showTitles: { sh1: 'Pre Funk PARTY' },
};
const board = buildOrdersBoard({ payments, lines, whatnotInfo, today: '2026-11-01' });
const w = board.channels.whatnot;
const by = id => w.find(o => o.id === id);
assert.deepEqual(w.map(o => o.id).sort(), ['o1', 'o2', 'o4', 'o5'], 'one card per Whatnot order (not one for all), the cancelled one left off');
assert.equal(by('o1').items.length, 2, "an order's items stay together");
assert.equal(by('o1').buyer, 'riddleofsteel');
assert.equal(by('o1').show, 'Pre Funk PARTY');
assert.equal(by('o1').shipsWith, 1, 'o1 and o2 go in one box');
assert.equal(by('o1').shipped, false, 'label printed is not shipped yet');
assert.equal(by('o1').shipment.status, 'label_generated');
assert.equal(by('o5').shipped, true);
assert.match(by('o5').shippedBy, /Whatnot: in transit · USPS 9405/);
assert.equal(by('o4').shipped, true, 'completed on Whatnot counts as shipped');
// The old "whatnot:<order>:..." references still work.
const old = buildOrdersBoard({ payments: [{ ...pay('x', 'y', 's9', 3), reference: 'whatnot:ORD9:sku' }], lines: [], today: '2026-11-01' });
assert.equal(old.channels.whatnot[0].id, 'ORD9');

// Order notes: changed only when something changed; capped.
let r = orderBoardNotes({}, [{ id: 'a', buyer: { username: 'amy' }, show_id: 's', status: 'pending', created_at: '2026-10-01' }]);
assert.equal(r.changed, true); assert.equal(r.notes.a.buyer, 'amy');
r = orderBoardNotes(r.notes, [{ id: 'a', buyer: { username: 'amy' }, show_id: 's', status: 'pending', created_at: '2026-10-01' }]);
assert.equal(r.changed, false, 'nothing new: no write');
r = orderBoardNotes(r.notes, [{ id: 'a', buyer: { username: 'amy' }, show_id: 's', status: 'cancelled', created_at: '2026-10-01' }]);
assert.equal(r.changed, true); assert.equal(r.notes.a.status, 'cancelled');
r = orderBoardNotes({}, [1, 2, 3].map(n => ({ id: 'n' + n, created_at: '2026-10-0' + n })), 2);
assert.deepEqual(Object.keys(r.notes).sort(), ['n2', 'n3'], 'the oldest dropped past the cap');

// Shipments: each shipment's orders mapped; unchanged ones not looked up again.
{
  const kv = new Map(); const asked = [];
  let pageCalls = 0;
  const api = async (m, path) => {
    asked.push(path);
    if (path.startsWith('/shipments?')) { pageCalls++; return { ok: true, status: 200, data: { data: [{ id: 'ship1', status: 'label_generated', updated_at: 't1', tracking: { carrier: 'USPS', tracking_code: '9400' }, recipient: { username: 'riddleofsteel' } }], next_cursor: pageCalls < 3 ? 'c' + pageCalls : null } }; }
    if (path === '/shipments/ship1/items?limit=50') return { ok: true, status: 200, data: { data: [{ order_id: 'o1' }, { order_id: 'o2' }] } };
    throw new Error(path);
  };
  const deps = { api, storeId: 'S', kvGet: async k => kv.get(k) ?? null, kvPut: async (k, v) => { kv.set(k, structuredClone(v)); } };
  await syncWhatnotShipments(deps);
  assert.equal(pageCalls, 3, 'the first look goes further back');
  const b = kv.get('whatnot-board-ship:S');
  assert.equal(b.orders.o1.shipmentId, 'ship1'); assert.equal(b.orders.o2.trackingCode, '9400'); assert.equal(b.orders.o1.buyer, 'riddleofsteel'); assert.equal(b.orders.o1.orders, 2);
  asked.length = 0; pageCalls = 0;
  const res = await syncWhatnotShipments(deps);
  assert.equal(res.changed, 0); assert.ok(!asked.some(p => p.includes('/items')), 'unchanged shipment not looked up again');
  assert.equal(pageCalls, 2, 'later looks are shorter');
}

// Wiring.
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.match(worker, /try \{ out\.shipments = await syncWhatnotShipments\(deps\); \}/, 'every 10-minute run');
assert.match(worker, /if \(type\.startsWith\('shipments\.'\)\) console\.log\('Whatnot shipments', JSON\.stringify\(await syncWhatnotShipments\(deps, \{ pages: 1 \}\)\)\);/, 'and right away on a shipment event');
assert.match(worker, /try \{ await deps\.noteOrders\(\[data\]\); \} catch \(_\) \{\}/);
const boardSrc = fs.readFileSync('scripts/orders-board.mjs', 'utf8');
assert.match(boardSrc, /whatnotInfo\.orders = \(await env\.LBA_KV\.get\('whatnot-board-orders:' \+ storeId, 'json'\)\)/);
const dash = fs.readFileSync('dashboard.html', 'utf8');
assert.match(dash, /function openWhatnotPackList\(\)\{/);
assert.match(dash, /onclick="openWhatnotPackList\(\)">WHATNOT PACK LIST</);
const label = new Function(dash.match(/const WHATNOT_SHIP_WORDS = [^\n]+\n/)[0] + dash.match(/function whatnotShipLabel\(sh\)\{[\s\S]*?\n\}\n/)[0] + 'function orderBoardDate(d){ return String(d).slice(5,10); } return whatnotShipLabel;')();
assert.equal(label({ status: 'label_generated', carrier: 'USPS', tracking: '9400', dropoffDue: '2026-11-03T00:00:00-07:00' }), 'label printed · USPS 9400 · drop off by 11-03');
assert.equal(label({ status: 'in_transit', carrier: 'USPS', tracking: '9405', dropoffDue: '2026-11-03' }), 'in transit · USPS 9405');
console.log('whatnot orders board checks passed');
