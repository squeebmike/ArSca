import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Set picker grid: replaces the bare <select> with tappable set images ──
// Both Set Browsers used a plain dropdown to pick a set out of hundreds --
// no visual cue beyond a printed name. Pokemon (PokemonPriceTracker) and MTG
// (Scryfall icon_svg_uri) both already carry a real per-set image, so a
// shared grid renderer surfaces it instead.

for (const fn of ['setTilePlaceholderColor', 'setPickerGridHtml']) {
  assert.match(dashboard, new RegExp(`function ${fn}\\(`), `missing shared ${fn}`);
}

// Pokémon wiring
assert.match(dashboard, /id="ppsb-set-grid" class="set-picker-grid"/, 'Pokemon set browser must render a set picker grid');
assert.match(dashboard, /id="ppsb-set-sel" class="ppsb-set-sel" style="display:none"/, 'the underlying Pokemon <select> must be hidden, not removed (other code still reads its value)');
assert.match(dashboard, /function sbSelectSetTile\(id\)\{/, 'missing sbSelectSetTile');
assert.match(dashboard, /function sbToggleSetView\(\)\{/, 'missing sbToggleSetView');
assert.match(dashboard, /gridEl\.innerHTML = setPickerGridHtml\(sets, sel\.value, 'sbSelectSetTile'\)/, 'sbPopulateSets must render the grid after fetching sets');
assert.match(dashboard, /gridEl\.innerHTML = setPickerGridHtml\(filtered, sel\.value, 'sbSelectSetTile'\)/, 'sbFilterSetDropdown must re-render the grid against the filtered set list');

// MTG wiring
assert.match(dashboard, /id="mtsb-set-grid" class="set-picker-grid"/, 'MTG set browser must render a set picker grid');
assert.match(dashboard, /id="mtsb-set-sel" class="mtsb-set-sel" style="display:none"/, 'the underlying MTG <select> must be hidden, not removed');
assert.match(dashboard, /function mtgsbSelectSetTile\(code\)\{/, 'missing mtgsbSelectSetTile');
assert.match(dashboard, /function mtgsbToggleSetView\(\)\{/, 'missing mtgsbToggleSetView');
assert.match(dashboard, /gridEl\.innerHTML = setPickerGridHtml\(sets, sel\.value, 'mtgsbSelectSetTile'\)/, 'mtgsbRenderSetOptions must render the grid (shared by populate + filter, both call it)');

console.log('Set picker grid contract checks passed');

// ── Functional check: setPickerGridHtml + setTilePlaceholderColor ──
{
  const colorSrc = dashboard.match(/function setTilePlaceholderColor\(name\)\{[\s\S]*?\n\}/)?.[0];
  const gridSrc = dashboard.match(/function setPickerGridHtml\(sets, selectedId, clickFnName\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(colorSrc && gridSrc, 'could not extract set picker functions for functional testing');
  const escHtmlStub = `function escHtml(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }`;
  const { setPickerGridHtml } = new Function(`${escHtmlStub}\n${colorSrc}\n${gridSrc}\nreturn { setPickerGridHtml };`)();

  assert.match(setPickerGridHtml([], null, 'sbSelectSetTile'), /No sets match/, 'an empty set list must render an empty-state message, not a blank grid');

  // Pokemon-shaped set (id/name/releaseDate/cardCount/imageUrl).
  const pokemonSets = [{ id:'sv1', name:'Scarlet & Violet', releaseDate:'2023-03-31', cardCount:198, imageUrl:'https://example.com/sv1.png' }];
  const pokemonHtml = setPickerGridHtml(pokemonSets, 'sv1', 'sbSelectSetTile');
  assert.match(pokemonHtml, /onclick="sbSelectSetTile\('sv1'\)"/, 'tile must call the given click handler with the set id');
  assert.match(pokemonHtml, /class="set-picker-tile active"/, 'the currently-selected set must be visually marked active');
  assert.match(pokemonHtml, /<img src="https:\/\/example\.com\/sv1\.png"/, 'a set with a real image must render it, not a fallback');
  assert.match(pokemonHtml, /set-picker-tile-meta">2023 · /, 'release year must be extracted from releaseDate');
  assert.match(pokemonHtml, /198 cards/, 'card count must be shown');

  // MTG-shaped set (code/name/released_at/card_count/icon_svg_uri), no image case too.
  const mtgSets = [{ code:'mkm', name:'Murders at Karlov Manor', released_at:'2024-02-09', card_count:286 }];
  const mtgHtml = setPickerGridHtml(mtgSets, null, 'mtgsbSelectSetTile');
  assert.match(mtgHtml, /onclick="mtgsbSelectSetTile\('mkm'\)"/, 'MTG tiles must use the set code as the id (Scryfall has no separate id field here)');
  assert.doesNotMatch(mtgHtml, /class="set-picker-tile active"/, 'no set should be marked active when selectedId is null');
  assert.match(mtgHtml, /set-picker-tile-fallback/, 'a set with no image must fall back to a colored-initial tile, not break');
  assert.match(mtgHtml, />M<\/div>/, 'the fallback initial must be the first letter of the set name, uppercased');
}

console.log('Set picker grid functional checks passed');

// ── Scryfall set icons must be visible against the dark theme ──────
// Scryfall's icon_svg_uri is a solid-black monochrome glyph designed to
// sit on a light background; rendered bare here it's effectively invisible
// against a near-black theme. Only MTG set icons are SVGs (Pokemon's set
// images are raster), so a background+padding treatment targeted at SVG
// <img> tiles fixes this without touching Pokemon tiles.
assert.match(dashboard, /\.set-picker-tile-img img\[src\*="\.svg"\]\{background:#fff/, 'MTG set icon SVGs must get a light background so they are visible on the dark theme');

console.log('Set icon visibility contract checks passed');

// ── Set picker must collapse once a set is selected ──────────────────
// Opening a set used to leave the full picker (search + a scrollable grid
// of every set) permanently on screen above the card list -- taking up a
// huge amount of space and forcing a lot of scrolling before reaching the
// actual cards. Once a set is picked, the picker must collapse to a compact
// "CHANGE SET" bar.

assert.match(dashboard, /id="ppsb-set-picker-collapsed" class="set-picker-collapsed-bar" style="display:none"/, 'Pokemon set browser must have a collapsed-picker summary bar');
assert.match(dashboard, /id="ppsb-set-picker">/, 'Pokemon set browser picker (search + grid) must be wrapped in a single collapsible container');
assert.match(dashboard, /function sbCollapseSetPicker\(setName\)\{/, 'missing sbCollapseSetPicker');
assert.match(dashboard, /function sbExpandSetPicker\(\)\{/, 'missing sbExpandSetPicker');
assert.match(dashboard, /_sbState\.selectedSet = \{ id:setId, name:setName \};\s*\n\s*sbCollapseSetPicker\(setName\);/, 'selecting a Pokemon set must collapse the picker');

assert.match(dashboard, /id="mtsb-set-picker-collapsed" class="set-picker-collapsed-bar" style="display:none"/, 'MTG set browser must have a collapsed-picker summary bar');
assert.match(dashboard, /id="mtsb-set-picker">/, 'MTG set browser picker must be wrapped in a single collapsible container');
assert.match(dashboard, /function mtgsbCollapseSetPicker\(setName\)\{/, 'missing mtgsbCollapseSetPicker');
assert.match(dashboard, /function mtgsbExpandSetPicker\(\)\{/, 'missing mtgsbExpandSetPicker');
assert.match(dashboard, /_mtgsbState\.selectedSet = \{ code: setCode, name: setName \};\s*\n\s*mtgsbCollapseSetPicker\(setName\);/, 'selecting an MTG set must collapse the picker');

console.log('Set picker collapse contract checks passed');

// ── eBay deal-scan results must be collapsed by default ──────────────
// A cached scan can be 25+ listings; rendering them all in full,
// unconditionally, directly above the card grid buried "cards from this set
// with prices" (the reason someone opened a set) under a wall of eBay
// results. Loading a cached scan on open must not auto-expand it; running a
// scan the user explicitly asked for must.

assert.match(dashboard, /dealScanExpanded: false,/, 'Pokemon deal scan must default to collapsed');
assert.match(dashboard, /if\(!_sbState\.dealScanExpanded\) \{\s*\n\s*return `<div style="margin:8px 0"><button class="hbtn" style="border-color:rgba\(255,209,102,\.5\);color:var\(--gold\)" onclick="sbToggleDealScanExpanded\(\)">/, 'collapsed Pokemon deal scan must render a summary+expand button, not the full list');
assert.match(dashboard, /function sbToggleDealScanExpanded\(\)\{/, 'missing sbToggleDealScanExpanded');
assert.match(dashboard, /_sbState\.dealScan = data;\s*\n\s*\/\/ A scan the user just explicitly asked for[\s\S]*?_sbState\.dealScanExpanded = true;/, 'a manually-triggered Pokemon scan must auto-expand its own results');

assert.match(dashboard, /dealScanExpanded: false,/, 'MTG deal scan must default to collapsed');
assert.match(dashboard, /if\(!_mtgsbState\.dealScanExpanded\) \{\s*\n\s*return `<div style="margin:8px 0"><button class="hbtn" style="border-color:rgba\(255,209,102,\.5\);color:var\(--gold\)" onclick="mtgsbToggleDealScanExpanded\(\)">/, 'collapsed MTG deal scan must render a summary+expand button, not the full list');
assert.match(dashboard, /function mtgsbToggleDealScanExpanded\(\)\{/, 'missing mtgsbToggleDealScanExpanded');
assert.match(dashboard, /_mtgsbState\.dealScan = data;\s*\n\s*_mtgsbState\.dealScanExpanded = true;/, 'a manually-triggered MTG scan must auto-expand its own results');

console.log('Deal scan collapse-by-default contract checks passed');

// ── "Send to buy" / "send to inventory" from the Set Browser card list ──
// The only per-card action was "+ ADD" (stage into Research/QPL) -- getting
// a card into the buy list or straight into inventory required leaving the
// Set Browser, finding it again in Research, and using the action there.

for (const fn of ['sbStageQplRow', 'sbAddToBuy', 'sbAddToInventory']) {
  assert.match(dashboard, new RegExp(`function ${fn}\\(`), `missing ${fn}`);
}
for (const fn of ['mtgsbStageQplRow', 'mtgsbAddToBuy', 'mtgsbAddToInventory']) {
  assert.match(dashboard, new RegExp(`function ${fn}\\(`), `missing ${fn}`);
}
// Both stage functions must return the same index (0) they just inserted at.
assert.match(dashboard, /qplResults = \[row, \.\.\.qplResults\.filter\(r => !tid \|\| \(r\.tcgPlayerId \|\| ''\) !== tid\)\];\s*\n\s*return 0;/, 'sbStageQplRow must return the index the row was staged at');
assert.match(dashboard, /qplResults = \[row, \.\.\.qplResults\.filter\(r => !sid \|\| \(r\.scryfallId \|\| ''\) !== sid\)\];\s*\n\s*return 0;/, 'mtgsbStageQplRow must return the index the row was staged at');

// Every card-list view (grid, table, swipe) in both browsers must expose both actions.
const sbAddToBuyCount = (dashboard.match(/onclick="sbAddToBuy\(\$\{i(?:dx)?\},this\)"/g) || []).length;
assert.equal(sbAddToBuyCount, 3, 'Pokemon +BUY action must be wired into all 3 card views (grid, table, swipe)');
const sbAddToInventoryCount = (dashboard.match(/onclick="sbAddToInventory\(\$\{i(?:dx)?\}\)"/g) || []).length;
assert.equal(sbAddToInventoryCount, 3, 'Pokemon +INV action must be wired into all 3 card views (grid, table, swipe)');
const mtgsbAddToBuyCount = (dashboard.match(/onclick="mtgsbAddToBuy\(\$\{i(?:dx)?\},this\)"/g) || []).length;
assert.equal(mtgsbAddToBuyCount, 3, 'MTG +BUY action must be wired into all 3 card views (grid, table, swipe)');
const mtgsbAddToInventoryCount = (dashboard.match(/onclick="mtgsbAddToInventory\(\$\{i(?:dx)?\}\)"/g) || []).length;
assert.equal(mtgsbAddToInventoryCount, 3, 'MTG +INV action must be wired into all 3 card views (grid, table, swipe)');

console.log('Set Browser buy/inventory action contract checks passed');
