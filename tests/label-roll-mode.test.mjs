import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: a size/printer picker exists and remembers the choice ──
assert.match(dashboard, /<select id="label-print-size" class="tsi" onchange="localStorage\.setItem\('label_print_size', this\.value\)"/, 'the label print modal must offer a size/printer picker that persists the choice');
assert.match(dashboard, /<option value="roll-2x1"[^>]*>Roll labels -- 2" x 1" \(Rollo\/Zebra direct-thermal, one per page\)<\/option>/, 'a 2x1 direct-thermal roll option must exist');
// The store's actual physical printer is a 2x1 roll -- defaulting to the
// sheet layout meant a device that had never had someone manually pick the
// roll option kept silently printing the wrong physical size.
assert.match(dashboard, /sizeEl\.value = localStorage\.getItem\('label_print_size'\) \|\| 'roll-2x1';/, 'opening the modal must restore the last-used size, defaulting to the store\'s actual 2x1 roll printer');

// ── Contract: roll mode is a real different print job (page-per-label, no margins), not just a size number ──
assert.match(dashboard, /const isRoll = mode === 'roll-2x1';/, 'printInventoryLabels must branch behavior on the selected mode');
assert.match(dashboard, /@page \{ size: 2in 1in; margin: 0; \}/, 'roll mode must set the page size to exactly the label size with zero margin -- a roll printer\'s page IS the label');
assert.match(dashboard, /page-break-after:always/, 'roll mode must print exactly one label per page so a continuous-feed roll printer advances correctly between labels');
assert.match(dashboard, /w\.document\.write\(`<html><head><title>Labels<\/title>\s*\n\s*<style>\$\{isRoll \? rollStyle : sheetStyle\}\$\{isWrap \? wrapStyle : ''\}<\/style>/, 'the print window must use the roll stylesheet only when roll mode is selected, leaving the existing sheet layout untouched otherwise');

console.log('Label roll-mode contract checks passed');
