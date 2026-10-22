import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Store ask: see on the dashboard that eBay follows what it has -- the eBay
// tab's EBAY QUANTITY CHANGES lists every change made on eBay, when, and
// why (a sale or edit here, or the 6-hour check), including the ones eBay
// refused.
const ui = readFileSync(new URL('../scripts/dashboard-app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../cloudflare-worker-full.js', import.meta.url), 'utf8');
assert.match(html, /EBAY QUANTITY CHANGES <span[^>]*>— eBay follows what the dashboard has: every change made there, and why<\/span><\/div>\s*<div id="ebay-hub-qty-changes"/);
assert.ok(ui.includes('  loadEbayOrderHistory().catch(()=>{});\n  loadEbayQtyChanges().catch(()=>{});\n}'), 'loads with the eBay tab');

function grab(src, head) {
  const start = src.indexOf(head);
  assert.ok(start >= 0, head);
  const body = /\)\s*\{/.exec(src.slice(start));
  let depth = 0, i = start + body.index + body[0].length - 1;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(start, i + 1);
}
const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const render = new Function('escHtml', grab(ui, 'function ebayQtyChangesHtml(') + '; return ebayQtyChangesHtml;')(esc);
{
  const out = render([
    { at: '2026-10-22T09:00:00Z', name: 'Spotlight #1 Cover K -- Cover K', listingId: '257700000001', from: 3, to: 1, why: 'check' },
    { at: '2026-10-22T08:00:00Z', name: 'Booster Box', listingId: '1', to: 2, why: 'sale' },
    { at: '2026-10-22T07:00:00Z', name: 'Goblin Storm', listingId: '2', to: 0, ended: true, why: 'sale' },
    { at: '2026-10-22T06:00:00Z', name: '<Plush>', listingId: '3', to: 0, why: 'check', failed: true, error: 'Item not found' },
  ]);
  assert.match(out, /eBay 3 → <b>1<\/b> <span[^>]*>\(6-hour check\)<\/span>/);
  assert.match(out, /Booster Box -- eBay set to <b>2<\/b> <span[^>]*>\(sale or edit here\)/);
  assert.match(out, /Goblin Storm -- <span[^>]*>listing ended \(sold out\)<\/span>/);
  assert.match(out, /&lt;Plush&gt; -- <span style="color:var\(--red\)">couldn't change eBay to 0 -- change it on eBay \(Item not found\)<\/span>/, 'refusals shown, names escaped');
  assert.match(out, /href="https:\/\/www\.ebay\.com\/itm\/257700000001"/);
  assert.match(render([]), /No eBay quantity changes yet/);
}

// Failures are logged too, from both the sale path and the 6-hour check.
assert.ok(worker.includes("why: 'sale', ...(o.ok ? {} : { failed: true, error: String(o.error || '').slice(0, 200) })"));
assert.ok(worker.includes("...failed.map(f => ({ name: named(f), listingId: f.listingId, from: f.ebayQty, to: f.dashQty, why: 'check', failed: true,"));

// The route: store staff read their own store's log.
const { default: api } = await import('../cloudflare-worker-full.js');
const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
const ok = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (input) => {
  const url = String(input.url || input);
  if (url.includes('/auth/v1/user')) return ok({ id: 'u1', email: 'staff@example.com' });
  if (url.includes('store_members')) return ok([{ role: 'employee' }]);
  return ok([]);
};
try {
  const kv = new Map([['ebay-qty-fixes:store-1', JSON.stringify([{ at: 'x', name: 'Booster Box', to: 2, why: 'sale' }])]]);
  const env = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'k', LBA_KV: { get: async (k, t) => { const v = kv.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async () => {} } };
  const res = await api.fetch(new Request('https://api.example/ebay/qty-changes', { headers: { Authorization: 'Bearer t', 'X-Store-Id': 'store-1' } }), env, { waitUntil() {} });
  const d = await res.json();
  assert.equal(res.status, 200, JSON.stringify(d));
  assert.equal(d.changes[0].name, 'Booster Box');
  const anon = await api.fetch(new Request('https://api.example/ebay/qty-changes', { headers: { 'X-Store-Id': 'store-1' } }), env, { waitUntil() {} });
  assert.notEqual(anon.status, 200, 'needs a signed-in staff member');
} finally { globalThis.fetch = originalFetch; globalThis.caches = originalCaches; }
console.log('eBay quantity changes list checks passed');
