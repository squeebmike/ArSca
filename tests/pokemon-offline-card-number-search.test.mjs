import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// searchPokemonCatalogExport() -- the offline Pokemon catalog search used
// by the Research/lookup tab while offline -- required the literal query
// token (e.g. "143/142", denominator included) to appear verbatim inside a
// card's searchText. But PPT's export only ever stores the bare numerator
// ("143") in cardNumber, never "143/142", so that substring never exists
// anywhere in the offline catalog. pokemonCardNumberMatches() already knows
// "143" satisfies a "143/142" query, but it was only ever used to EXCLUDE
// non-matching rows, not to independently qualify a match -- so a
// number-only search (exactly how a dealer types a card off the sleeve)
// matched zero rows offline, no exceptions, even though the card was right
// there in the synced catalog and shows fine in Inventory.

const fnStart = dashboard.indexOf('async function searchPokemonCatalogExport(query){');
assert(fnStart >= 0, 'searchPokemonCatalogExport must exist');
const fnEnd = dashboard.indexOf('\n\n\nasync function searchPokemonSealedCatalogLocal', fnStart);
assert(fnEnd > fnStart, 'could not bound searchPokemonCatalogExport source');
const fn = dashboard.slice(fnStart, fnEnd);

assert.match(fn, /\.filter\(t => !queryNumberNormalized \|\| t !== queryNumberNormalized\)/,
  'the query-number token must be dropped from the literal-substring terms -- it is already validated via pokemonCardNumberMatches below, not required to also survive a raw substring check that can never pass');
assert.match(fn, /if\(queryNumber && !pokemonCardNumberMatches\(r, queryNumber\)\) return false;/,
  'a row with no stored number at all must be excluded when the query specifies one (removing the old "r.cardNumber &&" gate closes that hole too)');
assert.doesNotMatch(fn, /r\.cardNumber && !pokemonCardNumberMatches/,
  'must not reintroduce the old gate that let numberless rows skip the number check entirely');

// ── Functional check: run the actual fix logic against a fake catalog row
// whose cardNumber is the bare numerator only (PPT's real export shape),
// and confirm a "143/142" query still finds it.
const queryNumberFnStart = dashboard.indexOf('function pokemonQueryCardNumber(query = \'\'){');
const queryNumberFnEnd = dashboard.indexOf('\n}\n\nfunction pokemonCardNumberMatches', queryNumberFnStart);
const cardNumberMatchesFnStart = dashboard.indexOf('function pokemonCardNumberMatches(card = {}, queryNumber = \'\'){');
const cardNumberMatchesFnEnd = dashboard.indexOf('\n}\n\nfunction pokemonRankApiCards', cardNumberMatchesFnStart);
const normalizeFnStart = dashboard.indexOf('function normalizePokemonText(value = \'\'){');
const normalizeFnEnd = dashboard.indexOf('\n}\n\nfunction pokemonQueryCardNumber', normalizeFnStart);

const helperSrc = [
  dashboard.slice(normalizeFnStart, normalizeFnEnd) + '\n}',
  dashboard.slice(queryNumberFnStart, queryNumberFnEnd) + '\n}',
  dashboard.slice(cardNumberMatchesFnStart, cardNumberMatchesFnEnd) + '\n}',
].join('\n');

const rows = [
  { cardNumber: '143', searchText: 'rainbow rare charizard vmax sword shield 143 secret rare' },
  { cardNumber: '12', searchText: 'pikachu base set 12 rare' },
];

const filterLogic = `
${helperSrc}
function isPokemonLookupIntent(){ return true; }
function runFilter(query){
  const queryNumber = pokemonQueryCardNumber(query);
  const queryNumberNormalized = queryNumber ? normalizePokemonText(queryNumber) : '';
  const terms = normalizePokemonText(query).split(/\\s+/).filter(Boolean)
    .filter(t => !queryNumberNormalized || t !== queryNumberNormalized);
  return rows.filter(r => {
    if(!r.searchText) return false;
    if(queryNumber && !pokemonCardNumberMatches(r, queryNumber)) return false;
    return terms.every(t => r.searchText.includes(t));
  });
}
return runFilter;
`;
const runFilter = new Function('rows', filterLogic)(rows);

const numberOnlyMatches = runFilter('143/142');
assert.equal(numberOnlyMatches.length, 1, 'a bare "143/142" query must match the card whose stored cardNumber is just "143"');
assert.equal(numberOnlyMatches[0].cardNumber, '143');

const wrongNumberMatches = runFilter('99/142');
assert.equal(wrongNumberMatches.length, 0, 'a number that matches no card must still return zero results');

console.log('Pokemon offline card-number search checks passed');
