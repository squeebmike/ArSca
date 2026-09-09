import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const focPreorders = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');

// eBay flatly refuses to let the Trading API touch a listing the REST
// Inventory API created ("Inventory-based listing management is not
// currently supported by this tool" -- ErrorCode 21919474, confirmed
// against production), which is why setEbayVariationSpecificPhotos
// (see foc-ebay-group-listing-photo-repair.test.mjs) can never actually
// bind per-cover photos onto a listing createAndPublishEbayVariationListing
// built. This is the only way to get that binding at all: build the WHOLE
// multi-cover listing on the Trading API from the start. Only NEW listings
// go this way -- everything already live stays on the REST path.

// ── buildVariationPictureSetsXml ──────────────────────────────────────────
// Store report (live error trying this for real): "AddFixedPriceItem
// failed: Variation specific name "" used for pictures does not exist in
// variation specific set." VariationSpecificPictureSetType requires BOTH
// VariationSpecificName (which aspect, e.g. "Cover") and
// VariationSpecificValue (which value) -- omitting the name left eBay
// defaulting it to "", which it then rejects outright since "" isn't a
// declared aspect. This was a latent bug in the original Trading API
// integration too (setEbayVariationSpecificPhotos, see
// foc-ebay-group-listing-photo-repair.test.mjs), just never actually
// exercised because the "Inventory-based" wall blocked it from ever
// reaching eBay in the first place.
{
  const start = worker.indexOf('function buildVariationPictureSetsXml');
  assert.ok(start !== -1, 'buildVariationPictureSetsXml must exist');
  const end = worker.indexOf('async function createAndPublishEbayVariationListingTrading', start);
  const body = worker.slice(start, end);
  assert.match(body, /function buildVariationPictureSetsXml\(variantPhotos, variantAspectName\)/,
    'must accept the real variant aspect name as a parameter, not just the label/photo data');
  assert.match(body, /<VariationSpecificPictureSet><VariationSpecificName>\$\{xmlEscape\(variantAspectName\)\}<\/VariationSpecificName><VariationSpecificValue>\$\{xmlEscape\(v\.label\)\}<\/VariationSpecificValue>/,
    'each picture set must declare BOTH VariationSpecificName and VariationSpecificValue -- eBay rejects the whole AddFixedPriceItem call if the name is missing/empty, not just that one picture set');
}
console.log('buildVariationPictureSetsXml checks passed');

// ── createAndPublishEbayVariationListingTrading ───────────────────────────
{
  const start = worker.indexOf('async function createAndPublishEbayVariationListingTrading');
  assert.ok(start !== -1, 'createAndPublishEbayVariationListingTrading must exist');
  const end = worker.indexOf('async function ebayReviseVariationQuantityTrading', start);
  const body = worker.slice(start, end);

  assert.match(body, /await ebayTradingApiCall\(ebayToken, 'AddFixedPriceItem', itemXml\)/,
    'must publish via the Trading API\'s AddFixedPriceItem, not the REST inventory_item/offer/group flow');
  // Store report (live error, again, after the VariationSpecificName fix):
  // "Variation specific name "" used for pictures does not exist in
  // variation specific set" -- the name WAS being sent correctly; the real
  // bug was element order. eBay's Trading API VariationsType schema
  // requires a strict child sequence -- Variation*, Pictures,
  // VariationSpecificsSet, ModifyNameList -- and this had
  // VariationSpecificsSet FIRST, before any Variation. An out-of-sequence
  // element against a strict XSD doesn't necessarily throw a schema error;
  // eBay's binder can silently fail to register the misplaced
  // VariationSpecificsSet at all, leaving the "declared legal variation
  // specifics" empty by the time it validates Pictures against it.
  assert.match(body, /`<Variations>\$\{variationEntriesXml\}` \+\s*\n\s*\(pictureSetsXml \? `<Pictures>\$\{pictureSetsXml\}<\/Pictures>` : ''\) \+\s*\n\s*variationSpecificsSetXml \+/,
    'Variations children must appear in eBay\'s required order -- Variation entries, then Pictures, then VariationSpecificsSet -- not VariationSpecificsSet first');
  assert.match(body, /variationSpecificsSetXml = `<VariationSpecificsSet><NameValueList><Name>\$\{xmlEscape\(variantAspectName\)\}<\/Name>\$\{built\.map\(v => `<Value>\$\{xmlEscape\(v\.label\)\}<\/Value>`\)\.join\(''\)\}<\/NameValueList><\/VariationSpecificsSet>`;/,
    'VariationSpecificsSet must declare every cover\'s label as one of the varying aspect\'s legal values, or eBay rejects the per-variant entries below');
  assert.match(body, /<SKU>\$\{xmlEscape\(v\.sku\)\}<\/SKU><StartPrice currencyID="USD">\$\{xmlEscape\(Number\(v\.price\)\.toFixed\(2\)\)\}<\/StartPrice><Quantity>/,
    'each Variation entry must carry its own SKU, price, and quantity -- this is what makes per-cover price/qty independently manageable, same as the REST offer-per-SKU model');
  assert.match(body, /\(pictureSetsXml \? `<Pictures>\$\{pictureSetsXml\}<\/Pictures>` : ''\)/,
    'the per-cover photo binding (Pictures/VariationSpecificPictureSet) must be set INLINE at creation time -- this is the entire point of building on the Trading API instead of the REST one');
  assert.match(body, /buildVariationPictureSetsXml\(\s*\n\s*built\.map\(v => \(\{ label: v\.label, sku: v\.sku, imageUrls: \[v\.imageUrl, \.\.\.\(v\.imageUrls \|\| \[\]\)\]\.filter\(Boolean\) \}\)\),\s*\n\s*variantAspectName\s*\n\s*\);/,
    'must build the picture sets the same shape setEbayVariationSpecificPhotos uses AND actually pass the real variantAspectName through -- a listing never needs a follow-up repair call just to get its own creation-time photos bound');
  assert.match(body, /sellerProfilesXml =\s*\n\s*\(b\.fulfillmentPolicyId \? `<SellerShippingProfile><ShippingProfileID>\$\{xmlEscape\(b\.fulfillmentPolicyId\)\}<\/ShippingProfileID><\/SellerShippingProfile>` : ''\) \+/,
    'must reference the SAME already-resolved eBay Business Policy id (fulfillmentPolicyId) via SellerProfiles that the REST flow resolves -- Business Policy ids are shared across both eBay API systems, so no separate policy-resolution logic is needed');
  assert.match(body, /env\.EBAY_RETURN_POLICY_ID.*ReturnProfileID/, 'must reference the store\'s return policy via SellerProfiles');
  assert.match(body, /env\.EBAY_PAYMENT_POLICY_ID.*PaymentProfileID/, 'must reference the store\'s payment policy via SellerProfiles');
  assert.match(body, /<Description><!\[CDATA\[\$\{descriptionCdata\}\]\]><\/Description>/, 'the HTML description must ride in a CDATA section so it does not need per-character XML escaping');
  assert.match(body, /descriptionCdata = toEbayHtmlDescription\(b\.description \|\| groupTitle\)\.replace\(\/\]\]>\/g, '\]\]\]\]><!\[CDATA\[>'\)/,
    'a literal "]]>" inside the description would otherwise prematurely close the CDATA section -- must be escaped');
  assert.match(body, /const listingId = \(result\.raw\.match\(\/<ItemID>\(\[\^<\]\+\)<\\\/ItemID>\/\) \|\| \[\]\)\[1\] \|\| '';/,
    'must actually parse the ItemID back out of eBay\'s response -- that ID is what every later revise/end call keys off');
  assert.match(body, /if \(!listingId\) \{ const e = new Error\('AddFixedPriceItem did not return an ItemID/,
    'a publish that reports success but returns no ItemID must be treated as an error, not silently returned as if it worked');
  assert.match(body, /return \{ listingId, inventoryItemGroupKey: listingId, warnings, variants:/,
    'inventoryItemGroupKey must equal the listingId itself -- a Trading API variation listing IS one ItemID for the whole group, unlike the REST flow\'s separate inventoryItemGroupKey; reusing the same field lets every existing sibling-detection/withdrawal helper keep working unchanged for both systems');
}
console.log('createAndPublishEbayVariationListingTrading checks passed');

// ── ebayReviseVariationQuantityTrading / endEbayListingTrading ───────────
{
  const start = worker.indexOf('async function ebayReviseVariationQuantityTrading');
  assert.ok(start !== -1, 'ebayReviseVariationQuantityTrading must exist');
  const end = worker.indexOf('async function endEbayListingTrading', start);
  const body = worker.slice(start, end);
  assert.match(body, /async function ebayReviseVariationQuantityTrading\(ebayToken, listingId, sku, newQuantity\)/,
    'must be keyed by ItemID + SKU, not an offerId -- the Trading API has no separate "offer" resource');
  assert.match(body, /<Item><ItemID>\$\{xmlEscape\(listingId\)\}<\/ItemID><Variations><Variation><SKU>\$\{xmlEscape\(sku\)\}<\/SKU><Quantity>/,
    'must revise exactly ONE variation\'s quantity by SKU -- touching only that cover, same "reduce availability without affecting the rest of the listing" contract ebayReviseOfferQuantity has on the REST side');
  assert.match(body, /await ebayTradingApiCall\(ebayToken, 'ReviseFixedPriceItem', body\)/, 'must use ReviseFixedPriceItem, the Trading API\'s revise call');
}
{
  const start = worker.indexOf('async function endEbayListingTrading');
  assert.ok(start !== -1, 'endEbayListingTrading must exist');
  const end = worker.indexOf('// Repairs group-listing photo-to-cover binding', start);
  const body = worker.slice(start, end);
  assert.match(body, /<ItemID>\$\{xmlEscape\(listingId\)\}<\/ItemID><EndingReason>NotAvailable<\/EndingReason>/,
    'must end the whole ItemID at once -- a Trading API variation listing is one item for every cover, same semantics as withdrawEbayOfferGroup on the REST side');
  assert.match(body, /await ebayTradingApiCall\(ebayToken, 'EndFixedPriceItem', body\)/, 'must use EndFixedPriceItem, the Trading API\'s listing-end call');
}
console.log('ebayReviseVariationQuantityTrading / endEbayListingTrading checks passed');

// ── Route wiring: every NEW group listing goes through the Trading path,
// and gets flagged so later revise/end calls route correctly ────────────
{
  const routeStart = worker.indexOf("if (url.pathname === '/foc/ebay/presale-group-preview' || url.pathname === '/foc/ebay/create-presale-group')");
  assert.ok(routeStart !== -1, 'the group-create route must exist');
  const routeEnd = worker.indexOf("if (url.pathname === '/foc/ebay/repair-group-listing-photos')", routeStart);
  const routeBody = worker.slice(routeStart, routeEnd);

  assert.match(routeBody, /listingResult = await createAndPublishEbayVariationListingTrading\(/,
    'the create-presale-group route must publish via the NEW Trading-API-native function, not the old REST one -- otherwise every new listing keeps hitting the same photo-binding wall this whole rebuild exists to close');
  assert.doesNotMatch(routeBody, /listingResult = await createAndPublishEbayVariationListing\(\{/,
    'must NOT still be calling the old REST creation function (a bare createAndPublishEbayVariationListing( call, not the Trading-suffixed one) for new listings');
  assert.match(routeBody, /ebayApiSystem: 'trading',/,
    'every inventory_items row created by this route must be flagged ebayApiSystem:\'trading\' so later revise/end calls (see withdrawFocPresaleRow) route to the Trading-API-native functions instead of the offerId-keyed REST ones');
}
console.log('Group-create route Trading-API wiring checks passed');

// ── Repair route: a Trading-API-built group has no REST group resource to
// GET/PUT at all -- must skip that entirely, not 404 against it ─────────
{
  const start = worker.indexOf('async function repairEbayTradingGroupListingPhotos');
  assert.ok(start !== -1, 'repairEbayTradingGroupListingPhotos must exist');
  const end = worker.indexOf('async function repairEbayGroupListingImages', start);
  const body = worker.slice(start, end);
  assert.doesNotMatch(body, /inventory_item_group/, 'must never call the REST inventory_item_group resource -- it does not exist for a Trading-API-built listing');
  assert.match(body, /await setEbayVariationSpecificPhotos\(ebayToken, listingId, variantPhotos\)/,
    'must still re-apply the per-cover photo binding from this app\'s own current per-row data (e.g. after a cover\'s art changes later), even with no REST gallery step to repair');

  const dispatchStart = worker.indexOf('async function repairEbayGroupListingImages');
  const dispatchEnd = worker.indexOf('const getRes = await fetch', dispatchStart);
  const dispatchBody = worker.slice(dispatchStart, dispatchEnd);
  assert.match(dispatchBody, /groupRows\.every\(r => r\.data\?\.ebayApiSystem === 'trading'\)/,
    'must detect an all-Trading-API group and route to the Trading-only repair path instead of falling through to the REST GET, which would 404 for a listing that was never a REST inventory_item_group to begin with');
}
console.log('Trading-API-aware repair route checks passed');

// ── withdrawFocPresaleRow: the critical "keep old listings untouched"
// regression test -- a row with no ebayApiSystem flag (every listing
// already live before this change) must keep using the exact same
// offerId-keyed REST functions it always has; only a NEW row explicitly
// flagged ebayApiSystem:'trading' may route to the Trading-API functions.
{
  const start = focPreorders.indexOf('async function withdrawFocPresaleRow');
  assert.ok(start !== -1, 'withdrawFocPresaleRow must exist');
  const end = focPreorders.indexOf('async function adminEndFocEbayListings', start);
  const body = focPreorders.slice(start, end);

  assert.match(body, /if\(row\.data\.ebayApiSystem==='trading'\)\{/,
    'must branch on the row\'s own ebayApiSystem flag -- an existing/live REST-created row (no flag at all) must never be routed to the Trading-API functions');
  assert.match(body, /await deps\.ebayReviseVariationQuantityTrading\(ebayToken,row\.data\.ebayListingId,row\.data\.ebaySku,0\);/,
    'a Trading-API row with a still-live sibling must zero its OWN quantity via the ItemID+SKU-keyed Trading function');
  assert.match(body, /else await deps\.endEbayListingTrading\(ebayToken,groupKey\);/,
    'a Trading-API row that is the last live cover in its group must end the whole ItemID via the Trading-API end function');
  // The original REST-path lines must survive completely unchanged below
  // the new branch, for every row that isn't flagged.
  assert.match(body, /if\(siblingStillLive\)await deps\.ebayReviseOfferQuantity\(env,ebayToken,row\.data\.ebayOfferId,0\);\s*\n\s*else await deps\.withdrawEbayOfferGroup\(env,ebayToken,groupKey\);/,
    'a row with no ebayApiSystem flag (every listing already live before this change) must still fall through to the exact same offerId-keyed REST functions it always has -- this is the "existing listings stay untouched" guarantee');
}
console.log('withdrawFocPresaleRow Trading-API branch + REST-path regression checks passed');

// ── PRH-submit quantity sync + receive-shipment short-ship sync must also
// recognize a Trading-API row (they filter on ebayOfferId being present,
// which a Trading row never has) ─────────────────────────────────────────
{
  assert.match(focPreorders, /d\.source==='foc_presale'&&d\.focCycleId===cycleId&&\(d\.ebayOfferId\|\|\(d\.ebayApiSystem==='trading'&&d\.ebayListingId&&d\.ebaySku\)\);/,
    'the PRH-submit quantity-sync candidate filter must also match Trading-API rows (keyed by ebayListingId+ebaySku), or their listings silently never get their quantity synced to the locked order total');
  assert.match(focPreorders, /if\(d\.ebayApiSystem==='trading'\)await deps\.ebayReviseVariationQuantityTrading\(ebayToken,d\.ebayListingId,d\.ebaySku,newAvailable\);/,
    'must actually call the Trading-API quantity-revise function for a flagged row during the PRH quantity-sync sweep');
  assert.match(focPreorders, /if\(row\.status==='presale'&&\(d\.ebayOfferId\|\|\(d\.ebayApiSystem==='trading'&&d\.ebayListingId&&d\.ebaySku\)\)&&remainingQty>0\)livePresaleRowBySkuId\.set\(d\.focSkuId,row\);/,
    'the receive-shipment reconciliation must also recognize a live Trading-API listing, or a short-ship against it silently fails to pull the listing\'s quantity down');
  assert.match(focPreorders, /if\(pd\.ebayApiSystem==='trading'\)await deps\.ebayReviseVariationQuantityTrading\(ebayToken,pd\.ebayListingId,pd\.ebaySku,receivedQty\);/,
    'a short-shipped Trading-API listing must have its quantity reduced via the Trading-API function');
}
console.log('PRH quantity-sync + receive-shipment Trading-API recognition checks passed');

// ── Deps wiring: both new Trading-API functions must actually be injected
// into the FOC module, or every branch above throws "not a function" ────
assert.match(worker, /ebayReviseVariationQuantityTrading, endEbayListingTrading,\s*\n\s*\}\);/,
  'both Trading-API-native functions must be passed into handleFocRequest\'s deps');
console.log('Deps wiring checks passed');
