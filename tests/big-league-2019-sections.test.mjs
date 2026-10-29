import {referenceConsoles} from '../scripts/reference-validation.mjs';
import assert from 'node:assert/strict';
import {bigLeague2019Sections} from '../scripts/topps/big-league-2019-sections.mjs';
import {baseballSets} from '../scripts/topps/baseball-seed.mjs';
import {sectionsForSet,baseballSectionSitemapPaths} from '../scripts/baseball-section-pages.mjs';
const set=baseballSets.find(s=>s.id==='2019-topps-big-league-baseball'),source=bigLeague2019Sections[0],groups=sectionsForSet(set),cards=groups.flatMap(g=>g.cards);
assert.equal(source.sourceSha256,set.sourceSha256);assert.deepEqual(groups,source.sections);assert.deepEqual(groups.map(g=>g.cards.length),[30,10,15,30,10,30,35,17]);assert.equal(cards.length,177);assert.equal(groups.filter(g=>g.kind==='Autographs').flatMap(g=>g.cards).length,52);
assert.equal(new Set([...set.cards,...cards].map(c=>c.id)).size,577);
for(const g of groups){assert.equal(new Set(g.cards.map(c=>c.cardNumber)).size,g.cards.length);for(const c of g.cards){assert.equal(c.section,g.name);const clean=c.printedSubjectAndTeam.replace(/[®™]/g,'').replace(/ Rookie$/,'');assert.equal(c.player+' '+c.team,clean);assert(baseballSectionSitemapPaths([set]).includes('/baseball/checklists/'+set.id+'/cards/'+c.id));}}
assert.equal(source.sourceNotes.length,1);assert(source.sourceNotes[0].includes('Vladimir Guerrero Jr.'));assert(!cards.some(c=>c.cardNumber.includes('Mystery')));
const originals=groups.find(g=>g.id==='star-caricature-originals'),copies=groups.find(g=>g.id==='star-caricature-reproductions');assert(originals.cards.every(c=>!copies.cards.some(x=>x.id===c.id)));
console.log('2019 Big League: 177 official inserts/autos, originals distinct, printed teams and unnumbered redemption exclusion passed');

const blast=groups.find(g=>g.id==='blast-offs');assert(referenceConsoles(set,blast.cards[0]).includes('baseball-cards-2019-topps-big-league-blast-off'));assert(!referenceConsoles(set,originals.cards[0]).includes('baseball-cards-2019-topps-big-league-star-caricature-reproductions'));
