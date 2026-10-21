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
// What one received copy cost, in dollars, for /foc/admin/receive: the
// invoice's net price when the slip shows one; for a Lunar week (Lunar's
// packing slip prints no prices) the publisher's Lunar discount off cover;
// otherwise undefined, and the server uses PRH's 50% of cover.
function focReceiveUnitCost(distributor,publisher,msrpCents,netUnitPrice){
  if(Number(netUnitPrice)>0)return Number(netUnitPrice);
  if(distributor!=='Lunar'||!(Number(msrpCents)>0))return undefined;
  var est=lunarEstCostCents({publisher:publisher,msrpCents:msrpCents});
  return est==null?undefined:Math.round(est)/100;
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

// The eBay screens (ALL EBAY LISTINGS, EBAY LISTINGS CHECK) cover the whole
// eBay account, not just comics, so they also open inside the eBay tab's
// quick-access panel -- panelHostOverride points panel() there until the
// FOC wall is opened again.
var panelHostOverride=null;
function panel(){return (panelHostOverride&&document.getElementById(panelHostOverride))||document.getElementById('foc-panels');}
function focBackBtn(){return panelHostOverride?'<button class="hbtn" onclick="closeEbayHubTool()">✕ CLOSE</button>':'<button class="hbtn" onclick="loadFocCycles()">← FOC WALL</button>';}
function closeEbayHubTool(){var host=panel();if(host&&panelHostOverride)host.innerHTML='';panelHostOverride=null;}
window.closeEbayHubTool=closeEbayHubTool;
function busy(message){var host=panel();if(host)host.innerHTML='<div class="panel" style="padding:36px;text-align:center;font-family:var(--font-mono);color:var(--dim)">'+esc(message||'Loading FOC…')+'</div>';}

async function loadCycles(force){
  panelHostOverride=null;
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
  host.innerHTML='<section class="foc-hero"><div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap"><div><div style="font:900 22px/1.1 \'Orbitron\',monospace;color:var(--text)">THE FOC WALL</div><div style="font:10px/1.65 var(--font-mono);color:var(--dim);max-width:720px;margin-top:6px">'+(isLunar?'Upload Lunar\'s weekly comics FOC file, review exact covers, set shelf quantities, and export the clean order.':'Upload Monday\'s PRH metadata file, review exact covers, set shelf quantities, secure incentives, and export the clean UPC order.')+'</div>'+distributorTabs()+'</div><div class="foc-toolbar"><input type="file" id="foc-import-file" accept=".csv,.xlsx,.xls" hidden onchange="'+(isLunar?'handleLunarFocImportFile(event)':'handleFocImportFile(event)')+'"><button class="hbtn" onclick="document.getElementById(\'foc-import-file\').click()">'+(isLunar?'IMPORT LUNAR FOC':'IMPORT PRH FOC')+'</button><button class="hbtn" onclick="loadFocCycles(true)">REFRESH</button><button class="hbtn" style="color:var(--purple)" title="Track connecting-cover sets across titles: bought, missed and upcoming" onclick="openConnectingCovers()">CONNECTING COVERS</button><button class="hbtn" style="color:var(--g)" title="Which series sell out and which comics sit on the shelf" onclick="openComicSellThrough()">📈 SELL-THROUGH</button><button class="hbtn" style="color:var(--g)" title="Photograph the packing slip and receive the books into stock" onclick="openPackingSlipScan()">📷 SCAN PACKING SLIP</button><button class="hbtn" style="color:var(--red)" title="Scans every past FOC cycle (not just the one you have open) for eBay presale listings nothing was actually ordered for" onclick="openOrphanedEbayScan()">FIND ORPHANED EBAY LISTINGS</button><button class="hbtn" style="color:var(--red)" title="Presales switched to in stock before their books came in, and covers counted twice" onclick="openPresaleStockCheck()">🩺 PRESALE STOCK CHECK</button><button class="hbtn" style="color:var(--blue)" title="Every live listing on your eBay account, checked against the dashboard" onclick="openEbayListingsCheck()">📋 EBAY LISTINGS CHECK</button><button class="hbtn" style="color:var(--g)" title="Edit the price and quantity of any live eBay listing" onclick="openEbayEditor()">✏️ ALL EBAY LISTINGS</button><button class="hbtn" style="color:var(--gold)" title="Paid website preorder copies set aside for their customers" onclick="openFocHolds()">📌 ON HOLD</button></div></div><div id="foc-import-status" class="foc-import-report" style="display:none"></div></section>'+
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
  if(typeof JSZip==='undefined'&&window.vendorReady)await window.vendorReady('JSZip').catch(function(){});
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
  // A real Lunar file runs 400-550+ covers, ~15KB JPEG average -- at 4-way
  // concurrency that's several minutes of a status line quietly ticking up
  // with nothing else visibly happening, easy to mistake for stalled.
  // Small files, so a higher parallel count is safe and cuts wall-clock
  // time substantially without meaningfully increasing load on the Worker
  // per request.
  await Promise.all(Array.from({length:Math.min(10,entries.length)},worker));
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
    if(typeof XLSX==='undefined'&&window.vendorReady)await window.vendorReady('XLSX').catch(function(){});
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
    // Store report: "still no images" after the first version of this --
    // extraction and row-matching were both actually correct (verified
    // against a real ~500-cover file), but every embedded image was
    // uploaded through its own separate round trip at only 4-way
    // concurrency, which for a full week's file (Lunar files run 400-550+
    // covers) can genuinely take minutes with no clear indication it was
    // still working, not stalled -- easy to read as "did nothing." Higher
    // concurrency for a small (~15KB average) JPEG cuts that wall-clock
    // time substantially; wrapping the whole step in its own try/catch
    // means a real failure here degrades to a visible warning instead of
    // either failing the entire import or silently vanishing.
    var coverImageCount=0;
    if(config.extractCellImages){
      try{
        if(status)status.textContent='Looking for cover images embedded in the file…';
        var imagesByRow=await extractXlsxCellImages(buffer);
        if(imagesByRow.size){
          var uploadedByRow=await uploadExtractedCoverImages(imagesByRow,function(done,total){if(status)status.textContent='Uploading cover images… '+done+' of '+total;});
          // sheet_to_json({range:headerIndex,...}) starts data at the row
          // right after the header -- rows[i] is always sheet row
          // (headerIndex+1+i), 0-indexed the same way the drawing anchors
          // extracted above are.
          rows.forEach(function(row,i){var url=uploadedByRow.get(headerIndex+1+i);if(url)row.CoverLink=url;});
          coverImageCount=uploadedByRow.size;
        }
      }catch(e){
        if(status)status.textContent='Could not extract embedded cover images ('+(e&&e.message||e)+') -- continuing the import without them…';
      }
    }
    if(status)status.textContent='Found '+rows.length+' exact cover SKUs'+(config.extractCellImages?' · '+coverImageCount+' cover image'+(coverImageCount===1?'':'s')+' matched':'')+'. Importing and grouping title families…';
    var result=await api('/foc/admin/import'+config.query,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceFilename:file.name,sourceSha256:sourceSha256,rows:rows})});
    var r=result.report||{};if(status)status.innerHTML='<b style="color:var(--g)">'+(result.duplicate?'Already imported — no duplicates created.':'Import complete.')+'</b><br>'+Number(r.processed||0)+' rows processed · '+Number(r.families||0)+' title families · '+Number(r.newSkus||0)+' new · '+Number(r.updatedSkus||0)+' updated · '+Number(r.unchanged||0)+' unchanged · '+Number(r.incentives||0)+' incentives'+(r.removedSkus?'<br>'+Number(r.removedSkus)+' cover'+(r.removedSkus===1?'':'s')+' no longer in this file removed (moved to another FOC week or cancelled)':'')+(r.keptMissing&&r.keptMissing.length?'<br><span style="color:var(--gold)">'+r.keptMissing.length+' cover'+(r.keptMissing.length===1?'':'s')+' no longer in this file kept because '+(r.keptMissing.length===1?'it has':'they have')+' orders or stock: '+r.keptMissing.slice(0,5).map(function(k){return esc(k.title)+' ('+esc(k.reason)+')';}).join('; ')+(r.keptMissing.length>5?'…':'')+'</span>':'')+(config.extractCellImages?'<br>'+coverImageCount+' embedded cover image'+(coverImageCount===1?'':'s')+' extracted and attached':'');
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
  try{var data=await api('/foc/admin/cycles?store_id='+encodeURIComponent(getActiveStoreId())+'&cycle_id='+encodeURIComponent(id));state.cycle=data.cycle;state.families=data.families||[];renderCycle();focEnsureIntel();focShowPullNeeds(null,true);}
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
    var flagged=state.flag==='all'||(state.flag==='first'&&f.isFirstIssue)||(state.flag==='foil'&&f.variants.some(function(v){return v.isFoil;}))||(state.flag==='incentive'&&f.variants.some(function(v){return v.isIncentive;}))||(state.flag==='demand'&&f.variants.some(function(v){return v.customerQty>0;}))||(state.flag==='sells'&&focIntel.loaded&&(function(i){return i&&(i.hot||Object.keys(i.variants).length>0);})(focFamilyIntel(f)));
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
// After FOC the website keeps selling ordered covers, up to the copies
// coming that aren't sold yet (from the uploaded cart).
function focAfterFocHtml(v){
  if(!v.afterFoc)return'';
  var left=Number(v.afterFocLeft||0);
  return '<div class="foc-after-foc" style="margin-top:6px;font:9px/1.5 var(--font-mono);color:'+(left>0?'var(--g)':'var(--dim)')+'">🛒 '+(left>0?left+' left to sell on the website after FOC':'after FOC: every copy coming is sold')+'</div>';
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
  if((status==='LISTED'||status==='SOLD_OUT')&&v.ebayListingId)action=focEbayEditHtml(v)+action;
  return '<div style="margin-top:8px;padding-top:7px;border-top:1px solid var(--border)">'+badge+(detail?'<div style="font:8px/1.5 var(--font-mono);color:var(--dim);margin-top:4px">'+esc(detail)+'</div>':'')+action+'</div>';
}
// Store ask: "I need an easier way to re-price and change things for eBay
// here in FOC." A listed cover edits its live eBay price and how many are
// still available right on the card.
function focEbayEditHtml(v){
  var id=esc(v.id),one=Number(v.ebayListingCount||1)>1;
  return '<div class="foc-ebay-edit">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px"><b style="color:var(--blue)">EBAY LISTING</b><a href="https://www.ebay.com/itm/'+encodeURIComponent(v.ebayListingId)+'" target="_blank" rel="noopener">VIEW ON EBAY ↗</a></div>'+
    (one?'<div style="color:var(--gold)">'+Number(v.ebayListingCount)+' eBay listings for this cover -- change them on eBay directly.</div>':
    '<div class="foc-sku-fields" style="margin-top:4px"><label>EBAY PRICE<input class="tsi" type="number" min="0.01" step=".01" data-ebay-edit-price="'+id+'" value="'+(Number(v.ebayPrice||0)?Number(v.ebayPrice).toFixed(2):'')+'"></label><label>AVAILABLE ON EBAY<input class="tsi" type="number" min="0" step="1" data-ebay-edit-qty="'+id+'" value="'+Number(v.ebayAvailable||0)+'"></label></div>'+
    '<button class="hbtn" style="margin-top:6px;width:100%;min-height:30px;font-size:9px;color:var(--g)" onclick="saveFocEbayEdit(\''+id+'\')">SAVE TO EBAY</button>'+
    '<div style="color:var(--dim);margin-top:3px">'+Number(v.ebayPresold||0)+' sold so far -- those stay sold.</div>')+
  '</div>';
}
async function saveFocEbayEdit(skuId){
  var v=allFocSkus().find(function(x){return x.id===skuId;});if(!v)return;
  var pEl=document.querySelector('[data-ebay-edit-price="'+CSS.escape(skuId)+'"]'),qEl=document.querySelector('[data-ebay-edit-qty="'+CSS.escape(skuId)+'"]');
  var price=pEl&&pEl.value!==''?Math.round(Number(pEl.value)*100)/100:null,qty=qEl&&qEl.value!==''?parseInt(qEl.value,10):null;
  var body={storeId:getActiveStoreId(),skuId:skuId},changes=[];
  if(price!=null&&price!==Math.round(Number(v.ebayPrice||0)*100)/100){if(!(price>0)){toast_dash('Enter a price above $0');return;}body.price=price;changes.push('price $'+Number(v.ebayPrice||0).toFixed(2)+' → $'+price.toFixed(2));}
  if(qty!=null&&qty!==Number(v.ebayAvailable||0)){if(!(qty>=0)){toast_dash('Available must be 0 or more');return;}body.available=qty;changes.push('available '+Number(v.ebayAvailable||0)+' → '+qty);}
  if(!changes.length){toast_dash('Nothing changed');return;}
  if(!confirm('Change the eBay listing for '+(v.title||'this cover')+(v.variantLabel?' · '+v.variantLabel:'')+':\n'+changes.join('\n')+'?'))return;
  try{await api('/foc/admin/ebay-presale-edit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});toast_dash('eBay listing updated');await refreshCycleFamilies();}
  catch(e){toast_dash('eBay update failed: '+e.message);}
}
function focFillEbayPrice(skuId,price){var el=document.querySelector('[data-ebay-edit-price="'+CSS.escape(skuId)+'"]');if(!el)return;el.value=Number(price).toFixed(2);el.focus();toast_dash('eBay price filled in -- press SAVE TO EBAY');}
window.saveFocEbayEdit=saveFocEbayEdit;window.focFillEbayPrice=focFillEbayPrice;
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
    '<div style="margin-top:8px;font-weight:800;font-size:11px;line-height:1.35;color:var(--text)">'+esc(v.variantLabel)+'</div><div style="font:9px/1.5 var(--font-mono);color:var(--dim)">'+esc(v.coverArtist||'Cover artist not listed')+'<br>UPC '+esc(v.upc)+'</div>'+lunarCostLine(v)+focVariantPillsHtml(v)+
    ((v.isIncentive||v.isFoil)?'<div style="margin-top:7px;display:flex;gap:5px;flex-wrap:wrap">'+(v.isIncentive?'<span class="foc-badge incentive">INCENTIVE '+esc(v.orderRequirement)+'</span>':'')+(v.isFoil?'<span class="foc-badge">FOIL · PRICE SEPARATELY</span>':'')+'</div>':'')+
    (v.isIncentive?'<div class="foc-progress"><i style="width:'+pct(qual.total,qual.threshold)+'%"></i></div><div style="font:8px/1.4 var(--font-mono);color:'+(qual.qualified?'var(--g)':'var(--gold)')+'">'+Number(qual.total||0)+' / '+Number(qual.threshold||0)+(qual.qualified?' · QUALIFIED':' · '+Number(qual.needed||0)+' MORE TO UNLOCK')+' · '+Number(v.waitlistRequests||0)+' WAITLISTED</div>':'')+
    '<div class="foc-sku-fields"><label>CUSTOMERS<input class="tsi" value="'+Number(v.customerQty||0)+'" disabled></label><label>STORE QTY<input class="tsi" data-field="storeQuantity" type="number" min="0" value="'+Number(v.storeQuantity||0)+'" onchange="'+save+'"></label><label>'+(v.isIncentive?'SELL PRICE · REQUIRED':(v.isFoil?'FOIL SELL PRICE':'CUSTOMER PRICE'))+'<input class="tsi" data-field="customerPrice" type="number" min="0" step=".01" value="'+(Number(v.priceCents||0)/100).toFixed(2)+'" onchange="'+save+'"></label><label>'+(v.isIncentive?'SECURED QTY':'TOTAL ORDER')+'<input class="tsi" '+(v.isIncentive?'data-field="securedQuantity" type="number" min="0" onchange="'+save+'" value="'+Number(v.securedQuantity||0)+'"':'disabled value="'+total+'"')+'></label><label>SAFETY STOCK<input class="tsi" data-field="safetyStockQty" type="number" min="0" value="'+Number(v.safetyStockQty||0)+'" onchange="'+save+'"></label></div>'+
    '<label style="display:block;margin-top:7px;font:8px var(--font-mono);color:var(--dim)">COVER IMAGE URL'+(v.distributor==='Lunar'?' (Lunar\'s feed has none -- paste one from the publisher\'s solicitation or your Lunar account)':'')+'<input class="tsi" data-field="coverImageUrl" type="url" placeholder="https://…" value="'+esc(v.coverImageUrl||'')+'" onchange="'+save+'" style="margin-top:3px"></label>'+
    (v.isIncentive&&!Number(v.priceCents||0)?'<div style="font:8px/1.45 var(--font-mono);color:var(--gold);margin-top:6px">REQUEST-ONLY UNTIL BOTH SECURED QTY AND SELL PRICE ARE SET</div>':'')+
    '<label style="display:flex;gap:6px;align-items:center;margin-top:7px;font:8px var(--font-mono);color:var(--dim)"><input data-field="customerEnabled" type="checkbox" '+(v.customerEnabled!==false?'checked':'')+' onchange="'+save+'"> SHOW TO CUSTOMERS</label>'+
    '<button class="hbtn" style="margin-top:7px;width:100%;min-height:28px;font-size:9px" onclick="quickAddFocSkuToInventory(\''+esc(v.id)+'\')">+ ADD TO INVENTORY</button>'+
    focAfterFocHtml(v)+ebaySection(v)+'</article>';
}

function familyCard(f){
  var groupListBtn=(f.variants||[]).length>=2?'<button class="hbtn" style="font-size:8px;color:var(--gold)" onclick="openFamilyEbayGroupReview(\''+esc(f.id)+'\')" title="List every cover of this title as one eBay listing with a native Cover variation dropdown">LIST ALL COVERS · 1 EBAY LISTING</button>':'';
  return '<section class="foc-family"><header class="foc-family-head"><div><div class="foc-family-title">'+esc(f.title)+'</div><div style="font:9px/1.55 var(--font-mono);color:var(--dim)">'+esc([f.publisher,f.writer?'W: '+f.writer:'',f.interiorArtist?'A: '+f.interiorArtist:'',f.onSaleDate?'On sale '+displayDate(f.onSaleDate):''].filter(Boolean).join(' · '))+'</div>'+focFamilyPillsHtml(f)+'</div><div class="foc-toolbar">'+groupListBtn+'<label style="font:8px var(--font-mono);color:var(--dim)">HEAT <select class="tsi" data-family-heat="'+esc(f.id)+'" onchange="saveFocFamily(\''+esc(f.id)+'\')"><option value="">—</option>'+[1,2,3,4,5].map(function(n){return'<option '+(Number(f.heat)===n?'selected':'')+'>'+n+'</option>';}).join('')+'</select></label><label style="font:8px var(--font-mono);color:var(--dim)">FLAG <select class="tsi" data-family-category="'+esc(f.id)+'" onchange="saveFocFamily(\''+esc(f.id)+'\')"><option value="">None</option>'+[['dont_sleep',"DON\'T SLEEP"],['sleeper_watch','SLEEPER WATCH'],['solid_stock','SOLID STOCK'],['special_order','SPECIAL ORDER'],['pass','PASS']].map(function(x){return'<option value="'+x[0]+'" '+(f.heatCategory===x[0]?'selected':'')+'>'+x[1]+'</option>';}).join('')+'</select></label></div></header><div class="foc-sku-grid">'+f.variants.map(skuCard).join('')+'</div></section>';
}

function renderCycle(){
  var c=state.cycle;if(!c)return;var publishers=Array.from(new Set(state.families.map(function(f){return f.publisher;}).filter(Boolean))).sort();var allSkus=state.families.reduce(function(a,f){return a.concat(f.variants);},[]);var customerQty=allSkus.reduce(function(s,v){return s+Number(v.customerQty||0);},0);var storeQty=allSkus.reduce(function(s,v){return s+Number(v.storeQuantity||0);},0);var incentiveReq=allSkus.reduce(function(s,v){return s+Number(v.waitlistRequests||0);},0);
  panel().innerHTML='<section class="foc-hero"><div class="foc-toolbar"><button class="hbtn" onclick="loadFocCycles()">← CYCLES</button><button class="hbtn" style="color:var(--purple)" onclick="openFocReview()">FINAL FOC REVIEW</button><button class="hbtn" style="color:var(--gold)" title="Every cover this week: what can go on eBay now, and what\'s waiting on art, a price or the date" onclick="openFocListWeek()">📤 LIST WEEK ON EBAY</button><button class="hbtn" style="color:var(--blue)" onclick="openFocIntelligence()">🧠 FOC INTELLIGENCE</button><button class="hbtn" style="color:var(--gold)" title="Cover artists, characters and series to always flag when ordering" onclick="openFocWatchList()">⭐ WATCH LIST</button>'+(c.distributor==="Lunar"?"":"<button class=\"hbtn\" onclick=\"exportFocPrh()\">EXPORT PRH ORDER</button>")+'<button class="hbtn" style="color:var(--g)" onclick="openReceiveShipment()">RECEIVE SHIPMENT</button><button class="hbtn" title="Who each copy in this FOC week is for: eBay orders, website preorders, pull lists" onclick="openFocPickList()">📋 PICK LIST</button>'+'<button class="hbtn" title="Open the Whatnot tab with this week\'s received, in-stock books chosen" onclick="sendFocShipmentToWhatnot(\''+esc(c.id)+'\')">SEND TO WHATNOT</button>'+(c.status!=='archived'?'<button class="hbtn" onclick="toggleFocCycle()">'+(c.isOpen?'LOCK ORDERS':'UNLOCK ORDERS')+'</button>':'')+(c.status==='archived'?'<button class="hbtn" onclick="unarchiveFocCycle()">SHOW ON SITE (LOCKED)</button>':'<button class="hbtn danger" onclick="archiveFocCycle()">HIDE FROM SITE</button>')+'<a class="hbtn" href="https://www.themanapocket.com/preorders?cycle='+encodeURIComponent(c.foc_date)+'" target="_blank" rel="noopener" style="text-decoration:none">VIEW CUSTOMER PAGE</a></div><div style="display:flex;justify-content:space-between;gap:12px;align-items:end;flex-wrap:wrap;margin-top:14px"><div><div style="font:900 22px/1.1 \'Orbitron\',monospace;color:var(--text)">FOC '+esc(displayDate(c.foc_date))+'</div><div style="font:10px/1.6 var(--font-mono);color:var(--dim)">'+esc(c.source_filename||(c.distributor||'PRH'))+' · '+(c.status==='archived'?'HIDDEN FROM SITE':(c.isOpen?'UNLOCKED FOR ORDERS':'VISIBLE BUT LOCKED'))+'</div></div><label style="font:8px var(--font-mono);color:var(--dim)">CUSTOMER CUTOFF · PACIFIC<input id="foc-cycle-cutoff" class="tsi" type="datetime-local" value="'+esc(pacificDateTimeInput(c.customer_cutoff_at))+'" onchange="saveFocCycleCutoff()" style="margin:3px 0 0"><span style="display:block;margin-top:4px">Set a future cutoff before unlocking an expired FOC.</span></label></div><div class="foc-stats"><div class="foc-stat"><b>'+allSkus.length+'</b><span>Exact cover SKUs</span></div><div class="foc-stat"><b>'+state.families.length+'</b><span>Title families</span></div><div class="foc-stat"><b>'+customerQty+'</b><span>Customer copies</span></div><div class="foc-stat"><b>'+storeQty+'</b><span>Store copies</span></div><div class="foc-stat"><b>'+incentiveReq+'</b><span>Incentive requests</span></div></div></section>'+focEbayHealthPanelHtml()+'<div class="panel foc-toolbar" style="margin-bottom:12px"><input id="foc-admin-search" class="tsi" placeholder="Search title, writer, artist…" value="'+esc(state.query)+'" oninput="filterFocAdmin(this.value)"><select class="tsi" onchange="filterFocPublisher(this.value)"><option value="all" '+(state.publisher==='all'?'selected':'')+'>All publishers</option>'+publishers.map(function(p){return'<option value="'+esc(p.toLowerCase())+'" '+(state.publisher===p.toLowerCase()?'selected':'')+'>'+esc(p)+'</option>';}).join('')+'</select><select class="tsi" onchange="filterFocFlag(this.value)"><option value="all" '+(state.flag==='all'?'selected':'')+'>All comics</option><option value="first" '+(state.flag==='first'?'selected':'')+'>#1 issues</option><option value="foil" '+(state.flag==='foil'?'selected':'')+'>Foil covers</option><option value="incentive" '+(state.flag==='incentive'?'selected':'')+'>Incentives</option><option value="demand" '+(state.flag==='demand'?'selected':'')+'>Customer demand</option><option value="sells" '+(state.flag==='sells'?'selected':'')+'>Sells here · runs · watch list</option></select><select class="tsi" onchange="filterFocEbay(this.value)"><option value="all" '+(state.ebay==='all'?'selected':'')+'>All eBay statuses</option><option value="ELIGIBLE_NOW" '+(state.ebay==='ELIGIBLE_NOW'?'selected':'')+'>Eligible, not listed</option><option value="TOO_EARLY" '+(state.ebay==='TOO_EARLY'?'selected':'')+'>Too early</option><option value="LISTED" '+(state.ebay==='LISTED'?'selected':'')+'>Already listed</option><option value="SOLD_OUT" '+(state.ebay==='SOLD_OUT'?'selected':'')+'>Presale sold out</option><option value="RELEASED" '+(state.ebay==='RELEASED'?'selected':'')+'>Released (on sale)</option><option value="ACTION_REQUIRED" '+(state.ebay==='ACTION_REQUIRED'?'selected':'')+'>Action required</option></select><span id="foc-visible-count" style="font:9px var(--font-mono);color:var(--dim)"></span></div>'+
    // Store request: listing eligible FOC covers on eBay one at a time
    // (open the review modal, edit, LIST, close, find the next one, repeat)
    // was too much clicking for a whole cycle's worth of ratio/incentive
    // books. Check the ones to list (or SELECT ALL ELIGIBLE), then LIST
    // SELECTED opens the exact same single-cover review-and-edit modal
    // already trusted for one-at-a-time listings, just chained: submitting
    // one automatically opens the next selected cover's review instead of
    // just closing, until the queue is empty.
    '<div class="panel foc-toolbar" style="margin-bottom:12px"><button class="hbtn" onclick="toggleFocEbayBulkSelectAll(true)">SELECT ALL ELIGIBLE</button><button class="hbtn" onclick="toggleFocEbayBulkSelectAll(false)">SELECT NONE</button><button class="hbtn" style="background:rgba(255,209,102,.12);border-color:rgba(255,209,102,.35);color:var(--gold)" onclick="startFocEbayBulkListing()">LIST SELECTED ON EBAY</button><button class="hbtn" onclick="refreshFocPresaleEbayDescriptions()" title="Adds the PRESALE banner, the bagged &amp; boarded / Gemini mailer line and the Gemini box size to presales already live on eBay">UPDATE LIVE PRESALE DESCRIPTIONS</button><span id="foc-ebay-bulk-count" style="font:9px var(--font-mono);color:var(--dim)"></span></div>'+
    '<div class="panel foc-toolbar" style="margin-bottom:12px"><button class="hbtn" onclick="toggleFocPublishBulkSelectAll(true)">SELECT ALL VISIBLE COVERS</button><button class="hbtn" onclick="toggleFocPublishBulkSelectAll(false)">SELECT NONE</button><button class="hbtn" style="background:rgba(120,220,150,.12);border-color:rgba(120,220,150,.35);color:var(--g)" onclick="bulkSetCustomerEnabled(true)">SHOW SELECTED ON WEBSITE</button><button class="hbtn" onclick="bulkSetCustomerEnabled(false)">HIDE SELECTED FROM WEBSITE</button><span id="foc-publish-bulk-count" style="font:9px var(--font-mono);color:var(--dim)"></span></div>'+
    '<div id="foc-family-list"></div>';
  renderFamilies();
}

function renderFamilies(){var list=document.getElementById('foc-family-list');if(!list)return;focIntel.memo={};var rows=visibleFamilies();var count=document.getElementById('foc-visible-count');if(count)count.textContent=rows.length+' title families';list.innerHTML=rows.length?rows.map(familyCard).join(''):'<div class="panel" style="padding:28px;text-align:center;color:var(--dim)">Nothing matches those filters.</div>';renderFocEbayBulkCount();renderFocPublishBulkCount();}

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
  var ebay=Number(v.ebayPresold||0),total=Number(v.customerQty||0)+ebay+Number(v.storeQuantity||0);
  if(total<=0)return'';
  var presold=focPresoldChips(ebay,0,0);
  return '<div class="foc-sku-fields" data-receive-row style="grid-template-columns:48px 2fr 1fr;align-items:center;gap:10px;padding:8px;border-bottom:1px solid var(--border)">'+focThumbHtml(v.coverImageUrl,v.variantLabel)+
    '<div><div style="font-weight:700;font-size:11px;color:var(--text)">'+esc(v.variantLabel)+'</div><div style="font:9px/1.4 var(--font-mono);color:var(--dim)">Ordered '+total+' (customers '+Number(v.customerQty||0)+(ebay?' + eBay presold '+ebay:'')+' + store '+Number(v.storeQuantity||0)+') · UPC '+esc(v.upc)+'</div>'+(presold.length?'<div style="font:9px/1.5 var(--font-mono);display:flex;gap:8px;flex-wrap:wrap">'+presold.join('')+'</div>':'')+'</div>'+
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
  var isLunar=(state.cycle&&state.cycle.distributor)==='Lunar';
  if(isLunar)await loadLunarDiscountSettings();
  var variantById={};state.families.forEach(function(f){(f.variants||[]).forEach(function(v){variantById[v.id]=v;});});
  document.querySelectorAll('[data-receive-sku]').forEach(function(el){
    var qty=Math.max(0,parseInt(el.value,10)||0);
    var v=variantById[el.dataset.receiveSku]||{};
    if(qty>0)lines.push({skuId:el.dataset.receiveSku,receivedQty:qty,unitCost:isLunar?focReceiveUnitCost('Lunar',v.publisher,v.msrpCents,0):undefined});
  });
  if(!lines.length){toast_dash('Enter at least one received quantity');return;}
  if(status)status.textContent='Creating inventory…';
  try{
    var d=await api('/foc/admin/receive',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),cycleId:state.cycle.id,lines:lines})});
    toast_dash(d.createdInventoryCount+' item'+(d.createdInventoryCount===1?'':'s')+' added to inventory');
    focHoldNotice(d);
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
    var told=pickNoticeLine(d.notified);if(told)toast_dash(told);
    await openCycle(state.cycle.id);
    openFocPickList([state.cycle.id]);
    await queueReceivedLabels(d.labelItems,d.receivedSummary);
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
    focHoldNotice(d);
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
    // Store report: adding one book rebuilt the whole cover wall ("Building
    // the cover wall…") and jumped back to the top -- same one-cover refresh
    // as a field save or single eBay listing instead.
    await refreshCycleFamilies();
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
var focEbayCapture=null;
// Presales already live on eBay keep whatever description they were
// published with; this brings them up to date (PRESALE banner, the bagged
// & boarded / Gemini mailer line in the shipping section, Gemini box size)
// without touching anything else on the listing.
async function refreshFocPresaleEbayDescriptions(){
  if(!confirm('Update the description on every presale that is live on eBay?\n\nAdds the PRESALE banner and the "bagged & boarded, shipped in a Gemini mailer" line to the shipping section, the Gemini box size, and the large cover photo for Lunar books. Price, quantity and everything else stay as they are.'))return;
  toast_dash('Updating live presale listings on eBay…');
  try{
    var d=await api('/foc/ebay/refresh-presale-descriptions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId()})});
    var msg=d.updated.length+' listing'+(d.updated.length===1?'':'s')+' updated'+(d.unchanged?' · '+d.unchanged+' already up to date':'')+(d.skippedMultiCover?' · '+d.skippedMultiCover+' multi-cover skipped':'')+(d.failed.length?' · '+d.failed.length+' failed':'');
    toast_dash(msg);
    if(d.failed.length)alert(msg+'\n\n'+d.failed.map(function(f){return f.name+': '+f.error;}).join('\n'));
  }catch(e){toast_dash('Could not update listings: '+e.message);}
}
window.refreshFocPresaleEbayDescriptions=refreshFocPresaleEbayDescriptions;
// ── LIST WEEK ON EBAY ──
// Store ask: "list all FOC week to eBay at one time" -- covers without art
// yet, books too early, books that need a price, and the right weight.
// Sorts every cover of the open FOC week, then lists everything ready in
// one go: an issue with 2+ ready covers as one listing with a Cover choice
// (what the store does by hand), a single cover on its own. Each listing
// goes through the same preview and template as the review screens --
// they just aren't shown.
function focSingleWeightOz(){ try{var v=Number(localStorage.getItem('foc_ebay_single_weight_oz'));if(v>0&&v<100)return v;}catch(e){} return 8; }
function focListWeightOz(v){ var c=Number(v.priceCents||0)||Number(v.msrpCents||0); return c>=2000?29:c>=1000?15:focSingleWeightOz(); }
function focListNeedsPrice(v){ return !(Number(v.priceCents||0)>0)&&(!!v.isIncentive||!!(v.flags&&v.flags.foil)||!(Number(v.msrpCents||0)>0)); }
function focListHasQty(v){ return Number(v.storeQuantity||0)>0||(!!v.isIncentive&&Number(v.securedQuantity||0)>0); }
// Store asks: no listing twice; all covers in one listing; a cover with
// no art yet goes in with a "cover art coming soon" picture (swapped for
// the real art automatically) instead of waiting or getting its own
// listing; a cover ready after its issue is already up joins that listing.
function focListWeekPlan(families){
  var plan={groups:[],singles:[],adds:[],needPrice:[],noArt:[],tooEarly:[],laterGroups:[],laterSingles:[],laterAdds:[],noDate:[],noQty:[],listed:0,released:0};
  (families||[]).forEach(function(f){
    var now=[],later=[],familyListed=false,familyGroup=false;
    (f.variants||[]).forEach(function(v){
      var st=v.ebayPresaleStatus;
      if(st==='LISTED'||st==='SOLD_OUT'){plan.listed++;familyListed=true;if(v.ebayTradingGroup)familyGroup=true;return;}
      if(st==='RELEASED'){plan.released++;return;}
      if(st==='ACTION_REQUIRED'){plan.noDate.push(v);return;}
      if(!focListHasQty(v)){plan.noQty.push(v);return;}
      if(st!=='ELIGIBLE_NOW'&&st!=='TOO_EARLY')return;
      if(focListNeedsPrice(v)){plan.needPrice.push(v);return;}
      if(st==='TOO_EARLY'){plan.tooEarly.push(v);later.push(v);return;}
      now.push(v);
    });
    var art=function(list){return list.filter(function(v){return !!v.coverImageUrl;});};
    var groupNow=false;
    if(familyGroup)plan.adds=plan.adds.concat(now);
    else if(!familyListed&&now.length>=2&&art(now).length){plan.groups.push({familyId:f.id,title:f.title,covers:now});groupNow=true;}
    else{plan.singles=plan.singles.concat(art(now));plan.noArt=plan.noArt.concat(now.filter(function(v){return !v.coverImageUrl;}));}
    if(familyGroup||groupNow)plan.laterAdds=plan.laterAdds.concat(later);
    else if(!familyListed&&!now.length&&later.length>=2)plan.laterGroups.push({familyId:f.id,title:f.title,covers:later});
    else plan.laterSingles=plan.laterSingles.concat(later);
  });
  plan.tooEarly.sort(function(a,b){return String(a.ebayEligibleDate||'').localeCompare(String(b.ebayEligibleDate||''));});
  return plan;
}
var focListWeekState={running:false,stop:false,weights:{},qtys:{},policies:null,queue:null};
function focAutoListEmail(){ try{return localStorage.getItem('foc_autolist_email')||'hintline@themanapocket.com';}catch(e){return 'hintline@themanapocket.com';} }
async function focLoadAutoListQueue(){
  try{var d=await api('/foc/ebay/auto-list?store_id='+encodeURIComponent(getActiveStoreId()));focListWeekState.queue=d.items||[];if(d.email){try{localStorage.setItem('foc_autolist_email',d.email);}catch(e){}}}
  catch(e){focListWeekState.queue=focListWeekState.queue||[];}
}
function focQueuedFor(skuId){ return (focListWeekState.queue||[]).find(function(q){return (q.skuIds||[]).indexOf(skuId)>=0;})||null; }
async function openFocListWeek(){
  if(!state.cycle)return;
  busy('Sorting this week\'s covers…');
  try{var data=await api('/foc/admin/cycles?store_id='+encodeURIComponent(getActiveStoreId())+'&cycle_id='+encodeURIComponent(state.cycle.id));state.cycle=data.cycle;state.families=data.families||[];}catch(e){}
  if(!focListWeekState.policies){
    try{var pd=await api('/ebay/business-policies');var CLONE=/-\s*FOC\s+\d+D\s+Handling\s*$/i;focListWeekState.policies={list:((pd.fulfillment&&pd.fulfillment.policies)||[]).filter(function(p){return !CLONE.test(p.name||'');}),error:pd.needsToken?'eBay is not connected':((pd.fulfillment&&pd.fulfillment.error)||'')};}
    catch(e){focListWeekState.policies={list:[],error:e.message};}
  }
  await focLoadAutoListQueue();
  renderFocListWeek();
}
function focListQty(v){ return focListWeekState.qtys[v.id]!=null?focListWeekState.qtys[v.id]:focRatioQty(v); }
function focListRowHtml(v,opts){
  opts=opts||{};
  var price=Number(v.priceCents||0)||Number(v.msrpCents||0);
  var w=focListWeekState.weights[v.id]!=null?focListWeekState.weights[v.id]:focListWeightOz(v);
  return '<div style="display:grid;grid-template-columns:40px 1fr auto;gap:8px;align-items:center;padding:6px 8px;border-bottom:1px solid var(--border)">'+focThumbHtml(v.coverImageUrl,v.title)+
    '<div style="min-width:0"><div style="font-weight:700;font-size:11px;color:var(--text)">'+esc(v.title)+(v.variantLabel&&v.variantLabel!=='Cover A'?' · '+esc(v.variantLabel):'')+'</div>'+
    '<div style="font:9px/1.5 var(--font-mono);color:var(--dim)">'+(opts.note||'')+'</div></div>'+
    (opts.edit?'<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end"><label style="font:8px var(--font-mono);color:var(--dim)">PRICE $<input class="tsi" type="number" min="0" step="0.01" style="width:70px;margin:2px 0 0" value="'+(price?(price/100).toFixed(2):'')+'" placeholder="'+(v.isIncentive?'ratio':'')+'" onchange="focListSetPrice(\''+esc(v.id)+'\',this.value)"></label>'+
      (opts.weight?'<label style="font:8px var(--font-mono);color:var(--dim)">QTY<input class="tsi" type="number" min="1" max="200" style="width:50px;margin:2px 0 0" value="'+focListQty(v)+'" onchange="focListWeekState.qtys[\''+esc(v.id)+'\']=Math.max(1,parseInt(this.value,10)||1)"></label>'+
        '<label style="font:8px var(--font-mono);color:var(--dim)">OZ<input class="tsi" type="number" min="1" step="0.5" style="width:54px;margin:2px 0 0" value="'+w+'" onchange="focListWeekState.weights[\''+esc(v.id)+'\']=Number(this.value)||'+w+'"></label>':'')+'</div>':(opts.right||'<span></span>'))+'</div>';
}
function renderFocListWeek(){
  var host=panel();if(!host||!state.cycle)return;
  var plan=focListWeekPlan(state.families),pol=focListWeekState.policies||{list:[]};
  var lastPolicy='';try{lastPolicy=localStorage.getItem('foc_ebay_last_ship_policy_id')||'';}catch(e){}
  var listings=plan.groups.length+plan.singles.length,adds=plan.adds.length,covers=plan.groups.reduce(function(a,g){return a+g.covers.length;},0)+plan.singles.length+adds;
  var toQueue=plan.tooEarly.filter(function(v){return !focQueuedFor(v.id);}).length;
  var section=function(title,color,rows,intro,open){return rows?'<details class="foc-family"'+(open?' open':'')+'><summary class="foc-family-head" style="cursor:pointer"><div class="foc-family-title" style="color:'+color+'">'+title+'</div></summary>'+(intro?'<div style="font:9px/1.6 var(--font-mono);color:var(--dim);padding:6px 8px">'+intro+'</div>':'')+rows+'</details>':'';};
  var soon=function(v){return v.coverImageUrl?'':' · <b style="color:var(--gold)">"cover art coming soon" picture until the art is out</b>';};
  var readyRows=plan.groups.map(function(g){return '<div style="padding:6px 8px 0;font:900 10px var(--font-mono);color:var(--gold)">'+esc(g.title)+' · ONE LISTING, '+g.covers.length+' COVERS TO CHOOSE FROM</div>'+g.covers.map(function(v){return focListRowHtml(v,{edit:true,weight:true,note:'cover in the '+esc(g.title)+' listing'+(v.isIncentive?' · ratio 1:'+focRatioOf(v):'')+soon(v)});}).join('');}).join('')+
    (plan.adds.length?'<div style="padding:6px 8px 0;font:900 10px var(--font-mono);color:var(--gold)">JOINING A LISTING THAT\'S ALREADY UP (no new listing)</div>'+plan.adds.map(function(v){return focListRowHtml(v,{edit:true,weight:true,note:'added as another Cover choice on its issue\'s live listing'+(v.isIncentive?' · ratio 1:'+focRatioOf(v):'')+soon(v)});}).join(''):'')+
    plan.singles.map(function(v){return focListRowHtml(v,{edit:true,weight:true,note:'its own listing'+(v.isIncentive?' · ratio 1:'+focRatioOf(v):'')});}).join('');
  var parts=[listings?listings+' NEW LISTING'+(listings===1?'':'S'):'',adds?'ADD '+adds+' COVER'+(adds===1?'':'S')+' TO LIVE LISTINGS':'',toQueue?'QUEUE '+toQueue+' FOR LATER':''].filter(Boolean);
  var label=parts.length?'📤 '+parts.join(' + '):'NOTHING TO LIST';
  host.innerHTML='<section class="foc-hero"><div class="foc-toolbar"><button class="hbtn" onclick="openFocCycle(\''+esc(state.cycle.id)+'\')">← COVER WALL</button><button class="hbtn" onclick="openFocListWeek()">↻ REFRESH</button></div>'+
    '<div style="font:900 20px/1.1 \'Orbitron\',monospace;color:var(--text);margin-top:10px">List this week on eBay · '+esc(displayDate(state.cycle.foc_date))+'</div>'+
    '<div style="font:10px/1.6 var(--font-mono);color:var(--dim);margin-top:4px">Everything that can go on eBay now is under READY. Each listing uses your Comic template, presale title and bar, Gemini box size and the shipping policy below -- the same as listing one by one. Too-early covers are built now and list themselves on their eBay presale date.</div>'+
    '<div class="foc-toolbar" style="margin-top:10px;align-items:end;flex-wrap:wrap">'+
      '<label style="font:9px var(--font-mono);color:var(--dim)">SHIPPING POLICY<select id="foc-lw-policy" class="tsi" style="margin-top:3px">'+(lastPolicy?'':'<option value="" selected disabled>-- pick one --</option>')+(pol.list||[]).map(function(p){return '<option value="'+esc(p.id)+'"'+(String(p.id)===lastPolicy?' selected':'')+'>'+esc(p.name)+'</option>';}).join('')+'</select></label>'+
      '<label style="font:9px var(--font-mono);color:var(--dim)">SINGLE ISSUE WEIGHT (OZ, PACKED)<input id="foc-lw-single-oz" class="tsi" type="number" min="1" step="0.5" style="width:70px;margin-top:3px" value="'+focSingleWeightOz()+'" onchange="focListSetSingleOz(this.value)"></label>'+
      '<label style="font:9px var(--font-mono);color:var(--dim)">EMAIL WHEN AUTO-LISTED<input id="foc-lw-email" class="tsi" type="email" style="width:220px;margin-top:3px" value="'+esc(focAutoListEmail())+'"></label>'+
      '<button class="hbtn" style="color:var(--g);padding:10px 14px"'+((listings||adds||toQueue)&&!focListWeekState.running?'':' disabled')+' onclick="focListWeekRun()">'+label+'</button></div>'+
    (pol.error?'<div style="font:9px var(--font-mono);color:var(--red);margin-top:6px">Shipping policies: '+esc(pol.error)+'</div>':'')+
    '<div id="foc-lw-progress" style="font:10px var(--font-mono);color:var(--gold);margin-top:8px"></div></section>'+
    section('READY TO LIST ('+covers+')','var(--g)',readyRows,'Change a price, quantity or weight here before listing. Ratio covers default to 1 of a 1:100, 2 of a 1:50, 4 of a 1:25 (up to 10, never more than you ordered). Trades and hardcovers are weighted heavier (15 / 29 oz).',true)+
    section('NEEDS YOUR PRICE ('+plan.needPrice.length+')','var(--gold)',plan.needPrice.map(function(v){return focListRowHtml(v,{edit:true,note:(v.isIncentive?'ratio / incentive cover -- cover price would undersell it':'no price on the file')+(v.ebayPresaleStatus==='TOO_EARLY'?' · lists on '+esc(displayDate(v.ebayEligibleDate||'')):'')});}).join(''),'Type a price and it moves to READY (or the queue, if it\'s too early).',true)+
    section('NO COVER ART YET ('+plan.noArt.length+')','var(--gold)',plan.noArt.map(function(v){return focListRowHtml(v,{note:'no cover image on file'});}).join(''),'A cover with no art goes into its issue\'s listing with a "cover art coming soon" picture -- these are the ones with no other cover to list alongside, so they wait for art. Lunar art is looked for every 6 hours'+(state.cycle.distributor==='Lunar'?' -- or <a href="#" onclick="fillLunarCovers();return false" style="color:var(--g)">FIND LUNAR COVERS</a> now':'')+'; paste art on the cover wall for anything else.',plan.noArt.length<=12)+
    section('TOO EARLY -- LISTS ITSELF LATER ('+plan.tooEarly.length+')','var(--blue)',plan.tooEarly.map(function(v){var q=focQueuedFor(v.id);return focListRowHtml(v,{note:'eBay presale opens '+esc(displayDate(v.ebayEligibleDate||''))+' (on sale '+esc(displayDate(String(v.onSaleDate||'').slice(0,10)))+')'+(q&&q.lastError?' · last try: '+esc(q.lastError):''),
      right:q?'<span style="display:flex;gap:6px;align-items:center"><span style="color:var(--g);font:9px var(--font-mono)">✓ QUEUED</span><button class="hbtn" style="padding:3px 7px;font-size:8px" onclick="focUnqueueAutoList(\''+esc(q.key)+'\')">REMOVE</button></span>':'<span style="color:var(--dim);font:9px var(--font-mono)">not queued yet</span>'});}).join(''),'eBay presales have to ship soon after they sell, so these open a set number of business days before they go on sale (EBAY SAFE DAYS on the FOC tab). Queued ones list themselves that day (checked every 6 hours) and you get an email at '+esc(focAutoListEmail())+'. Art that arrives before then is used.',true)+
    section('NO ON-SALE DATE ('+plan.noDate.length+')','var(--red)',plan.noDate.map(function(v){return focListRowHtml(v,{note:'the distributor file has no on-sale date'});}).join(''),'',false)+
    section('NOT ORDERING ANY ('+plan.noQty.length+')','var(--dim)',plan.noQty.map(function(v){return focListRowHtml(v,{note:'store quantity is 0'});}).join(''),'Set a store quantity on the cover wall to list one.',false)+
    '<div class="panel" style="font:10px var(--font-mono);color:var(--dim)">'+plan.listed+' already on eBay · '+plan.released+' already released</div>';
}
async function focUnqueueAutoList(key){
  try{var d=await api('/foc/ebay/auto-list',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),key:key})});focListWeekState.queue=d.items||[];toast_dash('Taken off the auto-list');renderFocListWeek();}
  catch(e){toast_dash('Could not remove: '+e.message);}
}
async function focListSetPrice(skuId,value){
  var p=Math.round((Number(value)||0)*100)/100;if(!(p>0))return;
  try{await api('/foc/admin/sku',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),skuId:skuId,customerPrice:p})});
    state.families.forEach(function(f){(f.variants||[]).forEach(function(v){if(v.id===skuId){v.priceCents=Math.round(p*100);v.priceRequired=false;}});});
    toast_dash('Price saved: $'+p.toFixed(2));renderFocListWeek();}
  catch(e){toast_dash('Could not save the price: '+e.message);}
}
function focListSetSingleOz(v){ var n=Number(v);if(!(n>0&&n<100))return; try{localStorage.setItem('foc_ebay_single_weight_oz',String(n));}catch(e){} renderFocListWeek(); }
// Opens a listing's normal review screen out of sight, sets weight,
// quantities (and, for an issue, which covers go in it), then presses LIST
// -- or, for a too-early one (mode 'queue'), keeps the finished listing to
// post on its date.
async function focListWeekOne(kind,id,coverIds,weightOz,qtys,mode){
  qtys=qtys||{};
  var modalId=kind==='group'?'foc-ebay-group-modal':'foc-ebay-review-modal',opts={draft:mode==='queue'};
  if(kind==='group')await openFamilyEbayGroupReview(id,opts);else await openEbayPresaleReview(id,opts);
  var modal=document.getElementById(modalId);if(!modal)return {ok:false,error:'review screen did not open'};
  modal.style.visibility='hidden';
  var pre=kind==='group'?'foc-eb-grp-':'foc-eb-';
  // An issue eBay won't take as one listing (fewer than 2 covers it will
  // accept) goes up one cover at a time instead.
  if(!document.getElementById(pre+'title')){var err=modal.textContent.trim().slice(0,200);modal.remove();return {ok:false,fallback:kind==='group',error:err||'preview failed'};}
  if(kind==='group'){
    var picked=0;modal.querySelectorAll('[data-eb-cover-cb]').forEach(function(cb){cb.checked=coverIds.indexOf(cb.getAttribute('data-eb-cover-cb'))>=0&&!cb.disabled;if(cb.checked)picked++;});
    if(picked<2){modal.remove();return {ok:false,fallback:true,error:'fewer than 2 covers eBay will take together'};}
    modal.querySelectorAll('[data-eb-cover-qty]').forEach(function(el){var q=qtys[el.getAttribute('data-eb-cover-qty')];if(q>0)el.value=String(q);});
  } else {
    var qEl=document.getElementById('foc-eb-qty');if(qEl&&qtys[id]>0)qEl.value=String(qtys[id]);
  }
  var w=document.getElementById(pre+'weight'),u=document.getElementById(pre+'weight-unit');
  if(w&&u&&weightOz>0){u.value='OUNCE';u.querySelectorAll('option').forEach(function(o){if(o.value==='OUNCE')o.setAttribute('selected','');else o.removeAttribute('selected');o.selected=o.value==='OUNCE';});w.value=String(weightOz);}
  if(mode==='queue')focEbayCapture={};
  try{if(kind==='group')await submitFamilyEbayGroupReview(id);else await submitEbayPresaleReview(id);}
  finally{var cap=focEbayCapture;focEbayCapture=null;}
  var still=document.getElementById(modalId);
  if(mode==='queue'&&cap&&cap.payload){if(still)still.remove();return {ok:true,payload:cap.payload};}
  if(!still)return mode==='queue'?{ok:false,error:'could not build the listing'}:{ok:true};
  var st=document.getElementById(kind==='group'?'foc-eb-grp-status':'foc-eb-status');
  var msg=(st&&st.textContent)||'not listed';still.remove();
  return {ok:false,error:msg};
}
function focListJob(kind,id,label,covers,mode){
  return {kind:kind,id:id,label:label,mode:mode,coverIds:covers.map(function(v){return v.id;}),
    oz:Math.max.apply(null,covers.map(function(v){return focListWeekState.weights[v.id]!=null?focListWeekState.weights[v.id]:focListWeightOz(v);})),
    qtys:covers.reduce(function(m,v){m[v.id]=focListQty(v);return m;},{}),
    eligibleDate:covers.map(function(v){return String(v.ebayEligibleDate||'');}).sort().pop()||''};
}
// A cover joining its issue's live listing: no review screen -- the
// listing already has its title, description and policies.
async function focListWeekAdd(j){
  var payload={skuId:j.id,quantity:j.qtys[j.id]||1};
  if(j.mode==='queue')return {ok:true,payload:payload};
  try{var d=await api('/foc/ebay/add-to-group-listing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({storeId:getActiveStoreId()},payload))});(d.warnings||[]).forEach(function(w){toast_dash(w);});return {ok:true};}
  catch(e){return {ok:false,error:e.message};}
}
function focCoverLabel(v){ return (v.title||'Cover')+(v.variantLabel&&v.variantLabel!=='Cover A'?' · '+v.variantLabel:''); }
async function focListWeekRun(){
  if(focListWeekState.running)return;
  var policy=(document.getElementById('foc-lw-policy')||{}).value||'';
  if(!policy){toast_dash('Pick a shipping policy first');return;}
  try{localStorage.setItem('foc_ebay_last_ship_policy_id',policy);}catch(e){}
  var email=((document.getElementById('foc-lw-email')||{}).value||'').trim()||focAutoListEmail();
  try{localStorage.setItem('foc_autolist_email',email);}catch(e){}
  var plan=focListWeekPlan(state.families);
  var jobs=plan.groups.map(function(g){return focListJob('group',g.familyId,g.title+' ('+g.covers.length+' covers)',g.covers,'list');})
    .concat(plan.singles.map(function(v){return focListJob('single',v.id,focCoverLabel(v),[v],'list');}))
    .concat(plan.adds.map(function(v){return focListJob('add',v.id,focCoverLabel(v)+' (added to its listing)',[v],'list');}))
    .concat(plan.laterGroups.filter(function(g){return !g.covers.every(function(v){return focQueuedFor(v.id);});}).map(function(g){return focListJob('group',g.familyId,g.title+' ('+g.covers.length+' covers)',g.covers,'queue');}))
    .concat(plan.laterSingles.filter(function(v){return !focQueuedFor(v.id);}).map(function(v){return focListJob('single',v.id,focCoverLabel(v),[v],'queue');}))
    .concat(plan.laterAdds.filter(function(v){return !focQueuedFor(v.id);}).map(function(v){return focListJob('add',v.id,focCoverLabel(v)+' (joins its listing)',[v],'queue');}));
  if(!jobs.length){toast_dash('Nothing is ready to list');return;}
  var now=jobs.filter(function(j){return j.mode==='list';}),later=jobs.filter(function(j){return j.mode==='queue';});
  if(!confirm((now.length?'List '+now.length+' eBay presale listing'+(now.length===1?'':'s')+' now:\n'+now.map(function(j){return '• '+j.label+' -- '+j.oz+' oz';}).join('\n')+'\n\n':'')+
    (later.length?'Queue '+later.length+' to list themselves on their eBay date (email to '+email+'):\n'+later.map(function(j){return '• '+j.label+' -- '+j.eligibleDate;}).join('\n'):'')))return;
  focListWeekState.running=true;focListWeekState.stop=false;focEbayBulkQueue=null;
  var overlay=document.createElement('div');overlay.id='foc-lw-overlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:10001;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML='<div style="max-width:440px;width:100%;background:var(--surf);border:1px solid var(--border);border-radius:10px;padding:16px;font:11px/1.6 var(--font-mono);color:var(--text)"><div style="font:900 13px \'Orbitron\',monospace;color:var(--gold);margin-bottom:8px">LISTING ON EBAY</div><div id="foc-lw-now">Starting…</div><div id="foc-lw-bar" style="height:6px;background:var(--surf2);border-radius:3px;margin:10px 0"><div style="height:6px;width:0;background:var(--g);border-radius:3px"></div></div><button class="hbtn" onclick="focListWeekState.stop=true;this.textContent=\'STOPPING AFTER THIS ONE…\'">STOP</button></div>';
  document.body.appendChild(overlay);
  var ok=0,failed=[],queued=[];
  for(var i=0;i<jobs.length&&!focListWeekState.stop;i++){
    var j=jobs[i],nowEl=document.getElementById('foc-lw-now');if(nowEl)nowEl.textContent=(i+1)+' of '+jobs.length+(j.mode==='queue'?' (building for later): ':': ')+j.label;
    var r;try{r=j.kind==='add'?await focListWeekAdd(j):await focListWeekOne(j.kind,j.id,j.coverIds,j.oz,j.qtys,j.mode);}catch(e){r={ok:false,error:e.message};}
    if(r.ok&&j.mode==='queue')queued.push({kind:j.kind,familyId:j.kind==='group'?j.id:'',skuIds:j.coverIds,label:j.label,eligibleDate:j.eligibleDate,payload:r.payload});
    else if(r.ok)ok++;
    else if(r.fallback)jobs.splice.apply(jobs,[i+1,0].concat(j.coverIds.map(function(cid){var v=allFocSkus().find(function(x){return x.id===cid;})||{id:cid};return focListJob('single',cid,focCoverLabel(v),[v],j.mode);})));
    else failed.push(j.label+': '+r.error);
    var bar=overlay.querySelector('#foc-lw-bar div');if(bar)bar.style.width=Math.round((i+1)/jobs.length*100)+'%';
  }
  var queueError='';
  if(queued.length){try{var qd=await api('/foc/ebay/auto-list',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),email:email,items:queued})});focListWeekState.queue=qd.items||[];}catch(e){queueError=e.message;}}
  overlay.remove();focListWeekState.running=false;
  toast_dash(ok+' listing'+(ok===1?'':'s')+' on eBay'+(queued.length&&!queueError?' · '+queued.length+' queued for later':'')+(failed.length?' · '+failed.length+' not listed':''));
  if(failed.length||queueError)alert((failed.length?'Not listed:\n\n'+failed.join('\n')+'\n\nFix them from the cover wall, or press LIST again.':'')+(queueError?'\n\nCould not save the auto-list queue: '+queueError:''));
  await openFocListWeek();
}
window.openFocListWeek=openFocListWeek;window.focListWeekRun=focListWeekRun;window.focListSetPrice=focListSetPrice;window.focListSetSingleOz=focListSetSingleOz;window.focListWeekState=focListWeekState;window.focUnqueueAutoList=focUnqueueAutoList;

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
async function openEbayPresaleReview(skuId,opts){
  var host=panel();if(!host)return;
  var modalOld=document.getElementById('foc-ebay-review-modal');if(modalOld)modalOld.remove();
  var modal=document.createElement('div');
  modal.id='foc-ebay-review-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:24px 12px';
  modal.innerHTML='<div style="width:100%;max-width:560px;background:var(--surf);border:1px solid var(--border);border-radius:10px;padding:16px;font:11px/1.5 var(--font-mono);color:var(--text)">Loading presale listing preview…</div>';
  document.body.appendChild(modal);
  var preview;
  try{
    preview=await api('/foc/ebay/presale-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),skuId:skuId,quantity:1,draft:!!(opts&&opts.draft)})});
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
      var presaleShippingLine=[(typeof COMIC_GEMINI_LINE!=='undefined'?COMIC_GEMINI_LINE:'Bagged & boarded and shipped in a Gemini mailer.'),'For presale comics, orders ship promptly once the title reaches its official release date and inventory has been received from our distributor.',preview.onSaleLabel?('Release Date: '+preview.onSaleLabel+'.'):'','Publisher and distributor release dates may change. If a presale title is delayed, your order will ship as soon as the book becomes available.'].filter(Boolean).join('\n\n');
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
        // Only a real banner (upper-case PRESALE) counts -- the shipping
        // sentence's "presale comics" alone was the whole disclosure before.
        var templateAlreadyDisclosesPresale=/\bPRESALE\b/.test(renderedBody);
        var disclosure=templateAlreadyDisclosesPresale?'':(isHtmlTemplate
          ? (typeof comicPresaleBannerHtml==='function'?comicPresaleBannerHtml(preview.onSaleLabel||''):'<p>PRESALE -- This comic has not been released yet and is not currently in stock.</p><p>Expected on-sale/ship date: '+preview.onSaleLabel+'. Your order ships promptly once we receive stock from the distributor on or shortly after that date.</p>')
          : 'PRESALE -- This comic has not been released yet and is not currently in stock.\n\nExpected on-sale/ship date: '+preview.onSaleLabel+'. Your order ships promptly once we receive stock from the distributor on or shortly after that date.');
        // Store ask: the PRESALE bar goes at the bottom, not the top.
        description=renderedBody+(disclosure&&!isHtmlTemplate?'\n\n':'')+disclosure;
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
    '<div class="foc-sku-fields" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:6px"><label>QUANTITY<input id="foc-eb-qty" class="tsi" type="number" min="1" max="200" value="'+focDefaultEbayQty(skuId)+'"></label>'+
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
  // LIST WEEK ON EBAY queuing a too-early listing: keep what would be sent.
  if(focEbayCapture){focEbayCapture.payload=payload;var cm=document.getElementById('foc-ebay-review-modal');if(cm)cm.remove();return;}
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
async function openFamilyEbayGroupReview(familyId,opts){
  var host=panel();if(!host)return;
  var modalOld=document.getElementById('foc-ebay-group-modal');if(modalOld)modalOld.remove();
  var modal=document.createElement('div');
  modal.id='foc-ebay-group-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:24px 12px';
  modal.innerHTML='<div style="width:100%;max-width:640px;background:var(--surf);border:1px solid var(--border);border-radius:10px;padding:16px;font:11px/1.5 var(--font-mono);color:var(--text)">Loading covers…</div>';
  document.body.appendChild(modal);
  var preview;
  try{
    preview=await api('/foc/ebay/presale-group-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),familyId:familyId,draft:!!(opts&&opts.draft)})});
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
      var presaleShippingLine=[(typeof COMIC_GEMINI_LINE!=='undefined'?COMIC_GEMINI_LINE:'Bagged & boarded and shipped in a Gemini mailer.'),'For presale comics, orders ship promptly once the title reaches its official release date and inventory has been received from our distributor.',preview.onSaleLabel?('Release Date: '+preview.onSaleLabel+'.'):'','Publisher and distributor release dates may change. If a presale title is delayed, your order will ship as soon as the book becomes available.'].filter(Boolean).join('\n\n');
      // Real per-cover data (not fabricated) for a template's own "choose
      // your cover" section -- every eligible cover a buyer will actually
      // see in this listing's real eBay dropdown, same eligible-only list
      // coverRows below renders as checkboxes. Only worth showing when
      // there's an actual choice to make.
      var eligibleCoverList=(preview.covers||[]).filter(function(c){return c.eligible;});
      // Store report: a naive per-cover block (its own <div>/<span> pair,
      // "Cover art by" spelled out, per cover) cost ~170 chars/cover -- a
      // 5-cover bundle alone pushed the WHOLE rendered description past
      // eBay's 4000-char cap, so truncateHtmlSafely silently cut the
      // template's closing sections (shipping info, Q&A, tagline) to make
      // room. A one-line-per-cover <li> costs under half that, so even an
      // 8-cover bundle stays comfortably under the cap alongside the rest
      // of the template's fixed content.
      var coverChoices=eligibleCoverList.length>1?(isHtmlTemplate
        ? '<ul style="margin:4px 0 0;padding-left:18px">'+eligibleCoverList.map(function(c){return '<li><b>'+esc(c.variantLabel)+'</b>'+(c.coverArtist?' -- '+esc(c.coverArtist):'')+'</li>';}).join('')+'</ul>'
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
        // Only a real banner (upper-case PRESALE) counts -- the shipping
        // sentence's "presale comics" alone was the whole disclosure before.
        var templateAlreadyDisclosesPresale=/\bPRESALE\b/.test(renderedBody);
        var disclosure=templateAlreadyDisclosesPresale?'':(isHtmlTemplate
          ? (typeof comicPresaleBannerHtml==='function'?comicPresaleBannerHtml(preview.onSaleLabel||''):'<p>PRESALE -- This comic has not been released yet and is not currently in stock.</p><p>Expected on-sale/ship date: '+preview.onSaleLabel+'. Your order ships promptly once we receive stock from the distributor on or shortly after that date.</p>')
          : 'PRESALE -- This comic has not been released yet and is not currently in stock.\n\nExpected on-sale/ship date: '+preview.onSaleLabel+'. Your order ships promptly once we receive stock from the distributor on or shortly after that date.');
        // Store ask: the PRESALE bar goes at the bottom, not the top.
        description=renderedBody+(disclosure&&!isHtmlTemplate?'\n\n':'')+disclosure;
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
      '<label>QTY<input class="tsi" data-eb-cover-qty="'+esc(c.skuId)+'" type="number" min="1" max="200" value="'+focDefaultEbayQty(c.skuId)+'" '+disabled+'></label>'+
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
  if(focEbayCapture){focEbayCapture.payload=payload;var cgm=document.getElementById('foc-ebay-group-modal');if(cgm)cgm.remove();return;}
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
// Store ask: incentive (ratio) covers default to listing 1 copy on eBay --
// they're scarce, so 10 was almost never right. Regular covers stay at 10.
// Store rule for ratio covers: "1 of the 100, 2 of the 50, 4 of the 25" --
// 100 / ratio, at most 10, and never more than the copies ordered or
// secured when that's on file.
function focRatioOf(v){ var r=Number(v&&v.ratioThreshold)||0; if(!r){var m=String((v&&v.variantLabel)||'').match(/\b1\s*:\s*(\d+)\b/);r=m?Number(m[1]):0;} return r; }
function focRatioQty(v){
  if(!v)return 10;
  var r=focRatioOf(v);
  if(!v.isIncentive&&!r)return 10;
  var rule=r>0?Math.max(1,Math.min(10,Math.floor(100/r))):1;
  var have=Math.max(Number(v.storeQuantity||0),Number(v.securedQuantity||0));
  return have>0?Math.min(rule,have):rule;
}
function focDefaultEbayQty(skuId){var v=allFocSkus().find(function(x){return x.id===skuId;});return focRatioQty(v);}
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
  panel().innerHTML='<section class="foc-hero"><div class="foc-toolbar"><button class="hbtn" onclick="openFocCycle(\''+esc(c.id)+'\')">← COVER WALL</button><button class="hbtn" style="color:var(--g)" title="Suggest how many of each cover to order: presales, pull lists, how past issues sold, and ratio unlocks" onclick="focSuggestOrder()">📈 SUGGEST ORDER</button><button class="hbtn" style="color:var(--g)" onclick="submitPrhOrder()">SUBMIT PRH ORDER</button><input type="file" id="foc-prh-cart-file" accept=".csv,.xlsx,.xls" hidden onchange="handleFocPrhCartImportFile(event)"><button class="hbtn" title="Upload the cart export from PRH\'s own ordering site (what you actually ordered) -- sets secured/store quantities to match, ends eBay listings for anything left out, and adjusts ordered covers\' listings to the real total, all in one go" onclick="document.getElementById(\'foc-prh-cart-file\').click()">'+(c.distributor==='Lunar'?'UPLOAD LUNAR ORDER':'UPLOAD PRH CART')+'</button><button class="hbtn" style="color:var(--red)" onclick="endFocEbayListings()">END REMAINING EBAY LISTINGS</button><button class="hbtn" title="Fixes multi-cover eBay listings published before the photo-to-cover binding fix, where the wrong (or missing) photo shows for some covers" onclick="repairFocEbayGroupPhotos()">REPAIR LISTING PHOTOS</button>'+(c.distributor==='Lunar'?'<button class="hbtn" title="Looks up Lunar\'s large cover for every Lunar book that has no picture, and adds it where Lunar has one" onclick="fillLunarCovers()">FIND LUNAR COVERS</button>':'')+'</div>'+
    '<div style="font:900 20px/1.1 \'Orbitron\',monospace;color:var(--text);margin-top:10px">Final FOC Review · '+esc(displayDate(c.foc_date))+'</div>'+
    '<div class="foc-stats" style="margin-top:12px"><div class="foc-stat"><b>'+regular.length+'</b><span>SKUs</span></div><div class="foc-stat"><b>'+totalUnits+'</b><span>Total Units</span></div><div class="foc-stat"><b>$'+(estCents/100).toFixed(2)+'</b><span>Est. Wholesale</span></div><div class="foc-stat"><b>'+totalWebsite+'</b><span>Website Presold</span></div><div class="foc-stat"><b>'+totalEbay+'</b><span>eBay Presold</span></div><div class="foc-stat"><b>'+totalStore+'</b><span>Whatnot/Store</span></div><div class="foc-stat"><b>'+qualifiedCount+' / '+incentivesAll.length+'</b><span>Incentives Qualified</span></div></div>'+
    '<label style="display:block;margin:12px 0;font:12px var(--font-mono)"><input type="checkbox" id="foc-import-website-only"> Website-only order import — keep every eBay listing unchanged</label>'+
    '<div id="foc-review-status" style="font:10px var(--font-mono);color:var(--dim);margin-top:8px">Checking submission status…</div>'+
    '<div id="foc-prh-cart-result"></div>'+
    '<div id="foc-pull-needs"></div>'+
    '<div id="foc-what-to-order"></div>'+
    '<div id="foc-order-helper"></div>'+
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
  renderFocWhatToOrder();
  focShowPullNeeds('foc-pull-needs',false);
}
function openFocReview(){renderFocReview();}

// ═══════════════════════════════════════════════════════
// FOC ORDER HELPER -- suggests how many of each cover to order: what's
// already presold (website + eBay), pull lists, how earlier issues of the
// series sold, and the extra Cover A copies that unlock a ratio variant.
// Nothing is saved until you press APPLY; every number stays editable.
// ═══════════════════════════════════════════════════════
var focSellThrough=null;
function focSeriesKey(v){return String(v||'').replace(/#.*$/,'').toUpperCase().replace(/\(.*?\)/g,' ').replace(/[^A-Z0-9]+/g,' ').trim();}
function focSeriesStats(family,data){
  if(!data)return{stats:null,pull:0};
  var keys=[focSeriesKey(family.seriesName),focSeriesKey(family.title)].filter(Boolean);
  var stats=null,pull=0;
  (data.series||[]).forEach(function(s){if(!stats&&keys.indexOf(s.series)>-1)stats=s;});
  keys.some(function(k){if(data.pullLists&&data.pullLists[k]){pull=Number(data.pullLists[k]);return true;}return false;});
  return{stats:stats,pull:pull};
}
function focOrderSuggest(family,stats,pull,intel){
  var regular=family.variants.filter(function(v){return !v.isIncentive;});
  if(!regular.length)return null;
  var coverA=regular.filter(function(v){return /cover a\b/i.test(v.variantLabel||'');})[0]||regular[0];
  var lines=regular.map(function(v){
    var committed=Number(v.customerQty||0)+Number(v.ebayPresold||0);
    return{id:v.id,label:v.variantLabel||'Cover',committed:committed,current:Number(v.storeQuantity||0),total:committed,reasons:committed?[committed+' presold']:[]};
  });
  var a=lines[regular.indexOf(coverA)];
  var committedAll=lines.reduce(function(s,l){return s+l.committed;},0);
  var shelf=0;
  if(stats&&stats.perIssueSold>0){
    var mult=stats.flag==='sells-out'?1.25:(stats.flag==='slow'?0.75:1);
    shelf=Math.max(0,Math.ceil(stats.perIssueSold*mult)-committedAll);
    if(shelf)a.reasons.push('+'+shelf+' shelf: past issues sold ~'+stats.perIssueSold+' each'+(stats.flag==='sells-out'?' (sells out)':(stats.flag==='slow'?' (slow seller)':'')));
  } else if(intel&&intel.runBoost>0){
    // Store ask: "I have #1 in stock still -- order #2 to go with it."
    shelf=Math.max(0,intel.runBoost-committedAll);
    if(shelf)a.reasons.push('+'+shelf+' for the run: '+intel.runText);
  } else if(family.isFirstIssue){
    shelf=2;a.reasons.push('+2 shelf: new #1, no sales history');
  }
  if(!shelf&&intel&&intel.character&&(intel.character.rating==='hot'||intel.character.watched)&&!(stats&&stats.perIssueSold>0)){
    shelf=1;a.reasons.push('+1 shelf: '+intel.character.label+(intel.character.sold?' sells here (sold '+intel.character.sold+')':' is on your watch list'));
  }
  var pullExtra=Math.max(0,Number(pull||0)-Number(coverA.customerQty||0));
  if(pullExtra>shelf){a.reasons.push('+'+(pullExtra-shelf)+' for '+pull+' pull-list customer'+(pull===1?'':'s'));shelf=pullExtra;}
  a.total+=shelf;
  var unlocks=[];
  var total=function(){return lines.reduce(function(s,l){return s+l.total;},0);};
  family.variants.filter(function(v){return v.isIncentive;}).map(function(v){
    var q=v.qualification||{};return{v:v,threshold:Number(q.threshold||v.ratioThreshold||0),presold:Number(v.customerQty||0)+Number(v.ebayPresold||0)};
  }).filter(function(x){return x.threshold>0;}).sort(function(x,y){return x.threshold-y.threshold;}).forEach(function(x){
    var need=Math.max(0,x.threshold-total());
    var label=(x.v.orderRequirement||('1:'+x.threshold))+' '+(x.v.variantLabel||'incentive');
    if(!need){unlocks.push({label:label,status:'unlocked',need:0,presold:x.presold});return;}
    var reach=need<=Math.max(3,Math.ceil(x.threshold*0.3));
    if(x.presold||reach){a.total+=need;a.reasons.push((x.presold?'REQUIRED +':'+')+need+' unlocks '+label+(x.presold?' ('+x.presold+' already presold)':''));unlocks.push({label:label,status:x.presold?'required':'added',need:need,presold:x.presold});}
    else unlocks.push({label:label,status:'skipped',need:need,presold:0});
  });
  // Covers by artists that sell here (or are on the watch list): one for the shelf.
  if(intel)lines.forEach(function(l){
    var art=(intel.variants[l.id]||[]).filter(function(p){return p.kind==='artist'&&(p.rating==='hot'||p.watched);})[0];
    if(art&&l.total===0){l.total=1;l.reasons.push('+1: '+art.artist+(art.watched?' is on your watch list'+(art.sold?' (sold '+art.sold+' here)':''):' covers sell here (sold '+art.sold+')'));}
  });
  lines.forEach(function(l){l.store=Math.max(0,l.total-l.committed);});
  return{lines:lines,unlocks:unlocks,stats:stats,pull:Number(pull||0),intel:intel||null};
}
async function focLoadSellThrough(force){
  if(focSellThrough&&!force)return focSellThrough;
  focSellThrough=await api('/foc/admin/comic-sell-through?store_id='+encodeURIComponent(getActiveStoreId()));
  return focSellThrough;
}
async function focSuggestOrder(){
  var host=document.getElementById('foc-order-helper');if(!host)return;
  host.innerHTML='<div class="panel" style="margin-top:10px;font:10px var(--font-mono);color:var(--dim)">Looking at past sales, pull lists and ratio covers…</div>';
  var data=null;try{data=await focLoadSellThrough(true);}catch(e){toast_dash('Sales history unavailable: '+e.message);}
  await focLoadIntel();focIntel.memo={};
  var rows=state.families.map(function(f){var m=focSeriesStats(f,data);return{f:f,s:focOrderSuggest(f,m.stats,m.pull,focFamilyIntel(f))};}).filter(function(r){
    return r.s&&(r.s.lines.some(function(l){return l.total>0||l.current>0;})||r.s.unlocks.some(function(u){return u.status!=='skipped';}));
  });
  state.orderSuggest=rows;
  var changed=rows.reduce(function(n,r){return n+r.s.lines.filter(function(l){return l.store!==l.current;}).length;},0);
  host.innerHTML='<div class="panel" style="margin-top:10px;padding:12px 16px;border-color:rgba(0,255,163,.3)">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><div style="font:900 11px \'Orbitron\',monospace;color:var(--g);letter-spacing:1px">📈 SUGGESTED ORDER · '+rows.length+' TITLES · '+changed+' CHANGES</div>'+
    '<div style="display:flex;gap:6px"><button class="hbtn" style="padding:6px 10px;font-size:9px;color:var(--g)" onclick="focApplySuggested()">APPLY ALL</button><button class="hbtn" style="padding:6px 10px;font-size:9px" onclick="document.getElementById(\'foc-order-helper\').innerHTML=\'\'">CLOSE</button></div></div>'+
    '<div style="font:9px/1.5 var(--font-mono);color:var(--dim);margin:6px 0">Presold copies always stay. The STORE number is the extra you order for the shelf/Whatnot -- change any of them before applying. Nothing is saved until you press APPLY.</div>'+
    (rows.length?rows.map(function(r,i){
      var s=r.s,st=s.stats;
      var hist=st?st.issues+' issue'+(st.issues===1?'':'s')+' received '+st.received+', sold '+st.sold+' ('+st.sellThrough+'%)'+(st.flag==='sells-out'?' · <b style="color:var(--g)">SELLS OUT</b>':(st.flag==='slow'?' · <b style="color:var(--red)">SLOW</b>':'')):'no past sales on file';
      return '<div style="border-top:1px solid var(--border);padding:8px 0">'+
        '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap"><div style="font-weight:800;font-size:11px;color:var(--text)">'+esc(r.f.title)+'</div><button class="hbtn" style="padding:4px 8px;font-size:8px" onclick="focApplySuggested('+i+')">APPLY</button></div>'+
        '<div style="font:9px var(--font-mono);color:var(--dim)">'+hist+(s.pull?' · '+s.pull+' on pull list':'')+'</div>'+
        (s.intel&&s.intel.pills.length?'<div class="foc-intel-row">'+s.intel.pills.map(focPillHtml).join('')+'</div>':'')+
        s.lines.map(function(l){
          return '<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:6px;align-items:center;font:9px var(--font-mono);padding:3px 0">'+
            '<span style="color:var(--text)">'+esc(l.label)+(l.reasons.length?'<br><span style="color:var(--dim)">'+esc(l.reasons.join(' · '))+'</span>':'')+'</span>'+
            '<span>PRESOLD '+l.committed+'</span><span style="color:var(--dim)">NOW '+l.current+'</span>'+
            '<label>STORE <input class="tsi" type="number" min="0" style="width:60px;'+(l.store!==l.current?'border-color:var(--g)':'')+'" data-suggest-sku="'+esc(l.id)+'" value="'+l.store+'"></label></div>';
        }).join('')+
        (s.unlocks.length?'<div style="font:9px var(--font-mono);margin-top:3px">'+s.unlocks.map(function(u){
          var c=u.status==='skipped'?'var(--dim)':(u.status==='required'?'var(--red)':'var(--gold)');
          var t=u.status==='unlocked'?'already unlocked':(u.status==='skipped'?'needs '+u.need+' more -- not added (too many)':(u.status==='required'?'REQUIRED: '+u.need+' more Cover A (presold)':'order '+u.need+' more Cover A to unlock'));
          return '<div style="color:'+c+'">'+esc(u.label)+' · '+t+'</div>';
        }).join('')+'</div>':'')+
      '</div>';
    }).join(''):'<div style="font:10px var(--font-mono);color:var(--dim)">No presales, pull lists or sales history to suggest from yet.</div>')+
  '</div>';
}
async function focApplySuggested(index){
  var rows=state.orderSuggest||[];var pick=index==null?rows:[rows[index]].filter(Boolean);
  var updates=[];
  pick.forEach(function(r){r.s.lines.forEach(function(l){
    var el=document.querySelector('[data-suggest-sku="'+CSS.escape(l.id)+'"]');
    var val=Math.max(0,parseInt(el?el.value:l.store,10)||0);
    if(val!==l.current)updates.push({id:l.id,val:val});
  });});
  if(!updates.length){toast_dash('Already matches -- nothing to change');return;}
  if(!confirm('Set the store quantity on '+updates.length+' cover'+(updates.length===1?'':'s')+'?'))return;
  var ok=0,failed=0;
  for(var i=0;i<updates.length;i++){
    try{await api('/foc/admin/sku',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),skuId:updates[i].id,storeQuantity:updates[i].val})});ok++;}
    catch(e){failed++;}
  }
  toast_dash(ok+' cover'+(ok===1?'':'s')+' updated'+(failed?' · '+failed+' failed':''));
  try{var data=await api('/foc/admin/cycles?store_id='+encodeURIComponent(getActiveStoreId())+'&cycle_id='+encodeURIComponent(state.cycle.id));state.cycle=data.cycle;state.families=data.families||[];}catch(e){}
  renderFocReview();
}

// ── Pull lists to order ──
// Store ask: "the FOC should tell me what books I need to order for the
// pull lists." Each title this week that someone's pull list covers: the
// cover they get (the Cover A receiving sets aside), who, and whether the
// store copies ordered cover them after eBay presales. Most subscribers
// first.
function focPullNeedRows(needs,families){
  var byId={};(families||[]).forEach(function(f){(f.variants||[]).forEach(function(v){byId[v.id]=v;});});
  return (needs||[]).map(function(n){
    var v=byId[n.skuId]||{},store=Number(v.storeQuantity||0),ebay=Number(v.ebayPresold||0),want=n.subscribers.length;
    return {familyId:n.familyId,title:n.title,skuId:n.skuId,coverLabel:n.coverLabel,guessed:!!n.guessed,subscribers:n.subscribers,store:store,ebay:ebay,short:Math.max(0,want+ebay-store)};
  });
}
// Pull-list series not on any FOC file for 6+ weeks (from the newest week
// imported): tell the customer, or check whether the series ended.
function focPullQuietHtml(quiet){
  if(!(quiet||[]).length)return '';
  return '<div style="margin-top:8px;border-top:1px dashed var(--border);padding-top:6px"><div style="font:900 10px \'Orbitron\',monospace;color:var(--gold);letter-spacing:1px">NOT ON A FOC FILE LATELY ('+quiet.length+')</div>'+
    '<div style="font:9px/1.5 var(--font-mono);color:var(--dim);margin:3px 0">No issue in 6+ weeks of FOC files. Let the customer know, or check whether the series ended, got renamed or moved publisher.</div>'+
    quiet.map(function(q){return '<div style="font:9px/1.6 var(--font-mono);color:var(--text)">'+esc(q.title)+' <span style="color:var(--dim)">· '+q.subscribers+' on pull list · '+(q.lastFoc?'last on the '+esc(displayDate(q.lastFoc))+' FOC':'not on any FOC file yet')+'</span></div>';}).join('')+'</div>';
}
function focPullNeedsHtml(rows,compact,quiet){
  if(!rows.length&&!(compact?0:(quiet||[]).length))return '';
  var short=rows.filter(function(r){return r.short>0;}),missing=short.reduce(function(a,r){return a+r.short;},0);
  var head='<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><div style="font:900 11px \'Orbitron\',monospace;color:var(--purple);letter-spacing:1px">📚 PULL LISTS · '+(!rows.length?'NONE ON THIS FOC</div></div>':rows.length+' TITLE'+(rows.length===1?'':'S')+' THIS FOC · '+(missing?'<span style="color:var(--red)">'+missing+' COP'+(missing===1?'Y':'IES')+' SHORT</span>':'<span style="color:var(--g)">ALL COVERED</span>')+'</div>'+
    (missing?'<button class="hbtn" style="padding:6px 10px;font-size:9px;color:var(--purple)" onclick="focPullAddMissing()">ADD ALL '+missing+' MISSING</button>':'')+'</div>');
  var list=(compact?short:rows).map(function(r){
    return '<div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;border-top:1px solid var(--border);padding:6px 0;font:9px/1.5 var(--font-mono)">'+
      '<div><b style="color:var(--text);font-size:10px">'+esc(r.title)+'</b> <span style="color:var(--dim)">· '+esc(r.coverLabel)+(r.guessed?' (no Cover A found -- check it)':'')+'</span><br>'+
      '<span style="color:var(--text)">'+r.subscribers.length+' on pull list:</span> <span style="color:var(--dim)">'+esc(r.subscribers.join(', '))+'</span><br>'+
      '<span style="color:var(--dim)">ordering '+r.store+' store cop'+(r.store===1?'y':'ies')+(r.ebay?' ('+r.ebay+' already sold on eBay)':'')+'</span></div>'+
      (r.short?'<button class="hbtn" style="padding:4px 8px;font-size:8px;color:var(--red);white-space:nowrap" onclick="focPullAddMissing(\''+esc(r.skuId)+'\')">SHORT '+r.short+' · ADD</button>':'<span style="color:var(--g);white-space:nowrap">✓ covered</span>')+'</div>';
  }).join('');
  return '<div class="panel" style="margin-top:10px;padding:12px 16px;border-color:rgba(199,125,255,.4)">'+head+
    '<div style="font:9px/1.5 var(--font-mono);color:var(--dim);margin:6px 0">Pull-list customers get the regular cover. Store copies have to cover them plus anything already sold on eBay; receiving sets one aside for each.'+(compact&&short.length<rows.length?' '+(rows.length-short.length)+' more already covered -- see FINAL FOC REVIEW.':'')+(compact?'':' Customers add series themselves at <a href="https://www.themanapocket.com/preorders/pull-list" target="_blank" rel="noopener" style="color:var(--purple)">themanapocket.com/preorders/pull-list</a>.')+'</div>'+list+(compact?'':focPullQuietHtml(quiet))+'</div>';
}
var focPullNeeds=null;
async function focShowPullNeeds(hostId,banner){
  if(!state.cycle)return;
  var cycleId=state.cycle.id;
  try{var d=await api('/foc/admin/pull-list-needs?store_id='+encodeURIComponent(getActiveStoreId())+'&cycle_id='+encodeURIComponent(cycleId));focPullNeeds={cycleId:cycleId,needs:d.needs||[],quiet:d.quiet||[]};}
  catch(e){return;}
  if(!state.cycle||state.cycle.id!==cycleId)return;
  var rows=focPullNeedRows(focPullNeeds.needs,state.families);
  var host=hostId?document.getElementById(hostId):null;
  if(!host&&banner){
    // Cover wall: only when something is short.
    var hero=panel()&&panel().querySelector('.foc-hero');if(!hero||!rows.some(function(r){return r.short>0;}))return;
    host=document.getElementById('foc-pull-banner')||hero.appendChild(Object.assign(document.createElement('div'),{id:'foc-pull-banner'}));
  }
  if(host)host.innerHTML=focPullNeedsHtml(rows,!!banner,focPullNeeds.quiet);
}
async function focPullAddMissing(skuId){
  if(!focPullNeeds||!state.cycle)return;
  var rows=focPullNeedRows(focPullNeeds.needs,state.families).filter(function(r){return r.short>0&&(!skuId||r.skuId===skuId);});
  if(!rows.length){toast_dash('Already covered');return;}
  if(!confirm('Order more for pull lists?\n\n'+rows.map(function(r){return r.title+' '+r.coverLabel+': '+r.store+' → '+(r.store+r.short);}).join('\n')))return;
  var ok=0,failed=0;
  for(var i=0;i<rows.length;i++){
    try{await api('/foc/admin/sku',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),skuId:rows[i].skuId,storeQuantity:rows[i].store+rows[i].short})});ok++;}catch(e){failed++;}
  }
  toast_dash(ok+' cover'+(ok===1?'':'s')+' updated for pull lists'+(failed?' · '+failed+' failed':''));
  if(document.getElementById('foc-pull-needs')){
    try{var data=await api('/foc/admin/cycles?store_id='+encodeURIComponent(getActiveStoreId())+'&cycle_id='+encodeURIComponent(state.cycle.id));state.cycle=data.cycle;state.families=data.families||[];}catch(e){}
    renderFocReview();
  } else openCycle(state.cycle.id);
}
window.focPullAddMissing=focPullAddMissing;

// ── On hold for preorders ──
// Store report: Sean's paid preorder copy came in as plain shelf stock and
// was rung up at the register. Receiving now puts paid website preorder
// copies ON HOLD (their own rows, not sellable anywhere) -- this list is where
// they're handed over (or marked shipped), which clears the hold.
function focHoldNotice(d){
  if(!d)return;
  var held=(d.receivedSummary||[]).filter(function(r){return r.reservedForCustomers>0;});
  if(held.length)toast_dash('📌 Set aside for preorders: '+held.map(function(r){return (r.heldFor||[]).map(function(h){return h.copies+' for '+(h.name||'a customer');}).join(', ')+' ('+(r.title||'')+')';}).join(' · '));
  var pulled=(d.pullHeld||[]);
  if(pulled.length)toast_dash('📌 Set aside for pull lists: '+pulled.map(function(p){return p.name+' ('+p.titles.length+')';}).join(', '));
  if((d.warnings||[]).length)alert('Received, but:\n\n'+d.warnings.join('\n'));
}
async function openFocHolds(){
  busy('Loading copies on hold…');
  try{
    var d=await api('/foc/admin/holds?store_id='+encodeURIComponent(getActiveStoreId()));
    var health=null;try{health=(await api('/foc/admin/stock-health?store_id='+encodeURIComponent(getActiveStoreId())+'&run=1')).report;}catch(e){}
    var unheld=health?((health.issues||[]).find(function(i){return i.key==='unheld';})||{items:[]}).items:[];
    renderFocHolds(d.holds||[],unheld,d.pullHolds||[]);
  }
  catch(e){panel().innerHTML='<button class="hbtn" onclick="loadFocCycles()">← FOC WALL</button><div class="panel" style="margin-top:10px;color:var(--red)">Could not load holds: '+esc(e.message)+'</div>';}
}
function renderFocHolds(holds,unheld,pulls){
  unheld=unheld||[];pulls=pulls||[];
  panel().innerHTML='<section class="foc-hero"><div class="foc-toolbar"><button class="hbtn" onclick="loadFocCycles()">← FOC WALL</button><button class="hbtn" onclick="openFocHolds()">↻ REFRESH</button></div>'+
    '<div style="font:900 20px/1.1 \'Orbitron\',monospace;color:var(--text);margin-top:10px">📌 On Hold</div>'+
    '<div style="font:10px/1.6 var(--font-mono);color:var(--dim);margin-top:4px">Paid website preorder copies and pull-list copies that came in. They can\'t be rung up, sold online or listed until you hand them over (or ring them up) here.</div></section>'+
    (unheld.length?'<section class="panel" style="padding:10px 14px;margin-bottom:10px;border-color:rgba(255,77,109,.45)"><div style="font:900 11px \'Orbitron\',monospace;color:var(--red);letter-spacing:1px">CAME IN BUT NOT SET ASIDE ('+unheld.length+')</div><div style="font:9px var(--font-mono);color:var(--dim);margin:3px 0 6px">Paid preorder copies that are on the shelf as regular stock. SET ASIDE moves a copy onto a hold for the customer.</div>'+
      unheld.map(function(u){return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 0;border-top:1px solid var(--border);font:10px var(--font-mono)"><span style="color:var(--text)">'+esc(u.name)+'<br><span style="color:var(--dim)">'+esc(u.note||'')+'</span></span><span style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end"><button class="hbtn" style="color:var(--gold);white-space:nowrap" onclick="focSetAside(\''+esc(u.preorderItemId||'')+'\')">SET ASIDE</button><button class="hbtn" style="white-space:nowrap" onclick="focSetAside(\''+esc(u.preorderItemId||'')+'\',true)">ALREADY HANDED OVER</button></span></div>';}).join('')+'</section>':'')+
    (holds.length?holds.map(function(g){
      var ship=g.fulfillment==='shipping';
      return '<section class="panel" style="padding:10px 14px;margin-bottom:10px"><div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;flex-wrap:wrap"><div><div style="font:800 13px var(--font-mono);color:var(--text)">'+esc(g.customerName)+'</div><div style="font:9px var(--font-mono);color:var(--dim)">'+esc(g.orderNumber)+' · '+(ship?'SHIP':'PICKUP')+(g.phone?' · '+esc(g.phone):'')+' · held since '+esc(displayDate(String(g.heldAt||'').slice(0,10)))+'</div></div>'+
        '<button class="hbtn" style="color:var(--g)" onclick="focHandOver(\''+esc(g.orderId)+'\','+(ship?'true':'false')+')">'+(ship?'📦 SHIPPED':'✓ HANDED OVER')+'</button></div>'+
        g.books.map(function(b){return '<div style="font:10px var(--font-mono);color:var(--text);padding:3px 0;border-top:1px solid var(--border)">'+(b.qty>1?b.qty+'× ':'')+esc(b.name)+'</div>';}).join('')+
        (g.stillComing&&g.stillComing.length?'<div style="font:9px var(--font-mono);color:var(--gold);margin-top:4px">Still coming on this order: '+esc(g.stillComing.join(' | '))+'</div>':'')+
      '</section>';
    }).join(''):'')+
    (pulls.length?'<div style="font:900 11px \'Orbitron\',monospace;color:var(--purple);letter-spacing:1px;margin:14px 0 6px">PULL LISTS ('+pulls.length+')</div>'+pulls.map(function(g){
      var total=g.books.reduce(function(a,b){return a+(Number(b.price)||0)*(b.qty||1);},0);
      return '<section class="panel" style="padding:10px 14px;margin-bottom:10px"><div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;flex-wrap:wrap"><div><div style="font:800 13px var(--font-mono);color:var(--text)">'+esc(g.customerName)+'</div><div style="font:9px var(--font-mono);color:var(--dim)">PULL LIST · not paid yet'+(total?' · $'+total.toFixed(2):'')+' · held since '+esc(displayDate(String(g.heldAt||'').slice(0,10)))+'</div></div>'+
        '<span style="display:flex;gap:6px;flex-wrap:wrap"><button class="hbtn" style="color:var(--g)" title="Frees the copies so the register can sell them -- then scan them" onclick="focPullRelease(\''+esc(g.subscriptionId)+'\',\'rung_up\',\''+esc(g.customerName).replace(/&#39;/g,'')+'\')">🛒 RING UP</button><button class="hbtn" title="They didn\'t want it: back to regular stock" onclick="focPullRelease(\''+esc(g.subscriptionId)+'\',\'shelf\',\''+esc(g.customerName).replace(/&#39;/g,'')+'\')">↩ BACK ON SHELF</button></span></div>'+
        g.books.map(function(b){return '<div style="font:10px var(--font-mono);color:var(--text);padding:3px 0;border-top:1px solid var(--border)">'+(b.qty>1?b.qty+'× ':'')+esc(b.name)+(b.price?' <span style="color:var(--dim)">$'+Number(b.price).toFixed(2)+'</span>':'')+'</div>';}).join('')+'</section>';
    }).join(''):'')+
    (!holds.length&&!pulls.length?'<div class="panel" style="padding:24px;text-align:center;color:var(--dim)">Nothing on hold right now.</div>':'');
}
async function focPullRelease(subscriptionId,how,name){
  if(!confirm(how==='shelf'?'Put '+name+'\'s pull-list copies back on the shelf as regular stock?':'Ring up '+name+'\'s pull-list books? They go back to regular stock so the register can sell them -- then scan each one.'))return;
  try{var d=await api('/foc/admin/holds',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),pullSubscriptionId:subscriptionId,how:how})});
    toast_dash((d.released||0)+' book'+(d.released===1?'':'s')+(how==='shelf'?' back on the shelf':' ready to ring up -- scan '+(d.released===1?'it':'them')+' at the register'));
    // The register sees the freed copies now, not on the next minute's refresh.
    if(typeof refreshInventoryQuietly==='function')try{await refreshInventoryQuietly();}catch(e){}
    openFocHolds();}
  catch(e){toast_dash('Could not update: '+e.message);}
}
async function focHandOver(orderId,ship){
  if(!confirm(ship?'Mark these books shipped? They leave inventory.':'Mark these books handed over to the customer? They leave inventory.'))return;
  try{var d=await api('/foc/admin/holds',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),orderId:orderId})});
    toast_dash((d.released||0)+' book'+(d.released===1?'':'s')+' '+(ship?'shipped':'handed over')+(d.stillComing?' · '+d.stillComing+' still coming':' · order done'));openFocHolds();}
  catch(e){toast_dash('Could not update: '+e.message);}
}
async function focSetAside(itemId,handedOver){
  if(!itemId)return;
  if(handedOver&&!confirm('The customer already has this book? It will be marked done on their preorder.'))return;
  try{var d=await api('/foc/admin/holds/set-aside',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),preorderItemId:itemId,handedOver:!!handedOver})});toast_dash(handedOver?'Marked handed over':'Set aside: '+d.copies+' cop'+(d.copies===1?'y':'ies')+' on hold');openFocHolds();}
  catch(e){toast_dash('Could not set aside: '+e.message);}
}
window.openFocHolds=openFocHolds;window.focHandOver=focHandOver;window.focPullRelease=focPullRelease;window.focSetAside=focSetAside;

// ── Presale stock check ──
// Store report: "why does it think I have Cyberpunk 2077 #1?" and "more
// books than I have and two rows?" Receiving a slip switched every presale
// in that FOC week to in stock -- books that hadn't come out showed 10 per
// cover, and covers that did arrive were counted twice (the eBay presale row
// plus the received row). This finds them and fixes the ones you tick.
var stockCheck=null;
async function openPresaleStockCheck(){
  busy('Checking presale stock…');
  try{stockCheck=await api('/foc/admin/presale-stock-check?store_id='+encodeURIComponent(getActiveStoreId()));renderPresaleStockCheck();}
  catch(e){panel().innerHTML='<button class="hbtn" onclick="loadFocCycles()">← FOC WALL</button><div class="panel" style="margin-top:10px;color:var(--red)">Could not check: '+esc(e.message)+'</div>';}
}
function renderPresaleStockCheck(results){
  var d=Object.assign({early:[],doubles:[],review:[]},stockCheck||{});
  var row=function(attr,id,checked,main,sub){return '<label style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border);font:10px/1.5 var(--font-mono);cursor:pointer"><input type="checkbox" '+attr+'="'+esc(id)+'" '+(checked?'checked':'')+' style="margin-top:3px;flex-shrink:0;width:16px;height:16px"><span><span style="color:var(--text)">'+main+'</span><br><span style="color:var(--dim)">'+sub+'</span></span></label>';};
  var early=d.early.map(function(e){return row('data-fix-early',e.rowId,!e.released,esc(e.name)+' -- shows <b style="color:var(--red)">'+e.qty+' in stock</b>',esc(e.reason)+(e.released?' · came out already: if it came in some other way, leave it unticked':'')+' · goes back to PRESALE here and on eBay (title, presale notice, presale shipping time)'+(e.listedMoreThanOrdered?' · <span style="color:var(--gold)">eBay lists '+e.qty+' but you ordered '+e.ordered+' -- upload that week\'s PRH cart to set it</span>':''));}).join('');
  var doubles=d.doubles.map(function(x){return row('data-fix-double',x.presaleRowId,true,esc(x.name)+' -- shows <b style="color:var(--red)">'+x.shows+'</b>, really <b style="color:var(--g)">'+x.real+'</b>','eBay presale row '+x.presaleQty+' → '+x.fix.presaleQty+' · received row '+x.receivedQty+' → '+(x.fix.receivedQty||'0 (archived)')+(x.soldOffPresale?' · '+x.soldOffPresale+' sold off the eBay row since':'')+(x.fix.presaleQty!==x.presaleQty?' · eBay quantity set to '+x.fix.presaleQty:''));}).join('');
  var review=d.review.map(function(x){return '<div style="padding:6px 0;border-bottom:1px solid var(--border);font:10px/1.5 var(--font-mono)"><span style="color:var(--text)">'+esc(x.name)+'</span><br><span style="color:var(--gold)">'+esc(x.reason)+'</span></div>';}).join('');
  var res=results?'<div class="panel" style="margin-top:10px;padding:10px 14px">'+results.map(function(r){return '<div style="font:10px var(--font-mono);color:'+(r.ok?'var(--g)':'var(--red)')+'">'+(r.ok?'✓ ':'✗ ')+esc(r.name)+' -- '+esc(r.ok?r.fixed:r.error)+'</div>';}).join('')+'</div>':'';
  var none=!d.early.length&&!d.doubles.length&&!d.review.length;
  panel().innerHTML='<section class="foc-hero"><div class="foc-toolbar"><button class="hbtn" onclick="loadFocCycles()">← FOC WALL</button><button class="hbtn" onclick="openPresaleStockCheck()">↻ CHECK AGAIN</button></div>'+
    '<div style="font:900 20px/1.1 \'Orbitron\',monospace;color:var(--text);margin-top:10px">🩺 Presale Stock Check</div>'+
    '<div style="font:10px/1.6 var(--font-mono);color:var(--dim);margin-top:4px">eBay presales that were switched to in stock before their books came in, and covers counted twice. Nothing changes until you press FIX.</div></section>'+res+
    (none?'<div class="panel" style="padding:24px;text-align:center;color:var(--g)">All clear -- every switched presale has its books.</div>':
    (early?'<section class="panel" style="padding:10px 14px"><div style="font:900 11px \'Orbitron\',monospace;color:var(--red);letter-spacing:1px">SWITCHED TOO EARLY ('+d.early.length+')</div>'+early+'</section>':'')+
    (doubles?'<section class="panel" style="padding:10px 14px;margin-top:10px"><div style="font:900 11px \'Orbitron\',monospace;color:var(--gold);letter-spacing:1px">COUNTED TWICE ('+d.doubles.length+')</div>'+doubles+'</section>':'')+
    (review?'<section class="panel" style="padding:10px 14px;margin-top:10px"><div style="font:900 11px \'Orbitron\',monospace;color:var(--dim);letter-spacing:1px">CHECK BY HAND ('+d.review.length+')</div>'+review+'</section>':'')+
    ((d.early.length||d.doubles.length)?'<div class="foc-toolbar" style="margin-top:12px"><button class="hbtn" style="color:var(--g)" onclick="fixPresaleStock()">FIX TICKED</button><span id="foc-stock-fix-status" style="font:10px var(--font-mono);color:var(--dim)"></span></div>':''));
}
async function fixPresaleStock(){
  var early=[],doubles=[];
  document.querySelectorAll('[data-fix-early]:checked').forEach(function(el){early.push(el.getAttribute('data-fix-early'));});
  document.querySelectorAll('[data-fix-double]:checked').forEach(function(el){doubles.push(el.getAttribute('data-fix-double'));});
  if(!early.length&&!doubles.length){toast_dash('Tick something to fix');return;}
  if(!confirm('Fix '+(early.length?early.length+' switched-too-early presale'+(early.length===1?'':'s')+' (inventory + eBay)':'')+(early.length&&doubles.length?' and ':'')+(doubles.length?doubles.length+' double-counted cover'+(doubles.length===1?'':'s'):'')+'?'))return;
  var st=document.getElementById('foc-stock-fix-status');if(st)st.textContent='Fixing… (eBay updates take a few seconds each)';
  try{
    var r=await api('/foc/admin/presale-stock-fix',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),early:early,doubles:doubles})});
    stockCheck=await api('/foc/admin/presale-stock-check?store_id='+encodeURIComponent(getActiveStoreId()));
    renderPresaleStockCheck(r.results||[]);
  }catch(e){if(st)st.textContent='';toast_dash('Fix failed: '+e.message);}
}
window.openPresaleStockCheck=openPresaleStockCheck;window.fixPresaleStock=fixPresaleStock;

// ── eBay listings check ──
// Store ask: "Can you see all my eBay listings?" Pulls every live listing on
// the eBay account and checks it against the dashboard: listings the
// dashboard thinks are live but eBay doesn't have, live listings the
// dashboard doesn't know, quantity mismatches, and covers listed twice.
var ebayCheck=null;
async function openEbayListingsCheck(hostId){
  if(typeof hostId==='string')panelHostOverride=hostId;
  busy('Reading your eBay listings…');
  try{ebayCheck=await api('/foc/admin/ebay-listings-check?store_id='+encodeURIComponent(getActiveStoreId()));renderEbayListingsCheck();}
  catch(e){panel().innerHTML=''+focBackBtn()+'<div class="panel" style="margin-top:10px;color:var(--red)">Could not read eBay: '+esc(e.message)+'</div>';}
}
function renderEbayListingsCheck(note){
  var d=Object.assign({activeCount:0,matched:0,ebayOnly:[],goneFromEbay:[],qtyMismatch:[],sameCoverTwice:[],endedStillCounted:[]},ebayCheck||{});
  var line=function(main,sub,right){return '<div style="display:flex;gap:8px;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font:10px/1.5 var(--font-mono)"><span><span style="color:var(--text)">'+main+'</span>'+(sub?'<br><span style="color:var(--dim)">'+sub+'</span>':'')+'</span>'+(right||'')+'</div>';};
  var link=function(id){return '<a href="https://www.ebay.com/itm/'+encodeURIComponent(id)+'" target="_blank" rel="noopener" style="color:var(--blue)">'+esc(id)+'</a>';};
  // Set the eBay quantity to however many you really have (prefilled with
  // the dashboard's count) -- not always 0.
  var setQty=function(rowId,start){return '<span style="display:flex;gap:4px;align-items:center;flex-shrink:0"><input type="number" min="0" max="1000" value="'+Number(start||0)+'" data-ebay-qty="'+esc(rowId)+'" style="width:56px;padding:4px;background:var(--surf2);border:1px solid var(--border);color:var(--text);border-radius:6px"><button class="hbtn" style="font-size:9px;min-height:0;padding:4px 8px;margin:0" onclick="ebayListingSetQty(\''+esc(rowId)+'\')">SET EBAY</button></span>';};
  var keepEbay=function(rowId,n){return '<button class="hbtn" style="font-size:9px;min-height:0;padding:4px 8px;margin:0;flex-shrink:0" onclick="ebayListingMatchEbay(\''+esc(rowId)+'\')">KEEP EBAY\'S '+n+'</button>';};
  var gone=d.goneFromEbay.map(function(x){return '<label style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border);font:10px/1.5 var(--font-mono);cursor:pointer"><input type="checkbox" data-ebay-gone="'+esc(x.rowId)+'" checked style="margin-top:3px;width:16px;height:16px;flex-shrink:0"><span><span style="color:var(--text)">'+esc(x.name)+'</span><br><span style="color:var(--dim)">listing '+link(x.listingId)+' · dashboard says '+x.dashQty+' on eBay · '+(x.presale?'eBay quantity goes to 0 here':'shelf stock stays, it just stops counting as listed')+'</span></span></label>';}).join('');
  var twice=d.sameCoverTwice.map(function(x){return '<div style="padding:6px 0;border-bottom:1px solid var(--border);font:10px/1.5 var(--font-mono)"><div style="color:var(--text)">'+esc(x.name)+' -- '+x.listings.length+' live listings</div>'+x.listings.map(function(l){return line('listing '+link(l.listingId),l.qty+' available',setQty(l.rowId,l.qty));}).join('')+'</div>';}).join('');
  var mism=d.qtyMismatch.map(function(x){return line(esc(x.name)+(x.label?' · '+esc(x.label):''),'listing '+link(x.listingId)+' · eBay has <b style="color:var(--gold)">'+x.ebayQty+'</b> available'+(x.ebaySold?' ('+x.ebaySold+' sold there)':'')+', dashboard says <b>'+x.dashQty+'</b>','<span style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">'+keepEbay(x.rowId,x.ebayQty)+setQty(x.rowId,x.dashQty)+'</span>');}).join('');
  var counted=d.endedStillCounted.map(function(x){return '<label style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border);font:10px/1.5 var(--font-mono);cursor:pointer"><input type="checkbox" data-ebay-gone="'+esc(x.rowId)+'" checked style="margin-top:3px;width:16px;height:16px;flex-shrink:0"><span><span style="color:var(--text)">'+esc(x.name)+'</span><br><span style="color:var(--dim)">listing '+link(x.listingId)+' was ended, but this row still counts <b style="color:var(--red)">'+x.dashQty+'</b> in stock'+(x.sold?' · '+x.sold+' sold on it stays sold':'')+'</span></span></label>';}).join('');
  var only=d.ebayOnly.map(function(x){return line(esc(x.title),'listing '+link(x.listingId)+' · '+x.available+' available'+(x.covers?' · '+x.covers+' covers':'')+(x.price?' · $'+Number(x.price).toFixed(2):''),'');}).join('');
  var section=function(title,color,count,body,help){return count?'<section class="panel" style="padding:10px 14px;margin-top:10px"><div style="font:900 11px \'Orbitron\',monospace;color:'+color+';letter-spacing:1px">'+title+' ('+count+')</div>'+(help?'<div style="font:9px/1.5 var(--font-mono);color:var(--dim);margin:2px 0 4px">'+help+'</div>':'')+body+'</section>':'';};
  panel().innerHTML='<section class="foc-hero"><div class="foc-toolbar">'+focBackBtn()+'<button class="hbtn" onclick="openEbayListingsCheck()">↻ CHECK AGAIN</button><button class="hbtn" style="color:var(--g)" onclick="openEbayEditor()">✏️ ALL EBAY LISTINGS</button></div>'+
    '<div style="font:900 20px/1.1 \'Orbitron\',monospace;color:var(--text);margin-top:10px">📋 eBay Listings Check</div>'+
    '<div style="font:10px/1.6 var(--font-mono);color:var(--dim);margin-top:4px">'+d.activeCount+' live listings on your eBay account · '+d.matched+' match the dashboard. Nothing changes until you press a button.</div></section>'+
    (note?'<div class="panel" style="margin-top:10px;padding:10px 14px;font:10px var(--font-mono);color:var(--g)">'+note+'</div>':'')+
    section('NOT LIVE ON EBAY','var(--red)',d.goneFromEbay.length,gone+'<div class="foc-toolbar" style="margin-top:8px"><button class="hbtn" style="color:var(--g)" onclick="ebayListingsMarkEnded()">MARK TICKED AS ENDED</button></div>','The dashboard thinks these are listed, but eBay has no live listing for them.')+
    section('ENDED ON EBAY, STILL COUNTED','var(--red)',d.endedStillCounted.length,counted+'<div class="foc-toolbar" style="margin-top:8px"><button class="hbtn" style="color:var(--g)" onclick="ebayListingsMarkEnded()">ZERO TICKED</button></div>','eBay listing rows whose listing is gone but whose copies still show as stock -- the real books are on their own received rows.')+
    section('SAME COVER LISTED TWICE','var(--red)',d.sameCoverTwice.length,twice,'More than one live listing selling the same cover. Set each to what it should offer -- 0 to stop one.')+
    section('QUANTITY DOESN\'T MATCH','var(--gold)',d.qtyMismatch.length,mism,'KEEP EBAY\'S takes eBay\'s count (and its sales) into the dashboard. SET EBAY sends the number in the box to eBay.')+
    section('ON EBAY, NOT IN THE DASHBOARD','var(--dim)',d.ebayOnly.length,only,'Listed on eBay some other way (or by hand) -- the dashboard isn\'t tracking these.')+
    (!d.goneFromEbay.length&&!d.sameCoverTwice.length&&!d.qtyMismatch.length&&!d.ebayOnly.length&&!d.endedStillCounted.length?'<div class="panel" style="padding:24px;text-align:center;color:var(--g);margin-top:10px">All clear -- eBay and the dashboard agree.</div>':'');
}
async function ebayListingSetQty(rowId,quantity){
  if(quantity==null){var box=document.querySelector('[data-ebay-qty="'+rowId+'"]');quantity=Number(box&&box.value);}
  if(!(quantity>=0&&quantity%1===0)){toast_dash('Enter a whole number, 0 or more');return;}
  if(!confirm('Set this eBay listing to '+quantity+' available?'))return;
  try{
    await api('/foc/admin/ebay-listings-check/set-quantity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),rowId:rowId,quantity:quantity})});
    ebayCheck=await api('/foc/admin/ebay-listings-check?store_id='+encodeURIComponent(getActiveStoreId()));
    renderEbayListingsCheck('✓ eBay listing set to '+quantity);
  }catch(e){toast_dash('Could not change it: '+e.message);}
}
async function ebayListingsMarkEnded(){
  var ids=[];document.querySelectorAll('[data-ebay-gone]:checked').forEach(function(el){ids.push(el.getAttribute('data-ebay-gone'));});
  if(!ids.length){toast_dash('Tick something first');return;}
  if(!confirm('Mark '+ids.length+' as ended? eBay is checked again first -- anything still live is left alone.'))return;
  try{
    var r=await api('/foc/admin/ebay-listings-check/mark-ended',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),rowIds:ids})});
    var done=(r.results||[]).filter(function(x){return x.ok;}).length,kept=(r.results||[]).length-done;
    ebayCheck=await api('/foc/admin/ebay-listings-check?store_id='+encodeURIComponent(getActiveStoreId()));
    renderEbayListingsCheck('✓ Marked '+done+' as ended'+(kept?' · '+kept+' still live on eBay, left alone':''));
  }catch(e){toast_dash('Could not mark them: '+e.message);}
}
async function ebayListingMatchEbay(rowId){
  try{
    var r=await api('/foc/admin/ebay-listings-check/match-ebay',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),rowId:rowId})});
    ebayCheck=await api('/foc/admin/ebay-listings-check?store_id='+encodeURIComponent(getActiveStoreId()));
    renderEbayListingsCheck('✓ Dashboard now matches eBay: '+r.available+' available'+(r.sold?', '+r.sold+' sold':''));
  }catch(e){toast_dash('Could not update it: '+e.message);}
}
// ── All eBay listings editor ──
// Store ask: "Easy way to edit the quantity of eBay listings? And prices?"
// Every live listing (made here or straight on eBay), price + quantity
// editable, each cover of a multi-cover listing on its own line.
var ebayEditor={listings:[],q:'',sort:'newest',diffOnly:false};
// eBay vs dashboard for one listing (or one cover): price and count.
function ebayEdDiff(ebay,dash){
  if(!dash)return null;
  var priceOff=Math.abs(Number(ebay.price||0)-Number(dash.price||0))>=0.01&&Number(dash.price||0)>0;
  var qtyOff=Number(ebay.available||0)!==Number(dash.qty||0);
  return {price:priceOff,qty:qtyOff,any:priceOff||qtyOff};
}
function ebayEdHasDiff(l){
  if(l.variations&&l.variations.length)return l.variations.some(function(v){var d=ebayEdDiff(v,v.dashboard);return d&&d.any;});
  var d=ebayEdDiff(l,l.dashboard);return !!(d&&d.any);
}
async function openEbayEditor(hostId){
  if(typeof hostId==='string')panelHostOverride=hostId;
  busy('Reading your eBay listings…');
  try{
    var r=await api('/foc/admin/ebay-listings?store_id='+encodeURIComponent(getActiveStoreId()));
    ebayEditor.listings=r.listings||[];
    panel().innerHTML='<section class="foc-hero"><div class="foc-toolbar">'+focBackBtn()+'<button class="hbtn" onclick="openEbayEditor()">↻ RELOAD FROM EBAY</button><button class="hbtn" style="color:var(--blue)" onclick="openEbayListingsCheck()">📋 EBAY LISTINGS CHECK</button></div>'+
      '<div style="font:900 20px/1.1 \'Orbitron\',monospace;color:var(--text);margin-top:10px">✏️ All eBay Listings</div>'+
      '<div style="font:10px/1.6 var(--font-mono);color:var(--dim);margin-top:4px">Change a price or quantity and press SAVE -- it goes straight to eBay. Quantity is how many are left to buy.</div>'+
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><input id="ebay-ed-q" type="search" placeholder="Search titles…" value="'+esc(ebayEditor.q)+'" oninput="ebayEditor.q=this.value;renderEbayEditorList()" style="flex:1;min-width:180px;padding:8px;background:var(--surf2);border:1px solid var(--border);color:var(--text);border-radius:6px">'+
      '<select onchange="ebayEditor.sort=this.value;renderEbayEditorList()" style="padding:8px;background:var(--surf2);border:1px solid var(--border);color:var(--text);border-radius:6px">'+[['newest','Newest first'],['diff','Differences first'],['oldest','Oldest first (stale)'],['price-high','Price high → low'],['price-low','Price low → high'],['most','Most left'],['untracked','Not in dashboard first']].map(function(o){return '<option value="'+o[0]+'"'+(ebayEditor.sort===o[0]?' selected':'')+'>'+o[1]+'</option>';}).join('')+'</select><label style="display:flex;gap:6px;align-items:center;font:10px var(--font-mono);color:var(--text)"><input type="checkbox" '+(ebayEditor.diffOnly?'checked':'')+' onchange="ebayEditor.diffOnly=this.checked;renderEbayEditorList()"> Differences only</label></div></section>'+
      '<div id="ebay-ed-list"></div>';
    renderEbayEditorList();
  }catch(e){panel().innerHTML=''+focBackBtn()+'<div class="panel" style="margin-top:10px;color:var(--red)">Could not read eBay: '+esc(e.message)+'</div>';}
}
function ebayEdLeft(l){return l.variations&&l.variations.length?l.variations.reduce(function(n,v){return n+Number(v.available||0);},0):Number(l.available||0);}
function renderEbayEditorList(){
  var host=document.getElementById('ebay-ed-list');if(!host)return;
  var q=String(ebayEditor.q||'').toLowerCase().trim();
  var list=ebayEditor.listings.filter(function(l){return (!ebayEditor.diffOnly||ebayEdHasDiff(l))&&(!q||String(l.title||'').toLowerCase().indexOf(q)>=0||String(l.itemId).indexOf(q)>=0||(l.variations||[]).some(function(v){return String(v.label||'').toLowerCase().indexOf(q)>=0;}));});
  var t=function(l){return Date.parse(l.startTime||'')||0;};
  var sorts={diff:function(a,b){return Number(ebayEdHasDiff(b))-Number(ebayEdHasDiff(a))||t(b)-t(a);},newest:function(a,b){return t(b)-t(a);},oldest:function(a,b){return t(a)-t(b);},'price-high':function(a,b){return Number(b.price||0)-Number(a.price||0);},'price-low':function(a,b){return Number(a.price||0)-Number(b.price||0);},most:function(a,b){return ebayEdLeft(b)-ebayEdLeft(a);},untracked:function(a,b){return Number(a.linked)-Number(b.linked)||t(b)-t(a);}};
  list=list.slice().sort(sorts[ebayEditor.sort]||sorts.newest);
  var input=function(kind,key,val,width){return '<input type="number" '+(kind==='price'?'step="0.01" min="0.99"':'min="0" step="1"')+' value="'+(val==null?'':val)+'" data-ebay-ed-'+kind+'="'+esc(key)+'" style="width:'+width+'px;padding:5px;background:var(--surf2);border:1px solid var(--border);color:var(--text);border-radius:6px">';};
  // What the dashboard says, under eBay's numbers; differences in gold.
  var dashLine=function(key,ebay,dash){
    if(!dash)return '';
    var d=ebayEdDiff(ebay,dash),gold='color:var(--gold);font-weight:700';
    var what=dash.presale?'on eBay':'in stock';
    return '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end;margin-top:4px;font-size:9px;color:var(--dim)">Dashboard: <span style="'+(d.price?gold:'')+'">$'+Number(dash.price||0).toFixed(2)+'</span> · <span style="'+(d.qty?gold:'')+'">'+Number(dash.qty||0)+' '+what+'</span>'+
      (d.any?' <button class="hbtn" style="font-size:8px;min-height:0;padding:3px 7px;margin:0" title="Put the dashboard\'s numbers in the boxes, then SAVE to send them to eBay" onclick="ebayEdUseDashboard(\''+esc(key)+'\')">USE DASHBOARD →</button><button class="hbtn" style="font-size:8px;min-height:0;padding:3px 7px;margin:0" title="Copy eBay\'s '+(dash.presale?'price and count':'price')+' into the dashboard" onclick="ebayEdUseEbay(\''+esc(key)+'\')">← USE EBAY\'S</button>':' <span style="color:var(--g)">✓ matches</span>')+'</div>';
  };
  var controls=function(key,price,qty,sold){return '<span style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;justify-content:flex-end">$'+input('price',key,price?Number(price).toFixed(2):'',78)+'<span style="color:var(--dim)">qty</span>'+input('qty',key,qty,56)+(sold?'<span style="color:var(--dim);font-size:9px">'+sold+' sold</span>':'')+'<button class="hbtn" style="font-size:9px;min-height:0;padding:5px 10px;margin:0" onclick="saveEbayEdit(\''+esc(key)+'\')">SAVE</button><span data-ebay-ed-msg="'+esc(key)+'" style="font-size:9px"></span></span>';};
  host.innerHTML=(list.length?'':'<div class="panel" style="padding:20px;text-align:center;color:var(--dim)">No listings match.</div>')+list.map(function(l){
    var age=l.startTime?Math.floor((Date.now()-Date.parse(l.startTime))/864e5):null;
    var meta=['listing <a href="https://www.ebay.com/itm/'+encodeURIComponent(l.itemId)+'" target="_blank" rel="noopener" style="color:var(--blue)">'+esc(l.itemId)+'</a>',age!=null?(age+' day'+(age===1?'':'s')+' up'):'',l.watchers?l.watchers+' watching':'',l.linked?'':'<span style="color:var(--gold)">not in dashboard</span>'].filter(Boolean).join(' · ');
    var img=l.photo?'<img src="'+esc(l.photo)+'" alt="" loading="lazy" style="width:48px;height:48px;object-fit:cover;border-radius:6px;flex-shrink:0">':'<div style="width:48px;height:48px;border-radius:6px;background:var(--surf2);flex-shrink:0"></div>';
    var single=!(l.variations&&l.variations.length);
    var head='<div style="display:flex;gap:10px;align-items:center">'+img+'<div style="flex:1;min-width:0"><div style="color:var(--text);font-weight:700;overflow:hidden;text-overflow:ellipsis">'+esc(l.title)+'</div><div style="color:var(--dim);font-size:9px;margin-top:2px">'+meta+'</div></div>'+(single?'<div>'+controls(l.itemId,l.price,l.available,l.sold)+dashLine(l.itemId,l,l.dashboard)+'</div>':'')+'</div>';
    var vars=(l.variations||[]).map(function(v){var k=l.itemId+'|'+v.sku;return '<div style="display:flex;gap:8px;justify-content:space-between;align-items:center;padding:5px 0 5px 58px;border-top:1px dashed var(--border)"><span style="color:var(--text)">'+esc(v.label||v.sku||'Cover')+(v.linked?'':' <span style="color:var(--gold);font-size:9px">not in dashboard</span>')+'</span><div>'+controls(k,v.price,v.available,v.sold)+dashLine(k,v,v.dashboard)+'</div></div>';}).join('');
    return '<div class="panel" style="padding:10px 12px;margin-top:8px;font:10px/1.5 var(--font-mono)">'+head+vars+'</div>';
  }).join('');
}
async function saveEbayEdit(key){
  var parts=String(key).split('|'),itemId=parts[0],variationSku=parts[1]||'';
  var l=ebayEditor.listings.find(function(x){return String(x.itemId)===itemId;});if(!l)return;
  var v=variationSku?(l.variations||[]).find(function(x){return x.sku===variationSku;}):null;
  var cur=v||l;
  var pEl=document.querySelector('[data-ebay-ed-price="'+key+'"]'),qEl=document.querySelector('[data-ebay-ed-qty="'+key+'"]'),msg=document.querySelector('[data-ebay-ed-msg="'+key+'"]');
  var price=pEl&&pEl.value!==''?Number(pEl.value):null,qty=qEl&&qEl.value!==''?Number(qEl.value):null;
  var body={storeId:getActiveStoreId(),itemId:itemId,sku:l.sku||'',variationSku:variationSku};
  if(price!=null&&Math.abs(price-Number(cur.price||0))>=0.005)body.price=price;
  if(qty!=null&&qty!==Number(cur.available||0))body.quantity=qty;
  if(body.price==null&&body.quantity==null){if(msg){msg.style.color='var(--dim)';msg.textContent='no change';}return;}
  if(body.quantity===0&&!confirm('Set this to 0 left? It stops selling on eBay until you raise it.'))return;
  if(msg){msg.style.color='var(--gold)';msg.textContent='saving…';}
  try{
    await api('/foc/admin/ebay-listings/revise',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(body.price!=null)cur.price=body.price;
    if(body.quantity!=null)cur.available=body.quantity;
    if(msg){msg.style.color='var(--g)';msg.textContent='✓ saved';}
  }catch(e){if(msg){msg.style.color='var(--red)';msg.textContent=e.message;}}
}
function ebayEdFind(key){
  var parts=String(key).split('|'),l=ebayEditor.listings.find(function(x){return String(x.itemId)===parts[0];});
  if(!l)return null;var v=parts[1]?(l.variations||[]).find(function(x){return x.sku===parts[1];}):null;
  return {l:l,v:v,cur:v||l,itemId:parts[0],variationSku:parts[1]||''};
}
function ebayEdUseDashboard(key){
  var f=ebayEdFind(key);if(!f||!f.cur.dashboard)return;
  var p=document.querySelector('[data-ebay-ed-price="'+key+'"]'),q=document.querySelector('[data-ebay-ed-qty="'+key+'"]'),msg=document.querySelector('[data-ebay-ed-msg="'+key+'"]');
  if(p&&Number(f.cur.dashboard.price)>0)p.value=Number(f.cur.dashboard.price).toFixed(2);
  if(q)q.value=Number(f.cur.dashboard.qty||0);
  if(msg){msg.style.color='var(--gold)';msg.textContent='press SAVE';}
}
async function ebayEdUseEbay(key){
  var f=ebayEdFind(key);if(!f||!f.cur.dashboard)return;
  var dash=f.cur.dashboard;
  if(!confirm('Copy eBay\'s '+(dash.presale?'price ($'+Number(f.cur.price||0).toFixed(2)+') and count ('+f.cur.available+')':'price ($'+Number(f.cur.price||0).toFixed(2)+')')+' into the dashboard?'+(dash.presale?'':' Your in-store stock count stays as it is.')))return;
  var msg=document.querySelector('[data-ebay-ed-msg="'+key+'"]');
  try{
    var r=await api('/foc/admin/ebay-listings/to-dashboard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),itemId:f.itemId,variationSku:f.variationSku})});
    dash.price=r.price;if(r.countUpdated)dash.qty=r.qty;
    renderEbayEditorList();
    msg=document.querySelector('[data-ebay-ed-msg="'+key+'"]');if(msg){msg.style.color='var(--g)';msg.textContent='✓ dashboard updated';}
  }catch(e){if(msg){msg.style.color='var(--red)';msg.textContent=e.message;}}
}
window.ebayEdUseDashboard=ebayEdUseDashboard;window.ebayEdUseEbay=ebayEdUseEbay;
window.openEbayEditor=openEbayEditor;window.renderEbayEditorList=renderEbayEditorList;window.saveEbayEdit=saveEbayEdit;window.ebayEditor=ebayEditor;
window.openEbayListingsCheck=openEbayListingsCheck;window.ebayListingSetQty=ebayListingSetQty;window.ebayListingsMarkEnded=ebayListingsMarkEnded;window.ebayListingMatchEbay=ebayListingMatchEbay;

// ═══════════════════════════════════════════════════════
// ORDERING INTEL -- pills on the cover wall and the WHAT TO ORDER summary on
// FINAL FOC REVIEW. Store ask: hot books, runs ("I have Twelve-Toe Maggie
// #1 in stock, order #2 to go with it"), series / characters / cover
// artists that sell here ("Peach sells well, don't forget these Peach
// covers"), connecting covers, other sellers' eBay presales, and values next
// to the ratio books (eBay sold + listed, PriceCharting). What sells here
// is scripts/comic-demand.js over our own register + eBay comic sales and
// the shelf; the watch list is the store's own and shared by every device.
// ═══════════════════════════════════════════════════════
var focIntel={demand:null,loading:null,loaded:false,watch:null,connectLoaded:false,market:{},pc:{},memo:{}};
var FOC_PILL_COLOR={hot:'var(--g)',good:'var(--blue)',slow:'var(--red)',dim:'var(--dim)',new:'var(--purple)',key:'var(--gold)',run:'var(--gold)',presold:'var(--g)'};
function focCD(){return window.ArsCaComicDemand||null;}
function focPillHtml(p){var c=FOC_PILL_COLOR[p.tone]||'var(--dim)',st='color:'+c+';border-color:color-mix(in srgb,'+c+' 45%,transparent)';
  // Store ask: "I need a link to take me there to see them" -- eBay pills open the listings.
  if(p.href)return '<a class="foc-intel-pill foc-intel-link" href="'+esc(p.href)+'" target="_blank" rel="noopener" style="'+st+'" title="'+esc(p.title||'')+'">'+esc(p.text)+' ↗</a>';
  return '<span class="foc-intel-pill" style="'+st+'" title="'+esc(p.title||'')+'">'+esc(p.text)+'</span>';}
function focEbaySearchUrl(q,sold){return 'https://www.ebay.com/sch/i.html?_nkw='+encodeURIComponent(q||'')+(sold?'&LH_Sold=1&LH_Complete=1':'');}
function focWatch(){var D=focCD();return focIntel.watch||(D?D.DEFAULT_WATCH:{artists:[],characters:[],series:[]});}
function focFamilyIntel(f){
  var D=focCD();if(!D||!f)return null;
  if(!focIntel.memo[f.id])focIntel.memo[f.id]=D.familyIntel(f,focIntel.demand,focWatch());
  return focIntel.memo[f.id];
}
function focMarketStoreKey(){return 'foc_market_v1:'+getActiveStoreId();}
function focLoadMarketCache(){
  try{var d=JSON.parse(localStorage.getItem(focMarketStoreKey())||'null');if(!d)return;var cutoff=Date.now()-3*864e5;
    Object.keys(d.market||{}).forEach(function(k){if(Date.parse(d.market[k].at||0)>cutoff)focIntel.market[k]=d.market[k];});
    Object.keys(d.pc||{}).forEach(function(k){if(Date.parse(d.pc[k].at||0)>cutoff)focIntel.pc[k]=d.pc[k];});
  }catch(e){}
}
function focSaveMarketCache(){try{localStorage.setItem(focMarketStoreKey(),JSON.stringify({market:focIntel.market,pc:focIntel.pc}));}catch(e){}}
async function focLoadWatch(){
  try{var res=await storeWorkerFetch('/kv/foc_watch_list',{cache:'no-store'});var raw=(await res.json().catch(function(){return{};})).value;var w=raw?JSON.parse(raw):null;
    if(w&&typeof w==='object')focIntel.watch={artists:w.artists||[],characters:w.characters||[],series:w.series||[]};}
  catch(e){}
}
async function focLoadConnectData(){
  try{
    await loadConnectSaved();
    var ids=[];connectState.saved.sets.forEach(function(s){(s.skuIds||[]).forEach(function(id){if(ids.indexOf(id)<0)ids.push(id);});});
    var data=await api('/foc/admin/connecting-covers?store_id='+encodeURIComponent(getActiveStoreId())+(ids.length?'&ids='+encodeURIComponent(ids.slice(0,100).join(',')):''));
    connectState.covers={};(data.covers||[]).forEach(function(c){connectState.covers[c.id]=c;});
    connectState.aliases=data.aliases||{};connectState.suggested=data.suggestedSets||[];focIntel.connectLoaded=true;
  }catch(e){}
}
function focLoadIntel(force){
  var D=focCD();if(!D)return Promise.resolve(null);
  if(focIntel.loaded&&!force)return Promise.resolve(focIntel.demand);
  if(focIntel.loading&&!force)return focIntel.loading;
  focLoadMarketCache();
  focIntel.loading=Promise.all([
    api('/foc/admin/comic-demand?store_id='+encodeURIComponent(getActiveStoreId())).catch(function(e){toast_dash('Comic sales unavailable: '+e.message);return null;}),
    focLoadWatch(),focLoadConnectData()
  ]).then(function(r){focIntel.facts=r[0]||null;focIntel.demand=r[0]?D.buildComicDemand(r[0]):null;focIntel.loaded=true;focIntel.loading=null;focIntel.memo={};return focIntel.demand;});
  return focIntel.loading;
}
// Loads in the background the first time the wall opens, then redraws it.
function focEnsureIntel(){
  if(focIntel.loaded||!focCD())return;
  focLoadIntel().then(function(){if(document.getElementById('foc-family-list'))renderFamilies();});
}
function focConnectFor(skuId){
  if(!focIntel.connectLoaded)return null;
  var id=connectState.aliases[skuId]||skuId,sets=connectState.saved.sets.concat(connectState.suggested||[]);
  for(var i=0;i<sets.length;i++){
    var set=sets[i];
    if(!(set.skuIds||[]).some(function(x){return (connectState.aliases[x]||x)===id;}))continue;
    var sum=connectSetSummary(set),cover=connectState.covers[id]||{};
    return {set:set,sum:sum,cover:cover,parts:Number(set.partCount||sum.covers.length)||sum.covers.length,saved:i<connectState.saved.sets.length};
  }
  return null;
}
function focConnectPill(c){
  var title=(c.set.name||'Connecting covers')+': '+c.sum.covers.map(function(x){return (x.part?'part '+x.part:x.variant_label||x.title)+' -- '+connectStatus(x,c.set);}).join('; ');
  return {kind:'connect',tone:c.sum.owned?'run':'good',text:'🧩 '+(c.cover.part?'part '+c.cover.part+' of '+c.parts:'connecting')+' · have '+c.sum.owned+'/'+c.parts,title:title};
}
function focRegularMsrp(f){var r=(f.variants||[]).filter(function(v){return !v.isIncentive;})[0];return r?Number(r.msrpCents||0):0;}
function focMarketPills(m,msrpCents){
  var a=m.active||{},s=m.sold||{},cover=Number(msrpCents||0)/100;
  var when=' Checked '+displayDate(m.at)+(m.cached?' (saved copy)':'')+'.';
  if(!a.count&&!s.count)return [{tone:'dim',text:'🔎 eBay: nothing listed yet',href:focEbaySearchUrl(m.query),title:'No other eBay listings matched "'+m.query+'". Opens the eBay search.'+when}];
  var mult=cover&&a.median?a.median/cover:0,hype=a.count>=8&&mult>=1.5,out=[];
  if(a.count)out.push({tone:hype?'hot':(a.count>=3?'good':'dim'),href:focEbaySearchUrl(m.query),
    text:(hype?'🔥 ':'🔎 ')+'eBay: '+a.count+' listed'+(a.median?' ~$'+a.median.toFixed(2):'')+(mult>=1.2?' ('+mult.toFixed(1)+'× cover)':''),
    title:'Opens these eBay listings: "'+m.query+'"'+(a.presales?' ('+a.presales+' presales)':'')+', asking $'+Number(a.low||0).toFixed(2)+'–$'+Number(a.high||0).toFixed(2)+'. eBay doesn\'t show other sellers\' sold counts, so how many are listed is the hype signal. The search can include other printings or lots -- look before you trust the number.'+when});
  if(s.count)out.push({tone:'good',href:focEbaySearchUrl(m.query,true),text:'eBay sold: '+s.count+' ~$'+Number(s.median||0).toFixed(2),title:'Opens eBay sold listings for "'+m.query+'".'+when});
  return out;
}
function focFamilyPillsHtml(f){
  if(!focCD()||!(focIntel.loaded||focIntel.loading))return '';
  if(!focIntel.loaded)return '<div class="foc-intel-row"><span class="foc-intel-pill" style="color:var(--dim)">reading what sells here…</span></div>';
  var intel=focFamilyIntel(f),pills=intel.pills.slice(),m=focIntel.market['fam:'+f.id];
  if(m)pills=pills.concat(focMarketPills(m,focRegularMsrp(f)));
  return '<div class="foc-intel-row">'+pills.map(focPillHtml).join('')+'<button class="foc-intel-pill foc-intel-btn" onclick="focCheckMarket([\''+esc(f.id)+'\'])" title="What other eBay sellers are asking for this issue right now, and what it has sold for">'+(m?'↻ EBAY':'🔎 EBAY')+'</button></div>';
}
function focVariantPillsHtml(v){
  if(!focCD()||!focIntel.loaded)return '';
  var fam=state.families.find(function(f){return f.id===v.familyId;});
  var intel=focFamilyIntel(fam),pills=intel?(intel.variants[v.id]||[]).slice():[];
  var c=focConnectFor(v.id);if(c)pills.push(focConnectPill(c));
  return (pills.length?'<div class="foc-intel-row">'+pills.map(focPillHtml).join('')+'</div>':'')+(v.isIncentive?focRatioValueHtml(v):'');
}
// What this exact cover sold for here (register + our own eBay listing).
// Store report: "I sold one, so why no data? For anyone? Even us?"
function focOurSales(skuId){
  var list=((focIntel.facts&&focIntel.facts.sold)||[]).filter(function(x){return x.skuId===skuId&&Number(x.price)>0;});
  if(!list.length)return null;
  var prices=[];list.forEach(function(x){for(var i=0;i<Math.max(1,Number(x.qty||1));i++)prices.push(Number(x.price));});
  prices.sort(function(a,b){return a-b;});
  var mid=Math.floor(prices.length/2),median=prices.length%2?prices[mid]:(prices[mid-1]+prices[mid])/2;
  var last=list.slice().sort(function(a,b){return String(b.at).localeCompare(String(a.at));})[0];
  return {count:prices.length,median:Math.round(median*100)/100,last:last};
}
function focMarketWarning(m){
  var w=((m&&m.warnings)||[]).join(' ');
  if(!w)return '';
  if(/SOLDCOMPS|Finding API|418/i.test(w))return 'eBay sold history isn\'t connected, so other sellers\' sales can\'t be seen';
  if(/token|EBAY_CLIENT/i.test(w))return 'eBay search isn\'t connected';
  return 'eBay: '+w;
}
function focRatioOf(v){var m=String(v.orderRequirement||v.variantLabel||'').match(/1\s*:\s*(\d+)/)||String(v.variantLabel||'').match(/\bRI\b\s*\(?(\d+)/i);return Number(v.ratioThreshold||(m&&m[1])||0);}
function focRatioValue(v){
  var D=focCD(),m=focIntel.market['sku:'+v.id],pc=focIntel.pc[v.id];
  var raw=pc&&pc.ok&&pc.product&&pc.product.comicPrices?Number(pc.product.comicPrices.ungraded||0):0;
  var fam=state.families.find(function(f){return f.id===v.familyId;});
  var ours=focOurSales(v.id);
  var value=D?D.ratioValue({soldMedian:m&&m.sold&&m.sold.median,soldCount:m&&m.sold&&m.sold.count,ourSales:ours,pcUngraded:raw,activeMedian:m&&m.active&&m.active.median,activeCount:m&&m.active&&m.active.count,coverPrice:(fam?focRegularMsrp(fam):Number(v.msrpCents||0))/100,ratio:focRatioOf(v)}):null;
  return {m:m,pc:pc,raw:raw,value:value,ours:ours,pcIgnored:!!(D&&raw&&D.ratioPcSuspicious({pcUngraded:raw,activeMedian:m&&m.active&&m.active.median,activeCount:m&&m.active&&m.active.count,coverPrice:(fam?focRegularMsrp(fam):Number(v.msrpCents||0))/100,ratio:focRatioOf(v)}))};
}
function focRatioValueText(r){
  var parts=[];
  if(r.ours)parts.push('sold here: '+r.ours.count+' · $'+r.ours.median.toFixed(2)+(r.ours.last&&r.ours.last.at?' (last '+displayDate(String(r.ours.last.at).slice(0,10))+(r.ours.last.ebay?' on eBay':'')+')':''));
  if(r.m&&r.m.sold&&r.m.sold.count)parts.push('eBay sold ~$'+Number(r.m.sold.median).toFixed(2)+' ('+r.m.sold.count+')');
  if(r.m&&r.m.active&&r.m.active.count)parts.push('listed ~$'+Number(r.m.active.median).toFixed(2)+' ('+r.m.active.count+')');
  if(r.m&&!(r.m.sold&&r.m.sold.count)&&!(r.m.active&&r.m.active.count))parts.push(r.m.ownListed?'only your listing is up on eBay':'no other eBay listings');
  var warn=focMarketWarning(r.m);if(warn)parts.push(warn);
  if(r.raw)parts.push('PriceCharting $'+r.raw.toFixed(2)+(r.pcIgnored?' (looks like the regular cover -- not used)':''));else if(r.pc)parts.push('not on PriceCharting yet');
  return parts.join(' · ');
}
function focRatioLinksHtml(r){
  var links=[];
  if(r.m){links.push('<a href="'+esc(focEbaySearchUrl(r.m.query))+'" target="_blank" rel="noopener">eBay listings ↗</a>');links.push('<a href="'+esc(focEbaySearchUrl(r.m.query,true))+'" target="_blank" rel="noopener">eBay sold ↗</a>');}
  var pcUrl=r.pc&&r.pc.ok&&r.pc.product&&r.pc.product.url;
  if(pcUrl)links.push('<a href="'+esc(pcUrl)+'" target="_blank" rel="noopener">PriceCharting ↗</a>');
  return links.length?'<div class="foc-ratio-links">'+links.join(' · ')+'</div>':'';
}
function focRatioValueHtml(v){
  var r=focRatioValue(v),line=focRatioValueText(r);
  return '<div class="foc-ratio-value"><b style="color:var(--gold)">VALUE</b> '+(line?esc(line):'<span style="color:var(--dim)">not checked yet</span>')+focRatioLinksHtml(r)+
    (r.value?'<div style="color:var(--g);margin-top:3px">PRICE IT ~$'+r.value.price.toFixed(2)+' <span style="color:var(--dim)">'+esc(r.value.basis)+'</span> <button class="foc-intel-pill foc-intel-btn" onclick="focUseRatioPrice(\''+esc(v.id)+'\','+r.value.price+')" title="Set the website sell price">USE</button>'+(v.ebayListingId?' <button class="foc-intel-pill foc-intel-btn" onclick="focFillEbayPrice(\''+esc(v.id)+'\','+r.value.price+')" title="Put this price in the eBay listing box below">USE ON EBAY</button>':'')+'</div>':'')+
    '<button class="foc-intel-pill foc-intel-btn" style="margin-top:4px" onclick="focPriceRatio([\''+esc(v.id)+'\'])">'+(r.m||r.pc?'↻ RE-CHECK':'💲 CHECK EBAY + PRICECHARTING')+'</button></div>';
}
function focRedrawIntel(){focIntel.memo={};if(document.getElementById('foc-family-list'))renderFamilies();if(document.getElementById('foc-what-to-order'))renderFocWhatToOrder();}
async function focMarketRequest(covers,refresh){
  for(var i=0;i<covers.length;i+=12){
    var d=await api('/foc/admin/cover-market',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),covers:covers.slice(i,i+12),refresh:!!refresh})});
    Object.keys(d.results||{}).forEach(function(k){focIntel.market[k]=d.results[k];});
  }
  focSaveMarketCache();
}
function focFamilyCover(f){return {series:f.seriesName||String(f.title||'').replace(/#.*$/,'').trim(),issue:f.issueNumber||(String(f.title||'').match(/#\s*(\d+)/)||[])[1]||''};}
async function focCheckMarket(familyIds){
  var fams=state.families.filter(function(f){return familyIds.indexOf(f.id)>-1;});if(!fams.length)return;
  toast_dash('Checking eBay for '+fams.length+' title'+(fams.length===1?'':'s')+'…');
  try{
    var refresh=fams.length===1&&!!focIntel.market['fam:'+fams[0].id];
    await focMarketRequest(fams.map(function(f){var c=focFamilyCover(f);return {key:'fam:'+f.id,series:c.series,issue:c.issue};}),refresh);
    focRedrawIntel();
  }catch(e){toast_dash('eBay check failed: '+e.message);}
}
async function focPriceRatio(skuIds){
  var all=allFocSkus(),skus=all.filter(function(v){return skuIds.indexOf(v.id)>-1;});if(!skus.length)return;
  toast_dash('Checking values for '+skus.length+' ratio cover'+(skus.length===1?'':'s')+'…');
  var famOf=function(v){return state.families.find(function(f){return f.id===v.familyId;})||{};};
  var refresh=skus.length===1&&!!focIntel.market['sku:'+skus[0].id];
  try{await focMarketRequest(skus.map(function(v){var c=focFamilyCover(famOf(v));return {key:'sku:'+v.id,series:c.series,issue:c.issue,artist:v.coverArtist||'',ratio:focRatioOf(v),virgin:/virgin/i.test(v.variantLabel||''),foil:!!v.isFoil};}),refresh);}
  catch(e){toast_dash('eBay check failed: '+e.message);}
  try{
    for(var i=0;i<skus.length;i+=15){
      var items=skus.slice(i,i+15).map(function(v){var c=focFamilyCover(famOf(v));return {key:v.id,upc:v.upc||'',series:c.series,issue:c.issue,cover:v.variantLabel||''};});
      var res=await storeWorkerFetch('/pricing/pricecharting/comics/by-upc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:items})});
      var d=await res.json().catch(function(){return{};});
      Object.keys(d.products||{}).forEach(function(k){focIntel.pc[k]=Object.assign({},d.products[k],{at:new Date().toISOString()});});
    }
    focSaveMarketCache();
  }catch(e){toast_dash('PriceCharting check failed: '+e.message);}
  focRedrawIntel();
}
async function focUseRatioPrice(skuId,price){
  if(!confirm('Set this cover\'s sell price to $'+Number(price).toFixed(2)+'?'))return;
  try{await api('/foc/admin/sku',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),skuId:skuId,customerPrice:Number(price).toFixed(2)})});toast_dash('Sell price set');await refreshCycleFamilies();focRedrawIntel();}
  catch(e){toast_dash('Could not set price: '+e.message);}
}
function openFocWatchList(){
  var w=focWatch(),old=document.getElementById('foc-watch-modal');if(old)old.remove();
  var m=document.createElement('div');m.id='foc-watch-modal';
  m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:24px 12px';
  var field=function(key,label,hint){return '<label style="display:block;margin-top:10px;font:9px var(--font-mono);color:var(--dim)">'+label+'<textarea class="tsi" data-watch="'+key+'" rows="2" style="width:100%;margin-top:4px" placeholder="'+esc(hint)+'">'+esc((w[key]||[]).join(', '))+'</textarea></label>';};
  m.innerHTML='<div style="width:100%;max-width:560px;background:var(--surf);border:1px solid var(--border);border-radius:10px;padding:16px"><div style="display:flex;justify-content:space-between;align-items:center"><div style="font:900 12px \'Orbitron\',monospace;color:var(--gold);letter-spacing:1px">⭐ WATCH LIST</div><button onclick="document.getElementById(\'foc-watch-modal\').remove()" style="background:none;border:none;color:var(--dim);font-size:22px;cursor:pointer">×</button></div>'+
    '<div style="font:9px/1.5 var(--font-mono);color:var(--dim);margin-top:6px">Always flagged on the cover wall and in WHAT TO ORDER, whatever the sales say. Separate with commas. Every device sees the same list.</div>'+
    field('artists','COVER ARTISTS','Peach Momoko, Mark Brooks')+field('characters','CHARACTERS','Spider-Man, Batman')+field('series','SERIES','Absolute Batman, Hillbilly')+
    '<button class="hbtn" style="margin-top:12px;color:var(--g)" onclick="saveFocWatchList()">SAVE</button></div>';
  document.body.appendChild(m);
}
async function saveFocWatchList(){
  var w={artists:[],characters:[],series:[]};
  document.querySelectorAll('#foc-watch-modal [data-watch]').forEach(function(el){w[el.dataset.watch]=el.value.split(/\s*,\s*/).map(function(x){return x.trim();}).filter(Boolean);});
  w.updatedAt=new Date().toISOString();
  try{var res=await storeWorkerFetch('/kv/foc_watch_list',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(w)});if(!res.ok)throw new Error('save failed '+res.status);
    focIntel.watch=w;var m=document.getElementById('foc-watch-modal');if(m)m.remove();toast_dash('Watch list saved');focRedrawIntel();}
  catch(e){toast_dash('Could not save watch list: '+e.message);}
}
function focOrderedQty(f){return (f.variants||[]).filter(function(v){return !v.isIncentive;}).reduce(function(s,v){return s+Number(v.customerQty||0)+Number(v.ebayPresold||0)+Number(v.storeQuantity||0);},0);}
function focShortTitle(v){return (v.title||'')+(v.variantLabel&&!/^cover a$/i.test(v.variantLabel)?' · '+v.variantLabel:'');}
async function renderFocWhatToOrder(){
  var host=document.getElementById('foc-what-to-order'),D=focCD();if(!host||!D)return;
  if(!focIntel.loaded){host.innerHTML='<div class="panel" style="margin-top:10px;font:10px var(--font-mono);color:var(--dim)">Reading what sells here…</div>';await focLoadIntel();host=document.getElementById('foc-what-to-order');if(!host)return;}
  focIntel.memo={};
  var w=D.whatToOrder(state.families,focIntel.demand,focWatch());
  var orderTag=function(f){var n=focOrderedQty(f);return '<span style="color:'+(n?'var(--g)':'var(--red)')+'">'+(n?'ordering '+n:'not ordered')+'</span>';};
  var row=function(left,right){return '<div class="foc-wto-row"><span style="color:var(--text)">'+left+'</span><span style="white-space:nowrap">'+(right||'')+'</span></div>';};
  var sec=function(title,color,body,note){return body?'<div class="foc-wto-sec"><div style="font:900 10px \'Orbitron\',monospace;color:'+color+';letter-spacing:1px;margin-bottom:4px">'+title+'</div>'+(note?'<div style="font:9px var(--font-mono);color:var(--dim);margin-bottom:4px">'+note+'</div>':'')+body+'</div>':'';};
  var mPill=function(f){var m=focIntel.market['fam:'+f.id];return m?' '+focMarketPills(m,focRegularMsrp(f)).map(focPillHtml).join(' '):'';};
  var hot=w.hot.map(function(r){return row(esc(r.f.title)+' <span style="color:var(--g)">sold '+r.intel.series.sold+' here</span>'+mPill(r.f),orderTag(r.f));}).join('');
  var runs=w.runs.map(function(r){return row(esc(r.f.title)+'<br><span style="color:var(--gold)">📚 '+esc(r.intel.runText)+'</span>',orderTag(r.f));}).join('');
  var artists=w.artists.map(function(a){
    var missing=a.covers.filter(function(c){return !c.ordered;});
    return row('🎨 <b>'+esc(a.label)+'</b>'+(a.watched?' ⭐':'')+(a.sold?' <span style="color:var(--dim)">sold '+a.sold+' here</span>':'')+'<br><span style="color:var(--dim)">'+a.covers.length+' cover'+(a.covers.length===1?'':'s')+' this week'+(missing.length?' · not ordered: '+esc(missing.slice(0,8).map(function(c){return focShortTitle(c.variant);}).join(' | '))+(missing.length>8?' +'+(missing.length-8)+' more':''):' · all ordered ✓')+'</span>','');
  }).join('');
  var characters=w.characters.map(function(c){
    return row('🦸 <b>'+esc(c.label)+'</b>'+(c.watched?' ⭐':'')+(c.sold?' <span style="color:var(--dim)">sold '+c.sold+' here</span>':'')+'<br><span style="color:var(--dim)">this week: '+c.titles.slice(0,8).map(function(t){return esc(t.family.title)+' ('+(t.ordered?'ordering '+t.ordered:'<span style="color:var(--red)">not ordered</span>')+')';}).join(' | ')+'</span>','');
  }).join('');
  var sets={};allFocSkus().forEach(function(v){var c=focConnectFor(v.id);if(!c)return;var k=c.set.id||c.set.name;(sets[k]=sets[k]||{c:c,here:[]}).here.push(v);});
  var connect=Object.keys(sets).map(function(k){var s=sets[k],c=s.c;return row('🧩 <b>'+esc(c.set.name||'Connecting covers')+'</b> · have '+c.sum.owned+'/'+c.parts+(c.sum.complete?' <span style="color:var(--g)">complete ✓</span>':'')+'<br><span style="color:var(--dim)">this week: '+s.here.map(function(v){var n=Number(v.customerQty||0)+Number(v.ebayPresold||0)+Number(v.storeQuantity||0);return esc(focShortTitle(v))+' ('+(n?'ordering '+n:'<span style="color:var(--red)">not ordered</span>')+')';}).join(' | ')+'</span>','');}).join('');
  var incentives=allFocSkus().filter(function(v){return v.isIncentive;});
  var ratio=incentives.map(function(v){var q=v.qualification||{},r=focRatioValue(v),t=focRatioValueText(r);
    return row(esc(focShortTitle(v))+' <span style="color:'+(q.qualified?'var(--g)':'var(--dim)')+'">'+Number(q.total||0)+'/'+Number(q.threshold||0)+(q.qualified?' unlocked':' · need '+Number(q.needed||0))+'</span>'+(t?'<br><span style="color:var(--dim)">'+esc(t)+'</span>':'')+focRatioLinksHtml(r),
      r.value?'<span style="color:var(--g)">~$'+r.value.price.toFixed(2)+'</span> <button class="foc-intel-pill foc-intel-btn" onclick="focUseRatioPrice(\''+esc(v.id)+'\','+r.value.price+')">USE</button>':'');}).join('');
  var slow=w.slow.map(function(r){var s=r.intel.series;return row(esc(r.f.title)+'<br><span style="color:var(--red)">'+(r.intel.run&&D.runOverstocked(r.intel.run)?'📚 '+esc(r.intel.runText):'🐢 '+s.stockQty+' on the shelf, '+s.sold+' sold')+'</span>',orderTag(r.f));}).join('');
  var span=w.spanDays>=60?Math.round(w.spanDays/30)+' months':w.spanDays+' days';
  var list=function(groups){return groups.map(function(g){return esc(g.label)+' '+g.sold;}).join(' · ');};
  var tracked=(w.topCharacters.length?'<div>🦸 '+list(w.topCharacters)+'</div>':'')+(w.topArtists.length?'<div>🎨 '+list(w.topArtists)+'</div>':'')+(w.topTypes.length?'<div>🎟 '+list(w.topTypes)+'</div>':'')+(w.bundles?'<div>📦 '+w.bundles+' comic bundle'+(w.bundles===1?'':'s')+' sold</div>':'');
  var checkIds=w.rows.filter(function(r){return r.intel.hot||r.intel.presold||Object.keys(r.intel.variants).length;}).map(function(r){return r.f.id;}).slice(0,36);
  host.innerHTML='<div class="panel" style="margin-top:10px;padding:12px 16px;border-color:rgba(255,209,102,.35)">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><div style="font:900 11px \'Orbitron\',monospace;color:var(--gold);letter-spacing:1px">🧠 WHAT TO ORDER</div><div class="foc-toolbar">'+
    '<button class="hbtn" style="padding:6px 10px;font-size:9px" onclick="focCheckMarket(['+checkIds.map(function(id){return '\''+esc(id)+'\'';}).join(',')+'])" title="Other sellers\' eBay presales: how many are listed and what they ask, for the hot, presold and watched titles ('+checkIds.length+')">🔎 CHECK EBAY ('+checkIds.length+')</button>'+
    (incentives.length?'<button class="hbtn" style="padding:6px 10px;font-size:9px;color:var(--gold)" onclick="focPriceRatio(['+incentives.slice(0,36).map(function(v){return '\''+esc(v.id)+'\'';}).join(',')+'])">💲 PRICE RATIO BOOKS ('+Math.min(36,incentives.length)+')</button>':'')+
    '<button class="hbtn" style="padding:6px 10px;font-size:9px" onclick="openFocWatchList()">⭐ WATCH LIST</button><button class="hbtn" style="padding:6px 10px;font-size:9px" onclick="focLoadIntel(true).then(focRedrawIntel)">↻ SALES</button></div></div>'+
    '<div style="font:9px/1.5 var(--font-mono);color:var(--dim);margin:4px 0 2px">'+(focIntel.demand?'From '+w.soldCount+' comics sold here (register + eBay) in the last '+span+' and what\'s on the shelf.':'Sales history didn\'t load -- showing presales, runs and the watch list only.')+'</div>'+
    sec('🔥 SELLS HERE','var(--g)',hot)+
    sec('📚 RUNS · YOU HAVE THE EARLIER ISSUES','var(--gold)',runs)+
    sec('🎨 COVER ARTISTS THAT SELL / WATCHED','var(--purple)',artists)+
    sec('🦸 CHARACTERS THAT SELL / WATCHED','var(--blue)',characters)+
    sec('🧩 CONNECTING COVERS','var(--purple)',connect,'Order every part you need -- a missing part leaves sets you can\'t finish.')+
    sec('🎟 RATIO BOOKS','var(--gold)',ratio,'Unlock progress and value. PRICE IT uses eBay sold first, then PriceCharting, then 90% of what other sellers ask.')+
    sec('🐢 GO LIGHT','var(--red)',slow)+
    sec('WHAT SELLS HERE OVERALL','var(--dim)',tracked?'<div style="font:9px/1.7 var(--font-mono);color:var(--text)">'+tracked+'</div>':'')+
  '</div>';
}
window.focCheckMarket=focCheckMarket;window.focPriceRatio=focPriceRatio;window.focUseRatioPrice=focUseRatioPrice;window.openFocWatchList=openFocWatchList;window.saveFocWatchList=saveFocWatchList;window.focLoadIntel=focLoadIntel;window.focRedrawIntel=focRedrawIntel;

// COMIC SELL-THROUGH -- which series sell out and which sit on the shelf.
var sellThroughFilter='all';
async function openComicSellThrough(force){
  busy('Adding up comic sales…');
  var data;try{data=await focLoadSellThrough(force);}catch(e){panel().innerHTML='<button class="hbtn" onclick="loadFocCycles()">← FOC WALL</button><div class="panel" style="margin-top:10px;color:var(--red)">Could not load sales: '+esc(e.message)+'</div>';return;}
  renderComicSellThrough(data);
}
function renderComicSellThrough(data){
  data=data||focSellThrough||{series:[],slowItems:[]};
  var list=(data.series||[]).filter(function(s){return sellThroughFilter==='all'||s.flag===sellThroughFilter;});
  var outs=(data.series||[]).filter(function(s){return s.flag==='sells-out';}).length,slow=(data.series||[]).filter(function(s){return s.flag==='slow';}).length;
  var tab=function(key,label){return '<button class="hbtn" style="padding:6px 10px;font-size:9px;'+(sellThroughFilter===key?'border-color:var(--g);color:var(--g)':'')+'" onclick="focSellThroughFilter(\''+key+'\')">'+label+'</button>';};
  panel().innerHTML='<section class="foc-hero"><div class="foc-toolbar"><button class="hbtn" onclick="loadFocCycles()">← FOC WALL</button><button class="hbtn" onclick="openComicSellThrough(true)">REFRESH</button></div>'+
    '<div style="font:900 20px/1.1 \'Orbitron\',monospace;color:var(--text);margin-top:10px">Comic Sell-Through</div>'+
    '<div style="font:10px/1.6 var(--font-mono);color:var(--dim);margin-top:4px">FOC books received in the last 8 months: store/Whatnot sales plus eBay presales. SELLS OUT = 90%+ sold. SLOW = under 35% sold after 3+ weeks.</div>'+
    '<div class="foc-toolbar" style="margin-top:10px">'+tab('all','ALL ('+(data.series||[]).length+')')+tab('sells-out','SELLS OUT ('+outs+')')+tab('slow','SLOW ('+slow+')')+'</div></section>'+
    '<section class="panel" style="padding:10px 14px">'+(list.length?'<div style="display:grid;grid-template-columns:3fr repeat(5,1fr);gap:6px;font:8px var(--font-mono);color:var(--dim);padding-bottom:4px;border-bottom:1px solid var(--border)"><span>SERIES</span><span>ISSUES</span><span>RECEIVED</span><span>SOLD</span><span>ON SHELF</span><span>SOLD %</span></div>'+
      list.map(function(s){
        var c=s.flag==='sells-out'?'var(--g)':(s.flag==='slow'?'var(--red)':'var(--text)');
        return '<div style="display:grid;grid-template-columns:3fr repeat(5,1fr);gap:6px;font:10px var(--font-mono);padding:4px 0;border-bottom:1px solid var(--border)"><span style="color:var(--text)">'+esc(s.series)+(s.flag?' <b style="color:'+c+';font-size:8px">'+(s.flag==='sells-out'?'SELLS OUT':'SLOW')+'</b>':'')+'</span><span>'+s.issues+'</span><span>'+s.received+'</span><span>'+s.sold+'</span><span>'+s.onHand+'</span><span style="color:'+c+'">'+s.sellThrough+'%</span></div>';
      }).join(''):'<div style="font:10px var(--font-mono);color:var(--dim)">Nothing here yet.</div>')+'</section>'+
    '<section class="panel" style="padding:10px 14px;margin-top:10px"><div style="font:900 11px \'Orbitron\',monospace;color:var(--red);letter-spacing:1px;margin-bottom:6px">NOT SELLING · 3+ WEEKS, ZERO SOLD ('+(data.slowItems||[]).length+')</div>'+
      ((data.slowItems||[]).length?(data.slowItems||[]).map(function(it){
        var done=slowActed[it.id]||'';
        return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;font:10px var(--font-mono);padding:4px 0;border-bottom:1px solid var(--border)"><span style="color:var(--text)">'+esc(it.name)+'</span><span style="display:flex;gap:6px;align-items:center;white-space:nowrap"><span style="color:var(--dim)">'+it.onHand+' on shelf · '+it.days+' days</span>'+
          (done?'<span style="color:var(--g)">'+esc(done)+'</span>':'<button class="hbtn" style="padding:3px 7px;font-size:8px" onclick="focSlowMarkDown(\''+esc(it.id)+'\')">MARK DOWN</button><button class="hbtn" style="padding:3px 7px;font-size:8px;color:var(--purple)" onclick="focSlowWhatnot(\''+esc(it.id)+'\')">→ WHATNOT</button>')+'</span></div>';
      }).join(''):'<div style="font:10px var(--font-mono);color:var(--dim)">Everything received has sold at least one copy.</div>')+
    '<div style="font:9px var(--font-mono);color:var(--dim);margin-top:6px">MARK DOWN lowers the price by a percent you pick. → WHATNOT puts it in the next show (or tonight\'s, if one is live).</div></section>';
}
function focSellThroughFilter(key){sellThroughFilter=key;renderComicSellThrough();}
var slowActed={};
async function focSlowMarkDown(id){if(typeof window.markDownSlowSeller!=='function')return;if(await window.markDownSlowSeller(id)){slowActed[id]='marked down ✓';renderComicSellThrough();}}
async function focSlowWhatnot(id){if(typeof window.flagSlowSellerForWhatnot!=='function')return;if(await window.flagSlowSellerForWhatnot(id)){slowActed[id]='next Whatnot show ✓';renderComicSellThrough();}}
window.focSlowMarkDown=focSlowMarkDown;window.focSlowWhatnot=focSlowWhatnot;
window.focSuggestOrder=focSuggestOrder;window.focApplySuggested=focApplySuggested;window.openComicSellThrough=openComicSellThrough;window.focSellThroughFilter=focSellThroughFilter;

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
    if(typeof XLSX==='undefined'&&window.vendorReady)await window.vendorReady('XLSX').catch(function(){});
    if(typeof XLSX==='undefined')throw new Error('Spreadsheet reader is still loading');
    // raw:true is required here for the same reason handleFocFileImport
    // needs it for the big catalog import -- without it, SheetJS type-infers
    // the big numeric-looking "ISBN / UPC" column and silently corrupts its
    // last digit through float coercion, which would then match nothing.
    var buffer=await file.arrayBuffer();var wb=XLSX.read(buffer,{type:'array',raw:true});var sheet=wb.Sheets[wb.SheetNames[0]];
    var parsed=XLSX.utils.sheet_to_json(sheet,{defval:'',raw:false});
    if(!parsed.length)throw new Error('No rows found in this file');
    // PRH's cart export ("ISBN / UPC", "Quantity") or Lunar's order export
    // ("Code", "Title", "Qty", ..., "UPC") -- either one.
    var keys=Object.keys(parsed[0]);var keyFor=function(names){return keys.find(function(k){return names.indexOf(k.replace(/\s+/g,' ').trim().toLowerCase())>-1;});};
    var upcKey=keyFor(['isbn / upc','upc','isbn']);var codeKey=keyFor(['code','item code','diamond code']);var titleKey=keyFor(['title','description']);
    var qtyKey=keyFor(['quantity','qty','order qty']);
    if((!upcKey&&!codeKey)||!qtyKey)throw new Error('This does not look like a PRH cart or Lunar order export -- expected a UPC (or Code) column and a Quantity/Qty column');
    var rows=parsed.map(function(row){return{upc:upcKey?String(row[upcKey]||'').trim():'',code:codeKey?String(row[codeKey]||'').trim():'',title:titleKey?String(row[titleKey]||'').trim():'',quantity:Number(row[qtyKey])||0};}).filter(function(r){return (r.upc||r.code)&&r.quantity>0;});
    if(!rows.length)throw new Error('No row had both a UPC (or Code) and a positive quantity -- is this the right file?');
    if(status)status.textContent='Matching '+rows.length+' cart rows against this cycle…';
    var d=await api('/foc/admin/prh-cart-import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),cycleId:state.cycle.id,rows:rows,websiteOnly:!!document.getElementById('foc-import-website-only')?.checked})});
    if(status)status.textContent='';
    toast_dash(d.matchedCount+' cover'+(d.matchedCount===1?'':'s')+' matched and updated'+(d.ebayWithdrawnCount?' · '+d.ebayWithdrawnCount+' listing'+(d.ebayWithdrawnCount===1?'':'s')+' ended':'')+(d.ebayQuantityUpdatedCount?' · '+d.ebayQuantityUpdatedCount+' listing'+(d.ebayQuantityUpdatedCount===1?'':'s')+' quantity-synced':''));
    // Refetch this cycle so every per-cover card reflects the new secured/
    // store quantities, then re-render the review screen (not the cover
    // wall openCycle itself renders) with the import result attached.
    await openCycle(state.cycle.id);
    renderFocReview();
    var resultHostAfterRefresh=document.getElementById('foc-prh-cart-result');
    if(resultHostAfterRefresh)resultHostAfterRefresh.innerHTML=focPrhCartResultHtml(d);
  }catch(e){if(status)status.textContent='';toast_dash('Could not import the order: '+e.message);}
}
function focPrhCartResultHtml(d){
  var parts=['<div class="panel" style="margin-top:10px;padding:12px 16px">'+
    '<div style="font:900 11px \'Orbitron\',monospace;color:var(--g);letter-spacing:1px;margin-bottom:6px">'+esc(((state.cycle&&state.cycle.distributor)||'PRH').toUpperCase())+' ORDER IMPORTED</div>'+
    '<div style="font:10px var(--font-mono);color:var(--dim)">'+d.matchedCount+' cover'+(d.matchedCount===1?'':'s')+' matched to this cycle and had secured/store quantities set to match your real order.'+
    (d.ebayWithdrawnCount?'<br>'+d.ebayWithdrawnCount+' eBay listing'+(d.ebayWithdrawnCount===1?'':'s')+' ended -- left out of the cart, so nothing is coming from the distributor.':'')+
    (d.ebayQuantityUpdatedCount?'<br>'+d.ebayQuantityUpdatedCount+' eBay listing'+(d.ebayQuantityUpdatedCount===1?'':'s')+' had its buyable quantity adjusted to the real ordered total.':'')+
    '</div></div>'];
  if(d.unmatchedRows&&d.unmatchedRows.length){
    parts.push('<div class="panel" style="margin-top:10px;padding:12px 16px;border-color:rgba(255,209,102,.35)">'+
      '<div style="font:900 11px \'Orbitron\',monospace;color:var(--gold);letter-spacing:1px;margin-bottom:6px">⚠ '+d.unmatchedRows.length+' CART ROW'+(d.unmatchedRows.length===1?'':'S')+' NOT MATCHED</div>'+
      '<div style="font:9px var(--font-mono);color:var(--dim);margin-bottom:6px">Usually non-comic lines PRH\'s own cart mixes in (posters, merchandise) that were never part of this catalog import -- but double-check a UPC below isn\'t a real cover that just doesn\'t match (a reprint, a distributor UPC change).</div>'+
      d.unmatchedRows.map(function(r){return '<div style="font:9px var(--font-mono);color:var(--text);padding:2px 0">'+(r.title?esc(r.title)+' · ':'')+(r.upc?'UPC '+esc(r.upc):'Code '+esc(r.code||''))+' · qty '+r.quantity+'</div>';}).join('')+
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

// Lunar books with no cover picture get Lunar's large cover where Lunar has
// one (the Worker checks each first). 20 per call; keeps going until done.
async function fillLunarCovers(){
  var status=document.getElementById('foc-review-status');
  var found=0,missing=0;
  try{
    for(var round=0;round<40;round++){
      if(status)status.textContent='Looking up Lunar covers… '+found+' found';
      var d=await api('/foc/lunar-covers/fill',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId()})});
      found+=d.found||0;missing+=d.missing||0;
      if(!d.more||!d.checked)break;
    }
    if(status)status.textContent='';
    toast_dash(found+' Lunar cover'+(found===1?'':'s')+' added'+(missing?' · '+missing+' not on Lunar yet (tried again next week)':''));
  }catch(e){if(status)status.textContent='';toast_dash('Could not look up covers: '+e.message);}
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
      newDesc=rendered+(state.disclosure&&!state.isHtmlTemplate?'\n\n':'')+(state.disclosure||'');
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

// ── Connecting covers tracker ──
// Store ask: "an easy to use connecting covers [tracker] in the FOC area. It
// needs to keep track of covers I bought, covers I missed and upcoming covers
// that connect. Some go across multiple titles." The Worker finds every FOC
// cover whose wording says it connects (any cycle, any title) and suggests
// sets by publisher + cover artist + part count; the store saves, renames,
// edits and grows sets here. Saved sets live in the store's Worker KV
// (foc_connecting_sets, never expires) so every device sees the same list.
var connectState={covers:{},aliases:{},suggested:[],saved:{sets:[]},filter:'all',query:'',search:{}};
function connectToday(){return new Date().toISOString().slice(0,10);}
function connectStatus(cover,set){
  if(set&&set.have&&set.have[cover.id])return 'have';
  if(Number(cover.orderedQty||0)>0)return 'bought';
  if(set&&set.skip&&set.skip[cover.id])return 'skipped';
  if(cover.foc_date&&cover.foc_date>=connectToday())return 'upcoming';
  return 'missed';
}
var CONNECT_BADGE={have:['HAVE IT','var(--g)'],bought:['BOUGHT','var(--g)'],upcoming:['UPCOMING','var(--gold)'],missed:['MISSED','var(--red)'],skipped:['SKIPPED','var(--dim)']};
function connectSetCovers(set){
  // An id saved from an older listing of the same cover resolves to the one
  // shown now (see dedupeConnectingCovers), and is listed once.
  var seen={};
  return (set.skuIds||[]).map(function(id){return connectState.covers[connectState.aliases[id]||id];}).filter(function(c){if(!c||seen[c.id])return false;seen[c.id]=1;return true;}).sort(function(a,b){
    return (Number(a.part||99)-Number(b.part||99))||String(a.foc_date||'').localeCompare(String(b.foc_date||''));
  });
}
function connectSetSummary(set){
  var covers=connectSetCovers(set),counts={have:0,bought:0,upcoming:0,missed:0,skipped:0};
  covers.forEach(function(c){counts[connectStatus(c,set)]++;});
  var partCount=Number(set.partCount||0),unsolicited=partCount>covers.length?partCount-covers.length:0;
  // How many full sets you're building: the most copies ordered of any part.
  // A part ordered short of that leaves sets you can't complete.
  var target=covers.reduce(function(m,c){return Math.max(m,Number(c.orderedQty||0));},0);
  var short=covers.filter(function(c){var st=connectStatus(c,set);return (st==='bought'||st==='upcoming')&&target>0&&Number(c.orderedQty||0)<target;});
  return {covers:covers,counts:counts,owned:counts.have+counts.bought,unsolicited:unsolicited,target:target,short:short,complete:partCount>0&&counts.have+counts.bought>=partCount};
}
async function loadConnectSaved(){
  try{var res=await storeWorkerFetch('/kv/foc_connecting_sets',{cache:'no-store'});var raw=(await res.json().catch(function(){return{};})).value;var parsed=raw?JSON.parse(raw):null;connectState.saved=parsed&&Array.isArray(parsed.sets)?parsed:{sets:[]};}
  catch(e){connectState.saved={sets:[]};}
}
async function saveConnectSets(){
  connectState.saved.updatedAt=new Date().toISOString();
  try{await storeWorkerFetch('/kv/foc_connecting_sets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(connectState.saved)});}
  catch(e){toast_dash('Could not save connecting sets: '+e.message);}
}
function connectSetById(id){return connectState.saved.sets.find(function(s){return s.id===id;});}
async function openConnectingCovers(){
  var old=document.getElementById('foc-connect-modal');if(old)old.remove();
  var modal=document.createElement('div');modal.id='foc-connect-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:24px 12px';
  modal.innerHTML='<div style="width:100%;max-width:880px;background:var(--surf);border:1px solid var(--border);border-radius:10px;padding:16px"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px"><div style="font-family:\'Orbitron\',monospace;color:var(--purple);font-size:13px;letter-spacing:2px">CONNECTING COVERS</div><button onclick="closeFocConnecting()" style="background:none;border:none;color:var(--dim);font-size:22px;cursor:pointer">×</button></div><div id="foc-connect-body" style="font:10px var(--font-mono);color:var(--dim);padding:20px 0;text-align:center">Finding connecting covers across every FOC cycle…</div></div>';
  document.body.appendChild(modal);
  await loadConnectSaved();
  await reloadConnectCovers();
}
async function reloadConnectCovers(){
  var ids=[];connectState.saved.sets.forEach(function(s){(s.skuIds||[]).forEach(function(id){if(ids.indexOf(id)<0)ids.push(id);});});
  try{
    var data=await api('/foc/admin/connecting-covers?store_id='+encodeURIComponent(getActiveStoreId())+(ids.length?'&ids='+encodeURIComponent(ids.slice(0,100).join(',')):''));
    connectState.covers={};(data.covers||[]).forEach(function(c){connectState.covers[c.id]=c;});
    connectState.aliases=data.aliases||{};
    connectState.suggested=data.suggestedSets||[];
    renderConnecting();
  }catch(e){var body=document.getElementById('foc-connect-body');if(body)body.innerHTML='<div style="color:var(--red)">Could not load connecting covers: '+esc(e.message)+'</div>';}
}
function closeFocConnecting(){var m=document.getElementById('foc-connect-modal');if(m)m.remove();}
function connectCoverRow(c,set,saved){
  var st=connectStatus(c,set),badge=CONNECT_BADGE[st];
  var meta=[c.cover_artist,c.publisher,'FOC '+displayDate(c.foc_date),c.on_sale_date?'on sale '+displayDate(c.on_sale_date):''].filter(Boolean).join(' · ');
  var actions='';
  if(saved){
    actions+=st==='have'?'<button class="hbtn" onclick="focConnectToggle(\''+esc(set.id)+'\',\''+esc(c.id)+'\',\'have\')">UNDO HAVE</button>':(st!=='bought'?'<button class="hbtn" style="color:var(--g)" onclick="focConnectToggle(\''+esc(set.id)+'\',\''+esc(c.id)+'\',\'have\')">HAVE IT</button>':'');
    if(st==='missed'||st==='skipped')actions+='<button class="hbtn" onclick="focConnectToggle(\''+esc(set.id)+'\',\''+esc(c.id)+'\',\'skip\')">'+(st==='skipped'?'UNSKIP':'SKIP')+'</button>';
    actions+='<button class="hbtn" style="color:var(--red)" onclick="focConnectRemove(\''+esc(set.id)+'\',\''+esc(c.id)+'\')">REMOVE</button>';
  }
  if(st==='upcoming'&&c.cycle_id)actions+='<button class="hbtn" style="color:var(--gold)" onclick="focConnectOpenCycle(\''+esc(c.cycle_id)+'\')">ORDER IN FOC</button>';
  // Status + buttons sit on their own wrapping line under the title, so
  // three buttons never squeeze the title to nothing on a phone.
  return '<div style="display:grid;grid-template-columns:44px minmax(0,1fr);gap:8px;align-items:start;padding:6px;border:1px solid var(--border);border-radius:7px;background:var(--bg);margin-top:5px">'+
    (c.cover_image_url?'<img src="'+esc(c.cover_image_url)+'" alt="" loading="lazy" style="width:44px;height:64px;object-fit:contain;border-radius:4px;background:#050607">':'<div style="width:44px;height:64px;display:grid;place-items:center;border:1px solid var(--border);border-radius:4px;font-size:8px;color:var(--dim)">'+(c.part?'#'+c.part:'COVER')+'</div>')+
    '<div style="min-width:0;overflow-wrap:anywhere"><b style="font-size:11px">'+(c.part?'Part '+c.part+' · ':'')+esc(c.title||'')+'</b><div style="font:9px/1.5 var(--font-mono);color:var(--dim)">'+esc(c.variant_label||'')+'<br>'+esc(meta)+connectCoverFacts(c,set)+'</div>'+
    '<div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-top:6px"><span class="foc-badge" style="color:'+badge[1]+';border-color:'+badge[1]+'">'+badge[0]+(st==='bought'?' · '+Number(c.orderedQty||0):'')+'</span>'+actions.replace(/class="hbtn" style="/g,'class="hbtn" style="flex:0 0 auto;width:auto;min-height:0;padding:5px 9px;font-size:9px;').replace(/class="hbtn" onclick/g,'class="hbtn" style="flex:0 0 auto;width:auto;min-height:0;padding:5px 9px;font-size:9px" onclick')+'</div></div></div>';
}
// The numbers that matter for one cover: ordered (from the distributor
// order you uploaded, else store + preorders), in stock, sold on eBay,
// and who preordered it -- plus a warning when it's short of the set.
function connectCoverFacts(c,set){
  var bits=[];
  if(Number(c.orderedQty||0))bits.push('ordered '+Number(c.orderedQty)+(Number(c.securedQty||0)?' (distributor)':''));
  if(Number(c.inStock||0))bits.push(Number(c.inStock)+' in stock');
  if(Number(c.ebaySold||0))bits.push(Number(c.ebaySold)+' sold on eBay');
  var out=bits.length?'<br>'+esc(bits.join(' · ')):'';
  if((c.customers||[]).length)out+='<br><span style="color:var(--purple)">Preordered by '+esc(c.customers.slice(0,4).join(', ')+(c.customers.length>4?' +'+(c.customers.length-4)+' more':''))+'</span>';
  if(set){var sum=connectSetSummary(set);if(sum.short.some(function(x){return x.id===c.id;}))out+='<br><span style="color:var(--gold)">Short: '+Number(c.orderedQty||0)+' of '+sum.target+' -- '+(sum.target-Number(c.orderedQty||0))+' more to finish every set</span>';}
  return out;
}
// The whole picture in part order: each cover's art, and a dashed gap for a
// part you don't have, missed, or that isn't solicited yet.
function connectSetStrip(set){
  var sum=connectSetSummary(set),covers=sum.covers,n=Math.max(Number(set.partCount||0),covers.length);if(!n)return '';
  var byPart={},loose=[];covers.forEach(function(c){if(c.part&&!byPart[c.part])byPart[c.part]=c;else loose.push(c);});
  var slots=[];for(var i=1;i<=n;i++)slots.push(byPart[i]||loose.shift()||null);
  var color={have:'var(--g)',bought:'var(--g)',upcoming:'var(--gold)',missed:'var(--red)',skipped:'var(--dim)'};
  return '<div style="display:flex;gap:3px;margin:8px 0 2px;overflow-x:auto">'+slots.map(function(c,i){
    if(!c)return '<div title="Part '+(i+1)+' not solicited yet" style="flex:0 0 46px;height:68px;border:1px dashed var(--border);border-radius:4px;display:grid;place-items:center;font:8px var(--font-mono);color:var(--dim)">#'+(i+1)+'<br>TBA</div>';
    var st=connectStatus(c,set);
    return '<div title="'+esc((c.part?'Part '+c.part+' · ':'')+(c.title||'')+' · '+CONNECT_BADGE[st][0])+'" style="flex:0 0 46px;height:68px;border:2px solid '+color[st]+';border-radius:4px;overflow:hidden;background:#050607;position:relative'+(st==='missed'||st==='skipped'?';opacity:.45':'')+'">'+(c.cover_image_url?'<img src="'+esc(c.cover_image_url)+'" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover">':'<div style="display:grid;place-items:center;height:100%;font:8px var(--font-mono);color:var(--dim)">#'+(c.part||i+1)+'</div>')+'</div>';
  }).join('')+'</div>';
}
// UP NEXT: every part still to order, soonest FOC first, with how many to
// order to match the parts you already have. Covers both tracked sets and
// suggested sets you've already started buying.
function connectUpNext(){
  var list=[],seen={};
  var consider=function(set,tracked){
    var sum=connectSetSummary(set);if(!tracked&&!sum.owned)return;
    sum.covers.forEach(function(c){
      if(seen[c.id]||connectStatus(c,set)!=='upcoming')return;seen[c.id]=1;
      var days=Math.round((Date.parse(c.foc_date+'T12:00:00')-Date.parse(connectToday()+'T12:00:00'))/864e5);
      list.push({c:c,set:set,tracked:tracked,days:days,target:sum.target,ordered:Number(c.orderedQty||0)});
    });
  };
  connectState.saved.sets.forEach(function(s){consider(s,true);});
  var savedIds={};connectState.saved.sets.forEach(function(s){(s.skuIds||[]).forEach(function(id){savedIds[connectState.aliases[id]||id]=1;});});
  connectState.suggested.forEach(function(g){consider({id:g.id,name:g.name,partCount:g.partCount,skuIds:g.skuIds.filter(function(id){return !savedIds[id];})},false);});
  list.sort(function(a,b){return a.days-b.days;});
  if(!list.length)return '';
  return '<div class="ph" style="margin-top:12px;color:var(--gold)">UP NEXT -- PARTS TO ORDER ('+list.length+')</div>'+list.slice(0,25).map(function(x){
    var c=x.c,need=x.target>x.ordered?x.target-x.ordered:0;
    var when=x.days<=0?'<b style="color:var(--red)">FOC TODAY</b>':x.days===1?'<b style="color:var(--red)">FOC TOMORROW</b>':'FOC in '+x.days+' days ('+esc(displayDate(c.foc_date))+')';
    return '<div style="display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:8px;align-items:center;padding:6px;border:1px solid rgba(255,209,102,.35);border-radius:7px;margin-top:5px">'+
      (c.cover_image_url?'<img src="'+esc(c.cover_image_url)+'" alt="" loading="lazy" style="width:34px;height:50px;object-fit:cover;border-radius:3px">':'<div style="width:34px;height:50px;border:1px solid var(--border);border-radius:3px"></div>')+
      '<div style="min-width:0;font:9px/1.5 var(--font-mono);color:var(--dim);overflow-wrap:anywhere"><b style="font-size:10px;color:var(--text)">'+(c.part?'Part '+c.part+' · ':'')+esc(c.title||'')+'</b><br>'+esc(x.set.name||'')+(x.tracked?'':' (suggested)')+'<br>'+when+(x.target?' · you have '+x.target+' of the earlier parts':'')+(x.ordered?' · ordered '+x.ordered:'')+(need?' · <b style="color:var(--gold)">order '+need+' more</b>':'')+'</div>'+
      (c.cycle_id?'<button class="hbtn" style="flex:0 0 auto;width:auto;min-height:0;padding:5px 9px;font-size:9px;color:var(--gold)" onclick="focConnectOpenCycle(\''+esc(c.cycle_id)+'\')">ORDER</button>':'')+'</div>';
  }).join('');
}
// COLLECTORS TO CALL: customers who have one part of a tracked set (or are
// on the pull list for one of its titles) but haven't preordered an
// upcoming part -- see connectingCollectorAlerts in dashboard-app.js.
function connectCollectorsHtml(){
  if(typeof window.connectingCollectorAlerts!=='function')return '';
  var covers=Object.keys(connectState.covers).map(function(id){return connectState.covers[id];});
  var alerts=window.connectingCollectorAlerts(connectState.saved.sets,covers,connectState.aliases,connectToday());
  if(!alerts.length)return '';
  return '<div class="ph" style="margin-top:12px;color:var(--purple)">COLLECTORS TO CALL ('+alerts.length+')</div>'+alerts.slice(0,30).map(function(a){
    var c=a.cover;
    return '<div style="padding:6px;border:1px solid rgba(199,125,255,.35);border-radius:7px;margin-top:5px;font:9px/1.5 var(--font-mono);color:var(--dim)"><b style="font-size:10px;color:var(--text)">'+esc(a.name)+'</b> '+(a.pull?'is on the pull list for '+esc(a.set):'has '+esc(a.has.join(', ')))+'<br>Not preordered yet: <b style="color:var(--text)">'+(c.part?'Part '+c.part+' · ':'')+esc(c.title||'')+'</b> · FOC '+esc(displayDate(c.foc_date))+'</div>';
  }).join('');
}
function connectSetCard(set,saved,suggestIdx){
  var sum=connectSetSummary(set);
  var head='<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center"><div><b style="font-size:12px;color:var(--text)">'+esc(set.name||'Connecting set')+'</b>'+(saved?'':' <span class="foc-badge">SUGGESTED</span>')+(sum.complete?' <span class="foc-badge" style="color:var(--g);border-color:var(--g)">COMPLETE</span>':'')+
    '<div style="font:9px/1.6 var(--font-mono);color:var(--dim)">'+(set.partCount?set.partCount+' parts · ':'')+sum.owned+' owned · '+sum.counts.upcoming+' upcoming · '+sum.counts.missed+' missed'+(sum.unsolicited?' · '+sum.unsolicited+' not solicited yet':'')+(sum.target?' · building '+sum.target+' set'+(sum.target===1?'':'s'):'')+(sum.short.length?' · <span style="color:var(--gold)">'+sum.short.length+' part'+(sum.short.length===1?'':'s')+' short</span>':'')+'</div></div><div style="display:flex;gap:5px;flex-wrap:wrap">'+
    (saved?'<button class="hbtn" onclick="focConnectRename(\''+esc(set.id)+'\')">RENAME / PARTS</button><button class="hbtn" style="color:var(--red)" onclick="focConnectDelete(\''+esc(set.id)+'\')">DELETE SET</button>':'<button class="hbtn" style="color:var(--g)" onclick="focConnectSaveSuggested('+suggestIdx+')">TRACK THIS SET</button>')+'</div></div>';
  var rows=connectSetStrip(set)+sum.covers.map(function(c){return connectCoverRow(c,set,saved);}).join('');
  var add='';
  if(saved){
    var results=connectState.search[set.id]||[];
    add='<div style="display:flex;gap:6px;margin-top:8px"><input class="tsi" id="foc-connect-q-'+esc(set.id)+'" placeholder="Add a cover: search title, variant or artist" style="flex:1" onkeydown="if(event.key===\'Enter\'){event.preventDefault();focConnectSearch(\''+esc(set.id)+'\')}"><button class="hbtn" onclick="focConnectSearch(\''+esc(set.id)+'\')">SEARCH</button></div>'+
      results.filter(function(c){return (set.skuIds||[]).indexOf(c.id)<0;}).slice(0,12).map(function(c){return '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;font:9px/1.5 var(--font-mono);padding:5px 0;border-bottom:1px solid var(--border)"><span>'+esc(c.title||'')+' · '+esc(c.variant_label||'')+' · FOC '+esc(displayDate(c.foc_date))+'</span><button class="hbtn" onclick="focConnectAdd(\''+esc(set.id)+'\',\''+esc(c.id)+'\')">ADD</button></div>';}).join('');
  }
  return '<div class="panel" style="margin-top:10px">'+head+rows+add+'</div>';
}
function renderConnecting(){
  var body=document.getElementById('foc-connect-body');if(!body)return;
  body.style.cssText='font:inherit;color:inherit;text-align:left';
  var savedIds={};connectState.saved.sets.forEach(function(s){(s.skuIds||[]).forEach(function(id){savedIds[id]=1;});});
  var suggestions=connectState.suggested.map(function(g,i){return {set:{id:g.id,name:g.name,partCount:g.partCount,skuIds:g.skuIds.filter(function(id){return !savedIds[id];})},idx:i};}).filter(function(x){return x.set.skuIds.length;});
  var q=connectState.query.toLowerCase();
  var matches=function(set){
    var sum=connectSetSummary(set),f=connectState.filter;
    if(f==='upcoming'&&!sum.counts.upcoming)return false;
    if(f==='missed'&&!sum.counts.missed)return false;
    if(f==='complete'&&!sum.complete)return false;
    if(f==='incomplete'&&sum.complete)return false;
    return !q||(set.name+' '+sum.covers.map(function(c){return c.title+' '+c.variant_label+' '+c.cover_artist;}).join(' ')).toLowerCase().indexOf(q)>-1;
  };
  var filters=[['all','ALL'],['upcoming','HAS UPCOMING'],['missed','HAS MISSED'],['incomplete','INCOMPLETE'],['complete','COMPLETE']].map(function(f){return '<button class="hbtn" style="flex:0 0 auto;width:auto;min-height:0;padding:6px 10px;font-size:9px;'+(connectState.filter===f[0]?'background:var(--purple);color:#fff;border-color:var(--purple)':'')+'" onclick="focConnectFilter(\''+f[0]+'\')">'+f[1]+'</button>';}).join('');
  var savedCards=connectState.saved.sets.filter(matches).map(function(s){return connectSetCard(s,true);}).join('');
  var suggestCards=suggestions.filter(function(x){return matches(x.set);}).map(function(x){return connectSetCard(x.set,false,x.idx);}).join('');
  body.innerHTML='<div style="font:10px/1.6 var(--font-mono);color:var(--dim)">Covers come from every FOC import whose wording says they connect, across titles. <b style="color:var(--g)">Bought</b> = ordered for the shelf or by customers; <b style="color:var(--red)">missed</b> = FOC passed with none ordered; <b style="color:var(--gold)">upcoming</b> = FOC still ahead. Mark covers you got elsewhere as HAVE IT.</div>'+
    '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;align-items:center">'+filters+'</div><div style="display:flex;gap:6px;margin-top:6px;align-items:center"><input class="tsi" placeholder="Filter sets" value="'+esc(connectState.query)+'" oninput="focConnectQuery(this.value)" style="flex:1;min-width:0"><button class="hbtn" style="flex:0 0 auto;width:auto" onclick="focConnectNewSet()">+ NEW SET</button></div>'+
    connectUpNext()+connectCollectorsHtml()+
    '<div class="ph" style="margin-top:12px">TRACKED SETS ('+connectState.saved.sets.length+')</div>'+(savedCards||'<div style="color:var(--dim);font:10px var(--font-mono);padding:8px 0">'+(connectState.saved.sets.length?'No tracked set matches this filter.':'No sets tracked yet -- choose TRACK THIS SET on a suggestion below, or + NEW SET.')+'</div>')+
    '<div class="ph" style="margin-top:14px;display:flex;justify-content:space-between;align-items:center;gap:8px">SUGGESTED FROM YOUR FOC IMPORTS ('+suggestions.length+')'+(suggestions.length?'<button class="hbtn" style="flex:0 0 auto;width:auto;min-height:0;padding:5px 9px;font-size:9px;color:var(--g)" onclick="focConnectTrackAll()">TRACK ALL</button>':'')+'</div>'+(suggestCards||'<div style="color:var(--dim);font:10px var(--font-mono);padding:8px 0">No untracked connecting covers found.</div>');
}
async function focConnectSaveSuggested(idx){
  var g=connectState.suggested[idx];if(!g)return;
  var tracked={};connectState.saved.sets.forEach(function(s){(s.skuIds||[]).forEach(function(id){tracked[id]=1;});});
  var name=prompt('Name this connecting set',g.name);if(name===null)return;
  connectState.saved.sets.unshift({id:'set_'+Date.now().toString(36),name:name.trim()||g.name,partCount:g.partCount||0,skuIds:g.skuIds.filter(function(id){return !tracked[id];}),have:{},skip:{},createdAt:new Date().toISOString()});
  await saveConnectSets();renderConnecting();toast_dash('Tracking '+(name.trim()||g.name));
}
// Tracks every suggested set at once, with its suggested name.
async function focConnectTrackAll(){
  var tracked={};connectState.saved.sets.forEach(function(s){(s.skuIds||[]).forEach(function(id){tracked[connectState.aliases[id]||id]=1;});});
  var fresh=[];
  connectState.suggested.forEach(function(g,i){
    var ids=g.skuIds.filter(function(id){return !tracked[id];});if(!ids.length)return;
    ids.forEach(function(id){tracked[id]=1;});
    fresh.push({id:'set_'+Date.now().toString(36)+'_'+i,name:g.name,partCount:g.partCount||0,skuIds:ids,have:{},skip:{},createdAt:new Date().toISOString()});
  });
  var added=fresh.length;
  if(!added){toast_dash('Nothing new to track');return;}
  if(!confirm('Track '+added+' suggested set'+(added===1?'':'s')+'? You can rename or delete any of them after.'))return;
  connectState.saved.sets=connectState.saved.sets.concat(fresh);
  await saveConnectSets();renderConnecting();toast_dash('Tracking '+added+' set'+(added===1?'':'s'));
}
async function focConnectNewSet(){
  var name=prompt('Name the connecting set (e.g. "Midnight Crain 3-part")');if(!name||!name.trim())return;
  var parts=Number(prompt('How many covers connect? (leave blank if unknown)')||0)||0;
  connectState.saved.sets.unshift({id:'set_'+Date.now().toString(36),name:name.trim(),partCount:parts,skuIds:[],have:{},skip:{},createdAt:new Date().toISOString()});
  await saveConnectSets();renderConnecting();
}
async function focConnectRename(setId){
  var set=connectSetById(setId);if(!set)return;
  var name=prompt('Set name',set.name);if(name===null)return;
  var parts=prompt('How many covers connect? (blank = unknown)',set.partCount?String(set.partCount):'');if(parts===null)return;
  set.name=name.trim()||set.name;set.partCount=Number(parts)||0;
  await saveConnectSets();renderConnecting();
}
async function focConnectDelete(setId){
  var set=connectSetById(setId);if(!set||!confirm('Stop tracking "'+set.name+'"? Its covers go back to the suggestions.'))return;
  connectState.saved.sets=connectState.saved.sets.filter(function(s){return s.id!==setId;});
  await saveConnectSets();renderConnecting();
}
async function focConnectToggle(setId,skuId,kind){
  var set=connectSetById(setId);if(!set)return;
  set[kind]=set[kind]||{};if(set[kind][skuId])delete set[kind][skuId];else set[kind][skuId]=true;
  await saveConnectSets();renderConnecting();
}
async function focConnectRemove(setId,skuId){
  var set=connectSetById(setId);if(!set)return;
  set.skuIds=(set.skuIds||[]).filter(function(id){return id!==skuId;});
  await saveConnectSets();renderConnecting();
}
async function focConnectSearch(setId){
  var input=document.getElementById('foc-connect-q-'+setId);var q=input?input.value.trim():'';if(q.length<2){toast_dash('Type at least 2 characters');return;}
  try{var data=await api('/foc/admin/connecting-covers?store_id='+encodeURIComponent(getActiveStoreId())+'&q='+encodeURIComponent(q));connectState.search[setId]=data.covers||[];(data.covers||[]).forEach(function(c){connectState.covers[c.id]=c;});renderConnecting();var again=document.getElementById('foc-connect-q-'+setId);if(again){again.value=q;}}
  catch(e){toast_dash('Search failed: '+e.message);}
}
async function focConnectAdd(setId,skuId){
  var set=connectSetById(setId);if(!set)return;
  if((set.skuIds||[]).indexOf(skuId)<0)set.skuIds=(set.skuIds||[]).concat(skuId);
  await saveConnectSets();renderConnecting();
}
function focConnectFilter(value){connectState.filter=value;renderConnecting();}
function focConnectQuery(value){connectState.query=value||'';var pos=value.length;renderConnecting();var input=document.querySelector('#foc-connect-body input[placeholder="Filter sets"]');if(input){input.focus();input.setSelectionRange(pos,pos);}}
function focConnectOpenCycle(cycleId){closeFocConnecting();openCycle(cycleId);}

window.focConnectTrackAll=focConnectTrackAll;window.openConnectingCovers=openConnectingCovers;window.closeFocConnecting=closeFocConnecting;window.focConnectSaveSuggested=focConnectSaveSuggested;window.focConnectNewSet=focConnectNewSet;window.focConnectRename=focConnectRename;window.focConnectDelete=focConnectDelete;window.focConnectToggle=focConnectToggle;window.focConnectRemove=focConnectRemove;window.focConnectSearch=focConnectSearch;window.focConnectAdd=focConnectAdd;window.focConnectFilter=focConnectFilter;window.focConnectQuery=focConnectQuery;window.focConnectOpenCycle=focConnectOpenCycle;
// A small cover thumbnail for receiving checklists.
function focThumbHtml(url,alt){
  return url?'<img src="'+esc(url)+'" alt="'+esc(alt||'')+'" loading="lazy" style="width:48px;aspect-ratio:2/3;object-fit:cover;border-radius:4px;border:1px solid var(--border)" onerror="this.style.opacity=.16">'
    :'<div style="width:48px;aspect-ratio:2/3;border:1px dashed var(--border);border-radius:4px;display:grid;place-items:center;font:8px var(--font-mono);color:var(--dim)">NO<br>COVER</div>';
}
// Presold copies of a cover: already sold (profit counted then), so here
// they only mean "pack it and get it to its buyer".
function focPresoldChips(ebay,ship,pickup){
  var out=[];
  if(ebay>0)out.push('<span style="color:var(--blue,#5ab0ff)">📦 '+ebay+' sold on eBay -- pack &amp; ship</span>');
  if(ship>0)out.push('<span style="color:var(--blue,#5ab0ff)">📦 '+ship+' website order'+(ship===1?'':'s')+' to ship</span>');
  if(pickup>0)out.push('<span style="color:var(--purple)">🛍 '+pickup+' for in-store pickup</span>');
  return out;
}

// ── Packing slip scan ──
// Photograph the invoice/packing list that comes in the box; every line is
// read, matched to its FOC cover by barcode (across every FOC week on the
// slip), and received through the same path as RECEIVE SHIPMENT -- paid
// customer copies reserved first, the rest into stock at the invoice's net
// price. Nothing is received until CONFIRM.
function slipImageData(file){
  return new Promise(function(resolve,reject){
    var url=URL.createObjectURL(file);var img=new Image();
    img.onload=function(){
      var scale=Math.min(1,2400/Math.max(img.width,img.height));var c=document.createElement('canvas');
      c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);c.getContext('2d').drawImage(img,0,0,c.width,c.height);
      URL.revokeObjectURL(url);resolve({mediaType:'image/jpeg',data:c.toDataURL('image/jpeg',0.88).split(',')[1]});
    };
    img.onerror=function(){URL.revokeObjectURL(url);reject(new Error('Could not open that photo'));};
    img.src=url;
  });
}
function openPackingSlipScan(){ state.slip=null; renderSlip(); }
function slipPickPhotos(){ var input=document.getElementById('foc-slip-file'); if(input) input.click(); }
// Store ask: "can we also accept these [Lunar's shipment CSV] in with the
// receive instead of only images?" A shipment CSV already lists every line
// -- item code, title, quantity, UPC and the real discounted price -- so it
// goes straight to the matcher, no photo reading. Columns are found by
// name: Code / Item Code, Title, Qty / Quantity, UPC / ISBN / EAN,
// Discounted Price / Net Price, In-Store Date. Lines above the header (the
// shipment number, date, account) give the shipment number.
function slipCsvRows(text){
  var rows=[],row=[],cell='',q=false;
  for(var i=0;i<text.length;i++){
    var ch=text[i];
    if(q){ if(ch==='"'){ if(text[i+1]==='"'){cell+='"';i++;} else q=false; } else cell+=ch; continue; }
    if(ch==='"'){q=true;continue;}
    if(ch===','){row.push(cell);cell='';continue;}
    if(ch==='\n'||ch==='\r'){ if(ch==='\r'&&text[i+1]==='\n')i++; row.push(cell);rows.push(row);row=[];cell='';continue; }
    cell+=ch;
  }
  if(cell!==''||row.length){row.push(cell);rows.push(row);}
  return rows.map(function(r){return r.map(function(c){return String(c).trim();});});
}
function parseSlipCsv(text){
  var rows=slipCsvRows(String(text||'').replace(/^﻿/,''));
  var h=rows.findIndex(function(r){var t=r.join('|').toLowerCase();return /(^|\|)(item )?(code|#)(\||$)|item ?code/.test(t)&&/title|description/.test(t)&&/qty|quantity/.test(t);});
  if(h<0)throw new Error('That CSV has no Code / Title / Qty header row -- is it a distributor shipment file?');
  var head=rows[h].map(function(c){return c.toLowerCase();});
  var col=function(re){return head.findIndex(function(c){return re.test(c);});};
  var iCode=col(/^(item ?)?(code|#|number)$|item ?code/),iTitle=col(/^title$|description/),iQty=col(/^(qty|quantity|units?( shipped)?)$/),
    iUpc=col(/upc|isbn|ean|barcode/),iNet=col(/discounted price|net (unit )?price|^net$|unit cost/),iDate=col(/in-?store date|on-?sale/);
  if(iTitle<0||iQty<0)throw new Error('That CSV is missing its Title or Qty column');
  var dates={},lines=[];
  rows.slice(h+1).forEach(function(r){
    var title=r[iTitle]||'',qty=parseInt(r[iQty],10);
    if(!title||!(qty>0))return;
    var d=iDate>=0?String(r[iDate]||'').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/):null;
    if(d){var iso=d[3]+'-'+('0'+d[1]).slice(-2)+'-'+('0'+d[2]).slice(-2);dates[iso]=(dates[iso]||0)+qty;}
    lines.push({code:iUpc>=0?String(r[iUpc]||'').replace(/\D/g,''):'',itemCode:iCode>=0?r[iCode]:'',title:title,qty:qty,netUnitPrice:iNet>=0?Number(String(r[iNet]||'').replace(/[^0-9.]/g,''))||0:0});
  });
  if(!lines.length)throw new Error('No book lines found in that CSV');
  var before=rows.slice(0,h).map(function(r){return r.join(' ').trim();}).filter(Boolean);
  var onSale=Object.keys(dates).sort(function(a,b){return dates[b]-dates[a];})[0]||'';
  return {invoice:(before.find(function(t){return /^[A-Z]*\d{4,}$/i.test(t);})||'').slice(0,60),onSaleDate:onSale,
    totalUnits:lines.reduce(function(a,l){return a+l.qty;},0),lines:lines};
}
function slipIsCsv(f){return /\.csv$/i.test(f.name||'')||/csv|text\/plain|excel/i.test(f.type||'');}
async function handleSlipFiles(event){
  var all=[].slice.call((event&&event.target&&event.target.files)||[]);
  if(event&&event.target) event.target.value='';
  var csvFiles=all.filter(slipIsCsv),files=all.filter(function(f){return !slipIsCsv(f);}).slice(0,6);
  if(!files.length&&!csvFiles.length) return;
  var status=document.getElementById('foc-slip-status');
  if(status){ status.style.color='var(--gold)'; status.textContent=csvFiles.length&&!files.length?'Reading '+csvFiles[0].name+'…':'Reading '+files.length+' photo'+(files.length===1?'':'s')+'… this takes about 20-40 seconds.'; }
  try{
    var d;
    if(csvFiles.length){
      // A shipment CSV: its lines go straight to the matcher (photos picked
      // with it are read too, and everything is matched together).
      var parsed=(await Promise.all(csvFiles.map(function(f){return f.text();}))).map(parseSlipCsv);
      var csvLines=[].concat.apply([],parsed.map(function(p){return p.lines;}));
      var fromPhotos=files.length?await api('/foc/admin/read-slip',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),images:await Promise.all(files.map(slipImageData))})}):null;
      var csvAll=csvLines.concat(fromPhotos?fromPhotos.lines.map(function(l){return{code:l.code,itemCode:l.itemCode,title:l.title,qty:l.qty,netUnitPrice:l.netUnitPrice};}):[]);
      d=await api('/foc/admin/read-slip',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),lines:csvAll,invoice:parsed[0].invoice||(fromPhotos&&fromPhotos.invoice)||'',onSaleDate:parsed[0].onSaleDate||(fromPhotos&&fromPhotos.onSaleDate)||'',totalUnits:parsed.reduce(function(a,p){return a+p.totalUnits;},0)+((fromPhotos&&fromPhotos.totalUnits)||0)})});
    } else {
      var images=await Promise.all(files.map(slipImageData));
      d=await api('/foc/admin/read-slip',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),images:images})});
    }
    if(state.slip&&state.slip.lines.length){
      // Another page of the same slip: re-match all lines read so far together.
      var raw=state.slip.lines.concat(d.lines).map(function(l){return{code:l.code,itemCode:l.itemCode,title:l.title,qty:l.qty,netUnitPrice:l.netUnitPrice};});
      d=await api('/foc/admin/read-slip',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),lines:raw,invoice:state.slip.invoice||d.invoice,onSaleDate:state.slip.onSaleDate||d.onSaleDate,totalUnits:Math.max(state.slip.totalUnits||0,d.totalUnits||0)})});
    }
    // Another page keeps what was ticked, counted and priced on the first.
    var prev=state.slip&&state.slip.lines.length?state.slip:null;
    state.slip=d;
    state.slip.picks=prev?prev.picks:{};state.slip.qtys=prev?prev.qtys:{};state.slip.prices=prev?prev.prices||{}:{};state.slip.typed=prev?prev.typed||{}:{};state.slip.damaged=prev?prev.damaged||{}:{};
    // Lunar weeks are costed from your Lunar discounts (DC/Image are editable).
    if((d.cycles||[]).some(function(c){return c.distributor==='Lunar';}))await loadLunarDiscountSettings();
    if(status) status.textContent='Looking up who these books are for…';
    await loadSlipBuyers(d);
    renderSlip();
  }catch(e){ if(status){ status.style.color='var(--red)'; status.textContent=e.message; } else toast_dash(e.message); }
}
// Who each book on the slip is already sold or promised to -- the same
// list as the PICK LIST, so names show while checking the slip instead of
// only after receiving. Best effort: the slip still works without it.
async function loadSlipBuyers(slip){
  slip.who={};
  var ids=(slip.cycles||[]).map(function(c){return c.id;}).filter(Boolean);
  if(!ids.length)return;
  try{
    var r=await api('/foc/admin/pick-list?store_id='+encodeURIComponent(getActiveStoreId())+'&cycle_ids='+encodeURIComponent(ids.join(',')));
    (r.covers||[]).forEach(function(c){slip.who[c.skuId]=c;});
  }catch(e){console.warn('[FOC SLIP] Buyer lookup skipped',e.message);}
}
function slipBuyersHtml(who){
  if(!who)return '';
  var rows=[];
  (who.ebay||[]).forEach(function(e){
    rows.push('<div><b style="color:var(--blue,#5ab0ff)">SOLD on eBay</b> · '+esc(e.buyer||'order '+e.orderId)+(e.buyer?' <span style="color:var(--dim)">(order '+esc(e.orderId)+')</span>':'')+' · '+e.qty+' · SHIP'+(e.shipped?' · <span style="color:var(--g)">label bought</span>':'')+'</div>');
  });
  (who.website||[]).forEach(function(w){
    rows.push('<div><b style="color:var(--purple)">SOLD on website</b>'+(w.orderNumber?' #'+esc(w.orderNumber):'')+' · '+esc(w.name)+' · '+w.qty+' · '+(w.method==='pickup'?'HOLD FOR PICKUP':'SHIP')+'</div>');
  });
  (who.pull||[]).forEach(function(p){
    rows.push('<div><b style="color:var(--g)">Pull list</b> · '+esc(p.name)+' · set one aside</div>');
  });
  if(!rows.length)return '';
  return '<div style="font:9px/1.6 var(--font-mono);color:var(--text);margin-top:4px;padding:4px 6px;border-left:2px solid var(--gold);background:rgba(255,200,0,.06)">'+rows.join('')+'</div>';
}
function slipLineKey(l){ return l.code||(l.itemCode?'item:'+l.itemCode:'')||l.title; }
function slipCycleDistributor(cycleId){ var c=((state.slip&&state.slip.cycles)||[]).find(function(x){return x.id===cycleId;}); return (c&&c.distributor)||'PRH'; }
// The cost a slip line will be received at, and where it came from.
function slipLineCost(l){
  var c=l.cover||{},dist=slipCycleDistributor(c.cycleId);
  var unit=focReceiveUnitCost(dist,c.publisher,Math.round(Number(c.coverPrice||0)*100),l.netUnitPrice);
  if(unit!=null)return {unit:unit,source:Number(l.netUnitPrice)>0?'net':'lunar'};
  return {unit:Math.round(Number(c.coverPrice||0)*50)/100,source:'half'};
}
function slipIncluded(l){ var k=slipLineKey(l); return state.slip.picks[k]!=null?state.slip.picks[k]:!!(l.cover&&!l.cover.receivedAt); }
function slipQty(l){ var k=slipLineKey(l); return state.slip.qtys[k]!=null?state.slip.qtys[k]:Math.max(0,l.qty-slipDamaged(l)); }
// Store ask: mark short-shipped and damaged copies on receive, and get the
// list to send the distributor for credit. RECEIVED is the good copies
// going into stock; DAMAGED arrived but can't be sold; whatever's left of
// the slip's count never arrived.
function slipDamaged(l){ return Math.max(0,parseInt(((state.slip&&state.slip.damaged)||{})[slipLineKey(l)],10)||0); }
function focSlipDamaged(k,v){ state.slip.damaged=state.slip.damaged||{}; state.slip.damaged[k]=Math.max(0,parseInt(v,10)||0); renderSlip(); }
function slipClaimLines(slip){
  return (slip.lines||[]).filter(function(l){return l.cover&&slipIncluded(l);}).map(function(l){
    var got=Math.max(0,parseInt(slipQty(l),10)||0),bad=slipDamaged(l),qty=Math.max(0,Number(l.qty)||0);
    return {cycleId:l.cover.cycleId,distributor:slipCycleDistributor(l.cover.cycleId),code:String(l.itemCode||l.code||''),title:String(l.title||l.cover.title||''),invoiced:qty,received:got,damaged:bad,short:Math.max(0,qty-got-bad)};
  }).filter(function(c){return c.damaged||c.short;});
}
function slipClaimText(claim){
  var by={};(claim.lines||[]).forEach(function(c){(by[c.distributor]=by[c.distributor]||[]).push(c);});
  return Object.keys(by).map(function(d){
    return d+' credit request'+(claim.invoice?' -- invoice / delivery '+claim.invoice:'')+' -- received '+String(claim.at||'').slice(0,10)+'\n'+
      by[d].map(function(c){return c.code+'  '+c.title+'  -- invoiced '+c.invoiced+', received '+c.received+[c.short?c.short+' short':'',c.damaged?c.damaged+' damaged':''].filter(Boolean).map(function(x){return ', '+x;}).join('');}).join('\n');
  }).join('\n\n');
}
function slipClaimCsv(claim){
  var q=function(v){v=String(v==null?'':v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;};
  return ['Distributor,Invoice,Item code,Title,Invoiced,Received,Short,Damaged'].concat((claim.lines||[]).map(function(c){return [c.distributor,claim.invoice||'',c.code,c.title,c.invoiced,c.received,c.short,c.damaged].map(q).join(',');})).join('\n')+'\n';
}
// The last few claims stay on this device, to send after the day's rush.
function slipSavedClaims(){ try{var v=JSON.parse(localStorage.getItem('foc-credit-claims')||'[]');return Array.isArray(v)?v:[];}catch(e){return [];} }
function slipSaveClaim(claim){ try{localStorage.setItem('foc-credit-claims',JSON.stringify([claim].concat(slipSavedClaims().filter(function(c){return c.id!==claim.id;})).slice(0,10)));}catch(e){} }
function focCopyClaim(id){
  var c=slipSavedClaims().find(function(x){return x.id===id;})||(pickState.claim&&pickState.claim.id===id?pickState.claim:null);if(!c)return;
  var t=slipClaimText(c);
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(t).then(function(){toast_dash('Credit request copied -- paste it into your email to the distributor');},function(){prompt('Copy the credit request:',t);});
  else prompt('Copy the credit request:',t);
}
function focDownloadClaim(id){
  var c=slipSavedClaims().find(function(x){return x.id===id;})||(pickState.claim&&pickState.claim.id===id?pickState.claim:null);if(!c)return;
  var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([slipClaimCsv(c)],{type:'text/csv'}));a.download='credit-request-'+(c.invoice||String(c.at||'').slice(0,10)||'shipment').replace(/[^\w.-]+/g,'_')+'.csv';document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},500);
}
function slipClaimHtml(claim,open){
  if(!claim||!(claim.lines||[]).length)return '';
  var short=claim.lines.reduce(function(a,c){return a+c.short;},0),bad=claim.lines.reduce(function(a,c){return a+c.damaged;},0),id=esc(claim.id);
  return '<details class="foc-family"'+(open?' open':'')+'><summary class="foc-family-head" style="cursor:pointer"><div class="foc-family-title" style="color:var(--gold)">CREDIT REQUEST'+(claim.invoice?' · '+esc(claim.invoice):'')+' · '+String(claim.at||'').slice(0,10)+' · '+[short?short+' short':'',bad?bad+' damaged':''].filter(Boolean).join(' · ')+'</div></summary>'+
    '<div class="foc-toolbar" style="padding:6px 8px"><button class="hbtn" style="color:var(--gold)" onclick="focCopyClaim(\''+id+'\')">📋 COPY FOR EMAIL</button><button class="hbtn" onclick="focDownloadClaim(\''+id+'\')">⬇ CSV</button></div>'+
    claim.lines.map(function(c){return '<div style="padding:5px 8px;border-bottom:1px solid var(--border);font:10px var(--font-mono);color:var(--text)">'+esc(c.title)+' <span style="color:var(--dim)">· '+esc(c.distributor)+' '+esc(c.code)+' · invoiced '+c.invoiced+' · received '+c.received+'</span>'+(c.short?' <b style="color:var(--gold)">'+c.short+' short</b>':'')+(c.damaged?' <b style="color:var(--red)">'+c.damaged+' damaged</b>':'')+'</div>';}).join('')+'</details>';
}
// Store ask: "I should be able to punch in my prices before going to print
// labels." Each line's shelf price starts at the cover's customer price
// (else its cover price) and is what the copies are received -- and
// labeled -- at.
function slipPrice(l){ var k=slipLineKey(l),c=l.cover||{}; if((state.slip.prices||{})[k]!=null)return state.slip.prices[k]; var p=Number(c.customerPrice)>0?Number(c.customerPrice):Number(c.coverPrice)||0; return p?p.toFixed(2):''; }
function focSlipPrice(k,v){ state.slip.prices=state.slip.prices||{}; state.slip.prices[k]=String(v||'').trim(); state.slip.typed=state.slip.typed||{}; state.slip.typed[k]=true; }
// Store ask: one markup for the whole slip -- "cover x 1.25, round to .99"
// -- so only the exceptions get typed. Lines priced by hand (here, or a
// ratio price set on the FOC wall) keep their price.
function slipMarkupRound(x,mode){
  if(!(x>0))return 0;
  if(mode==='99')return Math.round((Math.ceil(x-0.99-1e-9)+0.99)*100)/100;
  if(mode==='whole')return Math.ceil(x-1e-9);
  return Math.round(x*100)/100;
}
function slipMarkupSettings(){ var d={times:'1.00',round:'99'}; try{var v=JSON.parse(localStorage.getItem('foc-slip-markup')||'null');if(v&&Number(v.times)>0)d={times:String(v.times),round:v.round||'99'};}catch(e){} return d; }
function slipOwnPrice(l){ var c=l.cover||{}; return !!((state.slip.typed||{})[slipLineKey(l)]||(Number(c.customerPrice)>0&&Math.round(c.customerPrice*100)!==Math.round(Number(c.coverPrice||0)*100))); }
function focSlipMarkup(){
  var times=Number((document.getElementById('foc-slip-markup-times')||{}).value),round=(document.getElementById('foc-slip-markup-round')||{}).value||'99';
  if(!(times>0&&times<20)){toast_dash('Enter a markup like 1.25');return;}
  try{localStorage.setItem('foc-slip-markup',JSON.stringify({times:times,round:round}));}catch(e){}
  var set=0,kept=0;state.slip.prices=state.slip.prices||{};
  state.slip.lines.forEach(function(l){var c=l.cover;if(!c)return;if(slipOwnPrice(l)){kept++;return;}var p=slipMarkupRound(Number(c.coverPrice||0)*times,round);if(!p)return;state.slip.prices[slipLineKey(l)]=p.toFixed(2);set++;});
  renderSlip();
  toast_dash('Set '+set+' shelf price'+(set===1?'':'s')+(kept?' · kept '+kept+' you priced yourself':''));
}
function slipLineHtml(l){
  var c=l.cover,k=esc(slipLineKey(l)),qty=slipQty(l),chips=[];
  if(c.receivedAt) chips.push('<span style="color:var(--red)">already received '+esc(new Date(c.receivedAt).toLocaleDateString())+'</span>');
  if(l.how==='close') chips.push('<span style="color:var(--gold)">barcode read 1 digit off -- check it</span>');
  // Only a week whose PRH order was submitted from the dashboard knows what
  // was ordered; a week ordered straight with PRH just shows what's known.
  if(!c.orderedQty) chips.push(c.orderOnFile?'<span style="color:var(--gold)">not on your '+esc(slipCycleDistributor(c.cycleId))+' order</span>':'<span>no saved order for this week</span>');
  else if(l.qty!==c.orderedQty) chips.push('<span style="color:var(--gold)">'+(c.orderOnFile?'ordered ':'expected ')+c.orderedQty+', slip says '+l.qty+'</span>');
  else if(l.how==='exact'&&!c.receivedAt) chips.push('<span style="color:var(--g)">matches your order</span>');
  var missingCopies=Math.max(0,Number(l.qty||0)-(parseInt(qty,10)||0)-slipDamaged(l));
  if(slipIncluded(l)&&(missingCopies||slipDamaged(l)))chips.push('<span style="color:var(--gold)">credit request: '+[missingCopies?missingCopies+' short':'',slipDamaged(l)?slipDamaged(l)+' damaged':''].filter(Boolean).join(', ')+'</span>');
  chips=chips.concat(focPresoldChips(c.ebayPresold,c.customerShip,c.customerPickup));
  return '<div style="display:grid;grid-template-columns:22px 48px 1fr auto;gap:8px;align-items:center;padding:8px;border-bottom:1px solid var(--border)">'+
    '<input type="checkbox"'+(slipIncluded(l)?' checked':'')+' onchange="focSlipPick(\''+k+'\',this.checked)">'+focThumbHtml(c.coverImage,c.title)+
    '<div style="min-width:0"><div style="font-weight:700;font-size:11px;color:var(--text)">'+esc(c.title)+'</div>'+
      '<div style="font:9px/1.5 var(--font-mono);color:var(--dim)">Slip: '+esc(l.title)+' · '+esc(l.code||l.itemCode)+(function(){var k=slipLineCost(l);return ' · cost $'+k.unit.toFixed(2)+(k.source==='net'?' (invoice net)':k.source==='lunar'?' (Lunar '+lunarDiscountPct(c.publisher)+'% off cover)':' (50% of cover)')+(c.coverPrice>0?' · sells $'+Number(c.coverPrice).toFixed(2):'');})()+'</div>'+
      '<div style="font:9px/1.5 var(--font-mono);display:flex;gap:8px;flex-wrap:wrap">'+chips.join('')+'</div>'+slipBuyersHtml((state.slip.who||{})[c.skuId])+'</div>'+
    '<div style="display:flex;gap:6px"><label style="font:8px var(--font-mono);color:var(--dim)" title="Good copies going into stock">RECEIVED<input class="tsi" type="number" min="0" style="width:64px;margin:2px 0 0" value="'+qty+'" onchange="focSlipQty(\''+k+'\',this.value)"></label>'+
    '<label style="font:8px var(--font-mono);color:'+(slipDamaged(l)?'var(--red)':'var(--dim)')+'" title="Arrived damaged -- not put in stock, goes on the credit request">DAMAGED<input class="tsi" type="number" min="0" style="width:54px;margin:2px 0 0" value="'+(slipDamaged(l)||'')+'" placeholder="0" onchange="focSlipDamaged(\''+k+'\',this.value)"></label>'+
    '<label style="font:8px var(--font-mono);color:var(--dim)">SHELF $<input class="tsi" type="number" min="0" step="0.01" style="width:74px;margin:2px 0 0" value="'+esc(slipPrice(l))+'" onchange="focSlipPrice(\''+k+'\',this.value)"></label></div></div>';
}
function renderSlip(){
  var host=panel();if(!host)return;
  var s=state.slip;
  var head='<section class="foc-hero"><div class="foc-toolbar"><button class="hbtn" onclick="loadFocCycles()">← FOC WALL</button>'+(s?'<button class="hbtn" onclick="openPackingSlipScan()">START OVER</button>':'')+'</div>'+
    '<div style="font:900 20px/1.1 \'Orbitron\',monospace;color:var(--text);margin-top:10px">Scan packing slip</div>'+
    '<div style="font:10px/1.6 var(--font-mono);color:var(--dim);margin-top:4px">Photograph the INVOICE/PACKING LIST that comes in the box (the full sheet lists every carton). Each book is matched to its FOC cover by barcode, across every FOC week on the slip. Works for PRH invoices (matched by barcode) and Lunar packing slips (matched by Lunar\'s item code, e.g. 0826DC0141). Check the list, then CONFIRM RECEIVED: customer copies are set aside first, the rest go into stock at the invoice\'s net price -- or, for Lunar (no prices on the slip), your Lunar discount off cover.</div>'+
    '<input type="file" id="foc-slip-file" accept="image/*,.csv,text/csv" multiple hidden onchange="handleSlipFiles(event)">'+
    '<div class="foc-toolbar" style="margin-top:10px"><button class="hbtn" style="color:var(--g)" onclick="focSlipPickPhotos()">📷 '+(s?'ADD ANOTHER PAGE':'TAKE / CHOOSE SLIP PHOTOS OR CSV')+'</button></div>'+
    '<div id="foc-slip-status" style="font:10px var(--font-mono);color:var(--dim);margin-top:6px"></div></section>';
  if(!s){ var past=slipSavedClaims(); host.innerHTML=head+(past.length?'<div style="font:10px var(--font-mono);color:var(--dim);margin:12px 0 4px">CREDIT REQUESTS FROM RECENT SHIPMENTS</div>'+past.map(function(c){return slipClaimHtml(c,false);}).join(''):''); return; }
  var matched=s.lines.filter(function(l){return l.cover;}),unmatched=s.lines.filter(function(l){return !l.cover;});
  var unitsOk=s.totalUnits>0&&s.totalUnits===s.unitsRead;
  var summary='<div class="panel" style="font:10px/1.7 var(--font-mono);color:var(--dim)">'+(s.invoice?'Invoice / delivery '+esc(s.invoice)+' · ':'')+(s.onSaleDate?'On sale '+esc(displayDate(s.onSaleDate))+' · ':'')+
    '<b style="color:'+(s.totalUnits?(unitsOk?'var(--g)':'var(--gold)'):'var(--text)')+'">Read '+s.unitsRead+' book'+(s.unitsRead===1?'':'s')+(s.totalUnits?' of '+s.totalUnits+' printed on the slip':'')+'</b>'+
    (s.totalUnits&&!unitsOk?' -- a page or line may be missing; add another photo':'')+' · '+matched.length+' of '+s.lines.length+' lines matched'+slipPresoldSummary(matched)+'</div>';
  var cycleLabel=function(id){var c=(s.cycles||[]).find(function(x){return x.id===id;});return c?(c.distributor||'PRH')+' FOC '+displayDate(c.focDate):'FOC week';};
  var groups={};matched.forEach(function(l){(groups[l.cover.cycleId]=groups[l.cover.cycleId]||[]).push(l);});
  var sections=Object.keys(groups).sort(function(a,b){return String(groups[a][0].cover.focDate).localeCompare(String(groups[b][0].cover.focDate));}).map(function(id){
    var cyc=(s.cycles||[]).find(function(x){return x.id===id;});
    var tip=cyc&&!cyc.orderOnFile&&cyc.distributor==='Lunar'?'<div style="font:9px/1.6 var(--font-mono);color:var(--dim);padding:6px 8px">No Lunar order saved for this week, so quantities can\'t be checked against it -- the slip\'s counts are used. Lunar slips print no prices, so each copy\'s cost is your Lunar discount off cover (LUNAR COST ESTIMATE SETTINGS on the Lunar tab).</div>'
      :cyc&&!cyc.orderOnFile?'<div style="font:9px/1.6 var(--font-mono);color:var(--dim);padding:6px 8px">No PRH order saved for this week, so quantities can\'t be checked against it. Next time, after ordering on PRH: download the cart from PRH\'s Cart screen and load it with UPLOAD PRH CART on this week\'s FINAL FOC REVIEW. One upload, and slips get checked against it.</div>':'';
    return '<section class="foc-family"><header class="foc-family-head"><div class="foc-family-title">'+esc(cycleLabel(id))+' · '+groups[id].length+' cover'+(groups[id].length===1?'':'s')+'</div></header>'+tip+groups[id].map(slipLineHtml).join('')+'</section>';
  }).join('');
  var notMine=unmatched.length?'<section class="foc-family"><header class="foc-family-head"><div class="foc-family-title" style="color:var(--red)">Not one of your FOC books ('+unmatched.length+')</div></header><div style="font:9px/1.6 var(--font-mono);color:var(--dim);padding:6px 8px">These barcodes aren\'t on any imported FOC week. They won\'t be received here; add them by hand, or import that FOC file first and scan again.</div>'+
    unmatched.map(function(l){return '<div style="padding:6px 8px;border-bottom:1px solid var(--border);font:10px var(--font-mono);color:var(--text)">'+esc(l.title)+' <span style="color:var(--dim)">· '+esc(l.code)+' · qty '+l.qty+'</span></div>';}).join('')+'</section>':'';
  var missing=(s.missing||[]).length?'<details class="panel"><summary style="cursor:pointer;font:10px var(--font-mono);color:var(--gold)">Ordered in these FOC weeks but not on this slip ('+s.missing.length+')</summary><div style="font:9px/1.6 var(--font-mono);color:var(--dim);margin:6px 0">Could be in another shipment or short-shipped. They stay unreceived.</div>'+
    s.missing.map(function(c){return '<div style="padding:4px 0;font:10px var(--font-mono);color:var(--text)">'+esc(c.title)+' <span style="color:var(--dim)">· ordered '+c.orderedQty+' · '+esc(cycleLabel(c.cycleId))+'</span></div>';}).join('')+'</details>':'';
  var picked=matched.filter(slipIncluded),copies=picked.reduce(function(a,l){return a+Math.max(0,parseInt(slipQty(l),10)||0);},0),weeks=Object.keys(picked.reduce(function(m,l){m[l.cover.cycleId]=1;return m;},{})).length;
  var mk=slipMarkupSettings();
  var markup=matched.length?'<div class="panel" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;font:10px var(--font-mono);color:var(--dim)"><b style="color:var(--text)">SHELF PRICES</b> cover ×<input id="foc-slip-markup-times" class="tsi" type="number" min="0.1" step="0.05" style="width:64px;margin:0" value="'+esc(mk.times)+'">'+
    '<select id="foc-slip-markup-round" class="tsi" style="width:auto;margin:0">'+[['99','round up to .99'],['whole','round up to $1'],['none','exact']].map(function(o){return '<option value="'+o[0]+'"'+(mk.round===o[0]?' selected':'')+'>'+o[1]+'</option>';}).join('')+'</select>'+
    '<button class="hbtn" style="color:var(--gold)" onclick="focSlipMarkup()">SET ALL PRICES</button><span>Lines you priced yourself (here or on the FOC wall) are kept. Change any box after.</span></div>':'';
  host.innerHTML=head+summary+markup+sections+notMine+missing+
    (matched.length?'<div class="foc-toolbar" style="margin-top:12px"><button class="hbtn" style="color:var(--g)"'+(copies?'':' disabled')+' onclick="confirmSlipReceive()">CONFIRM RECEIVED · '+copies+' cop'+(copies===1?'y':'ies')+(weeks>1?' across '+weeks+' FOC weeks':'')+'</button></div><div id="foc-slip-receive-status" style="font:10px var(--font-mono);color:var(--dim);margin-top:8px"></div>':'');
}
// Totals of presold copies on the slip: what to pack and ship (or set aside
// for pickup) once the books are in. Sales and profit were recorded when
// each one sold, so receiving never counts them again.
function slipPresoldSummary(lines){
  var ebay=0,ship=0,pickup=0;
  lines.forEach(function(l){ebay+=Number(l.cover.ebayPresold||0);ship+=Number(l.cover.customerShip||0);pickup+=Number(l.cover.customerPickup||0);});
  if(!ebay&&!ship&&!pickup)return '';
  return '<div style="margin-top:6px;color:var(--text)"><b>ALREADY SOLD (the sale was recorded when they bought -- receiving sets these copies aside for them, it doesn\'t sell them again):</b> '+[ebay?ebay+' eBay cop'+(ebay===1?'y':'ies')+' to pack &amp; ship':'',ship?ship+' website cop'+(ship===1?'y':'ies')+' to ship':'',pickup?pickup+' for in-store pickup':''].filter(Boolean).join(' · ')+'</div>';
}
function focSlipPick(key,on){ state.slip.picks[key]=!!on; renderSlip(); }
function focSlipQty(key,value){ state.slip.qtys[key]=Math.max(0,parseInt(value,10)||0); renderSlip(); }
async function confirmSlipReceive(){
  var s=state.slip;if(!s)return;
  var byCycle={};
  s.lines.filter(function(l){return l.cover&&slipIncluded(l);}).forEach(function(l){
    var qty=Math.max(0,parseInt(slipQty(l),10)||0);if(!qty)return;
    var k=slipLineCost(l);
    var price=Number(slipPrice(l));
    (byCycle[l.cover.cycleId]=byCycle[l.cover.cycleId]||[]).push({skuId:l.cover.skuId,receivedQty:qty,unitCost:k.source==='half'?undefined:k.unit,shelfPrice:price>0?Math.round(price*100)/100:undefined});
  });
  var ids=Object.keys(byCycle);if(!ids.length){toast_dash('Nothing ticked to receive');return;}
  var claimLines=slipClaimLines(s);
  var claim=claimLines.length?{id:'c'+Date.now(),at:new Date().toISOString(),invoice:String(s.invoice||'').trim(),lines:claimLines}:null;
  var total=ids.reduce(function(a,id){return a+byCycle[id].reduce(function(b,x){return b+x.receivedQty;},0);},0);
  if(!confirm('Receive '+total+' cop'+(total===1?'y':'ies')+' into inventory'+(ids.length>1?' across '+ids.length+' FOC weeks':'')+'?'))return;
  var status=document.getElementById('foc-slip-receive-status');
  var created=0,flagged=[],failed=[],done=[],spent=0,notifiedAll=[],labelItems=[],okIds=[],pullAll=[];
  var coverBySku={};s.lines.forEach(function(l){if(l.cover)coverBySku[l.cover.skuId]=l.cover;});
  for(var i=0;i<ids.length;i++){
    if(status)status.textContent='Receiving FOC week '+(i+1)+' of '+ids.length+'…';
    try{
      var d=await api('/foc/admin/receive',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),cycleId:ids[i],lines:byCycle[ids[i]]})});
      created+=Number(d.createdInventoryCount||0);
      focHoldNotice(d);
      notifiedAll=notifiedAll.concat(d.notified||[]);
      pullAll=pullAll.concat(d.pullHeld||[]);
      labelItems=labelItems.concat(d.labelItems||[]);
      (d.receivedSummary||[]).forEach(function(r){done.push(r);if(r.incentiveNotReceived)flagged.push(r.title+(r.variantLabel?' -- '+r.variantLabel:'')+': INCENTIVE NOT RECEIVED');});
      try{await api('/foc/ebay/convert-to-instock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),cycleId:ids[i]})});}catch(e){}
      // Received lines drop off this list, so a retry only re-sends what failed.
      s.lines.forEach(function(l){if(l.cover&&l.cover.cycleId===ids[i]&&slipIncluded(l))l.cover.receivedAt=new Date().toISOString();});
      okIds.push(ids[i]);
      // What these copies cost: the invoice's net price, else 50% of cover.
      byCycle[ids[i]].forEach(function(x){var unit=Number(x.unitCost)>0?Number(x.unitCost):Math.round(Number((coverBySku[x.skuId]||{}).coverPrice||0)*50)/100;spent+=unit*x.receivedQty;});
    }catch(e){failed.push(e.message);}
  }
  if(status)status.textContent='';
  // Only weeks that went through go on the credit request (a retry adds the rest).
  if(claim){claim.lines=claim.lines.filter(function(c){return okIds.indexOf(c.cycleId)>=0;});if(claim.lines.length)slipSaveClaim(claim);else claim=null;}
  toast_dash(created+' cop'+(created===1?'y':'ies')+' added to inventory'+(failed.length?' · '+failed.length+' FOC week(s) failed':''));
  // The shipment is money spent on stock: record it as an inventory
  // purchase (Sales -> EXPENSES & CASH FLOW), added to the same invoice's
  // entry if part of it was received before.
  spent=Math.round(spent*100)/100;
  if(spent>0&&typeof window.addStoreInventoryPurchase==='function'){
    try{
      var inv=String(s.invoice||'').trim();
      var dists=Object.keys(ids.reduce(function(m,id){m[slipCycleDistributor(id)]=1;return m;},{}));
      var r=await window.addStoreInventoryPurchase({amount:spent,key:inv?'invoice '+inv:'',note:(inv?dists.join('/')+' invoice '+inv:'Distributor shipment')+' · packing slip',category:'Comics (distributor)'});
      if(r&&r.ok)toast_dash('Inventory purchase recorded: $'+spent.toFixed(2)+(r.updated?' (added to invoice '+inv+', now $'+Number(r.amount).toFixed(2)+')':''));
    }catch(e){}
  }
  if(flagged.length)alert(flagged.join('\n'));
  if(failed.length){alert('Some FOC weeks did not receive:\n\n'+failed.join('\n')+'\n\nThe rest are in. Press CONFIRM again to retry only what failed.');s.picks={};renderSlip();await queueReceivedLabels(labelItems,done);return;}
  if(typeof logOpsEvent==='function')logOpsEvent('foc_slip_received','Received '+created+' copies from a packing slip',{invoice:s.invoice,weeks:ids.length,copies:total});
  var told=pickNoticeLine(notifiedAll);if(told)toast_dash(told);
  pickState.cycleIds=ids;
  pickState.labelItems=labelItems;
  pickState.notified=notifiedAll;
  pickState.pullHeld=slipMergePullHeld(pullAll);
  pickState.claim=claim;
  renderSlipReceived(done,s);
  state.slip=null;
  await queueReceivedLabels(labelItems,done);
}
// RECEIVING-DAY PICK LIST -- every copy that's already spoken for, per
// cover: eBay orders to ship (grouped by order), website preorders to hold
// or ship, and pull-list customers to bag. Print it and tick books off.
var pickState={cycleIds:[],covers:[],labelItems:[],notified:[],claim:null,pullHeld:[]};
// Opens the label printer with the books just received: a price label per
// shelf copy, and a flagged HOLD/SOLD label per copy that's already sold so
// it's pulled instead of shelved.
async function queueReceivedLabels(labelItems,summary){
  pickState.labelItems=labelItems||[];
  if(typeof window.queueLabelsForReceivedItems!=='function'||!pickState.labelItems.length)return;
  try{
    var n=await window.queueLabelsForReceivedItems(pickState.labelItems);
    var sold=pickState.labelItems.reduce(function(a,x){return a+(x&&x.flag?Number(x.copies||0):0);},0);
    if(n)toast_dash((n-sold)+' shelf label'+(n-sold===1?'':'s')+(sold?' + '+sold+' spoken-for cop'+(sold===1?'y':'ies')+' flagged HOLD/SOLD/PULL':'')+' queued');
  }catch(e){toast_dash('Could not queue labels: '+e.message);}
}
function pickNoticeLine(list){
  var sent=(list||[]).filter(function(n){return n.sms||n.email;});
  return sent.length?sent.length+' customer'+(sent.length===1?'':'s')+' told their books are in':'';
}
async function openFocPickList(cycleIds){
  cycleIds=(cycleIds||[]).filter(Boolean);if(!cycleIds.length&&state.cycle)cycleIds=[state.cycle.id];
  pickState.cycleIds=cycleIds;
  busy('Building the pick list…');
  try{var d=await api('/foc/admin/pick-list?store_id='+encodeURIComponent(getActiveStoreId())+'&cycle_ids='+encodeURIComponent(cycleIds.join(',')));pickState.covers=d.covers||[];renderFocPickList();}
  catch(e){panel().innerHTML='<button class="hbtn" onclick="loadFocCycles()">← FOC WALL</button><div class="panel" style="margin-top:10px;color:var(--red)">Could not build the pick list: '+esc(e.message)+'</div>';}
}
function focPickListHtml(covers){
  var tick='<span style="display:inline-block;width:12px;height:12px;border:1px solid var(--dim);border-radius:3px;margin-right:6px;vertical-align:middle"></span>';
  return covers.map(function(c){
    var rows=[];
    c.ebay.forEach(function(e){
      rows.push('<div style="padding:3px 0">'+tick+'<b style="color:var(--blue,#5ab0ff)">eBay</b> order '+esc(e.orderId)+' · '+e.qty+' cop'+(e.qty===1?'y':'ies')+
        (e.shipped?' · <span style="color:var(--g)">label bought</span>':'')+
        (e.waitingOn&&e.waitingOn.length?' · <span style="color:var(--gold)">same order also waiting on: '+esc(e.waitingOn.join(', '))+'</span>':(e.alsoInOrder&&e.alsoInOrder.length?' · ship with: '+esc(e.alsoInOrder.join(', ')):''))+'</div>');
    });
    c.website.forEach(function(w){
      rows.push('<div style="padding:3px 0">'+tick+'<b style="color:var(--purple)">Website</b> #'+esc(w.orderNumber||'')+' · '+esc(w.name)+' · '+w.qty+' · '+(w.method==='pickup'?'HOLD FOR PICKUP':'SHIP')+(w.notified?' · <span style="color:var(--g)">told ✓</span>':'')+'</div>');
    });
    c.pull.forEach(function(p){
      rows.push('<div style="padding:3px 0">'+tick+'<b style="color:var(--g)">Pull list</b> · '+esc(p.name)+(p.notified?' · <span style="color:var(--g)">told ✓</span>':(p.phone||p.email?'':' · <span style="color:var(--dim)">no phone/email</span>'))+'</div>');
    });
    return '<div style="padding:8px 10px;border-bottom:1px solid var(--border)"><div style="display:flex;justify-content:space-between;gap:8px"><b style="font-size:11px;color:var(--text)">'+esc(c.title)+'</b><span style="font:10px var(--font-mono);color:var(--gold);white-space:nowrap">'+c.totalOwed+' owed</span></div><div style="font:10px/1.5 var(--font-mono);color:var(--text)">'+rows.join('')+'</div></div>';
  }).join('');
}
function renderFocPickList(){
  var covers=pickState.covers||[];
  var pullToTell=[];covers.forEach(function(c){c.pull.forEach(function(p){if(!p.notified&&(p.phone||p.email)&&pullToTell.indexOf(p.subscriptionId)<0)pullToTell.push(p.subscriptionId);});});
  var owed=covers.reduce(function(n,c){return n+c.totalOwed;},0);
  panel().innerHTML='<section class="foc-hero"><div class="foc-toolbar"><button class="hbtn" onclick="'+(state.cycle?'openFocCycle(\''+esc(state.cycle.id)+'\')':'loadFocCycles()')+'">← BACK</button><button class="hbtn" onclick="window.print()">🖨 PRINT</button>'+
    (pullToTell.length?'<button class="hbtn" style="color:var(--g)" onclick="focNotifyPullList()">📱 TELL '+pullToTell.length+' PULL-LIST CUSTOMER'+(pullToTell.length===1?'':'S')+'</button>':'')+'</div>'+
    '<div style="font:900 20px/1.1 \'Orbitron\',monospace;color:var(--text);margin-top:10px">Pick list · '+owed+' cop'+(owed===1?'y':'ies')+' spoken for</div>'+
    '<div style="font:10px/1.6 var(--font-mono);color:var(--dim);margin-top:4px">Pull these first, before anything goes on the shelf. Website customers are texted/emailed automatically once their whole order is in.</div></section>'+
    '<section class="panel" style="padding:0">'+(covers.length?focPickListHtml(covers):'<div style="padding:20px;font:10px var(--font-mono);color:var(--dim)">Nothing in this shipment is spoken for -- it can all go on the shelf.</div>')+'</section>';
}
async function focNotifyPullList(){
  var bySub={};
  (pickState.covers||[]).forEach(function(c){c.pull.forEach(function(p){if(p.notified||!(p.phone||p.email))return;(bySub[p.subscriptionId]=bySub[p.subscriptionId]||{subscriptionId:p.subscriptionId,name:p.name,titles:[]}).titles.push(c.title);});});
  var list=Object.keys(bySub).map(function(k){return bySub[k];});
  if(!list.length)return;
  if(!confirm('Text/email '+list.length+' pull-list customer'+(list.length===1?'':'s')+' that their books are in?\n\n'+list.map(function(p){return p.name+': '+p.titles.join(', ');}).join('\n')))return;
  try{
    var d=await api('/foc/admin/notify-arrivals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),cycleIds:pickState.cycleIds,pull:list})});
    var line=pickNoticeLine(d.results);toast_dash(line||'Nobody could be reached');
    var bad=(d.results||[]).filter(function(r){return !(r.sms||r.email);});
    if(bad.length)alert('Not reached:\n'+bad.map(function(r){return r.name+' -- '+(r.errors||[]).join('; ');}).join('\n'));
    openFocPickList(pickState.cycleIds);
  }catch(e){toast_dash('Could not send: '+e.message);}
}
window.openFocPickList=openFocPickList;window.openFocPickListLast=function(){openFocPickList(pickState.cycleIds);};window.focNotifyPullList=focNotifyPullList;
// Store ask: preorder customers told their books are in, on receive. Each
// order is texted/emailed once its last book arrives (worker); this shows
// who was reached, who wasn't and why, and who's still waiting on a book.
function slipToldHtml(notified,summary){
  notified=notified||[];
  var told={};notified.forEach(function(n){told[String(n.orderNumber||n.orderId)]=1;});
  var waiting=[];(summary||[]).forEach(function(r){(r.heldFor||[]).forEach(function(h){if(h.orderNumber&&!told[String(h.orderNumber)]&&waiting.indexOf(h.name+' #'+h.orderNumber)<0)waiting.push(h.name+' #'+h.orderNumber);});});
  if(!notified.length&&!waiting.length)return '';
  var how=function(n){
    if(n.sms||n.email)return '<span style="color:var(--g)">✓ '+[n.sms?'texted':'',n.email?'emailed':''].filter(Boolean).join(' + ')+'</span>'+((n.errors||[]).length?' <span style="color:var(--gold)">('+esc(n.errors.join('; '))+')</span>':'');
    return '<span style="color:var(--red)">✗ not reached -- '+esc((n.errors||[]).join('; ')||'no phone or email on the order')+'. Call them.</span>';
  };
  return '<section class="foc-family"><header class="foc-family-head"><div class="foc-family-title">'+(notified.length?'PREORDER CUSTOMERS TOLD THEIR BOOKS ARE IN ('+notified.filter(function(n){return n.sms||n.email;}).length+' of '+notified.length+')':'PREORDER COPIES SET ASIDE')+'</div></header>'+
    notified.map(function(n){return '<div style="padding:6px 8px;border-bottom:1px solid var(--border);font:10px var(--font-mono);color:var(--text)">'+esc(n.name||'Customer')+(n.orderNumber?' <span style="color:var(--dim)">#'+esc(n.orderNumber)+'</span>':'')+' · '+how(n)+'</div>';}).join('')+
    (waiting.length?'<div style="padding:6px 8px;font:9px/1.6 var(--font-mono);color:var(--dim)">Set aside, still waiting on another book in their order (they\'re told when the last one arrives): '+esc(waiting.join(', '))+'</div>':'')+'</section>';
}
// Pull-list copies set aside on receive, one entry per subscriber (several
// FOC weeks in one slip can each add books for the same person).
function slipMergePullHeld(list){
  var by={};(list||[]).forEach(function(p){var e=by[p.subscriptionId]=by[p.subscriptionId]||{subscriptionId:p.subscriptionId,name:p.name,titles:[]};e.titles=e.titles.concat(p.titles||[]);});
  return Object.keys(by).map(function(k){return by[k];});
}
function slipPullHeldHtml(list){
  if(!(list||[]).length)return '';
  var waiting=list.filter(function(p){return !p.result;});
  return '<section class="foc-family"><header class="foc-family-head"><div class="foc-family-title" style="color:var(--purple)">PULL LISTS SET ASIDE ('+list.length+')</div></header>'+
    '<div style="font:9px/1.6 var(--font-mono);color:var(--dim);padding:6px 8px">On hold under their name (FOC → 📌 ON HOLD). They pay when they pick up: RING UP there, then scan.</div>'+
    list.map(function(p){var r=p.result;return '<div style="padding:6px 8px;border-bottom:1px solid var(--border);font:10px var(--font-mono);color:var(--text)">'+esc(p.name)+' <span style="color:var(--dim)">· '+esc(p.titles.join(', '))+'</span>'+(r?(r.sms||r.email?' · <span style="color:var(--g)">✓ '+[r.sms?'texted':'',r.email?'emailed':''].filter(Boolean).join(' + ')+'</span>':' · <span style="color:var(--red)">✗ not reached -- '+esc((r.errors||[]).join('; ')||'no phone or email on file')+'</span>'):'')+'</div>';}).join('')+
    (waiting.length?'<div class="foc-toolbar" style="padding:6px 8px"><button class="hbtn" style="color:var(--purple)" onclick="focTextPullHeld()">📱 TEXT '+waiting.length+' PULL-LIST CUSTOMER'+(waiting.length===1?'':'S')+'</button></div>':'')+'</section>';
}
async function focTextPullHeld(){
  var list=(pickState.pullHeld||[]).filter(function(p){return !p.result;});if(!list.length)return;
  if(!confirm('Text/email '+list.length+' pull-list customer'+(list.length===1?'':'s')+' that their books are in?\n\n'+list.map(function(p){return p.name+': '+p.titles.join(', ');}).join('\n')))return;
  try{
    var d=await api('/foc/admin/notify-arrivals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),cycleIds:pickState.cycleIds,pull:list.map(function(p){return {subscriptionId:p.subscriptionId,name:p.name,titles:p.titles};})})});
    (d.results||[]).forEach(function(r){var p=(pickState.pullHeld||[]).find(function(x){return x.subscriptionId===r.subscriptionId;});if(p)p.result=r;});
    list.forEach(function(p){if(!p.result)p.result={sms:false,email:false,errors:['no phone or email on file']};});
    var line=pickNoticeLine(d.results);toast_dash(line||'Nobody could be reached');
    var host=document.getElementById('foc-pull-held');if(host)host.innerHTML=slipPullHeldHtml(pickState.pullHeld);
  }catch(e){toast_dash('Could not send: '+e.message);}
}
// After receiving: what each cover's copies are for. eBay and website
// buyers' copies only need packing (their sales were recorded when they
// bought); the rest went into stock.
function renderSlipReceived(summary,slip){
  var host=panel();if(!host)return;
  var bySku={};(slip.lines||[]).forEach(function(l){if(l.cover)bySku[l.cover.skuId]=l.cover;});
  var rows=summary.map(function(r){var c=bySku[r.skuId]||{};return {r:r,c:c};});
  var toShip=rows.filter(function(x){return Number(x.r.reservedForEbayPresale||0)>0||Number(x.r.reservedForCustomers||0)>0||Number(x.r.reservedForPullList||0)>0;});
  var line=function(x){
    var r=x.r,c=x.c,parts=[];
    if(r.reservedForEbayPresale>0)parts.push('<b style="color:var(--blue,#5ab0ff)">📦 '+r.reservedForEbayPresale+' for eBay buyers -- pack &amp; ship</b>');
    if(r.reservedForCustomers>0)parts.push('<b style="color:var(--purple)">'+r.reservedForCustomers+' set aside for website customers'+(c.customerShip?' ('+c.customerShip+' to ship)':'')+'</b>');
    if(r.reservedForPullList>0)parts.push('<b style="color:var(--purple)">'+r.reservedForPullList+' on hold for pull lists ('+esc((r.pullHeldFor||[]).join(', '))+')</b>');
    if(r.availableAsNewStock>0)parts.push('<span style="color:var(--g)">'+r.availableAsNewStock+' into stock</span>');
    if(r.safetyStockHeld>0)parts.push('<span>'+r.safetyStockHeld+' held back</span>');
    if(r.shortShipped>0)parts.push('<span style="color:var(--gold)">'+r.shortShipped+' short</span>');
    return '<div style="display:grid;grid-template-columns:48px 1fr;gap:10px;align-items:center;padding:8px;border-bottom:1px solid var(--border)">'+focThumbHtml(c.coverImage,r.title)+
      '<div><div style="font-weight:700;font-size:11px;color:var(--text)">'+esc(r.title)+(r.variantLabel&&r.title.indexOf(r.variantLabel)<0?' -- '+esc(r.variantLabel):'')+'</div><div style="font:9px/1.6 var(--font-mono);display:flex;gap:8px;flex-wrap:wrap">Received '+r.receivedQty+' · '+parts.join(' · ')+'</div></div></div>';
  };
  var shipCount=toShip.reduce(function(a,x){return a+Number(x.r.reservedForEbayPresale||0);},0);
  host.innerHTML='<section class="foc-hero"><div class="foc-toolbar"><button class="hbtn" onclick="loadFocCycles(true)">← FOC WALL</button><button class="hbtn" onclick="window.print()">PRINT</button>'+(pickState.cycleIds.length?'<button class="hbtn" style="color:var(--g)" onclick="openFocPickListLast()">📋 PICK LIST -- WHO GETS WHAT</button>':'')+(pickState.labelItems.length?'<button class="hbtn" style="color:var(--gold)" title="Price labels for the books going on the shelf" onclick="focPrintReceivedLabels()">🏷️ PRINT LABELS</button>':'')+'</div>'+
    '<div style="font:900 20px/1.1 \'Orbitron\',monospace;color:var(--text);margin-top:10px">Shipment received</div>'+
    '<div style="font:10px/1.6 var(--font-mono);color:var(--dim);margin-top:4px">Presold copies were already counted as sales when they sold -- nothing here adds sales or profit. '+(shipCount?'Buy the labels for the '+shipCount+' eBay cop'+(shipCount===1?'y':'ies')+' from ALL EBAY ORDERS on the eBay tab.':'')+'</div></section>'+
    slipClaimHtml(pickState.claim,true)+slipToldHtml(pickState.notified,summary)+'<div id="foc-pull-held">'+slipPullHeldHtml(pickState.pullHeld)+'</div>'+
    (toShip.length?'<section class="foc-family"><header class="foc-family-head"><div class="foc-family-title">TO PACK &amp; SHIP / SET ASIDE ('+toShip.length+')</div></header>'+toShip.map(line).join('')+'</section>':'')+
    '<details class="foc-family"'+(toShip.length?'':' open')+'><summary class="foc-family-head" style="cursor:pointer"><div class="foc-family-title">EVERYTHING RECEIVED ('+rows.length+')</div></summary>'+rows.map(line).join('')+'</details>';
}
window.ensureFocPanel=function(){loadCycles(false);};window.loadFocCycles=loadCycles;window.openFocCycle=openCycle;window.handleFocImportFile=handleImport;window.handleLunarFocImportFile=handleLunarImport;window.switchFocDistributor=switchDistributor;window.loadLunarDiscountSettings=loadLunarDiscountSettings;window.saveLunarDiscountSettings=saveLunarDiscountSettings;window.filterFocAdmin=function(v){state.query=v;renderFamilies();};window.filterFocPublisher=function(v){state.publisher=v;renderFamilies();};window.filterFocFlag=function(v){state.flag=v;renderFamilies();};window.filterFocEbay=function(v){state.ebay=v;renderFamilies();};window.saveFocSku=saveSku;window.saveFocFamily=saveFamily;window.toggleFocCycle=toggleCycle;window.archiveFocCycle=archiveCycle;window.unarchiveFocCycle=unarchiveCycle;window.saveFocCycleCutoff=saveCutoff;window.exportFocPrh=exportPrh;window.loadFocShippingSettings=loadShipping;window.saveFocShippingSettings=saveShipping;window.openReceiveShipment=openReceiveShipment;window.openPackingSlipScan=openPackingSlipScan;window.handleSlipFiles=handleSlipFiles;window.focSlipPickPhotos=slipPickPhotos;window.focSlipPick=focSlipPick;window.focSlipQty=focSlipQty;window.focSlipPrice=focSlipPrice;window.focSlipMarkup=focSlipMarkup;window.focTextPullHeld=focTextPullHeld;window.focSlipDamaged=focSlipDamaged;window.focCopyClaim=focCopyClaim;window.focDownloadClaim=focDownloadClaim;window.confirmSlipReceive=confirmSlipReceive;window.focPrintReceivedLabels=function(){queueReceivedLabels(pickState.labelItems,[]);};window.confirmReceiveShipment=confirmReceiveShipment;window.createFocEbayPresale=openEbayPresaleReview;window.submitEbayPresaleReview=submitEbayPresaleReview;window.openFamilyEbayGroupReview=openFamilyEbayGroupReview;window.submitFamilyEbayGroupReview=submitFamilyEbayGroupReview;window.handleFocGroupMainImageFile=handleFocGroupMainImageFile;window.clearFocGroupMainImage=clearFocGroupMainImage;window.handleFocGroupBundleImageFile=handleFocGroupBundleImageFile;window.clearFocGroupBundleImage=clearFocGroupBundleImage;window.loadEbaySafeDays=loadEbaySafeDays;window.saveFocEbaySafeDays=saveEbaySafeDays;window.openFocReview=openFocReview;window.openFocIntelligence=openFocIntelligence;window.submitPrhOrder=submitPrhOrder;window.handleFocPrhCartImportFile=handleFocPrhCartImportFile;window.endFocEbayListings=endFocEbayListings;window.toggleFocEndEbayAll=toggleFocEndEbayAll;window.confirmEndFocEbayListings=confirmEndFocEbayListings;window.repairFocEbayGroupPhotos=repairFocEbayGroupPhotos;window.fillLunarCovers=fillLunarCovers;window.reviewStoreQtyChanged=reviewStoreQtyChanged;window.focPublishBulkCheckboxChanged=focPublishBulkCheckboxChanged;window.toggleFocPublishBulkSelectAll=toggleFocPublishBulkSelectAll;window.bulkSetCustomerEnabled=bulkSetCustomerEnabled;window.openOrphanedEbayScan=openOrphanedEbayScan;window.endSelectedOrphanedEbayListings=endSelectedOrphanedEbayListings;
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
