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
        if (overrides.authError) return { error: { status: 403, body: { ok: false, error: 'nope' } } };
        return { user: { id: 'u1', email: 'staff@example.com' }, role: overrides.role || 'employee', token: 't' };
      },
    },
  };
}
function fakeRequest(body) {
  return { method: 'POST', headers: new Map(), json: async () => body };
}

// ── Route table sanity ────────────────────────────────────────────────────
{
  const routePaths = [
    ['/daily-tasks', 'GET'], ['/daily-tasks/roles', 'POST'], ['/daily-tasks/roles', 'PATCH'],
    ['/daily-tasks/roles', 'DELETE'], ['/daily-tasks/items', 'POST'], ['/daily-tasks/items', 'PATCH'],
    ['/daily-tasks/items', 'DELETE'], ['/daily-tasks/complete', 'POST'],
  ];
  for (const [path, method] of routePaths) {
    const { deps } = mockDeps();
    const req = { method, headers: new Map(), json: async () => ({}) };
    const url = new URL('https://x.test' + path + '?store_id=s1&id=i1');
    const res = await handleDailyTasksRequest(req, {}, url, deps);
    assert.notEqual(res.status, 404, `${method} ${path} must be a wired route`);
  }
}
console.log('Daily tasks route table checks passed');

// ── Day-of-week filtering: dueToday must reflect the requested date's DOW ─
{
  const { deps } = mockDeps({
    dbHandler: (path) => {
      if (path.startsWith('daily_task_roles')) return { data: [{ id: 'r1', store_id: 's1', name: 'Opener', sort_order: 0 }] };
      if (path.startsWith('daily_task_items')) return {
        data: [
          { id: 't1', store_id: 's1', role_id: 'r1', title: 'Everyday task', detail: '', days_of_week: [0, 1, 2, 3, 4, 5, 6], sort_order: 0, active: true },
          { id: 't2', store_id: 's1', role_id: 'r1', title: 'Sunday-only task', detail: '', days_of_week: [0], sort_order: 1, active: true },
        ],
      };
      if (path.startsWith('daily_task_completions')) return { data: [] };
    },
  });
  const req = { method: 'GET', headers: new Map() };
  // 2026-09-09 is a Wednesday (day 3) -- the Sunday-only task must not be due.
  const url = new URL('https://x.test/daily-tasks?store_id=s1&date=2026-09-09');
  const res = await handleDailyTasksRequest(req, {}, url, deps);
  assert.equal(res.status, 200);
  const tasks = res.body.roles[0].tasks;
  const everyday = tasks.find(t => t.id === 't1');
  const sundayOnly = tasks.find(t => t.id === 't2');
  assert.equal(everyday.dueToday, true, 'a task with every day of week set must be due on a Wednesday');
  assert.equal(sundayOnly.dueToday, false, 'a Sunday-only task must not be due on a Wednesday');
}
console.log('Day-of-week due-today filtering checks passed');

// ── Completion state must attach per-task, per requested date ────────────
{
  const { deps } = mockDeps({
    dbHandler: (path) => {
      if (path.startsWith('daily_task_roles')) return { data: [{ id: 'r1', store_id: 's1', name: 'Opener', sort_order: 0 }] };
      if (path.startsWith('daily_task_items')) return { data: [{ id: 't1', store_id: 's1', role_id: 'r1', title: 'Count drawer', detail: '', days_of_week: [0, 1, 2, 3, 4, 5, 6], sort_order: 0, active: true }] };
      if (path.startsWith('daily_task_completions')) return { data: [{ task_id: 't1', completed_by: 'sam@example.com', completed_at: '2026-09-09T12:00:00Z' }] };
    },
  });
  const req = { method: 'GET', headers: new Map() };
  const url = new URL('https://x.test/daily-tasks?store_id=s1&date=2026-09-09');
  const res = await handleDailyTasksRequest(req, {}, url, deps);
  const task = res.body.roles[0].tasks[0];
  assert.equal(task.completed, true);
  assert.equal(task.completedBy, 'sam@example.com');
}
console.log('Completion-state attachment checks passed');

// ── Completion toggle: checking writes a row, unchecking deletes it ──────
{
  const { deps, calls } = mockDeps();
  const req = fakeRequest({ storeId: 's1', taskId: 't1', date: '2026-09-09', completed: true });
  const res = await handleDailyTasksRequest(req, {}, new URL('https://x.test/daily-tasks/complete'), deps);
  assert.equal(res.status, 200);
  assert.equal(res.body.completed, true);
  const write = calls.find(c => c.path === 'daily_task_completions' && c.opts?.method === 'POST');
  assert.ok(write, 'checking a task must POST a completion row');
  const [row] = JSON.parse(write.opts.body);
  assert.equal(row.task_id, 't1');
  assert.equal(row.task_date, '2026-09-09');
  assert.equal(row.completed_by, 'staff@example.com', 'must record who checked it off from the authenticated user');
}
{
  const { deps, calls } = mockDeps();
  const req = fakeRequest({ storeId: 's1', taskId: 't1', date: '2026-09-09', completed: false });
  const res = await handleDailyTasksRequest(req, {}, new URL('https://x.test/daily-tasks/complete'), deps);
  assert.equal(res.status, 200);
  assert.equal(res.body.completed, false);
  const del = calls.find(c => c.opts?.method === 'DELETE');
  assert.ok(del, 'unchecking a task must delete its completion row for that date, not just flag it');
  assert.match(del.path, /task_id=eq\.t1/);
  assert.match(del.path, /task_date=eq\.2026-09-09/);
}
console.log('Completion toggle checks passed');

// ── Permission floors: role/task definition is admin-only, checking a box
// is open to any working staff member ──────────────────────────────────
{
  const { deps, requireStoreUserCalls } = mockDeps();
  await handleDailyTasksRequest(fakeRequest({ storeId: 's1', name: 'Closer' }), {}, new URL('https://x.test/daily-tasks/roles'), deps);
  assert.deepEqual(requireStoreUserCalls[0].allowedRoles, ['owner', 'admin', 'manager'], 'creating a role must be restricted to owner/admin/manager');
}
{
  const { deps, requireStoreUserCalls } = mockDeps();
  await handleDailyTasksRequest(fakeRequest({ storeId: 's1', roleId: 'r1', title: 'New task' }), {}, new URL('https://x.test/daily-tasks/items'), deps);
  assert.deepEqual(requireStoreUserCalls[0].allowedRoles, ['owner', 'admin', 'manager'], 'creating a task must be restricted to owner/admin/manager');
}
{
  const { deps, requireStoreUserCalls } = mockDeps({ role: 'employee' });
  const res = await handleDailyTasksRequest(fakeRequest({ storeId: 's1', taskId: 't1', date: '2026-09-09', completed: true }), {}, new URL('https://x.test/daily-tasks/complete'), deps);
  assert.equal(res.status, 200, 'an employee (not just owner/admin/manager) must be able to check a task off');
  assert.equal(requireStoreUserCalls[0].allowedRoles, undefined, 'completion must use the default (all working-staff) permission floor, not an explicit admin-only list');
}
console.log('Permission floor checks passed');

// ── Assignment: create/update can set a specific assignee, or clear back
// to "anyone in role" ─────────────────────────────────────────────────────
{
  const { deps, calls } = mockDeps();
  await handleDailyTasksRequest(fakeRequest({ storeId: 's1', roleId: 'r1', title: 'Count drawer', assignedToUserId: 'u9', assignedToLabel: 'Sam' }), {}, new URL('https://x.test/daily-tasks/items'), deps);
  const write = calls.find(c => c.path === 'daily_task_items' && c.opts?.method === 'POST');
  const [row] = JSON.parse(write.opts.body);
  assert.equal(row.assigned_to_user_id, 'u9', 'creating a task with an assignee must persist the user id');
  assert.equal(row.assigned_to_label, 'Sam', 'creating a task with an assignee must persist the display label');
}
function fakePatchRequest(body) {
  return { method: 'PATCH', headers: new Map(), json: async () => body };
}
{
  const { deps, calls } = mockDeps();
  await handleDailyTasksRequest(fakePatchRequest({ storeId: 's1', id: 't1', assignedToUserId: 'u9', assignedToLabel: 'Sam' }), {}, new URL('https://x.test/daily-tasks/items'), deps);
  const write = calls.find(c => c.opts?.method === 'PATCH');
  const patch = JSON.parse(write.opts.body);
  assert.equal(patch.assigned_to_user_id, 'u9');
  assert.equal(patch.assigned_to_label, 'Sam');
}
{
  const { deps, calls } = mockDeps();
  await handleDailyTasksRequest(fakePatchRequest({ storeId: 's1', id: 't1', assignedToUserId: '' }), {}, new URL('https://x.test/daily-tasks/items'), deps);
  const write = calls.find(c => c.opts?.method === 'PATCH');
  const patch = JSON.parse(write.opts.body);
  assert.equal(patch.assigned_to_user_id, null, 'clearing assignedToUserId must null it out, reverting to anyone-in-role');
  assert.equal(patch.assigned_to_label, '');
}
console.log('Assignment checks passed');

// ── The read path must surface each task's assignment ────────────────────
{
  const { deps } = mockDeps({
    dbHandler: (path) => {
      if (path.startsWith('daily_task_roles')) return { data: [{ id: 'r1', store_id: 's1', name: 'Opener', sort_order: 0 }] };
      if (path.startsWith('daily_task_items')) return { data: [{ id: 't1', store_id: 's1', role_id: 'r1', title: 'Count drawer', detail: '', days_of_week: [0, 1, 2, 3, 4, 5, 6], sort_order: 0, active: true, assigned_to_user_id: 'u9', assigned_to_label: 'Sam' }] };
      if (path.startsWith('daily_task_completions')) return { data: [] };
    },
  });
  const res = await handleDailyTasksRequest({ method: 'GET', headers: new Map() }, {}, new URL('https://x.test/daily-tasks?store_id=s1&date=2026-09-09'), deps);
  const task = res.body.roles[0].tasks[0];
  assert.equal(task.assignedToUserId, 'u9');
  assert.equal(task.assignedToLabel, 'Sam');
}
console.log('Assignment read-path checks passed');
