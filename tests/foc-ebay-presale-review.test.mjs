import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const focDash = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');

// The FOC eBay presale flow used to publish straight to eBay off a single
// prompt() for quantity, with no chance to review or edit the title,
// description, weight, or best-offer setting before it went live (store
// report: a real listing published with no review step and a policy
// violation baked into the title). /foc/ebay/presale-preview computes the
// same defaults the create route used to publish directly, but returns them
// for editing instead of listing anything -- the client is expected to
// review/edit, then POST the edited fields to /foc/ebay/create-presale.
assert.match(worker, /url\.pathname === '\/foc\/ebay\/create-presale' \|\| url\.pathname === '\/foc\/ebay\/presale-preview'/,
  'the preview route must share the eligibility/price-checking route, not duplicate it');
assert.match(worker, /if \(isPreview\) \{\s*\n\s*return json\(\{/,
  'preview mode must return the computed fields as JSON instead of publishing');

const createBlockStart = worker.indexOf("url.pathname === '/foc/ebay/create-presale'");
const createBlockEnd = worker.indexOf("if (url.pathname === '/foc/ebay/convert-to-instock')", createBlockStart);
const createBlock = worker.slice(createBlockStart, createBlockEnd);

// Preview must not touch eBay or write any inventory_items row -- it's a
// pure read/compute step so opening the review modal can never have a side
// effect on its own.
const previewReturnIdx = createBlock.indexOf('if (isPreview)');
const beforePreview = createBlock.slice(0, previewReturnIdx);
assert.doesNotMatch(beforePreview, /createAndPublishEbayListing/, 'preview must return before ever calling createAndPublishEbayListing');
assert.doesNotMatch(beforePreview, /getEbayUserAccessToken/, 'preview must not need an eBay token -- nothing is published yet');

// The actual create call must prefer client-supplied review-screen fields
// over the server-built defaults, so edits made in the review modal are
// what actually gets listed.
assert.match(createBlock, /const title = \(typeof body\.title === 'string'.*\? body\.title\.trim\(\)\.substring\(0, 80\) : defaults\.title/,
  'client-edited title must win over the computed default');
assert.match(createBlock, /const description = \(typeof body\.description === 'string'.*\? body\.description\.trim\(\)\.substring\(0, 4000\) : defaults\.description/,
  'client-edited description must win over the computed default');
assert.match(createBlock, /const bestOfferEnabled = body\.bestOfferEnabled !== false/,
  'Best Offer must default to enabled per store request, but stay overridable from the review screen');
assert.match(createBlock, /const weightValue = Number\(body\.weightValue\) > 0 \? Number\(body\.weightValue\) : defaults\.weightValue/,
  'client-edited weight must win over the price-tier default');

// Eligibility (business-day window) and price must still come from the
// trusted comic_skus DB row regardless of what the client sends -- only the
// listing *content* fields became client-editable, not the gating checks.
assert.match(createBlock, /const eligibleDate = addBusinessDays\(onSaleDate, -safeBusinessDays\)/, 'eligibility must still be recomputed server-side from the DB row');
assert.match(createBlock, /const priceCents = Number\(sku\.customer_price_cents \|\| sku\.msrp_cents \|\| 0\)/, 'price must still come from the trusted DB row, never the client');

// buildFocPresaleDefaults must disclose "presale" in the title (eBay policy
// requires disclosure in both title and description) and dedupe a
// variant_label that already repeats the title verbatim.
assert.match(worker, /const PRESALE_TITLE_SUFFIX = ' - PRESALE'/, 'title must disclose presale per eBay policy');
assert.match(worker, /!baseTitle\.toLowerCase\(\)\.includes\(String\(sku\.variant_label\)\.toLowerCase\(\)\)/, 'must not append a variant label that already appears in the title');

// Package weight: no page-count/format field exists on comic_skus, so this
// buckets by cover price instead of a single flat guess that undercharges
// shipping on hardcovers/compendiums.
assert.match(worker, /priceCents >= 2000 \? \{ weightValue: 1\.5, weightUnit: 'POUND' \}/, 'expensive books (hardcover/compendium) must get a heavier default weight');
assert.match(worker, /priceCents >= 1000 \? \{ weightValue: 0\.625, weightUnit: 'POUND' \}/, 'mid-price books (trade) must get a mid-tier default weight');

// The eBay merchant location used to be hardcoded to a different business
// entirely ("Walk-Off Sports Cards" in Kingston, WA) -- every FOC presale
// and regular eBay listing was being published under someone else's store
// address. It must now come from the store's own already-collected
// ship-from address (the same one used for real Shippo labels) instead.
const createAndPublishStart = worker.indexOf('async function createAndPublishEbayListing');
const createAndPublishEnd = worker.indexOf("if (url.pathname === '/ebay/list')", createAndPublishStart);
const createAndPublishBody = worker.slice(createAndPublishStart, createAndPublishEnd);
assert.doesNotMatch(createAndPublishBody, /name: 'Walk-Off Sports Cards'/, 'must not publish listings under a different business\'s name');
assert.doesNotMatch(createAndPublishBody, /addressLine1: '26059 Miller Bay Rd NE'/, 'must not publish listings under a different business\'s address');
assert.match(createAndPublishBody, /addressLine1: shipFrom\.street1/, 'the eBay location address must come from this store\'s own configured shipFrom, not a literal');
assert.match(worker, /async function createAndPublishEbayListing\(b, ebayToken, env, storeId\)/, 'createAndPublishEbayListing must take a storeId to look up this store\'s own address');
assert.match(worker, /shippingSettings\(\(path, options\) => supabaseAdminFetch\(env, path, options\), env, storeId\)/,
  'must reuse the existing FOC "REAL SHIPPING SETUP" address instead of maintaining a second copy of it');
assert.match(worker, /Store address not set -- fill in the ship-from address under FOC/,
  'must fail loudly (not silently list under a wrong address) when no store address is configured yet');
assert.match(worker, /import \{ handleFocRequest, syncFocStripeEvent, shippingSettings \} from '\.\/scripts\/foc-preorders\.mjs'/,
  'shippingSettings must be imported from foc-preorders.mjs, not duplicated');

// Both callers of createAndPublishEbayListing must pass storeId through now
// that the function needs it to look up the address.
assert.match(worker, /const result = await createAndPublishEbayListing\(b, ebayToken, env, storeId\)/, '/ebay/list must pass storeId through');
assert.match(worker, /\}, ebayToken, env, storeId\);\s*\n\s*\} catch \(e\) \{\s*\n\s*console\.error\('FOC eBay presale listing error/, '/foc/ebay/create-presale must pass storeId through');

const preorders = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');
assert.match(preorders, /export async function shippingSettings\(db, env, storeId\)/, 'shippingSettings must be exported for reuse by the Worker');

// Dashboard-side: the old flow (prompt() for quantity, then publish
// immediately) must be gone -- createFocEbayPresale now opens a review modal
// that fetches the preview and only publishes once the user confirms.
assert.doesNotMatch(focDash, /var qty=parseInt\(prompt\('How many copies to list on eBay as a presale\?'/,
  'the old immediate-publish prompt() flow must be removed');
assert.match(focDash, /window\.createFocEbayPresale=openEbayPresaleReview/, 'the eBay-section button must open the review modal, not publish immediately');
assert.match(focDash, /api\('\/foc\/ebay\/presale-preview',\{method:'POST'/, 'opening the review modal must fetch the preview, not publish');
assert.match(focDash, /async function submitEbayPresaleReview\(skuId\)/, 'the review modal must have its own explicit publish step');
assert.match(focDash, /api\('\/foc\/ebay\/create-presale',\{method:'POST',headers:\{'Content-Type':'application\/json'\},body:JSON\.stringify\(payload\)\}\)/,
  'confirming the review must send the edited fields, not just skuId/quantity');

// Eligible-and-not-yet-listed filter: state.ebay drives visibleFamilies(),
// and there's a dropdown wired to it in the toolbar.
assert.match(focDash, /state=\{loaded:false,cycles:\[\],cycle:null,families:\[\],query:'',publisher:'all',flag:'all',ebay:'all'/, 'state must track the eBay-status filter');
assert.match(focDash, /var ebay=state\.ebay==='all'\|\|f\.variants\.some\(function\(v\)\{return v\.ebayPresaleStatus===state\.ebay;\}\)/,
  'visibleFamilies must filter by ebayPresaleStatus');
assert.match(focDash, /return pub&&flagged&&ebay&&\(!q\|\|hay\.indexOf\(q\)>-1\)/, 'the eBay filter must actually be applied alongside the existing filters');
assert.match(focDash, /onchange="filterFocEbay\(this\.value\)"><option value="all">All eBay statuses<\/option><option value="ELIGIBLE_NOW">Eligible, not listed/,
  'toolbar must expose an "eligible, not listed" option using the catalog\'s own ebayPresaleStatus values');
assert.match(focDash, /window\.filterFocEbay=function\(v\)\{state\.ebay=v;renderFamilies\(\);\}/, 'the filter dropdown must be wired up');

// Handling time: eBay computes the buyer's delivery estimate as handling
// time + carrier transit from the PURCHASE date, so a presale listed under
// the store's normal fast-handling policy promises delivery before the
// book is even released (confirmed live: a Sept 23 release showed an
// Aug 29-Sep 3 delivery estimate). A dedicated, cloned fulfillment policy
// with a handling time long enough to cover the wait must be used instead
// of the shared one -- never mutated in place, since that would also
// change handling time on every other live listing referencing it.
assert.match(worker, /function businessDaysBetween\(from, to\)/, 'must be able to compute business days from now to the on-sale date');
assert.match(worker, /async function getFocPresaleFulfillmentPolicyId\(env, ebayToken, handlingDaysNeeded\)/, 'must provision a presale-specific fulfillment policy');
assert.match(worker, /const bucket = Math\.min\(40, Math\.max\(5, Math\.ceil\(Math\.max\(1, handlingDaysNeeded\) \/ 5\) \* 5\)\)/, 'handling time must be capped at eBay\'s 40-business-day presale limit');
assert.doesNotMatch(worker, /fetch\(`https:\/\/api\.ebay\.com\/sell\/account\/v1\/fulfillment_policy\/\$\{encodeURIComponent\(fallback\)\}`, \{[\s\S]{0,200}method: 'PUT'/,
  'must never PUT/update the shared base fulfillment policy in place -- that would change handling time on every other live listing using it too');
assert.match(worker, /const handlingBusinessDays = businessDaysBetween\(new Date\(\), onSaleDate\) \+ 2/, 'handling time must be computed from the SKU\'s real on-sale date, not a fixed guess');
assert.match(worker, /const fulfillmentPolicyId = await getFocPresaleFulfillmentPolicyId\(env, ebayToken, handlingBusinessDays\)/, 'the create route must actually use the provisioned handling-time policy');
assert.match(worker, /fulfillmentPolicyId,\s*\n\s*\}, ebayToken, env, storeId\);/, 'the computed fulfillmentPolicyId must be passed into the listing payload');
assert.match(focDash, /eBay handling time on this listing:/, 'the review modal must show the handling time so the store can verify the ship date is accurate before publishing');

// The dynamic handling-time policies must clone shipping-service setup
// (carrier, calculated-vs-flat cost, etc.) from a store-created presale-
// named policy (e.g. "PreSale Paid Shipping") when one exists, rather than
// always cloning the store's general default policy -- a presale-specific
// policy is more likely to already have the right shipping cost/service
// configuration for presale orders.
assert.match(worker, /async function resolveFocPresaleBasePolicyId\(env, ebayToken\)/, 'must resolve which policy to clone shipping setup from');
assert.match(worker, /find\(p => \/presale\/i\.test\(p\.name \|\| ''\)\)/, 'must prefer a store-created policy named for presale use');
assert.match(worker, /const baseId = \(await resolveFocPresaleBasePolicyId\(env, ebayToken\)\) \|\| fallback/, 'the per-book handling-time clone must use the resolved presale base policy');

console.log('FOC eBay presale review-step, template-field, eligible-filter, and handling-time contract checks passed');
