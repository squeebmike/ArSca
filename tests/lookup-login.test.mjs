import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lookupNeedsLogin } from '../scripts/lookup-auth.mjs';
import { staffHeaders, withSupabase, answeringStaffLogin } from './helpers/signed-in-worker.mjs';

// Store, 2026-10-27: "lock down the price lookups". SportsCardsPro,
// PriceCharting search, SoldComps and comic variant lookups answered anyone on
// the internet, on The Mana Pocket's paid keys.
for (const [path, locked] of [
  ['/pricing/sportscardspro/products', true], ['/pricing/sportscardspro/image', true],
  ['/pricing/pricecharting/search', true], ['/pricing/pricecharting/product/1', true], ['/pricing/pricecharting/comics/by-upc', true],
  ['/pricing/tcg', true], ['/pricing/tcg/sku-price', true], ['/pricing/justtcg/search', true],
  ['/comps/sold', true], ['/psa/cert/123', true], ['/psa/pop/9', true], ['/comic/variants', true],
  ['/psa/cert/123/photo', false],                 // checked in its route: cached photos are free
  ['/pricing/pokemon/cards', false],              // PokemonPriceTracker checks its own login
  ['/pricing/tcgplayer/product/1', false],        // TCGplayer's free public prices, no key
  ['/public/storefront', false], ['/pricing/tcgplayer', false],
]) assert.equal(lookupNeedsLogin(path), locked, path);

// ── The Worker, end to end ──
const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
const upstream = [];
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
globalThis.fetch = answeringStaffLogin(async (input) => {
  const url = String(input?.url || input); upstream.push(url);
  return new Response(JSON.stringify({ status: 'success', products: [] }), { headers: { 'Content-Type': 'application/json' } });
});
const r2 = new Map([['psa-photos/111.jpg', 'cached-bytes']]);
const env = withSupabase({
  PRICECHARTING_TOKEN: 'pc-secret', SCP_ACCESS_TOKEN: 'scp-secret', PSA_TOKEN: 'psa-secret', SOLDCOMPS_API_KEY: 'sc-secret',
  LBA_KV: { get: async () => null, put: async () => {}, delete: async () => {} },
  MTG_CATALOG_R2: { get: async k => r2.has(k) ? { body: r2.get(k), httpMetadata: { contentType: 'image/jpeg' } } : null, head: async k => r2.has(k) ? {} : null, put: async (k, v) => { r2.set(k, v); } },
});
try {
  const { default: api } = await import('../cloudflare-worker-full.js');
  const call = (path, headers = {}) => api.fetch(new Request('https://w.example' + path, { headers }), env, { waitUntil() {}, passThroughOnException() {} });
  const paid = ['/pricing/sportscardspro/products?q=trout', '/pricing/pricecharting/search?q=charizard', '/comps/sold?q=charizard', '/psa/cert/123', '/comic/variants?series=x&issue=1'];

  for (const path of paid) {
    upstream.length = 0;
    const res = await call(path);
    assert.equal(res.status, 401, path + ': no login, refused');
    assert.ok(!upstream.some(u => /sportscardspro\.com|pricecharting\.com|psacard|soldcomps|comicvine/i.test(u)), path + ': and no paid call is made');
  }
  upstream.length = 0;
  let res = await call('/pricing/sportscardspro/products?q=trout', staffHeaders());
  assert.notEqual(res.status, 401, 'signed-in staff get through');
  assert.ok(upstream.some(u => u.includes('sportscardspro.com/api/products')), 'and the lookup runs');
  res = await call('/pricing/pricecharting/search?q=charizard', staffHeaders());
  assert.notEqual(res.status, 401);

  // PSA photos: cached ones still load as a plain <img>, new ones need a login.
  res = await call('/psa/cert/111/photo');
  assert.equal(res.status, 200, 'a cached photo shows without a login');
  assert.equal(await res.text(), 'cached-bytes');
  upstream.length = 0;
  res = await call('/psa/cert/222/photo');
  assert.equal(res.status, 401, 'an uncached photo (a PSA API call) needs a login');
  assert.ok(!upstream.some(u => u.includes('psacard')), 'and PSA is not called');
} finally { globalThis.fetch = originalFetch; globalThis.caches = originalCaches; }

// ── Callers sign in ──
const ui = fs.readFileSync(new URL('../scripts/dashboard-app.js', import.meta.url), 'utf8');
const scanner = fs.readFileSync(new URL('../sca.html', import.meta.url), 'utf8');
const plain = /(?<![A-Za-z_.])fetch\(\s*WORKER\s*\+\s*'\/(?:pricing\/sportscardspro\/|pricing\/pricecharting\/|pricing\/tcg\?|pricing\/justtcg\/|comic\/variants|psa\/cert\/|comps\/sold)/;
assert.doesNotMatch(ui, plain, 'the dashboard calls paid lookups through storeWorkerFetch');
assert.doesNotMatch(scanner, /(?<![A-Za-z_.])fetch\(\s*WORKER_URL\s*\+\s*'\/(?:comic\/variants|comps\/sold|psa\/cert\/|pricing\/)/, 'the scanner calls them through scannerWorkerFetch');
assert.match(scanner, /const res = await scannerWorkerFetch\(path, \{ cache:'no-store', signal:AbortSignal\.timeout\(7000\), \.\.\.options \}\);/, 'including scannerFetchJson');
const worker = fs.readFileSync(new URL('../cloudflare-worker-full.js', import.meta.url), 'utf8');
assert.ok(worker.indexOf('if (lookupNeedsLogin(url.pathname))') < worker.indexOf("if (url.pathname === '/pricing/sportscardspro/products')"), 'the check runs before the lookup routes');
console.log('price lookup login checks passed');
