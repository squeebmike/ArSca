import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: discovering a dead cart self-heals the shared index instead of just re-showing it ──
assert.match(dashboard, /if\(!cart \|\| cart\.status !== 'open'\) \{ toast_dash\('That customer cart is no longer open'\); await removeSaleCartFromIndex\(id\); return; \}/, 'switchSaleCart must purge a cart from the shared index once it discovers that cart is no longer open, not just re-fetch the same stale list');
assert.doesNotMatch(dashboard, /toast_dash\('That customer cart is no longer open'\); fetchSaleCartIndex\(\); return;/, 'the old no-op re-fetch (which left the ghost entry in place forever) must be gone');

// ── Contract: a direct close-by-id action exists so staff don't have to JOIN a dead cart first ──
assert.match(dashboard, /async function closeSaleCartById\(id\)\{/, 'closeSaleCartById must exist for direct cleanup from the pill list');
assert.match(dashboard, /if\(id === getActiveSaleCartId\(\)\) return closeActiveSaleCart\(\);/, 'closing the currently active cart by id must delegate to the existing closeActiveSaleCart flow, not duplicate its logic');
assert.match(dashboard, /await removeSaleCartFromIndex\(id\);\s*\n\}\s*\nasync function completeActiveSaleCartAfterCheckout/, 'closeSaleCartById must remove the cart from the shared index as its last step');

// ── Contract: every pill has a visible close control wired to it ──
assert.match(dashboard, /<button class="buy-tray-pill-close" title="Close this cart" onclick="event\.stopPropagation\(\);closeSaleCartById\('\$\{escHtml\(c\.id\)\}'\)">×<\/button>/, 'each cart pill must render its own close control');
assert.match(dashboard, /event\.stopPropagation\(\);closeSaleCartById/, 'the close control must stop the click from also triggering switchSaleCart on the pill underneath it');

console.log('Sale cart ghost-cleanup contract checks passed');
