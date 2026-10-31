import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyStandardWebhook, handleWhatnotWebhook, handleWhatnotStatus, whatnotStoreId } from '../scripts/whatnot-api.mjs';

// Store, 2026-10-31: "build all the whatnot features". The receiving side:
// Whatnot's signed events are checked, repeats dropped, and kept for Settings.
const secretBytes = new Uint8Array(32).map((_, i) => i + 1);
const secret = 'whsec_' + Buffer.from(secretBytes).toString('base64');
async function sign(id, ts, body, key = secretBytes) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return 'v1,' + Buffer.from(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${id}.${ts}.${body}`))).toString('base64');
}
const now = Math.floor(Date.now() / 1000);
const body = JSON.stringify({ type: 'orders.created', data: { id: 'ord_1' } });
const headers = async (over = {}) => new Headers({ 'webhook-id': 'msg_1', 'webhook-timestamp': String(now), 'webhook-signature': await sign('msg_1', now, body), 'content-type': 'application/json', ...over });

assert.equal(await verifyStandardWebhook(secret, await headers(), body), '', 'a genuine event passes');
assert.equal(await verifyStandardWebhook(secret, await headers(), body + ' '), 'signature does not match', 'a changed body fails');
assert.equal(await verifyStandardWebhook(secret, await headers({ 'webhook-signature': await sign('msg_1', now, body, new Uint8Array(32)) }), body), 'signature does not match', 'a different secret fails');
assert.equal(await verifyStandardWebhook(secret, await headers({ 'webhook-timestamp': String(now - 3600), 'webhook-signature': await sign('msg_1', now - 3600, body) }), body), 'timestamp too old or in the future', 'an old replay fails');
assert.equal(await verifyStandardWebhook(secret, new Headers(), body), 'missing webhook headers');
assert.equal(await verifyStandardWebhook(secret, await headers({ 'webhook-signature': 'v0,abc ' + (await sign('msg_1', now, body)) }), body), '', 'any one valid v1 signature in the list is enough');
// Whatnot's own example delivery (developers.whatnot.com, Webhooks -> Verifying
// signatures). Whatnot secrets start with wn_wh_, not whsec_: with the old
// code every real delivery was refused.
const wnBody = '{"type": "shows.started", "timestamp": "2026-10-20T16:00:00.123Z", "data": {"show_id": "9b2f6c1e-4d3a-4f8b-a1c2-3d4e5f6a7b8c"}, "version": "v2", "seller_id": "1234567"}';
const wnHeaders = new Headers({ 'webhook-id': '0b7e4f6c-3d1a-4a8e-9f2b-5c6d7e8f9a0b', 'webhook-timestamp': '1792512005', 'webhook-signature': 'v1,8m/VX9GLLqhNZJndMpPw7OTUKSDI4szDXAmIFY8ffBI=' });
assert.equal(await verifyStandardWebhook('wn_wh_AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=', wnHeaders, wnBody, 1792512005), '', 'a Whatnot wn_wh_ secret verifies Whatnot\'s example');
assert.equal(await verifyStandardWebhook(' wn_wh_AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=\n', wnHeaders, wnBody, 1792512005), '', 'pasted with stray spaces');
assert.equal(await verifyStandardWebhook('wn_wh_AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=', wnHeaders, wnBody.replace('1234567', '7654321'), 1792512005), 'signature does not match');

// The route.
const kv = new Map();
const LBA_KV = {
  get: async k => kv.get(k) ?? null,
  put: async (k, v) => { kv.set(k, v); },
  list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name })) }),
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const post = async h => handleWhatnotWebhook(new Request('https://w.example/whatnot/webhook', { method: 'POST', headers: h, body }), { WHATNOT_WEBHOOK_SECRET: secret, LBA_KV }, { json });

assert.equal((await handleWhatnotWebhook(new Request('https://w.example/whatnot/webhook', { method: 'POST', body }), { LBA_KV }, { json })).status, 503, 'not set up yet: refused');
let res = await post(await headers());
assert.equal(res.status, 200);
const stored = [...kv.keys()].filter(k => k.startsWith('whatnot-event:'));
assert.equal(stored.length, 1);
assert.equal(JSON.parse(kv.get(stored[0])).type, 'orders.created');
res = await post(await headers());
assert.deepEqual(await res.json(), { ok: true, duplicate: true }, 'a retry is acknowledged, not kept twice');
assert.equal([...kv.keys()].filter(k => k.startsWith('whatnot-event:')).length, 1);
// Order events are handed on for recording, after the answer.
{
  const handed = [];
  kv.clear();
  const r2 = await handleWhatnotWebhook(new Request('https://w.example/whatnot/webhook', { method: 'POST', headers: await headers(), body }), { WHATNOT_WEBHOOK_SECRET: secret, LBA_KV }, { json, onEvent: rec => handed.push(rec) });
  assert.equal(r2.status, 200);
  assert.equal(handed.length, 1); assert.equal(handed[0].type, 'orders.created'); assert.equal(handed[0].body.data.id, 'ord_1');
  await handleWhatnotWebhook(new Request('https://w.example/whatnot/webhook', { method: 'POST', headers: await headers(), body }), { WHATNOT_WEBHOOK_SECRET: secret, LBA_KV }, { json, onEvent: rec => handed.push(rec) });
  assert.equal(handed.length, 1, 'a retried delivery is not recorded twice');
}
res = await post(await headers({ 'webhook-signature': 'v1,forged' }));
assert.equal(res.status, 401, 'a forged event is refused');

// Status for Settings: owners and admins of the Whatnot store only.
const env = { WHATNOT_API_KEY: 'k', WHATNOT_WEBHOOK_SECRET: secret, LBA_KV };
const deps = { json, requireStoreUser: async (req, e, storeId, roles) => roles.includes('owner') && !roles.includes('employee') ? { user: {} } : { error: json({}, 403) } };
const status = await handleWhatnotStatus(new Request('https://w.example/whatnot/status'), env, deps, new URL('https://w.example/whatnot/status?store_id=' + whatnotStoreId(env)));
const s = await status.json();
assert.equal(s.apiKeySet, true);
assert.equal(s.webhookUrl, 'https://w.example/whatnot/webhook');
assert.deepEqual(s.events.map(e => e.type), ['orders.created']);
assert.ok(!JSON.stringify(s).includes(secret) && !JSON.stringify(s).includes('"k"'), 'never echoes the secrets');
const other = await handleWhatnotStatus(new Request('https://w.example/whatnot/status'), env, deps, new URL('https://w.example/whatnot/status?store_id=someone-else'));
assert.equal(other.status, 403, 'another store (the pilot) cannot see it');

// Wiring.
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.match(worker, /if \(url\.pathname === '\/whatnot\/webhook' && request\.method === 'POST'\) \{\s*return await handleWhatnotWebhook\(request, env, \{ json, onEvent: /);
assert.match(worker, /whatnot: !!env\.WHATNOT_API_KEY,/, '/health says whether the key is set');
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
assert.match(app, /\{id:'whatnot',group:'online',feature:'whatnot',label:'Whatnot'/);
assert.match(app, /whatnot:\['whatnot-connection-panel'\],/);
console.log('whatnot webhook checks passed');
