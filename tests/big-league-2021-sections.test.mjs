import {referenceIdentityMatches} from '../scripts/reference-match.mjs';
import assert from 'node:assert/strict';
import {bigLeague2021Sections} from '../scripts/topps/big-league-2021-sections.mjs';
import {baseballSets} from '../scripts/topps/baseball-seed.mjs';
import {sectionsForSet,baseballSectionSitemapPaths} from '../scripts/baseball-section-pages.mjs';
const set=baseballSets.find(s=>s.id==='2021-topps-big-league-baseball'),source=bigLeague2021Sections[0],groups=sectionsForSet(set),cards=groups.flatMap(g=>g.cards);
assert.equal(source.sourceSha256,set.sourceSha256);assert.deepEqual(groups,source.sections);assert.deepEqual(groups.map(g=>g.cards.length),[23,12,9,23,32,65,95,30,10,15,15,23]);assert.equal(cards.length,352);assert.equal(new Set([...set.cards,...cards].map(c=>c.id)).size,652);
for(const g of groups){assert.equal(new Set(g.cards.map(c=>c.cardNumber)).size,g.cards.length);for(const c of g.cards){assert.equal(c.section,g.name);assert.equal(c.player+' '+c.team,c.printedSubjectAndTeam.replace(/[®™]/g,'').replace(/ Rookie$/,''));assert(baseballSectionSitemapPaths([set]).includes('/baseball/checklists/'+set.id+'/cards/'+c.id));}}
const autos=groups.find(g=>g.id==='veterans-and-rookies-autograph-parallel');assert.equal(autos.cards.length,95);assert.equal(autos.cards[0].cardNumber,'1');assert.notEqual(autos.cards[0].id,set.cards.find(c=>c.cardNumber==='1').id);
assert.equal(groups.filter(g=>g.kind==='Autographs').flatMap(g=>g.cards).length,259);
console.log('2021 Big League: 352 numbered non-base entries, 259 autograph printings, 95 numeric base autos and source identities passed');

assert.equal(referenceIdentityMatches({title:'Mike Trout #1',consoleId:'baseball-cards-2021-topps-big-league',run:''},autos.cards[0]),false,'unsigned base photo cannot replace numeric autograph printing');
