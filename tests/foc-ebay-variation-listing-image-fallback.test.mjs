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

// The bundle variant's image, absent a store-uploaded main photo, must be a
// gallery of every real cover's own photo, not just one at random -- "what
// is it doing for an image for the bundle" answered: all of them.
assert.match(routeBody, /const allCoverImages = \[\.\.\.new Set\(built\.map\(v => v\.imageUrl\)\.filter\(Boolean\)\)\];/,
  'must collect every distinct real cover image actually available');
// Store report (live listing screenshot): selecting "All Covers Bundle"
// showed a pile of every cover's photo instead of the store's own uploaded
// "pick your cover" graphic -- the one thing that actually represents a
// bundle as ONE image. When mainImageUrl is provided it takes over as the
// bundle's ONLY photo; the "every cover" gallery is only the fallback for
// when no such image was uploaded.
assert.match(routeBody, /const bundleMainImage = \(typeof body\.mainImageUrl === 'string' && body\.mainImageUrl\.trim\(\)\) \? body\.mainImageUrl\.trim\(\)\.substring\(0, 1000\) : '';/,
  'must check for a store-uploaded main/bundle image before falling back to the every-cover gallery');
assert.match(routeBody, /imageUrl: bundleMainImage \|\| allCoverImages\[0\] \|\| anyCoverImage,\s*\n\s*imageUrls: bundleMainImage \? \[bundleMainImage\] : allCoverImages,/,
  'the bundle variant must use the store\'s uploaded main image alone when provided, falling back to the full gallery of every selected cover\'s image only when it is not');

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
assert.match(createGroupBody, /imageUrl: v\.imageUrl \|\| b\.imageUrl,\s*\n\s*imageUrls: \[\.\.\.\(v\.imageUrls \|\| \[\]\), b\.mainImageUrl\]\.filter\(Boolean\),/,
  'must pass each variant\'s own imageUrls array (plus the optional main photo) through to buildEbayInventoryItemBody, or a multi-photo gallery (the bundle\'s) never actually reaches eBay');

// Frontend: the review modal must show each cover's own thumbnail (or a
// clear flag when one is missing/being borrowed) so the store sees this
// before publishing, not just discovers it after an eBay error -- and must
// explain the bundle's image/title behavior inline.
assert.match(focDash, /var anyCoverImg=\(preview\.covers\|\|\[\]\)\.find\(function\(c\)\{return c\.imageUrl;\}\);/, 'the review modal must resolve a fallback thumbnail the same way the server does');
assert.match(focDash, /NO COVER ART/, 'a cover with truly no image anywhere must show a clear flag, not a silently blank thumbnail');
assert.match(focDash, /borrowing another cover\\'s photo -- add its own cover art later/, 'a cover borrowing a sibling\'s photo must say so explicitly, not look identical to one with its own real art');
assert.match(focDash, /Its photo gallery is every checked cover\\'s own cover image, so buyers see all of them\./, 'the bundle section must explain its image behavior inline, not leave the store guessing');

console.log('FOC eBay variation listing image-fallback + bundle gallery contract checks passed');
