import fs from 'node:fs';
import assert from 'node:assert/strict';

// The dashboard keeps the last full set of inventory rows on the device and,
// on open, downloads every item's id + updated_at and the full record only
// for items whose updated_at differs from the copy (or that it lacks). These
// checks run the real syncInventoryCopy / fetchInventoryVersions against a
// mock Supabase client that honours the filters, and check the result always
// equals what a full download returns.

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const grab = re => { const m = dashboard.match(re); assert.ok(m, 'missing ' + re); return m[0]; };
const src = [
  grab(/const INV_ROW_COLUMNS = [^\n]+\n/),
  grab(/async function fetchInventoryVersions\(sb, storeId\)\{[\s\S]*?\n\}\n/),
  grab(/async function syncInventoryCopy\(sb, storeId, cachedRows\)\{[\s\S]*?\n\}\n/),
].join('\n');
const { syncInventoryCopy } = new Function(`${src}; return { syncInventoryCopy };`)();

// Mock table + query builder (store_id eq, gt updated_at, in id, order, range, count, a row cap).
function mockClient(table, { cap = 1000, failOn = null } = {}) {
  const calls = [];
  const from = () => {
    const st = { filters: [], orders: [], range: null, count: false, ins: null, cols: '' };
    const b = {
      select(cols, opts) { st.cols = cols; st.count = !!opts?.count; return b; },
      eq(col, v) { st.filters.push(r => r[col] === v); return b; },
      gt(col, v) { st.filters.push(r => Date.parse(r[col]) > Date.parse(v)); return b; },
      in(col, vs) { st.ins = vs; st.filters.push(r => vs.includes(r[col])); return b; },
      order(col, { ascending }) { st.orders.push([col, ascending]); return b; },
      range(a, z) { st.range = [a, z]; return b; },
      then(res, rej) {
        calls.push({ cols: st.cols, range: st.range, ins: st.ins?.length || 0 });
        if (failOn && failOn(st)) return Promise.resolve({ data: null, error: new Error('boom') }).then(res, rej);
        let rows = table.filter(r => st.filters.every(f => f(r)));
        const total = rows.length;
        rows = [...rows].sort((x, y) => { for (const [c, asc] of st.orders) { const d = (c === 'updated_at' ? Date.parse(x[c]) - Date.parse(y[c]) : String(x[c]).localeCompare(String(y[c]))); if (d) return asc ? d : -d; } return 0; });
        if (st.range) rows = rows.slice(st.range[0], Math.min(st.range[1] + 1, st.range[0] + cap));
        const data = rows.map(r => st.cols === 'id,updated_at' ? { id: r.id, updated_at: r.updated_at } : { ...r });
        return Promise.resolve({ data, error: null, count: st.count ? total : null }).then(res, rej);
      },
    };
    return b;
  };
  return { sb: { from }, calls };
}

const T0 = Date.parse('2026-09-01T00:00:00Z');
const at = min => new Date(T0 + min * 60000).toISOString();
const makeRow = (i, min, extra = {}) => ({ id: 'id' + String(i).padStart(5, '0'), store_id: 'S', data: { name: 'Item ' + i, v: 1 }, status: 'in_stock', created_at: at(0), updated_at: at(min), ...extra });
const fullDownload = table => table.filter(r => r.store_id === 'S').sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || a.id.localeCompare(b.id)).map(r => r.id + ':' + JSON.stringify(r.data));
const asKeys = rows => rows.map(r => r.id + ':' + JSON.stringify(r.data));

for (const cap of [1000, 500]) {
  // Server now: 1,581 rows. Device copy: taken at minute 1000.
  const server = Array.from({ length: 1581 }, (_, i) => makeRow(i, i % 900));
  server.push(makeRow(99999, 5, { store_id: 'OTHER' }));
  const copy = server.filter(r => r.store_id === 'S').map(r => ({ ...r, data: { ...r.data } }));

  // Since the copy: 3 edits, 2 deletes, 2 new items, 1 insert with an old timestamp, and an edit
  // stamped 5 minutes before the copy's newest row (a late-committing transaction).
  server.find(r => r.id === 'id00010').data = { name: 'Edited 10', v: 2 };
  server.find(r => r.id === 'id00010').updated_at = at(2000);
  server.find(r => r.id === 'id00500').data = { name: 'Edited 500', v: 2 };
  server.find(r => r.id === 'id00500').updated_at = at(2001);
  server.find(r => r.id === 'id01500').status = 'sold';
  server.find(r => r.id === 'id01500').updated_at = at(2002);
  server.splice(server.findIndex(r => r.id === 'id00020'), 1);
  server.splice(server.findIndex(r => r.id === 'id00021'), 1);
  server.push(makeRow(2000, 2003), makeRow(2001, 2004));
  server.push(makeRow(3000, 1)); // old timestamp, not in the copy
  const newestInCopy = Math.max(...copy.map(r => Date.parse(r.updated_at)));
  const late = server.find(r => r.id === 'id00030');
  late.data = { name: 'Late commit', v: 3 };
  late.updated_at = new Date(newestInCopy - 5 * 60000).toISOString();

  const { sb, calls } = mockClient(server, { cap });
  const { rows, changed } = await syncInventoryCopy(sb, 'S', copy);
  assert.deepEqual(asKeys(rows), fullDownload(server), `cap ${cap}: synced copy must equal a full download (edits, deletes, adds, old-timestamp insert, late commit)`);
  assert.ok(changed < 20, `cap ${cap}: only the changed rows are downloaded, not all ${rows.length} (got ${changed})`);
  assert.equal(changed, 7, `cap ${cap}: exactly the 3 edits, 2 new items, the old-timestamp insert and the late commit are downloaded (got ${changed})`);
  const fullRowCalls = calls.filter(c => c.cols !== 'id,updated_at');
  assert.equal(fullRowCalls.length, 1, `cap ${cap}: one full-row request for the changed items (got ${fullRowCalls.length})`);
}

// Nothing changed -- even right after a bulk edit of 600 items in one
// minute -- means no full rows downloaded at all, and the same result.
{
  const server = Array.from({ length: 1200 }, (_, i) => makeRow(i, i < 600 ? 5000 : i));
  const copy = server.map(r => ({ ...r }));
  const { sb, calls } = mockClient(server);
  const { rows, changed } = await syncInventoryCopy(sb, 'S', copy);
  assert.deepEqual(asKeys(rows), fullDownload(server));
  assert.equal(changed, 0, 'an unchanged store downloads no full records');
  assert.equal(calls.filter(c => c.cols !== 'id,updated_at').length, 0, 'no full-row requests when nothing changed');
}

// Failures must throw (caller falls back to a full download), never return a partial set.
{
  const server = Array.from({ length: 1500 }, (_, i) => makeRow(i, i));
  const copy = server.map(r => ({ ...r }));
  for (const failOn of [st => st.cols === 'id,updated_at' && st.range?.[0] === 1000, st => !!st.ins]) {
    const extra = [...server, makeRow(9000, 1)]; // forces a full-row fetch
    const { sb } = mockClient(extra, { failOn });
    await assert.rejects(() => syncInventoryCopy(sb, 'S', copy), 'a failed request must throw');
  }
  await assert.rejects(() => syncInventoryCopy(mockClient(server).sb, 'S', []), 'an empty copy must not be used');
}

// Wiring: the loader tries the copy first, falls back to the full download,
// saves only complete full downloads, and log out clears the copy.
const loader = grab(/async function loadBuiltInInventoryItems\(\)\{[\s\S]*?\r?\n\}\r?\n/);
assert.match(loader, /readInventoryCache\(storeId\)[\s\S]*syncInventoryCopy\(sb, storeId, cached\.rows\)[\s\S]*catch\(e\)[\s\S]*const PAGE = 1000;/, 'copy first, full download as the fallback');
assert.match(loader, /Date\.now\(\) - Number\(cached\.fullLoadedAt \|\| 0\) < INV_CACHE_MAX_AGE_MS/, 'an old copy (over a day) must trigger a full download');
assert.match(loader, /if\(!loadFailed && rows\.length\) \{ const fullLoadedAt = Date\.now\(\); setTimeout\(\(\) => writeInventoryCache\(storeId, rows, fullLoadedAt\)/, 'only a complete full download may be saved as a fresh copy');
assert.match(dashboard, /await sb\.auth\.signOut\(\)\.catch\(\(\)=>\{\}\);\s*\n\s*await clearInventoryCache\(\);/, 'log out must clear the device copy');
assert.match(dashboard, /function inventoryCacheKey\(storeId\)\{\s*\n\s*return storeId \+ ':' \+ \(getAuthSession\(\)\?\.user\?\.id \|\| ''\);/, 'the copy is kept per store and per user');

console.log('Inventory device copy checks passed');
