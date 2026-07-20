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

const selectedQuickResult = html.match(/async function selectQuickLookupResult\([\s\S]*?\r?\n}\r?\n\r?\nfunction normalizeQuickCategory/)?.[0] || '';
assert.ok(selectedQuickResult, 'selectQuickLookupResult function was not found');
assert.match(selectedQuickResult, /const inventoryUnavailable = r\.source === 'inventory'/, 'Selected Research result must define its inventory availability before rendering cart actions');

assert.match(html, /APPLY \$\$\{tradeTotal\.toFixed\(2\)\} TO PURCHASE/, 'Accepted buys must offer a direct trade-in-toward-purchase action');
assert.match(html, /pos_pending_trade_purchase/, 'Trade-in purchase handoff must persist until checkout');
assert.match(html, /getStoreCredits\(\)\.find\(c => c\.buySessionId === session\.buySessionId\)/, 'Trade credit issuance must be idempotent per buy session');
assert.match(html, /id="bl-trade-btn"[^>]+onclick="acceptBuyAsTrade\(\)"/, 'Buy screen must expose a direct Trade to Sale action');
assert.match(html, /async function acceptBuyAsTrade\(/, 'Direct trade workflow must accept the buy without a second payout modal');
assert.match(html, /switchTab\('display'\)/, 'Direct trade workflow must open the Sell screen');
assert.match(html, /TRADE CREDIT/, 'Sell screen must label pending trade credit');
assert.match(html, /trade\.applied\.toFixed\(2\)/, 'Sell screen must visibly subtract the calculated trade credit');
assert.match(html, /selectedTenderLines = \[\{ method:'trade_credit'/, 'Checkout must automatically carry the pending trade credit tender');

assert.match(html, /function renderCustomerLiveCart\(/, 'Customer display must support live cart review');
assert.match(html, /image_url:item\.img \|\| item\.image/, 'Checkout snapshot must retain item images');
assert.match(html, /function rollbackSpreadsheetImport\(/, 'Device CSV imports must be rollback-capable');
assert.match(html, /value="skip">Skip duplicates/, 'CSV import must default to safe duplicate handling');

console.log('Buy workspace contract checks passed');
