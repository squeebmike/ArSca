import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isSlabRow, staleSlabRows, stockHealthIssues } from '../scripts/foc-preorders.mjs';

const ui = readFileSync(new URL('../scripts/dashboard-app.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../cloudflare-worker-full.js', import.meta.url), 'utf8');
const fnSrc = name => {
  const start = ui.search(new RegExp('(async )?function ' + name + '\\('));
  assert.ok(start >= 0, name);
  const end = ui.indexOf('\n}\n', start);
  return ui.slice(start, end + 2);
};
const lineOf = prefix => { const s = ui.indexOf(prefix); assert.ok(s >= 0, prefix); return ui.slice(s, ui.indexOf('\n', s)); };

// ── Slabs ──
// Store report: "some slabs aren't reading they're slabs." Pikachu ex
// 219/191 PSA 10 and Meowth 106 (bought at its PSA 10 price) had no
// grader/grade saved, so every sync priced them as raw cards.
const slab = new Function('inventoryCardName',
  [lineOf('const SLAB_GRADE_RE ='), fnSrc('parseSlabGradeText'), fnSrc('inventoryGradingInfo'), fnSrc('slabSearchName')].join('\n') + '; return { parseSlabGradeText, inventoryGradingInfo, slabSearchName };')(
  i => i.name || '');
{
  const { parseSlabGradeText: p, inventoryGradingInfo: g, slabSearchName } = slab;
  assert.deepEqual(p('PSA 10'), { grader: 'PSA', grade: '10' });
  assert.deepEqual(p('bgs 9.5'), { grader: 'BGS', grade: '9.5' });
  assert.deepEqual(p('Beckett 9.5'), { grader: 'BGS', grade: '9.5' });
  assert.deepEqual(p('CGC GEM MINT 10'), { grader: 'CGC', grade: '10' });
  assert.equal(p('Slab Bumpers - PSA Card - Black'), null, 'PSA with no grade is not a slab');
  assert.equal(p('PSA 100'), null);
  assert.equal(p('Raw'), null);

  assert.deepEqual(g({ name: 'Pikachu ex - 219/191 PSA 10', category: 'Pokemon TCG' }), { grader: 'PSA', grade: '10' }, 'grade in the name');
  assert.deepEqual(g({ name: 'Meowth 106', category: 'Pokemon TCG', selectedGrade: 'PSA 10' }), { grader: 'PSA', grade: '10' }, 'bought at its PSA 10 price');
  assert.deepEqual(g({ name: 'Meowth 106', category: 'Pokemon TCG', activePriceBasis: JSON.stringify({ grade: 'PSA 9' }) }), { grader: 'PSA', grade: '9' }, 'price basis saved as text');
  assert.deepEqual(g({ name: 'Cal Raleigh', grader: 'PSA', grade: '9' }), { grader: 'PSA', grade: '9' }, 'saved fields win');
  assert.deepEqual(g({ name: 'Charizard PSA 10', grader: 'CGC', category: 'Pokemon TCG' }), { grader: 'CGC', grade: '10' }, 'a saved grader is kept');
  assert.deepEqual(g({ name: 'Slab Bumpers - PSA 10 pack', category: 'Supplies' }), { grader: '', grade: '' }, 'supplies never count');
  assert.deepEqual(g({ name: 'Pikachu PSA 10 plush', category: 'Pokemon Plush' }), { grader: '', grade: '' });
  assert.deepEqual(g({ name: 'Charizard 4/102', category: 'Pokemon TCG', selectedGrade: '' }), { grader: '', grade: '' });
  assert.equal(slabSearchName({ name: 'Pikachu ex - 219/191 PSA 10' }), 'Pikachu ex - 219/191', 'searched without its grade');
}

// A slab's saved PriceCharting page is used before a name search (Magikarp
// CGC 10 had its page saved but the search never matched).
{
  const calls = [];
  const fetchMock = async url => { calls.push(String(url)); return { ok: true, json: async () => ({ ok: true, product: { prices: { cgc10: 41, psa10: 90 }, url: 'https://www.pricecharting.com/game/x/magicarp' } }) }; };
  const resolve = async link => link.id || (link.url ? '777' : '');
  const api = new Function('fetch', 'WORKER', 'resolveSportsPcProductId', 'pcGradeBucket', 'inventoryGradingInfo', 'inventorySetName', 'inventoryCardNumber', 'slabSearchName',
    [fnSrc('slabPcLinkForItem'), fnSrc('fetchPinnedSlabPrice'), fnSrc('fetchGradedSlabPriceForItem')].join('\n') + '; return { fetchGradedSlabPriceForItem, slabPcLinkForItem };')(
    fetchMock, 'https://w', resolve, (c, g) => (c === 'CGC' && g === '10' ? 'cgc10' : c === 'PSA' && g === '10' ? 'psa10' : ''), i => ({ grader: i.grader, grade: i.grade }), i => i.set || '', () => '', i => i.name);
  const got = await api.fetchGradedSlabPriceForItem({ name: 'Magicarp', grader: 'CGC', grade: '10', providerUrl: 'https://www.pricecharting.com/game/pokemon-japanese-taruka/magicarp' });
  assert.equal(got.price, 41);
  assert.match(got.source, /PriceCharting graded \(CGC 10, pinned #777\)/);
  assert.deepEqual(calls, ['https://w/pricing/pricecharting/product/777']);
  assert.deepEqual(api.slabPcLinkForItem({ pricechartingProductId: '123', sourceProductId: '999' }), { id: '123', url: '' });
  assert.deepEqual(api.slabPcLinkForItem({ sourceProductId: '999', tcgPlayerId: '5' }), { id: '', url: '' }, 'another site\'s product id is never taken for PriceCharting\'s');
}
// Buying at a graded price saves the item as a slab.
assert.ok(fnSrc('buyItemToInventoryUpdates').includes("const slab = inventoryGradingInfo({ ...item, selectedGrade:item.activePriceBasis?.grade || item.selectedGrade || item.slabGrade || '' });"));
assert.ok(fnSrc('buyItemToInventoryUpdates').includes('    grader:slab.grader,\n    grade:slab.grade,'));

// The 6-hour stock check lists slabs with no graded price in 7+ days.
{
  const now = Date.parse('2026-10-25T12:00:00Z');
  assert.equal(isSlabRow({ name: 'Pikachu ex PSA 10', category: 'Pokemon TCG' }), true);
  assert.equal(isSlabRow({ name: 'Meowth 106', selectedGrade: 'PSA 10' }), true);
  assert.equal(isSlabRow({ name: 'Slab Bumpers - PSA Card', category: 'Supplies' }), false);
  assert.equal(isSlabRow({ name: 'Charizard', grader: 'PSA', grade: '' }), false);
  const rows = staleSlabRows([
    { id: 'a', name: 'Magicarp', grader: 'CGC', grade: '10', priceUpdatedAt: '2026-10-17T19:23:19Z' },
    { id: 'b', name: 'Skenes', grader: 'PSA', grade: '10', priceUpdatedAt: '2026-10-21T19:07:48Z' },
    { id: 'c', name: 'Cal Raleigh', grader: 'PSA', grade: '9', priceUpdatedAt: '' },
    { id: 'd', name: 'Plain card', priceUpdatedAt: '' },
  ], now);
  assert.deepEqual(rows.map(r => [r.itemId, r.note]), [['a', 'last priced 2026-10-17'], ['c', 'never priced']]);
  const issue = stockHealthIssues({ staleSlabs: rows }).issues.find(i => i.key === 'stale-slabs');
  assert.equal(issue.count, 2);
  assert.equal(issue.severity, 'medium');
}

// ── Automatic floor ──
// Store ask: "I don't want to lose money ... all floors should be eBay
// fees in mind ... ie 4.99 comics."
const floor = new Function('getVendorConfig', 'inventoryCardName', 'inventoryIsDropship', 'inventoryCostBasis', 'roundSellPrice', 'inventoryEffectiveBasePrice',
  [lineOf('const DEFAULT_FLOOR_RULES ='), fnSrc('floorRules'), fnSrc('floorProfitRuleFor'), fnSrc('ebayFloorPrice'), fnSrc('ebayNetProfit'), fnSrc('computeAutoFloor'),
    lineOf('function inventoryMinPrice('), lineOf('function inventoryAutoFloor('), lineOf('function inventoryFloorPrice('), fnSrc('inventoryHeldAtFloor')].join('\n') +
  '; return { floorRules, floorProfitRuleFor, ebayFloorPrice, ebayNetProfit, computeAutoFloor, inventoryFloorPrice, inventoryHeldAtFloor };');
const cfg = { floorRules: {} };
const F = floor(() => cfg, i => i.name || '', i => !!i.dropship, i => Number(i.cost || 0), v => (Number(v) > 0 ? Math.ceil(Number(v) - 1e-9) : 0), i => Number(i.base || 0));
{
  const r = F.floorRules();
  assert.equal(r.on, true, 'on by default');
  assert.deepEqual([r.ebayPct, r.orderFee, r.orderFeeOver10, r.profit], [13.25, 0.30, 0.40, 0.50]);
  // (cost + $0.30 + $0.50) / (1 - 13.25%), rounded up to the dollar.
  assert.equal(F.ebayFloorPrice(2.5, { profit: 0.5 }), 4, '$2.50 comic: $3.80 -> $4');
  assert.equal(F.ebayFloorPrice(4, { profit: 0.5 }), 6, '$4 comic: $5.53 -> $6');
  assert.equal(F.ebayFloorPrice(9, { profit: 0.5 }), 12, 'over $10 the order fee is $0.40');
  assert.equal(F.ebayFloorPrice(45, { profit: 0.5 }), 53);
  assert.equal(F.ebayFloorPrice(0, { profit: 0.5 }), 0, 'no cost, no floor');
  assert.equal(F.ebayFloorPrice(20, { profit: 1, profitPct: 25 }), 30, 'bigger of $ and %: 25% of $20 = $5');
  assert.equal(F.ebayNetProfit(4.99, 2.5), 1.53, '$4.99 comic that cost $2.50 keeps $1.53 after eBay');
  assert.equal(F.ebayNetProfit(4.99, 4), 0.03, 'one that cost $4 keeps 3 cents');
  assert.ok(F.ebayNetProfit(F.ebayFloorPrice(4, { profit: 0.5 }), 4) >= 0.5, 'the floor always clears cost + profit after fees');
}
{
  cfg.floorRules = { categories: { Comic: { profit: 1 } }, names: [{ match: 'Secret Lair', profit: 10 }] };
  assert.deepEqual(F.floorProfitRuleFor({ name: 'Secret Lair: Bob Ross', category: 'Magic: The Gathering' }).from, 'name has "Secret Lair"', 'a name rule wins');
  assert.equal(F.computeAutoFloor({ name: 'Secret Lair x Fallout', category: 'Magic: The Gathering', cost: 30 }), 47, 'Secret Lair: cost + $10 after eBay');
  assert.equal(F.floorProfitRuleFor({ name: 'Batman #1', category: 'Comic' }).profit, 1, 'then the category');
  assert.equal(F.floorProfitRuleFor({ name: 'Pikachu', category: 'Pokemon TCG' }).from, 'store default');
  assert.equal(F.computeAutoFloor({ name: 'x', cost: 5, dropship: true }), 0, 'dropship: no floor');
  cfg.floorRules = { on: false };
  assert.equal(F.computeAutoFloor({ name: 'x', cost: 5 }), 0, 'off: no floor');
  cfg.floorRules = {};
  assert.equal(F.inventoryFloorPrice({ minPrice: 8, autoFloor: 6 }), 8, 'the item\'s own floor wins when higher');
  assert.equal(F.inventoryFloorPrice({ minPrice: 0, autoFloor: 6 }), 6);
  assert.equal(F.inventoryHeldAtFloor({ autoFloor: 6, base: 5 }), true);
  assert.equal(F.inventoryHeldAtFloor({ autoFloor: 6, base: 7 }), false);
}
// Every price path uses the floor.
const floorLine = 'const floor = Math.max(inventoryMinPrice(item), Number(item.autoFloor ?? item.raw?.autoFloor ?? 0) || 0);';
assert.ok(fnSrc('inventoryListPrice').includes(floorLine));
assert.ok(fnSrc('inventorySellSuggestedPrice').includes(floorLine));
{
  const list = new Function('inventoryEffectiveBasePrice', 'inventoryCeilingPrice', 'inventorySignatureValue', lineOf('function inventoryMinPrice(') + '\n' + fnSrc('inventoryListPrice') + '; return inventoryListPrice;')(
    i => i.base, () => 0, () => 0);
  assert.equal(list({ base: 3, autoFloor: 4 }), 4, 'a $3 market item with a $4 floor sells at $4');
  assert.equal(list({ base: 5, autoFloor: 4 }), 5);
  assert.equal(list({ base: 3, autoFloor: 4, minPrice: 7 }), 7);
}
assert.ok(fnSrc('computeEbayListingFields').includes('const price = Math.max(Number(item.market || item.salePrice || 0), inventoryFloorPrice(item));'), 'eBay never lists under it');
assert.ok(worker.includes('const unitPrice = Math.max(checkoutBase, Number(d.minPrice || 0) || 0, Number(d.autoFloor || 0) || 0) + (Number(d.signature_value || 0) || 0);'), 'checkout');
assert.ok(worker.includes('price: Math.max(rowBase, Number(d.minPrice || 0) || 0, Number(d.autoFloor || 0) || 0) + rowSignatureValue,'), 'shop');
assert.ok(JSON.parse(worker.match(/const STOREFRONT_DATA_KEYS=(\[[^\]]+\])/)[1]).includes('autoFloor'), 'the shop reads it');
// Stamped on new items, again when cost/category/name changes, and kept on every save.
assert.ok(ui.includes('    autoFloor:(item?.autoFloor ?? updates?.autoFloor ?? computeAutoFloor(resolvedForRule)),'));
assert.ok(fnSrc('updateBuiltInInventoryItem').includes("['cost','costBasis','category','name','dropship','ownershipType'].some(k => k in updates)"));
assert.ok(ui.includes("  ['autoFloor',0,'num'],"));
assert.ok(ui.includes('      floorRules: { ...(saved.floorRules || {}) },'), 'saved for the whole store');
// The settings section.
assert.ok(fnSrc('floorRulesPanelHtml').includes('AUTOMATIC FLOOR -- NEVER SELL AT A LOSS'));
assert.ok(ui.includes('${floorRulesPanelHtml()}'), 'shown in CATEGORY PRICE RULES');
assert.ok(ui.includes("onchange=\"setCategoryFloorRule('${safe}','profit',this.value)\""), 'per-category floor profit');
{
  // Blank = store default.
  let saved = null;
  const api = new Function('floorRules', 'saveFloorRules', 'toast_dash', fnSrc('setCategoryFloorRule') + '; return setCategoryFloorRule;')(
    () => ({ categories: { Comic: { profit: 1 } } }), r => { saved = r; }, () => {});
  api('Comic', 'profit', '');
  assert.deepEqual(saved.categories, {}, 'blank removes the category rule');
  api('Sports', 'profitPct', '20');
  assert.deepEqual(saved.categories.Sports, { profitPct: 20 });
}
console.log('Slab detection and automatic floor checks passed');
