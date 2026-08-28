import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store report: a batch of newly-bought cards never showed up on
// themanapocket.com -- new inventory defaults to onlineListed:false on
// purpose (nothing goes live before a photo/price review), but the only
// way to publish it was a one-at-a-time toggle buried in each row's menu.
// Buying a whole lot of the same category made that a real chore. This
// adds a "PUBLISH THIS VIEW" bulk action matching the existing LABEL THIS
// VIEW/LOOK UP THIS VIEW pattern: act on whatever the search box + category
// chip currently show, instead of clicking through every row.
assert.match(dashboard, /async function publishFilteredToStorefrontView\(\)\{/, 'missing publishFilteredToStorefrontView');
{
  const fnStart = dashboard.indexOf('async function publishFilteredToStorefrontView(){');
  const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
  const fn = dashboard.slice(fnStart, fnEnd);
  assert.match(fn, /i\.status === 'in_stock' && i\.onlineListed === false/, 'must only act on in-stock items that are actually unpublished, not re-touch already-published or sold/archived rows');
  assert.match(fn, /await saveInventoryEdit\(item, \{ onlineListed:true \}\);/, 'must actually publish each matched item via the same save path the single-item toggle uses');
  assert.match(fn, /if\(!confirm\(/, 'a bulk publish action must confirm first, same as other filtered-view bulk actions in this app');
}
assert.match(dashboard, /onclick="publishFilteredToStorefrontView\(\)"[^>]*>🌐 PUBLISH THIS VIEW<\/button>/, 'the toolbar must expose a button to trigger the bulk publish action');

console.log('Bulk publish-to-storefront contract checks passed');
