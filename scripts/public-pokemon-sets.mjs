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
//
// Store report: "why are we blowing through Pokemon credits?" -- ~40k a
// day. PPT charges a credit per card returned, and the public catalog
// (/pokemon/sets/..., /pokemon/cards/..., in the sitemap) re-downloaded a
// whole set whenever a crawler reached it after 12 hours: about the entire
// ~23k-card catalog twice a day. These are reference prices, so a set is
// now kept for a week, a crawler is always served the saved copy (only a
// real visitor starts a refresh), and the public pages spend at most
// PUBLIC_DAILY_CREDITS a day -- past that, the saved copy is served.

const PPT = 'https://www.pokemonpricetracker.com/api/v2';
export const SETS_FRESH_MS = 24 * 60 * 60 * 1000;
export const CARDS_FRESH_MS = 7 * 24 * 60 * 60 * 1000;
export const PUBLIC_DAILY_CREDITS = 2000;
const KEEP_SECONDS = 60 * 24 * 60 * 60;
const spendKey = now => 'public_pokemon:spend:' + new Date(now).toISOString().slice(0, 10);
// Search engines, link previews and scrapers.
const CRAWLER_RE = /bot\b|bot\/|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|ahrefs|semrush|mj12|yandex|baidu|duckduck|petal|bytespider|gptbot|claude|ccbot|applebot|google-inspectiontool|headless|python-requests|curl\/|wget/i;
export function isCrawler(request) {
  const ua = String(request?.headers?.get?.('User-Agent') || '');
  return !ua || CRAWLER_RE.test(ua);
}
async function spentToday(kv, now) {
  return kv ? Number(await kv.get(spendKey(now)).catch(() => 0)) || 0 : 0;
}
async function addSpend(kv, now, credits) {
  if (!kv || !(credits > 0)) return;
  const total = (await spentToday(kv, now)) + credits;
  await kv.put(spendKey(now), String(total), { expirationTtl: 3 * 24 * 60 * 60 }).catch(() => {});
}
const SETS_KEY = 'public_pokemon:sets:v1';
const RETRY_KEY = 'public_pokemon:upstream_retry:v1';
const cardsKey = name => 'public_pokemon:cards:v1:' + encodeURIComponent(name.toLowerCase()).slice(0, 400);

async function readCache(kv, key) {
  return kv ? kv.get(key, 'json').catch(() => null) : null;
}
async function writeCache(kv, key, data) {
  if (kv) await kv.put(key, JSON.stringify({ cachedAt: Date.now(), data, paged: true }), { expirationTtl: KEEP_SECONDS }).catch(() => {});
}

async function upstream(env, path, params) {
  const key = env.POKEMONPRICE_API_KEY || env.POKEMON_PRICE_TRACKER_API_KEY;
  if (!key) throw new Error('Pokémon prices are not configured');
  const retry=await readCache(env.LBA_KV,RETRY_KEY);
  if(Number(retry?.until)>Date.now())throw new Error('PokemonPriceTracker 429 (retry later)');
  const all=[];let offset=0,previous='';
  for(let page=0;page<20;page++){
  if(await spentToday(env.LBA_KV,Date.now())>=PUBLIC_DAILY_CREDITS)throw new Error('Public Pokémon pages reached today\'s PokemonPriceTracker budget');
  const pageParams={...params};if(page)delete pageParams.fetchAllInSet;
  const res = await fetch(`${PPT}${path}?${new URLSearchParams({ language: 'english', ...pageParams, ...(page?{offset:String(offset)}:{}) })}`, {
    headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' },
  });
  const body = await res.json().catch(() => null);
  if(res.status===429&&env.LBA_KV){
    const value=res.headers.get('Retry-After'),numeric=Number(value);
    const seconds=value?(Number.isFinite(numeric)?numeric:(Date.parse(value)-Date.now())/1000):60;
    const delay=Math.ceil(Math.max(60,Math.min(3600,Number.isFinite(seconds)?seconds:60)));
    await env.LBA_KV.put(RETRY_KEY,JSON.stringify({until:Date.now()+delay*1000}),{expirationTtl:delay}).catch(()=>{});
  }
  if (!res.ok) throw new Error(`PokemonPriceTracker ${res.status}`);
  const list = Array.isArray(body?.data) ? body.data : Array.isArray(body?.cards) ? body.cards : Array.isArray(body?.results) ? body.results : [];
  // A plain card query costs one credit per card returned.
  await addSpend(env.LBA_KV,Date.now(),list.length);
  // A provider that ignores offset must not fill the cache with repeated pages.
  if(page&&JSON.stringify(list)===previous)throw new Error('Pokémon checklist repeated a page');
  all.push(...list);
  if(path!=='/cards'||body?.metadata?.hasMore!==true)return all;
  if(!list.length)throw new Error('Pokémon checklist pagination made no progress');
  previous=JSON.stringify(list);offset+=list.length;
  }
  throw new Error('Pokémon checklist exceeded pagination bound');
}

// Fresh cache, else the provider, else a stale cache, else the error.
// refresh:false (a crawler) never spends credits when any copy is saved.
async function cached(env, key, freshMs, load, now, usable=()=>true, { refresh = true } = {}) {
  const hit = await readCache(env.LBA_KV, key);
  if (hit && usable(hit) && now - Number(hit.cachedAt || 0) < freshMs) return { data: hit.data, cache: 'hit', complete:true };
  if (hit && !refresh) return { data: hit.data, cache: 'stale', complete:usable(hit) };
  try {
    const data = await load();
    if (data.length) await writeCache(env.LBA_KV, key, data);
    return { data, cache: 'miss', complete:true };
  } catch (error) {
    if (hit) return { data: hit.data, cache: 'stale', complete:usable(hit) };
    throw error;
  }
}

export async function loadPokemonSets(env, now = Date.now(), options = {}) {
  return cached(env, SETS_KEY, SETS_FRESH_MS, () => upstream(env, '/sets', { sortBy: 'releaseDate', sortOrder: 'desc', limit: '400' }), now, () => true, options);
}

export async function loadPokemonSetCards(env, set, now = Date.now(), options = {}) {
  const name=String(set.name||set.id);
  return cached(env,cardsKey(name),CARDS_FRESH_MS,()=>upstream(env,'/cards',{set:name,limit:'200'}),now,
    hit=>hit.paged===true || !(hit.data?.length===200&&Number(set.cardCount)>200), options);
}

// The Set Guide embed on the live page calls the older paths below, signed
// out. Those two exact calls get the public cached answer; every other
// /pricing/pokemon/* request still goes to the signed-in pricing proxy.
export function publicPokemonAlias(request, url) {
  if (request.method !== 'GET' || request.headers.get('Authorization') || request.headers.get('X-Store-Id')) return null;
  if (url.pathname === '/pricing/pokemon/sets') return new URL('/public/pokemon/sets', url);
  if (url.pathname === '/pricing/pokemon/cards' && url.searchParams.get('fetchAllInSet') === 'true' && url.searchParams.get('set')
    && !url.searchParams.get('search') && !url.searchParams.get('tcgPlayerId') && !url.searchParams.get('cardId')) {
    const target = new URL('/public/pokemon/set-cards', url);
    target.searchParams.set('set', url.searchParams.get('set'));
    return target;
  }
  return null;
}

export async function handlePublicPokemonRequest(request, env, url, json, now = Date.now()) {
  url = publicPokemonAlias(request, url) || url;
  if (url.pathname !== '/public/pokemon/sets' && url.pathname !== '/public/pokemon/set-cards') return null;
  if (request.method !== 'GET') return json({ ok: false, error: 'GET only' }, 405);
  const headers = { 'Cache-Control': 'public, max-age=900' };
  try {
    const refresh = !isCrawler(request);
    const sets = await loadPokemonSets(env, now, { refresh });
    if (url.pathname === '/public/pokemon/sets') return json({ ok: true, data: sets.data, cache: sets.cache }, 200, headers);

    const wanted = String(url.searchParams.get('set') || '').trim().slice(0, 150);
    const set = sets.data.find(s => String(s.name || '').toLowerCase() === wanted.toLowerCase() || String(s.id || '') === wanted);
    if (!set) return json({ ok: false, error: 'Unknown set' }, 404);
    const name = String(set.name || set.id);
    const cards = await loadPokemonSetCards(env,set,now,{ refresh });
    return json({ ok: true, set: name, data: cards.data, cache: cards.cache, complete:cards.complete }, 200, headers);
  } catch (error) {
    return json({ ok: false, error: error.message }, 502);
  }
}
