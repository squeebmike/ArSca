import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store report: a tablet left open all day at a show booth never noticed
// when the show was renamed or closed on another device. startShowSessionSyncLoop
// runs a tick every 15s specifically so cross-device state doesn't depend on
// a page reload or tab-focus event -- but the tick only ever called
// fetchShowSessionIndex (refreshes the JOIN switcher list) and
// fetchSharedCashBags, never syncShowModeFromWorker, the one function that
// actually pulls the CURRENTLY-JOINED show's own live status/fields back
// into pos_show_mode. That function only ran on page load and
// visibilitychange -- and a tablet simply left foregrounded never fires
// visibilitychange -- so a closed/renamed show could go unnoticed
// indefinitely on that device with no error surfaced (its own network
// failure path is a silent catch).
assert.match(dashboard, /function startShowSessionSyncLoop\(\)\{/, 'missing startShowSessionSyncLoop');
{
  const fnStart = dashboard.indexOf('function startShowSessionSyncLoop(){');
  const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
  const fn = dashboard.slice(fnStart, fnEnd);
  assert.match(fn, /const tick=\(\)=>\{if\(document\.visibilityState!=='visible'\)return;syncShowModeFromWorker\(\)\.then\(\(\)=>drawerState\?joinCashBag\(drawerState\.id,\{silent:true\}\):null\)\.catch\(\(\)=>\{\}\);\};/,
    'the 15s tick must call syncShowModeFromWorker (the function that actually refreshes the joined show\'s live status), not just the narrower index/cash-bag calls it used to');
  assert.doesNotMatch(fn, /fetchShowSessionIndex\(false\)\.then\(\(\)=>getShowMode\(\)\?fetchSharedCashBags\(\)/,
    'must not still have the old tick body that skipped syncShowModeFromWorker entirely');
}

console.log('startShowSessionSyncLoop live-sync contract check passed');

// syncShowModeFromWorker must still run general (non-show-scoped) sales
// reconciliation even when no show is currently joined, since the tick loop
// now delegates entirely to this function and general reconciliation must
// keep happening "regardless of Show Mode" per the function's own existing
// contract (previously this only happened via the tick's own separate
// branch, which is now gone).
assert.match(dashboard, /function syncShowModeFromWorker\(\)\{/, 'missing syncShowModeFromWorker');
{
  const fnStart = dashboard.indexOf('function syncShowModeFromWorker(){', dashboard.indexOf('async function syncShowModeFromWorker'));
  const asyncStart = dashboard.indexOf('async function syncShowModeFromWorker(){');
  const realStart = asyncStart > -1 ? asyncStart : fnStart;
  const fnEnd = dashboard.indexOf('\n}', realStart) + 2;
  const fn = dashboard.slice(realStart, fnEnd);
  assert.match(fn, /if\(!selected\?\.id\)\{ renderShowMode\(\); await syncSharedShowTransactions\(\)\.catch\(\(\)=>\{\}\); return; \}/,
    'the no-show-joined early return must still run general sales reconciliation, now that the tick loop relies on this function alone');
}

console.log('syncShowModeFromWorker no-show-joined reconciliation contract check passed');
