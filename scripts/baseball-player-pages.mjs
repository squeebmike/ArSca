import {newestReleaseFirst} from './release-order.mjs';
import {baseballChecklistInventoryMatches as baseballInventoryMatches} from './topps/public-checklist-policy.mjs';
const slug=s=>String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
export const baseballPlayerPath=p=>'/baseball/players/'+p.id;
const playerIndexes=new WeakMap(); // Reference rows only; live inventory is fetched separately.
export function baseballPlayers(sets){
 if(playerIndexes.has(sets))return playerIndexes.get(sets);
 const teamNames=new Set(sets.flatMap(s=>s.cards.flatMap(c=>c.subjects.map(x=>x.team))));
 const grouped=new Map();
 for(const set of sets)for(const card of set.cards)for(const subject of card.subjects){
  if(!subject.name||!subject.team||teamNames.has(subject.name))continue;
  const id=slug(subject.name)+'--'+slug(subject.team);
  if(!grouped.has(id))grouped.set(id,{id,name:subject.name,team:subject.team,rows:[]});
  const p=grouped.get(id);if(!p.rows.some(r=>r.set.id===set.id&&r.card.id===card.id))p.rows.push({set,card,subject});
 }
 // A profile must offer cross-set comparison, rather than duplicate one card page.
 const result=[...grouped.values()].filter(p=>new Set(p.rows.map(r=>r.set.id)).size>=2).sort((a,b)=>a.name.localeCompare(b.name)||a.team.localeCompare(b.team));
 playerIndexes.set(sets,result);return result;
}
export async function handleBaseballPlayers(request,url,sets,deps,html,missing,cardPath){
 if(url.pathname!=='/baseball/players'&&!url.pathname.startsWith('/baseball/players/'))return null;
 const players=baseballPlayers(sets),esc=deps.escape;
 if(url.pathname==='/baseball/players'){
  const query=(url.searchParams.get('q')||'').trim().slice(0,100),shown=players.filter(p=>!query||[p.name,p.team].join(' ').toLowerCase().includes(query.toLowerCase()));
  return html({title:'Baseball Players — Verified Cross-Set Card Lists | The Mana Pocket',description:'Find baseball cards by printed player and team across verified Topps and Bowman checklists. Compare set years, numbers and matching store copies.',canonicalPath:'/baseball/players',robotsNoindex:!!query,jsonLd:{'@context':'https://schema.org','@type':'CollectionPage',name:'Baseball player checklists'},bodyHtml:'<p><a href="/baseball">All baseball checklists</a></p><h1>Find a player’s cards</h1><p>Compare cards across the verified base sets. Names are grouped with the team printed on the checklist, so a trade can put the same player in more than one group. Check the team when players share a name.</p><form method="get" action="/baseball/players"><label for="player-search">Player or team</label> <input type="search" name="q" id="player-search" maxlength="100" value="'+esc(query)+'"> <button type="submit">Find cards</button></form><p>'+shown.length+' player/team groups with cards in at least two verified sets. This directory expands as more checklists are verified.</p><div class="mp-set-list">'+shown.map(p=>'<a class="mp-set-row" href="'+baseballPlayerPath(p)+'"><span>'+esc(p.name)+' · '+esc(p.team)+'</span><span>'+p.rows.length+' base-card entries</span></a>').join('')+'</div>'});
 }
 const player=players.find(p=>baseballPlayerPath(p)===url.pathname);if(!player)return missing();
 let stock;
 try{const inventory=await deps.listItems(),found=inventory.filter(i=>i.price>0&&Number.isFinite(i.price)&&deps.available(i)&&player.rows.some(({set,card})=>baseballInventoryMatches(i,card,set)));stock=found.length?[...new Map(found.map(i=>[i.id,i])).values()].map(i=>'<p><a href="'+esc(i.linkUrl||'/item/'+encodeURIComponent(i.id)+'/'+deps.slug(i.name))+'">'+esc(i.name)+(i.variant?' · '+esc(i.variant):'')+'</a> · $'+i.price.toFixed(2)+' USD</p>').join(''):'<p>No exact matching store copy is currently listed. <a href="/category/sports-cards">Browse sports inventory</a>.</p>';}
 catch{stock='<p>Store availability is temporarily unavailable.</p>';}
 const title=player.name+' — '+player.team+' Baseball Card Checklist';
 return html({title:title+' | The Mana Pocket',description:'Compare '+player.name+' cards listed with '+player.team+' across verified Topps/Bowman base checklists. Find exact card numbers, source details and store copies.',canonicalPath:baseballPlayerPath(player),jsonLd:{'@context':'https://schema.org','@type':'CollectionPage',name:title},bodyHtml:'<p><a href="/sports/checklists?sport=baseball&amp;player='+encodeURIComponent(player.name)+'">See this player across teams, base cards and verified non-base sections →</a></p><div class="mp-crumb"><a href="/baseball">Baseball</a> / <a href="/baseball/players">Players</a></div><h1>'+esc(title)+'</h1><p>'+player.rows.length+' entries across '+new Set(player.rows.map(r=>r.set.id)).size+' verified sets. These cards use the player and team names printed in the source checklist. Inserts, image variations and parallels are outside this list.</p><div class="mp-set-list">'+[...player.rows].sort((a,b)=>newestReleaseFirst(a.set,b.set)).map(({set,card,subject})=>'<a class="mp-set-row" href="'+cardPath(set,card)+'"><span>'+esc(set.displayName)+' · #'+esc(card.cardNumber)+'</span><span>'+esc(subject.note||'Base card')+'</span></a>').join('')+'</div><h2>Available at The Mana Pocket</h2><p>Store listings linked to these checklist entries may include parallels. Check each listing’s title, photos and finish before buying.</p>'+stock+'<p>A checklist entry is a reference. Store listings identify the actual copy, condition and selling price.</p>'});
}
