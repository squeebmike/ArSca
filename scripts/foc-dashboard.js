(function(){
'use strict';

var state={loaded:false,cycles:[],cycle:null,families:[],query:'',publisher:'all',flag:'all',ebay:'all',saving:new Set(),shipping:null,distributor:'PRH'};

// Lunar's per-publisher account discount off retail (store's default/
// ongoing rate, not any time-limited new-account introductory rate). Staff-
// only estimate for the FOC Wall's "est. cost" line -- never sent to the
// customer-facing catalog, never persisted as comic_skus doesn't model
// acquisition cost at all. DC and Image are tiered by trailing invoiced
// spend rather than fixed, so those two are separately overridable below
// (LUNAR_DC/LUNAR_IMAGE settings key) instead of hardcoded here.
var LUNAR_PUBLISHER_DISCOUNTS={
  'abrams':50,'abstract studio':50,'ahoy':50,'archie comics publications':50,'asylum press':50,
  'avery hill publishing':50,'awa studios':50,'bad idea':50,'bad idea kickstarter':50,'bcw supplies':0,
  'black mask studios':50,'bulgilhan press':50,'cartoon books':50,'chronicle books':45,'church ghost':50,
  'clover press':50,'craniacs':35,'csn press':0,'drawn & quarterly':50,'dynamite entertainment':50,
  'ex posse holdings':50,'fantagraphics':50,'fantagraphics underground':45,'floating world comics':50,
  'gemstone publishing':50,'good trouble comics':50,'graphitti designs':40,'harpercollins':50,
  'hermes press':50,'ipi comics':50,'lab press':50,'mad cave studios':50,'magma comix':50,
  'manga classics':50,'massive publishing':50,'mcfarlane toys':40,'merc publishing':50,
  'nbm graphic novels':50,'off register press':50,'oni press':50,'pan-universal galactic':50,
  'papercutz':50,'pow pow press':50,'prana publishers':50,'rebellion publishing':50,'rekcah comics':50,
  'rocketship entertainment':50,'scholastic':45,'silver sprocket':50,'standards manual':50,
  'stranger comics':50,'strangers':50,'titan comics':50,'tripwire':50,'twisted comics':50,
  'twomorrows publishing':40,'udon entertainment':50,'uncivilized books':45,'vault comics':50,
  'wake entertainment':50,'z2':50,'zdarsco':0,'zombie love studios':50,'ablaze':50,'ataboy':0,
  'bliss on tap':50,'ps artbooks':35,'simon & schuster':50,'viz media':50,'yen press':50,
  'zenescope entertainment':50,
};
var lunarDcDiscount=35,lunarImageDiscount=40;
function lunarDiscountPct(publisher){
  var key=String(publisher||'').trim().toLowerCase();
  if(key==='dc comics')return lunarDcDiscount;
  if(key==='image comics')return lunarImageDiscount;
  return key in LUNAR_PUBLISHER_DISCOUNTS?LUNAR_PUBLISHER_DISCOUNTS[key]:null;
}
// null (unknown publisher, no rate on file) is left for the caller to
// render as "cost unknown" rather than silently assuming a 0% or 50% rate.
function lunarEstCostCents(v){
  var pctOff=lunarDiscountPct(v.publisher);
  return pctOff==null?null:Math.round(Number(v.msrpCents||0)*(1-pctOff/100));
}
// Per-review-modal snapshot of whatever the description template needs to
// be re-rendered with an AI paragraph slotted in (see focAiDescriptionCore
// below) -- keyed by skuId for the single-cover modal, familyId for the
// group one. Captured when each modal opens since the template/tokens are
// only computed as local vars inside those functions otherwise.
var focEbayAiState={};

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
    '<div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b class="foc-family-title">FOC '+esc(displayDate(c.foc_date))+'</b><span class="foc-badge '+esc(c.status)+'">'+esc(stateLabel)+'</span></div><div style="font:10px/1.6 var(--font-mono);color:var(--dim)">'+esc(c.source_filename||((c.distributor||'PRH')+' import'))+' · '+Number(c.source_row_count||0)+' SKUs · closes '+esc(displayDate(c.customer_cutoff_at))+' PT</div></div>'+
    '<div style="font:10px/1.5 var(--font-mono);color:var(--dim);text-align:right"><b style="color:var(--text)">'+Number(report.families||0)+'</b> title families<br><b style="color:var(--gold)">'+Number(report.incentives||0)+'</b> incentives</div></button>';
}

// PRH and Lunar are both real comics distributors (not "books vs comics" --
// PRH's own FOC test fixtures are Marvel single issues), kept as separate
// cycle lists sharing the one FOC Wall UI/checkout/export plumbing --
// distributor tabs pick which list is visible rather than interleaving both
// distributors' weeks together under a single "latest cycle" view.
function distributorTabs(){
  return '<div class="foc-toolbar" style="margin-top:10px">'+[['PRH','PRH'],['Lunar','LUNAR']].map(function(t){
    var active=state.distributor===t[0];
    return '<button class="hbtn" style="'+(active?'background:var(--purple);color:#fff;border-color:var(--purple)':'')+'" onclick="switchFocDistributor(\''+t[0]+'\')">'+t[1]+'</button>';
  }).join('')+'</div>';
}

function renderCycles(){
  var host=panel();if(!host)return;
  var isLunar=state.distributor==='Lunar';
  var visibleCycles=state.cycles.filter(function(c){return (c.distributor||'PRH')===state.distributor;});
  host.innerHTML='<section class="foc-hero"><div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap"><div><div style="font:900 22px/1.1 \'Orbitron\',monospace;color:var(--text)">THE FOC WALL</div><div style="font:10px/1.65 var(--font-mono);color:var(--dim);max-width:720px;margin-top:6px">'+(isLunar?'Upload Lunar\'s weekly comics FOC file, review exact covers, set shelf quantities, and export the clean order.':'Upload Monday\'s PRH metadata file, review exact covers, set shelf quantities, secure incentives, and export the clean UPC order.')+'</div>'+distributorTabs()+'</div><div class="foc-toolbar"><input type="file" id="foc-import-file" accept=".csv,.xlsx,.xls" hidden onchange="'+(isLunar?'handleLunarFocImportFile(event)':'handleFocImportFile(event)')+'"><button class="hbtn" onclick="document.getElementById(\'foc-import-file\').click()">'+(isLunar?'IMPORT LUNAR FOC':'IMPORT PRH FOC')+'</button><button class="hbtn" onclick="loadFocCycles(true)">REFRESH</button><button class="hbtn" style="color:var(--red)" title="Scans every past FOC cycle (not just the one you have open) for eBay presale listings nothing was actually ordered for" onclick="openOrphanedEbayScan()">FIND ORPHANED EBAY LISTINGS</button></div></div><div id="foc-import-status" class="foc-import-report" style="display:none"></div></section>'+
    '<details class="panel" style="margin-bottom:14px"><summary style="cursor:pointer;font-family:\'Orbitron\',monospace;color:var(--purple);font-size:11px">REAL SHIPPING SETUP</summary><div id="foc-shipping-settings" style="padding-top:12px"><button class="hbtn" onclick="loadFocShippingSettings()">LOAD SHIPPING SETTINGS</button></div></details>'+
    (isLunar?
      '<details class="panel" style="margin-bottom:14px" ontoggle="if(this.open)loadLunarDiscountSettings()"><summary style="cursor:pointer;font-family:\'Orbitron\',monospace;color:var(--purple);font-size:11px">LUNAR COST ESTIMATE SETTINGS</summary><div style="padding-top:12px;font:10px/1.6 var(--font-mono);color:var(--dim)">A staff-only estimate shown on each cover below -- never shown to customers, and not a substitute for your actual Lunar invoice. Every other publisher uses a fixed default discount; DC and Image are tiered by trailing spend and change over time, so those two stay editable here.<div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-top:8px"><label style="font:8px var(--font-mono);color:var(--dim)">DC DISCOUNT %<input id="foc-lunar-dc" class="tsi" type="number" min="0" max="90" value="'+lunarDcDiscount+'" style="width:80px"></label><label style="font:8px var(--font-mono);color:var(--dim)">IMAGE DISCOUNT %<input id="foc-lunar-image" class="tsi" type="number" min="0" max="90" value="'+lunarImageDiscount+'" style="width:80px"></label><button class="hbtn" onclick="saveLunarDiscountSettings()">SAVE</button></div></div></details>'
    :
      '<details class="panel" style="margin-bottom:14px" ontoggle="if(this.open)loadEbaySafeDays()"><summary style="cursor:pointer;font-family:\'Orbitron\',monospace;color:var(--purple);font-size:11px">EBAY PRESALE SETTINGS</summary><div style="padding-top:12px;font:10px/1.6 var(--font-mono);color:var(--dim)">Our internal safety buffer before FOC comics are eligible for eBay presale. eBay\'s own current policy limit is 40 business days from listing to ship -- keep this below that.<div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-top:8px"><label style="font:8px var(--font-mono);color:var(--dim)">SAFE BUSINESS-DAY BUFFER<input id="foc-ebay-safe-days" class="tsi" type="number" min="1" max="60" value="35" style="width:80px"></label><button class="hbtn" onclick="saveFocEbaySafeDays()">SAVE</button></div></div></details>'
    )+
    '<div class="ph">FOC CYCLES</div>'+(visibleCycles.length?visibleCycles.map(cycleCard).join(''):'<div class="panel" style="padding:30px;text-align:center;color:var(--dim)">No '+(isLunar?'Lunar':'PRH')+' FOC file has been imported yet.</div>');
}
function switchDistributor(d){state.distributor=d==='Lunar'?'Lunar':'PRH';renderCycles();}

// Store report: "we didn't order any Shredder #13 -- why is it still
// presale?" Every other eBay cleanup tool (PRH cart import's auto-sweep,
// END REMAINING EBAY LISTINGS) only ever looks at the ONE cycle currently
// open on screen -- a listing from an older, already-closed cycle (one
// that predates this reconciliation feature entirely, or that simply
// never got a final cleanup pass) is invisible to both. This scans every
// FOC eBay presale listing across every past cycle at once and cross-
// checks each against that cycle's own locked PRH order, so orphaned ones
// can be found and ended from one screen instead of reopening every old
// cycle by hand.
var focOrphanScanCycles=[];
async function openOrphanedEbayScan(){
  var modalOld=document.getElementById('foc-orphan-scan-modal');if(modalOld)modalOld.remove();
  var modal=document.createElement('div');
  modal.id='foc-orphan-scan-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:24px 12px';
  modal.innerHTML='<div style="width:100%;max-width:680px;background:var(--surf);border:1px solid var(--border);border-radius:10px;padding:16px">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div style="font-family:\'Orbitron\',monospace;color:var(--red);font-size:13px;letter-spacing:2px">ORPHANED EBAY LISTINGS</div><button onclick="document.getElementById(\'foc-orphan-scan-modal\').remove()" style="background:none;border:none;color:var(--dim);font-size:22px;cursor:pointer">×</button></div>'+
    '<div id="foc-orphan-scan-body" style="font:10px var(--font-mono);color:var(--dim);padding:20px 0;text-align:center">Scanning every past FOC cycle…</div></div>';
  document.body.appendChild(modal);
  try{
    var d=await api('/foc/admin/orphaned-ebay-listings?store_id='+encodeURIComponent(getActiveStoreId()));
    focOrphanScanCycles=d.cycles||[];
    renderOrphanedEbayScan(d.orphanedCount||0);
  }catch(e){
    var body=document.getElementById('foc-orphan-scan-body');
    if(body)body.innerHTML='<div style="color:var(--red)">Could not scan: '+esc(e.message)+'</div>';
  }
}
function orphanReasonBadge(reason){
  if(reason==='orphaned')return '<span class="foc-badge" style="color:var(--red);border-color:var(--red)">NOT ORDERED</span>';
  if(reason==='ordered')return '<span class="foc-badge" style="color:var(--g);border-color:var(--g)">ORDERED</span>';
  return '<span class="foc-badge" style="color:var(--gold);border-color:var(--gold)">NO PRH ORDER ON FILE</span>';
}
function renderOrphanedEbayScan(orphanedCount){
  var body=document.getElementById('foc-orphan-scan-body');if(!body)return;
  if(!focOrphanScanCycles.length){body.innerHTML='<div style="padding:10px 0">No live eBay presale listings outside your currently-open cycle -- nothing to clean up.</div>';return;}
  var totalListings=focOrphanScanCycles.reduce(function(s,c){return s+c.listings.length;},0);
  body.innerHTML='<div style="text-align:left;font:9px var(--font-mono);color:var(--dim);margin-bottom:10px">'+totalListings+' live listing'+(totalListings===1?'':'s')+' outside your currently-open cycle, across '+focOrphanScanCycles.length+' past cycle'+(focOrphanScanCycles.length===1?'':'s')+'. <b style="color:var(--red)">'+orphanedCount+' NOT ORDERED</b> (pre-checked below) -- nothing came from the distributor for these, they were just never ended. <span style="color:var(--gold)">NO PRH ORDER ON FILE</span> means that cycle closed without ever running SUBMIT PRH ORDER, so it can\'t be confirmed either way from data alone -- review those by hand.</div>'+
    '<div style="text-align:left;max-height:440px;overflow-y:auto;border-top:1px solid var(--border);padding-top:8px">'+
    focOrphanScanCycles.map(function(c){
      return '<div style="margin-bottom:14px"><div style="font-weight:800;color:var(--text);font-size:11px;margin-bottom:4px">FOC '+esc(displayDate(c.focDate))+' · '+(c.hasSubmission?'PRH order submitted':'never submitted')+'</div>'+
        c.listings.map(function(l){
          return '<label style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border);font:10px var(--font-mono);color:var(--text);cursor:pointer;opacity:'+(l.reason==='ordered'?'.6':'1')+'">'+
            '<input type="checkbox" class="foc-orphan-cb" value="'+esc(l.rowId)+'" '+(l.reason==='orphaned'?'checked':'')+'>'+
            '<span style="flex:1;min-width:0">'+esc(l.title||l.rowId)+(l.isBundle?' (bundle)':'')+'</span>'+
            orphanReasonBadge(l.reason)+
            '</label>';
        }).join('')+
      '</div>';
    }).join('')+
    '</div>'+
    '<div style="display:flex;gap:8px;margin-top:12px"><button class="hbtn" style="flex:1;padding:12px;background:rgba(255,77,109,.12);border-color:rgba(255,77,109,.35);color:var(--red)" onclick="endSelectedOrphanedEbayListings()">END SELECTED</button>'+
    '<button class="hbtn" style="padding:12px" onclick="document.getElementById(\'foc-orphan-scan-modal\').remove()">CLOSE</button></div>';
}
async function endSelectedOrphanedEbayListings(){
  var rowIds=Array.from(document.querySelectorAll('.foc-orphan-cb:checked')).map(function(cb){return cb.value;});
  if(!rowIds.length){toast_dash('Nothing selected');return;}
  if(!confirm('End '+rowIds.length+' eBay listing'+(rowIds.length===1?'':'s')+'? This cannot be undone.'))return;
  var body=document.getElementById('foc-orphan-scan-body');
  if(body)body.innerHTML='<div style="padding:20px 0;text-align:center">Ending '+rowIds.length+' listing'+(rowIds.length===1?'':'s')+'…</div>';
  try{
    var d=await api('/foc/admin/orphaned-ebay-listings/end',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),rowIds:rowIds})});
    toast_dash(d.endedCount+' listing'+(d.endedCount===1?'':'s')+' ended'+(d.failedCount?' · '+d.failedCount+' failed':''));
    await openOrphanedEbayScan();
  }catch(e){
    if(body)body.innerHTML='<div style="color:var(--red)">Could not end listings: '+esc(e.message)+'</div>';
  }
}

// Store report: "I imported the Lunar FOC and it didn't show images" --
// Lunar's real export embeds each cover as a picture object anchored
// directly to its row's cell (confirmed: clicking one of those cells shows
// a blank formula bar -- not a URL, not a =DISPIMG() cell-image formula
// either). SheetJS (the XLSX reader this app already uses) only ever reads
// cell VALUES; an anchored drawing object has no cell value at all, so it
// was structurally invisible to every FOC importer, not just missing a
// column name. An XLSX file is a zip archive underneath -- the real image
// bytes live in xl/media/*, anchored to a specific row via
// xl/drawings/drawingN.xml + its .rels relationship file (the standard
// OOXML DrawingML anchor format both Excel and Google Sheets write for a
// "picture in cell"). This reads that structure directly to recover what
// SheetJS cannot, returning a Map of 0-indexed SHEET row -> the image file
// found inside the zip for it.
async function extractXlsxCellImages(buffer){
  var byRow=new Map();
  if(typeof JSZip==='undefined')return byRow;
  var zip;
  try{zip=await JSZip.loadAsync(buffer);}catch(e){return byRow;}
  var drawingFiles=zip.file(/^xl\/drawings\/drawing\d+\.xml$/);
  var drawingFile=drawingFiles&&drawingFiles[0];
  if(!drawingFile)return byRow;
  var drawingName=drawingFile.name.split('/').pop();
  var drawingRelsFile=zip.file('xl/drawings/_rels/'+drawingName+'.rels');
  if(!drawingRelsFile)return byRow;
  var parser=new DOMParser();
  var drawingDoc,relsDoc;
  try{
    drawingDoc=parser.parseFromString(await drawingFile.async('text'),'application/xml');
    relsDoc=parser.parseFromString(await drawingRelsFile.async('text'),'application/xml');
  }catch(e){return byRow;}
  var targetById={};
  Array.from(relsDoc.getElementsByTagName('Relationship')).forEach(function(r){targetById[r.getAttribute('Id')]=r.getAttribute('Target');});
  var anchors=Array.from(drawingDoc.getElementsByTagName('xdr:twoCellAnchor')).concat(Array.from(drawingDoc.getElementsByTagName('xdr:oneCellAnchor')));
  var NS_R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  for(var i=0;i<anchors.length&&byRow.size<2000;i++){
    var fromEl=anchors[i].getElementsByTagName('xdr:from')[0];
    var rowEl=fromEl&&fromEl.getElementsByTagName('xdr:row')[0];
    if(!rowEl)continue;
    var row=parseInt(rowEl.textContent,10);
    if(!Number.isFinite(row)||byRow.has(row))continue; // first image anchored to a row wins
    var blip=anchors[i].getElementsByTagName('a:blip')[0];
    var embedId=blip&&(blip.getAttribute('r:embed')||blip.getAttributeNS(NS_R,'embed'));
    var target=embedId&&targetById[embedId];
    if(!target)continue;
    var mediaPath='xl/media/'+target.split('/').pop();
    var mediaFile=zip.file(mediaPath);
    if(!mediaFile)continue;
    byRow.set(row,{file:mediaFile,ext:(mediaPath.split('.').pop()||'jpg').toLowerCase()});
  }
  return byRow;
}
function xlsxImageContentType(ext){
  return ext==='png'?'image/png':ext==='gif'?'image/gif':ext==='webp'?'image/webp':ext==='bmp'?'image/bmp':'image/jpeg';
}
// Uploads every extracted cover to this store's own photo storage (same
// route the inventory photo editor already uses -- it just stores bytes
// under a key and hands back a real, permanently-hosted URL, with no
// other coupling to "inventory" specifically) so each cover gets a normal
// https:// URL comic_skus.cover_image_url already expects, instead of
// bytes trapped inside the uploaded spreadsheet. Small bounded concurrency
// (not fully sequential, not unbounded) keeps a few-hundred-cover file
// from taking minutes while not hammering the Worker with everything at
// once.
async function uploadExtractedCoverImages(imagesByRow,onProgress){
  var urlsByRow=new Map();
  var entries=Array.from(imagesByRow.entries());
  var next=0,done=0;
  async function worker(){
    while(next<entries.length){
      var idx=next++;
      var row=entries[idx][0],info=entries[idx][1];
      try{
        var blob=await info.file.async('blob');
        var res=await api('/inventory/photo/upload',{method:'POST',headers:{'Content-Type':xlsxImageContentType(info.ext)},body:blob});
        if(res&&res.url)urlsByRow.set(row,res.url);
      }catch(e){ /* skip this one cover -- the rest of the import still proceeds */ }
      done++;if(onProgress)onProgress(done,entries.length);
    }
  }
  await Promise.all(Array.from({length:Math.min(4,entries.length)},worker));
  return urlsByRow;
}

// Shared by both distributors' file pickers -- reading/hashing the sheet and
// reporting the import result back is identical either way; only the header
// fingerprint that confirms "this is really a <distributor> FOC file" and
// the import route's distributor query param differ.
async function handleFocFileImport(event,config){
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
    var headerIndex=matrix.findIndex(function(row){var values=row.map(function(v){return String(v).trim();});return config.matchesHeader(values);});
    if(headerIndex<0)throw new Error('This does not look like a '+config.label+' FOC metadata CSV/XLSX');
    var rows=XLSX.utils.sheet_to_json(sheet,{range:headerIndex,defval:'',raw:false});if(!rows.length)throw new Error('No '+config.label+' rows found');
    var hashBuffer=await crypto.subtle.digest('SHA-256',buffer);var sourceSha256=Array.from(new Uint8Array(hashBuffer)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
    if(config.extractCellImages){
      if(status)status.textContent='Looking for cover images embedded in the file…';
      var imagesByRow=await extractXlsxCellImages(buffer);
      if(imagesByRow.size){
        var uploadedByRow=await uploadExtractedCoverImages(imagesByRow,function(done,total){if(status)status.textContent='Uploading cover images… '+done+' of '+total;});
        // sheet_to_json({range:headerIndex,...}) starts data at the row right
        // after the header -- rows[i] is always sheet row (headerIndex+1+i),
        // 0-indexed the same way the drawing anchors above are.
        rows.forEach(function(row,i){var url=uploadedByRow.get(headerIndex+1+i);if(url)row.CoverLink=url;});
        if(status)status.textContent='Matched '+uploadedByRow.size+' embedded cover'+(uploadedByRow.size===1?'':'s')+' to their rows. Importing and grouping title families…';
      }
    }
    if(status)status.textContent='Found '+rows.length+' exact cover SKUs. Importing and grouping title families…';
    var result=await api('/foc/admin/import'+config.query,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceFilename:file.name,sourceSha256:sourceSha256,rows:rows})});
    var r=result.report||{};if(status)status.innerHTML='<b style="color:var(--g)">'+(result.duplicate?'Already imported — no duplicates created.':'Import complete.')+'</b><br>'+Number(r.processed||0)+' rows processed · '+Number(r.families||0)+' title families · '+Number(r.newSkus||0)+' new · '+Number(r.updatedSkus||0)+' updated · '+Number(r.unchanged||0)+' unchanged · '+Number(r.incentives||0)+' incentives';
    state.loaded=false;await loadCycles(true);await openCycle(result.cycleId);
  }catch(e){if(status){status.style.display='block';status.innerHTML='<b style="color:var(--red)">Import failed:</b> '+esc(e.message);}}
}
function handleImport(event){
  return handleFocFileImport(event,{label:'PRH',query:'',matchesHeader:function(values){return values.indexOf('MainIdentifier')>-1&&values.indexOf('Title')>-1&&(values.indexOf('FOCDate')>-1||values.indexOf('FOC Date')>-1);}});
}
function handleLunarImport(event){
  return handleFocFileImport(event,{label:'Lunar',query:'?distributor=Lunar',extractCellImages:true,matchesHeader:function(values){return values.indexOf('ProductCode')>-1&&values.indexOf('Title')>-1&&values.indexOf('FinalOrderCutoff')>-1;}});
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
  //
  // Store report (later): listing a single cover on eBay -- or saving any
  // one field on a cover card -- reset the search box and every filter
  // dropdown back to "All" and jumped the whole wall back to the top, since
  // every one of those actions calls openCycle(state.cycle.id) just to
  // refresh the data. That's still the SAME cycle, not a switch to a
  // different one, so the filter-clearing above (which only needs to guard
  // against a stale filter surviving a real cycle switch) doesn't apply --
  // only reset filters when actually opening a different cycle.
  // Bulk eBay selections/queue are sku ids scoped to whatever cycle they
  // were picked from -- carrying them into a different cycle would try to
  // review skus that don't belong to it. Same cycle-switch-only guard as
  // the filter reset above.
  if(!state.cycle||state.cycle.id!==id){state.query='';state.publisher='all';state.flag='all';state.ebay='all';focEbayBulkSelectedIds.clear();focEbayBulkQueue=null;focPublishBulkSelectedIds.clear();}
  try{var data=await api('/foc/admin/cycles?store_id='+encodeURIComponent(getActiveStoreId())+'&cycle_id='+encodeURIComponent(id));state.cycle=data.cycle;state.families=data.families||[];renderCycle();}
  catch(e){panel().innerHTML='<button class="hbtn" onclick="loadFocCycles()">BACK</button><div class="panel" style="margin-top:10px;color:var(--red)">'+esc(e.message)+'</div>';}
}
// Same refetch as openCycle, for actions that only changed ONE cover within
// the cycle already open (a field save, an eBay listing) -- openCycle's own
// renderCycle() rebuilds the ENTIRE panel (hero, toolbar, filters, family
// list) from scratch, which resets scroll position back to the top of the
// wall regardless of the filter fix above. Re-rendering only the family
// list (renderFamilies, which already respects whatever filters are
// currently set) leaves the toolbar and scroll position alone.
async function refreshCycleFamilies(){
  if(!state.cycle)return;
  try{var data=await api('/foc/admin/cycles?store_id='+encodeURIComponent(getActiveStoreId())+'&cycle_id='+encodeURIComponent(state.cycle.id));state.cycle=data.cycle;state.families=data.families||[];renderFamilies();}
  catch(e){toast_dash('Could not refresh: '+e.message);}
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
// Selections are tracked here (not just read off checkbox DOM state) so
// checking covers, then a filter/search change re-renders the family list
// and scrolls some out of view, doesn't silently lose them -- same pattern
// the regular inventory eBay bulk-listing tool already uses.
var focEbayBulkSelectedIds=new Set();
function focEbayBulkCheckboxChanged(cb){if(cb.checked)focEbayBulkSelectedIds.add(cb.value);else focEbayBulkSelectedIds.delete(cb.value);renderFocEbayBulkCount();}
function toggleFocEbayBulkSelectAll(checked){
  document.querySelectorAll('.foc-ebay-bulk-cb').forEach(function(cb){cb.checked=checked;if(checked)focEbayBulkSelectedIds.add(cb.value);else focEbayBulkSelectedIds.delete(cb.value);});
  renderFocEbayBulkCount();
}
function renderFocEbayBulkCount(){
  var el=document.getElementById('foc-ebay-bulk-count');if(!el)return;
  var eligible=0;state.families.forEach(function(f){f.variants.forEach(function(v){if(v.ebayPresaleStatus==='ELIGIBLE_NOW')eligible++;});});
  el.textContent=eligible+' eligible'+(focEbayBulkSelectedIds.size?' · '+focEbayBulkSelectedIds.size+' selected':'');
}

// Bulk website-visibility toggle -- a weekly import can be hundreds of
// covers; flipping "SHOW TO CUSTOMERS" per-cover doesn't scale. Same
// selection-tracked-outside-the-DOM pattern as the eBay bulk tool above,
// scoped to the SKUs currently visible under whatever filters are active
// (SELECT ALL VISIBLE, not SELECT ALL IN CYCLE) so a search/filter narrows
// what "select all" means the same way it narrows what's on screen.
var focPublishBulkSelectedIds=new Set();
function focPublishBulkCheckboxChanged(cb){if(cb.checked)focPublishBulkSelectedIds.add(cb.value);else focPublishBulkSelectedIds.delete(cb.value);renderFocPublishBulkCount();}
function toggleFocPublishBulkSelectAll(checked){
  document.querySelectorAll('.foc-publish-bulk-cb').forEach(function(cb){cb.checked=checked;if(checked)focPublishBulkSelectedIds.add(cb.value);else focPublishBulkSelectedIds.delete(cb.value);});
  renderFocPublishBulkCount();
}
function renderFocPublishBulkCount(){
  var el=document.getElementById('foc-publish-bulk-count');if(!el)return;
  el.textContent=focPublishBulkSelectedIds.size?focPublishBulkSelectedIds.size+' selected':'Nothing selected';
}
async function bulkSetCustomerEnabled(customerEnabled){
  var ids=Array.from(focPublishBulkSelectedIds);
  if(!ids.length){toast_dash('Select at least one cover first');return;}
  try{
    var result=await api('/foc/admin/sku',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),skuIds:ids,customerEnabled:customerEnabled})});
    toast_dash(Number(result.updated||0)+' cover'+(result.updated===1?'':'s')+(customerEnabled?' published to the website':' hidden from the website'));
    focPublishBulkSelectedIds.clear();
    await refreshCycleFamilies();
  }catch(e){toast_dash('Bulk update failed: '+e.message);}
}
// Store idea: a live eBay presale listing whose on-sale date has already
// passed isn't caught by anything today -- ebayPresaleStatus flips to
// RELEASED (presale semantics no longer apply, per ebayPresaleFields in
// foc-preorders.mjs) but nothing stops the listing itself from staying
// live and still selling copies of a book that's now overdue. This
// surfaces exactly those, plus SKUs eBay can't even schedule (no on-sale
// date on file), so they don't sit unnoticed until a customer asks where
// their book is.
function focEbayHealthIssues(){
  var released=[],missingDate=[],needsPhotoRepair=[];
  var seenGroupKeys={};
  allFocSkus().forEach(function(v){
    if(v.ebayPresaleStatus==='RELEASED'&&Number(v.ebayAvailable||0)>0)released.push(v);
    else if(v.ebayPresaleStatus==='ACTION_REQUIRED'&&v.ebayPresaleNote)missingDate.push(v);
    // Store idea: the photo-binding repair for multi-cover group listings
    // (see repairFocEbayGroupPhotos below) is a manual, blind "run it and
    // see" button -- nothing ever told staff WHICH live group listings
    // actually still needed it. A group listing that has never been
    // through that repair (ebayGroupPhotosRepairedAt unset) is flagged
    // here, once per distinct group key, so it doesn't sit unnoticed.
    if((v.ebayPresaleStatus==='LISTED'||v.ebayPresaleStatus==='SOLD_OUT')&&v.ebayInventoryItemGroupKey&&!v.ebayGroupPhotosRepairedAt&&!seenGroupKeys[v.ebayInventoryItemGroupKey]){
      seenGroupKeys[v.ebayInventoryItemGroupKey]=true;
      needsPhotoRepair.push(v);
    }
  });
  return {released:released,missingDate:missingDate,needsPhotoRepair:needsPhotoRepair};
}
function focEbayHealthPanelHtml(){
  var issues=focEbayHealthIssues();
  var total=issues.released.length+issues.missingDate.length+issues.needsPhotoRepair.length;
  if(!total)return'';
  var rows=issues.released.map(function(v){
    return '<div style="padding:6px 0;border-bottom:1px solid var(--border);font:10px var(--font-mono)"><b style="color:var(--gold)">⚠ '+esc(v.title||v.variantLabel)+'</b> -- on-sale date passed but still live on eBay with '+Number(v.ebayAvailable||0)+' available. Receive the shipment or end the listing.</div>';
  }).concat(issues.missingDate.map(function(v){
    return '<div style="padding:6px 0;border-bottom:1px solid var(--border);font:10px var(--font-mono)"><b style="color:var(--red)">⚠ '+esc(v.title||v.variantLabel)+'</b> -- '+esc(v.ebayPresaleNote)+'.</div>';
  })).concat(issues.needsPhotoRepair.map(function(v){
    return '<div style="padding:6px 0;border-bottom:1px solid var(--border);font:10px var(--font-mono)"><b style="color:var(--gold)">⚠ '+esc(v.title||v.variantLabel)+'</b> -- multi-cover eBay listing has never had its per-cover photo binding verified. Run REPAIR LISTING PHOTOS below.</div>';
  })).join('');
  return '<div class="panel" style="margin-bottom:12px;padding:10px 14px">'+
    '<div style="font:900 11px \'Orbitron\',monospace;color:var(--gold);letter-spacing:1px;margin-bottom:6px">⚠ EBAY LISTING HEALTH ('+total+')</div>'+
    rows+'</div>';
}
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
  if(status==='ELIGIBLE_NOW')action='<label style="display:flex;align-items:center;gap:6px;margin-top:6px;font:9px var(--font-mono);color:var(--dim);cursor:pointer"><input type="checkbox" class="foc-ebay-bulk-cb" value="'+esc(v.id)+'" '+(focEbayBulkSelectedIds.has(v.id)?'checked':'')+' onchange="focEbayBulkCheckboxChanged(this)"> SELECT FOR BULK LISTING</label><button class="hbtn" style="margin-top:6px;width:100%;min-height:30px;font-size:9px" onclick="createFocEbayPresale(\''+esc(v.id)+'\')">CREATE EBAY PRESALE</button>';
  else if(status==='LISTED')action='<button class="hbtn" style="margin-top:6px;width:100%;min-height:30px;font-size:9px" onclick="createFocEbayPresale(\''+esc(v.id)+'\')">LIST MORE ON EBAY</button>';
  return '<div style="margin-top:8px;padding-top:7px;border-top:1px solid var(--border)">'+badge+(detail?'<div style="font:8px/1.5 var(--font-mono);color:var(--dim);margin-top:4px">'+esc(detail)+'</div>':'')+action+'</div>';
}
function lunarCostLine(v){
  if(v.distributor!=='Lunar')return'';
  var costCents=lunarEstCostCents(v);
  return '<div style="font:9px/1.5 var(--font-mono);color:var(--dim)">Est. cost '+(costCents==null?'unknown ('+esc(v.publisher||'no publisher')+' not on file)':money(costCents)+' ('+(lunarDiscountPct(v.publisher))+'% off '+money(v.msrpCents)+')')+'</div>';
}
function skuCard(v){
  var total=Number(v.customerQty||0)+Number(v.storeQuantity||0);var qual=v.qualification||{};var save="saveFocSku('"+esc(v.id)+"')";
  return '<article class="foc-sku '+(v.isIncentive?'incentive':'')+'" data-foc-sku="'+esc(v.id)+'">'+
    '<label style="display:flex;align-items:center;gap:6px;margin-bottom:6px;font:8px var(--font-mono);color:var(--dim);cursor:pointer"><input type="checkbox" class="foc-publish-bulk-cb" value="'+esc(v.id)+'" '+(focPublishBulkSelectedIds.has(v.id)?'checked':'')+' onchange="focPublishBulkCheckboxChanged(this)"> SELECT</label>'+
    (v.coverImageUrl?'<img src="'+esc(v.coverImageUrl)+'" alt="'+esc(v.variantLabel)+'" loading="lazy" onerror="this.style.opacity=.16">':'<div style="aspect-ratio:2/3;display:grid;place-items:center;background:var(--surf2);color:var(--dim);border-radius:7px">NO COVER</div>')+
    '<div style="margin-top:8px;font-weight:800;font-size:11px;line-height:1.35;color:var(--text)">'+esc(v.variantLabel)+'</div><div style="font:9px/1.5 var(--font-mono);color:var(--dim)">'+esc(v.coverArtist||'Cover artist not listed')+'<br>UPC '+esc(v.upc)+'</div>'+lunarCostLine(v)+
    ((v.isIncentive||v.isFoil)?'<div style="margin-top:7px;display:flex;gap:5px;flex-wrap:wrap">'+(v.isIncentive?'<span class="foc-badge incentive">INCENTIVE '+esc(v.orderRequirement)+'</span>':'')+(v.isFoil?'<span class="foc-badge">FOIL · PRICE SEPARATELY</span>':'')+'</div>':'')+
    (v.isIncentive?'<div class="foc-progress"><i style="width:'+pct(qual.total,qual.threshold)+'%"></i></div><div style="font:8px/1.4 var(--font-mono);color:'+(qual.qualified?'var(--g)':'var(--gold)')+'">'+Number(qual.total||0)+' / '+Number(qual.threshold||0)+(qual.qualified?' · QUALIFIED':' · '+Number(qual.needed||0)+' MORE TO UNLOCK')+' · '+Number(v.waitlistRequests||0)+' WAITLISTED</div>':'')+
    '<div class="foc-sku-fields"><label>CUSTOMERS<input class="tsi" value="'+Number(v.customerQty||0)+'" disabled></label><label>STORE QTY<input class="tsi" data-field="storeQuantity" type="number" min="0" value="'+Number(v.storeQuantity||0)+'" onchange="'+save+'"></label><label>'+(v.isIncentive?'SELL PRICE · REQUIRED':(v.isFoil?'FOIL SELL PRICE':'CUSTOMER PRICE'))+'<input class="tsi" data-field="customerPrice" type="number" min="0" step=".01" value="'+(Number(v.priceCents||0)/100).toFixed(2)+'" onchange="'+save+'"></label><label>'+(v.isIncentive?'SECURED QTY':'TOTAL ORDER')+'<input class="tsi" '+(v.isIncentive?'data-field="securedQuantity" type="number" min="0" onchange="'+save+'" value="'+Number(v.securedQuantity||0)+'"':'disabled value="'+total+'"')+'></label><label>SAFETY STOCK<input class="tsi" data-field="safetyStockQty" type="number" min="0" value="'+Number(v.safetyStockQty||0)+'" onchange="'+save+'"></label></div>'+
    '<label style="display:block;margin-top:7px;font:8px var(--font-mono);color:var(--dim)">COVER IMAGE URL'+(v.distributor==='Lunar'?' (Lunar\'s feed has none -- paste one from the publisher\'s solicitation or your Lunar account)':'')+'<input class="tsi" data-field="coverImageUrl" type="url" placeholder="https://…" value="'+esc(v.coverImageUrl||'')+'" onchange="'+save+'" style="margin-top:3px"></label>'+
    (v.isIncentive&&!Number(v.priceCents||0)?'<div style="font:8px/1.45 var(--font-mono);color:var(--gold);margin-top:6px">REQUEST-ONLY UNTIL BOTH SECURED QTY AND SELL PRICE ARE SET</div>':'')+
    '<label style="display:flex;gap:6px;align-items:center;margin-top:7px;font:8px var(--font-mono);color:var(--dim)"><input data-field="customerEnabled" type="checkbox" '+(v.customerEnabled!==false?'checked':'')+' onchange="'+save+'"> SHOW TO CUSTOMERS</label>'+
    '<button class="hbtn" style="margin-top:7px;width:100%;min-height:28px;font-size:9px" onclick="quickAddFocSkuToInventory(\''+esc(v.id)+'\')">+ ADD TO INVENTORY</button>'+
    ebaySection(v)+'</article>';
}

function familyCard(f){
  var groupListBtn=(f.variants||[]).length>=2?'<button class="hbtn" style="font-size:8px;color:var(--gold)" onclick="openFamilyEbayGroupReview(\''+esc(f.id)+'\')" title="List every cover of this title as one eBay listing with a native Cover variation dropdown">LIST ALL COVERS · 1 EBAY LISTING</button>':'';
  return '<section class="foc-family"><header class="foc-family-head"><div><div class="foc-family-title">'+esc(f.title)+'</div><div style="font:9px/1.55 var(--font-mono);color:var(--dim)">'+esc([f.publisher,f.writer?'W: '+f.writer:'',f.interiorArtist?'A: '+f.interiorArtist:'',f.onSaleDate?'On sale '+displayDate(f.onSaleDate):''].filter(Boolean).join(' · '))+'</div></div><div class="foc-toolbar">'+groupListBtn+'<label style="font:8px var(--font-mono);color:var(--dim)">HEAT <select class="tsi" data-family-heat="'+esc(f.id)+'" onchange="saveFocFamily(\''+esc(f.id)+'\')"><option value="">—</option>'+[1,2,3,4,5].map(function(n){return'<option '+(Number(f.heat)===n?'selected':'')+'>'+n+'</option>';}).join('')+'</select></label><label style="font:8px var(--font-mono);color:var(--dim)">FLAG <select class="tsi" data-family-category="'+esc(f.id)+'" onchange="saveFocFamily(\''+esc(f.id)+'\')"><option value="">None</option>'+[['dont_sleep',"DON\'T SLEEP"],['sleeper_watch','SLEEPER WATCH'],['solid_stock','SOLID STOCK'],['special_order','SPECIAL ORDER'],['pass','PASS']].map(function(x){return'<option value="'+x[0]+'" '+(f.heatCategory===x[0]?'selected':'')+'>'+x[1]+'</option>';}).join('')+'</select></label></div></header><div class="foc-sku-grid">'+f.variants.map(skuCard).join('')+'</div></section>';
}

function renderCycle(){
  var c=state.cycle;if(!c)return;var publishers=Array.from(new Set(state.families.map(function(f){return f.publisher;}).filter(Boolean))).sort();var allSkus=state.families.reduce(function(a,f){return a.concat(f.variants);},[]);var customerQty=allSkus.reduce(function(s,v){return s+Number(v.customerQty||0);},0);var storeQty=allSkus.reduce(function(s,v){return s+Number(v.storeQuantity||0);},0);var incentiveReq=allSkus.reduce(function(s,v){return s+Number(v.waitlistRequests||0);},0);
  panel().innerHTML='<section class="foc-hero"><div class="foc-toolbar"><button class="hbtn" onclick="loadFocCycles()">← CYCLES</button><button class="hbtn" style="color:var(--purple)" onclick="openFocReview()">FINAL FOC REVIEW</button><button class="hbtn" style="color:var(--blue)" onclick="openFocIntelligence()">🧠 FOC INTELLIGENCE</button>'+(c.distributor==="Lunar"?"":"<button class=\"hbtn\" onclick=\"exportFocPrh()\">EXPORT PRH ORDER</button>")+'<button class="hbtn" style="color:var(--g)" onclick="openReceiveShipment()">RECEIVE SHIPMENT</button>'+(c.status!=='archived'?'<button class="hbtn" onclick="toggleFocCycle()">'+(c.isOpen?'LOCK ORDERS':'UNLOCK ORDERS')+'</button>':'')+(c.status==='archived'?'<button class="hbtn" onclick="unarchiveFocCycle()">SHOW ON SITE (LOCKED)</button>':'<button class="hbtn danger" onclick="archiveFocCycle()">HIDE FROM SITE</button>')+'<a class="hbtn" href="https://themanapocket.com/preorders?cycle='+encodeURIComponent(c.foc_date)+'" target="_blank" rel="noopener" style="text-decoration:none">VIEW CUSTOMER PAGE</a></div><div style="display:flex;justify-content:space-between;gap:12px;align-items:end;flex-wrap:wrap;margin-top:14px"><div><div style="font:900 22px/1.1 \'Orbitron\',monospace;color:var(--text)">FOC '+esc(displayDate(c.foc_date))+'</div><div style="font:10px/1.6 var(--font-mono);color:var(--dim)">'+esc(c.source_filename||(c.distributor||'PRH'))+' · '+(c.status==='archived'?'HIDDEN FROM SITE':(c.isOpen?'UNLOCKED FOR ORDERS':'VISIBLE BUT LOCKED'))+'</div></div><label style="font:8px var(--font-mono);color:var(--dim)">CUSTOMER CUTOFF · PACIFIC<input id="foc-cycle-cutoff" class="tsi" type="datetime-local" value="'+esc(pacificDateTimeInput(c.customer_cutoff_at))+'" onchange="saveFocCycleCutoff()" style="margin:3px 0 0"><span style="display:block;margin-top:4px">Set a future cutoff before unlocking an expired FOC.</span></label></div><div class="foc-stats"><div class="foc-stat"><b>'+allSkus.length+'</b><span>Exact cover SKUs</span></div><div class="foc-stat"><b>'+state.families.length+'</b><span>Title families</span></div><div class="foc-stat"><b>'+customerQty+'</b><span>Customer copies</span></div><div class="foc-stat"><b>'+storeQty+'</b><span>Store copies</span></div><div class="foc-stat"><b>'+incentiveReq+'</b><span>Incentive requests</span></div></div></section>'+focEbayHealthPanelHtml()+'<div class="panel foc-toolbar" style="margin-bottom:12px"><input id="foc-admin-search" class="tsi" placeholder="Search title, writer, artist…" value="'+esc(state.query)+'" oninput="filterFocAdmin(this.value)"><select class="tsi" onchange="filterFocPublisher(this.value)"><option value="all" '+(state.publisher==='all'?'selected':'')+'>All publishers</option>'+publishers.map(function(p){return'<option value="'+esc(p.toLowerCase())+'" '+(state.publisher===p.toLowerCase()?'selected':'')+'>'+esc(p)+'</option>';}).join('')+'</select><select class="tsi" onchange="filterFocFlag(this.value)"><option value="all" '+(state.flag==='all'?'selected':'')+'>All comics</option><option value="first" '+(state.flag==='first'?'selected':'')+'>#1 issues</option><option value="foil" '+(state.flag==='foil'?'selected':'')+'>Foil covers</option><option value="incentive" '+(state.flag==='incentive'?'selected':'')+'>Incentives</option><option value="demand" '+(state.flag==='demand'?'selected':'')+'>Customer demand</option></select><select class="tsi" onchange="filterFocEbay(this.value)"><option value="all" '+(state.ebay==='all'?'selected':'')+'>All eBay statuses</option><option value="ELIGIBLE_NOW" '+(state.ebay==='ELIGIBLE_NOW'?'selected':'')+'>Eligible, not listed</option><option value="TOO_EARLY" '+(state.ebay==='TOO_EARLY'?'selected':'')+'>Too early</option><option value="LISTED" '+(state.ebay==='LISTED'?'selected':'')+'>Already listed</option><option value="SOLD_OUT" '+(state.ebay==='SOLD_OUT'?'selected':'')+'>Presale sold out</option><option value="RELEASED" '+(state.ebay==='RELEASED'?'selected':'')+'>Released (on sale)</option><option value="ACTION_REQUIRED" '+(state.ebay==='ACTION_REQUIRED'?'selected':'')+'>Action required</option></select><span id="foc-visible-count" style="font:9px var(--font-mono);color:var(--dim)"></span></div>'+
    // Store request: listing eligible FOC covers on eBay one at a time
    // (open the review modal, edit, LIST, close, find the next one, repeat)
    // was too much clicking for a whole cycle's worth of ratio/incentive
    // books. Check the ones to list (or SELECT ALL ELIGIBLE), then LIST
    // SELECTED opens the exact same single-cover review-and-edit modal
    // already trusted for one-at-a-time listings, just chained: submitting
    // one automatically opens the next selected cover's review instead of
    // just closing, until the queue is empty.
    '<div class="panel foc-toolbar" style="margin-bottom:12px"><button class="hbtn" onclick="toggleFocEbayBulkSelectAll(true)">SELECT ALL ELIGIBLE</button><button class="hbtn" onclick="toggleFocEbayBulkSelectAll(false)">SELECT NONE</button><button class="hbtn" style="background:rgba(255,209,102,.12);border-color:rgba(255,209,102,.35);color:var(--gold)" onclick="startFocEbayBulkListing()">LIST SELECTED ON EBAY</button><span id="foc-ebay-bulk-count" style="font:9px var(--font-mono);color:var(--dim)"></span></div>'+
    '<div class="panel foc-toolbar" style="margin-bottom:12px"><button class="hbtn" onclick="toggleFocPublishBulkSelectAll(true)">SELECT ALL VISIBLE COVERS</button><button class="hbtn" onclick="toggleFocPublishBulkSelectAll(false)">SELECT NONE</button><button class="hbtn" style="background:rgba(120,220,150,.12);border-color:rgba(120,220,150,.35);color:var(--g)" onclick="bulkSetCustomerEnabled(true)">SHOW SELECTED ON WEBSITE</button><button class="hbtn" onclick="bulkSetCustomerEnabled(false)">HIDE SELECTED FROM WEBSITE</button><span id="foc-publish-bulk-count" style="font:9px var(--font-mono);color:var(--dim)"></span></div>'+
    '<div id="foc-family-list"></div>';
  renderFamilies();
}

function renderFamilies(){var list=document.getElementById('foc-family-list');if(!list)return;var rows=visibleFamilies();var count=document.getElementById('foc-visible-count');if(count)count.textContent=rows.length+' title families';list.innerHTML=rows.length?rows.map(familyCard).join(''):'<div class="panel" style="padding:28px;text-align:center;color:var(--dim)">Nothing matches those filters.</div>';renderFocEbayBulkCount();renderFocPublishBulkCount();}

async function saveSku(id){var card=document.querySelector('[data-foc-sku="'+CSS.escape(id)+'"]');if(!card||state.saving.has(id))return;state.saving.add(id);try{var payload={storeId:getActiveStoreId(),skuId:id};card.querySelectorAll('[data-field]').forEach(function(el){payload[el.dataset.field]=el.type==='checkbox'?el.checked:el.value;});await api('/foc/admin/sku',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});toast_dash('FOC cover saved');await refreshCycleFamilies();}catch(e){toast_dash('Could not save cover: '+e.message);}finally{state.saving.delete(id);}}
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
      if(conv.shippingPolicyWarning)toast_dash(conv.shippingPolicyWarning);
    }catch(e){/* eBay not connected or similar -- receiving itself already succeeded, don't alarm over this */}
    await openCycle(state.cycle.id);
  }catch(e){if(status)status.textContent='';toast_dash('Could not receive shipment: '+e.message);}
}
// Store report: no way existed to add a single book straight to inventory
// from the cover wall -- RECEIVE SHIPMENT only lists covers that were
// actually ordered (customerQty+storeQuantity>0), and only as a bulk,
// whole-cycle action, requiring a separate screen. This reuses the same
// trusted /foc/admin/receive path (paid-customer reservation first, real
// inventory_items rows, FOC linkage) for just the one cover clicked, so a
// spot-received extra copy or an off-order book still gets tracked
// correctly instead of a manual Inventory-tab add that skips FOC linkage
// and preorder reservation entirely.
async function quickAddFocSkuToInventory(skuId){
  if(!state.cycle)return;
  var qtyStr=prompt('How many copies to add to inventory?','1');
  if(qtyStr==null)return;
  var qty=Math.max(0,parseInt(qtyStr,10)||0);
  if(!qty){toast_dash('Enter a quantity greater than 0');return;}
  try{
    var d=await api('/foc/admin/receive',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),cycleId:state.cycle.id,lines:[{skuId:skuId,receivedQty:qty}]})});
    toast_dash(d.createdInventoryCount+' item'+(d.createdInventoryCount===1?'':'s')+' added to inventory');
    var flagged=(d.receivedSummary||[]).filter(function(s){return s.shortShipped>0||s.incentiveNotReceived;});
    if(flagged.length){
      var report=flagged.map(function(s){
        var parts=[];
        if(s.shortShipped>0)parts.push('SHORT SHIPMENT: '+s.shortShipped+' (ordered '+s.orderedTotal+', received '+s.receivedQty+')');
        if(s.incentiveNotReceived)parts.push('INCENTIVE NOT RECEIVED');
        return s.title+(s.variantLabel?' -- '+s.variantLabel:'')+': '+parts.join(' · ');
      }).join('\n');
      alert('This did not fully match what was ordered:\n\n'+report);
    }
    try{
      var conv=await api('/foc/ebay/convert-to-instock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),cycleId:state.cycle.id})});
      if(conv.converted>0)toast_dash(conv.converted+' eBay presale listing'+(conv.converted===1?'':'s')+' switched to in stock');
      if(conv.shippingPolicyWarning)toast_dash(conv.shippingPolicyWarning);
    }catch(e){/* eBay not connected or similar -- the add itself already succeeded, don't alarm over this */}
    await openCycle(state.cycle.id);
  }catch(e){toast_dash('Could not add to inventory: '+e.message);}
}

// Store request: listing eligible FOC covers on eBay one at a time (open
// the review modal, edit, LIST, close, find the next one, repeat) was too
// much clicking for a whole cycle's worth of ratio/incentive books.
// focEbayBulkQueue holds the remaining sku ids still to review -- null
// means no bulk run is active, so the review modal and its submit handler
// below behave exactly as they always did for a single-cover listing.
// Reuses that same single-cover review-and-edit modal for every step
// instead of a separate bulk UI, so each cover still gets the identical
// review/edit chance a one-off listing gets -- only the "what happens after
// LIST ON EBAY" step changes, from closing to opening the next one.
var focEbayBulkQueue=null;
function startFocEbayBulkListing(){
  var ids=Array.from(focEbayBulkSelectedIds);
  if(!ids.length){toast_dash('Select at least one eligible cover first');return;}
  focEbayBulkQueue=ids;
  focEbayBulkAdvance();
}
// LIST THESE ON EBAY button on the "still needs an eBay listing" panel --
// loads every currently-eligible, not-yet-listed cover with leftover stock
// straight into the same bulk queue the manual checkbox picker above
// builds, so it's the identical one-at-a-time review-then-list flow instead
// of a second, separate listing path.
function startFocNeedsListingBulk(){
  var ids=allFocSkus().filter(function(v){return v.ebayPresaleStatus==='ELIGIBLE_NOW'&&Number(v.storeQuantity||0)>0;}).map(function(v){return v.id;});
  if(!ids.length){toast_dash('Nothing currently needs a new eBay listing');return;}
  focEbayBulkSelectedIds=new Set(ids);
  renderFocEbayBulkCount();
  startFocEbayBulkListing();
}
function focEbayBulkAdvance(){
  if(!focEbayBulkQueue||!focEbayBulkQueue.length){focEbayBulkQueue=null;return;}
  var next=focEbayBulkQueue.shift();
  focEbayBulkSelectedIds.delete(next);
  renderFocEbayBulkCount();
  openEbayPresaleReview(next);
}
// The × close button during a bulk run stops the whole run (not just this
// one cover) -- whatever's left in the queue stays selected, so LIST
// SELECTED ON EBAY picks up right where it left off instead of losing the
// rest of the batch.
function cancelFocEbayBulkListing(){
  var remaining=focEbayBulkQueue?focEbayBulkQueue.length:0;
  focEbayBulkQueue=null;
  var modal=document.getElementById('foc-ebay-review-modal');if(modal)modal.remove();
  if(remaining)toast_dash(remaining+' cover'+(remaining===1?'':'s')+' still selected -- LIST SELECTED ON EBAY again to resume');
}
// Move to the next cover in the queue WITHOUT listing this one -- distinct
// from the × close button, which stops the whole run.
function skipFocEbayBulkItem(){
  if(!focEbayBulkQueue){var modal=document.getElementById('foc-ebay-review-modal');if(modal)modal.remove();return;}
  focEbayBulkAdvance();
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
  // Store report: shipping kept landing on the wrong policy no matter how
  // the auto-detect guess (matching on "presale" in the name) got tuned --
  // it broke again every time the account had more than one plausible
  // match. Store decision: FOC listings no longer auto-detect a shipping
  // policy AT ALL -- the store must explicitly pick one here every time
  // (submitEbayPresaleReview below refuses to publish without a real
  // selection), remembered across listings the same way the store
  // category field already is, so picking it once is normally enough.
  // Best-effort fetch -- a failure to load the policy list here must never
  // block the review modal itself, it just leaves nothing to pick from
  // until the store retries (never silently falls back to a guess).
  var shipPolicies=[];
  var shipPoliciesError='';
  try{
    var policyData=await api('/ebay/business-policies');
    if(policyData.needsToken)shipPoliciesError='eBay is not connected -- connect it under Settings → EBAY to pick a shipping policy here.';
    else if(policyData.fulfillment&&policyData.fulfillment.error)shipPoliciesError=policyData.fulfillment.error;
    // Store report: picking a policy here and it still not applying --
    // the unfiltered list includes this feature's OWN previously-created
    // "<base name> - FOC <n>D Handling" clones alongside their real base
    // policy (e.g. both "PreSale Paid Shipping" and "PreSale Paid Shipping
    // - FOC 40D Handling" show up), and picking the clone by mistake (an
    // easy thing to do -- it's right there, and it's the one already
    // visibly in use on eBay) makes the server clone FROM the clone,
    // producing a new, different, wrong policy instead of reusing the
    // real one. The server's own resolveFocPresaleBasePolicyId already
    // excludes its own clones from candidacy for exactly this reason
    // (see FOC_HANDLING_CLONE_NAME_RE in cloudflare-worker-full.js) --
    // mirrored here so the picker only ever offers real base policies.
    var FOC_HANDLING_CLONE_NAME_RE=/-\s*FOC\s+\d+D\s+Handling\s*$/i;
    shipPolicies=((policyData.fulfillment&&policyData.fulfillment.policies)||[]).filter(function(p){return !FOC_HANDLING_CLONE_NAME_RE.test(p.name||'');});
  }catch(e){shipPoliciesError=e.message||'request failed';}
  var lastShipPolicyId='';
  try{lastShipPolicyId=localStorage.getItem('foc_ebay_last_ship_policy_id')||'';}catch(e){}
  if(lastShipPolicyId&&!shipPolicies.some(function(p){return String(p.id)===lastShipPolicyId;}))lastShipPolicyId='';
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
      var isHtmlTemplate=/<\/?[a-z][\s\S]*>/i.test(customTemplate);
      var presaleShippingLine=['For presale comics, orders ship promptly once the title reaches its official release date and inventory has been received from our distributor.',preview.onSaleLabel?('Release Date: '+preview.onSaleLabel):'','Publisher and distributor release dates may change. If a presale title is delayed, your order will ship as soon as the book becomes available.'].filter(Boolean).join('\n\n');
      // Single-cover listing has no dropdown of covers to choose from, so
      // there's nothing to offer here -- an empty token lets a shared
      // template's "[[...{coverChoices}...]]" cover-picker section vanish
      // cleanly (see renderEbayDescriptionTemplate's [[...]] handling)
      // instead of showing a "CHOOSE YOUR COVER" section with one option.
      var tokens={title:preview.baseTitle||preview.title.replace(/ - PRESALE$/,''),category:'Comic',price:preview.price,upc:preview.upc,
        variant:preview.variantLabel||'',releaseDate:preview.onSaleLabel||'',shippingLine:presaleShippingLine,coverChoices:'',
        publisher:asp.Publisher||'',writer:asp.Writer||'',artist:asp.Artist||'',coverArtist:asp['Cover Artist']||'',
        synopsis:preview.synopsis||'',condition:'New',quantity:'1'};
      var renderedBody=renderEbayDescriptionTemplate(customTemplate,tokens);
      if(renderedBody){
        // Store report (live listing screenshot): a store's own branded
        // template -- one that already opens with its own prominent
        // "PRESALE -- releases <date>" banner, or that renders the
        // {shippingLine} token (whose own wording already says "presale")
        // -- still got ANOTHER, differently-styled presale paragraph
        // stacked on top of it, because this used to prepend the mandatory
        // disclosure unconditionally. eBay's policy only requires presale
        // status disclosed somewhere in the description, not disclosed
        // twice -- checking the RENDERED body (after token substitution,
        // so a template that pulls it in only via {shippingLine} still
        // counts) is what decides whether the fallback plain-text version
        // below is still needed at all.
        var templateAlreadyDisclosesPresale=/presale/i.test(renderedBody);
        var disclosure=templateAlreadyDisclosesPresale?'':(isHtmlTemplate
          ? '<p>PRESALE -- This comic has not been released yet and is not currently in stock.</p><p>Expected on-sale/ship date: '+preview.onSaleLabel+'. Your order ships promptly once we receive stock from the distributor on or shortly after that date.</p>'
          : 'PRESALE -- This comic has not been released yet and is not currently in stock.\n\nExpected on-sale/ship date: '+preview.onSaleLabel+'. Your order ships promptly once we receive stock from the distributor on or shortly after that date.');
        description=disclosure+(disclosure&&!isHtmlTemplate?'\n\n':'')+renderedBody;
        usedCustomTemplate=true;
      }
    }
  }catch(e){/* template rendering is best-effort -- fall back to the server default below */}
  focEbayAiState[skuId]={
    title:preview.baseTitle||preview.title.replace(/ - PRESALE$/,''),
    template:(typeof customTemplate!=='undefined')?customTemplate:'',
    tokens:(typeof tokens!=='undefined')?tokens:null,
    isHtmlTemplate:(typeof isHtmlTemplate!=='undefined')?isHtmlTemplate:false,
    disclosure:(typeof disclosure!=='undefined')?disclosure:'',
    synopsis:preview.synopsis||'',
    publisher:asp.Publisher||'',writer:asp.Writer||'',artist:asp.Artist||'',coverArtist:asp['Cover Artist']||''
  };
  // Remembers the last-typed eBay Seller Hub "Store category" (e.g. "Comic
  // Books") across listings so it only needs to be typed once, the same
  // last-used-value pattern the eBay shipping-label package picker already
  // uses. This is the seller's own custom storefront category, distinct
  // from the eBay item category (Comics & Graphic Novels) which is already
  // set correctly and not user-editable here.
  // Store report: this field silently submitted empty (storeCategoryNames:[]
  // on the eBay offer) on a fresh browser/device with nothing remembered
  // yet -- eBay then bucketed the listing into its own default "Other"
  // store category instead of Comic Books. Every FOC listing this feature
  // creates is a comic, so "Comic Books" is the real default, not an
  // empty string that merely LOOKS pre-filled via a placeholder.
  var lastStoreCategory='Comic Books';
  try{lastStoreCategory=localStorage.getItem('foc_ebay_last_store_category')||'Comic Books';}catch(e){}
  modal.innerHTML='<div style="width:100%;max-width:560px;background:var(--surf);border:1px solid var(--border);border-radius:10px;padding:16px">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><div><div style="font-family:\'Orbitron\',monospace;color:var(--gold);font-size:13px;letter-spacing:2px">REVIEW EBAY PRESALE LISTING</div>'+(focEbayBulkQueue?'<div style="font:9px var(--font-mono);color:var(--dim);margin-top:3px">Bulk listing -- '+focEbayBulkQueue.length+' more after this one · <button type="button" onclick="skipFocEbayBulkItem()" style="background:none;border:none;color:var(--gold);text-decoration:underline;cursor:pointer;font:inherit;padding:0">SKIP THIS ONE</button></div>':'')+'</div><button onclick="cancelFocEbayBulkListing()" style="background:none;border:none;color:var(--dim);font-size:22px;cursor:pointer">×</button></div>'+
    '<div style="font:9px var(--font-mono);color:var(--dim);margin-bottom:10px">Nothing is published to eBay until you click LIST ON EBAY below.'+(focEbayBulkQueue?' The next selected cover opens automatically after this one lists.':'')+'</div>'+
    '<div style="display:grid;grid-template-columns:80px 1fr;gap:12px;margin-bottom:12px;align-items:start">'+
    (preview.imageUrl?'<img src="'+esc(preview.imageUrl)+'" style="width:80px;height:100px;object-fit:contain;background:#050507;border:1px solid var(--border);border-radius:6px">':'<div style="width:80px;height:100px;background:#050507;border:1px solid var(--border);border-radius:6px;display:flex;align-items:center;justify-content:center;color:var(--dim);font-size:9px">NO IMAGE</div>')+
    '<div><label style="font:9px var(--font-mono);color:var(--dim)">TITLE (eBay requires "PRESALE" disclosed here)</label>'+
    '<input id="foc-eb-title" maxlength="80" value="'+esc(preview.title)+'" style="width:100%;margin-top:4px;background:var(--surf2);border:1px solid var(--border);color:var(--text);padding:9px;border-radius:6px;font-size:12px;box-sizing:border-box">'+
    '<div id="foc-eb-title-count" style="font:8px var(--font-mono);color:var(--dim);text-align:right;margin-top:3px">'+preview.title.length+'/80</div></div></div>'+
    '<div class="foc-sku-fields" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:6px"><label>QUANTITY<input id="foc-eb-qty" class="tsi" type="number" min="1" max="200" value="10"></label>'+
    '<label>PRICE<input class="tsi" value="$'+esc(preview.price)+'" disabled></label>'+
    '<label>SHIP-BY<input class="tsi" value="'+esc(preview.onSaleLabel)+'" disabled></label></div>'+
    '<div style="font:8px/1.5 var(--font-mono);color:var(--dim);margin-bottom:10px">eBay handling time on this listing: <b style="color:var(--text)">'+Number(preview.handlingBusinessDays||0)+' business days</b> from purchase -- this is what keeps eBay\'s delivery estimate from promising the book before it\'s released.</div>'+
    '<label style="font:9px var(--font-mono);color:var(--dim);display:block;margin-bottom:10px">SHIPPING POLICY TO CLONE HANDLING TIME FROM (required -- never auto-detected)'+
    '<select id="foc-eb-ship-policy" class="tsi" style="margin-top:4px">'+
    (lastShipPolicyId?'':'<option value="" disabled selected>-- select a shipping policy --</option>')+
    shipPolicies.map(function(p){return '<option value="'+esc(p.id)+'" '+(String(p.id)===lastShipPolicyId?'selected':'')+'>'+esc(p.name)+'</option>';}).join('')+
    '</select>'+
    (shipPolicies.length?'':'<div style="font:8px var(--font-mono);color:var(--red);margin-top:3px">Could not load your eBay shipping policies'+(shipPoliciesError?(': '+esc(shipPoliciesError)):'')+' -- reload this screen before publishing.</div>')+
    '</label>'+
    '<label style="display:flex;gap:6px;align-items:center;margin-bottom:10px;font:9px var(--font-mono);color:var(--dim)"><input id="foc-eb-best-offer" type="checkbox" checked> ALLOW BEST OFFER</label>'+
    '<div class="foc-sku-fields" style="grid-template-columns:1fr 1fr;margin-bottom:10px"><label>PACKAGE WEIGHT<input id="foc-eb-weight" class="tsi" type="number" min=".1" step=".1" value="'+esc(preview.weightValue)+'"></label>'+
    '<label>UNIT<select id="foc-eb-weight-unit" class="tsi"><option value="POUND" '+(preview.weightUnit==='POUND'?'selected':'')+'>LB</option><option value="OUNCE" '+(preview.weightUnit==='OUNCE'?'selected':'')+'>OZ</option></select></label></div>'+
    '<div class="foc-sku-fields" style="grid-template-columns:1fr 1fr;margin-bottom:10px">'+
    // Store report (live listing screenshot): "Series Title" showed up
    // blank on eBay's own item specifics page -- shown here alongside the
    // other real, eBay-recognized aspects (not buried in the MORE ITEM
    // DETAILS section below) since it's now a real server-computed default
    // (comic_title_families.series_name), same as Publisher/Writer/Artist.
    ['Publisher','Writer','Artist','Cover Artist','Series Title'].map(function(k){return '<label>'+k.toUpperCase()+'<input class="tsi" data-foc-eb-aspect="'+esc(k)+'" value="'+esc(asp[k]||'')+'"></label>';}).join('')+
    '</div>'+
    '<details style="margin-bottom:10px"><summary style="cursor:pointer;font:9px var(--font-mono);color:var(--dim)">MORE ITEM DETAILS (OPTIONAL -- feeds eBay item specifics, not just this description)</summary>'+
    '<div class="foc-sku-fields" style="grid-template-columns:1fr 1fr;margin-top:8px">'+
    [['Series','series'],['Character','character'],['Genre','genre'],['Format','format'],['Franchise','franchise'],['Edition','edition'],['Exclusive','exclusive'],['Cover Type','coverType']]
      .map(function(x){return '<label>'+x[0].toUpperCase()+'<input class="tsi" data-foc-eb-extra="'+esc(x[1])+'" data-foc-eb-extra-label="'+esc(x[0])+'"></label>';}).join('')+
    '</div>'+
    '<div class="foc-sku-fields" style="grid-template-columns:1fr 1fr;margin-top:8px">'+
    [['Key Issue','keyIssue'],['First Appearance','firstAppearance']]
      .map(function(x){return '<label>'+x[0].toUpperCase()+'<input class="tsi" data-foc-eb-extra="'+esc(x[1])+'" data-foc-eb-extra-label="'+esc(x[0])+'" placeholder="Only when verified for this book"></label>';}).join('')+
    '</div></details>'+
    '<label style="font:9px var(--font-mono);color:var(--dim);display:block;margin-bottom:10px">EBAY STORE CATEGORY (optional -- your Seller Hub \'Store category\', not the eBay item category)<input id="foc-eb-store-category" class="tsi" value="'+esc(lastStoreCategory)+'" placeholder="e.g. Comic Books" style="margin-top:4px"></label>'+
    '<div style="display:flex;justify-content:space-between;align-items:baseline"><label style="font:9px var(--font-mono);color:var(--dim)">DESCRIPTION</label>'+
    '<div style="display:flex;align-items:center;gap:8px">'+
    '<button type="button" class="hbtn" style="padding:4px 8px;font-size:9px" onclick="generateFocAiDescription(\''+esc(skuId)+'\')">✨ AI DESCRIPTION</button>'+
    '<span style="font:8px var(--font-mono);color:var(--dim)">'+(usedCustomTemplate?'Using your saved Comic template (':'Using the built-in default (')+'<a href="#" onclick="openSettingsSection(\'profile\',\'vendor-profile-panel\');return false" style="color:var(--g)">edit in Settings → Vendor Info → EBAY LISTING SETTINGS</a>)</span></div></div>'+
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
  var basePolicyId=(document.getElementById('foc-eb-ship-policy')?.value||'').trim();
  // Store decision: FOC listings never auto-detect a shipping policy --
  // publishing without an explicit pick here must be blocked, not silently
  // fall back to the server's old name-matching guess (the repeated
  // source of wrong-policy incidents this picker replaced).
  if(!basePolicyId){toast_dash('Select a shipping policy before publishing');return;}
  try{localStorage.setItem('foc_ebay_last_ship_policy_id',basePolicyId);}catch(e){}
  var payload={
    storeId:getActiveStoreId(),skuId:skuId,quantity:qty,
    title:document.getElementById('foc-eb-title').value,
    description:document.getElementById('foc-eb-desc').value,
    customAspects:customAspects,
    bestOfferEnabled:document.getElementById('foc-eb-best-offer').checked,
    weightValue:parseFloat(document.getElementById('foc-eb-weight').value)||undefined,
    weightUnit:document.getElementById('foc-eb-weight-unit').value,
    storeCategoryNames:storeCategory?[storeCategory]:[],
    basePolicyId:basePolicyId,
  };
  if(status){status.style.display='block';status.style.color='var(--gold)';status.style.border='1px solid rgba(255,209,102,.25)';status.style.background='rgba(255,209,102,.06)';status.textContent='Publishing to eBay…';}
  try{
    var result=await api('/foc/ebay/create-presale',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    toast_dash('eBay presale listed: '+qty+' cop'+(qty===1?'y':'ies'));
    if(result.warnings&&result.warnings.length)toast_dash('eBay warning: '+result.warnings.join(' · '));
    // Store report: shipping still not landing on the picked policy with
    // no warning shown -- createAndPublishEbayListing already computes and
    // verifies this (fulfillmentCheck), it just never reached the screen.
    // Surfaced explicitly so a wrong/empty result is visible immediately
    // instead of only discoverable by clicking into the live eBay listing.
    if(result.fulfillmentCheck){
      var fc=result.fulfillmentCheck;
      if(!fc.requestedId)toast_dash('Shipping policy warning: nothing was actually requested on this listing -- check the picker selection.');
      else if(fc.verifiedStoredId&&fc.verifiedStoredId!==fc.requestedId)toast_dash('Shipping policy warning: eBay stored a different policy ('+fc.verifiedStoredId+') than requested ('+fc.requestedId+').');
    }
    if(result.volumeDiscount&&result.volumeDiscount.active){
      var tiers=(result.volumeDiscount.tiers||[]).map(function(t){return t.minQuantity+'+/'+t.percentageOff+'%';}).join(', ');
      toast_dash('Volume discount active: '+tiers);
    }
    var modal=document.getElementById('foc-ebay-review-modal');if(modal)modal.remove();
    await refreshCycleFamilies();
    // Bulk run in progress: open the next selected cover's review instead
    // of just closing. A listing failure below deliberately leaves the
    // modal open on this cover (rather than skipping ahead) so a real
    // problem (bad title, missing weight, etc) gets fixed here instead of
    // silently skipping the whole rest of the batch.
    if(focEbayBulkQueue){
      if(focEbayBulkQueue.length)focEbayBulkAdvance();
      else{focEbayBulkQueue=null;toast_dash('Bulk eBay listing complete');}
    }
  }catch(e){
    if(status){status.style.color='var(--red)';status.style.borderColor='rgba(255,77,109,.3)';status.style.background='rgba(255,77,109,.06)';status.textContent='Could not create eBay presale: '+e.message;}
  }
}

// Store request: "how do I list it like that" (a real competitor listing
// showing one eBay page with a "Cover: Select" dropdown -- Cover A / Cover
// B / Cover C / "All Covers Bundle") instead of running one separate
// listing per cover, which openEbayPresaleReview above still does one cover
// at a time. This lists every checked cover of ONE title as a single eBay
// listing using eBay's native multi-variation format -- see
// createAndPublishEbayVariationListing / /foc/ebay/create-presale-group in
// cloudflare-worker-full.js for the mechanics. Mirrors openEbayPresaleReview's
// preview-then-edit-then-submit shape, just for the whole family at once.
async function openFamilyEbayGroupReview(familyId){
  var host=panel();if(!host)return;
  var modalOld=document.getElementById('foc-ebay-group-modal');if(modalOld)modalOld.remove();
  var modal=document.createElement('div');
  modal.id='foc-ebay-group-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:24px 12px';
  modal.innerHTML='<div style="width:100%;max-width:640px;background:var(--surf);border:1px solid var(--border);border-radius:10px;padding:16px;font:11px/1.5 var(--font-mono);color:var(--text)">Loading covers…</div>';
  document.body.appendChild(modal);
  var preview;
  try{
    preview=await api('/foc/ebay/presale-group-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),familyId:familyId})});
  }catch(e){
    modal.querySelector('div').innerHTML='<div style="color:var(--red)">Could not load this title: '+esc(e.message)+'</div><button class="hbtn" style="margin-top:10px" onclick="document.getElementById(\'foc-ebay-group-modal\').remove()">CLOSE</button>';
    return;
  }
  if(!preview.eligibleCount||preview.eligibleCount<2){
    var reasons=(preview.covers||[]).map(function(c){return '<div style="padding:4px 0;font:9px var(--font-mono);color:var(--dim)">'+esc(c.variantLabel)+(c.eligible?' -- eligible':' -- '+esc(c.reason))+'</div>';}).join('');
    modal.querySelector('div').innerHTML='<div style="color:var(--gold)">Need at least 2 eligible covers to list as one eBay variation listing.</div>'+reasons+'<button class="hbtn" style="margin-top:10px" onclick="document.getElementById(\'foc-ebay-group-modal\').remove()">CLOSE</button>';
    return;
  }
  var shipPolicies=[];var shipPoliciesError='';
  try{
    var policyData=await api('/ebay/business-policies');
    if(policyData.needsToken)shipPoliciesError='eBay is not connected -- connect it under Settings → EBAY to pick a shipping policy here.';
    else if(policyData.fulfillment&&policyData.fulfillment.error)shipPoliciesError=policyData.fulfillment.error;
    var FOC_HANDLING_CLONE_NAME_RE=/-\s*FOC\s+\d+D\s+Handling\s*$/i;
    shipPolicies=((policyData.fulfillment&&policyData.fulfillment.policies)||[]).filter(function(p){return !FOC_HANDLING_CLONE_NAME_RE.test(p.name||'');});
  }catch(e){shipPoliciesError=e.message||'request failed';}
  var lastShipPolicyId='';try{lastShipPolicyId=localStorage.getItem('foc_ebay_last_ship_policy_id')||'';}catch(e){}
  if(lastShipPolicyId&&!shipPolicies.some(function(p){return String(p.id)===lastShipPolicyId;}))lastShipPolicyId='';
  var lastStoreCategory='Comic Books';try{lastStoreCategory=localStorage.getItem('foc_ebay_last_store_category')||'Comic Books';}catch(e){}
  var asp=preview.customAspects||{};
  // Store report: "it didn't take my template with the html to do the
  // themed listing" -- openEbayPresaleReview (single-cover) already
  // renders the store's saved Settings -> Vendor Info -> EBAY LISTING
  // SETTINGS "Comic" template into the description; this group-listing
  // modal never had that logic at all and always used the server's plain-
  // text default. Same rendering, just with no single variant/UPC to fill
  // in (a shared listing has neither).
  var usedCustomTemplate=false;
  var description=preview.description;
  try{
    var vp=(typeof getVendorProfile==='function')?getVendorProfile():{};
    var templates=vp.ebayDescriptionTemplates||{};
    var customTemplate=templates.Comic||templates.default||'';
    if(customTemplate&&typeof renderEbayDescriptionTemplate==='function'){
      var isHtmlTemplate=/<\/?[a-z][\s\S]*>/i.test(customTemplate);
      var presaleShippingLine=['For presale comics, orders ship promptly once the title reaches its official release date and inventory has been received from our distributor.',preview.onSaleLabel?('Release Date: '+preview.onSaleLabel):'','Publisher and distributor release dates may change. If a presale title is delayed, your order will ship as soon as the book becomes available.'].filter(Boolean).join('\n\n');
      // Real per-cover data (not fabricated) for a template's own "choose
      // your cover" section -- every eligible cover a buyer will actually
      // see in this listing's real eBay dropdown, same eligible-only list
      // coverRows below renders as checkboxes. Only worth showing when
      // there's an actual choice to make.
      var eligibleCoverList=(preview.covers||[]).filter(function(c){return c.eligible;});
      var coverChoices=eligibleCoverList.length>1?(isHtmlTemplate
        ? eligibleCoverList.map(function(c){return '<div style="margin-bottom:7px"><b>'+esc(c.variantLabel)+'</b>'+(c.coverArtist?'<br><span style="font-size:12px">Cover art by '+esc(c.coverArtist)+'</span>':'')+'</div>';}).join('')
        : eligibleCoverList.map(function(c){return '- '+c.variantLabel+(c.coverArtist?' (cover art by '+c.coverArtist+')':'');}).join('\n')
      ):'';
      var tokens={title:preview.title.replace(/ - PRESALE$/,''),category:'Comic',price:'',upc:'',
        variant:'',releaseDate:preview.onSaleLabel||'',shippingLine:presaleShippingLine,coverChoices:coverChoices,
        publisher:asp.Publisher||'',writer:asp.Writer||'',artist:asp.Artist||'',coverArtist:asp['Cover Artist']||'',
        synopsis:preview.synopsis||'',condition:'New',quantity:'1'};
      var renderedBody=renderEbayDescriptionTemplate(customTemplate,tokens);
      if(renderedBody){
        // Same fix as the single-cover review modal: only fall back to the
        // plain mandatory disclosure paragraph when the rendered template
        // doesn't already disclose presale status itself (its own banner,
        // or the {shippingLine} token) -- otherwise a store's own branded
        // template got a second, differently-styled disclosure stacked on
        // top of its own.
        var templateAlreadyDisclosesPresale=/presale/i.test(renderedBody);
        var disclosure=templateAlreadyDisclosesPresale?'':(isHtmlTemplate
          ? '<p>PRESALE -- This comic has not been released yet and is not currently in stock.</p><p>Expected on-sale/ship date: '+preview.onSaleLabel+'. Your order ships promptly once we receive stock from the distributor on or shortly after that date.</p>'
          : 'PRESALE -- This comic has not been released yet and is not currently in stock.\n\nExpected on-sale/ship date: '+preview.onSaleLabel+'. Your order ships promptly once we receive stock from the distributor on or shortly after that date.');
        description=disclosure+(disclosure&&!isHtmlTemplate?'\n\n':'')+renderedBody;
        usedCustomTemplate=true;
      }
    }
  }catch(e){/* template rendering is best-effort -- fall back to the server default below */}
  focEbayAiState[familyId]={
    title:preview.title.replace(/ - PRESALE$/,''),
    template:(typeof customTemplate!=='undefined')?customTemplate:'',
    tokens:(typeof tokens!=='undefined')?tokens:null,
    isHtmlTemplate:(typeof isHtmlTemplate!=='undefined')?isHtmlTemplate:false,
    disclosure:(typeof disclosure!=='undefined')?disclosure:'',
    synopsis:preview.synopsis||'',
    publisher:asp.Publisher||'',writer:asp.Writer||'',artist:asp.Artist||'',coverArtist:asp['Cover Artist']||''
  };
  // Store report (live eBay error): "Publish failed (400): Add at least 1
  // photo" -- a cover with no cover_image_url on file published with zero
  // images and eBay rejected the WHOLE shared listing over that one
  // variant. The server now borrows another selected cover's photo for a
  // missing one rather than leaving it blank, but that's a fallback worth
  // seeing before publishing, not something that should stay invisible --
  // shown here as a thumbnail (or a clear "NO COVER ART" flag) per row, the
  // same at-a-glance confirmation the single-cover review modal already
  // gives via its own cover preview image.
  var anyCoverImg=(preview.covers||[]).find(function(c){return c.imageUrl;});
  var coverRows=(preview.covers||[]).map(function(c){
    var disabled=c.eligible?'':'disabled';
    var thumbUrl=c.imageUrl||(anyCoverImg&&anyCoverImg.imageUrl)||'';
    var thumb=thumbUrl
      ? '<img src="'+esc(thumbUrl)+'" style="width:34px;height:44px;object-fit:contain;background:#050507;border:1px solid var(--border);border-radius:4px" onerror="this.style.opacity=.16">'
      : '<div style="width:34px;height:44px;background:#050507;border:1px solid var(--border);border-radius:4px;display:flex;align-items:center;justify-content:center;color:var(--red);font-size:6px;text-align:center;line-height:1.2">NO COVER ART</div>';
    // Store report: "if an item has too long a name it won't let me edit
    // it" -- a CSS grid item's default min-width is auto (its content's
    // intrinsic width), not 0, so this row's 1.4fr label column refused to
    // shrink for a long cover name and pushed the PRICE/QTY inputs to the
    // right of it past the modal's own edge, out of reach, instead of
    // wrapping the name onto more lines. minmax(0, ...) on the track plus
    // min-width:0/overflow-wrap on the label div let both actually shrink.
    return '<div class="foc-sku-fields" data-eb-cover-row="'+esc(c.skuId)+'" style="grid-template-columns:auto auto minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr);align-items:end;padding:6px 0;border-bottom:1px solid var(--border);opacity:'+(c.eligible?'1':'.45')+'">'+
      '<label style="display:flex;align-items:center;gap:5px"><input type="checkbox" data-eb-cover-cb="'+esc(c.skuId)+'" '+(c.eligible?'checked':'')+' '+disabled+'></label>'+
      thumb+
      '<div style="min-width:0;overflow-wrap:break-word"><div style="font-weight:700;color:var(--text)">'+esc(c.variantLabel)+'</div><div style="font:8px var(--font-mono);color:var(--dim);overflow-wrap:break-word">'+(c.eligible?'UPC '+esc(c.upc)+(c.imageUrl?'':' · borrowing another cover\'s photo -- add its own cover art later'):esc(c.reason))+'</div></div>'+
      '<label>PRICE<input class="tsi" data-eb-cover-price="'+esc(c.skuId)+'" type="number" min="0" step=".01" value="'+esc(c.price)+'" '+disabled+'></label>'+
      '<label>QTY<input class="tsi" data-eb-cover-qty="'+esc(c.skuId)+'" type="number" min="1" max="200" value="10" '+disabled+'></label>'+
      '</div>';
  }).join('');
  modal.innerHTML='<div style="width:100%;max-width:640px;background:var(--surf);border:1px solid var(--border);border-radius:10px;padding:16px">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><div style="font-family:\'Orbitron\',monospace;color:var(--gold);font-size:13px;letter-spacing:2px">LIST ALL COVERS · ONE EBAY LISTING</div><button onclick="document.getElementById(\'foc-ebay-group-modal\').remove()" style="background:none;border:none;color:var(--dim);font-size:22px;cursor:pointer">×</button></div>'+
    '<div style="font:9px var(--font-mono);color:var(--dim);margin-bottom:10px">One eBay listing with a native "Cover: Select" dropdown for every checked cover below, plus an optional bundle option. Nothing is published until you click LIST ON EBAY.</div>'+
    '<label style="font:9px var(--font-mono);color:var(--dim);display:block;margin-bottom:10px">LISTING TITLE (shared -- eBay requires "PRESALE" disclosed here)<input id="foc-eb-grp-title" maxlength="80" value="'+esc(preview.title)+'" class="tsi" style="margin-top:4px;width:100%;box-sizing:border-box"></label>'+
    // Store request: "an automated way to make the lead image the one
    // with all the covers listed as one image?" -- there's no way to
    // auto-generate a collage (no image-compositing capability in this
    // app), but a store-uploaded combined graphic can be set as the
    // FIRST/default photo shown before a buyer picks a cover, ahead of
    // (never replacing) each cover's own photo -- reuses the same
    // resize-then-upload-to-R2 pattern the regular inventory photo editor
    // already uses (handleInventoryEditPhoto), just against this modal's
    // own preview/hidden-URL elements instead of an inventory item.
    '<label style="font:9px var(--font-mono);color:var(--dim);display:block;margin-bottom:4px">MAIN LISTING PHOTO (optional -- shown first, before a buyer picks a cover. e.g. a "pick your cover" graphic combining all the covers, made in any photo editor)</label>'+
    '<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">'+
    '<div id="foc-eb-grp-main-image-preview" style="width:44px;height:58px;flex-shrink:0;background:#050507;border:1px solid var(--border);border-radius:4px;display:flex;align-items:center;justify-content:center;color:var(--dim);font-size:7px;text-align:center;overflow:hidden">NONE</div>'+
    '<input type="file" id="foc-eb-grp-main-image-file" accept="image/*" style="display:none" onchange="handleFocGroupMainImageFile(this.files[0])">'+
    '<button type="button" class="hbtn" onclick="document.getElementById(\'foc-eb-grp-main-image-file\').click()">UPLOAD</button>'+
    '<button type="button" class="hbtn" onclick="clearFocGroupMainImage()">CLEAR</button>'+
    '<input type="hidden" id="foc-eb-grp-main-image-url" value="">'+
    '</div>'+
    '<div style="font:8px/1.5 var(--font-mono);color:var(--dim);margin-bottom:10px">eBay handling time: <b style="color:var(--text)">'+Number(preview.handlingBusinessDays||0)+' business days</b> from purchase.</div>'+
    '<label style="font:9px var(--font-mono);color:var(--dim);display:block;margin-bottom:10px">SHIPPING POLICY TO CLONE HANDLING TIME FROM (required)<select id="foc-eb-grp-ship-policy" class="tsi" style="margin-top:4px">'+
    (lastShipPolicyId?'':'<option value="" disabled selected>-- select a shipping policy --</option>')+
    shipPolicies.map(function(p){return '<option value="'+esc(p.id)+'" '+(String(p.id)===lastShipPolicyId?'selected':'')+'>'+esc(p.name)+'</option>';}).join('')+
    '</select>'+(shipPolicies.length?'':'<div style="font:8px var(--font-mono);color:var(--red);margin-top:3px">Could not load your eBay shipping policies'+(shipPoliciesError?(': '+esc(shipPoliciesError)):'')+'.</div>')+'</label>'+
    '<label style="display:flex;gap:6px;align-items:center;margin-bottom:10px;font:9px var(--font-mono);color:var(--dim)"><input id="foc-eb-grp-best-offer" type="checkbox" checked> ALLOW BEST OFFER (every cover)</label>'+
    '<div class="foc-sku-fields" style="grid-template-columns:1fr 1fr;margin-bottom:10px"><label>PACKAGE WEIGHT<input id="foc-eb-grp-weight" class="tsi" type="number" min=".1" step=".1" value="'+esc(preview.weightValue)+'"></label><label>UNIT<select id="foc-eb-grp-weight-unit" class="tsi"><option value="POUND" '+(preview.weightUnit==='POUND'?'selected':'')+'>LB</option><option value="OUNCE" '+(preview.weightUnit==='OUNCE'?'selected':'')+'>OZ</option></select></label></div>'+
    // Store report (live listing screenshot): "Series Title" showed up
    // blank on eBay's own item specifics page for a multi-cover listing too
    // -- shown here pre-filled from the same real server default
    // (comic_title_families.series_name) the single-cover modal now uses.
    '<div class="foc-sku-fields" style="grid-template-columns:1fr 1fr;margin-bottom:10px">'+['Publisher','Writer','Artist','Series Title'].map(function(k){return '<label>'+k.toUpperCase()+'<input class="tsi" data-eb-grp-aspect="'+esc(k)+'" value="'+esc(asp[k]||'')+'"></label>';}).join('')+'</div>'+
    // Store request: "add editable Character/Genre/Format fields" -- no
    // reliable data source for these (the FOC import has no character/
    // genre/format columns), so left blank/optional rather than guessed,
    // same MORE ITEM DETAILS pattern the single-cover modal already uses.
    '<details style="margin-bottom:10px"><summary style="cursor:pointer;font:9px var(--font-mono);color:var(--dim)">MORE ITEM DETAILS (OPTIONAL -- feeds eBay item specifics, not just this description)</summary>'+
    '<div class="foc-sku-fields" style="grid-template-columns:1fr 1fr;margin-top:8px">'+
    [['Character','character'],['Genre','genre'],['Format','format']]
      .map(function(x){return '<label>'+x[0].toUpperCase()+'<input class="tsi" data-eb-grp-extra="'+esc(x[1])+'" data-eb-grp-extra-label="'+esc(x[0])+'"></label>';}).join('')+
    '</div></details>'+
    '<label style="font:9px var(--font-mono);color:var(--dim);display:block;margin-bottom:10px">EBAY STORE CATEGORY (optional)<input id="foc-eb-grp-store-category" class="tsi" value="'+esc(lastStoreCategory)+'" style="margin-top:4px"></label>'+
    '<div style="font:9px var(--font-mono);color:var(--dim);margin-bottom:6px">COVERS ON THIS LISTING</div>'+coverRows+
    '<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border)"><label style="display:flex;gap:6px;align-items:center;margin-bottom:4px;font:9px var(--font-mono);color:var(--dim)"><input id="foc-eb-grp-bundle-cb" type="checkbox" onchange="document.getElementById(\'foc-eb-grp-bundle-fields-wrap\').style.display=this.checked?\'block\':\'none\'"> INCLUDE "ALL COVERS BUNDLE" VARIANT</label>'+
    '<div style="font:8px var(--font-mono);color:var(--dim);margin-bottom:8px">Shares the listing title above -- the bundle option shows in the Cover dropdown as whatever label you give it below. Upload a bundle image below for its own photo, or leave it blank to use every checked cover\'s own cover image instead.</div>'+
    '<div id="foc-eb-grp-bundle-fields-wrap" style="display:none">'+
    '<div class="foc-sku-fields" style="grid-template-columns:1.6fr 1fr 1fr">'+
    '<label>BUNDLE LABEL<input id="foc-eb-grp-bundle-label" class="tsi" placeholder="All Covers Bundle"></label>'+
    '<label>BUNDLE PRICE<input id="foc-eb-grp-bundle-price" class="tsi" type="number" min="0" step=".01"></label>'+
    '<label>BUNDLE QTY<input id="foc-eb-grp-bundle-qty" class="tsi" type="number" min="1" max="200" value="5"></label>'+
    '</div>'+
    // Store request: "i need a main image and a bundle image able to
    // upload here" -- separate from MAIN LISTING PHOTO above (the
    // general/default gallery, shown before any cover is picked), this is
    // the photo shown SPECIFICALLY when a buyer selects the bundle option
    // in the Cover dropdown. Same upload mechanics, own hidden URL field.
    '<div style="margin-top:8px">'+
    '<label style="font:9px var(--font-mono);color:var(--dim);display:block;margin-bottom:4px">BUNDLE IMAGE (optional -- shown when a buyer picks this bundle option. Leave blank to show every checked cover\'s own photo instead)</label>'+
    '<div style="display:flex;gap:8px;align-items:center">'+
    '<div id="foc-eb-grp-bundle-image-preview" style="width:44px;height:58px;flex-shrink:0;background:#050507;border:1px solid var(--border);border-radius:4px;display:flex;align-items:center;justify-content:center;color:var(--dim);font-size:7px;text-align:center;overflow:hidden">NONE</div>'+
    '<input type="file" id="foc-eb-grp-bundle-image-file" accept="image/*" style="display:none" onchange="handleFocGroupBundleImageFile(this.files[0])">'+
    '<button type="button" class="hbtn" onclick="document.getElementById(\'foc-eb-grp-bundle-image-file\').click()">UPLOAD</button>'+
    '<button type="button" class="hbtn" onclick="clearFocGroupBundleImage()">CLEAR</button>'+
    '<input type="hidden" id="foc-eb-grp-bundle-image-url" value="">'+
    '</div></div>'+
    '</div></div>'+
    '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:12px"><span style="font:9px var(--font-mono);color:var(--dim)">DESCRIPTION (shared)</span>'+
    '<div style="display:flex;align-items:center;gap:8px">'+
    '<button type="button" class="hbtn" style="padding:4px 8px;font-size:9px" onclick="generateFocGroupAiDescription(\''+esc(familyId)+'\')">✨ AI DESCRIPTION</button>'+
    '<span style="font:8px var(--font-mono);color:var(--dim)">'+(usedCustomTemplate?'Using your saved Comic template (':'Using the built-in default (')+'<a href="#" onclick="openSettingsSection(\'profile\',\'vendor-profile-panel\');return false" style="color:var(--g)">edit in Settings → Vendor Info → EBAY LISTING SETTINGS</a>)</span></div></div>'+
    '<textarea id="foc-eb-grp-desc" rows="6" style="width:100%;margin-top:4px;background:var(--surf2);border:1px solid var(--border);color:var(--text);padding:9px;border-radius:6px;box-sizing:border-box;resize:vertical;font-size:11px">'+esc(description)+'</textarea>'+
    '<div id="foc-eb-grp-status" style="display:none;margin:10px 0;padding:10px;border-radius:6px;font-family:monospace;font-size:10px;text-align:center"></div>'+
    '<div style="display:flex;gap:8px;margin-top:12px"><button class="hbtn" style="flex:1;padding:12px;background:rgba(255,209,102,.12);border-color:rgba(255,209,102,.35);color:var(--gold)" onclick="submitFamilyEbayGroupReview(\''+esc(familyId)+'\')">LIST ON EBAY (ONE LISTING)</button>'+
    '<button class="hbtn" style="padding:12px" onclick="document.getElementById(\'foc-ebay-group-modal\').remove()">CANCEL</button></div>'+
    '</div>';
}
// Resize-then-upload-to-R2, same as the regular inventory photo editor's
// handleInventoryEditPhoto -- 1600px longest side matches eBay's own photo
// guidance (and what every other eBay-bound photo in this app already
// uses), just targeting this modal's own preview thumbnail and hidden URL
// field instead of an inventory item. Shared by both the MAIN LISTING
// PHOTO and BUNDLE IMAGE uploaders below (same mechanics, different DOM
// ids and toast label) -- store request: "i need a main image and a
// bundle image able to upload here" -- the bundle option previously had
// no photo of its own at all, silently reusing whatever the general main
// image happened to be (or, before that, every checked cover's photo
// piled together).
function handleFocGroupImageFile(file,idPrefix,label){
  if(!file)return;
  if(!file.type||!file.type.startsWith('image/')){toast_dash('Choose an image file');return;}
  var reader=new FileReader();
  reader.onload=function(){
    var img=new Image();
    img.onload=function(){
      var max=1600;
      var scale=Math.min(1,max/Math.max(img.width,img.height));
      var canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(img.width*scale));
      canvas.height=Math.max(1,Math.round(img.height*scale));
      canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
      var preview=document.getElementById(idPrefix+'-preview');
      if(preview)preview.innerHTML='<img src="'+canvas.toDataURL('image/jpeg',.92)+'" style="width:100%;height:100%;object-fit:contain">';
      canvas.toBlob(function(blob){
        if(!blob){toast_dash('Could not process image');return;}
        storeWorkerFetch('/inventory/photo/upload',{method:'POST',headers:{'Content-Type':'image/jpeg'},body:blob})
          .then(function(res){return res.json().catch(function(){return{};}).then(function(data){return{res:res,data:data};});})
          .then(function(r){
            if(!r.res.ok||!r.data.ok)throw new Error(r.data.error||'Upload failed');
            var urlField=document.getElementById(idPrefix+'-url');
            if(urlField)urlField.value=r.data.url;
            toast_dash(label+' uploaded');
          })
          .catch(function(e){toast_dash('Upload failed: '+e.message);});
      },'image/jpeg',.92);
    };
    img.onerror=function(){toast_dash('Could not read image');};
    img.src=reader.result;
  };
  reader.readAsDataURL(file);
}
function clearFocGroupImage(idPrefix){
  var urlField=document.getElementById(idPrefix+'-url');if(urlField)urlField.value='';
  var preview=document.getElementById(idPrefix+'-preview');if(preview)preview.innerHTML='NONE';
  var fileInput=document.getElementById(idPrefix+'-file');if(fileInput)fileInput.value='';
}
function handleFocGroupMainImageFile(file){handleFocGroupImageFile(file,'foc-eb-grp-main-image','Main listing photo');}
function clearFocGroupMainImage(){clearFocGroupImage('foc-eb-grp-main-image');}
function handleFocGroupBundleImageFile(file){handleFocGroupImageFile(file,'foc-eb-grp-bundle-image','Bundle image');}
function clearFocGroupBundleImage(){clearFocGroupImage('foc-eb-grp-bundle-image');}
async function submitFamilyEbayGroupReview(familyId){
  var status=document.getElementById('foc-eb-grp-status');
  var variants=[];
  document.querySelectorAll('[data-eb-cover-cb]').forEach(function(cb){
    if(!cb.checked||cb.disabled)return;
    var skuId=cb.dataset.ebCoverCb;
    var priceEl=document.querySelector('[data-eb-cover-price="'+CSS.escape(skuId)+'"]');
    var qtyEl=document.querySelector('[data-eb-cover-qty="'+CSS.escape(skuId)+'"]');
    variants.push({skuId:skuId,price:priceEl?priceEl.value:0,quantity:qtyEl?parseInt(qtyEl.value,10)||10:10});
  });
  if(variants.length<2){toast_dash('Check at least 2 covers to list as one eBay variation listing');return;}
  var basePolicyId=(document.getElementById('foc-eb-grp-ship-policy')?.value||'').trim();
  if(!basePolicyId){toast_dash('Select a shipping policy before publishing');return;}
  try{localStorage.setItem('foc_ebay_last_ship_policy_id',basePolicyId);}catch(e){}
  var storeCategory=(document.getElementById('foc-eb-grp-store-category').value||'').trim();
  try{localStorage.setItem('foc_ebay_last_store_category',storeCategory);}catch(e){}
  var customAspects={};
  document.querySelectorAll('[data-eb-grp-aspect]').forEach(function(el){customAspects[el.dataset.ebGrpAspect]=el.value;});
  document.querySelectorAll('[data-eb-grp-extra]').forEach(function(el){if(el.value)customAspects[el.dataset.ebGrpExtraLabel]=el.value;});
  var bundleCb=document.getElementById('foc-eb-grp-bundle-cb');
  var bundle=null;
  if(bundleCb&&bundleCb.checked){
    bundle={
      included:true,
      label:(document.getElementById('foc-eb-grp-bundle-label').value||'').trim()||undefined,
      price:document.getElementById('foc-eb-grp-bundle-price').value,
      quantity:parseInt(document.getElementById('foc-eb-grp-bundle-qty').value,10)||0,
      imageUrl:(document.getElementById('foc-eb-grp-bundle-image-url')?.value||'').trim()||undefined,
    };
  }
  var payload={
    storeId:getActiveStoreId(),familyId:familyId,variants:variants,bundle:bundle,
    title:document.getElementById('foc-eb-grp-title').value,
    description:document.getElementById('foc-eb-grp-desc').value,
    customAspects:customAspects,
    bestOfferEnabled:document.getElementById('foc-eb-grp-best-offer').checked,
    weightValue:parseFloat(document.getElementById('foc-eb-grp-weight').value)||undefined,
    weightUnit:document.getElementById('foc-eb-grp-weight-unit').value,
    storeCategoryNames:storeCategory?[storeCategory]:[],
    basePolicyId:basePolicyId,
    mainImageUrl:(document.getElementById('foc-eb-grp-main-image-url')?.value||'').trim()||undefined,
  };
  if(status){status.style.display='block';status.style.color='var(--gold)';status.style.border='1px solid rgba(255,209,102,.25)';status.style.background='rgba(255,209,102,.06)';status.textContent='Publishing '+variants.length+' cover'+(variants.length===1?'':'s')+(bundle?' + bundle':'')+' as one eBay listing…';}
  try{
    var result=await api('/foc/ebay/create-presale-group',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    toast_dash('eBay variation listing created: '+result.createdCount+' variant'+(result.createdCount===1?'':'s'));
    if(result.warnings&&result.warnings.length)toast_dash('eBay warning: '+result.warnings.join(' · '));
    var modal=document.getElementById('foc-ebay-group-modal');if(modal)modal.remove();
    await refreshCycleFamilies();
  }catch(e){
    if(status){status.style.color='var(--red)';status.style.borderColor='rgba(255,77,109,.3)';status.style.background='rgba(255,77,109,.06)';status.textContent='Could not create eBay variation listing: '+e.message;}
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
  // Live, not a one-time snapshot: recomputed from the current cycle state
  // every time this screen renders (after a PRH cart import, after a manual
  // Whatnot/store qty edit, after navigating back to this cycle later) --
  // ELIGIBLE_NOW is the same bar the bulk-select checkboxes already use, so
  // this never offers to queue up a cover eBay itself would reject (no
  // on-sale date yet, not released yet, etc).
  var needsListing=regular.filter(function(v){return v.ebayPresaleStatus==='ELIGIBLE_NOW'&&Number(v.storeQuantity||0)>0;});
  panel().innerHTML='<section class="foc-hero"><div class="foc-toolbar"><button class="hbtn" onclick="openFocCycle(\''+esc(c.id)+'\')">← COVER WALL</button><button class="hbtn" style="color:var(--g)" onclick="submitPrhOrder()">SUBMIT PRH ORDER</button><input type="file" id="foc-prh-cart-file" accept=".csv,.xlsx,.xls" hidden onchange="handleFocPrhCartImportFile(event)"><button class="hbtn" title="Upload the cart export from PRH\'s own ordering site (what you actually ordered) -- sets secured/store quantities to match, ends eBay listings for anything left out, and adjusts ordered covers\' listings to the real total, all in one go" onclick="document.getElementById(\'foc-prh-cart-file\').click()">UPLOAD PRH CART</button><button class="hbtn" style="color:var(--red)" onclick="endFocEbayListings()">END REMAINING EBAY LISTINGS</button><button class="hbtn" title="Fixes multi-cover eBay listings published before the photo-to-cover binding fix, where the wrong (or missing) photo shows for some covers" onclick="repairFocEbayGroupPhotos()">REPAIR LISTING PHOTOS</button></div>'+
    '<div style="font:900 20px/1.1 \'Orbitron\',monospace;color:var(--text);margin-top:10px">Final FOC Review · '+esc(displayDate(c.foc_date))+'</div>'+
    '<div class="foc-stats" style="margin-top:12px"><div class="foc-stat"><b>'+regular.length+'</b><span>SKUs</span></div><div class="foc-stat"><b>'+totalUnits+'</b><span>Total Units</span></div><div class="foc-stat"><b>$'+(estCents/100).toFixed(2)+'</b><span>Est. Wholesale</span></div><div class="foc-stat"><b>'+totalWebsite+'</b><span>Website Presold</span></div><div class="foc-stat"><b>'+totalEbay+'</b><span>eBay Presold</span></div><div class="foc-stat"><b>'+totalStore+'</b><span>Whatnot/Store</span></div><div class="foc-stat"><b>'+qualifiedCount+' / '+incentivesAll.length+'</b><span>Incentives Qualified</span></div></div>'+
    '<div id="foc-review-status" style="font:10px var(--font-mono);color:var(--dim);margin-top:8px">Checking submission status…</div>'+
    '<div id="foc-prh-cart-result"></div>'+
    (needsListing.length?'<div class="panel" style="margin-top:10px;padding:12px 16px;border-color:rgba(255,209,102,.35)">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px">'+
      '<div style="font:900 11px \'Orbitron\',monospace;color:var(--gold);letter-spacing:1px">STILL NEEDS AN EBAY LISTING ('+needsListing.length+')</div>'+
      '<button class="hbtn" style="padding:6px 10px;font-size:9px" onclick="startFocNeedsListingBulk()">LIST THESE ON EBAY</button></div>'+
      '<div style="font:9px var(--font-mono);color:var(--dim);margin-bottom:6px">Ordered, with copies left over after website/eBay demand, but no live eBay presale listing yet.</div>'+
      needsListing.map(function(v){return '<div style="font:9px var(--font-mono);color:var(--text);padding:2px 0">'+esc(v.title)+(v.variantLabel&&v.variantLabel!=='Cover A'?' · '+esc(v.variantLabel):'')+' · '+Number(v.storeQuantity||0)+' available</div>';}).join('')+
      '</div>':'')+
    '</section>'+
    (relevantFamilies.length?relevantFamilies.map(function(f){
      return '<section class="foc-family"><header class="foc-family-head"><div class="foc-family-title">'+esc(f.title)+'</div></header>'+incentiveTrackerHtml(f)+f.variants.filter(function(v){return !v.isIncentive;}).map(focReviewLineHtml).join('')+'</section>';
    }).join(''):'<div class="panel" style="padding:28px;text-align:center;color:var(--dim)">Nothing was ordered or qualifying this week.</div>');
  loadPrhSubmissionStatus();
}
function openFocReview(){renderFocReview();}

// Store idea (FOC Intelligence 2.0): when a new PRH file comes in, compare
// it against prior submitted orders, current presales, and recent comic
// sales to suggest ORDER / REDUCE / SKIP / SPEC per title, and flag any
// book that had real secured customer interest in an earlier import but
// silently vanished from a more recent one -- the "He-Man situation".
// All the actual comparison logic lives server-side (focIntelligence in
// foc-preorders.mjs) since it needs cross-cycle Supabase queries this
// client-side state doesn't have; this just fetches and renders it.
var FOC_INTEL_ACTION_COLOR={ORDER:'var(--g)',SPEC:'var(--gold)',REDUCE:'var(--red)',SKIP:'var(--dim)'};
function openFocIntelligence(){
  var c=state.cycle;if(!c)return;
  panel().innerHTML='<section class="foc-hero"><div class="foc-toolbar"><button class="hbtn" onclick="openFocCycle(\''+esc(c.id)+'\')">← COVER WALL</button></div>'+
    '<div style="font:900 20px/1.1 \'Orbitron\',monospace;color:var(--text);margin-top:10px">🧠 FOC Intelligence · '+esc(displayDate(c.foc_date))+'</div>'+
    '<div style="font:10px var(--font-mono);color:var(--dim);margin-top:6px">Compares this file against prior submitted orders, current presales, and your last 90 days of comic sales. Every signal below is real data this store already has -- no fabricated "upcoming movies/events" guesswork.</div></section>'+
    '<div id="foc-intel-disappeared"></div>'+
    '<div id="foc-intel-list" class="panel" style="padding:16px">Loading…</div>';
  loadFocIntelligence(c.id);
}
async function loadFocIntelligence(cycleId){
  try{
    var d=await api('/foc/admin/intelligence?store_id='+encodeURIComponent(getActiveStoreId())+'&cycle_id='+encodeURIComponent(cycleId));
    renderFocIntelligence(d.recommendations||[],d.disappeared||[]);
  }catch(e){
    var el=document.getElementById('foc-intel-list');
    if(el)el.innerHTML='<div style="color:var(--red);font:10px var(--font-mono)">Could not load: '+esc(e.message)+'</div>';
  }
}
function renderFocIntelligence(recommendations,disappeared){
  var disEl=document.getElementById('foc-intel-disappeared');
  if(disEl){
    disEl.innerHTML=disappeared.length?('<div class="panel" style="margin:12px 0;padding:12px 16px;border-color:rgba(255,77,109,.4)">'+
      '<div style="font:900 11px \'Orbitron\',monospace;color:var(--red);letter-spacing:1px;margin-bottom:6px">⚠ DISAPPEARED FROM A NEWER FOC ('+disappeared.length+')</div>'+
      disappeared.map(function(x){return '<div style="padding:6px 0;border-bottom:1px solid var(--border);font:10px var(--font-mono)"><b>'+esc(x.title)+'</b> -- '+x.securedQuantity+' secured, but missing from the most recent import. Check with the distributor before assuming it\'s just delayed.</div>';}).join('')+
      '</div>'):'';
  }
  var listEl=document.getElementById('foc-intel-list');
  if(!listEl)return;
  if(!recommendations.length){ listEl.innerHTML='<div class="empty" style="padding:20px;text-align:center;color:var(--dim)">No title families in this cycle yet</div>'; return; }
  listEl.innerHTML='<div style="font:9px var(--font-mono);color:var(--dim);margin-bottom:10px">Sorted ORDER → SPEC → REDUCE → SKIP</div>'+
    recommendations.map(function(r){
      return '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">'+
        '<div style="min-width:0"><div style="font-weight:700;color:var(--text);font-size:12px">'+esc(r.title)+'</div>'+
        '<div style="font:9px var(--font-mono);color:var(--dim);margin-top:2px">'+esc(r.reason)+'</div></div>'+
        '<span class="foc-badge" style="flex-shrink:0;color:'+FOC_INTEL_ACTION_COLOR[r.action]+';border-color:'+FOC_INTEL_ACTION_COLOR[r.action]+'">'+esc(r.action)+'</span>'+
        '</div>';
    }).join('');
}
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
// Store report: after placing the real order on PRH's own ordering site
// (their cart export gives quantities that can differ from this store's
// own computed demand -- carton minimums, a judgment call to buy a few
// extra), getting that reality back into the dashboard meant clicking
// into every single cover and retyping its Whatnot/store quantity by
// hand, one at a time. This reads PRH's own cart-export CSV directly
// (same file the "Cart" screen on their ordering site lets you download)
// and reconciles secured/store quantities, eBay listings, and everything
// in between in one upload -- see adminImportPrhCart in foc-preorders.mjs.
async function handleFocPrhCartImportFile(event){
  var file=event.target.files&&event.target.files[0];event.target.value='';if(!file||!state.cycle)return;
  var status=document.getElementById('foc-review-status');
  var resultHost=document.getElementById('foc-prh-cart-result');
  if(status)status.textContent='Reading '+file.name+'…';
  if(resultHost)resultHost.innerHTML='';
  try{
    if(typeof XLSX==='undefined')throw new Error('Spreadsheet reader is still loading');
    // raw:true is required here for the same reason handleFocFileImport
    // needs it for the big catalog import -- without it, SheetJS type-infers
    // the big numeric-looking "ISBN / UPC" column and silently corrupts its
    // last digit through float coercion, which would then match nothing.
    var buffer=await file.arrayBuffer();var wb=XLSX.read(buffer,{type:'array',raw:true});var sheet=wb.Sheets[wb.SheetNames[0]];
    var parsed=XLSX.utils.sheet_to_json(sheet,{defval:'',raw:false});
    if(!parsed.length)throw new Error('No rows found in this file');
    var upcKey=Object.keys(parsed[0]).find(function(k){return k.replace(/\s+/g,' ').trim().toLowerCase()==='isbn / upc';});
    var qtyKey=Object.keys(parsed[0]).find(function(k){return k.trim().toLowerCase()==='quantity';});
    if(!upcKey||!qtyKey)throw new Error('This does not look like a PRH cart export -- expected "ISBN / UPC" and "Quantity" columns');
    var rows=parsed.map(function(row){return{upc:String(row[upcKey]||'').trim(),quantity:Number(row[qtyKey])||0};}).filter(function(r){return r.upc&&r.quantity>0;});
    if(!rows.length)throw new Error('No row had both a UPC/ISBN and a positive quantity -- is this the right file?');
    if(status)status.textContent='Matching '+rows.length+' cart rows against this cycle…';
    var d=await api('/foc/admin/prh-cart-import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),cycleId:state.cycle.id,rows:rows})});
    if(status)status.textContent='';
    toast_dash(d.matchedCount+' cover'+(d.matchedCount===1?'':'s')+' matched and updated'+(d.ebayWithdrawnCount?' · '+d.ebayWithdrawnCount+' listing'+(d.ebayWithdrawnCount===1?'':'s')+' ended':'')+(d.ebayQuantityUpdatedCount?' · '+d.ebayQuantityUpdatedCount+' listing'+(d.ebayQuantityUpdatedCount===1?'':'s')+' quantity-synced':''));
    // Refetch this cycle so every per-cover card reflects the new secured/
    // store quantities, then re-render the review screen (not the cover
    // wall openCycle itself renders) with the import result attached.
    await openCycle(state.cycle.id);
    renderFocReview();
    var resultHostAfterRefresh=document.getElementById('foc-prh-cart-result');
    if(resultHostAfterRefresh)resultHostAfterRefresh.innerHTML=focPrhCartResultHtml(d);
  }catch(e){if(status)status.textContent='';toast_dash('Could not import PRH cart: '+e.message);}
}
function focPrhCartResultHtml(d){
  var parts=['<div class="panel" style="margin-top:10px;padding:12px 16px">'+
    '<div style="font:900 11px \'Orbitron\',monospace;color:var(--g);letter-spacing:1px;margin-bottom:6px">PRH CART IMPORTED</div>'+
    '<div style="font:10px var(--font-mono);color:var(--dim)">'+d.matchedCount+' cover'+(d.matchedCount===1?'':'s')+' matched to this cycle and had secured/store quantities set to match your real order.'+
    (d.ebayWithdrawnCount?'<br>'+d.ebayWithdrawnCount+' eBay listing'+(d.ebayWithdrawnCount===1?'':'s')+' ended -- left out of the cart, so nothing is coming from the distributor.':'')+
    (d.ebayQuantityUpdatedCount?'<br>'+d.ebayQuantityUpdatedCount+' eBay listing'+(d.ebayQuantityUpdatedCount===1?'':'s')+' had its buyable quantity adjusted to the real ordered total.':'')+
    '</div></div>'];
  if(d.unmatchedRows&&d.unmatchedRows.length){
    parts.push('<div class="panel" style="margin-top:10px;padding:12px 16px;border-color:rgba(255,209,102,.35)">'+
      '<div style="font:900 11px \'Orbitron\',monospace;color:var(--gold);letter-spacing:1px;margin-bottom:6px">⚠ '+d.unmatchedRows.length+' CART ROW'+(d.unmatchedRows.length===1?'':'S')+' NOT MATCHED</div>'+
      '<div style="font:9px var(--font-mono);color:var(--dim);margin-bottom:6px">Usually non-comic lines PRH\'s own cart mixes in (posters, merchandise) that were never part of this catalog import -- but double-check a UPC below isn\'t a real cover that just doesn\'t match (a reprint, a distributor UPC change).</div>'+
      d.unmatchedRows.map(function(r){return '<div style="font:9px var(--font-mono);color:var(--text);padding:2px 0">UPC '+esc(r.upc)+' · qty '+r.quantity+'</div>';}).join('')+
      '</div>');
  }
  // needsListing itself is rendered by renderFocReview() as a persistent,
  // always-live panel (not just right after an import) -- see the "STILL
  // NEEDS AN EBAY LISTING" block above the family cards, with the LIST
  // THESE ON EBAY button wired to startFocNeedsListingBulk().
  return parts.join('');
}
// Store report: ending eBay listings used to be all-or-nothing for the
// whole cycle -- no way to keep a specific cover's presale running while
// stopping the rest. This opens a checklist of every still-live listing,
// pre-checked (so confirming with no changes matches the old "end
// everything" behavior), and the dealer unchecks whichever covers they
// want to KEEP live before confirming.
function endFocEbayListings(){
  if(!state.cycle)return;
  var live=allFocSkus().filter(function(v){return v.ebayPresaleStatus==='LISTED';});
  var modalOld=document.getElementById('foc-end-ebay-modal');if(modalOld)modalOld.remove();
  if(!live.length){toast_dash('No live eBay presale listings for this cycle');return;}
  var modal=document.createElement('div');
  modal.id='foc-end-ebay-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:24px 12px';
  modal.innerHTML='<div style="width:100%;max-width:600px;background:var(--surf);border:1px solid var(--border);border-radius:10px;padding:16px">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><div style="font-family:\'Orbitron\',monospace;color:var(--red);font-size:13px;letter-spacing:2px">END EBAY LISTINGS</div><button onclick="document.getElementById(\'foc-end-ebay-modal\').remove()" style="background:none;border:none;color:var(--dim);font-size:22px;cursor:pointer">×</button></div>'+
    '<div style="font:9px var(--font-mono);color:var(--dim);margin-bottom:10px">Everything below is checked to end. Uncheck any cover you want to KEEP live on eBay, then confirm. Already-sold copies are unaffected either way -- this only stops further eBay sales.</div>'+
    '<label style="display:flex;gap:6px;align-items:center;margin-bottom:8px;font:9px var(--font-mono);color:var(--dim);cursor:pointer"><input type="checkbox" checked onchange="toggleFocEndEbayAll(this.checked)"> SELECT ALL</label>'+
    '<div style="max-height:440px;overflow-y:auto;border-top:1px solid var(--border);padding-top:8px">'+
    live.map(function(v){return '<label style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border);font:10px var(--font-mono);color:var(--text);cursor:pointer">'+
      '<input type="checkbox" class="foc-end-ebay-cb" value="'+esc(v.id)+'" checked>'+
      (v.coverImageUrl?'<img src="'+esc(v.coverImageUrl)+'" alt="" loading="lazy" style="width:40px;height:54px;object-fit:cover;border-radius:4px;flex-shrink:0;background:#050507" onerror="this.replaceWith(Object.assign(document.createElement(\'div\'),{style:\'width:40px;height:54px;flex-shrink:0;border-radius:4px;background:var(--surf2)\'}))">':'<div style="width:40px;height:54px;flex-shrink:0;border-radius:4px;background:var(--surf2);display:flex;align-items:center;justify-content:center;font:7px var(--font-mono);color:var(--dim);text-align:center;line-height:1.3">NO<br>COVER</div>')+
      '<span style="flex:1;min-width:0">'+
        '<div style="font-weight:800;color:var(--text);line-height:1.3">'+esc(v.title||v.variantLabel)+'</div>'+
        (v.variantLabel&&v.variantLabel!=='Cover A'?'<div style="color:var(--gold);margin-top:1px">'+esc(v.variantLabel)+'</div>':'')+
        '<div style="font:8px var(--font-mono);color:var(--dim);margin-top:2px">'+Number(v.ebayPresold||0)+' presold · '+Number(v.ebayAvailable||0)+' available'+(v.upc?' · UPC '+esc(v.upc):'')+'</div>'+
      '</span>'+
      '</label>';}).join('')+
    '</div>'+
    '<div style="display:flex;gap:8px;margin-top:12px"><button class="hbtn" style="flex:1;padding:12px;background:rgba(255,77,109,.12);border-color:rgba(255,77,109,.35);color:var(--red)" onclick="confirmEndFocEbayListings()">END SELECTED LISTINGS</button>'+
    '<button class="hbtn" style="padding:12px" onclick="document.getElementById(\'foc-end-ebay-modal\').remove()">CANCEL</button></div>'+
    '</div>';
  document.body.appendChild(modal);
}
function toggleFocEndEbayAll(checked){
  document.querySelectorAll('.foc-end-ebay-cb').forEach(function(cb){cb.checked=checked;});
}
async function confirmEndFocEbayListings(){
  var ids=Array.prototype.slice.call(document.querySelectorAll('.foc-end-ebay-cb:checked')).map(function(cb){return cb.value;});
  if(!ids.length){toast_dash('Nothing selected to end');return;}
  var modal=document.getElementById('foc-end-ebay-modal');if(modal)modal.remove();
  var status=document.getElementById('foc-review-status');
  if(status)status.textContent='Ending eBay listings…';
  try{
    var d=await api('/foc/admin/end-ebay-listings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),cycleId:state.cycle.id,focSkuIds:ids})});
    if(d.endedCount===0)toast_dash('No live eBay presale listings left for this cycle');
    else toast_dash(d.endedCount+' eBay presale listing'+(d.endedCount===1?'':'s')+' ended'+(d.failedCount?' ('+d.failedCount+' failed, see console)':''));
    if(d.errors&&d.errors.length)console.error('FOC bulk eBay end failures:',d.errors);
    await loadPrhSubmissionStatus();
  }catch(e){if(status)status.textContent='';toast_dash('Could not end listings: '+e.message);}
}

async function repairFocEbayGroupPhotos(){
  var status=document.getElementById('foc-review-status');
  if(status)status.textContent='Checking group listing photos…';
  try{
    var d=await api('/foc/ebay/repair-group-listing-photos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId()})});
    var repaired=d.repaired||[],failed=d.failed||[];
    var warned=repaired.filter(function(r){return r.warning;});
    if(!repaired.length&&!failed.length)toast_dash(d.message||'No group listings on file to repair');
    else toast_dash(repaired.length+' listing'+(repaired.length===1?'':'s')+' photo binding repaired'+(warned.length?' ('+warned.length+' with warnings)':'')+(failed.length?' ('+failed.length+' failed)':''));
    if(warned.length)console.warn('FOC eBay group photo repair warnings:',warned);
    if(failed.length)console.error('FOC eBay group photo repair failures:',failed);
    if(warned.length||failed.length){
      var lines=warned.map(function(r){return r.groupKey+': '+r.warning;}).concat(failed.map(function(f){return f.groupKey+': '+f.error;}));
      alert('Some listings had issues:\n\n'+lines.join('\n\n'));
    }
  }catch(e){toast_dash('Could not repair listing photos: '+e.message);}
  finally{if(status)status.textContent='';}
}
async function loadEbaySafeDays(){
  try{
    var res=await storeWorkerFetch('/kv/comic_ebay_presale_safe_business_days');
    var data=await res.json().catch(function(){return{};});
    var input=document.getElementById('foc-ebay-safe-days');
    if(input&&data.value)input.value=data.value;
  }catch(e){}
}
// Shared by generateFocAiDescription (single-cover) and
// generateFocGroupAiDescription (shared/multi-cover) -- both review modals
// build the same shape of AI facts and the same "slot into the template
// via {aiSummary}, or append if the template doesn't have it" behavior the
// main inventory eBay modal uses (dashboard.html's
// applyAiSummaryToDescription), just against FOC's own sku/aspect/extra
// field shapes instead of an inventory item. aspectAttr/extraAttr are the
// data-* attribute names each modal's inputs actually use (they differ
// between the two modals) so this reads whatever the operator has
// currently typed rather than the stale values from when the modal opened.
async function focAiDescriptionCore(stateKey,prefix,aspectAttr,extraAttr){
  var ta=document.getElementById(prefix+'-desc');
  var status=document.getElementById(prefix+'-status');
  if(!ta)return;
  if(status){status.style.display='block';status.style.color='var(--gold)';status.style.border='1px solid rgba(255,209,102,.25)';status.style.background='rgba(255,209,102,.06)';status.textContent='Generating AI description...';}
  try{
    if(typeof callEbayAiDescription!=='function')throw new Error('AI description is unavailable on this page');
    var state=focEbayAiState[stateKey]||{};
    var asp={};
    document.querySelectorAll('['+aspectAttr+']').forEach(function(el){var k=el.getAttribute(aspectAttr);if(k&&el.value.trim())asp[k]=el.value.trim();});
    var extra={};
    document.querySelectorAll('['+extraAttr+']').forEach(function(el){var k=el.getAttribute(extraAttr);if(k&&el.value.trim())extra[k]=el.value.trim();});
    var facts=[
      state.title||'',
      (asp['Publisher']||state.publisher)?'Publisher: '+(asp['Publisher']||state.publisher):'',
      (asp['Writer']||state.writer)?'Writer: '+(asp['Writer']||state.writer):'',
      (asp['Artist']||state.artist)?'Artist: '+(asp['Artist']||state.artist):'',
      (asp['Cover Artist']||state.coverArtist)?'Cover Artist: '+(asp['Cover Artist']||state.coverArtist):'',
      asp['Series Title']?'Series: '+asp['Series Title']:'',
      extra.series?'Series: '+extra.series:'',
      extra.character?'Character: '+extra.character:'',
      extra.genre?'Genre: '+extra.genre:'',
      extra.format?'Format: '+extra.format:'',
      extra.franchise?'Franchise: '+extra.franchise:'',
      extra.edition?'Edition: '+extra.edition:'',
      extra.exclusive?'Exclusive: '+extra.exclusive:'',
      extra.coverType?'Cover Type: '+extra.coverType:'',
      extra.keyIssue?'Key Issue: '+extra.keyIssue:'',
      extra.firstAppearance?'First Appearance: '+extra.firstAppearance:'',
      state.synopsis?'Solicitation text: '+state.synopsis:''
    ].filter(Boolean).join('\n');
    var aiText=await callEbayAiDescription(facts);
    var hasToken=!!(state.template&&/\{aiSummary\}/.test(state.template)&&typeof renderEbayDescriptionTemplate==='function');
    var newDesc;
    if(hasToken){
      var rendered=renderEbayDescriptionTemplate(state.template,Object.assign({},state.tokens,{aiSummary:aiText}));
      newDesc=(state.disclosure||'')+(state.isHtmlTemplate?'':'\n\n')+rendered;
    }else{
      var existing=ta.value||'';
      var looksHtml=/<\/?[a-z][\s\S]*>/i.test(existing);
      var aiBlock=looksHtml?'<p>'+esc(aiText)+'</p>':aiText;
      newDesc=existing?existing+(looksHtml?'':'\n\n')+aiBlock:aiBlock;
    }
    ta.value=newDesc;
    if(status)status.style.display='none';
  }catch(e){
    if(status){status.style.color='var(--red)';status.style.border='1px solid rgba(255,77,109,.25)';status.style.background='rgba(255,77,109,.06)';status.textContent='AI description failed: '+e.message+' (kept existing description)';}
  }
}
function generateFocAiDescription(skuId){return focAiDescriptionCore(skuId,'foc-eb','data-foc-eb-aspect','data-foc-eb-extra');}
function generateFocGroupAiDescription(familyId){return focAiDescriptionCore(familyId,'foc-eb-grp','data-eb-grp-aspect','data-eb-grp-extra');}

async function saveEbaySafeDays(){
  var input=document.getElementById('foc-ebay-safe-days');
  var val=parseInt(input&&input.value,10);
  if(!val||val<1){toast_dash('Enter a positive number of business days');return;}
  try{
    await storeWorkerFetch('/kv/comic_ebay_presale_safe_business_days',{method:'POST',body:String(val)});
    toast_dash('eBay presale safety buffer saved: '+val+' business days');
  }catch(e){toast_dash('Could not save: '+e.message);}
}

async function loadLunarDiscountSettings(){
  try{
    var res=await storeWorkerFetch('/kv/comic_lunar_publisher_discount_rates');
    var data=await res.json().catch(function(){return{};});
    var parsed=data.value?JSON.parse(data.value):null;
    if(parsed&&Number.isFinite(parsed.dc))lunarDcDiscount=parsed.dc;
    if(parsed&&Number.isFinite(parsed.image))lunarImageDiscount=parsed.image;
    var dcInput=document.getElementById('foc-lunar-dc');if(dcInput)dcInput.value=lunarDcDiscount;
    var imageInput=document.getElementById('foc-lunar-image');if(imageInput)imageInput.value=lunarImageDiscount;
  }catch(e){}
}
async function saveLunarDiscountSettings(){
  var dcInput=document.getElementById('foc-lunar-dc'),imageInput=document.getElementById('foc-lunar-image');
  var dc=Number(dcInput&&dcInput.value),image=Number(imageInput&&imageInput.value);
  if(!Number.isFinite(dc)||dc<0||dc>90||!Number.isFinite(image)||image<0||image>90){toast_dash('Enter a discount percent between 0 and 90 for both');return;}
  try{
    await storeWorkerFetch('/kv/comic_lunar_publisher_discount_rates',{method:'POST',body:JSON.stringify({dc:dc,image:image})});
    lunarDcDiscount=dc;lunarImageDiscount=image;
    toast_dash('Lunar cost-estimate discounts saved');
    renderFamilies();
  }catch(e){toast_dash('Could not save: '+e.message);}
}

async function loadShipping(){var host=document.getElementById('foc-shipping-settings');if(!host)return;host.textContent='Loading…';try{var d=await api('/foc/admin/shipping-settings?store_id='+encodeURIComponent(getActiveStoreId()));state.shipping=d.shipping||{};renderShipping();}catch(e){host.innerHTML='<span style="color:var(--red)">'+esc(e.message)+'</span>';}}
function renderShipping(){var s=state.shipping||{},f=s.from||{},p=s.parcel||{};document.getElementById('foc-shipping-settings').innerHTML='<div class="foc-import-report"><b style="color:'+(s.tokenConfigured?'var(--g)':'var(--gold)')+'">SHIPPO TOKEN '+(s.tokenConfigured?'CONNECTED':'NEEDS SETUP')+'</b><br>The API token stays in the Worker secret. This form stores only your ship-from address and package preset.</div><div class="foc-sku-fields" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-top:10px">'+[['name','Store / sender',f.name],['line1','Street',f.street1],['line2','Suite / unit',f.street2],['city','City',f.city],['state','State',f.state],['zip','ZIP',f.zip],['phone','Phone',f.phone],['email','Email',f.email]].map(function(x){return'<label>'+x[1]+'<input class="tsi" data-ship-from="'+x[0]+'" value="'+esc(x[2]||'')+'"></label>';}).join('')+'</div><div class="foc-sku-fields" style="grid-template-columns:repeat(4,minmax(0,1fr));margin-top:10px">'+[['length','Length',p.length||12],['width','Width',p.width||9],['height','Height',p.height||1],['weight','Weight lb',p.weight||1]].map(function(x){return'<label>'+x[1]+'<input class="tsi" type="number" min=".1" step=".1" data-ship-parcel="'+x[0]+'" value="'+esc(x[2])+'"></label>';}).join('')+'</div><button class="hbtn" style="margin-top:10px" onclick="saveFocShippingSettings()">SAVE LIVE SHIPPING SETUP</button>';}
async function saveShipping(){var shipFrom={},parcel={};document.querySelectorAll('[data-ship-from]').forEach(function(el){shipFrom[el.dataset.shipFrom]=el.value;});document.querySelectorAll('[data-ship-parcel]').forEach(function(el){parcel[el.dataset.shipParcel]=el.value;});try{var d=await api('/foc/admin/shipping-settings',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),enabled:true,shipFrom:shipFrom,defaultParcel:parcel})});state.shipping=d.shipping;toast_dash(d.shipping.tokenConfigured?'Live carrier settings saved':'Address saved — add the Shippo token to enable rates');renderShipping();}catch(e){toast_dash(e.message);}}

window.ensureFocPanel=function(){loadCycles(false);};window.loadFocCycles=loadCycles;window.openFocCycle=openCycle;window.handleFocImportFile=handleImport;window.handleLunarFocImportFile=handleLunarImport;window.switchFocDistributor=switchDistributor;window.loadLunarDiscountSettings=loadLunarDiscountSettings;window.saveLunarDiscountSettings=saveLunarDiscountSettings;window.filterFocAdmin=function(v){state.query=v;renderFamilies();};window.filterFocPublisher=function(v){state.publisher=v;renderFamilies();};window.filterFocFlag=function(v){state.flag=v;renderFamilies();};window.filterFocEbay=function(v){state.ebay=v;renderFamilies();};window.saveFocSku=saveSku;window.saveFocFamily=saveFamily;window.toggleFocCycle=toggleCycle;window.archiveFocCycle=archiveCycle;window.unarchiveFocCycle=unarchiveCycle;window.saveFocCycleCutoff=saveCutoff;window.exportFocPrh=exportPrh;window.loadFocShippingSettings=loadShipping;window.saveFocShippingSettings=saveShipping;window.openReceiveShipment=openReceiveShipment;window.confirmReceiveShipment=confirmReceiveShipment;window.createFocEbayPresale=openEbayPresaleReview;window.submitEbayPresaleReview=submitEbayPresaleReview;window.openFamilyEbayGroupReview=openFamilyEbayGroupReview;window.submitFamilyEbayGroupReview=submitFamilyEbayGroupReview;window.handleFocGroupMainImageFile=handleFocGroupMainImageFile;window.clearFocGroupMainImage=clearFocGroupMainImage;window.handleFocGroupBundleImageFile=handleFocGroupBundleImageFile;window.clearFocGroupBundleImage=clearFocGroupBundleImage;window.loadEbaySafeDays=loadEbaySafeDays;window.saveFocEbaySafeDays=saveEbaySafeDays;window.openFocReview=openFocReview;window.openFocIntelligence=openFocIntelligence;window.submitPrhOrder=submitPrhOrder;window.handleFocPrhCartImportFile=handleFocPrhCartImportFile;window.endFocEbayListings=endFocEbayListings;window.toggleFocEndEbayAll=toggleFocEndEbayAll;window.confirmEndFocEbayListings=confirmEndFocEbayListings;window.repairFocEbayGroupPhotos=repairFocEbayGroupPhotos;window.reviewStoreQtyChanged=reviewStoreQtyChanged;window.focPublishBulkCheckboxChanged=focPublishBulkCheckboxChanged;window.toggleFocPublishBulkSelectAll=toggleFocPublishBulkSelectAll;window.bulkSetCustomerEnabled=bulkSetCustomerEnabled;window.openOrphanedEbayScan=openOrphanedEbayScan;window.endSelectedOrphanedEbayListings=endSelectedOrphanedEbayListings;
window.generateFocAiDescription=generateFocAiDescription;window.generateFocGroupAiDescription=generateFocGroupAiDescription;
// Store report: "+ ADD TO INVENTORY" on a FOC cover-wall card threw
// "quickAddFocSkuToInventory is not defined" -- this whole file is wrapped
// in an IIFE (line 1), so every function it declares is private to that
// closure by default. An onclick="..." HTML attribute string always
// resolves against the GLOBAL scope, not this closure, so only functions
// explicitly re-exposed onto window (this block) are reachable from an
// onclick attribute at all -- quickAddFocSkuToInventory was defined but
// never added here, so every single click threw. Auditing every onclick/
// onchange reference in this file against this list turned up five more
// with the exact same bug, all clustered around the eBay bulk-listing
// workflow on the wall (select-all, per-checkbox, start/skip/cancel) --
// that whole feature has been non-functional the same way.
window.quickAddFocSkuToInventory=quickAddFocSkuToInventory;window.focEbayBulkCheckboxChanged=focEbayBulkCheckboxChanged;window.toggleFocEbayBulkSelectAll=toggleFocEbayBulkSelectAll;window.startFocEbayBulkListing=startFocEbayBulkListing;window.startFocNeedsListingBulk=startFocNeedsListingBulk;window.cancelFocEbayBulkListing=cancelFocEbayBulkListing;window.skipFocEbayBulkItem=skipFocEbayBulkItem;
})();
