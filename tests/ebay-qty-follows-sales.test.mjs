import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ebayQtyOffDashboard } from '../scripts/foc-preorders.mjs';

// Store ask: "Sell one in Whatnot, eBay ticks down 1 also?" and "should
// tell me and fix automatically" -- after 247 Comics Spotlight #1 Cover K/L
// sold more on eBay than the dashboard had -- then "eBay stock amount should
// follow what the dashboard says we have." A sale on Whatnot, the register or
// the website, an edit and a refund restock set the item's eBay listing to
// what the dashboard has, and every 6 hours any listing that differs is set
// to it (lowered or raised) and the store is emailed.

// ── Which listings differ from the dashboard ──
{
  const active = [
    { itemId: '1', title: 'Plush', available: 3, sold: 0, variations: [] },
    { itemId: '2', title: 'Spotlight #1', available: 0, sold: 0, variations: [
      { sku: 'k', label: 'Cover K', available: 3, sold: 3 }, { sku: 'l', label: 'Cover L', available: 1, sold: 1 }, { sku: 'b', label: 'Bundle', available: 5, sold: 0 } ] },
    { itemId: '3', title: 'Goblin Storm', available: 1, sold: 0, variations: [] },
    { itemId: '4', title: 'Two rows one listing', available: 4, sold: 0, variations: [] },
  ];
  const rows = [
    { id: 'p', status: 'in_stock', data: { name: 'Plush', ebayListingId: '1', qty: 1 } },
    { id: 'k', status: 'presale', data: { name: 'Cover K - PRESALE', ebayListingId: '2', ebaySku: 'k', ebayApiSystem: 'trading', source: 'foc_presale', qty: 1 } },
    { id: 'l', status: 'presale', data: { name: 'Cover L', ebayListingId: '2', ebaySku: 'l', ebayApiSystem: 'trading', source: 'foc_presale', qty: 2 } },
    { id: 'b', status: 'presale', data: { name: 'Bundle', ebayListingId: '2', ebaySku: 'b', source: 'foc_presale_bundle', qty: 0 } },
    { id: 'g', status: 'sold', data: { name: 'Goblin Storm', ebayListingId: '3', qty: 0 } },
    { id: 'x1', status: 'in_stock', data: { name: 'A', ebayListingId: '4', qty: 1 } },
    { id: 'x2', status: 'in_stock', data: { name: 'B', ebayListingId: '4', qty: 1 } },
    { id: 'w', status: 'in_stock', data: { name: 'Withdrawn', ebayListingId: '1', ebayWithdrawnAt: 'x', qty: 0 } },
  ];
  const off = ebayQtyOffDashboard({ active, rows });
  const by = Object.fromEntries(off.map(o => [o.rowId, o]));
  assert.deepEqual(Object.keys(by).sort(), ['g', 'k', 'l', 'p'], 'K, L, the plush and the sold Goblin Storm -- never the bundle or a listing two rows share');
  assert.equal(by.k.ebayQty, 3); assert.equal(by.k.dashQty, 1); assert.equal(by.k.trading, true); assert.equal(by.k.label, 'Cover K'); assert.equal(by.k.name, 'Cover K');
  assert.equal(by.k.raise, false);
  assert.equal(by.l.ebayQty, 1); assert.equal(by.l.dashQty, 2); assert.equal(by.l.raise, true, 'eBay shows fewer than we have: raised');
  assert.equal(by.g.dashQty, 0, 'sold counts as none left');
}

const { default: api } = await import('../cloudflare-worker-full.js');
const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
const ok = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const xmlOk = inner => new Response(`<?xml version="1.0"?><R><Ack>Success</Ack>${inner || ''}</R>`, { headers: { 'Content-Type': 'text/xml' } });

function mockEbay(seen, { item, offers = {}, active = '', recentOrders = [] }) {
  return async (input, init = {}) => {
    const url = String(input.url || input), u = decodeURIComponent(url);
    if (url.includes('/auth/v1/user')) return ok({ id: 'u1', email: 'staff@example.com' });
    if (url.includes('/rest/v1/store_members') && url.includes('select=store_id')) return ok([{ store_id: 'store-1' }]);
    if (url.includes('store_members')) return ok([{ role: 'owner' }]);
    if (url.startsWith('https://api.ebay.com/ws/api.dll')) {
      const call = new Headers(init.headers).get('X-EBAY-API-CALL-NAME');
      seen.trading.push([call, String(init.body)]);
      if (call === 'GetMyeBaySelling') return xmlOk(active);
      if (call === 'GetItem') return xmlOk('<Item><ItemID>1</ItemID></Item>');
      return xmlOk();
    }
    if (url.startsWith('https://api.ebay.com/sell/inventory/v1/offer?sku=')) { const sku = new URL(url).searchParams.get('sku'); return ok({ offers: offers[sku] ? [{ offerId: offers[sku], listing: { listingId: '1' } }] : [] }); }
    if (url.includes('/sell/inventory/v1/bulk_update_price_quantity')) { seen.bulk.push(JSON.parse(init.body)); return ok({ responses: [{ statusCode: 200 }] }); }
    if (/\/sell\/inventory\/v1\/offer\/[^/]+\/withdraw/.test(url)) { seen.withdrawn.push(url); return ok({}); }
    if (url.startsWith('https://api.ebay.com/sell/fulfillment')) { if (/creationdate/.test(u)) { seen.recentLookups++; return ok({ orders: recentOrders }); } return ok({ total: 0, orders: [] }); }
    if (url.startsWith('https://comms.twilio.com/v1/Emails')) { seen.emails.push(JSON.parse(init.body)); return ok({}); }
    if (url.includes('/rest/v1/inventory_items') && !init.method) {
      if (u.includes('data->>ebayListingId=gt.0')) return ok(seen.rows);
      if (u.includes('or=(')) return ok([{ id: item?.id || 'x' }]);
      if (item && (u.includes('id=eq.' + item.id) || u.includes('id=in.('))) return ok([{ ...item, ...(seen.after || {}) }]);
      return ok([]);
    }
    if (url.includes('/rest/v1/inventory_items') && init.method === 'PATCH') { const b = JSON.parse(init.body); seen.patches.push(b); if (b.status) seen.after = { status: b.status, data: b.data }; else seen.after = { ...(seen.after || {}), data: b.data }; return ok([]); }
    return ok([]);
  };
}
const env = { OWNER_STORE_IDS: 'store-1', SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'k', EBAY_REFRESH_TOKEN: 'refresh', TWILIO_ACCOUNT_SID: 'a', TWILIO_AUTH_TOKEN: 'b', TWILIO_EMAIL_FROM_ADDRESS: 'shop@example.com' };
const kvEnv = () => { const kv = new Map([['secret:EBAY_ACCESS_TOKEN', 'tok'], ['secret:EBAY_ACCESS_EXPIRES', String(Date.now() + 3600e3)]]); return { ...env, LBA_KV: { get: async (k, t) => { const v = kv.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { kv.set(k, v); }, delete: async k => { kv.delete(k); } }, kv }; };
const sale = (e, body) => api.fetch(new Request('https://api.example/inventory/record-external-sale', { method: 'POST', headers: { Authorization: 'Bearer t', 'X-Store-Id': 'store-1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), e, { waitUntil() {} });
const fresh = () => ({ trading: [], bulk: [], withdrawn: [], emails: [], patches: [], rows: [], recentLookups: 0 });
const ITEM = 'aaaaaaaa-0000-4000-8000-000000000001';

try {
  // Sold 1 of 3 on Whatnot: the eBay listing (this dashboard's own) goes to 2.
  {
    const seen = fresh(), e = kvEnv();
    globalThis.fetch = mockEbay(seen, { item: { id: ITEM, status: 'in_stock', data: { name: 'Booster Box', qty: 3, cost: 80, ebayListingId: '1', ebaySku: 'lba-box', ebayOfferId: 'off-1' } }, offers: { 'lba-box': 'off-1' } });
    const res = await sale(e, { itemId: ITEM, channel: 'Whatnot', salePrice: 140, feeAmount: 14 });
    const d = await res.json();
    assert.equal(res.status, 200, JSON.stringify(d));
    assert.equal(seen.bulk.length, 1, 'one eBay quantity update');
    assert.equal(seen.bulk[0].requests[0].offers[0].availableQuantity, 2, 'eBay ticks down to 2');
    assert.equal(d.ebay[0].to, 2); assert.equal(d.ebay[0].ok, true);
    assert.ok(JSON.parse(e.kv.get('ebay-qty-fixes:store-1'))[0].why === 'sale', 'logged');
  }
  // The last one, listed on eBay itself (no SKU): the listing is ended.
  {
    const seen = fresh(), e = kvEnv();
    globalThis.fetch = mockEbay(seen, { item: { id: ITEM, status: 'in_stock', data: { name: 'Goblin Storm', qty: 1, cost: 150, ebayListingId: '257800065720' } } });
    const d = await (await sale(e, { itemId: ITEM, channel: 'Whatnot', salePrice: 450 })).json();
    assert.ok(seen.trading.some(([c, b]) => c === 'EndFixedPriceItem' && b.includes('<ItemID>257800065720</ItemID>')), 'ended on eBay');
    assert.ok(seen.patches.some(p => p.data?.ebayWithdrawnAt), 'marked ended here');
    assert.equal(d.ebay[0].ended, true);
  }
  // A presale cover on a multi-cover listing: that cover's quantity, by SKU.
  {
    const seen = fresh(), e = kvEnv();
    globalThis.fetch = mockEbay(seen, { item: { id: ITEM, status: 'presale', data: { name: 'Cover K - PRESALE', qty: 3, cost: 4, source: 'foc_presale', ebayApiSystem: 'trading', ebayListingId: '257700000001', ebaySku: 'lbagrp-k' } } });
    await sale(e, { itemId: ITEM, channel: 'Whatnot', salePrice: 60 });
    const revise = seen.trading.find(([c]) => c === 'ReviseInventoryStatus');
    assert.ok(revise, 'revised on eBay');
    assert.match(revise[1], /<ItemID>257700000001<\/ItemID><SKU>lbagrp-k<\/SKU><Quantity>2<\/Quantity>/);
    assert.ok(!seen.trading.some(([c]) => c === 'EndFixedPriceItem'), 'a presale cover keeps its listing');
  }
  // A sale recorded as eBay itself: eBay already counted it.
  {
    const seen = fresh(), e = kvEnv();
    globalThis.fetch = mockEbay(seen, { item: { id: ITEM, status: 'in_stock', data: { name: 'Plush', qty: 2, ebayListingId: '1', ebaySku: 'lba-p' } }, offers: { 'lba-p': 'off-p' } });
    await sale(e, { itemId: ITEM, channel: 'eBay', salePrice: 20 });
    assert.equal(seen.bulk.length + seen.trading.length, 0);
  }
  // The 6-hour check: eBay offers 3 of a cover the dashboard has 1 of --
  // lowered, and the store is emailed.
  {
    const seen = fresh(), e = kvEnv();
    seen.rows = [{ id: 'row-k', status: 'presale', data: { name: 'Spotlight #1 Cover K - PRESALE', qty: 1, source: 'foc_presale', ebayApiSystem: 'trading', ebayListingId: '257700000001', ebaySku: 'lbagrp-k' } }];
    const active = '<ActiveList><Item><ItemID>257700000001</ItemID><Title>Spotlight #1</Title><Quantity>0</Quantity><Variations><Variation><SKU>lbagrp-k</SKU><Quantity>6</Quantity><SellingStatus><QuantitySold>3</QuantitySold></SellingStatus><VariationSpecifics><NameValueList><Value>Cover K</Value></NameValueList></VariationSpecifics></Variation></Variations></Item><PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages></PaginationResult></ActiveList>';
    globalThis.fetch = mockEbay(seen, { active });
    const waits = [];
    await api.scheduled({}, e, { waitUntil: p => waits.push(p) });
    await Promise.all(waits);
    const revise = seen.trading.find(([c]) => c === 'ReviseInventoryStatus');
    assert.ok(revise, 'fixed on eBay');
    assert.match(revise[1], /<SKU>lbagrp-k<\/SKU><Quantity>1<\/Quantity>/);
    assert.equal(seen.emails.length, 1, 'and told');
    assert.equal(seen.emails[0].to[0].address, 'hintline@themanapocket.com');
    assert.match(JSON.stringify(seen.emails[0]), /eBay showed 3, you have 1/);
    assert.match(JSON.stringify(seen.emails[0]), /Lowered/);
    assert.match(JSON.stringify(seen.emails[0]), /Cover K/);
    assert.equal(seen.recentLookups, 0, 'only lowering: no need to look for recent orders');
  }
  // eBay shows 1, the dashboard has 3 (restocked here): raised to 3.
  const raiseRows = () => [{ id: 'row-p', status: 'in_stock', data: { name: 'Booster Box', qty: 3, ebayListingId: '257711111111' } }];
  const raiseActive = '<ActiveList><Item><ItemID>257711111111</ItemID><Title>Booster Box</Title><Quantity>1</Quantity><SellingStatus><QuantitySold>0</QuantitySold></SellingStatus></Item></ActiveList>';
  {
    const seen = fresh(), e = kvEnv();
    seen.rows = raiseRows();
    globalThis.fetch = mockEbay(seen, { active: raiseActive });
    const waits = [];
    await api.scheduled({}, e, { waitUntil: p => waits.push(p) });
    await Promise.all(waits);
    const revise = seen.trading.find(([c]) => c === 'ReviseInventoryStatus');
    assert.ok(revise, 'raised on eBay');
    assert.match(revise[1], /<ItemID>257711111111<\/ItemID><Quantity>3<\/Quantity>/);
    assert.match(JSON.stringify(seen.emails[0]), /Raised/);
  }
  // ...unless it sold on eBay in the last half hour (maybe not recorded yet).
  {
    const seen = fresh(), e = kvEnv();
    seen.rows = raiseRows();
    globalThis.fetch = mockEbay(seen, { active: raiseActive, recentOrders: [{ orderId: 'o1', lineItems: [{ legacyItemId: '257711111111' }] }] });
    const waits = [];
    await api.scheduled({}, e, { waitUntil: p => waits.push(p) });
    await Promise.all(waits);
    assert.equal(seen.recentLookups, 1);
    assert.ok(!seen.trading.some(([c]) => c === 'ReviseInventoryStatus'), 'not raised back over a sale that may not be in yet');
    assert.equal(seen.emails.length, 0);
  }
  // Nothing off: no change, no email.
  {
    const seen = fresh(), e = kvEnv();
    seen.rows = [{ id: 'row-k', status: 'presale', data: { name: 'Cover K', qty: 3, source: 'foc_presale', ebayApiSystem: 'trading', ebayListingId: '257700000001', ebaySku: 'lbagrp-k' } }];
    globalThis.fetch = mockEbay(seen, { active: '<ActiveList><Item><ItemID>257700000001</ItemID><Variations><Variation><SKU>lbagrp-k</SKU><Quantity>6</Quantity><SellingStatus><QuantitySold>3</QuantitySold></SellingStatus></Variation></Variations></Item></ActiveList>' });
    const waits = [];
    await api.scheduled({}, e, { waitUntil: p => waits.push(p) });
    await Promise.all(waits);
    assert.ok(!seen.trading.some(([c]) => c === 'ReviseInventoryStatus'));
    assert.equal(seen.emails.length, 0);
  }
  // The check is the Worker's own: not reachable from outside.
  {
    const seen = fresh(), e = kvEnv();
    globalThis.fetch = mockEbay(seen, {});
    const res = await api.fetch(new Request('https://api.example/ebay/internal/qty-reconcile', { method: 'POST', headers: { Authorization: 'Bearer t', 'X-Store-Id': 'store-1', 'Content-Type': 'application/json' }, body: '{"storeId":"store-1"}' }), e, { waitUntil() {} });
    assert.equal(res.status, 404);
  }
} finally { globalThis.fetch = originalFetch; globalThis.caches = originalCaches; }

// The website and the register follow too.
const worker = readFileSync(new URL('../cloudflare-worker-full.js', import.meta.url), 'utf8');
assert.ok(worker.includes("await focInternalPost(env, { waitUntil() {}, passThroughOnException() {} }, storeId, '/ebay/sync-item-quantities', { itemIds: touched });"), 'website checkout');
assert.match(worker, /async function restockRefundItems\([^)]*\)\{[\s\S]*?finally\{await ebayFollowRestock\(env,storeId,lines\);\}/, 'refund restock');
assert.match(worker, /async function restockVoidedSaleLines\([^)]*\)\{\n  try\{return await restockVoidedLines\([^)]*\);\}\n  finally\{await ebayFollowRestock\(env,storeId,lines\);\}/, 'void restock');
const ui = readFileSync(new URL('../scripts/dashboard-app.js', import.meta.url), 'utf8');
assert.ok(ui.includes("if(onEbay.length) storeWorkerFetch('/ebay/sync-item-quantities'"), 'register');
assert.ok(ui.includes("if((nextData.ebayListingId || item.ebayListingId) && (Number(nextData.qty ?? nextData.quantity ?? 0) !== beforeQty || (nextData.status || 'in_stock') !== beforeStatus)) storeWorkerFetch('/ebay/sync-item-quantities'"), 'an edit to the count');
assert.ok(ui.includes("if((path === '/inventory/record-external-sale' || path === '/ebay/sync-item-quantities') && res.ok)"), 'says what eBay shows now');
console.log('eBay quantity follows sales checks passed');
