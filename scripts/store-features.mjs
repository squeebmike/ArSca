// Per-store features (second-store pilot, 2026-10-26). The Mana Pocket is
// the platform store: everything stays on for it, always, and it is never
// looked up -- a missing row, a failed read or an outage can't take anything
// away from it. Any other store gets what its store_features row says, and
// nothing tied to the platform's own accounts (eBay, Shopify, the comic/FOC
// workflow, the website) unless a platform admin turns it on. A failed read
// for another store fails closed. Table:
// supabase-migrations/2026-10-26-store-features.sql.

export const PLATFORM_STORE_ID = '0f9dd4bc-42a7-487e-a972-2905d24513e9'; // The Mana Pocket

// Account-tied features are enforced by the Worker; the rest only shape the
// dashboard (nothing of the platform's is reachable through them).
export const FEATURE_KEYS = ['ebay', 'shopify', 'comics', 'website', 'sms', 'sharedPricingKeys', 'consignment', 'whatnot'];
export const SERVER_FEATURES = ['ebay', 'shopify', 'comics', 'website', 'sms'];

export const PLATFORM_FEATURES = Object.freeze({
  ...Object.fromEntries(FEATURE_KEYS.map(k => [k, true])),
  feeFixedCents: 0, feeBps: 0, platform: true,
});
// A new store: register, inventory, buying and pricing only; the platform's
// fee on its card sales is 10 cents a sale (store, 2026-10-26).
export const PILOT_DEFAULTS = Object.freeze({
  ...Object.fromEntries(FEATURE_KEYS.map(k => [k, false])),
  feeFixedCents: 10, feeBps: 0, platform: false,
});

const COLUMN = { ebay:'ebay', shopify:'shopify', comics:'comics', website:'website', sms:'sms', sharedPricingKeys:'shared_pricing_keys', consignment:'consignment', whatnot:'whatnot' };

export function isPlatformStore(storeId, env = {}) {
  const id = String(storeId || '').trim();
  if (!id) return false;
  if (id === PLATFORM_STORE_ID) return true;
  return String(env.OWNER_STORE_IDS || env.OWNER_STORE_ID || '').split(',').map(s => s.trim()).filter(Boolean).includes(id);
}

export function featuresFromRow(row) {
  if (!row || typeof row !== 'object') return { ...PILOT_DEFAULTS };
  const out = { ...PILOT_DEFAULTS };
  for (const [key, col] of Object.entries(COLUMN)) if (typeof row[col] === 'boolean') out[key] = row[col];
  const fixed = Number(row.platform_fee_fixed_cents), bps = Number(row.platform_fee_bps);
  if (Number.isFinite(fixed) && fixed >= 0) out.feeFixedCents = Math.round(fixed);
  if (Number.isFinite(bps) && bps >= 0) out.feeBps = Math.round(bps);
  return out;
}

export function rowFromFeatures(storeId, features = {}) {
  const row = { store_id: storeId };
  for (const [key, col] of Object.entries(COLUMN)) if (typeof features[key] === 'boolean') row[col] = features[key];
  if (features.feeFixedCents != null) row.platform_fee_fixed_cents = Math.max(0, Math.min(10000, Math.round(Number(features.feeFixedCents) || 0)));
  if (features.feeBps != null) row.platform_fee_bps = Math.max(0, Math.min(2000, Math.round(Number(features.feeBps) || 0)));
  return row;
}

const CACHE_MS = 60 * 1000;
const cache = new Map();
export function clearStoreFeatureCache(storeId) { if (storeId) cache.delete(String(storeId)); else cache.clear(); }

// readRow(storeId) -> the store_features row or null; throws on a failed read.
export async function storeFeatures(env, storeId, readRow, now = Date.now()) {
  const id = String(storeId || '').trim();
  if (isPlatformStore(id, env)) return { ...PLATFORM_FEATURES };
  if (!id) return { ...PILOT_DEFAULTS };
  const hit = cache.get(id);
  if (hit && now - hit.at < CACHE_MS) return { ...hit.features };
  let features;
  try { features = featuresFromRow(await readRow(id)); }
  catch (_) { return { ...PILOT_DEFAULTS }; } // fail closed, and don't cache a failure
  cache.set(id, { at: now, features });
  return { ...features };
}

// Which account-tied feature a Worker path belongs to (null = not walled).
// Public website pages carry no store of their own and are left alone.
export function featureForPath(pathname = '') {
  const p = String(pathname);
  if (p.startsWith('/ebay/') || p.startsWith('/foc/ebay/') || p.startsWith('/dealscan')) return 'ebay';
  if (p.startsWith('/shopify/')) return 'shopify';
  // Texts and calls go out from The Mana Pocket's own Twilio number.
  if (p.startsWith('/phone/') || p.startsWith('/twilio/')) return 'sms';
  if (p.startsWith('/foc/') || p.startsWith('/backlist/admin/') || p.startsWith('/comic/') || p === '/preorders/pull-list' || p.startsWith('/preorders/pull-list/')) return 'comics';
  if (p.startsWith('/store/storefront-orders') || p.startsWith('/store/stuck-payments')) return 'website';
  return null;
}

// Every store a request names: header, query and JSON body. A route
// authenticates against one of these, so if any of them is walled off from
// the feature, the request is refused before the route runs.
export function requestStoreCandidates(request, url, body) {
  const out = new Set();
  for (const v of [request.headers.get('X-Store-Id'), url?.searchParams?.get('store'), url?.searchParams?.get('store_id'), url?.searchParams?.get('storeId'), body?.storeId, body?.store_id]) {
    const s = String(v || '').trim();
    if (s) out.add(s);
  }
  return [...out];
}

// The guard itself: null = go ahead, else { feature, storeId } that is off.
export async function walledRequest(env, request, url, readRow, body = null) {
  const feature = featureForPath(url.pathname);
  if (!feature) return null;
  for (const storeId of requestStoreCandidates(request, url, body)) {
    if (isPlatformStore(storeId, env)) continue;
    const f = await storeFeatures(env, storeId, readRow);
    if (!f[feature]) return { feature, storeId };
  }
  return null;
}

// Stores a scheduled job may run a feature for.
export async function storesWithFeature(env, storeIds, feature, readRow) {
  const out = [];
  for (const id of storeIds) if ((await storeFeatures(env, id, readRow))[feature]) out.push(id);
  return out;
}
