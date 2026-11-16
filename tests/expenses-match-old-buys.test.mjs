// OLD BUYS TO SHOWS (store, 2026-11-16): customer buys saved before they were tagged with a show go to the one show
// that sold on their day.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src = fs.readFileSync('scripts/expenses.js', 'utf8');
const grab = sig => { const i = src.indexOf(sig); assert.ok(i >= 0, sig); let d = 0, j = src.indexOf('){', i) + 1; for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && !--d) break; } return src.slice(i, j + 1); };
const match = new Function(['pacificDay', 'isCustomerBuy', 'untaggedBuyMatches'].map(n => grab('function ' + n + '(')).join('\n') + '\nreturn untaggedBuyMatches;')();
const sales = [
  { show_session_id: 'conA', completed_at: '2026-11-08T20:00:00Z' }, // Sat 11/8 Pacific
  { show_session_id: 'conA', completed_at: '2026-11-09T19:00:00Z' },
  { show_session_id: 'conB', completed_at: '2026-11-15T19:00:00Z' }, // two shows on 11/15
  { show_session_id: 'conC', completed_at: '2026-11-15T21:00:00Z' },
  { show_session_id: null, completed_at: '2026-11-10T19:00:00Z' },
];
const entries = [
  { id: 1, kind: 'inventory', note: 'Customer buy · 12 cards', spent_on: '2026-11-08', amount: 40 },
  { id: 2, kind: 'inventory', category: 'Customer buys', note: 'trade', spent_on: '2026-11-09', amount: 25 },
  { id: 3, kind: 'inventory', note: 'Customer buy', spent_on: '2026-11-15', amount: 10 }, // two shows that day -- left alone
  { id: 4, kind: 'inventory', note: 'Customer buy', spent_on: '2026-11-10', amount: 5 },  // no show that day
  { id: 5, kind: 'inventory', note: 'Customer buy', spent_on: '2026-11-08', amount: 9, show_session_id: 'conA' }, // already tagged
  { id: 6, kind: 'expense', note: 'Gas', spent_on: '2026-11-08', amount: 30 },             // not a buy
  { id: 7, kind: 'inventory', note: 'Lunar order', spent_on: '2026-11-08', amount: 300 },  // restock, not a customer buy
];
assert.deepEqual(match(sales, entries).map(m => [m.entry.id, m.showId]), [[1, 'conA'], [2, 'conA']]);
assert.ok(src.includes("res = await client.from('store_expenses').update({ show_session_id:m.showId }).eq('id', m.entry.id).eq('store_id', store).is('show_session_id', null).select('id');"), 'only ever fills an empty show tag, for this store');
assert.ok(src.includes("onclick=\"EXP.matchOldBuys()\""), 'button under SHOWS THIS MONTH');
console.log('Match old buys to shows: passed');
