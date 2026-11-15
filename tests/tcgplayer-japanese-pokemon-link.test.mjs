// A JAPANESE POKEMON TCGPLAYER LINK (store, 2026-11-15: pasting
// tcgplayer.com/product/575691/pokemon-japan-mystery-of-the-fossils-moltres?Language=all gave no image or prices).
// "all" was sent to the Pokemon tracker as the language; a miss there stopped before JustTCG; no picture fallback.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
const grab = sig => { const i = app.indexOf(sig); assert.ok(i >= 0, sig); let d = 0, j = app.indexOf('){', i) + 1; for (; j < app.length; j++) { if (app[j] === '{') d++; else if (app[j] === '}' && !--d) break; } return app.slice(i, j + 1); };
const names = ['tcgTitleCase', 'unwrapTcgplayerLink', 'tcgSlugToProductName', 'tcgLineFromText', 'tcgConditionCodeFromLabel', 'qplFinishFromTcgPrinting', 'normalizeQplFinish', 'qplCategoryKey', 'parseTcgplayerProductInput', 'tcgplayerProductImageUrl'];
const stubs = 'const qplCategoryKey = c => String(c||"").toLowerCase().includes("pokemon") ? "pokemon" : "";\n';
let fns;
fns = true; try { new Function(names.filter(n => n !== 'qplCategoryKey').map(n => grab('function ' + n + '(')).join('\n') + '\nreturn { parseTcgplayerProductInput, tcgplayerProductImageUrl };')(); }
catch (e) { throw e; }
if (fns) {
  try {
    const p = new Function('qplCategoryKey', names.filter(n => n !== 'qplCategoryKey').map(n => grab('function ' + n + '(')).join('\n') + '\nreturn parseTcgplayerProductInput;')(c => String(c || '').toLowerCase().includes('pokemon') ? 'pokemon' : '');
    const jp = p('https://www.tcgplayer.com/product/575691/pokemon-japan-mystery-of-the-fossils-moltres?Language=all&Condition=Lightly+Played&page=1', 'Pokemon TCG');
    assert.equal(jp.productId, '575691'); assert.equal(jp.language, 'Japanese', '"all" + a Japanese product = Japanese');
    assert.equal(p('https://www.tcgplayer.com/product/12345/pokemon-base-set-charizard?Language=all', 'Pokemon TCG').language, 'English');
    assert.equal(p('https://www.tcgplayer.com/product/12345/pokemon-base-set-charizard?Language=Japanese', 'Pokemon TCG').language, 'Japanese', 'a real language is kept');
  } catch (e) { throw e; }
}
assert.match(app, /language:\/\^\(english\|japanese\)\$\/i\.test\(language\) \? language : \(\/\\bjapan\(ese\)\?\\b\|-japan-\|\^japan-\/i\.test\(slug \+ ' ' \+ text\) \? 'Japanese' : 'English'\),/);
const exact = grab('async function resolveExactTcgplayerProduct(');
assert.ok(exact.includes("await fetchPokemonPriceTrackerExactDetail(product.productId, lang === 'japanese' ? 'english' : 'japanese')"), 'the other language is tried if the first misses');
assert.ok(exact.includes('if(pokemonProduct && product.isSealed) return null;') && !/if\(pokemonProduct\) return null;/.test(exact), 'a Pokemon card the tracker lacks goes on to JustTCG by its TCGplayer number');
assert.ok(exact.includes('if(!row.imageUrl)row.imageUrl=tcgplayerProductImageUrl(product.productId);'));
assert.ok(grab('function tcgplayerProductToQplRow(').includes('imageUrl:tcgplayerProductImageUrl(product.productId)'), 'the priceless placeholder still shows the card');
const img = new Function(grab('function tcgplayerProductImageUrl(') + '\nreturn tcgplayerProductImageUrl;')();
assert.equal(img('575691'), 'https://tcgplayer-cdn.tcgplayer.com/product/575691_in_1000x1000.jpg'); assert.equal(img('x'), '');
// (2026-11-15: $11.68 "Lightly Played / Normal" against a $25.20 LP chip) -- a link with no Printing picks the printing the card has.
{
  const qplPriceValue = v => Number(v?.price || 0);
  const normalizeQplFinish = f => /holo|foil/i.test(f) ? 'holofoil' : 'normal';
  const pick = new Function('qplPriceValue', 'normalizeQplFinish', grab('function exactLinkVariantDefaults(') + '\nreturn exactLinkVariantDefaults;')(qplPriceValue, normalizeQplFinish);
  const holo = [{ condition: 'NM', finish: 'Holofoil', language: 'Japanese', price: 36.03 }, { condition: 'LP', finish: 'Holofoil', language: 'Japanese', price: 25.2 }];
  assert.deepEqual(pick(holo, { condition: 'LP', finish: 'normal', printing: '', language: 'Japanese' }, { normal: null, foil: 36.03 }), { finish: 'Holofoil', language: 'Japanese' });
  assert.deepEqual(pick(holo, { condition: 'LP', finish: 'normal', printing: '', language: 'Japanese' }, null), { finish: 'Holofoil', language: 'Japanese' });
  const both = [{ condition: 'NM', finish: 'Normal', price: 2 }, { condition: 'NM', finish: 'Holofoil', price: 9 }];
  assert.equal(pick(both, { condition: 'NM', finish: 'normal', printing: '' }, { normal: 2, foil: 9 }).finish, 'Normal', 'a card in both keeps Normal');
  assert.equal(pick(both, { condition: 'NM', finish: 'holofoil', printing: 'Holofoil' }, null).finish, 'holofoil', 'the link\'s own printing wins');
  assert.equal(pick([{ condition: 'LP', finish: 'Holofoil', language: 'English', price: 5 }], { condition: 'LP', language: 'Japanese' }).language, 'English', 'the language its prices are under');
  assert.deepEqual(pick([], {}), {});
  assert.ok(grab('async function resolveExactTcgplayerProduct(').includes('justTcgExactMatchToQplRow(match,{...product,...exactLinkVariantDefaults(match.availableVariants,product,markets)})'));
}
console.log('Japanese Pokemon TCGplayer link: passed');

// ENGLISH / JAPANESE switch (2026-11-15: "I should be able to switch languages in the app to get the prices of the other languages").
{
  const html = fs.readFileSync('dashboard.html', 'utf8');
  assert.ok(html.includes('id="qpl-lang-btn"') && html.includes('onclick="toggleQplLanguage()"'), 'LANG beside the search box');
  const lib = new Function(['qplReadableSet', 'qplRowIsJapanese', 'qplOtherLanguageSet', 'qplOtherLanguageQuery', 'qplSearchIsJapanese'].map(n => grab('function ' + n + '(')).join('\n')
    + '\n' + app.slice(app.indexOf('const QPL_SET_PAIRS'), app.indexOf('function qplOtherLanguageSet('))
    + '\nlet qplLanguageMode = "auto", qplLanguageOnce = null;\nreturn { qplRowIsJapanese, qplOtherLanguageQuery, qplReadableSet, qplSearchIsJapanese, set: (m, o) => { qplLanguageMode = m; qplLanguageOnce = o; } };')();
  const { qplRowIsJapanese, qplOtherLanguageQuery, qplReadableSet, qplSearchIsJapanese } = lib;
  assert.equal(qplRowIsJapanese({ name: 'Japan Mystery Of The Fossils Moltres' }), true);
  assert.equal(qplRowIsJapanese({ name: 'Moltres', language: 'English' }), false);
  assert.equal(qplRowIsJapanese({ name: 'Moltres', language: 'Japanese' }), true);
  assert.equal(qplOtherLanguageQuery({ name: 'Japan Mystery Of The Fossils Moltres', set: 'Japan Mystery of the Fossils' }), 'Moltres fossil', 'the old sets carry over by their English name');
  assert.equal(qplOtherLanguageQuery({ name: 'Moltres', set: 'mystery-of-the-fossils-pokemon-japan', language: 'Japanese' }), 'Moltres fossil');
  assert.equal(qplOtherLanguageQuery({ name: 'Moltres', set: 'Fossil', language: 'English' }), 'Moltres mystery of the fossils');
  assert.equal(qplOtherLanguageQuery({ name: 'Charizard ex', set: 'Obsidian Flames' }), 'Charizard ex', 'newer sets: just the card');
  assert.equal(qplReadableSet('mystery-of-the-fossils-pokemon-japan'), 'Mystery Of The Fossils Pokemon Japan');
  assert.equal(qplReadableSet('Obsidian Flames'), 'Obsidian Flames');
  // LANG decides; a one-time SEE ... PRICE wins for its own search only and leaves LANG alone.
  lib.set('auto', null); assert.equal(qplSearchIsJapanese('moltres japanese'), true); assert.equal(qplSearchIsJapanese('moltres'), false);
  lib.set('japanese', null); assert.equal(qplSearchIsJapanese('moltres'), true);
  lib.set('japanese', { lang: 'english', q: 'Moltres fossil' }); assert.equal(qplSearchIsJapanese('moltres  fossil'), false); assert.equal(qplSearchIsJapanese('moltres fossil'), true, 'used once');
  lib.set('auto', { lang: 'japanese', q: 'Moltres' }); assert.equal(qplSearchIsJapanese('pikachu'), false, 'a different search ignores it');
  assert.ok(app.includes('const isJapanese = qplSearchIsJapanese(q);'), 'the switch decides the Pokemon search language');
  assert.ok(app.includes('${qplLanguageChip(r, idx)}') && app.includes("'SEE ENGLISH PRICE' : 'SEE JAPANESE PRICE'"));
  assert.ok(!app.includes("localStorage.setItem('qpl_pokemon_language'"), 'not saved on the phone any more -- it got stuck');
  const other = grab('function qplOtherLanguage(');
  assert.ok(!other.includes('setQplLanguage(') && other.includes('runPriceLookup()'), 'SEE ... PRICE leaves LANG alone');
  assert.ok(grab('function setQplLanguage(').includes('if(qplInputIsLink(v))'), 'a pasted link is not re-run');
  console.log('EN / JP switch: passed');
}
