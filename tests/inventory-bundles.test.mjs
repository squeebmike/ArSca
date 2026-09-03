import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Field whitelist: bundle metadata must survive both read (mapBuiltInItem)
// and write (builtInDataFromItem) or it silently vanishes on the next save,
// exactly like the pre-existing comicMetadata bug this pattern documents.
assert.match(dashboard, /\['isBundle',false,'bool'\], \['bundleMemberIds',\[\],'array'\], \['bundleMemberNames',\[\],'array'\],/, 'bundle container fields must be registered in BUILT_IN_ITEM_SIMPLE_FIELDS');
assert.match(dashboard, /\['bundleMemberValueTotal',0,'num'\], \['bundledIntoId',''\], \['bundledIntoName',''\],/, 'bundle member-side fields must be registered in BUILT_IN_ITEM_SIMPLE_FIELDS');
assert.match(dashboard, /\['soldAt',''\], \['saleId',''\],/, 'soldAt/saleId must be registered so cascadeMarkBundleMembersSold writes actually persist');

// ── Sellability: a bundled-into-something item must not be independently sellable ──
assert.match(dashboard, /return !\['sold','archived','returned','deleted','bundled'\]\.includes\(status\) && !item\.soldAt && inventoryAvailableQuantity\(item\) > 0;/, 'inventoryItemIsSellable must exclude status "bundled" so a bundled item cannot also be sold on its own');

// ── Bundle eligibility: only single-qty, sellable, non-bundle items ──
assert.match(dashboard, /function inventoryItemBundleEligible\(item\)\{\s*\n\s*return !!item && inventoryItemIsSellable\(item\) && inventoryAvailableQuantity\(item\) === 1 && !item\.isBundle;/, 'inventoryItemBundleEligible must require sellable + qty exactly 1 + not already a bundle');

// ── Draft selection state + UI ──
assert.match(dashboard, /function toggleBundleDraft\(id\)\{/, 'missing toggleBundleDraft');
assert.match(dashboard, /if\(!inventoryItemBundleEligible\(item\)\)\{ toast_dash\('Only single-quantity, in-stock items can be bundled'\); return; \}/, 'toggleBundleDraft must refuse ineligible items');
assert.match(dashboard, /function renderBundleDraftBar\(\)\{/, 'missing renderBundleDraftBar');
assert.match(dashboard, /\$\{bundleDraftIds\.size<2\?'disabled':''\}/, 'BUILD BUNDLE button must be disabled below 2 selected items');

// ── Bundle name suggestion (comic run detection) ──
assert.match(dashboard, /function suggestBundleName\(items\)\{/, 'missing suggestBundleName');
assert.match(dashboard, /const comics = items\.filter\(i => qplCategoryKey\(i\.category\) === 'comic'\);/, 'suggestBundleName must scope run-detection to comic items via qplCategoryKey');

// ── Bundle creation: container is a normal inventory row, no special-casing needed in cart/checkout ──
assert.match(dashboard, /async function createInventoryBundle\(items, name, price\)\{/, 'missing createInventoryBundle');
assert.match(dashboard, /productType:'bundle', isBundle:true,/, 'bundle container must be tagged isBundle so cascade logic and row menu can recognize it');
assert.match(dashboard, /bundleMemberIds: items\.map\(i => i\.id\),/, 'bundle container must record its member ids');
assert.match(dashboard, /const containerId = await createBuiltInInventoryItem\(\{\}, containerUpdates, 'built_in'\);/, 'bundle container must be created via the same createBuiltInInventoryItem path as any other new inventory row (so it gets a real inventory_items row and flows through normal cart/checkout unmodified)');
assert.match(dashboard, /try \{ await updateBuiltInInventoryItem\(member, \{ status:'bundled', lifecycle:'bundled', bundledIntoId:containerId, bundledIntoName:name \}\); \}/, 'each member must be marked status bundled and linked back to the container');
// Store report: 3 books folded into a bundle kept showing individually as
// in-stock on themanapocket.com. Root cause: the live storefront route
// (isStorefrontItemAvailable in the Worker) reads data.lifecycle before the
// raw status column (shapeStorefrontItem), and this update only ever set
// status, never lifecycle -- so a member's lifecycle stayed at whatever it
// was (usually 'in_stock') no matter what status said. lifecycle must be
// set in the same update call, matching every other status-changing flow
// in this file (archive/restore/sale all set both together).
assert.match(dashboard, /setLifecycle\(member\.id, 'bundled', true\);/, 'createInventoryBundle must also sync the client-side lifecycle KV map so the row\'s own lifecycle display matches what was actually saved');

// ── Dissolve: only allowed before the bundle sells, reverts members ──
assert.match(dashboard, /async function dissolveBundle\(containerId\)\{/, 'missing dissolveBundle');
assert.match(dashboard, /if\(container\.status !== 'in_stock'\) return toast_dash\('This bundle has already sold and cannot be dissolved'\);/, 'dissolveBundle must refuse to dissolve an already-sold bundle');
assert.match(dashboard, /try \{ await updateBuiltInInventoryItem\(member, \{ status:'in_stock', lifecycle:'in_stock', bundledIntoId:'', bundledIntoName:'' \}\); \}/, 'dissolveBundle must revert each member back to in_stock and clear its bundle link, including lifecycle -- otherwise a dissolved member stays excluded from the storefront forever');
assert.match(dashboard, /setLifecycle\(member\.id, 'in_stock', true\);/, 'dissolveBundle must also sync the client-side lifecycle KV map back to in_stock');

// ── Sale cascade: hooked into checkout finalize, right after the normal sold-marking call ──
assert.match(dashboard, /await markCartItemsSoldFromPayment\(\(lockedCheckoutSnapshot\?\.lines \|\| \[\]\)\.map\(l => \(\{ name:l\.title, price:l\.adjusted_price, cost:l\.cost_basis, category:l\.category, condition:l\.condition, quantity:l\.quantity, shopId:l\.item_id \}\)\), method, paidAt, \{ skipRemote:inventoryCommittedAtomically \}\);\s*\n\s*await cascadeMarkBundleMembersSold\(lockedCheckoutSnapshot\?\.lines \|\| \[\], paidAt, bundle\.sale\.id\);/, 'checkout finalize must cascade-mark bundle members sold right after the bundle container itself is marked sold');
assert.match(dashboard, /async function cascadeMarkBundleMembersSold\(lines, soldAt, saleId\)\{/, 'missing cascadeMarkBundleMembersSold');
assert.match(dashboard, /if\(!container\?\.isBundle \|\| !Array\.isArray\(container\.bundleMemberIds\) \|\| !container\.bundleMemberIds\.length\) continue;/, 'cascade must skip non-bundle sale lines entirely');

// ── Row menu wiring ──
assert.match(dashboard, /inventoryItemBundleEligible\(item\)\?`<button class="hbtn" style="\$\{btnStyle\};color:var\(--gold\)" onclick="toggleBundleDraft\('\$\{id\}'\);closeInvRowMenu\(\)">🎁 \$\{bundleDraftIds\.has\(id\)\?'Remove from':'Add to'\} Bundle Draft<\/button>`:'',/, 'row menu must offer add/remove-from-bundle-draft for eligible items');
assert.match(dashboard, /\(item\?\.isBundle && item\.status==='in_stock'\)\?`<button class="hbtn" style="\$\{btnStyle\};color:var\(--red\)" onclick="dissolveBundle\('\$\{id\}'\);closeInvRowMenu\(\)">🎁 Dissolve Bundle<\/button>`:'',/, 'row menu must offer Dissolve Bundle only for unsold bundle containers');

// ── Table display: bundled members must not read as plain "SOLD", and bundle containers get a badge ──
assert.match(dashboard, /\$\{i\.isBundle\?' <span style="color:var\(--gold\);font-size:8px">🎁 BUNDLE<\/span>':''\}/, 'bundle container rows must show a BUNDLE badge');
assert.match(dashboard, /\$\{i\.status==='bundled'&&i\.bundledIntoName\?`<div class="sc2" style="margin-top:5px;color:var\(--gold\)">🎁 In bundle: \$\{escHtml\(i\.bundledIntoName\)\}<\/div>`:''\}/, 'member rows must show which bundle they were folded into');
// The status column now reads off the shared inventoryRowAvailability()
// helper (see the multi-select filter rework) instead of an inline ternary
// -- confirm that helper itself still gives a bundle container "IN BUNDLE",
// not "SOLD", and that the table row actually renders its label/color.
assert.match(dashboard, /if\(i\.status !== 'in_stock'\) return \{ available:false, label: i\.status==='bundled' \? 'IN BUNDLE' : \('SOLD'\+\(i\.channel\?' · '\+i\.channel:''\)\), color: i\.status==='bundled' \? 'var\(--gold\)' : 'var\(--dim\)' \};/,
  'inventoryRowAvailability must give a bundle container "IN BUNDLE", not "SOLD", in its status label');
assert.match(dashboard, /<td><span style="font-family:var\(--font-mono\);font-size:9px;color:\$\{rowAvail\.color\}">\$\{rowAvail\.label\}<\/span>/,
  'bundled member rows must read the shared rowAvail.label/color in the status column, not a bespoke IN BUNDLE/SOLD ternary');

// ── Live storefront gate: a bundled member must never pass availability,
// no matter what onlineListed/quantity say -- it's only sellable as the
// bundle container's own row. Checked against both the real Worker gate
// and the dashboard's own mirrored copy (used by Check Storefront Status).
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.match(worker, /!\['sold','archived','returned','deleted','sold_pending_pickup','sold_pending_shipment','hold','lost_damaged','presale','bundled'\]\.includes\(i\.inventoryStatus\)/,
  'isStorefrontItemAvailable in the Worker must exclude status "bundled", the same as every other excluded lifecycle');
assert.match(dashboard, /bundled:'part of a bundle \(only sellable as the bundle itself, not individually\)',/,
  'STOREFRONT_EXCLUDED_STATUS_REASONS must mirror the Worker\'s bundled exclusion so Check Storefront Status reports the real reason instead of a false "should be showing"');

console.log('Inventory bundle contract checks passed');

// ── Functional: suggestBundleName's comic-run detection ──────────────────
const qplSrc = dashboard.match(/function qplCategoryKey\(category\)\{[\s\S]*?\n\}/)[0];
const suggestSrc = dashboard.match(/function suggestBundleName\(items\)\{[\s\S]*?\n\}/)[0];
const { suggestBundleName } = new Function(`${qplSrc}\n${suggestSrc}\nreturn { suggestBundleName };`)();

const run = [
  { category:'Comics', comicMetadata:{ series:'Amazing Spider-Man', issueNumber:'300' } },
  { category:'Comics', comicMetadata:{ series:'Amazing Spider-Man', issueNumber:'301' } },
  { category:'Comics', comicMetadata:{ series:'Amazing Spider-Man', issueNumber:'302' } },
];
assert.equal(suggestBundleName(run), 'Amazing Spider-Man #300–#302 (3-issue run)', 'a consecutive same-series comic run must be named after the issue range');

const mixedSeries = [
  { category:'Comics', comicMetadata:{ series:'Batman', issueNumber:'1' } },
  { category:'Comics', comicMetadata:{ series:'Detective Comics', issueNumber:'1' } },
];
assert.equal(suggestBundleName(mixedSeries), 'Bundle of 2 Items', 'comics from different series must fall back to the generic name');

const nonComics = [
  { category:'Pokemon' },
  { category:'MTG' },
];
assert.equal(suggestBundleName(nonComics), 'Bundle of 2 Items', 'non-comic items must fall back to the generic name');

const noIssueNumbers = [
  { category:'Comics', comicMetadata:{ series:'Saga' } },
  { category:'Comics', comicMetadata:{ series:'Saga' } },
];
assert.equal(noIssueNumbers.length && suggestBundleName(noIssueNumbers), 'Saga (2-issue bundle)', 'same-series comics without parseable issue numbers must still name the series, without a fabricated range');

console.log('suggestBundleName functional checks passed');

// ── Functional: the real storefront gate must reject a bundled member ──
function isStorefrontItemAvailable(i) {
  return !!(i.name && i.quantity > 0 && i.onlineListed && !i.soldAt && !i.archivedAt && !['sold','archived','returned','deleted','sold_pending_pickup','sold_pending_shipment','hold','lost_damaged','presale','bundled'].includes(i.inventoryStatus));
}
{
  const bundledMember = { name:'Crain Cover A', quantity:1, onlineListed:true, soldAt:'', archivedAt:'', inventoryStatus:'bundled' };
  assert.equal(isStorefrontItemAvailable(bundledMember), false, 'a bundled member must never show as available on the live storefront, even with quantity>0 and onlineListed:true');
}
{
  const normalItem = { name:'Regular card', quantity:1, onlineListed:true, soldAt:'', archivedAt:'', inventoryStatus:'in_stock' };
  assert.equal(isStorefrontItemAvailable(normalItem), true, 'sanity check: a normal in-stock item must still be available');
}

console.log('Storefront bundled-exclusion functional checks passed');
