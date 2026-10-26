import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Store report: a consigned Goblin Storm (Sean C, 33% store) sold on eBay and
// its consignment stayed ACTIVE -- only the register marked consignments
// sold. An eBay sale that uses up a consigned item now marks it sold and
// opens the payout alert, and a consignment left ACTIVE after an earlier
// eBay sale is settled on the next sync.
const { default: api } = await import('../cloudflare-worker-full.js');
const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
const ITEM = 'd286554a-6ffc-42a4-ada0-a1b5c2b827fb';
const goblin = { id: ITEM, status: 'in_stock', data: { name: 'Goblin Storm', ebayListingId: '257800065720', ebaySku: '', qty: 1, quantity: 1, cost: 150 } };

async function run({ newSale, soldItem = null }) {
  const kv = new Map([['secret:EBAY_ACCESS_TOKEN', 'tok'], ['secret:EBAY_ACCESS_EXPIRES', String(Date.now() + 3600e3)]]);
  const env = {
    OWNER_STORE_IDS: 'store-1', SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'k', EBAY_REFRESH_TOKEN: 'refresh',
    LBA_KV: { get: async k => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async k => { kv.delete(k); } },
  };
  const seen = { consignPatches: [], alerts: [], sales: [] };
  let claimed = false;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input.url || input), u = decodeURIComponent(url);
    const ok = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    if (url.startsWith('https://api.ebay.com/sell/fulfillment/v1/order')) {
      if (/lastmodifieddate/.test(u) || !newSale) return ok({ total: 0, orders: [] });
      return ok({ total: 1, orders: [{ orderId: '10-15327-52866', creationDate: '2026-10-22T00:09:00Z', orderPaymentStatus: 'PAID',
        lineItems: [{ lineItemId: 'li-1', legacyItemId: '257800065720', sku: '', title: 'Goblin Storm', quantity: 1, lineItemCost: { value: '445.50' } }] }] });
    }
    if (url.includes('/rest/v1/store_members')) return ok([{ store_id: 'store-1' }]);
    if (url.includes('/rest/v1/inventory_items') && url.includes('or=(')) return ok([{ id: ITEM }]);
    if (url.includes('/rest/v1/inventory_items') && !init.method) {
      if (u.includes('data->>ebayListingId=in.(')) return ok(newSale ? [goblin] : []);
      if (u.includes('status=eq.sold') && u.includes('id=in.(')) return ok(soldItem && u.includes(ITEM) ? [soldItem] : []);
      return ok([]);
    }
    if (url.includes('/rest/v1/pos_sales') && init.method === 'POST') { seen.sales.push(JSON.parse(init.body).id); return ok([]); }
    if (url.includes('/rest/v1/pos_sale_lines') && !init.method && u.includes('item_id=eq.' + ITEM)) return ok([{ sale_id: 'sale-earlier', unit_price: 445.5, quantity: 1 }]);
    if (url.includes('/rest/v1/pos_payments') && !init.method && u.includes('sale_id=eq.sale-earlier')) return ok([{ provider_metadata: { fee: 60.78 } }]);
    if (url.includes('/rest/v1/consignment_items') && !init.method) {
      if (claimed) return ok([]);
      if (u.includes('inventory_item_id=not.is.null')) return ok([{ inventory_item_id: ITEM }]);
      if (u.includes('inventory_item_id=eq.' + ITEM)) return ok([{ id: 'cs_1784160677897', item_name: 'Goblin Storm', owner_name: 'Sean C', store_split_percent: '33.00', list_price: '453.00' }]);
      return ok([]);
    }
    if (url.includes('/rest/v1/consignment_items') && init.method === 'PATCH') {
      assert.ok(u.includes('status=eq.active'), 'claims it only while still active');
      if (claimed) return ok([]);
      claimed = true; seen.consignPatches.push(JSON.parse(init.body)); return ok([{ id: 'cs_1784160677897' }]);
    }
    if (url.includes('/rest/v1/consignment_alerts') && init.method === 'POST') { seen.alerts.push(JSON.parse(init.body)); return ok([]); }
    return ok([]);
  };
  const waits = [];
  await api.scheduled({}, env, { waitUntil: p => waits.push(p) });
  await Promise.all(waits);
  return seen;
}

try {
  // The eBay sale that uses up the consigned item marks it sold for its owner.
  {
    const seen = await run({ newSale: true });
    assert.equal(seen.consignPatches.length, 1);
    const p = seen.consignPatches[0];
    assert.equal(p.status, 'sold');
    assert.equal(p.sale_price, 445.5, "eBay's sold price, not the $453 list price");
    assert.equal(p.sale_id, seen.sales[0], 'linked to the recorded sale');
    assert.equal(seen.alerts.length, 1, 'payout alert opened');
    const a = seen.alerts[0];
    assert.equal(a.consignment_id, 'cs_1784160677897');
    assert.equal(a.owner_name, 'Sean C');
    // eBay's fee comes off first; the 33/67 split is of what's left.
    const fee = p.marketplace_fee;
    assert.ok(fee > 50 && fee < 70, "eBay's fee on $445.50 is kept on the consignment: " + fee);
    assert.equal(a.store_cut, Math.round((445.5 - fee) * 33) / 100, '33% of what is left after eBay');
    assert.equal(a.owner_payout, Math.round((445.5 - fee - a.store_cut) * 100) / 100);
    assert.ok(a.owner_payout < 298.48, 'less than 67% of the full price');
    assert.equal(a.source, 'ebay');
    assert.equal(a.status, 'open');
  }
  // Sold on eBay before this existed (Goblin Storm): settled on the next sync.
  {
    const seen = await run({ newSale: false, soldItem: { id: ITEM, data: { channel: 'eBay', soldAt: '2026-10-22T00:09:00Z', salePrice: 445.5 } } });
    assert.equal(seen.consignPatches.length, 1);
    assert.equal(seen.consignPatches[0].sale_id, 'sale-earlier', "the item's own eBay sale");
    assert.equal(seen.consignPatches[0].sold_at, '2026-10-22T00:09:00Z');
    assert.equal(seen.consignPatches[0].marketplace_fee, 60.78, "the eBay fee from the sale's payment");
    assert.equal(seen.alerts[0].store_cut, 126.96, '33% of $445.50 - $60.78');
    assert.equal(seen.alerts[0].owner_payout, 257.76);
  }
  // Sold some other way: left for the register's own flow.
  {
    const seen = await run({ newSale: false, soldItem: { id: ITEM, data: { channel: 'Cash' } } });
    assert.equal(seen.consignPatches.length, 0);
    assert.equal(seen.alerts.length, 0);
  }
} finally { globalThis.fetch = originalFetch; globalThis.caches = originalCaches; }

// The dashboard takes a consignment sold in the cloud as sold before it
// writes its own list back, so a stale ACTIVE copy can't undo it.
const ui = readFileSync(new URL('../scripts/dashboard-app.js', import.meta.url), 'utf8');
{
  const start = ui.indexOf('async function adoptCloudSoldConsignments(');
  const src = ui.slice(start, ui.indexOf('\n', start));
  const consignItems = [{ id: 'cs_1', status: 'active', salePrice: null }, { id: 'cs_2', status: 'active' }, { id: 'cs_3', status: 'sold', salePrice: 10 }];
  const asked = [];
  const sb = { from: () => { const q = { select: () => q, eq: (k, v) => { asked.push([k, v]); return q; }, in: (k, ids) => { asked.push([k, ids]); return Promise.resolve({ data: [{ id: 'cs_1', status: 'sold', sale_price: '445.50', sold_at: '2026-10-22T00:09:00Z', sale_id: 'sale-1' }] }); } }; return q; } };
  const store = new Map();
  const fn = new Function('consignItems', 'localStorage', `${src}; return adoptCloudSoldConsignments;`)(consignItems, { setItem: (k, v) => store.set(k, v) });
  await fn(sb, 'store-1');
  assert.deepEqual(JSON.parse(JSON.stringify(asked.find(x => x[0] === 'id'))), ['id', ['cs_1', 'cs_2']], 'asks only about its active ones');
  assert.equal(consignItems[0].status, 'sold');
  assert.equal(consignItems[0].salePrice, 445.5);
  assert.equal(consignItems[0].saleId, 'sale-1');
  assert.equal(consignItems[1].status, 'active', 'not sold in the cloud: unchanged');
  assert.ok(store.has('pos_consign'));
}
assert.ok(ui.includes('if(!sb||!consignmentCloudReady||!storeId)return false;await adoptCloudSoldConsignments(sb,storeId);for('), 'before every upsert');
assert.ok(ui.includes("const consigned = Array.isArray(data.consigned) ? data.consigned : [];"));
console.log('eBay consignment sold checks passed');
