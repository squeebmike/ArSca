// Immutable source identity separates reference-card caching from live inventory.
export async function cachedReferenceSetCards(cache,descriptor,setCode,load,waitUntil){
 const version=descriptor?.sha256||descriptor?.path;
 if(!cache||!version)return load();
 const key=new Request('https://internal.themanapocket.com/__cache/reference-set/'+encodeURIComponent(version)+'/'+encodeURIComponent(setCode));
 try{const hit=await cache.match(key);if(hit){const data=await hit.json();if(Array.isArray(data))return data;}}catch{}
 const data=await load();
 if(Array.isArray(data)&&data.length>0&&data.length<=10000){
  const write=cache.put(key,new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json','Cache-Control':'public,max-age=86400'}})).catch(()=>{});
  if(waitUntil)waitUntil(write);else await write;
 }
 return data;
}
