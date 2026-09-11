import assert from 'node:assert/strict';
import fs from 'node:fs';

// Store report: "what about eBay comic bundles?" -- selling the "All Covers
// Bundle" variant of a FOC group listing (source:'foc_presale_bundle',
// focSkuId:null, focBundleSkuIds:[...real cover ids]) was invisible to every
// function that counts eBay presales per real cover SKU. Concretely, before
// this fix:
//   - ebayPresoldBySku (feeds the real PRH distributor order) silently
//     under-ordered every cover sold only/also through a bundle.
//   - receiveShipment's presaleByskuId (reservation on arrival) never held
//     back stock already sold via a bundle, risking a physical copy being
//     sold twice -- once through the bundle, once as fresh standalone stock.
//   - buildCycleCatalog's presaleBySkuId (admin "N presold" badge + ratio
//     incentive qualification progress) undercounted both.
//   - the bundle's own inventory_items row always saved cost:0 (it has no
//     single skuId of its own to look up an MSRP for), overstating profit
//     on every bundle sale to 100% margin.
// This file locks in the fix: each of the three per-SKU attribution loops
// must also handle a foc_presale_bundle row by crediting its sold count to
// every real cover listed in focBundleSkuIds, and the bundle inventory row's
// cost must be the sum of each bundled cover's own PRH cost (50% of MSRP).

const service = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// ── Structural: ebayPresoldBySku (distributor order math) ──
const ebayPresoldSrc = service.match(/async function ebayPresoldBySku\(db,storeId\)\{[\s\S]*?\n\}/)[0];
assert.match(ebayPresoldSrc, /isBundle=d\.source==='foc_presale_bundle'&&Array\.isArray\(d\.focBundleSkuIds\)&&d\.focBundleSkuIds\.length/,
  'ebayPresoldBySku must recognize a foc_presale_bundle row by its focBundleSkuIds array');
assert.match(ebayPresoldSrc, /if\(isBundle\)\{for\(const skuId of d\.focBundleSkuIds\)map\.set\(skuId,\(map\.get\(skuId\)\|\|0\)\+soldSoFar\);\}/,
  'ebayPresoldBySku must credit a sold bundle unit to every real cover it bundles, not drop it entirely');

// ── Structural: receiveShipment's presaleByskuId (arrival reservation) ──
const receiveSrc = service.match(/async function receiveShipment\(request,env,deps\)\{[\s\S]*?\n\}/)[0];
assert.match(receiveSrc, /isBundle=d\.source==='foc_presale_bundle'&&Array\.isArray\(d\.focBundleSkuIds\)&&d\.focBundleSkuIds\.length/,
  'receiveShipment must recognize a foc_presale_bundle row the same way ebayPresoldBySku does');
assert.match(receiveSrc, /if\(isBundle\)\{for\(const skuId of d\.focBundleSkuIds\)presaleByskuId\.set\(skuId,\(presaleByskuId\.get\(skuId\)\|\|0\)\+soldSoFar\);\}/,
  'receiveShipment must reserve a copy of every real cover a sold bundle unit contains, or a physical copy could be sold twice');

// ── Structural: buildCycleCatalog's presaleBySkuId (dashboard badge + ratio qualification) ──
const catalogSrc = service.match(/async function buildCycleCatalog\(db, cycle, includeAdmin = false, env, deps, storeId, page = null\) \{[\s\S]*?\n  for \(const row of skuRows/)[0];
assert.match(catalogSrc, /isBundle = d\.source === 'foc_presale_bundle' && Array\.isArray\(d\.focBundleSkuIds\) && d\.focBundleSkuIds\.length/,
  'buildCycleCatalog must recognize a foc_presale_bundle row the same way the other two attribution points do');
assert.match(catalogSrc, /const skuIds = isBundle \? d\.focBundleSkuIds : \[d\.focSkuId\];/,
  'buildCycleCatalog must fold a bundle sale into every real cover it bundles, not just one skuId');

// ── Structural: the bundle inventory row's cost, in the worker ──
const groupCreateSrc = worker.match(/if \(url\.pathname === '\/foc\/ebay\/presale-group-preview' \|\| url\.pathname === '\/foc\/ebay\/create-presale-group'\) \{[\s\S]*?\n    \}\n/)[0];
assert.match(groupCreateSrc, /const bundleCostCents = realCovers\.reduce\(\(sum, v\) => sum \+ Math\.round\(Number\(skuRows\.find\(s => s\.id === v\.skuId\)\?\.msrp_cents \|\| 0\) \* 0\.5\), 0\);/,
  'the bundle\'s per-unit cost must be computed as the sum of each real bundled cover\'s own PRH cost (50% of MSRP)');
assert.match(groupCreateSrc, /cost: skuRow \? Math\.round\(Number\(skuRow\.msrp_cents \|\| 0\) \* 0\.5\) \/ 100 : bundleCostCents \/ 100,/,
  'the bundle inventory row must use bundleCostCents, not a hardcoded 0, or every bundle sale reports 100% margin');

// ── Functional: reimplement the per-SKU attribution algorithm and verify it
// against the scenarios that actually matter -- a plain single-cover sale
// (unchanged), a bundle-only sale (previously dropped entirely), and a cover
// sold BOTH on its own and inside a bundle (must sum both sources). ──
function attributePresold(rows) {
  const map = new Map();
  for (const row of rows) {
    const d = row.data || {};
    const isBundle = d.source === 'foc_presale_bundle' && Array.isArray(d.focBundleSkuIds) && d.focBundleSkuIds.length;
    if (d.source !== 'foc_presale' && !isBundle) continue;
    if (!isBundle && !d.focSkuId) continue;
    const originalQty = Number(d.focPresaleOriginalQty || 0);
    const remainingQty = row.status === 'sold' ? 0 : Number(d.qty ?? d.quantity ?? 0);
    const soldSoFar = Math.max(0, originalQty - remainingQty);
    if (soldSoFar <= 0) continue;
    const skuIds = isBundle ? d.focBundleSkuIds : [d.focSkuId];
    for (const skuId of skuIds) map.set(skuId, (map.get(skuId) || 0) + soldSoFar);
  }
  return map;
}
{
  // Plain single-cover presale, 3 of 10 sold -- unaffected by this fix.
  const map = attributePresold([{ status: 'presale', data: { source: 'foc_presale', focSkuId: 'cover-a', focPresaleOriginalQty: 10, qty: 7 } }]);
  assert.equal(map.get('cover-a'), 3, 'a plain single-cover sale must still be counted exactly as before');
}
{
  // Bundle-only: cover B and C are only sold through a 5-unit bundle listing, 2 sold so far.
  const map = attributePresold([{ status: 'presale', data: { source: 'foc_presale_bundle', focBundleSkuIds: ['cover-b', 'cover-c'], focPresaleOriginalQty: 5, qty: 3 } }]);
  assert.equal(map.get('cover-b'), 2, 'a bundle-only sale must still credit each bundled cover -- this was silently dropped before the fix');
  assert.equal(map.get('cover-c'), 2, 'every cover in the bundle must be credited, not just the first one');
}
{
  // Cover A sold both on its own (2 of 10) AND as part of a bundle (1 of 4) -- must sum.
  const map = attributePresold([
    { status: 'presale', data: { source: 'foc_presale', focSkuId: 'cover-a', focPresaleOriginalQty: 10, qty: 8 } },
    { status: 'presale', data: { source: 'foc_presale_bundle', focBundleSkuIds: ['cover-a', 'cover-d'], focPresaleOriginalQty: 4, qty: 3 } },
  ]);
  assert.equal(map.get('cover-a'), 3, 'a cover sold both individually and inside a bundle must have both sources summed (2 + 1)');
  assert.equal(map.get('cover-d'), 1, 'the other cover in that same bundle must be credited independently');
}

// ── Functional: bundle per-unit cost is the sum of each bundled cover's own cost. ──
function bundleCost(realCoverMsrpCentsList) {
  return realCoverMsrpCentsList.reduce((sum, msrpCents) => sum + Math.round(msrpCents * 0.5), 0);
}
{
  // Three covers at $4.99, $5.99, $3.99 MSRP -- bundle cost is the sum of each at 50%.
  const cents = bundleCost([499, 599, 399]);
  assert.equal(cents, 250 + 300 + 200, 'bundle cost must be the sum of each real cover\'s own 50%-of-MSRP cost, not 0 and not a single cover\'s cost');
}

console.log('FOC eBay bundle attribution checks passed');
