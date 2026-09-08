import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync('scripts/card-intake-dashboard.js', 'utf8');

// Same IIFE-exposure contract as foc-dashboard.js (see
// tests/foc-dashboard-window-exposure.test.mjs for the original store
// report this pattern comes from) -- every onclick/onchange handler this
// file's own HTML references must be re-exposed onto window in the block
// at the end of the file, or the button just throws when clicked.

assert.match(src.trimStart().replace(/^(\/\/[^\n]*\n)+/, ''), /^\(function\(\)\{/, 'this file must be a self-contained IIFE (after its header comment block), same as foc-dashboard.js');

const onclickNames = [...src.matchAll(/onclick="([a-zA-Z_$][a-zA-Z0-9_$]*)\(/g)].map(m => m[1]);
const onchangeNames = [...src.matchAll(/onchange="([a-zA-Z_$][a-zA-Z0-9_$]*)\(/g)].map(m => m[1]);
const referenced = new Set([...onclickNames, ...onchangeNames]);

assert.ok(referenced.size > 10, 'sanity check: this file must reference a substantial number of onclick/onchange handlers');

const exposureBlockStart = src.indexOf('window.ensureCardIntakePanel');
assert.ok(exposureBlockStart !== -1, 'the window-exposure block must exist');
const exposureBlock = src.slice(exposureBlockStart);

const missing = [...referenced].filter(name => !exposureBlock.includes('window.' + name + '='));
assert.deepEqual(missing, [], 'every function referenced by an onclick/onchange attribute must be exposed onto window');

console.log('Card intake dashboard window-exposure contract checks passed');
