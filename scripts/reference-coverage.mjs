// Owner-only, resumable coverage census. No Supabase reads or image downloads.
import {baseballSets} from './topps/baseball-seed.mjs';
import {footballSets} from './topps/football-seed.mjs';
import {sectionsForSet} from './baseball-section-pages.mjs';
import {checklistPublicationProblems,footballChecklistPublicationProblems} from './topps/public-checklist-policy.mjs';
import {cardParallelProgram} from './sports-parallels.mjs';
import {referenceConsoles,referenceMetadataCheck,referenceImageKey,REFERENCE_SOURCE_MAPPING_VERSION} from './reference-validation.mjs';
export const coverageSets=()=>[...baseballSets.filter(s=>!checklistPublicationProblems(s,s).length),...footballSets.filter(s=>!footballChecklistPublicationProblems(s).length)];
export function coverageSlotPage(set,offset=0,limit=100){
 const seen=new Set(),slots=[];let n=0,more=false;
 for(const card of [...set.cards,...sectionsForSet(set).flatMap(g=>g.cards)]){
  const base='/'+(set.sport==='football'?'football':'baseball')+'/checklists/'+set.id+'/cards/'+card.id;
  for(const rule of [null,...cardParallelProgram(set,card).variants]){
   const path=base+(rule?'?parallel='+encodeURIComponent(rule.id):'');if(seen.has(path))continue;seen.add(path);
   if(n++<offset)continue;if(slots.length===limit){more=true;break;}
   slots.push({path,setId:set.id,id:card.id,player:card.player,cardNumber:card.cardNumber,section:card.section||'Base',parallel:rule?.name||'',run:rule?.printRun||null,sources:referenceConsoles(set,card)});
  }
  if(more)break;
 }
 return {slots,nextOffset:more?offset+slots.length:null};
}
const json=data=>Response.json(data);
async function getMany(storage,names){const keys=[...names],found=new Map();for(let i=0;i<keys.length;i+=100)for(const [k,v]of await storage.get(keys.slice(i,i+100)))found.set(k,v);return found;}
async function putMany(storage,values){const entries=Object.entries(values);for(let i=0;i<entries.length;i+=100)await storage.put(Object.fromEntries(entries.slice(i,i+100)));}
const source=(env,id)=>env.CARD_REFERENCE_ARCHIVE.get(env.CARD_REFERENCE_ARCHIVE.idFromName('console:'+id));
const key=(job,path)=>'coverage:'+job.startedAt+':path:'+path;
export async function coverageArchiveRequest(object,request){
 const {ctx,env}=object,storage=ctx.storage,url=new URL(request.url);
 if(url.pathname==='/coverage-start'&&request.method==='POST'){
  let job=await storage.get('coverage-job');if(job?.running)return json(job);
  // Repeated clicks resume the same census, including completed results.
  if(job){if(job.phase!=='complete'){job.running=true;delete job.error;await storage.put('coverage-job',job);await storage.setAlarm(Date.now()+1000);}return json(job);}
  const sets=[...(await storage.list({prefix:'set:',limit:500})).values()];
  const mapped=new Set(coverageSets().flatMap(s=>referenceConsoles(s)));
  job={running:true,phase:'sources',startedAt:Date.now(),mappingVersion:REFERENCE_SOURCE_MAPPING_VERSION,sources:sets.filter(s=>mapped.has(s.consoleId)).map(s=>s.consoleId),unmappedSources:sets.filter(s=>!mapped.has(s.consoleId)).map(s=>({consoleId:s.consoleId,records:s.cards,photos:s.photos})),sourceIndex:0,cursor:'',recordsScanned:0,setIndex:0,offset:0,total:0,withReference:0,missing:0,reasons:{},pages:0};
  await storage.put('coverage-job',job);await storage.setAlarm(Date.now()+1000);return json(job);
 }
 if(url.pathname==='/coverage-status'&&request.method==='GET')return json(await storage.get('coverage-job')||{running:false,phase:'not_started'});
 if(url.pathname==='/coverage-report'&&request.method==='GET'){
  const page=Number(url.searchParams.get('page')||0);if(!Number.isInteger(page)||page<0||page>100000)return new Response('Invalid page',{status:400});
  const job=await storage.get('coverage-job'),items=job?await storage.get('coverage:'+job.startedAt+':report:'+page):null;
  return json({items:items||[],nextPage:job&&page+1<job.pages?page+1:null,complete:job?.phase==='complete',total:job?.total||0});
 }
 if(url.pathname==='/coverage-source-page'&&request.method==='GET'){
  const cursor=url.searchParams.get('cursor')||'';if(cursor&&!/^row:[a-z0-9%-]{1,250}$/.test(cursor))return new Response('Invalid cursor',{status:400});
  const rows=await storage.list({prefix:'row:',limit:50,...(cursor?{startAfter:cursor}:{})}),candidates=[];
  // Bulk-read checks already collected by the normal upload validator. This
  // census never changes holds, audits, image health or published metadata.
  const names=new Set();for(const [k,row]of rows){const id=referenceImageKey(row.image);names.add('validation:'+k.slice(4));if(id){names.add('health:'+id);names.add('hold:'+id);}}
  const saved=await getMany(storage,names);
  for(const [k,row]of rows){
   let check=saved.get('validation:'+k.slice(4));if(!check||check.mappingVersion!==REFERENCE_SOURCE_MAPPING_VERSION)check=referenceMetadataCheck(row);
   if(!check.matches?.length)continue;
   const id=referenceImageKey(row.image),health=saved.get('health:'+id),flags=[...(check.flags||[])];
   if(!row.image)flags.push('missing_photo');else if(!health?.ok)flags.push('image_unchecked_or_failed');else if(Date.now()-health.checkedAt>7*86400000)flags.push('image_check_stale');
   if(id&&saved.get('hold:'+id))flags.push('manual_image_hold');
   if(id&&(await storage.list({prefix:'usage:'+id+':',limit:2})).size!==1)flags.push('shared_image_requires_review');
   for(const match of check.matches)candidates.push({path:match.path,eligible:flags.length===0&&check.matches.length===1,reason:flags[0]||'ambiguous_match',image:row.image||null,source:row.url});
  }
  return json({records:rows.size,candidates,cursor:rows.size===50?[...rows.keys()].at(-1):null});
 }
 return null;
}
export async function coverageAlarm(object){
 const {ctx,env}=object,storage=ctx.storage,job=await storage.get('coverage-job');if(!job?.running)return false;
 try{
  if(job.phase==='sources'){
   const id=job.sources[job.sourceIndex];
   if(!id){job.phase='checklists';}
   else{
    const url=new URL('https://archive.internal/coverage-source-page');url.searchParams.set('cursor',job.cursor);
    const response=await source(env,id).fetch(url.href);if(!response.ok)throw Error('Source coverage read failed');const data=await response.json();
    const paths=[...new Set(data.candidates.map(c=>key(job,c.path)))],prior=await getMany(storage,paths),writes={};
    for(const candidate of data.candidates){const k=key(job,candidate.path),old=writes[k]||prior.get(k);if(!old||candidate.eligible&&!old.eligible)writes[k]=candidate;}
    await putMany(storage,writes);job.recordsScanned+=data.records;job.cursor=data.cursor||'';if(!data.cursor)job.sourceIndex++;
   }
  }else{
   const set=coverageSets()[job.setIndex];
   if(!set){job.running=false;job.phase='complete';job.completedAt=Date.now();}
   else{
    const {slots,nextOffset}=coverageSlotPage(set,job.offset),found=slots.length?await storage.get(slots.map(s=>key(job,s.path))):new Map(),items=[];
    for(const slot of slots){const match=found.get(key(job,slot.path));job.total++;if(match?.eligible){job.withReference++;continue;}
     const reason=match?.reason==='missing_photo'?'no_photo_in_collected_sources':match?.reason||'no_verified_matching_reference';job.missing++;job.reasons[reason]=(job.reasons[reason]||0)+1;items.push({...slot,reason,source:match?.source||null});
    }
    if(items.length){await storage.put('coverage:'+job.startedAt+':report:'+job.pages,items);job.pages++;}
    if(nextOffset===null){job.setIndex++;job.offset=0;}else job.offset=nextOffset;
   }
  }
  job.updatedAt=Date.now();delete job.error;await storage.put('coverage-job',job);if(job.running)await storage.setAlarm(Date.now()+1000);
 }catch(error){job.error='Coverage paused: '+error.message;job.running=false;await storage.put('coverage-job',job);}
 return true;
}
