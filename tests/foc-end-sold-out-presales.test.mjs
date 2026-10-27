import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handleFocRequest, soldOutPresaleListings } from '../scripts/foc-preorders.mjs';

// Store, 2026-10-27: Sonic the Hedgehog #92 Variant RI (15) listed 1 as a
// presale, sold 1, and stayed Active on eBay at "0 available". "I want them
// ended if they cant buy it ... if I do in the future I can list it again."
const row = (id, data) => ({ id, status: 'presale', data: { source: 'foc_presale', focSkuId: 'sku-' + id, focCycleId: 'c1', ...data } });
const sonic = row('sonic', { name: 'Sonic the Hedgehog #92 Variant RI (15) (Fourdraine) IDW Publishing - PRESALE', qty: 0, quantity: 0, focPresaleOriginalQty: 1, ebayOfferId: 'o-sonic', ebayListingId: '257810593521', ebaySku: 'lba-mvir509q-eqq', ebayVolumeDiscountPromotionId: 'promo-1' });
const selling = row('selling', { name: 'Still selling', qty: 2, focPresaleOriginalQty: 3, ebayOfferId: 'o-selling', ebayListingId: '1' });
const groupA = row('ga', { name: 'Group cover A', qty: 0, focPresaleOriginalQty: 2, ebayOfferId: 'o-ga', ebayListingId: '2', ebayInventoryItemGroupKey: 'grp-1' });
const groupB = row('gb', { name: 'Group cover B', qty: 1, focPresaleOriginalQty: 2, ebayOfferId: 'o-gb', ebayListingId: '2', ebayInventoryItemGroupKey: 'grp-1' });
const doneA = row('da', { name: 'Done cover A', qty: 0, focPresaleOriginalQty: 1, ebayOfferId: 'o-da', ebayListingId: '3', ebayInventoryItemGroupKey: 'grp-2' });
const doneB = row('db', { name: 'Done cover B', qty: 0, focPresaleOriginalQty: 4, ebayOfferId: 'o-db', ebayListingId: '3', ebayInventoryItemGroupKey: 'grp-2' });
const trading = row('tr', { name: 'Trading cover', qty: 0, focPresaleOriginalQty: 1, ebayApiSystem: 'trading', ebayListingId: '4', ebaySku: 'tr-sku' });
const handEnded = row('he', { name: 'Ended by hand', qty: 0, focPresaleOriginalQty: 1, ebayOfferId: 'o-he', ebayListingId: '5' });
const already = row('aw', { name: 'Already ended', qty: 0, focPresaleOriginalQty: 1, ebayOfferId: 'o-aw', ebayListingId: '6', ebayWithdrawnAt: '2026-10-20T00:00:00Z' });
const bundle = row('bu', { source: 'foc_presale_bundle', qty: 0, ebayOfferId: 'o-bu', ebayListingId: '7' });
const rows = [sonic, selling, groupA, groupB, doneA, doneB, trading, handEnded, already, bundle];

const picked = soldOutPresaleListings(rows).map(group => group.map(r => r.id).sort().join('+')).sort();
assert.deepEqual(picked, ['da+db', 'he', 'sonic', 'tr'], 'sold-out listings only; a multi-cover listing waits for every cover; ended ones and bundles are left alone');

const calls = [], patches = [];
const deps = {
  json: (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  readJsonWithLimit: async req => ({ data: await req.json() }),
  requireStoreUser: async () => ({ user: { id: 'u' }, role: 'owner' }),
  supabaseAdminFetch: async (env, path, options = {}) => {
    if (options.method === 'PATCH') { patches.push({ path, body: JSON.parse(options.body) }); return { data: null }; }
    if (path.startsWith('inventory_items?')) return { data: rows.filter(r => path.includes('status=in.(presale)') ? r.status === 'presale' : true) };
    return { data: [] };
  },
  getEbayUserAccessToken: async () => 'tok',
  withdrawEbayOffer: async (env, token, offerId) => {
    calls.push('withdraw ' + offerId);
    if (offerId === 'o-he') throw new Error('End listing failed (400): This Offer is not in a published state.');
  },
  withdrawEbayOfferGroup: async (env, token, key) => { calls.push('withdraw group ' + key); },
  endEbayListingTrading: async (token, listingId) => { calls.push('end item ' + listingId); },
  endEbayVolumeDiscount: async (env, token, id) => { calls.push('end promo ' + id); },
};
const req = new Request('https://w.example/foc/admin/end-sold-out-ebay-presales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeId: 'store-1' }) });
const res = await handleFocRequest(req, {}, new URL(req.url), deps);
const out = await res.json();
assert.equal(res.status, 200, JSON.stringify(out));
assert.deepEqual(calls.sort(), ['end item 4', 'end promo promo-1', 'withdraw group grp-2', 'withdraw o-he', 'withdraw o-sonic'].sort(), 'one end call per listing, never for a listing still selling');
assert.deepEqual(out.failed, []);
assert.equal(out.ended.length, 4);
assert.ok(out.ended.some(e => e.name === 'Sonic the Hedgehog #92 Variant RI (15) (Fourdraine) IDW Publishing'), 'named without the PRESALE tag');

const patched = Object.fromEntries(patches.map(p => [p.path.match(/id=eq\.([^&]+)/)[1], p.body.data]));
assert.deepEqual(Object.keys(patched).sort(), ['da', 'db', 'he', 'sonic', 'tr']);
assert.equal(patched.sonic.ebayWithdrawnReason, 'sold_out');
assert.ok(patched.sonic.ebayWithdrawnAt);
assert.equal(patched.sonic.focPresaleOriginalQty, 1, 'the sold copy stays counted, so receiving still holds it for the buyer');
assert.equal(patched.db.focPresaleOriginalQty, 4);
assert.equal(patched.he.ebayWithdrawnReason, 'sold_out', 'a listing already off eBay is recorded, not retried every hour');

// A real failure is reported, and the row is left to try again.
patches.length = 0; calls.length = 0;
deps.withdrawEbayOffer = async () => { throw new Error('End listing failed (500): eBay is down'); };
deps.withdrawEbayOfferGroup = async () => {}; deps.endEbayListingTrading = async () => {};
const res2 = await handleFocRequest(new Request(req.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeId: 'store-1' }) }), {}, new URL(req.url), deps);
const out2 = await res2.json();
assert.ok(out2.failed.some(f => f.listingId === '257810593521'));
assert.ok(!patches.some(p => p.path.includes('id=eq.sonic')), 'not marked ended when eBay refused');

// Runs hourly, right after the eBay order sync brings in the sales.
const worker = fs.readFileSync(new URL('../cloudflare-worker-full.js', import.meta.url), 'utf8');
const sync = worker.slice(worker.indexOf('async function runScheduledEbayOrderSync'), worker.indexOf('async function ebayFetchWithRetry'));
assert.ok(sync.indexOf("'/foc/admin/end-sold-out-ebay-presales'") > sync.indexOf('syncEbayOrdersForStore('), 'after the sales are in');
console.log('sold-out eBay presales end checks passed');
