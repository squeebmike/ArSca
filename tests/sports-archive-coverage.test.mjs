import assert from 'node:assert/strict';
import {archiveNonbaseSections} from '../scripts/topps/archive-nonbase-sections.mjs';
import {bowmanProspectSections} from '../scripts/topps/bowman-prospect-sections.mjs';
import {baseballChecklistInventoryMatches} from '../scripts/topps/public-checklist-policy.mjs';
import {sectionsForSet,baseballSectionSitemapPaths,prospectUrlCorrections,handleBaseballSections} from '../scripts/baseball-section-pages.mjs';
import {baseballSets} from '../scripts/topps/baseball-seed.mjs';
import {footballSets} from '../scripts/topps/football-seed.mjs';
import {sportsReferenceRows,sportsPlayerTeamSearch} from '../scripts/sports-player-team-search.mjs';
const sets=[...baseballSets,...footballSets];let cards=0;
for(const source of archiveNonbaseSections){assert.match(source.sourceSha256,/^[a-f0-9]{64}$/);assert.match(source.sourceUrl,/^https:\/\/(?:cdn.shopify.com|(?:www\.)?topps.com)\//);assert.ok(sets.some(s=>s.id===source.setId));}
for(const set of sets){const groups=sectionsForSet(set);if((/^20(?:19|20|21|23|24)-topps-big-league-baseball$/.test(set.id)||set.id==='2024-topps-update-series-baseball')){assert.equal(groups.length,0);assert.match(set.scope,/Inserts, autographs.*not yet imported/);}else if(set.id==='2024-topps-five-star-baseball')assert.equal(groups.length,0,'Five Star scope is explicitly base autographs only');else assert.ok(groups.length,set.id);assert.equal(new Set(groups.map(g=>g.id)).size,groups.length);const ids=new Set(set.cards.map(c=>c.id));for(const g of groups){assert.ok(g.cards.length);assert.equal(new Set(g.cards.map(c=>c.cardNumber)).size,g.cards.length);for(const c of g.cards){assert.ok(!ids.has(c.id),c.id);ids.add(c.id);cards++;assert.ok(c.cardNumber&&c.player&&c.subjects.length);assert.doesNotMatch(c.player+c.team,/�|Ã|Â/);assert.ok(c.subjects.every(s=>s.name));assert.equal(c.section,g.name);}}}
assert.equal(cards,66599);assert.equal(sets.length,72);
const paths=baseballSectionSitemapPaths(sets);assert.equal(new Set(paths).size,paths.length);
const refs=sportsReferenceRows();assert.equal(refs.length,sets.reduce((n,s)=>n+s.cards.length,0)+cards+16260);assert.equal(refs.filter(r=>r.sport==='hockey').length,12942);
const black=sets.find(s=>s.id==='2025-topps-chrome-black-football');assert.ok(sectionsForSet(black).some(g=>g.cards.some(c=>c.player==='A.J. Brown'&&c.cardNumber==='AU-ABR')));
const draft=sets.find(s=>s.id==='2025-bowman-draft-baseball');assert.ok(sectionsForSet(draft).some(g=>g.cards.some(c=>c.team===''&&c.player==='Anthony Eyanson')),'unprinted teams stay blank');
console.log('72 releases, 66,599 native non-base references, unique routes, source hashes, and player/team discovery checked');
for(const set of sets){
 const identities=new Set();
 for(const group of sectionsForSet(set).filter(g=>/^(?:(?:bowman-)?chrome|paper)-prospects(?:-i{1,2})?$/.test(g.id)))for(const card of group.cards){
  const key=card.cardNumber+'|'+card.player.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g,'');
  assert.ok(!identities.has(key),'duplicate prospect '+set.id+' '+key);identities.add(key);
 }
}
assert.equal(Object.keys(prospectUrlCorrections).length,556);
for(const [old,target] of Object.entries(prospectUrlCorrections)){
 assert.ok(!paths.includes(old),old);assert.ok(paths.includes(target),target);
 const url=new URL(old+'?parallel=gold&market=1','https://www.themanapocket.com');
 const response=await handleBaseballSections(new Request(url),{},url,{},sets,()=>{throw Error('rendered alias');},()=>{throw Error('missing alias');});
 assert.equal(response.status,301);assert.equal(response.headers.get('Location'),target+url.search);
}
assert.equal(bowmanProspectSections.length,5);
assert.equal(bowmanProspectSections.reduce((n,s)=>n+s.sections.length,0),7);
assert.equal(bowmanProspectSections.reduce((n,s)=>n+s.sections.reduce((sum,g)=>sum+g.cards.length,0),0),1100);
for(const source of bowmanProspectSections){
 const release=sets.find(s=>s.id===source.setId);assert.equal(source.sourceSha256,release.sourceSha256);assert.equal(source.sourceUrl,release.sourceUrl);
 for(const group of source.sections){assert.equal(group.kind,'Prospects');assert.ok(group.cards.every(c=>/^(?:BP|BCP|BDC)-\d+$/.test(c.cardNumber)));}
}
const spring=sets.find(s=>s.id==='2023-bowman'),springChrome=sectionsForSet(spring).find(g=>g.id==='chrome-prospects').cards[0],springPaper=sectionsForSet(spring).find(g=>g.id==='paper-prospects').cards[0];
const single={id:'ours',categorySlug:'sports-cards',year:2023,set:'2023 Bowman Chrome',player:springChrome.player,cardNumber:springChrome.cardNumber,name:springChrome.player+' #'+springChrome.cardNumber,subset:'Base',variant:'Base',price:5,quantity:1};
assert.ok(baseballChecklistInventoryMatches(single,springChrome,spring));
for(const [setId,sectionId] of [['2023-bowman-chrome','bowman-chrome-prospects'],['2025-bowman-baseball','chrome-prospects-i']]){
 const release=sets.find(s=>s.id===setId),card=sectionsForSet(release).find(g=>g.id===sectionId).cards[0];
 const item={...single,year:release.year,set:release.displayName.replace(/ Baseball$/,''),player:card.player,cardNumber:card.cardNumber,name:card.player+' #'+card.cardNumber};
 assert.ok(baseballChecklistInventoryMatches(item,card,release),'canonical prospect stock '+setId);
 assert.ok(baseballChecklistInventoryMatches({...item,subset:'Chrome Prospects'},card,release));
 assert.ok(!baseballChecklistInventoryMatches({...item,subset:'Extended Bowman Chrome Prospects'},card,release));
}
assert.ok(!baseballChecklistInventoryMatches(single,springPaper,spring),'Chrome and paper prospect prefixes are distinct');
for(const patch of [{year:2024},{cardNumber:'BCP-999'},{player:'Unrelated Player'},{subset:'Autographs'},{set:'2023 Topps Chrome'},{isSigned:true}])assert.ok(!baseballChecklistInventoryMatches({...single,...patch},springChrome,spring),JSON.stringify(patch));
const draft25=sets.find(s=>s.id==='2025-bowman-draft-baseball'),draftChrome=sectionsForSet(draft25).find(g=>g.id==='chrome-draft-picks').cards[0];
assert.ok(draftChrome.subjects.every(s=>s.team===''),'unprinted draft affiliations remain unknown');
assert.ok(baseballChecklistInventoryMatches({...single,year:2025,set:'2025 Bowman Chrome Draft',player:draftChrome.player,cardNumber:draftChrome.cardNumber,name:draftChrome.player+' #'+draftChrome.cardNumber},draftChrome,draft25));
assert.ok(!baseballChecklistInventoryMatches({...single,year:2025,set:'2025 Bowman Chrome Draft',player:draftChrome.player,cardNumber:'BD-1',name:draftChrome.player+' #BD-1'},draftChrome,draft25));
const prospectResults=sportsPlayerTeamSearch(new URL('https://www.themanapocket.com/sports/checklists?type=prospects&set=2023-bowman'),s=>String(s));
assert.match(prospectResults.bodyHtml,/320 matching checklist entries/);
assert.ok(sportsReferenceRows().filter(r=>r.set.id==='2023-bowman'&&/^(?:BP|BCP)-\d+$/.test(r.card.cardNumber)).every(r=>r.type==='prospects'));

for(const source of archiveNonbaseSections)for(const g of source.sections)if(g.cards.some(c=>/^\d+$/.test(c.cardNumber)))assert.ok(g.matchTerms?.length,'numeric non-base identity needs its printed subset');

const {checklistUrlCorrections}=await import('../scripts/topps/checklist-url-corrections.mjs');
assert.equal(Object.keys(checklistUrlCorrections).length,492);
const allPaths=new Set(sets.flatMap(s=>sectionsForSet(s).flatMap(g=>g.cards.map(c=>'/'+(s.sport==='football'?'football':'baseball')+'/checklists/'+s.id+'/cards/'+c.id))));
for(const [old,target] of Object.entries(checklistUrlCorrections)){assert.ok(!allPaths.has(old));assert.ok(allPaths.has(target),target);assert.notEqual(old,target);}
const series1=sets.find(s=>s.id==='2025-topps-series-1-baseball');
const murakami=sectionsForSet(series1).find(g=>g.id==='base-cards-murakami-variation');
assert.ok(murakami.cards.some(c=>c.cardNumber==='145'&&c.player==='Matt Olson'));
assert.ok(!murakami.cards.some(c=>/^\d+[A-Za-z]/.test(c.cardNumber)));
const series2=sets.find(s=>s.id==='2023-topps-series-2');
assert.ok(sectionsForSet(series2).find(g=>g.id==='base-cards-clear-variation').cards.some(c=>c.player==='Israel Pineda'&&c.team==='Washington Nationals'));
assert.ok(sectionsForSet(series2).find(g=>g.id==='2023-world-baseball-classic-stars').cards.some(c=>c.player==='Joc Pederson'&&c.team==='Israel'));

const chrome2026=sets.find(s=>s.id==='2026-topps-chrome-baseball');
assert.equal(chrome2026.cards.length,300);
assert.equal(new Set(chrome2026.cards.map(c=>c.cardNumber)).size,300);
assert.equal(sectionsForSet(chrome2026).length,48);
assert.ok(sectionsForSet(chrome2026).find(g=>g.id==='rookie-autographs').cards.some(c=>c.player==='Sal Stewart'));

const flagship21=sets.find(s=>s.id==='2021-topps-series-1-baseball');
assert.equal(flagship21.cards.find(c=>c.cardNumber==='61').player,'A Playful Bout of Juniors');
assert.equal(flagship21.cards.find(c=>c.cardNumber==='61').team,'Toronto Blue Jays');
const update21=sets.find(s=>s.id==='2021-topps-updates-baseball');
assert.equal(update21.cards.find(c=>c.cardNumber==='US117').player,'Hirokazu Sawamura');
assert.equal(update21.cards.find(c=>c.cardNumber==='US117').team,'Boston Red Sox');
const flagship20=sets.find(s=>s.id==='2020-topps-baseball-series-1');
const combo=flagship20.cards.find(c=>c.cardNumber==='31');
assert.equal(combo.player,'Close Call');
assert.equal(combo.subjects[0].sourceAffiliation,'American League');
assert.equal(combo.team,'');
assert.equal(sets.find(s=>s.id==='2020-topps-baseball-series-2').cards[0].cardNumber,'351');
assert.equal(sectionsForSet(flagship21).length,35);
