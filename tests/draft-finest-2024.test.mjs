import assert from 'node:assert/strict';
import {draftFinest2024Sets,draftFinest2024Sections} from '../scripts/topps/draft-finest-2024.mjs';
import {baseballSets} from '../scripts/topps/baseball-seed.mjs';
import {sectionsForSet,baseballSectionSitemapPaths} from '../scripts/baseball-section-pages.mjs';
import {referenceIdentityMatches} from '../scripts/reference-match.mjs';
import {checklistPublicationProblems} from '../scripts/topps/public-checklist-policy.mjs';
import {sportsSectionCollections} from '../scripts/sports-checklist-ui.mjs';
for(const set of draftFinest2024Sets){
 assert.ok(baseballSets.includes(set));assert.deepEqual(checklistPublicationProblems(set,set),[]);
 const source=draftFinest2024Sections.find(s=>s.setId===set.id);
 assert.equal(source.sourceSha256,set.sourceSha256);assert.match(source.sourceSha256,/^[a-f0-9]{64}$/);
 assert.deepEqual(sectionsForSet(set),source.sections);
 const cards=[...set.cards,...source.sections.flatMap(g=>g.cards)];
 assert.equal(new Set(cards.map(c=>c.id)).size,cards.length);
 assert.ok(cards.every(c=>c.subjects.length&&c.subjects.every(s=>s.name&&s.team)&&!/[®™\uFFFD]/.test(c.player)));
 for(const group of source.sections){assert.equal(new Set(group.cards.map(c=>c.cardNumber)).size,group.cards.length);assert.ok(group.cards.every(c=>c.section===group.name));}
 const paths=baseballSectionSitemapPaths([set]);assert.equal(paths.length,sportsSectionCollections(source.sections).length+source.sections.length+source.sections.reduce((n,g)=>n+g.cards.length,0));
}
const draft=draftFinest2024Sets.find(s=>s.id==='2024-bowman-draft-baseball');
const chrome=sectionsForSet(draft).find(g=>g.id==='chrome-base-cards');
assert.equal(draft.cards.length,200);assert.equal(chrome.cards.length,200);
assert.equal(draft.cards[0].cardNumber,'BD-1');assert.equal(chrome.cards[0].cardNumber,'BDC-1');
assert.equal(referenceIdentityMatches({title:'Travis Bazzana #BDC-1',consoleId:'baseball-cards-2024-bowman-draft',run:null},draft.cards[0]),false,'Chrome cannot replace paper');
assert.equal(draftFinest2024Sections[0].omittedUnnumberedSubjects.length,5);
assert.ok(!sectionsForSet(draft).some(g=>g.id==='under-armour-game-autographed-cards'));
const finest=draftFinest2024Sets.find(s=>s.id==='2024-topps-finest-baseball');
assert.equal(finest.cards.length,300);
for(const [number,rarity]of [['100','Common Cards'],['101','Uncommon Cards'],['200','Uncommon Cards'],['201','Rare Cards']])assert.equal(finest.cards.find(c=>c.cardNumber===number).printedRarity,rarity);
assert.equal(draftFinest2024Sections[1].omittedUnnumberedSubjects.length,9);
assert.equal(sectionsForSet(finest).find(g=>g.id==='finest-autographs').cards.length,138);
assert.equal(draftFinest2024Sections.flatMap(s=>s.sections).reduce((n,g)=>n+g.cards.length,0),941);
console.log('2024 Draft and Finest: 500 base, 941 numbered non-base, paper/Chrome separation, printed tiers and unnumbered exclusions passed');
