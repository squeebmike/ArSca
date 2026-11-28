import assert from 'node:assert/strict';
// 2026-11-28: a $4.99 book + $6.71 shipping showed $18.41 -- the sale's own Shipping line and the order's shipping fee
// were both counted. Shipping counts once.
{ const { buildOrdersBoard } = await import('../scripts/orders-board.mjs');
  const base = { storefrontOrders:[{ id:'sf-s', sale_id:'s-s', confirmation_number:'ORD-S', customer_name:'M', fulfillment_method:'shipping', fulfillment_status:'pending', shipping_fee_cents:671, created_at:'2026-11-28T01:08:14Z' }] };
  const withLine = buildOrdersBoard({ ...base, storefrontLines:[{ sale_id:'s-s', item_id:'jg1', title:'JEAN GREY #1', quantity:1, unit_price:4.99 }, { sale_id:'s-s', item_id:null, title:'Shipping', quantity:1, unit_price:6.71 }] });
  const noLine = buildOrdersBoard({ ...base, storefrontLines:[{ sale_id:'s-s', item_id:'jg1', title:'JEAN GREY #1', quantity:1, unit_price:4.99 }] });
  const find = b => b.channels.website.find(o => o.number === 'ORD-S');
  assert.equal(find(withLine).total, 11.7, 'Shipping line + fee counted once');
  assert.equal(find(noLine).total, 11.7, 'no Shipping line: the fee is added');
  console.log('Website order total counts shipping once: passed'); }
