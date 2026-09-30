import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Whatnot bridge: the export must match Whatnot's own template exactly, and
// the show-report import must record each sale once, only for matched,
// non-cancelled rows.
const src = fs.readFileSync('scripts/whatnot-bridge.js', 'utf8');
const dash = fs.readFileSync('dashboard.html', 'utf8');
const templateHeader = fs.readFileSync('tests/fixtures/whatnot-csv-template.csv', 'utf8').split(/\r?\n/)[0].split(',');

// Same parser the dashboard uses.
const parseStart = dash.indexOf('function parseCSV(text){');
const parseCSVSrc = dash.slice(parseStart, dash.indexOf('\n}', parseStart) + 2);

function makeContext() {
  const elements = {};
  const downloads = [];
  const calls = [];
  const payments = new Set();
  const ctx = {
    console, Set, Map, Promise, JSON, Math, Number, String, Date, Array, Object, RegExp, isNaN,
    all: [
      { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Charizard', set: 'Base Set', card_number: '4', category: 'Pokemon TCG', qty: 1, status: 'in_stock', cost: 50, condition: 'NM', photos: ['https://img.example/c.jpg', 'blob:local'], listPrice: 300, market: 280 },
      { id: 'aaaaaaaa-0000-0000-0000-000000000002', name: 'Mike Trout', set: 'Baseball Cards 2011 Topps Update', category: 'Sports', qty: 1, status: 'in_stock', cost: 0, condition: 'Excellent', listPrice: 40, market: 40 },
      { id: 'aaaaaaaa-0000-0000-0000-000000000004', name: 'Julio Rodriguez', set: 'Baseball Cards 2022 Topps Update', category: 'Sports', qty: 1, status: 'in_stock', grader: 'PSA', condition: 'NM', listPrice: 90, market: 90 },
      { id: 'foc-2', name: 'SAGA #70 CVR A', category: 'Comic', qty: 2, status: 'in_stock', condition: 'NM', listPrice: 5, market: 5, raw: { focCycleId: 'cycle-sep', focReceivedAt: '2026-09-29T18:00:00Z' } },
      { id: 'foc-old', name: 'OLD WEEK #1', category: 'Comic', qty: 1, status: 'in_stock', listPrice: 5, market: 5, raw: { focCycleId: 'cycle-aug', focReceivedAt: '2026-08-20T18:00:00Z' } },
      { id: 'foc-presale', name: 'NOT OUT YET #1 - PRESALE', category: 'Comic', qty: 10, status: 'presale', lifecycle: 'presale', listPrice: 5, market: 5, raw: { source: 'foc_presale', focCycleId: 'cycle-sep' } },
      { id: 'foc-presale-only', name: 'OCTOBER BOOK #2 - PRESALE', category: 'Comic', qty: 20, status: 'presale', listPrice: 5, market: 5, raw: { source: 'foc_presale', focCycleId: 'cycle-oct' } },
      { id: 'foc-sold', name: 'SOLD WEEK BOOK', category: 'Comic', qty: 0, status: 'sold', raw: { focCycleId: 'cycle-sep' } },
      { id: 'aaaaaaaa-0000-0000-0000-000000000005', name: 'Bin of stuff', category: 'Collectibles', qty: 1, status: 'in_stock', listPrice: 5, market: 5 },
      { id: '54c8313b-d067-410c-a12a-5eede06c1217', name: 'ADVENTURE TIME HALLOWEEN SPECIAL #1 CVR A SEAN DOVE - PRESALE', category: 'Comic', qty: 1, status: 'in_stock', condition: 'NM', cost: 4, listPrice: 6, market: 6,
        raw: { publisher: 'Oni Press', onSaleDate: '2026-09-30', focCycleId: 'cycle-sep', focReceivedAt: '2026-09-30T18:00:00Z', focComicDetail: { source: 'foc', number: '1', writers: ['Jeremy Melloul'], coverArtists: ['Sean Dove'], publisher: 'Oni Press', storeDate: '2026-09-30', seriesName: 'Adventure Time (2025)', description: 'BOO . . . FROM THE LAND OF OOO! Finn and Jake enter their trickiest situation yet.' } } },
      { id: 'aaaaaaaa-0000-0000-0000-000000000003', name: 'Sold Thing', category: 'Sports', qty: 0, status: 'sold' },
    ],
    inventoryBulkSelectedIds: new Set(['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000005']),
    fetch: async (url) => {
      assert.match(String(url), /^scripts\/whatnot-values\.json/);
      return new Response(fs.readFileSync('scripts/whatnot-values.json', 'utf8'), { status: 200 });
    },
    activeTab: 'whatnot',
    getActiveStoreId: () => 'store-1',
    getSupabaseClient: () => ({ from: table => {
      assert.equal(table, 'foc_cycles');
      const q = { select: () => q, eq: () => q, order: () => q, limit: async () => ({ data: [{ id: 'cycle-sep', foc_date: '2026-09-07', distributor: 'PRH' }, { id: 'cycle-aug', foc_date: '2026-08-03', distributor: 'Lunar' }] }) };
      return q;
    } }),
    switchTab: name => { ctx.activeTab = name; },
    refreshBuiltInInventoryDelta: async () => true,
    inventoryProfitStats: i => ({ list: Number(i.listPrice || 0), market: Number(i.market || 0) }),
    inventoryImageUrl: () => '',
    whatnotFeeSettings: () => ({ pct: 10, flat: 0.5 }),
    downloadCSV: (name, rows) => downloads.push({ name, rows }),
    toast_dash: () => {}, logOpsEvent: () => {}, loadInventory: async () => {},
    confirm: () => true,
    storeWorkerFetch: async (path, opts = {}) => {
      const body = opts.body ? JSON.parse(opts.body) : null;
      calls.push({ path, body });
      if (path === '/store/whatnot-settings') return new Response(JSON.stringify({ ok: true, settings: body ? body.settings : {} }), { status: 200 });
      if (path === '/inventory/record-external-sale') {
        if (payments.has(body.externalRef)) return new Response(JSON.stringify({ ok: true, duplicate: true }), { status: 200 });
        payments.add(body.externalRef);
        return new Response(JSON.stringify({ ok: true, profit: 1 }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    },
    FileReader: class { readAsText(file) { this.result = file.text; setTimeout(() => this.onload(), 0); } },
    document: { getElementById: id => (elements[id] ||= { innerHTML: '', id }) },
    setTimeout,
    Response,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(parseCSVSrc, ctx);
  vm.runInContext(src, ctx);
  return { ctx, downloads, calls, elements };
}

const { ctx, downloads, calls, elements } = makeContext();
await new Promise(r => setTimeout(r, 10));
assert.match(elements['whatnot-bridge'].innerHTML, /SEND ITEMS TO WHATNOT/);
assert.match(elements['whatnot-bridge'].innerHTML, /IMPORT SHOW RESULTS/);

// Built-in values are Whatnot's own Values tab, parsed with the same code
// the LOAD WHATNOT VALUES button uses.
const builtIn = JSON.parse(fs.readFileSync('scripts/whatnot-values.json', 'utf8'));
assert.equal(builtIn.categories.length, 35);
assert.ok(builtIn.subCategoriesByCategory['Trading Card Games'].includes('Pokémon Cards'));
assert.deepEqual(builtIn.conditionsBySubCategory['Baseball Singles'], ['Graded', 'Raw - Near Mint or Better', 'Raw - Excellent', 'Raw - Very Good', 'Raw - Poor']);

// Suggested mappings apply before anything is saved, and say so.
assert.match(elements['whatnot-bridge'].innerHTML, /suggested -- check, then SAVE/);
assert.match(elements['whatnot-bridge'].innerHTML, /Using Whatnot's allowed values \(Whatnot template, Sep 2026\)/);
ctx.WB.set('type', 'Auction');
ctx.WB.set('auctionRule', 'one');
ctx.WB.download();
assert.equal(downloads.length, 1);
const [header, pokemon, trout, julio, bin] = downloads[0].rows;
assert.deepEqual([...header], templateHeader, 'columns must be exactly Whatnot\'s template order');
const col = name => header.indexOf(name);
assert.equal(pokemon[col('Category')], 'Trading Card Games');
assert.equal(pokemon[col('Sub Category')], 'Pokémon Cards');
assert.equal(pokemon[col('Shipping Profile')], '0-1 oz');
assert.equal(pokemon[col('Condition')], 'Near Mint', 'NM becomes Whatnot\'s "Near Mint" for Pokémon');
assert.equal(pokemon[col('Type')], 'Auction');
assert.equal(pokemon[col('Price')], '1', 'a $1 starting bid');
assert.equal(pokemon[col('SKU')], 'aaaaaaaa-0000-0000-0000-000000000001', 'SKU is the dashboard id so the show report can be matched back');
assert.equal(pokemon[col('Cost Per Item')], '50.00');
assert.equal(pokemon[col('Hazmat')], 'Not Hazmat');
assert.equal(pokemon[col('Image URL 1')], 'https://img.example/c.jpg');
assert.equal(pokemon[col('Image URL 2')], '', 'non-web image URLs are never exported');
assert.equal(trout[col('Category')], 'Sports Cards');
assert.equal(trout[col('Sub Category')], 'Baseball Singles', 'sport read from the set name');
assert.equal(trout[col('Shipping Profile')], 'Sports singles (3oz)');
assert.equal(trout[col('Condition')], 'Raw - Excellent', 'Excellent becomes Whatnot\'s raw-card wording for baseball');
assert.equal(julio[col('Condition')], 'Graded', 'an item with a grader is Graded');
assert.equal(bin[col('Category')], '', 'a category with no mapping is left blank, never guessed');
assert.equal(bin[col('Condition')], '');
assert.equal(downloads[0].rows.length, 5, 'sold items are never exported');
assert.match(elements['whatnot-bridge'].innerHTML, /Set a Whatnot category and shipping profile for: Collectibles/);

// A value Whatnot wouldn't accept is flagged red; saving stores the mapping.
ctx.WB.setMap('Collectibles', 'category', 'Toys & Hobbies');
ctx.WB.setMap('Collectibles', 'subCategory', 'Not A Real Subcategory');
assert.match(elements['whatnot-bridge'].innerHTML, /value="Not A Real Subcategory"[^>]*border-color:var\(--red\)/);
ctx.WB.setMap('Collectibles', 'subCategory', 'Other Toys');
ctx.WB.setMap('Collectibles', 'shippingProfile', '8-11 oz');
ctx.WB.saveMapping();
await new Promise(r => setTimeout(r, 10));
const saved = calls.filter(c => c.path === '/store/whatnot-settings' && c.body).pop().body.settings.mapping;
assert.equal(saved.Collectibles.subCategory, 'Other Toys');
assert.equal(saved['Pokemon TCG'].subCategory, 'Pokémon Cards', 'saving keeps the suggestions that were in use');

// Buy It Now uses the list price, rounded up to whole dollars.
ctx.WB.set('type', 'Buy It Now');
ctx.WB.download();
assert.equal(downloads[1].rows[1][col('Price')], '300');
assert.equal(downloads[1].rows[1][col('Type')], 'Buy It Now');

// Loading the Values tab file itself gives the same lists as the built-in copy.
await ctx.WB.loadValues({ text: fs.readFileSync('tests/fixtures/whatnot-csv-values.csv', 'utf8').replace(/^\uFEFF/, '') });
const uploaded = calls.filter(c => c.path === '/store/whatnot-settings' && c.body?.settings?.values).pop().body.settings.values;
assert.deepEqual(JSON.parse(JSON.stringify(uploaded.subCategoriesByCategory)), builtIn.subCategoriesByCategory);
assert.deepEqual(JSON.parse(JSON.stringify(uploaded.conditionsBySubCategory)), builtIn.conditionsBySubCategory);
assert.deepEqual([...uploaded.categories], builtIn.categories);
assert.match(elements['whatnot-bridge'].innerHTML, /your uploaded Values file/);

// Import: SKU rows record; cancelled/unmatched skip; title matches wait for a tick.
const report = [
  'Order ID,Order Numeric ID,Product Name,SKU,Sold Price,Quantity,Placed At,Cancelled Or Failed',
  'W1,111,Charizard - Base Set - #4,aaaaaaaa-0000-0000-0000-000000000001,$120.00,1,2026-10-02T02:00:00Z,false',
  'W2,112,Mike Trout,,$35.00,1,2026-10-02T02:05:00Z,false',
  'W3,113,Something Else,,$9.00,1,2026-10-02T02:06:00Z,false',
  'W4,114,Charizard - Base Set - #4,aaaaaaaa-0000-0000-0000-000000000001,$99.00,1,2026-10-02T02:07:00Z,true',
].join('\n');
await ctx.WB.loadReport({ text: report });
const html = elements['whatnot-bridge'].innerHTML;
assert.match(html, /1 matched by SKU/);
assert.match(html, /1 matched by title/);
assert.match(html, /RECORD 1 SALE</);
await ctx.WB.recordSales();
const sales = calls.filter(c => c.path === '/inventory/record-external-sale');
assert.equal(sales.length, 1, 'only the SKU-matched, non-cancelled row is recorded');
assert.equal(sales[0].body.channel, 'Whatnot');
assert.equal(sales[0].body.salePrice, 120);
assert.equal(sales[0].body.feeAmount, 12.5, 'fee estimated from the Whatnot fee setting when the report has none');
assert.equal(sales[0].body.externalRef, 'whatnot:W1:aaaaaaaa-0000-0000-0000-000000000001');
assert.equal(sales[0].body.soldAt, '2026-10-02T02:00:00.000Z');

// Loading and recording the same report again records nothing new.
await ctx.WB.loadReport({ text: report });
await ctx.WB.recordSales();
assert.match(elements['whatnot-bridge'].innerHTML, /Already recorded/);
// Comics: a full description with the synopsis. The CSV never gets extra
// columns -- Whatnot rejects any file that isn't exactly its template.
ctx.inventoryBulkSelectedIds = new Set(['54c8313b-d067-410c-a12a-5eede06c1217']);
ctx.WB.download();
const comicSheet = downloads[downloads.length - 1].rows;
const comicRow = comicSheet[1];
const desc = comicRow[col('Description')];
assert.match(desc, /^ADVENTURE TIME HALLOWEEN SPECIAL #1 CVR A SEAN DOVE - PRESALE\nAdventure Time \(2025\) #1\n/);
assert.match(desc, /Publisher: Oni Press · Release date: 2026-09-30/);
assert.match(desc, /Writer: Jeremy Melloul · Cover artist: Sean Dove/);
assert.match(desc, /Condition: NM/);
assert.match(desc, /\n\nBOO \. \. \. FROM THE LAND OF OOO! Finn and Jake/, 'the synopsis follows the details');
assert.equal(comicRow[col('Condition')], 'Near Mint');
assert.equal(comicRow[col('Sub Category')], 'Modern Comics');
assert.deepEqual([...comicSheet[0]], templateHeader, 'exactly the template columns, nothing extra');
assert.ok(comicSheet.every(r => r.length === templateHeader.length));

// FOC shipment: pick a received week and get exactly its in-stock books.
ctx.WB.set('source', 'shipment');
let shipHtml = elements['whatnot-bridge'].innerHTML;
assert.match(shipHtml, /PRH FOC 2026-09-07 · received 2026-09-30 · 2 books in stock/);
assert.match(shipHtml, /Lunar FOC 2026-08-03 · received 2026-08-20 · 1 book in stock/);
assert.ok(shipHtml.indexOf('2026-09-07') < shipHtml.indexOf('2026-08-03'), 'newest shipment first');
assert.doesNotMatch(shipHtml, /cycle-oct/, 'a week with only presale placeholders is not a shipment');
ctx.WB.set('shipment', 'cycle-sep');
ctx.WB.download();
const shipRows = downloads[downloads.length - 1].rows.slice(1).map(r => r[col('SKU')]);
assert.deepEqual([...shipRows].sort(), ['54c8313b-d067-410c-a12a-5eede06c1217', 'foc-2'], 'only that week\'s in-stock books, never presale placeholders');
shipHtml = elements['whatnot-bridge'].innerHTML;
assert.match(shipHtml, /See the 2 items going in this file/);
assert.match(shipHtml, /SAGA #70 CVR A ×2/);
assert.doesNotMatch(shipHtml, /NOT OUT YET/);

// The FOC cover wall's SEND TO WHATNOT button lands on the same selection.
ctx.WB.set('source', 'selected');
ctx.activeTab = 'foc';
await ctx.sendFocShipmentToWhatnot('cycle-aug');
assert.equal(ctx.activeTab, 'whatnot');
ctx.WB.download();
assert.deepEqual([...downloads[downloads.length - 1].rows.slice(1).map(r => r[col('SKU')])], ['foc-old']);

console.log('Whatnot bridge export/import checks passed');

// Worker: a repeated externalRef is a no-op, and the ref is stored.
const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
const posts = [];
let existingRef = false;
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const ok = d => new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json' } });
  if (url.includes('/auth/v1/user')) return ok({ id: 'user-1', email: 'staff@example.com' });
  if (url.includes('store_members')) return ok([{ role: 'owner' }]);
  if (url.includes('pos_payments?store_id=') && url.includes('reference=eq.')) return ok(existingRef ? [{ id: 'p1', sale_id: 's1' }] : []);
  if (url.includes('inventory_items?id=eq.')) {
    if ((init.method || 'GET') === 'GET') return ok([{ id: 'item-1', status: 'in_stock', data: { name: 'Charizard', qty: 1, cost: 50 } }]);
    return ok([]);
  }
  if ((init.method || 'GET') === 'POST') { posts.push({ url, body: JSON.parse(init.body) }); return ok([]); }
  return ok([]);
};
try {
  const { default: api } = await import('../cloudflare-worker-full.js');
  const env = { SUPABASE_URL: 'https://database.example', SUPABASE_SERVICE_ROLE_KEY: 'test-only' };
  const call = () => api.fetch(new Request('https://api.example/inventory/record-external-sale', { method: 'POST', headers: { Authorization: 'Bearer t', 'X-Store-Id': 'store-1', 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: 'item-1', channel: 'Whatnot', salePrice: 120, feeAmount: 12, externalRef: 'whatnot:W1:item-1' }) }), env, { waitUntil() {} });
  let data = await (await call()).json();
  assert.equal(data.ok, true);
  const payment = posts.find(p => p.url.includes('/pos_payments'));
  assert.equal(payment.body.reference, 'whatnot:W1:item-1', 'the Whatnot order reference is saved on the payment');
  existingRef = true; posts.length = 0;
  data = await (await call()).json();
  assert.equal(data.duplicate, true);
  assert.equal(posts.length, 0, 'a repeated reference writes nothing');
} finally {
  globalThis.fetch = originalFetch;
  globalThis.caches = originalCaches;
}
console.log('record-external-sale duplicate guard checks passed');

// Dashboard wiring.
assert.match(dash, /<div id="whatnot-bridge"><\/div>/);
assert.match(dash, /<script src="scripts\/whatnot-bridge\.js\?v=[^"]+" defer><\/script>/);
assert.match(dash, /if\(name === 'whatnot' && window\.renderWhatnotBridge\)/);
