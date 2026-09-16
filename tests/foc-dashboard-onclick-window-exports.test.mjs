import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');

// scripts/foc-dashboard.js is one big IIFE -- every function it declares is
// private to that closure by default. An onclick="..."/onchange="..." HTML
// attribute string always resolves against the GLOBAL scope, not this
// closure, so a function is only reachable from one at all if it's also
// explicitly re-exposed onto window near the bottom of the file. Missing
// that re-export doesn't fail anything at page load or in a normal test --
// it only throws "X is not defined" the moment someone actually clicks the
// button, in production. This file's own comment documents six real eBay
// bulk-listing handlers that shipped broken this exact way in one pass
// (see the comment above the last window.* export line). This test is the
// general guard against that recurring mistake: every top-level function
// this file declares that is actually referenced from an onclick/onchange
// attribute must also be exported onto window somewhere in the file.

// Every function this file declares at the top level of its IIFE (the ones
// that need a window.* export to be reachable from HTML at all -- a
// function only ever called from other JS in this same closure needs no
// export).
const declaredFnNames = [...src.matchAll(/^(?:async )?function ([A-Za-z_$][\w$]*)\(/gm)].map(m => m[1]);
assert.ok(declaredFnNames.length > 20, `sanity check: expected dozens of top-level function declarations, found ${declaredFnNames.length} -- the regex above may not be matching this file's actual declaration style anymore`);

// Every onclick="..."/onchange="..." attribute value in the file, as raw
// text (these are built as JS string literals, e.g. "onclick=\"foo()\"" or
// with escaped quotes like onclick=\'foo()\' inside a larger template
// string -- matching greedily up to the next matching quote style used
// elsewhere in this file for these attributes).
const handlerAttrs = [...src.matchAll(/on(?:click|change)="([^"]*)"/g)].map(m => m[1]);

// esc() is the HTML-escaping helper this file's template strings call
// EVERYWHERE to interpolate a value into an onclick/onchange attribute,
// e.g. onclick="openFocCycle(\''+esc(c.id)+'\')" -- textually that call
// sits inside the "on(click|change)=\"...\"" span this test's raw-text
// regex captures, but it's JS string concatenation, not part of the
// literal runtime attribute value. esc is only ever called at template-
// build time from other JS in this closure, so it needs no window export.
const TEMPLATE_HELPER_NAMES = new Set(['esc']);

const missingExport = [];
for (const name of declaredFnNames) {
  if (TEMPLATE_HELPER_NAMES.has(name)) continue;
  const referenced = handlerAttrs.some(attr => new RegExp(`\\b${name}\\(`).test(attr));
  if (!referenced) continue; // never called from HTML at all -- no export needed
  const exported = new RegExp(`window\\.${name}\\s*=`).test(src);
  if (!exported) missingExport.push(name);
}

assert.deepEqual(missingExport, [], `these functions are called from an onclick/onchange attribute but never exported onto window, so every click on them throws "X is not defined" in production: ${missingExport.join(', ')}`);

console.log(`FOC dashboard onclick/window export checks passed (${declaredFnNames.length} declared functions checked)`);
