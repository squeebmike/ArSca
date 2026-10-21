import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Store ask (screenshot of a 1:10 cover's VALUE box): "a button that will
// get each variant and check sold eBay or eBay listings... hover and see
// them when there's a match... check and update them all for that FOC week.
// Not put prices -- check prices."
const { coverMarketQuery, coverTitleMatches, summarizeCoverMarket } = await import('../scripts/foc-preorders.mjs');
const dash = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
const svc = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');
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
assert.deepEqual(sum.sold.sample, [{ title:'Robin Hood #1 Cover B Nakayama', price:11, soldAt:'2026-10-01' }]);
assert.match(svc, /const cacheKey='foc-cover-market:v2:'\+query\.q\.toLowerCase\(\)\+\(query\.variant\?':v':''\);/, 'fresh checks, not the old 3-listing copies');

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
console.log('FOC week eBay price check and hover matches checks passed');
