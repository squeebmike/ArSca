// Crull001 (2026-11-05): "He can use mine [PokemonPriceTracker] until I have
// issues" -- only that key; PriceCharting, JustTCG, SportsCardsPro stay his.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { envWithStoreKeys, envWithSharedPokemonKey } from '../scripts/store-api-keys.mjs';
import { featuresFromRow, PILOT_DEFAULTS, storeFeatures } from '../scripts/store-features.mjs';

const env = { POKEMONPRICE_API_KEY: 'ppt-mine', POKEMON_PRICE_TRACKER_API_KEY: 'ppt-mine', PRICECHARTING_TOKEN: 'pc-mine', PRICECHARTING_API_KEY: 'pc-mine', JUSTTCG_API_KEY: 'jt-mine', OTHER: 'x' };
const his = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const storeEnv = envWithStoreKeys(env, his, {});
const shared = envWithSharedPokemonKey(env, storeEnv, {});
assert.equal(shared.POKEMONPRICE_API_KEY, 'ppt-mine'); assert.equal(shared.POKEMON_PRICE_TRACKER_API_KEY, 'ppt-mine');
assert.equal(shared.PRICECHARTING_TOKEN, ''); assert.equal(shared.PRICECHARTING_API_KEY, ''); assert.equal(shared.JUSTTCG_API_KEY, '');
assert.equal(shared.STORE_KEYS_OWNER, his); assert.equal(shared.PPT_SHARED_FROM_PLATFORM, '1');
// His own key, once added, wins.
const ownEnv = envWithStoreKeys(env, his, { pokemonprice: 'ppt-his' });
assert.equal(envWithSharedPokemonKey(env, ownEnv, { pokemonprice: 'ppt-his' }).POKEMONPRICE_API_KEY, 'ppt-his');
// Off unless turned on.
assert.equal(PILOT_DEFAULTS.sharedPokemonKey, false);
assert.equal(featuresFromRow({ shared_pokemon_key: true }).sharedPokemonKey, true);
assert.equal(featuresFromRow({ shared_pokemon_key: true }).sharedPricingKeys, false);
assert.equal((await storeFeatures({}, '0f9dd4bc-42a7-487e-a972-2905d24513e9', () => { throw new Error('never read'); })).sharedPokemonKey, true, 'The Mana Pocket: everything, never looked up');

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.match(worker, /const withPpt = features\.sharedPokemonKey \? envWithSharedPokemonKey\(env, storeEnv, own\) : storeEnv;/);
// A pause on the shared key pauses the shared key (yours), not a separate copy.
assert.match(worker, /function pptScope\(env\) \{ return env\.STORE_KEYS_OWNER && !env\.PPT_SHARED_FROM_PLATFORM \? ':' \+ env\.STORE_KEYS_OWNER : ''; \}/);
assert.doesNotMatch(worker, /'ppt_(?:daily_quota_exhausted_until_v3|rate_limited_until_v2)' \+ \(env\.STORE_KEYS_OWNER/);
assert.match(fs.readFileSync('supabase-migrations/2026-11-05-store-features-shared-pokemon-key.sql', 'utf8'), /add column if not exists shared_pokemon_key boolean not null default false/);
console.log('shared PokemonPriceTracker key: only that key, off by default, own key wins');
