import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { connectingCoverInfo, dedupeConnectingCovers, handleFocRequest } from '../scripts/foc-preorders.mjs';

// Left / middle / right panels are parts 1-3 of a 3-part set.
assert.deepEqual(connectingCoverInfo({ title:'ABSOLUTE SUPERMAN #25 CVR H RAFA SANDOVAL LEFT CONNECTING CARD STOCK VAR' }), { isConnecting:true, part:1, partCount:3 });
assert.deepEqual(connectingCoverInfo({ title:'ABSOLUTE SUPERMAN #25 CVR I RAFA SANDOVAL MIDDLE CONNECTING CARD STOCK VAR' }), { isConnecting:true, part:2, partCount:3 });
assert.deepEqual(connectingCoverInfo({ title:'EMPEROR AQUAMAN #23 CVR C MARK SPEARS RIGHT CONNECTING CARD STOCK VAR' }), { isConnecting:true, part:3, partCount:3 });
assert.equal(connectingCoverInfo({ title:'RIGHTEOUS #1 CVR A' }).part, 0, 'not a connecting cover');

// The same cover listed in three Lunar FOC weeks is one cover: the ordered one.
{
  const { covers, aliases } = dedupeConnectingCovers([
    { id:'a1', upc:'111', foc_date:'2026-09-21', orderedQty:0 },
    { id:'a2', upc:'111', foc_date:'2026-10-05', orderedQty:5 },
    { id:'a3', upc:'111', foc_date:'2026-09-28', orderedQty:0 },
    { id:'b1', upc:'', foc_date:'2026-10-05', orderedQty:0 },
  ]);
  assert.deepEqual(covers.map(c => c.id).sort(), ['a2', 'b1']);
  assert.deepEqual(aliases, { a1:'a2', a3:'a2' });
}

// "Ordered" counts the real distributor order (secured_quantity), plus
// in-stock copies, eBay presales sold and who preordered.
{
  const skus = [{ id:'11111111-1111-1111-1111-111111111111', cycle_id:'cy', upc:'1', title:'X #1 LEFT CONNECTING VAR', store_quantity:0, secured_quantity:5, foc_date:'2026-10-05' }];
  const deps = {
    json:(data, status = 200) => ({ status, data }),
    requireStoreUser:async () => ({ user:{ id:'u' } }),
    supabaseAdminFetch:async (env, path) => {
      if (path.startsWith('comic_skus?')) return { data:skus };
      if (path.startsWith('foc_preorder_orders?cycle_id')) return { data:[{ id:'o1' }] };
      if (path.startsWith('foc_preorder_items?order_id')) return { data:[{ sku_id:skus[0].id, quantity:1 }] };
      if (path.startsWith('inventory_items?')) return { data:[{ status:'in_stock', data:{ focSkuId:skus[0].id, qty:2 } }, { status:'presale', data:{ focSkuId:skus[0].id, source:'foc_presale', qty:1, focPresaleOriginalQty:3 } }] };
      if (path.startsWith('foc_preorder_items?sku_id')) return { data:[{ sku_id:skus[0].id, quantity:2, order_id:'o1' }] };
      if (path.startsWith('foc_preorder_orders?id')) return { data:[{ id:'o1', customer_name:'Sam' }] };
      return { data:[] };
    },
  };
  const res = await handleFocRequest({ method:'GET', headers:{ get:() => null } }, {}, new URL('https://x/foc/admin/connecting-covers?store_id=st'), deps);
  const c = res.data.covers[0];
  assert.equal(c.orderedQty, 5, 'the uploaded distributor order counts as bought');
  assert.equal(c.securedQty, 5);
  assert.equal(c.inStock, 2);
  assert.equal(c.ebaySold, 2);
  assert.deepEqual(c.customers, ['Sam ×2']);
}

// Dashboard: UP NEXT with how many to order, the picture strip, short parts,
// TRACK ALL, and old ids resolving through aliases.
const ui = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
const grab = re => { const m = ui.match(re); assert.ok(m, 'missing ' + re); return m[0]; };
const ctx = { Date, Math, Number, String, esc:v => String(v ?? ''), displayDate:v => v };
vm.createContext(ctx);
vm.runInContext([
  grab(/var connectState=\{[^\n]*\};/), grab(/function connectToday\(\)\{[^\n]*\}/), grab(/function connectStatus\(cover,set\)\{[\s\S]*?\n\}/),
  grab(/var CONNECT_BADGE=\{[^\n]*\};/), grab(/function connectSetCovers\(set\)\{[\s\S]*?\n\}/), grab(/function connectSetSummary\(set\)\{[\s\S]*?\n\}/),
  grab(/function connectCoverFacts\(c,set\)\{[\s\S]*?\n\}/), grab(/function connectSetStrip\(set\)\{[\s\S]*?\n\}/), grab(/function connectUpNext\(\)\{[\s\S]*?\n\}/),
].join('\n') + ';this.S=connectState;this.sum=connectSetSummary;this.up=connectUpNext;this.strip=connectSetStrip;this.facts=connectCoverFacts;', ctx);
const future = new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10);
ctx.S.covers = { p1:{ id:'p1', part:1, orderedQty:5, foc_date:'2026-09-01', title:'DNX #3', cover_image_url:'a.jpg' }, p2:{ id:'p2', part:2, orderedQty:2, foc_date:'2026-09-08', title:'DNX #4' }, p3:{ id:'p3', part:3, orderedQty:0, foc_date:future, title:'DNX #5', cycle_id:'cy5' } };
ctx.S.aliases = { old1:'p1' };
const set = { id:'s', name:'Vicentini 5-part', partCount:5, skuIds:['old1', 'p1', 'p2', 'p3'] };
ctx.S.saved = { sets:[set] };
const sum = ctx.sum(set);
assert.equal(sum.covers.length, 3, 'old id resolves to the same cover, listed once');
assert.equal(sum.target, 5);
assert.deepEqual(sum.short.map(c => c.id), ['p2', 'p3'], 'parts ordered short of the set count');
assert.match(ctx.facts(ctx.S.covers.p2, set), /Short: 2 of 5 -- 3 more to finish every set/);
const strip = ctx.strip(set);
assert.equal((strip.match(/TBA/g) || []).length, 2, 'parts 4 and 5 not solicited yet show as gaps');
const up = ctx.up();
assert.match(up, /UP NEXT -- PARTS TO ORDER \(1\)/);
assert.match(up, /FOC in 6 days/);
assert.match(up, /you have 5 of the earlier parts/);
assert.match(up, /order 5 more/);
assert.match(up, /focConnectOpenCycle\('cy5'\)/);
assert.match(ui, /async function focConnectTrackAll\(\)\{/);
assert.match(ui, /connectState\.saved\.sets=connectState\.saved\.sets\.concat\(fresh\);/, 'TRACK ALL only saves after you confirm');
console.log('Connecting cover tracker upgrade checks passed');
