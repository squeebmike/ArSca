// Whatnot show prep (store, 2026-11-01: "build the show prep and all whatnot
// features"). Pick a theme, and the dashboard suggests a lineup from
// inventory, a running order that keeps the room going, and a starting bid
// for each item; LINE IT UP puts them in the show as auctions and the
// overlay's NOW PLAYING / NEXT STAGE follow the same order.
// Runs in the dashboard (no server reads): items are the dashboard's own.

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
export function itemPrice(i = {}) {
  // A floor the store set (minPrice / autoFloor) is the least it sells for, like the website.
  const r = i.raw || {};
  return Math.max(num(i.priceOverride), num(i.market), num(i.marketPrice), num(i.salePrice), num(i.listPrice), num(i.minPrice ?? r.minPrice), num(r.autoFloor), 0);
}
const words = s => String(s || '').toLowerCase().split(/\s+/).filter(Boolean);
const haystack = i => [i.name, i.set, i.variant, i.category, i.player, i.grader && i.grade ? i.grader + ' ' + i.grade : ''].join(' ').toLowerCase();

// What can go in a show: in stock here, one or more on hand, priced, and the
// store's own (not a supplier's dropship or an unreceived preorder).
export function prepCandidates(items = [], { theme = '', category = '', minPrice = 0, maxPrice = 0, excludeIds = [] } = {}) {
  const want = words(theme), skip = new Set(excludeIds), cat = String(category || '').toLowerCase();
  return items.filter(i => {
    if (!i || i.source !== 'built_in' || skip.has(i.id)) return false;
    if (String(i.status || '') !== 'in_stock' || ['hold', 'presale', 'sold', 'archived'].includes(String(i.lifecycle || ''))) return false;
    const r = i.raw || {};
    if (i.dropship === true || r.dropship === true || i.ownershipType === 'supplier' || r.ownershipType === 'supplier' || /^foc_presale/.test(String(r.source || ''))) return false;
    if (!(num(i.qty ?? 1) > 0)) return false;
    const price = itemPrice(i);
    if (!(price > 0) || price < num(minPrice) || (num(maxPrice) > 0 && price > num(maxPrice))) return false;
    if (cat && !String(i.category || '').toLowerCase().includes(cat)) return false;
    const h = haystack(i);
    return want.every(w => h.includes(w));
  });
}

// Starting bid. protect (default): at least what it cost, so an auction can't
// sell under cost -- with no cost known, 30% of its price; dollar: $1 starts;
// percent: that share of its price. Never above its price, never under $1.
export const START_RULES = { protect: 'Protect cost (start at what it cost)', dollar: '$1 starts', percent: 'Percent of price' };
export function startPriceFor(item, rule = 'protect', percent = 50) {
  const price = itemPrice(item), cost = num(item.cost);
  let start = rule === 'dollar' ? 1 : rule === 'percent' ? Math.round(price * num(percent) / 100) : cost > 0 ? Math.ceil(cost) : Math.round(price * 0.3);
  start = Math.max(1, start);
  return Math.max(1, Math.min(start, Math.floor(price) || 1));
}

// The running order: cheap hooks first ($1 starts, to fill the room), then
// higher and lower items taking turns, the biggest item about two-thirds in,
// and the second biggest to close.
export function buildLineup(candidates = [], { count = 20, rule = 'protect', percent = 50, hooks = 2 } = {}) {
  const n = Math.max(1, Math.min(60, Math.floor(num(count)) || 20));
  const byValue = candidates.slice().sort((a, b) => itemPrice(b) - itemPrice(a) || String(a.name).localeCompare(String(b.name)));
  const picked = byValue.slice(0, n);
  if (!picked.length) return { lineup: [], totals: { value: 0, cost: 0, starts: 0, count: 0 } };
  const entry = (i, role) => ({ id: i.id, title: String(i.name || ''), detail: [i.set, i.variant, i.grader && i.grade ? i.grader + ' ' + i.grade : ''].filter(Boolean).join(' · '),
    image: /^https:\/\//.test(String(i.thumbnail || i.imageUrl || '')) ? String(i.thumbnail || i.imageUrl) : '',
    price: Math.round(itemPrice(i) * 100) / 100, cost: Math.round(num(i.cost) * 100) / 100,
    start: role === 'hook' ? 1 : startPriceFor(i, rule, percent), role, sellOnWhatnot: i.sellOnWhatnot === true });
  const big = picked[0], closer = picked.length > 2 ? picked[1] : null;
  const rest = picked.filter(i => i !== big && i !== closer);
  const nHooks = Math.max(0, Math.min(num(hooks), Math.max(0, rest.length - 1)));
  const asc = rest.slice().sort((a, b) => itemPrice(a) - itemPrice(b));
  const hookItems = asc.slice(0, nHooks);
  const middle = rest.filter(i => !hookItems.includes(i)).sort((a, b) => itemPrice(b) - itemPrice(a));
  // Higher, lower, higher...
  const woven = [];
  for (let lo = middle.length - 1, hi = 0; hi <= lo;) { woven.push(middle[hi++]); if (hi <= lo) woven.push(middle[lo--]); }
  const order = [...hookItems.map(i => entry(i, 'hook')), ...woven.map(i => entry(i, 'main'))];
  order.splice(Math.min(order.length, Math.round((order.length + 1) * 0.66)), 0, entry(big, 'big'));
  if (closer) order.push(entry(closer, 'closer'));
  return { lineup: order, totals: lineupTotals(order) };
}
export function lineupTotals(lineup = []) {
  const sum = k => Math.round(lineup.reduce((n, e) => n + num(e[k]), 0) * 100) / 100;
  return { value: sum('price'), cost: sum('cost'), starts: sum('start'), count: lineup.length, underCost: lineup.filter(e => e.cost > 0 && e.start < e.cost).length };
}
// For Live Studio: NOW PLAYING is the first, the rest are NEXT.
export function lineupStage(lineup = []) {
  const item = e => ({ title: e.title, detail: e.detail || '', image: e.image || '', price: e.price || 0 });
  const [first, ...rest] = lineup;
  return { now: first ? item(first) : null, next: rest.map(item) };
}
