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
console.log('Japanese Pokemon TCGplayer link: passed');

// ENGLISH / JAPANESE switch (2026-11-15: "I should be able to switch languages in the app to get the prices of the other languages").
{
  const html = fs.readFileSync('dashboard.html', 'utf8');
  assert.ok(html.includes('id="qpl-lang-btn"') && html.includes('onclick="toggleQplLanguage()"'), 'LANG beside the search box');
  const { qplRowIsJapanese, qplOtherLanguageQuery } = new Function(grab('function qplRowIsJapanese(') + '\n' + grab('function qplOtherLanguageQuery(') + '\nreturn { qplRowIsJapanese, qplOtherLanguageQuery };')();
  assert.equal(qplRowIsJapanese({ name: 'Japan Mystery Of The Fossils Moltres' }), true);
  assert.equal(qplRowIsJapanese({ name: 'Moltres', language: 'English' }), false);
  assert.equal(qplRowIsJapanese({ name: 'Moltres', language: 'Japanese' }), true);
  assert.equal(qplOtherLanguageQuery({ name: 'Japan Mystery Of The Fossils Moltres', set: 'Japan Mystery of the Fossils' }), 'Moltres', 'just the card, for the other language');
  assert.equal(qplOtherLanguageQuery({ name: 'Charizard ex', set: 'Obsidian Flames' }), 'Charizard ex');
  assert.ok(app.includes("const isJapanese = qplLanguageMode === 'japanese' || (qplLanguageMode !== 'english' && /\\bjapanese?\\b|\\bjpn\\b/i.test(q));"), 'the switch decides the Pokemon search language');
  assert.ok(app.includes('${qplLanguageChip(r, idx)}') && app.includes("'SEE ENGLISH PRICE' : 'SEE JAPANESE PRICE'"));
  assert.ok(app.includes("localStorage.setItem('qpl_pokemon_language', qplLanguageMode)"), 'kept on the device');
  console.log('EN / JP switch: passed');
}
