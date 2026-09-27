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
    // An order paid partly with points earns on the account that spent them.
    const customer = order.customerId ? { id: order.customerId } : await findOrCreateWebCustomer(env, fetch, order);
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

// --- Spending points online ----------------------------------------------
//
// Same value as the register: 100 points = $1, so one point is one cent.
export const POINTS_PER_DOLLAR = 100;
// Stripe won't charge less than 50 cents, and points don't (yet) cover a
// whole order on their own -- so at least this much always goes on the card.
export const MIN_CARD_CHARGE_CENTS = 50;

// Points go toward the merchandise, not shipping, and never below the card
// minimum. Asking for more than allowed just uses the most allowed.
export function redeemablePoints({ requested, balance, merchandiseCents, totalCents }) {
  const cap = Math.min(
    Math.floor(Number(balance) || 0),
    Math.floor(Number(merchandiseCents) || 0),
    Math.floor((Number(totalCents) || 0) - MIN_CARD_CHARGE_CENTS),
  );
  const want = Math.floor(Number(requested) || 0);
  return Math.max(0, Math.min(want, cap));
}

// Only the customer record linked to the signed-in account can spend -- that
// is the balance My Pocket shows, and linking is guarded by phone
// verification. Email/phone matches earn points but never spend them.
export async function linkedWebCustomer(env, fetch, storeId, userId) {
  if (!storeId || !userId) return null;
  const enc = encodeURIComponent;
  const { data } = await fetch(env, `customers?store_id=eq.${enc(storeId)}&linked_user_id=eq.${enc(userId)}&select=id,loyalty_points_balance&limit=1`);
  return data?.[0] || null;
}

// Throws on failure (not enough points, say) so checkout can stop before a
// payment is created.
export async function holdWebOrderPoints(env, fetch, { storeId, customerId, points, orderRef }) {
  const { data } = await fetch(env, 'rpc/hold_web_order_points', {
    method: 'POST',
    body: JSON.stringify({ p_store_id: storeId, p_customer_id: customerId, p_points: points, p_order_ref: orderRef }),
  });
  return data;
}

// Never throws; safe to call for orders that never held any points.
export async function releaseWebOrderPoints(env, fetch, storeId, orderRef) {
  try {
    if (!storeId || !orderRef) return null;
    const { data } = await fetch(env, 'rpc/release_web_order_points', {
      method: 'POST', body: JSON.stringify({ p_store_id: storeId, p_order_ref: orderRef }),
    });
    return data;
  } catch (error) {
    console.error('Releasing held points failed:', orderRef, error?.message || error);
    return null;
  }
}

export async function finalizeWebOrderPoints(env, fetch, storeId, orderRef, saleId) {
  try {
    const { data } = await fetch(env, 'rpc/finalize_web_order_points', {
      method: 'POST', body: JSON.stringify({ p_store_id: storeId, p_order_ref: orderRef, p_sale_id: saleId }),
    });
    if (data === false) console.error('Paid order had no active points hold:', orderRef);
    return data;
  } catch (error) {
    console.error('Finalizing points failed:', orderRef, error?.message || error);
    return null;
  }
}

// The points part of a paid web order, recorded as a "Loyalty Points" tender
// the same way the register records one (method loyalty_redeem, reference =
// customer id), so tender reports count it alongside in-store redemptions.
export function loyaltyPaymentRow({ id, saleId, storeId, points, customerId, at }) {
  return {
    id, sale_id: saleId, store_id: storeId, method: 'loyalty_redeem', amount: points / POINTS_PER_DOLLAR,
    amount_cents: points, reference: customerId || '', status: 'succeeded', provider: 'loyalty',
    confirmed_at: at, created_at: at,
  };
}

// Lets a checkout request carry a points amount only from a signed-in user.
// Returns { customer, points } or an { error } message for the shopper.
export async function planWebRedemption(env, fetch, { storeId, userId, requested, merchandiseCents, totalCents }) {
  const want = Math.floor(Number(requested) || 0);
  if (want <= 0) return { customer: null, points: 0 };
  if (!userId) return { error: 'Sign in to use your points' };
  const { data: settings } = await fetch(env, `store_settings?store_id=eq.${encodeURIComponent(storeId)}&select=receipt_settings&limit=1`);
  if (storeLoyaltyRate(settings?.[0]?.receipt_settings) <= 0) return { error: 'Points are not being accepted right now' };
  const customer = await linkedWebCustomer(env, fetch, storeId, userId);
  if (!customer) return { error: 'Link your account to your store profile in My Pocket to use points' };
  const points = redeemablePoints({ requested: want, balance: customer.loyalty_points_balance, merchandiseCents, totalCents });
  return { customer, points };
}

// True while an order's points are held (taken off the balance, not given
// back). A resumed payment must not charge the discounted amount once the
// points have gone back to the customer.
export async function pointsHoldActive(env, fetch, storeId, orderRef) {
  const enc = encodeURIComponent;
  const { data } = await fetch(env, `loyalty_ledger?store_id=eq.${enc(storeId)}&order_ref=eq.${enc(orderRef)}&select=reason`);
  const reasons = (data || []).map(r => r.reason);
  return reasons.includes('web_redeem') && !reasons.includes('web_redeem_release');
}

// On a paid order that used points: lock the hold in (so it can't be
// released) and record the points as a Loyalty Points tender on the sale.
// Returns the spending customer's id, or null if no hold was in effect.
// Never throws -- the card payment already went through.
export async function recordWebPointsTender(env, fetch, { storeId, orderRef, saleId, paymentId, points, at }) {
  try {
    if (!(points > 0)) return null;
    const enc = encodeURIComponent;
    const { data: holds } = await fetch(env, `loyalty_ledger?store_id=eq.${enc(storeId)}&order_ref=eq.${enc(orderRef)}&reason=eq.web_redeem&select=customer_id&limit=1`);
    const customerId = holds?.[0]?.customer_id || null;
    if (!customerId || (await finalizeWebOrderPoints(env, fetch, storeId, orderRef, saleId)) !== true) return null;
    await fetch(env, 'pos_payments?on_conflict=id', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(loyaltyPaymentRow({ id: paymentId, saleId, storeId, points, customerId, at })),
    });
    return customerId;
  } catch (error) {
    console.error('Recording points tender failed:', orderRef, error?.message || error);
    return null;
  }
}
