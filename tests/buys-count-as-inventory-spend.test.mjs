import assert from 'node:assert/strict';
import fs from 'node:fs';

// Store ask: every accepted customer buy (cash, Venmo, card, trade-in) is
// inventory spending and must show in Costs, so the month's cash flow is right.
const d = fs.readFileSync('dashboard.html', 'utf8');
const w = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// Both accept paths record it, after the cards go into inventory.
assert.match(d, /await bulkAddBuyListToInventory\(true\);\n  recordBuyInventoryCost\(session, session\.paymentType \|\| document\.getElementById\('buy-session-pay-method'\)\?\.value \|\| 'Buy'\);/);
assert.match(d, /await bulkAddBuyListToInventory\(true\);\n  recordBuyInventoryCost\(session, 'Trade-in'\);/);
// The cash offer is the amount (trade value is the same -- no trade bonus).
assert.match(d, /const amount = Math\.round\(Number\(session\?\.cashOfferTotal \|\| 0\) \* 100\) \/ 100;/);
// One id per acceptance, so a tray accepted twice records both payouts, and
// a failed post is queued and retried through the same route.
assert.match(d, /buySessionId:session\.buySessionId \+ '-' \+ Date\.now\(\)\.toString\(36\)/);
assert.match(d, /enqueueOrReplaceSync\('buy-inventory-cost', session\.buySessionId,/);
assert.match(d, /if\(item\.type === 'buy-inventory-cost'\) \{\n    await postBuyInventoryCost\(item\.payload\);/);

// Worker: any staff role, set-not-add per id, written as an inventory purchase.
const route = w.slice(w.indexOf("if (url.pathname === '/expenses/buy-purchase') {"), w.indexOf("if (url.pathname === '/kv/show-sessions-index/upsert') {"));
assert.ok(route.length > 200, 'missing the buy-purchase route');
assert.ok(w.indexOf("if (url.pathname === '/expenses/buy-purchase') {") < w.indexOf("if (url.pathname.startsWith('/kv/')) {"));
assert.match(route, /requireStoreUser\(request, env, storeId, \['owner','admin','manager','employee'\]\)/);
assert.match(route, /kind: 'inventory', category: isAdd \? 'Inventory added' : 'Customer buys'/);
assert.match(route, /method: 'PATCH', body: JSON\.stringify\(\{ amount, note \}\)/, 'a retry sets the amount instead of adding');
assert.match(route, /if \(!\(amount > 0\) \|\| amount > 100000\)/);
console.log('Buys count as inventory spend checks passed');
