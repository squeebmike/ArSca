import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Store ask: "Easy way to get the new inventory on Whatnot? Hard to know
// what isn't on there in each category." SEND TO WHATNOT can pick
// everything not on Whatnot yet, shows per category how much isn't on
// there, and by default leaves out items already exported to Whatnot.
const bridge = fs.readFileSync('scripts/whatnot-bridge.js', 'utf8');
function fn(name) {
  const start = bridge.indexOf('function ' + name + '(');
  assert.ok(start !== -1, name + ' must exist');
  let depth = 0, i = bridge.indexOf('{', bridge.indexOf(')', start));
  for (; i < bridge.length; i++) { if (bridge[i] === '{') depth++; else if (bridge[i] === '}' && --depth === 0) break; }
  return bridge.slice(start, i + 1);
}

const ctx = { UNSELLABLE:['sold', 'archived', 'deleted'], list:[], state:{ notOnWhatnot:true, source:'category', category:'Pokemon TCG', query:'', shipment:'' }, inventoryBulkSelectedIds:new Set() };
vm.runInNewContext(['isSellable', 'norm', 'isDropship', 'notOnWhatnotYet', 'addedAt', 'whatnotCategoryCounts', 'chosenItems', 'pickedItems', 'focCycleOf'].map(fn).join('\n') +
  '\nfunction items(){ return list; } function categoryOf(i){ return i.category || "Other"; }' +
  '\nthis.api = { chosenItems, pickedItems, whatnotCategoryCounts };', ctx);
ctx.list = [
  { id:'p1', name:'Pikachu', category:'Pokemon TCG', qty:1, status:'in_stock', addedAt:'2026-10-10' },
  { id:'p2', name:'Charizard', category:'Pokemon TCG', qty:1, status:'in_stock', addedAt:'2026-10-16', whatnotListedAt:'2026-10-16T12:00:00Z' },
  { id:'p3', name:'Mew', category:'Pokemon TCG', qty:2, status:'in_stock', addedAt:'2026-10-17' },
  { id:'p4', name:'Sold one', category:'Pokemon TCG', qty:0, status:'sold' },
  { id:'c1', name:'Batwoman #8', category:'Comic', qty:5, status:'in_stock', addedAt:'2026-10-15' },
  { id:'s1', name:'BCW sleeves', category:'Supplies', qty:999, status:'in_stock', dropship:true },
];
const ids = list => Array.from(list, i => i.id);

// A whole category: already-on-Whatnot items are left out by default.
assert.deepEqual(ids(ctx.api.chosenItems()), ['p1', 'p3']);
ctx.state.notOnWhatnot = false;
assert.deepEqual(ids(ctx.api.chosenItems()), ['p1', 'p2', 'p3'], 'unticked: the whole category again');
ctx.state.notOnWhatnot = true;

// Everything not on Whatnot yet: newest first, no drop-ship supplies, nothing sold.
ctx.state.source = 'new';
assert.deepEqual(ids(ctx.api.chosenItems()), ['p3', 'c1', 'p1']);

// Per-category counts (drop-ship supplies don't count).
const counts = JSON.parse(JSON.stringify(ctx.api.whatnotCategoryCounts()));
assert.deepEqual(counts, { 'Pokemon TCG':{ total:3, notOn:2 }, Comic:{ total:1, notOn:1 } });

// The panel wiring.
const render = fn('renderSend');
assert.match(render, /opt\('source', 'new', 'Everything not on Whatnot yet \(' \+ newCount \+ '\)', state\.source\)/);
assert.match(render, /' -- ' \+ n\.notOn \+ ' of ' \+ n\.total \+ ' not on Whatnot<\/option>'/, 'the category list shows how much is not on Whatnot');
assert.match(render, /onchange="WB\.set\(\\'notOnWhatnot\\',this\.checked\)"> Only items not on Whatnot yet<\/label>/);
assert.match(render, /already on Whatnot left out/);
assert.match(bridge, /var state = \{ settings:null, loading:false, notOnWhatnot:true,/, 'on by default');
// Exported items get marked, so the next export skips them.
assert.match(bridge, /markItemsListedOnWhatnot\(list, \{ dest:state\.dest, type:state\.type \}\)/);

console.log('Whatnot not-listed-yet checks passed');
