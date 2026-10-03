import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchSlipLines, mergeSlipLines, slipCode } from '../scripts/foc-preorders.mjs';

// Store ask: photograph the PRH invoice/packing list that comes in the box,
// receive what arrived into stock, linked to the FOC covers. Lines match by
// the 17-digit barcode each cover already stores (the slip's titles are cut
// off: "MIDNIGHT XM 1 CRAIN"), across every FOC week on the slip.
const skus = [
  { id:'s-crain', cycle_id:'c-aug31', foc_date:'2026-08-31', upc:'75960621668000151', title:'MIDNIGHT X-MEN #1 COVER F CLAYTON CRAIN 3-PART CONNECTING VARIANT', store_quantity:5, msrp_cents:599 },
  { id:'s-stegman', cycle_id:'c-aug31', foc_date:'2026-08-31', upc:'75960621668000121', title:'MIDNIGHT X-MEN #1 COVER B RYAN STEGMAN', store_quantity:4, msrp_cents:599 },
  { id:'s-sabg', cycle_id:'c-aug31', foc_date:'2026-08-31', upc:'64985600909801071', title:'SABRINA THE TEENAGE WITCH #1 CVR G CAROLINE CASH FOIL VAR', store_quantity:2, msrp_cents:899 },
  { id:'s-gdz', cycle_id:'c-sep07', foc_date:'2026-09-07', upc:'82771403587200151', title:"Godzilla's Monsterpiece Theatre Variant RI (10)", store_quantity:1, msrp_cents:799 },
  { id:'s-xm-a', cycle_id:'c-aug31', foc_date:'2026-08-31', upc:'75960621668000111', title:'MIDNIGHT X-MEN #1 COVER A', store_quantity:4, msrp_cents:599 },
  { id:'s-xm-a-old', cycle_id:'c-aug24', foc_date:'2026-08-24', upc:'75960621668000111', title:'MIDNIGHT X-MEN #1 COVER A (earlier week)', store_quantity:0, msrp_cents:599 },
];
assert.equal(slipCode('7596 0621 6680 00151'), '75960621668000151');

const merged = mergeSlipLines([
  { code:'75960621668000151', title:'MIDNIGHT XM 1 CRAIN', qty:7, netUnitPrice:2.99 },
  { code:'75960621668000151', title:'MIDNIGHT XM 1 CRAIN', qty:7, netUnitPrice:2.99 }, // overlapping photos
  { code:'64985600909801071', title:'SABRINA #1 CVR G', qty:2, netUnitPrice:4.49 },
  { code:'82771403587200151', title:'GDZ MONSTERPIECE KAI', qty:1, netUnitPrice:3.99 },
  { code:'75960621668000I2l', title:'MIDNIGHT XM 1 STEGMA', qty:4, netUnitPrice:2.99 }, // garbage
  { code:'75960621668000122', title:'MIDNIGHT XM 1 STEGMA', qty:4, netUnitPrice:2.99 }, // one digit misread
  { code:'75960621668000111', title:'MIDNIGHT XM 1', qty:4, netUnitPrice:2.99 },
  { code:'75960621681900151', title:'MIDNIGHT SPDRM 1 CRA', qty:5, netUnitPrice:2.99 }, // a week not imported
]);
assert.equal(merged.filter(l => l.code === '75960621668000151').length, 1, 'a line read twice counts once');
assert.equal(merged.find(l => l.code === '75960621668000151').qty, 7, 'not doubled');
const m = matchSlipLines(merged, skus);
const by = code => m.find(x => x.code === code);
assert.equal(by('75960621668000151').sku.id, 's-crain');
assert.equal(by('75960621668000151').how, 'exact');
assert.equal(by('64985600909801071').sku.id, 's-sabg');
assert.equal(by('82771403587200151').sku.cycle_id, 'c-sep07', 'one slip, several FOC weeks');
assert.equal(by('75960621668000122').sku.id, 's-stegman');
assert.equal(by('75960621668000122').how, 'close', 'a one-digit misread matches but is flagged');
assert.equal(by('75960621668000111').sku.id, 's-xm-a', 'a barcode in two weeks goes to the newest');
assert.equal(by('75960621681900151').sku, null, 'a book from a week not imported stays unmatched');
// Two covers equally close never guess.
// ...000101 is one digit off both ...000111 covers' barcode and ...000121 -> ambiguous, never guessed.
assert.equal(matchSlipLines([{ code:'75960621668000101' }], skus)[0].sku, null, 'two equally close covers are never guessed');
console.log('Packing slip matching checks passed');

// The Worker route: reads the photo with Claude (structured JSON), matches,
// and returns covers with what was ordered, customers, and what's already in.
// Ordered on PRH's site, cart imported: every cover carries its PRH quantity
// in secured_quantity (0 when not ordered). An incentive's secured count alone
// would not mean the cart was imported.
const cartWeek = [
  { id:'s-flux', cycle_id:'c-sep14', foc_date:'2026-09-14', upc:'64985600917300121', title:'FLUX HOUSE PRESENTS #1 CVR B', store_quantity:0, secured_quantity:4, msrp_cents:999 },
  { id:'s-flux-c', cycle_id:'c-sep14', foc_date:'2026-09-14', upc:'64985600917300131', title:'FLUX HOUSE PRESENTS #1 CVR C', store_quantity:0, secured_quantity:2, msrp_cents:999 },
  { id:'s-bttwns', cycle_id:'c-sep14', foc_date:'2026-09-14', upc:'82771403584100111', title:'BENEATH THE TREES HALLOWEEN A', store_quantity:0, secured_quantity:0, msrp_cents:799 },
  { id:'s-inc', cycle_id:'c-sep21', foc_date:'2026-09-21', upc:'82771403584100999', title:'SOME INCENTIVE 1:25', store_quantity:0, secured_quantity:1, is_incentive:true, msrp_cents:799 },
];
const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
let claudeBody = null;
const dbUrls = [];
globalThis.fetch = async (input, init = {}) => {
  const url = decodeURIComponent(String(input));
  const ok = d => new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json' } });
  if (url.startsWith('https://api.anthropic.com/v1/messages')) {
    claudeBody = JSON.parse(init.body);
    return ok({ stop_reason:'end_turn', content:[{ type:'text', text:JSON.stringify({ invoice:'1075016466', onSaleDate:'2026-10-07', totalUnits:21, lines:[
      { code:'75960621668000151', title:'MIDNIGHT XM 1 CRAIN', qty:7, netUnitPrice:2.99 },
      { code:'64985600909801071', title:'SABRINA #1 CVR G', qty:2, netUnitPrice:4.49 },
      { code:'82771403587200151', title:'GDZ MONSTERPIECE KAI', qty:1, netUnitPrice:3.99 },
      { code:'75960621681900151', title:'MIDNIGHT SPDRM 1 CRA', qty:4, netUnitPrice:2.99 },
      { code:'64985600917300121', title:'FLUX HOUSE PRESENTS', qty:4, netUnitPrice:4.99 },
      { code:'82771403584100111', title:'BTTWNS HALLOWEEN A', qty:2, netUnitPrice:3.99 },
      { code:'82771403584100999', title:'SOME INCENTIVE', qty:1, netUnitPrice:3.99 },
    ] }) }] });
  }
  if (url.includes('/auth/v1/user')) return ok({ id:'user-1', email:'staff@example.com' });
  if (url.includes('store_members')) return ok([{ role:'owner' }]);
  if (url.includes('/rest/v1/')) dbUrls.push(url);
  if (url.includes('comic_skus?') && url.includes('cycle_id=in.')) return ok([...skus, ...cartWeek].filter(s => url.includes(s.cycle_id)));
  if (url.includes('comic_skus?') && url.includes('upc=in.')) return ok([...skus, ...cartWeek].filter(s => url.includes(s.upc) && s.cycle_id !== 'c-aug24'));
  if (url.includes('comic_skus?')) return ok([]);
  if (url.includes('foc_preorder_items?')) return ok([{ sku_id:'s-crain', quantity:2 }]);
  if (url.includes('inventory_items?')) return ok([{ created_at:'2026-09-30T18:00:00Z', focSkuId:'s-sabg' }]);
  if (url.includes('foc_prh_submissions?')) return ok([{ cycle_id:'c-sep07', line_items:[{ skuId:'s-gdz', finalQty:3 }] }]);
  if (url.includes('foc_cycles?')) return ok([{ id:'c-aug31', foc_date:'2026-08-31', distributor:'PRH' }, { id:'c-sep07', foc_date:'2026-09-07', distributor:'PRH' }, { id:'c-sep14', foc_date:'2026-09-14', distributor:'PRH' }, { id:'c-sep21', foc_date:'2026-09-21', distributor:'PRH' }]);
  return ok([]);
};
try {
  const { default: api } = await import('../cloudflare-worker-full.js');
  const env = { SUPABASE_URL:'https://database.example', SUPABASE_SERVICE_ROLE_KEY:'test-only', ANTHROPIC_API_KEY:'test-key' };
  const res = await api.fetch(new Request('https://api.example/foc/admin/read-slip', { method:'POST', headers:{ Authorization:'Bearer t', 'X-Store-Id':'store-1', 'Content-Type':'application/json' }, body:JSON.stringify({ storeId:'store-1', images:[{ mediaType:'image/jpeg', data:'x'.repeat(200) }] }) }), env, { waitUntil() {} });
  const d = await res.json();
  assert.equal(d.ok, true, JSON.stringify(d));
  assert.equal(claudeBody.model, 'claude-opus-5-5');
  assert.equal(claudeBody.output_config.format.type, 'json_schema', 'structured output, not free text');
  assert.equal(claudeBody.messages[0].content[0].type, 'image');
  assert.equal(d.invoice, '1075016466');
  assert.equal(d.unitsRead, 21);
  assert.equal(d.totalUnits, 21);
  const line = code => d.lines.find(l => l.code === code);
  assert.equal(line('75960621668000151').cover.skuId, 's-crain');
  assert.equal(line('75960621668000151').cover.orderedQty, 7, 'store 5 + customers 2');
  assert.equal(line('75960621668000151').cover.customerQty, 2);
  assert.equal(line('75960621668000151').netUnitPrice, 2.99);
  // Aug 31 was ordered straight with PRH: no saved order, so the order is
  // what's known (store + customers). Sep 7's saved PRH order is the order.
  assert.equal(line('75960621668000151').cover.orderOnFile, false);
  assert.equal(line('82771403587200151').cover.orderOnFile, true);
  assert.equal(line('82771403587200151').cover.orderedQty, 3, 'the saved PRH order quantity, not the store quantity');
  assert.equal(d.cycles.find(c => c.id === 'c-sep07').orderOnFile, true);
  assert.equal(line('64985600917300121').cover.orderOnFile, true, 'an imported PRH cart is the order');
  assert.equal(line('64985600917300121').cover.orderedQty, 4, 'its PRH cart quantity');
  assert.equal(line('82771403584100111').cover.orderOnFile, true);
  assert.equal(line('82771403584100111').cover.orderedQty, 0, 'shipped but not in the imported cart: really not ordered');
  assert.equal(line('82771403584100999').cover.orderOnFile, false, 'an incentive\'s secured count alone is not an imported cart');
  assert.ok(d.missing.some(c => c.skuId === 's-flux-c' && c.orderedQty === 2), 'cart covers missing from the slip are listed');
  assert.equal(line('64985600909801071').cover.receivedAt, '2026-09-30T18:00:00Z', 'already received is flagged');
  assert.equal(line('75960621681900151').cover, null);
  assert.deepEqual(d.missing.map(c => c.skuId).sort(), ['s-flux-c', 's-stegman', 's-xm-a'], 'ordered covers in those weeks that are not on the slip');
  assert.ok(dbUrls.some(u => u.includes('data->>source=eq.foc_receive')));
  const noKey = await api.fetch(new Request('https://api.example/foc/admin/read-slip', { method:'POST', headers:{ Authorization:'Bearer t', 'X-Store-Id':'store-1', 'Content-Type':'application/json' }, body:JSON.stringify({ storeId:'store-1', images:[{ data:'x'.repeat(200) }] }) }), { ...env, ANTHROPIC_API_KEY:'' }, { waitUntil() {} });
  assert.equal(noKey.status, 503);
} finally {
  globalThis.fetch = originalFetch;
  globalThis.caches = originalCaches;
}
console.log('Packing slip read route checks passed');

// Receiving from the slip uses the invoice's net price as the cost.
const foc = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');
assert.match(foc, /cost:Number\(line\.unitCost\)>0&&Number\(line\.unitCost\)<1000\?Math\.round\(Number\(line\.unitCost\)\*100\)\/100:Math\.round\(Number\(sku\.msrp_cents\|\|0\)\*0\.5\)\/100/);
const dash = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
assert.match(dash, /onclick="openPackingSlipScan\(\)">📷 SCAN PACKING SLIP<\/button>/);
assert.ok(dash.includes("api('/foc/admin/receive',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),cycleId:ids[i],lines:byCycle[ids[i]]})})"), 'each FOC week on the slip is received through the normal receive path');
assert.match(dash, /unitCost:l\.netUnitPrice>0\?l\.netUnitPrice:undefined/);
assert.match(dash, /c\.orderOnFile\?'<span style="color:var\(--gold\)">not on your PRH order<\/span>':'<span>no saved order for this week<\/span>'/, 'a week ordered straight with PRH is not flagged as off-order');
console.log('Packing slip receive wiring checks passed');
