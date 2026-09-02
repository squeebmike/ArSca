import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store report: deleting an item from the buy tray on one device still
// showed it on another device. Root cause, found by tracing the actual
// mechanism (not guessed): fetchBuyListFromWorker only ever merged items
// IN from the server copy, it never removed a local item the server copy
// no longer had. buyListTombstones (an in-memory, per-device Map) only
// ever protected the device that did the delete from its own race with an
// in-flight fetch -- it was never transmitted, so a genuine deletion never
// reached any other device at all. This is the exact same class of bug
// tests/sale-cart-merge-repush.test.mjs already found and fixed for the
// sale cart (removedLineIds, merged and re-pushed by
// fetchActiveSaleCartFromWorker) -- the buy tray needed the same fix.

assert.match(dashboard, /removedIds: \[\],/, 'a new buy tray record must start with a persisted (not just in-memory) removed-ids list');

const removeBuyItemStart = dashboard.indexOf('function removeBuyItem(id){');
const removeBuyItemEnd = dashboard.indexOf('\nfunction updateBuyItem', removeBuyItemStart);
const removeBuyItemBody = dashboard.slice(removeBuyItemStart, removeBuyItemEnd);
assert.ok(removeBuyItemStart !== -1, 'removeBuyItem must exist');
assert.match(removeBuyItemBody, /tray\.removedIds = \[\.\.\.\(tray\.removedIds \|\| \[\]\)\.filter\(r => r\.id !== id\), \{ id, at: Date\.now\(\) \}\];/,
  'removing an item must record it on the tray\'s persisted removedIds, not just the local in-memory tombstone');
assert.match(removeBuyItemBody, /upsertLocalBuyTray\(tray\);/, 'the persisted removal record must actually be saved before syncing');

const fetchStart = dashboard.indexOf('async function fetchBuyListFromWorker(){');
const fetchEnd = dashboard.indexOf('\n\n// Shared "what trays are open right now"', fetchStart);
const fetchBody = dashboard.slice(fetchStart, fetchEnd);
assert.ok(fetchStart !== -1, 'fetchBuyListFromWorker must exist');
assert.match(fetchBody, /const remoteRemovedIds = Array\.isArray\(remote\.removedIds\) \? remote\.removedIds : \[\];/,
  'must read the removed-ids the server copy carries, not just its items');
assert.match(fetchBody, /buyList = buyList\.filter\(i => !removedIdSet\.has\(i\.id\)\);/,
  'a local item whose id is in the merged removed set must actually be dropped -- this is the fix itself');
assert.match(fetchBody, /if\(!item\?\.id \|\| localIds\.has\(item\.id\) \|\| buyListTombstones\.has\(item\.id\) \|\| removedIdSet\.has\(item\.id\)\) continue;/,
  'a remote item must not be re-added if it is in the merged removed set, or a removal could resurrect itself the next tick');
assert.match(fetchBody, /syncBuyListToWorker\(\); \/\/ push the merged union \(items \+ removedIds\) back so every device converges/,
  'the merged removedIds must be pushed back, or a device three hops away from the original delete would never learn about it');

console.log('Buy tray removed-ids cross-device sync contract checks passed');

// ── Functional: the merge/prune logic itself, independent of DOM/network ──
const BUY_REMOVED_ID_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
function mergeRemovedIds(localRemovedIds, remoteRemovedIds, now) {
  const merged = new Map();
  [...localRemovedIds, ...remoteRemovedIds].forEach(r => {
    if (!r?.id || now - Number(r.at || 0) > BUY_REMOVED_ID_RETENTION_MS) return;
    const existing = merged.get(r.id);
    if (!existing || Number(r.at || 0) > Number(existing.at || 0)) merged.set(r.id, r);
  });
  return merged;
}
function applyRemoval(buyList, removedIdSet) {
  return buyList.filter(i => !removedIdSet.has(i.id));
}

{
  // Device A deleted item "x" and pushed it to the server. Device B still
  // has "x" locally from before the delete -- its next fetch must drop it.
  const now = Date.now();
  const remoteRemovedIds = [{ id: 'x', at: now }];
  const merged = mergeRemovedIds([], remoteRemovedIds, now);
  const localBuyList = [{ id: 'x', name: 'Amazing Spider-Man #1' }, { id: 'y', name: 'Batman #1' }];
  const result = applyRemoval(localBuyList, new Set(merged.keys()));
  assert.deepEqual(result.map(i => i.id), ['y'], 'an item removed on another device must actually disappear from this device\'s list on the next sync');
}

{
  // A stale removal record (older than the retention window) must not keep
  // suppressing an item forever -- e.g. a genuinely re-added item with the
  // same id long after the original delete should be allowed back.
  const now = Date.now();
  const staleRemovedIds = [{ id: 'x', at: now - BUY_REMOVED_ID_RETENTION_MS - 1000 }];
  const merged = mergeRemovedIds([], staleRemovedIds, now);
  assert.equal(merged.size, 0, 'a removal record past the retention window must be pruned, not kept forever');
}

{
  // Two devices both know about different removals -- the union must keep
  // both, not just whichever one this device already knew about.
  const now = Date.now();
  const local = [{ id: 'a', at: now - 1000 }];
  const remote = [{ id: 'b', at: now - 500 }];
  const merged = mergeRemovedIds(local, remote, now);
  assert.deepEqual([...merged.keys()].sort(), ['a', 'b'], 'removals known to either device must both survive the merge');
}

console.log('Buy tray removed-ids merge/prune functional checks passed');
