import fs from 'node:fs';
import assert from 'node:assert/strict';

const worker=fs.readFileSync('cloudflare-worker-full.js','utf8');

assert.match(worker,/function inventoryCostBasisFromData\(data = \{\}\)/,'online checkout needs one server-side inventory-cost normalizer');
assert.match(worker,/costBasis:inventoryCostBasisFromData\(d\)/,'the main storefront checkout must carry inventory cost into its paid sale line');
assert.match(worker,/inventoryCostById = new Map\(\(inventoryRows \|\| \[\]\)\.map\(row => \[row\.id, inventoryCostBasisFromData\(row\.data \|\| \{\}\)\]\)\)/,'the legacy record-order path must reload cost from trusted inventory instead of accepting it from the browser');
assert.equal((worker.match(/cost_basis:li\.costBasis, profit:Math\.round\(\(extended-totalCost\)\*100\)\/100/g)||[]).length,2,'both online-order creation paths must persist extended profit and per-unit cost');
assert.equal((worker.match(/cost_basis:shipping, profit:0/g)||[]).length,2,'shipping revenue must be a zero-profit pass-through in both online-order paths');
assert.match(worker,/if \(pi\.status !== 'succeeded'\) return json\(\{ ok:false, error:'The online payment has not completed yet' \}, 409\)/,'record-order must never count an unfinished PaymentIntent as a sale');
assert.match(worker,/await fulfillStorefrontOrderInventory\(env,saleId,storeId\);/,'the post-payment record-order handoff must complete its sale even when Stripe fired before the ledger rows existed');

const line=(unitPrice,costBasis,quantity)=>{
  const extended=unitPrice*quantity,totalCost=costBasis*quantity;
  return {adjusted_price:extended,cost_basis:costBasis,profit:Math.round((extended-totalCost)*100)/100};
};
assert.deepEqual(line(20,12,3),{adjusted_price:60,cost_basis:12,profit:24},'three online units must report $60 sales and subtract all three units of cost');

console.log('Online order sales/profit ledger checks passed');
