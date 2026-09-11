import assert from 'node:assert/strict';
import fs from 'node:fs';

// research-loupe.js doesn't follow the inline-onclick="..." convention the
// other dashboard feature files use (see daily-tasks-window-exposure.test.mjs)
// -- it builds its own DOM at runtime and wires every internal control with
// addEventListener, so there's no window-exposure list to check. The only
// function dashboard.html's markup calls directly is window.openResearchLoupe;
// this test checks that contract plus a few structural invariants instead.

const src = fs.readFileSync('scripts/research-loupe.js', 'utf8');
const dashboardSrc = fs.readFileSync('dashboard.html', 'utf8');

assert.match(src.trimStart().replace(/^(\/\/[^\n]*\n)+/, ''), /^\(function\(\)\{/, 'this file must be a self-contained IIFE, same as the other scripts/*-dashboard.js files');

assert.match(src, /window\.openResearchLoupe\s*=/, 'window.openResearchLoupe must be assigned -- it is the only entry point dashboard.html calls');
assert.match(src, /window\.closeResearchLoupe\s*=/, 'window.closeResearchLoupe must be assigned so it can be called from outside the IIFE if ever needed');

assert.match(dashboardSrc, /onclick="openResearchLoupe\(\)"/, 'dashboard.html must have a button wired to openResearchLoupe()');
assert.match(dashboardSrc, /<script src="scripts\/research-loupe\.js/, 'dashboard.html must include the research-loupe.js script tag');

// The new LOUPE button must live in the same search row as the existing
// SCAN/MIC/barcode buttons -- not bolted on somewhere disconnected from
// Research's actual input controls.
const searchRowMatch = dashboardSrc.match(/id="qpl-search-row"[\s\S]*?<\/div>/);
assert.ok(searchRowMatch, 'expected to find the qpl-search-row container in dashboard.html');
assert.match(searchRowMatch[0], /openResearchLoupe\(\)/, 'the LOUPE button must be inside #qpl-search-row, alongside the existing SCAN/MIC/barcode buttons');

// Sanity: this file must not depend on a shared esc()/escHtml() helper that
// isn't actually in scope -- the exact bug daily-tasks-dashboard.js hit
// (see its own header comment). research-loupe.js never renders untrusted
// text via innerHTML (category option labels are cloned via DOM APIs, not
// string-interpolated), so it should never call an undefined escaping helper.
assert.doesNotMatch(src, /[^.\w]esc\(/, 'research-loupe.js should not call an esc() helper it never defines (see daily-tasks-dashboard.js store report for why this matters)');

// Cleanup contract: every getUserMedia stream this file opens must be
// stopped on close, or the camera/flashlight stays on after the user
// leaves Loupe.
assert.match(src, /getTracks\(\)\.forEach\(function\(t\)\{\s*t\.stop\(\);\s*\}\)/, 'stopLoupeCamera must stop every track on the stream');

console.log('Research Loupe structural contract checks passed');
