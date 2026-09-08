import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store idea: a way to lay a theme's owned cards out for physical display
// in the case, not just look at them on screen -- closes the loop on why
// Card Themes was built in the first place (merchandising/case layout).

assert.match(dashboard, /onclick="printCardThemeCase\('\$\{id\}'\)">🖨️ PRINT CASE CARD</, 'the theme detail view must have a print button');
assert.match(dashboard, /function printCardThemeCase\(id\)\{/, 'missing printCardThemeCase');

const fnStart = dashboard.indexOf('function printCardThemeCase(id){');
const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
const fn = dashboard.slice(fnStart, fnEnd);
assert.match(fn, /const breakdown = matchCardThemeToInventory\(theme\)\.filter\(b => b\.matches\.length > 0\);/,
  'must only print cards actually in stock -- nothing to display for ones not owned');
assert.match(fn, /window\.open\('','_blank','width=500,height=700'\)/, 'must follow the app\'s existing print-window convention');
assert.match(fn, /window\.print\(\)/, 'must trigger the browser print dialog');
assert.match(fn, /if\(!breakdown\.length\)\{/, 'must handle the case where none of the theme\'s cards are in stock, not print a blank page');

console.log('Card Theme print case card contract checks passed');
