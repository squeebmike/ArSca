// Read-only "everything about one person / one item" lookups for the
// dashboard's Database viewer. Every query is scoped to the caller's store;
// the Worker route checks owner/admin before calling in here.
//
// No table links a person across channels by one id: in-store sales carry
// customer_id, web orders carry user_id and/or email, guest shop orders only a
// phone. So a profile is gathered from every identifier known for the person.

const enc = encodeURIComponent;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function phoneKey(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

const inList = values => `in.(${values.map(v => enc(`"${String(v).replace(/"/g, '')}"`)).join(',')})`;
const byId = rows => new Map((rows || []).map(r => [String(r.id), r]));
const safe = promise => promise.then(r => r?.data || []).catch(() => []);

// PostgREST can't filter "last 10 digits of phone", so prefilter on the last
// four digits and compare exactly here.
async function rowsByPhone(fetch, env, path, column, phone) {
  const key = phoneKey(phone);
  if (!key) return [];
  const rows = await safe(fetch(env, `${path}&${column}=like.${enc('*' + key.slice(-4))}`));
  return rows.filter(r => phoneKey(r[column]) === key);
}
async function rowsByEmail(fetch, env, path, column, email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return [];
  const rows = await safe(fetch(env, `${path}&${column}=ilike.${enc(e)}`));
  return rows.filter(r => String(r[column] || '').trim().toLowerCase() === e);
}
const mergeById = (...lists) => [...byId(lists.flat()).values()];
const newestFirst = rows => rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

async function salesWithDetail(env, fetch, storeId, saleIds) {
  const ids = [...new Set(saleIds.filter(Boolean).map(String))];
  if (!ids.length) return [];
  const [sales, lines, payments] = await Promise.all([
    safe(fetch(env, `pos_sales?store_id=eq.${enc(storeId)}&id=${inList(ids)}&select=*`)),
    safe(fetch(env, `pos_sale_lines?store_id=eq.${enc(storeId)}&sale_id=${inList(ids)}&select=*`)),
    safe(fetch(env, `pos_payments?store_id=eq.${enc(storeId)}&sale_id=${inList(ids)}&select=id,sale_id,method,amount,status,provider,created_at`)),
  ]);
  return newestFirst(sales.map(s => ({
    ...s,
    lines: lines.filter(l => String(l.sale_id) === String(s.id)),
    payments: payments.filter(p => String(p.sale_id) === String(s.id)),
  })));
}

export async function customerProfile(env, fetch, storeId, params) {
  const base = `store_id=eq.${enc(storeId)}`;
  let customer = null;
  if (UUID.test(params.customerId || '')) {
    customer = (await safe(fetch(env, `customers?${base}&id=eq.${enc(params.customerId)}&select=*`)))[0] || null;
  }
  if (!customer && UUID.test(params.userId || '')) {
    customer = (await safe(fetch(env, `customers?${base}&linked_user_id=eq.${enc(params.userId)}&select=*`)))[0] || null;
  }
  const email = String(params.email || customer?.email || '').trim().toLowerCase();
  const phone = params.phone || customer?.phone || '';
  const userId = UUID.test(params.userId || '') ? params.userId : (customer?.linked_user_id || null);
  if (!customer && (email || phoneKey(phone))) {
    const found = mergeById(
      await rowsByEmail(fetch, env, `customers?${base}&select=*`, 'email', email),
      await rowsByPhone(fetch, env, `customers?${base}&select=*`, 'phone', phone),
    );
    customer = found[0] || null;
  }
  const customerId = customer?.id || null;
  const byCustomer = (table, select = '*') => customerId ? safe(fetch(env, `${table}?${base}&customer_id=eq.${enc(customerId)}&select=${select}&order=created_at.desc&limit=500`)) : Promise.resolve([]);
  const byUser = (table) => userId ? safe(fetch(env, `${table}?${base}&user_id=eq.${enc(userId)}&select=*&order=created_at.desc&limit=500`)) : Promise.resolve([]);

  const [loyalty, tradeCredit, giftCards, pullList, events, inStoreSales, shopByEmail, shopByPhone, focByUser, focByEmail, blByUser, blByEmail, receipts, buyByEmail, buyByPhone] = await Promise.all([
    byCustomer('loyalty_ledger'),
    byCustomer('trade_credit_ledger'),
    byCustomer('gift_cards'),
    byCustomer('pull_list_subscriptions'),
    byCustomer('event_registrations'),
    byCustomer('pos_sales', 'id'),
    rowsByEmail(fetch, env, `storefront_orders?${base}&select=*`, 'customer_email', email),
    rowsByPhone(fetch, env, `storefront_orders?${base}&select=*`, 'customer_phone', phone),
    byUser('foc_preorder_orders'),
    rowsByEmail(fetch, env, `foc_preorder_orders?${base}&select=*`, 'customer_email', email),
    byUser('backlist_orders'),
    rowsByEmail(fetch, env, `backlist_orders?${base}&select=*`, 'customer_email', email),
    rowsByPhone(fetch, env, `customer_receipts?${base}&select=*`, 'phone', phone),
    rowsByEmail(fetch, env, `buylist_submissions?${base}&select=*`, 'contact_email', email),
    rowsByPhone(fetch, env, `buylist_submissions?${base}&select=*`, 'contact_phone', phone),
  ]);
  const shopOrders = newestFirst(mergeById(shopByEmail, shopByPhone));
  const focOrders = newestFirst(mergeById(focByUser, focByEmail));
  const backlistOrders = newestFirst(mergeById(blByUser, blByEmail));
  const [focItems, backlistItems, sales] = await Promise.all([
    focOrders.length ? safe(fetch(env, `foc_preorder_items?${base}&order_id=${inList(focOrders.map(o => o.id))}&select=*`)) : [],
    backlistOrders.length ? safe(fetch(env, `backlist_order_items?${base}&order_id=${inList(backlistOrders.map(o => o.id))}&select=*`)) : [],
    // Every sale tied to this person: in-store (customer_id), shop orders
    // (sale_id), and paid preorder/backlist orders (their pos_sales row
    // shares the order's id).
    salesWithDetail(env, fetch, storeId, [
      ...inStoreSales.map(s => s.id), ...shopOrders.map(o => o.sale_id),
      ...focOrders.map(o => o.id), ...backlistOrders.map(o => o.id),
    ]),
  ]);
  const withItems = (orders, items) => orders.map(o => ({ ...o, items: items.filter(i => String(i.order_id) === String(o.id)) }));
  const paid = sales.filter(s => ['completed', 'succeeded'].includes(s.status));
  const lifetime = paid.reduce((sum, s) => sum + Number(s.total || 0), 0);
  return {
    identity: { customerId, userId, email, phone, name: customer?.name || params.name || '' },
    customer,
    summary: {
      loyaltyPoints: Number(customer?.loyalty_points_balance || 0),
      tradeCredit: Number(customer?.trade_credit_balance || 0),
      lifetimeSpend: Math.round(lifetime * 100) / 100,
      purchases: paid.length,
      firstSeen: [customer?.created_at, ...sales.map(s => s.created_at)].filter(Boolean).sort()[0] || null,
      lastSeen: [customer?.updated_at, ...sales.map(s => s.created_at)].filter(Boolean).sort().pop() || null,
    },
    sales,
    loyalty: newestFirst(loyalty), tradeCredit: newestFirst(tradeCredit),
    shopOrders, focOrders: withItems(focOrders, focItems), backlistOrders: withItems(backlistOrders, backlistItems),
    giftCards, pullList, events, receipts: newestFirst(receipts), buylist: newestFirst(mergeById(buyByEmail, buyByPhone)),
  };
}

export async function searchInventory(env, fetch, storeId, q) {
  const term = String(q || '').trim().slice(0, 100);
  const base = `inventory_items?store_id=eq.${enc(storeId)}&select=id,status,data,updated_at&order=updated_at.desc&limit=60`;
  if (!term) return safe(fetch(env, base)).then(shapeItemHits);
  if (UUID.test(term)) return safe(fetch(env, `${base}&id=eq.${enc(term)}`)).then(shapeItemHits);
  const like = `*${term.replace(/[*,()"]/g, ' ')}*`;
  const or = `(data->>name.ilike.${JSON.stringify(like)},data->>barcode.eq.${JSON.stringify(term)},data->>upc.eq.${JSON.stringify(term)},data->>set.ilike.${JSON.stringify(like)},data->>ebaySku.eq.${JSON.stringify(term)})`;
  return safe(fetch(env, `${base}&or=${enc(or)}`)).then(shapeItemHits);
}
function shapeItemHits(rows) {
  return rows.map(r => {
    const d = r.data || {};
    return { id: r.id, status: r.status, name: d.name || d.title || '(no name)', category: d.category || '', set: d.set || '',
      qty: d.quantity ?? d.qty ?? null, price: Number(d.priceOverride || d.salePrice || d.market || 0) || null, cost: Number(d.cost || 0) || null,
      image: d.image || d.imageUrl || '', updatedAt: r.updated_at };
  });
}

export async function itemProfile(env, fetch, storeId, id) {
  if (!UUID.test(id || '')) return null;
  const base = `store_id=eq.${enc(storeId)}`;
  const item = (await safe(fetch(env, `inventory_items?${base}&id=eq.${enc(id)}&select=*`)))[0];
  if (!item) return null;
  const d = item.data || {};
  const [linesByItem, linesBySource, focSku, preorderItems] = await Promise.all([
    safe(fetch(env, `pos_sale_lines?${base}&item_id=eq.${enc(id)}&select=*`)),
    safe(fetch(env, `pos_sale_lines?${base}&source_id=eq.${enc(id)}&select=*`)),
    UUID.test(d.focSkuId || '') ? safe(fetch(env, `comic_skus?${base}&id=eq.${enc(d.focSkuId)}&select=*`)).then(r => r[0] || null) : null,
    UUID.test(d.focSkuId || '') ? safe(fetch(env, `foc_preorder_items?${base}&sku_id=eq.${enc(d.focSkuId)}&select=*&order=created_at.desc`)) : [],
  ]);
  const lines = mergeById(linesByItem, linesBySource);
  const sales = await salesWithDetail(env, fetch, storeId, lines.map(l => l.sale_id));
  const saleById = byId(sales);
  const history = newestFirst(lines.map(l => {
    const sale = saleById.get(String(l.sale_id)) || {};
    return { ...l, sale_status: sale.status || '', sale_total: sale.total ?? null, sold_at: sale.completed_at || sale.created_at || l.created_at,
      channel: (sale.payments || []).map(p => p.method).filter(Boolean).join(' + '), customer_id: sale.customer_id || null,
      created_at: sale.completed_at || sale.created_at || l.created_at };
  }));
  const revenue = history.filter(h => ['completed', 'succeeded'].includes(h.sale_status)).reduce((s, h) => s + Number(h.adjusted_price || 0), 0);
  const profit = history.filter(h => ['completed', 'succeeded'].includes(h.sale_status)).reduce((s, h) => s + Number(h.profit || 0), 0);
  return {
    item, history, focSku, preorderItems,
    summary: { unitsSold: history.reduce((s, h) => s + Number(h.quantity || 0), 0), revenue: Math.round(revenue * 100) / 100, profit: Math.round(profit * 100) / 100 },
  };
}
