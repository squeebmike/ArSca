import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { comicSeriesKey, computeComicSellThrough, handleFocRequest } from '../scripts/foc-preorders.mjs';

const now = Date.parse('2026-10-06T12:00:00Z');
const daysAgo = n => new Date(now - n * 864e5).toISOString();

assert.equal(comicSeriesKey({ data:{ series:'Absolute Batman (2024)' } }), 'ABSOLUTE BATMAN');
assert.equal(comicSeriesKey({ data:{ name:'DNX #4 · Cover A' } }), 'DNX');

// Sell-through: store sales + eBay presales, sells-out / slow flags, and
// books sitting 3+ weeks with nothing sold.
{
  const items = [
    { id:'a1', status:'sold', created_at:daysAgo(40), data:{ source:'foc_receive', series:'Hot Book', issue:'1', qty:0 } },
    { id:'a2', status:'in_stock', created_at:daysAgo(10), data:{ source:'foc_receive', series:'Hot Book', issue:'2', qty:0 } },
    { id:'a3', status:'presale', created_at:daysAgo(5), data:{ source:'foc_presale', series:'Hot Book', issue:'3', qty:0, focPresaleOriginalQty:2 } },
    { id:'b1', status:'in_stock', created_at:daysAgo(30), data:{ source:'foc_receive', series:'Dud Comic', issue:'1', qty:5, name:'Dud Comic #1' } },
    { id:'b2', status:'in_stock', created_at:daysAgo(30), data:{ source:'foc_receive', series:'Dud Comic', issue:'2', qty:4 } },
  ];
  const sold = new Map([['a1', 4], ['a2', 3], ['b2', 1]]);
  const { series, slowItems } = computeComicSellThrough(items, sold, now);
  const hot = series.find(s => s.series === 'HOT BOOK');
  assert.equal(hot.received, 9);
  assert.equal(hot.sold, 9);
  assert.equal(hot.sellThrough, 100);
  assert.equal(hot.perIssueSold, 3);
  assert.equal(hot.flag, 'sells-out');
  const dud = series.find(s => s.series === 'DUD COMIC');
  assert.equal(dud.onHand, 9);
  assert.equal(dud.flag, 'slow');
  assert.deepEqual(slowItems.map(i => i.id), ['b1'], 'only books with zero sold');
  assert.equal(slowItems[0].days, 30);
}

// Route: sums POS lines per item and returns pull-list counts per series.
{
  const deps = {
    json:(data, status = 200) => ({ status, data }),
    requireStoreUser:async () => ({ user:{ id:'u' } }),
    supabaseAdminFetch:async (env, path) => {
      if (path.startsWith('inventory_items?')) return { data:[{ id:'11111111-1111-1111-1111-111111111111', status:'in_stock', created_at:new Date().toISOString(), data:{ source:'foc_receive', series:'DNX', issue:'4', qty:1 } }] };
      if (path.startsWith('pos_sale_lines?')) return { data:[{ item_id:'11111111-1111-1111-1111-111111111111', quantity:2 }] };
      if (path.startsWith('pull_list_subscriptions?')) return { data:[{ series:{ title:'DNX' } }, { series:{ title:'dnx' } }, { series:{ title:'Other' } }] };
      return { data:[] };
    },
  };
  const res = await handleFocRequest({ method:'GET', headers:{ get:() => null } }, {}, new URL('https://x/foc/admin/comic-sell-through?store_id=st'), deps);
  assert.equal(res.data.ok, true);
  assert.equal(res.data.series[0].sold, 2);
  assert.equal(res.data.series[0].received, 3);
  assert.deepEqual(res.data.pullLists, { DNX:2, OTHER:1 });
}

// Order helper: presold stays, shelf copies from history go on Cover A, and
// Cover A is topped up to unlock a ratio cover.
const ui = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
const grab = re => { const m = ui.match(re); assert.ok(m, 'missing ' + re); return m[0]; };
const ctx = { Math, Number, String };
vm.createContext(ctx);
vm.runInContext([grab(/function focSeriesKey\(v\)\{[^\n]*\}/), grab(/function focSeriesStats\(family,data\)\{[\s\S]*?\n\}/), grab(/function focOrderSuggest\(family,stats,pull\)\{[\s\S]*?\n\}/)].join('\n') + ';this.suggest=focOrderSuggest;this.stats=focSeriesStats;', ctx);
{
  const family = { title:'HOT BOOK #4', seriesName:'Hot Book', variants:[
    { id:'a', variantLabel:'Cover A', customerQty:2, ebayPresold:1, storeQuantity:0 },
    { id:'b', variantLabel:'Cover B Smith', customerQty:1, ebayPresold:0, storeQuantity:0 },
    { id:'r25', variantLabel:'Cover C 1:25', isIncentive:true, orderRequirement:'1:25', qualification:{ threshold:25 } },
    { id:'r10', variantLabel:'Cover D 1:10', isIncentive:true, orderRequirement:'1:10', qualification:{ threshold:10 }, ebayPresold:1 },
    { id:'r100', variantLabel:'Cover E 1:100', isIncentive:true, orderRequirement:'1:100', qualification:{ threshold:100 } },
  ] };
  const m = ctx.stats(family, { series:[{ series:'HOT BOOK', perIssueSold:4, flag:'sells-out', issues:3, received:12, sold:12, sellThrough:100 }], pullLists:{ 'HOT BOOK':3 } });
  assert.equal(m.pull, 3);
  const s = ctx.suggest(family, m.stats, m.pull);
  const a = s.lines.find(l => l.id === 'a'), b = s.lines.find(l => l.id === 'b');
  assert.equal(b.store, 0, 'other covers only get what is presold');
  // 4 presold; history 4*1.25=5 -> 1 shelf; pull 3-2=1 -> still 1; total 5;
  // 1:10 presold -> +5 (REQUIRED); 1:25 needs 15 -> too many, skipped; 1:100 skipped.
  assert.equal(a.total, 3 + 1 + 5);
  assert.equal(a.store, 6);
  assert.equal(s.unlocks.map(u => u.status).join(','), 'required,skipped,skipped');
  assert.match(a.reasons.join(' | '), /REQUIRED \+5 unlocks 1:10/);
  assert.match(a.reasons.join(' | '), /past issues sold ~4 each \(sells out\)/);
}
{
  // Close to a ratio: a few more Cover A unlocks it even with nothing presold.
  const family = { title:'NEW THING #1', seriesName:'New Thing', isFirstIssue:true, variants:[
    { id:'a', variantLabel:'Cover A', customerQty:20, ebayPresold:0, storeQuantity:0 },
    { id:'r', variantLabel:'1:25', isIncentive:true, orderRequirement:'1:25', qualification:{ threshold:25 } },
  ] };
  const s = ctx.suggest(family, null, 0);
  assert.equal(s.lines[0].total, 25, '20 presold + 2 for a new #1 + 3 to unlock');
  assert.equal(s.unlocks[0].status, 'added');
}
assert.match(ui, /onclick="focSuggestOrder\(\)"/);
assert.match(ui, /onclick="openComicSellThrough\(\)"/);
assert.match(ui, /if\(!confirm\('Set the store quantity on /, 'nothing saved without confirming');
console.log('FOC order helper + sell-through checks passed');
// Presale copies only carry a name: series and issue come from it.
assert.equal(comicSeriesKey({ data:{ name:'Sabrina the Teenage Witch #2 Cover G 1:100 Var - PRESALE' } }), 'SABRINA THE TEENAGE WITCH');
assert.equal(comicSeriesKey({ data:{ name:'The Autumn Kingdom Vol. 2: The Wraithbound Queen - PRESALE' } }), 'THE AUTUMN KINGDOM');
{
  const { series } = computeComicSellThrough([
    { id:'p1', status:'presale', created_at:daysAgo(3), data:{ source:'foc_presale', name:'Zed #1 Cover A - PRESALE', qty:0, focPresaleOriginalQty:2 } },
    { id:'p2', status:'presale', created_at:daysAgo(3), data:{ source:'foc_presale', name:'Zed #2 Cover A - PRESALE', qty:0, focPresaleOriginalQty:2 } },
  ], new Map(), now);
  assert.equal(series[0].issues, 2);
  assert.equal(series[0].perIssueSold, 2);
}
