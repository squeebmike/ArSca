import {manaLoaderStyle} from './mana-loader.mjs';
import {matchesParallelPrinting} from './sports-parallels.mjs';
import {cachedPublicCatalog} from './public-catalog-cache.mjs';
import {listingMatchesRelease,ebayAffiliateListingUrl} from './article-marketplace.mjs';
const fold=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const token=s=>fold(s).replace(/[^a-z0-9]/g,'');
const escapeRegex=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const FRESH=15*60*1000;

export function sportsListingMatches(listing,card,set,group){
 const title=fold(listing.title),number=String(card.cardNumber||'');
 const groupWords=fold(group.name).replace(/\b(?:base|cards|rookie|rookies|variation|parallel)\b/g,' ').trim().split(/\s+/).filter(Boolean);
 const inferredFootball=/football/i.test(set.displayName)&&!/\b(?:baseball|basketball|soccer|hockey|football|nfl)\b/i.test(title)&&/^[a-z]{2,}[-\d]/i.test(number)&&groupWords.length&&groupWords.every(w=>new RegExp('\\b'+escapeRegex(w)+'\\b').test(title));
 const release=/\bchrome\b/i.test(card.section||'')&&!/\bchrome\b/i.test(set.displayName)?{...set,displayName:set.displayName+' Chrome'}:set;
 if(!number||!card.player||!listingMatchesRelease(listing.title+(inferredFootball?' Football':''),release))return false;
 if(card.parallelRule&&!matchesParallelPrinting(listing.title,card.parallelRule,card.parallelSiblings))return false;
 if(/\b(?:break|digital|reprint|replica|custom|facsimile|proxy|lot|box|boxes|pack|packs|case|cases|sealed)\b|you pick|choose your|complete set|set of/.test(title))return false;
 if(listing.endTime&&Date.parse(listing.endTime)<=Date.now())return false;
 const subjects=card.subjects?.length?card.subjects.map(s=>s.name):[card.player];
 if(!subjects.every(name=>fold(name).replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(w=>w.length>1).every(w=>new RegExp('\\b'+escapeRegex(w)+'\\b').test(title.replace(/[^a-z0-9]+/g,' ')))))return false;
 if(/^\d+$/.test(number)){
  if(!new RegExp('(?:#|\\bno\\.?\\s*)0*'+escapeRegex(number)+'(?![a-z0-9])','i').test(title))return false;
 }else if(!(title.match(/[a-z0-9]+(?:[-–][a-z0-9]+)*/g)||[]).some(t=>token(t)===token(number)))return false;
 if(group.matchTerms){if(!group.matchTerms.every(options=>options.some(pattern=>new RegExp(pattern,'i').test(title))))return false;if((group.excludeTerms||[]).some(pattern=>new RegExp(pattern,'i').test(title)))return false;}
 else if(/variation|parallel/i.test(group.kind)){const words=fold(group.name).replace(/\b(?:base|cards|rookies|chrome|variation|parallel)\b/g,' ').trim().split(/\s+/).filter(Boolean);if(!words.length||!words.every(w=>new RegExp('\\b'+escapeRegex(w)+'\\b').test(title)))return false;}
 if(/auto/i.test(group.kind)&&!(/\b(?:auto|autos|autograph|autographs|signed)\b/.test(title)))return false;
 if(!/auto/i.test(group.kind)&&/\b(?:auto|autograph|signed)\b/.test(title))return false;
 if(!/relic/i.test(group.kind)&&/\b(?:relic|patch|memorabilia)\b/.test(title))return false;
 return true;
}

export async function sportsListings(env,ctx,set,group,deps,{card=null,wait=false}={}){
 const campaign=String(env.EBAY_PARTNER_CAMPAIGN_ID||'');
 if(!/^\d{10}$/.test(campaign)||!env.LBA_KV||!deps.searchEbay)return [];
 const key='sports-checklist-listings-v5:'+campaign+':'+set.id+':'+group.id+':'+(card?.id||'section')+':'+(card?.parallelRule?.id||'family');
 const load=async signal=>{
  // Numeric card numbers recur across base, parallels and autographs. Keep
  // the subset in those searches; prefixed IDs already disambiguate inserts.
  const needsSubset=!card||/^\d+$/.test(String(card.cardNumber));
  const query=[set.displayName.replace(/\b(?:baseball|football|cards)\b/gi,' ').replace(/\s+/g,' ').trim(),card?.player,card?.cardNumber,needsSubset?group.name.replace(/\b(?:base|cards|variation)\b/gi,' ').replace(/\s+/g,' ').trim():null,card?.parallelRule?.name,card?.parallelRule?.printRun?'/'+(card.parallelRule.serialDenominator||card.parallelRule.printRun):null].filter(Boolean).join(' ');
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
 return '<aside class="mp-sports-market" style="padding:12px;border:1px solid var(--wo-border,#777);border-radius:10px"><a href="'+escape(listing.href)+'" target="_blank" rel="noopener sponsored"><img src="'+escape(listing.image)+'" alt="'+escape(listing.title+' — seller photo')+'" width="180" height="240" loading="lazy" style="width:100%;height:200px;object-fit:contain"><strong>'+escape(listing.title)+'</strong></a><p>'+(listing.price?'eBay asking price: $'+Number(listing.price).toFixed(2)+' USD':'Price unavailable')+' · shipping extra or as listed</p><p class="mp-meta">Checked '+new Date(listing.checkedAt).toISOString().slice(0,16).replace('T',' ')+' UTC · Seller-provided title and photo; verify the exact card, finish and serial stamp. One-of-one claims are not authenticated by us.</p></aside>';
}

export const sportsMarketplaceNotice='<aside class="mp-seller-notice"><p class="mp-meta">eBay affiliate links may earn The Mana Pocket a commission. Listing photos, titles and prices come from sellers and are not independently verified.</p><details><summary>Check seller claims before buying</summary><p>A search match is not authentication or confirmation of the exact parallel, print run, serial number, autograph, grade, condition or ownership. Claims such as “1/1,” “eBay 1/1,” “only one,” jersey-number match and first/last print may be inaccurate or seller descriptions rather than publisher facts. Check the actual serial stamp, front/back photos, certification and full listing; ask the seller when unclear. Publisher checklist information is shown separately. Availability, price and shipping can change. Purchases are completed on eBay with the seller under eBay’s terms.</p></details></aside>';
export const sportsLookupScript=manaLoaderStyle+`<script>(function(){
async function lookup(b){if(b.disabled)return;b.disabled=true;b.innerHTML='<span class="mp-mana-wait"><span class="mp-mana-vial" aria-hidden="true"></span><span>Checking eBay…</span></span>';var target=b.parentElement.querySelector('[data-sports-result]');try{var r=await fetch(b.dataset.sportsLookup,{headers:{Accept:'application/json'}});if(!r.ok)throw Error('unavailable');var d=await r.json();target.replaceChildren();if(!d.listing){target.textContent='No matching live listing found. The eBay search below may show other copies.';}else{var l=d.listing,a=document.createElement('a'),img=document.createElement('img'),title=document.createElement('strong'),p=document.createElement('p'),note=document.createElement('p');a.href=l.href;a.target='_blank';a.rel='noopener sponsored';img.src=l.image;img.alt=l.title+' — seller photo';img.width=180;img.height=240;img.style.cssText='width:100%;height:200px;object-fit:contain';title.textContent=l.title;a.append(img,title);p.textContent=(l.price?'eBay asking price: $'+Number(l.price).toFixed(2)+' USD':'Price unavailable')+' · check shipping and condition';note.className='mp-meta';note.textContent='Seller-provided title and photo. Verify the exact card and serial stamp; one-of-one claims are not authenticated by us.';target.append(a,p,note);}}catch(_){target.textContent='Listing lookup is temporarily unavailable. The eBay search remains available.';}b.textContent='Check eBay again';b.disabled=false;}
document.addEventListener('click',function(e){var b=e.target.closest('button[data-sports-lookup]');if(b)lookup(b);});
var queue=[],active=0;function drain(){if(document.hidden)return;while(active<2&&queue.length){var b=queue.shift();if(!b.isConnected)continue;active++;lookup(b).finally(function(){active--;drain();});}}
if('IntersectionObserver' in window){var observer=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(!entry.isIntersecting)return;observer.unobserve(entry.target);queue.push(entry.target);});drain();},{rootMargin:'150px'});document.querySelectorAll('button[data-sports-lookup]').forEach(function(b){observer.observe(b);});document.addEventListener('visibilitychange',drain);}
})();</script>`;
