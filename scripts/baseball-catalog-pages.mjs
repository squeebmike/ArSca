import {baseballSets} from './topps/baseball-seed.mjs';
import {checklistPublicationProblems,baseballInventoryMatches,ebayChecklistSearch} from './topps/public-checklist-policy.mjs';
import {baseballTeams,baseballTeamPath,baseballTeamLinks,handleBaseballTeam} from './baseball-team-pages.mjs';
const origin='https://www.themanapocket.com';
export const baseballSetPath=set=>'/baseball/checklists/'+set.id;
export const baseballCardPath=(set,card)=>baseballSetPath(set)+'/cards/'+card.id;
export async function handleBaseballCatalog(request,env,url,deps) {
 if(!['GET','HEAD'].includes(request.method)||!(url.pathname==='/baseball'||url.pathname.startsWith('/baseball/')||url.pathname==='/sitemap-baseball.xml'))return null;
 const {escape:esc,shell}=deps;
 const sets=baseballSets.filter(s=>!checklistPublicationProblems(s,s).length);
 const teams=baseballTeams(sets);
 const html=(data,status=200)=>new Response(request.method==='HEAD'?null:shell(data),{status,headers:{'Content-Type':'text/html;charset=UTF-8','Cache-Control':'no-store'}});
 const missing=()=>html({title:'Baseball checklist not found | The Mana Pocket',description:'Browse verified baseball checklists.',canonicalPath:url.pathname,robotsNoindex:true,bodyHtml:'<h1>Checklist page not found</h1><p><a href="/baseball">Browse baseball checklists</a></p>'},404);
 if(url.pathname==='/sitemap-baseball.xml') {
  const paths=['/baseball',...teams.map(baseballTeamPath),...sets.flatMap(s=>[baseballSetPath(s),...s.cards.map(c=>baseballCardPath(s,c))])];
  return new Response(request.method==='HEAD'?null:'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+paths.map(p=>'<url><loc>'+origin+esc(p)+'</loc></url>').join('')+'</urlset>',{headers:{'Content-Type':'application/xml;charset=UTF-8','Cache-Control':'public,max-age=900'}});
 }
 if(url.pathname==='/baseball')return html({title:'Topps Baseball Checklists — 2023 Onward | The Mana Pocket',description:'Explore verified Topps baseball base checklists, card details and matching store inventory. The library starts with 2023 flagship baseball and is expanding.',canonicalPath:'/baseball',jsonLd:{'@context':'https://schema.org','@type':'CollectionPage',name:'Topps baseball checklists'},bodyHtml:'<h1>Baseball checklists</h1><p>Working on a set? Start here. Open a checklist, find your player, and check the exact card before you buy. Same player does not mean same card.</p><p>We’re building out licensed Topps and Bowman baseball from 2023 onward. Available now: the three 2023 flagship base checklists. More sets, inserts and parallels are still being verified.</p><p><a href="/category/sports-cards">Shop our sports cards</a> · <a href="/articles">Collector articles</a> · <a href="/mtg">MTG sets</a> · <a href="/pokemon">Pokémon sets</a></p><div class="mp-set-list">'+sets.map(s=>'<a class="mp-set-row" href="'+baseballSetPath(s)+'"><span>'+esc(s.displayName)+'</span><span>'+s.cards.length+' base cards</span></a>').join('')+'</div><h2>Collect by team</h2><p>Find your team across the verified base checklists.</p>'+baseballTeamLinks(teams,esc)});
 const teamResponse=await handleBaseballTeam(request,url,sets,deps,html,missing,baseballCardPath);
 if(teamResponse)return teamResponse;
 const set=sets.find(s=>url.pathname===baseballSetPath(s)||url.pathname.startsWith(baseballSetPath(s)+'/cards/'));
 if(!set)return missing();
 const setPath=baseballSetPath(set),cardPathPrefix=setPath+'/cards/';
 const stockHtml=async card=>{
  let items;
  try { items=await deps.listItems(); }
  catch { return '<section><h2>Available at The Mana Pocket</h2><p>Store availability is temporarily unavailable. <a href="/category/sports-cards">Check our sports inventory</a>.</p></section>'; }
  const found=items.filter(i=>Number.isFinite(i.price)&&i.price>0&&deps.available(i)&&baseballInventoryMatches(i,card,set));
  return '<section><h2>Available at The Mana Pocket</h2>'+(found.length?found.map(i=>'<p><a href="'+esc(i.linkUrl||'/item/'+encodeURIComponent(i.id)+'/'+deps.slug(i.name))+'">'+esc(i.name)+'</a> · $'+Number(i.price).toFixed(2)+' USD · '+esc(i.condition||'See listing for condition')+'</p>').join(''):'<p>No exact matching copy is currently listed. <a href="/category/sports-cards">Browse our sports inventory</a>.</p>')+'</section>';
 };
 const teamNav='<details><summary>Browse team checklists</summary>'+baseballTeamLinks(teams.filter(t=>t.rows.some(r=>r.set.id===set.id)),esc)+'</details>';
 const crumbs='<div class="mp-crumb"><a href="/baseball">Baseball checklists</a> / <a href="'+setPath+'">'+esc(set.displayName)+'</a></div>'+teamNav;
 if(url.pathname.startsWith(cardPathPrefix)) {
  const card=set.cards.find(c=>baseballCardPath(set,c)===url.pathname);if(!card)return missing();
  const name=card.player+' #'+card.cardNumber+' — '+set.displayName;
  const affiliate=ebayChecklistSearch(card,set,env.EBAY_PARTNER_CAMPAIGN_ID);
  return html({title:name+' | The Mana Pocket',description:name+'. Base checklist entry, team details and matching store copies.',canonicalPath:baseballCardPath(set,card),jsonLd:{'@context':'https://schema.org','@type':'WebPage',name,description:'Reference checklist entry from the official Topps base checklist.',isPartOf:{'@type':'CollectionPage',name:set.displayName,url:origin+setPath},citation:set.sourceUrl},bodyHtml:crumbs+'<h1>'+esc(name)+'</h1><p>Base card · '+esc(card.team)+'</p><ul>'+card.subjects.map(s=>'<li>'+esc(s.name)+' · '+esc(s.team)+(s.note?' · '+esc(s.note):'')+'</li>').join('')+'</ul><p>This is a checklist reference. It does not mean we have this card in stock. Check any store listing for the actual copy, photos, condition and price.</p>'+await stockHtml(card)+(affiliate?'<p><a href="'+esc(affiliate)+'" target="_blank" rel="noopener sponsored">Search eBay for this card</a></p><p>Affiliate link: The Mana Pocket may earn a commission if you buy through this link. Results may include different parallels, grades or lots; check the listing.</p>':'')+'<p><a href="'+esc(set.sourceUrl)+'">Official Topps checklist PDF</a> · <a href="'+setPath+'">Back to the base checklist</a></p>'});
 }
 const query=(url.searchParams.get('q')||'').trim().slice(0,100),q=query.toLowerCase();
 const cards=set.cards.filter(c=>!q||[c.player,c.cardNumber,c.team,...c.subjects.map(s=>s.note||'')].join(' ').toLowerCase().includes(q));
 const pageText=url.searchParams.get('page')||'1',page=Number(pageText),pages=Math.max(1,Math.ceil(cards.length/60));
 if(!/^[1-9]\d*$/.test(pageText)||page>pages)return missing();
 const pageUrl=n=>setPath+(query?'?q='+encodeURIComponent(query)+(n>1?'&page='+n:''):n>1?'?page='+n:'');
 const canonicalPath=query?setPath:pageUrl(page);
 return html({title:set.displayName+' Base Checklist'+(page>1?' — Page '+page:'')+' | The Mana Pocket',description:'Find base cards in '+set.displayName+'. Search by player, team or card number, then open exact card details.',canonicalPath,robotsNoindex:!!query,jsonLd:{'@context':'https://schema.org','@type':'CollectionPage',name:set.displayName+' base checklist',citation:set.sourceUrl},bodyHtml:crumbs+'<h1>'+esc(set.displayName)+' base checklist</h1><p>'+set.cards.length+' issued base card numbers. '+esc(set.scope)+'</p>'+(set.unissuedNumbers.length?'<p>Topps marks '+set.unissuedNumbers.map(esc).join(', ')+' as nonexistent in the official checklist.</p>':'')+'<p><a href="'+esc(set.sourceUrl)+'">Official checklist PDF, including inserts and parallels</a></p><form method="get" action="'+setPath+'"><label for="baseball-search">Find a player, team or card number</label> <input id="baseball-search" type="search" name="q" value="'+esc(query)+'" maxlength="100"> <button type="submit">Search checklist</button></form><p>'+cards.length+' matching cards.</p><div class="mp-set-list">'+cards.slice((page-1)*60,page*60).map(c=>'<a class="mp-set-row" href="'+baseballCardPath(set,c)+'"><span>#'+esc(c.cardNumber)+' · '+esc(c.player)+'</span><span>'+esc(c.team)+'</span></a>').join('')+'</div><nav aria-label="Checklist pages">'+Array.from({length:pages},(_,i)=>i+1).map(n=>n===page?'<span aria-current="page">Page '+n+'</span>':'<a href="'+esc(pageUrl(n))+'">Page '+n+'</a>').join(' · ')+'</nav><p><a href="/category/sports-cards">Shop available sports cards</a></p>'});
}
