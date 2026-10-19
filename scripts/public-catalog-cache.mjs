// Cache only the public, allowlisted projection. Checkout always rechecks stock.
// Short-lived KV entries let different edge locations reuse the same snapshot.
export async function cachedPublicCatalog(env,ctx,key,load,{freshMs=60000,maxAgeMs=180000,timeoutMs=10000}={}){
 const now=Date.now();let saved=null;
 try{saved=await env.LBA_KV?.get('public-catalog:'+key,'json');}catch{}
 const usable=saved&&Array.isArray(saved.items)&&Number.isFinite(saved.at)&&now-saved.at>=0&&now-saved.at<maxAgeMs;
 if(usable&&now-saved.at<freshMs)return saved.items;
 const controller=new AbortController();
 let timer;
 const refresh=Promise.race([
  Promise.resolve().then(()=>load(controller.signal)),
  new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Public catalog timed out'));},timeoutMs);})
 ]).then(async items=>{
  if(!Array.isArray(items))throw new Error('Invalid public catalog');
  try{await env.LBA_KV?.put('public-catalog:'+key,JSON.stringify({at:Date.now(),items}),{expirationTtl:Math.ceil(maxAgeMs/1000)});}catch{}
  return items;
 }).finally(()=>clearTimeout(timer));
 // A reference page's short enrichment deadline must not cancel the shared
 // cache fill. Keep it alive for the bounded refresh even after that page returns.
 if(ctx?.waitUntil)ctx.waitUntil(refresh.catch(()=>{}));
 if(usable&&ctx?.waitUntil)return saved.items;
 return refresh;
}
