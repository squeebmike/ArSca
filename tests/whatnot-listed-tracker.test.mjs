import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Store request: "something to keep track of what's on Whatnot. When I
// export the Whatnot CSV it should mark those as listed on Whatnot. They can
// still be sold everywhere though."

const bridge = fs.readFileSync('scripts/whatnot-bridge.js', 'utf8');
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
const html = fs.readFileSync('dashboard.html', 'utf8');
function fn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start !== -1, name + ' must exist');
  let depth = 0, i = src.indexOf('{', src.indexOf(')', start));
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(start, i + 1);
}

// Downloading the CSV marks every exported item; nothing about selling changes.
assert.match(bridge, /markItemsListedOnWhatnot\(list, \{ dest:state\.dest, type:state\.type \}\)/);
assert.match(app, /\['whatnotListedAt',''\], \['whatnotListing', null\],/, 'the mark is saved with the item');
assert.doesNotMatch(fn(bridge, 'isSellable'), /whatnot/i, 'a Whatnot mark never makes an item unsellable');
assert.doesNotMatch(fn(app, 'inventoryItemIsSellable'), /whatnotListed/, 'the register still sells it');
assert.match(app, /📺 WHATNOT<\/span>/, 'inventory rows show the mark');
assert.match(app, /📺 Off Whatnot \(clear mark\)/);
assert.match(html, /onclick="clearWhatnotMarkSelected\(\)"[^>]*>CLEAR WHATNOT MARK</);

// The ON WHATNOT panel: what's up there, and what sold elsewhere and needs taking down.
{
  const ctx = { UNSELLABLE:['sold', 'archived', 'deleted'], list:[] };
  vm.runInNewContext(fn(bridge, 'isSellable') + fn(bridge, 'onWhatnot') + 'function items(){ return list; } this.onWhatnot = onWhatnot;', ctx);
  ctx.list = [
    { id:'a', name:'Live one', qty:1, status:'in_stock', whatnotListedAt:'2026-10-15T10:00:00Z' },
    { id:'b', name:'Sold at the register', qty:0, status:'sold', channel:'In Store', whatnotListedAt:'2026-10-14T10:00:00Z' },
    { id:'c', name:'Sold on Whatnot', qty:0, status:'sold', channel:'Whatnot', whatnotListedAt:'2026-10-14T10:00:00Z' },
    { id:'d', name:'Not on Whatnot', qty:1, status:'in_stock' },
    { id:'e', name:'Two left of three', qty:2, status:'in_stock', whatnotListedAt:'2026-10-16T10:00:00Z' },
  ];
  const w = ctx.onWhatnot();
  assert.deepEqual(Array.from(w.live, i => i.id), ['e', 'a'], 'newest marks first; partly sold multiples are still up');
  assert.deepEqual(Array.from(w.soldElsewhere, i => i.id), ['b'], 'sold elsewhere -> take it down on Whatnot; sold on Whatnot -> done');
}
assert.match(bridge, /el\.innerHTML = renderOnWhatnot\(\) \+ renderSend\(\)/);
assert.match(bridge, /SOLD SOMEWHERE ELSE/);

console.log('Whatnot listing tracker checks passed');
