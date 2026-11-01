// Whatnot Seller API -- selling (store, 2026-10-31: "Anything I checkbox
// will be put on whatnot and synced. Whenever we run a price update, the
// whatnot should update also." Same price as the dashboard, Buy It Now any
// time, simple shipping profiles).
//
// Listings: an item with data.sellOnWhatnot === true is created on Whatnot
// (external_id = our inventory id) and kept 1:1 on quantity and price. An
// item unchecked, sold out or archived goes to 0 there. The link to the
// Whatnot product (ids, last price/quantity sent, last error) is kept in KV,
// not in the item's data: the dashboard saves an item's whole data from its
// own copy, which would wipe a server-written id and make the next sync
// create a duplicate listing.
//
// Sales: orders.created / orders.updated (and a reconciliation pass over
// recent orders) record each order item through the Worker's
// /inventory/record-external-sale (stock, consignment, eBay follow it); a
// cancelled or failed order voids those sales and puts the stock back.
//
// API: https://developers.whatnot.com (REST v2, Bearer token, 10 req/s).

export const WHATNOT_API = 'https://api.whatnot.com/seller-api/rest/v2';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const isUuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
const money = n => ({ amount: (Math.round(Number(n) * 100) / 100).toFixed(2), currency: 'USD' });

export function whatnotClient(env, { fetchImpl = fetch, wait = sleep } = {}) {
  const key = String(env.WHATNOT_API_KEY || '').trim().replace(/^bearer\s+/i, '');
  return async function api(method, path, body) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(WHATNOT_API + path, {
        method,
        headers: { Authorization: 'Bearer ' + key, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await wait(Math.min(8, Number(res.headers.get('retry-after')) || 1) * 1000 * (attempt + 1));
        continue;
      }
      const data = res.status === 204 ? null : await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, data };
    }
  };
}

export function whatnotErrorText(r) {
  const d = r?.data || {};
  if (Array.isArray(d.detail)) return d.detail.map(e => [Array.isArray(e.loc) ? e.loc.slice(1).join('.') : '', e.msg].filter(Boolean).join(': ')).join('; ').slice(0, 300);
  return [d.title, d.detail].filter(Boolean).join(': ').slice(0, 300) || 'Whatnot answered ' + (r?.status || 'nothing');
}
// Worth trying again later (rate limit, Whatnot down), vs. a problem with the item.
const retryable = r => !r || r.status === 429 || r.status >= 500;

// --- Category and shipping ---------------------------------------------------
// Whatnot's product taxonomy (github.com/Whatnot-Inc/product-taxonomy):
// leaf categories that take inventory.
const SPORT_SINGLES = [[/baseball/, 586], [/football/, 590], [/basketball/, 593], [/hockey/, 599], [/soccer/, 574], [/wrestling/, 602], [/ufc|mma/, 596], [/tennis/, 2666], [/nascar/, 610], [/f1|formula/, 607]];
export function whatnotCategoryId(item) {
  switch (item.categorySlug) {
    case 'pokemon': return '2';
    case 'mtg': return '9';
    case 'yugioh': return '8';
    case 'one-piece': return '567';
    case 'lorcana': return '2013';
    case 'supplies': return '269';
    case 'comics': { const y = Number(item.year); return y > 0 && y < 1985 ? '243' : '244'; }
    case 'sports-cards': {
      const s = [item.sport, item.category, item.name].join(' ').toLowerCase();
      const hit = SPORT_SINGLES.find(([re]) => re.test(s));
      return String(hit ? hit[1] : 139);
    }
    default: return null;
  }
}
// Simple shipping profiles, made on Whatnot the first time each is needed.
export const WHATNOT_PROFILES = {
  card: { name: 'Card', weight: { value: 1, unit: 'ounce' }, dimensions: { length: 6, width: 4, height: 0.5, unit: 'inch' } },
  slab: { name: 'Graded card', weight: { value: 4, unit: 'ounce' }, dimensions: { length: 8, width: 5, height: 1, unit: 'inch' } },
  comic: { name: 'Comic', weight: { value: 8, unit: 'ounce' }, dimensions: { length: 12, width: 8, height: 1, unit: 'inch' } },
  box: { name: 'Box', weight: { value: 1, unit: 'pound' }, dimensions: { length: 10, width: 8, height: 4, unit: 'inch' } },
};
export function whatnotProfileKind(item) {
  if (item.categorySlug === 'comics') return 'comic';
  if (item.isSealed || ['supplies', 'collectibles', 'other'].includes(item.categorySlug)) return 'box';
  if (item.gradingCompany) return 'slab';
  return 'card';
}

// --- What Whatnot should show ------------------------------------------------
// item: the Worker's shapeStorefrontItem(row) -- the website's own price
// rule, photos and category. data: the row's raw data.
export function whatnotDesired(row, item, { autoTitles = true } = {}) {
  const d = row.data || {};
  const categoryId = whatnotCategoryId(item);
  const status = String(d.lifecycle || d.status || row.status || 'in_stock').toLowerCase();
  const wanted = d.sellOnWhatnot === true;
  const sellable = wanted && !['sold', 'archived', 'deleted', 'presale'].includes(status) && !item.awaitingReceipt && !item.dropship;
  const qty = sellable ? Math.max(0, Math.min(9999, Math.floor(Number(d.quantity ?? d.qty ?? 1) || 0))) : 0;
  const price = Math.round((Number(item.price) || 0) * 100) / 100;
  const details = [item.set, item.year, item.cardNumber ? '#' + item.cardNumber : '', item.variant, item.condition].filter(Boolean).join(' · ');
  return {
    wanted,
    qty,
    price,
    title: (autoTitles ? whatnotTitle(item, d) : String(item.name || 'Item')).slice(0, 200),
    // Whatnot won't publish without a description.
    description: [details, item.description].filter(Boolean).join('\n\n').slice(0, 4000) || String(item.name || 'Item').slice(0, 4000),
    categoryId,
    attributes: categoryId ? whatnotAttributes(item, d, categoryId) : [],
    profileKind: whatnotProfileKind(item),
    media: (item.photos || []).filter(u => /^https:\/\//i.test(u)).slice(0, 8).map(url => ({ url })),
  };
}
// What a listing's title/description/details and photos were last sent as,
// so a change goes out once (the same listing is edited, never replaced).
export function whatnotContentKeys(want) {
  return {
    contentKey: JSON.stringify([want.title, want.description, want.attributes || []]),
    mediaKey: JSON.stringify((want.media || []).map(m => m.url)),
  };
}

// --- One item ----------------------------------------------------------------
// link: what we last did on Whatnot for it ({productId, variantId, price,
// qty, error, url}) or null. Returns the new link (null = nothing to keep)
// and whether to try again on the next run.
export async function syncWhatnotItem(api, row, item, link, { profileId, saveProfileId, newKey = () => crypto.randomUUID(), autoTitles = true } = {}) {
  const want = whatnotDesired(row, item, { autoTitles: autoTitles !== false });
  const base = { ...(link || {}), name: want.title };
  const fail = (r, why) => ({ link: { ...base, error: why || whatnotErrorText(r), errorAt: new Date().toISOString() }, retry: retryable(r), action: 'error' });
  let productId = link?.productId || '', variantId = link?.variantId || '';

  if (!productId) {
    if (want.qty <= 0) return { link: link?.error ? null : link, retry: false, action: 'none' };
    if (!want.categoryId) return { link: { ...base, error: 'No Whatnot category for "' + (item.category || 'this category') + '"', errorAt: new Date().toISOString() }, retry: false, action: 'error' };
    if (!(want.price > 0)) return { link: { ...base, error: 'No price', errorAt: new Date().toISOString() }, retry: false, action: 'error' };
    const knownProfile = await profileId?.(want.profileKind);
    const product = {
      title: want.title, description: want.description, external_id: row.id,
      category: { id: want.categoryId }, media: want.media, attributes: want.attributes,
      dimension_profile: knownProfile ? { id: knownProfile } : WHATNOT_PROFILES[want.profileKind],
    };
    let created = await api('POST', '/products', product);
    // Item details are extra: if Whatnot turns one down, list it without them.
    if (!created.ok && created.status === 422 && want.attributes.length) { created = await api('POST', '/products', { ...product, attributes: [] }); base.detailsNote = 'Item details not accepted by Whatnot'; }
    if (!created.ok || !created.data?.id) return fail(created);
    productId = created.data.id;
    if (!knownProfile && created.data.dimension_profile?.id) await saveProfileId?.(want.profileKind, String(created.data.dimension_profile.id));
    const variants = await api('GET', `/products/${encodeURIComponent(productId)}/variants?limit=5`);
    variantId = variants.data?.data?.[0]?.id || '';
    if (!variantId) return fail(variants, 'Whatnot made the product but no variant came back');
    Object.assign(base, { productId, variantId, url: created.data.url || '', createdAt: new Date().toISOString(), price: null, qty: null }, whatnotContentKeys(want));
  }

  let action = link?.productId ? 'none' : 'created';
  // Title, description, details and photos edited here go to the same
  // listing (PATCH, never a new one): its saves and bookmarks stay.
  // (Not for a listing being taken down: a deleted item has nothing to send.)
  if (link?.productId && want.qty > 0) {
    const keys = whatnotContentKeys(want);
    const patch = {};
    if (base.contentKey !== keys.contentKey) Object.assign(patch, { title: want.title, description: want.description, attributes: want.attributes });
    if (base.mediaKey !== keys.mediaKey && want.media.length) patch.media = want.media;
    if (Object.keys(patch).length) {
      let r = await api('PATCH', `/products/${encodeURIComponent(productId)}`, patch);
      if (!r.ok && r.status === 422 && patch.attributes?.length) { r = await api('PATCH', `/products/${encodeURIComponent(productId)}`, { ...patch, attributes: undefined }); base.detailsNote = 'Item details not accepted by Whatnot'; }
      if (r.status === 404) return { link: null, retry: true, action: 'gone' };
      if (!r.ok) return fail(r);
      Object.assign(base, keys);
      action = 'updated';
    }
  }
  if (want.qty > 0 && want.price > 0 && base.price !== want.price) {
    const priced = await api('PATCH', `/products/${encodeURIComponent(productId)}/variants`, { variants: [{ id: variantId, external_id: row.id, pricing: { buy_it_now: { price: money(want.price) } } }] });
    if (priced.status === 404) return { link: null, retry: true, action: 'gone' }; // deleted on Whatnot: made again next run
    if (!priced.ok) return fail(priced);
    base.price = want.price;
    if (action === 'none') action = 'updated';
  }
  if (base.qty !== want.qty) {
    const set = await api('POST', '/inventory/set', { items: [{ variant_id: variantId, quantity: want.qty, idempotency_key: newKey() }] });
    const status = set.data?.results?.[0]?.status;
    if (status === 'variant_not_found') return { link: null, retry: want.qty > 0, action: 'gone' };
    if (!set.ok || !['applied', 'already_applied'].includes(status)) return fail(set, set.ok ? 'Whatnot did not set the quantity (' + (status || 'no result') + ')' : '');
    base.qty = want.qty;
    if (action === 'none') action = 'updated';
  }
  // Published to the shop as Buy It Now any time (not held for live shows)
  // only now: Whatnot publishes a product once it has a price, inventory,
  // a description and a photo. 2026-10-31: this ran right after creating
  // the product, before the price and quantity, so Whatnot kept the first
  // listing as a draft. A draft is tried again on every run until it goes.
  if (want.qty > 0 && base.published !== true) {
    const merch = await api('POST', `/merchandising/products/${encodeURIComponent(productId)}`, { transaction_type: 'buy_it_now', reserve_for_live: false });
    if (merch.ok) { base.published = true; delete base.note; if (action === 'none') action = 'updated'; }
    else base.note = 'Draft on Whatnot (not in your shop yet): ' + whatnotErrorText(merch);
  }
  delete base.error; delete base.errorAt;
  base.syncedAt = new Date().toISOString();
  return { link: base, retry: false, action };
}

// --- The store's checked items -----------------------------------------------
// deps: db(path, opts), kvGet(key), kvPut(key, value), api, shape(row).
// Only items whose updated_at moved since the last run are looked at, so a
// quiet run is one small query.
export async function runWhatnotListingSync(storeId, deps, { limit = 25, force = false } = {}) {
  const s = encodeURIComponent(storeId);
  const { data: index } = await deps.db(`inventory_items?store_id=eq.${s}&data->>sellOnWhatnot=eq.true&select=id,updated_at&limit=5000`);
  const seenKey = 'whatnot-sync-seen:' + storeId;
  const seen = (!force && await deps.kvGet(seenKey)) || {};
  const linkedState = (await deps.kvGet('whatnot-linked:' + storeId)) || {};
  const linkedIds = new Set(Object.keys(linkedState));
  const ids = new Map((index || []).map(r => [r.id, r.updated_at]));
  // Linked items that lost the checkbox and also got edited, deleted or
  // went missing from the index are checked too, so they go to 0.
  for (const id of linkedIds) if (!ids.has(id)) ids.set(id, 'missing');
  // A listing not confirmed published (a draft, or made before publishing
  // was checked) is tried again every run.
  const todo = [...ids].filter(([id, at]) => seen[id] !== at || linkedIds.has(id) && linkedState[id] !== 'ok').slice(0, limit);
  const out = { checked: 0, created: 0, updated: 0, errors: [], more: Math.max(0, [...ids].filter(([id, at]) => seen[id] !== at).length - limit) };
  if (!todo.length) return out;
  const rows = new Map();
  for (let i = 0; i < todo.length; i += 50) {
    const chunk = todo.slice(i, i + 50).map(([id]) => id);
    const { data } = await deps.db(`inventory_items?store_id=eq.${s}&id=in.(${chunk.map(encodeURIComponent).join(',')})&select=id,status,updated_at,data`);
    for (const r of data || []) rows.set(r.id, r);
  }
  const linked = (await deps.kvGet('whatnot-linked:' + storeId)) || {};
  const profileIds = (await deps.kvGet('whatnot-profiles:' + storeId)) || {};
  for (const [id, at] of todo) {
    // A deleted item, or one no longer checked: treated as unchecked.
    const row = rows.get(id) || { id, status: 'deleted', data: {} };
    const linkKey = `whatnot-link:${storeId}:${id}`;
    const link = await deps.kvGet(linkKey);
    out.checked++;
    try {
      const r = await syncWhatnotItem(deps.api, row, deps.shape(row), link, {
        autoTitles: deps.listingSettings?.autoTitles !== false,
        profileId: kind => profileIds[kind] || '',
        saveProfileId: async (kind, pid) => { profileIds[kind] = pid; await deps.kvPut('whatnot-profiles:' + storeId, profileIds); },
      });
      if (r.link) { await deps.kvPut(linkKey, r.link); linked[id] = r.link.productId && r.link.published !== true && Number(r.link.qty) > 0 ? 'draft' : 'ok'; }
      else if (link) { await deps.kvPut(linkKey, null); delete linked[id]; }
      if (r.action === 'created') out.created++;
      if (r.action === 'updated') out.updated++;
      if (r.link?.error) out.errors.push({ id, name: r.link.name || '', error: r.link.error });
      if (!r.retry) seen[id] = at;
    } catch (e) {
      out.errors.push({ id, name: row.data?.name || '', error: e.message });
    }
  }
  for (const id of Object.keys(seen)) if (!ids.has(id)) delete seen[id];
  await deps.kvPut(seenKey, seen);
  await deps.kvPut('whatnot-linked:' + storeId, linked);
  return out;
}

// --- Orders ------------------------------------------------------------------
// Its own prefix: the show-report import (whatnot-bridge.js) uses whatnot:,
// and skips sales already recorded under this one.
export const whatnotOrderRef = (orderId, itemId) => `whatnot-api:${orderId}:${itemId}`;
const ACTIVE_ORDER = new Set(['pending', 'pending_fulfillment', 'completed']);
// Whatnot's standard seller fees: 8% commission, plus 2.9% + $0.30 payment
// processing per order -- unless the store set its own (receipt settings
// whatnotFeePct / whatnotFeeFlat).
export function whatnotFee(amount, settings = {}, { first = true } = {}) {
  const pct = settings.whatnotFeePct != null && settings.whatnotFeePct !== '' ? Number(settings.whatnotFeePct) : 10.9;
  const flat = settings.whatnotFeeFlat != null && settings.whatnotFeeFlat !== '' ? Number(settings.whatnotFeeFlat) : 0.3;
  return Math.round(((Number(amount) || 0) * pct / 100 + (first ? flat : 0)) * 100) / 100;
}

// deps: api, recordSale(body) -> {ok, status, data}, voidOrder(orderId) ->
// voided count, feeSettings, kvGet, kvPut, storeId.
export async function processWhatnotOrder(order, deps) {
  const orderId = String(order?.id || '');
  if (!orderId) return { skipped: 'no order id' };
  const doneKey = `whatnot-order:${deps.storeId}:${orderId}`;
  const done = await deps.kvGet(doneKey);
  const status = String(order.status || '');
  if (status === 'cancelled' || status === 'failed') {
    if (done === 'voided') return { orderId, status, skipped: 'already voided' };
    const voided = await deps.voidOrder(orderId);
    await deps.kvPut(doneKey, 'voided');
    return { orderId, status, voided };
  }
  if (!ACTIVE_ORDER.has(status)) return { orderId, status, skipped: 'status' };
  if (done) return { orderId, status, skipped: 'already recorded' };
  const items = [];
  let cursor = '';
  for (let page = 0; page < 10; page++) {
    const r = await deps.api('GET', `/orders/${encodeURIComponent(orderId)}/items?limit=50${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`);
    if (!r.ok) throw new Error('Whatnot order items: ' + whatnotErrorText(r));
    items.push(...(r.data?.data || []));
    cursor = r.data?.next_cursor || '';
    if (!cursor) break;
  }
  const recorded = [];
  let first = true;
  const giveawayOrder = order.transaction_type === 'giveaway';
  for (const it of items) {
    const quantity = Math.max(1, Number(it.quantity) || 1);
    const salePrice = Math.round((Number(it.unit_price?.amount) || 0) * quantity * 100) / 100;
    const ours = [it.variant_external_id, it.product_external_id].find(isUuid) || '';
    const title = String(it.purchased_item?.title || 'Whatnot sale').slice(0, 200);
    // A giveaway still uses up the item: recorded at $0 so its cost counts.
    const giveaway = giveawayOrder || !(salePrice > 0);
    // A listing made straight on Whatnot has no inventory item: its cost
    // comes from Settings -> Whatnot (whatnotListingCost).
    const unitCost = ours ? null : whatnotListingCost(title, deps.listingSettings);
    const body = { itemId: ours, title, channel: 'Whatnot', salePrice: giveaway ? 0 : salePrice, quantitySold: quantity, soldAt: order.created_at || new Date().toISOString(),
      feeAmount: giveaway ? 0 : whatnotFee(salePrice, deps.feeSettings, { first }), externalRef: whatnotOrderRef(orderId, it.id), ...(giveaway ? { giveaway: true } : {}),
      ...(unitCost != null ? { cost: Math.round(unitCost * quantity * 100) / 100 } : {}) };
    if (!giveaway) first = false;
    // A Whatnot-only giveaway is recorded only when it has a cost to count.
    if (giveaway && !ours && !(unitCost > 0)) { recorded.push({ itemId: '', title, giveaway: true, skipped: 'not ours' }); continue; }
    let r = await deps.recordSale(body);
    // Already sold here, or not one of ours any more: the money still counts.
    if (!r.ok && ours && !giveaway && (r.status === 404 || r.status === 409)) r = await deps.recordSale({ ...body, itemId: '' });
    if (!r.ok && giveaway && (r.status === 404 || r.status === 409)) { recorded.push({ itemId: ours, title, giveaway: true, skipped: 'already gone' }); continue; }
    if (!r.ok) throw new Error('Could not record Whatnot sale ' + orderId + ': ' + (r.data?.error || r.status));
    recorded.push({ itemId: ours, title, salePrice: body.salePrice, quantity, giveaway, duplicate: !!r.data?.duplicate, unlinked: !!r.data?.unlinked });
  }
  await deps.kvPut(doneKey, 'recorded');
  return { orderId, status, recorded };
}

// Recent orders, in case a webhook was missed.
export async function reconcileWhatnotOrders(deps, { pages = 2 } = {}) {
  const results = [];
  let cursor = '';
  for (let page = 0; page < pages; page++) {
    const r = await deps.api('GET', `/orders?limit=50${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`);
    if (!r.ok) throw new Error('Whatnot orders: ' + whatnotErrorText(r));
    // Buyer, show and status for the orders board, one write per page.
    try { await deps.noteOrders?.(r.data?.data || []); } catch (_) {}
    for (const order of r.data?.data || []) {
      try { results.push(await processWhatnotOrder(order, deps)); }
      catch (e) { results.push({ orderId: order.id, error: e.message }); }
    }
    cursor = r.data?.next_cursor || '';
    if (!cursor) break;
  }
  return results;
}

// --- Shows -------------------------------------------------------------------
// Store, 2026-10-31: "I want show sales to auto calc all the stuff" -- no
// report import. Each Whatnot show is kept in whatnot_shows (by its Whatnot
// id) with the same report_summary PAST SHOWS reads: gross, fees, cost of
// goods, giveaways, net, buyers. Until Whatnot's own show analytics are
// ready the fees are estimated; after that they are Whatnot's real
// numbers (fees = gross sales - estimated earnings, giveaway shipping
// included) and the show is final.
export const WHATNOT_SHOW_STATUS = { scheduled: 'planning', live: 'live', stopped: 'live', ended: 'ended' };
const amount = m => Number(m?.amount) || 0;
const r2 = n => Math.round(n * 100) / 100;

// The show's orders, newest first, stopping once past the show's start.
export async function whatnotShowOrders(api, showId, sinceIso) {
  const out = [];
  let cursor = '';
  for (let page = 0; page < 40; page++) {
    const r = await api('GET', `/orders?limit=50${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`);
    if (!r.ok) throw new Error('Whatnot orders: ' + whatnotErrorText(r));
    const data = r.data?.data || [];
    for (const o of data) if (o.show_id === showId) out.push(o);
    cursor = r.data?.next_cursor || '';
    const oldest = data[data.length - 1]?.created_at || '';
    if (!cursor || (sinceIso && oldest && oldest < sinceIso)) break;
  }
  return out;
}

// costs: { [orderId]: cost of our items in it } from the recorded sales.
export function summarizeWhatnotShow({ orders, analytics, costs = {}, feeSettings = {}, now = new Date() }) {
  const live = (orders || []).filter(o => !['cancelled', 'failed'].includes(o.status));
  const isGiveaway = o => o.transaction_type === 'giveaway' || !(amount(o.amounts?.subtotal) > 0);
  const sold = live.filter(o => !isGiveaway(o)), given = live.filter(isGiveaway);
  const final = analytics?.calculation_status === 'GENERATED' && analytics.sales != null && analytics.estimated_earnings != null;
  const ordersGross = sold.reduce((n, o) => n + amount(o.amounts?.subtotal), 0);
  const gross = final ? amount(analytics.sales) : ordersGross;
  const fees = final ? Math.max(0, gross - amount(analytics.estimated_earnings)) : sold.reduce((n, o) => n + whatnotFee(amount(o.amounts?.subtotal), feeSettings), 0);
  const cogs = sold.reduce((n, o) => n + (Number(costs[o.id]) || 0), 0);
  const giveawayCost = given.reduce((n, o) => n + (Number(costs[o.id]) || 0), 0);
  const net = gross - fees - cogs - giveawayCost;
  const byBuyer = {};
  for (const o of sold) {
    const name = o.buyer?.username || o.buyer?.display_name;
    if (!name) continue;
    const b = byBuyer[name] || (byBuyer[name] = { buyer: name, items: 0, total: 0 });
    b.items++; b.total = r2(b.total + amount(o.amounts?.subtotal));
  }
  return {
    source: 'whatnot', final, savedAt: now.toISOString(),
    gross: r2(gross), fees: r2(fees), cogs: r2(cogs), giveawayCost: r2(giveawayCost), shipping: 0, net: r2(net),
    margin: gross > 0 ? Math.round(net / gross * 1000) / 10 : 0,
    sold: sold.length, giveaways: given.length, orders: live.length,
    cancelled: (orders || []).length - live.length,
    buyers: Object.values(byBuyer).sort((a, b) => b.total - a.total),
    buyersCount: analytics?.buyers_count ?? Object.keys(byBuyer).length,
    peakViewers: analytics?.max_concurrent_viewers ?? null,
    earnings: final ? r2(amount(analytics.estimated_earnings)) : null,
    missingCost: sold.filter(o => costs[o.id] == null).length,
  };
}

// deps: api, costsForOrders(orderIds) -> {orderId: cost}, upsertShow(row),
// kvGet, kvPut, storeId, feeSettings.
export async function refreshWhatnotShow(showOrId, deps, { withSummary = true } = {}) {
  const show = typeof showOrId === 'object' ? showOrId : (await deps.api('GET', `/shows/${encodeURIComponent(showOrId)}`)).data;
  if (!show?.id) return { skipped: 'no show' };
  const status = WHATNOT_SHOW_STATUS[show.status];
  if (!status) return { showId: show.id, skipped: show.status };
  const finalKey = `whatnot-show-final:${deps.storeId}:${show.id}`;
  const row = { whatnot_show_id: show.id, platform: 'whatnot', title: String(show.title || 'Whatnot show').slice(0, 200), status, started_at: show.scheduled_start_at || show.created_at || null, ended_at: show.ended_at || null };
  if (status !== 'ended' || !withSummary || await deps.kvGet(finalKey)) { await deps.upsertShow(row); return { showId: show.id, status }; }
  const ana = await deps.api('GET', `/analytics/shows/${encodeURIComponent(show.id)}`);
  const analytics = ana.ok ? ana.data : null;
  if (analytics?.start_time) row.started_at = analytics.start_time;
  const since = new Date(Date.parse(row.started_at || show.created_at || Date.now()) - 6 * 3600 * 1000).toISOString();
  const orders = await whatnotShowOrders(deps.api, show.id, since);
  const costs = await deps.costsForOrders(orders.map(o => o.id));
  row.report_summary = summarizeWhatnotShow({ orders, analytics, costs, feeSettings: deps.feeSettings });
  await deps.upsertShow(row);
  if (row.report_summary.final || analytics?.calculation_status === 'WILL_NOT_BE_CALCULATED') await deps.kvPut(finalKey, 1);
  return { showId: show.id, status, summary: row.report_summary };
}

// Recent shows: kept up to date, and an ended show's numbers refreshed
// until Whatnot's analytics make them final.
export async function refreshRecentWhatnotShows(deps, { limit = 10 } = {}) {
  const r = await deps.api('GET', `/shows?limit=${limit}`);
  if (!r.ok) throw new Error('Whatnot shows: ' + whatnotErrorText(r));
  const out = [];
  const done = new Set();
  for (const show of r.data?.data || []) {
    const recent = show.status !== 'ended' || !show.ended_at || Date.now() - Date.parse(show.ended_at) < 7 * 86400000;
    if (!recent) continue;
    done.add(show.id);
    try { out.push(await refreshWhatnotShow(show, deps)); }
    catch (e) { out.push({ showId: show.id, error: e.message }); }
  }
  // Shows we keep that should have started and haven't been seen ending:
  // asked about one by one. 2026-10-31: the first ten listed didn't include
  // that day's show, so it stayed "planning" with no totals after it ended.
  for (const id of (await deps.openShowIds?.()) || []) {
    if (done.has(id)) continue;
    try { out.push(await refreshWhatnotShow(String(id), deps)); }
    catch (e) { out.push({ showId: id, error: e.message }); }
  }
  return out;
}

// --- Cost of Whatnot-only listings --------------------------------------------
// Store, 2026-11-01: show profit counted listings made straight on Whatnot
// ("Comic Book ManaPocket #12", bundles) at $0 cost. Settings -> Whatnot sets
// a cost per unit by title: rules ("title contains X" -> cost, first match
// wins) and a default. null = no cost set.
export function whatnotListingCost(title, settings = {}) {
  const lc = settings?.listingCosts || {};
  const t = String(title || '').toLowerCase();
  for (const r of Array.isArray(lc.rules) ? lc.rules : []) {
    const m = String(r?.match || '').trim().toLowerCase();
    const c = Number(r?.cost);
    if (m && t.includes(m) && Number.isFinite(c) && c >= 0) return Math.round(c * 100) / 100;
  }
  const d = lc.defaultCost;
  return d !== '' && d != null && Number.isFinite(Number(d)) && Number(d) >= 0 ? Math.round(Number(d) * 100) / 100 : null;
}

// Past Whatnot-only sales still at $0 cost get the cost the settings give
// them (profit drops by the same amount), then ended shows are worked out
// again. deps: db, storeId, listingSettings, refreshShows().
export async function applyWhatnotListingCosts(deps) {
  const s = encodeURIComponent(deps.storeId);
  const out = { lines: 0, total: 0, noRule: 0 };
  const { data: pays } = await deps.db(`pos_payments?store_id=eq.${s}&provider=eq.whatnot&reference=like.whatnot-api:*&select=sale_id&limit=5000`);
  const saleIds = [...new Set((pays || []).map(p => p.sale_id).filter(Boolean))];
  for (let i = 0; i < saleIds.length; i += 100) {
    const { data: lines } = await deps.db(`pos_sale_lines?store_id=eq.${s}&sale_id=in.(${saleIds.slice(i, i + 100).map(encodeURIComponent).join(',')})&item_id=is.null&cost_basis=eq.0&select=id,title,quantity,profit`);
    for (const l of lines || []) {
      const unit = whatnotListingCost(String(l.title || '').replace(/^Giveaway: /, ''), deps.listingSettings);
      if (unit == null || unit <= 0) { out.noRule++; continue; }
      const qty = Math.max(1, Number(l.quantity) || 1);
      const cost = Math.round(unit * qty * 100) / 100;
      await deps.db(`pos_sale_lines?id=eq.${encodeURIComponent(l.id)}&store_id=eq.${s}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
        // Same as record-external-sale's own unlinked lines: the line's whole cost.
        body: JSON.stringify({ cost_basis: cost, profit: Math.round(((Number(l.profit) || 0) - cost) * 100) / 100 }) });
      out.lines++; out.total = Math.round((out.total + cost) * 100) / 100;
    }
  }
  if (deps.refreshShows) out.shows = await deps.refreshShows();
  return out;
}

// --- Add items to a show ------------------------------------------------------
// Store, 2026-11-01: "add to next show". The next scheduled show, soonest first.
// The show that's live now, else the next scheduled one (Live Studio's
// USE LIVE / NEXT SHOW).
export async function currentWhatnotShow(api, now = Date.now()) {
  const r = await api('GET', '/shows?status=live&limit=5');
  const live = r.ok ? (r.data?.data || [])[0] : null;
  if (live) return { id: live.id, title: live.title || '', live: true, startsAt: live.scheduled_start_at || '' };
  const next = await nextWhatnotShow(api, now);
  return next ? { id: next.id, title: next.title || '', live: false, startsAt: next.scheduled_start_at || '' } : null;
}
export async function nextWhatnotShow(api, now = Date.now()) {
  const r = await api('GET', '/shows?status=scheduled&limit=20&reverse=false');
  if (!r.ok) throw new Error('Whatnot shows: ' + whatnotErrorText(r));
  return (r.data?.data || []).filter(sh => Date.parse(sh.scheduled_start_at || '') > now - 3600000)
    .sort((a, b) => Date.parse(a.scheduled_start_at) - Date.parse(b.scheduled_start_at))[0] || null;
}
// Each item's Whatnot product (listed first if it isn't yet) added to the
// show's lineup. deps: api, kvGet, kvPut, storeId, rows(ids) -> inventory
// rows, shape(row), profileId, saveProfileId.
export async function addItemsToWhatnotShow(itemIds, showId, deps, { auction = null } = {}) {
  const results = [];
  const rows = new Map(((await deps.rows(itemIds)) || []).map(r => [r.id, r]));
  const linked = (await deps.kvGet('whatnot-linked:' + deps.storeId)) || {};
  for (const id of itemIds) {
    const row = rows.get(id);
    if (!row) { results.push({ id, error: 'Item not found' }); continue; }
    const linkKey = `whatnot-link:${deps.storeId}:${id}`;
    let link = await deps.kvGet(linkKey);
    if (!link?.productId || link.published !== true) {
      if (row.data?.sellOnWhatnot !== true) { results.push({ id, name: row.data?.name, error: 'Not set to sell on Whatnot' }); continue; }
      const r = await syncWhatnotItem(deps.api, row, deps.shape(row), link, { profileId: deps.profileId, saveProfileId: deps.saveProfileId, autoTitles: deps.listingSettings?.autoTitles !== false });
      if (r.link) { await deps.kvPut(linkKey, r.link); linked[id] = r.link.published === true || !(Number(r.link.qty) > 0) ? 'ok' : 'draft'; }
      link = r.link;
      if (!link?.productId) { results.push({ id, name: row.data?.name, error: link?.error || 'Could not list it on Whatnot' }); continue; }
    }
    // An auction: its starting bid set, then sold in the show (auctions are
    // live-only -- it leaves the shop until BACK TO BUY IT NOW).
    let start = null;
    if (auction) {
      start = auctionStartPrice(auction, Number(link.price) || Number(deps.shape(row).price) || 0);
      const priced = await deps.api('PATCH', `/products/${encodeURIComponent(link.productId)}/variants`, { variants: [{ id: link.variantId, pricing: { auction: { start_price: money(start) } } }] });
      if (!priced.ok) { results.push({ id, name: row.data?.name, error: whatnotErrorText(priced) }); continue; }
    }
    const m = await deps.api('POST', `/merchandising/products/${encodeURIComponent(link.productId)}`, { ...(auction ? { transaction_type: 'auction' } : {}), shows: { strategy: 'ADD', show_ids: [showId] } });
    if (m.ok) { await deps.kvPut(linkKey, { ...link, shows: [...new Set([...(link.shows || []), showId])], ...(auction ? { auction: { startPrice: start, showId } } : {}) }); results.push({ id, name: row.data?.name, added: true, ...(start != null ? { startPrice: start } : {}) }); }
    else results.push({ id, name: row.data?.name, error: whatnotErrorText(m) });
  }
  await deps.kvPut('whatnot-linked:' + deps.storeId, linked);
  return results;
}

// --- Orders board -------------------------------------------------------------
// Store, 2026-11-01: Whatnot orders on the orders board with who bought what,
// which show, and where the shipment is. Orders' buyer/show/status are kept
// as they are seen (orderBoardNotes); shipments are read from Whatnot every
// run, only those changed since the last look.
export const SHIPPED_STATUSES = new Set(['dropped_off', 'in_transit', 'delivered']);
export function orderBoardNotes(existing = {}, orders = [], cap = 1500) {
  const next = { ...existing };
  let changed = false;
  for (const o of orders) {
    if (!o?.id) continue;
    const note = { buyer: String(o.buyer?.username || o.buyer?.display_name || ''), showId: String(o.show_id || ''), status: String(o.status || ''), createdAt: String(o.created_at || '') };
    const before = next[o.id];
    if (!before || before.buyer !== note.buyer || before.showId !== note.showId || before.status !== note.status) { next[o.id] = note; changed = true; }
  }
  const ids = Object.keys(next);
  if (ids.length > cap) { ids.sort((a, b) => String(next[b].createdAt).localeCompare(String(next[a].createdAt))).slice(cap).forEach(id => { delete next[id]; }); changed = true; }
  return { notes: next, changed };
}
// deps: api, kvGet, kvPut, storeId.
export async function syncWhatnotShipments(deps, { pages = 2, cap = 1500 } = {}) {
  const key = 'whatnot-board-ship:' + deps.storeId;
  const board = (await deps.kvGet(key)) || { orders: {}, seen: {} };
  board.orders ||= {}; board.seen ||= {};
  // The first look goes further back, so earlier orders show as shipped.
  if (!Object.keys(board.seen).length) pages = Math.max(pages, 6);
  let cursor = '', changed = 0;
  for (let page = 0; page < pages; page++) {
    const r = await deps.api('GET', `/shipments?limit=50${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`);
    if (!r.ok) throw new Error('Whatnot shipments: ' + whatnotErrorText(r));
    for (const sh of r.data?.data || []) {
      if (!sh?.id || board.seen[sh.id] === (sh.updated_at || sh.status)) continue;
      const items = await deps.api('GET', `/shipments/${encodeURIComponent(sh.id)}/items?limit=50`);
      if (!items.ok) continue;
      const orderIds = [...new Set((items.data?.data || []).map(it => it.order_id).filter(Boolean))];
      const info = {
        shipmentId: sh.id, status: String(sh.status || ''), url: sh.url || '',
        carrier: sh.tracking?.carrier || '', trackingCode: sh.tracking?.tracking_code || '',
        buyer: sh.recipient?.username || sh.recipient?.display_name || '', dropoffDue: sh.dropoff_due || '',
        orders: orderIds.length, updatedAt: sh.updated_at || sh.created_at || '',
      };
      for (const id of orderIds) board.orders[id] = info;
      board.seen[sh.id] = sh.updated_at || sh.status;
      changed++;
    }
    cursor = r.data?.next_cursor || '';
    if (!cursor) break;
  }
  if (changed) {
    const ids = Object.keys(board.orders);
    if (ids.length > cap) ids.sort((a, b) => String(board.orders[b].updatedAt).localeCompare(String(board.orders[a].updatedAt))).slice(cap).forEach(id => { delete board.orders[id]; });
    const keepShips = new Set(Object.values(board.orders).map(i => i.shipmentId));
    for (const id of Object.keys(board.seen)) if (!keepShips.has(id)) delete board.seen[id];
    await deps.kvPut(key, board);
  }
  return { changed };
}

// --- Item details (Whatnot attributes) ------------------------------------------
// Store, 2026-11-01: "add title description and photos too ... What other item
// info can we use to sell more items on Whatnot?" Whatnot's category
// attributes are its search filters (condition, set, grade, player, rookie,
// publisher...). Ids and allowed values from Whatnot's product taxonomy;
// an ENUM value is only sent when it is one Whatnot allows.
const pick = (v, allowed) => { const s = String(v || '').trim(); if (!s) return ''; const hit = allowed.find(a => a.toLowerCase() === s.toLowerCase()); return hit || ''; };
const yes = v => v === true || /^(true|yes|1)$/i.test(String(v || ''));
const TCG_CONDITION = ['Graded', 'New', 'Mint', 'Near Mint', 'Light Played', 'Moderately Played', 'Heavily Played', 'Damaged'];
const SPORTS_CONDITION = ['Graded', 'Raw - Near Mint or Better', 'Raw - Excellent', 'Raw - Very Good', 'Raw - Poor'];
const COMIC_CONDITION = ['Graded', 'Gem Mint', 'Mint', 'Near Mint', 'Very Fine', 'Fine', 'Very Good', 'Good', 'Fair', 'Poor'];
const GRADERS = ['PSA', 'CGC', 'BECKETT', 'SGC', 'TAG', 'ARS'];
const COMIC_GRADERS = { cgc: 'Certified Guaranty Company (CGC)', cbcs: 'Comic Book Certification Service (CBCS)', pgx: 'Professional Grading Experts (PGX)' };
const COMIC_GRADES = ['10.0', '9.9', '9.8', '9.6', '9.4', '9.2', '9.0', '8.5', '8.0', '7.5', '7.0', '6.5', '6.0', '5.5', '5.0', '4.5', '4.0', '3.5', '3.0', '2.5', '2.0', '1.8', '1.5', '0.5'];
const POKEMON_LANG = ['English', 'Japanese', 'Dutch', 'German', 'French', 'Italian', 'Spanish', 'Portuguese', 'Korean', 'Traditional Chinese', 'Polish'];
const SPORTS_CATS = new Set(['586', '590', '593', '599', '574', '602', '596', '2666', '610', '607', '139']);
function tcgCondition(item) {
  if (item.gradingCompany) return 'Graded';
  if (item.isSealed) return 'New';
  const c = String(item.condition || '').toLowerCase();
  if (/^(nm|near mint)/.test(c)) return 'Near Mint';
  if (/^(lp|light)/.test(c)) return 'Light Played';
  if (/^(mp|moderate)/.test(c)) return 'Moderately Played';
  if (/^(hp|heav)/.test(c)) return 'Heavily Played';
  if (/^(dmg|damage)/.test(c)) return 'Damaged';
  if (/^mint/.test(c)) return 'Mint';
  return '';
}
function sportsCondition(item) {
  if (item.gradingCompany) return 'Graded';
  const c = String(item.condition || '').toLowerCase();
  if (!c || /^(nm|near mint|mint|gem)/.test(c)) return 'Raw - Near Mint or Better';
  if (/^(ex|excellent|lp)/.test(c)) return 'Raw - Excellent';
  if (/^(vg|very good|mp)/.test(c)) return 'Raw - Very Good';
  return 'Raw - Poor';
}
function comicCondition(item) {
  if (item.gradingCompany) return 'Graded';
  const c = String(item.condition || '').toLowerCase();
  if (/^(nm|near mint)/.test(c)) return 'Near Mint';
  if (/^(vf|very fine)/.test(c)) return 'Very Fine';
  if (/^(vg|very good)/.test(c)) return 'Very Good';
  return pick(item.condition, COMIC_CONDITION);
}
const firstName = v => Array.isArray(v) ? String(v[0]?.name || v[0] || '') : String(v || '');
export function whatnotAttributes(item, data = {}, categoryId) {
  const out = [];
  const add = (id, value) => { const v = String(value ?? '').trim(); if (v) out.push({ id: String(id), value: v.slice(0, 200) }); };
  const grader = String(item.gradingCompany || '').toUpperCase().replace('BGS', 'BECKETT');
  const graded = !!item.gradingCompany;
  const cert = data.cert_number || data.certNumber || '';
  const cat = String(categoryId || '');
  if (['2', '9', '8', '567', '2013', '269'].includes(cat)) {
    add(84, tcgCondition(item));
    if (cat === '2') {
      add(936, item.set);
      add(937, pick(item.language || 'English', POKEMON_LANG));
      const name = String(item.name || '').toLowerCase();
      add(893, item.isSealed ? (/booster box/.test(name) ? 'Booster Box' : /elite trainer|\betb\b/.test(name) ? 'Elite Trainer Box' : /blister/.test(name) ? 'Blister Pack' : /build (&|and) battle/.test(name) ? 'Build & Battle Box' : /booster|pack/.test(name) ? 'Booster Pack' : '') : 'Card');
      add(197, item.isSealed ? '' : item.cardNumber);
    }
    if (cat === '9') { add(85, item.set); add(82, item.isSealed ? 'Sealed' : 'Single Card'); add(81, /^(en|english)?$/i.test(String(item.language || '')) ? 'English' : 'Non-English'); }
    if (cat === '2' && graded) { add(192, 'true'); add(193, pick(grader, GRADERS)); add(194, item.grade); add(195, cert); }
  } else if (SPORTS_CATS.has(cat)) {
    add(11264, sportsCondition(item));
    add(198, item.player); add(196, item.brand); add(199, item.variant); add(200, item.year); add(197, item.cardNumber);
    if (graded) { add(192, 'true'); add(193, pick(grader, GRADERS)); add(194, item.grade); add(195, cert); }
    add(10663, yes(data.is_auto) || item.isSigned ? 'Yes' : 'No');
    add(10665, yes(data.is_rookie || data.isRookie) ? 'Yes' : 'No');
    add(10664, yes(data.is_patch) ? 'Yes' : 'No');
  } else if (cat === '244' || cat === '243') {
    const c = item.comic || {};
    add(13483, comicCondition(item));
    add(141, c.publisher || item.brand);
    const year = String(c.coverDate || c.storeDate || item.year || '').match(/\d{4}/)?.[0];
    add(136, year);
    add(137, c.seriesName || item.set);
    add(138, c.number);
    add(139, firstName(c.coverArtists) || firstName(c.artists));
    add(140, firstName(c.characters));
    if (graded) {
      add(389, 'true');
      add(144, COMIC_GRADERS[String(item.gradingCompany).toLowerCase()] || '');
      add(145, pick(Number(item.grade) ? Number(item.grade).toFixed(1) : '', COMIC_GRADES));
      add(390, cert);
    }
    if (item.isSigned) { add(392, 'true'); add(393, item.signedBy); }
  }
  return out;
}

// --- Auto titles -------------------------------------------------------------
// Store, 2026-11-01: "do auto titles". Whatnot search reads titles: the
// item's own name, with what buyers search for added when it isn't already
// there -- year, set, card number, parallel, serial, RC, auto, grade.
// Settings -> Whatnot can turn it off (autoTitles: false).
export function whatnotTitle(item = {}, d = {}) {
  const base = String(item.name || 'Item').replace(/\s+/g, ' ').trim();
  const has = t => !t || base.toLowerCase().includes(String(t).toLowerCase());
  const parts = [base];
  const add = (t, where = 'end') => { const v = String(t || '').trim(); if (!v || has(v) || parts.some(p => p.toLowerCase().includes(v.toLowerCase()))) return; if (where === 'start') parts.unshift(v); else parts.push(v); };
  const slug = item.categorySlug;
  if (slug === 'sports-cards') {
    add(item.set || item.brand, 'start'); add(item.year, 'start');
    if (item.cardNumber && !/#\s*\S/.test(base)) add('#' + String(item.cardNumber).replace(/^#/, ''));
    add(item.variant);
    const serial = String(d.serial_number || d.serialNumber || '').trim();
    if (serial && !/\/\s*\d+/.test(base)) add(serial.startsWith('/') ? serial : (/\//.test(serial) ? serial : '/' + serial));
    if ((d.is_rookie === true || d.isRookie === true) && !/\b(rc|rookie)\b/i.test(base)) parts.push('RC');
    if ((d.is_auto === true || item.isSigned) && !/\bauto/i.test(base)) parts.push('Auto');
  } else if (['pokemon', 'mtg', 'yugioh', 'one-piece', 'lorcana'].includes(slug)) {
    if (!item.isSealed && item.cardNumber && !has(item.cardNumber)) parts.push(String(item.cardNumber).startsWith('#') ? item.cardNumber : '#' + item.cardNumber);
    add(item.set);
    if (item.language && !/^en(glish)?$/i.test(item.language)) add(item.language);
    if (item.isSealed && !/\bsealed\b/i.test(base)) parts.push('Sealed');
  } else if (slug === 'comics') {
    const c = item.comic || {};
    const year = String(c.coverDate || c.storeDate || item.year || '').match(/\d{4}/)?.[0];
    if (c.publisher || year) add('(' + [c.publisher, year].filter(Boolean).join(' ') + ')');
  }
  if (item.gradingCompany && item.grade && !new RegExp('\\b' + item.gradingCompany + '\\s*' + String(item.grade).replace('.', '\\.'), 'i').test(base)) parts.push(item.gradingCompany.toUpperCase() + ' ' + item.grade);
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

// --- Auctions ------------------------------------------------------------------
// Starting bid: a set amount, or a percent of the item's price; whole
// dollars (Whatnot's auction start is in whole units), at least $1.
export function auctionStartPrice(spec = {}, price = 0) {
  if (spec.percent != null) return Math.max(1, Math.round((Number(price) || 0) * Number(spec.percent) / 100));
  return Math.max(1, Math.round(Number(spec.amount) || 1));
}
// Back to Buy It Now in the shop (after a show, or never auctioned after all).
export async function backToBuyItNow(itemIds, deps) {
  const out = [];
  for (const id of itemIds) {
    const linkKey = `whatnot-link:${deps.storeId}:${id}`;
    const link = await deps.kvGet(linkKey);
    if (!link?.productId) { out.push({ id, error: 'Not on Whatnot' }); continue; }
    const m = await deps.api('POST', `/merchandising/products/${encodeURIComponent(link.productId)}`, { transaction_type: 'buy_it_now', reserve_for_live: false });
    if (!m.ok) { out.push({ id, error: whatnotErrorText(m) }); continue; }
    const { auction, ...rest } = link;
    await deps.kvPut(linkKey, { ...rest, published: true });
    out.push({ id, done: true });
  }
  return out;
}

// --- Payouts: Whatnot's financial report -----------------------------------------
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter(r => r.length > 1 || r[0]);
  return (body || []).map(r => Object.fromEntries((head || []).map((h, i) => [h.trim(), r[i] ?? ''])));
}
const num = v => { const n = Number(String(v || '').replace(/[$,]/g, '')); return Number.isFinite(n) ? n : 0; };
export function summarizeFinancialReport(rows) {
  const t = { lines: 0, orders: new Set(), sales: 0, buyerPaid: 0, shippingCharged: 0, commission: 0, processing: 0, taxOnFees: 0, coupons: 0, net: 0, byShow: {} };
  for (const r of rows) {
    t.lines++;
    if (r.order_id) t.orders.add(r.order_id);
    t.sales += num(r.post_coupon_price || r.original_item_price);
    t.buyerPaid += num(r.buyer_paid);
    t.shippingCharged += num(r.seller_shipping_charge);
    t.commission += num(r.commission_fee);
    t.processing += num(r.processing_fee);
    t.taxOnFees += num(r.commission_tax) + num(r.processing_fee_tax);
    t.coupons += num(r.coupon_cost);
    t.net += num(r.transaction_amount);
    const show = r.livestream_title || (r.livestream_id ? 'Show ' + r.livestream_id : 'Not in a show');
    const b = t.byShow[show] || (t.byShow[show] = { sales: 0, fees: 0, net: 0, lines: 0 });
    b.sales += num(r.post_coupon_price || r.original_item_price); b.fees += num(r.commission_fee) + num(r.processing_fee); b.net += num(r.transaction_amount); b.lines++;
  }
  const r2 = n => Math.round(n * 100) / 100;
  const shows = Object.entries(t.byShow).map(([show, b]) => ({ show, sales: r2(b.sales), fees: r2(b.fees), net: r2(b.net), lines: b.lines })).sort((a, b) => b.net - a.net);
  return { lines: t.lines, orders: t.orders.size, sales: r2(t.sales), buyerPaid: r2(t.buyerPaid), shippingCharged: r2(t.shippingCharged), commission: r2(t.commission), processing: r2(t.processing), taxOnFees: r2(t.taxOnFees), coupons: r2(t.coupons), fees: r2(t.commission + t.processing + t.taxOnFees), net: r2(t.net), shows };
}

// --- Trends and top buyers ---------------------------------------------------------
// shows: whatnot_shows rows with report_summary; notes: order notes
// (buyer/show); amounts: { orderId: total } from the recorded sales.
export function whatnotInsights({ shows = [], notes = {}, amounts = {} }) {
  const done = shows.filter(sh => sh.report_summary && typeof sh.report_summary === 'object');
  const rows = done.map(sh => {
    const s = sh.report_summary;
    const orders = Number(s.orders || s.sold || 0);
    return { title: sh.title, date: sh.started_at, gross: Number(s.gross) || 0, net: Number(s.net) || 0, margin: Number(s.margin) || 0, sold: Number(s.sold) || 0,
      buyers: Number(s.buyersCount ?? (s.buyers || []).length) || 0, peakViewers: s.peakViewers ?? null, avgOrder: orders ? Math.round((Number(s.gross) || 0) / orders * 100) / 100 : 0, final: !!s.final };
  }).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const avg = k => rows.length ? Math.round(rows.reduce((n, r) => n + (Number(r[k]) || 0), 0) / rows.length * 100) / 100 : 0;
  const buyers = {};
  for (const [orderId, n] of Object.entries(notes)) {
    if (!n.buyer || /^(cancelled|failed)$/.test(n.status || '')) continue;
    const b = buyers[n.buyer] || (buyers[n.buyer] = { buyer: n.buyer, orders: 0, total: 0, shows: new Set(), last: '' });
    b.orders++; b.total += Number(amounts[orderId]) || 0;
    if (n.showId) b.shows.add(n.showId);
    if (String(n.createdAt) > b.last) b.last = n.createdAt;
  }
  const top = Object.values(buyers).map(b => ({ buyer: b.buyer, orders: b.orders, total: Math.round(b.total * 100) / 100, shows: b.shows.size, last: b.last }))
    .sort((a, b) => b.total - a.total || b.orders - a.orders).slice(0, 50);
  return {
    shows: rows,
    averages: { gross: avg('gross'), net: avg('net'), margin: avg('margin'), sold: avg('sold'), buyers: avg('buyers'), peakViewers: avg('peakViewers'), avgOrder: avg('avgOrder') },
    best: rows.slice().sort((a, b) => b.net - a.net)[0] || null,
    buyers: top,
    repeatBuyers: top.filter(b => b.shows > 1 || b.orders > 1).length,
  };
}
