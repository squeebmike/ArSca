import {referenceConsoles} from '../scripts/reference-validation.mjs';
import assert from 'node:assert/strict';
import {baseballSets} from '../scripts/topps/baseball-seed.mjs';
import {bigLeague2020Sections} from '../scripts/topps/big-league-2020-sections.mjs';
import {sectionsForSet,baseballSectionSitemapPaths} from '../scripts/baseball-section-pages.mjs';
const set=baseballSets.find(s=>s.id==='2020-topps-big-league-baseball'), source=bigLeague2020Sections[0], groups=sectionsForSet(set);
assert.equal(source.sourceSha256,set.sourceSha256);assert.equal(source.sourceUrl,set.sourceUrl);
assert.deepEqual(groups,source.sections);assert.deepEqual(groups.map(g=>g.cards.length),[30,15,30,15,35,21]);
const cards=groups.flatMap(g=>g.cards);assert.equal(cards.length,146);assert.equal(groups.filter(g=>g.kind==='Autographs').flatMap(g=>g.cards).length,56);
assert.equal(new Set([...set.cards,...cards].map(c=>c.id)).size,446);
for(const g of groups){assert.equal(new Set(g.cards.map(c=>c.cardNumber)).size,g.cards.length);for(const c of g.cards){assert.equal(c.section,g.name);assert.equal(c.subjects[0].name+' '+c.subjects[0].team,c.printedSubjectAndTeam);assert(!c.player.includes('\uFFFD'));assert(baseballSectionSitemapPaths([set]).includes('/baseball/checklists/'+set.id+'/cards/'+c.id));}}
assert.equal(groups[0].cards[0].player,'Ronald Acuña Jr.');
assert.equal(groups[1].cards.at(-1).cardNumber,'FO-15');assert.equal(groups[1].cards.at(-1).player,'Willson Contreras');
console.log('2020 Big League: 146 official insert/autograph identities, 56 autos, source provenance and sitemap discovery passed');

for(const [i,suffix] of [[0,'roll-call'],[1,'flipping-out'],[2,'star-caricature-reproductions'],[3,'defensive-wizards']]){const id='baseball-cards-2020-topps-big-league-'+suffix;assert(referenceConsoles(set,groups[i].cards[0]).includes(id));assert(!referenceConsoles(set,set.cards[0]).includes(id));assert(!referenceConsoles(set,groups[4].cards[0]).includes(id));}
