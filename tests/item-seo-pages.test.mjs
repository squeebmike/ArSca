import assert from 'node:assert/strict';
import fs from 'node:fs';
import './helpers/mock-body-html-rewriter.mjs';

// Recommendation quality uses saved facts, never inferred inventory edits.
{
  const source = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
  const body = source.slice(source.indexOf('function relatedStorefrontItems('), source.indexOf('function renderRelatedItemsHtml('));
  const recommend = new Function('isStorefrontItemAvailable', `${body}; return relatedStorefrontItems;`)(item => item.quantity > 0);
  const base = { categorySlug: 'collectibles', price: 20, image: 'https://img.example/photo.jpg', quantity: 1 };
  const current = { ...base, id: 'current', name: 'Sonic plush toy', productType: 'Plush' };
  const candidates = [
    { ...base, id: 'placeholder', name: 'Pocket Scout item' },
    { ...base, id: 'card', name: 'Football card', productType: 'Single' },
    { ...base, id: 'plush', name: 'Scorbunny plush toy', productType: 'Plush' },
    { ...base, id: 'sold', name: 'Sonic plush', quantity: 0 },
    { ...base, id: 'unpriced', name: 'Sonic plush', price: 0 },
    { ...base, id: 'wrong-category', name: 'Sonic plush', categorySlug: 'comics' },
    { ...base, id: 'supplier', name: 'Sonic plush', dropship: true },
    current,
  ];
  assert.deepEqual(recommend(current, candidates).map(item => item.id), ['plush', 'card']);
  assert.deepEqual(recommend(current, candidates, 1).map(item => item.id), ['plush']);
  assert.equal(candidates[0].name, 'Pocket Scout item', 'recommendations never mutate inventory');
  assert.deepEqual(recommend({ ...current, productType: 'Single' }, [
    { ...base, id: 'hat', name: 'Baseball hat', productType: 'Single' },
    { ...base, id: 'toy', name: 'Scorbunny plush toy' },
  ]).map(item => item.id), ['toy', 'hat'], 'generic Single labels must not outweigh matching product names');
}

// wrangler.deploy.jsonc route-binding contract, same class of bug as the
// /preorder* fix documented in wrangler-preorder-route.test.mjs -- a page
// this Worker renders is invisible on themanapocket.com without its own
// exact-match/prefix route here, however correct the handler itself is.
const config = JSON.parse(
  fs.readFileSync('wrangler.deploy.jsonc', 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
);
for (const pattern of ['www.themanapocket.com/category*', 'www.themanapocket.com/faq', 'www.themanapocket.com/news', 'www.themanapocket.com/sitemap-pages.xml']) {
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
  row('not-received', {name:'Unreceived presale',category:'Comics',source:'foc_presale',quantity:10,priceOverride:6,onlineListed:true}),
  row('item-a', { name: 'Amazing Spider-Man #1', category: 'Comics', set: 'Marvel', year: '2022', condition: 'Near Mint', priceOverride: 25, quantity: 3, onlineListed: true, image: 'https://img.example/a.jpg' }),
  row('item-b-sold', { name: 'Dougvana Print', category: 'Collectibles', priceOverride: 50, quantity: 0, showSoldOut: true, onlineListed: true }),
  row('item-c-gone', { name: 'Gone Item', category: 'Comics', priceOverride: 12, quantity: 0, onlineListed: true }), // not showSoldOut -- must 404, not list
  row('item-d', { name: 'Batman #1', category: 'Comics', priceOverride: 10, quantity: 2, onlineListed: true }),
  row('item-e', { name: 'Charizard VMAX', category: 'Pokemon', priceOverride: 99, quantity: 1, onlineListed: true }),
  row('item-f-reviewed', { name: 'Reviewed Comic', category: 'Comics', priceOverride: 5, quantity: 1, onlineListed: true, reviews: [{ author: 'Alex', rating: 5, text: 'Great condition, fast shipping!', date: '2026-08-01', approved: true }, { author: 'Spammer', rating: 5, text: 'Not yet approved by staff', date: '2026-08-02', approved: false }] }),
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
  const get = (path) => api.fetch(new Request('https://www.themanapocket.com' + path), env, edge);
  assert.equal((await get('/item/not-received/unreceived-presale')).status,404,'mislabelled eBay placeholders are not received storefront stock');
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
    assert.equal(product.offers.itemCondition, 'https://schema.org/UsedCondition');
    assert.ok(product.additionalProperty.some(p=>p.name==='Condition'&&p.value==='Near Mint'));
    assert.match(html, /<h2>Item details<\/h2>/);
    assert.equal('aggregateRating' in product, false, 'no reviews exist for this item -- must not fabricate a rating');
    assert.ok(breadcrumb, 'item page must emit BreadcrumbList JSON-LD');
    assert.equal(breadcrumb.itemListElement.length, 3);
    assert.equal(breadcrumb.itemListElement[1].name, 'Comics');
    assert.equal(breadcrumb.itemListElement[1].item, 'https://www.themanapocket.com/category/comics');
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
    assert.equal(product.aggregateRating.reviewCount, 1, 'an unapproved review must not count toward the public rating');
    assert.equal(product.review[0].reviewBody, 'Great condition, fast shipping!');
    assert.match(html, /Reviews<\/h2>/);
    assert.match(html, /Great condition, fast shipping!/, 'the visible page must show the same review the schema claims -- never schema without matching visible content');
    assert.doesNotMatch(html, /Not yet approved by staff/, 'an unapproved review must never be publicly visible');
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
    assert.ok(xml.includes('<loc>https://www.themanapocket.com/preorders/catalog</loc>'), 'the crawlable preorder directory has its own sitemap entry');
    assert.match(xml, /\/news/);
    assert.match(xml, /\/category\/comics/);
  }

  {
    const healthyFetch=globalThis.fetch;let recommendationAborted=false,finishRecommendations;
    globalThis.fetch=async(input,options={})=>{
      if(String(input).includes('inventory_items?')&&!/[?&]id=eq\./.test(String(input)))return new Promise((resolve,reject)=>{finishRecommendations=()=>resolve(new Response('[]',{headers:{'Content-Type':'application/json'}}));options.signal.addEventListener('abort',()=>{recommendationAborted=true;reject(Error('aborted'));});});
      return healthyFetch(input,options);
    };
    const response=await get('/item/item-a/amazing-spider-man-1');
    assert.equal(response.status,200,'slow recommendations cannot fail the actual product');
    assert.ok((await response.text()).includes('Amazing Spider-Man #1'));
    assert.equal(recommendationAborted,false,'reference deadline leaves the bounded shared cache fill alive');finishRecommendations();
    globalThis.fetch=healthyFetch;
  }

  {
    globalThis.fetch=async()=>new Response('Database unavailable',{status:503});
    const productOutage=await get('/item/item-a/amazing-spider-man-1');
    assert.equal(productOutage.status,503,'database failure must not claim the product is missing');
    assert.equal(productOutage.headers.get('Cache-Control'),'no-store');
    assert.equal(productOutage.headers.get('Retry-After'),'60');
    assert.ok((await productOutage.text()).includes('canonical\" href=\"https://www.themanapocket.com/item/item-a/amazing-spider-man-1'));
    globalThis.fetch=async()=>{throw Error('Network timeout');};
    assert.equal((await get('/item/item-a/amazing-spider-man-1')).status,503,'network failures also remain temporary');
    globalThis.fetch=async()=>new Response('Database unavailable',{status:503});
    const response=await get('/category/comics');
    assert.equal(response.status,503,'an upstream outage is not an empty category');
    assert.equal(response.headers.get('Cache-Control'),'no-store');
    assert.doesNotMatch(await response.text(),/Nothing in stock/);
  }
  console.log('Item SEO pages: breadcrumbs, Twitter Cards, sold-item handling, related items, reviews, category pages, FAQ, news, and sitemap checks passed');
} finally {
  globalThis.fetch = originalFetch;
  globalThis.caches = originalCaches;
}
