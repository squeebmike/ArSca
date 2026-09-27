// What an eBay order actually made, per line item: item price, the shipping
// the buyer paid, the fee eBay charged, and (later) the label bought on
// eBay. Each line item is recorded as its own sale, so order-level amounts
// are split across the order's lines by item price.
//
// eBay's final value fee is charged on the whole order -- item + shipping +
// sales tax -- plus a per-order fee, so the order's own totalMarketplaceFee is
// used whenever eBay includes it. Otherwise it's estimated on that same full
// total (never the item price alone) and marked as an estimate for the
// finances reconcile to replace with the real fee.

const cents = v => Math.round(Number(v || 0) * 100);
const dollars = c => Math.round(c) / 100;
const amountOf = a => (a && typeof a === 'object' ? a.value : a);

// Splits `totalCents` across `weights` (cents) in proportion, remainder to
// the last line, so the parts always add up to the total.
export function splitCents(totalCents, weights) {
  const sum = weights.reduce((a, w) => a + Math.max(0, w), 0);
  if (!weights.length) return [];
  const parts = weights.map(w => (sum > 0 ? Math.floor((totalCents * Math.max(0, w)) / sum) : Math.floor(totalCents / weights.length)));
  parts[parts.length - 1] += totalCents - parts.reduce((a, p) => a + p, 0);
  return parts;
}

// eBay's per-order fee: $0.30 at $10 and under, $0.40 above (unless the
// store has its own flat fee configured).
export function estimateEbayFeeCents(basisCents, { pct, flat } = {}) {
  const perOrder = flat != null && flat !== '' ? cents(flat) : basisCents > 1000 ? 40 : 30;
  return Math.round((basisCents * Number(pct ?? 13.25)) / 100) + perOrder;
}

export function ebayOrderMoney(order, { feePct, feeFlat } = {}) {
  const lines = order.lineItems || [];
  const itemCents = lines.map(li => cents(amountOf(li.lineItemCost) ?? amountOf(li.total)));
  // Shipping per line when eBay gives it, else the order's shipping split by item price.
  const lineShip = lines.map(li => amountOf(li.deliveryCost?.shippingCost));
  const orderShip = cents(amountOf(order.pricingSummary?.deliveryCost)) - cents(amountOf(order.pricingSummary?.deliveryDiscount));
  const shippingCents = lineShip.every(v => v != null) ? lineShip.map(cents) : splitCents(Math.max(0, orderShip), itemCents);
  const taxCents = lines.map(li => (li.ebayCollectAndRemitTaxes || []).reduce((a, t) => a + cents(amountOf(t.amount)), 0));

  const actualFee = amountOf(order.totalMarketplaceFee);
  let feeCents, feeSource;
  if (actualFee != null && actualFee !== '') {
    feeCents = splitCents(cents(actualFee), itemCents.map((c, i) => c + shippingCents[i] + taxCents[i]));
    feeSource = 'ebay';
  } else {
    const basis = itemCents.reduce((a, c, i) => a + c + shippingCents[i] + taxCents[i], 0);
    feeCents = splitCents(estimateEbayFeeCents(basis, { pct: feePct, flat: feeFlat }), itemCents.map((c, i) => c + shippingCents[i] + taxCents[i]));
    feeSource = 'estimate';
  }
  return lines.map((li, i) => ({
    lineItemId: String(li.lineItemId || ''),
    itemPrice: dollars(itemCents[i]),
    shipping: dollars(shippingCents[i]),
    fee: dollars(feeCents[i]),
    feeSource,
  }));
}

// Profit for one line: item + shipping paid - cost - eBay fee - label.
// Until the label bought on eBay shows up (a presale's can be weeks away),
// it's assumed to cost what the buyer paid for shipping, so shipping money
// never shows up as profit on its own. A voided label with no replacement
// (net label cost back to 0) goes back to that assumption.
export function ebayLineProfit({ itemPrice, shipping, fee, labelCost = 0 }, cost) {
  const label = cents(labelCost) > 0 ? cents(labelCost) : cents(shipping);
  return dollars(cents(itemPrice) + cents(shipping) - cents(cost) - cents(fee) - label);
}

// Finances API transactions -> what to apply to recorded sales, by order.
// SHIPPING_LABEL debits add label cost (a CREDIT, i.e. a voided label,
// takes it back off); SALE transactions carry the real fee per line item.
export function financeAdjustments(transactions) {
  const labels = new Map(); // orderId -> [{ id, cents }]
  const fees = new Map();   // lineItemId -> fee cents
  for (const t of transactions || []) {
    const orderId = t.orderId || (t.references || []).find(r => r.referenceType === 'ORDER_ID')?.referenceId || '';
    if (t.transactionType === 'SHIPPING_LABEL' && orderId && t.transactionId) {
      const sign = t.bookingEntry === 'CREDIT' ? -1 : 1;
      if (!labels.has(orderId)) labels.set(orderId, []);
      labels.get(orderId).push({ id: String(t.transactionId), cents: sign * Math.abs(cents(amountOf(t.amount))) });
    }
    if (t.transactionType === 'SALE') {
      for (const li of t.orderLineItems || []) {
        const fee = (li.marketplaceFees || []).reduce((a, f) => a + Math.abs(cents(amountOf(f.amount))), 0);
        if (li.lineItemId) fees.set(String(li.lineItemId), fee);
      }
    }
  }
  return { labels, fees };
}
