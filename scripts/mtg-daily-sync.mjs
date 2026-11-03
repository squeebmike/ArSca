// Daily Magic: The Gathering price update on the Worker's schedule (store,
// 2026-11-03: "Do prices on comics and all inventory update dynamically 1
// time per day?" -- Pokemon, comics and sports did; Magic only updated when
// a dashboard was open, last 10/28). Every in-stock Magic single or sealed
// product with its TCGplayer product id is priced from TCGplayer's own
// marketplace pricepoints -- the Near Mint Market Price on the product page,
// normal or foil to match the copy (free; no API credits). Same rule as
// Pokemon: a change under 10% is applied, a bigger one waits in PRICE SYNC.
// A played copy (LP/MP/HP/DMG) is left to the dashboard's own sync, which
// prices conditions through JustTCG.
import { pacificDay, pacificHour, SMALL_CHANGE_PCT, tcgPlayerIdOf, checkedToday, marketOf, ruled } from './pokemon-daily-sync.mjs';

export const MTG_SYNC_BATCH = 60;
export const MTG_SYNC_START_HOUR = 3; // Pacific

const isMagic = d => /^(magic|mtg)\b/i.test(String(d.category || '').trim());
const condOf = d => String(d.selectedCondition || d.condition || '').trim();
export function isNearMintOrSealed(d = {}) {
  const c = condOf(d).toLowerCase();
  return !c || /^(nm|near mint|mint|factory sealed|sealed|new)$/.test(c) || /near mint|factory sealed/.test(c);
}
export function finishOf(d = {}) {
  const f = [d.selectedFinish, d.finish, d.printing].filter(Boolean).join(' ').toLowerCase();
  return /foil|etched/.test(f) && !/non[- ]?foil/.test(f) ? 'foil' : 'normal';
}
export function isMtgSyncItem(row = {}) {
  const d = row.data || {};
  if (row.status !== 'in_stock' || d.archivedAt) return false;
  if (!isMagic(d) || d.dropship === true || d.ownershipType === 'supplier') return false;
  if (!tcgPlayerIdOf(d)) return false;
  if (String(d.grader || '').trim() && String(d.grade || '').trim()) return false; // slabs: graded guides elsewhere
  return isNearMintOrSealed(d);
}
// TCGplayer pricepoints -> this copy's market price (foil for a foil copy,
// else normal; a product with only one printing uses that one).
export function mtgMarketFrom(pricepoints = [], d = {}) {
  const rows = Array.isArray(pricepoints) ? pricepoints : [];
  const pick = type => Number(rows.find(p => String(p.printingType || '').toLowerCase() === type)?.marketPrice) || 0;
  const want = finishOf(d);
  const n = want === 'foil' ? pick('foil') : pick('normal');
  const only = rows.length === 1 ? Number(rows[0].marketPrice) || 0 : 0;
  const v = n || only;
  return v > 0 ? Math.round(v * 100) / 100 : 0;
}
export function planMtgRow(row, pricepoints, now = Date.now()) {
  const d = row.data || {};
  const at = new Date(now).toISOString();
  const checked = { ...d, priceSyncCheckedAt: at };
  const fresh = pricepoints ? mtgMarketFrom(pricepoints, d) : 0;
  if (!(fresh > 0)) return { kind: 'no-price', data: checked };
  const old = marketOf(d);
  const src = { priceSource: 'TCGplayer market (server sync)', marketPriceSource: 'TCGplayer' };
  if (old > 0 && Math.abs(fresh - old) < 0.01) return { kind: 'unchanged', data: { ...checked, ...src, priceUpdatedAt: at, lastPriceUpdate: at, stalePrice: false, livePriceStatus: 'live' } };
  const deltaPct = old > 0 ? Math.abs(fresh - old) / old * 100 : 100;
  if (old > 0 && deltaPct >= SMALL_CHANGE_PCT) {
    return { kind: 'review', data: checked, proposal: { itemId: row.id, name: d.name || '', oldPrice: old, newPrice: fresh, deltaPct: Math.round(deltaPct * 10) / 10, direction: fresh >= old ? 'up' : 'down', lastUpdated: at, tcgPlayerId: tcgPlayerIdOf(d), source: 'TCGplayer market (MTG server sync)', at } };
  }
  const locked = Number(d.priceOverride || 0) > 0;
  const list = locked ? {} : { salePrice: ruled(fresh, d.priceRule), listPrice: ruled(fresh, d.priceRule) };
  return { kind: 'applied', oldPrice: old, newPrice: fresh, data: { ...checked, ...src, ...list,
    market: fresh, price: fresh, marketPrice: fresh, rawMarketPrice: fresh, lastMarketPrice: old, previousMarketPrice: old,
    lastPriceUpdate: at, priceUpdatedAt: at, stalePrice: false, livePriceStatus: 'live' } };
}
export function nextMtgBatch(rows = [], now = Date.now(), size = MTG_SYNC_BATCH) {
  return rows.filter(isMtgSyncItem).filter(r => !checkedToday(r.data, now))
    .sort((a, b) => String(a.data?.priceSyncCheckedAt || '').localeCompare(String(b.data?.priceSyncCheckedAt || '')))
    .slice(0, size);
}
// deps: { db(path, opts), pricepoints(productId) -> array|null, kvGet, kvPut }
export async function runMtgServerSync(storeId, deps, now = Date.now()) {
  if (pacificHour(now) < MTG_SYNC_START_HOUR) return { skipped: 'before 3 AM' };
  const s = encodeURIComponent(storeId);
  const { data: rows } = await deps.db(`inventory_items?store_id=eq.${s}&status=eq.in_stock&or=(data->>category.ilike.magic*,data->>category.ilike.mtg*)&select=id,status,data&limit=5000`);
  const batch = nextMtgBatch(rows || [], now);
  const out = { checked: 0, applied: 0, unchanged: 0, review: 0, noPrice: 0, failed: 0, left: 0 };
  if (!batch.length) return out;
  const cache = new Map(), queue = [];
  for (const row of batch) {
    const id = tcgPlayerIdOf(row.data || {});
    if (!cache.has(id)) { let pp = null; try { pp = await deps.pricepoints(id); } catch (_) { pp = null; } cache.set(id, pp); }
    const plan = planMtgRow(row, cache.get(id), now);
    try { await deps.db(`inventory_items?id=eq.${encodeURIComponent(row.id)}&store_id=eq.${s}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ data: plan.data, updated_at: new Date(now).toISOString() }) }); }
    catch (_) { out.failed++; continue; }
    out.checked++;
    if (plan.kind === 'applied') out.applied++; else if (plan.kind === 'unchanged') out.unchanged++;
    else if (plan.kind === 'review') { out.review++; queue.push(plan.proposal); } else out.noPrice++;
  }
  if (queue.length) {
    const key = 'price-sync-review:' + storeId;
    const byId = new Map(((await deps.kvGet(key)) || []).map(p => [p.itemId, p]));
    for (const p of queue) byId.set(p.itemId, p);
    await deps.kvPut(key, [...byId.values()].slice(-500));
  }
  out.left = Math.max(0, nextMtgBatch(rows || [], now, 100000).length - batch.length);
  return out;
}
export { pacificDay };
