import {licensedSportsSets} from './licensed-sports-seed.mjs';
import {licensedSportsPublicationProblems} from './licensed-sports-policy.mjs';
import {baseballSets} from './topps/baseball-seed.mjs';
import {footballSets} from './topps/football-seed.mjs';
import {checklistPublicationProblems,footballChecklistPublicationProblems} from './topps/public-checklist-policy.mjs';
import {sectionsForSet,checklistCardNavigation} from './baseball-section-pages.mjs';
import {sportsChecklistNavigation,sportsChecklistRedirect,sportsSectionCollections} from './sports-checklist-ui.mjs';
import {setPageHeader} from './collector-page-ui.mjs';
import {collectionToolsHtml} from './collection-tools.mjs';
import {referenceImageHtml} from './sports-reference-images.mjs';
import {newestReleases} from './release-order.mjs';
const origin='https://www.themanapocket.com',labels={hockey:'Hockey',basketball:'Basketball'};
export const publishedLicensedSportsSets=licensedSportsSets.filter(s=>!licensedSportsPublicationProblems(s).length);
const setPath=s=>'/'+s.sport+'/checklists/'+s.id;
const cardPath=(s,c)=>setPath(s)+'/cards/'+c.id;
const groupPath=(s,g)=>setPath(s)+'/sections/'+g.id;
const groupsFor=s=>[...sportsSectionCollections(s.sections||[]),...(s.sections||[])];
function pathsFor(sport){const sets=publishedLicensedSportsSets.filter(s=>s.sport===sport);return ['/'+sport,...sets.flatMap(s=>[setPath(s),...s.cards.map(c=>cardPath(s,c)),...groupsFor(s).map(g=>groupPath(s,g)),...(s.sections||[]).flatMap(g=>g.cards.map(c=>cardPath(s,c)))])];}
export async function handleLicensedSportsCatalog(request,env,url,deps){
 const sport=Object.keys(labels).find(s=>url.pathname==='/'+s||url.pathname.startsWith('/'+s+'/')||url.pathname==='/sitemap-'+s+'.xml');
 if(!['GET','HEAD'].includes(request.method)||(!sport&&!['/sports/sets','/sitemap-sports-sets.xml'].includes(url.pathname)))return null;
 const esc=deps.escape,html=(p,status=200)=>new Response(request.method==='HEAD'?null:deps.shell(p),{status,headers:{'Content-Type':'text/html;charset=UTF-8','Cache-Control':'no-store'}});
 const missing=()=>html({title:'Checklist not found | The Mana Pocket',canonicalPath:url.pathname,robotsNoindex:true,bodyHtml:'<h1>Checklist not found</h1><p><a href="/sports/sets">Browse published sports checklists</a></p>'},404);
 if(url.pathname==='/sitemap-sports-sets.xml'||url.pathname==='/sitemap-'+sport+'.xml'){
  if(sport&&!publishedLicensedSportsSets.some(s=>s.sport===sport))return missing();
  const paths=sport?pathsFor(sport):['/sports/sets'],size=40000,parts=Math.ceil(paths.length/size),raw=url.searchParams.get('part');
  if(raw!==null&&(!/^[1-9]\d*$/.test(raw)||Number(raw)>parts))return missing();
  const index=parts>1&&raw===null,entries=index?Array.from({length:parts},(_,i)=>url.pathname+'?part='+(i+1)):raw?paths.slice((Number(raw)-1)*size,Number(raw)*size):paths;
  const tag=index?'sitemap':'url',root=index?'sitemapindex':'urlset';
  return new Response(request.method==='HEAD'?null:'<?xml version="1.0" encoding="UTF-8"?><'+root+' xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+entries.map(p=>'<'+tag+'><loc>'+origin+esc(p)+'</loc></'+tag+'>').join('')+'</'+root+'>',{headers:{'Content-Type':'application/xml;charset=UTF-8','Cache-Control':'public,max-age=900'}});
 }
 if(url.pathname==='/sports/sets'){
  const all=[...baseballSets.filter(s=>!checklistPublicationProblems(s,s).length),...footballSets.filter(s=>!footballChecklistPublicationProblems(s).length),...publishedLicensedSportsSets];
  const q=(url.searchParams.get('q')||'').trim().slice(0,100),filter=url.searchParams.get('sport')||'',sports=[...new Set(all.map(s=>s.sport))];
  if(filter&&!sports.includes(filter))return missing();
  const rows=newestReleases(all.filter(s=>(!filter||s.sport===filter)&&(!q||[s.displayName,s.year,s.brand].join(' ').toLowerCase().includes(q.toLowerCase()))));
  return html({title:'Sports Checklist Library | The Mana Pocket',description:'Browse published, reviewed sports releases by sport, set and year.',canonicalPath:'/sports/sets',robotsNoindex:!!(q||filter),bodyHtml:setPageHeader({title:'Sports checklist library',description:'Find a published set, then browse its numbered cards and versions.',stats:[all.length+' releases',sports.length+' sports'],actions:[['Find players and card numbers','/sports/checklists']]},esc)+'<form class="mp-checklist-tools" method="get"><label>Find a set<input type="search" name="q" maxlength="100" value="'+esc(q)+'"></label><label>Sport<select name="sport"><option value="">All published sports</option>'+sports.map(s=>'<option value="'+s+'"'+(s===filter?' selected':'')+'>'+esc(s[0].toUpperCase()+s.slice(1))+'</option>').join('')+'</select></label><button type="submit">Find sets</button></form><p>'+rows.length+' matching releases. This library is expanding; it does not yet include every licensed release.</p><div class="mp-set-list">'+rows.map(s=>'<a class="mp-set-row" href="'+setPath(s)+'"><span>'+esc(s.displayName)+'</span><span>'+esc(s.sport)+' · '+s.cards.length+' base entries</span></a>').join('')+'</div>'});
 }
 const sets=newestReleases(publishedLicensedSportsSets.filter(s=>s.sport===sport));
 if(!sets.length)return missing();
 if(url.pathname==='/'+sport)return html({title:labels[sport]+' Checklists | The Mana Pocket',description:'Reviewed licensed '+sport+' checklists with distinct numbered printings.',canonicalPath:'/'+sport,bodyHtml:setPageHeader({title:labels[sport]+' checklists',description:'Browse reviewed publisher checklists. Open a set to compare its base cards, inserts and parallel printings.',actions:[['All sports and years','/sports/sets'],['Find cards','/sports/checklists?sport='+sport]]},esc)+'<div class="mp-set-list">'+sets.map(s=>'<a class="mp-set-row" href="'+setPath(s)+'"><span>'+esc(s.displayName)+'</span><span>'+s.cards.length+' base entries · '+s.sections.reduce((n,g)=>n+g.cards.length,0)+' other printings</span></a>').join('')+'</div>'});
 const set=sets.find(s=>url.pathname===setPath(s)||url.pathname.startsWith(setPath(s)+'/'));
 if(!set)return missing();
 const root=setPath(set),groups=groupsFor(set),all=[...set.cards,...set.sections.flatMap(g=>g.cards)];
 if(url.pathname===root){const redirect=sportsChecklistRedirect(url,set,set.sections,sport);if(redirect)return redirect;}
 const card=all.find(c=>url.pathname===cardPath(set,c));
 // A parallel query must never silently return the ordinary base printing.
 if(url.searchParams.has('parallel')||url.searchParams.has('market'))return missing();
 if(card&&url.searchParams.has('reference'))return new Response(request.method==='HEAD'?null:JSON.stringify({reference:null,referenceStatus:'not_verified'}),{headers:{'Content-Type':'application/json;charset=UTF-8','Cache-Control':'public,max-age=300','X-Robots-Tag':'noindex','Access-Control-Allow-Origin':'https://squeebmike.github.io'}});
 const breadcrumb='<p><a href="/sports/sets">Sports checklists</a> / <a href="/'+sport+'">'+esc(labels[sport])+'</a> / <a href="'+root+'">'+esc(set.displayName)+'</a></p>';
 const provider=set.providerConsoles?.find(id=>/^[a-z0-9-]+$/.test(id));
 const publisher=(set.sourceExceptions?.length?'<p>Publisher-source exceptions: six rows repeat card number C190 for different subjects in three Canvas sections. Those ambiguous rows are withheld until corrected identities are verified.</p>':'')+(provider?'<p><a href="https://www.sportscardspro.com/console/'+provider+'">Provider set reference on SportsCardsPro</a> · May include other checklist sections.</p>':'')+'<p><a href="'+esc(set.sourceUrl)+'">Official '+esc(set.brand)+' checklist</a> · <a href="'+esc(set.licensingEvidence.sourceUrl)+'">Licensing source</a></p>';
 const metadata=c=>'<p>'+esc(c.printedSection||c.section)+(c.checklistCard?' · Checklist card':'')+'</p><ul>'+c.subjects.map(s=>'<li>'+esc(s.name)+(s.team?' · '+esc(s.team):'')+(s.note?' · '+esc(s.note):'')+'</li>').join('')+'</ul>'+(c.printedSerial?'<p>Publisher numbering: '+esc(c.printedSerial)+'</p>':'')+(c.printedOdds?'<p>Publisher odds: '+esc(c.printedOdds)+'. See the publisher checklist for pack-format abbreviations.</p>':'')+(c.printedSP?'<p>Publisher special-print designation: '+esc(c.printedSP)+'</p>':'')+(c.printedAuto?'<p>Publisher autograph designation: '+esc(c.printedAuto)+'</p>':'')+(c.printedMemTech?'<p>Publisher material / technology designation: '+esc(c.printedMemTech)+'</p>':'');
 if(card){
  const section=card.section==='Base'?null:set.sections.find(g=>g.cards.includes(card)),siblings=section?section.cards:set.cards,title=card.player+' #'+card.cardNumber+' — '+set.displayName+(section?' · '+section.name:'');
  return html({title:title+' | The Mana Pocket',description:'Exact numbered '+sport+' checklist printing from the official publisher source.',canonicalPath:cardPath(set,card),jsonLd:{'@context':'https://schema.org','@type':'WebPage',name:title,citation:set.sourceUrl,isPartOf:{'@type':'CollectionPage',name:set.displayName,url:origin+root}},bodyHtml:breadcrumb+'<h1>'+esc(title)+'</h1>'+metadata(card)+referenceImageHtml(null,card.player+' #'+card.cardNumber,esc)+'<p>A reference photo and estimate have not yet been verified for this printing.</p>'+checklistCardNavigation(set,siblings,card,esc)+'<p>This is a checklist reference, not a copy offered for sale. <a href="/category/sports-cards">Browse available sports cards</a>.</p>'+publisher+'<p><a href="'+(section?groupPath(set,section):root)+'">Back to this checklist section</a></p>'});
 }
 const group=groups.find(g=>url.pathname===groupPath(set,g));
 if(url.pathname!==root&&!group)return missing();
 const sourceCards=group?group.cards:set.cards,q=(url.searchParams.get('q')||'').trim().slice(0,100),rows=sourceCards.filter(c=>!q||[c.player,c.team,c.cardNumber,c.printedSection].join(' ').toLowerCase().includes(q.toLowerCase()));
 const pageText=url.searchParams.get('page')||'1',page=Number(pageText),pages=Math.max(1,Math.ceil(rows.length/60)),path=group?groupPath(set,group):root;
 if(!/^[1-9]\d*$/.test(pageText)||page>pages)return missing();
 const pagePath=n=>path+(q?'?q='+encodeURIComponent(q)+(n>1?'&page='+n:''):n>1?'?page='+n:'');
 const title=set.displayName+(group?' — '+group.name:'');
 const releaseInfo='<section id="parallel-guide"><h2>Parallels and variations</h2><p>Each publisher-listed printing has its own section and card page. Compare the finish and printed serial numbering with your copy.</p></section><section id="pack-odds"><h2>Pack odds</h2><p>Publisher-stated odds and pack-format abbreviations appear on the individual printing pages. <a href="'+esc(set.sourceUrl)+'">Read the official checklist</a> for the exact pack format.</p></section>';
 return html({title:title+(page>1?' — Page '+page:'')+' | The Mana Pocket',description:'Numbered '+sport+' checklist entries from the official publisher source.',canonicalPath:q?path:pagePath(page),robotsNoindex:!!q,jsonLd:{'@context':'https://schema.org','@type':'CollectionPage',name:title,citation:set.sourceUrl},bodyHtml:breadcrumb+setPageHeader({title,description:group?'Compare exact printings in this publisher section.':set.scope,stats:[sourceCards.length+' entries'],actions:[['Search this section','#checklist-search'],['All sports','/sports/sets']]},esc)+sportsChecklistNavigation(set,set.sections,esc,{sport,current:group?.id||'base'})+releaseInfo+collectionToolsHtml(sourceCards.map(c=>({...c,name:c.player})),{scope:sport+'/'+set.id+(group?'/'+group.id:''),path:c=>cardPath(set,c),escape:esc})+'<form id="checklist-search" class="mp-checklist-tools" method="get" action="'+path+'"><label>Player, team or card number<input name="q" type="search" maxlength="100" value="'+esc(q)+'"></label><button type="submit">Search checklist</button></form><p>'+rows.length+' matching entries. Checklist entries do not mean a copy is available for sale.</p><div class="mp-set-list">'+rows.slice((page-1)*60,page*60).map(c=>'<div><a class="mp-set-row" href="'+cardPath(set,c)+'"><span>#'+esc(c.cardNumber)+' · '+esc(c.player)+'</span><span>'+esc(c.team)+'</span></a>'+metadata(c)+'</div>').join('')+'</div><nav aria-label="Checklist pages">'+Array.from({length:pages},(_,i)=>i+1).map(n=>n===page?'<span aria-current="page">Page '+n+'</span>':'<a href="'+esc(pagePath(n))+'">Page '+n+'</a>').join(' · ')+'</nav>'+publisher});
}
