// Cache only the public, allowlisted projection. Checkout always rechecks stock.
// Short-lived KV entries let different edge locations reuse the same snapshot.
//
// Outage of 2026-10-19/20: once the database slowed down, every failed load
// left nothing cached, so every page view (crawlers included) started another
// full-catalog query -- up to 5,500 an hour -- which kept the database down.
// Now one load runs at a time per worker, a failure pauses new loads for
// retryMs, and the last good copy (kept staleMs) is served while it's down.
//
// Egress over the Free Plan limit (2026-10-27): crawlers on the checklist and
// card pages reloaded the whole catalog (~6 MB) every 5 minutes, ~288 times
// a day, though stock rarely changed. With `version` (a cheap fingerprint of
// the data), a snapshot past freshMs is first checked: an unchanged
// fingerprint keeps it fresh (recorded in a small separate key) and only a
// real change reloads the catalog.
const inflight=new Map(),failedAt=new Map();
export function clearPublicCatalogBackoff(){failedAt.clear();}
export async function cachedPublicCatalog(env,ctx,key,load,{freshMs=60000,maxAgeMs=180000,staleMs=86400000,retryMs=60000,timeoutMs=10000,version=null}={}){
 const now=Date.now();let saved=null,checked=null;
 try{saved=await env.LBA_KV?.get('public-catalog:'+key,'json');}catch{}
 if(version&&saved?.version!=null){try{checked=await env.LBA_KV?.get('public-catalog-checked:'+key,'json');}catch{}}
 const stamp=saved&&checked&&saved.version!=null&&checked.version===saved.version&&Number.isFinite(checked.at)?Math.max(saved.at,checked.at):saved?.at;
 const age=saved&&Array.isArray(saved.items)&&Number.isFinite(stamp)&&now-stamp>=0?now-stamp:Infinity;
 if(age<freshMs)return saved.items;
 if(version&&saved?.version!=null&&age<staleMs&&!inflight.has(key)){
  try{
   const current=await version();
   if(current!=null&&String(current)===String(saved.version)){
    try{await env.LBA_KV?.put('public-catalog-checked:'+key,JSON.stringify({at:Date.now(),version:saved.version}),{expirationTtl:Math.max(60,Math.ceil(staleMs/1000))});}catch{}
    return saved.items;
   }
  }catch{}
 }
 const usable=age<maxAgeMs,stale=age<staleMs;
 let failed=failedAt.get(key)||0;
 if(now-failed>=retryMs){try{const f=await env.LBA_KV?.get('public-catalog-failed:'+key,'json');if(f&&Number.isFinite(f.at))failed=Math.max(failed,f.at);}catch{}}
 if(now-failed<retryMs){if(stale)return saved.items;throw new Error('Public catalog unavailable; retrying shortly');}
 let refresh=inflight.get(key);
 if(!refresh){
  const controller=new AbortController();
  let timer;
  let loadedVersion=null;
  refresh=Promise.race([
   // The fingerprint is read before the load, so a change made during the
   // load still shows as a change on the next check.
   Promise.resolve().then(async()=>{if(version){try{loadedVersion=await version();}catch{loadedVersion=null;}}return load(controller.signal);}),
   new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Public catalog timed out'));},timeoutMs);})
  ]).then(async value=>{
   const items=Array.isArray(value)?value:value?.items,at=Array.isArray(value)?Date.now():value?.at;
   if(!Array.isArray(items)||!Number.isFinite(at)||at>Date.now()||Date.now()-at>=staleMs)throw new Error('Invalid public catalog');
   try{await env.LBA_KV?.put('public-catalog:'+key,JSON.stringify(loadedVersion!=null?{at,items,version:String(loadedVersion)}:{at,items}),{expirationTtl:Math.max(60,Math.ceil((staleMs-(Date.now()-at))/1000))});}catch{}
   return items;
  }).catch(async err=>{
   // Validation failures must pause retries too, not just rejected network loads.
   failedAt.set(key,Date.now());
   try{await env.LBA_KV?.put('public-catalog-failed:'+key,JSON.stringify({at:Date.now()}),{expirationTtl:Math.max(60,Math.ceil(retryMs/1000))});}catch{}
   throw err;
  }).finally(()=>{clearTimeout(timer);inflight.delete(key);});
  inflight.set(key,refresh);
  // A reference page's short enrichment deadline must not cancel the shared
  // cache fill. Keep it alive for the bounded refresh even after that page returns.
  if(ctx?.waitUntil)ctx.waitUntil(refresh.catch(()=>{}));
 }
 if(usable&&ctx?.waitUntil)return saved.items;
 return stale?refresh.catch(()=>saved.items):refresh;
}
