import assert from 'node:assert/strict';
import {fiveStar2026Sets,fiveStar2026Sections} from '../scripts/topps/five-star-2026.mjs';
import {baseballSets} from '../scripts/topps/baseball-seed.mjs';
import {checklistPublicationProblems} from '../scripts/topps/public-checklist-policy.mjs';
import {sectionsForSet,baseballSectionSitemapPaths,handleBaseballSections} from '../scripts/baseball-section-pages.mjs';
import {cardParallelProgram,selectedParallelCard,parallelPrograms,cardNumberingLabel} from '../scripts/sports-parallels.mjs';
import {referenceConsoles,referenceMetadataCheck} from '../scripts/reference-validation.mjs';
const set=fiveStar2026Sets[0],source=fiveStar2026Sections[0],groups=sectionsForSet(set),all=[...set.cards,...groups.flatMap(g=>g.cards)];
assert(baseballSets.includes(set));assert.deepEqual(checklistPublicationProblems(set,set),[]);assert.equal(set.releaseDate,'2026-10-28');assert.deepEqual(set.unissuedNumbers,[]);assert.equal(source.sourceSha256,set.sourceSha256);
assert.equal(set.cards.length,100);assert.equal(groups.length,22);assert.equal(all.length,750);assert.equal(new Set(all.map(c=>c.id)).size,750);assert.equal(all.reduce((n,c)=>n+c.subjects.length,0),799);
assert.equal(groups.find(g=>g.id==='five-star-triple-autographs').cards.length,11);assert.equal(groups.find(g=>g.id==='five-star-cut-signatures').cards.length,57);
const logo=groups.find(g=>g.id==='rookie-cap-patch-autographs-jackie-robinson-day-mlb-logo'),side=groups.find(g=>g.id==='rookie-cap-patch-autographs-jackie-robinson-day-side-logo');assert.equal(logo.cards.length,17);assert(logo.cards.every(c=>!side.cards.some(x=>x.id===c.id)));
for(const c of all){assert(c.subjects.every(s=>s.name));assert(!c.player.includes('\uFFFD'));assert.equal(c.subjects.length,c.printedRows.length);}
const california=all.flatMap(c=>c.subjects.map((s,i)=>({card:c,subject:s,raw:c.printedRows[i]}))).filter(x=>x.raw.includes('California Angels'));
assert.equal(california.length,6);for(const {subject,raw}of california){assert.equal(subject.team,'California Angels');assert(!subject.name.endsWith(' California'));assert(raw.startsWith(subject.name+' California Angels'));}
const carew=groups.find(g=>g.id==='five-star-retired-autographs').cards.find(c=>c.cardNumber==='FSA-RC');assert.equal(carew.player,'Rod Carew');assert.equal(carew.team,'California Angels');
assert.equal(referenceMetadataCheck({consoleId:'baseball-cards-2026-topps-five-star-retired-autograph',title:'Rod Carew #FSA-RC',player:'Rod Carew',cardNumber:'FSA-RC',parallel:'',run:'',image:'',url:'https://www.sportscardspro.com/game/baseball-cards-2026-topps-five-star-retired-autograph/rod-carew-fsa-rc'}).matches.length,1,'historical team suffix must not prevent the exact player match');
assert.equal(selectedParallelCard(set,set.cards[0],'amber').parallelRule.printRun,25);assert.equal(cardParallelProgram(set,set.cards[0]).maxPrintRun,50);assert.equal(cardParallelProgram(set,groups[0].cards[0]).variants.length,0,'base rainbow is not silently assigned to autograph relics');
for(const [id,spec]of Object.entries(parallelPrograms[set.id].sections)){const group=groups.find(g=>g.id===id);assert(group,'serial specification must name an actual imported section: '+id);assert.equal(cardParallelProgram(set,group.cards[0]).maxPrintRun,spec.maxPrintRun);assert.equal(cardParallelProgram(set,group.cards[0]).printRun,spec.printRun);assert.equal(selectedParallelCard(set,group.cards[0],'amber'),null,'unverified subject finish is not invented');}
assert.equal(cardNumberingLabel(set,logo.cards[0]),'1/1');assert.equal(cardNumberingLabel(set,groups.find(g=>g.id==='five-star-active-autographs').cards[0]),'/199 or less');
for(const g of groups)for(const c of g.cards){const ids=referenceConsoles(set,c);for(const [section,suffix]of [['Five Star Active Autographs','active-autograph'],['Five Star Retired Autographs','retired-autograph'],['Five Star Autographed Jumbo Prime Cards','jumbo-prime-autograph']])assert.equal(ids.includes('baseball-cards-2026-topps-five-star-'+suffix),g.name===section,'provider autograph families stay section-scoped');}
const activeSource={consoleId:'baseball-cards-2026-topps-five-star-active-autograph',productId:'14946725',title:'Alex Freeland #FSA-AF',player:'Alex Freeland',cardNumber:'FSA-AF',parallel:'',run:'',image:'',url:'https://www.sportscardspro.com/game/baseball-cards-2026-topps-five-star-active-autograph/alex-freeland-fsa-af'};
assert.equal(referenceMetadataCheck(activeSource).matches.length,1);assert(referenceMetadataCheck(activeSource).matches[0].path.includes('five-star-active-autographs'));
const deps={escape:s=>String(s),listItems:async()=>[],available:()=>true},html=d=>new Response(d.bodyHtml),missing=()=>new Response('missing',{status:404});
for(const g of groups)for(const c of g.cards){const u=new URL('https://www.themanapocket.com/baseball/checklists/'+set.id+'/cards/'+c.id+'?reference=3');const r=await handleBaseballSections(new Request(u),{},u,deps,[set],html,missing);assert.equal(r.status,200);assert.equal((await r.json()).reference,null,'uncollected references remain honestly unavailable');}
assert.equal(new Set(baseballSectionSitemapPaths([set])).size,baseballSectionSitemapPaths([set]).length);
console.log('2026 Five Star: 750 exact identities, 799 subjects, 650 nonbase routes, physical patch isolation, licensing and base serial rules passed');
