import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Store report: "Out of credits" -- Research's Pokemon search failed with
// "Lookup failed: Daily rate limit exceeded" once PokemonPriceTracker's
// daily quota ran out. It now falls back to the free TCGdex catalog for the
// card itself (name, set, number, image), with the price marked unavailable.
const app = fs.readFileSync('dashboard.html', 'utf8');
const fn = name => { const s = app.indexOf('function ' + name + '('); assert.ok(s >= 0, name); const start = app.slice(Math.max(0, s - 6), s) === 'async ' ? s - 6 : s; return app.slice(start, app.indexOf('\n}\n', s) + 2); };

const calls = [];
const ctx = { calls, storeWorkerFetch: async (path) => { calls.push(path); return new Response(JSON.stringify({ ok:true, cards:[{ game:'pokemon', name:'Bulbasaur', set:'Stellar Crown', number:'143', imageUrl:'https://assets.tcgdex.net/en/sv/sv07/143/high.png' }] })); }, Response, encodeURIComponent };
vm.runInNewContext([fn('freeCatalogToQplRow'), fn('pokemonFreeCatalogFallback'), 'this.api = { pokemonFreeCatalogFallback };'].join('\n'), ctx);
const rows = await ctx.api.pokemonFreeCatalogFallback('143/142');
assert.equal(calls[0], '/card-compare/search?game=pokemon&q=143%2F142', 'the free catalog, not PokemonPriceTracker');
assert.equal(rows.length, 1);
const r = rows[0];
assert.equal(r.name, 'Bulbasaur'); assert.equal(r.category, 'Pokemon TCG'); assert.equal(r.set, 'Stellar Crown'); assert.equal(r.card_number, '143');
assert.equal(r.imageUrl, 'https://assets.tcgdex.net/en/sv/sv07/143/high.png');
assert.equal(r.market, 0); assert.equal(r.priceUnavailable, true);
assert.match(r.priceSource, /price unavailable today/);
assert.equal((await ctx.api.pokemonFreeCatalogFallback('  ')).length, 0, 'nothing to search');

// Wired into the lookup's failure path for Pokemon searches.
const inner = fn('_runPriceLookupInner');
assert.match(inner, /if\(wantsPokemon && !cachedResults\.length\)\{\s*const free = await pokemonFreeCatalogFallback\(q\)\.catch\(\(\) => \[\]\);/);
assert.match(inner, /Pokémon prices are unavailable right now/);
assert.ok(inner.indexOf('pokemonFreeCatalogFallback(q)') < inner.indexOf('Lookup failed: '), 'tries the free catalog before showing Lookup failed');
console.log('Pokemon free catalog fallback checks passed');
