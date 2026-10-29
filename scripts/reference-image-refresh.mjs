// Demand-only metadata refresh. A separate named archive object owns this queue;
// it never enumerates a console, inventory, or the provider product API.
import {safeReferenceImage} from './reference-match.mjs';
export const IMAGE_REFRESH_COORDINATOR='reference-image-global-v1';
const DAY=86400000,GAP=1100,LIMIT=500,MAX_BYTES=2000000;
const failure=(code,status)=>Object.assign(new Error(code),{code,...(status?{status}:{})});
const errorCodes=new Set(['source_timeout','source_network','source_http','source_challenge','unexpected_source_response','unexpected_source_url','source_response_too_large','exact_identity_unavailable','archive_state_unavailable','archive_apply_unavailable']);
const safeError=error=>errorCodes.has(error?.code)?error.code:'coordinator_failure';
const identityFields=['consoleId','productId','url','title','cardNumber','parallel','run'];
export function sameImageReference(a,b){return !!a&&!!b&&identityFields.every(k=>String(a[k]||'')===String(b[k]||''));}
export function validImageReference(r){
 if(!r||!/^\d{1,20}$/.test(r.productId||'')||typeof r.title!=='string'||!r.title||r.title.length>350||! /^[a-z0-9.-]{1,40}$/i.test(r.cardNumber||''))return false;
 if(!/^(baseball|football|hockey|basketball)-cards-[a-z0-9-]+(?:%27[a-z0-9-]+)*$/.test(r.consoleId||'')&&r.consoleId!=='baseball-cards-2026-topps-five-star-stars-&-stitches-autograph')return false;
 try{const u=new URL(r.url);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&['www.sportscardspro.com','www.pricecharting.com'].includes(u.hostname)&&u.pathname.startsWith('/game/'+r.consoleId+'/')&&/^[a-z0-9-]+(?:%27[a-z0-9-]+)*$/.test(u.pathname.slice(('/game/'+r.consoleId+'/').length));}catch{return false;}
}
const decode=s=>String(s||'').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&nbsp;/g,' ');
const text=s=>decode(s.replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
export function parseImageRefreshFamily(html,consoleId){
 if(html.length>MAX_BYTES)throw failure('source_response_too_large');
 if(/cf-chl-|captcha|verify you are human|just a moment/i.test(html))throw failure('source_challenge',403);
 const rows=[];
 for(const match of html.matchAll(/<tr\b[^>]*\bid="product-(\d+)"[^>]*>([\s\S]*?)<\/tr>/gi)){
  const cell=match[2].match(/<td\b[^>]*class="title"[^>]*>([\s\S]*?)<\/td>/i)?.[1]||'',a=cell.match(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);if(!a)continue;
  let u;try{u=new URL(decode(a[1]),'https://www.sportscardspro.com');}catch{continue;}
  const title=text(a[2]),row={consoleId,productId:match[1],url:u.href,title,cardNumber:title.match(/#([^\s]+)\s*$/)?.[1]||'',run:text(cell.match(/<span\b[^>]*class="list-print-run"[^>]*>([\s\S]*?)<\/span>/i)?.[1]||''),parallel:title.match(/\[([^\]]+)\]\s*#/)?.[1]||'',image:safeReferenceImage(decode(match[2].match(/<img\b[^>]*src="([^"]+)"/i)?.[1]||''))||''};
  if(validImageReference(row))rows.push(row);
 }
 return rows;
}
function archive(env,consoleId){return env.CARD_REFERENCE_ARCHIVE.get(env.CARD_REFERENCE_ARCHIVE.idFromName('console:'+consoleId));}
async function internal(env,consoleId,path,data){try{const r=await archive(env,consoleId).fetch(new Request('https://archive.internal/'+path,{method:'POST',body:JSON.stringify(data),signal:AbortSignal.timeout(8000)}));if(!r.ok)throw Error();return await r.json();}catch{throw failure(path==='image-refresh-state'?'archive_state_unavailable':'archive_apply_unavailable');}}
export async function queueViewedReferenceImage(env,reference,{refresh=true}={}){
 if(!refresh||env.REFERENCE_IMAGE_REFRESH_ENABLED!=='1'||!env.CARD_REFERENCE_ARCHIVE||!validImageReference(reference))return reference;
 try{const stub=env.CARD_REFERENCE_ARCHIVE.get(env.CARD_REFERENCE_ARCHIVE.idFromName(IMAGE_REFRESH_COORDINATOR));const r=await stub.fetch(new Request('https://archive.internal/image-refresh-demand',{method:'POST',body:JSON.stringify(reference)}));if(!r.ok)return reference;const state=await r.json();return {...reference,imageRefreshPending:!!state.queued,imageRefreshCheckedAt:state.checkedAt||null,imageRefreshRetryAt:state.retryAt||null,imageRefreshProviderStatus:state.providerStatus||null,imageRefreshProviderError:state.providerError||null};}catch{return reference;}
}
export async function imageRefreshRequest(owner,request){
 if(new URL(request.url).pathname!=='/image-refresh-demand')return null;
 if(owner.env.REFERENCE_IMAGE_REFRESH_ENABLED!=='1')return Response.json({queued:false});
 if(request.method!=='POST')return new Response('Method not allowed',{status:405});
 let ref;try{const body=await request.text();if(body.length>4000)throw Error();ref=JSON.parse(body);}catch{return new Response('Invalid request',{status:400});}
 if(!validImageReference(ref))return new Response('Exact reference required',{status:400});
 return owner.ctx.blockConcurrencyWhile(async()=>{
  const store=owner.ctx.storage,state=await internal(owner.env,ref.consoleId,'image-refresh-state',{expected:ref});
  const diagnostics={providerStatus:await store.get('im-last-provider-status')||null,providerError:await store.get('im-last-provider-error')||null};
  if(!state.row||state.held)return Response.json({queued:false,...diagnostics});
  const row=state.row,key='im-demand:'+row.productId,prior=await store.get('im-cache:'+row.productId),now=Date.now(),fresh=prior&&sameImageReference(prior,row)&&prior.image===row.image&&now-prior.checkedAt<(row.image?7*DAY:DAY);
  let queued=false;
  if(!fresh){const pending=await store.list({prefix:'im-demand:',limit:LIMIT});if(pending.has(key)||pending.size<LIMIT){await store.put('im-mode',true);if(!pending.has(key))await store.put(key,{row,attempts:0,retryAt:now});queued=true;const due=Math.max(now+1,Number(await store.get('im-next')||0),Number(await store.get('im-paused')||0));const alarm=await store.getAlarm();if(!alarm||alarm>due)await store.setAlarm(due);}}
  const retryAt=Math.max(Number(await store.get('im-paused')||0),queued?Number((await store.get(key))?.retryAt||0):0);
  return Response.json({queued,checkedAt:fresh?prior.checkedAt:null,retryAt:retryAt>now?retryAt:null,...diagnostics});
 });
}
async function fetchFamily(owner,row){
 const url=new URL('https://www.sportscardspro.com/console/'+row.consoleId);url.searchParams.set('model-number',row.cardNumber);
 const store=owner.ctx.storage;await store.put('im-last-provider-status',null);await store.put('im-last-provider-error',null);
 let response;try{response=await (owner.env.REFERENCE_METADATA_FETCH||fetch)(url,{signal:AbortSignal.timeout(8000),redirect:'manual',headers:{Accept:'text/html','User-Agent':'TheManaPocketReferenceImages/1.0 (+https://www.themanapocket.com)'}});}catch(error){throw failure(['TimeoutError','AbortError'].includes(error?.name)?'source_timeout':'source_network');}
 await store.put('im-last-provider-status',response.status);
 if(!response.ok)throw failure('source_http',response.status);
 if(response.url&&new URL(response.url).href!==url.href)throw failure('unexpected_source_url');
 if(!response.body||!/text\/html/i.test(response.headers.get('Content-Type')||''))throw failure('unexpected_source_response');
 if(Number(response.headers.get('Content-Length')||0)>MAX_BYTES)throw failure('source_response_too_large');
 const reader=response.body.getReader(),decoder=new TextDecoder();let size=0,html='';
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES)throw failure('source_response_too_large');html+=decoder.decode(value,{stream:true});}html+=decoder.decode();}catch(error){if(errorCodes.has(error?.code))throw error;throw failure(['TimeoutError','AbortError'].includes(error?.name)?'source_timeout':'source_network');}finally{await reader.cancel().catch(()=>{});}
 const rows=parseImageRefreshFamily(html,row.consoleId),matches=rows.filter(r=>sameImageReference(r,row));
 if(matches.length!==1)throw failure('exact_identity_unavailable');
 const candidate=matches[0];
 // Source families can reuse generic artwork before sibling rows are imported.
 // Apply the same ambiguity gate as archive reads before any first publication.
 if(candidate.image&&rows.some(other=>other.url!==candidate.url&&other.title!==candidate.title&&other.image===candidate.image))return {...candidate,image:''};
 return candidate;
}
export async function imageRefreshAlarm(owner){
 const store=owner.ctx.storage;if(!await store.get('im-mode'))return false;
 // Consume this dedicated coordinator's wakeup while disabled. Persisted work
 // remains intact and cannot fall through into another archive alarm handler.
 if(owner.env.REFERENCE_IMAGE_REFRESH_ENABLED!=='1')return true;
 await owner.ctx.blockConcurrencyWhile(async()=>{
  const pending=await store.list({prefix:'im-demand:',limit:LIMIT});if(!pending.size)return;
  const [key,demand]=[...pending].sort((a,b)=>(a[1].retryAt||0)-(b[1].retryAt||0))[0],now=Date.now(),due=Math.max(demand.retryAt||0,Number(await store.get('im-next')||0),Number(await store.get('im-paused')||0));
  if(due>now){await store.setAlarm(due);return;}
  try{
   const current=await internal(owner.env,demand.row.consoleId,'image-refresh-state',{expected:demand.row});
   if(!current.row||current.held||current.row.image!==demand.row.image){await store.delete(key);}
   else{
    await store.put('im-next',Date.now()+GAP);
    const observed=await fetchFamily(owner,demand.row),result=await internal(owner.env,demand.row.consoleId,'image-refresh-apply',{expected:demand.row,observed});
    if(result.applied||result.checked)await store.put('im-cache:'+demand.row.productId,{...demand.row,image:result.image||demand.row.image,checkedAt:Date.now()});
    await store.delete(key);
   }
  }catch(error){
   await store.put('im-last-provider-error',safeError(error));
   const attempts=(demand.attempts||0)+1,retryAt=Date.now()+Math.min(6*3600000,60000*2**Math.min(attempts-1,8));
   await store.put(key,{...demand,attempts,retryAt});
   // Challenge, quota, and transport failures share a persistent host pause.
   await store.put('im-paused',Date.now()+([403,429,503].includes(error.status)?6*3600000:60000));
  }
  const remaining=await store.list({prefix:'im-demand:',limit:LIMIT});if(remaining.size)await store.setAlarm(Math.max(Date.now()+1,Math.min(...[...remaining.values()].map(r=>r.retryAt||0)),Number(await store.get('im-next')||0),Number(await store.get('im-paused')||0)));
 });
 return true;
}
