// Cache only the public, allowlisted projection. Checkout always rechecks stock.
// Short-lived KV entries let different edge locations reuse the same snapshot.
//
// Outage of 2026-10-19/20: once the database slowed down, every failed load
// left nothing cached, so every page view (crawlers included) started another
// full-catalog query -- up to 5,500 an hour -- which kept the database down.
// Now one load runs at a time per worker, a failure pauses new loads for
// retryMs, and the last good copy (kept staleMs) is served while it's down.
const inflight=new Map(),failedAt=new Map();
export function clearPublicCatalogBackoff(){failedAt.clear();}
export async function cachedPublicCatalog(env,ctx,key,load,{freshMs=60000,maxAgeMs=180000,staleMs=86400000,retryMs=60000,timeoutMs=10000}={}){
 const now=Date.now();let saved=null;
 try{saved=await env.LBA_KV?.get('public-catalog:'+key,'json');}catch{}
 const age=saved&&Array.isArray(saved.items)&&Number.isFinite(saved.at)&&now-saved.at>=0?now-saved.at:Infinity;
 if(age<freshMs)return saved.items;
 const usable=age<maxAgeMs,stale=age<staleMs;
 let failed=failedAt.get(key)||0;
 if(now-failed>=retryMs){try{const f=await env.LBA_KV?.get('public-catalog-failed:'+key,'json');if(f&&Number.isFinite(f.at))failed=Math.max(failed,f.at);}catch{}}
 if(now-failed<retryMs){if(stale)return saved.items;throw new Error('Public catalog unavailable; retrying shortly');}
 let refresh=inflight.get(key);
 if(!refresh){
  const controller=new AbortController();
  let timer;
  refresh=Promise.race([
   Promise.resolve().then(()=>load(controller.signal)),
   new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Public catalog timed out'));},timeoutMs);})
  ]).then(async items=>{
   if(!Array.isArray(items))throw new Error('Invalid public catalog');
   try{await env.LBA_KV?.put('public-catalog:'+key,JSON.stringify({at:Date.now(),items}),{expirationTtl:Math.ceil(staleMs/1000)});}catch{}
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
