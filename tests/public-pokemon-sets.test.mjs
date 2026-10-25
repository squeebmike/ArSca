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
  assert.match(calls.at(-1), /\/cards\?language=english&set=Mega\+Evolution&limit=200/);

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

// Large checklists must not silently stop at the provider's 200-row page.
const {loadPokemonSetCards}=await import('../scripts/public-pokemon-sets.mjs');
const cardRows=Array.from({length:255},(_,n)=>({id:'card-'+n,name:'Card '+n,cardNumber:String(n)}));
const pagingStore=new Map(),pagingEnv={POKEMONPRICE_API_KEY:'test-only',LBA_KV:{get:async k=>pagingStore.has(k)?JSON.parse(pagingStore.get(k)):null,put:async(k,v)=>pagingStore.set(k,v)}};
let requests=[];
try{
  globalThis.fetch=async input=>{const u=new URL(input);requests.push(u);const offset=Number(u.searchParams.get('offset')||0);return Response.json({data:cardRows.slice(offset,offset+200),metadata:{hasMore:offset===0,total:255}});};
  const result=await loadPokemonSetCards(pagingEnv,{id:'large',name:'Large Set',cardCount:255});
  assert.equal(result.data.length,255,'all provider pages are returned');assert.equal(result.complete,true);
  assert.equal(requests[1].searchParams.get('offset'),'200');
  assert.equal(requests[1].searchParams.has('fetchAllInSet'),false,'offset pages use standard pagination rather than bulk mode');
  const before=requests.length;await loadPokemonSetCards(pagingEnv,{name:'Large Set',cardCount:255});assert.equal(requests.length,before,'fully paged cache avoids repeat quota use');
  const legacyKey='public_pokemon:cards:v1:'+encodeURIComponent('legacy set');
  pagingStore.set(legacyKey,JSON.stringify({cachedAt:Date.now(),data:cardRows.slice(0,200)}));
  let rateCalls=0;globalThis.fetch=async()=>{rateCalls++;return new Response('{}',{status:429});};
  const stale=await loadPokemonSetCards(pagingEnv,{name:'Legacy Set',cardCount:255});
  assert.equal(stale.data.length,200,'rate limiting preserves existing cards');assert.equal(stale.complete,false,'old truncated cache is explicitly partial');assert.equal(stale.cache,'stale');
  await loadPokemonSetCards(pagingEnv,{name:'Legacy Set',cardCount:255});assert.equal(rateCalls,1,'provider cooldown avoids repeatedly spending quota on a rate-limited refresh');
  pagingStore.delete('public_pokemon:upstream_retry:v1');
  globalThis.fetch=async()=>Response.json({data:cardRows.slice(0,200),metadata:{hasMore:true}});
  await assert.rejects(loadPokemonSetCards(pagingEnv,{name:'Repeated Set',cardCount:255}),/repeated a page/,'ignored offsets must not cache duplicate pages');
  assert.equal(pagingStore.has('public_pokemon:cards:v1:repeated%20set'),false);
  globalThis.fetch=async input=>new URL(input).searchParams.has('offset')?new Response('{}',{status:429}):Response.json({data:cardRows.slice(0,200),metadata:{hasMore:true}});
  await assert.rejects(loadPokemonSetCards(pagingEnv,{name:'Interrupted Set',cardCount:255}),/429/);
  assert.equal(pagingStore.has('public_pokemon:cards:v1:interrupted%20set'),false,'an interrupted refresh cannot replace a checklist with page one');
}finally{globalThis.fetch=originalFetch;}
console.log('Large Pokémon checklist paging and partial-cache checks passed');

// Store report: ~40k PokemonPriceTracker credits a day. Crawlers walking the
// public catalog re-downloaded every set after 12 hours. Now: a week's
// cache, crawlers never trigger a refresh, and a daily credit cap.
{
  const mod = await import('../scripts/public-pokemon-sets.mjs');
  const { loadPokemonSetCards: load, isCrawler, CARDS_FRESH_MS, PUBLIC_DAILY_CREDITS } = mod;
  assert.equal(CARDS_FRESH_MS, 7 * 24 * 60 * 60 * 1000, 'a set is kept a week');
  assert.equal(PUBLIC_DAILY_CREDITS, 2000);
  const req = ua => new Request('https://www.themanapocket.com/pokemon', { headers: ua ? { 'User-Agent': ua } : {} });
  assert.equal(isCrawler(req('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')), true);
  assert.equal(isCrawler(req('Mozilla/5.0 (compatible; bingbot/2.0)')), true);
  assert.equal(isCrawler(req('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2)')), true);
  assert.equal(isCrawler(req('')), true, 'no browser at all');
  assert.equal(isCrawler(req('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36')), false, 'a person');

  const store = new Map();
  const env2 = { POKEMONPRICE_API_KEY: 'k', LBA_KV: { get: async (k, t) => { const v = store.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => store.set(k, v) } };
  const rows = n => Array.from({ length: n }, (_, i) => ({ id: 'c' + i, name: 'Card ' + i }));
  let hits = 0;
  try {
    globalThis.fetch = async () => { hits++; return Response.json({ data: rows(150) }); };
    const t0 = Date.parse('2026-10-25T12:00:00Z');
    await load(env2, { name: 'Set A', cardCount: 150 }, t0, { refresh: false });
    assert.equal(hits, 1, 'nothing saved yet: even a crawler gets the page built once');
    await load(env2, { name: 'Set A', cardCount: 150 }, t0 + 3 * 86400e3, { refresh: true });
    assert.equal(hits, 1, 'three days later a visitor still gets the saved copy');
    const old = await load(env2, { name: 'Set A', cardCount: 150 }, t0 + 8 * 86400e3, { refresh: false });
    assert.equal(hits, 1, 'past a week, a crawler still never spends credits');
    assert.equal(old.cache, 'stale');
    await load(env2, { name: 'Set A', cardCount: 150 }, t0 + 8 * 86400e3, { refresh: true });
    assert.equal(hits, 2, 'a real visitor past a week refreshes it');
    // The daily cap: credits are counted per card returned.
    const day = new Date().toISOString().slice(0, 10);
    assert.ok(Number(store.get('public_pokemon:spend:' + day)) >= 150);
    store.set('public_pokemon:spend:' + day, String(PUBLIC_DAILY_CREDITS));
    const capped = await load(env2, { name: 'Set A', cardCount: 150 }, Date.now() + 30 * 86400e3, { refresh: true });
    assert.equal(hits, 2, 'over the daily cap: no call');
    assert.equal(capped.cache, 'stale', 'the saved copy is served');
    await assert.rejects(load(env2, { name: 'Never Seen', cardCount: 10 }, Date.now(), { refresh: true }), /budget/, 'nothing saved and over the cap: the page says try later');
  } finally { globalThis.fetch = originalFetch; }
}
// Every public caller passes who is asking.
{
  const { readFileSync } = await import('node:fs');
  const pages = readFileSync(new URL('../scripts/pokemon-catalog-pages.mjs', import.meta.url), 'utf8');
  const worker = readFileSync(new URL('../cloudflare-worker-full.js', import.meta.url), 'utf8');
  assert.ok(pages.includes('const refresh=!isCrawler(request);') && pages.includes('loadPokemonSetCards(env,set,Date.now(),{refresh})'));
  assert.ok(worker.includes('return set?(await loadPokemonSetCards(env,set,Date.now(),{refresh})).data:[];'), 'articles');
  assert.ok(worker.includes("loadPokemonSets(env,Date.now(),{refresh:!isPokemonCrawler(request)})"), 'pocket guides');
  assert.equal((worker.match(/loadPokemonSetCards\(env,set\)/g) || []).length, 0);
}
console.log('Public Pokémon credit budget checks passed');
