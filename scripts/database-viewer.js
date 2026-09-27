(function(){
'use strict';

var state={loaded:false,customers:[],query:'',expanded:{},mode:'customers',table:'loyalty_ledger',tableRows:[],tableTotal:null,tableOffset:0,tableFilter:'',tableError:''};
var TABLE_PAGE=50;
// Mirrors DATABASE_VIEWER_TABLES in cloudflare-worker-full.js (the Worker enforces the real allowlist).
var TABLES=[['loyalty_ledger','Loyalty points history'],['customers','Customers'],['pos_sales','Sales'],['pos_sale_lines','Sale line items'],['pos_payments','Payments'],['storefront_orders','Website shop orders'],['foc_preorder_orders','Comic preorder orders'],['backlist_orders','Backlist book orders'],['gift_cards','Gift cards'],['gift_card_transactions','Gift card transactions'],['customer_receipts','Text receipts'],['buylist_submissions','Buylist submissions'],['pull_list_subscriptions','Pull lists'],['event_registrations','Event registrations'],['inventory_items','Inventory items'],['comic_skus','FOC comic catalog']];

function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function money(cents){return '$'+(Number(cents||0)/100).toFixed(2);}
function displayDateTime(value){if(!value)return'—';var d=new Date(value);return isNaN(d)?value:d.toLocaleString();}

async function api(path,opts){
  var res=await storeWorkerFetch(path,opts||{});var type=res.headers.get('content-type')||'';
  if(type.indexOf('application/json')<0)return res;
  var data=await res.json().catch(function(){return{};});if(!res.ok||data.ok===false)throw new Error(data.error||('Database request failed '+res.status));return data;
}

function panel(){return document.getElementById('database-panels');}
function busy(message){var host=panel();if(host)host.innerHTML='<div class="panel" style="padding:36px;text-align:center;font-family:var(--font-mono);color:var(--dim)">'+esc(message||'Loading…')+'</div>';}

async function loadCustomers(){
  try{var data=await api('/store/customers?store_id='+encodeURIComponent(getActiveStoreId()));state.customers=data.customers||[];}
  catch(e){state.customers=[];state.loadError=e.message;}
}

function matchesQuery(c,q){
  if(!q)return true;
  var hay=[c.email,c.phone,c.name].concat((c.storefrontOrders||[]).map(function(o){return o.confirmationNumber;}),(c.focPreorders||[]).concat(c.backlistOrders||[]).map(function(o){return o.orderNumber;})).join(' ').toLowerCase();
  return hay.indexOf(q)>-1;
}

function render(){
  var host=panel();if(!host)return;
  if(state.mode==='tables')return renderTables(host);
  var q=state.query.trim().toLowerCase();
  var rows=(state.customers||[]).filter(function(c){return matchesQuery(c,q);});
  host.innerHTML='<section class="foc-hero"><div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap"><div><div style="font:900 22px/1.1 \'Orbitron\',monospace;color:var(--text)">CUSTOMER DATABASE</div><div style="font:10px/1.65 var(--font-mono);color:var(--dim);max-width:720px;margin-top:6px">Every known customer -- the in-store roster (walk-ins, buylist sellers, anyone with a phone/email on file) plus everyone who\'s placed a storefront order, a comic FOC preorder, or a PRH backlist (backorder) order -- even ones who\'ve never ordered online. Matched by email, then phone, since storefront guest checkout only requires a phone.</div></div>'+
    '<div class="foc-toolbar">'+modeButtons()+'<button class="hbtn" onclick="loadDatabaseCustomers()">REFRESH</button></div></div>'+
    '<input type="text" id="database-search-input" placeholder="Search name, email, or order number…" value="'+esc(state.query)+'" oninput="onDatabaseSearchInput(this.value)" style="width:100%;margin-top:10px;padding:10px;font-family:var(--font-mono);font-size:11px">'+
    '</section>'+
    (state.loadError?'<div class="panel" style="padding:14px;color:var(--red);font-family:var(--font-mono);font-size:10px">'+esc(state.loadError)+'</div>':'')+
    '<div class="ph">CUSTOMERS <span style="font-size:9px;color:var(--dim)">'+rows.length+' of '+(state.customers||[]).length+'</span></div>'+
    (rows.length?rows.map(customerCard).join(''):'<div class="panel" style="padding:24px;text-align:center;color:var(--dim)">No customers found.</div>');
}

function customerCard(c){
  var key=c.key;
  var open=!!state.expanded[key];
  var totalOrders=c.orderCount||0;
  var contact=[c.email,c.phone].filter(Boolean).join(' · ')||'(no contact info on file)';
  var badges=[];
  if(c.isRosterCustomer)badges.push('<span style="color:var(--gold)">IN-STORE CUSTOMER</span>');
  if(c.userId)badges.push('<span style="color:var(--g)">HAS WEBSITE LOGIN</span>');
  if(c.loyaltyPoints)badges.push('<span style="color:var(--purple)">\u2605 '+Number(c.loyaltyPoints).toLocaleString()+' PTS ('+money(c.loyaltyPoints)+')</span>');
  if(!totalOrders)badges.push('<span style="color:var(--dim)">NO ORDERS YET</span>');
  return '<div class="panel" style="margin-bottom:10px;padding:14px">'+
    '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;cursor:pointer" onclick="toggleDatabaseCustomer(\''+esc(key)+'\')">'+
      '<div><b>'+esc(c.name||'(no name on file)')+'</b><div style="font:10px/1.6 var(--font-mono);color:var(--dim)">'+esc(contact)+'</div><div style="font:9px var(--font-mono);margin-top:2px;display:flex;gap:8px">'+badges.join('')+'</div></div>'+
      '<div style="text-align:right;font:10px/1.6 var(--font-mono);color:var(--dim)">'+totalOrders+' order(s)<br>last activity: '+esc(displayDateTime(c.lastActivityAt))+'</div>'+
    '</div>'+
    (open?customerDetail(c):'')+
  '</div>';
}

function customerDetail(c){
  var sections=[];
  if(c.isRosterCustomer)sections.push('<div style="font:10px/1.6 var(--font-mono);color:var(--dim)">On the in-store customer roster since '+esc(displayDateTime(c.signedUpAt))+' · '+(c.loyaltyPoints||0)+' loyalty point(s) · '+money(Math.round((c.tradeCreditBalance||0)*100))+' trade credit'+(c.userId?' · has a themanapocket.com login':'')+'</div>');
  if((c.storefrontOrders||[]).length)sections.push(orderSection('STOREFRONT ORDERS',c.storefrontOrders,function(o){
    return esc(o.confirmationNumber||o.id)+' · '+esc(o.fulfillmentMethod||'')+' · '+esc(o.status||'')+' · '+esc(displayDateTime(o.createdAt));
  }));
  if((c.focPreorders||[]).length)sections.push(orderSection('FOC COMIC PREORDERS',c.focPreorders,function(o){
    return esc(o.orderNumber||o.id)+' · '+esc(o.status||'')+' · '+money(o.totalCents)+' · '+esc(displayDateTime(o.createdAt));
  }));
  if((c.backlistOrders||[]).length)sections.push(orderSection('PRH BACKLIST (BACKORDER) ORDERS',c.backlistOrders,function(o){
    return esc(o.orderNumber||o.id)+' · '+esc(o.status||'')+' · '+money(o.totalCents)+' · '+esc(displayDateTime(o.createdAt));
  }));
  return '<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);display:grid;gap:10px">'+(sections.join('')||'<div style="color:var(--dim);font:10px var(--font-mono)">No order detail.</div>')+'</div>';
}

function orderSection(title,orders,lineFn){
  return '<div><div style="font:10px var(--font-mono);color:var(--gold);margin-bottom:4px">'+esc(title)+' ('+orders.length+')</div>'+
    orders.map(function(o){return '<div style="font:10px/1.6 var(--font-mono);color:var(--dim)">'+lineFn(o)+'</div>';}).join('')+
  '</div>';
}

function modeButtons(){
  return ['customers','tables'].map(function(m){return '<button class="hbtn'+(state.mode===m?' active':'')+'" style="'+(state.mode===m?'border-color:var(--g);color:var(--g)':'')+'" onclick="setDatabaseMode(\''+m+'\')">'+(m==='customers'?'CUSTOMERS':'TABLES')+'</button>';}).join('');
}

function cellText(value){
  if(value==null||value==='')return '';
  if(typeof value==='object')return JSON.stringify(value);
  return String(value);
}

async function loadTable(){
  state.tableError='';
  try{
    var data=await api('/store/db/table?store_id='+encodeURIComponent(getActiveStoreId())+'&table='+encodeURIComponent(state.table)+'&limit='+TABLE_PAGE+'&offset='+state.tableOffset);
    state.tableRows=data.rows||[];state.tableTotal=data.total;
  }catch(e){state.tableRows=[];state.tableTotal=null;state.tableError=e.message;}
}

function renderTables(host){
  var f=state.tableFilter.trim().toLowerCase();
  var rows=state.tableRows.filter(function(r){return !f||JSON.stringify(r).toLowerCase().indexOf(f)>-1;});
  var cols=[];rows.forEach(function(r){Object.keys(r).forEach(function(k){if(cols.indexOf(k)<0&&k!=='store_id')cols.push(k);});});
  var from=state.tableRows.length?state.tableOffset+1:0,to=state.tableOffset+state.tableRows.length;
  host.innerHTML='<section class="foc-hero"><div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap"><div><div style="font:900 22px/1.1 \'Orbitron\',monospace;color:var(--text)">DATABASE TABLES</div><div style="font:10px/1.65 var(--font-mono);color:var(--dim);max-width:720px;margin-top:6px">Read-only view of this store\'s records, newest first. Loyalty points history shows every award with the customer and running balance.</div></div>'+
    '<div class="foc-toolbar">'+modeButtons()+'<button class="hbtn" onclick="reloadDatabaseTable()">REFRESH</button></div></div>'+
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><select id="database-table-select" onchange="setDatabaseTable(this.value)" style="padding:9px;font-family:var(--font-mono);font-size:11px">'+TABLES.map(function(t){return '<option value="'+t[0]+'"'+(t[0]===state.table?' selected':'')+'>'+esc(t[1])+'</option>';}).join('')+'</select>'+
    '<input type="text" id="database-table-filter" placeholder="Filter this page…" value="'+esc(state.tableFilter)+'" oninput="onDatabaseTableFilter(this.value)" style="flex:1;min-width:180px;padding:9px;font-family:var(--font-mono);font-size:11px"></div>'+
    '</section>'+
    (state.tableError?'<div class="panel" style="padding:14px;color:var(--red);font-family:var(--font-mono);font-size:10px">'+esc(state.tableError)+'</div>':'')+
    '<div class="ph">ROWS <span style="font-size:9px;color:var(--dim)">'+from+'–'+to+(state.tableTotal!=null?' of '+state.tableTotal:'')+'</span>'+
      '<span style="margin-left:auto;display:flex;gap:6px"><button class="hbtn" '+(state.tableOffset?'':'disabled ')+'onclick="pageDatabaseTable(-1)">← NEWER</button><button class="hbtn" '+(state.tableTotal!=null&&to>=state.tableTotal||state.tableRows.length<TABLE_PAGE?'disabled ':'')+'onclick="pageDatabaseTable(1)">OLDER →</button></span></div>'+
    (rows.length?'<div class="panel" style="padding:0;overflow:auto;max-height:70vh"><table style="border-collapse:collapse;font:10px/1.5 var(--font-mono);min-width:100%"><thead><tr>'+cols.map(function(c){return '<th style="position:sticky;top:0;background:var(--surf);text-align:left;padding:7px 9px;color:var(--gold);white-space:nowrap;border-bottom:1px solid var(--border)">'+esc(c)+'</th>';}).join('')+'</tr></thead><tbody>'+
      rows.map(function(r){return '<tr>'+cols.map(function(c){var v=cellText(r[c]);return '<td title="'+esc(v.slice(0,2000))+'" style="padding:6px 9px;border-bottom:1px solid var(--border);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)">'+esc(v.slice(0,300))+'</td>';}).join('')+'</tr>';}).join('')+
      '</tbody></table></div>':'<div class="panel" style="padding:24px;text-align:center;color:var(--dim)">No rows.</div>');
}

window.ensureDatabasePanel=function(){ if(!state.loaded){state.loaded=true;busy('Loading customer database…');loadCustomers().then(render);} else render(); };
window.loadDatabaseCustomers=function(){busy('Refreshing…');loadCustomers().then(render);};
window.onDatabaseSearchInput=function(value){state.query=value;render();var input=document.getElementById('database-search-input');if(input){input.focus();var pos=input.value.length;input.setSelectionRange(pos,pos);}};
window.toggleDatabaseCustomer=function(email){state.expanded[email]=!state.expanded[email];render();};
window.setDatabaseMode=function(mode){state.mode=mode==='tables'?'tables':'customers';if(state.mode==='tables'&&!state.tableRows.length&&!state.tableError){busy('Loading table…');loadTable().then(render);}else render();};
window.setDatabaseTable=function(table){state.table=table;state.tableOffset=0;state.tableFilter='';busy('Loading table…');loadTable().then(render);};
window.reloadDatabaseTable=function(){busy('Refreshing…');loadTable().then(render);};
window.pageDatabaseTable=function(dir){state.tableOffset=Math.max(0,state.tableOffset+dir*TABLE_PAGE);busy('Loading table…');loadTable().then(render);};
window.onDatabaseTableFilter=function(value){state.tableFilter=value;render();var input=document.getElementById('database-table-filter');if(input){input.focus();var pos=input.value.length;input.setSelectionRange(pos,pos);}};
})();
