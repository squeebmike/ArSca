import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Store ask: "The FOC should tell me what books I need to order for the
// pull lists for people that are subscribed for specific books." And
// (Overview screenshot) profit by category should run most to least.
const { pullListNeeds, handleFocRequest } = await import('../scripts/foc-preorders.mjs');
const fam = (id, title, series_name = '') => ({ id, title, series_name });
const sku = (id, family_id, variant_label, title, extra = {}) => ({ id, family_id, variant_label, title, ...extra });
const families = [fam('f1', 'DNX #4', 'DNX'), fam('f2', 'Absolute Batman #25'), fam('f3', 'Nobody Reads This #1'), fam('f4', 'ROBIN HOOD (2026) #1', 'Robin Hood')];
const skus = [
  sku('a1', 'f1', 'Cover B Variant', 'DNX #4'), sku('a2', 'f1', 'Cover A', 'DNX #4'), sku('a3', 'f1', '1:25 Ratio', 'DNX #4', { is_incentive:true }),
  sku('b1', 'f2', 'Cover A', 'Absolute Batman #25'),
  sku('c1', 'f3', 'Cover A', 'Nobody Reads This #1'),
  sku('d1', 'f4', 'Cvr B David Nakayama', 'ROBIN HOOD (2026) #1 CVR B DAVID NAKAYAMA VAR'), sku('d2', 'f4', 'Joshua Middleton', 'ROBIN HOOD (2026) #1 CVR A JOSHUA MIDDLETON'),
];
const sub = (name, series) => ({ customer_name:name, series:{ title:series } });
const subs = [sub('Sean V', 'DNX'), sub('Dana R', 'Absolute Batman'), sub('Lee P', 'DNX'), sub('', 'Robin Hood'), sub('Kim L', 'DNX'), sub('Pat M', 'Not This Week')];
const needs = pullListNeeds({ skus, families, subs });
assert.deepEqual(needs.map(n => [n.title, n.skuId, n.subscribers]), [
  ['DNX #4', 'a2', ['Sean V', 'Lee P', 'Kim L']],
  ['Absolute Batman #25', 'b1', ['Dana R']],
  ['ROBIN HOOD (2026) #1', 'd2', ['Pull-list customer']],
], 'most subscribers first; Cover A, never the variant or ratio; series with nobody subscribed are left out');
assert.ok(needs.every(n => !n.guessed));
assert.deepEqual(pullListNeeds({ skus:[sku('e1', 'f9', 'Cover B Variant', 'Odd #2'), sku('e2', 'f9', 'Cover C Variant', 'Odd #2')], families:[fam('f9', 'Odd #2')], subs:[sub('X', 'Odd')] }).map(n => [n.skuId, n.guessed]), [['e1', true]], 'no Cover A: the first regular cover, flagged to check');

// The route: staff only, needs a week, no subscribers = no work.
const CYCLE = '11111111-1111-4111-8111-111111111111', STORE = '0f9dd4bc-42a7-487e-a972-2905d24513e9';
const paths = [];
const deps = {
  requireStoreUser: async () => ({ user:{ id:'staff' } }), json:(body, status = 200) => ({ status, body }),
  supabaseAdminFetch: async (env, path) => { paths.push(path); if (path.startsWith('pull_list_subscriptions?')) return { data:subs }; if (path.startsWith('comic_skus?')) return { data:skus }; if (path.startsWith('comic_title_families?')) return { data:families }; return { data:[] }; },
};
const get = q => { const r = new Request('https://w.test/foc/admin/pull-list-needs?' + q); return handleFocRequest(r, {}, new URL(r.url), deps); };
const res = await get('store_id=' + STORE + '&cycle_id=' + CYCLE);
assert.equal(res.status, 200);
assert.deepEqual([res.body.needs.length, res.body.subscribers], [3, 6]);
assert.ok(!JSON.stringify(res.body).match(/phone|email/));
assert.equal((await get('store_id=' + STORE + '&cycle_id=x')).status, 400);
paths.length = 0; const realSubs = subs.splice(0);
assert.deepEqual((await get('store_id=' + STORE + '&cycle_id=' + CYCLE)).body, { ok:true, needs:[], subscribers:0 });
assert.equal(paths.length, 1, 'nobody subscribed: one query');
subs.push(...realSubs);

// Dashboard: short = subscribers + eBay presold - store copies ordered.
const dash = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
const fn = n => { const s = dash.indexOf('function ' + n + '('); assert.ok(s >= 0, n); return dash.slice(s, dash.indexOf('\n}\n', s) + 2); };
const ctx = { esc:s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') };
vm.runInNewContext(fn('focPullNeedRows') + fn('focPullNeedsHtml') + 'this.api={focPullNeedRows,focPullNeedsHtml};', ctx);
const stateFamilies = [{ variants:[{ id:'a2', storeQuantity:3, ebayPresold:1 }, { id:'a1', storeQuantity:5 }] }, { variants:[{ id:'b1', storeQuantity:2, ebayPresold:0 }] }, { variants:[{ id:'d2', storeQuantity:0 }] }];
const rows = ctx.api.focPullNeedRows(needs, stateFamilies);
assert.deepEqual([...rows].map(r => [r.skuId, r.store, r.ebay, r.short]), [['a2', 3, 1, 1], ['b1', 2, 0, 0], ['d2', 0, 0, 1]]);
const full = ctx.api.focPullNeedsHtml(rows, false);
assert.match(full, /📚 PULL LISTS · 3 TITLES THIS FOC · <span style="color:var\(--red\)">2 COPIES SHORT<\/span>/);
assert.match(full, /ADD ALL 2 MISSING/);
assert.match(full, /3 on pull list:<\/span> <span style="color:var\(--dim\)">Sean V, Lee P, Kim L/);
assert.match(full, /ordering 3 store copies \(1 already sold on eBay\)/);
assert.match(full, /onclick="focPullAddMissing\('a2'\)">SHORT 1 · ADD/);
assert.match(full, /Absolute Batman #25[\s\S]*✓ covered/);
const banner = ctx.api.focPullNeedsHtml(rows, true);
assert.doesNotMatch(banner, /Absolute Batman/, 'the cover wall only lists what is short');
assert.match(banner, /1 more already covered -- see FINAL FOC REVIEW/);
assert.match(ctx.api.focPullNeedsHtml([...rows].map(r => ({ ...r, short:0 })), false), /ALL COVERED/);
assert.equal(ctx.api.focPullNeedsHtml([], false), '');
assert.match(fn('focPullAddMissing'), /storeQuantity:rows\[i\]\.store\+rows\[i\]\.short/);
assert.match(fn('renderFocReview'), /'<div id="foc-pull-needs"><\/div>'\+/);
assert.match(fn('renderFocReview'), /focShowPullNeeds\('foc-pull-needs',false\);/);
assert.match(fn('openCycle'), /renderCycle\(\);focEnsureIntel\(\);focShowPullNeeds\(null,true\);/);

// Overview: profit by category, most to least.
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
const meter = app.slice(app.indexOf('function renderProfitMeter('), app.indexOf('function renderTopVal('));
assert.match(meter, /\.reduce\(\(a,i\)=>a\+\(i\.profit\|\|0\),0\)\}\)\)\.sort\(\(a,b\)=>b\.p-a\.p\);/);
console.log('FOC pull-list order needs and profit-by-category order checks passed');
