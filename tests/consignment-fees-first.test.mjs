import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Store ask: how should a consignment payout work on an eBay sale ("do it
// how you think is best")? On an online sale the marketplace's fees come off
// first and the split is of what's left; a register sale has no fee and
// splits the full price. Goblin Storm (Sean C, 33% store): $445.50 sold,
// $60.78 eBay fees -- before, the store paid the whole fee out of its 33%
// and kept about 19%. Sales recorded before this keep no fee.
const ui = readFileSync(new URL('../scripts/dashboard-app.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../cloudflare-worker-full.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase-migrations/2026-10-22-consignment-marketplace-fee.sql', import.meta.url), 'utf8');
assert.match(migration, /alter table public\.consignment_items add column if not exists marketplace_fee numeric not null default 0;/);

const pick = name => { const start = ui.indexOf('function ' + name + '('); assert.ok(start >= 0, name); return ui.slice(start, ui.indexOf('\n', start)); };
const lib = new Function(['consignMoney', 'consignSaleValue', 'consignFee', 'consignSplitBase', 'consignStoreCut', 'consignOwnerCut', 'consignMargin'].map(pick).join('\n') + '; return { consignFee, consignStoreCut, consignOwnerCut, consignMargin };')();
const r2 = n => Math.round(n * 100) / 100;
{
  const goblin = { salePrice: 445.5, price: 453, split: 33, marketplaceFee: 60.78 };
  assert.equal(r2(lib.consignStoreCut(goblin)), 126.96, '33% of $384.72');
  assert.equal(r2(lib.consignOwnerCut(goblin)), 257.76);
  assert.equal(r2(lib.consignStoreCut(goblin) + lib.consignOwnerCut(goblin) + lib.consignFee(goblin)), 445.5, 'fee + store + owner = the sale');
  const register = { salePrice: 445.5, split: 33 };
  assert.equal(r2(lib.consignStoreCut(register)), 147.02, 'a register sale splits the full price');
  assert.equal(r2(lib.consignOwnerCut(register)), 298.48);
  assert.equal(lib.consignFee({ salePrice: 10, marketplaceFee: 50, split: 25 }), 10, 'a fee never exceeds the sale');
}
// The summary cards use the same split as each row.
assert.ok(ui.includes('const totalFees = sold.reduce((a,c)=>a+consignStoreCut(c),0);'));
assert.ok(ui.includes('const totalOwed = sold.filter(c=>!c.paidOut).reduce((a,c)=>a+consignOwnerCut(c),0);'));
assert.ok(ui.includes("${consignFee(c)?` · marketplace fees $${consignFee(c).toFixed(2)} (split what's left)`:''}"), 'the sold line shows the fee');
// Cloud round trip, and a consignment the Worker marked sold keeps its fee.
assert.ok(ui.includes('marketplace_fee:consignMoney(c.marketplaceFee),'));
assert.ok(ui.includes('marketplaceFee:Number(c.marketplace_fee||0),'));
assert.ok(ui.includes("c.marketplaceFee=Number(r.marketplace_fee||0);"));
// Paying through Stripe sends the same amount the screen shows.
assert.ok(worker.includes('const net=Math.max(0,Number(item.sale_price)-Number(item.marketplace_fee||0));\n    const cents=Math.round(net*100)-Math.round(net*Number(item.store_split_percent??25));'));
{
  // Same cents as the screen and the alert: $445.50 at 33% -> $298.48 to the owner.
  const net = 445.5, cents = Math.round(net * 100) - Math.round(net * 33);
  assert.equal(cents, 29848);
  const netFee = 445.5 - 60.78, c2 = Math.round(netFee * 100) - Math.round(netFee * 33);
  assert.equal(c2, 25776);
}
// Each online sale path hands over its fee.
assert.ok(worker.includes('const applied = await applyEbaySaleToRow(env, storeId, invRow, quantitySold, salePrice, profit, soldAt, saleId, feeAmount);'), 'new eBay sale');
assert.ok(worker.includes("order.creationDate || new Date().toISOString(), open[0].sale_id, m.fee);"), 'eBay sale tied later');
assert.ok(worker.includes("source: channel.toLowerCase(), fee: feeAmount }"), 'Whatnot');
console.log('Consignment fees-first checks passed');
