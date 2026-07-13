(function(root){
  'use strict';

  const DB_NAME = 'arscaPriceChartingOffline';
  const DB_VERSION = 1;
  const CATEGORIES = new Set(['sports','comics','video_games','funko','lego','coins','yugioh','one_piece','lorcana','digimon','dragon_ball','garbage_pail','marvel','star_wars','other_tcg','amiibo','strategy_guides','gaming_magazines']);
  let dbPromise;

  function normalize(value=''){
    return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,' ').trim().toLowerCase().replace(/\s+/g,' ');
  }
  function requestPromise(request){ return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);}); }
  function transactionPromise(tx){ return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted'));}); }
  function validCategory(category){ const value=String(category||'').toLowerCase(); if(!CATEGORIES.has(value)) throw new Error('unsupported PriceCharting offline category'); return value; }

  function openDb(){
    if(dbPromise) return dbPromise;
    dbPromise=new Promise((resolve,reject)=>{
      const request=indexedDB.open(DB_NAME,DB_VERSION);
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains('products')){
          const store=db.createObjectStore('products',{keyPath:['category','catalogVersion','productId']});
          store.createIndex('categoryVersion',['category','catalogVersion']);
          store.createIndex('productId','productId');
        }
        if(!db.objectStoreNames.contains('meta')) db.createObjectStore('meta',{keyPath:'category'});
      };
      request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();resolve(db);};
      request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(new Error('Close other dashboard tabs to update offline catalogs.'));
    });
    return dbPromise;
  }
  async function getMeta(category){const db=await openDb();return requestPromise(db.transaction('meta','readonly').objectStore('meta').get(validCategory(category)));}
  async function putMeta(record){const db=await openDb(),tx=db.transaction('meta','readwrite');tx.objectStore('meta').put(record);await transactionPromise(tx);return record;}
  async function clearVersion(category,version){
    if(!version)return; const db=await openDb(),tx=db.transaction('products','readwrite'),store=tx.objectStore('products'),index=store.index('categoryVersion');
    const done=transactionPromise(tx);
    await new Promise((resolve,reject)=>{const req=index.openKeyCursor(IDBKeyRange.only([category,version]));req.onerror=()=>reject(req.error);req.onsuccess=()=>{const cursor=req.result;if(!cursor){resolve();return;}store.delete(cursor.primaryKey);cursor.continue();};});
    await done;
  }
  async function putBatch(category,version,rows){if(!rows.length)return;const db=await openDb(),tx=db.transaction('products','readwrite'),store=tx.objectStore('products');rows.forEach(row=>store.put({...row,category,catalogVersion:version}));await transactionPromise(tx);}
  async function sha256Hex(buffer){const digest=await crypto.subtle.digest('SHA-256',buffer);return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}

  async function sync(category,{workerBase='',force=false,onProgress}={}){
    category=validCategory(category);
    const manifestResponse=await fetch(`${workerBase}/catalog/pricecharting/${category}/manifest`,{cache:'no-store'});
    if(!manifestResponse.ok) throw new Error(`${category} manifest unavailable (HTTP ${manifestResponse.status})`);
    const manifest=await manifestResponse.json();
    if(manifest.status!=='ready'||!manifest.version||!manifest.files?.products) throw new Error(`${category} catalog is not ready`);
    const active=await getMeta(category);
    if(!force&&active?.catalogVersion===manifest.version&&active?.sha256===manifest.files.products.sha256) return {updated:false,manifest,status:await status(category)};
    const version=manifest.version,descriptor=manifest.files.products;
    await clearVersion(category,version);
    onProgress?.({stage:'Downloading',category,version});
    const response=await fetch(`${workerBase}/catalog/pricecharting/${category}/download`,{cache:'no-store'});
    if(!response.ok) throw new Error(`${category} download failed (HTTP ${response.status})`);
    const compressed=await response.arrayBuffer();
    if(descriptor.sha256&&await sha256Hex(compressed)!==String(descriptor.sha256).toLowerCase()) throw new Error(`${category} checksum mismatch`);
    if(typeof DecompressionStream==='undefined') throw new Error('This browser cannot decompress offline catalogs. Update Chrome.');
    const reader=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')).getReader(),decoder=new TextDecoder();
    let pending='',count=0,batch=[];
    while(true){
      const {value,done}=await reader.read(); pending+=decoder.decode(value||new Uint8Array(),{stream:!done});
      const lines=pending.split('\n'); pending=lines.pop()||'';
      for(const line of lines){if(!line.trim())continue;batch.push(JSON.parse(line));count++;}
      if(batch.length>=500){await putBatch(category,version,batch);batch=[];onProgress?.({stage:'Importing',category,count,total:descriptor.recordCount||0});await new Promise(resolve=>setTimeout(resolve,0));}
      if(done)break;
    }
    if(pending.trim()){batch.push(JSON.parse(pending));count++;} if(batch.length)await putBatch(category,version,batch);
    if(descriptor.recordCount&&count!==Number(descriptor.recordCount)) throw new Error(`${category} record count mismatch (${count}/${descriptor.recordCount})`);
    await putMeta({category,catalogVersion:version,sha256:descriptor.sha256||'',rowCount:count,lastImportedAt:new Date().toISOString(),generatedAt:manifest.generatedAt||'',sourceVersions:manifest.sourceVersions||{}});
    if(active?.catalogVersion&&active.catalogVersion!==version) clearVersion(category,active.catalogVersion).catch(()=>{});
    onProgress?.({stage:'Complete',category,count,version}); return {updated:true,manifest,status:await status(category)};
  }

  function queryParts(query){const raw=String(query||''),clean=normalize(raw),tokens=clean.split(' ').filter(token=>token.length>1||/^\d+$/.test(token)),identifiers=[...raw.matchAll(/(?:#|no\.?\s*)?([a-z]*\d+[a-z]*(?:[-/.][a-z0-9]+)?)/ig)].map(match=>normalize(match[1])).filter(Boolean);return{raw,clean,tokens,identifiers,year:(raw.match(/\b(?:19|20)\d{2}\b/)||[])[0]||''};}
  function score(row,parts){
    const name=row.normalizedProductName||normalize(row.productName),hay=row.searchText||normalize([row.productName,row.consoleName,row.genre,row.releaseDate].join(' '));
    const hits=parts.tokens.filter(token=>hay.includes(token)),required=parts.tokens.length<=2?parts.tokens.length:Math.ceil(parts.tokens.length*.7);
    if(hits.length<required||parts.identifiers.some(id=>!hay.includes(id)))return null;
    let value=parts.clean&&name===parts.clean?600:parts.clean&&name.startsWith(parts.clean)?420:0;
    if(parts.clean&&hay.includes(parts.clean))value+=260;
    value+=hits.length*55+(hits.length/Math.max(1,parts.tokens.length))*180;
    value+=parts.identifiers.filter(id=>name.includes(id)||normalize(row.productId)===id||normalize(row.upc)===id||normalize(row.asin)===id).length*220;
    if(parts.year&&String(row.releaseDate||'').includes(parts.year))value+=100;
    if(/\b(sealed|box|pack|case|bundle|blaster|hobby|booster|display|tin)\b/.test(parts.clean)&&/\b(sealed|box|pack|case|bundle|blaster|hobby|booster|display|tin)\b/.test(hay))value+=180;
    if(/\b(reprint|facsimile)\b/.test(hay)&&!/\b(reprint|facsimile)\b/.test(parts.clean))value-=160;
    return value;
  }
  async function search(category,query,limit=80){
    category=validCategory(category);const meta=await getMeta(category);if(!meta?.catalogVersion)return[];const parts=queryParts(query);if(!parts.tokens.length)return[];
    const db=await openDb(),index=db.transaction('products','readonly').objectStore('products').index('categoryVersion');
    const rows=await new Promise((resolve,reject)=>{const out=[],req=index.openCursor(IDBKeyRange.only([category,meta.catalogVersion]));req.onerror=()=>reject(req.error);req.onsuccess=()=>{const cursor=req.result;if(!cursor){resolve(out);return;}const value=score(cursor.value,parts);if(value!==null)out.push({...cursor.value,offlineScore:value});cursor.continue();};});
    return rows.sort((a,b)=>b.offlineScore-a.offlineScore).slice(0,limit);
  }
  async function status(category){category=validCategory(category);const meta=await getMeta(category);return {category,catalogVersion:meta?.catalogVersion||'',rowCount:Number(meta?.rowCount||0),lastImportedAt:meta?.lastImportedAt||'',generatedAt:meta?.generatedAt||'',sourceVersions:meta?.sourceVersions||{}};}
  async function clear(category){category=validCategory(category);const meta=await getMeta(category);if(meta?.catalogVersion)await clearVersion(category,meta.catalogVersion);const db=await openDb(),tx=db.transaction('meta','readwrite');tx.objectStore('meta').delete(category);await transactionPromise(tx);}

  root.ArsCaPriceChartingOffline={openDb,sync,search,status,clear,normalize,DB_NAME,categories:[...CATEGORIES]};
})(typeof window!=='undefined'?window:globalThis);
