(function(){
'use strict';

// Read-only database explorer. Three views:
//   Customers -- everyone known, tap one for their whole history
//   Inventory -- search any item, tap it for every field + its sales
//   Tables    -- raw rows of any allowlisted table
var state={
  loaded:false,mode:'customers',customers:[],query:'',loadError:'',
  profile:null,profileError:'',
  items:[],itemQuery:'',itemsLoaded:false,itemsError:'',item:null,itemError:'',
  table:'loyalty_ledger',tableRows:[],tableTotal:null,tableOffset:0,tableFilter:'',tableError:''
};
var TABLE_PAGE=50;
// Grouped table list comes from the Worker (/store/db/tables), which owns the allowlist.
var tableGroups=[];

function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function money(cents){return '$'+(Number(cents||0)/100).toFixed(2);}
function dollars(value){return value==null||value===''?'—':'$'+Number(value||0).toFixed(2);}
function displayDateTime(value){if(!value)return'—';var d=new Date(value);return isNaN(d)?value:d.toLocaleString();}
function displayDate(value){if(!value)return'—';var d=new Date(value);return isNaN(d)?value:d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});}
function storeParam(){return 'store_id='+encodeURIComponent(getActiveStoreId());}

async function api(path,opts){
  var res=await storeWorkerFetch(path,opts||{});var type=res.headers.get('content-type')||'';
  if(type.indexOf('application/json')<0)return res;
  var data=await res.json().catch(function(){return{};});if(!res.ok||data.ok===false)throw new Error(data.error||('Database request failed '+res.status));return data;
}

function panel(){return document.getElementById('database-panels');}
function busy(message){var host=panel();if(host)host.innerHTML='<div class="panel" style="padding:36px;text-align:center;font-family:var(--font-mono);color:var(--dim)">'+esc(message||'Loading…')+'</div>';}
function focusEnd(id){var input=document.getElementById(id);if(input){input.focus();var pos=input.value.length;input.setSelectionRange(pos,pos);}}

// ---------- shared pieces ----------
function modeButtons(){
  return [['customers','CUSTOMERS'],['inventory','INVENTORY'],['tables','TABLES']].map(function(m){var on=state.mode===m[0];return '<button class="hbtn" style="'+(on?'border-color:var(--g);color:var(--g)':'')+'" onclick="setDatabaseMode(\''+m[0]+'\')">'+m[1]+'</button>';}).join('');
}
function hero(title,blurb,extra){
  return '<section class="foc-hero"><div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap"><div><div style="font:900 22px/1.1 \'Orbitron\',monospace;color:var(--text)">'+esc(title)+'</div><div style="font:10px/1.65 var(--font-mono);color:var(--dim);max-width:720px;margin-top:6px">'+blurb+'</div></div><div class="foc-toolbar">'+modeButtons()+'</div></div>'+(extra||'')+'</section>';
}
function errorBox(msg){return msg?'<div class="panel" style="padding:14px;color:var(--red);font-family:var(--font-mono);font-size:10px">'+esc(msg)+'</div>':'';}
function tile(label,value,color){return '<div class="panel" style="padding:12px 14px;margin:0"><div style="font:9px var(--font-mono);color:var(--dim);letter-spacing:.08em">'+esc(label)+'</div><div style="font:800 18px/1.3 var(--font-mono);color:'+(color||'var(--text)')+'">'+value+'</div></div>';}
function tiles(list){return '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin:10px 0">'+list.join('')+'</div>';}
function section(title,count,body){return '<div class="panel" style="padding:14px"><div style="font:10px var(--font-mono);color:var(--gold);margin-bottom:8px;letter-spacing:.06em">'+esc(title)+(count!=null?' ('+count+')':'')+'</div>'+body+'</div>';}
function empty(msg){return '<div style="font:10px var(--font-mono);color:var(--dim)">'+esc(msg||'Nothing on file.')+'</div>';}
function miniTable(cols,rows){
  if(!rows.length)return empty();
  return '<div style="overflow:auto"><table style="border-collapse:collapse;font:10px/1.5 var(--font-mono);min-width:100%"><thead><tr>'+cols.map(function(c){return '<th style="text-align:'+(c.align||'left')+';padding:5px 8px;color:var(--dim);white-space:nowrap;border-bottom:1px solid var(--border)">'+esc(c.label)+'</th>';}).join('')+'</tr></thead><tbody>'+
    rows.map(function(r){return '<tr>'+cols.map(function(c){var v=c.render(r);return '<td style="padding:5px 8px;border-bottom:1px solid var(--border);vertical-align:top;text-align:'+(c.align||'left')+';color:var(--text);'+(c.wrap?'':'white-space:nowrap')+'">'+v+'</td>';}).join('')+'</tr>';}).join('')+
  '</tbody></table></div>';
}
function cellText(value){
  if(value==null||value==='')return '';
  if(typeof value==='object')return JSON.stringify(value);
  return String(value);
}
function fieldList(obj){
  var keys=Object.keys(obj||{}).filter(function(k){var v=obj[k];return v!=null&&v!==''&&!(Array.isArray(v)&&!v.length)&&!(typeof v==='string'&&/^data:image\//.test(v));}).sort();
  if(!keys.length)return empty();
  return '<div style="display:grid;grid-template-columns:minmax(120px,220px) 1fr;gap:2px 12px;font:10px/1.6 var(--font-mono)">'+keys.map(function(k){var v=cellText(obj[k]);return '<div style="color:var(--dim)">'+esc(k)+'</div><div style="color:var(--text);word-break:break-word">'+esc(v.length>600?v.slice(0,600)+'…':v)+'</div>';}).join('')+'</div>';
}
function statusChip(s){var ok=/completed|succeeded|paid|fulfilled|shipped|in_stock|active/i.test(s||'');var bad=/cancel|fail|void|refund/i.test(s||'');return '<span style="color:'+(ok?'var(--g)':bad?'var(--red)':'var(--gold)')+'">'+esc(s||'—')+'</span>';}

// ---------- Customers ----------
async function loadCustomers(){
  state.loadError='';
  try{var data=await api('/store/customers?'+storeParam());state.customers=data.customers||[];}
  catch(e){state.customers=[];state.loadError=e.message;}
}
function matchesQuery(c,q){
  if(!q)return true;
  var hay=[c.email,c.phone,c.name].concat((c.storefrontOrders||[]).map(function(o){return o.confirmationNumber;}),(c.focPreorders||[]).concat(c.backlistOrders||[]).map(function(o){return o.orderNumber;})).join(' ').toLowerCase();
  return hay.indexOf(q)>-1;
}
function renderCustomers(host){
  var q=state.query.trim().toLowerCase();
  var rows=(state.customers||[]).filter(function(c){return matchesQuery(c,q);});
  host.innerHTML=hero('CUSTOMER DATABASE','Every known customer -- in-store roster plus anyone who has placed a shop order, comic preorder, or backlist order. Tap a customer for everything on file: points, purchases in store and online, orders, gift cards, receipts, and more.',
      '<div style="display:flex;gap:8px;margin-top:10px"><input type="text" id="database-search-input" placeholder="Search name, email, phone, or order number…" value="'+esc(state.query)+'" oninput="onDatabaseSearchInput(this.value)" style="flex:1;padding:10px;font-family:var(--font-mono);font-size:11px"><button class="hbtn" onclick="loadDatabaseCustomers()">REFRESH</button></div>')+
    errorBox(state.loadError)+
    '<div class="ph">CUSTOMERS <span style="font-size:9px;color:var(--dim)">'+rows.length+' of '+(state.customers||[]).length+'</span></div>'+
    (rows.length?rows.map(customerCard).join(''):'<div class="panel" style="padding:24px;text-align:center;color:var(--dim)">No customers found.</div>');
}
function customerCard(c){
  var totalOrders=c.orderCount||0;
  var contact=[c.email,c.phone].filter(Boolean).join(' · ')||'(no contact info on file)';
  var badges=[];
  if(c.isRosterCustomer)badges.push('<span style="color:var(--gold)">IN-STORE CUSTOMER</span>');
  if(c.userId)badges.push('<span style="color:var(--g)">HAS WEBSITE LOGIN</span>');
  if(c.loyaltyPoints)badges.push('<span style="color:var(--purple)">★ '+Number(c.loyaltyPoints).toLocaleString()+' PTS ('+money(c.loyaltyPoints)+')</span>');
  if(!totalOrders)badges.push('<span style="color:var(--dim)">NO ONLINE ORDERS</span>');
  var idx=state.customers.indexOf(c);
  return '<div class="panel" style="margin-bottom:10px;padding:14px;cursor:pointer" onclick="openDatabaseCustomer('+idx+')">'+
    '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">'+
      '<div><b>'+esc(c.name||'(no name on file)')+'</b><div style="font:10px/1.6 var(--font-mono);color:var(--dim)">'+esc(contact)+'</div><div style="font:9px var(--font-mono);margin-top:2px;display:flex;gap:8px;flex-wrap:wrap">'+badges.join('')+'</div></div>'+
      '<div style="text-align:right;font:10px/1.6 var(--font-mono);color:var(--dim)">'+totalOrders+' online order(s)<br>last activity: '+esc(displayDateTime(c.lastActivityAt))+'<br><span style="color:var(--g)">VIEW EVERYTHING →</span></div>'+
    '</div></div>';
}

async function openCustomer(c){
  state.profile=null;state.profileError='';state.mode='customer';
  busy('Loading everything on file for '+(c.name||c.email||c.phone||'this customer')+'…');
  var qs=[storeParam()];
  if(c.customerId)qs.push('customer_id='+encodeURIComponent(c.customerId));
  if(c.userId)qs.push('user_id='+encodeURIComponent(c.userId));
  if(c.email)qs.push('email='+encodeURIComponent(c.email));
  if(c.phone)qs.push('phone='+encodeURIComponent(c.phone));
  if(c.name)qs.push('name='+encodeURIComponent(c.name));
  try{state.profile=(await api('/store/db/customer?'+qs.join('&'))).profile;}
  catch(e){state.profileError=e.message;}
  render();
}
function renderCustomerProfile(host){
  var p=state.profile;
  var back='<button class="hbtn" onclick="setDatabaseMode(\'customers\')">← ALL CUSTOMERS</button>';
  if(!p){host.innerHTML='<div style="margin-bottom:10px">'+back+'</div>'+errorBox(state.profileError||'Could not load this customer.');return;}
  var id=p.identity||{},s=p.summary||{},cust=p.customer||{};
  var header='<section class="foc-hero"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start"><div><div style="font:900 22px/1.1 \'Orbitron\',monospace;color:var(--text)">'+esc(id.name||cust.name||'(no name on file)')+'</div>'+
    '<div style="font:10px/1.7 var(--font-mono);color:var(--dim);margin-top:6px">'+esc([id.email,id.phone].filter(Boolean).join(' · ')||'(no contact info)')+(id.userId?' · <span style="color:var(--g)">website login</span>':'')+(id.customerId?' · customer id '+esc(id.customerId):' · <span style="color:var(--gold)">not on the in-store roster</span>')+'</div></div>'+
    '<div class="foc-toolbar">'+back+'</div></div>'+
    tiles([
      tile('LOYALTY POINTS',Number(s.loyaltyPoints||0).toLocaleString()+' <span style="font-size:11px;color:var(--dim)">('+money(s.loyaltyPoints)+')</span>','var(--purple)'),
      tile('TRADE CREDIT',dollars(s.tradeCredit),'var(--g)'),
      tile('LIFETIME SPEND',dollars(s.lifetimeSpend),'var(--gold)'),
      tile('PURCHASES',String(s.purchases||0)),
      tile('FIRST SEEN',esc(displayDate(s.firstSeen))),
      tile('LAST SEEN',esc(displayDate(s.lastSeen))),
    ])+'</section>';
  var sales=(p.sales||[]).map(function(sale){
    var channel=(sale.payments||[]).map(function(x){return x.method;}).filter(Boolean).join(' + ')||'—';
    return '<div style="border-bottom:1px solid var(--border);padding:8px 0"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font:10px/1.6 var(--font-mono)"><span><b style="color:var(--text)">'+esc(displayDateTime(sale.completed_at||sale.created_at))+'</b> · '+esc(channel)+' · '+statusChip(sale.status)+'</span><span style="color:var(--gold)">'+dollars(sale.total)+'</span></div>'+
      miniTable([
        {label:'Item',wrap:true,render:function(l){return esc(l.title||'Item');}},
        {label:'Category',render:function(l){return esc(l.category||'—');}},
        {label:'Qty',align:'right',render:function(l){return esc(l.quantity||1);}},
        {label:'Price',align:'right',render:function(l){return dollars(l.adjusted_price);}},
        {label:'Profit',align:'right',render:function(l){var v=Number(l.profit||0);return '<span style="color:'+(v>=0?'var(--g)':'var(--red)')+'">'+dollars(v)+'</span>';}},
      ],sale.lines||[])+'</div>';
  }).join('');
  var loyalty=miniTable([
    {label:'Date',render:function(r){return esc(displayDateTime(r.created_at));}},
    {label:'Points',align:'right',render:function(r){var v=Number(r.points||0);return '<span style="color:'+(v>=0?'var(--g)':'var(--red)')+'">'+(v>=0?'+':'')+v+'</span>';}},
    {label:'Reason',render:function(r){return esc(r.reason||'');}},
    {label:'Balance after',align:'right',render:function(r){return esc(r.balance_after);}},
    {label:'Sale',render:function(r){return esc(r.sale_id||'');}},
  ],p.loyalty||[]);
  var orderTable=function(orders,numberKey,itemName){return miniTable([
    {label:'Date',render:function(o){return esc(displayDateTime(o.created_at));}},
    {label:'Order',render:function(o){return esc(o[numberKey]||o.id);}},
    {label:'Status',render:function(o){return statusChip(o.status||o.fulfillment_status);}},
    {label:'Total',align:'right',render:function(o){return o.total_cents!=null?money(o.total_cents):'—';}},
    {label:'Items',wrap:true,render:function(o){return esc((o.items||[]).map(itemName).join(' · ')||'—');}},
  ],orders);};
  var snapTitle=function(i){var s=i.sku_snapshot||{};return (i.quantity>1?i.quantity+'× ':'')+(s.title||s.name||s.variantLabel||i.sku_id||'item');};
  host.innerHTML=header+
    section('PURCHASES — IN STORE, WEBSITE & EBAY',(p.sales||[]).length,sales||empty('No purchases linked to this customer.'))+
    section('LOYALTY POINTS HISTORY',(p.loyalty||[]).length,loyalty)+
    ((p.tradeCredit||[]).length?section('TRADE CREDIT HISTORY',p.tradeCredit.length,miniTable([
      {label:'Date',render:function(r){return esc(displayDateTime(r.created_at));}},
      {label:'Amount',align:'right',render:function(r){return dollars(r.amount);}},
      {label:'Reason',render:function(r){return esc(r.reason||'');}},
      {label:'Balance after',align:'right',render:function(r){return dollars(r.balance_after);}},
    ],p.tradeCredit)):'')+
    section('WEBSITE SHOP ORDERS',(p.shopOrders||[]).length,miniTable([
      {label:'Date',render:function(o){return esc(displayDateTime(o.created_at));}},
      {label:'Confirmation',render:function(o){return esc(o.confirmation_number||o.id);}},
      {label:'Fulfillment',render:function(o){return esc(o.fulfillment_method||'')+' · '+statusChip(o.fulfillment_status);}},
      {label:'Sale',render:function(o){return esc(o.sale_id||'');}},
    ],p.shopOrders||[]))+
    section('COMIC PREORDERS',(p.focOrders||[]).length,orderTable(p.focOrders||[],'order_number',snapTitle))+
    section('BACKLIST BOOK ORDERS',(p.backlistOrders||[]).length,orderTable(p.backlistOrders||[],'order_number',snapTitle))+
    ((p.giftCards||[]).length?section('GIFT CARDS',p.giftCards.length,miniTable([
      {label:'Code',render:function(g){return esc(g.code);}},{label:'Status',render:function(g){return statusChip(g.status);}},
      {label:'Balance',align:'right',render:function(g){return dollars(g.balance);}},{label:'Issued',render:function(g){return esc(displayDate(g.created_at));}},
    ],p.giftCards)):'')+
    ((p.pullList||[]).length?section('PULL LIST',p.pullList.length,miniTable([
      {label:'Series',render:function(r){return esc(r.series_id);}},{label:'Active',render:function(r){return r.active?'yes':'no';}},{label:'Notes',wrap:true,render:function(r){return esc(r.notes||'');}},
    ],p.pullList)):'')+
    ((p.events||[]).length?section('EVENT REGISTRATIONS',p.events.length,miniTable([
      {label:'Date',render:function(r){return esc(displayDate(r.created_at));}},{label:'Event',render:function(r){return esc(r.event_id);}},{label:'Player',render:function(r){return esc(r.player_name||'');}},
      {label:'Paid',align:'right',render:function(r){return r.paid?dollars(r.paid_amount):'no';}},
    ],p.events)):'')+
    ((p.receipts||[]).length?section('TEXT RECEIPTS',p.receipts.length,miniTable([
      {label:'Date',render:function(r){return esc(displayDateTime(r.created_at));}},{label:'Sale',render:function(r){return esc(r.sale_id||'');}},{label:'Status',render:function(r){return statusChip(r.sms_status);}},
    ],p.receipts)):'')+
    ((p.buylist||[]).length?section('BUYLIST SUBMISSIONS',p.buylist.length,miniTable([
      {label:'Date',render:function(r){return esc(displayDateTime(r.created_at));}},{label:'Status',render:function(r){return statusChip(r.status);}},
      {label:'Items',wrap:true,render:function(r){return esc(cellText(r.items).slice(0,200));}},
    ],p.buylist)):'')+
    (p.customer?section('CUSTOMER RECORD (ALL FIELDS)',null,fieldList(p.customer)):'');
}

// ---------- Inventory ----------
async function searchItems(){
  state.itemsError='';
  try{state.items=(await api('/store/db/items?'+storeParam()+'&q='+encodeURIComponent(state.itemQuery.trim()))).items||[];}
  catch(e){state.items=[];state.itemsError=e.message;}
  state.itemsLoaded=true;
}
function renderInventory(host){
  host.innerHTML=hero('INVENTORY LOOKUP','Search any item ever entered -- in stock, sold, presale, archived. Tap one for every stored field, its full sale history (who, when, how much, profit), and its FOC catalog record and preorders when it came from FOC.',
      '<div style="display:flex;gap:8px;margin-top:10px"><input type="text" id="database-item-search" placeholder="Name, set, UPC/barcode, eBay SKU, or item id…" value="'+esc(state.itemQuery)+'" onkeydown="if(event.key===\'Enter\')runDatabaseItemSearch()" oninput="onDatabaseItemQuery(this.value)" style="flex:1;padding:10px;font-family:var(--font-mono);font-size:11px"><button class="hbtn" onclick="runDatabaseItemSearch()">SEARCH</button></div>')+
    errorBox(state.itemsError)+
    '<div class="ph">ITEMS <span style="font-size:9px;color:var(--dim)">'+(state.itemQuery.trim()?'matching "'+esc(state.itemQuery.trim())+'"':'recently updated')+' · '+state.items.length+' shown</span></div>'+
    (state.items.length?'<div class="panel" style="padding:4px 10px">'+miniTable([
      {label:'',render:function(i){return i.image?'<img src="'+esc(i.image)+'" alt="" loading="lazy" style="width:34px;height:34px;object-fit:contain;border-radius:4px">':'';}},
      {label:'Item',wrap:true,render:function(i){return '<a href="#" onclick="openDatabaseItem(\''+esc(i.id)+'\');return false" style="color:var(--text);font-weight:700">'+esc(i.name)+'</a><div style="color:var(--dim)">'+esc(i.set||'')+'</div>';}},
      {label:'Category',render:function(i){return esc(i.category||'—');}},
      {label:'Status',render:function(i){return statusChip(i.status);}},
      {label:'Qty',align:'right',render:function(i){return esc(i.qty==null?'—':i.qty);}},
      {label:'Price',align:'right',render:function(i){return dollars(i.price);}},
      {label:'Cost',align:'right',render:function(i){return dollars(i.cost);}},
    ],state.items)+'</div>':'<div class="panel" style="padding:24px;text-align:center;color:var(--dim)">'+(state.itemsLoaded?'No items found.':'Loading…')+'</div>');
}
async function openItem(id){
  state.item=null;state.itemError='';state.mode='item';busy('Loading item…');
  try{state.item=(await api('/store/db/item?'+storeParam()+'&id='+encodeURIComponent(id))).profile;}
  catch(e){state.itemError=e.message;}
  render();
}
function renderItemProfile(host){
  var back='<button class="hbtn" onclick="setDatabaseMode(\'inventory\')">← INVENTORY</button>';
  var p=state.item;
  if(!p){host.innerHTML='<div style="margin-bottom:10px">'+back+'</div>'+errorBox(state.itemError||'Could not load this item.');return;}
  var row=p.item||{},d=row.data||{},s=p.summary||{};
  var img=d.image||d.imageUrl||(Array.isArray(d.photos)&&d.photos[0])||'';
  host.innerHTML='<section class="foc-hero"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start"><div style="display:flex;gap:14px;align-items:flex-start">'+
      (img&&!/^data:/.test(img)?'<img src="'+esc(img)+'" alt="" style="width:90px;height:120px;object-fit:contain;border-radius:8px;background:var(--surf)">':'')+
      '<div><div style="font:900 20px/1.2 \'Orbitron\',monospace;color:var(--text)">'+esc(d.name||'(no name)')+'</div><div style="font:10px/1.7 var(--font-mono);color:var(--dim);margin-top:4px">'+esc([d.category,d.set,d.year,d.variant,d.condition].filter(Boolean).join(' · '))+'</div><div style="font:10px var(--font-mono);margin-top:4px">'+statusChip(row.status)+' · id '+esc(row.id)+'</div></div></div>'+
      '<div class="foc-toolbar">'+back+'</div></div>'+
    tiles([
      tile('LIST PRICE',dollars(d.priceOverride||d.salePrice||d.market),'var(--gold)'),
      tile('COST',dollars(d.cost)),
      tile('QTY ON HAND',esc(d.quantity??d.qty??'—')),
      tile('UNITS SOLD',String(s.unitsSold||0)),
      tile('REVENUE',dollars(s.revenue),'var(--gold)'),
      tile('PROFIT',dollars(s.profit),Number(s.profit||0)>=0?'var(--g)':'var(--red)'),
    ])+'</section>'+
    section('SALE HISTORY',(p.history||[]).length,miniTable([
      {label:'Date',render:function(h){return esc(displayDateTime(h.sold_at));}},
      {label:'Channel',render:function(h){return esc(h.channel||'—');}},
      {label:'Status',render:function(h){return statusChip(h.sale_status);}},
      {label:'Qty',align:'right',render:function(h){return esc(h.quantity||1);}},
      {label:'Price',align:'right',render:function(h){return dollars(h.adjusted_price);}},
      {label:'Cost',align:'right',render:function(h){return dollars(h.cost_basis);}},
      {label:'Profit',align:'right',render:function(h){var v=Number(h.profit||0);return '<span style="color:'+(v>=0?'var(--g)':'var(--red)')+'">'+dollars(v)+'</span>';}},
      {label:'Sale id',render:function(h){return esc(h.sale_id);}},
    ],p.history||[]))+
    (p.focSku?section('FOC CATALOG RECORD',null,fieldList(p.focSku)):'')+
    ((p.preorderItems||[]).length?section('CUSTOMER PREORDERS OF THIS COVER',p.preorderItems.length,miniTable([
      {label:'Date',render:function(r){return esc(displayDateTime(r.created_at));}},{label:'Order',render:function(r){return esc(r.order_id);}},
      {label:'Qty',align:'right',render:function(r){return esc(r.quantity);}},{label:'Line total',align:'right',render:function(r){return money(r.line_total_cents);}},{label:'Status',render:function(r){return statusChip(r.status);}},
    ],p.preorderItems)):'')+
    section('ALL STORED FIELDS',null,fieldList(Object.assign({status:row.status,created_at:row.created_at,updated_at:row.updated_at},d)));
}

// ---------- Tables ----------
async function loadTable(){
  state.tableError='';
  try{
    if(!tableGroups.length)tableGroups=(await api('/store/db/tables?'+storeParam())).groups||[];
    var data=await api('/store/db/table?'+storeParam()+'&table='+encodeURIComponent(state.table)+'&limit='+TABLE_PAGE+'&offset='+state.tableOffset);
    state.tableRows=data.rows||[];state.tableTotal=data.total;
  }catch(e){state.tableRows=[];state.tableTotal=null;state.tableError=e.message;}
}
function renderTables(host){
  var f=state.tableFilter.trim().toLowerCase();
  var rows=state.tableRows.filter(function(r){return !f||JSON.stringify(r).toLowerCase().indexOf(f)>-1;});
  var cols=[];rows.forEach(function(r){Object.keys(r).forEach(function(k){if(cols.indexOf(k)<0&&k!=='store_id')cols.push(k);});});
  var from=state.tableRows.length?state.tableOffset+1:0,to=state.tableOffset+state.tableRows.length;
  var atEnd=state.tableTotal!=null?to>=state.tableTotal:state.tableRows.length<TABLE_PAGE;
  host.innerHTML=hero('DATABASE TABLES','Read-only view of every table holding this store\'s data ('+tableGroups.reduce(function(n,g){return n+g.tables.length;},0)+' tables), newest first. Tables holding secrets -- payment account links, verification codes, invite tokens -- are left out.',
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><select id="database-table-select" onchange="setDatabaseTable(this.value)" style="padding:9px;font-family:var(--font-mono);font-size:11px">'+tableGroups.map(function(g){return '<optgroup label="'+esc(g.group)+'">'+g.tables.map(function(t){return '<option value="'+esc(t.key)+'"'+(t.key===state.table?' selected':'')+'>'+esc(t.label)+'</option>';}).join('')+'</optgroup>';}).join('')+'</select>'+
      '<input type="text" id="database-table-filter" placeholder="Filter this page…" value="'+esc(state.tableFilter)+'" oninput="onDatabaseTableFilter(this.value)" style="flex:1;min-width:180px;padding:9px;font-family:var(--font-mono);font-size:11px"><button class="hbtn" onclick="reloadDatabaseTable()">REFRESH</button></div>')+
    errorBox(state.tableError)+
    '<div class="ph">ROWS <span style="font-size:9px;color:var(--dim)">'+from+'–'+to+(state.tableTotal!=null?' of '+state.tableTotal:'')+'</span>'+
      '<span style="margin-left:auto;display:flex;gap:6px"><button class="hbtn" '+(state.tableOffset?'':'disabled ')+'onclick="pageDatabaseTable(-1)">← NEWER</button><button class="hbtn" '+(atEnd?'disabled ':'')+'onclick="pageDatabaseTable(1)">OLDER →</button></span></div>'+
    (rows.length?'<div class="panel" style="padding:0;overflow:auto;max-height:70vh"><table style="border-collapse:collapse;font:10px/1.5 var(--font-mono);min-width:100%"><thead><tr>'+cols.map(function(c){return '<th style="position:sticky;top:0;background:var(--surf);text-align:left;padding:7px 9px;color:var(--gold);white-space:nowrap;border-bottom:1px solid var(--border)">'+esc(c)+'</th>';}).join('')+'</tr></thead><tbody>'+
      rows.map(function(r){return '<tr>'+cols.map(function(c){var v=cellText(r[c]);return '<td title="'+esc(v.slice(0,2000))+'" style="padding:6px 9px;border-bottom:1px solid var(--border);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)">'+esc(v.slice(0,300))+'</td>';}).join('')+'</tr>';}).join('')+
      '</tbody></table></div>':'<div class="panel" style="padding:24px;text-align:center;color:var(--dim)">No rows.</div>');
}

// ---------- routing ----------
function render(){
  var host=panel();if(!host)return;
  if(state.mode==='customer')return renderCustomerProfile(host);
  if(state.mode==='inventory')return renderInventory(host);
  if(state.mode==='item')return renderItemProfile(host);
  if(state.mode==='tables')return renderTables(host);
  return renderCustomers(host);
}

window.ensureDatabasePanel=function(){ if(!state.loaded){state.loaded=true;busy('Loading customer database…');loadCustomers().then(render);} else render(); };
window.loadDatabaseCustomers=function(){busy('Refreshing…');loadCustomers().then(render);};
window.onDatabaseSearchInput=function(value){state.query=value;render();focusEnd('database-search-input');};
window.openDatabaseCustomer=function(index){var c=state.customers[index];if(c)openCustomer(c);};
window.setDatabaseMode=function(mode){
  state.mode=['customers','inventory','tables'].indexOf(mode)>-1?mode:'customers';
  if(state.mode==='tables'&&!state.tableRows.length&&!state.tableError){busy('Loading table…');loadTable().then(render);}
  else if(state.mode==='inventory'&&!state.itemsLoaded){busy('Loading inventory…');searchItems().then(render);}
  else render();
};
window.onDatabaseItemQuery=function(value){state.itemQuery=value;};
window.runDatabaseItemSearch=function(){busy('Searching…');searchItems().then(function(){render();focusEnd('database-item-search');});};
window.openDatabaseItem=function(id){openItem(id);};
window.setDatabaseTable=function(table){state.table=table;state.tableOffset=0;state.tableFilter='';busy('Loading table…');loadTable().then(render);};
window.reloadDatabaseTable=function(){busy('Refreshing…');loadTable().then(render);};
window.pageDatabaseTable=function(dir){state.tableOffset=Math.max(0,state.tableOffset+dir*TABLE_PAGE);busy('Loading table…');loadTable().then(render);};
window.onDatabaseTableFilter=function(value){state.tableFilter=value;render();focusEnd('database-table-filter');};
})();
