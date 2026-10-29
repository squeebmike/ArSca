import assert from 'node:assert/strict';
import {CardReferenceArchive,normalizeCloudReference} from '../scripts/cloud-card-references.mjs';
import {sportsReferenceImage} from '../scripts/sports-reference-images.mjs';
import {referenceImageKey} from '../scripts/reference-validation.mjs';
import {IMAGE_REFRESH_COORDINATOR,parseImageRefreshFamily,queueViewedReferenceImage,sameImageReference} from '../scripts/reference-image-refresh.mjs';
const originalNow=Date.now;let now=1800000000000;Date.now=()=>now;
function storage(){let values=new Map(),tail=Promise.resolve(),alarm=null;const list=(map,{prefix,limit=1000})=>new Map([...map].filter(([k])=>k.startsWith(prefix)).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit));return {get:async k=>structuredClone(values.get(k)),put:async(k,v)=>values.set(k,structuredClone(v)),delete:async k=>values.delete(k),list:async opts=>list(values,opts),getAlarm:async()=>alarm,setAlarm:async t=>alarm=t,transaction(fn){const result=tail.then(async()=>{const copy=new Map(values),value=await fn({get:async k=>structuredClone(copy.get(k)),put:async(k,v)=>copy.set(k,structuredClone(v)),delete:async k=>copy.delete(k),list:async opts=>list(copy,opts)});values=copy;return value;});tail=result.catch(()=>{});return result;}};}
const consoleId='baseball-cards-2026-topps',photo='https://storage.googleapis.com/images.pricecharting.com/newphoto/240.jpg';
const row={consoleId,productId:'123',title:'Aaron Judge #1',cardNumber:'1',parallel:'',run:'',image:'',url:'https://www.sportscardspro.com/game/'+consoleId+'/aaron-judge-1'};
const html=(r,image='')=>`<table><tr id="product-${r.productId}"><td class="title"><a href="${r.url}">${r.title}</a>${r.run?`<span class="list-print-run">${r.run}</span>`:''}</td><td><img src="${image||'/images/no-photo.png'}"></td></tr></table>`;
let source=html(row,photo),fetches=[],healthOk=true;
const objects=new Map(),env={REFERENCE_IMAGE_REFRESH_ENABLED:'1',REFERENCE_METADATA_FETCH:async url=>{fetches.push({at:now,url:String(url)});return source instanceof Response?source:new Response(source,{headers:{'Content-Type':'text/html'}});},REFERENCE_IMAGE_FETCH:async()=>healthOk?new Response(null,{headers:{'Content-Type':'image/jpeg'}}):new Response(null,{status:404})};
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
 console.log('Demand image metadata: exact identity, audit isolation, dedupe, TTL, health/holds/duplicates, CAS and persistent pause passed');
}finally{Date.now=originalNow;}
