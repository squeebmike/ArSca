// Shared server-only PriceCharting cache and demand queue. No catalog scanner.
const DAY=86400000, GAP=1100, LIMIT=500;
const fold=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const reply=(value,status=200)=>Response.json(value,{status});
const coordinatorName='pricecharting-global-v1';
export async function coordinatedPriceFetch(env,path,params={}){
 if(!env.CARD_REFERENCE_ARCHIVE)return reply({error:'Shared price coordinator unavailable'},503);
 const stub=env.CARD_REFERENCE_ARCHIVE.get(env.CARD_REFERENCE_ARCHIVE.idFromName(coordinatorName));
 return stub.fetch(new Request('https://archive/price-api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path,params,token:env.PRICECHARTING_TOKEN||env.PRICECHARTING_API_KEY})}));
}
// All upstream calls, including staff lookups, use this same named object.
// Persist the next permitted start before fetching, including failed calls.
async function upstream(owner,path,params,serverToken){
 const store=owner.ctx.storage,now=Date.now();
 const token=serverToken||owner.env.PRICECHARTING_TOKEN||owner.env.PRICECHARTING_API_KEY;
 if(!token){await store.put('pc-last-provider-error','missing_api_configuration');return reply({error:'Price provider unavailable'},503);}
 const identity=JSON.stringify([token,path,Object.entries(params).sort(([a],[b])=>a.localeCompare(b))]);
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity)),cacheKey='pc-api:'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 const cached=await store.get(cacheKey);if(cached&&now-cached.at<300000)return new Response(cached.text,{headers:{'Content-Type':'application/json'}});
 const due=Math.max(Number(await store.get('pc-next-call')||0),Number(await store.get('pc-paused-until')||0));
 if(due-now>GAP){await store.put('pc-last-provider-error','provider_paused');return reply({error:'Price provider temporarily paused'},503);}
 if(due>now)await new Promise(resolve=>setTimeout(resolve,due-now));
 await store.put('pc-next-call',Date.now()+GAP);
 const url=new URL(path,'https://www.pricecharting.com');
 for(const [key,value]of Object.entries(params))url.searchParams.set(key,String(value));url.searchParams.set('t',token);
 try{
  await store.put('pc-last-provider-error','request_started');
  const response=await (owner.env.referencePriceFetch||fetch)(url,{headers:{Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(8000)});
  await store.put('pc-last-provider-status',response.status);await store.delete('pc-last-provider-error');
  if(!response.ok){await store.put('pc-paused-until',Date.now()+([401,403,429].includes(response.status)?3600000:60000));return reply({error:'Price provider unavailable'},response.status);}
  const text=await response.text();if(text.length>2000000)return reply({error:'Price response too large'},502);
  try{const data=JSON.parse(text);if(data.status!=='error'&&text.length<100000)await store.put(cacheKey,{at:Date.now(),text});}catch{return reply({error:'Invalid price response'},502);}
  return new Response(text,{headers:{'Content-Type':'application/json'}});
 }catch(error){await store.put('pc-last-provider-error',['TimeoutError','AbortError'].includes(error?.name)?'timeout':'network_failure');await store.put('pc-paused-until',Date.now()+60000);return reply({error:'Price provider unavailable'},502);}
}
export async function priceApiRequest(owner,request){
 if(request.method!=='POST')return reply({error:'Method not allowed'},405);
 let input;try{const text=await request.text();if(text.length>4000)throw Error();input=JSON.parse(text);}catch{return reply({error:'Invalid request'},400);}
 if(!['/api/product','/api/products'].includes(input.path)||!input.params||typeof input.params!=='object'||Array.isArray(input.params)||Object.entries(input.params).some(([key,value])=>!['id','upc','q','type','status'].includes(key)||!['string','number'].includes(typeof value)||String(value).length>500))return reply({error:'Invalid lookup'},400);
 if(input.token!==undefined&&(typeof input.token!=='string'||input.token.length>1000))return reply({error:'Invalid provider configuration'},400);
 return owner.ctx.blockConcurrencyWhile(()=>upstream(owner,input.path,input.params,input.token));
}
export async function refreshedReferencePrices(env,reference,{refresh=true}={}){
 if(!validRef(reference)||!env.CARD_REFERENCE_ARCHIVE)return reference;
 try{
  const stub=env.CARD_REFERENCE_ARCHIVE.get(env.CARD_REFERENCE_ARCHIVE.idFromName(coordinatorName));
  const response=await stub.fetch(new Request('https://archive/reference-price',{method:'POST',body:JSON.stringify({productId:reference.productId,title:reference.title,consoleId:reference.consoleId,refresh})}));
  if(!response.ok)return reference;const cached=await response.json();
  return {...reference,...(cached.referencePrices?{referencePrices:cached.referencePrices}:{}),priceCheckedAt:cached.checkedAt||null,priceRefreshPending:!!cached.queued,priceRefreshRetryAt:cached.retryAt||null,priceRefreshProviderStatus:cached.providerStatus||null,priceRefreshProviderError:cached.providerError||null};
 }catch{return reference;}
}
export function priceProductIdentity(data,ref){const name=String(data?.['console-name']||''),expected=/^(?:baseball|football|hockey|basketball)[ -]+cards[ -]+/i.test(name)?ref.consoleId:ref.consoleId.replace(/^(?:baseball|football|hockey|basketball)-cards-/,'');return String(data?.id)===ref.productId&&fold(data['product-name'])===fold(ref.title)&&fold(name)===fold(expected);}
export function apiReferencePrices(data,now){const out={};for(const [field,key]of [['ungraded','loose-price'],['grade9','graded-price'],['psa10','manual-only-price']]){const cents=Number(data[key]);if(Number.isSafeInteger(cents)&&cents>0)out[field]=cents/100;}return Object.keys(out).length?{...out,currency:'USD',capturedAt:new Date(now).toISOString()}:null;}
// This observed provider console contains a literal ampersand in its path.
const observedAmpersandConsole='baseball-cards-2026-topps-five-star-stars-&-stitches-autograph';
function validRef(r){return r&&/^\d{1,20}$/.test(r.productId||'')&&typeof r.title==='string'&&r.title.length<=350&&(/^(baseball|football|hockey|basketball)-cards-[a-z0-9%-]+$/.test(r.consoleId||'')||r.consoleId===observedAmpersandConsole);}
export async function referencePriceRequest(owner,request){
 const url=new URL(request.url);if(url.pathname!=='/reference-price')return null;
 if(request.method!=='POST')return reply({error:'Method not allowed'},405);
 let ref;try{const text=await request.text();if(text.length>2000)return reply({error:'Too large'},413);ref=JSON.parse(text);}catch{return reply({error:'Invalid request'},400);}
 if(!validRef(ref))return reply({error:'Exact product identity required'},400);
 return owner.ctx.blockConcurrencyWhile(async()=>{
  const store=owner.ctx.storage,now=Date.now(),key='pc-cache:'+ref.productId,cache=await store.get(key);
  // Product IDs are not accepted as a substitute for the already matched identity.
  const same=cache&&cache.title===ref.title&&cache.consoleId===ref.consoleId;
  const fresh=same&&now-cache.checkedAt<DAY;
  let queued=false;
  if(ref.refresh!==false&&!fresh&&(owner.env.PRICECHARTING_TOKEN||owner.env.PRICECHARTING_API_KEY)){
   const pending=await store.list({prefix:'pc-demand:',limit:LIMIT});
   if(pending.has('pc-demand:'+ref.productId)||pending.size<LIMIT){
    await store.put('pc-mode',true);await store.put('pc-demand:'+ref.productId,{productId:ref.productId,title:ref.title,consoleId:ref.consoleId});
    queued=true;
    const next=Math.max(now+1,Number(await store.get('pc-next-call')||0),Number(await store.get('pc-paused-until')||0));const alarm=await store.getAlarm();if(!alarm||alarm>next)await store.setAlarm(next);
   }
  }
  return reply({referencePrices:same?cache.referencePrices||null:null,checkedAt:same?cache.checkedAt:null,stale:!fresh,queued,retryAt:Number(await store.get('pc-paused-until')||0)>now?await store.get('pc-paused-until'):null,providerStatus:await store.get('pc-last-provider-status')||null,providerError:await store.get('pc-last-provider-error')||null});
 });
}
export async function referencePriceAlarm(owner){
 if(!await owner.ctx.storage.get('pc-mode'))return false;
 await owner.ctx.blockConcurrencyWhile(async()=>{
  const store=owner.ctx.storage,now=Date.now(),due=Math.max(Number(await store.get('pc-next-call')||0),Number(await store.get('pc-paused-until')||0));
  const pending=await store.list({prefix:'pc-demand:',limit:1});if(!pending.size)return;
  if(now<due){await store.setAlarm(due);return;}
  const [key,ref]=pending.entries().next().value,token=owner.env.PRICECHARTING_TOKEN||owner.env.PRICECHARTING_API_KEY;
  if(!token)return;
  try{
   const response=await upstream(owner,'/api/product',{id:ref.productId});
   if(!response.ok){const pause=Math.max(Number(await store.get('pc-paused-until')||0),Date.now()+60000);await store.put('pc-paused-until',pause);await store.setAlarm(pause);return;}
   const data=await response.json();if(data.status!=='success'||!priceProductIdentity(data,ref)){const old=await store.get('pc-cache:'+ref.productId);await store.put('pc-cache:'+ref.productId,{...ref,checkedAt:Date.now(),referencePrices:old?.title===ref.title&&old?.consoleId===ref.consoleId?old.referencePrices:null,reason:'identity_or_provider_response_unverified'});await store.delete(key);}
   else{const old=await store.get('pc-cache:'+ref.productId),prices=apiReferencePrices(data,Date.now()),same=old?.title===ref.title&&old?.consoleId===ref.consoleId;await store.put('pc-cache:'+ref.productId,{...ref,checkedAt:Date.now(),referencePrices:prices||(same?old.referencePrices:null)||null});await store.delete(key);}
  }catch{await store.put('pc-last-provider-error','coordinator_failure');await store.put('pc-paused-until',Date.now()+60000);}
  if((await store.list({prefix:'pc-demand:',limit:1})).size)await store.setAlarm(Math.max(Date.now()+GAP,Number(await store.get('pc-paused-until')||0)));
 });return true;
}
