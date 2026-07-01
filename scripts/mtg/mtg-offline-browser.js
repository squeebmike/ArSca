(function(root){
  'use strict';

  const DB_NAME = 'arscaOfflineCatalog';
  const DB_VERSION = 1;
  const DATA_STORES = ['mtg_cards','mtg_sets','mtg_prices','mtg_price_links'];
  let dbPromise;

  function normalize(value = '') {
    return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,' ').trim().toLowerCase().replace(/\s+/g,' ');
  }

  function requestPromise(request){
    return new Promise((resolve,reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  }

  function transactionPromise(tx){
    return new Promise((resolve,reject) => { tx.oncomplete = () => resolve(true); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted')); });
  }

  function openDb(){
    if(dbPromise) return dbPromise;
    dbPromise = new Promise((resolve,reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        const createVersioned = (name, idField, indexes) => {
          if(db.objectStoreNames.contains(name)) return;
          const store = db.createObjectStore(name, { keyPath:['catalogVersion', idField] });
          store.createIndex('catalogVersion','catalogVersion');
          store.createIndex(idField,idField);
          indexes.forEach(([index,keyPath,options]) => store.createIndex(index,keyPath,options || {}));
        };
        createVersioned('mtg_cards','scryfallId',[
          ['name','name'],['normalizedName','normalizedName'],['setCode','setCode'],['setName','setName'],
          ['collectorNumber','collectorNumber'],['oracleId','oracleId'],['artist','artist'],['rarity','rarity'],
          ['typeLine','typeLine'],['searchText','searchText']
        ]);
        createVersioned('mtg_sets','setCode',[['setName','setName'],['releasedAt','releasedAt']]);
        createVersioned('mtg_prices','pricechartingId',[['productName','productName'],['normalizedProductName','normalizedProductName'],['updatedAt','updatedAt']]);
        createVersioned('mtg_price_links','scryfallId',[['pricechartingId','pricechartingId'],['confidence','confidence'],['oracleId','oracleId']]);
        if(!db.objectStoreNames.contains('mtg_meta')) db.createObjectStore('mtg_meta',{keyPath:'name'});
        if(!db.objectStoreNames.contains('mtg_images')) {
          const images = db.createObjectStore('mtg_images',{keyPath:'cacheKey'});
          images.createIndex('scryfallId','scryfallId'); images.createIndex('cachedAt','cachedAt');
        }
      };
      request.onsuccess = () => { const db=request.result; db.onversionchange=()=>db.close(); resolve(db); };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Close other dashboard tabs to update the MTG offline database.'));
    });
    return dbPromise;
  }

  async function getMeta(name='active'){
    const db=await openDb(); return requestPromise(db.transaction('mtg_meta','readonly').objectStore('mtg_meta').get(name));
  }

  async function putMeta(record){
    const db=await openDb(); const tx=db.transaction('mtg_meta','readwrite'); tx.objectStore('mtg_meta').put(record); await transactionPromise(tx); return record;
  }

  async function clearVersion(version){
    if(!version) return;
    const db=await openDb();
    for(const storeName of DATA_STORES){
      const tx=db.transaction(storeName,'readwrite'); const index=tx.objectStore(storeName).index('catalogVersion');
      const done=transactionPromise(tx);
      await new Promise((resolve,reject)=>{ const req=index.openKeyCursor(IDBKeyRange.only(version)); req.onerror=()=>reject(req.error); req.onsuccess=()=>{ const cursor=req.result; if(!cursor){resolve();return;} tx.objectStore(storeName).delete(cursor.primaryKey); cursor.continue(); }; });
      await done;
    }
  }

  async function putBatch(storeName, version, rows){
    if(!rows.length) return;
    const db=await openDb(); const tx=db.transaction(storeName,'readwrite'); const store=tx.objectStore(storeName);
    rows.forEach(row=>store.put({...row,catalogVersion:version})); await transactionPromise(tx);
  }

  async function sha256Hex(buffer){
    const digest=await crypto.subtle.digest('SHA-256',buffer);
    return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  }

  async function importGzipJsonl(response, descriptor, storeName, version, onProgress){
    if(!response.ok) throw new Error(`${storeName} download failed (HTTP ${response.status})`);
    const compressed=await response.arrayBuffer();
    if(descriptor.sha256 && await sha256Hex(compressed) !== String(descriptor.sha256).toLowerCase()) throw new Error(`${storeName} checksum mismatch`);
    if(typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress gzip offline catalogs. Update Chrome.');
    const reader=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const decoder=new TextDecoder(); let pending='', count=0, batch=[];
    while(true){
      const {value,done}=await reader.read();
      pending+=decoder.decode(value || new Uint8Array(),{stream:!done});
      const lines=pending.split('\n'); pending=lines.pop() || '';
      for(const line of lines){ if(!line.trim()) continue; batch.push(JSON.parse(line)); count++; }
      if(batch.length>=500){ await putBatch(storeName,version,batch); batch=[]; onProgress?.({stage:`Importing ${storeName.replace('mtg_','')}`,count,total:descriptor.recordCount||0}); await new Promise(resolve=>setTimeout(resolve,0)); }
      if(done) break;
    }
    if(pending.trim()){batch.push(JSON.parse(pending));count++;}
    if(batch.length) await putBatch(storeName,version,batch);
    if(descriptor.recordCount && count !== Number(descriptor.recordCount)) throw new Error(`${storeName} record count mismatch (${count}/${descriptor.recordCount})`);
    return count;
  }

  function emitProgress(detail,onProgress){
    onProgress?.(detail);
    root.dispatchEvent?.(new CustomEvent('arsca-mtg-offline-progress',{detail}));
  }

  async function sync({workerBase='',force=false,onProgress}={}){
    const manifestResponse=await fetch(workerBase+'/catalog/mtg/manifest',{cache:'no-store'});
    if(!manifestResponse.ok) throw new Error(`MTG manifest unavailable (HTTP ${manifestResponse.status})`);
    const manifest=await manifestResponse.json();
    if(manifest.status!=='ready' || !manifest.version) throw new Error('MTG manifest is not ready');
    const active=await getMeta('active');
    if(!force && active?.catalogVersion===manifest.version && active?.manifestSha===manifest.files?.cards?.sha256) return {updated:false,manifest,status:await status()};
    const target=manifest.version;
    await clearVersion(target);
    await putMeta({name:'import',importStatus:'running',targetVersion:target,startedAt:new Date().toISOString()});
    const jobs=[['cards','mtg_cards'],['prices','mtg_prices'],['links','mtg_price_links'],['sets','mtg_sets']];
    const counts={};
    try{
      for(const [file,store] of jobs){
        const descriptor=manifest.files?.[file];
        if(!descriptor){ if(file==='prices'||file==='links'){counts[file]=0;continue;} throw new Error(`Manifest missing ${file}`); }
        emitProgress({stage:`Downloading ${file}`,file,version:target},onProgress);
        const response=await fetch(workerBase+`/catalog/mtg/download?file=${encodeURIComponent(file)}`,{cache:'no-store'});
        counts[file]=await importGzipJsonl(response,descriptor,store,target,detail=>emitProgress({...detail,file,version:target},onProgress));
      }
      const importedAt=new Date().toISOString();
      await putMeta({name:'active',catalogVersion:target,pricesVersion:target,manifestSha:manifest.files.cards.sha256,lastImportedAt:importedAt,importStatus:'ready',counts,generatedAt:manifest.generatedAt});
      await putMeta({name:'import',importStatus:'complete',targetVersion:target,completedAt:importedAt});
      emitProgress({stage:'Complete',version:target,counts},onProgress);
      if(active?.catalogVersion && active.catalogVersion!==target) clearVersion(active.catalogVersion).catch(()=>{});
      return {updated:true,manifest,status:await status()};
    }catch(error){
      await putMeta({name:'import',importStatus:'failed',targetVersion:target,error:error.message,failedAt:new Date().toISOString()}).catch(()=>{});
      await clearVersion(target).catch(()=>{});
      throw error;
    }
  }

  async function recordsForVersion(storeName,version,limit=Infinity,predicate=()=>true){
    if(!version) return [];
    const db=await openDb(); const tx=db.transaction(storeName,'readonly'); const index=tx.objectStore(storeName).index('catalogVersion');
    return new Promise((resolve,reject)=>{ const rows=[]; const req=index.openCursor(IDBKeyRange.only(version)); req.onerror=()=>reject(req.error); req.onsuccess=()=>{ const cursor=req.result; if(!cursor||rows.length>=limit){resolve(rows);return;} if(predicate(cursor.value)) rows.push(cursor.value); cursor.continue(); }; });
  }

  async function getVersioned(storeName,version,id){
    const db=await openDb(); return requestPromise(db.transaction(storeName,'readonly').objectStore(storeName).get([version,id]));
  }

  function queryParts(query){
    const raw=String(query||'');
    const artist=(raw.match(/\bartist\s+(.+)$/i)||[])[1] || '';
    const set=(raw.match(/\bset\s+([a-z0-9]{2,8})\b/i)||[])[1] || '';
    const explicitCollector=(raw.match(/\bcollector(?:\s+(?:number|#))?\s*#?([a-z0-9/-]+)/i)||[])[1] || '';
    const inferredCollector=!explicitCollector ? (raw.match(/(?:^|\s)#?([0-9]{1,5}[a-z]?(?:\/[0-9]{1,5})?)\s*$/i)||[])[1] || '' : '';
    const collector=explicitCollector||inferredCollector;
    const clean=normalize(raw
      .replace(/\bmagic\s*:?\s*the\s+gathering\b/ig,' ')
      .replace(/\bmagic\s+cards?\b/ig,' ')
      .replace(/\bmtg\b/ig,' ')
      .replace(/\bartist\s+.+$/i,'')
      .replace(/\bset\s+[a-z0-9]{2,8}\b/i,'')
      .replace(/\bcollector(?:\s+(?:number|#))?\s*#?[a-z0-9/-]+/i,'')
      .replace(inferredCollector ? new RegExp(`(?:^|\\s)#?${inferredCollector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\s*$`,'i') : /$^/,''));
    return {raw,artist:normalize(artist),set:normalize(set),collector:normalize(collector),tokens:clean.split(' ').filter(Boolean),clean};
  }

  function scoreCard(card,parts){
    const name=card.normalizedName||normalize(card.name), hay=card.searchText||normalize([card.name,card.setName,card.collectorNumber,card.artist,card.typeLine,card.oracleText,...(card.keywords||[])].join(' '));
    if(parts.artist && !normalize(card.artist).includes(parts.artist)) return null;
    if(parts.set && normalize(card.setCode)!==parts.set && !normalize(card.setName).includes(parts.set)) return null;
    if(parts.collector && normalize(card.collectorNumber)!==parts.collector) return null;
    if(parts.tokens.some(token=>!hay.includes(token))) return null;
    let score=0; const why=[];
    if(parts.clean && name===parts.clean){score+=600;why.push('exact name');}
    else if(parts.clean && name.startsWith(parts.clean)){score+=420;why.push('name prefix');}
    const nameHits=parts.tokens.filter(token=>name.includes(token)).length; score+=nameHits*55;
    if(parts.set){score+=280;why.push('set');}
    if(parts.collector){score+=320;why.push('collector number');}
    if(parts.artist){score+=250;why.push('artist');}
    const keywordHits=parts.tokens.filter(token=>(card.keywords||[]).some(keyword=>normalize(keyword).includes(token))).length;
    if(keywordHits){score+=keywordHits*45;why.push('keyword');}
    const oracleHits=parts.tokens.filter(token=>normalize(card.oracleText).includes(token)).length;
    if(oracleHits){score+=oracleHits*12;why.push('oracle text');}
    return {score,why};
  }

  async function search(query,limit=50){
    const active=await getMeta('active'); if(!active?.catalogVersion) return [];
    const parts=queryParts(query); if(!parts.tokens.length&&!parts.artist&&!parts.set&&!parts.collector) return [];
    const cards=await recordsForVersion('mtg_cards',active.catalogVersion,Math.max(limit*4,120),card=>scoreCard(card,parts)!==null);
    const ranked=cards.map(card=>({card,...scoreCard(card,parts)})).sort((a,b)=>b.score-a.score).slice(0,limit);
    return Promise.all(ranked.map(async item=>{
      const link=await getVersioned('mtg_price_links',active.catalogVersion,item.card.scryfallId);
      const price=link?.pricechartingId ? await getVersioned('mtg_prices',active.catalogVersion,link.pricechartingId) : null;
      return {...item.card,offlinePriceLink:link||null,offlinePrice:price||null,offlineMatchWhy:item.why,catalogVersion:active.catalogVersion};
    }));
  }

  async function sets(){ const active=await getMeta('active'); return (await recordsForVersion('mtg_sets',active?.catalogVersion)).sort((a,b)=>String(b.releasedAt||'').localeCompare(String(a.releasedAt||''))); }
  async function cardsBySet(setCode){
    const active=await getMeta('active'), version=active?.catalogVersion, wanted=normalize(setCode);
    const cards=await recordsForVersion('mtg_cards',version,Infinity,card=>normalize(card.setCode)===wanted);
    return Promise.all(cards.map(async card=>{
      const link=await getVersioned('mtg_price_links',version,card.scryfallId);
      const price=link?.pricechartingId ? await getVersioned('mtg_prices',version,link.pricechartingId) : null;
      return {...card,offlinePriceLink:link||null,offlinePrice:price||null,catalogVersion:version};
    }));
  }

  async function countVersion(storeName,version){
    if(!version) return 0; const db=await openDb(); return requestPromise(db.transaction(storeName,'readonly').objectStore(storeName).index('catalogVersion').count(IDBKeyRange.only(version)));
  }

  async function status(){
    const active=await getMeta('active'); const version=active?.catalogVersion||'';
    const [cards,setsCount,prices,links,images]=await Promise.all([
      countVersion('mtg_cards',version),countVersion('mtg_sets',version),countVersion('mtg_prices',version),countVersion('mtg_price_links',version),
      openDb().then(db=>requestPromise(db.transaction('mtg_images','readonly').objectStore('mtg_images').count())).catch(()=>0)
    ]);
    return {catalogVersion:version,pricesVersion:active?.pricesVersion||'',lastImportedAt:active?.lastImportedAt||'',importStatus:active?.importStatus||'not-downloaded',cards,sets:setsCount,prices,links,images};
  }

  async function clearAll(){
    const db=await openDb();
    for(const storeName of [...DATA_STORES,'mtg_meta']){const tx=db.transaction(storeName,'readwrite');tx.objectStore(storeName).clear();await transactionPromise(tx);}
  }

  async function urlHash(url){return (await sha256Hex(new TextEncoder().encode(String(url)))).slice(0,24);}

  async function cacheImage({scryfallId,url,size='normal',faceIndex=0}){
    if(!scryfallId||!url) throw new Error('scryfallId and url required');
    const hash=await urlHash(url), cacheKey=`mtg-image:${scryfallId}:${faceIndex}:${size}:${hash}`;
    const db=await openDb(); const existing=await requestPromise(db.transaction('mtg_images','readonly').objectStore('mtg_images').get(cacheKey));
    if(existing) return {...existing,skipped:true};
    const response=await fetch(url); if(!response.ok) throw new Error(`Image HTTP ${response.status}`); const blob=await response.blob();
    const old=await requestPromise(db.transaction('mtg_images','readonly').objectStore('mtg_images').index('scryfallId').getAll(scryfallId));
    const tx=db.transaction('mtg_images','readwrite'), store=tx.objectStore('mtg_images');
    old.filter(row=>row.faceIndex===faceIndex&&row.size===size&&row.cacheKey!==cacheKey).forEach(row=>store.delete(row.cacheKey));
    const record={cacheKey,scryfallId,faceIndex,size,url,urlHash:hash,blob,cachedAt:new Date().toISOString()}; store.put(record); await transactionPromise(tx); return record;
  }

  async function cachedImageUrl({scryfallId,url,size='normal',faceIndex=0}){
    const hash=await urlHash(url), key=`mtg-image:${scryfallId}:${faceIndex}:${size}:${hash}`, db=await openDb();
    const row=await requestPromise(db.transaction('mtg_images','readonly').objectStore('mtg_images').get(key)); return row?.blob ? URL.createObjectURL(row.blob) : '';
  }

  async function clearImageCache(){const db=await openDb();const tx=db.transaction('mtg_images','readwrite');tx.objectStore('mtg_images').clear();await transactionPromise(tx);}

  root.ArsCaMtgOffline={openDb,sync,search,sets,cardsBySet,status,clearAll,cacheImage,cachedImageUrl,clearImageCache,normalize,queryParts,DB_NAME};
})(typeof window!=='undefined'?window:globalThis);
