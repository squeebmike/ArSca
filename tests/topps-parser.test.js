const assert = require('assert');
const {
  buildChecklistIndex,
  detectFlags,
  inferSport,
  parseCardLine,
  parseChecklistText,
} = require('../scripts/topps-checklist-parser');

const sample = `
2024 Topps Series 1 Baseball - Base Cards
Base Cards
1 Mike Trout - Angels
2 Corbin Carroll RC - Diamondbacks
HFA-1 Shohei Ohtani Home Field Advantage
Autograph Cards
TA-MT Mike Trout Autograph /25 - Angels
Relics
MLM-AR Adley Rutschman Major League Material Relic
`;

const parsed = parseChecklistText({ text: sample, fileName: '2024-Topps-Series-1-Baseball-Checklist.pdf', sourceId: 'src1' });
assert.strictEqual(parsed.set.year, '2024');
assert.strictEqual(parsed.set.sport, 'baseball');
assert.ok(parsed.cards.length >= 5, 'expected parsed card rows');
assert.ok(parsed.cards.find(c => c.cardNumber === '2' && c.flags.rc), 'rookie flag should parse');
assert.ok(parsed.cards.find(c => c.cardNumber === 'TA-MT' && c.flags.auto), 'auto flag should parse');
assert.ok(parsed.cards.find(c => c.cardNumber === 'MLM-AR' && c.flags.relic), 'relic flag should parse');

const rows = parseCardLine('1 Mike Trout - Angels 2 Corbin Carroll RC - Diamondbacks', 'Base');
assert.strictEqual(rows.length, 2, 'multi-column line should split into two cards');

assert.strictEqual(inferSport('2018-Allen-Ginter-BB-Checklist.pdf', ''), 'baseball');
assert.strictEqual(detectFlags('Gold Refractor /50', 'Parallels').numbered, true);

const index = buildChecklistIndex([{ sourceId: 'src1', fileName: '2024-Topps-Series-1-Baseball-Checklist.pdf', rawText: sample }]);
assert.strictEqual(index.sets.length, 1);
assert.ok(index.cards.length >= 5);
assert.ok(index.sources[0].rawText.includes('Mike Trout'));

console.log('Topps parser tests passed');
