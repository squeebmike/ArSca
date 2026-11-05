import assert from 'node:assert/strict';
import {novemberSportsSets} from '../scripts/topps/new-releases-2026-11.mjs';
import {novemberReleaseGuides,mergeNovemberGuides} from '../scripts/november-release-guides.mjs';
import {deltaReignCards} from '../scripts/pokemon-delta-reign-checklist.mjs';
import {handleDeltaReignChecklist} from '../scripts/delta-reign-page.mjs';
import {sectionsForSet} from '../scripts/baseball-section-pages.mjs';
import {licensedSportsPublicationProblems} from '../scripts/licensed-sports-policy.mjs';
import {releaseGuide} from '../scripts/comic-articles.mjs';
for(const [i,base,groups,total] of [[0,200,22,890],[1,300,63,3244]]){
 const s=novemberSportsSets[i],cards=[...s.cards,...s.sections.flatMap(g=>g.cards)];
 assert.equal(s.cards.length,base);assert.equal(s.sections.length,groups);assert.equal(cards.length,total);
 assert.equal(new Set(cards.map(c=>c.id)).size,total);
 assert.deepEqual(s.cards.map(c=>Number(c.cardNumber)),Array.from({length:base},(_,i)=>i+1));
 assert.equal(sectionsForSet(s).length,groups);
 assert.ok(cards.every(c=>c.player&&c.subjects.every(x=>x.name)&&!c.player.includes('�')));
 assert.match(s.sourceSha256,/^[a-f0-9]{64}$/);
}
assert.deepEqual(licensedSportsPublicationProblems(novemberSportsSets[1]),[]);
const dual=novemberSportsSets[0].sections.find(g=>g.name==='Dual Star Clusters').cards.find(c=>c.cardNumber==='DSC-2');
assert.deepEqual(dual.subjects.map(s=>s.name),['Yoshinobu Yamamoto','Shohei Ohtani']);
assert.equal(novemberSportsSets[1].cards.find(c=>c.cardNumber==='176').player,'Nickeil Alexander-Walker');
assert.equal(novemberSportsSets[1].cards.find(c=>c.cardNumber==='209').team,'Seattle Supersonics');
assert.equal(deltaReignCards.length,141);assert.deepEqual(deltaReignCards.map(c=>c.number),Array.from({length:141},(_,i)=>i+1));
assert.equal(deltaReignCards.find(c=>c.number===84).name,'Mega Rayquaza ex');
assert.ok(deltaReignCards.every(c=>!c.image),'no foreign scans or fabricated English image URLs');
assert.equal(novemberReleaseGuides.length,4);
for(const a of novemberReleaseGuides){assert.ok(a.bodyHtml.replace(/<[^>]*>/g,' ').split(/\s+/).length>650,a.slug+' has a full original write-up');assert.ok(releaseGuide(a.slug)?.checklist);}
const old={slug:novemberReleaseGuides[0].slug,bodyHtml:'Old CMS copy',updatedAt:'2026-10-01',image:'cms-cover'};
assert.equal(mergeNovemberGuides([old]).find(a=>a.slug===old.slug).image,'cms-cover');
const newer={...old,bodyHtml:'Later editor revision',updatedAt:'2026-11-06'};
assert.equal(mergeNovemberGuides([newer]).find(a=>a.slug===old.slug).bodyHtml,newer.bodyHtml);
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');let page;
const get=async(path,method='GET')=>handleDeltaReignChecklist(new Request('https://example.test'+path,{method}),new URL('https://example.test'+path),{escape,shell:p=>(page=p,p.bodyHtml)});
let r=await get('/pokemon/checklists/delta-reign');assert.equal(r.status,200);let html=await r.text();assert.match(html,/not an official publisher master checklist/);assert.match(html,/141\/103/);assert.match(html,/data-collection-list/);
r=await get('/pokemon/checklists/delta-reign?q=%3Cscript%3E');html=await r.text();assert.ok(page.robotsNoindex);assert.ok(!html.includes('value="<script>')); assert.match(html,/&lt;script>/);
assert.equal(await(await get('/pokemon/checklists/delta-reign','HEAD')).text(),'');
console.log('November releases: official numbered rosters, shared subjects, licensing, original guides, editor precedence and sourced Pokémon list passed');
