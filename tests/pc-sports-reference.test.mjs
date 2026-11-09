import assert from 'node:assert/strict';
import { pickPcProduct, pcSportsReference } from '../scripts/pc-sports-reference.mjs';
import { sportsReferenceImage } from '../scripts/sports-reference-images.mjs';
import { sportsReferenceRows, normalizeSportsCardNumber } from '../scripts/sports-card-finder.mjs';
// Store, 2026-11-09: the BLA-JR (2024 Topps Big League Autographs) page had
// no photo and no price; SportsCardsPro has both, in its separate
// "... Autograph" list. PriceCharting's API search finds it.
const row = sportsReferenceRows().find(r => normalizeSportsCardNumber(r.card.cardNumber) === 'bla-jr' && r.set.year === 2024);
const { set, card } = row;
const products = [
  { id: 101, 'product-name': 'Julio Rodriguez [Gold] #BLA-JR', 'console-name': 'Baseball Cards 2024 Topps Big League Baseball Autograph', 'loose-price': 15000 },
  { id: 102, 'product-name': 'Julio Rodriguez #BLA-JR', 'console-name': 'Baseball Cards 2024 Topps Big League Baseball Autograph', 'loose-price': 5350, 'graded-price': 7000, 'manual-only-price': 0 },
  { id: 103, 'product-name': 'Julio Rodriguez #BLA-JR', 'console-name': 'Baseball Cards 2023 Topps Big League Baseball Autograph', 'loose-price': 4000 },
  { id: 104, 'product-name': 'Jose Ramirez #BLA-JR', 'console-name': 'Baseball Cards 2024 Topps Big League Baseball Autograph', 'loose-price': 900 },
];
assert.equal(pickPcProduct(products, set, card)?.id, 102, 'number + player + year + sport, never the [Gold] parallel');
assert.equal(pickPcProduct(products.filter(p => p.id !== 102), set, card), null, 'no plain card: nothing');
assert.equal(pickPcProduct([...products, { ...products[1], id: 999 }], set, card), null, 'two different exact products is not exact');
assert.equal(pickPcProduct([{ id: 1, 'product-name': 'Julio Rodriguez #BLA-JR', 'console-name': 'Football Cards 2024 Topps' }], set, card), null, 'wrong sport');

// The lookup: search, then the one product for its photo and prices; cached.
const calls = [], store = new Map();
const kv = { get: async (k, t) => (store.has(k) ? JSON.parse(store.get(k)) : null), put: async (k, v) => store.set(k, v) };
const fetchPc = async (path, params) => { calls.push([path, params]); return path === '/api/products' ? { products } : { ...products[1], 'image-url': '//storage.googleapis.com/images.pricecharting.com/abc/240.jpg' }; };
const now = Date.parse('2026-11-09T06:00:00Z');
const ref = await pcSportsReference(set, card, { kv, fetchPc, now });
assert.deepEqual(ref, {
  productId: '102', title: 'Julio Rodriguez #BLA-JR', image: 'https://storage.googleapis.com/images.pricecharting.com/abc/240.jpg',
  url: 'https://www.sportscardspro.com/game/baseball-cards-2024-topps-big-league-baseball-autograph/julio-rodriguez-bla-jr',
  referencePrices: { ungraded: 53.5, grade9: 70, currency: 'USD', capturedAt: '2026-11-09T06:00:00.000Z' }, source: 'PriceCharting / SportsCardsPro', referenceOnly: true,
});
assert.match(calls[0][1].q, /^Julio Rodríguez #BLA-JR 2024 Topps Big League$/);
await pcSportsReference(set, card, { kv, fetchPc, now });
assert.equal(calls.length, 2, 'second view is cached: no more API calls');
// A miss is cached too (a day), so a card PriceCharting lacks isn't searched on every view.
const missCalls = [];
assert.equal(await pcSportsReference(set, { ...card, id: 'other' }, { kv, fetchPc: async p => (missCalls.push(p), { products: [] }) }), null);
assert.equal(await pcSportsReference(set, { ...card, id: 'other' }, { kv, fetchPc: async p => (missCalls.push(p), { products: [] }) }), null);
assert.equal(missCalls.length, 1);

// In the card page's photo request: used when nothing stored matches; never for stored-only reads.
const env = { LBA_KV: kv };
const viaPage = await sportsReferenceImage(env, null, set, { ...card, id: 'page' }, { fetchPc });
assert.equal(viaPage?.productId, '102');
assert.equal(await sportsReferenceImage(env, null, set, { ...card, id: 'stored-only' }, { fetchPc, archiveOnly: true }), null);
console.log('Sports card photo + PriceCharting price from the PriceCharting API passed');
