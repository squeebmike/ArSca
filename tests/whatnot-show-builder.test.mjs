import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const migration = fs.readFileSync('supabase-migrations/2026-09-08-whatnot-shows.sql', 'utf8');

// Store idea: Show Builder ("What Should I Sell Tonight?" / Show Planner)
// drafts a run-of-show from current inventory; Show Inventory Bucket /
// Live Auction Companion drives it live (NEXT ITEM / SOLD / PASS /
// GIVEAWAY); Show P&L totals it at the end. Built as a layer on top of
// the EXISTING Whatnot Mode scan-and-sell flow (selectWhatnotItem /
// confirmWhatnotSale / record-external-sale) rather than a parallel sales
// pipeline, so a show's sales show up in reports/profit stats identically
// to any other Whatnot sale.

// ── Migration ──
assert.match(migration, /create table if not exists public\.whatnot_shows/, 'migration must create whatnot_shows');
assert.match(migration, /create table if not exists public\.whatnot_show_items/, 'migration must create whatnot_show_items');
assert.match(migration, /inventory_item_id uuid references public\.inventory_items\(id\) on delete set null/, 'show items must reference the real inventory_items table');
assert.match(migration, /role text not null default 'engagement' check \(role in \('opener','engagement','anchor','giveaway','closer'\)\)/, 'must model the full opener->engagement->anchor->giveaway->closer run-of-show');
assert.match(migration, /status text not null default 'queued' check \(status in \('queued','sold','passed','giveaway','pulled_for_later','needs_relisting'\)\)/, 'must model every live-auction outcome the roadmap describes');
assert.match(migration, /alter table public\.whatnot_shows enable row level security/, 'RLS must be enabled on whatnot_shows');
assert.match(migration, /alter table public\.whatnot_show_items enable row level security/, 'RLS must be enabled on whatnot_show_items');
assert.match(migration, /whatnot_shows_select_member.*'owner','admin','manager','employee'/s, 'any staff member must be able to see shows, not just owner/admin');

console.log('Whatnot Show Builder migration contract checks passed');

// ── Show Builder algorithm ──
assert.match(dashboard, /function buildShowRunOfShow\(items, opts=\{\}\)\{/, 'missing buildShowRunOfShow');
const buildStart = dashboard.indexOf('function buildShowRunOfShow(items, opts={}){');
const buildEnd = dashboard.indexOf('\n}', buildStart) + 2;
const buildFn = dashboard.slice(buildStart, buildEnd);
assert.match(buildFn, /\.filter\(inventoryItemIsSellable\)\.filter\(i => category === 'Mixed' \|\| i\.category === category\)/, 'must scope to sellable items in the chosen category (or all, for Mixed)');
assert.match(buildFn, /const opener = take\(midTier, openerCount\);/, 'opener must be pulled from the mid-tier pool, not the top-value pool -- must not blow the best inventory in the first 15 minutes');
assert.match(buildFn, /role:'anchor'/, 'must assign an anchor role to the highest-value items');
assert.match(buildFn, /role:'giveaway'/, 'must assign a giveaway role');
assert.match(buildFn, /role:'closer'/, 'must assign a closer role');
assert.match(buildFn, /engagement\.slice\(0, half\)/, 'engagement filler must be interleaved around the anchor block (before AND after), not dumped all at once');

// ── Live Auction Companion wiring onto the EXISTING sell flow ──
assert.match(dashboard, /function pullNextShowItem\(\)\{/, 'missing pullNextShowItem');
const pullStart = dashboard.indexOf('function pullNextShowItem(){');
const pullEnd = dashboard.indexOf('\n}', pullStart) + 2;
const pullFn = dashboard.slice(pullStart, pullEnd);
assert.match(pullFn, /selectWhatnotItem\(resolved\);/, 'NEXT ITEM must reuse the existing selectWhatnotItem, not a separate current-item mechanism');
assert.match(pullFn, /const next = whatnotShowItems\.find\(r => r\.status === 'queued'\);/, 'must pull the next QUEUED item by position order');

// confirmWhatnotSale must be hooked to also close out the show item.
const confirmStart = dashboard.indexOf('async function confirmWhatnotSale(){');
const confirmEnd = dashboard.indexOf('\nfunction renderWhatnotSessionTally', confirmStart);
const confirmFn = dashboard.slice(confirmStart, confirmEnd);
assert.match(confirmFn, /if\(whatnotCurrentShowItemId\)\{/, 'a real sale during an active show must update the show_item row, not just the general session tally');
assert.match(confirmFn, /updateWhatnotShowItemStatus\(soldShowItemId,'sold',\{ sold_price_cents:Math\.round\(price\*100\), sold_at:new Date\(\)\.toISOString\(\) \}\);/, 'the show item must record the ACTUAL sale price, not the planned market price');

assert.match(dashboard, /function giveawayWhatnotShowItem\(\)\{/, 'missing giveawayWhatnotShowItem');
const giveStart = dashboard.indexOf('async function giveawayWhatnotShowItem(){');
const giveEnd = dashboard.indexOf('\n}', giveStart) + 2;
const giveFn = dashboard.slice(giveStart, giveEnd);
assert.match(giveFn, /channel:'Whatnot Giveaway', salePrice:0\.01, feeAmount:0/, 'giveaway must still run through record-external-sale (so inventory actually depletes) tagged with its own distinct channel');

assert.match(dashboard, /function passWhatnotShowItem\(\)\{/, 'missing passWhatnotShowItem');

// Entry points
assert.match(dashboard, /<div id="whatnot-show-panel" style="margin-bottom:14px"><\/div>/, 'Whatnot Mode tab must have a show panel container');
assert.match(dashboard, /if\(tab==='whatnot'\) loadActiveWhatnotShow\(\);/, 'switching to the Whatnot tab must check for an already-live show (cross-device continuity)');
assert.match(dashboard, /onclick="openShowBuilderModal\(\)">🎬 START A SHOW<\/button>/, 'must have a clear entry point when no show is active');

// Show Inventory Bucket: manually drop a specific item into the live show
// from its row menu, on top of whatever the Show Builder auto-drafted.
assert.match(dashboard, /onclick="addItemToActiveShow\('\$\{id\}'\);closeInvRowMenu\(\)"/, 'in-stock items must have an "Add to Tonight\'s Show" row action once a show is live');
assert.match(dashboard, /function addItemToActiveShow\(itemId\)\{/, 'missing addItemToActiveShow');
const addStart = dashboard.indexOf('async function addItemToActiveShow(itemId){');
const addEnd = dashboard.indexOf('\n}', addStart) + 2;
const addFn = dashboard.slice(addStart, addEnd);
assert.match(addFn, /if\(!whatnotActiveShow\)\{ toast_dash\('No show is live -- start one first'\); return; \}/, 'must refuse to queue an item with no active show');
assert.match(addFn, /role:'engagement'/, 'a manual mid-show add must be queued as filler, not misrepresented as a pre-planned anchor/closer');

// Show P&L
const endStart = dashboard.indexOf('async function endWhatnotShow(){');
const endEnd = dashboard.indexOf('\n}', endStart) + 2;
const endFn = dashboard.slice(endStart, endEnd);
assert.match(endFn, /const gross = sold\.reduce\(\(s, r\) => s \+ Number\(r\.sold_price_cents \|\| 0\) \/ 100, 0\);/, 'P&L gross must come from ACTUAL sold prices, not planned market prices');
assert.match(endFn, /const giveawayCost = giveaways\.reduce\(\(s, r\) => s \+ Number\(r\.cost_cents \|\| 0\) \/ 100, 0\);/, 'must track true giveaway cost separately from COGS on real sales');
assert.match(endFn, /const profitPerHour = profit \/ hours;/, 'must compute profit per hour, so shows are comparable regardless of length');

console.log('Whatnot Show Builder dashboard contract checks passed');

// ── Functional: reimplement buildShowRunOfShow and prove opener != anchor ──
function inventoryItemIsSellable(item){ return item.status === 'in_stock' && (item.qty||1) > 0; }
function inventoryListPrice(item){ return Number(item.market||0); }
function buildShowRunOfShow(items, opts={}){
  const lengthMinutes = opts.lengthMinutes || 60;
  const category = opts.category || 'Mixed';
  const itemsPerHour = opts.itemsPerHour || 20;
  const targetCount = Math.max(6, Math.round(lengthMinutes/60*itemsPerHour));
  const pool = items.filter(inventoryItemIsSellable).filter(i => category==='Mixed' || i.category===category);
  const priced = pool.map(i => ({ item:i, price: inventoryListPrice(i)||0 })).filter(x => x.price>0);
  if(!priced.length) return [];
  const anchorCount = Math.max(2, Math.round(targetCount*0.15));
  const closerCount = Math.max(1, Math.round(targetCount*0.05));
  const openerCount = Math.max(1, Math.round(targetCount*0.10));
  const giveawayCount = Math.max(1, Math.round(targetCount*0.05));
  const used = new Set();
  const take = (arr,n) => { const out=[]; for(const x of arr){ if(out.length>=n)break; if(used.has(x.item.id))continue; used.add(x.item.id); out.push(x); } return out; };
  const byValueDesc = [...priced].sort((a,b)=>b.price-a.price);
  const anchors = take(byValueDesc, anchorCount);
  const closer = take(byValueDesc, closerCount);
  const midTier = byValueDesc.filter(x=>!used.has(x.item.id));
  const opener = take(midTier, openerCount);
  const byValueAsc = [...priced].sort((a,b)=>a.price-b.price);
  const giveaway = take(byValueAsc, giveawayCount);
  const engagementTarget = Math.max(0, targetCount-anchors.length-closer.length-opener.length-giveaway.length);
  const engagement = take(byValueAsc.filter(x=>!used.has(x.item.id)), engagementTarget);
  const half = Math.ceil(engagement.length/2);
  const order = [
    ...opener.map(x=>({...x,role:'opener'})),
    ...engagement.slice(0,half).map(x=>({...x,role:'engagement'})),
    ...anchors.map(x=>({...x,role:'anchor'})),
    ...engagement.slice(half).map(x=>({...x,role:'engagement'})),
    ...giveaway.map(x=>({...x,role:'giveaway'})),
    ...closer.map(x=>({...x,role:'closer'})),
  ];
  return order.map((x,idx)=>({position:idx+1,item:x.item,role:x.role,listPrice:x.price}));
}

const items = Array.from({length:40}, (_,i) => ({
  id:'item'+i, status:'in_stock', qty:1, category:'Pokemon TCG', market: 5 + i*10, // $5 to $395
}));
const show = buildShowRunOfShow(items, { lengthMinutes:60, category:'Pokemon TCG' });
assert.ok(show.length >= 6, 'a 60-minute show from 40 items must produce a real run of show');
const opener = show.filter(x => x.role==='opener');
const anchor = show.filter(x => x.role==='anchor');
const closer = show.filter(x => x.role==='closer');
assert.ok(opener.length > 0 && anchor.length > 0, 'must have both opener and anchor slots filled');
const maxOpenerPrice = Math.max(...opener.map(x=>x.listPrice));
const minAnchorPrice = Math.min(...anchor.map(x=>x.listPrice));
assert.ok(maxOpenerPrice < minAnchorPrice, 'the opener must never be worth more than the cheapest anchor -- the best inventory must not open the show');
const positions = show.map(x=>x.position);
assert.deepEqual(positions, [...positions].sort((a,b)=>a-b), 'positions must be sequential and ordered');
const ids = show.map(x=>x.item.id);
assert.equal(new Set(ids).size, ids.length, 'no item should appear twice in one run of show');
if(closer.length){
  const maxAnchorPrice = Math.max(...anchor.map(x=>x.listPrice));
  const maxCloserPrice = Math.max(...closer.map(x=>x.listPrice));
  assert.ok(maxCloserPrice <= maxAnchorPrice, 'the closer tier must not exceed the show\'s peak (anchor) value');
}

// Category filtering: a category-scoped show must never pull unrelated stock.
const mixedItems = [
  { id:'p1', status:'in_stock', qty:1, category:'Pokemon TCG', market:20 },
  { id:'p2', status:'in_stock', qty:1, category:'Pokemon TCG', market:30 },
  { id:'p3', status:'in_stock', qty:1, category:'Pokemon TCG', market:40 },
  { id:'p4', status:'in_stock', qty:1, category:'Pokemon TCG', market:50 },
  { id:'p5', status:'in_stock', qty:1, category:'Pokemon TCG', market:60 },
  { id:'p6', status:'in_stock', qty:1, category:'Pokemon TCG', market:70 },
  { id:'c1', status:'in_stock', qty:1, category:'Comic', market:25 },
];
const pokemonOnly = buildShowRunOfShow(mixedItems, { lengthMinutes:15, category:'Pokemon TCG' });
assert.ok(pokemonOnly.every(x => x.item.category === 'Pokemon TCG'), 'a category-scoped show must never include a different category');

// Empty pool: a category with nothing sellable must return an empty show, not throw.
assert.deepEqual(buildShowRunOfShow([], { category:'Sports' }), [], 'an empty inventory pool must produce an empty run of show, not an error');

console.log('Whatnot Show Builder functional checks passed');
