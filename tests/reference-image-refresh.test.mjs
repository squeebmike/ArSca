import assert from 'node:assert/strict';
import {CardReferenceArchive,normalizeCloudReference} from '../scripts/cloud-card-references.mjs';
import {sportsReferenceImage} from '../scripts/sports-reference-images.mjs';
import {handleBaseballCatalog} from '../scripts/baseball-catalog-pages.mjs';
import {referenceImageKey} from '../scripts/reference-validation.mjs';
import {IMAGE_REFRESH_COORDINATOR,parseImageRefreshFamily,queueViewedReferenceImage,sameImageReference} from '../scripts/reference-image-refresh.mjs';
const originalNow=Date.now;let now=1800000000000;Date.now=()=>now;
function storage(){let values=new Map(),tail=Promise.resolve(),alarm=null;const list=(map,{prefix,limit=1000})=>new Map([...map].filter(([k])=>k.startsWith(prefix)).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit));return {get:async k=>structuredClone(values.get(k)),put:async(k,v)=>values.set(k,structuredClone(v)),delete:async k=>values.delete(k),list:async opts=>list(values,opts),getAlarm:async()=>alarm,setAlarm:async t=>alarm=t,transaction(fn){const result=tail.then(async()=>{const copy=new Map(values),value=await fn({get:async k=>structuredClone(copy.get(k)),put:async(k,v)=>copy.set(k,structuredClone(v)),delete:async k=>copy.delete(k),list:async opts=>list(copy,opts)});values=copy;return value;});tail=result.catch(()=>{});return result;}};}
const consoleId='baseball-cards-2026-topps',photo='https://storage.googleapis.com/images.pricecharting.com/newphoto/240.jpg';
const row={consoleId,productId:'123',title:'Aaron Judge #1',cardNumber:'1',parallel:'',run:'',image:'',url:'https://www.sportscardspro.com/game/'+consoleId+'/aaron-judge-1'};
const html=(r,image='')=>`<table><tr id="product-${r.productId}"><td class="title"><a href="${r.url}">${r.title}</a>${r.run?`<span class="list-print-run">${r.run}</span>`:''}</td><td><img src="${image||'/images/no-photo.png'}"></td></tr></table>`;
let source=html(row,photo),fetches=[],healthOk=true;
const objects=new Map(),env={REFERENCE_IMAGE_REFRESH_ENABLED:'1',REFERENCE_METADATA_FETCH:async (url,options)=>{assert.equal(options.redirect,'manual','source redirects are observed without following them');fetches.push({at:now,url:String(url)});if(source instanceof Error)throw source;return source instanceof Response?source:new Response(source,{headers:{'Content-Type':'text/html'}});},REFERENCE_IMAGE_FETCH:async()=>healthOk?new Response(null,{headers:{'Content-Type':'image/jpeg'}}):new Response(null,{status:404})};
env.CARD_REFERENCE_ARCHIVE={idFromName:id=>id,get:id=>{if(!objects.has(id)){const store=storage();let tail=Promise.resolve();objects.set(id,new CardReferenceArchive({storage:store,blockConcurrencyWhile(fn){const result=tail.then(fn);tail=result.catch(()=>{});return result;}},env));}return {fetch:(request,options)=>objects.get(id).fetch(new Request(request,options))};}};
const archive=()=>{env.CARD_REFERENCE_ARCHIVE.get('console:'+consoleId);return objects.get('console:'+consoleId);};
const coordinator=()=>objects.get(IMAGE_REFRESH_COORDINATOR);
const stored=()=>archive().ctx.storage.get('row:aaron-judge-1');
const post=(path,data)=>archive().fetch(new Request('https://archive.internal/'+path,{method:'POST',body:JSON.stringify(data)}));
const set={id:'2026-topps-series-1-baseball',displayName:'2026 Topps Series 1 Baseball',sport:'baseball',year:2026},card={player:'Aaron Judge',cardNumber:'1',section:'Base'};
try{
 assert.equal(parseImageRefreshFamily(html(row),consoleId)[0].image,'','placeholder captures exact metadata for negative TTL');
 assert.equal(parseImageRefreshFamily(html({...row,productId:'124'}),consoleId)[0].productId,'124');
 assert.throws(()=>parseImageRefreshFamily('Just a moment: verify you are human',consoleId),error=>error.status===403,'challenge responses request the persistent host pause');
 const stitches={consoleId:'baseball-cards-2026-topps-five-star-stars-&-stitches-autograph',productId:'14948731',title:'Byron Buxton #SS-BB',cardNumber:'SS-BB',parallel:'',run:'/25',image:'',url:'https://www.sportscardspro.com/game/baseball-cards-2026-topps-five-star-stars-&-stitches-autograph/byron-buxton-ss-bb'};
 assert.ok(sameImageReference(parseImageRefreshFamily(html(stitches),stitches.consoleId)[0],normalizeCloudReference(stitches)),'observed literal ampersand identity round-trips through the real archive normalizer');
 const gold={...row,productId:'124',title:'Aaron Judge [Gold Holo Foil] #1',parallel:'Gold Holo Foil',run:'/50',url:row.url+'-gold'};
 assert.ok(sameImageReference(parseImageRefreshFamily(html(gold),consoleId)[0],normalizeCloudReference(gold)),'collected bracket finish and run match archive fields');
 await post('batch',{cards:[row]});await archive().alarm();
 // A production audit and grid preview never even contact the coordinator.
 await sportsReferenceImage(env,{},set,card,{priceRefresh:false,requireArchiveRead:true});await sportsReferenceImage(env,{},set,card,{archiveOnly:true});assert.equal(coordinator(),undefined);assert.equal(fetches.length,0);
 await Promise.all(Array.from({length:30},()=>sportsReferenceImage(env,{},set,card)));assert.equal((await coordinator().ctx.storage.list({prefix:'im-demand:'})).size,1);assert.equal(fetches.length,0,'page views enqueue without source fetch');
 await coordinator().alarm();assert.equal(fetches.length,1);assert.equal(new URL(fetches[0].url).searchParams.get('model-number'),'1');assert.equal((await stored()).image,photo);assert.equal((await sportsReferenceImage(env,{},set,card)).image,photo,'healthy exact image becomes visible through existing archive gates');
 assert.equal((await coordinator().ctx.storage.list({prefix:'im-demand:'})).size,0);await coordinator().alarm();assert.equal(fetches.length,1,'fresh and empty queues do not scan');
 // New source placeholders retain a prior photo and prices.
 const previous=await stored();previous.referencePrices={ungraded:9,currency:'USD'};await archive().ctx.storage.put('row:aaron-judge-1',previous);
 now+=7*86400000+1;source=html(row);await queueViewedReferenceImage(env,previous);await coordinator().alarm();assert.equal((await stored()).image,photo);assert.equal((await stored()).referencePrices.ungraded,9);
 // Health failure cannot replace an old image or mark refresh successful.
 now+=7*86400000+1;source=html(row,photo.replace('newphoto','badphoto'));healthOk=false;await queueViewedReferenceImage(env,await stored());await coordinator().alarm();assert.equal((await stored()).image,photo);assert.equal((await coordinator().ctx.storage.list({prefix:'im-demand:'})).size,1);healthOk=true;
 // A later owner hold cancels pending work and cannot be escaped by a new URL.
 await post('hold',{url:row.url,reason:'Owner review'});now+=60001;const beforeHold=fetches.length;await coordinator().alarm();assert.equal(fetches.length,beforeHold);assert.equal((await stored()).image,photo);
 const heldResult=await post('image-refresh-apply',{expected:await stored(),observed:{...row,image:photo.replace('newphoto','replacement')}});assert.equal((await heldResult.json()).applied,false);
 await archive().ctx.storage.delete('hold:'+referenceImageKey(photo));
 // The apply endpoint compares identity and old image atomically.
 const snapshot=await stored();await archive().ctx.storage.put('row:aaron-judge-1',{...snapshot,run:'/50'});
 assert.equal((await(await post('image-refresh-apply',{expected:snapshot,observed:{...row,image:photo.replace('newphoto','replacement')}})).json()).applied,false);await archive().ctx.storage.put('row:aaron-judge-1',snapshot);
 const duplicate=photo.replace('newphoto','duplicate');await archive().ctx.storage.put('usage:'+referenceImageKey(duplicate)+':other-card',{url:'other',title:'Other #2'});
 assert.equal((await(await post('image-refresh-apply',{expected:snapshot,observed:{...row,image:duplicate}})).json()).applied,false);assert.equal((await stored()).image,photo);
 // Wrong product/finish cannot become an image update; failures retain state.
 now+=7*86400000+1;source=html({...row,title:'Aaron Judge [Gold] #1'},photo);await queueViewedReferenceImage(env,snapshot);await coordinator().alarm();assert.equal((await stored()).image,photo);
 now+=60001;source=new Response('quota',{status:429});await coordinator().alarm();const pause=await coordinator().ctx.storage.get('im-paused');assert.ok(pause>=now+6*3600000);const calls=fetches.length;now+=60001;await coordinator().alarm();assert.equal(fetches.length,calls,'shared persistent pause survives another alarm');
 // Persistence: a reconstructed instance keeps the queued work and host pause.
 const oldCoordinator=coordinator();objects.set(IMAGE_REFRESH_COORDINATOR,new CardReferenceArchive(oldCoordinator.ctx,env));await coordinator().alarm();assert.equal(fetches.length,calls);
 env.REFERENCE_IMAGE_REFRESH_ENABLED='0';now=pause+1;await coordinator().alarm();assert.equal(fetches.length,calls,'disabling refresh stops persisted queued upstream work');assert.equal((await coordinator().ctx.storage.list({prefix:'im-demand:'})).size,1,'disabled work is preserved');env.REFERENCE_IMAGE_REFRESH_ENABLED='1';
 const disabled={...env,REFERENCE_IMAGE_REFRESH_ENABLED:'0'};assert.equal(await queueViewedReferenceImage(disabled,snapshot),snapshot);
 // A successful missing-photo check gets a daily negative TTL. Distinct viewed
 // products share the same persistent source gate, including across alarms.
 objects.clear();healthOk=true;source=html(row,photo)+html(gold,photo);await post('batch',{cards:[row]});await archive().alarm();await queueViewedReferenceImage(env,row);await coordinator().alarm();const negativeCalls=fetches.length;
 assert.equal((await stored()).image,'','shared sibling artwork is held before its sibling exists in the archive');
 await queueViewedReferenceImage(env,row);await coordinator().alarm();assert.equal(fetches.length,negativeCalls);assert.equal((await stored()).image,'');
 now+=86400001;await queueViewedReferenceImage(env,row);await post('batch',{cards:[gold]});await archive().alarm();await queueViewedReferenceImage(env,gold);
 const goldPhoto=photo.replace('newphoto','goldphoto');source=html(row,photo)+html(gold,goldPhoto);
 await coordinator().alarm();const first=fetches.at(-1);await coordinator().alarm();assert.equal(fetches.at(-1),first,'another product waits for the shared start gate');now+=1100;await coordinator().alarm();assert.ok(fetches.at(-1).at-first.at>=1100);assert.equal((await archive().ctx.storage.get('row:aaron-judge-1-gold')).image,goldPhoto);
 now+=7*86400000+1;for(let i=0;i<500;i++)await coordinator().ctx.storage.put('im-demand:bounded-'+i,{row,attempts:0,retryAt:now});
 const bounded=await queueViewedReferenceImage(env,row);assert.equal(bounded.imageRefreshPending,false);assert.equal((await coordinator().ctx.storage.list({prefix:'im-demand:'})).size,500,'new views cannot grow the persisted queue past its bound');
 for(const testCase of [
  {source:new Error('secret token https://private.example'),status:null,error:'source_network'},
  {source:new DOMException('private timeout details','TimeoutError'),status:null,error:'source_timeout'},
  {source:new Response('private challenge content',{status:403}),status:403,error:'source_http'},
  {source:new Response(null,{status:302,headers:{Location:'https://private.example'}}),status:302,error:'source_http'},
  {source:html({...row,title:'Wrong Player #1'},photo),status:200,error:'exact_identity_unavailable'},
  {source:new Response('not HTML',{headers:{'Content-Type':'application/json'}}),status:200,error:'unexpected_source_response'},
  {source:'Just a moment: verify you are human',status:200,error:'source_challenge'},
 ]){
  objects.clear();await post('batch',{cards:[row]});await archive().alarm();source=testCase.source;await queueViewedReferenceImage(env,row);await coordinator().alarm();
  const diagnostic=await queueViewedReferenceImage(env,row);assert.equal(diagnostic.imageRefreshProviderStatus,testCase.status);assert.equal(diagnostic.imageRefreshProviderError,testCase.error);assert.equal((await stored()).image,'');assert.ok(!JSON.stringify(diagnostic).includes('private'));assert.ok(!JSON.stringify(diagnostic).includes('secret'));
  now=Math.max(now,await coordinator().ctx.storage.get('im-paused'))+1;source=html(row,photo);await coordinator().alarm();const recovered=await queueViewedReferenceImage(env,row);assert.equal(recovered.imageRefreshProviderStatus,200);assert.equal(recovered.imageRefreshProviderError,null,'healthy exact source refresh clears the previous enum failure');assert.equal((await stored()).image,photo);
 }
 // Explicit status inspection travels through the real public reference route,
 // but can only read the image coordinator's already persisted state.
 const statusReference={consoleId:'baseball-cards-2026-bowman-chrome',productId:'12345',title:'Aaron Judge #66',cardNumber:'66',parallel:'',run:'',image:null,url:'https://www.sportscardspro.com/game/baseball-cards-2026-bowman-chrome/aaron-judge-66'};
 const statusObject=coordinator(),statusStore=statusObject.ctx.storage,checkedAt=now-100,pausedUntil=now+3600000;
 await statusStore.put('im-cache:12345',{...statusReference,image:'',checkedAt});await statusStore.put('im-demand:12345',{row:{...statusReference,image:''},retryAt:pausedUntil,attempts:1});await statusStore.put('im-paused',pausedUntil);await statusStore.put('im-last-provider-status',403);await statusStore.put('im-last-provider-error','source_http');
 const originalPut=statusStore.put,originalDelete=statusStore.delete,originalSetAlarm=statusStore.setAlarm;let statusWrites=0,coordinatorReads=0,priceReads=0;
 statusStore.put=statusStore.delete=statusStore.setAlarm=async()=>{statusWrites++;throw Error('status must not write');};
 statusObject.env={...env,CARD_REFERENCE_ARCHIVE:{idFromName:id=>id,get(){throw Error('status must not call a source archive');}}};
 const statusEnv={REFERENCE_IMAGE_REFRESH_ENABLED:'1',CARD_REFERENCE_ARCHIVE:{idFromName:id=>id,get:id=>({fetch:async input=>{const request=new Request(input),path=new URL(request.url).pathname;if(id===IMAGE_REFRESH_COORDINATOR){coordinatorReads++;return statusObject.fetch(request);}if(path==='/reference-price'){priceReads++;assert.equal((await request.json()).refresh,false);return Response.json({queued:false});}assert.equal(path,'/family');return Response.json({cards:[statusReference],archived:true});}})}};
 const statusUrl=new URL('https://www.themanapocket.com/baseball/checklists/2026-bowman-chrome-baseball/cards/2026-bowman-chrome-baseball-66?reference=3&price-refresh=0&image-status=1'),statusDeps={escape:s=>String(s),listItems:async()=>{throw Error('no inventory');},available:()=>true};
 const beforeInspection=fetches.length,statusResponse=await handleBaseballCatalog(new Request(statusUrl),statusEnv,statusUrl,statusDeps),statusData=(await statusResponse.json()).reference;
 assert.equal(statusResponse.headers.get('Cache-Control'),'no-store');assert.equal(statusData.imageRefreshPending,true);assert.equal(statusData.imageRefreshCheckedAt,checkedAt);assert.equal(statusData.imageRefreshRetryAt,pausedUntil);assert.equal(statusData.imageRefreshProviderStatus,403);assert.equal(statusData.imageRefreshProviderError,'source_http');assert.equal(coordinatorReads,1);assert.equal(priceReads,1);assert.equal(statusWrites,0);assert.equal(fetches.length,beforeInspection);
 statusUrl.searchParams.delete('image-status');await handleBaseballCatalog(new Request(statusUrl),statusEnv,statusUrl,statusDeps);assert.equal(coordinatorReads,1,'ordinary stored audits do not inspect or contact the image coordinator');
 const mismatch=await queueViewedReferenceImage(statusEnv,{...statusReference,title:'Different #66'},{refresh:false,inspect:true});assert.equal(mismatch.imageRefreshCheckedAt,null);assert.equal(mismatch.imageRefreshPending,false);
 statusStore.put=originalPut;statusStore.delete=originalDelete;statusStore.setAlarm=originalSetAlarm;assert.equal((await statusStore.list({prefix:'im-demand:'})).size,1,'status inspection does not create or consume demand');
 console.log('Demand image metadata: exact identity, audit isolation, dedupe, TTL, health/holds/duplicates, CAS and persistent pause passed');
}finally{Date.now=originalNow;}
