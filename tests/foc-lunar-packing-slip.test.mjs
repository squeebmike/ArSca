import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { matchSlipLines, mergeSlipLines, slipItemCode } from '../scripts/foc-preorders.mjs';

// Store ask: "Here's the Lunar packing slip. Make sure the software works
// with intaking and pricing etc. There's no costs or retail like the PRH."
// A Lunar slip lists Lunar's own item code (0826DC0141), title and quantity:
// no barcode, no price. Lines match by the item code saved on each cover
// (distributor_sku); cost comes from the store's Lunar discount off cover.

assert.equal(slipItemCode(' 0826dc-0141 '), '0826DC0141');

// Lines from the real slip (Lunar LUN895831, release 10/21/2026).
const skus = [
  { id:'bw-d', cycle_id:'c-lunar', foc_date:'2026-09-28', distributor_sku:'0826DC0141', upc:'76194139217200841', title:'BATWOMAN #8 CVR D DAVID NAKAYAMA', msrp_cents:699, publisher:'DC Comics' },
  { id:'cw-e', cycle_id:'c-lunar', foc_date:'2026-09-28', distributor_sku:'0826DC0146', upc:'76194135682209251', title:'CATWOMAN #92 CVR E', msrp_cents:699, publisher:'DC Comics' },
  { id:'sp-a', cycle_id:'c-lunar', foc_date:'2026-09-28', distributor_sku:'0826IM0341', upc:'70985304892300111', title:'SWEET PAPRIKA HALLOWEEN #1 CVR A', msrp_cents:599, publisher:'Image Comics' },
  { id:'sp-b', cycle_id:'c-lunar', foc_date:'2026-09-28', distributor_sku:'0826IM0342', upc:'70985304892300121', title:'SWEET PAPRIKA HALLOWEEN #1 CVR B', msrp_cents:599, publisher:'Image Comics' },
  { id:'tc-a', cycle_id:'c-lunar', foc_date:'2026-09-28', distributor_sku:'0826DE0850', upc:'72513036767901011', title:'THUNDERCATS (2026) #1 CVR A', msrp_cents:499, publisher:'DYNAMITE Entertainment' },
];
const merged = mergeSlipLines([
  { code:'', itemCode:'0826DC0141', title:'BATWOMAN #8 CVR D DAVID NAKAYAMA BAD SEEDS SPOT FOIL VAR', qty:5, netUnitPrice:0 },
  { code:'', itemCode:'0826DC0141', title:'BATWOMAN #8 CVR D DAVID NAKAYAMA BAD SEEDS SPOT FOIL VAR', qty:5, netUnitPrice:0 }, // overlapping photo
  { code:'', itemCode:'0826DC0146', title:'CATWOMAN #92 CVR E', qty:5, netUnitPrice:0 },
  { code:'', itemCode:'0826IM0341', title:'MIRKA ANDOLFOS SWEET PAPRIKA ... CVR A', qty:2, netUnitPrice:0 },
  { code:'', itemCode:'0826IM0842', title:'MIRKA ANDOLFOS SWEET PAPRIKA ... CVR B', qty:2, netUnitPrice:0 }, // one character misread (3 -> 8)
  { code:'', itemCode:'0826DE0850', title:'THUNDERCATS (2026) #1 CVR A MARK SPEARS', qty:5, netUnitPrice:0 },
  { code:'', itemCode:'0826XX9999', title:'NOT IMPORTED', qty:1, netUnitPrice:0 },
]);
assert.equal(merged.length, 6, 'the same Lunar line read twice counts once');
assert.equal(merged.find(l => l.itemCode === '0826DC0141').qty, 5, 'not doubled');
const m = matchSlipLines(merged, skus);
const by = code => m.find(x => x.itemCode === code);
assert.equal(by('0826DC0141').sku.id, 'bw-d');
assert.equal(by('0826DC0141').how, 'exact');
assert.equal(by('0826DE0850').sku.id, 'tc-a');
assert.equal(by('0826IM0842').sku.id, 'sp-b', 'a one-character misread still matches');
assert.equal(by('0826IM0842').how, 'close', '...but is flagged to check');
assert.equal(by('0826XX9999').sku, null, 'an item code on no imported FOC week stays unmatched');
// PRH barcodes still match exactly as before.
assert.equal(matchSlipLines([{ code:'72513036767901011', title:'TC', qty:1 }], skus)[0].sku.id, 'tc-a');

// The slip read asks for Lunar's item code and keeps its letters.
const foc = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');
assert.match(foc, /required:\['code','itemCode','title','qty','netUnitPrice'\]/);
assert.match(foc, /itemCode: the distributor\\'s own item code when one is printed, exactly as printed with its letters, e\.g\. Lunar\\'s "0826DC0141"/);
assert.match(foc, /distributor_sku=\$\{inFilter\(itemCodes\.slice\(i,i\+40\)\)\}/, 'covers looked up by Lunar item code');
assert.match(foc, /const SLIP_SKU_FIELDS='id,cycle_id,upc,isbn,distributor_sku,publisher,/);

// The read route, end to end, with the slip's lines (no images needed).
const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
globalThis.fetch = async (input) => {
  const url = decodeURIComponent(String(input));
  const ok = d => new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json' } });
  if (url.includes('/auth/v1/user')) return ok({ id:'user-1', email:'staff@example.com' });
  if (url.includes('store_members')) return ok([{ role:'owner' }]);
  if (url.includes('comic_skus?') && url.includes('cycle_id=in.')) return ok(skus);
  if (url.includes('comic_skus?') && url.includes('distributor_sku=in.')) return ok(skus.filter(s => url.includes(s.distributor_sku)));
  if (url.includes('comic_skus?') && url.includes('distributor_sku.like.0826IM*')) return ok(skus.filter(s => s.distributor_sku.startsWith('0826IM')));
  if (url.includes('comic_skus?')) return ok([]);
  if (url.includes('foc_cycles?')) return ok([{ id:'c-lunar', foc_date:'2026-09-28', distributor:'Lunar' }]);
  return ok([]);
};
try {
  const { default: api } = await import('../cloudflare-worker-full.js');
  const env = { OWNER_STORE_IDS: 'store-1', SUPABASE_URL:'https://database.example', SUPABASE_SERVICE_ROLE_KEY:'test-only', ANTHROPIC_API_KEY:'test-key' };
  const res = await api.fetch(new Request('https://api.example/foc/admin/read-slip', { method:'POST', headers:{ Authorization:'Bearer t', 'X-Store-Id':'store-1', 'Content-Type':'application/json' },
    body:JSON.stringify({ storeId:'store-1', invoice:'LUN895831', onSaleDate:'2026-10-21', lines:[
      { code:'', itemCode:'0826DC0141', title:'BATWOMAN #8 CVR D', qty:5, netUnitPrice:0 },
      { code:'', itemCode:'0826IM0842', title:'SWEET PAPRIKA CVR B', qty:2, netUnitPrice:0 },
    ] }) }), env, { waitUntil() {} });
  const d = await res.json();
  assert.equal(d.ok, true, JSON.stringify(d));
  assert.equal(d.invoice, 'LUN895831');
  const bw = d.lines.find(l => l.itemCode === '0826DC0141');
  assert.equal(bw.cover.skuId, 'bw-d');
  assert.equal(bw.cover.itemCode, '0826DC0141');
  assert.equal(bw.cover.publisher, 'DC Comics', 'publisher comes back so the Lunar discount can be applied');
  assert.equal(bw.cover.coverPrice, 6.99, 'cover price (the retail the slip lacks) comes from the FOC file');
  assert.equal(d.lines.find(l => l.itemCode === '0826IM0842').cover.skuId, 'sp-b', 'misread matched via the item-code prefix lookup');
  assert.equal(d.cycles[0].distributor, 'Lunar');
} finally {
  globalThis.fetch = originalFetch;
  globalThis.caches = originalCaches;
}

// Cost: no price on a Lunar slip -> the store's Lunar discount off cover
// (DC 35%, Image 40%, Dynamite 50% by default); PRH keeps its 50% default.
const dash = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
const extract = name => { const s = dash.indexOf('function ' + name + '('); assert.ok(s >= 0, name); return dash.slice(s, dash.indexOf('\n}', s) + 2); };
const ctx = vm.createContext({});
const discounts = dash.slice(dash.indexOf('var LUNAR_PUBLISHER_DISCOUNTS='), dash.indexOf('var lunarDcDiscount'));
vm.runInContext([discounts, 'var lunarDcDiscount=35,lunarImageDiscount=40;', extract('lunarDiscountPct'), extract('lunarEstCostCents'), extract('focReceiveUnitCost'),
  'this.cost = focReceiveUnitCost;'].join('\n'), ctx);
assert.equal(ctx.cost('Lunar', 'DC Comics', 699, 0), 4.54, 'DC $6.99 at 35% off');
assert.equal(ctx.cost('Lunar', 'Image Comics', 599, 0), 3.59, 'Image $5.99 at 40% off');
assert.equal(ctx.cost('Lunar', 'DYNAMITE Entertainment', 499, 0), 2.5, 'Dynamite $4.99 at 50% off');
assert.equal(ctx.cost('Lunar', 'Unknown Press', 499, 0), undefined, 'no rate on file: left to the server default');
assert.equal(ctx.cost('PRH', 'Marvel', 499, 0), undefined, 'PRH without a net price: server 50% default');
assert.equal(ctx.cost('PRH', 'Marvel', 499, 2.99), 2.99, 'an invoice net price always wins');
assert.match(dash, /if\(isLunar\)await loadLunarDiscountSettings\(\);/, 'RECEIVE SHIPMENT on a Lunar week uses the saved DC/Image rates');
assert.match(dash, /unitCost:isLunar\?focReceiveUnitCost\('Lunar',v\.publisher,v\.msrpCents,0\):undefined/);
assert.match(dash, /if\(\(d\.cycles\|\|\[\]\)\.some\(function\(c\)\{return c\.distributor==='Lunar';\}\)\)await loadLunarDiscountSettings\(\);/);
assert.match(dash, /var raw=state\.slip\.lines\.concat\(d\.lines\)\.map\(function\(l\)\{return\{code:l\.code,itemCode:l\.itemCode,/, 'another page keeps the Lunar codes');
assert.match(dash, /dists\.join\('\/'\)\+' invoice '\+inv/, 'the purchase is recorded as a Lunar invoice, not PRH');

console.log('Lunar packing slip checks passed');
