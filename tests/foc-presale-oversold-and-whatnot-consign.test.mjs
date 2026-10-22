import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Store reports (10/21):
// - 247 Comics Spotlight #1 Cover K (2 listed) and Cover L (1 listed) sold a
//   third and a second copy on eBay on 10/11, after their presale rows hit 0.
//   The rows' listing number and SKU had been wiped when they sold out, so
//   those sales matched nothing -- receiving would have held 2 and 1 copies
//   for eBay buyers instead of 3 and 2, and put the buyers' books on the shelf.
// - Consignments sold on Whatnot stayed ACTIVE with nothing owed.
const { default: api } = await import('../cloudflare-worker-full.js');
const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
const ok = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const K = '950aa1b1-1bc1-41d2-a8c5-6833591300b2';
const coverK = (data = {}) => ({ id: K, status: 'sold', data: { name: 'Spotlight #1 Cover K', source: 'foc_presale', focSkuId: 'sku-k', qty: 0, quantity: 0, focPresaleOriginalQty: 2, cost: 4, ebaySku: 'lba-k', ebayListingId: '257700000001', ...data } });
const order = (id, legacy, sku, title = '247 COMICS Presents / Spotlight #1 Cover K - 1:25 Daniel Warren Johnso - PRESALE') => ({ orderId: id, creationDate: '2026-10-11T18:14:07Z', orderPaymentStatus: 'PAID',
  lineItems: [{ lineItemId: 'li-' + id, legacyItemId: legacy, sku, title, quantity: 1, lineItemCost: { value: '50.00' } }] });

async function sync({ open = [], byId = {}, rows = [], unlinked = [], earlier = [], synced = [] }) {
  const kv = new Map([['secret:EBAY_ACCESS_TOKEN', 'tok'], ['secret:EBAY_ACCESS_EXPIRES', String(Date.now() + 3600e3)], ...synced.map(k => [k, '1'])]);
  const env = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'k', EBAY_REFRESH_TOKEN: 'refresh',
    LBA_KV: { get: async k => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async k => { kv.delete(k); } } };
  const seen = { saleLines: [], linePatches: [], itemPatches: [] };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input.url || input), u = decodeURIComponent(url);
    if (url.startsWith('https://api.ebay.com/sell/fulfillment/v1/order')) {
      if (/lastmodifieddate/.test(u)) return ok({ total: 0, orders: [] });
      const ids = (u.match(/orderIds=([^&]+)/) || [])[1];
      if (ids) return ok({ orders: ids.split(',').map(id => byId[id]).filter(Boolean) });
      return ok({ total: open.length, orders: open });
    }
    if (url.includes('/rest/v1/store_members')) return ok([{ store_id: 'store-1' }]);
    if (url.includes('/rest/v1/inventory_items') && url.includes('or=(')) return ok([{ id: K }]);
    if (url.includes('/rest/v1/inventory_items') && !init.method) {
      if (u.includes('data->>ebaySku=in.(')) return ok(rows.filter(r => r.data.ebaySku && u.includes('"' + r.data.ebaySku + '"')));
      if (u.includes('data->>ebayListingId=in.(')) return ok(rows.filter(r => r.data.ebayListingId && u.includes('"' + r.data.ebayListingId + '"')));
      if (u.includes('id=in.(')) return ok(rows.filter(r => u.includes(r.id)));
      return ok([]);
    }
    if (url.includes('/rest/v1/inventory_items') && init.method === 'PATCH') { seen.itemPatches.push(JSON.parse(init.body)); return ok([]); }
    if (url.includes('/rest/v1/pos_sale_lines') && init.method === 'POST') { seen.saleLines.push(...JSON.parse(init.body)); return ok([]); }
    if (url.includes('/rest/v1/pos_sale_lines') && !init.method) {
      if (u.includes('source_id=like.ebay:*') && u.includes('item_id=is.null')) return ok(unlinked);
      if (u.includes('title=in.(')) return ok(earlier);
      if (u.includes('item_id=is.null')) return ok(unlinked.filter(l => u.includes('source_id=eq.' + l.source_id)).map(l => ({ id: l.id, sale_id: l.sale_id, title: l.title, quantity: 1 })));
      return ok([]);
    }
    if (url.includes('/rest/v1/pos_sales') && !init.method && u.includes('status=eq.completed')) return ok(unlinked.map(l => ({ id: l.sale_id })));
    if (url.includes('/rest/v1/pos_sale_lines') && init.method === 'PATCH') { seen.linePatches.push(JSON.parse(init.body)); return ok([{ id: 'x' }]); }
    return ok([]);
  };
  const waits = [];
  await api.scheduled({}, env, { waitUntil: p => waits.push(p) });
  await Promise.all(waits);
  return seen;
}

try {
  // A new eBay sale on a presale that already sold out here: tied to the
  // row, and the extra copy counts as presold (2 -> 3).
  {
    const seen = await sync({ open: [order('26-1', '257700000001', 'lba-k')], rows: [coverK()] });
    assert.equal(seen.saleLines[0].item_id, K, 'matched to the sold-out presale row by its SKU');
    assert.equal(Number(seen.saleLines[0].cost_basis), 4);
    const p = seen.itemPatches[0];
    assert.equal(p.data.focPresaleOriginalQty, 3, 'receiving now holds 3 for eBay buyers');
    assert.equal(p.status, 'sold');
    assert.equal(p.data.ebaySku, 'lba-k', 'keeps its listing');
    assert.equal(p.data.ebayListingId, '257700000001');
  }
  // Any other item that sold is never matched again.
  {
    const oneOff = { id: 'aaaaaaaa-0000-0000-0000-000000000001', status: 'sold', data: { name: 'Plush', ebaySku: 'lba-k', ebayListingId: '257700000001', qty: 0 } };
    const seen = await sync({ open: [order('26-2', '257700000001', 'lba-k')], rows: [oneOff] });
    assert.equal(seen.saleLines[0].item_id, null);
    assert.equal(seen.itemPatches.length, 0);
  }
  // Selling a presale row's last copy keeps its listing number and SKU; any
  // other item's are cleared as before.
  {
    const last = coverK({ qty: 1, quantity: 1, focPresaleOriginalQty: 2 });
    last.status = 'presale';
    const seen = await sync({ open: [order('26-3', '257700000001', 'lba-k')], rows: [last] });
    assert.equal(seen.itemPatches[0].status, 'sold');
    assert.equal(seen.itemPatches[0].data.focPresaleOriginalQty, 2, 'not oversold: unchanged');
    assert.equal(seen.itemPatches[0].data.ebayListingId, '257700000001');
    const plush = { id: 'aaaaaaaa-0000-0000-0000-000000000002', status: 'in_stock', data: { name: 'Plush', ebaySku: 'lba-p', ebayListingId: '257700000009', qty: 1 } };
    const seen2 = await sync({ open: [order('26-4', '257700000009', 'lba-p', 'Plush')], rows: [plush] });
    assert.equal(seen2.itemPatches[0].data.ebayListingId, '');
    assert.equal(seen2.itemPatches[0].data.ebaySku, '');
  }
  // The 10/11 sales themselves: recorded with no item, the row's listing
  // number long wiped. An earlier sale of the same title, tied to Cover K's
  // row, was on the same eBay listing -- so this one belongs to it too.
  {
    const wiped = coverK({ ebaySku: '', ebayListingId: '' });
    const seen = await sync({
      rows: [wiped],
      unlinked: [{ id: 'line-oct11', sale_id: 'sale-oct11', source_id: 'ebay:26-15252-36148', title: '247 COMICS Presents / Spotlight #1 Cover K - 1:25 Daniel Warren Johnso - PRESALE' }],
      earlier: [{ item_id: K, source_id: 'ebay:22-15167-10497', title: '247 COMICS Presents / Spotlight #1 Cover K - 1:25 Daniel Warren Johnso - PRESALE' }],
      byId: { '26-15252-36148': order('26-15252-36148', '257700000001', ''), '22-15167-10497': order('22-15167-10497', '257700000001', '') },
    });
    assert.equal(seen.linePatches.length, 1);
    assert.equal(seen.linePatches[0].item_id, K);
    assert.equal(Number(seen.linePatches[0].cost_basis), 4, 'its $4 cost, not $0');
    assert.equal(seen.itemPatches[0].data.focPresaleOriginalQty, 3);
  }
  // Not the same eBay listing: left alone.
  {
    const wiped = coverK({ ebaySku: '', ebayListingId: '' });
    const seen = await sync({
      rows: [wiped],
      unlinked: [{ id: 'line-x', sale_id: 'sale-x', source_id: 'ebay:26-9', title: 'Same Title' }],
      earlier: [{ item_id: K, source_id: 'ebay:22-9', title: 'Same Title' }],
      byId: { '26-9': order('26-9', '257700000001', '', 'Same Title'), '22-9': order('22-9', '257799999999', '', 'Same Title') },
    });
    assert.equal(seen.linePatches.length, 0);
  }

  // Whatnot: a consigned item sold there is marked sold for its owner.
  {
    const consignPatches = [], alerts = [];
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input.url || input), u = decodeURIComponent(url);
      if (url.includes('/auth/v1/user')) return ok({ id: 'u1', email: 'staff@example.com' });
      if (url.includes('store_members')) return ok([{ role: 'owner' }]);
      if (url.includes('/rest/v1/inventory_items') && !init.method) return ok([{ id: 'item-c', status: 'in_stock', data: { name: 'Booster Box', qty: 1, cost: 80 } }]);
      if (url.includes('/rest/v1/consignment_items') && !init.method) return ok(u.includes('inventory_item_id=eq.item-c') ? [{ id: 'cs_9', item_name: 'Booster Box', owner_name: 'Sean C', store_split_percent: '25', list_price: '150' }] : []);
      if (url.includes('/rest/v1/consignment_items') && init.method === 'PATCH') { consignPatches.push(JSON.parse(init.body)); return ok([{ id: 'cs_9' }]); }
      if (url.includes('/rest/v1/consignment_alerts') && init.method === 'POST') { alerts.push(JSON.parse(init.body)); return ok([]); }
      return ok([]);
    };
    const env = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'k' };
    const res = await api.fetch(new Request('https://api.example/inventory/record-external-sale', { method: 'POST', headers: { Authorization: 'Bearer t', 'X-Store-Id': 'store-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: 'item-c', channel: 'Whatnot', salePrice: 140, feeAmount: 14 }) }), env, { waitUntil() {} });
    const d = await res.json();
    assert.equal(res.status, 200, JSON.stringify(d));
    assert.equal(consignPatches.length, 1);
    assert.equal(consignPatches[0].status, 'sold');
    assert.equal(consignPatches[0].sale_price, 140);
    assert.equal(consignPatches[0].sale_id, d.saleId);
    assert.equal(alerts[0].source, 'whatnot');
    assert.equal(alerts[0].owner_payout, 105, '75% of $140 to the owner');
    assert.equal(d.consigned.owner, 'Sean C');
  }
} finally { globalThis.fetch = originalFetch; globalThis.caches = originalCaches; }

// The dashboard: every caller of the sale route brings consignments up to date.
const ui = readFileSync(new URL('../scripts/dashboard-app.js', import.meta.url), 'utf8');
assert.ok(ui.includes("if(path === '/inventory/record-external-sale' && res.ok) res.clone().json().then(d => { if(d?.consigned) noteConsignedSales([d.consigned]); }).catch(() => {});"));
assert.ok(ui.includes('if(consigned.length) await noteConsignedSales(consigned);'));
assert.match(ui, /async function noteConsignedSales\(list\)\{\n  if\(!list\?\.length\) return;\n  await loadConsignmentsFromCloud\(\)/);
console.log('FOC presale oversold and Whatnot consignment checks passed');
