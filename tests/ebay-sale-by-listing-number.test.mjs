import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Store report: Goblin Storm sold on eBay (10/21) but the dashboard still
// showed it in stock. Its item had no eBay SKU saved -- listed by its eBay
// item number only -- so the sale was recorded with no item and no cost.
// Such a line now matches on the listing number, and a sale already recorded
// that way is tied to its item on the next sync.
const { default: api } = await import('../cloudflare-worker-full.js');
const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
const goblin = { id: 'item-goblin', status: 'in_stock', data: { name: 'Goblin Storm', ebayListingId: '257800065720', ebaySku: '', qty: 1, quantity: 1, cost: 300, category: 'Sealed' } };

async function run({ alreadyRecorded, rows = [goblin], extraLines = [], shipped = false, sold = false }) {
  const kv = new Map([['secret:EBAY_ACCESS_TOKEN', 'tok'], ['secret:EBAY_ACCESS_EXPIRES', String(Date.now() + 3600e3)]]);
  if (alreadyRecorded) kv.set('ebay_order_synced:store-1:10-15327-52866:li-1', '1');
  const env = {
    SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'k', EBAY_REFRESH_TOKEN: 'refresh',
    LBA_KV: { get: async k => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async k => { kv.delete(k); } },
  };
  const seen = { saleLines: [], linePatches: [], itemPatches: [], listingLookups: 0, orderLookups: [], kv };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input.url || input), u = decodeURIComponent(url);
    const ok = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    if (url.startsWith('https://api.ebay.com/sell/fulfillment/v1/order')) {
      if (/lastmodifieddate/.test(u)) return ok({ total: 0, orders: [] });
      // Shipped: gone from the unshipped list, still there by order id.
      if (u.includes('orderIds=')) seen.orderLookups.push(u);
      else if (shipped) return ok({ total: 0, orders: [] });
      return ok({ total: 1, orders: [{ orderId: '10-15327-52866', creationDate: '2026-10-22T00:09:00Z', orderPaymentStatus: 'PAID',
        lineItems: [{ lineItemId: 'li-1', legacyItemId: '257800065720', sku: '', title: 'Magic Secret Lair Drop Commander Deck Goblin Storm', quantity: 1, lineItemCost: { value: '445.50' } }, ...extraLines] }] });
    }
    if (url.includes('/rest/v1/store_members')) return ok([{ store_id: 'store-1' }]);
    if (url.includes('/rest/v1/inventory_items') && url.includes('or=(')) return ok([{ id: 'item-goblin' }]);
    if (url.includes('/rest/v1/inventory_items') && !init.method) {
      if (u.includes('data->>ebayListingId=in.(')) { seen.listingLookups++; return ok(rows.filter(r => u.includes('"' + r.data.ebayListingId + '"'))); }
      return ok([]);
    }
    if (url.includes('/rest/v1/inventory_items') && init.method === 'PATCH') { seen.itemPatches.push(JSON.parse(init.body)); return ok([]); }
    if (url.includes('/rest/v1/pos_sale_lines') && init.method === 'POST') { seen.saleLines.push(...JSON.parse(init.body)); return ok([]); }
    if (url.includes('/rest/v1/pos_sale_lines') && !init.method && u.includes('source_id=like.ebay:*')) {
      return ok(shipped ? [{ id: 'line-1', sale_id: 'sale-1', source_id: 'ebay:10-15327-52866' }] : []);
    }
    if (url.includes('/rest/v1/pos_sales') && !init.method && u.includes('status=eq.completed')) return ok(sold ? [] : [{ id: 'sale-1' }]);
    if (url.includes('/rest/v1/pos_sale_lines') && !init.method && u.includes('item_id=is.null')) {
      assert.ok(u.includes('source_id=eq.ebay:10-15327-52866'), 'looks up the recorded line by its order');
      return ok([{ id: 'line-1', title: 'Magic Secret Lair Drop Commander Deck Goblin Storm', quantity: 1 }]);
    }
    if (url.includes('/rest/v1/pos_sale_lines') && init.method === 'PATCH') { seen.linePatches.push(JSON.parse(init.body)); return ok([{ id: 'line-1' }]); }
    return ok([]);
  };
  const waits = [];
  await api.scheduled({}, env, { waitUntil: p => waits.push(p) });
  await Promise.all(waits);
  return seen;
}

try {
  // A new sale on a no-SKU listing: recorded against its item, which comes off.
  {
    const seen = await run({ alreadyRecorded: false });
    assert.equal(seen.saleLines.length, 1);
    assert.equal(seen.saleLines[0].item_id, 'item-goblin', 'matched by the listing number');
    assert.equal(Number(seen.saleLines[0].cost_basis), 300, 'with its cost');
    assert.equal(seen.itemPatches.length, 1);
    assert.equal(seen.itemPatches[0].status, 'sold', 'the last one sold -- off the active listings');
    assert.equal(seen.itemPatches[0].data.ebayListingId, '');
  }
  // Already recorded with no item (what happened on 10/21): tied to it now.
  {
    const seen = await run({ alreadyRecorded: true });
    assert.equal(seen.saleLines.length, 0, 'no second sale');
    assert.equal(seen.linePatches.length, 1);
    assert.equal(seen.linePatches[0].item_id, 'item-goblin');
    assert.equal(Number(seen.linePatches[0].cost_basis), 300);
    assert.ok(seen.linePatches[0].profit < 445.5 - 300, 'profit after cost and the eBay fee');
    assert.equal(seen.itemPatches.length, 1);
    assert.equal(seen.itemPatches[0].status, 'sold');
  }
  // Already recorded with no item, and the order shipped (label bought): the
  // unshipped list no longer has it, so the order is read by its id.
  {
    const seen = await run({ alreadyRecorded: true, shipped: true });
    assert.equal(seen.orderLookups.length, 1, 'its own order, looked up by id');
    assert.ok(seen.orderLookups[0].includes('orderIds=10-15327-52866'));
    assert.equal(seen.saleLines.length, 0, 'no second sale');
    assert.equal(seen.linePatches.length, 1);
    assert.equal(seen.linePatches[0].item_id, 'item-goblin');
    assert.equal(Number(seen.linePatches[0].cost_basis), 300);
    assert.equal(seen.itemPatches.length, 1);
    assert.equal(seen.itemPatches[0].status, 'sold');
    assert.ok(seen.kv.has('ebay_item_link_tried:store-1:line-1'), 'not looked up again for 6 hours');
  }
  // A voided sale is left alone.
  {
    const seen = await run({ alreadyRecorded: true, shipped: true, sold: true });
    assert.equal(seen.orderLookups.length, 0);
    assert.equal(seen.itemPatches.length, 0);
  }
  // Two unsold items on one listing (covers of one multi-cover listing): never guessed.
  {
    const twin = { ...goblin, id: 'item-twin' };
    const seen = await run({ alreadyRecorded: false, rows: [goblin, twin] });
    assert.equal(seen.saleLines[0].item_id, null, 'left unmatched rather than picking one');
    assert.equal(seen.itemPatches.length, 0);
  }
} finally { globalThis.fetch = originalFetch; globalThis.caches = originalCaches; }

// Views/clicks: eBay reads the report dates in Pacific time.
const worker = readFileSync(new URL('../cloudflare-worker-full.js', import.meta.url), 'utf8');
assert.match(worker, /const fmt = d => d\.toLocaleDateString\('en-CA', \{ timeZone: 'America\/Los_Angeles' \}\)\.replace\(\/-\/g, ''\);/);
const fmt = d => d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }).replace(/-/g, '');
assert.equal(fmt(new Date('2026-10-22T00:31:00Z')), '20261021', '5:31 PM Pacific on 10/21 is still the 21st');
// The sync reports it, and the dashboard reloads so the item shows sold.
assert.match(worker, /recorded: results\.length, results, linked, consigned, errors,/);
assert.ok(worker.includes("try { linked.push(...await attachUnlinkedEbaySaleItems(env, storeId, ebayToken, receiptSettings)); }"), 'runs on every order sync');
const ui = readFileSync(new URL('../scripts/dashboard-app.js', import.meta.url), 'utf8');
assert.ok(ui.includes("const linked = Array.isArray(data.linked) ? data.linked : [];"));
assert.ok(ui.includes("if(!(recorded > 0)){ await loadInventory().catch(()=>{}); loadEbayOrderHistory().catch(()=>{}); }"));
console.log('eBay sale by listing number checks passed');
