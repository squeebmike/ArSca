import assert from 'node:assert/strict';
import {archiveNonbaseSections} from '../scripts/topps/archive-nonbase-sections.mjs';
import {sectionsForSet,baseballSectionSitemapPaths} from '../scripts/baseball-section-pages.mjs';
import {baseballSets} from '../scripts/topps/baseball-seed.mjs';
import {footballSets} from '../scripts/topps/football-seed.mjs';
import {sportsReferenceRows} from '../scripts/sports-player-team-search.mjs';
const sets=[...baseballSets,...footballSets];let cards=0;
for(const source of archiveNonbaseSections){assert.match(source.sourceSha256,/^[a-f0-9]{64}$/);assert.match(source.sourceUrl,/^https:\/\/(?:cdn.shopify.com|(?:www\.)?topps.com)\//);assert.ok(sets.some(s=>s.id===source.setId));}
for(const set of sets){const groups=sectionsForSet(set);assert.ok(groups.length,set.id);assert.equal(new Set(groups.map(g=>g.id)).size,groups.length);const ids=new Set(set.cards.map(c=>c.id));for(const g of groups){assert.ok(g.cards.length);assert.equal(new Set(g.cards.map(c=>c.cardNumber)).size,g.cards.length);for(const c of g.cards){assert.ok(!ids.has(c.id),c.id);ids.add(c.id);cards++;assert.ok(c.cardNumber&&c.player&&c.subjects.length);assert.doesNotMatch(c.player+c.team,/�|Ã|Â/);assert.ok(c.subjects.every(s=>s.name));assert.equal(c.section,g.name);}}}
assert.equal(cards,51739);assert.equal(sets.length,55);
const paths=baseballSectionSitemapPaths(sets);assert.equal(new Set(paths).size,paths.length);
const refs=sportsReferenceRows();assert.equal(refs.length,sets.reduce((n,s)=>n+s.cards.length,0)+cards);
const black=sets.find(s=>s.id==='2025-topps-chrome-black-football');assert.ok(sectionsForSet(black).some(g=>g.cards.some(c=>c.player==='A.J. Brown'&&c.cardNumber==='AU-ABR')));
const draft=sets.find(s=>s.id==='2025-bowman-draft-baseball');assert.ok(sectionsForSet(draft).some(g=>g.cards.some(c=>c.team===''&&c.player==='Anthony Eyanson')),'unprinted teams stay blank');
console.log('55 releases, 51,739 native non-base references, unique routes, source hashes, and player/team discovery checked');

for(const source of archiveNonbaseSections)for(const g of source.sections)if(g.cards.some(c=>/^\d+$/.test(c.cardNumber)))assert.ok(g.matchTerms?.length,'numeric non-base identity needs its printed subset');
