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

  upstreamUp = true;
  // The live page's embed still calls the old paths, signed out: those two
  // exact calls get the public cached answer, in the shape it reads.
  res = await get('/pricing/pokemon/sets?sortBy=releaseDate&sortOrder=desc&limit=400');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).data.length, 2);
  res = await get('/pricing/pokemon/cards?set=Mega+Evolution&fetchAllInSet=true&limit=500');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).data[0].name, 'Mega Lucario ex');

  // Every other pricing lookup still requires sign-in.
  const paid = calls.length;
  for (const path of ['/pricing/pokemon/cards?search=charizard', '/pricing/pokemon/cards?tcgPlayerId=1', '/pricing/pokemon/sealed-products', '/pricing/pokemon/cards?set=Mega+Evolution&fetchAllInSet=true&search=x']) {
    res = await get(path);
    assert.notEqual(res.status, 200, path + ' stays gated');
  }
  res = await api.fetch(new Request('https://still-resonance-4f87.swarnerauto.workers.dev/pricing/pokemon/sets', { headers: { 'X-Store-Id': 'store-1' } }), env, { waitUntil: () => {} });
  assert.notEqual(res.status, 200, 'a dashboard (store) request still goes through the signed-in proxy');
  assert.equal(calls.length, paid, 'no paid API calls for gated requests');
} finally { globalThis.fetch = originalFetch; globalThis.caches = originalCaches; }
console.log('Public Pokémon set guide route checks passed');
