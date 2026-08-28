import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store report: cash bags, shows, and buy trays all sync across devices, but
// a sale cart joined by two registers could silently diverge -- one
// register's item never showed up on the other, or vanished again a moment
// later. Root cause, found by tracing the actual mechanism (not guessed):
// fetchActiveSaleCartFromWorker() already merges the local and remote copies
// of a joined cart client-side (by line id/timestamp) so the SCREEN that
// just pulled shows the right thing -- but it never pushed that merge back
// to the worker. The cart body itself is written via a blind KV overwrite
// (only the shared index got the server-side atomic-ish read-modify-write
// treatment, not individual cart/tray/show bodies), so the very next plain
// item-add on EITHER register would silently clobber whatever the other
// register had just contributed, with the correct merged state never
// existing anywhere but one device's screen for one moment. Buy trays
// already solved this exact problem (fetchBuyListFromWorker re-pushes its
// merged union "so every device converges on the same list") -- this brings
// carts in line with that proven pattern.
assert.match(dashboard, /async function fetchActiveSaleCartFromWorker\(\)\{/, 'missing fetchActiveSaleCartFromWorker');
{
  const fnStart = dashboard.indexOf('async function fetchActiveSaleCartFromWorker(){');
  const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
  const fn = dashboard.slice(fnStart, fnEnd);
  assert.match(fn, /let mergedChanged = false;/, 'must track whether the merge actually pulled in new information');
  assert.match(fn, /if\(mergedChanged\) syncActiveSaleCartToWorker\(merged\)\.catch\(\(\) => \{\}\);/,
    'must push the merged cart back to the worker when the merge found something the local copy did not already have, or the merge only ever exists on one device\'s screen for a moment');
  assert.match(fn, /mergedChanged = merged\.items\.length !== localItemIds\.size/,
    'the changed-detection must actually compare against what was locally known before the merge');
}

console.log('fetchActiveSaleCartFromWorker merge-repush contract check passed');

// ── Functional: verify the changed-detection logic itself is correct,
// independent of DOM/network state ──
{
  function computeMergedChanged(local, merged) {
    const localItemIds = new Set((local.items || []).map(i => i.id || i.cartLineId));
    return merged.items.length !== localItemIds.size
      || merged.items.some(i => !localItemIds.has(i.id || i.cartLineId))
      || merged.removedLineIds.length !== (local.removedLineIds || []).length;
  }

  // Nothing new: local already had everything the merge produced.
  assert.equal(
    computeMergedChanged(
      { items: [{ id: 'a' }], removedLineIds: [] },
      { items: [{ id: 'a' }], removedLineIds: [] },
    ),
    false,
    'an unchanged merge must not trigger a re-push'
  );

  // The other register added a line this device never had.
  assert.equal(
    computeMergedChanged(
      { items: [{ id: 'a' }], removedLineIds: [] },
      { items: [{ id: 'a' }, { id: 'b' }], removedLineIds: [] },
    ),
    true,
    'a merge that pulled in a line only the other register had must trigger a re-push'
  );

  // The other register removed a line.
  assert.equal(
    computeMergedChanged(
      { items: [{ id: 'a' }], removedLineIds: [] },
      { items: [], removedLineIds: ['a'] },
    ),
    true,
    'a merge that picked up a removal from the other register must trigger a re-push'
  );
}

console.log('mergedChanged functional checks passed');
