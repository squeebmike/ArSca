import fs from 'node:fs';
import assert from 'node:assert/strict';
import { connectingCoverInfo, groupConnectingCovers, handleFocRequest } from '../scripts/foc-preorders.mjs';

// Store ask: "an easy to use connecting covers [tracker] in the FOC area. It
// needs to keep track of covers I bought, covers I missed and upcoming covers
// that connect. Some go across multiple titles."

// ── reading a cover's own wording ──
{
  assert.deepEqual(connectingCoverInfo({ title:'MIDNIGHT FANTASTIC FOUR #1', variant_label:'COVER F CLAYTON CRAIN 3-PART CONNECTING VARIANT' }), { isConnecting:true, part:0, partCount:3 });
  assert.deepEqual(connectingCoverInfo({ title:'BATMAN #160', variant_label:'CVR C JIM LEE CONNECTING CARD STOCK VAR (PART 1 OF 5)' }), { isConnecting:true, part:1, partCount:5 });
  assert.deepEqual(connectingCoverInfo({ title:'SUPERMAN #30', variant_label:'CVR D LEE CONNECTING VAR', description:'Part 2 of a five-part connecting cover by Jim Lee.' }), { isConnecting:true, part:2, partCount:5 },
    'an issue number (#30) is never read as a part count');
  assert.equal(connectingCoverInfo({ title:'SPIDER-MAN #1', variant_label:'CVR A', description:'The web connects everything.' }).isConnecting, false, 'ordinary prose about "connects" is not a connecting cover');
  assert.equal(connectingCoverInfo({ title:'X-MEN #5', variant_label:'INTERLOCKING VARIANT' }).isConnecting, true);
}

// ── suggested sets cross titles, never artists or publishers ──
{
  const covers = [
    { id:'1', title:'MIDNIGHT FANTASTIC FOUR #1', variant_label:'CLAYTON CRAIN 3-PART CONNECTING VARIANT', cover_artist:'Clayton Crain', publisher:'Marvel', foc_date:'2026-09-14' },
    { id:'2', title:'MIDNIGHT X-MEN #1', variant_label:'CLAYTON CRAIN 3-PART CONNECTING VARIANT', cover_artist:'Clayton Crain', publisher:'Marvel', foc_date:'2026-09-21' },
    { id:'3', title:'MIDNIGHT AVENGERS #1', variant_label:'CRAIN CONNECTING VARIANT PART 3', cover_artist:'Clayton Crain', publisher:'Marvel', foc_date:'2026-10-05' },
    { id:'4', title:'BATMAN #160', variant_label:'JIM LEE CONNECTING VAR (PART 1 OF 5)', cover_artist:'Jim Lee', publisher:'DC Comics', foc_date:'2026-09-14' },
    { id:'5', title:'SUPERMAN #30', variant_label:'LEE CONNECTING VAR', description:'Part 2 of a five-part connecting cover.', cover_artist:'Jim Lee, Scott Williams', publisher:'DC Comics', foc_date:'2026-09-28' },
    { id:'6', title:'OLD BOOK #1', variant_label:'CRAIN CONNECTING VARIANT', cover_artist:'Clayton Crain', publisher:'Marvel', foc_date:'2025-01-06' },
  ];
  const groups = groupConnectingCovers(covers);
  const crain = groups.find(g => g.skuIds.includes('1'));
  assert.deepEqual(crain.skuIds, ['1', '2', '3'], 'three different Midnight titles form one set');
  assert.equal(crain.partCount, 3);
  assert.match(crain.name, /Clayton Crain 3-part connecting \(Marvel\)/);
  assert.deepEqual(groups.find(g => g.skuIds.includes('4')).skuIds, ['4', '5'], 'co-credited artist still joins the set');
  assert.ok(!crain.skuIds.includes('6'), 'a cover from a year earlier is a different set');
}

// ── the Worker route ──
{
  const skus = [
    { id:'11111111-1111-1111-1111-111111111111', cycle_id:'c1', title:'MIDNIGHT X-MEN #1', variant_label:'CRAIN 3-PART CONNECTING VARIANT', cover_artist:'Clayton Crain', publisher:'Marvel', foc_date:'2026-09-14', store_quantity:2 },
    { id:'22222222-2222-2222-2222-222222222222', cycle_id:'c1', title:'MIDNIGHT FF #1', variant_label:'CRAIN 3-PART CONNECTING VARIANT', cover_artist:'Clayton Crain', publisher:'Marvel', foc_date:'2026-09-14', store_quantity:0 },
    { id:'33333333-3333-3333-3333-333333333333', cycle_id:'c2', title:'SPIDER-MAN #1', variant_label:'CVR A', description:'He connects with readers.', publisher:'Marvel', foc_date:'2026-09-21', store_quantity:5 },
  ];
  const paths = [];
  const deps = {
    json:(body, status = 200) => new Response(JSON.stringify(body), { status, headers:{ 'content-type':'application/json' } }),
    requireStoreUser:async () => ({ user:{ id:'staff-1' } }),
    supabaseAdminFetch:async (_env, path) => {
      paths.push(path);
      if(path.startsWith('comic_skus?') && path.includes('or=(')) return { data:skus };
      if(path.startsWith('foc_preorder_orders?') && path.includes('cycle_id=eq.c1')) return { data:[{ id:'o1' }] };
      if(path.startsWith('foc_preorder_items?')) return { data:[{ sku_id:'22222222-2222-2222-2222-222222222222', quantity:1 }] };
      return { data:[] };
    },
  };
  const url = new URL('https://x/foc/admin/connecting-covers?store_id=store-1');
  const res = await handleFocRequest(new Request(url), {}, url, deps);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.deepEqual(data.covers.map(c => c.id).sort(), [skus[0].id, skus[1].id], 'prose that merely says "connects" is filtered out');
  const ff = data.covers.find(c => c.id === skus[1].id);
  assert.equal(ff.orderedQty, 1, 'a customer preorder counts as bought even with no shelf order');
  assert.equal(data.covers.find(c => c.id === skus[0].id).orderedQty, 2);
  assert.equal(data.suggestedSets.length, 1);
  assert.equal(data.suggestedSets[0].skuIds.length, 2);
  assert.ok(paths.some(p => p.includes('store_id=eq.store-1')), 'scoped to the signed-in store');
}

// ── dashboard wiring ──
{
  const dash = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
  assert.match(dash, /onclick="openConnectingCovers\(\)">CONNECTING COVERS<\/button>/);
  assert.match(dash, /storeWorkerFetch\('\/kv\/foc_connecting_sets'/, 'sets are shared through the store KV');
  const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
  assert.match(worker, /const permanent = key\.startsWith\('foc_connecting'\);/, 'saved sets never expire');
  // status rules
  const src = dash.slice(dash.indexOf('function connectToday'), dash.indexOf('var CONNECT_BADGE'));
  const { connectStatus } = new Function(src + '\nreturn { connectStatus };')();
  const future = '2999-01-01', past = '2000-01-01';
  assert.equal(connectStatus({ id:'a', orderedQty:1, foc_date:past }), 'bought');
  assert.equal(connectStatus({ id:'a', orderedQty:0, foc_date:past }), 'missed');
  assert.equal(connectStatus({ id:'a', orderedQty:0, foc_date:future }), 'upcoming');
  assert.equal(connectStatus({ id:'a', orderedQty:0, foc_date:past }, { have:{ a:true } }), 'have', 'bought elsewhere');
  assert.equal(connectStatus({ id:'a', orderedQty:0, foc_date:past }, { skip:{ a:true } }), 'skipped');
}
console.log('FOC connecting covers checks passed');

// ── Overview alert: don't miss the next part ──
{
  const dash = fs.readFileSync('dashboard.html', 'utf8');
  const s = dash.indexOf('function connectingCoverAlerts(');
  const alerts = new Function(dash.slice(s, dash.indexOf('\n}', s) + 2) + '\nreturn connectingCoverAlerts;')();
  const today = '2026-10-01';
  const covers = [
    { id:'a', title:'MIDNIGHT FF #1', foc_date:'2026-09-21', orderedQty:2 },
    { id:'b', title:'MIDNIGHT X-MEN #1', foc_date:'2026-10-05', orderedQty:0 },
    { id:'c', title:'MIDNIGHT AVENGERS #1', foc_date:'2026-10-20', orderedQty:0 },
    { id:'d', title:'MIDNIGHT THOR #1', foc_date:'2026-10-12', orderedQty:0 },
    { id:'e', title:'MIDNIGHT HULK #1', foc_date:'2026-10-04', orderedQty:0 },
  ];
  const sets = [{ name:'Crain 5-part', skuIds:['a','b','c','e'], have:{}, skip:{ e:true } }];
  const suggested = [{ skuIds:['a','b','d'] }];
  const r = alerts(sets, covers, suggested, today);
  assert.deepEqual(r.due.map(x => x.cover.id), ['b'], 'only an unordered part with FOC in the next 7 days, never a skipped one');
  assert.deepEqual(r.fresh.map(x => x.cover.id), ['d'], 'a newly solicited part of a tracked set');
  assert.match(dash, /const connecting = await connectingCoverPulseAction\(\);/);
}
console.log('Connecting cover alert checks passed');
