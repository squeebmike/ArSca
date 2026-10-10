import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store report: "Why doesn't the cash bag balance? We had a trade and paid
// out money -- maybe the Treecko purchase with the trade-in?" A $63.50
// trade-in put $11 toward a Treecko and the customer was paid the rest in
// cash, but the Cash Bag never recorded that payout: checkout keeps the
// trade's full value on the tender line, the saved payment row only keeps
// what was applied, and the leftover was worked out from the payment row --
// $11 - $11 = $0, so nothing was taken out of the bag's expected cash.
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const extractFn = (name, prefix = 'function ') => { const s = dashboard.indexOf(prefix + name + '('); assert.ok(s >= 0, name); return dashboard.slice(s, dashboard.indexOf('\n}\n', s) + 2); };

let n = 0;
const build = new Function('makeUuid', 'getCurrentUserId', 'normalizeTenderType',
  extractFn('buildLedgerBundle') + '\nreturn buildLedgerBundle;')(
  p => p + '-' + (++n), () => 'staff', m => String(m || '').toLowerCase());
const snapshot = { id:'snap', store_id:'store-1', drawer_session_id:'drawer-1', subtotal:11, discount_total:0, tax_total:0, total:11, lines:[{ item_id:'treecko', title:'Treecko - 055', quantity:1, unit_price:11, adjusted_price:11 }] };
const tender = [
  { method:'trade_credit', amount:11, reference:'trade-48a0', fullAmount:63.5, customerName:'Walk-in trade BFBU' },
  { method:'cash', amount:0, reference:'received:0.00 change:0.00' },
];
const bundle = build(snapshot, tender);
assert.deepEqual(bundle.tradeTenders.map(t => ({ ...t })), [{ reference:'trade-48a0', applied:11, fullAmount:63.5, customerName:'Walk-in trade BFBU' }], 'the trade-in\'s full value stays with the sale');
assert.equal(Object.keys(bundle).includes('tradeTenders'), false, 'but it isn\'t part of what\'s saved');
assert.equal(JSON.parse(JSON.stringify(bundle)).tradeTenders, undefined, 'nor of what\'s queued offline');
assert.deepEqual(bundle.payments.map(p => [p.method, p.amount]), [['trade_credit', 11], ['cash', 0]], 'payment rows are unchanged');
assert.ok(!('fullAmount' in bundle.payments[0]), 'a payment row still has only real columns');

// The leftover is worked out from the trade's full value.
const finalize = dashboard.slice(dashboard.indexOf('bundle.payments.filter(p => normalizeTenderType(p.method) === \'trade_credit\' && p.reference)'));
assert.match(finalize.slice(0, 1200), /const trade = \(bundle\.tradeTenders \|\| \[\]\)\.find\(t => t\.reference === p\.reference\);\n\s*const leftover = Math\.max\(0, Math\.round\(\(Number\(trade\?\.fullAmount \?\? p\.fullAmount \?\? p\.amount \?\? 0\) - Number\(p\.amount \|\| 0\)\) \* 100\) \/ 100\);\n\s*payTradeInLeftoverAsCash\(leftover, \{ customerName:trade\?\.customerName \|\| p\.customerName \|\| '' \}\);/);
{
  const trade = bundle.tradeTenders[0], p = bundle.payments[0];
  assert.equal(Math.max(0, Math.round((Number(trade.fullAmount) - Number(p.amount)) * 100) / 100), 52.5, 'the Treecko trade: $52.50 back in cash');
}

// And recorded in the Cash Bag (or the cashier is told to when none is open).
{
  const moves = [], toasts = [];
  const load = drawerState => new Function('drawerState', 'saveDrawer', 'renderDrawer', 'makeUuid', 'getActiveStoreId', 'getCurrentUserId', 'MoneyLedgerService', 'enqueueSync', 'toast_dash',
    extractFn('payTradeInLeftoverAsCash') + '\nreturn payTradeInLeftoverAsCash;')(
    drawerState, () => {}, () => {}, p => p + '-x', () => 'store-1', () => 'staff',
    () => ({ writeDrawerMovement:async m => { moves.push(m); } }), () => {}, m => toasts.push(m));
  const bag = { id:'drawer-1', expectedCash:629, log:[] };
  load(bag)(52.5, { customerName:'Walk-in trade BFBU' });
  assert.equal(bag.expectedCash, 576.5, 'the bag now expects $629 - $52.50');
  assert.equal(bag.log[0].type, 'trade_in_cash_payout');
  assert.equal(moves[0].movement_type, 'trade_in_cash_payout');
  assert.equal(moves[0].amount, -52.5);
  assert.match(toasts[0], /Pay the customer \$52\.50 cash/);
  load(null)(10, {});
  assert.match(toasts[1], /no Cash Bag is open/, 'with no bag open the cashier is still told to pay it');
  load(bag)(0, {});
  assert.equal(toasts.length, 2, 'no leftover, nothing to pay');
}
console.log('Trade-in leftover cash payout checks passed');
