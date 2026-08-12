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
