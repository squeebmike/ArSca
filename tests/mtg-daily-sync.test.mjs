import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isMtgSyncItem, mtgMarketFrom, planMtgRow, nextMtgBatch, runMtgServerSync, finishOf } from '../scripts/mtg-daily-sync.mjs';

// Store, 2026-11-03: Magic prices updated only when a dashboard was open
// (last 10/28). Now a daily server run, from TCGplayer's own market price.
const PP = [{ printingType: 'Normal', marketPrice: 10.5 }, { printingType: 'Foil', marketPrice: 160.0 }];
const row = (id, d, status = 'in_stock') => ({ id, status, data: { category: 'Magic: The Gathering', tcgPlayerId: '563085', ...d } });

assert.equal(isMtgSyncItem(row('a', { selectedCondition: 'NM', finish: 'foil', price: 151.46 })), true);
assert.equal(isMtgSyncItem(row('b', { selectedCondition: 'Factory Sealed', finish: 'sealed' })), true, 'sealed product');
assert.equal(isMtgSyncItem(row('c', { selectedCondition: 'LP' })), false, 'played copies stay on the dashboard sync (JustTCG conditions)');
assert.equal(isMtgSyncItem(row('d', { tcgPlayerId: '' })), false, 'needs its TCGplayer product');
assert.equal(isMtgSyncItem(row('e', {}, 'sold')), false);
assert.equal(isMtgSyncItem({ id: 'f', status: 'in_stock', data: { category: 'Pokemon', tcgPlayerId: '1' } }), false);
assert.equal(isMtgSyncItem(row('g', { grader: 'PSA', grade: '10' })), false, 'slabs');
assert.equal(finishOf({ finish: 'foil' }), 'foil'); assert.equal(finishOf({ finish: 'Non-Foil' }), 'normal'); assert.equal(finishOf({ finish: 'sealed' }), 'normal');
assert.equal(mtgMarketFrom(PP, { finish: 'foil' }), 160);
assert.equal(mtgMarketFrom(PP, { finish: 'normal' }), 10.5);
assert.equal(mtgMarketFrom([{ printingType: 'Normal', marketPrice: 57.611 }], { finish: 'sealed' }), 57.61);
assert.equal(mtgMarketFrom([], {}), 0);

const now = Date.parse('2026-11-04T12:00:00Z'); // 4 AM Pacific
// Under 10%: applied (and the store's price rule is kept).
let p = planMtgRow(row('a', { finish: 'foil', marketPrice: 151.46, price: 151.46, priceRule: { pct: 0 } }), PP, now);
assert.equal(p.kind, 'applied'); assert.equal(p.data.price, 160); assert.equal(p.data.marketPrice, 160); assert.equal(p.data.listPrice, 160);
// 10% or more: waits in PRICE SYNC.
p = planMtgRow(row('a', { finish: 'foil', marketPrice: 100 }), PP, now);
assert.equal(p.kind, 'review'); assert.equal(p.proposal.newPrice, 160); assert.equal(p.data.marketPrice, 100, 'price unchanged until approved');
// A locked price (priceOverride) keeps its list price.
p = planMtgRow(row('a', { finish: 'normal', marketPrice: 10, priceOverride: 25 }), PP, now);
assert.equal(p.kind, 'applied'); assert.equal(p.data.listPrice, undefined);
assert.equal(planMtgRow(row('a', {}), null, now).kind, 'no-price');

// The run: before 3 AM nothing; after, a batch, once a day.
const rows = [row('a', { finish: 'foil', marketPrice: 151.46 }), row('b', { finish: 'sealed', selectedCondition: 'Factory Sealed', marketPrice: 5 }), row('c', { selectedCondition: 'LP', marketPrice: 3 })];
const patched = [], kv = {}, paths = [];
const deps = {
  db: async (path, o) => { paths.push(path); if (o?.method === 'PATCH') { const id = path.match(/id=eq\.([^&]+)/)[1]; const r = rows.find(x => x.id === id); r.data = JSON.parse(o.body).data; patched.push(id); return { data: [] }; } return { data: rows }; },
  pricepoints: async id => PP,
  kvGet: async k => kv[k] || null, kvPut: async (k, v) => { kv[k] = v; },
};
assert.deepEqual(await runMtgServerSync('st', deps, Date.parse('2026-11-04T09:00:00Z')), { skipped: 'before 3 AM' });
const out = await runMtgServerSync('st', deps, now);
assert.match(paths[0], /or=\(data->>category\.ilike\.magic\*,data->>category\.ilike\.mtg\*\)/, 'reads only Magic rows (egress)');
assert.deepEqual(patched, ['a', 'b']);
assert.equal(out.applied, 1); assert.equal(out.review, 1);
assert.equal(kv['price-sync-review:st'][0].itemId, 'b');
assert.equal(nextMtgBatch(rows, now).length, 0, 'checked today: not again until tomorrow');

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.match(worker, /await Promise\.allSettled\(\[runScheduledPokemonServerSync\(env\)\]\); await Promise\.allSettled\(\[runScheduledMtgServerSync\(env\)\]\);/);
assert.match(worker, /mpapi\.tcgplayer\.com\/v2\/product\/\$\{encodeURIComponent\(productId\)\}\/pricepoints/);
assert.match(fs.readFileSync('.github/workflows/deploy-worker.yml', 'utf8'), /scripts\/mtg-daily-sync\.mjs/);
console.log('MTG daily server sync: NM/sealed from TCGplayer market, 10% review rule, daily batches, wiring passed');
