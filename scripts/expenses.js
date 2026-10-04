// EXPENSES & CASH FLOW (Sales tab)
//
// Store ask: "a part that lets me put in costs, so it counts against
// profits -- table cost, supplies -- plus spend on inventory. If we make 3k
// for the month but spent 3k on new inventory, did we break even?"
//
// Two numbers answer that, because they ask different things:
//   Net profit = profit on what sold (item cost and fees already out)
//                - expenses (table fees, supplies, gas...).
//                Is the business making money?
//   Cash flow  = what sales brought in after fees
//                - expenses - inventory bought.
//                Is cash piling up, or going back into stock?
// Buying inventory isn't a loss: cash becomes stock that still sells, and
// each item's cost comes off profit when it sells. So $3k sold and $3k
// spent on stock is roughly break-even on cash flow, not on profit.
(function(){
'use strict';

var EXPENSE_CATEGORIES = ['Show / table fees','Supplies','Shipping supplies','Software & subscriptions','Gas & travel','Rent & utilities','Advertising','Other'];
var INVENTORY_CATEGORIES = ['Comics (distributor)','Cards / singles','Sealed product','Collection / buy','Supplies for resale','Other'];
var state = { month:'', loading:false, entries:[], sales:null, missingTable:false, error:'' };

function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function usd(n){ n = Number(n) || 0; return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2); }
function round2(n){ return Math.round(n * 100) / 100; }
function pad(n){ return String(n).padStart(2, '0'); }
function thisMonth(){ var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
function monthRange(month){
  var p = String(month).split('-'), y = Number(p[0]), m = Number(p[1]);
  var from = new Date(y, m - 1, 1), to = new Date(y, m, 1);
  return { from:from, to:to, firstDay:y + '-' + pad(m) + '-01', nextFirstDay:to.getFullYear() + '-' + pad(to.getMonth() + 1) + '-01' };
}
function monthLabel(month){ var r = monthRange(month); return r.from.toLocaleDateString(undefined, { month:'long', year:'numeric' }); }
function sb(){ return typeof getSupabaseClient === 'function' ? getSupabaseClient() : null; }
function storeId(){ return typeof getActiveStoreId === 'function' ? getActiveStoreId() : ''; }
function canSee(){ return typeof requireManager !== 'function' || requireManager(); }
function canDelete(){ return typeof requireOwnerAdmin !== 'function' || requireOwnerAdmin(); }
function toast(msg){ if(typeof toast_dash === 'function') toast_dash(msg); }
function isMissingTable(error){ var t = String((error && (error.code + ' ' + error.message)) || ''); return /42P01|PGRST205|store_expenses/.test(t) && /exist|find|schema cache|42P01|PGRST205/i.test(t); }

// The month's money, from its completed sales (each line's profit already
// has the item's cost and the fees taken out) and its cost entries.
function monthMoney(sales, entries){
  var gross = 0, profit = 0, itemCost = 0;
  (sales || []).forEach(function(sale){
    gross += Number(sale.total || 0);
    (sale.pos_sale_lines || []).forEach(function(line){
      var revenue = Number(line.adjusted_price || 0); // same reading as computeSalesFromLedgerSince
      var cost = Number(line.cost_basis || 0);
      profit += Number(line.profit != null ? line.profit : revenue - cost);
      itemCost += cost;
    });
  });
  var expenses = 0, inventory = 0, byCategory = {};
  (entries || []).forEach(function(e){
    var amt = Number(e.amount || 0);
    if(e.kind === 'inventory') inventory += amt;
    else { expenses += amt; byCategory[e.category || 'Other'] = (byCategory[e.category || 'Other'] || 0) + amt; }
  });
  var afterFees = profit + itemCost; // what the sales actually brought in, after fees
  return {
    gross:round2(gross), profit:round2(profit), itemCost:round2(itemCost), afterFees:round2(afterFees),
    expenses:round2(expenses), inventory:round2(inventory),
    netProfit:round2(profit - expenses), cashFlow:round2(afterFees - expenses - inventory),
    byCategory:Object.keys(byCategory).map(function(k){ return { category:k, amount:round2(byCategory[k]) }; }).sort(function(a, b){ return b.amount - a.amount; }),
  };
}

async function loadSales(client, store, range){
  var out = [];
  for(var from = 0; from < 20000; from += 1000){
    var res = await client.from('pos_sales').select('id,total,pos_sale_lines(quantity,adjusted_price,cost_basis,profit)')
      .eq('store_id', store).in('status', ['completed','succeeded'])
      .gte('completed_at', range.from.toISOString()).lt('completed_at', range.to.toISOString())
      .order('completed_at', { ascending:true }).range(from, from + 999);
    if(res.error) throw res.error;
    out = out.concat(res.data || []);
    if((res.data || []).length < 1000) break;
  }
  return out;
}
async function load(){
  var client = sb(), store = storeId();
  if(!client || !store){ state.error = 'Sign in to see expenses'; return; }
  var range = monthRange(state.month);
  state.loading = true; state.error = ''; render();
  try {
    var ex = await client.from('store_expenses').select('id,spent_on,kind,category,amount,note,created_at')
      .eq('store_id', store).gte('spent_on', range.firstDay).lt('spent_on', range.nextFirstDay).order('spent_on', { ascending:false });
    if(ex.error){ if(isMissingTable(ex.error)){ state.missingTable = true; state.entries = []; } else throw ex.error; }
    else { state.missingTable = false; state.entries = ex.data || []; }
    state.sales = await loadSales(client, store, range);
  } catch(e) { state.error = e.message || String(e); }
  state.loading = false;
  render();
}

function monthOptions(){
  var out = [], d = new Date();
  for(var i = 0; i < 18; i++){ var m = d.getFullYear() + '-' + pad(d.getMonth() + 1); out.push(m); d.setMonth(d.getMonth() - 1); }
  return out;
}
function host(){ return document.getElementById('expenses-panel'); }

function render(){
  var el = host(); if(!el) return;
  if(!canSee()){ el.innerHTML = ''; return; }
  if(!state.month) state.month = thisMonth();
  var m = monthMoney(state.sales, state.entries);
  var line = function(label, value, opts){ opts = opts || {};
    return '<div style="display:flex;justify-content:space-between;gap:10px;padding:3px 0' + (opts.top ? ';border-top:1px solid var(--border);margin-top:4px;padding-top:7px' : '') + '"><span>' + label + '</span><b style="color:' + (opts.color || 'var(--text)') + '">' + value + '</b></div>'; };
  var cats = function(kind){ return (kind === 'inventory' ? INVENTORY_CATEGORIES : EXPENSE_CATEGORIES).map(function(c){ return '<option value="' + esc(c) + '">'; }).join(''); };
  var setup = state.missingTable ? '<div style="border:1px solid var(--gold);border-radius:8px;padding:10px;margin-bottom:10px;color:var(--text)"><b style="color:var(--gold)">One-time setup needed.</b> The expenses table isn\'t in the database yet. In Supabase: SQL Editor -> paste the contents of <code>supabase-migrations/2026-10-04-store-expenses.sql</code> from the repo -> Run. Then press REFRESH.</div>' : '';
  var rows = state.entries.map(function(e){
    return '<div style="display:grid;grid-template-columns:1fr auto;gap:8px;padding:7px 0;border-bottom:1px solid var(--border)">' +
      '<span style="min-width:0"><b style="color:var(--text)">' + esc(e.category) + '</b> <span style="font-size:9px;padding:1px 6px;border-radius:9px;border:1px solid ' + (e.kind === 'inventory' ? 'var(--blue,#5ab0ff)' : 'var(--gold)') + ';color:' + (e.kind === 'inventory' ? 'var(--blue,#5ab0ff)' : 'var(--gold)') + '">' + (e.kind === 'inventory' ? 'INVENTORY' : 'EXPENSE') + '</span><br>' +
        '<span style="color:var(--dim)">' + esc(e.spent_on) + (e.note ? ' · ' + esc(e.note) : '') + '</span></span>' +
      '<span style="text-align:right"><b style="color:var(--text)">' + usd(e.amount) + '</b>' + (canDelete() ? '<br><button class="hbtn" style="margin:2px 0 0;padding:2px 8px;font-size:9px" onclick="EXP.remove(\'' + esc(e.id) + '\')">DELETE</button>' : '') + '</span></div>';
  }).join('');
  el.innerHTML = '<div class="panel" style="margin-bottom:14px"><div class="ph">EXPENSES &amp; CASH FLOW <span style="font-size:9px;color:var(--dim)">what you spent, and what you really kept</span></div>' +
    '<div style="font-family:var(--font-mono);font-size:10px;color:var(--dim);display:grid;gap:10px">' + setup +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><select class="tsi" style="margin:0;max-width:220px" onchange="EXP.setMonth(this.value)">' +
        monthOptions().map(function(mo){ return '<option value="' + mo + '"' + (mo === state.month ? ' selected' : '') + '>' + esc(monthLabel(mo)) + '</option>'; }).join('') + '</select>' +
        '<button class="hbtn" style="margin:0" onclick="EXP.refresh()">REFRESH</button>' + (state.loading ? '<span>Loading…</span>' : '') + (state.error ? '<span style="color:var(--red)">' + esc(state.error) + '</span>' : '') + '</div>' +
      '<div style="border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text)">' +
        line('Sales', usd(m.gross)) +
        line('Profit on what sold <span style="color:var(--dim)">(item cost &amp; fees already out)</span>', usd(m.profit)) +
        line('Expenses', '-' + usd(m.expenses)) +
        line('NET PROFIT', usd(m.netProfit), { top:true, color:m.netProfit >= 0 ? 'var(--g)' : 'var(--red)' }) +
        '<div style="height:8px"></div>' +
        line('Sales after fees <span style="color:var(--dim)">(cash that came in)</span>', usd(m.afterFees)) +
        line('Expenses', '-' + usd(m.expenses)) +
        line('Inventory bought', '-' + usd(m.inventory)) +
        line('CASH FLOW', usd(m.cashFlow), { top:true, color:m.cashFlow >= 0 ? 'var(--g)' : 'var(--gold)' }) +
        '<div style="color:var(--dim);margin-top:6px;line-height:1.6">Net profit: is the business making money. Cash flow: is cash piling up or going back into stock. Buying inventory isn\'t a loss -- it turns cash into stock you still own, and each item\'s cost comes off profit when it sells. So a month that sells $3,000 and spends $3,000 on new stock breaks even on cash, not on profit.</div>' +
        (m.byCategory.length ? '<div style="color:var(--dim);margin-top:6px">Expenses by type: ' + m.byCategory.map(function(c){ return esc(c.category) + ' ' + usd(c.amount); }).join(' · ') + '</div>' : '') +
      '</div>' +
      '<div><b style="color:var(--text)">ADD A COST</b>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(140px,100%),1fr));gap:6px;margin-top:6px">' +
          '<label style="display:grid;gap:2px;min-width:0">Date<input id="exp-date" class="tsi" type="date" style="margin:0;width:100%;box-sizing:border-box;min-width:0" value="' + esc(new Date().toISOString().slice(0, 10)) + '"></label>' +
          '<label style="display:grid;gap:2px;min-width:0">Type<select id="exp-kind" class="tsi" style="margin:0;width:100%;box-sizing:border-box;min-width:0" onchange="document.getElementById(\'exp-cat\').setAttribute(\'list\', this.value===\'inventory\'?\'exp-cats-inventory\':\'exp-cats-expense\')"><option value="expense">Expense (table fees, supplies…)</option><option value="inventory">Inventory purchase</option></select></label>' +
          '<label style="display:grid;gap:2px;min-width:0">Category<input id="exp-cat" class="tsi" list="exp-cats-expense" style="margin:0;width:100%;box-sizing:border-box;min-width:0" placeholder="Show / table fees"></label>' +
          '<label style="display:grid;gap:2px;min-width:0">Amount $<input id="exp-amount" class="tsi" type="number" min="0.01" step="0.01" style="margin:0;width:100%;box-sizing:border-box;min-width:0" placeholder="75.00"></label>' +
        '</div>' +
        '<input id="exp-note" class="tsi" style="margin:6px 0 0;width:100%;box-sizing:border-box" placeholder="Note (optional) -- e.g. Tacoma Mall table, PRH invoice 1075016466">' +
        '<datalist id="exp-cats-expense">' + cats('expense') + '</datalist><datalist id="exp-cats-inventory">' + cats('inventory') + '</datalist>' +
        '<button class="hbtn" style="margin:6px 0 0;color:var(--g)"' + (state.missingTable ? ' disabled' : '') + ' onclick="EXP.add()">ADD COST</button></div>' +
      '<div><b style="color:var(--text)">' + esc(monthLabel(state.month)).toUpperCase() + ' (' + state.entries.length + ')</b>' + (rows || '<div style="padding:6px 0">Nothing entered for this month yet.</div>') + '</div>' +
    '</div></div>';
}

window.EXP = {
  setMonth:function(month){ state.month = month; load(); },
  refresh:function(){ load(); },
  add:async function(){
    var client = sb(), store = storeId();
    if(!client || !store){ toast('Sign in to add costs'); return; }
    var amount = Number(document.getElementById('exp-amount').value);
    if(!(amount > 0)){ toast('Enter an amount'); return; }
    var kind = document.getElementById('exp-kind').value === 'inventory' ? 'inventory' : 'expense';
    var row = { store_id:store, spent_on:document.getElementById('exp-date').value || new Date().toISOString().slice(0, 10), kind:kind,
      category:String(document.getElementById('exp-cat').value || '').trim().slice(0, 60) || 'Other', amount:round2(amount),
      note:String(document.getElementById('exp-note').value || '').trim().slice(0, 300) || null };
    var res = await client.from('store_expenses').insert(row);
    if(res.error){ if(isMissingTable(res.error)){ state.missingTable = true; render(); } toast('Could not add: ' + res.error.message); return; }
    toast((kind === 'inventory' ? 'Inventory purchase' : 'Expense') + ' added: ' + usd(row.amount));
    if(row.spent_on.slice(0, 7) !== state.month) state.month = row.spent_on.slice(0, 7);
    load();
  },
  remove:async function(id){
    if(!confirm('Delete this cost?')) return;
    var res = await sb().from('store_expenses').delete().eq('id', id).eq('store_id', storeId());
    if(res.error){ toast('Could not delete: ' + res.error.message); return; }
    load();
  },
};
window.renderExpensesPanel = function(){ if(!state.month) state.month = thisMonth(); render(); if(canSee()) load(); };
window.expensesMonthMoney = monthMoney;
})();
