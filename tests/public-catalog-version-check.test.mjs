import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cachedPublicCatalog } from '../scripts/public-catalog-cache.mjs';

// Egress over the Free Plan limit (2026-10-27): crawlers on the checklist and
// card pages reloaded the whole ~6 MB catalog every 5 minutes, ~288 times a
// day, though stock rarely changed. A cheap fingerprint now decides.
const kv = () => { const mem = new Map(); return { mem, LBA_KV: { get: async k => mem.has(k) ? JSON.parse(mem.get(k)) : null, put: async (k, v) => mem.set(k, v) } }; };
const opts = (version) => ({ freshMs: 300000, maxAgeMs: 900000, version });
const age = (env, key, ms) => { const s = JSON.parse(env.mem.get('public-catalog:' + key)); s.at = Date.now() - ms; env.mem.set('public-catalog:' + key, JSON.stringify(s)); };

{
  const env = kv(); let loads = 0, checks = 0, fp = '2031:2026-10-27T01:00:00Z';
  const load = async () => { loads++; return [{ id: 'item-' + loads }]; };
  const version = async () => { checks++; return fp; };

  assert.equal((await cachedPublicCatalog(env, null, 'shop', load, opts(version)))[0].id, 'item-1', 'first view loads');
  assert.equal(JSON.parse(env.mem.get('public-catalog:shop')).version, fp, 'the snapshot keeps its fingerprint');

  // Fresh: no check, no load.
  checks = 0;
  await cachedPublicCatalog(env, null, 'shop', load, opts(version));
  assert.equal(checks, 0); assert.equal(loads, 1);

  // Past 5 minutes, nothing changed: one tiny check, no reload, and it counts as fresh again.
  age(env, 'shop', 400000);
  assert.equal((await cachedPublicCatalog(env, null, 'shop', load, opts(version)))[0].id, 'item-1');
  assert.equal(loads, 1, 'unchanged inventory is not reloaded');
  assert.equal(checks, 1);
  checks = 0;
  await cachedPublicCatalog(env, null, 'shop', load, opts(version));
  assert.equal(checks, 0, 'and is fresh again for the next 5 minutes');
  assert.ok(env.mem.get('public-catalog:shop').length > 0, 'the big snapshot is not rewritten');

  // A day of crawling with no stock changes: 288 checks, still one load.
  for (let i = 0; i < 288; i++) {
    const c = JSON.parse(env.mem.get('public-catalog-checked:shop')); c.at = Date.now() - 400000;
    env.mem.set('public-catalog-checked:shop', JSON.stringify(c));
    age(env, 'shop', 400000);
    await cachedPublicCatalog(env, null, 'shop', load, opts(version));
  }
  assert.equal(loads, 1, '288 checks, one catalog load');

  // Something changed: it reloads.
  fp = '2031:2026-10-27T02:00:00Z';
  const c = JSON.parse(env.mem.get('public-catalog-checked:shop')); c.at = Date.now() - 400000;
  env.mem.set('public-catalog-checked:shop', JSON.stringify(c));
  age(env, 'shop', 1000000); // past maxAge, so this view waits for the new copy
  assert.equal((await cachedPublicCatalog(env, null, 'shop', load, opts(version)))[0].id, 'item-2', 'a change reloads');
  assert.equal(JSON.parse(env.mem.get('public-catalog:shop')).version, fp);
}

// A failing check never blocks the page: it falls back to a normal reload.
{
  const env = kv(); let loads = 0, failCheck = false;
  const load = async () => { loads++; return [{ id: 'x' + loads }]; };
  const version = async () => { if (failCheck) throw new Error('db down'); return 'v1'; };
  await cachedPublicCatalog(env, null, 'f', load, opts(version));
  failCheck = true;
  age(env, 'f', 1000000);
  assert.equal((await cachedPublicCatalog(env, null, 'f', load, opts(version)))[0].id, 'x2');
  assert.equal(loads, 2);
}

// Without a fingerprint, behaviour is exactly as before.
{
  const env = kv(); let loads = 0;
  const load = async () => { loads++; return [{ id: 'p' }]; };
  await cachedPublicCatalog(env, null, 'plain', load, { freshMs: 300000, maxAgeMs: 900000 });
  age(env, 'plain', 1000000);
  await cachedPublicCatalog(env, null, 'plain', load, { freshMs: 300000, maxAgeMs: 900000 });
  assert.equal(loads, 2);
  assert.equal(JSON.parse(env.mem.get('public-catalog:plain')).version, undefined);
}

// Wiring: your storefront catalog uses the count + newest updated_at.
const worker = fs.readFileSync(new URL('../cloudflare-worker-full.js', import.meta.url), 'utf8');
assert.ok(worker.includes("version:()=>storefrontInventoryVersion(env)"), 'the storefront catalog passes its fingerprint');
assert.match(worker, /storefront_inventory\?store_id=eq\.\$\{encodeURIComponent\(ITEM_DETAIL_STORE_ID\)\}&select=updated_at&order=updated_at\.desc&limit=1/);
console.log('public catalog version check passed');
