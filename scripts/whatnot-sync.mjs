import { packageFor, PACKAGES } from './shipping-package.mjs';
import { breakEvenPrice, WHATNOT_FEE } from './whatnot-show-prep.mjs';
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
// Shipping profiles, one per package (scripts/shipping-package.mjs), made on
// Whatnot the first time each is needed. Packed weight and outside size.
// The comic profile keeps its old key (already made on Whatnot); the others
// are "v2-" (2026-11-05: singles by price, sealed by what it is) so a size
// saved under an old key is never reused for a different package.
const asProfile = p => ({ name: p.name, weight: p.weightOz >= 16 && p.weightOz % 16 === 0 ? { value: p.weightOz / 16, unit: 'pound' } : { value: p.weightOz, unit: 'ounce' }, dimensions: { length: p.length, width: p.width, height: p.height, unit: 'inch' } });
export const WHATNOT_PROFILES = Object.fromEntries(Object.entries(PACKAGES).map(([k, p]) => [k === 'comic' ? 'comic' : 'v2-' + k, asProfile(p)]));
// d: the row's data; item: the shaped listing (its category, sealed flag,
// grade and number fill in what the raw data leaves out).
export function whatnotPackage(d = {}, price = 0, item = {}) {
  const pkg = packageFor({
    ...d, name: d.name || item.name, cardNumber: d.cardNumber || item.cardNumber,
    category: item.categorySlug === 'comics' ? 'Comic' : (d.category || item.category), isSealed: d.isSealed === true || item.isSealed === true,
    gradingCompany: d.gradingCompany || item.gradingCompany, grade: d.grade || item.grade,
  }, price);
  return pkg.kind === 'custom' ? { profileKind: '', profile: asProfile(pkg) } : { profileKind: pkg.kind === 'comic' ? 'comic' : 'v2-' + pkg.kind, profile: WHATNOT_PROFILES[pkg.kind === 'comic' ? 'comic' : 'v2-' + pkg.kind] };
}

// --- What Whatnot should show ------------------------------------------------
// item: the Worker's shapeStorefrontItem(row) -- the website's own price
// rule, photos and category. data: the row's raw data.
export function whatnotDesired(row, item, { autoTitles = true } = {}) {
  const d = row.data || {};
  const categoryId = whatnotCategoryId(item);
  const status = String(d.lifecycle || d.status || row.status || 'in_stock').toLowerCase();
  const wanted = d.sellOnWhatnot === true;
  // 'bundled': the item now sells only inside its bundle (store, 2026-11-08),
  // so its own Whatnot listing goes to 0 and it can't sell twice.
  const sellable = wanted && !['sold', 'archived', 'deleted', 'presale', 'bundled', 'returned', 'lost_damaged', 'sold_pending_pickup', 'sold_pending_shipment'].includes(status) && !item.awaitingReceipt && !item.dropship;
  const qty = sellable ? Math.max(0, Math.min(9999, Math.floor(Number(d.quantity ?? d.qty ?? 1) || 0))) : 0;
  // Whatnot takes whole dollars only ("amount must be a whole number of
  // USD", 2026-11-03): rounded UP so nothing sells under the dashboard price
  // ($4.99 -> $5). The dashboard keeps its own price.
  const price = Math.ceil(Math.round((Number(item.price) || 0) * 100) / 100 - 1e-9);
  const details = [item.set, item.year, item.cardNumber ? '#' + item.cardNumber : '', item.variant, item.condition].filter(Boolean).join(' · ');
  // A bundle lists exactly what's in it (Whatnot: buyers see the contents).
  const members = d.isBundle === true && Array.isArray(d.bundleMemberNames) ? d.bundleMemberNames.filter(Boolean) : [];
  const contents = members.length ? 'Includes ' + members.length + ' items:\n' + members.map(n => '- ' + String(n).replace(/\s+--\s+.*$/, '')).join('\n') : '';
  return {
    wanted,
    qty,
    price,
    // Show only: never in the Buy It Now shop; sold in shows as an auction.
    showOnly: d.whatnotShowOnly === true,
    title: (autoTitles ? whatnotTitle(item, d) : String(item.name || 'Item')).slice(0, 200),
    // Whatnot won't publish without a description.
    description: [contents, details, item.description].filter(Boolean).join('\n\n').slice(0, 4000) || String(item.name || 'Item').slice(0, 4000),
    categoryId,
    attributes: categoryId ? whatnotAttributes(item, d, categoryId) : [],
    // How it ships: the package for what it is (custom weight: no saved profile).
    ...whatnotPackage(d, price, item),
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
export async function syncWhatnotItem(api, row, item, link, { profileId, saveProfileId, newKey = () => crypto.randomUUID(), autoTitles = true, allowCreate = true, claim = null, forShow = false } = {}) {
  const want = whatnotDesired(row, item, { autoTitles: autoTitles !== false });
  // WHATNOT MODE "Auction" (show only) and not in a show yet: nothing to buy
  // on Whatnot (0 there) -- not in the Buy It Now shop. Going into a show
  // (forShow) or already in one (link.auction) it carries its real count.
  if (want.showOnly && !forShow && !link?.auction) want.qty = 0;
  const base = { ...(link || {}), name: want.title };
  const fail = (r, why) => ({ link: { ...base, error: why || whatnotErrorText(r), errorAt: new Date().toISOString() }, retry: retryable(r), action: 'error' });
  let productId = link?.productId || '', variantId = link?.variantId || '';

  if (!productId) {
    if (want.qty <= 0) return { link: link?.error ? null : link, retry: false, action: 'none' };
    // Store, 2026-11-03: two syncs at once (the 10-minute run and one a
    // dashboard save started) each created the same comics -- two of each on
    // Whatnot. New listings are made only by the scheduled run, and each one
    // is claimed first so a second run can't make it again.
    if (!allowCreate) return { link, retry: true, action: 'none' };
    if (claim && !(await claim())) return { link, retry: true, action: 'none' };
    if (!want.categoryId) return { link: { ...base, error: 'No Whatnot category for "' + (item.category || 'this category') + '"', errorAt: new Date().toISOString() }, retry: false, action: 'error' };
    if (!(want.price > 0)) return { link: { ...base, error: 'No price', errorAt: new Date().toISOString() }, retry: false, action: 'error' };
    // Store, 2026-11-03: 261 comics put on Whatnot, 1 listed -- the size
    // profile id Whatnot returned for the first one was then refused for the
    // rest ("Dimension profile not found"). A refused saved profile is
    // dropped for good ('inline'): every listing sends its size spelled out.
    const savedProfile = want.profileKind ? await profileId?.(want.profileKind) : '';
    const knownProfile = savedProfile && savedProfile !== 'inline' ? savedProfile : '';
    const product = {
      title: want.title, description: want.description, external_id: row.id,
      category: { id: want.categoryId }, media: want.media, attributes: want.attributes,
      dimension_profile: knownProfile ? { id: knownProfile } : want.profile,
    };
    let created = await api('POST', '/products', product);
    if (!created.ok && knownProfile && /dimension profile/i.test(whatnotErrorText(created))) {
      await saveProfileId?.(want.profileKind, 'inline');
      product.dimension_profile = want.profile;
      created = await api('POST', '/products', product);
    }
    // Item details are extra: if Whatnot turns one down, list it without them.
    if (!created.ok && created.status === 422 && want.attributes.length) { created = await api('POST', '/products', { ...product, attributes: [] }); base.detailsNote = 'Item details not accepted by Whatnot'; }
    if (!created.ok || !created.data?.id) return fail(created);
    productId = created.data.id;
    if (!savedProfile && want.profileKind && created.data.dimension_profile?.id) await saveProfileId?.(want.profileKind, String(created.data.dimension_profile.id));
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
  // Whatnot's single variant `price` (2026-11-05, "Seller API: Migrate variant
  // pricing to price"): it is whichever the product is now -- Buy It Now, or
  // an auction's starting bid. While auctioned (link.auction) the shop price
  // waits; BACK TO BUY IT NOW puts it back.
  if (want.qty > 0 && want.price > 0 && base.price !== want.price && !base.auction && !want.showOnly) {
    const priced = await api('PATCH', `/products/${encodeURIComponent(productId)}/variants`, { variants: [{ id: variantId, external_id: row.id, price: money(want.price) }] });
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
  // Never into the shop while in a show's auction (BACK TO BUY IT NOW does that).
  if (want.qty > 0 && base.published !== true && !want.showOnly && !base.auction) {
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
// onlyIds: just these items, now (a sale in the store, 2026-11-05: "do the
// whatnot instant push") -- checked whatever the last run saw, never created.
export async function runWhatnotListingSync(storeId, deps, { limit = 40, force = false, allowCreate = true, onlyIds = null } = {}) {
  const s = encodeURIComponent(storeId);
  const { data: index } = await deps.db(`inventory_items?store_id=eq.${s}&data->>sellOnWhatnot=eq.true&select=id,updated_at&limit=5000`);
  // -v2 (2026-11-03): one fresh pass, so the comics refused for the size
  // profile are listed (unchanged items cost no Whatnot calls).
  // -v3: one more fresh pass so items refused for a cents price are listed.
  // -v4 (2026-11-11): one more pass so listings that showed "Graded" get a
  // real condition (only the ones whose details changed are edited).
  const seenKey = 'whatnot-sync-seen-v4:' + storeId;
  const seen = (!force && await deps.kvGet(seenKey)) || {};
  const linkedState = (await deps.kvGet('whatnot-linked:' + storeId)) || {};
  const linkedIds = new Set(Object.keys(linkedState));
  const ids = new Map((index || []).map(r => [r.id, r.updated_at]));
  // Linked items that lost the checkbox and also got edited, deleted or
  // went missing from the index are checked too, so they go to 0.
  for (const id of linkedIds) if (!ids.has(id)) ids.set(id, 'missing');
  // A listing not confirmed published (a draft, or made before publishing
  // was checked) is tried again every run.
  const only = Array.isArray(onlyIds) ? new Set(onlyIds.map(String)) : null;
  if (only) allowCreate = false;
  const todo = only
    ? [...ids].filter(([id]) => only.has(id)).slice(0, 50)
    : [...ids].filter(([id, at]) => seen[id] !== at || linkedIds.has(id) && linkedState[id] !== 'ok').slice(0, limit);
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
        allowCreate,
        // "Creating" mark: a run that finds one younger than 10 minutes
        // leaves the item alone.
        claim: async () => {
          const ck = `whatnot-creating:${storeId}:${id}`;
          const c = await deps.kvGet(ck);
          if (c && Date.now() - Date.parse(c.at) < 10 * 60 * 1000) return false;
          await deps.kvPut(ck, { at: new Date().toISOString() });
          return true;
        },
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
// Every scheduled show still to come, soonest first (the show picker).
export async function upcomingWhatnotShows(api, now = Date.now()) {
  const r = await api('GET', '/shows?status=scheduled&limit=20&reverse=false');
  if (!r.ok) throw new Error('Whatnot shows: ' + whatnotErrorText(r));
  return (r.data?.data || []).filter(sh => Date.parse(sh.scheduled_start_at || '') > now - 3600000)
    .sort((a, b) => Date.parse(a.scheduled_start_at) - Date.parse(b.scheduled_start_at));
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
// starts: { [itemId]: dollars } -- show prep's own starting bid per item
// (an auction even when no auction rule is given).
export async function addItemsToWhatnotShow(itemIds, showId, deps, { auction = null, starts = null } = {}) {
  const results = [];
  const auctioned = [];
  const rows = new Map(((await deps.rows(itemIds)) || []).map(r => [r.id, r]));
  const linked = (await deps.kvGet('whatnot-linked:' + deps.storeId)) || {};
  for (const id of itemIds) {
    const row = rows.get(id);
    if (!row) { results.push({ id, error: 'Item not found' }); continue; }
    const linkKey = `whatnot-link:${deps.storeId}:${id}`;
    let link = await deps.kvGet(linkKey);
    // A show-only item goes in with its real count (it sat at 0 outside a show).
    if (!link?.productId || link.published !== true || row.data?.whatnotShowOnly === true) {
      if (row.data?.sellOnWhatnot !== true) { results.push({ id, name: row.data?.name, error: 'Not set to sell on Whatnot' }); continue; }
      const r = await syncWhatnotItem(deps.api, row, deps.shape(row), link, { profileId: deps.profileId, saveProfileId: deps.saveProfileId, autoTitles: deps.listingSettings?.autoTitles !== false, forShow: true });
      if (r.link) { await deps.kvPut(linkKey, r.link); linked[id] = r.link.published === true || !(Number(r.link.qty) > 0) ? 'ok' : 'draft'; }
      link = r.link;
      if (!link?.productId) { results.push({ id, name: row.data?.name, error: link?.error || 'Could not list it on Whatnot' }); continue; }
    }
    // An auction: its starting bid set, then sold in the show (auctions are
    // live-only -- it leaves the shop until BACK TO BUY IT NOW).
    let start = null;
    const own = starts && Number(starts[id]) > 0 ? { amount: Number(starts[id]) } : null;
    const rule = own || auction;
    // Auction first, then its starting bid as the price (the single price is
    // the auction's once it is one -- set before, it would be the shop price).
    if (rule) start = auctionStartPrice(rule, Number(link.price) || Number(deps.shape(row).price) || 0);
    // Never a losing start (store, 2026-11-12): at least break-even after
    // Whatnot's fees whenever we know what the item cost -- chests and hooks too.
    if (start != null) start = Math.max(start, breakEvenStart(row.data, deps.whatnotFee));
    // A show-only item isn't in the shop, so its starting bid can go on first
    // (Whatnot may want a price before it takes it as an auction).
    const showOnly = row.data?.whatnotShowOnly === true;
    if (showOnly && rule) await deps.api('PATCH', `/products/${encodeURIComponent(link.productId)}/variants`, { variants: [{ id: link.variantId, price: money(start) }] });
    const merchBody = { ...(rule ? { transaction_type: 'auction' } : {}), ...(showOnly ? { reserve_for_live: true } : {}), shows: { strategy: 'ADD', show_ids: [showId] } };
    let m = await deps.api('POST', `/merchandising/products/${encodeURIComponent(link.productId)}`, merchBody);
    if (!m.ok && showOnly && m.status === 422) { const { reserve_for_live, ...plain } = merchBody; m = await deps.api('POST', `/merchandising/products/${encodeURIComponent(link.productId)}`, plain); }
    if (m.ok && rule) {
      const priced = await deps.api('PATCH', `/products/${encodeURIComponent(link.productId)}/variants`, { variants: [{ id: link.variantId, price: money(start) }] });
      // Still an auction in the show: listed for the after-show return to the shop.
      if (!priced.ok) { auctioned.push(id); await deps.kvPut(linkKey, { ...link, shows: [...new Set([...(link.shows || []), showId])], auction: { startPrice: null, showId } }); results.push({ id, name: row.data?.name, error: 'In the show, but the starting bid was not set: ' + whatnotErrorText(priced) }); continue; }
    }
    if (m.ok) { await deps.kvPut(linkKey, { ...link, shows: [...new Set([...(link.shows || []), showId])], ...(rule ? { auction: { startPrice: start, showId } } : {}) }); results.push({ id, name: row.data?.name, added: true, ...(start != null ? { startPrice: start } : {}) }); if (rule) auctioned.push(id); }
    else results.push({ id, name: row.data?.name, error: whatnotErrorText(m) });
  }
  await deps.kvPut('whatnot-linked:' + deps.storeId, linked);
  // Which items each show auctions: after the show, the ones still here go
  // back to the shop (returnUnsoldToShop), and the wrap-up lists them.
  if (auctioned.length) {
    const key = `whatnot-show-items:${deps.storeId}:${showId}`;
    await deps.kvPut(key, [...new Set([...(((await deps.kvGet(key)) || [])), ...auctioned])].slice(0, 500));
  }
  return results;
}

// After a show: auctioned items still in stock (unsold, or more copies left)
// go back to Buy It Now in the shop. Once per show.
// Waits 30 minutes after the show is first seen ended, so the last orders
// are recorded first and a sold book can't go back on sale.
export const UNSOLD_RETURN_WAIT_MS = 30 * 60000;
export async function returnUnsoldToShop(showId, deps, { now = Date.now() } = {}) {
  const doneKey = `whatnot-unsold-returned:${deps.storeId}:${showId}`;
  if (await deps.kvGet(doneKey)) return { showId, skipped: 'already returned' };
  const seenKey = `whatnot-show-ended-seen:${deps.storeId}:${showId}`;
  const seen = Number(await deps.kvGet(seenKey)) || 0;
  if (!seen) { await deps.kvPut(seenKey, now); return { showId, waiting: true }; }
  if (now - seen < UNSOLD_RETURN_WAIT_MS) return { showId, waiting: true };
  const ids = (await deps.kvGet(`whatnot-show-items:${deps.storeId}:${showId}`)) || [];
  if (!ids.length) { await deps.kvPut(doneKey, { at: new Date().toISOString(), returned: [] }); return { showId, returned: [] }; }
  const rows = (await deps.rows(ids)) || [];
  // Show-only items stay out of the shop (until changed in the dashboard).
  const here = rows.filter(r => r.status === 'in_stock' && Number(r.data?.quantity ?? r.data?.qty ?? 1) > 0 && r.data?.whatnotShowOnly !== true).map(r => r.id);
  const results = here.length ? await backToBuyItNow(here, deps) : [];
  const returned = results.filter(r => r.done).map(r => r.id);
  await deps.kvPut(doneKey, { at: new Date().toISOString(), returned, failed: results.filter(r => r.error).length });
  return { showId, returned, failed: results.filter(r => r.error) };
}

// The wrap-up after a show: its numbers, what sold to whom (a pack list),
// buyers new and returning (a thank-you list), and what didn't sell.
// lines: [{ orderId, title, price, quantity }]; notes: the orders board's
// { [orderId]: { buyer, showId, status, createdAt } }.
export function showWrapUp({ show = {}, summary = null, notes = {}, lines = [], unsold = [], returned = null } = {}) {
  const showOrders = Object.entries(notes).filter(([, n]) => n.showId === show.id && !/^(cancelled|failed)$/.test(n.status || ''));
  const startAt = Date.parse(show.started_at || '') || Infinity;
  const seenBefore = new Set(Object.values(notes).filter(n => n.buyer && n.showId !== show.id && Date.parse(n.createdAt || '') < startAt).map(n => n.buyer));
  const byBuyer = new Map();
  for (const [orderId, n] of showOrders) {
    const buyer = n.buyer || '(unknown buyer)';
    const b = byBuyer.get(buyer) || { buyer, orders: 0, items: [], total: 0, returning: seenBefore.has(buyer) };
    b.orders++;
    for (const l of lines.filter(x => x.orderId === orderId)) { b.items.push({ title: l.title, price: Number(l.price) || 0, quantity: Number(l.quantity) || 1 }); b.total += Number(l.price) || 0; }
    b.total = Math.round(b.total * 100) / 100;
    byBuyer.set(buyer, b);
  }
  const buyers = [...byBuyer.values()].sort((a, b) => b.total - a.total || a.buyer.localeCompare(b.buyer));
  const sold = lines.filter(l => showOrders.some(([id]) => id === l.orderId));
  return {
    show: { id: show.id, title: show.title || 'Whatnot show', status: show.status, startedAt: show.started_at || null, endedAt: show.ended_at || null },
    numbers: summary ? { gross: summary.gross, fees: summary.fees, cogs: summary.cogs, net: summary.net, margin: summary.margin, sold: summary.sold, giveaways: summary.giveaways, buyers: summary.buyersCount, peakViewers: summary.peakViewers ?? null, final: !!summary.final } : null,
    sold: sold.map(l => ({ title: l.title, price: Number(l.price) || 0, quantity: Number(l.quantity) || 1 })),
    buyers,
    newBuyers: buyers.filter(b => !b.returning).map(b => b.buyer),
    returningBuyers: buyers.filter(b => b.returning).map(b => b.buyer),
    unsold: unsold.map(r => ({ id: r.id, name: r.data?.name || '', price: Number(r.data?.salePrice || r.data?.marketPrice || r.data?.market || 0) || 0 })),
    returned,
  };
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
  // No condition saved: Near Mint. Sending none made Whatnot show its first
  // choice, "Graded" (store, 2026-11-11: "we have 0 graded").
  return 'Near Mint';
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
  // New comics with no condition saved are Near Mint. Sending none made
  // Whatnot show its first choice, "Graded" (store, 2026-11-11).
  return pick(item.condition, COMIC_CONDITION.slice(1)) || 'Near Mint';
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
// min: a floor ("50 percent of my price or 4 dollars, whatever is greater").
export function breakEvenStart(data = {}, fee = WHATNOT_FEE) {
  const cost = Number(data?.cost ?? data?.costBasis ?? data?.cost_basis ?? 0);
  return cost > 0 ? Math.ceil(breakEvenPrice(cost, fee || WHATNOT_FEE)) : 0;
}
export function auctionStartPrice(spec = {}, price = 0) {
  const floor = Math.max(1, Math.round(Number(spec.min) || 0));
  if (spec.percent != null) return Math.max(floor, Math.round((Number(price) || 0) * Number(spec.percent) / 100));
  return Math.max(floor, Math.round(Number(spec.amount) || 1));
}
// SHOW ONLY (store, 2026-11-05: "not available for bin, only in a show with
// pre bids ... show only if it doesn't sell until I change it in the
// dashboard"): the starting bid FOC comics get when received into a show.
export const SHOW_ONLY_START = { percent: 50, min: 4 };
// The store's own rule (Settings -> Whatnot), else 50% / $4.
export function auctionRuleFrom(settings = {}) {
  const a = settings?.auctionStart || {};
  const percent = Number(a.percent), min = Number(a.min);
  return percent > 0 && percent <= 100 ? { percent, min: min >= 1 && min <= 1000 ? Math.round(min) : 1 } : { ...SHOW_ONLY_START };
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
    // Its shop price again (the single price was the starting bid).
    if (link.auction && Number(link.price) > 0 && link.variantId) {
      const priced = await deps.api('PATCH', `/products/${encodeURIComponent(link.productId)}/variants`, { variants: [{ id: link.variantId, price: money(link.price) }] });
      if (!priced.ok) { out.push({ id, error: 'Back in the shop, but its price is still the starting bid: ' + whatnotErrorText(priced) }); continue; }
    }
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

// --- Listings made before the sync (old CSV uploads) ------------------------
// Store, 2026-11-02: listings put on Whatnot by CSV aren't tied to an item
// here, so their sales don't take stock off. LINK OLD LISTINGS finds each
// Whatnot listing that isn't one of ours, suggests the inventory item it is
// (the CSV's SKU when Whatnot kept it, else the closest title), and links
// the ones the store ticks: the same listing is kept (no ending and
// relisting), its title and photos are left as they are, and the next sync
// sets its price and quantity to the dashboard's.
const LINK_STOP = new Set(['the', 'a', 'an', 'of', 'and', 'with', 'card', 'cards', 'nm', 'near', 'mint', 'new', 'sealed', 'raw', 'tcg', '-', '']);
export function linkTokens(s) {
  return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[''`]/g, '').replace(/[^a-z0-9#/]+/g, ' ')
    .split(' ').map(t => t.replace(/^#+/, '#')).filter(t => !LINK_STOP.has(t));
}
const hasDigit = t => /\d/.test(t);
// 0..1: shared words (Dice), and issue/card numbers have to agree.
export function linkTitleScore(a, b) {
  const A = new Set(linkTokens(a)), B = new Set(linkTokens(b));
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const t of A) if (B.has(t)) both++;
  let score = 2 * both / (A.size + B.size);
  const na = [...A].filter(hasDigit).map(t => t.replace('#', '')), nb = new Set([...B].filter(hasDigit).map(t => t.replace('#', '')));
  if (na.length || nb.size) {
    const same = na.length === nb.size && na.every(t => nb.has(t));
    if (!same) score *= 0.6;
  }
  return Math.round(score * 100) / 100;
}
const listingPrice = p => Number(p?.price?.amount ?? p?.variants?.[0]?.price?.amount ?? p?.pricing?.buy_it_now?.price?.amount ?? p?.buy_it_now_price?.amount) || null;
const listingQty = p => { const q = p?.inventory?.quantity ?? p?.quantity ?? p?.total_quantity; return q == null ? null : Number(q) || 0; };
const listingSku = p => String(p?.sku || p?.variants?.[0]?.sku || p?.variants?.[0]?.external_id || '').trim();

// products: Whatnot products; items: [{id, name, price, qty}]; linkedIds:
// items the sync already lists. Returns one row per listing not ours yet.
export function matchWhatnotListings(products, items, linkedIds = new Set()) {
  const byId = new Map(items.map(i => [i.id, i]));
  const index = new Map();
  items.forEach((it, n) => { for (const t of new Set(linkTokens(it.name))) { if (!index.has(t)) index.set(t, []); index.get(t).push(n); } });
  const rows = [];
  for (const p of products) {
    const ext = String(p.external_id || '');
    // Made by the sync (its external id is the linked item): already 1:1.
    if (isUuid(ext) && linkedIds.has(ext)) continue;
    const title = String(p.title || p.name || '');
    const counts = new Map();
    for (const t of new Set(linkTokens(title))) {
      const hits = index.get(t);
      if (!hits || hits.length > 400) continue; // too common to tell items apart
      for (const n of hits) counts.set(n, (counts.get(n) || 0) + 1);
    }
    const scored = [...counts.keys()].map(n => ({ it: items[n], score: linkTitleScore(title, items[n].name) }))
      .filter(x => x.score >= 0.4).sort((a, b) => b.score - a.score).slice(0, 4);
    // The CSV's SKU was the item id: a sure match when Whatnot kept it.
    const sku = [ext, listingSku(p)].find(v => isUuid(v) && byId.has(v));
    if (sku) { const it = byId.get(sku); scored.unshift({ it, score: 1, sku: true }); }
    const seen = new Set();
    const matches = scored.filter(x => !seen.has(x.it.id) && seen.add(x.it.id)).slice(0, 4)
      .map(x => ({ itemId: x.it.id, name: x.it.name, price: x.it.price ?? null, qty: x.it.qty ?? null, score: x.score, bySku: !!x.sku, alreadyListed: linkedIds.has(x.it.id) }));
    rows.push({ productId: String(p.id), title, url: p.url || '', price: listingPrice(p), qty: listingQty(p), matches,
      // Ticked to start with only when it's clear-cut.
      suggest: matches[0] && !matches[0].alreadyListed && (matches[0].bySku || (matches[0].score >= 0.85 && !(matches[1] && matches[1].score >= matches[0].score - 0.05))) ? matches[0].itemId : '' });
  }
  return rows.sort((a, b) => (b.suggest ? 1 : 0) - (a.suggest ? 1 : 0) || (b.matches[0]?.score || 0) - (a.matches[0]?.score || 0));
}

// Every listing in the Whatnot shop, a page of 50 at a time.
export async function whatnotAllProducts(api, { pages = 20 } = {}) {
  const out = [];
  let cursor = '';
  for (let page = 0; page < pages; page++) {
    const r = await api('GET', `/products?limit=50${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`);
    if (!r.ok) throw new Error('Whatnot listings: ' + whatnotErrorText(r));
    for (const p of r.data?.data || []) if (!['archived', 'deleted'].includes(String(p.status || '').toLowerCase())) out.push(p);
    cursor = r.data?.next_cursor || '';
    if (!cursor) return { products: out, more: false };
  }
  return { products: out, more: !!cursor };
}

// pairs: [{productId, itemId}]. deps as runWhatnotListingSync, plus
// setSellOnWhatnot(itemId) to tick the item's SELL ON WHATNOT.
export async function linkWhatnotListings(pairs, deps) {
  const storeId = deps.storeId;
  const linked = (await deps.kvGet('whatnot-linked:' + storeId)) || {};
  const seenKey = 'whatnot-sync-seen-v4:' + storeId;
  const seen = (await deps.kvGet(seenKey)) || {};
  const rows = new Map((await deps.rows(pairs.map(p => p.itemId))).map(r => [r.id, r]));
  const results = [];
  for (const { productId, itemId } of pairs) {
    const row = rows.get(itemId);
    if (!row) { results.push({ productId, itemId, error: 'Item not found' }); continue; }
    if (linked[itemId]) { results.push({ productId, itemId, error: 'Already on Whatnot through the sync -- end the old listing instead' }); continue; }
    const variants = await deps.api('GET', `/products/${encodeURIComponent(productId)}/variants?limit=5`);
    const variant = variants.data?.data?.[0];
    if (!variants.ok || !variant?.id) { results.push({ productId, itemId, error: variants.ok ? 'Listing has no variant' : whatnotErrorText(variants) }); continue; }
    // Tagged with our id so its orders find the item even before the sync runs.
    const tagged = await deps.api('PATCH', `/products/${encodeURIComponent(productId)}/variants`, { variants: [{ id: variant.id, external_id: itemId }] });
    if (!tagged.ok) { results.push({ productId, itemId, error: whatnotErrorText(tagged) }); continue; }
    await deps.api('PATCH', `/products/${encodeURIComponent(productId)}`, { external_id: itemId }).catch(() => null);
    const want = whatnotDesired({ ...row, data: { ...(row.data || {}), sellOnWhatnot: true } }, deps.shape(row), { autoTitles: deps.listingSettings?.autoTitles !== false });
    await deps.kvPut(`whatnot-link:${storeId}:${itemId}`, {
      productId, variantId: String(variant.id), name: want.title, url: deps.urls?.[productId] || '',
      // Their title, description and photos stay; price and quantity follow ours.
      ...whatnotContentKeys(want), price: null, qty: null, published: true, linkedExisting: true, linkedAt: new Date().toISOString(),
    });
    await deps.setSellOnWhatnot(itemId, row);
    linked[itemId] = 'ok';
    delete seen[itemId];
    results.push({ productId, itemId, linked: true });
  }
  await deps.kvPut('whatnot-linked:' + storeId, linked);
  await deps.kvPut(seenKey, seen);
  return results;
}

// --- Edits made on Whatnot, back to the dashboard ---------------------------
// Store, 2026-11-03: "I'd need Whatnot to update the prices to our dash and
// the counts as well." A linked listing's price or quantity changed in the
// Whatnot app (not by our sync -- link.price/link.qty are what we last sent)
// comes back to the item here, unless the item was also changed on the
// dashboard since (then the dashboard wins, as before). A price edit is
// saved as the item's locked price (priceOverride, same as a dashboard edit,
// so daily price updates don't move it back). A count that went UP comes
// back at once; one that went DOWN waits for a second look 20+ minutes later
// -- a drop can be a sale whose order isn't recorded yet, and the order
// (which takes the copy off the dashboard itself) must win, or the copy
// would come off twice. A slice of linked items is looked at each run.
export const PULL_PER_RUN = 25;
export const PULL_DROP_CONFIRM_MS = 20 * 60 * 1000;
const variantPrice = v => { const n = Number(v?.price?.amount ?? v?.pricing?.buy_it_now?.price?.amount ?? v?.buy_it_now_price?.amount); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; };
const variantQty = v => { const q = v?.inventory?.quantity ?? v?.inventory?.available ?? v?.quantity ?? v?.available_quantity; const n = Number(q); return q == null || !Number.isFinite(n) ? null : Math.max(0, Math.floor(n)); };
export function whatnotEditPlan({ link, want, wnPrice, wnQty, now = Date.now() }) {
  const plan = { price: null, qty: null, pendingDrop: null };
  if (!link || link.price == null || link.qty == null) return plan;
  // The dashboard changed since our last push: it wins (the sync sends it).
  if (Math.abs(Number(want.price) - Number(link.price)) >= 0.01 || Number(want.qty) !== Number(link.qty)) return plan;
  // While auctioned, Whatnot's price is the starting bid -- never the shop price.
  if (wnPrice != null && !link.auction && Math.abs(wnPrice - Number(link.price)) >= 0.01) plan.price = wnPrice;
  if (wnQty != null && wnQty !== Number(link.qty)) {
    if (wnQty > Number(link.qty)) plan.qty = wnQty;
    else if (link.pendingDrop && link.pendingDrop.qty === wnQty && now - Date.parse(link.pendingDrop.at) >= PULL_DROP_CONFIRM_MS) plan.qty = wnQty;
    else plan.pendingDrop = link.pendingDrop?.qty === wnQty ? link.pendingDrop : { qty: wnQty, at: new Date(now).toISOString() };
  }
  return plan;
}
// deps: api, kvGet, kvPut, rows(ids), shape(row), storeId, updateItem(id, row, patch), listingSettings
export async function pullWhatnotEdits(storeId, deps, { limit = PULL_PER_RUN, now = Date.now() } = {}) {
  const linked = Object.keys((await deps.kvGet('whatnot-linked:' + storeId)) || {}).sort();
  const out = { looked: 0, prices: 0, counts: 0, waiting: 0, errors: [] };
  if (!linked.length) return out;
  const cursorKey = 'whatnot-pull-cursor:' + storeId;
  const start = Number(await deps.kvGet(cursorKey)) || 0;
  const ids = Array.from({ length: Math.min(limit, linked.length) }, (_, i) => linked[(start + i) % linked.length]);
  await deps.kvPut(cursorKey, (start + ids.length) % linked.length);
  const rows = new Map((await deps.rows(ids)).map(r => [r.id, r]));
  for (const id of ids) {
    const row = rows.get(id); const linkKey = `whatnot-link:${storeId}:${id}`;
    const link = row && await deps.kvGet(linkKey);
    if (!row || !link?.productId || link.error) continue;
    const want = whatnotDesired(row, deps.shape(row), { autoTitles: deps.listingSettings?.autoTitles !== false });
    if (!want.wanted || want.qty <= 0 && Number(link.qty) <= 0) continue;
    out.looked++;
    try {
      const r = await deps.api('GET', `/products/${encodeURIComponent(link.productId)}/variants?limit=5`);
      if (!r.ok) { if (r.status !== 404) out.errors.push({ id, error: whatnotErrorText(r) }); continue; }
      const vs = r.data?.data || []; const v = vs.find(x => String(x.id) === String(link.variantId)) || vs[0];
      const plan = whatnotEditPlan({ link, want, wnPrice: variantPrice(v), wnQty: variantQty(v), now });
      const patch = {};
      if (plan.price != null) patch.priceOverride = plan.price;
      if (plan.qty != null) patch.quantity = plan.qty;
      if (Object.keys(patch).length) {
        await deps.updateItem(id, row, patch);
        if (plan.price != null) { link.price = plan.price; out.prices++; }
        if (plan.qty != null) { link.qty = plan.qty; out.counts++; }
        delete link.pendingDrop;
        link.pulledFromWhatnotAt = new Date(now).toISOString();
        await deps.kvPut(linkKey, link);
      } else if (plan.pendingDrop) {
        out.waiting++;
        if (link.pendingDrop?.qty !== plan.pendingDrop.qty) { link.pendingDrop = plan.pendingDrop; await deps.kvPut(linkKey, link); }
      } else if (link.pendingDrop) { delete link.pendingDrop; await deps.kvPut(linkKey, link); } // KV written only on a change
    } catch (e) { out.errors.push({ id, error: e.message }); }
  }
  return out;
}

// --- Duplicate listings (one dashboard item, two Whatnot products) ----------
// Store, 2026-11-03: "Why's it adding 2 of each?!" -- two syncs created the
// same comics at once. Every listing the sync makes carries the item's id
// (external_id), so copies are found by it: the one the dashboard tracks
// (its link) stays; each extra is deleted, or set to 0 if Whatnot won't
// delete it, so it can't be bought.
export function findDuplicateListings(products = [], links = {}) {
  const byItem = new Map();
  for (const p of products) {
    const ext = String(p.external_id || '');
    if (!isUuid(ext)) continue;
    if (!byItem.has(ext)) byItem.set(ext, []);
    byItem.get(ext).push(p);
  }
  const extras = [];
  for (const [itemId, list] of byItem) {
    if (list.length < 2) continue;
    const keepId = links[itemId]?.productId && list.some(p => String(p.id) === String(links[itemId].productId)) ? String(links[itemId].productId) : String(list[0].id);
    for (const p of list) if (String(p.id) !== keepId) extras.push({ itemId, productId: String(p.id), keep: keepId, title: p.title || '' });
  }
  return extras;
}
export async function removeDuplicateWhatnotListings(storeId, deps, { max = 300 } = {}) {
  const { products } = await whatnotAllProducts(deps.api, { pages: 20 });
  const ids = [...new Set(products.map(p => String(p.external_id || '')).filter(isUuid))];
  const links = {};
  for (const id of ids) { const l = await deps.kvGet(`whatnot-link:${storeId}:${id}`); if (l) links[id] = l; }
  const extras = findDuplicateListings(products, links).slice(0, max);
  const out = { listings: products.length, duplicates: extras.length, removed: 0, zeroed: 0, failed: [] };
  for (const x of extras) {
    const del = await deps.api('DELETE', `/products/${encodeURIComponent(x.productId)}`);
    if (del.ok || del.status === 404) { out.removed++; continue; }
    const vs = await deps.api('GET', `/products/${encodeURIComponent(x.productId)}/variants?limit=5`);
    const items = (vs.data?.data || []).map(v => ({ variant_id: v.id, quantity: 0, idempotency_key: crypto.randomUUID() }));
    const set = items.length ? await deps.api('POST', '/inventory/set', { items }) : { ok: false };
    if (set.ok) out.zeroed++; else out.failed.push({ ...x, error: whatnotErrorText(del) + ' / ' + whatnotErrorText(set) });
  }
  return out;
}
