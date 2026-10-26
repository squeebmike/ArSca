import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sharedServiceForPath, sharedUsageStore, anthropicUsage } from '../scripts/shared-service-usage.mjs';
import { PLATFORM_STORE_ID, clearStoreFeatureCache } from '../scripts/store-features.mjs';

// Second-store pilot (2026-10-26): pilot stores may use the AI, CardSight,
// SoldComps and PSA lookups on The Mana Pocket's accounts, and every such
// call is logged so the store can see (and bill back) what they used.
// Nothing about The Mana Pocket's own calls changes, and none are logged.
const OTHER = '11111111-2222-4333-8444-555555555555';

for (const [path, service] of [
  ['/anthropic/messages', 'anthropic'], ['/identify/card', 'anthropic'], ['/cardsight/identify', 'cardsight'],
  ['/comps/sold', 'soldcomps'], ['/psa/cert/12345', 'psa'], ['/psa/pop/1', 'psa'],
  ['/pricing/pokemon/cards', null], ['/pos/sale', null], ['/card-lens/mobile/identify', null],
]) assert.equal(sharedServiceForPath(path), service, path);

const req = (path, headers = {}) => new Request('https://w.example' + path, { headers });
assert.equal(sharedUsageStore(req('/comps/sold', { 'X-Store-Id': OTHER }), new URL('https://w.example/comps/sold')), OTHER);
assert.equal(sharedUsageStore(req('/comps/sold'), new URL('https://w.example/comps/sold?store=' + OTHER)), OTHER);
assert.equal(sharedUsageStore(req('/comps/sold', { 'X-Store-Id': PLATFORM_STORE_ID }), new URL('https://w.example/comps/sold')), '', 'your store is never logged');
assert.equal(sharedUsageStore(req('/comps/sold', { 'X-Store-Id': OTHER }), new URL('https://w.example/comps/sold'), { OWNER_STORE_IDS: OTHER }), '', 'nor an owner store from the env');
assert.equal(sharedUsageStore(req('/comps/sold', { 'X-Store-Id': 'front' }), new URL('https://w.example/comps/sold')), '', 'not a store id');
assert.deepEqual(anthropicUsage({ model: 'claude-haiku-4-5-20251001', usage: { input_tokens: 1200, cache_read_input_tokens: 300, output_tokens: 250 } }), { model: 'claude-haiku-4-5-20251001', inputTokens: 1500, outputTokens: 250 });
assert.deepEqual(anthropicUsage(null), { model: '', inputTokens: 0, outputTokens: 0 });

// ── The Worker, end to end ──
const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
let logged = [], anthropicCalls = 0, logFails = false, rpc = null;
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const ok = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.includes('/auth/v1/user')) return ok({ id: 'user-1', email: 'owner@example.com' });
  if (url.includes('/rest/v1/store_members')) return ok([{ role: 'owner' }]);
  if (url.includes('/rest/v1/platform_admins')) return ok([{ user_id: 'user-1', role: 'super_admin' }]);
  if (url.includes('/rest/v1/rpc/shared_service_usage_summary')) { rpc = JSON.parse(init.body); return ok({ byService: [{ service: 'anthropic', calls: 2 }] }); }
  if (url.includes('/rest/v1/shared_service_usage')) { if (logFails) throw new Error('database down'); logged.push(JSON.parse(init.body)); return new Response(null, { status: 201 }); }
  if (url.includes('api.anthropic.com')) { anthropicCalls++; return ok({ model: 'claude-haiku-4-5-20251001', content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 900, output_tokens: 120 } }); }
  return ok([]);
};
const env = { SUPABASE_URL: 'https://database.example', SUPABASE_SERVICE_ROLE_KEY: 'test-only', ANTHROPIC_API_KEY: 'anthropic-secret', LBA_KV: { get: async () => null, put: async () => {}, delete: async () => {} } };
try {
  clearStoreFeatureCache();
  const { default: api } = await import('../cloudflare-worker-full.js');
  const call = async (path, store, init = {}) => {
    const waits = [];
    const res = await api.fetch(new Request('https://w.example' + path, { ...init, headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json', ...(store ? { 'X-Store-Id': store } : {}) } }), env, { waitUntil: p => waits.push(p), passThroughOnException() {} });
    await Promise.all(waits);
    return res;
  };
  const message = { method: 'POST', body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] }) };

  let res = await call('/anthropic/messages', OTHER, message);
  assert.equal(res.status, 200, 'the pilot store may use the AI');
  assert.equal((await res.json()).content[0].text, 'hi', 'and gets the answer untouched');
  assert.equal(logged.length, 1, 'one row per call');
  assert.deepEqual(logged[0], { store_id: OTHER, service: 'anthropic', route: '/anthropic/messages', model: 'claude-haiku-4-5-20251001', input_tokens: 900, output_tokens: 120, status: 200 });

  logged = [];
  res = await call('/anthropic/messages', PLATFORM_STORE_ID, message);
  assert.equal(res.status, 200);
  assert.equal(logged.length, 0, 'your own AI calls are never logged');

  logged = [];
  res = await call('/anthropic/messages', OTHER, { method: 'POST', body: JSON.stringify({ model: 'gpt-4', messages: [] }) });
  assert.equal(res.status, 400);
  assert.equal(logged.length, 0, 'a refused call costs nothing and is not logged');

  logFails = true; logged = [];
  res = await call('/anthropic/messages', OTHER, message);
  assert.equal(res.status, 200, 'a logging failure never breaks the call');
  logFails = false;

  res = await call('/admin/stores/' + OTHER + '/usage?days=30', '');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).usage.byService[0].calls, 2, 'the admin page reads the summary');
  assert.equal(rpc.p_store_id, OTHER);
  res = await call('/admin/stores/' + PLATFORM_STORE_ID + '/usage', '');
  assert.equal((await res.json()).platform, true, 'nothing to show for your own store');
} finally { globalThis.fetch = originalFetch; globalThis.caches = originalCaches; }

// ── Wiring ──
const worker = readFileSync(new URL('../cloudflare-worker-full.js', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase-migrations/2026-10-26-shared-service-usage.sql', import.meta.url), 'utf8');
assert.ok(worker.includes('trackSharedServiceUsage(env, ctx, request, response);'), 'every routed response passes the tracker');
assert.ok(admin.includes('<div id="shared-usage"></div>') && admin.includes('renderSharedUsage();'), 'the Features tab shows usage');
assert.match(migration, /create table if not exists public\.shared_service_usage/);
assert.match(migration, /revoke all on public\.shared_service_usage from public, anon, authenticated;/, 'only the Worker reads it');
console.log('second-store pilot: shared service usage checks passed');
