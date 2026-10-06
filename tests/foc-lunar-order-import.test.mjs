import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handleFocRequest } from '../scripts/foc-preorders.mjs';

// Store ask: "Here's the Lunar order, I need the dashboard to accept it."
// Lunar's export: Code,Title,Qty,Retail,Discount,Discounted Price,Total,UPC.
// The same upload sets ordered (secured) and store quantities, matching by
// UPC or by Lunar's own item code.
const skus = [
  { id:'s-sup-a', upc:'76194138585302511', distributor_sku:'0926DC0056', title:'ABSOLUTE SUPERMAN #25 CVR A', variant_label:'Cover A' },
  { id:'s-sup-j', upc:'99999999999999999', distributor_sku:'0926DC0065', title:'ABSOLUTE SUPERMAN #25 CVR J', variant_label:'Rafa Sandoval' }, // UPC differs: matched by code
  { id:'s-ivy', upc:'76194137625704911', distributor_sku:'0826DC0121', title:'POISON IVY #49 CVR A', variant_label:'Cover A' },
];
const patches = [];
const deps = {
  json:(data, status = 200) => ({ status, data }),
  readJsonWithLimit:async r => ({ data:await r.json() }),
  requireStoreUser:async () => ({ user:{ id:'u1' } }),
  supabaseAdminFetch:async (env, path, options = {}) => {
    if (path.startsWith('comic_skus?cycle_id=eq.lunar-1')) return { data:skus };
    if (options.method === 'PATCH' && path.startsWith('comic_skus?id=eq.')) { patches.push({ id:path.match(/id=eq\.([^&]+)/)[1], body:JSON.parse(options.body) }); return { data:[] }; }
    return { data:[] };
  },
};
const rows = [
  { code:'0926DC0056', title:'ABSOLUTE SUPERMAN #25 CVR A RAFA SANDOVAL GATEFOLD TRIPTYCH', upc:'76194138585302511', quantity:5 },
  { code:'0926DC0065', title:'ABSOLUTE SUPERMAN #25 CVR J RAFA SANDOVAL RIGHT CONNECTING CARD STOCK VAR', upc:'76194138585302522', quantity:5 },
  { code:'0826IM8927', title:'OFIUSA #1 (OF 6) 2ND PTG (MR)', upc:'70985304860200112', quantity:1 },
];
const res = await handleFocRequest({ method:'POST', headers:{ get:() => null }, json:async () => ({ storeId:'st', cycleId:'lunar-1', rows }) }, {}, new URL('https://x/foc/admin/prh-cart-import'), deps);
assert.equal(res.data.ok, true, JSON.stringify(res.data));
assert.equal(res.data.matchedCount, 2);
const by = Object.fromEntries(patches.map(p => [p.id, p.body]));
assert.deepEqual(by['s-sup-a'], { secured_quantity:5, store_quantity:5 }, 'matched by UPC');
assert.deepEqual(by['s-sup-j'], { secured_quantity:5, store_quantity:5 }, 'matched by Lunar item code when the UPC differs');
assert.deepEqual(by['s-ivy'], { secured_quantity:0, store_quantity:0 }, 'a cover not in the order is zeroed, same as the PRH cart');
assert.deepEqual(res.data.unmatchedRows, [{ upc:'70985304860200112', code:'0826IM8927', title:'OFIUSA #1 (OF 6) 2ND PTG (MR)', quantity:1 }], 'an unmatched line is reported with its title');

// Dashboard: the upload reads Lunar's columns and the button says so.
const ui = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
assert.match(ui, /var upcKey=keyFor\(\['isbn \/ upc','upc','isbn'\]\);var codeKey=keyFor\(\['code','item code','diamond code'\]\)/);
assert.match(ui, /var qtyKey=keyFor\(\['quantity','qty','order qty'\]\);/);
assert.match(ui, /\(c\.distributor==='Lunar'\?'UPLOAD LUNAR ORDER':'UPLOAD PRH CART'\)/);
console.log('Lunar order import checks passed');
