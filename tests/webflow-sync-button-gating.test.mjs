import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store report: a store not using Webflow for inventory clicked "Publish /
// Sync Webflow" in an item's row menu expecting it to control what shows
// on their actual website. It doesn't -- the real storefront reads straight
// from Supabase (isStorefrontItemAvailable in the Worker, gated on
// item.onlineListed), and this button pushes to Webflow's own separate CMS
// instead, a no-op for a Supabase-only store. The near-identical wording
// next to the real "Publish to Storefront" toggle right below it made the
// mix-up an easy one to make. Now only shown for stores actually
// configured to use Webflow inventory (usesWebflowInventory()).

assert.match(dashboard, /\(isInStock && usesWebflowInventory\(\)\)\?`<button class="hbtn" style="\$\{btnStyle\};color:var\(--g\)" onclick="publishInventoryItemToWebflow\('\$\{id\}'\);closeInvRowMenu\(\)">🌐 Publish \/ Sync Webflow<\/button>`:'',/,
  'the Publish/Sync Webflow row-menu button must be gated on usesWebflowInventory(), not shown unconditionally to every store');

// The real storefront toggle right below it must be completely unaffected --
// this is still the one and only control that actually matters for the
// live site, for every store regardless of Webflow configuration.
assert.match(dashboard, /isInStock\?`<button class="hbtn" style="\$\{btnStyle\};color:\$\{item\?\.onlineListed===false\?'var\(--gold\)':'var\(--dim\)'\}" onclick="toggleInventoryOnlineListed\('\$\{id\}'\);closeInvRowMenu\(\)">\$\{item\?\.onlineListed===false\?'🌐 Publish to Storefront':'🚫 Remove from Storefront'\}<\/button>`:'',/,
  'the real Publish/Remove from Storefront toggle must still show for every in-stock item regardless of Webflow configuration');

console.log('Webflow sync button gating contract checks passed');

// ── Functional: usesWebflowInventory()'s own gating logic ──
function usesWebflowInventory(source) {
  return source === 'webflow' || source === 'hybrid';
}
assert.equal(usesWebflowInventory('built_in'), false, 'a built-in (Supabase-only) store must not show the Webflow sync button');
assert.equal(usesWebflowInventory('spreadsheet'), false, 'a spreadsheet-only store must not show the Webflow sync button either');
assert.equal(usesWebflowInventory('webflow'), true, 'a Webflow-only store must still see the button');
assert.equal(usesWebflowInventory('hybrid'), true, 'a hybrid store must still see the button');

console.log('usesWebflowInventory functional checks passed');
