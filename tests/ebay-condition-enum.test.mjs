import assert from 'node:assert/strict';
import fs from 'node:fs';

// Store report (listing the Secret Lair Goblin Storm deck, twice): "Publish
// failed (400): ... invalid item condition information. Item condition is
// required for this category." The Inventory API keeps a condition only as
// its ConditionEnum string; the general LIST ON EBAY tool sent just the
// numeric conditionId, which eBay drops, so items arrived with no condition.
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const start = worker.indexOf('const EBAY_CONDITION_ENUM_BY_ID = {');
const end = worker.indexOf('\n\nfunction buildEbayInventoryItemBody', start);
assert.ok(start > 0 && end > start);
const ebayConditionEnumForId = new Function(worker.slice(start, end) + '\nreturn ebayConditionEnumForId;')();

assert.equal(ebayConditionEnumForId('1000'), 'NEW', 'sealed product / New');
assert.equal(ebayConditionEnumForId(1000), 'NEW');
assert.equal(ebayConditionEnumForId('2750'), 'LIKE_NEW', 'graded cards');
assert.equal(ebayConditionEnumForId('4000'), 'USED_VERY_GOOD', 'ungraded cards');
assert.equal(ebayConditionEnumForId('3000'), 'USED_EXCELLENT');
assert.equal(ebayConditionEnumForId('5000'), 'USED_GOOD');
assert.equal(ebayConditionEnumForId('6000'), 'USED_ACCEPTABLE');
assert.equal(ebayConditionEnumForId(''), '');
assert.equal(ebayConditionEnumForId('9999'), '', 'unknown ids send nothing rather than a guess');

const body = worker.slice(worker.indexOf('function buildEbayInventoryItemBody(b) {'), worker.indexOf('function buildEbayOfferBody('));
assert.match(body, /condition: condition \|\| ebayConditionEnumForId\(conditionId\) \|\| undefined,/, 'every listing carries the enum eBay actually reads');
assert.match(body, /conditionDescription: \(condition \|\| ebayConditionEnumForId\(conditionId\)\) === 'NEW' \? undefined :/, 'no condition description on a New item');

console.log('eBay condition enum checks passed');
