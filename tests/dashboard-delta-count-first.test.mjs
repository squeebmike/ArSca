import fs from 'node:fs';
import assert from 'node:assert/strict';

// Egress over the Supabase Free Plan (2026-10-31): every open dashboard
// downloaded the whole item id list (~200 KB) on its 60-second live sync,
// just to notice deletions. Now each tick asks for the item count; the list
// is only downloaded when the count doesn't match what's shown, and at least
// every 15 minutes anyway.
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const grab = re => { const m = dashboard.match(re); assert.ok(m, 'missing ' + re); return m[0]; };
const src = [
  grab(/const BUILT_IN_MANIFEST_RECHECK_MS = [^\n]+\n/),
  grab(/async function builtInInventoryCount\(sb, storeId\)\{[\s\S]*?\n\}\n/),
  grab(/async function refreshBuiltInInventoryDelta\(\)\{[\s\S]*?\n  return true;\n\}\n/),
].join('\n');

function harness(table) {
  const calls = { count: 0, manifest: 0, changed: 0, byId: 0 };
  const from = () => {
    const st = { filters: [], head: false, cols: '', count: false, range: null };
    const run = () => {
      let rows = table.filter(r => st.filters.every(f => f(r)));
      if (st.head) { calls.count++; return { data: null, count: rows.length, error: null }; }
      if (st.cols === 'id,updated_at') calls.manifest++;
      else if (st.ins) calls.byId++;
      else calls.changed++;
      rows = rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const total = rows.length;
      if (st.range) rows = rows.slice(st.range[0], st.range[1] + 1);
      return { data: rows.map(r => ({ ...r })), count: st.count ? total : null, error: null };
    };
    const b = {
      select(cols, opts) { st.cols = cols; st.count = !!opts?.count; st.head = !!opts?.head; return b; },
      eq(col, v) { st.filters.push(r => r[col] === v); return b; },
      gt(col, v) { st.filters.push(r => Date.parse(r[col]) > Date.parse(v)); return b; },
      in(col, vs) { st.ins = vs; st.filters.push(r => vs.includes(r[col])); return b; },
      order() { return b; },
      range(a, z) { st.range = [a, z]; return b; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return b;
  };
  return { sb: { from }, calls };
}

const fetchInventoryVersions = async (sb, storeId) => {
  const { data } = await sb.from('inventory_items').select('id,updated_at').eq('store_id', storeId).order('id').range(0, 999);
  return data;
};

function makeDashboard(table, sb, now) {
  const state = { all: [], watermark: '2026-10-31T10:00:00Z', checkedAt: now.value };
  const g = {
    getSupabaseClient: () => sb, getAuthSession: () => ({ supabase: true }), getActiveStoreId: () => 'S',
    fetchInventoryVersions, applyInventoryEditOverrides: x => x,
    mapBuiltInItem: r => ({ id: r.id, source: 'built_in', status: r.status }),
    renderAll() {}, renderInventoryCategoryFilters() {}, APP_VERSION: 't',
    document: { getElementById: () => null }, Date: { now: () => now.value },
  };
  const fn = new Function(...Object.keys(g), 'state', `
    let all = state.all, soldData = [], filtered = [];
    let _builtInSyncWatermark = state.watermark, _builtInManifestCheckedAt = state.checkedAt;
    ${src}
    return async () => { all = state.all; const r = await refreshBuiltInInventoryDelta(); state.all = all; state.checkedAt = _builtInManifestCheckedAt; return r; };
  `)(...Object.values(g), state);
  state.all = table.map(r => ({ id: r.id, source: 'built_in', status: r.status }));
  return { tick: fn, state };
}

const row = (id, at = '2026-10-31T09:00:00Z') => ({ id, store_id: 'S', status: 'in_stock', data: {}, created_at: at, updated_at: at });
const table = ['a', 'b', 'c'].map(id => row(id));
const now = { value: 1_000_000 };
const { sb, calls } = harness(table);
const dash = makeDashboard(table, sb, now);

// Nothing changed: a count, the (empty) changed rows, no id list.
assert.equal(await dash.tick(), true);
assert.deepEqual(calls, { count: 1, manifest: 0, changed: 1, byId: 0 }, 'a quiet tick downloads no id list');

// An edit: picked up from the changed rows, still no id list.
table[0].updated_at = '2026-10-31T11:00:00Z'; table[0].status = 'sold';
now.value += 60_000;
await dash.tick();
assert.equal(calls.manifest, 0);
assert.equal(dash.state.all.find(i => i.id === 'a').status, 'sold');

// A new item: the count goes up with it, still matches, no id list.
table.push(row('d', '2026-10-31T11:05:00Z'));
now.value += 60_000;
await dash.tick();
assert.equal(calls.manifest, 0);
assert.deepEqual(dash.state.all.map(i => i.id).sort(), ['a', 'b', 'c', 'd']);

// A deletion: the count no longer matches, so the id list is downloaded and the item drops off.
table.splice(table.findIndex(r => r.id === 'b'), 1);
now.value += 60_000;
await dash.tick();
assert.equal(calls.manifest, 1, 'a deletion is noticed through the count');
assert.deepEqual(dash.state.all.map(i => i.id).sort(), ['a', 'c', 'd']);

// An item missing here (inserted with an old timestamp) shows up once the list is rechecked (15 minutes).
table.push(row('e', '2026-10-30T00:00:00Z'));
table.splice(table.findIndex(r => r.id === 'c'), 1); // count stays equal
now.value += 60_000;
await dash.tick();
assert.equal(calls.manifest, 1, 'equal count within 15 minutes: no list');
now.value += 15 * 60_000;
await dash.tick();
assert.equal(calls.manifest, 2, 'the list is rechecked at least every 15 minutes');
assert.deepEqual(dash.state.all.map(i => i.id).sort(), ['a', 'd', 'e']);

// If the count can't be read, it falls back to the list as before.
const broken = harness(table);
const origFrom = broken.sb.from;
broken.sb.from = () => { const b = origFrom(); const sel = b.select; b.select = (c, o) => o?.head ? { eq: () => Promise.resolve({ error: new Error('x') }) } : sel(c, o); return b; };
const dash2 = makeDashboard(table, broken.sb, { value: 5_000_000 });
await dash2.tick();
assert.equal(broken.calls.manifest, 1, 'no count: the list is downloaded');

// Startup (device copy or full download) counts as a fresh list.
assert.equal((dashboard.match(/_builtInSyncWatermark = rows\[0\]\.updated_at;\n\s*_builtInManifestCheckedAt = Date\.now\(\);/g) || []).length, 2);
console.log('dashboard delta count-first checks passed');
