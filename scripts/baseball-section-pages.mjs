import {archiveNonbaseSections} from './topps/archive-nonbase-sections.mjs';
import {holidayBaseballSections} from './topps/holiday-baseball-sections.mjs';
import {sportsChecklistNavigation,sportsSectionCollections} from './sports-checklist-ui.mjs';
import {sportsSectionFilters} from './sports-section-filters.mjs';
import {checklistUrlCorrections} from './topps/checklist-url-corrections.mjs';
import {footballSections} from './topps/football-sections.mjs';
import {sportsListings,sportsListingMatches,sportsListingHtml,sportsLookupScript,sportsMarketplaceNotice} from './sports-card-marketplace.mjs';
import {catalogStoreCopyHtml} from './catalog-inventory.mjs';
import {baseballSections} from './topps/baseball-sections.mjs';
import {baseballChecklistInventoryMatches as baseballInventoryMatches,ebayChecklistSearch} from './topps/public-checklist-policy.mjs';
import {collectionToolsHtml} from './collection-tools.mjs';
import {marketplaceDisclosureHtml} from './catalog-inventory.mjs';
const checklistStyles='<style>.mp-sports-card-grid{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr))!important;gap:16px}.mp-sports-card-grid .mp-card{min-width:0}.mp-sports-card-grid .mp-card-body h2,.mp-sports-card-grid .mp-card-body h2 a{font:750 18px/1.35 system-ui!important;overflow-wrap:anywhere}.mp-sports-card-grid .mp-card-body>p{font:14px/1.5 system-ui!important}.mp-card-shopping{font:14px/1.5 system-ui}.mp-card-shopping a,.mp-card-shopping button{font:650 14px/1.45 system-ui!important;overflow-wrap:anywhere}.mp-card-shopping strong{font-size:15px!important}.mp-card-shopping p{font:13px/1.5 system-ui!important}.mp-seller-notice p{font:14px/1.5 system-ui!important}.mp-seller-notice summary{font:650 14px/1.5 system-ui!important;min-height:44px;cursor:pointer}</style>';
const sportFor=s=>s.sport==='football'||/football/i.test(s.displayName)?'football':'baseball';
const setPath=s=>'/'+sportFor(s)+'/checklists/'+s.id;
const sectionPath=(s,g)=>setPath(s)+'/sections/'+g.id;
const cardPath=(s,c)=>setPath(s)+'/cards/'+c.id;
const sectionsBySet=new Map();
for(const source of [...baseballSections,...holidayBaseballSections,...footballSections,...archiveNonbaseSections]){
 const groups=sectionsBySet.get(source.setId)||[];
 for(const group of source.sections)if(!groups.some(g=>g.id===group.id))groups.push(group);
 sectionsBySet.set(source.setId,groups);
}
export const sectionsForSet=set=>sectionsBySet.get(set.id)||[];
export function baseballSectionSitemapPaths(sets){return sets.flatMap(s=>[...sportsSectionCollections(sectionsForSet(s)).map(g=>sectionPath(s,g)),...sectionsForSet(s).flatMap(g=>[sectionPath(s,g),...g.cards.map(c=>cardPath(s,c))])]);}
export function relatedParallelLinks(set,card,esc){
 const identity=c=>(c.subjects?.length?c.subjects.map(s=>s.name):[c.player]).map(n=>String(n).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'')).sort().join('|');
 const matches=sectionsForSet(set).filter(g=>/parallel|variation/i.test(g.kind)&&!/auto|relic/i.test(g.kind+' '+g.name)).flatMap(g=>g.cards.filter(c=>String(c.cardNumber)===String(card.cardNumber)&&identity(c)===identity(card)).map(c=>({g,c})));
 if(!matches.length)return '';
 return '<details class="mp-card-parallels"><summary style="min-height:44px;cursor:pointer">Parallels &amp; variations ('+matches.length+')</summary><ul>'+matches.map(({g,c})=>'<li><a style="display:inline-flex;min-height:44px;align-items:center" href="'+cardPath(set,c)+'">'+esc(g.name)+'</a></li>').join('')+'</ul><small>Publisher checklist entries; open a variation to check copies for sale.</small></details>';
}
export function baseballSectionsNav(set,esc,current='base'){return sportsChecklistNavigation(set,sectionsForSet(set),esc,{sport:sportFor(set),current});}
export function baseballShoppingHtml(items,card,set,env,deps,group,listings=[]){
 const {escape:esc}=deps;
 const copies=Array.isArray(items)?items.filter(i=>Number.isFinite(i.price)&&i.price>0&&deps.available(i)&&baseballInventoryMatches(i,card,set)):[];
 const own=copies.slice(0,3).map(i=>catalogStoreCopyHtml(i,{escape:esc,slug:deps.slug})).join('');
 const external=ebayChecklistSearch(card,set,env.EBAY_PARTNER_CAMPAIGN_ID);
 const listing=group&&listings.find(l=>sportsListingMatches(l,card,set,group));
 return '<div class="mp-card-shopping">'+own+(external?'<div data-sports-result aria-live="polite">'+sportsListingHtml(listing,esc)+'</div>'+(!listing?'<button type="button" data-sports-lookup="'+esc(cardPath(set,card)+'?market=1')+'" style="min-height:44px;padding:10px;margin:10px 0;border:0;border-radius:8px;background:var(--wo-button,#8bd450);color:var(--wo-on-button,#111);font:700 15px system-ui;cursor:pointer">Find an eBay listing</button>':'')+'<p><a href="'+esc(external)+'" target="_blank" rel="noopener sponsored">Search eBay for this card</a></p>':'')+'</div>';
}
export async function handleBaseballSections(request,env,url,deps,sets,html,missing){
 if(checklistUrlCorrections[url.pathname])return new Response(null,{status:301,headers:{Location:checklistUrlCorrections[url.pathname],'Cache-Control':'public,max-age=86400'}});
 const set=sets.find(s=>url.pathname.startsWith(setPath(s)+'/'));if(!set)return null;
 const groups=sectionsForSet(set),group=[...groups,...sportsSectionCollections(groups)].find(g=>url.pathname===sectionPath(set,g));
 const cardGroup=groups.find(g=>g.cards.some(c=>cardPath(set,c)===url.pathname));
 if(!group&&!cardGroup)return url.pathname.startsWith(setPath(set)+'/sections/')?missing():null;
 const esc=deps.escape;
 const activeGroup=group||cardGroup;
 if(url.searchParams.has('market')){
  if(request.method!=='GET')return new Response(null,{status:405,headers:{Allow:'GET'}});
  const card=cardGroup?.cards.find(c=>cardPath(set,c)===url.pathname);
  if(!card)return new Response('Unknown card',{status:404});
  try{const listings=await sportsListings(env,deps.ctx,set,cardGroup,deps,{card,wait:true});return Response.json({listing:listings.find(l=>sportsListingMatches(l,card,set,cardGroup))||null},{headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex'}});}
  catch{return Response.json({error:'Marketplace temporarily unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});}
 }
 const listings=activeGroup.aggregate?[]:await sportsListings(env,deps.ctx,set,activeGroup,deps);
 let inventory;try{inventory=await deps.listItems();}catch{inventory=null;}
 const nav='<div class="mp-crumb"><a href="/'+sportFor(set)+'">'+(sportFor(set)==='football'?'Football':'Baseball')+' checklists</a> / <a href="'+setPath(set)+'">'+esc(set.displayName)+'</a></div>'+baseballSectionsNav(set,esc,activeGroup.id);
 const availability=!Array.isArray(inventory)?'<p>Store availability is temporarily unavailable. Marketplace searches remain available.</p>':'<p>Store copies appear first. Matching card listings may have different parallel finishes; check the actual title, photos and condition.</p>';
 if(cardGroup){
  const c=cardGroup.cards.find(c=>cardPath(set,c)===url.pathname),name=c.player+' #'+c.cardNumber+' — '+set.displayName+' '+cardGroup.name;
  return html({title:name+' | The Mana Pocket',description:name+'. Official checklist reference and shopping links.',canonicalPath:cardPath(set,c),jsonLd:{'@context':'https://schema.org','@type':'WebPage',name,citation:set.sourceUrl},bodyHtml:checklistStyles+nav+'<h1>'+esc(name)+'</h1><p>'+esc(c.team)+' · '+esc(cardGroup.kind)+' · Check the listing’s exact finish and condition.</p>'+sportsMarketplaceNotice+availability+baseballShoppingHtml(inventory,c,set,env,deps,activeGroup,listings)+sportsLookupScript+'<p><a href="'+sectionPath(set,cardGroup)+'">Back to '+esc(cardGroup.name)+'</a> · <a href="'+esc(set.sourceUrl)+'">Official Topps checklist PDF</a></p>'});
 }
 const filters=sportsSectionFilters(url,group,sectionPath(set,group),esc);if(!filters)return missing();
 const {cards,page,href}=filters;
 const name=set.displayName+' — '+group.name;
 const rows=cards.slice((page-1)*60,page*60).map(c=>'<article class="mp-card"><div class="mp-card-body"><h2 style="font-size:18px"><a href="'+cardPath(set,c)+'">'+esc(c.player)+' #'+esc(c.cardNumber)+'</a></h2><p>'+esc(c.team)+'</p>'+(group.aggregate?'<p>'+esc(c.section)+'</p>':'')+baseballShoppingHtml(inventory,c,set,env,deps,activeGroup,listings)+'</div></article>').join('');
 return html({title:name+' Checklist'+(page>1?' — Page '+page:'')+' | The Mana Pocket',description:'Browse the '+group.cards.length+' verified '+group.name+' checklist entries, matching store copies and eBay searches.',canonicalPath:filters.filtered?sectionPath(set,group):href(page),robotsNoindex:filters.filtered,jsonLd:{'@context':'https://schema.org','@type':'CollectionPage',name,citation:set.sourceUrl},bodyHtml:checklistStyles+nav+'<h1 style="font:750 clamp(23px,5vw,32px)/1.2 system-ui;margin:18px 0 10px">'+esc(name)+'</h1><p class="mp-meta">'+group.cards.length+' publisher checklist entries · Store copies first</p><p style="font:13px/1.4 system-ui">We may earn a commission from eBay links.</p><details class="mp-seller-notice"><summary>About this checklist &amp; affiliate listings</summary>'+sportsMarketplaceNotice+availability+'<p>Card identities follow the official publisher checklist. Check the seller’s exact finish, condition and serial numbering before buying.</p></details>'+collectionToolsHtml(group.cards.map(c=>({...c,name:c.player})),{scope:sportFor(set)+'/'+set.id,path:c=>cardPath(set,c)})+filters.form+'<p>'+cards.length+' matching entries.</p><div class="mp-grid mp-sports-card-grid">'+rows+'</div>'+filters.pagination+sportsLookupScript});
}
