// Safe edits from the dashboard's Database viewer. Only these can change:
//   - a sale line's cost and category
//   - an inventory item's cost and category
//   - a customer's loyalty points (with a reason)
// Nothing is ever deleted here -- money corrections still go through void /
// refund. Every change writes old -> new, who and when to database_edit_log.
// The Worker route checks owner/admin before calling in here, and every
// query is scoped to that store.

const enc = encodeURIComponent;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const round2 = n => Math.round(Number(n) * 100) / 100;

export class EditError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function parseCost(value) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (value === null || value === '' || !Number.isFinite(n) || n < 0 || n > 1000000) throw new EditError('Cost must be a dollar amount of 0 or more');
  return round2(n);
}
function parseCategory(value) {
  if (value === undefined) return undefined;
  const c = String(value || '').replace(/\s+/g, ' ').trim();
  if (!c || c.length > 60) throw new EditError('Category must be 1-60 characters');
  return c;
}
function parseReason(value, required) {
  const r = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (required && r.length < 3) throw new EditError('Give a short reason for the change');
  return r || null;
}

// In-store lines store cost_basis as the whole line's cost; website lines
// store it per unit. Which one a line uses shows in its own profit figure,
// so the edit keeps each line in the convention it was written in.
export function lineCostIsPerUnit(line) {
  const qty = Math.max(1, Number(line.quantity || 1));
  if (qty === 1) return false;
  const adj = Number(line.adjusted_price || 0), cost = Number(line.cost_basis || 0), profit = Number(line.profit || 0);
  return Math.abs(profit - (adj - cost * qty)) + 0.005 < Math.abs(profit - (adj - cost));
}
export function lineTotalCost(line) {
  const cost = Number(line.cost_basis || 0);
  return round2(lineCostIsPerUnit(line) ? cost * Math.max(1, Number(line.quantity || 1)) : cost);
}

// `cost` is the whole line's cost (what the viewer shows). Returns the patch
// plus the list of real changes; an edit that changes nothing is refused.
export function planSaleLineEdit(line, { cost, category }) {
  const patch = {}, changes = [];
  if (cost !== undefined) {
    const total = parseCost(cost);
    const before = lineTotalCost(line);
    if (total !== before) {
      const qty = Math.max(1, Number(line.quantity || 1));
      patch.cost_basis = lineCostIsPerUnit(line) ? round2(total / qty) : total;
      patch.profit = round2(Number(line.adjusted_price || 0) - total);
      changes.push({ field: 'cost', old: before, new: total });
      changes.push({ field: 'profit', old: line.profit == null ? null : Number(line.profit), new: patch.profit });
    }
  }
  if (category !== undefined) {
    const next = parseCategory(category);
    if (next !== (line.category || null)) { patch.category = next; changes.push({ field: 'category', old: line.category || null, new: next }); }
  }
  if (!changes.length) throw new EditError('Nothing changed');
  return { patch, changes };
}

export function planItemEdit(item, { cost, category }) {
  const data = { ...(item.data || {}) }, changes = [];
  if (cost !== undefined) {
    const next = parseCost(cost);
    const before = data.cost === undefined || data.cost === null || data.cost === '' ? null : Number(data.cost);
    if (next !== before) { data.cost = next; changes.push({ field: 'cost', old: before, new: next }); }
  }
  if (category !== undefined) {
    const next = parseCategory(category);
    if (next !== (data.category || null)) { changes.push({ field: 'category', old: data.category || null, new: next }); data.category = next; }
  }
  if (!changes.length) throw new EditError('Nothing changed');
  return { data, changes };
}

function logRows(storeId, table, rowId, changes, reason, user) {
  return changes.map(c => ({
    store_id: storeId, table_name: table, row_id: String(rowId), field: c.field,
    old_value: c.old === undefined ? null : c.old, new_value: c.new === undefined ? null : c.new,
    reason, edited_by: user?.id || null, edited_by_email: user?.email || null,
  }));
}

// PATCHes only if the row still holds the values the edit was planned from
// (someone else may have changed it meanwhile), then writes the log. If the
// log can't be written the change is put back, so there's never an
// unrecorded edit.
async function guardedPatch(env, fetch, path, patch, revert) {
  const { data } = await fetch(env, path, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  if (!data?.length) throw new EditError('That record changed while you were editing -- reload and try again', 409);
  return async (logWrite) => {
    try { await logWrite(); }
    catch (error) {
      await revert().catch(() => {});
      throw new EditError(`Change not saved: the audit log could not be written (${error.message})`, 500);
    }
    return data[0];
  };
}
const eqOrNull = (column, value) => value === null || value === undefined ? `${column}=is.null` : `${column}=eq.${enc(String(value))}`;

export async function editSaleLine(env, fetch, storeId, user, { id, cost, category, reason }) {
  if (!id || String(id).length > 120) throw new EditError('Sale line id is required');
  const base = `pos_sale_lines?store_id=eq.${enc(storeId)}&id=eq.${enc(id)}`;
  const line = (await fetch(env, `${base}&select=*&limit=1`)).data?.[0];
  if (!line) throw new EditError('Sale line not found', 404);
  const { patch, changes } = planSaleLineEdit(line, { cost, category });
  const guard = `${base}&${eqOrNull('cost_basis', line.cost_basis)}&${eqOrNull('category', line.category)}`;
  const original = { cost_basis: line.cost_basis, profit: line.profit, category: line.category };
  const finish = await guardedPatch(env, fetch, guard, patch,
    () => fetch(env, base, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(original) }));
  const updated = await finish(() => fetch(env, 'database_edit_log', { method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(logRows(storeId, 'pos_sale_lines', id, changes, parseReason(reason, false), user)) }));
  return { line: updated, changes };
}

export async function editInventoryItem(env, fetch, storeId, user, { id, cost, category, reason }) {
  if (!UUID.test(id || '')) throw new EditError('Item id is required');
  const base = `inventory_items?store_id=eq.${enc(storeId)}&id=eq.${enc(id)}`;
  const item = (await fetch(env, `${base}&select=id,data,updated_at&limit=1`)).data?.[0];
  if (!item) throw new EditError('Item not found', 404);
  const { data, changes } = planItemEdit(item, { cost, category });
  const finish = await guardedPatch(env, fetch, `${base}&updated_at=eq.${enc(item.updated_at)}`, { data },
    () => fetch(env, base, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ data: item.data }) }));
  const updated = await finish(() => fetch(env, 'database_edit_log', { method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(logRows(storeId, 'inventory_items', id, changes, parseReason(reason, false), user)) }));
  return { item: updated, changes };
}

// Balance, ledger row and audit row change together inside the RPC.
export async function adjustCustomerPoints(env, fetch, storeId, user, { id, delta, reason }) {
  if (!UUID.test(id || '')) throw new EditError('Customer id is required');
  const points = Number(delta);
  if (!Number.isInteger(points) || points === 0 || Math.abs(points) > 1000000) throw new EditError('Points change must be a whole number (use - to remove)');
  const why = parseReason(reason, true);
  try {
    const { data: balance } = await fetch(env, 'rpc/adjust_customer_points', { method: 'POST', body: JSON.stringify({
      p_store_id: storeId, p_customer_id: id, p_delta: points, p_reason: why, p_user_id: user?.id || null, p_user_email: user?.email || null,
    }) });
    return { balance, changes: [{ field: 'loyalty_points_balance', old: balance - points, new: balance }] };
  } catch (error) {
    const message = String(error.message || '');
    if (/below zero|not found|reason/i.test(message)) throw new EditError(message.charAt(0).toUpperCase() + message.slice(1), 409);
    throw error;
  }
}

export async function editHistory(env, fetch, storeId, { table, rowId, limit }) {
  const n = Math.min(200, Math.max(1, Number(limit) || 50));
  let path = `database_edit_log?store_id=eq.${enc(storeId)}&select=*&order=created_at.desc&limit=${n}`;
  if (table) path += `&table_name=eq.${enc(String(table).slice(0, 60))}`;
  if (rowId) path += `&row_id=eq.${enc(String(rowId).slice(0, 120))}`;
  return (await fetch(env, path)).data || [];
}
