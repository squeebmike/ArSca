const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const batch = require('../scripts/mtg/research-batch.js');

const fixtureDir = path.join(__dirname, 'fixtures', 'mtg');
const fixtures = [
  ['research-batch-plain.txt', 'Plain text'],
  ['research-batch-mtggoldfish.txt', 'MTGGoldfish'],
  ['research-batch-moxfield.txt', 'Moxfield'],
  ['research-batch-archidekt.txt', 'Archidekt'],
  ['research-batch-manabox.txt', 'Manabox'],
  ['research-batch-csv.csv', 'TCGplayer CSV'],
  ['research-batch-messy.txt', 'Other / messy list'],
];
const required = ['Sol Ring','Arcane Signet','Command Tower','Lightning Bolt','Counterspell','Swords to Plowshares','Beast Within','Fire // Ice','Fable of the Mirror-Breaker'];

for (const [file, source] of fixtures) {
  const raw = fs.readFileSync(path.join(fixtureDir, file), 'utf8');
  const parsed = batch.parseList(raw, source);
  const names = parsed.cards.map(card => card.cleanedName);
  for (const name of required) {
    assert.ok(names.includes(name), `${file} should parse ${name}`);
  }
  assert.ok(parsed.cards.every(card => Number(card.quantity) >= 1), `${file} should parse quantities`);
  assert.ok(parsed.cards.every(card => !/\$|USD|<[^>]+>/i.test(card.cleanedName)), `${file} should strip junk`);
}

const exact = batch.parseLine('1x Sol Ring (CMM) 400 NM Foil $1.25', 1);
assert.equal(exact.quantity, 1);
assert.equal(exact.cleanedName, 'Sol Ring');
assert.equal(exact.setCode, 'cmm');
assert.equal(exact.collectorNumber, '400');
assert.equal(exact.condition, 'NM');
assert.equal(exact.finish, 'foil');
assert.equal(exact.matchMode, 'exact-printing');

const allPrintings = batch.parseLine('Lightning Bolt', 2);
assert.equal(allPrintings.matchMode, 'all-printings');

const goldfishFoil = batch.parseLine('1 Farseek <019ea7ca-f9d1-7d3e-93c2-6c618c18d0bf> [MSC] (F)', 3);
assert.equal(goldfishFoil.cleanedName, 'Farseek');
assert.equal(goldfishFoil.setCode, 'msc');
assert.equal(goldfishFoil.finish, 'foil');

const goldfishCollector = batch.parseLine('8 Forest <254> [THB]', 4);
assert.equal(goldfishCollector.cleanedName, 'Forest');
assert.equal(goldfishCollector.quantity, 8);
assert.equal(goldfishCollector.setCode, 'thb');
assert.equal(goldfishCollector.collectorNumber, '254');

const csv = batch.parseList(fs.readFileSync(path.join(fixtureDir, 'research-batch-csv.csv'), 'utf8'), 'TCGplayer CSV');
assert.equal(csv.cards.find(card => card.cleanedName === 'Lightning Bolt').quantity, 4);
assert.equal(csv.cards.find(card => card.cleanedName === 'Lightning Bolt').collectorNumber, '146');
assert.equal(csv.cards.find(card => card.cleanedName === 'Sol Ring').finish, 'foil');

const memory = {};
const storage = { getItem:key => memory[key] || null, setItem:(key,value) => memory[key] = value };
const repo = batch.repository(storage, 'test_batches');
let saved = repo.save(batch.createBatch({ name:'Local batch', sourceType:'Plain text', rawInput:'Sol Ring', cards:[allPrintings], ignored:[] }));
assert.equal(repo.load().length, 1);
saved.cards[0].included = false;
saved.cards[0].condition = 'LP';
repo.save(saved);
assert.equal(repo.load()[0].cards[0].included, false);
assert.equal(repo.load()[0].cards[0].condition, 'LP');
const copy = repo.duplicate(saved.id);
assert.ok(copy.id !== saved.id);
repo.remove(saved.id);
assert.equal(repo.load().length, 1);

console.log('MTG research batch parser and local storage tests passed');
