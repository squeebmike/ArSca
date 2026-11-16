// SOLD ITEMS on a phone (store, 2026-11-15: "I can't see this" -- FEES, PROFIT, CHANNEL and DATE ran off the right edge,
// since tables stop scrolling sideways at phone width). Each sale is a card there; the CSS is tied to the sold table only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const html = fs.readFileSync('dashboard.html', 'utf8');
assert.ok(html.includes('<div class="tbl-wrap" id="sold-table-wrap">'), 'the sold table has its own wrap');
const at = html.indexOf('#sold-table-wrap thead{display:none;}');
assert.ok(at > 0, 'phone cards hide the header row');
for (const label of ['SALE', 'BOOK COST', 'FEES', 'PROFIT', 'CHANNEL', 'DATE']) assert.ok(html.includes(`::before{content:'${label}';}`), label + ' labelled on each card');
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
const body = app.slice(app.indexOf("tb.innerHTML=rows.slice(0,100).map(i=>{"), app.indexOf('function filterSold(){'));
assert.equal((body.match(/<td/g) || []).length, 10, 'ten cells, in the order the card CSS expects');
console.log('Sold items phone cards: passed');
