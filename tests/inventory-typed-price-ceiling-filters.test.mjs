import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store ask: "Add the typed price and ceiling filters." A typed List / Sale
// Price is saved as priceOverride and kept as typed (price syncs only move
// Market); a ceiling is ceilingPrice. Both get a FLAGS chip and a health card.
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const extractFn = (name, prefix = 'function ') => { const s = dashboard.indexOf(prefix + name + '('); assert.ok(s >= 0, name); return dashboard.slice(s, dashboard.indexOf('\n}\n', s) + 2); };

assert.match(dashboard, /<button class="fb" data-filter-group="flag" onclick="setF\('flag','typed_price',this\)"[^>]*>🔒 Locked Price<\/button>/);
assert.match(dashboard, /<button class="fb" data-filter-group="flag" onclick="setF\('flag','has_ceiling',this\)"[^>]*>Has Ceiling<\/button>/);
assert.match(extractFn('renderInventoryHealthPanel'), /\['typed_price','Locked Price',h\.typedPrice,'exact price, syncs skip it'\],\s*\['has_ceiling','Has Ceiling',h\.hasCeiling,'capped at a max price'\],/);
assert.match(extractFn('inventoryHealthSummary'), /typedPrice:inStock\.filter\(i=>inventoryPriceOverride\(i\) > 0\)\.length,\s*hasCeiling:inStock\.filter\(i=>inventoryCeilingPrice\(i\) > 0\)\.length,/);

const matches = new Function('inventoryPriceOverride', 'inventoryCeilingPrice', 'inventoryNeedsSticker', 'inventoryImageUrl', 'qplCategoryKey', 'inventoryCostBasis', 'inventoryMarketPrice', 'inventoryIsPriceStale', 'inventoryProfitStats',
  extractFn('inventoryMatchesFlag') + '\nreturn inventoryMatchesFlag;')(
  i => Number(i.priceOverride ?? i.raw?.priceOverride ?? 0) || 0, i => Number(i.ceilingPrice ?? i.raw?.ceilingPrice ?? 0) || 0,
  () => false, () => 'x', () => '', () => 1, () => 1, () => false, () => ({ cost:0, list:0 }));
assert.equal(matches({ status:'in_stock', priceOverride:7 }, 'typed_price'), true);
assert.equal(matches({ status:'in_stock', priceOverride:0, market:6.69 }, 'typed_price'), false, 'list price that just follows market');
assert.equal(matches({ status:'in_stock', raw:{ ceilingPrice:10 } }, 'has_ceiling'), true);
assert.equal(matches({ status:'in_stock', ceilingPrice:0 }, 'has_ceiling'), false);
assert.equal(matches({ status:'sold', priceOverride:7, ceilingPrice:10 }, 'typed_price'), false, 'in-stock only, like the other flags');

// Store ask: "make it so you can't type a sale price ... to set it exact."
// The List / Sale Price box is read-only (the real shelf price); LOCK is the
// only way to set an exact price, UNLOCK goes back to following market.
assert.match(dashboard, /<input type="number" id="edit-list-price" step="0\.01" min="0" placeholder="0\.00" readonly tabindex="-1" class="price-lock-display"/);
assert.match(dashboard, /<button type="button" class="hbtn price-lock-btn" id="edit-lock-btn" onclick="toggleEditPriceLock\(\)">🔒 LOCK<\/button>/);
assert.match(dashboard, /<input type="hidden" id="edit-locked-price" value="">/);
assert.match(dashboard, /const editListVal = editLockedPrice\(\);\s*const editHasOverride = editListVal > 0;/, 'edit saves an exact price only when locked');
assert.match(dashboard, /const addListVal = editLockedPrice\(\);\s*const addHasOverride = addListVal > 0;/, 'add too');
assert.doesNotMatch(dashboard, /parseFloat\(document\.getElementById\('edit-list-price'\)\?\.value\)\|\|0;\s*(?:\/\/[^\n]*\n\s*)*const (?:edit|add)HasOverride/, 'the read-only box is never read as a price to save');
assert.match(extractFn('openEditModal'), /setEditLockedPrice\(inventoryPriceOverride\(item\)\);/);
assert.match(dashboard, /🔒<\/span>':''\}<br>/, 'locked items show a lock in the list');
{
  const fields = { 'edit-market':{ value:'6.69' }, 'edit-min-price':{ value:'' }, 'edit-ceiling-price':{ value:'' }, 'edit-locked-price':{ value:'' },
    'edit-list-price':{ value:'', classList:{ toggle(){} } }, 'edit-lock-btn':{ textContent:'' }, 'edit-lock-note':{ textContent:'', classList:{ toggle(){} } } };
  let promptAnswer = '7.50', toasts = [];
  const api = new Function('document', 'roundSellPrice', 'updateEditProfit', 'prompt', 'toast_dash',
    [extractFn('editLockedPrice'), extractFn('setEditLockedPrice'), extractFn('refreshEditShelfPrice'), extractFn('toggleEditPriceLock'), 'return { editLockedPrice, setEditLockedPrice, toggleEditPriceLock };'].join('\n'))(
    { getElementById:id => fields[id] }, v => Math.ceil(Number(v) || 0), () => {}, () => promptAnswer, m => toasts.push(m));
  api.setEditLockedPrice(0);
  assert.equal(fields['edit-list-price'].value, '7.00', 'follows market, rounded up');
  assert.equal(fields['edit-lock-btn'].textContent, '🔒 LOCK');
  assert.equal(fields['edit-lock-note'].textContent, 'Follows market: $6.69 rounds up to $7.00. LOCK to set an exact price.');
  api.toggleEditPriceLock();
  assert.equal(api.editLockedPrice(), 7.5); assert.equal(fields['edit-list-price'].value, '7.50');
  assert.equal(fields['edit-lock-btn'].textContent, '🔓 UNLOCK');
  assert.match(fields['edit-lock-note'].textContent, /^🔒 Locked at \$7\.50 -- price syncs won't change it/);
  fields['edit-ceiling-price'].value = '7';
  api.setEditLockedPrice(7.5);
  assert.equal(fields['edit-list-price'].value, '7.00');
  assert.match(fields['edit-lock-note'].textContent, /^🔒 Locked at \$7\.50 \(capped at the ceiling\)/);
  api.toggleEditPriceLock();
  assert.equal(api.editLockedPrice(), 0, 'UNLOCK goes back to market');
  promptAnswer = 'abc'; api.toggleEditPriceLock();
  assert.equal(api.editLockedPrice(), 0); assert.equal(toasts.at(-1), 'Enter a price above $0 to lock');
  promptAnswer = '$12'; api.toggleEditPriceLock();
  assert.equal(api.editLockedPrice(), 12);
}
console.log('Typed price + ceiling filter checks passed');
