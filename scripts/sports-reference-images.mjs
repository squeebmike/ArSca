import {safeReferenceImage,matchReferenceImage,referenceIdentityMatches,referenceNeedsFinish} from './reference-match.mjs';
export {safeReferenceImage,matchReferenceImage};
import {cachedPublicCatalog} from './public-catalog-cache.mjs';
import {referenceImageSeeds} from './topps/reference-image-seeds.mjs';
import {cloudReferenceFamily} from './cloud-card-references.mjs';
import {referenceConsoles} from './reference-validation.mjs';
import {refreshedReferencePrices} from './reference-price-refresh.mjs';
import {queueViewedReferenceImage} from './reference-image-refresh.mjs';
const fold=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\b([a-z]) ([a-z])\b/g,'$1$2');
const slug=s=>fold(s).replaceAll(' ','-');
const decode=s=>String(s||'').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&nbsp;/g,' ');
const text=s=>decode(s.replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
function consoleSlug(set){return (set.sport==='football'||/football/i.test(set.displayName)?'football':'baseball')+'-cards-'+slug(set.displayName.replace(/\b(?:baseball|football)\b/gi,''));}
export function parseReferenceFamily(html,consoleId){
 if(html.length>2000000)throw Error('Reference response too large');
 const rows=[];
 for(const row of html.matchAll(/<tr\b[^>]*\bid="product-\d+"[^>]*>([\s\S]*?)<\/tr>/gi)){
  const cell=row[1].match(/<td\b[^>]*class="title"[^>]*>([\s\S]*?)<\/td>/i)?.[1]||'';
  const a=cell.match(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i),image=safeReferenceImage(decode(row[1].match(/<img\b[^>]*src="([^"]+)"/i)?.[1]||''));
  if(!a||!image)continue;
  const u=new URL(decode(a[1]),'https://www.sportscardspro.com');
  if(u.protocol!=='https:'||u.username||u.password||!['www.sportscardspro.com','www.pricecharting.com'].includes(u.hostname)||!u.pathname.startsWith('/game/'+consoleId+'/'))continue;
  rows.push({title:text(a[2]),image,url:u.href,run:text(cell.match(/<span\b[^>]*class="list-print-run"[^>]*>([\s\S]*?)<\/span>/i)?.[1]||'')});
 }
 return rows;
}
export function savedReferenceImage(set,card){return matchReferenceImage(referenceImageSeeds[set.id]||[],set,card);}
export async function sportsReferenceImage(env,ctx,set,card,deps={}){
 const consoles=referenceConsoles(set,card);let archived=false,unavailable=false;
 for(const id of consoles){
  const family=await cloudReferenceFamily(env,id,String(card.cardNumber),true),cloud=family.cards||[];archived ||= family.archived;
  unavailable ||= family.unavailable;
  // A shared photo across different finishes is not proof of the printing.
  const reviewed=cloud.filter(r=>!cloud.some(other=>other.url!==r.url&&other.image&&other.image===r.image&&other.title!==r.title));
  const needsFinish=referenceNeedsFinish(set,card),matches=reviewed.filter(row=>(!needsFinish||/\[[^\]]+\]\s*#/.test(row.title))&&referenceIdentityMatches(row,card,set));if(matches.length===1){
   // Stored-reference audits and grid previews never enqueue provider work.
   const reference=await queueViewedReferenceImage(env,matches[0],{refresh:deps.imageRefresh!==false&&deps.priceRefresh!==false&&!deps.requireArchiveRead&&!deps.archiveOnly});
   return {...await refreshedReferencePrices(env,reference,{refresh:deps.priceRefresh!==false}),source:'PriceCharting / SportsCardsPro',referenceOnly:true};
  }
 }
 if(unavailable&&deps.requireArchiveRead)throw Object.assign(new Error('Stored references temporarily unavailable'),{code:'REFERENCE_ARCHIVE_UNAVAILABLE'});
 // An archived collection's holds also govern legacy source-page fallbacks.
 // An unchecked or rejected photo must not reappear from that older cache.
 if(archived)return null;
 const saved=savedReferenceImage(set,card);if(saved)return saved;
 if(deps.archiveOnly)return null;
 // No database/API-key lookup. One cached public family page covers every finish.
 if(!env.LBA_KV)return null;
 try{
  if(await env.LBA_KV.get('sports-reference-provider-paused'))return null;
  const id=consoleSlug(set),key='sports-reference-family-v1:'+set.id+':'+card.cardNumber;
  const rows=await cachedPublicCatalog(env,ctx,key,async signal=>{
   const u=new URL('https://www.sportscardspro.com/console/'+id);u.searchParams.set('model-number',card.cardNumber);
   const r=await (deps.referenceFetch||fetch)(u,{signal,redirect:'error',headers:{Accept:'text/html','User-Agent':'TheManaPocketReferenceImages/1.0 (+https://www.themanapocket.com)'}});
   if(!r.ok){if([403,429,503].includes(r.status))await env.LBA_KV.put('sports-reference-provider-paused','1',{expirationTtl:21600});throw Error('Reference provider unavailable');}
   const size=Number(r.headers.get('Content-Length')||0);if(size>2000000)throw Error('Reference response too large');
   const reader=r.body.getReader();let bytes=0,chunks=[];
   try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2000000)throw Error('Reference response too large');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
   const joined=new Uint8Array(bytes);let at=0;for(const c of chunks){joined.set(c,at);at+=c.length;}
   return parseReferenceFamily(new TextDecoder().decode(joined),id);
  },{freshMs:604800000,maxAgeMs:604800000,staleMs:2592000000,retryMs:21600000,timeoutMs:5000});
  return matchReferenceImage(rows,set,card);
 }catch{return null;}
}
export function referenceImageHtml(image,label,esc){return '<span class="mp-reference-photo">'+(image?.image?'<img src="'+esc(image.image)+'" alt="'+esc(label+' — PriceCharting reference image')+'" width="180" height="240" loading="lazy" decoding="async"><small>PriceCharting reference</small>':'<span class="mp-reference-placeholder" role="img" aria-label="Reference photo unavailable" style="display:flex;flex-direction:column;justify-content:center;gap:12px;aspect-ratio:3/4;width:180px;max-width:100%;margin:auto;border:1px solid currentColor;border-radius:12px;padding:16px;box-sizing:border-box;text-align:center;color:var(--wo-accent,inherit)"><svg viewBox="0 0 64 80" width="48" height="60" aria-hidden="true" style="margin:0 auto"><rect x="8" y="3" width="48" height="74" rx="7" fill="none" stroke="currentColor" stroke-width="3"/><path d="M25 22h14m-11 0v13L18 54q-3 8 7 8h14q10 0 7-8L36 35V22M22 49h20" fill="none" stroke="currentColor" stroke-width="3"/></svg><strong>THE MANA POCKET</strong><span>Reference photo unavailable</span></span>')+referenceDetailsHtml(image,esc)+'</span>';}

export function referenceDetailsHtml(reference,esc){
 if(!reference?.url)return '';
 const prices=reference.referencePrices||{},field=['ungraded','grade9','psa10'].find(k=>prices.currency==='USD'&&Number.isFinite(prices[k])&&prices[k]>0),labels={ungraded:'Ungraded',grade9:'Grade 9',psa10:'PSA 10'};
 const captured=Number.isFinite(Date.parse(prices.capturedAt))?'<small>Price captured '+esc(new Date(prices.capturedAt).toISOString().slice(0,10))+'</small>':'';
 return '<small><a href="'+esc(reference.url)+'" target="_blank" rel="noopener">PriceCharting reference</a> · Not a copy for sale.</small>'+(field?'<small>PriceCharting estimate · '+labels[field]+'</small><strong>$'+prices[field].toFixed(2)+' USD</strong>'+captured+'<small>Estimate only; condition matters. Excludes shipping.</small>':'<small>Estimate unavailable</small>');
}
