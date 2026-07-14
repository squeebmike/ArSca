(function(root){
  'use strict';

  const DB_NAME = 'arscaOfflineCatalog';
  const DB_VERSION = 3;
  const SEARCH_INDEX_VERSION = 1;
  const DATA_STORES = ['mtg_cards','mtg_sets','mtg_prices','mtg_price_links','mtg_search_tokens','mtg_price_search_tokens'];
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
        const cardsStore = request.transaction.objectStore('mtg_cards');
        if(!cardsStore.indexNames.contains('catalogSet')) cardsStore.createIndex('catalogSet',['catalogVersion','setCode']);
        if(!cardsStore.indexNames.contains('catalogName')) cardsStore.createIndex('catalogName',['catalogVersion','normalizedName']);
        if(!cardsStore.indexNames.contains('catalogCollector')) cardsStore.createIndex('catalogCollector',['catalogVersion','collectorNumber']);
        if(!cardsStore.indexNames.contains('catalogOracle')) cardsStore.createIndex('catalogOracle',['catalogVersion','oracleId']);
        if(!cardsStore.indexNames.contains('catalogArtist')) cardsStore.createIndex('catalogArtist',['catalogVersion','normalizedArtist']);
        if(!cardsStore.indexNames.contains('catalogTcgplayer')) cardsStore.createIndex('catalogTcgplayer',['catalogVersion','tcgplayerId']);
        createVersioned('mtg_sets','setCode',[['setName','setName'],['releasedAt','releasedAt']]);
        createVersioned('mtg_prices','pricechartingId',[['productName','productName'],['normalizedProductName','normalizedProductName'],['updatedAt','updatedAt']]);
        const pricesStore=request.transaction.objectStore('mtg_prices');
        if(!pricesStore.indexNames.contains('catalogPriceName')) pricesStore.createIndex('catalogPriceName',['catalogVersion','normalizedProductName']);
        if(!pricesStore.indexNames.contains('catalogPriceId')) pricesStore.createIndex('catalogPriceId',['catalogVersion','pricechartingId']);
        createVersioned('mtg_price_links','scryfallId',[['pricechartingId','pricechartingId'],['confidence','confidence'],['oracleId','oracleId']]);
        if(!db.objectStoreNames.contains('mtg_meta')) db.createObjectStore('mtg_meta',{keyPath:'name'});
        if(!db.objectStoreNames.contains('mtg_search_tokens')) {
          const searchTokens=db.createObjectStore('mtg_search_tokens',{keyPath:['catalogVersion','token','scryfallId']});
          searchTokens.createIndex('catalogVersion','catalogVersion');
        }
        if(!db.objectStoreNames.contains('mtg_price_search_tokens')) {
          const priceTokens=db.createObjectStore('mtg_price_search_tokens',{keyPath:['catalogVersion','token','pricechartingId']});
          priceTokens.createIndex('catalogVersion','catalogVersion');
        }
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
    const db=await openDb(); const stores=storeName==='mtg_cards'?[storeName,'mtg_search_tokens']:storeName==='mtg_prices'?[storeName,'mtg_price_search_tokens']:[storeName];
    const tx=db.transaction(stores,'readwrite'),store=tx.objectStore(storeName),tokenStore=storeName==='mtg_cards'?tx.objectStore('mtg_search_tokens'):null,priceTokenStore=storeName==='mtg_prices'?tx.objectStore('mtg_price_search_tokens'):null;
    rows.forEach(row=>{
      const tcgplayerId=String(row.tcgplayerId||String(row.purchaseUris?.tcgplayer||'').match(/\/product\/(\d+)/i)?.[1]||'');
      const record={...row,catalogVersion:version,normalizedArtist:normalize(row.artist),tcgplayerId};store.put(record);
      if(tokenStore) cardSearchTokens(record).forEach(token=>tokenStore.put({catalogVersion:version,token,scryfallId:String(record.scryfallId)}));
      if(priceTokenStore) priceSearchTokens(record).forEach(token=>priceTokenStore.put({catalogVersion:version,token,pricechartingId:String(record.pricechartingId)}));
    });
    await transactionPromise(tx);
  }

  function cardSearchTokens(card){
    const values=[card.name,card.printedName,card.setCode,card.setName,card.collectorNumber,card.artist,card.typeLine,...(card.keywords||[])];
    return [...new Set(normalize(values.join(' ')).split(' ').filter(Boolean))].slice(0,40);
  }
  function priceSearchTokens(price){return [...new Set(normalize([price.productName,price.consoleName,price.pricechartingId].join(' ')).split(' ').filter(Boolean))].slice(0,40);}

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
    const activeManifestVersion=active?.manifestVersion||active?.catalogVersion||'';
    if(!force && activeManifestVersion===manifest.version && active?.manifestSha===manifest.files?.cards?.sha256 && active?.searchIndexVersion===SEARCH_INDEX_VERSION) return {updated:false,manifest,status:await status()};
    const target=`${manifest.version}::${String(manifest.files?.cards?.sha256||Date.now()).slice(0,12)}${force?'::'+Date.now():''}`;
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
      await putMeta({name:'active',catalogVersion:target,manifestVersion:manifest.version,pricesVersion:manifest.version,manifestSha:manifest.files.cards.sha256,lastImportedAt:importedAt,importStatus:'ready',counts,generatedAt:manifest.generatedAt,sourceVersions:manifest.sourceVersions||{},searchIndexVersion:SEARCH_INDEX_VERSION});
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
    const tcgplayerId=(raw.match(/tcgplayer\.com\/product\/(\d{4,})/i)||raw.trim().match(/^(\d{4,})$/)||[])[1]||'';
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
    return {raw,artist:normalize(artist),set:normalize(set),collector:normalize(collector),tcgplayerId,tokens:clean.split(' ').filter(Boolean),clean};
  }

  function scoreCard(card,parts){
    if(parts.tcgplayerId&&String(card.tcgplayerId||'')===parts.tcgplayerId)return {score:1000,why:['exact TCGplayer product ID']};
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

  async function tokenCardIds(db,version,tokens,max=900){
    const ordered=[...new Set(tokens)].sort((a,b)=>b.length-a.length),sets=[];
    for(const token of ordered.slice(0,4)){
      const store=db.transaction('mtg_search_tokens','readonly').objectStore('mtg_search_tokens');
      const range=IDBKeyRange.bound([version,token,''],[version,token,'\uffff']);
      const keys=await requestPromise(store.getAllKeys(range,max));
      sets.push(new Set(keys.map(key=>String(key[2]))));
      if(!keys.length)return[];
    }
    return sets.length?[...sets[0]].filter(id=>sets.every(set=>set.has(id))).slice(0,max):[];
  }

  async function indexedCardCandidates(db,version,parts){
    const cards=new Map(),add=rows=>(rows||[]).forEach(card=>cards.set(String(card.scryfallId),card));
    if(parts.clean){
      let store=db.transaction('mtg_cards','readonly').objectStore('mtg_cards');
      add(await requestPromise(store.index('catalogName').getAll([version,parts.clean],100)).catch(()=>[]));
      store=db.transaction('mtg_cards','readonly').objectStore('mtg_cards');
      add(await requestPromise(store.index('catalogName').getAll(IDBKeyRange.bound([version,parts.clean],[version,parts.clean+'\uffff']),250)).catch(()=>[]));
    }
    if(parts.collector){const store=db.transaction('mtg_cards','readonly').objectStore('mtg_cards');add(await requestPromise(store.index('catalogCollector').getAll([version,parts.collector],250)).catch(()=>[]));}
    const exactId=parts.tcgplayerId||'';
    if(exactId){const store=db.transaction('mtg_cards','readonly').objectStore('mtg_cards');add(await requestPromise(store.index('catalogTcgplayer').getAll([version,exactId],20)).catch(()=>[]));}
    if(parts.set){const store=db.transaction('mtg_cards','readonly').objectStore('mtg_cards');add(await requestPromise(store.index('catalogSet').getAll([version,parts.set],500)).catch(()=>[]));}
    if(parts.artist){
      const store=db.transaction('mtg_cards','readonly').objectStore('mtg_cards'),range=IDBKeyRange.bound([version,parts.artist],[version,parts.artist+'\uffff']);
      add(await requestPromise(store.index('catalogArtist').getAll(range,500)).catch(()=>[]));
    }
    const ids=await tokenCardIds(db,version,parts.tokens);
    const cardTx=db.transaction('mtg_cards','readonly'),cardStore=cardTx.objectStore('mtg_cards');
    const rows=await Promise.all(ids.map(id=>requestPromise(cardStore.get([version,id]))));
    add(rows.filter(Boolean));return [...cards.values()];
  }

  async function attachPrices(version,ranked){
    const db=await openDb();
    const linkTx=db.transaction('mtg_price_links','readonly'),linkStore=linkTx.objectStore('mtg_price_links');
    const links=await Promise.all(ranked.map(item=>requestPromise(linkStore.get([version,item.card.scryfallId]))));
    const priceTx=db.transaction('mtg_prices','readonly'),priceStore=priceTx.objectStore('mtg_prices');
    const prices=await Promise.all(links.map(link=>link?.pricechartingId?requestPromise(priceStore.get([version,link.pricechartingId])):null));
    return ranked.map((item,index)=>({...item.card,offlinePriceLink:links[index]||null,offlinePrice:prices[index]||null,offlineMatchWhy:item.why,catalogVersion:version}));
  }

  function priceScore(price,parts){
    const name=price.normalizedProductName||normalize(price.productName),tokens=parts.tokens.filter(token=>!['mtg','magic','sealed','product'].includes(token));
    const sealedTerms=/\b(secret lair|drop|box|bundle|display|case|pack|booster|deck|edition|foil|sealed)\b/;
    if(tokens.some(token=>!name.includes(token)) && normalize(price.pricechartingId)!==parts.clean)return null;
    let value=name===parts.clean?800:name.startsWith(parts.clean)?560:tokens.length*80;
    if(parts.clean&&name.includes(parts.clean))value+=300;
    if(sealedTerms.test(parts.clean)&&sealedTerms.test(name))value+=220;
    if(/\bfoil\b/.test(parts.clean)===/\bfoil\b/.test(name))value+=60;
    return value;
  }

  async function searchPrices(query,limit=20){
    const active=await getMeta('active'),version=active?.catalogVersion;if(!version)return[];
    const parts=queryParts(query),db=await openDb(),found=new Map(),add=rows=>(rows||[]).forEach(row=>found.set(String(row.pricechartingId),row));
    const clean=normalize(query);
    if(clean){
      let store=db.transaction('mtg_prices','readonly').objectStore('mtg_prices');
      add(await requestPromise(store.index('catalogPriceId').getAll([version,clean],20)).catch(()=>[]));
      store=db.transaction('mtg_prices','readonly').objectStore('mtg_prices');
      add(await requestPromise(store.index('catalogPriceName').getAll(IDBKeyRange.bound([version,clean],[version,clean+'\uffff']),200)).catch(()=>[]));
    }
    if(active.searchIndexVersion===SEARCH_INDEX_VERSION){
      const tokens=parts.tokens.filter(token=>!['mtg','magic','sealed','product'].includes(token)).sort((a,b)=>b.length-a.length).slice(0,4),sets=[];
      for(const token of tokens){const store=db.transaction('mtg_price_search_tokens','readonly').objectStore('mtg_price_search_tokens'),range=IDBKeyRange.bound([version,token,''],[version,token,'\uffff']);const keys=await requestPromise(store.getAllKeys(range,800));sets.push(new Set(keys.map(key=>String(key[2]))));if(!keys.length)break;}
      const ids=sets.length?[...sets[0]].filter(id=>sets.every(set=>set.has(id))).slice(0,800):[];
      const priceTx=db.transaction('mtg_prices','readonly'),priceStore=priceTx.objectStore('mtg_prices');
      const rows=await Promise.all(ids.map(id=>requestPromise(priceStore.get([version,id]))));add(rows.filter(Boolean));
    }
    return [...found.values()].map(price=>{const offlineScore=priceScore(price,parts);return offlineScore===null?null:{...price,offlineScore,catalogVersion:version};}).filter(Boolean).sort((a,b)=>b.offlineScore-a.offlineScore).slice(0,limit);
  }

  async function search(query,limit=20){
    const active=await getMeta('active'); if(!active?.catalogVersion) return [];
    const parts=queryParts(query); if(!parts.tokens.length&&!parts.artist&&!parts.set&&!parts.collector&&!parts.tcgplayerId) return [];
    const db=await openDb();
    const cards=active.searchIndexVersion===SEARCH_INDEX_VERSION
      ? await indexedCardCandidates(db,active.catalogVersion,parts)
      : await recordsForVersion('mtg_cards',active.catalogVersion,Math.max(limit*4,120),card=>scoreCard(card,parts)!==null);
    const ranked=cards.map(card=>{const scored=scoreCard(card,parts);return scored?{card,...scored}:null;}).filter(Boolean).sort((a,b)=>b.score-a.score).slice(0,limit);
    return attachPrices(active.catalogVersion,ranked);
  }

  async function sets(){ const active=await getMeta('active'); return (await recordsForVersion('mtg_sets',active?.catalogVersion)).sort((a,b)=>String(b.releasedAt||'').localeCompare(String(a.releasedAt||''))); }
  async function cardsBySet(setCode){
    const active=await getMeta('active'), version=active?.catalogVersion, wanted=normalize(setCode);
    if(!version || !wanted) return [];
    const db=await openDb(), store=db.transaction('mtg_cards','readonly').objectStore('mtg_cards');
    const cards=store.indexNames.contains('catalogSet')
      ? await requestPromise(store.index('catalogSet').getAll(IDBKeyRange.only([version,wanted])))
      : await recordsForVersion('mtg_cards',version,Infinity,card=>normalize(card.setCode)===wanted);
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
    return {catalogVersion:active?.manifestVersion||version,storageVersion:version,pricesVersion:active?.pricesVersion||'',lastImportedAt:active?.lastImportedAt||'',generatedAt:active?.generatedAt||'',sourceVersions:active?.sourceVersions||{},manifestSha:active?.manifestSha||'',importStatus:active?.importStatus||'not-downloaded',searchIndexReady:active?.searchIndexVersion===SEARCH_INDEX_VERSION,cards,sets:setsCount,prices,links,images};
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

  root.ArsCaMtgOffline={openDb,sync,search,searchPrices,sets,cardsBySet,status,clearAll,cacheImage,cachedImageUrl,clearImageCache,normalize,queryParts,DB_NAME};
})(typeof window!=='undefined'?window:globalThis);
