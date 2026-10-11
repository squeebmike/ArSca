import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store report: "Checkout and adding someone's number didn't connect to
// someone who has an account through the website already." The website
// customer was saved as 13605350308; checkout typed 3605350308, the exact
// compare missed, and a blank "Customer" took the sale's points. Phones now
// compare on their last 10 digits; a linked website account wins a tie.
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const extractFn = (src, name, prefix = 'function ') => { const s = src.indexOf(prefix + name + '('); assert.ok(s >= 0, name); return src.slice(s, src.indexOf('\n}\n', s) + 2); };
{
  const api = new Function([
    extractFn(dashboard, 'customerPhoneKey'), extractFn(dashboard, 'customerMatchesContact'), extractFn(dashboard, 'pickCustomerMatch'),
    extractFn(dashboard, 'findStoreCustomerRemote', 'async function '),
    'return { customerPhoneKey, customerMatchesContact, pickCustomerMatch, findStoreCustomerRemote };',
  ].join('\n'))();
  const sean = { id:'web', name:'Sean Van Overbeke', phone:'13605350308', email:'Sean@Example.com', linked_user_id:'u1', loyalty_points_balance:102 };
  const blank = { id:'dup', name:'Customer', phone:'3605350308', email:'', linked_user_id:null, loyalty_points_balance:456 };
  for (const typed of ['3605350308', '(360) 535-0308', '+1 360 535 0308', '13605350308']) assert.equal(api.customerMatchesContact(sean, typed), true, typed);
  assert.equal(api.customerMatchesContact(sean, '3605350309'), false);
  assert.equal(api.customerMatchesContact(sean, '0308'), false, 'too few digits never matches');
  assert.equal(api.customerMatchesContact(sean, 'sean@example.COM'), true, 'email ignores case');
  assert.equal(api.pickCustomerMatch([blank, sean], '360-535-0308').id, 'web', 'the website account wins over a blank duplicate');
  assert.equal(api.pickCustomerMatch([], '3605350308'), null);

  // The database lookup narrows on the last 4 digits, then compares properly.
  const seen = [];
  const sb = { from(table) { const q = { select() { return q; }, eq(k, v) { seen.push(['eq', k, v]); return q; }, like(k, v) { seen.push(['like', k, v]); return q; }, ilike(k, v) { seen.push(['ilike', k, v]); return q; }, limit() { return Promise.resolve({ data:[blank, sean], error:null }); } }; return q; } };
  assert.equal((await api.findStoreCustomerRemote(sb, 'store', '360.535.0308')).id, 'web');
  assert.deepEqual(seen.find(x => x[0] === 'like'), ['like', 'phone', '%0308']);
  await api.findStoreCustomerRemote(sb, 'store', 'a_b%c@x.com');
  assert.deepEqual(seen.find(x => x[0] === 'ilike'), ['ilike', 'email', 'a\\_b\\%c@x.com'], 'email wildcards escaped');
}
// Every checkout-side lookup goes through it -- no exact phone compares left.
assert.doesNotMatch(dashboard, /\.eq\(field, contact\)|\.eq\(isEmail \? 'email' : 'phone', contact\)/);
assert.match(extractFn(dashboard, 'accrueLoyaltyForContact', 'async function '), /findStoreCustomerRemote\(getSupabaseClient\(\), storeId, contact\)/);
assert.match(extractFn(dashboard, 'lookupLoyaltyBalanceForRedeem', 'async function '), /findStoreCustomerRemote\(sb, storeId, contact\)/);

// Store ask: "It needs to tell me whose name the order is for when scanning
// a slip and where it sold." The slip review loads the pick list and shows
// each buyer under the book.
const foc = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
{
  const esc = v => String(v);
  const slipBuyersHtml = new Function('esc', extractFn(foc, 'slipBuyersHtml') + '\nreturn slipBuyersHtml;')(esc);
  const html = slipBuyersHtml({ ebay:[{ orderId:'16-1', buyer:'Pat Jones', qty:1, shipped:false }], website:[{ orderNumber:'1042', name:'Sean Vanoverbeke', qty:2, method:'pickup' }], pull:[{ name:'Jo' }] });
  assert.match(html, /SOLD on eBay<\/b> · Pat Jones .*order 16-1.* · 1 · SHIP/);
  assert.match(html, /SOLD on website<\/b> #1042 · Sean Vanoverbeke · 2 · HOLD FOR PICKUP/);
  assert.match(html, /Pull list<\/b> · Jo/);
  assert.match(slipBuyersHtml({ ebay:[{ orderId:'16-2', buyer:'', qty:1 }], website:[], pull:[] }), /SOLD on eBay<\/b> · order 16-2 · 1/, 'no name -> order number');
  assert.equal(slipBuyersHtml(undefined), '');
}
assert.match(extractFn(foc, 'handleSlipFiles', 'async function '), /await loadSlipBuyers\(d\);\s*renderSlip\(\);/);
assert.match(extractFn(foc, 'slipLineHtml'), /slipBuyersHtml\(\(state\.slip\.who\|\|\{\}\)\[c\.skuId\]\)/);

// Pick list carries the eBay buyer's name when eBay gives it.
const { buildPickList } = await import('../scripts/foc-preorders.mjs');
{
  const covers = buildPickList({
    skus:[{ id:'b', title:'DNX #4', variant_label:'Cover B', family_id:'f1' }],
    presaleRows:[{ id:'p-b', data:{ source:'foc_presale', focSkuId:'b' } }],
    ebayLines:[{ item_id:'p-b', quantity:1, source_id:'ebay:16-1' }],
    ebayBuyers:new Map([['16-1', 'Pat Jones']]),
  });
  assert.equal(covers[0].ebay[0].buyer, 'Pat Jones');
  assert.equal(buildPickList({ skus:[{ id:'b', title:'X' }], presaleRows:[{ id:'p', data:{ source:'foc_presale', focSkuId:'b' } }], ebayLines:[{ item_id:'p', source_id:'ebay:9-9' }] })[0].ebay[0].buyer, '', 'no lookup -> blank');
}
console.log('customer phone match + slip buyers OK');
