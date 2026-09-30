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
assert.match(dashboard, /<th class="th-thumb"><input type="checkbox" id="inv-bulk-select-all" title="Select all rows on this page" onchange="toggleInvBulkSelectAllPage\(this\.checked\)"><\/th>/, 'missing the select-all-on-page header checkbox');

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
