// Public data for the site's Pokémon Set Guide (/pokemon-new-releases).
//
// The guide used the dashboard's /pricing/pokemon/* proxy, which now requires
// a signed-in store user with a subscription, so the public page could no
// longer load sets (and its old pokemontcg.io fallback is gone too). These two
// read-only routes serve only what the guide shows -- the set list and one
// set's cards -- from the store's PokemonPriceTracker key, cached in KV so
// visitors barely touch the API quota:
//   GET /public/pokemon/sets                 -> { ok, data: [set, ...] }   (24h)
//   GET /public/pokemon/set-cards?set=<name>  -> { ok, data: [card, ...] }  (12h)
// Only set names from the cached set list are accepted, so the card route
// can't be used to spend quota on arbitrary searches. When the provider
// fails, the last good copy is served.

const PPT = 'https://www.pokemonpricetracker.com/api/v2';
export const SETS_FRESH_MS = 24 * 60 * 60 * 1000;
export const CARDS_FRESH_MS = 12 * 60 * 60 * 1000;
const KEEP_SECONDS = 14 * 24 * 60 * 60;
const SETS_KEY = 'public_pokemon:sets:v1';
const cardsKey = name => 'public_pokemon:cards:v1:' + encodeURIComponent(name.toLowerCase()).slice(0, 400);

async function readCache(kv, key) {
  return kv ? kv.get(key, 'json').catch(() => null) : null;
}
async function writeCache(kv, key, data) {
  if (kv) await kv.put(key, JSON.stringify({ cachedAt: Date.now(), data }), { expirationTtl: KEEP_SECONDS }).catch(() => {});
}

async function upstream(env, path, params) {
  const key = env.POKEMONPRICE_API_KEY || env.POKEMON_PRICE_TRACKER_API_KEY;
  if (!key) throw new Error('Pokémon prices are not configured');
  const res = await fetch(`${PPT}${path}?${new URLSearchParams({ language: 'english', ...params })}`, {
    headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`PokemonPriceTracker ${res.status}`);
  const list = Array.isArray(body?.data) ? body.data : Array.isArray(body?.cards) ? body.cards : Array.isArray(body?.results) ? body.results : [];
  return list;
}

// Fresh cache, else the provider, else a stale cache, else the error.
async function cached(env, key, freshMs, load, now) {
  const hit = await readCache(env.LBA_KV, key);
  if (hit && now - Number(hit.cachedAt || 0) < freshMs) return { data: hit.data, cache: 'hit' };
  try {
    const data = await load();
    if (data.length) await writeCache(env.LBA_KV, key, data);
    return { data, cache: 'miss' };
  } catch (error) {
    if (hit) return { data: hit.data, cache: 'stale' };
    throw error;
  }
}

async function loadSets(env, now) {
  return cached(env, SETS_KEY, SETS_FRESH_MS, () => upstream(env, '/sets', { sortBy: 'releaseDate', sortOrder: 'desc', limit: '400' }), now);
}

export async function handlePublicPokemonRequest(request, env, url, json, now = Date.now()) {
  if (url.pathname !== '/public/pokemon/sets' && url.pathname !== '/public/pokemon/set-cards') return null;
  if (request.method !== 'GET') return json({ ok: false, error: 'GET only' }, 405);
  const headers = { 'Cache-Control': 'public, max-age=900' };
  try {
    const sets = await loadSets(env, now);
    if (url.pathname === '/public/pokemon/sets') return json({ ok: true, data: sets.data, cache: sets.cache }, 200, headers);

    const wanted = String(url.searchParams.get('set') || '').trim().slice(0, 150);
    const set = sets.data.find(s => String(s.name || '').toLowerCase() === wanted.toLowerCase() || String(s.id || '') === wanted);
    if (!set) return json({ ok: false, error: 'Unknown set' }, 404);
    const name = String(set.name || set.id);
    const cards = await cached(env, cardsKey(name), CARDS_FRESH_MS, () => upstream(env, '/cards', { set: name, fetchAllInSet: 'true', limit: '500' }), now);
    return json({ ok: true, set: name, data: cards.data, cache: cards.cache }, 200, headers);
  } catch (error) {
    return json({ ok: false, error: error.message }, 502);
  }
}
