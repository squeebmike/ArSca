import assert from 'node:assert/strict';
import fs from 'node:fs';
import { whatnotListingCost, applyWhatnotListingCosts, nextWhatnotShow, addItemsToWhatnotShow, processWhatnotOrder } from '../scripts/whatnot-sync.mjs';

// Store, 2026-11-01: "do 3 and 4" -- real show profit for listings made
// straight on Whatnot, and ADD TO NEXT WHATNOT SHOW.

// Cost by title: first matching rule, else the default, else none.
const settings = { listingCosts: { rules: [{ match: 'ManaPocket', cost: 1.5 }, { match: 'bundle', cost: 6 }], defaultCost: 2 } };
assert.equal(whatnotListingCost('Comic Book ManaPocket #12', settings), 1.5);
assert.equal(whatnotListingCost('bIG bOY bUNDLE #17', settings), 6, 'case does not matter');
assert.equal(whatnotListingCost('Giant-Size X-Men #1', settings), 2, 'the default');
assert.equal(whatnotListingCost('Anything', { listingCosts: { rules: [] } }), null, 'nothing set');
assert.equal(whatnotListingCost('Anything', {}), null);

// New Whatnot-only sales carry the cost; a Whatnot-only giveaway with a cost is recorded.
{
  const sales = [], kv = new Map();
  const items = [
    { id: 'i1', quantity: 2, unit_price: { amount: '4.00' }, product_external_id: null, purchased_item: { title: 'Comic Book ManaPocket #3' } },
  ];
  const deps = { storeId: 'S', feeSettings: {}, listingSettings: settings, kvGet: async k => kv.get(k) ?? null, kvPut: async (k, v) => { kv.set(k, v); },
    api: async () => ({ ok: true, status: 200, data: { data: items, next_cursor: null } }),
    recordSale: async b => { sales.push(b); return { ok: true, status: 200, data: { ok: true } }; }, voidOrder: async () => 0 };
  await processWhatnotOrder({ id: 'o1', status: 'completed' }, deps);
  assert.equal(sales[0].cost, 3, '$1.50 x 2');
  items[0] = { id: 'g', quantity: 1, unit_price: { amount: '0' }, product_external_id: null, purchased_item: { title: 'Bundle giveaway' } };
  await processWhatnotOrder({ id: 'o2', status: 'completed', transaction_type: 'giveaway' }, deps);
  assert.equal(sales[1].giveaway, true); assert.equal(sales[1].cost, 6);
  await processWhatnotOrder({ id: 'o3', status: 'completed', transaction_type: 'giveaway' }, { ...deps, listingSettings: {} });
  assert.equal(sales.length, 2, 'a Whatnot-only giveaway with no cost set is still skipped');
}

// Past sales at $0 get the cost; profit drops by it; shows worked out again.
{
  const patches = [];
  const db = async (path, opts) => {
    if (opts?.method === 'PATCH') { patches.push([path, JSON.parse(opts.body)]); return { response: { ok: true } }; }
    if (path.startsWith('pos_payments')) { assert.match(path, /reference=like\.whatnot-api:\*/); return { data: [{ sale_id: 's1' }, { sale_id: 's2' }, { sale_id: 's3' }] }; }
    assert.match(path, /item_id=is\.null&cost_basis=eq\.0/);
    return { data: [{ id: 'l1', title: 'Comic Book ManaPocket #9', quantity: 1, profit: 9.8 }, { id: 'l2', title: 'Giveaway: TOOFER #2', quantity: 1, profit: 0 }, { id: 'l3', title: 'Bundle #1', quantity: 2, profit: 20 }] };
  };
  let refreshed = 0;
  const res = await applyWhatnotListingCosts({ storeId: 'S', db, listingSettings: { listingCosts: { rules: [{ match: 'ManaPocket', cost: 1.5 }, { match: 'bundle', cost: 6 }] } }, refreshShows: async () => { refreshed++; return [{ title: 'Show', net: 40 }]; } });
  assert.equal(res.lines, 2); assert.equal(res.noRule, 1, 'TOOFER matched nothing'); assert.equal(res.total, 13.5);
  assert.deepEqual(patches[0][1], { cost_basis: 1.5, profit: 8.3 });
  assert.deepEqual(patches[1][1], { cost_basis: 12, profit: 8 }, 'whole cost for 2, like record-external-sale');
  assert.equal(refreshed, 1); assert.equal(res.shows.length, 1);
}

// The next scheduled show: the soonest one still ahead.
{
  const now = Date.parse('2026-11-01T12:00:00Z');
  const api = async (m, path) => { assert.equal(path, '/shows?status=scheduled&limit=20&reverse=false'); return { ok: true, status: 200, data: { data: [
    { id: 'b', title: 'Later', scheduled_start_at: '2026-11-04T19:00:00.000Z' },
    { id: 'a', title: 'Sooner', scheduled_start_at: '2026-11-04T00:20:00.000Z' },
    { id: 'old', title: 'Yesterday', scheduled_start_at: '2026-10-31T00:00:00.000Z' },
  ] } }; };
  assert.equal((await nextWhatnotShow(api, now)).id, 'a');
  assert.equal(await nextWhatnotShow(async () => ({ ok: true, status: 200, data: { data: [] } }), now), null);
}

// Adding to a show: listed items go straight in; a ticked item not yet on
// Whatnot is listed first; one not set to sell on Whatnot is reported.
{
  const kv = new Map([['whatnot-link:S:a', { productId: 'pa', variantId: 'va', price: 5, qty: 1, published: true }]]);
  const calls = [];
  let n = 0;
  const api = async (m, path, body) => {
    calls.push([m, path, body]);
    if (m === 'POST' && path === '/products') return { ok: true, status: 201, data: { id: 'pb' + (++n), dimension_profile: { id: '1' } } };
    if (m === 'GET' && path.includes('/variants')) return { ok: true, status: 200, data: { data: [{ id: 'vb' }] } };
    if (m === 'PATCH') return { ok: true, status: 200, data: {} };
    if (path === '/inventory/set') return { ok: true, status: 200, data: { results: [{ status: 'applied' }] } };
    if (path.startsWith('/merchandising/')) return { ok: true, status: 200, data: {} };
    throw new Error(path);
  };
  const rows = [
    { id: 'a', status: 'in_stock', data: { name: 'A', sellOnWhatnot: true, quantity: 1 } },
    { id: 'b', status: 'in_stock', data: { name: 'B', sellOnWhatnot: true, quantity: 1 } },
    { id: 'c', status: 'in_stock', data: { name: 'C', quantity: 1 } },
  ];
  const results = await addItemsToWhatnotShow(['a', 'b', 'c'], 'show-1', {
    api, storeId: 'S', kvGet: async k => kv.get(k) ?? null, kvPut: async (k, v) => { kv.set(k, v); },
    rows: async () => rows, shape: r => ({ name: r.data.name, price: 5, categorySlug: 'pokemon', photos: ['https://x/y.jpg'] }),
    profileId: () => '', saveProfileId: async () => {} });
  assert.deepEqual(results.map(r => [r.id, !!r.added, r.error || '']), [['a', true, ''], ['b', true, ''], ['c', false, 'Not set to sell on Whatnot']]);
  const adds = calls.filter(([m, p, b]) => p.startsWith('/merchandising/') && b?.shows);
  assert.deepEqual(adds.map(([, p, b]) => [p, b.shows]), [['/merchandising/products/pa', { strategy: 'ADD', show_ids: ['show-1'] }], ['/merchandising/products/pb1', { strategy: 'ADD', show_ids: ['show-1'] }]]);
  assert.ok(calls.findIndex(([, p]) => p === '/products') < calls.findIndex(([, p, b]) => p === '/merchandising/products/pb1' && b?.shows), 'B listed before it is added');
  assert.deepEqual(kv.get('whatnot-link:S:a').shows, ['show-1']);
  assert.equal(kv.get('whatnot-linked:S').b, 'ok');
}

// Wiring.
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
for (const route of ["'/whatnot/apply-costs' && request.method === 'POST'", "'/whatnot/shows/next' && request.method === 'GET'", "'/whatnot/show-add' && request.method === 'POST'"]) assert.ok(worker.includes(route), route);
assert.match(worker, /if \(existing\?\.listingCosts && !settings\.listingCosts\) kept\.listingCosts = existing\.listingCosts;/, 'the export screen saving its own copy keeps the costs');
assert.match(worker, /if \(existing && 'autoTitles' in existing && !\('autoTitles' in settings\)\) kept\.autoTitles = existing\.autoTitles;/, 'and the auto-title choice');
assert.match(worker, /listingSettings: await whatnotListingSettings\(env, storeId\) \};\n    if \(type\.startsWith\('orders\.'\)/, 'webhook sales use the costs');
const dash = fs.readFileSync('dashboard.html', 'utf8');
assert.match(dash, /onclick="addSelectedToNextWhatnotShow\(\)"[^>]*>ADD TO NEXT WHATNOT SHOW</);
const parseSrc = dash.match(/function parseWhatnotCostRules\(text\)\{[\s\S]*?\n\}\n/)[0];
const parse = new Function(parseSrc + '; return parseWhatnotCostRules;')();
assert.deepEqual(parse('ManaPocket | 1.50\nTOOFER: $3\nbig boy bundle = 25\n\nnonsense'), [{ match: 'ManaPocket', cost: 1.5 }, { match: 'TOOFER', cost: 3 }, { match: 'big boy bundle', cost: 25 }]);
console.log('whatnot show costs + add to show checks passed');
