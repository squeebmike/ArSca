(function(root){
  'use strict';

  const DB_NAME = 'arscaPriceChartingOffline';
  const DB_VERSION = 2;
  const SEARCH_INDEX_VERSION = 1;
  const CATEGORIES = new Set(['video_games','yugioh','one_piece']);
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
        const products=request.transaction.objectStore('products');
        if(!products.indexNames.contains('categoryVersionName')) products.createIndex('categoryVersionName',['category','catalogVersion','normalizedProductName']);
        if(!products.indexNames.contains('categoryVersionProductId')) products.createIndex('categoryVersionProductId',['category','catalogVersion','searchProductId']);
        if(!products.indexNames.contains('categoryVersionUpc')) products.createIndex('categoryVersionUpc',['category','catalogVersion','searchUpc']);
        if(!products.indexNames.contains('categoryVersionAsin')) products.createIndex('categoryVersionAsin',['category','catalogVersion','searchAsin']);
        if(!db.objectStoreNames.contains('search_tokens')) db.createObjectStore('search_tokens',{keyPath:['category','catalogVersion','token','productId']});
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
    const tokenTx=db.transaction('search_tokens','readwrite'),tokens=tokenTx.objectStore('search_tokens'),tokenDone=transactionPromise(tokenTx);
    await new Promise((resolve,reject)=>{const range=IDBKeyRange.bound([category,version,'',''],[category,version,'\uffff','\uffff']);const req=tokens.openKeyCursor(range);req.onerror=()=>reject(req.error);req.onsuccess=()=>{const cursor=req.result;if(!cursor){resolve();return;}tokens.delete(cursor.primaryKey);cursor.continue();};});
    await tokenDone;
  }
  function indexTokens(row){
    const values=[row.productName,row.consoleName,row.genre,row.releaseDate,row.upc,row.asin,row.epid,row.productId];
    return [...new Set(normalize(values.join(' ')).split(' ').filter(token=>token.length>1||/^\d+$/.test(token)))].slice(0,32);
  }
  async function putBatch(category,version,rows){
    if(!rows.length)return;const db=await openDb(),tx=db.transaction(['products','search_tokens'],'readwrite'),store=tx.objectStore('products'),tokens=tx.objectStore('search_tokens');
    rows.forEach(row=>{const product={...row,category,catalogVersion:version,searchProductId:normalize(row.productId),searchUpc:normalize(row.upc),searchAsin:normalize(row.asin)};store.put(product);indexTokens(product).forEach(token=>tokens.put({category,catalogVersion:version,token,productId:String(product.productId)}));});
    await transactionPromise(tx);
  }
  async function sha256Hex(buffer){const digest=await crypto.subtle.digest('SHA-256',buffer);return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}

  async function sync(category,{workerBase='',force=false,onProgress}={}){
    category=validCategory(category);
    const manifestResponse=await fetch(`${workerBase}/catalog/pricecharting/${category}/manifest`,{cache:'no-store'});
    if(!manifestResponse.ok) throw new Error(`${category} manifest unavailable (HTTP ${manifestResponse.status})`);
    const manifest=await manifestResponse.json();
    if(manifest.status!=='ready'||!manifest.version||!manifest.files?.products) throw new Error(`${category} catalog is not ready`);
    const active=await getMeta(category);
    const activeManifestVersion=active?.manifestVersion||active?.catalogVersion||'';
    if(!force&&activeManifestVersion===manifest.version&&active?.sha256===manifest.files.products.sha256&&active?.searchIndexVersion===SEARCH_INDEX_VERSION) return {updated:false,manifest,status:await status(category)};
    const descriptor=manifest.files.products,version=`${manifest.version}::${String(descriptor.sha256||Date.now()).slice(0,12)}${force?'::'+Date.now():''}`;
    await clearVersion(category,version);
    try{
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
    await putMeta({category,catalogVersion:version,manifestVersion:manifest.version,sha256:descriptor.sha256||'',rowCount:count,lastImportedAt:new Date().toISOString(),generatedAt:manifest.generatedAt||'',sourceVersions:manifest.sourceVersions||{},searchIndexVersion:SEARCH_INDEX_VERSION});
    if(active?.catalogVersion&&active.catalogVersion!==version) clearVersion(category,active.catalogVersion).catch(()=>{});
    onProgress?.({stage:'Complete',category,count,version}); return {updated:true,manifest,status:await status(category)};
    }catch(error){
      await clearVersion(category,version).catch(()=>{});
      throw error;
    }
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
  async function exactCandidates(db,category,version,parts){
    const found=new Map(),add=rows=>(rows||[]).forEach(row=>found.set(String(row.productId),row));
    const exactValues=[parts.raw.trim(),...parts.identifiers].map(normalize).filter(Boolean);
    for(const value of exactValues){
      for(const indexName of ['categoryVersionProductId','categoryVersionUpc','categoryVersionAsin']){
        const store=db.transaction('products','readonly').objectStore('products');
        const row=await requestPromise(store.index(indexName).get([category,version,value])).catch(()=>null);if(row)add([row]);
      }
    }
    if(parts.clean){
      let store=db.transaction('products','readonly').objectStore('products');
      add(await requestPromise(store.index('categoryVersionName').getAll([category,version,parts.clean],100)).catch(()=>[]));
      const range=IDBKeyRange.bound([category,version,parts.clean],[category,version,parts.clean+'\uffff']);
      store=db.transaction('products','readonly').objectStore('products');
      add(await requestPromise(store.index('categoryVersionName').getAll(range,200)).catch(()=>[]));
    }
    return found;
  }
  async function tokenCandidateIds(db,category,version,tokens,max=800){
    const ordered=[...new Set(tokens)].sort((a,b)=>b.length-a.length),sets=[];
    for(const token of ordered.slice(0,4)){
      const tx=db.transaction('search_tokens','readonly'),store=tx.objectStore('search_tokens'),range=IDBKeyRange.bound([category,version,token,''],[category,version,token,'\uffff']);
      const keys=await requestPromise(store.getAllKeys(range,max));
      sets.push(new Set(keys.map(key=>String(key[3]))));
      if(!keys.length)return[];
    }
    if(!sets.length)return[];
    return [...sets[0]].filter(id=>sets.every(set=>set.has(id))).slice(0,max);
  }
  async function legacyScan(store,category,version,parts,limit){
    const index=store.index('categoryVersion');
    const rows=await new Promise((resolve,reject)=>{const out=[],req=index.openCursor(IDBKeyRange.only([category,version]));req.onerror=()=>reject(req.error);req.onsuccess=()=>{const cursor=req.result;if(!cursor){resolve(out);return;}const value=score(cursor.value,parts);if(value!==null)out.push({...cursor.value,offlineScore:value});cursor.continue();};});
    return rows.sort((a,b)=>b.offlineScore-a.offlineScore).slice(0,limit);
  }
  async function search(category,query,limit=20){
    category=validCategory(category);const meta=await getMeta(category);if(!meta?.catalogVersion)return[];const parts=queryParts(query);if(!parts.tokens.length)return[];
    const db=await openDb(),store=db.transaction('products','readonly').objectStore('products');
    if(meta.searchIndexVersion!==SEARCH_INDEX_VERSION)return legacyScan(store,category,meta.catalogVersion,parts,limit);
    const candidates=await exactCandidates(db,category,meta.catalogVersion,parts),ids=await tokenCandidateIds(db,category,meta.catalogVersion,parts.tokens);
    const rows=await Promise.all(ids.map(id=>{const readStore=db.transaction('products','readonly').objectStore('products');return requestPromise(readStore.get([category,meta.catalogVersion,id]));}));
    rows.filter(Boolean).forEach(row=>candidates.set(String(row.productId),row));
    return [...candidates.values()].map(row=>{const value=score(row,parts);return value===null?null:{...row,offlineScore:value};}).filter(Boolean).sort((a,b)=>b.offlineScore-a.offlineScore).slice(0,limit);
  }
  async function status(category){category=validCategory(category);const meta=await getMeta(category);return {category,catalogVersion:meta?.manifestVersion||meta?.catalogVersion||'',storageVersion:meta?.catalogVersion||'',rowCount:Number(meta?.rowCount||0),lastImportedAt:meta?.lastImportedAt||'',generatedAt:meta?.generatedAt||'',sourceVersions:meta?.sourceVersions||{},searchIndexReady:meta?.searchIndexVersion===SEARCH_INDEX_VERSION};}
  async function clear(category){category=validCategory(category);const meta=await getMeta(category);if(meta?.catalogVersion)await clearVersion(category,meta.catalogVersion);const db=await openDb(),tx=db.transaction('meta','readwrite');tx.objectStore('meta').delete(category);await transactionPromise(tx);}

  root.ArsCaPriceChartingOffline={openDb,sync,search,status,clear,normalize,DB_NAME,categories:[...CATEGORIES]};
})(typeof window!=='undefined'?window:globalThis);
