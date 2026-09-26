// Loyalty points for paid web orders (shop, comic preorders, backlist books),
// at the same store-configured rate as an in-store sale.
//
// loyaltyRate is "Loyalty pts % of $" in the dashboard, and points redeem at
// 100 = $1 -- so a rate of 3 means 3% back: $1 spent earns 3 points (3 cents).
export const DEFAULT_LOYALTY_RATE = 3;

export function loyaltyPointsFor(amountDollars, rate) {
  const points = Math.round(Number(amountDollars || 0) * Number(rate || 0));
  return Number.isFinite(points) && points > 0 ? points : 0;
}

// Mirrors the dashboard's getLoyaltyRate(): an unset rate means the default,
// but an explicit 0 means loyalty is switched off.
export function storeLoyaltyRate(receiptSettings) {
  const raw = receiptSettings?.loyaltyRate;
  if (raw === undefined || raw === null || raw === '') return DEFAULT_LOYALTY_RATE;
  const rate = Number(raw);
  return Number.isFinite(rate) && rate >= 0 ? rate : DEFAULT_LOYALTY_RATE;
}

function phoneKey(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

// Signed-in buyers are credited on the customer record linked to their
// account, since that's the one My Pocket shows. Otherwise an existing
// customer with the same email or phone is credited -- without linking it to
// any account, since linking is what the phone-verification flow guards. A
// buyer matching nobody gets a new customer record.
export async function findOrCreateWebCustomer(env, fetch, { storeId, userId, name, email, phone }) {
  const enc = encodeURIComponent;
  const emailKey = String(email || '').trim().toLowerCase();
  const phoneDigits = phoneKey(phone);
  if (userId) {
    const { data } = await fetch(env, `customers?store_id=eq.${enc(storeId)}&linked_user_id=eq.${enc(userId)}&select=id&limit=1`);
    if (data?.[0]) return data[0];
  }
  const filters = [];
  if (emailKey) filters.push(`email.ilike.${JSON.stringify(emailKey)}`);
  if (phoneDigits) filters.push(`phone.like.${JSON.stringify('*' + phoneDigits.slice(-4))}`);
  if (filters.length) {
    const { data } = await fetch(env, `customers?store_id=eq.${enc(storeId)}&or=${enc('(' + filters.join(',') + ')')}&select=id,email,phone,linked_user_id&order=created_at.asc&limit=50`);
    // ilike/like are only a prefilter (an email's "_" is a LIKE wildcard) --
    // the exact comparison happens here.
    const candidates = (data || []).filter(c => !c.linked_user_id || c.linked_user_id === userId);
    const byEmail = emailKey && candidates.find(c => String(c.email || '').trim().toLowerCase() === emailKey);
    const byPhone = phoneDigits && candidates.find(c => phoneKey(c.phone) === phoneDigits);
    if (byEmail || byPhone) return byEmail || byPhone;
  }
  if (!emailKey && !phoneDigits && !userId) return null;
  const { data } = await fetch(env, 'customers', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      store_id: storeId,
      name: String(name || '').trim() || 'Web customer',
      email: emailKey || null,
      phone: String(phone || '').trim() || null,
      linked_user_id: userId || null,
      notes: 'Created from a website order',
    }),
  });
  return data?.[0] || null;
}

// Never throws: a loyalty hiccup must not fail a payment webhook. Safe to call
// more than once for the same order -- accrue_web_order_loyalty only awards
// once per sale.
export async function awardWebOrderLoyalty(env, fetch, order) {
  try {
    const { storeId, saleId } = order;
    if (!storeId || !saleId) return null;
    const enc = encodeURIComponent;
    const { data: settings } = await fetch(env, `store_settings?store_id=eq.${enc(storeId)}&select=receipt_settings&limit=1`);
    const rate = storeLoyaltyRate(settings?.[0]?.receipt_settings);
    const customer = await findOrCreateWebCustomer(env, fetch, order);
    if (!customer?.id) return null;
    // Stamped regardless of points, same as an in-store sale: it's what ties
    // the purchase to the customer's history.
    await fetch(env, `pos_sales?id=eq.${enc(saleId)}&store_id=eq.${enc(storeId)}&customer_id=is.null`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ customer_id: customer.id }),
    });
    const points = loyaltyPointsFor(order.amountDollars, rate);
    if (!points) return { customerId: customer.id, points: 0, balance: null };
    const { data: balance } = await fetch(env, 'rpc/accrue_web_order_loyalty', {
      method: 'POST',
      body: JSON.stringify({ p_store_id: storeId, p_customer_id: customer.id, p_points: points, p_sale_id: saleId }),
    });
    return { customerId: customer.id, points: balance == null ? 0 : points, balance };
  } catch (error) {
    console.error('Web order loyalty failed:', error?.message || error);
    return null;
  }
}
