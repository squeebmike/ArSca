import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';

// Store asks: "Do the 8 oz. Variant covers depend on the ratio, i.e. 1 of
// the 100, 2 of the 50, 4 of the 25 etc. Email me when the too early ones
// get listed. hintline@themanapocket.com"
const dash = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const grab = (src, n) => { let s = src.indexOf('function ' + n + '('); assert.ok(s >= 0, n); if (src.slice(s - 6, s) === 'async ') s -= 6; const oneLine = src.slice(s, src.indexOf('\n', s)); if (/\}\s*$/.test(oneLine) && (oneLine.match(/\{/g) || []).length === (oneLine.match(/\}/g) || []).length) return oneLine + '\n'; return src.slice(s, src.indexOf('\n}\n', s) + 3); };

// ── Ratio quantities ──
{
  const ctx = {};
  vm.runInNewContext(grab(dash, 'focRatioOf') + grab(dash, 'focRatioQty') + 'this.q=focRatioQty;', ctx);
  const q = v => ctx.q(v);
  assert.equal(q({ isIncentive:true, ratioThreshold:100 }), 1);
  assert.equal(q({ isIncentive:true, ratioThreshold:50 }), 2);
  assert.equal(q({ isIncentive:true, ratioThreshold:25 }), 4);
  assert.equal(q({ isIncentive:true, ratioThreshold:20 }), 5);
  assert.equal(q({ isIncentive:true, ratioThreshold:15 }), 6);
  assert.equal(q({ isIncentive:true, ratioThreshold:10 }), 10);
  assert.equal(q({ isIncentive:true, ratioThreshold:5 }), 10, 'never more than 10');
  assert.equal(q({ isIncentive:true, ratioThreshold:250 }), 1, 'at least 1');
  assert.equal(q({ isIncentive:true, variantLabel:'Cvr K 1:25 Phil Hester Virgin' }), 4, 'ratio read from the cover name');
  assert.equal(q({ isIncentive:true, ratioThreshold:25, securedQuantity:1 }), 1, 'never more than secured');
  assert.equal(q({ isIncentive:true, ratioThreshold:25, storeQuantity:2 }), 2, 'or ordered');
  assert.equal(q({ variantLabel:'Cover A' }), 10, 'regular covers unchanged');
  assert.match(dash, /function focDefaultEbayQty\(skuId\)\{var v=allFocSkus\(\)\.find\(function\(x\)\{return x\.id===skuId;\}\);return focRatioQty\(v\);\}/, 'the review screens use it too');
}
// 8 oz.
assert.match(dash, /function focSingleWeightOz\(\)\{[^\n]*return 8; \}/);

// ── Building a too-early listing to post later ──
{
  const { document } = parseHTML('<!doctype html><html><body></body></html>');
  const ctx = { document, focEbayCapture:null, sent:[] };
  vm.runInNewContext(grab(dash, 'focListWeekOne') + 'this.one=focListWeekOne;', ctx);
  ctx.openEbayPresaleReview = async (id, opts) => { ctx.draft = opts.draft; document.body.insertAdjacentHTML('beforeend', '<div id="foc-ebay-review-modal"><input id="foc-eb-title"><input id="foc-eb-qty" value="10"><input id="foc-eb-weight"><select id="foc-eb-weight-unit"><option value="POUND">LB</option><option value="OUNCE">OZ</option></select><div id="foc-eb-status"></div></div>'); };
  // Stands in for submitEbayPresaleReview: builds the payload, then keeps it when capturing.
  ctx.submitEbayPresaleReview = async id => {
    const payload = { skuId:id, quantity:Number(document.getElementById('foc-eb-qty').value), weightValue:Number(document.getElementById('foc-eb-weight').value), weightUnit:document.getElementById('foc-eb-weight-unit').value };
    if (ctx.focEbayCapture) { ctx.focEbayCapture.payload = payload; document.getElementById('foc-ebay-review-modal').remove(); return; }
    ctx.sent.push(payload); document.getElementById('foc-ebay-review-modal').remove();
  };
  const r = await ctx.one('single', 's1', ['s1'], 8, { s1:4 }, 'queue');
  assert.equal(ctx.draft, true, 'preview allowed before the eBay date');
  assert.deepEqual({ ...r.payload }, { skuId:'s1', quantity:4, weightValue:8, weightUnit:'OUNCE' });
  assert.equal(ctx.sent.length, 0, 'nothing published now');
  assert.equal(ctx.focEbayCapture, null);
  await ctx.one('single', 's2', ['s2'], 8, {}, 'list');
  assert.equal(ctx.draft, false);
  assert.equal(ctx.sent.length, 1);
}
assert.match(dash, /if\(focEbayCapture\)\{focEbayCapture\.payload=payload;var cm=document\.getElementById\('foc-ebay-review-modal'\);if\(cm\)cm\.remove\(\);return;\}\n  try\{\n    var result=await api\('\/foc\/ebay\/create-presale'/);
assert.match(dash, /if\(focEbayCapture\)\{focEbayCapture\.payload=payload;var cgm=document\.getElementById\('foc-ebay-group-modal'\);if\(cgm\)cgm\.remove\(\);return;\}\n  try\{\n    var result=await api\('\/foc\/ebay\/create-presale-group'/);
assert.match(dash, /quantity:1,draft:!!\(opts&&opts\.draft\)\}\)/);
assert.match(dash, /familyId:familyId,draft:!!\(opts&&opts\.draft\)\}\)/);
assert.match(grab(dash, 'focListWeekRun'), /api\('\/foc\/ebay\/auto-list',\{method:'POST',headers:\{'Content-Type':'application\/json'\},body:JSON\.stringify\(\{storeId:getActiveStoreId\(\),email:email,items:queued\}\)\}\)/);
assert.match(dash, /localStorage\.getItem\('foc_autolist_email'\)\|\|'hintline@themanapocket\.com'/);
// Server: preview only skips the date check when asked; publishing never does.
assert.match(worker, /if \(new Date\(\) < eligibleDate && !\(isPreview && body\.draft === true\)\) \{/);
assert.match(worker, /if \(now < eligibleDate && !\(isPreview && body\.draft === true\)\) reason = `Too early/);

// ── The queue and the 6-hour run ──
const STORE = '0f9dd4bc-42a7-487e-a972-2905d24513e9';
const U = c => c.repeat(8) + '-' + c.repeat(4) + '-4' + c.repeat(3) + '-8' + c.repeat(3) + '-' + c.repeat(12);
const kvMem = new Map();
const env = { SUPABASE_URL:'x', SUPABASE_SERVICE_ROLE_KEY:'y', LBA_KV:{ get:async (k, t) => (kvMem.has(k) ? (t === 'json' ? JSON.parse(kvMem.get(k)) : kvMem.get(k)) : null), put:async (k, v) => kvMem.set(k, v) } };
const w = { env, routed:[], mails:[], live:new Set(), art:{}, sale:{}, respond:null };
const wctx = {
  Request, LUNAR_COVER_ORIGIN:'https://still-resonance-4f87.swarnerauto.workers.dev',
  json:(body, status = 200) => new Response(JSON.stringify(body), { status, headers:{ 'Content-Type':'application/json' } }),
  requestStoreId:r => r.headers.get('X-Store-Id'),
  requireStoreUser:async (r) => (wctx.FOC_INTERNAL_REQUESTS.has(r) || r.headers.get('Authorization') ? { user:{} } : { error:wctx.json({ ok:false }, 401) }),
  supabaseAdminFetch:async (e, path) => {
    if (path.startsWith('inventory_items?')) return { data:[...w.live].some(id => path.includes(id)) ? [{ id:'row' }] : [] };
    if (path.startsWith('comic_skus?')) { const ids = path.match(/id=in\.\(([^)]*)\)/)[1].split(','); return { data:ids.map(id => ({ id, cover_image_url:w.art[id] === false ? '' : 'https://img', on_sale_date:w.sale[id] || '2026-12-01' })) }; }
    return { data:[] };
  },
  routeRequest:async (req) => { w.routed.push([new URL(req.url).pathname, JSON.parse(await req.clone().text()), wctx.FOC_INTERNAL_REQUESTS.has(req)]); return w.respond(req); },
  sendEmail:async (e, to, subject, body) => w.mails.push({ to, subject, body }),
};
vm.runInNewContext([
  worker.match(/const FOC_INTERNAL_REQUESTS = new WeakSet\(\);[\s\S]*?const FOC_AUTOLIST_DEFAULT_EMAIL = [^\n]+/)[0],
  worker.match(/const FOC_ACTIVITY_KV = [^\n]+/)[0], grab(worker, 'focLogActivity'),
  ...['loadFocAutoList', 'saveFocAutoList', 'cleanFocAutoListItem', 'handleFocAutoListRoute', 'pacificToday', 'focAutoListEmail', 'runFocAutoListForStore', 'runScheduledFocAutoList'].map(n => grab(worker, n)),
  worker.match(/const focAutoListSummary = [^\n]+/)[0],
  'this.api={cleanFocAutoListItem,handleFocAutoListRoute,runFocAutoListForStore,runScheduledFocAutoList,focAutoListEmail,FOC_INTERNAL_REQUESTS};',
].join('\n'), wctx);
wctx.FOC_INTERNAL_REQUESTS = wctx.api.FOC_INTERNAL_REQUESTS;
const A = wctx.api;
// Bad items are dropped; the store id in the payload is always the store's.
assert.equal(A.cleanFocAutoListItem({ kind:'single', skuIds:['nope'], eligibleDate:'2026-11-01', payload:{} }, STORE), null);
assert.equal(A.cleanFocAutoListItem({ kind:'group', skuIds:[U('a')], familyId:U('f'), eligibleDate:'2026-11-01', payload:{} }, STORE), null, 'an issue needs 2 covers');
assert.equal(A.cleanFocAutoListItem({ kind:'single', skuIds:[U('a')], eligibleDate:'soon', payload:{} }, STORE), null);
assert.equal(A.cleanFocAutoListItem({ kind:'single', skuIds:[U('a')], eligibleDate:'2026-11-01', payload:{ storeId:'other' } }, STORE).payload.storeId, STORE);
const route = (method, body, signedIn = true) => A.handleFocAutoListRoute(new Request('https://w/foc/ebay/auto-list?store_id=' + STORE, { method, headers:{ 'X-Store-Id':STORE, 'Content-Type':'application/json', ...(signedIn ? { Authorization:'Bearer t' } : {}) }, body:body ? JSON.stringify(body) : undefined }), env, new URL('https://w/foc/ebay/auto-list'));
assert.equal((await route('GET', null, false)).status, 401);
assert.deepEqual(await (await route('GET')).json(), { ok:true, email:'hintline@themanapocket.com', items:[] }, 'emails hintline@ unless changed');
const items = [
  { kind:'single', skuIds:[U('a')], label:'DNX #5', eligibleDate:'2026-10-30', payload:{ skuId:U('a'), quantity:10, weightValue:8, weightUnit:'OUNCE' } },
  { kind:'group', familyId:U('f'), skuIds:[U('b'), U('c')], label:'Robin Hood #2 (2 covers)', eligibleDate:'2026-10-31', payload:{ familyId:U('f'), variants:[{ skuId:U('b') }, { skuId:U('c') }] } },
  { kind:'single', skuIds:[U('d')], label:'Later #1', eligibleDate:'2026-11-20', payload:{ skuId:U('d') } },
  { kind:'single', skuIds:[U('e')], label:'Handsold #1', eligibleDate:'2026-10-29', payload:{ skuId:U('e') } },
  { kind:'single', skuIds:[U('9')], label:'No Art #1', eligibleDate:'2026-10-29', payload:{ skuId:U('9') } },
];
let saved = await (await route('POST', { email:'hintline@themanapocket.com', items })).json();
assert.equal(saved.items.length, 5);
assert.ok(!JSON.stringify(saved).includes('weightValue'), 'the screen gets a summary, not the stored listing');
saved = await (await route('POST', { items:[items[0]] })).json();
assert.equal(saved.items.length, 5, 'queuing again replaces, never doubles');
assert.deepEqual(JSON.parse(kvMem.get('foc-autolist:stores')), [STORE]);
assert.equal((await route('POST', { email:'not an email', items:[] })).status, 400);

// Oct 31: the three that are due go up; the hand-listed one is dropped; the one with no art waits.
w.live.add(U('e')); w.art[U('9')] = false;
let calls = 0;
w.respond = req => { calls++; const p = new URL(req.url).pathname; return p.endsWith('group') ? wctx.json({ ok:false, error:'eBay said no' }, 502) : wctx.json({ ok:true }); };
let out = await A.runFocAutoListForStore(env, {}, STORE, { today:'2026-10-31' });
assert.deepEqual([...out.listed], ['DNX #5']);
assert.deepEqual(w.routed.map(r => [r[0], r[2], r[1].storeId]), [['/foc/ebay/create-presale', true, STORE], ['/foc/ebay/create-presale-group', true, STORE]], 'posted through the normal listing routes, as the store');
assert.equal(w.routed[0][1].weightValue, 8);
assert.equal(w.mails.length, 1);
assert.deepEqual([w.mails[0].to, w.mails[0].subject], ['hintline@themanapocket.com', '1 FOC presale listed on eBay']);
assert.match(w.mails[0].body, /Listed on eBay today \(1\):\n- DNX #5/);
let left = JSON.parse(kvMem.get('foc-autolist:' + STORE)).items;
assert.deepEqual(left.map(i => [i.label, i.attempts || 0]), [['Robin Hood #2 (2 covers)', 1], ['Later #1', 0], ['No Art #1', 0]], 'a failure is retried; the hand-listed one is gone');
assert.equal(left[0].lastError, 'eBay said no');
// Two more failures and it gives up, with an email.
await A.runFocAutoListForStore(env, {}, STORE, { today:'2026-11-01' });
await A.runFocAutoListForStore(env, {}, STORE, { today:'2026-11-02' });
assert.equal(w.mails.length, 2);
assert.match(w.mails[1].body, /Could not list after 3 tries[^\n]*\n- Robin Hood #2 \(2 covers\): eBay said no/);
assert.match(w.mails[1].body, /2 more waiting for their eBay presale date\./);
// eBay moves the date: kept, with the new date, no attempt counted.
w.respond = () => wctx.json({ ok:false, error:'Too early', eligibleDate:'2026-11-25' }, 409);
w.art[U('9')] = true;
await A.runFocAutoListForStore(env, {}, STORE, { today:'2026-11-21' });
left = JSON.parse(kvMem.get('foc-autolist:' + STORE)).items;
assert.deepEqual(left.map(i => [i.label, i.eligibleDate, i.attempts || 0]), [['Later #1', '2026-11-25', 0], ['No Art #1', '2026-11-25', 0]]);
// Art never came and the book is out: dropped, and the email says why.
w.art[U('9')] = false; w.sale[U('9')] = '2026-11-26'; w.respond = () => wctx.json({ ok:true });
await A.runFocAutoListForStore(env, {}, STORE, { today:'2026-11-26' });
assert.match(w.mails.at(-1).body, /No Art #1: no cover art came in before it went on sale/);
assert.match(w.mails.at(-1).body, /Listed on eBay today \(1\):\n- Later #1/);
assert.deepEqual(JSON.parse(kvMem.get('foc-autolist:' + STORE)).items, []);
assert.deepEqual(JSON.parse(kvMem.get('foc-autolist:stores')), [], 'an empty queue stops being checked');
// Wiring: the cron runs it; only this Worker's own requests skip sign-in.
assert.match(worker, /runScheduledLunarCoverFill\(env\), runScheduledFocAutoList\(env\)\]\)\);/);
assert.match(worker, /if \(FOC_INTERNAL_REQUESTS\.has\(request\)\) return \{ user:\{ id:'', email:'auto-list' \}, role:'owner', token:'' \};/);
assert.match(worker, /if \(url\.pathname === '\/foc\/ebay\/auto-list'\) return handleFocAutoListRoute\(request, env, url\);/);
assert.equal((worker.match(/FOC_INTERNAL_REQUESTS\.add\(/g) || []).length, 1, 'only the auto-list run marks a request');
console.log('FOC auto-list, ratio quantity and 8 oz checks passed');
