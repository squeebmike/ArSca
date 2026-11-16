// ADD BUNDLE TO A LIVE EBAY LISTING (store, 2026-11-16: "I have Spider-Woman on eBay now. How to add an every cover
// option to the already made listing ... I'd like to select what's in the bundle").
import assert from 'node:assert/strict';
import fs from 'node:fs';
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const foc = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
const r0 = worker.indexOf("if (url.pathname === '/foc/ebay/add-bundle-to-group-listing') {");
assert.ok(r0 > 0, 'route');
const route = worker.slice(r0, worker.indexOf("if (url.pathname === '/foc/ebay/repair-group-listing-photos') {", r0));
assert.ok(route.includes("requireStoreUser(request, env, storeId, ['owner','admin'])"), 'owner/admin only');
assert.ok(route.includes("r.data?.ebayApiSystem === 'trading'") && route.includes('!r.data?.ebayWithdrawnAt'), 'only a live multi-cover (Trading) listing');
assert.ok(route.includes('if (body.preview) return json({ ok: true, listingId, listingIds, covers, bundles });'), 'preview lists covers and bundles already there');
assert.ok(route.includes('.filter(id => covers.some(c => c.skuId === id));') && route.includes('if (picked.length < 2)'), 'only covers on this listing, at least 2');
assert.ok(route.includes("'ReviseFixedPriceItem', reviseXml") && route.includes('<VariationSpecificsSet>'), 'same listing, one more Cover choice');
assert.ok(route.includes('is already a choice on this listing'), 'no duplicate names');
assert.ok(route.includes("source: 'foc_presale_bundle', focSkuId: null") && route.includes('focBundleSkuIds: picked'), 'tracked like a listing-time bundle, with just the picked covers');
assert.ok(route.includes("Math.round(Number(skuById.get(id)?.msrp_cents || 0) * 0.5)"), 'cost = the picked covers\' wholesale');
assert.ok(route.includes('repairEbayTradingGroupListingPhotos('), 'photos re-bound so no cover loses its picture');
// The dashboard side: picking covers sets the default name and price; the button shows on a listed title.
const s = foc.indexOf('var focAddBundle=null;'), e = foc.indexOf('async function openFocAddBundle(');
const lib = new Function(foc.slice(s, e) + [ 'focAddBundleTotals', 'focAddBundleDefaultName' ].map(n => { const i = foc.indexOf('function ' + n + '('); let d = 0, j = foc.indexOf('){', i) + 1; for (; j < foc.length; j++) { if (foc[j] === '{') d++; else if (foc[j] === '}' && !--d) break; } return '\n' + foc.slice(i, j + 1); }).join('') + '\nreturn { set: v => { focAddBundle = v; }, focAddBundleTotals, focAddBundleDefaultName };')();
const covers = [{ skuId: 'a', label: 'CVR A', price: 4.99, qty: 8 }, { skuId: 'b', label: 'CVR B', price: 4.99, qty: 6 }, { skuId: 'c', label: 'CVR C 1:25', price: 24.99, qty: 2 }];
lib.set({ covers, picked: { a: true, b: true, c: true } });
let t = lib.focAddBundleTotals(); assert.equal(t.picked.length, 3); assert.equal(t.sum.toFixed(2), '34.97'); assert.equal(t.most, 2, 'no more bundles than the scarcest cover');
assert.equal(lib.focAddBundleDefaultName(t.picked), 'All Covers Bundle (3 Books)');
lib.set({ covers, picked: { a: true, b: true } });
t = lib.focAddBundleTotals(); assert.equal(lib.focAddBundleDefaultName(t.picked), 'Bundle: CVR A + CVR B'); assert.equal(t.most, 6);
assert.ok(foc.includes('onclick="openFocAddBundle(') && foc.includes('+ ADD BUNDLE TO EBAY LISTING'), 'button on the title');
assert.ok(foc.includes('window.openFocAddBundle=openFocAddBundle;') && foc.includes('window.submitFocAddBundle=submitFocAddBundle;') && foc.includes('window.focAddBundlePick=focAddBundlePick;'), 'reachable from onclick');
console.log('Add bundle to a live eBay listing: passed');
// (2026-11-16: "I'm in Lunar. Why's it say submit PRH order?") The lock button and its messages name the week's distributor.
assert.ok(foc.includes("(c.distributor==='Lunar'?'LOCK LUNAR ORDER':'SUBMIT PRH ORDER')"), 'Lunar week: LOCK LUNAR ORDER');
assert.ok(foc.includes("function focDistributorName(){return state.cycle&&state.cycle.distributor==='Lunar'?'Lunar':'PRH';}") && foc.includes("toast_dash(focDistributorName()+' order locked: '"));
console.log('Lunar lock button name: passed');
