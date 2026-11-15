import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');

// Store report (with error message): "+ ADD TO INVENTORY" on a FOC
// cover-wall card threw "Uncaught ReferenceError: quickAddFocSkuToInventory
// is not defined". Confirmed a hard refresh did NOT fix it (the reporter
// was right to push back) -- the real cause: this whole file is wrapped in
// an IIFE (line 1, `(function(){ ... })();`), so every function it
// declares is private to that closure. An onclick="..." HTML attribute
// string always resolves against the GLOBAL scope, not this closure, so a
// function is only reachable from an onclick/onchange attribute if it's
// explicitly re-exposed onto window in the block at the end of the file.
// quickAddFocSkuToInventory was defined but never added there -- and
// auditing every onclick/onchange reference in the file against that list
// turned up five more with the identical bug, all in the eBay bulk-listing
// workflow (select-all, per-item checkbox, start/skip/cancel), which was
// therefore completely non-functional the same way.

assert.match(src, /^\(function\(\)\{/, 'this file must still be the same self-contained IIFE this fix accounts for -- if that wrapper is ever removed, this whole exposure list becomes unnecessary, not wrong');

const onclickNames = [...src.matchAll(/onclick="([a-zA-Z_$][a-zA-Z0-9_$]*)\(/g)].map(m => m[1]);
const onchangeNames = [...src.matchAll(/onchange="([a-zA-Z_$][a-zA-Z0-9_$]*)\(/g)].map(m => m[1]);
const referenced = new Set([...onclickNames, ...onchangeNames]);
referenced.delete('openSettingsSection'); // a dashboard.html-level function, not this file's own -- correctly not exposed here

assert.ok(referenced.size > 20, 'sanity check: this file must reference a substantial number of onclick/onchange handlers, or this test isn\'t actually exercising the real surface');

assert.ok(src.indexOf('window.ensureFocPanel') !== -1, 'the window-exposure block must exist');
// The exposures now sit beside each feature (window.openFocListWeek=..., window.openFocShow=...) as well as in the
// block at the end, so look through the whole file. Inline JS in an attribute (onclick="if(...)") isn't a function name,
// and a function this file doesn't declare at all is the dashboard's own global (like openSettingsSection).
referenced.delete('if');
const declared = name => new RegExp('(^|\\n)\\s*(async\\s+)?function\\s+' + name + '\\(').test(src);
const missing = [...referenced].filter(name => declared(name) && !new RegExp('window\\.' + name + '\\s*=').test(src));
assert.deepEqual(missing, [], 'every function referenced by an onclick/onchange attribute in this file must be exposed onto window, or clicking/changing it throws a ReferenceError exactly like the store report');

// The specific functions named in the store report and found alongside it must be present by name.
for (const fn of ['quickAddFocSkuToInventory', 'focEbayBulkCheckboxChanged', 'toggleFocEbayBulkSelectAll', 'startFocEbayBulkListing', 'cancelFocEbayBulkListing', 'skipFocEbayBulkItem']) {
  assert.match(src, new RegExp('window\\.' + fn + '='), fn + ' must be exposed onto window');
}

console.log('FOC dashboard window-exposure contract checks passed');
