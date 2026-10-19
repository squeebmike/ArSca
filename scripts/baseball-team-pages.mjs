import {baseballChecklistInventoryMatches as baseballInventoryMatches} from './topps/public-checklist-policy.mjs';
const origin='https://www.themanapocket.com';
const teamSlug=name=>String(name).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
export const baseballTeamPath=team=>'/baseball/teams/'+teamSlug(typeof team==='string'?team:team.name);
export function baseballTeams(sets) {
 const teams=new Map();
 for(const set of sets)for(const card of set.cards) {
  for(const name of new Set(card.subjects.map(s=>s.team).filter(Boolean))) {
   if(!teams.has(name))teams.set(name,{name,id:teamSlug(name),rows:[]});
   teams.get(name).rows.push({set,card});
  }
 }
 return [...teams.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
export function baseballTeamLinks(teams,esc) {
 return '<div class="mp-set-list">'+teams.map(t=>'<a class="mp-set-row" href="'+baseballTeamPath(t)+'"><span>'+esc(t.name)+'</span><span>'+t.rows.length+' base cards</span></a>').join('')+'</div>';
}
export async function handleBaseballTeam(request,url,sets,deps,html,missing,cardPath) {
 if(!url.pathname.startsWith('/baseball/teams/'))return null;
 const teams=baseballTeams(sets),team=teams.find(t=>baseballTeamPath(t)===url.pathname);
 if(!team)return missing();
 const esc=deps.escape,base=baseballTeamPath(team);
 const selectedSet=url.searchParams.get('set')||'',year=url.searchParams.get('year')||'',rookies=url.searchParams.get('rookies')||'';
 const query=(url.searchParams.get('q')||'').trim().slice(0,100);
 const teamSets=[...new Map(team.rows.map(r=>[r.set.id,r.set])).values()];
 const years=[...new Set(teamSets.map(s=>String(s.year)))].sort().reverse();
 if((selectedSet&&!teamSets.some(s=>s.id===selectedSet))||(year&&!years.includes(year))||(rookies&&!['1'].includes(rookies)))return missing();
 const rows=team.rows.filter(({set,card})=>(!selectedSet||set.id===selectedSet)&&(!year||String(set.year)===year)&&(!rookies||card.subjects.some(s=>s.team===team.name&&/\brookie\b/i.test(s.note||'')))&&(!query||[card.player,card.cardNumber,...card.subjects.map(s=>s.note||'')].join(' ').toLowerCase().includes(query.toLowerCase())));
 const filtered=!!(selectedSet||year||rookies||query),pageText=url.searchParams.get('page')||'1',page=Number(pageText),pages=Math.max(1,Math.ceil(rows.length/60));
 if(!/^[1-9]\d*$/.test(pageText)||page>pages)return missing();
 const pagePath=n=>{
  const params=new URLSearchParams();
  for(const [k,v]of [['year',year],['set',selectedSet],['rookies',rookies],['q',query],['page',n>1?String(n):'']])if(v)params.set(k,v);
  return base+(params.size?'?'+params.toString():'');
 };
 let stock;
 try {
  const items=await deps.listItems();
  const found=items.filter(i=>Number.isFinite(i.price)&&i.price>0&&deps.available(i)&&rows.some(({set,card})=>baseballInventoryMatches(i,card,set)));
  stock=found.length?'<p>Matching store listings for the checklist selection above, including identified parallels. Open a listing for its photos, condition and available quantity.</p>'+[...new Map(found.map(i=>[i.id,i])).values()].map(i=>'<p><a href="'+esc(i.linkUrl||'/item/'+encodeURIComponent(i.id)+'/'+deps.slug(i.name))+'">'+esc(i.name)+(i.variant?' · '+esc(i.variant):'')+'</a> · $'+Number(i.price).toFixed(2)+' USD</p>').join(''):'<p>No exact matching store copies are currently listed for this selection. <a href="/category/sports-cards?team='+encodeURIComponent(team.name)+'">Browse our '+esc(team.name)+' inventory</a>.</p>';
 }catch{stock='<p>Store availability is temporarily unavailable. <a href="/category/sports-cards">Check our sports inventory</a>.</p>';}
 const options=(entries,current)=>entries.map(([value,label])=>'<option value="'+esc(value)+'"'+(value===current?' selected':'')+'>'+esc(label)+'</option>').join('');
 const shown=rows.slice((page-1)*60,page*60);
 const sections=teamSets.map(set=>{
  const selected=shown.filter(r=>r.set.id===set.id);if(!selected.length)return '';
  return '<section><h2>'+esc(set.displayName)+'</h2><p><a href="/baseball/checklists/'+set.id+'">Full base checklist</a> · <a href="'+esc(set.sourceUrl)+'">Official checklist PDF</a></p><div class="mp-set-list">'+selected.map(({card})=>'<a class="mp-set-row" href="'+cardPath(set,card)+'"><span>#'+esc(card.cardNumber)+' · '+esc(card.player)+'</span><span>'+esc(card.subjects.filter(s=>s.team===team.name).map(s=>s.note||'Base').join(' · '))+'</span></a>').join('')+'</div></section>';
 }).join('');
 return html({title:team.name+' Baseball Card Checklists'+(page>1?' — Page '+page:'')+' | The Mana Pocket',description:'Browse '+team.name+' cards in verified Topps baseball base checklists. Filter by year, set and rookie status, then find exact available store copies.',canonicalPath:filtered?base:pagePath(page),robotsNoindex:filtered,jsonLd:{'@context':'https://schema.org','@type':'CollectionPage',name:team.name+' baseball card checklists',description:'Team checklist reference covering the verified base sets listed on this page.'},bodyHtml:'<style>@media print{header,footer,nav,form,button,#navbarID,.navbar,.footer-section{display:none!important}.mp-set-row{break-inside:avoid}body,.mp-wrap{background:white!important;color:black!important}.mp-wrap a{color:black!important}}</style><div class="mp-crumb"><a href="/baseball">All baseball checklists</a></div><h1>'+esc(team.name)+' baseball card checklists</h1><p>Get your team’s stack together. Pick a set below, check the card number, and see which exact copies we have listed.</p><p>Coverage: '+teamSets.length+' verified base checklists, '+team.rows.length+' card entries. Inserts and parallels are not included yet. Teams follow the printed checklist, so a traded player may appear with a former team. Multi-player cards can appear in more than one team checklist.</p><form method="get" action="'+base+'"><label for="team-year">Year</label> <select id="team-year" name="year"><option value="">All available years</option>'+options(years.map(y=>[y,y]),year)+'</select> <label for="team-set">Set</label> <select id="team-set" name="set"><option value="">All verified sets</option>'+options(teamSets.map(s=>[s.id,s.displayName]),selectedSet)+'</select> <label for="team-search">Player or card number</label> <input type="search" id="team-search" name="q" maxlength="100" value="'+esc(query)+'"> <label><input type="checkbox" name="rookies" value="1"'+(rookies?' checked':'')+'> Rookie cards</label> <button type="submit">Find cards</button> <a href="'+base+'">Reset</a></form><p>'+rows.length+' matching base cards.</p><button type="button" onclick="window.print()">Print this checklist page</button>'+sections+(!rows.length?'<p>No cards match those filters in the verified checklists. Try another selection.</p>':'')+'<nav aria-label="Team checklist pages">'+Array.from({length:pages},(_,i)=>i+1).map(n=>n===page?'<span aria-current="page">Page '+n+'</span>':'<a href="'+esc(pagePath(n))+'">Page '+n+'</a>').join(' · ')+'</nav><section><h2>Available at The Mana Pocket</h2><p>Store listings for this checklist card may include parallels. Check each listing’s title, photos and finish before buying.</p>'+stock+'</section><p>This is a checklist, not a complete team set offered for sale. Store listings show the actual items available to buy.</p>'});
}
