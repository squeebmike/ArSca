import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: the new template fields exist as one shared, config-driven list ──
assert.match(dashboard, /const EBAY_TEMPLATE_EXTRA_FIELDS = \[/, 'EBAY_TEMPLATE_EXTRA_FIELDS must exist as the single source of truth for the new optional listing-detail fields');
const expectedKeys = ['brand','character','franchise','series','card_name','card_type','parallel','insert','edition','numbered','memorabilia','release_date','isbn','exclusive','platform'];
for(const key of expectedKeys){
  assert.match(dashboard, new RegExp(`key:'${key}'`), `EBAY_TEMPLATE_EXTRA_FIELDS must define a "${key}" field`);
}

// ── Contract: every new field is registered in the ONE array that makes it round-trip
// through read/write/sync -- this is the exact bug class the codebase's own comment
// warns about (a field that types in but silently fails to persist/reload) ──
const simpleFieldsSrc = dashboard.match(/const BUILT_IN_ITEM_SIMPLE_FIELDS = \[[\s\S]*?\n\];/)[0];
for(const key of expectedKeys){
  assert.match(simpleFieldsSrc, new RegExp(`\\['${key}',''\\]`), `"${key}" must be registered in BUILT_IN_ITEM_SIMPLE_FIELDS or it will type in but never actually save`);
}

// ── Contract: the edit modal has a mount point and renders/populates/reads generically
// (one implementation for all 15 fields), not 15 hand-copied blocks ──
assert.match(dashboard, /<div id="edit-ebay-extra-fields"/, 'the edit modal must have a mount point for the generated extra-field inputs');
assert.match(dashboard, /function renderEbayExtraFieldInputs\(\)\{/, 'a generic renderer must build the inputs from EBAY_TEMPLATE_EXTRA_FIELDS');
assert.match(dashboard, /function populateEbayExtraFieldInputs\(item\)\{/, 'a generic populate function must exist');
assert.match(dashboard, /function readEbayExtraFieldUpdates\(\)\{/, 'a generic read-back function must exist');

// ── Contract: populate/save are wired into BOTH the edit path and the add-from-Research path ──
const populateCount = (dashboard.match(/populateEbayExtraFieldInputs\(item\);/g) || []).length;
assert.ok(populateCount >= 2, `populateEbayExtraFieldInputs must be called from both openEditModal and openAddToInventoryModal (found ${populateCount} call sites)`);
const readCount = (dashboard.match(/\.\.\.readEbayExtraFieldUpdates\(\),/g) || []).length;
assert.ok(readCount >= 2, `readEbayExtraFieldUpdates must be spread into both confirmEditAndSync and confirmAddToInventoryFromModal's updates object (found ${readCount} call sites)`);

// ── Contract: tokens exist for both the new free-text fields (via the loop) and the
// fields the user asked for that already existed under a different name (rookie,
// autograph, gradingCompany, certNumber, notes) ──
assert.match(dashboard, /rookie:item\.is_rookie\?'Rookie Card':'',/, 'rookie must be a real template token derived from the existing is_rookie checkbox');
assert.match(dashboard, /autograph:item\.is_signed\?'Autograph':'',/, 'autograph must be a real template token derived from the existing is_signed checkbox');
assert.match(dashboard, /gradingCompany:item\.grader\|\|'',/, 'gradingCompany must expose the existing grader field as its own token');
assert.match(dashboard, /certNumber:item\.cert_number\|\|'',/, 'certNumber must expose the existing cert_number field as its own token');
assert.match(dashboard, /notes:item\.key_notes\|\|item\.notes\|\|'',/, 'notes must be a real template token, not just an internal-only field');
assert.match(dashboard, /EBAY_TEMPLATE_EXTRA_FIELDS\.forEach\(f=>\{ tokens\[f\.token\] = tokens\[f\.token\] \|\| item\[f\.key\] \|\| ''; \}\);/,
  'every new free-text field must also become a template token, without clobbering an already-computed token of the same name (e.g. releaseDate)');

console.log('eBay listing template fields contract checks passed');

// ── Functional: reimplement renderEbayDescriptionTemplate and confirm the user's
// explicit worry -- a template referencing an unfilled new field must NEVER show the
// literal "{brand}" placeholder text to a buyer ──
function renderEbayDescriptionTemplate(template, tokens){
  const lines = String(template || '').split('\n');
  const out = [];
  for(const line of lines){
    const keys = [...line.matchAll(/\{(\w+)\}/g)].map(m => m[1]);
    if(keys.length && keys.every(k => !tokens[k])) continue;
    out.push(line.replace(/\{(\w+)\}/g, (_, k) => tokens[k] || ''));
  }
  return out.join('\n').trim();
}

{
  const template = 'Set: {set}\nBrand: {brand}\nFranchise: {franchise}\nCondition: {condition}';
  const tokens = { set:'Base Set', brand:'', franchise:'', condition:'Near Mint' };
  const rendered = renderEbayDescriptionTemplate(template, tokens);
  assert.doesNotMatch(rendered, /\{brand\}/, 'an unfilled new field must never leak the literal {brand} token into a live listing description');
  assert.doesNotMatch(rendered, /\{franchise\}/, 'an unfilled new field must never leak the literal {franchise} token into a live listing description');
  assert.doesNotMatch(rendered, /Brand:/, 'a line whose only content is an unfilled new token must be dropped entirely, not shown as an empty "Brand:" line');
  assert.match(rendered, /Set: Base Set/, 'filled tokens on other lines must still render normally');
  assert.match(rendered, /Condition: Near Mint/, 'filled tokens must still render normally alongside dropped/blank ones');
}

{
  const template = 'Character: {character}\nBrand: {brand}, {franchise} exclusive';
  const tokens = { character:'Pikachu', brand:'Funko', franchise:'' };
  const rendered = renderEbayDescriptionTemplate(template, tokens);
  assert.match(rendered, /Character: Pikachu/, 'a filled new field must render its real value');
  assert.match(rendered, /Brand: Funko,\s*exclusive/, 'a line with a mix of filled and unfilled tokens keeps the filled value and blanks only the empty one, never dropping the whole line');
  assert.doesNotMatch(rendered, /\{franchise\}/, 'the unfilled token within a mixed line must not leak as literal {franchise} text either');
}

console.log('eBay listing template fields functional checks passed');
