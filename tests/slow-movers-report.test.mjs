import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store idea: Category Health flags an entire category as struggling, but
// doesn't say which items are the actual cash sitting there. This drills
// straight to the worst individual offenders so there's something concrete
// to act on.

assert.match(dashboard, /function computeSlowMovers\(items, opts=\{\}\)\{/, 'missing computeSlowMovers');
const fnStart = dashboard.indexOf('function computeSlowMovers(items, opts={}){');
const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
const fn = dashboard.slice(fnStart, fnEnd);
assert.match(fn, /\.filter\(inventoryItemIsSellable\)/, 'must only consider currently sellable items');
assert.match(fn, /x\.days !== null && x\.days >= thresholdDays/, 'must filter to items at/over the aging threshold, same 90-day default as Category Health/Inventory Aging');
assert.match(fn, /cashTiedUp: Number\(x\.item\.cost \|\| 0\) \* qty/, 'cash tied up must be cost x quantity, matching how Category Health computes unsoldCost');
assert.match(fn, /\.sort\(\(a, b\) => b\.cashTiedUp - a\.cashTiedUp\)/, 'must sort worst (most cash tied up) first');
assert.match(fn, /\.slice\(0, limit\)/, 'must cap the list, not dump every aged item unbounded');

assert.match(dashboard, /SLOW MOVERS \/ DEAD STOCK/, 'Reports must render a Slow Movers section');
assert.match(dashboard, /const slowMovers = computeSlowMovers\(typeof all !== 'undefined' \? all : \[\]\);/, 'the report must be wired to the live computeSlowMovers call, independent of the report\'s date-range query (same as Category Health\'s unsold side)');
assert.match(dashboard, /onclick="openEditModal\('\$\{s\.id\}'\)">EDIT/, 'each row must have a quick way to act on it (edit the item to mark it down)');

console.log('Slow Movers report contract checks passed');

// ── Functional: reimplement and prove the aging/sort/cash-tied-up math ──
function inventoryDaysInStock(item){
  const t = new Date(item.addedAt).getTime();
  if(!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / (24*60*60*1000)));
}
function inventoryItemIsSellable(item){ return item.status === 'in_stock' && (item.qty||1) > 0; }
function inventoryAvailableQuantity(item){ return Number(item.qty||1); }
function inventoryListPrice(item){ return Number(item.market||0); }
function computeSlowMovers(items, opts={}){
  const thresholdDays = opts.thresholdDays || 90;
  const limit = opts.limit || 25;
  return (items || [])
    .filter(inventoryItemIsSellable)
    .map(item => ({ item, days: inventoryDaysInStock(item) }))
    .filter(x => x.days !== null && x.days >= thresholdDays)
    .map(x => {
      const qty = inventoryAvailableQuantity(x.item);
      return { id:x.item.id, name:x.item.name, category:x.item.category||'Uncategorized', days:x.days, qty, cashTiedUp:Number(x.item.cost||0)*qty, listPrice:inventoryListPrice(x.item) };
    })
    .sort((a,b) => b.cashTiedUp - a.cashTiedUp)
    .slice(0, limit);
}

const daysAgo = n => new Date(Date.now() - n*24*60*60*1000).toISOString();
const items = [
  { id:'1', name:'Old cheap card', status:'in_stock', qty:1, cost:5, addedAt:daysAgo(200) },
  { id:'2', name:'Old expensive box', status:'in_stock', qty:2, cost:100, addedAt:daysAgo(120) },
  { id:'3', name:'Fresh stock', status:'in_stock', qty:1, cost:500, addedAt:daysAgo(10) },
  { id:'4', name:'Sold aged item', status:'sold', qty:0, cost:50, addedAt:daysAgo(200) },
];
const result = computeSlowMovers(items);
assert.equal(result.length, 2, 'only aged (90+ day) sellable items must appear');
assert.equal(result[0].id, '2', 'the item with the most cash tied up ($200) must sort first');
assert.equal(result[0].cashTiedUp, 200, 'cash tied up must be cost x quantity');
assert.equal(result[1].id, '1', 'the cheaper aged item must sort second');
assert.ok(!result.some(r => r.id === '3'), 'fresh (under-threshold) stock must be excluded');
assert.ok(!result.some(r => r.id === '4'), 'sold items must be excluded even if old');

const limited = computeSlowMovers(items, { limit:1 });
assert.equal(limited.length, 1, 'limit option must cap the result count');

console.log('Slow Movers report functional checks passed');
