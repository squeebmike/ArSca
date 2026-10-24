import {relatedParallelLinks} from './baseball-section-pages.mjs';
import {parallelFamilyStyle} from './sports-parallels.mjs';
import {newestReleases} from './release-order.mjs';
import {sportsPlayerTeamSearch} from './sports-player-team-search.mjs';
import {sportsChecklistRedirect,sportsReleaseInformation} from './sports-checklist-ui.mjs';
import {setPageHeader} from './collector-page-ui.mjs';
import {catalogStoreCopyHtml} from './catalog-inventory.mjs';
import {baseballSets} from './topps/baseball-seed.mjs';
import {checklistPublicationProblems,baseballChecklistInventoryMatches as baseballInventoryMatches,ebayChecklistSearch} from './topps/public-checklist-policy.mjs';
import {baseballTeams,baseballTeamPath,baseballTeamLinks,handleBaseballTeam} from './baseball-team-pages.mjs';
import {collectionToolsHtml} from './collection-tools.mjs';
import {baseballOddsHtml} from './baseball-odds.mjs';
import {baseballPlayers,baseballPlayerPath,handleBaseballPlayers} from './baseball-player-pages.mjs';
import {sectionsForSet,baseballSectionSitemapPaths,baseballSectionsNav,handleBaseballSections} from './baseball-section-pages.mjs';
const origin='https://www.themanapocket.com';
// Generated publisher data is immutable for this deployment. Reuse its stable
// array identity so derived reference indexes do not rebuild on each request.
const publicBaseballSets=newestReleases(baseballSets.filter(s=>!checklistPublicationProblems(s,s).length));
export const baseballSetPath=set=>'/baseball/checklists/'+set.id;
export const baseballCardPath=(set,card)=>baseballSetPath(set)+'/cards/'+card.id;
export async function handleBaseballCatalog(request,env,url,deps) {
 if(!['GET','HEAD'].includes(request.method)||!(url.pathname==='/sports/checklists'||url.pathname==='/baseball'||url.pathname.startsWith('/baseball/')||url.pathname==='/sitemap-baseball.xml'))return null;
 const {escape:esc,shell}=deps;
 const sets=publicBaseballSets;
 const teams=baseballTeams(sets);
 const html=(data,status=200)=>new Response(request.method==='HEAD'?null:shell(data),{status,headers:{'Content-Type':'text/html;charset=UTF-8','Cache-Control':'no-store'}});
 const missing=()=>html({title:'Baseball checklist not found | The Mana Pocket',description:'Browse verified baseball checklists.',canonicalPath:url.pathname,robotsNoindex:true,bodyHtml:'<h1>Checklist page not found</h1><p><a href="/baseball">Browse baseball checklists</a></p>'},404);
 if(url.pathname==='/sports/checklists'){const data=sportsPlayerTeamSearch(url,esc);return data?html(data):missing();}
 if(url.pathname==='/sitemap-baseball.xml') {
  const paths=['/baseball','/sports/checklists','/baseball/players',...baseballPlayers(sets).map(baseballPlayerPath),...teams.map(baseballTeamPath),...sets.flatMap(s=>[baseballSetPath(s),...s.cards.map(c=>baseballCardPath(s,c))]),...baseballSectionSitemapPaths(sets)];
  const size=40000,parts=Math.ceil(paths.length/size),partText=url.searchParams.get('part');
  if(partText!==null&&(!/^[1-9]\d*$/.test(partText)||Number(partText)>parts))return new Response('Unknown sitemap part',{status:404});
  const index=parts>1&&partText===null;
  const entries=index?Array.from({length:parts},(_,i)=>'/sitemap-baseball.xml?part='+(i+1)):partText?paths.slice((Number(partText)-1)*size,Number(partText)*size):paths;
  const tag=index?'sitemap':'url',root=index?'sitemapindex':'urlset';
  return new Response(request.method==='HEAD'?null:'<?xml version="1.0" encoding="UTF-8"?><'+root+' xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+entries.map(p=>'<'+tag+'><loc>'+origin+esc(p)+'</loc></'+tag+'>').join('')+'</'+root+'>',{headers:{'Content-Type':'application/xml;charset=UTF-8','Cache-Control':'public,max-age=900'}});
 }
 if(url.pathname==='/baseball')return html({title:'Topps Baseball Checklists — 2019 Onward | The Mana Pocket',description:'Explore verified Topps baseball base checklists, card details and matching store inventory. The growing library includes verified releases from 2019, 2023, 2025 and 2026.',canonicalPath:'/baseball',jsonLd:{'@context':'https://schema.org','@type':'CollectionPage',name:'Topps baseball checklists'},bodyHtml:'<h1>Baseball checklists</h1><p>Newest set years first. Within a year, sets without a verified release date are alphabetical.</p><p><a href="/sports/checklists?sport=baseball">Search players and teams across sets →</a></p><p>Working on a set? Start here. Open a checklist, find your player, and check the exact card before you buy. Same player does not mean same card.</p><p>We’re building out licensed Topps and Bowman baseball from 2019 onward. The verified sets currently available are listed below. More sets, inserts and parallels are still being verified.</p><p><a href="/football">Football checklists</a> · <a href="/baseball/players">Find a player’s cards</a> · <a href="/category/sports-cards">Shop our sports cards</a> · <a href="/articles">Collector articles</a> · <a href="/mtg">MTG sets</a> · <a href="/pokemon">Pokémon sets</a></p><div class="mp-set-list">'+sets.map(s=>'<a class="mp-set-row" href="'+baseballSetPath(s)+'"><span>'+esc(s.displayName)+'</span><span>'+s.cards.length+' base cards</span></a>').join('')+'</div><h2>Collect by team</h2><p>Find your team across the verified base checklists.</p>'+baseballTeamLinks(teams,esc)});
 const playerResponse=await handleBaseballPlayers(request,url,sets,deps,html,missing,baseballCardPath);
 if(playerResponse)return playerResponse;
 const teamResponse=await handleBaseballTeam(request,url,sets,deps,html,missing,baseballCardPath);
 if(teamResponse)return teamResponse;
 const sectionResponse=await handleBaseballSections(request,env,url,deps,sets,html,missing);
 if(sectionResponse)return sectionResponse;
 const set=sets.find(s=>url.pathname===baseballSetPath(s)||url.pathname.startsWith(baseballSetPath(s)+'/cards/'));
 if(!set)return missing();
 const sectionRedirect=sportsChecklistRedirect(url,set,sectionsForSet(set),'baseball');if(sectionRedirect)return sectionRedirect;
 const setPath=baseballSetPath(set),cardPathPrefix=setPath+'/cards/';
 const stockHtml=async card=>{
  let items;
  try { items=await deps.listItems();if(!Array.isArray(items))throw Error('Inventory unavailable'); }
  catch { return '<section id="set-stock" class="mp-stock-panel"><h2>Available at The Mana Pocket</h2><p>Store listings linked to these checklist entries may include parallels. Check each listing’s title, photos and finish before buying.</p><p>Store availability is temporarily unavailable. <a href="/category/sports-cards">Check our sports inventory</a>.</p></section>'; }
  const found=items.filter(i=>Number.isFinite(i.price)&&i.price>0&&deps.available(i)&&(card?baseballInventoryMatches(i,card,set):set.cards.some(c=>baseballInventoryMatches(i,c,set))));
  return '<section id="set-stock" class="mp-stock-panel"><h2>Available at The Mana Pocket</h2><p>Store listings linked to these checklist entries may include parallels. Check each listing’s title, photos and finish before buying.</p>'+(found.length?'<div class="mp-stock-grid">'+found.map(i=>catalogStoreCopyHtml(i,deps)).join('')+'</div>':'<p>No exact matching copy is currently listed. <a href="/category/sports-cards">Browse our sports inventory</a>.</p>')+'</section>';
 };
 const teamNav='<details><summary>Browse team checklists</summary>'+baseballTeamLinks(teams.filter(t=>t.rows.some(r=>r.set.id===set.id)),esc)+'</details>';
 const crumbs=parallelFamilyStyle+'<div class="mp-crumb"><a href="/baseball">Baseball checklists</a> / <a href="'+setPath+'">'+esc(set.displayName)+'</a></div>';
 if(url.pathname.startsWith(cardPathPrefix)) {
  const card=set.cards.find(c=>baseballCardPath(set,c)===url.pathname);if(!card)return missing();
  const name=card.player+' #'+card.cardNumber+' — '+set.displayName;
  const affiliate=ebayChecklistSearch(card,set,env.EBAY_PARTNER_CAMPAIGN_ID);
  return html({title:name+' | The Mana Pocket',description:name+'. Base checklist entry, team details and matching store copies.',canonicalPath:baseballCardPath(set,card),jsonLd:{'@context':'https://schema.org','@type':'WebPage',name,description:'Reference checklist entry from the official Topps base checklist.',isPartOf:{'@type':'CollectionPage',name:set.displayName,url:origin+setPath},citation:set.sourceUrl},bodyHtml:crumbs+'<h1>'+esc(name)+'</h1><p>Base card · '+esc(card.team)+'</p><ul>'+card.subjects.map(s=>'<li>'+esc(s.name)+' · '+esc(s.team)+(s.note?' · '+esc(s.note):'')+'</li>').join('')+'</ul><p>This is a checklist reference. It does not mean we have this card in stock. Check any store listing for the actual copy, photos, condition and price.</p>'+relatedParallelLinks(set,card,esc)+await stockHtml(card)+(affiliate?'<p><a href="'+esc(affiliate)+'" target="_blank" rel="noopener sponsored">Search eBay for this card</a></p><p>Affiliate link: The Mana Pocket may earn a commission if you buy through this link. Results may include different parallels, grades or lots; check the listing.</p>':'')+'<p><a href="'+esc(set.sourceUrl)+'">Official Topps checklist PDF</a> · <a href="'+setPath+'">Back to the base checklist</a></p>'});
 }
 const query=(url.searchParams.get('q')||'').trim().slice(0,100),q=query.toLowerCase();
 const cards=set.cards.filter(c=>!q||[c.player,c.cardNumber,c.team,...c.subjects.map(s=>s.note||'')].join(' ').toLowerCase().includes(q));
 const pageText=url.searchParams.get('page')||'1',page=Number(pageText),pages=Math.max(1,Math.ceil(cards.length/60));
 if(!/^[1-9]\d*$/.test(pageText)||page>pages)return missing();
 const pageUrl=n=>setPath+(query?'?q='+encodeURIComponent(query)+(n>1?'&page='+n:''):n>1?'?page='+n:'');
 const canonicalPath=query?setPath:pageUrl(page);
 const collection=collectionToolsHtml(set.cards.map(c=>({...c,name:c.player})),{scope:'baseball/'+set.id,path:c=>baseballCardPath(set,c),escape:esc})+sportsReleaseInformation(set,esc,baseballOddsHtml(set.id,esc));
 return html({title:set.displayName+' Base Checklist'+(page>1?' — Page '+page:'')+' | The Mana Pocket',description:'Find base cards in '+set.displayName+'. Search by player, team or card number, then open exact card details.',canonicalPath,robotsNoindex:!!query,jsonLd:{'@context':'https://schema.org','@type':'CollectionPage',name:set.displayName+' base checklist',citation:set.sourceUrl},bodyHtml:crumbs+setPageHeader({title:set.displayName,label:'Baseball · Set checklist',description:'Find your player, check the card number, and see copies available from the shop.',stats:[set.cards.length+' base cards',String(set.year),set.brand||'Topps'],actions:[...(sectionsForSet(set).length?[['Browse non-base cards',setPath+'/sections/all-non-base']]:[]),['Search checklist','#set-checklist'],['Shop available copies','#set-stock']]},esc)+teamNav+baseballSectionsNav(set,esc)+'<p>'+set.cards.length+' issued base card numbers. '+esc(sectionsForSet(set).length?'Base cards are listed below. Browse the on-site non-base sections above for imported inserts, variations and other special cards.':set.scope)+'</p>'+(set.unissuedNumbers.length?'<p>Topps marks '+set.unissuedNumbers.map(esc).join(', ')+' as nonexistent in the official checklist.</p>':'')+'<details><summary>Publisher source</summary><a href="'+esc(set.sourceUrl)+'">Topps checklist reference</a></details>'+collection+await stockHtml(null)+'<form id="set-checklist" class="mp-checklist-tools" method="get" action="'+setPath+'"><label for="baseball-search">Find a player, team or card number</label> <input id="baseball-search" type="search" name="q" value="'+esc(query)+'" maxlength="100"> <button type="submit">Search checklist</button></form><p>'+cards.length+' matching cards.</p><div class="mp-set-list">'+cards.slice((page-1)*60,page*60).map(c=>'<div><a class="mp-set-row" href="'+baseballCardPath(set,c)+'"><span>#'+esc(c.cardNumber)+' · '+esc(c.player)+'</span><span>'+esc(c.team)+'</span></a>'+relatedParallelLinks(set,c,esc)+'</div>').join('')+'</div><nav aria-label="Checklist pages">'+Array.from({length:pages},(_,i)=>i+1).map(n=>n===page?'<span aria-current="page">Page '+n+'</span>':'<a href="'+esc(pageUrl(n))+'">Page '+n+'</a>').join(' · ')+'</nav><p><a href="/category/sports-cards">Shop available sports cards</a></p>'});
}
