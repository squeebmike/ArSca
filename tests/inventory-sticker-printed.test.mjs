import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store ask: "a thing that tells us if we printed an initial sticker or not.
// Like if we didn't print a sticker when we took it in for buy or trade, or
// added it in the inventory. All pokemon, mtg, collectibles need to be set as
// didn't print sticker... then a section or filter that shows what still
// needs stickers. All sports and comics in stock have had a sticker printed."
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
function extractFn(name, prefix = 'function ') {
  const start = dashboard.indexOf(prefix + name + '(');
  assert.ok(start >= 0, name + ' must exist');
  return dashboard.slice(start, dashboard.indexOf('\n}\n', start) + 2);
}
const line = sig => { const s = dashboard.indexOf(sig); assert.ok(s >= 0, sig); return dashboard.slice(s, dashboard.indexOf('\n', s) + 1); };

function load(items, saveImpl) {
  const saves = [];
  const fn = new Function('all', 'saveInventoryEdit', 'filterTable', 'toast_dash', [
    line('const STICKER_TRACKING_START ='),
    extractFn('qplCategoryKey'), line('function isSportsCardCategory('), line('function inventoryIsDropship('),
    extractFn('inventoryStickerPrinted'), extractFn('inventoryNeedsSticker'),
    extractFn('markInventoryStickersPrinted', 'async function '), extractFn('setInventoryStickerPrinted', 'async function '),
    'return { inventoryStickerPrinted, inventoryNeedsSticker, markInventoryStickersPrinted, setInventoryStickerPrinted };',
  ].join('\n'));
  const api = fn(items, saveImpl || (async (item, updates) => { saves.push({ id:item.id, updates }); return true; }), () => {}, () => {});
  return { ...api, saves };
}

const before = '2026-09-01T00:00:00Z', after = '2026-10-12T00:00:00Z';
const item = (id, category, extra = {}) => ({ id, category, status:'in_stock', addedAt:before, raw:{}, ...extra });

// ── Items already in stock: comics and sports were stickered, the rest not ──
{
  const { inventoryStickerPrinted, inventoryNeedsSticker } = load([]);
  assert.equal(inventoryStickerPrinted(item('c', 'Comic')), true);
  assert.equal(inventoryStickerPrinted(item('s', 'Sports')), true);
  assert.equal(inventoryStickerPrinted(item('b', 'Baseball')), true);
  assert.equal(inventoryStickerPrinted(item('p', 'Pokemon TCG')), false);
  assert.equal(inventoryStickerPrinted(item('m', 'Magic: The Gathering')), false);
  assert.equal(inventoryStickerPrinted(item('x', 'Collectible')), false);
  assert.equal(inventoryStickerPrinted(item('f', 'Funko Pop')), false);
  assert.equal(inventoryStickerPrinted(item('n', 'Pokemon', { addedAt:'' })), false, 'no date on record still follows the category rule');
  assert.equal(inventoryNeedsSticker(item('p', 'Pokemon')), true);
  assert.equal(inventoryNeedsSticker(item('p', 'Pokemon', { status:'sold' })), false, 'only stock on the shelf');
  assert.equal(inventoryNeedsSticker(item('d', 'Supplies', { dropship:true })), false, 'drop-ship supplies never sit on the shelf');
  assert.equal(inventoryNeedsSticker(item('a', 'Pokemon', { lifecycle:'archived' })), false);
}
// ── Anything added from now on needs one until it's printed ──
{
  const { inventoryStickerPrinted } = load([]);
  assert.equal(inventoryStickerPrinted(item('c2', 'Comic', { addedAt:after })), false, 'a new comic (buy, trade or FOC receiving) needs a sticker too');
  assert.equal(inventoryStickerPrinted(item('s2', 'Sports', { addedAt:after })), false);
  assert.equal(inventoryStickerPrinted(item('p2', 'Pokemon', { addedAt:after, raw:{ stickerPrinted:true } })), true);
  assert.equal(inventoryStickerPrinted(item('c3', 'Comic', { stickerPrinted:false })), false, 'an explicit "needs sticker" wins over the category rule');
  assert.equal(inventoryStickerPrinted(item('p3', 'Pokemon', { raw:{ stickerPrintedAt:'2026-10-10T00:00:00Z' } })), true);
}
// ── Printing marks every item in the batch, once ──
{
  const items = [item('p', 'Pokemon', { source:'built_in' }), item('m', 'MTG'), item('done', 'Pokemon', { stickerPrinted:true })];
  const { markInventoryStickersPrinted, inventoryNeedsSticker, saves } = load(items);
  const marked = await markInventoryStickersPrinted([{ id:'p', qty:3 }, { id:'p', qty:1 }, { id:'m' }, { id:'done' }, { id:'gone' }]);
  assert.equal(marked, 2);
  assert.deepEqual(saves.map(s => s.id), ['p', 'm'], 'one save per item, none for one already marked or not found');
  assert.equal(saves[0].updates.stickerPrinted, true);
  assert.match(saves[0].updates.stickerPrintedAt, /^\d{4}-\d\d-\d\dT/);
  assert.equal(inventoryNeedsSticker(items[0]), false);
  assert.equal(items[0].raw.stickerPrinted, true, 'the saved copy carries it too');
}
// ── A failed save leaves it on the list ──
{
  const items = [item('p', 'Pokemon')];
  const { markInventoryStickersPrinted, inventoryNeedsSticker } = load(items, async () => { throw new Error('offline'); });
  assert.equal(await markInventoryStickersPrinted([{ id:'p' }]), 0);
  assert.equal(inventoryNeedsSticker(items[0]), true);
}
// ── Set by hand from the ⋯ menu ──
{
  const items = [item('c', 'Comic')];
  const { setInventoryStickerPrinted, inventoryNeedsSticker, saves } = load(items);
  await setInventoryStickerPrinted('c', false);
  assert.equal(inventoryNeedsSticker(items[0]), true);
  await setInventoryStickerPrinted('c', true);
  assert.equal(inventoryNeedsSticker(items[0]), false);
  assert.equal(saves.length, 2);
}

// ── Wiring ──
assert.match(dashboard, /\['stickerPrinted', null\], \['stickerPrintedAt',''\],/, 'the flag survives every other edit to the item');
assert.match(dashboard, /onclick="setF\('flag','needs_sticker',this\)">Needs Sticker<\/button>/, 'a Needs Sticker filter');
assert.match(dashboard, /if\(flag === 'needs_sticker'\) return inventoryNeedsSticker\(i\);/);
assert.match(dashboard, /\['needs_sticker','Needs Sticker',h\.needsSticker,'no price sticker printed'\],/, 'and an inventory health card with the count');
const printFn = extractFn('printInventoryLabels', 'async function ');
assert.match(printFn, /markInventoryStickersPrinted\(labelPrintBatch\.slice\(\)\);/, 'printing labels marks them');
const pngFn = extractFn('downloadInventoryLabelPngs', 'async function ');
assert.match(pngFn, /markInventoryStickersPrinted\(labelPrintBatch\.slice\(\)\);/, 'and so does downloading them for the phone printer');
assert.match(dashboard, /onclick="setInventoryStickerPrinted\('\$\{id\}', true\);closeInvRowMenu\(\)">✓ Mark Sticker Printed<\/button>/);
assert.match(dashboard, /onclick="setInventoryStickerPrinted\('\$\{id\}', false\);closeInvRowMenu\(\)">🏷️ Mark Needs Sticker<\/button>/);

console.log('Inventory sticker-printed tracking checks passed');
