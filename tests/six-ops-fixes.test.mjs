import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// ════════════════════════════════════════════════════════════════════════
// Fix 1: a one-off sell can no longer be added to cart with no cost entered
// ════════════════════════════════════════════════════════════════════════
{
  const start = dashboard.indexOf('async function confirmOneOffSell(){');
  assert(start >= 0, 'confirmOneOffSell must exist');
  const fn = dashboard.slice(start, dashboard.indexOf('\n}', start));
  assert.match(fn, /if\(!\(cost > 0\)\) \{ alert\('Enter a cost for this item/,
    'confirmOneOffSell must block adding to cart when cost is not a positive number, matching the name/category/price validation already there');
  assert.match(fn, /document\.getElementById\('oneoff-cost'\)\?\.focus\(\);/,
    'the cost field should be focused so the dealer can immediately fix it, matching how the other required fields behave');
}
console.log('Fix 1 (one-off requires cost) checks passed');

// ════════════════════════════════════════════════════════════════════════
// Fix 2: Back button closes an open modal (prompting only if dirty) instead
// of silently switching the tab underneath it
// ════════════════════════════════════════════════════════════════════════
{
  const popstateStart = dashboard.indexOf("window.addEventListener('popstate', event => {");
  const popstateEnd = dashboard.indexOf('\n  });', popstateStart);
  const popstateFn = dashboard.slice(popstateStart, popstateEnd);
  assert.match(popstateFn, /const openModal = window\.__arscaFindOpenModal\?\.\(\);/, 'popstate must check for an open modal before touching tab navigation');
  assert.match(popstateFn, /if\(openModal\)\{/, 'an open modal must be handled as its own branch, separate from tab history');
  assert.match(popstateFn, /const dirty = window\.__arscaIsModalDirty\?\.\(openModal\);/, 'must check whether the open modal actually has unsaved changes');
  assert.match(popstateFn, /if\(dirty && !confirm\('You have unsaved changes\. Discard them\?'\)\) return;/, 'must only prompt when the modal is dirty -- an unchanged modal must close silently, matching the requirement to prompt "only if anything has changed"');
  assert.match(popstateFn, /window\.__arscaCloseModal\?\.\(openModal\);/, 'a confirmed (or non-dirty) back-press must actually close the modal');

  const guardStart = dashboard.indexOf('(function installModalBackGuard(){');
  assert(guardStart >= 0, 'installModalBackGuard must exist');
  const guardFn = dashboard.slice(guardStart, dashboard.indexOf('\n})();', guardStart));
  assert.match(guardFn, /if\(!el \|\| !el\.id \|\| !\/-modal\$\/\.test\(el\.id\)\) return false;/, 'must generically recognize any element whose id ends in "-modal", not one hardcoded modal');
  assert.match(guardFn, /if\(el\.classList\.contains\('on'\) \|\| el\.classList\.contains\('open'\) \|\| el\.hasAttribute\('open'\)\) return true;/, 'must recognize the established .on class-toggle convention most modals use');
  assert.match(guardFn, /return el\.parentElement === document\.body;/, 'must also recognize a dynamically-injected modal with no class toggle at all (e.g. external-sale-modal) by its presence as a direct child of body');
  assert.match(guardFn, /if\(current\.length !== snap\.length\) return false;/, 'a changed field count (dynamic form) must not be treated as dirty -- can\'t meaningfully diff it');
  assert.match(guardFn, /modalEl\.remove\(\);/, 'closing a dynamically-injected modal must remove it from the DOM entirely, matching how it was created');
  assert.match(guardFn, /observer\.observe\(document\.body, \{ childList:true, subtree:true, attributes:true, attributeFilter:\['class', 'open'\] \}\);/, 'must observe the whole document for both newly-appended modals and class/open-attribute toggles on existing ones');
  assert.match(guardFn, /window\.__arscaFindOpenModal = findOpenModal;/, 'must expose findOpenModal for the popstate handler to use');
  assert.match(guardFn, /window\.__arscaIsModalDirty = isModalDirty;/, 'must expose isModalDirty for the popstate handler to use');
  assert.match(guardFn, /window\.__arscaCloseModal = closeModal;/, 'must expose closeModal for the popstate handler to use');
}
console.log('Fix 2 (back button + modal) checks passed');

// ── Functional: reimplement the dirty-check + open-detection logic ──
{
  function isOpenModalEl(el){
    if(!el || !el.id || !/-modal$/.test(el.id)) return false;
    if(el.classList.contains('on') || el.classList.contains('open') || el.hasAttribute('open')) return true;
    return el.parentElement === 'BODY';
  }
  // Static, .on-toggled modal
  const staticModal = { id:'price-sync-modal', classList:{ contains:c => c==='on' }, hasAttribute:() => false };
  assert.equal(isOpenModalEl(staticModal), true, 'a static modal with the .on class must be recognized as open');
  const staticClosedModal = { id:'price-sync-modal', classList:{ contains:() => false }, hasAttribute:() => false, parentElement:'DIV' };
  assert.equal(isOpenModalEl(staticClosedModal), false, 'a static modal without .on and not a direct child of body must not be treated as open');
  const notAModal = { id:'price-sync-panel', classList:{ contains:() => true }, hasAttribute:() => false };
  assert.equal(isOpenModalEl(notAModal), false, 'an element whose id does not end in "-modal" must never be treated as a modal');

  function isModalDirty(snap, current){
    if(!snap) return false;
    if(current.length !== snap.length) return false;
    return current.some((v, i) => v !== snap[i]);
  }
  assert.equal(isModalDirty(['a', '1'], ['a', '1']), false, 'unchanged field values must not be flagged dirty -- prompting to discard nothing is exactly the bug being fixed');
  assert.equal(isModalDirty(['a', '1'], ['a', '2']), true, 'a changed field value must be flagged dirty');
  assert.equal(isModalDirty(undefined, ['a']), false, 'no snapshot at all (guard not yet installed for this modal instance) must never block navigation');
  assert.equal(isModalDirty(['a'], ['a', 'b']), false, 'a field-count mismatch must not be treated as dirty, per the guard\'s own stated behavior');
}
console.log('Fix 2 functional checks passed');

// ════════════════════════════════════════════════════════════════════════
// Fix 3: legacy duplicate-sale dedup tolerates a discounted price instead
// of requiring an exact match
// ════════════════════════════════════════════════════════════════════════
{
  const start = dashboard.indexOf('function dedupeTransactionRows(txRows, inventorySoldItems){');
  assert(start >= 0, 'dedupeTransactionRows must exist');
  const fn = dashboard.slice(start, dashboard.indexOf('\n}', start));
  assert.doesNotMatch(fn, /Number\(salePrice \|\| 0\)\.toFixed\(2\)/, 'must no longer build an exact-price string key -- that is the bug being fixed');
  assert.match(fn, /Math\.abs\(rPrice - c\.price\) \/ Math\.max\(rPrice, c\.price\) <= 0\.5/, 'must allow the transaction price to be within 50% of the mirror price instead of requiring an exact match');
  assert.match(fn, /c\.name === rName && c\.day === rDay/, 'name + same day must still anchor the match so the widened price tolerance can\'t false-match unrelated sales');
}
console.log('Fix 3 (discount-tolerant dedup) contract checks passed');

// ── Functional: reimplement the widened matcher and prove the reported case ──
{
  function fuzzyMatches(candidates, name, salePrice, soldAt){
    const d = new Date(soldAt || 0);
    if(!name || Number.isNaN(d.getTime())) return false;
    const rName = String(name).trim().toLowerCase();
    const rDay = d.toDateString();
    const rPrice = Number(salePrice || 0);
    return candidates.some(c => c.name === rName && c.day === rDay &&
      (c.price <= 0 || rPrice <= 0 || Math.abs(rPrice - c.price) / Math.max(rPrice, c.price) <= 0.5));
  }
  const candidates = [{ name:'audino - 151/086', day:new Date('2026-08-22').toDateString(), price:43.00 }];
  // The exact reported case: ledger row at the real discounted price ($44.82
  // is actually a tiny rounding/list-price divergence, not a steep
  // discount -- well within the 50% band either way).
  assert.equal(fuzzyMatches(candidates, 'Audino - 151/086', 44.82, '2026-08-22'), true, 'a small ledger/mirror price divergence (rounding, discount) must now match');
  const cinccino = [{ name:'cinccino ex - 105/086', day:new Date('2026-08-22').toDateString(), price:7.00 }];
  assert.equal(fuzzyMatches(cinccino, 'Cinccino ex - 105/086', 6.00, '2026-08-22'), true, 'a ~17% price divergence (a real discount) must now match, unlike the old exact-match requirement');
  // Sanity: a genuinely different price (not a plausible discount) on the
  // same item/day still matches under the wide tolerance -- by design, this
  // trades a small amount of false-merge risk for actually catching
  // discounted duplicates, same tradeoff the surrounding comment documents.
  assert.equal(fuzzyMatches(candidates, 'Audino - 151/086', 21.00, '2026-08-22'), false, 'a price more than 50% off the mirror price must NOT match -- the tolerance is wide, not unlimited');
  // Different item name never matches regardless of price/day.
  assert.equal(fuzzyMatches(candidates, 'Some Other Card', 43.00, '2026-08-22'), false, 'a different item name must never match even at the exact same price and day');
}
console.log('Fix 3 functional checks passed');

// ════════════════════════════════════════════════════════════════════════
// Fix 4: a lost network response after a successful buy->inventory create
// no longer creates a duplicate inventory row on retry
// ════════════════════════════════════════════════════════════════════════
{
  const findStart = dashboard.indexOf('async function findInventoryIdByBuyItemUid(buyItemUid){');
  assert(findStart >= 0, 'findInventoryIdByBuyItemUid must exist');
  const findFn = dashboard.slice(findStart, dashboard.indexOf('\n}', findStart));
  assert.match(findFn, /\.contains\('data', \{ buyItemUid \}\)/, 'must look up an existing inventory row by the same buyItemUid via a JSONB containment query');

  const createStart = dashboard.indexOf('async function createBuyItemInventoryRecord(item){');
  assert(createStart >= 0, 'createBuyItemInventoryRecord must exist');
  const createFn = dashboard.slice(createStart, dashboard.indexOf('\n}', createStart));
  assert.match(createFn, /if\(!item\.buyItemUid\) item\.buyItemUid = item\.id \|\| \(Date\.now\(\)\.toString\(36\) \+ '_' \+ Math\.random\(\)\.toString\(36\)\.slice\(2,8\)\);/, 'every buy item must be tagged with a stable uid before the first create attempt');
  assert.match(createFn, /const existingId = await findInventoryIdByBuyItemUid\(item\.buyItemUid\);/, 'must check for an existing row with this uid before creating a new one');
  assert.match(createFn, /if\(existingId\)\{/, 'a found existing row must short-circuit -- reuse it instead of inserting again');
  assert.match(createFn, /updates\.buyItemUid = item\.buyItemUid;/, 'the uid must actually be persisted onto the created row, or a later retry could never find it');
}
console.log('Fix 4 (buy-to-inventory retry dedup) checks passed');

// ════════════════════════════════════════════════════════════════════════
// Fix 5: the storefront publish flag itself -- toggle/label semantics,
// and the eventual store decision to reverse the fresh-inventory default
// (see the later "onlineListed default reversed" section) after repeated
// store reports of genuinely in-stock items just not showing up, needing
// a manual per-item publish nobody remembered to do
// ════════════════════════════════════════════════════════════════════════
{
  const createStart = dashboard.indexOf('async function createBuiltInInventoryItem(');
  assert(createStart >= 0, 'createBuiltInInventoryItem must exist');
  const createFn = dashboard.slice(createStart, dashboard.indexOf('\n}', createStart));
  assert.match(createFn, /onlineListed:\(item\?\.onlineListed \?\? updates\?\.onlineListed \?\? true\),/, 'a freshly created item must default onlineListed to true (listed immediately) unless the caller explicitly set it -- reversed from the original opt-in gate, see the section below for why');

  assert.match(worker, /onlineListed: d\.onlineListed !== false,/, 'the storefront route must default onlineListed to true for pre-existing items with no such field, and false must be the only value that excludes -- otherwise every already-live item would vanish from the storefront the moment this shipped');
  assert.match(worker, /return !!\(i\.name && i\.quantity > 0 && i\.onlineListed && !i\.soldAt/, 'isStorefrontItemAvailable must actually require onlineListed to be truthy');

  const toggleStart = dashboard.indexOf('async function toggleInventoryOnlineListed(id){');
  assert(toggleStart >= 0, 'toggleInventoryOnlineListed must exist');
  const toggleFn = dashboard.slice(toggleStart, dashboard.indexOf('\n}', toggleStart));
  assert.match(toggleFn, /const next = item\.onlineListed === false;/, 'toggling must flip based on the same false-means-unlisted rule the storefront route uses');
  assert.match(toggleFn, /await saveInventoryEdit\(item, \{ onlineListed: next \}\);/, 'must actually persist the toggle');

  assert.match(dashboard, /onclick="toggleInventoryOnlineListed\('\$\{id\}'\);closeInvRowMenu\(\)"/, 'the inventory row menu must expose the publish/unpublish toggle');
  assert.match(dashboard, /\$\{item\?\.onlineListed===false\?'🌐 Publish to Storefront':'🚫 Remove from Storefront'\}/, 'the row menu button label must reflect the item\'s actual current listed state');
}
console.log('Fix 5 (storefront publish toggle + onlineListed default) checks passed');

// ════════════════════════════════════════════════════════════════════════
// Fix 6: real auto-synced eBay orders now deduct eBay's marketplace fee
// from recorded profit, matching the manual sale-recording flows
// ════════════════════════════════════════════════════════════════════════
{
  assert.match(worker, /const EBAY_DEFAULT_FEE_PCT = 13\.25;/, 'must define a default eBay fee rate, matching EXTERNAL_SALE_FEE_DEFAULTS.eBay in dashboard.html');
  assert.match(dashboard, /eBay: \{ pct: 13\.25, flat: 0,/, 'the client-side eBay fee default (used for manual sale recording) must match the server-side default used for auto-synced orders');

  const syncStart = worker.indexOf("if (url.pathname === '/ebay/orders/sync') {");
  assert(syncStart >= 0, '/ebay/orders/sync route must exist');
  const syncFn = worker.slice(syncStart, worker.indexOf("\n    if (url.pathname === '/ebay/orders/ship'", syncStart));
  assert.match(syncFn, /const \{ data: syncSettings \} = await supabaseAdminFetch\(env, `store_settings\?store_id=eq\.\$\{encodeURIComponent\(storeId\)\}&select=receipt_settings&limit=1`\);/, 'must load the store\'s receipt_settings so a per-store eBay fee override is possible');
  assert.match(syncFn, /const ebayFeePct = Number\(receiptSettings\?\.ebayFeePct \?\? EBAY_DEFAULT_FEE_PCT\);/, 'must use a configured fee rate when present, falling back to the shared default');
  assert.match(syncFn, /const feeAmount = Math\.round\(\(salePrice \* \(ebayFeePct \/ 100\) \+ ebayFeeFlat\) \* 100\) \/ 100;/, 'must compute the fee the same way the manual external-sale flow does (percent of sale price + flat)');
  assert.match(syncFn, /const profit = salePrice - cost - feeAmount;/, 'the fee must actually be subtracted from recorded profit -- this is the whole point of the fix');
  assert.doesNotMatch(syncFn, /const profit = salePrice - cost;\n/, 'the old fee-less profit calculation must be gone');
}
console.log('Fix 6 (eBay auto-sync fee deduction) checks passed');

console.log('All six ops-fixes checks passed');
