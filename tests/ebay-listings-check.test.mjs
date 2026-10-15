import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseMyEbaySellingActive, compareEbayListings, handleFocRequest } from '../scripts/foc-preorders.mjs';

// Store ask: "Can you see all my eBay listings?" (after Sonic RI 1:15 turned
// up with two live listings for one cover, and Cyberpunk rows that the store
// says were never on eBay).
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
const ui = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');

const xml = `<?xml version="1.0"?><GetMyeBaySellingResponse><Ack>Success</Ack><ActiveList><ItemArray>
<Item><ItemID>111</ItemID><Title>Sonic x Godzilla #3 Variant RI - PRESALE</Title><SKU>s1</SKU><Quantity>3</Quantity><QuantityAvailable>2</QuantityAvailable><SellingStatus><CurrentPrice currencyID="USD">24.99</CurrentPrice><QuantitySold>1</QuantitySold></SellingStatus></Item>
<Item><ItemID>222</ItemID><Title>Sonic x Godzilla #3 Variant RI &amp; more</Title><SKU>s2</SKU><Quantity>3</Quantity><SellingStatus><CurrentPrice currencyID="USD">24.99</CurrentPrice><QuantitySold>1</QuantitySold></SellingStatus></Item>
<Item><ItemID>333</ItemID><Title>Midnight X-Men #1</Title><Quantity>12</Quantity><SellingStatus><CurrentPrice currencyID="USD">5.99</CurrentPrice><QuantitySold>2</QuantitySold></SellingStatus><Variations><Variation><SKU>mx-a</SKU><Quantity>6</Quantity><VariationSpecifics><NameValueList><Name>Cover</Name><Value>Cover A</Value></NameValueList></VariationSpecifics><SellingStatus><QuantitySold>1</QuantitySold></SellingStatus></Variation><Variation><SKU>mx-b</SKU><Quantity>6</Quantity><VariationSpecifics><NameValueList><Name>Cover</Name><Value>Cover B</Value></NameValueList></VariationSpecifics><SellingStatus><QuantitySold>1</QuantitySold></SellingStatus></Variation></Variations></Item>
<Item><ItemID>444</ItemID><Title>Hand-listed Pokemon card</Title><Quantity>1</Quantity><SellingStatus><CurrentPrice currencyID="USD">9.00</CurrentPrice><QuantitySold>0</QuantitySold></SellingStatus></Item>
</ItemArray><PaginationResult><TotalNumberOfPages>3</TotalNumberOfPages><TotalNumberOfEntries>450</TotalNumberOfEntries></PaginationResult></ActiveList></GetMyeBaySellingResponse>`;
const parsed = parseMyEbaySellingActive(xml);
assert.equal(parsed.totalPages, 3);
assert.equal(parsed.items.length, 4);
assert.deepEqual({ id:parsed.items[0].itemId, av:parsed.items[0].available, price:parsed.items[0].price }, { id:'111', av:2, price:24.99 });
assert.equal(parsed.items[1].title, 'Sonic x Godzilla #3 Variant RI & more');
assert.equal(parsed.items[1].available, 2, 'quantity minus sold when QuantityAvailable is missing');
assert.deepEqual(parsed.items[2].variations.map(v => [v.sku, v.label, v.available]), [['mx-a', 'Cover A', 5], ['mx-b', 'Cover B', 5]]);

const rows = [
  { id:'r-sonic-1', status:'in_stock', data:{ source:'foc_presale', focSkuId:'sonic', name:'Sonic RI - PRESALE', ebayListingId:'111', ebaySku:'s1', qty:2 } },
  { id:'r-sonic-2', status:'in_stock', data:{ source:'foc_presale', focSkuId:'sonic', name:'Sonic RI', ebayListingId:'222', ebaySku:'s2', qty:2 } },
  { id:'r-mx-a', status:'presale', data:{ source:'foc_presale', focSkuId:'mxa', name:'Midnight X-Men A', ebayListingId:'333', ebaySku:'mx-a', ebayApiSystem:'trading', qty:4 } },
  { id:'r-cyber', status:'presale', data:{ source:'foc_presale', focSkuId:'cy', name:'Cyberpunk 2077 #1 A - PRESALE', ebayListingId:'999', qty:10 } },
  { id:'r-sold-out', status:'presale', data:{ source:'foc_presale', focSkuId:'so', name:'Sold out', ebayListingId:'998', qty:0 } },
  { id:'r-shelf', status:'in_stock', data:{ source:'built_in', name:'Shelf card', ebayListingId:'997', qty:3 } },
  { id:'r-ended', status:'presale', data:{ source:'foc_presale', name:'Ended', ebayListingId:'996', ebayWithdrawnAt:'2026-10-01', qty:0 } },
  // Store report: Sonic RI 1:15 -- both listings ended, rows still counted 2 each.
  { id:'r-ended-counted', status:'in_stock', data:{ source:'foc_presale', name:'Sonic RI', ebayListingId:'990', ebayWithdrawnAt:'2026-10-10', qty:2, focPresaleOriginalQty:3 } },
];
const c = compareEbayListings({ active:parsed.items, rows });
assert.equal(c.activeCount, 4);
assert.deepEqual(c.goneFromEbay.map(x => [x.rowId, x.presale]), [['r-cyber', true], ['r-shelf', false]], 'stale rows; a sold-out or already-ended one is not');
assert.equal(c.goneFromEbay[0].name, 'Cyberpunk 2077 #1 A');
assert.deepEqual(c.qtyMismatch.map(x => [x.rowId, x.label, x.dashQty, x.ebayQty, x.ebaySold]), [['r-mx-a', 'Cover A', 4, 5, 1]], 'per cover on a multi-cover listing, with eBay\'s sales');
assert.deepEqual(c.endedStillCounted.map(x => [x.rowId, x.dashQty, x.sold]), [['r-ended-counted', 2, 1]], 'an ended listing whose row still counts stock');
assert.deepEqual(c.ebayOnly.map(x => x.listingId), ['444']);
assert.equal(c.sameCoverTwice.length, 1);
assert.deepEqual(c.sameCoverTwice[0].listings.map(l => l.listingId), ['111', '222'], 'Sonic RI: one cover, two live listings');

// Routes.
function deps(over = {}) {
  const patches = [];
  return { patches, d:{
    json:(data, status = 200) => ({ status, data }),
    readJsonWithLimit:async r => ({ data:await r.json() }),
    requireStoreUser:async () => ({ user:{ id:'u' } }),
    getEbayUserAccessToken:async () => 'tok',
    ebayMyListings:async () => parsed.items,
    supabaseAdminFetch:async (env, path, opts = {}) => { if (opts.method === 'PATCH') { patches.push({ path, body:JSON.parse(opts.body) }); return { data:[] }; } if (path.startsWith('inventory_items?')) return { data:rows }; return { data:[] }; },
    ...over,
  } };
}
const post = body => ({ method:'POST', headers:{ get:() => null }, json:async () => body });
{
  const { d } = deps();
  const r = await handleFocRequest({ method:'GET', headers:{ get:() => null } }, {}, new URL('https://x/foc/admin/ebay-listings-check?store_id=s'), d);
  assert.equal(r.data.ok, true);
  assert.equal(r.data.sameCoverTwice.length, 1);
}
{
  const { d, patches } = deps();
  const r = await handleFocRequest(post({ storeId:'s', rowIds:['00000000-0000-4000-8000-000000000001'] }), {}, new URL('https://x/foc/admin/ebay-listings-check/mark-ended'), d);
  assert.equal(r.data.ok, true);
  assert.equal(patches.length, 0, 'an id that is not one of the store rows changes nothing');
}
{
  const id = '00000000-0000-4000-8000-0000000000aa', shelf = '00000000-0000-4000-8000-0000000000bb', live = '00000000-0000-4000-8000-0000000000cc';
  rows.push({ id, status:'presale', data:{ source:'foc_presale', name:'Cyber B', ebayListingId:'995', qty:10, focPresaleOriginalQty:10 } });
  rows.push({ id:shelf, status:'in_stock', data:{ source:'built_in', name:'Shelf 2', ebayListingId:'994', qty:3 } });
  rows.push({ id:live, status:'presale', data:{ source:'foc_presale', name:'Still live', ebayListingId:'111', qty:2 } });
  const { d, patches } = deps();
  const r = await handleFocRequest(post({ storeId:'s', rowIds:[id, shelf, live] }), {}, new URL('https://x/foc/admin/ebay-listings-check/mark-ended'), d);
  const byPath = Object.fromEntries(patches.map(p => [p.path.match(/id=eq\.([^&]+)/)[1], p.body.data]));
  assert.equal(byPath[id].qty, 0);
  assert.equal(byPath[id].focPresaleOriginalQty, 0, 'nothing sold -- ending must not read as 10 sold');
  assert.equal(byPath[id].ebayWithdrawnReason, 'not_on_ebay');
  assert.equal(byPath[shelf].qty, 3, 'a shelf item keeps its real stock');
  assert.ok(byPath[shelf].ebayWithdrawnAt);
  assert.equal(byPath[live], undefined, 'eBay is checked again: a listing that is live is left alone');
  assert.equal(r.data.results.find(x => x.rowId === live).ok, false);
}
{
  const revised = [];
  const id = '00000000-0000-4000-8000-0000000000dd';
  rows.push({ id, status:'in_stock', data:{ source:'foc_presale', name:'Sonic RI', ebayListingId:'111', ebaySku:'s1', qty:2, focPresaleOriginalQty:3 } });
  const { d, patches } = deps({ revisePresaleListing:async (env, tok, data, opts) => revised.push({ listing:data.ebayListingId, ...opts }) });
  const r = await handleFocRequest(post({ storeId:'s', rowId:id, quantity:0 }), {}, new URL('https://x/foc/admin/ebay-listings-check/set-quantity'), d);
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  assert.deepEqual(revised, [{ listing:'111', quantity:0 }]);
  assert.equal(patches[0].body.data.qty, 0);
  assert.equal(patches[0].body.data.focPresaleOriginalQty, 1, 'the 1 already sold stays sold');
}

// Wiring.
assert.match(worker, /ebayTradingApiCall\(ebayToken, 'GetMyeBaySelling', `<ActiveList><Include>true<\/Include><Pagination><EntriesPerPage>200<\/EntriesPerPage>/);
assert.match(worker, /parseMyEbaySellingActive \} from '\.\/scripts\/foc-preorders\.mjs'/);
assert.match(ui, /onclick="openEbayListingsCheck\(\)">📋 EBAY LISTINGS CHECK<\/button>/);
assert.match(ui, /MARK TICKED AS ENDED/);
assert.match(ui, /SET EBAY<\/button>/, 'set eBay to a number you choose, not always 0');
assert.match(ui, /KEEP EBAY\\'S /);
assert.match(ui, /ENDED ON EBAY, STILL COUNTED/);
assert.doesNotMatch(ui, />SET TO 0</);

// Store report listing the Goblin Storm deck: "Player/Athlete's value of
// 'Magic Secret Lair Drop Series Secret Lair Commander Deck Goblin Storm' is
// too long. Enter a value of no more than 65 characters."
assert.match(app, /player: item\.player \|\| \(\(fields\.cat === 'Sports' \|\| fields\.cat === 'Graded'\) \? item\.name \|\| '' : ''\),/);
assert.match(worker, /aspects\[key\] = \(aspects\[key\] \|\| \[\]\)\.map\(v => String\(v\)\.slice\(0, 65\)\.trim\(\)\)\.filter\(Boolean\);/);

{
  // Ended-but-counted rows zero out and, with a sale on them, become sold.
  const id = '00000000-0000-4000-8000-0000000000ee';
  rows.push({ id, status:'in_stock', data:{ source:'foc_presale', name:'Sonic RI', ebayListingId:'989', ebayWithdrawnAt:'2026-10-10', ebayWithdrawnReason:'manual_bulk_end', qty:2, focPresaleOriginalQty:3 } });
  const { d, patches } = deps();
  await handleFocRequest(post({ storeId:'s', rowIds:[id] }), {}, new URL('https://x/foc/admin/ebay-listings-check/mark-ended'), d);
  assert.equal(patches.length, 1);
  assert.equal(patches[0].body.status, 'sold');
  assert.equal(patches[0].body.data.qty, 0);
  assert.equal(patches[0].body.data.focPresaleOriginalQty, 1, 'the 1 sale stays');
  assert.equal(patches[0].body.data.ebayWithdrawnReason, 'manual_bulk_end', 'keeps why it was ended');
}
{
  // KEEP EBAY'S: the dashboard takes eBay's available count and its sales.
  const id = '00000000-0000-4000-8000-0000000000ff';
  rows.push({ id, status:'presale', data:{ source:'foc_presale', name:'Midnight X-Men A', ebayListingId:'333', ebaySku:'mx-a', ebayApiSystem:'trading', qty:4, focPresaleOriginalQty:4 } });
  const { d, patches } = deps();
  const r = await handleFocRequest(post({ storeId:'s', rowId:id }), {}, new URL('https://x/foc/admin/ebay-listings-check/match-ebay'), d);
  assert.deepEqual(r.data, { ok:true, available:5, sold:1 });
  assert.equal(patches[0].body.data.qty, 5);
  assert.equal(patches[0].body.data.focPresaleOriginalQty, 6, 'sold + available');
}

console.log('eBay listings check + aspect length checks passed');
