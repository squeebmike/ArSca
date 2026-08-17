import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// ── Contract: loadBuiltInInventoryItems pages fully instead of a single
// capped query -- a store past 1000 rows used to have older stock silently
// missing from the client entirely, not just slow to appear.
const loadFnSrc = dashboard.match(/async function loadBuiltInInventoryItems\(\)\{[\s\S]*?\n\}\n/)[0];
assert.match(loadFnSrc, /const PAGE = 1000;/, 'loadBuiltInInventoryItems must page in fixed-size batches');
assert.match(loadFnSrc, /\.range\(offset, offset \+ PAGE - 1\)/, 'loadBuiltInInventoryItems must use .range() pagination, not a single .limit()');
assert.match(loadFnSrc, /if\(!data \|\| data\.length < PAGE\) break;/, 'the pagination loop must stop on a short page, not an arbitrary fixed count');

console.log('Inventory load pagination (worker+dashboard) contract checks passed');

// ── Contract: refreshBuiltInInventoryDelta pages BOTH the changed-rows query
// and the id-only deletion-detection manifest. The manifest cap was the
// worse bug: real, still-existing items past the cap were actively removed
// from `all` every 60s because their id never appeared in an incomplete
// manifest, not merely absent from a fresh load.
const deltaFnSrc = dashboard.match(/async function refreshBuiltInInventoryDelta\(\)\{[\s\S]*?\n  return true;\n\}\n/)[0];
assert.match(deltaFnSrc, /const manifest = \[\];/, 'the deletion-detection manifest must be accumulated across pages');
assert.match(deltaFnSrc, /const changedRows = \[\];/, 'the changed-rows query must be accumulated across pages too');
assert.match(deltaFnSrc, /\.range\(manifestOffset, manifestOffset \+ PAGE - 1\)/, 'the manifest query must use .range() pagination, not a single .limit()');
assert.match(deltaFnSrc, /\.range\(changedOffset, changedOffset \+ PAGE - 1\)/, 'the changed-rows query must use .range() pagination, not a single .limit()');

console.log('Delta refresh pagination contract checks passed');

// ── Contract: the public storefront worker route pages instead of a single
// limit=1000 page, matching the same fix applied client-side.
const storefrontRouteSrc = worker.slice(worker.indexOf("url.pathname === '/public/storefront' && request.method === 'GET'"), worker.indexOf("GET /public/storefront/item"));
assert.match(storefrontRouteSrc, /let storefrontOffset = 0;/, 'the public storefront route must paginate through inventory_items');
assert.match(storefrontRouteSrc, /if \(batch\.length < 1000\) break;/, 'the storefront pagination loop must stop on a short page');
assert.doesNotMatch(storefrontRouteSrc, /&limit=1000`\);/, 'the old single-shot limit=1000 query (with no offset loop) must be gone');

console.log('Public storefront route pagination contract checks passed');

// ── Functional: reimplement the shared "page until a short page comes back"
// algorithm all three fixes use, and verify it against a mock paged source
// for the cases that actually matter: empty, exactly-one-page, and
// multi-page results, plus that it never infinite-loops on an error.
async function pageAll(fetchPage, PAGE){
  const rows = [];
  let offset = 0;
  while(true){
    const { data, error } = await fetchPage(offset, PAGE);
    if(error) break;
    rows.push(...(data || []));
    if(!data || data.length < PAGE) break;
    offset += PAGE;
  }
  return rows;
}

function makeMockSource(totalRows){
  const all = Array.from({ length: totalRows }, (_, i) => ({ id: i }));
  return async (offset, page) => ({ data: all.slice(offset, offset + page), error: null });
}

const empty = await pageAll(makeMockSource(0), 1000);
assert.equal(empty.length, 0, 'an empty store must return zero rows without looping');

const onePage = await pageAll(makeMockSource(500), 1000);
assert.equal(onePage.length, 500, 'a store under the page size must return all its rows in one page');

const exactlyOnePage = await pageAll(makeMockSource(1000), 1000);
assert.equal(exactlyOnePage.length, 1000, 'a store exactly at the page size must still fetch a (possibly empty) next page and get all rows');

const multiPage = await pageAll(makeMockSource(2500), 1000);
assert.equal(multiPage.length, 2500, 'a store well past the old 1000/2000-row caps must get every row across multiple pages -- this is the exact scenario that used to silently drop or "delete" real inventory');
assert.deepEqual(multiPage.map(r => r.id), Array.from({ length: 2500 }, (_, i) => i), 'pages must be assembled in order with no gaps or duplicates');

let calls = 0;
const erroring = async () => { calls++; return { data: null, error: new Error('boom') }; };
const afterError = await pageAll(erroring, 1000);
assert.equal(afterError.length, 0, 'an error must stop pagination cleanly, not throw or hang');
assert.equal(calls, 1, 'an error on the first page must not retry forever');

console.log('Pagination algorithm functional checks passed');
