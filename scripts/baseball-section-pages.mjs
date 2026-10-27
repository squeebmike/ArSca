import {archiveNonbaseSections} from './topps/archive-nonbase-sections.mjs';
import {bowmanProspectSections} from './topps/bowman-prospect-sections.mjs';
import {cardParallelProgram,selectedParallelCard,cardParallelOptionsHtml,parallelFamilyStyle,printRunLabel,cardNumberingLabel,matchesParallelPrinting,parallelPreviewTile,inlineParallelStock} from './sports-parallels.mjs';
import {holidayBaseballSections} from './topps/holiday-baseball-sections.mjs';
import {sportsChecklistNavigation,sportsSectionCollections} from './sports-checklist-ui.mjs';
import {sportsSectionFilters} from './sports-section-filters.mjs';
import {checklistUrlCorrections} from './topps/checklist-url-corrections.mjs';
import {footballSections} from './topps/football-sections.mjs';
import {sportsListings,sportsListingMatches,sportsListingHtml,sportsLookupScript,sportsMarketplaceNotice,sportsMarketplaceFailure,sportsOfferSlotHtml} from './sports-card-marketplace.mjs';
import {catalogStoreCopyHtml} from './catalog-inventory.mjs';
import {savedReferenceImage,sportsReferenceImage,referenceImageHtml} from './sports-reference-images.mjs';
import {baseballSections} from './topps/baseball-sections.mjs';
import {baseballChecklistInventoryMatches as baseballInventoryMatches,ebayChecklistSearch} from './topps/public-checklist-policy.mjs';
import {collectionToolsHtml} from './collection-tools.mjs';
import {marketplaceDisclosureHtml} from './catalog-inventory.mjs';
const checklistStyles='<style>.mp-sports-card-grid{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr))!important;gap:16px}.mp-sports-card-grid .mp-card{min-width:0}.mp-sports-card-grid .mp-card-body h2,.mp-sports-card-grid .mp-card-body h2 a{font:750 18px/1.35 system-ui!important;overflow-wrap:anywhere}.mp-sports-card-grid .mp-card-body>p{font:14px/1.5 system-ui!important}.mp-card-shopping{font:14px/1.5 system-ui}.mp-card-shopping a,.mp-card-shopping button{font:650 14px/1.45 system-ui!important;overflow-wrap:anywhere}.mp-card-shopping strong{font-size:15px!important}.mp-card-shopping p{font:13px/1.5 system-ui!important}.mp-seller-notice p{font:14px/1.5 system-ui!important}.mp-seller-notice summary{font:650 14px/1.5 system-ui!important;min-height:44px;cursor:pointer}</style>';
const sportFor=s=>s.sport==='football'||/football/i.test(s.displayName)?'football':'baseball';
const setPath=s=>'/'+sportFor(s)+'/checklists/'+s.id;
const sectionPath=(s,g)=>setPath(s)+'/sections/'+g.id;
const cardPath=(s,c)=>setPath(s)+'/cards/'+c.id;
function correctPublishedGroup(setId,group){
 if(setId!=='2023-topps-update')return group;
 // Publisher PDF: MLB2303-2023ToppsUpdateSeriesBBChecklistFinal_20-Revised.pdf.
 // AA-51, T88CU-97, TS-20 and BSDA-RJO print "Nolan Ryan California
 // Angels". The legacy parser recognized only "Angels" as the team.
 let changed=false;
 const cards=group.cards.map(card=>{
  if(!card.subjects?.some(s=>s.name==='Nolan Ryan California'&&s.team==='Angels'))return card;
  changed=true;const subjects=card.subjects.map(s=>s.name==='Nolan Ryan California'&&s.team==='Angels'?{...s,name:'Nolan Ryan',team:'California Angels'}:s);
  return {...card,subjects,player:subjects.map(s=>s.name).join(' / '),team:[...new Set(subjects.map(s=>s.team))].join(' / ')};
 });
 return changed?{...group,cards}:group;
}
const sectionsBySet=new Map();
for(const source of [...baseballSections,...holidayBaseballSections,...footballSections,...archiveNonbaseSections,...bowmanProspectSections]){
 const groups=sectionsBySet.get(source.setId)||[];
 for(const group of source.sections)if(!groups.some(g=>g.id===group.id))groups.push(correctPublishedGroup(source.setId,group));
 sectionsBySet.set(source.setId,groups);
}
// Older imports split prospect blocks by PDF column or used alternate headings.
// Reconcile only fully duplicated paper/Chrome prospect groups; keep the first
// established routes and redirect aliases. Different printings remain separate.
export const prospectUrlCorrections={};
const prospectFamily=g=>/^(?:(?:bowman-)?chrome|paper)-prospects(?:-i{1,2})?$/.test(g.id)?(g.id.startsWith('paper-')?'paper':'chrome'):null;
const prospectIdentity=c=>String(c.cardNumber)+'|'+(c.subjects?.length?c.subjects.map(s=>s.name):[c.player]).map(n=>String(n).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'')).sort().join('|');
for(const [setId,groups] of sectionsBySet){
 const seen=new Map(),kept=[],root='/baseball/checklists/'+setId;
 for(const group of groups){
  const family=prospectFamily(group);
  const matches=family?group.cards.map(c=>seen.get(family+'|'+prospectIdentity(c))):[];
  if(matches.length&&matches.every(Boolean)&&new Set(matches.map(m=>m.group.id)).size===1){
   prospectUrlCorrections[root+'/sections/'+group.id]=root+'/sections/'+matches[0].group.id;
   group.cards.forEach((c,i)=>{if(c.id!==matches[i].card.id)prospectUrlCorrections[root+'/cards/'+c.id]=root+'/cards/'+matches[i].card.id;});
  }else{
   kept.push(group);
   if(family)for(const card of group.cards)seen.set(family+'|'+prospectIdentity(card),{group,card});
  }
 }
 sectionsBySet.set(setId,kept);
}
export const sectionsForSet=set=>sectionsBySet.get(set.id)||[];
export function baseballSectionSitemapPaths(sets){return sets.flatMap(s=>[...sportsSectionCollections(sectionsForSet(s)).map(g=>sectionPath(s,g)),...sectionsForSet(s).flatMap(g=>[sectionPath(s,g),...g.cards.map(c=>cardPath(s,c))])]);}
export function relatedParallelLinks(set,card,esc,options={}){
 const identity=c=>(c.subjects?.length?c.subjects.map(s=>s.name):[c.player]).map(n=>String(n).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'')).sort().join('|');
 const matches=sectionsForSet(set).filter(g=>/parallel|variation/i.test(g.kind)&&!/auto|relic/i.test(g.kind+' '+g.name)).flatMap(g=>g.cards.filter(c=>String(c.cardNumber)===String(card.cardNumber)&&identity(c)===identity(card)).map(c=>({g,c})));
 const program=cardParallelProgram(set,card),count=matches.length+program.variants.length;
 const reference=Object.hasOwn(options,'reference')?options.reference:savedReferenceImage(set,card),lookup=cardPath(set,card)+'?reference=3'+(card.parallelRule?'&parallel='+card.parallelRule.id:'');
 const photo='<span class="mp-card-reference"'+(reference?'':' data-sports-reference="'+esc(lookup)+'"')+'>'+referenceImageHtml(reference,card.player+' #'+card.cardNumber,esc)+'</span>';
 const offer=options.inlineOffer&&options.campaignId?sportsOfferSlotHtml(cardPath(set,card),esc):'';
 if(!count){
  const known=[...(set.cards||[]),...sectionsForSet(set).flatMap(g=>g.cards)].some(c=>c.id===card.id&&c.cardNumber===card.cardNumber&&identity(c)===identity(card));
  return known?'<figure class="mp-reference-only">'+photo+'<figcaption>Reference image · PriceCharting. Not a copy for sale.</figcaption></figure>'+(offer?'<details><summary>Find a copy</summary>'+offer+'</details>':''):'';
 }
 const runs=[...new Set([...program.variants.map(v=>v.displayRun||(v.printRun?printRunLabel(v.printRun):'')),...matches.map(({c})=>cardNumberingLabel(set,c))].filter(Boolean))];
 return '<details class="mp-card-parallels"><summary style="font:700 14px/1.45 system-ui;min-height:44px;cursor:pointer">'+photo+'<span class="mp-parallel-summary-copy">Parallels &amp; numbered versions ('+count+')'+(runs.length?'<small>'+runs.map(esc).join(' · ')+'</small>':'')+'<small>Tap the card to show or hide its versions.</small></span></summary>'+offer+'<small>Reference images identify each version. Buying options appear underneath. eBay photos and asking prices come from sellers; verify the finish, serial stamp and condition. PriceCharting photos are references, not sale listings. Affiliate links may earn us a commission.</small><ul class="mp-parallel-gallery">'+cardParallelOptionsHtml(set,card,cardPath(set,card),esc,options)+matches.map(({g,c})=>parallelPreviewTile({name:g.name,numbering:cardNumberingLabel(set,c),path:cardPath(set,c),lookup:cardPath(set,c)+'?market=1',searchHref:ebayChecklistSearch(c,set,options.campaignId),ownHtml:inlineParallelStock(options.inventory,c,set,options.deps),escape:esc})).join('')+'</ul><small>Verified finishes shown; other versions may exist. A checklist entry does not mean a copy is available.</small>'+(program.source?'<small><a href="'+esc(program.source)+'" target="_blank" rel="noopener">Parallel source</a></small>':'')+(program.references||[]).map(ref=>'<small><a href="'+esc(ref.url)+'" target="_blank" rel="noopener">'+esc(ref.label)+'</a></small>').join('')+'</details>';
}
export function baseballSectionsNav(set,esc,current='base'){return sportsChecklistNavigation(set,sectionsForSet(set),esc,{sport:sportFor(set),current});}
export function baseballShoppingHtml(items,card,set,env,deps,group,listings=[]){
 const {escape:esc}=deps;
 const copies=Array.isArray(items)?items.filter(i=>Number.isFinite(i.price)&&i.price>0&&deps.available(i)&&baseballInventoryMatches(i,card.parallelRule?{...card,variant:'Base'}:card,set)&&(!card.parallelRule||matchesParallelPrinting([i.name,i.variant,i.treatment,i.serialNumber].filter(Boolean).join(' '),card.parallelRule,card.parallelSiblings,card.section))):[];
 const own=copies.slice(0,3).map(i=>catalogStoreCopyHtml(i,{escape:esc,slug:deps.slug})).join('');
 const external=ebayChecklistSearch(card,set,env.EBAY_PARTNER_CAMPAIGN_ID);
 const listing=group&&listings.find(l=>sportsListingMatches(l,card,set,group));
 return '<div class="mp-card-shopping">'+own+(external?'<div data-sports-result aria-live="polite">'+sportsListingHtml(listing,esc)+'</div>'+(!listing?'<button type="button" data-sports-lookup="'+esc(cardPath(set,card)+'?market=1'+(card.parallelRule?'&parallel='+card.parallelRule.id:''))+'" style="min-height:44px;padding:10px;margin:10px 0;border:0;border-radius:8px;background:var(--wo-button,#8bd450);color:var(--wo-on-button,#111);font:700 15px system-ui;cursor:pointer">Find an eBay listing</button>':'')+'<p><a href="'+esc(external)+'" target="_blank" rel="noopener sponsored">Search eBay for this card</a></p>':'')+'</div>';
}
export async function handleBaseballSections(request,env,url,deps,sets,html,missing){
 if(prospectUrlCorrections[url.pathname])return new Response(null,{status:301,headers:{Location:prospectUrlCorrections[url.pathname]+url.search,'Cache-Control':'public,max-age=86400'}});
 if(checklistUrlCorrections[url.pathname])return new Response(null,{status:301,headers:{Location:checklistUrlCorrections[url.pathname],'Cache-Control':'public,max-age=86400'}});
 const set=sets.find(s=>url.pathname.startsWith(setPath(s)+'/'));if(!set)return null;
 const groups=sectionsForSet(set),group=[...groups,...sportsSectionCollections(groups,set)].find(g=>url.pathname===sectionPath(set,g));
 const baseCard=(url.searchParams.has('parallel')||url.searchParams.has('market')||url.searchParams.has('reference'))?set.cards.find(c=>cardPath(set,c)===url.pathname):null;
 const cardGroup=groups.find(g=>g.cards.some(c=>cardPath(set,c)===url.pathname))||(baseCard?{id:'base',name:set.baseChecklistLabel||'Base',kind:/auto/i.test(set.baseChecklistLabel||'')?'Autographs':'Base',cards:set.cards}:null);
 if(!group&&!cardGroup)return url.pathname.startsWith(setPath(set)+'/sections/')?missing():null;
 const esc=deps.escape;
 const activeGroup=group||cardGroup;
 const originalCard=cardGroup?.cards.find(c=>cardPath(set,c)===url.pathname);
 const parallelId=url.searchParams.get('parallel');
 const chosenCard=parallelId&&originalCard?selectedParallelCard(set,originalCard,parallelId):originalCard;
 if(parallelId&&!chosenCard)return missing();
 if(url.searchParams.has('reference')){
  if(request.method!=='GET')return new Response(null,{status:405,headers:{Allow:'GET'}});
  const reference=await sportsReferenceImage(env,deps.ctx,set,chosenCard,deps);
  if(reference)return Response.json({reference},{headers:{'Cache-Control':'public,max-age=3600','X-Robots-Tag':'noindex'}});
  if(url.searchParams.get('reference')==='3')return Response.json({reference:null},{headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex'}});
  // The main card photo needs the same marketplace fallback as its versions.
  // This path reads the shared eBay cache only; it never loads store inventory.
  try{const listings=await sportsListings(env,deps.ctx,set,cardGroup,deps,{card:chosenCard,wait:true});return Response.json({reference:null,listing:listings[0]||null},{headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex'}});}
  catch(error){return Response.json({reference:null,listing:null,...await sportsMarketplaceFailure(env,error)},{headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex'}});}
 }
 if(url.searchParams.has('market')){
  if(request.method!=='GET')return new Response(null,{status:405,headers:{Allow:'GET'}});
  const card=chosenCard;
  if(!card)return new Response('Unknown card',{status:404});
  try{const [listings,reference]=await Promise.all([sportsListings(env,deps.ctx,set,cardGroup,deps,{card,wait:true}),sportsReferenceImage(env,deps.ctx,set,card,deps)]);const listing=listings.find(l=>sportsListingMatches(l,card,set,cardGroup))||null;return Response.json({listing,reference},{headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex'}});}
  catch(error){const reference=await sportsReferenceImage(env,deps.ctx,set,card,deps);return Response.json({...(reference?{listing:null,reference}:{error:'Marketplace temporarily unavailable'}),...await sportsMarketplaceFailure(env,error)},{status:reference?200:503,headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex'}});}
 }
 const listings=activeGroup.aggregate||baseCard&&!parallelId?[]:await sportsListings(env,deps.ctx,set,activeGroup,deps,parallelId?{card:chosenCard}:{});
 let inventory;try{inventory=await deps.listItems();}catch{inventory=null;}
 const nav='<div class="mp-crumb"><a href="/'+sportFor(set)+'">'+(sportFor(set)==='football'?'Football':'Baseball')+' checklists</a> / <a href="'+setPath(set)+'">'+esc(set.displayName)+'</a></div>'+(cardGroup?'<p><a href="'+(parallelId?cardPath(set,originalCard):baseCard?setPath(set):sectionPath(set,cardGroup))+'">← '+esc(parallelId?'All versions of this card':cardGroup.name)+'</a></p>':baseballSectionsNav(set,esc,activeGroup.id));
 const availability=!Array.isArray(inventory)?'<p>Store availability is temporarily unavailable. Marketplace searches remain available.</p>':'<p>Store copies appear first. Matching card listings may have different parallel finishes; check the actual title, photos and condition.</p>';
 if(cardGroup){
  const reference=await sportsReferenceImage(env,deps.ctx,set,chosenCard,{...deps,archiveOnly:true});
  const c=chosenCard,numbering=cardNumberingLabel(set,c),name=c.player+' #'+c.cardNumber+' — '+set.displayName+' '+cardGroup.name+(parallelId?' · '+c.variant:'')+(numbering?' '+numbering:'');
  return html({title:name+' | The Mana Pocket',description:name+'. Official checklist reference and shopping links.',canonicalPath:cardPath(set,c),robotsNoindex:!!parallelId,jsonLd:{'@context':'https://schema.org','@type':'WebPage',name,...(reference?{image:reference.image}:{}),citation:c.parallelSource||set.sourceUrl},bodyHtml:parallelFamilyStyle+checklistStyles+nav+'<h1>'+esc(name)+'</h1><p>'+esc(c.team)+' · '+esc(cardGroup.kind)+(numbering?' · Publisher numbering '+numbering:'')+' · Check the listing’s exact finish and condition.</p>'+relatedParallelLinks(set,parallelId?chosenCard:originalCard,esc,{reference,inventory,deps,campaignId:env.EBAY_PARTNER_CAMPAIGN_ID})+sportsMarketplaceNotice+availability+baseballShoppingHtml(inventory,c,set,env,deps,activeGroup,listings)+sportsLookupScript+'<p><a href="'+(baseCard?setPath(set):sectionPath(set,cardGroup))+'">Back to '+esc(cardGroup.name)+'</a> · <a href="'+esc(c.parallelSource||set.sourceUrl)+'">Publisher reference</a></p>'});
 }
 const filters=sportsSectionFilters(url,group,sectionPath(set,group),esc);if(!filters)return missing();
 const {cards,page,href}=filters;
 const name=set.displayName+' — '+group.name;
 const rows=cards.slice((page-1)*60,page*60).map(c=>'<article class="mp-card"><div class="mp-card-body"><h2 style="font-size:18px"><a href="'+cardPath(set,c)+'">'+esc(c.player)+' #'+esc(c.cardNumber)+'</a></h2><p>'+esc(c.team)+'</p>'+(group.aggregate?'<p>'+esc(c.section)+(cardNumberingLabel(set,c)?' · '+esc(cardNumberingLabel(set,c)):'')+'</p>':'')+relatedParallelLinks(set,c,esc,{inventory,deps,campaignId:env.EBAY_PARTNER_CAMPAIGN_ID})+(group.parallelFamilies&&c.section==='Base'?'<p>Select a parallel above to see matching copies, prices and seller photos.</p>':baseballShoppingHtml(inventory,c,set,env,deps,activeGroup,listings))+'</div></article>').join('');
 return html({title:name+' Checklist'+(page>1?' — Page '+page:'')+' | The Mana Pocket',description:'Browse the '+group.cards.length+' verified '+group.name+' checklist entries, matching store copies and eBay searches.',canonicalPath:filters.filtered?sectionPath(set,group):href(page),robotsNoindex:filters.filtered,jsonLd:{'@context':'https://schema.org','@type':'CollectionPage',name,citation:set.sourceUrl},bodyHtml:parallelFamilyStyle+checklistStyles+nav+'<h1 style="font:750 clamp(23px,5vw,32px)/1.2 system-ui;margin:18px 0 10px">'+esc(name)+'</h1><p class="mp-meta">'+group.cards.length+' publisher checklist entries · Store copies first</p><p style="font:13px/1.4 system-ui">We may earn a commission from eBay links.</p><details class="mp-seller-notice"><summary>About this checklist &amp; affiliate listings</summary>'+sportsMarketplaceNotice+availability+'<p>Card identities follow the official publisher checklist. Check the seller’s exact finish, condition and serial numbering before buying.</p></details>'+collectionToolsHtml(group.cards.map(c=>({...c,name:c.player})),{scope:sportFor(set)+'/'+set.id,path:c=>cardPath(set,c)})+filters.form+'<p>'+cards.length+' matching entries.</p><div class="mp-grid mp-sports-card-grid">'+rows+'</div>'+filters.pagination+sportsLookupScript});
}
