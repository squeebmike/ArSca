import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KEY_PROVIDERS, cleanApiKey, lastFour, sealApiKey, openApiKey, storeApiKeys, clearStoreKeyCache, envWithStoreKeys } from '../scripts/store-api-keys.mjs';
import { PLATFORM_STORE_ID, clearStoreFeatureCache } from '../scripts/store-features.mjs';

// Second-store pilot (2026-10-26): "I'd also want them to be able to plug in
// their own API keys in the dashboard so they can use their own credits."
const OTHER = '11111111-2222-4333-8444-555555555555';
const env0 = { SUPABASE_SERVICE_ROLE_KEY: 'test-only' };

// ── Helpers ──
assert.equal(cleanApiKey('  abcd1234efgh  '), 'abcd1234efgh');
assert.equal(cleanApiKey(''), '', 'blank = remove');
assert.equal(cleanApiKey('short'), null);
assert.equal(cleanApiKey('has a space in it'), null);
assert.equal(lastFour('abcd1234efgh'), 'efgh');
{
  const sealed = await sealApiKey(env0, 'their-ppt-key-123', OTHER, 'pokemonprice');
  assert.ok(sealed.startsWith('v1:') && !sealed.includes('their-ppt-key-123'), 'stored encrypted');
  assert.equal(await openApiKey(env0, sealed, OTHER, 'pokemonprice'), 'their-ppt-key-123');
  assert.equal(await openApiKey(env0, sealed, PLATFORM_STORE_ID, 'pokemonprice'), '', 'bound to its store');
  assert.equal(await openApiKey(env0, sealed, OTHER, 'justtcg'), '', 'and to its provider');
  assert.equal(await openApiKey({ SUPABASE_SERVICE_ROLE_KEY: 'other' }, sealed, OTHER, 'pokemonprice'), '', 'useless without the Worker secret');
  clearStoreKeyCache();
  assert.deepEqual(await storeApiKeys(env0, OTHER, async () => [{ provider: 'pokemonprice', ciphertext: sealed }, { provider: 'bogus', ciphertext: sealed }]), { pokemonprice: 'their-ppt-key-123' });
  clearStoreKeyCache();
  assert.deepEqual(await storeApiKeys(env0, OTHER, async () => { throw new Error('down'); }), {}, 'a failed read = no keys, never yours');
  clearStoreKeyCache();
}
{
  const kv = {};
  const e = envWithStoreKeys({ LBA_KV: kv, POKEMONPRICE_API_KEY: 'yours', POKEMON_PRICE_TRACKER_API_KEY: 'yours', PRICECHARTING_TOKEN: 'yours', PRICECHARTING_API_KEY: 'yours', JUSTTCG_API_KEY: 'yours', OTHER_THING: 1 }, OTHER, { pokemonprice: 'theirs' });
  assert.equal(e.POKEMONPRICE_API_KEY, 'theirs'); assert.equal(e.POKEMON_PRICE_TRACKER_API_KEY, 'theirs');
  assert.equal(e.PRICECHARTING_TOKEN, '', 'no key of theirs = blank, not yours'); assert.equal(e.PRICECHARTING_API_KEY, ''); assert.equal(e.JUSTTCG_API_KEY, '');
  assert.equal(e.LBA_KV, kv, 'bindings kept'); assert.equal(e.OTHER_THING, 1); assert.equal(e.STORE_KEYS_OWNER, OTHER);
  assert.deepEqual(Object.keys(KEY_PROVIDERS), ['pokemonprice', 'pricecharting', 'justtcg']);
}

// ── The Worker, end to end ──
const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
const upstream = [], dbWrites = [], kvPuts = [];
let savedRows = [];
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const ok = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  if (url.includes('/auth/v1/user')) return ok({ id: 'user-1' });
  if (url.includes('/rest/v1/store_members')) return ok([{ role: 'owner' }]);
  if (url.includes('/rest/v1/store_features')) return ok([]);
  if (url.includes('/rest/v1/store_api_keys')) {
    if (init.method === 'POST' || init.method === 'DELETE') { dbWrites.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null }); return new Response(null, { status: 201 }); }
    return ok(url.includes('select=provider,last4') ? savedRows.map(r => ({ provider: r.provider, last4: r.last4, updated_at: 'x' })) : savedRows.map(r => ({ provider: r.provider, ciphertext: r.ciphertext })));
  }
  if (url.includes('pokemonpricetracker.com')) {
    upstream.push(init.headers?.Authorization || init.headers?.authorization || '');
    if (String(init.headers?.Authorization || '').includes('broke')) return ok({ error: 'Daily quota exhausted' }, 403, { 'X-RateLimit-Daily-Remaining': '0' });
    return ok({ data: [{ tcgPlayerId: '1', name: 'Pikachu', prices: { market: 1 } }] }, 200, { 'X-API-Calls-Consumed': '1' });
  }
  return ok([]);
};
const env = {
  SUPABASE_URL: 'https://database.example', SUPABASE_SERVICE_ROLE_KEY: 'test-only', POKEMONPRICE_API_KEY: 'mana-pocket-key',
  BYPASS_STORE_IDS: OTHER + ',' + PLATFORM_STORE_ID, // skip the subscription gate; it isn't what's tested here
  LBA_KV: { get: async () => null, put: async (k) => { kvPuts.push(k); }, delete: async () => {} },
};
try {
  const { default: api } = await import('../cloudflare-worker-full.js');
  const call = (path, store, init = {}) => api.fetch(new Request('https://w.example' + path, { ...init, headers: { Authorization: 'Bearer t', ...(store ? { 'X-Store-Id': store } : {}), ...(init.headers || {}) } }), env, { waitUntil() {}, passThroughOnException() {} });
  clearStoreFeatureCache(); clearStoreKeyCache();

  // No key yet: nothing reaches PPT, and the store is told what to do.
  let res = await call('/pricing/pokemon/cards?tcgPlayerId=1&fresh=true', OTHER);
  assert.equal(res.status, 501);
  assert.match((await res.json()).error, /Add your PokemonPriceTracker API key in Settings/);
  assert.equal(upstream.length, 0, 'your key is never used for them');

  // Save a key: stored encrypted, only the last 4 come back.
  res = await call('/store/api-keys', OTHER, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'pokemonprice', key: 'their-ppt-key-9876' }) });
  assert.equal(res.status, 200);
  const write = dbWrites.find(w => w.method === 'POST');
  assert.ok(write && !JSON.stringify(write.body).includes('their-ppt-key-9876'), 'the key is not stored in plain text');
  assert.equal(write.body.last4, '9876');
  savedRows = [{ provider: 'pokemonprice', ciphertext: write.body.ciphertext, last4: '9876' }];
  const listed = await res.json();
  assert.ok(!JSON.stringify(listed).includes('their-ppt-key'), 'never sent back');

  // Their lookups use their key.
  clearStoreKeyCache();
  res = await call('/pricing/pokemon/cards?tcgPlayerId=1&fresh=true', OTHER);
  assert.equal(res.status, 200);
  assert.equal(upstream.at(-1), 'Bearer their-ppt-key-9876');

  // Yours use yours, untouched.
  res = await call('/pricing/pokemon/cards?tcgPlayerId=1&fresh=true', PLATFORM_STORE_ID);
  assert.equal(upstream.at(-1), 'Bearer mana-pocket-key');
  res = await call('/store/api-keys', PLATFORM_STORE_ID);
  assert.equal((await res.json()).builtIn, true, 'your store shows built-in keys');
  res = await call('/store/api-keys', PLATFORM_STORE_ID, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'pokemonprice', key: 'something-long' }) });
  assert.equal(res.status, 400, 'and cannot be given a store key');

  // Their key running out pauses only their key.
  const sealedBroke = await sealApiKey(env, 'broke-key-0000', OTHER, 'pokemonprice');
  savedRows = [{ provider: 'pokemonprice', ciphertext: sealedBroke, last4: '0000' }];
  clearStoreKeyCache(); kvPuts.length = 0;
  res = await call('/pricing/pokemon/cards?tcgPlayerId=2&fresh=true', OTHER);
  assert.ok(kvPuts.includes('ppt_daily_quota_exhausted_until_v3:' + OTHER), 'paused under their store');
  assert.ok(!kvPuts.includes('ppt_daily_quota_exhausted_until_v3'), 'your pause flag untouched');

  // Remove.
  res = await call('/store/api-keys', OTHER, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'pokemonprice', key: '' }) });
  assert.ok(dbWrites.some(w => w.method === 'DELETE'), 'blank key removes it');
} finally { globalThis.fetch = originalFetch; globalThis.caches = originalCaches; }

// ── Wiring ──
const worker = readFileSync(new URL('../cloudflare-worker-full.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../scripts/dashboard-app.js', import.meta.url), 'utf8');
const deploy = readFileSync(new URL('../.github/workflows/deploy-worker.yml', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase-migrations/2026-10-26-store-api-keys.sql', import.meta.url), 'utf8');
assert.ok(worker.indexOf('env = await pricingEnvForStore(env, keyStore.trim());') < worker.indexOf("if(url.pathname.startsWith('/reference-collector/'))"), 'keys swapped before any route');
assert.ok(worker.includes("if (!storeId || isPlatformStore(storeId, env)) return env;"), 'your store keeps env as is');
assert.match(migration, /-- grants: service_role only store_api_keys/);
assert.ok(deploy.includes('scripts/store-api-keys.mjs'));
assert.ok(ui.includes("storeWorkerFetch('/store/api-keys'") && ui.includes("if(data.builtIn) { panel.style.display = 'none'; return; }"), 'Settings panel, hidden for built-in keys');
console.log('second-store pilot: per-store API key checks passed');
