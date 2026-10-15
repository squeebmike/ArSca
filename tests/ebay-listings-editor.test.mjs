import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseMyEbaySellingActive, ebayItemFromGetItem, handleFocRequest } from '../scripts/foc-preorders.mjs';

// Store ask: "Easy way to edit the quantity of eBay listings? And prices etc?
// Did we build the eBay editor?" -- one screen for every live listing, the
// ones made on eBay itself included.
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const ui = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');

const xml = `<GetMyeBaySellingResponse><ActiveList><ItemArray>
<Item><ItemID>256538098712</ItemID><Title>Patriots 2-Piece BBQ Tool Set</Title><Quantity>1</Quantity><QuantityAvailable>1</QuantityAvailable><WatchCount>3</WatchCount><ListingDetails><StartTime>2026-08-01T10:00:00.000Z</StartTime></ListingDetails><PictureDetails><GalleryURL>https://i.ebayimg.com/a.jpg</GalleryURL></PictureDetails><SellingStatus><CurrentPrice currencyID="USD">27.77</CurrentPrice><QuantitySold>0</QuantitySold></SellingStatus></Item>
<Item><ItemID>257800000001</ItemID><Title>Midnight X-Men #1</Title><Quantity>12</Quantity><SellingStatus><CurrentPrice currencyID="USD">5.99</CurrentPrice><QuantitySold>2</QuantitySold></SellingStatus><Variations><Variation><SKU>mx-a</SKU><StartPrice currencyID="USD">5.99</StartPrice><Quantity>6</Quantity><VariationSpecifics><NameValueList><Name>Cover</Name><Value>Cover A</Value></NameValueList></VariationSpecifics><SellingStatus><QuantitySold>1</QuantitySold></SellingStatus></Variation></Variations></Item>
</ItemArray></ActiveList></GetMyeBaySellingResponse>`;
const [bbq, mx] = parseMyEbaySellingActive(xml).items;
assert.deepEqual([bbq.photo, bbq.startTime, bbq.watchers, bbq.price], ['https://i.ebayimg.com/a.jpg', '2026-08-01T10:00:00.000Z', 3, 27.77]);
assert.deepEqual([mx.variations[0].price, mx.variations[0].available, mx.variations[0].sold], [5.99, 5, 1], 'each cover has its own price and count');
const gi = ebayItemFromGetItem('<GetItemResponse><Ack>Success</Ack><Item><ItemID>9</ItemID><Quantity>5</Quantity><SellingStatus><QuantitySold>2</QuantitySold></SellingStatus></Item></GetItemResponse>');
assert.deepEqual([gi.quantity, gi.sold, gi.available], [5, 2, 3], 'read-back after a quantity change');

const rows = [{ id:'r1', status:'presale', data:{ source:'foc_presale', name:'Midnight X-Men A - PRESALE', ebayListingId:'257800000001', ebaySku:'mx-a', qty:5, focPresaleOriginalQty:6, salePrice:5.99 } }];
function deps(over = {}) {
  const patches = [], revised = [];
  return { patches, revised, d:{
    json:(data, status = 200) => ({ status, data }),
    readJsonWithLimit:async r => ({ data:await r.json() }),
    requireStoreUser:async () => ({ user:{ id:'u' } }),
    getEbayUserAccessToken:async () => 'tok',
    ebayMyListings:async () => [bbq, mx],
    ebayReviseListing:async (env, tok, args) => { revised.push(args); return { system:'trading' }; },
    supabaseAdminFetch:async (env, path, opts = {}) => { if (opts.method === 'PATCH') { patches.push(JSON.parse(opts.body)); return { data:[] }; } if (path.startsWith('inventory_items?')) return { data:rows }; return { data:[] }; },
    ...over,
  } };
}
const post = body => ({ method:'POST', headers:{ get:() => null }, json:async () => body });
{
  const { d } = deps();
  const r = await handleFocRequest({ method:'GET', headers:{ get:() => null } }, {}, new URL('https://x/foc/admin/ebay-listings?store_id=s'), d);
  assert.equal(r.data.ok, true);
  assert.deepEqual(r.data.listings.map(l => [l.itemId, l.linked]), [['256538098712', false], ['257800000001', true]], 'hand-listed ones are included, flagged');
  assert.equal(r.data.listings[1].variations[0].linked, true);
  // Store ask: "Can it compare what eBay says vs what the dashboard says?"
  assert.deepEqual(r.data.listings[1].variations[0].dashboard, { rowId:'r1', sku:'mx-a', source:'foc_presale', presale:true, name:'Midnight X-Men A', price:5.99, qty:5 });
  assert.equal(r.data.listings[0].dashboard, null, 'nothing to compare for a hand-listed item');
}
{
  // ← USE EBAY'S on a presale cover: price, count and sales come over.
  const { d, patches } = deps();
  const mx2 = { ...mx, variations:[{ ...mx.variations[0], price:7.5, available:2, sold:4 }] };
  d.ebayMyListings = async () => [bbq, mx2];
  const r = await handleFocRequest(post({ storeId:'s', itemId:'257800000001', variationSku:'mx-a' }), {}, new URL('https://x/foc/admin/ebay-listings/to-dashboard'), d);
  assert.deepEqual(r.data, { ok:true, price:7.5, qty:2, countUpdated:true });
  assert.deepEqual([patches[0].data.salePrice, patches[0].data.qty, patches[0].data.focPresaleOriginalQty], [7.5, 2, 6]);
}
{
  // On a shelf item only the price comes over -- stock is what's physically here.
  const shelf = [{ id:'r9', status:'in_stock', data:{ source:'built_in', name:'BBQ set', ebayListingId:'256538098712', qty:3, salePrice:30 } }];
  const { d, patches } = deps({ supabaseAdminFetch:async (env, path, opts = {}) => { if (opts.method === 'PATCH') { patches.push(JSON.parse(opts.body)); return { data:[] }; } return { data:shelf }; } });
  const r = await handleFocRequest(post({ storeId:'s', itemId:'256538098712' }), {}, new URL('https://x/foc/admin/ebay-listings/to-dashboard'), d);
  assert.deepEqual(r.data, { ok:true, price:27.77, qty:3, countUpdated:false });
  assert.equal(patches[0].data.qty, 3);
  assert.equal(patches[0].data.salePrice, 27.77);
}
{
  // A hand-listed item: price change only, nothing in the dashboard to sync.
  const { d, revised, patches } = deps();
  const r = await handleFocRequest(post({ storeId:'s', itemId:'256538098712', price:24.99 }), {}, new URL('https://x/foc/admin/ebay-listings/revise'), d);
  assert.equal(r.data.ok, true);
  assert.deepEqual(revised, [{ itemId:'256538098712', sku:'', variationSku:'', price:24.99, quantity:null }]);
  assert.equal(patches.length, 0);
}
{
  // A presale cover: the dashboard row follows (quantity + price, sales kept).
  const { d, revised, patches } = deps();
  const r = await handleFocRequest(post({ storeId:'s', itemId:'257800000001', variationSku:'mx-a', quantity:3, price:6.99 }), {}, new URL('https://x/foc/admin/ebay-listings/revise'), d);
  assert.equal(r.data.synced, 1);
  assert.deepEqual([revised[0].variationSku, revised[0].quantity, revised[0].price], ['mx-a', 3, 6.99]);
  assert.equal(patches[0].data.qty, 3);
  assert.equal(patches[0].data.focPresaleOriginalQty, 4, '1 sold stays sold');
  assert.equal(patches[0].data.salePrice, 6.99);
}
{
  const { d } = deps();
  for (const [body, msg] of [[{ itemId:'x1', price:5 }, /itemId/], [{ itemId:'256538098712', price:0.5 }, /0\.99/], [{ itemId:'256538098712', quantity:1.5 }, /whole number/], [{ itemId:'256538098712' }, /Nothing to change/]]) {
    const r = await handleFocRequest(post({ storeId:'s', ...body }), {}, new URL('https://x/foc/admin/ebay-listings/revise'), d);
    assert.equal(r.status, 400); assert.match(r.data.error, msg);
  }
}

// Worker: the right eBay API per listing, and the quantity is checked.
const dep = worker.slice(worker.indexOf('ebayReviseListing: async'), worker.indexOf("return { system: 'trading' };", worker.indexOf('ebayReviseListing: async')));
assert.match(dep, /sell\/inventory\/v1\/offer\?sku=/, 'dashboard-made listings change through the Inventory API');
assert.match(dep, /ebayTradingApiCall\(ebayToken, 'ReviseInventoryStatus', status\(quantity\)\)/, 'listings made on eBay itself through the Trading API');
assert.match(dep, /'GetItem'/, 'the new quantity is read back');
assert.match(dep, /status\(quantity \+ now\.sold\)/, 'and corrected if eBay counted it as total listed');

// Screen.
assert.match(ui, /onclick="openEbayEditor\(\)">✏️ ALL EBAY LISTINGS<\/button>/);
assert.match(ui, /Oldest first \(stale\)/);
assert.match(ui, /Differences only/);
assert.match(ui, /USE DASHBOARD →/);
assert.match(ui, /← USE EBAY\\'S/);
assert.match(ui, /✓ matches/);
assert.match(ui, /not in dashboard/);
assert.match(ui, /\/foc\/admin\/ebay-listings\/revise/);

// Store question: "Is it just for FOC? We will have other stuff on eBay also."
// It covers the whole account; it now opens from the eBay tab too.
const html = fs.readFileSync('dashboard.html', 'utf8');
assert.match(html, /onclick="openEbayEditor\('ebay-hub-tools'\)">✏️ ALL EBAY LISTINGS<\/button>/);
assert.match(html, /onclick="openEbayListingsCheck\('ebay-hub-tools'\)">📋 EBAY LISTINGS CHECK<\/button>/);
assert.match(html, /<div id="ebay-hub-tools"><\/div>/);
assert.match(ui, /function panel\(\)\{return \(panelHostOverride&&document\.getElementById\(panelHostOverride\)\)\|\|document\.getElementById\('foc-panels'\);\}/);
assert.match(ui, /async function openEbayEditor\(hostId\)\{\n  if\(typeof hostId==='string'\)panelHostOverride=hostId;/);
assert.match(ui, /async function loadCycles\(force\)\{\n  panelHostOverride=null;/, 'opening the FOC wall puts screens back in the FOC tab');

console.log('All eBay listings editor checks passed');
