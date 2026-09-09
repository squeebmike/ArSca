import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const focDash = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');

// Store report (live listing screenshot): a published group listing's
// title read "Cyberpunk 2077: Jayk's Case #1 (CVR A) (Nicola Izzo) -
// PRESALE" no matter which cover the buyer picked in the dropdown --
// wrong, since a variation listing has ONE shared title across every
// variant. Root cause: the representative SKU's own `title` field is
// never cover-agnostic for PRH imports (titleWithoutVariant in
// foc-preorders.mjs strips "CVR X ..." specifically to build
// comic_title_families.title, precisely so a clean shared title exists to
// use) -- passing variant_label:'' to buildFocPresaleDefaults wasn't
// enough when repSku.title itself already had the cover baked in.

const routeStart = worker.indexOf("url.pathname === '/foc/ebay/presale-group-preview'");
const routeEnd = worker.indexOf("if (url.pathname === '/foc/ebay/convert-to-instock')", routeStart);
const routeBody = worker.slice(routeStart, routeEnd);

assert.match(routeBody, /buildFocPresaleDefaults\(\{ \.\.\.repSku, title: family\.title, variant_label: '' \}, eligibleCovers\[0\]\.priceCents, onSaleDate, family\.issue_number \|\| '', family\.series_name \|\| ''\);/,
  'the preview route must build the shared title from family.title (the clean, cover-agnostic title), not the representative cover\'s own sku.title');
assert.match(routeBody, /buildFocPresaleDefaults\(\{ \.\.\.repSku, title: family\.title, variant_label: '' \}, built\[0\]\.priceCents \|\| Math\.round\(Number\(built\[0\]\.price\) \* 100\), onSaleDate, family\.issue_number \|\| '', family\.series_name \|\| ''\);/,
  'the create route must build the shared title from family.title too, matching the preview route exactly (or the published listing would drift from what was previewed)');

console.log('FOC eBay group-listing shared title (family.title, not per-cover sku.title) checks passed');

// Store report: "it didn't take my template with the html to do the
// themed listing" -- openEbayPresaleReview (single-cover) already renders
// the store's saved Settings -> Vendor Info -> EBAY LISTING SETTINGS
// "Comic" template into the description; the group-listing review modal
// never had that logic at all.
const openGroupStart = focDash.indexOf('async function openFamilyEbayGroupReview');
assert.ok(openGroupStart !== -1, 'openFamilyEbayGroupReview must exist');
const openGroupEnd = focDash.indexOf('\nasync function submitFamilyEbayGroupReview', openGroupStart);
const openGroupBody = focDash.slice(openGroupStart, openGroupEnd);

assert.match(openGroupBody, /var templates=vp\.ebayDescriptionTemplates\|\|\{\};/, 'the group review modal must read the store\'s saved eBay description templates, same as the single-cover modal');
assert.match(openGroupBody, /var customTemplate=templates\.Comic\|\|templates\.default\|\|'';/, 'must prefer the store\'s Comic template, falling back to a generic default template');
assert.match(openGroupBody, /renderEbayDescriptionTemplate\(customTemplate,tokens\)/, 'must actually render the custom template through the shared token-renderer, not just read it');
assert.match(openGroupBody, /description=disclosure\+\(isHtmlTemplate\?'':'\\n\\n'\)\+renderedBody;/, 'a successfully rendered custom template must replace the plain-text server default, with the mandatory presale disclosure still prepended');
assert.match(openGroupBody, /usedCustomTemplate=true;/, 'must track whether a custom template was actually used, so the modal can tell the store which source is in the textarea');
assert.match(openGroupBody, /esc\(description\)/, 'the description textarea must be filled from the (possibly template-rendered) description variable, not the raw un-rendered server default');
assert.match(openGroupBody, /\(usedCustomTemplate\?'Using your saved Comic template \(':'Using the built-in default \('\)/, 'the modal must tell the store which description source is currently shown, matching the single-cover modal\'s own label');

console.log('FOC eBay group-listing custom description template checks passed');
