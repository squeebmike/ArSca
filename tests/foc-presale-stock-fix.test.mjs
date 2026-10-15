import fs from 'node:fs';
import assert from 'node:assert/strict';
import { presaleStockCheck, comicDemandFacts, handleFocRequest, presaleEditPatch } from '../scripts/foc-preorders.mjs';
import { createRequire } from 'node:module';
const D = createRequire(import.meta.url)('../scripts/comic-demand.js');

// Store report: "why does it think I have Cyberpunk 2077 #1?" and "more
// books than I have and two rows?" Receiving a packing slip switched EVERY
// eBay presale in that FOC week to in stock (Cyberpunk #1, out Oct 21, showed
// 10 per cover), and covers that did arrive were counted twice -- the
// switched presale row plus the received row (Sonic x Godzilla #3 Cover A:
// 8 + 8 for 8 books). Receiving also missed live presales because its read
// stopped at 1,000 of the store's 1,700+ items.
const conv = (id, skuId, name, qty, extra = {}) => ({ id, status:'in_stock', data:{ source:'foc_presale', name, qty, focPresaleOriginalQty:qty, ebayPresaleConverted:true, ebayConvertedAt:'2026-10-11T02:43:00Z', focSkuId:skuId, ebayOfferId:'o-' + id, ebaySku:'s-' + id, ...extra } });
const rec = (id, skuId, qty) => ({ id, status:'in_stock', data:{ source:'foc_receive', focSkuId:skuId, qty } });
const presaleRows = [
  conv('cp-a', '00000000-0000-4000-8000-000000000000', "Cyberpunk 2077: Jayk's Case #1 (CVR A) (Nicola Izzo)", 10, { onSaleDate:'2026-10-21', ebayInventoryItemGroupKey:'lbagrp-1' }),
  conv('st', '00000001-0000-4000-8000-000000000000', 'Star Trek: Warped Phrases', 1, { onSaleDate:'2026-10-06' }),
  conv('son', '00000002-0000-4000-8000-000000000000', 'Sonic the Hedgehog x Godzilla #3 Cover A (Lawrence)', 8, { onSaleDate:'2026-10-14' }),
  conv('sk', '00000003-0000-4000-8000-000000000000', '12-Foot Skeleton #1 Cover A Ben Templesmith', 5, { onSaleDate:'2026-10-14' }),
  conv('ux', '00000004-0000-4000-8000-000000000000', 'UNCANNY X-MEN #159 FACSIMILE EDITION', 10, { onSaleDate:'2026-10-14' }),
  conv('h1', '00000005-0000-4000-8000-000000000000', 'Sonic the Hedgehog x Godzilla #3 Variant RI (15) (Haines)', 2, { onSaleDate:'2026-10-14', focPresaleOriginalQty:3 }),
  conv('h2', '00000005-0000-4000-8000-000000000000', 'Sonic the Hedgehog x Godzilla #3 Variant RI (15) (Haines)', 2, { onSaleDate:'2026-10-14', focPresaleOriginalQty:3 }),
  conv('ok', '00000006-0000-4000-8000-000000000000', 'Received the right way', 3, { onSaleDate:'2026-10-14', focReceivedAt:'2026-10-14T00:00:00Z' }),
];
const receiveRows = [rec('r-son', '00000002-0000-4000-8000-000000000000', 8), rec('r-sk', '00000003-0000-4000-8000-000000000000', 10), rec('r-ux', '00000004-0000-4000-8000-000000000000', 2), rec('r-h', '00000005-0000-4000-8000-000000000000', 1)];
const skus = [{ id:'00000000-0000-4000-8000-000000000000', store_quantity:2, on_sale_date:'2026-10-21' }, { id:'00000001-0000-4000-8000-000000000000', store_quantity:1, on_sale_date:'2026-10-06' }];
const check = presaleStockCheck({ presaleRows, receiveRows, skus, today:'2026-10-13' });
assert.deepEqual(check.early.map(e => e.rowId), ['cp-a', 'st']);
assert.equal(check.early[0].reason, 'comes out 2026-10-21 -- switched to in stock but nothing was received');
assert.equal(check.early[0].released, false);
assert.equal(check.early[0].listedMoreThanOrdered, true, 'eBay lists 10, 2 were ordered');
assert.equal(check.early[1].released, true, 'already out: may have come in some other way');
const dbl = Object.fromEntries(check.doubles.map(d => [d.presaleRowId, d]));
assert.deepEqual([dbl.son.shows, dbl.son.real, dbl.son.fix], [16, 8, { presaleQty:8, receivedQty:0 }], 'Sonic A: 8 + 8 is really 8, all on the eBay row');
assert.deepEqual([dbl.sk.shows, dbl.sk.real, dbl.sk.fix], [15, 10, { presaleQty:5, receivedQty:5 }]);
assert.deepEqual([dbl.ux.shows, dbl.ux.real, dbl.ux.fix], [12, 2, { presaleQty:2, receivedQty:0 }], 'only 2 came in: eBay drops to 2');
assert.equal(check.doubles.length, 3, 'a presale received the right way is left alone');
assert.equal(check.review.length, 1);
assert.match(check.review[0].reason, /^2 eBay presale listings for this one cover -- 2 left of 3, 2 left of 3; 1 received/);
{
  const sold = presaleStockCheck({ presaleRows, receiveRows, skus, soldSince:new Map([['son', 2]]), today:'2026-10-13' });
  const s = sold.doubles.find(d => d.presaleRowId === 'son');
  assert.deepEqual([s.real, s.fix, s.soldOffPresale], [6, { presaleQty:6, receivedQty:0 }, 2], 'copies sold off the switched row came out of the same books');
}

// The fix route: back to presale (inventory + eBay), doubles merged.
{
  const patches = [], reverted = [], revised = [];
  const rowsById = Object.fromEntries([...presaleRows, ...receiveRows].map(r => [r.id, r]));
  const deps = {
    json:(data, status = 200) => ({ status, data }), requireStoreUser:async () => ({ user:{ id:'u' } }),
    readJsonWithLimit:async req => ({ data:JSON.parse(req.body) }),
    getEbayUserAccessToken:async () => 'tok',
    revertEbayPresaleListing:async (env, tok, args) => { reverted.push(args); return {}; },
    ebayReviseOfferQuantity:async (env, tok, offerId, qty) => { revised.push([offerId, qty]); },
    supabaseAdminFetch:async (env, path, opts = {}) => {
      if (opts.method === 'PATCH') { patches.push([path, JSON.parse(opts.body)]); return { data:null }; }
      if (path.startsWith('inventory_items?store_id=eq.st&data->>source=in.(foc_presale,foc_presale_bundle)&status=in.(in_stock)')) return { data:presaleRows };
      if (path.includes('data->>source=eq.foc_receive')) return { data:receiveRows };
      if (path.startsWith('comic_skus?')) return { data:skus };
      if (path.startsWith('store_settings?')) return { data:[{ receipt_settings:{ ebayNormalFulfillmentPolicyId:'pol-normal' } }] };
      const one = path.match(/^inventory_items\?id=eq\.([^&]+)&/); if (one) return { data:[rowsById[one[1]]] };
      return { data:[] };
    },
  };
  const req = { method:'POST', headers:{ get:() => null }, body:JSON.stringify({ storeId:'st', early:['cp-a'], doubles:['son', 'ux'] }) };
  const res = await handleFocRequest(req, {}, new URL('https://x/foc/admin/presale-stock-fix'), deps);
  assert.equal(res.data.ok, true, JSON.stringify(res.data));
  assert.deepEqual(res.data.results.map(r => r.ok), [true, true, true]);
  assert.deepEqual(reverted, [{ sku:'s-cp-a', offerId:'o-cp-a', groupKey:'lbagrp-1', onSaleDate:'2026-10-21', basePolicyId:'pol-normal' }]);
  const cp = patches.find(p => p[0].startsWith('inventory_items?id=eq.cp-a&'))[1];
  assert.equal(cp.status, 'presale');
  assert.equal(cp.data.name, "Cyberpunk 2077: Jayk's Case #1 (CVR A) (Nicola Izzo) - PRESALE");
  assert.equal(cp.data.ebayPresaleConverted, false);
  assert.equal('ebayConvertedAt' in cp.data, false);
  const sonRec = patches.find(p => p[0].startsWith('inventory_items?id=eq.r-son&'))[1];
  assert.equal(sonRec.status, 'archived', 'the duplicate received row goes away');
  assert.deepEqual(revised, [['o-ux', 2]], 'Uncanny: eBay drops from 10 to the 2 that came in');
  assert.equal(patches.find(p => p[0].startsWith('inventory_items?id=eq.ux&'))[1].data.qty, 2);
  // An eBay failure leaves inventory alone.
  const failing = { ...deps, revertEbayPresaleListing:async () => { throw new Error('eBay said no'); } };
  patches.length = 0;
  const bad = await handleFocRequest({ ...req, body:JSON.stringify({ storeId:'st', early:['cp-a'] }) }, {}, new URL('https://x/foc/admin/presale-stock-fix'), failing);
  assert.deepEqual(bad.data.results, [{ name:"Cyberpunk 2077: Jayk's Case #1 (CVR A) (Nicola Izzo)", ok:false, error:'eBay said no' }]);
  assert.equal(patches.length, 0);
}

// Ordering pills: a presale for a book that isn't out yet isn't on the shelf.
{
  const facts = comicDemandFacts({ today:'2026-10-13', stock:[
    { id:'a', source:'foc_presale', name:"Cyberpunk 2077: Jayk's Case #1 (CVR A)", qty:'10', onSaleDate:'2026-10-21' },
    { id:'b', source:'foc_presale', name:'Sonic #3 Cover A', qty:'8', onSaleDate:'2026-10-07' },
    { id:'c', source:'foc_receive', name:'Venom #1', qty:'2', onSaleDate:'2026-10-21' },
  ] });
  assert.deepEqual(facts.stock.map(s => s.name), ['Sonic #3 Cover A', 'Venom #1']);
}

// Receiving reads every presale (not the first 1,000 items) and marks the
// presales it covers; switching to in stock only touches arrived covers.
const foc = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');
const receive = foc.slice(foc.indexOf('async function receiveShipment('), foc.indexOf('async function receiveShipment(') + 20000);
assert.match(receive, /const presaleRows=await focPresaleRows\(db,storeId\);/);
assert.doesNotMatch(receive, /status=in\.\(presale,sold,in_stock\)&select=id,status,data`\)/);
assert.match(foc, /data->>source=in\.\(foc_presale,foc_presale_bundle\)&status=in\.\(\$\{status\}\)&select=id,status,data&order=id\.asc&limit=1000&offset=\$\{offset\}/);
assert.match(receive, /data:\{\.\.\.pd,qty:presaleKeep,quantity:presaleKeep,focReceivedAt:stamp\}/, 'a short-shipped presale is marked received');
assert.match(receive, /body:JSON\.stringify\(\{data:\{\.\.\.pd,focReceivedAt:stamp\}\}\)/, 'a fully covered presale is marked received');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const convert = worker.slice(worker.indexOf("if (url.pathname === '/foc/ebay/convert-to-instock')"), worker.indexOf("if (url.pathname === '/foc/ebay/convert-to-instock')") + 6000);
assert.match(convert, /const arrived = d => !!d\.focReceivedAt \|\| receivedSkuIds\.has\(d\.focSkuId\);/);
assert.match(convert, /Number\(d\.qty \?\? d\.quantity \?\? 0\) > 0 && arrived\(d\);/);
assert.match(convert, /if \(!live\.length \|\| !live\.every\(r => arrived\(r\.data\)\)\) tradingGroups\.delete\(listingId\);/);
assert.match(worker, /revertEbayPresaleListing: revertEbayRestListingToPresale,/);
assert.match(worker, /if \(!policy\.id \|\| policy\.usedFallback\) throw new Error/, 'never reverts onto the wrong shipping policy');
const ui = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
assert.match(ui, /onclick="openPresaleStockCheck\(\)">🩺 PRESALE STOCK CHECK<\/button>/);
assert.match(ui, /if\(!confirm\('Fix '\+/, 'nothing changes without confirming');

// Store report: "I have this listed" but the cover wall said EBAY · ELIGIBLE.
// The wall (and the PRH order's eBay-presold count, and the "already listed?"
// guard before creating a presale) read the first 1,000 items only.
assert.doesNotMatch(foc, /inventory_items\?store_id=eq\.\$\{encodeURIComponent\(storeId\)\}&status=in\.\(presale,sold,in_stock\)&select=id,status,data`/, 'no unpaged presale lookups left');
assert.doesNotMatch(foc, /inventory_items\?store_id=eq\.\$\{encodeURIComponent\(storeId\)\}&status=eq\.presale&select=/);
assert.match(foc, /focPresaleRows\(db,storeId\)\.then\(data=>\(\{ data \}\)\)/);
assert.match(foc, /async function ebayPresoldBySku\(db,storeId\)\{[\s\S]{0,900}const rows=await focPresaleRows\(db,storeId\);/, 'the PRH order counts every eBay presale');
assert.equal((worker.match(/const \{ data: alreadyListedRows \} = await supabaseAdminFetchAll\(env, `inventory_items\?store_id=eq\.\$\{encodeURIComponent\(storeId\)\}&status=in\.\(presale,in_stock\)&data->>source=in\.\(foc_presale,foc_presale_bundle\)/g) || []).length, 2, 'both create-presale guards see every listing');

// Re-price / change quantity of a live eBay presale from the cover wall.
{
  const p = presaleEditPatch({ qty:2, focPresaleOriginalQty:3, salePrice:49.69, market:49.69 }, 'presale', { price:39.99, available:5 });
  assert.deepEqual([p.status, p.data.salePrice, p.data.market, p.data.qty, p.data.focPresaleOriginalQty, p.sold], ['presale', 39.99, 39.99, 5, 6, 1], 'the 1 already sold stays sold');
  const back = presaleEditPatch({ qty:0, focPresaleOriginalQty:2 }, 'sold', { available:3 });
  assert.deepEqual([back.status, back.data.focPresaleOriginalQty], ['presale', 5], 'sold out + more copies = live again');
  const priceOnly = presaleEditPatch({ qty:2, focPresaleOriginalQty:2 }, 'presale', { price:20 });
  assert.equal(priceOnly.data.qty, 2);
}
{
  const sku = '11111111-2222-4333-8444-555555555555', calls = [], patches = [];
  const row = { id:'row-1', status:'presale', data:{ source:'foc_presale', focSkuId:sku, ebayListingId:'257789576095', ebayOfferId:'305401038011', ebaySku:'lba-x', qty:2, focPresaleOriginalQty:2, salePrice:49.69 } };
  const deps = { json:(data, status = 200) => ({ status, data }), requireStoreUser:async () => ({ user:{ id:'u' } }), readJsonWithLimit:async req => ({ data:JSON.parse(req.body) }),
    getEbayUserAccessToken:async () => 'tok', revisePresaleListing:async (env, tok, d, change) => { calls.push([d.ebayOfferId, change]); },
    supabaseAdminFetch:async (env, path, opts = {}) => { if (opts.method === 'PATCH') { patches.push(JSON.parse(opts.body)); return { data:null }; } return { data:path.startsWith('inventory_items?') ? [row] : [] }; } };
  const call = body => handleFocRequest({ method:'POST', headers:{ get:() => null }, body:JSON.stringify({ storeId:'st', skuId:sku, ...body }) }, {}, new URL('https://x/foc/admin/ebay-presale-edit'), deps);
  const ok = await call({ price:39.99, available:3 });
  assert.deepEqual(ok.data, { ok:true, listingId:'257789576095', price:39.99, available:3, sold:0 });
  assert.deepEqual(calls, [['305401038011', { price:39.99, quantity:3 }]]);
  assert.equal(patches[0].data.salePrice, 39.99);
  assert.equal((await call({ price:0 })).status, 400);
  assert.equal((await call({})).status, 400);
  calls.length = 0; patches.length = 0;
  const failing = await handleFocRequest({ method:'POST', headers:{ get:() => null }, body:JSON.stringify({ storeId:'st', skuId:sku, price:10 }) }, {}, new URL('https://x/foc/admin/ebay-presale-edit'), { ...deps, revisePresaleListing:async () => { throw new Error('eBay down'); } });
  assert.equal(failing.status, 502);
  assert.equal(patches.length, 0, 'nothing saved here when eBay refuses');
}
assert.match(worker, /https:\/\/api\.ebay\.com\/sell\/inventory\/v1\/bulk_update_price_quantity/, 'price/quantity only -- never a full listing rebuild');
assert.match(worker, /revisePresaleListing: ebayRevisePresalePriceQuantity,/);
assert.match(ui, /if\(\(status==='LISTED'\|\|status==='SOLD_OUT'\)&&v\.ebayListingId\)action=focEbayEditHtml\(v\)\+action;/);
assert.match(ui, /href="https:\/\/www\.ebay\.com\/itm\/'\+encodeURIComponent\(v\.ebayListingId\)\+'"/);
assert.match(ui, /if\(!confirm\('Change the eBay listing for '/);

// A PriceCharting match that prices a 1:25 like a regular copy is ignored.
assert.equal(D.ratioPcSuspicious({ pcUngraded:5.17, coverPrice:4.99, ratio:25 }), true);
assert.equal(D.ratioPcSuspicious({ pcUngraded:5.17, activeMedian:34.99, activeCount:6 }), true);
assert.equal(D.ratioPcSuspicious({ pcUngraded:30, coverPrice:4.99, ratio:25, activeMedian:34.99, activeCount:6 }), false);
assert.deepEqual(D.ratioValue({ pcUngraded:5.17, activeMedian:34.99, activeCount:6, coverPrice:4.99, ratio:25 }), { price:31.49, basis:'90% of the median eBay asking price (6 listed)' }, 'Jean Grey #1 1:25: priced off listings, not the $5.17 match');
console.log('FOC presale stock fix checks passed');
