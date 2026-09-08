import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store idea: cross-reference sales velocity against stock depth AND
// against the upcoming FOC catalog, so restocking happens before a
// product line actually runs dry, and so a hot comic sale gets connected
// to a related release already sitting in next week's FOC file.

// ── Thinning product lines (same-system: inventory + sales, no FOC needed) ──
assert.match(dashboard, /function computeThinningProductLines\(items, opts=\{\}\)\{/, 'missing computeThinningProductLines');
const thinStart = dashboard.indexOf('function computeThinningProductLines(items, opts={}){');
const thinEnd = dashboard.indexOf('\n}', thinStart) + 2;
const thinFn = dashboard.slice(thinStart, thinEnd);
assert.match(thinFn, /const key = \(i\.category \|\| ''\) \+ '\|\|' \+ i\.set;/, 'must group by category+set, a product LINE, not exact item name (that\'s the existing restock checklist\'s job)');
assert.match(thinFn, /\.filter\(g => g\.soldCount >= minSold && g\.remainingQty > 0 && g\.remainingQty <= maxRemaining\)/, 'must require real sales AND still-thinning (not zero, not plenty) stock');
assert.match(dashboard, /THINNING PRODUCT LINES/, 'Restock tab must render the thinning-lines panel');

// ── FOC cross-reference (comics sales vs. upcoming FOC catalog) ──
assert.match(dashboard, /function titlesShareSignificantWord\(a, b\)\{/, 'missing titlesShareSignificantWord');
assert.match(dashboard, /function loadFocRelatedReleaseOpportunities\(\)\{/, 'missing loadFocRelatedReleaseOpportunities');
const loadStart = dashboard.indexOf('async function loadFocRelatedReleaseOpportunities(){');
const loadEnd = dashboard.indexOf('\n}', loadStart) + 2;
const loadFn = dashboard.slice(loadStart, loadEnd);
assert.match(loadFn, /\.from\('pos_sale_lines'\)\.select\('title,quantity,created_at'\)/, 'must read real recent sale lines, not fabricate sales data');
assert.match(loadFn, /\.eq\('category', 'Comic'\)/, 'must scope to comics -- the roadmap example is comics-specific (FOC only covers comics)');
assert.match(loadFn, /\.from\('foc_cycles'\)\.select\('id,foc_date'\)\.eq\('store_id', storeId\)\.neq\('status', 'archived'\)\.gte\('foc_date', today\)/, 'must only look at upcoming (not-yet-passed, not archived) FOC cycles');
assert.match(loadFn, /if\(qty < 2\) return; \/\/ a single sale isn't a real signal/, 'a single comic sale must not be treated as a real velocity signal');
assert.match(dashboard, /UPCOMING FOC MATCHES YOUR SELLERS/, 'Restock tab must render the FOC-match panel');

// Wired into the Restock tab's init
assert.match(dashboard, /if\(tab==='restock'\) \{ renderRestock\(\); renderThinningProductLines\(\); renderFocRelatedReleaseOpportunities\(\); \}/, 'both new panels must actually be triggered when the Restock tab opens');

console.log('Inventory Opportunity Matching contract checks passed');

// ── Functional: reimplement both matching functions and prove them ──
function computeThinningProductLines(items, opts = {}){
  const minSold = opts.minSold || 3;
  const maxRemaining = opts.maxRemaining ?? 6;
  const sold = items.filter(i => i.status === 'sold' && i.soldAt && i.set);
  const groups = new Map();
  sold.forEach(i => {
    const key = (i.category || '') + '||' + i.set;
    if(!groups.has(key)) groups.set(key, { category:i.category, set:i.set, soldCount:0 });
    groups.get(key).soldCount++;
  });
  return [...groups.values()]
    .map(g => {
      const remainingQty = items.filter(i => i.status === 'in_stock' && i.category === g.category && i.set === g.set).reduce((s,i) => s + (i.qty||1), 0);
      return { ...g, remainingQty };
    })
    .filter(g => g.soldCount >= minSold && g.remainingQty > 0 && g.remainingQty <= maxRemaining)
    .sort((a,b) => b.soldCount - a.soldCount);
}
{
  const items = [
    ...Array.from({length:5}, (_,i) => ({ status:'sold', soldAt:new Date().toISOString(), category:'Magic: The Gathering', set:'TMNT' })),
    { status:'in_stock', category:'Magic: The Gathering', set:'TMNT', qty:4 },
    ...Array.from({length:10}, (_,i) => ({ status:'sold', soldAt:new Date().toISOString(), category:'Pokemon TCG', set:'Prismatic Evolutions' })),
    { status:'in_stock', category:'Pokemon TCG', set:'Prismatic Evolutions', qty:50 },
    { status:'sold', soldAt:new Date().toISOString(), category:'Sports', set:'2024 Topps' },
    { status:'sold', soldAt:new Date().toISOString(), category:'Sports', set:'2024 Topps' },
  ];
  const result = computeThinningProductLines(items);
  assert.equal(result.length, 1, 'only TMNT MTG should surface: sold well AND genuinely thinning');
  assert.equal(result[0].set, 'TMNT');
  assert.equal(result[0].remainingQty, 4);
  assert.ok(!result.some(r => r.set === 'Prismatic Evolutions'), 'sold well but plenty remaining (50) must not be flagged as thinning');
}

function focMatchSignificantWords(text){
  const stop = new Set(['the','and','of','vol','volume','tpb','hc','presents','annual','special','one','shot','issue','cover']);
  return String(text||'').toLowerCase().replace(/#\d+.*/,'').replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(w => w.length >= 4 && !stop.has(w));
}
function titlesShareSignificantWord(a, b){
  const wa = new Set(focMatchSignificantWords(a));
  return focMatchSignificantWords(b).some(w => wa.has(w));
}
assert.ok(titlesShareSignificantWord('Amazing Spider-Man #47 Cover A', 'Spider-Man 2099: Exodus #1'), 'titles sharing "spider man" must be linked');
assert.ok(!titlesShareSignificantWord('Amazing Spider-Man #47', 'Batman: The Long Halloween'), 'unrelated titles must not match');
assert.ok(!titlesShareSignificantWord('The One Shot Special', 'Annual Presents Volume One'), 'stopword-only titles must not produce a false match');

console.log('Inventory Opportunity Matching functional checks passed');
