// A new website order -> an email to the store (store, 2026-11-03: "I also
// want an email sent to hintline@themanapocket.com whenever we get an order
// through the website"). Checked every 10 minutes: each PAID website order
// (its sale completed -- the same test as the waiting-order reminder) is
// emailed once, with who, how it goes out, and what was bought. An unpaid or
// abandoned checkout is never sent. Orders from before this started aren't.
export const WEB_ORDER_NOTIFY = { '0f9dd4bc-42a7-487e-a972-2905d24513e9': 'hintline@themanapocket.com' };
export const WEB_ORDER_NOTIFY_SINCE = '2026-11-03T00:00:00Z';
const METHOD = { pickup_fedway: 'Pickup, Fed Way Commons', pickup_kitsap: 'Pickup, Kitsap County', shipping: 'Shipping' };
const usd = n => '$' + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
function addressText(a) {
  if (!a) return '';
  if (typeof a === 'string') { try { a = JSON.parse(a); } catch (_) { return a; } }
  const line2 = [a.city, [a.state, a.postal_code || a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [a.name, a.line1 || a.address1 || a.street, a.line2 || a.address2, line2, a.country && a.country !== 'US' ? a.country : ''].filter(Boolean).join('\n    ');
}
export function webOrderEmail(order = {}, sale = {}, lines = []) {
  const items = lines.map(l => {
    const q = Math.max(1, Number(l.quantity) || 1);
    return `  ${q} × ${l.title || 'Item'} — ${usd((Number(l.unit_price) || 0) * q)}`;
  });
  const ship = Number(order.shipping_fee_cents) || 0;
  const body = [
    `New website order ${order.confirmation_number || ''}`.trim(),
    '',
    `Customer: ${order.customer_name || '—'}`,
    order.customer_email ? `Email: ${order.customer_email}` : null,
    order.customer_phone ? `Phone: ${order.customer_phone}` : null,
    `How: ${METHOD[order.fulfillment_method] || order.fulfillment_method || '—'}`,
    order.fulfillment_method === 'shipping' && order.shipping_address ? `Ship to:\n    ${addressText(order.shipping_address)}` : null,
    '',
    'Items:',
    ...(items.length ? items : ['  (no items found)']),
    '',
    ship ? `Shipping: ${usd(ship / 100)}` : null,
    Number(order.points_redeemed) ? `Points used: ${order.points_redeemed}` : null,
    `Total paid: ${usd(sale.total)}`,
    order.notes ? `\nNote from the customer: ${order.notes}` : null,
    '',
    'Open the dashboard and tap WEB ORDERS WAITING at the top (or MORE > ORDERS) to pick or ship it.',
  ].filter(x => x !== null).join('\n');
  const first = lines[0]?.title ? ' — ' + String(lines[0].title).slice(0, 60) + (lines.length > 1 ? ` +${lines.length - 1} more` : '') : '';
  return { subject: `New website order ${order.confirmation_number || ''} · ${usd(sale.total)}${first}`.replace(/\s+·/, ' ·'), body };
}
// deps: db(path) -> rows, kvGet(key), kvPut(key, value), send(to, subject, body)
export async function runWebOrderNotify(deps, { now = Date.now(), stores = WEB_ORDER_NOTIFY, since = WEB_ORDER_NOTIFY_SINCE } = {}) {
  const out = [];
  const from = new Date(Math.max(Date.parse(since), now - 3 * 86400000)).toISOString();
  for (const [storeId, to] of Object.entries(stores)) {
    const orders = await deps.db(`storefront_orders?store_id=eq.${encodeURIComponent(storeId)}&created_at=gte.${encodeURIComponent(from)}&select=id,sale_id,confirmation_number,customer_name,customer_email,customer_phone,fulfillment_method,shipping_address,shipping_fee_cents,points_redeemed,notes,created_at&order=created_at.asc&limit=100`);
    for (const order of orders || []) {
      if (!order.sale_id) continue;
      const key = 'web-order-notified:' + order.id;
      if (await deps.kvGet(key)) continue;
      const [sale] = await deps.db(`pos_sales?id=eq.${encodeURIComponent(order.sale_id)}&select=id,status,total&limit=1`) || [];
      if (sale?.status !== 'completed') continue; // not paid (yet)
      const lines = await deps.db(`pos_sale_lines?sale_id=eq.${encodeURIComponent(order.sale_id)}&select=title,quantity,unit_price&limit=100`) || [];
      const mail = webOrderEmail(order, sale, lines);
      try { await deps.send(to, mail.subject, mail.body); await deps.kvPut(key, { at: new Date(now).toISOString(), to }); out.push({ order: order.confirmation_number, sent: true }); }
      catch (e) { out.push({ order: order.confirmation_number, error: e.message }); }
    }
  }
  return out;
}
