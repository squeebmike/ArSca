import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Costs, part 2: a packing slip records its inventory purchase, costs can
// be tagged to a show (each show's profit after its table fee), monthly
// costs fill themselves in, and a month/year CSV for taxes.
const src = fs.readFileSync('scripts/expenses.js', 'utf8');
const pad = n => String(n).padStart(2, '0');
const now = new Date(), month = now.getFullYear() + '-' + pad(now.getMonth() + 1);

function makeCtx({ recurring = [], expenses = [] } = {}) {
  const elements = {}, kv = new Map([['expense_recurring', JSON.stringify(recurring)]]);
  const rows = expenses.map(e => ({ ...e }));
  const writes = [];
  const sales = [
    { id:'s1', total:300, completed_at:month + '-02T20:00:00Z', show_session_id:'show-tacoma', pos_sale_lines:[{ title:'Charizard', category:'Pokemon TCG', quantity:1, adjusted_price:300, cost_basis:150, profit:120 }] },
    { id:'s2', total:50, completed_at:month + '-03T20:00:00Z', show_session_id:null, pos_sale_lines:[{ title:'Saga #70', category:'Comic', quantity:2, adjusted_price:50, cost_basis:20, profit:25 }] },
  ];
  const query = table => {
    const ops = [];
    const q = new Proxy({}, { get(_, key) {
      if (key === 'then') {
        let res = { data:[], error:null };
        const op = n => ops.find(o => o[0] === n);
        if (table === 'store_expenses') {
          if (op('insert')) { const r = { id:'n' + rows.length, ...op('insert')[1][0] }; rows.push(r); writes.push(['insert', r]); }
          else if (op('update')) { const id = ops.filter(o => o[0] === 'eq')[0][1][1]; const r = rows.find(x => x.id === id); Object.assign(r, op('update')[1][0]); writes.push(['update', r]); }
          else if (op('ilike')) { const needle = op('ilike')[1][1].replace(/%/g, '').toLowerCase(); res = { data:rows.filter(r => r.kind === 'inventory' && String(r.note || '').toLowerCase().includes(needle)), error:null }; }
          else res = { data:rows.slice(), error:null };
        } else if (table === 'pos_sales') res = { data:sales, error:null };
        else if (table === 'whatnot_shows') res = { data:[{ id:'wn-1', title:'Shed Show', started_at:month + '-01T02:00:00Z', report_summary:{ gross:31.6, net:12 } }], error:null };
        return (a, b) => Promise.resolve(res).then(a, b);
      }
      return (...args) => { ops.push([key, args]); return q; };
    } });
    return q;
  };
  const ctx = {
    console, Date, Math, Number, String, Object, Array, JSON, Promise, Proxy, isFinite, Blob, URL, setTimeout,
    getSupabaseClient: () => ({ from: query }), getActiveStoreId: () => 'store-1',
    requireManager: () => true, requireOwnerAdmin: () => true, toast_dash: () => {}, confirm: () => true,
    getShowMode: () => ({ id:'show-tacoma', eventName:'Tacoma Mall Show', startedAt:month + '-02T17:00:00Z' }),
    scopedWorkerPath: p => p,
    storeWorkerFetch: async (path, opts = {}) => {
      const key = path.replace('/kv/', '');
      if ((opts.method || 'GET') === 'POST') { kv.set(key, opts.body); return new Response('{"ok":true}', { status:200 }); }
      return new Response(JSON.stringify({ value:kv.get(key) || null }), { status:200 });
    },
    document: { getElementById: id => elements[id] || (elements[id] = { id, innerHTML:'', value:'', checked:false }), createElement: () => ({ click(){}, remove(){} }), body:{ appendChild(){} } },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { ctx, elements, kv, rows, writes };
}
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)); };

// 1. A received packing slip records its inventory purchase -- once per
// invoice; a later part of the same invoice adds to it.
{
  const w = makeCtx();
  let r = await w.ctx.addStoreInventoryPurchase({ amount:250.5, key:'invoice 1075016466', note:'PRH invoice 1075016466 · packing slip' });
  assert.equal(r.ok, true);
  assert.equal(w.rows.length, 1);
  assert.equal(w.rows[0].kind, 'inventory');
  assert.equal(w.rows[0].category, 'Comics (distributor)');
  r = await w.ctx.addStoreInventoryPurchase({ amount:67.96, key:'invoice 1075016466', note:'PRH invoice 1075016466 · packing slip' });
  assert.equal(r.updated, true);
  assert.equal(w.rows.length, 1, 'same invoice, one entry');
  assert.equal(w.rows[0].amount, 318.46, 'the rest of the invoice is added to it');
}

// 2. Costs tagged to a show: each show's profit after its costs.
{
  const res = makeCtx().ctx.expensesShowResults(
    [{ total:300, show_session_id:'show-tacoma', pos_sale_lines:[{ profit:120 }] }],
    [{ kind:'expense', amount:75, show_session_id:'show-tacoma' }, { kind:'expense', amount:10, show_session_id:'wn-1' }, { kind:'inventory', amount:500, show_session_id:'show-tacoma' }],
    [{ id:'show-tacoma', kind:'in-person', name:'Tacoma Mall Show' }, { id:'wn-1', kind:'whatnot', name:'Shed Show', summary:{ gross:31.6, net:12 } }]);
  const tacoma = res.find(r => r.id === 'show-tacoma'), shed = res.find(r => r.id === 'wn-1');
  assert.equal(tacoma.profit, 120); assert.equal(tacoma.costs, 75, 'inventory bought for a show is not a show cost'); assert.equal(tacoma.net, 45);
  assert.equal(shed.profit, 12, 'a Whatnot show uses its saved profit'); assert.equal(shed.net, 2);
  assert.match(shed.name, /^Whatnot · Shed Show/);
}

// 3. Monthly costs fill themselves in, once.
{
  const w = makeCtx({ recurring:[{ id:'r1', kind:'expense', category:'Software & subscriptions', amount:29.99, note:'Shopify', day:1, startMonth:'2026-01', filled:[] }] });
  w.ctx.renderExpensesPanel(); await settle();
  const added = w.rows.filter(r => r.note === 'Shopify · monthly');
  assert.equal(added.length, 1, 'this month\'s entry was added');
  assert.equal(added[0].spent_on, month + '-01');
  assert.ok(JSON.parse(w.kv.get('expense_recurring'))[0].filled.includes(month), 'remembered as filled');
  w.ctx.renderExpensesPanel(); await settle();
  assert.equal(w.rows.filter(r => r.note === 'Shopify · monthly').length, 1, 'never added twice');
  const html = w.elements['expenses-panel'].innerHTML;
  assert.match(html, /MONTHLY COSTS/); assert.match(html, /\$29\.99 on day 1 each month/);
  assert.match(html, /SHOWS THIS MONTH/); assert.match(html, /Tacoma Mall Show/);
  assert.match(html, /For a show \(optional\)/); assert.match(html, /Whatnot · Shed Show/);
  assert.match(html, /Repeats every month/); assert.match(html, /EXPORT MONTH CSV/);
  // Another device already entered it: not duplicated, just marked filled.
  const w2 = makeCtx({ recurring:[{ id:'r2', kind:'expense', category:'Rent & utilities', amount:400, note:'', day:1, startMonth:'2026-01', filled:[] }], expenses:[{ id:'x', spent_on:month + '-01', kind:'expense', category:'Rent & utilities', amount:400, note:'monthly' }] });
  w2.ctx.renderExpensesPanel(); await settle();
  assert.equal(w2.rows.length, 1);
  // Adding a cost with "Repeats every month" saves the template.
  const field = (id, v) => { w2.ctx.document.getElementById(id).value = v; };
  field('exp-amount', '15'); field('exp-kind', 'expense'); field('exp-cat', 'Software & subscriptions'); field('exp-date', month + '-05'); field('exp-note', 'Canva'); field('exp-show', 'show-tacoma');
  w2.ctx.document.getElementById('exp-monthly').checked = true;
  await w2.ctx.EXP.add();
  const tpl = JSON.parse(w2.kv.get('expense_recurring')).find(t => t.note === 'Canva');
  assert.ok(tpl); assert.equal(tpl.day, 5); assert.deepEqual(tpl.filled, [month]);
  const canva = w2.rows.find(r => r.note === 'Canva · monthly');
  assert.ok(canva, 'first month entered, noted like the automatic ones');
  assert.equal(canva.show_session_id, 'show-tacoma');
}

// 4. CSV: every sale and cost, then the totals.
{
  const { ctx } = makeCtx();
  const rows = ctx.expensesExportRows(
    [{ total:300, completed_at:'2026-10-02T20:00:00Z', show_session_id:'show-tacoma', pos_sale_lines:[{ title:'Charizard', category:'Pokemon TCG', quantity:1, adjusted_price:300, cost_basis:150, profit:120 }] }],
    [{ spent_on:'2026-10-01', kind:'expense', category:'Show / table fees', amount:75, note:'Tacoma "Mall" table', show_session_id:'show-tacoma' }, { spent_on:'2026-10-03', kind:'inventory', category:'Comics (distributor)', amount:318.46, note:'PRH invoice' }],
    [{ id:'show-tacoma', kind:'in-person', name:'Tacoma Mall Show' }]);
  assert.deepEqual([...rows[0]], ['Date','Type','Category','Description','Amount','Item cost','Profit','Show']);
  assert.deepEqual([...rows[1]].slice(0, 5), ['2026-10-01', 'Expense', 'Show / table fees', 'Tacoma "Mall" table', '-75.00']);
  assert.deepEqual([...rows[2]].slice(0, 7), ['2026-10-02', 'Sale', 'Pokemon TCG', 'Charizard', '300.00', '150.00', '120.00']);
  assert.equal(rows[2][7], 'Tacoma Mall Show');
  assert.deepEqual([...rows[3]].slice(0, 5), ['2026-10-03', 'Inventory purchase', 'Comics (distributor)', 'PRH invoice', '-318.46']);
  const totals = Object.fromEntries(rows.filter(r => r[1] === 'TOTAL').map(r => [r[2], r[4]]));
  assert.equal(totals['Net profit'], '45.00'); assert.equal(totals['Cash flow'], '-123.46', 'sales after fees (120 profit + 150 item cost) - 75 - 318.46');
}

// The packing slip calls it; the Worker keeps monthly costs forever.
const slip = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
assert.match(slip, /window\.addStoreInventoryPurchase\(\{amount:spent,key:inv\?'invoice '\+inv:'',note:\(inv\?'PRH invoice '\+inv:'Distributor shipment'\)\+' · packing slip',category:'Comics \(distributor\)'\}\)/);
assert.match(slip, /var unit=Number\(x\.unitCost\)>0\?Number\(x\.unitCost\):Math\.round\(Number\(\(coverBySku\[x\.skuId\]\|\|\{\}\)\.coverPrice\|\|0\)\*50\)\/100;spent\+=unit\*x\.receivedQty;/);
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.match(worker, /const permanent = key\.startsWith\('foc_connecting'\) \|\| key\.startsWith\('expense_'\);/);
console.log('Expenses: slip purchases, show costs, monthly costs and CSV checks passed');
