(function(){
'use strict';

var state={loaded:false,customers:[],query:'',expanded:{}};

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
  var q=state.query.trim().toLowerCase();
  var rows=(state.customers||[]).filter(function(c){return matchesQuery(c,q);});
  host.innerHTML='<section class="foc-hero"><div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap"><div><div style="font:900 22px/1.1 \'Orbitron\',monospace;color:var(--text)">CUSTOMER DATABASE</div><div style="font:10px/1.65 var(--font-mono);color:var(--dim);max-width:720px;margin-top:6px">Every known customer -- the in-store roster (walk-ins, buylist sellers, anyone with a phone/email on file) plus everyone who\'s placed a storefront order, a comic FOC preorder, or a PRH backlist (backorder) order -- even ones who\'ve never ordered online. Matched by email, then phone, since storefront guest checkout only requires a phone.</div></div>'+
    '<div class="foc-toolbar"><button class="hbtn" onclick="loadDatabaseCustomers()">REFRESH</button></div></div>'+
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

window.ensureDatabasePanel=function(){ if(!state.loaded){state.loaded=true;busy('Loading customer database…');loadCustomers().then(render);} else render(); };
window.loadDatabaseCustomers=function(){busy('Refreshing…');loadCustomers().then(render);};
window.onDatabaseSearchInput=function(value){state.query=value;render();var input=document.getElementById('database-search-input');if(input){input.focus();var pos=input.value.length;input.setSelectionRange(pos,pos);}};
window.toggleDatabaseCustomer=function(email){state.expanded[email]=!state.expanded[email];render();};
})();
