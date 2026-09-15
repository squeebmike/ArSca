import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handleReceivingRequest } from '../scripts/receiving.mjs';

function makeDeps(overrides = {}) {
  const calls = [];
  return {
    calls,
    json: (data, status) => ({ status: status || 200, json: async () => data }),
    readJsonWithLimit: async (req) => ({ data: await req.json() }),
    requireStoreUser: async () => ({ user: { id: 'u1' }, role: 'owner' }),
    supabaseAdminFetch: async (env, path, opts) => {
      calls.push({ path, opts });
      return overrides.supabaseAdminFetch ? overrides.supabaseAdminFetch(path, opts) : { data: [] };
    },
  };
}

function postRequest(body) {
  return { method: 'POST', json: async () => body };
}

const url = new URL('https://worker.example/receiving/import');

// A UPC already on the shelf gets its quantity bumped, not duplicated.
{
  const deps = makeDeps({
    supabaseAdminFetch: (path, opts) => {
      if (path.startsWith('inventory_items?store_id')) {
        return { data: [{ id: 'existing-1', data: { upc: '75960621481500111', qty: 3, quantity: 3, name: 'GAMBIT GONE #1' } }] };
      }
      if (path === 'inventory_items') return { data: JSON.parse(opts.body).map((r, i) => ({ id: `new-${i}`, ...r })) };
      return { data: [] };
    },
  });
  const rows = [
    { 'UPC/ISBN': '75960621481500111', Title: 'GAMBIT GONE #1', Publisher: 'Marvel', 'USD List Price': '4.99', 'Total Receiving Quantity': '5', 'Purchase Order Number': '82420261552', Format: 'Comic Book' },
  ];
  const res = await handleReceivingRequest(postRequest({ storeId: 'store1', vendor: 'Lunar', discountPercent: 50, rows }), {}, url, deps);
  const result = await res.json();
  assert.equal(result.ok, true);
  assert.equal(result.createdCount, 0, 'no new inventory row when the UPC already exists on the shelf');
  assert.equal(result.restockedCount, 1);
  assert.equal(result.restockedCopies, 5);
  const patchCall = deps.calls.find(c => c.opts?.method === 'PATCH');
  assert.ok(patchCall, 'must PATCH the existing row');
  const patchedQty = JSON.parse(patchCall.opts.body).data.qty;
  assert.equal(patchedQty, 8, 'existing qty (3) plus received qty (5) must sum, never overwrite or duplicate');
}

// No shelf match creates a new item; cost = list price x (1 - discount%).
{
  const deps = makeDeps({
    supabaseAdminFetch: (path, opts) => {
      if (path.startsWith('inventory_items?store_id')) return { data: [] };
      if (path === 'inventory_items') return { data: JSON.parse(opts.body).map((r, i) => ({ id: `new-${i}`, ...r })) };
      return { data: [] };
    },
  });
  const rows = [
    { 'UPC/ISBN': '75960621584300116', Title: 'INFERNAL HULK VS. WOLVERINE #1 VARIANT', Publisher: 'Marvel', 'USD List Price': '4.99', 'Total Receiving Quantity': '1', Format: 'Comic Book' },
    { 'UPC/ISBN': '9798217273454', Title: 'The Official SpongeBob SquarePants Cookbook', Publisher: 'Penguin Random House', 'USD List Price': '28.00', 'Total Receiving Quantity': '2', Format: 'Hardcover' },
  ];
  const res = await handleReceivingRequest(postRequest({ storeId: 'store1', vendor: 'Lunar', discountPercent: 50, rows }), {}, url, deps);
  const result = await res.json();
  assert.equal(result.createdCount, 2);
  const insertCall = deps.calls.find(c => c.path === 'inventory_items' && c.opts?.method === 'POST');
  const created = JSON.parse(insertCall.opts.body);
  assert.equal(created[0].data.category, 'Comic', 'Comic Book format must map to the Comic category the eBay listing modal auto-selects on');
  assert.equal(created[0].data.cost, 2.5, '50% discount off a 4.99 list price must round to 2.50 cost');
  assert.equal(created[1].data.category, 'Hardcover', 'a non-comic format falls back to the format string as category, not the Comic category');
  assert.equal(created[1].data.cost, 14, '50% discount off a 28.00 list price must be 14.00 cost');
  assert.equal(created[1].data.qty, 2);
}

// Rows with no UPC/title, or nothing received on that line, are skipped
// without failing the whole import -- one bad line in a real box shouldn't
// block every other item in the same shipment.
{
  const deps = makeDeps({
    supabaseAdminFetch: (path, opts) => {
      if (path.startsWith('inventory_items?store_id')) return { data: [] };
      if (path === 'inventory_items') return { data: JSON.parse(opts.body).map((r, i) => ({ id: `new-${i}`, ...r })) };
      return { data: [] };
    },
  });
  const rows = [
    { 'UPC/ISBN': '', Title: '', 'Total Receiving Quantity': '0' },
    { 'UPC/ISBN': '123', Title: 'Backordered Book', 'Total Receiving Quantity': '0' },
    { 'UPC/ISBN': '456', Title: 'Real Copy', 'USD List Price': '3.99', 'Total Receiving Quantity': '4' },
  ];
  const res = await handleReceivingRequest(postRequest({ storeId: 'store1', vendor: 'Lunar', rows }), {}, url, deps);
  const result = await res.json();
  assert.equal(result.ok, true);
  assert.equal(result.createdCount, 1);
  assert.equal(result.skipped.length, 2);
}

// The same UPC appearing on two lines of one report (e.g. a split-carton
// follow-up) sums into a single created row instead of two competing rows.
{
  const deps = makeDeps({
    supabaseAdminFetch: (path, opts) => {
      if (path.startsWith('inventory_items?store_id')) return { data: [] };
      if (path === 'inventory_items') return { data: JSON.parse(opts.body).map((r, i) => ({ id: `new-${i}`, ...r })) };
      return { data: [] };
    },
  });
  const rows = [
    { 'UPC/ISBN': '789', Title: 'Split Carton Book', 'USD List Price': '5.00', 'Total Receiving Quantity': '3' },
    { 'UPC/ISBN': '789', Title: 'Split Carton Book', 'USD List Price': '5.00', 'Total Receiving Quantity': '2' },
  ];
  const res = await handleReceivingRequest(postRequest({ storeId: 'store1', rows }), {}, url, deps);
  const result = await res.json();
  assert.equal(result.createdCount, 1);
  assert.equal(result.createdCopies, 5);
}

console.log('Receiving shipment import checks passed');

// The dashboard's More menu must expose the new standalone tool, and the
// worker must route /receiving/* to the handler wired up above.
{
  const dashboard = fs.readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');
  assert.match(dashboard, /href="receiving-import\.html"/, 'dashboard More menu must link to the new Receive Shipment tool');
  const worker = fs.readFileSync(new URL('../cloudflare-worker-full.js', import.meta.url), 'utf8');
  assert.match(worker, /handleReceivingRequest/, 'worker must import and route to handleReceivingRequest');
  assert.match(worker, /url\.pathname\.startsWith\('\/receiving\/'\)/, 'worker must route \\/receiving\\/* paths');
}

console.log('Receiving shipment wiring checks passed');
