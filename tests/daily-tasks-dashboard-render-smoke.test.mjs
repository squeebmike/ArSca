import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const src = fs.readFileSync('scripts/daily-tasks-dashboard.js', 'utf8');

// Store report: "Uncaught (in promise) ReferenceError: esc is not defined"
// on the live TASKS tab. Every other test covering this file only checks
// raw text/strings -- none of them actually EXECUTE its render functions,
// so a real ReferenceError like this one (esc() called throughout, but
// never defined anywhere reachable -- dashboard.html's own global helper
// is escHtml, not esc, and foc-dashboard.js's own esc is private to its
// own IIFE, not shared across module files) never surfaced in any test,
// only in the browser. It also never surfaced against the live app until
// the storeId fix landed -- every request 400'd before render code ever
// ran. This test actually loads the file in a sandboxed VM context and
// drives a real render pass with real task data, so a ReferenceError like
// this one throws here instead of shipping again.

function makeFakeElement() {
  return { innerHTML: '', style: {}, textContent: '', dataset: {}, classList: { toggle(){}, add(){}, remove(){} } };
}

const panelEl = makeFakeElement();
const sandbox = {
  document: { getElementById: (id) => (id === 'daily-tasks-panel' ? panelEl : null), hidden: true },
  console,
  // No-op stand-ins for the sandbox's own periodic self-scheduling
  // (refreshDailyTasksBadge polling) -- real Node timers here would keep
  // this test process alive indefinitely (a real setInterval never resolves).
  setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  getActiveStoreId: () => 's1',
  currentRole: () => 'owner',
  toast_dash: () => {},
  storeWorkerFetch: async (path) => {
    if (!path.startsWith('/daily-tasks?')) throw new Error('unexpected path in this smoke test: ' + path);
    return {
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        ok: true, date: '2026-09-09', dayOfWeek: 3,
        roles: [{
          id: 'r1', name: 'Opener', sortOrder: 0,
          tasks: [{
            id: 't1', roleId: 'r1', title: 'Count drawer', detail: 'Count the cash drawer',
            daysOfWeek: [0, 1, 2, 3, 4, 5, 6], sortOrder: 0, active: true,
            assignedToUserId: null, assignedToLabel: '',
            dueToday: true, completed: false, completedBy: '', completedAt: null,
          }],
        }],
      }),
    };
  },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

assert.equal(typeof sandbox.ensureDailyTasksPanel, 'function', 'ensureDailyTasksPanel must be exposed on window for the dashboard tab-switch code to call');

// ensureDailyTasksPanel -> loadDailyTasks() is fire-and-forget (not
// returned), so flush the microtask queue a few times to let its
// await api(...) chain and the subsequent synchronous render actually run.
sandbox.ensureDailyTasksPanel();
for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0));

assert.ok(!panelEl.innerHTML.includes('Loading'), 'the panel must not still be stuck on the loading placeholder after the fetch resolves');
assert.ok(!panelEl.innerHTML.toLowerCase().includes('could not load'), `render must not have thrown/caught an error; got: ${panelEl.innerHTML.slice(0, 400)}`);
assert.ok(panelEl.innerHTML.includes('Opener'), `expected the rendered panel to include the fetched role name; got: ${panelEl.innerHTML.slice(0, 400)}`);
assert.ok(panelEl.innerHTML.includes('Count drawer'), `expected the rendered panel to include the fetched task title; got: ${panelEl.innerHTML.slice(0, 400)}`);

console.log('Daily tasks dashboard render smoke-test (actually executes render code) passed');
