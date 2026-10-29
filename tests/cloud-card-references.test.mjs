import assert from 'node:assert/strict';
import {CardReferenceArchive,normalizeCloudReference,handleCloudReferenceRequest} from '../scripts/cloud-card-references.mjs';
import {sportsReferenceImage} from '../scripts/sports-reference-images.mjs';
import {dashboardCloudRequest,cloudRequest,uploadReferences,isDashboard} from '../extensions/pricecharting-collector/cloud.mjs';
const consoleId='baseball-cards-2026-topps',image='https://storage.googleapis.com/images.pricecharting.com/card123/240.jpg';
const card={consoleId,title:'Aaron Judge #1',cardNumber:'1',image,url:'https://www.sportscardspro.com/game/'+consoleId+'/aaron-judge-1',setName:'2026 Topps',player:'Aaron Judge'};
assert.ok(normalizeCloudReference(card));
const legacyJulio={...card,consoleId:'baseball-cards-2023-topps-cosmic-chrome-extraterrestrial-talent-autographs',player:'Julio Rodriguez',title:'Julio Rodriguez #ETA-Jr.',cardNumber:'ETA-Jr',url:'https://www.sportscardspro.com/game/baseball-cards-2023-topps-cosmic-chrome-extraterrestrial-talent-autographs/julio-rodriguez-eta-jr'};
assert.equal(normalizeCloudReference(legacyJulio).cardNumber,'ETA-Jr.','legacy capture recovers full title number without changing the publisher identity');
for(const wrong of ['ETA-J','ETA-JR','ETA-Jr..','ETA-1'])assert.equal(normalizeCloudReference({...legacyJulio,cardNumber:wrong}),null,'other number mismatches remain rejected');
const apostropheCard={...card,title:"Logan O'Hoppe #BSR-23",player:"Logan O'Hoppe",cardNumber:'BSR-23',consoleId:'baseball-cards-2023-bowman-sterling',url:'https://www.sportscardspro.com/game/baseball-cards-2023-bowman-sterling/logan-o%27hoppe-bsr-23'};
assert.ok(normalizeCloudReference(apostropheCard),'verified apostrophe in player URL is accepted');
assert.equal(normalizeCloudReference({...apostropheCard,url:apostropheCard.url.replace('%27',"'")}).url,apostropheCard.url,'literal and encoded apostrophes canonicalize identically');
for(const bad of ['%2f','%2527','%00','%3f'])assert.equal(normalizeCloudReference({...apostropheCard,url:apostropheCard.url.replace('%27',bad)}),null,'encoded separators and other escapes stay rejected');
for(const row of [{...card,url:'https://evil.test/game/'+consoleId+'/x'},{...card,image:'https://evil.test/a.jpg'},{...card,cardNumber:'2'},{...card,consoleId:'other'}])assert.equal(normalizeCloudReference(row),null);
assert.equal(normalizeCloudReference({...card,image:''}).image,'','missing images retain identities');
function storage(){let values=new Map(),queue=Promise.resolve();return {delete:async k=>values.delete(k),setAlarm:async()=>{},get:async k=>structuredClone(values.get(k)),put:async(k,v)=>values.set(k,structuredClone(v)),list:async({prefix,limit,startAfter=''})=>new Map([...values].filter(([k])=>k.startsWith(prefix)&&k>startAfter).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit)),transaction(callback){const run=queue.then(async()=>{const copy=new Map(values),tx={get:async k=>structuredClone(copy.get(k)),put:async(k,v)=>copy.set(k,structuredClone(v)),delete:async k=>copy.delete(k)};const result=await callback(tx);values=copy;return result;});queue=run.catch(()=>{});return run;}};}
const instances=new Map();const binding={idFromName:id=>id,get:id=>{if(!instances.has(id))instances.set(id,new CardReferenceArchive({storage:storage()},{REFERENCE_IMAGE_FETCH:async()=>new Response(null,{headers:{'Content-Type':'image/jpeg'}})}));const object=instances.get(id);return {fetch:(input,options)=>object.fetch(new Request(input,options))};}};
const env={CARD_REFERENCE_ARCHIVE:binding},deps={storeId:'mana',json:(body,status=200,headers={})=>Response.json(body,{status,headers}),readJsonWithLimit:async r=>({data:await r.json()}),requireStoreUser:async(r,e,id,roles)=>r.headers.get('Authorization')==='Bearer owner'&&roles.join(',')==='owner,admin'?{}:{error:new Response('Denied',{status:403})}};
const send=(cards,auth='owner')=>{const url=new URL('https://worker.example/reference-collector/batch');return handleCloudReferenceRequest(new Request(url,{method:'POST',headers:{Authorization:'Bearer '+auth},body:JSON.stringify({cards})}),env,url,deps);};
assert.equal((await send([card],'shopper')).status,403);
assert.equal(instances.size,0,'unauthorized calls never touch reference storage');
let result=await(await send([card])).json();assert.equal(result.summary.cards,1);assert.equal(result.summary.photos,1);
await Promise.all(Array.from({length:10},()=>send([card])));
result=await(await send([{...card,image:''}])).json();assert.equal(result.summary.cards,1);assert.equal(result.summary.photos,1,'retry or missing-photo capture does not erase a good reference');
const set={id:'2026-topps-series-1-baseball',displayName:'2026 Topps Series 1 Baseball',sport:'baseball',year:2026};
assert.equal((await sportsReferenceImage(env,{},set,{player:'Aaron Judge',cardNumber:'1',section:'Base'}))?.image,null,'unchecked image URLs stay hidden');
await instances.get('console:'+consoleId).alarm();
let found=await sportsReferenceImage(env,{},set,{player:'Aaron Judge',cardNumber:'1',section:'Base'});
assert.equal(found.image,image,'website reads the uploaded cloud reference through the verified flagship alias');
assert.equal(found.referenceOnly,true);
const priced={...card,capturedAt:new Date().toISOString(),referencePrices:{currency:'USD',ungraded:7.5,grade9:25,psa10:80}};
assert.equal(normalizeCloudReference({...priced,referencePrices:{currency:'USD',ungraded:0,psa10:Infinity}}).referencePrices,undefined);
assert.equal(normalizeCloudReference({...priced,referencePrices:{currency:'CAD',ungraded:7.5}}).referencePrices,undefined);
await send([priced]);await instances.get('console:'+consoleId).alarm();
assert.equal((await sportsReferenceImage(env,{},set,{player:'Aaron Judge',cardNumber:'1',section:'Base'})).referencePrices.ungraded,7.5);
await send([{...priced,capturedAt:new Date(Date.now()-86400000).toISOString(),referencePrices:{currency:'USD',ungraded:1}}]);await instances.get('console:'+consoleId).alarm();
assert.equal((await sportsReferenceImage(env,{},set,{player:'Aaron Judge',cardNumber:'1',section:'Base'})).referencePrices.ungraded,7.5,'an older replay cannot overwrite a newer estimate');
await send([card]);await instances.get('console:'+consoleId).alarm();
assert.equal((await sportsReferenceImage(env,{},set,{player:'Aaron Judge',cardNumber:'1',section:'Base'})).referencePrices.ungraded,7.5,'old extension batches preserve valid estimates for the same identity');
const held=await instances.get('console:'+consoleId).fetch(new Request('https://archive.internal/hold',{method:'POST',body:JSON.stringify({url:card.url,reason:'Redemption notice instead of card artwork'})}));
assert.equal(held.status,200);
const heldMetadata=await sportsReferenceImage(env,{},set,{player:'Aaron Judge',cardNumber:'1',section:'Base'});
assert.equal(heldMetadata.url,card.url,'held artwork does not hide the exact source link');
assert.equal(heldMetadata.referencePrices.ungraded,7.5,'held artwork does not hide the estimate');
assert.equal(heldMetadata.image,null,'held artwork still cannot be displayed');

const numberDiagnostics=await(await instances.get('console:'+consoleId).fetch(new Request('https://archive.internal/samples?number=1'))).json();
assert.equal(numberDiagnostics.exactNumber,'1');
assert.equal(numberDiagnostics.samples.length,1);
assert.equal(numberDiagnostics.samples[0].hold.reason,'Redemption notice instead of card artwork','diagnostics preserve holds');
assert.equal(numberDiagnostics.samples[0].photoUsageCount,1);
assert.equal((await instances.get('console:'+consoleId).fetch(new Request('https://archive.internal/samples?number=a%2Fb'))).status,400);
assert.equal((await sportsReferenceImage(env,{},set,{player:'Aaron Judge',cardNumber:'1',section:'Base'}))?.image,null,'a manual image hold overrides otherwise eligible metadata and URL health');
let legacyReads=0;const legacyEnv={...env,LBA_KV:{get:async()=>{legacyReads++;return null;}}};
assert.equal((await sportsReferenceImage(legacyEnv,{},set,{player:'Aaron Judge',cardNumber:'1',section:'Base'}))?.image,null);
assert.equal(legacyReads,0,'legacy reference cache cannot bypass a cloud image hold');
assert.equal(await sportsReferenceImage(env,{},set,{player:'Different Player',cardNumber:'1',section:'Base'}),null,'same number never substitutes another player');
const gold={...card,title:'Aaron Judge [Gold Holo Foil] #1',parallel:'Gold Holo Foil',run:'/50',url:card.url+'-gold',image:image.replace('card123','gold123')};
await send([gold]);await instances.get('console:'+consoleId).alarm();
found=await sportsReferenceImage(env,{},set,{player:'Aaron Judge',cardNumber:'1',section:'Base',parallelRule:{name:'Gold Holo Foil',printRun:50}});assert.equal(found.image,gold.image);
assert.equal(await sportsReferenceImage(env,{},set,{player:'Aaron Judge',cardNumber:'1',section:'Base',parallelRule:{name:'Gold Holo Foil',printRun:25}}),null,'numbered runs must agree');
await send([{...gold,image}]);
assert.equal((await sportsReferenceImage(env,{},set,{player:'Aaron Judge',cardNumber:'1',section:'Base',parallelRule:{name:'Gold Holo Foil',printRun:50}}))?.image,null,'a reused base photo is not a gold reference');
const get=path=>{const url=new URL('https://worker.example/reference-collector/'+path);return handleCloudReferenceRequest(new Request(url,{headers:{Authorization:'Bearer owner'}}),env,url,deps);};
assert.equal((await(await get('sets')).json()).sets.length,1);
assert.equal((await(await get('cards?console='+consoleId)).json()).cards.length,2);
assert.equal((await get('cards?console='+consoleId+'&cursor=../private')).status,400);
const audit=instances.get('console:'+consoleId);await audit.fetch(new Request('https://archive.internal/audit-start',{method:'POST'}));
let auditState;for(let n=0;n<10;n++){await audit.alarm();auditState=await(await audit.fetch(new Request('https://archive.internal/audit-status'))).json();if(!auditState.running)break;}
assert.equal(auditState.phase,'complete');assert.equal(auditState.records,2);assert.equal(auditState.duplicateImages,1);assert.equal(auditState.eligible,0);assert.equal(auditState.held,2,'shared images remain held after archive-wide checks');
// An image request can yield while an owner starts a newer audit.
const raceStorage=storage();let releaseImage,imageStarted;
const imageWaiting=new Promise(resolve=>imageStarted=resolve),imageRelease=new Promise(resolve=>releaseImage=resolve);
const racing=new CardReferenceArchive({storage:raceStorage},{REFERENCE_IMAGE_FETCH:async()=>{imageStarted();await imageRelease;return new Response(null,{headers:{'Content-Type':'image/jpeg'}});}});
await raceStorage.put('audit',{running:true,phase:'images',startedAt:1,version:'old',imagesChecked:0,imagesOk:0,imagesFailed:0,duplicateImages:0});
await raceStorage.put('image:card123',{image});await raceStorage.put('usage:card123:judge',{title:card.title,url:card.url});
const oldBatch=racing.alarm();await imageWaiting;
await raceStorage.put('audit',{running:true,phase:'metadata',startedAt:2,version:'new',records:0});releaseImage();await oldBatch;
assert.equal((await raceStorage.get('audit')).startedAt,2,'an old in-flight batch never overwrites a newer audit generation');
// Simulate the extension bridge: the dashboard executes only the scoped
// reference request and returns data, never an auth token.
const local={},calls=[];let offline=false;
const chrome={storage:{local:{get:async key=>({[key]:local[key]}),set:async data=>Object.assign(local,structuredClone(data)),remove:async key=>{delete local[key];}}},tabs:{get:async()=>({id:7,url:'https://squeebmike.github.io/ArSca/dashboard.html'}),query:async()=>[{id:7,url:'https://squeebmike.github.io/ArSca/dashboard.html'}]},scripting:{executeScript:async options=>{calls.push(options);if(offline)throw Error('Network interrupted');return [{result:{status:200,data:{ok:true,rejected:0,summary:{consoleId,cards:1,photos:1}}}}];}}};
await uploadReferences(chrome,[card]);assert.ok(!local.pendingCloudBatch);assert.equal(local.cloudConnection.tabId,7);assert.ok(!JSON.stringify(local).includes('Bearer'));
assert.equal(calls[0].world,'MAIN');assert.equal(calls[0].args[0],'/reference-collector/batch');
offline=true;await assert.rejects(uploadReferences(chrome,[card]),/Network interrupted/);assert.equal(local.pendingCloudBatch.length,1,'failed cloud request retains exactly the pending metadata batch');
offline=false;await uploadReferences(chrome,local.pendingCloudBatch);assert.ok(!local.pendingCloudBatch,'acknowledgement clears the outbox');
assert.ok(!isDashboard('https://squeebmike.github.io/Other/dashboard.html'));assert.ok(!isDashboard('https://evil.test/ArSca/dashboard.html'));
const oldLocation=globalThis.location;globalThis.location={origin:'https://squeebmike.github.io',pathname:'/ArSca/dashboard.html'};
await assert.rejects(dashboardCloudRequest('/kv/private','GET'),/Invalid cloud/);globalThis.location=oldLocation;
{
 const source='baseball-cards-2026-topps-five-star',sample={consoleId:source,productId:'14946125',title:'Shohei Ohtani #1',player:'Shohei Ohtani',cardNumber:'1',parallel:'',run:'/50',image:'',url:'https://www.sportscardspro.com/game/'+source+'/shohei-ohtani-1'};
 await send([sample]);const object=instances.get('console:'+source),key='validation:shohei-ohtani-1';
 await object.ctx.storage.put(key,{version:'2026-10-25.2',mappingVersion:'2026-10-29.2-big-league-inserts',flags:['missing_photo','unmapped_source_set'],matches:[]});
 const {fiveStar2026Sets}=await import('../scripts/topps/five-star-2026.mjs'),release=fiveStar2026Sets[0];
 const found=await sportsReferenceImage(env,{},release,release.cards[0],{archiveOnly:true,priceRefresh:false});
 assert.equal(found?.url,sample.url,'newly published numbered base identity reuses previously collected metadata');assert.equal(found.image,null,'missing provider photo remains missing');assert.equal(found.productId,'14946125');assert.equal(found.referencePrices,undefined,'blank source price is not invented');
 assert.equal((await object.ctx.storage.get(key)).metadataMatched,true,'stale unmapped validation is repaired from publisher metadata');
 const {referenceIdentityMatches}=await import('../scripts/reference-match.mjs');
 for(const run of ['/51','/100','/-50',''])assert.equal(referenceIdentityMatches({...sample,run},release.cards[0],release),false,'unverified base numbering rejected');
 assert.equal(referenceIdentityMatches({...sample,title:'Shohei Ohtani [Amber] #1',run:'/25'},release.cards[0],release),false,'numbered base does not absorb a named parallel');
}
{
 const source='baseball-cards-2024-bowman-chrome-prospects',sample={consoleId:source,title:'Abimelec Ortiz #BCP-16',player:'Abimelec Ortiz',cardNumber:'BCP-16',parallel:'',run:'',image:'https://storage.googleapis.com/images.pricecharting.com/corrwxltjzov7mgb3xls/240.jpg',url:'https://www.sportscardspro.com/game/'+source+'/abimelec-ortiz-bcp-16',capturedAt:new Date().toISOString(),referencePrices:{currency:'USD',ungraded:1.23}};
 await send([sample]);const object=instances.get('console:'+source);await object.alarm();
 const key='validation:abimelec-ortiz-bcp-16';await object.ctx.storage.put(key,{version:'2026-10-25.2',flags:['unmapped_source_set'],matches:[]});
 let external=0;object.env.REFERENCE_IMAGE_FETCH=async()=>{external++;throw Error('No external refresh allowed');};
 const {baseballSets}=await import('../scripts/topps/baseball-seed.mjs'),{sectionsForSet}=await import('../scripts/baseball-section-pages.mjs');
 const release=baseballSets.find(s=>s.id==='2024-bowman-baseball'),subject=sectionsForSet(release).flatMap(g=>g.cards).find(c=>c.cardNumber==='BCP-16');
 const fixed=await sportsReferenceImage(env,{},release,subject);assert.equal(fixed.image,sample.image);assert.equal(fixed.referencePrices.ungraded,1.23);
 assert.ok((await object.ctx.storage.get(key)).mappingVersion);assert.equal(external,0,'lazy mapping repair makes no source/image network calls');
 await object.fetch(new Request('https://archive.internal/hold',{method:'POST',body:JSON.stringify({url:sample.url,reason:'Photo needs review'})}));
 await object.ctx.storage.put(key,{version:'2026-10-25.2',flags:['unmapped_source_set'],matches:[]});
 assert.equal((await sportsReferenceImage(env,{},release,subject))?.image,null,'mapping repair never bypasses an owner photo hold');
}
{
 const sample={...card,title:'American League Leaders HRs #38',player:'American League Leaders HRs',cardNumber:'38',image:'https://storage.googleapis.com/images.pricecharting.com/leaders38/240.jpg',url:'https://www.sportscardspro.com/game/'+consoleId+'/american-league-leaders-hrs-38'};
 await send([sample]);const object=instances.get('console:'+consoleId);await object.alarm();
 const key='validation:american-league-leaders-hrs-38';await object.ctx.storage.put(key,{version:'2026-10-25.2',mappingVersion:'older',flags:['no_exact_checklist_match'],matches:[]});
 const {baseballSets}=await import('../scripts/topps/baseball-seed.mjs'),release=baseballSets.find(s=>s.id==='2026-topps-series-1-baseball'),subject=release.cards.find(c=>c.cardNumber==='38');
 assert.equal((await sportsReferenceImage(env,{},release,subject)).image,sample.image,'existing caption mismatch repairs from stored cloud data without re-collection');
 await object.fetch(new Request('https://archive.internal/hold',{method:'POST',body:JSON.stringify({url:sample.url,reason:'Review requested'})}));
 assert.equal((await sportsReferenceImage(env,{},release,subject))?.image,null,'caption repair preserves owner holds');
}
{
 const bestId='baseball-cards-2023-bowman%27s-best',best={...card,consoleId:bestId,title:'Taj Bradley #1',player:'Taj Bradley',image:'https://storage.googleapis.com/images.pricecharting.com/best1/240.jpg',url:'https://www.sportscardspro.com/game/'+bestId+'/taj-bradley-1'};
 assert.ok(normalizeCloudReference(best));assert.equal(normalizeCloudReference({...best,consoleId:bestId.replace('%27','%2f'),url:best.url.replace('%27','%2f')}),null,'encoded separators never become source IDs');
 await send([best]);await instances.get('console:'+bestId).alarm();
 const {baseballSets}=await import('../scripts/topps/baseball-seed.mjs'),bestSet=baseballSets.find(s=>s.id==='2023-bowman-s-best-baseball');
 assert.equal((await sportsReferenceImage(env,{},bestSet,bestSet.cards[0])).image,best.image,'encoded source survives cloud upload and exact website lookup');
 const bestUrl=new URL('https://worker.example/reference-collector/cards?console='+encodeURIComponent(bestId));const bestResponse=await handleCloudReferenceRequest(new Request(bestUrl,{headers:{Authorization:'Bearer owner'}}),env,bestUrl,deps);assert.equal(bestResponse.status,200);assert.equal((await bestResponse.json()).cards[0].consoleId,bestId);
 const catalog=binding.get('catalog');for(let n=0;n<23;n++)await catalog.fetch('https://archive.internal/summary',{method:'POST',body:JSON.stringify({consoleId:'fixture-source-'+n,name:'Fixture',cards:0,photos:0,updatedAt:Date.now()})});
 async function status(query=''){const url=new URL('https://worker.example/reference-collector/audit/status'+query);return handleCloudReferenceRequest(new Request(url,{headers:{Authorization:'Bearer owner'}}),env,url,deps);}
 const first=await(await status()).json();assert.equal(first.sets.length,20);assert.equal(first.nextOffset,20);assert.ok(first.total>20);
 const second=await(await status('?offset=20')).json();assert.equal(second.nextOffset,null);assert.equal(first.sets.length+second.sets.length,first.total);
 assert.equal(new Set([...first.sets,...second.sets].map(s=>s.consoleId)).size,first.total,'all source audit results are reachable once without duplicates');
 assert.equal((await status('?offset=-1')).status,400);
}
{
 const first=await(await send([apostropheCard])).json();assert.equal(first.accepted,1);assert.equal(first.rejected,0,'apostrophe no longer blocks acknowledgement');
 const replay=await(await send([apostropheCard])).json();assert.equal(replay.summary.cards,first.summary.cards,'retrying a previously partial batch remains idempotent');
 const archive=instances.get('console:'+apostropheCard.consoleId),slug=new URL(apostropheCard.url).pathname.split('/').pop();
 const page=await archive.fetch(new Request('https://archive.internal/cards?cursor='+encodeURIComponent('row:'+slug)));assert.equal(page.status,200,'encoded apostrophe is a valid paging cursor');
 const bad=await archive.fetch(new Request('https://archive.internal/cards?cursor='+encodeURIComponent('row:logan%2fhoppe')));assert.equal(bad.status,400);
}
{
 const captured={...legacyJulio,capturedAt:new Date().toISOString(),referencePrices:{currency:'USD',ungraded:129.99}},receipt=await(await send([captured])).json();
 assert.equal(receipt.rejected,0);await instances.get('console:'+captured.consoleId).alarm();
 const {baseballSets}=await import('../scripts/topps/baseball-seed.mjs'),{sectionsForSet}=await import('../scripts/baseball-section-pages.mjs'),release=baseballSets.find(s=>s.id==='2023-topps-cosmic-chrome-baseball'),subject=sectionsForSet(release).flatMap(g=>g.cards).find(c=>c.cardNumber==='ETA-Jr.');
 const reference=await sportsReferenceImage(env,{},release,subject);assert.equal(reference.image,image);assert.equal(reference.cardNumber,'ETA-Jr.');assert.equal(reference.referencePrices.ungraded,129.99,'corrected number supports the same exact website family and price');
 const replay=await(await send([captured])).json();assert.equal(replay.summary.cards,receipt.summary.cards,'preserved batch retries cannot duplicate the recovered row');
}
{
 // A completed audit can leave transient flags inside its saved validation.
 // Family reads validate identity separately and apply current image gates.
 const {referenceMetadataCheck,referenceImageKey}=await import('../scripts/reference-validation.mjs'),store=storage();let external=0;
 const object=new CardReferenceArchive({storage:store},{REFERENCE_IMAGE_FETCH:async()=>{external++;throw Error('Read must not refresh images');}});
 const exact=normalizeCloudReference({...priced,productId:'123'}),slug='aaron-judge-1',imageId=referenceImageKey(exact.image),check=referenceMetadataCheck(exact);
 assert.equal(check.matches.length,1);
 await store.put('meta',{consoleId,cards:1,photos:1});await store.put('row:'+slug,exact);await store.put('family:1:'+slug,exact);
 await store.put('validation:'+slug,{...check,flags:['image_http_403','manual_image_hold','shared_image_requires_review']});
 await store.put('health:'+imageId,{ok:true,checkedAt:Date.now()});await store.put('usage:'+imageId+':'+slug,{url:exact.url,title:exact.title});
 const family=async()=>{const response=await object.fetch(new Request('https://archive.internal/family?number=1&metadata=1'));return (await response.json()).cards;};
 let current=await family();assert.equal(current.length,1);assert.equal(current[0].image,exact.image,'historical image failure cannot hide a currently healthy, unique, unheld exact photo');assert.equal(current[0].url,exact.url);assert.equal(current[0].referencePrices.ungraded,7.5);
 // Even if a later audit rewrites its flags, the metadata cache remains clean.
 await store.put('validation:'+slug,{...check,flags:['image_request_failed']});
 current=await family();assert.equal(current[0].image,exact.image);
 await store.put('health:'+imageId,{ok:false,reason:'image_http_403',checkedAt:Date.now()});current=await family();assert.equal(current[0].image,null);assert.equal(current[0].url,exact.url);assert.equal(current[0].referencePrices.ungraded,7.5,'current health failure hides artwork, not exact source prices');
 await store.put('health:'+imageId,{ok:true,checkedAt:Date.now()-8*86400000});assert.equal((await family())[0].image,null,'stale live health is still blocked');
 await store.put('health:'+imageId,{ok:true,checkedAt:Date.now()});await store.put('hold:'+imageId,{reason:'Current owner hold'});current=await family();assert.equal(current[0].image,null);assert.equal(current[0].url,exact.url);
 await store.delete('hold:'+imageId);await store.put('usage:'+imageId+':other',{url:'other',title:'Other #2'});current=await family();assert.equal(current[0].image,null);assert.equal(current[0].referencePrices.ungraded,7.5);
 await store.delete('usage:'+imageId+':other');assert.equal((await family())[0].image,exact.image);
 for(const changed of [{player:'Shohei Ohtani'},{cardNumber:'2'},{parallel:'Gold Holo Foil'},{title:'Different Player #1'}]){
  await store.put('family:1:'+slug,{...exact,...changed});assert.deepEqual(await family(),[],'current identity conflicts remain rejected and invalidate the cached metadata fingerprint');
 }
 await store.put('family:1:'+slug,exact);assert.equal((await family())[0].image,exact.image);assert.equal(external,0,'metadata repair uses stored rows only, without a source/image/API fetch');
}
console.log('Cloud references: owner-only writes, idempotent batches, persistent source photos, exact website matching, lazy source repair, current image gates independent of metadata, holds, paginated audit status, cloud bridge and interrupted-upload recovery passed');


{
 const {quarantineCloudReference}=await import('../scripts/cloud-card-references.mjs');
 const malformed={...card,title:'Wilson Contreras #F)-15',player:'Wilson Contreras',cardNumber:'F',url:card.url.replace(/[^/]+$/,'wilson-contreras-f-15')};
 assert.equal(normalizeCloudReference(malformed),null);
 assert.equal(quarantineCloudReference(malformed).cardNumber,'F)-15');
 assert.equal(quarantineCloudReference({...malformed,url:'https://evil.example/game/'+consoleId+'/fake'}),null);
 const receipt=await(await send([malformed])).json();assert.equal(receipt.accepted,0);assert.equal(receipt.quarantined,1);assert.equal(receipt.rejected,0,'stored exception is accounted for without publishing an identity');
 const archive=instances.get('console:'+consoleId);const page=await(await archive.fetch(new Request('https://archive.internal/cards'))).json();assert.ok(page.quarantined.some(r=>r.title===malformed.title));
 assert.ok(!page.cards.some(r=>r.url===malformed.url));
 const family=await(await archive.fetch(new Request('https://archive.internal/family?number=F'))).json();assert.ok(!family.cards.some(r=>r.url===malformed.url));
 const replay=await(await send([malformed])).json();assert.equal(replay.summary.quarantined,receipt.summary.quarantined,'quarantine replay does not inflate counts');
}
