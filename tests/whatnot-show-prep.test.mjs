import assert from 'node:assert/strict';
import fs from 'node:fs';
import { prepCandidates, startPriceFor, buildLineup, lineupTotals, lineupStage, itemPrice } from '../scripts/whatnot-show-prep.mjs';
import { addItemsToWhatnotShow, returnUnsoldToShop, showWrapUp, UNSOLD_RETURN_WAIT_MS } from '../scripts/whatnot-sync.mjs';

// Store, 2026-11-01: "build the show prep and all whatnot features" --
// one-tap show prep, the post-show wrap-up, and unsold items back to the shop.
const item = (id, price, extra = {}) => ({ id, source: 'built_in', status: 'in_stock', qty: 1, name: 'Item ' + id, category: 'Comic', market: price, cost: 0, ...extra });

// What can go in a show.
const inv = [
  item('a', 40, { name: 'Amazing Spider-Man #300', cost: 25 }),
  item('b', 5, { name: 'Spider-Man 2099 #1' }),
  item('c', 0, { name: 'Spider-Man unpriced' }),
  item('d', 12, { name: 'Spider-Man presale', status: 'presale' }),
  item('e', 9, { name: 'Spider-Man dropship', raw: { dropship: true } }),
  item('f', 7, { name: 'Spider-Man none left', qty: 0 }),
  item('g', 15, { name: 'X-Men #1' }),
  item('h', 0, { name: 'Spider-Man floor only', raw: { minPrice: 12 } }),
  item('i', 30, { name: 'Spider-Man on hold', lifecycle: 'hold' }),
  item('j', 20, { name: 'Spider-Man supplier', ownershipType: 'supplier' }),
];
assert.deepEqual(prepCandidates(inv, { theme: 'spider-man' }).map(i => i.id).sort(), ['a', 'b', 'h'], 'in stock, priced, the store\'s own, matching the theme');
assert.equal(itemPrice(inv[7]), 12, 'a floor the store set is its price');
assert.deepEqual(prepCandidates(inv, { theme: 'spider-man', minPrice: 10 }).map(i => i.id).sort(), ['a', 'h']);
assert.deepEqual(prepCandidates(inv, { category: 'comic', excludeIds: ['a'] }).map(i => i.id).sort(), ['b', 'g', 'h']);

// Starting bids: protect cost by default, never above the price, never under $1.
assert.equal(startPriceFor(item('x', 40, { cost: 24.2 })), 25, 'starts at what it cost (rounded up)');
assert.equal(startPriceFor(item('x', 40)), 12, 'no cost known: 30% of price');
assert.equal(startPriceFor(item('x', 40, { cost: 60 })), 40, 'never above its price');
assert.equal(startPriceFor(item('x', 2)), 1, 'never under $1');
assert.equal(startPriceFor(item('x', 40, { cost: 30 }), 'dollar'), 1);
assert.equal(startPriceFor(item('x', 40), 'percent', 25), 10);

// The running order: $1 openers, higher and lower taking turns, the biggest
// about two-thirds in, the second biggest to close.
const pool = Array.from({ length: 12 }, (_, n) => item('p' + n, (n + 1) * 10, { cost: (n + 1) * 4 }));
const { lineup, totals } = buildLineup(pool, { count: 10, hooks: 2 });
assert.equal(lineup.length, 10, 'the 10 most valuable');
assert.ok(lineup.every(e => e.price >= 30), 'the cheapest two of the pool are left out');
assert.deepEqual(lineup.slice(0, 2).map(e => [e.role, e.start]), [['hook', 1], ['hook', 1]], 'openers start at $1');
assert.deepEqual(lineup.slice(0, 2).map(e => e.price), [30, 40], 'the cheapest picked items open');
const bigAt = lineup.findIndex(e => e.role === 'big');
assert.equal(lineup[bigAt].price, 120);assert.ok(bigAt >= 5 && bigAt <= 7, 'the biggest about two-thirds in: ' + bigAt);
assert.deepEqual([lineup.at(-1).role, lineup.at(-1).price], ['closer', 110]);
const mains = lineup.filter(e => e.role === 'main').map(e => e.price);
assert.ok(mains[0] > mains[1] && mains[1] < mains[2], 'higher, lower, higher: ' + mains);
assert.ok(lineup.filter(e => e.role !== 'hook').every(e => e.start === Math.ceil(e.cost)), 'the rest protect their cost');
assert.equal(totals.count, 10);assert.equal(totals.underCost, 2, 'the two $1 openers start under cost');
assert.equal(new Set(lineup.map(e => e.id)).size, 10, 'no item twice');
assert.equal(buildLineup([], {}).lineup.length, 0);
assert.equal(buildLineup([item('solo', 9)], { hooks: 2 }).lineup[0].role, 'big', 'one item: just itself');
assert.equal(lineupTotals([{ price: 10, cost: 4, start: 1 }, { price: 5, cost: 0, start: 2 }]).starts, 3);
const st = lineupStage(lineup);
assert.equal(st.now.title, lineup[0].title);assert.equal(st.next.length, 9, 'the overlay gets the whole order');

// Per-item starting bids from show prep, and the show remembers what it auctions.
{
  const kv = new Map([['whatnot-link:S:a', { productId: 'pa', variantId: 'va', price: 40, qty: 1, published: true }], ['whatnot-link:S:b', { productId: 'pb', variantId: 'vb', price: 5, qty: 1, published: true }]]);
  const calls = [];
  const api = async (m, path, body) => { calls.push([m, path, body]); return { ok: true, status: 200, data: {} }; };
  const deps = { api, storeId: 'S', kvGet: async k => kv.get(k) ?? null, kvPut: async (k, v) => { kv.set(k, v); },
    rows: async ids => ids.map(id => ({ id, status: 'in_stock', data: { name: id, sellOnWhatnot: true, quantity: 1 } })), shape: () => ({ price: 40 }) };
  const res = await addItemsToWhatnotShow(['a', 'b'], 'show-9', deps, { starts: { a: 25, b: 1 } });
  assert.deepEqual(res.map(r => r.startPrice), [25, 1]);
  assert.deepEqual(calls.filter(c => c[0] === 'PATCH').map(c => c[2].variants[0].pricing.auction.start_price.amount), ['25.00', '1.00']);
  assert.ok(calls.filter(c => c[1].startsWith('/merchandising/')).every(c => c[2].transaction_type === 'auction'));
  assert.deepEqual(kv.get('whatnot-show-items:S:show-9'), ['a', 'b']);

  // After the show: waits 30 minutes, then the ones still here go back to the shop, once.
  let t = 1_000_000;
  assert.equal((await returnUnsoldToShop('show-9', deps, { now: t })).waiting, true, 'first seen ended: wait for the last orders');
  assert.equal((await returnUnsoldToShop('show-9', deps, { now: t + 60000 })).waiting, true);
  deps.rows = async ids => ids.map(id => id === 'a' ? { id, status: 'sold', data: { quantity: 0 } } : { id, status: 'in_stock', data: { quantity: 1 } });
  const back = await returnUnsoldToShop('show-9', deps, { now: t + UNSOLD_RETURN_WAIT_MS + 1 });
  assert.deepEqual(back.returned, ['b'], 'the sold one stays; the unsold one goes back');
  assert.deepEqual(calls.at(-1)[2], { transaction_type: 'buy_it_now', reserve_for_live: false });
  const n = calls.length;
  assert.equal((await returnUnsoldToShop('show-9', deps, { now: t + 2 * UNSOLD_RETURN_WAIT_MS })).skipped, 'already returned');
  assert.equal(calls.length, n);
  // A show nothing was auctioned in: nothing to do.
  const none = await returnUnsoldToShop('show-x', deps, { now: t });
  assert.equal(none.waiting, true);
  assert.deepEqual((await returnUnsoldToShop('show-x', deps, { now: t + UNSOLD_RETURN_WAIT_MS + 1 })).returned, []);
}

// The wrap-up: numbers, pack list by buyer, new vs returning, unsold.
{
  const show = { id: 'S1', title: 'Pre Funk', status: 'ended', started_at: '2026-11-01T02:00:00Z' };
  const notes = {
    o1: { buyer: 'collector42', showId: 'S1', status: 'completed', createdAt: '2026-11-01T02:10:00Z' },
    o2: { buyer: 'newbie', showId: 'S1', status: 'completed', createdAt: '2026-11-01T02:20:00Z' },
    o3: { buyer: 'collector42', showId: 'S1', status: 'completed', createdAt: '2026-11-01T02:30:00Z' },
    o4: { buyer: 'gone', showId: 'S1', status: 'cancelled', createdAt: '2026-11-01T02:31:00Z' },
    old: { buyer: 'collector42', showId: 'S0', status: 'completed', createdAt: '2026-10-25T02:00:00Z' },
  };
  const lines = [{ orderId: 'o1', title: 'Spawn #1', price: 20, quantity: 1 }, { orderId: 'o2', title: 'X-Men #1', price: 12.5, quantity: 1 }, { orderId: 'o3', title: 'Venom #1', price: 30, quantity: 1 }, { orderId: 'other', title: 'Not this show', price: 99 }];
  const w = showWrapUp({ show, summary: { gross: 62.5, fees: 8.57, net: 40, sold: 3, buyersCount: 2, peakViewers: 8, final: true }, notes, lines,
    unsold: [{ id: 'u1', data: { name: 'Hulk #181', salePrice: 400 } }], returned: { at: '2026-11-01T03:40:00Z', returned: ['u2'] } });
  assert.equal(w.numbers.gross, 62.5);assert.equal(w.numbers.peakViewers, 8);
  assert.deepEqual(w.buyers.map(b => [b.buyer, b.items.length, b.total, b.returning]), [['collector42', 2, 50, true], ['newbie', 1, 12.5, false]], 'a cancelled order is left out');
  assert.deepEqual(w.newBuyers, ['newbie']);assert.deepEqual(w.returningBuyers, ['collector42']);
  assert.equal(w.sold.length, 3, 'only this show\'s sales');
  assert.deepEqual(w.unsold, [{ id: 'u1', name: 'Hulk #181', price: 400 }]);
  assert.equal(showWrapUp({ show, notes: {} }).numbers, null, 'no numbers yet');
}

// Wiring.
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.ok(worker.includes("if (url.pathname === '/whatnot/show-wrap' && request.method === 'GET') {"));
assert.match(worker, /if \(listingSettings\.unsoldBackToShop !== false\) \{\n      for \(const sh of out\.shows \|\| \[\]\) \{\n        if \(sh\.status !== 'ended' \|\| !sh\.showId\) continue;\n        try \{ const r = await returnUnsoldToShop\(sh\.showId, deps\);/);
assert.match(worker, /kept\.unsoldBackToShop = existing\.unsoldBackToShop;/, 'the export screen saving its own copy keeps the choice');
assert.match(worker, /\{ auction, starts: Object\.keys\(starts\)\.length \? starts : null \}/);
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8'), html = fs.readFileSync('dashboard.html', 'utf8');
for (const fn of ['openWhatnotShowPrep', 'suggestWhatnotLineup', 'lineUpWhatnotShow', 'openWhatnotShowWrap', 'printWhatnotWrapPackList', 'copyWhatnotThanks', 'whatnotWrapBackToShop', 'saveWhatnotUnsoldSetting']) assert.ok(app.includes('function ' + fn + '('), fn);
assert.ok(html.includes('onclick="openWhatnotShowPrep()"') && html.includes('onclick="openWhatnotShowWrap()"'));
assert.ok(app.includes("import('./whatnot-show-prep.mjs?v='"), 'the dashboard loads the prep module next to itself');
console.log('Whatnot show prep, starting bids, running order, per-item auctions, unsold back to shop and wrap-up checks passed');
