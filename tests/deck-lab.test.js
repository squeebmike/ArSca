const assert=require('node:assert/strict');
const lab=require('../scripts/mtg/deck-lab.js');
const fs=require('node:fs');
const parsed=lab.parseDecklist(`Commander
1 Tatyova, Benthic Druid

Deck
Ramp
1 Sol Ring (CMM) 400
1x Arcane Signet
Deck
1 Forest
SB: 2 Negate
Maybeboard
Cultivate x1`);
assert.equal(parsed.cards.length,6);
assert.equal(parsed.cards[0].section,'Commander');
assert.equal(parsed.cards[1].category,'Ramp');
assert.equal(parsed.cards[1].set,'cmm');
assert.equal(parsed.cards[1].collector,'400');
assert.equal(parsed.cards[4].section,'Sideboard');
assert.equal(parsed.cards[4].quantity,2);
assert.equal(parsed.cards[5].section,'Maybeboard');
const cards=parsed.cards.map((entry,i)=>({...entry,status:'matched',card:{name:entry.name,type_line:i===3?'Basic Land — Forest':'Artifact',cmc:i===3?0:2,oracle_text:i===1?'Add one mana of any color.':''}}));
const metrics=lab.analyze(cards);
assert.equal(metrics.total,7);assert.equal(metrics.counts.Commander,1);assert.equal(metrics.counts.Sideboard,2);assert.equal(metrics.lands,1);assert.equal(metrics.ramp,1);
const matched=lab.matchInventory(cards,[{id:'inv-1',name:'Sol Ring',category:'MTG',qty:2,status:'in_stock',salePrice:2.5,location:'Binder A'}]);
assert.equal(matched[1].inventoryQty,2);assert.equal(matched[1].availableValue,2.5);assert.match(lab.cleanedDecklist(matched),/Commander\n1 Tatyova/);
assert.deepEqual(lab.cleanName('Sol Ring [CMM]'),{name:'Sol Ring',set:'cmm',collector:''});
assert.deepEqual(lab.cleanName('Sol Ring #400'),{name:'Sol Ring',set:'',collector:'400'});
const page=fs.readFileSync('mtg-deck-lab.html','utf8'),dashboard=fs.readFileSync('dashboard.html','utf8');
assert.match(page,/DEMO · LOCAL ONLY/);assert.match(page,/TODO\(deck-persistence\)/);assert.doesNotMatch(page,/\.from\('(?:decks|deck_cards)'\).*\.(?:insert|upsert)/);assert.match(dashboard,/href="mtg-deck-lab\.html"/);
console.log('Deck Lab parser and analysis tests passed');
