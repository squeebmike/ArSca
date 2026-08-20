(function(root){
  'use strict';

  // Device-side sync for the Pokemon offline R2 bundle: real set metadata
  // (name, series, release date, set logo URLs) plus, once harvested server
  // side, actual card image blobs -- stored locally so scanning/searching
  // Pokemon cards works with zero network and zero PPT credits burned per
  // device. Bulk price/sealed/ebay/population data is a separate, already
  // -existing flow (downloadPokemonExport() in dashboard.html against
  // /pricing/pokemon/export) and is untouched by this module.

  const DB_NAME = 'arscaPokemonOfflineImages';
  const DB_VERSION = 1;
  let dbPromise;

  function requestPromise(request){ return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);}); }
  function transactionPromise(tx){ return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted'));}); }

  function openDb(){
    if(dbPromise) return dbPromise;
    dbPromise=new Promise((resolve,reject)=>{
      const request=indexedDB.open(DB_NAME,DB_VERSION);
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains('sets')){
          const s=db.createObjectStore('sets',{keyPath:'tcgPlayerNumericId'});
          s.createIndex('series','series');
          s.createIndex('releaseDate','releaseDate');
        }
        if(!db.objectStoreNames.contains('images')) db.createObjectStore('images',{keyPath:['tcgPlayerId','size']});
        if(!db.objectStoreNames.contains('meta')) db.createObjectStore('meta',{keyPath:'key'});
      };
      request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();resolve(db);};
      request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(new Error('Close other dashboard tabs to update the Pokemon offline catalog.'));
    });
    return dbPromise;
  }
  async function getMeta(key){const db=await openDb();return requestPromise(db.transaction('meta','readonly').objectStore('meta').get(key));}
  async function putMeta(record){const db=await openDb(),tx=db.transaction('meta','readwrite');tx.objectStore('meta').put(record);await transactionPromise(tx);return record;}
  async function sha256Hex(buffer){const digest=await crypto.subtle.digest('SHA-256',buffer);return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}

  async function fetchManifest(workerBase){
    const response=await fetch(`${workerBase}/catalog/pokemon/manifest`,{cache:'no-store'});
    if(!response.ok) throw new Error(`Pokemon catalog manifest unavailable (HTTP ${response.status})`);
    const manifest=await response.json();
    if(manifest.status!=='ready') throw new Error('Pokemon offline catalog is not ready yet');
    return manifest;
  }

  async function syncSets({workerBase='',force=false,onProgress}={}){
    const manifest=await fetchManifest(workerBase);
    const descriptor=manifest.files?.sets;
    if(!descriptor) throw new Error('Pokemon sets bundle is not ready yet');
    const meta=await getMeta('sets');
    if(!force&&meta?.sha256===descriptor.sha256) return {updated:false,manifest};
    onProgress?.({stage:'Downloading sets'});
    const response=await fetch(`${workerBase}/catalog/pokemon/download?file=sets`,{cache:'no-store'});
    if(!response.ok) throw new Error(`Pokemon sets download failed (HTTP ${response.status})`);
    const compressed=await response.arrayBuffer();
    if(descriptor.sha256&&await sha256Hex(compressed)!==String(descriptor.sha256).toLowerCase()) throw new Error('Pokemon sets checksum mismatch');
    if(typeof DecompressionStream==='undefined') throw new Error('This browser cannot decompress offline catalogs. Update Chrome.');
    const text=await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    const db=await openDb();
    const tx=db.transaction('sets','readwrite'),store=tx.objectStore('sets');
    let count=0;
    for(const line of text.split('\n')){
      if(!line.trim())continue;
      const set=JSON.parse(line);
      if(!set.tcgPlayerNumericId)continue;
      store.put(set);
      count++;
    }
    await transactionPromise(tx);
    await putMeta({key:'sets',sha256:descriptor.sha256||'',recordCount:count,generatedAt:manifest.generatedAt||'',lastImportedAt:new Date().toISOString()});
    onProgress?.({stage:'Sets ready',count});
    return {updated:true,manifest,count};
  }

  async function listSets(){
    const db=await openDb();
    const rows=await requestPromise(db.transaction('sets','readonly').objectStore('sets').getAll());
    return (rows||[]).sort((a,b)=>String(b.releaseDate||'').localeCompare(String(a.releaseDate||'')));
  }

  async function existingImageIds(){
    const db=await openDb();
    const keys=await requestPromise(db.transaction('images','readonly').objectStore('images').getAllKeys());
    return new Set((keys||[]).map(key=>String(key[0])));
  }

  async function putImageBlob(tcgPlayerId,size,blob){
    const db=await openDb(),tx=db.transaction('images','readwrite');
    tx.objectStore('images').put({tcgPlayerId:String(tcgPlayerId),size:String(size),blob,cachedAt:new Date().toISOString()});
    await transactionPromise(tx);
  }

  // scope: 'all' or a set's tcgPlayerNumericId (string/number).
  async function syncImages({workerBase='',scope='all',force=false,onProgress,concurrency=4}={}){
    const manifest=await fetchManifest(workerBase);
    const scopeKey=String(scope);
    const indexResponse=await fetch(`${workerBase}/catalog/pokemon/images/manifest?set=${encodeURIComponent(scopeKey)}`,{cache:'no-store'});
    if(!indexResponse.ok){
      const body=await indexResponse.json().catch(()=>({}));
      throw new Error(body.error||`Pokemon image index for "${scopeKey}" is not built yet -- run the "Build Pokemon Offline Card Images" GitHub Action for this set first`);
    }
    const index=await indexResponse.json();
    const sizes=(index.sizes||[200,400]).map(String);
    const already=force?new Set():await existingImageIds();
    const pending=(index.ids||[]).filter(id=>!already.has(String(id)));
    let done=0,failed=0;
    onProgress?.({stage:'Downloading images',total:pending.length,done:0});
    let cursor=0;
    async function worker(){
      while(cursor<pending.length){
        const id=pending[cursor++];
        for(const size of sizes){
          try{
            const response=await fetch(`${workerBase}/catalog/pokemon/image?id=${encodeURIComponent(id)}&size=${encodeURIComponent(size)}`,{cache:'no-store'});
            if(!response.ok) continue;
            const blob=await response.blob();
            await putImageBlob(id,size,blob);
          }catch{ /* one missing size for one card should not abort the whole sync */ }
        }
        done++;
        if(done%25===0||done===pending.length) onProgress?.({stage:'Downloading images',total:pending.length,done});
      }
    }
    await Promise.all(Array.from({length:Math.min(concurrency,pending.length||1)},worker));
    await putMeta({key:`images:${scopeKey}`,idCount:(index.ids||[]).length,newlyCached:pending.length-failed,generatedAt:index.generatedAt||manifest.generatedAt||'',lastSyncAt:new Date().toISOString()});
    onProgress?.({stage:'Images ready',total:pending.length,done});
    return {updated:pending.length>0,newlyCached:pending.length,manifest};
  }

  async function status(){
    const db=await openDb();
    const setsCount=await requestPromise(db.transaction('sets','readonly').objectStore('sets').count());
    const imageKeys=await requestPromise(db.transaction('images','readonly').objectStore('images').getAllKeys());
    const setsMeta=await getMeta('sets');
    const cardIds=new Set((imageKeys||[]).map(key=>String(key[0])));
    return {
      setsCount,
      cardImageCount:cardIds.size,
      imageFileCount:(imageKeys||[]).length,
      setsGeneratedAt:setsMeta?.generatedAt||'',
      setsImportedAt:setsMeta?.lastImportedAt||'',
    };
  }

  async function getImageBlob(tcgPlayerId,size='400'){
    const db=await openDb();
    const row=await requestPromise(db.transaction('images','readonly').objectStore('images').get([String(tcgPlayerId),String(size)]));
    return row?.blob||null;
  }

  async function clear(){
    const db=await openDb();
    for(const storeName of ['sets','images','meta']){
      const tx=db.transaction(storeName,'readwrite');
      tx.objectStore(storeName).clear();
      await transactionPromise(tx);
    }
  }

  root.ArsCaPokemonOfflineImages={openDb,syncSets,syncImages,listSets,status,clear,getImageBlob,DB_NAME};
})(typeof window!=='undefined'?window:globalThis);
