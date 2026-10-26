// Another store's use of The Mana Pocket's paid services (second-store
// pilot, 2026-10-26). Pilot stores may use the AI, CardSight, SoldComps and
// PSA lookups on your accounts (store decision); this log says how much, so
// it can be billed back or capped later. One row per successful call by a
// store other than The Mana Pocket -- your own calls are never logged.
// Table and summary: supabase-migrations/2026-10-26-shared-service-usage.sql.

import { isPlatformStore } from './store-features.mjs';

// Which shared service a Worker path spends (null = not tracked).
export function sharedServiceForPath(pathname = '') {
  const p = String(pathname);
  if (p === '/anthropic/messages' || p === '/identify/card') return 'anthropic';
  if (p === '/cardsight/identify') return 'cardsight';
  if (p === '/comps/sold') return 'soldcomps';
  if (p.startsWith('/psa/')) return 'psa';
  return null;
}

// The store a call is for, when it's another store's.
export function sharedUsageStore(request, url, env = {}) {
  const id = String(request.headers.get('X-Store-Id') || url.searchParams.get('store') || url.searchParams.get('store_id') || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(id) || isPlatformStore(id, env)) return '';
  return id;
}

// Anthropic reports what it charged for in tokens.
export function anthropicUsage(data) {
  const u = data?.usage || {};
  return {
    model: String(data?.model || '').slice(0, 60),
    inputTokens: Math.max(0, Math.round(Number(u.input_tokens) || 0) + Math.round(Number(u.cache_read_input_tokens) || 0) + Math.round(Number(u.cache_creation_input_tokens) || 0)),
    outputTokens: Math.max(0, Math.round(Number(u.output_tokens) || 0)),
  };
}

// Never lets a logging problem break the call it's describing.
export async function logSharedServiceUsage(env, { storeId, service, route = '', model = '', inputTokens = 0, outputTokens = 0, status = 0 } = {}) {
  const key = env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_SERVICE_KEY;
  if (!env?.SUPABASE_URL || !key || !storeId || !service) return false;
  const row = {
    store_id: storeId, service: String(service).slice(0, 30), route: String(route).slice(0, 80), model: String(model).slice(0, 60),
    input_tokens: Math.max(0, Math.round(Number(inputTokens) || 0)), output_tokens: Math.max(0, Math.round(Number(outputTokens) || 0)), status: Number(status) || 0,
  };
  try {
    const res = await fetch(String(env.SUPABASE_URL).replace(/\/+$/, '') + '/rest/v1/shared_service_usage', {
      method: 'POST',
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(2500),
    });
    return res.ok;
  } catch (_) { return false; }
}

// Called with every routed response. Logs in the background (ctx.waitUntil)
// so the caller never waits on it.
export function trackSharedServiceUsage(env, ctx, request, response) {
  if (!response?.ok) return null;
  const url = new URL(request.url);
  const service = sharedServiceForPath(url.pathname);
  if (!service) return null;
  const storeId = sharedUsageStore(request, url, env);
  if (!storeId) return null;
  const work = (async () => {
    const usage = url.pathname === '/anthropic/messages' ? anthropicUsage(await response.clone().json().catch(() => null)) : {};
    return logSharedServiceUsage(env, { storeId, service, route: url.pathname, status: response.status, ...usage });
  })().catch(() => false);
  ctx?.waitUntil?.(work);
  return work;
}
