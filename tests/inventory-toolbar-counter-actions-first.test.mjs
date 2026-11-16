import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store ask: one-off, scan to cart and scan to find go on the far left of the
// Inventory toolbar, so they're reachable on a phone without scrolling it.
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const start = dashboard.indexOf('<div class="tabs inv-action-tabs" role="toolbar" aria-label="Inventory actions">');
assert.ok(start >= 0);
const bar = dashboard.slice(start, dashboard.indexOf('</div>', start));
const order = [...bar.matchAll(/onclick="([A-Za-z]+)\(/g)].map(m => m[1]);
assert.deepEqual(order.slice(0, 3), ['openOneOffSellModal', 'openCartScanModal', 'openInventoryFindScanner']);
// PASTE TO INVENTORY (2026-11-16) comes right after them.
assert.equal(order[3], 'openInventoryPaste');
for (const fn of ['openInventoryPaste', 'openPriceSyncModal', 'runPriceSyncForFilteredItems', 'openLabelPrintModal', 'printLabelsForFilteredItems', 'publishFilteredToStorefrontView', 'openGiftCardSellModal']) {
  assert.ok(order.includes(fn), fn + ' is still on the toolbar');
}
assert.equal(order.length, 10, 'nothing added or lost');
console.log('Inventory toolbar counter actions first checks passed');
