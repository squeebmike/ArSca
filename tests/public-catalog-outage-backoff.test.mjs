import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cachedPublicCatalog } from '../scripts/public-catalog-cache.mjs';

// Outage 2026-10-19/20: when the database slowed, every failed catalog load
// left nothing cached, so every page view started another full-catalog query
// (up to 5,500 an hour), which kept the database -- and the dashboard -- down.
const kv = () => { const mem = new Map(); return { mem, LBA_KV: { get: async k => mem.get(k) || null, put: async (k, v) => mem.set(k, JSON.parse(v)) } }; };

// One load at a time: simultaneous page views share it.
{
  const env = kv(); let loads = 0, release;
  const gate = new Promise(r => { release = r; });
  const load = async () => { loads++; await gate; return [{ id: 'a' }]; };
  const views = Array.from({ length: 20 }, () => cachedPublicCatalog(env, null, 'shared', load));
  release();
  const results = await Promise.all(views);
  assert.equal(loads, 1, '20 page views, one database query');
  assert.ok(results.every(r => r[0].id === 'a'));
}

// After a failure, no new queries for a minute -- page views fail fast instead.
{
  const env = kv(); let loads = 0;
  const failing = async () => { loads++; throw new Error('DB unavailable'); };
  await assert.rejects(cachedPublicCatalog(env, null, 'down', failing), /DB unavailable/);
  for (let i = 0; i < 50; i++) await assert.rejects(cachedPublicCatalog(env, null, 'down', failing), /retrying shortly/);
  assert.equal(loads, 1, 'a failed load is not retried on every page view');
  assert.ok(env.mem.get('public-catalog-failed:down'), 'other edge locations see the failure too');
  // Another worker instance (fresh memory) still backs off via KV.
  const mod = await import('../scripts/public-catalog-cache.mjs?second');
  await assert.rejects(mod.cachedPublicCatalog(env, null, 'down', failing), /retrying shortly/);
  assert.equal(loads, 1);
  // A minute later it tries again.
  env.mem.get('public-catalog-failed:down').at = Date.now() - 61000;
  const fresh = await import('../scripts/public-catalog-cache.mjs?third');
  assert.equal((await fresh.cachedPublicCatalog(env, null, 'down', async () => { loads++; return [{ id: 'back' }]; }))[0].id, 'back');
  assert.equal(loads, 2);
}

// While the database is down, the last good copy keeps the site up.
{
  const env = kv(); let loads = 0;
  await cachedPublicCatalog(env, null, 'stale', async () => [{ id: 'good' }]);
  env.mem.get('public-catalog:stale').at = Date.now() - 3600000; // an hour old
  const failing = async () => { loads++; throw new Error('DB unavailable'); };
  assert.equal((await cachedPublicCatalog(env, null, 'stale', failing))[0].id, 'good', 'old copy instead of an error');
  assert.equal((await cachedPublicCatalog(env, null, 'stale', failing))[0].id, 'good', 'and during the back-off');
  assert.equal(loads, 1);
  env.mem.get('public-catalog:stale').at = Date.now() - 25 * 3600000; // past a day: too old to show
  const later = await import('../scripts/public-catalog-cache.mjs?fourth');
  env.mem.delete('public-catalog-failed:stale');
  await assert.rejects(later.cachedPublicCatalog(env, null, 'stale', failing), /DB unavailable/);
}

// The good copy is kept a day, not 3 minutes, so it's there when needed.
{
  let ttl; const env = { LBA_KV: { get: async () => null, put: async (k, v, o) => { ttl = o.expirationTtl; } } };
  await cachedPublicCatalog(env, null, 'ttl', async () => []);
  assert.equal(ttl, 86400);
}

// The sitemap uses the shared cached catalog, not its own full query.
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const sitemap = worker.slice(worker.indexOf("url.pathname === '/sitemap-items.xml'"), worker.indexOf('// GET /sitemap-pages.xml'));
assert.match(sitemap, /await fetchAllListableStorefrontItemsCached\(env, ctx\)/);
assert.doesNotMatch(sitemap, /fetchAllListableStorefrontItems\(env\)/);
console.log('Public catalog outage back-off checks passed');
