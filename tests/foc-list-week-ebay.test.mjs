import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';

// Store ask: "list all FOC week to eBay at one time. Covers that don't have
// art yet? Books that are too early? Books I need to put in price for? Make
// sure the weight is correct." Packed single issue: Gemini Flash Mailer
// ~4.8-5 oz + comic ~2.5 oz + bag and board ~0.7 oz.
const dash = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
const fn = n => { const s = dash.indexOf('function ' + n + '('); assert.ok(s >= 0, n); return dash.slice(s, dash.indexOf('\n}\n', s) + 2); };
const line = n => { const s = dash.indexOf('function ' + n + '('); assert.ok(s >= 0, n); return dash.slice(s, dash.indexOf('\n', s) + 1); };
const store = new Map();
const { document } = parseHTML('<!doctype html><html><body></body></html>');
const ctx = { localStorage:{ getItem:k => store.get(k) ?? null, setItem:(k, v) => store.set(k, String(v)) }, document, opened:[], submitted:[] };
vm.runInNewContext(['focSingleWeightOz', 'focListWeightOz', 'focListNeedsPrice', 'focListHasQty'].map(line).join('\n') + fn('focListWeekPlan') + 'async ' + fn('focListWeekOne') +
  'this.api={focSingleWeightOz,focListWeightOz,focListNeedsPrice,focListHasQty,focListWeekPlan,focListWeekOne};', ctx);
const api = ctx.api;

const v = (id, o = {}) => ({ id, title:'Book', variantLabel:'Cover A', ebayPresaleStatus:'ELIGIBLE_NOW', coverImageUrl:'https://img/' + id, priceCents:0, msrpCents:399, storeQuantity:3, ...o });
const families = [
  { id:'f1', title:'DNX #4', variants:[v('a'), v('b', { variantLabel:'Cover B' }), v('c', { variantLabel:'1:25', isIncentive:true, storeQuantity:0, securedQuantity:1 }), v('d', { coverImageUrl:'' })] },
  { id:'f2', title:'Solo #1', variants:[v('e'), v('f', { ebayPresaleStatus:'TOO_EARLY', ebayEligibleDate:'2026-11-03' }), v('g', { storeQuantity:0 })] },
  { id:'f3', title:'Listed #2', variants:[v('h', { ebayPresaleStatus:'LISTED' }), v('i'), v('j')] },
  { id:'f4', title:'Odd #9', variants:[v('k', { ebayPresaleStatus:'ACTION_REQUIRED' }), v('l', { ebayPresaleStatus:'RELEASED' }), v('m', { msrpCents:0 }), v('n', { flags:{ foil:true } }), v('o', { ebayPresaleStatus:'TOO_EARLY', ebayEligibleDate:'2026-10-28' })] },
];
const plan = api.focListWeekPlan(families);
const ids = list => [...list].map(x => x.id);
assert.deepEqual([...plan.groups].map(g => [g.familyId, ids(g.covers)]), [['f1', ['a', 'b']]], 'an issue with 2+ ready covers is one listing');
assert.deepEqual(ids(plan.singles), ['e', 'i', 'j'], 'one ready cover lists alone; an issue already on eBay adds covers as their own listings');
assert.deepEqual(ids(plan.needPrice), ['c', 'm', 'n'], 'ratio, foil and no-price covers wait for a price');
assert.deepEqual(ids(plan.noArt), ['d']);
assert.deepEqual(ids(plan.tooEarly), ['o', 'f'], 'soonest first');
assert.deepEqual(ids(plan.noDate), ['k']);
assert.deepEqual(ids(plan.noQty), ['g']);
assert.deepEqual([plan.listed, plan.released], [1, 1]);
assert.ok(api.focListHasQty({ isIncentive:true, securedQuantity:1 }), 'a secured ratio copy counts');
assert.ok(!api.focListNeedsPrice({ isIncentive:true, priceCents:2500 }), 'a priced ratio cover is ready');

// Weight: packed single issue 9 oz by default (changeable), trades 15, hardcovers 29.
assert.equal(api.focListWeightOz({ msrpCents:399 }), 9);
assert.equal(api.focListWeightOz({ priceCents:1499 }), 15);
assert.equal(api.focListWeightOz({ msrpCents:4999 }), 29);
store.set('foc_ebay_single_weight_oz', '8');
assert.equal(api.focListWeightOz({ msrpCents:499 }), 8, 'the store\'s own scale reading');

// Listing one: the normal review screen, hidden, weight set in ounces, LIST pressed.
ctx.openEbayPresaleReview = async id => { ctx.opened.push(id); document.body.insertAdjacentHTML('beforeend', '<div id="foc-ebay-review-modal"><input id="foc-eb-title" value="T"><input id="foc-eb-weight" value="0.5625"><select id="foc-eb-weight-unit"><option value="POUND" selected>LB</option><option value="OUNCE">OZ</option></select><div id="foc-eb-status"></div></div>'); };
ctx.submitEbayPresaleReview = async id => { const m = document.getElementById('foc-ebay-review-modal'); ctx.submitted.push([id, m.style.visibility, document.getElementById('foc-eb-weight').value, document.getElementById('foc-eb-weight-unit').value]); m.remove(); };
assert.deepEqual({ ...(await api.focListWeekOne('single', 'e', ['e'], 8)) }, { ok:true });
assert.deepEqual(ctx.submitted.at(-1), ['e', 'hidden', '8', 'OUNCE']);
// eBay refuses: the screen stays open with the reason -- reported, and closed.
ctx.submitEbayPresaleReview = async () => { document.getElementById('foc-eb-status').textContent = 'Could not create eBay presale: no UPC'; };
assert.deepEqual({ ...(await api.focListWeekOne('single', 'i', ['i'], 9)) }, { ok:false, error:'Could not create eBay presale: no UPC' });
assert.equal(document.getElementById('foc-ebay-review-modal'), null);
// An issue: only the covers ready here are ticked; under 2 falls back to singles.
ctx.openFamilyEbayGroupReview = async () => { document.body.insertAdjacentHTML('beforeend', '<div id="foc-ebay-group-modal"><input id="foc-eb-grp-title"><input type="checkbox" data-eb-cover-cb="a" checked><input type="checkbox" data-eb-cover-cb="b" checked><input type="checkbox" data-eb-cover-cb="d" checked><input type="checkbox" data-eb-cover-cb="c" disabled><input id="foc-eb-grp-weight"><select id="foc-eb-grp-weight-unit"><option value="POUND">LB</option><option value="OUNCE">OZ</option></select><div id="foc-eb-grp-status"></div></div>'); };
ctx.submitFamilyEbayGroupReview = async () => { const m = document.getElementById('foc-ebay-group-modal'); ctx.submitted.push(['group', [...m.querySelectorAll('[data-eb-cover-cb]')].filter(c => c.checked).map(c => c.getAttribute('data-eb-cover-cb')), document.getElementById('foc-eb-grp-weight-unit').value]); m.remove(); };
assert.deepEqual({ ...(await api.focListWeekOne('group', 'f1', ['a', 'b'], 9)) }, { ok:true });
assert.deepEqual(ctx.submitted.at(-1), ['group', ['a', 'b'], 'OUNCE'], 'the cover with no art stays out');
const fb = await api.focListWeekOne('group', 'f1', ['a'], 9);
assert.deepEqual([fb.ok, fb.fallback], [false, true]);
ctx.openFamilyEbayGroupReview = async () => { document.body.insertAdjacentHTML('beforeend', '<div id="foc-ebay-group-modal">Need at least 2 eligible covers</div>'); };
assert.equal((await api.focListWeekOne('group', 'f1', ['a', 'b'], 9)).fallback, true);

// Wiring.
assert.match(dash, /onclick="openFocListWeek\(\)">📤 LIST WEEK ON EBAY<\/button>/);
const run = fn('focListWeekRun');
assert.match(run, /if\(!policy\)\{toast_dash\('Pick a shipping policy first'\);return;\}/);
assert.match(run, /localStorage\.setItem\('foc_ebay_last_ship_policy_id',policy\)/);
assert.match(run, /if\(!confirm\('List '\+jobs\.length\+' eBay presale listing'/, 'one confirm, showing every listing and weight');
assert.match(run, /else if\(r\.fallback\)jobs\.splice\.apply\(jobs,\[i\+1,0\]/);
assert.match(run, /for\(var i=0;i<jobs\.length&&!focListWeekState\.stop;i\+\+\)/, 'STOP works between listings');
const render = fn('renderFocListWeek');
for (const t of ['READY TO LIST', 'NEEDS YOUR PRICE', 'NO COVER ART YET', 'TOO EARLY FOR EBAY', 'NO ON-SALE DATE', 'NOT ORDERING ANY', 'SINGLE ISSUE WEIGHT (OZ, PACKED)', 'SHIPPING POLICY']) assert.ok(render.includes(t), t);
assert.match(fn('focListSetPrice'), /body:JSON\.stringify\(\{storeId:getActiveStoreId\(\),skuId:skuId,customerPrice:p\}\)/);
console.log('FOC list-week-on-eBay checks passed');

// The screen draws (with stand-ins for the dashboard's helpers).
{
  const host = document.createElement('div');
  const c2 = { ...ctx, panel:() => host, state:{ cycle:{ id:'cy', foc_date:'2026-10-27', distributor:'Lunar' }, families }, esc:s => String(s ?? '').replace(/</g, '&lt;'), displayDate:d => d, focThumbHtml:() => '<i></i>', focListWeekState:{ running:false, weights:{}, policies:{ list:[{ id:'p1', name:'PreSale Paid Shipping' }], error:'' } } };
  vm.runInNewContext(['focSingleWeightOz', 'focListWeightOz', 'focListNeedsPrice', 'focListHasQty'].map(line).join('\n') + fn('focListWeekPlan') + fn('focListRowHtml') + fn('renderFocListWeek') + 'renderFocListWeek();', c2);
  const html = host.innerHTML;
  assert.match(html, /📤 LIST 4 LISTINGS \(5 COVERS\)/);
  assert.match(html, /DNX #4 · ONE LISTING, 2 COVERS TO CHOOSE FROM/);
  assert.match(html, /NEEDS YOUR PRICE \(3\)/);
  assert.match(html, /can list on 2026-10-28/);
  assert.match(html, /FIND LUNAR COVERS/);
  assert.match(html, /<option value="p1">PreSale Paid Shipping<\/option>/);
  assert.match(html, /value="8" onchange="focListSetSingleOz/);
}
console.log('FOC list-week screen render checks passed');
