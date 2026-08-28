import fs from 'node:fs';
import assert from 'node:assert/strict';

const focDash = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');

// Store report: listing a single cover on eBay from the FOC wall (or saving
// any one field on a cover card) reset the search box and every filter
// dropdown back to "All" and jumped the whole wall back to the top of the
// page. Root cause: both actions refreshed via openCycle(state.cycle.id) --
// the same function a prior fix (see foc-cycle-filter-reset.test.mjs) made
// always clear every filter, specifically so a filter left over from
// browsing a DIFFERENT, earlier cycle wouldn't silently narrow a freshly
// opened one. But re-opening the SAME cycle you're already looking at (the
// case for a one-item save or listing) isn't a cycle switch at all -- and
// openCycle's own renderCycle() also rebuilds the entire panel from
// scratch regardless of filters, which is what actually reset scroll
// position.

// ── openCycle must only clear filters when actually switching cycles ──
assert.match(focDash, /if\(!state\.cycle\|\|state\.cycle\.id!==id\)\{state\.query='';state\.publisher='all';state\.flag='all';state\.ebay='all';focEbayBulkSelectedIds\.clear\(\);focEbayBulkQueue=null;\}/,
  'openCycle must only reset filters (and the bulk eBay listing selection/queue, which are sku ids scoped to that cycle) when opening a DIFFERENT cycle than the one already loaded, or every single-item refresh (which passes the same id) keeps wiping filters');

// ── refreshCycleFamilies must exist as a lighter refresh that doesn't
// rebuild the whole panel (and therefore doesn't reset scroll position) ──
assert.match(focDash, /async function refreshCycleFamilies\(\)\{/, 'missing refreshCycleFamilies');
{
  const fnStart = focDash.indexOf('async function refreshCycleFamilies(){');
  const fnEnd = focDash.indexOf('\n}', fnStart) + 2;
  const fn = focDash.slice(fnStart, fnEnd);
  assert.match(fn, /renderFamilies\(\);/, 'refreshCycleFamilies must re-render only the family list, not the whole panel');
  assert.doesNotMatch(fn, /renderCycle\(\)/, 'refreshCycleFamilies must not call the full-panel renderCycle -- that is exactly what resets scroll position');
  assert.doesNotMatch(fn, /panel\(\)\.innerHTML/, 'refreshCycleFamilies must not replace the whole panel');
}

// ── The two single-item actions this was reported against must use the
// lighter refresh, not the full openCycle rebuild ──
{
  const fnStart = focDash.indexOf('async function submitEbayPresaleReview(skuId){');
  const fnEnd = focDash.indexOf('\n}', fnStart) + 2;
  const fn = focDash.slice(fnStart, fnEnd);
  assert.match(fn, /await refreshCycleFamilies\(\);/, 'listing a single cover on eBay must use the lighter refresh, not reset filters/scroll on every listing');
  assert.doesNotMatch(fn, /await openCycle\(state\.cycle\.id\);/, 'must no longer call the full-panel-rebuilding openCycle after a single eBay listing');
}
{
  const fnStart = focDash.indexOf('async function saveSku(id){');
  const fnEnd = focDash.indexOf('}}', fnStart) + 2;
  const fn = focDash.slice(fnStart, fnEnd);
  assert.match(fn, /await refreshCycleFamilies\(\);/, 'saving a single cover field must use the lighter refresh, not reset filters/scroll on every save');
}

console.log('FOC single-item refresh preserves filters/scroll contract checks passed');
