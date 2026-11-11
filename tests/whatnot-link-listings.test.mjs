import fs from 'node:fs';
import assert from 'node:assert/strict';
import { matchWhatnotListings, linkWhatnotListings, linkTitleScore, whatnotAllProducts } from '../scripts/whatnot-sync.mjs';

// Store, 2026-11-02: old CSV listings on Whatnot aren't tied to items, so
// their sales don't take stock off. LINK OLD LISTINGS ties them 1:1.
const ID = n => '00000000-0000-4000-8000-00000000000' + n;
assert.equal(linkTitleScore('Amazing Spider-Man #300 NM', 'Amazing Spider-Man #300'), 1);
assert.ok(linkTitleScore('Amazing Spider-Man #300', 'Amazing Spider-Man #301') < 0.85, 'a different issue number is never a clear match');
assert.equal(linkTitleScore('', 'x'), 0);

const items = [
  { id: ID(1), name: 'Amazing Spider-Man #300', price: 400, qty: 1 },
  { id: ID(2), name: 'Charizard Base Set 4/102 Holo', price: 300, qty: 2 },
  { id: ID(3), name: 'Batman #1 Cover A', price: 5, qty: 3 },
  { id: ID(4), name: 'Batman #1 Cover B', price: 5, qty: 1 },
  { id: ID(5), name: 'Pikachu Promo', price: 3, qty: 1 },
];
const products = [
  { id: 'p-made-by-sync', title: 'Pikachu Promo', external_id: ID(5) },
  { id: 'p-asm', title: 'Amazing Spider-Man #300 NM', url: 'https://whatnot.example/p-asm' },
  { id: 'p-sku', title: 'Zard!!', variants: [{ sku: ID(2) }], pricing: { buy_it_now: { price: { amount: '310.00' } } }, quantity: 2 },
  { id: 'p-batman', title: 'Batman #1' },
  { id: 'p-none', title: 'Totally different thing' },
  { id: 'p-dupe', title: 'Pikachu Promo copy' },
];
const rows = matchWhatnotListings(products, items, new Set([ID(5)]));
const by = Object.fromEntries(rows.map(r => [r.productId, r]));
assert.ok(!by['p-made-by-sync'], 'listings the sync made are already 1:1');
assert.equal(by['p-asm'].suggest, ID(1), 'exact title is ticked');
assert.equal(by['p-asm'].url, 'https://whatnot.example/p-asm');
assert.equal(by['p-sku'].suggest, ID(2), "the CSV's SKU (our item id) is a sure match");
assert.equal(by['p-sku'].matches[0].bySku, true);
assert.equal(by['p-sku'].price, 310);
assert.equal(by['p-sku'].qty, 2);
assert.equal(by['p-batman'].suggest, '', 'two equally close items: left for the store to pick');
assert.ok(by['p-batman'].matches.length >= 2);
assert.deepEqual(by['p-none'].matches, []);
assert.equal(by['p-dupe'].suggest, '', 'an item the sync already lists is never ticked');
assert.equal(by['p-dupe'].matches[0].alreadyListed, true);
assert.ok(rows.indexOf(by['p-asm']) < rows.indexOf(by['p-none']), 'ticked matches first');

// Paging through the shop.
{
  const pages = [{ data: [{ id: 'a' }, { id: 'gone', status: 'archived' }], next_cursor: 'c2' }, { data: [{ id: 'b' }], next_cursor: '' }];
  const seen = [];
  const api = async (m, path) => { seen.push(path); return { ok: true, status: 200, data: pages.shift() }; };
  const r = await whatnotAllProducts(api);
  assert.deepEqual(r.products.map(p => p.id), ['a', 'b']);
  assert.equal(r.more, false);
  assert.deepEqual(seen, ['/products?limit=50', '/products?limit=50&cursor=c2']);
  await assert.rejects(whatnotAllProducts(async () => ({ ok: false, status: 403, data: { message: 'scope' } })), /Whatnot listings/);
}

// Linking.
{
  const kv = { 'whatnot-linked:s1': { [ID(9)]: 'ok' }, 'whatnot-sync-seen-v4:s1': { [ID(1)]: 'old', [ID(9)]: 't' } };
  const calls = [], ticked = [];
  const api = async (method, path, body) => {
    calls.push([method, path, body]);
    if (method === 'GET' && path.startsWith('/products/p-asm/variants')) return { ok: true, status: 200, data: { data: [{ id: 'v-asm' }] } };
    if (method === 'GET' && path.startsWith('/products/p-empty/variants')) return { ok: true, status: 200, data: { data: [] } };
    return { ok: true, status: 200, data: {} };
  };
  const deps = {
    storeId: 's1', api,
    kvGet: async k => kv[k] ?? null, kvPut: async (k, v) => { kv[k] = v; },
    rows: async ids => ids.filter(id => id !== ID(7)).map(id => ({ id, status: 'in_stock', data: { name: 'Amazing Spider-Man #300', quantity: 1 } })),
    shape: row => ({ name: row.data.name, price: 400, photos: [] }),
    setSellOnWhatnot: async id => ticked.push(id),
  };
  const res = await linkWhatnotListings([
    { productId: 'p-asm', itemId: ID(1) }, { productId: 'p-x', itemId: ID(7) }, { productId: 'p-y', itemId: ID(9) }, { productId: 'p-empty', itemId: ID(3) },
  ], deps);
  assert.deepEqual(res.map(r => r.linked ? 'ok' : r.error), ['ok', 'Item not found', 'Already on Whatnot through the sync -- end the old listing instead', 'Listing has no variant']);
  assert.deepEqual(calls.find(c => c[0] === 'PATCH' && c[1] === '/products/p-asm/variants')[2], { variants: [{ id: 'v-asm', external_id: ID(1) }] }, 'tagged with our id so its orders find the item');
  const link = kv[`whatnot-link:s1:${ID(1)}`];
  assert.equal(link.productId, 'p-asm');
  assert.equal(link.variantId, 'v-asm');
  assert.equal(link.price, null, 'price goes out on the next sync');
  assert.equal(link.qty, null, 'quantity goes out on the next sync');
  assert.equal(link.published, true);
  assert.ok(link.contentKey && 'mediaKey' in link, 'their title and photos are kept (no content push)');
  assert.deepEqual(ticked, [ID(1)], 'SELL ON WHATNOT is ticked on the linked item');
  assert.equal(kv['whatnot-linked:s1'][ID(1)], 'ok');
  assert.ok(!(ID(1) in kv['whatnot-sync-seen-v4:s1']), 'the next sync run picks it up');
  assert.equal(kv['whatnot-sync-seen-v4:s1'][ID(9)], 't');
  assert.ok(!calls.some(c => c[0] === 'POST' && c[1] === '/products'), 'never makes a new listing');
}

// Wiring.
{
  const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
  assert.match(worker, /'\/whatnot\/link-candidates', '\/whatnot\/link-existing'\]\.includes\(url\.pathname\)/, 'behind the owner/admin/manager Whatnot check');
  assert.match(worker, /url\.pathname === '\/whatnot\/link-candidates' && request\.method === 'GET'/);
  assert.match(worker, /url\.pathname === '\/whatnot\/link-existing' && request\.method === 'POST'/);
  assert.match(worker, /select=id,name:data->>name,title:data->>title,qty:data->>quantity/, 'reads only the fields matching needs');
  assert.match(worker, /sellOnWhatnot: true \}, updated_at:/);
  const html = fs.readFileSync('dashboard.html', 'utf8');
  assert.match(html, /onclick="openWhatnotLinkListings\(\)"[^>]*>🔗 LINK OLD WHATNOT LISTINGS<\/button>/);
  const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
  assert.match(app, /window\.openWhatnotLinkListings = openWhatnotLinkListings;/);
  assert.match(app, /price and quantity are then set to the dashboard's/);
}
console.log('Whatnot LINK OLD LISTINGS: matching, SKU, paging, linking and wiring passed');
