import assert from 'node:assert/strict';
import {archiveNonbaseSections} from '../scripts/topps/archive-nonbase-sections.mjs';
import {sectionsForSet,baseballSectionSitemapPaths} from '../scripts/baseball-section-pages.mjs';
import {baseballSets} from '../scripts/topps/baseball-seed.mjs';
import {footballSets} from '../scripts/topps/football-seed.mjs';
import {sportsReferenceRows} from '../scripts/sports-player-team-search.mjs';
const sets=[...baseballSets,...footballSets];let cards=0;
for(const source of archiveNonbaseSections){assert.match(source.sourceSha256,/^[a-f0-9]{64}$/);assert.match(source.sourceUrl,/^https:\/\/(?:cdn.shopify.com|(?:www\.)?topps.com)\//);assert.ok(sets.some(s=>s.id===source.setId));}
for(const set of sets){const groups=sectionsForSet(set);assert.ok(groups.length,set.id);assert.equal(new Set(groups.map(g=>g.id)).size,groups.length);const ids=new Set(set.cards.map(c=>c.id));for(const g of groups){assert.ok(g.cards.length);assert.equal(new Set(g.cards.map(c=>c.cardNumber)).size,g.cards.length);for(const c of g.cards){assert.ok(!ids.has(c.id),c.id);ids.add(c.id);cards++;assert.ok(c.cardNumber&&c.player&&c.subjects.length);assert.doesNotMatch(c.player+c.team,/�|Ã|Â/);assert.ok(c.subjects.every(s=>s.name));assert.equal(c.section,g.name);}}}
assert.equal(cards,64951);assert.equal(sets.length,62);
const paths=baseballSectionSitemapPaths(sets);assert.equal(new Set(paths).size,paths.length);
const refs=sportsReferenceRows();assert.equal(refs.length,sets.reduce((n,s)=>n+s.cards.length,0)+cards);
const black=sets.find(s=>s.id==='2025-topps-chrome-black-football');assert.ok(sectionsForSet(black).some(g=>g.cards.some(c=>c.player==='A.J. Brown'&&c.cardNumber==='AU-ABR')));
const draft=sets.find(s=>s.id==='2025-bowman-draft-baseball');assert.ok(sectionsForSet(draft).some(g=>g.cards.some(c=>c.team===''&&c.player==='Anthony Eyanson')),'unprinted teams stay blank');
console.log('62 releases, 64,951 native non-base references, unique routes, source hashes, and player/team discovery checked');

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
