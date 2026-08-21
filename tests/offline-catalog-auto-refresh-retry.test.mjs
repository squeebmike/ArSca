import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// autoRefreshStaleCatalogs() is scheduled exactly once, 5s after the app
// boots -- on a device whose tab/PWA just stays open for days or weeks
// without a real reload (a phone left in kiosk mode, for example), that used
// to be the device's ONLY chance to ever re-sync: if navigator.onLine
// happened to read false at that one instant, it silently gave up for the
// rest of that entire session, even if the device came back online minutes
// later. Confirmed against a real device stuck on a 3-week-old MTG snapshot
// despite the daily cloud build having succeeded every single day in that
// window -- the fix is re-arming on the browser's own 'online' event so a
// later reconnect gets another shot.
assert.match(dashboard, /let _lastAutoRefreshAttempt = 0;/, 'must track the last auto-refresh attempt so the online-event retry can be cooldown-gated');
assert.match(dashboard, /async function autoRefreshStaleCatalogs\(\)\{\s*\n\s*if\(!navigator\.onLine\) return;\s*\n\s*_lastAutoRefreshAttempt = Date\.now\(\);/, 'the attempt timestamp must be recorded as soon as the function actually proceeds past the online check');

const bootFnStart = dashboard.indexOf('function applyResearchDefaultCategory()');
assert(bootFnStart >= 0, 'missing applyResearchDefaultCategory');
const bootFnEnd = dashboard.indexOf('\nfunction saveResearchSettingsFromForm', bootFnStart);
const bootFn = dashboard.slice(bootFnStart, bootFnEnd);

assert.match(bootFn, /setTimeout\(autoRefreshStaleCatalogs, 5000\);/, 'must still make the original 5s-after-load attempt');
assert.match(bootFn, /window\.addEventListener\('online', \(\) => \{\s*\n\s*if\(Date\.now\(\) - _lastAutoRefreshAttempt > 60000\) autoRefreshStaleCatalogs\(\);\s*\n\s*\}\);/, 'must re-attempt on reconnect, gated by a cooldown so a flapping connection cannot hammer the live manifest check on every blip');
assert.match(bootFn, /if\(!window\._autoRefreshOnlineListenerBound\)\{\s*\n\s*window\._autoRefreshOnlineListenerBound = true;/, 'the online listener must only ever be bound once, even though this boot function itself can run more than once (e.g. during the setup wizard) -- otherwise repeated boots would stack duplicate listeners');

console.log('Offline catalog auto-refresh retry checks passed');
