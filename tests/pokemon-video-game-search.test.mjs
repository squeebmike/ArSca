// (store, 2026-11-16: "Searching for video games doesn't work" -- "Pokemon heartgold" on GAMES said "no Video Games
// results", on ALL it showed 3 Pokemon cards.) A search starting with "Pokemon" went to the Pokemon card source, which
// answers alone, so PriceCharting (where the games are) was never asked.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
const start = app.indexOf('const POKEMON_GAME_TITLE_RE'), end = app.indexOf('const QPL_NON_CARD_CATEGORIES');
const isPokemonVideoGameQuery = new Function(app.slice(start, end) + '\nreturn isPokemonVideoGameQuery;')();
for (const q of ['Pokemon heartgold', 'pokemon soul silver', 'Pokemon FireRed', 'pokemon red version', 'Pokemon Stadium', 'pokemon snap n64', 'Pokemon Emerald GBA', 'pokemon crystal game boy color', 'pokemon sword switch', "Pokemon Let's Go Pikachu", 'Pokémon HeartGold'])
  assert.equal(isPokemonVideoGameQuery(q), true, q);
for (const q of ['charizard', 'pokemon charizard', 'pokemon 151 booster box', 'pokemon surging sparks', 'pikachu 25/102', 'mario kart'])
  assert.equal(isPokemonVideoGameQuery(q), false, q);
const fn = app.slice(app.indexOf('async function searchQuickCatalog('), app.indexOf('async function searchQuickCatalog(') + 20000);
assert.ok(fn.includes("if(!qplCategoryKey(cat) && isPokemonVideoGameQuery(q)) {") && fn.includes("searchQuickCatalog(q, 'Video Games'") && fn.includes('return [...games, ...cards];'), 'ALL: the games, then the cards');
assert.ok(fn.includes("const nonCardWanted = QPL_NON_CARD_CATEGORIES.includes(wants);"));
assert.ok(fn.includes("if(!nonCardWanted && (plannedCategories.has('pokemon') || pokemonSealedIntent || isPokemonLookupIntent(q, cat))) {"), 'GAMES skips the Pokemon card source');
assert.ok(fn.includes("const pokemonOnly = !nonCardWanted && ("), '...and still asks PriceCharting');
assert.ok(fn.includes("if(!nonCardWanted && (wants === 'mtg' ||") && fn.includes("if(!nonCardWanted && (wants === 'comic' ||"));
console.log('Pokemon video game search: passed');
// (2026-11-16, after the first fix: "Still doesn't show it".) The category went to PriceCharting as a console name;
// "Video Games" isn't one, so games search without it, and any other category that comes back empty is asked again without it.
{
  const pc = app.slice(app.indexOf('async function fetchPriceChartingLiveCatalog('), app.indexOf('function buildQplVariantsFromPrices('));
  assert.ok(pc.includes("const sendCategory = pcCat && effectiveCategory !== 'video_games' ? pcCat : '';"), 'games: no console filter');
  assert.ok(pc.includes("if(!rows.length && sendCategory && queries[0]) await pcSearch(queries[0], '');"), 'empty: once more without it');
  assert.ok(pc.includes("csvCategory:pcCat || ''"), 'results still sorted as games');
  console.log('PriceCharting game search without a console filter: passed');
}
