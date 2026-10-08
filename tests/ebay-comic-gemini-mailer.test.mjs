import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store ask: "For ebay listings. The comics should ship size Gemini boxes.
// Make the ebay listing default to that. Then in the listing itself say
// presale. Not [just the] title. Also the listings should say board bagged
// and shipped in gemini mailer."

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const dashboard = fs.readFileSync('dashboard.html', 'utf8');

const grab = (src, sig) => { const s = src.indexOf(sig); assert.ok(s >= 0, 'missing ' + sig); return src.slice(s, src.indexOf('\n}\n', s) + 2); };
const line = (src, sig) => { const s = src.indexOf(sig); assert.ok(s >= 0, 'missing ' + sig); return src.slice(s, src.indexOf('\n', s) + 1); };

const helpers = new Function([
  line(worker, 'const COMIC_GEMINI_MAILER ='), line(worker, 'const COMIC_SHIPPING_NOTE ='),
  grab(worker, 'function truncateHtmlSafely('), grab(worker, 'function comicPresaleNotice('),
  grab(worker, 'function withComicListingNotices('), grab(worker, 'function ebayOnSaleLabel('),
  grab(worker, 'function isComicEbayListing('), grab(worker, 'function applyComicListingDefaults('),
  'return { COMIC_GEMINI_MAILER, withComicListingNotices, applyComicListingDefaults };',
].join('\n'))();
const { COMIC_GEMINI_MAILER, withComicListingNotices, applyComicListingDefaults } = helpers;

// ── Package: the Gemini Comic Flash Mailer's outside size ──
assert.equal(COMIC_GEMINI_MAILER.dimLength, 12.75);
assert.equal(COMIC_GEMINI_MAILER.dimWidth, 7.75);
assert.equal(COMIC_GEMINI_MAILER.dimHeight, 1.25);
{
  const comic = applyComicListingDefaults({ categoryId:'259104', title:'Saga #1', description:'Great book.' });
  assert.deepEqual([comic.dimLength, comic.dimWidth, comic.dimHeight, comic.dimUnit], [12.75, 7.75, 1.25, 'INCH'], 'a comic listing with no size set gets the Gemini mailer size');
  assert.match(comic.description, /Bagged & boarded and shipped in a Gemini mailer\.$/, 'and says how it ships');
  const custom = applyComicListingDefaults({ isComic:true, dimLength:13, dimWidth:9, dimHeight:2, description:'x' });
  assert.equal(custom.dimLength, 13, 'a size the store set on the listing form is kept');
  const card = applyComicListingDefaults({ categoryId:'261328', description:'Card.' });
  assert.equal(card.dimLength, undefined, 'non-comic listings are untouched');
  assert.equal(card.description, 'Card.');
}

// ── Description notices ──
{
  const presale = withComicListingNotices('Story text.', { presale:true, onSaleLabel:'November 5, 2026' });
  assert.match(presale, /^PRESALE -- This comic has not been released yet/, 'a presale says PRESALE in the listing body, not only the title');
  assert.match(presale, /Expected on-sale\/ship date: November 5, 2026\./, 'with the ship date eBay\'s presale policy asks for');
  assert.match(presale, /Story text\.\n\nBagged & boarded and shipped in a Gemini mailer\.$/);
  const already = withComicListingNotices('PRESALE! Ships Nov 5.\n\nBagged and boarded, shipped in a Gemini mailer.', { presale:true, onSaleLabel:'November 5, 2026' });
  assert.equal(already, 'PRESALE! Ships Nov 5.\n\nBagged and boarded, shipped in a Gemini mailer.', 'nothing is added twice');
  assert.doesNotMatch(withComicListingNotices('In stock.', {}), /PRESALE/, 'an in-stock comic is never called a presale');
  const html = withComicListingNotices('<h2>Saga #1</h2><p>Story.</p>', { presale:true, onSaleLabel:'November 5, 2026' });
  assert.match(html, /^<p><b>PRESALE -- /, 'an HTML template gets the notice as an HTML paragraph');
  assert.match(html, /<p>Bagged &amp; boarded and shipped in a Gemini mailer\.<\/p>$/);
  const long = withComicListingNotices('word '.repeat(1200), { presale:true, onSaleLabel:'November 5, 2026' });
  assert.ok(long.length <= 4000, 'stays inside eBay\'s 4000-character limit');
  assert.match(long, /^PRESALE/); assert.match(long, /Gemini mailer\.$/, 'both notices survive a long description');
}

// ── Wiring ──
assert.match(worker, /async function createAndPublishEbayListing\(b, ebayToken, env, storeId\) \{\s*\n\s*b = applyComicListingDefaults\(b\);/, 'every single listing goes through the comic defaults');
assert.match(worker, /async function createAndPublishEbayVariationListingTrading\(b, ebayToken, env, storeId\) \{\s*\n\s*b = applyComicListingDefaults\(b\);/, 'multi-cover listings too');
assert.match(worker, /<ShippingPackageDetails>\$\{dimsXml\}\$\{weightXml\}<\/ShippingPackageDetails>/, 'multi-cover listings send the package size, not only the weight');
assert.match(worker, /const description = withComicListingNotices\(\(typeof body\.description === 'string' && body\.description\.trim\(\)\) \? body\.description\.trim\(\)\.substring\(0, 4000\) : defaults\.description, \{ presale: true, onSaleLabel: defaults\.onSaleLabel \}\);/,
  'a FOC presale\'s custom description template can\'t drop the presale notice');
assert.match(worker, /const weight = \{ weightValue: bookLb \+ COMIC_GEMINI_MAILER\.emptyWeightLb, weightUnit: 'POUND' \};/, 'FOC presale weights include the mailer');
assert.match(dashboard, /const dimLengthVal = \(liveOk && live\.item\?\.dimLength\) \|\| \(isComic \? 12\.75 : isSealed \? 8 : 6\.5\);/, 'the listing form defaults a comic to the Gemini size');
assert.match(dashboard, /const weightVal = \(liveOk && live\.item\?\.weightValue\) \|\| \(isComic \? 0\.5625 : isSealed \? 1 : 0\.1\);/, 'and about 9 oz');
assert.match(dashboard, /isComic:computeEbayListingFields\(item\)\.isComic,/, 'the form tells the Worker it is a comic');
assert.match(dashboard, /'Bagged & boarded and shipped in a Gemini mailer to prevent bending or creasing\. In-stock comics ship within 1 business day with tracking\.'/, 'the comic shipping line says bagged & boarded and Gemini mailer');

console.log('eBay comic Gemini mailer checks passed');
