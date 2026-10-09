import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store report: "Lots of sports say they can't be matched. But they ALL
// should have a pricecharting url in there." The sync only read a numeric
// id (pricechartingProductId / sourceProductId). Cards that kept their exact
// product only as a providerUrl -- SportsCardsPro's /game/<id> permalink or a
// /game/<console>/<product> page link -- fell to a fuzzy CardSight search,
// graded cards skipped their saved link entirely, and built-in catalog cards
// (PriceCharting's own product/set names, no link) were never tried at all.

function extractFn(name, prefix = 'function ') {
  const start = dashboard.indexOf(prefix + name + '(');
  assert.ok(start >= 0, name + ' must exist in dashboard.html');
  const end = dashboard.indexOf('\n}', start) + 2;
  return dashboard.slice(start, end);
}

const consoleConst = dashboard.match(/const SPORTS_PC_CONSOLE = [^\n]+\n/)[0];
const cacheConst = dashboard.match(/const _sportsPcUrlIdCache = [^\n]+\n/)[0];

function load(fetchImpl, slab = null) {
  const calls = { fetch:[], slab:0, cardsight:0 };
  const fn = new Function('fetch', 'fetchGradedSlabPriceForItem', 'fetchCardSightRealPrice', [
    'const WORKER = "https://worker.test";',
    consoleConst, cacheConst,
    extractFn('inventoryCardName'),
    extractFn('inventorySetName'),
    extractFn('inventoryCardNumber'),
    extractFn('inventoryGradingInfo'),
    extractFn('isGradedInventoryItem'),
    extractFn('qplCategoryKey'),
    extractFn('priceSyncCategory'),
    extractFn('isSportsCardCategory'),
    extractFn('sportsPcNorm'),
    extractFn('sportsCardCleanName'),
    extractFn('sportsPcSearchQuery'),
    extractFn('pickSportsPcMatch'),
    extractFn('sportsCardHasNoRealName'),
    dashboard.match(/const _sportsPcSearchCache = [^\n]+\n/)[0],
    extractFn('searchSportsPcProduct', 'async function '),
    extractFn('findSportsPcProduct', 'async function '),
    extractFn('sportsPcSlug'),
    extractFn('sportsPcLinkForItem'),
    extractFn('resolveSportsPcProductId', 'async function '),
    extractFn('pcGradeBucket'),
    extractFn('fetchOtherTcgOrSportsLivePrice', 'async function '),
    'return { sportsPcLinkForItem, fetchOtherTcgOrSportsLivePrice, pcGradeBucket };',
  ].join('\n'));
  const api = fn(
    async (url) => { calls.fetch.push(String(url)); return fetchImpl(String(url)); },
    async () => { calls.slab++; return slab; },
    async () => { calls.cardsight++; return null; },
  );
  return { ...api, calls };
}

const reply = body => ({ ok:true, json:async () => body });
const product = (prices, extra = {}) => reply({ ok:true, product:{ productName:'Card', url:'https://www.pricecharting.com/game/x/y', prices, ...extra } });

// ── Which link a card is priced from ──
{
  const { sportsPcLinkForItem } = load(() => reply({}));
  assert.deepEqual({ ...sportsPcLinkForItem({ pricechartingProductId:'111', sourceProductId:'222' }) }, { id:'111', url:'', built:false });
  assert.deepEqual({ ...sportsPcLinkForItem({ sourceProductId:'222', providerUrl:'https://www.sportscardspro.com/game/999' }) }, { id:'222', url:'', built:false });
  assert.deepEqual({ ...sportsPcLinkForItem({ providerUrl:'https://www.sportscardspro.com/game/6543210' }) }, { id:'6543210', url:'https://www.sportscardspro.com/game/6543210', built:false },
    'a short SportsCardsPro permalink carries the product id itself');
  assert.deepEqual({ ...sportsPcLinkForItem({ providerUrl:'https://www.sportscardspro.com/game/baseball-cards-2023-topps/julio-rodriguez-1' }) },
    { id:'', url:'https://www.sportscardspro.com/game/baseball-cards-2023-topps/julio-rodriguez-1', built:false });
  assert.deepEqual({ ...sportsPcLinkForItem({ name:'Bryce Miller [Green] #US193 /499', set:'Baseball Cards 2023 Topps Update' }) },
    { id:'', url:'https://www.sportscardspro.com/game/baseball-cards-2023-topps-update/bryce-miller-green-us193', built:true },
    'a built-in catalog card with PriceCharting names gets its SportsCardsPro page link built, minus the store\'s print-run note');
  assert.deepEqual({ ...sportsPcLinkForItem({ name:'Aidan Smith', set:'2023 Bowman' }) }, { id:'', url:'', built:false },
    'a set that is not a PriceCharting console name is never guessed at');
  assert.deepEqual({ ...sportsPcLinkForItem({ sourceProductId:'cardsight-abc', providerUrl:'' }) }, { id:'', url:'', built:false },
    'a non-numeric source id is not a PriceCharting id');
}

// ── URL-only card: resolves the page, then prices from that exact product ──
{
  const { fetchOtherTcgOrSportsLivePrice, calls } = load(url => {
    if(url.includes('/pricing/sportscardspro/resolve-url')) return reply({ ok:true, match:{ productId:'777' } });
    if(url.endsWith('/pricing/pricecharting/product/777')) return product({ ungraded:4.25 });
    throw new Error('unexpected ' + url);
  });
  const item = { category:'Sports', name:'Julio Rodriguez', providerUrl:'https://www.sportscardspro.com/game/baseball-cards-2023-topps/julio-rodriguez-1' };
  const live = await fetchOtherTcgOrSportsLivePrice(item);
  assert.equal(live.market, 4.25);
  assert.equal(live.matchStatus, 'exact PriceCharting ID match');
  assert.deepEqual({ ...live.linkFields }, { pricechartingProductId:'777' }, 'the resolved id is kept so the next sync skips the page read');
  assert.equal(calls.cardsight, 0, 'a card with a saved link never falls to the fuzzy search');
  await fetchOtherTcgOrSportsLivePrice(item);
  assert.equal(calls.fetch.filter(u => u.includes('resolve-url')).length, 1, 'the same page is only read once per session');
}

// ── Short permalink: no page read needed ──
{
  const { fetchOtherTcgOrSportsLivePrice, calls } = load(url => {
    if(url.endsWith('/pricing/pricecharting/product/6543210')) return product({ ungraded:12 });
    throw new Error('unexpected ' + url);
  });
  const live = await fetchOtherTcgOrSportsLivePrice({ category:'Baseball', providerUrl:'https://www.sportscardspro.com/game/6543210' });
  assert.equal(live.market, 12);
  assert.equal(calls.fetch.some(u => u.includes('resolve-url')), false);
}

// ── Built-in card with no link: its built page link is tried ──
{
  const { fetchOtherTcgOrSportsLivePrice, calls } = load(url => {
    if(url.includes('resolve-url')) {
      assert.match(decodeURIComponent(url), /sportscardspro\.com\/game\/baseball-cards-2021-bowman-draft-chrome\/julio-rodriguez-refractor-bdc-145/);
      return reply({ ok:true, match:{ productId:'888' } });
    }
    if(url.endsWith('/product/888')) return product({ ungraded:30 });
    throw new Error('unexpected ' + url);
  });
  const live = await fetchOtherTcgOrSportsLivePrice({ category:'Sports', name:'Julio Rodriguez [Refractor] #BDC-145', set:'Baseball Cards 2021 Bowman Draft Chrome' });
  assert.equal(live.market, 30);
  assert.equal(live.matchStatus, 'exact PriceCharting page match');
  assert.deepEqual({ ...live.linkFields }, { pricechartingProductId:'888', providerUrl:'https://www.sportscardspro.com/game/baseball-cards-2021-bowman-draft-chrome/julio-rodriguez-refractor-bdc-145' });
  assert.equal(calls.cardsight, 0);
}

// ── Built link that doesn't open a product page falls back to the search ──
{
  const { fetchOtherTcgOrSportsLivePrice, calls } = load(url => {
    if(url.includes('resolve-url')) return reply({ ok:true, match:{ productId:'' } });
    throw new Error('unexpected ' + url);
  });
  const live = await fetchOtherTcgOrSportsLivePrice({ category:'Sports', name:'Nobody #1', set:'Baseball Cards 2023 Topps' });
  assert.equal(live, null);
  assert.equal(calls.cardsight, 1);
}

// ── Graded card: priced from its pinned product's grade value ──
{
  const { fetchOtherTcgOrSportsLivePrice, calls } = load(url => {
    if(url.endsWith('/product/555')) return product({ ungraded:5, grade9:40, psa10:120, bgs10:200 });
    throw new Error('unexpected ' + url);
  });
  const psa10 = await fetchOtherTcgOrSportsLivePrice({ category:'Sports', sourceProductId:'555', grader:'PSA', grade:'10' });
  assert.equal(psa10.market, 120);
  const bgs10 = await fetchOtherTcgOrSportsLivePrice({ category:'Sports', sourceProductId:'555', grader:'BGS', grade:'10' });
  assert.equal(bgs10.market, 200);
  const psa9 = await fetchOtherTcgOrSportsLivePrice({ category:'Sports', sourceProductId:'555', grader:'PSA', grade:'9' });
  assert.equal(psa9.market, 40);
  assert.equal(calls.slab, 0, 'a graded card with a saved link no longer runs the name search');
}

// ── Graded card whose pinned product has no value for that grade ──
{
  const { fetchOtherTcgOrSportsLivePrice, calls } = load(url => {
    if(url.endsWith('/product/555')) return product({ ungraded:5 });
    throw new Error('unexpected ' + url);
  }, { price:99, source:'PriceCharting graded (PSA 10)', productUrl:'' });
  const live = await fetchOtherTcgOrSportsLivePrice({ category:'Sports', sourceProductId:'555', grader:'PSA', grade:'10' });
  assert.equal(live.market, 99, 'falls back to the graded slab search');
  assert.equal(calls.slab, 1);
  assert.ok(!(live.market === 5), 'a graded card is never given the raw price');
}

// ── Grade buckets match the Worker's gradeKey ──
{
  const { pcGradeBucket } = load(() => reply({}));
  assert.equal(pcGradeBucket('PSA', '10'), 'psa10');
  assert.equal(pcGradeBucket('SGC', '10'), 'sgc10');
  assert.equal(pcGradeBucket('BECKETT', '10'), 'bgs10', 'Beckett is BGS');
  assert.equal(pcGradeBucket('BECKETT', '9.5'), 'grade9_5');
  assert.equal(pcGradeBucket('CGC', '10'), 'cgc10');
  assert.equal(pcGradeBucket('BGS', '9.5'), 'grade9_5');
  assert.equal(pcGradeBucket('PSA', 'PSA 8'), 'grade8');
  assert.equal(pcGradeBucket('PSA', '6'), '');
}

// ── Applying the change keeps the exact product on the card ──
{
  const applyFn = extractFn('applyPriceSyncEntry', 'async function ');
  assert.match(applyFn, /const isOtherLiveSync = p\.mode === 'other-live'/);
  assert.match(applyFn, /isOtherLiveSync \? \{\s*\.\.\.\(p\.linkFields \|\| \{\}\),/,
    'an applied sports price saves the product id it was priced from');
  const buildFn = extractFn('buildOtherTcgSportsPriceSyncProposal', 'async function ');
  assert.match(buildFn, /linkFields:live\.linkFields \|\| null,/);
  assert.match(buildFn, /livePriceStatus:'live', \.\.\.\(live\.linkFields \|\| \{\}\) \}/);
  assert.match(buildFn, /\+ otherSyncLinkHint\(item\)/, 'an unmatched card says whether it has a link to go on');
}

console.log('Sports price sync reads every saved PriceCharting link checks passed');
