import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// The label-print modal previously only let you add items one at a time by
// typing a name into its own search box and clicking +ADD -- no way to
// queue "everything in this category" or "everything this search matched"
// at once. The Inventory tab already narrows `filtered` down to exactly
// what's on screen via its category chips + search box, so
// printLabelsForFilteredItems() reuses that instead of re-implementing
// filtering, and opens the same modal pre-loaded.

// ── The toolbar button must exist and call the new bulk function ──
assert.match(dashboard, /<button class="tab primary" onclick="printLabelsForFilteredItems\(\)"[^>]*>🏷️ LABEL THIS VIEW<\/button>/,
  'an Inventory toolbar button must trigger the bulk label flow');

// ── printLabelsForFilteredItems must exist, filter to in-stock items in
// the current `filtered` view, and hand off to openLabelPrintModal via a
// preset batch rather than duplicating the modal-open/reset logic ──
const fnStart = dashboard.indexOf('function printLabelsForFilteredItems(){');
assert(fnStart >= 0, 'printLabelsForFilteredItems must exist');
const fnEnd = dashboard.indexOf('\n}', fnStart);
const fn = dashboard.slice(fnStart, fnEnd);
assert.match(fn, /\(typeof filtered !== 'undefined' \? filtered : \[\]\)\.filter\(i => i\.status === 'in_stock'\)/,
  'must source items from the Inventory table\'s already-filtered `filtered` array (category chip + search combined), restricted to in-stock items');
assert.match(fn, /if\(!items\.length\)\{ toast_dash\('No in-stock items in the current view to label'\); return; \}/,
  'must give clear feedback instead of silently opening an empty batch when the current view has nothing in stock');
assert.match(fn, /openLabelPrintModal\(null, batch\)/,
  'must reuse openLabelPrintModal\'s existing setup (defaults, rendering, opening) via a preset batch rather than duplicating it');

// ── openLabelPrintModal must accept and use a preset batch instead of
// always starting empty/seeded-by-one-item ──
const modalFnStart = dashboard.indexOf('function openLabelPrintModal(seedItemId, presetBatch){');
assert(modalFnStart >= 0, 'openLabelPrintModal must accept an optional presetBatch');
const modalFnEnd = dashboard.indexOf('\n}', modalFnStart);
const modalFn = dashboard.slice(modalFnStart, modalFnEnd);
assert.match(modalFn, /labelPrintBatch = presetBatch \? presetBatch\.slice\(\) : \[\];/,
  'a preset batch must be used directly (copied, not mutated in place) instead of starting from an empty array');
assert.match(modalFn, /if\(!presetBatch && seedItemId\)\{/,
  'the single-item seed path must be skipped when a preset batch is supplied, so the two entry points cannot fight over labelPrintBatch');

console.log('Bulk label-print-for-filtered-view checks passed');
