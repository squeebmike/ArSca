import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store report: a card's print run (e.g. "/250") shows on the PriceCharting
// page linked from every listing, and PriceCharting search results already
// regex-extract it into item.printRun (see the sports-card result mapping),
// but the Add-to-Inventory modal never read that field -- it only checked
// serial_number, which nothing on the PriceCharting path sets. The
// extracted value was computed and then silently thrown away every time.
assert.match(dashboard, /document\.getElementById\('edit-serial'\)\.value = item\.serial_number \|\| \(item\.printRun \? '\/' \+ item\.printRun : ''\);/,
  'openAddToInventoryModal must fall back to the already-extracted item.printRun when serial_number is not set');
// The editing-an-existing-item modal must NOT gain the same fallback --
// an already-saved item's serial_number is authoritative on its own, and
// it never carries a printRun scratch field to begin with.
{
  const openEditModalStart = dashboard.indexOf('function openEditModal(id) {');
  const openEditModalEnd = dashboard.indexOf('function closeEditModal()', openEditModalStart);
  const openEditModalFn = dashboard.slice(openEditModalStart, openEditModalEnd);
  assert.match(openEditModalFn, /document\.getElementById\('edit-serial'\)\.value = item\.serial_number \|\| '';/,
    'openEditModal must keep reading serial_number plainly, with no printRun fallback');
}

// ── Backfill for cards added before the capture fix above ──
// PriceCharting's full product title (print run included, e.g.
// "Julio Rodriguez [Purple] #91 /250") is preserved verbatim in item.name
// even when serial_number never got set -- itemsWithUncapturedPrintRun
// finds those so backfillPrintRunFromName() can fix them without a re-scan.
assert.match(dashboard, /function itemsWithUncapturedPrintRun\(items=all\)\{/, 'missing itemsWithUncapturedPrintRun');
assert.match(dashboard, /return \(items \|\| \[\]\)\.filter\(i => i\.status === 'in_stock' && !i\.serial_number && \/\\\/\\s\*\\d\{1,4\}\\b\/\.test\(String\(i\.name \|\| ''\)\)\);/,
  'itemsWithUncapturedPrintRun must only flag in-stock items with a blank serial_number and a "/NNN" pattern in the name');
assert.match(dashboard, /printRunUncaptured:itemsWithUncapturedPrintRun\(items\)\.length,/, 'inventoryHealthSummary must surface the uncaptured-print-run count');

assert.match(dashboard, /async function backfillPrintRunFromName\(\)\{/, 'missing backfillPrintRunFromName');
{
  const backfillStart = dashboard.indexOf('async function backfillPrintRunFromName(){');
  const backfillEnd = dashboard.indexOf('\n}', backfillStart);
  const backfillFn = dashboard.slice(backfillStart, backfillEnd);
  assert.match(backfillFn, /if\(!matches\.length\)\{ toast_dash\('No items found with a print run in the name but not captured'\); return; \}/,
    'backfill must no-op cleanly (with feedback) when nothing needs fixing, not silently do nothing');
  assert.match(backfillFn, /if\(!confirm\(/, 'backfill must ask for confirmation before mutating any inventory rows -- it touches every matching item in one pass');
  assert.match(backfillFn, /await saveInventoryEdit\(item, \{ serial_number:serial \}\);/, 'backfill must reuse the existing saveInventoryEdit save path (handles built_in/spreadsheet/local sources correctly), not a bespoke write');
  assert.match(backfillFn, /const serial = '\/' \+ printRun;/, 'backfill must write the print run back with its leading slash, matching how it is typed manually elsewhere');
}

// ── Health panel: a dedicated card triggers the backfill directly ──
// Unlike the other health cards (which only filter the table),
// print_run's card runs the fix itself -- filtering to "items with a print
// run in the name" has nothing more useful to show than just fixing them.
assert.match(dashboard, /\['print_run','Print Run In Name',h\.printRunUncaptured,'tap to fill from name','backfillPrintRunFromName\(\)'\],/,
  'the inventory health grid must include a Print Run In Name card wired to run the backfill');
assert.match(dashboard, /<div class="inv-health-card" onclick="\$\{action \|\| `setInventoryHealthFilter\('\$\{f\}'\)`\}">/,
  'the health card template must support a per-card custom action, defaulting to the existing filter-only behavior for every other card');

// ── Functional: the backfill only touches items missing serial_number, and
// never overwrites one a human already typed in ──
{
  const fnStart = dashboard.indexOf('function itemsWithUncapturedPrintRun(items=all){');
  const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
  const itemsWithUncapturedPrintRun = new Function(dashboard.slice(fnStart, fnEnd) + '\nreturn itemsWithUncapturedPrintRun;')();
  const inStockNoSerialWithPrintRun = { id:'a', status:'in_stock', name:'Julio Rodriguez [Purple] #91 /250', serial_number:'' };
  const inStockAlreadyCaptured = { id:'b', status:'in_stock', name:'Julio Rodriguez [Purple] #91 /250', serial_number:'/250' };
  const inStockNoPrintRunInName = { id:'c', status:'in_stock', name:'Plain Base Card #91', serial_number:'' };
  const soldWithUncapturedPrintRun = { id:'d', status:'sold', name:'Some Card /100', serial_number:'' };
  const result = itemsWithUncapturedPrintRun([inStockNoSerialWithPrintRun, inStockAlreadyCaptured, inStockNoPrintRunInName, soldWithUncapturedPrintRun]);
  assert.deepEqual(result.map(i => i.id), ['a'], 'only an in-stock item with a "/NNN" in its name AND a blank serial_number may be flagged -- never one already captured, without a print run at all, or not in stock');
}

console.log('Print run capture (Add-to-Inventory fallback + label + backfill) checks passed');
