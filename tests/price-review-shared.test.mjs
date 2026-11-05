// Store, 2026-11-05: "do 2" -- the 53 held-back price changes. The server's
// list was handed to whichever device asked first; now it stays on the
// server for every device, and each held-back change is kept on the item.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { markPriceReview } from '../scripts/pokemon-daily-sync.mjs';

const review = markPriceReview({ kind: 'review', data: { name: 'X' }, proposal: { oldPrice: 10, newPrice: 15, deltaPct: 50, direction: 'up', source: 'PriceCharting' } }, Date.parse('2026-11-05T11:00:00Z'));
assert.deepEqual(review.data.priceReview, { oldPrice: 10, newPrice: 15, deltaPct: 50, direction: 'up', source: 'PriceCharting', at: '2026-11-05T11:00:00.000Z' });
assert.equal('priceReview' in markPriceReview({ kind: 'applied', data: { priceReview: { newPrice: 1 } } }).data, false, 'a settled price clears it');
assert.equal('priceReview' in markPriceReview({ kind: 'unchanged', data: { priceReview: { newPrice: 1 } } }).data, false);
assert.deepEqual(markPriceReview({ kind: 'no-price', data: { priceReview: { newPrice: 1 } } }).data.priceReview, { newPrice: 1 }, 'no answer today: kept');
for (const f of ['pokemon-daily-sync', 'pricecharting-daily-sync', 'mtg-daily-sync']) assert.match(fs.readFileSync(`scripts/${f}.mjs`, 'utf8'), /markPriceReview\(plan(?:Mtg)?Row\(/, f);
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const route = worker.slice(worker.indexOf("url.pathname === '/price-sync/review'"), worker.indexOf("url.pathname === '/price-sync/review'") + 700);
assert.doesNotMatch(route, /LBA_KV\.delete/, 'kept for every device');
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
assert.match(app, /if\(!item \|\| !\(Number\(p\.newPrice\) > 0\) \|\| seen\[seenKey\(p\)\]\) return null;/, 'each device takes a change once');
console.log('price review: kept on the server and on the item, once per device');
