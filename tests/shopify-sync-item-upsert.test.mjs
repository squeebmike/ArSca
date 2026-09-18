import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// shopifyUpsertItem builds the productSet payload that mirrors one
// inventory_items row into Shopify. It must be idempotent (re-pushing the
// same item updates the existing Shopify product instead of creating a
// duplicate) and must always land the current quantity, not just whatever
// was set on first creation.

assert.match(worker, /async function shopifyUpsertItem\(env, invRow\) \{/, 'missing shopifyUpsertItem');
const fnStart = worker.indexOf('async function shopifyUpsertItem(env, invRow) {');
const fnEnd = worker.indexOf('\n}', fnStart) + 2;
const fn = worker.slice(fnStart, fnEnd);

assert.match(fn, /identifier: d\.shopifyProductId \? \{ id: d\.shopifyProductId \} : \{ customId: invRow\.id \}/, 'must upsert by the existing Shopify product id once one exists, or by our own inventory item id on first push -- never create() a fresh product every push');
assert.match(fn, /sku: invRow\.id,/, 'the Shopify variant sku must be set to our own inventory_items row id, so the order webhook can match a sold line item straight back to it without a separate sku map');
assert.match(fn, /inventorySetQuantities/, 'must set the live quantity via inventorySetQuantities');
assert.match(fn, /await shopifyGraphQL\(env, mutation, \{ input \}\);/, 'the product upsert must go through shopifyGraphQL (and therefore the retrying fetch), not a raw call');
assert.match(fn, /shopifyListedAt: new Date\(\)\.toISOString\(\), shopifyWithdrawnAt: ''/, 'a successful (re-)push must clear any prior shopifyWithdrawnAt -- otherwise a re-listed item would still read as withdrawn');

console.log('shopifyUpsertItem payload shape checks passed');

// Wired into the push route, and the route persists what shopifyUpsertItem
// returns back onto the inventory_items row so later withdrawal/order
// matching has the ids it needs.
const routeStart = worker.indexOf("if (url.pathname === '/shopify/sync-item') {");
assert.notEqual(routeStart, -1, 'missing /shopify/sync-item route');
const routeEnd = worker.indexOf("if (url.pathname === '/shopify/end') {", routeStart);
const routeBody = worker.slice(routeStart, routeEnd);
assert.match(routeBody, /requireStoreUser\(request, env, storeId, \['owner','admin'\]\)/, 'push route must be staff-authed the same way /ebay/list is');
assert.match(routeBody, /const shopifyFields = await shopifyUpsertItem\(env, invRow\);/, 'route must call shopifyUpsertItem for each item');
assert.match(routeBody, /const nextData = \{ \.\.\.\(invRow\.data \|\| \{\}\), \.\.\.shopifyFields \};/, 'the returned Shopify ids/timestamps must be merged back onto the item, not discarded');
assert.match(routeBody, /itemIds\.filter\(id => \/\^\[0-9a-f-\]\{36\}\$\/i\.test\(String\(id \|\| ''\)\)\)/, 'itemIds must be validated as real UUIDs before being used in a query, same guard the bulk customer-visibility route uses');

console.log('Shopify sync-item route wiring checks passed');
