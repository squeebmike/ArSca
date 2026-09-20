import fs from 'node:fs';
import assert from 'node:assert/strict';
import { handleFocRequest } from '../scripts/foc-preorders.mjs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const foc = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');

// Store report: sharing a comic preorder to Facebook always showed the
// generic /shop or /preorders page preview -- title "Shop Sports Cards, TCG
// & Comics", no item image -- because those pages are 100% client-rendered.
// Facebook's link-preview scraper never executes JS, so it only ever sees
// whatever static <meta> tags are already in the initial HTTP response, and
// there was only one, sitewide, non-item-specific set of those. This adds a
// real, permanent, server-rendered GET /preorder/{skuId}/{slug} page with
// THIS cover's own og:title/og:description/og:image baked into the response
// -- and, critically, no self-redirect and a themanapocket.com canonical, so
// Google can actually index the page itself (the old version self-redirected
// via `location.replace` immediately and pointed its canonical at the
// Worker's own workers.dev subdomain -- fine for a link-preview scraper,
// exactly backwards for ranking on a book's own name). This follows
// /book/{id}/{slug} and /item/{id}/{slug} -- the same fix already shipped
// for backlist books and inventory items.

assert.match(worker, /url\.pathname\.startsWith\('\/preorder\/'\)/,
  'the Worker\'s router must dispatch /preorder/{id} requests to the FOC handler');
assert.match(worker, /url\.pathname === '\/sitemap-preorders\.xml'/,
  'the Worker\'s router must dispatch /sitemap-preorders.xml to the FOC handler');
assert.match(worker, /mtgPageShell, mtgEscapeHtml, mtgSlugify, publicStoreId: ITEM_DETAIL_STORE_ID,\s*\n\s*\}\);\s*\n\s*\}\s*\n\s*\n\s*if \(url\.pathname\.startsWith\('\/public\/backlist\//,
  'handleFocRequest must receive the same mtgPageShell/mtgEscapeHtml/mtgSlugify/publicStoreId deps handleBacklistRequest already uses for its own SEO pages');

assert.match(foc, /if\(path\.startsWith\('\/preorder\/'\)&&request\.method==='GET'\)\{/,
  'handleFocRequest must own the /preorder/{id}/{slug} route');
assert.match(foc, /if\(path==='\/sitemap-preorders\.xml'&&request\.method==='GET'\)return preorderSitemap\(env,deps\);/,
  'handleFocRequest must own the /sitemap-preorders.xml route');
assert.match(foc, /async function preorderDetailPage\(env, deps, skuId, providedSlug\) \{/,
  'missing preorderDetailPage');
assert.match(foc, /function notFoundPreorderPage\(deps\) \{/,
  'missing notFoundPreorderPage for an unknown/disabled sku');
assert.doesNotMatch(foc, /still-resonance-4f87\.swarnerauto\.workers\.dev\/preorder\//,
  'the workers.dev share-page anti-pattern must be fully gone, not left dangling alongside the new page');
assert.doesNotMatch(foc, /location\.replace\(\$\{JSON\.stringify\(appUrl\)\}\)/,
  'the page must no longer self-redirect a real visitor away before a crawler -- or a person -- can read it');

function fakeMtgEscapeHtml(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch])); }
function fakeMtgSlugify(v) { return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'preorder'; }
function fakeMtgPageShell({ title, description, canonicalPath, ogImage, jsonLd, bodyHtml }) {
  return `<title>${fakeMtgEscapeHtml(title)}</title><meta name="description" content="${fakeMtgEscapeHtml(description)}">` +
    `<link rel="canonical" href="https://themanapocket.com${canonicalPath}">` +
    (ogImage ? `<meta property="og:image" content="${fakeMtgEscapeHtml(ogImage)}">` : '') +
    (jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : '') +
    `<body>${bodyHtml}</body>`;
}
function seoDeps(overrides = {}) {
  return { json:(data, status = 200) => ({ status, data }), supabaseAdminFetch:async () => ({ data:[] }),
    mtgPageShell:fakeMtgPageShell, mtgEscapeHtml:fakeMtgEscapeHtml, mtgSlugify:fakeMtgSlugify,
    publicStoreId:'store-1', ...overrides };
}
function mockGetRequest() { return { method:'GET', headers:{ get:() => null } }; }

const skuId = '22222222-2222-4222-8222-222222222222';
const skuRow = {
  id:skuId, family_id:'family-1', cycle_id:'cycle-1', variant_label:'Cover B', cover_image_url:'https://img/cover.jpg',
  customer_price_cents:499, customer_enabled:true, is_incentive:false, description:'A really good comic.',
};
const familyRow = { id:'family-1', series_name:'Test Comic', issue_number:'20', publisher:'Test Press', imprint:null, description:'Series synopsis.' };
const cycleRow = { id:'cycle-1', foc_date:'2026-10-06' };

function catalogDeps(overrides = {}) {
  return seoDeps({
    supabaseAdminFetch: async (env, path) => {
      if (path.startsWith('comic_skus?id=eq.')) return { data:[skuRow] };
      if (path.startsWith('comic_title_families?id=eq.')) return { data:[familyRow] };
      if (path.startsWith('foc_cycles?id=eq.')) return { data:[cycleRow] };
      return { data:[] };
    },
    ...overrides,
  });
}

{
  // A real, customer-enabled sku renders full content: name, price,
  // canonical link, and Product-typed JSON-LD -- everything a crawler or a
  // link-preview scraper needs from the initial HTTP response alone, with
  // no client-side redirect standing in the way.
  const deps = catalogDeps();
  const res = await handleFocRequest(mockGetRequest(), {}, new URL(`https://x/preorder/${skuId}/test-comic-20-cover-b`), deps);
  assert.equal(res instanceof Response, true, 'a matched sku must render a real HTML Response, not a JSON error');
  const html = await res.text();
  assert.match(html, /Test Comic #20/, 'the page must actually name this comic, not a generic sitewide title');
  assert.match(html, /\$4\.99/, 'the page must show this sku\'s real price');
  assert.match(html, /"@type":"Product"/, 'must emit real Product JSON-LD, not just the static sitewide meta tags');
  assert.match(html, /rel="canonical" href="https:\/\/themanapocket\.com\/preorder\//, 'canonical must point at themanapocket.com, not the Worker\'s workers.dev subdomain');
  assert.match(html, /A really good comic\./, 'the page must show the sku\'s synopsis, not just name/price');
  assert.match(html, /id="mp-share-btn"/, 'missing the share button');
  assert.match(html, /navigator\.share/, 'the share button must use the real Web Share API, not just a static link');
  assert.match(html, /navigator\.clipboard/, 'must fall back to copying the link when navigator.share is unavailable');
  assert.doesNotMatch(html, /location\.replace/, 'a real visitor must land on real content, not be bounced away before reading it');
}

{
  // A stale/renamed-series slug must 301 to the canonical one, not 404 --
  // skuId is the real lookup key (same convention itemDetailSlug and
  // backlistBookSlug already use for /item/{id}/{slug} and /book/{id}/{slug}).
  // This also covers the old bare-id share links (?slug empty) that were
  // handed out before this fix shipped.
  const deps = catalogDeps();
  const res = await handleFocRequest(mockGetRequest(), {}, new URL(`https://x/preorder/${skuId}/old-wrong-slug`), deps);
  assert.equal(res.status, 301);
  assert.match(res.headers.get('location'), /\/preorder\/.*test-comic-20-cover-b$/);
}

{
  // A missing/disabled sku, or a dangling family/cycle reference, must 404
  // through the real page shell -- never crash or leak an empty page.
  const deps = seoDeps({ supabaseAdminFetch: async () => ({ data:[] }) });
  const res = await handleFocRequest(mockGetRequest(), {}, new URL(`https://x/preorder/${skuId}/anything`), deps);
  const html = await res.text();
  assert.equal(res.status, 404);
  assert.match(html, /not found/i);
}

{
  // /sitemap-preorders.xml must list every customer-visible cover's
  // canonical URL so Google can discover pages /preorders (a client-rendered
  // catalog, not a browsable index) never links to on its own.
  const rows = [{ id:'55555555-5555-4555-8555-555555555555', title:'fallback', variant_label:'Cover A', updated_at:'2026-09-19T00:00:00Z', family_id:'family-2' }];
  const families = [{ id:'family-2', series_name:'Findable Comic', issue_number:'1' }];
  const deps = seoDeps({
    supabaseAdminFetch: async (env, path) => {
      if (path.startsWith('comic_skus?store_id=')) return { data:rows };
      if (path.startsWith('comic_title_families?id=')) return { data:families };
      return { data:[] };
    },
  });
  const res = await handleFocRequest(mockGetRequest(), {}, new URL('https://x/sitemap-preorders.xml'), deps);
  const xml = await res.text();
  assert.match(xml, /<loc>https:\/\/themanapocket\.com\/preorder\/55555555-5555-4555-8555-555555555555\/findable-comic-1-cover-a<\/loc>/);
  assert.equal(res.headers.get('content-type'), 'application/xml;charset=UTF-8');
}

console.log('preorderDetailPage/sitemap contract checks passed');
