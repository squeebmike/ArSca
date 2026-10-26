import {relatedParallelLinks,sectionsForSet} from './baseball-section-pages.mjs';
import {parallelFamilyStyle} from './sports-parallels.mjs';
import {holidayBaseballSections} from './topps/holiday-baseball-sections.mjs';
import {newestReleases,newestReleaseFirst} from './release-order.mjs';
import {baseballSets} from './topps/baseball-seed.mjs';
import {footballSets} from './topps/football-seed.mjs';
import {baseballSections} from './topps/baseball-sections.mjs';
import {footballSections} from './topps/football-sections.mjs';
import {checklistPublicationProblems,footballChecklistPublicationProblems} from './topps/public-checklist-policy.mjs';
const root='/sports/checklists';
const key=v=>String(v||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export const normalizeSportsCardNumber=v=>key(v).trim().replace(/^#\s*/, '').replace(/[\u2010-\u2015\u2212]/g,'-');
const kind=(name,sectionKind)=>sectionKind==='Prospects'?'prospects':/auto|chromograph/i.test(name)?'autographs':/relic|patch|fabric/i.test(name)?'relics':/variation|parallel|camo|lightboard/i.test(name)?'variations':name==='Base'?'base':'inserts';
let referenceRows;
export function sportsReferenceRows(){
 if(referenceRows)return referenceRows;
 referenceRows=[];
 for(const [sport,sets,groups] of [['baseball',baseballSets,[...baseballSections,...holidayBaseballSections]],['football',footballSets,footballSections]])for(const set of sets){
  if((sport==='baseball'?checklistPublicationProblems(set,set):footballChecklistPublicationProblems(set)).length)continue;
  const sections=[{name:set.baseChecklistLabel||'Base',cards:set.cards},...sectionsForSet(set)];
  for(const section of sections)for(const card of section.cards)referenceRows.push({sport,set,card,section:section.name,type:kind(section.name,section.kind),href:'/'+sport+'/checklists/'+set.id+'/cards/'+card.id});
 }
 referenceRows.sort((a,b)=>newestReleaseFirst(a.set,b.set));
 return referenceRows;
}
export function sportsPlayerTeamSearch(url,escape,shopping={}){
 const all=sportsReferenceRows(),params=url.searchParams;
 const fields=['sport','player','number','team','set','type'];
 const selected=Object.fromEntries(fields.map(f=>[f,(params.get(f)||'').trim().slice(0,120)]));
 // Old player-only links and the shared q convention can contain a printed
 // number. Promote only a known exact identity; hyphenated names stay names.
 const query=selected.player||(params.get('q')||'').trim().slice(0,120);
 if(!selected.number&&query&&all.some(r=>normalizeSportsCardNumber(r.card.cardNumber)===normalizeSportsCardNumber(query))){selected.number=query;selected.player='';}
 else if(!selected.player&&query)selected.player=query;
 const rows=all.filter(r=>(!selected.number||normalizeSportsCardNumber(r.card.cardNumber)===normalizeSportsCardNumber(selected.number))&&(!selected.sport||r.sport===selected.sport)&&(!selected.set||r.set.id===selected.set)&&(!selected.type||r.type===selected.type)&&r.card.subjects.some(s=>(!selected.player||key(s.name).includes(key(selected.player)))&&(!selected.team||s.team===selected.team)));
 const pageText=params.get('page')||'1',page=Number(pageText),pages=Math.max(1,Math.ceil(rows.length/60));
 if(!/^[1-9]\d*$/.test(pageText)||page>pages)return null;
 const link=(changes={})=>{const p=new URLSearchParams();for(const f of fields){const value=changes[f]??selected[f];if(value)p.set(f,value);}if(changes.page>1)p.set('page',changes.page);return root+(p.size?'?'+p:'');};
 const options=(entries,value)=>entries.map(([v,label])=>'<option value="'+escape(v)+'"'+(value===v?' selected':'')+'>'+escape(label)+'</option>').join('');
 const context=all.filter(r=>!selected.sport||r.sport===selected.sport);
 const teams=[...new Set(context.flatMap(r=>r.card.subjects.map(s=>s.team).filter(Boolean)))].sort();
 const sets=newestReleases([...new Map(context.map(r=>[r.set.id,r.set])).values()]);
 const filtered=fields.some(f=>selected[f]);
 return {title:'Find Sports Cards by Number, Player & Team'+(page>1?' — Page '+page:'')+' | The Mana Pocket',description:'Search card numbers, players and teams in verified Topps and Bowman baseball and licensed Topps football checklists across sets. Filter players, printed teams, inserts, autographs and variations.',canonicalPath:filtered?root:link({page}),robotsNoindex:filtered,bodyHtml:parallelFamilyStyle+'<style>.mp-player-filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:14px;padding:18px;border:1px solid var(--wo-border,#777);border-radius:14px}.mp-player-filters label{display:grid;gap:6px;min-width:0}.mp-player-filters input,.mp-player-filters select,.mp-player-filters button{width:100%;min-height:46px;max-width:100%;box-sizing:border-box;font:inherit}.mp-cross-card{padding:16px;border-bottom:1px solid var(--wo-border,#777);overflow-wrap:anywhere}.mp-cross-pages{display:flex;gap:20px;padding:20px 0}.mp-cross-pages a{min-height:44px;display:inline-flex;align-items:center}</style><p><a href="/baseball">Baseball sets</a> · <a href="/football">Football sets</a></p><h1>Find your card. Build your collection.</h1><p>Search an exact card number, a player, or both. FSA-G, fsa-g and #Fsa-g return the same card number. Check the year and set: a printed number can be reused across releases. Pick a team to see its players across releases, or combine both filters. Team names follow the printed checklist, including former teams. Coverage includes verified base cards and the numbered non-base sections we have imported; it is not every card ever printed.</p><form class="mp-player-filters" method="get" action="'+root+'"><label>Sport<select name="sport"><option value="">Both sports</option>'+options([['baseball','Baseball'],['football','Football']],selected.sport)+'</select></label><label>Card number<input name="number" type="search" maxlength="40" value="'+escape(selected.number)+'" placeholder="e.g. FSA-G" autocapitalize="characters" spellcheck="false"></label><label>Player name<input name="player" type="search" maxlength="120" value="'+escape(selected.player)+'" placeholder="e.g. Ken Griffey Jr."></label><label>Printed team<select name="team"><option value="">All teams</option>'+options(teams.map(t=>[t,t]),selected.team)+'</select></label><label>Set<select name="set"><option value="">Across all sets</option>'+options(sets.map(s=>[s.id,s.displayName]),selected.set)+'</select></label><label>Card section<select name="type"><option value="">All card sections</option>'+options([['base','Base'],['prospects','Prospects'],['inserts','Inserts & chases'],['autographs','Autographs'],['relics','Relics'],['variations','Variations & parallels']],selected.type)+'</select></label><button type="submit">Find cards</button><a href="'+root+'">Reset filters</a></form><p>'+rows.length+' matching checklist entries across '+new Set(rows.map(r=>r.set.id)).size+' sets. Newest set years first. Checklist entries are references. Open the card or expand its parallel family to see reference photos and check available copies. Photos load as they come into view.</p>'+rows.slice((page-1)*60,page*60).map(r=>'<article class="mp-cross-card"><h2><a href="'+escape(r.href)+'">'+escape(r.card.player||r.card.subjects.map(s=>s.name).join(' / '))+' · #'+escape(r.card.cardNumber)+'</a></h2><p>'+escape(r.set.displayName)+' · '+escape(r.section)+'</p><p>'+r.card.subjects.map(s=>'<a href="'+escape(link({player:s.name,page:1}))+'">'+escape(s.name)+'</a>'+(s.team?' · <a href="'+escape(link({player:'',team:s.team,page:1}))+'">'+escape(s.team)+'</a>':'')).join(' / ')+'</p>'+(selected.number?relatedParallelLinks(r.set,r.card,escape,shopping):'')+'</article>').join('')+(!rows.length?'<p>No verified entries match these filters. Check the printed number, try the player’s last name, or clear the team/set filters. Only published, reviewed checklist entries are searchable here; collecting a source does not automatically publish its checklist.</p>':'')+'<nav class="mp-cross-pages" aria-label="Search result pages">'+(page>1?'<a href="'+escape(link({page:page-1}))+'">← Previous</a>':'')+'<span>Page '+page+' of '+pages+'</span>'+(page<pages?'<a href="'+escape(link({page:page+1}))+'">Next →</a>':'')+'</nav>'};
}
