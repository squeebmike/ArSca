(function(root){
  'use strict';

  // Device-side sync for the MTG offline image bundle harvested by
  // scripts/mtg/build-mtg-offline-images.mjs -- real card image blobs,
  // stored locally so searching/browsing MTG cards works with zero network
  // and zero dependency on Scryfall's own CDN once cached. Card metadata and
  // prices are a separate, already-existing module (mtg-offline-browser.js)
  // and are untouched by this one -- this only covers what that one
  // doesn't: actual image bytes, mirroring
  // scripts/pokemon/offline-browser.js's same split for Pokemon.

  const DB_NAME = 'arscaMtgOfflineImages';
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
        if(!db.objectStoreNames.contains('images')) db.createObjectStore('images',{keyPath:['scryfallId','size']});
        if(!db.objectStoreNames.contains('meta')) db.createObjectStore('meta',{keyPath:'key'});
      };
      request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();resolve(db);};
      request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(new Error('Close other dashboard tabs to update the MTG offline image catalog.'));
    });
    return dbPromise;
  }
  async function getAllMeta(){const db=await openDb();return requestPromise(db.transaction('meta','readonly').objectStore('meta').getAll());}
  async function putMeta(record){const db=await openDb(),tx=db.transaction('meta','readwrite');tx.objectStore('meta').put(record);await transactionPromise(tx);return record;}

  async function existingImageIds(){
    const db=await openDb();
    const keys=await requestPromise(db.transaction('images','readonly').objectStore('images').getAllKeys());
    return new Set((keys||[]).map(key=>String(key[0])));
  }

  async function putImageBlob(scryfallId,size,blob){
    const db=await openDb(),tx=db.transaction('images','readwrite');
    tx.objectStore('images').put({scryfallId:String(scryfallId),size:String(size),blob,cachedAt:new Date().toISOString()});
    await transactionPromise(tx);
  }

  // scope: 'all' or a Scryfall set code (e.g. "mh3", "woe").
  async function syncImages({workerBase='',scope='all',force=false,onProgress,concurrency=4}={}){
    const scopeKey=String(scope).toLowerCase();
    const indexResponse=await fetch(`${workerBase}/catalog/mtg/images/manifest?set=${encodeURIComponent(scopeKey)}`,{cache:'no-store'});
    if(!indexResponse.ok){
      const body=await indexResponse.json().catch(()=>({}));
      throw new Error(body.error||`MTG image index for "${scopeKey}" is not built yet -- run the "Build MTG Offline Card Images" GitHub Action for this set first`);
    }
    const index=await indexResponse.json();
    const sizes=(index.sizes||['small','normal']).map(String);
    const already=force?new Set():await existingImageIds();
    const pending=(index.ids||[]).filter(id=>!already.has(String(id)));
    let done=0;
    onProgress?.({stage:'Downloading images',total:pending.length,done:0});
    let cursor=0;
    async function worker(){
      while(cursor<pending.length){
        const id=pending[cursor++];
        for(const size of sizes){
          try{
            const response=await fetch(`${workerBase}/catalog/mtg/image?id=${encodeURIComponent(id)}&size=${encodeURIComponent(size)}`,{cache:'no-store'});
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
    await putMeta({key:`images:${scopeKey}`,idCount:(index.ids||[]).length,newlyCached:pending.length,generatedAt:index.generatedAt||'',lastSyncAt:new Date().toISOString()});
    onProgress?.({stage:'Images ready',total:pending.length,done});
    return {updated:pending.length>0,newlyCached:pending.length};
  }

  async function status(){
    const db=await openDb();
    const imageKeys=await requestPromise(db.transaction('images','readonly').objectStore('images').getAllKeys());
    const cardIds=new Set((imageKeys||[]).map(key=>String(key[0])));
    const allMeta=await getAllMeta();
    const imageSyncTimes=(allMeta||[])
      .filter(m=>String(m?.key||'').startsWith('images:'))
      .map(m=>m.lastSyncAt).filter(Boolean).sort();
    return {
      cardImageCount:cardIds.size,
      imageFileCount:(imageKeys||[]).length,
      lastImageSyncAt:imageSyncTimes.length?imageSyncTimes[imageSyncTimes.length-1]:'',
    };
  }

  async function getImageBlob(scryfallId,size='normal'){
    const db=await openDb();
    const row=await requestPromise(db.transaction('images','readonly').objectStore('images').get([String(scryfallId),String(size)]));
    return row?.blob||null;
  }

  async function clear(){
    const db=await openDb();
    for(const storeName of ['images','meta']){
      const tx=db.transaction(storeName,'readwrite');
      tx.objectStore(storeName).clear();
      await transactionPromise(tx);
    }
  }

  root.ArsCaMtgOfflineImages={openDb,syncImages,status,clear,getImageBlob,DB_NAME};
})(typeof window!=='undefined'?window:globalThis);
