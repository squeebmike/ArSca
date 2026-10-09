import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store report (found while fixing "released presales still say PRESALE"):
// switching a presale to in stock rebuilt the eBay listing from scratch --
// the store's whole description became "<title> / In stock now and ships
// promptly.", and its item specifics, extra photos and Gemini package size
// went with it -- while the PRESALE wording was never taken out of a
// multi-cover listing at all. The switch now edits the listing eBay has.
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const grab = sig => { const s = worker.indexOf(sig); assert.ok(s >= 0, 'missing ' + sig); return worker.slice(s, worker.indexOf('\n}\n', s) + 2); };
const line = sig => { const s = worker.indexOf(sig); assert.ok(s >= 0, 'missing ' + sig); return worker.slice(s, worker.indexOf('\n', s) + 1); };
const { toInStock } = new Function([
  line('const COMIC_GEMINI_MAILER ='), line('const COMIC_SHIPPING_NOTE ='), line('const COMIC_IN_STOCK_SHIPPING ='),
  grab('function truncateHtmlSafely('), grab('function comicPresaleNotice('), grab('function withComicListingNotices('),
  grab('function comicPresaleToInStockDescription('),
  'return { toInStock: comicPresaleToInStockDescription };',
].join('\n'))();

// The store's own HTML template, as a presale rendered it.
{
  const presale = '<div style="max-width:760px"><div>THE MANA POCKET</div><div>Saga #1</div>'
    + '<div style="background:#171717;color:#fff"><div style="color:#c391ff;font-weight:900">FAST, SECURE SHIPPING</div>\n'
    + 'We pack every comic to arrive protected against movement, bends and corner damage. Bagged & boarded and shipped in a Gemini mailer.\n\n'
    + 'For presale comics, orders ship promptly once the title reaches its official release date and inventory has been received from our distributor.\n\nRelease Date: December 2, 2026\n\n'
    + 'Publisher and distributor release dates may change. If a presale title is delayed, your order will ship as soon as the book becomes available.</div>'
    + '<div>Questions before ordering?</div></div>'
    + '<div style="max-width:760px;margin:8px auto 0;background:#ffd166;color:#171717;border:2px solid #171717;padding:12px 16px">PRESALE -- This comic has not been released yet. Expected release/ship date: December 2, 2026. Your order ships once it arrives from our distributor.</div>';
  const out = toInStock(presale);
  assert.doesNotMatch(out, /PRESALE|presale|not been released|release dates may change/, 'nothing still calls it a presale');
  assert.match(out, /Gemini mailer\.\n\nIn stock and ships within 1 business day with tracking\./, 'the shipping section says it ships now');
  assert.match(out, /THE MANA POCKET<\/div><div>Saga #1<\/div>/, 'the rest of the store\'s template is untouched');
  assert.match(out, /Release Date: December 2, 2026/, 'the (now past) release date stays as a plain fact');
  assert.equal((out.match(/Gemini mailer/g) || []).length, 1, 'the Gemini line isn\'t added twice');
}

// The default description (no store template), as eBay stores it.
{
  const presale = '<p>PRESALE -- This comic has not been released yet and is not currently in stock.</p><p>Expected on-sale/ship date: December 2, 2026. Your order ships promptly once we receive stock from the distributor on or shortly after that date.</p><p>Synopsis text.</p><p>Bagged &amp; boarded and shipped in a Gemini mailer.</p>';
  assert.equal(toInStock(presale), '<p>Synopsis text.</p><p>Bagged &amp; boarded and shipped in a Gemini mailer.</p>');
}

// Plain text.
{
  const presale = 'PRESALE -- This comic has not been released yet and is not currently in stock.\n\nExpected on-sale/ship date: December 2, 2026.\n\nSynopsis.\n\nBagged & boarded and shipped in a Gemini mailer.';
  assert.equal(toInStock(presale), 'Synopsis.\n\nBagged & boarded and shipped in a Gemini mailer.');
}

// ── The conversion edits the live listing ──
{
  const route = worker.slice(worker.indexOf("if (url.pathname === '/foc/ebay/convert-to-instock') {"), worker.indexOf("if (url.hostname === 'www.themanapocket.com' && url.pathname === '/robots.txt'"));
  assert.match(route, /await convertEbayRestListingToInStock\(ebayToken, \{\s*\n\s*sku: d\.ebaySku, offerId: d\.ebayOfferId,/, 'single-cover listings are converted in place');
  assert.doesNotMatch(route, /In stock now and ships promptly\./, 'the one-line replacement description is gone');
  assert.doesNotMatch(route, /await reviseEbayListing\(/, 'no more rebuilding the listing from scratch');
  const helper = worker.slice(worker.indexOf('async function convertEbayRestListingToInStock('), worker.indexOf('async function reviseEbayListing('));
  assert.match(helper, /const itemBody = \{ \.\.\.item \};/, 'the item goes back as eBay had it');
  assert.match(helper, /product\.title = stripPresaleSuffix\(product\.title \|\| ''\) \|\| product\.title;/);
  assert.match(helper, /if \(product\.description\) product\.description = comicPresaleToInStockDescription\(product\.description\);/);
  assert.match(helper, /if \(offerBody\.listingDescription\) offerBody\.listingDescription = comicPresaleToInStockDescription\(offerBody\.listingDescription\);/);
  assert.match(helper, /if \(fulfillmentPolicyId\) offerBody\.listingPolicies = \{ \.\.\.\(offer\.listingPolicies \|\| \{\}\), fulfillmentPolicyId \};/, 'switches to the normal shipping policy, keeping the other policies');
  const trading = worker.slice(worker.indexOf('async function convertEbayVariationListingToInStockTrading('), worker.indexOf('async function endEbayListingTrading('));
  assert.match(trading, /const newDescription = description \? comicPresaleToInStockDescription\(description\) : '';/, 'multi-cover listings lose the presale wording too');
  assert.match(trading, /<Description><!\[CDATA\[/);
}

console.log('FOC presale -> in-stock keeps the listing checks passed');
