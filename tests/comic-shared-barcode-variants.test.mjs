import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store question: "What about same bar code for variants?" A comic's full
// 17-digit barcode normally names one cover, but some publishers print the
// same barcode on two -- the store's own catalog has
// SPIDER-MAN: LONG WAY HOME #4 CHRIS ALLEN 1:25 VARIANT and the open-order
// CHRIS ALLEN VARIANT on 75960621579900416. A barcode hit has to agree on the
// ratio, and a barcode two covers share isn't used at all.

// ── Worker ──
{
  const UPC = '75960621579900416';
  const ratioProduct = { id:'7125', 'product-name':'Spider-Man: Long Way Home #4 [Allen 1:25]', 'console-name':'Comic Books Spider-Man: Long Way Home', upc:UPC, 'loose-price':4500 };
  const openProduct = { id:'7100', 'product-name':'Spider-Man: Long Way Home #4 [Allen]', 'console-name':'Comic Books Spider-Man: Long Way Home', upc:'', 'loose-price':500 };
  const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
  globalThis.caches = { default: { match: async () => null, put: async () => {} } };
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const reply = body => new Response(JSON.stringify(body), { headers:{ 'Content-Type':'application/json' } });
    if (url.hostname.endsWith('pricecharting.com') && url.pathname === '/api/product') {
      return reply(url.searchParams.get('upc') === UPC ? { status:'success', ...ratioProduct } : { status:'error', 'error-message':'No such product' });
    }
    if (url.hostname.endsWith('pricecharting.com') && url.pathname === '/api/products') {
      return reply({ status:'success', products:[ratioProduct, openProduct] });
    }
    return reply({});
  };
  try {
    const { default: api } = await import('../cloudflare-worker-full.js');
    const env = { PRICECHARTING_TOKEN:'test-only' };
    const post = async body => (await api.fetch(new Request('https://worker.test/pricing/pricecharting/comics/by-upc', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body) }), env, { waitUntil(){} })).json();

    const data = await post({ items:[
      { key:'open', upc:UPC, series:'Spider-Man: Long Way Home', issue:'4', cover:'CHRIS ALLEN VARIANT' },
      { key:'ratio', upc:UPC, series:'Spider-Man: Long Way Home', issue:'4', cover:'CHRIS ALLEN 1:25 VARIANT' },
      { key:'idw', upc:UPC, series:'Spider-Man: Long Way Home', issue:'4', cover:'Variant RI (25) (Allen)' },
    ] });
    assert.equal(data.products.ratio.ok, true);
    assert.equal(data.products.ratio.via, 'barcode', 'the 1:25 book takes the 1:25 product its barcode points at');
    assert.equal(data.products.ratio.product.productId, '7125');
    assert.equal(data.products.idw.product.productId, '7125', 'IDW\'s "RI (25)" is a 1:25 too');
    assert.equal(data.products.open.ok, true);
    assert.equal(data.products.open.via, 'title', 'the open-order book is not given the 1:25 cover its barcode points at');
    assert.equal(data.products.open.product.productId, '7100', 'its own cover is found by title instead');

    // Old dashboards send barcodes only, with no cover to check against.
    const legacy = await post({ upcs:[UPC] });
    assert.equal(legacy.products[UPC].product.productId, '7125');
  } finally {
    globalThis.fetch = originalFetch; globalThis.caches = originalCaches;
  }

  // Title match: the ratio has to agree either way.
  const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
  assert.match(worker, /const nameRatio = name\.match\(\/\\b1\\s\*:\\s\*\(\\d\{1,4\}\)\\b\/\)\?\.\[1\] \|\| '';\n\s*if \(nameRatio !== cover\.ratio\) return \{ product, score: 0, plain: false \};/);
  console.log('Worker shared-barcode guard checks passed');
}

// ── Dashboard: barcodes two covers share go by title only ──
{
  const dashboard = fs.readFileSync('dashboard.html', 'utf8');
  const extractFn = (name, prefix = 'function ') => { const s = dashboard.indexOf(prefix + name + '('); assert.ok(s >= 0, name); return dashboard.slice(s, dashboard.indexOf('\n}\n', s) + 2); };
  const load = (items, catalog) => new Function('all', 'getSupabaseClient', 'getActiveStoreId', [
    extractFn('qplCategoryKey'), extractFn('comicInventoryFullUpc'),
    dashboard.match(/const comicCoverNameKey = [^\n]+\n/)[0],
    extractFn('comicBarcodesSharedByCovers'), extractFn('comicSharedBarcodes', 'async function '),
    'return { comicBarcodesSharedByCovers, comicSharedBarcodes };',
  ].join('\n'))(items, () => catalog ? { from:() => { const q = { select:() => q, eq:() => q, in:async (k, list) => ({ data:catalog.filter(r => list.includes(r.upc)), error:null }) }; return q; } } : null, () => 'store-1');

  const { comicBarcodesSharedByCovers } = load([], null);
  assert.deepEqual([...comicBarcodesSharedByCovers([
    { upc:'11111111111100111', name:'Book #1 Cover A' }, { upc:'11111111111100111', name:'BOOK #1 COVER A' },
    { upc:'22222222222200121', name:'Book #2 Allen 1:25' }, { upc:'22222222222200121', name:'Book #2 Allen' },
    { upc:'123', name:'x' }, { upc:'123', name:'y' },
  ])], ['22222222222200121'], 'two copies of the same cover are not a shared barcode; two covers are');

  // Shared in the FOC catalog, though the store only has one of the covers.
  const one = { id:'a', category:'Comic', name:'SPIDER-MAN: LONG WAY HOME #4 CHRIS ALLEN VARIANT -- CHRIS ALLEN VARIANT', upc:'75960621579900416' };
  const other = { id:'b', category:'Comic', name:'MIDNIGHT X-MEN #1 COVER A', upc:'75960621668000111' };
  const catalog = [
    { upc:'75960621579900416', title:'SPIDER-MAN: LONG WAY HOME #4 CHRIS ALLEN 1:25 VARIANT', variant_label:'CHRIS ALLEN 1:25 VARIANT' },
    { upc:'75960621579900416', title:'SPIDER-MAN: LONG WAY HOME #4 CHRIS ALLEN VARIANT', variant_label:'CHRIS ALLEN VARIANT' },
    { upc:'75960621668000111', title:'MIDNIGHT X-MEN #1 COVER A', variant_label:'Cover A' },
    { upc:'75960621668000111', title:'MIDNIGHT X-MEN #1 COVER A', variant_label:'Cover A' },
  ];
  const shared = await load([one, other], catalog).comicSharedBarcodes([one.upc, other.upc]);
  assert.deepEqual([...shared], ['75960621579900416'], 'the catalog\'s two covers flag it; a cover listed in two FOC cycles does not');
  const noDb = await load([one, other], null).comicSharedBarcodes([one.upc, other.upc]);
  assert.equal(noDb.size, 0, 'without the catalog it only knows what\'s in inventory');

  const build = extractFn('buildLiveComicPriceSyncProposal', 'async function ');
  assert.match(build, /const sharedUpcs=await comicSharedBarcodes\(byUpc\.map\(comicInventoryFullUpc\)\);/);
  assert.match(build, /const lookupUpc=item=>sharedUpcs\.has\(comicInventoryFullUpc\(item\)\)\?'':comicInventoryFullUpc\(item\);/);
  assert.match(build, /items:batch\.map\(item=>\(\{key:lookupKey\(item\),upc:lookupUpc\(item\),/, 'a shared barcode is sent as title only');
  assert.match(build, /is printed on more than one cover, so it was matched by title only/);
  console.log('Dashboard shared-barcode checks passed');
}
