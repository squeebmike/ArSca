// LINKED BUNDLE COUNTS (store, 2026-11-16: "it said I had 4 of the bundles and 4 of the ratios on that Spider-Woman. So
// somebody can accidentally buy 8 of those when I don't have 8 of that ratio?"). A bundle and the covers in it each have
// their own count on eBay; nothing tied them together. Now, after eBay sales are recorded:
//  - a bundle sold takes one copy of each cover in it off that cover's count (n bundles, n copies);
//  - a bundle never offers more than the scarcest cover in it has left.
// focPresaleOriginalQty moves down with each count, so "sold so far" (original - left), which the FOC order uses,
// stays exactly what was really sold -- a cover isn't counted sold twice for a bundle that already counts it.

const live = r => r && r.data && !r.data.ebayWithdrawnAt && ['presale', 'in_stock'].includes(r.status || 'presale');
const qtyOf = d => Math.max(0, Math.floor(Number(d?.qty ?? d?.quantity ?? 0)) || 0);

// rows: every row of the listings touched ({ id, status, data }), covers (source foc_presale) and bundles
// (foc_presale_bundle). bundleSales: [{ rowId, qty }] -- bundles just sold. Returns the rows whose counts change:
// [{ id, qty, originalQty, ebayListingId, ebaySku, was, why }].
export function planBundleStockLinks(rows = [], bundleSales = []) {
  const state = new Map();
  for (const r of rows) if (r?.id && r.data) state.set(r.id, { row: r, qty: qtyOf(r.data), orig: Math.max(qtyOf(r.data), Math.floor(Number(r.data.focPresaleOriginalQty || 0)) || 0), why: [] });
  const cover = (listingId, skuId) => rows.find(r => live(r) && r.data.source === 'foc_presale' && String(r.data.ebayListingId) === String(listingId) && r.data.focSkuId === skuId);
  for (const sale of bundleSales || []) {
    const b = rows.find(r => r.id === sale.rowId); const n = Math.max(0, Math.floor(Number(sale.qty) || 0));
    if (!b || b.data?.source !== 'foc_presale_bundle' || !n) continue;
    for (const skuId of b.data.focBundleSkuIds || []) {
      const c = cover(b.data.ebayListingId, skuId); if (!c) continue;
      const s = state.get(c.id), take = Math.min(n, s.qty); if (!take) continue;
      s.qty -= take; s.orig = Math.max(0, s.orig - take); s.why.push(take + ' in bundle' + (take === 1 ? '' : 's') + ' sold');
    }
  }
  for (const b of rows) {
    if (!live(b) || b.data.source !== 'foc_presale_bundle') continue;
    const left = (b.data.focBundleSkuIds || []).map(id => cover(b.data.ebayListingId, id)).filter(Boolean).map(c => state.get(c.id).qty);
    if (!left.length) continue;
    const cap = Math.min(...left), s = state.get(b.id);
    if (s.qty > cap) { const drop = s.qty - cap; s.qty = cap; s.orig = Math.max(0, s.orig - drop); s.why.push('only ' + cap + ' of a cover in it left'); }
  }
  const out = [];
  for (const [id, s] of state) {
    const was = qtyOf(s.row.data);
    if (s.qty !== was) out.push({ id, qty: s.qty, originalQty: s.orig, was, ebayListingId: String(s.row.data.ebayListingId || ''), ebaySku: String(s.row.data.ebaySku || ''), why: s.why.join('; ') });
  }
  return out;
}
