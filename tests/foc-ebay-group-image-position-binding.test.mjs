import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// Store report: on a live multi-cover eBay listing, clicking through the
// photo gallery never changed the selected cover in the "Cover:" dropdown
// or its price. Investigated directly against production data first --
// each cover's own stored image was confirmed distinct and correct, ruling
// out a missing/wrong-image bug -- then confirmed against eBay's own
// Inventory API documentation: the inventory_item_group's own top-level
// imageUrls array must correspond 1:1, in the SAME order, to
// variesBy.specifications.values -- exactly one photo per variation. Two
// things broke that contract:
//   1. new Set(...) could silently collapse two covers sharing a borrowed
//      fallback photo (see the anyCoverImage fallback) down to one array
//      entry, shifting every cover after it out of alignment with its own
//      label.
//   2. Prepending the optional store-uploaded "main listing photo" added
//      an extra array entry with nothing in specifications.values to
//      match it, shifting EVERY cover's photo one position off from what
//      its own dropdown selection should show.
// Both are real, verifiable bugs in how this app built that request, not
// something on eBay's side.

const createGroupStart = worker.indexOf('async function createAndPublishEbayVariationListing(');
assert.ok(createGroupStart !== -1, 'createAndPublishEbayVariationListing must exist');
// Ends right where the next function starts (buildVariationPictureSetsXml)
// -- NOT at withdrawEbayOfferGroup, which is defined much further down and
// would otherwise swallow every function in between, including the
// unrelated Trading-API createAndPublishEbayVariationListingTrading (which
// legitimately does mix mainImageUrl into ITS OWN gallery array -- that's
// a different, position-INsensitive top-level PictureDetails list, not the
// REST inventory_item_group's position-sensitive one this test guards).
const createGroupEnd = worker.indexOf('function buildVariationPictureSetsXml', createGroupStart);
const createGroupBody = worker.slice(createGroupStart, createGroupEnd);

// The group-level array: exactly one entry per built variant, same order,
// no dedupe, no extra "main photo" entry mixed in.
assert.match(createGroupBody, /const groupImageUrls = built\.map\(v => v\.imageUrl\);/,
  'groupImageUrls must be a plain 1:1 mapping over built (one photo per variant, same order as specifications.values) -- no Set-based dedupe and nothing prepended');
assert.doesNotMatch(createGroupBody, /new Set\(\[b\.mainImageUrl/,
  'mainImageUrl must never be mixed into the position-sensitive group imageUrls array again');

// variesBy.specifications.values comes from the exact same built array, in
// the exact same order/length as groupImageUrls -- confirming the 1:1
// correspondence eBay's docs require actually holds.
assert.match(createGroupBody, /values: built\.map\(v => v\.label\)/,
  'specifications.values must be built from the same array, in the same order, as groupImageUrls -- built.map(v => v.imageUrl) and built.map(v => v.label) share one shared source of truth so they can never drift out of alignment');

// mainImageUrl instead lands on each variant's OWN inventory_item gallery
// (an extra photo within that one SKU's own set), which is not subject to
// the group-level 1:1 contract.
assert.match(createGroupBody, /imageUrls: \[\.\.\.\(v\.imageUrls \|\| \[\]\), b\.mainImageUrl\]\.filter\(Boolean\),/,
  'the optional main photo must ride on each variant\'s own inventory_item imageUrls, never the shared group array');

console.log('eBay group-listing photo-to-variation position-binding checks passed');
