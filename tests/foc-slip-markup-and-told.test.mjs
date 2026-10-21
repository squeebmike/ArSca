import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Store asks: (1) one markup for the whole packing slip -- "cover x 1.25,
// round to .99" -- typing only the exceptions; (2) see which preorder
// customers were told their books are in when the shipment is received.
const dash = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
const fn = n => { const s = dash.indexOf('function ' + n + '('); assert.ok(s >= 0, n); return dash.slice(s, dash.indexOf('\n}\n', s) + 2); };
const line = n => { const s = dash.indexOf('function ' + n + '('); assert.ok(s >= 0, n); return dash.slice(s, dash.indexOf('\n', s) + 1); };
const toasts = [];
const inputs = { 'foc-slip-markup-times': { value: '1.25' }, 'foc-slip-markup-round': { value: '99' } };
const store = new Map();
const ctx = {
  state: { slip: null }, toasts, renders: 0,
  document: { getElementById: id => inputs[id] || null },
  localStorage: { getItem: k => store.get(k) || null, setItem: (k, v) => store.set(k, v) },
  esc: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
};
vm.runInNewContext([
  line('slipLineKey'), line('slipPrice'), line('focSlipPrice'), fn('slipMarkupRound'), line('slipMarkupSettings'), line('slipOwnPrice'), fn('focSlipMarkup'), fn('slipToldHtml'),
  'function toast_dash(m){toasts.push(m);} function renderSlip(){this.renders++;}',
  'this.api = { slipPrice, focSlipPrice, slipMarkupRound, slipMarkupSettings, focSlipMarkup, slipToldHtml };',
].join('\n'), ctx);
const { slipPrice, focSlipPrice, slipMarkupRound, slipMarkupSettings, focSlipMarkup, slipToldHtml } = ctx.api;

assert.equal(slipMarkupRound(3.99 * 1.25, '99'), 4.99);
assert.equal(slipMarkupRound(4.99 * 1.25, '99'), 6.99);
assert.equal(slipMarkupRound(3.99, '99'), 3.99, 'already .99 stays');
assert.equal(slipMarkupRound(5, '99'), 5.99);
assert.equal(slipMarkupRound(4.99 * 1.25, 'whole'), 7);
assert.equal(slipMarkupRound(6, 'whole'), 6);
assert.equal(slipMarkupRound(4.99 * 1.25, 'none'), 6.24);
assert.equal(slipMarkupRound(0, '99'), 0);

const plain = { code: '1', title: 'A', qty: 3, cover: { coverPrice: 3.99, customerPrice: 3.99 } };
const unpriced = { code: '2', title: 'B', qty: 2, cover: { coverPrice: 4.99, customerPrice: 0 } };
const ratio = { code: '3', title: 'C 1:25', qty: 1, cover: { coverPrice: 4.99, customerPrice: 40 } };
const typed = { code: '4', title: 'D', qty: 1, cover: { coverPrice: 5.99, customerPrice: 0 } };
const noMatch = { code: '5', title: 'E', qty: 1, cover: null };
ctx.state.slip = { lines: [plain, unpriced, ratio, typed, noMatch], picks: {}, qtys: {}, prices: {}, typed: {} };
focSlipPrice('4', '12.00');
focSlipMarkup();
assert.equal(slipPrice(plain), '4.99');
assert.equal(slipPrice(unpriced), '6.99');
assert.equal(slipPrice(ratio), '40.00', 'a ratio price set on the FOC wall is kept');
assert.equal(slipPrice(typed), '12.00', 'a price typed here is kept');
assert.equal(toasts.at(-1), 'Set 2 shelf prices · kept 2 you priced yourself');
assert.deepEqual(JSON.parse(store.get('foc-slip-markup')), { times: 1.25, round: '99' }, 'remembered for the next shipment');
assert.deepEqual({ ...slipMarkupSettings() }, { times: '1.25', round: '99' });
inputs['foc-slip-markup-times'].value = '0';
focSlipMarkup();
assert.equal(toasts.at(-1), 'Enter a markup like 1.25');
assert.equal(slipPrice(plain), '4.99', 'a bad markup changes nothing');

// The bar sits above the slip lines; a second page keeps the edits.
const render = fn('renderSlip');
assert.match(render, /onclick="focSlipMarkup\(\)">SET ALL PRICES<\/button>/);
assert.match(render, /host\.innerHTML=head\+summary\+markup\+sections/);
assert.match(dash, /state\.slip\.prices=prev\?prev\.prices\|\|\{\}:\{\};state\.slip\.typed=prev\?prev\.typed\|\|\{\}:\{\};/);
assert.match(dash, /window\.focSlipMarkup=focSlipMarkup;/);

// Received screen: who was told, who wasn't (and why), who's still waiting.
const html = slipToldHtml([
  { orderId: 'o1', orderNumber: '1042', name: 'Sean P', sms: true, email: true, errors: [] },
  { orderId: 'o2', orderNumber: '1043', name: 'Dana', sms: false, email: false, errors: ['opted out of texts'] },
  { orderId: 'o3', orderNumber: '1044', name: 'Lee', sms: false, email: false, errors: [] },
], [{ heldFor: [{ name: 'Sean P', copies: 1, orderNumber: '1042' }, { name: 'Robin', copies: 1, orderNumber: '1050' }] }]);
assert.match(html, /PREORDER CUSTOMERS TOLD THEIR BOOKS ARE IN \(1 of 3\)/);
assert.match(html, /Sean P <span[^>]*>#1042<\/span> · <span style="color:var\(--g\)">✓ texted \+ emailed<\/span>/);
assert.match(html, /Dana[\s\S]*✗ not reached -- opted out of texts\. Call them\./);
assert.match(html, /Lee[\s\S]*✗ not reached -- no phone or email on the order/);
assert.match(html, /still waiting on another book in their order[^:]*: Robin #1050</);
assert.doesNotMatch(html, /Sean P #1042/, 'told customers are not listed as waiting');
assert.equal(slipToldHtml([], []), '');
assert.match(slipToldHtml([], [{ heldFor: [{ name: 'Robin', copies: 1, orderNumber: '1050' }] }]), /PREORDER COPIES SET ASIDE/);
assert.match(fn('confirmSlipReceive'), /pickState\.notified=notifiedAll;\n  renderSlipReceived\(done,s\);/);
assert.match(fn('renderSlipReceived'), /slipToldHtml\(pickState\.notified,summary\)/);
console.log('FOC slip markup and customers-told checks passed');
