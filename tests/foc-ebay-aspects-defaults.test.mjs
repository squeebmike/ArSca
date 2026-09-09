import fs from 'node:fs';
import assert from 'node:assert/strict';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// Live repro: every FOC eBay listing showed a full page of unchecked
// "Suggested item specifics -- powered by eBay.ai" (Tradition, Era,
// Language, Signed, Type, Unit of Sale, Personalized, Inscribed, Vintage,
// Style, Issue Number, Publication Year) that had to be manually reviewed
// and applied on every single listing after publish -- eBay only offers
// those as AI suggestions when it has no real value for that aspect from
// what was actually submitted. customAspects previously only ever sent
// Publisher/Writer/Artist/Cover Artist/Release Date, none of which overlap
// the fields eBay was left to guess at.

assert.match(worker, /function buildFocPresaleDefaults\(sku, priceCents, onSaleDate, issueNumber = '', seriesName = ''\) \{/,
  'buildFocPresaleDefaults must accept issueNumber and seriesName parameters');

{
  const fnStart = worker.indexOf("function buildFocPresaleDefaults(sku, priceCents, onSaleDate, issueNumber = '', seriesName = '') {");
  const fnEnd = worker.indexOf('\n    }', fnStart) + 6;
  const fn = worker.slice(fnStart, fnEnd);
  assert.match(fn, /'Issue Number': issueNumber \|\| '', 'Publication Year': String\(onSaleDate\.getUTCFullYear\(\)\),/,
    'must send Issue Number and Publication Year derived from real data instead of leaving them for eBay to guess');
  assert.match(fn, /Tradition: 'US Comics', Era: 'Modern Age \(1992-Now\)', Language: 'English',/,
    'must send the safe universal defaults (Tradition/Era/Language) every FOC presale comic actually has');
  assert.match(fn, /Type: 'Comic Book', 'Unit of Sale': 'Single Unit', Style: 'Color',/,
    'must send Type/Unit of Sale/Style defaults');
  assert.match(fn, /Signed: 'No', Personalized: 'No', Inscribed: 'No', Vintage: 'No',/,
    'must send the No-by-default aspects for a brand-new, unsigned, non-vintage presale comic');
  // Store report (live listing screenshot): "Series Title" showed up blank
  // on eBay's own item specifics page -- a real aspect eBay's comics
  // category recognizes, now sourced from comic_title_families.series_name
  // (the caller-provided seriesName), falling back to stripping a trailing
  // "#<issue>" off the title only when no real series_name is on hand.
  assert.match(fn, /const seriesTitle = seriesName \|\| baseTitle\.replace\(\/\\s\*#\\s\*\[\\w\.-\]\+\\s\*\$\/, ''\)\.trim\(\) \|\| baseTitle;/,
    'must prefer the real series_name, falling back to stripping a trailing issue number off the title');
  assert.match(fn, /'Release Date': onSaleLabel, 'Series Title': seriesTitle,/, 'Series Title must actually be sent as a customAspect');
  // Store request: "better ebay titles with seo?" -- the publisher is real,
  // on-file data and a genuine buyer search term, appended to the title
  // when it fits without truncating the series/issue/variant itself.
  assert.match(fn, /const publisherKeyword = String\(sku\.publisher \|\| ''\)\.trim\(\);/, 'must derive a publisher SEO keyword from real sku data');
  assert.match(fn, /if \(publisherKeyword && !titleBase\.toLowerCase\(\)\.includes\(publisherKeyword\.toLowerCase\(\)\)\) \{/,
    'must not append the publisher if it is already present in the title (avoids "Marvel ... Marvel - PRESALE")');
  assert.match(fn, /if \(withPublisher\.length <= 80\) title = withPublisher;/, 'must only use the publisher-enhanced title when it still fits eBay\'s 80-char cap');
}

console.log('buildFocPresaleDefaults aspects contract checks passed');

// ── The issue number and series name must actually be fetched (from the
// title family, not the SKU itself -- every variant cover of one issue
// shares one family row) and threaded through into the defaults call ──
assert.match(worker, /const \{ data: familyRows \} = await supabaseAdminFetch\(env, `comic_title_families\?id=eq\.\$\{encodeURIComponent\(sku\.family_id\)\}&select=issue_number,series_name`\);/,
  'must fetch the issue_number AND series_name from comic_title_families by the sku\'s family_id');
assert.match(worker, /issueNumber = familyRows\?\.\[0\]\?\.issue_number \|\| '';\s*\n\s*seriesName = familyRows\?\.\[0\]\?\.series_name \|\| '';/,
  'must actually capture the fetched issue_number and series_name');
assert.match(worker, /const defaults = buildFocPresaleDefaults\(sku, priceCents, onSaleDate, issueNumber, seriesName\);/,
  'the fetched issueNumber/seriesName must actually be passed into buildFocPresaleDefaults, or fetching them was pointless');

console.log('Issue number + series name fetch-and-thread contract checks passed');

// ── The group-listing route must thread family.series_name through too ──
assert.match(worker, /comic_title_families\?id=eq\.\$\{encodeURIComponent\(familyId\)\}&store_id=eq\.\$\{encodeURIComponent\(storeId\)\}&select=id,title,issue_number,series_name/,
  'the group-listing family fetch must also select series_name');
assert.match(worker, /buildFocPresaleDefaults\(\{ \.\.\.repSku, title: family\.title, variant_label: '' \}, eligibleCovers\[0\]\.priceCents, onSaleDate, family\.issue_number \|\| '', family\.series_name \|\| ''\);/,
  'the group preview route must pass family.series_name through');
assert.match(worker, /buildFocPresaleDefaults\(\{ \.\.\.repSku, title: family\.title, variant_label: '' \}, built\[0\]\.priceCents \|\| Math\.round\(Number\(built\[0\]\.price\) \* 100\), onSaleDate, family\.issue_number \|\| '', family\.series_name \|\| ''\);/,
  'the group create route must pass family.series_name through, matching the preview route');

console.log('Group-listing series name threading contract checks passed');

// ── Functional: buildFocPresaleDefaults' aspect-building logic in isolation ──
{
  const fnStart = worker.indexOf("function buildFocPresaleDefaults(sku, priceCents, onSaleDate, issueNumber = '', seriesName = '') {");
  const fnEnd = worker.indexOf('\n    }', fnStart) + 6;
  const src = worker.slice(fnStart, fnEnd).replace(/^\s*function/, 'function');
  // truncateAtWordBoundary is referenced but irrelevant to the aspects this
  // test checks -- stub it so the function can run standalone.
  const buildFocPresaleDefaults = new Function('truncateAtWordBoundary', src + '\nreturn buildFocPresaleDefaults;')(s => s);
  const sku = { title: 'Amazing Spider-Man #3', publisher: 'Marvel', writer: 'Zeb Wells', interior_artist: 'John Romita Jr.', cover_artist: 'John Romita Jr.' };
  const onSaleDate = new Date('2026-09-23T00:00:00Z');
  const result = buildFocPresaleDefaults(sku, 499, onSaleDate, '3', 'Amazing Spider-Man');
  assert.equal(result.customAspects['Issue Number'], '3', 'issue number must flow through into the actual aspects sent');
  assert.equal(result.customAspects['Publication Year'], '2026', 'publication year must be derived from the on-sale date');
  assert.equal(result.customAspects.Tradition, 'US Comics');
  assert.equal(result.customAspects.Signed, 'No');
  assert.equal(result.customAspects.Publisher, 'Marvel', 'the pre-existing Publisher/Writer/Artist aspects must be unaffected');
  assert.equal(result.customAspects['Series Title'], 'Amazing Spider-Man', 'a real series_name must be sent as-is');
  assert.equal(result.title, 'Amazing Spider-Man #3 Marvel - PRESALE', 'the publisher must be appended to the title as an SEO keyword when it fits and isn\'t already present');

  // No real series_name on hand -- must fall back to stripping the issue
  // number off the title instead of leaving Series Title blank.
  const noSeriesName = buildFocPresaleDefaults(sku, 499, onSaleDate, '3', '');
  assert.equal(noSeriesName.customAspects['Series Title'], 'Amazing Spider-Man', 'must derive a series title by stripping the trailing issue number when no real series_name was provided');

  // Publisher already present in the title -- must not duplicate it.
  const alreadyHasPublisher = buildFocPresaleDefaults({ ...sku, title: 'Marvel Zombies #1' }, 499, onSaleDate, '1', '');
  assert.equal(alreadyHasPublisher.title, 'Marvel Zombies #1 - PRESALE', 'must not append a publisher keyword already present in the title');
}

console.log('buildFocPresaleDefaults aspects functional checks passed');

// ── buildEbayAspects must merge Writer/Artist into eBay's real combined
// "Artist/Writer" aspect -- live screenshot of eBay's own Variations edit
// page showed "Artist/Writer" blank even though Writer and Artist were
// both being sent under their own (non-standard, silently-ignored) names ──
{
  const fnStart = worker.indexOf('function buildEbayAspects(b) {');
  const fnEnd = worker.indexOf('\n}', fnStart) + 2;
  const fn = worker.slice(fnStart, fnEnd);
  assert.match(fn, /const artistWriterValues = \[\.\.\.new Set\(\[\.\.\.\(aspects\['Writer'\] \|\| \[\]\), \.\.\.\(aspects\['Artist'\] \|\| \[\]\)\]\)\];/,
    'must combine Writer and Artist values into one deduplicated list');
  assert.match(fn, /delete aspects\['Writer'\]; delete aspects\['Artist'\];/, 'the non-standard Writer/Artist keys must not be sent to eBay');
  assert.match(fn, /if \(artistWriterValues\.length\) aspects\['Artist\/Writer'\] = artistWriterValues;/, 'must send the real combined "Artist/Writer" aspect eBay actually recognizes');

  const buildEbayAspects = new Function(fn + '\nreturn buildEbayAspects;')();
  const result = buildEbayAspects({ categoryId: '259104', conditionId: '3000', customAspects: { Writer: 'Zeb Wells', Artist: 'John Romita Jr.', Publisher: 'Marvel' } });
  assert.deepEqual(result['Artist/Writer'], ['Zeb Wells', 'John Romita Jr.'], 'both values must reach the real combined aspect');
  assert.ok(!('Writer' in result), 'the non-standard Writer key must not survive into the final aspects sent to eBay');
  assert.ok(!('Artist' in result), 'the non-standard Artist key must not survive into the final aspects sent to eBay');
  assert.deepEqual(result.Publisher, ['Marvel'], 'unrelated aspects must be unaffected');

  // Same person as both writer and artist must not produce a duplicate value.
  const dedupResult = buildEbayAspects({ categoryId: '259104', conditionId: '3000', customAspects: { Writer: 'Todd McFarlane', Artist: 'Todd McFarlane' } });
  assert.deepEqual(dedupResult['Artist/Writer'], ['Todd McFarlane'], 'must not send a duplicate value when the same person wrote and drew the book');
}

console.log('buildEbayAspects Artist/Writer merge checks passed');
