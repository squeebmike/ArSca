import {footballOddsHtml} from './football-odds.mjs';
import {sectionsForSet,baseballSectionSitemapPaths,baseballSectionsNav,handleBaseballSections} from './baseball-section-pages.mjs';
import {sportsChecklistRedirect,sportsReleaseInformation} from './sports-checklist-ui.mjs';
import {setPageHeader} from './collector-page-ui.mjs';
import {catalogStoreCopyHtml} from './catalog-inventory.mjs';
import {footballSets} from './topps/football-seed.mjs';
import {footballChecklistPublicationProblems,baseballChecklistInventoryMatches as baseballInventoryMatches,ebayChecklistSearch} from './topps/public-checklist-policy.mjs';
import {collectionToolsHtml} from './collection-tools.mjs';
const origin='https://www.themanapocket.com';
export const footballSetPath=set=>'/football/checklists/'+set.id;
export const footballCardPath=(set,card)=>footballSetPath(set)+'/cards/'+card.id;
export async function handleFootballCatalog(request,env,url,deps) {
 if(!['GET','HEAD'].includes(request.method)||!(url.pathname==='/football'||url.pathname.startsWith('/football/')||url.pathname==='/sitemap-football.xml'))return null;
 const {escape:esc,shell}=deps;
 const sets=footballSets.filter(s=>!footballChecklistPublicationProblems(s).length);

 const html=(data,status=200)=>new Response(request.method==='HEAD'?null:shell(data),{status,headers:{'Content-Type':'text/html;charset=UTF-8','Cache-Control':'no-store'}});
 const missing=()=>html({title:'Football checklist not found | The Mana Pocket',description:'Browse verified football checklists.',canonicalPath:url.pathname,robotsNoindex:true,bodyHtml:'<h1>Checklist page not found</h1><p><a href="/football">Browse football checklists</a></p>'},404);
 if(url.pathname==='/sitemap-football.xml') {
  const paths=['/football',...sets.flatMap(s=>[footballSetPath(s),...s.cards.map(c=>footballCardPath(s,c))]),...baseballSectionSitemapPaths(sets)];
  return new Response(request.method==='HEAD'?null:'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+paths.map(p=>'<url><loc>'+origin+esc(p)+'</loc></url>').join('')+'</urlset>',{headers:{'Content-Type':'application/xml;charset=UTF-8','Cache-Control':'public,max-age=900'}});
 }
 if(url.pathname==='/football')return html({title:'Licensed Topps Football Checklists | The Mana Pocket',description:'Browse verified licensed Topps football base checklists, exact card references and matching store copies.',canonicalPath:'/football',jsonLd:{'@context':'https://schema.org','@type':'CollectionPage',name:'Licensed Topps football checklists'},bodyHtml:'<h1>Topps football checklists</h1><p><a href="/sports/checklists?sport=football">Search players and teams across sets →</a></p><p>Find the card number, check the set, then look for your copy. These numbered base checklists come from the official Topps PDFs. Inserts, autographs and parallels are separate lists; the source PDF includes them.</p><p><a href="/baseball">Baseball checklists</a> · <a href="/category/sports-cards">Shop sports cards</a> · <a href="/articles">Collector articles</a></p><div class="mp-set-list">'+sets.map(s=>'<a class="mp-set-row" href="'+footballSetPath(s)+'"><span>'+esc(s.displayName)+'</span><span>'+s.cards.length+' base cards</span></a>').join('')+'</div>'});
 const sectionResponse=await handleBaseballSections(request,env,url,deps,sets,html,missing);if(sectionResponse)return sectionResponse;
 const set=sets.find(s=>url.pathname===footballSetPath(s)||url.pathname.startsWith(footballSetPath(s)+'/cards/'));
 if(!set)return missing();
 const sectionRedirect=sportsChecklistRedirect(url,set,sectionsForSet(set),'football');if(sectionRedirect)return sectionRedirect;
 const setPath=footballSetPath(set),cardPathPrefix=setPath+'/cards/';
 const stockHtml=async card=>{
  let items;
  try { items=await deps.listItems();if(!Array.isArray(items))throw Error('Inventory unavailable'); }
  catch { return '<section id="set-stock" class="mp-stock-panel"><h2>Available at The Mana Pocket</h2><p>Store listings linked to these checklist entries may include parallels. Check each listing’s title, photos and finish before buying.</p><p>Store availability is temporarily unavailable. <a href="/category/sports-cards">Check our sports inventory</a>.</p></section>'; }
  const found=items.filter(i=>Number.isFinite(i.price)&&i.price>0&&deps.available(i)&&(card?baseballInventoryMatches(i,card,set):set.cards.some(c=>baseballInventoryMatches(i,c,set))));
  return '<section id="set-stock" class="mp-stock-panel"><h2>Available at The Mana Pocket</h2><p>Store listings linked to these checklist entries may include parallels. Check each listing’s title, photos and finish before buying.</p>'+(found.length?'<div class="mp-stock-grid">'+found.map(i=>catalogStoreCopyHtml(i,deps)).join('')+'</div>':'<p>No exact matching copy is currently listed. <a href="/category/sports-cards">Browse our sports inventory</a>.</p>')+'</section>';
 };
 const crumbs='<div class="mp-crumb"><a href="/football">Football checklists</a> / <a href="'+setPath+'">'+esc(set.displayName)+'</a></div>';
 if(url.pathname.startsWith(cardPathPrefix)) {
  const card=set.cards.find(c=>footballCardPath(set,c)===url.pathname);if(!card)return missing();
  const name=card.player+' #'+card.cardNumber+' — '+set.displayName;
  const affiliate=ebayChecklistSearch(card,set,env.EBAY_PARTNER_CAMPAIGN_ID);
  return html({title:name+' | The Mana Pocket',description:name+'. Base checklist entry, team details and matching store copies.',canonicalPath:footballCardPath(set,card),jsonLd:{'@context':'https://schema.org','@type':'WebPage',name,description:'Reference checklist entry from the official Topps base checklist.',isPartOf:{'@type':'CollectionPage',name:set.displayName,url:origin+setPath},citation:set.sourceUrl},bodyHtml:crumbs+'<h1>'+esc(name)+'</h1><p>Base card · '+esc(card.team)+'</p><ul>'+card.subjects.map(s=>'<li>'+esc(s.name)+' · '+esc(s.team)+(s.note?' · '+esc(s.note):'')+'</li>').join('')+'</ul><p>This is a checklist reference. It does not mean we have this card in stock. Check any store listing for the actual copy, photos, condition and price.</p>'+await stockHtml(card)+(affiliate?'<p><a href="'+esc(affiliate)+'" target="_blank" rel="noopener sponsored">Search eBay for this card</a></p><p>Affiliate link: The Mana Pocket may earn a commission if you buy through this link. Results may include different parallels, grades or lots; check the listing.</p>':'')+'<p><a href="'+esc(set.sourceUrl)+'">Official Topps checklist PDF</a> · <a href="'+setPath+'">Back to the base checklist</a></p>'});
 }
 const query=(url.searchParams.get('q')||'').trim().slice(0,100),q=query.toLowerCase();
 const cards=set.cards.filter(c=>!q||[c.player,c.cardNumber,c.team,...c.subjects.map(s=>s.note||'')].join(' ').toLowerCase().includes(q));
 const pageText=url.searchParams.get('page')||'1',page=Number(pageText),pages=Math.max(1,Math.ceil(cards.length/60));
 if(!/^[1-9]\d*$/.test(pageText)||page>pages)return missing();
 const pageUrl=n=>setPath+(query?'?q='+encodeURIComponent(query)+(n>1?'&page='+n:''):n>1?'?page='+n:'');
 const canonicalPath=query?setPath:pageUrl(page);
 const collection=collectionToolsHtml(set.cards.map(c=>({...c,name:c.player})),{scope:'football/'+set.id,path:c=>footballCardPath(set,c),escape:esc});
 return html({title:set.displayName+' Base Checklist'+(page>1?' — Page '+page:'')+' | The Mana Pocket',description:'Find base cards in '+set.displayName+'. Search by player, team or card number, then open exact card details.',canonicalPath,robotsNoindex:!!query,jsonLd:{'@context':'https://schema.org','@type':'CollectionPage',name:set.displayName+' base checklist',citation:set.sourceUrl},bodyHtml:crumbs+setPageHeader({title:set.displayName,label:'Football · Set checklist',description:'Find your player, check the card number, and see copies available from the shop.',stats:[set.cards.length+' base cards',String(set.year),set.brand||'Topps'],actions:[['Search checklist','#set-checklist'],['Shop available copies','#set-stock'],['Official checklist PDF',set.sourceUrl]]},esc)+baseballSectionsNav(set,esc)+'<p>'+set.cards.length+' issued base card numbers. '+esc(set.scope)+'</p>'+(set.unissuedNumbers.length?'<p>Topps marks '+set.unissuedNumbers.map(esc).join(', ')+' as nonexistent in the official checklist.</p>':'')+'<p><a href="'+esc(set.sourceUrl)+'">Official checklist PDF, including inserts and parallels</a></p>'+await stockHtml(null)+sportsReleaseInformation(set,esc,footballOddsHtml(set.id,esc))+collection+'<form id="set-checklist" class="mp-checklist-tools" method="get" action="'+setPath+'"><label for="football-search">Find a player, team or card number</label> <input id="football-search" type="search" name="q" value="'+esc(query)+'" maxlength="100"> <button type="submit">Search checklist</button></form><p>'+cards.length+' matching cards.</p><div class="mp-set-list">'+cards.slice((page-1)*60,page*60).map(c=>'<a class="mp-set-row" href="'+footballCardPath(set,c)+'"><span>#'+esc(c.cardNumber)+' · '+esc(c.player)+'</span><span>'+esc(c.team)+'</span></a>').join('')+'</div><nav aria-label="Checklist pages">'+Array.from({length:pages},(_,i)=>i+1).map(n=>n===page?'<span aria-current="page">Page '+n+'</span>':'<a href="'+esc(pageUrl(n))+'">Page '+n+'</a>').join(' · ')+'</nav><p><a href="/category/sports-cards">Shop available sports cards</a></p>'});
}
