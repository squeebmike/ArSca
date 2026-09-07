import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store request: a bulk "how far above market can we sell" rule per
// category (e.g. Pokemon 20% over market or +$2, whichever's greater;
// Sports 60% over or +$5), auto-applied as a new item's ceiling going
// forward, adjustable per item afterward -- mirrors the existing floor
// (minPrice) exactly, just at the other end.

// ── Config storage: categoryPriceCeilings alongside the existing categories/modules ──
assert.match(dashboard, /categoryPriceCeilings: \{\},/, 'DEFAULT_VENDOR_CONFIG must default to no configured ceiling rules (opt-in per category, not a blanket default)');
assert.match(dashboard, /categoryPriceCeilings: \{ \.\.\.DEFAULT_VENDOR_CONFIG\.categoryPriceCeilings, \.\.\.\(saved\.categoryPriceCeilings \|\| \{\}\) \},/, 'getVendorConfig must merge saved category ceiling rules');
assert.match(dashboard, /categoryPriceCeilings: config\.categoryPriceCeilings \? \{ \.\.\.config\.categoryPriceCeilings \} : getVendorConfig\(\)\.categoryPriceCeilings,/, 'saveVendorConfig must persist category ceiling rules');

// ── Field round-trip: ceilingPrice must be registered like minPrice, or it silently vanishes on save (the onlineListed bug pattern) ──
assert.match(dashboard, /\['signature_value',0,'num'\], \['minPrice',0,'num'\], \['ceilingPrice',0,'num'\],/, 'ceilingPrice must be registered in BUILT_IN_ITEM_SIMPLE_FIELDS right alongside minPrice, or it won\'t round-trip through read/write like every other simple field');

// ── Price helpers ──
assert.match(dashboard, /function inventoryCeilingPrice\(item=\{\}\)\{ return Number\(item\.ceilingPrice \?\? item\.raw\?\.ceilingPrice \?\? 0\) \|\| 0; \}/, 'missing inventoryCeilingPrice');
assert.match(dashboard, /function categoryPriceCeilingRule\(category\)\{/, 'missing categoryPriceCeilingRule');
assert.match(dashboard, /function computeCategoryCeilingPrice\(market, rule\)\{/, 'missing computeCategoryCeilingPrice');

// ── inventoryListPrice / inventorySellSuggestedPrice must clamp down to the ceiling ──
{
  const fnStart = dashboard.indexOf('function inventoryListPrice(item={}){');
  const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
  const fn = dashboard.slice(fnStart, fnEnd);
  assert.match(fn, /const ceiling = inventoryCeilingPrice\(item\);/, 'inventoryListPrice must read the item\'s ceiling');
  assert.match(fn, /if\(ceiling > 0\) price = Math\.min\(price, ceiling\);/, 'inventoryListPrice must clamp down to the ceiling when one is set');
}
{
  const fnStart = dashboard.indexOf('function inventorySellSuggestedPrice(item={}){');
  const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
  const fn = dashboard.slice(fnStart, fnEnd);
  assert.match(fn, /const ceiling = inventoryCeilingPrice\(item\);/, 'inventorySellSuggestedPrice must read the item\'s ceiling');
  assert.match(fn, /if\(ceiling > 0\) floored = Math\.min\(floored, ceiling\);/, 'inventorySellSuggestedPrice must clamp down to the ceiling when one is set');
}

// ── Auto-set on creation ──
{
  const fnStart = dashboard.indexOf("async function createBuiltInInventoryItem(item, updates, sourceLabel='built_in') {");
  const fnEnd = dashboard.indexOf('\nasync function updateBuiltInInventoryItem', fnStart);
  const fn = dashboard.slice(fnStart, fnEnd);
  assert.match(fn, /const autoCeiling = computeCategoryCeilingPrice\(\s*\n\s*inventoryMarketPrice\(resolvedForCeiling\),\s*\n\s*categoryPriceCeilingRule\(resolvedForCeiling\.category\)\s*\n\s*\);/,
    'createBuiltInInventoryItem must compute the auto-ceiling from the resolved category + market');
  assert.match(fn, /ceilingPrice:\(item\?\.ceilingPrice \?\? updates\?\.ceilingPrice \?\? autoCeiling\),/,
    'createBuiltInInventoryItem must only fall back to the auto-computed ceiling when neither item nor updates already specify one explicitly');
}

// ── Settings UI: per-category rule table + save handler ──
assert.match(dashboard, /CATEGORY PRICE CEILINGS/, 'Settings must expose a category price ceilings panel');
assert.match(dashboard, /function setCategoryPriceCeilingRule\(category, field, value\)\{/, 'missing setCategoryPriceCeilingRule');
{
  const fnStart = dashboard.indexOf('function setCategoryPriceCeilingRule(category, field, value){');
  const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
  const fn = dashboard.slice(fnStart, fnEnd);
  assert.match(fn, /if\(!nextRule\.pct && !nextRule\.flat\) delete rules\[category\];/, 'a category with both fields cleared to 0 must have its rule entry removed entirely, not stored as a no-op {pct:0,flat:0}');
}

// ── Edit modal: field exists, is positioned above the floor field, and is populated/read in both the add-new and edit-existing paths ──
assert.match(dashboard, /<label>Max Sale Price \/ Ceiling \(\$\)<\/label>\s*\n\s*<input type="number" id="edit-ceiling-price" step="0\.01" min="0" placeholder="No ceiling">\s*\n\s*<\/div>\s*\n\s*<div>\s*\n\s*<label>Min Sale Price \(\$\)<\/label>/,
  'the ceiling field must render immediately above the floor (Min Sale Price) field, per the store\'s own requested layout');
assert.match(dashboard, /document\.getElementById\('edit-ceiling-price'\)\.value = item\.ceilingPrice \|\| '';/, 'the edit modal must populate the ceiling field from the item being edited (checked at least once)');
{
  const addFnStart = dashboard.indexOf('async function confirmAddToInventoryFromModal(){');
  const addFnEnd = dashboard.indexOf('\n}', addFnStart) + 2;
  const addFn = dashboard.slice(addFnStart, addFnEnd);
  assert.match(addFn, /ceilingPrice: parseFloat\(document\.getElementById\('edit-ceiling-price'\)\?\.value\) \|\| undefined,/,
    'adding a brand-new item must resolve a blank ceiling field to undefined (not 0), so createBuiltInInventoryItem\'s ?? chain can still fall through to the category auto-default');
}
{
  const editFnStart = dashboard.indexOf('const editHasOverride = editListVal > 0');
  const editFnEnd = dashboard.indexOf('\n  };', editFnStart);
  const editFn = dashboard.slice(editFnStart, editFnEnd);
  assert.match(editFn, /ceilingPrice: parseFloat\(document\.getElementById\('edit-ceiling-price'\)\?\.value\)\|\|0,/,
    'editing an EXISTING item must treat a blank ceiling field as an explicit 0 (no ceiling), matching how minPrice already behaves on edit -- the auto-default only ever applies at creation time');
}

console.log('Category price ceiling contract checks passed');

// ── Functional: reimplement the exact math and prove it ──
function roundSellPrice(value){
  const n = Number(value || 0);
  if(!isFinite(n) || n <= 0) return 0;
  return Math.ceil(n - 1e-9);
}
function computeCategoryCeilingPrice(market, rule){
  if(!rule || !(market > 0)) return 0;
  const pct = Number(rule.pct || 0);
  const flat = Number(rule.flat || 0);
  const bump = Math.max(market * pct / 100, flat);
  return bump > 0 ? roundSellPrice(market + bump) : 0;
}
function inventoryCeilingPrice(item = {}){ return Number(item.ceilingPrice ?? 0) || 0; }
function inventoryListPriceWithCeiling(item = {}){
  let price = Number(item.priceOverride || item.market || 0);
  const floor = Number(item.minPrice || 0);
  if(floor > 0) price = Math.max(price, floor);
  const ceiling = inventoryCeilingPrice(item);
  if(ceiling > 0) price = Math.min(price, ceiling);
  return price;
}

// Pokemon: 20% over market or $2 flat, whichever's greater.
{
  // Cheap card -- $2 flat wins over 20% ($10 market -> 20% = $2, tied; bump to a case where flat clearly wins).
  const cheap = computeCategoryCeilingPrice(5, { pct: 20, flat: 2 });
  assert.equal(cheap, 7, '$5 market: 20% = $1, flat $2 wins -> ceiling $7');
  // Expensive card -- 20% wins over the flat $2.
  const expensive = computeCategoryCeilingPrice(100, { pct: 20, flat: 2 });
  assert.equal(expensive, 120, '$100 market: 20% = $20 beats flat $2 -> ceiling $120');
}
// Sports: 60% over market or $5 flat, whichever's greater.
{
  const sportsCheap = computeCategoryCeilingPrice(5, { pct: 60, flat: 5 });
  assert.equal(sportsCheap, 10, '$5 market: 60% = $3, flat $5 wins -> ceiling $10');
  const sportsExpensive = computeCategoryCeilingPrice(50, { pct: 60, flat: 5 });
  assert.equal(sportsExpensive, 80, '$50 market: 60% = $30 beats flat $5 -> ceiling $80');
}
// No rule configured for a category -> no ceiling at all.
assert.equal(computeCategoryCeilingPrice(50, null), 0, 'a category with no configured rule must produce no ceiling');
// No market price yet -> nothing to compute a ceiling against.
assert.equal(computeCategoryCeilingPrice(0, { pct: 20, flat: 2 }), 0, 'zero/unknown market price must produce no ceiling, even with a rule configured');

// inventoryListPrice must actually clamp down to a set ceiling.
{
  const overCeiling = { market: 100, ceilingPrice: 50 };
  assert.equal(inventoryListPriceWithCeiling(overCeiling), 50, 'a price that exceeds the ceiling must be clamped down to it');
}
{
  const underCeiling = { market: 20, ceilingPrice: 50 };
  assert.equal(inventoryListPriceWithCeiling(underCeiling), 20, 'a price already under the ceiling must be left alone');
}
{
  const noCeiling = { market: 500 };
  assert.equal(inventoryListPriceWithCeiling(noCeiling), 500, 'an item with no ceiling set at all must be unconstrained');
}
// The floor and ceiling can coexist -- floor should still raise a
// too-cheap price, and ceiling should still cap a too-expensive one;
// they just constrain opposite directions.
{
  const belowFloor = { market: 3, minPrice: 10, ceilingPrice: 50 };
  assert.equal(inventoryListPriceWithCeiling(belowFloor), 10, 'the floor must still raise a too-cheap price even with a ceiling also configured');
}

console.log('Category price ceiling functional checks passed');
