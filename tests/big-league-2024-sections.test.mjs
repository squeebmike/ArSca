import assert from 'node:assert/strict';
import {bigLeague2024Sections} from '../scripts/topps/big-league-2024-sections.mjs';
import {baseballSets} from '../scripts/topps/baseball-seed.mjs';
import {sectionsForSet,baseballSectionSitemapPaths} from '../scripts/baseball-section-pages.mjs';
import {referenceIdentityMatches} from '../scripts/reference-match.mjs';
const set=baseballSets.find(s=>s.id==='2024-topps-big-league-baseball'),source=bigLeague2024Sections[0],groups=sectionsForSet(set),cards=groups.flatMap(g=>g.cards);
assert.equal(source.sourceSha256,set.sourceSha256);assert.deepEqual(groups,source.sections);assert.deepEqual(groups.map(g=>g.cards.length),[5,1,43,10,30,26,48,15,10,10,91,25,9,14,10,46,54]);assert.equal(cards.length,447);assert.equal(new Set([...set.cards,...cards].map(c=>c.id)).size,756);
for(const g of groups){assert.equal(new Set(g.cards.map(c=>c.cardNumber)).size,g.cards.length);for(const c of g.cards){assert.equal(c.section,g.name);assert.equal(c.player,c.printedSubject);assert.equal(c.team,'');assert(!c.player.includes('\uFFFD'));assert(baseballSectionSitemapPaths([set]).includes('/baseball/checklists/'+set.id+'/cards/'+c.id));}}
const accented=cards.find(c=>c.cardNumber==='SMF-ÓC');assert.equal(accented.player,'Oscar Colás');assert(accented.id.endsWith('-smf-oc'));
assert.equal(groups.filter(g=>g.kind==='Autographs').flatMap(g=>g.cards).length,249);
const auto=groups.find(g=>g.id==='common-cards-i-electric-orange-autograph-variation').cards.find(a=>set.cards.some(b=>b.player===a.player));const unsigned=set.cards.find(c=>c.player===auto.player);assert(unsigned);assert.equal(referenceIdentityMatches({title:unsigned.player+' #'+unsigned.cardNumber,run:''},auto),false);
console.log('2024 Big League: 447 official insert/autograph entries, 249 autos, blank printed teams and accented number preservation passed');
