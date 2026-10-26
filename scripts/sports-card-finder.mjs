import {relatedParallelLinks,sectionsForSet} from './baseball-section-pages.mjs';
import {parallelFamilyStyle} from './sports-parallels.mjs';
import {newestReleases,newestReleaseFirst,releaseOrderInfo} from './release-order.mjs';
import {baseballSets} from './topps/baseball-seed.mjs';
import {footballSets} from './topps/football-seed.mjs';
import {checklistPublicationProblems,footballChecklistPublicationProblems} from './topps/public-checklist-policy.mjs';
const root='/sports/checklists',pageSize=24;
const fold=v=>String(v||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export const sportsNameKey=v=>fold(v).replace(/[^a-z0-9]+/g,' ').trim();
export const normalizeSportsCardNumber=v=>fold(v).trim().replace(/^#\s*/, '').replace(/[\u2010-\u2015\u2212]/g,'-');
const matches=(value,query)=>{
 const hay=sportsNameKey(value),needle=sportsNameKey(query);if(!needle)return false;
 if(hay===needle||hay.replaceAll(' ','')===needle.replaceAll(' ',''))return true;
 const words=hay.split(' ');return needle.split(' ').every(q=>words.some(w=>w===q||(q.length>=2&&w.startsWith(q))));
};
const kind=(name,sectionKind)=>sectionKind==='Prospects'?'prospects':/auto|chromograph/i.test(name)?'autographs':/relic|patch|fabric/i.test(name)?'relics':/variation|parallel|camo|lightboard/i.test(name)?'variations':name==='Base'?'base':'inserts';
const natural=new Intl.Collator('en',{numeric:true,sensitivity:'base'});
// Documented names, not a player's present-day roster affiliation.
// https://www.mlb.com/news/los-angeles-angels-team-name-history
// https://www.mlb.com/news/cleveland-indians-change-name-to-guardians
// https://apnews.com/article/76550106d5312c458eaea57f660a095e
const teamFamilies=new Map([
 ['angels',['Angels','Los Angeles Angels','California Angels','Anaheim Angels','Los Angeles Angels of Anaheim']],
 ['cleveland',['Cleveland Guardians','Cleveland Indians','Guardians','Indians']],
 ['athletics',['Athletics','Oakland Athletics']]
].flatMap(([family,names])=>names.map(name=>[sportsNameKey(name),family])));
const teamFamily=(value,sport)=>sport==='baseball'?teamFamilies.get(sportsNameKey(value)):null;
const teamMatches=(team,query,sport,printedOnly)=>matches(team,query)||(!printedOnly&&teamFamily(query,sport)&&teamFamily(team,sport)===teamFamily(query,sport));
let referenceRows,numbers,playerNames,suggestionIndex;
export function sportsReferenceRows(){
 if(referenceRows)return referenceRows;
 referenceRows=[];
 for(const [sport,sets] of [['baseball',baseballSets],['football',footballSets]])for(const set of sets){
  if((sport==='baseball'?checklistPublicationProblems(set,set):footballChecklistPublicationProblems(set)).length)continue;
  for(const section of [{name:set.baseChecklistLabel||'Base',cards:set.cards},...sectionsForSet(set)])for(const card of section.cards)referenceRows.push({sport,set,card,section:section.name,type:kind(section.name,section.kind),href:'/'+sport+'/checklists/'+set.id+'/cards/'+card.id});
 }
 referenceRows.sort((a,b)=>newestReleaseFirst(a.set,b.set));
 numbers=new Set(referenceRows.map(r=>normalizeSportsCardNumber(r.card.cardNumber)));
 playerNames=new Set(referenceRows.flatMap(r=>r.card.subjects.map(s=>sportsNameKey(s.name).replaceAll(' ',''))));return referenceRows;
}
const fields=['q','sport','player','number','team','set','type','from','to','sort','teamNames'];
export function sportsSearchResults(url){
 const all=sportsReferenceRows(),selected=Object.fromEntries(fields.map(f=>[f,(url.searchParams.get(f)||'').trim().slice(0,100)]));
 if(!selected.number&&selected.player&&numbers.has(normalizeSportsCardNumber(selected.player))){selected.number=selected.player;selected.player='';}
 if(!selected.number&&selected.q&&!/^\d{4}$/.test(selected.q)&&numbers.has(normalizeSportsCardNumber(selected.q))){selected.number=selected.q;selected.q='';}
 if(/^(?:19|20)\d{2}$/.test(selected.q)&&!selected.from&&!selected.to){selected.from=selected.to=selected.q;selected.q='';}
 if(!['','newest','oldest','player','number'].includes(selected.sort))return null;
 if(!['','printed'].includes(selected.teamNames))return null;
 if(['from','to'].some(f=>selected[f]&&!/^\d{4}$/.test(selected[f]))||(selected.from&&selected.to&&selected.from>selected.to))return null;
 const personQuery=selected.q.replace(/\b(?:19|20)\d{2}\b/g,'').trim();
 const namedPlayer=!!personQuery&&playerNames.has(sportsNameKey(personQuery).replaceAll(' ',''));
 const queryYears=[...selected.q.matchAll(/\b(?:19|20)\d{2}\b/g)].map(m=>Number(m[0])),printedOnly=selected.teamNames==='printed';
 const rows=all.filter(r=>(!selected.sport||r.sport===selected.sport)&&(!selected.set||r.set.id===selected.set)&&(!selected.type||r.type===selected.type)&&(!selected.from||r.set.year>=Number(selected.from))&&(!selected.to||r.set.year<=Number(selected.to))&&queryYears.every(y=>r.set.year===y)&&(!selected.number||normalizeSportsCardNumber(r.card.cardNumber)===normalizeSportsCardNumber(selected.number))&&(!namedPlayer||r.card.subjects.some(s=>matches(s.name,personQuery)))&&(!selected.q||matches([r.set.displayName,r.set.year,r.card.cardNumber,r.card.player,r.card.team,r.section,...r.card.subjects.flatMap(s=>[s.name,s.team])].join(' '),selected.q)||(!printedOnly&&teamFamily(personQuery,r.sport)&&queryYears.every(y=>r.set.year===y)&&r.card.subjects.some(s=>teamMatches(s.team,personQuery,r.sport,false))))&&r.card.subjects.some(s=>(!selected.player||matches(s.name,selected.player))&&(!selected.team||teamMatches(s.team,selected.team,r.sport,printedOnly))));
 if(selected.sort==='oldest')rows.sort((a,b)=>releaseOrderInfo(a.set).key.localeCompare(releaseOrderInfo(b.set).key)||natural.compare(a.set.displayName,b.set.displayName)||natural.compare(a.card.cardNumber,b.card.cardNumber));
 if(selected.sort==='player')rows.sort((a,b)=>natural.compare(a.card.player,b.card.player)||newestReleaseFirst(a.set,b.set)||natural.compare(a.card.cardNumber,b.card.cardNumber));
 if(selected.sort==='number')rows.sort((a,b)=>natural.compare(a.card.cardNumber,b.card.cardNumber)||newestReleaseFirst(a.set,b.set)||natural.compare(a.card.player,b.card.player));
 const pageText=url.searchParams.get('page')||'1',page=Number(pageText),pages=Math.max(1,Math.ceil(rows.length/pageSize));
 if(!/^[1-9]\d*$/.test(pageText)||page>pages)return null;
 return {all,selected,rows,page,pages,pageSize};
}
// Public checklist metadata only: no inventory, database or marketplace calls.
export function sportsSearchSuggestions(query,sport=''){
 if(String(query||'').length<2||String(query).length>100)return [];
 sportsReferenceRows();
 if(!suggestionIndex){
  const groups=new Map(),add=(value,type,sport)=>{if(!value||(type==='Player'&&/[#\d]|\b(?:graded|topps|bowman)\b/i.test(value)))return;const key=sport+'|'+type+'|'+sportsNameKey(value),prior=groups.get(key);if(prior)prior.count++;else groups.set(key,{value,type,sport,count:1});};
  for(const row of referenceRows){for(const s of row.card.subjects){add(s.name,'Player',row.sport);add(s.team,'Team',row.sport);}add(row.set.displayName,'Set',row.sport);}suggestionIndex=[...groups.values()];
 }
 const exact=sportsNameKey(query);
 return suggestionIndex.filter(s=>(!sport||s.sport===sport)&&matches(s.value,query)).sort((a,b)=>(sportsNameKey(b.value)===exact)-(sportsNameKey(a.value)===exact)||b.count-a.count||a.value.length-b.value.length||a.value.localeCompare(b.value)).slice(0,12).map(s=>({value:s.value,type:s.type,label:s.type+' · '+s.sport+' · '+s.count+' checklist appearances'}));
}
export const sportsCollectorLink=(sport,field,value)=>root+'?'+new URLSearchParams({sport,[field]:value});
export function sportsSearchClient(){
 const form=document.querySelector('[data-sports-finder]'),input=form?.querySelector('[name="q"]'),list=document.getElementById('mp-sports-suggestions');if(!input||!list)return;
 let timer,controller;
 input.addEventListener('input',()=>{
  for(const name of ['player','number']){const old=form.querySelector('[name="'+name+'"]');if(old)old.value='';}
  clearTimeout(timer);controller?.abort();list.replaceChildren();const query=input.value.trim();if(query.length<2)return;
  timer=setTimeout(async()=>{const current=new AbortController();controller=current;
   try{const p=new URLSearchParams({suggest:query,sport:form.querySelector('[name="sport"]').value});const response=await fetch('/sports/checklists?'+p,{signal:current.signal});if(!response.ok)return;const data=await response.json();if(current.signal.aborted||input.value.trim()!==query)return;list.replaceChildren(...data.suggestions.slice(0,12).map(s=>{const option=document.createElement('option');option.value=s.value;option.label=s.label;return option;}));}catch{}
  },250);
 });
}
const finderStyle='<style>.mp-finder-nav{font:14px/1.5 system-ui;margin:0 0 12px}.mp-finder-nav a{font:600 14px/1.5 system-ui!important}.mp-finder-intro{font:16px/1.5 system-ui;max-width:70ch;margin:12px 0}.mp-player-filters>p{font:14px/1.4 system-ui;margin:8px 0 0}.mp-finder-options>summary{font:600 14px/1.45 system-ui}.mp-player-filters input,.mp-player-filters select{font:400 16px/1.4 system-ui}.mp-player-filters{padding:16px;border:1px solid var(--wo-border,#777);border-radius:14px;margin:16px 0}.mp-finder-primary{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:end}.mp-player-filters label{display:grid;gap:6px;min-width:0;font:600 15px/1.4 system-ui}.mp-player-filters input,.mp-player-filters select,.mp-player-filters button{width:100%;min-height:46px;min-width:0;max-width:100%;box-sizing:border-box;font:inherit;padding:10px;border:1px solid var(--wo-border,#777);border-radius:8px;background:var(--wo-surface,#292333);color:var(--wo-text,inherit)}.mp-player-filters button{background:var(--wo-button,#8bd450);color:var(--wo-on-button,#111);font-weight:750}.mp-finder-options{margin-top:12px}.mp-finder-options>summary{min-height:44px;display:flex;align-items:center;cursor:pointer}.mp-finder-advanced{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));gap:12px;margin:12px 0}.mp-cross-card{padding:16px;border:1px solid var(--wo-border,#777);border-radius:12px;overflow-wrap:anywhere;min-width:0}.mp-finder-results{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(100%,390px),1fr))}.mp-cross-card h2,.mp-cross-card h2 a{font:750 20px/1.35 system-ui!important}.mp-cross-card>p{font:14px/1.5 system-ui}.mp-cross-pages{display:flex;gap:20px;flex-wrap:wrap;padding:20px 0}.mp-cross-pages a{min-height:44px;display:inline-flex;align-items:center}.mp-finder-summary{font:15px/1.5 system-ui}.mp-finder-examples{display:flex;gap:12px;flex-wrap:wrap}.mp-finder-examples a{min-height:44px;display:inline-flex;align-items:center}@media(max-width:540px){.mp-finder-primary{grid-template-columns:1fr}.mp-player-filters{padding:12px}.mp-cross-card{padding:12px}}</style>';
export function sportsPlayerTeamSearch(url,escape,shopping={}){
 const result=sportsSearchResults(url);if(!result)return null;
 const {all,selected,rows,page,pages}=result;
 const link=(changes={})=>{const p=new URLSearchParams();for(const f of fields){const value=changes[f]??selected[f];if(value)p.set(f,value);}if(changes.page>1)p.set('page',changes.page);return root+(p.size?'?'+p:'');};
 const options=(entries,value)=>entries.map(([v,label])=>'<option value="'+escape(v)+'"'+(value===v?' selected':'')+'>'+escape(label)+'</option>').join('');
 const context=all.filter(r=>!selected.sport||r.sport===selected.sport),teams=[...new Set(context.flatMap(r=>r.card.subjects.map(s=>s.team).filter(Boolean)))].sort(),sets=newestReleases([...new Map(context.map(r=>[r.set.id,r.set])).values()]),years=[...new Set(context.map(r=>String(r.set.year)))].sort().reverse();
 const filtered=fields.some(f=>!['sort','teamNames'].includes(f)&&selected[f]);
 const custom=filtered||!!selected.sort||!!selected.teamNames;
 const active=fields.filter(f=>!['q','sort','teamNames'].includes(f)&&selected[f]).map(f=>'<a href="'+escape(link({[f]:'',page:1}))+'">'+escape(({player:'Player',number:'Card #',team:'Team',sport:'Sport',from:'From',to:'Through',set:'Set',type:'Section'}[f])+' · '+(f==='set'?sets.find(s=>s.id===selected[f])?.displayName||selected[f]:selected[f]))+' ×</a>').join(' · ');
 const select=(field,label,entries,empty)=>'<label>'+label+'<select name="'+field+'"><option value="">'+empty+'</option>'+options(entries,selected[field])+'</select></label>';
 const input=(field,label,placeholder)=>'<label>'+label+'<input name="'+field+'" type="search" maxlength="100" value="'+escape(selected[field])+'" placeholder="'+placeholder+'"></label>';
 const form='<form class="mp-player-filters" data-sports-finder method="get" action="'+root+'"><div class="mp-finder-primary"><label>Player, team, set or card number<input name="q" type="search" maxlength="100" value="'+escape(selected.q)+'" placeholder="Ken Griffey Jr., Seattle Mariners, FSA-G…" list="mp-sports-suggestions" autocomplete="off"><datalist id="mp-sports-suggestions"></datalist></label><button type="submit">Find cards</button></div><details class="mp-finder-options"><summary>Refine by player, team, year or card type</summary><div class="mp-finder-advanced">'+select('sport','Sport',[['baseball','Baseball'],['football','Football']],'Both sports')+input('player','Player name','e.g. Ken Griffey Jr.')+input('number','Exact card number','e.g. FSA-G')+select('team','Printed team',teams.map(t=>[t,t]),'All teams')+select('teamNames','Team names',[['printed','Printed name only']],'Include known former names')+select('from','From set year',years.map(y=>[y,y]),'Earliest available')+select('to','Through set year',years.map(y=>[y,y]),'Latest available')+select('set','Set',sets.map(s=>[s.id,s.displayName]),'Across all sets')+select('type','Card section',[['base','Base'],['prospects','Prospects'],['inserts','Inserts & chases'],['autographs','Autographs'],['relics','Relics'],['variations','Variations & parallels']],'All card sections')+select('sort','Order',[['newest','Newest sets first'],['oldest','Oldest sets first'],['player','Player name'],['number','Card number']],'Newest sets first')+'</div><button type="submit">Apply filters</button></details><p><a href="'+root+'">Reset filters</a></p></form>'+(active?'<p class="mp-finder-summary">Active filters: '+active+'</p>':'');
 const cards=rows.slice((page-1)*pageSize,page*pageSize).map(r=>'<article class="mp-cross-card"><h2><a href="'+escape(r.href)+'">'+escape(r.card.player||r.card.subjects.map(s=>s.name).join(' / '))+' · #'+escape(r.card.cardNumber)+'</a></h2><p>'+escape(r.set.displayName)+' · '+escape(r.section)+'</p><p>'+r.card.subjects.map(s=>'<a aria-label="'+escape('All '+s.name+' cards across sets and years')+'" href="'+escape(sportsCollectorLink(r.sport,'player',s.name))+'">'+escape(s.name)+'</a>'+(s.team?' · <a aria-label="'+escape('All '+s.team+' cards across sets and years')+'" href="'+escape(sportsCollectorLink(r.sport,'team',s.team))+'">'+escape(s.team)+'</a>':'')).join(' / ')+'</p>'+(filtered?relatedParallelLinks(r.set,r.card,escape,shopping):'')+'</article>').join('');
 const matchingSets=new Set(rows.map(r=>r.set.id)).size,summary=rows.length+' matching checklist '+(rows.length===1?'entry':'entries')+' across '+matchingSets+' '+(matchingSets===1?'set':'sets')+'.';
 return {title:'Card Finder — Players, Teams, Sets & Card Numbers'+(page>1?' — Page '+page:'')+' | The Mana Pocket',description:'Find a player’s cards across every published checklist, team and set year at The Mana Pocket. Browse base cards, autographs, inserts, reference photos and numbered parallels.',canonicalPath:custom?root:link({page}),robotsNoindex:custom,bodyHtml:parallelFamilyStyle+finderStyle+'<p class="mp-finder-nav"><a href="/baseball">Baseball sets</a> · <a href="/football">Football sets</a></p><h1>Find your player. See their cards.</h1><p class="mp-finder-intro">One search across all our published checklists and set years. Base cards, autos, inserts and variations. Open a card’s photo to explore its parallel family.</p>'+form+'<p class="mp-finder-summary" role="status">'+summary+' Showing '+(rows.length?(page-1)*pageSize+1:0)+'–'+Math.min(page*pageSize,rows.length)+'.</p>'+(!filtered?'<div class="mp-finder-examples"><a href="'+root+'?q=Ken+Griffey+Jr.">Ken Griffey Jr.</a><a href="'+root+'?q=Seattle+Mariners">Seattle Mariners</a><a href="'+root+'?number=FSA-G">Card #FSA-G</a></div>':'')+'<div class="mp-finder-results">'+cards+'</div>'+(!rows.length?'<p>No published checklist entries match those filters. Try the last name, a shorter team name, or remove the set/year filters. A full card number must match exactly.</p>':'')+'<nav class="mp-cross-pages" aria-label="Search result pages">'+(page>1?'<a href="'+escape(link({page:page-1}))+'">← Previous</a>':'')+'<span>Page '+page+' of '+pages+'</span>'+(page<pages?'<a href="'+escape(link({page:page+1}))+'">Next →</a>':'')+'</nav><details><summary>Checklist coverage &amp; name matching</summary><p>'+all.length+' published checklist entries across '+new Set(all.map(r=>r.set.id)).size+' sets. Every published base and non-base entry participates. Parallel families appear under their original card instead of inflating this count. This is our published library, not every card ever printed; collecting a source does not automatically publish its checklist.</p><p>Player names ignore capitalization, accents and punctuation. Jr. and Sr. stay distinct when specified. Team filters preserve printed labels and include known Angels, Cleveland and Athletics name changes by default. Choose Printed name only for exact historical names. This never moves old cards to a player’s current team. For multi-player cards, the selected player and team must belong to the same printed subject.</p><p>Reference photos are not sale listings. Open the card page for store inventory, or expand a parallel for reference and marketplace options. Photos load in small batches as needed.</p></details><script>('+sportsSearchClient.toString()+')();</script>'};
}
