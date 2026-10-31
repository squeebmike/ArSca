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
export function whatnotDesired(row, item) {
  const d = row.data || {};
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
    title: String(item.name || 'Item').slice(0, 200),
    description: [details, item.description].filter(Boolean).join('\n\n').slice(0, 4000) || null,
    categoryId: whatnotCategoryId(item),
    profileKind: whatnotProfileKind(item),
    media: (item.photos || []).filter(u => /^https:\/\//i.test(u)).slice(0, 8).map(url => ({ url })),
  };
}

// --- One item ----------------------------------------------------------------
// link: what we last did on Whatnot for it ({productId, variantId, price,
// qty, error, url}) or null. Returns the new link (null = nothing to keep)
// and whether to try again on the next run.
export async function syncWhatnotItem(api, row, item, link, { profileId, saveProfileId, newKey = () => crypto.randomUUID() } = {}) {
  const want = whatnotDesired(row, item);
  const base = { ...(link || {}), name: want.title };
  const fail = (r, why) => ({ link: { ...base, error: why || whatnotErrorText(r), errorAt: new Date().toISOString() }, retry: retryable(r), action: 'error' });
  let productId = link?.productId || '', variantId = link?.variantId || '';

  if (!productId) {
    if (want.qty <= 0) return { link: link?.error ? null : link, retry: false, action: 'none' };
    if (!want.categoryId) return { link: { ...base, error: 'No Whatnot category for "' + (item.category || 'this category') + '"', errorAt: new Date().toISOString() }, retry: false, action: 'error' };
    if (!(want.price > 0)) return { link: { ...base, error: 'No price', errorAt: new Date().toISOString() }, retry: false, action: 'error' };
    const knownProfile = await profileId?.(want.profileKind);
    const created = await api('POST', '/products', {
      title: want.title, description: want.description, external_id: row.id,
      category: { id: want.categoryId }, media: want.media,
      dimension_profile: knownProfile ? { id: knownProfile } : WHATNOT_PROFILES[want.profileKind],
    });
    if (!created.ok || !created.data?.id) return fail(created);
    productId = created.data.id;
    if (!knownProfile && created.data.dimension_profile?.id) await saveProfileId?.(want.profileKind, String(created.data.dimension_profile.id));
    const variants = await api('GET', `/products/${encodeURIComponent(productId)}/variants?limit=5`);
    variantId = variants.data?.data?.[0]?.id || '';
    if (!variantId) return fail(variants, 'Whatnot made the product but no variant came back');
    Object.assign(base, { productId, variantId, url: created.data.url || '', createdAt: new Date().toISOString(), price: null, qty: null });
    // Buy It Now in the shop any time, not held for live shows. Not fatal:
    // the listing still works if Whatnot turns this down.
    const merch = await api('POST', `/merchandising/products/${encodeURIComponent(productId)}`, { transaction_type: 'buy_it_now', reserve_for_live: false });
    if (!merch.ok) base.note = 'Sale format not set: ' + whatnotErrorText(merch);
  }

  let action = link?.productId ? 'none' : 'created';
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
  const linkedIds = new Set(Object.keys((await deps.kvGet('whatnot-linked:' + storeId)) || {}));
  const ids = new Map((index || []).map(r => [r.id, r.updated_at]));
  // Linked items that lost the checkbox and also got edited, deleted or
  // went missing from the index are checked too, so they go to 0.
  for (const id of linkedIds) if (!ids.has(id)) ids.set(id, 'missing');
  const todo = [...ids].filter(([id, at]) => seen[id] !== at).slice(0, limit);
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
        profileId: kind => profileIds[kind] || '',
        saveProfileId: async (kind, pid) => { profileIds[kind] = pid; await deps.kvPut('whatnot-profiles:' + storeId, profileIds); },
      });
      if (r.link) { await deps.kvPut(linkKey, r.link); linked[id] = 1; }
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
    const body = { itemId: ours, title, channel: 'Whatnot', salePrice: giveaway ? 0 : salePrice, quantitySold: quantity, soldAt: order.created_at || new Date().toISOString(),
      feeAmount: giveaway ? 0 : whatnotFee(salePrice, deps.feeSettings, { first }), externalRef: whatnotOrderRef(orderId, it.id), ...(giveaway ? { giveaway: true } : {}) };
    if (!giveaway) first = false;
    // A Whatnot-only giveaway (nothing of ours) has nothing to record.
    if (giveaway && !ours) { recorded.push({ itemId: '', title, giveaway: true, skipped: 'not ours' }); continue; }
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
