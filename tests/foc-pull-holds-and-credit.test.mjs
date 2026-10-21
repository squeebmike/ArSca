import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Store asks: (3) mark short-shipped and damaged copies on receive and get
// the list to send the distributor for credit; (4) pull-list regulars
// subscribe once and each new issue sets a copy aside for them.
const { handleFocRequest, isPullListCover, pullHoldGroups } = await import('../scripts/foc-preorders.mjs');

// ── Which cover a pull-list customer gets ──
assert.equal(isPullListCover({ title:'DNX #4', variant_label:'Cover A' }), true);
assert.equal(isPullListCover({ title:'DNX #4', variant_label:'' }), true);
assert.equal(isPullListCover({ title:'ROBIN HOOD (2026) #1 CVR A JOSHUA MIDDLETON', variant_label:'Joshua Middleton' }), true, 'Lunar: artist-only label, CVR A in the title');
assert.equal(isPullListCover({ title:'ROBIN HOOD (2026) #1 CVR B DAVID NAKAYAMA VAR', variant_label:'Cvr B David Nakayama' }), false);
assert.equal(isPullListCover({ title:'ROBIN HOOD (2026) #1 CVR K INC 1:10 PHIL HESTER VIRGIN VAR', variant_label:'Phil Hester' }), false);
assert.equal(isPullListCover({ title:'DNX #4', variant_label:'Cover A', is_incentive:true }), false);
assert.equal(isPullListCover({ title:'DNX #4', variant_label:'Cover B Variant' }), false);
assert.equal(isPullListCover({ title:'DNX #4', variant_label:'1:25 Ratio' }), false);

// ── Receive sets pull-list copies aside ──
const STORE = '0f9dd4bc-42a7-487e-a972-2905d24513e9', CYCLE = '11111111-1111-4111-8111-111111111111';
const id = c => c.repeat(8) + '-' + c.repeat(4) + '-4' + c.repeat(3) + '-8' + c.repeat(3) + '-' + c.repeat(12);
const A = id('a'), B = id('b'), D = id('d'), E = id('e'), F1 = id('1'), F2 = id('2'), F3 = id('3');
const skus = [
  { id:A, cycle_id:CYCLE, store_id:STORE, family_id:F1, title:'DNX #4', variant_label:'Cover A', msrp_cents:399, customer_price_cents:499 },
  { id:B, cycle_id:CYCLE, store_id:STORE, family_id:F1, title:'DNX #4', variant_label:'Cover B Variant', msrp_cents:499, customer_price_cents:499 },
  { id:D, cycle_id:CYCLE, store_id:STORE, family_id:F2, title:'Other #1', variant_label:'Cover A', msrp_cents:399, customer_price_cents:399 },
  { id:E, cycle_id:CYCLE, store_id:STORE, family_id:F3, title:'Third #2', variant_label:'Cover A', msrp_cents:399, customer_price_cents:399 },
];
const families = [{ id:F1, series_name:'DNX', title:'DNX #4' }, { id:F2, series_name:'', title:'Other #1' }, { id:F3, series_name:'Third', title:'Third #2' }];
const sub = (sid, name, series) => ({ id:id(sid), customer_id:'', customer_name:name, created_at:'2026-01-0' + sid, series:{ title:series } });
const subs = [sub('5', 'Sean Vanoverbeke', 'DNX'), sub('6', 'Dana Ross', 'DNX'), sub('7', 'Lee Park', 'Other'), sub('8', 'Kim Lo', 'Other'), sub('9', 'Pat Moe', 'Third'), { ...sub('9', 'Ray Day', 'Third'), id:id('c') }];
const inserts = [], patches = [], paths = [];
let n = 0;
const deps = {
  readJsonWithLimit: async req => ({ data:await req.json() }),
  requireStoreUser: async () => ({ user:{ id:'staff' } }),
  json: (body, status = 200) => ({ status, body }),
  supabaseAdminFetch: async (env, path, opts = {}) => {
    paths.push(path);
    if (path.startsWith('comic_skus?')) return { data:skus };
    if (path.startsWith('comic_title_families?')) return { data:families };
    if (path.startsWith('pull_list_subscriptions?')) return { data:subs };
    // Kim already had Other #1 held on an earlier receive.
    if (path.includes('pullHold->>familyId')) return { data:[{ hold:{ subscriptionId:id('8'), familyId:F2 } }] };
    if (path === 'inventory_items' && opts.method === 'POST') { const rows = JSON.parse(opts.body); inserts.push(...rows); return { data:rows.map(() => ({ id:'row' + (++n) })) }; }
    if (opts.method === 'PATCH') { patches.push([path, JSON.parse(opts.body)]); return { data:null }; }
    return { data:[] };
  },
};
const post = (path, body) => { const r = new Request('https://w.test' + path, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body) }); return handleFocRequest(r, {}, new URL(r.url), deps); };
const res = await post('/foc/admin/receive', { storeId:STORE, cycleId:CYCLE, lines:[{ skuId:A, receivedQty:3 }, { skuId:B, receivedQty:2 }, { skuId:D, receivedQty:1 }, { skuId:E, receivedQty:1 }] });
assert.equal(res.status, 200, JSON.stringify(res.body));
const pullRows = inserts.filter(r => r.data.pullHold);
assert.deepEqual(pullRows.map(r => [r.data.focSkuId, r.data.pullHold.customerName, r.data.qty, r.data.source, r.data.lifecycle]), [
  [A, 'Sean Vanoverbeke', 1, 'foc_hold', 'hold'], [A, 'Dana Ross', 1, 'foc_hold', 'hold'], [D, 'Lee Park', 1, 'foc_hold', 'hold'], [E, 'Pat Moe', 1, 'foc_hold', 'hold'],
], 'Cover A for each subscriber, oldest first; never the variant; Kim not twice');
assert.equal(pullRows[0].data.pullHold.familyId, F1);
assert.equal(pullRows[0].data.salePrice, 4.99, 'held at the shelf price');
const shelf = Object.fromEntries(inserts.filter(r => r.data.source === 'foc_receive').map(r => [r.data.focSkuId, r.data.qty]));
assert.deepEqual(shelf, { [A]:1, [B]:2 }, 'what is left goes on the shelf; Other #1 and Third #2 all went to pull lists');
const sum = Object.fromEntries(res.body.receivedSummary.map(r => [r.skuId, r]));
assert.equal(sum[A].reservedForPullList, 2);
assert.deepEqual(sum[A].pullHeldFor, ['Sean Vanoverbeke', 'Dana Ross']);
assert.equal(sum[A].availableAsNewStock, 1);
assert.equal(sum[B].reservedForPullList, 0);
assert.ok(res.body.warnings.some(w => /Not enough copies of Third #2 for every pull list: 1 subscriber didn't get one/.test(w)), res.body.warnings.join('|'));
assert.deepEqual(res.body.pullHeld.map(p => [p.name, p.titles]), [['Sean Vanoverbeke', ['DNX #4']], ['Dana Ross', ['DNX #4']], ['Lee Park', ['Other #1']], ['Pat Moe', ['Third #2']]]);
assert.ok(!JSON.stringify(res.body.pullHeld).match(/phone|email/), 'no contact details sent to the screen');
assert.deepEqual(res.body.labelItems.filter(x => /^PULL/.test(x.flag || '')).map(x => x.flag), ['PULL · Sean V.', 'PULL · Dana R.', 'PULL · Lee P.', 'PULL · Pat M.']);

// ON HOLD lists them per subscriber; RING UP / BACK ON SHELF frees them.
const groups = pullHoldGroups([
  { id:'r1', created_at:'2026-10-21', data:{ name:'DNX #4', qty:1, salePrice:4.99, pullHold:{ subscriptionId:'s1', customerName:'Sean', heldAt:'2026-10-21T10:00:00Z' } } },
  { id:'r2', created_at:'2026-10-20', data:{ name:'Other #1', qty:1, priceOverride:3.99, pullHold:{ subscriptionId:'s1', customerName:'Sean', heldAt:'2026-10-20T10:00:00Z' } } },
  { id:'r3', created_at:'2026-10-21', data:{ name:'X', qty:1, preorderHold:{ orderId:'o1' } } },
]);
assert.deepEqual(groups.map(g => [g.subscriptionId, g.customerName, g.heldAt, g.books.map(b => [b.id, b.price])]), [['s1', 'Sean', '2026-10-20T10:00:00Z', [['r1', 4.99], ['r2', 3.99]]]]);
patches.length = 0;
const held = [{ id:'h1', data:{ name:'DNX #4', source:'foc_hold', lifecycle:'hold', qty:1, pullHold:{ subscriptionId:id('5'), familyId:F1 } } }];
deps.supabaseAdminFetch = async (env, path, opts = {}) => { paths.push(path); if (opts.method === 'PATCH') { patches.push([path, JSON.parse(opts.body)]); return { data:null }; } if (path.includes('pullHold->>subscriptionId=eq.')) return { data:held }; return { data:[] }; };
const rel = await post('/foc/admin/holds', { storeId:STORE, pullSubscriptionId:id('5'), how:'rung_up' });
assert.deepEqual([rel.status, rel.body.released, rel.body.how], [200, 1, 'rung_up']);
const p = patches[0][1].data;
assert.deepEqual([p.source, p.lifecycle, p.pullHold.releasedHow, !!p.pullHold.releasedAt, p.pullHold.familyId], ['foc_receive', '', 'rung_up', true, F1], 'regular stock again; the note stays so it is never held twice');
assert.equal((await post('/foc/admin/holds', { storeId:STORE, pullSubscriptionId:'nope' })).status, 400);
const svc = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');
assert.match(svc, /return deps\.json\(\{ok:true,holds:holdGroups\(rows,orders\|\|\[\],items\|\|\[\]\),pullHolds:pullHoldGroups\(rows\)\}\);/);
assert.match(svc, /data->>source=in\.\(foc_hold,foc_receive\)&data->pullHold->>familyId=/, 'released copies still count as held before');
console.log('Pull-list holds on receive checks passed');

// ── Dashboard: damaged / short and the credit request ──
const dash = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
const fn = n => { const s = dash.indexOf('function ' + n + '('); assert.ok(s >= 0, n); return dash.slice(s, dash.indexOf('\n}\n', s) + 2); };
const line = n => { const s = dash.indexOf('function ' + n + '('); assert.ok(s >= 0, n); return dash.slice(s, dash.indexOf('\n', s) + 1); };
const store = new Map();
const ctx = {
  state:{ slip:null }, pickState:{ claim:null, pullHeld:[] }, renders:0,
  localStorage:{ getItem:k => store.get(k) || null, setItem:(k, v) => store.set(k, v) },
  esc:s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
};
vm.runInNewContext([
  ...['slipLineKey', 'slipCycleDistributor', 'slipIncluded', 'slipQty', 'slipDamaged', 'focSlipDamaged', 'slipSavedClaims', 'slipSaveClaim'].map(line),
  ...['slipClaimLines', 'slipClaimText', 'slipClaimCsv', 'slipClaimHtml', 'slipMergePullHeld', 'slipPullHeldHtml'].map(fn),
  'function renderSlip(){this.renders++;}',
  'this.api = { slipQty, slipDamaged, focSlipDamaged, slipClaimLines, slipClaimText, slipClaimCsv, slipSavedClaims, slipSaveClaim, slipClaimHtml, slipMergePullHeld, slipPullHeldHtml };',
].join('\n'), ctx);
const api = ctx.api;
const L = (code, title, qty, cycleId) => ({ code, itemCode:code, title, qty, cover:{ cycleId, title } });
const lines = [L('0826DC0141', 'BATMAN #1 CVR A', 5, 'lunar'), L('0826DC0142', 'BATMAN #1 CVR B', 3, 'lunar'), L('0826DC0143', 'SUPERMAN #2', 2, 'lunar'), L('0826DC0144', 'FLASH #3', 4, 'lunar')];
ctx.state.slip = { lines, picks:{}, qtys:{}, prices:{}, typed:{}, damaged:{}, cycles:[{ id:'lunar', distributor:'Lunar' }], invoice:'INV-77' };
api.focSlipDamaged('0826DC0141', '1');
assert.equal(api.slipQty(lines[0]), 4, 'a damaged copy comes off RECEIVED');
ctx.state.slip.qtys['0826DC0142'] = 2;        // one never came
ctx.state.slip.picks['0826DC0144'] = false;  // not received here
const claim = { id:'c1', at:'2026-10-21T19:00:00Z', invoice:'INV-77', lines:api.slipClaimLines(ctx.state.slip) };
assert.deepEqual([...claim.lines].map(c => [c.code, c.invoiced, c.received, c.short, c.damaged, c.distributor]), [['0826DC0141', 5, 4, 0, 1, 'Lunar'], ['0826DC0142', 3, 2, 1, 0, 'Lunar']]);
assert.equal(api.slipClaimText(claim), 'Lunar credit request -- invoice / delivery INV-77 -- received 2026-10-21\n0826DC0141  BATMAN #1 CVR A  -- invoiced 5, received 4, 1 damaged\n0826DC0142  BATMAN #1 CVR B  -- invoiced 3, received 2, 1 short');
assert.equal(api.slipClaimCsv(claim), 'Distributor,Invoice,Item code,Title,Invoiced,Received,Short,Damaged\nLunar,INV-77,0826DC0141,BATMAN #1 CVR A,5,4,0,1\nLunar,INV-77,0826DC0142,BATMAN #1 CVR B,3,2,1,0\n');
assert.match(api.slipClaimCsv({ invoice:'', lines:[{ distributor:'PRH', code:'1', title:'A "B", C', invoiced:1, received:0, short:1, damaged:0 }] }), /,"A ""B"", C",/);
api.slipSaveClaim(claim); api.slipSaveClaim({ ...claim, id:'c2' }); api.slipSaveClaim(claim);
assert.deepEqual([...api.slipSavedClaims().map(c => c.id)], ['c1', 'c2'], 'kept on this device, newest first, once each');
const html = api.slipClaimHtml(claim, true);
assert.match(html, /CREDIT REQUEST · INV-77 · 2026-10-21 · 1 short · 1 damaged/);
assert.match(html, /onclick="focCopyClaim\('c1'\)">📋 COPY FOR EMAIL/);
assert.equal(api.slipClaimHtml({ lines:[] }), '');
// Slip line: DAMAGED box and a credit-request chip.
const slipLine = fn('slipLineHtml');
assert.match(slipLine, /DAMAGED<input class="tsi" type="number" min="0"[^>]*onchange="focSlipDamaged\(/);
assert.match(slipLine, /credit request: /);
const confirmFn = fn('confirmSlipReceive');
assert.match(confirmFn, /var claimLines=slipClaimLines\(s\);/, 'counted before receiving marks the lines received');
assert.match(confirmFn, /claim\.lines=claim\.lines\.filter\(function\(c\)\{return okIds\.indexOf\(c\.cycleId\)>=0;\}\);if\(claim\.lines\.length\)slipSaveClaim\(claim\);else claim=null;/);
assert.match(fn('renderSlipReceived'), /slipClaimHtml\(pickState\.claim,true\)/);
assert.match(fn('renderSlip'), /CREDIT REQUESTS FROM RECENT SHIPMENTS/);

// Received screen: pull lists set aside, with a text button.
const merged = api.slipMergePullHeld([{ subscriptionId:'s1', name:'Sean', titles:['DNX #4'] }, { subscriptionId:'s2', name:'Dana', titles:['DNX #4'] }, { subscriptionId:'s1', name:'Sean', titles:['Other #1'] }]);
assert.deepEqual([...merged].map(p => [p.name, [...p.titles]]), [['Sean', ['DNX #4', 'Other #1']], ['Dana', ['DNX #4']]]);
let ph = api.slipPullHeldHtml(merged);
assert.match(ph, /PULL LISTS SET ASIDE \(2\)/);
assert.match(ph, /📱 TEXT 2 PULL-LIST CUSTOMERS/);
merged[0].result = { sms:true, email:false, errors:[] }; merged[1].result = { sms:false, email:false, errors:[] };
ph = api.slipPullHeldHtml(merged);
assert.match(ph, /Sean[\s\S]*✓ texted/);
assert.match(ph, /Dana[\s\S]*✗ not reached -- no phone or email on file/);
assert.doesNotMatch(ph, /📱 TEXT/, 'everyone tried: no button');
assert.match(confirmFn, /pullAll=pullAll\.concat\(d\.pullHeld\|\|\[\]\);/);
assert.match(fn('focTextPullHeld'), /api\('\/foc\/admin\/notify-arrivals'/);
// ON HOLD and the register.
assert.match(fn('renderFocHolds'), /🛒 RING UP<\/button>/);
assert.match(fn('focPullRelease'), /pullSubscriptionId:subscriptionId,how:how/);
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
assert.equal((app.match(/pull list -- FOC → 📌 ON HOLD → RING UP, then scan it/g) || []).length, 2, 'quick sell and the cart both say how to ring it up');
console.log('Packing slip credit request and pull-list screen checks passed');
