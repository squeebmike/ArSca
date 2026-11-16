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
// (2026-11-16: "NM LP aren't a thing. Don't they do loose, complete in box CIB, new in box NIB?" / "some images don't show")
{
  const s = app.indexOf('const QPL_GAME_CONDITIONS'), e = app.indexOf('function qplConditionOptionsFor(');
  const lib = new Function(app.slice(s, e) + '\nreturn { qplVideoGamePrice, applyQplVideoGameCondition, qplVideoGameChipsHtml, QPL_GAME_CONDITIONS };')();
  const game = { source: 'PriceCharting', pricecharting: { prices: { ungraded: 85, grade7: 160, grade8: 400, grade9: 0, grade9_5: 12, psa10: 0 } } };
  assert.deepEqual(lib.QPL_GAME_CONDITIONS.map(c => c[0]), ['Loose', 'CIB', 'New', 'Graded', 'Box Only', 'Manual Only']);
  lib.applyQplVideoGameCondition(game, 'Loose'); assert.equal(game.market, 85); assert.equal(game.condition, 'Loose');
  lib.applyQplVideoGameCondition(game, 'CIB'); assert.equal(game.market, 160); assert.match(game.priceSource, /CIB/);
  lib.applyQplVideoGameCondition(game, 'NM'); assert.equal(game.condition, 'Loose', 'no NM for a game');
  const chips = lib.qplVideoGameChipsHtml(game, 0);
  assert.ok(chips.includes('LOOSE') && chips.includes('CIB') && chips.includes('NEW') && chips.includes('BOX ONLY') && !chips.includes('MANUAL ONLY') && !chips.includes('>NM<'), 'Loose/CIB/New always, others only with a price');
  assert.ok(app.includes("if(r.source === 'PriceCharting' && qplResultCategoryKey(r) === 'video_games') return qplVideoGameChipsHtml(r, idx);"), 'chips');
  assert.ok(app.includes("if(r.source === 'PriceCharting' && qplResultCategoryKey(r) === 'video_games') { applyQplVideoGameCondition(r, r.selectedCondition);"), 'picking a condition reprices');
  assert.ok(app.includes("row.category = 'Video Games';\n    applyQplVideoGameCondition(row, 'Loose');"), 'saved under Video Games, Loose to start');
  assert.ok(app.includes('const QPL_PC_IMAGE_LIMIT = 8;') && app.includes('.slice(0,QPL_PC_IMAGE_LIMIT);'), 'more pictures filled in');
  console.log('Video game conditions: passed');
}
// Store BUY / SELL for the condition picked, UPC, release date, genre and sales on a game's card.
{
  const s = app.indexOf('function qplVideoGameFactsHtml('), e = app.indexOf('function qplVideoGameChipsHtml(');
  const facts = new Function('qplResultCategoryKey', 'escHtml', app.slice(s, e) + '\nreturn qplVideoGameFactsHtml;')(() => 'video_games', x => String(x));
  const game = { source: 'PriceCharting', selectedCondition: 'CIB', pricecharting: { retail: { looseBuy: 40, looseSell: 95, cibBuy: 80, cibSell: 175 }, demand: { upc: '045496740613', releaseDate: '2010-03-14', genre: 'RPG', salesVolume: 212 } } };
  const html = facts(game);
  for (const t of ['STORE BUY CIB $80.00', 'STORE SELL $175.00', 'UPC 045496740613', 'Released 2010-03-14', 'RPG', '212 sold']) assert.ok(html.includes(t), t);
  assert.equal(facts({ source: 'scryfall' }), '');
  assert.ok(app.includes('${qplVideoGameFactsHtml(r)}'), 'on the card');
  console.log('Video game facts on the card: passed');
}
