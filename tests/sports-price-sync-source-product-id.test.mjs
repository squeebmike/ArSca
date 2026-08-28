import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store report: "we have the pricecharting link now, how does price sync
// use it?" fetchOtherTcgOrSportsLivePrice already preferred a pinned exact
// PriceCharting id over a fuzzy name search for sports cards -- but it only
// ever checked item.pricechartingProductId, a field ONLY ever written by
// the numeric-ID/URL VERIFY field on the Edit modal (inventoryPcReferencePatch).
// Every card added through Pocket Scout or the buy tray saves its exact
// match as sourceProductId instead (scoutBuyAddInventory,
// scoutSendToBuyTab, buyItemToInventoryUpdates all write sourceProductId,
// never pricechartingProductId -- the exact field-name split already fixed
// for the Edit-modal DISPLAY in a prior PR, but not fixed here). So price
// sync silently fell back to fuzzy matching for every Scout/buy-tray-
// sourced sports card, defeating the entire point of pinning the exact
// card in the first place.
assert.match(dashboard, /async function fetchOtherTcgOrSportsLivePrice\(item\)\{/, 'missing fetchOtherTcgOrSportsLivePrice');
{
  const fnStart = dashboard.indexOf('async function fetchOtherTcgOrSportsLivePrice(item){');
  const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
  const fn = dashboard.slice(fnStart, fnEnd);
  assert.match(fn, /const pcId = String\(item\.pricechartingProductId \|\| item\.raw\?\.pricechartingProductId \|\| item\.sourceProductId \|\| item\.raw\?\.sourceProductId \|\| ''\)\.trim\(\);/,
    'the pinned-id lookup must also fall back to sourceProductId (and item.raw.sourceProductId), or every Scout/buy-tray-sourced sports card never uses its own pinned exact match at price-sync time');
}

console.log('fetchOtherTcgOrSportsLivePrice sourceProductId fallback contract check passed');

// ── Functional: prove the fallback chain picks the right field in priority
// order, independent of DOM/network state ──
{
  const resolvePcId = (item) => String(item.pricechartingProductId || item.raw?.pricechartingProductId || item.sourceProductId || item.raw?.sourceProductId || '').trim();

  assert.equal(resolvePcId({ sourceProductId:'5970222' }), '5970222', 'a Scout/buy-tray item with only sourceProductId must still resolve to its pinned id');
  assert.equal(resolvePcId({ pricechartingProductId:'111', sourceProductId:'222' }), '111', 'an explicitly-verified pricechartingProductId must win over sourceProductId when both exist');
  assert.equal(resolvePcId({ raw:{ sourceProductId:'333' } }), '333', 'a nested raw.sourceProductId must also be found');
  assert.equal(resolvePcId({}), '', 'an item with neither field must resolve to empty, falling through to the fuzzy search');
}

console.log('fetchOtherTcgOrSportsLivePrice sourceProductId fallback functional checks passed');
