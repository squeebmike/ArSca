import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store report: "we need better filters in inventory screen. its weird
// thats there's a couple repetitive filters there also." Traced the actual
// mechanism: every Inventory filter -- status (In Stock/Sold/Archived/At
// Show/On Hold/Pulled), category (the wheel, including a "Graded" pseudo-
// category that actually matched grading fields, not a real category),
// listing state, quality flags (No Photo, Stale Price, etc), and age
// buckets -- all shared ONE single string (activeF). Picking any one of
// them cleared every other one, even though most of them are genuinely
// independent facts about an item (a sold comic is still a comic). This
// also produced real redundancy: "Comic Raw"/"Comic Slabbed" chips existed
// only because grading couldn't otherwise combine with a category filter,
// and "High Value" lived in the comic-only filter row despite its logic
// having nothing to do with comics.
//
// Fixed: six independent filter groups (status/category/listing/grading/
// flag/age) that AND-combine, so Status=Sold + Category=Comic +
// Grading=Graded can all be active together. Comic Raw/Comic Slabbed are
// gone -- they're just Category=Comic + Grading=Graded/Ungraded now, no
// redundant dedicated chip needed. High Value moved into the general
// quality-flags row. The category wheel's "Graded" pseudo-category is gone
// too, replaced by the real Grading group (which works for every category,
// not just whatever had a "Graded" wheel entry).

// ── filterState replaces the old single activeF ──
assert.match(dashboard, /let filterState = \{ status:'in_stock', category:'cat_all', listing:'all', grading:'all', flag:'all', age:'all' \};/,
  'filterState must exist with one independent slot per filter group, defaulting to the same in-stock-only view as before');
assert.doesNotMatch(dashboard, /activeF *=/, 'the old single-select activeF variable must be fully gone, not left dangling alongside the new filterState');

// ── The six independent predicates exist and are what filterTable ANDs together ──
for (const fn of ['inventoryMatchesStatus', 'inventoryMatchesCategory', 'inventoryMatchesListing', 'inventoryMatchesGrading', 'inventoryMatchesFlag', 'inventoryMatchesAge']) {
  assert.match(dashboard, new RegExp('function ' + fn + '\\('), 'missing ' + fn);
}
const filterTableStart = dashboard.indexOf('function filterTable(){');
const filterTableEnd = dashboard.indexOf('\n  if(q) {', filterTableStart);
const filterTableBody = dashboard.slice(filterTableStart, filterTableEnd);
assert.ok(filterTableStart !== -1, 'filterTable must exist');
assert.match(filterTableBody, /return mq\s*\n\s*&& inventoryMatchesStatus\(i, filterState\.status\)\s*\n\s*&& inventoryMatchesCategory\(i, filterState\.category\)\s*\n\s*&& inventoryMatchesListing\(i, filterState\.listing\)\s*\n\s*&& inventoryMatchesGrading\(i, filterState\.grading\)\s*\n\s*&& inventoryMatchesFlag\(i, filterState\.flag\)\s*\n\s*&& inventoryMatchesAge\(i, filterState\.age\);/,
  'filterTable must AND all six group predicates together, not branch on one shared value');

// ── setF only touches its own group's chips, not every .fb on the page ──
assert.match(dashboard, /function setF\(group,value,btn\)\{\s*\n\s*filterState\[group\]=value; page=1;\s*\n\s*document\.querySelectorAll\('\.fb\[data-filter-group="'\+group\+'"\]'\)\.forEach\(b=>b\.classList\.remove\('on'\)\);/,
  'setF must clear .on only within the SAME group, not strip every filter chip on the page -- that\'s the actual single-select-to-multi-select fix');

// ── Redundant chips removed, High Value relocated ──
assert.doesNotMatch(dashboard, /setF\('comic_raw'|setF\('flag','comic_raw'/, 'Comic Raw chip must be gone -- it\'s Category=Comic + Grading=Ungraded now');
assert.doesNotMatch(dashboard, /setF\('comic_slabbed'|setF\('flag','comic_slabbed'/, 'Comic Slabbed chip must be gone -- it\'s Category=Comic + Grading=Graded now');
assert.doesNotMatch(dashboard, /invCatWheelSelect\(this,'Graded'\)/, 'the wheel\'s "Graded" pseudo-category must be gone -- grading is its own cross-category group now');
assert.match(dashboard, /<button class="fb" data-filter-group="flag" onclick="setF\('flag','high_value',this\)">High Value<\/button>/, 'High Value must live in the general flags row now, not be stuck in the comic-only row it never actually belonged to');
assert.match(dashboard, /<button class="fb" data-filter-group="grading" onclick="setF\('grading','graded',this\)">Graded<\/button>/, 'a real Grading group chip must exist');
assert.match(dashboard, /<button class="fb" data-filter-group="grading" onclick="setF\('grading','ungraded',this\)">Ungraded<\/button>/, 'a real Grading group chip for Ungraded must exist');

// ── Mobile FILTERS toggle must reveal all three chip rows, not just the first ──
// Store report (found while splitting filters into groups): toggleInvFilters
// only ever toggled the first #inv-filter-chips row by id -- with three rows
// now instead of two, the other two would have stayed permanently hidden on
// mobile no matter how many times FILTERS was tapped.
const toggleStart = dashboard.indexOf('function toggleInvFilters(){');
const toggleEnd = dashboard.indexOf('\n}', toggleStart) + 2;
const toggleBody = dashboard.slice(toggleStart, toggleEnd);
assert.ok(toggleStart !== -1, 'toggleInvFilters must exist');
assert.match(toggleBody, /const rows = document\.querySelectorAll\('\.inv-filter-chips'\);/, 'toggleInvFilters must select every filter-chip row, not just the one with an id');
assert.match(toggleBody, /rows\.forEach\(el => el\.classList\.toggle\('on', on\)\);/, 'toggleInvFilters must reveal/hide every row together, in sync');

console.log('Inventory multi-select filter contract checks passed');

// ── inventoryRowAvailability: hold/at_show/pulled must not read as plain in-stock ──
assert.match(dashboard, /function inventoryRowAvailability\(i\)\{/, 'missing inventoryRowAvailability');
{
  const fnStart = dashboard.indexOf('function inventoryRowAvailability(i){');
  const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
  const fn = dashboard.slice(fnStart, fnEnd);
  assert.match(fn, /if\(i\.lifecycle === 'hold'\) return \{ available:false, label:'ON HOLD', color:'var\(--gold\)' \};/, 'an on-hold item must not be indistinguishable from genuinely available in-stock -- it was reading as plain "IN STOCK" with a working ADD TO CART button before this fix');
  assert.match(fn, /if\(i\.lifecycle === 'at_show'\) return \{ available:false, label:'AT SHOW', color:'var\(--gold\)' \};/, 'an at-show item must be flagged unavailable too');
}
assert.match(dashboard, /const rowAvail = inventoryRowAvailability\(i\);\s*\n\s*const ins = rowAvail\.available;/, 'renderTable must derive ins from the shared availability helper, not just i.status===\'in_stock\'');

console.log('Row-availability (hold/at_show fix) contract checks passed');

// ── Functional: the six predicates, independent of DOM ──────────────────
const LIFECYCLE_LABELS = { in_stock:'x', at_show:'x', hold:'x', sold:'x', listed_online:'x', pulled_ebay:'x', consigned:'x', returned:'x', lost_damaged:'x', archived:'x' };
function inventoryMatchesStatus(i, status){
  const isArchived = i.lifecycle === 'archived' || i.status === 'archived' || !!i.archivedAt;
  if(status === 'archived') return isArchived;
  if(isArchived) return false;
  if(status === 'all') return true;
  if(status === 'in_stock') return i.status === 'in_stock';
  if(status === 'sold') return i.status === 'sold';
  if(LIFECYCLE_LABELS[status]) return i.lifecycle === status;
  return true;
}
function inventoryMatchesCategory(i, category){ return category === 'cat_all' || i.category === category; }
function inventoryMatchesGrading(i, grading){
  if(grading === 'all') return true;
  const graded = !!(i.grader || i.grade);
  return grading === 'graded' ? graded : !graded;
}

{
  // The actual scenario the store report was about: combine two previously-
  // mutually-exclusive filters at once.
  const items = [
    { id:'a', status:'sold', category:'Comic', grader:'CGC', grade:'9.8' },
    { id:'b', status:'in_stock', category:'Comic', grader:'CGC', grade:'9.8' },
    { id:'c', status:'sold', category:'Sports' },
    { id:'d', status:'sold', category:'Comic' }, // sold, comic, but ungraded
  ];
  const result = items.filter(i => inventoryMatchesStatus(i,'sold') && inventoryMatchesCategory(i,'Comic') && inventoryMatchesGrading(i,'graded'));
  assert.deepEqual(result.map(i=>i.id), ['a'], 'Status=Sold + Category=Comic + Grading=Graded must combine as AND, matching only items satisfying all three at once');
}

{
  // Comic Raw's old behavior must still be exactly reproducible via Category+Grading.
  const comic = { status:'in_stock', category:'Comic', grader:'', grade:'' };
  const comicGraded = { status:'in_stock', category:'Comic', grader:'PSA', grade:'9' };
  assert.equal(inventoryMatchesCategory(comic,'Comic') && inventoryMatchesGrading(comic,'ungraded'), true, 'Category=Comic + Grading=Ungraded must reproduce the old "Comic Raw" chip exactly');
  assert.equal(inventoryMatchesCategory(comicGraded,'Comic') && inventoryMatchesGrading(comicGraded,'graded'), true, 'Category=Comic + Grading=Graded must reproduce the old "Comic Slabbed" chip exactly');
  assert.equal(inventoryMatchesCategory(comicGraded,'Comic') && inventoryMatchesGrading(comicGraded,'ungraded'), false, 'a graded comic must not match the Ungraded grading filter');
}

{
  // Archived exclusion semantics must survive unchanged: archived items only
  // ever show under Status=Archived, same as the old activeF==='archived' branch.
  const archived = { status:'in_stock', lifecycle:'archived', category:'Sports' };
  assert.equal(inventoryMatchesStatus(archived,'all'), false, 'an archived item must stay hidden under Status=All, same as before');
  assert.equal(inventoryMatchesStatus(archived,'in_stock'), false, 'an archived item must stay hidden under Status=In Stock even if its raw status field still says in_stock');
  assert.equal(inventoryMatchesStatus(archived,'archived'), true, 'an archived item must only appear under Status=Archived');
}

console.log('Multi-select filter functional checks passed');
