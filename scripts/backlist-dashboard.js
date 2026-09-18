(function(){
'use strict';

var state={loaded:false,imports:[],titles:[],orders:[],query:'',uploading:false};

function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function money(cents){return '$'+(Number(cents||0)/100).toFixed(2);}
function displayDate(value){if(!value)return'—';var d=new Date(/^\d{4}-\d{2}-\d{2}$/.test(value)?value+'T12:00:00':value);return isNaN(d)?value:d.toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric'});}

async function api(path,opts){
  var res=await storeWorkerFetch(path,opts||{});var type=res.headers.get('content-type')||'';
  if(type.indexOf('application/json')<0)return res;
  var data=await res.json().catch(function(){return{};});if(!res.ok||data.ok===false)throw new Error(data.error||('Backlist request failed '+res.status));return data;
}

function panel(){return document.getElementById('backlist-panels');}
function busy(message){var host=panel();if(host)host.innerHTML='<div class="panel" style="padding:36px;text-align:center;font-family:var(--font-mono);color:var(--dim)">'+esc(message||'Loading…')+'</div>';}

async function loadImports(){
  try{var data=await api('/backlist/admin/orders?store_id='+encodeURIComponent(getActiveStoreId()));state.orders=data.orders||[];}catch(e){state.orders=[];}
}

function render(){
  var host=panel();if(!host)return;
  var lastImport=state.lastImportReport;
  host.innerHTML='<section class="foc-hero"><div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap"><div><div style="font:900 22px/1.1 \'Orbitron\',monospace;color:var(--text)">PRH BACKLIST CATALOG</div><div style="font:10px/1.65 var(--font-mono);color:var(--dim);max-width:720px;margin-top:6px">Upload PRH\'s backlist metadata file (Seller portal export, whole catalog -- comics and regular books) to publish it for sale on the website. A purchase rides the store\'s next weekly PRH order rather than shipping from shelf stock, so it needs a longer delivery estimate than in-stock items -- that\'s computed automatically.</div></div>'+
    '<div class="foc-toolbar"><input type="file" id="backlist-import-file" accept=".csv,.xlsx,.xls" hidden onchange="handleBacklistImportFile(event)"><button class="hbtn" id="backlist-import-btn" onclick="document.getElementById(\'backlist-import-file\').click()">IMPORT BACKLIST FILE</button><button class="hbtn" onclick="loadBacklistOrders()">REFRESH ORDERS</button></div></div>'+
    '<div id="backlist-import-status" class="foc-import-report" style="display:none"></div>'+
    (lastImport?'<div style="font:10px/1.6 var(--font-mono);color:var(--dim);margin-top:8px">Last import: '+esc(displayDate(lastImport.completedAt))+' -- '+Number(lastImport.report.processed||0)+' rows processed, '+Number(lastImport.report.newSkus||0)+' new, '+Number(lastImport.report.updatedSkus||0)+' updated, '+Number(lastImport.report.unpublishedTitles||0)+' titles unpublished (vanished from the latest file), '+Number(lastImport.report.errors||0)+' errors.</div>':'')+
    '</section>'+
    '<div class="ph">BACKLIST ORDERS <span style="font-size:9px;color:var(--dim)">'+state.orders.length+' total</span></div>'+
    (state.orders.length?state.orders.map(orderCard).join(''):'<div class="panel" style="padding:24px;text-align:center;color:var(--dim)">No backlist orders yet.</div>');
}

function orderCard(o){
  var items=o.backlist_order_items||[];
  var lines=items.map(function(i){var s=i.sku_snapshot||{};return '<div style="font:10px/1.6 var(--font-mono);color:var(--dim)">'+Number(i.quantity||1)+' x '+esc(s.title||'Item')+' ('+esc(i.status)+')</div>';}).join('');
  return '<div class="panel" style="margin-bottom:10px;padding:14px">'+
    '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap"><b>'+esc(o.order_number)+'</b><span class="foc-badge '+esc(o.status)+'">'+esc(o.status)+'</span></div>'+
    '<div style="font:10px/1.6 var(--font-mono);color:var(--dim);margin-top:4px">'+esc(o.customer_name)+' · '+esc(o.customer_email)+' · '+esc(o.fulfillment_method)+' · '+money(o.total_cents)+'</div>'+
    (o.estimated_ship_earliest?'<div style="font:10px/1.6 var(--font-mono);color:var(--dim)">Est. availability: '+esc(displayDate(o.estimated_ship_earliest))+' to '+esc(displayDate(o.estimated_ship_latest))+'</div>':'')+
    lines+
    (o.status==='paid'?'<button class="hbtn" style="margin-top:8px" onclick="openBacklistReceive(\''+esc(o.id)+'\')">RECEIVE / MARK FULFILLED</button>':'')+
    '</div>';
}

// Same shared read/hash/chunk-and-post pattern as the FOC/Lunar importers
// (raw:true is required -- PRH's dates/identifiers otherwise corrupt on
// parse, see foc-dashboard.js's handleFocFileImport) but this file can be
// tens of thousands of rows, far past what a single POST can carry
// (readJsonWithLimit caps a request body at 2MB) -- so this loops
// start -> many batch calls -> finish instead of one shot.
async function handleBacklistImportFile(event){
  var file=event.target.files&&event.target.files[0];event.target.value='';if(!file)return;
  if(state.uploading){toast_dash('An import is already running');return;}
  state.uploading=true;
  var status=document.getElementById('backlist-import-status');
  var setStatus=function(text,color){if(!status)return;status.style.display='block';status.style.color=color||'var(--gold)';status.textContent=text;};
  try{
    setStatus('Reading '+file.name+'…');
    var buffer=await file.arrayBuffer();
    var wb=XLSX.read(buffer,{type:'array',raw:true});
    var sheet=wb.Sheets[wb.SheetNames[0]];
    var matrix=XLSX.utils.sheet_to_json(sheet,{header:1,defval:''});
    var headerIndex=matrix.findIndex(function(row){var values=row.map(function(v){return String(v).trim();});return values.indexOf('MainIdentifier')>-1&&values.indexOf('Title')>-1&&values.indexOf('SalesStatusCode')>-1;});
    if(headerIndex<0)throw new Error('This does not look like a PRH backlist metadata CSV/XLSX');
    var rows=XLSX.utils.sheet_to_json(sheet,{range:headerIndex,defval:'',raw:false});
    if(!rows.length)throw new Error('No backlist rows found');
    var hashBuffer=await crypto.subtle.digest('SHA-256',buffer);
    var sourceSha256=Array.from(new Uint8Array(hashBuffer)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
    var storeId=getActiveStoreId();
    setStatus('Starting import of '+rows.length+' rows…');
    var start=await api('/backlist/admin/import/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:storeId,filename:file.name,sourceSha256:sourceSha256})});
    var importId=start.importId;
    var BATCH_SIZE=500;
    var report=null;
    for(var i=0;i<rows.length;i+=BATCH_SIZE){
      var chunk=rows.slice(i,i+BATCH_SIZE);
      var res=await api('/backlist/admin/import/batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:storeId,importId:importId,rows:chunk})});
      report=res.report;
      setStatus('Importing row '+Math.min(i+BATCH_SIZE,rows.length)+' of '+rows.length+' ('+Math.round(Math.min(i+BATCH_SIZE,rows.length)/rows.length*100)+'%)…');
    }
    setStatus('Finishing import (checking for titles PRH dropped)…');
    var finish=await api('/backlist/admin/import/finish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:storeId,importId:importId})});
    state.lastImportReport={completedAt:new Date().toISOString(),report:finish.report};
    setStatus('Import complete: '+Number(finish.report.processed||0)+' rows, '+Number(finish.report.newSkus||0)+' new, '+Number(finish.report.updatedSkus||0)+' updated, '+Number(finish.report.unpublishedTitles||0)+' titles unpublished.','var(--g)');
    logOpsEvent('backlist_import',finish.report.processed+' backlist rows imported',{importId:importId,report:finish.report});
    await loadImports();render();
  }catch(e){
    setStatus(e.message,'var(--red)');
  }finally{
    state.uploading=false;
  }
}

async function openBacklistReceive(orderId){
  var order=(state.orders||[]).find(function(o){return o.id===orderId;});
  if(!order)return;
  var items=order.backlist_order_items||[];
  var rowsHtml=items.filter(function(i){return i.status==='committed';}).map(function(i){var s=i.sku_snapshot||{};return '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:6px"><span style="font:10px var(--font-mono)">'+Number(i.quantity||1)+' x '+esc(s.title||'Item')+'</span><input type="number" min="0" class="tsi" data-sku-id="'+esc(i.sku_id)+'" value="'+Number(i.quantity||1)+'" style="width:80px"></div>';}).join('');
  var host=document.createElement('div');host.className='modal-backdrop';host.id='dash-backlist-receive-modal';
  host.innerHTML='<div class="modal-panel" style="max-width:420px"><h3>Receive: '+esc(order.order_number)+'</h3><div style="margin:10px 0">'+(rowsHtml||'<div style="color:var(--dim)">Nothing left to receive on this order.</div>')+'</div><div style="display:flex;gap:8px;justify-content:flex-end"><button class="hbtn" onclick="document.getElementById(\'dash-backlist-receive-modal\').remove()">CANCEL</button><button class="hbtn" style="background:var(--g)" onclick="confirmBacklistReceive(\''+esc(order.id)+'\')">CONFIRM RECEIVED</button></div></div>';
  document.body.appendChild(host);
}

async function confirmBacklistReceive(orderId){
  var modal=document.getElementById('dash-backlist-receive-modal');if(!modal)return;
  var lines=Array.from(modal.querySelectorAll('input[data-sku-id]')).map(function(input){return {skuId:input.dataset.skuId,receivedQty:Number(input.value||0)};}).filter(function(l){return l.receivedQty>0;});
  if(!lines.length){toast_dash('Enter at least one received quantity');return;}
  try{
    var res=await api('/backlist/admin/receive',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),lines:lines})});
    toast_dash('Received -- '+res.createdInventoryCount+' new inventory item(s) added');
    modal.remove();
    await loadImports();render();
  }catch(e){toast_dash(e.message);}
}

window.ensureBacklistPanel=function(){ if(!state.loaded){state.loaded=true;busy('Loading backlist orders…');loadImports().then(render);} else render(); };
window.loadBacklistOrders=function(){loadImports().then(render);};
window.handleBacklistImportFile=handleBacklistImportFile;
window.openBacklistReceive=openBacklistReceive;
window.confirmBacklistReceive=confirmBacklistReceive;
})();
