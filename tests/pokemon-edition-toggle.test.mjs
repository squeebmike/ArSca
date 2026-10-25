import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Store ask: "I need to be able to toggle Unlimited and 1st Edition."
// PokemonPriceTracker lists a WotC-era card's editions as separate printings
// ("Unlimited" / "1st Edition", "Unlimited Holofoil" / "1st Edition
// Holofoil") with 1st Edition as its primary, and every price read took the
// primary -- a $0.50 Unlimited Jungle common was priced off 1st Edition.
const ui = readFileSync(new URL('../scripts/dashboard-app.js', import.meta.url), 'utf8');
const fnSrc = name => {
  const start = ui.search(new RegExp('(async )?function ' + name + '\\('));
  assert.ok(start >= 0, name);
  return ui.slice(start, ui.indexOf('\n}\n', start) + 2);
};
const lineOf = prefix => { const s = ui.indexOf(prefix); assert.ok(s >= 0, prefix); return ui.slice(s, ui.indexOf('\n', s)); };

const names = ['pptEditionOf', 'pptFinishKind', 'pptVariantsOf', 'pptEditionsIn', 'pptEditionPrinting', 'pokemonPptFinishLabel', 'normalizeQplFinish', 'qplFinishLabel',
  'normalizePokemonPptKey', 'pokemonPptObjectMatch', 'pokemonPptPriceValue', 'pokemonPptConditionLabel', 'pokemonPptConditionCode', 'firstMoneyValue', 'moneyNumber',
  'pokemonPriceTrackerVariantConditionPrice', 'pokemonPriceTrackerMarketPrice', 'resolvePokemonPriceTrackerPrice', 'inventoryEditionUnchecked'];
const api = new Function('inventoryCardName', 'pokemonPptGradeRows', 'pokemonPptListingCount',
  [lineOf('const PPT_EDITIONS ='), ...names.map(fnSrc)].join('\n') + '; return {' + names.join(',') + '};')(
  i => i.name || '', () => [], () => 0);

const jungle = { Unlimited: { 'Near Mint': { price: 1.4 }, 'Moderately Played': { price: 0.9 } }, '1st Edition': { 'Near Mint': { price: 7.71 }, 'Moderately Played': { price: 4.1 } } };
const holo = { 'Unlimited Holofoil': { 'Near Mint': { price: 37.89 } }, '1st Edition Holofoil': { 'Near Mint': { price: 232.58 } } };
const modern = { Holofoil: { 'Near Mint': { price: 5 } }, 'Reverse Holofoil': { 'Near Mint': { price: 3 } } };

// Editions and the printing a copy is.
assert.deepEqual(api.pptEditionsIn(jungle), ['Unlimited', '1st Edition']);
assert.deepEqual(api.pptEditionsIn(modern), [], 'a modern card has no edition question');
assert.equal(api.pptEditionPrinting(modern, { selectedPrinting: 'Holofoil' }), '', 'modern cards price exactly as before');
assert.equal(api.pptEditionPrinting(jungle, {}), 'Unlimited', 'Unlimited until someone picks');
assert.equal(api.pptEditionPrinting(jungle, { selectedPrinting: '1st Edition' }), '1st Edition');
assert.equal(api.pptEditionPrinting(jungle, { name: 'Pikachu 1st Edition' }), '1st Edition', 'the name can say so');
assert.equal(api.pptEditionPrinting(jungle, { edition: '1st Edition' }), '1st Edition');
assert.equal(api.pptEditionPrinting(jungle, { selectedPrinting: '1st Edition' }, 'Unlimited'), 'Unlimited', 'the toggle wins');
assert.equal(api.pptEditionPrinting(holo, { selectedPrinting: 'Holofoil' }), 'Unlimited Holofoil', 'old "Holofoil" -> the Unlimited holo, not 1st Edition');
assert.equal(api.pptEditionPrinting(holo, { selectedPrinting: 'Holofoil' }, '1st Edition'), '1st Edition Holofoil', 'same finish, other edition');
assert.equal(api.pptEditionPrinting(holo, { pokemonPriceTrackerVariants: JSON.stringify(holo) }, '1st Edition'), '1st Edition Holofoil');
assert.deepEqual(api.pptVariantsOf({ raw: { pokemonPriceTrackerVariants: JSON.stringify(jungle) } }), jungle, 'cached on an inventory item as text');

// The edition is part of the printing name everywhere (it used to read
// "1st Edition Holofoil" as plain "Holofoil").
assert.equal(api.pokemonPptFinishLabel('1st Edition Holofoil'), '1st Edition Holofoil');
assert.equal(api.pokemonPptFinishLabel('Unlimited Holofoil'), 'Unlimited Holofoil');
assert.equal(api.pokemonPptFinishLabel('Unlimited'), 'Unlimited');
assert.equal(api.pokemonPptFinishLabel('Holofoil'), 'Holofoil');
assert.equal(api.pokemonPptFinishLabel('Reverse Holofoil'), 'Reverse Holofoil');
assert.equal(api.normalizeQplFinish('1st Edition Holofoil'), 'first_edition_holofoil');
assert.equal(api.normalizeQplFinish('Unlimited Holofoil'), 'unlimited_holofoil');
assert.equal(api.normalizeQplFinish('1st Edition'), 'first_edition');
assert.equal(api.normalizeQplFinish('Holofoil'), 'holofoil');
assert.equal(api.normalizeQplFinish('Reverse Holofoil'), 'reverse_holo');
assert.equal(api.pokemonPptFinishLabel('first_edition_holofoil'), '1st Edition Holofoil', 'round trip');
assert.equal(api.qplFinishLabel('unlimited_holofoil'), 'Unlimited Holofoil');

// Price syncs read the copy's own edition, at any condition.
{
  const card = { prices: { market: 7.71, primaryPrinting: '1st Edition', variants: jungle } };
  assert.equal(api.pokemonPriceTrackerMarketPrice(card, 'NM', 'Unlimited'), 1.4, 'NM Unlimited, not the 1st Edition market');
  assert.equal(api.pokemonPriceTrackerMarketPrice(card, 'MP', 'Unlimited'), 0.9);
  assert.equal(api.pokemonPriceTrackerMarketPrice(card, 'NM', '1st Edition'), 7.71);
  assert.equal(api.pokemonPriceTrackerMarketPrice(card, 'NM'), 7.71, 'no printing given: unchanged');
  assert.equal(api.pokemonPriceTrackerVariantConditionPrice(card, 'MP', 'Unlimited'), 0.9);
}
// Research prices the edition on screen.
{
  const card = { prices: { market: 232.58, primaryPrinting: '1st Edition Holofoil', primaryCondition: 'Near Mint', variants: holo, conditions: { 'Near Mint': { price: 232.58 } } } };
  const r1 = api.resolvePokemonPriceTrackerPrice({ pokemonPriceTracker: card, selectedCondition: 'NM' });
  assert.equal(r1.price, 37.89, 'starts on Unlimited');
  assert.equal(r1.finish, 'Unlimited Holofoil');
  const r2 = api.resolvePokemonPriceTrackerPrice({ pokemonPriceTracker: card, selectedCondition: 'NM', selectedFinish: 'first_edition_holofoil', selectedPrinting: 'Unlimited Holofoil' });
  assert.equal(r2.price, 232.58, 'the button just pressed wins over the printing saved before');
  const r3 = api.resolvePokemonPriceTrackerPrice({ pokemonPriceTracker: card, selectedCondition: 'LP', selectedFinish: 'holofoil', selectedPrinting: 'Unlimited Holofoil' });
  assert.equal(r3.ok, false, 'no Unlimited LP price: never borrowed from 1st Edition or the edition-less conditions map');
  const r4 = api.resolvePokemonPriceTrackerPrice({ pokemonPriceTracker: { prices: { primaryPrinting: 'Holofoil', variants: modern } }, selectedCondition: 'NM', selectedFinish: 'reverse_holo' });
  assert.equal(r4.price, 3, 'modern finishes still work');
}
// Inventory: what still needs a person to look at the stamp.
assert.equal(api.inventoryEditionUnchecked({ pokemonPriceTrackerVariants: jungle }), true);
assert.equal(api.inventoryEditionUnchecked({ pokemonPriceTrackerVariants: jungle, editionConfirmed: true }), false);
assert.equal(api.inventoryEditionUnchecked({ pokemonPriceTrackerVariants: modern }), false);

// Wiring.
assert.ok(ui.includes("const editionPrinting = sealed ? '' : pptEditionPrinting(pptVariantsOf(live.card), item);"), 'the Pokemon sync');
assert.ok(ui.includes('const freshPrice = pokemonPriceTrackerMarketPrice(live.card, itemCondition, editionPrinting);'));
assert.ok(ui.includes('${qplEditionChips(r, idx)}'), 'Research shows UNLIMITED / 1ST EDITION');
assert.ok(fnSrc('setQplEdition').includes('editionConfirmed:true'));
assert.ok(fnSrc('pokemonPriceTrackerCardToQplRow').includes("selectedPrinting:startPrinting || '',"), 'a search result starts on its edition, not PPT\'s primary');
assert.ok(ui.includes("['selectedPrinting',''], ['editionConfirmed',false,'bool'],"), 'saved with the item');
assert.ok(fnSrc('openEditModal').includes('renderEditEditionRow(item);'), 'item editor');
assert.ok(ui.includes("if(flag === 'check_edition') return inventoryEditionUnchecked(i);"), 'CHECK EDITION filter');
assert.ok(readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8').includes('<div id="edit-edition-row" style="display:none;grid-column:1/-1"></div>'));
{
  // Choosing an edition saves it and reprices from the cached prices.
  const saved = [];
  const item = { id: 'i1', name: 'Pikachu', condition: 'NM', market: 7.71, raw: {}, pokemonPriceTrackerVariants: jungle };
  const set = new Function('all', 'saveInventoryEdit', 'toast_dash', 'filterTable', 'renderEditEditionRow', 'inventoryMarketPrice', 'inventoryPriceOverride', 'inventoryListPrice', 'editingItemId', 'document',
    ['pptEditionOf', 'pptFinishKind', 'normalizeQplFinish', 'pptVariantsOf', 'pokemonPptObjectMatch', 'normalizePokemonPptKey', 'pokemonPptPriceValue', 'pokemonPptConditionLabel', 'pokemonPptConditionCode', 'inventoryEditionPrice', 'setInventoryEdition'].map(fnSrc).join('\n') + '; return setInventoryEdition;')(
    [item], async (it, u) => saved.push(u), () => {}, () => {}, () => {}, i => Number(i.market || 0), () => 0, i => Math.ceil(i.market), '', { getElementById: () => null });
  await set('i1', 'Unlimited');
  assert.equal(saved[0].selectedPrinting, 'Unlimited');
  assert.equal(saved[0].editionConfirmed, true);
  assert.equal(saved[0].market, 1.4);
  assert.equal(saved[0].listPrice, 2);
  assert.equal(item.edition, 'Unlimited');
}
console.log('Pokemon edition toggle checks passed');
