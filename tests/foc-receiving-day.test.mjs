import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { arrivalMessage, arrivalTitleList, buildPickList, findLateBooks, handleFocRequest } from '../scripts/foc-preorders.mjs';

// "Your books are in" wording.
assert.equal(arrivalTitleList(['A', 'B', 'A', 'C', 'D', 'E']), 'A, B, C and 2 more');
assert.match(arrivalMessage('order', { name:'Sam Lee', orderNumber:'1042', titles:['DNX #4'], fulfillment:'pickup' }), /^Hi Sam, your Mana Pocket preorder #1042 is in: DNX #4\. It's ready for pickup at the shop\. Reply STOP/);
assert.match(arrivalMessage('order', { name:'Sam', titles:['DNX #4'], fulfillment:'shipping' }), /will ship out soon/);
assert.match(arrivalMessage('pull', { name:'Jo', titles:['X-Men #38'] }), /^Hi Jo, new books for your pull list are in at The Mana Pocket: X-Men #38\./);

// Pick list: website preorders, eBay orders (with books in the same order
// that aren't here yet), pull lists on the family's first cover only.
{
  const covers = buildPickList({
    skus:[{ id:'a', title:'DNX #4', variant_label:'Cover A', family_id:'f1' }, { id:'b', title:'DNX #4', variant_label:'Cover B Smith', family_id:'f1' }, { id:'z', title:'Quiet #1', variant_label:'Cover A', family_id:'f2' }],
    families:[{ id:'f1', series_name:'DNX', title:'DNX #4' }, { id:'f2', series_name:'Quiet', title:'Quiet #1' }],
    preorderItems:[{ sku_id:'a', quantity:2, order:{ id:'o1', order_number:'1042', status:'paid', customer_name:'Sam', customer_phone:'555', fulfillment_method:'pickup' } }, { sku_id:'a', quantity:1, order:{ id:'o2', status:'cancelled' } }],
    presaleRows:[{ id:'p-b', data:{ source:'foc_presale', focSkuId:'b' } }],
    ebayLines:[{ item_id:'p-b', quantity:1, source_id:'ebay:16-1', created_at:'2026-10-01' }],
    orderLines:[{ item_id:'p-b', title:'DNX #4 Cover B - PRESALE', source_id:'ebay:16-1' }, { item_id:'other', title:'Hulk #1 1:25 - PRESALE', source_id:'ebay:16-1' }],
    pullSubs:[{ id:'s1', customer_name:'Jo', series:{ title:'DNX' }, customer:{ phone:'777' } }],
    notified:new Set(['o1']),
  });
  assert.equal(covers.length, 2, 'Quiet #1 owes nobody');
  const a = covers.find(c => c.skuId === 'a'), b = covers.find(c => c.skuId === 'b');
  assert.equal(a.title, 'DNX #4');
  assert.equal(a.website.length, 1, 'cancelled order left out');
  assert.equal(a.website[0].notified, true);
  assert.equal(a.pull.length, 1, 'pull list goes on Cover A');
  assert.equal(b.pull.length, 0);
  assert.equal(a.totalOwed, 3);
  assert.equal(b.ebay[0].orderId, '16-1');
  assert.equal(b.ebay[0].waitingOn.join(), 'Hulk #1 1:25', 'other book in the order is not in this shipment');
}

// Late books: paid, past on-sale, never received.
{
  const late = findLateBooks({
    today:'2026-10-06',
    presaleRows:[
      { data:{ name:'Late #1 - PRESALE', onSaleDate:'2026-10-01', focPresaleOriginalQty:3, qty:1, focSkuId:'s1' } },
      { data:{ name:'Got It #1', onSaleDate:'2026-10-01', focPresaleOriginalQty:2, qty:0, focSkuId:'s2' } },
      { data:{ name:'Nothing Sold #1', onSaleDate:'2026-10-01', focPresaleOriginalQty:0, qty:0, focSkuId:'s3' } },
      { data:{ name:'Not Out #1', onSaleDate:'2026-10-14', focPresaleOriginalQty:2, qty:0, focSkuId:'s4' } },
    ],
    receivedSkuIds:new Set(['s2']),
    preorderItems:[{ sku_id:'w', quantity:1, order:{ status:'paid' }, sku:{ title:'Web #1', on_sale_date:'2026-09-30' } }],
  });
  assert.deepEqual(late.map(l => l.title + ':' + l.waiting), ['Web #1:1', 'Late #1:2']);
}

// Routes are wired and the pick list gathers eBay order context.
{
  const paths = [];
  const deps = {
    json:(data, status = 200) => ({ status, data }),
    requireStoreUser:async () => ({ user:{ id:'u' } }),
    supabaseAdminFetch:async (env, path) => {
      paths.push(path);
      if (path.startsWith('comic_skus?')) return { data:[{ id:'11111111-1111-1111-1111-111111111111', title:'DNX #4', variant_label:'Cover A', family_id:'f1' }] };
      if (path.startsWith('comic_title_families?')) return { data:[{ id:'f1', series_name:'DNX' }] };
      if (path.startsWith('inventory_items?')) return { data:[{ id:'22222222-2222-2222-2222-222222222222', data:{ source:'foc_presale', focSkuId:'11111111-1111-1111-1111-111111111111' } }] };
      if (path.startsWith('pos_sale_lines?') && path.includes('item_id=')) return { data:[{ item_id:'22222222-2222-2222-2222-222222222222', quantity:1, source_id:'ebay:16-9' }] };
      if (path.startsWith('pos_payments?')) return { data:[{ reference:'16-9', provider_metadata:{ labelTransactionIds:['t'] } }] };
      return { data:[] };
    },
  };
  const res = await handleFocRequest({ method:'GET', headers:{ get:() => null } }, {}, new URL('https://x/foc/admin/pick-list?store_id=st&cycle_ids=33333333-3333-3333-3333-333333333333'), deps);
  assert.equal(res.data.ok, true);
  assert.equal(res.data.covers[0].ebay[0].shipped, true, 'label already bought');
  assert.equal(res.data.covers[0].totalOwed, 0);
  assert.ok(paths.some(p => p.includes('source_id=in.("ebay:16-9")')));
}

const server = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');
assert.match(server, /readyOrderIds\.push\(order\.id\);/, 'only orders that just became ready are told');
assert.match(server, /notified=await notifyOrdersReady\(env,deps,db,storeId,readyOrderIds,auth\.user\?\.id\)/);
assert.match(server, /if\(consent\.optedOut\)sent\.errors\.push\('opted out of texts'\);/, 'never texts someone who replied STOP');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.match(worker, /sendSms, smsConsentStatus, persistMessageRecord,\n        inventoryDetailHref/);

// Dashboard: pick list, pull-list texting, late books, markdown, Whatnot.
const ui = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
assert.match(ui, /onclick="openFocPickList\(\)">📋 PICK LIST<\/button>/);
assert.match(ui, /openFocPickList\(\[state\.cycle\.id\]\);/, 'receiving opens the pick list');
assert.match(ui, /if\(!confirm\('Text\/email '\+list\.length\+' pull-list customer/);
assert.match(ui, /onclick="focSlowMarkDown\(/);
assert.match(ui, /onclick="focSlowWhatnot\(/);
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
const grab = re => { const m = app.match(re); assert.ok(m, 'missing ' + re); return m[0]; };
const ctx = { Math, Number };
vm.createContext(ctx);
vm.runInContext([grab(/function slowSellerMarkdownPrice\(price, pct, floor = 0\)\{[\s\S]*?\n\}/), grab(/function lateBooksPulseText\(late = \[\]\)\{[\s\S]*?\n\}/)].join('\n') + ';this.md=slowSellerMarkdownPrice;this.late=lateBooksPulseText;', ctx);
assert.equal(ctx.md(10, 25).next, 7.5);
assert.equal(ctx.md(10, 25, 8).blockedByFloor, true);
assert.equal(ctx.late([]), '');
assert.match(ctx.late([{ title:'Late #1', waiting:2 }, { title:'Web #1', waiting:1 }]), /^LATE BOOKS: 3 paid copies past on-sale and not received \(Late #1; Web #1\)/);
assert.match(app, /const late = await lateBooksPulseAction\(\);\n    if\(late\) actions\.unshift\(late\);/);
assert.match(app, /const flaggedFirst = \[\.\.\.byValueAsc\]\.sort\(\(a, b\) => \(b\.item\.raw\?\.whatnotNextShow \? 1 : 0\)/);
console.log('Receiving day: pick list, arrival texts, late books, markdown checks passed');
