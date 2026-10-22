import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Store asks: (1) one email before each FOC cutoff; (2) eBay returns and
// partial refunds after shipping come off sales and profit (a return puts
// the copy back); (4) a weekly check of our live eBay prices vs other
// sellers -- flag only.
const svcMod = await import('../scripts/foc-preorders.mjs');
const { priceWatchFlag, focDigestEmail, pullListNeeds, coverMarketQuery, summarizeCoverMarket, isPullListCover, coverMarketListings } = svcMod;
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const dash = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
const grab = (src, n) => { let s = src.indexOf('function ' + n + '('); assert.ok(s >= 0, n); if (src.slice(s - 6, s) === 'async ') s -= 6; const one = src.slice(s, src.indexOf('\n', s)); if (/\}\s*$/.test(one) && (one.match(/\{/g) || []).length === (one.match(/\}/g) || []).length) return one + '\n'; return src.slice(s, src.indexOf('\n}\n', s) + 3); };
const kv = () => { const m = new Map(); return { m, get:async (k, t) => (m.has(k) ? (t === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null), put:async (k, v) => m.set(k, v) }; };

// ── (4) Price watch ──
assert.deepEqual(priceWatchFlag(3.99, { median:8, count:5 }), { flag:'under', ratio:0.5 });
assert.deepEqual(priceWatchFlag(19.99, { median:10, count:3 }), { flag:'over', ratio:2 });
assert.deepEqual(priceWatchFlag(9, { median:10, count:3 }), { flag:'', ratio:0.9 });
assert.equal(priceWatchFlag(3, { median:10, count:1 }).flag, '', 'one other seller is not a market');
assert.equal(priceWatchFlag(0, { median:10, count:5 }).flag, '');
{
  const env = { LBA_KV:kv() }, searched = [];
  const rows = [
    { id:'r1', data:{ focSkuId:'11111111-1111-4111-8111-111111111111', name:'Robin Hood #1 Cvr B Nakayama - PRESALE', salePrice:4.99, ebayListingId:'111' } },
    { id:'r2', data:{ focSkuId:'22222222-2222-4222-8222-222222222222', name:'DNX #4 - PRESALE', salePrice:4.99, ebayListingId:'222' } },
  ];
  env.LBA_KV.m.set('foc-price-watch:S', JSON.stringify({ items:{ gone:{ rowId:'gone', flag:'under', checkedAt:'2026-10-01' }, r2:{ rowId:'r2', checkedAt:'2026-10-20T00:00:00Z' } } }));
  const c = {
    coverMarketQuery, summarizeCoverMarket, priceWatchFlag, isPullListCover, coverMarketListings, fetchEbayItemGroup:async () => ({ listings:[] }),
    supabaseAdminFetch:async (e, path) => {
      if (path.startsWith('comic_skus?')) return { data:[{ id:'11111111-1111-4111-8111-111111111111', title:'Robin Hood #1', variant_label:'Cvr B David Nakayama', cover_artist:'David Nakayama', family_id:'F1' }, { id:'22222222-2222-4222-8222-222222222222', title:'DNX #4', variant_label:'Cover A', family_id:'F2' }] };
      if (path.startsWith('comic_title_families?')) return { data:[{ id:'F1', title:'Robin Hood #1', series_name:'Robin Hood', issue_number:'1' }, { id:'F2', title:'DNX #4', series_name:'DNX', issue_number:'4' }] };
      return { data:[] };
    },
    fetchEbayActiveListings:async (e, q) => { searched.push(q); return { listings:q.includes('Nakayama') ? [9.99, 10.5, 11].map((p, i) => ({ itemId:'v1|9' + i + '|0', title:'Robin Hood #1 Cover B Nakayama', price:p })).concat([{ itemId:'v1|111|0', title:'Robin Hood #1 Cover B Nakayama', price:4.99 }]) : [] }; },
  };
  vm.runInNewContext(worker.match(/const FOC_PRICE_WATCH_KV = [^\n]+/)[0] + '\n' + worker.match(/const FOC_PRICE_WATCH_PER_RUN = \d+;/)[0] + '\n' + grab(worker, 'loadFocPriceWatch') + grab(worker, 'runFocPriceWatchForStore') + 'this.run=runFocPriceWatchForStore;', c);
  const out = await c.run(env, 'S', rows, { limit:1, now:'2026-10-21T12:00:00Z' });
  assert.deepEqual({ ...out }, { checked:1, live:2, flagged:1 });
  assert.deepEqual(searched, ['Robin Hood #1 Nakayama', 'Robin Hood #1'], 'a few per run, oldest-checked first (a variant also searched by issue, for multi-cover listings)');
  assert.match(searched[0], /Robin Hood #1 Nakayama/);
  const rep = JSON.parse(env.LBA_KV.m.get('foc-price-watch:S'));
  assert.ok(!rep.items.gone, 'listings no longer live drop off');
  assert.deepEqual([rep.items.r1.flag, rep.items.r1.ours, rep.items.r1.median, rep.items.r1.count, rep.items.r1.listingId, rep.items.r1.name], ['under', 4.99, 10.5, 3, '111', 'Robin Hood #1 Cvr B Nakayama'], 'ours is never counted as another seller');
}
assert.match(worker, /const FOC_PRICE_WATCH_PER_RUN = 12;/);
assert.match(worker, /if \(url\.pathname === '\/foc\/ebay\/price-watch' && request\.method === 'GET'\) return handleFocPriceWatchRoute\(request, env, url\);/);
assert.match(grab(worker, 'handleFocPriceWatchRoute'), /requireStoreUser\(request, env, storeId, \['owner','admin','manager'\]\)/);
assert.doesNotMatch(grab(worker, 'runFocPriceWatchForStore'), /ReviseFixedPriceItem|PATCH|reviseEbay/, 'flags only, never changes a price');
{
  const c = { esc:s => String(s ?? '').replace(/</g, '&lt;'), displayDate:d => d, focEbaySearchUrl:q => 'https://ebay/s?' + q };
  vm.runInNewContext(grab(dash, 'focPriceWatchHtml') + 'this.h=focPriceWatchHtml;', c);
  const h = c.h({ at:'2026-10-21', live:40, checked:12, items:[{ name:'Robin Hood #1 Cvr B', ours:4.99, median:10.5, low:9.99, count:3, flag:'under', ratio:0.48, listingId:'111', query:'Robin Hood #1 Nakayama', checkedAt:'2026-10-21' }, { name:'DNX #4', ours:4.99, median:4.99, count:3, flag:'', ratio:1 }] });
  assert.match(h, /UNDER 48%/);
  assert.match(h, /href="https:\/\/www\.ebay\.com\/itm\/111"/);
  assert.match(h, /12 of 40 live listings checked so far/);
  assert.match(h, /CLOSE TO MARKET \(1\)/);
  assert.match(dash, /onclick="openFocPriceWatch\(\)">💲 PRICE WATCH<\/button>/);
}

// ── (1) FOC email ──
{
  const mail = focDigestEmail({ cycle:{ distributor:'Lunar', foc_date:'2026-10-26' }, today:'2026-10-23',
    pullShort:[{ title:'DNX #5', coverLabel:'Cover A', subscribers:3, store:2, ebay:1, short:2 }], needPrice:['Robin Hood #2 · 1:25'], noArt:['Robin Hood #2 · Cvr C'],
    notOnEbay:7, queued:5, queue:{ waiting:5, next:'2026-10-30' }, activity:['Auto-listed on eBay: DNX #4'], priceFlags:[{ name:'Robin Hood #1 Cvr B', ours:4.99, median:10.5, count:3, flag:'under' }] });
  assert.equal(mail.subject, 'Lunar FOC 2026-10-26 (in 3 days): 2 things to do · 1 price flag');
  for (const line of ['Lunar FOC 2026-10-26 -- in 3 days.', 'PULL LISTS SHORT (1) -- order more before FOC:', '- DNX #5 Cover A: 3 on pull list, ordering 2 (1 sold on eBay) -> 2 short', 'NEEDS YOUR PRICE (1):', '- Robin Hood #2 · 1:25', 'NO COVER ART YET (1)', 'eBay: 7 ordered covers not listed yet, 5 of them queued to list themselves.', 'Auto-list queue: 5 waiting, next on 2026-10-30.', 'SINCE THE LAST EMAIL:', '- Auto-listed on eBay: DNX #4', '- Robin Hood #1 Cvr B: ours $4.99, others ~$10.50 (3) -- under market'])
    assert.ok(mail.body.includes(line), line);
  assert.match(focDigestEmail({ cycle:{ foc_date:'2026-10-26' }, today:'2026-10-26' }).subject, /^PRH FOC 2026-10-26 \(today\): ready$/);
}
{
  const env = { LBA_KV:kv() };
  env.LBA_KV.m.set('foc-activity:S', JSON.stringify([{ at:'2026-10-10T00:00:00Z', text:'old' }, { at:'2026-10-22T00:00:00Z', text:'Cover art swapped in on eBay: Robin Hood #2' }]));
  env.LBA_KV.m.set('foc-digest-last:S', '2026-10-15T00:00:00Z');
  const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const c = {
    pullListNeeds, focDigestEmail, FOC_AUTOLIST_DEFAULT_EMAIL:'hintline@themanapocket.com',
    supabaseAdminFetch:async (e, path) => {
      if (path.startsWith('comic_skus?')) return { data:[
        { id:A, family_id:'F', title:'DNX #5', variant_label:'Cover A', store_quantity:2, msrp_cents:399, customer_price_cents:499, cover_image_url:'x' },
        { id:B, family_id:'F', title:'DNX #5', variant_label:'1:25 Ratio', is_incentive:true, store_quantity:0, secured_quantity:1, msrp_cents:399, customer_price_cents:0, cover_image_url:'' },
        { id:C, family_id:'F', title:'DNX #5', variant_label:'Cover C', store_quantity:0, msrp_cents:399 } ] };
      if (path.startsWith('comic_title_families?')) return { data:[{ id:'F', title:'DNX #5', series_name:'DNX' }] };
      if (path.startsWith('pull_list_subscriptions?')) return { data:[{ customer_name:'Sean', series:{ title:'DNX' } }, { customer_name:'Dana', series:{ title:'DNX' } }] };
      if (path.startsWith('inventory_items?')) return { data:[{ status:'presale', data:{ focSkuId:A, focPresaleOriginalQty:3, qty:2, ebayListingId:'1' } }] };
      return { data:[] };
    },
  };
  vm.runInNewContext([worker.match(/const FOC_ACTIVITY_KV = [^\n]+/)[0], worker.match(/const FOC_PRICE_WATCH_KV = [^\n]+/)[0], 'async function loadFocAutoList(){return {email:"hintline@themanapocket.com",items:[{skuIds:["' + B + '"],eligibleDate:"2026-10-30"}]};}', grab(worker, 'loadFocPriceWatch'), grab(worker, 'buildFocDigest'), 'this.b=buildFocDigest;'].join('\n'), c);
  const mail = await c.b(env, { id:'cy', store_id:'S', foc_date:'2026-10-26', distributor:'Lunar' }, '2026-10-23');
  assert.match(mail.body, /- DNX #5 Cover A: 2 on pull list, ordering 2 \(1 sold on eBay\) -> 1 short/);
  assert.match(mail.body, /NEEDS YOUR PRICE \(1\):\n- DNX #5 · 1:25 Ratio/);
  assert.match(mail.body, /NO COVER ART YET \(1\)/);
  assert.match(mail.body, /eBay: 1 ordered cover not listed yet, 1 of them queued to list themselves\./, 'Cover C is not ordered');
  assert.match(mail.body, /SINCE THE LAST EMAIL:\n- Cover art swapped in on eBay: Robin Hood #2\n/);
  assert.doesNotMatch(mail.body, /- old/);
}
assert.match(worker, /const until = new Date\(Date\.parse\(today \+ 'T00:00:00Z'\) \+ 3 \* 86400000\)/, 'three days before FOC');
assert.match(grab(worker, 'runScheduledFocDigest'), /const sentKey = 'foc-digest-sent:' \+ cycle\.id;\n    try \{ if \(await env\.LBA_KV\.get\(sentKey\)\) continue; \}/, 'once per FOC week');
assert.match(grab(worker, 'runScheduledFocDigest'), /sendEmail\(env, queue\.email \|\| FOC_AUTOLIST_DEFAULT_EMAIL, mail\.subject, mail\.body\)/);
assert.match(worker, /try \{ await runScheduledFocPriceWatch\(env\); \} catch[^\n]*\n  try \{ await runScheduledFocDigest\(env\); \} catch/);
assert.match(worker, /await focLogActivity\(env, storeId, \[\.\.\.listed\.map\(l => 'Auto-listed on eBay: ' \+ l\)/);
assert.match(worker, /await focLogActivity\(env, r\.store_id, \['Cover art swapped in on eBay: '/);

// ── (2) eBay refunds and returns ──
{
  const calls = [], restocks = [];
  const order = (id, status, refunds, fulfilled = 'FULFILLED') => ({ orderId:id, orderPaymentStatus:status, orderFulfillmentStatus:fulfilled, paymentSummary:{ refunds } });
  const orders = [
    order('O-PART', 'PARTIALLY_REFUNDED', [{ refundId:'R1', amount:{ value:'3.00' }, refundStatus:'REFUNDED', refundDate:'2026-10-20T00:00:00Z' }]),
    order('O-RET', 'FULLY_REFUNDED', [{ refundId:'R2', amount:{ value:'29.99' }, refundStatus:'REFUNDED' }]),
    order('O-FULL', 'FULLY_REFUNDED', [{ refundId:'R3', amount:{ value:'10.00' }, refundStatus:'REFUNDED' }]),
    order('O-CANCEL', 'FULLY_REFUNDED', [{ refundId:'R4', amount:{ value:'5.00' } }], 'NOT_STARTED'),
    order('O-PAID', 'PAID', []),
    order('O-AGAIN', 'PARTIALLY_REFUNDED', [{ refundId:'R5', amount:{ value:'2.00' } }]),
  ];
  const sales = { 'O-PART':{ id:'S1', status:'completed', total:'20.00', refund_total_cents:0 }, 'O-RET':{ id:'S2', status:'completed', total:'29.99' }, 'O-FULL':{ id:'S3', status:'completed', total:'10.00' }, 'O-AGAIN':{ id:'S5', status:'completed', total:'8.00', refund_total_cents:200 } };
  const c = {
    crypto, URLSearchParams,
    fetchAllEbayOrders:async () => ({ orders }),
    fetch:async (u) => ({ ok:true, json:async () => ({ members:[{ orderId:'O-RET', state:'ITEM_DELIVERED' }, { orderId:'O-FULL', state:'RETURN_REQUESTED' }] }) }),
    restockVoidedSaleLines:async (e, a) => { restocks.push(a.saleId); return 1; },
    supabaseAdminFetch:async (e, path, o = {}) => {
      calls.push([o.method || 'GET', path, o.body ? JSON.parse(o.body) : null]);
      const ref = (path.match(/reference=eq\.([^&]+)/) || [])[1];
      if (path.startsWith('pos_payments?') && !o.method) return { data:sales[decodeURIComponent(ref)] ? [{ id:'P-' + decodeURIComponent(ref), sale_id:sales[decodeURIComponent(ref)].id, amount:sales[decodeURIComponent(ref)].total }] : [] };
      if (path.startsWith('pos_sales?') && !o.method) { const sid = path.match(/id=eq\.([^&]+)/)[1]; return { data:Object.values(sales).filter(x => x.id === sid) }; }
      if (path.startsWith('pos_sales?') && o.method === 'PATCH' && JSON.parse(o.body).status === 'voided') return { data:[{ id:'S2', total:'29.99' }] };
      if (path.startsWith('pos_sale_lines?')) return { data:[{ id:'L', item_id:'I', quantity:1, title:'Infernal Hulk 1:25' }] };
      if (path.startsWith('pos_refunds?on_conflict=idempotency_key')) { const row = JSON.parse(o.body)[0]; return { data:row.idempotency_key === 'ebay-refund:R5' ? [] : [row] }; }
      return { data:null };
    },
  };
  vm.runInNewContext([grab(worker, 'ebayOrderIsCancelled'), grab(worker, 'ebayOrderRefunds'), grab(worker, 'ebayReturnIsBack'), grab(worker, 'recordEbayRefunds'), 'this.r=recordEbayRefunds;'].join('\n'), c);
  const out = await c.r({}, 'ST', 'tok', 'u1');
  assert.equal(JSON.stringify(out.map(x => [x.orderId, x.kind, x.cents])), JSON.stringify([['O-PART', 'partial', 300], ['O-RET', 'returned', 2999], ['O-FULL', 'refunded', 1000]]), 'a refund already recorded (R5) is never counted twice; a cancelled unshipped order is the cancellation sweep\'s');
  assert.equal(JSON.stringify(restocks), JSON.stringify(['S2']), 'only the return eBay shows delivered back is restocked');
  const ins = calls.filter(x => x[1].startsWith('pos_refunds?')).map(x => x[2][0]);
  assert.deepEqual(ins.map(r => [r.idempotency_key, r.amount_cents, r.provider, r.restock_mode, r.stripe_mode]), [['ebay-refund:R1', 300, 'ebay', 'none', 'live'], ['ebay-refund:R3', 1000, 'ebay', 'none', 'live'], ['ebay-refund:R5', 200, 'ebay', 'none', 'live']]);
  const salePatch = sid => calls.filter(x => x[0] === 'PATCH' && x[1].startsWith('pos_sales?id=eq.' + sid)).map(x => x[2]);
  assert.equal(JSON.stringify(salePatch('S1')), JSON.stringify([{ payment_status:'partially_refunded', refund_total_cents:300, refundable_remaining_cents:1700 }]));
  assert.equal(JSON.stringify(salePatch('S3')), JSON.stringify([{ payment_status:'refunded', refund_total_cents:1000, refundable_remaining_cents:0 }]), 'full refund, book not back: money comes off, no restock');
  assert.equal(JSON.stringify(salePatch('S2')), JSON.stringify([{ status:'voided' }]));
  assert.equal(salePatch('S5').length, 0, 'nothing new');
}
assert.match(worker, /try \{ refunds = await recordEbayRefunds\(env, storeId, ebayToken, confirmedBy\); \}/);
assert.match(worker, /return \{ ok: true, checked: orders\.length, matched: matchedCount, recorded: results\.length, results, linked, errors, cancelled, refunds \};/);
// Profit counts refunds (eBay and Stripe): spread over the sale's lines.
{
  const fn = app.slice(app.indexOf('async function loadLedgerSoldRows('), app.indexOf('function markLedgerSoldRowsStale('));
  assert.match(fn, /select\('id,completed_at,created_at,refund_total_cents,pos_sale_lines/);
  const rows = await new Function('getSupabaseClient', 'getActiveStoreId', 'getAccountContext', 'all', 'canonicalSaleCategory', fn + '\nreturn loadLedgerSoldRows;')(
    () => ({ from:() => ({ select() { return this; }, eq() { return this; }, in() { return this; }, order() { return this; }, limit:async () => ({ data:[{ id:'S1', completed_at:'2026-10-01', refund_total_cents:300, pos_sale_lines:[{ id:'a', title:'A', quantity:1, adjusted_price:15, profit:7.5 }, { id:'b', title:'B', quantity:1, adjusted_price:5, profit:2.5 }], pos_payments:[{ method:'ebay' }] }] }) }) }),
    () => 'st', () => ({}), [], c => c || 'Comic')();
  assert.equal(JSON.stringify(rows.map(r => [r.name, r.salePrice, r.profit])), JSON.stringify([['A', 12.75, 5.25], ['B', 4.25, 1.75]]), '$3 refund split $2.25 / $0.75');
}
assert.match(app, /const refunds = Array\.isArray\(data\.refunds\) \? data\.refunds : \[\];/);
assert.match(app, /partly refunded \$' \+ refundedAmt\.toFixed\(2\)/);
assert.match(app, /Refunded in full without the book coming back: taken out of sales, and its cost counts as a loss\./);
console.log('FOC email, price watch and eBay refund checks passed');

// Store ask: "the comics I list individually default to 8 oz shipping."
assert.match(worker, /const COMIC_SINGLE_PACKED_LB = 0\.5;/);
assert.match(worker, /: \{ weightValue: COMIC_SINGLE_PACKED_LB, weightUnit: 'POUND' \};/, 'FOC single-cover listings');
assert.match(worker, /if \(!\(Number\(out\.weightValue\) > 0\.1\)\) Object\.assign\(out, \{ weightValue: COMIC_SINGLE_PACKED_LB, weightUnit: 'POUND' \}\);/, 'any comic listing sent without a real weight');
assert.match(app, /const weightVal = \(liveOk && live\.item\?\.weightValue\) \|\| \(isComic \? 0\.5 : isSealed \? 1 : 0\.1\);/, 'the inventory eBay listing screen');
console.log('8 oz single comic default checks passed');
