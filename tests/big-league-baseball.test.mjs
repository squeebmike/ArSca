import assert from 'node:assert/strict';
import {bigLeagueBaseballSets} from '../scripts/topps/big-league-baseball.mjs';
import {baseballSets} from '../scripts/topps/baseball-seed.mjs';
import {checklistPublicationProblems} from '../scripts/topps/public-checklist-policy.mjs';
import {referenceConsoles} from '../scripts/reference-validation.mjs';
for(const set of bigLeagueBaseballSets){
 assert.ok(baseballSets.includes(set));
 assert.deepEqual(checklistPublicationProblems(set,set),[]);
 assert.match(set.sourceSha256,/^[a-f0-9]{64}$/);
 assert.equal(set.cards.length,set.cardCount);
 assert.equal(new Set(set.cards.map(c=>c.cardNumber)).size,set.cardCount);
 assert.ok(referenceConsoles(set).includes('baseball-cards-'+set.year+'-topps-big-league'));
 assert.ok(set.cards.every(c=>c.subjects.length&&c.subjects.every(s=>s.name&&s.team)&&!/[®™]/.test(c.player)));
}
const get=(year,n)=>bigLeagueBaseballSets.find(s=>s.year===year).cards.find(c=>c.cardNumber===String(n));
assert.equal(get(2021,246).subjects.length,3,'three printed subjects are one numbered card');
assert.equal(get(2019,14).player,'Jason Kipnis');
assert.equal(get(2019,14).team,'Cleveland Indians','retain historical printed team');
assert.equal(get(2023,92).player,'Frankie Montas','normalize PDF spacing without retaining team in player');
assert.equal(get(2023,302).team,'Brooklyn Dodgers');
assert.equal(get(2023,201).printedRarity,'Uncommon Rainbow Foil');
assert.equal(get(2023,310).printedRarity,'Legendary Gold Foil');
console.log('Big League: official numbered checklists, historical teams, multi-subject identities and printed foil tiers passed');
