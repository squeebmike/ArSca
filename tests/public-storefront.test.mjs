import fs from 'node:fs';
import assert from 'node:assert/strict';
const dashboard=fs.readFileSync(new URL('../dashboard.html',import.meta.url),'utf8');
const worker=fs.readFileSync(new URL('../cloudflare-worker-full.js',import.meta.url),'utf8');
const storefront=fs.readFileSync(new URL('../storefront.html',import.meta.url),'utf8');
assert.match(worker,/\/public\/storefront/);
assert.match(worker,/storefrontEnabled !== true/,'storefront is opt-in');
assert.match(worker,/\['sold','archived','returned','deleted'(?:,'[^']+')*\]\.includes\(i\.inventoryStatus\)/,'legacy and current statuses are filtered safely');
assert.match(worker,/const limit = Number\.isFinite\(requestedLimit\) && requestedLimit > 0 \? Math\.min\(96, Math\.floor\(requestedLimit\)\) : 0;/,'public storefront supports an explicitly bounded page size');
assert.match(worker,/if \(limit\) items = items\.slice\(offset, offset \+ limit\);/,'public storefront returns only the requested item page');
assert.match(worker,/hasMore:limit \? offset \+ items\.length < total : false/,'public storefront tells the browser when another page exists');
for(const slug of ['pokemon','mtg','one-piece','yugioh','lorcana','sports-cards','comics','collectibles','supplies']) assert.match(worker,new RegExp("'"+slug.replace('-','\\-')+"'"),'public storefront taxonomy must include '+slug);
assert.match(worker,/inventorySource === 'webflow' \|\| inventorySource === 'hybrid'/,'hybrid stores publish Webflow inventory too');
for(const privateField of ['cost','profit','consignor','notes']) assert.doesNotMatch(storefront,new RegExp(`i\\.${privateField}`,'i'),`${privateField} is not rendered`);
assert.match(dashboard,/PUBLIC INVENTORY STOREFRONT/);
assert.match(dashboard,/copyStorefrontLink/);
for(const id of ['q','category','year','condition','sort']) assert.match(storefront,new RegExp(`id="${id}"`));
assert.match(storefront,/ASK ABOUT THIS ITEM|ADD TO CART/,'storefront items expose a customer action');

// Store report: a FOC eBay presale placeholder row (status:'presale',
// created by /foc/ebay/create-presale -- name suffixed " - PRESALE", no
// data.onlineListed or data.status set) was showing up on the general
// public storefront as regular ready-to-ship stock, letting a customer buy
// a not-yet-received copy through the store's own site while the same
// units were also live on eBay.
assert.match(worker,/\['sold','archived','returned','deleted','sold_pending_pickup','sold_pending_shipment','hold','lost_damaged','presale'\]\.includes\(i\.inventoryStatus\)/,
  'presale-status rows must be excluded from the public storefront');
{
  const fnStart=worker.indexOf('function isStorefrontItemAvailable');
  const fnEnd=worker.indexOf('\n}',fnStart)+2;
  const isStorefrontItemAvailable=new Function(worker.slice(fnStart,fnEnd)+'\nreturn isStorefrontItemAvailable;')();
  const focPresaleRow={ name:'Some Comic - PRESALE', quantity:10, onlineListed:true, soldAt:'', archivedAt:'', inventoryStatus:'presale' };
  assert.equal(isStorefrontItemAvailable(focPresaleRow), false, 'a presale-status row must never be available on the general storefront, regardless of quantity/onlineListed');
  const normalInStockRow={ name:'Some Comic', quantity:1, onlineListed:true, soldAt:'', archivedAt:'', inventoryStatus:'in_stock' };
  assert.equal(isStorefrontItemAvailable(normalInStockRow), true, 'a genuinely in-stock row must remain unaffected by the presale exclusion');
}

console.log('public storefront contract passed');
