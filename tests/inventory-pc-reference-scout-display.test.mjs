import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store report (sixth occurrence of "no PriceCharting url", and the real one
// this time -- live screenshots): added a sports card through Pocket Scout
// (pasted a sportscardspro.com URL into MATCH CATALOG CARD, hit USE THIS,
// then BUY + ADD INVENTORY), then opened the item to confirm and the
// "PriceCharting Product ID or URL... VERIFY" field showed completely
// blank -- despite scoutBuyAddInventory (and scoutSendToBuyTab,
// buyItemToInventoryUpdates) all saving the resolved match as providerUrl +
// sourceProductId, never as pricechartingProductId. This field's own
// populate function only ever looked at pricechartingProductId, a numeric-
// id-only concept the whole Scout/buy-tray pipeline never writes -- so
// every single Scout-sourced or buy-tray-sourced item displayed this field
// as empty by construction, regardless of whether its link actually saved.
assert.match(dashboard, /function populateInventoryPcReference\(item = \{\}\)\{/, 'missing populateInventoryPcReference');
{
  const fnStart = dashboard.indexOf('function populateInventoryPcReference(item = {}){');
  const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
  const fn = dashboard.slice(fnStart, fnEnd);
  assert.match(fn, /const url = !id \? String\(item\.providerUrl \|\| item\.raw\?\.providerUrl \|\| ''\)\.trim\(\) : '';/,
    'must fall back to the saved providerUrl when there is no numeric pricechartingProductId, or every Scout/buy-tray item shows this field as empty');
  assert.match(fn, /const displayValue = id \|\| url;/, 'must actually display the fallback URL in the input');
  assert.match(fn, /if\(input\) input\.value = displayValue;/, 'must write the fallback value into the input field');
}

console.log('populateInventoryPcReference providerUrl-fallback contract check passed');

// ── Functional: verify the populate function actually fills the field from
// providerUrl when there's no numeric id, and marks it pre-verified so
// re-saving without touching the field doesn't force a pointless re-verify
// or silently blank out the link ──
{
  const fnStart = dashboard.indexOf('function populateInventoryPcReference(item = {}){');
  const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
  const src = 'let inventoryPcReferenceState;\nconst document = { getElementById: () => null };\n'
    + dashboard.slice(fnStart, fnEnd) + '\nreturn { populateInventoryPcReference, getState:() => inventoryPcReferenceState };';
  const { populateInventoryPcReference, getState } = new Function(src)();

  // A Scout-sourced item: no pricechartingProductId, but a real providerUrl.
  populateInventoryPcReference({ providerUrl: 'https://www.sportscardspro.com/game/baseball-cards-2022-bowman/cal-raleigh-fuchsia-49' });
  let state = getState();
  assert.equal(state.originalId, 'https://www.sportscardspro.com/game/baseball-cards-2022-bowman/cal-raleigh-fuchsia-49', 'must treat the saved providerUrl as the loaded reference value');
  assert.equal(state.verified?.url, 'https://www.sportscardspro.com/game/baseball-cards-2022-bowman/cal-raleigh-fuchsia-49', 'must mark the loaded providerUrl as already-verified so an untouched save does not silently drop it');

  // A numeric-id item (the original, still-supported case) must be unaffected.
  populateInventoryPcReference({ pricechartingProductId: '5970222', providerUrl: 'https://www.pricecharting.com/game/some-set/some-card' });
  state = getState();
  assert.equal(state.originalId, '5970222', 'a numeric pricechartingProductId must still win over providerUrl when both are present');
  assert.equal(state.verified, null, 'a numeric id alone must not be treated as pre-verified (unchanged VERIFY-button behavior)');

  // Nothing saved at all.
  populateInventoryPcReference({});
  state = getState();
  assert.equal(state.originalId, '', 'an item with neither field must show a blank reference, not throw');
  assert.equal(state.verified, null);
}

console.log('populateInventoryPcReference providerUrl-fallback functional checks passed');
