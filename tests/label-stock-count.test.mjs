import assert from 'node:assert/strict';
import fs from 'node:fs';

// Store, 2026-10-31: "so we know how many books we have left" -- a small
// "17 LEFT · 10/31" on each label: the stock count when it was printed, and
// the date, since it's a snapshot.
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
const html = fs.readFileSync('dashboard.html', 'utf8');

const fn = app.slice(app.indexOf('function labelPrintStockCount'), app.indexOf('function setLabelPrintPerStock'));
let stored = null;
const localStorage = { getItem: () => stored, setItem: (k, v) => { stored = v; } };
const { labelStockText, setLabelPrintStockCount } = new Function('localStorage', `${fn}; return { labelStockText, setLabelPrintStockCount };`)(localStorage);
const today = new Date(), date = (today.getMonth() + 1) + '/' + today.getDate();
assert.equal(labelStockText({ stockCount: 17 }), '17 LEFT · ' + date, 'on by default');
assert.equal(labelStockText({ stockCount: 0 }), '0 LEFT · ' + date, 'a real zero, not rounded up to 1');
assert.equal(labelStockText({}), '', 'no count, nothing printed');
setLabelPrintStockCount(false);
assert.equal(labelStockText({ stockCount: 17 }), '', 'can be turned off');

// The entry carries the real count; both print paths show it.
assert.match(app, /stockQty, stockCount:Math\.max\(0, Number\(inventoryAvailableQuantity\(item\)\) \|\| 0\) \};/);
assert.match(app, /\$\{labelStockText\(b\) \? `<div class="wrap-stock">\$\{escHtml\(labelStockText\(b\)\)\}<\/div>` : ''\}/, 'wrap label: back face, bottom corner');
assert.match(app, /<span class="label-sku">\$\{escHtml\(\[b\.condition \|\| b\.meta \|\| '', labelStockText\(b\)\]\.filter\(Boolean\)\.join\(' · '\)\)\}<\/span>/, 'standard label: next to the condition');
assert.match(app, /const boxTop = fy \+ bPadT \+ shopH \+ 4, boxBottom = fy \+ iH - bPadB - stockH;/, 'the PNG wrap label makes room under the QR');
assert.match(app, /t\.fillText\(\[b\.condition \|\| b\.meta \|\| '', labelStockText\(b\)\]\.filter\(Boolean\)\.join\(' · '\), left, y \+ rowH \/ 2\);/);
assert.match(html, /<input type="checkbox" id="label-print-stock-count" onchange="setLabelPrintStockCount\(this\.checked\)">/);
console.log('label stock count checks passed');
