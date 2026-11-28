// Staff ByteRider's Worker-side lookups (store, 2026-11-28: "if I give you photos of books, can you put it in the
// cart? ... show you someone's order"). Read-only, this store only. find_items gives item ids (the cart and show
// buttons need them); orders reads the orders board. deps: storeId, db(path) -> { data }, board() -> board JSON.
const words = q => String(q || '').toLowerCase().replace(/[^a-z0-9#:.\s-]/g, ' ').split(/\s+/).map(w => w.replace(/^#/, '')).filter(w => w.length > 0).slice(0, 8);
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };

export async function byteriderStaffLocal(tool, args = {}, deps) {
  const sid = encodeURIComponent(deps.storeId);
  if (tool === 'find_items') {
    const ws = words(args.query);
    if (!ws.length) return { items: [], note: 'give some words' };
    const lim = Math.min(15, Math.max(1, Number(args.limit) || 8));
    // The longest word narrows it in the database; every word must match after.
    const key = [...ws].sort((a, b) => b.length - a.length)[0].replace(/[*,()]/g, '');
    const { data } = await deps.db(`inventory_items?store_id=eq.${sid}&status=in.(in_stock,presale,active)&or=(data->>name.ilike.*${encodeURIComponent(key)}*,data->>title.ilike.*${encodeURIComponent(key)}*)&select=id,status,data&limit=300`);
    const hay = r => [r.data?.name, r.data?.title, r.data?.setName, r.data?.variant, r.data?.coverArtist, r.data?.publisher].filter(Boolean).join(' ').toLowerCase().replace(/#/g, '');
    const items = (data || []).filter(r => ws.every(w => hay(r).includes(w)))
      .map(r => ({ id: r.id, name: String(r.data?.name || r.data?.title || '').slice(0, 120), status: r.status, qty: num(r.data?.quantity ?? r.data?.qty) ?? 0,
        price: num(r.data?.price ?? r.data?.salePrice), category: r.data?.category || '' }))
      .filter(r => r.qty > 0 || r.status === 'presale').slice(0, lim);
    return { items, note: items.length ? 'ids are for suggest_actions' : 'no in-stock match -- try fewer or different words' };
  }
  if (tool === 'orders') {
    const b = await deps.board();
    if (!b?.ok) return { error: b?.error || 'orders board unavailable' };
    const ws = words(args.query), st = String(args.status || '').toLowerCase(), lim = Math.min(25, Math.max(1, Number(args.limit) || 10));
    const out = [];
    for (const [ch, list] of Object.entries(b.channels || {})) {
      if (args.channel && ch !== args.channel) continue;
      for (const o of list || []) {
        const text = [o.number, o.buyer, ...(o.items || []).map(i => i.title)].join(' ').toLowerCase();
        if (ws.length && !ws.every(w => text.includes(w))) continue;
        if (st && !String(o.status || '').toLowerCase().includes(st.replace(/\s+/g, ''))&& !String(o.reason || '').toLowerCase().includes(st)) continue;
        out.push({ channel: ch, id: o.id, number: o.number, buyer: String(o.buyer || '').split(/\s+/)[0], date: String(o.createdAt || '').slice(0, 10), total: o.total, status: o.status, why: o.reason || '', method: o.method || '',
          items: (o.items || []).slice(0, 12).map(i => ({ title: String(i.title || '').slice(0, 90), qty: i.qty, price: i.price, state: i.state })) });
      }
    }
    out.sort((a, c) => String(c.date).localeCompare(String(a.date)));
    return { orders: out.slice(0, lim), counts: b.counts || null, note: 'buyer first names only' };
  }
  return { error: 'unknown tool' };
}
