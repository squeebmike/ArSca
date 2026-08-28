import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store report (fifth occurrence of "no PriceCharting url" in this saga):
// the store always pastes a full sportscardspro.com/pricecharting.com
// product page URL for sports cards -- never the bare numeric id. The
// "PriceCharting Product ID... VERIFY" field on the shared Add-to-
// Inventory/Edit-Item modal is the field they use for it, but it flatly
// rejected any URL-shaped input (only digits parsed as an id). The only
// field on the whole modal that accepted a pasted URL at all was the
// COMIC-only "Paste PriceCharting Comic Link" field, which runs a fuzzy
// comic-sweep text search -- so pasting a sports card URL there produced
// "100 possible matches" of unrelated cards instead of resolving the exact
// product. Now the sports-card ID field itself detects a pasted URL and
// resolves it directly via /pricing/sportscardspro/resolve-url (the same
// route Pocket/Mana Scout's own catalog-search modal already used
// successfully), instead of guessing at digits embedded in the URL (which
// don't exist -- PriceCharting/SportsCardsPro URLs are slug-based, e.g.
// /game/baseball-cards-2022-bowman/cal-raleigh-fuchsia-49, never carrying
// the numeric product id at all).

assert.match(dashboard, /function inventoryPcLooksLikeUrl\(raw=''\)\{/, 'missing inventoryPcLooksLikeUrl');
assert.match(dashboard, /function inventoryPcRefKeyFromRaw\(raw=''\)\{/, 'missing inventoryPcRefKeyFromRaw');

{
  const fnStart = dashboard.indexOf("function inventoryPcLooksLikeUrl(raw=''){");
  const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
  const inventoryPcLooksLikeUrl = new Function(dashboard.slice(fnStart, fnEnd) + '\nreturn inventoryPcLooksLikeUrl;')();
  assert.equal(inventoryPcLooksLikeUrl('https://www.sportscardspro.com/game/baseball-cards-2022-bowman/cal-raleigh-fuchsia-49'), true, 'must detect a full sportscardspro.com URL');
  assert.equal(inventoryPcLooksLikeUrl('www.pricecharting.com/game/foo/bar'), true, 'must detect a schemeless pricecharting.com URL');
  assert.equal(inventoryPcLooksLikeUrl('5970222'), false, 'must not treat a bare numeric id as a URL');
  assert.equal(inventoryPcLooksLikeUrl(''), false, 'must not treat empty input as a URL');
}

{
  const idStart = dashboard.indexOf("function inventoryPcIdFromRaw(raw=''){");
  const keyStart = dashboard.indexOf("function inventoryPcRefKeyFromRaw(raw=''){");
  const keyEnd = dashboard.indexOf('\n}', keyStart) + 2;
  const looksStart = dashboard.indexOf("function inventoryPcLooksLikeUrl(raw=''){");
  const src = dashboard.slice(looksStart, keyEnd);
  assert(idStart > -1 && idStart < keyStart, 'inventoryPcIdFromRaw must be defined before inventoryPcRefKeyFromRaw uses it');
  const inventoryPcRefKeyFromRaw = new Function(src + '\nreturn inventoryPcRefKeyFromRaw;')();
  assert.equal(
    inventoryPcRefKeyFromRaw('https://www.sportscardspro.com/game/baseball-cards-2022-bowman/cal-raleigh-fuchsia-49'),
    'https://www.sportscardspro.com/game/baseball-cards-2022-bowman/cal-raleigh-fuchsia-49',
    'a pasted URL must be used as the cache key verbatim, not have digits stripped out of it'
  );
  assert.equal(inventoryPcRefKeyFromRaw('5970222'), '5970222', 'a bare numeric id must still work as before');
  assert.equal(inventoryPcRefKeyFromRaw('not a valid reference'), '', 'garbage input must resolve to no key');
}

// verifyInventoryPriceChartingReference must branch: URL -> resolve-url
// (scrapes the real page), numeric id -> the existing product/:id lookup.
// Must NOT try to parse a numeric id out of the URL itself.
{
  const fnStart = dashboard.indexOf('async function verifyInventoryPriceChartingReference(){');
  const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
  const fn = dashboard.slice(fnStart, fnEnd);
  assert.match(fn, /\/pricing\/sportscardspro\/resolve-url\?/, 'a pasted URL must be resolved via the working resolve-url route');
  assert.match(fn, /\/pricing\/pricecharting\/product\/' \+ encodeURIComponent\(key\)/, 'a numeric id must still use the product/:id route');
  assert.match(fn, /url:m\.productUrl \|\| key/, 'the resolved product page URL must be captured from the resolve-url response');
  assert.match(fn, /cardNumber:m\.card_number \|\| ''/, 'card number should be captured from a resolved URL too');
  assert.match(fn, /printRun:m\.printRun \|\| ''/, 'print run should be captured from a resolved URL too');
}

// inventoryPcReferencePatch must carry providerUrl/card_number/serial_number
// through from a resolved URL, not just from a verified numeric id.
{
  const fnStart = dashboard.indexOf('async function inventoryPcReferencePatch(item = {}){');
  const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
  const fn = dashboard.slice(fnStart, fnEnd);
  assert.match(fn, /providerUrl:verified\?\.url \|\| item\.providerUrl \|\| '',/, 'must return providerUrl from the verified match');
  assert.match(fn, /\.\.\.\(verified\?\.cardNumber \? \{ card_number:verified\.cardNumber \} : \{\}\),/, 'must backfill card_number when a resolved URL carried one');
  assert.match(fn, /\.\.\.\(verified\?\.printRun \? \{ serial_number:'\/' \+ verified\.printRun \} : \{\}\),/, 'must backfill serial_number/print run when a resolved URL carried one');
}

// The field's own label/placeholder/help text must no longer claim it's
// numeric-only, and inputmode must not steer mobile keyboards to digits-only.
assert.match(dashboard, /<input type="text" id="edit-pricecharting-ref" inputmode="url"/, 'the field must accept URL input (not be pinned to a numeric-only keyboard)');
assert.doesNotMatch(dashboard, /<input type="text" id="edit-pricecharting-ref" inputmode="numeric"/, 'the field must not still be restricted to numeric-only input');
assert.match(dashboard, /Paste the numeric PriceCharting\/SportsCardsPro product ID, or a full product page URL, to pin exact-match pricing\./,
  'the field help text must mention URLs are accepted, not just the numeric id');

console.log('PriceCharting sports-card URL-paste contract checks passed');

// applyComicCandidateToEditForm (comic-URL-lookup flow) must set a `key` on
// the cached verified reference too, so a comic candidate applied from that
// flow is recognized as already-verified rather than triggering a redundant
// re-verify against the product/:id route when the item is saved.
{
  const fnStart = dashboard.indexOf('function applyComicCandidateToEditForm(product){');
  const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
  const fn = dashboard.slice(fnStart, fnEnd);
  assert.match(fn, /verified:\{ key:String\(product\.productId\), id:String\(product\.productId\), product, url:product\.url \|\| '' \}/,
    'the comic-URL-applied reference must carry a key so it is recognized as already verified');
}

console.log('applyComicCandidateToEditForm verified-key contract check passed');
