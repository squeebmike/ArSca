import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store ask: "Do qr labels take you to price charting if there's a link for
// sports in the system?" They didn't for most: the QR only recognized
// pricecharting.com links, and nearly every sports card is linked to
// SportsCardsPro (PriceCharting's sports site) or only by its id.
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const grab = sig => { const s = dashboard.indexOf(sig); assert.ok(s >= 0, 'missing ' + sig); return dashboard.slice(s, dashboard.indexOf('\n}', s) + 2); };
let all = [];
const labelQrPayload = new Function('getAll', [
  grab('function qplCategoryKey('), grab('function isSportsCardCategory('),
  'const buildTcgExternalLink = () => null;',
  grab('function labelQrPayload(').replace('(all || [])', '(getAll() || [])'),
  'return labelQrPayload;',
].join('\n'))(() => all);

const qr = item => { all = [item]; return labelQrPayload({ id:item.id, sku:item.sku || item.id }); };

assert.equal(qr({ id:'a', sku:'WO-1', category:'Sports', pricechartingProductId:'4373391' }),
  'https://www.sportscardspro.com/game/4373391?wo_sku=WO-1', 'a linked id goes to the short product page');
assert.equal(qr({ id:'b', sku:'WO-2', category:'Sports', sourceProductId:'5561655' }),
  'https://www.sportscardspro.com/game/5561655?wo_sku=WO-2', 'a Pocket Scout id works too');
assert.equal(qr({ id:'c', sku:'WO-3', category:'Baseball', providerUrl:'https://www.sportscardspro.com/game/4216323' }),
  'https://www.sportscardspro.com/game/4216323?wo_sku=WO-3', 'a short SportsCardsPro link');
assert.equal(qr({ id:'d', sku:'WO-4', category:'Sports', providerUrl:'https://www.sportscardspro.com/game/baseball-cards-2024-topps-chrome-update/paul-skenes-usc27#completed-auctions-manual-only' }),
  'https://www.sportscardspro.com/game/baseball-cards-2024-topps-chrome-update/paul-skenes-usc27?wo_sku=WO-4', 'a full page link, without the page-section part');
assert.match(qr({ id:'e', sku:'WO-5', category:'Sports' }), /^https:\/\/themanapocket\.com\/shop\?item=e/, 'an unlinked card still goes to its shop page');
assert.match(qr({ id:'f', sku:'WO-6', category:'Sports', providerUrl:'https://www.sportscardspro.com/search-products?q=skenes' }), /^https:\/\/themanapocket\.com\/shop/, 'a search page is never treated as the card');
assert.equal(qr({ id:'g', sku:'WO-7', category:'Comic', providerUrl:'https://www.pricecharting.com/game/comic-books-saga/saga-1' }),
  'https://www.pricecharting.com/game/comic-books-saga/saga-1?wo_sku=WO-7', 'comics are unchanged');

console.log('Sports label QR goes to PriceCharting checks passed');
