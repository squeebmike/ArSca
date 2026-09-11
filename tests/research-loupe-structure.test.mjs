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

// Store request: "I need the zoom to remember where it was last... so I
// can leave it zoomed to see set numbers better." Guards against the
// original behavior (stopLoupeCamera hard-reset state.zoomLevel to 1 on
// every close) regressing back in.
const stopFnMatch = src.match(/function stopLoupeCamera\([\s\S]*?\n\}/);
assert.ok(stopFnMatch, 'expected to find stopLoupeCamera');
assert.doesNotMatch(stopFnMatch[0], /state\.zoomLevel\s*=\s*1\b/, 'stopLoupeCamera must not reset the remembered zoom level back to 1x on every close');
assert.match(src, /applyZoom\(state\.zoomLevel\)/, 'startLoupeCamera must reapply the remembered zoom level to each newly-opened camera track');
assert.match(src, /savePrefs\(\{\s*zoom:\s*level\s*\}\)/, 'applyZoom must persist the chosen zoom level so it survives closing and reopening Loupe');
assert.match(src, /localStorage\.getItem\(PREFS_KEY\)/, 'zoom/magnification preferences must be read from localStorage on load');
assert.match(src, /catch\(e\)\{\s*return \{\};\s*\}/, 'reading persisted prefs must degrade gracefully (private browsing / storage blocked), not throw');

// Store request: "if I open the loupe, the camera should already be on"
// -- no separate "enable camera" tap. Guards against the original
// permission-ceremony screen (a full-text "Camera access is needed..."
// CTA shown before ever attempting getUserMedia) regressing back in.
const openFnMatch = src.match(/function openResearchLoupe\(\)\{[\s\S]*?\n\}/);
assert.ok(openFnMatch, 'expected to find openResearchLoupe');
assert.match(openFnMatch[0], /startLoupeCamera\(\)/, 'openResearchLoupe must start the camera itself, not wait for a separate enable button');
assert.doesNotMatch(src, /Camera access is needed/, 'must not show a pre-permission ceremony screen before ever attempting getUserMedia');
assert.doesNotMatch(src, /ENABLE CAMERA/, 'there must be no separate "enable camera" tap -- opening Loupe starts the camera directly');

// Store request: "pressing the back button should close the loupe."
assert.match(src, /history\.pushState\(\{\s*rloupeOpen:\s*true\s*\}/, 'opening Loupe must push a history entry so the back button has something to consume');
assert.match(src, /addEventListener\('popstate'/, 'must listen for popstate so the back/gesture-back button closes Loupe');
assert.match(src, /function requestCloseResearchLoupe\(\)\{\s*if\(historyPushed\)\{\s*historyPushed = false;\s*history\.back\(\);/, 'the UI close path (X button, header close, tap-outside) must go through history.back(), the same path the hardware back button uses -- not a separate close routine');

// Store request: "I shouldn't have words on the screen where I'm looking
// at things... you should have a close button on there as well." -- an
// icon-only close control overlaid on the camera itself, not a text label.
assert.match(src, /class="rloupe-x"[^>]*>✕</, 'the camera view must have its own icon-only (not text) close control');

// Store report: "can't get to the mic button unless scroll first" -- a
// fixed aspect-ratio camera box could grow taller than the viewport.
// Guards the fix: the camera flexes/caps instead of forcing a ratio, and
// the input/mic row is pinned so it can't be scrolled out of reach.
assert.doesNotMatch(src, /rloupe-camera\{[^}]*aspect-ratio/, 'the camera box must not use a fixed aspect-ratio -- it grows unbounded and can push the mic row off-screen');
assert.match(src, /rloupe-camera\{[^}]*max-height:/, 'the camera box must cap its own height so the rest of the sheet always has room');
assert.match(src, /rloupe-input-row\{[^}]*position:sticky/, 'the input/mic row must stay pinned within the sheet, not scroll out of reach');

// Store report: "said try again right away, and the button doesn't turn
// on camera" -- once a browser blocks camera access for a site, no page
// script can reopen that permission prompt, so a plain "try again" is
// actively misleading. Guards that a confirmed block gets real
// instructions instead, with the retry button repurposed to a reload
// (the actual next step once the user fixes the block in browser settings).
assert.match(src, /async function handleCameraStartError/, 'camera start failures must be triaged, not shown a single generic message');
assert.match(src, /permState === 'denied'/, 'must distinguish a confirmed block (Permissions API) from a not-yet-asked prompt');
assert.match(src, /dom\.retryBtn\.dataset\.action = blocked \? 'reload' : 'retry'/, 'the retry control must become a reload action once the block is confirmed, not keep offering a retry that cannot work');

console.log('Research Loupe structural contract checks passed');
