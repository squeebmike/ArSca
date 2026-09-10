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
// bundle as ONE image. Store request: "i need a main image and a bundle
// image able to upload here" -- a DEDICATED bundle-only image, distinct
// from the general main listing photo, takes priority when uploaded; the
// general main image (usually a "pick your cover" composite anyway) is
// the next fallback; the full every-cover gallery is the last resort.
assert.match(routeBody, /const bundleOwnImage = \(typeof body\.bundle\.imageUrl === 'string' && body\.bundle\.imageUrl\.trim\(\)\) \? body\.bundle\.imageUrl\.trim\(\)\.substring\(0, 1000\) : '';/,
  'must check for a store-uploaded bundle-specific image first');
assert.match(routeBody, /const bundleMainImage = \(typeof body\.mainImageUrl === 'string' && body\.mainImageUrl\.trim\(\)\) \? body\.mainImageUrl\.trim\(\)\.substring\(0, 1000\) : '';/,
  'must fall back to the general main/bundle image before falling back to the every-cover gallery');
assert.match(routeBody, /const bundleImage = bundleOwnImage \|\| bundleMainImage;/,
  'the bundle-specific image must win over the general main image when both are provided');
assert.match(routeBody, /imageUrl: bundleImage \|\| allCoverImages\[0\] \|\| anyCoverImage,\s*\n\s*imageUrls: bundleImage \? \[bundleImage\] : allCoverImages,/,
  'the bundle variant must use the resolved single image alone when one exists, falling back to the full gallery of every selected cover\'s image only when neither upload was provided');

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
// Store request: "i need a main image and a bundle image able to upload
// here" -- the bundle now gets its own dedicated upload, so the inline
// copy explaining its image behavior changed to describe that instead of
// the old always-every-cover-photo default.
assert.match(focDash, /Upload a bundle image below for its own photo, or leave it blank to use every checked cover\\'s own cover image instead\./, 'the bundle section must explain its image behavior inline, not leave the store guessing');

// Store request: "i need a main image and a bundle image able to upload
// here" -- a distinct upload field for the bundle option's own photo,
// separate from MAIN LISTING PHOTO. Must have its own file input, preview,
// hidden URL field, and upload/clear handlers, all wired the same way the
// existing main-image upload already is.
assert.match(focDash, /id="foc-eb-grp-bundle-image-file"[^>]*onchange="handleFocGroupBundleImageFile\(this\.files\[0\]\)"/, 'the bundle image file input must exist and call its own upload handler');
assert.match(focDash, /id="foc-eb-grp-bundle-image-preview"/, 'the bundle image needs its own preview thumbnail element');
assert.match(focDash, /id="foc-eb-grp-bundle-image-url"/, 'the bundle image needs its own hidden URL field, distinct from foc-eb-grp-main-image-url');
assert.match(focDash, /onclick="clearFocGroupBundleImage\(\)"/, 'must be able to clear a bundle image independently of the main image');
assert.match(focDash, /function handleFocGroupBundleImageFile\(file\)\{handleFocGroupImageFile\(file,'foc-eb-grp-bundle-image','Bundle image'\);\}/,
  'the bundle image handler must reuse the same shared upload mechanics as the main image, targeting its own field prefix');
// Both the bundle fields (label/price/qty) and the new bundle image fields
// must show/hide together under the "INCLUDE ALL COVERS BUNDLE" checkbox --
// a store request added after the bundle-fields-only toggle already
// existed, so the checkbox's onchange must now target the shared wrapper,
// not just the original narrower fields div.
assert.match(focDash, /onchange="document\.getElementById\(\\'foc-eb-grp-bundle-fields-wrap\\'\)\.style\.display=this\.checked\?\\'block\\':\\'none\\'"/,
  'the bundle checkbox must toggle one shared wrapper containing both the bundle fields and the bundle image uploader');
// The uploaded bundle image URL must actually reach the submit payload as
// bundle.imageUrl, or the whole upload UI is decorative.
assert.match(focDash, /imageUrl:\(document\.getElementById\('foc-eb-grp-bundle-image-url'\)\?\.value\|\|''\)\.trim\(\)\|\|undefined,/,
  'the bundle payload must include the uploaded bundle-specific image URL');

// Store report: "if an item has too long a name it won't let me edit it"
// -- a CSS grid item's default min-width is auto (its own content's
// intrinsic width), not 0, so the 1.4fr label column in each cover row
// refused to shrink for a long cover name and pushed the PRICE/QTY inputs
// out past the modal's edge instead of wrapping. Both the grid track
// definitions and the label div itself must allow shrinking/wrapping.
assert.match(focDash, /grid-template-columns:auto auto minmax\(0,1\.4fr\) minmax\(0,1fr\) minmax\(0,1fr\);/,
  'each cover row\'s grid columns must use minmax(0, ...) so a long cover name can\'t force the PRICE/QTY inputs out of reach');
assert.match(focDash, /<div style="min-width:0;overflow-wrap:break-word"><div style="font-weight:700;color:var\(--text\)">'\+esc\(c\.variantLabel\)\+'<\/div>/,
  'the cover name label itself must be allowed to shrink and wrap a long name, not force the row wider than the modal');

// Store request: "add editable Character/Genre/Format fields" (following
// the "better ebay titles with seo" conversation) -- the group review
// modal must expose these same manual-entry optional fields the
// single-cover modal already has, plus the pre-existing Publisher/Writer/
// Artist/Series Title row, and actually collect all of it into the
// submitted customAspects.
assert.match(focDash, /\['Publisher','Writer','Artist','Series Title'\]\.map\(function\(k\)\{return '<label>'\+k\.toUpperCase\(\)\+'<input class="tsi" data-eb-grp-aspect="'\+esc\(k\)\+'" value="'\+esc\(asp\[k\]\|\|''\)\+'"><\/label>';\}\)/,
  'the group review modal must render editable Publisher/Writer/Artist/Series Title fields');
assert.match(focDash, /\[\['Character','character'\],\['Genre','genre'\],\['Format','format'\]\]\s*\n\s*\.map\(function\(x\)\{return '<label>'\+x\[0\]\.toUpperCase\(\)\+'<input class="tsi" data-eb-grp-extra="'\+esc\(x\[1\]\)\+'" data-eb-grp-extra-label="'\+esc\(x\[0\]\)\+'"><\/label>';\}\)/,
  'the group review modal must expose Character/Genre/Format as editable, blank-by-default fields -- no data source exists for these so they must never be pre-filled with a guess');
assert.match(focDash, /document\.querySelectorAll\('\[data-eb-grp-aspect\]'\)\.forEach\(function\(el\)\{customAspects\[el\.dataset\.ebGrpAspect\]=el\.value;\}\);/,
  'the Publisher/Writer/Artist/Series Title fields must actually reach customAspects');
assert.match(focDash, /document\.querySelectorAll\('\[data-eb-grp-extra\]'\)\.forEach\(function\(el\)\{if\(el\.value\)customAspects\[el\.dataset\.ebGrpExtraLabel\]=el\.value;\}\);/,
  'the Character/Genre/Format fields must actually reach customAspects -- a field a store filled in must not be silently dropped from the eBay listing');

console.log('FOC eBay variation listing image-fallback + bundle gallery contract checks passed');
