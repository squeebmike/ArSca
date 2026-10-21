import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Store ask: "This is a Lunar FOC shipment slip [Shipment_900192.csv]. Can
// we also accept these in with the receive instead of only images?" The CSV
// already lists every line, so it goes straight to the slip matcher with
// the real discounted price -- no photo reading.
const dash = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
const service = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');
const fn = n => { const s = dash.indexOf('function ' + n + '('); assert.ok(s >= 0, n); return dash.slice(s, dash.indexOf('\n}\n', s) + 2); };
const ctx = {};
vm.runInNewContext([fn('slipCsvRows'), fn('parseSlipCsv'), fn('slipIsCsv'), 'this.api = { parseSlipCsv, slipIsCsv };'].join('\n'), ctx);
const { parseSlipCsv, slipIsCsv } = ctx.api;

// Lunar's layout: shipment number, date, account, a blank line, then the header.
const lunar = '900192\r\n10/16/2026 8:49:05 PM\r\n12345\r\n\r\n'
  + 'Code,Title,Qty,Retail,Discount,Discounted Price,Total,UPC,PO Number,In-Store Date,Item Category,Country of Origin\r\n'
  + '"0826DC0067","ABSOLUTE BATMAN #25 CVR B J SCOTT CAMPBELL CARD STOCK VAR","20","6.99","53","3.2853","65.7060","76194138584602521","0001","10/28/2026","1","CA"\r\n'
  + '"0826DE0873","THUNDERCATS CHEETARA #2 CVR I INC 1:10 ANIMATION ART VIRGIN VAR","1","4.99","50","2.4950","2.4950","72513036736502091","","10/28/2026","1","CA"\r\n'
  + '"0826DC0129","HARLEY QUINN #67 CVR C TERRY DODSON & RACHEL DODSON CARD STOCK VAR (BATMAN BAD SEEDS)","5","4.99","53","2.3453","11.7265","76194137281506731","","10/28/2026","1","CA"\r\n';
const r = JSON.parse(JSON.stringify(parseSlipCsv(lunar)));
assert.equal(r.invoice, '900192', 'the shipment number');
assert.equal(r.onSaleDate, '2026-10-28');
assert.equal(r.totalUnits, 26);
assert.deepEqual(r.lines[0], { code:'76194138584602521', itemCode:'0826DC0067', title:'ABSOLUTE BATMAN #25 CVR B J SCOTT CAMPBELL CARD STOCK VAR', qty:20, netUnitPrice:3.2853 }, 'item code, UPC, quantity and the real discounted price');
assert.equal(r.lines[1].netUnitPrice, 2.495);
assert.match(r.lines[2].title, /& RACHEL DODSON/, 'quoted fields with commas/ampersands survive');
// Other layouts: a different column order and names, a BOM, no preamble.
const other = '﻿Item Code,Quantity,Description,EAN,Net Price\n"A1","3","SOME BOOK #1","9781234567890","$2.10"\n,,,,\n';
const o = JSON.parse(JSON.stringify(parseSlipCsv(other)));
assert.deepEqual(o.lines, [{ code:'9781234567890', itemCode:'A1', title:'SOME BOOK #1', qty:3, netUnitPrice:2.1 }]);
assert.throws(() => parseSlipCsv('name,amount\nfoo,1\n'), /no Code \/ Title \/ Qty header/);
assert.equal(slipIsCsv({ name:'Shipment_900192.csv', type:'' }), true);
assert.equal(slipIsCsv({ name:'slip.jpg', type:'image/jpeg' }), false);

// Wiring: the file picker takes CSVs, CSV lines go to read-slip as lines,
// and the Worker doesn't need the photo reader's key for lines.
assert.match(dash, /<input type="file" id="foc-slip-file" accept="image\/\*,\.csv,text\/csv" multiple hidden/);
assert.match(fn('handleSlipFiles'), /var csvFiles=all\.filter\(slipIsCsv\)/);
assert.match(fn('handleSlipFiles'), /body:JSON\.stringify\(\{storeId:getActiveStoreId\(\),lines:csvAll,invoice:/);
assert.match(service, /if\(!Array\.isArray\(body\.lines\)&&!env\.ANTHROPIC_API_KEY\)return/);
console.log('FOC slip CSV checks passed');
