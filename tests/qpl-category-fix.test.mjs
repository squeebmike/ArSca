import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: the collapsing-to-generic-"TCG" bug is fixed at its two real sources ──
assert.match(dashboard, /const QPL_KEY_TO_STANDARD_CATEGORY = \{\s*\n\s*pokemon:'Pokemon TCG', mtg:'Magic: The Gathering', yugioh:'Yu-Gi-Oh!',\s*\n\s*one_piece:'One Piece TCG', lorcana:'Disney Lorcana', comic:'Comic', sports:'Sports',\s*\n\s*\};/, 'missing the specific-game category mapping table');
assert.match(dashboard, /function qplResultStandardCategory\(r\)\{\s*\n\s*return QPL_KEY_TO_STANDARD_CATEGORY\[qplResultCategoryKey\(r\)\] \|\| normalizeQuickCategory\(r\?\.category\);\s*\n\}/, 'qplResultStandardCategory must prefer the specific detected game over the generic bucket');
assert.match(dashboard, /const cat = qplResultStandardCategory\(r\);/, 'selected-card panel must use the specific-category resolver, not normalizeQuickCategory directly');
assert.match(dashboard, /\$\{Array\.from\(new Set\(\[\.\.\.getInventoryCategories\(\), 'Graded', cat\]\.filter\(Boolean\)\)\)\.map\(c => `<option value="\$\{escHtml\(c\)\}" \$\{cat===c\?'selected':''\}>\$\{escHtml\(c\)\}<\/option>`\)\.join\(''\)\}/, '#qpl-edit-category must offer the real store category list (Pokemon TCG, Magic: The Gathering, etc), not a hardcoded 5-item list missing every specific TCG');
assert.doesNotMatch(dashboard, /\$\{\['TCG','Sports','Comic','Graded','Collectibles'\]\.map\(c => `<option value="\$\{c\}" \$\{cat===c\?'selected':''\}>\$\{c\}<\/option>`\)\.join\(''\)\}/, 'the old hardcoded category option list must be gone');

// ── Contract: Inventory tab category wheel no longer lumps every card game under one generic TCG pill ──
assert.match(dashboard, /invCatWheelSelect\(this,'Pokemon TCG'\)/, 'inventory category wheel must offer Pokemon TCG specifically');
assert.match(dashboard, /invCatWheelSelect\(this,'Magic: The Gathering'\)/, 'inventory category wheel must offer Magic: The Gathering specifically');
assert.doesNotMatch(dashboard, /invCatWheelSelect\(this,'TCG'\)/, 'the generic TCG wheel pill must be gone -- it is not a real category value');

console.log('QPL category-fix contract checks passed');

// ── Functional: a Pokemon search result must resolve to "Pokemon TCG", not "TCG" ──
const categoryKeySrc = dashboard.match(/function qplCategoryKey\(category\)\{[\s\S]*?\n\}/)[0];
const resultKeySrc = dashboard.match(/function qplResultCategoryKey\(r\)\{[\s\S]*?\n\}/)[0];
const normalizeSrc = dashboard.match(/function normalizeQuickCategory\(category\)\{[\s\S]*?\n\}/)[0];
const mapSrc = dashboard.match(/const QPL_KEY_TO_STANDARD_CATEGORY = \{[\s\S]*?\n\};/)[0];
const resolverSrc = dashboard.match(/function qplResultStandardCategory\(r\)\{[\s\S]*?\n\}/)[0];
const { qplResultStandardCategory } = new Function(`${categoryKeySrc}\n${resultKeySrc}\n${normalizeSrc}\n${mapSrc}\n${resolverSrc}\nreturn { qplResultStandardCategory };`)();

const pokemonResult = { source:'pokemon', category:'', name:'Charizard ex', set:'Obsidian Flames' };
assert.equal(qplResultStandardCategory(pokemonResult), 'Pokemon TCG', 'a Pokemon search result (name/set carry no literal "pokemon" text) must still resolve to Pokemon TCG, not generic TCG');

const mtgResult = { source:'scryfall', category:'', name:'Lightning Bolt', set:'Kaladesh' };
assert.equal(qplResultStandardCategory(mtgResult), 'Magic: The Gathering', 'a Magic result must resolve to Magic: The Gathering, not generic TCG');

const unknownResult = { category:'Some Weird Custom Text' };
assert.equal(qplResultStandardCategory(unknownResult), normalizeQuickCategoryStandalone(unknownResult), 'an unrecognized game must still fall back through normalizeQuickCategory unchanged');

function normalizeQuickCategoryStandalone(r){
  const { normalizeQuickCategory } = new Function(`${normalizeSrc}\nreturn { normalizeQuickCategory };`)();
  return normalizeQuickCategory(r.category);
}

console.log('QPL category-fix functional checks passed');
