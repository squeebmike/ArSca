import assert from 'node:assert/strict';
import { staffHeaders, withSupabase, answeringStaffLogin } from './helpers/signed-in-worker.mjs';

// Store, 2026-10-27: "That psa photo link doesn't work". PSA's GetByCertNumber
// carries no photos; they come from GetImagesByCertNumber. And the photo was
// saved in the background, so the <img> that loads right after the lookup
// found nothing saved and was refused for having no login.
const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
const upstream = [];
let psaStatus = 200;
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
globalThis.fetch = answeringStaffLogin(async (input) => {
  const url = String(input?.url || input); upstream.push(url);
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.includes('/cert/GetByCertNumber/')) {
    if (psaStatus !== 200) return json({ Message: 'Authorization has been denied for this request.' }, psaStatus);
    return json({ PSACert: { CertNumber: '555', Subject: 'CHARIZARD-HOLO', Year: '1999', Brand: 'POKEMON GAME', CardGrade: 'GEM MT 10' } });
  }
  if (url.includes('/cert/GetImagesByCertNumber/')) return json([
    { IsFrontImage: false, ImageURL: 'https://cdn.example/555-back.jpg' },
    { IsFrontImage: true, ImageURL: 'https://cdn.example/555-front.jpg' },
  ]);
  if (url === 'https://cdn.example/555-front.jpg') return new Response('front-bytes', { headers: { 'Content-Type': 'image/jpeg' } });
  return json({}, 404);
});
const r2 = new Map();
const env = withSupabase({
  PSA_TOKEN: 'psa-secret',
  LBA_KV: { get: async () => null, put: async () => {}, delete: async () => {} },
  MTG_CATALOG_R2: {
    get: async k => r2.has(k) ? { body: r2.get(k), httpMetadata: { contentType: 'image/jpeg' } } : null,
    head: async k => r2.has(k) ? {} : null,
    put: async (k, v) => { r2.set(k, typeof v === 'string' ? v : new TextDecoder().decode(v)); },
  },
});
try {
  const { default: api } = await import('../cloudflare-worker-full.js');
  const call = (path, headers = {}) => api.fetch(new Request('https://w.example' + path, { headers }), env, { waitUntil() {}, passThroughOnException() {} });

  let res = await call('/psa/cert/555', staffHeaders());
  let data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.cert.subject, 'CHARIZARD-HOLO');
  assert.equal(data.cert.photoUrl, 'https://cdn.example/555-front.jpg', 'the photo comes from GetImagesByCertNumber, front first');
  assert.equal(r2.get('psa-photos/555.jpg'), 'front-bytes', 'saved before the lookup answers');

  res = await call('/psa/cert/555/photo');
  assert.equal(res.status, 200, 'so the plain <img> right after loads without a login');
  assert.equal(await res.text(), 'front-bytes');

  // A second lookup of the same cert doesn't spend another images call.
  upstream.length = 0;
  data = await (await call('/psa/cert/555', staffHeaders())).json();
  assert.ok(data.cert.photoUrl, 'still reports a photo');
  assert.ok(!upstream.some(u => u.includes('GetImagesByCertNumber')), 'from the saved copy');

  // PSA turning our token down reads as PSA's problem, not a staff login one.
  psaStatus = 401;
  res = await call('/psa/cert/777', staffHeaders());
  data = await res.json();
  assert.equal(res.status, 502);
  assert.match(data.error, /PSA_TOKEN/);
} finally { globalThis.fetch = originalFetch; globalThis.caches = originalCaches; }
console.log('psa cert photo checks passed');
