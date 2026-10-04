import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Store ask: put in costs (table fees, supplies) so they count against
// profit, plus inventory spend -- "if we make 3k for the month but spent 3k
// on new inventory, did we break even?" Net profit and cash flow answer
// different questions: inventory bought is cash turned into stock, so it
// comes off cash flow, not profit (each item's cost comes off profit when
// it sells).
const src = fs.readFileSync('scripts/expenses.js', 'utf8');
const dash = fs.readFileSync('dashboard.html', 'utf8');

function makeCtx({ missingTable = false, role = 'owner' } = {}) {
  const elements = {};
  const inserted = [], deleted = [];
  const expenses = [
    { id:'e1', spent_on:'2026-10-02', kind:'expense', category:'Show / table fees', amount:150, note:'Tacoma Mall table' },
    { id:'e2', spent_on:'2026-10-03', kind:'expense', category:'Supplies', amount:50 },
    { id:'e3', spent_on:'2026-10-03', kind:'inventory', category:'Comics (distributor)', amount:3000, note:'PRH invoice' },
  ];
  // $3,000 of sales: profit $1,200 after item cost ($1,500) and fees ($300).
  const sales = [
    { id:'s1', total:2000, pos_sale_lines:[{ quantity:1, adjusted_price:2000, cost_basis:1000, profit:800 }] },
    { id:'s2', total:1000, pos_sale_lines:[{ quantity:2, adjusted_price:1000, cost_basis:500, profit:400 }] },
  ];
  const query = table => {
    const ops = [];
    const q = new Proxy({}, { get(_, key) {
      if (key === 'then') {
        let res;
        if (table === 'store_expenses') {
          if (missingTable) res = { data:null, error:{ code:'PGRST205', message:"Could not find the table 'public.store_expenses' in the schema cache" } };
          else if (ops.some(o => o[0] === 'insert')) { inserted.push(ops.find(o => o[0] === 'insert')[1][0]); res = { error:null }; }
          else if (ops.some(o => o[0] === 'delete')) { deleted.push(ops.filter(o => o[0] === 'eq')[0][1][1]); res = { error:null }; }
          else res = { data:expenses, error:null };
        } else if (table === 'pos_sales') res = { data:sales, error:null };
        return (a, b) => Promise.resolve(res).then(a, b);
      }
      return (...args) => { ops.push([key, args]); return q; };
    } });
    return q;
  };
  const ctx = {
    console, Date, Math, Number, String, Object, Array, JSON, Promise, Proxy,
    getSupabaseClient: () => ({ from: query }), getActiveStoreId: () => 'store-1',
    requireManager: () => ['owner','admin','manager'].includes(role), requireOwnerAdmin: () => ['owner','admin'].includes(role),
    toast_dash: () => {}, confirm: () => true,
    document: { getElementById: id => elements[id] || (elements[id] = { id, innerHTML:'', value:'' }) },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { ctx, elements, inserted, deleted };
}
const flush = () => new Promise(r => setTimeout(r, 0));

// The money.
{
  const { ctx } = makeCtx();
  const m = ctx.expensesMonthMoney(
    [{ total:2000, pos_sale_lines:[{ adjusted_price:2000, cost_basis:1000, profit:800 }] }, { total:1000, pos_sale_lines:[{ adjusted_price:1000, cost_basis:500, profit:400 }] }],
    [{ kind:'expense', category:'Show / table fees', amount:150 }, { kind:'expense', category:'Supplies', amount:50 }, { kind:'inventory', category:'Comics', amount:3000 }]);
  assert.equal(m.gross, 3000);
  assert.equal(m.profit, 1200, 'profit on what sold, item cost and fees already out');
  assert.equal(m.expenses, 200);
  assert.equal(m.netProfit, 1000, 'expenses come off profit');
  assert.equal(m.inventory, 3000);
  assert.equal(m.afterFees, 2700, 'sales after fees = profit + item cost');
  assert.equal(m.cashFlow, -500, 'inventory bought comes off cash flow, not profit');
  assert.deepEqual(JSON.parse(JSON.stringify(m.byCategory)), [{ category:'Show / table fees', amount:150 }, { category:'Supplies', amount:50 }]);
}

// The panel: loads the month, shows both numbers, adds and deletes.
{
  const { ctx, elements, inserted, deleted } = makeCtx();
  ctx.renderExpensesPanel();
  await flush(); await flush();
  const html = elements['expenses-panel'].innerHTML;
  assert.match(html, /EXPENSES &amp; CASH FLOW/);
  assert.match(html, /NET PROFIT<\/span><b[^>]*>\$1000\.00/);
  assert.match(html, /CASH FLOW<\/span><b[^>]*>-\$500\.00/);
  assert.match(html, /Inventory bought<\/span><b[^>]*>-\$3000\.00/);
  assert.match(html, /breaks even on cash, not on profit/);
  assert.match(html, /Tacoma Mall table/);
  assert.match(html, /DELETE/, 'owners can delete');
  const field = (id, v) => { ctx.document.getElementById(id).value = v; };
  field('exp-amount', '75'); field('exp-kind', 'expense'); field('exp-cat', 'Show / table fees'); field('exp-date', '2026-10-04'); field('exp-note', 'Puyallup');
  await ctx.EXP.add();
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].amount, 75);
  assert.equal(inserted[0].kind, 'expense');
  assert.equal(inserted[0].store_id, 'store-1');
  field('exp-amount', '0');
  await ctx.EXP.add();
  assert.equal(inserted.length, 1, 'no amount, nothing added');
  await ctx.EXP.remove('e2');
  assert.deepEqual([...deleted], ['e2']);
}

// A manager sees it but can't delete; an employee doesn't see it at all.
{
  let w = makeCtx({ role:'manager' }); w.ctx.renderExpensesPanel(); await flush(); await flush();
  assert.doesNotMatch(w.elements['expenses-panel'].innerHTML, /DELETE/);
  w = makeCtx({ role:'employee' }); w.ctx.renderExpensesPanel(); await flush();
  assert.equal(w.elements['expenses-panel'].innerHTML, '');
}

// Before the table exists: a setup note, not an error.
{
  const { ctx, elements } = makeCtx({ missingTable:true });
  ctx.renderExpensesPanel(); await flush(); await flush();
  const html = elements['expenses-panel'].innerHTML;
  assert.match(html, /One-time setup needed/);
  assert.match(html, /2026-10-04-store-expenses\.sql/);
  assert.match(html, /NET PROFIT/, 'sales numbers still show');
}

// Wiring.
assert.match(dash, /<div id="expenses-panel"><\/div>/);
assert.match(dash, /<script src="scripts\/expenses\.js\?v=[^"]+" defer><\/script>/);
assert.match(dash, /if\(name === 'sales' && window\.renderExpensesPanel\) setTimeout\(\(\)=>window\.renderExpensesPanel\(\), 0\);/);
assert.ok(fs.existsSync('supabase-migrations/2026-10-04-store-expenses.sql'));
console.log('Expenses and cash flow checks passed');
