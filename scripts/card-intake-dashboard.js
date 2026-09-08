// The Mana Pocket Card Intake dashboard UI.
//
// IMAGE -> IDENTIFY -> FIND VARIANT -> PRICE -> HUMAN VERIFICATION -> INVENTORY
//
// Kept as its own file/IIFE, mirroring foc-dashboard.js -- this whole
// closure is private, so every function an onclick/onchange HTML attribute
// needs must be re-exposed on window in the block at the bottom (see
// tests/card-intake-window-exposure.test.mjs).
//
// "Async processing" here means a client-side concurrency-limited queue,
// not a server job queue (this app has no Cloudflare Queues binding) --
// capture returns instantly and the identify+resolve calls run in the
// background while the store keeps shooting, PATCHing results back to the
// card_intake_items row as they land so nothing is lost if the tab closes
// mid-batch (the item just sits at status 'captured'/'processing' until
// the queue is resumed or /card-intake/items is re-polled).
(function(){
var state={
  view:'home', batch:null, items:[], thumbById:{},
  camera:{stream:null, facing:false},
  queue:[], active:0, concurrency:2,
  verify:{list:[], index:0, showBack:false, editing:false},
  collections:[], activeCollection:null,
  scannerToken:'',
};

async function api(path,opts){
  var res=await storeWorkerFetch(path,opts||{});var type=res.headers.get('content-type')||'';
  if(type.indexOf('application/json')<0)return res;
  var data=await res.json().catch(function(){return{};});
  if(!res.ok||data.ok===false)throw new Error(data.error||('Card intake request failed '+res.status));
  return data;
}
function panel(){return document.getElementById('card-intake-panels');}
function busy(message){var host=panel();if(host)host.innerHTML='<div class="panel" style="padding:36px;text-align:center;font-family:var(--font-mono);color:var(--dim)">'+esc(message||'Loading…')+'</div>';}
function money(cents){return '$'+(Number(cents||0)/100).toFixed(2);}

function ensureCardIntakePanel(){
  if(!panel())return;
  renderCardIntakeHome();
}

// ── HOME ──────────────────────────────────────────────────────────────────
function renderCardIntakeHome(){
  var host=panel();if(!host)return;
  host.innerHTML=
    '<div style="max-width:720px;margin:0 auto;padding:0 20px 60px">'+
    '<div style="font-family:var(--font-mono);font-size:10px;color:var(--dim);margin-bottom:16px">Capture cards from any source -- phone camera, bulk upload, or an auto-feed scanner -- into one processing queue. Identification and pricing run in the background while you keep capturing.</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'+
      '<button class="hbtn" style="padding:22px 10px;font-size:13px;color:var(--g)" onclick="startCardIntakeBatch(\'PHONE_CAMERA\')">📷 RAPID CAMERA</button>'+
      '<button class="hbtn" style="padding:22px 10px;font-size:13px" onclick="startCardIntakeBatch(\'BULK_UPLOAD\')">🗂 BULK UPLOAD</button>'+
      '<button class="hbtn" style="padding:22px 10px;font-size:13px" onclick="renderScannerSetup()">🖨 SCANNER</button>'+
      '<button class="hbtn" style="padding:22px 10px;font-size:13px;color:var(--gold)" onclick="renderCollectionsHome()">💰 COLLECTION BUY</button>'+
    '</div>'+
    '<div id="ci-recent-batches" style="margin-top:22px"></div>'+
    '</div>';
  loadRecentBatches();
}

async function loadRecentBatches(){
  var host=document.getElementById('ci-recent-batches');if(!host)return;
  try{
    var data=await api('/card-intake/batches?store_id='+encodeURIComponent(getActiveStoreId()));
    var batches=(data.batches||[]).filter(function(b){return b.status!=='archived';}).slice(0,10);
    if(!batches.length){host.innerHTML='';return;}
    host.innerHTML='<div class="sec" style="font-size:10px;margin-bottom:8px">RECENT BATCHES</div>'+
      batches.map(function(b){
        var c=b.itemCounts||{total:0};
        var needsReview=(c.needs_review||0)+(c.needs_back||0)+(c.failed||0);
        return '<div class="panel" style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;margin-bottom:6px;cursor:pointer" onclick="resumeCardIntakeBatch(\''+b.id+'\')">'+
          '<div><b>'+esc(b.label||b.source)+'</b><div style="font-family:var(--font-mono);font-size:9px;color:var(--dim)">'+esc(b.source)+' · '+esc(b.status)+' · '+(c.total||0)+' cards'+(needsReview?' · '+needsReview+' need review':'')+'</div></div>'+
          '<button class="hbtn" style="min-height:32px;font-size:9px" onclick="event.stopPropagation();openCardIntakeVerification({batchId:\''+b.id+'\'})">REVIEW</button>'+
        '</div>';
      }).join('');
  }catch(e){/* best effort */}
}

async function resumeCardIntakeBatch(batchId){
  try{
    var data=await api('/card-intake/batches?store_id='+encodeURIComponent(getActiveStoreId())+'&id='+encodeURIComponent(batchId));
    state.batch=data.batch;state.items=data.items||[];
    renderScanLab();
  }catch(e){toast_dash('Could not open batch: '+e.message);}
}

// ── BATCH LIFECYCLE ──────────────────────────────────────────────────────
async function startCardIntakeBatch(source,collectionBuyId){
  try{
    var data=await api('/card-intake/batches',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),source:source,collectionBuyId:collectionBuyId||undefined,label:(collectionBuyId?'Collection intake':source.replace('_',' '))+' '+new Date().toLocaleString()})});
    state.batch=data.batch;state.items=[];
    if(source==='PHONE_CAMERA'||source==='DESKTOP_CAMERA')renderRapidCamera();
    else if(source==='BULK_UPLOAD')renderBulkUpload();
    else renderScanLab();
  }catch(e){toast_dash('Could not start batch: '+e.message);}
}

async function finishCardIntakeBatch(){
  if(!state.batch)return;
  stopCardIntakeCamera();
  try{await api('/card-intake/batches',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),batchId:state.batch.id,status:'finished'})});}catch(e){}
  toast_dash((state.items.length)+' card'+(state.items.length===1?'':'s')+' captured. Processing continues in the background -- open REVIEW when ready.');
  renderScanLab();
}

// ── SCAN LAB (thumbnail queue view, shared by every source) ─────────────
function renderScanLab(){
  var host=panel();if(!host)return;
  var b=state.batch;
  host.innerHTML=
    '<div style="max-width:900px;margin:0 auto;padding:0 20px 60px">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'+
      '<div><b>'+esc(b?b.label||b.source:'Batch')+'</b><div style="font-family:var(--font-mono);font-size:9px;color:var(--dim)">'+state.items.length+' captured · <span id="ci-queue-status">idle</span></div></div>'+
      '<div style="display:flex;gap:8px">'+
        '<button class="hbtn" onclick="renderCardIntakeHome()">← HOME</button>'+
        '<button class="hbtn" style="color:var(--g)" onclick="openCardIntakeVerification({batchId:\''+(b?b.id:'')+'\'})">REVIEW QUEUE</button>'+
      '</div>'+
    '</div>'+
    '<div id="ci-thumb-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px"></div>'+
    '</div>';
  renderThumbGrid();
}
function statusColor(s){return s==='approved'?'var(--g)':s==='rejected'||s==='failed'?'var(--red)':s==='needs_review'||s==='needs_back'?'var(--gold)':'var(--dim)';}
function renderThumbGrid(){
  var host=document.getElementById('ci-thumb-grid');if(!host)return;
  host.innerHTML=state.items.map(function(it){
    return '<div style="position:relative;border:1px solid var(--border);border-radius:6px;overflow:hidden;aspect-ratio:3/4;background:var(--surf)" id="ci-thumb-'+it.id+'">'+
      (it.thumbnail_url||it.front_image_url?'<img src="'+esc(it.thumbnail_url||it.front_image_url)+'" style="width:100%;height:100%;object-fit:cover">':'')+
      '<div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.75);color:'+statusColor(it.status)+';font-family:var(--font-mono);font-size:8px;padding:2px 4px;text-align:center">'+esc(it.status)+'</div>'+
    '</div>';
  }).join('');
}
function updateThumbStatus(itemId,status){
  var el=document.getElementById('ci-thumb-'+itemId);
  if(el){var badge=el.querySelector('div');if(badge){badge.textContent=status;badge.style.color=statusColor(status);}}
}

// ── RAPID CAMERA ──────────────────────────────────────────────────────────
function renderRapidCamera(){
  var host=panel();if(!host)return;
  host.innerHTML=
    '<div style="max-width:520px;margin:0 auto;padding:0 20px 60px;text-align:center">'+
    '<div style="position:relative;background:#000;border-radius:10px;overflow:hidden;aspect-ratio:3/4;max-height:70vh;margin:0 auto">'+
      '<video id="ci-cam-video" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover"></video>'+
      '<div id="ci-cam-placeholder" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--dim);font-family:var(--font-mono);font-size:11px">Starting camera…</div>'+
      '<div style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,.7);color:var(--g);font-family:var(--font-mono);font-size:11px;padding:4px 8px;border-radius:6px">'+state.items.length+' captured</div>'+
    '</div>'+
    '<div style="font-family:var(--font-mono);font-size:9px;color:var(--dim);margin:8px 0">Do not wait -- shoot the next card immediately. Identification happens in the background.</div>'+
    '<div style="display:flex;gap:8px;margin-top:6px">'+
      '<button class="hbtn" onclick="renderCardIntakeHome()">← CANCEL</button>'+
      '<button id="ci-capture-btn" class="hbtn" style="flex:1;padding:20px;font-size:14px;color:var(--g)" onclick="captureCardIntakeCard()">📸 CAPTURE (SPACE)</button>'+
      '<button class="hbtn" style="color:var(--gold)" onclick="finishCardIntakeBatch()">FINISH BATCH</button>'+
    '</div>'+
    '</div>';
  startCardIntakeCamera();
  document.addEventListener('keydown',cardIntakeCameraKeyHandler);
}
function cardIntakeCameraKeyHandler(e){
  if(document.activeElement&&['INPUT','TEXTAREA'].includes(document.activeElement.tagName))return;
  if(e.code==='Space'&&document.getElementById('ci-capture-btn')){e.preventDefault();captureCardIntakeCard();}
}
async function startCardIntakeCamera(){
  var video=document.getElementById('ci-cam-video');
  if(!navigator.mediaDevices?.getUserMedia){toast_dash('Camera not supported in this browser.');return;}
  try{
    state.camera.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080},focusMode:{ideal:'continuous'}},audio:false});
    if(window.applyContinuousAutofocus)await applyContinuousAutofocus(state.camera.stream);
    video.srcObject=state.camera.stream;await video.play();
    var ph=document.getElementById('ci-cam-placeholder');if(ph)ph.style.display='none';
  }catch(e){toast_dash('Camera error: '+e.message);}
}
function stopCardIntakeCamera(){
  if(state.camera.stream){state.camera.stream.getTracks().forEach(function(t){t.stop();});state.camera.stream=null;}
  document.removeEventListener('keydown',cardIntakeCameraKeyHandler);
}
function grabCardIntakeFrame(){
  var video=document.getElementById('ci-cam-video');if(!video||video.readyState<2)return null;
  var canvas=document.createElement('canvas');
  var vw=video.videoWidth||1280,vh=video.videoHeight||1600;
  var max=1600;var scale=Math.min(1,max/Math.max(vw,vh));
  canvas.width=Math.round(vw*scale);canvas.height=Math.round(vh*scale);
  canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
  return canvas;
}
// The core of "don't make me wait": capture is fire-and-forget. Grab the
// frame, hand it to the background queue, and return control to the camera
// immediately -- upload/create-item/identify all happen without blocking
// the next tap.
function captureCardIntakeCard(){
  var canvas=grabCardIntakeFrame();if(!canvas)return;
  var flash=document.getElementById('ci-cam-video');
  if(flash){flash.style.filter='brightness(2)';setTimeout(function(){flash.style.filter='';},120);}
  canvas.toBlob(function(blob){
    if(!blob)return;
    var base64=canvas.toDataURL('image/jpeg',0.85).split(',')[1];
    captureAndQueueCard(blob,base64,state.batch.source);
  },'image/jpeg',0.85);
}
async function captureAndQueueCard(blob,base64,source){
  var sequence=state.items.length+1;
  var placeholder={id:'pending-'+Date.now()+'-'+sequence,status:'captured',sequence:sequence,thumbnail_url:'',front_image_url:''};
  state.items.push(placeholder);
  var counter=document.querySelector('#card-intake-panels div[style*="position:absolute;top:8px"]');
  if(counter)counter.textContent=state.items.length+' captured';
  try{
    var uploadRes=await storeWorkerFetch('/inventory/photo/upload',{method:'POST',headers:{'Content-Type':'image/jpeg'},body:blob});
    var uploadData=await uploadRes.json();
    if(!uploadData.ok)throw new Error(uploadData.error||'Upload failed');
    var data=await api('/card-intake/items',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),batchId:state.batch.id,source:source,sequence:sequence,frontImageUrl:uploadData.url})});
    var idx=state.items.indexOf(placeholder);
    if(idx>=0)state.items[idx]=data.item;
    enqueueCardIntakeProcessing(data.item,base64);
  }catch(e){
    var idx2=state.items.indexOf(placeholder);
    if(idx2>=0)state.items[idx2].status='failed';
    toast_dash('Capture failed to save: '+e.message);
  }
}

// ── BULK UPLOAD ───────────────────────────────────────────────────────────
function renderBulkUpload(){
  var host=panel();if(!host)return;
  host.innerHTML=
    '<div style="max-width:560px;margin:0 auto;padding:0 20px 60px;text-align:center">'+
    '<div id="ci-bulk-drop" style="border:2px dashed var(--border);border-radius:10px;padding:40px 20px;cursor:pointer" onclick="document.getElementById(\'ci-bulk-input\').click()">'+
      '<div style="font-size:13px;margin-bottom:6px">Drop images here, or tap to choose 20, 100, even 500 at once</div>'+
      '<div style="font-family:var(--font-mono);font-size:9px;color:var(--dim)">Every image becomes its own card in this batch. Processing happens in the background.</div>'+
      '<input id="ci-bulk-input" type="file" accept="image/*" multiple style="display:none" onchange="handleCardIntakeBulkFiles(this.files)">'+
    '</div>'+
    '<div id="ci-bulk-progress" style="font-family:var(--font-mono);font-size:10px;color:var(--dim);margin-top:10px"></div>'+
    '<div style="display:flex;gap:8px;margin-top:12px">'+
      '<button class="hbtn" onclick="renderCardIntakeHome()">← HOME</button>'+
      '<button class="hbtn" style="flex:1;color:var(--gold)" onclick="finishCardIntakeBatch()">FINISH BATCH</button>'+
    '</div>'+
    '</div>';
  var drop=document.getElementById('ci-bulk-drop');
  drop.addEventListener('dragover',function(e){e.preventDefault();drop.style.borderColor='var(--g)';});
  drop.addEventListener('dragleave',function(){drop.style.borderColor='var(--border)';});
  drop.addEventListener('drop',function(e){e.preventDefault();drop.style.borderColor='var(--border)';if(e.dataTransfer?.files?.length)handleCardIntakeBulkFiles(e.dataTransfer.files);});
}
function resizeImageFile(file){
  return new Promise(function(resolve,reject){
    var reader=new FileReader();
    reader.onload=function(){
      var img=new Image();
      img.onload=function(){
        var max=1600;var scale=Math.min(1,max/Math.max(img.width,img.height));
        var canvas=document.createElement('canvas');
        canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);
        canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
        canvas.toBlob(function(blob){
          if(!blob){reject(new Error('Could not process image'));return;}
          resolve({blob:blob,base64:canvas.toDataURL('image/jpeg',0.85).split(',')[1]});
        },'image/jpeg',0.85);
      };
      img.onerror=function(){reject(new Error('Could not read image'));};
      img.src=reader.result;
    };
    reader.onerror=function(){reject(new Error('Could not read file'));};
    reader.readAsDataURL(file);
  });
}
async function handleCardIntakeBulkFiles(fileList){
  if(!state.batch){toast_dash('Start a batch first.');return;}
  var files=Array.from(fileList||[]).filter(function(f){return f.type.startsWith('image/');});
  if(!files.length)return;
  var progressEl=document.getElementById('ci-bulk-progress');
  var done=0,startSequence=state.items.length;
  function bump(){done++;if(progressEl)progressEl.textContent=done+' / '+files.length+' uploaded';}
  var CONCURRENCY=4,i=0;
  async function worker(){
    while(i<files.length){
      var myIndex=i++;var file=files[myIndex];
      try{
        var resized=await resizeImageFile(file);
        var uploadRes=await storeWorkerFetch('/inventory/photo/upload',{method:'POST',headers:{'Content-Type':'image/jpeg'},body:resized.blob});
        var uploadData=await uploadRes.json();
        if(!uploadData.ok)throw new Error(uploadData.error||'Upload failed');
        var data=await api('/card-intake/items',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),batchId:state.batch.id,source:'BULK_UPLOAD',sequence:startSequence+myIndex+1,frontImageUrl:uploadData.url})});
        state.items.push(data.item);
        enqueueCardIntakeProcessing(data.item,resized.base64);
      }catch(e){
        console.error('Bulk upload failed for',file.name,e);
      }
      bump();
    }
  }
  await Promise.all(Array.from({length:Math.min(CONCURRENCY,files.length)},worker));
  toast_dash(done+' image'+(done===1?'':'s')+' queued for processing.');
}

// ── SCANNER (watched-folder agent) ───────────────────────────────────────
function renderScannerSetup(){
  var host=panel();if(!host)return;
  host.innerHTML=
    '<div style="max-width:560px;margin:0 auto;padding:0 20px 60px">'+
    '<div class="foc-import-report">A local watched-folder agent uploads whatever your scanner software drops into a folder -- one image per card -- straight into this same intake queue. No specific scanner brand is required; anything that saves JPG/PNG files to a folder works.</div>'+
    '<button class="hbtn" style="margin-top:12px;width:100%" onclick="createScannerWorkstation()">CREATE SCANNER STATION TOKEN</button>'+
    '<div id="ci-scanner-token" style="margin-top:12px"></div>'+
    '<button class="hbtn" style="margin-top:16px" onclick="renderCardIntakeHome()">← HOME</button>'+
    '</div>';
}
async function createScannerWorkstation(){
  var name=prompt('Name this scanner station (e.g. "Back office fi-8170"):','Scanner station');
  if(!name)return;
  try{
    var data=await api('/card-intake/scanner-workstations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),name:name})});
    var el=document.getElementById('ci-scanner-token');
    var uploadUrl=WORKER+'/card-intake/scanner-upload';
    el.innerHTML='<div class="foc-import-report" style="color:var(--gold)">Token shown once -- save it now, it is not stored in the clear:<br><code style="word-break:break-all">'+esc(data.token)+'</code></div>'+
      '<div style="font-family:var(--font-mono);font-size:9px;color:var(--dim);margin-top:8px">Point the watched-folder agent at:<br><code>'+esc(uploadUrl)+'</code><br>with header <code>X-Scanner-Token: '+esc(data.token)+'</code>, POSTing each new image file as the raw request body.</div>';
  }catch(e){toast_dash('Could not create scanner station: '+e.message);}
}

// ── BACKGROUND PROCESSING QUEUE ──────────────────────────────────────────
function enqueueCardIntakeProcessing(item,base64){
  state.queue.push({item:item,base64:base64});
  pumpCardIntakeQueue();
}
function updateQueueStatusLabel(){
  var el=document.getElementById('ci-queue-status');
  if(!el)return;
  var remaining=state.queue.length+state.active;
  el.textContent=remaining?('processing '+remaining+' card'+(remaining===1?'':'s')+'…'):'idle';
}
function pumpCardIntakeQueue(){
  while(state.active<state.concurrency&&state.queue.length){
    var entry=state.queue.shift();
    state.active++;
    updateQueueStatusLabel();
    processCardIntakeItem(entry).finally(function(){
      state.active--;updateQueueStatusLabel();pumpCardIntakeQueue();
    });
  }
}
// Category strings mirror resolveOwnCardIdentifyCard's own mapping exactly
// so a resolved catalog match's category matches what the rest of this app
// (CATEGORY_ALIASES/qplCategoryKey) already expects.
function ciCategoryForGame(game){
  return game==='pokemon'?'Pokemon TCG':game==='mtg'?'Magic: The Gathering':game==='sports'?'Sports Card':'One Piece TCG';
}
// Resolves one extracted card against the real catalog, same search+rank
// pipeline resolveOwnCardIdentifyCard already uses, but keeps the top N
// ranked candidates instead of collapsing to just the best one -- the
// review queue needs 1-5 alternatives, not only a single best guess.
async function resolveCardIntakeCandidates(card,limit){
  var category=ciCategoryForGame(card.game);
  var q=ownCardIdentifyQuery(card);
  if(!q)return [];
  var plan=buildUniversalSearchPlan(q,category);
  var rows=[];
  if(card.game==='mtg'){try{rows=await searchMtgOfflineCache(q,category)||[];}catch(e){rows=[];}}
  if(!rows.length){try{rows=await searchQuickCatalog(q,category,plan)||[];}catch(e){rows=[];}}
  if(!rows.length)return [];
  var ranked=universalSearchAdapter()?.mergeAndRankResults(rows,plan)||rows;
  return ranked.slice(0,limit||5).map(function(row){
    return Object.assign({},row,{source:'own-ai',note:ownCardIdentifyNote(card)});
  });
}
function confidenceFromLabel(label){return label==='high'?0.92:label==='medium'?0.65:0.35;}
async function processCardIntakeItem(entry){
  var item=entry.item,base64=entry.base64;
  updateThumbStatus(item.id,'processing');
  try{
    await api('/card-intake/items',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),itemId:item.id,status:'processing'})});
    var cards=await callOwnCardIdentify(base64);
    if(!cards.length){
      await api('/card-intake/items',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),itemId:item.id,status:'needs_review',error:'No card detected in this photo'})});
      updateThumbStatus(item.id,'needs_review');
      return;
    }
    var card=cards[0];
    var candidates=await resolveCardIntakeCandidates(card,5);
    var best=candidates[0]||null;
    var cardIdConfidence=confidenceFromLabel(card.confidence)*(best?1:0.5);
    // Variant/parallel confidence is a separate, generally lower-trust
    // number: high only when the model actually read a finish/parallel AND
    // the top catalog match's own note reflects it; otherwise the card's
    // identity can be very sure while its exact parallel is still a guess.
    var hasVariantSignal=!!(card.finish||card.specialMarkings);
    var variantConfidence=!best?0:(hasVariantSignal?0.78:0.5);
    var needsBack=!best||cardIdConfidence<0.5||(!card.number&&candidates.length>1);
    var marketCents=best?Math.round(Number(best.market||0)*100):0;
    await api('/card-intake/items',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      storeId:getActiveStoreId(),itemId:item.id,
      status:needsBack?'needs_back':'needs_review',
      category:ciCategoryForGame(card.game),
      bestMatch:best,candidates:candidates,
      cardIdConfidence:cardIdConfidence,variantConfidence:variantConfidence,
      marketCents:marketCents,
    })});
    await api('/card-intake/attempts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      storeId:getActiveStoreId(),itemId:item.id,provider:'own-ai',
      request:{query:ownCardIdentifyQuery(card)},response:{cardsFound:cards.length,candidatesFound:candidates.length},
      cardIdConfidence:cardIdConfidence,variantConfidence:variantConfidence,
    })});
    updateThumbStatus(item.id,needsBack?'needs_back':'needs_review');
  }catch(e){
    try{await api('/card-intake/items',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),itemId:item.id,status:'failed',error:String(e.message||e).slice(0,400)})});}catch(_){}
    updateThumbStatus(item.id,'failed');
  }
}

// ── VERIFICATION QUEUE ────────────────────────────────────────────────────
async function openCardIntakeVerification(filter){
  busy('Loading review queue…');
  var qp='store_id='+encodeURIComponent(getActiveStoreId())+'&status=needs_review,needs_back,failed';
  if(filter?.batchId)qp+='&batch_id='+encodeURIComponent(filter.batchId);
  if(filter?.collectionBuyId)qp+='&collection_buy_id='+encodeURIComponent(filter.collectionBuyId);
  try{
    var data=await api('/card-intake/items?'+qp);
    state.verify={list:data.items||[],index:0,showBack:false,editing:false,filter:filter||null};
    renderVerifyCard();
    document.addEventListener('keydown',cardIntakeVerifyKeyHandler);
  }catch(e){toast_dash('Could not load review queue: '+e.message);}
}
function closeCardIntakeVerification(){
  document.removeEventListener('keydown',cardIntakeVerifyKeyHandler);
  if(state.verify.filter?.collectionBuyId)renderCollectionDashboard(state.verify.filter.collectionBuyId);
  else renderCardIntakeHome();
}
function currentVerifyItem(){return state.verify.list[state.verify.index];}
function candidateRow(c,i,active){
  if(!c)return '';
  return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border:1px solid '+(active?'var(--g)':'var(--border)')+';border-radius:6px;margin-bottom:4px;cursor:pointer" onclick="cardIntakeChooseCandidate('+i+')">'+
    '<div><b>['+(i+1)+']</b> '+esc(c.name||'')+'</div><div style="font-family:var(--font-mono);font-size:10px;color:var(--dim)">'+(c.market?money(c.market*100):'')+'</div>'+
  '</div>';
}
function renderVerifyCard(){
  var host=panel();if(!host)return;
  var v=state.verify,item=currentVerifyItem();
  if(!item){
    host.innerHTML='<div style="max-width:520px;margin:60px auto;text-align:center"><div style="font-size:15px;margin-bottom:10px">✓ ALL CAUGHT UP</div><button class="hbtn" onclick="closeCardIntakeVerification()">DONE</button> <button class="hbtn" onclick="openCardIntakeVerification(state_verify_filter())">RECHECK QUEUE</button></div>';
    return;
  }
  var best=item.best_match||{};
  var img=v.showBack?item.back_image_url:item.front_image_url;
  var idPct=item.card_id_confidence!=null?Math.round(item.card_id_confidence*100):null;
  var varPct=item.variant_confidence!=null?Math.round(item.variant_confidence*100):null;
  var candidates=item.candidates||[];
  host.innerHTML=
    '<div style="max-width:640px;margin:0 auto;padding:0 16px 60px">'+
    (item.high_value?'<div style="background:var(--gold);color:#000;padding:8px 12px;border-radius:6px;font-weight:bold;margin-bottom:10px;text-align:center">⚠ POSSIBLE $250+ CARD -- verify carefully before approving</div>':'')+
    (item.error?'<div style="background:var(--red);color:#fff;padding:6px 10px;border-radius:6px;margin-bottom:10px;font-family:var(--font-mono);font-size:10px">'+esc(item.error)+'</div>':'')+
    '<div style="display:flex;justify-content:space-between;align-items:center;font-family:var(--font-mono);font-size:9px;color:var(--dim);margin-bottom:6px"><span>'+(v.index+1)+' / '+v.list.length+'</span><span>ENTER=approve · SPACE=flip · E=edit · W=wrong · S=skip · 1-5=pick match</span></div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">'+
      '<div>'+
        (img?'<img src="'+esc(img)+'" style="width:100%;border-radius:8px;border:1px solid var(--border)">':'<div style="aspect-ratio:3/4;background:var(--surf);border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--dim);font-size:11px">No '+(v.showBack?'back':'front')+' image</div>')+
        '<div style="display:flex;gap:6px;margin-top:6px">'+
          '<button class="hbtn" style="flex:1" onclick="cardIntakeToggleBack()">'+(v.showBack?'FRONT':'BACK')+' (SPACE)</button>'+
        '</div>'+
        (item.status==='needs_back'&&!item.back_image_url?'<div id="ci-back-upload" style="margin-top:8px"><input type="file" accept="image/*" capture="environment" onchange="handleCardIntakeBackPhoto(this.files[0])"><div style="font-family:var(--font-mono);font-size:9px;color:var(--gold);margin-top:4px">BACK IMAGE NEEDED -- confidence too low or number unreadable from the front</div></div>':'')+
      '</div>'+
      '<div>'+
        '<div style="font-family:var(--font-mono);font-size:9px;color:var(--dim)">CARD ID <b style="color:'+(idPct>=70?'var(--g)':'var(--gold)')+'">'+(idPct!=null?idPct+'%':'—')+'</b> · VARIANT <b style="color:'+(varPct>=70?'var(--g)':'var(--gold)')+'">'+(varPct!=null?varPct+'%':'—')+'</b></div>'+
        '<div style="font-size:14px;margin:6px 0"><b>'+esc(best.name||'Unidentified')+'</b></div>'+
        '<div style="font-family:var(--font-mono);font-size:10px;color:var(--dim);margin-bottom:8px">'+esc([best.set,best.year,best.number].filter(Boolean).join(' · '))+'</div>'+
        '<div id="ci-verify-fields">'+
          '<label style="display:block;font-size:9px;color:var(--dim)">Condition<br><select class="tsi" id="ci-f-condition" style="width:100%">'+['NM','LP','MP','HP','DMG'].map(function(c){return '<option '+(item.condition===c?'selected':'')+'>'+c+'</option>';}).join('')+'</select></label>'+
          '<label style="display:block;font-size:9px;color:var(--dim);margin-top:6px">Cost<br><input class="tsi" id="ci-f-cost" type="number" step="0.01" style="width:100%" value="'+(item.cost_cents!=null?(item.cost_cents/100).toFixed(2):(Math.round((best.market||0)*50)/100).toFixed(2))+'"></label>'+
          '<label style="display:block;font-size:9px;color:var(--dim);margin-top:6px">Market price<br><input class="tsi" id="ci-f-market" type="number" step="0.01" style="width:100%" value="'+(item.market_cents!=null?(item.market_cents/100).toFixed(2):(best.market||0).toFixed(2))+'"></label>'+
        '</div>'+
        '<div style="margin-top:10px;font-family:var(--font-mono);font-size:9px;color:var(--dim)">OTHER MATCHES</div>'+
        candidates.map(function(c,i){return candidateRow(c,i,c===best);}).join('')+
      '</div>'+
    '</div>'+
    '<div style="display:flex;gap:8px;margin-top:14px">'+
      '<button class="hbtn" onclick="closeCardIntakeVerification()">← EXIT</button>'+
      '<button class="hbtn" style="color:var(--red)" onclick="cardIntakeWrong()">WRONG (W)</button>'+
      '<button class="hbtn" onclick="cardIntakeSkip()">SKIP (S)</button>'+
      '<button class="hbtn" style="flex:1;color:var(--g);font-size:13px" onclick="cardIntakeApprove()">APPROVE + NEXT (ENTER)</button>'+
    '</div>'+
    '</div>';
}
function state_verify_filter(){return state.verify.filter;}
function cardIntakeToggleBack(){state.verify.showBack=!state.verify.showBack;renderVerifyCard();}
async function handleCardIntakeBackPhoto(file){
  if(!file)return;
  var item=currentVerifyItem();if(!item)return;
  try{
    var resized=await resizeImageFile(file);
    var uploadRes=await storeWorkerFetch('/inventory/photo/upload',{method:'POST',headers:{'Content-Type':'image/jpeg'},body:resized.blob});
    var uploadData=await uploadRes.json();
    if(!uploadData.ok)throw new Error(uploadData.error||'Upload failed');
    var data=await api('/card-intake/items',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),itemId:item.id,backImageUrl:uploadData.url,status:'needs_review'})});
    state.verify.list[state.verify.index]=data.item;state.verify.showBack=true;
    renderVerifyCard();
  }catch(e){toast_dash('Back photo failed: '+e.message);}
}
function collectVerifyFinalFields(){
  var item=currentVerifyItem();var best=item.best_match||{};
  var condition=document.getElementById('ci-f-condition')?.value;
  var costEl=document.getElementById('ci-f-cost'),marketEl=document.getElementById('ci-f-market');
  return {
    name:best.name,set:best.set,number:best.number,year:best.year,category:item.category,
    condition:condition,costCents:costEl?Math.round(Number(costEl.value||0)*100):undefined,
    marketCents:marketEl?Math.round(Number(marketEl.value||0)*100):undefined,
  };
}
async function submitCardIntakeReview(action,extra){
  var item=currentVerifyItem();if(!item)return;
  try{
    var body=Object.assign({storeId:getActiveStoreId(),itemId:item.id,action:action},extra||{});
    await api('/card-intake/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  }catch(e){toast_dash('Review action failed: '+e.message);return;}
  state.verify.list.splice(state.verify.index,1);
  if(state.verify.index>=state.verify.list.length)state.verify.index=Math.max(0,state.verify.list.length-1);
  state.verify.showBack=false;
  renderVerifyCard();
}
function cardIntakeApprove(){
  var fields=collectVerifyFinalFields();
  var costEl=document.getElementById('ci-f-cost'),marketEl=document.getElementById('ci-f-market');
  submitCardIntakeReview('approve',{finalFields:fields});
}
function cardIntakeWrong(){submitCardIntakeReview('wrong');}
function cardIntakeSkip(){
  var item=currentVerifyItem();if(!item)return;
  // Skip just moves it to the back of this session's local queue -- server
  // state is untouched, it comes back around without being marked wrong.
  var skipped=state.verify.list.splice(state.verify.index,1)[0];
  state.verify.list.push(skipped);
  if(state.verify.index>=state.verify.list.length)state.verify.index=0;
  renderVerifyCard();
}
function cardIntakeChooseCandidate(i){
  var item=currentVerifyItem();if(!item||!item.candidates)return;
  var chosen=item.candidates[i];if(!chosen)return;
  item.best_match=chosen;
  renderVerifyCard();
}
function cardIntakeVerifyKeyHandler(e){
  if(document.activeElement&&['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))return;
  if(e.key==='Enter'){e.preventDefault();cardIntakeApprove();}
  else if(e.code==='Space'){e.preventDefault();cardIntakeToggleBack();}
  else if(e.key==='w'||e.key==='W')cardIntakeWrong();
  else if(e.key==='s'||e.key==='S')cardIntakeSkip();
  else if(/^[1-5]$/.test(e.key))cardIntakeChooseCandidate(Number(e.key)-1);
}

// ── COLLECTION BUY ────────────────────────────────────────────────────────
function renderCollectionsHome(){
  var host=panel();if(!host)return;
  host.innerHTML=
    '<div style="max-width:720px;margin:0 auto;padding:0 20px 60px">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">'+
      '<button class="hbtn" onclick="renderCardIntakeHome()">← HOME</button>'+
      '<div style="display:flex;gap:8px">'+
        '<button class="hbtn" onclick="renderAcquisitionRulesEditor()">⚙ ACQUISITION RULES</button>'+
        '<button class="hbtn" style="color:var(--g)" onclick="openNewCollectionBuyModal()">+ NEW COLLECTION BUY</button>'+
      '</div>'+
    '</div>'+
    '<div id="ci-collections-list"></div>'+
    '</div>';
  loadCollectionsList();
}

// ── ACQUISITION RULES (configurable tiers, per category) ────────────────
var ACQ_CATEGORIES=['default','Sports Card','Pokemon TCG','Magic: The Gathering','Comic'];
async function renderAcquisitionRulesEditor(){
  busy('Loading acquisition rules…');
  try{
    var data=await api('/card-intake/acquisition-rules?store_id='+encodeURIComponent(getActiveStoreId()));
    var byCategory={};
    (data.rules||[]).forEach(function(r){byCategory[r.category]=r.tiers;});
    var host=panel();
    host.innerHTML='<div style="max-width:640px;margin:0 auto;padding:0 20px 60px">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><button class="hbtn" onclick="renderCollectionsHome()">← COLLECTIONS</button></div>'+
      '<div class="sec" style="margin-bottom:8px">ACQUISITION RULES</div>'+
      '<div style="font-family:var(--font-mono);font-size:9px;color:var(--dim);margin-bottom:10px">What percentage of market value to suggest paying, by price tier. A category with no rule of its own falls back to "default".</div>'+
      '<label style="display:block;font-size:9px;color:var(--dim);margin-bottom:6px">Category<br><select class="tsi" id="ci-acq-category" onchange="renderAcquisitionRuleTiers()">'+ACQ_CATEGORIES.map(function(c){return '<option value="'+esc(c)+'">'+esc(c)+'</option>';}).join('')+'</select></label>'+
      '<div id="ci-acq-tiers"></div>'+
      '<button class="hbtn" style="margin-top:8px" onclick="addAcquisitionTierRow()">+ ADD TIER</button>'+
      '<button class="hbtn" style="margin-top:8px;color:var(--g);width:100%" onclick="saveAcquisitionRules()">SAVE</button>'+
      '</div>';
    state.acqRules=byCategory;
    renderAcquisitionRuleTiers();
  }catch(e){toast_dash('Could not load acquisition rules: '+e.message);}
}
function renderAcquisitionRuleTiers(){
  var category=document.getElementById('ci-acq-category')?.value||'default';
  var tiers=(state.acqRules&&state.acqRules[category])||[{minCents:0,maxCents:100,pct:20},{minCents:100,maxCents:500,pct:30},{minCents:500,maxCents:2000,pct:50},{minCents:2000,maxCents:10000,pct:65},{minCents:10000,maxCents:null,pct:70}];
  var host=document.getElementById('ci-acq-tiers');if(!host)return;
  host.innerHTML=tiers.map(function(t,i){
    return '<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px" data-tier-row>'+
      '<input class="tsi" type="number" step="0.01" style="width:90px" placeholder="min $" value="'+(t.minCents!=null?(t.minCents/100):'')+'" data-tier-min>'+
      '<span style="font-family:var(--font-mono);font-size:9px">to</span>'+
      '<input class="tsi" type="number" step="0.01" style="width:90px" placeholder="max $ (blank = ∞)" value="'+(t.maxCents!=null?(t.maxCents/100):'')+'" data-tier-max>'+
      '<span style="font-family:var(--font-mono);font-size:9px">→</span>'+
      '<input class="tsi" type="number" style="width:70px" value="'+(t.pct!=null?t.pct:0)+'" data-tier-pct>'+
      '<span style="font-family:var(--font-mono);font-size:9px">%</span>'+
      '<button class="hbtn" style="min-height:32px;padding:4px 8px" onclick="this.closest(\'[data-tier-row]\').remove()">✕</button>'+
    '</div>';
  }).join('');
}
function addAcquisitionTierRow(){
  var host=document.getElementById('ci-acq-tiers');if(!host)return;
  var row=document.createElement('div');
  row.style.cssText='display:flex;gap:6px;align-items:center;margin-bottom:4px';
  row.setAttribute('data-tier-row','');
  row.innerHTML='<input class="tsi" type="number" step="0.01" style="width:90px" placeholder="min $" data-tier-min>'+
    '<span style="font-family:var(--font-mono);font-size:9px">to</span>'+
    '<input class="tsi" type="number" step="0.01" style="width:90px" placeholder="max $ (blank = ∞)" data-tier-max>'+
    '<span style="font-family:var(--font-mono);font-size:9px">→</span>'+
    '<input class="tsi" type="number" style="width:70px" value="50" data-tier-pct>'+
    '<span style="font-family:var(--font-mono);font-size:9px">%</span>'+
    '<button class="hbtn" style="min-height:32px;padding:4px 8px" onclick="this.closest(\'[data-tier-row]\').remove()">✕</button>';
  host.appendChild(row);
}
async function saveAcquisitionRules(){
  var category=document.getElementById('ci-acq-category')?.value||'default';
  var tiers=Array.from(document.querySelectorAll('[data-tier-row]')).map(function(row){
    var minVal=row.querySelector('[data-tier-min]').value;
    var maxVal=row.querySelector('[data-tier-max]').value;
    return {minCents:minVal?Math.round(Number(minVal)*100):0,maxCents:maxVal?Math.round(Number(maxVal)*100):null,pct:Number(row.querySelector('[data-tier-pct]').value||0)};
  });
  try{
    await api('/card-intake/acquisition-rules',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),category:category,tiers:tiers})});
    state.acqRules=state.acqRules||{};state.acqRules[category]=tiers;
    toast_dash('Acquisition rules saved for '+category+'.');
  }catch(e){toast_dash('Could not save: '+e.message);}
}
async function loadCollectionsList(){
  var host=document.getElementById('ci-collections-list');if(!host)return;
  try{
    var data=await api('/collections?store_id='+encodeURIComponent(getActiveStoreId()));
    state.collections=data.collections||[];
    if(!state.collections.length){host.innerHTML='<div style="font-family:var(--font-mono);font-size:11px;color:var(--dim);text-align:center;padding:30px">No collection buys yet.</div>';return;}
    host.innerHTML=state.collections.map(function(c){
      return '<div class="panel" style="display:flex;justify-content:space-between;align-items:center;padding:12px;margin-bottom:8px;cursor:pointer" onclick="renderCollectionDashboard(\''+c.id+'\')">'+
        '<div><b>'+esc(c.name||c.seller||'Collection')+'</b><div style="font-family:var(--font-mono);font-size:9px;color:var(--dim)">'+esc(c.status)+(c.asking_price_cents?' · asking '+money(c.asking_price_cents):'')+'</div></div>'+
        '<span style="font-family:var(--font-mono);font-size:9px;color:var(--dim)">→</span>'+
      '</div>';
    }).join('');
  }catch(e){host.innerHTML='<div style="color:var(--red)">'+esc(e.message)+'</div>';}
}
function openNewCollectionBuyModal(){
  var modalOld=document.getElementById('ci-new-collection-modal');if(modalOld)modalOld.remove();
  var modal=document.createElement('div');
  modal.id='ci-new-collection-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML='<div class="modal">'+
    '<div class="sec" style="margin-bottom:10px">NEW COLLECTION BUY</div>'+
    '<label style="display:block;font-size:9px;color:var(--dim)">Seller<br><input class="tsi" id="ci-nc-seller" style="width:100%"></label>'+
    '<label style="display:block;font-size:9px;color:var(--dim);margin-top:6px">Name<br><input class="tsi" id="ci-nc-name" style="width:100%" placeholder="e.g. Johnson collection"></label>'+
    '<label style="display:block;font-size:9px;color:var(--dim);margin-top:6px">Category<br><input class="tsi" id="ci-nc-category" style="width:100%" placeholder="Sports Card, Pokemon TCG, MTG…"></label>'+
    '<label style="display:block;font-size:9px;color:var(--dim);margin-top:6px">Estimated card count<br><input class="tsi" id="ci-nc-count" type="number" style="width:100%"></label>'+
    '<label style="display:block;font-size:9px;color:var(--dim);margin-top:6px">Asking price<br><input class="tsi" id="ci-nc-asking" type="number" step="0.01" style="width:100%"></label>'+
    '<label style="display:block;font-size:9px;color:var(--dim);margin-top:6px">Notes<br><textarea class="tsi" id="ci-nc-notes" style="width:100%;min-height:60px"></textarea></label>'+
    '<div style="display:flex;gap:8px;margin-top:12px">'+
      '<button class="hbtn" onclick="document.getElementById(\'ci-new-collection-modal\').remove()">CANCEL</button>'+
      '<button class="hbtn" style="flex:1;color:var(--g)" onclick="submitNewCollectionBuy()">CREATE</button>'+
    '</div>'+
  '</div>';
  document.body.appendChild(modal);
}
async function submitNewCollectionBuy(){
  var body={
    storeId:getActiveStoreId(),
    seller:document.getElementById('ci-nc-seller')?.value,
    name:document.getElementById('ci-nc-name')?.value,
    category:document.getElementById('ci-nc-category')?.value,
    estimatedCardCount:Number(document.getElementById('ci-nc-count')?.value||0)||undefined,
    askingPriceCents:document.getElementById('ci-nc-asking')?.value?Math.round(Number(document.getElementById('ci-nc-asking').value)*100):undefined,
    notes:document.getElementById('ci-nc-notes')?.value,
  };
  try{
    var data=await api('/collections',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    document.getElementById('ci-new-collection-modal')?.remove();
    renderCollectionDashboard(data.collection.id);
  }catch(e){toast_dash('Could not create collection: '+e.message);}
}
async function renderCollectionDashboard(id){
  busy('Loading collection…');
  try{
    var data=await api('/collections?store_id='+encodeURIComponent(getActiveStoreId())+'&id='+encodeURIComponent(id));
    state.activeCollection=data.collection;
    var s=data.summary||{};
    var host=panel();
    host.innerHTML=
      '<div style="max-width:720px;margin:0 auto;padding:0 20px 60px">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'+
        '<button class="hbtn" onclick="renderCollectionsHome()">← COLLECTIONS</button>'+
        '<div style="display:flex;gap:8px">'+
          '<button class="hbtn" onclick="startCardIntakeBatch(\'PHONE_CAMERA\',\''+id+'\')">📷 CAMERA</button>'+
          '<button class="hbtn" onclick="startCardIntakeBatch(\'BULK_UPLOAD\',\''+id+'\')">🗂 UPLOAD</button>'+
        '</div>'+
      '</div>'+
      '<div class="sec">'+esc(data.collection.name||data.collection.seller||'COLLECTION')+'</div>'+
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:10px 0">'+
        statTile(s.totalCards,'CARDS')+statTile(s.identified,'IDENTIFIED')+statTile(s.needsReview,'NEED REVIEW')+
        statTile(money(s.estimatedRetailCents),'EST. RETAIL')+statTile(money(s.estimatedRealisticSaleCents),'REALISTIC SALE')+statTile(money(s.suggestedAcquisitionCents),'SUGGESTED BUY')+
      '</div>'+
      (s.highValue?'<div style="background:var(--gold);color:#000;padding:6px 10px;border-radius:6px;text-align:center;margin-bottom:10px">'+s.highValue+' high-value card'+(s.highValue===1?'':'s')+' flagged for extra review</div>':'')+
      (data.collection.asking_price_cents?'<div style="font-family:var(--font-mono);font-size:10px;color:var(--dim);text-align:center;margin-bottom:10px">Seller asking: '+money(data.collection.asking_price_cents)+'</div>':'')+
      '<div style="display:flex;gap:8px">'+
        '<button class="hbtn" style="flex:1;color:var(--g)" onclick="openCardIntakeVerification({collectionBuyId:\''+id+'\'})">REVIEW CARDS</button>'+
        (data.collection.status==='purchased'?'<button class="hbtn" disabled style="flex:1">PURCHASED</button>':'<button class="hbtn" style="flex:1;color:var(--gold)" onclick="openPurchaseCollectionModal(\''+id+'\')">PURCHASE COLLECTION</button>')+
      '</div>'+
      '</div>';
  }catch(e){toast_dash('Could not load collection: '+e.message);}
}
function statTile(value,label){
  return '<div class="panel" style="text-align:center;padding:10px"><div style="font-size:15px;font-weight:bold">'+esc(String(value==null?'—':value))+'</div><div style="font-family:var(--font-mono);font-size:8px;color:var(--dim)">'+label+'</div></div>';
}
function openPurchaseCollectionModal(id){
  var modalOld=document.getElementById('ci-purchase-modal');if(modalOld)modalOld.remove();
  var modal=document.createElement('div');
  modal.id='ci-purchase-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML='<div class="modal">'+
    '<div class="sec" style="margin-bottom:10px">PURCHASE COLLECTION</div>'+
    '<div style="font-family:var(--font-mono);font-size:10px;color:var(--dim);margin-bottom:10px">Only APPROVED cards transfer to inventory. Cost is allocated across them proportional to each card\'s own market value, never a flat split.</div>'+
    '<label style="display:block;font-size:9px;color:var(--dim)">Total price paid<br><input class="tsi" id="ci-purchase-total" type="number" step="0.01" style="width:100%"></label>'+
    '<div style="display:flex;gap:8px;margin-top:12px">'+
      '<button class="hbtn" onclick="document.getElementById(\'ci-purchase-modal\').remove()">CANCEL</button>'+
      '<button class="hbtn" style="flex:1;color:var(--gold)" onclick="submitPurchaseCollection(\''+id+'\')">CONFIRM PURCHASE</button>'+
    '</div>'+
  '</div>';
  document.body.appendChild(modal);
}
async function submitPurchaseCollection(id){
  var totalEl=document.getElementById('ci-purchase-total');
  var totalCostCents=Math.round(Number(totalEl?.value||0)*100);
  if(!totalCostCents){toast_dash('Enter a total price paid.');return;}
  try{
    var data=await api('/collections/purchase',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:getActiveStoreId(),collectionId:id,totalCostCents:totalCostCents})});
    document.getElementById('ci-purchase-modal')?.remove();
    toast_dash(data.purchased+' card'+(data.purchased===1?'':'s')+' moved into inventory.');
    renderCollectionDashboard(id);
  }catch(e){toast_dash('Purchase failed: '+e.message);}
}

window.ensureCardIntakePanel=ensureCardIntakePanel;
window.startCardIntakeBatch=startCardIntakeBatch;
window.finishCardIntakeBatch=finishCardIntakeBatch;
window.resumeCardIntakeBatch=resumeCardIntakeBatch;
window.renderCardIntakeHome=renderCardIntakeHome;
window.captureCardIntakeCard=captureCardIntakeCard;
window.handleCardIntakeBulkFiles=handleCardIntakeBulkFiles;
window.renderScannerSetup=renderScannerSetup;
window.createScannerWorkstation=createScannerWorkstation;
window.openCardIntakeVerification=openCardIntakeVerification;
window.closeCardIntakeVerification=closeCardIntakeVerification;
window.cardIntakeToggleBack=cardIntakeToggleBack;
window.handleCardIntakeBackPhoto=handleCardIntakeBackPhoto;
window.cardIntakeApprove=cardIntakeApprove;
window.cardIntakeWrong=cardIntakeWrong;
window.cardIntakeSkip=cardIntakeSkip;
window.cardIntakeChooseCandidate=cardIntakeChooseCandidate;
window.renderCollectionsHome=renderCollectionsHome;
window.openNewCollectionBuyModal=openNewCollectionBuyModal;
window.submitNewCollectionBuy=submitNewCollectionBuy;
window.renderCollectionDashboard=renderCollectionDashboard;
window.openPurchaseCollectionModal=openPurchaseCollectionModal;
window.submitPurchaseCollection=submitPurchaseCollection;
window.renderAcquisitionRulesEditor=renderAcquisitionRulesEditor;
window.renderAcquisitionRuleTiers=renderAcquisitionRuleTiers;
window.addAcquisitionTierRow=addAcquisitionTierRow;
window.saveAcquisitionRules=saveAcquisitionRules;
})();
