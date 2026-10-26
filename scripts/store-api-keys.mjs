// Per-store pricing API keys (second-store pilot, 2026-10-26). A store
// other than The Mana Pocket prices on its own PokemonPriceTracker,
// PriceCharting and JustTCG keys, entered in Settings -> PRICING APIS. Keys
// are kept encrypted (AES-GCM) in store_api_keys, readable only by the
// Worker, and never sent back to a browser -- only their last 4 characters.
// For each request naming such a store, the Worker swaps that store's keys
// into env (blank where it has none), so every lookup uses them and nothing
// falls back to The Mana Pocket's. Table:
// supabase-migrations/2026-10-26-store-api-keys.sql.

export const KEY_PROVIDERS = Object.freeze({
  pokemonprice: { label: 'PokemonPriceTracker', envKeys: ['POKEMONPRICE_API_KEY', 'POKEMON_PRICE_TRACKER_API_KEY'] },
  pricecharting: { label: 'PriceCharting', envKeys: ['PRICECHARTING_TOKEN', 'PRICECHARTING_API_KEY'] },
  justtcg: { label: 'JustTCG', envKeys: ['JUSTTCG_API_KEY'] },
});

export function cleanApiKey(value) {
  const key = String(value ?? '').trim();
  if (!key) return '';
  if (key.length < 8 || key.length > 300 || /\s/.test(key)) return null; // not a key
  return key;
}
export function lastFour(key) { return String(key || '').slice(-4); }

const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
async function cipherKey(env) {
  const secret = env.STORE_KEYS_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  if (!secret) throw new Error('No secret to protect store API keys with');
  const base = await crypto.subtle.importKey('raw', enc.encode(String(secret)), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('arsca-store-api-keys'), info: enc.encode('v1') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function sealApiKey(env, plain, storeId, provider) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(storeId + ':' + provider) }, await cipherKey(env), enc.encode(plain));
  return 'v1:' + b64(iv) + ':' + b64(ct);
}
export async function openApiKey(env, sealed, storeId, provider) {
  const [v, iv, ct] = String(sealed || '').split(':');
  if (v !== 'v1' || !iv || !ct) return '';
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: enc.encode(storeId + ':' + provider) }, await cipherKey(env), unb64(ct));
    return dec.decode(pt);
  } catch (_) { return ''; } // a different secret, or tampered: treated as no key
}

const CACHE_MS = 60 * 1000;
const cache = new Map();
export function clearStoreKeyCache(storeId) { if (storeId) cache.delete(String(storeId)); else cache.clear(); }

// readRows(storeId) -> [{ provider, ciphertext }]; a failed read = no keys.
export async function storeApiKeys(env, storeId, readRows, now = Date.now()) {
  const id = String(storeId || '');
  const hit = cache.get(id);
  if (hit && now - hit.at < CACHE_MS) return { ...hit.keys };
  const keys = {};
  let rows = [];
  try { rows = (await readRows(id)) || []; } catch (_) { return {}; }
  for (const row of rows) {
    if (!KEY_PROVIDERS[row.provider]) continue;
    const plain = await openApiKey(env, row.ciphertext, id, row.provider);
    if (plain) keys[row.provider] = plain;
  }
  cache.set(id, { at: now, keys });
  return { ...keys };
}

// env with the store's own keys in place of The Mana Pocket's. STORE_KEYS_OWNER
// marks it, so per-key state (PPT's out-of-credits pause) is kept per store.
export function envWithStoreKeys(env, storeId, keys = {}) {
  const out = { ...env, STORE_KEYS_OWNER: storeId };
  for (const [provider, spec] of Object.entries(KEY_PROVIDERS)) for (const name of spec.envKeys) out[name] = keys[provider] || '';
  return out;
}
