import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store report: "how are these not matching now? a lot of sealed?" -- the
// "not matched" issue for a sealed item said "returned N candidate(s), but
// none passed exact product-name and set matching" with no way to tell
// whether PPT genuinely had nothing usable, or found the right product and
// just scored it too low against a store-entered abbreviation ("ETB"/
// "UPC") PPT's own product names always spell out in full. Two fixes:
// expand those abbreviations before both searching and scoring (see
// tests/pokemon-price-sync.test.js for the direct functional coverage),
// and surface the single closest candidate + its score on a rejected
// match instead of just "no match", so a real near-miss is explainable.

const fetchCardStart = dashboard.indexOf('async function fetchLivePokemonInventoryCard');
assert.ok(fetchCardStart !== -1, 'fetchLivePokemonInventoryCard must exist');
const fetchCardEnd = dashboard.indexOf('\nfunction isPokemonSealedInventorySyncItem', fetchCardStart);
const fetchCardBody = dashboard.slice(fetchCardStart, fetchCardEnd);

assert.match(fetchCardBody, /const sealedMatch = sealed && !tcgPlayerId \? findBestLivePokemonSealedMatch\(item, cards\) : null;/,
  'a sealed, non-pinned-id lookup must capture the full match result (product + near-miss info), not just a bare product');
assert.match(fetchCardBody, /const card = tcgPlayerId \? \(cards\[0\] \|\| null\) : \(sealed \? sealedMatch\.product : findBestLivePokemonInventoryMatch\(item, cards\)\);/,
  'the accepted card must come from sealedMatch.product for sealed items, preserving the existing behavior for singles/pinned-id lookups');
assert.match(fetchCardBody, /nearMissName:sealedMatch\?\.bestName \|\| '',/, 'the near-miss candidate name must be returned so a caller can explain a rejected match');
assert.match(fetchCardBody, /nearMissScore:sealedMatch\?\.bestScore \|\| 0,/, 'the near-miss candidate score must be returned alongside its name');

// The "no-match" issue text a sealed item lands in must actually use that
// near-miss info when present.
const proposalStart = dashboard.indexOf('async function buildLivePokemonPriceSyncProposal');
assert.ok(proposalStart !== -1, 'buildLivePokemonPriceSyncProposal must exist');
const proposalEnd = dashboard.indexOf('\nasync function runLivePokemonPriceSync', proposalStart);
const proposalBody = dashboard.slice(proposalStart, proposalEnd === -1 ? proposalStart + 6000 : proposalEnd);
assert.match(proposalBody, /Closest candidate: "' \+ live\.nearMissName \+ '" \(' \+ live\.nearMissScore \+ '\/75\+ needed to accept/,
  'a sealed item that fails to match must name its closest real candidate and score, not just report zero matches with no explanation');

console.log('Pokemon sealed near-miss reporting contract checks passed');
