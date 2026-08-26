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
assert.match(worker, /fulfillmentPolicyId,\s*\n\s*storeCategoryNames,\s*\n\s*\}, ebayToken, env, storeId\);/, 'the computed fulfillmentPolicyId must be passed into the listing payload');
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

// "Sport: Trading Cards" was showing up as an item specific on comic
// listings -- buildEbayAspects unconditionally defaulted Sport for every
// category, sports/TCG cards and comics alike. It must not default Sport
// for eBay's Comics category (259104), and it must still default it for
// everything else (a sports/TCG card with no sport set) so this doesn't
// regress non-comic listings.
assert.match(worker, /if \(categoryId !== '259104'\) aspects\['Sport'\] = aspects\['Sport'\] \|\| \['Trading Cards'\]/,
  'must not default the Sport aspect on comic listings');

// "Condition: --" was showing blank on a comic listing even though
// conditionId was correctly set to New (1000) -- some categories expect
// Condition as an item-specific aspect too, not just the formal
// conditionId field.
assert.match(worker, /CONDITION_ASPECT_LABEL = \{ '1000': 'New'/, 'must map conditionId to a human-readable Condition aspect');
assert.match(worker, /if \(!aspects\['Condition'\] && CONDITION_ASPECT_LABEL\[String\(conditionId\)\]\) aspects\['Condition'\] = \[CONDITION_ASPECT_LABEL\[String\(conditionId\)\]\]/,
  'must fill in the Condition aspect from conditionId so it is not left blank');

// Template reuse: the store already has a per-category description
// template settings UI (Settings -> Vendor Info -> EBAY LISTING SETTINGS)
// used by the regular "list on eBay" tool -- the FOC presale review modal
// must use the same {token} template system for Comic when one is
// configured, per store request for parity with that existing tool. The
// mandatory presale disclosure must always be prepended regardless, since
// a custom template that doesn't mention presale status must never
// silently drop eBay's required description-level disclosure.
assert.match(focDash, /var templates=vp\.ebayDescriptionTemplates\|\|\{\};/, 'must read the same per-category template settings the regular eBay listing tool uses');
assert.match(focDash, /var customTemplate=templates\.Comic\|\|templates\.default\|\|'';/, 'must prefer a Comic-specific template, falling back to the default template');
assert.match(focDash, /renderEbayDescriptionTemplate\(customTemplate,tokens\)/, 'must render the custom template through the shared {token} renderer');
assert.match(focDash, /description='PRESALE -- This comic has not been released yet and is not currently in stock/,
  'the mandatory presale disclosure must always be prepended, even when a custom template is used');
assert.match(focDash, /\+renderedBody;\s*\n\s*usedCustomTemplate=true;/, 'the rendered custom template body must be appended after the mandatory disclosure');
assert.match(focDash, /openSettingsSection\(\\'profile\\',\\'vendor-profile-panel\\'\)/, 'the modal must link to where the template is actually edited');

// Store owner asked: what happens to an eBay presale listing for a book we
// end up not ordering when the FOC deadline passes? Before this, nothing --
// adminPrhSubmission skipped any SKU with finalQty<=0 from the distributor
// order entirely, but never touched a live eBay listing for that same SKU,
// leaving it purchasable forever for stock that will never arrive. It must
// now withdraw any such listing (unsold: an already-sold one would have
// ebayPresold>0, which pulls finalQty above zero and into the order) at the
// exact moment the PRH order is locked -- that's the decisive
// "not ordering this" moment.
const prhSubmissionStart = preorders.indexOf('async function adminPrhSubmission');
const prhSubmissionEnd = preorders.indexOf('async function adminCycle', prhSubmissionStart);
const prhSubmissionBody = preorders.slice(prhSubmissionStart, prhSubmissionEnd);
assert.match(prhSubmissionBody, /if\(finalQty<=0\)continue;/, 'unordered SKUs must still be excluded from the distributor order itself');
assert.match(prhSubmissionBody, /const includedSkuIds=new Set\(lineItems\.map\(li=>li\.skuId\)\);/, 'must know which SKUs actually got ordered before deciding what to withdraw');
assert.match(prhSubmissionBody, /d\.source==='foc_presale'&&d\.focCycleId===cycleId&&d\.ebayOfferId&&!includedSkuIds\.has\(d\.focSkuId\)&&Number\(d\.qty\?\?d\.quantity\?\?0\)>0/,
  'must only withdraw presale listings for SKUs that did not make it into this cycle\'s PRH order');
assert.match(prhSubmissionBody, /await deps\.withdrawEbayOffer\(env,ebayToken,row\.data\.ebayOfferId\)/, 'must actually withdraw the eBay offer, not just flag it locally');
assert.match(prhSubmissionBody, /ebayWithdrawnReason:'not_included_in_prh_order'/, 'the withdrawn row must record why, for later auditing');
assert.match(prhSubmissionBody, /return deps\.json\(\{ok:true,submission:inserted,ebayWithdrawnCount:ebayWithdrawnSkuIds\.length\}\)/, 'the response must report how many listings were withdrawn');
assert.match(worker, /async function withdrawEbayOffer\(env, ebayToken, offerId\)/, 'must have a reusable withdraw helper, not just the /ebay/end route inline');
assert.match(worker, /getEbayUserAccessToken, withdrawEbayOffer,\s*\n\s*\}\);/, 'the withdraw helper and token getter must be injected into the FOC module\'s deps');
assert.match(focDash, /if\(d\.ebayWithdrawnCount>0\)toast_dash/, 'the dashboard must surface when a listing was auto-withdrawn, not just silently succeed');

// Store category: eBay's Seller Hub "Store category" (distinct from the
// eBay item category, which is already handled correctly) is now editable
// per listing and remembered across listings via localStorage, rather than
// hardcoded to any one store's category name.
assert.match(worker, /storeCategoryNames = \[\]/, 'buildEbayOfferBody must accept an optional store category override');
assert.match(worker, /storeCategoryNames: cleanStoreCategoryNames\.length \? cleanStoreCategoryNames : undefined/, 'must only send storeCategoryNames when one was actually provided');
assert.match(focDash, /localStorage\.getItem\('foc_ebay_last_store_category'\)/, 'must remember the last-typed store category across listings');
assert.match(focDash, /localStorage\.setItem\('foc_ebay_last_store_category',storeCategory\)/, 'must persist a newly-typed store category for next time');

// Store report: a real Comic description template full of optional prose
// tokens ("this {variant} {coverType} features {character} from
// {franchise}...") rendered with ugly gaps for any book missing those
// attributes -- dangling "Title #" (empty {issue} glued to a literal "#"),
// triple spaces, and " ," artifacts, because the old renderer only dropped
// a whole LINE when every token on it was empty; a line mixing populated
// and empty tokens (title/publisher were set) survived with raw gaps.
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const rendererStart = dashboard.indexOf('function renderEbayDescriptionTemplate');
const rendererEnd = dashboard.indexOf('function computeEbayListingFields', rendererStart);
const rendererBody = dashboard.slice(rendererStart, rendererEnd);
assert.match(rendererBody, /const val = tokens\[k\] \|\| '';\s*\n\s*return val \? \(connector \|\| ''\) \+ val : '';/,
  'a literal connector character (like "#" in "{title} #{issue}") glued to an empty token must be stripped along with it');
assert.match(rendererBody, /\.replace\(\/\[ \\t\]\{2,\}\/g, ' '\)/, 'must collapse doubled whitespace left by removed empty tokens');
assert.match(rendererBody, /\.replace\(\/ \+\(\[,\.;:\]\)\/g, '\$1'\)/, 'must fix space-before-punctuation artifacts');

// FOC presale token-building must pass the plain book title and variant
// label as SEPARATE tokens (not the already-combined "{title} {variant} -
// PRESALE" string as {title}), or any template using both would double up
// the variant text.
assert.match(worker, /baseTitle: sku\.title \|\| '', variantLabel: sku\.variant_label \|\| ''/, 'preview must expose the plain title and variant separately for template tokens');
assert.match(focDash, /title:preview\.baseTitle\|\|preview\.title\.replace\(\/ - PRESALE\$\/,''\),category:'Comic',price:preview\.price,upc:preview\.upc,\s*\n\s*variant:preview\.variantLabel\|\|''/,
  'the {title} token must use the plain base title, with variant passed separately, to avoid doubling the variant text');

console.log('FOC eBay presale review-step, template-field, eligible-filter, handling-time, aspects, template-reuse, unordered-withdrawal, store-category, and template-gap contract checks passed');
