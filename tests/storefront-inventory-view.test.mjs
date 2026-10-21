import assert from 'node:assert/strict';
import fs from 'node:fs';

// The public catalog load was what drained the database's disk budget:
// ~100 data->'key' fields per row made Postgres re-read every row ~100 times
// and sort on disk (2.1s, 5MB of temp files per page; 1,079 loads in five
// hours). The storefront_inventory view builds the same data object in one
// pass (0.12s, nothing on disk).
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const sql = fs.readFileSync('supabase-migrations/2026-10-21-storefront-inventory-view.sql', 'utf8');
const keys = JSON.parse(worker.match(/const STOREFRONT_DATA_KEYS=(\[[^\]]+\])/)[1]);
const viewKeys = sql.match(/array\[([^\]]+)\]/)[1].split(',').map(k => k.trim().replace(/^'|'$/g, ''));
assert.deepEqual(viewKeys, [...keys, 'raw', 'externalRefs'], 'the view returns exactly the fields the shop reads');
assert.match(sql, /with \(security_invoker = true\)/);
assert.match(sql, /revoke all on public\.storefront_inventory from public, anon, authenticated;/, 'not readable through the public API');
assert.match(sql, /grant select on public\.storefront_inventory to service_role;/);

// The Worker reads the view, and only falls back to the old select if the
// view is missing (a 404), never on an ordinary failure (which would double
// the load on a struggling database).
const fn = name => { const s = worker.indexOf('async function ' + name + '('); assert.ok(s >= 0, name); return worker.slice(s, worker.indexOf('\n}\n', s) + 2); };
const calls = [];
const page = new Function('supabaseAdminFetch', 'STOREFRONT_SELECT', fn('fetchStorefrontPage') + '; return fetchStorefrontPage;')(
  async (env, path) => { calls.push(path); return path.startsWith('storefront_inventory') ? env.view : { response: { ok: true, status: 200 }, data: ['old'] }; }, 'id,sf_name:data->name');
{
  calls.length = 0;
  const r = await page({ view: { response: { ok: true, status: 200 }, data: ['new'] } }, 'store_id=eq.s&order=id.asc', 1000);
  assert.deepEqual(r.data, ['new']);
  assert.deepEqual(calls, ['storefront_inventory?store_id=eq.s&order=id.asc&select=id,status,created_at,updated_at,data&limit=1000&offset=1000']);
}
{
  calls.length = 0;
  const r = await page({ view: { response: { ok: false, status: 404 }, data: null } }, 'store_id=eq.s', 0);
  assert.deepEqual(r.data, ['old'], 'view missing: the old select');
  assert.equal(calls[1], 'inventory_items?store_id=eq.s&select=id,sf_name:data->name&limit=1000&offset=0');
}
{
  calls.length = 0;
  const r = await page({ view: { response: { ok: false, status: 503 }, data: null } }, 'store_id=eq.s', 0);
  assert.equal(r.response.status, 503);
  assert.equal(calls.length, 1, 'a failing database is not asked twice');
}
assert.match(fn('fetchAllListableStorefrontItems'), /fetchStorefrontPage\(env, `store_id=eq\.\$\{encodeURIComponent\(ITEM_DETAIL_STORE_ID\)\}&order=updated_at\.desc,id\.asc`, offset, options\)/);
assert.match(worker, /fetchStorefrontPage\(env, 'store_id=eq\.'\+encodeURIComponent\(ITEM_DETAIL_STORE_ID\)\+'&data->>dropship=eq\.true&data->>vendor=ilike\.BCW&order=id\.asc', offset, \{signal\}\)/, 'the supplies catalog too');
// Row shape: a view row already has data, which the shop code passes through.
assert.match(worker, /function storefrontProjectedRow\(row\)\{if\(row\.data\)return row;/);
// The shared snapshot stays fresh 5 minutes (was 1).
assert.match(worker, /fetchAllListableStorefrontItems\(env,\{signal:sharedSignal\}\),\{freshMs:300000,maxAgeMs:900000\}\);/);
console.log('Storefront inventory view checks passed');
