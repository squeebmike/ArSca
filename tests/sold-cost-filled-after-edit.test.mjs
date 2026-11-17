// COST ADDED AFTER A SALE (store, 2026-11-17: "When something doesn't have a cost and it sells, then I add a cost, the
// profit doesn't change" -- a Secret Lair bundle sold on Whatnot for $469 at $0 cost; the $250 cost added later never
// reached the sale).
import assert from 'node:assert/strict';
import fs from 'node:fs';
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
const r0 = worker.indexOf("if (url.pathname === '/sales/fill-item-cost' && request.method === 'POST') {");
assert.ok(r0 > 0);
const route = worker.slice(r0, worker.indexOf("if (url.pathname === '/whatnot/apply-costs'", r0));
assert.ok(route.includes("requireStoreUser(request, env, storeId, ['owner','admin','manager'])"));
assert.ok(route.includes('&item_id=eq.${encodeURIComponent(itemId)}&cost_basis=eq.0&'), 'only that item\'s sales still at $0');
assert.ok(route.includes('&cost_basis=eq.0`, { method: \'PATCH\''), 'and the update itself only lands on a $0 line (no double fill)');
assert.ok(route.includes('const profit = Math.round(((Number(l.profit) || 0) - total) * 100) / 100;'), 'profit drops by the cost');
// The Secret Lair: $469, fees $51.42, profit $417.58, cost $250 -> profit $167.58.
{
  const l = { quantity: 1, profit: 417.58 }, unit = 250, total = Math.round(unit * Math.max(1, l.quantity) * 100) / 100;
  assert.equal(Math.round(((l.profit) - total) * 100) / 100, 167.58);
}
assert.ok(route.includes('const costBasis = l.source_id ? unit : total;'), 'filled the way the line was written (per copy for channel sales, whole line for the register)');
assert.ok(app.includes("if(updates && Number(updates.cost) > 0) fillSoldCostAfterEdit(item.supabaseRowId || item.id, updates.cost);"), 'every item save with a cost');
assert.ok(app.includes("storeWorkerFetch('/sales/fill-item-cost'"));
console.log('Cost added after a sale reaches the sale: passed');
