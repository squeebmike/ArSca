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
assert.equal(calls[0][1].q, 'julio rodriguez bla-jr 2024 topps big league', 'plain words: no accent, no #');
// No exact card in the first search: one more with just the player and number.
{
  const qs = [];
  const r2 = await pcSportsReference(set, { ...card, id: 'retry' }, { kv, now, fetchPc: async (path, params) => { if (path === '/api/products') { qs.push(params.q); return { products: qs.length === 1 ? [{ id: 9, 'product-name': 'Julio Rodriguez #111', 'console-name': 'Funko POP MLB' }] : products }; } return products[1]; } });
  assert.deepEqual(qs, ['julio rodriguez bla-jr 2024 topps big league', 'julio rodriguez bla-jr']);
  assert.equal(r2?.productId, '102');
}
// Crawlers: what's saved only, never a new lookup.
{
  let n = 0; const nb = {};
  assert.equal(await pcSportsReference(set, { ...card, id: 'bot' }, { kv, now, fetchPc: async () => (n++, { products }), note: nb, cachedOnly: true }), null);
  assert.deepEqual([n, nb.pc], [0, 'cached-only']);
}
await pcSportsReference(set, card, { kv, fetchPc, now });
assert.equal(calls.length, 2, 'second view is cached: no more API calls');
// A miss is cached too (a day), so a card PriceCharting lacks isn't searched on every view.
const missCalls = [];
assert.equal(await pcSportsReference(set, { ...card, id: 'other' }, { kv, fetchPc: async p => (missCalls.push(p), { products: [] }) }), null);
assert.equal(await pcSportsReference(set, { ...card, id: 'other' }, { kv, fetchPc: async p => (missCalls.push(p), { products: [] }) }), null);
assert.equal(missCalls.length, 2, "two searches the first time, then cached");

// In the card page's photo request: used when nothing stored matches; never for stored-only reads.
const env = { LBA_KV: kv };
const viaPage = await sportsReferenceImage(env, null, set, { ...card, id: 'page' }, { fetchPc });
assert.equal(viaPage?.productId, '102');
assert.equal(await sportsReferenceImage(env, null, set, { ...card, id: 'stored-only' }, { fetchPc, archiveOnly: true }), null);
// Shares PriceCharting with the store's price sync: a daily cap, and a 2-hour stop after a 429.
{
  const st = new Map(), k = { get: async key => (st.has(key) ? (/^pc-sports-ref-v3/.test(key) ? JSON.parse(st.get(key)) : st.get(key)) : null), put: async (key, v) => st.set(key, v) };
  const note = {};
  assert.equal(await pcSportsReference(set, { ...card, id: 'p1' }, { kv: k, fetchPc: async () => { throw new Error('PriceCharting 503 Price provider temporarily paused (PriceCharting HTTP 429)'); }, note }), null);
  assert.match(note.pc, /^error:.*429/);
  assert.equal(st.get('pc-sports-ref-paused'), '1');
  let calls = 0; const n2 = {};
  assert.equal(await pcSportsReference(set, { ...card, id: 'p2' }, { kv: k, fetchPc: async () => (calls++, { products }), note: n2 }), null);
  assert.deepEqual([calls, n2.pc], [0, 'paused'], 'no calls while paused');
  st.delete('pc-sports-ref-paused'); st.set('pc-sports-ref-calls:' + new Date().toISOString().slice(0, 10), '120'); const n3 = {};
  assert.equal(await pcSportsReference(set, { ...card, id: 'p3' }, { kv: k, fetchPc: async () => (calls++, { products }), note: n3 }), null);
  assert.deepEqual([calls, n3.pc], [0, 'daily-limit']);
}
console.log('Sports card photo + PriceCharting price from the PriceCharting API passed');
