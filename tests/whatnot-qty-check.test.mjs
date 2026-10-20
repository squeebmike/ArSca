import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Store report: "Accidentally sold books we didn't have in stock on
// Whatnot." Whatnot's counts can't be pushed (no open seller API), so the
// CSV export remembers how many copies went up, Whatnot sales count against
// that, and the Whatnot tab lists everything Whatnot still offers more of
// than is actually here -- with the exact number to set.
const bridge = fs.readFileSync('scripts/whatnot-bridge.js', 'utf8');
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
function fn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start !== -1, name + ' must exist');
  let depth = 0, i = src.indexOf('{', src.indexOf(')', start));
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  const isAsync = src.slice(Math.max(0, start - 6), start) === 'async ';
  return (isAsync ? 'async ' : '') + src.slice(start, i + 1);
}

const ctx = { UNSELLABLE:['sold', 'archived', 'deleted'], list:[] };
vm.runInNewContext(['isSellable', 'whatnotQty', 'haveQty', 'whatnotQtyCheck', 'onWhatnot'].map(n => fn(bridge, n)).join('\n') + '\nfunction items(){ return list; }\nthis.api = { whatnotQtyCheck, onWhatnot, whatnotQty };', ctx);
ctx.list = [
  // 5 went to Whatnot, 3 sold in the store -> Whatnot still offers 5, only 2 here.
  { id:'bw', name:'Batwoman #8 Cvr D', qty:2, status:'in_stock', whatnotListedAt:'2026-10-15', whatnotListing:{ qty:5, soldOnWhatnot:0 } },
  // 5 went up, 2 sold ON Whatnot, 3 left both places -> fine.
  { id:'tc', name:'Thundercats #1 A', qty:3, status:'in_stock', whatnotListedAt:'2026-10-15', whatnotListing:{ qty:5, soldOnWhatnot:2 } },
  // Sold out in the store, still 1 on Whatnot -> take it down.
  { id:'gz', name:'Godzilla 1:10', qty:0, status:'sold', channel:'In Store', whatnotListedAt:'2026-10-15', whatnotListing:{ qty:1, soldOnWhatnot:0 } },
  // Sold on Whatnot -> nothing to do.
  { id:'wn', name:'Sold there', qty:0, status:'sold', channel:'Whatnot', whatnotListedAt:'2026-10-15', whatnotListing:{ qty:1, soldOnWhatnot:1 } },
  // Marked before counts were tracked.
  { id:'old', name:'Legacy mark', qty:4, status:'in_stock', whatnotListedAt:'2026-10-10', whatnotListing:{ dest:'shop' } },
  { id:'off', name:'Not on Whatnot', qty:4, status:'in_stock' },
];
{
  const q = ctx.api.whatnotQtyCheck();
  assert.deepEqual(JSON.parse(JSON.stringify(q.lower.map(r => [r.item.id, r.onWhatnot, r.have]))), [['gz', 1, 0], ['bw', 5, 2]], 'take-downs first, then lower-to counts');
  assert.deepEqual(Array.from(q.untracked, i => i.id), ['old']);
  assert.equal(ctx.api.whatnotQty(ctx.list[1]), 3);
  assert.equal(ctx.api.whatnotQty(ctx.list[4]), null);
  const w = ctx.api.onWhatnot();
  assert.ok(!w.soldElsewhere.some(i => i.id === 'gz'), 'a counted item is handled by the LOWER list, not listed twice');
}

// Panel wiring.
const render = fn(bridge, 'renderOnWhatnot');
assert.match(render, /⚠ LOWER THESE ON WHATNOT \(/);
assert.match(fn(bridge, 'lowerRow'), /set it to ' \+ r\.have/);
assert.match(fn(bridge, 'lowerRow'), /take it down/);
assert.match(bridge, /qtyDone: function\(ids\)\{/);
assert.match(bridge, /qtyStartTracking: function\(\)\{/);
assert.match(bridge, /window\.whatnotQtyCheck = whatnotQtyCheck;/);

// Export remembers the count; DONE resets the count to what's here.
{
  const saved = [];
  const c = { all:[], saved, toast_dash(){}, renderAll(){},
    updateBuiltInInventoryItem: async (item, updates) => { saved.push([item.id, JSON.parse(JSON.stringify(updates))]); }, updateUniversalInventoryItem(){} };
  vm.runInNewContext([fn(app, 'setWhatnotListed'), fn(app, 'markItemsListedOnWhatnot'), fn(app, 'setWhatnotQtyMatched')].join('\n') + '\nthis.api = { markItemsListedOnWhatnot, setWhatnotQtyMatched };', c);
  const a = { id:'a', qty:3, source:'built_in' }, b = { id:'b', qty:1, source:'built_in' };
  await c.api.markItemsListedOnWhatnot([a, b], { dest:'shop', type:'Buy It Now' });
  assert.equal(saved[0][1].whatnotListing.qty, 3); assert.equal(saved[0][1].whatnotListing.soldOnWhatnot, 0);
  assert.equal(saved[1][1].whatnotListing.qty, 1);
  saved.length = 0;
  c.all = [{ ...a, whatnotListedAt:'t', whatnotListing:{ qty:3, soldOnWhatnot:0 } }, { ...b, whatnotListedAt:'t', whatnotListing:{ qty:1 } }];
  vm.runInContext('all = this.all;', c);
  await c.api.setWhatnotQtyMatched([{ id:'a', have:2 }, { id:'b', have:0 }]);
  const byId = Object.fromEntries(saved.map(([id, u]) => [id, u]));
  assert.equal(byId.a.whatnotListing.qty, 2, 'Whatnot now matches 2');
  assert.equal(byId.a.whatnotListing.soldOnWhatnot, 0);
  assert.equal(byId.b.whatnotListedAt, '', 'none left: off Whatnot');
}

// Whatnot sales count against what's on Whatnot (record-external-sale).
assert.match(worker, /if \(\/whatnot\/i\.test\(channel\) && d\.whatnotListing && typeof d\.whatnotListing === 'object' && d\.whatnotListing\.qty != null\) \{\s*nextData\.whatnotListing = \{ \.\.\.d\.whatnotListing, soldOnWhatnot: \(Number\(d\.whatnotListing\.soldOnWhatnot\) \|\| 0\) \+ quantitySold \};/);

// Pre-show check before going live on Whatnot.
assert.match(fn(app, 'createWhatnotShow'), /platform === 'whatnot' && typeof window\.whatnotQtyCheck === 'function' \? window\.whatnotQtyCheck\(\) : null/);
assert.match(fn(app, 'createWhatnotShow'), /Before you go live: /);
console.log('Whatnot quantity check passed');
