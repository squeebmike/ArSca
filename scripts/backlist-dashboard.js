(function(){
'use strict';

var state={loaded:false,imports:[],titles:[],orders:[],query:'',uploading:false,catalogOffset:0,catalogTotal:0,catalogLimit:25,catalogSearchTimer:null};

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

// The dashboard's own upload flow set lastImportReport in memory the
// moment a browser tab finished a real import -- but that state vanishes
// on reload (or is never seen from a different device/tab), which made a
// fully-successful 29,603-SKU import look like nothing had happened the
// next time this tab loaded. Re-reads the real backlist_imports row
// instead, every time the panel loads.
async function loadImportStatus(){
  try{
    var data=await api('/backlist/admin/import/status?store_id='+encodeURIComponent(getActiveStoreId()));
    var last=data.lastImport;
    state.lastImportReport=last?{completedAt:last.completed_at||last.started_at,status:last.status,report:last.import_report||{}}:null;
  }catch(e){ /* best-effort -- render() already guards a missing lastImportReport */ }
}

async function loadImports(){
  try{var data=await api('/backlist/admin/orders?store_id='+encodeURIComponent(getActiveStoreId()));state.orders=data.orders||[];}catch(e){state.orders=[];}
}

async function loadCatalog(){
  try{
    var params=new URLSearchParams({store_id:getActiveStoreId(),limit:String(state.catalogLimit),offset:String(state.catalogOffset)});
    if(state.query)params.set('q',state.query);
    var data=await api('/backlist/admin/catalog?'+params.toString());
    state.titles=data.titles||[];
    state.catalogTotal=data.total||0;
  }catch(e){state.titles=[];state.catalogTotal=0;state.catalogError=e.message;}
}

function render(){
  var host=panel();if(!host)return;
  var lastImport=state.lastImportReport;
  host.innerHTML='<section class="foc-hero"><div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap"><div><div style="font:900 22px/1.1 \'Orbitron\',monospace;color:var(--text)">PRH BACKLIST CATALOG</div><div style="font:10px/1.65 var(--font-mono);color:var(--dim);max-width:720px;margin-top:6px">Upload PRH\'s backlist metadata file (Seller portal export, whole catalog -- comics and regular books) to publish it for sale on the website. A purchase rides the store\'s next weekly PRH order rather than shipping from shelf stock, so it needs a longer delivery estimate than in-stock items -- that\'s computed automatically.</div></div>'+
    '<div class="foc-toolbar"><input type="file" id="backlist-import-file" accept=".csv,.xlsx,.xls" hidden onchange="handleBacklistImportFile(event)"><button class="hbtn" id="backlist-import-btn" onclick="document.getElementById(\'backlist-import-file\').click()">IMPORT BACKLIST FILE</button><button class="hbtn" onclick="loadBacklistOrders()">REFRESH ORDERS</button></div></div>'+
    '<div id="backlist-import-status" class="foc-import-report" style="display:none"></div>'+
    (lastImport?'<div style="font:10px/1.6 var(--font-mono);color:var(--dim);margin-top:8px">Last import: '+esc(displayDate(lastImport.completedAt))+(lastImport.status&&lastImport.status!=='completed'?' ('+esc(lastImport.status)+')':'')+' -- '+Number(lastImport.report.processed||0)+' rows processed, '+Number(lastImport.report.newSkus||0)+' new, '+Number(lastImport.report.updatedSkus||0)+' updated, '+Number(lastImport.report.unpublishedTitles||0)+' titles unpublished (vanished from the latest file), '+Number(lastImport.report.errors||0)+' errors.</div>':'<div style="font:10px/1.6 var(--font-mono);color:var(--dim);margin-top:8px">No import has completed yet.</div>')+
    '</section>'+
    '<div class="ph">CATALOG <span style="font-size:9px;color:var(--dim)">'+state.catalogTotal+' title(s)</span></div>'+
    '<input type="text" id="backlist-catalog-search" placeholder="Search title, author, series, or publisher…" value="'+esc(state.query)+'" oninput="onBacklistCatalogSearch(this.value)" style="width:100%;margin-bottom:10px;padding:10px;font-family:var(--font-mono);font-size:11px">'+
    (state.catalogError?'<div class="panel" style="padding:14px;color:var(--red);font-family:var(--font-mono);font-size:10px">'+esc(state.catalogError)+'</div>':'')+
    (state.titles.length?state.titles.map(titleCard).join(''):'<div class="panel" style="padding:24px;text-align:center;color:var(--dim)">'+(state.catalogTotal===0&&!state.query?'No titles imported yet -- click IMPORT BACKLIST FILE above.':'No titles match this search.')+'</div>')+
    catalogPager()+
    '<div class="ph" style="margin-top:14px">BACKLIST ORDERS <span style="font-size:9px;color:var(--dim)">'+state.orders.length+' total</span></div>'+
    (state.orders.length?state.orders.map(orderCard).join(''):'<div class="panel" style="padding:24px;text-align:center;color:var(--dim)">No backlist orders yet.</div>');
}

function catalogPager(){
  if(state.catalogTotal<=state.catalogLimit)return'';
  var page=Math.floor(state.catalogOffset/state.catalogLimit)+1;
  var pages=Math.max(1,Math.ceil(state.catalogTotal/state.catalogLimit));
  return '<div style="display:flex;gap:8px;align-items:center;justify-content:center;margin:10px 0;font:10px var(--font-mono);color:var(--dim)">'+
    '<button class="hbtn" '+(state.catalogOffset<=0?'disabled':'')+' onclick="pageBacklistCatalog(-1)">PREV</button>'+
    '<span>Page '+page+' of '+pages+'</span>'+
    '<button class="hbtn" '+(state.catalogOffset+state.catalogLimit>=state.catalogTotal?'disabled':'')+' onclick="pageBacklistCatalog(1)">NEXT</button>'+
    '</div>';
}

function titleCard(t){
  var skus=(t.backlist_skus||[]).slice().sort(function(a,b){return(a.format_name||'').localeCompare(b.format_name||'');});
  var skuRows=skus.map(function(s){
    var price=Number(s.customer_price_cents||s.msrp_cents||0);
    return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 0;border-top:1px solid var(--border)">'+
      '<div style="font:10px/1.5 var(--font-mono);color:var(--dim)">'+esc(s.format_name||'Format')+' · '+esc(s.upc||s.isbn||'no UPC/ISBN')+(s.on_sale_date?' · on sale '+esc(displayDate(s.on_sale_date)):'')+(s.is_orderable?'':' · <span style="color:var(--red)">not orderable</span>')+'</div>'+
      '<div style="display:flex;gap:8px;align-items:center">'+
        '<span style="font:9px var(--font-mono);color:var(--dim)">MSRP '+money(s.msrp_cents)+'</span>'+
        '<input type="number" step="0.01" min="0" class="tsi" value="'+(price/100).toFixed(2)+'" style="width:80px" onchange="updateBacklistSkuPrice(\''+esc(s.id)+'\',this.value)">'+
        '<label style="font:9px var(--font-mono);color:var(--dim);display:flex;gap:4px;align-items:center"><input type="checkbox" '+(s.customer_enabled!==false&&s.is_published?'checked':'')+' onchange="toggleBacklistSkuPublish(\''+esc(s.id)+'\',this.checked)"> PUBLISHED</label>'+
      '</div>'+
    '</div>';
  }).join('');
  return '<div class="panel" style="margin-bottom:10px;padding:14px">'+
    '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap"><b>'+esc(t.title)+(t.subtitle?' <span style="color:var(--dim);font-weight:400">-- '+esc(t.subtitle)+'</span>':'')+'</b>'+(t.is_published?'':'<span class="foc-badge" style="color:var(--red)">UNPUBLISHED</span>')+'</div>'+
    '<div style="font:10px/1.6 var(--font-mono);color:var(--dim);margin-top:2px">'+esc([t.writer,t.publisher,t.series_name].filter(Boolean).join(' · '))+'</div>'+
    skuRows+
    '</div>';
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
    state.lastImportReport={completedAt:new Date().toISOString(),status:'completed',report:finish.report};
    setStatus('Import complete: '+Number(finish.report.processed||0)+' rows, '+Number(finish.report.newSkus||0)+' new, '+Number(finish.report.updatedSkus||0)+' updated, '+Number(finish.report.unpublishedTitles||0)+' titles unpublished.','var(--g)');
    logOpsEvent('backlist_import',finish.report.processed+' backlist rows imported',{importId:importId,report:finish.report});
    state.catalogOffset=0;
    await Promise.all([loadImports(),loadCatalog()]);render();
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

async function toggleBacklistSkuPublish(skuId,checked){
  try{
    await api('/backlist/admin/sku',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),id:skuId,customerEnabled:checked})});
    toast_dash(checked?'Published':'Unpublished');
    await loadCatalog();render();
  }catch(e){toast_dash(e.message);render();}
}

async function updateBacklistSkuPrice(skuId,value){
  var cents=Math.round(Number(value||0)*100);
  if(!(cents>=0)){toast_dash('Enter a valid price');render();return;}
  try{
    await api('/backlist/admin/sku',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),id:skuId,customerPriceCents:cents})});
    toast_dash('Price updated');
    await loadCatalog();render();
  }catch(e){toast_dash(e.message);render();}
}

window.ensureBacklistPanel=function(){ if(!state.loaded){state.loaded=true;busy('Loading backlist catalog…');Promise.all([loadImportStatus(),loadImports(),loadCatalog()]).then(render);} else render(); };
window.loadBacklistOrders=function(){Promise.all([loadImportStatus(),loadImports(),loadCatalog()]).then(render);};
window.handleBacklistImportFile=handleBacklistImportFile;
window.openBacklistReceive=openBacklistReceive;
window.confirmBacklistReceive=confirmBacklistReceive;
window.toggleBacklistSkuPublish=toggleBacklistSkuPublish;
window.updateBacklistSkuPrice=updateBacklistSkuPrice;
window.onBacklistCatalogSearch=function(value){
  state.query=value;
  state.catalogOffset=0;
  clearTimeout(state.catalogSearchTimer);
  state.catalogSearchTimer=setTimeout(function(){
    loadCatalog().then(function(){
      render();
      var input=document.getElementById('backlist-catalog-search');
      if(input){input.focus();var pos=input.value.length;input.setSelectionRange(pos,pos);}
    });
  },300);
};
window.pageBacklistCatalog=function(direction){
  var next=state.catalogOffset+direction*state.catalogLimit;
  if(next<0||next>=state.catalogTotal)return;
  state.catalogOffset=next;
  loadCatalog().then(render);
};
})();
