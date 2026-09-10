import assert from 'node:assert/strict';
import { handleDailyTasksRequest } from '../scripts/daily-tasks.mjs';

function mockDeps(overrides = {}) {
  const calls = [];
  const db = async (path, opts) => {
    calls.push({ path, opts });
    if (overrides.dbHandler) { const r = overrides.dbHandler(path, opts); if (r !== undefined) return r; }
    return { data: [] };
  };
  return {
    calls,
    deps: {
      json: (body, status = 200) => ({ status, body }),
      supabaseAdminFetch: (env, path, opts) => db(path, opts),
      readJsonWithLimit: async (request) => ({ data: await request.json() }),
      requireStoreUser: async () => ({ user: { id: 'u1', email: 'staff@example.com' }, role: 'employee', token: 't' }),
    },
  };
}
function fakeRequest(body, method = 'POST') {
  return { method, headers: new Map(), json: async () => body };
}

// ── Monthly cadence: due until completed this month, not before ─────────
{
  const { deps } = mockDeps({
    dbHandler: (path) => {
      if (path.startsWith('daily_task_roles')) return { data: [{ id: 'r1', store_id: 's1', name: 'Shawn', sort_order: 0 }] };
      if (path.startsWith('daily_task_items')) return {
        data: [{ id: 't1', store_id: 's1', role_id: 'r1', title: 'Close the month', detail: '', days_of_week: [0, 1, 2, 3, 4, 5, 6], cadence: 'monthly', sort_order: 0, active: true, created_at: '2026-01-01T00:00:00Z' }],
      };
      if (path.startsWith('daily_task_completions')) return { data: [] };
    },
  });
  const res = await handleDailyTasksRequest({ method: 'GET', headers: new Map() }, {}, new URL('https://x.test/daily-tasks?store_id=s1&date=2026-09-15'), deps);
  const task = res.body.roles[0].tasks[0];
  assert.equal(task.dueToday, true, 'a monthly task with no completion this month must still be due');
  assert.equal(task.completed, false);
}

// ── Monthly cadence: a completion anywhere in the current month satisfies it, and it disappears ("goes away") ──
{
  const { deps } = mockDeps({
    dbHandler: (path) => {
      if (path.startsWith('daily_task_roles')) return { data: [{ id: 'r1', store_id: 's1', name: 'Shawn', sort_order: 0 }] };
      if (path.startsWith('daily_task_items')) return {
        data: [{ id: 't1', store_id: 's1', role_id: 'r1', title: 'Close the month', detail: '', days_of_week: [0, 1, 2, 3, 4, 5, 6], cadence: 'monthly', sort_order: 0, active: true, created_at: '2026-01-01T00:00:00Z' }],
      };
      if (path.startsWith('daily_task_completions')) return { data: [{ task_id: 't1', task_date: '2026-09-03', completed_by: 'shawn@example.com', completed_at: '2026-09-03T09:00:00Z' }] };
    },
  });
  const res = await handleDailyTasksRequest({ method: 'GET', headers: new Map() }, {}, new URL('https://x.test/daily-tasks?store_id=s1&date=2026-09-15'), deps);
  const task = res.body.roles[0].tasks[0];
  assert.equal(task.completed, true, 'a completion on any date inside the current month must satisfy a monthly task');
  assert.equal(task.dueToday, false, 'a completed monthly task must stop being due -- this is what makes it "go away" from the checklist');
  assert.equal(task.overdue, false);
}

// ── Monthly cadence: previous month had zero completions -> overdue this month ──
{
  const { deps } = mockDeps({
    dbHandler: (path) => {
      if (path.startsWith('daily_task_roles')) return { data: [{ id: 'r1', store_id: 's1', name: 'Shawn', sort_order: 0 }] };
      if (path.startsWith('daily_task_items')) return {
        data: [{ id: 't1', store_id: 's1', role_id: 'r1', title: 'Vendor statement review', detail: '', days_of_week: [0, 1, 2, 3, 4, 5, 6], cadence: 'monthly', sort_order: 0, active: true, created_at: '2026-01-01T00:00:00Z' }],
      };
      if (path.startsWith('daily_task_completions')) return { data: [] };
    },
  });
  const res = await handleDailyTasksRequest({ method: 'GET', headers: new Map() }, {}, new URL('https://x.test/daily-tasks?store_id=s1&date=2026-09-15'), deps);
  const task = res.body.roles[0].tasks[0];
  assert.equal(task.overdue, true, 'a monthly task with zero completions in the prior month must be flagged overdue');
  assert.equal(task.overdueSince, '2026-08-31');
  assert.deepEqual(res.body.overdueTasks.map(t => t.id), ['t1'], 'the flat overdueTasks list must include it too');
}

// ── Monthly cadence: task created after the previous period must not be falsely flagged overdue ──
{
  const { deps } = mockDeps({
    dbHandler: (path) => {
      if (path.startsWith('daily_task_roles')) return { data: [{ id: 'r1', store_id: 's1', name: 'Shawn', sort_order: 0 }] };
      if (path.startsWith('daily_task_items')) return {
        data: [{ id: 't1', store_id: 's1', role_id: 'r1', title: 'New task', detail: '', days_of_week: [0, 1, 2, 3, 4, 5, 6], cadence: 'monthly', sort_order: 0, active: true, created_at: '2026-09-10T00:00:00Z' }],
      };
      if (path.startsWith('daily_task_completions')) return { data: [] };
    },
  });
  const res = await handleDailyTasksRequest({ method: 'GET', headers: new Map() }, {}, new URL('https://x.test/daily-tasks?store_id=s1&date=2026-09-15'), deps);
  const task = res.body.roles[0].tasks[0];
  assert.equal(task.dueToday, true);
  assert.equal(task.overdue, false, 'a task created this period has no prior period to have missed -- must not be flagged overdue on day one');
}

// ── Daily/weekly cadence: a missed prior due day is flagged overdue ──────
{
  const { deps } = mockDeps({
    dbHandler: (path) => {
      if (path.startsWith('daily_task_roles')) return { data: [{ id: 'r1', store_id: 's1', name: 'Any', sort_order: -1 }] };
      if (path.startsWith('daily_task_items')) return {
        data: [{ id: 't1', store_id: 's1', role_id: 'r1', title: 'Cycle count', detail: '', days_of_week: [0, 1, 2, 3, 4, 5, 6], cadence: 'daily', sort_order: 0, active: true }],
      };
      if (path.startsWith('daily_task_completions')) return { data: [] };
    },
  });
  // 2026-09-09 is a Wednesday; nothing was ever completed, so yesterday (Tue 9/8) was missed.
  const res = await handleDailyTasksRequest({ method: 'GET', headers: new Map() }, {}, new URL('https://x.test/daily-tasks?store_id=s1&date=2026-09-09'), deps);
  const task = res.body.roles[0].tasks[0];
  assert.equal(task.overdue, true);
  assert.equal(task.overdueSince, '2026-09-08');
}

// ── Daily/weekly cadence: yesterday's occurrence WAS completed -> not overdue ──
{
  const { deps } = mockDeps({
    dbHandler: (path) => {
      if (path.startsWith('daily_task_roles')) return { data: [{ id: 'r1', store_id: 's1', name: 'Any', sort_order: -1 }] };
      if (path.startsWith('daily_task_items')) return {
        data: [{ id: 't1', store_id: 's1', role_id: 'r1', title: 'Cycle count', detail: '', days_of_week: [0, 1, 2, 3, 4, 5, 6], cadence: 'daily', sort_order: 0, active: true }],
      };
      if (path.startsWith('daily_task_completions')) return { data: [{ task_id: 't1', task_date: '2026-09-08', completed_by: 'x', completed_at: '2026-09-08T10:00:00Z' }] };
    },
  });
  const res = await handleDailyTasksRequest({ method: 'GET', headers: new Map() }, {}, new URL('https://x.test/daily-tasks?store_id=s1&date=2026-09-09'), deps);
  const task = res.body.roles[0].tasks[0];
  assert.equal(task.overdue, false);
}

// ── Creating/updating an item persists cadence ────────────────────────────
{
  const { deps, calls } = mockDeps();
  await handleDailyTasksRequest(fakeRequest({ storeId: 's1', roleId: 'r1', title: 'Quarterly review', cadence: 'quarterly' }), {}, new URL('https://x.test/daily-tasks/items'), deps);
  const write = calls.find(c => c.path === 'daily_task_items' && c.opts?.method === 'POST');
  const [row] = JSON.parse(write.opts.body);
  assert.equal(row.cadence, 'quarterly');
}
{
  const { deps, calls } = mockDeps();
  await handleDailyTasksRequest(fakeRequest({ storeId: 's1', id: 't1', cadence: 'not-a-real-cadence' }, 'PATCH'), {}, new URL('https://x.test/daily-tasks/items'), deps);
  const write = calls.find(c => c.opts?.method === 'PATCH');
  const patch = JSON.parse(write.opts.body);
  assert.equal(patch.cadence, 'daily', 'an unrecognized cadence value must fall back to daily rather than being persisted verbatim');
}

console.log('Daily tasks cadence checks passed');
