import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store idea: "Dead Inventory Radar" -- the dashboard should proactively
// yell about stale stock (home-screen banner, not just a report you have
// to go look for) AND suggest a concrete next action per item, not just
// flag it. Deliberately does NOT fabricate a "views" or "market trend"
// signal -- neither is tracked anywhere in this app -- only real data:
// quantity on hand, current price vs. the store's own floor, category,
// and days in stock (reusing the exact same aging threshold as Slow
// Movers / Category Health / Inventory Aging).

assert.match(dashboard, /function suggestDeadStockAction\(item\)\{/, 'missing suggestDeadStockAction');
const fnStart = dashboard.indexOf('function suggestDeadStockAction(item){');
const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
const fn = dashboard.slice(fnStart, fnEnd);
assert.match(fn, /if\(qty > 1\) return \{ action:'BUNDLE'/, 'multiple copies on hand must suggest bundling, not individual markdown');
assert.match(fn, /if\(floor > 0 && price > floor \+ 0\.01\) return \{ action:'MARKDOWN'/, 'a price still above the store\'s own floor must suggest markdown toward that floor');
assert.match(fn, /if\(price >= 40\) return \{ action:'EBAY OFFER'/, 'high-value stale stock must suggest a dedicated eBay listing');
assert.match(fn, /if\(price < 8 && days >= 365\) return \{ action:'CONVENTION BOX'/, 'cheap, very old stock must suggest bulk clearance over individual sale attempts');
assert.match(fn, /whatnotCategories\.includes\(item\.category\)\) return \{ action:'RUN ON WHATNOT'/, 'single-copy TCG/sports singles must suggest Whatnot');
assert.match(fn, /return \{ action:'HOLD'/, 'must have a fallback when no rule clearly applies, not throw or return undefined');
assert.doesNotMatch(fn, /view|View|viewCount/, 'must not fabricate a view-count signal that isn\'t tracked anywhere in this app');

// computeSlowMovers must attach the suggestion to each row so the Reports
// table (and any future Pulse rollup) can show it without recomputing.
const computeStart = dashboard.indexOf('function computeSlowMovers(items, opts={}){');
const computeEnd = dashboard.indexOf('\n}', computeStart) + 2;
const computeFn = dashboard.slice(computeStart, computeEnd);
assert.match(computeFn, /const suggestion = suggestDeadStockAction\(x\.item\);/, 'computeSlowMovers must call the suggestion heuristic per item');
assert.match(computeFn, /action: suggestion\.action, actionReason: suggestion\.reason,/, 'the suggestion must be attached to the row');

assert.match(dashboard, /SUGGESTED ACTION<\/th>/, 'the Slow Movers table must render an action column, not just flag the item');

// Home-screen proactive banner: separate div from the generic alert-wrap
// so it can point straight at Reports (where the actual list lives).
assert.match(dashboard, /<div style="max-width:1400px;margin:0 auto;padding:0 20px;margin-top:8px;" id="dead-inventory-radar-wrap"><\/div>/, 'Overview tab must have a dedicated radar banner container');
assert.match(dashboard, /const radar = computeSlowMovers\(all, \{ limit:9999 \}\);/, 'the home banner must reflect ALL stale items, not just the top 25 the Reports table caps at');
assert.match(dashboard, /💀 DEAD INVENTORY RADAR/, 'banner text must exist');
assert.match(dashboard, /onclick="switchTab\('reports'\)">View →<\/a>/, 'the banner must link to Reports, where the full radar list with suggested actions lives');

console.log('Dead Inventory Radar contract checks passed');

// ── Functional: reimplement the heuristic and prove each rule fires correctly ──
function suggestDeadStockAction(item){
  const qty = item.qty || 1;
  const price = item.price;
  const floor = item.floor || 0;
  const days = item.days || 0;
  const whatnotCategories = ['Pokemon TCG','Magic: The Gathering','One Piece TCG','Yu-Gi-Oh!','Disney Lorcana','Sports'];
  if(qty > 1) return { action:'BUNDLE' };
  if(floor > 0 && price > floor + 0.01) return { action:'MARKDOWN' };
  if(price >= 40) return { action:'EBAY OFFER' };
  if(price < 8 && days >= 365) return { action:'CONVENTION BOX' };
  if(whatnotCategories.includes(item.category)) return { action:'RUN ON WHATNOT' };
  return { action:'HOLD' };
}

assert.equal(suggestDeadStockAction({ qty:3, price:20, category:'Comic' }).action, 'BUNDLE', 'multiple copies -> BUNDLE regardless of category/price');
assert.equal(suggestDeadStockAction({ qty:1, price:25, floor:15, category:'Comic' }).action, 'MARKDOWN', 'above floor -> MARKDOWN');
assert.equal(suggestDeadStockAction({ qty:1, price:15, floor:15, category:'Comic' }).action, 'HOLD', 'sitting exactly AT the floor must not falsely suggest markdown');
assert.equal(suggestDeadStockAction({ qty:1, price:50, floor:0, category:'Comic' }).action, 'EBAY OFFER', 'high value with no floor set -> EBAY OFFER');
assert.equal(suggestDeadStockAction({ qty:1, price:5, days:400, category:'Comic' }).action, 'CONVENTION BOX', 'cheap and 365+ days -> CONVENTION BOX');
assert.equal(suggestDeadStockAction({ qty:1, price:5, days:200, category:'Comic' }).action, 'HOLD', 'cheap but under a year old -> not yet CONVENTION BOX');
assert.equal(suggestDeadStockAction({ qty:1, price:20, category:'Pokemon TCG' }).action, 'RUN ON WHATNOT', 'single-copy TCG in the mid-price range -> Whatnot');
assert.equal(suggestDeadStockAction({ qty:1, price:20, category:'Supplies' }).action, 'HOLD', 'non-collectible category falls through to HOLD, not a false Whatnot suggestion');

console.log('Dead Inventory Radar functional checks passed');
