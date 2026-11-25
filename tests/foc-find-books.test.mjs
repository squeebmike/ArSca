import fs from 'node:fs';
import assert from 'node:assert/strict';
// Store, 2026-11-25: "Is there a way to search for books across each FOC in the dashboard, so I can find them and add
// them easier than looking through FOC weeks?"
const { adminFindBooks } = await import('../scripts/foc-preorders.mjs');
const calls = [];
const deps = { requireStoreUser: async () => ({}), json: (b, s = 200) => ({ b, s }),
  supabaseAdminFetch: async (env, path) => { calls.push(path); return { data: [{ id: 's1', cycle_id: 'c1', distributor: 'Lunar', title: 'ROBIN HOOD (2026) #1', variant_label: 'Cvr J 1:10 Nathan Szerdy Virgin', foc_date: '2026-11-02', on_sale_date: '2026-11-25', store_quantity: 1, customer_price_cents: 1999 }] }; } };
const r = await adminFindBooks({}, {}, deps, new URL('https://w/foc/admin/find-books?store_id=abc&q=robin hood 1:10'));
assert.equal(r.b.books[0].title, 'ROBIN HOOD (2026) #1'); assert.equal(r.b.books[0].ordered, 1); assert.equal(r.b.books[0].price, 19.99);
assert.ok(calls[0].includes('and=(or(title.ilike.') && (calls[0].match(/or\(title/g) || []).length === 3, 'every word has to match');
assert.ok(calls[0].includes('foc_date=gte.') && calls[0].includes('order=foc_date.asc'));
const short = await adminFindBooks({}, {}, deps, new URL('https://w/foc/admin/find-books?store_id=abc&q=r'));
assert.deepEqual(short.b.books, []);
const ui = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
assert.ok(ui.includes('🔎 FIND A BOOK IN ANY FOC WEEK') && ui.includes('oninput="focFindBooks(this.value)"') && ui.includes("storeQuantity:n") && ui.includes('await openCycle(cycleId);'));
assert.ok(fs.readFileSync('scripts/foc-preorders.mjs', 'utf8').includes("if(path==='/foc/admin/find-books'&&request.method==='GET')return adminFindBooks(request,env,deps,url);"));
console.log('Find a book in any FOC week: passed');
