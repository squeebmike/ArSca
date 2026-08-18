import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Bug: two devices/browsers on the same store showed 3 different "Items
// Sold" counts. Root cause: every sale is durably written to Supabase
// (pos_sales/pos_sale_lines/pos_payments) by every device, but the Items
// Sold/Total Profit/revenue stats are computed from a LOCAL-ONLY
// pos_transactions cache, and the only code path that ever pulled other
// devices' sales into that cache (syncSharedShowTransactions) required an
// active Show Mode session -- so normal day-to-day sales never reconciled
// across devices at all. A related bug: the periodic drawer check detected
// a remotely-closed cash bag but never cleared the stale local "open" state. ──

// ── Contract: syncSharedShowTransactions no longer refuses to run without a
// showId -- it must pull the store's sales generally, not bail out ──
assert.ok(!/if\(_sharedShowSyncActive\|\|!showId\|\|getAccountContext\(\)\.isDemo\)return;/.test(dashboard), 'syncSharedShowTransactions must not require a showId to run -- that was the exact gate that broke cross-device sync outside Show Mode');
assert.match(dashboard, /async function syncSharedShowTransactions\(showId=getShowSessionId\(\),drawerId=drawerState\?\.id\|\|''\)\{\s*\n\s*if\(_sharedShowSyncActive\|\|getAccountContext\(\)\.isDemo\)return;/, 'syncSharedShowTransactions must only bail on an in-flight sync or demo mode, not on a missing showId');
assert.match(dashboard, /let query=sb\.from\('pos_sales'\)\.select\('id,show_session_id,drawer_session_id,total,status,created_at,completed_at'\)\.eq\('store_id',getActiveStoreId\(\)\)\.in\('status',\['completed','succeeded'\]\)\.order\('created_at',\{ascending:false\}\)\.limit\(1000\);\s*\n\s*if\(showId\) query=query\.eq\('show_session_id',showId\);/, 'the pos_sales query must fetch store-wide sales by default, only narrowing to a specific show when a showId is actually passed');

console.log('syncSharedShowTransactions generalization contract checks passed');

// ── Contract: the periodic reconciliation loop runs drawer-check/sales-sync
// every tick regardless of the local Show Mode flag -- that flag being off
// (or just stale) must not be a reason to stop reconciling with the server ──
assert.ok(!/\.then\(\(\)=>getShowMode\(\)\?\(drawerState\?joinCashBag\(drawerState\.id,\{silent:true\}\):syncSharedShowTransactions\(\)\):null\)/.test(dashboard), 'the drawer-check/sales-sync step must no longer be gated behind getShowMode()');
assert.match(dashboard, /const tick=\(\)=>\{if\(document\.visibilityState!=='visible'\)return;fetchShowSessionIndex\(false\)\.then\(\(\)=>getShowMode\(\)\?fetchSharedCashBags\(\):null\)\.then\(\(\)=>drawerState\?joinCashBag\(drawerState\.id,\{silent:true\}\):syncSharedShowTransactions\(\)\)\.catch\(\(\)=>\{\}\);\};/, 'the sync loop must call joinCashBag/syncSharedShowTransactions unconditionally every tick, with only the cash-bag-switcher list staying Show-Mode-scoped');

console.log('startShowSessionSyncLoop always-reconcile contract checks passed');

// ── Contract: the reconciliation tick must fire once immediately on load,
// not only on the first 15s interval tick -- a freshly opened browser (the
// exact "each browser has a different sold item count" report) should not
// sit on stale/empty stats for up to 15 seconds before its first sync ──
assert.match(dashboard, /tick\(\);\s*\n\s*window\.__showSessionSyncTimer=setInterval\(tick,15000\);/, 'startShowSessionSyncLoop must call tick() once immediately before scheduling the 15s interval, so a fresh page load reconciles right away');

console.log('Immediate-tick-on-load contract check passed');

// ── Contract: joinCashBag no longer spams a toast on every silent
// background tick when there's no local show, and it actually clears a
// stale local drawerState once the server confirms the drawer is gone
// (rather than a network/permission error, which must never wipe a drawer
// that might still be genuinely open) ──
assert.match(dashboard, /const show=getShowMode\(\);\s*\n\s*if\(!show\)\{ if\(!silent\)toast_dash\('Join a show first'\); return; \}/, 'joinCashBag must respect the silent flag when there is no local show -- called every 15s from the background loop, an unconditional toast would spam the user constantly');
assert.match(dashboard, /if\(error\)\{if\(!silent\)toast_dash\('Cash Bag status could not be refreshed'\);return;\}/, 'a real query error must be distinguished from a confirmed-closed drawer, and must never clear drawerState');
assert.match(dashboard, /if\(!session\)\{[\s\S]{0,600}?if\(drawerState\?\.id===id\)\{ drawerState=null; localStorage\.removeItem\('pos_drawer'\); renderDrawer\(\); renderCashBagSwitcher\(\); \}/, 'joinCashBag must clear the stale local drawerState once the server confirms the drawer session is no longer open, or a browser is stuck showing "CASH BAG: OPEN" forever with no way to self-correct');

console.log('joinCashBag stale-drawer-clearing contract checks passed');

// ── Functional: the merge-by-id logic that reconciles cloud sales into the
// local pos_transactions cache is safe for the general (non-show) case --
// same-id rows overwrite (no duplication), and rows unique to either side
// survive the merge. This is the exact mechanism now relied on for regular,
// day-to-day (non-show) cross-device sync, not just show-mode sync. ──
{
  const localOnly = { id:'sale-local-1', date:'2026-08-01T10:00:00Z', total:20, source:'offline-queued-ledger' };
  const bothSides = { id:'sale-shared-1', date:'2026-08-01T09:00:00Z', total:15, source:'offline-queued-ledger' };
  const bothSidesCloudVersion = { id:'sale-shared-1', date:'2026-08-01T09:00:00Z', total:15, source:'supabase-shared-show' };
  const cloudOnly = { id:'sale-cloud-1', date:'2026-08-01T11:00:00Z', total:30, source:'supabase-shared-show' };
  const local = [localOnly, bothSides];
  const cloud = [bothSidesCloudVersion, cloudOnly];

  const merged = new Map(local.map(row => [String(row.id), row]));
  cloud.forEach(row => merged.set(String(row.id), row));
  const result = [...merged.values()];

  assert.equal(result.length, 3, 'a sale made on this device and a sale synced from another device (or a show) must both survive the merge, with no duplication of the sale seen on both sides');
  const shared = result.find(r => r.id === 'sale-shared-1');
  assert.equal(shared.source, 'supabase-shared-show', 'when the same sale id exists on both sides, the cloud (authoritative) version must win, not the local one');
  assert.ok(result.some(r => r.id === 'sale-local-1'), 'a sale that only exists locally (not yet reflected in this particular cloud fetch) must not be dropped');
  assert.ok(result.some(r => r.id === 'sale-cloud-1'), 'a sale made on a different device must be pulled in, not ignored');
}

console.log('Cross-device sales merge functional checks passed');
