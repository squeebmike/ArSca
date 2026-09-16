import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store gap: the Dead Inventory Radar's SUGGESTED ACTION column (Reports ->
// Slow Movers) was plain static text -- reading "BUNDLE" or "EBAY OFFER"
// gave staff no way to actually act on it from that row, only a separate
// EDIT button. Both suggestions resolve to the same one-click action this
// dashboard already has: opening the eBay listing modal, which already
// defaults its QTY field to the item's full on-hand count -- so a
// multi-copy BUNDLE row's "combine into one lot" is just listing all N
// copies as one eBay listing, no separate mechanism needed.

assert.match(dashboard, /function slowMoverActionCellHtml\(s\)\{/, 'missing slowMoverActionCellHtml');
assert.match(dashboard, /const SLOW_MOVER_ACTION_HANDLERS = \{ BUNDLE: 'openEbayFromDash', 'EBAY OFFER': 'openEbayFromDash' \};/, 'BUNDLE and EBAY OFFER suggestions must both map to opening the eBay listing form');

const fnStart = dashboard.indexOf('function slowMoverActionCellHtml(s){');
const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
const slowMoverActionCellHtml = new Function('escHtml', dashboard.slice(dashboard.indexOf('const SLOW_MOVER_ACTION_HANDLERS'), fnEnd) + '\nreturn slowMoverActionCellHtml;')(
  s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
);

const bundleRow = { id: 'item-1', action: 'BUNDLE', actionReason: '3 copies on hand -- combine into one lot instead of selling one at a time' };
const bundleHtml = slowMoverActionCellHtml(bundleRow);
assert.match(bundleHtml, /onclick="openEbayFromDash\('item-1'\)"/, 'a BUNDLE row must be clickable and open the eBay listing form for that exact item');
assert.match(bundleHtml, /cursor:pointer/, 'a clickable suggestion must look clickable, not just say "help" like the static ones');

const ebayRow = { id: 'item-2', action: 'EBAY OFFER', actionReason: 'High enough value to be worth a dedicated eBay listing with Best Offer enabled' };
assert.match(slowMoverActionCellHtml(ebayRow), /onclick="openEbayFromDash\('item-2'\)"/, 'an EBAY OFFER row must also be clickable');

// Suggestions with no concrete one-click action in this dashboard (yet)
// must stay as plain informational text, not silently call a handler that
// doesn't exist for them.
for (const action of ['MARKDOWN', 'CONVENTION BOX', 'RUN ON WHATNOT', 'HOLD']) {
  const html = slowMoverActionCellHtml({ id: 'item-3', action, actionReason: 'reason' });
  assert.doesNotMatch(html, /onclick=/, `${action} has no wired action yet and must render as plain text, not a broken/misleading click handler`);
  assert.match(html, /cursor:help/, `${action} must keep the informational (not clickable) styling`);
}

console.log('Dead Inventory Radar actionable-suggestion checks passed');

// Wired into the actual table render (not just defined).
assert.match(dashboard, /<td>\$\{slowMoverActionCellHtml\(s\)\}<\/td>/, 'the Slow Movers table must actually render through slowMoverActionCellHtml, not the old static span inline');

console.log('Dead Inventory Radar table wiring checks passed');
