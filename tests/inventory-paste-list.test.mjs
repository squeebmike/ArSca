// PASTE TO INVENTORY (store, 2026-11-16: "I need the inventory tab to have a quick paste there ... change foil
// finishes etc just like the research tab. You can change the price you pay for each card or set the percent paid
// to the bulk. You can remove any ... then hit add to inventory and it'll import them all.")
// and the buy tray's 100-card cap ("I'm maxed at 100 bulk buy").
import assert from 'node:assert/strict';
import fs from 'node:fs';
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
const html = fs.readFileSync('dashboard.html', 'utf8');
const grab = sig => { const i = app.indexOf(sig); assert.ok(i >= 0, sig); let d = 0, j = app.indexOf('){', i) + 1; for (; j < app.length; j++) { if (app[j] === '{') d++; else if (app[j] === '}' && !--d) break; } return app.slice(i, j + 1); };

// The button sits right after ONE-OFF / SCAN TO CART / SCAN TO FIND.
const bar = html.slice(html.indexOf('inv-action-tabs'), html.indexOf('SYNC PRICES'));
assert.ok(bar.indexOf('PASTE TO INVENTORY') > bar.indexOf('SCAN TO FIND'), 'right of the scan buttons');
assert.ok(html.includes('onclick="openInventoryPaste()"'));

// Buy trays keep up to 1,000 cards, not 100.
assert.ok(app.includes('const BUY_TRAY_MAX_ITEMS = 1000;'));
assert.ok(!app.includes('tray.items = buyList.slice(0,100);'), 'no 100-card cap left');
assert.equal((app.match(/tray\.items = buyList\.slice\(0,BUY_TRAY_MAX_ITEMS\);/g) || []).length, 2);

// Paid % of market, hand-typed prices, finish change, remove, totals.
const src = ['invPasteConditionsFor', 'invPasteFinishes', 'invPastePayFor', 'invPasteTotals', 'setInventoryPastePct', 'setInventoryPasteLine', 'removeInventoryPasteLine', 'inventoryPasteCategory', 'inventoryPasteUpdates'].map(n => grab('function ' + n + '(')).join('\n');
const GAME = [['Loose', 'ungraded'], ['CIB', 'grade7'], ['New', 'grade8']];
const env = new Function('normalizeQplFinish', 'qplFinishLabel', 'applyQplSelectedVariant', 'renderInventoryPaste', 'INV_PASTE_CONDITIONS', 'qplIsVideoGameRow', 'applyQplVideoGameCondition', 'QPL_GAME_CONDITIONS', 'normalizeQuickCategory', 'tcgLineFromText',
  'let invPaste = null;\n' + src + '\nreturn { set: v => { invPaste = v; }, get: () => invPaste, invPastePayFor, invPasteTotals, setInventoryPastePct, setInventoryPasteLine, removeInventoryPasteLine, inventoryPasteUpdates, invPasteFinishes, inventoryPasteCategory, invPasteConditionsFor };')(
  f => String(f || 'normal').toLowerCase(), f => ({ normal: 'Normal', foil: 'Foil', etched_foil: 'Foil Etched' })[f] || f,
  r => { r.market = (r.availableVariants.find(v => v.finish === r.selectedFinish) || {}).price || 0; return r; }, () => {}, ['NM', 'LP', 'MP', 'HP', 'DMG'],
  r => !!r?.isGame, (r, c) => { const k = (GAME.find(g => g[0] === c) || GAME[0]); r.selectedCondition = k[0]; r.market = r.pricecharting.prices[k[1]]; return r; }, GAME,
  c => /pokemon|magic/i.test(c) ? 'TCG' : (c || 'Collectibles'), () => ({ category: 'Pokemon TCG' }));
assert.equal(env.invPastePayFor(10, 50), 5); assert.equal(env.invPastePayFor(3.33, 40), 1.33);
const bolt = { name: 'Lightning Bolt', set: 'Magic 2010', card_number: '146', market: 2, selectedFinish: 'normal', scryfallId: 'abc', imageUrl: 'https://img/x.jpg', availableVariants: [{ finish: 'normal', price: 2 }, { finish: 'foil', price: 9 }] };
const sol = { name: 'Sol Ring', set: 'C21', market: 1, selectedFinish: 'normal', availableVariants: [{ finish: 'normal', price: 1 }] };
env.set({ pct: 50, lines: [{ uid: 'u1', row: bolt, qty: 4, condition: 'NM', pay: 1, payByHand: false }, { uid: 'u2', row: sol, qty: 1, condition: 'NM', pay: 0.5, payByHand: false }], missing: [], skipped: [] });
assert.deepEqual(env.invPasteFinishes(bolt), ['normal', 'foil']);
assert.deepEqual(env.invPasteTotals(), { copies: 5, market: 9, paid: 4.5 });
env.setInventoryPasteLine(1, 'pay', '0.75'); assert.equal(env.get().lines[1].pay, 0.75); assert.equal(env.get().lines[1].payByHand, true);
env.setInventoryPastePct(30); assert.equal(env.get().lines[0].pay, 0.6, 'the % sets every card'); assert.equal(env.get().lines[1].pay, 0.75, '...but not a price typed by hand');
env.setInventoryPastePct(30, true); assert.equal(env.get().lines[1].pay, 0.3, 'APPLY TO ALL resets typed prices too');
env.setInventoryPasteLine(0, 'finish', 'foil'); assert.equal(bolt.market, 9); assert.equal(env.get().lines[0].pay, 2.7, 'a new finish reprices the card');
env.setInventoryPasteLine(0, 'qty', '0'); assert.equal(env.get().lines[0].qty, 1);
env.setInventoryPasteLine(0, 'condition', 'LP'); assert.equal(env.get().lines[0].condition, 'LP');
const u = env.inventoryPasteUpdates(env.get().lines[0]);
assert.equal(u.name, 'Lightning Bolt (Foil)'); assert.equal(u.cost, 2.7); assert.equal(u.market, 9); assert.equal(u.qty, 1); assert.equal(u.quantity, 1);
assert.equal(u.condition, 'LP'); assert.equal(u.category, 'Magic: The Gathering'); assert.equal(u.scryfallId, 'abc'); assert.equal(u.buyItemUid, 'u1'); assert.equal(u.imageUrl, 'https://img/x.jpg');
env.removeInventoryPasteLine(1); assert.equal(env.get().lines.length, 1, 'remove takes a card off');

// Not just Magic (2026-11-16): a game line prices by Loose / CIB / New, another match can be picked, each kind its category.
{
  const game = { isGame: true, name: 'Pokemon HeartGold', set: 'Nintendo DS', market: 85, selectedCondition: 'Loose', priceSource: 'PriceCharting Guide Value · Loose', pricecharting: { productId: '777', url: 'https://www.pricecharting.com/game/nintendo-ds/pokemon-heartgold', prices: { ungraded: 85, grade7: 160, grade8: 400 } } };
  const other = { isGame: true, name: 'Pokemon SoulSilver', set: 'Nintendo DS', market: 70, selectedCondition: 'Loose', pricecharting: { productId: '778', prices: { ungraded: 70, grade7: 150, grade8: 300 } } };
  env.set({ pct: 50, lines: [{ uid: 'g1', kind: 'video_games', row: game, alts: [game, other], qty: 1, condition: 'Loose', pay: 42.5, payByHand: false, typed: 'pokemon heartgold' }], missing: [], skipped: [] });
  assert.deepEqual(env.invPasteConditionsFor(env.get().lines[0]), ['Loose', 'CIB', 'New']);
  env.setInventoryPasteLine(0, 'condition', 'CIB'); assert.equal(env.get().lines[0].condition, 'CIB'); assert.equal(env.get().lines[0].pay, 80, 'CIB reprices what you pay');
  const gu = env.inventoryPasteUpdates(env.get().lines[0]);
  assert.equal(gu.category, 'Video Games'); assert.equal(gu.name, 'Pokemon HeartGold', 'no finish on a game'); assert.equal(gu.condition, 'CIB'); assert.equal(gu.pricechartingProductId, '777');
  assert.equal(gu.market, 160); assert.match(gu.providerUrl, /pricecharting/); assert.match(gu.key_notes, /Pasted as: pokemon heartgold/);
  env.setInventoryPasteLine(0, 'alt', '1'); assert.equal(env.get().lines[0].row.name, 'Pokemon SoulSilver', 'pick another match');
  assert.equal(env.inventoryPasteCategory({ kind: 'pokemon', row: {} }), 'Pokemon TCG');
  assert.equal(env.inventoryPasteCategory({ kind: 'sports', row: {} }), 'Sports');
  assert.equal(env.inventoryPasteCategory({ kind: 'mtg', row: {} }), 'Magic: The Gathering');
  assert.equal(env.inventoryPasteCategory({ kind: 'other', row: { category: 'Funko Pop' } }), 'Funko Pop');
  const p = new Function(grab('function parseInventoryPasteLines(') + '\nreturn parseInventoryPasteLines;')();
  assert.deepEqual(p('2 Charizard ex 199/165\nPokemon HeartGold DS\n3x Ken Griffey Jr 1989 Upper Deck'), [{ quantity: 2, name: 'Charizard ex 199/165' }, { quantity: 1, name: 'Pokemon HeartGold DS' }, { quantity: 3, name: 'Ken Griffey Jr 1989 Upper Deck' }]);
  const search = grab('async function runInventoryPasteSearch(');
  assert.ok(search.includes('searchQuickCatalog(it.name, cat') && search.includes('found.slice(0, 5)') && search.includes('INV_PASTE_MAX_SEARCH_LINES'), 'each line its own Research search, top 5 to pick from, capped');
}

// Adding: one row per line, never twice for a retried line, failures stay on the list.
const add = grab('async function addInventoryPasteToInventory(');
assert.ok(add.includes('await findInventoryIdByBuyItemUid(l.uid)') && add.includes('createInventoryRecord(') && add.includes('left.push(l)'));
assert.ok(grab('async function runInventoryPaste(').includes('await lookupMtgList(text'), 'same Magic lookup as Buy');
console.log('Paste to inventory: passed');
