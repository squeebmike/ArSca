import {manaLoaderStyle} from './mana-loader.mjs';
import {matchesParallelPrinting,cardParallelProgram,matchesSerialNumbering} from './sports-parallels.mjs';
import {cachedPublicCatalog} from './public-catalog-cache.mjs';
import {listingMatchesRelease,ebayAffiliateListingUrl} from './article-marketplace.mjs';
const fold=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const token=s=>fold(s).replace(/[^a-z0-9]/g,'');
const escapeRegex=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const FRESH=15*60*1000;
const baseballClubNames=['diamondbacks|d backs|dbacks','braves','orioles','red sox','cubs','white sox','reds','indians|guardians','rockies','tigers','astros','royals','angels','dodgers','marlins','brewers','twins','mets','yankees','athletics','phillies','pirates','padres','giants','mariners','cardinals','rays|devil rays','rangers','blue jays','nationals|expos'].map(s=>s.split('|'));
function conflictingBaseballTeam(title,card,set){
 if(set.sport!=='baseball'&&!/baseball/i.test(set.displayName||''))return false;
 const normalized=s=>fold(s).replace(/[^a-z0-9]+/g,' ').trim();
 const expected=normalized([card.team,...(card.subjects||[]).map(s=>s.team)].filter(Boolean).join(' ')),listed=normalized(title);
 const mentions=(text,aliases)=>aliases.some(alias=>new RegExp('(?:^| )'+escapeRegex(alias)+'(?: |$)').test(text));
 const expectedClubs=baseballClubNames.filter(aliases=>mentions(expected,aliases));
 const listedClubs=baseballClubNames.filter(aliases=>mentions(listed,aliases));
 return expectedClubs.length>0&&listedClubs.length>0&&!listedClubs.some(aliases=>expectedClubs.includes(aliases));
}

export function sportsListingMatches(listing,card,set,group){
 const title=fold(listing.title),number=String(card.cardNumber||'');
 const groupWords=fold(group.name).replace(/\b(?:base|cards|rookie|rookies|variation|parallel)\b/g,' ').trim().split(/\s+/).filter(Boolean);
 const inferredFootball=/football/i.test(set.displayName)&&!/\b(?:baseball|basketball|soccer|hockey|football|nfl)\b/i.test(title)&&/^[a-z]{2,}[-\d]/i.test(number)&&groupWords.length&&groupWords.every(w=>new RegExp('\\b'+escapeRegex(w)+'\\b').test(title));
 const release=/\bchrome\b/i.test(card.section||'')&&!/\bchrome\b/i.test(set.displayName)?{...set,displayName:set.displayName+' Chrome'}:set;
 if(!number||!card.player||!listingMatchesRelease(listing.title+(inferredFootball?' Football':''),release))return false;
 if(conflictingBaseballTeam(listing.title,card,set))return false;
 if(group.id==='base'&&!card.parallelRule){
  // A photo for the ordinary base card must not silently show a parallel.
  const ordinary=title.replace(/\b(?:red sox|white sox|blue jays)\b/g,' ');
  const releaseWords=new Set(fold(set.displayName).split(/\W+/));
  const finishes=['refractor','prism','prizm','foil','gold','silver','bronze','blue','red','green','pink','purple','orange','yellow','black','white','aqua','fuchsia','rainbow','camo','sapphire','variation','parallel','sparkle','speckle','crackle','diamond','wave','lava','holiday','vintage','mirror','negative','acetate','clear','printing','plate','plates','superfractor','ssP','sp'].filter(w=>!releaseWords.has(w.toLowerCase()));
  if(new RegExp('\\b(?:'+finishes.join('|')+')\\b','i').test(ordinary)||/\d\s*\/\s*\d|\/\s*\d|\b1\s+of\s+1\b|\b(?:team color border|true photo|funko|dugout peeks|walk this way)\b/.test(ordinary))return false;
 }
 if(card.parallelRule&&!matchesParallelPrinting(listing.title,card.parallelRule,card.parallelSiblings,card.section))return false;
 const numbering=cardParallelProgram(set,card);
 if(!card.parallelRule&&(numbering.printRun||numbering.maxPrintRun)&&!matchesSerialNumbering(listing.title,numbering))return false;
 if(/\b(?:break|digital|reprint|replica|custom|facsimile|proxy|lot|box|boxes|pack|packs|case|cases|sealed)\b|you pick|choose your|complete set|set of/.test(title))return false;
 if(listing.endTime&&Date.parse(listing.endTime)<=Date.now())return false;
 const subjects=card.subjects?.length?card.subjects.map(s=>s.name):[card.player];
 if(!subjects.every(name=>fold(name).replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(w=>w.length>1).every(w=>new RegExp('\\b'+escapeRegex(w)+'\\b').test(title.replace(/[^a-z0-9]+/g,' ')))))return false;
 if(/^\d+$/.test(number)){
  const explicit=new RegExp('(?:#|\\bno\\.?\\s*)0*'+escapeRegex(number)+'(?![a-z0-9])','i').test(title);
  // Sellers often omit '#'. Do not mistake a serial denominator, year or
  // slab grade for the checklist number when accepting a bare number.
  const identityTitle=title.replace(/\b\d+\s*\/\s*\d+\b|\/\s*\d+\b/g,' ').replace(/\bseries\s+\d+\b/g,' ').replace(/\b(?:psa|bgs|sgc|cgc|csg|tag|hga|gem\s*mint|gem\s*mt)\s*(?:gem\s*mt\s*|mint\s*)?\d+(?:\.\d+)?\b/g,' ');
  const bare=number!==String(set.year)&&new RegExp('(?:^|\\s)0*'+escapeRegex(number)+'(?=\\s|$)').test(identityTitle);
  if(!explicit&&!bare)return false;
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
 const key='sports-checklist-listings-v15:'+campaign+':'+set.id+':'+group.id+':'+(card?.id||'section')+':'+(card?.parallelRule?.id||'family');
 const load=async signal=>{
  // Numeric card numbers recur across base, parallels and autographs. Keep
  // the subset in those searches; prefixed IDs already disambiguate inserts.
  const needsSubset=!card||/^\d+$/.test(String(card.cardNumber));
  const query=[set.displayName.replace(/\b(?:baseball|football|cards)\b/gi,' ').replace(/\s+/g,' ').trim(),card?.player,card?.cardNumber,group.id==='base'&&!card?.parallelRule?'Base':needsSubset?group.name.replace(/\b(?:base|cards|variation)\b/gi,' ').replace(/\s+/g,' ').trim():null,card?.parallelRule?.searchTerm||card?.parallelRule?.name,card?.parallelRule?.printRun?'/'+(card.parallelRule.serialDenominator||card.parallelRule.printRun):null].filter(Boolean).join(' ');
  const eligible=listings=>(listings||[]).filter(l=>ebayAffiliateListingUrl(l.affiliateUrl,campaign)&&/^https:\/\/(?:[^/]+\.)?ebayimg\.com\//.test(l.imageUrl||''))
   .filter(l=>card?sportsListingMatches(l,card,set,group):group.cards.some(c=>sportsListingMatches(l,c,set,group)));
  const result=await deps.searchEbay(query,campaign,signal);
  if(result.warning)throw new Error('Marketplace unavailable');
  let matches=eligible(result.listings);
  // One bounded retry removes publisher-only section wording and the serial
  // search token. Exact release, subset, finish and numbering validation stays.
  const fallback=card?[set.displayName.replace(/\b(?:baseball|football|cards)\b/gi,' ').replace(/\s+/g,' ').trim(),card.player,card.cardNumber,needsSubset&&!card.parallelRule?group.name.replace(/\b(?:base|cards|variation)\b/gi,' ').replace(/\s+/g,' ').trim():null,card.parallelRule?.searchTerm||card.parallelRule?.name].filter(Boolean).join(' '):query;
  if(!matches.length&&fallback!==query&&!signal.aborted){
   const retry=await deps.searchEbay(fallback,campaign,signal);
   if(retry.warning)throw new Error('Marketplace unavailable');
   matches=eligible(retry.listings);
  }
  const checkedAt=Date.now();
  return matches.map(l=>({itemId:l.itemId,title:l.title,image:l.imageUrl,href:l.affiliateUrl,price:l.currency==='USD'&&Number.isFinite(Number(l.price))&&Number(l.price)>0?Number(l.price):null,priceKind:l.priceKind||'buyNow',checkedAt,endTime:l.endTime||null}));
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
 return '<aside class="mp-sports-market" style="padding:12px;border:1px solid var(--wo-border,#777);border-radius:10px"><a href="'+escape(listing.href)+'" target="_blank" rel="noopener sponsored"><img src="'+escape(listing.image)+'" alt="'+escape(listing.title+' — seller photo')+'" width="180" height="240" loading="lazy" style="width:100%;height:200px;object-fit:contain"><strong>'+escape(listing.title)+'</strong></a><p>'+(listing.price?(listing.priceKind==='currentBid'?'eBay auction bid: $':'eBay asking price: $')+Number(listing.price).toFixed(2)+' USD':'Price unavailable')+' · shipping extra or as listed</p><p class="mp-meta">Checked '+new Date(listing.checkedAt).toISOString().slice(0,16).replace('T',' ')+' UTC · Seller-provided title and photo; verify the exact card, finish and serial stamp. One-of-one claims are not authenticated by us.</p></aside>';
}

export const sportsMarketplaceNotice='<aside class="mp-seller-notice"><p class="mp-meta">eBay affiliate links may earn The Mana Pocket a commission. Listing photos, titles and prices come from sellers and are not independently verified.</p><details><summary>Check seller claims before buying</summary><p>A search match is not authentication or confirmation of the exact parallel, print run, serial number, autograph, grade, condition or ownership. Claims such as “1/1,” “eBay 1/1,” “only one,” jersey-number match and first/last print may be inaccurate or seller descriptions rather than publisher facts. Check the actual serial stamp, front/back photos, certification and full listing; ask the seller when unclear. Publisher checklist information is shown separately. Availability, price and shipping can change. Purchases are completed on eBay with the seller under eBay’s terms.</p></details></aside>';
export const sportsLookupScript=manaLoaderStyle+`<script>(function(){
/* data-mp-sports-lookup-runtime */
function renderReference(target,ref){
 var figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption'),link=document.createElement('a');
 img.src=ref.image;img.alt=ref.title+' — PriceCharting reference image';img.width=180;img.height=240;img.loading='lazy';img.decoding='async';
 link.href=ref.url;link.target='_blank';link.rel='noopener';link.textContent='PriceCharting reference';
 caption.append(link,document.createTextNode(' · Not a copy for sale.'));figure.append(img,caption);target.append(figure);
 img.onerror=function(){figure.replaceChildren(document.createTextNode('Reference photo unavailable.'));};
}
async function loadReference(target){
 if(target.dataset.referenceLoaded)return;target.dataset.referenceLoaded='true';
 target.setAttribute('aria-live','polite');target.style.flexDirection='column';target.innerHTML='<span class="mp-mana-wait"><span class="mp-mana-vial" aria-hidden="true"></span><span>Finding card photo…</span></span>';
 try{var r=await fetch(target.dataset.sportsReference,{headers:{Accept:'application/json'}});if(!r.ok)throw Error('unavailable');var d=await r.json();target.replaceChildren();
  if(d.reference||d.listing){var photo=d.reference||d.listing,img=document.createElement('img'),credit=document.createElement('small');img.src=photo.image;img.alt=photo.title+(d.listing?' — eBay seller photo':' — PriceCharting reference image');img.width=180;img.height=240;img.loading='lazy';img.decoding='async';credit.textContent=d.listing?'eBay seller photo':'PriceCharting reference';target.append(img,credit);img.onerror=function(){target.textContent='Reference photo unavailable';};
   if(d.listing){var offer=document.createElement('a');offer.href=photo.href;offer.target='_blank';offer.rel='noopener sponsored';offer.textContent='View this copy on eBay'+(photo.price?' · '+(photo.priceKind==='currentBid'?'Auction bid ':'')+'$'+Number(photo.price).toFixed(2)+' USD':'');var details=target.closest('details.mp-card-parallels');if(details){var p=document.createElement('p');p.append(offer);details.querySelector('summary').after(p);}else{var link=document.createElement('a');link.href=photo.href;link.target='_blank';link.rel='noopener sponsored';link.append(img);target.prepend(link);target.append(offer);}}
  }
  else target.textContent='No exact card photo found';
 }catch(_){target.textContent='Card photo temporarily unavailable';}
}
function compactTarget(target){return !!(target.closest&&target.closest('.mp-parallel-card'));}
function renderListing(target,l){
 var compact=compactTarget(target),a=document.createElement('a'),img=document.createElement('img'),title=document.createElement('strong'),p=document.createElement('p'),note=document.createElement('p');
 a.href=l.href;a.target='_blank';a.rel='noopener sponsored';a.title=l.title;
 img.src=l.image;img.alt=l.title+' — seller photo';img.width=180;img.height=240;img.loading='lazy';img.style.cssText='width:100%;height:200px;object-fit:contain';
 title.textContent=l.title;a.append(img,title);
 p.textContent=(l.price?(l.priceKind==='currentBid'?'eBay auction bid: $':compact?'eBay · $':'eBay asking price: $')+Number(l.price).toFixed(2)+' USD':'Price unavailable')+(compact?'':' · check shipping and condition');
 var grade=l.title.match(/\\b(PSA|BGS|SGC|CGC|CSG|TAG|HGA)\\s*(?:GEM\\s*MT\\s*|MINT\\s*)?(\\d{1,2}(?:\\.\\d)?)/i);
 note.className='mp-meta';note.textContent=compact?(grade?'Seller title: '+grade[1].toUpperCase()+' '+grade[2]+' · Seller photo':'Seller photo · Check serial stamp'):'Seller-provided title and photo. Verify the exact card and serial stamp; one-of-one claims are not authenticated by us.';
 img.onerror=function(){img.hidden=true;note.textContent='Seller photo unavailable. Check the listing for photos and condition.';};
 target.append(a,p,note);
}
async function lookup(b){
 if(b.disabled)return;b.disabled=true;b.innerHTML='<span class="mp-mana-wait"><span class="mp-mana-vial" aria-hidden="true"></span><span>Checking eBay…</span></span>';
 var target=b.parentElement.querySelector('[data-sports-result]');
 try{var r=await fetch(b.dataset.sportsLookup,{headers:{Accept:'application/json'}});if(!r.ok)throw Error('unavailable');var d=await r.json();target.replaceChildren();
  if(!d.listing){if(d.reference)renderReference(target,d.reference);else target.textContent=compactTarget(target)?'No exact listing or reference photo found. Try the finish search below.':'No matching live listing or reference photo found. The eBay search below may show other copies.';}
  else renderListing(target,d.listing);
 }catch(_){target.textContent='Listing lookup is temporarily unavailable. Open this finish for search links.';}
 b.textContent=compactTarget(target)?'Refresh listing':'Check eBay again';b.disabled=false;
}
document.addEventListener('click',function(e){var b=e.target.closest('button[data-sports-lookup]');if(b)lookup(b);});
var queue=[],active=0;
function drain(){if(document.hidden)return;while(active<2&&queue.length){var b=queue.shift();if(!b.isConnected)continue;if(b.getClientRects&&!b.getClientRects().length){observer.observe(b);continue;}active++;(b.dataset.sportsReference?loadReference(b):lookup(b)).finally(function(){active--;drain();});}}
if('IntersectionObserver' in window){var observer=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(!entry.isIntersecting)return;observer.unobserve(entry.target);queue.push(entry.target);});drain();},{rootMargin:'150px'});document.querySelectorAll('button[data-sports-lookup],[data-sports-reference]').forEach(function(b){observer.observe(b);});document.addEventListener('visibilitychange',drain);}
function mountParallelPhotos(details){
 if(!details.open||!details.querySelectorAll)return;
 details.querySelectorAll('[data-sports-preview]').forEach(function(tile){
  if(tile.querySelector('[data-sports-result]'))return;
  var market=document.createElement('div'),target=document.createElement('div'),placeholder=document.createElement('span'),button=document.createElement('button');
  market.className='mp-parallel-market';target.dataset.sportsResult='';target.setAttribute('aria-live','polite');placeholder.className='mp-parallel-placeholder';placeholder.textContent='Matching photo & price will load here.';target.append(placeholder);
  button.type='button';button.dataset.sportsLookup=tile.dataset.sportsPreview;button.textContent='Load photo & price';market.append(target,button);
  tile.insertBefore(market,tile.querySelector('.mp-parallel-search'));
  if(observer)observer.observe(button);
 });
}
document.addEventListener('toggle',function(e){if(e.target&&e.target.matches&&e.target.matches('details.mp-card-parallels'))mountParallelPhotos(e.target);},true);
document.querySelectorAll('details.mp-card-parallels[open]').forEach(mountParallelPhotos);
})();</script>`;
export function withSportsLookups(data){
 if(!(data.bodyHtml?.includes('data-sports-lookup=')||data.bodyHtml?.includes('data-sports-preview=')||data.bodyHtml?.includes('data-sports-reference='))||data.bodyHtml.includes('data-mp-sports-lookup-runtime'))return data;
 return {...data,bodyHtml:data.bodyHtml+sportsLookupScript};
}
