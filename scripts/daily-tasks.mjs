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

const CADENCES = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];
function normalizeCadence(input) {
  const c = String(input || 'daily').trim().toLowerCase();
  return CADENCES.includes(c) ? c : 'daily';
}
const PERIOD_CADENCES = new Set(['monthly', 'quarterly', 'yearly']);

function pad2(n) { return String(n).padStart(2, '0'); }
function dateToStr(d) { return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; }

function shiftDateStr(dateStr, deltaDays) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return dateToStr(d);
}

// Calendar-period bounds for the non-weekday cadences -- 'monthly' is a
// calendar month, 'quarterly' a calendar quarter, 'yearly' a calendar
// year, all computed in UTC from the client's own 'YYYY-MM-DD' string
// (same no-timezone-guessing rule as dayOfWeekForDateString above).
function periodBounds(cadence, dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (cadence === 'monthly') {
    return { start: dateToStr(new Date(Date.UTC(y, m, 1))), end: dateToStr(new Date(Date.UTC(y, m + 1, 0))) };
  }
  if (cadence === 'quarterly') {
    const qStart = Math.floor(m / 3) * 3;
    return { start: dateToStr(new Date(Date.UTC(y, qStart, 1))), end: dateToStr(new Date(Date.UTC(y, qStart + 3, 0))) };
  }
  return { start: dateToStr(new Date(Date.UTC(y, 0, 1))), end: dateToStr(new Date(Date.UTC(y, 11, 31))) };
}

function previousPeriodBounds(cadence, dateStr) {
  const cur = periodBounds(cadence, dateStr);
  if (!cur) return null;
  return periodBounds(cadence, shiftDateStr(cur.start, -1));
}

// How many days back to look for a missed occurrence of a daily/weekly
// task before flagging it "overdue" -- wide enough to catch a weekly task
// (7-day cycle) with margin, without scanning forever.
const OVERDUE_LOOKBACK_DAYS = 13;

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

  const [{ data: roleRows }, { data: itemRows }] = await Promise.all([
    db(`daily_task_roles?store_id=eq.${encodeURIComponent(storeId)}&select=*&order=sort_order.asc,name.asc`),
    db(`daily_task_items?store_id=eq.${encodeURIComponent(storeId)}&select=*&order=sort_order.asc,title.asc`),
  ]);

  // Completions are fetched as one range, not one exact-date row per task:
  // daily/weekly overdue detection needs the last OVERDUE_LOOKBACK_DAYS
  // days, and monthly/quarterly/yearly tasks need every completion inside
  // their current (and previous, for overdue) calendar period -- both
  // reach further back than "just today".
  let earliest = shiftDateStr(dateStr, -OVERDUE_LOOKBACK_DAYS);
  const cadencesPresent = new Set((itemRows || []).map(i => normalizeCadence(i.cadence)));
  for (const c of PERIOD_CADENCES) {
    if (!cadencesPresent.has(c)) continue;
    const prev = previousPeriodBounds(c, dateStr);
    if (prev && prev.start < earliest) earliest = prev.start;
  }
  const [{ data: completionRows }, { data: overrideRows }] = await Promise.all([
    db(`daily_task_completions?store_id=eq.${encodeURIComponent(storeId)}&task_date=gte.${encodeURIComponent(earliest)}&task_date=lte.${encodeURIComponent(dateStr)}&select=task_id,task_date,completed_by,completed_at`),
    db(`daily_task_overrides?store_id=eq.${encodeURIComponent(storeId)}&task_date=eq.${encodeURIComponent(dateStr)}&select=task_id,assigned_to_user_id,assigned_to_label`),
  ]);
  const completedByExactDate = new Map();
  const completionsByTask = new Map();
  (completionRows || []).forEach(c => {
    completedByExactDate.set(`${c.task_id}|${c.task_date}`, c);
    const list = completionsByTask.get(c.task_id) || [];
    list.push(c);
    completionsByTask.set(c.task_id, list);
  });
  const overrideByTask = new Map((overrideRows || []).map(o => [o.task_id, o]));

  const itemsByRole = new Map();
  (itemRows || []).forEach(item => {
    const cadence = normalizeCadence(item.cadence);
    const daysOfWeek = item.days_of_week || [0, 1, 2, 3, 4, 5, 6];
    const compsForTask = completionsByTask.get(item.id) || [];
    let dueToday, completed, completedBy, completedAt, overdue = false, overdueSince = null;

    if (PERIOD_CADENCES.has(cadence)) {
      const bounds = periodBounds(cadence, dateStr);
      const thisPeriodComp = compsForTask.find(c => c.task_date >= bounds.start && c.task_date <= bounds.end);
      completed = !!thisPeriodComp;
      completedBy = thisPeriodComp?.completed_by || '';
      completedAt = thisPeriodComp?.completed_at || null;
      dueToday = !completed;
      const prevBounds = previousPeriodBounds(cadence, dateStr);
      const createdBefore = !item.created_at || item.created_at.slice(0, 10) <= prevBounds.end;
      const prevComp = prevBounds && compsForTask.some(c => c.task_date >= prevBounds.start && c.task_date <= prevBounds.end);
      if (!completed && createdBefore && !prevComp) { overdue = true; overdueSince = prevBounds.end; }
    } else {
      dueToday = daysOfWeek.includes(dow);
      const exact = completedByExactDate.get(`${item.id}|${dateStr}`);
      completed = !!exact;
      completedBy = exact?.completed_by || '';
      completedAt = exact?.completed_at || null;
      for (let back = 1; back <= OVERDUE_LOOKBACK_DAYS; back++) {
        const past = shiftDateStr(dateStr, -back);
        if (!daysOfWeek.includes(dayOfWeekForDateString(past))) continue;
        if (item.created_at && past < item.created_at.slice(0, 10)) break;
        const hasPast = completedByExactDate.has(`${item.id}|${past}`);
        overdue = !hasPast;
        overdueSince = hasPast ? null : past;
        break;
      }
    }

    const override = overrideByTask.get(item.id);
    const defaultAssignedToUserId = item.assigned_to_user_id || null;
    const defaultAssignedToLabel = item.assigned_to_label || '';

    const list = itemsByRole.get(item.role_id) || [];
    list.push({
      id: item.id, roleId: item.role_id, title: item.title, detail: item.detail || '',
      cadence, daysOfWeek, sortOrder: item.sort_order, active: item.active,
      assignedToUserId: override ? (override.assigned_to_user_id || null) : defaultAssignedToUserId,
      assignedToLabel: override ? (override.assigned_to_label || '') : defaultAssignedToLabel,
      defaultAssignedToUserId, defaultAssignedToLabel, reassignedToday: !!override,
      dueToday, completed, completedBy, completedAt, overdue, overdueSince,
    });
    itemsByRole.set(item.role_id, list);
  });
  const roles = (roleRows || []).map(role => ({
    id: role.id, name: role.name, sortOrder: role.sort_order,
    tasks: itemsByRole.get(role.id) || [],
  }));
  const overdueTasks = [];
  roles.forEach(role => (role.tasks || []).forEach(t => { if (t.overdue) overdueTasks.push({ ...t, roleName: role.name }); }));
  overdueTasks.sort((a, b) => (a.overdueSince || '').localeCompare(b.overdueSince || ''));
  return deps.json({ ok: true, date: dateStr, dayOfWeek: dow, roles, overdueTasks });
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
      cadence: normalizeCadence(body.cadence),
      assigned_to_user_id: body.assignedToUserId ? text(body.assignedToUserId, 80) : null,
      assigned_to_label: body.assignedToUserId ? text(body.assignedToLabel, 200) : '',
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
  if (body.cadence !== undefined) patch.cadence = normalizeCadence(body.cadence);
  if (body.sortOrder !== undefined) patch.sort_order = Math.round(Number(body.sortOrder) || 0);
  if (body.active !== undefined) patch.active = !!body.active;
  // assignedToUserId is the toggle: pass a falsy value (null/'') to clear
  // assignment back to "any staff in this role", or an id + label to set it.
  if (body.assignedToUserId !== undefined) {
    patch.assigned_to_user_id = body.assignedToUserId ? text(body.assignedToUserId, 80) : null;
    patch.assigned_to_label = body.assignedToUserId ? text(body.assignedToLabel, 200) : '';
  }
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

// One-time reassignment: "cover this single occurrence" rather than "this
// task belongs to someone else now" (that permanent case is already
// handled by updateItem's assignedToUserId). Same permission floor as
// checking a task off -- any working staff member can hand off a task for
// the day, not just owner/admin/manager. Passing an empty userId clears
// the override, reverting to the task's own default assignee for that date.
async function reassignOnce(request, env, deps) {
  const limited = await deps.readJsonWithLimit(request, 4 * 1024); if (limited.error) return limited.error;
  const body = limited.data || {};
  const storeId = text(body.storeId, 80);
  const auth = await deps.requireStoreUser(request, env, storeId); if (auth.error) return auth.error;
  const taskId = text(body.taskId, 80);
  const date = text(body.date, 10);
  if (!taskId || !date) return deps.json({ ok: false, error: 'taskId and date are required' }, 400);
  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
  const userId = text(body.userId, 80);
  if (!userId) {
    await db(`daily_task_overrides?store_id=eq.${encodeURIComponent(storeId)}&task_id=eq.${encodeURIComponent(taskId)}&task_date=eq.${encodeURIComponent(date)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    return deps.json({ ok: true, reassigned: false });
  }
  const label = text(body.label, 200);
  const createdBy = text(auth.user?.email, 200);
  await db('daily_task_overrides', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal', 'Content-Type': 'application/json' },
    body: JSON.stringify([{ store_id: storeId, task_id: taskId, task_date: date, assigned_to_user_id: userId, assigned_to_label: label, created_by: createdBy }]),
  });
  return deps.json({ ok: true, reassigned: true, assignedToUserId: userId, assignedToLabel: label });
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
  if (path === '/daily-tasks/reassign-once' && request.method === 'POST') return reassignOnce(request, env, deps);
  return deps.json({ ok: false, error: 'Daily tasks route not found' }, 404);
}
