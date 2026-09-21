import assert from 'node:assert/strict';
import { handleFocRequest } from '../scripts/foc-preorders.mjs';

// Store request: after placing the real order on PRH's own ordering site,
// getting that reality (what was actually ordered, which can differ from
// this store's own computed demand -- carton minimums, buying a few extra)
// back into the dashboard meant clicking into every single cover and
// retyping its store-stock quantity by hand. This feeds PRH's own
// cart-export CSV in directly: matches rows to comic_skus by UPC, sets
// secured_quantity (ground truth of what's coming) and recomputes
// store_quantity (what's left over after subtracting committed website +
// eBay demand), then reconciles every live FOC eBay listing in the cycle
// against that real order -- ending listings for anything left out, and
// adjusting still-live ordered-cover listings down to match reality.

function mockRequest(body) {
  return { method:'POST', headers:{ get:() => null }, json: async () => body };
}

function mockDeps(overrides = {}) {
  return {
    json:(data, status = 200) => ({ status, data }),
    readJsonWithLimit:async (request) => ({ data:await request.json() }),
    requireStoreUser:async () => ({ user:{ id:'user-1' } }),
    supabaseAdminFetch:async () => ({ data:[] }),
    ...overrides,
  };
}

const skus = [
  { id:'sku-A', upc:'111', title:'Ordered With Extra', variant_label:'Cover A' },
  { id:'sku-B', upc:'222', title:'Not Ordered', variant_label:'Cover A' },
  { id:'sku-C', upc:'333', title:'Ordered Exactly Committed', variant_label:'Cover A' },
  { id:'sku-D', upc:'444', title:'Ordered, Not Yet Listed', variant_label:'Cover A' },
];
const presaleRows = [
  { id:'inv-A', status:'presale', data:{ source:'foc_presale', focCycleId:'cycle-1', focSkuId:'sku-A', ebayOfferId:'offer-A', qty:2, quantity:2, focPresaleOriginalQty:2 } },
  { id:'inv-B', status:'presale', data:{ source:'foc_presale', focCycleId:'cycle-1', focSkuId:'sku-B', ebayOfferId:'offer-B', qty:5, quantity:5, focPresaleOriginalQty:5 } },
];

function buildDb(patchCalls) {
  return async (env, path, options = {}) => {
    if (path.startsWith('comic_skus?cycle_id=eq.cycle-1')) return { data:skus };
    if (options.method === 'PATCH' && path.startsWith('comic_skus?id=eq.')) { patchCalls.push({ path, body:JSON.parse(options.body) }); return { data:[] }; }
    if (path.startsWith('foc_preorder_orders?')) return { data:[{ id:'order-1' }] };
    if (path.startsWith('foc_preorder_items?')) return { data:[{ sku_id:'sku-A', quantity:1 }, { sku_id:'sku-C', quantity:2 }, { sku_id:'sku-D', quantity:1 }] };
    if (path.includes('status=in.(presale,sold,in_stock)')) return { data:presaleRows };
    if (path.includes('status=eq.presale')) { if (options.method === 'PATCH') { patchCalls.push({ path, body:JSON.parse(options.body) }); return { data:[] }; } return { data:presaleRows }; }
    return { data:[] };
  };
}

{
  // The core reconciliation: matches by UPC, sums committed demand,
  // withdraws the unordered cover's listing, adjusts the ordered cover's
  // listing up to the real total, and flags the ordered-but-unlisted cover.
  const patchCalls = [];
  const ebayRevised = [];
  const ebayWithdrawn = [];
  const deps = mockDeps({
    supabaseAdminFetch: buildDb(patchCalls),
    getEbayUserAccessToken: async () => 'token-1',
    withdrawEbayOffer: async (env, token, offerId) => { ebayWithdrawn.push(offerId); },
    ebayReviseOfferQuantity: async (env, token, offerId, qty) => { ebayRevised.push({ offerId, qty }); },
  });
  const rows = [
    { upc:'111', quantity:4 },  // sku-A: committed 1 (website) -> store_quantity 3, listing 2->4
    { upc:'333', quantity:2 },  // sku-C: committed 2 -> store_quantity 0
    { upc:'444', quantity:5 },  // sku-D: committed 1 -> store_quantity 4, no listing yet
    { upc:'999', quantity:7 },  // matches nothing in this cycle
  ];
  const res = await handleFocRequest(mockRequest({ storeId:'store-1', cycleId:'cycle-1', rows }), {}, new URL('https://x/foc/admin/prh-cart-import'), deps);
  assert.equal(res.data.ok, true, JSON.stringify(res.data));
  assert.equal(res.data.matchedCount, 3, 'sku-A, sku-C, sku-D were matched and ordered; sku-B was not');
  assert.deepEqual(res.data.unmatchedRows, [{ upc:'999', quantity:7 }], 'a UPC matching nothing in this cycle must be reported, not silently dropped');

  const patchBySku = Object.fromEntries(patchCalls.filter(c => c.path.startsWith('comic_skus?id=eq.')).map(c => [c.path.match(/id=eq\.([^&]+)/)[1], c.body]));
  assert.deepEqual(patchBySku['sku-A'], { secured_quantity:4, store_quantity:3 }, 'sku-A: 4 ordered minus 1 committed = 3 left over for store/eBay');
  assert.deepEqual(patchBySku['sku-B'], { secured_quantity:0, store_quantity:0 }, 'a cover left out of the real cart must be zeroed, not left at a stale value');
  assert.deepEqual(patchBySku['sku-C'], { secured_quantity:2, store_quantity:0 }, 'ordered exactly what customers already committed to leaves nothing extra');
  assert.deepEqual(patchBySku['sku-D'], { secured_quantity:5, store_quantity:4 }, 'sku-D: 5 ordered minus 1 committed = 4 left over');

  assert.deepEqual(ebayWithdrawn, ['offer-B'], 'the listing for the cover left out of the real order must be withdrawn');
  assert.deepEqual(ebayRevised, [{ offerId:'offer-A', qty:4 }], 'the ordered cover\'s live listing must be adjusted up to the real ordered total');
  assert.equal(res.data.ebayWithdrawnCount, 1);
  assert.equal(res.data.ebayQuantityUpdatedCount, 1);

  assert.equal(res.data.needsListing.length, 1, 'only the ordered-with-leftover-stock cover that has no live listing at all belongs here');
  assert.equal(res.data.needsListing[0].skuId, 'sku-D');
  assert.equal(res.data.needsListing[0].availableQty, 4);
}

{
  // Validation: no cycleId.
  const deps = mockDeps();
  const res = await handleFocRequest(mockRequest({ storeId:'store-1', rows:[{ upc:'111', quantity:1 }] }), {}, new URL('https://x/foc/admin/prh-cart-import'), deps);
  assert.equal(res.status, 400);
}

{
  // Validation: no rows at all.
  const deps = mockDeps();
  const res = await handleFocRequest(mockRequest({ storeId:'store-1', cycleId:'cycle-1', rows:[] }), {}, new URL('https://x/foc/admin/prh-cart-import'), deps);
  assert.equal(res.status, 400);
}

{
  // Validation: rows present but none has both a UPC and a positive quantity
  // (e.g. a header-only paste, or an all-zero-quantity file).
  const deps = mockDeps();
  const res = await handleFocRequest(mockRequest({ storeId:'store-1', cycleId:'cycle-1', rows:[{ upc:'', quantity:0 }, { upc:'111', quantity:0 }] }), {}, new URL('https://x/foc/admin/prh-cart-import'), deps);
  assert.equal(res.status, 400);
}

{
  // Duplicate UPC rows in the same cart (PRH splitting a large quantity
  // across rows, or the same cover added twice) must sum, not overwrite.
  const patchCalls = [];
  const deps = mockDeps({
    supabaseAdminFetch: buildDb(patchCalls),
    getEbayUserAccessToken: async () => 'token-1',
    withdrawEbayOffer: async () => {},
    ebayReviseOfferQuantity: async () => {},
  });
  const res = await handleFocRequest(mockRequest({ storeId:'store-1', cycleId:'cycle-1', rows:[{ upc:'111', quantity:2 }, { upc:'111', quantity:2 }] }), {}, new URL('https://x/foc/admin/prh-cart-import'), deps);
  assert.equal(res.data.ok, true);
  const patchA = patchCalls.find(c => c.path.includes('sku-A'));
  assert.equal(patchA.body.secured_quantity, 4, 'two 2-quantity rows for the same UPC must sum to 4, not overwrite to 2');
}

{
  // Auth gating: requireStoreUser's error is returned as-is.
  const deps = mockDeps({ requireStoreUser: async () => ({ error:{ status:403, data:{ ok:false, error:'forbidden' } } }) });
  const res = await handleFocRequest(mockRequest({ storeId:'store-1', cycleId:'cycle-1', rows:[{ upc:'111', quantity:1 }] }), {}, new URL('https://x/foc/admin/prh-cart-import'), deps);
  assert.equal(res.status, 403);
}

console.log('PRH cart import (upload real PRH order -> set quantities + reconcile eBay listings) functional checks passed');
