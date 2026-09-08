import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const focDash = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');

// Store report (live error while testing the multi-cover eBay variation
// listing feature): "Could not create eBay variation listing: Publish
// failed (400): A user error has occurred. Add at least 1 photo." A cover
// whose FOC import never got real cover art (cover_image_url empty)
// published its own inventory_item with zero images, and eBay rejected the
// WHOLE shared group listing over that one variant. Follow-up questions:
// "it should use all images from the foc? also what is it doing for a
// title for the bundle? and what is it doing for an image for the bundle?"

const routeStart = worker.indexOf("url.pathname === '/foc/ebay/presale-group-preview'");
const routeEnd = worker.indexOf("if (url.pathname === '/foc/ebay/convert-to-instock')", routeStart);
const routeBody = worker.slice(routeStart, routeEnd);

// A cover missing its own cover_image_url must borrow another selected
// cover's photo rather than publish with none.
assert.match(routeBody, /const anyCoverImage = built\.find\(v => v\.imageUrl\)\?\.imageUrl \|\| '';/, 'must find a usable fallback image among the selected covers');
assert.match(routeBody, /if \(!anyCoverImage\) return json\(\{ ok: false, error: 'None of the selected covers have a cover image on file/,
  'must fail with a clear, specific error BEFORE calling eBay if literally no selected cover has any image at all, instead of letting eBay\'s cryptic 400 be the only signal');
assert.match(routeBody, /built\.forEach\(v => \{ if \(!v\.imageUrl\) v\.imageUrl = anyCoverImage; \}\);/,
  'every variant missing its own cover art must be backfilled with a borrowed real cover photo, not published blank');

// The bundle variant's image must be a gallery of every real cover's own
// photo, not just one at random -- "what is it doing for an image for the
// bundle" answered: all of them.
assert.match(routeBody, /const allCoverImages = \[\.\.\.new Set\(built\.map\(v => v\.imageUrl\)\.filter\(Boolean\)\)\];/,
  'must collect every distinct real cover image actually available');
assert.match(routeBody, /imageUrl: allCoverImages\[0\] \|\| anyCoverImage, imageUrls: allCoverImages, upc: '', aspectOverrides: \{\},/,
  'the bundle variant must carry the full gallery of every selected cover\'s image, not a single borrowed one');

// The bundle's TITLE is the shared group title (same as every other
// variant) -- eBay variation listings have ONE title at the group level;
// only the Cover dropdown value (the bundle's `label`) differs per variant.
// Confirmed via createAndPublishEbayVariationListing always using
// `title: groupTitle` for every variant's inventory_item, bundle included.
const createGroupStart = worker.indexOf('async function createAndPublishEbayVariationListing');
const createGroupEnd = worker.indexOf('async function withdrawEbayOfferGroup', createGroupStart);
const createGroupBody = worker.slice(createGroupStart, createGroupEnd);
assert.match(createGroupBody, /title: groupTitle,/, 'every variant\'s inventory_item -- bundle included -- must share the one group title; only its Cover-aspect label differs');

// createAndPublishEbayVariationListing must actually forward a per-variant
// image gallery (imageUrls) into the inventory_item body, not just the
// single primary imageUrl -- otherwise the bundle's gallery built above
// would never reach eBay.
assert.match(createGroupBody, /imageUrl: v\.imageUrl \|\| b\.imageUrl,\s*\n\s*imageUrls: v\.imageUrls \|\| \[\],/,
  'must pass each variant\'s own imageUrls array through to buildEbayInventoryItemBody, or a multi-photo gallery (the bundle\'s) never actually reaches eBay');

// Frontend: the review modal must show each cover's own thumbnail (or a
// clear flag when one is missing/being borrowed) so the store sees this
// before publishing, not just discovers it after an eBay error -- and must
// explain the bundle's image/title behavior inline.
assert.match(focDash, /var anyCoverImg=\(preview\.covers\|\|\[\]\)\.find\(function\(c\)\{return c\.imageUrl;\}\);/, 'the review modal must resolve a fallback thumbnail the same way the server does');
assert.match(focDash, /NO COVER ART/, 'a cover with truly no image anywhere must show a clear flag, not a silently blank thumbnail');
assert.match(focDash, /borrowing another cover\\'s photo -- add its own cover art later/, 'a cover borrowing a sibling\'s photo must say so explicitly, not look identical to one with its own real art');
assert.match(focDash, /Its photo gallery is every checked cover\\'s own cover image, so buyers see all of them\./, 'the bundle section must explain its image behavior inline, not leave the store guessing');

console.log('FOC eBay variation listing image-fallback + bundle gallery contract checks passed');
