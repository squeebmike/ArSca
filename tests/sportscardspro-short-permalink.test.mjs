import fs from 'node:fs';
import assert from 'node:assert/strict';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// Store report (with a screenshot): pasting a saved SportsCardsPro link --
// https://www.sportscardspro.com/game/5565956 -- into the inventory
// "PriceCharting / SportsCardsPro Product ID or URL" field failed with
// "That doesn't look like a product page URL (expected .../game/<console>/
// <product>)", even though the link opens the correct card when visited
// directly in a browser. Over 100 sports cards already have this exact
// short-permalink shape saved. Root cause: /pricing/sportscardspro/
// resolve-url only recognized the long slug shape (.../game/<console>/
// <product>) and 400'd on anything else, including this genuinely valid
// shorter shape SportsCardsPro also serves (.../game/<numeric-id>, no
// slug). Fixed by recognizing the short form as its own valid case
// alongside the slug form -- not replacing it, so the 100+ links already
// saved in the OLD slug format keep working exactly as before.

const fnStart = worker.indexOf("if (url.pathname === '/pricing/sportscardspro/resolve-url') {");
const fnEnd = worker.indexOf("\n\n    // ── SportsCardsPro: candidate list", fnStart);
const fnBody = worker.slice(fnStart, fnEnd);
assert.ok(fnStart !== -1, 'the /pricing/sportscardspro/resolve-url route must exist');

assert.match(fnBody, /const slugMatch = parsed\.pathname\.match\(\/\^\\\/game\\\/\(\[\^\/\]\+\)\\\/\(\[\^\/\]\+\)\/\);/, 'the long slug form (.../game/<console>/<product>) must still be recognized -- the 100+ existing saved links in this shape must keep working');
assert.match(fnBody, /const shortIdMatch = !slugMatch \? parsed\.pathname\.match\(\/\^\\\/game\\\/\(\\d\+\)\\\/\?\$\/\) : null;/, 'the short permalink form (.../game/<numeric-id>, no slug) must be recognized as its own valid case');
assert.match(fnBody, /if \(!slugMatch && !shortIdMatch\) return json/, 'the 400 must only fire when NEITHER shape matched');

console.log('SportsCardsPro short-permalink contract checks passed');

// ── Functional: the actual path-matching + scrape-URL-building logic ──
function resolvePath(pathname) {
  const slugMatch = pathname.match(/^\/game\/([^/]+)\/([^/]+)/);
  const shortIdMatch = !slugMatch ? pathname.match(/^\/game\/(\d+)\/?$/) : null;
  if (!slugMatch && !shortIdMatch) return { ok: false };
  const [, consoleSlug, productSlug] = slugMatch || [];
  const scrapeUrl = slugMatch
    ? `https://www.sportscardspro.com/game/${consoleSlug}/${productSlug}`
    : `https://www.sportscardspro.com/game/${shortIdMatch[1]}`;
  const priceChartingId = shortIdMatch ? shortIdMatch[1] : '';
  return { ok: true, consoleSlug, productSlug, scrapeUrl, priceChartingId };
}

{
  // The exact URL from the store report.
  const r = resolvePath('/game/5565956');
  assert.equal(r.ok, true, 'a bare numeric permalink must be accepted, not rejected as garbage');
  assert.equal(r.scrapeUrl, 'https://www.sportscardspro.com/game/5565956', 'must scrape the short URL itself -- there is no slug to build a different one from');
  assert.equal(r.priceChartingId, '5565956', 'the numeric id embedded in the short URL IS the PriceCharting id -- it must be used directly');
}

{
  // The long form that 100+ other saved links (and pricecharting.com links) already use -- must be completely unaffected.
  const r = resolvePath('/game/baseball-cards-2022-bowman/cal-raleigh-fuchsia-49');
  assert.equal(r.ok, true);
  assert.equal(r.consoleSlug, 'baseball-cards-2022-bowman');
  assert.equal(r.productSlug, 'cal-raleigh-fuchsia-49');
  assert.equal(r.scrapeUrl, 'https://www.sportscardspro.com/game/baseball-cards-2022-bowman/cal-raleigh-fuchsia-49', 'the long slug form must build its scrape URL exactly as before');
  assert.equal(r.priceChartingId, '', 'the long slug form has no id embedded in the URL -- it must still come from scraping the page, not be invented');
}

{
  // A trailing slash on the short form must not break it.
  const r = resolvePath('/game/5565956/');
  assert.equal(r.ok, true, 'a trailing slash on the short permalink must still resolve');
  assert.equal(r.priceChartingId, '5565956');
}

{
  // Genuine garbage must still be rejected -- this isn't a "match anything" regression.
  const r = resolvePath('/about');
  assert.equal(r.ok, false, 'a path that is not any known product-page shape must still be rejected');
}

{
  const r = resolvePath('/game/');
  assert.equal(r.ok, false, 'an empty product path must still be rejected, not misread as a short numeric id');
}

console.log('SportsCardsPro short-permalink functional checks passed');
