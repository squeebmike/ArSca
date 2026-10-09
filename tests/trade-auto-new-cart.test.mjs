import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store ask: a trade taken while another customer's sale is open should go on
// its own cart -- "TRADE -> SALE" used to attach it to whatever cart was open.
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
function extractFn(name, prefix = 'function ') {
  const start = dashboard.indexOf(prefix + name + '(');
  assert.ok(start >= 0, name + ' must exist');
  return dashboard.slice(start, dashboard.indexOf('\n}\n', start) + 2);
}

function load({ openCart, confirmAnswer = true }) {
  const state = { active:openCart, carts:[openCart], confirms:[], synced:[], storage:{ pos_pending_trade_purchase:'{"creditId":"t2"}' } };
  const fn = new Function('ensureActiveSaleCart', 'newSaleCartRecord', 'upsertLocalSaleCart', 'setActiveSaleCartId', 'localStorage', 'syncActiveSaleCartToWorker', 'renderSaleCartSwitcher', 'saleCartLabel', 'confirm', [
    extractFn('tradeCustomerKey'), extractFn('tradeCartDecision'),
    extractFn('attachTradeToActiveSaleCart', 'async function '), extractFn('tradeNewCartNote'),
    'return { tradeCustomerKey, tradeCartDecision, attachTradeToActiveSaleCart, tradeNewCartNote };',
  ].join('\n'));
  const api = fn(
    () => state.active,
    (seed = {}) => ({ cartId:'cart-new', id:'cart-new', items:[], customerName:seed.customerName || '' }),
    c => { if(!state.carts.includes(c)) state.carts.push(c); },
    id => { state.active = state.carts.find(c => c.cartId === id); },
    { setItem:(k, v) => { state.storage[k] = v; }, removeItem:k => { delete state.storage[k]; }, getItem:k => state.storage[k] ?? null },
    async c => { state.synced.push(c.cartId); },
    () => {},
    c => c.customerName || 'Sale ' + c.cartId,
    msg => { state.confirms.push(msg); return confirmAnswer; },
  );
  return { ...api, state };
}

// ── The rule ──
{
  const { tradeCartDecision: d, tradeCustomerKey: k } = load({ openCart:{ cartId:'a', items:[] } });
  assert.equal(k('Walk-in trade 4F2A'), '', 'the auto walk-in placeholder is not a name');
  assert.equal(k('  Sam  Lee '), 'sam lee');
  assert.equal(d({ items:[] }, { id:'t', customerName:'Sam' }), 'use', 'an empty, unnamed cart takes the trade');
  assert.equal(d({ items:[{}], customerName:'Sam' }, { id:'t', customerName:'sam' }), 'use', 'same customer: same cart');
  assert.equal(d({ items:[{}], customerName:'Alex' }, { id:'t', customerName:'Sam' }), 'new', 'another customer\'s sale: new cart');
  assert.equal(d({ items:[], customerName:'Alex' }, { id:'t', customerName:'Sam' }), 'new');
  assert.equal(d({ items:[], tradeCredit:{ id:'t1' } }, { id:'t2', customerName:'' }), 'new', 'a cart already carrying another trade never has it replaced');
  assert.equal(d({ items:[], tradeCredit:{ id:'t2' } }, { id:'t2' }), 'use', 'the same trade again is fine');
  assert.equal(d({ items:[{}] }, { id:'t', customerName:'Walk-in trade 4F2A' }), 'ask', 'an unnamed sale with items: ask');
  assert.equal(d({ items:[], customerName:'Alex' }, { id:'t', customerName:'Walk-in trade 4F2A' }), 'ask', 'a named cart and an unnamed trade: ask');
}

// ── Another customer's sale is open: the trade gets its own cart ──
{
  const alex = { cartId:'cart-alex', items:[{ id:'x' }, { id:'y' }], customerName:'Alex' };
  const { attachTradeToActiveSaleCart, tradeNewCartNote, state } = load({ openCart:alex });
  const placed = await attachTradeToActiveSaleCart({ id:'t2', amount:40, customerName:'Sam' });
  assert.deepEqual({ ...placed }, { newCart:true, movedFrom:'Alex' });
  assert.equal(state.active.cartId, 'cart-new');
  assert.equal(state.active.tradeCredit.id, 't2');
  assert.equal(state.active.tradeCredit.remainingBalance, 40);
  assert.equal(state.active.customerName, 'Sam');
  assert.equal(alex.tradeCredit, undefined, 'Alex\'s sale is untouched');
  assert.equal(alex.items.length, 2);
  assert.equal(state.storage.pos_pending_trade_purchase, '{"creditId":"t2"}', 'the trade hand-off the caller saved is kept');
  assert.deepEqual(state.synced, ['cart-new']);
  assert.equal(state.confirms.length, 0, 'no question when it is clearly someone else');
  assert.match(tradeNewCartNote(placed), /new cart -- Alex is still open in the cart row/);
}

// ── The same customer already shopping: trade goes on their sale ──
{
  const sam = { cartId:'cart-sam', items:[{ id:'x' }], customerName:'Sam' };
  const { attachTradeToActiveSaleCart, tradeNewCartNote, state } = load({ openCart:sam });
  const placed = await attachTradeToActiveSaleCart({ id:'t2', amount:15, customerName:'Sam' });
  assert.equal(placed.newCart, false);
  assert.equal(state.active, sam);
  assert.equal(sam.tradeCredit.id, 't2');
  assert.equal(tradeNewCartNote(placed), '');
}

// ── Can't tell: asks; Cancel starts a new cart, OK keeps the open one ──
{
  const open = { cartId:'cart-1', items:[{ id:'x' }], customerName:'' };
  const no = load({ openCart:open, confirmAnswer:false });
  const p1 = await no.attachTradeToActiveSaleCart({ id:'t3', amount:5, customerName:'Walk-in trade AB12' });
  assert.equal(no.state.confirms.length, 1);
  assert.match(no.state.confirms[0], /Is this trade for that same customer\?/);
  assert.match(no.state.confirms[0], /\(1 item\)/);
  assert.equal(p1.newCart, true);
  assert.equal(open.tradeCredit, undefined);

  const open2 = { cartId:'cart-2', items:[{ id:'x' }], customerName:'' };
  const yes = load({ openCart:open2, confirmAnswer:true });
  const p2 = await yes.attachTradeToActiveSaleCart({ id:'t4', amount:5, customerName:'Walk-in trade CD34' });
  assert.equal(p2.newCart, false);
  assert.equal(open2.tradeCredit.id, 't4');
  assert.equal(open2.customerName, 'Walk-in trade CD34', 'an unnamed sale takes the trade\'s name');
}

// ── Both trade paths use it and say where the trade went ──
const asTrade = extractFn('acceptBuyAsTrade', 'async function ');
assert.match(asTrade, /const placed = await attachTradeToActiveSaleCart\(result\.credit\);/);
assert.match(asTrade, /\+ tradeNewCartNote\(placed\), placed\?\.newCart \? 6000 : 2500\);/);
const payout = extractFn('confirmBuyPayout', 'async function ');
assert.match(payout, /let placed = null;/);
assert.match(payout, /placed = await attachTradeToActiveSaleCart\(result\.credit\);/);
assert.match(payout, /\+ tradeNewCartNote\(placed\), placed\?\.newCart \? 6000 : 2500\);/);

console.log('Trade -> sale auto new cart checks passed');
