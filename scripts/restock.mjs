// Restock: what sold out (or is about to) and how many to reorder.
// Store ask: "restock what sells out." Comics already have their own
// (FOC sell-through and the order helper); this is everything else the
// store can buy again -- sealed product (boxes, bundles, packs, tins,
// decks, collections) and supplies (sleeves, top loaders, binders). A
// one-of-a-kind single card isn't restockable and is left out.

const RESTOCK_WORDS = /\b(booster|bundle|box|display|collection|tin|deck|etb|elite trainer|blister|pack|case|sleeves?|top ?loaders?|binder|portfolio|playmat|dice|storage|sealed|kit|starter|precon|commander deck|secret lair)\b/i;
const FOC_SOURCES = new Set(['foc_receive', 'foc_presale', 'foc_presale_bundle']);

export function isRestockable(d = {}) {
  if (FOC_SOURCES.has(String(d.source || ''))) return false;
  if (d.grader || d.cert_number || d.isSlabbed) return false;
  if (/^supplies$/i.test(String(d.category || ''))) return true;
  if (/sealed/i.test(String(d.productType || '')) || /sealed/i.test(String(d.variant || ''))) return true;
  if (/^single$/i.test(String(d.productType || ''))) return false;
  return RESTOCK_WORDS.test(String(d.name || ''));
}

// One product can be on the shelf as several rows (bought at different
// times or costs): they count together.
export function restockKey(d = {}) {
  const name = String(d.name || '').toLowerCase().replace(/\s*-\s*presale\s*$/i, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return name ? String(d.category || '').toLowerCase().trim() + '|' + name : '';
}

const DAY = 864e5;
// lines: sale lines of completed sales in the window, { item_id, quantity, created_at }.
// items: the inventory rows those lines sold, { id, status, data }.
// stock: rows on the shelf now, { id, status, data }.
// coverDays: how long a reorder should last.
export function buildRestockList({ lines = [], items = [], stock = [], now = Date.now(), days = 90, coverDays = 45 } = {}) {
  const itemById = new Map(items.map(i => [String(i.id), i]));
  const products = new Map();
  const product = d => {
    const key = restockKey(d);
    if (!key) return null;
    if (!products.has(key)) products.set(key, { key, name: String(d.name || '').replace(/\s*-\s*PRESALE\s*$/i, '').trim(), category: String(d.category || ''), sold30: 0, sold90: 0, onHand: 0, firstSoldAt: null, lastSoldAt: null, cost: 0, costAt: 0, price: 0, itemIds: new Set() });
    return products.get(key);
  };
  for (const l of lines) {
    const row = itemById.get(String(l.item_id || ''));
    const d = row?.data || {};
    if (!row || !isRestockable(d)) continue;
    const at = Date.parse(l.created_at || '') || now;
    if (now - at > days * DAY) continue;
    const p = product(d);
    if (!p) continue;
    const units = Math.max(1, Number(l.quantity || 1));
    p.sold90 += units;
    if (now - at <= 30 * DAY) p.sold30 += units;
    p.firstSoldAt = p.firstSoldAt == null ? at : Math.min(p.firstSoldAt, at);
    p.lastSoldAt = p.lastSoldAt == null ? at : Math.max(p.lastSoldAt, at);
    p.itemIds.add(String(row.id));
    const cost = Number(d.cost || 0);
    if (cost > 0 && at >= p.costAt) { p.cost = cost; p.costAt = at; }
    const price = Number(d.salePrice || d.market || d.price || 0);
    if (price > 0) p.price = price;
  }
  for (const row of stock) {
    const d = row.data || {};
    if (row.status !== 'in_stock' || !isRestockable(d)) continue;
    const p = products.get(restockKey(d));
    if (!p) continue;
    p.onHand += Math.max(0, Number(d.qty ?? d.quantity ?? 0));
    p.itemIds.add(String(row.id));
    const price = Number(d.market || d.salePrice || d.price || 0);
    if (price > 0) p.price = price;
  }
  const out = [];
  for (const p of products.values()) {
    if (p.sold90 < 2) continue;
    // Selling rate over the time it's actually been selling (at least two
    // weeks), so something new that flew off the shelf isn't averaged
    // over 90 days it wasn't here for.
    const spanDays = Math.min(days, Math.max(14, Math.ceil((now - p.firstSoldAt) / DAY)));
    const perDay = p.sold90 / spanDays;
    const daysLeft = p.onHand > 0 ? Math.floor(p.onHand / perDay) : 0;
    const status = p.onHand <= 0 ? 'out' : daysLeft < 21 ? 'low' : '';
    if (!status) continue;
    const suggest = Math.max(1, Math.ceil(perDay * coverDays) - p.onHand);
    out.push({ key: p.key, name: p.name, category: p.category, status, sold30: p.sold30, sold90: p.sold90, perMonth: Math.round(perDay * 30 * 10) / 10, onHand: p.onHand, daysLeft, suggest, cost: p.cost, price: p.price, lastSoldAt: new Date(p.lastSoldAt).toISOString(), itemIds: [...p.itemIds] });
  }
  return out.sort((a, b) => (a.status === b.status ? 0 : a.status === 'out' ? -1 : 1) || b.perMonth - a.perMonth || a.daysLeft - b.daysLeft || a.name.localeCompare(b.name));
}
