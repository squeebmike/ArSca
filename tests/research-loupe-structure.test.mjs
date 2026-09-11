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

// Store report: "I still see try again button even though I see the
// camera feed darkened behind it" -- a slow/stale startLoupeCamera() call
// resolving after a newer one had already succeeded was re-showing the
// error panel on a working camera. Guards the generation-counter fix.
assert.match(src, /var cameraAttemptId = 0;/, 'must track a generation counter to detect a superseded camera-start attempt');
assert.match(src, /var attemptId = \+\+cameraAttemptId;/, 'startLoupeCamera must capture its own attempt id at the start');
const startFnMatch = src.match(/async function startLoupeCamera\(\)\{[\s\S]*?\n\}\n\nfunction stopLoupeCamera/);
assert.ok(startFnMatch, 'expected to find startLoupeCamera');
const staleChecks = (startFnMatch[0].match(/attemptId !== cameraAttemptId/g) || []).length;
assert.ok(staleChecks >= 3, `startLoupeCamera must check staleness after every await (getUserMedia, applyContinuousAutofocus, video.play) -- found ${staleChecks}, expected at least 3`);

// Store request: "category picker should be the scrolling thing we have
// in research tab." The real #qpl-cat-wheel element must be relocated
// (moved, not cloned) into Loupe and back -- reusing its own already-wired
// onclick/onscroll handlers rather than inventing a second category model.
assert.match(src, /function relocateCategoryWheel\(\)\{/, 'must relocate the real category wheel into the Loupe sheet');
assert.match(src, /function restoreCategoryWheel\(\)\{/, 'must restore the category wheel to its original position on close');
assert.match(src, /getElementById\('qpl-cat-wheel'\)/, 'must move the actual #qpl-cat-wheel element, not a clone of its options');
assert.doesNotMatch(src, /createElement\('option'\)/, 'must not clone <option> elements into a second category control anymore');

// Store request: "I can't get to the close button" -- guards that the
// header (and its CLOSE button) is pinned within the sheet's own scroll
// area, so it can never end up scrolled out of the visible viewport.
assert.match(src, /rloupe-head\{[^}]*position:sticky/, 'the header/close button must be sticky within the sheet so it is always reachable');

// Store request: "place the category picker in the open space next to
// loupe button" -- the wheel's slot must live inside the controls row
// (alongside the LOUPE toggle), not as its own separate row above the
// camera anymore.
const controlsBlockMatch = src.match(/'<div class="rloupe-controls">'[\s\S]*?rloupe-input-row/);
assert.ok(controlsBlockMatch, 'expected to find the rloupe-controls markup block');
assert.match(controlsBlockMatch[0], /rloupe-cat-slot/, 'the category wheel slot must be inside the controls row, next to the LOUPE toggle');
assert.doesNotMatch(src, /rloupe-cat-row/, 'the old separate category row must be gone');

// Store report: "still darkened, I can see the camera behind it" -- an
// unexpectedly-ended track must attempt a silent recovery before handing
// the user a full error panel, capped so a truly dead camera doesn't
// restart-loop forever.
assert.match(src, /var endedRestartCount = 0;/, 'must track consecutive silent recoveries so a dead camera does not loop forever');
const endedHandlerMatch = src.match(/state\.track\.addEventListener\('ended', function\(\)\{[\s\S]*?\}\);/);
assert.ok(endedHandlerMatch, 'expected to find the track "ended" handler');
assert.match(endedHandlerMatch[0], /endedRestartCount >= 3/, 'the ended handler must cap silent restarts rather than looping indefinitely');
assert.match(endedHandlerMatch[0], /startLoupeCamera\(\);\s*\n\s*\}\);/, 'below the cap, the ended handler must attempt a silent restart, not immediately show an error');
assert.match(src, /endedRestartCount = 0; \/\/ a track that's actually live resets the recovery budget/, 'a successful start must reset the recovery budget');

// Store question: "why close button and an X?" -- two close controls was
// leftover confusion from an earlier (mistaken) diagnosis; the icon on
// the camera is the one real close control now, not a second header button.
assert.doesNotMatch(src, /rloupe-close/, 'the redundant header CLOSE text button must be gone -- the camera\'s icon X is the only close control');
assert.match(src, /class="rloupe-x"/, 'the icon close control on the camera must still exist');

// Store report: "why is it TRY AGAIN even though I see camera?" -- shown
// again despite the generation-id and silent-restart fixes, so showError
// itself now has a hard invariant: it must never render the error/retry
// panel while the camera is actually running, regardless of which code
// path called it or why.
const showErrorFnMatch = src.match(/function showError\(msg, blocked\)\{[\s\S]*?\n\}/);
assert.ok(showErrorFnMatch, 'expected to find showError');
assert.match(showErrorFnMatch[0], /var shouldShow = !!msg && !state\.started;/, 'showError must refuse to display anything while state.started is true');
assert.match(showErrorFnMatch[0], /dom\.errorBox\.hidden = !shouldShow;/, 'the error box visibility must be driven by the started-aware shouldShow, not the raw message alone');

// The capped-restart branch relies on stopLoupeCamera() running BEFORE
// showError() so state.started is already false by the time the
// invariant above checks it -- calling them in the other order would
// silently swallow this specific error again.
const cappedBranchMatch = src.match(/if\(endedRestartCount >= 3\)\{[\s\S]*?\n      \}/);
assert.ok(cappedBranchMatch, 'expected to find the capped-restart branch');
const stopIdx = cappedBranchMatch[0].indexOf('stopLoupeCamera()');
const errIdx = cappedBranchMatch[0].indexOf('showError(');
assert.ok(stopIdx !== -1 && errIdx !== -1 && stopIdx < errIdx, 'stopLoupeCamera() must run before showError() in the capped-restart branch, or the error gets silently swallowed by the started-check invariant');

console.log('Research Loupe structural contract checks passed');
