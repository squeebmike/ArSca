import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: the background index poll is sequence-guarded, same pattern
// fetchActiveSaleCartFromWorker already uses for cart contents ──
assert.match(dashboard, /let _saleCartIndexFetchSeq = 0;/, 'a sequence counter must guard the sale-cart-index poll');
assert.match(dashboard, /async function fetchSaleCartIndex\(showToast=false\)\{\s*\n\s*const seq = \+\+_saleCartIndexFetchSeq;/, 'fetchSaleCartIndex must capture its own sequence number before the network round trip');
assert.match(dashboard, /if\(seq !== _saleCartIndexFetchSeq\) return knownSaleCartIndex;/, 'a stale (superseded) fetch response must be discarded instead of overwriting knownSaleCartIndex');

// ── Contract: every authoritative local write also bumps the sequence, so an
// in-flight poll started BEFORE a close/remove/upsert can't win the race ──
const upsertFnSrc = dashboard.match(/async function upsertSaleCartIndexEntry\(cart\)\{[\s\S]*?\n\}\n/)[0];
const removeFnSrc = dashboard.match(/async function removeSaleCartFromIndex\(id\)\{[\s\S]*?\n\}\n/)[0];
assert.match(upsertFnSrc, /_saleCartIndexFetchSeq\+\+;/, 'upsertSaleCartIndexEntry must invalidate in-flight polls when it writes an authoritative index');
assert.match(removeFnSrc, /_saleCartIndexFetchSeq\+\+;/, 'removeSaleCartFromIndex must invalidate in-flight polls when it writes an authoritative index -- this is the exact path closeActiveSaleCart/closeSaleCartById/completeActiveSaleCartAfterCheckout all go through');

console.log('Sale cart index poll-race contract checks passed');

// ── Functional: reproduce the exact race a customer hit -- close a cart,
// then let an OLDER in-flight index fetch (started before the close) resolve
// AFTER it. Without the sequence guard this overwrites the correct
// post-close state with the stale pre-close list, making the just-closed
// cart "pop back in". With the guard, the stale response must be dropped.
function makeIndexPoller(){
  let seqCounter = 0;
  let knownIndex = [{ id:'cart-1', status:'open' }, { id:'cart-2', status:'open' }];

  function bumpOnLocalWrite(){ seqCounter++; }

  // Mirrors fetchSaleCartIndex's shape: capture seq, "await" a response later
  // (simulated as a resolved promise passed in), apply only if not stale.
  function startFetch(){
    return { seq: ++seqCounter };
  }
  function applyFetchResult(pending, serverIndex){
    if(pending.seq !== seqCounter) return knownIndex; // stale -- discarded
    knownIndex = serverIndex.filter(e => e.status === 'open');
    return knownIndex;
  }
  function localRemove(id){
    bumpOnLocalWrite();
    knownIndex = knownIndex.filter(e => e.id !== id);
  }
  return { startFetch, applyFetchResult, localRemove, getIndex:() => knownIndex };
}

const poller = makeIndexPoller();
// T0: a background poll starts while the index still has both carts open.
const staleFetch = poller.startFetch();
const staleServerSnapshot = [{ id:'cart-1', status:'open' }, { id:'cart-2', status:'open' }];

// T1: user closes cart-1 (real local action -- bumps the sequence).
poller.localRemove('cart-1');
assert.deepEqual(poller.getIndex().map(e => e.id), ['cart-2'], 'closing cart-1 must remove it from the local index immediately');

// T2: the stale poll from T0 finally resolves, carrying the pre-close list.
const afterStaleApply = poller.applyFetchResult(staleFetch, staleServerSnapshot);
assert.deepEqual(afterStaleApply.map(e => e.id), ['cart-2'], 'a stale poll response must NOT resurrect the just-closed cart');

// T3: a fresh poll started AFTER the close correctly reflects the removal and must still apply.
const freshFetch = poller.startFetch();
const freshServerSnapshot = [{ id:'cart-2', status:'open' }];
const afterFreshApply = poller.applyFetchResult(freshFetch, freshServerSnapshot);
assert.deepEqual(afterFreshApply.map(e => e.id), ['cart-2'], 'a poll started after the close must still be applied normally');

console.log('Sale cart index poll-race functional checks passed');
