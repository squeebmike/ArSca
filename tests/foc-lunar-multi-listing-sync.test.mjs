import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handleFocRequest } from '../scripts/foc-preorders.mjs';

// Store, 2026-11-03: "Lunar didn't put quantity of Robin Hood books we didn't
// order to 0. With the multi listing. We ordered some." The Lunar upload set
// the ordered counts, but on eBay multi-cover (Trading API) listings:
//  - a listing with some covers ordered kept every cover at 10 (the per-cover
//    revise failed), and
//  - a listing with no covers ordered was ended for the first cover, then
//    every other cover tried to end it again, failed, and stayed at 10.
const CYCLE = 'cyc-1', STORE = 'st';
const sku = (id, upc) => ({ id, upc, distributor_sku: 'D-' + id, title: id, variant_label: id });
const skus = [sku('rh-a', '111'), sku('rh-b', '112'), sku('rh-j', '113'), sku('tc-a', '211'), sku('tc-b', '212'), sku('tc-c', '213')];
const row = (id, skuId, listing, qty, n) => ({ id, status: 'presale', data: { source: 'foc_presale', focCycleId: CYCLE, focSkuId: skuId, ebayApiSystem: 'trading', ebayListingId: listing, ebaySku: 'v-' + n, ebayInventoryItemGroupKey: listing, qty, quantity: qty, focPresaleOriginalQty: qty } });
const rows = [
  row('i-rh-a', 'rh-a', 'RH', 10, 0), row('i-rh-b', 'rh-b', 'RH', 10, 1), row('i-rh-j', 'rh-j', 'RH', 1, 2),
  row('i-tc-a', 'tc-a', 'TC', 10, 0), row('i-tc-b', 'tc-b', 'TC', 10, 1), row('i-tc-c', 'tc-c', 'TC', 1, 2),
];
const calls = [];
const ended = new Set();
const deps = {
  json: (data, status = 200) => ({ status, data }),
  readJsonWithLimit: async r => ({ data: await r.json() }),
  requireStoreUser: async () => ({ user: { id: 'u1' } }),
  getEbayUserAccessToken: async () => 'tok',
  withdrawEbayOffer: async () => { throw new Error('no offer ids on Trading listings'); },
  withdrawEbayOfferGroup: async () => {},
  ebayReviseOfferQuantity: async () => {},
  ebayReviseVariationQuantityTrading: async (tok, listing, vsku, q) => { calls.push(['revise', listing, vsku, q]); },
  // eBay refuses to end a listing twice.
  endEbayListingTrading: async (tok, listing) => { calls.push(['end', listing]); if (ended.has(listing)) throw new Error('EndFixedPriceItem failed: already closed'); ended.add(listing); },
  supabaseAdminFetch: async (env, path, options = {}) => {
    if (path.startsWith('comic_skus?cycle_id=eq.' + CYCLE)) return { data: skus };
    if (options.method === 'PATCH' && path.startsWith('comic_skus?')) return { data: [] };
    if (options.method === 'PATCH' && path.startsWith('inventory_items?id=eq.')) {
      const id = path.match(/id=eq\.([^&]+)/)[1]; const r = rows.find(x => x.id === id); Object.assign(r, JSON.parse(options.body)); return { data: [] };
    }
    if (path.startsWith('inventory_items?')) return { data: /offset=0\b/.test(path) || !/offset=/.test(path) ? rows.filter(r => /status=in\.\(presale/.test(path) ? r.status === 'presale' : true) : [] };
    return { data: [] };
  },
};
// Lunar order: Robin Hood B x3 and J x1 ordered, A not; no Thundercats at all.
const order = [{ code: 'D-rh-b', upc: '112', title: 'RH B', quantity: 3 }, { code: 'D-rh-j', upc: '113', title: 'RH J', quantity: 1 }];
const res = await handleFocRequest({ method: 'POST', headers: { get: () => null }, json: async () => ({ storeId: STORE, cycleId: CYCLE, rows: order }) }, {}, new URL('https://x/foc/admin/prh-cart-import'), deps);
assert.equal(res.data.ok, true, JSON.stringify(res.data));
const qty = id => rows.find(r => r.id === id).data.qty;
// Robin Hood: the unordered cover goes to 0 on its own variation, ordered B to 3.
assert.deepEqual(calls.filter(c => c[1] === 'RH'), [['revise', 'RH', 'v-0', 0], ['revise', 'RH', 'v-1', 3]], 'per-cover revises on the multi-listing; J already right');
assert.equal(qty('i-rh-a'), 0); assert.equal(qty('i-rh-b'), 3); assert.equal(qty('i-rh-j'), 1);
// Thundercats: none ordered -- the listing is ended once and every cover marked 0.
assert.deepEqual(calls.filter(c => c[1] === 'TC'), [['end', 'TC']], 'ended once, not once per cover');
for (const id of ['i-tc-a', 'i-tc-b', 'i-tc-c']) { assert.equal(qty(id), 0, id); assert.ok(rows.find(r => r.id === id).data.ebayWithdrawnAt, id + ' marked withdrawn'); }
assert.equal(res.data.ebayWithdrawnCount, 4);

// Worker: one variation's stock goes through ReviseInventoryStatus, and an
// already-ended listing (eBay 1047) counts as ended.
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const rv = worker.slice(worker.indexOf('async function ebayReviseVariationQuantityTrading('), worker.indexOf('async function reviseLiveEbayListing('));
assert.match(rv, /reviseLiveEbayListing\(null, ebayToken, \{ itemId: listingId, variationSku: sku, quantity: Math\.max\(0, parseInt\(newQuantity, 10\) \|\| 0\), trading: true \}\)/);
assert.doesNotMatch(rv, /ReviseFixedPriceItem/);
const end = worker.slice(worker.indexOf('async function endEbayListingTrading('), worker.indexOf('async function endEbayListingTrading(') + 700);
assert.match(end, /e\.code === '1047'/);
assert.match(worker, /e\.code = \(txt\.match\(\/<ErrorCode>/);

// MATCH EBAY TO ORDER: the same eBay step from the order already saved (no
// file) -- and refused for a cycle with nothing ordered yet.
{
  for (const r of rows) { const q = r.id.endsWith('j') || r.id.endsWith('c') ? 1 : 10; r.data = { ...r.data, qty: q, quantity: q, focPresaleOriginalQty: q }; delete r.data.ebayWithdrawnAt; }
  calls.length = 0; ended.clear();
  const saved = { 'rh-b': 3, 'rh-j': 1 };
  const db0 = deps.supabaseAdminFetch;
  const run = (secured) => handleFocRequest({ method: 'POST', headers: { get: () => null }, json: async () => ({ storeId: STORE, cycleId: CYCLE }) }, {}, new URL('https://x/foc/admin/ebay-match-order'),
    { ...deps, supabaseAdminFetch: async (env, path, o) => path.startsWith('comic_skus?cycle_id=eq.' + CYCLE) ? { data: skus.map(k => ({ id: k.id, secured_quantity: secured[k.id] || 0 })) } : db0(env, path, o) });
  const none = await run({});
  assert.equal(none.status, 400, 'nothing ordered yet: refused');
  assert.equal(calls.length, 0, 'and nothing touched on eBay');
  const r = await run(saved);
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  assert.deepEqual(calls.filter(c => c[1] === 'RH'), [['revise', 'RH', 'v-0', 0], ['revise', 'RH', 'v-1', 3]]);
  assert.deepEqual(calls.filter(c => c[1] === 'TC'), [['end', 'TC']]);
  assert.equal(r.data.ebayWithdrawnCount, 4); assert.equal(r.data.ebayQuantityUpdatedCount, 1); assert.equal(r.data.orderedCovers, 2);
  const ui = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
  assert.match(ui, /onclick="matchFocEbayToOrder\(\)"[^>]*>MATCH EBAY TO ORDER<\/button>/);
  assert.match(ui, /api\('\/foc\/admin\/ebay-match-order'/);
  // The one-time run for the 11/2 Lunar cycle, on the 10-minute schedule, once.
  assert.match(worker, /\{ id: '2026-11-03-lunar-1102', storeId: '0f9dd4bc-42a7-487e-a972-2905d24513e9', cycleId: 'ac2bdebc-feb4-4248-a47a-6705784c7deb' \}/);
  assert.match(worker, /if \(prev\?\.done \|\| \(prev\?\.tries \|\| 0\) >= 3\) continue;/);
  assert.match(worker, /runScheduledEbayNewSales\(env\), runFocEbayMatchOnce\(env, ctx\)\]\);/);
}
// eBay refusing a cover: "variation not found" means it's already off the
// listing (marked 0); anything else is kept on the row to read.
{
  const rows2 = [row('x-a', 'rh-a', 'RH2', 10, 0), row('x-g', 'tc-a', 'RH2', 10, 6), row('x-h', 'tc-b', 'RH2', 10, 7), row('x-b', 'rh-b', 'RH2', 10, 1)];
  const deps2 = { ...deps,
    ebayReviseVariationQuantityTrading: async (tok, l, vsku, q) => { if (vsku === 'v-6') throw new Error('ReviseInventoryStatus failed: Variation SKU lbagrp-6 not found.'); if (vsku === 'v-7') throw new Error('ReviseInventoryStatus failed: Internal error.'); },
    supabaseAdminFetch: async (env, path, o = {}) => {
      if (path.startsWith('comic_skus?cycle_id=eq.' + CYCLE)) return { data: skus.map(k => ({ id: k.id, secured_quantity: k.id === 'rh-b' ? 3 : 0 })) };
      if (o.method === 'PATCH' && path.startsWith('inventory_items?id=eq.')) { const id = path.match(/id=eq\.([^&]+)/)[1]; Object.assign(rows2.find(x => x.id === id), JSON.parse(o.body)); return { data: [] }; }
      if (path.startsWith('inventory_items?')) return { data: /offset=0\b/.test(path) || !/offset=/.test(path) ? rows2.filter(r => r.status === 'presale') : [] };
      return { data: [] };
    } };
  await handleFocRequest({ method: 'POST', headers: { get: () => null }, json: async () => ({ storeId: STORE, cycleId: CYCLE }) }, {}, new URL('https://x/foc/admin/ebay-match-order'), deps2);
  const g = rows2.find(r => r.id === 'x-g').data, h = rows2.find(r => r.id === 'x-h').data;
  assert.equal(g.qty, 0); assert.equal(g.ebayWithdrawnReason, 'not_on_ebay_listing', 'not on the listing: nothing to sell, marked 0');
  assert.equal(h.qty, 10, 'any other refusal leaves the count'); assert.match(h.ebaySyncError.message, /Internal error/); assert.equal(h.ebaySyncError.step, 'withdraw');
  assert.equal(rows2.find(r => r.id === 'x-a').data.ebaySyncError, null);
}

// Nightly eBay check: once a day, only cycles with an order saved.
{
  const fn = worker.slice(worker.indexOf('async function runScheduledFocEbayCheck('), worker.indexOf('// One-time MATCH EBAY TO ORDER runs'));
  assert.match(fn, /const doneKey = 'foc-ebay-check:' \+ day;/, 'once per Pacific day');
  assert.match(fn, /foc_cycles\?status=eq\.open&foc_date=gte\.\$\{since\}/, 'open cycles from the last 60 days');
  assert.match(fn, /secured_quantity=gt\.0&select=id&limit=1/);
  assert.match(fn, /if \(!any\?\.length\) continue; \/\/ no order saved yet/, 'a cycle with no order is never touched');
  assert.match(fn, /'\/foc\/admin\/ebay-match-order'/);
  assert.match(fn, /noteJobHealth\(env, 'foc-ebay-check'/, 'shows in the morning summary');
  assert.match(worker, /runScheduledFocAutoList\(env\), runScheduledFocEbayCheck\(env, ctx\)\]\);/);
}
console.log('Lunar/PRH order -> eBay multi-cover listings: per-cover zero/quantity, end once, already-ended passed');
