import assert from 'node:assert/strict';
import {bigLeague2023Sections} from '../scripts/topps/big-league-2023-sections.mjs';
import {baseballSets} from '../scripts/topps/baseball-seed.mjs';
import {sectionsForSet,baseballSectionSitemapPaths} from '../scripts/baseball-section-pages.mjs';
import {referenceIdentityMatches} from '../scripts/reference-match.mjs';
const set=baseballSets.find(s=>s.id==='2023-topps-big-league-baseball'),source=bigLeague2023Sections[0],groups=sectionsForSet(set),cards=groups.flatMap(g=>g.cards);
assert.equal(source.sourceSha256,set.sourceSha256);assert.deepEqual(groups,source.sections);assert.deepEqual(groups.map(g=>g.cards.length),[20,15,27,30,15,30,20,15,5,15,10,20,12,10,44,52,113]);assert.equal(cards.length,453);assert.equal(new Set([...set.cards,...cards].map(c=>c.id)).size,763);
for(const g of groups){assert.equal(new Set(g.cards.map(c=>c.cardNumber)).size,g.cards.length);for(const c of g.cards){assert.equal(c.section,g.name);assert(!c.player.includes('\uFFFD'));assert(baseballSectionSitemapPaths([set]).includes('/baseball/checklists/'+set.id+'/cards/'+c.id));}}
const influencers=groups.find(g=>g.id==='hobby-influencer-short-prints');assert(influencers.cards.every(c=>c.team===''&&c.subjects[0].note.startsWith('Printed affiliation:')));
assert.equal(cards.find(c=>c.section==='Roll Call Wild Style Edition Autograph Parallel'&&c.cardNumber==='RCA-J').team,'Kanasas City Royals');
const autos=groups.at(-1);assert.equal(autos.cards[0].cardNumber,'1');assert.equal(referenceIdentityMatches({title:'Aaron Judge #1',run:''},autos.cards[0]),false);
assert.equal(groups.filter(g=>g.kind==='Autographs').flatMap(g=>g.cards).length,261);assert.equal(groups.find(g=>g.id==='8-bit-ballers').cards.length,20);assert.equal(groups.find(g=>g.id==='8-bit-ballers-autograph-parallel').cards.length,12);
console.log('2023 Big League: 453 printings, mascot foil separation, 261 autos, numeric unsigned rejection and printed affiliations passed');
