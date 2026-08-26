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

// Store report: eBay's own listing edit page showed "Item condition" blank
// on a live Comics listing even though the inventory_item PUT returned no
// error/warning and the resolved condition id was not the fallback either
// -- an ok response is not proof eBay actually stored what was requested.
// Must read the item back after publish and compare, so a silent
// server-side drop of the condition is caught here instead of only being
// discoverable by a human clicking into the live listing afterward.
assert.match(createAndPublishBody, /const verifyRes = await fetch\(`https:\/\/api\.ebay\.com\/sell\/inventory\/v1\/inventory_item\/\$\{sku\}`, \{\s*\n\s*headers: \{ 'Authorization': 'Bearer ' \+ ebayToken \},\s*\n\s*\}\);/,
  'must read the inventory item back from eBay after publish to verify what was actually stored');
assert.match(createAndPublishBody, /verifiedConditionId = String\(verifyData\?\.conditionId \|\| ''\);/, 'must compare the real stored conditionId, not just assume the PUT worked');
assert.match(createAndPublishBody, /if \(requestedConditionId && verifiedConditionId !== requestedConditionId\) \{/, 'a mismatch between requested and stored condition must be surfaced');
assert.match(createAndPublishBody, /warnings\.push\(`eBay stored a different condition than requested/, 'the condition mismatch must become a visible warning, not a silent log line');

// Two live tests showed neither the fallback warning nor the mismatch
// warning above ever fire -- "no warning" was being read as "it worked",
// but a verify-fetch failure was silently swallowed too, which looks
// identical from outside. Both a verify failure and the raw requested/
// stored values must now be visible instead of only a binary match check.
assert.match(createAndPublishBody, /warnings\.push\(`Could not verify eBay actually stored the requested condition \(lookup failed, \$\{verifyRes\.status\}\)/,
  'a failed verify lookup (non-ok response) must be surfaced, not silently treated as a match');
assert.match(createAndPublishBody, /warnings\.push\('Could not verify eBay actually stored the requested condition \(' \+ e\.message \+ '\)/,
  'a thrown verify-fetch error must also be surfaced, not silently swallowed');
assert.match(worker, /return \{ listingId: pubData\.listingId, offerId, sku, warnings, requestedConditionId: String\(itemBody\.conditionId \|\| ''\), verifiedConditionId \};/,
  'createAndPublishEbayListing must return the actual requested/verified condition values, not just a pass/fail');
assert.match(worker, /conditionCheck: \{\s*\n\s*requestedId: listingResult\.requestedConditionId, requestedLabel: resolvedCondition\.label \|\| '',\s*\n\s*resolvedFrom: resolvedCondition\.source, verifiedStoredId: listingResult\.verifiedConditionId,\s*\n\s*\},/,
  'the create-presale response must include the raw condition values on every publish, not just when a problem is detected');
assert.match(focDash, /if\(result\.conditionCheck\)\{/, 'the dashboard must surface the condition check values so they are visible without Worker log access');

// Both callers of createAndPublishEbayListing must pass storeId through now
// that the function needs it to look up the address.
assert.match(worker, /const result = await createAndPublishEbayListing\(b, ebayToken, env, storeId\)/, '/ebay/list must pass storeId through');
assert.match(worker, /\}, ebayToken, env, storeId\);\s*\n\s*\} catch \(e\) \{\s*\n\s*console\.error\('FOC eBay presale listing error/, '/foc/ebay/create-presale must pass storeId through');

const preorders = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');
assert.match(preorders, /export async function shippingSettings\(db, env, storeId\)/, 'shippingSettings must be exported for reuse by the Worker');

// PRH's FOC import already captures the distributor's own solicitation copy
// (comic_skus.description) -- store request: expose it as a {synopsis}
// template token so custom Comic templates can surface genuine per-book
// keyword content, instead of only ever feeding it into the old plain-text
// default description. Truncated at a word boundary (never mid-word/PRH's
// field can run to 12000 chars) to leave room under eBay's 4000-char cap.
assert.match(worker, /function truncateAtWordBoundary\(text, maxLen\)/, 'must truncate the distributor synopsis at a word boundary, not a blind substring');
assert.match(worker, /const synopsis = truncateAtWordBoundary\(sku\.description \|\| '', 400\)/, 'the synopsis token must be sourced from the PRH-imported sku.description field');
assert.match(worker, /return \{ title, description, customAspects, onSaleLabel, synopsis, \.\.\.weight \};/, 'synopsis must be returned so the preview endpoint (and thus the review-modal token object) receives it');
assert.match(focDash, /synopsis:preview\.synopsis\|\|''/, 'the review-modal token object must feed {synopsis} from the preview response');

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
assert.match(focDash, /'<p>PRESALE -- This comic has not been released yet and is not currently in stock\.<\/p>/,
  'the mandatory presale disclosure must always be prepended, even when a custom template is used (HTML-template form)');
assert.match(focDash, /'PRESALE -- This comic has not been released yet and is not currently in stock\.\\n\\nExpected/,
  'the mandatory presale disclosure must always be prepended, even when a custom template is used (plain-text form)');
assert.match(focDash, /description=disclosure\+\(isHtmlTemplate\?'':'\\n\\n'\)\+renderedBody;\s*\n\s*usedCustomTemplate=true;/, 'the rendered custom template body must be appended after the mandatory disclosure');
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

// Optional-clause syntax: [[...]] lets a template author mark a whole
// phrase as droppable together, for prose too grammatically dependent on
// ALL its tokens to survive the per-token gap cleanup above (e.g. "features
// {character} from {franchise}" still reads as "features from" once both
// are individually blanked -- wrapping it in [[...]] drops the whole thing).
assert.match(rendererBody, /raw\.replace\(\/\\\[\\\[\(\[\\s\\S\]\*\?\)\\\]\\\]\/g, \(full, inner\) => \{/, 'must support [[...]] optional-clause syntax');
assert.match(rendererBody, /return \(innerKeys\.length && innerKeys\.some\(k => !tokens\[k\]\)\) \? '' : inner;/, 'a [[...]] clause must drop entirely if ANY token inside it is empty, not just the empty token itself');
assert.match(rendererBody, /\.replace\(\/\\n\{3,\}\/g, '\\n\\n'\)/, 'must collapse blank-line stacking left behind when a whole-line [[...]] clause drops');

// shippingLine must not be silently overwritten by the pre-existing manual
// "Release Date" extra field, which shares the same {releaseDate} token
// name and is usually blank -- the forEach that layers in extra fields
// must be non-destructive (computed value wins, extra field is a fallback).
assert.match(dashboard, /tokens\[f\.token\] = tokens\[f\.token\] \|\| item\[f\.key\] \|\| '';/, 'extra-field merge must not clobber an already-computed token like releaseDate');

// Store asked for real (manual-entry, never auto-guessed) Cover Type / Key
// Issue / First Appearance fields, since eBay/collectors take those claims
// seriously -- added as ordinary EBAY_TEMPLATE_EXTRA_FIELDS entries (no
// schema change needed, item.data is already free-form JSON) and exposed
// on the FOC presale review modal so they reach both the description
// template and eBay's item specifics for presale listings, not just the
// regular in-stock "More Listing Details" editor.
assert.match(dashboard, /key:'cover_type', token:'coverType'/, 'Cover Type must be a real template/aspect field');
assert.match(dashboard, /key:'key_issue', token:'keyIssue'/, 'Key Issue must be a real template/aspect field');
assert.match(dashboard, /key:'first_appearance', token:'firstAppearance'/, 'First Appearance must be a real template/aspect field');
assert.match(dashboard, /Only when verified for this specific book/, 'Key Issue / First Appearance must be documented as manual-only, never auto-detected');
assert.match(focDash, /data-foc-eb-extra="'\+esc\(x\[1\]\)\+'"/, 'the FOC review modal must render editable extra-field inputs');
assert.match(focDash, /\[\['Series','series'\],\['Character','character'\],\['Franchise','franchise'\],\['Edition','edition'\],\['Exclusive','exclusive'\],\['Cover Type','coverType'\]\]/,
  'the FOC review modal must expose Series/Character/Franchise/Edition/Exclusive/Cover Type as editable fields');
assert.match(focDash, /\[\['Key Issue','keyIssue'\],\['First Appearance','firstAppearance'\]\]/, 'the FOC review modal must expose Key Issue/First Appearance as editable fields');
assert.match(focDash, /document\.querySelectorAll\('\[data-foc-eb-extra\]'\)\.forEach\(function\(el\)\{if\(el\.value\)customAspects\[el\.dataset\.focEbExtraLabel\]=el\.value;\}\)/,
  'the extra fields must actually reach customAspects (eBay item specifics), not just sit unused in the modal');

// Store report: a carefully paragraph-broken description arrived on the
// live eBay listing as one unbroken wall of text, because eBay renders
// descriptions as HTML and plain "\n" line breaks collapse under normal
// HTML whitespace rules. toEbayHtmlDescription must convert paragraph/line
// breaks to real HTML and be used everywhere a description reaches eBay
// (both the inventory_item and offer bodies), not just one of the two.
assert.match(worker, /function toEbayHtmlDescription\(text\) \{/, 'must have a shared HTML-formatting helper for eBay descriptions');
assert.match(worker, /escaped\.split\(\/\\n\{2,\}\/\)\.map\(para => '<p>' \+ para\.replace\(\/\\n\/g, '<br>'\) \+ '<\/p>'\);/,
  'must convert blank-line-separated paragraphs to <p> and remaining single line breaks to <br>');
assert.match(worker, /replace\(\/&\/g, '&amp;'\)\.replace\(\/</, 'must HTML-escape the raw text first, since it is built from several free-text fields');
assert.match(worker, /description: toEbayHtmlDescription\(description \|\| title\),/, 'the inventory_item description must go through the HTML formatter');
assert.match(worker, /listingDescription: toEbayHtmlDescription\(description \|\| title\),/, 'the offer listingDescription must also go through the HTML formatter');

// eBay's Inventory API can return an ok response while silently dropping a
// field it didn't like (e.g. an invalid conditionId for the category) as a
// `warnings` array rather than an error -- previously discarded entirely,
// giving no way to notice a silently-rejected field. Must now be collected
// from both the inventory_item response and the publish response, and
// actually reach the FOC dashboard so staff can see it.
assert.match(worker, /if \(Array\.isArray\(itemData\?\.warnings\) && itemData\.warnings\.length\) warnings\.push/, 'must collect warnings from the inventory_item response');
assert.match(worker, /if \(Array\.isArray\(pubData\?\.warnings\) && pubData\.warnings\.length\) warnings\.push/, 'must collect warnings from the publish response');
assert.match(worker, /return \{ listingId: pubData\.listingId, offerId, sku, warnings, requestedConditionId: String\(itemBody\.conditionId \|\| ''\), verifiedConditionId \};/,
  'createAndPublishEbayListing must return the collected warnings');
assert.match(worker, /warnings: \[\.\.\.\(listingResult\.warnings \|\| \[\]\), \.\.\.conditionWarnings\]/, 'the FOC create-presale route must pass warnings through to the client');
assert.match(focDash, /if\(result\.warnings&&result\.warnings\.length\)toast_dash\('eBay warning: '\+result\.warnings\.join\(' · '\)\)/,
  'the dashboard must actually surface a returned warning, not just receive it silently');

// Store asked for a higher default presale quantity than one copy.
assert.match(focDash, /id="foc-eb-qty" class="tsi" type="number" min="1" max="200" value="10"/, 'default presale quantity must be 10, not 1');

// Store report: a presale item listed through the REGULAR "list on eBay"
// dashboard tool (not the FOC review screen) came back showing the store's
// normal fast-handling shipping policy, and "Brand New" not selected as
// the condition. Both defaults live in computeEbayListingFields /
// createAndPublishEbayListing, which had no idea an item was presale at
// all -- only the FOC-specific route ever computed the right condition/
// policy. Fixed at the shared source so it applies regardless of which UI
// button was used to list the item.
assert.match(dashboard, /const isPresaleItem = item\.status === 'presale' \|\| item\.source === 'foc_presale';\s*\n\s*const conditionId = isPresaleItem \? '1000' : isGraded \? '2750' : \(isEbayTradingCardCategory\(catId\) \? '4000' : '3000'\);/,
  'a presale item must default to New (1000) condition regardless of category, since it is always genuinely brand-new stock');
assert.match(dashboard, /isPresale:item\.status === 'presale' \|\| item\.source === 'foc_presale',\s*\n\s*onSaleDate:item\.onSaleDate \|\| '',/,
  'the regular eBay listing payload must tell the Worker whether this item is presale, since it has no other way to know');
assert.match(worker, /let fulfillmentPolicyId = b\.fulfillmentPolicyId \|\| '';\s*\n\s*if \(!fulfillmentPolicyId && b\.isPresale && b\.onSaleDate\) \{/,
  'createAndPublishEbayListing must compute the presale shipping policy itself when the caller flagged the item as presale but did not already supply one');
assert.match(worker, /const bWithPolicy = fulfillmentPolicyId \? \{ \.\.\.b, fulfillmentPolicyId \} : b;/, 'the computed policy must actually be applied to the listing, not just computed and discarded');
assert.match(worker, /const itemBody = buildEbayInventoryItemBody\(bWithPolicy\);/, 'the inventory item body must be built from the policy-enriched object');
assert.match(worker, /const offerBody = buildEbayOfferBody\(bWithPolicy, sku, locationKey, env\);\s*\n\s*\n\s*const offerRes = await fetch\('https:\/\/api\.ebay\.com\/sell\/inventory\/v1\/offer'/,
  'the offer body (which is what actually carries fulfillmentPolicyId to eBay) must be built from the policy-enriched object in createAndPublishEbayListing');

// Store report, confirmed via the review-modal screenshot (handling time,
// quantity, weight, template all correctly computed) that "Brand New"
// still wasn't selecting on the live listing -- eBay's condition id for
// New/Brand New is NOT the same numeric value across every category (1000
// is the general-purpose id, comics can define their own condition set
// entirely), so the hardcoded conditionId:'1000' assumption was simply
// wrong for this category. Must look up the category's real condition
// policy (the same endpoint the regular tool's own live dropdown already
// calls) and use whichever entry is actually labeled New.
assert.match(worker, /async function resolveEbayNewConditionId\(env, ebayToken, categoryId\)/, 'must resolve the real category-specific "New" condition id instead of assuming 1000');
assert.match(worker, /get_item_condition_policies\?filter=\$\{encodeURIComponent\('categoryIds:\{' \+ categoryId \+ '\}'\)\}/,
  'must call eBay\'s real condition-policy endpoint, the same one the regular listing tool\'s live dropdown uses');
assert.match(worker, /const newCond = conditions\.find\(c => \/\^brand new\$\/i\.test\(c\.label\)\) \|\| conditions\.find\(c => \/\^new\$\/i\.test\(c\.label\)\) \|\| conditions\.find\(c => \/\\bnew\\b\/i\.test\(c\.label\)\);/,
  'must match on the real condition label, preferring an exact "Brand New"/"New" match');
assert.match(worker, /const resolvedCondition = await resolveEbayNewConditionId\(env, ebayToken, '259104'\);\s*\n\s*const conditionId = resolvedCondition\.id;\s*\n\s*\n\s*let listingResult;/,
  'the FOC create route must use the resolved condition id, not a hardcoded 1000');
assert.match(worker, /quantity, categoryId: '259104', conditionId,/, 'the resolved conditionId must actually be passed into the listing payload');
assert.match(worker, /const conditionId = \(await resolveEbayNewConditionId\(env, ebayToken, '259104'\)\)\.id;\s*\n\s*\n\s*let converted = 0;/,
  'convert-to-instock must also use the resolved condition id, not a hardcoded 1000');

// A conditionId falling back to the generic 1000 guess (instead of a real
// category-specific match) is exactly the failure mode already seen live --
// eBay silently ignoring it and leaving "Item condition" blank on their own
// edit page. That must now surface as a warning to the dashboard, not just
// a Worker log, so it's visible the moment it happens again.
assert.match(worker, /const fallback = \{ id: '1000', source: 'fallback', label: '' \};/, 'resolveEbayNewConditionId must report when it had to fall back, not just what id it used');
assert.match(worker, /const conditionWarnings = resolvedCondition\.source === 'fallback'\s*\n\s*\? \['Could not confirm eBay\\'s exact Comics condition ID/,
  'the FOC create route must turn a fallback condition resolution into a visible warning');

// The regular (non-FOC) listing tool's own live condition dropdown has the
// same bug: it pre-selects by matching eBay's real condition ids against
// our 1000 guess, so if that guess isn't one of the category's real ids,
// nothing matches and the browser silently defaults to whichever option
// came first -- must fall back to whichever entry is actually labeled New.
assert.match(dashboard, /if\(!policy\.conditions\.some\(c => c\.id === keep\)\)\{/, 'must detect when the guessed default id is not one of the category\'s real condition ids');
assert.match(dashboard, /const newCond = policy\.conditions\.find\(c => \/\^brand new\$\/i\.test\(c\.label\)\) \|\| policy\.conditions\.find\(c => \/\^new\$\/i\.test\(c\.label\)\) \|\| policy\.conditions\.find\(c => \/\\bnew\\b\/i\.test\(c\.label\)\);\s*\n\s*if\(newCond\) sel\.value = newCond\.id;/,
  'must actually select the real New condition instead of leaving the fallback to the browser');

// Store report: publishing failed live with "Invalid value for
// description. The length should be between 1 and 4000 characters" on a
// description that was under 4000 raw characters -- toEbayHtmlDescription
// wraps paragraphs in <p>/<br>, and that tag overhead can push a
// description sitting right at the pre-formatting cap over eBay's real
// 4000-char limit, which applies to the FINAL html, not the raw text.
assert.match(worker, /const EBAY_DESCRIPTION_MAX = 4000;/, 'must know eBay\'s real description length cap');
assert.match(worker, /if \(\(out \+ para\)\.length > EBAY_DESCRIPTION_MAX\) break;/, 'must stop adding whole paragraphs before exceeding the cap, not truncate the joined HTML string mid-tag');
{
  const toEbayHtmlDescriptionSrc = worker.slice(worker.indexOf('function toEbayHtmlDescription'), worker.indexOf('function buildEbayInventoryItemBody'));
  const toEbayHtmlDescription = new Function(toEbayHtmlDescriptionSrc + '\nreturn toEbayHtmlDescription;')();
  const para = 'A'.repeat(180);
  const raw = Array(22).fill(para).join('\n\n').substring(0, 4000);
  const html = toEbayHtmlDescription(raw);
  assert(html.length <= 4000, `toEbayHtmlDescription must never exceed eBay's 4000-char cap even when the raw text is right at 4000 chars (got ${html.length})`);
}

// Store report: a hand-built rich-HTML Comic template (real <div>/<table>
// markup for a full branded listing design) went live with every tag
// showing as literal visible text instead of rendering -- the previous fix
// for the plain-text-collapsing-to-a-blob bug unconditionally escaped
// EVERY description, which broke a store that had already been relying on
// raw HTML working (as it did before that fix existed). Must detect
// already-HTML content and pass it through untouched instead.
assert.match(worker, /if \(\/<\\\/\?\[a-z\]\[\\s\\S\]\*>\/i\.test\(raw\)\) return raw\.length <= 4000 \? raw : truncateHtmlSafely\(raw, 4000\);/,
  'must detect existing HTML markup and pass it through untouched (safely bounded to the length cap) instead of escaping it');
{
  const toEbayHtmlDescriptionSrc = worker.slice(worker.indexOf('function toEbayHtmlDescription'), worker.indexOf('function buildEbayInventoryItemBody'));
  const toEbayHtmlDescription = new Function(toEbayHtmlDescriptionSrc + '\nreturn toEbayHtmlDescription;')();
  const html = '<div style="width:100%"><div style="background:#171717">THE MANA POCKET</div></div>';
  assert.equal(toEbayHtmlDescription(html), html, 'a description that already contains real HTML markup must be returned completely unmodified');
  const plain = 'PRESALE -- not released yet.\n\nExpected ship date: Sept 29.';
  const plainOut = toEbayHtmlDescription(plain);
  assert.match(plainOut, /<p>PRESALE -- not released yet\.<\/p><p>Expected ship date: Sept 29\.<\/p>/, 'genuine plain text must still be converted to real HTML paragraphs');
}

// FOC review-modal token building must match its own disclosure prefix's
// format to whichever kind of template it's about to sit next to (plain
// text vs. a store's rich-HTML template), or the combined string is a
// mismatched blob the server-side formatter can't get right for both halves.
assert.match(focDash, /var isHtmlTemplate=\/<\\\/\?\[a-z\]\[\\s\\S\]\*>\/i\.test\(customTemplate\);/, 'must detect whether the store\'s saved template is plain text or real HTML');
assert.match(focDash, /disclosure=isHtmlTemplate\s*\n\s*\? '<p>PRESALE/, 'the mandatory disclosure must be built as real HTML paragraphs when sitting next to an HTML template');
assert.match(focDash, /description=disclosure\+\(isHtmlTemplate\?'':'\\n\\n'\)\+renderedBody;/, 'the disclosure and template body must be joined without a stray plain-text separator when both are already HTML');

// Store built a real rich-HTML Comic template using [[...]] to wrap whole
// multi-line blocks (an entire optional <tr> row, a multi-line <div>
// around {notes}) -- the original [[...]] implementation only recognized
// a clause when its opening and closing brackets sat on the SAME line, so
// a [[ on one line paired with a ]] several lines later leaked the literal
// bracket characters straight into the live listing instead of being
// evaluated. Must now be resolved across the whole template before
// splitting into lines.
const rendererStart2 = dashboard.indexOf('function renderEbayDescriptionTemplate');
const rendererEnd2 = dashboard.indexOf('function computeEbayListingFields', rendererStart2);
const rendererBody2 = dashboard.slice(rendererStart2, rendererEnd2);
assert.match(rendererBody2, /const withClauses = raw\.replace\(\/\\\[\\\[\(\[\\s\\S\]\*\?\)\\\]\\\]\/g, \(full, inner\) => \{/,
  'the [[...]] scan must run across the whole template (multiline-capable), not per line, so a clause spanning multiple lines is recognized as one unit');
assert.match(rendererBody2, /const lines = withClauses\.split\('\\n'\);/, 'line-splitting must happen AFTER clause resolution, not before');
{
  const rendererSrc = dashboard.slice(rendererStart2, rendererEnd2);
  const renderEbayDescriptionTemplate = new Function(rendererSrc + '\nreturn renderEbayDescriptionTemplate;')();
  const multilineTemplate = '<table>\n[[\n<tr><td>{notes}</td></tr>\n]]\n</table>';
  const droppedOut = renderEbayDescriptionTemplate(multilineTemplate, {});
  assert(!droppedOut.includes('[['), 'a multi-line [[...]] clause with its token empty must not leak the literal "[[" into the output');
  assert(!droppedOut.includes(']]'), 'a multi-line [[...]] clause with its token empty must not leak the literal "]]" into the output');
  assert(!droppedOut.includes('<tr>'), 'a multi-line [[...]] clause with its token empty must actually drop its content, not just hide the brackets');
  const keptOut = renderEbayDescriptionTemplate(multilineTemplate, { notes: 'Ships fast' });
  assert(keptOut.includes('<tr><td>Ships fast</td></tr>'), 'a multi-line [[...]] clause with its token populated must keep its content intact');
}

// The doubled-punctuation cleanup meant for prose artifacts ("word ,  ."
// from a dropped clause) was also eating real CSS syntax in a rich-HTML
// template's inline style attributes, since ":" immediately followed by
// "." (e.g. "letter-spacing:.5px") matched the same "collapse adjacent
// punctuation" rule when it covered : and ; too (confirmed live: it became
// "letter-spacing.5px", silently breaking that CSS declaration).
assert.match(rendererBody2, /\.replace\(\/\(\[,\.\]\) \*\(\?=\[,\.\]\)\/g, ''\);/,
  'the doubled-punctuation collapse must only apply to , and . -- never : or ;, which are load-bearing in inline CSS');
assert.doesNotMatch(rendererBody2, /\.replace\(\/\(\[,\.;:\]\) \*\(\?=\[,\.;:\]\)\/g, ''\);/,
  'must not still be using the old character class that included : and ;');

// Store report: a rich-HTML template's "WHY THIS COMIC BELONGS..." section
// got cut to "Comic collecting" mid-sentence, with no closing punctuation
// or tags -- toEbayHtmlDescription's HTML-passthrough branch did a blind
// substring(0, 4000) on real HTML, which can land mid-tag or mid-word and
// leaves whatever was cut open (unclosed <p>/<div>). Must cut at the last
// complete closing tag before the limit and close out any still-open
// ancestor tags, instead of chopping the string wherever the character
// count happens to land.
assert.match(worker, /function truncateHtmlSafely\(html, maxLen\) \{/, 'must have a dedicated safe-HTML-truncation helper, not a blind substring');
assert.match(worker, /const cut = html\.lastIndexOf\('>', maxLen - 1\);/, 'must cut at the last complete closing tag before the limit, never mid-tag');
assert.match(worker, /for \(let i = stack\.length - 1; i >= 0; i--\) truncated \+= '<\/' \+ stack\[i\] \+ '>';/,
  'must close out any tags still open at the cut point so the truncated result is valid HTML');
assert.match(worker, /if \(\/<\\\/\?\[a-z\]\[\\s\\S\]\*>\/i\.test\(raw\)\) return raw\.length <= 4000 \? raw : truncateHtmlSafely\(raw, 4000\);/,
  'the HTML-passthrough branch must use the safe truncation helper, not substring');
{
  const truncSrc = worker.slice(worker.indexOf('function truncateHtmlSafely'), worker.indexOf('function toEbayHtmlDescription'));
  const truncateHtmlSafely = new Function(truncSrc + '\nreturn truncateHtmlSafely;')();
  const longHtml = '<div><p>' + 'A sentence that keeps going. '.repeat(200) + '</p><p>Trailing paragraph.</p></div>';
  const out = truncateHtmlSafely(longHtml, 200);
  assert(out.length <= 220, 'truncated output must stay close to the requested limit (a little over is fine, for closing tags)');
  assert(!/[a-zA-Z]$/.test(out.replace(/<[^>]*>$/, '').trimEnd()) || out.trimEnd().endsWith('.') || out.includes('</'),
    'truncated output must not end mid-word with no closing punctuation or tags');
  const openTags = (out.match(/<(?!\/)[a-z][^>]*(?<!\/)>/gi) || []).length;
  const closeTags = (out.match(/<\/[a-z][^>]*>/gi) || []).length;
  assert.equal(openTags, closeTags, 'every opened tag in the truncated output must have a matching close tag');
}

console.log('FOC eBay presale review-step, template-field, eligible-filter, handling-time, aspects, template-reuse, unordered-withdrawal, store-category, template-gap, optional-clause, extra-field, html-formatting, warnings, quantity-default, cross-entry-point presale, real-condition-id, description-length-cap, html-template-passthrough, multiline-clause, css-safety, and safe-html-truncation contract checks passed');
