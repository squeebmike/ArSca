import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store report: "You didn't add the stuff in the template for comics about
// Gemini shipping and pre sale in listing". The notices were only added by
// the Worker at publish time, so they never showed in the description box,
// and the store's own Settings shipping line ("Ships carefully packed from
// The Mana Pocket in Kitsap, WA.") replaced the comic wording entirely.
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const foc = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
const grab = sig => { const s = dashboard.indexOf(sig); assert.ok(s >= 0, 'missing ' + sig); return dashboard.slice(s, dashboard.indexOf('\n}\n', s) + 2); };
const line = sig => { const s = dashboard.indexOf(sig); assert.ok(s >= 0, 'missing ' + sig); return dashboard.slice(s, dashboard.indexOf('\n', s) + 1); };

let profile = {};
const api = new Function('getVendorProfile', 'isEbayTradingCardCategory', 'escHtml', [
  line('const COMIC_GEMINI_LINE ='), grab('function comicPresaleBannerText('), grab('function comicPresaleBannerHtml('),
  grab('function withComicPresaleBanner('), grab('function resolveEbayShippingLine('), grab('function resolveEbayShippingLineBase('),
  'return { resolveEbayShippingLine, withComicPresaleBanner };',
].join('\n'))(() => profile, () => false, s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'));

// ── Shipping line ──
profile = { ebayShippingLine:'Ships carefully packed from The Mana Pocket in Kitsap, WA.' };
assert.equal(api.resolveEbayShippingLine('Comic', true, false, false, '259104'),
  'Bagged & boarded and shipped in a Gemini mailer. Ships carefully packed from The Mana Pocket in Kitsap, WA.',
  'the store-wide shipping line still gets the comic packaging');
assert.equal(api.resolveEbayShippingLine('Sports', false, false, false, ''), 'Ships carefully packed from The Mana Pocket in Kitsap, WA.', 'other categories are unchanged');
profile = { ebayShippingLines:{ Comic:'Shipped in a Gemini mailer, bagged and boarded.' } };
assert.equal(api.resolveEbayShippingLine('Comic', true, false, false, ''), 'Shipped in a Gemini mailer, bagged and boarded.', 'a comic line that already says Gemini is left alone');
profile = {};
assert.match(api.resolveEbayShippingLine('Comic', true, false, false, ''), /^Bagged & boarded and shipped in a Gemini mailer/);

// ── PRESALE banner ──
{
  const html = api.withComicPresaleBanner('<div>For presale comics, orders ship promptly once…</div>', 'December 2, 2026');
  assert.match(html, /^<div>For presale comics, orders ship promptly once…<\/div><div style="[^"]*background:#ffd166[^"]*">PRESALE -- This comic has not been released yet\. Expected release\/ship date: December 2, 2026\. Your order ships once it arrives from our distributor\.<\/div>$/,
    'an HTML template gets a PRESALE bar at the bottom (store ask) -- the shipping sentence\'s lower-case "presale comics" alone doesn\'t count');
  const text = api.withComicPresaleBanner('Saga #1\n\nGreat book.', 'December 2, 2026');
  assert.match(text, /^Saga #1\n\nGreat book\.\n\nPRESALE -- This comic has not been released yet\. Expected release\/ship date: December 2, 2026\./, 'plain text gets it at the bottom too');
  const own = '<div>PRESALE -- releases Dec 2</div><div>Body</div>';
  assert.equal(api.withComicPresaleBanner(own, 'December 2, 2026'), own, 'a template with its own PRESALE banner gets no second one');
}

// ── Wiring: the description box shows it ──
assert.match(dashboard, /\? \[isComic \? COMIC_GEMINI_LINE : '', 'For presale comics, orders ship promptly/, 'a presale comic\'s {shippingLine} says bagged & boarded / Gemini too');
assert.match(dashboard, /const bodyText = comicPresaleLabel === null \? renderedBodyText : withComicPresaleBanner\(renderedBodyText, comicPresaleLabel\);/, 'the listing form\'s description opens with the PRESALE banner for a presale comic');
assert.match(dashboard, /if\(fields\.comicPresaleLabel !== null && fields\.comicPresaleLabel !== undefined\) bodyText = withComicPresaleBanner\(bodyText, fields\.comicPresaleLabel\);/, 'the AI button keeps the banner');
assert.equal((foc.match(/var presaleShippingLine=\[\(typeof COMIC_GEMINI_LINE!=='undefined'\?COMIC_GEMINI_LINE:'Bagged & boarded and shipped in a Gemini mailer\.'\),'For presale comics/g) || []).length, 2, 'both FOC review screens say bagged & boarded / Gemini');
assert.equal((foc.match(/var templateAlreadyDisclosesPresale=\/\\bPRESALE\\b\/\.test\(renderedBody\);/g) || []).length, 2, 'both FOC review screens add the PRESALE banner unless the template has its own');
assert.equal((foc.match(/typeof comicPresaleBannerHtml==='function'\?comicPresaleBannerHtml\(preview\.onSaleLabel\|\|''\)/g) || []).length, 2, 'an HTML template gets the styled banner on the FOC screens');

console.log('eBay comic listing text checks passed');
