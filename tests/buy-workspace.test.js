const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'dashboard.html'), 'utf8');

assert.match(html, /function buyPriceOptionsFromResearch\(/, 'Research price matrix must be carried into Buy');
assert.match(html, /field === 'priceOption'/, 'Buy must resolve condition\/finish selections locally');
assert.match(html, /manualMarketOverride = false/, 'Researched price selection must clear market overrides');
assert.match(html, /manualOfferOverride = false/, 'Researched price selection must clear offer overrides');

const updateBuyItem = html.match(/function updateBuyItem\([\s\S]*?\r?\n}\r?\n\r?\nfunction resetBuyItemPricing/)?.[0] || '';
assert.ok(updateBuyItem, 'updateBuyItem function was not found');
assert.doesNotMatch(updateBuyItem, /\bfetch\s*\(/, 'Buy dropdown changes must not call an API');

assert.match(html, /function renderCustomerLiveCart\(/, 'Customer display must support live cart review');
assert.match(html, /image_url:item\.img \|\| item\.image/, 'Checkout snapshot must retain item images');
assert.match(html, /function rollbackSpreadsheetImport\(/, 'Device CSV imports must be rollback-capable');
assert.match(html, /value="skip">Skip duplicates/, 'CSV import must default to safe duplicate handling');

console.log('Buy workspace contract checks passed');
