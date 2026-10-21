import fs from 'node:fs';
import assert from 'node:assert/strict';
import { stockHealthIssues, collectStockHealth, stockHealthEmail, runScheduledStockHealth, handleFocRequest } from '../scripts/foc-preorders.mjs';

// Store ask: "Let's not hit the 1000 bug. We should not have a cap." The
// database returns at most 1,000 rows per request; the Worker's helper and
// the dashboard's client now page past it on their own.
const TABLE = Array.from({ length:2500 }, (_, i) => ({ id:String(i).padStart(5, '0'), n:i }));
function postgrest(url, calls){
  const u = new URL(url); calls.push(u.search);
  if (u.searchParams.get('order') === 'nope.asc') return { ok:false, status:400, body:{ message:'column nope does not exist' } };
  let rows = TABLE.slice();
  if (u.searchParams.get('order')?.startsWith('n.desc')) rows.reverse();
  const off = Number(u.searchParams.get('offset') || 0), lim = Math.min(1000, Number(u.searchParams.get('limit') || 1000));
  return { ok:true, status:200, body:rows.slice(off, off + lim) };
}
// Worker: supabaseAdminFetch.
{
  const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
  const src = worker.slice(worker.indexOf('const SUPABASE_PAGE_ROWS = 1000;'), worker.indexOf('async function requirePlatformAdmin('));
  const calls = [];
  const fetch = async url => { const r = postgrest(url, calls); return { ok:r.ok, status:r.status, text:async () => JSON.stringify(r.body) }; };
  const api = new Function('fetch', 'supabaseAdminConfig', src + 'return { supabaseAdminFetch };')(fetch, () => ({ base:'https://db.test', key:'k' }));
  const all = await api.supabaseAdminFetch({}, 'inventory_items?store_id=eq.s&select=*');
  assert.equal(all.data.length, 2500, 'no limit: every row');
  assert.equal(new Set(all.data.map(r => r.id)).size, 2500, 'no row twice');
  assert.match(calls[1], /order=id\.asc&limit=1000&offset=0$/, 'unordered: starts over in id order');
  calls.length = 0;
  assert.equal((await api.supabaseAdminFetch({}, 'inventory_items?select=*&limit=5000')).data.length, 2500, 'limit=5000 means up to 5,000');
  assert.equal((await api.supabaseAdminFetch({}, 'inventory_items?select=*&limit=1500')).data.length, 1500);
  assert.equal((await api.supabaseAdminFetch({}, 'inventory_items?select=*&limit=200')).data.length, 200, 'a small limit is left alone');
  assert.equal((await api.supabaseAdminFetch({}, 'inventory_items?select=*&limit=1000&offset=1000')).data.length, 1000, 'a caller paging itself is left alone');
  const desc = await api.supabaseAdminFetch({}, 'inventory_items?select=*&order=n.desc');
  assert.deepEqual([desc.data.length, desc.data[0].n, desc.data[2499].n], [2500, 2499, 0], 'an ordered read continues in its own order');
  assert.equal((await api.supabaseAdminFetch({}, 'inventory_items?select=*', { method:'PATCH', body:'{}' })).data.length, 1000, 'writes are never re-sent');
}
// Dashboard: the supabase-js client's fetch.
{
  const dashboard = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
  const start = dashboard.indexOf('const SUPABASE_PAGE_ROWS = 1000, SUPABASE_MAX_AUTO_ROWS');
  const src = dashboard.slice(start, dashboard.indexOf('function getSupabaseClient(', start));
  const calls = [];
  const fetch = async url => { const r = postgrest(String(url), calls); return new Response(JSON.stringify(r.body), { status:r.status, headers:{ 'Content-Type':'application/json', 'Content-Range':'0-999/2500' } }); };
  const paging = new Function('fetch', src + 'return pagingSupabaseFetch;')(fetch);
  const get = async (q, init = {}) => (await (await paging('https://db.test/rest/v1/inventory_items' + q, init)).json());
  assert.equal((await get('?select=*')).length, 2500);
  assert.equal((await get('?select=*&limit=5000')).length, 2500);
  assert.equal((await get('?select=*&limit=50')).length, 50);
  assert.equal((await get('?select=*&offset=0&limit=1000')).length, 1000, '.range() is left alone');
  const one = await paging('https://db.test/rest/v1/inventory_items?select=*', { headers:{ Accept:'application/vnd.pgrst.object+json' } });
  assert.equal((await one.json()).length, 1000, 'single-row reads are left alone');
  assert.match(dashboard, /global:\{ fetch:pagingSupabaseFetch \},/, 'the dashboard client uses it');
}

// Stock health.
{
  const r = stockHealthIssues({
    presale:{ early:[{ name:'Cyberpunk 2077 #1 A', qty:10, onSaleDate:'2026-10-21', released:false }, { name:'Star Trek', qty:1, onSaleDate:'2026-10-06', released:true }], doubles:[{ name:'Sonic #3 A', shows:16, real:8 }], review:[] },
    unheld:[{ name:'Midnight X-Men #1 · Cover F', note:'1 for Sean' }], notReceived:[{ name:'Midnight Fantastic Four #1 · F', note:'ordered 5' }], overListed:[], staleHolds:[], zeroStock:[{ name:'Box', note:'qty 0' }] });
  assert.deepEqual(r.issues.map(i => [i.key, i.severity]), [['early','high'],['doubles','high'],['unheld','high'],['early-out','medium'],['not-received','medium'],['zero-stock','low']]);
  assert.equal(r.high, 3);
  assert.equal(r.issues[0].title, '1 eBay presale shows in stock before the book came in');
  assert.equal(r.issues[2].fix, 'FOC → 📌 ON HOLD → SET ASIDE');
  const mail = stockHealthEmail({ ...r, issues:r.issues });
  assert.equal(mail.subject, 'Stock check: 3 problems to fix');
  assert.match(mail.body, /• 1 eBay presale shows in stock before the book came in\n  Fix: FOC → 🩺 PRESALE STOCK CHECK → FIX TICKED\n   - Cyberpunk 2077 #1 A \(shows 10 in stock · comes out 2026-10-21\)/);
  assert.doesNotMatch(mail.body, /in stock with 0 copies/, 'low-priority items stay out of the email');
  assert.deepEqual(stockHealthIssues({}).issues, [], 'nothing wrong: all clear');
}
// Collects from every source and the route returns it.
{
  const SKU_RECEIVED = '11111111-1111-4111-8111-111111111111', SKU_LATE = '22222222-2222-4222-8222-222222222222', SKU_LIVE = '33333333-3333-4333-8333-333333333333';
  const NOW = Date.parse('2026-10-15T18:00:00Z');
  const paths = [];
  const db = async (path) => {
    paths.push(path);
    if (path.includes('data->>source=in.(foc_presale,foc_presale_bundle)')) return { data:path.includes('status=in.(in_stock)') ? [] : [{ id:'p1', status:'presale', data:{ source:'foc_presale', focSkuId:SKU_LIVE, ebayListingId:'257', qty:10, name:'Cyberpunk #1 A - PRESALE' } }] };
    if (path.includes('data->>source=in.(foc_receive,foc_hold)')) return { data:[{ id:'r1', status:'in_stock', source:'foc_receive', sku:SKU_RECEIVED, name:'Midnight X-Men #1 -- F', qty:'5' }, { id:'h1', status:'in_stock', source:'foc_hold', sku:SKU_RECEIVED, name:'X', qty:'1', hold:{ customerName:'Pat', heldAt:'2026-09-20T00:00:00Z' } }] };
    if (path.startsWith('foc_preorder_items?')) { assert.match(path, /ord:foc_preorder_orders!inner\(.*\)&ord\.status=eq\.paid/); return { data:[{ id:'it1', sku_id:SKU_RECEIVED, quantity:1, ord:{ customer_name:'Sean Vanoverbeke', order_number:'FOC-1', status:'paid' }, sku:{ title:'MIDNIGHT X-MEN #1', variant_label:'COVER F' } }] }; }
    if (path.startsWith('comic_skus?store_id=')) { assert.match(path, /on_sale_date=gte\.2026-08-31&on_sale_date=lte\.2026-10-12/); return { data:[{ id:SKU_LATE, title:'MIDNIGHT FANTASTIC FOUR #1', variant_label:'COVER F', on_sale_date:'2026-10-07', store_quantity:5 }, { id:SKU_RECEIVED, title:'MIDNIGHT X-MEN #1', variant_label:'COVER F', on_sale_date:'2026-10-07', store_quantity:5 }] }; }
    if (path.startsWith('comic_skus?id=')) return { data:[{ id:SKU_LIVE, store_quantity:2, foc_date:'2026-09-14' }] };
    if (path.includes('status=eq.in_stock&select=id,name:data->>name')) return { data:[{ id:'z', name:'Old box', qty:'0' }, { id:'ok', name:'Fine', qty:'3' }] };
    return { data:[] };
  };
  const rep = await collectStockHealth(db, 'st', NOW);
  const by = Object.fromEntries(rep.issues.map(i => [i.key, i]));
  assert.equal(by.unheld.items[0].preorderItemId, 'it1');
  assert.match(by.unheld.items[0].note, /1 for Sean Vanoverbeke \(FOC-1\)/);
  assert.deepEqual(by['not-received'].items.map(i => i.name), ['MIDNIGHT FANTASTIC FOUR #1 · COVER F'], 'received covers are not "never received"');
  assert.equal(by['over-listed'].items[0].note, 'eBay lists 10, you ordered 2 for the shelf');
  assert.equal(by['stale-holds'].count, 1);
  assert.equal(by['zero-stock'].items[0].name, 'Old box');
  assert.equal(rep.checked.inStock, 2);
  assert.ok(paths.some(p => p.includes('&limit=100000')), 'reads ask for everything (the helper pages)');
}
// Cron: saved for the dashboard, one email a day for serious problems.
{
  const kv = new Map(), sent = [];
  const env = { LBA_KV:{ get:async (k, t) => kv.has(k) ? (t === 'json' ? JSON.parse(kv.get(k)) : kv.get(k)) : null, put:async (k, v) => kv.set(k, v), delete:async k => kv.delete(k) } };
  const deps = { sendEmail:async (e, to, subject) => sent.push([to, subject]),
    supabaseAdminFetch:async (e, path) => {
      if (path.startsWith('store_settings?')) return { data:[{ store_id:'st', receipt_settings:{ email:'shop@example.com' } }] };
      if (path.startsWith('foc_preorder_items?')) return { data:[{ id:'it1', sku_id:'s1', quantity:1, ord:{ customer_name:'Sean', order_number:'FOC-1' }, sku:{ title:'X' } }] };
      if (path.includes('data->>source=in.(foc_receive,foc_hold)')) return { data:[{ id:'r1', status:'in_stock', source:'foc_receive', sku:'s1', qty:'1' }] };
      return { data:[] };
    } };
  const NOW = Date.parse('2026-10-15T18:00:00Z');
  await runScheduledStockHealth(env, deps, NOW);
  await runScheduledStockHealth(env, deps, NOW + 6 * 3600e3);
  assert.deepEqual(sent, [['shop@example.com', 'Stock check: 1 problem to fix']], 'once a day');
  assert.equal(JSON.parse(kv.get('stock-health:st')).high, 1, 'saved for the dashboard');
  const res = await handleFocRequest({ method:'GET', headers:{ get:() => null } }, env, new URL('https://x/foc/admin/stock-health?store_id=st'), { ...deps, json:(data, status = 200) => ({ status, data }), requireStoreUser:async () => ({ user:{ id:'u' } }) });
  assert.equal(res.data.cached, true);
  assert.equal(res.data.report.high, 1);
}
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.match(worker, /runScheduledBookAlerts\(env\), runScheduledStockHealthCheck\(env\)[,\]]/, 'runs on the 6-hourly cron');
const dash = fs.readFileSync('dashboard.html', 'utf8');
assert.match(dash, /<div id="stock-health-card"><\/div>/);
assert.match(dash, /id="stock-health-banner"/);
const ui = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
assert.match(ui, /onclick="focSetAside\(\\''\+esc\(u\.preorderItemId\|\|''\)\+'\\'\)">SET ASIDE<\/button>/);
console.log('No row cap + stock health checks passed');
// SET ASIDE moves a shelf copy onto a hold; ALREADY HANDED OVER marks it done.
{
  const IT = '44444444-4444-4444-8444-444444444444', patches = [], posts = [];
  let items = [{ status:'committed' }, { status:'completed' }];
  const deps = { json:(data, status = 200) => ({ status, data }), requireStoreUser:async () => ({ user:{ id:'u' } }), readJsonWithLimit:async req => ({ data:JSON.parse(req.body) }),
    supabaseAdminFetch:async (e, path, opts = {}) => {
      if (opts.method === 'PATCH') { patches.push([path, JSON.parse(opts.body)]); if (path.startsWith('foc_preorder_items?id=')) items[0] = { status:JSON.parse(opts.body).status }; return { data:null }; }
      if (opts.method === 'POST') { posts.push(JSON.parse(opts.body)[0]); return { data:[{ id:'hold-new' }] }; }
      if (path.startsWith('foc_preorder_items?id=')) return { data:[{ id:IT, sku_id:'sku1', quantity:1, status:'committed', order_id:'o1', order:{ id:'o1', status:'paid', customer_name:'Sean Vanoverbeke', order_number:'FOC-1', fulfillment_method:'pickup' } }] };
      if (path.startsWith('foc_preorder_items?order_id=')) return { data:items };
      if (path.startsWith('inventory_items?')) return { data:[{ id:'shelf', data:{ name:'Midnight X-Men #1 -- F', qty:5, quantity:5, source:'foc_receive', focSkuId:'sku1' } }] };
      return { data:[] };
    } };
  const call = body => handleFocRequest({ method:'POST', headers:{ get:() => null }, body:JSON.stringify({ storeId:'st', preorderItemId:IT, ...body }) }, {}, new URL('https://x/foc/admin/holds/set-aside'), deps);
  const r = await call({});
  assert.deepEqual(r.data, { ok:true, holdRowId:'hold-new', copies:1 });
  assert.equal(patches.find(p => p[0].startsWith('inventory_items?id=eq.shelf'))[1].data.qty, 4, 'one copy off the shelf');
  assert.deepEqual([posts[0].data.source, posts[0].data.lifecycle, posts[0].data.qty, posts[0].data.preorderHold.customerName], ['foc_hold', 'hold', 1, 'Sean Vanoverbeke']);
  assert.equal(patches.find(p => p[0].startsWith('foc_preorder_orders?id=eq.o1'))[1].status, 'ready_for_pickup');
  items = [{ status:'committed' }, { status:'completed' }]; patches.length = 0;
  const h = await call({ handedOver:true });
  assert.equal(h.data.handedOver, true);
  assert.equal(patches.find(p => p[0].startsWith('foc_preorder_items?id='))[1].status, 'completed');
  assert.equal(patches.find(p => p[0].startsWith('foc_preorder_orders?id=eq.o1'))[1].status, 'completed', 'every book done: order done');
}
console.log('Set aside checks passed');
