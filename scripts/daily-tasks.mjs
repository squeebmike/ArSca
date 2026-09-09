// Roles & Tasks: a store-defined daily checklist. Staff define their own
// operational roles (e.g. "Opener", "Whatnot Host", "Closer" -- deliberately
// NOT the same thing as the owner/admin/manager/employee permission roles
// used for auth elsewhere in this app) and the tasks that belong to each
// one, optionally scoped to specific days of the week (a task can run every
// day, or only on show days, etc.). Checking a task off is per calendar
// date, so the list naturally resets each day without deleting history.

function text(value, max = 4000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

// Client sends a plain 'YYYY-MM-DD' string (its own local "today") -- the
// server never guesses a timezone, it just needs the day-of-week that date
// falls on, computed the same way regardless of where the Worker runs.
function dayOfWeekForDateString(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d.getUTCDay();
}

function normalizeDaysOfWeek(input) {
  if (!Array.isArray(input) || !input.length) return [0, 1, 2, 3, 4, 5, 6];
  const days = [...new Set(input.map(n => Math.round(Number(n))).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))];
  return days.length ? days.sort((a, b) => a - b) : [0, 1, 2, 3, 4, 5, 6];
}

// Combined read: powers both the "Today's Checklist" view (filter each
// task's own dueToday flag client-side) and the "Edit Roles & Tasks" admin
// screen (which needs every task regardless of day-of-week), in one round
// trip instead of two slightly-different endpoints drifting apart later.
async function getDailyTasks(request, env, deps, url) {
  const storeId = text(url.searchParams.get('store_id'), 80);
  const auth = await deps.requireStoreUser(request, env, storeId); if (auth.error) return auth.error;
  const dateStr = text(url.searchParams.get('date'), 10) || new Date().toISOString().slice(0, 10);
  const dow = dayOfWeekForDateString(dateStr);
  if (dow === null) return deps.json({ ok: false, error: 'Invalid date' }, 400);
  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);

  const [{ data: roleRows }, { data: itemRows }, { data: completionRows }] = await Promise.all([
    db(`daily_task_roles?store_id=eq.${encodeURIComponent(storeId)}&select=*&order=sort_order.asc,name.asc`),
    db(`daily_task_items?store_id=eq.${encodeURIComponent(storeId)}&select=*&order=sort_order.asc,title.asc`),
    db(`daily_task_completions?store_id=eq.${encodeURIComponent(storeId)}&task_date=eq.${encodeURIComponent(dateStr)}&select=task_id,completed_by,completed_at`),
  ]);
  const completedByTaskId = new Map((completionRows || []).map(c => [c.task_id, c]));
  const itemsByRole = new Map();
  (itemRows || []).forEach(item => {
    const list = itemsByRole.get(item.role_id) || [];
    const completion = completedByTaskId.get(item.id);
    list.push({
      id: item.id, roleId: item.role_id, title: item.title, detail: item.detail || '',
      daysOfWeek: item.days_of_week || [0, 1, 2, 3, 4, 5, 6], sortOrder: item.sort_order, active: item.active,
      dueToday: (item.days_of_week || []).includes(dow),
      completed: !!completion, completedBy: completion?.completed_by || '', completedAt: completion?.completed_at || null,
    });
    itemsByRole.set(item.role_id, list);
  });
  const roles = (roleRows || []).map(role => ({
    id: role.id, name: role.name, sortOrder: role.sort_order,
    tasks: itemsByRole.get(role.id) || [],
  }));
  return deps.json({ ok: true, date: dateStr, dayOfWeek: dow, roles });
}

async function createRole(request, env, deps) {
  const limited = await deps.readJsonWithLimit(request, 4 * 1024); if (limited.error) return limited.error;
  const body = limited.data || {};
  const storeId = text(body.storeId, 80);
  const auth = await deps.requireStoreUser(request, env, storeId, ['owner', 'admin', 'manager']); if (auth.error) return auth.error;
  const name = text(body.name, 80);
  if (!name) return deps.json({ ok: false, error: 'name is required' }, 400);
  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
  const { data } = await db('daily_task_roles', {
    method: 'POST', headers: { Prefer: 'return=representation', 'Content-Type': 'application/json' },
    body: JSON.stringify([{ store_id: storeId, name, sort_order: Math.round(Number(body.sortOrder) || 0) }]),
  });
  return deps.json({ ok: true, role: data?.[0] });
}

async function updateRole(request, env, deps) {
  const limited = await deps.readJsonWithLimit(request, 4 * 1024); if (limited.error) return limited.error;
  const body = limited.data || {};
  const storeId = text(body.storeId, 80);
  const auth = await deps.requireStoreUser(request, env, storeId, ['owner', 'admin', 'manager']); if (auth.error) return auth.error;
  const id = text(body.id, 80);
  if (!id) return deps.json({ ok: false, error: 'id is required' }, 400);
  const patch = {};
  if (body.name !== undefined) { const name = text(body.name, 80); if (!name) return deps.json({ ok: false, error: 'name cannot be blank' }, 400); patch.name = name; }
  if (body.sortOrder !== undefined) patch.sort_order = Math.round(Number(body.sortOrder) || 0);
  if (!Object.keys(patch).length) return deps.json({ ok: false, error: 'Nothing to update' }, 400);
  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
  const { data } = await db(`daily_task_roles?id=eq.${encodeURIComponent(id)}&store_id=eq.${encodeURIComponent(storeId)}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation', 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  });
  if (!data?.length) return deps.json({ ok: false, error: 'Role not found' }, 404);
  return deps.json({ ok: true, role: data[0] });
}

// Deleting a role cascades its tasks (and their completion history) via the
// foreign key -- confirmed intentional: a role only gets deleted when a
// store no longer wants it or anything under it tracked, not as a routine
// action, so no separate "delete tasks first" step is needed to protect
// against it.
async function deleteRole(request, env, deps, url) {
  const storeId = text(url.searchParams.get('store_id'), 80);
  const auth = await deps.requireStoreUser(request, env, storeId, ['owner', 'admin', 'manager']); if (auth.error) return auth.error;
  const id = text(url.searchParams.get('id'), 80);
  if (!id) return deps.json({ ok: false, error: 'id is required' }, 400);
  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
  await db(`daily_task_roles?id=eq.${encodeURIComponent(id)}&store_id=eq.${encodeURIComponent(storeId)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  return deps.json({ ok: true });
}

async function createItem(request, env, deps) {
  const limited = await deps.readJsonWithLimit(request, 8 * 1024); if (limited.error) return limited.error;
  const body = limited.data || {};
  const storeId = text(body.storeId, 80);
  const auth = await deps.requireStoreUser(request, env, storeId, ['owner', 'admin', 'manager']); if (auth.error) return auth.error;
  const roleId = text(body.roleId, 80);
  const title = text(body.title, 200);
  if (!roleId || !title) return deps.json({ ok: false, error: 'roleId and title are required' }, 400);
  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
  const { data } = await db('daily_task_items', {
    method: 'POST', headers: { Prefer: 'return=representation', 'Content-Type': 'application/json' },
    body: JSON.stringify([{
      store_id: storeId, role_id: roleId, title, detail: text(body.detail, 2000),
      days_of_week: normalizeDaysOfWeek(body.daysOfWeek), sort_order: Math.round(Number(body.sortOrder) || 0),
    }]),
  });
  return deps.json({ ok: true, item: data?.[0] });
}

async function updateItem(request, env, deps) {
  const limited = await deps.readJsonWithLimit(request, 8 * 1024); if (limited.error) return limited.error;
  const body = limited.data || {};
  const storeId = text(body.storeId, 80);
  const auth = await deps.requireStoreUser(request, env, storeId, ['owner', 'admin', 'manager']); if (auth.error) return auth.error;
  const id = text(body.id, 80);
  if (!id) return deps.json({ ok: false, error: 'id is required' }, 400);
  const patch = {};
  if (body.title !== undefined) { const title = text(body.title, 200); if (!title) return deps.json({ ok: false, error: 'title cannot be blank' }, 400); patch.title = title; }
  if (body.detail !== undefined) patch.detail = text(body.detail, 2000);
  if (body.roleId !== undefined) patch.role_id = text(body.roleId, 80);
  if (body.daysOfWeek !== undefined) patch.days_of_week = normalizeDaysOfWeek(body.daysOfWeek);
  if (body.sortOrder !== undefined) patch.sort_order = Math.round(Number(body.sortOrder) || 0);
  if (body.active !== undefined) patch.active = !!body.active;
  if (!Object.keys(patch).length) return deps.json({ ok: false, error: 'Nothing to update' }, 400);
  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
  const { data } = await db(`daily_task_items?id=eq.${encodeURIComponent(id)}&store_id=eq.${encodeURIComponent(storeId)}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation', 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  });
  if (!data?.length) return deps.json({ ok: false, error: 'Task not found' }, 404);
  return deps.json({ ok: true, item: data[0] });
}

async function deleteItem(request, env, deps, url) {
  const storeId = text(url.searchParams.get('store_id'), 80);
  const auth = await deps.requireStoreUser(request, env, storeId, ['owner', 'admin', 'manager']); if (auth.error) return auth.error;
  const id = text(url.searchParams.get('id'), 80);
  if (!id) return deps.json({ ok: false, error: 'id is required' }, 400);
  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
  await db(`daily_task_items?id=eq.${encodeURIComponent(id)}&store_id=eq.${encodeURIComponent(storeId)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  return deps.json({ ok: true });
}

// Checking a box is everyday shop-floor work, not a management action --
// any signed-in staff member who can work the register/scanner can toggle
// it, same permission floor as the rest of the working-shift surface
// (requireStoreUser's default minimum already covers owner/admin/manager/
// employee, so no explicit role list is passed here, unlike the
// role/task-definition routes above which are deliberately admin-only).
async function setCompletion(request, env, deps) {
  const limited = await deps.readJsonWithLimit(request, 4 * 1024); if (limited.error) return limited.error;
  const body = limited.data || {};
  const storeId = text(body.storeId, 80);
  const auth = await deps.requireStoreUser(request, env, storeId); if (auth.error) return auth.error;
  const taskId = text(body.taskId, 80);
  const date = text(body.date, 10);
  if (!taskId || !date) return deps.json({ ok: false, error: 'taskId and date are required' }, 400);
  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
  if (body.completed === false) {
    await db(`daily_task_completions?store_id=eq.${encodeURIComponent(storeId)}&task_id=eq.${encodeURIComponent(taskId)}&task_date=eq.${encodeURIComponent(date)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    return deps.json({ ok: true, completed: false });
  }
  const completedBy = text(auth.user?.email || body.completedBy, 200);
  await db('daily_task_completions', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal', 'Content-Type': 'application/json' },
    body: JSON.stringify([{ store_id: storeId, task_id: taskId, task_date: date, completed_by: completedBy, completed_at: new Date().toISOString() }]),
  });
  return deps.json({ ok: true, completed: true, completedBy });
}

export async function handleDailyTasksRequest(request, env, url, deps) {
  const path = url.pathname;
  if (path === '/daily-tasks' && request.method === 'GET') return getDailyTasks(request, env, deps, url);
  if (path === '/daily-tasks/roles' && request.method === 'POST') return createRole(request, env, deps);
  if (path === '/daily-tasks/roles' && request.method === 'PATCH') return updateRole(request, env, deps);
  if (path === '/daily-tasks/roles' && request.method === 'DELETE') return deleteRole(request, env, deps, url);
  if (path === '/daily-tasks/items' && request.method === 'POST') return createItem(request, env, deps);
  if (path === '/daily-tasks/items' && request.method === 'PATCH') return updateItem(request, env, deps);
  if (path === '/daily-tasks/items' && request.method === 'DELETE') return deleteItem(request, env, deps, url);
  if (path === '/daily-tasks/complete' && request.method === 'POST') return setCompletion(request, env, deps);
  return deps.json({ ok: false, error: 'Daily tasks route not found' }, 404);
}
