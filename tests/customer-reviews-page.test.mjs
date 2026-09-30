import assert from 'node:assert/strict';
import fs from 'node:fs';

// Reviews are saved on the item a customer bought, and a sold item's own
// /item page 404s -- so approved reviews need a store-wide /reviews page,
// bound on the real domain, or they are never shown anywhere.
const config = JSON.parse(
  fs.readFileSync('wrangler.deploy.jsonc', 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
);
const route = config.routes.find(r => r.pattern === 'www.themanapocket.com/reviews');
assert.ok(route, 'wrangler.deploy.jsonc must bind www.themanapocket.com/reviews');
assert.equal(route.zone_name, 'themanapocket.com');

const STORE_ID = '0f9dd4bc-42a7-487e-a972-2905d24513e9';
let rows = [];
const requested = [];
const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
globalThis.fetch = async (input) => {
  const url = String(input);
  requested.push(url);
  if (url.includes('inventory_items')) return new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json' } });
  return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
};
const env = { SUPABASE_URL: 'https://database.example', SUPABASE_SERVICE_ROLE_KEY: 'test-only' };
const edge = { waitUntil: () => {} };

try {
  const { default: api } = await import('../cloudflare-worker-full.js');
  const get = () => api.fetch(new Request('https://www.themanapocket.com/reviews'), env, edge);

  // Empty: renders, says so, and is kept out of Google.
  {
    const res = await get();
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /No reviews yet/);
    assert.match(html, /<meta name="robots" content="noindex,follow">/);
    const read = requested.find(u => u.includes('inventory_items'));
    assert.ok(read.includes(`store_id=eq.${STORE_ID}`), 'must read only The Mana Pocket store');
    assert.ok(read.includes('data->reviews=not.is.null'), 'must read only items that have reviews');
  }

  // Only approved, not-hidden reviews appear -- including on a sold item.
  rows = [
    { id: 'item-sold', data: { name: 'Amazing Spider-Man #300', status: 'sold', reviews: [
      { orderId: 'o1', itemId: 'item-sold', author: 'Alex', rating: 5, text: 'Packed <b>perfectly</b>', date: '2026-09-20', approved: true },
      { orderId: 'o2', itemId: 'item-sold', author: 'Spammer', rating: 1, text: 'NOT APPROVED TEXT', date: '2026-09-21', approved: false },
    ] } },
    { id: 'item-2', data: { name: 'Charizard', reviews: [
      { orderId: 'o3', itemId: 'item-2', author: 'Sam', rating: 4, text: 'Fast pickup', date: '2026-09-25', approved: true },
      { orderId: 'o4', itemId: 'item-2', author: 'Hidden', rating: 2, text: 'HIDDEN TEXT', date: '2026-09-26', approved: false, hidden: true },
    ] } },
  ];
  {
    const html = await (await get()).text();
    assert.match(html, /Packed &lt;b&gt;perfectly&lt;\/b&gt;/, 'review text must be escaped');
    assert.match(html, /Fast pickup/);
    assert.match(html, /bought Amazing Spider-Man #300/);
    assert.doesNotMatch(html, /NOT APPROVED TEXT/);
    assert.doesNotMatch(html, /HIDDEN TEXT/);
    assert.match(html, /4\.5 out of 5 from 2 verified buyers/);
    assert.ok(html.indexOf('Fast pickup') < html.indexOf('Packed'), 'newest review first');
    assert.doesNotMatch(html, /noindex/, 'a page with real reviews may be indexed');
    assert.doesNotMatch(html, /AggregateRating/, 'no self-serving star markup on the store reviews page');
  }
} finally {
  globalThis.fetch = originalFetch;
  globalThis.caches = originalCaches;
}
console.log('Store /reviews page shows only approved reviews');

// Dashboard moderation panel: wired into Settings, never deletes, and only
// writes when the row hasn't changed since it was read.
const dash = fs.readFileSync('dashboard.html', 'utf8');
assert.match(dash, /ensureThisDevicePanel\(backoffice\);\s*ensureCustomerReviewsPanel\(backoffice\);/);
const start = dash.indexOf('function ensureCustomerReviewsPanel(');
const end = dash.indexOf('function ensureBrandingPanel(');
const panel = dash.slice(start, end);
assert.ok(start > 0 && end > start);
assert.match(panel, /\.eq\('updated_at', row\.updated_at\)/, 'approval must not overwrite a newer edit');
assert.match(panel, /requireManager\(\)/, 'only managers and owners can approve');
assert.match(panel, /escHtml\(r\.text/, 'customer text must be escaped in the dashboard');
assert.doesNotMatch(panel, /\.delete\(/, 'moderation hides reviews, never deletes them');
assert.match(panel, /IntersectionObserver/, 'reviews load when the panel is seen, not at startup');
console.log('Dashboard review moderation panel checks passed');
