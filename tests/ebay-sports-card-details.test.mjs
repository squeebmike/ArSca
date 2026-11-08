import assert from 'node:assert/strict';
import fs from 'node:fs';
// Store, 2026-11-08 (eBay listing screenshot): a SportsCardsPro scan of
// "Brian Dawkins #VI-BD" (set "Football Cards 2026 Topps Flagship Victory
// Ink", variant "Football Cards") showed Sport: Baseball, Parallel: "Football
// Cards", no player/year/brand, and "Could not load eBay's required
// card-condition options".
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
const grab = sig => { const i = app.indexOf(sig); assert.ok(i >= 0, sig); let d = 0, j = app.indexOf('){', i) + 1; for (; j < app.length; j++) { if (app[j] === '{') d++; else if (app[j] === '}' && !--d) break; } return app.slice(i, j + 1); };
const line = sig => { const i = app.indexOf(sig); assert.ok(i >= 0, sig); return app.slice(i, app.indexOf('\n', i)); };
const { ebaySportsCardDetails, ebayUngradedCardConditionFor, EBAY_UNGRADED_CARD_CONDITIONS } = new Function([
  line('const EBAY_SPORT_WORDS'), line('const EBAY_SPORT_CARDS_PREFIX'), line('const EBAY_UNGRADED_CARD_CONDITIONS'),
  grab('function ebaySportsCardDetails('), grab('function ebayUngradedCardConditionFor('),
  'return { ebaySportsCardDetails, ebayUngradedCardConditionFor, EBAY_UNGRADED_CARD_CONDITIONS };'].join('\n'))();

const dawkins = { name: 'Brian Dawkins #VI-BD', category: 'Sports', set: 'Football Cards 2026 Topps Flagship Victory Ink', variant: 'Football Cards', characterOrSubject: 'Brian Dawkins', card_number: 'VI-BD', sport: '', year: '', player: '', brand: '', manufacturer: '' };
const d = ebaySportsCardDetails(dawkins);
assert.equal(d.sport, 'Football');
assert.equal(d.year, '2026');
assert.equal(d.player, 'Brian Dawkins');
assert.equal(d.manufacturer, 'Topps');
assert.equal(d.set, '2026 Topps Flagship Victory Ink');
assert.equal(d.variant, '', '"Football Cards" is not a parallel');
assert.equal(dawkins.sport, '', 'the stored item is not changed');
// What the item already says wins; non-sports items pass through untouched.
assert.equal(ebaySportsCardDetails({ ...dawkins, sport: 'Football', player: 'B. Dawkins', year: '2025', variant: 'Gold Refractor' }).variant, 'Gold Refractor');
assert.equal(ebaySportsCardDetails({ ...dawkins, player: 'B. Dawkins' }).player, 'B. Dawkins');
const poke = { name: 'Charizard', category: 'Pokemon TCG', set: 'Base Set', variant: 'Holo' };
assert.equal(ebaySportsCardDetails(poke), poke);
assert.equal(ebaySportsCardDetails({ name: 'Mike Trout #27', category: 'Sports', set: 'Baseball Cards 2011 Topps Update', variant: 'Baseball Cards' }).sport, 'Baseball');

// Card condition: eBay's fixed 40001 values, picked from the item's condition.
assert.deepEqual(EBAY_UNGRADED_CARD_CONDITIONS.map(v => v.value), ['400010', '400011', '400012', '400013']);
assert.equal(ebayUngradedCardConditionFor('NM'), '400010');
assert.equal(ebayUngradedCardConditionFor('Excellent'), '400011');
assert.equal(ebayUngradedCardConditionFor('LP'), '400011');
assert.equal(ebayUngradedCardConditionFor('Moderately Played'), '400012');
assert.equal(ebayUngradedCardConditionFor('Damaged'), '400013');
assert.doesNotMatch(app, /Could not load eBay's required card-condition options/, 'never a dead end for ungraded cards');
assert.match(app, /const item=ebaySportsCardDetails\(found\);/);
assert.match(app, /function computeEbayListingFields\(item\)\{\n  item = ebaySportsCardDetails\(item\);/);
assert.match(app, /aspectVal\('Sport', item\.sport \|\| ''\)/, 'no Baseball guess');

// The worker reads eBay's nested descriptor shape (itemConditions[].conditionDescriptors).
const w = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.match(w, /\.\.\.\(policy\.itemConditions \|\| \[\]\)\.flatMap\(c => c\.conditionDescriptors \|\| \[\]\)/);
assert.match(w, /value: String\(v\.value \|\| v\.conditionDescriptorValueId \|\| ''\), label: v\.displayValue \|\| v\.conditionDescriptorValueName/);
console.log('eBay sports-card details (sport, year, player, brand, set, parallel) and card condition passed');
