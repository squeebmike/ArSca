import fs from 'node:fs';
import assert from 'node:assert/strict';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// Store report (after several other providerUrl fixes): "no PriceCharting
// url" for cards picked straight from search results in Research / Pocket
// Scout's catalog search, even after every client-side hand-off was
// confirmed correct. Root cause was upstream of all of them: PriceCharting's
// /api/products (bulk search, used by both Research and Scout's catalog
// search) never returns a real product-url field, so normalizePcProduct's
// url fell back to `/game/${p.id}` -- not a real PriceCharting URL at all
// (those are slug-based: /game/<console-slug>/<product-slug>). Every
// search-result link was silently broken/dead this whole time, not
// genuinely missing -- only the single-product detail lookup (verifying a
// pasted/typed numeric id) built a real link, via its own separate slug
// construction at the /pricing/pricecharting/product/:id route. Now built
// the same way here, off the product-name/console-name every search result
// already carries.
assert.match(worker, /const pcSlug = value => String\(value \|\| ''\)\.toLowerCase\(\)\.replace\(\/\['’\]\/g, ''\)\.replace\(\/\[\^a-z0-9\]\+\/g, '-'\)\.replace\(\/\^-\+\|-\+\$\/g, ''\);/,
  'must have a slug helper matching the one already used by the single-product detail route');
assert.match(worker, /const normalizePcProduct = \(p, q = ''\) => \(\{/, 'missing normalizePcProduct');
{
  const fnStart = worker.indexOf("const pcSlug = value =>");
  const fnEnd = worker.indexOf("imageUrl: pcImageUrl(p),", fnStart);
  const fn = worker.slice(fnStart, fnEnd);
  assert.match(fn, /url: p\['product-url'\] \|\| p\.url \|\| \(\(\(p\['product-name'\] \|\| p\.productName\) && \(p\['console-name'\] \|\| p\.consoleName\)\)\s*\n\s*\? `https:\/\/www\.pricecharting\.com\/game\/\$\{pcSlug\(p\['console-name'\] \|\| p\.consoleName\)\}\/\$\{pcSlug\(p\['product-name'\] \|\| p\.productName\)\}`\s*\n\s*: null\),/,
    'the url field must build a real slug-based product page link from console/product name when the API response has no direct url, not the broken bare-numeric-id guess');
  assert.doesNotMatch(fn, /`https:\/\/www\.pricecharting\.com\/game\/\$\{p\.id\}`/,
    'the old broken bare-id fallback (not a real PriceCharting URL) must be gone');
}

console.log('PriceCharting search-result url contract checks passed');

// ── Functional: verify the slug construction actually produces a real,
// working-shaped PriceCharting product URL ──
{
  const pcSlug = value => String(value || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const buildUrl = (consoleName, productName) => `https://www.pricecharting.com/game/${pcSlug(consoleName)}/${pcSlug(productName)}`;
  assert.equal(
    buildUrl('2021 Topps Baseball', "Cal Raleigh [Fuchsia] #49"),
    'https://www.pricecharting.com/game/2021-topps-baseball/cal-raleigh-fuchsia-49',
    'must build a real slug-based /game/<console>/<product> URL, not a bare numeric id'
  );
}

console.log('PriceCharting search-result url functional checks passed');
