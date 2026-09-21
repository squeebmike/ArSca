import assert from 'node:assert/strict';
import { handleFocRequest } from '../scripts/foc-preorders.mjs';

// Store report: "we didn't order any Shredder #13 -- why is it still
// presale?" Every existing FOC eBay cleanup tool (the PRH cart import's
// auto-sweep, END REMAINING EBAY LISTINGS) is scoped to whichever cycle is
// currently open -- a listing tied to an older, already-closed cycle is
// invisible to both, forever, unless someone happens to reopen that exact
// old cycle. This scans every cycle at once and cross-checks each live
// listing against that cycle's own locked PRH order.

function mockRequest(body) {
  return { method:'POST', headers:{ get:() => null }, json: async () => body };
}
function mockGetRequest() {
  return { method:'GET', headers:{ get:() => null } };
}

const cycles = [
  { id:'cycle-open', foc_date:'2026-09-28', status:'open', customer_cutoff_at:'2099-01-01T00:00:00Z' },
  { id:'cycle-closed-submitted', foc_date:'2026-08-01', status:'open', customer_cutoff_at:'2020-01-01T00:00:00Z' },
  { id:'cycle-closed-unsubmitted', foc_date:'2026-07-01', status:'open', customer_cutoff_at:'2020-01-01T00:00:00Z' },
];
const submissions = [
  { cycle_id:'cycle-closed-submitted', line_items:[
    { skuId:'sku-ordered', finalQty:3 },
    { skuId:'sku-bundle-member-ordered', finalQty:1 },
  ], submitted_at:'2026-08-01T00:00:00Z' },
];
const presaleRows = [
  // Live in the currently OPEN cycle -- must never appear in the scan at all.
  { id:'row-open', status:'presale', data:{ source:'foc_presale', focCycleId:'cycle-open', focSkuId:'sku-open', ebayOfferId:'offer-open', qty:2, quantity:2 } },
  // Closed, submitted cycle: this cover WAS ordered -- must be flagged 'ordered', not 'orphaned'.
  { id:'row-ordered', status:'presale', data:{ source:'foc_presale', focCycleId:'cycle-closed-submitted', focSkuId:'sku-ordered', ebayOfferId:'offer-ordered', qty:1, quantity:1 } },
  // Closed, submitted cycle: this is the real Shredder #13 case -- never in
  // the submitted order's line_items at all -- must be flagged 'orphaned'.
  { id:'row-shredder13', status:'presale', data:{ source:'foc_presale', focCycleId:'cycle-closed-submitted', focSkuId:'sku-never-ordered', ebayOfferId:'offer-shredder13', qty:1, quantity:1 } },
  // Closed, submitted cycle bundle: none of its bundled skus were ordered --
  // 'orphaned'.
  { id:'row-bundle-orphaned', status:'presale', data:{ source:'foc_presale_bundle', focCycleId:'cycle-closed-submitted', focSkuId:null, focBundleSkuIds:['sku-never-ordered'], ebayOfferId:'offer-bundle-orphaned', qty:1, quantity:1 } },
  // Closed, submitted cycle bundle: one bundled sku WAS ordered -- 'ordered'.
  { id:'row-bundle-ordered', status:'presale', data:{ source:'foc_presale_bundle', focCycleId:'cycle-closed-submitted', focSkuId:null, focBundleSkuIds:['sku-bundle-member-ordered'], ebayOfferId:'offer-bundle-ordered', qty:1, quantity:1 } },
  // Closed cycle that never had a PRH order submitted at all -- can't be
  // confirmed either way, must be flagged 'unknown', never auto-selected.
  { id:'row-unknown', status:'presale', data:{ source:'foc_presale', focCycleId:'cycle-closed-unsubmitted', focSkuId:'sku-whatever', ebayOfferId:'offer-unknown', qty:1, quantity:1 } },
  // A zero-quantity / no-live-listing row must never surface at all.
  { id:'row-dead', status:'presale', data:{ source:'foc_presale', focCycleId:'cycle-closed-submitted', focSkuId:'sku-dead', ebayOfferId:'offer-dead', qty:0, quantity:0 } },
];

function buildDb() {
  return async (env, path) => {
    if (path.startsWith('foc_cycles?')) return { data:cycles };
    if (path.startsWith('inventory_items?') && path.includes('status=eq.presale')) return { data:presaleRows };
    if (path.startsWith('foc_prh_submissions?')) return { data:submissions };
    return { data:[] };
  };
}

function mockDeps(overrides = {}) {
  return {
    json:(data, status = 200) => ({ status, data }),
    readJsonWithLimit:async (request) => ({ data:await request.json() }),
    requireStoreUser:async () => ({ user:{ id:'user-1' } }),
    supabaseAdminFetch: buildDb(),
    ...overrides,
  };
}

{
  const deps = mockDeps();
  const res = await handleFocRequest(mockGetRequest(), {}, new URL('https://x/foc/admin/orphaned-ebay-listings?store_id=store-1'), deps);
  assert.equal(res.data.ok, true, JSON.stringify(res.data));
  assert.equal(res.data.cycles.length, 2, 'the currently-open cycle must be excluded entirely -- only the two closed cycles belong here');
  assert.ok(!res.data.cycles.some(c => c.cycleId === 'cycle-open'), 'a listing from the open cycle must never appear in this scan');

  const submittedCycle = res.data.cycles.find(c => c.cycleId === 'cycle-closed-submitted');
  assert.ok(submittedCycle, 'the closed-and-submitted cycle must be present');
  assert.equal(submittedCycle.hasSubmission, true);
  const byRow = Object.fromEntries(submittedCycle.listings.map(l => [l.rowId, l]));
  assert.equal(byRow['row-ordered'].reason, 'ordered', 'a cover that was actually in the submitted order must be flagged ordered, not orphaned');
  assert.equal(byRow['row-shredder13'].reason, 'orphaned', 'the real Shredder #13 case: never in the submitted order at all');
  assert.equal(byRow['row-bundle-orphaned'].reason, 'orphaned', 'a bundle none of whose covers were ordered must be orphaned');
  assert.equal(byRow['row-bundle-ordered'].reason, 'ordered', 'a bundle with at least one ordered cover must not be flagged orphaned');
  assert.ok(!byRow['row-dead'], 'a zero-quantity row must never surface in the scan');

  const unsubmittedCycle = res.data.cycles.find(c => c.cycleId === 'cycle-closed-unsubmitted');
  assert.ok(unsubmittedCycle, 'the closed-but-never-submitted cycle must be present');
  assert.equal(unsubmittedCycle.hasSubmission, false);
  assert.equal(unsubmittedCycle.listings[0].reason, 'unknown', 'with no submitted order on file, ordered vs. not can\'t be determined from data alone');

  assert.equal(res.data.orphanedCount, 2, 'row-shredder13 and row-bundle-orphaned are the only two truly orphaned listings');
}

{
  // The end route only touches rows it was explicitly told to -- the
  // dealer has already reviewed the scan and picked exactly which ones.
  const patchCalls = [];
  const withdrawn = [];
  const deps = mockDeps({
    supabaseAdminFetch: async (env, path, options = {}) => {
      if (path.startsWith('inventory_items?') && path.includes('status=eq.presale')) return { data:presaleRows };
      if (options.method === 'PATCH' && path.startsWith('inventory_items?id=eq.')) { patchCalls.push({ path, body:JSON.parse(options.body) }); return { data:[] }; }
      return { data:[] };
    },
    getEbayUserAccessToken: async () => 'token-1',
    withdrawEbayOffer: async (env, token, offerId) => { withdrawn.push(offerId); },
  });
  const res = await handleFocRequest(mockRequest({ storeId:'store-1', rowIds:['row-shredder13', 'row-bundle-orphaned'] }), {}, new URL('https://x/foc/admin/orphaned-ebay-listings/end'), deps);
  assert.equal(res.data.ok, true, JSON.stringify(res.data));
  assert.equal(res.data.endedCount, 2);
  assert.deepEqual(withdrawn.sort(), ['offer-bundle-orphaned', 'offer-shredder13'].sort());
  const reasons = patchCalls.map(c => c.body.data.ebayWithdrawnReason);
  assert.ok(reasons.every(r => r === 'orphaned_cycle_cleanup'));
  // row-ordered was never selected -- it must be left completely alone.
  assert.ok(!patchCalls.some(c => c.path.includes('row-ordered')), 'a row the dealer did not select must never be touched');
}

{
  // Validation: no rowIds at all.
  const deps = mockDeps();
  const res = await handleFocRequest(mockRequest({ storeId:'store-1', rowIds:[] }), {}, new URL('https://x/foc/admin/orphaned-ebay-listings/end'), deps);
  assert.equal(res.status, 400);
}

{
  // Auth gating: requireStoreUser's error is returned as-is, for both routes.
  const deps = mockDeps({ requireStoreUser: async () => ({ error:{ status:403, data:{ ok:false, error:'forbidden' } } }) });
  const getRes = await handleFocRequest(mockGetRequest(), {}, new URL('https://x/foc/admin/orphaned-ebay-listings?store_id=store-1'), deps);
  assert.equal(getRes.status, 403);
  const endRes = await handleFocRequest(mockRequest({ storeId:'store-1', rowIds:['row-shredder13'] }), {}, new URL('https://x/foc/admin/orphaned-ebay-listings/end'), deps);
  assert.equal(endRes.status, 403);
}

console.log('Cross-cycle orphaned FOC eBay listing scan + bulk-end functional checks passed');
