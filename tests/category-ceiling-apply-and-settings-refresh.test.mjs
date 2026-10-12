import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store asks: "refresh pokemon inventory to use this rule -- the ones in
// stock" and "these shouldn't be device rules, but all devices on this store."
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const extractFn = (name, prefix = 'function ') => { const s = dashboard.indexOf(prefix + name + '('); assert.ok(s >= 0, name); return dashboard.slice(s, dashboard.indexOf('\n}\n', s) + 2); };

// APPLY TO IN-STOCK: ceiling from the rule; never below today's price; a
// locked price above it is left alone; already-right items are skipped.
{
  const all = [
    { id:'a', status:'in_stock', category:'Pokemon TCG', market:6.69 },
    { id:'b', status:'in_stock', category:'Pokemon TCG', market:146.84, priceOverride:275 },
    { id:'c', status:'in_stock', category:'Pokemon TCG', market:20, ceilingPrice:22 },
    { id:'d', status:'sold', category:'Pokemon TCG', market:30 },
    { id:'e', status:'in_stock', category:'Sports', market:30 },
    { id:'f', status:'in_stock', category:'Pokemon TCG', market:0 },
  ];
  const roundSellPrice = v => Math.ceil(Number(v) - 1e-9);
  const plan = new Function('all', 'categoryPriceCeilingRule', 'roundSellPrice', 'inventoryIsDropship', 'inventoryMarketPrice', 'inventoryPriceOverride', 'inventoryCeilingPrice',
    [extractFn('computeCategoryCeilingPrice'), extractFn('categoryCeilingStockPlan'), 'return categoryCeilingStockPlan;'].join('\n'))(
    all, c => c === 'Pokemon TCG' ? { pct:10, flat:2 } : null, roundSellPrice, () => false,
    i => Number(i.market || 0), i => Number(i.priceOverride || 0), i => Number(i.ceilingPrice || 0));
  const r = plan('Pokemon TCG');
  assert.deepEqual(r.plan.map(x => [x.item.id, x.ceiling]), [['a', 9]], '$6.69 + $2 -> $9; c already at its $22 ceiling');
  assert.deepEqual(r.lockedAbove.map(i => i.id), ['b'], 'locked $275 above a $162 ceiling: left alone');
  assert.equal(plan('Sports').plan.length, 0, 'no rule -> nothing');
}
assert.match(extractFn('renderVendorConfigPanel'), /onclick="applyCategoryCeilingToStock\('\$\{safe\}'\)">APPLY TO IN-STOCK<\/button>/);
assert.match(extractFn('renderVendorConfigPanel'), /onclick="clearCategoryCeilingFromStock\('\$\{safe\}'\)">CLEAR<\/button>/);
assert.match(extractFn('renderVendorConfigPanel'), /Saved for the whole store, so every device uses it/);
assert.match(extractFn('applyCategoryCeilingToStock', 'async function '), /await saveInventoryEdit\(item, \{ ceilingPrice:ceiling \}\)/);

// Store settings re-read from the cloud: forced when Settings opens, quiet
// (no redraw) when the app comes back to the foreground.
{
  const fn = extractFn('refreshStoreSettingsFromCloud', 'async function ');
  assert.match(fn, /supabaseStoreSettingsLoaded = false;\s*try \{ await loadStoreSettingsFromSupabase\(\); \}/);
  assert.match(fn, /if\(!force && Date\.now\(\) - _storeSettingsRefreshedAt < 120000\) return;/);
}
assert.match(dashboard, /document\.addEventListener\('visibilitychange', \(\) => \{ if\(document\.visibilityState === 'visible'\) refreshStoreSettingsFromCloud\(\); \}\);/);
assert.match(extractFn('switchTab'), /if\(name === 'backoffice'\) setTimeout\(\(\) => refreshStoreSettingsFromCloud\(\{ force:true, redraw:true \}\), 0\);/);
console.log('Category ceiling apply + settings refresh checks passed');
