import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Supabase Free Plan overage (2026-10-27): one dashboard left open overnight
// sent ~74,000 database requests in a day -- the whole sales history every
// 15 seconds, the inventory every minute. Background refreshes now pause
// after 10 minutes without a touch and catch up on the next one; the
// store-wide sales pull runs at most once a minute.
const ui = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
const cut = (from, to) => { const a = ui.indexOf(from), b = ui.indexOf(to, a); assert.ok(a >= 0 && b > a, 'missing ' + from); return ui.slice(a, b); };

// ── Idle tracking ──
{
  let now = 1_000_000;
  const listeners = {}, calls = { show: 0, inv: 0 };
  const ctx = {
    Date: { now: () => now }, document: { hidden: false },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    setTimeout: fn => fn(),
    syncShowModeFromWorker: async () => { calls.show++; }, refreshInventoryQuietly: () => { calls.inv++; },
  };
  vm.createContext(ctx);
  vm.runInContext(cut('const DASHBOARD_IDLE_MS', 'let ts={col') + ';this.dashboardIdle=dashboardIdle;', ctx);
  assert.equal(ctx.dashboardIdle(), false, 'active when opened');
  now += 9 * 60 * 1000;
  assert.equal(ctx.dashboardIdle(), false, 'still active at 9 minutes');
  now += 2 * 60 * 1000;
  assert.equal(ctx.dashboardIdle(), true, 'idle after 10 minutes untouched');
  for (const t of ['pointerdown', 'keydown', 'touchstart', 'wheel']) assert.ok(listeners[t], t + ' counts as activity');
  listeners.touchstart();
  assert.equal(ctx.dashboardIdle(), false, 'a touch wakes it');
  assert.deepEqual(calls, { show: 1, inv: 1 }, 'and catches up at once');
  listeners.pointerdown();
  assert.deepEqual(calls, { show: 1, inv: 1 }, 'touches while active trigger nothing extra');
}

// ── Store-wide sales pull: at most once a minute ──
{
  let now = 5_000_000, pulls = 0;
  const ctx = { Date: { now: () => now }, syncSharedShowTransactions: async () => { pulls++; } };
  vm.createContext(ctx);
  vm.runInContext(cut('let lastStoreSalesSyncAt = 0;', '\n}\n') + '\n}\nthis.syncStoreSalesThrottled=syncStoreSalesThrottled;', ctx);
  for (let i = 0; i < 4; i++) { await ctx.syncStoreSalesThrottled(); now += 15000; } // four 15s ticks
  assert.equal(pulls, 1, 'four 15-second ticks, one full sales pull');
  now += 1000;
  await ctx.syncStoreSalesThrottled();
  assert.equal(pulls, 2, 'the next minute pulls again');
}

// ── Wiring ──
assert.match(ui, /const tick=\(\)=>\{if\(document\.visibilityState!=='visible'\|\|dashboardIdle\(\)\)return;/, 'the 15s show/sales tick pauses while idle');
assert.match(ui, /setInterval\(\(\) => \{ if\(!dashboardIdle\(\)\) refreshInventoryQuietly\(\); \}, 60000\);/, 'the inventory refresh pauses while idle');
assert.match(ui, /if\(!document\.hidden && !dashboardIdle\(\)\)\{ fetchBuyListFromWorker\(\); fetchBuyTrayIndex\(\); \}/, 'the buy tray refresh pauses while idle');
assert.match(ui, /setInterval\(\(\) => \{ if\(shouldPollTab\('display'\)\) renderCustomerDisplay\(\); \}, 3000\);/, 'the customer display keeps refreshing -- nobody touches that screen');
assert.equal((ui.match(/await syncSharedShowTransactions\(\)\.catch\(\(\)=>\{\}\);/g) || []).length, 1, 'only the throttled wrapper runs the store-wide pull');
console.log('dashboard idle polling checks passed');
