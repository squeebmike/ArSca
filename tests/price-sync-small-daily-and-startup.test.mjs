import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const d = fs.readFileSync('dashboard.html', 'utf8');
const grab = re => { const m = d.match(re); assert.ok(m, 'missing ' + re); return m[0]; };

// 1. Approve all under 10%: only the small ones are applied; bigger stay.
{
  const applied = [];
  const ctx = { Math, Number, Set, toast_dash:() => {}, renderPriceSyncProposal:() => {}, updatePriceAlertBanner:() => {}, loadInventory:() => {}, savePendingPriceSyncProposals:() => {},
    document:{ getElementById:() => null }, applyPriceSyncEntry:async p => { applied.push(p.id); return true; } };
  vm.createContext(ctx);
  vm.runInContext('var _priceSyncProposal = [{id:"a",deltaPct:4},{id:"b",deltaPct:-9.9},{id:"c",deltaPct:10},{id:"d",deltaPct:-35}];var visiblePriceSyncProposals=()=>_priceSyncProposal;'
    + grab(/const SMALL_PRICE_CHANGE_PCT = 10;[\s\S]*?\nasync function applySmallPriceSyncUpdates\(\)\{[\s\S]*?\n\}/) + ';this.go=applySmallPriceSyncUpdates;this.left=()=>_priceSyncProposal.map(p=>p.id);', ctx);
  await ctx.go();
  assert.deepEqual([...applied], ['a', 'b'], 'under 10% either way is approved');
  assert.deepEqual([...ctx.left()], ['c', 'd'], '10% and bigger wait for review');
}
assert.match(d, /onclick="applySmallPriceSyncUpdates\(\)">✓ APPROVE ALL UNDER \$\{SMALL_PRICE_CHANGE_PCT\}%/);

// 2. Daily sync: once a day per store (shared marker), after 3am, runs every
// check, auto-approves the small changes, leaves the rest for review.
const daily = grab(/async function maybeRunDailyPriceSync\(\)\{[\s\S]*?\n\}/);
assert.match(daily, /if\(now\.getHours\(\) < 3\) return;/);
assert.match(daily, /if\(shared\.slice\(0, 10\) === today\)/, 'another device already ran it today');
assert.match(daily, /for\(const run of \[runPriceSyncScan, runOfflineMtgPriceSync, runLiveComicPriceSync, runLivePokemonPriceSync, runSportsPriceSync, runOtherLivePriceSync, runPocketScoutPriceSync\]\)/);
assert.match(daily, /const small = _priceSyncProposal\.filter\(isSmallPriceChange\);/);
assert.match(d, /setInterval\(\(\) => \{ if\(document\.visibilityState === 'visible'\) maybeRunDailyPriceSync\(\)/);
assert.match(d, /id="price-sync-daily-toggle"/);

// 3. getActiveStore never returns undefined (the startup displayName error).
{
  const ctx = { getAuthSession:() => null, getActiveStoreId:() => 'st-1' };
  vm.createContext(ctx);
  vm.runInContext(grab(/function getActiveStore\(\)\{[^\n]*\}/) + ';this.f=getActiveStore;', ctx);
  assert.equal(ctx.f().id, 'st-1');
  assert.equal(ctx.f().displayName, '');
}
console.log('Price sync small-approve, daily sync and startup checks passed');
