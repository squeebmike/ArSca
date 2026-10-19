import {baseballSections} from './topps/baseball-sections.mjs';
import {baseballChecklistInventoryMatches as baseballInventoryMatches,ebayChecklistSearch} from './topps/public-checklist-policy.mjs';
import {collectionToolsHtml} from './collection-tools.mjs';
import {marketplaceDisclosureHtml} from './catalog-inventory.mjs';
const setPath=s=>'/baseball/checklists/'+s.id;
const sectionPath=(s,g)=>setPath(s)+'/sections/'+g.id;
const cardPath=(s,c)=>setPath(s)+'/cards/'+c.id;
export const sectionsForSet=set=>baseballSections.find(s=>s.setId===set.id)?.sections||[];
export function baseballSectionSitemapPaths(sets){return sets.flatMap(s=>sectionsForSet(s).flatMap(g=>[sectionPath(s,g),...g.cards.map(c=>cardPath(s,c))]));}
export function baseballSectionsNav(set,esc){const groups=sectionsForSet(set);return groups.length?'<nav aria-label="Checklist sections"><a href="'+setPath(set)+'">Base checklist</a> · '+groups.map(g=>'<a href="'+sectionPath(set,g)+'">'+esc(g.kind+': '+g.name)+'</a>').join(' · ')+'</nav>':'';}
export function baseballShoppingHtml(items,card,set,env,deps){
 const {escape:esc}=deps;
 const copies=Array.isArray(items)?items.filter(i=>Number.isFinite(i.price)&&i.price>0&&deps.available(i)&&baseballInventoryMatches(i,card,set)):[];
 const own=copies.slice(0,3).map(i=>'<a href="'+esc(i.linkUrl||'/item/'+encodeURIComponent(i.id)+'/'+deps.slug(i.name))+'">Buy our copy · $'+i.price.toFixed(2)+' USD · '+esc(i.condition||'See condition')+'</a>').join(' · ');
 const external=ebayChecklistSearch(card,set,env.EBAY_PARTNER_CAMPAIGN_ID);
 return '<div class="mp-card-shopping">'+(own?'<p>'+own+'</p>':'')+(external?'<p><a href="'+esc(external)+'" target="_blank" rel="noopener sponsored">Search eBay for this card</a></p>':'')+'</div>';
}
export async function handleBaseballSections(request,env,url,deps,sets,html,missing){
 const set=sets.find(s=>url.pathname.startsWith(setPath(s)+'/'));if(!set)return null;
 const groups=sectionsForSet(set),group=groups.find(g=>url.pathname===sectionPath(set,g));
 const cardGroup=groups.find(g=>g.cards.some(c=>cardPath(set,c)===url.pathname));
 if(!group&&!cardGroup)return url.pathname.startsWith(setPath(set)+'/sections/')?missing():null;
 const esc=deps.escape;let inventory;try{inventory=await deps.listItems();}catch{inventory=null;}
 const nav='<div class="mp-crumb"><a href="/baseball">Baseball checklists</a> / <a href="'+setPath(set)+'">'+esc(set.displayName)+'</a></div>'+baseballSectionsNav(set,esc);
 const availability=!Array.isArray(inventory)?'<p>Store availability is temporarily unavailable. Marketplace searches remain available.</p>':'<p>Store buttons show exact matching copies currently listed at The Mana Pocket. If no store button appears, use the marketplace search and check the edition carefully.</p>';
 if(cardGroup){
  const c=cardGroup.cards.find(c=>cardPath(set,c)===url.pathname),name=c.player+' #'+c.cardNumber+' — '+set.displayName+' '+cardGroup.name;
  return html({title:name+' | The Mana Pocket',description:name+'. Official checklist reference and shopping links.',canonicalPath:cardPath(set,c),jsonLd:{'@context':'https://schema.org','@type':'WebPage',name,citation:set.sourceUrl},bodyHtml:nav+'<h1>'+esc(name)+'</h1><p>'+esc(c.team)+' · '+esc(cardGroup.kind)+' · Standard edition; parallels are separate.</p>'+availability+baseballShoppingHtml(inventory,c,set,env,deps)+marketplaceDisclosureHtml+'<p><a href="'+sectionPath(set,cardGroup)+'">Back to '+esc(cardGroup.name)+'</a> · <a href="'+esc(set.sourceUrl)+'">Official Topps checklist PDF</a></p>'});
 }
 const q=(url.searchParams.get('q')||'').trim().slice(0,100),cards=group.cards.filter(c=>!q||[c.player,c.team,c.cardNumber].join(' ').toLowerCase().includes(q.toLowerCase()));
 const value=url.searchParams.get('page')||'1',page=Number(value),pages=Math.max(1,Math.ceil(cards.length/60));if(!/^[1-9]\d*$/.test(value)||page>pages)return missing();
 const href=n=>sectionPath(set,group)+(q?'?q='+encodeURIComponent(q)+(n>1?'&page='+n:''):n>1?'?page='+n:'');
 const name=set.displayName+' — '+group.name;
 const rows=cards.slice((page-1)*60,page*60).map(c=>'<article class="mp-card"><div class="mp-card-body"><h2 style="font-size:18px"><a href="'+cardPath(set,c)+'">'+esc(c.player)+' #'+esc(c.cardNumber)+'</a></h2><p>'+esc(c.team)+'</p>'+baseballShoppingHtml(inventory,c,set,env,deps)+'</div></article>').join('');
 return html({title:name+' Checklist'+(page>1?' — Page '+page:'')+' | The Mana Pocket',description:'Browse the '+group.cards.length+' verified '+group.name+' checklist entries, matching store copies and eBay searches.',canonicalPath:q?sectionPath(set,group):href(page),robotsNoindex:!!q,jsonLd:{'@context':'https://schema.org','@type':'CollectionPage',name,citation:set.sourceUrl},bodyHtml:nav+'<h1>'+esc(name)+'</h1><p>'+group.cards.length+' verified '+esc(group.kind.toLowerCase())+' checklist entries from the official Topps PDF. Parallel editions are not included in this section.</p><p><a href="'+esc(set.sourceUrl)+'">Official checklist PDF</a></p>'+availability+marketplaceDisclosureHtml+collectionToolsHtml(group.cards.map(c=>({...c,name:c.player})),{scope:'baseball/'+set.id,path:c=>cardPath(set,c)})+'<form method="get" action="'+sectionPath(set,group)+'"><label>Find a player, team or card number <input type="search" name="q" value="'+esc(q)+'"></label><button>Search section</button></form><p>'+cards.length+' matching entries.</p><div class="mp-grid">'+rows+'</div><nav aria-label="Section checklist pages">'+Array.from({length:pages},(_,i)=>i+1).map(n=>n===page?'<span aria-current="page">Page '+n+'</span>':'<a href="'+esc(href(n))+'">Page '+n+'</a>').join(' · ')+'</nav>'});
}
