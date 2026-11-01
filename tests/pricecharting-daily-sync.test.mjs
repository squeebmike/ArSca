import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncKind, pricechartingIdOf, comicGuidePrice, sportsGuidePrice, pcGradeBucket, planRow, nextBatch, runPriceChartingServerSync, PC_SYNC_BATCH, comicCoverPrice, comicIsIncentive, comicHasAnyPrice } from '../scripts/pricecharting-daily-sync.mjs';

// Store, 2026-10-31: comics, sports and Magic hadn't updated since 10/28 --
// their daily update only ran when a dashboard was open after 3 AM. Comics
// and sports now update on the server, like Pokemon.
const row = (id, data, status = 'in_stock') => ({ id, status, data });
const comic = row('c1', { category:'Comic', name:'Absolute Batman #25', pricechartingProductId:'111', market:8, condition:'Near Mint' });
const sports = row('s1', { category:'Sports', name:'Cal Raleigh #49', providerUrl:'https://www.sportscardspro.com/game/222', market:10 });
const slab = row('s2', { category:'Baseball', name:'Ohtani PSA 10', grader:'PSA', grade:'10', pricechartingProductId:'333', market:100 });
const focBook = row('c2', { category:'Comic', name:'SPIDER-WOMAN #1 COVER F', upc:'75960621668000151', market:6 });
const presale = row('c3', { category:'Comic', source:'foc_presale', pricechartingProductId:'444', market:5 }, 'presale');
const pokemon = row('p1', { category:'Pokemon TCG', pricechartingProductId:'555' });
const unlinkedSports = row('s3', { category:'Sports', name:'No link', market:3 });

assert.equal(syncKind(comic), 'comic');
assert.equal(syncKind(sports), 'sports');
assert.equal(syncKind(slab), 'sports', 'a baseball card is a sports card');
assert.equal(syncKind(presale), '', 'presales sell at the preorder price');
assert.equal(syncKind(pokemon), '', 'Pokemon has its own server sync');
assert.equal(pricechartingIdOf('sports', sports.data), '222', 'the id in a saved SportsCardsPro link');
assert.equal(pcGradeBucket('PSA', '10'), 'psa10');
assert.equal(pcGradeBucket('BGS', '9.5'), 'grade9_5');

// Prices, same rules as the dashboard.
assert.deepEqual(comicGuidePrice({ condition:'Fine' }, { comicPrices:{ ungraded:20 } }).price, 15, 'Fine = 75% of the raw guide');
assert.equal(comicGuidePrice({ isSlabbed:true, grade:'9.7' }, { comicPrices:{ ungraded:20, grade9_4:40, grade9_8:60 } }).price, 60, 'nearest graded guide');
assert.equal(sportsGuidePrice(slab.data, { prices:{ ungraded:30, psa10:120 } }).price, 120);
assert.equal(sportsGuidePrice(sports.data, { prices:{ ungraded:10.5 } }).price, 10.5);

const comicProduct = (price, extra = {}) => ({ productId:'111', productName:'Absolute Batman #25', consoleName:'Comic Books Absolute Batman', comicPrices:{ ungraded:price }, url:'https://www.pricecharting.com/game/x/y', ...extra });
let plan = planRow(comic, 'comic', comicProduct(8.5));
assert.equal(plan.kind, 'applied', 'a 6% change is applied');
assert.equal(plan.data.market, 8.5);
assert.equal(plan.data.salePrice, 9, 'whole dollars, rounded up');
assert.ok(plan.data.priceSyncCheckedAt);
plan = planRow(comic, 'comic', comicProduct(12));
assert.equal(plan.kind, 'review', 'a 50% change waits for review');
assert.equal(plan.data.market, 8, 'and the price is left alone');
assert.equal(plan.proposal.mode, 'comic-live');
plan = planRow(comic, 'comic', comicProduct(8));
assert.equal(plan.kind, 'unchanged');
plan = planRow(focBook, 'comic', comicProduct(6.2), { viaTitle:true });
assert.equal(plan.kind, 'review', 'a title-only match is never applied without review');
assert.equal(plan.data.pricechartingProductId, undefined, 'nor linked');
plan = planRow(comic, 'comic', comicProduct(9, { consoleName:'Baseball Cards 2021' }));
assert.equal(plan.kind, 'no-price', 'a saved id that is not a comic prices nothing');
plan = planRow(row('c4', { ...comic.data, priceOverride:12 }), 'comic', comicProduct(8.5));
assert.equal(plan.data.salePrice, undefined, 'a typed-in price stays as typed');

// What gets checked: linked items and comics a barcode/title can find.
const batchIds = nextBatch([comic, sports, slab, focBook, presale, pokemon, unlinkedSports]).map(x => x.row.id).sort();
assert.deepEqual(batchIds, ['c1', 'c2', 's1', 's2']);
assert.deepEqual(nextBatch([row('c5', { ...comic.data, priceSyncCheckedAt:new Date().toISOString() })]), [], 'checked today: skipped');
assert.ok(PC_SYNC_BATCH >= 40);

// A run, end to end.
const patches = [], kv = new Map();
const deps = {
  db: async (path, opts) => { if (opts?.method === 'PATCH') { patches.push({ path, data:JSON.parse(opts.body).data }); return { data:null }; } return { data:[comic, sports, slab, focBook, unlinkedSports] }; },
  products: async ids => Object.fromEntries(ids.map(id => [id, { ok:true, product:{ productId:id, productName:'P' + id, consoleName:id === '111' ? 'Comic Books X' : 'Baseball Cards 2021', comicPrices:{ ungraded:8.4 }, prices:{ ungraded:10.2, psa10:150 } } }])),
  comicLookup: async items => Object.fromEntries(items.map(i => [i.key, { ok:true, via:'barcode', product:{ productId:'777', productName:'Spider-Woman #1 Cover F', consoleName:'Comic Books Spider-Woman', comicPrices:{ ungraded:6.1 } } }])),
  kvGet: async k => kv.get(k) || null, kvPut: async (k, v) => { kv.set(k, v); },
};
const at3am = new Date('2026-11-01T11:30:00Z').getTime(); // 4:30 AM Pacific
const out = await runPriceChartingServerSync('store-1', deps, at3am);
assert.equal(out.checked, 4);
assert.equal(out.applied, 3, 'comic 8 -> 8.4, sports 10 -> 10.2, the FOC book 6 -> 6.1');
assert.equal(out.review, 1, 'the slab 100 -> 150 waits');
const review = kv.get('price-sync-review:store-1');
assert.equal(review.length, 1);
assert.equal(review[0].mode, 'sports-live');
const foc = patches.find(p => p.path.includes('c2')).data;
assert.equal(foc.pricechartingProductId, '777', 'a barcode match is saved as the link');
assert.deepEqual(await runPriceChartingServerSync('store-1', deps, new Date('2026-11-01T09:00:00Z').getTime()), { skipped:'before 3 AM' });

// Wiring.
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.match(worker, /if \(event\?\.cron === POKEMON_SYNC_CRON\) \{ await Promise\.allSettled\(\[runScheduledPriceChartingServerSync\(env\)\]\); await Promise\.allSettled\(\[runScheduledPokemonServerSync\(env\)\]\); return; \}/, 'runs hourly, awaited, one sync after the other');
assert.match(worker, /if \(!\(storeEnv\.PRICECHARTING_TOKEN \|\| storeEnv\.PRICECHARTING_API_KEY\)\) continue;/, 'each store on its own key');
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
assert.match(app, /if\(p\.mode === 'comic-live'\) return \{ \.\.\.common, mode:'comic-live', provider:'comic'/, 'the dashboard reviews server comic changes like its own');
assert.match(app, /if\(typeof dailyPriceSyncRunning !== 'undefined' && dailyPriceSyncRunning\) items = items\.filter\(i => !serverPriceCheckedToday\(i\)\);/);
assert.match(app, /!\(typeof dailyPriceSyncRunning!=='undefined'&&dailyPriceSyncRunning&&serverPriceCheckedToday\(i\)\)/);
console.log('pricecharting daily sync checks passed');

// 2026-10-31: the first day checked nothing. The pick reads only comic and
// sports rows and only the keys it needs; the whole record is read for the
// batch; each group of 20 is saved before the next is looked up, and no new
// group starts after the time budget.
{
  const mk = n => ({ id: 'c' + n, status: 'in_stock', data: { category: 'Comic', name: 'Batman #' + n, pricechartingProductId: String(1000 + n), market: 5 } });
  const all = Array.from({ length: 50 }, (_, n) => mk(n));
  const gets = [], saved = [];
  const deps2 = {
    kvGet: async () => null, kvPut: async () => {},
    products: async ids => Object.fromEntries(ids.map(id => [id, { ok: true, product: { productId: id, prices: { loose: 5 } } }])),
    comicLookup: async () => ({}),
    budgetMs: 0,
    db: async (path, opts) => {
      if (opts?.method === 'PATCH') { saved.push(path); return { response: { ok: true } }; }
      gets.push(path);
      if (path.includes('select=id,status,k_')) return { data: all.map(r => ({ id: r.id, status: r.status, k_category: 'Comic', k_pricechartingProductId: r.data.pricechartingProductId, k_name: r.data.name })) };
      const ids = decodeURIComponent(path.match(/id=in\.\(([^)]*)\)/)[1]).split(',');
      return { data: all.filter(r => ids.includes(r.id)) };
    },
  };
  const res = await runPriceChartingServerSync('store-1', deps2, at3am);
  assert.match(gets[0], /data->>category=imatch\./, 'only comic and sports rows');
  assert.match(gets[0], /select=id,status,k_category:data->category,/, 'only the keys the pick needs');
  assert.doesNotMatch(gets[0], /select=id,status,data&/);
  assert.equal(res.candidates, 50);
  assert.equal(saved.length, 20, 'out of time after the first group: that group is saved, the rest wait');
  assert.equal(res.checked, 20); assert.equal(res.stoppedEarly, true);
  assert.equal(res.left, 30);
}
const workerSrc = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.match(workerSrc, /env\.LBA_KV\.put\('pricecharting-sync-last:' \+ storeId/, 'each run leaves its result');
assert.match(workerSrc, /job: 'pricecharting-sync', store_id: storeId/, 'also where it can be queried');
assert.match(workerSrc, /try \{\n      const storeEnv = await pricingEnvForStore\(env, storeId\);/, "one store's setup failing can't stop the others");
console.log('pricecharting daily sync chunked checks passed');
// Progress is reported at each step, so a run cut off shows how far it got.
{
  const stages = [];
  const mk = n => ({ id: 'p' + n, status: 'in_stock', data: { category: 'Comic', name: 'X #' + n, pricechartingProductId: String(50 + n), market: 5 } });
  const all2 = Array.from({ length: 25 }, (_, n) => mk(n));
  await runPriceChartingServerSync('store-1', {
    kvGet: async () => null, kvPut: async () => {}, comicLookup: async () => ({}),
    products: async ids => Object.fromEntries(ids.map(id => [id, { ok: true, product: { productId: id } }])),
    progress: async r => { stages.push(r.stage); },
    db: async (path, opts) => opts?.method === 'PATCH' ? { response: { ok: true } } : { data: path.includes('k_category') ? all2.map(r => ({ id: r.id, status: r.status, k_category: 'Comic', k_pricechartingProductId: r.data.pricechartingProductId })) : all2.filter(r => decodeURIComponent(path).includes(r.id)) },
  }, at3am);
  assert.deepEqual(stages, ['picked', 'loaded 25', 'looking up 1-20', 'saving 1-20', 'looking up 21-25', 'saving 21-25']);
  assert.match(workerSrc, /await writeRun\(\{ stage: 'started' \}\);/, 'a row as soon as the run starts');
}
// A passing PriceCharting failure leaves the item for the next run; a whole
// group failing stops the run; "no such product" is still a checked item.
{
  const mk = n => ({ id: 'q' + n, status: 'in_stock', data: { category: 'Comic', name: 'Q #' + n, pricechartingProductId: String(700 + n), market: 5 } });
  const all3 = Array.from({ length: 30 }, (_, n) => mk(n));
  const saved = [];
  let call = 0;
  const res = await runPriceChartingServerSync('store-1', {
    kvGet: async () => null, kvPut: async () => {}, comicLookup: async () => ({}),
    products: async ids => { call++; return Object.fromEntries(ids.map((id, i) => [id, call === 1 ? (i === 0 ? { ok: false, error: 'No such product' } : i < 5 ? { ok: true, product: { productId: id, comicPrices: { ungraded: 5 } } } : { ok: false, error: 'Price provider temporarily paused' }) : { ok: false, error: 'Price provider temporarily paused' }])); },
    db: async (path, opts) => { if (opts?.method === 'PATCH') { saved.push(path); return { response: { ok: true } }; } return { data: path.includes('k_category') ? all3.map(r => ({ id: r.id, status: r.status, k_category: 'Comic', k_pricechartingProductId: r.data.pricechartingProductId })) : all3.filter(r => decodeURIComponent(path).includes(r.id)) }; },
  }, at3am);
  assert.equal(saved.length, 5, 'the 4 priced and the 1 PriceCharting has no product for; the paused ones wait');
  assert.equal(res.lookupFailed, 25, '15 in the first group, all 10 of the second');
  assert.match(res.lookupError, /paused/);
  assert.equal(res.stoppedEarly, true, 'the second group got nothing at all: stop');
  assert.match(res.stopReason, /PriceCharting unavailable/);
}
console.log('pricecharting progress checks passed');


// Cover-price fallback (store, 2026-11-01): a comic PriceCharting has no
// price for yet, with no price of any kind, gets its cover price as its floor.
// Ratio variants never do -- they're listed as needing a price.
{
  const none = { category: 'Comic', name: 'NEW BOOK #1 CVR A', market: 0, salePrice: 0, minPrice: 0, priceOverride: 0 };
  assert.equal(comicHasAnyPrice(none), false);
  assert.equal(comicHasAnyPrice({ ...none, minPrice: 12 }), true, 'a floor the store set is a price');
  assert.equal(comicCoverPrice({ comicMetadata: { coverPrice: 3.99 } }), 3.99);
  assert.equal(comicCoverPrice({}, { msrp_cents: 499 }), 4.99, 'a received FOC book: its order line');
  for (const name of ['THUNDERCATS #1 CVR K INC 1:10 RATIO', 'Power Rangers Green #3 E 1:10 Ratio INCV', 'TMNT #23 Variant RI (10)']) assert.equal(comicIsIncentive({ name }), true, name);
  assert.equal(comicIsIncentive({ name: 'NEW BOOK #1 CVR A' }, { is_incentive: true }), true);
  assert.equal(comicIsIncentive({ name: 'Absolute Batman #25 CVR A' }), false);

  let p = planRow(row('n1', { ...none, comicMetadata: { coverPrice: 4.99 } }), 'comic', null);
  assert.equal(p.kind, 'cover');
  assert.equal(p.data.minPrice, 4.99);
  assert.equal(p.data.coverPriceFloor, true);
  assert.ok(p.data.priceSyncCheckedAt);
  assert.equal(planRow(row('n2', { ...none, name: 'X #1 CVR K INC 1:25 RATIO' }), 'comic', null, { sku: { msrp_cents: 499 } }).needsPrice, true, 'a ratio variant is not priced at cover');
  assert.equal(planRow(row('n3', { ...none, minPrice: 7, comicMetadata: { coverPrice: 3.99 } }), 'comic', null).kind, 'no-price', 'a book with a floor keeps it');
  assert.equal(planRow(row('n4', { ...none, market: 6, comicMetadata: { coverPrice: 3.99 } }), 'comic', null).kind, 'no-price', 'a book with a price keeps it');
  assert.equal(planRow(row('n5', none), 'comic', null).needsPrice, true, 'no cover price known: needs a price');
  assert.equal(planRow(row('n6', { ...none, comicMetadata: { coverPrice: 3.99 } }), 'comic', comicProduct(9)).kind, 'applied', 'a PriceCharting price still wins');
  assert.equal(planRow(row('s9', { category: 'Sports', name: 'Card', market: 0 }), 'sports', null).kind, 'no-price', 'comics only');

  // End to end: the FOC order line is read for books with no price.
  const books = [
    { id: 'f1', status: 'in_stock', data: { ...none, name: 'NEW BOOK #1 CVR A', focSkuId: '11111111-1111-1111-1111-111111111111' } },
    { id: 'f2', status: 'in_stock', data: { ...none, name: 'NEW BOOK #1 CVR K', focSkuId: '22222222-2222-2222-2222-222222222222' } },
  ];
  const saved = new Map(); let skuReads = 0;
  const res = await runPriceChartingServerSync('store-1', {
    kvGet: async () => null, kvPut: async () => {}, products: async () => ({}),
    comicLookup: async () => ({}),
    db: async (path, opts) => {
      if (opts?.method === 'PATCH') { saved.set(path.match(/id=eq\.([^&]+)/)[1], JSON.parse(opts.body).data); return { response: { ok: true } }; }
      if (path.startsWith('comic_skus')) { skuReads++; return { data: [{ id: '11111111-1111-1111-1111-111111111111', msrp_cents: 399, is_incentive: false }, { id: '22222222-2222-2222-2222-222222222222', msrp_cents: 499, is_incentive: true }] }; }
      return { data: path.includes('k_category') ? books.map(r => ({ id: r.id, status: r.status, k_category: 'Comic', k_name: r.data.name })) : books.filter(r => decodeURIComponent(path).includes(r.id)) };
    },
  }, at3am);
  assert.equal(skuReads, 1);
  assert.equal(res.coverPrice, 1);
  assert.equal(saved.get('f1').minPrice, 3.99);
  assert.equal(saved.get('f2').minPrice, 0, 'the incentive cover is left for the store to price');
  assert.equal(res.needsPrice, 1);
  assert.deepEqual(res.needsPriceItems, ['NEW BOOK #1 CVR K']);
}
console.log('pricecharting cover-price fallback checks passed');
