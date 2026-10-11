import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store report: "On another device I saw older prices for NM. Nothing loaded
// for the other conditions and the price was old." A device's saved copy of
// a card was restamped "now" every time it was loaded or re-saved, so a
// weeks-old NM-only price looked fresh and never refreshed. Cards now carry
// when they were really fetched; old saved prices say so and refresh when
// the device is online.
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const extractFn = (name, prefix = 'function ') => { const s = dashboard.indexOf(prefix + name + '('); assert.ok(s >= 0, name); return dashboard.slice(s, dashboard.indexOf('\n}\n', s) + 2); };
const api = new Function('pokemonPriceTrackerCardsFromPayload', [
  extractFn('pokemonCacheAgeLabel'), extractFn('pokemonCardFetchedAt'), extractFn('pokemonPriceCacheFresh'),
  extractFn('pokemonQplPriceAgeState'), extractFn('pokemonPriceTrackerResult'),
  'return { pokemonCardFetchedAt, pokemonPriceCacheFresh, pokemonQplPriceAgeState, pokemonPriceTrackerResult };',
].join('\n'))(data => data.cards || []);

const hoursAgo = h => new Date(Date.now() - h * 3600e3).toISOString();

// The worker's cache hands back the original fetch time; cards keep it.
{
  const r = api.pokemonPriceTrackerResult({ cards:[{ name:'Treecko' }], cache:{ state:'stale', cachedAt:hoursAgo(24 * 9) } }, '/x', 'cards');
  assert.equal(r.cacheStatus, 'stale');
  assert.equal(r.cards[0].fetchedAt, r.fetchedAt);
  assert.equal(api.pokemonPriceCacheFresh(r.cards[0]), false, '9-day-old worker copy is not fresh');
  const live = api.pokemonPriceTrackerResult({ cards:[{ name:'Treecko' }], cache:{ state:'miss' } }, '/x', 'cards');
  assert.equal(api.pokemonPriceCacheFresh(live.cards[0]), true);
}
// The fetch time wins over anything stamped on the saved copy later.
assert.equal(api.pokemonPriceCacheFresh({ fetchedAt:hoursAgo(72), cache:{ updatedAt:hoursAgo(0) } }), false);
assert.equal(api.pokemonCardFetchedAt({ prices:{ lastUpdated:'2026-10-01T00:00:00Z' } }), '2026-10-01T00:00:00Z', 'older saved copies fall back to the provider date');

// Badges: live says LIVE; a saved copy says SAVED with its real day.
{
  assert.equal(api.pokemonQplPriceAgeState({ cache:{ state:'live', updatedAt:hoursAgo(0) } }).label, 'LIVE');
  const fresh = api.pokemonQplPriceAgeState({ cache:{ state:'cached', updatedAt:hoursAgo(3) } });
  assert.equal(fresh.fresh, true); assert.equal(fresh.label, 'SAVED · 3h ago');
  const old = api.pokemonQplPriceAgeState({ cache:{ state:'cached', updatedAt:hoursAgo(1) }, pokemonPriceTracker:{ fetchedAt:'2026-10-03T18:00:00Z', lookupDebug:{ hydratedFromCache:true } } });
  assert.equal(old.fresh, false);
  assert.match(old.label, /^SAVED PRICE · Oct 3 -- tap REFRESH$/);
  assert.match(api.pokemonQplPriceAgeState({ cache:{ state:'cached' } }).label, /date unknown -- tap REFRESH/);
  assert.equal(api.pokemonQplPriceAgeState({}), null);
}

// Saving a copy keeps its fetch time instead of stamping "now" on the price.
assert.doesNotMatch(extractFn('applyResolvedPokemonCardToRow', 'async function '), /state:'cached', updatedAt:new Date\(\)/);
assert.match(extractFn('pokemonPriceTrackerCardToQplRow'), /updatedAt:pokemonCardFetchedAt\(card\)/);
// A saved full price ladder only skips the refresh while it's fresh.
assert.match(extractFn('hydratePokemonPriceTrackerPricing', 'async function '), /exactHydrated && \(pokemonPriceCacheFresh\(row\.pokemonPriceTracker\) \|\| !navigator\.onLine \|\| pokemonPriceTrackerQuotaBlocked\(\)\)/);
assert.match(extractFn('hydrateVisiblePokemonPriceTrackerResults'), /!\(r\.pokemonPriceTracker\?\.lookupDebug\?\.exactHydrated && pokemonPriceCacheFresh\(r\.pokemonPriceTracker\)\)/);
console.log('Pokemon saved-price age checks passed');
