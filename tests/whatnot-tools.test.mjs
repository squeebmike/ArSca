import assert from 'node:assert/strict';
import fs from 'node:fs';
import { whatnotTitle, whatnotDesired, auctionStartPrice, addItemsToWhatnotShow, backToBuyItNow, parseCsv, summarizeFinancialReport, whatnotInsights } from '../scripts/whatnot-sync.mjs';

// Store, 2026-11-01: "do auto titles next and do items 1 through 5" --
// auto titles, auctions, labels + tracking, payouts, show trends, top buyers.

// Auto titles: the item's name, plus what buyers search for when missing.
assert.equal(whatnotTitle({ categorySlug: 'sports-cards', name: 'Cal Raleigh', year: '2023', set: 'Topps Chrome', cardNumber: '192', variant: 'Refractor', gradingCompany: 'PSA', grade: '10' }, { is_rookie: true }),
  '2023 Topps Chrome Cal Raleigh #192 Refractor RC PSA 10');
assert.equal(whatnotTitle({ categorySlug: 'sports-cards', name: '2023 Topps Chrome Cal Raleigh #192 Refractor RC', year: '2023', set: 'Topps Chrome', cardNumber: '192', variant: 'Refractor' }, { is_rookie: true }),
  '2023 Topps Chrome Cal Raleigh #192 Refractor RC', 'nothing added twice');
assert.equal(whatnotTitle({ categorySlug: 'sports-cards', name: 'Aidan Smith [Neon Green]', year: '2025', brand: 'Bowman', cardNumber: 'BP-45' }, { serial_number: '399' }), '2025 Bowman Aidan Smith [Neon Green] #BP-45 /399');
assert.equal(whatnotTitle({ categorySlug: 'pokemon', name: 'Charizard ex', cardNumber: '223/197', set: 'Obsidian Flames', language: 'Japanese' }), 'Charizard ex #223/197 Obsidian Flames Japanese');
assert.equal(whatnotTitle({ categorySlug: 'pokemon', name: '30th Celebration Knock Out Collection', isSealed: true, set: '30th Celebration' }), '30th Celebration Knock Out Collection Sealed');
assert.equal(whatnotTitle({ categorySlug: 'comics', name: 'Absolute Batman #25 Cover C', comic: { publisher: 'DC Comics', coverDate: '2026-11-11' } }), 'Absolute Batman #25 Cover C (DC Comics 2026)');
assert.ok(whatnotTitle({ categorySlug: 'sports-cards', name: 'x'.repeat(200) }).length <= 120);
const row = { id: 'r', status: 'in_stock', data: { name: 'Cal Raleigh', sellOnWhatnot: true, quantity: 1 } };
const item = { name: 'Cal Raleigh', categorySlug: 'sports-cards', year: '2023', set: 'Topps Chrome', price: 5, photos: [] };
assert.equal(whatnotDesired(row, item).title, '2023 Topps Chrome Cal Raleigh');
assert.equal(whatnotDesired(row, item, { autoTitles: false }).title, 'Cal Raleigh', 'Settings can turn it off');

// Auctions: starting bid in whole dollars, at least $1.
assert.equal(auctionStartPrice({ amount: 1 }, 50), 1);
assert.equal(auctionStartPrice({ percent: 50 }, 25), 13);
assert.equal(auctionStartPrice({ percent: 10 }, 3), 1);
assert.equal(auctionStartPrice({ amount: 0.2 }, 3), 1);
{
  const kv = new Map([['whatnot-link:S:a', { productId: 'pa', variantId: 'va', price: 20, qty: 1, published: true }]]);
  const calls = [];
  const api = async (m, path, body) => { calls.push([m, path, body]); return { ok: true, status: 200, data: {} }; };
  const res = await addItemsToWhatnotShow(['a'], 'show-1', { api, storeId: 'S', kvGet: async k => kv.get(k) ?? null, kvPut: async (k, v) => { kv.set(k, v); },
    rows: async () => [{ id: 'a', status: 'in_stock', data: { name: 'A', sellOnWhatnot: true } }], shape: () => ({ price: 20 }) }, { auction: { percent: 50 } });
  assert.equal(res[0].added, true); assert.equal(res[0].startPrice, 10);
  assert.deepEqual(calls[0], ['PATCH', '/products/pa/variants', { variants: [{ id: 'va', pricing: { auction: { start_price: { amount: '10.00', currency: 'USD' } } } }] }]);
  assert.deepEqual(calls[1][2], { transaction_type: 'auction', shows: { strategy: 'ADD', show_ids: ['show-1'] } });
  assert.deepEqual(kv.get('whatnot-link:S:a').auction, { startPrice: 10, showId: 'show-1' });
  // Back to Buy It Now.
  const back = await backToBuyItNow(['a', 'nope'], { api, storeId: 'S', kvGet: async k => kv.get(k) ?? null, kvPut: async (k, v) => { kv.set(k, v); } });
  assert.deepEqual(back.map(r => !!r.done), [true, false]);
  assert.deepEqual(calls.at(-1)[2], { transaction_type: 'buy_it_now', reserve_for_live: false });
  assert.equal(kv.get('whatnot-link:S:a').auction, undefined);
}

// Payouts: Whatnot's financial report CSV.
const csv = 'order_id,livestream_title,original_item_price,post_coupon_price,commission_fee,processing_fee,commission_tax,processing_fee_tax,coupon_cost,seller_shipping_charge,transaction_amount,buyer_paid,listing_title\n'
  + 'o1,Pre Funk,20,20,1.60,0.88,0,0,0,0,17.52,24.5,"Batman, #25 ""foil"""\n'
  + 'o2,Pre Funk,10,9,0.72,0.56,0.05,0,1,0,7.67,12,Comic\n'
  + 'o3,,5,5,0.40,0.45,0,0,0,0,4.15,8,Shop sale\n';
const rows = parseCsv(csv);
assert.equal(rows.length, 3); assert.equal(rows[0].listing_title, 'Batman, #25 "foil"', 'quotes and commas');
const sum = summarizeFinancialReport(rows);
assert.equal(sum.orders, 3); assert.equal(sum.sales, 34); assert.equal(sum.commission, 2.72); assert.equal(sum.processing, 1.89); assert.equal(sum.taxOnFees, 0.05);
assert.equal(sum.fees, 4.66); assert.equal(sum.net, 29.34); assert.equal(sum.coupons, 1);
assert.deepEqual(sum.shows.map(x => [x.show, x.net]), [['Pre Funk', 25.19], ['Not in a show', 4.15]]);

// Trends and top buyers.
const ins = whatnotInsights({
  shows: [
    { title: 'A', started_at: '2026-10-28', report_summary: { gross: 100, net: 60, margin: 60, sold: 10, orders: 8, buyersCount: 5, peakViewers: 20 } },
    { title: 'B', started_at: '2026-10-31', report_summary: { gross: 62.5, net: 53.93, margin: 86.3, sold: 4, orders: 4, buyersCount: 2, peakViewers: 8 } },
  ],
  notes: { o1: { buyer: 'riddleofsteel', showId: 's1', createdAt: '2026-10-28' }, o2: { buyer: 'riddleofsteel', showId: 's2', createdAt: '2026-10-31' }, o3: { buyer: 'amy', showId: 's2', createdAt: '2026-10-31' }, o4: { buyer: 'amy', status: 'cancelled' } },
  amounts: { o1: 30, o2: 43.75, o3: 5, o4: 99 },
});
assert.equal(ins.shows[0].title, 'B', 'newest first'); assert.equal(ins.shows[1].avgOrder, 12.5);
assert.equal(ins.averages.net, 56.97); assert.equal(ins.best.title, 'A');
assert.deepEqual(ins.buyers.map(b => [b.buyer, b.orders, b.total, b.shows]), [['riddleofsteel', 2, 73.75, 2], ['amy', 1, 5, 1]], 'a cancelled order is not counted');
assert.equal(ins.repeatBuyers, 1);

// Wiring.
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
for (const p of ["'/whatnot/buy-it-now'", "'/whatnot/label'", "'/whatnot/tracking'", "'/whatnot/report'", "'/whatnot/insights'"]) assert.ok(worker.includes(p), p);
assert.match(worker, /deps\.api\('POST', `\/shipments\/\$\{encodeURIComponent\(shipmentId\)\}\/generate_label`, \{\}\)/);
assert.match(worker, /deps\.api\('POST', '\/shipments\/add_tracking_code', \{ order_item_ids: itemIds, tracking_code: trackingCode, carrier \}\)/);
assert.match(worker, /report_type: 'seller_financial_report', start_date: start\.toISOString\(\), end_date: end\.toISOString\(\)/);
assert.match(worker, /listingSettings: await whatnotListingSettings\(env, storeId\) \};\n  const out = \{ at: new Date\(\)\.toISOString\(\) \};/, 'listing sync knows the auto-title choice');
const dash = fs.readFileSync('dashboard.html', 'utf8');
assert.match(dash, /onclick="addSelectedToNextWhatnotShow\(true\)"[^>]*>AUCTION IN NEXT SHOW</);
assert.match(dash, /onclick="backToBuyItNowSelected\(\)"[^>]*>BACK TO BUY IT NOW</);
assert.match(dash, /createWhatnotLabel\('\$\{escHtml\(o\.shipment\.id\)\}'\)">CREATE LABEL</);
assert.match(dash, /addWhatnotTracking\('\$\{escHtml\(o\.id\)\}'\)">ADD TRACKING</);
assert.match(dash, /onclick="runWhatnotPayouts\(7\)">LAST 7 DAYS</);
assert.match(dash, /onclick="renderWhatnotInsights\(\)">SHOW TRENDS &amp; TOP BUYERS</);
assert.match(dash, /id="whatnot-auto-titles"/);
console.log('whatnot tools checks passed');
