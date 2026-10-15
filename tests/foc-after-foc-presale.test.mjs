import assert from 'node:assert/strict';
import fs from 'node:fs';
import { afterFocCycle, afterFocCartOnFile, afterFocLeft, afterFocAvailability, afterFocPaidSync, loadCycleSummaries, handleFocRequest } from '../scripts/foc-preorders.mjs';

// Store request: "I need stuff we ordered from Lunar and PRH to still be
// available for presale after FOC. But only the amount we have coming that
// isn't sold already. It would be from the cart?" -- after the cutoff the
// uploaded PRH cart / Lunar order (secured_quantity per cover) is what's
// coming; the website keeps selling those covers until they arrive, capped
// at the copies nobody has bought yet here or on eBay.

const service = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const dashboard = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');

const past = new Date(Date.now() - 2 * 864e5).toISOString();
const future = new Date(Date.now() + 2 * 864e5).toISOString();
const later = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10);
const earlier = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10);
const today = new Intl.DateTimeFormat('en-CA', { timeZone:'America/Los_Angeles' }).format(new Date());

// ── Which weeks count as "after FOC" ──
assert.equal(afterFocCycle({ status:'open', customer_cutoff_at:past }), true, 'past the cutoff, still open');
assert.equal(afterFocCycle({ status:'closed', customer_cutoff_at:past }), true, 'closed after the cutoff still sells ordered copies');
assert.equal(afterFocCycle({ status:'open', customer_cutoff_at:future }), false, 'before the cutoff it is a normal open week');
assert.equal(afterFocCycle({ status:'archived', customer_cutoff_at:past }), false, 'archived weeks never sell');
assert.equal(afterFocCycle(null), false);
assert.equal(afterFocCartOnFile([{ is_incentive:true, secured_quantity:2 }]), false, 'an incentive secured by hand is not a cart upload');
assert.equal(afterFocCartOnFile([{ is_incentive:false, secured_quantity:4 }]), true);

// ── Copies left = ordered − website − eBay sold − checkouts in progress ──
{
  const skus = [
    { id:'A', secured_quantity:6, on_sale_date:later },
    { id:'B', secured_quantity:2, on_sale_date:later },
    { id:'C', secured_quantity:3, on_sale_date:earlier },             // already on sale
    { id:'D', secured_quantity:3, on_sale_date:later },               // already received
    { id:'E', secured_quantity:0, on_sale_date:later },               // not ordered
    { id:'F', secured_quantity:2, on_sale_date:later, customer_enabled:false },
    { id:'G', secured_quantity:2, on_sale_date:later, is_incentive:true },
  ];
  const rows = [
    { status:'in_stock', data:{ source:'foc_presale', focSkuId:'A', focPresaleOriginalQty:4, qty:2 } },          // 2 sold on eBay
    { status:'sold', data:{ source:'foc_presale_bundle', focBundleSkuIds:['A', 'B'], focPresaleOriginalQty:1, qty:0 } }, // a bundle took one of each
    { status:'in_stock', data:{ source:'foc_receive', focSkuId:'D', focReceivedAt:'2026-10-01' } },
  ];
  const left = afterFocLeft({ skus, rows, websiteQty:new Map([['A', 1]]), pendingQty:new Map([['A', 1]]), today });
  assert.equal(left.get('A'), 1, '6 ordered − 1 website − 2 eBay − 1 bundle − 1 checkout in progress');
  assert.equal(left.get('B'), 1, 'a sold bundle takes a copy of every cover in it');
  assert.equal(left.has('C'), false, 'covers already on sale sell as shelf stock, not presale');
  assert.equal(left.has('D'), false, 'received covers are on the shelf already');
  assert.equal(left.has('E'), false, 'nothing ordered, nothing to sell');
  assert.equal(left.has('F'), false, 'the cover toggle still switches it off');
  assert.equal(left.get('G'), 2, 'a secured incentive cover sells its copies too');
  assert.equal(afterFocLeft({ skus:skus.map(s => ({ ...s, is_incentive:true })), rows, today }).size, 0, 'no cart upload, no after-FOC sales');
  const over = afterFocLeft({ skus:[{ id:'A', secured_quantity:1, on_sale_date:later }], websiteQty:new Map([['A', 3]]), today });
  assert.equal(over.get('A'), 0, 'never negative');
}

// ── Store question: "it doesn't get confused on comics I listed on eBay that
// didn't sell, when FOC ends them on eBay?" Every dashboard end (FOC-time
// sweep, END EBAY LISTINGS, orphan cleanup) sets qty 0 and pins
// focPresaleOriginalQty to what had really sold, so the unsold copies are
// never read as eBay sales. ──
{
  const skus = [{ id:'A', secured_quantity:5, on_sale_date:later }];
  const ended = [{ status:'presale', data:{ source:'foc_presale', focSkuId:'A', ebayListingId:'L', ebayWithdrawnAt:'2026-10-06', ebayWithdrawnReason:'manual_bulk_end', qty:0, quantity:0, focPresaleOriginalQty:1 } }];
  assert.equal(afterFocLeft({ skus, rows:ended, today }).get('A'), 4, 'listed 10, sold 1, ended: only the 1 real eBay sale comes off the 5 ordered');
  const endedNoneSold = [{ status:'presale', data:{ ...ended[0].data, focPresaleOriginalQty:0 } }];
  assert.equal(afterFocLeft({ skus, rows:endedNoneSold, today }).get('A'), 5, 'an ended listing that sold nothing takes nothing');
  const soldOutThenEnded = [{ status:'sold', data:{ ...ended[0].data, focPresaleOriginalQty:2 } }];
  assert.equal(afterFocLeft({ skus, rows:soldOutThenEnded, today }).get('A'), 3);
  for (const reason of ['not_included_in_prh_order', 'manual_bulk_end', 'orphaned_cycle_cleanup'])
    assert.match(service, new RegExp("qty:0,quantity:0,focPresaleOriginalQty:alreadySoldBeforeWithdraw,ebayWithdrawnAt:new Date\\(\\)\\.toISOString\\(\\),ebayWithdrawnReason:'" + reason + "'"), reason + ' pins the real sold count');
}

// ── The week list: closed weeks with copies coming sit between open and expired ──
{
  const open = { id:'open', store_id:'s', foc_date:'2099-01-01', customer_cutoff_at:'2099-01-01T07:00:00Z', status:'open' };
  const coming = { id:'coming', store_id:'s', foc_date:'2026-10-05', customer_cutoff_at:past, status:'closed' };
  const done = { id:'done', store_id:'s', foc_date:'2026-09-01', customer_cutoff_at:'2026-09-01T07:00:00Z', status:'open' };
  const db = async path => {
    if (path.startsWith('foc_cycles?')) return { data:[done, coming, open] };
    if (path.startsWith('comic_skus?')) { assert.match(path, /cycle_id=in\.\(coming,done\)|cycle_id=in\.\(done,coming\)/); return { data:[{ cycle_id:'coming', is_incentive:false }] }; }
    throw new Error('unexpected ' + path);
  };
  const weeks = await loadCycleSummaries(db, 's');
  assert.deepEqual(weeks.map(w => w.id), ['open', 'coming', 'done']);
  assert.equal(weeks[1].afterFocOpen, true);
  assert.equal(weeks[2].afterFocOpen, false);
}

// ── Public catalog: a closed week shows "N left" covers that can be bought ──
function catalogDb(extra = {}) {
  const cycle = { id:'cyc', store_id:'s', distributor:'prh', foc_date:'2026-10-05', customer_cutoff_at:past, status:'closed' };
  const family = { id:'fam', cycle_id:'cyc', title:'Midnight X-Men #1', series_name:'Midnight X-Men', issue_number:'1' };
  const skus = [
    { id:'11111111-1111-1111-1111-111111111111', family_id:'fam', cycle_id:'cyc', title:'Midnight X-Men #1', variant_label:'Cover A', upc:'1', customer_price_cents:499, secured_quantity:5, on_sale_date:later, is_incentive:false },
    { id:'22222222-2222-2222-2222-222222222222', family_id:'fam', cycle_id:'cyc', title:'Midnight X-Men #1', variant_label:'Cover B', upc:'2', customer_price_cents:599, secured_quantity:1, on_sale_date:later, is_incentive:false },
    { id:'33333333-3333-3333-3333-333333333333', family_id:'fam', cycle_id:'cyc', title:'Midnight X-Men #1', variant_label:'Cover C', upc:'3', customer_price_cents:599, secured_quantity:0, on_sale_date:later, is_incentive:false },
  ];
  return { cycle, skus, db:async (env, path, options = {}) => {
    if (extra.handle) { const r = await extra.handle(path, options); if (r) return r; }
    if (path.startsWith('foc_cycles?')) return { data:[cycle] };
    if (path.startsWith('comic_title_families?')) return { data:[family] };
    if (path.startsWith('comic_skus?id=in.')) return { data:skus.filter(s => path.includes(s.id)) };
    if (path.startsWith('comic_skus?')) return { data:skus };
    if (path.startsWith('foc_preorder_orders?') && path.includes('status=eq.payment_pending')) return { data:extra.pendingOrders || [] };
    if (path.startsWith('foc_preorder_orders?')) return { data:[{ id:'paid-1' }] };
    if (path.startsWith('foc_preorder_items?')) {
      if (path.includes('pend-1')) return { data:[{ sku_id:skus[0].id, quantity:1, status:'committed' }] };
      return { data:[{ sku_id:skus[1].id, quantity:1 }] };
    }
    if (path.startsWith('inventory_items?')) { assert.match(path, /data->>focCycleId=eq\.cyc/); return { data:[{ status:'in_stock', data:{ source:'foc_presale', focSkuId:skus[0].id, focPresaleOriginalQty:3, qty:2 } }] }; }
    return { data:[] };
  } };
}
const json = (data, status = 200) => ({ status, data });
{
  const { db } = catalogDb();
  const res = await handleFocRequest({ method:'GET', headers:{ get:() => null } }, {}, new URL('https://x/public/preorders?store_id=s&cycle=cyc'), { json, supabaseAdminFetch:db });
  assert.equal(res.data.ok, true, JSON.stringify(res.data));
  assert.equal(res.data.cycle.isOpen, false, 'the FOC itself is still closed');
  assert.equal(res.data.cycle.afterFocOpen, true, 'but ordered copies are still for sale');
  const byLabel = Object.fromEntries(res.data.families[0].variants.map(v => [v.variantLabel, v]));
  assert.equal(byLabel['Cover A'].afterFocLeft, 4, '5 ordered − 1 sold on eBay');
  assert.equal(byLabel['Cover A'].canPreorder, true);
  assert.equal(byLabel['Cover B'].afterFocLeft, 0, '1 ordered, 1 bought on the website');
  assert.equal(byLabel['Cover B'].canPreorder, false, 'sold out after FOC');
  assert.equal(byLabel['Cover C'].afterFoc, undefined, 'a cover that was not ordered stays closed');
  assert.equal(byLabel['Cover C'].canPreorder, true, 'its own flag is untouched -- the closed week gates it on the page');
}

// ── Checkout past the cutoff: capped at what's left ──
function checkoutDeps(db, stripeCalls) {
  return {
    json, supabaseAdminFetch:db,
    readJsonWithLimit:async request => ({ data:await request.json() }),
    requireAuthenticatedUser:async () => ({ user:{ id:'u1', email:'jane@example.com' } }),
    stripeMode:() => 'test', stripeConfig:() => ({ secretKey:'sk', publishableKey:'pk' }),
    stripeApi:async (env, mode, path) => { stripeCalls.push(path); return { id:'pi_1', client_secret:'sec' }; },
  };
}
const checkoutReq = items => ({ method:'POST', headers:{ get:() => null }, json:async () => ({ storeId:'s', cycleId:'cyc', items, fulfillment:{ method:'pickup', name:'Jane' } }) });
{
  const { db, skus } = catalogDb({ pendingOrders:[{ id:'pend-1' }] });
  const calls = [];
  let res = await handleFocRequest(checkoutReq([{ skuId:skus[0].id, quantity:4 }]), {}, new URL('https://x/public/preorders/checkout'), checkoutDeps(db, calls));
  assert.equal(res.status, 409, 'a checkout still on the card form holds its copy: 5 − 1 eBay − 1 pending = 3');
  assert.match(res.data.error, /Only 3 copies of Midnight X-Men #1 Cover A left/);
  assert.equal(res.data.left, 3);
  res = await handleFocRequest(checkoutReq([{ skuId:skus[1].id, quantity:1 }]), {}, new URL('https://x/public/preorders/checkout'), checkoutDeps(db, calls));
  assert.equal(res.status, 409);
  assert.match(res.data.error, /sold out -- every copy we ordered is spoken for/);
  assert.equal(calls.length, 0, 'no payment is started for copies that are not there');
  res = await handleFocRequest(checkoutReq([{ skuId:skus[0].id, quantity:3 }]), {}, new URL('https://x/public/preorders/checkout'), checkoutDeps(db, calls));
  assert.equal(res.data.ok, true, JSON.stringify(res.data));
  assert.deepEqual(calls, ['payment_intents']);
}
{
  // Without a cart upload a closed week stays closed.
  const { db, skus } = catalogDb({ handle:async path => path.startsWith('comic_skus?') ? { data:[{ id:'11111111-1111-1111-1111-111111111111', family_id:'fam', cycle_id:'cyc', title:'X', customer_price_cents:499, secured_quantity:0, on_sale_date:later }] } : null });
  const res = await handleFocRequest(checkoutReq([{ skuId:skus[0].id, quantity:1 }]), {}, new URL('https://x/public/preorders/checkout'), checkoutDeps(db, []));
  assert.equal(res.status, 409);
  assert.equal(res.data.error, 'FOC is closed for this cycle');
}
assert.match(service, /if \(!cycle \|\| \(!open && !afterFocCycle\(cycle\)\)\) return deps\.json\(\{ ok:false, error:'FOC is closed for this cycle' \}, 409\);/);

// ── Paid after FOC: shelf count and the eBay listing come down to what's left ──
{
  const cycle = { id:'cyc', store_id:'s', customer_cutoff_at:past, status:'closed' };
  const skus = [{ id:'A', secured_quantity:5, on_sale_date:later }, { id:'T', secured_quantity:2, on_sale_date:later }];
  const patches = [], revised = [];
  const presale = [
    { id:'inv-A', status:'presale', data:{ source:'foc_presale', focCycleId:'cyc', focSkuId:'A', ebayOfferId:'off-A', ebayListingId:'L1', qty:4, quantity:4, focPresaleOriginalQty:4 } },
    { id:'inv-T', status:'presale', data:{ source:'foc_presale', focCycleId:'cyc', focSkuId:'T', ebayApiSystem:'trading', ebayListingId:'L2', ebaySku:'T-1', qty:2, quantity:2, focPresaleOriginalQty:2 } },
  ];
  const db = async (env, path, options = {}) => {
    if (options.method === 'PATCH') { patches.push({ path, body:JSON.parse(options.body) }); return { data:[] }; }
    if (path.startsWith('foc_cycles?')) return { data:[cycle] };
    if (path.startsWith('comic_skus?')) return { data:skus };
    if (path.startsWith('foc_preorder_orders?')) return { data:[{ id:'o1' }] };
    if (path.startsWith('foc_preorder_items?')) return { data:[{ sku_id:'A', quantity:2 }, { sku_id:'T', quantity:1 }] };
    if (path.startsWith('inventory_items?')) return { data:presale };
    return { data:[] };
  };
  presale.push({ id:'inv-ended', status:'presale', data:{ source:'foc_presale', focCycleId:'cyc', focSkuId:'A', ebayOfferId:'off-old', ebayListingId:'L0', ebayWithdrawnAt:'2026-10-06', qty:6, quantity:6, focPresaleOriginalQty:0 } });
  const result = await afterFocPaidSync({}, { supabaseAdminFetch:db, getEbayUserAccessToken:async () => 'tok', ebayReviseOfferQuantity:async (env, token, offerId, qty) => revised.push({ offerId, qty }) }, { cycle_id:'cyc', store_id:'s' }, ['A', 'T']);
  assert.deepEqual(result.storeQuantity, { A:3, T:1 }, 'store_quantity = ordered − website − eBay sold');
  assert.deepEqual(revised, [{ offerId:'off-A', qty:3 }], 'eBay can no longer sell the copy the website just sold -- and an ended listing is never touched');
  const invA = patches.find(p => p.path.startsWith('inventory_items?id=eq.inv-A')).body.data;
  assert.equal(invA.qty, 3);
  assert.equal(invA.focPresaleOriginalQty, 3, 'lowering the listing must not read as an eBay sale');
  assert.match(result.warnings.join(' '), /L2 still lists 2 -- lower it to 1/, 'a Trading listing this caller cannot revise is reported, not silently skipped');
  const open = await afterFocPaidSync({}, { supabaseAdminFetch:async (e, p) => p.startsWith('foc_cycles?') ? { data:[{ ...cycle, status:'open', customer_cutoff_at:future }] } : { data:[] } }, { cycle_id:'cyc' }, ['A']);
  assert.deepEqual(open, { storeQuantity:{}, ebay:[], warnings:[] }, 'orders before the cutoff are untouched -- the cart upload sets those numbers');
}
assert.match(service, /if\(status==='paid'&&paidOrder\)\{\s*try\{\s*const skuIds=/, 'the sync runs on every paid delivery so whichever caller has eBay access finishes it');
assert.match(worker, /syncFocStripeEvent\(env,event,\{supabaseAdminFetch,sendEmail,getEbayUserAccessToken,ebayReviseOfferQuantity\}\)/, 'the webhook can lower REST eBay listings');

// ── The cart upload no longer lets eBay offer copies already sold on the website ──
assert.match(service, /const newAvailable=Math\.max\(0,orderedTotal-alreadySold-Number\(websiteQty\.get\(d\.focSkuId\)\|\|0\)\);/);
assert.match(service, /focPresaleOriginalQty:alreadySold\+newAvailable/);

// ── Cover detail page and dashboard ──
assert.match(service, /const canPreorder = \(cycleOpen\(cycleRow\) \|\| !!sku\.afterFoc\) && sku\.canPreorder;/);
assert.match(service, /'Ordered · ' \+ sku\.afterFocLeft \+ ' left to preorder'/);
assert.match(dashboard, /function focAfterFocHtml\(v\)\{/);
assert.match(dashboard, /focAfterFocHtml\(v\)\+ebaySection\(v\)/);
assert.ok(typeof afterFocAvailability === 'function');

console.log('After-FOC presale (ordered copies, capped at what is left) checks passed');
