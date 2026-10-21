import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Store ask: "what tells me how old the price data is for items in
// inventory?" Only a STALE badge did. Each item now says "price as of
// Oct 12 (8 days)" in the list, on its card and on its edit screen, and
// PRICE 30+ DAYS lists in-stock items whose market price is a month old.
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
const html = fs.readFileSync('dashboard.html', 'utf8');
const fn = name => { const s = app.indexOf('function ' + name + '('); assert.ok(s >= 0, name); return app.slice(s, app.indexOf('\n}\n', s) + 2); };
const ctx = { Date };
vm.runInNewContext(['const PRICE_OLD_DAYS = 30;', 'function inventoryMarketPrice(i){ return Number(i.market) || 0; }', 'function inventoryIsDropship(i){ return i.dropship === true; }',
  ...['inventoryPriceDate', 'inventoryPriceAgeApplies', 'inventoryPriceAgeDays', 'inventoryPriceAgeLabel', 'inventoryPriceIsOld', 'inventoryPriceAgeColor'].map(fn),
  'this.api = { inventoryPriceAgeLabel, inventoryPriceIsOld, inventoryPriceAgeColor, inventoryPriceAgeDays };'].join('\n'), ctx);
const { inventoryPriceAgeLabel: label, inventoryPriceIsOld: old, inventoryPriceAgeColor: color } = ctx.api;
const ago = d => new Date(Date.now() - d * 86400000).toISOString();
const fresh = { market: 10, category: 'Pokemon TCG', priceUpdatedAt: ago(8) };
assert.match(label(fresh), /^price as of [A-Z][a-z]{2} \d{1,2} \(8 days\)$/);
assert.equal(color(fresh), 'var(--dim)');
assert.equal(old(fresh), false);
assert.match(label({ market: 10, pokemonPriceTrackerLastUpdated: ago(0) }), /\(today\)$/);
assert.match(label({ market: 10, lastPriceUpdate: ago(1) }), /\(1 day\)$/);
const twoWeeks = { market: 10, priceUpdatedAt: ago(20) };
assert.equal(color(twoWeeks), 'var(--gold)'); assert.equal(old(twoWeeks), false);
const month = { market: 10, priceUpdatedAt: ago(45) };
assert.equal(color(month), 'var(--red)'); assert.equal(old(month), true, 'over 30 days');
const undated = { market: 4.99, category: 'Comic' };
assert.equal(label(undated), 'price date unknown'); assert.equal(old(undated), true, 'never dated counts as old');
assert.equal(color(undated), 'var(--gold)');
assert.equal(label({ market: 0 }), '', 'no market price: nothing to date');
assert.equal(label({ market: 12, category: 'Supplies' }), '', 'supplies are priced by the supplier');
assert.equal(old({ market: 12, dropship: true }), false);
assert.match(label({ market: 10, priceUpdatedAt: '2025-03-02T00:00:00Z' }), /Mar 2, 2025/, 'a past year shows the year');

// Shown in the list, on the card and on the edit screen; filter and health card.
assert.match(app, /\$\{inventoryPriceAgeLabel\(i\)\?`<br><span class="inv-price-age"/);
assert.match(app, /<div class="inv-card-meta inv-price-age" style="color:\$\{inventoryPriceAgeColor\(i\)\}">/);
assert.match(html, /<div id="edit-market-age"/);
assert.equal((app.match(/  setEditMarketAge\(item\);\n/g) || []).length, 2, 'edit and add screens');
assert.match(app, /if\(flag === 'old_price'\) return inventoryPriceIsOld\(i\);/);
assert.match(html, /setF\('flag','old_price',this\)">Price 30\+ Days<\/button>/);
assert.match(app, /\['old_price','Price 30\+ Days',h\.oldPrice,/);
console.log('Inventory price age checks passed');
