import assert from 'node:assert/strict';

// The public Pokémon Set Guide lost its data when /pricing/pokemon/* began
// requiring a signed-in store user. It has its own read-only, cached routes.
const { default: api } = await import('../cloudflare-worker-full.js');
const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
const kvStore = new Map();
const env = { POKEMONPRICE_API_KEY: 'ppt-key', LBA_KV: {
  get: async (k, type) => { const v = kvStore.get(k); return v == null ? null : type === 'json' ? JSON.parse(v) : v; },
  put: async (k, v) => { kvStore.set(k, v); }, delete: async k => { kvStore.delete(k); },
} };
let upstreamUp = true;
const calls = [];
globalThis.fetch = async (input, init = {}) => {
  const url = String(input.url || input);
  if (url.startsWith('https://www.pokemonpricetracker.com/api/v2/')) {
    calls.push(url);
    assert.equal(init.headers.Authorization, 'Bearer ppt-key');
    if (!upstreamUp) return new Response('{"error":"down"}', { status: 503 });
    if (url.includes('/sets?')) return new Response(JSON.stringify({ data: [
      { id: 'me2', name: 'Phantasmal Flames', releaseDate: '2026-11-14', cardCount: 130 },
      { id: 'me1', name: 'Mega Evolution', releaseDate: '2026-09-26', cardCount: 188 },
    ] }));
    return new Response(JSON.stringify({ data: [{ name: 'Mega Lucario ex', cardNumber: '077', prices: { market: 41.5 } }] }));
  }
  return new Response('[]');
};
const get = path => api.fetch(new Request('https://still-resonance-4f87.swarnerauto.workers.dev' + path), env, { waitUntil: () => {} });
try {
  // No sign-in, no store header.
  let res = await get('/public/pokemon/sets');
  let body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body.data.map(s => s.name), ['Phantasmal Flames', 'Mega Evolution'], 'newest sets first, straight from the provider');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.match(calls[0], /\/sets\?language=english&sortBy=releaseDate&sortOrder=desc&limit=400/);

  res = await get('/public/pokemon/set-cards?set=' + encodeURIComponent('mega evolution'));
  body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.set, 'Mega Evolution');
  assert.equal(body.data[0].name, 'Mega Lucario ex');
  assert.match(calls.at(-1), /\/cards\?language=english&set=Mega\+Evolution&fetchAllInSet=true&limit=500/);

  // Cached: repeat visits don't spend API calls.
  const before = calls.length;
  await get('/public/pokemon/sets');
  await get('/public/pokemon/set-cards?set=Mega%20Evolution');
  assert.equal(calls.length, before, 'served from cache');

  // Only real sets: no spending quota on arbitrary searches.
  res = await get('/public/pokemon/set-cards?set=charizard');
  assert.equal(res.status, 404);
  assert.equal(calls.length, before);

  // Provider down after the cache expires: the last good copy is served.
  upstreamUp = false;
  const realNow = Date.now;
  Date.now = () => realNow() + 25 * 60 * 60 * 1000;
  try {
    res = await get('/public/pokemon/sets');
    body = await res.json();
  } finally { Date.now = realNow; }
  assert.equal(res.status, 200);
  assert.equal(body.cache, 'stale');
  assert.equal(body.data.length, 2);

  // The dashboard's pricing proxy still requires sign-in.
  res = await get('/pricing/pokemon/sets');
  assert.notEqual(res.status, 200, 'the paid pricing proxy stays gated');
} finally { globalThis.fetch = originalFetch; globalThis.caches = originalCaches; }
console.log('Public Pokémon set guide route checks passed');
