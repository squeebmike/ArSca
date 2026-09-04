import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store request: "where is each category struggling to make money, and how
// do we improve it" -- the existing CATEGORY / PRODUCT PROFITABILITY table
// only ever showed performance on what SOLD in the period. A category can
// look fine there while actually tying up real cash in stock that isn't
// moving, and a category with ZERO sales never shows up in that table at
// all (it's built purely from sold sale_lines). computeCategoryHealth
// cross-references sold performance against the CURRENT live inventory
// (not the period query -- inventory state is always "right now") to
// surface dead categories, thin/negative margins, and capital parked in
// aged (90+ day) stock, reusing the same aging threshold and sellability
// filter already used everywhere else in this app.

assert.match(dashboard, /function computeCategoryHealth\(categoryList\)\{/, 'missing computeCategoryHealth');
assert.match(dashboard, /function categoryHealthReasons\(c\)\{/, 'missing categoryHealthReasons');
{
  const fnStart = dashboard.indexOf('function computeCategoryHealth(categoryList){');
  const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
  const fn = dashboard.slice(fnStart, fnEnd);
  assert.match(fn, /\.filter\(inventoryItemIsSellable\)/, 'must scope to sellable live stock, matching every other in-stock check in this app');
  assert.match(fn, /if\(inventoryIsAgedStock\(item\)\)\{ c\.agedQty \+= qty; c\.agedCost \+= cost; \}/, 'must reuse the existing 90-day aging threshold, not invent a new one');
  assert.match(fn, /if\(!byCategory\.has\(key\)\) byCategory\.set\(key, \{ key, revenue:0, cogs:0, profit:0/, 'a category with zero sales but live stock must still get an entry, not be silently dropped');
}
assert.match(dashboard, /const categoryHealth = computeCategoryHealth\(result\.categoryList\)/, 'must be wired into renderReportsResults');
assert.match(dashboard, /CATEGORY HEALTH <span style="font-size:9px;color:var\(--dim\)">sold performance vs\. cash tied up in CURRENT unsold stock, worst first<\/span>/, 'CATEGORY HEALTH panel must exist and disclose it compares against live stock, not the period query');

console.log('Category health contract checks passed');

// ── Functional: reimplement both builders and verify the actual math ──
function inventoryAvailableQuantity(item){ return Math.max(0, Math.floor(Number(item.qty ?? 1))); }
function inventoryIsAgedStock(item){ return Number(item.daysInStock || 0) >= 90; }
function inventoryItemIsSellable(item){
  const status = String(item.status || '').toLowerCase();
  return !['sold','archived','returned','deleted','bundled'].includes(status) && !item.soldAt && inventoryAvailableQuantity(item) > 0;
}
const fnStart = dashboard.indexOf('function computeCategoryHealth(categoryList){');
const chSrc = dashboard.slice(fnStart, dashboard.indexOf('\n}', fnStart) + 2);
const reasonsStart = dashboard.indexOf('function categoryHealthReasons(c){');
const reasonsSrc = dashboard.slice(reasonsStart, dashboard.indexOf('\n}', reasonsStart) + 2);
const fd$ = n => '$' + Number(n || 0).toFixed(2);
// The real function reads the module-scope `all` directly (via
// `typeof all !== 'undefined' ? all : []`) -- passing it as a same-named
// parameter here satisfies that check and lets each test bind its own
// inventory list.
function runWith(items, categoryList){
  const src = `${chSrc}\n${reasonsSrc}\nreturn { computeCategoryHealth, categoryHealthReasons };`;
  const fn = new Function('all', 'inventoryAvailableQuantity', 'inventoryIsAgedStock', 'inventoryItemIsSellable', 'fd$', src);
  return fn(items, inventoryAvailableQuantity, inventoryIsAgedStock, inventoryItemIsSellable, fd$);
}

{
  // A category with real sales this period and no notable stock problem
  // must get no reasons at all -- the panel should stay quiet for it.
  const categoryList = [{ key:'MTG', revenue:1000, cogs:400, profit:600, taxableRevenue:1000, exemptRevenue:0 }];
  const items = [{ category:'MTG', qty:2, cost:50, status:'in_stock', daysInStock:10 }];
  const { computeCategoryHealth, categoryHealthReasons } = runWith(items, categoryList);
  const health = computeCategoryHealth(categoryList);
  const mtg = health.find(c => c.key === 'MTG');
  assert.equal(mtg.unsoldQty, 2, 'must sum live sellable quantity for the category');
  assert.equal(mtg.unsoldCost, 100, 'must sum cost tied up (cost * qty) for the category');
  assert.deepEqual(categoryHealthReasons(mtg), [], 'a healthy category (good margin, fresh stock, reasonable turnover) must get no flags');
}
{
  // Dead category: no sales this period, but live stock sitting -- must be
  // surfaced even though it has no entry in categoryList at all.
  const categoryList = [];
  const items = [{ category:'Funko', qty:5, cost:10, status:'in_stock', daysInStock:5 }];
  const { computeCategoryHealth, categoryHealthReasons } = runWith(items, categoryList);
  const health = computeCategoryHealth(categoryList);
  const funko = health.find(c => c.key === 'Funko');
  assert.ok(funko, 'a category with zero sold lines but live stock must still get an entry');
  const reasons = categoryHealthReasons(funko);
  assert.equal(reasons.length, 1, 'a dead category must get exactly the no-sales flag');
  assert.match(reasons[0], /No sales this period/);
  assert.match(reasons[0], /\$50\.00/, 'must name the actual dollar amount of cost sitting in stock');
}
{
  // Negative margin -- selling at a loss.
  const categoryList = [{ key:'Comics', revenue:100, cogs:150, profit:-50, taxableRevenue:100, exemptRevenue:0 }];
  const { computeCategoryHealth, categoryHealthReasons } = runWith([], categoryList);
  const comics = computeCategoryHealth(categoryList).find(c => c.key === 'Comics');
  const reasons = categoryHealthReasons(comics);
  assert.match(reasons[0], /Selling at a loss/, 'negative margin must be called out distinctly from merely-thin margin');
}
{
  // Thin (but positive) margin.
  const categoryList = [{ key:'Sports', revenue:1000, cogs:920, profit:80, taxableRevenue:1000, exemptRevenue:0 }];
  const { computeCategoryHealth, categoryHealthReasons } = runWith([], categoryList);
  const sports = computeCategoryHealth(categoryList).find(c => c.key === 'Sports');
  const reasons = categoryHealthReasons(sports);
  assert.match(reasons[0], /Thin margin \(8\.0%\)/, 'a positive but thin margin must be flagged with the actual percentage');
}
{
  // Aged-stock concentration: most of the tied-up cash is 90+ days old.
  const categoryList = [{ key:'Pokemon', revenue:500, cogs:200, profit:300, taxableRevenue:500, exemptRevenue:0 }];
  const items = [
    { category:'Pokemon', qty:1, cost:80, status:'in_stock', daysInStock:120 },
    { category:'Pokemon', qty:1, cost:20, status:'in_stock', daysInStock:5 },
  ];
  const { computeCategoryHealth, categoryHealthReasons } = runWith(items, categoryList);
  const pokemon = computeCategoryHealth(categoryList).find(c => c.key === 'Pokemon');
  const reasons = categoryHealthReasons(pokemon).join(' ');
  assert.match(reasons, /80% of the cash tied up here/, 'must call out aged stock once it crosses the 30% share threshold, with the real percentage');
}
{
  // A sold, archived, or zero-qty item must never count toward unsold stock.
  const items = [
    { category:'MTG', qty:3, cost:10, status:'sold', soldAt:'2026-01-01', daysInStock:200 },
    { category:'MTG', qty:0, cost:10, status:'in_stock', daysInStock:200 },
    { category:'MTG', qty:2, cost:10, status:'archived', daysInStock:200 },
  ];
  const { computeCategoryHealth } = runWith(items, []);
  const mtg = computeCategoryHealth([]).find(c => c.key === 'MTG');
  assert.equal(mtg, undefined, 'sold/archived/zero-qty items must not create a phantom category entry at all');
}

console.log('Category health functional checks passed');
