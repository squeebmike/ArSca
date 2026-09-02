const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const dashboard=fs.readFileSync(path.join(__dirname,'..','dashboard.html'),'utf8');
assert.match(dashboard,/if\(name === 'inventory'\).*filterTable\(\).*setInvView\(_invView\)/s);
assert.match(dashboard,/Delete Test \/ Accident/);
assert.match(dashboard,/Type DELETE/);
assert.match(dashboard,/function inventoryDeleteBlockReason/);
assert.match(dashboard,/item\.soldAt \|\| item\.saleId \|\| item\.status === 'sold'/);
assert.match(dashboard,/buySessionId is source provenance, not proof of a completed payout/);
assert.match(dashboard,/!deleteBlockReason\?`<button class="hbtn danger"/, 'archived accidental entries can expose permanent delete');
assert.match(dashboard,/function editConsignorPerson/);
assert.match(dashboard,/function deleteConsignorPerson/);
assert.match(dashboard,/id="tab-browse"/);
assert.match(dashboard,/function renderCustomerInventoryBrowser/);
assert.match(dashboard,/Cost and private store data are hidden/);
assert.match(dashboard,/mutedTextColor:'rgba\(228,228,232,.68\)'/);
assert.match(dashboard,/Cost basis stays unchanged/);
const priceSyncApply = dashboard.match(/async function applySelectedPriceSyncUpdates\(\)[\s\S]*?function updatePriceAlertBanner/)?.[0] || '';
assert.ok(priceSyncApply, 'price sync apply function exists');
assert.doesNotMatch(priceSyncApply, /\bcost\s*:/, 'price sync must not update cost basis');

// Inventory aging report -- days in stock, distinct from price staleness.
assert.match(dashboard,/function inventoryDaysInStock/, 'inventory aging needs a days-in-stock helper');
assert.match(dashboard,/function inventoryIsAgedStock/, 'inventory aging needs an aged-stock threshold check');
assert.match(dashboard,/function inventoryAgingBuckets/, 'inventory aging needs a bucket breakdown');
assert.match(dashboard,/id="inventory-aging-panel"/, 'inventory aging report needs a mounted panel');
assert.match(dashboard,/function renderInventoryAgingPanel/, 'inventory aging report needs a render function');
assert.match(dashboard,/renderInventoryAgingPanel\(\);\s*renderTable\(\);/, 'inventory aging report must refresh whenever the table filters/re-renders');
// Aging buckets are now their own independently-combinable filter group
// (see the multi-select filter rework) instead of a branch on the old
// shared activeF -- inventoryMatchesAge is the successor predicate.
assert.match(dashboard,/function inventoryMatchesAge\(i, age\)\{/, 'aging buckets must be filterable from the inventory table');
assert.match(dashboard,/return i\.status === 'in_stock' && inventoryAgingBucket\(i\) === age;/, 'aging bucket filter must match the item\'s own computed bucket');
console.log('Inventory usability contract checks passed');
