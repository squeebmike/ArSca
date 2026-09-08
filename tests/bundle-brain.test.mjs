import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store idea: find inventory that makes sense bundled together instead of
// randomly discounting it -- connecting covers, artist sets, evolution
// lines, player lots, Commander themes, etc. Deliberately scoped to real
// data this app tracks (set/team/player), NOT a fabricated evolution-chain
// or Commander-synergy dataset that doesn't exist here.

assert.match(dashboard, /function computeBundleCandidates\(items, opts=\{\}\)\{/, 'missing computeBundleCandidates');
const candStart = dashboard.indexOf('function computeBundleCandidates(items, opts={}){');
const candEnd = dashboard.indexOf('\n}', candStart) + 2;
const candFn = dashboard.slice(candStart, candEnd);
assert.match(candFn, /\.filter\(inventoryItemIsSellable\)\.filter\(i => !i\.isBundle\)/, 'must only consider sellable, non-bundle-container items as candidates');
assert.match(candFn, /addGroupsFromKey\(i => i\.player \? `\$\{i\.category\}\|\|\$\{i\.player\}` : null, 'player'\)/, 'must group by player (real tracked field)');
assert.match(candFn, /addGroupsFromKey\(i => i\.team \? `\$\{i\.category\}\|\|\$\{i\.team\}` : null, 'team'\)/, 'must group by team (real tracked field)');
assert.match(candFn, /addGroupsFromKey\(i => i\.set \? `\$\{i\.category\}\|\|\$\{i\.set\}` : null, 'set'\)/, 'must group by set (real tracked field)');
assert.doesNotMatch(candFn, /evolution|Commander|synergy/i, 'must not claim to group by evolution lines or Commander synergy -- no real dataset backs either here');
assert.match(candFn, /const claimed = new Set\(\);/, 'must de-dupe so one item doesn\'t appear in multiple overlapping candidate groups');

assert.match(dashboard, /function computeBundlePrice\(items, opts=\{\}\)\{/, 'missing computeBundlePrice');
const priceStart = dashboard.indexOf('function computeBundlePrice(items, opts={}){');
const priceEnd = dashboard.indexOf('\n}', priceStart) + 2;
const priceFn = dashboard.slice(priceStart, priceEnd);
assert.match(priceFn, /const discounted = roundSellPrice\(combinedList \* \(1 - discountPct \/ 100\)\);/, 'must discount off the combined list price');
assert.match(priceFn, /const floor = roundSellPrice\(combinedCost \* \(1 \+ minMarginPct \/ 100\)\);/, 'must compute a cost-based floor');
assert.match(priceFn, /return Math\.max\(discounted, floor\);/, 'the discount must never win over the margin floor -- clearing stock must not mean selling at a loss');

// UI: reachable from Slow Movers (where "BUNDLE" already gets suggested by
// Dead Inventory Radar), reuses the EXISTING bundle-builder modal/flow
// instead of duplicating a second create-bundle UI.
assert.match(dashboard, /onclick="openBundleBrainModal\(\)">🧠 Bundle Brain →<\/a>/, 'must have an entry point next to Slow Movers');
assert.match(dashboard, /function createBundleFromCandidate\(idx\)\{/, 'missing createBundleFromCandidate');
const createStart = dashboard.indexOf('function createBundleFromCandidate(idx){');
const createEnd = dashboard.indexOf('\n}', createStart) + 2;
const createFn = dashboard.slice(createStart, createEnd);
assert.match(createFn, /bundleDraftIds = new Set\(g\.items\.map\(i => i\.id\)\);/, 'must load the candidate into the existing bundleDraftIds mechanism');
assert.match(createFn, /openBundleBuilderModal\(\);/, 'must reuse the EXISTING bundle builder modal, not a separate confirm flow');
assert.match(createFn, /if\(priceEl\) priceEl\.value = g\.suggestedPrice\.toFixed\(2\);/, 'must pre-fill the builder with the computed suggested price, not the builder\'s own raw-sum default');

console.log('Bundle Brain contract checks passed');

// ── Functional: reimplement the grouping + pricing math and prove it ──
function inventoryItemIsSellable(item){ return item.status === 'in_stock' && (item.qty||1) > 0; }
function inventoryListPrice(item){ return Number(item.market||0); }
function roundSellPrice(v){ const n=Number(v||0); return n<=0?0:Math.ceil(n-1e-9); }
function computeBundlePrice(items, opts={}){
  const discountPct = opts.discountPct ?? 15;
  const minMarginPct = opts.minMarginPct ?? 10;
  const combinedList = items.reduce((s,i) => s + inventoryListPrice(i)*(i.qty||1), 0);
  const combinedCost = items.reduce((s,i) => s + Number(i.cost||0)*(i.qty||1), 0);
  const discounted = roundSellPrice(combinedList * (1-discountPct/100));
  const floor = roundSellPrice(combinedCost * (1+minMarginPct/100));
  return Math.max(discounted, floor);
}
function computeBundleCandidates(items, opts={}){
  const minGroupSize = opts.minGroupSize || 3;
  const sellable = items.filter(inventoryItemIsSellable).filter(i => !i.isBundle);
  const groups = [];
  const addGroupsFromKey = (keyFn, type) => {
    const byKey = new Map();
    sellable.forEach(i => { const key = keyFn(i); if(!key) return; if(!byKey.has(key)) byKey.set(key, []); byKey.get(key).push(i); });
    byKey.forEach((groupItems, key) => { if(groupItems.length >= minGroupSize) groups.push({ type, key, items:groupItems }); });
  };
  addGroupsFromKey(i => i.player ? `${i.category}||${i.player}` : null, 'player');
  addGroupsFromKey(i => i.team ? `${i.category}||${i.team}` : null, 'team');
  addGroupsFromKey(i => i.set ? `${i.category}||${i.set}` : null, 'set');
  const claimed = new Set();
  const deduped = [];
  groups.forEach(g => {
    const unclaimed = g.items.filter(i => !claimed.has(i.id));
    if(unclaimed.length >= minGroupSize){ unclaimed.forEach(i => claimed.add(i.id)); deduped.push({ ...g, items:unclaimed }); }
  });
  return deduped.map(g => ({ ...g, suggestedPrice: computeBundlePrice(g.items) }));
}

// Pricing: $100 combined list, $40 combined cost -> 15% off = $85, floor = $44 -> $85 wins.
assert.equal(computeBundlePrice([{ market:100, cost:40, qty:1 }]), 85, 'a healthy-margin bundle should get the real 15% discount');
// $100 combined list, $80 combined cost -> 15% off = $85, floor = $88 -> floor wins (never sell below cost+margin).
assert.equal(computeBundlePrice([{ market:100, cost:80, qty:1 }]), 88, 'a thin-margin bundle must be protected by the cost floor, not just discounted blindly');

// Grouping + de-dupe: a player is more specific than their team, which is
// more specific than the broader set -- an item claimed by its player
// group should NOT also double up in that player's team-wide group.
{
  const items = [
    ...Array.from({length:4}, (_,i) => ({ id:'ichiro'+i, status:'in_stock', qty:1, category:'Sports', player:'Ichiro Suzuki', team:'Mariners', set:'2001 Topps', market:20, cost:5 })),
    ...Array.from({length:3}, (_,i) => ({ id:'mariners'+i, status:'in_stock', qty:1, category:'Sports', team:'Mariners', set:'2001 Topps', market:10, cost:2 })),
    { id:'sold-one', status:'sold', qty:1, category:'Sports', player:'Ichiro Suzuki' },
  ];
  const candidates = computeBundleCandidates(items);
  const playerGroup = candidates.find(c => c.type === 'player');
  assert.ok(playerGroup, 'Ichiro must form a player-level lot');
  assert.equal(playerGroup.items.length, 4, 'only the 4 sellable Ichiro items must be in the player lot -- the sold one must be excluded');
  const teamGroup = candidates.find(c => c.type === 'team');
  assert.ok(teamGroup, 'a Mariners team lot must still exist from the remaining unclaimed items');
  assert.equal(teamGroup.items.length, 3, 'the 4 Ichiro items already claimed by the player group must not double-count into the team group');
}

console.log('Bundle Brain functional checks passed');
