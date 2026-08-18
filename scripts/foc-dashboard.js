(function(){
'use strict';

var state={loaded:false,cycles:[],cycle:null,families:[],query:'',publisher:'all',flag:'all',saving:new Set(),shipping:null};

function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function money(cents){return '$'+(Number(cents||0)/100).toFixed(2);}
function pct(value,max){return max?Math.max(0,Math.min(100,Math.round(value/max*100))):0;}
function pacificDateTimeInput(iso){if(!iso)return'';try{return new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(iso)).replace(' ','T');}catch(e){return String(iso).slice(0,16);}}
function displayDate(value){if(!value)return'—';var d=new Date(/^\d{4}-\d{2}-\d{2}$/.test(value)?value+'T12:00:00':value);return isNaN(d)?value:d.toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:value.indexOf('T')>-1?'numeric':undefined,minute:value.indexOf('T')>-1?'2-digit':undefined,timeZone:'America/Los_Angeles'});}

async function api(path,opts){
  var res=await storeWorkerFetch(path,opts||{});var type=res.headers.get('content-type')||'';
  if(type.indexOf('application/json')<0)return res;
  var data=await res.json().catch(function(){return{};});if(!res.ok||data.ok===false)throw new Error(data.error||('FOC request failed '+res.status));return data;
}

function panel(){return document.getElementById('foc-panels');}
function busy(message){var host=panel();if(host)host.innerHTML='<div class="panel" style="padding:36px;text-align:center;font-family:var(--font-mono);color:var(--dim)">'+esc(message||'Loading FOC…')+'</div>';}

async function loadCycles(force){
  if(state.loaded&&!force){renderCycles();return;}
  busy('Loading weekly FOC cycles…');
  try{var data=await api('/foc/admin/cycles?store_id='+encodeURIComponent(getActiveStoreId()));state.cycles=data.cycles||[];state.loaded=true;renderCycles();}
  catch(e){panel().innerHTML='<div class="panel" style="color:var(--red)">Could not load FOC: '+esc(e.message)+'</div>';}
}

function cycleCard(c){
  var report=c.import_report||{};return '<button type="button" class="foc-cycle-card" onclick="openFocCycle(\''+esc(c.id)+'\')" style="width:100%;color:inherit;text-align:left">'+
    '<div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b class="foc-family-title">FOC '+esc(displayDate(c.foc_date))+'</b><span class="foc-badge '+esc(c.status)+'">'+esc(c.status)+'</span></div><div style="font:10px/1.6 var(--font-mono);color:var(--dim)">'+esc(c.source_filename||'PRH import')+' · '+Number(c.source_row_count||0)+' SKUs · closes '+esc(displayDate(c.customer_cutoff_at))+' PT</div></div>'+
    '<div style="font:10px/1.5 var(--font-mono);color:var(--dim);text-align:right"><b style="color:var(--text)">'+Number(report.families||0)+'</b> title families<br><b style="color:var(--gold)">'+Number(report.incentives||0)+'</b> incentives</div></button>';
}

function renderCycles(){
  var host=panel();if(!host)return;
  host.innerHTML='<section class="foc-hero"><div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap"><div><div style="font:900 22px/1.1 \'Orbitron\',monospace;color:var(--text)">THE FOC WALL</div><div style="font:10px/1.65 var(--font-mono);color:var(--dim);max-width:720px;margin-top:6px">Upload Monday\'s PRH metadata file, review exact covers, set shelf quantities, secure incentives, and export the clean UPC order.</div></div><div class="foc-toolbar"><input type="file" id="foc-import-file" accept=".csv,.xlsx,.xls" hidden onchange="handleFocImportFile(event)"><button class="hbtn" onclick="document.getElementById(\'foc-import-file\').click()">IMPORT PRH FOC</button><button class="hbtn" onclick="loadFocCycles(true)">REFRESH</button></div></div><div id="foc-import-status" class="foc-import-report" style="display:none"></div></section>'+
    '<details class="panel" style="margin-bottom:14px"><summary style="cursor:pointer;font-family:\'Orbitron\',monospace;color:var(--purple);font-size:11px">REAL SHIPPING SETUP</summary><div id="foc-shipping-settings" style="padding-top:12px"><button class="hbtn" onclick="loadFocShippingSettings()">LOAD SHIPPING SETTINGS</button></div></details>'+
    '<div class="ph">FOC CYCLES</div>'+(state.cycles.length?state.cycles.map(cycleCard).join(''):'<div class="panel" style="padding:30px;text-align:center;color:var(--dim)">No PRH FOC file has been imported yet.</div>');
}

async function handleImport(event){
  var file=event.target.files&&event.target.files[0];event.target.value='';if(!file)return;
  var status=document.getElementById('foc-import-status');if(status){status.style.display='block';status.textContent='Reading '+file.name+'…';}
  try{
    if(typeof XLSX==='undefined')throw new Error('Spreadsheet reader is still loading');
    // raw:true at read time is required for PRH's CSV export specifically --
    // without it, SheetJS "helpfully" type-infers date-looking cells (FOCDate,
    // OnSaleDate, etc.) and reformats them to a locale short date ("08/31/2026"
    // becomes "8/31/26"), which the strict 4-digit-year dateIso() parser on the
    // Worker then rejects outright -- every single row fails as "missing a FOC
    // date" even though the source file has one on every row. It also silently
    // rounds big numeric-looking identifier strings (MainIdentifier/UPC) through
    // float coercion, corrupting the last digit -- exactly wrong for a column
    // this importer treats as an exact identifier. raw:true keeps every cell as
    // its original literal string, which is what a distributor SKU/UPC/date
    // needs to stay exact for real XLSX files too, not just this CSV.
    var buffer=await file.arrayBuffer();var wb=XLSX.read(buffer,{type:'array',raw:true});var sheet=wb.Sheets[wb.SheetNames[0]];var matrix=XLSX.utils.sheet_to_json(sheet,{header:1,defval:''});
    var headerIndex=matrix.findIndex(function(row){var values=row.map(function(v){return String(v).trim();});return values.indexOf('MainIdentifier')>-1&&values.indexOf('Title')>-1&&(values.indexOf('FOCDate')>-1||values.indexOf('FOC Date')>-1);});
    if(headerIndex<0)throw new Error('This does not look like a PRH FOC metadata CSV/XLSX');
    var rows=XLSX.utils.sheet_to_json(sheet,{range:headerIndex,defval:'',raw:false});if(!rows.length)throw new Error('No PRH rows found');
    var hashBuffer=await crypto.subtle.digest('SHA-256',buffer);var sourceSha256=Array.from(new Uint8Array(hashBuffer)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
    if(status)status.textContent='Found '+rows.length+' exact cover SKUs. Importing and grouping title families…';
    var result=await api('/foc/admin/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceFilename:file.name,sourceSha256:sourceSha256,rows:rows})});
    var r=result.report||{};if(status)status.innerHTML='<b style="color:var(--g)">'+(result.duplicate?'Already imported — no duplicates created.':'Import complete.')+'</b><br>'+Number(r.processed||0)+' rows processed · '+Number(r.families||0)+' title families · '+Number(r.newSkus||0)+' new · '+Number(r.updatedSkus||0)+' updated · '+Number(r.unchanged||0)+' unchanged · '+Number(r.incentives||0)+' incentives';
    state.loaded=false;await loadCycles(true);await openCycle(result.cycleId);
  }catch(e){if(status){status.style.display='block';status.innerHTML='<b style="color:var(--red)">Import failed:</b> '+esc(e.message);}}
}

async function openCycle(id){
  busy('Building the cover wall…');
  try{var data=await api('/foc/admin/cycles?store_id='+encodeURIComponent(getActiveStoreId())+'&cycle_id='+encodeURIComponent(id));state.cycle=data.cycle;state.families=data.families||[];renderCycle();}
  catch(e){panel().innerHTML='<button class="hbtn" onclick="loadFocCycles()">BACK</button><div class="panel" style="margin-top:10px;color:var(--red)">'+esc(e.message)+'</div>';}
}

function visibleFamilies(){
  var q=state.query.trim().toLowerCase();return state.families.filter(function(f){
    var pub=state.publisher==='all'||String(f.publisher||'').toLowerCase()===state.publisher;
    var flagged=state.flag==='all'||(state.flag==='first'&&f.isFirstIssue)||(state.flag==='foil'&&f.variants.some(function(v){return v.isFoil;}))||(state.flag==='incentive'&&f.variants.some(function(v){return v.isIncentive;}))||(state.flag==='demand'&&f.variants.some(function(v){return v.customerQty>0;}));
    var hay=[f.title,f.seriesName,f.publisher,f.writer,f.interiorArtist].concat(f.variants.map(function(v){return[v.variantLabel,v.coverArtist].join(' ');})).join(' ').toLowerCase();return pub&&flagged&&(!q||hay.indexOf(q)>-1);
  });
}

function skuCard(v){
  var total=Number(v.customerQty||0)+Number(v.storeQuantity||0);var qual=v.qualification||{};var save="saveFocSku('"+esc(v.id)+"')";
  return '<article class="foc-sku '+(v.isIncentive?'incentive':'')+'" data-foc-sku="'+esc(v.id)+'">'+
    (v.coverImageUrl?'<img src="'+esc(v.coverImageUrl)+'" alt="'+esc(v.variantLabel)+'" loading="lazy" onerror="this.style.opacity=.16">':'<div style="aspect-ratio:2/3;display:grid;place-items:center;background:var(--surf2);color:var(--dim);border-radius:7px">NO COVER</div>')+
    '<div style="margin-top:8px;font-weight:800;font-size:11px;line-height:1.35;color:var(--text)">'+esc(v.variantLabel)+'</div><div style="font:9px/1.5 var(--font-mono);color:var(--dim)">'+esc(v.coverArtist||'Cover artist not listed')+'<br>UPC '+esc(v.upc)+'</div>'+
    ((v.isIncentive||v.isFoil)?'<div style="margin-top:7px;display:flex;gap:5px;flex-wrap:wrap">'+(v.isIncentive?'<span class="foc-badge incentive">INCENTIVE '+esc(v.orderRequirement)+'</span>':'')+(v.isFoil?'<span class="foc-badge">FOIL · PRICE SEPARATELY</span>':'')+'</div>':'')+
    (v.isIncentive?'<div class="foc-progress"><i style="width:'+pct(qual.total,qual.threshold)+'%"></i></div><div style="font:8px/1.4 var(--font-mono);color:'+(qual.qualified?'var(--g)':'var(--gold)')+'">'+Number(qual.total||0)+' / '+Number(qual.threshold||0)+(qual.qualified?' · QUALIFIED':' · '+Number(qual.needed||0)+' MORE TO UNLOCK')+' · '+Number(v.waitlistRequests||0)+' WAITLISTED</div>':'')+
    '<div class="foc-sku-fields"><label>CUSTOMERS<input class="tsi" value="'+Number(v.customerQty||0)+'" disabled></label><label>STORE QTY<input class="tsi" data-field="storeQuantity" type="number" min="0" value="'+Number(v.storeQuantity||0)+'" onchange="'+save+'"></label><label>'+(v.isIncentive?'SELL PRICE · REQUIRED':(v.isFoil?'FOIL SELL PRICE':'CUSTOMER PRICE'))+'<input class="tsi" data-field="customerPrice" type="number" min="0" step=".01" value="'+(Number(v.priceCents||0)/100).toFixed(2)+'" onchange="'+save+'"></label><label>'+(v.isIncentive?'SECURED QTY':'TOTAL ORDER')+'<input class="tsi" '+(v.isIncentive?'data-field="securedQuantity" type="number" min="0" onchange="'+save+'" value="'+Number(v.securedQuantity||0)+'"':'disabled value="'+total+'"')+'></label></div>'+
    (v.isIncentive&&!Number(v.priceCents||0)?'<div style="font:8px/1.45 var(--font-mono);color:var(--gold);margin-top:6px">REQUEST-ONLY UNTIL BOTH SECURED QTY AND SELL PRICE ARE SET</div>':'')+
    '<label style="display:flex;gap:6px;align-items:center;margin-top:7px;font:8px var(--font-mono);color:var(--dim)"><input data-field="customerEnabled" type="checkbox" '+(v.customerEnabled!==false?'checked':'')+' onchange="'+save+'"> SHOW TO CUSTOMERS</label></article>';
}

function familyCard(f){
  return '<section class="foc-family"><header class="foc-family-head"><div><div class="foc-family-title">'+esc(f.title)+'</div><div style="font:9px/1.55 var(--font-mono);color:var(--dim)">'+esc([f.publisher,f.writer?'W: '+f.writer:'',f.interiorArtist?'A: '+f.interiorArtist:'',f.onSaleDate?'On sale '+displayDate(f.onSaleDate):''].filter(Boolean).join(' · '))+'</div></div><div class="foc-toolbar"><label style="font:8px var(--font-mono);color:var(--dim)">HEAT <select class="tsi" data-family-heat="'+esc(f.id)+'" onchange="saveFocFamily(\''+esc(f.id)+'\')"><option value="">—</option>'+[1,2,3,4,5].map(function(n){return'<option '+(Number(f.heat)===n?'selected':'')+'>'+n+'</option>';}).join('')+'</select></label><label style="font:8px var(--font-mono);color:var(--dim)">FLAG <select class="tsi" data-family-category="'+esc(f.id)+'" onchange="saveFocFamily(\''+esc(f.id)+'\')"><option value="">None</option>'+[['dont_sleep',"DON\'T SLEEP"],['sleeper_watch','SLEEPER WATCH'],['solid_stock','SOLID STOCK'],['special_order','SPECIAL ORDER'],['pass','PASS']].map(function(x){return'<option value="'+x[0]+'" '+(f.heatCategory===x[0]?'selected':'')+'>'+x[1]+'</option>';}).join('')+'</select></label></div></header><div class="foc-sku-grid">'+f.variants.map(skuCard).join('')+'</div></section>';
}

function renderCycle(){
  var c=state.cycle;if(!c)return;var publishers=Array.from(new Set(state.families.map(function(f){return f.publisher;}).filter(Boolean))).sort();var allSkus=state.families.reduce(function(a,f){return a.concat(f.variants);},[]);var customerQty=allSkus.reduce(function(s,v){return s+Number(v.customerQty||0);},0);var storeQty=allSkus.reduce(function(s,v){return s+Number(v.storeQuantity||0);},0);var incentiveReq=allSkus.reduce(function(s,v){return s+Number(v.waitlistRequests||0);},0);
  panel().innerHTML='<section class="foc-hero"><div class="foc-toolbar"><button class="hbtn" onclick="loadFocCycles()">← CYCLES</button><button class="hbtn" onclick="exportFocPrh()">EXPORT PRH ORDER</button><button class="hbtn" onclick="toggleFocCycle()">'+(c.status==='open'?'CLOSE FOC':'REOPEN FOC')+'</button><a class="hbtn" href="https://themanapocket.com/preorders?cycle='+encodeURIComponent(c.foc_date)+'" target="_blank" rel="noopener" style="text-decoration:none">VIEW CUSTOMER PAGE</a></div><div style="display:flex;justify-content:space-between;gap:12px;align-items:end;flex-wrap:wrap;margin-top:14px"><div><div style="font:900 22px/1.1 \'Orbitron\',monospace;color:var(--text)">FOC '+esc(displayDate(c.foc_date))+'</div><div style="font:10px/1.6 var(--font-mono);color:var(--dim)">'+esc(c.source_filename||'PRH')+' · '+(c.isOpen?'OPEN FOR PREORDERS':'CLOSED / ARCHIVE')+'</div></div><label style="font:8px var(--font-mono);color:var(--dim)">CUSTOMER CUTOFF · PACIFIC<input id="foc-cycle-cutoff" class="tsi" type="datetime-local" value="'+esc(pacificDateTimeInput(c.customer_cutoff_at))+'" onchange="saveFocCycleCutoff()" style="margin:3px 0 0"></label></div><div class="foc-stats"><div class="foc-stat"><b>'+allSkus.length+'</b><span>Exact cover SKUs</span></div><div class="foc-stat"><b>'+state.families.length+'</b><span>Title families</span></div><div class="foc-stat"><b>'+customerQty+'</b><span>Customer copies</span></div><div class="foc-stat"><b>'+storeQty+'</b><span>Store copies</span></div><div class="foc-stat"><b>'+incentiveReq+'</b><span>Incentive requests</span></div></div></section><div class="panel foc-toolbar" style="margin-bottom:12px"><input id="foc-admin-search" class="tsi" placeholder="Search title, writer, artist…" value="'+esc(state.query)+'" oninput="filterFocAdmin(this.value)"><select class="tsi" onchange="filterFocPublisher(this.value)"><option value="all">All publishers</option>'+publishers.map(function(p){return'<option value="'+esc(p.toLowerCase())+'" '+(state.publisher===p.toLowerCase()?'selected':'')+'>'+esc(p)+'</option>';}).join('')+'</select><select class="tsi" onchange="filterFocFlag(this.value)"><option value="all">All comics</option><option value="first">#1 issues</option><option value="foil">Foil covers</option><option value="incentive">Incentives</option><option value="demand">Customer demand</option></select><span id="foc-visible-count" style="font:9px var(--font-mono);color:var(--dim)"></span></div><div id="foc-family-list"></div>';
  renderFamilies();
}

function renderFamilies(){var list=document.getElementById('foc-family-list');if(!list)return;var rows=visibleFamilies();var count=document.getElementById('foc-visible-count');if(count)count.textContent=rows.length+' title families';list.innerHTML=rows.length?rows.map(familyCard).join(''):'<div class="panel" style="padding:28px;text-align:center;color:var(--dim)">Nothing matches those filters.</div>';}

async function saveSku(id){var card=document.querySelector('[data-foc-sku="'+CSS.escape(id)+'"]');if(!card||state.saving.has(id))return;state.saving.add(id);try{var payload={storeId:getActiveStoreId(),skuId:id};card.querySelectorAll('[data-field]').forEach(function(el){payload[el.dataset.field]=el.type==='checkbox'?el.checked:el.value;});await api('/foc/admin/sku',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});toast_dash('FOC cover saved');await openCycle(state.cycle.id);}catch(e){toast_dash('Could not save cover: '+e.message);}finally{state.saving.delete(id);}}
async function saveFamily(id){try{var heat=document.querySelector('[data-family-heat="'+CSS.escape(id)+'"]');var category=document.querySelector('[data-family-category="'+CSS.escape(id)+'"]');await api('/foc/admin/sku',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),familyId:id,heat:heat&&heat.value?Number(heat.value):null,heatCategory:category&&category.value||null})});toast_dash('Title heat flag saved');}catch(e){toast_dash(e.message);}}
async function toggleCycle(){try{await api('/foc/admin/cycles?store_id='+encodeURIComponent(getActiveStoreId()),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({cycleId:state.cycle.id,status:state.cycle.status==='open'?'closed':'open'})});await openCycle(state.cycle.id);}catch(e){toast_dash(e.message);}}
async function saveCutoff(){var input=document.getElementById('foc-cycle-cutoff');if(!input||!input.value)return;try{await api('/foc/admin/cycles?store_id='+encodeURIComponent(getActiveStoreId()),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({cycleId:state.cycle.id,customerCutoffAt:new Date(input.value).toISOString()})});toast_dash('Customer cutoff saved in Pacific time');await openCycle(state.cycle.id);}catch(e){toast_dash(e.message);}}

async function exportPrh(){try{var res=await storeWorkerFetch('/foc/admin/export?store_id='+encodeURIComponent(getActiveStoreId())+'&cycle_id='+encodeURIComponent(state.cycle.id));if(!res.ok){var d=await res.json().catch(function(){return{};});throw new Error(d.error||'Export failed');}var blob=await res.blob();var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='PRH_FOC_'+state.cycle.foc_date+'.csv';a.click();setTimeout(function(){URL.revokeObjectURL(a.href);},1000);}catch(e){toast_dash(e.message);}}

async function loadShipping(){var host=document.getElementById('foc-shipping-settings');if(!host)return;host.textContent='Loading…';try{var d=await api('/foc/admin/shipping-settings?store_id='+encodeURIComponent(getActiveStoreId()));state.shipping=d.shipping||{};renderShipping();}catch(e){host.innerHTML='<span style="color:var(--red)">'+esc(e.message)+'</span>';}}
function renderShipping(){var s=state.shipping||{},f=s.from||{},p=s.parcel||{};document.getElementById('foc-shipping-settings').innerHTML='<div class="foc-import-report"><b style="color:'+(s.tokenConfigured?'var(--g)':'var(--gold)')+'">SHIPPO TOKEN '+(s.tokenConfigured?'CONNECTED':'NEEDS SETUP')+'</b><br>The API token stays in the Worker secret. This form stores only your ship-from address and package preset.</div><div class="foc-sku-fields" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-top:10px">'+[['name','Store / sender',f.name],['line1','Street',f.street1],['line2','Suite / unit',f.street2],['city','City',f.city],['state','State',f.state],['zip','ZIP',f.zip],['phone','Phone',f.phone],['email','Email',f.email]].map(function(x){return'<label>'+x[1]+'<input class="tsi" data-ship-from="'+x[0]+'" value="'+esc(x[2]||'')+'"></label>';}).join('')+'</div><div class="foc-sku-fields" style="grid-template-columns:repeat(4,minmax(0,1fr));margin-top:10px">'+[['length','Length',p.length||12],['width','Width',p.width||9],['height','Height',p.height||1],['weight','Weight lb',p.weight||1]].map(function(x){return'<label>'+x[1]+'<input class="tsi" type="number" min=".1" step=".1" data-ship-parcel="'+x[0]+'" value="'+esc(x[2])+'"></label>';}).join('')+'</div><button class="hbtn" style="margin-top:10px" onclick="saveFocShippingSettings()">SAVE LIVE SHIPPING SETUP</button>';}
async function saveShipping(){var shipFrom={},parcel={};document.querySelectorAll('[data-ship-from]').forEach(function(el){shipFrom[el.dataset.shipFrom]=el.value;});document.querySelectorAll('[data-ship-parcel]').forEach(function(el){parcel[el.dataset.shipParcel]=el.value;});try{var d=await api('/foc/admin/shipping-settings',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),enabled:true,shipFrom:shipFrom,defaultParcel:parcel})});state.shipping=d.shipping;toast_dash(d.shipping.tokenConfigured?'Live carrier settings saved':'Address saved — add the Shippo token to enable rates');renderShipping();}catch(e){toast_dash(e.message);}}

window.ensureFocPanel=function(){loadCycles(false);};window.loadFocCycles=loadCycles;window.openFocCycle=openCycle;window.handleFocImportFile=handleImport;window.filterFocAdmin=function(v){state.query=v;renderFamilies();};window.filterFocPublisher=function(v){state.publisher=v;renderFamilies();};window.filterFocFlag=function(v){state.flag=v;renderFamilies();};window.saveFocSku=saveSku;window.saveFocFamily=saveFamily;window.toggleFocCycle=toggleCycle;window.saveFocCycleCutoff=saveCutoff;window.exportFocPrh=exportPrh;window.loadFocShippingSettings=loadShipping;window.saveFocShippingSettings=saveShipping;
})();
