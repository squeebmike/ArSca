import assert from 'node:assert/strict';
import {referencePriceRequest,referencePriceAlarm,priceApiRequest,priceProductIdentity,apiReferencePrices,refreshedReferencePrices} from '../scripts/reference-price-refresh.mjs';
const ref={productId:'123',title:'Shohei Ohtani #1',consoleId:'baseball-cards-2026-topps-five-star'};
const data={status:'success',id:'123','product-name':ref.title,'console-name':'Baseball Cards 2026 Topps Five Star','loose-price':1234,'graded-price':2500,'manual-only-price':9900,'new-price':99999};
const originalNow=Date.now;let now=1800000000000;Date.now=()=>now;
const values=new Map();let alarm=null,tail=Promise.resolve(),calls=[],response=data;
const storage={get:async k=>values.get(k),put:async(k,v)=>values.set(k,structuredClone(v)),delete:async k=>values.delete(k),list:async({prefix,limit=1000})=>new Map([...values].filter(([k])=>k.startsWith(prefix)).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit)),getAlarm:async()=>alarm,setAlarm:async t=>alarm=t};
const owner={ctx:{storage,blockConcurrencyWhile(fn){const p=tail.then(fn);tail=p.catch(()=>{});return p;}},env:{PRICECHARTING_TOKEN:'private-test-token',referencePriceFetch:async url=>{calls.push({at:Date.now(),url:String(url)});if(response instanceof Error)throw response;return response instanceof Response?response:Response.json(response);}}};
const request=r=>new Request('https://archive/reference-price',{method:'POST',body:JSON.stringify(r)});
try{
 assert.ok(priceProductIdentity(data,ref));assert.ok(!priceProductIdentity({...data,'console-name':'Football Cards 2026 Topps Five Star'},ref));assert.ok(!priceProductIdentity({...data,'product-name':'Shohei Ohtani [Amber] #1'},ref));
 assert.deepEqual(apiReferencePrices(data,now),{ungraded:12.34,grade9:25,psa10:99,currency:'USD',capturedAt:new Date(now).toISOString()});assert.equal(apiReferencePrices({'loose-price':0},now),null);
 const audit=await(await referencePriceRequest(owner,request({...ref,refresh:false}))).json();assert.equal(audit.queued,false);assert.equal((await storage.list({prefix:'pc-demand:'})).size,0,'coverage audit reads never queue API scans');
 await Promise.all(Array.from({length:20},()=>referencePriceRequest(owner,request(ref))));assert.equal((await storage.list({prefix:'pc-demand:'})).size,1);assert.equal(calls.length,0,'page views enqueue without upstream calls');
 await referencePriceAlarm(owner);assert.equal(calls.length,1);let result=await(await referencePriceRequest(owner,request(ref))).json();assert.equal(result.referencePrices.ungraded,12.34);assert.equal(result.stale,false);assert.ok(!JSON.stringify(result).includes('private-test-token'));
 await referencePriceAlarm(owner);assert.equal(calls.length,1,'fresh or empty queue does not scan');
 now+=86400001;await referencePriceRequest(owner,request(ref));response=new Error('outage');await referencePriceAlarm(owner);assert.equal(values.get('pc-cache:123').referencePrices.ungraded,12.34);assert.ok(alarm>=now+60000);
 now+=3600001;response={...data,'product-name':'Wrong player #1'};await referencePriceAlarm(owner);assert.equal(values.get('pc-cache:123').referencePrices.ungraded,12.34,'bad identity never erases last verified price');
 now+=86400001;response={...data,'loose-price':0,'graded-price':0,'manual-only-price':0};await referencePriceRequest(owner,request(ref));await referencePriceAlarm(owner);assert.equal(values.get('pc-cache:123').referencePrices.ungraded,12.34,'blank provider price preserves previous value');
 now+=86400001;response=new Response('limited',{status:429});await referencePriceRequest(owner,request(ref));await referencePriceAlarm(owner);assert.ok(values.get('pc-paused-until')>=now+3600000);const count=calls.length;await referencePriceAlarm(owner);assert.equal(calls.length,count,'quota pause is persistent');
 const paused=await(await referencePriceRequest(owner,request(ref))).json();assert.equal(paused.providerStatus,429);assert.ok(paused.retryAt>=now+3600000);assert.ok(!JSON.stringify(paused).includes('private-test-token'));
 now+=3600001;response=data;await referencePriceAlarm(owner);const last=calls.at(-1).at;now+=1100;
 const apiRequest=()=>new Request('https://archive/price-api',{method:'POST',body:JSON.stringify({path:'/api/product',params:{id:'456'}})});
 await priceApiRequest(owner,apiRequest());assert.ok(calls.at(-1).at-last>=1100,'staff and public refresh share persisted rate gate');
 assert.equal((await priceApiRequest(owner,new Request('https://archive/price-api',{method:'POST',body:JSON.stringify({path:'https://evil.test',params:{t:'other'}})}))).status,400);
 const old={...ref,referencePrices:{ungraded:1,currency:'USD'}};assert.deepEqual(await refreshedReferencePrices({},old),old,'missing coordinator keeps saved price');
 const binding={idFromName:name=>{assert.equal(name,'pricecharting-global-v1');return name;},get:()=>({fetch:r=>referencePriceRequest(owner,r)})};
 const enriched=await refreshedReferencePrices({CARD_REFERENCE_ARCHIVE:binding},{...old,image:'exact-saved-photo'});assert.equal(enriched.image,'exact-saved-photo');assert.equal(enriched.referencePrices.ungraded,12.34);
 const stitches={productId:'14948731',title:'Byron Buxton #SS-BB',consoleId:'baseball-cards-2026-topps-five-star-stars-&-stitches-autograph'};
 const stitchesData={...data,id:stitches.productId,'product-name':stitches.title,'console-name':'Baseball Cards 2026 Topps Five Star Stars & Stitches Autograph'};
 assert.ok(priceProductIdentity(stitchesData,stitches));assert.ok(!priceProductIdentity({...stitchesData,'console-name':'Baseball Cards 2026 Topps Five Star Active Autograph'},stitches));
 const beforeStitches=calls.length;
 const stitchesAudit=await referencePriceRequest(owner,request({...stitches,refresh:false}));assert.equal(stitchesAudit.status,200);assert.equal((await stitchesAudit.json()).queued,false);
 values.set('pc-cache:'+stitches.productId,{...stitches,checkedAt:now,referencePrices:{ungraded:42,currency:'USD'}});
 const stitchesCached=await refreshedReferencePrices({CARD_REFERENCE_ARCHIVE:binding},{...stitches,image:'saved-stitches-photo'},{refresh:false});
 assert.equal(stitchesCached.referencePrices.ungraded,42,'observed ampersand console reaches the shared verified cache');assert.equal(stitchesCached.image,'saved-stitches-photo');assert.equal(calls.length,beforeStitches,'read-only ampersand lookups do not fetch upstream');
 for(const consoleId of [stitches.consoleId+'&evil',stitches.consoleId.replace('2026','2025'),'baseball-cards-2026-topps-five-star-arbitrary-&-autograph']){
  assert.equal((await referencePriceRequest(owner,request({...stitches,consoleId}))).status,400,'ampersand exception is limited to the exact observed console');
  const invalid={...stitches,consoleId};assert.equal(await refreshedReferencePrices({CARD_REFERENCE_ARCHIVE:{idFromName(){throw new Error('invalid console reached coordinator');}}},invalid),invalid);
 }
 // Real concurrent callers exercise serialization and actual elapsed spacing,
 // rather than only asserting a persisted timestamp or mirroring the code.
 Date.now=originalNow;values.delete('pc-next-call');values.delete('pc-paused-until');calls=[];response=data;
 await Promise.all(['901','902','903'].map(id=>priceApiRequest(owner,new Request('https://archive/price-api',{method:'POST',body:JSON.stringify({path:'/api/product',params:{id}})}))));
 assert.equal(calls.length,3);for(let i=1;i<calls.length;i++)assert.ok(calls[i].at-calls[i-1].at>=1050,'concurrent API calls must start at least one second apart');
 await priceApiRequest(owner,new Request('https://archive/price-api',{method:'POST',body:JSON.stringify({path:'/api/product',params:{id:'903'}})}));assert.equal(calls.length,3,'staff repeated lookup uses shared five-minute cache');
 console.log('Demand price cache, exact identity, quota/outage preservation and shared rate checks passed');
}finally{Date.now=originalNow;}
