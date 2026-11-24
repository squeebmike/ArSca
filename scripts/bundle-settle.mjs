// A bundle that sold anywhere -- Whatnot, eBay, the website, the register -- marks the books inside it sold too
// (store, 2026-11-24: "when that bundle sells it takes off 1 of each book"). The books left stock when the bundle was
// built (status 'bundled'); this closes them out as sold with the bundle's sale, so per-book sales history has them.
// The register already did this at checkout (cascadeMarkBundleMembersSold); online sales didn't. A sweep, so it
// covers every channel: rows still 'bundled' whose bundle has sold.
export const BUNDLE_SOLD = ['sold', 'sold_pending_pickup', 'sold_pending_shipment'];

// members: [{id, data}] at status 'bundled'; bundles: [{id, status, data}] -> [{id, data}] to write as sold.
export function bundleMembersToSettle(members = [], bundles = [], now = new Date().toISOString()) {
  const byId = new Map(bundles.map(b => [b.id, b]));
  const out = [];
  for (const m of members) {
    const d = m.data || {}, b = byId.get(d.bundledIntoId);
    if (!b || !BUNDLE_SOLD.includes(String(b.status || ''))) continue;
    const bd = b.data || {};
    out.push({ id: m.id, data: { ...d, status: 'sold', lifecycle: 'sold', soldAt: bd.soldAt || now, ...(bd.saleId ? { saleId: bd.saleId } : {}), soldInBundle: true } });
  }
  return out;
}

// db(path, init) -> { data } (supabaseAdminFetch). Reads only bundled rows and their bundles' status (small).
export async function settleSoldBundleMembers(storeId, db) {
  const s = encodeURIComponent(storeId);
  const { data: members } = await db(`inventory_items?store_id=eq.${s}&status=eq.bundled&select=id,data&limit=500`);
  const ids = [...new Set((members || []).map(m => m.data?.bundledIntoId).filter(id => /^[0-9a-f-]{36}$/i.test(String(id))))];
  if (!ids.length) return { settled: 0 };
  const bundles = [];
  for (let i = 0; i < ids.length; i += 50) {
    const { data } = await db(`inventory_items?store_id=eq.${s}&id=in.(${ids.slice(i, i + 50).join(',')})&status=in.(${BUNDLE_SOLD.join(',')})&select=id,status,soldAt:data->>soldAt,saleId:data->>saleId`);
    for (const b of data || []) bundles.push({ id: b.id, status: b.status, data: { soldAt: b.soldAt, saleId: b.saleId } });
  }
  const todo = bundleMembersToSettle(members || [], bundles);
  for (const m of todo) await db(`inventory_items?id=eq.${encodeURIComponent(m.id)}&store_id=eq.${s}&status=eq.bundled`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ data: m.data, status: 'sold' }) });
  return { settled: todo.length };
}
