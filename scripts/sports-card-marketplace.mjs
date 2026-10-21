import {cachedPublicCatalog} from './public-catalog-cache.mjs';
import {listingMatchesRelease,ebayAffiliateListingUrl} from './article-marketplace.mjs';
const fold=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const token=s=>fold(s).replace(/[^a-z0-9]/g,'');
const escapeRegex=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const FRESH=15*60*1000;

export function sportsListingMatches(listing,card,set,group){
 const title=fold(listing.title),number=String(card.cardNumber||'');
 if(!number||!card.player||!listingMatchesRelease(listing.title,set))return false;
 if(/\b(?:break|digital|reprint|replica|lot|box|boxes|pack|packs|case|cases|sealed)\b|you pick|choose your|complete set|set of/.test(title))return false;
 if(listing.endTime&&Date.parse(listing.endTime)<=Date.now())return false;
 const subjects=card.subjects?.length?card.subjects.map(s=>s.name):[card.player];
 if(!subjects.every(name=>fold(name).replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(w=>w.length>1).every(w=>new RegExp('\\b'+escapeRegex(w)+'\\b').test(title.replace(/[^a-z0-9]+/g,' ')))))return false;
 if(/^\d+$/.test(number)){
  if(!new RegExp('(?:#|\\bno\\.?\\s*)0*'+escapeRegex(number)+'(?![a-z0-9])','i').test(title))return false;
 }else if(!(title.match(/[a-z0-9]+(?:[-–][a-z0-9]+)*/g)||[]).some(t=>token(t)===token(number)))return false;
 if(/variation|parallel/i.test(group.kind)){const words=fold(group.name).replace(/\b(?:base|cards|rookies|chrome|variation|parallel)\b/g,' ').trim().split(/\s+/).filter(Boolean);if(!words.length||!words.every(w=>new RegExp('\\b'+escapeRegex(w)+'\\b').test(title)))return false;}
 if(/auto/i.test(group.kind)&&!(/\b(?:auto|autos|autograph|autographs|signed)\b/.test(title)))return false;
 if(!/auto/i.test(group.kind)&&/\b(?:auto|autograph|signed)\b/.test(title))return false;
 if(!/relic/i.test(group.kind)&&/\b(?:relic|patch|memorabilia)\b/.test(title))return false;
 return true;
}

export async function sportsListings(env,ctx,set,group,deps,{card=null,wait=false}={}){
 const campaign=String(env.EBAY_PARTNER_CAMPAIGN_ID||'');
 if(!/^\d{10}$/.test(campaign)||!env.LBA_KV||!deps.searchEbay)return [];
 const key='sports-checklist-listings-v1:'+campaign+':'+set.id+':'+group.id+':'+(card?.id||'section');
 const load=async signal=>{
  const query=[set.displayName,card?.player,card?.cardNumber,group.name].filter(Boolean).join(' ');
  const result=await deps.searchEbay(query,campaign,signal);
  if(result.warning)throw new Error('Marketplace unavailable');
  const checkedAt=Date.now();
  return (result.listings||[]).filter(l=>ebayAffiliateListingUrl(l.affiliateUrl,campaign)&&/^https:\/\/(?:[^/]+\.)?ebayimg\.com\//.test(l.imageUrl||''))
   .filter(l=>group.cards.some(c=>(!card||card.id===c.id)&&sportsListingMatches(l,c,set,group)))
   .map(l=>({itemId:l.itemId,title:l.title,image:l.imageUrl,href:l.affiliateUrl,price:l.currency==='USD'&&Number.isFinite(Number(l.price))&&Number(l.price)>0?Number(l.price):null,checkedAt,endTime:l.endTime||null}));
 };
 if(wait)return cachedPublicCatalog(env,ctx,key,load,{freshMs:FRESH,maxAgeMs:FRESH,staleMs:FRESH,timeoutMs:6500});
 let saved;try{saved=await env.LBA_KV.get('public-catalog:'+key,'json');}catch{}
 const age=Date.now()-Number(saved?.at);
 if(Array.isArray(saved?.items)&&age>=0&&age<FRESH)return saved.items;
 if(ctx?.waitUntil)ctx.waitUntil(cachedPublicCatalog(env,ctx,key,load,{freshMs:FRESH,maxAgeMs:FRESH,staleMs:FRESH,timeoutMs:6500}).catch(()=>{}));
 return [];
}

export function sportsListingHtml(listing,escape){
 if(!listing)return '';
 return '<aside class="mp-sports-market" style="padding:12px;border:1px solid var(--wo-border,#777);border-radius:10px"><a href="'+escape(listing.href)+'" target="_blank" rel="noopener sponsored"><img src="'+escape(listing.image)+'" alt="'+escape(listing.title+' — seller photo')+'" width="180" height="240" loading="lazy" style="width:100%;height:200px;object-fit:contain"><strong>'+escape(listing.title)+'</strong></a><p>'+(listing.price?'eBay asking price: $'+Number(listing.price).toFixed(2)+' USD':'Price unavailable')+' · shipping extra or as listed</p><p class="mp-meta">Checked '+new Date(listing.checkedAt).toISOString().slice(0,16).replace('T',' ')+' UTC · verify finish and condition.</p></aside>';
}

export const sportsLookupScript=`<script>(function(){document.addEventListener('click',async function(e){var b=e.target.closest('button[data-sports-lookup]');if(!b||b.disabled)return;b.disabled=true;b.textContent='Checking eBay…';var target=b.parentElement.querySelector('[data-sports-result]');try{var r=await fetch(b.dataset.sportsLookup,{headers:{Accept:'application/json'}});if(!r.ok)throw Error('unavailable');var d=await r.json();target.replaceChildren();if(!d.listing){target.textContent='No confident match found. Use the eBay search below to compare copies.';}else{var l=d.listing,a=document.createElement('a'),img=document.createElement('img'),title=document.createElement('strong'),p=document.createElement('p');a.href=l.href;a.target='_blank';a.rel='noopener sponsored';img.src=l.image;img.alt=l.title+' — seller photo';img.width=180;img.height=240;img.style.cssText='width:100%;height:200px;object-fit:contain';title.textContent=l.title;a.append(img,title);p.textContent=(l.price?'eBay asking price: $'+Number(l.price).toFixed(2)+' USD':'Price unavailable')+' · check shipping and condition';target.append(a,p);}}catch(_){target.textContent='Listing lookup is temporarily unavailable. The eBay search remains available.';}b.textContent='Check eBay again';b.disabled=false;});})();</script>`;
