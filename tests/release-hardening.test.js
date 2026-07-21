const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dashboard = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');
const deckLab = fs.readFileSync(path.join(root, 'mtg-deck-lab.html'), 'utf8');

const appVersion = dashboard.match(/const APP_VERSION = '([^']+)'/)?.[1];
const metaVersion = dashboard.match(/<meta name="version" content="([^"]+)">/)?.[1];
const visibleVersion = dashboard.match(/id="dsb-version">v([^<]+)</)?.[1];
assert.ok(appVersion, 'dashboard APP_VERSION must exist');
assert.equal(metaVersion, appVersion, 'update metadata must match APP_VERSION');
assert.equal(visibleVersion, appVersion, 'visible version stamp must match APP_VERSION');
const assetVersions = [...dashboard.matchAll(/<script src="[^"]+\?v=([^"]+)"/g)].map(match => match[1]);
assert.ok(assetVersions.length, 'versioned dashboard scripts must exist');
assert.ok(assetVersions.every(version => version === appVersion), 'dashboard script cache keys must match APP_VERSION');
assert.match(dashboard, /function reloadIntoAppVersion/, 'update banner should navigate to a versioned page URL');

assert.match(dashboard, /let checkoutFinalizing = false;/, 'checkout finalization lock should exist');
assert.match(dashboard, /if\(checkoutFinalizing\) return toast_dash\('Checkout is already finalizing'\);/, 'checkout should ignore duplicate finalization attempts');
assert.match(dashboard, /\.eq\('store_id', storeId\)/, 'built-in inventory updates should include store_id filter');
assert.match(dashboard, /function inventoryItemIsSellable\(item\)/, 'all sale entry points should share an availability guard');
assert.match(dashboard, /quantity \+ alreadyInCart > available/, 'cart should block inventory overselling');
assert.match(dashboard, /const nextQty = Math\.max\(0, Number\(updates\.qty \?\? item\.qty \?\? 1\) \|\| 0\);/, 'built-in inventory quantity should clamp below zero');
assert.match(dashboard, /async function addAllFromScannerQueue\(\)/, 'research queue bulk buy button should have a handler');
assert.match(dashboard, /return addAllScansToBuyList\(\);/, 'research queue bulk buy handler should reuse scanner buy-list flow');
assert.match(dashboard, /DECK LAB BETA/, 'dashboard should label Deck Lab as beta');
assert.match(deckLab, /Deck Lab Beta/, 'Deck Lab page should label itself as beta');

for (const file of ['TESTER_RELEASE_CHECKLIST.md', 'KNOWN_ISSUES.md', 'DATA_MODEL_NOTES.md', path.join('supabase', 'seed.sql')]) {
  assert.ok(fs.existsSync(path.join(root, file)), `${file} should exist for tester beta release`);
}

console.log('Release hardening checks passed');
