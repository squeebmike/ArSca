// Daily Pokémon price update on the Worker's schedule (store ask,
// 2026-10-25: "move the daily price update to the server"). The dashboard's
// daily sync only ran when a signed-in dashboard happened to be open after
// 3 AM -- it skipped 10/22, 10/23 and 10/24. Now the Worker checks every
// in-stock Pokémon card that has its exact TCGplayer product id, a batch
// each hour from 3 AM Pacific until all are done, at one credit a card (no
// eBay/history add-ons). Same rule as the dashboard: a change under 10% is
// applied, a bigger one waits in PRICE SYNC for review. Slabs (priced from
// PriceCharting's graded guide), dropship and unpriced-language items are
// left to the dashboard's own sync.

export const SERVER_SYNC_BATCH = 60;
export const SERVER_SYNC_START_HOUR = 3; // Pacific
export const SMALL_CHANGE_PCT = 10;
const LANGUAGE_UNPRICED = /traditional chinese|chinese|\bkorean\b|\bthai\b|\bindonesian\b|\bgerman\b|\bfrench\b|\bitalian\b|\bspanish\b|\bportuguese\b|繁體|简体|中文|한국어/i;
const SLAB_RE = /\b(PSA|BGS|BECKETT|CGC|SGC|TAG|HGA)\s*(?:GEM\s*(?:MINT|MT)\s*|MINT\s*|PRISTINE\s*)?(10|[1-9](?:\.5)?)(?![\d.])/i;
const SEALED_RE = /\b(etb|elite[\s-]*trainer[\s-]*box|booster[\s-]*(box|display|bundle|pack)|premium[\s-]*(figure[\s-]*)?collection|collection[\s-]*box|build[\s-]*&?[\s-]*battle|blister|\btin\b|booster bundle)\b/i;
const CONDITION_LABEL = { NM:'Near Mint', LP:'Lightly Played', MP:'Moderately Played', HP:'Heavily Played', DMG:'Damaged' };

export function pacificDay(at = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone:'America/Los_Angeles' }).format(new Date(at));
}
export function pacificHour(at = Date.now()) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone:'America/Los_Angeles', hour:'numeric', hourCycle:'h23' }).format(new Date(at)));
}
function money(v) {
  const n = typeof v === 'object' && v ? Number(v.price ?? v.market ?? v.value) : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}
function firstMoney(...values) { for (const v of values) { const n = money(v); if (n > 0) return n; } return 0; }
function conditionCode(c) {
  const t = String(c || 'NM').toLowerCase();
  if (/damag|dmg|poor/.test(t)) return 'DMG';
  if (/heav|\bhp\b/.test(t)) return 'HP';
  if (/moder|\bmp\b/.test(t)) return 'MP';
  if (/light|\blp\b|excellent/.test(t)) return 'LP';
  return 'NM';
}
export function tcgPlayerIdOf(d = {}) {
  let refs = d.externalRefs; if (typeof refs === 'string') { try { refs = JSON.parse(refs); } catch (_) { refs = null; } }
  const id = String(d.tcgPlayerId || d.tcgplayerId || d.tcgplayerProductId || refs?.tcgPlayerId || '').trim();
  if (/^\d+$/.test(id)) return id;
  const m = String(d.tcgPlayerUrl || refs?.tcgPlayerUrl || '').match(/tcgplayer\.com\/product\/(\d+)/i);
  return m ? m[1] : '';
}
export function isServerSyncItem(row = {}) {
  const d = row.data || {};
  if (row.status !== 'in_stock' || d.archivedAt) return false;
  if (!/^pok[eé]mon(\s+(tcg|cards?|trading card game|singles|sealed))?$/i.test(String(d.category || '').trim())) return false;
  if (d.dropship === true || d.ownershipType === 'supplier') return false;
  if (!tcgPlayerIdOf(d)) return false;
  if ((String(d.grader || '').trim() && String(d.grade || '').trim()) || SLAB_RE.test(String(d.selectedGrade || '')) || SLAB_RE.test(String(d.name || ''))) return false;
  if (LANGUAGE_UNPRICED.test([d.language, d.selectedLanguage].filter(Boolean).join(' ')) && !/japanese|english/i.test(String(d.language || d.selectedLanguage || ''))) return false;
  return true;
}
export function isSealedRow(d = {}) {
  return !!(d.is_sealed || d.isSealed) || /^(sealed|lot)$/i.test(String(d.productType || '')) || SEALED_RE.test([d.name, d.configuration].filter(Boolean).join(' '));
}
export function languageOf(d = {}) {
  return /japanese|\bjpn\b|日本語/i.test([d.language, d.selectedLanguage, d.name, d.set].filter(Boolean).join(' ')) ? 'japanese' : 'english';
}
export function checkedToday(d = {}, now = Date.now()) {
  return !!d.priceSyncCheckedAt && pacificDay(d.priceSyncCheckedAt) === pacificDay(now);
}

// WotC editions: the copy's own printing, Unlimited unless it says 1st
// Edition (same rule as pptEditionPrinting on the dashboard).
function editionOf(t) { t = String(t || '').toLowerCase(); return /\b1st\b|first[\s_-]*ed/.test(t) ? '1st Edition' : /shadowless/.test(t) ? 'Shadowless' : /unlimited/.test(t) ? 'Unlimited' : ''; }
function finishKind(t) { t = String(t || '').toLowerCase(); return t.includes('reverse') ? 'reverse' : (t.includes('holo') || t.includes('foil')) ? 'holo' : 'normal'; }
export function editionPrinting(variants = {}, d = {}) {
  const keys = Object.keys(variants || {});
  const editions = ['Unlimited', '1st Edition', 'Shadowless'].filter(e => keys.some(k => editionOf(k) === e));
  if (editions.length < 2) return '';
  const saved = String(d.selectedPrinting || d.printing || '').trim();
  const want = editionOf(saved) || editionOf(d.edition) || editionOf(d.name) || editions[0];
  if (keys.includes(saved) && editionOf(saved) === want) return saved;
  const inEdition = keys.filter(k => editionOf(k) === want);
  const kind = saved ? finishKind(saved) : '';
  return inEdition.find(k => finishKind(k) === kind) || inEdition[0] || '';
}
function variantPrice(map, code) {
  if (!map || typeof map !== 'object') return 0;
  const label = CONDITION_LABEL[code];
  const key = Object.keys(map).find(k => k === label || conditionCode(k) === code);
  return key ? money(map[key]) : 0;
}

// What PPT says this copy is worth now (0 = no real price for it).
export function serverSyncPrice(card = {}, d = {}) {
  const prices = card.prices || {};
  if (isSealedRow(d)) return firstMoney(card.unopenedPrice, prices.market, card.marketPrice, card.market);
  const code = conditionCode(d.condition);
  const variants = prices.variants || {};
  const edition = editionPrinting(variants, d);
  if (edition) return variantPrice(variants[edition], code);
  if (code === 'NM') return firstMoney(card.marketPrice, prices.market, card.market, card.price);
  const printing = variants[d.selectedPrinting] ? d.selectedPrinting : variants[prices.primaryPrinting] ? prices.primaryPrinting : Object.keys(variants)[0];
  return variantPrice(variants[printing], code) || variantPrice(prices.conditions, code);
}
function marketOf(d = {}) { return firstMoney(d.marketPrice, d.rawMarketPrice, d.market, d.price, d.displayPrice); }
function ruled(market, rule) {
  const bump = Math.max(market * (Number(rule?.pct) || 0) / 100, Number(rule?.flat) || 0, 0);
  return market > 0 ? Math.ceil(market + bump - 1e-9) : 0;
}

// One row + its PPT card -> what to write now, and/or what to queue.
export function planRow(row, card, now = Date.now()) {
  const d = row.data || {};
  const at = new Date(now).toISOString();
  const checked = { ...d, priceSyncCheckedAt:at };
  const fresh = card ? serverSyncPrice(card, d) : 0;
  if (!(fresh > 0)) return { kind:'no-price', data:checked };
  const old = marketOf(d);
  const lastUpdated = String(card.lastUpdated || card.prices?.lastUpdated || at);
  const snapshot = { pokemonPriceTrackerLastUpdated:lastUpdated, pokemonPriceTrackerPrices:card.prices || null, pokemonPriceTrackerVariants:card.prices?.variants || null };
  if (old > 0 && Math.abs(fresh - old) < 0.01) return { kind:'unchanged', data:{ ...checked, ...snapshot, priceUpdatedAt:at, lastPriceUpdate:lastUpdated, stalePrice:false, livePriceStatus:'live', priceSource:'PokemonPriceTracker server sync' } };
  const deltaPct = old > 0 ? Math.abs(fresh - old) / old * 100 : 100;
  if (old > 0 && deltaPct >= SMALL_CHANGE_PCT) {
    return { kind:'review', data:checked, proposal:{ itemId:row.id, name:d.name || '', oldPrice:old, newPrice:fresh, deltaPct:Math.round(deltaPct * 10) / 10, direction:fresh >= old ? 'up' : 'down', lastUpdated, tcgPlayerId:tcgPlayerIdOf(d), prices:card.prices || null, variants:card.prices?.variants || null, at } };
  }
  const locked = Number(d.priceOverride || 0) > 0;
  const list = locked ? {} : { salePrice:ruled(fresh, d.priceRule), listPrice:ruled(fresh, d.priceRule) };
  return { kind:'applied', oldPrice:old, newPrice:fresh, data:{ ...checked, ...snapshot, ...list,
    market:fresh, price:fresh, marketPrice:fresh, rawMarketPrice:fresh, lastMarketPrice:old, previousMarketPrice:old,
    marketPriceSource:'PokemonPriceTracker', priceSource:'PokemonPriceTracker server sync', lastPriceUpdate:lastUpdated, priceUpdatedAt:at, stalePrice:false, livePriceStatus:'live' } };
}

// Next rows to check this hour, oldest check first.
export function nextBatch(rows = [], now = Date.now(), size = SERVER_SYNC_BATCH) {
  return rows.filter(isServerSyncItem).filter(r => !checkedToday(r.data, now))
    .sort((a, b) => String(a.data?.priceSyncCheckedAt || '').localeCompare(String(b.data?.priceSyncCheckedAt || '')))
    .slice(0, size);
}

// deps: { db(path, opts), ppt(path, params) -> { ok, status, card }, kvGet, kvPut, log }
export async function runPokemonServerSync(storeId, deps, now = Date.now()) {
  if (pacificHour(now) < SERVER_SYNC_START_HOUR) return { skipped:'before 3 AM' };
  const s = encodeURIComponent(storeId);
  const { data:rows } = await deps.db(`inventory_items?store_id=eq.${s}&status=eq.in_stock&select=id,status,data&limit=5000`);
  const batch = nextBatch(rows || [], now);
  const out = { checked:0, applied:0, unchanged:0, review:0, noPrice:0, failed:0, left:0 };
  if (!batch.length) return out;
  const cardCache = new Map();
  const queue = [];
  for (const row of batch) {
    const d = row.data || {};
    const id = tcgPlayerIdOf(d), sealed = isSealedRow(d), language = languageOf(d);
    const cacheKey = (sealed ? 's:' : 'c:') + language + ':' + id;
    let got = cardCache.get(cacheKey);
    if (!got) {
      try { got = await deps.ppt(sealed ? '/sealed-products' : '/cards', { tcgPlayerId:id, language, limit:'1' }); }
      catch (e) { got = { ok:false, status:0, error:e.message }; }
      cardCache.set(cacheKey, got);
    }
    if (!got.ok && (got.status === 429 || got.status === 403)) { out.failed++; break; } // out of credits / rate limited: try next hour
    const plan = planRow(row, got.ok ? got.card : null, now);
    try {
      await deps.db(`inventory_items?id=eq.${encodeURIComponent(row.id)}&store_id=eq.${s}`, { method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ data:plan.data, updated_at:new Date(now).toISOString() }) });
    } catch (e) { out.failed++; continue; }
    out.checked++;
    if (plan.kind === 'applied') out.applied++;
    else if (plan.kind === 'unchanged') out.unchanged++;
    else if (plan.kind === 'review') { out.review++; queue.push(plan.proposal); }
    else out.noPrice++;
  }
  if (queue.length) {
    const key = 'price-sync-review:' + storeId;
    const existing = (await deps.kvGet(key)) || [];
    const byId = new Map(existing.map(p => [p.itemId, p]));
    for (const p of queue) byId.set(p.itemId, p);
    await deps.kvPut(key, [...byId.values()].slice(-500));
  }
  out.left = Math.max(0, nextBatch(rows || [], now, 100000).length - batch.length);
  return out;
}
