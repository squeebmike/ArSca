// TRADES & BUYS PER SHOW (store, 2026-11-15: "what you took in on trades/buys -- how many cards and their market value;
// what you gave for them, in trade credit and cash; the gain"). Each buy / trade-in is tagged with the show it happened
// at and listed under that show in Costs -> SHOWS THIS MONTH; the gain is kept apart from profit.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const ex = fs.readFileSync('scripts/expenses.js', 'utf8'), app = fs.readFileSync('scripts/dashboard-app.js', 'utf8'), worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const grab = (src, sig) => { const i = src.indexOf(sig); assert.ok(i >= 0, sig); let d = 0, j = src.indexOf('{', i); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && !--d) break; } return src.slice(i, j + 1); };
const { showResults, tradesLine } = new Function(['esc', 'usd', 'round2', 'showLabel', 'pacificDay', 'shortDay', 'showResults', 'tradesLine'].map(n => grab(ex, 'function ' + n + '(')).join('\n') + '\nreturn { showResults, tradesLine };')();
const sales = [{ show_session_id: 'S1', total: 100, completed_at: '2026-11-14T20:00:00Z', pos_sale_lines: [{ adjusted_price: 100, cost_basis: 60 }] }];
const entries = [
  { show_session_id: 'S1', kind: 'inventory', category: 'Customer buys', amount: 80, note: 'Customer buy: Sam · Charizard · Trade-in · buy x', details: { cards: 12, market: 150, paid: 'trade', method: 'Trade-in' } },
  { show_session_id: 'S1', kind: 'inventory', category: 'Customer buys', amount: 40, note: 'Customer buy: Lee · Pikachu · Cash · buy y', details: { cards: 5, market: 70, paid: 'cash', method: 'Cash' } },
  { show_session_id: 'S1', kind: 'expense', category: 'Table fee', amount: 25 },
  { show_session_id: 'S2', kind: 'inventory', category: 'Customer buys', amount: 30, note: 'Customer buy: Old · Cash · buy z' },
];
const shows = [{ id: 'S1', name: 'Card Show' }, { id: 'S2', name: 'Other Show' }];
const [s1] = showResults(sales, entries, shows), s2 = showResults(sales, entries, shows).find(r => r.id === 'S2');
assert.deepEqual([s1.trades.count, s1.trades.cards, s1.trades.market, s1.trades.paidTrade, s1.trades.paidCash, s1.trades.gain], [2, 17, 220, 80, 40, 100]);
assert.equal(s1.profit, 40, 'profit is still the sales profit -- the trade gain is not added');
assert.equal(s1.costs, 25, 'a buy is not a cost against the show'); assert.equal(s1.net, 15);
assert.ok(s2 && s2.trades.count === 1 && s2.trades.unknownMarket === 1, 'a show with only buys still lists them; an older buy without a market value says so');
const line = tradesLine(s1.trades);
assert.match(line, /2 deals · 17 cards in · worth \$220\.00 · gave \$80\.00 in trade \+ \$40\.00 cash · .*gain \$100\.00/); assert.match(line, /not profit yet/);
assert.equal(tradesLine({ count: 0 }), '');
// The dashboard sends the show and the details; the Worker keeps them (and still records the money without the column).
assert.ok(app.includes("function buyShowDetails(session = {}, method = ''){") && app.includes('...buyShowDetails(session, method), items:'));
const route = worker.slice(worker.indexOf("url.pathname === '/expenses/buy-purchase'"), worker.indexOf("url.pathname === '/expenses/buy-purchase'") + 6000);
for (const k of ['show_session_id: showId', "paid: body.paid === 'trade' ? 'trade' : 'cash'", 'JSON.stringify({ ...row, ...extra })', '.catch(() => supabaseAdminFetch(env, \'store_expenses\'']) assert.ok(route.includes(k), k);
assert.ok(fs.readFileSync('supabase-migrations/2026-11-15-store-expenses-buy-details.sql', 'utf8').includes('add column if not exists details jsonb'));
console.log('Trades & buys per show: passed');
