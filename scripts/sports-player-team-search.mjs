import {baseballSets} from './topps/baseball-seed.mjs';
import {footballSets} from './topps/football-seed.mjs';
import {baseballSections} from './topps/baseball-sections.mjs';
import {footballSections} from './topps/football-sections.mjs';
import {checklistPublicationProblems,footballChecklistPublicationProblems} from './topps/public-checklist-policy.mjs';
const root='/sports/checklists';
const key=v=>String(v||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const kind=name=>/auto|chromograph/i.test(name)?'autographs':/relic|patch|fabric/i.test(name)?'relics':/variation|parallel|camo|lightboard/i.test(name)?'variations':name==='Base'?'base':'inserts';
let referenceRows;
export function sportsReferenceRows(){
 if(referenceRows)return referenceRows;
 referenceRows=[];
 for(const [sport,sets,groups] of [['baseball',baseballSets,baseballSections],['football',footballSets,footballSections]])for(const set of sets){
  if((sport==='baseball'?checklistPublicationProblems(set,set):footballChecklistPublicationProblems(set)).length)continue;
  const sections=[{name:'Base',cards:set.cards},...(groups.find(g=>g.setId===set.id)?.sections||[])];
  for(const section of sections)for(const card of section.cards)referenceRows.push({sport,set,card,section:section.name,type:kind(section.name),href:'/'+sport+'/checklists/'+set.id+'/cards/'+card.id});
 }
 return referenceRows;
}
export function sportsPlayerTeamSearch(url,escape){
 const all=sportsReferenceRows(),params=url.searchParams;
 const fields=['sport','player','team','set','type'];
 const selected=Object.fromEntries(fields.map(f=>[f,(params.get(f)||'').trim().slice(0,120)]));
 const rows=all.filter(r=>(!selected.sport||r.sport===selected.sport)&&(!selected.set||r.set.id===selected.set)&&(!selected.type||r.type===selected.type)&&r.card.subjects.some(s=>(!selected.player||key(s.name).includes(key(selected.player)))&&(!selected.team||s.team===selected.team)));
 const pageText=params.get('page')||'1',page=Number(pageText),pages=Math.max(1,Math.ceil(rows.length/60));
 if(!/^[1-9]\d*$/.test(pageText)||page>pages)return null;
 const link=(changes={})=>{const p=new URLSearchParams();for(const f of fields){const value=changes[f]??selected[f];if(value)p.set(f,value);}if(changes.page>1)p.set('page',changes.page);return root+(p.size?'?'+p:'');};
 const options=(entries,value)=>entries.map(([v,label])=>'<option value="'+escape(v)+'"'+(value===v?' selected':'')+'>'+escape(label)+'</option>').join('');
 const context=all.filter(r=>!selected.sport||r.sport===selected.sport);
 const teams=[...new Set(context.flatMap(r=>r.card.subjects.map(s=>s.team).filter(Boolean)))].sort();
 const sets=[...new Map(context.map(r=>[r.set.id,r.set])).values()];
 const filtered=fields.some(f=>selected[f]);
 return {title:'Find Sports Cards by Player & Team'+(page>1?' — Page '+page:'')+' | The Mana Pocket',description:'Search verified Topps and Bowman baseball and licensed Topps football checklists across sets. Filter players, printed teams, inserts, autographs and variations.',canonicalPath:filtered?root:link({page}),robotsNoindex:filtered,bodyHtml:'<style>.mp-player-filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:14px;padding:18px;border:1px solid var(--wo-border,#777);border-radius:14px}.mp-player-filters label{display:grid;gap:6px;min-width:0}.mp-player-filters input,.mp-player-filters select,.mp-player-filters button{width:100%;min-height:46px;max-width:100%;box-sizing:border-box;font:inherit}.mp-cross-card{padding:16px;border-bottom:1px solid var(--wo-border,#777);overflow-wrap:anywhere}.mp-cross-pages{display:flex;gap:20px;padding:20px 0}.mp-cross-pages a{min-height:44px;display:inline-flex;align-items:center}</style><p><a href="/baseball">Baseball sets</a> · <a href="/football">Football sets</a></p><h1>Find your player. Build your team.</h1><p>One player, every verified set here. Pick a team to see its players across releases, or combine both filters. Team names follow the printed checklist, including former teams. Coverage includes verified base cards and the numbered non-base sections we have imported; it is not every card ever printed.</p><form class="mp-player-filters" method="get" action="'+root+'"><label>Sport<select name="sport"><option value="">Both sports</option>'+options([['baseball','Baseball'],['football','Football']],selected.sport)+'</select></label><label>Player name<input name="player" type="search" maxlength="120" value="'+escape(selected.player)+'" placeholder="e.g. Aaron Judge"></label><label>Printed team<select name="team"><option value="">All teams</option>'+options(teams.map(t=>[t,t]),selected.team)+'</select></label><label>Set<select name="set"><option value="">Across all sets</option>'+options(sets.map(s=>[s.id,s.displayName]),selected.set)+'</select></label><label>Card section<select name="type"><option value="">All card sections</option>'+options([['base','Base'],['inserts','Inserts & chases'],['autographs','Autographs'],['relics','Relics'],['variations','Variations & parallels']],selected.type)+'</select></label><button type="submit">Find cards</button><a href="'+root+'">Reset filters</a></form><p>'+rows.length+' matching checklist entries across '+new Set(rows.map(r=>r.set.id)).size+' sets. Checklist entries are references; open a card to check store copies and marketplace matches.</p>'+rows.slice((page-1)*60,page*60).map(r=>'<article class="mp-cross-card"><h2><a href="'+escape(r.href)+'">'+escape(r.card.player||r.card.subjects.map(s=>s.name).join(' / '))+' · #'+escape(r.card.cardNumber)+'</a></h2><p>'+escape(r.set.displayName)+' · '+escape(r.section)+'</p><p>'+r.card.subjects.map(s=>'<a href="'+escape(link({player:s.name,page:1}))+'">'+escape(s.name)+'</a>'+(s.team?' · <a href="'+escape(link({player:'',team:s.team,page:1}))+'">'+escape(s.team)+'</a>':'')).join(' / ')+'</p></article>').join('')+(!rows.length?'<p>No verified entries match these filters. Try the player’s last name or clear the team.</p>':'')+'<nav class="mp-cross-pages" aria-label="Search result pages">'+(page>1?'<a href="'+escape(link({page:page-1}))+'">← Previous</a>':'')+'<span>Page '+page+' of '+pages+'</span>'+(page<pages?'<a href="'+escape(link({page:page+1}))+'">Next →</a>':'')+'</nav>'};
}
