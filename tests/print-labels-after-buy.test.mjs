import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync('dashboard.html', 'utf8');

// Store report: "I need a good workflow for printing labels after we make a
// buy. sometimes its 1 item. sometimes its 100 or more." The buy-accept
// confirmation screen (showBuyPaymentConfirm) had zero connection to the
// existing, already-hardened label-print modal despite having the exact
// list of just-created inventory items on screen -- a dealer had to
// separately hunt each new item down in the Inventory tab (or re-search it
// by hand in the label modal) to print its label at all. This wires the
// confirm screen directly into the same batch-print mechanism already used
// by the "LABEL THIS VIEW" toolbar button, so it scales the same way from
// 1 item to 100+.

// The confirm screen must offer the button, showing how many items it covers.
assert.match(html, /onclick="printLabelsForAcceptedBuy\(\)"[^>]*>🏷️ PRINT LABELS \(\$\{items\.length\}\)</,
  'showBuyPaymentConfirm must render a print-labels button sized to the accepted item count');

const fnStart = html.indexOf('async function printLabelsForAcceptedBuy');
const fnEnd = html.indexOf('\nfunction syncBuyConfirmCustomer', fnStart);
const fnBody = html.slice(fnStart, fnEnd);

assert.ok(fnStart !== -1, 'printLabelsForAcceptedBuy must exist');

// Must read from buyList, not session.items -- session.items is a shallow
// copy taken by snapshotBuySession() BEFORE bulkAddBuyListToInventory()
// assigns inventoryId, so it's stale/undefined by the time this button is
// clickable. buyList itself is what createBuyItemInventoryRecord mutates in
// place, and it isn't cleared until the tray closes.
assert.match(fnBody, /const ids = buyList\.filter\(i => i\.inventoryId\)\.map\(i => String\(i\.inventoryId\)\);/,
  'must source item ids from buyList (mutated in place with real inventoryId values), not from the stale session.items snapshot');
assert.match(fnBody, /if\(!ids\.length\)\{ toast_dash\('No inventory items to label yet'\); return; \}/,
  'must guard against a batch where nothing actually made it into inventory yet (e.g. every item failed)');

// Must reload inventory before reading `all` -- bulkAddBuyListToInventory
// only fires loadInventory() without awaiting it, so a fast click on this
// button could otherwise race ahead of that refresh and find nothing.
assert.match(fnBody, /await loadInventory\(\);/,
  'must await a fresh inventory load so newly-created items are guaranteed to be in `all` before building the label batch');
assert.match(fnBody, /const items = \(all \|\| \[\]\)\.filter\(i => idSet\.has\(String\(i\.id\)\)\);/,
  'must look the new items up in the real inventory array, not reconstruct label data from raw buy-list fields (which lack price-floor/signature/etc adjustments)');

// Must hand off to the existing, already-hardened batch label mechanism
// (large-batch frame-yielding, size/layout/code-style persistence) instead
// of reimplementing any of it.
assert.match(fnBody, /openLabelPrintModal\(null, items\.map\(labelBatchEntryFromItem\)\);/,
  'must reuse openLabelPrintModal + labelBatchEntryFromItem, the same mechanism LABEL THIS VIEW uses, so 1-to-100+ item batches get the same hardened print path');

console.log('Print labels after buy contract check passed');
