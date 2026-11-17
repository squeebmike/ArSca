// LINKED BUNDLE COUNTS (store, 2026-11-16: "4 of the bundles and 4 of the ratios ... somebody can accidentally buy 8 of
// those when I don't have 8 of that ratio?").
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { planBundleStockLinks } = await import('../scripts/foc-bundle-stock.mjs');
const L = '257773945921';
const cover = (id, skuId, qty, orig = qty) => ({ id, status: 'presale', data: { source: 'foc_presale', focSkuId: skuId, ebayListingId: L, ebaySku: 'G-' + skuId, ebayApiSystem: 'trading', qty, focPresaleOriginalQty: orig } });
const bundle = (id, qty, orig = qty, skuIds = ['d', 'a']) => ({ id, status: 'presale', data: { source: 'foc_presale_bundle', focSkuId: null, focBundleSkuIds: skuIds, ebayListingId: L, ebaySku: 'G-b', ebayApiSystem: 'trading', qty, focPresaleOriginalQty: orig } });
const by = (out, id) => out.find(c => c.id === id);

// Spider-Woman: 4 ratio (D), 21 Cover A, bundle of 4. A bundle sells (its row already went 4 -> 3).
let rows = [cover('D', 'd', 4), cover('A', 'a', 21), bundle('B', 3, 4)];
let out = planBundleStockLinks(rows, [{ rowId: 'B', qty: 1 }]);
assert.deepEqual([by(out, 'D').qty, by(out, 'D').originalQty], [3, 3], 'one copy of the ratio is in the sold bundle; not counted sold twice');
assert.deepEqual([by(out, 'A').qty, by(out, 'A').originalQty], [20, 20]);
assert.equal(by(out, 'B'), undefined, 'bundle (3) is within the ratio left (3)');
assert.equal(by(out, 'D').ebaySku, 'G-d');
// Then the ratio sells on its own twice (4 -> ... its row is at 1): the bundle can't offer more than 1.
rows = [cover('D', 'd', 1, 3), cover('A', 'a', 20), bundle('B', 3, 4)];
out = planBundleStockLinks(rows, []);
assert.deepEqual([by(out, 'B').qty, by(out, 'B').originalQty, by(out, 'B').was], [1, 2, 3], 'bundle capped at the ratio left; the 1 bundle sold stays counted (2 - 1)');
assert.match(by(out, 'B').why, /only 1 of a cover/);
// The worst case asked about: never more ratio copies sold than there are -- 4 ratio, 4 bundles, sales of each in turn.
{
  let D = 4, Dorig = 4, B = 4, Borig = 4, ratioUsed = 0;
  const step = (sellBundle) => {
    const r = [cover('D', 'd', D, Dorig), cover('A', 'a', 99), bundle('B', B, Borig)];
    let sales = [];
    if (sellBundle && B > 0) { B--; ratioUsed++; sales = [{ rowId: 'B', qty: 1 }]; r[2] = bundle('B', B, Borig); }
    else if (!sellBundle && D > 0) { D--; ratioUsed++; r[0] = cover('D', 'd', D, Dorig); }
    for (const c of planBundleStockLinks(r, sales)) { if (c.id === 'D') { D = c.qty; Dorig = c.originalQty; } if (c.id === 'B') { B = c.qty; Borig = c.originalQty; } }
  };
  for (const s of [true, false, true, false, true, false, true, false]) step(s);
  assert.equal(ratioUsed, 4, 'only the 4 real ratio copies ever sell');
  assert.equal(D + B, 0);
}
// A withdrawn or other listing's cover is never touched; nothing changes when nothing needs to.
rows = [cover('D', 'd', 4), { ...cover('X', 'd', 9), data: { ...cover('X', 'd', 9).data, ebayListingId: '999' } }, bundle('B', 2)];
assert.deepEqual(planBundleStockLinks(rows, []), []);
// The worker links counts after eBay sales and after a bundle is added or edited.
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.ok(worker.includes("import { planBundleStockLinks } from './scripts/foc-bundle-stock.mjs';"));
assert.ok(worker.includes("if (d.source === 'foc_presale_bundle') bundleSales.push({ rowId: invRow.id, qty: quantitySold });"), 'bundle sales collected');
assert.ok(worker.includes('bundleLinks = (await linkFocBundleCounts(env, storeId, ebayToken, [...bundleLinkListings], bundleSales))'), 'linked after the sales');
assert.equal((worker.match(/capped = await linkFocBundleCounts\(env, storeId, ebayToken, \[listingId\], \[\]\)/g) || []).length, 2, 'and when a bundle is added or edited');
assert.ok(worker.includes("focPresaleOriginalQty: c.originalQty") && worker.includes('await setEbayVariationAvailable(ebayToken, c.ebayListingId, c.ebaySku, c.qty);'), 'row and eBay both');
assert.ok(fs.readFileSync('.github/workflows/deploy-worker.yml', 'utf8').includes('- scripts/foc-bundle-stock.mjs'), 'deploys with the worker');
console.log('Linked bundle counts: passed');
