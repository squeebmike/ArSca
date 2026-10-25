// PokemonPriceTracker credit log -- one row per PPT call the Worker makes, so
// Settings -> PRICING APIS -> CREDIT USE can say what spent the credits and
// when (store ask, 2026-10-25: 20,000 credits gone by 8 AM, no way to tell
// why). Table and summary: supabase-migrations/2026-10-25-ppt-usage-log.sql.

const SOURCE_RE = /[^a-z0-9:._ -]/gi;
// Who asked: "daily-sync", "server-daily-sync", "tab:research", "website:set-cards"...
export function pptSourceLabel(value, fallback = 'unknown') {
  const clean = String(value || '').replace(SOURCE_RE, '').trim().slice(0, 60);
  return clean || fallback;
}

// What was asked, without the specifics: "cards:tcgPlayerId", "cards:search",
// "cards:set", "sealed:tcgPlayerId", "sets", "parse-title", "population".
export function pptRouteLabel(upstreamPath, params) {
  const p = params instanceof URLSearchParams ? params : new URLSearchParams(params || {});
  const base = String(upstreamPath || '').replace(/^\/+/, '').replace(/^sealed-products$/, 'sealed') || 'unknown';
  if (base !== 'cards' && base !== 'sealed') return base;
  const by = p.get('tcgPlayerId') || p.get('cardId') ? 'tcgPlayerId'
    : String(p.get('fetchAllInSet') || '').toLowerCase() === 'true' || p.get('set') || p.get('setName') || p.get('setId') ? 'set'
    : p.get('search') ? 'search' : 'list';
  const extras = [p.get('includeBoth') === 'true' || p.get('includeEbay') === 'true' ? 'ebay' : '', p.get('includeBoth') === 'true' || p.get('includeHistory') === 'true' ? 'history' : ''].filter(Boolean);
  return base + ':' + by + (extras.length ? '+' + [...new Set(extras)].join('+') : '');
}

// What PPT says the call cost; when it doesn't say, its own published rule:
// cards returned x (1 + history + eBay).
export function pptCreditsFrom(headers, cardsReturned, params) {
  const raw = headers?.get?.('X-API-Calls-Consumed');
  const told = raw == null || raw === '' ? NaN : Number(raw);
  if (Number.isFinite(told) && told >= 0) return Math.round(told);
  const p = params instanceof URLSearchParams ? params : new URLSearchParams(params || {});
  const both = p.get('includeBoth') === 'true';
  const per = 1 + (both || p.get('includeHistory') === 'true' ? 1 : 0) + (both || p.get('includeEbay') === 'true' ? 1 : 0);
  return Math.max(0, Number(cardsReturned) || 0) * per;
}

// Never lets a logging problem break the lookup it's describing.
export async function logPptUsage(env, { storeId = '', source, route, credits = 0, cards = 0, status = 0 } = {}) {
  const key = env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_SERVICE_KEY;
  if (!env?.SUPABASE_URL || !key) return false;
  const row = {
    store_id: /^[0-9a-f-]{36}$/i.test(String(storeId || '')) ? storeId : null,
    source: pptSourceLabel(source), route: String(route || '').slice(0, 80),
    credits: Math.max(0, Math.round(Number(credits) || 0)), cards: Math.max(0, Math.round(Number(cards) || 0)), status: Number(status) || 0,
  };
  try {
    const res = await fetch(String(env.SUPABASE_URL).replace(/\/+$/, '') + '/rest/v1/ppt_usage_log', {
      method: 'POST',
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(2500),
    });
    return res.ok;
  } catch (_) { return false; }
}
