import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store request: pick a specific handful of items out of the main Inventory
// table (not "everything currently filtered", which the existing "THIS
// VIEW" toolbar buttons already do) and export them as a CSV in Whatnot's
// own bulk-import template shape -- a free alternative to Shopify's paid
// Sales Channel integration for a shop that only needs inventory in Whatnot
// for occasional live shows.

assert.match(dashboard, /let inventoryBulkSelectedIds = new Set\(\);/, 'missing the bulk-selection Set');

// Per-row checkbox lives inside the existing thumbnail cell (not as a new
// table column) so the responsive mobile CSS grid, which maps cells by
// column index, doesn't need to change.
assert.match(dashboard, /const bulkCb = `<input type="checkbox" class="inv-bulk-cb" value="\$\{i\.id\}" \$\{bulkChecked\?'checked':''\} onchange="invBulkCheckboxChanged\(this\)"/, 'missing the per-row bulk-select checkbox');
assert.match(dashboard, /const thumbCell = `<td class="td-thumb">\$\{bulkCb\}<div onclick="\$\{editClick\}"/, 'the bulk checkbox must be a sibling of the thumbnail click handler, not swallowed by it');

// Header "select all on this page" checkbox, kept in the existing empty
// th-thumb header cell rather than adding a new column.
assert.match(dashboard, /<th class="th-thumb"><input type="checkbox" id="inv-bulk-select-all" title="Select everything the filters show \(every page\)" onchange="toggleInvBulkSelectAllPage\(this\.checked\)"><\/th>/, 'missing the select-all-on-page header checkbox');

assert.match(dashboard, /function invBulkCheckboxChanged\(cb\)\{/, 'missing invBulkCheckboxChanged');
assert.match(dashboard, /function toggleInvBulkSelectAllPage\(checked\)\{/, 'missing toggleInvBulkSelectAllPage');
assert.match(dashboard, /function toggleInvBulkSelectAllFiltered\(\)\{/, 'missing toggleInvBulkSelectAllFiltered');
assert.match(dashboard, /function clearInvBulkSelection\(\)\{/, 'missing clearInvBulkSelection');

// The bulk-action bar must be hidden until something is actually selected --
// it shouldn't take up permanent space in the normal (nothing checked) case.
const barStart = dashboard.indexOf('<div id="inv-bulk-bar"');
assert.notEqual(barStart, -1, 'missing the bulk-action bar');
assert.match(dashboard.slice(barStart, barStart + 200), /style="display:none;/, 'the bulk-action bar must start hidden until a row is selected');
assert.match(dashboard, /function renderInvBulkBar\(\)\{/, 'missing renderInvBulkBar');
assert.match(dashboard, /bar\.style\.display = n>0 \? '' : 'none';/, 'renderInvBulkBar must toggle the bar\'s visibility based on selection count');

// The bulk bar's EXPORT TO WHATNOT CSV hands the checked items to the
// Whatnot tab's export panel (scripts/whatnot-bridge.js), which writes
// Whatnot's exact template columns -- see tests/whatnot-bridge.test.mjs for
// the CSV itself, including that unmapped Whatnot categories stay blank
// rather than guessed from this app's own category names.
assert.match(dashboard, /function exportSelectedToWhatnotCsv\(\)\{/, 'missing exportSelectedToWhatnotCsv');
const exportStart = dashboard.indexOf('function exportSelectedToWhatnotCsv(){');
const exportEnd = dashboard.indexOf('\n}', exportStart) + 2;
const exportFn = dashboard.slice(exportStart, exportEnd);
assert.match(exportFn, /const items = all\.filter\(i => inventoryBulkSelectedIds\.has\(i\.id\)\);/, 'must export exactly the checked items, not the whole filtered view');
assert.match(exportFn, /if\(!items\.length\)\{ toast_dash\('Select at least one item first'\); return; \}/, 'must guard against exporting with nothing selected');
assert.match(exportFn, /switchTab\('whatnot'\);/, 'opens the Whatnot tab export panel');
assert.match(exportFn, /window\.WB\.set\('source', 'selected'\)/, 'with the checked items chosen');

console.log('Inventory bulk-select and Whatnot CSV export checks passed');

// 2026-11-19: the header box takes every item the filters show, on every page -- not just the 50 on screen.
{ const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
  assert.ok(app.includes("list.forEach(i => { if(checked) inventoryBulkSelectedIds.add(i.id); else inventoryBulkSelectedIds.delete(i.id); });"));
  assert.ok(app.includes("const allIds = (filtered || []).map(r => r.id);"));
  console.log('Inventory: header box selects every page: passed'); }
// 2026-11-22: "filter by release date, especially for comics -- newest to oldest, oldest to newest".
{ const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8'), html = fs.readFileSync('dashboard.html', 'utf8');
  assert.ok(html.includes('<select class="tsi" id="inv-sort" onchange="filterTable()"') && html.includes('<option value="release-new">Release date: newest first</option><option value="release-old">Release date: oldest first</option>'));
  const key = new Function(app.match(/function inventoryReleaseKey\(i\)\{[\s\S]*?\n\}/)[0] + '; return inventoryReleaseKey;')();
  assert.equal(key({ onSaleDate: '2026-12-02' }), '2026-12-02'); assert.equal(key({ raw: { onSaleDate: '2026-11-04T00:00:00' } }), '2026-11-04'); assert.equal(key({ year: '1991' }), '1991-00-00'); assert.equal(key({}), '');
  assert.ok(app.includes("if(!av || !bv) return av ? -1 : bv ? 1 :"), 'no date: last either way');
  console.log('Inventory: sort by release date: passed'); }
