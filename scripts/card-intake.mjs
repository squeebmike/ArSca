// The Mana Pocket Card Intake pipeline.
//
// Any image source (rapid phone camera, bulk upload, auto-feed scanner,
// desktop camera) feeds ONE common processing queue:
//   IMAGE -> IDENTIFY -> FIND VARIANT -> PRICE -> HUMAN VERIFICATION -> INVENTORY
//
// This module stays deliberately independent of the dashboard DOM, mirroring
// foc-preorders.mjs -- the Worker passes its existing Supabase/auth helpers
// into handleCardIntakeRequest(). Identification itself is NOT done here:
// the real card-reading step is the existing /identify/card route (Claude
// vision) plus the dashboard's own resolveOwnCardIdentifyCard() catalog
// search, both of which already exist and already work. This module only
// stores what that pipeline produces (captures, candidates, confidence,
// reviews) and owns the two things that were actually missing: a durable
// intake queue that survives a closed tab, and the collection-buy/inventory
// promotion workflow built on top of it.

function text(value, max = 4000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const INTAKE_SOURCES = new Set(['PHONE_CAMERA', 'BULK_UPLOAD', 'SCANNER', 'DESKTOP_CAMERA', 'MANUAL']);
const ITEM_STATUSES = new Set(['captured', 'processing', 'needs_review', 'needs_back', 'approved', 'rejected', 'duplicate', 'failed']);
const HIGH_VALUE_CENTS = 25000; // $250+ per the store's own high-value alert threshold

function firstMoneyValue(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function arrayBufferToBase64(buf) {
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  return btoa(binary);
}

// Category strings match resolveOwnCardIdentifyCard's own mapping in
// dashboard.html exactly, so a resolved match's category lines up with what
// the rest of the app (CATEGORY_ALIASES/qplCategoryKey) already expects.
function ciCategoryForGame(game) {
  return game === 'pokemon' ? 'Pokemon TCG' : game === 'mtg' ? 'Magic: The Gathering' : game === 'sports' ? 'Sports Card' : 'One Piece TCG';
}
function ciConfidenceFromLabel(label) { return label === 'high' ? 0.92 : label === 'medium' ? 0.65 : 0.35; }

// Same-origin call into the existing, already-battle-tested
// /pricing/pokemonpricetracker/cards route (caching, subscription gating,
// quota/rate-limit handling all reused for free) rather than re-implementing
// any of that here. Needs the ORIGINAL caller's own auth token -- there is
// no service-level bypass for this, so a scanner-sourced item (no logged-in
// user attached to the upload) simply gets no Pokemon price candidates,
// same honest limitation documented for sports/one_piece below.
async function resolvePokemonCandidates(originUrl, storeId, authToken, card) {
  if (!authToken) return [];
  const q = [card.year, card.setName, card.name, card.number ? '#' + card.number : ''].filter(Boolean).join(' ').trim();
  if (!q) return [];
  try {
    const params = new URLSearchParams({ search: q, limit: '5', language: 'english' });
    const res = await fetch(`${originUrl}/pricing/pokemonpricetracker/cards?${params}`, { headers: { Authorization: authToken, 'X-Store-Id': storeId } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) return [];
    const rows = (data.cards?.length ? data.cards : null) || data.matches || data.data || data.results || [];
    const list = Array.isArray(rows) ? rows : (rows && typeof rows === 'object' ? [rows] : []);
    return list.slice(0, 5).map(c => ({
      name: text(c.name || c.cardName, 120),
      set: text(c.setName || c.set, 120),
      number: text(c.cardNumber || c.number || c.collectorNumber || c.card_number, 20),
      year: text(card.year, 4),
      finish: text(card.finish, 20),
      market: firstMoneyValue(c.marketPrice?.price, c.prices?.market?.price, c.marketPrice, c.market, c.price, c.selectedVariant?.marketPrice),
      category: 'Pokemon TCG',
      source: 'pokemonpricetracker',
      tcgPlayerId: text(c.tcgPlayerId, 40),
    })).filter(c => c.name);
  } catch (e) { return []; }
}

// Scryfall's public API needs no auth and no per-store gating, so unlike
// Pokemon this works for every source (including scanner uploads with no
// attached user token).
async function resolveMtgCandidates(card) {
  const q = [card.name, card.setName].filter(Boolean).join(' ').trim();
  if (!q) return [];
  try {
    const res = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&order=released`, { headers: { 'User-Agent': 'TheManaPocketCardIntake/1.0', Accept: 'application/json' } });
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    const list = Array.isArray(data.data) ? data.data : [];
    const isFoil = /foil/i.test(card.finish || '');
    return list.slice(0, 5).map(c => ({
      name: text(c.name, 120),
      set: text(c.set_name, 120),
      number: text(c.collector_number, 20),
      year: text((c.released_at || '').slice(0, 4), 4),
      finish: text(card.finish, 20),
      market: firstMoneyValue(isFoil ? c.prices?.usd_foil : c.prices?.usd, c.prices?.usd, c.prices?.usd_foil),
      category: 'Magic: The Gathering',
      source: 'scryfall',
      scryfallId: text(c.id, 60),
    })).filter(c => c.name);
  } catch (e) { return []; }
}

// The one place a captured photo actually gets identified + priced. Run via
// ctx.waitUntil at capture time (see createItem/scannerUpload below), so it
// keeps running whether or not the browser tab that captured the photo is
// still open -- the store can shoot a 300-card batch, close the tab, and
// come back to a fully processed review queue.
//
// Sports and One Piece TCG only get the raw Claude-extracted identity here
// (name/set/year/number/parallel) -- there is no live text-search catalog
// API wired in server-side for those two yet (CardSightAI identifies FROM a
// photo, it doesn't expose a by-name search endpoint), so they land in
// needs_review with an honest note instead of a fabricated price. Pokemon
// and MTG get a real, verified market price from resolvePokemonCandidates/
// resolveMtgCandidates above.
async function identifyAndResolveCardIntakeItem(db, env, deps, item, callCtx) {
  try {
    await db(`card_intake_items?id=eq.${item.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'processing' }) });
    const key = (item.front_image_url || '').split('/inventory/photo/')[1];
    if (!key || !env.MTG_CATALOG_R2) throw new Error('No stored image to identify');
    const obj = await env.MTG_CATALOG_R2.get(key);
    if (!obj) throw new Error('Stored image not found in photo storage');
    const base64 = arrayBufferToBase64(await obj.arrayBuffer());
    const cards = await deps.identifyCardsFromImageBase64(env, base64);
    if (!cards.length) {
      await db(`card_intake_items?id=eq.${item.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'needs_review', error: 'No card detected in this photo' }) });
      return;
    }
    const card = cards[0];
    let candidates = [];
    let priceProvider = '';
    if (card.game === 'pokemon') { candidates = await resolvePokemonCandidates(callCtx.originUrl, callCtx.storeId, callCtx.authToken, card); priceProvider = 'pokemonpricetracker'; }
    else if (card.game === 'mtg') { candidates = await resolveMtgCandidates(card); priceProvider = 'scryfall'; }
    const best = candidates[0] || null;
    const cardIdConfidence = ciConfidenceFromLabel(card.confidence) * (best ? 1 : 0.5);
    const hasVariantSignal = !!(card.finish || card.specialMarkings);
    const variantConfidence = !best ? 0 : (hasVariantSignal ? 0.78 : 0.5);
    const needsBack = !best || cardIdConfidence < 0.5 || (!card.number && candidates.length > 1);
    const marketCents = best ? Math.round(num(best.market, 0) * 100) : 0;
    const bestMatch = best || { name: card.name, set: card.setName, number: card.number, year: card.year, category: ciCategoryForGame(card.game), finish: card.finish, market: 0 };
    const noLivePriceCategory = card.game === 'sports' || card.game === 'one_piece';
    await db(`card_intake_items?id=eq.${item.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: needsBack ? 'needs_back' : 'needs_review',
        category: ciCategoryForGame(card.game),
        best_match: bestMatch, candidates,
        card_id_confidence: cardIdConfidence, variant_confidence: variantConfidence,
        market_cents: marketCents, high_value: marketCents >= HIGH_VALUE_CENTS,
        error: best ? null
          : noLivePriceCategory ? 'Identified, but no live price source is wired in server-side for this category yet -- set price manually.'
          : (card.game === 'pokemon' && !callCtx.authToken) ? 'Identified, but pricing needs a signed-in session -- reopen this review from the dashboard to fetch a price.'
          : 'No catalog match found for this card',
      }),
    });
    await db('card_identification_attempts', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([{
        item_id: item.id, store_id: item.store_id, provider: 'own-ai',
        request: { query: [card.year, card.setName, card.name, card.number].filter(Boolean).join(' ') },
        response: { cardsFound: cards.length, candidatesFound: candidates.length },
        card_id_confidence: cardIdConfidence, variant_confidence: variantConfidence, status: 'ok',
      }]),
    });
    if (best && marketCents > 0) {
      await db('pricing_snapshots', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([{ item_id: item.id, store_id: item.store_id, provider: priceProvider, price_cents: marketCents, raw: best }]) });
    }
  } catch (e) {
    try { await db(`card_intake_items?id=eq.${item.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'failed', error: String(e.message || e).slice(0, 400) }) }); } catch (_) { /* never leave it silently stuck */ }
  }
}

function jsonField(value) {
  if (value == null) return undefined;
  try { return JSON.parse(JSON.stringify(value)); } catch (_) { return undefined; }
}

// Default configurable acquisition tiers, applied only when a store hasn't
// set its own -- these are a reasonable starting point, not a fixed policy.
function defaultAcquisitionTiers() {
  return [
    { minCents: 0, maxCents: 100, pct: 20 },
    { minCents: 100, maxCents: 500, pct: 30 },
    { minCents: 500, maxCents: 2000, pct: 50 },
    { minCents: 2000, maxCents: 10000, pct: 65 },
    { minCents: 10000, maxCents: null, pct: 70 },
  ];
}

function applyAcquisitionTiers(tiers, marketCents) {
  const list = Array.isArray(tiers) && tiers.length ? tiers : defaultAcquisitionTiers();
  const cents = Math.max(0, num(marketCents, 0));
  const tier = list.find(t => cents >= num(t.minCents, 0) && (t.maxCents == null || cents < num(t.maxCents, Infinity)))
    || list[list.length - 1];
  const pct = tier ? Math.max(0, Math.min(100, num(tier.pct, 0))) : 0;
  return Math.round(cents * pct / 100);
}

async function getAcquisitionTiers(db, storeId, category) {
  const cat = text(category, 60) || 'default';
  const { data } = await db(`acquisition_rules?store_id=eq.${encodeURIComponent(storeId)}&category=eq.${encodeURIComponent(cat)}&select=tiers&limit=1`);
  if (data?.[0]?.tiers) return data[0].tiers;
  if (cat !== 'default') {
    const { data: fallback } = await db(`acquisition_rules?store_id=eq.${encodeURIComponent(storeId)}&category=eq.default&select=tiers&limit=1`);
    if (fallback?.[0]?.tiers) return fallback[0].tiers;
  }
  return defaultAcquisitionTiers();
}

// The single place a card_intake_items row becomes a real physical-copy
// inventory row. Mirrors the inventory_items.data shape FOC receiving
// already uses (name/category/cost/market/qty/image/source), so a promoted
// card shows up in Inventory looking like anything else the store stocks --
// origin linkage (batch/collection/allocated cost) rides inside data,
// same as every other provenance field already stored there (focSkuId,
// ebayListingId, etc.) rather than new columns on a huge existing table.
async function promoteItemToInventory(db, storeId, item, opts = {}) {
  if (item.inventory_item_id) return item.inventory_item_id;
  const fields = item.final_fields || item.best_match || {};
  const name = text(fields.name || fields.title, 200) || 'Unidentified card';
  const category = text(fields.category, 60) || text(item.category, 60) || 'Sports Card';
  const marketCents = num(fields.marketCents ?? item.market_cents, 0);
  const costCents = num(opts.allocatedCostCents, item.cost_cents != null ? item.cost_cents : Math.round(marketCents * 0.5));
  const row = {
    store_id: storeId,
    status: 'in_stock',
    data: {
      name,
      category,
      set: text(fields.set || fields.setName, 120) || '',
      cardNumber: text(fields.number || fields.cardNumber, 20) || '',
      year: text(fields.year, 4) || '',
      variant: text(fields.variant || fields.finish, 60) || '',
      condition: text(item.condition || fields.condition, 40) || 'NM',
      cost: Math.round(costCents) / 100,
      market: Math.round(marketCents) / 100,
      salePrice: Math.round(marketCents) / 100,
      qty: 1,
      quantity: 1,
      image: item.front_image_url || '',
      backImage: item.back_image_url || '',
      source: 'card_intake',
      cardIntakeBatchId: item.batch_id,
      cardIntakeItemId: item.id,
      cardIntakeCollectionBuyId: item.collection_buy_id || undefined,
      cardIntakeAllocatedCostCents: opts.allocatedCostCents != null ? opts.allocatedCostCents : undefined,
      cardIntakePromotedAt: new Date().toISOString(),
    },
  };
  const { data: inserted } = await db('inventory_items', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([row]) });
  const inventoryItemId = inserted?.[0]?.id;
  if (inventoryItemId) {
    await db(`card_intake_items?id=eq.${item.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ inventory_item_id: inventoryItemId, status: 'approved' }) });
  }
  return inventoryItemId;
}

async function createBatch(request, env, deps) {
  const limited = await deps.readJsonWithLimit(request, 16 * 1024); if (limited.error) return limited.error;
  const body = limited.data || {};
  const storeId = text(body.storeId, 80);
  const auth = await deps.requireStoreUser(request, env, storeId); if (auth.error) return auth.error;
  const source = INTAKE_SOURCES.has(body.source) ? body.source : 'MANUAL';
  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
  const row = {
    store_id: storeId, source, status: 'open',
    collection_buy_id: text(body.collectionBuyId, 80) || null,
    label: text(body.label, 200) || null, notes: text(body.notes, 2000) || null,
    created_by: auth.user.id,
  };
  const { data } = await db('card_intake_batches', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([row]) });
  return deps.json({ ok: true, batch: data?.[0] });
}

async function listOrGetBatches(request, env, deps, url) {
  const storeId = text(url.searchParams.get('store_id'), 80);
  const auth = await deps.requireStoreUser(request, env, storeId); if (auth.error) return auth.error;
  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
  const id = text(url.searchParams.get('id'), 80);
  if (id) {
    const { data } = await db(`card_intake_batches?id=eq.${encodeURIComponent(id)}&store_id=eq.${encodeURIComponent(storeId)}&select=*&limit=1`);
    const batch = data?.[0];
    if (!batch) return deps.json({ ok: false, error: 'Batch not found' }, 404);
    const { data: items } = await db(`card_intake_items?batch_id=eq.${encodeURIComponent(id)}&select=id,status,category,high_value,card_id_confidence,thumbnail_url,front_image_url,best_match&order=sequence.asc`);
    return deps.json({ ok: true, batch, items: items || [] });
  }
  const status = text(url.searchParams.get('status'), 20);
  const collectionBuyId = text(url.searchParams.get('collection_buy_id'), 80);
  let path = `card_intake_batches?store_id=eq.${encodeURIComponent(storeId)}&select=*&order=created_at.desc&limit=200`;
  if (status) path += `&status=eq.${encodeURIComponent(status)}`;
  if (collectionBuyId) path += `&collection_buy_id=eq.${encodeURIComponent(collectionBuyId)}`;
  const { data: batches } = await db(path);
  const ids = (batches || []).map(b => b.id);
  let counts = {};
  if (ids.length) {
    const { data: items } = await db(`card_intake_items?batch_id=in.(${ids.map(encodeURIComponent).join(',')})&select=batch_id,status`);
    counts = (items || []).reduce((acc, it) => {
      acc[it.batch_id] = acc[it.batch_id] || { total: 0, needs_review: 0, approved: 0, needs_back: 0 };
      acc[it.batch_id].total++;
      if (acc[it.batch_id][it.status] != null) acc[it.batch_id][it.status]++;
      else acc[it.batch_id][it.status] = 1;
      return acc;
    }, {});
  }
  return deps.json({ ok: true, batches: (batches || []).map(b => ({ ...b, itemCounts: counts[b.id] || { total: 0 } })) });
}

async function updateBatch(request, env, deps) {
  const limited = await deps.readJsonWithLimit(request, 16 * 1024); if (limited.error) return limited.error;
  const body = limited.data || {};
  const storeId = text(body.storeId, 80);
  const auth = await deps.requireStoreUser(request, env, storeId); if (auth.error) return auth.error;
  const batchId = text(body.batchId, 80); if (!batchId) return deps.json({ ok: false, error: 'batchId is required' }, 400);
  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
  const patch = {};
  if (body.status === 'finished') { patch.status = 'finished'; patch.finished_at = new Date().toISOString(); }
  else if (body.status === 'archived') patch.status = 'archived';
  else if (body.status === 'open') patch.status = 'open';
  if (body.label != null) patch.label = text(body.label, 200);
  if (body.notes != null) patch.notes = text(body.notes, 2000);
  const { data } = await db(`card_intake_batches?id=eq.${encodeURIComponent(batchId)}&store_id=eq.${encodeURIComponent(storeId)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  return deps.json({ ok: true, batch: data?.[0] });
}

async function createItem(request, env, deps) {
  const limited = await deps.readJsonWithLimit(request, 32 * 1024); if (limited.error) return limited.error;
  const body = limited.data || {};
  const storeId = text(body.storeId, 80);
  const auth = await deps.requireStoreUser(request, env, storeId); if (auth.error) return auth.error;
  const batchId = text(body.batchId, 80); if (!batchId) return deps.json({ ok: false, error: 'batchId is required' }, 400);
  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
  const { data: batchRows } = await db(`card_intake_batches?id=eq.${encodeURIComponent(batchId)}&store_id=eq.${encodeURIComponent(storeId)}&select=id,source,collection_buy_id&limit=1`);
  const batch = batchRows?.[0];
  if (!batch) return deps.json({ ok: false, error: 'Batch not found' }, 404);
  const row = {
    batch_id: batchId, store_id: storeId, collection_buy_id: batch.collection_buy_id || null,
    sequence: Math.max(1, Math.round(num(body.sequence, 1))),
    source: INTAKE_SOURCES.has(body.source) ? body.source : batch.source,
    status: 'captured',
    front_image_url: text(body.frontImageUrl, 1000) || null,
    thumbnail_url: text(body.thumbnailUrl, 1000) || text(body.frontImageUrl, 1000) || null,
    category: text(body.category, 60) || null,
  };
  const { data } = await db('card_intake_items', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([row]) });
  const inserted = data?.[0];
  // Fire-and-forget: identification/pricing runs in the background via
  // ctx.waitUntil, which keeps the Worker alive to finish it regardless of
  // whether the browser that captured this photo is still connected -- this
  // is what makes "close the tab mid-batch" safe.
  if (inserted && deps.waitUntil) {
    const authToken = text(request.headers.get('Authorization'), 2000);
    deps.waitUntil(identifyAndResolveCardIntakeItem(db, env, deps, inserted, { originUrl: new URL(request.url).origin, storeId, authToken }).catch(e => console.error('Card intake background processing failed for', inserted.id, e)));
  }
  return deps.json({ ok: true, item: inserted });
}

async function updateItem(request, env, deps) {
  const limited = await deps.readJsonWithLimit(request, 64 * 1024); if (limited.error) return limited.error;
  const body = limited.data || {};
  const storeId = text(body.storeId, 80);
  const auth = await deps.requireStoreUser(request, env, storeId); if (auth.error) return auth.error;
  const itemId = text(body.itemId, 80); if (!itemId) return deps.json({ ok: false, error: 'itemId is required' }, 400);
  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
  const patch = {};
  if (body.status != null && ITEM_STATUSES.has(body.status)) patch.status = body.status;
  if (body.backImageUrl != null) patch.back_image_url = text(body.backImageUrl, 1000) || null;
  if (body.thumbnailUrl != null) patch.thumbnail_url = text(body.thumbnailUrl, 1000) || null;
  if (body.category != null) patch.category = text(body.category, 60) || null;
  if (body.bestMatch !== undefined) patch.best_match = jsonField(body.bestMatch) ?? null;
  if (body.candidates !== undefined) patch.candidates = jsonField(body.candidates) ?? [];
  if (body.finalFields !== undefined) patch.final_fields = jsonField(body.finalFields) ?? null;
  if (body.cardIdConfidence != null) patch.card_id_confidence = num(body.cardIdConfidence, null);
  if (body.variantConfidence != null) patch.variant_confidence = num(body.variantConfidence, null);
  if (body.condition != null) patch.condition = text(body.condition, 40) || null;
  if (body.costCents != null) patch.cost_cents = Math.round(num(body.costCents, 0));
  if (body.marketCents != null) {
    patch.market_cents = Math.round(num(body.marketCents, 0));
    patch.high_value = patch.market_cents >= HIGH_VALUE_CENTS;
  }
  if (body.error != null) patch.error = text(body.error, 500) || null;
  if (!Object.keys(patch).length) return deps.json({ ok: false, error: 'No recognized fields to update' }, 400);
  const { data } = await db(`card_intake_items?id=eq.${encodeURIComponent(itemId)}&store_id=eq.${encodeURIComponent(storeId)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  return deps.json({ ok: true, item: data?.[0] });
}

async function listOrGetItems(request, env, deps, url) {
  const storeId = text(url.searchParams.get('store_id'), 80);
  const auth = await deps.requireStoreUser(request, env, storeId); if (auth.error) return auth.error;
  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
  const id = text(url.searchParams.get('id'), 80);
  if (id) {
    const { data } = await db(`card_intake_items?id=eq.${encodeURIComponent(id)}&store_id=eq.${encodeURIComponent(storeId)}&select=*&limit=1`);
    const item = data?.[0];
    if (!item) return deps.json({ ok: false, error: 'Item not found' }, 404);
    const [{ data: attempts }, { data: reviews }] = await Promise.all([
      db(`card_identification_attempts?item_id=eq.${encodeURIComponent(id)}&select=*&order=created_at.desc&limit=20`),
      db(`card_reviews?item_id=eq.${encodeURIComponent(id)}&select=*&order=created_at.desc&limit=20`),
    ]);
    return deps.json({ ok: true, item, attempts: attempts || [], reviews: reviews || [] });
  }
  let path = `card_intake_items?store_id=eq.${encodeURIComponent(storeId)}&select=*&order=sequence.asc&limit=1000`;
  const batchId = text(url.searchParams.get('batch_id'), 80);
  const collectionBuyId = text(url.searchParams.get('collection_buy_id'), 80);
  const status = text(url.searchParams.get('status'), 20);
  const highValue = url.searchParams.get('high_value');
  if (batchId) path += `&batch_id=eq.${encodeURIComponent(batchId)}`;
  if (collectionBuyId) path += `&collection_buy_id=eq.${encodeURIComponent(collectionBuyId)}`;
  if (status) path += `&status=in.(${status.split(',').map(encodeURIComponent).join(',')})`;
  if (highValue === '1') path += '&high_value=eq.true';
  const { data } = await db(path);
  return deps.json({ ok: true, items: data || [] });
}

async function logAttempt(request, env, deps) {
  const limited = await deps.readJsonWithLimit(request, 64 * 1024); if (limited.error) return limited.error;
  const body = limited.data || {};
  const storeId = text(body.storeId, 80);
  const auth = await deps.requireStoreUser(request, env, storeId); if (auth.error) return auth.error;
  const itemId = text(body.itemId, 80); if (!itemId) return deps.json({ ok: false, error: 'itemId is required' }, 400);
  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
  const row = {
    item_id: itemId, store_id: storeId, provider: text(body.provider, 60) || 'own-ai',
    request: jsonField(body.request) ?? null, response: jsonField(body.response) ?? null,
    card_id_confidence: body.cardIdConfidence != null ? num(body.cardIdConfidence, null) : null,
    variant_confidence: body.variantConfidence != null ? num(body.variantConfidence, null) : null,
    status: text(body.status, 20) || 'ok',
  };
  const { data } = await db('card_identification_attempts', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([row]) });
  return deps.json({ ok: true, attempt: data?.[0] });
}

// APPROVE / EDIT / WRONG / SKIP -- the four verification-queue actions.
// A card still attached to a collection_buy stops at "approved" (a
// collection evaluation item, not yet owned) -- it only becomes a real
// inventory row once the whole collection is purchased. A standalone
// intake item (no collection) promotes to inventory immediately on approve.
async function reviewItem(request, env, deps) {
  const limited = await deps.readJsonWithLimit(request, 64 * 1024); if (limited.error) return limited.error;
  const body = limited.data || {};
  const storeId = text(body.storeId, 80);
  const auth = await deps.requireStoreUser(request, env, storeId); if (auth.error) return auth.error;
  const itemId = text(body.itemId, 80); if (!itemId) return deps.json({ ok: false, error: 'itemId is required' }, 400);
  const action = text(body.action, 20);
  if (!['approve', 'edit', 'wrong', 'skip'].includes(action)) return deps.json({ ok: false, error: 'action must be approve, edit, wrong, or skip' }, 400);
  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
  const { data: rows } = await db(`card_intake_items?id=eq.${encodeURIComponent(itemId)}&store_id=eq.${encodeURIComponent(storeId)}&select=*&limit=1`);
  const item = rows?.[0];
  if (!item) return deps.json({ ok: false, error: 'Item not found' }, 404);
  const reviewRow = {
    item_id: itemId, store_id: storeId, reviewer_user_id: auth.user.id, action,
    chosen_candidate_index: body.chosenCandidateIndex != null ? Math.round(num(body.chosenCandidateIndex, 0)) : null,
    final_fields: jsonField(body.finalFields) ?? null, note: text(body.note, 500) || null,
  };
  await db('card_reviews', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([reviewRow]) });

  let finalFields = item.final_fields;
  if (body.finalFields) finalFields = { ...(item.final_fields || item.best_match || {}), ...body.finalFields };
  else if (body.chosenCandidateIndex != null && Array.isArray(item.candidates)) {
    const chosen = item.candidates[Math.round(num(body.chosenCandidateIndex, -1))];
    if (chosen) finalFields = chosen;
  }

  let updatedItem = item;
  if (action === 'wrong') {
    ({ data: [updatedItem] } = await db(`card_intake_items?id=eq.${encodeURIComponent(itemId)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'rejected' }) }));
  } else if (action === 'edit') {
    ({ data: [updatedItem] } = await db(`card_intake_items?id=eq.${encodeURIComponent(itemId)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'needs_review', final_fields: finalFields, condition: text(body.finalFields?.condition, 40) || item.condition }) }));
  } else if (action === 'skip') {
    updatedItem = item; // no state change -- just logged, comes back around in the queue
  } else if (action === 'approve') {
    const patch = { final_fields: finalFields, condition: text(body.finalFields?.condition, 40) || item.condition };
    if (!item.collection_buy_id) {
      const { data: [saved] } = await db(`card_intake_items?id=eq.${encodeURIComponent(itemId)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
      const inventoryItemId = await promoteItemToInventory(db, storeId, saved);
      updatedItem = { ...saved, inventory_item_id: inventoryItemId, status: 'approved' };
    } else {
      patch.status = 'approved';
      ({ data: [updatedItem] } = await db(`card_intake_items?id=eq.${encodeURIComponent(itemId)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) }));
    }
  }
  return deps.json({ ok: true, item: updatedItem });
}

async function createCollection(request, env, deps) {
  const limited = await deps.readJsonWithLimit(request, 16 * 1024); if (limited.error) return limited.error;
  const body = limited.data || {};
  const storeId = text(body.storeId, 80);
  const auth = await deps.requireStoreUser(request, env, storeId); if (auth.error) return auth.error;
  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
  const row = {
    store_id: storeId, seller: text(body.seller, 200) || null, name: text(body.name, 200) || null,
    category: text(body.category, 60) || null, estimated_card_count: body.estimatedCardCount != null ? Math.round(num(body.estimatedCardCount, 0)) : null,
    asking_price_cents: body.askingPriceCents != null ? Math.round(num(body.askingPriceCents, 0)) : null,
    notes: text(body.notes, 4000) || null, target_buy_percentage: body.targetBuyPercentage != null ? num(body.targetBuyPercentage, null) : null,
    status: 'draft', created_by: auth.user.id,
  };
  const { data } = await db('collection_buys', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([row]) });
  return deps.json({ ok: true, collection: data?.[0] });
}

function summarizeCollectionItems(items, tiers) {
  let identified = 0, needsReview = 0, highValue = 0, estimatedRetailCents = 0, suggestedAcquisitionCents = 0;
  for (const it of items) {
    const marketCents = num(it.market_cents ?? it.best_match?.marketCents, 0);
    if (it.status === 'needs_review' || it.status === 'needs_back') needsReview++;
    if (it.status !== 'captured' && it.status !== 'processing' && it.status !== 'rejected') identified++;
    if (it.high_value) highValue++;
    estimatedRetailCents += marketCents;
    if (it.status !== 'rejected') suggestedAcquisitionCents += applyAcquisitionTiers(tiers, marketCents);
  }
  return {
    totalCards: items.length, identified, unidentified: items.length - identified, needsReview, highValue,
    estimatedRetailCents, estimatedRealisticSaleCents: Math.round(estimatedRetailCents * 0.85), suggestedAcquisitionCents,
  };
}

async function listOrGetCollections(request, env, deps, url) {
  const storeId = text(url.searchParams.get('store_id'), 80);
  const auth = await deps.requireStoreUser(request, env, storeId); if (auth.error) return auth.error;
  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
  const id = text(url.searchParams.get('id'), 80);
  if (id) {
    const { data: rows } = await db(`collection_buys?id=eq.${encodeURIComponent(id)}&store_id=eq.${encodeURIComponent(storeId)}&select=*&limit=1`);
    const collection = rows?.[0];
    if (!collection) return deps.json({ ok: false, error: 'Collection not found' }, 404);
    const { data: items } = await db(`card_intake_items?collection_buy_id=eq.${encodeURIComponent(id)}&select=*&order=sequence.asc&limit=5000`);
    const tiers = await getAcquisitionTiers(db, storeId, collection.category);
    return deps.json({ ok: true, collection, items: items || [], summary: summarizeCollectionItems(items || [], tiers) });
  }
  const status = text(url.searchParams.get('status'), 20);
  let path = `collection_buys?store_id=eq.${encodeURIComponent(storeId)}&select=*&order=created_at.desc&limit=200`;
  if (status) path += `&status=eq.${encodeURIComponent(status)}`;
  const { data } = await db(path);
  return deps.json({ ok: true, collections: data || [] });
}

async function updateCollection(request, env, deps) {
  const limited = await deps.readJsonWithLimit(request, 16 * 1024); if (limited.error) return limited.error;
  const body = limited.data || {};
  const storeId = text(body.storeId, 80);
  const auth = await deps.requireStoreUser(request, env, storeId); if (auth.error) return auth.error;
  const collectionId = text(body.collectionId, 80); if (!collectionId) return deps.json({ ok: false, error: 'collectionId is required' }, 400);
  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
  const patch = {};
  for (const [bodyKey, col] of [['seller', 'seller'], ['name', 'name'], ['category', 'category'], ['notes', 'notes']]) {
    if (body[bodyKey] != null) patch[col] = text(body[bodyKey], bodyKey === 'notes' ? 4000 : 200) || null;
  }
  if (body.estimatedCardCount != null) patch.estimated_card_count = Math.round(num(body.estimatedCardCount, 0));
  if (body.askingPriceCents != null) patch.asking_price_cents = Math.round(num(body.askingPriceCents, 0));
  if (body.targetBuyPercentage != null) patch.target_buy_percentage = num(body.targetBuyPercentage, null);
  if (body.status && ['draft', 'evaluating', 'offered', 'declined'].includes(body.status)) patch.status = body.status;
  if (!Object.keys(patch).length) return deps.json({ ok: false, error: 'No recognized fields to update' }, 400);
  const { data } = await db(`collection_buys?id=eq.${encodeURIComponent(collectionId)}&store_id=eq.${encodeURIComponent(storeId)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  return deps.json({ ok: true, collection: data?.[0] });
}

// PURCHASE COLLECTION: market-weighted cost allocation, never a flat
// price/count split -- a $400 rookie card and a $2 common bought in the
// same lot should not carry the same cost basis. Every approved item's
// share of totalCostCents is proportional to its own market value; total
// collection cost is retained on collection_buys for accounting even
// though it's now spread across many individual inventory rows.
async function purchaseCollection(request, env, deps) {
  const limited = await deps.readJsonWithLimit(request, 32 * 1024); if (limited.error) return limited.error;
  const body = limited.data || {};
  const storeId = text(body.storeId, 80);
  const auth = await deps.requireStoreUser(request, env, storeId, ['owner', 'admin', 'manager']); if (auth.error) return auth.error;
  const collectionId = text(body.collectionId, 80); if (!collectionId) return deps.json({ ok: false, error: 'collectionId is required' }, 400);
  const totalCostCents = Math.round(num(body.totalCostCents, -1));
  if (totalCostCents < 0) return deps.json({ ok: false, error: 'totalCostCents is required' }, 400);
  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
  const { data: collectionRows } = await db(`collection_buys?id=eq.${encodeURIComponent(collectionId)}&store_id=eq.${encodeURIComponent(storeId)}&select=*&limit=1`);
  const collection = collectionRows?.[0];
  if (!collection) return deps.json({ ok: false, error: 'Collection not found' }, 404);
  if (collection.status === 'purchased') return deps.json({ ok: false, error: 'This collection has already been purchased' }, 409);

  let { data: items } = await db(`card_intake_items?collection_buy_id=eq.${encodeURIComponent(collectionId)}&status=eq.approved&select=*&limit=5000`);
  items = items || [];
  const includeIds = Array.isArray(body.itemIds) && body.itemIds.length ? new Set(body.itemIds.map(String)) : null;
  const selected = includeIds ? items.filter(it => includeIds.has(String(it.id))) : items;
  if (!selected.length) return deps.json({ ok: false, error: 'No approved cards to purchase yet -- review at least one card first' }, 400);

  const marketByItem = selected.map(it => ({ item: it, marketCents: Math.max(0, num(it.market_cents ?? it.final_fields?.marketCents ?? it.best_match?.marketCents, 0)) }));
  const totalMarketCents = marketByItem.reduce((sum, x) => sum + x.marketCents, 0);
  const inventoryItemIds = [];
  const failed = [];
  for (const { item, marketCents } of marketByItem) {
    const allocatedCostCents = totalMarketCents > 0
      ? Math.round(totalCostCents * (marketCents / totalMarketCents))
      : Math.round(totalCostCents / marketByItem.length);
    try {
      const inventoryItemId = await promoteItemToInventory(db, storeId, item, { allocatedCostCents });
      if (inventoryItemId) inventoryItemIds.push(inventoryItemId);
    } catch (e) {
      failed.push({ itemId: item.id, error: e.message });
    }
  }
  await db(`collection_buys?id=eq.${encodeURIComponent(collectionId)}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'purchased', total_cost_cents: totalCostCents, purchased_at: new Date().toISOString() }),
  });
  return deps.json({ ok: true, purchased: inventoryItemIds.length, inventoryItemIds, failed, totalCostCents });
}

async function getOrPutAcquisitionRules(request, env, deps, url) {
  if (request.method === 'GET') {
    const storeId = text(url.searchParams.get('store_id'), 80);
    const auth = await deps.requireStoreUser(request, env, storeId); if (auth.error) return auth.error;
    const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
    const { data } = await db(`acquisition_rules?store_id=eq.${encodeURIComponent(storeId)}&select=*&order=category.asc`);
    const rows = data && data.length ? data : [{ store_id: storeId, category: 'default', tiers: defaultAcquisitionTiers() }];
    return deps.json({ ok: true, rules: rows });
  }
  const limited = await deps.readJsonWithLimit(request, 16 * 1024); if (limited.error) return limited.error;
  const body = limited.data || {};
  const storeId = text(body.storeId, 80);
  const auth = await deps.requireStoreUser(request, env, storeId, ['owner', 'admin', 'manager']); if (auth.error) return auth.error;
  const category = text(body.category, 60) || 'default';
  const tiers = Array.isArray(body.tiers) ? body.tiers.map(t => ({ minCents: Math.round(num(t.minCents, 0)), maxCents: t.maxCents == null ? null : Math.round(num(t.maxCents, 0)), pct: Math.max(0, Math.min(100, num(t.pct, 0))) })) : defaultAcquisitionTiers();
  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
  const { data } = await db('acquisition_rules', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation', 'Content-Type': 'application/json' },
    body: JSON.stringify([{ store_id: storeId, category, tiers, effective_date: new Date().toISOString() }]),
  });
  return deps.json({ ok: true, rule: data?.[0] });
}

async function sha256Hex(value) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function registerScannerWorkstation(request, env, deps) {
  const limited = await deps.readJsonWithLimit(request, 16 * 1024); if (limited.error) return limited.error;
  const body = limited.data || {};
  const storeId = text(body.storeId, 80);
  const auth = await deps.requireStoreUser(request, env, storeId, ['owner', 'admin', 'manager']); if (auth.error) return auth.error;
  const name = text(body.name, 120) || 'Scanner station';
  const token = crypto.randomUUID() + crypto.randomUUID();
  const tokenHash = await sha256Hex(token);
  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
  const { data } = await db('scanner_workstations', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([{ store_id: storeId, name, token_hash: tokenHash, created_by: auth.user.id }]) });
  // The token is only ever returned here, at creation -- only its hash is stored.
  return deps.json({ ok: true, workstation: data?.[0], token });
}

// Scanner agents (the watched-folder uploader for something like a Ricoh
// fi-8170) authenticate with a per-workstation token, not a staff login --
// this is the one route in the module that doesn't call requireStoreUser.
// It reuses the exact same card_intake_items pipeline every other source
// feeds -- the scanner is just another image source, never a special case
// past this one route.
async function scannerUpload(request, env, deps, url) {
  const token = text(request.headers.get('X-Scanner-Token') || url.searchParams.get('token'), 200);
  if (!token) return deps.json({ ok: false, error: 'Scanner token required' }, 401);
  const db = (p, o) => deps.supabaseAdminFetch(env, p, o);
  const tokenHash = await sha256Hex(token);
  const { data: stations } = await db(`scanner_workstations?token_hash=eq.${encodeURIComponent(tokenHash)}&select=*&limit=1`);
  const station = stations?.[0];
  if (!station) return deps.json({ ok: false, error: 'Unknown or revoked scanner token' }, 401);
  if (!env.MTG_CATALOG_R2) return deps.json({ ok: false, error: 'Photo storage not configured' }, 500);
  const contentType = String(request.headers.get('Content-Type') || 'image/jpeg').split(';')[0].trim();
  if (!contentType.startsWith('image/')) return deps.json({ ok: false, error: 'Only image uploads are supported' }, 400);
  const buf = await request.arrayBuffer();
  if (!buf.byteLength) return deps.json({ ok: false, error: 'Empty upload' }, 400);
  if (buf.byteLength > 12 * 1024 * 1024) return deps.json({ ok: false, error: 'Photo must be under 12MB' }, 400);
  const ext = (contentType.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '') || 'jpg';
  const key = `inventory-photos/${station.store_id}/scanner-${Date.now()}-${crypto.randomUUID()}.${ext}`;
  await env.MTG_CATALOG_R2.put(key, buf, { httpMetadata: { contentType } });
  const imageUrl = `${url.origin}/inventory/photo/${key}`;

  const todayLabel = new Date().toISOString().slice(0, 10);
  const { data: openBatches } = await db(`card_intake_batches?store_id=eq.${encodeURIComponent(station.store_id)}&source=eq.SCANNER&status=eq.open&label=eq.${encodeURIComponent(station.name + ' ' + todayLabel)}&select=id&limit=1`);
  let batchId = openBatches?.[0]?.id;
  if (!batchId) {
    const { data: created } = await db('card_intake_batches', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([{ store_id: station.store_id, source: 'SCANNER', status: 'open', label: `${station.name} ${todayLabel}` }]) });
    batchId = created?.[0]?.id;
  }
  const { data: existingCount } = await db(`card_intake_items?batch_id=eq.${encodeURIComponent(batchId)}&select=id`);
  const sequence = (existingCount?.length || 0) + 1;
  const { data: itemRows } = await db('card_intake_items', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify([{ batch_id: batchId, store_id: station.store_id, sequence, source: 'SCANNER', status: 'captured', front_image_url: imageUrl, thumbnail_url: imageUrl }]),
  });
  await db(`scanner_workstations?id=eq.${encodeURIComponent(station.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ last_seen_at: new Date().toISOString() }) });
  const scannedItem = itemRows?.[0];
  // A scanner upload has no logged-in user attached, so there's no auth
  // token to resolve a live Pokemon price with (see resolvePokemonCandidates)
  // -- MTG (Scryfall, no auth needed) still resolves fully; identification
  // itself always runs regardless.
  if (scannedItem && deps.waitUntil) {
    deps.waitUntil(identifyAndResolveCardIntakeItem(db, env, deps, scannedItem, { originUrl: url.origin, storeId: station.store_id, authToken: '' }).catch(e => console.error('Card intake background processing failed for', scannedItem.id, e)));
  }
  return deps.json({ ok: true, batchId, item: scannedItem });
}

export async function handleCardIntakeRequest(request, env, url, deps) {
  const path = url.pathname;
  if (path === '/card-intake/batches' && request.method === 'POST') return createBatch(request, env, deps);
  if (path === '/card-intake/batches' && request.method === 'GET') return listOrGetBatches(request, env, deps, url);
  if (path === '/card-intake/batches' && request.method === 'PATCH') return updateBatch(request, env, deps);
  if (path === '/card-intake/items' && request.method === 'POST') return createItem(request, env, deps);
  if (path === '/card-intake/items' && request.method === 'GET') return listOrGetItems(request, env, deps, url);
  if (path === '/card-intake/items' && request.method === 'PATCH') return updateItem(request, env, deps);
  if (path === '/card-intake/attempts' && request.method === 'POST') return logAttempt(request, env, deps);
  if (path === '/card-intake/review' && request.method === 'POST') return reviewItem(request, env, deps);
  if (path === '/card-intake/acquisition-rules' && (request.method === 'GET' || request.method === 'PUT')) return getOrPutAcquisitionRules(request, env, deps, url);
  if (path === '/card-intake/scanner-workstations' && request.method === 'POST') return registerScannerWorkstation(request, env, deps);
  if (path === '/card-intake/scanner-upload' && request.method === 'POST') return scannerUpload(request, env, deps, url);
  if (path === '/collections' && request.method === 'POST') return createCollection(request, env, deps);
  if (path === '/collections' && request.method === 'GET') return listOrGetCollections(request, env, deps, url);
  if (path === '/collections' && request.method === 'PATCH') return updateCollection(request, env, deps);
  if (path === '/collections/purchase' && request.method === 'POST') return purchaseCollection(request, env, deps);
  return deps.json({ ok: false, error: 'Card intake route not found' }, 404);
}

export { applyAcquisitionTiers, defaultAcquisitionTiers, promoteItemToInventory, HIGH_VALUE_CENTS, identifyAndResolveCardIntakeItem, resolvePokemonCandidates, resolveMtgCandidates };
