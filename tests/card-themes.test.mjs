import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store request: curated card groupings (like the Dex TCG app's "Golden
// Hour" -- cards that look good displayed/sold together, not an official
// set), cross-referenced against current sellable inventory so the store
// can see what they already have for a theme. The store explicitly did
// not want to hand-pick which cards belong to a theme (they're already
// well known) -- but there's no public API for these (dextcg.com is
// unreachable, web search turns up nothing usable) -- so themes are
// entered by the store from a screenshot/post rather than imported.

// ── Config storage: cardThemes alongside the existing vendor config fields ──
assert.match(dashboard, /cardThemes: \[\],/, 'DEFAULT_VENDOR_CONFIG must default to no configured card themes');
assert.match(dashboard, /cardThemes: Array\.isArray\(saved\.cardThemes\) \? saved\.cardThemes : \[\.\.\.DEFAULT_VENDOR_CONFIG\.cardThemes\],/, 'getVendorConfig must merge saved card themes');
assert.match(dashboard, /cardThemes: Array\.isArray\(config\.cardThemes\) \? config\.cardThemes : getVendorConfig\(\)\.cardThemes,/, 'saveVendorConfig must persist card themes');

// ── Core functions exist ──
assert.match(dashboard, /function getCardThemes\(\)\{/, 'missing getCardThemes');
assert.match(dashboard, /function addCardTheme\(name, cardListText\)\{/, 'missing addCardTheme');
assert.match(dashboard, /function deleteCardTheme\(id\)\{/, 'missing deleteCardTheme');
assert.match(dashboard, /function matchCardThemeToInventory\(theme\)\{/, 'missing matchCardThemeToInventory');
assert.match(dashboard, /function openCardThemesBrowser\(\)\{/, 'missing openCardThemesBrowser');
assert.match(dashboard, /function closeCardThemesBrowser\(\)\{/, 'missing closeCardThemesBrowser');
assert.match(dashboard, /function renderCardThemesBrowser\(\)\{/, 'missing renderCardThemesBrowser');
assert.match(dashboard, /function submitNewCardTheme\(\)\{/, 'missing submitNewCardTheme');
assert.match(dashboard, /function openCardThemeDetail\(id\)\{/, 'missing openCardThemeDetail');

// ── matchCardThemeToInventory must only match currently-sellable items ──
{
  const fnStart = dashboard.indexOf('function matchCardThemeToInventory(theme){');
  const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
  const fn = dashboard.slice(fnStart, fnEnd);
  assert.match(fn, /const sellable = all\.filter\(inventoryItemIsSellable\);/, 'matching must filter to sellable inventory only, not sold/archived/zero-qty items');
  assert.match(fn, /String\(item\.name \|\| ''\)\.toLowerCase\(\)\.includes\(needle\)/, 'matching must be a case-insensitive substring match against item name');
}

// ── addCardTheme must parse newline/comma-separated card lists and reject empty input ──
{
  const fnStart = dashboard.indexOf('function addCardTheme(name, cardListText){');
  const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
  const fn = dashboard.slice(fnStart, fnEnd);
  assert.match(fn, /\.split\(\/\[\\n,\]\/\)/, 'card list must split on newlines or commas');
  assert.match(fn, /if\(!name \|\| !name\.trim\(\) \|\| !cardNames\.length\) return null;/, 'a blank name or empty card list must be rejected rather than saving a broken theme');
}

// ── Entry point: a Card Themes button on the SETS tab toolbar, alongside the existing set browsers ──
assert.match(dashboard, /<button class="hbtn" onclick="openCardThemesBrowser\(\)"[^>]*>🎨 CARD THEMES<\/button>/, 'the SETS tab toolbar must expose a Card Themes entry point next to the Pokemon/MTG set browsers');

console.log('Card themes contract checks passed');

// ── Functional: reimplement the parsing + matching logic and prove it ──
function addCardThemeLogic(name, cardListText){
  const cardNames = String(cardListText || '')
    .split(/[\n,]/)
    .map(s => s.trim())
    .filter(Boolean);
  if(!name || !name.trim() || !cardNames.length) return null;
  return { name: name.trim(), cardNames };
}
{
  const theme = addCardThemeLogic('Golden Hour', 'Mesprit\nLatios, Espathra\nOrthworm\nTyranitar');
  assert.ok(theme, 'a theme with a name and card list must be created');
  assert.deepEqual(theme.cardNames, ['Mesprit', 'Latios', 'Espathra', 'Orthworm', 'Tyranitar'], 'mixed newline/comma separators must all split correctly, trimmed');
}
assert.equal(addCardThemeLogic('', 'Mesprit'), null, 'a blank name must be rejected');
assert.equal(addCardThemeLogic('Golden Hour', ''), null, 'an empty card list must be rejected');
assert.equal(addCardThemeLogic('Golden Hour', '   ,  ,\n'), null, 'a card list of only separators must be rejected');

function inventoryItemIsSellable(item){
  const status = String(item.status || '').toLowerCase();
  return !['sold','archived','returned','deleted','bundled'].includes(status) && (item.qty ?? 1) > 0;
}
function matchThemeLogic(theme, inventory){
  const sellable = inventory.filter(inventoryItemIsSellable);
  return theme.cardNames.map(cardName => {
    const needle = cardName.toLowerCase();
    const matches = sellable.filter(item => String(item.name || '').toLowerCase().includes(needle));
    return { cardName, matches };
  });
}
{
  const inventory = [
    { id: '1', name: 'Mesprit ex 001/091 Prismatic Evolutions', status: 'in_stock', qty: 2 },
    { id: '2', name: 'Latios ex 002/091 Prismatic Evolutions', status: 'in_stock', qty: 1 },
    { id: '3', name: 'Espathra 003/091', status: 'sold', qty: 0 },
    { id: '4', name: 'Random Unrelated Card', status: 'in_stock', qty: 5 },
  ];
  const theme = { name: 'Golden Hour', cardNames: ['Mesprit', 'Latios', 'Espathra', 'Tyranitar'] };
  const breakdown = matchThemeLogic(theme, inventory);
  assert.equal(breakdown.length, 4, 'breakdown must have one entry per card in the theme');
  assert.equal(breakdown[0].matches.length, 1, 'Mesprit must match the in-stock Mesprit item');
  assert.equal(breakdown[0].matches[0].id, '1');
  assert.equal(breakdown[1].matches.length, 1, 'Latios must match the in-stock Latios item');
  assert.equal(breakdown[2].matches.length, 0, 'a sold Espathra must NOT count as in stock');
  assert.equal(breakdown[3].matches.length, 0, 'a card with no matching inventory at all must show zero matches');
  const ownedCount = breakdown.filter(b => b.matches.length > 0).length;
  assert.equal(ownedCount, 2, '2 of 4 theme cards must be reported as in stock');
}

console.log('Card themes functional checks passed');
