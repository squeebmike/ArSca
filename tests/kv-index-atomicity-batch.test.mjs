import fs from 'node:fs';
import assert from 'node:assert/strict';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: buy-trays-index has the same atomic upsert/remove shape as the
// already-fixed sale-cart-index ──
const buyTraysRouteSrc = worker.slice(worker.indexOf("url.pathname === '/kv/buy-trays-index/upsert'"), worker.indexOf("url.pathname === '/kv/show-sessions-index/upsert'"));
assert.match(buyTraysRouteSrc, /const raw = env\.LBA_KV \? await env\.LBA_KV\.get\(scopedKey\) : \(globalThis\['_' \+ scopedKey\] \|\| null\);/, 'buy-trays-index must read the current server state inside the same Worker request');
assert.match(buyTraysRouteSrc, /if \(idx >= 0\) index\[idx\] = entry; else index\.push\(entry\);/, 'buy-trays-index upsert must replace-by-id or append, matching the previous client-side logic');
assert.match(buyTraysRouteSrc, /index = index\.filter\(e => e\.id !== id\);/, 'buy-trays-index remove must filter out the given id');

console.log('Buy-trays-index atomic route contract checks passed');

// ── Contract: show-sessions-index atomic upsert (no remove -- shows are
// closed via a status update through the same upsert path, matching prior
// client behavior) ──
const showSessionsRouteSrc = worker.slice(worker.indexOf("url.pathname === '/kv/show-sessions-index/upsert'"), worker.indexOf("inventory_lifecycle is a single shared"));
assert.match(showSessionsRouteSrc, /if \(idx >= 0\) index\[idx\] = entry; else index\.unshift\(entry\);/, 'show-sessions-index upsert must preserve the prior unshift-new-entries ordering');
assert.match(showSessionsRouteSrc, /index = index\.filter\(row => row\?\.id\)\.slice\(0, 100\)/, 'show-sessions-index must keep the previous filter+cap behavior');

console.log('Show-sessions-index atomic route contract checks passed');

// ── Contract: inventory-lifecycle merges a patch instead of overwriting the
// whole shared map -- this was the worst of the three races, since a plain
// full-map POST on every single status change could wipe out ANY key the
// posting device didn't already know about, not just the one it just set ──
const lifecycleRouteSrc = worker.slice(worker.indexOf("url.pathname === '/kv/inventory-lifecycle/merge'"), worker.indexOf("url.pathname === '/kv/inventory-lifecycle/merge'") + 1600);
assert.match(lifecycleRouteSrc, /Object\.assign\(map, patch\);/, 'inventory-lifecycle/merge must merge the patch onto the current server map, not replace it wholesale');
assert.match(lifecycleRouteSrc, /if \(!patch \|\| typeof patch !== 'object' \|\| Array\.isArray\(patch\) \|\| !Object\.keys\(patch\)\.length\)/, 'a missing/malformed/empty patch must be rejected rather than silently no-op merged');

console.log('Inventory-lifecycle merge route contract checks passed');

// ── Contract: the dashboard client calls the new atomic routes instead of
// the old GET-modify-POST-whole-blob pattern ──
assert.match(dashboard, /storeWorkerFetch\(scopedWorkerPath\('\/kv\/buy-trays-index\/upsert'\)/, 'upsertBuyTrayIndexEntry must call the new atomic upsert route');
assert.match(dashboard, /storeWorkerFetch\(scopedWorkerPath\('\/kv\/buy-trays-index\/remove'\)/, 'removeBuyTrayFromIndex must call the new atomic remove route');
assert.match(dashboard, /storeWorkerFetch\(scopedWorkerPath\('\/kv\/show-sessions-index\/upsert'\)/, 'publishShowSession must call the new atomic upsert route');
assert.match(dashboard, /storeWorkerFetch\(scopedWorkerPath\('\/kv\/inventory-lifecycle\/merge'\)/, 'saveLifecycleMap must call the new atomic merge route');
assert.doesNotMatch(dashboard, /await storeWorkerFetch\(scopedWorkerPath\('\/kv\/buy_trays_index'\), \{ signal: AbortSignal\.timeout\(4000\) \}\);\s*\n\s*const d = await r\.json\(\);\s*\n\s*let index = \[\];\s*\n\s*try \{ index = JSON\.parse\(d\?\.value \|\| '\[\]'\); \} catch\(e\) \{ index = \[\]; \}\s*\n\s*if\(!Array\.isArray\(index\)\) index = \[\];\s*\n\s*const entry = \{/, 'the old racy client-side GET-then-splice-then-POST pattern must be gone from upsertBuyTrayIndexEntry');

console.log('Dashboard client-side atomic route wiring contract checks passed');

// ── Contract: a single-item lifecycle change sends only that one key as the
// patch, and a bulk action sends every key it actually touched, not the
// entire cumulative local map ──
const setLifecycleSrc = dashboard.match(/function setLifecycle\(id, state, silent\)\{[\s\S]*?\n\}\n/)[0];
assert.match(setLifecycleSrc, /saveLifecycleMap\(map, \{ \[id\]: state \}\);/, 'setLifecycle must send a one-key patch, not the whole map');
const markAllVisibleSrc = dashboard.match(/function markAllVisibleAtShow\(\)\{[\s\S]*?\n\}\n/)[0];
assert.match(markAllVisibleSrc, /const patch = \{\};/, 'markAllVisibleAtShow must build a patch of only the items it touches');
assert.match(markAllVisibleSrc, /saveLifecycleMap\(map, patch\);/, 'markAllVisibleAtShow must send its patch, not the whole map, to the merge route');

console.log('Lifecycle patch-building contract checks passed');

// ── Functional: reimplement the atomic array-index algorithm and verify it
// converges correctly when two "devices" race -- this is the actual bug
// class fixed. A naive client-side GET-modify-POST would lose one device's
// change; doing it inside one server-side call must preserve both.
function applyIndexOp(serverIndexJson, op){
  let index = [];
  try { index = JSON.parse(serverIndexJson || '[]'); } catch (e) { index = []; }
  if (!Array.isArray(index)) index = [];
  if (op.type === 'upsert') {
    const idx = index.findIndex(e => e.id === op.entry.id);
    if (idx >= 0) index[idx] = op.entry; else index.push(op.entry);
  } else {
    index = index.filter(e => e.id !== op.id);
  }
  return JSON.stringify(index);
}

let serverState = '[]';
// Device A upserts tray "tray-1", THEN (server-side, atomically) device B
// upserts a completely different tray "tray-2" -- both must survive, since
// each op reads the state left by the previous op, not a stale snapshot.
serverState = applyIndexOp(serverState, { type:'upsert', entry:{ id:'tray-1', status:'open' } });
serverState = applyIndexOp(serverState, { type:'upsert', entry:{ id:'tray-2', status:'open' } });
assert.deepEqual(JSON.parse(serverState).map(e => e.id).sort(), ['tray-1', 'tray-2'], 'two different devices upserting different trays must both be preserved');

// Closing tray-1 (remove) must not disturb tray-2, and must not "come back"
// on a later stale re-apply -- this is the exact pop-back-in bug class.
serverState = applyIndexOp(serverState, { type:'remove', id:'tray-1' });
assert.deepEqual(JSON.parse(serverState).map(e => e.id), ['tray-2'], 'removing one tray must not affect an unrelated open tray');

console.log('Atomic array-index functional checks passed');

// ── Functional: reimplement the lifecycle merge algorithm and verify a
// patch-based merge preserves keys a full-map overwrite would have wiped ──
function mergeLifecyclePatch(serverMapJson, patch){
  let map = {};
  try { map = JSON.parse(serverMapJson || '{}'); } catch (e) { map = {}; }
  if (!map || typeof map !== 'object' || Array.isArray(map)) map = {};
  Object.assign(map, patch);
  return JSON.stringify(map);
}

let lifecycleServerState = JSON.stringify({ 'item-a': 'in_stock' });
// Device 1 (which has never seen item-b) sets item-a to at_show.
lifecycleServerState = mergeLifecyclePatch(lifecycleServerState, { 'item-a': 'at_show' });
// Device 2, concurrently, sets item-b (which device 1 never touched).
lifecycleServerState = mergeLifecyclePatch(lifecycleServerState, { 'item-b': 'sold' });
const finalMap = JSON.parse(lifecycleServerState);
assert.equal(finalMap['item-a'], 'at_show', 'device 1\'s change must survive device 2\'s later merge');
assert.equal(finalMap['item-b'], 'sold', 'device 2\'s change must be present too -- the old full-map-overwrite design could have wiped either depending on write order');

// ── Functional: the offline-queue patch-merge (saveLifecycleMap's catch
// handler) must accumulate multiple failed writes into one patch instead of
// the later enqueueOrReplaceSync call discarding the earlier one's keys.
function mergeQueuedPatch(existingPatch, newPatch){
  return { ...(existingPatch || {}), ...newPatch };
}
let queuedPatch = null;
queuedPatch = mergeQueuedPatch(queuedPatch, { 'item-a': 'at_show' });
queuedPatch = mergeQueuedPatch(queuedPatch, { 'item-c': 'sold' });
assert.deepEqual(queuedPatch, { 'item-a':'at_show', 'item-c':'sold' }, 'two offline lifecycle changes queued back to back must both survive in the merged retry payload');

console.log('Lifecycle merge functional checks passed');
