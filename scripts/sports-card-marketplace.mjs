import {manaLoaderStyle} from './mana-loader.mjs';
import {matchesParallelPrinting,cardParallelProgram,matchesSerialNumbering} from './sports-parallels.mjs';
import {cachedPublicCatalog} from './public-catalog-cache.mjs';
import {listingMatchesRelease,ebayAffiliateListingUrl} from './article-marketplace.mjs';
const fold=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const token=s=>fold(s).replace(/[^a-z0-9]/g,'');
const personWords=s=>fold(s).replace(/[^a-z0-9]+/g,' ').trim().replace(/\b([a-z]) ([a-z])\b/g,'$1$2');
const sellerSubsetPattern=pattern=>pattern.replace(/\\bautographs?\\b/g,'\\b(?:auto|autos|autograph|autographs|signed)\\b');
const escapeRegex=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const FRESH=3*60*60*1000;
const RETAIN=(6*60-5)*60*1000;
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
 if((group.id==='base'||group.kind==='Prospects')&&!card.parallelRule){
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
 if(!subjects.every(name=>personWords(name).split(/\s+/).filter(w=>w.length>1).every(w=>new RegExp('\\b'+escapeRegex(w)+'\\b').test(personWords(title)))))return false;
 if(/^\d+$/.test(number)){
  const explicit=new RegExp('(?:#|\\bno\\.?\\s*)0*'+escapeRegex(number)+'(?![a-z0-9])','i').test(title);
  // Sellers often omit '#'. Do not mistake a serial denominator, year or
  // slab grade for the checklist number when accepting a bare number.
  const identityTitle=title.replace(/\b\d+\s*\/\s*\d+\b|\/\s*\d+\b/g,' ').replace(/\bseries\s+\d+\b/g,' ').replace(/\b(?:psa|bgs|sgc|cgc|csg|tag|hga|gem\s*mint|gem\s*mt)\s*(?:gem\s*mt\s*|mint\s*)?\d+(?:\.\d+)?\b/g,' ');
  const bare=number!==String(set.year)&&new RegExp('(?:^|\\s)0*'+escapeRegex(number)+'(?=\\s|$)').test(identityTitle);
  if(!explicit&&!bare)return false;
 }else if(!(title.match(/[a-z0-9]+(?:[-–][a-z0-9]+)*/g)||[]).some(t=>token(t)===token(number)))return false;
 if(group.matchTerms){if(!group.matchTerms.every(options=>options.some(pattern=>new RegExp(sellerSubsetPattern(pattern),'i').test(title))))return false;if((group.excludeTerms||[]).some(pattern=>new RegExp(pattern,'i').test(title)))return false;}
 else if(/variation|parallel/i.test(group.kind)){const words=fold(group.name).replace(/\b(?:base|cards|rookies|chrome|variation|parallel)\b/g,' ').trim().split(/\s+/).filter(Boolean);if(!words.length||!words.every(w=>new RegExp('\\b'+escapeRegex(w)+'\\b').test(title)))return false;}
 if(/auto/i.test(group.kind)&&(!/\b(?:auto|autos|autograph|autographs|signed)\b/.test(title)||/\bunsigned\b|\b(?:no|non|not)[\s-]+(?:auto|autos|autograph|autographs|signed)\b/.test(title)))return false;
 if(!/auto/i.test(group.kind)&&/\b(?:auto|autos|autograph|autographs|signed)\b/.test(title))return false;
 if(!/relic/i.test(group.kind)&&/\b(?:relic|patch|memorabilia)\b/.test(title))return false;
 return true;
}

export async function sportsListings(env,ctx,set,group,deps,{card=null,wait=false}={}){
 const campaign=String(env.EBAY_PARTNER_CAMPAIGN_ID||'');
 if(!/^\d{10}$/.test(campaign)||!env.LBA_KV||!deps.searchEbay)return [];
 const key='sports-checklist-listings-v15:'+campaign+':'+set.id+':'+group.id+':'+(card?.id||'section')+':'+(card?.parallelRule?.id||'family');
 const load=async signal=>{
  const pause=await env.LBA_KV.get('sports-ebay-photo-pause','json');
  if(Number(pause?.until)>Date.now())throw new Error('Marketplace unavailable HTTP 429');
  const check=async result=>{
   if(!result.warning)return;
   const status=result.warning.match(/Browse API (\d{3})/)?.[1];
   if(status==='429'){
    const reset=Date.parse(result.rateLimit?.retryAt),now=Date.now(),until=Number.isFinite(reset)&&reset>now&&reset<=now+86405000?Math.max(now+300000,reset):now+300000;
    await env.LBA_KV.put('sports-ebay-photo-pause',JSON.stringify({until,quotaExhausted:result.rateLimit?.exhausted===true}),{expirationTtl:Math.ceil((until-now)/1000)});
   }
   throw new Error('Marketplace unavailable'+(status?' HTTP '+status:''));
  };
  // Numeric card numbers recur across base, parallels and autographs. Keep
  // the subset in those searches; prefixed IDs already disambiguate inserts.
  const needsSubset=!card||/^\d+$/.test(String(card.cardNumber));
  const query=[set.displayName.replace(/\b(?:baseball|football|cards)\b/gi,' ').replace(/\s+/g,' ').trim(),card?.player,card?.cardNumber,group.id==='base'&&!card?.parallelRule?'Base':needsSubset?group.name.replace(/\b(?:base|cards|variation)\b/gi,' ').replace(/\s+/g,' ').trim():null,card?.parallelRule?.searchTerm||card?.parallelRule?.name,card?.parallelRule?.printRun?'/'+(card.parallelRule.serialDenominator||card.parallelRule.printRun):null].filter(Boolean).join(' ');
  const eligible=listings=>(listings||[]).filter(l=>ebayAffiliateListingUrl(l.affiliateUrl,campaign)&&/^https:\/\/(?:[^/]+\.)?ebayimg\.com\//.test(l.imageUrl||''))
   .filter(l=>card?sportsListingMatches(l,card,set,group):group.cards.some(c=>sportsListingMatches(l,c,set,group)));
  const result=await deps.searchEbay(query,campaign,signal);
  await check(result);
  let checkedAt=Number(result.checkedAt)||Date.now();
  let matches=eligible(result.listings);
  // One bounded retry: prefixed card IDs can search without a seller's exact
  // player-name spelling. Numeric IDs retain the player and subset. Returned
  // listings still pass the same full identity/finish/serial checks.
  const fallback=card?[set.displayName.replace(/\b(?:baseball|football|cards)\b/gi,' ').replace(/\s+/g,' ').trim(),needsSubset?card.player:null,String(card.cardNumber).replace(/\.+$/,''),needsSubset&&!card.parallelRule?group.name.replace(/\b(?:base|cards|variation)\b/gi,' ').replace(/\s+/g,' ').trim():null,card.parallelRule?.searchTerm||card.parallelRule?.name].filter(Boolean).join(' '):query;
  if(!matches.length&&fallback!==query&&!signal.aborted){
   const retry=await deps.searchEbay(fallback,campaign,signal);
   await check(retry);
   matches=eligible(retry.listings);
   checkedAt=Number(retry.checkedAt)||Date.now();
  }
  return {at:checkedAt,items:matches.map(l=>({itemId:l.itemId,title:l.title,image:l.imageUrl,href:l.affiliateUrl,price:l.currency==='USD'&&Number.isFinite(Number(l.price))&&Number(l.price)>0?Number(l.price):null,priceKind:l.priceKind||'buyNow',checkedAt,endTime:l.endTime||null}))};
 };
 // Reapply exact identity rules to shared entries saved by older matchers.
 // Rejecting an obsolete cached match must not trigger an API stampede.
 const live=items=>items.filter(l=>(!l.endTime||Date.parse(l.endTime)>Date.now())&&(!card||sportsListingMatches(l,card,set,group)));
 if(wait)return live(await cachedPublicCatalog(env,ctx,key,load,{freshMs:FRESH,maxAgeMs:FRESH,staleMs:RETAIN,timeoutMs:9500}));
 let saved;try{saved=await env.LBA_KV.get('public-catalog:'+key,'json');}catch{}
 const age=Date.now()-Number(saved?.at);
 if(Array.isArray(saved?.items)&&age>=0&&age<RETAIN)return live(saved.items);
 // HTML requests, including crawler visits, only read cached marketplace data.
 // Visible card controls perform bounded refreshes through the JSON endpoints.
 return [];
}

export async function sportsMarketplaceFailure(env,error){
 let pause;try{pause=await env.LBA_KV?.get('sports-ebay-photo-pause','json');}catch{}
 const active=Number(pause?.until)>Date.now();
 return {marketplaceUnavailable:true,providerStatus:active?429:Number(error?.message?.match(/HTTP (\d{3})/)?.[1])||null,...(active?{retryAt:new Date(pause.until).toISOString(),quotaExhausted:pause.quotaExhausted===true}:{})};
}

export function sportsListingHtml(listing,escape){
 if(!listing)return '';
 return '<aside class="mp-sports-market" style="padding:12px;border:1px solid var(--wo-border,#777);border-radius:10px"><a href="'+escape(listing.href)+'" target="_blank" rel="noopener sponsored"><img src="'+escape(listing.image)+'" alt="'+escape(listing.title+' — seller photo')+'" width="180" height="240" loading="lazy" style="width:100%;height:200px;object-fit:contain"><strong>'+escape(listing.title)+'</strong></a><p>'+(listing.price?(listing.priceKind==='currentBid'?'eBay auction bid: $':'eBay asking price: $')+Number(listing.price).toFixed(2)+' USD':'Price unavailable')+' · shipping extra or as listed</p><p class="mp-meta">Checked '+new Date(listing.checkedAt).toISOString().slice(0,16).replace('T',' ')+' UTC · Seller-provided title and photo; verify the exact card, finish and serial stamp. One-of-one claims are not authenticated by us.</p></aside>';
}

export function sportsOfferSlotHtml(path,esc){return '<section class="mp-ebay-copy"><h2>Find a copy on eBay</h2><div data-sports-result aria-live="polite"></div><button type="button" data-sports-lookup="'+esc(path+'?market=1')+'">Find an eBay listing</button><small>Seller photos and asking prices · Affiliate links may earn us a commission. Verify the exact finish, serial stamp and condition.</small></section>';}

export const sportsMarketplaceNotice='<aside class="mp-seller-notice"><p class="mp-meta">eBay affiliate links may earn The Mana Pocket a commission. Listing photos, titles and prices come from sellers and are not independently verified.</p><details><summary>Check seller claims before buying</summary><p>A search match is not authentication or confirmation of the exact parallel, print run, serial number, autograph, grade, condition or ownership. Claims such as “1/1,” “eBay 1/1,” “only one,” jersey-number match and first/last print may be inaccurate or seller descriptions rather than publisher facts. Check the actual serial stamp, front/back photos, certification and full listing; ask the seller when unclear. Publisher checklist information is shown separately. Availability, price and shipping can change. Purchases are completed on eBay with the seller under eBay’s terms.</p></details></aside>';
export const sportsLookupScript=manaLoaderStyle+`<style>
.mp-reference-figure{margin:0;text-align:center}.mp-reference-figure img{display:block;max-width:100%;object-fit:contain;margin:auto}.mp-reference-figure figcaption{font:12px/1.5 system-ui;margin:8px 0;color:var(--wo-muted,inherit)}
.mp-parallel-reference{min-width:0;grid-template-columns:minmax(0,1fr);width:100%;max-width:100%;box-sizing:border-box}.mp-parallel-reference>*{min-width:0;max-width:100%}.mp-reference-unavailable,.mp-reference-placeholder{width:100%!important;max-width:180px!important;min-width:0;box-sizing:border-box!important;overflow-wrap:anywhere}.mp-reference-unavailable strong,.mp-reference-placeholder strong{font:700 12px/1.4 system-ui!important;letter-spacing:normal!important}.mp-parallel-card .mp-reference-unavailable,.mp-parallel-card .mp-reference-placeholder{padding:10px!important;gap:8px!important;font:600 12px/1.4 system-ui!important}
.mp-reference-figure figcaption,.mp-reference-figure figcaption a{font:12px/1.5 system-ui!important;letter-spacing:normal!important;text-transform:none!important}.mp-ebay-copy [data-sports-result] strong{font:650 14px/1.5 system-ui!important}
.mp-reference-estimate{display:block;margin-top:8px;font:12px/1.5 system-ui;text-align:center}.mp-reference-estimate strong{display:block;font:700 16px/1.5 system-ui!important}.mp-reference-estimate small{display:block;font:11px/1.5 system-ui!important;letter-spacing:normal!important;text-transform:none!important}.mp-reference-estimate select{display:block;width:100%;min-height:44px;margin:6px 0;padding:6px;border:1px solid var(--wo-border,#777);border-radius:6px;color:var(--wo-text,inherit);background:var(--wo-surface,#292430);font:12px system-ui}
.mp-card-shopping [data-sports-result],.mp-sports-market{display:flow-root}.mp-card-shopping [data-sports-result] img,.mp-sports-market img{width:90px!important;height:120px!important;float:left;margin:0 14px 8px 0}.mp-card-shopping [data-sports-result] strong{font:650 14px/1.5 system-ui}.mp-parallel-card [data-sports-result]{min-height:0}
.mp-parallel-market>[hidden]{display:none!important}
.mp-card-reference{width:180px;flex-basis:180px;min-height:240px}.mp-card-reference img,.mp-reference-photo img{width:180px;height:240px}.mp-parallel-reference{min-height:230px;display:grid;place-items:center;text-align:center;font:12px/1.5 system-ui}.mp-parallel-reference img{width:100%;height:210px;object-fit:contain}.mp-parallel-reference figcaption a{display:inline!important;border:0!important;font:12px/1.5 system-ui!important}
.mp-offer-label{display:block;border-top:1px solid var(--wo-border,#777);padding-top:12px;margin-top:12px;font-weight:700!important}.mp-parallel-card [data-sports-result] img{width:72px!important;height:96px!important;float:left;margin:0 10px 4px 0}.mp-parallel-card [data-sports-result]{display:flow-root}.mp-parallel-card [data-sports-result] strong{font-size:12px!important}.mp-ebay-action{display:block;margin-top:8px;font:700 13px/1.5 system-ui}.mp-parallel-placeholder{min-height:60px!important}.mp-own-copy{border-top:1px solid var(--wo-border,#777);padding-top:12px;margin-top:12px}.mp-ebay-copy{padding:16px;border:1px solid var(--wo-border,#777);border-radius:12px;margin:20px 0}.mp-ebay-copy h2{font:700 18px/1.4 system-ui}.mp-ebay-copy [data-sports-result] img{width:90px!important;height:120px!important;float:left;margin:0 14px 8px 0}.mp-ebay-copy [data-sports-result]{display:flow-root}.mp-ebay-copy button{min-height:44px;padding:10px 14px;border:1px solid var(--wo-border,#777);border-radius:8px;background:var(--wo-button);color:var(--wo-on-button);font:600 14px system-ui;cursor:pointer}.mp-ebay-copy small{display:block;font:12px/1.5 system-ui;margin-top:10px}
@media(max-width:600px){.mp-card-reference{width:140px;flex-basis:140px;min-height:190px}.mp-card-reference img,.mp-reference-photo img{width:140px;height:190px}.mp-card-parallels ul.mp-parallel-gallery{grid-template-columns:repeat(2,minmax(0,1fr))}.mp-parallel-card{min-width:0}.mp-parallel-reference{min-height:220px}.mp-parallel-card [data-sports-result] img{float:none;margin:0 auto 8px}.mp-parallel-card [data-sports-result] strong{display:none!important}}
</style><script>(function(){
/* data-mp-sports-lookup-runtime */
function pausedPhotoText(data){var time=Date.parse(data.retryAt);return Number.isFinite(time)?'eBay photos paused until '+new Date(time).toLocaleString():'eBay photos temporarily unavailable';}
function renderEstimate(figure,ref){
 var box=document.createElement('span'),label=document.createElement('small'),amount=document.createElement('strong'),note=document.createElement('small'),prices=ref.referencePrices||{};
 box.className='mp-reference-estimate';var fields=[['ungraded','Ungraded'],['grade9','Grade 9'],['psa10','PSA 10']].filter(function(pair){return prices.currency==='USD'&&typeof prices[pair[0]]==='number'&&Number.isFinite(prices[pair[0]])&&prices[pair[0]]>0;});
 if(!fields.length){label.textContent='Estimate unavailable';box.append(label);figure.append(box);return;}
 function choose(pair){label.textContent='PriceCharting estimate · '+pair[1];amount.textContent=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(prices[pair[0]])+' USD';}
 choose(fields[0]);box.append(label,amount);
 if(fields.length>1){var select=document.createElement('select');select.setAttribute('aria-label','PriceCharting grade for '+ref.title);fields.forEach(function(pair){var option=document.createElement('option');option.value=pair[0];option.textContent=pair[1];select.append(option);});select.onchange=function(){choose(fields.find(function(pair){return pair[0]===select.value;})||fields[0]);};box.append(select);}
 var date=Date.parse(prices.capturedAt);note.textContent=(Number.isFinite(date)?'Collected '+new Intl.DateTimeFormat('en-US',{year:'numeric',month:'short',day:'numeric'}).format(new Date(date))+' · ':'')+'Estimate only; condition matters. Excludes shipping.';box.append(note);figure.append(box);
}
function missingReference(target,temporary){
 target.replaceChildren();var box=document.createElement('span');box.className='mp-reference-unavailable';box.setAttribute('role','img');box.setAttribute('aria-label',temporary?'Card photo temporarily unavailable':'Reference photo unavailable');
 box.style.cssText='display:flex;box-sizing:border-box;flex-direction:column;align-items:center;justify-content:center;gap:12px;width:180px;max-width:100%;aspect-ratio:3/4;margin:auto;padding:18px;border:1px solid currentColor;border-radius:12px;background:var(--wo-surface,transparent);color:var(--wo-accent,inherit);text-align:center;font:600 13px/1.5 system-ui';
 box.innerHTML='<svg viewBox="0 0 64 80" width="48" height="60" aria-hidden="true"><rect x="8" y="3" width="48" height="74" rx="7" fill="none" stroke="currentColor" stroke-width="3"/><path d="M25 22h14m-11 0v13L18 54q-3 8 7 8h14q10 0 7-8L36 35V22M22 49h20" fill="none" stroke="currentColor" stroke-width="3"/></svg><strong>THE MANA POCKET</strong>';
 var label=document.createElement('span');label.textContent=temporary?'Photo temporarily unavailable':'Reference photo unavailable';box.append(label);target.append(box);
}
function renderReference(target,ref){
 var figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption'),link=document.createElement('a');
 img.src=ref.image;img.alt=ref.title+' — PriceCharting reference image';img.width=180;img.height=240;img.loading='lazy';img.decoding='async';
 link.href=ref.url;link.target='_blank';link.rel='noopener';link.textContent='PriceCharting reference';
 figure.className='mp-reference-figure';caption.append(link,document.createTextNode(' · Not a copy for sale.'));figure.append(img,caption);renderEstimate(figure,ref);target.append(figure);
 img.onerror=function(){missingReference(figure,true);};
}
async function loadReference(target){
 if(target.dataset.referenceLoaded)return;target.dataset.referenceLoaded='true';
 target.setAttribute('aria-live','polite');target.style.flexDirection='column';target.innerHTML='<span class="mp-mana-wait"><span class="mp-mana-vial" aria-hidden="true"></span><span>Finding card photo…</span></span>';
 try{var r=await fetch(target.dataset.sportsReference,{headers:{Accept:'application/json'}});if(!r.ok)throw Error('unavailable');var d=await r.json();target.replaceChildren();
  if(d.reference)renderReference(target,d.reference);
  else missingReference(target,false);
 }catch(_){missingReference(target,true);}
}
function compactTarget(target){return !!(target.closest&&target.closest('.mp-parallel-card'));}
function renderListing(target,l){
 var compact=compactTarget(target),a=document.createElement('a'),img=document.createElement('img'),title=document.createElement('strong'),p=document.createElement('p'),note=document.createElement('p');
 a.href=l.href;a.target='_blank';a.rel='noopener sponsored';a.title=l.title;
 img.src=l.image;img.alt=l.title+' — seller photo';img.width=180;img.height=240;img.loading='lazy';img.style.cssText='width:100%;height:200px;object-fit:contain';
 title.textContent=l.title;a.append(img,title);var action=document.createElement('span');action.className='mp-ebay-action';action.textContent='View on eBay →';a.append(action);
 p.textContent=(l.price?(l.priceKind==='currentBid'?'eBay auction bid: $':compact?'eBay · $':'eBay asking price: $')+Number(l.price).toFixed(2)+' USD':'Price unavailable')+(compact?'':' · check shipping and condition');
 var grade=l.title.match(/\\b(PSA|BGS|SGC|CGC|CSG|TAG|HGA)\\s*(?:GEM\\s*MT\\s*|MINT\\s*)?(\\d{1,2}(?:\\.\\d)?)/i);
 note.className='mp-meta';note.textContent=(compact?(grade?'Seller title: '+grade[1].toUpperCase()+' '+grade[2]+' · Seller photo':'Seller photo · Check serial stamp'):'Seller-provided title and photo. Verify the exact card and serial stamp; one-of-one claims are not authenticated by us.')+(Number.isFinite(l.checkedAt)?' · Price checked '+new Date(l.checkedAt).toLocaleString():'');
 img.onerror=function(){img.hidden=true;note.textContent='Seller photo unavailable. Check the listing for photos and condition.';};
 target.append(a,p,note);
}
async function lookup(b){
 if(b.disabled)return;b.disabled=true;b.innerHTML='<span class="mp-mana-wait"><span class="mp-mana-vial" aria-hidden="true"></span><span>Checking eBay…</span></span>';
 var target=b.parentElement.querySelector('[data-sports-result]'),reference=b.parentElement.querySelector('[data-sports-reference-result]');
 try{var r=await fetch(b.dataset.sportsLookup,{headers:{Accept:'application/json'}});var d=await r.json();if(!r.ok&&!d.marketplaceUnavailable)throw Error('unavailable');target.replaceChildren();
  if(reference){reference.replaceChildren();if(d.reference)renderReference(reference,d.reference);else missingReference(reference,false);}
  if(!d.listing){target.textContent=d.marketplaceUnavailable?pausedPhotoText(d):compactTarget(target)?'No exact eBay listing found. Try the finish search below.':'No matching live eBay listing found. The eBay search below may show other copies.';}
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
  var market=document.createElement('div'),target=document.createElement('div'),reference=document.createElement('div'),heading=document.createElement('small'),placeholder=document.createElement('span'),button=document.createElement('button');
  market.className='mp-parallel-market';reference.dataset.sportsReferenceResult='';reference.className='mp-parallel-reference';reference.setAttribute('aria-live','polite');reference.textContent='Loading reference image…';target.dataset.sportsResult='';target.setAttribute('aria-live','polite');heading.textContent='Find a copy · eBay';heading.className='mp-offer-label';placeholder.className='mp-parallel-placeholder';placeholder.textContent='Seller photo & price will load here.';target.append(placeholder);
  button.type='button';button.dataset.sportsLookup=tile.dataset.sportsPreview;button.textContent='Load reference & listing';market.append(reference,heading,target,button);
  if(tile.dataset.sportsPreview.indexOf('reference=3')!==-1){heading.hidden=true;target.hidden=true;button.textContent='Load reference';}
  tile.insertBefore(market,tile.querySelector('.mp-own-copy')||tile.querySelector('.mp-parallel-search'));
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
