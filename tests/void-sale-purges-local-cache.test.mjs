import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync('dashboard.html', 'utf8');

// Store report: Overview's "all time" ITEMS SOLD/revenue/profit stat cards
// ran ahead of the Reports tab's live numbers. Root cause traced to
// confirmVoidSale() -- voiding a sale flips its status server-side and is
// correctly excluded by every live Supabase query (Reports, and
// syncSharedShowTransactions's own .in('status',['completed','succeeded'])
// pull), but the LOCAL pos_transactions cache that Overview/Sold-table read
// from was never told about the void: the row just sat there forever,
// still counted as real revenue. This guards the fix: voiding a sale must
// purge its row from the local cache on the device performing the void.
//
// Known remaining gap, not fixed here: this only purges the local cache on
// the device that clicks void. A different device's local cache keeps the
// stale row until it happens to rebuild pos_transactions from scratch --
// syncSharedShowTransactions merges cloud rows in additively (new/updated
// only) and never prunes a row that's disappeared from the live query.
// Cross-device void propagation is a separate, larger gap than what was
// asked for here.

const fnStart = html.indexOf('async function confirmVoidSale(');
const fnEnd = html.indexOf('\n// Tab switching', fnStart);
const fnBody = html.slice(fnStart, fnEnd);

assert.ok(fnStart !== -1, 'confirmVoidSale must exist');
assert.match(fnBody, /const txLog = safeLocalJson\('pos_transactions', \[\]\);/, 'must read the local transaction cache');
assert.match(fnBody, /const withoutVoided = txLog\.filter\(t => String\(t\.id\) !== String\(saleId\)\);/, 'must filter out the row matching the voided sale id');
assert.match(fnBody, /localStorage\.setItem\('pos_transactions', JSON\.stringify\(withoutVoided\)\);/, 'must actually persist the purge back to localStorage');

// The purge must happen before the stats re-render, or the void would show
// stale numbers for one more render cycle.
{
  const purgeIdx = fnBody.indexOf("localStorage.setItem('pos_transactions', JSON.stringify(withoutVoided))");
  const renderIdx = fnBody.indexOf('renderStats(); renderTodayMode(); renderSoldTable();');
  assert.ok(purgeIdx !== -1 && renderIdx !== -1 && purgeIdx < renderIdx,
    'the local cache purge must happen before renderStats()/renderSoldTable() re-render, or the void would still show stale numbers once');
}

console.log('Void-sale local cache purge contract check passed');
