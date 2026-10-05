import assert from 'node:assert/strict';
import fs from 'node:fs';

// Store policy: trade-in value equals the cash offer, it only ever applies to
// that visit's purchase (leftover paid in cash), and there are no saved
// trade-credit balances anywhere.
const d = fs.readFileSync('dashboard.html', 'utf8');
assert.match(d, /tradeCreditOffer:buyItemOfferValue\(i, pctOverride\),/, 'item trade value = cash offer');
assert.match(d, /const tradeCreditTotal = cashOfferTotal;/, 'session trade total = cash total');
assert.match(d, /const payTotal = frozen\.offerTotal;/, 'the confirm screen shows the same amount for trade and buy');
assert.ok(!/(?:offerTotal|cashOfferTotal|pctOverride\)) \* 1\.15|defaultBonusMultiplier|TRADE BONUS/.test(d), 'no trade bonus left anywhere');
assert.match(d, /if\(result\.credit\) applyToPurchase = true;/, 'ISSUE TRADE CREDIT must put the credit on the sale, not drop it');
assert.ok(!/^\s+ensureStoreCreditPanel\(backoffice\);/m.test(d), 'no saved store-credit panel in the back office');
const sf = fs.readFileSync('storefront.html', 'utf8');
assert.ok(!/tradeCreditBalance/.test(sf), 'the customer account page shows no trade credit balance');

// Costs: "For a show" lists shows that had sales in the last 90 days, even
// when the shared show list has dropped them.
const ex = fs.readFileSync('scripts/expenses.js', 'utf8');
assert.match(ex, /from\('pos_sales'\)\.select\('show_session_id,completed_at'\)/, 'shows come from recent sales too');
assert.match(ex, /scopedWorkerPath\('\/kv\/show_session_' \+ id\)/, 'a show\'s saved name is looked up');
assert.match(ex, /var d = Date\.parse\(sh\.lastAt \|\| sh\.startedAt \|\| ''\);/, 'labeled by the last sale date');
console.log('Trade-in and expense show checks passed');
