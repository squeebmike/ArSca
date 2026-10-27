// Persistent public card identities/photo URLs, separate from expiring offers.
// No image bytes, inventory, or customer data. Optional source estimates are
// labeled separately from offers and retain their actual collection timestamp.
import {referenceMetadataCheck,referenceCategory,referenceImageKey,checkReferenceImage,REFERENCE_AUDIT_VERSION,REFERENCE_SOURCE_MAPPING_VERSION} from './reference-validation.mjs';
import {referenceImageSeeds} from './topps/reference-image-seeds.mjs';
// A few photographed serial stamps have been checked by hand. Reuse that
// evidence only for the identical source URL, title and photo; never infer a
// denominator just from a finish name, or overwrite a conflicting capture.
const reviewedNumbering=new Map(Object.values(referenceImageSeeds).flat().filter(r=>r.run).map(r=>[r.url,r]));
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
 const reviewed=reviewedNumbering.get(u.href),photo=image.replace(/\/60\.jpg$/,'/240.jpg');
 const run=String(row.run||'').replace(/\s+/g,' ').trim().slice(0,40)||(reviewed?.title===title&&reviewed.image===photo?reviewed.run:'');
 const prices={},input=row.referencePrices,seenAt=Date.parse(row.capturedAt);
 if(input?.currency==='USD'&&Number.isFinite(seenAt)&&seenAt>=Date.UTC(2020,0,1)&&seenAt<=Date.now()+300000){for(const field of ['ungraded','grade9','psa10']){const value=input[field];if(typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=100000000)prices[field]=value;}}
 const referencePrices=Object.keys(prices).length?{...prices,currency:'USD',capturedAt:new Date(seenAt).toISOString()}:null;
 return {consoleId:parts[1],setName:String(row.setName||parts[1]).replace(/\s+/g,' ').trim().slice(0,200),productId:/^\d{1,20}$/.test(String(row.productId||''))?String(row.productId):'',title,cardNumber:number,player:String(row.player||'').slice(0,200),parallel:String(row.parallel||'').slice(0,120),run,image:photo,url:u.href,capturedAt:new Date().toISOString(),...(referencePrices?{referencePrices}:{})};
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
     const sameIdentity=old&&old.title===row.title&&old.cardNumber===row.cardNumber&&old.parallel===row.parallel&&old.run===row.run;
     if(sameIdentity&&old.referencePrices&&(!row.referencePrices||Date.parse(old.referencePrices.capturedAt)>Date.parse(row.referencePrices.capturedAt)))merged.referencePrices=old.referencePrices;
     if(!old)meta.cards++;
     meta.photos+=(merged.image?1:0)-(old?.image?1:0);
     await tx.put(key,merged);
     const imageId=referenceImageKey(merged.image),oldImageId=referenceImageKey(old?.image);
     if(oldImageId&&oldImageId!==imageId)await tx.delete('usage:'+oldImageId+':'+slug);
     if(imageId){await tx.put('usage:'+imageId+':'+slug,{title:merged.title,url:merged.url});await tx.put('image:'+imageId,{image:merged.image});}
     await tx.put('validation:'+slug,referenceMetadataCheck(merged));
     await tx.put('pending:'+slug,merged);
     if(old?.cardNumber&&old.cardNumber!==row.cardNumber)await tx.delete('family:'+old.cardNumber+':'+slug);
     if(row.cardNumber)await tx.put('family:'+row.cardNumber+':'+slug,merged);
    }
    meta.updatedAt=Date.now();await tx.put('meta',meta);return meta;
   });
   await this.ctx.storage.setAlarm(Date.now()+1000);
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
   const cards=[];for(const [key,row]of rows)cards.push({...row,validation:await this.ctx.storage.get('validation:'+key.slice(4))||null});
   return reply({cards,cursor:rows.size===100?[...rows.keys()].at(-1):null});
  }
  if(request.method==='GET'&&url.pathname==='/samples'){
   const samples=[],counts={};let cursor='',scanned=0;
   for(let page=0;page<20;page++){
    const rows=await this.ctx.storage.list({prefix:'row:',limit:200,...(cursor?{startAfter:cursor}:{})});if(!rows.size)break;
    for(const [key,row]of rows){scanned++;if(!row.image)continue;const kind=row.run?'numbered':row.parallel?'parallel':referenceCategory(row);if((counts[kind]||0)>=3)continue;counts[kind]=(counts[kind]||0)+1;samples.push({...row,validation:await this.ctx.storage.get('validation:'+key.slice(4))||referenceMetadataCheck(row),health:await this.ctx.storage.get('health:'+referenceImageKey(row.image))||null,hold:await this.ctx.storage.get('hold:'+referenceImageKey(row.image))||null});}
    cursor=[...rows.keys()].at(-1);if(rows.size<200||samples.length>=15)break;
   }
   return reply({samples,scanned});
  }
  if(request.method==='POST'&&url.pathname==='/audit-start'){
   const old=await this.ctx.storage.get('audit');if(old?.running&&old.version===REFERENCE_AUDIT_VERSION)return reply(old);
   const state={version:REFERENCE_AUDIT_VERSION,running:true,phase:'metadata',cursor:'',startedAt:Date.now(),records:0,photos:0,metadataMatched:0,metadataHeld:0,eligible:0,held:0,flags:{},imagesChecked:0,imagesOk:0,imagesFailed:0,duplicateImages:0,examples:[]};
   await this.ctx.storage.put('audit',state);await this.ctx.storage.setAlarm(Date.now()+1000);return reply(state);
  }
  if(request.method==='GET'&&url.pathname==='/audit-status')return reply(await this.ctx.storage.get('audit')||{running:false,phase:'not_started'});
  if(request.method==='POST'&&url.pathname==='/hold'){
   const input=await request.json();let source;try{source=new URL(input.url);}catch{return new Response('Invalid source',{status:400});}
   const row=await this.ctx.storage.get('row:'+source.pathname.split('/').pop());
   if(!row||row.url!==input.url||!row.image)return new Response('Unknown reference',{status:404});
   const id=referenceImageKey(row.image),hold={reason:String(input.reason||'Source photo needs review').slice(0,300),heldAt:Date.now()};await this.ctx.storage.put('hold:'+id,hold);return reply({ok:true,hold});
  }
  if(request.method==='GET'&&url.pathname==='/family'){
   const number=url.searchParams.get('number')||'';if(!/^[a-z0-9.-]{1,40}$/i.test(number))return new Response('Invalid number',{status:400});
   const rows=await this.ctx.storage.list({prefix:'family:'+number+':',limit:1000}),cards=[],audit=await this.ctx.storage.get('audit'),archived=!!(await this.ctx.storage.get('meta'));
   if(audit?.phase==='metadata')return reply({cards:[],archived});
   for(const row of rows.values()){
    const slug=new URL(row.url).pathname.split('/').pop(),id=referenceImageKey(row.image);let check=await this.ctx.storage.get('validation:'+slug);
    // Repair old unmapped-source results lazily, once per mapping release.
    // This uses only the stored family and immutable publisher metadata.
    // Image health, ambiguity, duplicates and owner holds still gate display.
    if(check?.flags?.some(flag=>['unmapped_source_set','no_exact_checklist_match','ambiguous_checklist_match'].includes(flag))&&check.mappingVersion!==REFERENCE_SOURCE_MAPPING_VERSION){check=referenceMetadataCheck(row);await this.ctx.storage.put('validation:'+slug,check);}
    if(check?.version!==REFERENCE_AUDIT_VERSION||check.flags.length||check.matches.length!==1||!id)continue;
    const health=await this.ctx.storage.get('health:'+id);if(!health?.ok||Date.now()-health.checkedAt>7*86400000||await this.ctx.storage.get('hold:'+id))continue;
    const usage=await this.ctx.storage.list({prefix:'usage:'+id+':',limit:2});if(usage.size!==1)continue;
    cards.push({...row,validation:'automatically_matched',imageCheckedAt:health.checkedAt,visuallyReviewed:false});
   }
   return reply({cards,archived});
  }
  return new Response('Not found',{status:404});
 }
 async alarm(){
  const state=await this.ctx.storage.get('audit');
  if(state?.running){
   if(state.phase==='metadata'){
    const rows=await this.ctx.storage.list({prefix:'row:',limit:200,...(state.cursor?{startAfter:state.cursor}:{})});
    for(const [key,row]of rows){
     const slug=key.slice(4),check=referenceMetadataCheck(row);await this.ctx.storage.put('validation:'+slug,check);
     state.records++;if(row.image)state.photos++;if(check.metadataMatched)state.metadataMatched++;
     if(check.flags.length){state.metadataHeld++;for(const flag of check.flags)state.flags[flag]=(state.flags[flag]||0)+1;if(state.examples.length<20)state.examples.push({title:row.title,url:row.url,flags:check.flags});}
     const id=referenceImageKey(row.image);if(id){await this.ctx.storage.put('usage:'+id+':'+slug,{title:row.title,url:row.url});await this.ctx.storage.put('image:'+id,{image:row.image});}
    }
    state.cursor=[...rows.keys()].at(-1)||state.cursor;
    if(rows.size<200){state.phase='images';state.cursor='';}
   }else if(state.phase==='images'){
    const rows=await this.ctx.storage.list({prefix:'image:',limit:32,...(state.cursor?{startAfter:state.cursor}:{})});
    const entries=[...rows];for(let i=0;i<entries.length;i+=8)await Promise.all(entries.slice(i,i+8).map(async([key,row])=>{
     const id=key.slice(6),prior=await this.ctx.storage.get('health:'+id);
     const usage=await this.ctx.storage.list({prefix:'usage:'+id+':',limit:2});if(!usage.size){await this.ctx.storage.delete(key);return;}
     const health=prior&&Date.now()-prior.checkedAt<86400000?prior:await checkReferenceImage(row.image,this.env.REFERENCE_IMAGE_FETCH||fetch);
     await this.ctx.storage.put('health:'+id,health);state.imagesChecked++;if(health.ok)state.imagesOk++;else state.imagesFailed++;
     if(usage.size>1)state.duplicateImages++;
    }));
    state.cursor=[...rows.keys()].at(-1)||state.cursor;
    if(rows.size<32){state.phase='eligibility';state.cursor='';}
   }else{
    const rows=await this.ctx.storage.list({prefix:'row:',limit:200,...(state.cursor?{startAfter:state.cursor}:{})});
    for(const [key,row]of rows){
     const slug=key.slice(4),check=await this.ctx.storage.get('validation:'+slug)||referenceMetadataCheck(row),id=referenceImageKey(row.image);
     if(id){const health=await this.ctx.storage.get('health:'+id),usage=await this.ctx.storage.list({prefix:'usage:'+id+':',limit:2});if(!health?.ok)check.flags.push(health?.reason||'image_not_checked');if(usage.size>1)check.flags.push('shared_image_requires_review');if(await this.ctx.storage.get('hold:'+id))check.flags.push('manual_image_hold');check.imageCheckedAt=health?.checkedAt||null;}
     check.flags=[...new Set(check.flags)];check.eligible=check.flags.length===0&&check.matches.length===1;await this.ctx.storage.put('validation:'+slug,check);if(check.eligible)state.eligible++;else state.held++;
    }
    state.cursor=[...rows.keys()].at(-1)||state.cursor;
    if(rows.size<200){state.running=false;state.phase='complete';state.completedAt=Date.now();}
   }
   state.updatedAt=Date.now();await this.ctx.storage.transaction(async tx=>{const current=await tx.get('audit');if(current?.startedAt===state.startedAt&&current?.version===state.version)await tx.put('audit',state);});
   await this.ctx.storage.setAlarm(Date.now()+1000);return;
  }
  // New uploads get the same checks after the initial audit, without rescanning
  // the full catalog or querying Supabase. Public reads hold unchecked photos.
  const pending=await this.ctx.storage.list({prefix:'pending:',limit:8});
  for(const [key,row]of pending){const slug=key.slice(8),check=referenceMetadataCheck(row),id=referenceImageKey(row.image);await this.ctx.storage.put('validation:'+slug,check);if(id){const prior=await this.ctx.storage.get('health:'+id);if(!prior||Date.now()-prior.checkedAt>86400000)await this.ctx.storage.put('health:'+id,await checkReferenceImage(row.image,this.env.REFERENCE_IMAGE_FETCH||fetch));}await this.ctx.storage.delete(key);}
  if(pending.size===8)await this.ctx.storage.setAlarm(Date.now()+1000);
 }
}
export async function handleCloudReferenceRequest(request,env,url,deps){
 if(!env.CARD_REFERENCE_ARCHIVE)return deps.json({error:'Cloud reference storage is unavailable'},503);
 const auth=await deps.requireStoreUser(request,env,deps.storeId,['owner','admin']);if(auth.error)return auth.error;
 const archive=(id,index=false)=>env.CARD_REFERENCE_ARCHIVE.get(env.CARD_REFERENCE_ARCHIVE.idFromName(index?'catalog':'console:'+id));
 if(url.pathname==='/reference-collector/audit/start'&&request.method==='POST'){
  const sets=(await(await archive('catalog',true).fetch('https://archive.internal/sets')).json()).sets;
  for(const set of sets)await archive(set.consoleId).fetch('https://archive.internal/audit-start',{method:'POST'});
  return deps.json({ok:true,sets:sets.length},200,{'Cache-Control':'no-store'});
 }
 if(url.pathname==='/reference-collector/audit/status'&&request.method==='GET'){
  const offsetText=url.searchParams.get('offset')||'0';
  if(!/^(0|[1-9]\d{0,3})$/.test(offsetText))return deps.json({error:'Invalid audit offset'},400);
  const sets=(await(await archive('catalog',true).fetch('https://archive.internal/sets')).json()).sets,offset=Number(offsetText),page=sets.slice(offset,offset+20),results=[];
  for(let i=0;i<page.length;i+=4)results.push(...await Promise.all(page.slice(i,i+4).map(async set=>({...set,audit:await(await archive(set.consoleId).fetch('https://archive.internal/audit-status')).json()}))));
  return deps.json({sets:results,total:sets.length,nextOffset:offset+page.length<sets.length?offset+page.length:null,running:results.some(s=>s.audit.running)},200,{'Cache-Control':'no-store'});
 }
 if(url.pathname==='/reference-collector/samples'&&request.method==='GET'){
  const id=url.searchParams.get('console')||'';if(!/^[a-z0-9-]{1,160}$/.test(id))return deps.json({error:'Invalid source set'},400);
  const data=await(await archive(id).fetch('https://archive.internal/samples')).json();return deps.json(data,200,{'Cache-Control':'no-store'});
 }
 if(url.pathname==='/reference-collector/hold'&&request.method==='POST'){
  const input=await deps.readJsonWithLimit(request,4096);if(input.error)return input.error;
  const id=input.data.consoleId;if(!/^[a-z0-9-]{1,160}$/.test(id||''))return deps.json({error:'Invalid source set'},400);
  const r=await archive(id).fetch('https://archive.internal/hold',{method:'POST',body:JSON.stringify({url:input.data.url,reason:input.data.reason})});return r.ok?deps.json(await r.json(),200,{'Cache-Control':'no-store'}):deps.json({error:'Unknown source reference'},r.status);
 }
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
 if(!env.CARD_REFERENCE_ARCHIVE||!number)return {cards:[],archived:false};
 try{const target=new URL('https://archive.internal/family');target.searchParams.set('number',number);const stub=env.CARD_REFERENCE_ARCHIVE.get(env.CARD_REFERENCE_ARCHIVE.idFromName('console:'+consoleId));const r=await stub.fetch(target.href,{signal:AbortSignal.timeout(2500)});return r.ok?await r.json():{cards:[],archived:true};}catch{return {cards:[],archived:true};}
}
