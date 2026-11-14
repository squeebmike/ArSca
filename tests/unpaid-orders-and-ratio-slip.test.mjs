// (store, 2026-11-14) "Vano did 2 orders? I thought he did one" -- the orders board showed a checkout that was never
// paid. And "ratio got imported not at the default prices -- they loaded in at 5 bucks vs the default we have".
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
// 1. The orders board: paid website orders only, never a cancelled one.
const ob = read('scripts/orders-board.mjs'), wk = read('cloudflare-worker-full.js');
assert.ok(ob.includes("&status=in.(completed,succeeded)&select=id`)") && ob.includes("storefrontOrders = (storefrontOrders || []).filter(o => paidSales.has(String(o.sale_id)) && o.fulfillment_status !== 'cancelled');"));
assert.ok(ob.indexOf('paidSales.has') < ob.indexOf('const sfSaleIds = '), 'filtered before its lines are read');
// The 24-hour sweep cancels the website order too (it already cancels the payment, the sale and gives the points back).
assert.ok(wk.includes("`storefront_orders?sale_id=eq.${enc(order.sale_id)}&store_id=eq.${enc(order.store_id)}&fulfillment_status=eq.pending`, { method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ fulfillment_status:'cancelled' }) }"));
// 2. The packing slip: an unpriced ratio cover starts at the ratio default, never the bare cover price.
const fd = read('scripts/foc-dashboard.js');
const pick = name => { const i = fd.indexOf('function ' + name + '('); return fd.slice(i, fd.indexOf('\n', i)); };
const ctx = { state: { slip: { prices: {}, typed: {} } }, slipLineKey: l => l.k };
vm.createContext(ctx);
for (const f of ['slipIsRatio', 'slipRatioDefault', 'slipHasOwnCustomerPrice', 'slipPrice', 'slipOwnPrice']) vm.runInContext(pick(f), ctx);
const line = (cover, k = 'a') => ({ k, cover });
assert.equal(ctx.slipPrice(line({ title: 'X-ORCISTS #1', variantLabel: 'COVER C NICK BRADSHAW 1:25 RATIO VARIANT', coverPrice: 4.99, customerPrice: 4.99, isIncentive: true })), '30.00', '1:25 = cover x 6, rounded up');
assert.equal(ctx.slipPrice(line({ title: 'POWER RANGERS GREEN #4', variantLabel: 'E 1:10 Ratio INCV Foil Variant', coverPrice: 6.99, customerPrice: 0, isIncentive: true })), '21.00', '1:10 = x3 beats foil x2');
assert.equal(ctx.slipPrice(line({ title: 'TMNT #3 Variant RI', variantLabel: '', coverPrice: 4.99, customerPrice: 0, isIncentive: true })), '15.00', 'a ratio with no number counts as 1:10');
assert.equal(ctx.slipPrice(line({ title: 'SPIDER-WOMAN #1', variantLabel: 'COVER D 1:25', coverPrice: 4.99, customerPrice: 49.79, isIncentive: true })), '49.79', 'a price you set wins');
assert.equal(ctx.slipPrice(line({ title: 'ABSOLUTE BATMAN #1', variantLabel: 'Cover A', coverPrice: 4.99, customerPrice: 4.99, isIncentive: false })), '4.99', 'a regular cover stays at its price');
ctx.state.slip.prices.z = '12.00'; assert.equal(ctx.slipPrice(line({ title: 'X', variantLabel: '1:25', coverPrice: 4.99, isIncentive: true }, 'z')), '12.00', 'typed on the slip wins');
assert.equal(ctx.slipOwnPrice(line({ title: 'X', variantLabel: '1:25 RATIO', coverPrice: 4.99, customerPrice: 0, isIncentive: true }, 'q')), true, 'the slip markup leaves ratio covers alone');
assert.ok(read('scripts/foc-preorders.mjs').includes("isIncentive:sku.is_incentive===true,"), 'the slip knows which covers are ratio');
console.log('Unpaid orders off the board, ratio covers at the ratio default: passed');
