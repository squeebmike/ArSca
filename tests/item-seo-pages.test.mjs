import assert from 'node:assert/strict';
import fs from 'node:fs';

// wrangler.deploy.jsonc route-binding contract, same class of bug as the
// /preorder* fix documented in wrangler-preorder-route.test.mjs -- a page
// this Worker renders is invisible on themanapocket.com without its own
// exact-match/prefix route here, however correct the handler itself is.
const config = JSON.parse(
  fs.readFileSync('wrangler.deploy.jsonc', 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
);
for (const pattern of ['themanapocket.com/category*', 'themanapocket.com/faq', 'themanapocket.com/news', 'themanapocket.com/sitemap-pages.xml']) {
  const route = config.routes.find(r => r.pattern === pattern);
  assert.ok(route, `wrangler.deploy.jsonc must bind ${pattern}, or it 404s on the real domain even though the Worker handles it`);
  assert.equal(route.zone_name, 'themanapocket.com');
}
console.log('New route bindings present in wrangler.deploy.jsonc');

// ─── Functional: exercise the real Worker, database + edge cache mocked ────
const STORE_ID = '0f9dd4bc-42a7-487e-a972-2905d24513e9';
function row(id, data, overrides = {}) {
  return { id, data, status: 'in_stock', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-09-20T00:00:00Z', ...overrides };
}
const rows = [
  row('item-a', { name: 'Amazing Spider-Man #1', category: 'Comics', set: 'Marvel', year: '2022', condition: 'Near Mint', priceOverride: 25, quantity: 3, onlineListed: true, image: 'https://img.example/a.jpg' }),
  row('item-b-sold', { name: 'Dougvana Print', category: 'Collectibles', priceOverride: 50, quantity: 0, showSoldOut: true, onlineListed: true }),
  row('item-c-gone', { name: 'Gone Item', category: 'Comics', priceOverride: 12, quantity: 0, onlineListed: true }), // not showSoldOut -- must 404, not list
  row('item-d', { name: 'Batman #1', category: 'Comics', priceOverride: 10, quantity: 2, onlineListed: true }),
  row('item-e', { name: 'Charizard VMAX', category: 'Pokemon', priceOverride: 99, quantity: 1, onlineListed: true }),
  row('item-f-reviewed', { name: 'Reviewed Comic', category: 'Comics', priceOverride: 5, quantity: 1, onlineListed: true, reviews: [{ author: 'Alex', rating: 5, text: 'Great condition, fast shipping!', date: '2026-08-01' }] }),
];

const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
globalThis.fetch = async (input) => {
  const url = String(input);
  const idMatch = url.match(/[?&]id=eq\.([^&]+)/);
  if (idMatch) {
    const id = decodeURIComponent(idMatch[1]);
    return new Response(JSON.stringify(rows.filter(r => r.id === id)), { headers: { 'Content-Type': 'application/json' } });
  }
  const offsetMatch = url.match(/[?&]offset=(\d+)/);
  const offset = offsetMatch ? Number(offsetMatch[1]) : 0;
  return new Response(JSON.stringify(offset === 0 ? rows : []), { headers: { 'Content-Type': 'application/json' } });
};
const env = { SUPABASE_URL: 'https://database.example', SUPABASE_SERVICE_ROLE_KEY: 'test-only' };
const edge = { waitUntil: () => {} };

try {
  const { default: api } = await import('../cloudflare-worker-full.js');
  const get = (path) => api.fetch(new Request('https://themanapocket.com' + path), env, edge);
  const jsonLdBlocks = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));

  // Available item: real page, breadcrumb + product schema, Twitter Card,
  // og:type=product, related items, no fabricated review data.
  {
    const res = await get('/item/item-a/amazing-spider-man-1');
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
    assert.match(html, /<meta property="og:type" content="product">/);
    const blocks = jsonLdBlocks(html);
    const product = blocks.find(b => b['@type'] === 'Product');
    const breadcrumb = blocks.find(b => b['@type'] === 'BreadcrumbList');
    assert.ok(product, 'item page must emit Product JSON-LD');
    assert.equal(product.offers.availability, 'https://schema.org/InStock');
    assert.equal('aggregateRating' in product, false, 'no reviews exist for this item -- must not fabricate a rating');
    assert.ok(breadcrumb, 'item page must emit BreadcrumbList JSON-LD');
    assert.equal(breadcrumb.itemListElement.length, 3);
    assert.equal(breadcrumb.itemListElement[1].name, 'Comics');
    assert.equal(breadcrumb.itemListElement[1].item, 'https://themanapocket.com/category/comics');
    assert.match(html, /Batman #1/, 'same-category item must appear in the related-items module');
    assert.match(html, /\/item\/item-d\//, 'related item must link to a real /item/{id} page');
    assert.doesNotMatch(html, /Reviews<\/h2>/, 'no Reviews section without real review data');
  }

  // Sold-but-listable item: must NOT 404 (this was the live bug -- a
  // showSoldOut card in the shop grid 404'd when clicked), must show
  // OutOfStock + a Sold badge, and still offer related items.
  {
    const res = await get('/item/item-b-sold/dougvana-print');
    assert.equal(res.status, 200, 'a showSoldOut item must render a real page, not 404, matching the shop grid which already lists it');
    const html = await res.text();
    assert.match(html, />Sold</);
    const product = jsonLdBlocks(html).find(b => b['@type'] === 'Product');
    assert.equal(product.offers.availability, 'https://schema.org/OutOfStock');
  }

  // Truly unavailable, non-showSoldOut item: still a real, honest 404 --
  // it never appears in the shop grid either, so nothing links to it.
  {
    const res = await get('/item/item-c-gone/gone-item');
    assert.equal(res.status, 404);
    const html = await res.text();
    assert.match(html, /<meta name="robots" content="noindex,follow">/);
  }

  // Reviews: real infrastructure, dormant unless real data exists -- this
  // fixture is the one case where it does, and only here must it render.
  {
    const res = await get('/item/item-f-reviewed/reviewed-comic');
    const html = await res.text();
    const product = jsonLdBlocks(html).find(b => b['@type'] === 'Product');
    assert.ok(product.aggregateRating, 'a real saved review must produce AggregateRating schema');
    assert.equal(product.aggregateRating.reviewCount, 1);
    assert.equal(product.review[0].reviewBody, 'Great condition, fast shipping!');
    assert.match(html, /Reviews<\/h2>/);
    assert.match(html, /Great condition, fast shipping!/, 'the visible page must show the same review the schema claims -- never schema without matching visible content');
  }

  // Category landing pages: real written copy + a live grid of only the
  // listable items in that category.
  {
    const res = await get('/category/comics');
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Amazing Spider-Man #1/);
    assert.match(html, /Batman #1/);
    assert.doesNotMatch(html, /Charizard VMAX/, 'a Pokemon item must not appear on the Comics category page');
    const collection = jsonLdBlocks(html).find(b => b['@type'] === 'CollectionPage');
    assert.ok(collection);
  }
  {
    const res = await get('/category/not-a-real-category');
    assert.equal(res.status, 404);
  }
  {
    const res = await get('/category');
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Comics/);
    assert.match(html, /Pokémon/);
  }

  // FAQ: real FAQPage schema, matching the visible Q&A list exactly.
  {
    const res = await get('/faq');
    assert.equal(res.status, 200);
    const html = await res.text();
    const faq = jsonLdBlocks(html).find(b => b['@type'] === 'FAQPage');
    assert.ok(faq);
    assert.ok(faq.mainEntity.length >= 5, 'FAQ page must have real, substantive content');
    for (const entry of faq.mainEntity) assert.match(html, new RegExp(entry.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  // News: real, dated, hand-maintained entries.
  {
    const res = await get('/news');
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /2026-09-24/);
  }

  // Sitemaps: item sitemap must include the sold-but-listable item (it has
  // a real page now) and exclude the truly-gone item; pages sitemap must
  // list the new static pages.
  {
    const res = await get('/sitemap-items.xml');
    const xml = await res.text();
    assert.match(xml, /item-a/);
    assert.match(xml, /item-b-sold/, 'a showSoldOut item now has a real page and belongs in the sitemap');
    assert.doesNotMatch(xml, /item-c-gone/, 'a truly unavailable item has no page and must not be in the sitemap');
  }
  {
    const res = await get('/sitemap-pages.xml');
    const xml = await res.text();
    assert.match(xml, /\/faq/);
    assert.match(xml, /\/news/);
    assert.match(xml, /\/category\/comics/);
  }

  console.log('Item SEO pages: breadcrumbs, Twitter Cards, sold-item handling, related items, reviews, category pages, FAQ, news, and sitemap checks passed');
} finally {
  globalThis.fetch = originalFetch;
  globalThis.caches = originalCaches;
}
