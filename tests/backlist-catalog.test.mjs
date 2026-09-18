import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  normalizeBacklistRow, estimateBacklistDelivery, backlistOrderConfirmationEmail,
  syncBacklistStripeEvent, handleBacklistRequest,
} from '../scripts/backlist-catalog.mjs';

const service = fs.readFileSync('scripts/backlist-catalog.mjs', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// --- normalizeBacklistRow / orderability gate ---------------------------
// Real column schema, real sample values from the actual PRH backlist file
// (comics and regular books both appear in it, unlike the comics-only
// weekly FOC feed).

const comicRowPastOnSale = {
  MainIdentifier:'82771403315101331', UPC:'82771403315101331', Title:'Teenage Mutant Ninja Turtles #13 Variant C (Cullum)',
  PublisherName:'IDW Publishing', ImprintName:'IDW Publishing', FormatCode:'CB', FormatName:'Comic Book',
  SalesStatusCode:'IP', SalesStatus:'Active', SeriesName:'Teenage Mutant Ninja Turtles (2024)', SeriesNumber:'13',
  PriceUSD:'4.99', OrderRequirement:'Order All', TitleFamilyID:'817087', CoverLink:'https://images.penguinrandomhouse.com/cover/d/82771403315101331',
  OnSaleDate:'01/01/2020', // safely in the past regardless of when this test runs
};
const bookRowFutureOnSale = {
  MainIdentifier:'9781838743536', ISBN:'9781838743536', Title:'Froggy: Autumn Antics!',
  PublisherName:'Flying Eye Books Ltd.', ImprintName:'Flying Eye Books', FormatCode:'TR', FormatName:'Trade Paperback',
  SalesStatusCode:'IP', SalesStatus:'Active', PriceUSD:'12.99', TitleFamilyID:'815548',
  OnSaleDate:'01/01/2099', // safely in the future regardless of when this test runs
};
const incentiveRow = { ...comicRowPastOnSale, MainIdentifier:'75960621375700216', UPC:'75960621375700216', OrderRequirement:'2:40' };
const inactiveRow = { ...comicRowPastOnSale, MainIdentifier:'99999999999999999', UPC:'99999999999999999', SalesStatus:'Inactive' };

{
  const p = normalizeBacklistRow(comicRowPastOnSale);
  assert.equal(p.distributorSku, '82771403315101331');
  assert.equal(p.upc, '82771403315101331');
  assert.equal(p.publisher, 'IDW Publishing');
  assert.equal(p.formatCode, 'CB');
  assert.equal(p.formatName, 'Comic Book');
  assert.equal(p.salesStatus, 'Active');
  assert.equal(p.msrpCents, 499);
  assert.equal(p.isOrderable, true, 'Active status + a past on-sale date must be orderable');
  assert.equal(p.isIncentive, false, '"Order All" must not be treated as a ratio incentive');
}
{
  const p = normalizeBacklistRow(bookRowFutureOnSale);
  assert.equal(p.isbn, '9781838743536', 'a regular book with no UPC must fall back to ISBN');
  assert.equal(p.upc, '9781838743536', 'the UPC fallback chain must also use ISBN when MainIdentifier/UPC are absent');
  assert.equal(p.formatCode, 'TR');
  assert.equal(p.isOrderable, false, 'a future on-sale date must never be orderable even when SalesStatus says Active -- the real feed carries exactly this combination');
}
{
  const p = normalizeBacklistRow(inactiveRow);
  assert.equal(p.isOrderable, false, 'a non-Active status must never be orderable regardless of the on-sale date');
}
{
  // The real backlist feed carries "2:40"-style ratios, not just "1:N" --
  // foc-preorders.mjs's own ratioThreshold() only matches 1:N and would
  // silently miss this (a known, separately-flagged pre-existing gap left
  // untouched there). This importer's own regex must not repeat that gap.
  const p = normalizeBacklistRow(incentiveRow);
  assert.equal(p.ratioThreshold, 40, '"2:40" must resolve to a real threshold, not be silently dropped');
  assert.equal(p.isIncentive, true);
}

console.log('normalizeBacklistRow orderability/ratio checks passed');

// --- estimateBacklistDelivery --------------------------------------------
// A real calculation (days to the next Monday + PRH's documented fulfillment
// window + outbound shipping), not copied "TBA" text -- no existing code
// anywhere in this app computes "days until next Monday".

function fakeAddBusinessDays(date, n) {
  const d = new Date(date.getTime());
  let remaining = Math.abs(n);
  const step = n >= 0 ? 1 : -1;
  while (remaining > 0) { d.setUTCDate(d.getUTCDate() + step); const day = d.getUTCDay(); if (day !== 0 && day !== 6) remaining--; }
  return d;
}

{
  // A Wednesday "now" with a past on-sale date -- the next order cycle is
  // the upcoming Monday, not today.
  const wednesday = new Date('2026-09-16T12:00:00Z'); // a real past Wednesday
  const result = estimateBacklistDelivery('2020-01-01', wednesday, fakeAddBusinessDays);
  const nextMonday = new Date('2026-09-21T12:00:00Z');
  assert.ok(new Date(result.earliestAvailable) >= nextMonday, 'earliest availability must not be before the next Monday order');
  assert.ok(new Date(result.latestAvailable) > new Date(result.earliestAvailable), 'latest must be after earliest');
  assert.match(result.headline, /next weekly publisher order/i);
}
{
  // A title that hasn't even released yet can't ride an order before its
  // own street date passes, even if that's weeks from "now".
  const now = new Date('2026-09-16T12:00:00Z');
  const farFutureOnSale = '2026-12-01';
  const result = estimateBacklistDelivery(farFutureOnSale, now, fakeAddBusinessDays);
  assert.ok(new Date(result.earliestAvailable) >= new Date(farFutureOnSale + 'T12:00:00Z'), 'a not-yet-released title\'s estimate must never be before its own on-sale date');
}

console.log('estimateBacklistDelivery checks passed');

// --- Checkout -------------------------------------------------------------

function mockRequest(body, method = 'POST') { return { method, headers:{ get:() => null }, json:async () => body }; }
function mockDeps(overrides = {}) {
  return {
    json:(data, status = 200) => ({ status, data }),
    readJsonWithLimit:async (request) => ({ data:await request.json() }),
    requireAuthenticatedUser:async () => ({ user:{ id:'user-1', email:'jane@example.com' } }),
    requireStoreUser:async () => ({ user:{ id:'staff-1' } }),
    stripeMode:() => 'test',
    stripeConfig:() => ({ secretKey:'sk_test_x', publishableKey:'pk_test_x' }),
    supabaseAdminFetch:async () => ({ data:[] }),
    stripeApi:async () => { throw new Error('unexpected stripeApi call'); },
    sendEmail:async () => {},
    addBusinessDays:fakeAddBusinessDays,
    ...overrides,
  };
}

{
  const sku = { id:'11111111-1111-4111-8111-111111111111', upc:'123', msrp_cents:1299, customer_price_cents:1299, on_sale_date:'2020-01-01', backlist_titles:{ title:'Froggy', cover_image_url:'' } };
  const inserts = [];
  const deps = mockDeps({
    supabaseAdminFetch:async (env, path, options) => {
      if (path.startsWith('backlist_skus?')) return { data:[sku] };
      if (options?.method === 'POST') inserts.push({ path, body:JSON.parse(options.body) });
      return { data:[] };
    },
    stripeApi:async () => ({ id:'pi_1', client_secret:'secret_1' }),
  });
  const res = await handleBacklistRequest(mockRequest({ storeId:'store-1', items:[{ skuId:sku.id, quantity:1 }] }), {}, new URL('https://x/public/backlist/checkout'), deps);
  assert.equal(res.data.ok, true, 'checkout must succeed for an orderable, priced sku');
  assert.ok(res.data.clientSecret, 'must return a Stripe client secret');
  const orderInsert = inserts.find(i => i.path === 'backlist_orders');
  assert.ok(orderInsert, 'must insert a backlist_orders row');
  assert.match(orderInsert.body.order_number, /^BL-\d{8}-[0-9A-F]{8}$/, 'order numbers must follow the BL-YYYYMMDD-XXXXXXXX convention');
  assert.ok(orderInsert.body.estimated_ship_earliest, 'the order must carry a computed delivery estimate, not leave it blank');
}
{
  // A sku that's out of stock/unpublished/disabled must never be checkoutable,
  // regardless of what the client claims about it.
  const deps = mockDeps({ supabaseAdminFetch:async (env, path) => path.startsWith('backlist_skus?') ? { data:[] } : { data:[] } });
  const res = await handleBacklistRequest(mockRequest({ storeId:'store-1', items:[{ skuId:'22222222-2222-4222-8222-222222222222', quantity:1 }] }), {}, new URL('https://x/public/backlist/checkout'), deps);
  assert.equal(res.data.ok, false);
  assert.equal(res.status, 409);
}

console.log('backlistCheckout functional checks passed');

// --- Stripe webhook sync ---------------------------------------------------

{
  const order = { id:'order-1', order_number:'BL-20260101-AAAAAAAA', store_id:'store-1', user_id:'user-1', customer_email:'jane@example.com', stripe_mode:'test', total_cents:1299, subtotal_cents:1299, shipping_cents:0, fulfillment_method:'pickup' };
  const patches = []; let emailSent = null;
  const deps = {
    supabaseAdminFetch: async (env, path, options) => {
      if (path.startsWith('backlist_orders?id=') && (!options || options.method !== 'PATCH')) return { data:[order] };
      if (options?.method === 'PATCH') { patches.push({ path, body:JSON.parse(options.body) }); return { data:[{ ...order, ...JSON.parse(options.body) }] }; }
      if (path.startsWith('backlist_order_items?order_id=')) return { data:[{ id:'item-1', sku_id:'sku-1', quantity:1, unit_price_cents:1299, sku_snapshot:{ title:'Froggy', msrpCents:1299 } }] };
      return { data:[] };
    },
    sendEmail: async (env, to, subject, body) => { emailSent = { to, subject, body }; },
  };
  const event = { type:'payment_intent.succeeded', data:{ object:{ id:'pi_1', status:'succeeded', metadata:{ source:'backlist_order', backlist_order_id:'order-1' }, currency:'usd' } } };
  await syncBacklistStripeEvent({}, event, deps);
  const orderPatch = patches.find(p => p.path.includes('backlist_orders?'));
  assert.equal(orderPatch.body.status, 'paid');
  assert.ok(emailSent, 'a successful payment must send a confirmation email');
  assert.match(emailSent.subject, /BL-20260101-AAAAAAAA/);

  // Idempotency: a redelivered webhook for the same event must not send a
  // second email or re-patch a row that no longer matches status=neq.paid.
  patches.length = 0; emailSent = null;
  const idempotentDeps = { ...deps, supabaseAdminFetch: async (env, path, options) => {
    if (path.startsWith('backlist_orders?id=') && options?.method === 'PATCH' && path.includes('status=neq.paid')) return { data:[] }; // already paid -- guard matches zero rows
    if (path.startsWith('backlist_orders?id=') && (!options || options.method !== 'PATCH')) return { data:[{ ...order, status:'paid' }] };
    return { data:[] };
  }};
  await syncBacklistStripeEvent({}, event, idempotentDeps);
  assert.equal(emailSent, null, 'a redelivered webhook must not send a second confirmation email');
}
{
  // Other channels' Stripe events (e.g. FOC preorders, regular storefront)
  // must be ignored outright, not misparsed as a backlist order.
  let called = false;
  const deps = { supabaseAdminFetch: async () => { called = true; return { data:[] }; }, sendEmail: async () => { called = true; } };
  await syncBacklistStripeEvent({}, { type:'payment_intent.succeeded', data:{ object:{ metadata:{ source:'foc_preorder' } } } }, deps);
  assert.equal(called, false, 'an event for a different source must be ignored entirely');
}

console.log('syncBacklistStripeEvent checks passed');

// --- Confirmation email copy ------------------------------------------------

{
  const order = { order_number:'BL-1', customer_name:'Jane', subtotal_cents:1299, total_cents:1299, shipping_cents:0, fulfillment_method:'pickup', estimated_ship_earliest:'2026-10-05', estimated_ship_latest:'2026-10-19' };
  const { subject, body } = backlistOrderConfirmationEmail(order, [{ quantity:1, unit_price_cents:1299, sku_snapshot:{ title:'Froggy' } }]);
  assert.match(subject, /BL-1/);
  assert.match(body, /ships with our next weekly publisher order/i, 'the email must set expectations that this is not shipping from shelf stock');
  assert.match(body, /2026-10-05/, 'the email must include the real computed delivery window, not a vague promise');
}

console.log('backlistOrderConfirmationEmail checks passed');

// --- Route dispatch + import/unpublish-sweep wiring ------------------------

assert.match(service, /if \(path === '\/public\/backlist\/search' && request\.method === 'GET'\)/);
assert.match(service, /if \(path === '\/public\/backlist\/checkout' && request\.method === 'POST'\)/);
assert.match(service, /if \(path === '\/backlist\/admin\/import\/start' && request\.method === 'POST'\)/);
assert.match(service, /if \(path === '\/backlist\/admin\/import\/batch' && request\.method === 'POST'\)/);
assert.match(service, /if \(path === '\/backlist\/admin\/import\/finish' && request\.method === 'POST'\)/);
assert.match(service, /if \(path === '\/backlist\/admin\/receive' && request\.method === 'POST'\)/);

// The chunked-import protocol exists because a single request cannot carry
// this feed -- readJsonWithLimit caps a request body well below what tens
// of thousands of wide rows would serialize to, and importPrh's own
// slice(0,2000) already shows the existing single-shot importer's ceiling.
assert.match(service, /readJsonWithLimit\(request, 2 \* 1024 \* 1024\)/, 'importBatch must still respect the same request-size ceiling as importPrh, just spread across many calls');
assert.match(service, /const hadCustomPrice = before && Number\(before\.customer_price_cents \|\| 0\) !== Number\(before\.msrp_cents \|\| 0\)/, 'a staff-set custom price must survive re-import, same convention as the FOC/Lunar importers');

// The unpublish sweep is the real safety net given the feed has no
// confirmed out-of-print status code -- a sku/title this import never
// touched must be pulled from the site, not left stale.
assert.match(service, /last_seen_import_id=neq\.\$\{encodeURIComponent\(importId\)\}&is_published=eq\.true/, 'importFinish must find skus the newest import never touched');
assert.match(service, /is_published: false, is_orderable: false/, 'a vanished sku must be unpublished AND marked not-orderable, not just hidden from search while still technically buyable by id');

console.log('Backlist route dispatch and import/unpublish-sweep wiring checks passed');

// --- Worker wiring ----------------------------------------------------------

assert.match(worker, /import \{ handleBacklistRequest, syncBacklistStripeEvent \} from '\.\/scripts\/backlist-catalog\.mjs';/);
assert.match(worker, /url\.pathname\.startsWith\('\/public\/backlist\/'\) \|\| url\.pathname\.startsWith\('\/backlist\/admin\/'\)/, 'the backlist route family must be dispatched from the Worker');
assert.match(worker, /await syncBacklistStripeEvent\(env,event,\{supabaseAdminFetch,sendEmail,addBusinessDays\}\)/, 'the Stripe webhook handler must forward backlist events to syncBacklistStripeEvent, same as it already does for FOC');

console.log('Backlist Worker wiring checks passed');
