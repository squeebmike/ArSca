import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const storefront = fs.readFileSync('storefront.html', 'utf8');

// ── Dashboard: editable Product Type field, wired into both modal-open
// sites (existing item edit + Research "add to inventory") and both save
// sites (same shared modal reused by both flows) ──
assert.match(dashboard, /<label style="margin-top:8px;display:block">Product Type<\/label>\s*\n\s*<input type="text" id="edit-configuration" placeholder="Single, Booster Pack, Secret Lair, Commander Deck\.\.\.">/, 'missing Product Type input in the shared edit modal');
const populateOccurrences = dashboard.match(/document\.getElementById\('edit-configuration'\)\.value = inferProductConfiguration\(item\);/g) || [];
assert.equal(populateOccurrences.length, 2, 'Product Type must be prefilled in both openEditModal and openAddToInventoryModal (the shared edit-item modal)');
const saveOccurrences = dashboard.match(/configuration: document\.getElementById\('edit-configuration'\)\?\.value\.trim\(\) \|\| '',/g) || [];
assert.equal(saveOccurrences.length, 2, 'Product Type must be saved from both save sites that write the shared modal back to the item');

// ── Dashboard: inferProductConfiguration bucketing (existing values win, non-sealed defaults to Single) ──
assert.match(dashboard, /function inferProductConfiguration\(item\)\{/, 'missing inferProductConfiguration');
assert.match(dashboard, /if\(item\.configuration\) return item\.configuration;/, 'a product type staff already set must never be overwritten by the inferred guess');
assert.match(dashboard, /if\(!isSealedProduct\(item\) && !item\.is_sealed\) return \(item\.gradingCompany \|\| item\.grader\) \? 'Graded Single' : 'Single';/, 'non-sealed items must default to Single (or Graded Single)');
assert.match(dashboard, /if\(\/secret lair\/\.test\(name\)\) return 'Secret Lair';/, 'must detect Secret Lair product type');
assert.match(dashboard, /if\(\/commander\|precon\/\.test\(name\)\) return 'Commander Deck';/, 'must detect Commander Deck product type');

console.log('Dashboard Product Type field checks passed');

// ── Worker: configuration exposed on the public storefront payload ──
assert.match(worker, /configuration: storefrontCleanText\(d\.configuration \|\| '', 60\),/, 'shapeStorefrontItem must expose configuration to the public storefront');

console.log('Worker storefront payload checks passed');

// ── Storefront: new filter control, dynamically filled, wired into render()'s predicate ──
assert.match(storefront, /<select id="ptype"><option value="">All product types<\/option><\/select>/, 'missing the Product Type filter select');
assert.match(storefront, /fill\('ptype',d\.items\.map\(i=>i\.configuration\)\);/, 'Product Type options must be populated dynamically from actual item data, same as category\\/year\\/condition');
assert.match(storefront, /ptype=document\.getElementById\('ptype'\)\.value/, 'render() must read the selected product type');
assert.match(storefront, /\(!ptype\|\|i\.configuration===ptype\)/, 'render() must filter rows by the selected product type');
assert.match(storefront, /\[i\.name,i\.set,i\.variant,i\.category,i\.year,i\.condition,i\.configuration\]\.join\(' '\)\.toLowerCase\(\)\.includes\(q\)/, 'the free-text search must also match against configuration');
assert.match(storefront, /\[i\.set,i\.year,i\.variant,i\.configuration,i\.condition\]\.filter\(Boolean\)\.join\(' · '\)/, 'the grid card meta line must show the product type so shoppers understand the grouping');

console.log('Storefront Product Type filter checks passed');

// ── Functional: inferProductConfiguration bucketing logic ────────────────
const isSealedSrc = dashboard.match(/function isSealedProduct\(item\)\{[\s\S]*?\n\}/)[0];
const inferSrc = dashboard.match(/function inferProductConfiguration\(item\)\{[\s\S]*?\n\}/)[0];
const { inferProductConfiguration } = new Function(`${isSealedSrc}\n${inferSrc}\nreturn { inferProductConfiguration };`)();

assert.equal(inferProductConfiguration({ name:'Lightning Bolt', category:'MTG' }), 'Single', 'a plain single must default to Single');
assert.equal(inferProductConfiguration({ name:'Lightning Bolt', gradingCompany:'PSA' }), 'Graded Single', 'a graded single must default to Graded Single');
assert.equal(inferProductConfiguration({ name:'Secret Lair Drop: Heads I Win, Tails You Lose' }), 'Secret Lair', 'must detect Secret Lair from the name');
assert.equal(inferProductConfiguration({ name:'Commander Masters Commander Deck' }), 'Commander Deck', 'must detect a Commander deck from the name');
assert.equal(inferProductConfiguration({ name:'Foundations Booster Pack' }), 'Booster Pack', 'must detect a loose booster pack from the name');
assert.equal(inferProductConfiguration({ name:'Foundations Booster Box' }), 'Booster Box', 'must detect a booster box distinctly from a loose pack');
assert.equal(inferProductConfiguration({ name:'Mystery item', is_sealed:true }), 'Sealed Product', 'an unrecognized sealed product must fall back to a generic sealed bucket, not Single');
assert.equal(inferProductConfiguration({ name:'Anything', configuration:'Custom Lot' }), 'Custom Lot', 'an already-set configuration must be returned untouched');

console.log('inferProductConfiguration functional checks passed');
