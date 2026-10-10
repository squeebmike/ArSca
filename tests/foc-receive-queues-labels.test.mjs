import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store ask: "When I intake the comics with the slip, I want it to queue up
// labels for all comics I just intook." /foc/admin/receive now says which
// inventory rows got shelf copies and how many; the dashboard opens the
// label printer with exactly those. Copies set aside for website customers
// or eBay buyers don't get a price sticker.
const { handleFocRequest, shortCustomerName } = await import('../scripts/foc-preorders.mjs');
assert.equal(shortCustomerName('Sean Vanoverbeke'), 'Sean V.');
assert.equal(shortCustomerName('  sam  '), 'sam');
assert.equal(shortCustomerName('Mary Ann de la cruz'), 'Mary C.');
assert.equal(shortCustomerName(''), '');

const STORE = '0f9dd4bc-42a7-487e-a972-2905d24513e9', CYCLE = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const skus = [
  { id:A, cycle_id:CYCLE, store_id:STORE, title:'Book A #1', variant_label:'Cover A', msrp_cents:499, customer_price_cents:499 },
  { id:B, cycle_id:CYCLE, store_id:STORE, title:'Book B #1', variant_label:'Cover B', msrp_cents:599, customer_price_cents:599 },
  { id:C, cycle_id:CYCLE, store_id:STORE, title:'Book C #1', variant_label:'Cover A', msrp_cents:399, customer_price_cents:399, safety_stock_qty:1 },
];
const inserts = [];
const deps = {
  readJsonWithLimit: async req => ({ data:await req.json() }),
  requireStoreUser: async () => ({ user:{ id:'staff' } }),
  json: (body, status = 200) => ({ status, body }),
  supabaseAdminFetch: async (env, path, opts = {}) => {
    if (path.startsWith('comic_skus?')) return { data:skus };
    if (path.startsWith('comic_title_families?')) return { data:[] };
    // One website customer paid for a copy of A.
    if (path.startsWith('foc_preorder_items?cycle_id=')) return { data:[{ id:'pi1', sku_id:A, order_id:'o1', quantity:1, created_at:'2026-09-01', order:{ id:'o1', status:'paid', fulfillment_method:'pickup', customer_name:'Sean Vanoverbeke' } }] };
    // B is a live eBay presale: 10 listed, 7 sold, 3 still for sale.
    if (path.startsWith('inventory_items?store_id=') && !opts.method) return { data:[{ id:'presale-B', status:'presale', data:{ source:'foc_presale', focSkuId:B, ebayOfferId:'off1', focPresaleOriginalQty:10, qty:3 } }] };
    if (path === 'inventory_items' && opts.method === 'POST') {
      const rows = JSON.parse(opts.body); inserts.push(...rows);
      return { data:rows.map(r => ({ id:'new-' + r.data.focSkuId })) };
    }
    if (path.startsWith('foc_preorder_items?order_id=')) return { data:[{ order_id:'o1', status:'committed' }] };
    if (path.startsWith('foc_preorder_orders?id=')) return { data:[{ id:'o1', status:'reserved' }] };
    return { data:[] };
  },
};
const request = new Request('https://w.test/foc/admin/receive', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ storeId:STORE, cycleId:CYCLE, lines:[{ skuId:A, receivedQty:5 }, { skuId:B, receivedQty:10 }, { skuId:C, receivedQty:2 }] }) });
const res = await handleFocRequest(request, {}, new URL(request.url), deps);
assert.equal(res.status, 200, JSON.stringify(res.body));
assert.equal(res.body.ok, true);
const labels = Object.fromEntries(res.body.labelItems.filter(x => !x.flag).map(x => [x.itemId, x.copies]));
assert.deepEqual(labels, { ['new-' + A]:4, 'presale-B':3, ['new-' + C]:2 },
  'A: 5 in, 1 for the website customer -> 4 labels; B: 10 in, 7 to eBay buyers, the 3 unsold presale copies go on the shelf; C: 2 in (1 held back is still a store copy)');
assert.ok(!('new-' + B in labels), 'B\'s new row holds only copies already sold on eBay -- no labels');
// Store ask: "it should also flag the already sold books in that order."
const flagged = res.body.labelItems.filter(x => x.flag).map(x => [x.itemId, x.copies, x.flag]);
assert.deepEqual(flagged, [['new-' + A, 1, 'HOLD · Sean V.'], ['new-' + B, 7, 'SOLD · EBAY BUYER']],
  'the website customer\'s copy is flagged HOLD with their name; the 7 eBay presale buyers\' copies are flagged SOLD');
const order = res.body.labelItems.map(x => x.skuId);
assert.deepEqual(order, [A, A, B, B, C], 'each book\'s flagged copies follow its shelf labels');
const byId = Object.fromEntries(res.body.receivedSummary.map(r => [r.skuId, r]));
assert.equal(byId[A].reservedForCustomers, 1);
assert.equal(byId[B].reservedForEbayPresale, 7);
assert.equal(byId[C].safetyStockHeld, 1);
assert.equal(res.body.createdInventoryCount, 5 + 7 + 2, 'the copy count reported is unchanged');
console.log('FOC receive reports which books get shelf labels checks passed');

// ── Dashboard wiring ──
const dash = fs.readFileSync('dashboard.html', 'utf8');
const foc = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
const q = dash.slice(dash.indexOf('async function queueLabelsForReceivedItems('), dash.indexOf('window.queueLabelsForReceivedItems'));
assert.match(q, /await loadInventory\(\);/, 'reloads inventory so the new books are there');
assert.match(q, /: \{ \.\.\.entry, qty:r\.copies \}\);/, 'one label per shelf copy');
assert.match(q, /openLabelPrintModal\(null, batch\);/);
{
  // Runs it: two receive batches for the same row add up; flagged copies
  // get their own labels carrying the flag, next to their book.
  const opened = [];
  const fn = new Function('loadInventory', 'all', 'labelBatchEntryFromItem', 'openLabelPrintModal', 'toast_dash', q + '\nreturn queueLabelsForReceivedItems;')(
    async () => {}, [{ id:'r1', name:'Book A' }, { id:'r2', name:'Book C' }], i => ({ id:i.id, name:i.name, badge:'', qty:99, stockQty:99 }), (seed, batch) => opened.push(batch), () => {});
  assert.equal(await fn([
    { itemId:'r1', copies:2 }, { itemId:'r2', copies:2 }, { itemId:'r1', copies:1 },
    { itemId:'r1', copies:1, flag:'HOLD · Sean V.' }, { itemId:'gone', copies:5 }, { itemId:'r2', copies:0 },
    { itemId:'r2', copies:3, flag:'SOLD · EBAY BUYER' },
  ]), 9);
  assert.deepEqual(opened[0].map(b => [b.itemId || b.id, b.qty, b.soldFlag || '']), [['r1', 3, ''], ['r1', 1, 'HOLD · Sean V.'], ['r2', 2, ''], ['r2', 3, 'SOLD · EBAY BUYER']]);
  const hold = opened[0][1];
  assert.equal(hold.badge, 'HOLD · Sean V.', 'the flag prints on the label');
  assert.notEqual(hold.id, 'r1', 'its own entry, so its count and the shelf count stay separate');
  assert.equal(hold.stockQty, 1);
  assert.equal(await fn([]), 0, 'nothing received, nothing opened');
  assert.equal(opened.length, 1);
}
const slip = foc.slice(foc.indexOf('async function confirmSlipReceive('), foc.indexOf('// RECEIVING-DAY PICK LIST'));
assert.match(slip, /labelItems=labelItems\.concat\(d\.labelItems\|\|\[\]\);/, 'every FOC week on the slip adds its books');
assert.match(slip, /renderSlipReceived\(done,s\);\n\s*state\.slip=null;\n\s*await queueReceivedLabels\(labelItems,done\);/, 'the packing slip queues labels once received');
assert.match(slip, /renderSlip\(\);await queueReceivedLabels\(labelItems,done\);return;/, 'and for the weeks that did receive when some failed');
const ship = foc.slice(foc.indexOf('async function confirmReceiveShipment('), foc.indexOf('async function quickAddFocSkuToInventory('));
assert.match(ship, /await queueReceivedLabels\(d\.labelItems,d\.receivedSummary\);/, 'RECEIVE SHIPMENT does too');
assert.match(foc, /onclick="focPrintReceivedLabels\(\)">🏷️ PRINT LABELS<\/button>/, 'the received screen can bring them back up');
assert.match(foc, /window\.focPrintReceivedLabels=function\(\)\{queueReceivedLabels\(pickState\.labelItems,\[\]\);\};/);
assert.match(dash, /const item = \(all \|\| \[\]\)\.find\(i => i\.id === \(batchEntry\.itemId \|\| batchEntry\.id\)\) \|\| batchEntry;/, 'a flagged label\'s QR still points at its book');
assert.match(dash, /const item = \(all \|\| \[\]\)\.find\(i => i\.id === \(entry\.itemId \|\| itemId\)\);/, 'and a price edit on it saves to the book');
assert.match(dash, /\$\{b\.soldFlag \? `<b style="color:var\(--red\)/, 'the label list shows the flag in red');
assert.match(foc, /flagged HOLD\/SOLD/, 'the receiving message counts them');
console.log('Received comics queue their labels checks passed');
