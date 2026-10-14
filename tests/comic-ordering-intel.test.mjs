import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { comicDemandFacts, coverMarketQuery, coverTitleMatches, summarizeCoverMarket, handleFocRequest } from '../scripts/foc-preorders.mjs';

// Store ask, ordering comics on the FOC wall: hot books; runs ("I have a
// Twelve-Toe Maggie #1 in stock still -- order #2 to go with it"); series,
// characters and cover artists that sell here ("Peach sells well, don't
// forget these Peach covers", "you sold X Spider-Man comics"); connecting
// covers; other sellers' eBay presales; and values next to the ratio books
// (eBay sold / listings and PriceCharting). Pills on the cover wall and a
// summary on FINAL FOC REVIEW.
const require = createRequire(import.meta.url);
const D = require('../scripts/comic-demand.js');
const DAY = 86400000, NOW = Date.UTC(2026, 9, 13);
const ago = d => new Date(NOW - d * DAY).toISOString();

// Reading titles.
assert.deepEqual(D.parseTitle('MIDNIGHT SPIDER-MAN #1 COVER C PEACH MOMOKO MIDNIGHT SPECIAL VARIANT -- COVER C PEACH MOMOKO MIDNIGHT SPECIAL VARIANT'), { series:'MIDNIGHT SPIDER-MAN', issue:'1', cover:'COVER C PEACH MOMOKO MIDNIGHT SPECIAL VARIANT' });
assert.deepEqual(D.parseTitle('247 COMICS Presents / Spotlight #1 Cover K - 1:25 Daniel Warren Johnso - PRESALE'), { series:'247 COMICS Presents / Spotlight', issue:'1', cover:'Cover K - 1:25 Daniel Warren Johnso' });
assert.equal(D.seriesKey('THE AMAZING SPIDER-MAN #1004'), D.seriesKey('Amazing Spider-Man (2025)'));
assert.equal(D.seriesKey('Starship Godzilla: Invasion X [Kai-Sei Era]'), 'STARSHIP GODZILLA INVASION X');
for (const c of ['Cover A', '(CVR A) (Eric Powell)', 'COVER A', '']) assert.equal(D.isMainCover(c), true, c);
for (const c of ['Cover B Hipp Variant', 'COVER C PEACH MOMOKO', 'Variant Title', '1:25 Ratio']) assert.equal(D.isMainCover(c), false, c);
assert.deepEqual(D.charactersIn('MILES MORALES: SPIDER-MAN'), ['Spider-Man']);
assert.deepEqual(D.charactersIn('Teenage Mutant Ninja Turtles (2024)'), ['TMNT'], 'the turtles are not X-Men');
assert.deepEqual(D.charactersIn('X-ORCISTS'), ['X-Men']);
assert.deepEqual(D.artistsInTitle('Cover K - 1:25 Daniel Warren Johnso', ['Daniel Warren Johnson', 'Ono', 'Mark Brooks']), ['Daniel Warren Johnson'], 'a cut-off eBay title still names the artist; one-word names are too loose');
assert.deepEqual(D.coverTypes('COVER F MARK BROOKS VIRGIN 1:100 VARIANT'), ['Ratio covers', 'Virgin covers']);

// What sells here.
const sold = [
  // Spider-Man: 5 sold across series, 4 of them Peach Momoko variants
  { title:'MIDNIGHT SPIDER-MAN #1 COVER C PEACH MOMOKO MIDNIGHT SPECIAL VARIANT', qty:1, price:6, saleId:'s1', at:ago(10) },
  { title:'MIDNIGHT X-MEN #1 COVER A', qty:1, price:5, saleId:'s1', at:ago(10) },
  { title:'MIDNIGHT SPIDER-MAN #1 COVER A', qty:1, price:5, saleId:'s2', at:ago(8) },
  { title:'MIDNIGHT X-MEN #1 COVER B', qty:1, price:5, saleId:'s2', at:ago(8) },
  { title:'SPIDER-WOMAN #1 COVER B PEACH MOMOKO VARIANT', qty:1, price:6, saleId:'s3', at:ago(6), ebay:true },
  { title:'SPIDER-WOMAN #1 COVER A', qty:2, price:5, saleId:'s4', at:ago(5), ebay:true },
  { title:'SPIDER-WOMAN #1 COVER E PEACH MOMOKO', series:'SPIDER-WOMAN', issue:'1', cover:'COVER E PEACH MOMOKO', artist:'Peach Momoko', qty:1, price:6, saleId:'s5', at:ago(4) },
  { title:'Comic Bundle x12', qty:1, price:60, saleId:'s6', at:ago(2) },
  { title:'Old Book #1', qty:1, price:5, saleId:'s7', at:ago(400) },
];
const stock = [
  { name:'Hillbilly: The Treason of Twelve-Toe Maggie #1 (CVR A) (Eric Powell)', series:'Hillbilly: The Treason of Twelve-Toe Maggie', issue:'1', cover:'(CVR A) (Eric Powell)', qty:2, at:ago(10) },
  { name:'MIDNIGHT SPIDER-MAN #1 COVER A', series:'MIDNIGHT SPIDER-MAN', issue:'1', qty:29, at:ago(15) },
  { name:'Dud #3', series:'Dud', issue:'3', qty:5, at:ago(50) },
];
const demand = D.buildComicDemand({ sold, stock, artists:['Peach Momoko', 'Eric Powell', 'Mark Brooks'], now:NOW });
const g = k => demand.byKey.get(k);
assert.equal(demand.bundles, 1, 'bundles are counted, not read as a series');
assert.equal(demand.soldCount, 8, 'a sale older than 180 days is left out');
assert.equal(g('series|SPIDER WOMAN').sold, 4);
assert.equal(g('series|SPIDER WOMAN').ebaySold, 3);
assert.equal(g('series|SPIDER WOMAN').rating, 'hot', '4 sold, none sitting');
assert.equal(g('character|spider-man').sold, 6);
assert.equal(g('artist|peach momoko').sold, 3, 'artist counts variant covers only');
assert.equal(g('artist|eric powell'), undefined, "the regular cover doesn't count toward its artist");
assert.equal(g('series|DUD').rating, 'slow');
assert.deepEqual(g('series|MIDNIGHT SPIDER MAN').issues['1'], { sold:2, stock:29 });
assert.deepEqual(g('series|MIDNIGHT SPIDER MAN').together.map(t => [t.label, t.count]), [['MIDNIGHT X-MEN', 2]], 'bought in the same sale twice');

// Runs: Maggie #1 is on the shelf, #2 is on this week's FOC.
{
  const maggie = { id:'f1', title:'Hillbilly: The Treason of Twelve-Toe Maggie #2', seriesName:'Hillbilly: The Treason of Twelve-Toe Maggie', issueNumber:'2', variants:[{ id:'m2a', variantLabel:'(CVR A) (Eric Powell)', coverArtist:'Eric Powell' }] };
  const i = D.familyIntel(maggie, demand);
  assert.equal(i.runText, '#1 ×2 in stock → order #2 to go with them');
  assert.equal(i.runBoost, 2);
  assert.ok(i.hot);
  const m3 = D.familyIntel({ ...maggie, title:'… #3', issueNumber:'3' }, demand);
  assert.equal(m3.runText, '#1 ×2 in stock → order #3 to go with them · #2 not in stock');
}
// ...but a pile of #1 still on the shelf says go light.
{
  const i = D.familyIntel({ id:'f2', title:'MIDNIGHT SPIDER-MAN #2', seriesName:'MIDNIGHT SPIDER-MAN', issueNumber:'2', variants:[
    { id:'c', variantLabel:'COVER C PEACH MOMOKO MIDNIGHT SPECIAL VARIANT', coverArtist:'Peach Momoko', customerQty:1, ebayPresold:2 },
    { id:'f', variantLabel:'COVER F PEACH MOMOKO MIDNIGHT SPECIAL VIRGIN 1:50 VARIANT', coverArtist:'Peach Momoko', isIncentive:true },
  ] }, demand);
  assert.equal(i.runText, '#1: 29 still on the shelf, 2 sold → go light on #2');
  assert.equal(i.runBoost, 0);
  assert.equal(D.familyIntel({ id:'f2b', title:'MIDNIGHT SPIDER-MAN #3', seriesName:'MIDNIGHT SPIDER-MAN', issueNumber:'3', variants:[] }, demand).runText, '#1: 29 still on the shelf, 2 sold → go light on #3', '#2 not in yet: judged on #1');
  const texts = i.pills.map(p => p.text);
  assert.ok(texts.includes('📦 3 presold'));
  assert.ok(texts.includes('🦸 Spider-Man · sold 6'), texts.join(' | '));
  assert.ok(texts.includes('🤝 sells with MIDNIGHT X-MEN (2)'));
  assert.equal(i.variants.c[0].text, '🎨 Peach Momoko · sold 3');
  assert.ok(i.variants.f.some(p => p.kind === 'artist'), 'ratio covers get the artist pill too');
}
// Watch list: flagged whatever the sales say.
{
  const fam = { id:'f3', title:'JEAN GREY #1', seriesName:'JEAN GREY', issueNumber:'1', isFirstIssue:true, variants:[
    { id:'a', variantLabel:'Cover A' }, { id:'e', variantLabel:'COVER E MARK BROOKS VARIANT', coverArtist:'Mark Brooks' } ] };
  assert.equal(D.familyIntel(fam, demand).variants.e, undefined, 'no Mark Brooks sales, not watched');
  const watched = D.familyIntel(fam, demand, { artists:['mark brooks'], characters:['Batman'], series:['jean grey'] });
  assert.equal(watched.variants.e[0].text, '🎨 Mark Brooks · ⭐');
  assert.ok(watched.pills.some(p => p.text === '👀 ON YOUR WATCH LIST'));
  assert.ok(watched.pills.some(p => p.text === '🆕 NEW SERIES') && watched.pills.some(p => p.text === '⭐ #1'));
  assert.deepEqual(D.DEFAULT_WATCH.artists, ['Peach Momoko']);
  const key = D.familyIntel({ id:'k', title:'X #5', seriesName:'X', issueNumber:'5', description:'Featuring the first appearance of Bob!', variants:[] }, demand);
  assert.ok(key.pills.some(p => p.text === '⭐ 1ST APPEARANCE'));
}
// The week's summary.
{
  const families = [
    { id:'sw', title:'SPIDER-WOMAN #2', seriesName:'SPIDER-WOMAN', issueNumber:'2', variants:[{ id:'sw-a', variantLabel:'Cover A', storeQuantity:3 }, { id:'sw-p', variantLabel:'PEACH MOMOKO VARIANT', coverArtist:'Peach Momoko' }] },
    { id:'mg', title:'Hillbilly: The Treason of Twelve-Toe Maggie #2', seriesName:'Hillbilly: The Treason of Twelve-Toe Maggie', issueNumber:'2', variants:[{ id:'mg-a', variantLabel:'Cover A' }] },
    { id:'ms', title:'MIDNIGHT SPIDER-MAN #2', seriesName:'MIDNIGHT SPIDER-MAN', issueNumber:'2', variants:[{ id:'ms-a', variantLabel:'Cover A' }] },
    { id:'dd', title:'Dud #4', seriesName:'Dud', issueNumber:'4', variants:[{ id:'dd-a', variantLabel:'Cover A' }] },
  ];
  const w = D.whatToOrder(families, demand, D.DEFAULT_WATCH);
  assert.deepEqual(w.hot.map(r => r.f.id), ['sw']);
  assert.deepEqual(w.runs.map(r => r.f.id), ['sw', 'mg'], 'sold #1 ×4, and #1 ×2 on the shelf; an overstocked or slow run is not a "go with it"');
  assert.equal(w.runs[0].intel.runText, 'sold #1 ×4 → readers will want #2');
  assert.equal(D.familyIntel(families[3], demand).runText, '#3: 5 still on the shelf, 0 sold → go light on #4', 'a slow series is a reason to go light');
  assert.deepEqual(w.slow.map(r => r.f.id).sort(), ['dd', 'ms']);
  assert.equal(w.artists[0].label, 'Peach Momoko');
  assert.equal(w.artists[0].covers[0].ordered, 0, "these Peach covers aren't ordered yet");
  assert.equal(w.characters[0].label, 'Spider-Man');
  assert.deepEqual(w.characters[0].titles.map(t => t.family.id), ['sw', 'ms']);
}
// Ratio pricing: eBay sold first, then PriceCharting, then 90% of the asking median.
assert.deepEqual(D.ratioValue({ soldMedian:120, soldCount:4, pcUngraded:150, activeMedian:200, activeCount:9 }), { price:120, basis:'eBay sold median (4 sold)' });
assert.deepEqual(D.ratioValue({ soldMedian:120, soldCount:1, pcUngraded:150 }), { price:150, basis:'PriceCharting raw' });
assert.deepEqual(D.ratioValue({ activeMedian:200, activeCount:9 }), { price:180, basis:'90% of the median eBay asking price (9 listed)' });
assert.equal(D.ratioValue({ activeMedian:200, activeCount:2 }), null, 'two listings are not a price');

// Worker: the facts behind it.
{
  const facts = comicDemandFacts({
    lines:[{ sale_id:'s1', item_id:'11111111-1111-1111-1111-111111111111', title:'MIDNIGHT SPIDER-MAN #1 COVER C', quantity:1, unit_price:'6.00', source_id:'ebay:123', created_at:ago(1) },
      { sale_id:'s2', item_id:'ci_one_off', title:'Comic Bundle x12', quantity:1, unit_price:'60', source_id:null, created_at:ago(1) }],
    items:[{ id:'11111111-1111-1111-1111-111111111111', source:'foc_receive', series:'MIDNIGHT SPIDER-MAN', issue:'1', variant:'COVER C PEACH MOMOKO', focSkuId:'22222222-2222-2222-2222-222222222222' }],
    stock:[{ id:'x', source:'built_in', name:'Giant-Size X-Men #1', series:'Giant-Size X-Men', issue:'1', variant:'Giant-Size X-Men [Bardin] #1 (2024)', qty:'2', coverArtists:['Bardin'], created_at:ago(3) }],
    skus:[{ id:'22222222-2222-2222-2222-222222222222', cover_artist:'Peach Momoko', variant_label:'COVER C PEACH MOMOKO MIDNIGHT SPECIAL VARIANT' }],
    artistRows:[{ cover_artist:'Peach Momoko' }, { cover_artist:'Ono' }, { cover_artist:'Dan Panosian, Eric Powell' }],
  });
  assert.deepEqual(facts.sold[0], { title:'MIDNIGHT SPIDER-MAN #1 COVER C', series:'MIDNIGHT SPIDER-MAN', issue:'1', cover:'COVER C PEACH MOMOKO MIDNIGHT SPECIAL VARIANT', artist:'Peach Momoko', skuId:'22222222-2222-2222-2222-222222222222', qty:1, price:6, saleId:'s1', at:ago(1), ebay:true });
  assert.equal(facts.sold[1].ebay, false);
  assert.equal(facts.stock[0].cover, '', "a hand-entered comic's variant field is not a cover label");
  assert.equal(facts.stock[0].qty, 2);
  assert.deepEqual(facts.artists.sort(), ['Dan Panosian', 'Eric Powell', 'Peach Momoko']);
}
{
  const paths = [];
  const deps = { json:(data, status = 200) => ({ status, data }), requireStoreUser:async () => ({ user:{ id:'u' } }),
    supabaseAdminFetch:async (env, path) => { paths.push(path); if (path.startsWith('pos_sale_lines?')) return { data:[{ sale_id:'s', item_id:'11111111-1111-1111-1111-111111111111', title:'X #1', quantity:1, unit_price:5, created_at:ago(1) }] }; return { data:[] }; } };
  const res = await handleFocRequest({ method:'GET', headers:{ get:() => null } }, {}, new URL('https://x/foc/admin/comic-demand?store_id=st'), deps);
  assert.equal(res.data.ok, true);
  assert.equal(res.data.sold.length, 1);
  assert.match(paths[0], /^pos_sale_lines\?store_id=eq\.st&category=ilike\.\*comic\*&created_at=gte\./);
  assert.match(paths[1], /^inventory_items\?store_id=eq\.st&status=eq\.in_stock&data->>category=ilike\.\*comic\*&select=id,created_at,source:data->>source/);
  assert.ok(paths.some(p => p.startsWith('inventory_items?id=in.(11111111-1111-1111-1111-111111111111)')), 'sold items looked up for series + cover');
}

// Other sellers on eBay: built from the cover, only matching titles count,
// and our own presale listings are left out.
{
  const q = coverMarketQuery({ series:'MIDNIGHT SPIDER-MAN', issue:'2', artist:'Peach Momoko', ratio:50, virgin:true });
  assert.equal(q.q, 'MIDNIGHT SPIDER-MAN #2 Momoko 1:50 virgin');
  assert.equal(coverMarketQuery({ series:'Starship Godzilla [Kai-Sei Era]', issue:'1' }).q, 'Starship Godzilla #1');
  assert.equal(coverTitleMatches('Midnight Spider-Man #2 Peach Momoko 1:50 Virgin Variant PRESALE', q), true);
  assert.equal(coverTitleMatches('Midnight Spider-Man #2 Peach Momoko Cover C', q), false, 'not the 1:50');
  assert.equal(coverTitleMatches('Midnight Spider-Man #12 Momoko 1:50', q), false, 'wrong issue');
  assert.equal(coverTitleMatches('Midnight Spider-Man #2 Crain 1:50', q), false, 'a different ratio cover');
  const plain = coverMarketQuery({ series:'THE AMAZING SPIDER-MAN', issue:'1004' });
  assert.equal(coverTitleMatches('Amazing Spider-Man 1004 Peach Momoko variant NM', plain), true);
  const sum = summarizeCoverMarket(plain, [
    { itemId:'v1|111|0', title:'Amazing Spider-Man #1004 Cover A PRESALE', price:6 },
    { itemId:'v1|222|0', title:'Amazing Spider-Man #1004 Momoko', price:10 },
    { itemId:'v1|333|0', title:'Amazing Spider-Man #1004 Bagley', price:8 },
    { itemId:'v1|999|0', title:'Amazing Spider-Man #1004 - PRESALE (ours)', price:5 },
    { itemId:'v1|444|0', title:'Venom #1004', price:50 },
  ], [{ title:'Amazing Spider-Man #1004', total:7, soldAt:ago(2) }, { title:'Amazing Spider-Man #1003', total:30, soldAt:ago(1) }], new Set(['999']));
  assert.deepEqual([sum.active.count, sum.active.low, sum.active.median, sum.active.high, sum.active.presales], [3, 6, 8, 10, 1]);
  assert.deepEqual([sum.sold.count, sum.sold.median, sum.sold.last.price], [1, 7, 7]);
}
{
  const kv = new Map(), searches = [];
  const env = { LBA_KV:{ get:async (k) => kv.has(k) ? JSON.parse(kv.get(k)) : null, put:async (k, v) => kv.set(k, v) } };
  const deps = { json:(data, status = 200) => ({ status, data }), requireStoreUser:async () => ({ user:{ id:'u' } }),
    readJsonWithLimit:async req => ({ data:JSON.parse(req.body) }), enforceUsageLimit:async () => null,
    supabaseAdminFetch:async (e, path) => ({ data:path.includes('ebayListingId') ? [{ listingId:'999' }] : [] }),
    ebayActiveListings:async (e, q) => { searches.push(q); return { listings:[{ itemId:'v1|1|0', title:'Venom #2 Peach Momoko', price:9 }, { itemId:'v1|999|0', title:'Venom #2 ours', price:5 }] }; },
    ebaySoldComps:async () => ({ comps:[] }) };
  const req = { method:'POST', headers:{ get:() => null }, body:JSON.stringify({ storeId:'st', covers:[{ key:'fam:v', series:'VENOM', issue:'2' }] }) };
  const url = new URL('https://x/foc/admin/cover-market');
  const first = await handleFocRequest(req, env, url, deps);
  assert.equal(first.data.results['fam:v'].active.count, 1, 'our own listing left out');
  const again = await handleFocRequest(req, env, url, deps);
  assert.equal(again.data.results['fam:v'].cached, true);
  assert.equal(searches.length, 1, 'second check comes from the 12-hour cache');
  const none = await handleFocRequest(req, env, url, { ...deps, ebayActiveListings:undefined });
  assert.equal(none.status, 501);
}

// FOC dashboard: pills on the wall, summary on FINAL FOC REVIEW.
const ui = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
assert.match(ui, /'<\/div>'\+focFamilyPillsHtml\(f\)\+'<\/div><div class="foc-toolbar">'/, 'title pills under each title');
assert.match(ui, /lunarCostLine\(v\)\+focVariantPillsHtml\(v\)\+/, 'cover pills on each cover');
assert.match(ui, /renderCycle\(\);focEnsureIntel\(\);/);
assert.match(ui, /'<div id="foc-what-to-order"><\/div>'\+\s*'<div id="foc-order-helper"><\/div>'/);
assert.match(ui, /loadPrhSubmissionStatus\(\);\s*renderFocWhatToOrder\(\);/);
assert.match(ui, /<option value="sells" /, 'filter: sells here / runs / watch list');
assert.match(ui, /onclick="openFocWatchList\(\)">⭐ WATCH LIST<\/button>/);
assert.match(ui, /storeWorkerFetch\('\/kv\/foc_watch_list',\{method:'POST'/, 'the watch list is shared by every device');
assert.match(ui, /storeWorkerFetch\('\/pricing\/pricecharting\/comics\/by-upc'/);
assert.match(ui, /api\('\/foc\/admin\/cover-market'/);
assert.match(ui, /if\(!confirm\('Set this cover\\'s sell price to \$'/, 'PRICE IT never saves without confirming');
// Suggested order uses runs, characters and artists that sell here.
{
  const grab = re => { const m = ui.match(re); assert.ok(m, 'missing ' + re); return m[0]; };
  const ctx = { Math, Number, String };
  vm.createContext(ctx);
  vm.runInContext(grab(/function focOrderSuggest\(family,stats,pull,intel\)\{[\s\S]*?\n\}/) + ';this.suggest=focOrderSuggest;', ctx);
  const maggie = { id:'f1', title:'Hillbilly: The Treason of Twelve-Toe Maggie #2', seriesName:'Hillbilly: The Treason of Twelve-Toe Maggie', issueNumber:'2', variants:[
    { id:'a', variantLabel:'(CVR A) (Eric Powell)', storeQuantity:0 }, { id:'p', variantLabel:'PEACH MOMOKO VARIANT', coverArtist:'Peach Momoko', storeQuantity:0 } ] };
  const s = ctx.suggest(maggie, null, 0, D.familyIntel(maggie, demand, D.DEFAULT_WATCH));
  assert.equal(s.lines[0].store, 2);
  assert.match(s.lines[0].reasons[0], /^\+2 for the run: #1 ×2 in stock → order #2/);
  assert.equal(s.lines[1].store, 1);
  assert.equal(s.lines[1].reasons[0], '+1: Peach Momoko is on your watch list (sold 3 here)');
  const unwatched = ctx.suggest(maggie, null, 0, D.familyIntel(maggie, demand, { artists:[] }));
  assert.equal(unwatched.lines[1].store, 0, '3 sold is steady, not hot: no extra copy unless watched');
  assert.equal(ctx.suggest(maggie, null, 0).lines[0].store, 0, 'no intel, no change');
}

// Wiring.
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
assert.ok(dashboard.indexOf('src="scripts/comic-demand.js') > 0 && dashboard.indexOf('src="scripts/comic-demand.js') < dashboard.indexOf('src="scripts/foc-dashboard.js'));
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.match(worker, /ebayActiveListings: fetchEbayActiveListings,/);
assert.match(worker, /key\.startsWith\('foc_watch'\)/, 'the watch list never expires');
console.log('Comic ordering intel checks passed');

// "I need a link to take me there to see them": eBay pills open the search.
{
  const grab = re => { const m = ui.match(re); assert.ok(m, 'missing ' + re); return m[0]; };
  const ctx = { Math, Number, String, encodeURIComponent, esc:v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;'), displayDate:() => 'Oct 13', FOC_PILL_COLOR:{ hot:'g', good:'b', dim:'d' } };
  vm.createContext(ctx);
  vm.runInContext([grab(/function focPillHtml\(p\)\{[\s\S]*?\n  return '<span[^\n]*\n/), grab(/function focEbaySearchUrl\(q,sold\)\{[^\n]*\}/), grab(/function focMarketPills\(m,msrpCents\)\{[\s\S]*?\n\}/)].join('\n') + ';this.pill=focPillHtml;this.pills=focMarketPills;', ctx);
  const pills = ctx.pills({ query:'Disney The Haunted Mansion #3', at:'2026-10-13', active:{ count:24, median:34.47, low:5, high:80 }, sold:{ count:3, median:12 } }, 499);
  assert.equal(pills.length, 2);
  assert.equal(pills[0].href, 'https://www.ebay.com/sch/i.html?_nkw=Disney%20The%20Haunted%20Mansion%20%233');
  assert.equal(pills[1].href, 'https://www.ebay.com/sch/i.html?_nkw=Disney%20The%20Haunted%20Mansion%20%233&LH_Sold=1&LH_Complete=1');
  assert.match(ctx.pill(pills[0]), /^<a class="foc-intel-pill foc-intel-link" href="https:\/\/www\.ebay\.com\/sch\/i\.html\?_nkw=Disney%20The%20Haunted%20Mansion%20%233" target="_blank" rel="noopener"[^>]*>🔥 eBay: 24 listed ~\$34\.47 \(6\.9× cover\) ↗<\/a>$/);
  assert.match(ctx.pill({ tone:'dim', text:'x' }), /^<span /, 'plain pills stay plain');
}
assert.match(ui, /links\.push\('<a href="'\+esc\(pcUrl\)\+'" target="_blank" rel="noopener">PriceCharting ↗<\/a>'\)/);
console.log('eBay pill links checks passed');

// "I sold one, so why no data? Even us?" -- our own sale of the exact cover
// counts (ASM #1004 Spears 1:100 sold for $119.96 on our eBay listing).
{
  assert.deepEqual(D.ratioValue({ ourSales:{ count:1, median:119.96 }, activeMedian:0, activeCount:0 }), { price:119.96, basis:'what it sold for here (1 sale)' });
  assert.deepEqual(D.ratioValue({ ourSales:{ count:1, median:119.96 }, pcUngraded:150 }).basis, 'what it sold for here (1 sale)', 'a real sale here beats a guide');
  assert.deepEqual(D.ratioValue({ soldMedian:100, soldCount:3, ourSales:{ count:1, median:119.96 } }).price, 100, 'several eBay sales still come first');
  const grab = re => { const m = ui.match(re); assert.ok(m, 'missing ' + re); return m[0]; };
  const ctx = { Math, Number, String, focIntel:{ facts:{ sold:[{ skuId:'spears', price:119.96, qty:1, at:'2026-10-11T18:09:24Z', ebay:true }, { skuId:'other', price:5, qty:1 }] } } };
  vm.createContext(ctx);
  vm.runInContext(grab(/function focOurSales\(skuId\)\{[\s\S]*?\n\}/) + ';' + grab(/function focMarketWarning\(m\)\{[\s\S]*?\n\}/) + ';this.ours=focOurSales;this.warn=focMarketWarning;', ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.ours('spears'))), { count:1, median:119.96, last:{ skuId:'spears', price:119.96, qty:1, at:'2026-10-11T18:09:24Z', ebay:true } });
  assert.equal(ctx.ours('none'), null);
  assert.equal(ctx.warn({ warnings:['SOLDCOMPS_API_KEY not set'] }), "eBay sold history isn't connected, so other sellers' sales can't be seen");
  assert.match(ui, /parts\.push\(r\.m\.ownListed\?'only your listing is up on eBay':'no other eBay listings'\)/);
}
{
  const { summarizeCoverMarket:sum, coverMarketQuery:cq } = await import('../scripts/foc-preorders.mjs');
  const q = cq({ series:'THE AMAZING SPIDER-MAN', issue:'1004', artist:'Mark Spears', ratio:100 });
  const r = sum(q, [{ itemId:'v1|257|0', title:'AMAZING SPIDER-MAN #1004 MARK SPEARS VIRGIN 1:100 VARIANT - PRESALE', price:119.96 }], [], new Set(['257']));
  assert.deepEqual([r.ownListed, r.active.count], [1, 0], 'our own listing is noted, not counted as another seller');
}
console.log('Own-sales value checks passed');
