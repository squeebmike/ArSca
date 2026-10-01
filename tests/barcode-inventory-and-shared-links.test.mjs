import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store asks: (1) scanning a box already in stock in Research should pull it
// up even when PriceCharting has no product with that barcode; (2) a confirmed
// barcode match should be learned by every device of the store, not just the
// one that confirmed it.

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
function extractFn(name, prefix = 'function ') {
  const start = dashboard.indexOf(prefix + name + '(');
  assert.ok(start >= 0, name + ' must exist in dashboard.html');
  return dashboard.slice(start, dashboard.indexOf('\n}', start) + 2);
}

// ── (1) inventory match by any form of the barcode ──
{
  const all = [
    { id:'a', name:'Lorcana Best Buddies Bundle', upc:'4050368987654', status:'in_stock' },
    { id:'b', name:'30th Celebration Booster Box', upc:'6942600405783', status:'in_stock' },
    { id:'c', name:'Old sold box', upc:'6942600405783', status:'sold' },
    { id:'d', name:'Ashes of the Empire Premium', barcode:'841333126040', status:'in_stock' },
  ];
  const find = new Function('all', extractFn('inventoryItemsForBarcode') + '\nreturn inventoryItemsForBarcode;')(all);
  assert.deepEqual(find({ primary:'6942600405783', candidates:['6942600405783'] }).map(i => i.id), ['b'], 'sold items never match');
  assert.deepEqual(find({ primary:'841333126040', candidates:['841333126040', '0841333126040'] }).map(i => i.id), ['d']);
  assert.deepEqual(find({ primary:'0841333126040', candidates:['841333126040', '0841333126040'] }).map(i => i.id), ['d'], 'a UPC saved as 12 digits matches its 13-digit EAN read');
  assert.deepEqual(find({ primary:'111', candidates:['111'] }), []);

  assert.match(dashboard, /const inventoryHits=inventoryItemsForBarcode\(n\);renderBarcodeInventoryHits\(inventoryHits\);/, 'every scan checks inventory first, also offline');
  assert.match(dashboard, /<div id="barcode-inventory-hits"/);
}

// ── (2) shared confirmed links ──
{
  const kv = new Map(), local = new Map();
  const storeWorkerFetch = async (path, init = {}) => {
    const key = path.replace('/kv/', '');
    if((init.method || 'GET') === 'POST'){ kv.set(key, init.body); return { ok:true, json:async () => ({ ok:true }) }; }
    return { ok:true, json:async () => ({ value:kv.get(key) || null }) };
  };
  const src = [
    extractFn('barcodeLinkCloudKey'),
    extractFn('barcodeLinkGetShared', 'async function '),
    extractFn('barcodeLinkPutShared', 'async function '),
    extractFn('barcodeLinkDeleteShared', 'async function '),
    'return { get:barcodeLinkGetShared, put:barcodeLinkPutShared, del:barcodeLinkDeleteShared, key:barcodeLinkCloudKey };',
  ].join('\n');
  const make = () => new Function('storeWorkerFetch', 'navigator', 'barcodeLinkGet', 'barcodeLinkPut', 'barcodeLinkDelete', src)(
    storeWorkerFetch, { onLine:true }, async id => local.get(id) || null, async v => { local.set(v.id, v); return v; }, async id => { local.delete(id); });
  const api = make();
  assert.equal(api.key('6942600405783|'), 'barcode_link_6942600405783_');
  await api.put({ id:'6942600405783|', confirmed:true, title:'30th Celebration Booster Box' });
  await new Promise(r => setTimeout(r, 0));
  assert.ok(kv.has('barcode_link_6942600405783_'), 'a confirmed match is saved to the store');
  local.clear(); // another device
  const seen = await api.get('6942600405783|');
  assert.equal(seen.title, '30th Celebration Booster Box', 'another device learns it');
  assert.ok(local.has('6942600405783|'), 'and keeps a copy for offline scans');
  await api.del('6942600405783|');
  await new Promise(r => setTimeout(r, 0));
  local.set('6942600405783|', { id:'6942600405783|', confirmed:true });
  assert.equal(await api.get('6942600405783|'), null, 'forgetting on one device forgets it everywhere');
  assert.ok(!local.has('6942600405783|'));

  assert.match(dashboard, /await barcodeLinkPutShared\(\{id:barcodeLinkId\(n\),/);
  assert.match(dashboard, /const saved=await barcodeLinkGetShared\(barcodeLinkId\(n\)\)/);
  assert.match(dashboard, /await barcodeLinkDeleteShared\(barcodeLinkId\(barcodeCurrentNormalized\)\)/);
  assert.match(worker, /key\.startsWith\('barcode_link_'\)\) \? 60 \* 60 \* 24 \* 365/, 'saved matches last a year, not the 7-day default');
}
console.log('Barcode inventory-first + shared link checks passed');
