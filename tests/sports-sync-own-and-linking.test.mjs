import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store ask: "Sports should be its own thing for sync. I also need all the
// correct price charting links in the system ... It has the title and what
// it is. You should be able to connect them all ... Pocket scout shouldnt
// have any sports in it. Thats for collectibles. I use pocket scout to
// find the sports."
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const extractFn = (name, prefix = 'function ') => { const s = dashboard.indexOf(prefix + name + '('); assert.ok(s >= 0, 'missing ' + name); return dashboard.slice(s, dashboard.indexOf('\n}', s) + 2); };

const { pick, query } = new Function([
  extractFn('inventoryCardName'), extractFn('inventorySetName'), extractFn('inventoryCardNumber'),
  extractFn('sportsPcNorm'), extractFn('sportsCardCleanName'), extractFn('sportsPcSearchQuery'), extractFn('pickSportsPcMatch'),
  'return { pick: pickSportsPcMatch, query: sportsPcSearchQuery };',
].join('\n'))();

const products = [
  { productId:'1', productName:'Julio Rodriguez [Refractor] #BDC-145', consoleName:'Baseball Cards 2021 Bowman Draft Chrome' },
  { productId:'2', productName:'Julio Rodriguez [Gold Refractor] #BDC-145', consoleName:'Baseball Cards 2021 Bowman Draft Chrome' },
  { productId:'3', productName:'Julio Rodriguez #BDC-145', consoleName:'Baseball Cards 2021 Bowman Draft Chrome' },
  { productId:'4', productName:'Julio Rodriguez [Refractor] #BDC-145', consoleName:'Baseball Cards 2021 Bowman Draft Chrome Sapphire' },
];

// Exact name + set (the built-in catalog cards).
assert.equal(pick({ name:'Julio Rodriguez [Refractor] #BDC-145', set:'Baseball Cards 2021 Bowman Draft Chrome' }, products).product.productId, '1',
  'the exact parallel in the exact set -- never the Gold Refractor, the base card or the Sapphire set');
// Store-typed names: every word of the parallel has to match, plus number and year.
{
  const r = pick({ name:'Julio Rodriguez Gold Refractor', card_number:'BDC-145', set:'2021 Bowman Draft', year:'2021' }, products);
  assert.equal(r.product.productId, '2', 'a Gold Refractor matches only the Gold Refractor');
}
{
  const r = pick({ name:'Julio Rodriguez Refractor', card_number:'BDC-145', set:'2021 Bowman Draft', year:'2021' }, products);
  assert.equal(r.product, null, 'two products (two sets) fit, so it is not guessed');
  assert.equal(r.candidates.length, 3, 'the close ones are offered to pick from (Refractor, Gold Refractor and Sapphire Refractor)');
}
assert.equal(pick({ name:'Julio Rodriguez', card_number:'BDC-146', set:'2021 Bowman Draft' }, products).product, null, 'a different card number never matches');
assert.equal(pick({ name:'Bryce Miller [Green] #US193 /499', set:'Baseball Cards 2023 Topps Update' }, [{ productId:'9', productName:'Bryce Miller [Green] #US193', consoleName:'Baseball Cards 2023 Topps Update' }]).product.productId, '9',
  'the store\'s "/499" print-run note is not part of the name');

// The search query: name, set (without the "Baseball Cards" prefix), card number.
assert.equal(query({ name:'Julio Rodriguez Refractor', card_number:'BDC-145', set:'2021 Bowman Draft' }), 'Julio Rodriguez Refractor 2021 Bowman Draft #BDC-145');
assert.equal(query({ name:'Julio Rodriguez [Refractor] #BDC-145', set:'Baseball Cards 2021 Bowman Draft Chrome' }), 'Julio Rodriguez [Refractor] #BDC-145 2021 Bowman Draft Chrome');

// ── Wiring ──
assert.match(dashboard, /<button class="hbtn" id="price-sync-sports-btn" onclick="runSportsPriceSync\(\)">SYNC SPORTS PRICES<\/button>/, 'sports has its own sync button');
assert.match(dashboard, /<button class="hbtn" id="price-sync-sports-link-btn" onclick="linkSportsCardsToPriceCharting\(\)">LINK SPORTS CARDS<\/button>/, 'and a link-every-card button');
assert.match(dashboard, /<button class="hbtn" id="price-sync-other-btn" onclick="runOtherLivePriceSync\(\)">FETCH LIVE OTHER TCG<\/button>/, 'the other button is other TCG only');
assert.match(dashboard, /if\(options\.group === 'sports'\) items = items\.filter\(isSportsPriceSyncItem\);\s*\n\s*else if\(options\.group === 'other'\) items = items\.filter\(i => !isSportsPriceSyncItem\(i\)\);/, 'each button syncs only its own cards');
assert.match(dashboard, /mode:options\.group === 'sports' \? 'sports-live' : 'other-live',/);
assert.match(dashboard, /if\(mode === 'sports-live'\) return 'sports';/, 'sports results are their own group');
assert.match(dashboard, /String\(i\.pocketScoutQuery\|\|''\)\.trim\(\) && !isSportsPriceSyncItem\(i\);/, 'Pocket Scout sync never prices sports cards');
assert.match(dashboard, /if\(live\?\.linkFields && String\(item\.pricechartingProductId \|\| ''\)\.trim\(\) !== String\(live\.linkFields\.pricechartingProductId\)\)\{\s*\n\s*await saveInventoryEdit\(item, live\.linkFields\)/, 'a link found during a sync is saved right away');
{
  const fn = extractFn('findSportsPcProduct', 'async function ');
  assert.match(fn, /const id = await resolveSportsPcProductId\(link\);/, 'saved link / SportsCardsPro page first');
  assert.match(fn, /const found = await searchSportsPcProduct\(item\);/, 'then the name search');
  assert.match(fn, /if\(!isSportsCardCategory\(priceSyncCategory\(item\)\)\) return/, 'the name search is for sports cards only');
}
{
  const tool = extractFn('linkSportsCardsToPriceCharting', 'async function ');
  assert.match(tool, /if\(\/\^\\d\+\$\/\.test\(savedId\)\)\{ counts\.already\+\+; continue; \}/, 'cards already linked are left alone');
  assert.match(tool, /await saveInventoryEdit\(item, patch\);/, 'a found link is saved');
  assert.match(tool, /_sportsLinkReview\.set\(item\.id, \{ item, candidates:found\.candidates \|\| \[\] \}\);/, 'anything unsure is listed for the store to pick');
}

console.log('Sports sync and linking checks passed');
