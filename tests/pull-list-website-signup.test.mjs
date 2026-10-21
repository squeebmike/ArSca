import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Store asks: (2) customers pick their pull-list series on the website
// themselves; (3) a heads-up when a subscribed series hasn't been on a FOC
// file for a while.
const { handleFocRequest, pullListQuiet } = await import('../scripts/foc-preorders.mjs');
const { pullListPageBody } = await import('../scripts/pull-list-page.mjs');
const STORE = '0f9dd4bc-42a7-487e-a972-2905d24513e9';
const id = c => c.repeat(8) + '-' + c.repeat(4) + '-4' + c.repeat(3) + '-8' + c.repeat(3) + '-' + c.repeat(12);
const S1 = id('1'), S2 = id('2'), CUST = id('c'), USER = id('u'.replace('u', 'e'));

function harness({ linked = null, existingSub = null, sameTitle = null, requested = 0 } = {}) {
  const calls = [], db = { customers:linked ? [linked] : [], subs:[] };
  const deps = {
    readJsonWithLimit: async req => ({ data:await req.json() }),
    requireAuthenticatedUser: async req => (req.headers.get('Authorization') ? { user:{ id:USER, email:'reader@example.com' } } : { error:{ status:401, body:{ ok:false } } }),
    json: (body, status = 200) => ({ status, body, headers:new Headers() }),
    supabaseAdminFetch: async (env, path, opts = {}) => {
      calls.push([opts.method || 'GET', path, opts.body ? JSON.parse(opts.body) : null]);
      if (path.startsWith('customers?')) return { data:db.customers };
      if (path === 'customers') { const row = { id:CUST, ...JSON.parse(opts.body)[0] }; db.customers.push(row); return { data:[row] }; }
      if (path.startsWith('pull_list_series?') && path.includes('active=eq.true&select=id,title,publisher')) return { data:[{ id:S1, title:'DNX', publisher:'Marvel' }, { id:S2, title:'Absolute Batman', publisher:'DC' }] };
      if (path.startsWith('pull_list_series?id=')) return { data:path.includes(S1) ? [{ id:S1 }] : [] };
      if (path.startsWith('pull_list_series?') && path.includes('title=ilike.')) return { data:sameTitle ? [sameTitle] : [] };
      if (path === 'pull_list_series') return { data:[{ id:id('9') }] };
      if (path.startsWith('pull_list_subscriptions?series_id=')) return { data:existingSub ? [existingSub] : [] };
      if (path.startsWith('pull_list_subscriptions?store_id=')) return { data:[...Array(requested)].map((_, i) => ({ id:'r' + i, series_id:'x' + i, series:{ title:'Asked ' + i, active:false } })).concat(db.subs) };
      return { data:null };
    },
  };
  const send = (method, path, body, signedIn = true) => {
    const r = new Request('https://w.test' + path, { method, headers:{ ...(signedIn ? { Authorization:'Bearer t' } : {}), ...(body ? { 'Content-Type':'application/json' } : {}) }, body:body ? JSON.stringify(body) : undefined });
    return handleFocRequest(r, {}, new URL(r.url), deps);
  };
  return { send, calls, db };
}

// The series list is public; the customer's own list needs sign-in.
{
  const h = harness();
  const res = await h.send('GET', '/public/preorders/pull-list/series?store_id=' + STORE, null, false);
  assert.deepEqual(res.body.series.map(s => s.title), ['DNX', 'Absolute Batman']);
  assert.match(h.calls[0][1], /active=eq\.true/, 'series the shop hasn\'t switched on stay hidden');
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=300');
  assert.equal((await h.send('GET', '/public/preorders/pull-list?store_id=' + STORE, null, false)).status, 401);
  const mine = await h.send('GET', '/public/preorders/pull-list?store_id=' + STORE);
  assert.deepEqual(mine.body, { ok:true, name:'', hasCustomer:false, email:'reader@example.com', subscriptions:[] });
}
// New customer: a name is needed, then they get a customer record linked to their login.
{
  const h = harness();
  const first = await h.send('POST', '/public/preorders/pull-list', { storeId:STORE, seriesId:S1 });
  assert.deepEqual([first.status, first.body.needsName], [400, true]);
  assert.ok(!h.calls.some(c => c[0] === 'POST'), 'nothing saved without a name');
  const ok = await h.send('POST', '/public/preorders/pull-list', { storeId:STORE, seriesId:S1, name:'  Robin   Park ' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const made = h.calls.find(c => c[1] === 'customers')[2][0];
  assert.deepEqual([made.name, made.email, made.linked_user_id, made.store_id], ['Robin Park', 'reader@example.com', USER, STORE]);
  const sub = h.calls.find(c => c[1] === 'pull_list_subscriptions' && c[0] === 'POST')[2][0];
  assert.deepEqual([sub.series_id, sub.customer_id, sub.customer_name, sub.active], [S1, CUST, 'Robin Park', true]);
}
// Linked in-store customer: uses that record; re-adding turns the old row back on.
{
  const h = harness({ linked:{ id:CUST, name:'Sean V' }, existingSub:{ id:'sub1', active:false } });
  const ok = await h.send('POST', '/public/preorders/pull-list', { storeId:STORE, seriesId:S1 });
  assert.equal(ok.status, 200);
  assert.ok(!h.calls.some(c => c[1] === 'customers'), 'no second customer record');
  assert.deepEqual(h.calls.find(c => c[0] === 'PATCH'), ['PATCH', 'pull_list_subscriptions?id=eq.sub1', { active:true }]);
  const gone = await h.send('POST', '/public/preorders/pull-list', { storeId:STORE, seriesId:S2 });
  assert.equal(gone.status, 404, 'a series not on the list (or switched off) can\'t be picked by id');
  const drop = await h.send('POST', '/public/preorders/pull-list', { storeId:STORE, subscribe:false, subscriptionId:id('7') });
  assert.equal(drop.status, 200);
  assert.match(h.calls.filter(c => c[0] === 'PATCH').pop()[1], new RegExp('pull_list_subscriptions\\?id=eq\\.' + id('7') + '&store_id=eq\\.' + STORE + '&customer_id=eq\\.' + CUST), 'only their own subscription');
  assert.deepEqual(h.calls.filter(c => c[0] === 'PATCH').pop()[2], { active:false }, 'removed = switched off, never deleted');
}
// Asking for a series: hidden until the shop turns it on; same title reuses it; a limit.
{
  const h = harness({ linked:{ id:CUST, name:'Sean V' } });
  const ok = await h.send('POST', '/public/preorders/pull-list', { storeId:STORE, request:'  Absolute   Flash ' });
  assert.equal(ok.status, 200);
  const made = h.calls.find(c => c[1] === 'pull_list_series' && c[0] === 'POST')[2][0];
  assert.deepEqual([made.title, made.active, made.notes], ['Absolute Flash', false, 'Asked for on the website by Sean V']);
  assert.equal(h.calls.find(c => c[1] === 'pull_list_subscriptions' && c[0] === 'POST')[2][0].series_id, id('9'));
  const same = harness({ linked:{ id:CUST, name:'Sean V' }, sameTitle:{ id:S2, active:true } });
  await same.send('POST', '/public/preorders/pull-list', { storeId:STORE, request:'absolute batman' });
  assert.ok(!same.calls.some(c => c[1] === 'pull_list_series' && c[0] === 'POST'), 'an existing series is reused');
  assert.equal(same.calls.find(c => c[1] === 'pull_list_subscriptions' && c[0] === 'POST')[2][0].series_id, S2);
  const many = harness({ linked:{ id:CUST, name:'Sean V' }, requested:5 });
  assert.equal((await many.send('POST', '/public/preorders/pull-list', { storeId:STORE, request:'Sixth Series' })).status, 429);
  assert.equal((await many.send('POST', '/public/preorders/pull-list', { storeId:STORE, request:'x' })).status, 400);
}

// The page: same login as the preorders page; the worker serves it.
const page = pullListPageBody(STORE);
assert.match(page, /SK='mp-foc-session-v1'/);
assert.match(page, /"store":"0f9dd4bc-42a7-487e-a972-2905d24513e9"/);
assert.match(page, /\/public\/preorders\/pull-list\/series\?store_id=/);
assert.match(page, /You pay when you pick it up/);
assert.doesNotMatch(page, /service_role|SUPABASE_SERVICE/);
new vm.Script(page.slice(page.indexOf('<script>') + 8, page.lastIndexOf('</script>')));
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.match(worker, /import \{ pullListPageBody \} from '\.\/scripts\/pull-list-page\.mjs';/);
assert.match(worker, /url\.pathname === '\/preorders\/pull-list' \|\| url\.pathname === '\/preorders\/pull-list\/'/);
assert.match(worker, /bodyHtml: pullListPageBody\(ITEM_DETAIL_STORE_ID\),/);
const routes = JSON.parse(fs.readFileSync('wrangler.deploy.jsonc', 'utf8').replace(/^\s*\/\/.*$/gm, '')).routes.map(r => r.pattern);
assert.ok(routes.includes('www.themanapocket.com/preorder*'), 'already routed to the worker');

// Staff: website requests to switch on, and the sign-up link.
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
assert.match(app, /function pullListWebsiteRequests\(\)\{ return pullListSeriesCache\.filter\(s => s\.active === false && \/asked for on the website\/i\.test\(s\.notes \|\| ''\)\); \}/);
assert.match(app, /onclick="approvePullListRequest\('\$\{escHtml\(r\.id\)\}'\)">ADD TO PULL LISTS/);
assert.match(app, /update\(\{ active:true, updated_at:new Date\(\)\.toISOString\(\) \}\)/);

// ── Not on a FOC file lately ──
const cycles = [{ id:'c1', foc_date:'2026-08-10' }, { id:'c2', foc_date:'2026-09-07' }, { id:'c3', foc_date:'2026-10-26' }];
const families = [
  { cycle_id:'c3', title:'DNX #5', series_name:'DNX' }, { cycle_id:'c1', title:'DNX #3', series_name:'DNX' },
  { cycle_id:'c1', title:'Fort Psycho #2' }, { cycle_id:'c2', title:'Daredevil #10', series_name:'Daredevil' },
];
const sub = (title) => ({ series:{ title } });
const quiet = pullListQuiet({ cycles, families, subs:[sub('DNX'), sub('FORT PSYCHO'), sub('Fort Psycho'), sub('Daredevil'), sub('Gangrene')] });
assert.deepEqual(quiet.map(q => [q.title, q.subscribers, q.lastFoc]), [['FORT PSYCHO', 2, '2026-08-10'], ['Daredevil', 1, '2026-09-07'], ['Gangrene', 1, '']],
  'DNX is on the newest FOC; Fort Psycho and Daredevil last showed up 6+ weeks before it; Gangrene never has');
assert.deepEqual(pullListQuiet({ cycles:[], families, subs:[sub('DNX')] }), [], 'no FOC weeks imported: nothing to compare');
const svc = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');
assert.match(svc, /quiet=pullListQuiet\(\{subs:subs\|\|\[\],families:all,cycles:cycles\|\|\[\]\}\);/);
assert.match(svc, /return deps\.json\(\{ok:true,needs:pullListNeeds\(\{skus:skus\|\|\[\],families,subs:subs\|\|\[\]\}\),quiet,subscribers:subs\.length\}\);/);
const dash = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
const fn = n => { const s = dash.indexOf('function ' + n + '('); assert.ok(s >= 0, n); return dash.slice(s, dash.indexOf('\n}\n', s) + 2); };
const ctx = { esc:s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') };
vm.runInNewContext(fn('focPullQuietHtml') + fn('focPullNeedsHtml') + 'function displayDate(d){return "D:"+d;} this.api={focPullNeedsHtml};', ctx);
const html = ctx.api.focPullNeedsHtml([], false, quiet);
assert.match(html, /📚 PULL LISTS · NONE ON THIS FOC/);
assert.match(html, /NOT ON A FOC FILE LATELY \(3\)/);
assert.match(html, /FORT PSYCHO <span[^>]*>· 2 on pull list · last on the D:2026-08-10 FOC/);
assert.match(html, /Gangrene <span[^>]*>· 1 on pull list · not on any FOC file yet/);
assert.match(html, /themanapocket\.com\/preorders\/pull-list/);
assert.equal(ctx.api.focPullNeedsHtml([], true, quiet), '', 'the cover wall banner stays for what is short');
assert.match(fn('focShowPullNeeds'), /quiet:d\.quiet\|\|\[\]/);
console.log('Website pull-list sign-up and quiet-series checks passed');
