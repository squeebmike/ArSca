import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Store asks: each day of a show separate (sales, profit, table cost);
// buys say what was bought; stock added with a cost counts as inventory spend.
const ex = fs.readFileSync('scripts/expenses.js', 'utf8');
const grab = re => { const m = ex.match(re); assert.ok(m, 'missing ' + re); return m[0]; };
const ctx = { Date, Number, Object, String, isFinite, Math };
vm.createContext(ctx);
vm.runInContext([
  grab(/function round2\([^)]*\)\{[^\n]*\n?(?:[^\n]*\n)*?\}/),
  grab(/function pacificDay\(iso\)\{[\s\S]*?\n\}/),
  grab(/function displayNote\(note\)\{[^\n]*\}/),
  grab(/function shortDay\(day\)\{[^\n]*\}/),
  grab(/function showLabel\(sh\)\{[^\n]*\}/),
  grab(/function showResults\(sales, entries, shows\)\{[\s\S]*?\n\}/),
].join('\n') + ';this.showResults=showResults;this.displayNote=displayNote;', ctx);

const sale = (iso, total, profit) => ({ show_session_id:'wk', completed_at:iso, total, pos_sale_lines:[{ profit }] });
const sales = [
  sale('2026-10-03T19:00:00Z', 386.50, 80),  // Sat Oct 3 (Pacific)
  sale('2026-10-04T22:00:00Z', 558.00, 127.45), // Sun Oct 4
  sale('2026-10-05T05:30:00Z', 10, 2),        // Sun Oct 4 at 10:30pm Pacific -- still Sunday
];
const [r] = JSON.parse(JSON.stringify(ctx.showResults(sales, [{ show_session_id:'wk', kind:'expense', amount:145 }], [{ id:'wk', name:'Show', kind:'in-person' }])));
assert.equal(r.name, 'Show · 10/3–10/4', 'named by its own sale dates');
assert.equal(r.dayList.length, 2);
assert.deepEqual(r.dayList.map(d => [d.day, d.sales, d.profit, d.costs, d.net]), [
  ['2026-10-03', 386.5, 80, 72.5, 7.5],
  ['2026-10-04', 568, 129.45, 72.5, 56.95],
], 'each day with its own sales and profit, the weekend table split evenly');
assert.equal(r.net, Math.round((209.45 - 145) * 100) / 100);
assert.match(ex, /Show costs are split evenly across the days\./);

// Notes read as what was bought, without the internal retry key.
assert.equal(ctx.displayNote('Customer buy · Cash · backfill · buy buy_session_musujhs2_v1y5-d6c996ff'), 'Customer buy · Cash');
assert.equal(ctx.displayNote('Customer buy: Sam · Jirachi, Primarina GX · Cash · buy buy_session_x-1a2b'), 'Customer buy: Sam · Jirachi, Primarina GX · Cash');
assert.equal(ctx.displayNote('Added to inventory · 3x Spider-Woman #1 · add c1-1a2b'), 'Added to inventory · 3x Spider-Woman #1');
assert.equal(ctx.displayNote('PRH invoice 1075016466 · packing slip'), 'PRH invoice 1075016466 · packing slip');

// Worker: names in the note, and 'add' rows filed as "Inventory added".
const w = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.match(w, /const what = names\.length \? names\.slice\(0, 4\)\.join\(', '\) \+ \(names\.length > 4 \? ` \+\$\{names\.length - 4\} more` : ''\) : '';/);
assert.match(w, /category: isAdd \? 'Inventory added' : 'Customer buys'/);
// Dashboard: buys send card names; Quick Add (new or merged) and Research ->
// Add to inventory record cost x qty.
const d = fs.readFileSync('dashboard.html', 'utf8');
assert.match(d, /items:\(session\.items \|\| \[\]\)\.map\(i => i\.name \|\| i\.title \|\| ''\)/);
assert.match(d, /const id = await createBuiltInInventoryItem\(item, item, 'manual_quick_add'\);\n    recordInventoryAddCost\(item, item\.qty, item\.cost, id\);/);
assert.match(d, /recordInventoryAddCost\(\{ name:dupe\.name \|\| item\.name \}, item\.qty, newCost, dupe\.id\);/);
assert.match(d, /recordInventoryAddCost\(item, item\.qty, item\.cost, item\.id \|\| item\.name\);\n  try \{\n    const productId = await createInventoryRecord\(item, item\);/);
console.log('Costs: show days, item names and added-stock spend checks passed');
