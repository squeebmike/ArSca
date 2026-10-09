// Orders board: every eBay, Whatnot and website order in one place, sorted
// into what the store actually needs to know -- what's in and ready to go
// out, what's waiting on a book and when that book is due, and what's late
// (a book past its release date that never came in, or an order that's
// been ready but still hasn't shipped).
//
// Store ask: "Need organized area for ebay, whatnot, and website orders..
// Need to know whats in. When itll be in.. and whats late."

const DAY = 24 * 60 * 60 * 1000;
// An order whose books are all in should be out the door within this many
// days of the later of "ordered" and "last book due" -- the store's own
// listings promise 1 business day.
export const SHIP_LATE_AFTER_DAYS = 3;

const text = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const dayOf = v => (v ? String(v).slice(0, 10) : '');
const addDays = (isoDay, n) => new Date(Date.parse(isoDay + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);

// One line's book: in hand, coming (with its due date), or late.
export function orderItemState({ isPresale = false, received = false, onSaleDate = '' }, today) {
  if (!isPresale || received) return { state: 'in', onSaleDate: onSaleDate || '' };
  if (onSaleDate && onSaleDate < today) return { state: 'late', onSaleDate };
  return { state: 'coming', onSaleDate: onSaleDate || '' };
}

// Rolls an order's lines up to one status the board can sort on.
export function orderStatus({ items = [], shipped = false, createdAt = '', today, pickup = false }) {
  if (shipped) return { status: 'shipped', reason: '', expectedDate: '' };
  const late = items.filter(i => i.state === 'late');
  if (late.length) {
    const since = late.map(i => i.onSaleDate).filter(Boolean).sort()[0] || '';
    return { status: 'late', reason: 'book not in yet' + (since ? ' -- due ' + since : ''), expectedDate: since };
  }
  const coming = items.filter(i => i.state === 'coming');
  if (coming.length) {
    const due = coming.map(i => i.onSaleDate).filter(Boolean).sort().pop() || '';
    return { status: 'waiting', reason: due ? 'waiting on ' + coming.length + ' book' + (coming.length === 1 ? '' : 's') : 'waiting on a book with no release date', expectedDate: due };
  }
  // A pickup order with everything in waits on the customer, not the store.
  if (pickup) return { status: 'ready', reason: 'ready for pickup', expectedDate: '' };
  // Everything is in: due out a few days after the later of the order and
  // its last book's release.
  const lastDue = items.map(i => i.onSaleDate).filter(Boolean).sort().pop() || '';
  const start = [dayOf(createdAt), lastDue].filter(Boolean).sort().pop() || '';
  const shipBy = start ? addDays(start, SHIP_LATE_AFTER_DAYS) : '';
  if (shipBy && shipBy < today) return { status: 'late', reason: 'everything is in but not shipped -- should have gone out by ' + shipBy, expectedDate: '' };
  return { status: 'ready', reason: shipBy ? 'ship by ' + shipBy : 'ready to ship', expectedDate: '' };
}

const PRESALE_SOURCES = new Set(['foc_presale', 'foc_presale_bundle']);
export const presaleTitleKey = t => String(t || '').replace(/\s*-\s*PRESALE\s*$/i, '').replace(/\s+/g, ' ').trim().toLowerCase();

// payments/lines/inventory come from pos_* + inventory_items; website orders
// from storefront_orders and foc_preorder_orders. Pure, so it's testable.
export function buildOrdersBoard({
  payments = [], lines = [], inventoryById = new Map(), receivedSkuIds = new Set(),
  storefrontOrders = [], storefrontLines = [], focOrders = [], focItems = [],
  shippedMarks = new Set(), skuByTitle = new Map(), today,
}) {
  const linesBySale = new Map();
  for (const l of lines) { const list = linesBySale.get(l.sale_id) || []; list.push(l); linesBySale.set(l.sale_id, list); }
  const itemFromLine = l => {
    let row = inventoryById.get(l.item_id) || null;
    // A sale line not linked to inventory still says what it was: a
    // " - PRESALE" title is a book that hasn't come in -- and the FOC
    // catalog, matched by title, says which one and when it's due.
    const unlinkedPresale = !row && /-\s*PRESALE\s*$/i.test(String(l.title || ''));
    if (unlinkedPresale) {
      const sku = skuByTitle.get(presaleTitleKey(l.title));
      if (sku) row = { status: 'presale', src: 'foc_presale', focSkuId: sku.id, onSaleDate: sku.on_sale_date };
    }
    const isPresale = row ? (row.status === 'presale' || PRESALE_SOURCES.has(row.src)) && row.converted !== 'true' : unlinkedPresale;
    const received = !!row && (row.converted === 'true' || (row.focSkuId && receivedSkuIds.has(row.focSkuId)));
    const st = orderItemState({ isPresale, received, onSaleDate: dayOf(row?.onSaleDate) }, today);
    return { title: text(l.title || row?.name, 160).replace(/\s*-\s*PRESALE\s*$/i, ''), qty: Math.max(1, Number(l.quantity || 1)), price: Number(l.unit_price || 0), image: l.image_url || '', itemId: l.item_id || '', ...st };
  };

  // eBay and Whatnot: one order per marketplace order id, which can span
  // several of our sales (one per line item).
  const market = new Map();
  for (const p of payments) {
    const provider = String(p.provider || '').toLowerCase();
    if (provider !== 'ebay' && provider !== 'whatnot') continue;
    const ref = String(p.reference || '');
    const orderId = provider === 'ebay'
      ? text(p.provider_metadata?.ebayOrderId || ref, 60)
      : text(ref.replace(/^whatnot:/i, '').split(':')[0] || p.sale_id, 60);
    if (!orderId) continue;
    const key = provider + ':' + orderId;
    const o = market.get(key) || { channel: provider, id: orderId, number: orderId, buyer: text(p.provider_metadata?.buyer || p.provider_metadata?.buyerUsername || '', 80), createdAt: p.created_at, total: 0, items: [], labelled: false, saleIds: new Set() };
    if (String(p.created_at || '') < String(o.createdAt || '')) o.createdAt = p.created_at;
    o.total += Number(p.amount || 0);
    if ((p.provider_metadata?.labelTransactionIds || []).length) o.labelled = true;
    if (!o.saleIds.has(p.sale_id)) { o.saleIds.add(p.sale_id); for (const l of linesBySale.get(p.sale_id) || []) o.items.push(itemFromLine(l)); }
    market.set(key, o);
  }
  const finish = o => {
    const shipped = !!o.shipped || o.labelled || shippedMarks.has(o.channel + ':' + o.id);
    const { status, reason, expectedDate } = orderStatus({ items: o.items, shipped, createdAt: o.createdAt, today, pickup: !!o.pickup });
    const { saleIds, labelled, ...rest } = o;
    return { ...rest, total: Math.round(Number(o.total || 0) * 100) / 100, shipped, shippedBy: o.labelled ? 'eBay label' : shipped ? (o.shippedBy || 'marked shipped') : '', status, reason, expectedDate };
  };
  const ebay = [], whatnot = [];
  for (const o of market.values()) (o.channel === 'ebay' ? ebay : whatnot).push(finish(o));

  // Website: shop checkouts and comic preorders.
  const website = [];
  const sfLinesBySale = new Map();
  for (const l of storefrontLines) { const list = sfLinesBySale.get(l.sale_id) || []; list.push(l); sfLinesBySale.set(l.sale_id, list); }
  for (const s of storefrontOrders) {
    website.push(finish({
      channel: 'website', kind: 'shop', id: s.id, number: s.confirmation_number || s.id.slice(0, 8), buyer: text(s.customer_name, 80),
      createdAt: s.created_at, total: (sfLinesBySale.get(s.sale_id) || []).reduce((n, l) => n + Number(l.unit_price || 0) * Math.max(1, Number(l.quantity || 1)), 0) + Number(s.shipping_fee_cents || 0) / 100,
      method: s.fulfillment_method || '', pickup: /pickup/i.test(s.fulfillment_method || ''), items: (sfLinesBySale.get(s.sale_id) || []).map(itemFromLine),
      shipped: s.fulfillment_status === 'fulfilled', shippedBy: s.fulfillment_method && /pickup/i.test(s.fulfillment_method) ? 'picked up' : 'fulfilled',
    }));
  }
  const focItemsByOrder = new Map();
  for (const it of focItems) { const list = focItemsByOrder.get(it.order_id) || []; list.push(it); focItemsByOrder.set(it.order_id, list); }
  for (const o of focOrders) {
    if (!['paid', 'reserved', 'ready_for_pickup', 'fulfilled'].includes(o.status)) continue;
    const items = (focItemsByOrder.get(o.id) || []).map(it => {
      const s = it.sku || {};
      const st = orderItemState({ isPresale: true, received: o.status === 'ready_for_pickup' || o.status === 'fulfilled' || receivedSkuIds.has(it.sku_id), onSaleDate: dayOf(s.on_sale_date) }, today);
      return { title: [s.title, s.variant_label && !/^cover a$/i.test(s.variant_label) ? s.variant_label : ''].filter(Boolean).join(' · '), qty: Math.max(1, Number(it.quantity || 1)), price: Number(it.unit_price_cents || 0) / 100, image: s.cover_image_url || '', itemId: '', ...st };
    });
    website.push(finish({
      channel: 'website', kind: 'preorder', id: o.id, number: o.order_number || o.id.slice(0, 8), buyer: text(o.customer_name, 80),
      createdAt: o.paid_at || o.created_at, total: Number(o.total_cents || 0) / 100, method: o.fulfillment_method || '', pickup: /pickup/i.test(o.fulfillment_method || ''), items,
      shipped: o.status === 'fulfilled', shippedBy: o.fulfillment_method === 'pickup' ? 'picked up' : 'shipped',
    }));
  }

  const rank = { late: 0, ready: 1, waiting: 2, shipped: 3 };
  const sort = list => list.sort((a, b) => (rank[a.status] - rank[b.status]) || String(a.expectedDate || '9999').localeCompare(String(b.expectedDate || '9999')) || String(b.createdAt).localeCompare(String(a.createdAt)));
  const counts = list => list.reduce((c, o) => { c[o.status] = (c[o.status] || 0) + 1; return c; }, { late: 0, ready: 0, waiting: 0, shipped: 0 });
  return {
    today,
    channels: { ebay: sort(ebay), whatnot: sort(whatnot), website: sort(website) },
    counts: { ebay: counts(ebay), whatnot: counts(whatnot), website: counts(website) },
  };
}

const inFilter = ids => 'in.(' + ids.map(id => '"' + String(id).replace(/"/g, '') + '"').join(',') + ')';

export async function handleOrdersBoard(request, env, deps, url) {
  const storeId = text(url.searchParams.get('store_id') || url.searchParams.get('store'), 80);
  const auth = await deps.requireStoreUser(request, env, storeId, ['owner', 'admin', 'manager', 'employee']);
  if (auth.error) return auth.error;
  const db = path => deps.supabaseAdminFetch(env, path);
  const sid = encodeURIComponent(storeId);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
  // Open orders are kept however old; shipped ones show for the last 30 days.
  const since = new Date(Date.now() - 120 * DAY).toISOString();

  const { data: payments } = await db(`pos_payments?store_id=eq.${sid}&provider=in.(ebay,whatnot)&created_at=gte.${encodeURIComponent(since)}&select=sale_id,reference,provider,amount,created_at,provider_metadata&order=created_at.desc&limit=2000`);
  const saleIds = [...new Set((payments || []).map(p => p.sale_id).filter(Boolean))];
  let lines = [];
  for (let i = 0; i < saleIds.length; i += 150) {
    const { data } = await db(`pos_sale_lines?store_id=eq.${sid}&sale_id=${inFilter(saleIds.slice(i, i + 150))}&select=sale_id,item_id,title,quantity,unit_price,image_url`);
    lines = lines.concat(data || []);
  }
  const { data: storefrontOrders } = await db(`storefront_orders?store_id=eq.${sid}&created_at=gte.${encodeURIComponent(since)}&select=id,sale_id,confirmation_number,customer_name,fulfillment_method,fulfillment_status,shipping_fee_cents,created_at&order=created_at.desc&limit=500`);
  const sfSaleIds = [...new Set((storefrontOrders || []).map(s => s.sale_id).filter(Boolean))];
  let storefrontLines = [];
  for (let i = 0; i < sfSaleIds.length; i += 150) {
    const { data } = await db(`pos_sale_lines?store_id=eq.${sid}&sale_id=${inFilter(sfSaleIds.slice(i, i + 150))}&select=sale_id,item_id,title,quantity,unit_price,image_url`);
    storefrontLines = storefrontLines.concat(data || []);
  }
  const itemIds = [...new Set(lines.concat(storefrontLines).map(l => l.item_id).filter(id => /^[0-9a-f-]{36}$/i.test(String(id || ''))))];
  const inventoryById = new Map();
  for (let i = 0; i < itemIds.length; i += 150) {
    const { data } = await db(`inventory_items?store_id=eq.${sid}&id=${inFilter(itemIds.slice(i, i + 150))}&select=id,status,src:data->>source,onSaleDate:data->>onSaleDate,focSkuId:data->>focSkuId,converted:data->>ebayPresaleConverted,name:data->>name`);
    for (const r of data || []) inventoryById.set(r.id, r);
  }
  const { data: focOrders } = await db(`foc_preorder_orders?store_id=eq.${sid}&status=in.(paid,reserved,ready_for_pickup,fulfilled)&created_at=gte.${encodeURIComponent(since)}&select=id,order_number,status,customer_name,fulfillment_method,total_cents,paid_at,created_at&limit=500`);
  const focIds = (focOrders || []).map(o => o.id);
  let focItems = [];
  for (let i = 0; i < focIds.length; i += 150) {
    const { data } = await db(`foc_preorder_items?order_id=${inFilter(focIds.slice(i, i + 150))}&select=order_id,sku_id,quantity,unit_price_cents,sku:comic_skus(title,variant_label,on_sale_date,cover_image_url)`);
    focItems = focItems.concat(data || []);
  }
  const skuByTitle = new Map();
  const unlinkedTitles = [...new Set(lines.concat(storefrontLines).filter(l => !inventoryById.has(l.item_id) && /-\s*PRESALE\s*$/i.test(String(l.title || ''))).map(l => String(l.title).replace(/\s*-\s*PRESALE\s*$/i, '').trim()))];
  for (let i = 0; i < unlinkedTitles.length; i += 50) {
    const { data } = await db(`comic_skus?store_id=eq.${sid}&title=${inFilter(unlinkedTitles.slice(i, i + 50))}&select=id,title,on_sale_date`);
    for (const k of data || []) skuByTitle.set(presaleTitleKey(k.title), k);
  }
  const skuIds = [...new Set([...inventoryById.values()].map(r => r.focSkuId).concat(focItems.map(it => it.sku_id), [...skuByTitle.values()].map(k => k.id)).filter(Boolean))];
  // A book is in once any real copy of it is: received from FOC, or entered
  // by hand and tied to the catalog (a connecting cover that went straight
  // into its bundle, say) -- anything but the presale listing itself.
  const receivedSkuIds = new Set();
  for (let i = 0; i < skuIds.length; i += 150) {
    const { data } = await db(`inventory_items?store_id=eq.${sid}&data->>focSkuId=${inFilter(skuIds.slice(i, i + 150))}&select=sku:data->>focSkuId,src:data->>source`);
    for (const r of data || []) if (!PRESALE_SOURCES.has(r.src)) receivedSkuIds.add(r.sku);
  }
  const shippedMarks = new Set();
  if (env.LBA_KV) {
    try {
      let cursor;
      do {
        const page = await env.LBA_KV.list({ prefix: `order-shipped:${storeId}:`, cursor });
        for (const k of page.keys || []) shippedMarks.add(k.name.slice(`order-shipped:${storeId}:`.length));
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
    } catch (_) {}
  }
  const board = buildOrdersBoard({ payments: payments || [], lines, inventoryById, receivedSkuIds, storefrontOrders: storefrontOrders || [], storefrontLines, focOrders: focOrders || [], focItems, shippedMarks, skuByTitle, today });
  // Shipped orders older than 30 days just clutter the board.
  const cutoff = new Date(Date.now() - 30 * DAY).toISOString();
  for (const k of Object.keys(board.channels)) board.channels[k] = board.channels[k].filter(o => o.status !== 'shipped' || String(o.createdAt) >= cutoff);
  return deps.json({ ok: true, ...board });
}

// Whatnot (and eBay orders shipped with a label bought somewhere else)
// have no automatic "shipped" signal here -- the store marks them.
export async function handleOrderMarkShipped(request, env, deps) {
  let body = {};
  try { body = await request.json(); } catch (_) {}
  const storeId = text(body.storeId, 80);
  const auth = await deps.requireStoreUser(request, env, storeId, ['owner', 'admin', 'manager', 'employee']);
  if (auth.error) return auth.error;
  const channel = String(body.channel || '').toLowerCase();
  const orderId = text(body.orderId, 80);
  if (!['ebay', 'whatnot'].includes(channel) || !orderId) return deps.json({ ok: false, error: 'channel (ebay or whatnot) and orderId required' }, 400);
  if (!env.LBA_KV) return deps.json({ ok: false, error: 'Storage is not configured' }, 501);
  const key = `order-shipped:${storeId}:${channel}:${orderId}`;
  if (body.shipped === false) await env.LBA_KV.delete(key);
  else await env.LBA_KV.put(key, JSON.stringify({ at: new Date().toISOString(), by: auth.user?.id || '' }), { expirationTtl: 60 * 60 * 24 * 400 });
  return deps.json({ ok: true, shipped: body.shipped !== false });
}
