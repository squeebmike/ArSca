import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  lineCostIsPerUnit, lineTotalCost, planSaleLineEdit, planItemEdit,
  editSaleLine, editInventoryItem, adjustCustomerPoints, EditError,
} from '../scripts/database-edits.mjs';

// --- Cost conventions ---------------------------------------------------------
// In-store: cost_basis is the whole line. Website: cost_basis is per unit.
const inStore = { id: 'l1', quantity: 2, adjusted_price: 30, cost_basis: 10, profit: 20, category: 'Sports' };
const website = { id: 'l2', quantity: 2, adjusted_price: 30, cost_basis: 5, profit: 20, category: 'Pokemon TCG' };
assert.equal(lineCostIsPerUnit(inStore), false);
assert.equal(lineCostIsPerUnit(website), true);
assert.equal(lineTotalCost(inStore), 10);
assert.equal(lineTotalCost(website), 10);
assert.equal(lineCostIsPerUnit({ quantity: 1, adjusted_price: 5, cost_basis: 2, profit: 3 }), false);

assert.deepEqual(planSaleLineEdit(inStore, { cost: 12 }).patch, { cost_basis: 12, profit: 18 }, 'in-store line keeps a whole-line cost');
assert.deepEqual(planSaleLineEdit(website, { cost: 12 }).patch, { cost_basis: 6, profit: 18 }, 'website line keeps a per-unit cost');
assert.deepEqual(planSaleLineEdit(inStore, { category: '  Pokemon   TCG ' }).patch, { category: 'Pokemon TCG' });
assert.deepEqual(planSaleLineEdit(inStore, { cost: 12 }).changes.map(c => c.field), ['cost', 'profit']);
assert.throws(() => planSaleLineEdit(inStore, { cost: 10, category: 'Sports' }), /Nothing changed/);
assert.throws(() => planSaleLineEdit(inStore, { cost: -1 }), EditError);
assert.throws(() => planSaleLineEdit(inStore, { cost: 'abc' }), EditError);
assert.throws(() => planSaleLineEdit(inStore, { category: '' }), EditError);
assert.throws(() => planSaleLineEdit(inStore, { category: 'x'.repeat(61) }), EditError);

const item = { id: '11111111-2222-4333-8444-555555555555', data: { name: 'Charizard', cost: 4, category: 'Other', quantity: 1 }, updated_at: '2026-09-27T10:00:00.123456+00:00' };
const itemPlan = planItemEdit(item, { cost: 6.5, category: 'Pokemon TCG' });
assert.deepEqual(itemPlan.data, { name: 'Charizard', cost: 6.5, category: 'Pokemon TCG', quantity: 1 }, 'other item fields are untouched');
assert.deepEqual(itemPlan.changes, [{ field: 'cost', old: 4, new: 6.5 }, { field: 'category', old: 'Other', new: 'Pokemon TCG' }]);
assert.equal(item.data.cost, 4, 'planning never mutates the loaded item');
console.log('Safe-edit planning checks passed');

// --- Writes: guarded, logged, reverted if the log fails ----------------------------
function mockDb({ line, item: row, patchMatches = true, logFails = false, rpc } = {}) {
  const calls = [];
  const fetch = async (env, path, options = {}) => {
    calls.push({ path, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    if (path.startsWith('pos_sale_lines?') && !options.method) return { data: line ? [line] : [] };
    if (path.startsWith('inventory_items?') && !options.method) return { data: row ? [row] : [] };
    if (options.method === 'PATCH' && options.headers?.Prefer === 'return=representation') return { data: patchMatches ? [{ ...(line || row), ...JSON.parse(options.body) }] : [] };
    if (path === 'database_edit_log') { if (logFails) throw new Error('log down'); return { data: null }; }
    if (path === 'rpc/adjust_customer_points') return rpc();
    return { data: null };
  };
  return { fetch, calls };
}
const user = { id: 'u-owner', email: 'owner@example.com' };
{
  const { fetch, calls } = mockDb({ line: inStore });
  const result = await editSaleLine({}, fetch, 'store-1', user, { id: 'l1', cost: 12, reason: 'invoice said $12' });
  assert.equal(result.line.profit, 18);
  const patch = calls.find(c => c.method === 'PATCH');
  assert.match(patch.path, /store_id=eq\.store-1/, 'scoped to the caller\'s store');
  assert.match(patch.path, /cost_basis=eq\.10/, 'only applies if nobody changed the line meanwhile');
  const log = calls.find(c => c.path === 'database_edit_log').body;
  assert.deepEqual(log.map(r => [r.table_name, r.row_id, r.field, r.old_value, r.new_value]), [['pos_sale_lines', 'l1', 'cost', 10, 12], ['pos_sale_lines', 'l1', 'profit', 20, 18]]);
  assert.ok(log.every(r => r.edited_by === 'u-owner' && r.edited_by_email === 'owner@example.com' && r.reason === 'invoice said $12' && r.store_id === 'store-1'));
}
{
  const { fetch } = mockDb({ line: inStore, patchMatches: false });
  await assert.rejects(editSaleLine({}, fetch, 'store-1', user, { id: 'l1', cost: 12 }), e => e.status === 409);
}
{
  // No log, no change: the line is put back.
  const { fetch, calls } = mockDb({ line: inStore, logFails: true });
  await assert.rejects(editSaleLine({}, fetch, 'store-1', user, { id: 'l1', cost: 12 }), /audit log/);
  const revert = calls.filter(c => c.method === 'PATCH').pop();
  assert.deepEqual(revert.body, { cost_basis: 10, profit: 20, category: 'Sports' });
}
{
  const { fetch } = mockDb({});
  await assert.rejects(editSaleLine({}, fetch, 'store-1', user, { id: 'nope', cost: 1 }), e => e.status === 404, 'another store\'s line reads as not found');
}
{
  const { fetch, calls } = mockDb({ item });
  await editInventoryItem({}, fetch, 'store-1', user, { id: item.id, category: 'Pokemon TCG' });
  const patch = calls.find(c => c.method === 'PATCH');
  assert.match(patch.path, /updated_at=eq\./, 'item edit is guarded on updated_at');
  assert.equal(patch.body.data.category, 'Pokemon TCG');
  assert.equal(patch.body.data.name, 'Charizard');
}
{
  let sent;
  const { fetch } = mockDb({ rpc: () => ({ data: 350 }) });
  const wrapped = async (env, path, options) => { if (path === 'rpc/adjust_customer_points') sent = JSON.parse(options.body); return fetch(env, path, options); };
  const result = await adjustCustomerPoints({}, wrapped, 'store-1', user, { id: item.id, delta: 250, reason: 'Missed web order points' });
  assert.equal(result.balance, 350);
  assert.deepEqual(sent, { p_store_id: 'store-1', p_customer_id: item.id, p_delta: 250, p_reason: 'Missed web order points', p_user_id: 'u-owner', p_user_email: 'owner@example.com' });
  await assert.rejects(adjustCustomerPoints({}, wrapped, 'store-1', user, { id: item.id, delta: 5, reason: '' }), /reason/);
  await assert.rejects(adjustCustomerPoints({}, wrapped, 'store-1', user, { id: item.id, delta: 1.5, reason: 'abc' }), /whole number/);
  const below = mockDb({ rpc: () => { throw new Error('that would take the balance below zero (it is 40)'); } });
  await assert.rejects(adjustCustomerPoints({}, below.fetch, 'store-1', user, { id: item.id, delta: -100, reason: 'correction' }), e => e.status === 409 && /below zero/.test(e.message));
}
console.log('Safe-edit write checks passed');

// --- Wiring --------------------------------------------------------------------
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const route = worker.slice(worker.indexOf("url.pathname === '/store/db/edit'"), worker.indexOf("url.pathname === '/store/db/tables'"));
assert.match(route, /requireStoreUser\(request, env, storeId, \['owner','admin'\]\)/g, 'edits are owner/admin only');
assert.doesNotMatch(route, /method: ?'DELETE'/, 'no deletes from the viewer');
assert.match(worker, /\['database_edit_log','Database viewer edits'\]/, 'the edit log is browsable in Tables');
const migration = fs.readFileSync('supabase-migrations/2026-09-27-database-safe-edits.sql', 'utf8');
assert.match(migration, /enable row level security/);
assert.match(migration, /revoke insert, update, delete, truncate on public\.database_edit_log from anon, authenticated/, 'nobody but the Worker can write or rewrite the log');
assert.match(migration, /for update;[\s\S]*if v_new < 0 then/, 'points adjust locks the row and refuses a negative balance');
const viewer = fs.readFileSync('scripts/database-viewer.js', 'utf8');
for (const fn of ['editDatabaseSaleLine', 'editDatabaseItem', 'adjustDatabasePoints']) assert.match(viewer, new RegExp(`window\\.${fn}=`), `${fn} is callable from onclick`);
assert.doesNotMatch(viewer, /kind:'delete'|method:'DELETE'/);
console.log('Safe-edit wiring checks passed');
