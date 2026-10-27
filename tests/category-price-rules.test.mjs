import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

// Store ask: "I wanted to price them to those rules above market." The
// category rule (pct% over market or +$flat, whichever's greater) sets the
// selling price -- dashboard, shop and checkout alike -- instead of only
// capping it.
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const extractFn = (src, name, prefix = 'function ') => {
  const s = src.indexOf(prefix + name + '('); assert.ok(s >= 0, name);
  const line = src.slice(s, src.indexOf('\n', s));
  if(/\}\s*$/.test(line) && line.split('{').length === line.split('}').length) return line + '\n'; // one-line function
  return src.slice(s, src.indexOf('\n}\n', s) + 2);
};

// ── Dashboard price math ──
const priceCtx = vm.createContext({});
vm.runInContext([
  'function roundSellPrice(value){ const n = Number(value || 0); if(!isFinite(n) || n <= 0) return 0; return Math.ceil(n - 1e-9); }',
  'function inventoryIsDropship(){ return false; }',
  ...['inventoryMarketPrice', 'inventoryMinPrice', 'inventoryCeilingPrice', 'inventoryPriceOverride', 'inventorySignatureValue',
    'computeCategoryCeilingPrice', 'inventoryPriceRule', 'inventoryEffectiveBasePrice', 'inventoryListPrice'].map(n => extractFn(dashboard, n)),
  'this.api = { inventoryListPrice, inventoryEffectiveBasePrice, inventoryPriceRule };',
].join('\n'), priceCtx);
const { inventoryListPrice, inventoryPriceRule } = priceCtx.api;
const rule = { pct:10, flat:2 };
assert.equal(inventoryListPrice({ market:8, priceRule:rule }), 10, '$8 market: +$2 beats 10% -> $10');
assert.equal(inventoryListPrice({ market:50, priceRule:rule }), 55, '$50 market: 10% = $5 beats $2 -> $55');
assert.equal(inventoryListPrice({ market:39.14, priceRule:rule }), 44, '$39.14 + $3.91 = $43.05 -> rounds up to $44');
assert.equal(inventoryListPrice({ market:8 }), 8, 'no rule: market rounded up, same as before');
assert.equal(inventoryListPrice({ market:8, priceRule:{} }), 8, 'a cleared rule ({}) is no rule');
assert.equal(inventoryListPrice({ market:8, raw:{ priceRule:rule } }), 10, 'rule read from the saved row too');
assert.equal(inventoryListPrice({ market:50, priceRule:rule, priceOverride:42 }), 42, 'a locked price still wins');
assert.equal(inventoryListPrice({ market:8, priceRule:rule, minPrice:15 }), 15, 'the floor still raises it');
assert.equal(inventoryListPrice({ market:50, priceRule:rule, ceilingPrice:52 }), 52, 'a manual ceiling still caps it');
assert.equal(inventoryListPrice({ market:0, priceRule:rule }), 0, 'no market, no price');
assert.equal(inventoryPriceRule({ priceRule:{ pct:0, flat:0 } }), null);

// ── Saved on the item, round-trips, stamped at creation ──
assert.match(dashboard, /\['priceRule',null,'raw'\],/, 'priceRule must be a BUILT_IN_ITEM_SIMPLE_FIELDS field or it is dropped on the next save');
{
  const fn = dashboard.slice(dashboard.indexOf("async function createBuiltInInventoryItem(item, updates, sourceLabel='built_in') {"), dashboard.indexOf('\nasync function updateBuiltInInventoryItem'));
  assert.match(fn, /priceRule:\(item\?\.priceRule \?\? updates\?\.priceRule \?\? autoPriceRule\),/);
  assert.doesNotMatch(fn, /autoCeiling/, 'the category rule is no longer stamped as a ceiling');
}

// ── APPLY TO IN-STOCK: stamps the rule, drops old auto ceilings, asks before unlocking ──
{
  const items = [
    { id:'a', status:'in_stock', category:'Pokemon TCG', market:8 },
    { id:'b', status:'in_stock', category:'Pokemon TCG', market:20, ceilingPrice:24, priceRule:{ pct:10, flat:2 } },
    { id:'c', status:'in_stock', category:'Pokemon TCG', market:30, priceRule:{ pct:10, flat:2 } },
    { id:'d', status:'in_stock', category:'Pokemon TCG', market:39.14, priceOverride:50 },
    { id:'e', status:'sold', category:'Pokemon TCG', market:8 },
    { id:'f', status:'in_stock', category:'Sports', market:8 },
  ];
  const saves = [], toasts = [];
  let confirms = [];
  const ctx = vm.createContext({ all:items, saves, toasts, confirmAnswers:confirms,
    categoryPriceCeilingRule:c => (c === 'Pokemon TCG' ? { pct:10, flat:2 } : null),
    confirm:msg => { confirms.push(msg); return true; }, toast_dash:m => toasts.push(m), filterTable(){},
    saveInventoryEdit:async (item, updates) => { saves.push([item.id, JSON.parse(JSON.stringify(updates))]); }, console });
  vm.runInContext([
    'function roundSellPrice(value){ const n = Number(value || 0); if(!isFinite(n) || n <= 0) return 0; return Math.ceil(n - 1e-9); }',
    'function inventoryIsDropship(){ return false; }',
    ...['inventoryMarketPrice', 'inventoryMinPrice', 'inventoryCeilingPrice', 'inventoryPriceOverride', 'inventorySignatureValue',
      'computeCategoryCeilingPrice', 'inventoryPriceRule', 'inventoryEffectiveBasePrice', 'categoryPriceRuleStockPlan'].map(n => extractFn(dashboard, n)),
    extractFn(dashboard, 'applyCategoryPriceRuleToStock', 'async function '),
    extractFn(dashboard, 'clearCategoryPriceRuleFromStock', 'async function '),
    'this.api = { categoryPriceRuleStockPlan, applyCategoryPriceRuleToStock, clearCategoryPriceRuleFromStock };',
  ].join('\n'), ctx);
  const plan = ctx.api.categoryPriceRuleStockPlan('Pokemon TCG');
  assert.deepEqual(JSON.parse(JSON.stringify(plan.plan.map(i => i.id))), ['a', 'b', 'd'], 'needs the rule (a, d) or still has an old ceiling (b); c is already right; sold and other categories skipped');
  assert.deepEqual(JSON.parse(JSON.stringify(plan.locked.map(i => i.id))), ['d']);
  await ctx.api.applyCategoryPriceRuleToStock('Pokemon TCG');
  assert.equal(confirms.length, 2, 'asks to apply, then separately about the locked price');
  assert.match(confirms[0], /Example: \$8\.00 market sells at \$10\.00/);
  assert.match(confirms[1], /1 Pokemon TCG item has a 🔒 locked price/);
  const byId = Object.fromEntries(saves.map(([id, u]) => [id, u]));
  assert.deepEqual(Object.keys(byId).sort(), ['a', 'b', 'd']);
  assert.deepEqual(byId.a, { priceRule:{ pct:10, flat:2 }, ceilingPrice:0, salePrice:10, listPrice:10, displayPrice:10 });
  assert.equal(byId.b.ceilingPrice, 0, 'old auto ceiling removed so it can follow market up');
  assert.equal(byId.d.priceOverride, 0, 'unlocked on OK');
  assert.equal(byId.d.listPrice, 44, 'unlocked item mirrors its ruled price');
  assert.match(toasts.at(-1), /^3 Pokemon TCG items now sell at market \+ 10% or \+\$2\.00, whichever is more$/);

  // Cancel on the lock question keeps locked prices untouched.
  items.forEach(i => { delete i.priceRule; delete i.ceilingPrice; });
  items[3].priceOverride = 50;
  saves.length = 0; confirms = []; let n = 0;
  ctx.confirm = msg => { confirms.push(msg); return n++ === 0; };
  await ctx.api.applyCategoryPriceRuleToStock('Pokemon TCG');
  const ids = saves.map(([id]) => id).sort();
  assert.ok(ids.includes('d'), 'a locked item still gets the rule stamped (used if it is unlocked later)');
  const dSave = saves.find(([id]) => id === 'd')[1];
  assert.equal(dSave.priceOverride, undefined, 'locked price kept on Cancel');
  assert.equal(dSave.listPrice, undefined, 'locked price mirrors left alone');

  // CLEAR goes back to plain market.
  saves.length = 0; ctx.confirm = () => true;
  await ctx.api.clearCategoryPriceRuleFromStock('Pokemon TCG');
  const aClear = saves.find(([id]) => id === 'a')[1];
  assert.deepEqual(aClear, { priceRule:{}, ceilingPrice:0, salePrice:8, listPrice:8, displayPrice:8 });
}

// ── Settings panel ──
{
  const fn = extractFn(dashboard, 'renderVendorConfigPanel');
  assert.match(fn, /CATEGORY PRICE RULES/);
  assert.match(fn, /whichever is more, rounded up to the dollar \(10% or \$2: \$8 market sells at \$10, \$50 sells at \$55\)/);
}
assert.match(dashboard, /\{id:'buying',[^}]*keywords:'[^']*price rules markup over market category pricing/, 'Settings search finds it (Buying & Pricing, 2026-10-27)');

// ── Edit modal shows the ruled price ──
{
  const fields = { 'edit-market':{ value:'8' }, 'edit-min-price':{ value:'' }, 'edit-ceiling-price':{ value:'' }, 'edit-locked-price':{ value:'' },
    'edit-list-price':{ value:'', classList:{ toggle(){} } }, 'edit-lock-btn':{ textContent:'' }, 'edit-lock-note':{ textContent:'', classList:{ toggle(){} } } };
  const ctx = vm.createContext({ document:{ getElementById:id => fields[id] }, updateEditProfit(){} });
  vm.runInContext([
    'var editPriceRule = { pct:10, flat:2 };',
    'function roundSellPrice(value){ const n = Number(value || 0); if(!isFinite(n) || n <= 0) return 0; return Math.ceil(n - 1e-9); }',
    extractFn(dashboard, 'computeCategoryCeilingPrice'), extractFn(dashboard, 'editLockedPrice'), extractFn(dashboard, 'refreshEditShelfPrice'),
    'refreshEditShelfPrice();',
  ].join('\n'), ctx);
  assert.equal(fields['edit-list-price'].value, '10.00');
  assert.equal(fields['edit-lock-note'].textContent, 'Follows market + 10% or +$2.00 (category price rule): $8.00 sells at $10.00. LOCK to set an exact price.');
}
assert.match(extractFn(dashboard, 'openEditModal'), /editPriceRule = inventoryPriceRule\(item\);\s*setEditLockedPrice\(inventoryPriceOverride\(item\)\);/);
assert.match(extractFn(dashboard, 'openAddToInventoryModal'), /editPriceRule = inventoryPriceRule\(item\) \|\| categoryPriceCeilingRule\(item\.category\);/);

// ── Price sync keeps mirror fields at the ruled price ──
assert.match(dashboard, /const ruled = computeCategoryCeilingPrice\(p\.newPrice, inventoryPriceRule\(fullItem\)\) \|\| p\.newPrice; return \{ salePrice:ruled, listPrice:ruled \};/);

// ── Worker: shop + checkout sell at the same ruled price ──
{
  const ctx = vm.createContext({});
  vm.runInContext([extractFn(worker, 'roundUpToDollar'), extractFn(worker, 'marketRulePrice'), 'this.marketRulePrice = marketRulePrice;'].join('\n'), ctx);
  assert.equal(ctx.marketRulePrice(8, rule), 10);
  assert.equal(ctx.marketRulePrice(50, rule), 55);
  assert.equal(ctx.marketRulePrice(7.01, null), 8, 'no rule: market rounded up, as before');
  assert.equal(ctx.marketRulePrice(7.01, {}), 8);
  assert.equal(ctx.marketRulePrice(0, rule), 0);
}
assert.match(worker, /const checkoutBase = Number\(d\.priceOverride \|\| 0\) \|\| marketRulePrice\(Number\(d\.market \|\| d\.marketPrice \|\| d\.rawMarketPrice \|\| d\.price \|\| 0\) \|\| 0, d\.priceRule\);/, 'checkout charges the ruled price');
assert.match(extractFn(worker, 'shapeStorefrontItem'), /const rowBase = Number\(d\.priceOverride \|\| 0\) \|\| marketRulePrice\(rowMarket, d\.priceRule\);/, 'the shop shows the ruled price');

console.log('Category price rule checks passed');
