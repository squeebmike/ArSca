import {safeReferenceImage,matchReferenceImage} from './reference-match.mjs';
export {safeReferenceImage,matchReferenceImage};
import {cachedPublicCatalog} from './public-catalog-cache.mjs';
import {referenceImageSeeds} from './topps/reference-image-seeds.mjs';
import {cloudReferenceFamily} from './cloud-card-references.mjs';
import {referenceConsoles} from './reference-validation.mjs';
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
 const consoles=referenceConsoles(set,card);
 for(const id of consoles){
  const cloud=await cloudReferenceFamily(env,id,String(card.cardNumber));
  // A shared photo across different finishes is not proof of the printing.
  const reviewed=cloud.filter(r=>!cloud.some(other=>other.url!==r.url&&other.image&&other.image===r.image&&other.title!==r.title));
  const match=matchReferenceImage(reviewed,set,card);if(match)return match;
 }
 const saved=savedReferenceImage(set,card);if(saved)return saved;
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
export function referenceImageHtml(image,label,esc){return '<span class="mp-reference-photo">'+(image?'<img src="'+esc(image.image)+'" alt="'+esc(label+' — PriceCharting reference image')+'" width="180" height="240" loading="lazy" decoding="async"><small>PriceCharting reference</small>':'<span class="mp-reference-placeholder">Card reference photo</span>')+'</span>';}
