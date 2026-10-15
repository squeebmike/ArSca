import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store report: a $10 Whatnot sale -- Whatnot charged $1.56 ($0.80 8%
// commission + $0.76 processing on price + shipping + tax), the modal said
// $1.30-$1.59. EXACT FEE takes the real number off the receipt.
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const extractFn = name => { const s = dashboard.indexOf('function ' + name + '('); assert.ok(s >= 0, name); return dashboard.slice(s, dashboard.indexOf('\n}\n', s) + 2); };
const fee = new Function(extractFn('externalSaleFee') + 'return externalSaleFee;')();
assert.equal(fee(10, 10.9, 0.3, ''), 1.39, 'estimate when nothing typed');
assert.equal(fee(10, 10.9, 0.3, '1.56'), 1.56, 'the receipt number wins');
assert.equal(fee(10, 10.9, 0.3, '0'), 0, 'a typed zero is a real zero');
assert.equal(fee(10, 10.9, 0.3, 'abc'), 1.39);
assert.match(dashboard, /<input id="ext-sale-fee-exact" type="number"/);
assert.match(extractFn('submitExternalSale'), /const feeAmount = externalSaleFee\(salePrice, pct, flat, document\.getElementById\('ext-sale-fee-exact'\)\?\.value\);/);
assert.match(extractFn('updateExternalSalePreview'), /externalSaleFee\(price, pct, flat,/);
assert.match(dashboard, /Whatnot also takes 2\.9% of the buyer\\'s shipping and tax/);
console.log('External sale exact fee checks passed');
