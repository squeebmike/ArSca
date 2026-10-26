import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isServerSyncItem } from '../scripts/pokemon-daily-sync.mjs';

// 2026-10-26: a dashboard left open ran its daily sync at 3:12 AM, five
// minutes before the server's first batch, and re-priced the same Pokémon
// cards at 3 credits each (~600 credits). Its daily run now leaves every card
// the server owns to the server.
const ui = readFileSync(new URL('../scripts/dashboard-app.js', import.meta.url), 'utf8');
const slice = (from, to) => { const a = ui.indexOf(from); assert.ok(a >= 0, from); const b = ui.indexOf(to, a); assert.ok(b > a, to); return ui.slice(a, b); };
const serverHandles = new Function(slice('const SERVER_SYNC_CATEGORY_RE', '// Its big changes come here for review') + '; return serverHandlesPokemonPrice;')();

const rows = [
  { status:'in_stock', data:{ category:'Pokemon', tcgPlayerId:'123', name:'Pikachu' } },
  { status:'in_stock', data:{ category:'Pokémon TCG', tcgPlayerUrl:'https://www.tcgplayer.com/product/555/x', name:'Eevee' } },
  { status:'in_stock', data:{ category:'Pokemon', name:'Mew' } },
  { status:'in_stock', data:{ category:'Pokemon', tcgPlayerId:'9', name:'Charizard PSA 10' } },
  { status:'in_stock', data:{ category:'Pokemon', tcgPlayerId:'9', grader:'CGC', grade:'9.5', name:'Magikarp' } },
  { status:'in_stock', data:{ category:'Pokemon', tcgPlayerId:'9', language:'Korean', name:'Pikachu' } },
  { status:'in_stock', data:{ category:'Pokemon', tcgPlayerId:'9', language:'Japanese', name:'Pikachu' } },
  { status:'in_stock', data:{ category:'Pokemon', tcgPlayerId:'9', dropship:true, name:'Box' } },
  { status:'in_stock', data:{ category:'Pokemon Plush', tcgPlayerId:'9', name:'Plush' } },
  { status:'in_stock', data:{ category:'Magic', tcgPlayerId:'9', name:'Bolt' } },
  { status:'sold', data:{ category:'Pokemon', tcgPlayerId:'9', name:'Sold one' } },
];
for (const row of rows) {
  const item = { status:row.status, raw:row.data };
  assert.equal(serverHandles(item), isServerSyncItem(row), 'dashboard and server agree: ' + row.data.name);
}
assert.equal(rows.filter(isServerSyncItem).length, 3, 'sanity: the server owns plain priced cards only');
assert.ok(ui.includes('if(dailyPriceSyncRunning) items = items.filter(i => !serverHandlesPokemonPrice(i) && !serverPriceCheckedToday(i));'));

// Trade-in worth more than the cart: the cart shows the cash going back
// before checkout (store, 2026-10-25: $144 trade, $124 of cards, $20 back).
const pendingTradeAmounts = new Function('getPendingTradePurchase', slice('function pendingTradeAmounts(', '\nfunction redeemStoreCredit(') + '; return pendingTradeAmounts;')(() => ({ credit:{ id:'t1', remainingBalance:144 } }));
assert.deepEqual(pendingTradeAmounts(124), { pending:{ credit:{ id:'t1', remainingBalance:144 } }, applied:124, due:0, tradeValue:144, cashBack:20 });
const short = new Function('getPendingTradePurchase', slice('function pendingTradeAmounts(', '\nfunction redeemStoreCredit(') + '; return pendingTradeAmounts;')(() => ({ credit:{ remainingBalance:50 } }));
assert.equal(short(124).cashBack, 0, 'trade under the cart total: no cash back');
assert.equal(short(124).due, 74);
assert.ok(ui.includes('CASH BACK TO CUSTOMER $${trade.cashBack.toFixed(2)}'), 'cart totals show it');
assert.ok(ui.includes('Pay the customer $${trade.cashBack.toFixed(2)} cash back</b>'), 'confirm screen says it too');
console.log('daily sync leaves server cards; trade cash back shown');
