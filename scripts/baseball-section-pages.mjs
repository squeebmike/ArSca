import {holidayBaseballSections} from './topps/holiday-baseball-sections.mjs';
import {sportsChecklistNavigation} from './sports-checklist-ui.mjs';
import {footballSections} from './topps/football-sections.mjs';
import {sportsListings,sportsListingMatches,sportsListingHtml,sportsLookupScript,sportsMarketplaceNotice} from './sports-card-marketplace.mjs';
import {catalogStoreCopyHtml} from './catalog-inventory.mjs';
import {setPageHeader} from './collector-page-ui.mjs';
import {baseballSections} from './topps/baseball-sections.mjs';
import {baseballChecklistInventoryMatches as baseballInventoryMatches,ebayChecklistSearch} from './topps/public-checklist-policy.mjs';
import {collectionToolsHtml} from './collection-tools.mjs';
import {marketplaceDisclosureHtml} from './catalog-inventory.mjs';
const checklistStyles='<style>.mp-sports-card-grid{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr))!important;gap:16px}.mp-sports-card-grid .mp-card{min-width:0}.mp-sports-card-grid .mp-card-body h2,.mp-sports-card-grid .mp-card-body h2 a{font:750 18px/1.35 system-ui!important;overflow-wrap:anywhere}.mp-sports-card-grid .mp-card-body>p{font:14px/1.5 system-ui!important}.mp-card-shopping{font:14px/1.5 system-ui}.mp-card-shopping a,.mp-card-shopping button{font:650 14px/1.45 system-ui!important;overflow-wrap:anywhere}.mp-card-shopping strong{font-size:15px!important}.mp-card-shopping p{font:13px/1.5 system-ui!important}.mp-seller-notice p{font:14px/1.5 system-ui!important}.mp-seller-notice summary{font:650 14px/1.5 system-ui!important;min-height:44px;cursor:pointer}</style>';
const sportFor=s=>s.sport==='football'||/football/i.test(s.displayName)?'football':'baseball';
const setPath=s=>'/'+sportFor(s)+'/checklists/'+s.id;
const sectionPath=(s,g)=>setPath(s)+'/sections/'+g.id;
const cardPath=(s,c)=>setPath(s)+'/cards/'+c.id;
export const sectionsForSet=set=>[...baseballSections,...holidayBaseballSections,...footballSections].find(s=>s.setId===set.id)?.sections||[];
export function baseballSectionSitemapPaths(sets){return sets.flatMap(s=>[...(sectionsForSet(s).length?[setPath(s)+'/sections/all-non-base']:[]),...sectionsForSet(s).flatMap(g=>[sectionPath(s,g),...g.cards.map(c=>cardPath(s,c))])]);}
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
 const set=sets.find(s=>url.pathname.startsWith(setPath(s)+'/'));if(!set)return null;
 const groups=sectionsForSet(set),group=groups.find(g=>url.pathname===sectionPath(set,g))||(groups.length&&url.pathname===setPath(set)+'/sections/all-non-base'?{id:'all-non-base',name:'All non-base cards',kind:'Non-base cards',cards:groups.flatMap(g=>g.cards)}:null);
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
 const listings=activeGroup.id==='all-non-base'?[]:await sportsListings(env,deps.ctx,set,activeGroup,deps);
 let inventory;try{inventory=await deps.listItems();}catch{inventory=null;}
 const nav='<div class="mp-crumb"><a href="/'+sportFor(set)+'">'+(sportFor(set)==='football'?'Football':'Baseball')+' checklists</a> / <a href="'+setPath(set)+'">'+esc(set.displayName)+'</a></div>'+baseballSectionsNav(set,esc,activeGroup.id);
 const availability=!Array.isArray(inventory)?'<p>Store availability is temporarily unavailable. Marketplace searches remain available.</p>':'<p>Store copies appear first. Matching card listings may have different parallel finishes; check the actual title, photos and condition.</p>';
 if(cardGroup){
  const c=cardGroup.cards.find(c=>cardPath(set,c)===url.pathname),name=c.player+' #'+c.cardNumber+' — '+set.displayName+' '+cardGroup.name;
  return html({title:name+' | The Mana Pocket',description:name+'. Official checklist reference and shopping links.',canonicalPath:cardPath(set,c),jsonLd:{'@context':'https://schema.org','@type':'WebPage',name,citation:set.sourceUrl},bodyHtml:checklistStyles+nav+'<h1>'+esc(name)+'</h1><p>'+esc(c.team)+' · '+esc(cardGroup.kind)+' · Check the listing’s exact finish and condition.</p>'+sportsMarketplaceNotice+availability+baseballShoppingHtml(inventory,c,set,env,deps,activeGroup,listings)+sportsLookupScript+'<p><a href="'+sectionPath(set,cardGroup)+'">Back to '+esc(cardGroup.name)+'</a> · <a href="'+esc(set.sourceUrl)+'">Official Topps checklist PDF</a></p>'});
 }
 const q=(url.searchParams.get('q')||'').trim().slice(0,100),cards=group.cards.filter(c=>!q||[c.player,c.team,c.cardNumber].join(' ').toLowerCase().includes(q.toLowerCase()));
 const value=url.searchParams.get('page')||'1',page=Number(value),pages=Math.max(1,Math.ceil(cards.length/60));if(!/^[1-9]\d*$/.test(value)||page>pages)return missing();
 const href=n=>sectionPath(set,group)+(q?'?q='+encodeURIComponent(q)+(n>1?'&page='+n:''):n>1?'?page='+n:'');
 const name=set.displayName+' — '+group.name;
 const rows=cards.slice((page-1)*60,page*60).map(c=>'<article class="mp-card"><div class="mp-card-body"><h2 style="font-size:18px"><a href="'+cardPath(set,c)+'">'+esc(c.player)+' #'+esc(c.cardNumber)+'</a></h2><p>'+esc(c.team)+'</p>'+baseballShoppingHtml(inventory,c,set,env,deps,activeGroup,listings)+'</div></article>').join('');
 return html({title:name+' Checklist'+(page>1?' — Page '+page:'')+' | The Mana Pocket',description:'Browse the '+group.cards.length+' verified '+group.name+' checklist entries, matching store copies and eBay searches.',canonicalPath:q?sectionPath(set,group):href(page),robotsNoindex:!!q,jsonLd:{'@context':'https://schema.org','@type':'CollectionPage',name,citation:set.sourceUrl},bodyHtml:checklistStyles+nav+setPageHeader({title:name,label:group.kind+' · Set checklist',stats:[group.cards.length+' entries',String(set.year)],actions:[['Search section','#set-checklist'],['Base checklist',setPath(set)]]},esc)+'<p>'+group.cards.length+' verified '+esc(group.kind.toLowerCase())+' checklist entries from the official Topps PDF. The entries follow the publisher’s printed section; check any additional finish or parallel on the actual listing.</p><p class="mp-meta">Checklist identities follow the publisher. Marketplace listings below are separate seller offers.</p>'+sportsMarketplaceNotice+availability+collectionToolsHtml(group.cards.map(c=>({...c,name:c.player})),{scope:sportFor(set)+'/'+set.id,path:c=>cardPath(set,c)})+'<form id="set-checklist" class="mp-checklist-tools" method="get" action="'+sectionPath(set,group)+'"><label>Find a player, team or card number <input type="search" name="q" value="'+esc(q)+'"></label><button>Search section</button></form><p>'+cards.length+' matching entries.</p><div class="mp-grid mp-sports-card-grid">'+rows+'</div><nav aria-label="Section checklist pages">'+Array.from({length:pages},(_,i)=>i+1).map(n=>n===page?'<span aria-current="page">Page '+n+'</span>':'<a href="'+esc(href(n))+'">Page '+n+'</a>').join('')+'</nav>'+sportsLookupScript});
}
