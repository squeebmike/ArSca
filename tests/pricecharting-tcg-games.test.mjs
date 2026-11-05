// Crull001, 2026-11-05: "Use my pricecharting ... His video games should
// connect to pricecharting" -- the daily PriceCharting update also prices
// video games and trading cards nothing free can price (graded, or not
// linked to TCGplayer); his store may use The Mana Pocket's PriceCharting key.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncKind, gameGuidePrice, planRow, nextBatch } from '../scripts/pricecharting-daily-sync.mjs';
import { envWithStoreKeys, envWithSharedPriceChartingKey, envWithSharedPokemonKey } from '../scripts/store-api-keys.mjs';
import { featuresFromRow, PILOT_DEFAULTS } from '../scripts/store-features.mjs';

const r = data => ({ id: 'x', status: 'in_stock', data });
assert.equal(syncKind(r({ category: 'Video Games' })), 'game');
assert.equal(syncKind(r({ category: 'Pokemon TCG', tcgPlayerId: '5' })), '', 'TCGplayer-linked raw cards stay on the free/PPT updates');
assert.equal(syncKind(r({ category: 'Pokemon TCG', tcgPlayerId: '5', grader: 'PSA', grade: '9' })), 'tcg', 'slabs price from the graded guide');
assert.equal(syncKind(r({ category: 'Magic: The Gathering' })), 'tcg');
assert.equal(syncKind(r({ category: 'Comic' })), 'comic');

const product = { productId: '5490', prices: { ungraded: 20, grade7: 32.97, grade8: 90, grade9: 150, psa10: 400 } };
assert.equal(gameGuidePrice({ configuration: 'Complete in Box' }, product).price, 32.97);
assert.equal(gameGuidePrice({ configuration: 'Loose' }, product).price, 20);
assert.equal(gameGuidePrice({ condition: 'New' }, product).price, 90);
const game = planRow(r({ category: 'Video Games', configuration: 'Complete in Box', price: 32.5, marketPrice: 32.5, pricechartingProductId: '5490' }), 'game', product);
assert.equal(game.kind, 'applied'); assert.equal(game.data.marketPrice, 32.97);
const slab = planRow(r({ category: 'Pokemon TCG', grader: 'PSA', grade: '10', marketPrice: 380, pricechartingProductId: '1' }), 'tcg', product);
assert.equal(slab.data.marketPrice, 400, 'PSA 10 guide');
assert.equal(planRow(r({ category: 'Pokemon TCG', grader: 'PSA', grade: '10', marketPrice: 100 }), 'tcg', product).kind, 'review', 'a big jump waits for review');
// Picked only with a saved PriceCharting product (no title searches for cards).
assert.equal(nextBatch([r({ category: 'Pokemon TCG' }), r({ category: 'Pokemon TCG', pricechartingProductId: '9' })]).length, 1);

// Sharing: only the PriceCharting key; his own wins once he adds one.
const env = { POKEMONPRICE_API_KEY: 'ppt', PRICECHARTING_TOKEN: 'pc', PRICECHARTING_API_KEY: 'pc', JUSTTCG_API_KEY: 'jt' };
const storeEnv = envWithStoreKeys(env, 's', {});
const shared = envWithSharedPriceChartingKey(env, storeEnv, {});
assert.equal(shared.PRICECHARTING_TOKEN, 'pc'); assert.equal(shared.POKEMONPRICE_API_KEY, ''); assert.equal(shared.JUSTTCG_API_KEY, '');
assert.equal(envWithSharedPriceChartingKey(env, envWithStoreKeys(env, 's', { pricecharting: 'his' }), { pricecharting: 'his' }).PRICECHARTING_TOKEN, 'his');
const both = envWithSharedPriceChartingKey(env, envWithSharedPokemonKey(env, storeEnv, {}), {});
assert.equal(both.PRICECHARTING_TOKEN, 'pc'); assert.equal(both.POKEMONPRICE_API_KEY, 'ppt'); assert.equal(both.JUSTTCG_API_KEY, '');
assert.equal(PILOT_DEFAULTS.sharedPriceChartingKey, false);
assert.equal(featuresFromRow({ shared_pricecharting_key: true }).sharedPriceChartingKey, true);
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.match(worker, /return features\.sharedPriceChartingKey \? envWithSharedPriceChartingKey\(env, withPpt, own\) : withPpt;/);
assert.match(fs.readFileSync('supabase-migrations/2026-11-05-store-features-shared-pricecharting-key.sql', 'utf8'), /shared_pricecharting_key boolean not null default false/);
console.log('PriceCharting: video games + unlinked/graded trading cards; shared key only');

// 2026-11-05: 429s. The pause no longer equals the hourly run; slow kinds every 3 days.
{
  const { pausePcMs, PC_429_PAUSE_MS } = await import('../scripts/reference-price-refresh.mjs');
  const { dueForCheck } = await import('../scripts/pricecharting-daily-sync.mjs');
  const res = (status, ra) => ({ status, headers: { get: k => k === 'Retry-After' ? ra ?? null : null } });
  assert.equal(pausePcMs(res(429)), PC_429_PAUSE_MS); assert.ok(PC_429_PAUSE_MS < 55 * 60000, 'shorter than the hourly run');
  assert.equal(pausePcMs(res(429, '120')), 5 * 60000, 'Retry-After, at least 5 min');
  assert.equal(pausePcMs(res(429, '1200')), 20 * 60000);
  assert.equal(pausePcMs(res(429, '99999')), 50 * 60000, 'at most 50 min');
  assert.equal(pausePcMs(res(403)), 3600000); assert.equal(pausePcMs(res(500)), 60000);
  const now = Date.parse('2026-11-05T12:00:00Z');
  assert.equal(dueForCheck('comic', { priceSyncCheckedAt: '2026-11-04T12:00:00Z' }, now), true, 'comics daily');
  assert.equal(dueForCheck('tcg', { priceSyncCheckedAt: '2026-11-04T12:00:00Z' }, now), false, 'cards every 3 days');
  assert.equal(dueForCheck('tcg', { priceSyncCheckedAt: '2026-11-02T13:00:00Z' }, now), true);
  assert.equal(dueForCheck('game', {}, now), true);
}
console.log('PriceCharting 429 pause + every-3-days for cards/games');
