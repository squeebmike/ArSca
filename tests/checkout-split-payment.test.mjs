import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store ask: "How to do partial payment, ie some cash some card Venmo etc."
// A sale can now be paid in parts: each part is its own tender line, and the
// sale completes once the parts add up to the total.
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const extractFn = (name, prefix = 'function ') => { const s = dashboard.indexOf(prefix + name + '('); assert.ok(s >= 0, name); return dashboard.slice(s, dashboard.indexOf('\n}\n', s) + 2); };

function load({ total, prior = [] }) {
  const fields = {}, calls = { completed:0, toasts:[], rendered:0 };
  const el = id => fields[id] ? { value:fields[id], innerHTML:'', classList:{ add(){} } } : (id === 'customer-payment-workbench' ? (calls.wb = calls.wb || { innerHTML:'', classList:{ add(){} } }) : null);
  const api = new Function('document', 'toast_dash', 'escHtml', 'formatTenderLabel', 'logOpsEvent', 'renderCustomerDisplaySnapshot', 'completeLockedCheckout', 'calls', [
    'let checkoutFinalizing = false, checkoutState = "", lockedCheckoutSnapshot = ' + JSON.stringify({ id:'snap', total }) + ';',
    'let selectedTenderLines = ' + JSON.stringify(prior) + ';',
    'const CHECKOUT_STATES = { PAYMENT_METHOD_SELECTED:"selected", PAYMENT_PENDING:"pending" };',
    extractFn('isSplitTenderMethod'), extractFn('roundCents'), extractFn('readSplitPartAmount'), extractFn('splitPaymentsSoFarHtml'),
    extractFn('remainingCheckoutDue'), extractFn('confirmLockedPayment', 'async function '),
    'return { confirmLockedPayment, remainingCheckoutDue, splitPaymentsSoFarHtml, lines:() => selectedTenderLines, state:() => checkoutState };',
  ].join('\n'))(
    { getElementById:el }, m => calls.toasts.push(m), v => String(v), m => ({ cash:'Cash', venmo:'Venmo', card:'Card / Stripe', trade_credit:'Trade Credit' })[m] || m,
    () => {}, () => { calls.rendered++; }, async () => { calls.completed++; }, calls);
  return { ...api, fields, calls };
}

// ── $50 sale: $20 cash, then $30 Venmo ──
{
  const c = load({ total:50 });
  c.fields['split-part-amount'] = '20';
  c.fields['locked-cash-received'] = '25';
  await c.confirmLockedPayment('cash');
  assert.deepEqual(c.lines().map(t => [t.method, t.amount, t.reference]), [['cash', 20, 'received:25.00 change:5.00']], 'cash part, with change worked out on the part');
  assert.equal(c.calls.completed, 0, 'not finished -- $30 still due');
  assert.equal(c.remainingCheckoutDue(), 30);
  assert.equal(c.state(), 'selected');
  assert.match(c.calls.toasts.at(-1), /Cash \$20\.00 taken -- \$30\.00 still due/);
  assert.match(c.calls.wb.innerHTML, /PAID SO FAR[\s\S]*✓ Cash \$20\.00[\s\S]*Still due \$30\.00/, 'the paid parts are listed');
  assert.match(c.calls.wb.innerHTML, /removeSplitTender\(0\)/, 'and can be removed until the sale completes');
  assert.ok(c.calls.rendered > 0, 'the customer screen updates');
  // The Venmo QR window confirms with the amount it showed.
  delete c.fields['split-part-amount'];
  await c.confirmLockedPayment('venmo', 30);
  assert.deepEqual(c.lines().map(t => [t.method, t.amount]), [['cash', 20], ['venmo', 30]]);
  assert.equal(c.calls.completed, 1, 'parts add up to the total -- the sale completes');
  assert.equal(c.state(), 'pending');
}

// ── Whole sale on one method, as before ──
{
  const c = load({ total:12 });
  c.fields['locked-cash-received'] = '20';
  await c.confirmLockedPayment('cash');
  assert.deepEqual(c.lines().map(t => [t.method, t.amount, t.reference]), [['cash', 12, 'received:20.00 change:8.00']]);
  assert.equal(c.calls.completed, 1);
}

// ── Guards ──
{
  const c = load({ total:50 });
  c.fields['split-part-amount'] = '60';
  c.fields['locked-cash-received'] = '60';
  await c.confirmLockedPayment('cash');
  assert.match(c.calls.toasts.at(-1), /more than the \$50\.00 still due/);
  c.fields['split-part-amount'] = '0';
  await c.confirmLockedPayment('cash');
  assert.match(c.calls.toasts.at(-1), /greater than \$0/);
  c.fields['split-part-amount'] = '20';
  c.fields['locked-cash-received'] = '10';
  await c.confirmLockedPayment('cash');
  assert.match(c.calls.toasts.at(-1), /Cash received is less than the \$20\.00 on cash/);
  assert.equal(c.lines().length, 0, 'nothing taken on a bad entry');
}

// ── With a trade-in already applied: cash then card for the rest ──
{
  const c = load({ total:40, prior:[{ method:'trade_credit', amount:15, reference:'t1', fullAmount:15 }] });
  assert.equal(c.remainingCheckoutDue(), 25);
  c.fields['split-part-amount'] = '10';
  c.fields['locked-cash-received'] = '10';
  await c.confirmLockedPayment('cash');
  assert.equal(c.remainingCheckoutDue(), 15);
  assert.doesNotMatch(c.splitPaymentsSoFarHtml(), /Trade Credit/, 'the trade-in keeps its own remove button elsewhere');
  await c.confirmLockedPayment('card', 15);
  assert.deepEqual(c.lines().map(t => [t.method, t.amount]), [['trade_credit', 15], ['cash', 10], ['card', 15]], 'the trade-in is kept, never replaced');
  assert.equal(c.calls.completed, 1);
}

// ── Wiring ──
const sel = extractFn('selectLockedPaymentMethod');
assert.match(sel, /if\(method === 'cash'\) \{\n\s*wb\.innerHTML = splitPaymentsSoFarHtml\(\) \+ `[\s\S]*\$\{splitPartInputHtml\('cash', total\)\}/, 'cash asks how much goes on cash');
assert.match(sel, /onclick="showSplitP2pQr\('\$\{method\}'\)">SHOW \$\{escHtml\(formatTenderLabel\(method\)\.toUpperCase\(\)\)\} QR FOR THIS AMOUNT<\/button>/, 'Venmo/PayPal/Cash App can show a QR for just part');
assert.match(sel, /\$\{wholeSale \? `<button class="hbtn" style="min-height:52px;font-size:14px" onclick="startSplitAwareStripeCard\(\)">ENTER CARD SECURELY<\/button>` : ''\}/, 'secure card entry (always the whole sale) is only offered when nothing is paid yet');
assert.match(sel, /onclick="launchStripeQrCheckout\(readSplitPartAmount\(remainingCheckoutDue\(\)\)\)">STRIPE QR<\/button>/, 'Stripe QR charges the amount entered');
assert.match(dashboard, /completeBtn\.onclick = \(\) => \{\n\s*document\.getElementById\('stripe-qr-modal'\)\?\.classList\.remove\('on'\);\n\s*confirmLockedPayment\(method, totalDollars\);/, 'the QR window confirms the amount it showed');
assert.match(dashboard, /confirmLockedPayment\('card', _stripeQrAmount \/ 100\);/, 'and Stripe QR confirms what it charged');
assert.match(extractFn('renderCustomerDisplaySnapshot'), /if\(totalEl\) totalEl\.textContent = '\$' \+ remainingCheckoutDue\(\)\.toFixed\(2\);/, 'the customer screen shows only what is still due');
const updateChange = extractFn('updateLockedCashChange');
assert.match(updateChange, /const due = readSplitPartAmount\(remainingCheckoutDue\(\)\);/, 'change is worked out on the cash part');
console.log('Checkout split payment checks passed');
