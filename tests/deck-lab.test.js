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
const fullFill=lab.matchInventory([{quantity:1,name:'Arcane Signet',status:'matched',card:{name:'Arcane Signet'}}],[{id:'a1',name:'Arcane Signet',category:'MTG',quantity_available:1,status:'in_stock',salePrice:1}])[0];
assert.equal(fullFill.fulfillmentStatus,'Exact Match');assert.equal(fullFill.walkoffQty,1);assert.equal(fullFill.missingQty,0);
const partialFill=lab.matchInventory([{quantity:4,name:'Sol Ring',status:'matched',card:{name:'Sol Ring'}}],[{id:'s1',name:'Sol Ring',category:'MTG',quantity_available:2,status:'in_stock',salePrice:2}])[0];
assert.equal(partialFill.fulfillmentStatus,'Partial Fill');assert.equal(partialFill.walkoffQty,2);assert.equal(partialFill.missingQty,2);
const missingFill=lab.matchInventory([{quantity:1,name:'Birds of Paradise',status:'matched',card:{name:'Birds of Paradise'}}],[])[0];
assert.equal(missingFill.fulfillmentStatus,'Missing');assert.equal(missingFill.missingQty,1);
const alternateFill=lab.matchInventory([{quantity:1,name:'Sol Ring',set:'cmm',collector:'400',status:'matched',card:{name:'Sol Ring'}}],[{id:'s2',name:'Sol Ring',category:'MTG',set:'clu',collector_number:'1',quantity_available:1,status:'in_stock',salePrice:1.5}])[0];
assert.equal(alternateFill.fulfillmentStatus,'Alternate Printing Available');
const notSellable=lab.matchInventory([{quantity:1,name:'Counterspell',status:'matched',card:{name:'Counterspell'}}],[{id:'c1',name:'Counterspell',category:'MTG',quantity_available:1,status:'in_stock',online_sellable:false,vending_sellable:false}])[0];
assert.equal(notSellable.fulfillmentStatus,'Not Sellable');assert.equal(notSellable.walkoffQty,0);
const reserved=lab.matchInventory([{quantity:1,name:'Negate',status:'matched',card:{name:'Negate'}}],[{id:'n1',name:'Negate',category:'MTG',quantity_available:2,quantity_reserved:2,status:'in_stock'}])[0];
assert.equal(reserved.fulfillmentStatus,'Not Sellable');assert.equal(reserved.missingQty,1);
assert.deepEqual(lab.cleanName('Sol Ring [CMM]'),{name:'Sol Ring',set:'cmm',collector:'',cleaned:'Sol Ring'});
assert.deepEqual(lab.cleanName('Sol Ring #400'),{name:'Sol Ring',set:'',collector:'400',cleaned:'Sol Ring'});
const page=fs.readFileSync('mtg-deck-lab.html','utf8'),dashboard=fs.readFileSync('dashboard.html','utf8');
assert.match(page,/WALK-OFF FIRST FILL/);assert.match(page,/TCGPLAYER MASS ENTRY/);assert.match(page,/local-saved-decks/);
assert.match(page,/DEMO · LOCAL ONLY/);assert.match(page,/TODO\(deck-persistence\)/);assert.doesNotMatch(page,/\.from\('(?:decks|deck_cards)'\).*\.(?:insert|upsert)/);assert.match(dashboard,/class="tab primary deck-lab-link" href="mtg-deck-lab\.html">DECK LAB BETA/);assert.match(dashboard,/2026\.07\.08\.04-mtg-printing-picker-fix/);
console.log('Deck Lab parser and analysis tests passed');
