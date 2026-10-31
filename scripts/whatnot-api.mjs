// Whatnot Seller API -- the receiving side (store, 2026-10-31: "build all the
// whatnot features"). Whatnot posts events here (orders.created,
// shows.created, shows.ended, shipments.parcel_updated, ...) once the store
// points a webhook at /whatnot/webhook in Seller Hub -> Seller API.
//
// This checks the signature, drops repeats and keeps every event for 30
// days; order events are then recorded (scripts/whatnot-sync.mjs) after the
// answer goes back.
//
// Signatures follow the Standard Webhooks spec: headers webhook-id,
// webhook-timestamp and webhook-signature ("v1,<base64>" entries), signed
// content "<id>.<timestamp>.<raw body>", HMAC-SHA256 with the secret
// (WHATNOT_WEBHOOK_SECRET: Whatnot's "wn_wh_<base64>", or "whsec_<base64>").
import { PLATFORM_STORE_ID } from './store-features.mjs';

const EVENT_TTL = 30 * 86400;
const SEEN_TTL = 7 * 86400;
const MAX_SKEW_SECONDS = 5 * 60;
const MAX_BODY = 256 * 1024;

// The store whose Whatnot account this is.
export const whatnotStoreId = env => String(env.WHATNOT_STORE_ID || PLATFORM_STORE_ID);

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes) {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin);
}
function sameString(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// '' when the request is genuine, else why it isn't.
export async function verifyStandardWebhook(secret, headers, rawBody, nowSeconds = Math.floor(Date.now() / 1000)) {
  const id = headers.get('webhook-id') || '';
  const timestamp = headers.get('webhook-timestamp') || '';
  const signatures = (headers.get('webhook-signature') || '').split(' ').filter(Boolean);
  if (!id || !/^\d+$/.test(timestamp) || !signatures.length) return 'missing webhook headers';
  if (Math.abs(nowSeconds - Number(timestamp)) > MAX_SKEW_SECONDS) return 'timestamp too old or in the future';
  let keyBytes;
  try { keyBytes = b64ToBytes(String(secret).trim().replace(/^(?:wn_wh_|whsec_)/, '')); if (!keyBytes.length) throw new Error('Empty key'); } catch (_) { return 'webhook secret is not valid base64'; }
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = bytesToB64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`)));
  const ok = signatures.some(s => { const [version, sig] = s.split(','); return version === 'v1' && sig && sameString(sig, expected); });
  return ok ? '' : 'signature does not match';
}

// Newest first in a KV listing.
const eventKey = (storeId, atMs, id) => `whatnot-event:${storeId}:${String(9999999999999 - atMs).padStart(13, '0')}:${id}`;

export async function handleWhatnotWebhook(request, env, deps) {
  if (!env.WHATNOT_WEBHOOK_SECRET) return deps.json({ ok: false, error: 'Whatnot webhooks are not set up yet' }, 503);
  if (!env.LBA_KV) return deps.json({ ok: false, error: 'Storage unavailable' }, 503);
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY) return deps.json({ ok: false, error: 'Too large' }, 413);
  const problem = await verifyStandardWebhook(env.WHATNOT_WEBHOOK_SECRET, request.headers, rawBody);
  if (problem) return deps.json({ ok: false, error: problem }, 401);
  const id = String(request.headers.get('webhook-id')).slice(0, 120);
  // Whatnot retries until it gets a 200; a repeat is acknowledged, not kept twice.
  if (await env.LBA_KV.get('whatnot-webhook-seen:' + id)) return deps.json({ ok: true, duplicate: true });
  let body = null;
  try { body = JSON.parse(rawBody); } catch (_) { body = { raw: rawBody.slice(0, 4000) }; }
  const type = String(body?.type || body?.topic || body?.event || request.headers.get('webhook-event') || 'unknown').slice(0, 80);
  const storeId = whatnotStoreId(env);
  // Live Studio owns its atomic effect deduplication. Await acceptance before
  // acknowledging so a failed handoff is retried. It never writes inventory.
  if (env.MANA_LIVE_STUDIO && body?.version === 'v2') {
    try { await env.MANA_LIVE_STUDIO.getByName(storeId).receiveWhatnot(id, body); }
    catch (_) { return deps.json({ ok:false, error:'Live Studio delivery unavailable; retry' },503); }
  }
  const at = Date.now();
  const record = { id, type, receivedAt: new Date(at).toISOString(), sellerId: String(body?.seller_id || request.headers.get('x-whatnot-seller-id') || ''), body };
  await env.LBA_KV.put(eventKey(storeId, at, id), JSON.stringify(record), { expirationTtl: EVENT_TTL });
  await env.LBA_KV.put('whatnot-webhook-seen:' + id, '1', { expirationTtl: SEEN_TTL });
  // Orders are recorded after answering (Whatnot waits 5 seconds at most).
  try { deps.onEvent?.(record); } catch (_) {}
  return deps.json({ ok: true });
}

// GET /whatnot/status?store_id= -- for Settings: what's set up, where to
// point the webhook, and the latest events received.
export async function handleWhatnotStatus(request, env, deps, url) {
  const storeId = String(url.searchParams.get('store_id') || '').trim();
  const auth = await deps.requireStoreUser(request, env, storeId, ['owner', 'admin']);
  if (auth.error) return auth.error;
  if (storeId !== whatnotStoreId(env)) return deps.json({ ok: false, error: 'Whatnot is connected to a different store' }, 403);
  const events = [];
  if (env.LBA_KV) {
    const page = await env.LBA_KV.list({ prefix: `whatnot-event:${storeId}:`, limit: 25 });
    for (const k of page.keys || []) {
      const raw = await env.LBA_KV.get(k.name);
      if (!raw) continue;
      try { const e = JSON.parse(raw); events.push({ id: e.id, type: e.type, receivedAt: e.receivedAt }); } catch (_) {}
    }
  }
  return deps.json({
    ok: true,
    apiKeySet: !!env.WHATNOT_API_KEY,
    webhookSecretSet: !!env.WHATNOT_WEBHOOK_SECRET,
    webhookUrl: url.origin + '/whatnot/webhook',
    events,
  });
}
