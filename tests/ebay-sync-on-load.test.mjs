import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Real incident: a store owner sold a comic on eBay, opened the dashboard to
// check it, and saw nothing -- three separate times. syncEbayOrders() was
// only ever triggered by a fixed 5-minute setInterval, which never fires on
// a fresh page load (setInterval waits a full interval before its first
// tick) or on the realistic mobile pattern of opening the dashboard app
// briefly, looking, then closing it well within 5 minutes. The interval was
// a real safety net, but never the thing that actually shows a just-made
// sale to someone who opens the dashboard specifically to check on it --
// the fix is to sync immediately on load and again whenever the tab/app
// regains visibility, not only on the timer.

const intervalIdx = dashboard.indexOf("setInterval(() => { if(!document.hidden) syncEbayOrders(true); }, 5 * 60000);");
assert.notEqual(intervalIdx, -1, 'the periodic eBay sync interval must still exist as a backstop');

const afterInterval = dashboard.slice(intervalIdx, intervalIdx + 700);
assert.match(afterInterval, /\nsyncEbayOrders\(true\);/, 'must sync immediately on script load, not wait for the first 5-minute tick');
assert.match(afterInterval, /document\.addEventListener\('visibilitychange', \(\) => \{ if\(!document\.hidden\) syncEbayOrders\(true\); \}\);/, 'must re-sync when the tab/app becomes visible again, covering the realistic "open dashboard, check, close" mobile pattern the fixed timer alone misses');

console.log('eBay sync-on-load/visibility checks passed');
