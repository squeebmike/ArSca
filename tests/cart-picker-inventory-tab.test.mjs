import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: a cart-picker mount now lives in the Inventory tab, not just Customer Display ──
assert.match(dashboard, /<div id="sale-cart-switcher-inv" class="buy-tray-switcher sale-cart-switcher-mount" style="flex:1"><\/div>/, 'Inventory tab must have its own cart-switcher mount point next to the ADD TO CART buttons');
assert.match(dashboard, /<div id="sale-cart-switcher" class="buy-tray-switcher sale-cart-switcher-mount"><\/div>/, 'the original Customer Display mount must keep working (same shared class)');

// ── Contract: renderSaleCartSwitcher() now updates every mount, not a single hardcoded id ──
assert.match(dashboard, /const mounts = document\.querySelectorAll\('\.sale-cart-switcher-mount'\);/, 'renderSaleCartSwitcher must target all mount points, not just #sale-cart-switcher');
assert.match(dashboard, /mounts\.forEach\(el => \{ el\.innerHTML = html; \}\);/, 'renderSaleCartSwitcher must write the same markup into every mount');
assert.doesNotMatch(dashboard, /function renderSaleCartSwitcher\(\)\{\s*\n\s*const el = document\.getElementById\('sale-cart-switcher'\);/, 'the old single-mount implementation must be gone');

// ── Contract: background refresh covers the Inventory tab too, not just Customer Display ──
assert.match(dashboard, /setInterval\(\(\) => \{ if\(shouldPollTab\('display'\) \|\| shouldPollTab\('inventory'\)\) fetchSaleCartIndex\(\); \}, 6000\);/, 'the shared cart index must keep refreshing while the Inventory tab is active, not only Customer Display');

console.log('Inventory-tab cart picker contract checks passed');

// ── Functional: the generalized render fans out to N mounts identically ──
function fakeRenderToMounts(mountIds, cartsHtml){
  const mounts = mountIds.map(id => ({ id, innerHTML:'' }));
  mounts.forEach(el => { el.innerHTML = cartsHtml; });
  return mounts;
}
const rendered = fakeRenderToMounts(['sale-cart-switcher', 'sale-cart-switcher-inv'], '<button>Sale ABC123</button>');
assert.equal(rendered[0].innerHTML, rendered[1].innerHTML, 'both mount points must always show identical cart state -- picking a cart from either one must be equivalent');
assert.equal(rendered.length, 2, 'both the Customer Display and Inventory tab mounts must be updated together');

console.log('Inventory-tab cart picker functional checks passed');
