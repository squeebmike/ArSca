const assert=require('node:assert/strict');
const fs=require('node:fs');
const imports=require('../scripts/mtg/deck-import-providers.js');
const lab=require('../scripts/mtg/deck-lab.js');

function memoryStorage(){const data=new Map();return{getItem:key=>data.has(key)?data.get(key):null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key)}}

async function main(){
  const archidekt=imports.detectProvider('https://archidekt.com/decks/12345/toph');
  assert.equal(archidekt.provider.id,'archidekt');assert.equal(archidekt.confidence,'high');assert.match(archidekt.normalizedUrl,/archidekt\.com\/decks\/12345\/toph/);
  const moxfield=imports.detectProvider('https://www.moxfield.com/decks/fake-deck-id');
  assert.equal(moxfield.provider.id,'moxfield');assert.match(moxfield.provider.getManualInstructions(),/Export or Copy/);
  assert.equal(imports.detectProvider('https:// tappedout.net/mtg-decks/nope').valid,false);
  assert.equal(imports.detectProvider('https://example.com/deck').provider,null);
  assert.equal(imports.normalizeUrl('javascript:alert(1)'),'');
  await assert.rejects(()=>archidekt.provider.fetchDeck(archidekt.normalizedUrl),error=>error.code==='manual_required'&&/paste it here/i.test(error.message));

  const archExport=lab.parseDecklist(`Commander\n1 Toph, the First Metalbender\n\nDeck\nRamp\n1 Sol Ring (CMM) 400\n1 Arcane Signet\n\nRemoval\n1 Swords to Plowshares`);
  assert.equal(archExport.cards[1].category,'Ramp');assert.equal(archExport.cards[3].category,'Removal');
  const moxExport=lab.parseDecklist(`Commander\n1 Yuriko, the Tiger's Shadow\n\nMainboard\n1 Brainstorm\n\nSideboard\n1 Negate\n\nMaybeboard\n1 Counterspell`);
  assert.equal(moxExport.cards[1].section,'Mainboard');assert.equal(moxExport.cards[2].section,'Sideboard');assert.equal(moxExport.cards[3].section,'Maybeboard');
  const arena=imports.detectProvider(`Deck\n4 Llanowar Elves\n20 Forest\n\nSideboard\n2 Duress`);
  assert.equal(arena.provider.id,'arena');assert.equal(lab.parseDecklist(arena.provider.parseExport(`Deck\n4 Llanowar Elves\n20 Forest\n\nSideboard\n2 Duress`)).cards[2].section,'Sideboard');
  assert.equal(imports.detectProvider(`Commander\n1 Tatyova, Benthic Druid\nDeck\nRamp\n1 Sol Ring\nSideboard\n1 Negate`).provider.id,'plain');
  const csv=imports.parseCsvExport('quantity,name,set,collector_number,category\n1,"Sol Ring",CMM,400,Ramp\n1,Counterspell,2X2,50,Interaction');
  assert.match(csv,/Ramp\n1 Sol Ring \(CMM\) 400/);assert.match(csv,/Interaction\n1 Counterspell \(2X2\) 50/);

  const storage=memoryStorage(),recent=imports.createLocalRepository(storage,'recent',3),sources=imports.createLocalRepository(storage,'sources',3);
  const savedRecent=recent.upsert({id:'r1',deckName:'Yuriko',cardCount:100});assert.equal(savedRecent[0].deckName,'Yuriko');assert.equal(recent.load().length,1);recent.remove('r1');assert.equal(recent.load().length,0);
  sources.upsert({id:'s1',deckName:'Toph source',sourceUrl:'https://archidekt.com/decks/123'});assert.equal(sources.load()[0].sourceUrl,'https://archidekt.com/decks/123');

  const page=fs.readFileSync('mtg-deck-lab.html','utf8'),controller=fs.readFileSync('scripts/mtg/deck-lab-import-hub.js','utf8');
  assert.match(page,/DECK IMPORT HUB/);assert.match(page,/IMPORT FROM URL/);assert.match(page,/RECENT IMPORTS/);assert.match(page,/CONFIRM IMPORT/);assert.match(page,/deck-import-providers\.js\?v=2026\.07\.06\.02-deck-import-hub/);assert.match(controller,/manual_required|DIRECT IMPORT UNAVAILABLE/);assert.match(controller,/recentRepo\.upsert/);assert.match(controller,/sourceRepo\.upsert/);
  console.log('Deck Import Hub provider, fallback, and storage tests passed');
}
main().catch(error=>{console.error(error);process.exitCode=1});
