import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

assert.match(dashboard, /const fields = \[item\.name,item\.set,item\.year,item\.card_number,item\.variant,item\.rarity,item\.finish,item\.category,item\.configuration,item\.condition,item\.player,item\.team,item\.issue,item\.issueNumber,item\.series,item\.publisher,item\.location,item\.box,item\.notes,item\.key_notes,item\.tags,\.\.\.inventoryComicSearchFields\(item\)\]\.filter\(Boolean\);/, 'scoreSmartItem must search Product Type (configuration) and condition, not just the older field set');

console.log('Inventory search field coverage checks passed');

// ── Functional: scoreSmartItem must find an item by its Product Type ─────
const synonymsSrc = dashboard.match(/const SMART_SEARCH_SYNONYMS = \{[\s\S]*?\n\};/)[0];
const scoreSrc = dashboard.match(/function scoreSmartItem\(item, q\)\{[\s\S]*?\n\}/)[0];
const needlesSrc = dashboard.match(/function smartSearchNeedles\(q\)\{[\s\S]*?\n\}/)[0];
const expandSrc = dashboard.match(/function expandSmartQuery\(q\)\{[\s\S]*?\n\}/)[0];
const normalizeSrc = dashboard.match(/function smartNormalizeText\(\w+\)\{[\s\S]*?\n\}/)[0];
const levenshteinSrc = dashboard.match(/function levenshtein\(a,b\)\{[\s\S]*?\n\}/)[0];
const inventoryComicSearchFieldsSrc = dashboard.match(/function inventoryComicSearchFields\(item=\{\}\)\{[\s\S]*?\n\}/)[0];
const { scoreSmartItem } = new Function(`${synonymsSrc}\n${normalizeSrc}\n${expandSrc}\n${needlesSrc}\n${levenshteinSrc}\n${inventoryComicSearchFieldsSrc}\n${scoreSrc}\nreturn { scoreSmartItem };`)();

const secretLairItem = { name:'Spider-Man Venom Unleashed', set:'Secret Lair Drop', configuration:'Secret Lair', category:'Magic: The Gathering' };
assert.ok(scoreSmartItem(secretLairItem, 'secret lair').score > 0, 'must find an item by its Product Type (configuration) when nothing else in the name matches');

const ultraRareItem = { name:'Charizard', variant:'Ultra Rare' };
assert.ok(scoreSmartItem(ultraRareItem, 'ultra rare').score > 0, 'must still find an item by its Variant/Parallel field');

console.log('scoreSmartItem functional checks passed');
