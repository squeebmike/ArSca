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

const fnStart = dashboard.indexOf('async function searchPokemonCatalogExport(query, cat = \'\'){');
assert(fnStart >= 0, 'searchPokemonCatalogExport must exist and accept the caller\'s category');
const fnEnd = dashboard.indexOf('\n\n\nasync function searchPokemonSealedCatalogLocal', fnStart);
assert(fnEnd > fnStart, 'could not bound searchPokemonCatalogExport source');
const fn = dashboard.slice(fnStart, fnEnd);

assert.match(fn, /\.filter\(t => !queryNumberNormalized \|\| t !== queryNumberNormalized\)/,
  'the query-number token must be dropped from the literal-substring terms -- it is already validated via pokemonCardNumberMatches below, not required to also survive a raw substring check that can never pass');
assert.match(fn, /if\(queryNumber && !pokemonCardNumberMatches\(r, queryNumber\)\) return false;/,
  'a row with no stored number at all must be excluded when the query specifies one (removing the old "r.cardNumber &&" gate closes that hole too)');
assert.doesNotMatch(fn, /r\.cardNumber && !pokemonCardNumberMatches/,
  'must not reintroduce the old gate that let numberless rows skip the number check entirely');

// ── The fixed matching logic above is unreachable if this function's own
// entry guard rejects the query first. It must check intent using the
// caller's real category, not a hardcoded '' that discards context the
// caller (searchPokemonOfflineCache) already established -- a bare
// number query like "143/142" has no name text of its own to pass
// isPokemonLookupIntent('143/142', '') on its own.
assert.match(fn, /if\(!query \|\| !isPokemonLookupIntent\(query, cat\)\) return \[\];/,
  'the entry guard must use the threaded-through cat, not a hardcoded empty string');

// ── searchPokemonOfflineCache() (the version that actually runs -- see
// below) must pass its own cat through to searchPokemonCatalogExport,
// not silently drop it.
const cacheFnStart = dashboard.indexOf('async function searchPokemonOfflineCache(query, cat = \'\'){');
assert(cacheFnStart >= 0, 'searchPokemonOfflineCache(query, cat) must exist');
const cacheFnEnd = dashboard.indexOf('\n}', cacheFnStart);
const cacheFn = dashboard.slice(cacheFnStart, cacheFnEnd);
assert.match(cacheFn, /searchPokemonCatalogExport\(query, cat\)/,
  'must thread cat through to searchPokemonCatalogExport instead of calling it with just the query');

// ── There are two declarations of searchPokemonOfflineCache in this file;
// JS resolves the name to whichever comes LAST, so the earlier one (which
// took a boolean sealedIntent, not a category) is dead code that must
// never be relied on. The real offline-first call site inside
// searchQuickCatalog previously passed that boolean (isSealedQuery) as if
// it were cat -- confirm it now passes the real category instead.
const olderDeclStart = dashboard.indexOf('async function searchPokemonOfflineCache(query, sealedIntent = false){');
assert(olderDeclStart >= 0, 'the older/shadowed declaration should still exist (dead code, not this bug\'s concern)');
assert(olderDeclStart < cacheFnStart, 'the (query, cat) version must be declared LAST so it is the one JS actually resolves the name to');
assert.doesNotMatch(dashboard, /searchPokemonOfflineCache\(q, isSealedQuery\)/,
  'the offline-first call site inside searchQuickCatalog must not pass the boolean isSealedQuery where the real function expects the category string');
assert.match(dashboard, /const offlineRows = await searchPokemonOfflineCache\(q, cat\);/,
  'the offline-first call site must pass the real category so a bare number query can pass isPokemonLookupIntent');

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

// ── Functional check: prove the intent-gate mechanism itself. A bare
// number query has no Pokemon-identifying name text of its own, so
// isPokemonLookupIntent(q, '') is false -- only passing the real category
// makes it true. This is why threading cat through (not hardcoding '')
// was necessary, independent of the matching-logic fix above.
const isPokemonLookupIntentStart = dashboard.indexOf("function isPokemonLookupIntent(q = '', cat = ''){");
const isPokemonLookupIntentEnd = dashboard.indexOf('\n}\n\nfunction ', isPokemonLookupIntentStart);
const qplCategoryKeyStart = dashboard.indexOf('function qplCategoryKey(category){');
const qplCategoryKeyEnd = dashboard.indexOf('\n}\n\nfunction priceChartingOfflineCategoryFor', qplCategoryKeyStart);
const isPokemonPromoIntentStart = dashboard.indexOf("function isPokemonPromoIntent(q = ''){");
const isPokemonPromoIntentEnd = dashboard.indexOf('\n}\n\n// B7', isPokemonPromoIntentStart);
const isPokemonSealedSearchIntentStart = dashboard.indexOf("function isPokemonSealedSearchIntent(q = '', cat = ''){");
const isPokemonSealedSearchIntentEnd = dashboard.indexOf('\n}\n\nfunction isMtgSealedSearchIntent', isPokemonSealedSearchIntentStart);
const isPokemonSealedIntentStart = dashboard.indexOf("function isPokemonSealedIntent(q = ''){");
const isPokemonSealedIntentEnd = dashboard.indexOf('\n}\n\nfunction isSealedProductIntent', isPokemonSealedIntentStart);
const qplCategoryKeySrc = dashboard.slice(qplCategoryKeyStart, qplCategoryKeyEnd) + '\n}';
const isPokemonPromoIntentSrc = dashboard.slice(isPokemonPromoIntentStart, isPokemonPromoIntentEnd) + '\n}';
const isPokemonSealedIntentSrc = dashboard.slice(isPokemonSealedIntentStart, isPokemonSealedIntentEnd) + '\n}';
const isPokemonSealedSearchIntentSrc = dashboard.slice(isPokemonSealedSearchIntentStart, isPokemonSealedSearchIntentEnd) + '\n}';
const isPokemonLookupIntentSrc = dashboard.slice(isPokemonLookupIntentStart, isPokemonLookupIntentEnd) + '\n}';
[isPokemonLookupIntentStart, qplCategoryKeyStart, isPokemonPromoIntentStart, isPokemonSealedSearchIntentStart, isPokemonSealedIntentStart].forEach(idx =>
  assert(idx >= 0, 'a helper needed to prove the intent-gate mechanism is missing'));

const normalizeSrc = dashboard.slice(normalizeFnStart, normalizeFnEnd) + '\n}';
const intentCode = [normalizeSrc, qplCategoryKeySrc, isPokemonPromoIntentSrc, isPokemonSealedIntentSrc, isPokemonSealedSearchIntentSrc, isPokemonLookupIntentSrc, 'return isPokemonLookupIntent;'].join('\n');
const isPokemonLookupIntentFn = new Function(intentCode)();

assert.equal(isPokemonLookupIntentFn('143/142', ''), false,
  'a bare card-number query has no name text of its own -- without the real category, intent detection correctly (but unhelpfully) fails, proving the entry-guard fix was necessary');
assert.equal(isPokemonLookupIntentFn('143/142', 'Pokemon'), true,
  'the same query must pass once the real selected category is threaded through, as it now is end-to-end');

console.log('Pokemon offline card-number search checks passed');
