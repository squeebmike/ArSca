import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store ask: "How can we sync up prices for FOC comics we put in inventory?
// Ie. ratio where the prices have gone up." The comic sync only priced books
// with a saved PriceCharting link, and no book received from FOC ever had
// one. They all carry their full 17-digit barcode (UPC + issue/cover
// supplement), which names one exact cover -- so an unlinked book is looked
// up by that barcode, and only an exact-barcode product counts.

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Worker: /pricing/pricecharting/comics/by-upc ──
{
  const pcCalls = [];
  const catalog = {
    // Ratio variant: PriceCharting saves the full barcode.
    '76194137854200121': { id:'9001', 'product-name':'Absolute Batman #1 [Jock 1:25]', 'console-name':'Comic Books Absolute Batman', upc:'76194137854200121', 'loose-price':6500 },
    // Only the 12-digit series UPC matches a different cover -> never used.
    '761941378542': { id:'9000', 'product-name':'Absolute Batman #1', 'console-name':'Comic Books Absolute Batman', upc:'76194137854200111', 'loose-price':900 },
    // Same barcode, but not a comic.
    '11111111111100111': { id:'5', 'product-name':'Some Game', 'console-name':'Nintendo Switch', upc:'11111111111100111', 'loose-price':100 },
  };
  const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
  globalThis.caches = { default: { match: async () => null, put: async () => {} } };
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname.endsWith('pricecharting.com') && url.pathname === '/api/product') {
      const upc = url.searchParams.get('upc');
      pcCalls.push(upc);
      const p = catalog[upc];
      return new Response(JSON.stringify(p ? { status:'success', ...p } : { status:'error', 'error-message':'No such product' }), { headers:{ 'Content-Type':'application/json' } });
    }
    return new Response('{}', { headers:{ 'Content-Type':'application/json' } });
  };
  try {
    const { default: api } = await import('../cloudflare-worker-full.js');
    const env = { PRICECHARTING_TOKEN:'test-only' };
    const post = body => api.fetch(new Request('https://worker.test/pricing/pricecharting/comics/by-upc', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body) }), env, { waitUntil(){} });

    const res = await post({ upcs:['76194137854200121', '76194137854200131', '11111111111100111', '123'] });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.deepEqual(Object.keys(data.products).sort(), ['11111111111100111', '76194137854200121', '76194137854200131'],
      'only full 17-digit comic barcodes are looked up');
    assert.equal(data.products['76194137854200121'].ok, true);
    assert.equal(data.products['76194137854200121'].product.productId, '9001', 'the exact ratio cover is found by its full barcode');
    assert.equal(data.products['76194137854200121'].product.comicPrices.ungraded, 65);
    assert.equal(data.products['76194137854200131'].ok, false,
      'a series UPC that lands on a different cover is never taken as this book');
    assert.equal(data.products['11111111111100111'].ok, false, 'a non-comic product is never taken');
    assert.ok(pcCalls.includes('76194137854200121') && pcCalls.includes('761941378542'), 'tries the full barcode, then the 12-digit UPC');

    const bad = await post({ upcs:['123'] });
    assert.equal(bad.status, 400);
  } finally {
    globalThis.fetch = originalFetch; globalThis.caches = originalCaches;
  }
  console.log('Worker comic barcode lookup checks passed');
}

// ── Dashboard: comic sync links unlinked books by barcode ──
function extractFn(name, prefix = 'function ') {
  const start = dashboard.indexOf(prefix + name + '(');
  assert.ok(start >= 0, name + ' must exist in dashboard.html');
  const end = dashboard.indexOf('\n}', start) + 2;
  return dashboard.slice(start, end);
}

function loadSync({ items, upcProducts = {}, batchProducts = {} }) {
  const calls = { upc:[], batch:[], saves:[] };
  const storeWorkerFetch = async (path, init) => {
    const body = JSON.parse(init.body);
    if(path === '/pricing/pricecharting/comics/by-upc'){
      calls.upc.push(body.upcs);
      const products = {};
      body.upcs.forEach(u => { products[u] = upcProducts[u] || { ok:false, error:'none' }; });
      (body.items || []).forEach(item => { if(upcProducts[item.key]) products[item.key] = upcProducts[item.key]; });
      calls.items = (calls.items || []).concat(body.items || []);
      return { ok:true, json:async () => ({ ok:true, products }) };
    }
    if(path === '/pricing/pricecharting/products/batch'){
      calls.batch.push(body.ids);
      const products = {};
      body.ids.forEach(id => { products[id] = batchProducts[id] || { ok:false, error:'none' }; });
      return { ok:true, json:async () => ({ ok:true, products }) };
    }
    throw new Error('unexpected ' + path);
  };
  const src = [
    'let _priceSyncLastSummary = null;',
    dashboard.match(/const COMIC_PRICE_SYNC_BATCH_SIZE = [^\n]+\n/)[0],
    dashboard.match(/const COMIC_UPC_LOOKUP_BATCH_SIZE = [^\n]+\n/)[0],
    extractFn('qplCategoryKey'),
    extractFn('comicInventoryPricechartingId'),
    extractFn('comicInventoryPriceSyncItems'),
    extractFn('comicInventoryFullUpc'),
    extractFn('comicInventoryTitleHint'),
    extractFn('comicSyncedGuidePrice'),
    extractFn('buildLiveComicPriceSyncProposal', 'async function '),
    'return { build: buildLiveComicPriceSyncProposal, items: comicInventoryPriceSyncItems, summary: () => _priceSyncLastSummary };',
  ].join('\n');
  const api = new Function('safeLocalJson', 'getInventoryEditOverrides', 'all', 'inventoryReferenceMarketPrice', 'isBigPriceChange', 'storeWorkerFetch', 'saveInventoryEdit', src)(
    () => [], () => ({}), items, i => Number(i.market || 0), (a, b) => Math.abs(b - a) >= 10, storeWorkerFetch,
    async (item, patch) => { calls.saves.push({ id:item.id, patch }); },
  );
  return { ...api, calls };
}

const comicProduct = (id, ungraded, name = 'Book') => ({ ok:true, product:{ productId:id, productName:name, consoleName:'Comic Books Series', url:'https://www.pricecharting.com/game/comic-books-series/' + id, comicPrices:{ ungraded }, prices:{}, demand:{} } });

{
  const ratio = { id:'r1', category:'Comic', source:'foc_receive', status:'in_stock', name:'ABSOLUTE BATMAN #1 CVR C 1:25 JOCK', upc:'76194137854200121', market:15 };
  const coverA = { id:'r2', category:'Comic', source:'foc_receive', status:'in_stock', name:'ABSOLUTE BATMAN #1 CVR A', upc:'76194137854200111', market:4.99 };
  const notYet = { id:'r3', category:'Comic', source:'foc_receive', status:'in_stock', name:'NEW BOOK #1', upc:'76194137854299911', market:4.99 };
  const linked = { id:'r4', category:'Comic', pricechartingProductId:'42', market:10 };
  const presale = { id:'p1', category:'Comic', source:'foc_presale', status:'presale', upc:'76194137854200121', market:4.99 };
  const presaleBundle = { id:'p2', category:'Comic', source:'foc_presale_bundle', market:20 };
  const { build, items, summary, calls } = loadSync({
    items:[ratio, coverA, notYet, linked, presale, presaleBundle],
    upcProducts:{ '76194137854200121':comicProduct('9001', 65, 'Absolute Batman #1 [Jock 1:25]'), '76194137854200111':comicProduct('9000', 4.99) },
    batchProducts:{ '42':comicProduct('42', 12) },
  });

  assert.deepEqual(items().map(i => i.id).sort(), ['r1', 'r2', 'r3', 'r4'], 'FOC presale placeholders are not priced until received');

  const proposal = await build({});
  const byId = Object.fromEntries(proposal.map(p => [p.item.id, p]));
  assert.equal(byId.r1.newPrice, 65, 'the ratio variant picks up its real guide value');
  assert.equal(byId.r1.matchStatus, 'exact barcode match');
  assert.equal(byId.r1.pricechartingProductId, '9001', 'applying the change saves the link for next time');
  assert.equal(byId.r4.newPrice, 12, 'already-linked books still sync as before');
  assert.ok(!byId.r2, 'an unchanged price is not proposed');
  assert.deepEqual(calls.saves, [{ id:'r2', patch:{ pricechartingProductId:'9000', pricechartingProductName:'Book', providerUrl:'https://www.pricecharting.com/game/comic-books-series/9000' } }],
    'an unchanged barcode match still keeps its link');
  assert.deepEqual(calls.batch, [['42']], 'barcode matches are not fetched a second time');
  const s = summary();
  assert.equal(s.checked, 4);
  assert.equal(s.processed, 4);
  const missing = s.issues.find(i => i.item.id === 'r3');
  assert.equal(missing.title, 'Not on PriceCharting yet');
}

// ── Worker: title fallback when PriceCharting hasn't saved the barcode ──
// Store report: every FOC book came back "Not on PriceCharting yet" even
// though the covers were listed -- PriceCharting just hadn't stored their
// full barcode. A title match is only taken when series + issue + cover
// single out one product.
{
  const searchCalls = [];
  const products = [
    { id:'700', 'product-name':'Teenage Mutant Ninja Turtles: The Hunger #1', 'console-name':'Comic Books Teenage Mutant Ninja Turtles: The Hunger', 'loose-price':600 },
    { id:'701', 'product-name':'Teenage Mutant Ninja Turtles: The Hunger #1 [Madan]', 'console-name':'Comic Books Teenage Mutant Ninja Turtles: The Hunger', 'loose-price':1200 },
    { id:'702', 'product-name':'Teenage Mutant Ninja Turtles: The Hunger #1 [Eastman 1:25]', 'console-name':'Comic Books Teenage Mutant Ninja Turtles: The Hunger', 'loose-price':4000 },
    { id:'703', 'product-name':'Teenage Mutant Ninja Turtles: The Hunger #1 [Eastman 1:50]', 'console-name':'Comic Books Teenage Mutant Ninja Turtles: The Hunger', 'loose-price':8000 },
    { id:'800', 'product-name':'Teenage Mutant Ninja Turtles: The Hunger Games #1 [Madan]', 'console-name':'Comic Books Hunger Games', 'loose-price':99900 },
  ];
  const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
  globalThis.caches = { default: { match: async () => null, put: async () => {} } };
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname.endsWith('pricecharting.com') && url.pathname === '/api/product') {
      return new Response(JSON.stringify({ status:'error', 'error-message':'No such product' }), { headers:{ 'Content-Type':'application/json' } });
    }
    if (url.hostname.endsWith('pricecharting.com') && url.pathname === '/api/products') {
      searchCalls.push(url.searchParams.get('q'));
      return new Response(JSON.stringify({ status:'success', products }), { headers:{ 'Content-Type':'application/json' } });
    }
    return new Response('{}', { headers:{ 'Content-Type':'application/json' } });
  };
  try {
    const { default: api } = await import('../cloudflare-worker-full.js');
    const env = { PRICECHARTING_TOKEN:'test-only' };
    const res = await api.fetch(new Request('https://worker.test/pricing/pricecharting/comics/by-upc', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ items:[
      { key:'a', upc:'82771403593300111', series:'Teenage Mutant Ninja Turtles: The Hunger', issue:'1', cover:'Cover A (Smith)' },
      { key:'b', upc:'82771403593300121', series:'Teenage Mutant Ninja Turtles: The Hunger', issue:'1', cover:'Variant B (Madan) Variant Title' },
      { key:'c', upc:'', series:'Teenage Mutant Ninja Turtles: The Hunger', issue:'1', cover:'Cover C 1:25 Eastman' },
      { key:'d', upc:'', series:'Teenage Mutant Ninja Turtles: The Hunger', issue:'1', cover:'Cover E Eastman' },
    ] }) }), env, { waitUntil(){} });
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.products.a.product.productId, '700', 'Cover A is the plain issue');
    assert.equal(data.products.a.via, 'title');
    assert.equal(data.products.b.product.productId, '701', 'the artist names the variant cover');
    assert.equal(data.products.c.product.productId, '702', 'the ratio picks between same-artist covers');
    assert.equal(data.products.d.ok, false, 'two equally good covers are never guessed between');
    assert.match(data.products.d.error, /no single cover matched/);
    assert.equal(new Set(searchCalls).size, searchCalls.length, 'each title search is only paid for once per batch');
  } finally {
    globalThis.fetch = originalFetch; globalThis.caches = originalCaches;
  }
  console.log('Worker comic title fallback checks passed');
}

// ── Dashboard: FOC books send their series/issue/cover hint ──
{
  const hint = new Function(extractFn('comicInventoryTitleHint') + '\nreturn comicInventoryTitleHint;')();
  assert.deepEqual(hint({ name:'Teenage Mutant Ninja Turtles: The Hunger Variant B (Madan) -- Variant Title', series:'Teenage Mutant Ninja Turtles: The Hunger', issue:'' }),
    { series:'Teenage Mutant Ninja Turtles: The Hunger', issue:'1', cover:'Variant B (Madan) Variant Title' });
  assert.deepEqual(hint({ name:'MIDNIGHT FANTASTIC FOUR #1 COVER F CLAYTON CRAIN 3-PART CONNECTING VARIANT', series:'Midnight Fantastic Four' }),
    { series:'Midnight Fantastic Four', issue:'1', cover:'COVER F CLAYTON CRAIN 3-PART CONNECTING VARIANT' });
  assert.equal(hint({ name:'Loose book' }), null, 'no series, no title lookup');

  const book = { id:'t1', category:'Comic', source:'foc_receive', status:'in_stock', name:'Teenage Mutant Ninja Turtles: The Hunger Variant B (Madan)', series:'Teenage Mutant Ninja Turtles: The Hunger', upc:'82771403593300121', market:4.99 };
  const { build, calls } = loadSync({ items:[book], upcProducts:{ t1:{ ...comicProduct('701', 12, 'Teenage Mutant Ninja Turtles: The Hunger #1 [Madan]'), via:'title' } } });
  const proposal = await build({});
  assert.deepEqual(calls.items[0], { key:'t1', upc:'82771403593300121', series:'Teenage Mutant Ninja Turtles: The Hunger', issue:'1', cover:'Variant B (Madan)' });
  assert.equal(proposal[0].newPrice, 12);
  assert.match(proposal[0].matchStatus, /title match: .*\[Madan\]/, 'a title match is labelled so the dealer can check the cover');
  assert.deepEqual(calls.saves, [], 'a title match is never saved without review');
}

console.log('Comic price sync links FOC books by barcode checks passed');
