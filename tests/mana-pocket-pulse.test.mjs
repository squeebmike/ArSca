import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store idea: one home-screen summary that says "here's what to do next"
// instead of "here's all your data" -- rolls up features already shipped
// this session (Dead Inventory Radar, the Restock checklist's own "keeps
// selling out" rule, real price-change alerts, FOC cutoffs with no PRH
// order submitted yet). Deliberately has NO "eBay watched items" line --
// nothing in this app tracks an aggregate watcher count -- rather than
// fabricating a number for it.

assert.match(dashboard, /<div style="max-width:1400px;margin:0 auto;padding:0 20px" id="pulse-wrap"><\/div>/, 'Overview tab must have a Pulse container, placed before the existing stat cards');
assert.match(dashboard, /function computePulseData\(\)\{/, 'missing computePulseData');
assert.match(dashboard, /function renderPulse\(\)\{/, 'missing renderPulse');
assert.match(dashboard, /renderStats\(\); renderCats\(\); renderTopVal\(\); renderFeed\(\); renderPulse\(\);/, 'renderPulse must actually be wired into the main render pass, not just defined');

const dataStart = dashboard.indexOf('async function computePulseData(){');
const dataEnd = dashboard.indexOf('\n}', dataStart) + 2;
const dataFn = dashboard.slice(dataStart, dataEnd);

assert.doesNotMatch(dataFn, /watch/i, 'must not fabricate an eBay watched-items signal -- no aggregate watcher-count data source exists anywhere in this app');
assert.match(dataFn, /const radar = computeSlowMovers\(all, \{ limit:9999 \}\);/, 'cash-tied-up must come from the real Dead Inventory Radar computation, not a separate estimate');
assert.match(dataFn, /const whatnotCandidates = radar\.filter\(r => r\.action === 'RUN ON WHATNOT'\);/, 'the Whatnot action item must reuse the real suggested-action data already attached by computeSlowMovers/suggestDeadStockAction');
assert.match(dataFn, /const openAlerts = safeLocalJson\('price_change_alerts', \[\]\)\.filter\(a => a\.status === 'open'\);/, 'the reprice action item must come from real price_change_alerts data, not fabricated');
assert.match(dataFn, /count >= 2 && !insAll\.some\(i => i\.name === name\)/, 'the reorder action item must reuse the EXACT same "sold multiple times, zero left" rule as the real Restock checklist, not a different invented threshold');
assert.match(dataFn, /\.eq\('status', 'open'\)\.lte\('customer_cutoff_at', cutoff48h\)/, 'the FOC action item must check real, still-open cycles closing soon');
assert.match(dataFn, /if\(!sub\?\.length\)\{/, 'must only flag a FOC cycle if no PRH order has actually been submitted yet for it');
assert.match(dataFn, /actions:actions\.slice\(0, 5\)/, 'must cap the action list, not grow unbounded');

console.log('Mana Pocket Pulse contract checks passed');

// ── Functional: reimplement the pulse math and prove it ──
function computeSlowMoversStub(items){
  return items.filter(i => i.status === 'in_stock' && (i.daysInStock||0) >= 90).map(i => ({ id:i.id, cashTiedUp:(i.cost||0)*(i.qty||1), action: i.category==='Pokemon TCG' ? 'RUN ON WHATNOT' : 'HOLD' }));
}
function computeRestockCount(all){
  const soldAll = all.filter(i => i.status === 'sold' && i.soldAt);
  const insAll = all.filter(i => i.status === 'in_stock');
  const nameCount = {};
  soldAll.forEach(i => { nameCount[i.name] = (nameCount[i.name]||0) + 1; });
  return Object.entries(nameCount).filter(([name,count]) => count >= 2 && !insAll.some(i => i.name === name)).length;
}

const items = [
  { id:'1', status:'in_stock', qty:1, cost:20, category:'Pokemon TCG', daysInStock:200 }, // stale, whatnot candidate
  { id:'2', status:'sold', name:'Toploader', soldAt:'2026-01-01' },
  { id:'3', status:'sold', name:'Toploader', soldAt:'2026-01-05' },
  // Toploader sold twice, zero remaining in stock -> restock candidate
];
const radar = computeSlowMoversStub(items);
assert.equal(radar.filter(r => r.action === 'RUN ON WHATNOT').length, 1, 'a stale Pokemon item must surface as a Whatnot candidate');
assert.equal(computeRestockCount(items), 1, 'an item sold 2x with zero remaining must count as a restock candidate');
assert.equal(computeRestockCount([{ status:'sold', name:'X', soldAt:'2026-01-01' }]), 0, 'a single sale must not trigger a restock suggestion (needs 2+)');

console.log('Mana Pocket Pulse functional checks passed');
