const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const lab = require('../scripts/mtg/deck-lab.js');
const imports = require('../scripts/mtg/deck-import-providers.js');

const fixtureDir = path.join(__dirname, 'fixtures', 'mtg');
const requiredCards = [
  'Sol Ring',
  'Arcane Signet',
  'Command Tower',
  'Swords to Plowshares',
  'Counterspell',
  'Beast Within',
  'Fire // Ice',
  'Fable of the Mirror-Breaker',
  "Yuriko, the Tiger's Shadow",
  'Toph, the First Metalbender',
];

function parsedNames(file) {
  const raw = fs.readFileSync(path.join(fixtureDir, file), 'utf8');
  const detection = imports.detectProvider(raw);
  const text = detection.provider?.parseExport ? detection.provider.parseExport(raw) : raw;
  const parsed = lab.parseDecklist(text);
  const names = parsed.cards.map(card => card.cleanedName || card.name);
  return { parsed, names };
}

for (const file of [
  'mtggoldfish-export.txt',
  'moxfield-export.txt',
  'archidekt-export.txt',
  'arena-export.txt',
  'plain-commander-list.txt',
]) {
  const { parsed, names } = parsedNames(file);
  for (const card of requiredCards) {
    const found = names.includes(card) || names.some(name => name.startsWith(card + ' //'));
    assert.ok(found, `${file} should parse clean Scryfall query for ${card}`);
  }
  assert.equal(parsed.cards.find(card => card.name === 'Sol Ring')?.set || '', file === 'mtggoldfish-export.txt' || file === 'archidekt-export.txt' ? 'cmm' : '');
  assert.ok(parsed.cards.every(card => !/\$|\bUSD\b|\bTIX\b|<[^>]+>/i.test(card.cleanedName || card.name)), `${file} should strip prices and HTML junk`);
}

const dirty = lab.cleanName('1x Sol Ring (CMM) 400 $1.25 // price');
assert.deepEqual(dirty, { name: 'Sol Ring', set: 'cmm', collector: '400', cleaned: 'Sol Ring' });

console.log('Deck Lab import fixture parsing tests passed');
