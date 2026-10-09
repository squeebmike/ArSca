import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store report: Adventure Time Halloween Special #1 was switched to in stock
// by the old conversion, which rebuilt its eBay listing from scratch -- one
// line of description, no item specifics, the card-sized package. The
// ⋯ menu's REBUILD EBAY LISTING puts it back together from the FOC catalog.
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
const grab = (sig, end = '\n}\n') => { const s = worker.indexOf(sig); assert.ok(s >= 0, 'missing ' + sig); return worker.slice(s, worker.indexOf(end, s) + end.length); };
const line = sig => { const s = worker.indexOf(sig); assert.ok(s >= 0, 'missing ' + sig); return worker.slice(s, worker.indexOf('\n', s) + 1); };
const routeStart = worker.indexOf("    if (url.pathname === '/foc/ebay/rebuild-listing') {");
assert.ok(routeStart > 0, 'the rebuild route exists');
const route = worker.slice(routeStart, worker.indexOf("    if (url.pathname === '/foc/ebay/convert-to-instock') {", routeStart));

function load({ row, sku, item, offer }) {
  const calls = { puts: [], patches: [] };
  const fn = new Function('fetch', 'supabaseAdminFetch', 'getEbayUserAccessToken', [
    line('const COMIC_GEMINI_MAILER ='), line('const COMIC_SHIPPING_NOTE ='), line('const COMIC_IN_STOCK_SHIPPING ='),
    grab('function truncateHtmlSafely('), grab('function comicPresaleNotice('), grab('function withComicListingNotices('),
    grab('function comicPresaleToInStockDescription('), grab('function stripPresaleSuffix('), grab('function buildEbayAspects('),
    grab('function toEbayHtmlDescription('),
    grab('    function truncateAtWordBoundary(', '\n    }\n'), grab('    function buildFocPresaleDefaults(', '\n    }\n'),
    'const json = (b, status = 200) => ({ status, body: b });',
    'const requestStoreId = () => "store-1";',
    'const requireStoreUser = async () => ({});',
    'return async function (request, env, url) {', route, 'return null; };',
  ].join('\n'));
  const handler = fn(
    async (u, opts = {}) => {
      u = String(u);
      if ((opts.method || 'GET') === 'PUT') { calls.puts.push({ u, body: JSON.parse(opts.body) }); return { ok: true, status: 204, text: async () => '' }; }
      if (u.includes('/inventory_item/')) return { ok: true, status: 200, json: async () => item };
      if (u.includes('/offer/')) return { ok: true, status: 200, json: async () => offer };
      throw new Error('unexpected ' + u);
    },
    async (env, path, opts = {}) => {
      if (opts.method === 'PATCH') { calls.patches.push({ path, body: JSON.parse(opts.body) }); return { data: null }; }
      if (path.startsWith('inventory_items?')) return { data: row ? [row] : [] };
      if (path.startsWith('comic_skus?')) return { data: sku ? [sku] : [] };
      if (path.startsWith('comic_title_families?')) return { data: [{ issue_number: '1', series_name: 'Adventure Time (2025)' }] };
      throw new Error('unexpected ' + path);
    },
    async () => 'token',
  );
  const run = body => handler({ method: 'POST', json: async () => body }, {}, new URL('https://w.test/foc/ebay/rebuild-listing'));
  return { run, calls };
}

const damagedRow = {
  id: 'inv-1', status: 'in_stock',
  data: { name: 'ADVENTURE TIME HALLOWEEN SPECIAL #1 CVR A SEAN DOVE - PRESALE', title: 'ADVENTURE TIME HALLOWEEN SPECIAL #1 CVR A SEAN DOVE - PRESALE', focSkuId: 'sku-1', ebaySku: 'lba-1', ebayOfferId: '246558006011', ebayListingId: '257704492434', category: 'Comic', upc: '64985600906700111', market: 7.99, onSaleDate: '2026-09-30' },
};
const sku = { id: 'sku-1', family_id: 'fam-1', title: 'Adventure Time Halloween Special #1', variant_label: 'Cover A Sean Dove', publisher: 'Oni Press', writer: 'Jeremy Melloul', cover_artist: 'Sean Dove', on_sale_date: '2026-09-30', customer_price_cents: 799, upc: '64985600906700111', description: 'BOO . . . FROM THE LAND OF OOO! Finn and Jake enter a new dungeon.', cover_image_url: 'https://img.test/cover.jpg' };
const damagedItem = {
  sku: 'lba-1', condition: 'NEW', availability: { shipToLocationAvailability: { quantity: 1 } },
  product: { title: 'Adventure Time Halloween Special #1 Cover A Sean Dove', description: 'Adventure Time Halloween Special #1 / In stock now and ships promptly.', imageUrls: ['https://img.test/photo1.jpg', 'https://img.test/photo2.jpg'], aspects: { Condition: ['New'] } },
  packageWeightAndSize: { dimensions: { length: 6.5, width: 4, height: 0.1, unit: 'INCH' }, weight: { value: 0.1, unit: 'POUND' } },
};
const offer = { sku: 'lba-1', marketplaceId: 'EBAY_US', format: 'FIXED_PRICE', categoryId: '259104', availableQuantity: 1, listingDescription: 'Adventure Time Halloween Special #1 / In stock now and ships promptly.', pricingSummary: { price: { value: '7.99', currency: 'USD' } }, listingPolicies: { fulfillmentPolicyId: 'normal-1', paymentPolicyId: 'p', returnPolicyId: 'r' }, merchantLocationKey: 'walkoff-main', storeCategoryNames: [] };

// ── Built-in description (no store template sent) ──
{
  const { run, calls } = load({ row: damagedRow, sku, item: damagedItem, offer });
  const res = await run({ inventoryItemId: 'inv-1' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.ok, true);
  const itemPut = calls.puts.find(p => p.u.includes('/inventory_item/')).body;
  const offerPut = calls.puts.find(p => p.u.includes('/offer/')).body;
  assert.equal(itemPut.product.title, 'Adventure Time Halloween Special #1 Cover A Sean Dove Oni Press', 'in-stock title, no PRESALE');
  assert.doesNotMatch(itemPut.product.description, /PRESALE|not been released|In stock now and ships promptly/);
  assert.match(itemPut.product.description, /FROM THE LAND OF OOO/, 'the catalog synopsis is back');
  assert.match(itemPut.product.description, /Gemini mailer/);
  assert.equal(offerPut.listingDescription, itemPut.product.description, 'the offer carries the same description');
  const a = itemPut.product.aspects;
  assert.deepEqual(a.Publisher, ['Oni Press']);
  assert.deepEqual(a['Artist/Writer'], ['Jeremy Melloul']);
  assert.deepEqual(a['Series Title'], ['Adventure Time (2025)']);
  assert.deepEqual(a['Issue Number'], ['1']);
  assert.deepEqual(a.Condition, ['New']);
  assert.deepEqual(a.UPC, ['64985600906700111']);
  assert.equal(a.Sport, undefined, 'a comic gets no Sport aspect');
  assert.deepEqual(itemPut.packageWeightAndSize.dimensions, { length: 12.75, width: 7.75, height: 1.25, unit: 'INCH' }, 'Gemini mailer size');
  assert.equal(itemPut.packageWeightAndSize.weight.value, 0.25 + 0.3125);
  assert.deepEqual(itemPut.product.imageUrls, damagedItem.product.imageUrls, 'photos stay as eBay has them');
  assert.equal(itemPut.availability.shipToLocationAvailability.quantity, 1, 'quantity untouched');
  assert.equal(itemPut.sku, undefined);
  assert.deepEqual(offerPut.pricingSummary, offer.pricingSummary, 'price untouched');
  assert.deepEqual(offerPut.listingPolicies, offer.listingPolicies, 'shipping policy untouched');
  assert.deepEqual(offerPut.storeCategoryNames, ['Comic Books']);
  assert.equal(offerPut.marketplaceId, undefined, 'only editable offer fields go back');
  assert.equal(calls.patches.length, 1);
  assert.equal(calls.patches[0].body.data.name, 'ADVENTURE TIME HALLOWEEN SPECIAL #1 CVR A SEAN DOVE', 'the store name loses PRESALE too');
}

// ── The dashboard's rendered store template is used when sent ──
{
  const { run, calls } = load({ row: damagedRow, sku, item: damagedItem, offer });
  const template = '<div><div>THE MANA POCKET</div><div>FAST, SECURE SHIPPING</div>Bagged & boarded and shipped in a Gemini mailer. In stock and ships within 1 business day with tracking.</div>';
  const res = await run({ inventoryItemId: 'inv-1', description: template });
  assert.equal(res.body.ok, true);
  const desc = calls.puts.find(p => p.u.includes('/inventory_item/')).body.product.description;
  assert.match(desc, /THE MANA POCKET/);
  assert.equal((desc.match(/Gemini mailer/g) || []).length, 1, 'no second Gemini line');
}

// ── Refusals ──
{
  const notFoc = load({ row: { ...damagedRow, data: { ...damagedRow.data, focSkuId: '' } }, sku, item: damagedItem, offer });
  assert.equal((await notFoc.run({ inventoryItemId: 'inv-1' })).status, 400);
  const multi = load({ row: { ...damagedRow, data: { ...damagedRow.data, ebayApiSystem: 'trading' } }, sku, item: damagedItem, offer });
  assert.equal((await multi.run({ inventoryItemId: 'inv-1' })).status, 400);
  assert.equal(multi.calls.puts.length, 0);
  const missing = load({ row: null, sku, item: damagedItem, offer });
  assert.equal((await missing.run({ inventoryItemId: 'inv-1' })).status, 404);
}

// ── Dashboard wiring ──
{
  assert.match(app, /canRebuildFocEbayListing\(item\)\?`<button class="hbtn"[^`]*onclick="rebuildFocEbayListing\('\$\{id\}'\);closeInvRowMenu\(\)"[^`]*>🛠️ Rebuild eBay Listing<\/button>`:''/, 'the ⋯ menu offers it');
  const fn = app.slice(app.indexOf('async function rebuildFocEbayListing('), app.indexOf('window.rebuildFocEbayListing'));
  assert.match(fn, /storeWorkerFetch\('\/foc\/ebay\/rebuild-listing'/);
  assert.match(fn, /resolveEbayShippingLine\('Comic', true, false, false, '259104'\)/, 'an in-stock book gets the in-stock shipping line in the store template');
  assert.match(fn, /if\(!confirm\(/, 'asks before touching the live listing');
  const can = app.slice(app.indexOf('function canRebuildFocEbayListing('), app.indexOf('async function rebuildFocEbayListing('));
  assert.match(can, /item\.focSkuId && item\.ebaySku && item\.ebayOfferId && item\.ebayApiSystem !== 'trading'/);
}

console.log('FOC eBay rebuild listing checks passed');
