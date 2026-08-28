import assert from 'node:assert/strict';
import fs from 'node:fs';

const preorders = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// Store report: a real eBay order sold a FOC presale comic, but the FOC admin
// dashboard reverted to showing "CREATE EBAY PRESALE" / 0 customers / 0 store
// qty for that exact book right after, as if it had never been listed --
// even though the sale (and its profit) were real. Root cause: eBay presale
// listings default to quantity 10 (see EBAY_PRESALE_LABEL/qty default in
// foc-ebay-presale-review.test.mjs), and /ebay/orders/sync only flips an
// inventory_items row to status:'sold' once its qty hits 0 -- selling 1 of
// 10 leaves 9 remaining, so the row flips to status:'in_stock' instead
// (still a live, still-selling eBay listing, just no longer status:presale
// or status:sold). /foc/ebay/convert-to-instock does the same status flip
// once a book physically arrives, even for a listing that already partially
// sold. Every place that summarizes a SKU's eBay-presale sales queried only
// status=in.(presale,sold), so any row that had flipped to in_stock silently
// dropped out of the count -- not just a dashboard display bug: the same gap
// fed the real PRH distributor order (exportPrh/adminPrhSubmission) and the
// RECEIVE SHIPMENT fulfillment-obligation matching, under-counting real
// eBay sales in both.
const buildCatalogStart = preorders.indexOf('async function buildCycleCatalog');
const buildCatalogEnd = preorders.indexOf('async function adminCycle', buildCatalogStart) > -1
  ? preorders.indexOf('\nasync function ', buildCatalogStart + 40)
  : preorders.length;
const buildCatalogBody = preorders.slice(buildCatalogStart, buildCatalogEnd);
assert.match(buildCatalogBody, /status=in\.\(presale,sold,in_stock\)&select=id,status,data`\)/,
  'buildCycleCatalog must query presale, sold, AND in_stock rows -- a partially-sold or since-arrived presale listing lives at status:in_stock');

const ebayPresoldStart = preorders.indexOf('async function ebayPresoldBySku');
const ebayPresoldEnd = preorders.indexOf('\n}', ebayPresoldStart) + 2;
const ebayPresoldBody = preorders.slice(ebayPresoldStart, ebayPresoldEnd);
assert.match(ebayPresoldBody, /status=in\.\(presale,sold,in_stock\)&select=id,status,data`\)/,
  'ebayPresoldBySku (feeds the real PRH distributor order via exportPrh/adminPrhSubmission) must include in_stock rows, or an already-sold eBay unit silently drops out of the distributor order');

const receiveShipmentStart = preorders.indexOf('async function receiveShipment');
const receiveShipmentPresaleQueryEnd = preorders.indexOf('const presaleByskuId=new Map();', receiveShipmentStart);
const receiveShipmentPresaleQuery = preorders.slice(receiveShipmentStart, receiveShipmentPresaleQueryEnd);
assert.match(receiveShipmentPresaleQuery, /status=in\.\(presale,sold,in_stock\)&select=id,status,data`\)/,
  'receiveShipment\'s fulfillment-obligation query must include in_stock rows too, or an already-sold eBay unit is not reserved when the shipment is allocated');

console.log('FOC eBay presale in_stock status-tracking contract checks passed');

// ── Functional: ebayPresaleFields must correctly report a partially-sold
// presale listing as LISTED (not "never listed"), using exactly the shape
// buildCycleCatalog's presaleBySkuId map now produces once in_stock rows are
// included ──
const fieldsStart = preorders.indexOf('function ebayPresaleFields');
const fieldsEnd = preorders.indexOf('\n}', fieldsStart) + 2;
const ebayPresaleFields = new Function(preorders.slice(fieldsStart, fieldsEnd) + '\nreturn ebayPresaleFields;')();

const futureOnSale = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const deps = { addBusinessDays: (d, n) => new Date(d.getTime() + n * 24 * 60 * 60 * 1000) };

// A listing created at qty 10, with 1 unit sold on eBay -- the row has
// flipped to status:'in_stock' (remaining 9 > 0), but presaleBySkuId still
// aggregates it (originalQty:10, remainingQty:9) once the query fix above is
// in place. This must show up as still LISTED, with the sale counted.
const partiallyold = ebayPresaleFields(
  { on_sale_date: futureOnSale },
  { originalQty: 10, remainingQty: 9 },
  deps, 35,
);
assert.equal(partiallyold.ebayListed, true, 'a partially-sold presale listing must still report as listed');
assert.equal(partiallyold.ebayPresold, 1, 'the one eBay sale must be counted, not dropped');
assert.equal(partiallyold.ebayAvailable, 9, 'the remaining 9 copies must still show as available');
assert.equal(partiallyold.ebayPresaleStatus, 'LISTED', 'must resolve to LISTED, not fall through to ELIGIBLE_NOW/"never listed"');

// The bug as reported: if the in_stock row had been excluded (the old
// query), presale would be undefined for that SKU, and the exact "CREATE
// EBAY PRESALE" symptom the store saw reproduces here.
const droppedFromQuery = ebayPresaleFields({ on_sale_date: futureOnSale }, undefined, deps, 35);
assert.equal(droppedFromQuery.ebayPresaleStatus, 'ELIGIBLE_NOW', 'confirms the reported symptom: a SKU missing from presaleBySkuId (the old query gap) shows as never-listed');
assert.equal(droppedFromQuery.ebayListed, false);

console.log('FOC eBay presale partial-sale functional checks passed');

// The source of the original leak is fixed at both marketplace-sale entry
// points: a remaining FOC presale balance stays presale until the explicit
// receive/convert workflow sets ebayPresaleConverted=true.
const ebaySync = worker.slice(worker.indexOf("url.pathname === '/ebay/orders/sync'"), worker.indexOf("url.pathname === '/ebay/listing-performance'"));
assert.match(ebaySync, /const preservePresale = !depleted && \(invRow\.status === 'presale' \|\| d\.source === 'foc_presale'\) && d\.ebayPresaleConverted !== true;/,
  'automatic eBay order sync must preserve the remaining FOC presale balance');
assert.match(ebaySync, /const nextStatus = depleted \? 'sold' : preservePresale \? 'presale' : 'in_stock';/,
  'automatic eBay order sync must not expose a partial presale as in-stock');

const externalSale = worker.slice(worker.indexOf("url.pathname === '/inventory/record-external-sale'"), worker.indexOf("url.pathname === '/ebay/orders/ship'"));
assert.match(externalSale, /const preservePresale = !depleted && \(invRow\.status === 'presale' \|\| d\.source === 'foc_presale'\) && d\.ebayPresaleConverted !== true;/,
  'manual marketplace sale recording must preserve the remaining FOC presale balance');

console.log('FOC eBay presale inventory-status preservation checks passed');
