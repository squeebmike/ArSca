import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store gap found while adding Sports/Pokemon TCG eBay description templates
// (see the new "Sports"/"Pokemon TCG" entries this same change adds to the
// store's saved ebayDescriptionTemplates): computeEbayListingFields' own
// {shippingLine} token was hardcoded to always say "comics" -- "In-stock
// comics ship within 1 business day with tracking." would have shown up
// verbatim on a Sports card or Pokemon TCG listing using the new templates,
// wrong category and confusing to a buyer. It also meant every category's
// listing got that same wrong sentence duplicated: once via the token
// inside the styled template, once again via the separately-computed,
// always-appended resolveEbayShippingLine() trailing paragraph -- and for a
// presale item, the trailing paragraph's "ships within 1 business day"
// directly contradicted the presale disclosure the template had just shown.

const fnStart = dashboard.indexOf('function computeEbayListingFields(item){');
const fnEnd = dashboard.indexOf('\n\nasync function generateAiEbayDescription', fnStart);
assert.ok(fnStart !== -1 && fnEnd > fnStart, 'computeEbayListingFields must exist');
const fnBody = dashboard.slice(fnStart, fnEnd);

assert.match(fnBody, /const shippingLine = isPresaleItem\s*\n\s*\? \[[\s\S]*?\.join\('\\n\\n'\)\s*\n\s*: resolveEbayShippingLine\(cat, isComic, isSealed, isGraded, catId\);/,
  'the non-presale {shippingLine} token must use the real, category-aware resolveEbayShippingLine(), not a hardcoded comics-only sentence');
assert.doesNotMatch(fnBody, /'In-stock comics ship within 1 business day with tracking\.'/,
  'the old hardcoded comics-only fallback string must be gone -- every category now goes through resolveEbayShippingLine()');

assert.match(fnBody, /const bodyAlreadyMentionsShipping = \/ship\/i\.test\(bodyText\);/,
  'must check whether the rendered template body already discusses shipping before appending a second, possibly-contradictory shipping paragraph');
assert.match(fnBody, /const desc = \[bodyText, bodyAlreadyMentionsShipping \? '' : resolveEbayShippingLine\(cat, isComic, isSealed, isGraded, catId\)\]\.filter\(Boolean\)\.join\('\\n\\n'\);/,
  'the trailing shipping paragraph must only be appended when the template body did not already cover it');

console.log('eBay category-aware {shippingLine} token contract checks passed');

// ── Functional: the dedup guard itself, independent of the DOM/template engine ──
function finalDescription(bodyText, resolvedShippingLine) {
  const bodyAlreadyMentionsShipping = /ship/i.test(bodyText);
  return [bodyText, bodyAlreadyMentionsShipping ? '' : resolvedShippingLine].filter(Boolean).join('\n\n');
}

{
  // A template that renders {shippingLine} itself (every built-in category
  // template does now) must not get a second copy appended.
  const bodyWithShipping = 'Card details...\nFAST, SECURE SHIPPING\nCards ship in a penny sleeve and toploader inside a bubble mailer to prevent bending. Ships within 1 business day with tracking.';
  const result = finalDescription(bodyWithShipping, 'Cards ship in a penny sleeve and toploader inside a bubble mailer to prevent bending. Ships within 1 business day with tracking.');
  assert.equal((result.match(/Ships within 1 business day/g) || []).length, 1, 'shipping info must appear exactly once, not duplicated');
}

{
  // A presale disclosure ("ships once released") must not get the generic
  // "ships within 1 business day" trailing line stacked under it --
  // directly contradictory ("not in stock yet" vs "ships tomorrow").
  const presaleBody = 'PRESALE -- This comic has not been released yet and is not currently in stock.\n\nExpected on-sale/ship date: December 5, 2026. Your order ships promptly once we receive stock from the distributor.';
  const result = finalDescription(presaleBody, 'In-stock comics ship within 1 business day with tracking.');
  assert.doesNotMatch(result, /ship within 1 business day/i, 'a presale disclosure must never be followed by a contradictory in-stock shipping claim');
}

{
  // A template/body with no shipping mention at all (e.g. a minimal custom
  // template, or the bundle lot-listing text) must still get real shipping
  // info somewhere -- this is additive, not a way to silently drop it.
  const bundleBody = 'This lot includes 3 items:\n• Card A\n• Card B\n• Card C';
  const shipping = 'Cards ship in a penny sleeve and toploader inside a bubble mailer to prevent bending. Ships within 1 business day with tracking.';
  const result = finalDescription(bundleBody, shipping);
  assert.match(result, /Ships within 1 business day/, 'a body with no shipping mention must still get the fallback line appended');
}

console.log('eBay shipping-line dedup functional checks passed');

// ── The new category templates themselves exist and are field-appropriate ──
// (Content lives in Supabase, not this repo -- verified live via direct
// query when the templates were written. This just documents which tokens
// each category's template is expected to use, so a future edit to the
// tokens object in computeEbayListingFields doesn't silently orphan one.)
for (const token of ['sport','player','team','cardNumber','variant','rookie','autograph','signedBy','serialNumber','grade','gradingCompany']) {
  assert.match(fnBody, new RegExp(token + ':'), `Sports template relies on the {${token}} token -- must still be produced by computeEbayListingFields`);
}
for (const token of ['set','cardNumber','rarity','finish','language','grade','gradingCompany']) {
  assert.match(fnBody, new RegExp(token + ':'), `Pokemon TCG template relies on the {${token}} token -- must still be produced by computeEbayListingFields`);
}

console.log('Sports/Pokemon TCG template token-availability checks passed');
