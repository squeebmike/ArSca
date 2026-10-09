import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store report (screenshot of a sports card's ⋯ menu): "This is tcgplayer
// on a sports card? ... I should be able to click price charting button or
// sports card pro and take me there." The price-site button now matches
// what the item is.
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const grab = sig => { const s = dashboard.indexOf(sig); assert.ok(s >= 0, 'missing ' + sig); return dashboard.slice(s, dashboard.indexOf('\n}', s) + 2); };
const link = new Function([
  grab('function qplCategoryKey('), grab('function isSportsCardCategory('),
  grab('function inventoryCardName('), grab('function inventorySetName('), grab('function inventoryCardNumber('),
  "const buildTcgExternalLink = item => ({ url:'https://www.tcgplayer.com/product/' + (item.tcgPlayerId || 'x') });",
  grab('function inventoryPriceSiteLink('),
  'return inventoryPriceSiteLink;',
].join('\n'))();

assert.deepEqual({ ...link({ category:'Sports', pricechartingProductId:'9181828' }) }, { label:'SportsCardsPro', icon:'📈', url:'https://www.sportscardspro.com/game/9181828' }, 'a linked sports card opens its SportsCardsPro page');
assert.equal(link({ category:'Baseball', providerUrl:'https://www.sportscardspro.com/game/baseball-cards-2023-topps-chrome/cal-raleigh-gold-wave-141#completed-auctions' }).url,
  'https://www.sportscardspro.com/game/baseball-cards-2023-topps-chrome/cal-raleigh-gold-wave-141', 'or its saved page link');
const search = link({ category:'Sports', name:'Julio Rodriguez', set:'2022 Topps', card_number:'197' });
assert.equal(search.label, 'SportsCardsPro (search)');
assert.equal(search.url, 'https://www.sportscardspro.com/search-products?type=prices&q=' + encodeURIComponent('Julio Rodriguez 2022 Topps #197'), 'an unlinked sports card searches SportsCardsPro, never TCGplayer');
assert.equal(link({ category:'Comic', providerUrl:'https://www.pricecharting.com/game/comic-books-saga/saga-1' }).label, 'PriceCharting', 'comics go to PriceCharting');
assert.equal(link({ category:'Pokemon TCG', tcgPlayerId:'123' }).url, 'https://www.tcgplayer.com/product/123', 'TCG cards still go to TCGplayer');

assert.match(dashboard, /onclick="openInventoryPriceSite\('\$\{id\}'\);closeInvRowMenu\(\)">\$\{site\.icon\} \$\{escHtml\(site\.label\)\}<\/button>/, 'the ⋯ menu button is named for the right site');
console.log('Inventory price site by item type checks passed');
