import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Boot sequence: independent cloud syncs must run in parallel ──────────
// These five calls used to each be awaited one at a time on the 'load'
// listener -- none of them reads state another one writes (each touches its
// own localStorage key and its own Supabase table/KV key), so stacking them
// sequentially just summed up their round trips before the Overview tab
// ever got real numbers. They must run together via Promise.all instead.

const bootListener = dashboard.match(/window\.addEventListener\('load', async function\(\)\{[\s\S]*?\n\}\);/)?.[0];
assert.ok(bootListener, 'could not find the boot load listener');

assert.match(bootListener, /Promise\.all\(\[\s*\n\s*loadStoreSettingsFromSupabase\(\),\s*\n\s*loadConsignmentsFromCloud\(\),\s*\n\s*loadPriceChangeAlertsFromCloud\(\),\s*\n\s*syncShowModeFromWorker\(\),\s*\n\s*syncStoreCreditsFromWorker\(\),\s*\n\s*syncLifecycleFromWorker\(\),\s*\n\s*\]\)/, 'boot must run the independent cloud syncs together via Promise.all, not one at a time');
assert.match(bootListener, /\.then\(renderShowMode\)\.finally\(loadInventory\)/, 'loadInventory must only start once the whole sync batch settles (it reads lifecycle data synchronously while building each item)');

// The app shell (theme) and the user's chosen landing tab must not wait on
// any of those network calls -- both are safe to do the instant auth is
// confirmed, so they must appear before the Promise.all in source order.
const shellIdx = bootListener.indexOf('setupAppShell();');
const landingIdx = bootListener.indexOf('switchTab(getDefaultLandingTab());');
const syncIdx = bootListener.indexOf('Promise.all([');
assert.ok(shellIdx >= 0 && landingIdx >= 0 && syncIdx >= 0, 'missing expected boot calls');
assert.ok(shellIdx < syncIdx, 'setupAppShell must run before the cloud-sync batch, not after');
assert.ok(landingIdx < syncIdx, 'switchTab(getDefaultLandingTab()) must run before the cloud-sync batch, not after');

console.log('Boot sequence parallelization checks passed');

// ── renderAll(): heavy off-screen work must be deferrable ────────────────
// Only the Overview tab's own elements (stats/cats/top-val/feed) need to be
// ready synchronously for the initial paint; the inventory table, sold
// table, channel/monthly charts, and health/analytics panels all render
// into tabs that aren't visible yet on first load.

assert.match(dashboard, /function renderAll\(opts\)\{/, 'renderAll must accept an opts param for deferHeavy');
assert.match(dashboard, /const deferHeavy = opts && opts\.deferHeavy === true;/, 'renderAll must read a deferHeavy flag');
assert.match(dashboard, /if\(deferHeavy\) setTimeout\(renderHeavy, 0\);\s*\n\s*else renderHeavy\(\);/, 'renderAll must only defer the heavy render when explicitly asked to');

// The three initial/refresh load call sites must opt into deferHeavy; every
// other renderAll() caller (30+ call sites elsewhere, after edits/sales/
// syncs) must be untouched and stay fully synchronous.
const deferredCallCount = (dashboard.match(/renderAll\(\{ deferHeavy:true \}\);/g) || []).length;
assert.equal(deferredCallCount, 3, 'exactly the 3 load-inventory call sites (demo, Webflow-direct, configured-source) must opt into deferHeavy');

console.log('renderAll deferHeavy checks passed');

// ── Default landing tab (per-device) ──────────────────────────────────
assert.match(dashboard, /const LANDING_TAB_OPTIONS = \[/, 'missing LANDING_TAB_OPTIONS');
assert.match(dashboard, /function getDefaultLandingTab\(\)\{/, 'missing getDefaultLandingTab');
assert.match(dashboard, /function setDefaultLandingTab\(tab\)\{/, 'missing setDefaultLandingTab');
assert.match(dashboard, /localStorage\.getItem\('default_landing_tab_v1'\)/, 'default landing tab must be read from localStorage (per-device, not synced)');
assert.match(dashboard, /localStorage\.setItem\('default_landing_tab_v1', t\)/, 'default landing tab must persist to localStorage');
assert.match(dashboard, /id="default-landing-tab-select"[^>]*onchange="setDefaultLandingTab\(this\.value\)"/, 'missing the Default Tab On Open select control');

console.log('Default landing tab contract checks passed');

// ── Functional check: getDefaultLandingTab + setDefaultLandingTab ──────
{
  const optionsSrc = dashboard.match(/const LANDING_TAB_OPTIONS = \[[\s\S]*?\n\];/)?.[0];
  const getSrc = dashboard.match(/function getDefaultLandingTab\(\)\{[\s\S]*?\n\}/)?.[0];
  const setSrc = dashboard.match(/function setDefaultLandingTab\(tab\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(optionsSrc && getSrc && setSrc, 'could not extract landing-tab functions for functional testing');

  const store = {};
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
  };

  const { getDefaultLandingTab, setDefaultLandingTab } = new Function('localStorage', `
    ${optionsSrc}
    ${getSrc}
    ${setSrc}
    return { getDefaultLandingTab, setDefaultLandingTab };
  `)(localStorage);

  assert.equal(getDefaultLandingTab(), 'overview', 'default landing tab must be Overview when nothing is saved');

  setDefaultLandingTab('research');
  assert.equal(store.default_landing_tab_v1, 'research', 'setDefaultLandingTab must persist the chosen tab');
  assert.equal(getDefaultLandingTab(), 'research', 'getDefaultLandingTab must read back the persisted tab');

  setDefaultLandingTab('not-a-real-tab');
  assert.equal(store.default_landing_tab_v1, 'overview', 'an unknown tab id must fall back to overview rather than corrupt state');
}

console.log('Default landing tab functional checks passed');
