import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store report: "need to do eBay bundle listings for comics" -- an item
// bundle (see tests/inventory-bundles.test.mjs) already flows straight into
// the existing single-item "LIST ON EBAY" button/flow with zero new eBay
// code (submitDashboardEbayListing/collectDashboardEbayFormPayload just
// operate on whatever item is in `all` by id). But computeEbayListingFields
// builds its description by running the item through a single-card/comic
// template (writer/artist/condition/card_number/etc) -- a bundle container
// has none of those fields set on itself, so the generated listing
// description came out mostly blank instead of saying what's actually in
// the lot, which is the one thing that actually sells a multi-item lot.

const fnStart = dashboard.indexOf('function computeEbayListingFields(item){');
const fnEnd = dashboard.indexOf('\n\nasync function generateAiEbayDescription', fnStart);
const fnBody = dashboard.slice(fnStart, fnEnd);
assert.ok(fnStart !== -1, 'computeEbayListingFields must exist');
assert.match(fnBody, /const bundleMemberNames = Array\.isArray\(item\.bundleMemberNames\) \? item\.bundleMemberNames\.filter\(Boolean\) : \[\];/,
  'must read the bundle container\'s own bundleMemberNames (set by createInventoryBundle), not try to re-derive it');
assert.match(fnBody, /const bodyText = \(item\.isBundle && bundleMemberNames\.length\)\s*\n\s*\? \['This lot includes ' \+ bundleMemberNames\.length \+ ' items:', bundleMemberNames\.map\(n => '• ' \+ n\)\.join\('\\n'\), 'All items in this lot ship together\.'\]\.join\('\\n\\n'\)\s*\n\s*: renderEbayDescriptionTemplate\(template, tokens\);/,
  'a bundle with known members must list them by name instead of running the single-item template');

console.log('Bundle eBay description contract checks passed');

// ── Functional: the branch logic itself, independent of the DOM/template engine ──
function bundleAwareBodyText(item, templateOutput) {
  const bundleMemberNames = Array.isArray(item.bundleMemberNames) ? item.bundleMemberNames.filter(Boolean) : [];
  return (item.isBundle && bundleMemberNames.length)
    ? ['This lot includes ' + bundleMemberNames.length + ' items:', bundleMemberNames.map(n => '• ' + n).join('\n'), 'All items in this lot ship together.'].join('\n\n')
    : templateOutput;
}

{
  // A real bundle with members must enumerate them, not fall through to the templated single-item text.
  const bundle = { isBundle: true, bundleMemberNames: ['Amazing Spider-Man #1', 'Batman #1', 'Saga #1'] };
  const out = bundleAwareBodyText(bundle, 'SHOULD NOT APPEAR');
  assert.match(out, /This lot includes 3 items:/);
  assert.match(out, /• Amazing Spider-Man #1/);
  assert.match(out, /• Batman #1/);
  assert.match(out, /• Saga #1/);
  assert.match(out, /All items in this lot ship together\./);
  assert.doesNotMatch(out, /SHOULD NOT APPEAR/, 'a bundle with known members must never fall through to the single-item template text');
}

{
  // A non-bundle item must be completely unaffected -- this is a pure addition, not a behavior change for normal items.
  const single = { isBundle: false, bundleMemberNames: [] };
  assert.equal(bundleAwareBodyText(single, 'TEMPLATE OUTPUT'), 'TEMPLATE OUTPUT', 'a normal single item must still use the templated description unchanged');
}

{
  // A bundle container that somehow has no member names recorded must fall back
  // to the template rather than producing an empty "This lot includes 0 items:" listing.
  const emptyBundle = { isBundle: true, bundleMemberNames: [] };
  assert.equal(bundleAwareBodyText(emptyBundle, 'TEMPLATE OUTPUT'), 'TEMPLATE OUTPUT', 'a bundle with no recorded member names must fall back to the template instead of listing zero items');
}

console.log('Bundle eBay description functional checks passed');
