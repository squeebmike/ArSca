import fs from 'node:fs';
import assert from 'node:assert/strict';

// The Supabase API returns at most 1,000 rows per request, whatever limit is
// asked for (seen live: limit=2000 answered with content-range 0-999). The
// store is past 1,600 inventory items, so any single capped read of the
// whole inventory silently misses items. These checks pin the paging
// helpers and the places that read the whole inventory.

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const deckLab = fs.readFileSync('mtg-deck-lab.html', 'utf8');
const grab = (src, re) => { const m = src.match(re); assert.ok(m, 'missing ' + re); return m[0]; };

// ── Worker helper: pages to the end, 1,000 at a time, stops on failure.
{
  const src = grab(worker, /async function supabaseAdminFetchAll\(env, path, maxRows = 50000\) \{[\s\S]*?\n\}\n/);
  const table = Array.from({ length: 2345 }, (_, i) => ({ id: i }));
  const calls = [];
  let failAt = -1;
  const supabaseAdminFetch = async (env, path) => {
    calls.push(path);
    const offset = Number(path.match(/offset=(\d+)/)[1]);
    assert.match(path, /limit=1000&offset=\d+$/, 'each page asks for 1,000 at an offset');
    if (offset === failAt) return { data: null, response: { ok: false } };
    return { data: table.slice(offset, offset + 1000), response: { ok: true } };
  };
  const fetchAll = new Function('supabaseAdminFetch', `${src}; return supabaseAdminFetchAll;`)(supabaseAdminFetch);
  const all = await fetchAll({}, 'inventory_items?store_id=eq.S&order=id.asc');
  assert.equal(all.data.length, 2345, 'all rows across pages');
  assert.ok(all.response.ok);
  assert.equal(calls.length, 3);
  assert.ok(calls[0].startsWith('inventory_items?store_id=eq.S&order=id.asc&limit=1000&offset=0'), 'appends paging to a path that already has a query string');
  failAt = 1000; calls.length = 0;
  const failed = await fetchAll({}, 'inventory_items?store_id=eq.S&order=id.asc');
  assert.equal(failed.response.ok, false, 'a failed page is reported as not ok');
  assert.equal(failed.data.length, 1000, 'rows before the failed page are returned, nothing more');
  const exact = await (async () => { failAt = -1; table.length = 2000; return fetchAll({}, 'x?a=1'); })();
  assert.equal(exact.data.length, 2000, 'an exact multiple of 1,000 still ends cleanly');
}

// ── Dashboard helper: same, over a supabase-js query builder.
{
  const src = grab(dashboard, /async function sbSelectAll\(makeQuery, maxRows = 50000\)\{[\s\S]*?\n\}\n/);
  const sbSelectAll = new Function(`${src}; return sbSelectAll;`)();
  const table = Array.from({ length: 1615 }, (_, i) => ({ id: i }));
  let failAt = -1;
  const make = () => ({ range: (a, z) => Promise.resolve(a === failAt ? { data: null, error: new Error('boom') } : { data: table.slice(a, Math.min(z + 1, a + 1000)), error: null }) });
  const ok = await sbSelectAll(make);
  assert.equal(ok.data.length, 1615);
  assert.equal(ok.error, null);
  failAt = 1000;
  const bad = await sbSelectAll(make);
  assert.ok(bad.error, 'errors are passed back');
}

// ── Whole-inventory reads must page.
const reprice = grab(worker, /async function runScheduledEbayReprice\(env\) \{[\s\S]*?\n\}\n/);
assert.match(reprice, /supabaseAdminFetchAll\(env, `inventory_items\?store_id=eq\.\$\{encodeURIComponent\(storeId\)\}&status=eq\.in_stock&select=id,data,updated_at&order=id\.asc`\)/, 'eBay auto-reprice must see every in-stock item, not the first 1,000');
const deals = grab(worker, /async function runScheduledDealScans\(env\) \{[\s\S]*?\n\}\n/);
assert.match(deals, /supabaseAdminFetchAll\(env, `inventory_items\?store_id=eq\.\$\{encodeURIComponent\(storeId\)\}&status=neq\.sold&select=id,data,status,created_at,updated_at&order=id\.asc`\)/, 'deal scans must see every unsold item, not the first 1,000');
assert.doesNotMatch(worker, /supabaseAdminFetch\(env, `inventory_items\?[^`]*&limit=1000`\)/, 'no single capped read of inventory_items in the worker');

const pull = grab(dashboard, /async function pullInventoryFromSupabase\(\)\{[\s\S]*?\n\}\n/);
assert.match(pull, /await sbSelectAll\(\(\) => sb\s*\n\s*\.from\('inventory_items'\)/, 'manual pull must page through every item');
assert.doesNotMatch(pull, /\.limit\(1000\)/);

assert.doesNotMatch(deckLab, /from\('inventory_items'\)[^;]*\.limit\(1000\)/, 'Deck Lab must not stop at 1,000 inventory items');
assert.match(deckLab, /for\(let off=0;off<50000;off\+=1000\)\{const r=await sb\.from\('inventory_items'\)[^;]*?\.range\(off,off\+999\);/, 'Deck Lab pages through inventory');

console.log('Row cap paging checks passed');
