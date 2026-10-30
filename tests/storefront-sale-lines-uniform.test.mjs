import assert from 'node:assert/strict';
import fs from 'node:fs';

// Store, 2026-10-29: a customer couldn't get past shipping to the card page.
// The checkout saved the item lines and a "Shipping" line in one batch, but
// the item lines had condition/image_url and the shipping line didn't; the
// database turns such a batch down ("All object keys must match"), so every
// shipped website order from 2026-10-23 had a sale with no items.
const worker = fs.readFileSync(new URL('../cloudflare-worker-full.js', import.meta.url), 'utf8');

// insertSaleLines gives every row every key.
const fnSrc = worker.slice(worker.indexOf('async function insertSaleLines'), worker.indexOf('async function loadCartForShipping'));
const calls = [];
const insertSaleLines = new Function('supabaseAdminFetch', `${fnSrc}; return insertSaleLines;`)(async (env, path, options) => {
  calls.push(JSON.parse(options.body));
  return { response: { ok: true, status: 201 }, data: null };
});
assert.equal(await insertSaleLines({}, [
  { id: 'a', title: 'Batman #1', condition: 'NM', image_url: 'x.jpg' },
  { id: 'b', title: 'Shipping', profit: 0 },
]), '');
const [rows] = calls;
const keys = rows.map(r => Object.keys(r).sort().join(','));
assert.equal(new Set(keys).size, 1, 'every row has the same keys: ' + keys.join(' | '));
assert.equal(rows[1].condition, null);
assert.equal(rows[0].profit, null);

// A rejected write is reported, not ignored.
const failing = new Function('supabaseAdminFetch', `${fnSrc}; return insertSaleLines;`)(async () => ({ response: { ok: false, status: 400 }, data: { message: 'All object keys must match' } }));
assert.equal(await failing({}, [{ id: 'a' }]), 'All object keys must match');

// Both the website checkout and record-order (wo-checkout) use it, and their
// shipping lines carry the same keys as the item lines.
assert.equal((worker.match(/const linesError = await insertSaleLines\(env, saleLines\);/g) || []).length, 2);
assert.equal((worker.match(/title:'Shipping', category:'Shipping', quantity:1, unit_price:shipping, original_price:shipping, adjusted_price:shipping, discount_amount:0, cost_basis:shipping, profit:0, condition:'', image_url:null \}/g) || []).length, 2);
assert.doesNotMatch(worker, /await supabaseAdminFetch\(env, 'pos_sale_lines', \{ method:'POST', headers:\{ Prefer:'return=minimal' \}, body:JSON\.stringify\(saleLines\) \}\);/, 'no unchecked batch writes left');
// The checkout stops (and cancels the empty sale) instead of carrying on.
const checkout = worker.slice(worker.indexOf("url.pathname === '/public/storefront/checkout'"), worker.indexOf("url.pathname === '/public/storefront/shipping-quote'"));
assert.match(checkout, /if \(linesError\) \{[\s\S]*?status:'cancelled'[\s\S]*?return json\(\{ ok:false, error:'Could not start checkout/);
console.log('storefront sale lines checks passed');
