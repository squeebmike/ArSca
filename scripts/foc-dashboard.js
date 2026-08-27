(function(){
'use strict';

var state={loaded:false,cycles:[],cycle:null,families:[],query:'',publisher:'all',flag:'all',ebay:'all',saving:new Set(),shipping:null};

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
  var report=c.import_report||{},stateLabel=c.status==='archived'?'hidden from site':(c.isOpen?'unlocked':'locked');return '<button type="button" class="foc-cycle-card" onclick="openFocCycle(\''+esc(c.id)+'\')" style="width:100%;color:inherit;text-align:left">'+
    '<div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b class="foc-family-title">FOC '+esc(displayDate(c.foc_date))+'</b><span class="foc-badge '+esc(c.status)+'">'+esc(stateLabel)+'</span></div><div style="font:10px/1.6 var(--font-mono);color:var(--dim)">'+esc(c.source_filename||'PRH import')+' · '+Number(c.source_row_count||0)+' SKUs · closes '+esc(displayDate(c.customer_cutoff_at))+' PT</div></div>'+
    '<div style="font:10px/1.5 var(--font-mono);color:var(--dim);text-align:right"><b style="color:var(--text)">'+Number(report.families||0)+'</b> title families<br><b style="color:var(--gold)">'+Number(report.incentives||0)+'</b> incentives</div></button>';
}

function renderCycles(){
  var host=panel();if(!host)return;
  host.innerHTML='<section class="foc-hero"><div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap"><div><div style="font:900 22px/1.1 \'Orbitron\',monospace;color:var(--text)">THE FOC WALL</div><div style="font:10px/1.65 var(--font-mono);color:var(--dim);max-width:720px;margin-top:6px">Upload Monday\'s PRH metadata file, review exact covers, set shelf quantities, secure incentives, and export the clean UPC order.</div></div><div class="foc-toolbar"><input type="file" id="foc-import-file" accept=".csv,.xlsx,.xls" hidden onchange="handleFocImportFile(event)"><button class="hbtn" onclick="document.getElementById(\'foc-import-file\').click()">IMPORT PRH FOC</button><button class="hbtn" onclick="loadFocCycles(true)">REFRESH</button></div></div><div id="foc-import-status" class="foc-import-report" style="display:none"></div></section>'+
    '<details class="panel" style="margin-bottom:14px"><summary style="cursor:pointer;font-family:\'Orbitron\',monospace;color:var(--purple);font-size:11px">REAL SHIPPING SETUP</summary><div id="foc-shipping-settings" style="padding-top:12px"><button class="hbtn" onclick="loadFocShippingSettings()">LOAD SHIPPING SETTINGS</button></div></details>'+
    '<details class="panel" style="margin-bottom:14px" ontoggle="if(this.open)loadEbaySafeDays()"><summary style="cursor:pointer;font-family:\'Orbitron\',monospace;color:var(--purple);font-size:11px">EBAY PRESALE SETTINGS</summary><div style="padding-top:12px;font:10px/1.6 var(--font-mono);color:var(--dim)">Our internal safety buffer before FOC comics are eligible for eBay presale. eBay\'s own current policy limit is 40 business days from listing to ship -- keep this below that.<div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-top:8px"><label style="font:8px var(--font-mono);color:var(--dim)">SAFE BUSINESS-DAY BUFFER<input id="foc-ebay-safe-days" class="tsi" type="number" min="1" max="60" value="35" style="width:80px"></label><button class="hbtn" onclick="saveFocEbaySafeDays()">SAVE</button></div></div></details>'+
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
  // Store report: opening a freshly-imported cycle showed only 2 of 125
  // title families, with every filter dropdown visually reading "All" --
  // a filter set while browsing an EARLIER cycle (search text, publisher,
  // flag, or eBay status) was never cleared here, so it silently kept
  // filtering the new cycle's families down to whatever tiny subset still
  // matched, while flag/eBay's <select> markup (unlike the search box and
  // publisher select) never re-marked the right option as selected -- so
  // the stale filter looked like "no filter" was active at all.
  state.query='';state.publisher='all';state.flag='all';state.ebay='all';
  try{var data=await api('/foc/admin/cycles?store_id='+encodeURIComponent(getActiveStoreId())+'&cycle_id='+encodeURIComponent(id));state.cycle=data.cycle;state.families=data.families||[];renderCycle();}
  catch(e){panel().innerHTML='<button class="hbtn" onclick="loadFocCycles()">BACK</button><div class="panel" style="margin-top:10px;color:var(--red)">'+esc(e.message)+'</div>';}
}

function visibleFamilies(){
  var q=state.query.trim().toLowerCase();return state.families.filter(function(f){
    var pub=state.publisher==='all'||String(f.publisher||'').toLowerCase()===state.publisher;
    var flagged=state.flag==='all'||(state.flag==='first'&&f.isFirstIssue)||(state.flag==='foil'&&f.variants.some(function(v){return v.isFoil;}))||(state.flag==='incentive'&&f.variants.some(function(v){return v.isIncentive;}))||(state.flag==='demand'&&f.variants.some(function(v){return v.customerQty>0;}));
    var ebay=state.ebay==='all'||f.variants.some(function(v){return v.ebayPresaleStatus===state.ebay;});
    var hay=[f.title,f.seriesName,f.publisher,f.writer,f.interiorArtist].concat(f.variants.map(function(v){return[v.variantLabel,v.coverArtist].join(' ');})).join(' ').toLowerCase();return pub&&flagged&&ebay&&(!q||hay.indexOf(q)>-1);
  });
}

var EBAY_PRESALE_LABEL={TOO_EARLY:'EBAY · TOO EARLY',ELIGIBLE_NOW:'EBAY · ELIGIBLE',LISTED:'EBAY · LISTED',SOLD_OUT:'EBAY · SOLD OUT',RELEASED:'EBAY · RELEASED',ACTION_REQUIRED:'EBAY · ACTION REQUIRED'};
function ebaySection(v){
  var status=v.ebayPresaleStatus;if(!status)return'';
  var cls=status==='LISTED'?'open':(status==='ELIGIBLE_NOW'?'incentive':'');
  var color=status==='SOLD_OUT'||status==='ACTION_REQUIRED'?'color:var(--red);border-color:color-mix(in srgb,var(--red) 40%,transparent)':'';
  var badge='<span class="foc-badge '+cls+'" style="'+color+'">'+esc(EBAY_PRESALE_LABEL[status]||status)+'</span>';
  var detail='';
  if(status==='TOO_EARLY')detail='Eligible '+displayDate(v.ebayEligibleDate);
  else if(status==='LISTED'||status==='SOLD_OUT')detail=Number(v.ebayPresold||0)+' presold · '+Number(v.ebayAvailable||0)+' available';
  else if(status==='ACTION_REQUIRED')detail=v.ebayPresaleNote||'';
  var action='';
  if(status==='ELIGIBLE_NOW')action='<button class="hbtn" style="margin-top:6px;width:100%;min-height:30px;font-size:9px" onclick="createFocEbayPresale(\''+esc(v.id)+'\')">CREATE EBAY PRESALE</button>';
  else if(status==='LISTED')action='<button class="hbtn" style="margin-top:6px;width:100%;min-height:30px;font-size:9px" onclick="createFocEbayPresale(\''+esc(v.id)+'\')">LIST MORE ON EBAY</button>';
  return '<div style="margin-top:8px;padding-top:7px;border-top:1px solid var(--border)">'+badge+(detail?'<div style="font:8px/1.5 var(--font-mono);color:var(--dim);margin-top:4px">'+esc(detail)+'</div>':'')+action+'</div>';
}
function skuCard(v){
  var total=Number(v.customerQty||0)+Number(v.storeQuantity||0);var qual=v.qualification||{};var save="saveFocSku('"+esc(v.id)+"')";
  return '<article class="foc-sku '+(v.isIncentive?'incentive':'')+'" data-foc-sku="'+esc(v.id)+'">'+
    (v.coverImageUrl?'<img src="'+esc(v.coverImageUrl)+'" alt="'+esc(v.variantLabel)+'" loading="lazy" onerror="this.style.opacity=.16">':'<div style="aspect-ratio:2/3;display:grid;place-items:center;background:var(--surf2);color:var(--dim);border-radius:7px">NO COVER</div>')+
    '<div style="margin-top:8px;font-weight:800;font-size:11px;line-height:1.35;color:var(--text)">'+esc(v.variantLabel)+'</div><div style="font:9px/1.5 var(--font-mono);color:var(--dim)">'+esc(v.coverArtist||'Cover artist not listed')+'<br>UPC '+esc(v.upc)+'</div>'+
    ((v.isIncentive||v.isFoil)?'<div style="margin-top:7px;display:flex;gap:5px;flex-wrap:wrap">'+(v.isIncentive?'<span class="foc-badge incentive">INCENTIVE '+esc(v.orderRequirement)+'</span>':'')+(v.isFoil?'<span class="foc-badge">FOIL · PRICE SEPARATELY</span>':'')+'</div>':'')+
    (v.isIncentive?'<div class="foc-progress"><i style="width:'+pct(qual.total,qual.threshold)+'%"></i></div><div style="font:8px/1.4 var(--font-mono);color:'+(qual.qualified?'var(--g)':'var(--gold)')+'">'+Number(qual.total||0)+' / '+Number(qual.threshold||0)+(qual.qualified?' · QUALIFIED':' · '+Number(qual.needed||0)+' MORE TO UNLOCK')+' · '+Number(v.waitlistRequests||0)+' WAITLISTED</div>':'')+
    '<div class="foc-sku-fields"><label>CUSTOMERS<input class="tsi" value="'+Number(v.customerQty||0)+'" disabled></label><label>STORE QTY<input class="tsi" data-field="storeQuantity" type="number" min="0" value="'+Number(v.storeQuantity||0)+'" onchange="'+save+'"></label><label>'+(v.isIncentive?'SELL PRICE · REQUIRED':(v.isFoil?'FOIL SELL PRICE':'CUSTOMER PRICE'))+'<input class="tsi" data-field="customerPrice" type="number" min="0" step=".01" value="'+(Number(v.priceCents||0)/100).toFixed(2)+'" onchange="'+save+'"></label><label>'+(v.isIncentive?'SECURED QTY':'TOTAL ORDER')+'<input class="tsi" '+(v.isIncentive?'data-field="securedQuantity" type="number" min="0" onchange="'+save+'" value="'+Number(v.securedQuantity||0)+'"':'disabled value="'+total+'"')+'></label><label>SAFETY STOCK<input class="tsi" data-field="safetyStockQty" type="number" min="0" value="'+Number(v.safetyStockQty||0)+'" onchange="'+save+'"></label></div>'+
    (v.isIncentive&&!Number(v.priceCents||0)?'<div style="font:8px/1.45 var(--font-mono);color:var(--gold);margin-top:6px">REQUEST-ONLY UNTIL BOTH SECURED QTY AND SELL PRICE ARE SET</div>':'')+
    '<label style="display:flex;gap:6px;align-items:center;margin-top:7px;font:8px var(--font-mono);color:var(--dim)"><input data-field="customerEnabled" type="checkbox" '+(v.customerEnabled!==false?'checked':'')+' onchange="'+save+'"> SHOW TO CUSTOMERS</label>'+
    ebaySection(v)+'</article>';
}

function familyCard(f){
  return '<section class="foc-family"><header class="foc-family-head"><div><div class="foc-family-title">'+esc(f.title)+'</div><div style="font:9px/1.55 var(--font-mono);color:var(--dim)">'+esc([f.publisher,f.writer?'W: '+f.writer:'',f.interiorArtist?'A: '+f.interiorArtist:'',f.onSaleDate?'On sale '+displayDate(f.onSaleDate):''].filter(Boolean).join(' · '))+'</div></div><div class="foc-toolbar"><label style="font:8px var(--font-mono);color:var(--dim)">HEAT <select class="tsi" data-family-heat="'+esc(f.id)+'" onchange="saveFocFamily(\''+esc(f.id)+'\')"><option value="">—</option>'+[1,2,3,4,5].map(function(n){return'<option '+(Number(f.heat)===n?'selected':'')+'>'+n+'</option>';}).join('')+'</select></label><label style="font:8px var(--font-mono);color:var(--dim)">FLAG <select class="tsi" data-family-category="'+esc(f.id)+'" onchange="saveFocFamily(\''+esc(f.id)+'\')"><option value="">None</option>'+[['dont_sleep',"DON\'T SLEEP"],['sleeper_watch','SLEEPER WATCH'],['solid_stock','SOLID STOCK'],['special_order','SPECIAL ORDER'],['pass','PASS']].map(function(x){return'<option value="'+x[0]+'" '+(f.heatCategory===x[0]?'selected':'')+'>'+x[1]+'</option>';}).join('')+'</select></label></div></header><div class="foc-sku-grid">'+f.variants.map(skuCard).join('')+'</div></section>';
}

function renderCycle(){
  var c=state.cycle;if(!c)return;var publishers=Array.from(new Set(state.families.map(function(f){return f.publisher;}).filter(Boolean))).sort();var allSkus=state.families.reduce(function(a,f){return a.concat(f.variants);},[]);var customerQty=allSkus.reduce(function(s,v){return s+Number(v.customerQty||0);},0);var storeQty=allSkus.reduce(function(s,v){return s+Number(v.storeQuantity||0);},0);var incentiveReq=allSkus.reduce(function(s,v){return s+Number(v.waitlistRequests||0);},0);
  panel().innerHTML='<section class="foc-hero"><div class="foc-toolbar"><button class="hbtn" onclick="loadFocCycles()">← CYCLES</button><button class="hbtn" style="color:var(--purple)" onclick="openFocReview()">FINAL FOC REVIEW</button><button class="hbtn" onclick="exportFocPrh()">EXPORT PRH ORDER</button><button class="hbtn" style="color:var(--g)" onclick="openReceiveShipment()">RECEIVE SHIPMENT</button>'+(c.status!=='archived'?'<button class="hbtn" onclick="toggleFocCycle()">'+(c.isOpen?'LOCK ORDERS':'UNLOCK ORDERS')+'</button>':'')+(c.status==='archived'?'<button class="hbtn" onclick="unarchiveFocCycle()">SHOW ON SITE (LOCKED)</button>':'<button class="hbtn danger" onclick="archiveFocCycle()">HIDE FROM SITE</button>')+'<a class="hbtn" href="https://themanapocket.com/preorders?cycle='+encodeURIComponent(c.foc_date)+'" target="_blank" rel="noopener" style="text-decoration:none">VIEW CUSTOMER PAGE</a></div><div style="display:flex;justify-content:space-between;gap:12px;align-items:end;flex-wrap:wrap;margin-top:14px"><div><div style="font:900 22px/1.1 \'Orbitron\',monospace;color:var(--text)">FOC '+esc(displayDate(c.foc_date))+'</div><div style="font:10px/1.6 var(--font-mono);color:var(--dim)">'+esc(c.source_filename||'PRH')+' · '+(c.status==='archived'?'HIDDEN FROM SITE':(c.isOpen?'UNLOCKED FOR ORDERS':'VISIBLE BUT LOCKED'))+'</div></div><label style="font:8px var(--font-mono);color:var(--dim)">CUSTOMER CUTOFF · PACIFIC<input id="foc-cycle-cutoff" class="tsi" type="datetime-local" value="'+esc(pacificDateTimeInput(c.customer_cutoff_at))+'" onchange="saveFocCycleCutoff()" style="margin:3px 0 0"><span style="display:block;margin-top:4px">Set a future cutoff before unlocking an expired FOC.</span></label></div><div class="foc-stats"><div class="foc-stat"><b>'+allSkus.length+'</b><span>Exact cover SKUs</span></div><div class="foc-stat"><b>'+state.families.length+'</b><span>Title families</span></div><div class="foc-stat"><b>'+customerQty+'</b><span>Customer copies</span></div><div class="foc-stat"><b>'+storeQty+'</b><span>Store copies</span></div><div class="foc-stat"><b>'+incentiveReq+'</b><span>Incentive requests</span></div></div></section><div class="panel foc-toolbar" style="margin-bottom:12px"><input id="foc-admin-search" class="tsi" placeholder="Search title, writer, artist…" value="'+esc(state.query)+'" oninput="filterFocAdmin(this.value)"><select class="tsi" onchange="filterFocPublisher(this.value)"><option value="all" '+(state.publisher==='all'?'selected':'')+'>All publishers</option>'+publishers.map(function(p){return'<option value="'+esc(p.toLowerCase())+'" '+(state.publisher===p.toLowerCase()?'selected':'')+'>'+esc(p)+'</option>';}).join('')+'</select><select class="tsi" onchange="filterFocFlag(this.value)"><option value="all" '+(state.flag==='all'?'selected':'')+'>All comics</option><option value="first" '+(state.flag==='first'?'selected':'')+'>#1 issues</option><option value="foil" '+(state.flag==='foil'?'selected':'')+'>Foil covers</option><option value="incentive" '+(state.flag==='incentive'?'selected':'')+'>Incentives</option><option value="demand" '+(state.flag==='demand'?'selected':'')+'>Customer demand</option></select><select class="tsi" onchange="filterFocEbay(this.value)"><option value="all" '+(state.ebay==='all'?'selected':'')+'>All eBay statuses</option><option value="ELIGIBLE_NOW" '+(state.ebay==='ELIGIBLE_NOW'?'selected':'')+'>Eligible, not listed</option><option value="TOO_EARLY" '+(state.ebay==='TOO_EARLY'?'selected':'')+'>Too early</option><option value="LISTED" '+(state.ebay==='LISTED'?'selected':'')+'>Already listed</option><option value="SOLD_OUT" '+(state.ebay==='SOLD_OUT'?'selected':'')+'>Presale sold out</option><option value="ACTION_REQUIRED" '+(state.ebay==='ACTION_REQUIRED'?'selected':'')+'>Action required</option></select><span id="foc-visible-count" style="font:9px var(--font-mono);color:var(--dim)"></span></div><div id="foc-family-list"></div>';
  renderFamilies();
}

function renderFamilies(){var list=document.getElementById('foc-family-list');if(!list)return;var rows=visibleFamilies();var count=document.getElementById('foc-visible-count');if(count)count.textContent=rows.length+' title families';list.innerHTML=rows.length?rows.map(familyCard).join(''):'<div class="panel" style="padding:28px;text-align:center;color:var(--dim)">Nothing matches those filters.</div>';}

async function saveSku(id){var card=document.querySelector('[data-foc-sku="'+CSS.escape(id)+'"]');if(!card||state.saving.has(id))return;state.saving.add(id);try{var payload={storeId:getActiveStoreId(),skuId:id};card.querySelectorAll('[data-field]').forEach(function(el){payload[el.dataset.field]=el.type==='checkbox'?el.checked:el.value;});await api('/foc/admin/sku',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});toast_dash('FOC cover saved');await openCycle(state.cycle.id);}catch(e){toast_dash('Could not save cover: '+e.message);}finally{state.saving.delete(id);}}
async function saveFamily(id){try{var heat=document.querySelector('[data-family-heat="'+CSS.escape(id)+'"]');var category=document.querySelector('[data-family-category="'+CSS.escape(id)+'"]');await api('/foc/admin/sku',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),familyId:id,heat:heat&&heat.value?Number(heat.value):null,heatCategory:category&&category.value||null})});toast_dash('Title heat flag saved');}catch(e){toast_dash(e.message);}}
async function toggleCycle(){
  if(!state.cycle||state.cycle.status==='archived')return;
  var next=state.cycle.isOpen?'closed':'open',payload={cycleId:state.cycle.id,status:next};
  if(next==='open'){
    var input=document.getElementById('foc-cycle-cutoff'),cutoff=input&&new Date(input.value);
    if(!cutoff||!Number.isFinite(cutoff.getTime())||cutoff.getTime()<=Date.now()){toast_dash('Set a future customer cutoff before unlocking this FOC');if(input)input.focus();return;}
    payload.customerCutoffAt=cutoff.toISOString();
  }
  try{await api('/foc/admin/cycles?store_id='+encodeURIComponent(getActiveStoreId()),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});toast_dash(next==='open'?'FOC orders unlocked':'FOC orders locked');await openCycle(state.cycle.id);}catch(e){toast_dash(e.message);}
}
// Archiving is how a FOC week is "removed" -- it's excluded from the
// customer-facing preorder page's cycle list the moment status flips to
// archived (see loadAllCatalogs's status=neq.archived filter), but the row
// and every order/item under it stays intact for records. Reversible from
// here too, since a mis-click shouldn't be a data-loss event.
async function archiveCycle(){
  if(!state.cycle||!confirm('Hide FOC '+displayDate(state.cycle.foc_date)+' from the customer site? Orders and records stay intact, and it can be shown again.'))return;
  try{await api('/foc/admin/cycles?store_id='+encodeURIComponent(getActiveStoreId()),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({cycleId:state.cycle.id,status:'archived'})});toast_dash('FOC hidden from the customer site');state.loaded=false;await loadCycles(true);}catch(e){toast_dash(e.message);}
}
async function unarchiveCycle(){
  if(!state.cycle)return;
  try{await api('/foc/admin/cycles?store_id='+encodeURIComponent(getActiveStoreId()),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({cycleId:state.cycle.id,status:'closed'})});toast_dash('FOC is visible on the site and remains locked');await openCycle(state.cycle.id);}catch(e){toast_dash(e.message);}
}
async function saveCutoff(){var input=document.getElementById('foc-cycle-cutoff');if(!input||!input.value)return;try{await api('/foc/admin/cycles?store_id='+encodeURIComponent(getActiveStoreId()),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({cycleId:state.cycle.id,customerCutoffAt:new Date(input.value).toISOString()})});toast_dash('Customer cutoff saved in Pacific time');await openCycle(state.cycle.id);}catch(e){toast_dash(e.message);}}

async function exportPrh(){try{var res=await storeWorkerFetch('/foc/admin/export?store_id='+encodeURIComponent(getActiveStoreId())+'&cycle_id='+encodeURIComponent(state.cycle.id));if(!res.ok){var d=await res.json().catch(function(){return{};});throw new Error(d.error||'Export failed');}var blob=await res.blob();var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='PRH_FOC_'+state.cycle.foc_date+'.csv';a.click();setTimeout(function(){URL.revokeObjectURL(a.href);},1000);}catch(e){toast_dash(e.message);}}

// Turns a physically-arrived box into real inventory -- this is the ONLY
// place a comic_sku ever becomes an inventory_items row. Importing a PRH
// file (hundreds of covers/week) never creates inventory, and neither does
// exporting the distributor order -- placing an order is not proof it
// arrives (short-ships, delays, cancellations are routine). Only what's
// actually checked in here becomes real, sellable stock.
function receiveLineHtml(v){
  var total=Number(v.customerQty||0)+Number(v.storeQuantity||0);
  if(total<=0)return'';
  return '<div class="foc-sku-fields" data-receive-row style="grid-template-columns:2fr 1fr;align-items:end;padding:8px;border-bottom:1px solid var(--border)">'+
    '<div><div style="font-weight:700;font-size:11px;color:var(--text)">'+esc(v.variantLabel)+'</div><div style="font:9px/1.4 var(--font-mono);color:var(--dim)">Ordered '+total+' (customers '+Number(v.customerQty||0)+' + store '+Number(v.storeQuantity||0)+') · UPC '+esc(v.upc)+'</div></div>'+
    '<label>RECEIVED<input class="tsi" type="number" min="0" data-receive-sku="'+esc(v.id)+'" value="'+total+'"></label></div>';
}
function openReceiveShipment(){
  var c=state.cycle;if(!c)return;
  var rows=state.families.map(function(f){
    var lines=f.variants.map(receiveLineHtml).filter(Boolean);
    if(!lines.length)return'';
    return '<section class="foc-family"><header class="foc-family-head"><div class="foc-family-title">'+esc(f.title)+'</div></header>'+lines.join('')+'</section>';
  }).filter(Boolean);
  panel().innerHTML='<section class="foc-hero"><div class="foc-toolbar"><button class="hbtn" onclick="openFocCycle(\''+esc(c.id)+'\')">← COVER WALL</button></div><div style="font:900 20px/1.1 \'Orbitron\',monospace;color:var(--text);margin-top:10px">Receive shipment · FOC '+esc(displayDate(c.foc_date))+'</div><div style="font:10px/1.6 var(--font-mono);color:var(--dim);margin-top:4px">Enter what actually arrived per cover -- pre-filled with what was ordered. Short-shipped a title? Lower the number. Paid customer copies are reserved first, oldest order first; anything left over becomes normal sellable in-stock inventory.</div></section>'+
    (rows.length?rows.join(''):'<div class="panel" style="padding:28px;text-align:center;color:var(--dim)">Nothing was ordered this week -- no store quantity and no paid customers on any cover.</div>')+
    (rows.length?'<div class="foc-toolbar" style="margin-top:12px"><button class="hbtn" style="color:var(--g)" onclick="confirmReceiveShipment()">CONFIRM RECEIVED</button></div><div id="foc-receive-status" style="font:10px var(--font-mono);color:var(--dim);margin-top:8px"></div>':'');
}
async function confirmReceiveShipment(){
  var status=document.getElementById('foc-receive-status');
  var lines=[];
  document.querySelectorAll('[data-receive-sku]').forEach(function(el){
    var qty=Math.max(0,parseInt(el.value,10)||0);
    if(qty>0)lines.push({skuId:el.dataset.receiveSku,receivedQty:qty});
  });
  if(!lines.length){toast_dash('Enter at least one received quantity');return;}
  if(status)status.textContent='Creating inventory…';
  try{
    var d=await api('/foc/admin/receive',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),cycleId:state.cycle.id,lines:lines})});
    toast_dash(d.createdInventoryCount+' item'+(d.createdInventoryCount===1?'':'s')+' added to inventory');
    var flagged=(d.receivedSummary||[]).filter(function(s){return s.shortShipped>0||s.incentiveNotReceived;});
    if(flagged.length){
      var report=flagged.map(function(s){
        var parts=[];
        if(s.shortShipped>0)parts.push('SHORT SHIPMENT: '+s.shortShipped+' (ordered '+s.orderedTotal+', received '+s.receivedQty+')');
        if(s.incentiveNotReceived)parts.push('INCENTIVE NOT RECEIVED');
        return s.title+(s.variantLabel?' -- '+s.variantLabel:'')+': '+parts.join(' · ');
      }).join('\n');
      alert('This shipment did not fully match what was ordered:\n\n'+report);
    }
    // Any eBay presale still holding unsold copies for this cycle can now
    // say "in stock" instead of "presale" -- best-effort, separate from the
    // receiving result itself so a listing hiccup here never looks like the
    // shipment failed to receive.
    try{
      var conv=await api('/foc/ebay/convert-to-instock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),cycleId:state.cycle.id})});
      if(conv.converted>0)toast_dash(conv.converted+' eBay presale listing'+(conv.converted===1?'':'s')+' switched to in stock');
      if(conv.failed&&conv.failed.length)toast_dash(conv.failed.length+' eBay listing'+(conv.failed.length===1?'':'s')+' could not be switched to in stock -- check the eBay tab');
    }catch(e){/* eBay not connected or similar -- receiving itself already succeeded, don't alarm over this */}
    await openCycle(state.cycle.id);
  }catch(e){if(status)status.textContent='';toast_dash('Could not receive shipment: '+e.message);}
}

// Review-before-publish for FOC eBay presale listings -- a straight
// prompt()-then-publish used to fire the real eBay listing immediately with
// no chance to fix the title/description/weight/etc first (store request:
// give a real edit step, same as the existing bulk eBay listing tool).
// /foc/ebay/presale-preview computes the same defaults the old hardcoded
// flow used to publish directly, but returns them for editing instead of
// listing anything; CREATE EBAY PRESALE below sends the edited fields back
// to /foc/ebay/create-presale, which still re-checks eligibility/price
// itself from the trusted DB row (see the Worker route's own comment).
async function openEbayPresaleReview(skuId){
  var host=panel();if(!host)return;
  var modalOld=document.getElementById('foc-ebay-review-modal');if(modalOld)modalOld.remove();
  var modal=document.createElement('div');
  modal.id='foc-ebay-review-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:24px 12px';
  modal.innerHTML='<div style="width:100%;max-width:560px;background:var(--surf);border:1px solid var(--border);border-radius:10px;padding:16px;font:11px/1.5 var(--font-mono);color:var(--text)">Loading presale listing preview…</div>';
  document.body.appendChild(modal);
  var preview;
  try{
    preview=await api('/foc/ebay/presale-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),skuId:skuId,quantity:1})});
  }catch(e){
    modal.querySelector('div').innerHTML='<div style="color:var(--red)">Could not load presale preview: '+esc(e.message)+'</div><button class="hbtn" style="margin-top:10px" onclick="document.getElementById(\'foc-ebay-review-modal\').remove()">CLOSE</button>';
    return;
  }
  var asp=preview.customAspects||{};
  // Store request: reuse the same {token} description-template settings the
  // regular "list on eBay" tool already has (Settings -> Vendor Info ->
  // EBAY LISTING SETTINGS -> the "Comic" template box), instead of always
  // publishing the hardcoded default description. The presale disclosure
  // line is always prepended regardless -- eBay's presale policy requires
  // it in the description (not just the title), and a store template that
  // doesn't happen to mention presale status must never silently drop it.
  var usedCustomTemplate=false;
  var description=preview.description;
  try{
    var vp=(typeof getVendorProfile==='function')?getVendorProfile():{};
    var templates=vp.ebayDescriptionTemplates||{};
    var customTemplate=templates.Comic||templates.default||'';
    if(customTemplate&&typeof renderEbayDescriptionTemplate==='function'){
      var presaleShippingLine=['For presale comics, orders ship promptly once the title reaches its official release date and inventory has been received from our distributor.',preview.onSaleLabel?('Release Date: '+preview.onSaleLabel):'','Publisher and distributor release dates may change. If a presale title is delayed, your order will ship as soon as the book becomes available.'].filter(Boolean).join('\n\n');
      var tokens={title:preview.baseTitle||preview.title.replace(/ - PRESALE$/,''),category:'Comic',price:preview.price,upc:preview.upc,
        variant:preview.variantLabel||'',releaseDate:preview.onSaleLabel||'',shippingLine:presaleShippingLine,
        publisher:asp.Publisher||'',writer:asp.Writer||'',artist:asp.Artist||'',coverArtist:asp['Cover Artist']||'',
        synopsis:preview.synopsis||'',condition:'New',quantity:'1'};
      var renderedBody=renderEbayDescriptionTemplate(customTemplate,tokens);
      if(renderedBody){
        // A store's saved Comic template can be plain text OR a hand-built
        // rich-HTML design (real <div>/<table> markup) -- the mandatory
        // presale disclosure this always prepends needs to match whichever
        // one it's about to sit next to, or the server's HTML formatter
        // (which only escapes/converts plain text, and otherwise passes
        // real HTML straight through untouched) treats the combined string
        // as one blob and gets it wrong for whichever half doesn't match.
        var isHtmlTemplate=/<\/?[a-z][\s\S]*>/i.test(customTemplate);
        var disclosure=isHtmlTemplate
          ? '<p>PRESALE -- This comic has not been released yet and is not currently in stock.</p><p>Expected on-sale/ship date: '+preview.onSaleLabel+'. Your order ships promptly once we receive stock from the distributor on or shortly after that date.</p>'
          : 'PRESALE -- This comic has not been released yet and is not currently in stock.\n\nExpected on-sale/ship date: '+preview.onSaleLabel+'. Your order ships promptly once we receive stock from the distributor on or shortly after that date.';
        description=disclosure+(isHtmlTemplate?'':'\n\n')+renderedBody;
        usedCustomTemplate=true;
      }
    }
  }catch(e){/* template rendering is best-effort -- fall back to the server default below */}
  // Remembers the last-typed eBay Seller Hub "Store category" (e.g. "Comic
  // Books") across listings so it only needs to be typed once, the same
  // last-used-value pattern the eBay shipping-label package picker already
  // uses. This is the seller's own custom storefront category, distinct
  // from the eBay item category (Comics & Graphic Novels) which is already
  // set correctly and not user-editable here.
  var lastStoreCategory='';
  try{lastStoreCategory=localStorage.getItem('foc_ebay_last_store_category')||'';}catch(e){}
  modal.innerHTML='<div style="width:100%;max-width:560px;background:var(--surf);border:1px solid var(--border);border-radius:10px;padding:16px">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><div style="font-family:\'Orbitron\',monospace;color:var(--gold);font-size:13px;letter-spacing:2px">REVIEW EBAY PRESALE LISTING</div><button onclick="document.getElementById(\'foc-ebay-review-modal\').remove()" style="background:none;border:none;color:var(--dim);font-size:22px;cursor:pointer">×</button></div>'+
    '<div style="font:9px var(--font-mono);color:var(--dim);margin-bottom:10px">Nothing is published to eBay until you click LIST ON EBAY below.</div>'+
    '<div style="display:grid;grid-template-columns:80px 1fr;gap:12px;margin-bottom:12px;align-items:start">'+
    (preview.imageUrl?'<img src="'+esc(preview.imageUrl)+'" style="width:80px;height:100px;object-fit:contain;background:#050507;border:1px solid var(--border);border-radius:6px">':'<div style="width:80px;height:100px;background:#050507;border:1px solid var(--border);border-radius:6px;display:flex;align-items:center;justify-content:center;color:var(--dim);font-size:9px">NO IMAGE</div>')+
    '<div><label style="font:9px var(--font-mono);color:var(--dim)">TITLE (eBay requires "PRESALE" disclosed here)</label>'+
    '<input id="foc-eb-title" maxlength="80" value="'+esc(preview.title)+'" style="width:100%;margin-top:4px;background:var(--surf2);border:1px solid var(--border);color:var(--text);padding:9px;border-radius:6px;font-size:12px;box-sizing:border-box">'+
    '<div id="foc-eb-title-count" style="font:8px var(--font-mono);color:var(--dim);text-align:right;margin-top:3px">'+preview.title.length+'/80</div></div></div>'+
    '<div class="foc-sku-fields" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:6px"><label>QUANTITY<input id="foc-eb-qty" class="tsi" type="number" min="1" max="200" value="10"></label>'+
    '<label>PRICE<input class="tsi" value="$'+esc(preview.price)+'" disabled></label>'+
    '<label>SHIP-BY<input class="tsi" value="'+esc(preview.onSaleLabel)+'" disabled></label></div>'+
    '<div style="font:8px/1.5 var(--font-mono);color:var(--dim);margin-bottom:10px">eBay handling time on this listing: <b style="color:var(--text)">'+Number(preview.handlingBusinessDays||0)+' business days</b> from purchase -- this is what keeps eBay\'s delivery estimate from promising the book before it\'s released.</div>'+
    '<label style="display:flex;gap:6px;align-items:center;margin-bottom:10px;font:9px var(--font-mono);color:var(--dim)"><input id="foc-eb-best-offer" type="checkbox" checked> ALLOW BEST OFFER</label>'+
    '<div class="foc-sku-fields" style="grid-template-columns:1fr 1fr;margin-bottom:10px"><label>PACKAGE WEIGHT<input id="foc-eb-weight" class="tsi" type="number" min=".1" step=".1" value="'+esc(preview.weightValue)+'"></label>'+
    '<label>UNIT<select id="foc-eb-weight-unit" class="tsi"><option value="POUND" '+(preview.weightUnit==='POUND'?'selected':'')+'>LB</option><option value="OUNCE" '+(preview.weightUnit==='OUNCE'?'selected':'')+'>OZ</option></select></label></div>'+
    '<div class="foc-sku-fields" style="grid-template-columns:1fr 1fr;margin-bottom:10px">'+
    ['Publisher','Writer','Artist','Cover Artist'].map(function(k){return '<label>'+k.toUpperCase()+'<input class="tsi" data-foc-eb-aspect="'+esc(k)+'" value="'+esc(asp[k]||'')+'"></label>';}).join('')+
    '</div>'+
    '<details style="margin-bottom:10px"><summary style="cursor:pointer;font:9px var(--font-mono);color:var(--dim)">MORE ITEM DETAILS (OPTIONAL -- feeds eBay item specifics, not just this description)</summary>'+
    '<div class="foc-sku-fields" style="grid-template-columns:1fr 1fr;margin-top:8px">'+
    [['Series','series'],['Character','character'],['Franchise','franchise'],['Edition','edition'],['Exclusive','exclusive'],['Cover Type','coverType']]
      .map(function(x){return '<label>'+x[0].toUpperCase()+'<input class="tsi" data-foc-eb-extra="'+esc(x[1])+'" data-foc-eb-extra-label="'+esc(x[0])+'"></label>';}).join('')+
    '</div>'+
    '<div class="foc-sku-fields" style="grid-template-columns:1fr 1fr;margin-top:8px">'+
    [['Key Issue','keyIssue'],['First Appearance','firstAppearance']]
      .map(function(x){return '<label>'+x[0].toUpperCase()+'<input class="tsi" data-foc-eb-extra="'+esc(x[1])+'" data-foc-eb-extra-label="'+esc(x[0])+'" placeholder="Only when verified for this book"></label>';}).join('')+
    '</div></details>'+
    '<label style="font:9px var(--font-mono);color:var(--dim);display:block;margin-bottom:10px">EBAY STORE CATEGORY (optional -- your Seller Hub \'Store category\', not the eBay item category)<input id="foc-eb-store-category" class="tsi" value="'+esc(lastStoreCategory)+'" placeholder="e.g. Comic Books" style="margin-top:4px"></label>'+
    '<div style="display:flex;justify-content:space-between;align-items:baseline"><label style="font:9px var(--font-mono);color:var(--dim)">DESCRIPTION</label>'+
    '<span style="font:8px var(--font-mono);color:var(--dim)">'+(usedCustomTemplate?'Using your saved Comic template (':'Using the built-in default (')+'<a href="#" onclick="openSettingsSection(\'profile\',\'vendor-profile-panel\');return false" style="color:var(--g)">edit in Settings → Vendor Info → EBAY LISTING SETTINGS</a>)</span></div>'+
    '<textarea id="foc-eb-desc" rows="6" style="width:100%;margin-top:4px;background:var(--surf2);border:1px solid var(--border);color:var(--text);padding:9px;border-radius:6px;box-sizing:border-box;resize:vertical;font-size:11px">'+esc(description)+'</textarea>'+
    '<div id="foc-eb-status" style="display:none;margin:10px 0;padding:10px;border-radius:6px;font-family:monospace;font-size:10px;text-align:center"></div>'+
    '<div style="display:flex;gap:8px;margin-top:12px"><button class="hbtn" style="flex:1;padding:12px;background:rgba(255,209,102,.12);border-color:rgba(255,209,102,.35);color:var(--gold)" onclick="submitEbayPresaleReview(\''+esc(skuId)+'\')">LIST ON EBAY</button>'+
    '<button class="hbtn" style="padding:12px" onclick="document.getElementById(\'foc-ebay-review-modal\').remove()">CANCEL</button></div>'+
    '</div>';
  var titleInput=document.getElementById('foc-eb-title');
  if(titleInput)titleInput.addEventListener('input',function(){document.getElementById('foc-eb-title-count').textContent=this.value.length+'/80';});
}
async function submitEbayPresaleReview(skuId){
  var status=document.getElementById('foc-eb-status');
  var qty=Math.max(1,Math.min(200,parseInt(document.getElementById('foc-eb-qty').value,10)||0));
  if(!qty){toast_dash('Enter a valid quantity');return;}
  var customAspects={};
  document.querySelectorAll('[data-foc-eb-aspect]').forEach(function(el){customAspects[el.dataset.focEbAspect]=el.value;});
  document.querySelectorAll('[data-foc-eb-extra]').forEach(function(el){if(el.value)customAspects[el.dataset.focEbExtraLabel]=el.value;});
  var storeCategory=(document.getElementById('foc-eb-store-category').value||'').trim();
  try{localStorage.setItem('foc_ebay_last_store_category',storeCategory);}catch(e){}
  var payload={
    storeId:getActiveStoreId(),skuId:skuId,quantity:qty,
    title:document.getElementById('foc-eb-title').value,
    description:document.getElementById('foc-eb-desc').value,
    customAspects:customAspects,
    bestOfferEnabled:document.getElementById('foc-eb-best-offer').checked,
    weightValue:parseFloat(document.getElementById('foc-eb-weight').value)||undefined,
    weightUnit:document.getElementById('foc-eb-weight-unit').value,
    storeCategoryNames:storeCategory?[storeCategory]:[],
  };
  if(status){status.style.display='block';status.style.color='var(--gold)';status.style.border='1px solid rgba(255,209,102,.25)';status.style.background='rgba(255,209,102,.06)';status.textContent='Publishing to eBay…';}
  try{
    var result=await api('/foc/ebay/create-presale',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    toast_dash('eBay presale listed: '+qty+' cop'+(qty===1?'y':'ies'));
    if(result.warnings&&result.warnings.length)toast_dash('eBay warning: '+result.warnings.join(' · '));
    if(result.volumeDiscount&&result.volumeDiscount.active){
      var tiers=(result.volumeDiscount.tiers||[]).map(function(t){return t.minQuantity+'+/'+t.percentageOff+'%';}).join(', ');
      toast_dash('Volume discount active: '+tiers);
    }
    var modal=document.getElementById('foc-ebay-review-modal');if(modal)modal.remove();
    await openCycle(state.cycle.id);
  }catch(e){
    if(status){status.style.color='var(--red)';status.style.borderColor='rgba(255,77,109,.3)';status.style.background='rgba(255,77,109,.06)';status.textContent='Could not create eBay presale: '+e.message;}
  }
}

// ═══════════════════════════════════════════════════════
// FINAL FOC REVIEW — the Monday screen: website + eBay + whatnot/store
// per cover, ratio-incentive progress per family, then lock the order.
// ═══════════════════════════════════════════════════════
function allFocSkus(){return state.families.reduce(function(a,f){return a.concat(f.variants);},[]);}
function focReviewLineHtml(v){
  var website=Number(v.customerQty||0),ebay=Number(v.ebayPresold||0),whatnot=Number(v.storeQuantity||0);
  var finalQty=website+ebay+whatnot;
  return '<div class="foc-sku-fields" style="grid-template-columns:2fr repeat(4,1fr);align-items:end;padding:8px;border-bottom:1px solid var(--border)">'+
    '<div><div style="font-weight:700;font-size:11px;color:var(--text)">'+esc(v.variantLabel)+'</div><div style="font:9px var(--font-mono);color:var(--dim)">UPC '+esc(v.upc)+'</div></div>'+
    '<label>WEBSITE<input class="tsi" value="'+website+'" disabled></label>'+
    '<label>EBAY<input class="tsi" value="'+ebay+'" disabled></label>'+
    '<label>WHATNOT/STORE<input class="tsi" type="number" min="0" value="'+whatnot+'" onchange="reviewStoreQtyChanged(\''+esc(v.id)+'\',this)"></label>'+
    '<label>FINAL PRH<input class="tsi" data-review-final="'+esc(v.id)+'" value="'+finalQty+'" disabled></label>'+
    '</div>';
}
function incentiveTrackerHtml(family){
  var incentives=family.variants.filter(function(v){return v.isIncentive;});
  if(!incentives.length)return'';
  var refCover=family.variants.filter(function(v){return !v.isIncentive;})[0];
  var refMsrp=refCover?Number(refCover.msrpCents||0):0;
  return '<div style="padding:8px;border-bottom:1px solid var(--border);background:rgba(255,209,102,.04)"><div style="font:9px var(--font-mono);color:var(--gold);margin-bottom:6px">RATIO INCENTIVES</div>'+incentives.map(function(v){
    var qual=v.qualification||{};var needed=Number(qual.needed||0);var costCents=Math.round(needed*refMsrp*0.5);
    return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 0;font:10px var(--font-mono)">'+
      '<span>'+esc(v.variantLabel)+' · '+esc(v.orderRequirement)+'</span>'+
      '<span style="color:'+(qual.qualified?'var(--g)':'var(--dim)')+'">'+Number(qual.total||0)+' / '+Number(qual.threshold||0)+(qual.qualified?' · QUALIFIED ✓':' · need '+needed+' more · ~$'+(costCents/100).toFixed(2)+' to unlock')+'</span>'+
    '</div>';
  }).join('')+'</div>';
}
function renderFocReview(){
  var c=state.cycle;if(!c)return;
  var allSkus=allFocSkus();
  var regular=allSkus.filter(function(v){return !v.isIncentive;});
  var totalWebsite=regular.reduce(function(s,v){return s+Number(v.customerQty||0);},0);
  var totalEbay=regular.reduce(function(s,v){return s+Number(v.ebayPresold||0);},0);
  var totalStore=regular.reduce(function(s,v){return s+Number(v.storeQuantity||0);},0);
  var totalUnits=totalWebsite+totalEbay+totalStore;
  var estCents=regular.reduce(function(s,v){return s+(Number(v.customerQty||0)+Number(v.ebayPresold||0)+Number(v.storeQuantity||0))*Math.round(Number(v.msrpCents||0)*0.5);},0);
  var incentivesAll=allSkus.filter(function(v){return v.isIncentive;});
  var qualifiedCount=incentivesAll.filter(function(v){return v.qualification&&v.qualification.qualified;}).length;
  var relevantFamilies=state.families.filter(function(f){
    return f.variants.some(function(v){return v.isIncentive;})||f.variants.some(function(v){return !v.isIncentive&&(Number(v.customerQty||0)+Number(v.ebayPresold||0)+Number(v.storeQuantity||0))>0;});
  });
  panel().innerHTML='<section class="foc-hero"><div class="foc-toolbar"><button class="hbtn" onclick="openFocCycle(\''+esc(c.id)+'\')">← COVER WALL</button><button class="hbtn" style="color:var(--g)" onclick="submitPrhOrder()">SUBMIT PRH ORDER</button></div>'+
    '<div style="font:900 20px/1.1 \'Orbitron\',monospace;color:var(--text);margin-top:10px">Final FOC Review · '+esc(displayDate(c.foc_date))+'</div>'+
    '<div class="foc-stats" style="margin-top:12px"><div class="foc-stat"><b>'+regular.length+'</b><span>SKUs</span></div><div class="foc-stat"><b>'+totalUnits+'</b><span>Total Units</span></div><div class="foc-stat"><b>$'+(estCents/100).toFixed(2)+'</b><span>Est. Wholesale</span></div><div class="foc-stat"><b>'+totalWebsite+'</b><span>Website Presold</span></div><div class="foc-stat"><b>'+totalEbay+'</b><span>eBay Presold</span></div><div class="foc-stat"><b>'+totalStore+'</b><span>Whatnot/Store</span></div><div class="foc-stat"><b>'+qualifiedCount+' / '+incentivesAll.length+'</b><span>Incentives Qualified</span></div></div>'+
    '<div id="foc-review-status" style="font:10px var(--font-mono);color:var(--dim);margin-top:8px">Checking submission status…</div></section>'+
    (relevantFamilies.length?relevantFamilies.map(function(f){
      return '<section class="foc-family"><header class="foc-family-head"><div class="foc-family-title">'+esc(f.title)+'</div></header>'+incentiveTrackerHtml(f)+f.variants.filter(function(v){return !v.isIncentive;}).map(focReviewLineHtml).join('')+'</section>';
    }).join(''):'<div class="panel" style="padding:28px;text-align:center;color:var(--dim)">Nothing was ordered or qualifying this week.</div>');
  loadPrhSubmissionStatus();
}
function openFocReview(){renderFocReview();}
async function reviewStoreQtyChanged(skuId,el){
  var val=Math.max(0,parseInt(el.value,10)||0);el.value=val;
  try{
    await api('/foc/admin/sku',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),skuId:skuId,storeQuantity:val})});
    var sku=allFocSkus().find(function(v){return v.id===skuId;});
    if(sku)sku.storeQuantity=val;
    var finalInput=document.querySelector('[data-review-final="'+CSS.escape(skuId)+'"]');
    if(finalInput&&sku)finalInput.value=Number(sku.customerQty||0)+Number(sku.ebayPresold||0)+val;
    toast_dash('Whatnot/store qty saved');
  }catch(e){toast_dash('Could not save: '+e.message);}
}
async function loadPrhSubmissionStatus(){
  var status=document.getElementById('foc-review-status');if(!status||!state.cycle)return;
  try{
    var d=await api('/foc/admin/prh-submission?store_id='+encodeURIComponent(getActiveStoreId())+'&cycle_id='+encodeURIComponent(state.cycle.id));
    if(d.submission){
      status.innerHTML='<b style="color:var(--g)">PRH ORDER SUBMITTED</b> '+new Date(d.submission.submitted_at).toLocaleString()+' · '+d.submission.total_units+' units · '+d.submission.total_skus+' SKUs · est. $'+(Number(d.submission.estimated_wholesale_cents||0)/100).toFixed(2)+' -- this is now locked and frozen regardless of later sales.';
      var submitBtn=document.querySelector('#foc-panels .foc-toolbar button[onclick="submitPrhOrder()"]');
      if(submitBtn){submitBtn.disabled=true;submitBtn.textContent='ALREADY SUBMITTED';}
    } else {
      status.textContent='';
    }
  }catch(e){status.textContent='';}
}
async function submitPrhOrder(){
  if(!state.cycle)return;
  if(!confirm('Submit the final PRH order for FOC '+displayDate(state.cycle.foc_date)+'? This locks the quantities as your official distributor order -- it cannot be re-submitted or changed afterward.'))return;
  var status=document.getElementById('foc-review-status');
  if(status)status.textContent='Submitting…';
  try{
    var d=await api('/foc/admin/prh-submission',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),cycleId:state.cycle.id})});
    toast_dash('PRH order submitted and locked: '+d.submission.total_units+' units across '+d.submission.total_skus+' SKUs');
    if(d.ebayWithdrawnCount>0)toast_dash(d.ebayWithdrawnCount+' unsold eBay presale listing'+(d.ebayWithdrawnCount===1?'':'s')+' ended -- no copies were ordered for '+(d.ebayWithdrawnCount===1?'it':'them'));
    await loadPrhSubmissionStatus();
  }catch(e){if(status)status.textContent='';toast_dash('Could not submit: '+e.message);}
}

async function loadEbaySafeDays(){
  try{
    var res=await storeWorkerFetch('/kv/comic_ebay_presale_safe_business_days');
    var data=await res.json().catch(function(){return{};});
    var input=document.getElementById('foc-ebay-safe-days');
    if(input&&data.value)input.value=data.value;
  }catch(e){}
}
async function saveEbaySafeDays(){
  var input=document.getElementById('foc-ebay-safe-days');
  var val=parseInt(input&&input.value,10);
  if(!val||val<1){toast_dash('Enter a positive number of business days');return;}
  try{
    await storeWorkerFetch('/kv/comic_ebay_presale_safe_business_days',{method:'POST',body:String(val)});
    toast_dash('eBay presale safety buffer saved: '+val+' business days');
  }catch(e){toast_dash('Could not save: '+e.message);}
}

async function loadShipping(){var host=document.getElementById('foc-shipping-settings');if(!host)return;host.textContent='Loading…';try{var d=await api('/foc/admin/shipping-settings?store_id='+encodeURIComponent(getActiveStoreId()));state.shipping=d.shipping||{};renderShipping();}catch(e){host.innerHTML='<span style="color:var(--red)">'+esc(e.message)+'</span>';}}
function renderShipping(){var s=state.shipping||{},f=s.from||{},p=s.parcel||{};document.getElementById('foc-shipping-settings').innerHTML='<div class="foc-import-report"><b style="color:'+(s.tokenConfigured?'var(--g)':'var(--gold)')+'">SHIPPO TOKEN '+(s.tokenConfigured?'CONNECTED':'NEEDS SETUP')+'</b><br>The API token stays in the Worker secret. This form stores only your ship-from address and package preset.</div><div class="foc-sku-fields" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-top:10px">'+[['name','Store / sender',f.name],['line1','Street',f.street1],['line2','Suite / unit',f.street2],['city','City',f.city],['state','State',f.state],['zip','ZIP',f.zip],['phone','Phone',f.phone],['email','Email',f.email]].map(function(x){return'<label>'+x[1]+'<input class="tsi" data-ship-from="'+x[0]+'" value="'+esc(x[2]||'')+'"></label>';}).join('')+'</div><div class="foc-sku-fields" style="grid-template-columns:repeat(4,minmax(0,1fr));margin-top:10px">'+[['length','Length',p.length||12],['width','Width',p.width||9],['height','Height',p.height||1],['weight','Weight lb',p.weight||1]].map(function(x){return'<label>'+x[1]+'<input class="tsi" type="number" min=".1" step=".1" data-ship-parcel="'+x[0]+'" value="'+esc(x[2])+'"></label>';}).join('')+'</div><button class="hbtn" style="margin-top:10px" onclick="saveFocShippingSettings()">SAVE LIVE SHIPPING SETUP</button>';}
async function saveShipping(){var shipFrom={},parcel={};document.querySelectorAll('[data-ship-from]').forEach(function(el){shipFrom[el.dataset.shipFrom]=el.value;});document.querySelectorAll('[data-ship-parcel]').forEach(function(el){parcel[el.dataset.shipParcel]=el.value;});try{var d=await api('/foc/admin/shipping-settings',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),enabled:true,shipFrom:shipFrom,defaultParcel:parcel})});state.shipping=d.shipping;toast_dash(d.shipping.tokenConfigured?'Live carrier settings saved':'Address saved — add the Shippo token to enable rates');renderShipping();}catch(e){toast_dash(e.message);}}

window.ensureFocPanel=function(){loadCycles(false);};window.loadFocCycles=loadCycles;window.openFocCycle=openCycle;window.handleFocImportFile=handleImport;window.filterFocAdmin=function(v){state.query=v;renderFamilies();};window.filterFocPublisher=function(v){state.publisher=v;renderFamilies();};window.filterFocFlag=function(v){state.flag=v;renderFamilies();};window.filterFocEbay=function(v){state.ebay=v;renderFamilies();};window.saveFocSku=saveSku;window.saveFocFamily=saveFamily;window.toggleFocCycle=toggleCycle;window.archiveFocCycle=archiveCycle;window.unarchiveFocCycle=unarchiveCycle;window.saveFocCycleCutoff=saveCutoff;window.exportFocPrh=exportPrh;window.loadFocShippingSettings=loadShipping;window.saveFocShippingSettings=saveShipping;window.openReceiveShipment=openReceiveShipment;window.confirmReceiveShipment=confirmReceiveShipment;window.createFocEbayPresale=openEbayPresaleReview;window.submitEbayPresaleReview=submitEbayPresaleReview;window.loadEbaySafeDays=loadEbaySafeDays;window.saveFocEbaySafeDays=saveEbaySafeDays;window.openFocReview=openFocReview;window.submitPrhOrder=submitPrhOrder;window.reviewStoreQtyChanged=reviewStoreQtyChanged;
})();
