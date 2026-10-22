import assert from 'node:assert/strict';
import fs from 'node:fs';

// Store report: "Sold on eBay. Why's it still show in stock in dashboard?"
// Beneath the Trees Halloween Special B and D sold on old FOC presale
// listings. The sync matched each order by eBay SKU to the presale row (0
// left, ended Sept 1), marked that sold, and never touched the received
// shelf copies -- both still showed 2.
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const start = worker.indexOf('async function shelfCopyForPresaleSale(');
const end = worker.indexOf('\n}\n', start) + 2;
const make = rows => new Function('supabaseAdminFetch', worker.slice(start, end) + '\nreturn shelfCopyForPresaleSale;')(async (env, path) => {
  assert.match(path, /data->>source=eq\.foc_receive&status=eq\.in_stock/);
  return { data:rows };
});

const presaleEmpty = { id:'p', status:'presale', data:{ source:'foc_presale', focSkuId:'sku-d', qty:0, ebaySku:'lba-1' } };
const shelf = { id:'s', status:'in_stock', data:{ source:'foc_receive', focSkuId:'sku-d', qty:2 } };
assert.equal((await make([shelf])({}, 'store', presaleEmpty, 1)).id, 's', 'the copy that ships comes off the shelf row');
assert.equal((await make([])({}, 'store', presaleEmpty, 1)).id, 'p', 'nothing received: stays on the presale row (as before)');
const presaleLive = { id:'p2', status:'presale', data:{ source:'foc_presale', focSkuId:'sku-d', qty:3 } };
assert.equal((await make([shelf])({}, 'store', presaleLive, 1)).id, 'p2', 'a presale row with copies left keeps its own sales');
const shelfItem = { id:'x', status:'in_stock', data:{ source:'built_in', qty:1 } };
assert.equal((await make([shelf])({}, 'store', shelfItem, 1)).id, 'x', 'ordinary items are untouched');
assert.equal(await make([shelf])({}, 'store', null, 1), null);

assert.match(worker, /let invRow = skuMap\.get\(sku\) \|\| byListing;/);
assert.match(worker, /invRow = await shelfCopyForPresaleSale\(env, storeId, invRow, quantitySold\);/);

console.log('eBay sale on an emptied presale listing takes the shelf copy checks passed');
