import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const focDash = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');

// Store request: "an automated way to make the lead image the one with
// all the covers listed as one image? ... other people's listings do
// that." This app has no image-compositing capability (no WASM/canvas
// library that draws multiple photos into one), so a real collage can't
// be auto-generated -- but a store-uploaded combined graphic can be set
// as an extra photo shown before a buyer picks a cover, never replacing
// each individual cover's own real photo.
//
// Store report (live listings): clicking through the photo gallery never
// changed the selected cover or its price. eBay's own Inventory API docs
// require the group's imageUrls array to correspond 1:1, in the SAME
// order, to variesBy.specifications.values -- exactly one photo per
// variation. The original version of this feature prepended mainImageUrl
// onto that array, shifting every cover's photo one position out of sync
// with its own label -- so mainImageUrl now rides on each variant's own
// inventory_item instead (an extra photo in that SKU's own gallery),
// never in the group-level array.

// ---------------------------------------------------------------------
// Backend: mainImageUrl rides on each variant's own inventory_item,
// never in the group's own strictly-1:1 imageUrls array
// ---------------------------------------------------------------------
const createGroupStart = worker.indexOf('async function createAndPublishEbayVariationListing');
assert.ok(createGroupStart !== -1, 'createAndPublishEbayVariationListing must exist');
const createGroupEnd = worker.indexOf('async function withdrawEbayOfferGroup', createGroupStart);
const createGroupBody = worker.slice(createGroupStart, createGroupEnd);
assert.match(createGroupBody, /imageUrls: \[\.\.\.\(v\.imageUrls \|\| \[\]\), b\.mainImageUrl\]\.filter\(Boolean\),/,
  'the optional store-uploaded main image must be added to each variant\'s OWN inventory_item photo gallery, not the group-level array');
assert.match(createGroupBody, /const groupImageUrls = built\.map\(v => v\.imageUrl\);/,
  'the group-level imageUrls array must stay exactly one photo per variant with no extra entries, or the live page\'s photo-to-variation binding breaks for every cover');

// ---------------------------------------------------------------------
// Backend: the route reads, sanitizes, and forwards mainImageUrl
// ---------------------------------------------------------------------
const routeStart = worker.indexOf("url.pathname === '/foc/ebay/presale-group-preview'");
const routeEnd = worker.indexOf("if (url.pathname === '/foc/ebay/convert-to-instock')", routeStart);
const routeBody = worker.slice(routeStart, routeEnd);
assert.match(routeBody, /const mainImageUrl = \(typeof body\.mainImageUrl === 'string' && body\.mainImageUrl\.trim\(\)\) \? body\.mainImageUrl\.trim\(\)\.substring\(0, 1000\) : '';/,
  'the create route must read and sanitize an optional mainImageUrl from the request body');
assert.match(routeBody, /fulfillmentPolicyId, storeCategoryNames, mainImageUrl,/,
  'the sanitized mainImageUrl must actually be forwarded into createAndPublishEbayVariationListing, or the upload has nowhere to go');

console.log('FOC eBay group-listing main photo (backend) contract checks passed');

// ---------------------------------------------------------------------
// Frontend: upload widget exists, reuses the same resize-then-upload
// pattern as the regular inventory photo editor, and both handlers are
// exposed on window (this file is an IIFE -- see
// foc-dashboard-window-exposure.test.mjs for why that's required).
// ---------------------------------------------------------------------
assert.match(focDash, /function handleFocGroupMainImageFile\(file\)\{/, 'the main-photo upload handler must exist');
assert.match(focDash, /function clearFocGroupMainImage\(\)\{/, 'the clear-main-photo handler must exist');
assert.match(focDash, /var max=1600;/, 'the upload must resize to the same 1600px longest side eBay\'s own photo guidance (and every other eBay-bound photo in this app) already uses');
assert.match(focDash, /storeWorkerFetch\('\/inventory\/photo\/upload',\{method:'POST',headers:\{'Content-Type':'image\/jpeg'\},body:blob\}\)/,
  'must upload through the same existing general-purpose photo storage route the regular inventory photo editor uses, not a new one-off endpoint');
assert.match(focDash, /window\.handleFocGroupMainImageFile=handleFocGroupMainImageFile;window\.clearFocGroupMainImage=clearFocGroupMainImage;/,
  'both new handlers must be exposed on window for their onclick/onchange attributes to find them');
assert.match(focDash, /onchange="handleFocGroupMainImageFile\(this\.files\[0\]\)"/, 'the file input must wire to the upload handler');
assert.match(focDash, /onclick="clearFocGroupMainImage\(\)"/, 'a CLEAR control must let the store remove a chosen main photo before publishing');
assert.match(focDash, /mainImageUrl:\(document\.getElementById\('foc-eb-grp-main-image-url'\)\?\.value\|\|''\)\.trim\(\)\|\|undefined,/,
  'the submit payload must actually include whatever main photo URL was uploaded');

console.log('FOC eBay group-listing main photo (frontend) contract checks passed');
