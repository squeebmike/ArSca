import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Store ask: "When I receive in a shipment I should be able to punch in my
// prices before going to print labels." Each slip line has a SHELF $ box;
// copies are received at that price (locked), so the labels print it, and
// the cover's customer price follows.
const dash = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
const service = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');
const fn = n => { const s = dash.indexOf('function ' + n + '('); assert.ok(s >= 0, n); return dash.slice(s, dash.indexOf('\n}\n', s) + 2); };
const line = n => { const s = dash.indexOf('function ' + n + '('); return dash.slice(s, dash.indexOf('\n', s) + 1); };
const ctx = { state: { slip: { picks:{}, qtys:{}, prices:{} } } };
vm.runInNewContext([line('slipLineKey'), line('slipPrice'), line('focSlipPrice'), 'this.api = { slipPrice, focSlipPrice };'].join('\n'), ctx);
const { slipPrice, focSlipPrice } = ctx.api;
const priced = { code:'761941', title:'ABSOLUTE BATMAN #25 CVR B', qty:20, cover:{ customerPrice:7.99, coverPrice:6.99 } };
const unpriced = { code:'725130', title:'THUNDERCATS CHEETARA #2 CVR A', qty:5, cover:{ customerPrice:0, coverPrice:4.99 } };
assert.equal(slipPrice(priced), '7.99', 'starts at the price already set for the cover');
assert.equal(slipPrice(unpriced), '4.99', 'else the cover price');
focSlipPrice('761941', '9.99');
assert.equal(slipPrice(priced), '9.99', 'what was typed');
// The box is on every line, and the receive sends it.
assert.match(fn('slipLineHtml'), /SHELF \$<input class="tsi" type="number" min="0" step="0\.01"[^>]*value="'\+esc\(slipPrice\(l\)\)\+'" onchange="focSlipPrice\(/);
assert.match(fn('confirmSlipReceive'), /shelfPrice:price>0\?Math\.round\(price\*100\)\/100:undefined/);
assert.match(dash, /window\.focSlipPrice=focSlipPrice;/);

// Worker: the slip knows each cover's customer price; a shelf price is the
// received copies' price (locked) and becomes the cover's customer price.
assert.match(service, /coverPrice:Number\(sku\.msrp_cents\|\|0\)\/100,customerPrice:Number\(sku\.customer_price_cents\|\|0\)\/100\}\);/);
assert.match(service, /SLIP_SKU_FIELDS='[^']*customer_price_cents[^']*'/);
assert.match(service, /const shelfPrice=Number\(line\.shelfPrice\)>0&&Number\(line\.shelfPrice\)<10000\?Math\.round\(Number\(line\.shelfPrice\)\*100\)\/100:0;/);
assert.match(service, /\.\.\.\(shelfPrice\?\{market:shelfPrice,salePrice:shelfPrice,priceOverride:shelfPrice\}:\{\}\),/);
assert.match(service, /body:JSON\.stringify\(\{customer_price_cents:Math\.round\(shelfPrice\*100\)\}\)/);
console.log('FOC slip shelf price checks passed');
