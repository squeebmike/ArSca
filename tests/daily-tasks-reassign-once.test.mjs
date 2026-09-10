import assert from 'node:assert/strict';
import { handleDailyTasksRequest } from '../scripts/daily-tasks.mjs';

function mockDeps(overrides = {}) {
  const calls = [];
  const db = async (path, opts) => {
    calls.push({ path, opts });
    if (overrides.dbHandler) { const r = overrides.dbHandler(path, opts); if (r !== undefined) return r; }
    return { data: [] };
  };
  const requireStoreUserCalls = [];
  return {
    calls,
    requireStoreUserCalls,
    deps: {
      json: (body, status = 200) => ({ status, body }),
      supabaseAdminFetch: (env, path, opts) => db(path, opts),
      readJsonWithLimit: async (request) => ({ data: await request.json() }),
      requireStoreUser: async (request, env, storeId, allowedRoles) => {
        requireStoreUserCalls.push({ storeId, allowedRoles });
        return { user: { id: 'u1', email: 'staff@example.com' }, role: 'employee', token: 't' };
      },
    },
  };
}
function fakeRequest(body) { return { method: 'POST', headers: new Map(), json: async () => body }; }

// ── Covering a task for just today writes an override row, not a permanent reassignment ──
{
  const { deps, calls } = mockDeps();
  const res = await handleDailyTasksRequest(
    fakeRequest({ storeId: 's1', taskId: 't1', date: '2026-09-09', userId: 'u9', label: 'Jaccob' }),
    {}, new URL('https://x.test/daily-tasks/reassign-once'), deps,
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.reassigned, true);
  const write = calls.find(c => c.path === 'daily_task_overrides' && c.opts?.method === 'POST');
  assert.ok(write, 'covering a task must write to daily_task_overrides, not daily_task_items');
  const [row] = JSON.parse(write.opts.body);
  assert.equal(row.task_id, 't1');
  assert.equal(row.task_date, '2026-09-09');
  assert.equal(row.assigned_to_user_id, 'u9');
  assert.equal(row.assigned_to_label, 'Jaccob');
}

// ── Clearing the cover (no userId) deletes the override for that date only ──
{
  const { deps, calls } = mockDeps();
  const res = await handleDailyTasksRequest(
    fakeRequest({ storeId: 's1', taskId: 't1', date: '2026-09-09', userId: '' }),
    {}, new URL('https://x.test/daily-tasks/reassign-once'), deps,
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.reassigned, false);
  const del = calls.find(c => c.opts?.method === 'DELETE');
  assert.ok(del, 'clearing a cover must delete the override row');
  assert.match(del.path, /task_id=eq\.t1/);
  assert.match(del.path, /task_date=eq\.2026-09-09/);
}

// ── Permission floor: same as checking a task off -- any working staff, not admin-only ──
{
  const { deps, requireStoreUserCalls } = mockDeps();
  await handleDailyTasksRequest(fakeRequest({ storeId: 's1', taskId: 't1', date: '2026-09-09', userId: 'u9', label: 'Jaccob' }), {}, new URL('https://x.test/daily-tasks/reassign-once'), deps);
  assert.equal(requireStoreUserCalls[0].allowedRoles, undefined, 'covering a task for the day must use the default (all working-staff) permission floor');
}

// ── The read path surfaces an override on top of the item's own default assignee ──
{
  const { deps } = mockDeps({
    dbHandler: (path) => {
      if (path.startsWith('daily_task_roles')) return { data: [{ id: 'r1', store_id: 's1', name: 'Sean', sort_order: 0 }] };
      if (path.startsWith('daily_task_items')) return { data: [{ id: 't1', store_id: 's1', role_id: 'r1', title: 'Ship orders', detail: '', days_of_week: [0, 1, 2, 3, 4, 5, 6], cadence: 'daily', sort_order: 0, active: true, assigned_to_user_id: 'sean-id', assigned_to_label: 'Sean' }] };
      if (path.startsWith('daily_task_completions')) return { data: [] };
      if (path.startsWith('daily_task_overrides')) return { data: [{ task_id: 't1', assigned_to_user_id: 'jaccob-id', assigned_to_label: 'Jaccob' }] };
    },
  });
  const res = await handleDailyTasksRequest({ method: 'GET', headers: new Map() }, {}, new URL('https://x.test/daily-tasks?store_id=s1&date=2026-09-09'), deps);
  const task = res.body.roles[0].tasks[0];
  assert.equal(task.assignedToUserId, 'jaccob-id', 'today\'s effective assignee must be the override, not the default');
  assert.equal(task.assignedToLabel, 'Jaccob');
  assert.equal(task.reassignedToday, true);
  assert.equal(task.defaultAssignedToUserId, 'sean-id', 'the permanent default must still be reported for the UI to show "normally Sean"');
  assert.equal(task.defaultAssignedToLabel, 'Sean');
}

console.log('Daily tasks reassign-once checks passed');
