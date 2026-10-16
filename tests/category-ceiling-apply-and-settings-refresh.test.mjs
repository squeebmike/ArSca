import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store asks: "refresh pokemon inventory to use this rule -- the ones in
// stock" and "these shouldn't be device rules, but all devices on this store."
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const extractFn = (name, prefix = 'function ') => { const s = dashboard.indexOf(prefix + name + '('); assert.ok(s >= 0, name); return dashboard.slice(s, dashboard.indexOf('\n}\n', s) + 2); };

assert.match(extractFn('renderVendorConfigPanel'), /onclick="applyCategoryPriceRuleToStock\('\$\{safe\}'\)">APPLY TO IN-STOCK<\/button>/);
assert.match(extractFn('renderVendorConfigPanel'), /onclick="clearCategoryPriceRuleFromStock\('\$\{safe\}'\)">CLEAR<\/button>/);
assert.match(extractFn('renderVendorConfigPanel'), /Saved for the whole store, so every device uses it/);

// Store settings re-read from the cloud: forced when Settings opens, quiet
// (no redraw) when the app comes back to the foreground.
{
  const fn = extractFn('refreshStoreSettingsFromCloud', 'async function ');
  assert.match(fn, /supabaseStoreSettingsLoaded = false;\s*try \{ await loadStoreSettingsFromSupabase\(\); \}/);
  assert.match(fn, /if\(!force && Date\.now\(\) - _storeSettingsRefreshedAt < 120000\) return;/);
}
assert.match(dashboard, /document\.addEventListener\('visibilitychange', \(\) => \{ if\(document\.visibilityState === 'visible'\) refreshStoreSettingsFromCloud\(\); \}\);/);
assert.match(extractFn('switchTab'), /if\(name === 'backoffice'\) setTimeout\(\(\) => refreshStoreSettingsFromCloud\(\{ force:true, redraw:true \}\), 0\);/);
console.log('Category ceiling apply + settings refresh checks passed');
