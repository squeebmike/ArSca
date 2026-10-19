import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handleFocRequest, pruneCoversMissingFromFile } from '../scripts/foc-preorders.mjs';

// Store report: "When I upload a new FOC for Lunar it still shows old FOC
// books, i.e. Robin Hood for today." A re-import only added/updated covers,
// so ones the distributor dropped from that week's file never left the
// wall. Now they're removed -- unless anything hangs off them.

function makeDb(state) {
  return async (path, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'DELETE') { state.deleted.push(path); return { data: null }; }
    if (path.startsWith('comic_skus?cycle_id=eq.c1&store_id=eq.s1&select=')) return { data: state.skus };
    if (path.startsWith('comic_skus?cycle_id=eq.c1&select=family_id')) return { data: state.skus.filter(s => !state.deleted.some(d => d.includes(s.id))).map(s => ({ family_id: s.family_id })) };
    if (path.startsWith('foc_preorder_items?')) return { data: state.orders.filter(o => path.includes(o)).map(sku_id => ({ sku_id })) };
    if (path.startsWith('foc_incentive_requests?')) return { data: state.requests.filter(o => path.includes(o)).map(sku_id => ({ sku_id })) };
    if (path.startsWith('inventory_items?')) return { data: state.stock.filter(o => path.includes(o)).map(focSkuId => ({ focSkuId })) };
    if (path.startsWith('foc_ebay_stock?')) return { data: [] };
    return { data: [] };
  };
}

{
  const state = {
    skus: [
      { id: 'keep-1', distributor_sku: '1026DE0001', family_id: 'f1', store_quantity: 0, secured_quantity: 0, title: 'STILL IN FILE' },
      { id: 'rh-a', distributor_sku: '0926DE0734', family_id: 'f-rh', store_quantity: 0, secured_quantity: 0, title: 'ROBIN HOOD (2026) #1 CVR A', variant_label: 'Joshua Middleton' },
      { id: 'rh-b', distributor_sku: '0926DE0735', family_id: 'f-rh', store_quantity: 0, secured_quantity: 0, title: 'ROBIN HOOD (2026) #1 CVR B' },
      { id: 'ordered', distributor_sku: '0926DE0999', family_id: 'f2', store_quantity: 0, secured_quantity: 0, title: 'HAS A PREORDER' },
      { id: 'stocked', distributor_sku: '0926DE0998', family_id: 'f2', store_quantity: 3, secured_quantity: 0, title: 'STORE QTY SET' },
      { id: 'onebay', distributor_sku: '0926DE0997', family_id: 'f3', store_quantity: 0, secured_quantity: 0, title: 'EBAY PRESALE' },
    ],
    orders: ['ordered'], requests: [], stock: ['onebay'], deleted: [],
  };
  const r = await pruneCoversMissingFromFile(makeDb(state), 's1', 'c1', ['1026DE0001']);
  assert.equal(r.removed, 2, 'the two Robin Hood covers no longer in the file are removed');
  assert.deepEqual(r.removedTitles, ['ROBIN HOOD (2026) #1 CVR A -- Joshua Middleton', 'ROBIN HOOD (2026) #1 CVR B']);
  assert.deepEqual(r.kept.map(k => [k.skuId, k.reason]).sort(), [['onebay', 'has stock or an eBay presale'], ['ordered', 'has customer preorders'], ['stocked', 'has store/secured quantities']]);
  const skuDeletes = state.deleted.filter(d => d.startsWith('comic_skus?'));
  assert.equal(skuDeletes.length, 1);
  assert.ok(skuDeletes[0].includes('rh-a') && skuDeletes[0].includes('rh-b') && !skuDeletes[0].includes('keep-1') && !skuDeletes[0].includes('ordered'));
  const famDeletes = state.deleted.filter(d => d.startsWith('comic_title_families?'));
  assert.equal(famDeletes.length, 1, 'the emptied Robin Hood family goes too');
  assert.ok(famDeletes[0].includes('f-rh') && !famDeletes[0].includes('f2'));
}
{
  const state = { skus: [{ id: 'a', distributor_sku: 'X1', family_id: 'f', store_quantity: 0, secured_quantity: 0, title: 'A' }], orders: [], requests: [], stock: [], deleted: [] };
  const r = await pruneCoversMissingFromFile(makeDb(state), 's1', 'c1', ['X1']);
  assert.equal(r.removed, 0); assert.equal(state.deleted.length, 0, 'nothing missing, nothing touched');
}

// Wired into both importers, including a re-upload of the same file.
{
  const calls = [];
  const deps = {
    json: (data, status = 200) => ({ status, data }),
    readJsonWithLimit: async (request) => ({ data: await request.json() }),
    requireStoreUser: async () => ({ user: { id: 'u1' } }),
    supabaseAdminFetch: async (env, path, options = {}) => {
      calls.push([options.method || 'GET', path]);
      if (path.startsWith('foc_cycles?store_id=')) return { data: [] };
      if (path.startsWith('foc_cycles?on_conflict=')) return { data: [{ id: 'cycle-1', status: 'open' }] };
      if (path.startsWith('comic_title_families?on_conflict=')) return { data: JSON.parse(options.body).map((f, i) => ({ ...f, id: 'fam-' + i })) };
      if (path.startsWith('comic_skus?cycle_id=eq.cycle-1&store_id=eq.store-1&select=')) return { data: [
        { id: 'old-rh', distributor_sku: '0926DE0734', family_id: 'fam-old', store_quantity: 0, secured_quantity: 0, title: 'ROBIN HOOD (2026) #1 CVR A' },
        { id: 'sku-new', distributor_sku: 'LUNAR-NEW-1', family_id: 'fam-0', store_quantity: 0, secured_quantity: 0, title: 'SAVAGE DRAGON #282' },
      ] };
      return { data: [] };
    },
  };
  const req = { method: 'POST', headers: { get: k => k === 'X-Store-Id' ? 'store-1' : null }, json: async () => ({ rows: [{ ProductCode: 'LUNAR-NEW-1', UPC: '70985305211128211', Title: 'SAVAGE DRAGON #282', Publisher: 'Image Comics', RetailCost: '3.99', FinalOrderCutoff: '10/19/2026', InstoreDate: '11/11/2026' }] }) };
  const res = await handleFocRequest(req, {}, new URL('https://x/foc/admin/import?distributor=Lunar'), deps);
  assert.equal(res.data.ok, true, JSON.stringify(res.data));
  assert.equal(res.data.report.removedSkus, 1, 'the import report says how many dropped covers were removed');
  assert.ok(calls.some(([m, p]) => m === 'DELETE' && p.startsWith('comic_skus?id=in.(old-rh)')), 'the dropped Robin Hood cover is deleted');
  assert.ok(!calls.some(([m, p]) => m === 'DELETE' && p.includes('sku-new')));
}
const src = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');
assert.equal((src.match(/const pruned = await pruneCoversMissingFromFile\(db, storeId, /g) || []).length, 4, 'PRH and Lunar, fresh and same-file re-imports');
const dash = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
assert.match(dash, /no longer in this file removed \(moved to another FOC week or cancelled\)/);
console.log('FOC re-import removes dropped covers checks passed');
