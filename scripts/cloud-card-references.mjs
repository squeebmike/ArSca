// Persistent public card identities/photo URLs, separate from expiring offers.
// No image bytes, prices, inventory, or customer data are stored here.
export function normalizeCloudReference(row){
 if(!row||typeof row!=='object')return null;
 let u;try{u=new URL(row.url);}catch{return null;}
 if(u.protocol!=='https:'||u.username||u.password||!['www.pricecharting.com','pricecharting.com','www.sportscardspro.com','sportscardspro.com'].includes(u.hostname))return null;
 const parts=u.pathname.match(/^\/game\/([a-z0-9-]{1,160})\/([a-z0-9-]{1,250})\/?$/);if(!parts||row.consoleId!==parts[1])return null;
 const title=String(row.title||'').replace(/\s+/g,' ').trim();if(!title||title.length>350)return null;
 const number=title.match(/#([^\s]+)\s*$/)?.[1]||String(row.cardNumber||'');
 if(number&&!/^[a-z0-9.-]{1,40}$/i.test(number))return null;
 if(row.cardNumber&&number!==String(row.cardNumber))return null;
 const image=String(row.image||'');
 if(image&&!/^https:\/\/storage\.googleapis\.com\/images\.pricecharting\.com\/[a-z0-9]+\/(60|240|300|400|1600)\.jpg$/.test(image))return null;
 u.hostname=u.hostname.replace(/^(?!www\.)/,'www.');u.search='';u.hash='';u.pathname=u.pathname.replace(/\/$/,'');
 return {consoleId:parts[1],setName:String(row.setName||parts[1]).replace(/\s+/g,' ').trim().slice(0,200),productId:/^\d{1,20}$/.test(String(row.productId||''))?String(row.productId):'',title,cardNumber:number,player:String(row.player||'').slice(0,200),parallel:String(row.parallel||'').slice(0,120),run:String(row.run||'').replace(/\s+/g,' ').trim().slice(0,40),image:image.replace(/\/60\.jpg$/,'/240.jpg'),url:u.href,capturedAt:new Date().toISOString()};
}
const reply=data=>Response.json(data);
// Fetch-only DO class; authorization is enforced before calling this binding.
export class CardReferenceArchive {
 constructor(ctx,env){this.ctx=ctx;this.env=env;}
 async fetch(request){
  const url=new URL(request.url);
  if(request.method==='POST'&&url.pathname==='/batch'){
   const text=await request.text();if(text.length>512000)return new Response('Too large',{status:413});
   let input;try{input=JSON.parse(text);}catch{return new Response('Invalid JSON',{status:400});}
   if(!Array.isArray(input.cards)||!input.cards.length||input.cards.length>200)return new Response('Expected 1–200 cards',{status:400});
   const rows=input.cards.map(normalizeCloudReference).filter(Boolean),consoleId=rows[0]?.consoleId;
   if(!consoleId||rows.some(r=>r.consoleId!==consoleId))return new Response('One source set per batch',{status:400});
   const summary=await this.ctx.storage.transaction(async tx=>{
    const meta=await tx.get('meta')||{consoleId,name:rows[0].setName,cards:0,photos:0};
    for(const row of rows){
     const slug=new URL(row.url).pathname.split('/').pop(),key='row:'+slug,old=await tx.get(key);
     const merged={...row,image:row.image||old?.image||''};
     if(!old)meta.cards++;
     meta.photos+=(merged.image?1:0)-(old?.image?1:0);
     await tx.put(key,merged);
     if(old?.cardNumber&&old.cardNumber!==row.cardNumber)await tx.delete('family:'+old.cardNumber+':'+slug);
     if(row.cardNumber)await tx.put('family:'+row.cardNumber+':'+slug,merged);
    }
    meta.updatedAt=Date.now();await tx.put('meta',meta);return meta;
   });
   return reply({ok:true,accepted:rows.length,rejected:input.cards.length-rows.length,summary});
  }
  if(request.method==='POST'&&url.pathname==='/summary'){
   const summary=await request.json();if(!/^[a-z0-9-]{1,160}$/.test(summary.consoleId||''))return new Response('Invalid set',{status:400});
   await this.ctx.storage.transaction(async tx=>{const key='set:'+summary.consoleId,old=await tx.get(key);if(!old||summary.updatedAt>=old.updatedAt)await tx.put(key,summary);});return reply({ok:true});
  }
  if(request.method==='GET'&&url.pathname==='/sets'){
   const rows=await this.ctx.storage.list({prefix:'set:',limit:500});return reply({sets:[...rows.values()]});
  }
  if(request.method==='GET'&&url.pathname==='/cards'){
   const cursor=url.searchParams.get('cursor')||'';
   if(cursor&&!/^row:[a-z0-9-]{1,250}$/.test(cursor))return new Response('Invalid cursor',{status:400});
   const rows=await this.ctx.storage.list({prefix:'row:',limit:100,...(cursor?{startAfter:cursor}:{})});
   return reply({cards:[...rows.values()],cursor:rows.size===100?[...rows.keys()].at(-1):null});
  }
  if(request.method==='GET'&&url.pathname==='/family'){
   const number=url.searchParams.get('number')||'';if(!/^[a-z0-9.-]{1,40}$/i.test(number))return new Response('Invalid number',{status:400});
   const rows=await this.ctx.storage.list({prefix:'family:'+number+':',limit:1000});return reply({cards:[...rows.values()]});
  }
  return new Response('Not found',{status:404});
 }
}
export async function handleCloudReferenceRequest(request,env,url,deps){
 if(!env.CARD_REFERENCE_ARCHIVE)return deps.json({error:'Cloud reference storage is unavailable'},503);
 const auth=await deps.requireStoreUser(request,env,deps.storeId,['owner','admin']);if(auth.error)return auth.error;
 const archive=(id,index=false)=>env.CARD_REFERENCE_ARCHIVE.get(env.CARD_REFERENCE_ARCHIVE.idFromName(index?'catalog':'console:'+id));
 if(request.method==='GET'&&url.pathname==='/reference-collector/sets'){
  const r=await archive('catalog',true).fetch('https://archive.internal/sets');return deps.json(await r.json(),r.status,{'Cache-Control':'no-store'});
 }
 if(request.method==='GET'&&url.pathname==='/reference-collector/cards'){
  const id=url.searchParams.get('console')||'';if(!/^[a-z0-9-]{1,160}$/.test(id))return deps.json({error:'Invalid source set'},400);
  const target=new URL('https://archive.internal/cards');target.searchParams.set('cursor',url.searchParams.get('cursor')||'');
  const r=await archive(id).fetch(target.href);return r.ok?deps.json(await r.json(),200,{'Cache-Control':'no-store'}):deps.json({error:'Invalid cursor'},r.status);
 }
 if(request.method==='POST'&&url.pathname==='/reference-collector/batch'){
  const parsed=await deps.readJsonWithLimit(request,512000);if(parsed.error)return parsed.error;
  const input=parsed.data;
  if(!Array.isArray(input.cards)||!input.cards.length||input.cards.length>200)return deps.json({error:'Send 1–200 cards per batch'},400);
  const id=input.cards[0]?.consoleId;
  if(!/^[a-z0-9-]{1,160}$/.test(id||'')||input.cards.some(r=>r.consoleId!==id))return deps.json({error:'One source set per batch'},400);
  const response=await archive(id).fetch('https://archive.internal/batch',{method:'POST',body:JSON.stringify({cards:input.cards})});
  if(!response.ok)return deps.json({error:'The reference batch was invalid'},response.status);
  const data=await response.json();
  const indexed=await archive('catalog',true).fetch('https://archive.internal/summary',{method:'POST',body:JSON.stringify(data.summary)});
  if(!indexed.ok)return deps.json({error:'Saved references; summary needs retry'},503);
  return deps.json(data,200,{'Cache-Control':'no-store'});
 }
 return deps.json({error:'Not found'},404);
}
export async function cloudReferenceFamily(env,consoleId,number){
 if(!env.CARD_REFERENCE_ARCHIVE||!number)return [];
 try{const target=new URL('https://archive.internal/family');target.searchParams.set('number',number);const stub=env.CARD_REFERENCE_ARCHIVE.get(env.CARD_REFERENCE_ARCHIVE.idFromName('console:'+consoleId));const r=await stub.fetch(target.href,{signal:AbortSignal.timeout(2500)});return r.ok?(await r.json()).cards||[]:[];}catch{return [];}
}
