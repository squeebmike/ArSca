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
  // Auction first, then the starting bid as its price (set before, it would be the shop price).
  assert.deepEqual(calls[0][2], { transaction_type: 'auction', shows: { strategy: 'ADD', show_ids: ['show-1'] } });
  assert.deepEqual(calls[1], ['PATCH', '/products/pa/variants', { variants: [{ id: 'va', price: { amount: '10.00', currency: 'USD' } }] }]);
  assert.deepEqual(kv.get('whatnot-link:S:a').auction, { startPrice: 10, showId: 'show-1' });
  // Back to Buy It Now.
  const back = await backToBuyItNow(['a', 'nope'], { api, storeId: 'S', kvGet: async k => kv.get(k) ?? null, kvPut: async (k, v) => { kv.set(k, v); } });
  assert.deepEqual(back.map(r => !!r.done), [true, false]);
  assert.deepEqual(calls.at(-2)[2], { transaction_type: 'buy_it_now', reserve_for_live: false });
  assert.deepEqual(calls.at(-1), ['PATCH', '/products/pa/variants', { variants: [{ id: 'va', price: { amount: '20.00', currency: 'USD' } }] }], 'back in the shop at its shop price, not the starting bid');
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
assert.match(dash, /onclick="setWhatnotModeSelected\('auction'\)"[^>]*>AUCTION</);
assert.match(dash, /onclick="setWhatnotModeSelected\('bin'\)"[^>]*>BUY IT NOW</, 'Buy It Now brings auctions back to the shop');
assert.match(dash, /createWhatnotLabel\('\$\{escHtml\(o\.shipment\.id\)\}'\)">CREATE LABEL</);
assert.match(dash, /addWhatnotTracking\('\$\{escHtml\(o\.id\)\}'\)">ADD TRACKING</);
assert.match(dash, /onclick="runWhatnotPayouts\(7\)">LAST 7 DAYS</);
assert.match(dash, /onclick="renderWhatnotInsights\(\)">SHOW TRENDS &amp; TOP BUYERS</);
assert.match(dash, /id="whatnot-auto-titles"/);
console.log('whatnot tools checks passed');
// While auctioned: the sync never sends the shop price, and a pull never
// takes the starting bid as the dashboard price.
{
  const { whatnotEditPlan } = await import('../scripts/whatnot-sync.mjs');
  const link = { price: 20, qty: 1, auction: { startPrice: 1, showId: 's' } };
  assert.equal(whatnotEditPlan({ link, want: { price: 20, qty: 1 }, wnPrice: 1, wnQty: 1 }).price, null, 'a $1 starting bid is not a price edit');
  assert.equal(whatnotEditPlan({ link: { price: 20, qty: 1 }, want: { price: 20, qty: 1 }, wnPrice: 18, wnQty: 1 }).price, 18, 'a real Whatnot price edit still comes back');
  const src = (await import('node:fs')).readFileSync('scripts/whatnot-sync.mjs', 'utf8');
  assert.match(src, /base\.price !== want\.price && !base\.auction && !want\.showOnly\)/);
  assert.match(src, /base\.published !== true && !want\.showOnly && !base\.auction\)/, 'never published to the shop mid-auction');
  assert.doesNotMatch(src, /pricing: \{ (buy_it_now|auction)/, 'no retired pricing writes left');
}
// SHOW ONLY (FOC comics received into a show): 50% of price or $4, never
// Buy It Now, and unsold ones stay out of the shop.
{
  const w = await import('../scripts/whatnot-sync.mjs');
  assert.deepEqual(w.SHOW_ONLY_START, { percent: 50, min: 4 });
  assert.equal(w.auctionStartPrice(w.SHOW_ONLY_START, 4.99), 4, '$4.99 comic: $4 (50% would be $2)');
  assert.equal(w.auctionStartPrice(w.SHOW_ONLY_START, 30), 15, '$30 book: $15');
  assert.equal(w.auctionStartPrice({ percent: 50 }, 3), 2, 'no floor: as before');
  // The sync never prices or publishes a show-only item into the shop.
  const calls = [];
  const api = async (m, path, body) => { calls.push([m, path, body]); if (m === 'POST' && path === '/products') return { ok: true, status: 201, data: { id: 'p9' } }; if (m === 'GET') return { ok: true, status: 200, data: { data: [{ id: 'v9' }] } }; if (path === '/inventory/set') return { ok: true, status: 200, data: { results: [{ status: 'applied' }] } }; return { ok: true, status: 200, data: {} }; };
  const row = { id: '00000000-0000-4000-8000-0000000000aa', status: 'in_stock', data: { sellOnWhatnot: true, whatnotShowOnly: true, quantity: 2, name: 'Batman #1' } };
  const item = { name: 'Batman #1', price: 4.99, categorySlug: 'comics', category: 'Comic', photos: ['https://img/b.jpg'], description: 'x' };
  // The 10-minute sync: nothing made on Whatnot until it goes into a show.
  const idle = await w.syncWhatnotItem(api, row, item, null, { newKey: () => 'k' });
  assert.equal(idle.link, null); assert.equal(calls.length, 0, 'no listing outside a show');
  // Going into a show (forShow): made, never in the shop.
  const r = await w.syncWhatnotItem(api, row, item, null, { newKey: () => 'k', forShow: true });
  assert.ok(r.link.productId);
  assert.ok(!calls.some(c => c[1].startsWith('/merchandising/')), 'never published as Buy It Now');
  assert.ok(!calls.some(c => c[1].endsWith('/variants') && c[0] === 'PATCH'), 'no shop price');
  assert.ok(calls.some(c => c[1] === '/inventory/set'), 'but its quantity stays 1:1');
  // Into a show: starting bid first (it isn't in the shop), auction, reserved for live.
  const kv = new Map([['whatnot-link:S:' + row.id, { productId: 'p9', variantId: 'v9', qty: 2, published: false }]]);
  calls.length = 0;
  const res = await w.addItemsToWhatnotShow([row.id], 'show-5', { api, storeId: 'S', kvGet: async k => kv.get(k) ?? null, kvPut: async (k, v) => { kv.set(k, v); },
    rows: async () => [row], shape: () => item, profileId: () => '', saveProfileId: async () => {} }, { auction: w.SHOW_ONLY_START });
  assert.equal(res[0].added, true); assert.equal(res[0].startPrice, 4);
  const merch = calls.find(c => c[1].startsWith('/merchandising/'));
  assert.deepEqual(merch[2], { transaction_type: 'auction', reserve_for_live: true, shows: { strategy: 'ADD', show_ids: ['show-5'] } });
  const firstPrice = calls.findIndex(c => c[0] === 'PATCH' && c[1].endsWith('/variants'));
  assert.ok(firstPrice >= 0 && firstPrice < calls.indexOf(merch), 'starting bid set before the switch for a show-only item');
  // After the show: a show-only item stays out of the shop.
  const t = 5_000_000;
  const deps = { api, storeId: 'S', kvGet: async k => kv.get(k) ?? null, kvPut: async (k, v) => { kv.set(k, v); }, rows: async () => [row] };
  await w.returnUnsoldToShop('show-5', deps, { now: t });
  const back = await w.returnUnsoldToShop('show-5', deps, { now: t + w.UNSOLD_RETURN_WAIT_MS + 1 });
  assert.deepEqual(back.returned, [], 'show only: not back in the shop');
  // The receive screens offer the show picker; the dashboard keeps the setting.
  const focDash = (await import('node:fs')).readFileSync('scripts/foc-dashboard.js', 'utf8');
  assert.match(focDash, /setTimeout\(function\(\)\{offerWhatnotShowForReceived\(pickState\.labelItems\);\},400\);/);
  // It must live inside the file's closure, where api() is (outside it the
  // picker never opened after a slip receive, 2026-11-07).
  assert.ok(focDash.indexOf('async function offerWhatnotShowForReceived') < focDash.lastIndexOf('})();'), 'offerWhatnotShowForReceived is inside the foc-dashboard closure');
  assert.match(focDash, /window\.openWhatnotShowPicker\(ids,/, 'the same show picker as Inventory');
  const app = (await import('node:fs')).readFileSync('scripts/dashboard-app.js', 'utf8');
  assert.match(app, /\['whatnotShowOnly', false, 'bool'\],/);
  assert.match(app, /updateBuiltInInventoryItem\(item, \{ whatnotShowOnly:false \}\)/, 'BACK TO BUY IT NOW ends show only');
  assert.match(app, /if\(item\.whatnotShowOnly === true && nextData\.whatnotShowOnly !== true && nextData\.sellOnWhatnot === true\) backToBuyItNowIds\(/, 'Auction -> Buy It Now returns it to the shop');
  const worker = (await import('node:fs')).readFileSync('cloudflare-worker-full.js', 'utf8');
  assert.match(worker, /url\.pathname === '\/whatnot\/show-only' && request\.method === 'POST'/);
  assert.match(worker, /\{ auction: auctionRuleFrom\(deps\.listingSettings\) \}\);/, 'the starting bid rule from Settings');
}
// WHATNOT MODE: Off / Buy It Now / Auction (show only).
{
  const w = await import('../scripts/whatnot-sync.mjs');
  assert.deepEqual(w.auctionRuleFrom({}), { percent: 50, min: 4 });
  assert.deepEqual(w.auctionRuleFrom({ auctionStart: { percent: 40, min: 3 } }), { percent: 40, min: 3 });
  assert.deepEqual(w.auctionRuleFrom({ auctionStart: { percent: 500 } }), { percent: 50, min: 4 }, 'nonsense falls back');
  // Auction mode, not in a show: 0 on Whatnot (not buyable in the shop).
  const calls = [];
  const api = async (m, path, body) => { calls.push([m, path, body]); if (path === '/inventory/set') return { ok: true, status: 200, data: { results: [{ status: 'applied' }] } }; return { ok: true, status: 200, data: {} }; };
  const row = { id: '00000000-0000-4000-8000-0000000000bb', status: 'in_stock', data: { sellOnWhatnot: true, whatnotShowOnly: true, quantity: 3, name: 'X' } };
  const item = { name: 'X', price: 10, categorySlug: 'comics', category: 'Comic', photos: ['https://img/x.jpg'], description: 'x' };
  await w.syncWhatnotItem(api, row, item, { productId: 'p', variantId: 'v', qty: 3, price: 10, published: true }, { newKey: () => 'k' });
  assert.equal(calls.find(c => c[1] === '/inventory/set')[2].items[0].quantity, 0, 'out of the shop until it is in a show');
  calls.length = 0;
  await w.syncWhatnotItem(api, row, item, { productId: 'p', variantId: 'v', qty: 0, published: true, auction: { startPrice: 5, showId: 's' } }, { newKey: () => 'k' });
  assert.equal(calls.find(c => c[1] === '/inventory/set')[2].items[0].quantity, 3, 'in a show: its real count');
  const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
  const modeSrc = app.match(/function whatnotModeOf\(item = \{\}\)\{[^\n]*\n/)[0] + app.match(/function whatnotModePatch\(mode\)\{[^\n]*\n/)[0];
  const [modeOf, patch] = new Function(modeSrc + 'return [whatnotModeOf, whatnotModePatch];')();
  assert.equal(modeOf({}), 'off'); assert.equal(modeOf({ sellOnWhatnot: true }), 'bin'); assert.equal(modeOf({ sellOnWhatnot: true, whatnotShowOnly: true }), 'auction');
  assert.deepEqual(patch('auction'), { sellOnWhatnot: true, whatnotShowOnly: true }); assert.deepEqual(patch('off'), { sellOnWhatnot: false, whatnotShowOnly: false });
  assert.match(app, /if\(listing === 'whatnot_auction'\) return whatnotModeOf\(i\) === 'auction';/);
  assert.match(app, /const auctionStart = \{ percent: pct > 0 && pct <= 100 \? pct : 50, min: min >= 1 \? Math\.round\(min\) : 4 \};/, 'the rule is saved in Settings');
  const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
  assert.match(worker, /if \(existing\?\.auctionStart && !settings\.auctionStart\) kept\.auctionStart = existing\.auctionStart;/);
}
