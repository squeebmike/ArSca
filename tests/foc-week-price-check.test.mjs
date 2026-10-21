import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Store ask (screenshot of a 1:10 cover's VALUE box): "a button that will
// get each variant and check sold eBay or eBay listings... hover and see
// them when there's a match... check and update them all for that FOC week.
// Not put prices -- check prices."
const { coverMarketQuery, coverTitleMatches, summarizeCoverMarket, coverMarketListings } = await import('../scripts/foc-preorders.mjs');
const dash = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
const svc = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const grab = n => { let s = dash.indexOf('function ' + n + '('); assert.ok(s >= 0, n); if (dash.slice(s - 6, s) === 'async ') s -= 6; const one = dash.slice(s, dash.indexOf('\n', s)); if (/\}\s*$/.test(one) && (one.match(/\{/g) || []).length === (one.match(/\}/g) || []).length) return one + '\n'; return dash.slice(s, dash.indexOf('\n}\n', s) + 3); };

// A lettered variant only matches listings that name its artist.
const b = coverMarketQuery({ series:'Robin Hood', issue:'1', artist:'David Nakayama', variant:true });
assert.equal(b.variant, true);
assert.ok(coverTitleMatches('Robin Hood #1 Cover B David Nakayama Variant', b));
assert.ok(!coverTitleMatches('Robin Hood #1 Cover A Joshua Middleton', b), 'a Cover A listing is not the Cover B');
const a = coverMarketQuery({ series:'Robin Hood', issue:'1', artist:'Joshua Middleton' });
assert.ok(coverTitleMatches('Robin Hood #1 NM 2026', a), 'Cover A stays broad');
assert.equal(coverMarketQuery({ series:'Robin Hood', issue:'1', variant:true }).variant, false, 'no artist on file: nothing to require');

// Hover: up to 8 listings, cheapest first, and sales when sold history is connected.
const listings = [12, 4.99, 30, 7.5, 9, 15, 22, 18, 25, 6].map((p, i) => ({ itemId:'i' + i, title:'Robin Hood #1 Cover B Nakayama ' + i, price:p, url:'https://ebay/' + i }));
const sum = summarizeCoverMarket(b, listings, [{ title:'Robin Hood #1 Cover B Nakayama', total:11, soldAt:'2026-10-01' }]);
assert.equal(sum.active.count, 10);
assert.deepEqual(sum.active.sample.map(x => x.price), [4.99, 6, 7.5, 9, 12, 15, 18, 22]);
// Store ask: "can we get listed items on there from eBay?" -- each with its picture, shipping and link; ours marked.
{
  const withPics = summarizeCoverMarket(b, [{ itemId:'v1|111|0', title:'Robin Hood #1 Cover B Nakayama', price:6.99, shipping:4.5, url:'https://ebay/1', imageUrl:'https://i/1.jpg', listingType:'Auction' }, { itemId:'v1|222|0', title:'Robin Hood #1 Cvr B Nakayama PRESALE', price:8.99, shipping:0, url:'https://ebay/2', imageUrl:'https://i/2.jpg', listingType:'FixedPrice' }], [], new Set(['222']));
  assert.deepEqual(withPics.active.sample, [{ title:'Robin Hood #1 Cover B Nakayama', price:6.99, shipping:4.5, url:'https://ebay/1', imageUrl:'https://i/1.jpg', auction:true }]);
  assert.deepEqual(withPics.active.own.map(x => x.url), ['https://ebay/2'], 'ours shown, not counted');
  assert.equal(withPics.active.count, 1);
}
assert.deepEqual(sum.sold.sample, [{ title:'Robin Hood #1 Cover B Nakayama', price:11, soldAt:'2026-10-01' }]);
assert.match(svc, /const cacheKey='foc-cover-market:v4:'\+query\.q\.toLowerCase\(\)\+\(query\.variant\?':v':''\);/, 'fresh checks, not the old 3-listing copies');

// The dashboard: which covers count as variants, and the hover text.
const ctx = { state:{ families:[{ id:'f1', title:'Robin Hood #1', seriesName:'Robin Hood' }] } };
vm.runInNewContext(['focFamilyCover', 'focRatioOf', 'focSkuMarketCover', 'focMarketSampleText'].map(grab).join('') + 'this.api={focSkuMarketCover,focMarketSampleText};', ctx);
const cov = v => ctx.api.focSkuMarketCover({ familyId:'f1', ...v });
assert.equal(cov({ id:'s1', variantLabel:'Cover A', coverArtist:'Joshua Middleton' }).variant, false);
assert.equal(cov({ id:'s2', variantLabel:'Cvr B David Nakayama', coverArtist:'David Nakayama' }).variant, true);
assert.equal(cov({ id:'s3', variantLabel:'Joshua Middleton', title:'ROBIN HOOD (2026) #1 CVR A JOSHUA MIDDLETON' }).variant, false, 'Lunar Cover A named by artist');
const r = cov({ id:'s4', variantLabel:'Cvr E 1:10 Ratio Cartoon Head Virgin', isIncentive:true, coverArtist:'Cartoon Head' });
assert.deepEqual([r.key, r.ratio, r.virgin, r.variant], ['sku:s4', 10, true, false]);
const hover = ctx.api.focMarketSampleText(sum);
assert.match(hover, /Listed now:\n\$4\.99 -- Robin Hood #1 Cover B Nakayama 1\n\$6\.00 -- /);
assert.match(hover, /Sold:\n\$11\.00 \(2026-10-01\) -- Robin Hood #1 Cover B Nakayama/);
assert.equal(ctx.api.focMarketSampleText({ active:{ count:0 } }), '');

// The week button: every cover, 12 at a time, refreshed; ratio covers on PriceCharting; no prices set.
{
  const sent = [], pcs = [], toasts = [];
  const skus = Array.from({ length:26 }, (_, i) => ({ id:'k' + i, familyId:'f1', variantLabel:i < 3 ? '1:25 Virgin' : 'Cover A', isIncentive:i < 3, upc:'u' + i }));
  const c = {
    state:{ cycle:{ id:'cy' }, families:[{ id:'f1', title:'Robin Hood #1', seriesName:'Robin Hood' }] },
    focIntel:{ market:{}, pc:{} }, allFocSkus:() => skus, confirm:() => true, toast_dash:t => toasts.push(t),
    focMarketRequest:async (covers, refresh) => { sent.push([covers.length, refresh]); covers.forEach(cv => { c.focIntel.market[cv.key] = { active:{ count:cv.key === 'sku:k5' ? 2 : 0 } }; }); },
    storeWorkerFetch:async (path, o) => { const items = JSON.parse(o.body).items; pcs.push([path, items.length]); return { json:async () => ({ products:items[0].key === 'k0' ? { k1:{ ok:true, product:{ comicPrices:{ ungraded:42 } } } } : {} }) }; },
    focSaveMarketCache:() => {}, focRedrawIntel:() => { c.redrawn = true; },
  };
  vm.runInNewContext(['focFamilyCover', 'focRatioOf', 'focSkuMarketCover', 'focPcRaw', 'focCheckWeekPrices'].map(grab).join('') + 'this.run=focCheckWeekPrices;', c);
  await c.run();
  assert.deepEqual(sent, [[12, true], [12, true], [2, true]]);
  assert.deepEqual(pcs, [['/pricing/pricecharting/comics/by-upc', 15], ['/pricing/pricecharting/comics/by-upc', 11]], 'every cover on PriceCharting, not just ratio covers');
  assert.ok(c.redrawn);
  assert.equal(toasts.at(-1), 'Checked 26 covers · 1 listed on eBay · 1 with PriceCharting sold prices');
}
assert.doesNotMatch(grab('focCheckWeekPrices'), /customerPrice|\/foc\/admin\/sku|focUseRatioPrice/, 'checks only -- never sets a price');
assert.match(dash, /onclick="focCheckWeekPrices\(\)">🔎 CHECK EBAY PRICES<\/button>/);
assert.match(grab('focVariantPillsHtml'), /var mk=!v\.isIncentive&&focIntel\.market\['sku:'\+v\.id\];\n  if\(mk\)pills=pills\.concat\(focMarketPills\(mk,v\.msrpCents\)\);/, 'every cover card shows its own eBay line');
assert.match(grab('focRatioValueHtml'), /title="'\+esc\(hover\)\+'" style="cursor:help"/, 'ratio VALUE boxes show the matches on hover');
assert.equal((dash.match(/^function focRatioOf\(/gm) || []).length, 1, 'one ratio reader');
// Store note: "we do have PriceCharting API that does comics" -- sold-based
// values for every cover, graded prices on hover.
{
  const c = { displayDate:d => d };
  vm.runInNewContext(['focPcRaw', 'focPcPill'].map(grab).join('') + 'this.pill=focPcPill;', c);
  const pill = c.pill({ ok:true, via:'barcode', at:'2026-10-21T10:00:00Z', product:{ productName:'Robin Hood #1 Cover B Nakayama', url:'https://www.pricecharting.com/game/comic-books-robin-hood/1b', comicPrices:{ ungraded:6.5, grade9_8:80, grade9_4:30 }, demand:{ salesVolume:14 } } });
  assert.equal(pill.text, '📈 PriceCharting $6.50 raw · 14 sold/yr');
  assert.equal(pill.href, 'https://www.pricecharting.com/game/comic-books-robin-hood/1b');
  assert.match(pill.title, /PriceCharting: Robin Hood #1 Cover B Nakayama \(matched by barcode\)\nRaw \/ ungraded: \$6\.50\nCGC 9\.8: \$80\.00\nCGC 9\.4: \$30\.00\nSales in the last year: 14/);
  assert.equal(c.pill({ ok:false, error:'No PriceCharting comic for Robin Hood #1 yet' }).text, '📈 PriceCharting: not listed yet');
  assert.equal(c.pill({ ok:true, product:{ productName:'X', comicPrices:{} } }).text, '📈 PriceCharting: no sales yet');
  assert.equal(c.pill(undefined), null);
}
assert.match(grab('focVariantPillsHtml'), /var pcp=!v\.isIncentive&&focPcPill\(focIntel\.pc\[v\.id\]\);if\(pcp\)pills\.push\(pcp\);/);
assert.match(grab('focRatioValueText'), /if\(warn&&!\(r\.raw&&\/sold history\/\.test\(warn\)\)\)parts\.push\(warn\);/, 'no "sold history isn\'t connected" when PriceCharting has the sold price');
{
  const c = { esc:x => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'), focEbaySearchUrl:q => 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(q) };
  vm.runInNewContext(['focListingRowHtml', 'focListingsHtml'].map(grab).join('') + 'this.list=focListingsHtml;', c);
  const html = c.list({ query:'Robin Hood #1 Nakayama', active:{ count:5, low:6.99, sample:[{ title:'Robin Hood #1 Cover B', price:6.99, shipping:4.5, url:'https://ebay/1', imageUrl:'https://i/1.jpg', auction:true }], own:[{ title:'Ours', price:8.99, shipping:0, url:'https://ebay/2', imageUrl:'' }] } });
  assert.match(html, /eBay listings \(5 others \+ yours\) · from \$6\.99<\/summary>/);
  assert.match(html, /<a href="https:\/\/ebay\/1" target="_blank"[^>]*><img src="https:\/\/i\/1\.jpg"/);
  assert.match(html, /AUCTION · <\/b>Robin Hood #1 Cover B[\s\S]*\$6\.99<br><span[^>]*>\+\$4\.50 ship/);
  assert.match(html, /YOURS · <\/b>Ours[\s\S]*free ship/);
  assert.match(html, /see all 5 on eBay ↗/);
  assert.equal(c.list({ query:'x', active:{ count:0, sample:[] } }), '');
  assert.equal(c.list(null), '');
}
assert.match(grab('focVariantPillsHtml'), /\+focListingsHtml\(focIntel\.market\['sku:'\+v\.id\]\);/, 'on every cover card, ratio covers too');
// Store report (screenshots): "It won't find another listing if it is a
// variation listing?" -- a seller's "TMNT: Holiday Special PREORDER" with a
// Cover choice ($7.49 to $62.49) never matched our 1:25 Chalky Wong cover:
// the cover is a choice in the listing, not in its title.
{
  const q = coverMarketQuery({ series:'Teenage Mutant Ninja Turtles Holiday Special', issue:'1', artist:'Chalky Wong', ratio:25 });
  assert.ok(coverTitleMatches('Teenage Mutant Ninja Turtles Holiday Special #1 Variant RI (25) (Chalky Wong) - PRESALE', q), 'RI (25)');
  assert.ok(coverTitleMatches('TMNT Teenage Mutant Ninja Turtles Holiday Special 1 1 in 25 Wong Variant', q), '1 in 25');
  assert.ok(coverTitleMatches('Teenage Mutant Ninja Turtles: Holiday Special #1 Cover B', coverMarketQuery({ series:'Teenage Mutant Ninja Turtles Holiday Special', issue:'1' })), 'a colon after a word ("Turtles:") no longer breaks the match');
  const searches = [], groupsRead = [];
  const deps = {
    ebayActiveListings:async (env, query) => { searches.push(query); return { listings:[
      { itemId:'v1|555|0', title:'Teenage Mutant Ninja Turtles: Holiday Special #1 PREORDER 12/9', price:7.49, itemGroupId:'555' },
      { itemId:'v1|777|0', title:'Teenage Mutant Ninja Turtles: Holiday Special #1 Cover A', price:4.99 } ] }; },
    ebayItemGroup:async (env, id) => { groupsRead.push(id); return { listings:[
      { itemId:'v1|555|1', title:'Teenage Mutant Ninja Turtles: Holiday Special #1 PREORDER 12/9', price:7.49, variantText:'Cover A Pallie' },
      { itemId:'v1|555|9', title:'Teenage Mutant Ninja Turtles: Holiday Special #1 PREORDER 12/9', price:62.49, variantText:'1:25 Chalky Wong Virgin', imageUrl:'https://i/9.jpg' } ] }; },
  };
  const caches = { broad:new Map(), groups:new Map() };
  const listings = await coverMarketListings(q, [], deps, {}, caches);
  assert.deepEqual(searches, ['Teenage Mutant Ninja Turtles Holiday Special #1'], 'searched by series and issue too');
  assert.deepEqual(groupsRead, ['555'], 'opened the multi-cover listing for that issue');
  const sum = summarizeCoverMarket(q, listings, []);
  assert.equal(sum.active.count, 1, 'only the 1:25 Chalky Wong choice -- not Cover A');
  assert.equal(sum.active.median, 62.49);
  assert.match(sum.active.sample[0].title, /PREORDER 12\/9 -- 1:25 Chalky Wong Virgin$/, 'the dropdown says which cover choice');
  await coverMarketListings(q, [], deps, {}, caches);
  assert.equal(searches.length + groupsRead.length, 2, 'one search and one group read per issue and listing');
  const plain = coverMarketQuery({ series:'Teenage Mutant Ninja Turtles Holiday Special', issue:'1' });
  assert.equal((await coverMarketListings(plain, [{ itemId:'x', title:'t' }], deps, {}, { broad:new Map(), groups:new Map() })).length, 1, 'Cover A: no extra searches');
}
assert.match(worker, /itemGroupId: String\(raw\.itemGroupHref \|\| ''\)\.match\(\/item_group_id=\(\\d\+\)\/\)\?\.\[1\]/);
assert.match(worker, /get_items_by_item_group\?item_group_id=/);
assert.match(worker, /ebayActiveListings: fetchEbayActiveListings, ebayItemGroup: fetchEbayItemGroup,/);
assert.match(svc, /active\.listings=await coverMarketListings\(query,active\.listings\|\|\[\],deps,env,groupCaches\);/);
assert.match(worker, /const listings = await coverMarketListings\(query, res\.listings \|\| \[\], \{ ebayActiveListings: fetchEbayActiveListings, ebayItemGroup: fetchEbayItemGroup \}, env, groupCaches\);/, 'the price watch too');
console.log('FOC week eBay price check and hover matches checks passed');
